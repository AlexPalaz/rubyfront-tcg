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
    # prime N carte del tuo mazzo, puoi mostrarne un'Entità [di razza] e
    # aggiungerla alla mano, metti le altre in fondo» — la forma di RBF-006.
    # Ogni voce: { count:, reveal: { type:, race: } }.
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
          enter_returns: enter_returns(faces).freeze,
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

    def self.enter_returns(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == "on_enter_field"
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

    def self.enter_looks(faces)
      faces.flat_map { |face| Array(face["triggers"]) }.filter_map do |trigger|
        next unless trigger.is_a?(Hash) && trigger["event"] == "on_enter_field"
        next if trigger["details"].is_a?(Hash) && trigger["details"]["enteringCard"]

        effect = trigger["effect"]
        next unless effect.is_a?(Hash) && effect["type"] == "look_and_optionally_move"

        from = effect["from"]
        details = effect["details"]
        next unless from.is_a?(Hash) && from["zone"] == "deck" && from["owner"] == "controller" && from["position"] == "top" && from["count"].is_a?(Integer)
        next unless details.is_a?(Hash) && details.dig("revealTo", "zone") == "hand"
        next unless details.dig("restTo", "zone") == "deck" && details.dig("restTo", "position") == "bottom"

        may = details["mayReveal"]
        next unless may.is_a?(Hash) && may["cardType"] == "entity"

        { count: from["count"], reveal: { type: "entity", race: may["race"].is_a?(String) ? may["race"] : nil }.freeze }.freeze
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
