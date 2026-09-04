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
    #   "RBF-009" => { type: "entity", race: "human", keywords: ["surge"],
    #                  power: 3, counterattack: nil, grants_while_assigned: [] },
    #   "RBF-013" => { type: "object", race: nil, keywords: [], power: nil,
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
    # Fronte, se ne controlli almeno N [di razza Y], pesca K carte» — la
    # forma di RBF-003. Ogni voce: { entering_race:, requires: { count:,
    # race: }, draw: }. Tutto ciò che non combacia esattamente non entra.
    #
    # `enter_moves` sono gli spostamenti all'ingresso CERTIFICATI (§8.2):
    # «quando questa Entità entra in campo, metti un'Entità avversaria nella
    # Zona di Ritiro» — la forma di RBF-007. Ogni voce: { target: { type:,
    # controller: }, to: }.
    #
    # `enter_returns` sono i ritorni all'ingresso CERTIFICATI (§8.2): «quando
    # questa Entità entra in campo, metti sul tuo Fronte una carta permanente
    # dalla tua Zona di Ritiro» — la forma di RBF-012. Ogni voce: { from:,
    # filter: { type:, behavior: }, to: }.
    #
    # `enter_looks` sono gli sguardi nel mazzo CERTIFICATI (§8.2): «guarda le
    # prime N carte del tuo mazzo, puoi mostrarne una [di tipo e razza] e
    # aggiungerla alla mano, [mettine una nella Zona di Ritiro,] metti le
    # altre in fondo» — le forme di RBF-006 (N fisso) e RBF-027 (N = base +
    # ceil(tiro/2), con un dado). Ogni voce: { count:, die:, count_base:,
    # reveal: { type:, race: }, then_retire: }.
    #
    # `enter_controls` sono i controlli all'ingresso CERTIFICATI (§8.2):
    # «prendi il controllo di un'Entità avversaria con costo di Flusso N o
    # inferiore fino alla fine del turno; ottiene [parole chiave]» — la forma
    # di RBF-009. Ogni voce: { target: { type:, controller:, max_cost: },
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
    #   RBF-002 { kind: "self_power", amount:, while_attacking: true, requires_other: { type:, race: } }
    #   RBF-010 { kind: "self_power", amount:, per_other: { type:, race: } }
    #   RBF-013 { kind: "bearer_power", amount: }
    #   RBF-014 { kind: "bearer_power", amount:, per: { type:, race: }, multi_block: true }
    #
    # `resolve_forms` sono gli effetti delle Materie CERTIFICATI (§7.2,
    # «l'effetto si risolve»), letti dall'evento `on_resolve`:
    #
    #   RBF-015 { kind: "look", count:, reveal: { type:, race: }, reveal_to: "hand", rest_to: "deck", show_up_to: }
    #   RBF-016 { kind: "empower", targets: "own_entity", race:, power:, untap: true }
    #   RBF-017 { kind: "move", target: { type: "entity", controller: "opponent", max_cost: }, to: "ritiro" }
    #   RBF-018 { kind: "exile", target: { permanent: true, controller: "opponent" }, to: "abisso", hold: true }
    #   RBF-019 { kind: "fortune", die:, gain: { on:, amount: }, deploy: { on:, filter: }, draw: { on:, count: }, all_on: }
    #   RBF-020 { kind: "empower", targets: "own_entities", race:, counter:, untap: true, as_block: true, requires: { count:, race: } }
    #   RBF-021 { kind: "destroy", target: { type: "entity", controller: "any" }, to: "abisso", discount: { amount:, if_target: "tapped" } }
    #   RBF-040 { kind: "block", requires_armed:, heal:, as_block: true } — giocata come blocco a un attaccante (§6.4); con N armati sul Fronte, +M PV
    #
    # `flip_forms` sono gli effetti «quando flippa» CERTIFICATI del Nexus
    # (§3.1), evento `on_flip`: RBF-001 { kind: "move", card_id:, from:
    # "field", to: "abisso" } e { kind: "seal", card_id: }.
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
        # Il file dati porta il nome della sua cartella (rbf-009/rbf-009.json);
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
          static_forms: static_forms(faces).freeze,
          resolve_forms: resolve_forms(faces).freeze,
          flip_forms: flip_forms(faces).freeze,
          nexus: nexus_of(faces),
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
    FORMS = %i[enter_listeners enter_moves enter_looks enter_controls attack_draws attack_forms grants_while_assigned
               static_forms resolve_forms flip_forms].freeze
    RETURN_EVENTS = %w[on_enter_field on_attack].freeze

    # Un trigger è riconosciuto se almeno una forma certificata lo legge.
    def self.recognized?(trigger)
      faces = [{ "triggers" => [trigger] }]
      FORMS.any? { |form| !send(form, faces).empty? } ||
        RETURN_EVENTS.any? { |event| !enter_returns(faces, event).empty? }
    end

    # I trigger delle carte in `data_dir` che nessuna forma riconosce:
    # «RBF-001 nexus/heirs-muster». È il debito dichiarato della regola
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
        next unless destination.is_a?(Hash) && destination["zone"] == "retire"

        { target: { type: "entity", controller: "opponent" }.freeze, to: "ritiro" }.freeze
      end
    end

    # Stessa forma all'ingresso (`enter_returns`) e all'attacco
    # (`attack_returns`, il secondo innesco di RBF-012).
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

        { from: "ritiro", filter: { type: "matter", behavior: "permanent" }.freeze, to: "field" }.freeze
      end
    end

    # `attack_draws` è la forma di RBF-026, l'Esploratore: «la prima volta
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
    #   RBF-028 { kind: "untap",   who: "self", once:, requires_object: }        stappa dopo il combattimento
    #   RBF-029 { kind: "empower", who: "self", targets: "others_armed", power: } +1 alle altre armate
    #   RBF-034 { kind: "empower", who: "object", targets: "bearer", power: }    +1 al portatore
    #   RBF-034 { kind: "look", who: "object", die:, on_roll:, count:, reveal:, reveal_to:, rest_to: }
    #   RBF-031 { kind: "look", who: "ally", attacker_armed:, once:, count:, reveal:, reveal_to:, rest_to: }
    #   RBF-031 { kind: "rearm", who: "ally", attacker_armed: }                  un Oggetto dal Ritiro, gratis
    #   RBF-008 { kind: "heal", who: "self", amount:, die:, on_roll:, then_recall: } +2 PV, poi col dado un'Entità in mano
    #   RBF-010 { kind: "return", who: "self", die:, on_roll:, filter:, joins: }  un'Entità dal Ritiro, che attacca
    #   RBF-011 { kind: "refresh", who: "self", die:, on_roll: }                  stappa tutto, Fronte addizionale
    #   RBF-022 { kind: "heal", who: "permanent", attackers:, die:, gain_on:, drain_on: } PV pari agli Umani attaccanti
    #   RBF-001 { kind: "heal", who: "rubyfront", once:, requires_attackers:, amount:, then_draw:, then_discard: }
    #   RBF-004 { kind: "empower", who: "self", once:, targets: "next_human_attacker", grants: }
    #   RBF-005 { kind: "empower", who: "self", requires_previous_attackers:, targets: "opposing_entity", restrict: }
    def self.attack_forms(faces)
      faces.each_with_index.flat_map do |face, index|
        Array(face["triggers"]).filter_map do |trigger|
          next unless trigger.is_a?(Hash) && trigger["event"] == "on_attack"

          details = trigger["details"].is_a?(Hash) ? trigger["details"] : {}
          effect = trigger["effect"]
          next unless effect.is_a?(Hash)

          form = attack_untap(details, effect) || attack_empower(details, effect) || attack_look(details, effect) ||
                 attack_heal(details, effect) || attack_refresh(details, effect) || attack_recall(details, effect) ||
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

    # RBF-028: «stappala dopo il combattimento».
    def self.attack_untap(details, effect)
      return nil unless effect["type"] == "untap" && effect.dig("target", "scope") == "self" && effect.dig("details", "afterCombat") == true
      return nil unless details["oncePerEachOfYourTurns"] == true && details["whileHasObjectAssigned"] == true

      { kind: "untap", who: "self", once: true, requires_object: true }
    end

    # RBF-029 (+1 alle altre armate), RBF-034 (+1 al portatore), RBF-004 (Vendetta al prossimo Umano).
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

    # RBF-034 (col dado, una Materia in mano, le altre in Ritiro) e RBF-031 (un Oggetto in Ritiro, le altre in fondo).
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

    # RBF-008 (+2 PV, poi col dado un'Entità dal Ritiro in mano), RBF-022 (il d20 sugli Umani attaccanti), RBF-001 (il raduno).
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

        return { kind: "heal", who: "permanent", attackers: { type: "entity", race: "human" }.freeze, die: die,
                 gain_on: roll_range(gain), drain_on: roll_range(drain), amount: "human_attackers" }
      end
      nil
    end

    # RBF-011: stappa tutte le proprie Entità e, col tiro, una Fase di Fronte addizionale.
    def self.attack_refresh(details, effect)
      return nil unless details.empty? && effect["type"] == "untap" && own_target?(effect["target"], "entity") && effect.dig("target", "quantity") == "all"

      extra = effect["details"]
      return nil unless extra.is_a?(Hash) && extra["thenAdditionalFrontPhase"] == true

      die = die_faces(extra["die"])
      on_roll = roll_range(extra["onRoll"])
      die && on_roll ? { kind: "refresh", who: "self", die: die, on_roll: on_roll } : nil
    end

    # RBF-010: col dado, un'Entità Umana dal Ritiro sul Fronte, che attacca insieme.
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

    # RBF-031: quando un'Entità armata che controlli attacca, puoi assegnarle un Oggetto dal Ritiro, gratis.
    def self.attack_rearm(details, effect)
      attacker = details["attacker"]
      return nil unless effect["type"] == "assign_object" && effect["optional"] == true
      return nil unless effect.dig("from", "zone") == "retire" && effect.dig("target", "scope") == "attacker" && effect.dig("details", "noFluxCost") == true
      return nil unless own_target?(attacker, "entity") && attacker.dig("details", "hasObjectAssigned") == true

      { kind: "rearm", who: "ally", attacker_armed: true }
    end

    # RBF-005: se almeno N Umani hanno attaccato nel turno precedente, un'Entità avversaria non blocca.
    def self.attack_restrict(details, effect)
      previous = details["requiresAttackersPreviousTurnAtLeast"]
      return nil unless effect["type"] == "restrict_action" && effect["restricts"] == "block" && effect["duration"] == "until_end_of_turn"

      target = effect["target"]
      return nil unless target.is_a?(Hash) && target["cardType"] == "entity" && target["controller"] == "opponent" && target["min"] == 1 && target["max"] == 1
      return nil unless previous.is_a?(Hash) && previous["count"].is_a?(Integer) && own_target?(previous["filter"], "entity", "human")

      { kind: "empower", who: "self", requires_previous_attackers: { count: previous["count"], race: "human" }.freeze, targets: "opposing_entity", restrict: "block" }
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

        # Il conto: fisso (RBF-006), o col dado «2 + ceil(result/2)» (RBF-027),
        # la sola formula certificata.
        count = from["count"].is_a?(Integer) ? from["count"] : nil
        die = nil
        base = 0
        unless count
          faces = details["die"].is_a?(String) && details["die"][/\Ad(\d+)\z/, 1]
          formula = details["count"].is_a?(String) && details["count"][/\A(\d+) \+ ceil\(result\/2\)\z/, 1]
          next unless faces && formula

          die = faces.to_i
          base = formula.to_i
        end
        then_to = details["thenMoveOneTo"]
        next if then_to && (!then_to.is_a?(Hash) || then_to["zone"] != "retire")

        { count: count, die: die, count_base: base,
          reveal: { type: may["cardType"], race: may["race"].is_a?(String) ? may["race"] : nil }.freeze,
          then_retire: !then_to.nil? }.freeze
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

    # Gli statici di Potenza (§8.2): RBF-002, RBF-010 (`while_in_play`, su
    # di sé) e RBF-013, RBF-014 (`while_assigned`, sul portatore).
    def self.static_forms(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && %w[while_in_play while_assigned].include?(trigger["event"])

        effect = trigger["effect"]
        next unless effect.is_a?(Hash) && effect["type"] == "modify_power" && effect["amount"].is_a?(Integer)

        details = effect["details"].is_a?(Hash) ? effect["details"] : {}
        if trigger["event"] == "while_in_play"
          next unless effect.dig("target", "scope") == "self"

          if details["whileAttacking"] == true
            other = race_filter(details["requiresOtherControlled"])
            next unless other

            { kind: "self_power", amount: effect["amount"], while_attacking: true, requires_other: other }.freeze
          elsif details["perOtherControlled"]
            other = race_filter(details["perOtherControlled"], zone: "front")
            next unless other && details.keys == ["perOtherControlled"]

            { kind: "self_power", amount: effect["amount"], per_other: other }.freeze
          end
        else
          next unless effect.dig("target", "scope") == "assigned" && effect["duration"] == "permanent"

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

        form = resolve_look(effect) || resolve_untap(effect) || resolve_move(effect) || resolve_fortune(effect) || resolve_destroy(effect) || resolve_block(effect)
        form&.freeze
      end
    end

    # RBF-015: guarda le prime N, mostra un'Entità Umana (fino a 2 in vista), una in mano, le altre in fondo.
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

    # RBF-016 (stappa un'Entità Umana: +1 Potenza) e RBF-020 (come blocco: stappa gli Umani, Contrattacco +1).
    def self.resolve_untap(effect)
      return nil unless effect["type"] == "untap"

      target = effect["target"]
      extra = effect["details"]
      return nil unless own_target?(target, "entity") && extra.is_a?(Hash) && extra["duration"] == "until_end_of_turn"

      race = target["race"].is_a?(String) ? target["race"] : nil
      if target["min"] == 1 && target["max"] == 1 && extra["thenPowerBonus"].is_a?(Integer) && extra.keys.sort == %w[duration thenPowerBonus]
        return { kind: "empower", targets: "own_entity", race: race, power: extra["thenPowerBonus"], untap: true }
      end
      if target["quantity"] == "all" && extra["playedAsBlock"] == true && extra["thenCounterattackBonus"].is_a?(Integer)
        requires = extra["requiresControlledAtLeast"]
        return nil unless requires.is_a?(Hash) && requires["count"].is_a?(Integer) && own_target?(requires["filter"], "entity")

        return { kind: "empower", targets: "own_entities", race: race, counter: extra["thenCounterattackBonus"], untap: true, as_block: true,
                 requires: { count: requires["count"], race: requires["filter"]["race"].is_a?(String) ? requires["filter"]["race"] : nil }.freeze }
      end
      nil
    end

    # RBF-040: «giocala come blocco a un attaccante: quell'attacco è bloccato. Se sul tuo
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

    # RBF-017 (un'Entità avversaria economica in Ritiro) e RBF-018 (un permanente avversario nell'Abisso, finché questa carta resta).
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
        return nil unless certified && effect["details"].nil?

        return { kind: "move", target: { type: "entity", controller: "opponent", max_cost: max_cost }.freeze, to: "ritiro" }
      end
      extra = effect["details"]
      if target.dig("details", "permanent") == true && destination["zone"] == "abyss" && extra.is_a?(Hash) &&
         extra["whileSourceOnField"] == true && extra["returnsToPlayWhenSourceLeaves"] == true
        return { kind: "exile", target: { permanent: true, controller: "opponent" }.freeze, to: "abisso", hold: true }
      end
      nil
    end

    # RBF-019: il d20 a fasce — PV, un'Entità dalla mano, una pesca, o tutto.
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

    # RBF-021: distruggi un'Entità; contro una tappata costa N in meno.
    def self.resolve_destroy(effect)
      return nil unless effect["type"] == "destroy"

      target = effect["target"]
      extra = effect["details"]
      return nil unless target.is_a?(Hash) && target["cardType"] == "entity" && target["min"] == 1 && target["max"] == 1 && %w[any opponent controller].include?(target["controller"])
      return nil unless extra.is_a?(Hash) && extra.dig("toZone", "zone") == "abyss"
      # Un seguito ignoto (RBF-038: «poi perdi 2 PV») rende la forma ignota.
      return nil unless (extra.keys - %w[toZone fluxCostReduction]).empty?

      discount = extra["fluxCostReduction"]
      certified = discount.nil? || (discount.is_a?(Hash) && discount["amount"].is_a?(Integer) && discount["ifTargetState"] == "tapped")
      return nil unless certified

      { kind: "destroy", target: { type: "entity", controller: target["controller"] }.freeze, to: "abisso",
        discount: discount && { amount: discount["amount"], if_target: "tapped" }.freeze }
    end

    # «Quando flippa» (§3.1), la forma di RBF-001: la carta nominata dal
    # proprio Fronte nell'Abisso, e il divieto di giocarla per il resto della
    # partita.
    def self.flip_forms(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == "on_flip"

        effect = trigger["effect"]
        next unless effect.is_a?(Hash)

        target = effect["target"]
        next unless target.is_a?(Hash) && target["cardId"].is_a?(String) && target["controller"] == "controller"

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

    # Il requisito del Nexus (§3.1), certificato solo nella forma di RBF-001
    # e RBF-023: «controlli almeno N Entità [di razza]» e «scarta una carta
    # [di tipo]», più il recupero di PV stampato sulla faccia del Nexus.
    def self.nexus_of(faces)
      rubyfront = faces.find { |face| face["kind"] == "rubyfront" }
      nexus_index = faces.index { |face| face["kind"] == "nexus" }
      return nil unless rubyfront && nexus_index

      requirement = rubyfront.dig("requirements", "nexus")
      return nil unless requirement.is_a?(Hash) && requirement["match"] == "all"

      conditions = Array(requirement["conditions"]).map do |condition|
        next nil unless condition.is_a?(Hash) && condition["type"] == "controls_card" && condition["owner"] == "controller" && condition["min"].is_a?(Integer)

        filter = condition["filter"]
        # Un vincolo in più (RBF-023: «con un Oggetto assegnato») è una forma ignota.
        next nil unless filter.is_a?(Hash) && filter["cardType"] == "entity" && (filter.keys - %w[cardType race]).empty?

        { count: condition["min"], type: "entity", race: filter["race"].is_a?(String) ? filter["race"] : nil }.freeze
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
    # — con l'eventuale condizione di razza. È il trigger del Vigorscudo
    # (RBF-013): evento `while_assigned`, effetto `empower` sul portatore
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
