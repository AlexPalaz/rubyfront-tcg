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
    VERSION = "0.41.0"

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
      "§6.2 Ritiro: gesto di Preparazione; nella fase, libero",
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
      "§8.2 Effetti certificati: «quando entra, un'Entità avversaria in Ritiro» (la forma dell'Arciere fino al 2026-09-04)",
      "§8.2 Effetti certificati: «quando entra, una permanente dalla Zona di Ritiro al Fronte» (RBF-012)",
      "§8.2 Effetti certificati: «quando attacca», lo stesso ritorno di Rhen (RBF-012)",
      "§8.2 Effetti certificati: «quando entra, guarda le prime N e mostrane una» (RBF-006)",
      "§8.2 Effetti certificati: «tira un d6, guarda 2 più metà, un Oggetto in mano, una in Ritiro» (RBF-027)",
      "§8.2 Effetti certificati: «quando entra, prendi il controllo di un'Entità avversaria» (RBF-009)",
      "§8.2 Controllo: attacca e blocca chi comanda, e a fine turno si restituisce",
      "§3.1 Il Rubyfront si schiera pagando: costo fisso o a dado",
      "§3.1 Il Rubyfront schierato non torna in Zona di Richiamo",
      "§8.2 Effetti certificati: «quando attacca con un Oggetto, pesca, poi scarta» (RBF-026)",
      "§8.2 Gli statici di Potenza contano nella risoluzione (RBF-002, RBF-010, RBF-013, RBF-014)",
      "§8.1 Stasi: bloccando non muore, resta tappata per sempre",
      "§8.2 Blocco multiplo: «può essere bloccata da più Entità» (RBF-014)",
      "§7.2 Le Reattive: chi è di turno prima dell'ondata, il difensore in Reazione",
      "§7.2 Le Materie si risolvono: le forme certificate di Eredità Perduta (RBF-015…RBF-021)",
      "§3.1 Il Nexus: il flip coi suoi requisiti, il recupero di PV, «quando flippa» (RBF-001)",
      "§3.1 Il Rubyfront in Zona di Richiamo non ha abilità: schierarlo le sblocca",
      "§5 L'Abisso: ci si va morendo, consumandosi o scartando per eccesso, e non si torna",
      "§5/§6.2 Dalla Zona di Ritiro si torna solo per effetto",
      "§8.2 L'Entità presa in controllo non si sposta fra le zone",
      "§5 Le Entità restano nello slot in cui sono scese",
      "§7.2 Le Reattive in Reazione: RBF-040 blocca un'Entità attaccante e cura, RBF-020 stappa gli Umani senza bloccare",
      "§7.2 La catena di risposta: una Reattiva apre, l'avversario risponde o accetta, si risolve al contrario",
      "§8.2 Effetti certificati: «quando entra, un d20: con 15–20 stappa tutte le Entità che controlli» (RBF-011, dal 2026-09-05)",
      "§8.2 «Questa Entità non si tappa mai»: nessun gesto la tappa (RBF-011)",
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
      "§6.2 Retire: a Preparation move; within the phase, free",
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
      "§8.2 Certified effects: “when it enters, an opposing Entity to Retire” (the Archer's form until 2026-09-04)",
      "§8.2 Certified effects: “when it enters, a permanent from the Retire Zone to the Front” (RBF-012)",
      "§8.2 Certified effects: “when it attacks”, Rhen's same return (RBF-012)",
      "§8.2 Certified effects: “when it enters, look at the top N and reveal one” (RBF-006)",
      "§8.2 Certified effects: “roll a d6, look at 2 plus half, an Object to hand, one to Retire” (RBF-027)",
      "§8.2 Certified effects: “when it enters, take control of an opposing Entity” (RBF-009)",
      "§8.2 Control: whoever commands attacks and blocks, and returns it at end of turn",
      "§3.1 The Rubyfront is deployed by paying: fixed cost or a die",
      "§3.1 A deployed Rubyfront doesn't go back to the Recall Zone",
      "§8.2 Certified effects: “when it attacks with an Object, draw, then discard” (RBF-026)",
      "§8.2 Static Power modifiers count in the resolution (RBF-002, RBF-010, RBF-013, RBF-014)",
      "§8.1 Stasis: blocking, it doesn't die, it stays tapped for good",
      "§8.2 Multiple blockers: “may be blocked by multiple Entities” (RBF-014)",
      "§7.2 Reactives: the active player before the wave, the defender in Reaction",
      "§7.2 Matters resolve: the certified forms of Lost Legacy (RBF-015…RBF-021)",
      "§3.1 The Nexus: the flip with its requirements, the HP recovery, “when it flips” (RBF-001)",
      "§3.1 A Rubyfront in the Recall Zone has no abilities: deploying it unlocks them",
      "§5 The Abyss: reached by dying, being spent or discarding down to 7, and there's no way back",
      "§5/§6.2 Cards leave the Retire Zone only through an effect",
      "§8.2 An Entity you took control of doesn't move between zones",
      "§5 Entities stay in the slot they came down on",
      "§7.2 Reactives in Reaction: RBF-040 blocks an attacking Entity and heals, RBF-020 untaps the Humans without blocking",
      "§7.2 The response chain: a Reactive opens it, the opponent answers or accepts, it resolves in reverse",
      "§8.2 Certified effects: “when it enters, a d20: on 15–20 untap all Entities you control” (RBF-011, since 2026-09-05)",
      "§8.2 “This Entity never taps”: no gesture taps it (RBF-011)",
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
      settle_untaps(action)
      verdict
    end

    def observe(action, actor: nil)
      verdict = verdict_for(action, actor)
      @table.apply(action)
      settle_effect(action)
      settle_untaps(action)
      verdict
    end

    # Un passo d'effetto applicato consuma il suo innesco (§8.2): una volta
    # per coppia fonte/ingresso, finché dura il turno.
    def settle_effect(action)
      ref = action.is_a?(Hash) ? action["effect"] : nil
      return unless ref.is_a?(Hash) && ref["source"] && ref["entering"]

      # Gli inneschi d'attacco hanno una chiave per passo (attack_key); il
      # passo che segue un innesco d'ingresso ha la sua tripla (`follow`);
      # le Materie alla risoluzione e il flip hanno una chiave per passo
      # (resolve_key), e il tiro del primo passo resta in memoria.
      case ref["event"]
      when "on_attack"
        @table.fire(ref["source"], *attack_key(action, ref))
      when "on_resolve", "on_flip"
        @table.fire(ref["source"], *resolve_key(action, ref))
        @table.remember_roll(ref["source"], action["roll"]) if action["roll"].is_a?(Integer) && @table.roll_of(ref["source"]).nil?
      else
        @table.fire(ref["source"], fired_event(ref), ref["entering"])
      end
    end

    # Il passo di una Materia alla risoluzione, o del flip, letto
    # dall'azione. Gemello: state.ts, effectKey.
    def resolve_step(action, ref)
      case action["t"]
      when "draw" then "draw"
      when "player" then action.dig("patch", "sealed") ? "seal" : "heal"
      when "look" then "look"
      when "empower" then "empower:#{action["uid"]}"
      when "toZone"
        if action["zone"] == "field" then "deploy"
        elsif action["heldBy"] then "exile"
        elsif action["zone"] == "ritiro" then "move"
        else "destroy"
        end
      else action["t"]
      end
    end

    def resolve_key(action, ref)
      ["#{ref["event"]}:#{resolve_step(action, ref)}", ref["entering"]]
    end

    def resolve_fired?(action, ref)
      @table.fired?(ref["source"], *resolve_key(action, ref))
    end

    def fired_event(ref)
      ref["follow"].is_a?(String) ? "#{ref["event"]}:#{ref["follow"]}" : ref["event"]
    end

    # Il passo di un innesco d'attacco, letto dall'azione: la stessa fonte
    # può avere più passi per lo stesso attacco (RBF-034: +1 e poi lo
    # sguardo; RBF-031: l'Oggetto e lo sguardo), e un potenziamento vale
    # una volta per bersaglio (RBF-029).
    def attack_step(action, ref)
      case action["t"]
      when "draw" then ref["follow"] || "draw"
      when "player" then "heal"
      when "look" then ref["follow"] || "look"
      when "empower" then "empower:#{action["uid"]}"
      when "refresh" then "refresh"
      when "declare" then "join"
      when "toZone" then ref["follow"] || (action["assignTo"] ? "rearm" : (action["zone"] == "field" ? "return" : "move"))
      else action["t"]
      end
    end

    # [evento, ingresso] della tripla: «una volta per turno» (`once`) vale
    # per ogni attacco, e la tripla lo dice con "turn" al posto dell'ingresso.
    def attack_key(action, ref)
      ["on_attack:#{attack_step(action, ref)}", ref["once"] == true ? "turn" : ref["entering"]]
    end

    def attack_fired?(action, ref)
      @table.fired?(ref["source"], *attack_key(action, ref))
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

      # §7.2 — la catena di risposta è atomica: finché c'è, passa solo lei.
      stopped = judge_chain(action, actor)
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
      when "flip" then judge_flip(action)
      when "gameOver" then judge_game_over(action)
      when "tap" then judge_tap(action)
      else no_rule(action["t"])
      end
    end

    # §8.2 — «questa Entità non si tappa mai» (RBF-011, dal 2026-09-05): il
    # gesto di tapparla è fermato, chiunque lo compia e per qualunque
    # ragione — l'attacco (§6.3), un effetto, la mano. Stapparla passa
    # sempre. Carta ignota all'anagrafe: silenzio. Limite dichiarato: la
    # Stasi concessa (RBF-013) alla risoluzione la lascerebbe tappata; la
    # copia non lo impedisce finché la risoluzione non legge lo statico.
    def judge_tap(action)
      return no_rule("tap") unless action["tapped"] == true

      card = @table.card(action["uid"])
      known = card && @cards[card[:card_id]]
      return no_rule("tap") unless known
      return refuse("tap", "questa Entità non si tappa mai (§8.2)", "this Entity never taps (§8.2)") if never_taps?(known)

      allow("tap")
    end

    def never_taps?(known)
      Array(known[:static_forms]).any? { |form| form[:kind] == "never_taps" }
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

      # §8.2 — «prendi il controllo di un'Entità avversaria fino alla fine
      # del turno»: te la comanda, non te la dà. Non è tua, e a mano non la
      # si sposta fra le zone — né nel proprio Abisso, né nella Zona di
      # Ritiro del proprietario: alla fine del turno «si restituisce», e la
      # restituzione ha la sua azione (`release`). Un effetto che la muova
      # passa da judge_effect col suo riferimento, non da qui. Limite
      # dichiarato: un effetto risolto a mano su una carta controllata
      # verrebbe fermato a torto (regola d'oro).
      if card[:controller] && card[:controller] != card[:owner]
        return refuse("toZone", "l'Entità presa in controllo non si sposta fra le zone: attacca e blocca per te fino alla fine del turno, poi torna al proprietario (§8.2)", "an Entity you took control of doesn't move between zones: it attacks and blocks for you until end of turn, then goes back to its owner (§8.2)")
      end

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

      # §5 — l'Abisso è «la zona delle carte morte o consumate: Entità morte
      # o distrutte, Materie risolte, decadute o svanite, Oggetti che seguono
      # un'Entità morta, carte scartate dalla mano». Ci si arriva morendo
      # (la risoluzione, §6.4), consumandosi (la Materia, §7.2), scartando
      # per eccesso (§6.5, «le carte in eccesso vanno scartate») o per un
      # effetto — che passa di qui col suo riferimento, e non arriva a
      # questa dogana. Trascinarci una carta a mano non è nessuna di queste.
      # E da lì non si torna: solo una carta riporta fuori dall'Abisso
      # (§5, l'esilio condizionato; RBF-018). Limiti dichiarati: un effetto
      # risolto a mano che scarti o riporti verrebbe fermato a torto (regola
      # d'oro); il decadere di una permanente (§7.2) resta un gesto a mano,
      # e passa perché una Materia in campo può sempre andare nell'Abisso.
      if card[:zone] == "abisso"
        return refuse("toZone", "dall'Abisso non si torna: solo una carta può riportarne fuori (§5)", "there's no way back from the Abyss: only a card can bring something out of it (§5)")
      end
      # §5/§6.2 — la Zona di Ritiro «funziona esattamente come l'Abisso»: ci
      # si mette liberamente (il Ritiro è un gesto, e resta libero), ma se ne
      # esce solo per effetto — «riporta in mano un'Entità dalla tua Zona di
      # Ritiro», «metti sul tuo Fronte una permanente dalla tua Zona di
      # Ritiro» — e un effetto passa da judge_effect col suo riferimento,
      # non da qui.
      if card[:zone] == "ritiro"
        return refuse("toZone", "dalla Zona di Ritiro si esce solo per effetto: sul Fronte non si torna a mano (§5, §6.2)", "cards leave the Retire Zone only through an effect: no going back to the Front by hand (§5, §6.2)")
      end
      if action["zone"] == "abisso"
        known = @cards[card[:card_id]]
        return no_rule("toZone") unless known

        spent = card[:zone] == "field" && known[:type] == "matter"
        excess = card[:zone] == "hand" && @table.zone_count(card[:owner], "hand") > 7
        unless spent || excess
          return refuse("toZone", "nell'Abisso si va morendo, consumandosi o scartando per eccesso, non a mano (§5, §6.5)", "the Abyss is reached by dying, being spent or discarding down to 7, not by hand (§5, §6.5)")
        end
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

      # §5 — «un'Entità occupa lo slot in cui è scesa: non si sposta da uno
      # slot all'altro, salvo che una carta lo dica» (decisione del
      # designer, 2026-09-04). Con la fila nota e sul Fronte, ogni `move`
      # è un cambio di slot — il tavolo non manda un gesto a vuoto. Fila
      # ignota (lavagna vecchia): resta la dogana della forma, qui sotto.
      if card[:row] && FRONT_ROW_Y.include?(card[:row])
        return refuse("move", "l'Entità resta nello slot in cui è scesa: da uno slot all'altro non si sposta, salvo che una carta lo dica (§5)", "an Entity stays in the slot it came down on: it doesn't move from one slot to another, unless a card says so (§5)")
      end

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
        # §7.2 — le finestre delle Reattive (decisione del designer,
        # 2026-09-05: il Pre-Fronte non c'è più): prima dell'ondata la
        # finestra è di CHI È DI TURNO; «dopo la dichiarazione il giocatore
        # di turno non inizia più Reattive»; la finestra del DIFENSORE è la
        # Fase di Reazione (§6.4), dove gioca qualsiasi Reattiva — compresa
        # quella che «si gioca come bloccante di un'Entità» (RBF-040) e
        # quella che non blocca nessuno (RBF-020).
        # In catena (§7.2) le finestre non contano più: risponde chi ne ha
        # la parola, e l'ha già detto judge_chain — anche l'attaccante in
        # Reazione, quando il difensore ha aperto (§6.4).
        if reactive && card[:zone] != "field" && @table.chain.nil?
          if @table.phase == "fronte" && @table.wave_declared?
            return refuse("toZone", "a ondata dichiarata non si iniziano Reattive nel Fronte: il difensore le gioca in Reazione (§6.3, §7.2)", "once the wave is declared no Reactive is started in the Front: the defender plays them in Reaction (§6.3, §7.2)")
          end
          if @table.phase == "fronte" && card[:owner] != @table.active
            return refuse("toZone", "prima dell'ondata le Reattive sono di chi è di turno: il difensore le gioca in Reazione (§6.3, §7.2)", "before the wave Reactives belong to the active player: the defender plays them in Reaction (§6.3, §7.2)")
          end
          if @table.phase == "reazione" && card[:owner] == @table.active
            return refuse("toZone", "in Reazione le Reattive le gioca il difensore: chi attacca risponde solo in catena (§6.4, §7.2)", "in Reaction the defender plays Reactives: the attacker only answers in the chain (§6.4, §7.2)")
          end
        end
      elsif reactive
        # E il rovescio: una Reattiva in Preparazione è fuori dalla sua
        # finestra, di chiunque sia il turno.
        return refuse("toZone", "le Reattive si giocano solo in Fase di Fronte (§7.2)", "Reactives are played only in the Front Phase (§7.2)")
      end

      # §7.2 — il segno della catena di risposta (`chain: true`): sempre
      # sulla Reattiva giocata da fuori, mai su altro. Dopo le finestre,
      # così il rifiuto che il giocatore legge è quello della finestra.
      if reactive && card[:zone] != "field" && action["chain"] != true
        return refuse("toZone", "una Reattiva apre sempre la catena di risposta: l'azione non lo dice (§7.2)", "a Reactive always opens the response chain: the action doesn't say so (§7.2)")
      end
      if action["chain"] == true && !reactive
        return refuse("toZone", "solo una Materia Reattiva apre o allunga la catena di risposta (§7.2)", "only a Reactive Matter opens or extends the response chain (§7.2)")
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
      # §8.2 — «Non puoi più giocare … per il resto della partita» (RBF-001,
      # il sigillo del flip): la carta non scende, da nessuna zona.
      if @table.sealed?(card[:owner], card[:card_id])
        return refuse("toZone", "quella carta non si può più giocare per il resto della partita: l'ha sigillata il flip del Nexus (§8.2)", "that card can no longer be played for the rest of the game: the Nexus flip sealed it (§8.2)")
      end

      cost = known[:flux_cost]
      if card[:zone] == "hand" && cost
        # §8.2 — «Se questa carta bersaglia un'Entità tappata, costa N
        # Flussi in meno» (RBF-021): il bersaglio si dichiara giocandola
        # (`target`), e lo sconto vale solo se il bersaglio è davvero
        # tappato. L'effetto poi dovrà colpire lui.
        cost -= discount_for(known, action)
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

      # Una carta di un ALTRO posto mandata in Ritiro non è un ritiro: è la
      # risoluzione a mano di un effetto («metti un'Entità avversaria nella
      # Zona di Ritiro…»). Silenzio, non si accusa.
      return no_rule("toZone") if card[:owner] != @table.active

      # §6.2 — «il ritiro è un'azione di preparazione del Fronte: non si
      # ritira in Fase di Fronte, né nel turno avversario». La FASE è il solo
      # vincolo che resta (decisione del designer, 2026-09-04): dentro la
      # Preparazione il gesto è libero — tappata, coperta, appena entrata,
      # Materia — perché è anche l'attrezzo con cui si risolve a mano ciò che
      # l'engine non legge ancora. La strada di RITORNO è chiusa comunque
      # (vedi judge_to_zone): è lì che il vantaggio si prenderebbe.
      unless @table.phase == "preparazione"
        return refuse("toZone", "il ritiro è un gesto di Preparazione: a Fronte dichiarato non si ritira (§6.2, Ritiro)", "retiring is a Preparation move: once the Front is declared, nothing retires (§6.2, Retire)")
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
      # §6.4 — «una Materia Reattiva il cui testo dice che si gioca come
      # bloccante di un'Entità» (RBF-040): giocata questo turno, sostituisce
      # il bloccante per quell'attacco. Non contrattacca.
      matter_block = declarer == "matter" && kind == "block" && reactive_block?(card)
      if declarer && declarer != "entity" && !matter_block
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
        # §8.2 — «quell'Entità non può bloccare in questo turno» (RBF-005).
        if card[:cannot_block]
          return refuse("declare", "quell'Entità non può bloccare in questo turno: un effetto glielo vieta (§8.2)", "that Entity can't block this turn: an effect forbids it (§8.2)")
        end
        # Un blocco vuole un attaccante vero: senza un attacco dichiarato in
        # piedi non c'è niente da fermare, e la freccia non direbbe niente.
        unless @table.attacking?(declaration["to"])
          return refuse("declare", "quella carta non sta attaccando: non c'è niente da bloccare (§6.3)", "that card isn't attacking: there's nothing to block (§6.3)")
        end
        # §8.2 — «può essere bloccata da più Entità» (RBF-014): l'Oggetto
        # addosso all'attaccante apre la sfida a più bloccanti.
        if @table.blocked?(declaration["to"]) && !multi_block?(declaration["to"])
          return refuse("declare", "quell'attaccante ha già chi lo ferma (§6.3, sfide 1 contro 1)", "that attacker already has someone stopping it (§6.3, 1-on-1 challenges)")
        end

        return allow("declare")
      end

      # Chi torna sul Fronte per un effetto e «attacca insieme» (§8.2,
      # RBF-010) non aspetta: il riferimento lo dice, e l'engine lo verifica.
      if action["effect"].is_a?(Hash)
        stopped = attack_join_stopped(action)
        return stopped if stopped

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

      stopped = untap_stopped(action)
      return stopped if stopped

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
      @table.attackers_in_order.flat_map do |attacker|
        power = power_of(attacker)
        return nil if power.nil?

        blockers = @table.blockers_of(attacker)
        if blockers.empty?
          next [{ attacker: attacker, blocker: nil, kind: "unblocked", attacker_dies: false, blocker_dies: false, damage: power,
                  blocker_stasis: false, blocker_spent: false }]
        end

        # Con più bloccanti (§8.2, RBF-014) l'attaccante affronta ciascuno,
        # una battaglia per bloccante, nell'ordine dei blocchi.
        blockers.map do |blocker, kind|
          battle = battle_of(attacker, power, blocker, kind)
          return nil if battle.nil?

          battle
        end
      end
    end

    # Una battaglia (§6.3), con gli attrezzi degli effetti: la Vendetta
    # (§8.1), la Stasi (§8.1), il Contrattacco concesso (RBF-020), e la
    # Reattiva giocata come bloccante di un'Entità (§6.4: «non c'è confronto
    # di Potenza, l'attacco è comunque bloccato, la sorte dell'attaccante la
    # stabilisce il testo» — RBF-040 non dice nulla, e la Reattiva si consuma).
    def battle_of(attacker, power, blocker, kind)
      if stat(blocker, :type) == "matter"
        return { attacker: attacker, blocker: blocker, kind: "block", attacker_dies: false, blocker_dies: false, damage: 0,
                 blocker_stasis: false, blocker_spent: true }
      end

      blocker_power = power_of(blocker)
      return nil if blocker_power.nil?

      counter = kind == "counter"
      total = counter ? blocker_power + (stat(blocker, :counterattack) || 0) + (@table.card(blocker)[:counter_bonus] || 0) : blocker_power
      # Nel blocco normale l'attaccante muore SOLO nel pareggio — o quando
      # il bloccante ha Vendetta e lo supera (§8.1); nel contrattacco anche
      # quando il totale lo supera (§6.3).
      revenge = !counter && has_keyword?(blocker, "revenge") && total > power
      dies = total <= power
      # §8.1 — la Stasi: chi ce l'ha, bloccando o contrattaccando, invece di
      # morire resta tappata per sempre; l'altra muore comunque.
      stasis = dies && has_keyword?(blocker, "stasis")
      { attacker: attacker, blocker: blocker, kind: kind,
        attacker_dies: counter ? total >= power : total == power || revenge,
        blocker_dies: dies && !stasis, damage: 0, blocker_stasis: stasis, blocker_spent: false }
    end

    # §6.4 — la Reattiva come bloccante di un'Entità: una Materia Reattiva
    # con la forma `block` (RBF-040, «gioca questa carta come bloccante di
    # un'Entità attaccante»), scesa in campo questo turno. Una Reattiva che
    # non dice cosa blocca (RBF-020) non blocca nulla e non dichiara niente
    # (§6.4, decisione del designer 2026-09-05).
    def reactive_block?(card)
      known = @cards[card[:card_id]]
      known && known[:type] == "matter" && known[:behavior] == "reactive" && card[:entered] == @table.turn &&
        Array(known[:resolve_forms]).any? { |form| form[:kind] == "block" }
    end

    # §8.2 — l'attaccante porta un Oggetto che lo rende bloccabile da più Entità (RBF-014)?
    def multi_block?(attacker_uid)
      @table.worn_by(attacker_uid).any? do |object|
        Array(@cards.dig(object[:card_id], :static_forms)).any? { |form| form[:multi_block] }
      end
    end

    def stat(uid, key)
      card = @table.card(uid)
      card && @cards.dig(card[:card_id], key)
    end

    # La Potenza in campo: quella stampata, più il bonus fino a fine turno
    # (§8.2), più gli statici certificati — mai sotto 0 (§8.2, «Modifiche
    # alla Potenza»). Gemello: combat.ts, powerOf.
    def power_of(uid)
      printed = stat(uid, :power)
      return nil if printed.nil?

      card = @table.card(uid)
      [0, printed + (card[:power_bonus] || 0) + static_power(uid, card)].max
    end

    # Gli statici (§8.2): «+1 mentre attacca, se sul tuo Fronte c'è un'altra
    # Entità Umana» (RBF-002), «+1 per ogni altra Entità Umana sul tuo
    # Fronte» (RBF-010), e quelli degli Oggetti addosso — «+1» (RBF-013),
    # «+1 per ogni Entità Umana sul tuo Fronte» (RBF-014, portatrice
    # compresa). Gemello: combat.ts, staticPower.
    def static_power(uid, card)
      seat = @table.controller_of(card)
      bonus = 0
      Array(@cards.dig(card[:card_id], :static_forms)).each do |form|
        next unless form[:kind] == "self_power"

        if form[:while_attacking]
          next unless @table.attacking?(uid) && count_entities(seat, form[:requires_other][:race], except: uid) >= 1

          bonus += form[:amount]
        elsif form[:per_other]
          bonus += form[:amount] * count_entities(seat, form[:per_other][:race], except: uid)
        end
      end
      @table.worn_by(uid).each do |object|
        Array(@cards.dig(object[:card_id], :static_forms)).each do |form|
          next unless form[:kind] == "bearer_power"

          bonus += form[:per] ? form[:amount] * count_entities(seat, form[:per][:race]) : form[:amount]
        end
      end
      bonus
    end

    # Una parola chiave stampata, concessa fino a fine turno (§8.2), o data
    # da un Oggetto addosso «mentre assegnato» (RBF-013: la Stasi agli Umani).
    # Gemello: combat.ts, hasKeyword.
    def has_keyword?(uid, keyword)
      card = @table.card(uid)
      return false unless card
      return true if Array(@cards.dig(card[:card_id], :keywords)).include?(keyword) || Array(card[:grants]).include?(keyword)

      race = @cards.dig(card[:card_id], :race)
      @table.worn_by(uid).any? do |object|
        Array(@cards.dig(object[:card_id], :grants_while_assigned)).any? do |grant|
          grant[:keywords].include?(keyword) && (grant[:if_race].nil? || grant[:if_race] == race)
        end
      end
    end

    def normalize_battle(battle)
      return nil unless battle.is_a?(Hash)

      { attacker: battle["attacker"], blocker: battle["blocker"], kind: battle["kind"],
        attacker_dies: battle["attackerDies"] == true, blocker_dies: battle["blockerDies"] == true,
        damage: battle["damage"].to_i, blocker_stasis: battle["blockerStasis"] == true, blocker_spent: battle["blockerSpent"] == true }
    end

    # §6 — «le prime tre fasi appartengono al giocatore di turno»: nel turno
    # altrui non si agisce. La dogana viene PRIMA di tutte le altre e guarda
    # chi compie il gesto, non di chi è la carta. Al difensore restano le
    # finestre che il manuale gli dà: i blocchi e i contrattacchi in
    # Reazione (§6.4, e il ripensarci), le Materie Reattive nel Fronte
    # altrui (in Reazione, §6.4, §7.2 — e in catena), e i propri contatori
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
      # §7.2 — accettare e chiudere un passo della catena sono gesti di chi
      # ne ha la parola, di chiunque sia il turno: li giudica judge_chain.
      return nil if %w[pass settle].include?(kind)
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
      # §7.2 — la Reattiva del difensore si risolve nel turno altrui: i
      # passi del suo effetto sono del difensore che l'ha giocata.
      ref = action["effect"]
      if ref.is_a?(Hash) && ref["event"] == "on_resolve"
        source = @table.card(ref["source"])
        return nil if source && source[:owner] == actor
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
        # …e la Reattiva risolta si consuma (§7.2, «poi la carta va
        # nell'Abisso»): un gesto del difensore sulla propria Materia.
        return nil if card && card[:owner] == actor && action["zone"] == "abisso" && known && known[:type] == "matter"
      when "facedown"
        # §6.3, punto 4 — «chi blocca si tappa, chi contrattacca si copre»:
        # la copertura scatta alla dichiarazione dei blocchi, che avviene
        # nel turno di chi attacca. È un gesto del DIFENSORE sulla propria
        # Entità, dentro la sua Reazione, e va lasciato passare come il
        # blocco stesso — e con lui il suo rovescio, la copertura disfatta
        # quando la dichiarazione si ritira.
        card = @table.card(action["uid"])
        return nil if card && card[:zone] == "field" && @table.controller_of(card) == actor && @table.phase == "reazione"
      when "player"
        return nil if action["seat"] == actor && @table.phase != "preparazione"
      end

      refuse(kind, "non tocca a te: nel turno avversario si blocca in Reazione e si giocano solo Reattive (§6)", "it's not your turn: on the opponent's turn you block in Reaction and play only Reactives (§6)")
    end

    # §7.2 — la catena di risposta. «Ogni volta che un giocatore lancia una
    # Reattiva, l'avversario può sempre rispondere»: solo con Reattive, ad
    # alternanza stretta; «quando il giocatore a cui tocca rispondere passa,
    # la catena si risolve in ordine inverso»; «la catena è atomica: dal
    # primo lancio alla risoluzione completa non si compiono altre azioni»
    # — resta il Gettone Flusso (§3.2, «serve proprio a pagare le
    # Reattive»). Il client segna la Reattiva giocata con `chain: true` e
    # l'engine lo pretende: una Reattiva senza il segno non passa, una
    # carta che non è Reattiva col segno nemmeno. Chiusa la risoluzione di
    # ogni carta, `settle` la toglie dalla pila (la Reattiva che blocca
    # resta in campo fino all'ondata, §6.4: non basta «lascia il campo»).
    # Limite dichiarato: «l'abilitazione si ricontrolla alla risoluzione»
    # (la Reattiva svanisce) non si vede — si risolve comunque.
    def judge_chain(action, actor)
      kind = action["t"]
      chain = @table.chain
      return nil unless chain

      # Liberi anche in catena: chat, pixel, apparecchiatura, e il Gettone.
      return nil if %w[say loadDeck newGame spawn].include?(kind) || (kind == "move" && !action.key?("cost"))
      return nil if kind == "player" && action.dig("patch", "token") == false

      top = @table.chain_top
      if chain[:resolving]
        # Dall'ultima alla prima: passa solo il passo della cima, la cima che
        # si chiude (`settle`), la cima che se ne va.
        ref = action["effect"]
        return nil if ref.is_a?(Hash) && ref["source"] == top
        return nil if kind == "settle" && action["uid"] == top
        return nil if kind == "toZone" && action["uid"] == top && action["zone"] != "field"
        return refuse(kind, "la catena si sta risolvendo, dall'ultima Reattiva alla prima: il resto aspetta (§7.2)", "the chain is resolving, from the last Reactive to the first: everything else waits (§7.2)")
      end

      waiting = chain[:turn]
      case kind
      when "pass"
        unless action["seat"] == waiting && (actor.nil? || actor == waiting)
          return refuse(kind, "accetta chi deve rispondere: tocca a #{waiting.upcase} (§7.2)", "whoever must answer accepts: it's #{waiting.upcase}'s call (§7.2)")
        end
        return nil
      when "toZone"
        if action["zone"] == "field" && action["chain"] == true
          card = @table.card(action["uid"])
          unless card && card[:owner] == waiting
            return refuse(kind, "in catena risponde l'avversario di chi ha giocato l'ultima Reattiva: tocca a #{waiting.upcase} (§7.2)", "on the chain the opponent of whoever played the last Reactive answers: it's #{waiting.upcase}'s call (§7.2)")
          end
          return nil
        end
        # La Reattiva appena giocata che si consuma a vuoto (come blocco, senza attaccante).
        return nil if action["uid"] == top && action["zone"] == "abisso"
      when "declare"
        # Il blocco che accompagna la Reattiva giocata come blocco (RBF-040): della cima, subito.
        return nil if action.dig("declaration", "from") == top && action.dig("declaration", "kind") == "block"
      when "settle"
        return nil if action["uid"] == top
      end
      refuse(kind, "la catena di risposta è atomica: si risponde con una Reattiva o si accetta, il resto aspetta (§7.2)", "the response chain is atomic: answer with a Reactive or accept, everything else waits (§7.2)")
    end

    # «Una carta permanente» (§10): quel che resta in campo — un'Entità o una
    # Materia permanente, mai il Rubyfront, mai un Oggetto. Gemello:
    # effects.ts, permanentOf.
    def permanent_card?(entry)
      entry[:type] == "entity" || (entry[:type] == "matter" && entry[:behavior] == "permanent")
    end

    # §3.1 — la carta è IN GIOCO, cioè i suoi effetti contano?
    #
    # Per ogni carta basta la zona. Per il Rubyfront no: parte in Zona di
    # Richiamo, che sta sulla lavagna ma non è il campo, e lì «è attaccabile
    # — i suoi PV sono un bersaglio valido dall'inizio alla fine della
    # partita — ma abilità (principale e speciali) e Materie sono
    # utilizzabili solo quando è in campo: schierarlo serve a sbloccarle».
    # Lo schieramento è esattamente il passaggio dalla fila di servizio a
    # quella del Fronte (§3.1, costo di schieramento), quindi la fila dice
    # tutto. Fila ignota (lavagna che non la segnava): nel dubbio è in
    # gioco, mai molesto. Gemello: state.ts, inPlay.
    def in_play?(card)
      return false unless card && card[:zone] == "field"

      entry = @cards[card[:card_id]]
      return true unless entry && entry[:type] == "rubyfront"

      card[:row].nil? || FRONT_ROW_Y.include?(card[:row])
    end

    # Il rifiuto per una fonte che sta sulla lavagna ma non è ancora in
    # gioco: oggi solo il Rubyfront in Zona di Richiamo (§3.1). Fonte
    # assente o fuori dal campo: silenzio — di quello parlano, con parole
    # loro, le dogane di ciascuna forma.
    def recall_zone_stopped(kind, source)
      return nil unless source && source[:zone] == "field"
      return nil if in_play?(source)

      refuse(kind, "il Rubyfront in Zona di Richiamo non ha abilità: schieralo per sbloccarle (§3.1)", "a Rubyfront in the Recall Zone has no abilities: deploy it to unlock them (§3.1)")
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
      # §3.1 — l'imbuto di tutte le forme certificate è qui, e qui si ferma
      # la fonte che sta sulla lavagna ma non è in gioco: il Rubyfront in
      # Zona di Richiamo non ha abilità, quindi non innesca niente, in
      # nessuna forma. Prima di ogni altra verifica, e una volta sola.
      recalled = recall_zone_stopped(kind, @table.card(ref["source"]))
      return recalled if recalled

      return judge_resolve_effect(action, ref) if ref["event"] == "on_resolve"
      return judge_flip_effect(action, ref) if ref["event"] == "on_flip"
      if ref["event"] == "on_attack"
        case kind
        when "empower" then return judge_attack_empower(action, ref)
        when "player" then return judge_attack_heal(action, ref)
        when "look" then return judge_attack_look(action, ref)
        when "declare" then return judge_declare(action)
        end
      end
      return judge_enter_refresh(action, ref) if kind == "refresh"
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
    def own_trigger_stopped(kind, ref, action = nil)
      return refuse(kind, "l'effetto proprio ha per ingresso se stessa (§8.2)", "a card's own effect has itself as the entry (§8.2)") unless ref["source"] == ref["entering"]

      source = @table.card(ref["source"])
      return refuse(kind, "la fonte dell'effetto non è in campo (§8.2)", "the effect's source isn't on the field (§8.2)") unless source && source[:zone] == "field"

      case ref["event"]
      when "on_enter_field"
        return refuse(kind, "la fonte non è entrata in campo questo turno: l'innesco è passato (§8.2)", "the source didn't enter the field this turn: the trigger has passed (§8.2)") unless source[:entered] == @table.turn
      when "on_attack"
        return refuse(kind, "«quando attacca» vuole un attacco dichiarato, in Fase di Fronte (§8.2)", "“when it attacks” needs a declared attack, in the Front Phase (§8.2)") unless @table.phase == "fronte" && @table.attacking?(ref["source"])
        return refuse(kind, "questo innesco è già stato risolto (§8.2)", "this trigger has already been resolved (§8.2)") if action && attack_fired?(action, ref)

        return nil
      else
        return refuse(kind, "evento d'effetto sconosciuto (§8.2)", "unknown effect event (§8.2)")
      end
      return refuse(kind, "questo innesco è già stato risolto (§8.2)", "this trigger has already been resolved (§8.2)") if @table.fired?(ref["source"], ref["event"], ref["entering"])

      nil
    end

    # ---- Le forme «quando attacca» (§8.2): il contesto comune ----------
    #
    # L'ingresso del riferimento è chi attacca: in campo, con un attacco
    # dichiarato in Fase di Fronte. La fonte è in campo; la sua carta è
    # nota (ignota: silenzio); il passo non è già consumato; le forme sono
    # quelle della faccia mostrata. Ritorna [rifiuto] o [nil, source,
    # attacker, forms].
    def attack_context(kind, action, ref)
      attacker = @table.card(ref["entering"])
      unless attacker && attacker[:zone] == "field" && @table.phase == "fronte" && @table.attacking?(ref["entering"])
        return [refuse(kind, "«quando attacca» vuole un attacco dichiarato, in Fase di Fronte (§8.2)", "“when it attacks” needs a declared attack, in the Front Phase (§8.2)")]
      end

      source = @table.card(ref["source"])
      return [refuse(kind, "la fonte dell'effetto non è in campo (§8.2)", "the effect's source isn't on the field (§8.2)")] unless source && source[:zone] == "field"

      known = @cards[source[:card_id]]
      return [no_rule(kind)] unless known
      return [refuse(kind, "questo innesco è già stato risolto (§8.2)", "this trigger has already been resolved (§8.2)")] if attack_fired?(action, ref)

      forms = Array(known[:attack_forms]).select { |form| form[:face] == (source[:face] || 0) }
      [nil, source, attacker, forms]
    end

    # Chi è la fonte per l'attaccante, e le condizioni della forma.
    def attack_relation_stopped(kind, form, ref, source, attacker)
      seat = @table.controller_of(source)
      case form[:who]
      when "self"
        return refuse(kind, "l'effetto è di chi attacca: fonte e attaccante non coincidono (§8.2)", "the effect belongs to the attacker: source and attacker don't match (§8.2)") unless ref["source"] == ref["entering"]
      when "object"
        return refuse(kind, "l'Oggetto dev'essere addosso a chi attacca (§8.2)", "the Object must be on the attacker (§8.2)") unless source[:assigned_to] == ref["entering"]
      else
        return refuse(kind, "la fonte dev'essere dello stesso posto di chi attacca (§8.2)", "the source must belong to the attacker's seat (§8.2)") unless seat == @table.controller_of(attacker)
      end
      if (form[:once] == true) != (ref["once"] == true)
        return refuse(kind, "il riferimento non dice se l'innesco è una volta per turno (§8.2)", "the reference doesn't say whether the trigger is once per turn (§8.2)")
      end
      if form[:requires_object] && !@table.armed?(ref["source"])
        return refuse(kind, "«mentre ha un Oggetto assegnato»: senza Oggetto l'innesco non scatta (§8.2)", "“while it has an Object assigned”: without an Object the trigger doesn't fire (§8.2)")
      end
      if form[:attacker_armed] && !@table.armed?(ref["entering"])
        return refuse(kind, "l'innesco vale quando attacca un'Entità con un Oggetto assegnato (§8.2)", "the trigger applies when an Entity with an Object assigned attacks (§8.2)")
      end
      if form[:attackers]
        entry = @cards[attacker[:card_id]]
        return no_rule(kind) unless entry
        unless entry[:type] == form[:attackers][:type] && entry[:race] == form[:attackers][:race]
          return refuse(kind, "l'innesco vale quando attaccano le Entità Umane che controlli (§8.2)", "the trigger applies when the Human Entities you control attack (§8.2)")
        end
      end
      if form[:requires_attackers]
        needed = form[:requires_attackers]
        if attackers_of(seat, needed[:race]) < needed[:count]
          return refuse(kind, "servono almeno #{needed[:count]} Entità Umane all'attacco in questo turno (§8.2)", "it takes at least #{needed[:count]} Human Entities attacking this turn (§8.2)")
        end
      end
      if form[:requires_previous_attackers]
        needed = form[:requires_previous_attackers]
        previous = @table.last_wave(seat).count { |uid| entity_of_race?(uid, needed[:race]) }
        if previous < needed[:count]
          return refuse(kind, "nel tuo turno precedente non hanno attaccato almeno #{needed[:count]} Entità Umane (§8.2)", "at least #{needed[:count]} Human Entities didn't attack on your previous turn (§8.2)")
        end
      end
      nil
    end

    # Quante Entità di `race` di `seat` stanno attaccando adesso.
    def attackers_of(seat, race)
      @table.attackers_in_order.count do |uid|
        card = @table.card(uid)
        card && @table.controller_of(card) == seat && entity_of_race?(uid, race)
      end
    end

    def entity_of_race?(uid, race)
      card = @table.card(uid)
      entry = card && @cards[card[:card_id]]
      entry && entry[:type] == "entity" && (race.nil? || entry[:race] == race)
    end

    def valid_roll?(roll, die)
      roll.is_a?(Integer) && roll.between?(1, die)
    end

    def in_range?(roll, range)
      roll.between?(range[0], range[1])
    end

    # RBF-029, RBF-034, RBF-004, RBF-005: un potenziamento fino a fine turno.
    def judge_attack_empower(action, ref)
      stopped, source, attacker, forms = attack_context("empower", action, ref)
      return stopped if stopped

      targets = if action["restrict"] then "opposing_entity"
                elsif action["grants"] then "next_human_attacker"
                elsif ref["source"] == ref["entering"] then "others_armed"
                else "bearer"
                end
      form = forms.find { |candidate| candidate[:kind] == "empower" && candidate[:targets] == targets }
      return refuse("empower", "la carta non ha un effetto certificato che potenzi così quando attacca (§8.2)", "the card has no certified effect that empowers this way when it attacks (§8.2)") unless form

      stopped = attack_relation_stopped("empower", form, ref, source, attacker)
      return stopped if stopped

      target = @table.card(action["uid"])
      return refuse("empower", "il bersaglio dev'essere in campo (§8.2)", "the target must be on the field (§8.2)") unless target && target[:zone] == "field"

      seat = @table.controller_of(source)
      case targets
      when "bearer"
        return refuse("empower", "il +1 va a chi porta l'Oggetto (§8.2)", "the +1 goes to whoever carries the Object (§8.2)") unless action["uid"] == ref["entering"]
        return refuse("empower", "la Potenza in più è #{form[:power]} (§8.2)", "the extra Power is #{form[:power]} (§8.2)") unless action["power"] == form[:power]
      when "others_armed"
        unless action["uid"] != ref["source"] && @table.controller_of(target) == seat && @table.armed?(action["uid"]) && entity_of_race?(action["uid"], nil)
          return refuse("empower", "il +1 va alle ALTRE Entità con un Oggetto assegnato che controlli (§8.2)", "the +1 goes to the OTHER Entities with an Object assigned that you control (§8.2)")
        end
        return refuse("empower", "la Potenza in più è #{form[:power]} (§8.2)", "the extra Power is #{form[:power]} (§8.2)") unless action["power"] == form[:power]
      when "next_human_attacker"
        return refuse("empower", "le parole chiave concesse non sono quelle della carta (§8.2)", "the granted keywords aren't the card's (§8.2)") unless Array(action["grants"]) == form[:grants]
        order = @table.attack_order(ref["source"])
        after = @table.attackers_in_order.select { |uid| @table.attack_order(uid) > order && @table.controller_of(@table.card(uid)) == seat && entity_of_race?(uid, "human") }
        unless after.first == action["uid"]
          return refuse("empower", "la Vendetta va alla PROSSIMA Entità Umana che attacca in questo turno (§8.2)", "Revenge goes to the NEXT Human Entity that attacks this turn (§8.2)")
        end
      when "opposing_entity"
        return refuse("empower", "il divieto di blocco va a un'Entità avversaria in campo (§8.2)", "the block ban goes to an opposing Entity on the field (§8.2)") unless @table.controller_of(target) != seat && entity_of_race?(action["uid"], nil)
        return refuse("empower", "l'effetto vieta di bloccare, non altro (§8.2)", "the effect forbids blocking, nothing else (§8.2)") unless action["restrict"] == "block" && action["power"].nil?
      end

      allow("empower")
    end

    # RBF-008, RBF-022, RBF-001: PV che cambiano per un attacco.
    def judge_attack_heal(action, ref)
      stopped, source, attacker, forms = attack_context("player", action, ref)
      return stopped if stopped

      form = forms.find { |candidate| candidate[:kind] == "heal" }
      return refuse("player", "la carta non ha un effetto certificato sui PV quando attacca (§8.2)", "the card has no certified HP effect when it attacks (§8.2)") unless form

      stopped = attack_relation_stopped("player", form, ref, source, attacker)
      return stopped if stopped

      patch = action["patch"]
      return refuse("player", "l'effetto tocca solo i PV (§8.2)", "the effect touches only HP (§8.2)") unless patch.is_a?(Hash) && patch.keys == ["hp"] && patch["hp"].is_a?(Integer)

      seat = @table.controller_of(source)
      foe = Table::SEATS.find { |other| other != seat }
      if form[:amount] == "human_attackers"
        roll = action["roll"]
        return refuse("player", "si tira un d#{form[:die]}: l'azione non porta un tiro valido (§8.2)", "a d#{form[:die]} is rolled: the action carries no valid roll (§8.2)") unless valid_roll?(roll, form[:die])

        count = attackers_of(seat, "human")
        if in_range?(roll, form[:gain_on])
          return refuse("player", "con #{roll} guadagni tu #{count} PV (§8.2)", "with #{roll} you gain #{count} HP (§8.2)") unless action["seat"] == seat && patch["hp"] == @table.hp(seat) + count
        elsif in_range?(roll, form[:drain_on])
          return refuse("player", "con #{roll} il Rubyfront/Nexus avversario perde #{count} PV (§8.2)", "with #{roll} the opposing Rubyfront/Nexus loses #{count} HP (§8.2)") unless action["seat"] == foe && patch["hp"] == [0, @table.hp(foe) - count].max
        else
          return refuse("player", "con #{roll} non succede nulla (§8.2)", "with #{roll} nothing happens (§8.2)")
        end
        return allow("player")
      end

      return refuse("player", "guadagna PV chi comanda la fonte (§8.2)", "whoever commands the source gains HP (§8.2)") unless action["seat"] == seat
      return refuse("player", "l'effetto dà #{form[:amount]} PV, non altro (§8.2)", "the effect gives #{form[:amount]} HP, nothing else (§8.2)") unless patch["hp"] == @table.hp(seat) + form[:amount]

      allow("player")
    end

    # RBF-008, il seguito: col tiro giusto un'Entità dal Ritiro in mano.
    def judge_attack_recall(action, ref)
      source = @table.card(ref["source"])
      return refuse("toZone", "la fonte dell'effetto non è in campo (§8.2)", "the effect's source isn't on the field (§8.2)") unless source && source[:zone] == "field"

      known = @cards[source[:card_id]]
      return no_rule("toZone") unless known

      form = Array(known[:attack_forms]).find { |candidate| candidate[:kind] == "heal" && candidate[:then_recall] }
      return refuse("toZone", "la carta non ha un effetto certificato che riporti in mano dopo la cura (§8.2)", "the card has no certified effect that returns to hand after the heal (§8.2)") unless form
      return refuse("toZone", "prima i PV, poi il dado (§8.2)", "HP first, then the die (§8.2)") unless @table.fired?(ref["source"], "on_attack:heal", ref["entering"])
      return refuse("toZone", "questo seguito è già stato risolto (§8.2)", "this follow-up has already been resolved (§8.2)") if attack_fired?(action, ref)

      roll = action["roll"]
      return refuse("toZone", "si tira un d#{form[:die]}: l'azione non porta un tiro valido (§8.2)", "a d#{form[:die]} is rolled: the action carries no valid roll (§8.2)") unless valid_roll?(roll, form[:die])
      return refuse("toZone", "con #{roll} non si riporta nulla in mano (§8.2)", "with #{roll} nothing returns to hand (§8.2)") unless in_range?(roll, form[:on_roll])

      card = @table.card(action["uid"])
      return refuse("toZone", "si riporta in mano un'Entità dalla PROPRIA Zona di Ritiro (§8.2)", "an Entity returns to hand from your OWN Retire Zone (§8.2)") unless card && card[:zone] == "ritiro" && card[:owner] == @table.controller_of(source) && entity_of_race?(action["uid"], nil)
      return refuse("toZone", "la carta torna in mano (§8.2)", "the card returns to hand (§8.2)") unless action["zone"] == "hand"

      allow("toZone")
    end

    # RBF-010: col tiro giusto un'Entità Umana dal Ritiro sul Fronte.
    def judge_attack_return(action, ref)
      stopped, source, attacker, forms = attack_context("toZone", action, ref)
      return stopped if stopped

      form = forms.find { |candidate| candidate[:kind] == "return" }
      return refuse("toZone", "la carta non ha un effetto certificato che riporti in campo col dado (§8.2)", "the card has no certified effect that brings back to the field with a die (§8.2)") unless form

      stopped = attack_relation_stopped("toZone", form, ref, source, attacker)
      return stopped if stopped

      roll = action["roll"]
      return refuse("toZone", "si tira un d#{form[:die]}: l'azione non porta un tiro valido (§8.2)", "a d#{form[:die]} is rolled: the action carries no valid roll (§8.2)") unless valid_roll?(roll, form[:die])
      return refuse("toZone", "con #{roll} nessuno torna sul Fronte (§8.2)", "with #{roll} nobody returns to the Front (§8.2)") unless in_range?(roll, form[:on_roll])

      card = @table.card(action["uid"])
      unless card && card[:zone] == "ritiro" && card[:owner] == @table.controller_of(source) && entity_of_race?(action["uid"], form[:filter][:race])
        return refuse("toZone", "si riporta un'Entità Umana dalla PROPRIA Zona di Ritiro (§8.2)", "a Human Entity returns from your OWN Retire Zone (§8.2)")
      end

      allow("toZone")
    end

    # RBF-010, il seguito: chi torna «attacca insieme» — un attacco con
    # riferimento, esente dall'attesa di evocazione. Ritorna un rifiuto, o nil.
    def attack_join_stopped(action)
      ref = action["effect"]
      return refuse("declare", "solo il seguito di un ritorno attacca con riferimento (§8.2)", "only the follow-up of a return attacks with a reference (§8.2)") unless ref["event"] == "on_attack" && ref["follow"] == "join"

      source = @table.card(ref["source"])
      return refuse("declare", "la fonte dell'effetto non è in campo (§8.2)", "the effect's source isn't on the field (§8.2)") unless source && source[:zone] == "field"

      known = @cards[source[:card_id]]
      form = known && Array(known[:attack_forms]).find { |candidate| candidate[:kind] == "return" && candidate[:joins] }
      return refuse("declare", "la carta non ha un effetto certificato che faccia attaccare chi torna (§8.2)", "the card has no certified effect that makes the returned card attack (§8.2)") unless form
      return refuse("declare", "prima il ritorno sul Fronte, poi l'attacco (§8.2)", "first the return to the Front, then the attack (§8.2)") unless @table.fired?(ref["source"], "on_attack:return", ref["source"])
      return refuse("declare", "questo seguito è già stato risolto (§8.2)", "this follow-up has already been resolved (§8.2)") if attack_fired?(action, ref)

      joiner = @table.card(action.dig("declaration", "from"))
      unless joiner && joiner[:zone] == "field" && joiner[:entered] == @table.turn && @table.controller_of(joiner) == @table.controller_of(source) && action.dig("declaration", "from") == ref["entering"]
        return refuse("declare", "attacca insieme chi è appena tornato sul Fronte (§8.2)", "the one who just returned to the Front attacks along (§8.2)")
      end

      nil
    end

    # RBF-011 (dal 2026-09-05): «quando entra in campo, lancia un d20: con
    # 15–20 stappa tutte le Entità che controlli». La fonte è chi entra —
    # in campo, entrata questo turno, innesco non consumato; il client tira,
    # l'engine verifica il tiro, la soglia, e che la stappata (`untap`)
    # segua il tiro: col tiro mancato l'azione passa e non stappa nessuno,
    # così l'innesco si consuma lo stesso.
    def judge_enter_refresh(action, ref)
      return refuse("refresh", "la stappata di chi entra è un innesco d'ingresso: l'azione dice un altro evento (§8.2)", "the untap of the entering card is an entry trigger: the action names another event (§8.2)") unless ref["event"] == "on_enter_field"

      stopped = own_trigger_stopped("refresh", ref)
      return stopped if stopped

      source = @table.card(ref["source"])
      known = @cards[source[:card_id]]
      return no_rule("refresh") unless known

      form = Array(known[:enter_refreshes]).first
      return refuse("refresh", "la carta non ha un effetto certificato che stappi quando entra (§8.2)", "the card has no certified effect that untaps when it enters (§8.2)") unless form
      return refuse("refresh", "si stappano le Entità di chi comanda la fonte (§8.2)", "the Entities of whoever commands the source untap (§8.2)") unless action["seat"] == @table.controller_of(source)

      roll = action["roll"]
      return refuse("refresh", "si tira un d#{form[:die]}: l'azione non porta un tiro valido (§8.2)", "a d#{form[:die]} is rolled: the action carries no valid roll (§8.2)") unless valid_roll?(roll, form[:die])
      hit = in_range?(roll, form[:on_roll])
      return refuse("refresh", "la stappata c'è solo con #{form[:on_roll][0]}–#{form[:on_roll][1]} (§8.2)", "the untap comes only with #{form[:on_roll][0]}–#{form[:on_roll][1]} (§8.2)") unless (action["untap"] == true) == hit

      allow("refresh")
    end

    # RBF-031: un Oggetto dalla propria Zona di Ritiro addosso a chi attacca, gratis.
    def judge_attack_rearm(action, ref)
      stopped, source, attacker, forms = attack_context("toZone", action, ref)
      return stopped if stopped

      form = forms.find { |candidate| candidate[:kind] == "rearm" }
      return refuse("toZone", "la carta non ha un effetto certificato che riarmi chi attacca (§8.2)", "the card has no certified effect that re-arms the attacker (§8.2)") unless form

      stopped = attack_relation_stopped("toZone", form, ref, source, attacker)
      return stopped if stopped
      return refuse("toZone", "l'Oggetto va addosso a chi attacca (§8.2)", "the Object goes on the attacker (§8.2)") unless action["assignTo"] == ref["entering"] && action["zone"] == "field"
      return refuse("toZone", "l'Oggetto arriva senza pagarne il costo (§8.2)", "the Object comes at no cost (§8.2)") if action.key?("cost")

      object = @table.card(action["uid"])
      entry = object && @cards[object[:card_id]]
      return no_rule("toZone") if object && entry.nil?
      unless object && object[:zone] == "ritiro" && object[:owner] == @table.controller_of(source) && entry[:type] == "object"
        return refuse("toZone", "si assegna un Oggetto dalla PROPRIA Zona di Ritiro (§8.2)", "an Object is assigned from your OWN Retire Zone (§8.2)")
      end
      return refuse("toZone", "l'Entità coperta è intoccabile: niente Oggetti finché non si scopre (§3.1, Oggetti)", "a covered Entity is untouchable: no Objects until it's uncovered (§3.1, Objects)") if attacker[:facedown]

      allow("toZone")
    end

    # RBF-031 e RBF-034: uno sguardo nel mazzo quando si attacca.
    def judge_attack_look(action, ref)
      stopped, source, attacker, forms = attack_context("look", action, ref)
      return stopped if stopped

      form = forms.find { |candidate| candidate[:kind] == "look" }
      return refuse("look", "la carta non ha un effetto certificato che guardi nel mazzo quando attacca (§8.2)", "the card has no certified effect that looks in the deck when it attacks (§8.2)") unless form

      stopped = attack_relation_stopped("look", form, ref, source, attacker)
      return stopped if stopped

      seat = @table.controller_of(source)
      return refuse("look", "si guarda nel proprio mazzo (§8.2)", "you look in your own deck (§8.2)") unless action["seat"] == seat
      if form[:die]
        roll = action["roll"]
        return refuse("look", "si tira un d#{form[:die]}: l'azione non porta un tiro valido (§8.2)", "a d#{form[:die]} is rolled: the action carries no valid roll (§8.2)") unless valid_roll?(roll, form[:die])
        return refuse("look", "con #{roll} non si guarda nel mazzo (§8.2)", "with #{roll} you don't look in the deck (§8.2)") unless in_range?(roll, form[:on_roll])
      end
      return refuse("look", "si guardano le prime #{form[:count]} carte, non #{action["count"]} (§8.2)", "you look at the top #{form[:count]} cards, not #{action["count"]} (§8.2)") unless action["count"] == form[:count]
      unless action["revealTo"] == form[:reveal_to] && action["restTo"] == form[:rest_to]
        return refuse("look", "la mostrata va #{form[:reveal_to] == "hand" ? "in mano" : "nella Zona di Ritiro"}, le altre #{form[:rest_to] == "deck" ? "in fondo al mazzo" : "nella Zona di Ritiro"} (§8.2)", "the revealed card goes #{form[:reveal_to] == "hand" ? "to hand" : "to the Retire Zone"}, the rest #{form[:rest_to] == "deck" ? "to the bottom of the deck" : "to the Retire Zone"} (§8.2)")
      end
      return refuse("look", "questo sguardo non manda nulla in Zona di Ritiro a scelta (§8.2)", "this look sends nothing to the Retire Zone by choice (§8.2)") if action["retire"]

      reveal = action["reveal"]
      if reveal
        top = @table.top_of_deck(seat, form[:count])
        return refuse("look", "la carta mostrata dev'essere fra le prime #{form[:count]} del mazzo (§8.2)", "the revealed card must be among the top #{form[:count]} of the deck (§8.2)") unless top.include?(reveal)

        shown = @table.card(reveal)
        entry = shown && @cards[shown[:card_id]]
        return no_rule("look") unless entry
        wanted = form[:reveal]
        unless entry[:type] == wanted[:type] && (wanted[:race].nil? || entry[:race] == wanted[:race])
          return refuse("look", "si può mostrare solo #{wanted[:type] == "object" ? "un Oggetto" : "una Materia"}: non questa (§8.2)", "only #{wanted[:type] == "object" ? "an Object" : "a Matter"} can be revealed: not this one (§8.2)")
        end
      end

      allow("look")
    end

    # RBF-028, alla risoluzione: chi lo chiede si stappa dopo il combattimento.
    def untap_stopped(action)
      Array(action["untap"]).each do |uid|
        card = @table.card(uid)
        return refuse("resolve", "si stappa dopo il combattimento chi ha attaccato (§8.2)", "whoever attacked untaps after combat (§8.2)") unless card && @table.attackers_in_order.include?(uid)

        known = @cards[card[:card_id]]
        return no_rule("resolve") unless known

        form = Array(known[:attack_forms]).find { |candidate| candidate[:kind] == "untap" }
        return refuse("resolve", "la carta non ha un effetto certificato che la stappi dopo il combattimento (§8.2)", "the card has no certified effect that untaps it after combat (§8.2)") unless form
        return refuse("resolve", "«mentre ha un Oggetto assegnato»: senza Oggetto non si stappa (§8.2)", "“while it has an Object assigned”: without an Object it doesn't untap (§8.2)") if form[:requires_object] && !@table.armed?(uid)
        return refuse("resolve", "si stappa una volta per turno (§8.2)", "it untaps once per turn (§8.2)") if form[:once] && @table.fired?(uid, "on_attack:untap", "turn")
      end
      nil
    end

    def settle_untaps(action)
      return unless action.is_a?(Hash) && action["t"] == "resolve"

      Array(action["untap"]).each { |uid| @table.fire(uid, "on_attack:untap", "turn") }
    end

    # §8.2 — la pesca all'attacco (la forma di RBF-026): la fonte attacca
    # in Fase di Fronte, l'innesco non è consumato (una volta per turno:
    # un'Entità attacca una volta sola), ha un Oggetto assegnato, e pesca
    # chi la comanda, tante carte quante dice la forma. Ignota: silenzio.
    def judge_effect_attack_draw(action, ref)
      return judge_attack_heal_draw(action, ref) if ref["follow"] == "draw"

      stopped = own_trigger_stopped("draw", ref, action)
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

    # RBF-001 (Nexus), il seguito della cura: «pesca una carta, poi scarta».
    def judge_attack_heal_draw(action, ref)
      source = @table.card(ref["source"])
      return refuse("draw", "la fonte dell'effetto non è in campo (§8.2)", "the effect's source isn't on the field (§8.2)") unless source && source[:zone] == "field"

      known = @cards[source[:card_id]]
      return no_rule("draw") unless known

      form = Array(known[:attack_forms]).find { |candidate| candidate[:kind] == "heal" && candidate[:face] == (source[:face] || 0) && candidate[:then_draw].to_i.positive? }
      return refuse("draw", "la carta non ha un effetto certificato che peschi dopo la cura (§8.2)", "the card has no certified effect that draws after the heal (§8.2)") unless form
      return refuse("draw", "prima i PV, poi la pesca (§8.2)", "HP first, then the draw (§8.2)") unless @table.fired?(ref["source"], "on_attack:heal", "turn")
      return refuse("draw", "questo seguito è già stato risolto (§8.2)", "this follow-up has already been resolved (§8.2)") if attack_fired?(action, ref)
      return refuse("draw", "si pesca #{form[:then_draw]} (§8.2)", "you draw #{form[:then_draw]} (§8.2)") unless action["count"] == form[:then_draw]
      return refuse("draw", "pesca chi comanda la fonte, dal proprio mazzo (§8.2)", "whoever commands the source draws, from their own deck (§8.2)") unless action["seat"] == @table.controller_of(source)

      allow("draw")
    end

    # §8.2 — «poi scarta una carta» (RBF-026): il seguito della pesca. Un
    # `toZone` dalla mano all'Abisso marcato con `follow: "discard"`, che
    # passa se la fonte è in campo con una forma che fa scartare, la pesca
    # dell'attacco è già avvenuta e lo scarto dovuto non ancora, e la carta
    # sta nella mano di chi comanda la fonte.
    def judge_effect_discard(action, ref)
      kind = "toZone"

      source = @table.card(ref["source"])
      return refuse(kind, "la fonte dell'effetto non è in campo (§8.2)", "the effect's source isn't on the field (§8.2)") unless source && source[:zone] == "field"

      known = @cards[source[:card_id]]
      return no_rule(kind) unless known

      form = Array(known[:attack_draws]).find { |candidate| candidate[:then_discard].positive? } ||
             Array(known[:attack_forms]).find { |candidate| candidate[:kind] == "heal" && candidate[:face] == (source[:face] || 0) && candidate[:then_discard].to_i.positive? }
      return refuse(kind, "la carta non ha un effetto certificato che faccia scartare (§8.2)", "the card has no certified effect that makes you discard (§8.2)") unless form
      drawn = @table.fired?(ref["source"], "on_attack:draw", ref["entering"]) || @table.fired?(ref["source"], "on_attack:draw", "turn")
      return refuse(kind, "lo scarto viene dopo la pesca: prima si pesca (§8.2)", "the discard comes after the draw: draw first (§8.2)") unless drawn
      return refuse(kind, "lo scarto dovuto è già stato fatto (§8.2)", "the discard owed has already been made (§8.2)") if attack_fired?(action, ref)

      card = @table.card(action["uid"])
      return refuse(kind, "si scarta una carta dalla propria mano (§8.2)", "you discard a card from your own hand (§8.2)") unless card && card[:zone] == "hand" && card[:owner] == @table.controller_of(source)

      allow(kind)
    end

    def judge_effect_move(action, ref)
      return judge_effect_discard(action, ref) if action["zone"] == "abisso" && ref["follow"] == "discard"
      if ref["event"] == "on_attack"
        return judge_attack_recall(action, ref) if ref["follow"] == "recall"
        return judge_attack_rearm(action, ref) if action.key?("assignTo")
        return judge_attack_return(action, ref) if action["zone"] == "field" && action.key?("roll")
      end

      stopped = own_trigger_stopped("toZone", ref, action)
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
        unless permanent_card?(entry)
          return refuse("toZone", "si riporta una carta permanente, non questa (§8.2)", "a permanent card is brought back, not this one (§8.2)")
        end
        # §6.2, Fronte pieno: «anche la parte d'effetto che metterebbe in
        # campo non si applica». Riguarda le sole Entità — una Materia
        # permanente sta dietro il Fronte e non occupa uno slot (§5).
        if entry[:type] == "entity" && count_entities(@table.controller_of(source), nil) >= 5
          return refuse("toZone", "il Fronte è pieno: cinque Entità sono il massimo (§6.2, Fronte pieno)", "the Front is full: five Entities are the maximum (§6.2, Full Front)")
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
      return refuse("release", "si restituisce sul Fronte o nella Zona di Ritiro (§8.2)", "it's returned to the Front or to the Retire Zone (§8.2)") unless %w[field ritiro].include?(action["zone"])

      # §8.2 — il permanente esiliato (RBF-018): «quando questa carta lascia
      # il gioco, quel permanente torna in gioco» — e non prima.
      if card[:held_by]
        holder = @table.card(card[:held_by])
        if holder && holder[:zone] == "field"
          return refuse("release", "quel permanente resta nell'Abisso finché la carta che lo tiene è in gioco (§8.2)", "that permanent stays in the Abyss as long as the card holding it is in play (§8.2)")
        end

        return allow("release")
      end
      return refuse("release", "la carta non è sotto controllo (§8.2)", "the card isn't under control (§8.2)") unless card[:controller]
      return refuse("release", "si restituisce a fine turno, non prima (§8.2)", "it's returned at end of turn, not before (§8.2)") if card[:controller] == @table.active
      return refuse("release", "si restituisce sul Fronte o nella Zona di Ritiro (§8.2)", "it's returned to the Front or to the Retire Zone (§8.2)") unless %w[field ritiro].include?(action["zone"])

      allow("release")
    end

    # Le Entità (di `race`) che `seat` comanda in campo — le sue e quelle
    # che controlla (§8.2) — tranne `except`.
    def count_entities(seat, race, except: nil)
      @table.commanded_cards(seat).count do |card|
        next false if except && @table.card(except).equal?(card)

        entry = @cards[card[:card_id]]
        entry && entry[:type] == "entity" && (race.nil? || entry[:race] == race)
      end
    end

    # §8.2 — lo sconto dichiarato giocando una Materia (RBF-021): quanto
    # costa in meno, dato il bersaglio nell'azione. Zero se non c'è forma,
    # bersaglio, o il bersaglio non è nello stato chiesto.
    def discount_for(known, action)
      form = Array(known[:resolve_forms]).find { |candidate| candidate[:kind] == "destroy" && candidate[:discount] }
      target = action["target"].is_a?(String) ? @table.card(action["target"]) : nil
      return 0 unless form && target && target[:zone] == "field" && entity_of_race?(action["target"], nil)
      return 0 unless form[:discount][:if_target] == "tapped" && target[:tapped]

      form[:discount][:amount]
    end

    # ---- Le Materie alla risoluzione (§7.2, §8.2) ----------------------------
    #
    # Il contesto comune: la fonte è la Materia stessa (fonte e ingresso
    # coincidono), in campo, scesa QUESTO turno — l'effetto si risolve
    # giocandola; la carta è nota (ignota: silenzio); il passo non è già
    # consumato. Ritorna [rifiuto] o [nil, source, forms].
    def resolve_context(kind, action, ref)
      return [refuse(kind, "l'effetto di una Materia ha per ingresso se stessa (§7.2)", "a Matter's effect has itself as the entry (§7.2)")] unless ref["source"] == ref["entering"]

      source = @table.card(ref["source"])
      return [refuse(kind, "la fonte dell'effetto non è in campo (§8.2)", "the effect's source isn't on the field (§8.2)")] unless source && source[:zone] == "field"

      known = @cards[source[:card_id]]
      return [no_rule(kind)] unless known
      return [refuse(kind, "l'effetto di una Materia si risolve quando la si gioca: questa non è scesa in campo questo turno (§7.2)", "a Matter's effect resolves when it's played: this one didn't come down this turn (§7.2)")] unless source[:entered] == @table.turn
      return [refuse(kind, "questo passo è già stato risolto (§8.2)", "this step has already been resolved (§8.2)")] if resolve_fired?(action, ref)

      [nil, source, Array(known[:resolve_forms])]
    end

    def judge_resolve_effect(action, ref)
      kind = action["t"]
      stopped, source, forms = resolve_context(kind, action, ref)
      return stopped if stopped

      seat = @table.controller_of(source)
      case kind
      when "look" then judge_resolve_look(action, ref, source, forms, seat)
      when "empower" then judge_resolve_empower(action, ref, source, forms, seat)
      when "toZone"
        if action["zone"] == "field" then judge_fortune_step(action, ref, source, forms, seat)
        elsif action["zone"] == "ritiro" then judge_resolve_move(action, ref, source, forms, seat)
        elsif forms.any? { |form| form[:kind] == "destroy" } then judge_resolve_destroy(action, ref, source, forms, seat)
        else judge_resolve_exile(action, ref, source, forms, seat)
        end
      when "player"
        forms.any? { |form| form[:kind] == "block" } ? judge_resolve_block(action, ref, source, forms, seat) : judge_fortune_step(action, ref, source, forms, seat)
      when "draw" then judge_fortune_step(action, ref, source, forms, seat)
      else refuse(kind, "una Materia certificata guarda, potenzia, sposta, distrugge, cura o pesca soltanto, per ora (§8.2)", "a certified Matter only looks, empowers, moves, destroys, heals or draws, for now (§8.2)")
      end
    end

    # RBF-040 — «giocala come blocco a un attaccante: quell'attacco è
    # bloccato. Se sul tuo Fronte ci sono almeno 2 Entità con un Oggetto
    # assegnato, guadagni 3 PV». Il blocco è la giocata stessa (§6.4, la
    # dichiarazione dalla Materia); il passo è la cura: di chi comanda la
    # fonte, esatta, con gli armati che bastano.
    def judge_resolve_block(action, ref, source, forms, seat)
      form = forms.find { |candidate| candidate[:kind] == "block" }
      patch = action["patch"]
      return refuse("player", "guadagna PV chi comanda la fonte (§8.2)", "whoever commands the source gains HP (§8.2)") unless action["seat"] == seat
      unless patch.is_a?(Hash) && patch.keys == ["hp"] && patch["hp"] == @table.hp(seat) + form[:heal]
        return refuse("player", "l'effetto dà #{form[:heal]} PV, non altro (§8.2)", "the effect gives #{form[:heal]} HP, nothing else (§8.2)")
      end
      if armed_entities(seat) < form[:requires_armed]
        return refuse("player", "servono almeno #{form[:requires_armed]} Entità con un Oggetto assegnato sul tuo Fronte (§8.2)", "it takes at least #{form[:requires_armed]} Entities with an Object assigned on your Front (§8.2)")
      end

      allow("player")
    end

    # Le Entità di `seat` in campo con un Oggetto addosso (§3.1).
    def armed_entities(seat)
      @table.armed_uids(seat).count { |uid| entity_of_race?(uid, nil) }
    end

    # RBF-015: guarda le prime N, mostra un'Entità Umana, in mano, le altre in fondo.
    def judge_resolve_look(action, ref, source, forms, seat)
      form = forms.find { |candidate| candidate[:kind] == "look" }
      return refuse("look", "la Materia non ha un effetto certificato che guardi nel mazzo (§8.2)", "the Matter has no certified effect that looks in the deck (§8.2)") unless form
      return refuse("look", "si guarda nel proprio mazzo (§8.2)", "you look in your own deck (§8.2)") unless action["seat"] == seat
      return refuse("look", "si guardano le prime #{form[:count]} carte, non #{action["count"]} (§8.2)", "you look at the top #{form[:count]} cards, not #{action["count"]} (§8.2)") unless action["count"] == form[:count]
      return refuse("look", "la mostrata va in mano, le altre in fondo al mazzo (§8.2)", "the revealed card goes to hand, the rest to the bottom of the deck (§8.2)") unless [nil, "hand"].include?(action["revealTo"]) && [nil, "deck"].include?(action["restTo"])
      return refuse("look", "questo sguardo non manda nulla in Zona di Ritiro (§8.2)", "this look sends nothing to the Retire Zone (§8.2)") if action["retire"]

      reveal = action["reveal"]
      if reveal
        top = @table.top_of_deck(seat, form[:count])
        return refuse("look", "la carta mostrata dev'essere fra le prime #{form[:count]} del mazzo (§8.2)", "the revealed card must be among the top #{form[:count]} of the deck (§8.2)") unless top.include?(reveal)

        shown = @table.card(reveal)
        entry = shown && @cards[shown[:card_id]]
        return no_rule("look") unless entry
        wanted = form[:reveal]
        unless entry[:type] == wanted[:type] && (wanted[:race].nil? || entry[:race] == wanted[:race])
          return refuse("look", "si può mostrare solo un'Entità Umana: non questa (§8.2)", "only a Human Entity can be revealed: not this one (§8.2)")
        end
      end

      allow("look")
    end

    # RBF-016 (stappa un'Entità Umana: +1) e RBF-020 (in Reazione: stappa gli Umani, Contrattacco +1).
    def judge_resolve_empower(action, ref, source, forms, seat)
      form = forms.find { |candidate| candidate[:kind] == "empower" && (action["counter"] ? candidate[:counter] : candidate[:power]) }
      return refuse("empower", "la Materia non ha un effetto certificato che potenzi così (§8.2)", "the Matter has no certified effect that empowers this way (§8.2)") unless form

      target = @table.card(action["uid"])
      return refuse("empower", "il bersaglio dev'essere in campo (§8.2)", "the target must be on the field (§8.2)") unless target && target[:zone] == "field"
      unless @table.controller_of(target) == seat && entity_of_race?(action["uid"], form[:race])
        return refuse("empower", "si stappa un'Entità Umana che controlli (§8.2)", "you untap a Human Entity you control (§8.2)")
      end
      return refuse("empower", "l'effetto stappa: l'azione non lo dice (§8.2)", "the effect untaps: the action doesn't say so (§8.2)") unless action["untap"] == true

      if form[:targets] == "own_entity"
        return refuse("empower", "la Potenza in più è #{form[:power]} (§8.2)", "the extra Power is #{form[:power]} (§8.2)") unless action["power"] == form[:power] && action["counter"].nil?
        return refuse("empower", "si stappa UN'Entità: questo passo è già stato risolto (§8.2)", "you untap ONE Entity: this step has already been resolved (§8.2)") if @table.fired_prefix?(ref["source"], "on_resolve:empower:")
      else
        return refuse("empower", "il Contrattacco in più è #{form[:counter]} (§8.2)", "the extra Counterattack is #{form[:counter]} (§8.2)") unless action["counter"] == form[:counter] && action["power"].nil?
        # RBF-020 si gioca in Reazione, la finestra del difensore (§6.4),
        # ma non blocca nessun attaccante — decisione del designer
        # (2026-09-05): il suo effetto è tutto quel che fa, e non pretende
        # una dichiarazione di blocco.
        needed = form[:requires]
        if needed && count_entities(seat, needed[:race]) < needed[:count]
          return refuse("empower", "servono almeno #{needed[:count]} Entità Umane sul tuo Fronte (§8.2)", "it takes at least #{needed[:count]} Human Entities on your Front (§8.2)")
        end
      end

      allow("empower")
    end

    # RBF-017: un'Entità avversaria con costo di Flusso N o inferiore nella Zona di Ritiro.
    def judge_resolve_move(action, ref, source, forms, seat)
      form = forms.find { |candidate| candidate[:kind] == "move" && candidate[:to] == "ritiro" }
      return refuse("toZone", "la Materia non ha un effetto certificato che mandi in Zona di Ritiro (§8.2)", "the Matter has no certified effect that sends to the Retire Zone (§8.2)") unless form

      target = @table.card(action["uid"])
      return refuse("toZone", "il bersaglio dev'essere in campo (§8.2)", "the target must be on the field (§8.2)") unless target && target[:zone] == "field"
      return refuse("toZone", "il bersaglio dev'essere avversario (§8.2)", "the target must be an opponent's (§8.2)") if @table.controller_of(target) == seat

      entry = @cards[target[:card_id]]
      return no_rule("toZone") unless entry
      return refuse("toZone", "il bersaglio dev'essere un'Entità (§8.2)", "the target must be an Entity (§8.2)") unless entry[:type] == "entity"

      max_cost = form[:target][:max_cost]
      if max_cost && !(entry[:flux_cost] && entry[:flux_cost] <= max_cost)
        return refuse("toZone", "si manda in Ritiro un'Entità con costo di Flusso #{max_cost} o inferiore (§8.2)", "an Entity with Flux cost #{max_cost} or lower goes to Retire (§8.2)")
      end

      allow("toZone")
    end

    # RBF-018: un permanente avversario nell'Abisso, tenuto fermo finché questa carta resta in gioco.
    def judge_resolve_exile(action, ref, source, forms, seat)
      form = forms.find { |candidate| candidate[:kind] == "exile" }
      return refuse("toZone", "la Materia non ha un effetto certificato che esili (§8.2)", "the Matter has no certified effect that exiles (§8.2)") unless form
      return refuse("toZone", "il permanente va nell'Abisso, tenuto da questa carta (§8.2)", "the permanent goes to the Abyss, held by this card (§8.2)") unless action["zone"] == "abisso" && action["heldBy"] == ref["source"]

      target = @table.card(action["uid"])
      return refuse("toZone", "il bersaglio dev'essere in campo (§8.2)", "the target must be on the field (§8.2)") unless target && target[:zone] == "field"
      return refuse("toZone", "il bersaglio dev'essere avversario (§8.2)", "the target must be an opponent's (§8.2)") if @table.controller_of(target) == seat

      entry = @cards[target[:card_id]]
      return no_rule("toZone") unless entry
      permanent = entry[:type] == "entity" || (entry[:type] == "matter" && entry[:behavior] == "permanent")
      return refuse("toZone", "un permanente avversario: un'Entità o una Materia permanente (§8.2)", "an opposing permanent: an Entity or a permanent Matter (§8.2)") unless permanent

      allow("toZone")
    end

    # RBF-021: distruggi un'Entità — quella dichiarata giocando la carta, se c'è.
    def judge_resolve_destroy(action, ref, source, forms, seat)
      form = forms.find { |candidate| candidate[:kind] == "destroy" }
      return refuse("toZone", "la Materia non ha un effetto certificato che distrugga (§8.2)", "the Matter has no certified effect that destroys (§8.2)") unless form
      return refuse("toZone", "chi è distrutto va nell'Abisso (§8.2)", "whoever is destroyed goes to the Abyss (§8.2)") unless action["zone"] == "abisso"

      target = @table.card(action["uid"])
      return refuse("toZone", "il bersaglio dev'essere in campo (§8.2)", "the target must be on the field (§8.2)") unless target && target[:zone] == "field"
      if source[:target] && source[:target] != action["uid"]
        return refuse("toZone", "la carta è stata giocata contro un altro bersaglio: l'effetto colpisce quello (§8.2)", "the card was played against another target: the effect hits that one (§8.2)")
      end

      entry = @cards[target[:card_id]]
      return no_rule("toZone") unless entry
      return refuse("toZone", "il bersaglio dev'essere un'Entità (§8.2)", "the target must be an Entity (§8.2)") unless entry[:type] == "entity"
      case form[:target][:controller]
      when "opponent" then return refuse("toZone", "il bersaglio dev'essere avversario (§8.2)", "the target must be an opponent's (§8.2)") if @table.controller_of(target) == seat
      when "controller" then return refuse("toZone", "il bersaglio dev'essere una propria Entità (§8.2)", "the target must be one of your Entities (§8.2)") if @table.controller_of(target) != seat
      end

      allow("toZone")
    end

    # RBF-019: il d20 a fasce — ogni passo porta il tiro, lo stesso per tutti,
    # e vale solo nella sua fascia (o con il «tutti e tre»).
    def judge_fortune_step(action, ref, source, forms, seat)
      kind = action["t"]
      form = forms.find { |candidate| candidate[:kind] == "fortune" }
      return refuse(kind, "la Materia non ha un effetto certificato a dado (§8.2)", "the Matter has no certified die effect (§8.2)") unless form

      roll = action["roll"]
      return refuse(kind, "si tira un d#{form[:die]}: l'azione non porta un tiro valido (§8.2)", "a d#{form[:die]} is rolled: the action carries no valid roll (§8.2)") unless valid_roll?(roll, form[:die])
      fixed = @table.roll_of(ref["source"])
      return refuse(kind, "il dado si tira una volta: è uscito #{fixed}, non #{roll} (§8.2)", "the die is rolled once: it came up #{fixed}, not #{roll} (§8.2)") if fixed && fixed != roll

      band = lambda do |range|
        in_range?(roll, range) || in_range?(roll, form[:all_on])
      end
      case kind
      when "player"
        patch = action["patch"]
        return refuse(kind, "con #{roll} non si guadagnano PV (§8.2)", "with #{roll} you gain no HP (§8.2)") unless band.call(form[:gain][:on])
        return refuse(kind, "guadagna PV chi comanda la fonte (§8.2)", "whoever commands the source gains HP (§8.2)") unless action["seat"] == seat
        unless patch.is_a?(Hash) && patch.keys == ["hp"] && patch["hp"] == @table.hp(seat) + form[:gain][:amount]
          return refuse(kind, "l'effetto dà #{form[:gain][:amount]} PV, non altro (§8.2)", "the effect gives #{form[:gain][:amount]} HP, nothing else (§8.2)")
        end
      when "draw"
        return refuse(kind, "con #{roll} non si pesca (§8.2)", "with #{roll} you don't draw (§8.2)") unless band.call(form[:draw][:on])
        return refuse(kind, "pesca chi comanda la fonte, dal proprio mazzo (§8.2)", "whoever commands the source draws, from their own deck (§8.2)") unless action["seat"] == seat
        return refuse(kind, "si pesca #{form[:draw][:count]} (§8.2)", "you draw #{form[:draw][:count]} (§8.2)") unless action["count"] == form[:draw][:count]
      when "toZone"
        return refuse(kind, "con #{roll} nessuno scende sul Fronte (§8.2)", "with #{roll} nobody comes down to the Front (§8.2)") unless band.call(form[:deploy][:on])
        return refuse(kind, "l'Entità arriva senza pagarne il costo (§8.2)", "the Entity comes at no cost (§8.2)") if action.key?("cost")

        card = @table.card(action["uid"])
        filter = form[:deploy][:filter]
        entry = card && @cards[card[:card_id]]
        return no_rule(kind) if card && entry.nil?
        unless card && card[:zone] == "hand" && card[:owner] == seat && entry[:type] == "entity" && (filter[:race].nil? || entry[:race] == filter[:race]) &&
               (filter[:max_cost].nil? || (entry[:flux_cost] && entry[:flux_cost] <= filter[:max_cost]))
          return refuse(kind, "si mette sul Fronte un'Entità Umana con costo di Flusso #{filter[:max_cost]} o inferiore dalla propria mano (§8.2)", "a Human Entity with Flux cost #{filter[:max_cost]} or lower comes onto the Front from your own hand (§8.2)")
        end
        return refuse(kind, "il Fronte è pieno: cinque Entità sono il massimo (§6.2, Fronte pieno)", "the Front is full: five Entities are the maximum (§6.2, Full Front)") if count_entities(seat, nil) >= 5
        return refuse(kind, "le Entità stanno sugli slot del Fronte, nella propria fila (§5)", "Entities sit on the Front slots, in their own row (§5)") unless on_slot?(card, action)
      end

      allow(kind)
    end

    # ---- Il Nexus (§3.1) -------------------------------------------------------
    #
    # Il flip verso il Nexus: «i requisiti sono scritti sulla carta e vanno
    # soddisfatti al momento del flip», «il Rubyfront dev'essere in campo»,
    # «in qualsiasi momento del proprio turno, dalla Preparazione fino alla
    # fine del turno» — il modello ha Preparazione e Fronte, e in Reazione
    # comanda il difensore. Lo scarto del requisito e il recupero di PV
    # viaggiano nell'azione (`discard`, `recover`) e i due gemelli li
    # applicano; qui si verifica la forma. Il Nexus «rimane in campo per
    # tutta la partita»: indietro non si flippa. Requisito non certificato in
    # anagrafe: silenzio, il flip resta a mano.
    def judge_flip(action)
      card = @table.card(action["uid"])
      return no_rule("flip") unless card

      known = @cards[card[:card_id]]
      return no_rule("flip") unless known && known[:type] == "rubyfront"

      nexus = known[:nexus]
      return no_rule("flip") unless nexus

      face = action["face"].to_i
      if card[:face] == nexus[:face]
        return refuse("flip", "il Nexus rimane in campo per tutta la partita: non si torna al Rubyfront (§3.1)", "the Nexus stays on the field for the whole game: no going back to the Rubyfront (§3.1)")
      end
      return no_rule("flip") unless face == nexus[:face]

      deployed = card[:zone] == "field" && (card[:row].nil? || FRONT_ROW_Y.include?(card[:row]))
      return refuse("flip", "il Rubyfront dev'essere in campo: dalla Zona di Richiamo non si flippa (§3.1)", "the Rubyfront must be on the field: no flipping from the Recall Zone (§3.1)") unless deployed
      unless card[:owner] == @table.active && %w[preparazione fronte].include?(@table.phase)
        return refuse("flip", "si flippa nel proprio turno, dalla Preparazione al Fronte (§3.1)", "you flip on your own turn, from Preparation to the Front (§3.1)")
      end

      nexus[:conditions].each do |condition|
        have = count_entities(card[:owner], condition[:race])
        next if have >= condition[:count]

        return refuse("flip", "il Nexus vuole almeno #{condition[:count]} Entità Umane che controlli: ne hai #{have} (§3.1)", "the Nexus takes at least #{condition[:count]} Human Entities you control: you have #{have} (§3.1)")
      end
      if nexus[:discard]
        discard = @table.card(action["discard"])
        entry = discard && @cards[discard[:card_id]]
        unless discard && discard[:zone] == "hand" && discard[:owner] == card[:owner]
          return refuse("flip", "il flip chiede di scartare una carta Entità dalla mano (§3.1)", "the flip asks you to discard an Entity card from your hand (§3.1)")
        end
        if entry && nexus[:discard][:type] && entry[:type] != nexus[:discard][:type]
          return refuse("flip", "si scarta una carta Entità, non questa (§3.1)", "an Entity card is discarded, not this one (§3.1)")
        end
      end
      recover = action["recover"]
      expected = nexus[:recovery] || 0
      unless (recover || 0) == expected
        return refuse("flip", "il Nexus recupera #{expected} PV, non #{recover || 0} (§3.1)", "the Nexus recovers #{expected} HP, not #{recover || 0} (§3.1)")
      end

      allow("flip")
    end

    # «Quando flippa» (RBF-001): la fonte è il Nexus appena flippato — in
    # campo, sulla faccia del Nexus, flippato QUESTO turno; il passo è uno
    # spostamento (la carta nominata dal proprio Fronte nell'Abisso) o il
    # sigillo (la patch `sealed` del posto, con quella carta in più).
    def judge_flip_effect(action, ref)
      kind = action["t"]
      return refuse(kind, "l'effetto del flip ha per ingresso il Nexus stesso (§3.1)", "the flip's effect has the Nexus itself as the entry (§3.1)") unless ref["source"] == ref["entering"]

      source = @table.card(ref["source"])
      return refuse(kind, "la fonte dell'effetto non è in campo (§8.2)", "the effect's source isn't on the field (§8.2)") unless source && source[:zone] == "field"

      known = @cards[source[:card_id]]
      return no_rule(kind) unless known
      return refuse(kind, "«quando flippa» vuole un Nexus flippato questo turno (§3.1)", "“when it flips” takes a Nexus flipped this turn (§3.1)") unless source[:flipped] == @table.turn && known[:nexus] && source[:face] == known[:nexus][:face]
      return refuse(kind, "questo passo è già stato risolto (§8.2)", "this step has already been resolved (§8.2)") if resolve_fired?(action, ref)

      seat = @table.controller_of(source)
      forms = Array(known[:flip_forms])
      case kind
      when "toZone"
        form = forms.find { |candidate| candidate[:kind] == "move" }
        return refuse(kind, "il Nexus non ha un effetto certificato che sposti quando flippa (§8.2)", "the Nexus has no certified effect that moves when it flips (§8.2)") unless form
        return refuse(kind, "la carta va nell'Abisso (§8.2)", "the card goes to the Abyss (§8.2)") unless action["zone"] == form[:to]

        target = @table.card(action["uid"])
        unless target && target[:zone] == "field" && target[:card_id] == form[:card_id] && @table.controller_of(target) == seat
          return refuse(kind, "va nell'Abisso #{form[:card_id]}, dal proprio Fronte (§8.2)", "#{form[:card_id]} goes to the Abyss, from your own Front (§8.2)")
        end
      when "player"
        form = forms.find { |candidate| candidate[:kind] == "seal" }
        return refuse(kind, "il Nexus non ha un effetto certificato che sigilli quando flippa (§8.2)", "the Nexus has no certified effect that seals when it flips (§8.2)") unless form
        return refuse(kind, "il sigillo è di chi comanda il Nexus (§8.2)", "the seal belongs to whoever commands the Nexus (§8.2)") unless action["seat"] == seat

        patch = action["patch"]
        expected = (@table.sealed(seat) + [form[:card_id]]).uniq
        unless patch.is_a?(Hash) && patch.keys == ["sealed"] && patch["sealed"] == expected
          return refuse(kind, "il sigillo aggiunge #{form[:card_id]} alle carte che non puoi più giocare, e basta (§8.2)", "the seal adds #{form[:card_id]} to the cards you can no longer play, nothing else (§8.2)")
        end
      else
        return refuse(kind, "«quando flippa» sposta o sigilla soltanto (§8.2)", "“when it flips” only moves or seals (§8.2)")
      end

      allow(kind)
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
