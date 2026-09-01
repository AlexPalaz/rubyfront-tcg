# frozen_string_literal: true

require "json"

module Rubyfront
  # L'anagrafe delle carte: id -> tipo e parole chiave, letti dai dati del
  # sito (data/sets/*/cards/*/<id>.json — il file dati, non i testi *.it/.en).
  #
  # È l'unico punto in cui l'engine tocca il resto del repo, ed è un confine
  # esplicito: il percorso arriva da fuori (bin/server lo risolve, e
  # RUBYFRONT_DATA lo cambia). Quando l'engine emigrerà in un repo suo,
  # cambierà questo percorso e nient'altro. Il giudizio (engine.rb) riceve
  # l'indice già pronto e non fa mai I/O.
  module CardIndex
    # data_dir -> { "RBF-009" => { type: "entity", keywords: ["surge"] }, ... }
    def self.load(data_dir)
      index = {}
      Dir.glob(File.join(data_dir, "sets", "*", "cards", "*", "*.json")).each do |path|
        # Il file dati porta il nome della sua cartella (rbf-009/rbf-009.json);
        # i compagni .it.json/.en.json sono testi e non c'entrano.
        next unless File.basename(path, ".json") == File.basename(File.dirname(path))

        card = JSON.parse(File.read(path))
        next unless card.is_a?(Hash) && card["id"]

        keywords = Array(card["faces"]).flat_map do |face|
          Array(face["keywords"]).filter_map { |keyword| keyword.is_a?(Hash) ? keyword["id"] : nil }
        end
        index[card["id"]] = { type: card["type"], keywords: keywords.uniq }.freeze
      rescue JSON::ParserError
        next
      end
      index.freeze
    end
  end
end
