# frozen_string_literal: true

require "securerandom"
require "json"
require_relative "engine"

module Rubyfront
  # La stanza: il tavolo di una partita, con UN Engine per tutti i client
  # seduti (deciso 2026-09-11: l'engine è l'unico a scrivere lo stato).
  #
  # Ogni azione arriva come richiesta di giudizio (`judge`); se passa, entra
  # nel giornale e viene inoltrata agli altri client come `action`. Chi
  # riceve applica ciò che il tavolo ha approvato, mai ciò che l'avversario
  # dice di aver fatto. Chi entra (o rientra) riceve il giornale e
  # ricostruisce la lavagna da lì: lo stato è una funzione del giornale, e
  # il giornale lo scrive solo il tavolo.
  #
  # Dal 2026-10-21 (audit): il caso lo tira LA STANZA — i dadi (`roll`), le
  # mescolate, l'ordine del mazzo al carico, chi apre — completando l'azione
  # PRIMA del giudizio (`complete`); l'azione completata torna al mittente
  # nel verdetto (`applied`) e il client applica quella. E il giornale ha
  # una VISTA PER POSTO (`project`): ciascun posto riceve le identità delle
  # proprie carte nascoste e mai quelle dell'altro (mano e mazzo altrui sono
  # dorsi), con le pescate nominate (`drawn`), le guardate (`looked`) e le
  # identità di ciò che esce da una zona nascosta (`identities`).
  #
  # In una stanza con nome l'attore di ogni gesto è il POSTO del client, non
  # quello che il client dichiara: un client modificato non può agire per
  # l'avversario. La stanza «solo» (nessun nome: partita col bot) è un tavolo
  # per un solo client: si fida dell'attore dichiarato, non proietta (i due
  # posti sono dello stesso client), accetta lo snapshot — ma uno snapshot
  # la marca «sandbox» fino alla partita dopo, e una partita sandbox non dà
  # ricompense (outcome.rewards).
  #
  # Niente socket qui: ogni client è una `out` (callable che riceve un Hash),
  # così i test parlano con la stanza direttamente e il trasporto
  # (bin/server) resta un dettaglio. Il lucchetto è della stanza: un thread
  # per client, ma dentro il tavolo si entra uno alla volta, e l'ordine in
  # cui i verdetti e gli inoltri escono è l'ordine del giornale. Il gancio
  # della fine partita (che fa I/O verso la memoria) gira FUORI dal
  # lucchetto: `handle` ed `expire` tornano i callback da eseguire dopo.
  class Room
    SEATS = %w[a b].freeze
    # Il tetto del giornale (RF-018): oltre, il tavolo chiude la partita per limite.
    JOURNAL_MAX = 4000
    # La grazia di un posto lasciato (RF-011): riservato al suo token per
    # tanti secondi; poi, a partita in corso, è abbandono (forfeit).
    SEAT_GRACE_S = 120
    # La chat vocale inoltrata com'è: non oltre questa misura.
    RTC_MAX_BYTES = 16 * 1024
    HIDDEN_ZONES = %w[hand deck].freeze
    PUBLIC_ZONES = %w[field ritiro abisso].freeze

    attr_reader :name, :journal, :emptied_at, :match_id

    # `starter` decide chi apre la partita (§4): il tavolo lo tira, non il
    # client — in una stanza con nome il giornale comincia da quel `newGame`.
    # `on_over` (2026-09-23) è il gancio della fine partita: `->(room, outcome)`,
    # chiamato UNA volta per partita, fuori dal lucchetto, con l'esito
    # (vedi `outcome_of`). La stanza non sa chi sono i seduti: il trasporto
    # glielo dice con `attach` (una lambda per posto), e al primo carico del
    # mazzo di un posto la stanza FISSA l'identità (`pinned`): da lì in poi
    # l'esperienza va a quella, cambi di accesso o no.
    # `random` tira il caso (SecureRandom; nei test e in sviluppo un
    # `Random.new(seme)`), `clock` dà l'ora, `token_source` i token dei posti.
    # `rewards` dice se le partite di questa stanza danno esperienza.
    def initialize(name, cards: {}, decks: {}, solo: false, starter: nil, on_over: nil,
                   random: SecureRandom, clock: -> { Time.now }, token_source: -> { SecureRandom.hex(16) },
                   rewards: false, seat_grace_s: SEAT_GRACE_S)
      @name = name
      @solo = solo
      @random = random
      @clock = clock
      @token_source = token_source
      @rewards = rewards
      @seat_grace_s = seat_grace_s
      @engine = Engine.new(cards: cards, decks: decks, require_index: !solo)
      @clients = {}
      @tokens = {}
      @left_at = {}
      @whos = {}
      @testers = {}
      @ascents = {}
      @verifieds = {}
      @pinned = {}
      @on_over = on_over
      @over_told = false
      @sandboxed = false
      @journal = []
      @match_id = SecureRandom.uuid
      @mutex = Mutex.new
      @emptied_at = @clock.call
      return if solo

      first = { "t" => "newGame", "active" => SEATS.include?(starter) ? starter : SEATS.sample(random: @random) }
      @engine.judge(first, actor: :table)
      @journal << { action: first, from: nil, views: nil }
    end

    def solo?
      @solo
    end

    def empty?
      @mutex.synchronize { live_seats.empty? }
    end

    def seats
      @mutex.synchronize { live_seats }
    end

    # Un client si siede: al posto che preferisce se è libero, se no al
    # primo libero (dal 2026-09-23 il posto lo assegna il tavolo, non il
    # link). Torna il posto assegnato, o `nil` a stanza piena: il trasporto
    # lo dice al client e chiude. Chi si siede lo sa subito (`seat`), col
    # suo TOKEN (dal 2026-10-21): un posto lasciato resta riservato a quel
    # token per la grazia; col token si riprende il posto (anche da un'altra
    # scheda: la prima viene congedata), senza token un estraneo non lo prende.
    def join(wanted, out, token: nil)
      @mutex.synchronize do
        now = @clock.call
        resumed = token.is_a?(String) && !token.empty? ? SEATS.find { |seat| @tokens[seat] == token } : nil
        if resumed
          previous = @clients[resumed]
          if previous && !previous.equal?(out)
            send_to(resumed, { t: "refused", code: "replaced", reason: "sei entrato da un'altra scheda: questa si chiude", reason_en: "you joined from another tab: this one closes" })
          end
          seat_client(resumed, out)
          send_to(resumed, { t: "seat", seat: resumed, token: token, resumed: true })
          announce
          return resumed
        end

        free = SEATS.select { |seat| free?(seat, now) }
        seat = free.include?(wanted) ? wanted : free.first
        return nil unless seat

        forget_seat(seat)
        @tokens[seat] = @token_source.call
        seat_client(seat, out)
        send_to(seat, { t: "seat", seat: seat, token: @tokens[seat] })
        announce
        seat
      end
    end

    # Chi è seduto a quel posto, come lambda (`-> { id o nil }`): vale anche se
    # l'accesso arriva dopo. Il trasporto la registra dopo il `join`.
    # `tester:` dice se chi siede è l'account di prova (`-> { true/false }`):
    # solo lui usa gli strumenti di prova (Engine.test_tool?).
    # `ascent:` (2026-09-26) dice l'Ascesa che spetta a chi siede con quel
    # mazzo (`->(deck_id) { {"hp" => n, "fury" => n} }`, letta dalla memoria):
    # il `loadDeck` di quel posto non può portarne di più (§3.3).
    # `verified:` (2026-10-21) dice se l'account ha l'email confermata (o un
    # accesso Google): la politica delle ricompense lo legge dall'esito.
    def attach(seat, who:, tester: nil, ascent: nil, verified: nil)
      @mutex.synchronize do
        @whos[seat] = who
        @testers[seat] = tester
        @ascents[seat] = ascent
        @verifieds[seat] = verified
      end
    end

    def tester?(seat)
      tester = @testers[seat]
      tester ? tester.call == true : false
    rescue StandardError
      false
    end

    def player_of(seat)
      who = @whos[seat]
      who&.call
    rescue StandardError
      nil
    end

    def verified?(seat)
      verified = @verifieds[seat]
      verified ? verified.call == true : false
    rescue StandardError
      false
    end

    # L'identità fissata al posto per questa partita (dal primo carico del mazzo).
    def pinned_player(seat)
      @pinned.dig(seat, :player_id)
    end

    # Il mazzo caricato a quel posto, dal giornale (l'ultimo `loadDeck` passato):
    # la stanza non apre l'engine per questo.
    def deck_of(seat)
      entry = @journal.reverse.find { |item| item[:action].is_a?(Hash) && item[:action]["t"] == "loadDeck" && item[:action]["seat"] == seat }
      entry && entry[:action]["deckId"].is_a?(String) ? entry[:action]["deckId"] : nil
    end

    # Il posto è a una partita in corso (mazzo caricato, partita non finita)?
    # L'utenza lo chiede prima di cambiare accesso (RF-033).
    def busy?(seat)
      return false if @solo

      @mutex.synchronize { !deck_of(seat).nil? && !@engine.over? }
    end

    # Un messaggio a un posto dal gancio della fine partita (che gira fuori
    # dal lucchetto, dal 2026-10-21): il lucchetto lo prende qui.
    def reply(seat, payload)
      @mutex.synchronize { send_to(seat, payload) }
    end

    def leave(seat, out)
      @mutex.synchronize do
        return unless @clients[seat].equal?(out)

        @clients[seat] = nil
        @left_at[seat] = @clock.call
        @emptied_at = @clock.call if live_seats.empty?
        announce
      end
    end

    # Lo sweeper del trasporto passa di qui: un posto lasciato oltre la
    # grazia si libera (token e identità dimenticati) e, a partita in corso,
    # è un abbandono: il tavolo dichiara la fine (forfeit) a favore dell'altro.
    # Torna i callback da eseguire fuori dal lucchetto (il gancio della fine).
    def expire(now = @clock.call)
      after = []
      @mutex.synchronize do
        SEATS.each do |seat|
          left = @left_at[seat]
          next unless left && @clients[seat].nil? && now - left > @seat_grace_s

          forget_seat(seat)
          next unless @engine.started? && !@engine.over?

          winner = SEATS.find { |other| other != seat }
          table_action({ "t" => "gameOver", "winner" => winner, "reason" => "forfeit" }, after)
        end
      end
      after
    end

    # Un messaggio del client seduto a `seat`. Le buste:
    #
    #   hello           → il saluto dell'engine, poi il giornale (stanze con nome), nella vista del posto
    #   (all'ingresso il tavolo manda da sé `seat`, il posto assegnato col token, e `peers`)
    #   judge           → il verdetto a chi chiede (con `applied` se la stanza ha completato l'azione);
    #                     se passa, `action` agli altri nella loro vista
    #   rtc             → inoltrata agli altri com'è (la chat vocale), entro la misura
    #   snapshot        → solo nella stanza «solo»: allinea la copia del tavolo, e la marca sandbox
    #   consult, altro  → ignorati: nessuno dice più al tavolo cos'è già successo
    #
    # `out` (facoltativo) è il client che parla: una scheda congedata da un
    # rientro col token non parla più per il posto. Torna i callback da
    # eseguire fuori dal lucchetto (il gancio della fine partita).
    def handle(seat, message, out: nil)
      return [] unless message.is_a?(Hash)

      after = []
      @mutex.synchronize do
        return [] if out && !@clients[seat].equal?(out)

        case message["t"]
        when "hello"
          send_to(seat, @engine.hello)
          send_to(seat, { t: "journal", match: @match_id, actions: @journal.map { |entry| { action: view_of(entry, seat), from: entry[:from] } } }) unless @solo
        when "judge"
          judge(seat, message, after)
        when "rtc"
          payload = message["payload"]
          size = JSON.generate(payload).bytesize rescue RTC_MAX_BYTES + 1
          broadcast({ t: "rtc", payload: payload, from: seat }, except: seat) if size <= RTC_MAX_BYTES
        when "snapshot"
          if @solo
            @engine.snapshot(message["state"])
            @sandboxed = true
          end
        end
      end
      after
    end

    private

    def live_seats
      @clients.select { |_seat, out| out }.keys.sort
    end

    def seat_client(seat, out)
      @clients[seat] = out
      @left_at.delete(seat)
      @emptied_at = nil
    end

    # Il posto è libero per un estraneo: nessuno seduto, e nessun token che lo riserva ancora.
    def free?(seat, now)
      return false if @clients[seat]

      left = @left_at[seat]
      @tokens[seat].nil? || (left && now - left > @seat_grace_s)
    end

    def forget_seat(seat)
      @clients.delete(seat)
      @tokens.delete(seat)
      @left_at.delete(seat)
      @whos.delete(seat)
      @testers.delete(seat)
      @ascents.delete(seat)
      @verifieds.delete(seat)
    end

    def judge(seat, message, after)
      given = message["action"]
      actor = @solo ? message["actor"] : seat
      seq = message["seq"]
      if Engine.test_tool?(given) && !tester?(seat)
        send_to(seat, { t: "verdict", action: given["t"], ok: false, ruled: true,
                        reason: "gli strumenti di prova sono dell'account di prova (§protocollo)", reason_en: "the test tools belong to the test account (§protocollo)", seq: seq })
        return
      end
      if ascent_stopped?(given)
        send_to(seat, { t: "verdict", action: "loadDeck", ok: false, ruled: true,
                        reason: "l'Ascesa del mazzo va oltre quella del tuo Rubyfront (§3.3)", reason_en: "the deck's Ascent goes beyond your Rubyfront's (§3.3)", seq: seq })
        return
      end

      action = complete(given)
      before = @engine.card_facts
      looked = top_looked(action)
      verdict =
        begin
          @engine.judge(action, actor: actor)
        rescue StandardError => error
          warn "giudizio fallito (#{@name.inspect}, #{action.is_a?(Hash) ? action["t"] : action.class}): #{error.message}"
          { t: "verdict", action: action.is_a?(Hash) ? action["t"] : nil, ok: false, ruled: true,
            reason: "il tavolo non ha potuto giudicare l'azione (§protocollo)", reason_en: "the table couldn't judge the action (§protocollo)" }
        end
      verdict = verdict.merge(seq: seq)
      unless verdict[:ok]
        send_to(seat, verdict)
        return
      end

      views = @solo ? nil : SEATS.to_h { |viewer| [viewer, project(action, viewer, before, @engine.card_facts, looked)] }
      applied = views ? views[seat] : action
      verdict[:applied] = applied unless applied.equal?(given)
      send_to(seat, verdict)
      record(action, seat, views)
      pin(seat, action)
      broadcast_views(views, action, seat)
      tell_over(action, after)
      return if @journal.size < JOURNAL_MAX || @engine.over?

      table_action({ "t" => "gameOver", "winner" => nil, "reason" => "limit" }, after)
    end

    # Il caso lo tira la stanza (dal 2026-10-21): il valore del dado (lo
    # stesso se la chiave è già in tavola in questo turno: non si ripesca),
    # l'ordine di mescolata e mulligan, l'ordine del mazzo al carico, chi
    # apre. Un valore o un ordine del client è SEMPRE sovrascritto. Torna la
    # stessa azione quando non c'è nulla da completare.
    def complete(action)
      return action unless action.is_a?(Hash)

      case action["t"]
      when "roll"
        die = action["die"]
        return action unless die.is_a?(Integer) && die.positive?

        remembered = action["for"].is_a?(String) ? @engine.roll_for(action["for"]) : nil
        value = remembered.is_a?(Hash) && remembered[:die] == die ? remembered[:value] : @random.rand(1..die)
        action.merge("value" => value)
      when "shuffle"
        action.merge("order" => @engine.zone_uids(action["seat"], "deck").shuffle(random: @random))
      when "mulligan"
        uids = @engine.zone_uids(action["seat"], "hand") + @engine.zone_uids(action["seat"], "deck")
        action.merge("order" => uids.shuffle(random: @random))
      when "loadDeck"
        cards = Array(action["cards"])
        return action unless cards.all? { |card| card.is_a?(Hash) }

        deck = cards.select { |card| card["zone"] == "deck" }.shuffle(random: @random)
        positions = deck.each_with_index.to_h { |card, index| [card, index] }
        action.merge("cards" => cards.map { |card| positions.key?(card) ? card.merge("order" => positions[card]) : card })
      when "newGame"
        action.merge("active" => SEATS.sample(random: @random))
      else
        action
      end
    end

    # Le prime carte del mazzo che uno sguardo sta per guardare (prima del
    # giudizio): la vista dell'altro le nomina (`looked`).
    def top_looked(action)
      return nil unless action.is_a?(Hash) && action["t"] == "look" && SEATS.include?(action["seat"]) && action["count"].is_a?(Integer)

      @engine.top_of_deck(action["seat"], action["count"])
    end

    # La vista di un'azione per un posto: le proprie carte com'è, quelle
    # dell'altro senza identità finché stanno in mano o nel mazzo. `before`
    # e `after` sono i fatti delle carte attorno al giudizio (uid → owner,
    # zone, card_id).
    def project(action, viewer, before, after, looked)
      return action unless action.is_a?(Hash)

      foe = SEATS.find { |seat| seat != viewer }
      view = action
      case action["t"]
      when "loadDeck"
        if action["seat"] == foe
          view = action.merge("cards" => Array(action["cards"]).map do |card|
            card.is_a?(Hash) && HIDDEN_ZONES.include?(card["zone"]) ? card.reject { |key, _| %w[cardId order].include?(key) } : card
          end)
        end
      when "spawn"
        card = action["card"]
        view = action.merge("card" => card.reject { |key, _| key == "cardId" }) if card.is_a?(Hash) && card["owner"] == foe
      when "shuffle"
        view = action.reject { |key, _| key == "order" } if action["seat"] == foe
      when "mulligan"
        view = action.reject { |key, _| key == "order" } if action["seat"] == foe
      end
      # Le pescate dell'altro, per nome: ciò che è passato dal suo mazzo alla
      # sua mano — e nel mulligan la mano nuova intera (la vecchia è tornata nel mazzo).
      drawn = if action["t"] == "mulligan" && action["seat"] == foe
                after.select { |_uid, fact| fact[:owner] == foe && fact[:zone] == "hand" }.keys
              else
                after.select { |uid, fact| fact[:owner] == foe && fact[:zone] == "hand" && before.dig(uid, :zone) == "deck" }.keys
              end
      view = view.merge("drawn" => drawn) if %w[draw mulligan turn].include?(action["t"]) && !drawn.empty?
      view = view.merge("looked" => looked) if action["t"] == "look" && action["seat"] == foe && looked
      identities = {}
      after.each do |uid, fact|
        next unless fact[:owner] == foe && fact[:card_id].is_a?(String) && PUBLIC_ZONES.include?(fact[:zone])
        next unless HIDDEN_ZONES.include?(before.dig(uid, :zone))

        identities[uid] = fact[:card_id]
      end
      if action["t"] == "look" && action["seat"] == foe && action["reveal"].is_a?(String) && after.dig(action["reveal"], :card_id).is_a?(String)
        identities[action["reveal"]] = after.dig(action["reveal"], :card_id)
      end
      view = view.merge("identities" => identities) unless identities.empty?
      view
    end

    def view_of(entry, seat)
      views = entry[:views]
      views && views[seat] ? views[seat] : entry[:action]
    end

    def broadcast_views(views, action, from)
      @clients.each do |seat, out|
        next if seat == from || out.nil?

        send_to(seat, { t: "action", action: views ? views[seat] : action, from: from })
      end
    end

    # Un gesto del tavolo stesso (actor :table): l'abbandono e il limite.
    def table_action(action, after)
      verdict = @engine.judge(action, actor: :table)
      return unless verdict[:ok]

      record(action, nil, nil)
      @clients.each { |seat, out| send_to(seat, { t: "action", action: action, from: nil }) if out }
      tell_over(action, after)
    end

    # L'identità del posto si fissa al suo primo carico del mazzo nella
    # partita: da lì l'esperienza va a quella (RF-033), chiunque sia al
    # posto dopo.
    def pin(seat, action)
      return unless action.is_a?(Hash) && action["t"] == "loadDeck" && action["seat"] == seat
      return if @pinned[seat]

      @pinned[seat] = { player_id: player_of(seat), verified: verified?(seat) }
    end

    ASCENT_ZERO = { "hp" => 0, "fury" => 0 }.freeze

    # §3.3 — l'Ascesa di un `loadDeck` va oltre quella che spetta al posto
    # caricato? Chi siede senza account (o il bot, o un posto vuoto) non ne
    # ha; chi ha un account ha quella del suo percorso per il Rubyfront del
    # mazzo. Si ferma solo il di più: portarne meno (il mazzo caricato prima
    # che l'accesso arrivi) svantaggia solo chi lo fa, e non deve fermare il
    # carico. Se la memoria non risponde, non si ferma la partita: si lascia
    # al giudizio (la forma e il conto dei PV li verifica comunque l'engine).
    def ascent_stopped?(action)
      return false unless action.is_a?(Hash) && action["t"] == "loadDeck"

      given = action["ascent"]
      return false unless given.nil? || Engine.ascent_shape?(given)

      source = @ascents[action["seat"]]
      expected = source ? source.call(action["deckId"]) : ASCENT_ZERO
      given = ASCENT_ZERO.merge(given || {})
      expected = ASCENT_ZERO.merge(expected || {})
      ASCENT_ZERO.keys.any? { |key| given[key] > expected[key].to_i }
    rescue StandardError => error
      warn "Ascesa non verificata (#{action["seat"]}): #{error.message}"
      false
    end

    # La fine partita passata al giudizio, al gancio, una volta sola: il
    # `newGame` riapre. Il gancio gira FUORI dal lucchetto (fa I/O): qui si
    # accoda, con l'esito fotografato adesso.
    def tell_over(action, after)
      return unless action.is_a?(Hash)

      if action["t"] == "newGame"
        @over_told = false
        @sandboxed = false
        @pinned = {}
        @match_id = SecureRandom.uuid
      end
      return unless action["t"] == "gameOver" && @on_over && !@over_told

      @over_told = true
      outcome = outcome_of(action)
      hook = @on_over
      after << lambda do
        hook.call(self, outcome)
      rescue StandardError => error
        warn "fine partita, gancio: #{error.message}"
      end
    end

    # L'esito di una partita, per il gancio: l'id della partita (una
    # ricompensa per id, mai due), chi ha vinto e perché, se la stanza dà
    # ricompense (mai dopo uno snapshot), e per ogni posto l'identità FISSATA
    # al primo carico, la conferma dell'email e il mazzo.
    def outcome_of(action)
      {
        match_id: @match_id,
        winner: SEATS.include?(action["winner"]) ? action["winner"] : nil,
        reason: action["reason"],
        rewards: @rewards && !@sandboxed,
        seats: SEATS.to_h do |seat|
          pinned = @pinned[seat] || {}
          [seat, { player_id: pinned[:player_id], verified: pinned[:verified] == true, deck_id: deck_of(seat) }]
        end,
      }
    end

    # Il giornale ricomincia a ogni partita nuova: chi entra dopo non ha
    # bisogno di rigiocare quelle prima. Ogni voce porta l'azione intera e
    # le viste per posto (nil per i gesti del tavolo e nella «solo»).
    def record(action, seat, views)
      @journal = [] if action.is_a?(Hash) && action["t"] == "newGame"
      @journal << { action: action, from: seat, views: views }
    end

    def announce
      broadcast({ t: "peers", peers: live_seats.size, seats: live_seats })
    end

    def send_to(seat, payload)
      out = @clients[seat]
      return unless out

      out.call(payload)
    rescue StandardError
      # Un client che non riceve più è un client che se n'è andato: lo dirà
      # il suo trasporto con `leave`.
      nil
    end

    def broadcast(payload, except: nil)
      @clients.each { |seat, out| send_to(seat, payload) unless seat == except || out.nil? }
    end
  end
end
