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

    attr_reader :active, :turn, :phase

    def initialize
      reset
    end

    def reset
      @cards = {}
      # Le dichiarazioni in corso (§6.3): dichiarante -> {to:, kind:}. Come
      # nel client, una carta dichiara una cosa sola per volta.
      @declarations = {}
      @active = "a"
      @turn = 1
      @phase = "preparazione"
    end

    def hand_count(seat)
      @cards.count { |_, card| card[:owner] == seat && card[:zone] == "hand" }
    end

    # La carta com'è annotata qui: {owner, zone, order, card_id, entered,
    # tapped, facedown} — `entered` è il numero del turno in cui è scesa in
    # campo (nil se non è mai scesa o se arriva da uno snapshot, che quel
    # passato non lo porta).
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
      Array(state["declarations"]).each do |declaration|
        next unless declaration.is_a?(Hash) && declaration["from"]

        @declarations[declaration["from"]] = { to: declaration["to"], kind: declaration["kind"] }
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
                        assigned_to: card["assignedTo"].is_a?(String) ? card["assignedTo"] : nil }
      end
    end

    def apply(action)
      return unless action.is_a?(Hash)

      case action["t"]
      when "newGame" then reset
      when "loadDeck" then load_deck(action)
      when "shuffle" then shuffle(action)
      when "draw" then draw(action)
      when "toZone" then to_zone(action)
      when "tap"
        card = @cards[action["uid"]]
        card[:tapped] = action["tapped"] == true if card
      when "facedown"
        card = @cards[action["uid"]]
        card[:facedown] = action["facedown"] == true if card
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
          @declarations[declaration["from"]] = { to: declaration["to"], kind: declaration["kind"] }
        end
      when "undeclare"
        @declarations.delete(action["from"])
      when "clearCombat"
        @declarations = {}
      when "phase"
        @phase = action["phase"] if PHASES.include?(action["phase"])
      when "turn"
        @turn = action["turn"] if action["turn"].is_a?(Numeric)
        if SEATS.include?(action["active"])
          # Il cambio di turno riporta la fase in Preparazione (§6, a senso
          # unico); il contatore ritoccato a mano (active invariato) no.
          @phase = "preparazione" if action["active"] != @active
          @active = action["active"]
        end
      end
    end

    private

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
                                tapped: card["tapped"] == true, facedown: card["facedown"] == true }
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

    def to_zone(action)
      card = @cards[action["uid"]]
      return unless card

      zone = action["zone"]
      # L'ingresso in campo si annota col turno in corso (§6.2, attesa di
      # evocazione): conta solo il passaggio da fuori a dentro — un toZone
      # che resta sul campo non è un nuovo ingresso.
      card[:entered] = @turn if zone == "field" && card[:zone] != "field"
      card[:zone] = zone
      if zone == "field"
        card[:order] = 0
        return
      end

      # Fuori dal campo la carta si raddrizza e si scopre (come in state.ts),
      # e chi esce esce anche dal combattimento: la sua freccia se ne va, e
      # quella che gli puntava contro pure. Le assegnazioni si sciolgono in
      # entrambi i versi (§3.1: il ritorno in campo è sempre disarmato).
      card[:tapped] = false
      card[:facedown] = false
      card[:assigned_to] = nil
      uid = action["uid"]
      @declarations.reject! { |from, d| from == uid || d[:to] == uid }
      @cards.each_value { |other| other[:assigned_to] = nil if other[:assigned_to] == uid }

      rest = pile(card[:owner], zone).reject { |other| other.equal?(card) }
      card[:order] =
        if action["toBottom"]
          rest.empty? ? 0 : rest.last[:order] + 1
        else
          rest.empty? ? 0 : rest.first[:order] - 1
        end
    end
  end
end
