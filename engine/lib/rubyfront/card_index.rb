# frozen_string_literal: true

require "json"

module Rubyfront
  # L'anagrafe delle carte: id -> tipo, razza, parole chiave e concessioni
  # certificate, letti dai dati del sito (data/sets/*/cards/*/<id>.json — il
  # file dati, non i testi *.it/.en).
  #
  # È l'unico punto in cui l'engine tocca il resto del repo, ed è un confine
  # esplicito: il percorso arriva da fuori (bin/server lo risolve, e
  # RUBYFRONT_DATA lo cambia). Quando l'engine emigrerà in un repo suo,
  # cambierà questo percorso e nient'altro. Il giudizio (engine.rb) riceve
  # l'indice già pronto e non fa mai I/O.
  module CardIndex
    # data_dir -> {
    #   "<id>" => { type: "entity", race: "human", keywords: ["surge"],
    #                  power: 3, counterattack: nil, health: nil, grants_while_assigned: [] },
    #   "<id>" => { type: "object", race: nil, keywords: [], power: nil,
    #                  counterattack: nil,
    #                  grants_while_assigned: [{ keywords: ["stasis"], if_race: "human" }] },
    #   ...
    # }
    #
    # `deployment` è il costo di schieramento del Rubyfront (§3.1): fisso o
    # a dado, { fixed:, die: }, nil per chi non è un Rubyfront.
    #
    # `matter` è l'etichetta di una Materia (§7.1): tipo ("dynamic",
    # "dimensional", "destructive", "zero", "dominant") e grado (1 o 2; nil
    # per Zero e Dominante, che non hanno gradi) — nil per chi non è una
    # Materia. `enables` sono le abilitazioni (§7), UNA LISTA PER FACCIA
    # nell'ordine delle facce: il Nexus abilita solo ciò che è stampato sulla
    # sua faccia (§3.1). Ogni voce: { type:, max_grade: } — «fino a che
    # grado» (§7.1), nil dove il grado non c'è.
    #
    # `enter_listeners` sono gli ascoltatori d'ingresso CERTIFICATI (§8.2,
    # regola d'oro): «quando un'altra Entità [di razza X] entra sul tuo
    # Fronte, se ne controlli almeno N [di razza Y], pesca K carte». Ogni voce: { entering_race:, requires: { count:,
    # race: }, draw: }. Tutto ciò che non combacia esattamente non entra.
    #
    # `enter_moves` sono gli spostamenti all'ingresso CERTIFICATI (§8.2):
    # «quando questa Entità entra sul Fronte, metti un'Entità avversaria nella
    # Zona di Ritiro» (forma senza carte dal 2026-09-04). Ogni voce: { target: { type:,
    # controller: }, to: }.
    #
    # `enter_returns` sono i ritorni all'ingresso CERTIFICATI (§8.2): «quando
    # questa Entità entra sul Fronte, metti sul tuo Fronte una carta permanente
    # dalla tua Zona di Ritiro». Ogni voce: { from:,
    # filter: { type:, behavior: }, to: }.
    #
    # `enter_looks` sono gli sguardi nel mazzo CERTIFICATI (§8.2): «guarda le
    # prime N carte del tuo mazzo, puoi mostrarne una [di tipo e razza] e
    # aggiungerla alla mano, [mettine una nella Zona di Ritiro,] metti le
    # altre in fondo» — con N fisso, o N = base + ceil(tiro/2) con un dado. Ogni voce: { count:, die:, count_base:,
    # reveal: { type:, race: }, then_retire: }.
    #
    # `enter_controls` sono i controlli all'ingresso CERTIFICATI (§8.2):
    # «prendi il controllo di un'Entità avversaria con costo di Flusso N o
    # inferiore fino alla fine del turno; ottiene [parole chiave]». Ogni voce: { target: { type:, controller:, max_cost: },
    # grants: [...] }.
    #
    # `behavior` è il comportamento di una Materia (§7.2): "normal",
    # "permanent" o "reactive" — nil per chi non è una Materia. Serve alla
    # finestra di gioco: le Reattive sono le sole carte che scendono in Fase
    # di Fronte.
    #
    # `flux_cost` è il costo di Flusso stampato (§3.2): Entità, Materie e
    # Oggetti lo pagano giocandoli dalla mano. Il Rubyfront ha un costo di
    # schieramento a parte (`deploymentCost`, anche a dado): non sta qui.
    #
    # `static_forms` sono gli statici di Potenza CERTIFICATI (§8.2, «Modifiche
    # alla Potenza»): valgono finché la carta è in campo (o addosso a
    # un'Entità), e la risoluzione li conta.
    #
    #   { kind: "self_power", amount:, while_attacking: true, requires_other: { type:, race: } }
    #   { kind: "self_power", amount:, per_other: { type:, race: } }
    #   { kind: "bearer_power", amount: }
    #   { kind: "bearer_power", amount:, per: { type:, race: }, multi_block: true }
    #
    # `resolve_forms` sono gli effetti delle Materie CERTIFICATI (§7.2,
    # «l'effetto si risolve»), letti dall'evento `on_resolve`:
    #
    #   { kind: "look", count:, reveal: { type:, race: }, reveal_to: "hand", rest_to: "deck", show_up_to: }
    #   { kind: "empower", targets: "own_entity", race:, power:, untap: true }
    #   { kind: "move", target: { type: "entity", controller: "opponent", max_cost: }, to: "ritiro", discount: nil | { amount:, if_armed_at_least: } }
    #   { kind: "exile", target: { permanent: true, controller: "opponent" }, to: "abisso", hold: true }
    #   { kind: "weaken", target: { type: "entity", controller: "opponent", attacking: true }, amount: -1, per_armed: true } — l'attaccante avversario, −1 per ogni propria armata
    #   { kind: "empower", targets: "own_armed", power:, up_to:, untap: true } — fino a N proprie armate, +M e stappate
    #   { kind: "fortune", die:, gain: { on:, amount: }, deploy: { on:, filter: }, draw: { on:, count: }, all_on: }
    #   { kind: "empower", targets: "own_entities", race:, counter:, untap: true, requires: { count:, race: } } — la stappata di gruppo: in Reazione, senza bloccare
    #   { kind: "destroy", target: { type: "entity", controller: "any" }, to: "abisso", discount: { amount:, if_target: "tapped" }, then_lose: nil | N } — «poi perdi N PV»
    #   { kind: "drain", amount: "objects" } — il Rubyfront/Nexus avversario perde PV pari ai propri Oggetti assegnati
    #   { kind: "search", count:, die:, bands: { type => [lo, hi] }, reveal_to: "hand", if_no_reveal_top: true, then_retire: true, rest_to: "deck" } — la ricerca col dado
    #   { kind: "block", requires_armed:, heal:, as_block: true } — giocata come bloccante di un'Entità attaccante (§6.4); con N armati sul Fronte, +M PV
    #
    # `assign_forms` sono gli effetti CERTIFICATI «quando assegni questa
    # carta a un'Entità» (§3.1, §8.2), evento `on_assign_object`:
    #
    #   { kind: "exile", target: { type: "entity", controller: "opponent" }, to: "abisso", hold: true } — l'esilio condizionato, tenuto dall'Oggetto
    #   { kind: "draw", count:, to_self: true } — sull'Entità: «quando assegni un Oggetto a questa Entità, pesca»
    #   { kind: "ends", face:, swap: true, then_draw:, then_discard:, once: true } — sul Rubyfront: prima e ultima del mazzo, scambiale, poi pesca e scarta (una volta per turno)
    #   { kind: "ends", face:, to_hand: true, other_to_retire: true, once: true } — sul Nexus: prima e ultima, una in mano e l'altra in Ritiro
    #
    # `death_forms` sono gli effetti CERTIFICATI di un Oggetto «quando quell'Entità muore» (§5, §8.2), evento `on_death`:
    #
    #   { kind: "remain", to: "ritiro", then_rearm: { other: true, to: "unarmed", free: true } } — in Ritiro invece che nell'Abisso, poi un altro Oggetto dal Ritiro a una disarmata
    #
    # Fra gli `static_forms` (sotto) stanno anche { kind: "assign_discount", amount: } — «gli Oggetti
    # che assegni a questa Entità costano N in meno» — e { kind: "others_armed_power", amount: } —
    # «le altre Entità con un Oggetto assegnato che controlli hanno +N Potenza».
    #
    # `flip_forms` sono gli effetti «quando flippa» CERTIFICATI del Nexus
    # (§3.1), evento `on_flip`: { kind: "move", card_id:, from:
    # "field", to: "abisso" }, { kind: "seal", card_id: } e { kind: "draw", count: }.
    #
    # `nexus` è il requisito del flip (§3.1) com'è stampato sulla faccia del
    # Rubyfront, con il recupero di PV della faccia del Nexus: { face:,
    # conditions: [{ count:, type:, race: }], discard: { count:, type: },
    # recovery: } — nil dove non c'è o la forma è ignota (il flip resta a
    # mano).
    #
    # `power` e `counterattack` sono le due statistiche del combattimento
    # (§6.3): la Potenza stampata e il «Contrattacco +N» — nil per chi non
    # ce l'ha (una Materia non ha Potenza, un'Entità senza la statistica non
    # contrattacca). Sono i numeri CANONICI della carta: le modifiche in
    # partita (Oggetti, effetti) non stanno qui.
    def self.load(data_dir)
      index = {}
      Dir.glob(File.join(data_dir, "sets", "*", "cards", "*", "*.json")).each do |path|
        # Il file dati porta il nome della sua cartella (<id>/<id>.json);
        # i compagni .it.json/.en.json sono testi e non c'entrano.
        next unless File.basename(path, ".json") == File.basename(File.dirname(path))

        card = JSON.parse(File.read(path))
        next unless card.is_a?(Hash) && card["id"]

        faces = Array(card["faces"])
        keywords = faces.flat_map do |face|
          Array(face["keywords"]).filter_map { |keyword| keyword.is_a?(Hash) ? keyword["id"] : nil }
        end
        stats = faces.filter_map { |face| face["stats"] if face["stats"].is_a?(Hash) }.first || {}
        index[card["id"]] = {
          type: card["type"],
          race: faces.filter_map { |face| face["race"] }.first,
          keywords: keywords.uniq.freeze,
          power: integer_stat(stats["power"]),
          counterattack: integer_stat(stats["counterattack"]),
          # I PV stampati sul Rubyfront (§3.1): sono i PV con cui il suo
          # giocatore inizia la partita. nil per chi non ne ha.
          health: integer_stat(stats["health"]),
          flux_cost: integer_stat(stats["fluxCost"]),
          deployment: deployment_of(stats["deploymentCost"]),
          matter: matter_of(faces),
          enables: faces.map { |face| enables_of(face) }.freeze,
          enter_listeners: enter_listeners(faces).freeze,
          enter_moves: enter_moves(faces).freeze,
          enter_returns: enter_returns(faces, "on_enter_field").freeze,
          attack_returns: enter_returns(faces, "on_attack").freeze,
          attack_draws: attack_draws(faces).freeze,
          attack_forms: attack_forms(faces).freeze,
          enter_looks: enter_looks(faces).freeze,
          enter_controls: enter_controls(faces).freeze,
          enter_refreshes: enter_refreshes(faces).freeze,
          static_forms: static_forms(faces).freeze,
          resolve_forms: resolve_forms(faces).freeze,
          flip_forms: flip_forms(faces).freeze,
          nexus: nexus_of(faces),
          enter_disarms: enter_disarms(faces).freeze,
          enter_rearms: enter_rearms(faces).freeze,
          leave_returns: leave_returns(faces).freeze,
          assign_forms: assign_forms(faces).freeze,
          death_forms: death_forms(faces).freeze,
          abilities: abilities(faces).freeze,
          fury_at: fury_at(faces).freeze,
          behavior: faces.filter_map { |face| face["behavior"] if face["behavior"].is_a?(String) }.first,
          grants_while_assigned: grants_while_assigned(faces).freeze,
        }.freeze
      rescue JSON::ParserError
        next
      end
      index.freeze
    end

    # Tutti i parser delle forme certificate: ogni trigger di ogni carta
    # deve trovarne uno che lo riconosca, o è un effetto che l'engine ignora.
    FORMS = %i[enter_listeners enter_moves enter_looks enter_controls enter_refreshes enter_disarms enter_rearms leave_returns
               attack_draws attack_forms grants_while_assigned static_forms resolve_forms flip_forms assign_forms death_forms].freeze
    RETURN_EVENTS = %w[on_enter_field on_attack].freeze

    # Un trigger è riconosciuto se almeno una forma certificata lo legge.
    def self.recognized?(trigger)
      faces = [{ "triggers" => [trigger] }]
      FORMS.any? { |form| !send(form, faces).empty? } ||
        RETURN_EVENTS.any? { |event| !enter_returns(faces, event).empty? }
    end

    # I trigger delle carte in `data_dir` che nessuna forma riconosce:
    # «<id> <faccia>/<trigger>». È il debito dichiarato della regola
    # d'oro (§1.1) — il test dell'anagrafe lo tiene aggiornato.
    def self.unknown_triggers(data_dir)
      Dir.glob(File.join(data_dir, "sets", "*", "cards", "*", "*.json")).sort.flat_map do |path|
        next [] unless File.basename(path, ".json") == File.basename(File.dirname(path))

        card = JSON.parse(File.read(path))
        next [] unless card.is_a?(Hash) && card["id"]

        Array(card["faces"]).flat_map do |face|
          Array(face["triggers"]).filter_map do |trigger|
            next unless trigger.is_a?(Hash)

            "#{card["id"]} #{face["id"]}/#{trigger["id"]}" unless recognized?(trigger)
          end
        end
      rescue JSON::ParserError
        []
      end
    end

    # Il costo di schieramento del Rubyfront (§3.1): `3`, `{ "base" => 3 }`
    # o `{ "die" => "d6" }` — { fixed:, die: }, nil se non c'è o ha una forma
    # ignota (e lo schieramento si regola a mano).
    def self.deployment_of(value)
      return { fixed: value, die: nil }.freeze if value.is_a?(Integer)
      return nil unless value.is_a?(Hash)
      return { fixed: value["base"], die: nil }.freeze if value["base"].is_a?(Integer)

      die = value["die"].is_a?(String) && value["die"][/\Ad(\d+)\z/, 1]
      die ? { fixed: nil, die: die.to_i }.freeze : nil
    end

    def self.enter_listeners(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == "on_enter_field"

        details = trigger["details"]
        effect = trigger["effect"]
        next unless details.is_a?(Hash) && effect.is_a?(Hash)
        next unless effect["type"] == "draw_card" && effect["count"].is_a?(Integer) && effect.dig("target", "controller") == "controller"

        entering = details["enteringCard"]
        requires = details["requiresControlledAtLeast"]
        next unless entering.is_a?(Hash) && entering["cardType"] == "entity" && entering["controller"] == "controller" && entering["excludeSelf"] == true
        next unless requires.is_a?(Hash) && requires["count"].is_a?(Integer)

        filter = requires["filter"]
        next unless filter.is_a?(Hash) && filter["cardType"] == "entity" && filter["controller"] == "controller"

        { entering_race: entering["race"].is_a?(String) ? entering["race"] : nil,
          requires: { count: requires["count"], race: filter["race"].is_a?(String) ? filter["race"] : nil }.freeze,
          draw: effect["count"] }.freeze
      end
    end

    def self.enter_moves(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == "on_enter_field"
        next if trigger["details"].is_a?(Hash) && trigger["details"]["enteringCard"]

        effect = trigger["effect"]
        next unless effect.is_a?(Hash) && effect["type"] == "move_card"

        target = effect["target"]
        destination = effect["destination"]
        next unless target.is_a?(Hash) && target["cardType"] == "entity" && target["controller"] == "opponent" && target["zone"] == "front"
        next unless target["min"] == 1 && target["max"] == 1
        next unless destination.is_a?(Hash)

        # Due destinazioni certificate: la Zona di Ritiro (senza dettagli),
        # e l'Abisso «finché questa Entità resta in campo; quando lascia il
        # campo, quell'Entità torna in gioco» — l'esilio condizionato,
        # stessa meccanica della Materia (held_by, release). Gemello:
        # renderer.ts, enterMovesOf.
        extra = effect["details"]
        if destination["zone"] == "retire" && extra.nil?
          { target: { type: "entity", controller: "opponent" }.freeze, to: "ritiro" }.freeze
        elsif destination["zone"] == "abyss" && extra.is_a?(Hash) &&
              extra["whileSourceOnField"] == true && extra["returnsToPlayWhenSourceLeaves"] == true
          { target: { type: "entity", controller: "opponent" }.freeze, to: "abisso", hold: true }.freeze
        end
      end
    end

    # Gli effetti certificati «quando assegni questa carta a un'Entità»
    # (§3.1, §8.2; dal 2026-09-10): evento `on_assign_object` con
    # `selfAssigned` (è questo Oggetto che viene assegnato), effetto
    # `move_card` di UN'Entità avversaria nell'Abisso «finché questa carta
    # resta in gioco; quando lascia il gioco, torna» — l'esilio condizionato,
    # stessa meccanica della Materia e dell'Entità (held_by, release).
    # Gemello: renderer.ts, assignFormsOf.
    def self.assign_forms(faces)
      faces.each_with_index.flat_map { |face, index| Array(face["triggers"]).map { |trigger| [trigger, index] } }.filter_map do |trigger, index|
        next unless trigger.is_a?(Hash) && trigger["event"] == "on_assign_object"

        effect = trigger["effect"]
        next unless effect.is_a?(Hash)
        # Il Rubyfront/Nexus: «la prima volta in ogni tuo turno che assegni un
        # Oggetto a un'Entità, guarda la prima e l'ultima carta del tuo
        # mazzo: puoi scambiarle; poi pesca una carta e scarta una carta» —
        # o «aggiungine una alla tua mano e metti l'altra nella tua Zona di
        # Ritiro». Una volta per turno, sulla faccia in vista.
        if trigger["details"] == { "oncePerEachOfYourTurns" => true }
          next unless effect["type"] == "look_and_optionally_move" && effect["from"] == { "zone" => "deck", "owner" => "controller", "position" => "top" }

          extra = effect["details"]
          next unless extra.is_a?(Hash) && extra["alsoLook"] == { "zone" => "deck", "owner" => "controller", "position" => "bottom" }

          if extra.keys.sort == %w[alsoLook maySwapTopAndBottom thenDiscardCards thenDrawCards]
            next unless extra["maySwapTopAndBottom"] == true && extra["thenDrawCards"].is_a?(Integer) && extra["thenDiscardCards"].is_a?(Integer)

            next { kind: "ends", face: index, swap: true, then_draw: extra["thenDrawCards"], then_discard: extra["thenDiscardCards"], once: true }.freeze
          end
          if extra.keys.sort == %w[addOneTo alsoLook otherTo]
            next unless extra["addOneTo"] == { "zone" => "hand", "owner" => "controller" } && extra["otherTo"] == { "zone" => "retire", "owner" => "controller" }

            next { kind: "ends", face: index, to_hand: true, other_to_retire: true, once: true }.freeze
          end
          next
        end
        # L'Entità: «quando assegni un Oggetto a questa Entità: pesca una carta».
        if trigger["details"] == { "toSelf" => true }
          next unless effect["type"] == "draw_card" && effect["target"] == { "controller" => "controller" } && effect["count"].is_a?(Integer) && effect["count"].positive?

          next { kind: "draw", count: effect["count"], to_self: true }.freeze
        end
        next unless trigger["details"].is_a?(Hash) && trigger["details"] == { "selfAssigned" => true }
        next unless effect["type"] == "move_card"

        target = effect["target"]
        destination = effect["destination"]
        extra = effect["details"]
        next unless target.is_a?(Hash) && target["cardType"] == "entity" && target["controller"] == "opponent" && target["min"] == 1 && target["max"] == 1
        next unless destination.is_a?(Hash) && destination["zone"] == "abyss"
        next unless extra.is_a?(Hash) && extra["whileSourceOnField"] == true && extra["returnsToPlayWhenSourceLeaves"] == true

        { kind: "exile", target: { type: "entity", controller: "opponent" }.freeze, to: "abisso", hold: true }.freeze
      end
    end

    # Gli effetti certificati «quando quell'Entità muore» di un Oggetto (§5,
    # §8.2; dal 2026-09-10): evento `on_death` dell'Entità a cui è assegnato,
    # effetto `move_card` di sé nella propria Zona di Ritiro «invece che
    # nell'Abisso», poi «puoi assegnare un altro Oggetto dalla tua Zona di
    # Ritiro, senza pagarne il costo, a un'Entità senza Oggetto che
    # controlli». Gemello: renderer.ts, deathFormsOf.
    def self.death_forms(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == "on_death" && trigger["details"] == { "ofAssignedEntity" => true }

        effect = trigger["effect"]
        next unless effect.is_a?(Hash) && effect["type"] == "move_card" && effect["target"] == { "scope" => "self" }
        next unless effect["destination"] == { "zone" => "retire", "owner" => "controller" }

        extra = effect["details"]
        next unless extra.is_a?(Hash) && extra.keys.sort == %w[insteadOfZone thenMayAssignObject]
        next unless extra["insteadOfZone"] == { "zone" => "abyss", "owner" => "controller" }

        rearm = extra["thenMayAssignObject"]
        next unless rearm == { "from" => { "zone" => "retire", "owner" => "controller" },
                               "filter" => { "cardType" => "object", "details" => { "other" => true } },
                               "target" => { "cardType" => "entity", "controller" => "controller", "details" => { "hasObjectAssigned" => false } },
                               "noFluxCost" => true }

        { kind: "remain", to: "ritiro", then_rearm: { other: true, to: "unarmed", free: true }.freeze }.freeze
      end
    end

    # Stessa forma all'ingresso (`enter_returns`) e all'attacco
    # (`attack_returns`, lo stesso ritorno all'attacco).
    def self.enter_returns(faces, event)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == event
        next if trigger["details"].is_a?(Hash) && trigger["details"]["enteringCard"]

        effect = trigger["effect"]
        next unless effect.is_a?(Hash) && effect["type"] == "move_card"

        target = effect["target"]
        from = effect["from"]
        destination = effect["destination"]
        next unless target.is_a?(Hash) && target["controller"] == "controller" && target["min"] == 1 && target["max"] == 1
        next unless target["details"].is_a?(Hash) && target["details"]["permanent"] == true
        next unless from.is_a?(Hash) && from["zone"] == "retire" && from["owner"] == "controller"
        next unless destination.is_a?(Hash) && destination["zone"] == "front"

        # «una carta permanente» (§10): quel che resta in campo — un'Entità
        # o una Materia permanente, mai il Rubyfront, mai un Oggetto. Stessa
        # lettura dell'esilio condizionato. Gemello: renderer.ts, enterReturnsOf.
        { from: "ritiro", filter: { permanent: true }.freeze, to: "field" }.freeze
      end
    end

    # `attack_draws` è la pesca all'attacco: «la prima volta
    # in ogni tuo turno che questa Entità attacca mentre ha un Oggetto
    # assegnato, pesca N carte, poi scarta M». Evento `on_attack`, effetto
    # `draw_card` del controllore, `requiresObjectAssigned`; lo scarto
    # (`thenDiscardCards`) è certificato solo a 1 — altro, forma ignota.
    def self.attack_draws(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == "on_attack"

        details = trigger["details"]
        effect = trigger["effect"]
        next unless details.is_a?(Hash) && effect.is_a?(Hash)
        next unless effect["type"] == "draw_card" && effect["count"].is_a?(Integer) && effect.dig("target", "controller") == "controller"
        next unless details["oncePerEachOfYourTurns"] == true && details["requiresObjectAssigned"] == true

        then_discard = effect.dig("details", "thenDiscardCards")
        next unless then_discard.nil? || then_discard == 1

        { draw: effect["count"], then_discard: then_discard || 0, requires_object: true }.freeze
      end
    end

    # `attack_forms` sono le altre forme «quando attacca» CERTIFICATE (§8.2),
    # una per carta collegata, con `kind` che dice l'azione del tavolo e
    # `who` chi è la fonte rispetto all'attaccante: "self" (chi attacca),
    # "object" (un Oggetto addosso all'attaccante), "ally" (un'altra carta
    # dello stesso posto, quando attacca un'Entità che soddisfa il filtro),
    # "permanent" (una Materia permanente), "rubyfront" (il Rubyfront/Nexus
    # schierato). `face` è la faccia che porta la forma (il Nexus ha le sue).
    #
    #   { kind: "untap",   who: "self", once:, requires_object: }        stappa dopo il combattimento
    #   { kind: "empower", who: "self", targets: "others_armed", power: } +1 alle altre armate
    #   { kind: "empower", who: "object", targets: "bearer", power: }    +1 al portatore
    #   { kind: "look", who: "object", die:, on_roll:, count:, reveal:, reveal_to:, rest_to: }
    #   { kind: "look", who: "ally", attacker_armed:, once:, count:, reveal:, reveal_to:, rest_to: }
    #   { kind: "rearm", who: "ally", attacker_armed: }                  un Oggetto dal Ritiro, gratis
    #   { kind: "heal", who: "self", amount:, die:, on_roll:, then_recall: } +2 PV, poi col dado un'Entità in mano
    #   { kind: "return", who: "self", die:, on_roll:, filter:, joins: }  un'Entità dal Ritiro, che attacca
    #   { kind: "heal", who: "permanent", attackers:, die:, gain_on:, drain_on: } PV pari agli Umani attaccanti
    #   { kind: "heal", who: "rubyfront", once:, requires_attackers:, amount:, then_draw:, then_discard: }
    #   { kind: "empower", who: "self", once:, targets: "next_human_attacker", grants: }
    #   { kind: "empower", who: "self", requires_previous_attackers:, targets: "opposing_entity", restrict: }
    def self.attack_forms(faces)
      faces.each_with_index.flat_map do |face, index|
        Array(face["triggers"]).filter_map do |trigger|
          next unless trigger.is_a?(Hash) && trigger["event"] == "on_attack"

          details = trigger["details"].is_a?(Hash) ? trigger["details"] : {}
          effect = trigger["effect"]
          next unless effect.is_a?(Hash)

          form = attack_untap(details, effect) || attack_empower(details, effect) || attack_look(details, effect) ||
                 attack_heal(details, effect) || attack_recall(details, effect) ||
                 attack_rearm(details, effect) || attack_restrict(details, effect)
          form && form.merge(face: index).freeze
        end
      end
    end

    # "5-6" -> [5, 6]; nil se non è un intervallo.
    def self.roll_range(value)
      match = value.is_a?(String) && value.match(/\A(\d+)-(\d+)\z/)
      match && [match[1].to_i, match[2].to_i].freeze
    end

    def self.die_faces(value)
      value.is_a?(String) && value[/\Ad(\d+)\z/, 1]&.to_i
    end

    def self.own_target?(target, type, race = nil)
      target.is_a?(Hash) && target["cardType"] == type && target["controller"] == "controller" && (race.nil? || target["race"] == race)
    end

    # «Stappala dopo il combattimento».
    def self.attack_untap(details, effect)
      return nil unless effect["type"] == "untap" && effect.dig("target", "scope") == "self" && effect.dig("details", "afterCombat") == true
      return nil unless details["oncePerEachOfYourTurns"] == true && details["whileHasObjectAssigned"] == true

      { kind: "untap", who: "self", once: true, requires_object: true }
    end

    # I potenziamenti d'attacco: +1 alle altre armate, +1 al portatore, Vendetta al prossimo Umano.
    def self.attack_empower(details, effect)
      target = effect["target"]
      if effect["type"] == "modify_power" && effect["amount"].is_a?(Integer) && effect["duration"] == "until_end_of_turn"
        if details["whenAssignedAttacks"] == true && target.is_a?(Hash) && target["scope"] == "assigned"
          return { kind: "empower", who: "object", targets: "bearer", power: effect["amount"] }
        end
        if details["requiresObjectAssigned"] == true && own_target?(target, "entity") && target["quantity"] == "all" &&
           target.dig("details", "hasObjectAssigned") == true && target.dig("details", "excludeSelf") == true
          return { kind: "empower", who: "self", requires_object: true, targets: "others_armed", power: effect["amount"] }
        end
      end
      if effect["type"] == "empower" && effect["duration"] == "until_end_of_turn" && details["oncePerEachOfYourTurns"] == true &&
         own_target?(target, "entity", "human") && target["min"] == 1 && target["max"] == 1 && target.dig("details", "nextAttackerThisTurn") == true
        granted = Array(effect["grants"]).select { |keyword| keyword.is_a?(String) }
        return { kind: "empower", who: "self", once: true, targets: "next_human_attacker", grants: granted.freeze } unless granted.empty?
      end
      nil
    end

    # Gli sguardi d'attacco: col dado, una Materia in mano e le altre in Ritiro; o un Oggetto in Ritiro e le altre in fondo.
    def self.attack_look(details, effect)
      return nil unless effect["type"] == "look_and_optionally_move"

      from = effect["from"]
      extra = effect["details"]
      return nil unless from.is_a?(Hash) && from["zone"] == "deck" && from["owner"] == "controller" && from["position"] == "top" && from["count"].is_a?(Integer)
      return nil unless extra.is_a?(Hash) && extra["mayReveal"].is_a?(Hash) && extra["mayReveal"]["cardType"].is_a?(String)

      reveal_to = extra.dig("revealTo", "zone")
      rest_to = extra.dig("restTo", "zone")
      return nil unless %w[hand retire].include?(reveal_to) && %w[deck retire].include?(rest_to)
      return nil if rest_to == "deck" && extra.dig("restTo", "position") != "bottom"

      base = { kind: "look", count: from["count"], reveal: { type: extra["mayReveal"]["cardType"], race: extra["mayReveal"]["race"].is_a?(String) ? extra["mayReveal"]["race"] : nil }.freeze,
               reveal_to: reveal_to == "retire" ? "ritiro" : "hand", rest_to: rest_to == "retire" ? "ritiro" : "deck" }
      if details["whenAssignedAttacks"] == true
        die = die_faces(extra["die"])
        on_roll = roll_range(extra["onlyOnRoll"])
        return nil unless die && on_roll

        return base.merge(who: "object", die: die, on_roll: on_roll)
      end
      attacker = details["attacker"]
      if own_target?(attacker, "entity") && attacker.dig("details", "hasObjectAssigned") == true && details["oncePerEachOfYourTurns"] == true && extra["die"].nil?
        return base.merge(who: "ally", attacker_armed: true, once: true, die: nil)
      end
      nil
    end

    # Le cure d'attacco: +N PV poi col dado un'Entità dal Ritiro in mano; il d20 sugli Umani attaccanti; il raduno del Rubyfront.
    def self.attack_heal(details, effect)
      extra = effect["details"].is_a?(Hash) ? effect["details"] : {}
      if effect["type"] == "gain_health" && effect["amount"].is_a?(Integer) && effect.dig("target", "controller") == "controller"
        required = details["requiresAttackersThisTurnAtLeast"]
        if details["oncePerEachOfYourTurns"] == true && required.is_a?(Hash) && required["count"].is_a?(Integer) && own_target?(required["filter"], "entity", "human")
          then_draw = extra["thenDrawCards"]
          then_discard = extra["thenDiscardCards"]
          return nil unless [nil, 1].include?(then_draw) && [nil, 1].include?(then_discard)

          return { kind: "heal", who: "rubyfront", once: true, requires_attackers: { count: required["count"], race: "human" }.freeze,
                   amount: effect["amount"], then_draw: then_draw || 0, then_discard: then_discard || 0 }
        end
        recall = extra["thenMoveCard"]
        if details.empty? && recall.is_a?(Hash) && recall.dig("from", "zone") == "retire" && recall.dig("to", "zone") == "hand" && recall["count"] == 1 &&
           recall.dig("filter", "cardType") == "entity"
          die = die_faces(extra["die"])
          on_roll = roll_range(extra["onRoll"])
          return nil unless die && on_roll

          return { kind: "heal", who: "self", amount: effect["amount"], die: die, on_roll: on_roll, then_recall: { type: "entity" }.freeze }
        end
      end
      if effect["type"] == "empower" && own_target?(details["attackers"], "entity", "human") && extra["byRoll"].is_a?(Hash)
        die = die_faces(extra["die"])
        by = extra["byRoll"]
        gain = by.find { |_, v| v.is_a?(Hash) && v["gainHealthEqualsHumanAttackersThisTurn"] == true }&.first
        drain = by.find { |_, v| v.is_a?(Hash) && v["opponentLosesHealthEqualsHumanAttackersThisTurn"] == true }&.first
        return nil unless die && roll_range(gain) && roll_range(drain)

        # «Ogni volta che le Entità Umane che controlli attaccano»: l'ondata,
        # non ciascun attaccante — una volta per turno (decisione del
        # designer, 2026-09-10: «l'effetto di una permanente si risolve una
        # singola volta»).
        return { kind: "heal", who: "permanent", attackers: { type: "entity", race: "human" }.freeze, die: die,
                 gain_on: roll_range(gain), drain_on: roll_range(drain), amount: "human_attackers", once: true }
      end
      nil
    end

    # Il ritorno d'attacco: col dado, un'Entità Umana dal Ritiro sul Fronte, che attacca insieme.
    def self.attack_recall(details, effect)
      return nil unless details.empty? && effect["type"] == "move_card" && own_target?(effect["target"], "entity", "human")
      return nil unless effect["target"]["min"] == 1 && effect["target"]["max"] == 1
      return nil unless effect.dig("from", "zone") == "retire" && effect.dig("destination", "zone") == "front"

      extra = effect["details"]
      return nil unless extra.is_a?(Hash) && extra["joinsThisAttack"] == true

      die = die_faces(extra["die"])
      on_roll = roll_range(extra["onRoll"])
      die && on_roll ? { kind: "return", who: "self", die: die, on_roll: on_roll, filter: { type: "entity", race: "human" }.freeze, joins: true } : nil
    end

    # Il riarmo: quando un'Entità armata che controlli attacca, puoi assegnarle un Oggetto dal Ritiro, gratis.
    def self.attack_rearm(details, effect)
      attacker = details["attacker"]
      return nil unless effect["type"] == "assign_object" && effect["optional"] == true
      return nil unless effect.dig("from", "zone") == "retire" && effect.dig("target", "scope") == "attacker" && effect.dig("details", "noFluxCost") == true
      return nil unless own_target?(attacker, "entity") && attacker.dig("details", "hasObjectAssigned") == true

      { kind: "rearm", who: "ally", attacker_armed: true }
    end

    # Il divieto di blocco: se almeno N Umani che controlli attaccano, un'Entità avversaria non blocca in questo turno.
    # La condizione conta gli attaccanti di QUESTO turno (requiresAttackersThisTurnAtLeast, la fonte compresa) o,
    # nella forma storica, quelli del turno precedente (requiresAttackersPreviousTurnAtLeast).
    def self.attack_restrict(details, effect)
      this_turn = details["requiresAttackersThisTurnAtLeast"]
      previous = details["requiresAttackersPreviousTurnAtLeast"]
      required = this_turn || previous
      return nil unless effect["type"] == "restrict_action" && effect["restricts"] == "block" && effect["duration"] == "until_end_of_turn"

      target = effect["target"]
      return nil unless target.is_a?(Hash) && target["cardType"] == "entity" && target["controller"] == "opponent" && target["min"] == 1 && target["max"] == 1
      return nil unless required.is_a?(Hash) && required["count"].is_a?(Integer) && own_target?(required["filter"], "entity", "human")

      condition = this_turn ? { requires_attackers: { count: required["count"], race: "human" }.freeze } : { requires_previous_attackers: { count: required["count"], race: "human" }.freeze }
      { kind: "empower", who: "self", targets: "opposing_entity", restrict: "block" }.merge(condition)
    end

    def self.enter_looks(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == "on_enter_field"
        next if trigger["details"].is_a?(Hash) && trigger["details"]["enteringCard"]

        effect = trigger["effect"]
        next unless effect.is_a?(Hash) && effect["type"] == "look_and_optionally_move"

        from = effect["from"]
        details = effect["details"]
        next unless from.is_a?(Hash) && from["zone"] == "deck" && from["owner"] == "controller" && from["position"] == "top"
        next unless details.is_a?(Hash) && details.dig("revealTo", "zone") == "hand"
        next unless details.dig("restTo", "zone") == "deck" && details.dig("restTo", "position") == "bottom"

        may = details["mayReveal"]
        next unless may.is_a?(Hash) && %w[entity object].include?(may["cardType"])

        # Il conto: fisso, o col dado «2 + ceil(result/2)»,
        # la sola formula certificata.
        count = from["count"].is_a?(Integer) ? from["count"] : nil
        die = nil
        base = 0
        # Le due formule certificate col dado: «2 + ceil(tiro/2)» e, dal
        # 2026-09-10, «tante carte quanto il tiro» (details.count == "result").
        by_roll = false
        unless count
          faces = details["die"].is_a?(String) && details["die"][/\Ad(\d+)\z/, 1]
          formula = details["count"].is_a?(String) && details["count"][/\A(\d+) \+ ceil\(result\/2\)\z/, 1]
          by_roll = details["count"] == "result"
          next unless faces && (formula || by_roll)

          die = faces.to_i
          base = formula ? formula.to_i : 0
        end
        then_to = details["thenMoveOneTo"]
        next if then_to && (!then_to.is_a?(Hash) || then_to["zone"] != "retire")

        { count: count, die: die, count_base: base,
          reveal: { type: may["cardType"], race: may["race"].is_a?(String) ? may["race"] : nil }.freeze,
          then_retire: !then_to.nil?, **(by_roll ? { formula: "result" } : {}) }.freeze
      end
    end

    # La stappata all'ingresso: «quando entra sul Fronte, lancia un d20: con
    # 15–20 stappa tutte le Entità che controlli». Gemello: renderer.ts, enterRefreshesOf.
    def self.enter_refreshes(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == "on_enter_field"
        next if trigger["details"].is_a?(Hash) && trigger["details"]["enteringCard"]

        effect = trigger["effect"]
        next unless effect.is_a?(Hash) && effect["type"] == "untap" && own_target?(effect["target"], "entity") && effect.dig("target", "quantity") == "all"

        extra = effect["details"]
        next unless extra.is_a?(Hash) && extra.keys.sort == %w[die onRoll]

        die = die_faces(extra["die"])
        on_roll = roll_range(extra["onRoll"])
        next unless die && on_roll

        { die: die, on_roll: on_roll }.freeze
      end
    end

    def self.enter_controls(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == "on_enter_field"
        next if trigger["details"].is_a?(Hash) && trigger["details"]["enteringCard"]

        effect = trigger["effect"]
        next unless effect.is_a?(Hash) && effect["type"] == "gain_control" && effect["duration"] == "until_end_of_turn"

        target = effect["target"]
        next unless target.is_a?(Hash) && target["cardType"] == "entity" && target["controller"] == "opponent"
        next unless target["min"] == 1 && target["max"] == 1

        max_cost = nil
        certified = Array(target["conditions"]).all? do |condition|
          ok = condition.is_a?(Hash) && condition["stat"] == "flux_cost" && condition["operator"] == "lte" && condition["value"].is_a?(Integer)
          max_cost = condition["value"] if ok
          ok
        end
        next unless certified

        grants = Array(effect.dig("details", "grants")).select { |keyword| keyword.is_a?(String) }
        { target: { type: "entity", controller: "opponent", max_cost: max_cost }.freeze, grants: grants.freeze }.freeze
      end
    end

    # Un intervallo "5-6" -> [5, 6], o un valore secco "20" -> [20, 20].
    def self.band(value)
      roll_range(value) || (value.is_a?(String) && value =~ /\A\d+\z/ ? [value.to_i, value.to_i].freeze : nil)
    end

    def self.race_filter(filter, zone: nil, owner: "controller")
      return nil unless filter.is_a?(Hash) && filter["cardType"] == "entity"
      return nil if zone && filter["zone"] != zone
      return nil if owner && filter["owner"] != owner && filter["controller"] != owner

      { type: "entity", race: filter["race"].is_a?(String) ? filter["race"] : nil }.freeze
    end

    # Gli statici di Potenza (§8.2): su di sé (`while_in_play`) e sul
    # portatore (`while_assigned`).
    def self.static_forms(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && %w[while_in_play while_assigned].include?(trigger["event"])

        effect = trigger["effect"]
        next unless effect.is_a?(Hash)
        # La tassa di Flusso (dal 2026-09-10): «finché questa Entità resta sul
        # Fronte, all'inizio di ogni tuo turno hai N Flusso in meno».
        if effect["type"] == "modify_flux"
          toll = effect["details"].is_a?(Hash) ? effect["details"] : {}
          next unless trigger["event"] == "while_in_play" && effect.dig("target", "controller") == "controller"
          next unless effect["amount"].is_a?(Integer) && effect["amount"].negative? && toll["atStartOfEachOwnTurn"] == true && toll["whileOnFront"] == true

          next { kind: "flux_toll", amount: -effect["amount"] }.freeze
        end
        # Lo sconto d'assegnazione (dal 2026-09-10): «gli Oggetti che assegni
        # a questa Entità costano N Flusso in meno».
        if effect["type"] == "reduce_cost"
          next unless trigger["event"] == "while_in_play" && effect["filter"] == { "cardType" => "object" }
          next unless effect["amount"].is_a?(Integer) && effect["amount"].positive? && effect["details"] == { "assignedToSelf" => true }

          next { kind: "assign_discount", amount: effect["amount"] }.freeze
        end
        # «Questa Entità non si tappa mai»: uno statico senza numeri.
        if effect["type"] == "prevent_tap"
          next unless trigger["event"] == "while_in_play" && effect.dig("target", "scope") == "self" && effect["duration"] == "permanent"

          next { kind: "never_taps" }.freeze
        end
        # Gli statici di Contrattacco (dal 2026-09-10): «aumenta di 1 per ogni
        # Oggetto assegnato a questa Entità» su di sé, «Contrattacco +1» al portatore.
        if effect["type"] == "modify_counterattack"
          next unless effect["amount"].is_a?(Integer)

          details = effect["details"].is_a?(Hash) ? effect["details"] : {}
          if trigger["event"] == "while_in_play"
            next unless effect.dig("target", "scope") == "self" && details == { "perObjectAssigned" => true }

            next { kind: "self_counter", amount: effect["amount"], per_object: true }.freeze
          end
          next unless effect.dig("target", "scope") == "assigned" && [nil, "permanent"].include?(effect["duration"]) && details.empty?

          next { kind: "bearer_counter", amount: effect["amount"] }.freeze
        end
        next unless effect["type"] == "modify_power" && effect["amount"].is_a?(Integer)

        details = effect["details"].is_a?(Hash) ? effect["details"] : {}
        if trigger["event"] == "while_in_play"
          # L'aura delle armate (dal 2026-09-10): «le altre Entità con un
          # Oggetto assegnato che controlli hanno +N Potenza».
          if effect["target"] == { "cardType" => "entity", "controller" => "controller", "quantity" => "all", "details" => { "hasObjectAssigned" => true, "excludeSelf" => true } }
            next unless details.empty? && effect["duration"].nil?

            next { kind: "others_armed_power", amount: effect["amount"] }.freeze
          end
          next unless effect.dig("target", "scope") == "self"

          if details["whileAttacking"] == true
            other = race_filter(details["requiresOtherControlled"])
            next unless other

            { kind: "self_power", amount: effect["amount"], while_attacking: true, requires_other: other }.freeze
          elsif details["whileHasObjectAssigned"] == true
            # «Se questa Entità ha un Oggetto assegnato, ha +N Potenza» (dal 2026-09-10).
            next unless details.keys == ["whileHasObjectAssigned"]

            { kind: "self_power", amount: effect["amount"], while_armed: true }.freeze
          elsif details["perOtherControlled"]
            other = race_filter(details["perOtherControlled"], zone: "front")
            next unless other && details.keys == ["perOtherControlled"]

            { kind: "self_power", amount: effect["amount"], per_other: other }.freeze
          end
        else
          # «Mentre assegnato» dura finché l'Oggetto è addosso: la durata
          # esplicita (`permanent`) o assente dicono la stessa cosa.
          next unless effect.dig("target", "scope") == "assigned" && [nil, "permanent"].include?(effect["duration"])

          if details.empty?
            { kind: "bearer_power", amount: effect["amount"] }.freeze
          elsif details["perControlled"]
            per = race_filter(details["perControlled"], zone: "front")
            next unless per && (details.keys - %w[perControlled assignedMayBeBlockedByMultipleEntities]).empty?

            { kind: "bearer_power", amount: effect["amount"], per: per, multi_block: details["assignedMayBeBlockedByMultipleEntities"] == true }.freeze
          end
        end
      end
    end

    # Gli effetti delle Materie alla risoluzione (§7.2), evento `on_resolve`.
    def self.resolve_forms(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == "on_resolve"

        effect = trigger["effect"]
        next unless effect.is_a?(Hash)

        form = resolve_look(effect) || resolve_untap(effect) || resolve_move(effect) || resolve_fortune(effect) || resolve_destroy(effect) ||
               resolve_block(effect) || resolve_weaken(effect) || resolve_amplify(effect) || resolve_drain(effect) || resolve_search(effect)
        form&.freeze
      end
    end

    # Lo sguardo alla risoluzione: guarda le prime N, mostra un'Entità Umana (fino a 2 in vista), una in mano, le altre in fondo.
    def self.resolve_look(effect)
      return nil unless effect["type"] == "look_and_optionally_move"

      from = effect["from"]
      extra = effect["details"]
      return nil unless from.is_a?(Hash) && from["zone"] == "deck" && from["owner"] == "controller" && from["position"] == "top" && from["count"].is_a?(Integer)
      return nil unless extra.is_a?(Hash) && extra["mayReveal"].is_a?(Hash) && extra["mayReveal"]["cardType"].is_a?(String)
      return nil unless extra.dig("revealTo", "zone") == "hand" && extra.dig("restTo", "zone") == "deck" && extra.dig("restTo", "position") == "bottom"
      return nil unless [nil, 1].include?(extra["addToHand"]) && (extra["maxRevealed"].nil? || extra["maxRevealed"].is_a?(Integer))

      { kind: "look", count: from["count"], reveal: { type: extra["mayReveal"]["cardType"], race: extra["mayReveal"]["race"].is_a?(String) ? extra["mayReveal"]["race"] : nil }.freeze,
        reveal_to: "hand", rest_to: "deck", show_up_to: extra["maxRevealed"] || 1 }
    end

    # Le stappate alla risoluzione: «stappa un'Entità Umana: +1 Potenza», e «stappa gli Umani: Contrattacco +1» (in Reazione, senza bloccare).
    def self.resolve_untap(effect)
      return nil unless effect["type"] == "untap"

      target = effect["target"]
      extra = effect["details"]
      return nil unless own_target?(target, "entity") && extra.is_a?(Hash) && extra["duration"] == "until_end_of_turn"

      race = target["race"].is_a?(String) ? target["race"] : nil
      if target["min"] == 1 && target["max"] == 1 && extra["thenPowerBonus"].is_a?(Integer) && extra.keys.sort == %w[duration thenPowerBonus]
        return { kind: "empower", targets: "own_entity", race: race, power: extra["thenPowerBonus"], untap: true }
      end
      if target["quantity"] == "all" && extra["thenCounterattackBonus"].is_a?(Integer)
        requires = extra["requiresControlledAtLeast"]
        return nil unless requires.is_a?(Hash) && requires["count"].is_a?(Integer) && own_target?(requires["filter"], "entity")

        return { kind: "empower", targets: "own_entities", race: race, counter: extra["thenCounterattackBonus"], untap: true,
                 requires: { count: requires["count"], race: requires["filter"]["race"].is_a?(String) ? requires["filter"]["race"] : nil }.freeze }
      end
      nil
    end

    # La forma `block`: «gioca questa carta come bloccante di un'Entità attaccante: quell'attacco è bloccato. Se sul tuo
    # Fronte ci sono almeno N Entità con un Oggetto assegnato, guadagni M PV». Gemello: renderer.ts, resolveBlock.
    def self.resolve_block(effect)
      return nil unless effect["type"] == "block_attack"

      target = effect["target"]
      extra = effect["details"]
      return nil unless target.is_a?(Hash) && target["cardType"] == "entity" && target["controller"] == "opponent" && target["min"] == 1 && target["max"] == 1
      return nil unless extra.is_a?(Hash) && extra.keys.sort == %w[ifControllerEntitiesWithObjectAtLeast thenControllerGainsHealth]
      return nil unless extra["ifControllerEntitiesWithObjectAtLeast"].is_a?(Integer) && extra["thenControllerGainsHealth"].is_a?(Integer)

      { kind: "block", requires_armed: extra["ifControllerEntitiesWithObjectAtLeast"], heal: extra["thenControllerGainsHealth"], as_block: true }
    end

    # Gli spostamenti alla risoluzione: un'Entità avversaria economica in Ritiro; un permanente avversario nell'Abisso, finché questa carta resta.
    def self.resolve_move(effect)
      return nil unless effect["type"] == "move_card"

      target = effect["target"]
      destination = effect["destination"]
      return nil unless target.is_a?(Hash) && target["controller"] == "opponent" && target["min"] == 1 && target["max"] == 1 && destination.is_a?(Hash)

      if target["cardType"] == "entity" && destination["zone"] == "retire"
        max_cost = nil
        certified = Array(target["conditions"]).all? do |condition|
          ok = condition.is_a?(Hash) && condition["stat"] == "flux_cost" && condition["operator"] == "lte" && condition["value"].is_a?(Integer)
          max_cost = condition["value"] if ok
          ok
        end
        return nil unless certified

        # Lo sconto (dal 2026-09-10): «se sul tuo Fronte ci sono almeno N
        # Entità con un Oggetto assegnato, questa carta costa M in meno».
        # Nessun dettaglio: nessuno sconto. Un dettaglio diverso: forma ignota.
        extra = effect["details"]
        discount = nil
        unless extra.nil?
          return nil unless extra.is_a?(Hash) && extra.keys == ["fluxCostReduction"]

          reduction = extra["fluxCostReduction"]
          return nil unless reduction.is_a?(Hash) && reduction.keys.sort == %w[amount ifControllerEntitiesWithObjectAtLeast]
          return nil unless reduction["amount"].is_a?(Integer) && reduction["ifControllerEntitiesWithObjectAtLeast"].is_a?(Integer)

          discount = { amount: reduction["amount"], if_armed_at_least: reduction["ifControllerEntitiesWithObjectAtLeast"] }.freeze
        end

        return { kind: "move", target: { type: "entity", controller: "opponent", max_cost: max_cost }.freeze, to: "ritiro", discount: discount }
      end
      extra = effect["details"]
      if target.dig("details", "permanent") == true && destination["zone"] == "abyss" && extra.is_a?(Hash) &&
         extra["whileSourceOnField"] == true && extra["returnsToPlayWhenSourceLeaves"] == true
        return { kind: "exile", target: { permanent: true, controller: "opponent" }.freeze, to: "abisso", hold: true }
      end
      nil
    end

    # L'indebolimento dell'attaccante (dal 2026-09-10): «un'Entità avversaria
    # attaccante prende −1 Potenza per ogni Entità con un Oggetto assegnato
    # che controlli, fino alla fine del turno». Gemello: renderer.ts, resolveWeaken.
    def self.resolve_weaken(effect)
      return nil unless effect["type"] == "modify_power" && effect["duration"] == "until_end_of_turn"

      target = effect["target"]
      extra = effect["details"]
      return nil unless target.is_a?(Hash) && target["cardType"] == "entity" && target["controller"] == "opponent" && target["min"] == 1 && target["max"] == 1
      return nil unless target["details"].is_a?(Hash) && target["details"] == { "attacking" => true }
      return nil unless effect["amount"].is_a?(Integer) && effect["amount"].negative?
      return nil unless extra.is_a?(Hash) && extra == { "perControllerEntityWithObjectAssigned" => true }

      { kind: "weaken", target: { type: "entity", controller: "opponent", attacking: true }.freeze, amount: effect["amount"], per_armed: true }
    end

    # Il potenziamento delle armate (dal 2026-09-10): «fino a N Entità con un
    # Oggetto assegnato che controlli prendono +M Potenza fino alla fine del
    # turno e vengono stappate». Gemello: renderer.ts, resolveAmplify.
    def self.resolve_amplify(effect)
      return nil unless effect["type"] == "modify_power" && effect["duration"] == "until_end_of_turn"

      target = effect["target"]
      extra = effect["details"]
      return nil unless own_target?(target, "entity") && target["min"] == 0 && target["max"].is_a?(Integer) && target["max"].positive?
      return nil unless target["details"].is_a?(Hash) && target["details"] == { "hasObjectAssigned" => true }
      return nil unless effect["amount"].is_a?(Integer) && effect["amount"].positive?
      return nil unless extra.is_a?(Hash) && extra == { "alsoUntap" => true }

      { kind: "empower", targets: "own_armed", power: effect["amount"], up_to: target["max"], untap: true }
    end

    # Il d20 a fasce — PV, un'Entità dalla mano, una pesca, o tutto.
    def self.resolve_fortune(effect)
      return nil unless effect["type"] == "empower" && effect.dig("target", "controller") == "controller"

      extra = effect["details"]
      return nil unless extra.is_a?(Hash) && extra["byRoll"].is_a?(Hash)

      die = die_faces(extra["die"])
      by = extra["byRoll"]
      return nil unless die && by.size == 4

      gain = by.find { |_, v| v.is_a?(Hash) && v["gainHealth"].is_a?(Integer) }
      deploy = by.find { |_, v| v.is_a?(Hash) && v["moveCard"].is_a?(Hash) }
      draw = by.find { |_, v| v.is_a?(Hash) && v["drawCards"].is_a?(Integer) }
      all = by.find { |_, v| v.is_a?(Hash) && v["allOfTheAbove"] == true }
      return nil unless gain && deploy && draw && all && [gain, deploy, draw, all].all? { |key, _| band(key) }

      move = deploy[1]["moveCard"]
      filter = move["filter"]
      return nil unless move.dig("from", "zone") == "hand" && move.dig("from", "owner") == "controller" && move.dig("to", "zone") == "front" && move.dig("to", "owner") == "controller"
      return nil unless filter.is_a?(Hash) && filter["cardType"] == "entity"

      max_cost = nil
      certified = Array(filter["conditions"]).all? do |condition|
        ok = condition.is_a?(Hash) && condition["stat"] == "flux_cost" && condition["operator"] == "lte" && condition["value"].is_a?(Integer)
        max_cost = condition["value"] if ok
        ok
      end
      return nil unless certified

      { kind: "fortune", die: die,
        gain: { on: band(gain[0]), amount: gain[1]["gainHealth"] }.freeze,
        deploy: { on: band(deploy[0]), filter: { type: "entity", race: filter["race"].is_a?(String) ? filter["race"] : nil, max_cost: max_cost }.freeze }.freeze,
        draw: { on: band(draw[0]), count: draw[1]["drawCards"] }.freeze,
        all_on: band(all[0]) }
    end

    # La distruzione: distruggi un'Entità; contro una tappata costa N in meno.
    def self.resolve_destroy(effect)
      return nil unless effect["type"] == "destroy"

      target = effect["target"]
      extra = effect["details"]
      return nil unless target.is_a?(Hash) && target["cardType"] == "entity" && target["min"] == 1 && target["max"] == 1 && %w[any opponent controller].include?(target["controller"])
      return nil unless extra.is_a?(Hash) && extra.dig("toZone", "zone") == "abyss"
      # Un seguito ignoto rende la forma ignota; «poi perdi N PV» è
      # certificato (dal 2026-09-10).
      return nil unless (extra.keys - %w[toZone fluxCostReduction thenControllerLosesHealth]).empty?

      discount = extra["fluxCostReduction"]
      certified = discount.nil? || (discount.is_a?(Hash) && discount["amount"].is_a?(Integer) && discount["ifTargetState"] == "tapped")
      return nil unless certified
      then_lose = extra["thenControllerLosesHealth"]
      return nil unless then_lose.nil? || (then_lose.is_a?(Integer) && then_lose.positive?)

      { kind: "destroy", target: { type: "entity", controller: target["controller"] }.freeze, to: "abisso",
        discount: discount && { amount: discount["amount"], if_target: "tapped" }.freeze, then_lose: then_lose }
    end

    # La ricerca col dado (dal 2026-09-10): «guarda le prime N carte e lancia
    # un dN: con A–B puoi mostrare una Materia; con C–D un Oggetto; con E–F
    # un'Entità. Aggiungi la mostrata alla mano; se non ne mostri una, metti
    # una delle guardate in cima al mazzo. Poi una delle altre nella Zona di
    # Ritiro e le restanti in fondo in qualsiasi ordine». Gemello:
    # renderer.ts, resolveSearch.
    def self.resolve_search(effect)
      return nil unless effect["type"] == "look_and_optionally_move"

      from = effect["from"]
      extra = effect["details"]
      return nil unless from == { "zone" => "deck", "owner" => "controller", "position" => "top", "count" => from.is_a?(Hash) ? from["count"] : nil } && from["count"].is_a?(Integer)
      return nil unless extra.is_a?(Hash) && extra.keys.sort == %w[die ifNoReveal mayRevealByRoll restTo revealTo thenMoveOneTo]

      die = die_faces(extra["die"])
      by_roll = extra["mayRevealByRoll"]
      return nil unless die && by_roll.is_a?(Hash) && !by_roll.empty?

      bands = {}
      by_roll.each do |key, value|
        range = band(key)
        type = value.is_a?(Hash) && value["cardType"]
        return nil unless range && %w[matter object entity].include?(type) && !bands.key?(type)

        bands[type] = range
      end
      return nil unless extra["revealTo"] == { "zone" => "hand", "owner" => "controller" }
      return nil unless extra["ifNoReveal"] == { "putOneOnTop" => true }
      return nil unless extra["thenMoveOneTo"] == { "zone" => "retire", "owner" => "controller" }
      return nil unless extra["restTo"] == { "zone" => "deck", "owner" => "controller", "position" => "bottom", "anyOrder" => true }

      { kind: "search", count: from["count"], die: die, bands: bands.freeze, reveal_to: "hand", if_no_reveal_top: true, then_retire: true, rest_to: "deck" }
    end

    # Il prosciugamento (dal 2026-09-10): «il Rubyfront/Nexus avversario perde
    # PV pari al numero di Oggetti assegnati alle Entità che controlli».
    # Gemello: renderer.ts, resolveDrain.
    def self.resolve_drain(effect)
      return nil unless effect["type"] == "lose_health"

      target = effect["target"]
      extra = effect["details"]
      return nil unless target.is_a?(Hash) && target == { "cardType" => "rubyfront", "controller" => "opponent" }
      return nil unless extra.is_a?(Hash) && extra == { "amountEqualsObjectsAssignedToControllerEntities" => true }

      { kind: "drain", amount: "objects" }
    end

    # «Quando flippa» (§3.1): la carta nominata dal
    # proprio Fronte nell'Abisso, e il divieto di giocarla per il resto della
    # partita.
    def self.flip_forms(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == "on_flip"

        effect = trigger["effect"]
        next unless effect.is_a?(Hash)

        target = effect["target"]
        next unless target.is_a?(Hash) && target["controller"] == "controller"
        # «Poi pesca una carta» (dal 2026-09-10).
        if effect["type"] == "draw_card"
          next unless target == { "controller" => "controller" } && effect["count"].is_a?(Integer) && effect["count"].positive?

          next { kind: "draw", count: effect["count"] }.freeze
        end
        next unless target["cardId"].is_a?(String)

        case effect["type"]
        when "move_card"
          next unless effect.dig("from", "zone") == "front" && effect.dig("destination", "zone") == "abyss"

          { kind: "move", card_id: target["cardId"], from: "field", to: "abisso" }.freeze
        when "restrict_action"
          next unless effect["restricts"] == "play" && effect["duration"] == "permanent" && effect.dig("details", "followsCard") == true

          { kind: "seal", card_id: target["cardId"] }.freeze
        end
      end
    end

    # Il requisito del Nexus (§3.1), certificato solo nella forma
    # «controlli almeno N Entità [di razza]» e «scarta una carta
    # [di tipo]», più il recupero di PV stampato sulla faccia del Nexus.
    # Le abilità speciali del Rubyfront/Nexus (§3.1), per faccia: id,
    # finestra (le fasi del proprio turno), costo o recupero in PV, se la
    # Furia le precede (§8.1), e la FORMA certificata dell'effetto — o nil,
    # quando l'effetto è di una forma che l'engine non legge (resta a mano).
    # Forme certificate: lo sguardo nel mazzo (le prime N, mostrane una del
    # tipo/razza in mano, le altre in fondo), il potenziamento di Potenza
    # fino a fine turno (a tutte le proprie Entità di un filtro, o a una), lo
    # sconto sulla prossima carta di un tipo giocata nel turno.
    def self.abilities(faces)
      faces.each_with_index.flat_map do |face, index|
        Array(face["actions"]).filter_map do |action|
          next unless action.is_a?(Hash) && action["id"].is_a?(String)

          timing = Array(action["timing"]).filter_map { |window| { "own_preparation" => "preparazione", "own_front" => "fronte" }[window] }
          next if timing.empty?

          cost = integer_stat(action.dig("cost", "health"))
          gain = integer_stat(action.dig("gain", "health"))
          next unless cost || gain

          { id: action["id"], face: index, timing: timing.freeze, cost: cost, gain: gain,
            fury: Array(action["checks"]).include?("fury"), form: ability_form(action["effect"]) }.freeze
        end
      end
    end

    def self.ability_form(effect)
      return nil unless effect.is_a?(Hash)

      case effect["type"]
      when "look_and_optionally_move"
        from = effect["from"]
        details = effect["details"]
        return nil unless from.is_a?(Hash) && from["zone"] == "deck" && from["owner"] == "controller" && from["position"] == "top" && from["count"].is_a?(Integer)
        return nil unless details.is_a?(Hash) && details.dig("revealTo", "zone") == "hand" && details.dig("restTo", "zone") == "deck" && details.dig("restTo", "position") == "bottom"

        may = details["mayReveal"]
        return nil unless may.is_a?(Hash) && %w[entity object].include?(may["cardType"])

        { kind: "look", count: from["count"], reveal: { type: may["cardType"], race: may["race"].is_a?(String) ? may["race"] : nil }.freeze }.freeze
      when "modify_power"
        target = effect["target"]
        return nil unless target.is_a?(Hash) && target["cardType"] == "entity" && target["controller"] == "controller"
        return nil unless effect["amount"].is_a?(Integer) && effect["duration"] == "until_end_of_turn"

        all = target["quantity"] == "all"
        one = target["min"] == 1 && target["max"] == 1
        return nil unless all || one

        details = target["details"].is_a?(Hash) ? target["details"] : {}
        { kind: "power", amount: effect["amount"], targets: all ? "all" : "one", race: target["race"].is_a?(String) ? target["race"] : nil,
          attacking: details["attacking"] == true, armed: details["hasObjectAssigned"] == true }.freeze
      when "reduce_cost"
        return nil unless effect["amount"].is_a?(Integer) && effect.dig("details", "nextPlayedThisTurn") == true

        filter = effect["target"].is_a?(Hash) ? effect["target"] : effect["filter"]
        return nil unless filter.is_a?(Hash) && %w[entity object].include?(filter["cardType"])

        { kind: "discount", amount: effect["amount"], type: filter["cardType"], race: filter["race"].is_a?(String) ? filter["race"] : nil }.freeze
      end
    end

    # La soglia della Furia per faccia (§8.1): «d20 ≥ N» dal check della
    # parola chiave; una faccia senza Furia non compare.
    def self.fury_at(faces)
      faces.each_with_index.filter_map do |face, index|
        fury = Array(face["keywords"]).find { |keyword| keyword.is_a?(Hash) && keyword["id"] == "fury" }
        next unless fury

        [index, integer_stat(fury.dig("check", "successAtLeast")) || 12]
      end.to_h
    end

    # Il disarmo all'ingresso (§8.2, dal 2026-09-10): «quando entra sul
    # Fronte, metti nella Zona di Ritiro del suo proprietario ogni Oggetto
    # assegnato a un'Entità avversaria». Ogni voce: { to: "ritiro" }.
    def self.enter_disarms(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == "on_enter_field"

        effect = trigger["effect"]
        next unless effect.is_a?(Hash) && effect["type"] == "move_card"

        target = effect["target"]
        next unless target.is_a?(Hash) && target["cardType"] == "object" && target["controller"] == "opponent" && target["zone"] == "front" && target["quantity"] == "all"
        next unless target.dig("details", "assigned") == true
        next unless effect.dig("destination", "zone") == "retire" && effect.dig("destination", "owner") == "card_owner"

        { to: "ritiro" }.freeze
      end
    end

    # Il riarmo all'ingresso (§8.2, dal 2026-09-10): «poi puoi assegnare alle
    # Entità che controlli, come preferisci e senza pagarne il costo di
    # Flusso, gli Oggetti della tua Zona di Ritiro». Ogni voce: { any: true }.
    def self.enter_rearms(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == "on_enter_field"

        effect = trigger["effect"]
        next unless effect.is_a?(Hash) && effect["type"] == "assign_object" && effect["optional"] == true
        next unless effect.dig("from", "zone") == "retire" && effect.dig("from", "owner") == "controller"
        # La variante su di sé (dal 2026-09-10): «puoi assegnare a questa
        # Entità un Oggetto dalla tua Zona di Ritiro senza pagarne il costo».
        if effect.dig("target", "scope") == "self"
          next unless effect["details"].is_a?(Hash) && effect["details"].keys == ["noFluxCost"] && effect["details"]["noFluxCost"] == true

          next { self: true }.freeze
        end
        next unless own_target?(effect["target"], "entity") && effect.dig("target", "quantity") == "all"
        next unless effect.dig("details", "anyNumber") == true && effect.dig("details", "noFluxCost") == true

        { any: true }.freeze
      end
    end

    # Il ritorno vincolato (§8.2, dal 2026-09-10): «quando viene mandata
    # nell'Abisso o nella Zona di Ritiro, se non aveva Oggetti assegnati,
    # puoi rimetterla sul tuo Fronte assegnandole un Oggetto con costo di
    # Flusso N o inferiore dalla tua Zona di Ritiro, senza pagarne il costo».
    # Ogni voce: { max_cost: }.
    def self.leave_returns(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == "on_leave_field"
        next unless trigger.dig("details", "requiresNoObjectAssignedWhenLeft") == true

        effect = trigger["effect"]
        next unless effect.is_a?(Hash) && effect["type"] == "move_card" && effect["optional"] == true
        next unless effect.dig("target", "scope") == "self" && effect.dig("destination", "zone") == "front"

        rearm = effect.dig("details", "thenAssignObject")
        next unless rearm.is_a?(Hash) && rearm.dig("from", "zone") == "retire" && rearm["noFluxCost"] == true && rearm["required"] == true

        conditions = Array(rearm.dig("filter", "conditions"))
        max_cost = conditions.find { |c| c.is_a?(Hash) && c["stat"] == "flux_cost" && c["operator"] == "lte" && c["value"].is_a?(Integer) }
        next unless rearm.dig("filter", "cardType") == "object" && max_cost && conditions.size == 1

        { max_cost: max_cost["value"] }.freeze
      end
    end

    def self.nexus_of(faces)
      rubyfront = faces.find { |face| face["kind"] == "rubyfront" }
      nexus_index = faces.index { |face| face["kind"] == "nexus" }
      return nil unless rubyfront && nexus_index

      requirement = rubyfront.dig("requirements", "nexus")
      return nil unless requirement.is_a?(Hash) && requirement["match"] == "all"

      conditions = Array(requirement["conditions"]).map do |condition|
        next nil unless condition.is_a?(Hash) && condition["type"] == "controls_card" && condition["owner"] == "controller" && condition["min"].is_a?(Integer)

        filter = condition["filter"]
        next nil unless filter.is_a?(Hash) && filter["cardType"] == "entity" && (filter.keys - %w[cardType race details]).empty?

        # «Con un Oggetto assegnato» (dal 2026-09-10): l'unico dettaglio certificato.
        details = filter["details"]
        armed = details == { "hasObjectAssigned" => true }
        next nil if details && !armed

        entry = { count: condition["min"], type: "entity", race: filter["race"].is_a?(String) ? filter["race"] : nil }
        entry[:armed] = true if armed
        entry.freeze
      end
      return nil if conditions.empty? || conditions.any?(&:nil?)

      costs = Array(requirement["flipCost"]).map do |cost|
        next nil unless cost.is_a?(Hash) && cost["type"] == "discard_card" && cost["count"] == 1 && cost.dig("target", "controller") == "controller"

        { count: 1, type: cost.dig("filter", "cardType").is_a?(String) ? cost["filter"]["cardType"] : nil }.freeze
      end
      return nil if costs.any?(&:nil?) || costs.size > 1

      recovery = integer_stat(faces[nexus_index].dig("stats", "healthRecovery"))
      { face: nexus_index, conditions: conditions.freeze, discard: costs.first, recovery: recovery }.freeze
    end

    def self.matter_of(faces)
      matter = faces.filter_map { |face| face["matter"] if face["matter"].is_a?(Hash) }.first
      return nil unless matter && matter["type"].is_a?(String)

      { type: matter["type"], grade: integer_stat(matter["grade"]) }.freeze
    end

    def self.enables_of(face)
      Array(face["enablesMatters"]).filter_map do |entry|
        next unless entry.is_a?(Hash) && entry["type"].is_a?(String)

        { type: entry["type"], max_grade: integer_stat(entry["maxGrade"]) }.freeze
      end.freeze
    end

    # Una statistica vale solo se è un intero: un costo a dado
    # (`{ "base": 3 }`) o un valore mancante restano nil, mai fraintesi.
    def self.integer_stat(value)
      value.is_a?(Integer) ? value : nil
    end

    # La prima forma CERTIFICATA del contratto degli effetti: «mentre questo
    # Oggetto è assegnato, l'Entità che lo porta ottiene le parole chiave X»
    # — con l'eventuale condizione di razza. È il trigger di un Oggetto
    # che concede: evento `while_assigned`, effetto `empower` sul portatore
    # (`scope: assigned`), durata `permanent`. Tutto ciò che non combacia
    # esattamente con questa forma NON entra nell'anagrafe: l'engine
    # preferisce ignorare un effetto che fraintenderlo.
    def self.grants_while_assigned(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == "while_assigned"

        effect = trigger["effect"]
        next unless effect.is_a?(Hash) && effect["type"] == "empower"
        next unless effect.dig("target", "scope") == "assigned"
        next unless effect["duration"] == "permanent"

        granted = Array(effect["grants"]).select { |keyword| keyword.is_a?(String) }
        next if granted.empty?

        { keywords: granted.freeze, if_race: effect.dig("details", "ifAssignedRace") }.freeze
      end
    end
  end
end
