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
    VERSION = "0.33.0"

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
      "§6.4 Reazione: l'ondata passa al difensore, e la chiude lui",
      "§6.3/§6.4 Risoluzione delle battaglie",
      "§6.2 Le carte si giocano in Preparazione (salvo Reattive e Rubyfront)",
      "§6 Nel turno altrui non si agisce (salvo Reazione e Reattive)",
      "§3.2 Le carte si pagano: il costo di Flusso",
      "§5 Le Entità stanno sugli slot del Fronte",
      "§5/§6.2 Dal campo non si torna in mano né nel mazzo",
      "§7 Le Materie si giocano solo se abilitate",
      "§2/§9 Fine della partita: PV a zero, mazzo esaurito, pareggio",
      "§8.2 Effetti certificati: «quando un'Entità entra, pesca» (RBF-003)",
      "§8.2 Effetti certificati: «quando entra, un'Entità avversaria in Ritiro» (RBF-007)",
      "§8.2 Effetti certificati: «quando entra, una permanente dalla Zona di Ritiro al Fronte» (RBF-012)",
      "§8.2 Effetti certificati: «quando attacca», lo stesso ritorno di Rhen (RBF-012)",
      "§8.2 Effetti certificati: «quando entra, guarda le prime N e mostrane una» (RBF-006)",
      "§8.2 Effetti certificati: «tira un d6, guarda 2 più metà, un Oggetto in mano, una in Ritiro» (RBF-027)",
      "§8.2 Effetti certificati: «quando entra, prendi il controllo di un'Entità avversaria» (RBF-009)",
      "§8.2 Controllo: attacca e blocca chi comanda, e a fine turno si restituisce",
      "§3.1 Il Rubyfront si schiera pagando: costo fisso o a dado",
      "§3.1 Il Rubyfront schierato non torna in Zona di Richiamo",
      "§8.2 Effetti certificati: «quando attacca con un Oggetto, pesca, poi scarta» (RBF-026)",
    ].freeze
    # Le stesse regole in inglese, nello stesso ordine: il saluto le porta
    # entrambe (`rules`, `rules_en`) e il client stampa quelle della sua lingua.
    RULES_EN = [
      "§3.2 Flux: cap of 20",
      "§6.5 Hand: at most 7 at end of turn",
      "§6.2 Summoning wait",
      "§6.3 Declarations: tapped, covered, 1-on-1 challenges",
      "§6.2 Front: at most 5 Entities",
      "§3.1/§3.2 Counters: never below zero",
      "§3.1 Objects: assignment",
      "§6 Phases: declarations in the Front Phase",
      "§6.2 Retire: a Preparation move, never on the turn of entry",
      "§5 Matters: never on the Front slots",
      "§6.3 Only Entities declare (the Rubyfront never)",
      "§6.3 The active player attacks, the defender blocks",
      "§6.4 Reaction: the wave passes to the defender, who closes it",
      "§6.3/§6.4 Battle resolution",
      "§6.2 Cards are played in Preparation (except Reactives and the Rubyfront)",
      "§6 No acting on the opponent's turn (except Reaction and Reactives)",
      "§3.2 Cards are paid for: the Flux cost",
      "§5 Entities sit on the Front slots",
      "§5/§6.2 No going back from the field to hand or deck",
      "§7 Matters are played only when enabled",
      "§2/§9 End of the game: HP at zero, deck exhausted, draw",
      "§8.2 Certified effects: “when an Entity enters, draw” (RBF-003)",
      "§8.2 Certified effects: “when it enters, an opposing Entity to Retire” (RBF-007)",
      "§8.2 Certified effects: “when it enters, a permanent from the Retire Zone to the Front” (RBF-012)",
      "§8.2 Certified effects: “when it attacks”, Rhen's same return (RBF-012)",
      "§8.2 Certified effects: “when it enters, look at the top N and reveal one” (RBF-006)",
      "§8.2 Certified effects: “roll a d6, look at 2 plus half, an Object to hand, one to Retire” (RBF-027)",
      "§8.2 Certified effects: “when it enters, take control of an opposing Entity” (RBF-009)",
      "§8.2 Control: whoever commands attacks and blocks, and returns it at end of turn",
      "§3.1 The Rubyfront is deployed by paying: fixed cost or a die",
      "§3.1 A deployed Rubyfront doesn't go back to the Recall Zone",
      "§8.2 Certified effects: “when it attacks with an Object, draw, then discard” (RBF-026)",
    ].freeze

    # La geometria canonica degli slot del Fronte, specchio di ctx.ts
    # (FRONT_SLOT_X e frontRowY): coordinate CONDIVISE, le stesse sulle due
    # lavagne e nelle azioni di rete. Entrano nel giudizio solo come forma
    # dell'AZIONE — la copia del tavolo continua a non tracciare geometria.
    FRONT_SLOT_X = [442, 821, 1199, 1578, 1956].freeze
    # [fila del posto B (in alto), fila del posto A (in basso)] — canonico.
    FRONT_ROW_Y = [172, 1236].freeze

    # I nomi delle Materie (§7.1), per i sigilli.
    MATTER_NAMES = {
      "dynamic" => "Dinamica", "dimensional" => "Dimensionale", "destructive" => "Distruttiva",
      "zero" => "Zero", "dominant" => "Dominante",
    }.freeze
    MATTER_NAMES_EN = {
      "dynamic" => "Dynamic", "dimensional" => "Dimensional", "destructive" => "Destructive",
      "zero" => "Zero", "dominant" => "Dominant",
    }.freeze

    # `cards` è l'anagrafe id -> {type:, keywords:} (vedi card_index.rb):
    # arriva dal trasporto già pronta — qui dentro niente I/O. Senza anagrafe
    # le regole che leggono le carte restano mute, mai moleste.
    def initialize(cards: {})
      @cards = cards
      @table = Table.new
    end

    # Risposta al saluto del client.
    def hello
      { t: "engine", version: VERSION, rules: RULES, rules_en: RULES_EN }
    end

    # `actor` è il posto di chi ha compiuto il gesto — lo dice il trasporto
    # (in rete il posto del client, in partita locale il proprietario della
    # carta o del contatore toccato). Senza attore la dogana del turno tace.
    def judge(action, actor: nil)
      verdict = verdict_for(action, actor)
      return verdict if verdict[:ruled] && !verdict[:ok]

      @table.apply(action)
      settle_effect(action)
      verdict
    end

    def observe(action, actor: nil)
      verdict = verdict_for(action, actor)
      @table.apply(action)
      settle_effect(action)
      verdict
    end

    # Un passo d'effetto applicato consuma il suo innesco (§8.2): una volta
    # per coppia fonte/ingresso, finché dura il turno.
    def settle_effect(action)
      ref = action.is_a?(Hash) ? action["effect"] : nil
      return unless ref.is_a?(Hash) && ref["source"] && ref["entering"]

      # Il passo che segue un innesco (lo scarto dopo la pesca, RBF-026) ha
      # la sua tripla: `follow` distingue il seguito dall'innesco.
      @table.fire(ref["source"], fired_event(ref), ref["entering"])
    end

    def fired_event(ref)
      ref["follow"].is_a?(String) ? "#{ref["event"]}:#{ref["follow"]}" : ref["event"]
    end

    # Lo stato intero del client: sostituisce la copia del tavolo. Arriva
    # quando l'engine si collega a partita in corso o quando il client si
    # riallinea dalla rete.
    def snapshot(state)
      @table.load(state)
      nil
    end

    private

    def verdict_for(action, actor = nil)
      return no_rule(nil) unless action.is_a?(Hash)

      # §2/§9 — a partita finita il tavolo si ferma: restano Nuova partita,
      # la chat, i pixel e il carico del mazzo (che segue la nuova partita).
      if @table.over? && !%w[newGame say move loadDeck].include?(action["t"])
        return refuse(action["t"], "la partita è finita: Nuova partita per ricominciare (§2)", "the game is over: New game to start again (§2)")
      end

      stopped = judge_actor(action, actor)
      return stopped if stopped

      # §8.2 / §1.1 — un passo d'effetto: la carta vince sulle regole, se la
      # forma è quella certificata. Verificato, passa come effetto; se no
      # è fermato — un effetto finto non è un gesto qualunque.
      return judge_effect(action) if action["effect"].is_a?(Hash)

      case action["t"]
      when "player" then judge_player(action)
      when "turn" then judge_turn(action)
      when "phase" then judge_phase(action)
      when "declare" then judge_declare(action)
      when "toZone" then judge_to_zone(action)
      when "assign" then judge_assign(action)
      when "resolve" then judge_resolve(action)
      when "move" then judge_move(action)
      when "release" then judge_release(action)
      when "gameOver" then judge_game_over(action)
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

      return refuse("assign", "gli Oggetti non si assegnano al Rubyfront né al Nexus (§3.1, Oggetti)", "Objects can't be assigned to the Rubyfront or the Nexus (§3.1, Objects)") if target_kind == "rubyfront"
      return refuse("assign", "un Oggetto si assegna a un'Entità (§3.1, Oggetti)", "an Object is assigned to an Entity (§3.1, Objects)") unless target_kind == "entity"
      return refuse("assign", "l'Entità coperta è intoccabile: niente Oggetti finché non si scopre (§3.1, Oggetti)", "a covered Entity is untouchable: no Objects until it's uncovered (§3.1, Objects)") if target[:facedown]
      return refuse("assign", "gli Oggetti si assegnano solo alle proprie Entità (§3.1, Oggetti)", "Objects are assigned only to your own Entities (§3.1, Objects)") if target[:owner] != object[:owner]
      if object[:assigned_to] && object[:assigned_to] != to
        return refuse("assign", "una volta assegnato, l'Oggetto non si sposta su un'altra Entità (§3.1, Oggetti)", "once assigned, an Object doesn't move to another Entity (§3.1, Objects)")
      end

      allow("assign")
    end

    # I movimenti fra zone con una regola: l'INGRESSO in campo (§6.2, Fronte
    # pieno) e il RITIRO (§6.2, Ritiro). Tutto il resto — mano, pile, mazzo —
    # resta senza regola, come sempre.
    def judge_to_zone(action)
      card = @table.card(action["uid"])
      return no_rule("toZone") unless card

      # §5/§6.2 — dal campo non si torna in mano né nel mazzo: dal campo si
      # esce con il Ritiro (§6.2), con l'Abisso, o con un effetto — e il
      # Rubyfront schierato resta in campo (§3.1). Vale per tutti
      # i posti. Limite dichiarato: un effetto «rimetti in mano» verrebbe
      # fermato a torto (regola d'oro).
      if card[:zone] == "field" && %w[hand deck].include?(action["zone"])
        where = action["zone"] == "hand" ? "in mano" : "nel mazzo"
        where_en = action["zone"] == "hand" ? "to hand" : "to the deck"
        return refuse("toZone", "una carta in campo non torna #{where}: dal campo si esce con il Ritiro, l'Abisso o un effetto (§5, §6.2)", "a card on the field doesn't go back #{where_en}: the field is left through Retire, the Abyss or an effect (§5, §6.2)")
      end

      case action["zone"]
      when "field" then judge_enter_field(card, action)
      when "ritiro" then judge_retire(card)
      else no_rule("toZone")
      end
    end

    # §5 — «i 5 slot del Fronte»: con l'arbitro la lavagna non è libera, e
    # un'Entità che si sposta sul campo va su uno slot della propria fila.
    # Si guarda la FORMA dell'azione, come per le Materie: la copia del
    # tavolo continua a non tracciare geometria, e l'occupazione dello slot
    # è affare della lavagna (che con l'arbitro sceglie da sé un posto
    # libero). Coordinate assenti: niente da giudicare.
    def judge_move(action)
      card = @table.card(action["uid"])
      return no_rule("move") unless card && card[:zone] == "field"

      kind = @cards.dig(card[:card_id], :type)
      return judge_deploy(card, action) if kind == "rubyfront"
      return no_rule("move") unless kind == "entity"

      on_slot?(card, action) ? allow("move") : refuse("move", "le Entità stanno sugli slot del Fronte, nella propria fila (§5)", "Entities sit on the Front slots, in their own row (§5)")
    end

    # §3.1 — lo schieramento del Rubyfront si paga: dalla Zona di Richiamo
    # (fila di servizio) alla sua fila, «il costo si paga identico a ogni
    # schieramento» — fisso, o un dado: «si può lanciare solo se il Flusso
    # disponibile copre il risultato peggiore», Gettone compreso, e si paga
    # il numero uscito. Il costo e il tiro viaggiano nell'azione: qui si
    # verifica la forma — costo uguale allo stampato, tiro fra 1 e le facce,
    # costo uguale al tiro — non la fortuna, come un arbitro con un dado
    # tirato sul tavolo. Gli spostamenti sulla stessa fila sono liberi;
    # fila ignota vale «non schierato»; senza costo in anagrafe, silenzio.
    def judge_deploy(card, action)
      y = action["y"]
      return no_rule("move") unless y.is_a?(Numeric)

      deployed = card[:row] && FRONT_ROW_Y.include?(card[:row])
      # §3.1 — «il Rubyfront, una volta schierato, non torna in Zona di
      # Richiamo»: non per PV, non per scelta. Solo una carta può riportarlo
      # (regola d'oro) — limite dichiarato: quell'effetto, risolto a mano,
      # verrebbe fermato a torto.
      if deployed && !FRONT_ROW_Y.include?(y)
        return refuse("move", "il Rubyfront schierato non torna in Zona di Richiamo: resta in campo, salvo che una carta lo dica (§3.1)", "a deployed Rubyfront doesn't go back to the Recall Zone: it stays on the field, unless a card says so (§3.1)")
      end

      deploying = FRONT_ROW_Y.include?(y) && !deployed
      return no_rule("move") unless deploying

      deployment = @cards.dig(card[:card_id], :deployment)
      return no_rule("move") unless deployment

      paid = action["cost"]
      available = @table.available(card[:owner])
      if deployment[:die]
        faces = deployment[:die]
        if available < faces
          return refuse("move", "il d#{faces} non si tira: servono #{faces} Flussi disponibili per coprire ogni faccia, ne hai #{available} (§3.1)", "the d#{faces} can't be rolled: it takes #{faces} available Flux to cover every face, you have #{available} (§3.1)")
        end
        roll = action["roll"]
        unless roll.is_a?(Integer) && roll.between?(1, faces)
          return refuse("move", "il Rubyfront si schiera tirando il d#{faces}: l'azione non porta un tiro valido (§3.1)", "the Rubyfront is deployed by rolling the d#{faces}: the action carries no valid roll (§3.1)")
        end
        return refuse("move", "si paga il numero uscito: #{roll}, non #{paid.is_a?(Integer) ? paid : 0} (§3.1)", "you pay the number rolled: #{roll}, not #{paid.is_a?(Integer) ? paid : 0} (§3.1)") unless paid == roll
      else
        fixed = deployment[:fixed]
        unless paid == fixed
          return refuse("move", "il Rubyfront si schiera pagando #{fixed} di Flusso, l'azione ne paga #{paid.is_a?(Integer) ? paid : 0} (§3.1)", "the Rubyfront is deployed by paying #{fixed} Flux, the action pays #{paid.is_a?(Integer) ? paid : 0} (§3.1)")
        end
        if available < fixed
          return refuse("move", "Flusso insufficiente: ne hai #{available}, lo schieramento costa #{fixed} (§3.1)", "not enough Flux: you have #{available}, the deployment costs #{fixed} (§3.1)")
        end
      end

      allow("move")
    end

    def on_slot?(card, action)
      x = action["x"]
      y = action["y"]
      return true unless x.is_a?(Numeric) && y.is_a?(Numeric)

      FRONT_SLOT_X.include?(x) && y == FRONT_ROW_Y[Table::SEATS.index(card[:owner]) == 0 ? 1 : 0]
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

      # §6.2 — le carte si GIOCANO in Preparazione: «in questa fase si inizia
      # a giocare con le carte e si prepara il Fronte». Nel Fronte si
      # dichiara, nella Reazione si difende. Due eccezioni del manuale: le
      # Materie Reattive, che «si giocano solo in Fase di Fronte» (§7.2), e
      # il Rubyfront, che si schiera «in qualsiasi momento del proprio
      # turno» (§3.1). Vale per entrambi i posti: nel turno altrui
      # non è Preparazione di nessuno. Limite dichiarato: gli effetti che
      # mettono in campo una carta durante il combattimento verrebbero
      # fermati a torto (arriveranno con la regola d'oro).
      reactive = known[:type] == "matter" && known[:behavior] == "reactive"
      if @table.phase != "preparazione"
        playable = known[:type] == "rubyfront" || reactive
        unless playable
          phase = @table.phase == "fronte" ? "Fronte" : "Reazione"
          phase_en = @table.phase == "fronte" ? "Front" : "Reaction"
          return refuse("toZone", "in Fase di #{phase} si dichiara, non si gioca: le carte scendono in Preparazione (§6.2) — salvo le Reattive (§7.2) e il Rubyfront (§3.1)", "in the #{phase_en} Phase you declare, you don't play: cards come down in Preparation (§6.2) — except Reactives (§7.2) and the Rubyfront (§3.1)")
        end
      elsif reactive
        # E il rovescio: una Reattiva in Preparazione è fuori dalla sua
        # finestra, di chiunque sia il turno.
        return refuse("toZone", "le Reattive si giocano solo in Fase di Fronte (§7.2)", "Reactives are played only in the Front Phase (§7.2)")
      end

      # §7 — «una carta Materia è giocabile solo se in campo c'è una carta
      # che ha quel tipo di Materia abilitato», al grado richiesto (§7.1).
      # Abilita una PROPRIA carta in campo, non coperta (la tappata abilita
      # normalmente, §6.3), con la faccia che mostra: il Nexus abilita solo
      # ciò che è stampato su di lui. Il Rubyfront abilita solo schierato:
      # in Zona di Richiamo (fila di servizio) non abilita nulla (§3.1) —
      # è la sola ragione per cui la copia del tavolo annota la fila. Vale
      # giocando dalla mano; Materia senza etichetta o fila ignota: nel
      # dubbio non si accusa. Limiti dichiarati: l'attribuzione (§7, quale
      # abilitante) non si sceglie, e il decadere delle permanenti (§7.2)
      # arriverà a parte.
      if card[:zone] == "hand" && known[:type] == "matter" && known[:matter] && !enabled?(card[:owner], known[:matter])
        label = known[:matter]
        name = "Materia #{MATTER_NAMES.fetch(label[:type], label[:type])}"
        name += " di grado #{label[:grade]}" if label[:grade]
        name_en = "#{MATTER_NAMES_EN.fetch(label[:type], label[:type])} Matter"
        name_en += " of grade #{label[:grade]}" if label[:grade]
        return refuse("toZone", "nessuna carta in campo abilita la #{name}: serve un'Entità o il Rubyfront schierato che la abiliti (§7)", "no card on the field enables the #{name_en}: it takes an Entity or the deployed Rubyfront that enables it (§7)")
      end

      # §3.2/§6.2 — le carte si pagano: «il solo vincolo è il Flusso
      # disponibile — Oggetti compresi». Vale giocando DALLA MANO; da altre
      # zone (mazzo, Abisso, Ritiro) una carta torna in campo per effetto, e
      # non si paga. Il costo viaggia nell'azione (`cost`): lo mette il
      # client dal catalogo e qui si verifica contro l'anagrafe — un costo
      # che non torna è fermato come uno che non si può pagare. Il Rubyfront
      # non passa di qui: il suo costo di schieramento può essere un dado, e
      # la regola del tiro pagabile (§3.1) arriverà a parte. Limiti
      # dichiarati: sconti da effetto e carte messe in campo gratis da un
      # effetto verrebbero fermati a torto (regola d'oro).
      cost = known[:flux_cost]
      if card[:zone] == "hand" && cost
        paid = action["cost"]
        unless paid == cost
          return refuse("toZone", "la carta costa #{cost} di Flusso e l'azione ne paga #{paid.is_a?(Integer) ? paid : 0} (§3.2)", "the card costs #{cost} Flux and the action pays #{paid.is_a?(Integer) ? paid : 0} (§3.2)")
        end
        available = @table.available(card[:owner])
        if available < cost
          return refuse("toZone", "Flusso insufficiente: ne hai #{available}, la carta costa #{cost} (§3.2)", "not enough Flux: you have #{available}, the card costs #{cost} (§3.2)")
        end
      end

      # §5 — «Le Materie non si giocano sugli slot del Fronte»: gli slot sono
      # delle Entità, le Materie hanno la loro fila dietro. Si guardano le
      # coordinate dell'azione: l'aggancio del rilascio porta ESATTAMENTE
      # quelle degli slot, e sono le sole che contano — un rilascio a mano
      # libera lì vicino non è «sullo slot». Materia già in campo che si
      # sposta: affare della lavagna, non di questa regola.
      if known[:type] == "matter" && FRONT_SLOT_X.include?(action["x"]) && FRONT_ROW_Y.include?(action["y"])
        return refuse("toZone", "le Materie non si giocano sugli slot del Fronte: si posano nello spazio delle Materie (§5)", "Matters aren't played on the Front slots: they go in the Matters space (§5)")
      end

      return no_rule("toZone") unless known[:type] == "entity"

      on_front = @table.field_cards(card[:owner]).count do |other|
        entry = @cards[other[:card_id]]
        entry && entry[:type] == "entity"
      end
      return refuse("toZone", "il Fronte è pieno: cinque Entità sono il massimo (§6.2, Fronte pieno)", "the Front is full: five Entities are the maximum (§6.2, Full Front)") if on_front >= 5
      # §5 — e scende su uno slot della propria fila (vedi judge_move).
      return refuse("toZone", "le Entità stanno sugli slot del Fronte, nella propria fila (§5)", "Entities sit on the Front slots, in their own row (§5)") unless on_slot?(card, action)

      allow("toZone")
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
    # una volta schierato resta in campo (§3.1).
    def judge_retire(card)
      return no_rule("toZone") unless card[:zone] == "field"

      kind = @cards.dig(card[:card_id], :type)
      return refuse("toZone", "il Rubyfront non si ritira: una volta schierato resta in campo (§3.1)", "the Rubyfront doesn't retire: once deployed it stays on the field (§3.1)") if kind == "rubyfront"
      return no_rule("toZone") unless kind == "entity"
      return no_rule("toZone") if card[:owner] != @table.active

      if @table.phase == "fronte"
        return refuse("toZone", "il ritiro è un gesto di Preparazione: a Fronte dichiarato non si ritira (§6.2, Ritiro)", "retiring is a Preparation move: once the Front is declared, nothing retires (§6.2, Retire)")
      end
      if card[:facedown]
        return refuse("toZone", "l'Entità coperta è intoccabile: non si ritira finché non si scopre (§6.2, Ritiro)", "a covered Entity is untouchable: it doesn't retire until it's uncovered (§6.2, Retire)")
      end
      if card[:tapped]
        return refuse("toZone", "un'Entità tappata è impegnata: si ritira quando si stappa (§6.2, Ritiro)", "a tapped Entity is busy: it retires once it untaps (§6.2, Retire)")
      end
      if card[:entered] == @table.turn
        return refuse("toZone", "l'Entità è entrata in campo questo turno: si ritira dal prossimo — lo Slancio non aggira il divieto (§6.2, Ritiro)", "the Entity entered the field this turn: it can retire from the next one — Surge doesn't get around that (§6.2, Retire)")
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

      return refuse("player", "i PV non scendono sotto 0: a 0 la partita è persa (§3.1)", "HP doesn't go below 0: at 0 the game is lost (§3.1)") if hp.is_a?(Numeric) && hp.negative?
      if (flux.is_a?(Numeric) && flux.negative?) || (flux_max.is_a?(Numeric) && flux_max.negative?)
        return refuse("player", "il Flusso non scende sotto 0 (§3.2)", "Flux doesn't go below 0 (§3.2)")
      end

      cap = patch["token"] == false ? 21 : 20
      if flux.is_a?(Numeric) && flux > cap
        if cap == 21
          return refuse("player", "nemmeno col Gettone il Flusso supera 21 (§3.2)", "not even with the Token does Flux go past 21 (§3.2)")
        end

        return refuse("player", "il Flusso non supera mai 20 (§3.2); solo il Gettone speso arriva a 21", "Flux never goes past 20 (§3.2); only a spent Token reaches 21")
      end
      return refuse("player", "la barra del Flusso non supera 20 (§3.2)", "the Flux bar doesn't go past 20 (§3.2)") if flux_max.is_a?(Numeric) && flux_max > 20

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

      # §6.4 — il turno non si chiude sopra un'ondata senza finestra di
      # difesa: dichiarata l'ondata, prima si passa al difensore. Dalla
      # Reazione invece si chiude liberamente: quanto aspettare la difesa
      # è affare del tavolo, come a un tavolo vero.
      if @table.phase == "fronte" && @table.wave_declared?
        return refuse("turn", "l'ondata è dichiarata: passa al difensore prima di chiudere (§6.4)", "the wave is declared: pass to the defender before closing (§6.4)")
      end

      held = @table.hand_count(@table.active)
      if held > 7
        refuse("turn", "chi chiude il turno ha #{held} carte in mano: prima scarta fino a 7 (§6.5)", "whoever ends the turn holds #{held} cards: discard down to 7 first (§6.5)")
      else
        allow("turn")
      end
    end

    # §6 — la fase è a senso unico: Preparazione → Fronte → Reazione, e
    # indietro si torna solo col cambio di turno. La Reazione si apre dal
    # Fronte — è l'ondata che passa la parola (§6.4), non un salto dalla
    # Preparazione. Valore ignoto: nessuna regola, mai molesto.
    def judge_phase(action)
      phase = action["phase"]
      return no_rule("phase") unless Table::PHASES.include?(phase)

      if Table::PHASES.index(phase) < Table::PHASES.index(@table.phase)
        return refuse("phase", "la fase è a senso unico: in Preparazione si torna col cambio di turno (§6)", "phases go one way: Preparation comes back with the turn change (§6)")
      end
      if phase == "reazione" && @table.phase == "preparazione"
        return refuse("phase", "la Reazione si apre dal Fronte: prima si dichiara l'ondata (§6.4)", "the Reaction opens from the Front: the wave is declared first (§6.4)")
      end

      allow("phase")
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

      # Ogni dichiarazione ha la sua fase: gli attacchi vivono nel Fronte
      # (§6.3), i blocchi nella Reazione — «vista l'intera ondata» (§6.4).
      if kind == "attack"
        if @table.phase == "reazione"
          return refuse("declare", "l'ondata è passata al difensore: niente nuovi attacchi in Reazione (§6.4)", "the wave has passed to the defender: no new attacks in Reaction (§6.4)")
        end
        if @table.phase != "fronte"
          return refuse("declare", "prima si dichiara la Fase di Fronte: gli attacchi vivono lì (§6.3)", "declare the Front Phase first: attacks live there (§6.3)")
        end
      elsif @table.phase != "reazione"
        return refuse("declare", "i blocchi si dichiarano in Fase di Reazione, a ondata completa (§6.4)", "blocks are declared in the Reaction Phase, once the wave is complete (§6.4)")
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
        return refuse("declare", "il Rubyfront non attacca e non blocca (§3.1): la sua funzione sono abilità e Materie", "the Rubyfront neither attacks nor blocks (§3.1): its job is abilities and Matters")
      end
      if declarer && declarer != "entity"
        return refuse("declare", "solo le Entità attaccano e bloccano (§6.3)", "only Entities attack and block (§6.3)")
      end

      # §6.3 — la dogana del POSTO: attacca chi è di turno, blocca chi
      # difende. I blocchi si dichiarano DENTRO il turno dell'attaccante,
      # dall'altra metà del tavolo — per questo il confronto è con `active`,
      # non con una fase del difensore che non esiste.
      # Chi comanda la carta: chi la controlla, o il proprietario (§8.2).
      commander = @table.controller_of(card)
      if kind == "attack" && commander != @table.active
        return refuse("declare", "si attacca nel proprio turno (§6.3)", "you attack on your own turn (§6.3)")
      end
      if kind != "attack" && commander == @table.active
        return refuse("declare", "blocca chi difende: i blocchi si dichiarano nel turno dell'attaccante (§6.3)", "the defender blocks: blocks are declared on the attacker's turn (§6.3)")
      end

      return refuse("declare", "la carta è coperta: finché è coperta non può fare nulla (§6.3)", "the card is covered: while covered it can't do anything (§6.3)") if card[:facedown]

      if card[:tapped]
        verb = kind == "attack" ? "attaccare" : "bloccare"
        verb_en = kind == "attack" ? "attack" : "block"
        return refuse("declare", "una carta tappata non può #{verb} (§6.3)", "a tapped card can't #{verb_en} (§6.3)")
      end

      if kind != "attack"
        # Un blocco vuole un attaccante vero: senza un attacco dichiarato in
        # piedi non c'è niente da fermare, e la freccia non direbbe niente.
        unless @table.attacking?(declaration["to"])
          return refuse("declare", "quella carta non sta attaccando: non c'è niente da bloccare (§6.3)", "that card isn't attacking: there's nothing to block (§6.3)")
        end
        if @table.blocked?(declaration["to"])
          return refuse("declare", "quell'attaccante ha già chi lo ferma (§6.3, sfide 1 contro 1)", "that attacker already has someone stopping it (§6.3, 1-on-1 challenges)")
        end

        return allow("declare")
      end

      known = @cards[card[:card_id]]
      return allow("declare") unless known && known[:type] == "entity"
      # Lo Slancio stampato, o concesso fino a fine turno (§8.2).
      return allow("declare") if known[:keywords].include?("surge") || Array(card[:grants]).include?("surge")

      if card[:entered] == @table.turn
        refuse("declare", "l'Entità è entrata in campo questo turno: senza Slancio attacca dal prossimo (§6.2, attesa di evocazione)", "the Entity entered the field this turn: without Surge it attacks from the next one (§6.2, summoning wait)")
      else
        allow("declare")
      end
    end

    # §6.3/§6.4 — la risoluzione delle battaglie. È la prima regola in cui
    # il tavolo FA qualcosa da sé, e l'engine resta arbitro: l'esito lo
    # calcola il client di chi è di turno e lo manda in un'azione sola
    # (`resolve`, con la lista delle battaglie); qui si rifà lo stesso conto
    # dalla copia del tavolo e dall'anagrafe — Potenze e Contrattacco
    # stampati — e passa solo un esito identico, battaglia per battaglia,
    # nell'ordine di dichiarazione. Il tempismo: si risolve in Reazione, e
    # risolve chi è di turno. A una carta manca la Potenza in anagrafe: il
    # conto non si può rifare, e l'engine tace — mai molesto. Limiti
    # dichiarati: Stasi, Vendetta, le Reattive come bloccanti e ogni
    # modifica di Potenza in partita (Oggetti, effetti) non si vedono.
    def judge_resolve(action)
      battles = action["battles"]
      return no_rule("resolve") unless battles.is_a?(Array)

      unless @table.phase == "reazione"
        return refuse("resolve", "le battaglie si risolvono in Fase di Reazione, a difesa dichiarata (§6.4)", "battles are resolved in the Reaction Phase, once the defence is declared (§6.4)")
      end
      return refuse("resolve", "risolve l'ondata chi è di turno (§6.4)", "the active player resolves the wave (§6.4)") unless action["seat"] == @table.active

      expected = expected_battles
      return no_rule("resolve") if expected.nil?

      claimed = battles.map { |battle| normalize_battle(battle) }
      if claimed != expected
        index = expected.each_index.find { |i| claimed[i] != expected[i] } || [claimed.size, expected.size].min
        return refuse("resolve", "l'esito non torna con le Potenze in campo (§6.3, battaglia #{index + 1})", "the outcome doesn't match the Powers on the field (§6.3, battle #{index + 1})")
      end

      allow("resolve")
    end

    # Il conto dell'engine (§6.3): l'ondata nell'ordine di dichiarazione,
    # per ciascun attaccante chi lo ferma. Ritorna nil se manca una Potenza.
    def expected_battles
      @table.attackers_in_order.map do |attacker|
        power = stat(attacker, :power)
        return nil if power.nil?

        blocker, kind = @table.blocker_of(attacker)
        next { attacker: attacker, blocker: nil, kind: "unblocked", attacker_dies: false, blocker_dies: false, damage: power } unless blocker

        blocker_power = stat(blocker, :power)
        return nil if blocker_power.nil?

        counter = kind == "counter"
        total = counter ? blocker_power + (stat(blocker, :counterattack) || 0) : blocker_power
        # Nel blocco normale l'attaccante muore SOLO nel pareggio; nel
        # contrattacco anche quando il totale lo supera (§6.3).
        { attacker: attacker, blocker: blocker, kind: kind,
          attacker_dies: counter ? total >= power : total == power,
          blocker_dies: total <= power, damage: 0 }
      end
    end

    def stat(uid, key)
      card = @table.card(uid)
      card && @cards.dig(card[:card_id], key)
    end

    def normalize_battle(battle)
      return nil unless battle.is_a?(Hash)

      { attacker: battle["attacker"], blocker: battle["blocker"], kind: battle["kind"],
        attacker_dies: battle["attackerDies"] == true, blocker_dies: battle["blockerDies"] == true,
        damage: battle["damage"].to_i }
    end

    # §6 — «le prime tre fasi appartengono al giocatore di turno»: nel turno
    # altrui non si agisce. La dogana viene PRIMA di tutte le altre e guarda
    # chi compie il gesto, non di chi è la carta. Al difensore restano le
    # finestre che il manuale gli dà: i blocchi e i contrattacchi in
    # Reazione (§6.4, e il ripensarci), le Materie Reattive nel Fronte
    # altrui (§6.3 Pre-Fronte, §7.2 — e come blocco), e i propri contatori
    # in Fronte e Reazione, perché le Reattive si pagano. Tutto il resto —
    # pescare, giocare, ritirare, muovere fra le zone, cambiare fase o turno,
    # risolvere — aspetta il proprio turno. Attore assente (client vecchio) o
    # di turno: si passa alle altre dogane. Limite dichiarato: gli effetti
    # risolti a mano che fanno agire l'avversario nel proprio turno («il tuo
    # avversario pesca…») verrebbero fermati a torto.
    def judge_actor(action, actor)
      return nil unless Table::SEATS.include?(actor)

      kind = action["t"]
      # §6.4 — la Reazione è la fase del difensore, e la chiude lui: risolvere
      # l'ondata e chiudere il turno da lì sono gesti SUOI, non di chi
      # attacca (che «aspetta la reazione»).
      if @table.phase == "reazione" && %w[resolve turn].include?(kind)
        return nil if actor != @table.active
        return refuse(kind, "la Reazione la chiude chi difende: risolve l'ondata e passa il turno (§6.4)", "the defender closes the Reaction: resolves the wave and passes the turn (§6.4)")
      end
      return nil if actor == @table.active

      # I gesti di APPARECCHIATURA non hanno turno: caricare il proprio mazzo
      # (all'ingresso in stanza, nel turno di chiunque), «Nuova partita», il
      # proprio nome, la chat, i pixel — e una patch che non tocca i
      # contatori non è un'azione di gioco.
      # Un `move` è pixel — salvo lo schieramento del Rubyfront, che porta
      # un costo ed è un gesto di gioco (§3.1: nel proprio turno).
      # `spawn` è lo strumento di prova del client (evoca dal catalogo).
      return nil if %w[loadDeck newGame say spawn release].include?(kind) || (kind == "move" && !action.key?("cost"))
      if kind == "player" && action["seat"] == actor
        patch = action["patch"]
        counters = patch.is_a?(Hash) && %w[hp flux fluxMax].any? { |key| patch.key?(key) }
        return nil unless counters
      end
      # §4 — la preparazione della partita: «prima che inizi il primo turno,
      # entrambi i giocatori pescano 6 carte», e il mulligan (Mescola, Pesca
      # 6). Il tavolo non ha un tempo «prima del turno 1»: è il turno 1 in
      # Preparazione, e lì anche l'altro posto apparecchia il suo mazzo —
      # pesca, mescola, mano che torna nel mazzo. Solo sulle proprie carte,
      # solo fra mano e mazzo.
      if @table.turn == 1 && @table.phase == "preparazione"
        case kind
        when "draw", "shuffle"
          return nil if action["seat"] == actor
        when "toZone"
          card = @table.card(action["uid"])
          between = %w[hand deck]
          return nil if card && card[:owner] == actor && between.include?(card[:zone]) && between.include?(action["zone"])
        end
      end
      case kind
      when "declare"
        return nil if %w[block counter].include?(action.dig("declaration", "kind"))
      when "undeclare"
        return nil
      when "toZone"
        card = @table.card(action["uid"])
        known = card && @cards[card[:card_id]]
        reactive = known && known[:type] == "matter" && known[:behavior] == "reactive"
        return nil if card && card[:owner] == actor && action["zone"] == "field" && reactive
      when "player"
        return nil if action["seat"] == actor && @table.phase != "preparazione"
      end

      refuse(kind, "non tocca a te: nel turno avversario si blocca in Reazione e si giocano solo Reattive (§6)", "it's not your turn: on the opponent's turn you block in Reaction and play only Reactives (§6)")
    end

    # §7 — c'è, fra le carte in campo di `seat`, un abilitante per quella
    # Materia al grado richiesto? Vedi judge_enter_field.
    def enabled?(seat, matter)
      @table.field_cards(seat).any? do |other|
        next false if other[:facedown]

        entry = @cards[other[:card_id]]
        next false unless entry

        # Il Rubyfront abilita solo schierato: la fila di servizio è il
        # Richiamo. Fila ignota: nel dubbio, abilita.
        if entry[:type] == "rubyfront" && other[:row] && !FRONT_ROW_Y.include?(other[:row])
          next false
        end

        grants = Array(entry[:enables])[other[:face] || 0] || []
        grants.any? do |grant|
          grant[:type] == matter[:type] &&
            (matter[:grade].nil? || grant[:max_grade].nil? || grant[:max_grade] >= matter[:grade])
        end
      end
    end

    # §2/§9 — la fine della partita la dichiara il client che l'ha vista
    # arrivare, e qui si verifica sulla copia: per PV, chi perde deve avere
    # 0 PV (§2) — nel pareggio entrambi (§9.2); per mazzo esaurito, chi
    # perde deve avere il mazzo vuoto (§9.1; il tempismo del confine dei
    # turni è del client, che lo decide in endTurn). Chi vince dev'essere
    # un posto, o nessuno nel pareggio.
    def judge_game_over(action)
      winner = action["winner"]
      reason = action["reason"]
      return no_rule("gameOver") unless %w[hp deck draw].include?(reason)
      return refuse("gameOver", "chi vince dev'essere un posto del tavolo (§2)", "the winner must be a seat at the table (§2)") unless winner.nil? || Table::SEATS.include?(winner)

      case reason
      when "draw"
        return refuse("gameOver", "il pareggio automatico vuole entrambi a 0 PV (§9.2)", "an automatic draw needs both at 0 HP (§9.2)") unless winner.nil? && Table::SEATS.all? { |seat| @table.hp(seat) <= 0 }
      when "hp"
        loser = Table::SEATS.find { |seat| seat != winner }
        return refuse("gameOver", "chi vince dev'essere un posto del tavolo (§2)", "the winner must be a seat at the table (§2)") unless loser
        return refuse("gameOver", "i PV di #{loser.upcase} non sono a zero: la partita continua (§2)", "#{loser.upcase}'s HP isn't at zero: the game goes on (§2)") unless @table.hp(loser) <= 0
      when "deck"
        loser = Table::SEATS.find { |seat| seat != winner }
        return refuse("gameOver", "chi vince dev'essere un posto del tavolo (§2)", "the winner must be a seat at the table (§2)") unless loser
        return refuse("gameOver", "il mazzo di #{loser.upcase} non è vuoto: la partita continua (§9.1)", "#{loser.upcase}'s deck isn't empty: the game goes on (§9.1)") unless @table.zone_count(loser, "deck").zero?
      end

      allow("gameOver")
    end

    # §8.2 — gli effetti certificati. Oggi una forma sola, gli ascoltatori
    # d'ingresso di RBF-003: la fonte dev'essere in campo, dello stesso posto
    # di chi entra; chi entra dev'essere un'altra carta entrata QUESTO turno
    # (non si riscalda un innesco vecchio), della razza chiesta; il posto
    # deve controllare almeno N Entità della razza chiesta, contando chi è
    # appena entrato; il passo dev'essere quello dell'effetto — una pesca del
    # controllore, di K carte — e non già consumato. Carta di chi entra
    # ignota all'anagrafe: il conto non si rifà, silenzio.
    def judge_effect(action)
      ref = action["effect"]
      kind = action["t"]
      return judge_effect_move(action, ref) if kind == "toZone"
      return judge_effect_look(action, ref) if kind == "look"
      return judge_effect_control(action, ref) if kind == "control"
      return refuse(kind, "un effetto certificato pesca, sposta o guarda soltanto, per ora (§8.2)", "a certified effect only draws, moves or looks, for now (§8.2)") unless kind == "draw"
      return judge_effect_attack_draw(action, ref) if ref["event"] == "on_attack"

      source = @table.card(ref["source"])
      entering = @table.card(ref["entering"])
      return refuse(kind, "la fonte dell'effetto non è in campo (§8.2)", "the effect's source isn't on the field (§8.2)") unless source && source[:zone] == "field"
      unless entering && entering[:zone] == "field" && @table.controller_of(entering) == @table.controller_of(source) && ref["entering"] != ref["source"]
        return refuse(kind, "l'ingresso che innesca dev'essere un'altra carta dello stesso posto, in campo (§8.2)", "the triggering entry must be another card of the same seat, on the field (§8.2)")
      end
      return refuse(kind, "quella carta non è entrata in campo questo turno: l'innesco è passato (§8.2)", "that card didn't enter the field this turn: the trigger has passed (§8.2)") unless entering[:entered] == @table.turn
      return refuse(kind, "questo innesco è già stato risolto per quell'ingresso (§8.2)", "this trigger has already been resolved for that entry (§8.2)") if @table.fired?(ref["source"], ref["event"], ref["entering"])

      arrived = @cards[entering[:card_id]]
      return no_rule(kind) unless arrived

      listeners = Array(@cards.dig(source[:card_id], :enter_listeners))
      owner = @table.controller_of(source)
      matched = listeners.any? do |listener|
        arrived[:type] == "entity" &&
          (listener[:entering_race].nil? || arrived[:race] == listener[:entering_race]) &&
          count_entities(owner, listener[:requires][:race]) >= listener[:requires][:count] &&
          listener[:draw] == action["count"] && action["seat"] == owner
      end
      return refuse(kind, "la carta non ha un effetto certificato che si innesca così (§8.2)", "the card has no certified effect that triggers this way (§8.2)") unless matched

      allow(kind)
    end

    # §8.2 — lo spostamento all'ingresso (la forma di RBF-007): la fonte è
    # chi entra — in campo, entrata QUESTO turno, innesco non consumato — e
    # il bersaglio un'Entità avversaria in campo, mandata nella zona che la
    # forma certificata dice. Bersaglio ignoto all'anagrafe: silenzio.
    # §8.2 — la fonte di un effetto proprio (ingresso o attacco) dev'essere
    # in campo, e l'evento deve valere ORA: entrata questo turno, o con un
    # attacco dichiarato in Fase di Fronte. Ritorna un rifiuto, o nil.
    def own_trigger_stopped(kind, ref)
      return refuse(kind, "l'effetto proprio ha per ingresso se stessa (§8.2)", "a card's own effect has itself as the entry (§8.2)") unless ref["source"] == ref["entering"]

      source = @table.card(ref["source"])
      return refuse(kind, "la fonte dell'effetto non è in campo (§8.2)", "the effect's source isn't on the field (§8.2)") unless source && source[:zone] == "field"

      case ref["event"]
      when "on_enter_field"
        return refuse(kind, "la fonte non è entrata in campo questo turno: l'innesco è passato (§8.2)", "the source didn't enter the field this turn: the trigger has passed (§8.2)") unless source[:entered] == @table.turn
      when "on_attack"
        return refuse(kind, "«quando attacca» vuole un attacco dichiarato, in Fase di Fronte (§8.2)", "“when it attacks” needs a declared attack, in the Front Phase (§8.2)") unless @table.phase == "fronte" && @table.attacking?(ref["source"])
      else
        return refuse(kind, "evento d'effetto sconosciuto (§8.2)", "unknown effect event (§8.2)")
      end
      return refuse(kind, "questo innesco è già stato risolto (§8.2)", "this trigger has already been resolved (§8.2)") if @table.fired?(ref["source"], ref["event"], ref["entering"])

      nil
    end

    # §8.2 — la pesca all'attacco (la forma di RBF-026): la fonte attacca
    # in Fase di Fronte, l'innesco non è consumato (una volta per turno:
    # un'Entità attacca una volta sola), ha un Oggetto assegnato, e pesca
    # chi la comanda, tante carte quante dice la forma. Ignota: silenzio.
    def judge_effect_attack_draw(action, ref)
      stopped = own_trigger_stopped("draw", ref)
      return stopped if stopped

      source = @table.card(ref["source"])
      known = @cards[source[:card_id]]
      return no_rule("draw") unless known

      form = Array(known[:attack_draws]).find { |candidate| candidate[:draw] == action["count"] }
      return refuse("draw", "la carta non ha un effetto certificato che peschi quando attacca (§8.2)", "the card has no certified effect that draws when it attacks (§8.2)") unless form
      return refuse("draw", "pesca chi comanda la fonte, dal proprio mazzo (§8.2)", "whoever commands the source draws, from their own deck (§8.2)") unless action["seat"] == @table.controller_of(source)
      if form[:requires_object] && !@table.armed?(ref["source"])
        return refuse("draw", "«mentre ha un Oggetto assegnato»: senza Oggetto l'innesco non scatta (§8.2)", "“while it has an Object assigned”: without an Object the trigger doesn't fire (§8.2)")
      end

      allow("draw")
    end

    # §8.2 — «poi scarta una carta» (RBF-026): il seguito della pesca. Un
    # `toZone` dalla mano all'Abisso marcato con `follow: "discard"`, che
    # passa se la fonte è in campo con una forma che fa scartare, la pesca
    # dell'attacco è già avvenuta e lo scarto dovuto non ancora, e la carta
    # sta nella mano di chi comanda la fonte.
    def judge_effect_discard(action, ref)
      kind = "toZone"
      return refuse(kind, "l'effetto proprio ha per ingresso se stessa (§8.2)", "a card's own effect has itself as the entry (§8.2)") unless ref["source"] == ref["entering"]

      source = @table.card(ref["source"])
      return refuse(kind, "la fonte dell'effetto non è in campo (§8.2)", "the effect's source isn't on the field (§8.2)") unless source && source[:zone] == "field"

      known = @cards[source[:card_id]]
      return no_rule(kind) unless known

      form = Array(known[:attack_draws]).find { |candidate| candidate[:then_discard].positive? }
      return refuse(kind, "la carta non ha un effetto certificato che faccia scartare (§8.2)", "the card has no certified effect that makes you discard (§8.2)") unless form
      return refuse(kind, "lo scarto viene dopo la pesca: prima si pesca (§8.2)", "the discard comes after the draw: draw first (§8.2)") unless @table.fired?(ref["source"], "on_attack", ref["entering"])
      return refuse(kind, "lo scarto dovuto è già stato fatto (§8.2)", "the discard owed has already been made (§8.2)") if @table.fired?(ref["source"], "on_attack:discard", ref["entering"])

      card = @table.card(action["uid"])
      return refuse(kind, "si scarta una carta dalla propria mano (§8.2)", "you discard a card from your own hand (§8.2)") unless card && card[:zone] == "hand" && card[:owner] == @table.controller_of(source)

      allow(kind)
    end

    def judge_effect_move(action, ref)
      return judge_effect_discard(action, ref) if action["zone"] == "abisso" && ref["follow"] == "discard"

      stopped = own_trigger_stopped("toZone", ref)
      return stopped if stopped

      source = @table.card(ref["source"])

      target = @table.card(action["uid"])
      return refuse("toZone", "il bersaglio dell'effetto non esiste (§8.2)", "the effect's target doesn't exist (§8.2)") unless target

      # Il ritorno (la forma di RBF-012): dalla propria Zona di Ritiro al Fronte,
      # una carta del tipo e del comportamento chiesti.
      if action["zone"] == "field"
        forms = ref["event"] == "on_attack" ? :attack_returns : :enter_returns
        ret = Array(@cards.dig(source[:card_id], forms)).first
        return refuse("toZone", "la carta non ha un effetto certificato che riporti in campo (§8.2)", "the card has no certified effect that brings back to the field (§8.2)") unless ret
        return refuse("toZone", "la carta da riportare dev'essere nella propria Zona di Ritiro (§8.2)", "the card to bring back must be in your own Retire Zone (§8.2)") unless target[:zone] == ret[:from] && target[:owner] == @table.controller_of(source)

        entry = @cards[target[:card_id]]
        return no_rule("toZone") unless entry
        unless entry[:type] == ret[:filter][:type] && entry[:behavior] == ret[:filter][:behavior]
          return refuse("toZone", "si riporta una carta permanente, non questa (§8.2)", "a permanent card is brought back, not this one (§8.2)")
        end

        return allow("toZone")
      end

      # Lo spostamento (la forma di RBF-007): un'Entità avversaria in campo,
      # verso la zona della forma.
      moves = Array(@cards.dig(source[:card_id], :enter_moves))
      move = moves.find { |candidate| candidate[:to] == action["zone"] }
      return refuse("toZone", "la carta non ha un effetto certificato che sposti lì (§8.2)", "the card has no certified effect that moves there (§8.2)") unless move
      return refuse("toZone", "il bersaglio dev'essere in campo (§8.2)", "the target must be on the field (§8.2)") unless target[:zone] == "field"
      return refuse("toZone", "il bersaglio dev'essere avversario (§8.2)", "the target must be an opponent's (§8.2)") if @table.controller_of(target) == @table.controller_of(source)

      entry = @cards[target[:card_id]]
      return no_rule("toZone") unless entry
      return refuse("toZone", "il bersaglio dev'essere un'Entità (§8.2)", "the target must be an Entity (§8.2)") unless entry[:type] == move[:target][:type]

      allow("toZone")
    end

    # §8.2 — lo sguardo nel mazzo (la forma di RBF-006): la fonte è chi
    # entra, entrata questo turno, innesco non consumato; il conto delle
    # carte è quello della forma; la rivelata, se c'è, sta fra le prime N
    # del mazzo del posto ed è del tipo e della razza chiesti (ignota
    # all'anagrafe: silenzio).
    def judge_effect_look(action, ref)
      return refuse("look", "l'effetto di chi entra ha per ingresso se stessa (§8.2)", "the entering card's effect has itself as the entry (§8.2)") unless ref["source"] == ref["entering"]

      source = @table.card(ref["source"])
      return refuse("look", "la fonte dell'effetto non è in campo (§8.2)", "the effect's source isn't on the field (§8.2)") unless source && source[:zone] == "field"
      return refuse("look", "la fonte non è entrata in campo questo turno: l'innesco è passato (§8.2)", "the source didn't enter the field this turn: the trigger has passed (§8.2)") unless source[:entered] == @table.turn
      return refuse("look", "questo innesco è già stato risolto (§8.2)", "this trigger has already been resolved (§8.2)") if @table.fired?(ref["source"], ref["event"], ref["entering"])
      return refuse("look", "si guarda nel proprio mazzo (§8.2)", "you look in your own deck (§8.2)") unless action["seat"] == @table.controller_of(source)

      look = Array(@cards.dig(source[:card_id], :enter_looks)).first
      return refuse("look", "la carta non ha un effetto certificato che guardi nel mazzo (§8.2)", "the card has no certified effect that looks in the deck (§8.2)") unless look

      # Il conto: fisso, o dal dado — il tiro dev'essere valido, e il conto
      # quello della formula. Il tiro lo verifica la forma, non la fortuna.
      count = look[:count]
      if look[:die]
        roll = action["roll"]
        return refuse("look", "si tira un d#{look[:die]}: l'azione non porta un tiro valido (§8.2)", "a d#{look[:die]} is rolled: the action carries no valid roll (§8.2)") unless roll.is_a?(Integer) && roll.between?(1, look[:die])

        count = look[:count_base] + (roll + 1) / 2
      end
      return refuse("look", "si guardano le prime #{count} carte, non #{action["count"]} (§8.2)") unless action["count"] == count

      seat = @table.controller_of(source)
      top = @table.top_of_deck(seat, count)
      reveal = action["reveal"]
      retire = action["retire"]
      if reveal
        return refuse("look", "la carta mostrata dev'essere fra le prime #{count} del mazzo (§8.2)", "the revealed card must be among the top #{count} of the deck (§8.2)") unless top.include?(reveal)

        shown = @table.card(reveal)
        entry = shown && @cards[shown[:card_id]]
        return no_rule("look") unless entry
        wanted = look[:reveal]
        unless entry[:type] == wanted[:type] && (wanted[:race].nil? || entry[:race] == wanted[:race])
          what = wanted[:type] == "object" ? "un Oggetto" : "un'Entità"
          what += " di razza #{wanted[:race]}" if wanted[:race]
          what_en = wanted[:type] == "object" ? "an Object" : "an Entity"
          what_en += " of race #{wanted[:race]}" if wanted[:race]
          return refuse("look", "si può mostrare solo #{what}: non questa (§8.2)", "only #{what_en} can be revealed: not this one (§8.2)")
        end
      end
      if look[:then_retire]
        others = top - [reveal].compact
        if others.any?
          return refuse("look", "una delle altre carte va nella Zona di Ritiro (§8.2)", "one of the other cards goes to the Retire Zone (§8.2)") unless retire
          return refuse("look", "la carta per la Zona di Ritiro dev'essere fra le altre guardate (§8.2)", "the card for the Retire Zone must be among the others looked at (§8.2)") unless others.include?(retire)
        end
      elsif retire
        return refuse("look", "questo sguardo non manda nulla in Zona di Ritiro (§8.2)", "this look sends nothing to the Retire Zone (§8.2)")
      end

      allow("look")
    end

    # §8.2 — il controllo (la forma di RBF-009): la fonte è chi entra,
    # entrata questo turno, innesco non consumato; il bersaglio un'Entità
    # comandata dall'avversario, in campo, col costo di Flusso entro il
    # limite (ignoto all'anagrafe: silenzio); `by` è chi comanda la fonte e
    # le concessioni sono quelle della forma.
    def judge_effect_control(action, ref)
      return refuse("control", "l'effetto di chi entra ha per ingresso se stessa (§8.2)", "the entering card's effect has itself as the entry (§8.2)") unless ref["source"] == ref["entering"]

      source = @table.card(ref["source"])
      return refuse("control", "la fonte dell'effetto non è in campo (§8.2)", "the effect's source isn't on the field (§8.2)") unless source && source[:zone] == "field"
      return refuse("control", "la fonte non è entrata in campo questo turno: l'innesco è passato (§8.2)", "the source didn't enter the field this turn: the trigger has passed (§8.2)") unless source[:entered] == @table.turn
      return refuse("control", "questo innesco è già stato risolto (§8.2)", "this trigger has already been resolved (§8.2)") if @table.fired?(ref["source"], ref["event"], ref["entering"])

      by = @table.controller_of(source)
      return refuse("control", "prende il controllo chi comanda la fonte (§8.2)", "whoever commands the source takes control (§8.2)") unless action["by"] == by

      control = Array(@cards.dig(source[:card_id], :enter_controls)).first
      return refuse("control", "la carta non ha un effetto certificato che prenda il controllo (§8.2)", "the card has no certified effect that takes control (§8.2)") unless control
      return refuse("control", "le parole chiave concesse non sono quelle della carta (§8.2)", "the granted keywords aren't the card's (§8.2)") unless Array(action["grants"]) == control[:grants]

      target = @table.card(action["uid"])
      return refuse("control", "il bersaglio dev'essere in campo (§8.2)", "the target must be on the field (§8.2)") unless target && target[:zone] == "field"
      return refuse("control", "il bersaglio dev'essere avversario (§8.2)", "the target must be an opponent's (§8.2)") if @table.controller_of(target) == by

      entry = @cards[target[:card_id]]
      return no_rule("control") unless entry
      return refuse("control", "il bersaglio dev'essere un'Entità (§8.2)", "the target must be an Entity (§8.2)") unless entry[:type] == control[:target][:type]

      max_cost = control[:target][:max_cost]
      if max_cost
        cost = entry[:flux_cost]
        return refuse("control", "si prende un'Entità con costo di Flusso #{max_cost} o inferiore (§8.2)", "you take an Entity with Flux cost #{max_cost} or lower (§8.2)") unless cost && cost <= max_cost
      end

      allow("control")
    end

    # §8.2 — la restituzione a fine turno: solo di una carta controllata, e
    # solo quando il turno di chi la controllava è finito. La destinazione
    # la decide il tavolo (slot libero, o Zona di Ritiro a Fronte pieno).
    def judge_release(action)
      card = @table.card(action["uid"])
      return no_rule("release") unless card
      return refuse("release", "la carta non è sotto controllo (§8.2)", "the card isn't under control (§8.2)") unless card[:controller]
      return refuse("release", "si restituisce a fine turno, non prima (§8.2)", "it's returned at end of turn, not before (§8.2)") if card[:controller] == @table.active
      return refuse("release", "si restituisce sul Fronte o nella Zona di Ritiro (§8.2)", "it's returned to the Front or to the Retire Zone (§8.2)") unless %w[field ritiro].include?(action["zone"])

      allow("release")
    end

    def count_entities(seat, race)
      @table.field_cards(seat).count do |card|
        next false if @table.controller_of(card) != seat

        entry = @cards[card[:card_id]]
        entry && entry[:type] == "entity" && (race.nil? || entry[:race] == race)
      end
    end

    def no_rule(kind)
      { t: "verdict", action: kind, ok: true, ruled: false }
    end

    def allow(kind)
      { t: "verdict", action: kind, ok: true, ruled: true }
    end

    # Il motivo in due lingue: `reason` in italiano (la lingua del manuale e
    # dei test), `reason_en` in inglese. Il client mostra quella del tavolo.
    # Il «(§x.y, targhetta)» in coda è nella lingua della frase, in entrambe.
    def refuse(kind, reason, reason_en = reason)
      { t: "verdict", action: kind, ok: false, ruled: true, reason: reason, reason_en: reason_en }
    end
  end
end
