# frozen_string_literal: true

module Rubyfront
  # La copia della lavagna che l'engine tiene per sé: solo ciò che serve a
  # giudicare — chi possiede quale carta, in che zona sta, l'ordine nelle
  # pile, il turno e il posto attivo. Niente geometria, niente grafica.
  #
  # La semantica ricalca il riduttore dei client (simulatore/src/state.ts,
  # `apply`): due copie che partono uguali e mangiano le stesse azioni devono
  # restare uguali. Le azioni che non toccano zone o turno (move, tap, say...)
  # qui sono rumore e si ignorano.
  class Table
    SEATS = %w[a b].freeze
    # Le fasi del turno (§6), nel modello minimo del client: la Pesca non è
    # una fase e le sotto-fasi del Fronte arriveranno con le Reattive.
    # L'ordine dell'array È l'ordine delle fasi: il senso unico si giudica
    # confrontando gli indici.
    PHASES = %w[preparazione fronte reazione].freeze

    attr_reader :active, :turn, :phase, :over

    FLUX_CAP = 20

    # Il Flusso disponibile di un posto (§3.2), come lo conta il client.
    def flux(seat)
      @players.fetch(seat)[:flux]
    end

    def flux_max(seat)
      @players.fetch(seat)[:flux_max]
    end

    # I PV del Rubyfront (§2): scendono con la risoluzione e con le patch.
    def hp(seat)
      @players.fetch(seat)[:hp]
    end

    # Il Gettone Flusso (§3.2), ancora da spendere?
    def token?(seat)
      @players.fetch(seat)[:token]
    end

    # Il Flusso spendibile ora: la barra più il Gettone, che «può essere
    # utilizzato in qualsiasi momento» (§3.2).
    def available(seat)
      flux(seat) + (token?(seat) ? 1 : 0)
    end

    def over?
      !@over.nil?
    end

    def initialize
      reset
    end

    def reset
      @cards = {}
      # Le dichiarazioni in corso (§6.3): dichiarante -> {to:, kind:, order:}.
      # Come nel client, una carta dichiara una cosa sola per volta; `order`
      # è il numero d'ondata, l'ordine in cui le battaglie si risolvono.
      @declarations = {}
      @active = "a"
      @turn = 1
      @phase = "preparazione"
      # I contatori che servono alle regole, come in newPlayer del client:
      # il Flusso (§3.2) e i PV (§2, la fine della partita).
      @players = SEATS.to_h { |seat| [seat, { flux: 1, flux_max: 1, hp: 20, token: false }] }
      # §3.2/§4: il Gettone va a chi non inizia — con l'active del reset.
      @players[SEATS.find { |seat| seat != @active }][:token] = true
      # Com'è finita (§2, §9): {winner:, reason:}, nil finché si gioca.
      @over = nil
      # Gli inneschi già risolti in questo turno (§8.2): "fonte|ingresso",
      # una volta sola per coppia. Il cambio di turno li azzera.
      @fired = []
    end

    def fired?(source_uid, entering_uid)
      @fired.include?("#{source_uid}|#{entering_uid}")
    end

    def fire(source_uid, entering_uid)
      @fired << "#{source_uid}|#{entering_uid}" unless fired?(source_uid, entering_uid)
    end

    def hand_count(seat)
      @cards.count { |_, card| card[:owner] == seat && card[:zone] == "hand" }
    end

    # La carta com'è annotata qui: {owner, zone, order, card_id, entered,
    # tapped, facedown, face, row} — `entered` è il numero del turno in cui
    # è scesa in campo (nil se non è mai scesa o se arriva da uno snapshot,
    # che quel passato non lo porta); `face` è la faccia mostrata (il
    # Rubyfront flippato è il Nexus, §3.1); `row` è l'ordinata canonica
    # dell'ultima posa in campo — l'UNICA geometria che la copia tiene, e
    # solo per dire se il Rubyfront è schierato (fila del Fronte) o in Zona
    # di Richiamo (fila di servizio), perché abilita le Materie solo
    # schierato (§7). nil se ignota.
    def card(uid)
      @cards[uid]
    end

    # §6.3, sfide 1 contro 1: qualcuno ferma già quell'attaccante?
    def blocked?(attacker_uid)
      @declarations.any? { |_, d| d[:to] == attacker_uid && %w[block counter].include?(d[:kind]) }
    end

    # §6.3: quella carta ha un attacco dichiarato in piedi? Un blocco vuole
    # un attaccante vero da fermare.
    def attacking?(uid)
      @declarations.any? { |from, d| from == uid && d[:kind] == "attack" }
    end

    # §6.4: c'è un'ondata dichiarata sul tavolo? Se sì, il turno non si
    # chiude senza la finestra di difesa.
    def wave_declared?
      @declarations.any? { |_, d| d[:kind] == "attack" }
    end

    # §6.4 — l'ondata nell'ordine di dichiarazione: [uid attaccante, ...],
    # solo chi è ancora in campo (chi esce perde la freccia, ma per prudenza
    # si ricontrolla).
    def attackers_in_order
      @declarations.select { |from, d| d[:kind] == "attack" && on_field?(from) }
                   .sort_by { |_, d| d[:order] }
                   .map(&:first)
    end

    # Chi ferma quell'attaccante: [uid, "block" | "counter"], o nil se
    # l'attacco passa.
    def blocker_of(attacker_uid)
      found = @declarations.find { |from, d| d[:to] == attacker_uid && %w[block counter].include?(d[:kind]) && on_field?(from) }
      found && [found[0], found[1][:kind]]
    end

    def on_field?(uid)
      card = @cards[uid]
      card && card[:zone] == "field"
    end

    # Le carte di un posto che stanno in campo (per il conteggio del Fronte,
    # §6.2: chi è Entità e chi no lo decide l'anagrafe, non il tavolo).
    def field_cards(seat)
      @cards.values.select { |card| card[:owner] == seat && card[:zone] == "field" }
    end

    def zone_count(seat, zone)
      @cards.count { |_, card| card[:owner] == seat && card[:zone] == zone }
    end

    # Lo stato intero (GameState in JSON): arriva quando il client si allinea
    # — ingresso in stanza, «Sincronizza la lavagna» — o quando l'engine si
    # collega a partita in corso. Sostituisce tutto.
    def load(state)
      reset
      return unless state.is_a?(Hash)

      @active = state["active"] if SEATS.include?(state["active"])
      @turn = state["turn"] if state["turn"].is_a?(Numeric)
      # Lavagna di un client più vecchio, senza fasi: resta la Preparazione
      # del reset — nel dubbio, la fase più permissiva per chi gioca.
      @phase = state["phase"] if PHASES.include?(state["phase"])
      SEATS.each do |seat|
        player = state.dig("players", seat)
        next unless player.is_a?(Hash)

        @players[seat][:flux] = player["flux"] if player["flux"].is_a?(Integer)
        @players[seat][:flux_max] = player["fluxMax"] if player["fluxMax"].is_a?(Integer)
        @players[seat][:hp] = player["hp"] if player["hp"].is_a?(Integer)
        @players[seat][:token] = player["token"] == true if player.key?("token")
      end
      over = state["over"]
      @over = { winner: over["winner"], reason: over["reason"] } if over.is_a?(Hash)
      Array(state["declarations"]).each do |declaration|
        next unless declaration.is_a?(Hash) && declaration["from"]

        @declarations[declaration["from"]] = { to: declaration["to"], kind: declaration["kind"],
                                               order: declaration["order"].to_i }
      end
      cards = state["cards"]
      return unless cards.is_a?(Hash)

      cards.each do |uid, card|
        next unless card.is_a?(Hash)

        # `entered` resta ignoto: lo snapshot fotografa il presente, non
        # quando ogni carta è scesa — e nel dubbio non si accusa nessuno.
        @cards[uid] = { owner: card["owner"], zone: card["zone"], order: card["order"].to_i,
                        card_id: card["cardId"], entered: nil,
                        tapped: card["tapped"] == true, facedown: card["facedown"] == true,
                        assigned_to: card["assignedTo"].is_a?(String) ? card["assignedTo"] : nil,
                        covered_turn: card["coveredTurn"].is_a?(Integer) ? card["coveredTurn"] : nil,
                        face: card["face"].to_i, row: card["y"].is_a?(Numeric) ? card["y"] : nil }
      end
    end

    def apply(action)
      return unless action.is_a?(Hash)

      case action["t"]
      when "newGame"
        reset
        if SEATS.include?(action["active"])
          @active = action["active"]
          SEATS.each { |seat| @players[seat][:token] = seat != @active }
        end
      when "loadDeck" then load_deck(action)
      when "spawn"
        # Strumento di prova del client: una carta in più, in fondo alla mano.
        card = action["card"]
        if card.is_a?(Hash) && card["uid"]
          hand = pile(card["owner"], "hand")
          @cards[card["uid"]] = { owner: card["owner"], zone: "hand", order: hand.empty? ? 0 : hand.last[:order] + 1,
                                  card_id: card["cardId"], entered: nil, tapped: false, facedown: false,
                                  face: card["face"].to_i, row: nil }
        end
      when "shuffle" then shuffle(action)
      when "draw" then draw(action)
      when "toZone" then to_zone(action)
      when "player"
        patch = action["patch"]
        player = @players[action["seat"]]
        if player && patch.is_a?(Hash)
          player[:flux] = patch["flux"] if patch["flux"].is_a?(Integer)
          player[:flux_max] = patch["fluxMax"] if patch["fluxMax"].is_a?(Integer)
          player[:hp] = patch["hp"] if patch["hp"].is_a?(Integer)
          player[:token] = patch["token"] == true if patch.key?("token")
        end
      when "gameOver"
        winner = action["winner"]
        @over = { winner: SEATS.include?(winner) ? winner : nil, reason: action["reason"] }
      when "tap"
        card = @cards[action["uid"]]
        card[:tapped] = action["tapped"] == true if card
      when "facedown"
        card = @cards[action["uid"]]
        if card
          card[:facedown] = action["facedown"] == true
          # Coprire annota il turno (§6.3): la scoperta a fine giro parte da lì.
          card[:covered_turn] = card[:facedown] ? @turn : nil
        end
      when "flip"
        card = @cards[action["uid"]]
        card[:face] = action["face"].to_i if card
      when "move"
        card = @cards[action["uid"]]
        if card
          card[:row] = action["y"] if card[:zone] == "field" && action["y"].is_a?(Numeric)
          # Lo schieramento del Rubyfront si paga (§3.1), come nel riduttore.
          pay(card[:owner], action["cost"])
        end
      when "assign"
        card = @cards[action["uid"]]
        if card
          to = action["to"]
          card[:assigned_to] = to.is_a?(String) ? to : nil
        end
      when "declare"
        declaration = action["declaration"]
        if declaration.is_a?(Hash) && declaration["from"]
          # Una carta dichiara una cosa sola per volta: la nuova sostituisce
          # la vecchia, come nel client.
          @declarations[declaration["from"]] = { to: declaration["to"], kind: declaration["kind"],
                                                 order: declaration["order"].to_i }
        end
      when "undeclare"
        @declarations.delete(action["from"])
      when "clearCombat"
        @declarations = {}
      when "resolve" then resolve(action)
      when "phase"
        @phase = action["phase"] if PHASES.include?(action["phase"])
      when "turn"
        @turn = action["turn"] if action["turn"].is_a?(Numeric)
        if SEATS.include?(action["active"]) && action["active"] != @active
          # Il cambio di turno porta con sé la routine di chi entra, come nel
          # riduttore (state.ts): fase in Preparazione (§6), Entità stappate
          # («all'inizio del turno successivo del proprietario», §6.3), frecce
          # sgomberate. Il Flusso non vive in questa copia. Il contatore
          # ritoccato a mano (active invariato) non è un cambio di turno.
          @active = action["active"]
          @phase = "preparazione"
          @fired = []
          @cards.each_value do |card|
            next unless card[:owner] == @active && card[:zone] == "field"

            card[:tapped] = false
            # La copertura «dura un giro completo» (§6.3): coperta al turno
            # T, si scopre al proprio turno dopo il successivo, T+3. Senza
            # data resta com'è, nel dubbio — come nel riduttore.
            next unless card[:facedown] && card[:covered_turn] && @turn - card[:covered_turn] >= 3

            card[:facedown] = false
            card[:covered_turn] = nil
          end
          @declarations = {}
          # §3.2: il Flusso massimo di chi entra cresce di 1 «a partire dal
          # secondo» proprio turno (mai oltre 20) — al turno 2 del contatore,
          # il primo di chi entra, resta com'è — e il disponibile si ricarica.
          player = @players[@active]
          player[:flux_max] = [FLUX_CAP, player[:flux_max] + 1].min unless @turn <= 2
          player[:flux] = player[:flux_max]
        end
      end
    end

    private

    # Paga `cost` (§3.2): prima dalla barra, e se non basta col Gettone — un
    # punto a parte, monouso. Mai sotto zero. Gemello: state.ts, pay.
    def pay(seat, cost)
      player = @players[seat]
      return unless player && cost.is_a?(Integer) && cost.positive?

      if player[:flux] >= cost
        player[:flux] -= cost
      elsif player[:token] && player[:flux] + 1 >= cost
        player[:flux] = player[:flux] + 1 - cost
        player[:token] = false
      else
        player[:flux] = 0
      end
    end

    # Le carte di una pila, dalla cima (order più basso) al fondo.
    def pile(seat, zone)
      @cards.values
            .select { |card| card[:owner] == seat && card[:zone] == zone }
            .sort_by { |card| card[:order] }
    end

    # Ricaricare un mazzo è ricominciare, per quel posto soltanto: via tutte
    # le sue carte, dentro quelle nuove così come arrivano.
    def load_deck(action)
      seat = action["seat"]
      @cards.reject! { |_, card| card[:owner] == seat }
      Array(action["cards"]).each do |card|
        next unless card.is_a?(Hash) && card["uid"]

        @cards[card["uid"]] = { owner: card["owner"], zone: card["zone"], order: card["order"].to_i,
                                card_id: card["cardId"],
                                entered: card["zone"] == "field" ? @turn : nil,
                                tapped: card["tapped"] == true, facedown: card["facedown"] == true,
                                face: card["face"].to_i, row: card["y"].is_a?(Numeric) ? card["y"] : nil }
      end
      # Frecce e assegnazioni verso carte appena sparite non vogliono più
      # dire niente.
      @declarations.select! { |from, d| @cards.key?(from) && @cards.key?(d[:to]) }
      @cards.each_value { |card| card[:assigned_to] = nil if card[:assigned_to] && !@cards.key?(card[:assigned_to]) }
    end

    # L'ordine arriva già mescolato da chi ha premuto il tasto (il caso si
    # tira una volta sola): qui si ricopia e basta.
    def shuffle(action)
      Array(action["order"]).each_with_index do |uid, index|
        card = @cards[uid]
        card[:order] = index if card && card[:owner] == action["seat"] && card[:zone] == "deck"
      end
    end

    def draw(action)
      deck = pile(action["seat"], "deck")
      return if deck.empty?

      hand = pile(action["seat"], "hand")
      order = hand.empty? ? 0 : hand.last[:order] + 1
      deck.first(action["count"].to_i).each do |card|
        card[:zone] = "hand"
        card[:order] = order
        card[:facedown] = false
        order += 1
      end
    end

    # §6.4, la risoluzione applicata come nel client: i morti nell'Abisso
    # (con tutto ciò che un'uscita dal campo comporta, vedi to_zone) e
    # l'ondata sgomberata. I PV non stanno in questa copia.
    def resolve(action)
      damage = 0
      Array(action["battles"]).each do |battle|
        next unless battle.is_a?(Hash)

        to_zone({ "uid" => battle["attacker"], "zone" => "abisso" }) if battle["attackerDies"] == true
        to_zone({ "uid" => battle["blocker"], "zone" => "abisso" }) if battle["blockerDies"] == true && battle["blocker"]
        damage += battle["damage"].to_i
      end
      @declarations = {}
      # I danni degli attacchi non bloccati scendono sui PV del difensore,
      # mai sotto zero — come nel riduttore.
      foe = SEATS.find { |seat| seat != action["seat"] }
      @players[foe][:hp] = [0, @players[foe][:hp] - damage].max if foe && SEATS.include?(action["seat"])
    end

    def to_zone(action)
      card = @cards[action["uid"]]
      return unless card

      zone = action["zone"]
      # L'ingresso in campo si annota col turno in corso (§6.2, attesa di
      # evocazione): conta solo il passaggio da fuori a dentro — un toZone
      # che resta sul campo non è un nuovo ingresso.
      card[:entered] = @turn if zone == "field" && card[:zone] != "field"
      # Giocare dalla mano costa: il costo viaggia nell'azione (`cost`, lo
      # mette il client dal catalogo e l'engine lo verifica) e si paga come
      # nel riduttore (pay).
      pay(card[:owner], action["cost"]) if zone == "field" && card[:zone] == "hand"
      card[:zone] = zone
      if zone == "field"
        card[:order] = 0
        card[:row] = action["y"] if action["y"].is_a?(Numeric)
        return
      end
      card[:row] = nil

      # Fuori dal campo la carta si raddrizza e si scopre (come in state.ts),
      # e chi esce esce anche dal combattimento: la sua freccia se ne va, e
      # quella che gli puntava contro pure. Le assegnazioni si sciolgono in
      # entrambi i versi (§3.1: il ritorno in campo è sempre disarmato).
      card[:tapped] = false
      card[:facedown] = false
      card[:covered_turn] = nil
      card[:assigned_to] = nil
      uid = action["uid"]
      @declarations.reject! { |from, d| from == uid || d[:to] == uid }
      # Gli Oggetti addosso a chi esce: sciolti, e — verso Ritiro o Abisso
      # — la seguono (§6.2, §5), come nel riduttore. In mano o nel mazzo no.
      worn = @cards.select { |_, other| other[:assigned_to] == uid && other[:zone] == "field" }.keys
      @cards.each_value { |other| other[:assigned_to] = nil if other[:assigned_to] == uid }

      rest = pile(card[:owner], zone).reject { |other| other.equal?(card) }
      card[:order] =
        if action["toBottom"]
          rest.empty? ? 0 : rest.last[:order] + 1
        else
          rest.empty? ? 0 : rest.first[:order] - 1
        end

      return unless %w[ritiro abisso].include?(zone)

      worn.each { |object_uid| to_zone({ "uid" => object_uid, "zone" => zone }) }
    end
  end
end
