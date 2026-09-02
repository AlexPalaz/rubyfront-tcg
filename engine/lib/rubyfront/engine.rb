# frozen_string_literal: true

require_relative "table"

module Rubyfront
  # L'arbitro del gioco. Cresce un punto alla volta: ogni regola del MANUALE
  # collegata entra nella lista RULES e nel giudizio.
  #
  # Il contratto dei verdetti:
  #
  #   - `ruled: false` — "non ho una regola per questa azione": il simulatore
  #     la applica come sempre.
  #   - `ruled: true, ok: true`  — la regola c'è e l'azione la rispetta.
  #   - `ruled: true, ok: false` — l'azione viola la regola: `reason` spiega
  #     perché. Il simulatore la FERMA (l'engine è poliziotto, non consigliere).
  #
  # Due canali, per tenere la copia del tavolo allineata ai client:
  #
  #   - `judge`   — giudizio PREVENTIVO su un'azione locale: il client la
  #     applica solo col sì, quindi anche la copia qui la applica solo col sì.
  #   - `observe` — occhiata su un'azione GIÀ applicata altrove (quelle
  #     dell'avversario): la copia la segue comunque, il verdetto serve solo
  #     ad annotare la violazione.
  #
  # Niente I/O qui dentro: puro stato e giudizio, così i test interrogano la
  # classe direttamente e il trasporto (bin/server) resta un dettaglio.
  class Engine
    VERSION = "0.12.0"

    # Le regole collegate, per nome (i § del MANUALE man mano che entrano).
    # La lista viaggia nel saluto: il client può mostrare cosa è attivo.
    RULES = [
      "§3.2 Flusso: limite 20",
      "§6.5 Mano: massimo 7 a fine turno",
      "§6.2 Attesa di evocazione",
      "§6.3 Dichiarazioni: tappate, coperte, sfide 1 contro 1",
      "§6.2 Fronte: massimo 5 Entità",
      "§3.1/§3.2 Contatori: mai sotto zero",
      "§3.1 Oggetti: assegnazione",
      "§6 Fasi: le dichiarazioni in Fase di Fronte",
      "§6.2 Ritiro: gesto di Preparazione, mai nel turno d'ingresso",
      "§5 Materie: mai sugli slot del Fronte",
      "§6.3 Dichiarano solo le Entità (il Rubyfront mai)",
      "§6.3 Attacca chi è di turno, blocca chi difende",
    ].freeze

    # La geometria canonica degli slot del Fronte, specchio di ctx.ts
    # (FRONT_SLOT_X e frontRowY): coordinate CONDIVISE, le stesse sulle due
    # lavagne e nelle azioni di rete. Entrano nel giudizio solo come forma
    # dell'AZIONE — la copia del tavolo continua a non tracciare geometria.
    FRONT_SLOT_X = [442, 821, 1199, 1578, 1956].freeze
    FRONT_ROW_Y = [172, 1236].freeze

    # `cards` è l'anagrafe id -> {type:, keywords:} (vedi card_index.rb):
    # arriva dal trasporto già pronta — qui dentro niente I/O. Senza anagrafe
    # le regole che leggono le carte restano mute, mai moleste.
    def initialize(cards: {})
      @cards = cards
      @table = Table.new
    end

    # Risposta al saluto del client.
    def hello
      { t: "engine", version: VERSION, rules: RULES }
    end

    def judge(action)
      verdict = verdict_for(action)
      @table.apply(action) unless verdict[:ruled] && !verdict[:ok]
      verdict
    end

    def observe(action)
      verdict = verdict_for(action)
      @table.apply(action)
      verdict
    end

    # Lo stato intero del client: sostituisce la copia del tavolo. Arriva
    # quando l'engine si collega a partita in corso o quando il client si
    # riallinea dalla rete.
    def snapshot(state)
      @table.load(state)
      nil
    end

    private

    def verdict_for(action)
      return no_rule(nil) unless action.is_a?(Hash)

      case action["t"]
      when "player" then judge_player(action)
      when "turn" then judge_turn(action)
      when "phase" then judge_phase(action)
      when "declare" then judge_declare(action)
      when "toZone" then judge_to_zone(action)
      when "assign" then judge_assign(action)
      else no_rule(action["t"])
      end
    end

    # §3.1 — l'assegnazione di un Oggetto: solo alle PROPRIE Entità (salvo
    # carte che dicano altrimenti — arriveranno con le licenze), mai al
    # Rubyfront o al Nexus, mai a una coperta (intoccabile, §6.3), e una
    # volta assegnato l'Oggetto non si sposta su un'altra Entità. Lo
    # scioglimento (`to: null`) non è giudicato; carte ignote all'anagrafe,
    # silenzio come sempre.
    def judge_assign(action)
      to = action["to"]
      return no_rule("assign") unless to.is_a?(String)

      object = @table.card(action["uid"])
      target = @table.card(to)
      return no_rule("assign") unless object && target

      object_kind = @cards.dig(object[:card_id], :type)
      target_kind = @cards.dig(target[:card_id], :type)
      return no_rule("assign") unless object_kind == "object" && target_kind

      return refuse("assign", "gli Oggetti non si assegnano al Rubyfront né al Nexus (§3.1, Oggetti)") if target_kind == "rubyfront"
      return refuse("assign", "un Oggetto si assegna a un'Entità (§3.1, Oggetti)") unless target_kind == "entity"
      return refuse("assign", "l'Entità coperta è intoccabile: niente Oggetti finché non si scopre (§3.1, Oggetti)") if target[:facedown]
      return refuse("assign", "gli Oggetti si assegnano solo alle proprie Entità (§3.1, Oggetti)") if target[:owner] != object[:owner]
      if object[:assigned_to] && object[:assigned_to] != to
        return refuse("assign", "una volta assegnato, l'Oggetto non si sposta su un'altra Entità (§3.1, Oggetti)")
      end

      allow("assign")
    end

    # I movimenti fra zone con una regola: l'INGRESSO in campo (§6.2, Fronte
    # pieno) e il RITIRO (§6.2, Ritiro). Tutto il resto — mano, pile, mazzo —
    # resta senza regola, come sempre.
    def judge_to_zone(action)
      card = @table.card(action["uid"])
      return no_rule("toZone") unless card

      case action["zone"]
      when "field" then judge_enter_field(card, action)
      when "ritiro" then judge_retire(card)
      else no_rule("toZone")
      end
    end

    # §6.2 — «Sul Fronte si possono avere al massimo 5 Entità»: la sesta non
    # scende, da qualunque via arrivi (giocata o effetto — «quella parte
    # dell'effetto non si applica»). Contano solo le Entità del proprietario:
    # Rubyfront, Materie permanenti e Oggetti non occupano slot, e a dirlo è
    # l'anagrafe — carta ignota o anagrafe assente, silenzio. Il campo del
    # simulatore è una superficie unica, ma le Entità in campo SONO il Fronte:
    # non hanno altro posto dove stare.
    def judge_enter_field(card, action)
      # Un toZone che resta sul campo è uno spostamento, non un ingresso.
      return no_rule("toZone") if card[:zone] == "field"

      known = @cards[card[:card_id]]
      return no_rule("toZone") unless known

      # §5 — «Le Materie non si giocano sugli slot del Fronte»: gli slot sono
      # delle Entità, le Materie hanno la loro fila dietro. Si guardano le
      # coordinate dell'azione: l'aggancio del rilascio porta ESATTAMENTE
      # quelle degli slot, e sono le sole che contano — un rilascio a mano
      # libera lì vicino non è «sullo slot». Materia già in campo che si
      # sposta: affare della lavagna, non di questa regola.
      if known[:type] == "matter" && FRONT_SLOT_X.include?(action["x"]) && FRONT_ROW_Y.include?(action["y"])
        return refuse("toZone", "le Materie non si giocano sugli slot del Fronte: si posano nello spazio delle Materie (§5)")
      end

      return no_rule("toZone") unless known[:type] == "entity"

      on_front = @table.field_cards(card[:owner]).count do |other|
        entry = @cards[other[:card_id]]
        entry && entry[:type] == "entity"
      end
      if on_front >= 5
        refuse("toZone", "il Fronte è pieno: cinque Entità sono il massimo (§6.2, Fronte pieno)")
      else
        allow("toZone")
      end
    end

    # §6.2 — il Ritiro: un gesto di PREPARAZIONE sulle PROPRIE Entità
    # stappate e scoperte, mai nel turno d'ingresso — e lo Slancio non aggira
    # il divieto (permette di attaccare subito, non di essere ritirata
    # subito). Si giudica solo l'Entità del posto attivo che parte dal campo:
    # una carta AVVERSARIA mandata in Ritiro nel turno di un altro è quasi
    # sempre un effetto risolto a mano («metti un'Entità avversaria nella
    # Zona di Ritiro…») e non si accusa. Limite dichiarato: un effetto che
    # ritiri una PROPRIA Entità aggirando i vincoli verrebbe fermato a torto
    # — arriverà con la regola d'oro. Il Rubyfront invece non si ritira mai:
    # per lui esiste il richiamo volontario, che è un'altra cosa.
    def judge_retire(card)
      return no_rule("toZone") unless card[:zone] == "field"

      kind = @cards.dig(card[:card_id], :type)
      return refuse("toZone", "il Rubyfront non si ritira: ha il richiamo volontario (§3.1)") if kind == "rubyfront"
      return no_rule("toZone") unless kind == "entity"
      return no_rule("toZone") if card[:owner] != @table.active

      if @table.phase == "fronte"
        return refuse("toZone", "il ritiro è un gesto di Preparazione: a Fronte dichiarato non si ritira (§6.2, Ritiro)")
      end
      if card[:facedown]
        return refuse("toZone", "l'Entità coperta è intoccabile: non si ritira finché non si scopre (§6.2, Ritiro)")
      end
      if card[:tapped]
        return refuse("toZone", "un'Entità tappata è impegnata: si ritira quando si stappa (§6.2, Ritiro)")
      end
      if card[:entered] == @table.turn
        return refuse("toZone", "l'Entità è entrata in campo questo turno: si ritira dal prossimo — lo Slancio non aggira il divieto (§6.2, Ritiro)")
      end

      allow("toZone")
    end

    # I contatori di un posto, giudicati dalla sola patch (valori assoluti,
    # niente tavolo da guardare):
    #
    # §3.2 — «Il Flusso non può mai superare 20 in nessun modo». L'unica
    # eccezione è il Gettone: la sua spesa arriva come `token: false` nella
    # stessa patch, ed è il solo caso in cui si tocca 21.
    #
    # §3.1/§3.2 — sotto zero non scende niente: i PV si fermano a 0 (a 0 si
    # perde, ma sotto non si va) e il Flusso speso non può superare quello
    # che c'è.
    def judge_player(action)
      patch = action["patch"]
      return no_rule("player") unless patch.is_a?(Hash)

      hp = patch["hp"]
      flux = patch["flux"]
      flux_max = patch["fluxMax"]
      # Le regole parlano solo dei contatori: una patch che non li tocca
      # (nome, mazzo, Gettone da solo) non è giudicata.
      return no_rule("player") unless hp.is_a?(Numeric) || flux.is_a?(Numeric) || flux_max.is_a?(Numeric)

      return refuse("player", "i PV non scendono sotto 0: a 0 la partita è persa (§3.1)") if hp.is_a?(Numeric) && hp.negative?
      if (flux.is_a?(Numeric) && flux.negative?) || (flux_max.is_a?(Numeric) && flux_max.negative?)
        return refuse("player", "il Flusso non scende sotto 0 (§3.2)")
      end

      cap = patch["token"] == false ? 21 : 20
      if flux.is_a?(Numeric) && flux > cap
        return refuse("player", cap == 21 ? "nemmeno col Gettone il Flusso supera 21 (§3.2)" : "il Flusso non supera mai 20 (§3.2); solo il Gettone speso arriva a 21")
      end
      return refuse("player", "la barra del Flusso non supera 20 (§3.2)") if flux_max.is_a?(Numeric) && flux_max > 20

      allow("player")
    end

    # §6.5 — «Non si possono avere più di 7 carte in mano: alla fine del
    # proprio turno, le carte in eccesso vanno scartate». La regola è di
    # CHIUSURA, non un divieto continuo: pescare all'ottava carta a metà
    # turno è legale — è il Fine turno che non passa finché non si è
    # scartato. Un fine turno è un'azione `turn` che CAMBIA il posto attivo:
    # il contatore ritoccato a mano (active invariato) non è giudicato.
    def judge_turn(action)
      return no_rule("turn") unless Table::SEATS.include?(action["active"]) && action["active"] != @table.active

      held = @table.hand_count(@table.active)
      if held > 7
        refuse("turn", "chi chiude il turno ha #{held} carte in mano: prima scarta fino a 7 (§6.5)")
      else
        allow("turn")
      end
    end

    # §6 — la fase è a senso unico: dalla Preparazione si dichiara il Fronte,
    # e in Preparazione si torna solo col cambio di turno. Valore ignoto:
    # nessuna regola, mai molesto.
    def judge_phase(action)
      phase = action["phase"]
      return no_rule("phase") unless Table::PHASES.include?(phase)

      if phase == "preparazione" && @table.phase == "fronte"
        refuse("phase", "la fase è a senso unico: in Preparazione si torna col cambio di turno (§6)")
      else
        allow("phase")
      end
    end

    # Le dichiarazioni di combattimento passano TRE dogane, nell'ordine:
    #
    # §6 — il tempismo: attacchi, blocchi e contrattacchi vivono in Fase di
    # Fronte. Vale per tutte e tre le dichiarazioni — i blocchi del difensore
    # arrivano dentro la Fase di Fronte dell'attaccante, che la sua
    # dichiarazione ha già portato sul tavolo di entrambi.
    #
    # §6.3 — lo STATO della carta e della sfida, senza bisogno d'anagrafe:
    # la coperta non fa nulla, la tappata non attacca né blocca, e ogni
    # attaccante ha al più un bloccante (sfide 1 contro 1).
    #
    # §6.2 — l'attesa di evocazione, solo per gli attacchi: «un'Entità appena
    # entrata in campo non può attaccare nel turno in cui entra», salvo
    # Slancio (`surge`, §8.1). Qui serve l'anagrafe: carta ignota o anagrafe
    # assente, questa parte tace — l'engine preferisce non accusare a torto.
    # Limite dichiarato: lo Slancio CONCESSO da un effetto (es. RBF-009) non
    # si vede ancora.
    def judge_declare(action)
      declaration = action["declaration"]
      return no_rule("declare") unless declaration.is_a?(Hash)

      kind = declaration["kind"]
      return no_rule("declare") unless %w[attack block counter].include?(kind)

      if @table.phase != "fronte"
        return refuse("declare", "prima si dichiara la Fase di Fronte: le dichiarazioni vivono lì (§6.3)")
      end

      card = @table.card(declaration["from"])
      return no_rule("declare") unless card

      # §3.1/§6.3 — dichiarano solo le Entità: il Rubyfront non attacca e non
      # blocca (la sua funzione sono abilità a costo PV e Materie), e Materie
      # e Oggetti non dichiarano niente — §6.3 parla sempre di Entità. Il
      # tipo si controlla PRIMA dello stato: un Rubyfront tappato non è «una
      # tappata», è un Rubyfront. Carta ignota o anagrafe assente: via
      # libera, mai molesto. Limite dichiarato: la regola d'oro («salvo
      # diversa indicazione sulla carta») non si vede ancora.
      declarer = @cards.dig(card[:card_id], :type)
      if declarer == "rubyfront"
        return refuse("declare", "il Rubyfront non attacca e non blocca (§3.1): la sua funzione sono abilità e Materie")
      end
      if declarer && declarer != "entity"
        return refuse("declare", "solo le Entità attaccano e bloccano (§6.3)")
      end

      # §6.3 — la dogana del POSTO: attacca chi è di turno, blocca chi
      # difende. I blocchi si dichiarano DENTRO il turno dell'attaccante,
      # dall'altra metà del tavolo — per questo il confronto è con `active`,
      # non con una fase del difensore che non esiste.
      if kind == "attack" && card[:owner] != @table.active
        return refuse("declare", "si attacca nel proprio turno (§6.3)")
      end
      if kind != "attack" && card[:owner] == @table.active
        return refuse("declare", "blocca chi difende: i blocchi si dichiarano nel turno dell'attaccante (§6.3)")
      end

      return refuse("declare", "la carta è coperta: finché è coperta non può fare nulla (§6.3)") if card[:facedown]

      if card[:tapped]
        verb = kind == "attack" ? "attaccare" : "bloccare"
        return refuse("declare", "una carta tappata non può #{verb} (§6.3)")
      end

      if kind != "attack"
        # Un blocco vuole un attaccante vero: senza un attacco dichiarato in
        # piedi non c'è niente da fermare, e la freccia non direbbe niente.
        unless @table.attacking?(declaration["to"])
          return refuse("declare", "quella carta non sta attaccando: non c'è niente da bloccare (§6.3)")
        end
        if @table.blocked?(declaration["to"])
          return refuse("declare", "quell'attaccante ha già chi lo ferma (§6.3, sfide 1 contro 1)")
        end

        return allow("declare")
      end

      known = @cards[card[:card_id]]
      return allow("declare") unless known && known[:type] == "entity"
      return allow("declare") if known[:keywords].include?("surge")

      if card[:entered] == @table.turn
        refuse("declare", "l'Entità è entrata in campo questo turno: senza Slancio attacca dal prossimo (§6.2, attesa di evocazione)")
      else
        allow("declare")
      end
    end

    def no_rule(kind)
      { t: "verdict", action: kind, ok: true, ruled: false }
    end

    def allow(kind)
      { t: "verdict", action: kind, ok: true, ruled: true }
    end

    def refuse(kind, reason)
      { t: "verdict", action: kind, ok: false, ruled: true, reason: reason }
    end
  end
end
