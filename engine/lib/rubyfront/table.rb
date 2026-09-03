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

    attr_reader :active, :turn, :phase, :over, :extra_front

    # L'ultima ondata di `seat`: uid degli attaccanti, in ordine.
    def last_wave(seat)
      Array(@last_wave[seat])
    end

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
      # L'ultima ondata di ciascun posto (uid, in ordine), annotata alla
      # risoluzione — «nel tuo turno precedente» (RBF-005). Gemello: lastWave.
      @last_wave = {}
      # Una Fase di Fronte addizionale dovuta (RBF-011). Gemello: extraFront.
      @extra_front = false
      @active = "a"
      @turn = 1
      @phase = "preparazione"
      # I contatori che servono alle regole, come in newPlayer del client:
      # il Flusso (§3.2) e i PV (§2, la fine della partita).
      @players = SEATS.to_h { |seat| [seat, { flux: 1, flux_max: 1, hp: 20, token: false, sealed: [] }] }
      # §3.2/§4: il Gettone va a chi non inizia — con l'active del reset.
      @players[SEATS.find { |seat| seat != @active }][:token] = true
      # Com'è finita (§2, §9): {winner:, reason:}, nil finché si gioca.
      @over = nil
      # Gli inneschi già risolti in questo turno (§8.2): "fonte|ingresso",
      # una volta sola per coppia. Il cambio di turno li azzera.
      @fired = []
      @rolls = {}
    end

    # Un innesco è una tripla: fonte, evento, ingresso (o la fonte stessa,
    # per gli eventi propri come l'attacco).
    def fired?(source_uid, event, entering_uid)
      @fired.include?("#{source_uid}|#{event}|#{entering_uid}")
    end

    def fire(source_uid, event, entering_uid)
      @fired << "#{source_uid}|#{event}|#{entering_uid}" unless fired?(source_uid, event, entering_uid)
    end

    # Un innesco di quella fonte con quel prefisso d'evento è già scattato?
    # («stappa UN'Entità», RBF-016: un solo bersaglio per risoluzione.)
    def fired_prefix?(source_uid, prefix)
      @fired.any? { |key| key.start_with?("#{source_uid}|#{prefix}") }
    end

    # Il tiro di un effetto a più passi (RBF-019): il primo passo lo fissa, i
    # seguenti devono portare lo stesso. Il cambio di turno lo dimentica.
    def remember_roll(source_uid, roll)
      @rolls[source_uid] = roll
    end

    def roll_of(source_uid)
      @rolls[source_uid]
    end

    # Gli Oggetti in campo addosso a quell'Entità (§3.1).
    def worn_by(uid)
      @cards.values.select { |card| card[:assigned_to] == uid && card[:zone] == "field" }
    end

    # Le carte in campo che `seat` comanda: le sue, più quelle che controlla (§8.2).
    def commanded_cards(seat)
      @cards.values.select { |card| card[:zone] == "field" && controller_of(card) == seat }
    end

    # Quella carta non si può più giocare per il resto della partita (§8.2,
    # «Non puoi più giocare…»): il sigillo segue la carta in ogni zona.
    def sealed?(seat, card_id)
      Array(@players.fetch(seat)[:sealed]).include?(card_id)
    end

    def sealed(seat)
      Array(@players.fetch(seat)[:sealed])
    end

    # «Mentre ha un Oggetto assegnato» (§3.1): un Oggetto in campo la veste.
    def armed?(uid)
      return false unless uid.is_a?(String)

      @cards.any? { |_, card| card[:assigned_to] == uid && card[:zone] == "field" }
    end

    def hand_count(seat)
      @cards.count { |_, card| card[:owner] == seat && card[:zone] == "hand" }
    end

    # La carta com'è annotata qui: {owner, zone, order, card_id, entered,
    # tapped, facedown, face, row, controller, grants} — `controller` è chi
    # la comanda se non il proprietario (§8.2, fino a fine turno), `grants`
    # le parole chiave concesse fino a fine turno — `entered` è il numero del turno in cui
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

    # Chi comanda la carta: chi la controlla, o il proprietario (§8.2).
    def controller_of(card)
      card[:controller] || card[:owner]
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

    # §6.4: quella carta sta bloccando (o contrattaccando)?
    def blocking?(uid)
      @declarations.any? { |from, d| from == uid && %w[block counter].include?(d[:kind]) }
    end

    # §6.4: c'è un'ondata dichiarata sul tavolo? Se sì, il turno non si
    # chiude senza la finestra di difesa.
    # Il numero d'ondata di un attaccante (0 se non attacca).
    def attack_order(uid)
      declaration = @declarations[uid]
      declaration && declaration[:kind] == "attack" ? declaration[:order] : 0
    end

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
      blockers_of(attacker_uid).first
    end

    # Tutti quelli che fermano quell'attaccante, nell'ordine in cui l'hanno
    # dichiarato (§8.2, «può essere bloccata da più Entità», RBF-014).
    def blockers_of(attacker_uid)
      @declarations.select { |from, d| d[:to] == attacker_uid && %w[block counter].include?(d[:kind]) && on_field?(from) }
                   .map { |from, d| [from, d[:kind]] }
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

    # Gli uid delle prime `count` carte del mazzo di un posto (§8.2, sguardi).
    def top_of_deck(seat, count)
      pile(seat, "deck").first(count).map { |card| @cards.key(card) }
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
        @players[seat][:sealed] = Array(player["sealed"]).select { |id| id.is_a?(String) }
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
                        controller: SEATS.include?(card["controller"]) ? card["controller"] : nil,
                        grants: Array(card["grants"]).select { |keyword| keyword.is_a?(String) },
                        stasis: card["stasis"] == true,
                        held_by: card["heldBy"].is_a?(String) ? card["heldBy"] : nil,
                        target: card["target"].is_a?(String) ? card["target"] : nil,
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
          player[:sealed] = Array(patch["sealed"]).select { |id| id.is_a?(String) } if patch.key?("sealed")
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
        # §3.1 — il flip verso il Nexus: la faccia cambia, lo scarto del
        # requisito va nell'Abisso, i PV recuperano quanto stampato — e la
        # copia annota il turno del flip («quando flippa»). Gemello: state.ts.
        card = @cards[action["uid"]]
        if card
          card[:face] = action["face"].to_i
          card[:flipped] = @turn
          to_zone({ "uid" => action["discard"], "zone" => "abisso" }) if action["discard"].is_a?(String) && @cards.key?(action["discard"])
          player = @players[card[:owner]]
          player[:hp] += action["recover"] if player && action["recover"].is_a?(Integer)
        end
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
      when "look" then look(action)
      when "control"
        # §8.2 — il controllo: chi comanda cambia, la proprietà no; le parole
        # chiave concesse durano fino a fine turno; entrando sul campo di chi
        # la controlla, la carta «entra» ora (i suoi effetti d'ingresso si
        # applicano, e l'attesa di evocazione riparte).
        card = @cards[action["uid"]]
        if card && card[:zone] == "field" && SEATS.include?(action["by"])
          card[:controller] = action["by"]
          card[:grants] = Array(action["grants"]).select { |keyword| keyword.is_a?(String) }
          card[:entered] = @turn
        end
      when "release"
        # §8.2 — la restituzione: controllo e concessioni cadono; in Zona di
        # Ritiro, o sul Fronte del proprietario com'è. Vale anche per il
        # permanente esiliato «finché questa carta resta in gioco» (RBF-018):
        # dall'Abisso torna in gioco. Gemello: state.ts.
        card = @cards[action["uid"]]
        if card
          card[:controller] = nil
          card[:grants] = nil
          card[:held_by] = nil
          if action["zone"] == "ritiro"
            to_zone({ "uid" => action["uid"], "zone" => "ritiro" })
          elsif card[:zone] != "field"
            to_zone({ "uid" => action["uid"], "zone" => "field", "y" => action["y"] })
          elsif action["y"].is_a?(Numeric)
            card[:row] = action["y"]
          end
        end
      when "empower"
        # §8.2 — un potenziamento fino alla fine del turno. Gemello: state.ts.
        card = @cards[action["uid"]]
        if card && card[:zone] == "field"
          card[:power_bonus] = (card[:power_bonus] || 0) + action["power"] if action["power"].is_a?(Integer)
          # «Contrattacco +1 fino alla fine del turno» (RBF-020).
          card[:counter_bonus] = (card[:counter_bonus] || 0) + action["counter"] if action["counter"].is_a?(Integer)
          granted = Array(action["grants"]).select { |keyword| keyword.is_a?(String) }
          card[:grants] = (Array(card[:grants]) + granted).uniq unless granted.empty?
          card[:cannot_block] = true if action["restrict"] == "block"
          # «Stappa un'Entità» (RBF-016, RBF-020): stappata da un effetto,
          # anche dalla Stasi (§8.1: «torna un'Entità normale»).
          untap!(card) if action["untap"] == true
        end
      when "refresh"
        # §8.2 (RBF-011) — stappa chi `seat` comanda; la Fase di Fronte
        # addizionale è dovuta col tiro giusto. Gemello: state.ts.
        @cards.each_value do |card|
          untap!(card) if card[:zone] == "field" && controller_of(card) == action["seat"]
        end
        @extra_front = true if action["extra"] == true
      when "phase"
        if action["phase"] == "fronte" && @phase == "reazione" && @extra_front
          # La Fase di Fronte addizionale: si torna al Fronte a frecce
          # sgombre, e la promessa si consuma.
          @extra_front = false
          @declarations = {}
        end
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
          @rolls = {}
          @extra_front = false
          @cards.each_value do |card|
            # «Fino alla fine del turno» (§8.2): bonus, divieti e parole chiave
            # concesse (non dal controllo) cadono per tutti.
            card[:power_bonus] = nil
            card[:counter_bonus] = nil
            card[:cannot_block] = nil
            card[:grants] = nil unless card[:controller]
            next unless card[:owner] == @active && card[:zone] == "field"

            # La Stasi è una tappata permanente (§8.1): il turno non la stappa.
            card[:tapped] = false unless card[:stasis]
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
          # §6.1: la Pesca del turno, «non si salta mai» — come nel riduttore.
          draw({ "seat" => @active, "count" => 1 })
        end
      end
    end

    private

    # Stappata da un effetto: anche la Stasi cade (§8.1). Gemello: state.ts.
    def untap!(card)
      card[:tapped] = false
      card[:stasis] = nil
    end

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
                                assigned_to: card["assignedTo"].is_a?(String) ? card["assignedTo"] : nil,
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
      @last_wave[action["seat"]] = attackers_in_order if SEATS.include?(action["seat"])
      Array(action["battles"]).each do |battle|
        next unless battle.is_a?(Hash)

        # Con più bloccanti (RBF-014) lo stesso attaccante ha più battaglie:
        # muore una volta sola.
        to_zone({ "uid" => battle["attacker"], "zone" => "abisso" }) if battle["attackerDies"] == true && on_field?(battle["attacker"])
        if battle["blocker"] && on_field?(battle["blocker"])
          blocker = @cards[battle["blocker"]]
          if battle["blockerStasis"] == true
            # §8.1 — la Stasi: invece di morire resta in campo, tappata per
            # sempre (e lo stato di stasi sostituisce la copertura).
            blocker[:stasis] = true
            blocker[:tapped] = true
            blocker[:facedown] = false
            blocker[:covered_turn] = nil
          elsif battle["blockerDies"] == true || battle["blockerSpent"] == true
            # Muore, o — Reattiva giocata come blocco (§6.4) — si consuma.
            to_zone({ "uid" => battle["blocker"], "zone" => "abisso" })
          end
        end
        damage += battle["damage"].to_i
      end
      # §8.2 — «stappala dopo il combattimento» (RBF-028). Gemello: state.ts.
      Array(action["untap"]).each do |uid|
        card = @cards[uid]
        card[:tapped] = false if card && card[:zone] == "field"
      end
      @declarations = {}
      # I danni degli attacchi non bloccati scendono sui PV del difensore,
      # mai sotto zero — come nel riduttore.
      foe = SEATS.find { |seat| seat != action["seat"] }
      @players[foe][:hp] = [0, @players[foe][:hp] - damage].max if foe && SEATS.include?(action["seat"])
    end

    # §8.2 — lo sguardo nel mazzo (la forma di RBF-006): le prime N; la
    # rivelata in fondo alla mano, le altre in fondo al mazzo nell'ordine in
    # cui stavano. Gemello: state.ts, look.
    def look(action)
      seat = action["seat"]
      looked = pile(seat, "deck").first(action["count"].to_i)
      return if looked.empty?

      hand = pile(seat, "hand")
      hand_order = hand.empty? ? 0 : hand.last[:order] + 1
      deck = pile(seat, "deck")
      bottom = deck.last[:order] + 1
      # Dove va la mostrata (`revealTo`, di regola in mano) e dove vanno le
      # altre (`restTo`, di regola in fondo al mazzo): RBF-031 manda la
      # mostrata in Ritiro, RBF-034 le altre. Gemello: state.ts, look.
      reveal_to = action["revealTo"] == "ritiro" ? "ritiro" : "hand"
      rest_to = action["restTo"] == "ritiro" ? "ritiro" : "deck"
      to_retire_top = lambda do |card|
        top = pile(seat, "ritiro").first
        card[:zone] = "ritiro"
        card[:order] = top ? top[:order] - 1 : 0
        card[:facedown] = false
      end
      looked.each do |card|
        if action["reveal"] && @cards[action["reveal"]].equal?(card)
          if reveal_to == "ritiro"
            to_retire_top.call(card)
          else
            card[:zone] = "hand"
            card[:order] = hand_order
            card[:facedown] = false
          end
          next
        end
        if action["retire"] && @cards[action["retire"]].equal?(card)
          # In cima alla Zona di Ritiro, scoperta (RBF-027).
          to_retire_top.call(card)
          next
        end
        if rest_to == "ritiro"
          to_retire_top.call(card)
          next
        end
        card[:order] = bottom
        bottom += 1
      end
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
      # Chi lo tiene fermo nell'Abisso (RBF-018): lo dice lo spostamento che
      # ce lo manda; ogni altro spostamento lo scioglie. Gemello: state.ts.
      card[:held_by] = action["heldBy"].is_a?(String) && zone == "abisso" ? action["heldBy"] : nil
      if zone == "field"
        card[:order] = 0
        card[:row] = action["y"] if action["y"].is_a?(Numeric)
        # Un Oggetto che torna già assegnato (§8.2, RBF-031). Gemello: state.ts.
        card[:assigned_to] = action["assignTo"] if action["assignTo"].is_a?(String) && @cards.key?(action["assignTo"])
        # Il bersaglio dichiarato giocando la carta (RBF-021: lo sconto lo
        # decide lui, e l'effetto deve colpire lui). Gemello: state.ts.
        card[:target] = action["target"].is_a?(String) ? action["target"] : nil
        return
      end
      card[:row] = nil
      card[:target] = nil
      card[:stasis] = nil
      card[:counter_bonus] = nil

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
