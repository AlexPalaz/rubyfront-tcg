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
