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
    FORMS = %i[enter_listeners enter_moves enter_looks enter_controls attack_draws attack_forms grants_while_assigned].freeze
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
