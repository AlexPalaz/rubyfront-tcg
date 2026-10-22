# frozen_string_literal: true

require "json"
require "minitest/autorun"
require_relative "../lib/rubyfront/card_index"
require_relative "../lib/rubyfront/engine"

# Il corpus differenziale TS ↔ Ruby (2026-10-21, audit RF-029, T31): le
# sequenze in engine/test/corpus/*.json — scritte dal riduttore del client
# (core/test/corpus.test.ts) con la lavagna normalizzata dopo ogni passo —
# rigiocate qui sulla copia del tavolo (`observe`: si applica comunque, come
# in partita quando l'azione è già passata). A ogni passo `Table#dump` deve
# dire la stessa cosa di normalize.ts. Dove divergono, divergono i gemelli.
class CorpusTest < Minitest::Test
  DATA_DIR = File.expand_path("../../data", __dir__)
  CORPUS_DIR = File.expand_path("corpus", __dir__)
  CARDS = Rubyfront::CardIndex.load(DATA_DIR)

  Dir.glob(File.join(CORPUS_DIR, "*.json")).sort.each do |path|
    name = File.basename(path, ".json")
    define_method("test_corpus_#{name.tr("-", "_")}") do
      corpus = JSON.parse(File.read(path))
      assert_equal 1, corpus["version"]
      engine = Rubyfront::Engine.new(cards: CARDS)
      table = engine.instance_variable_get(:@table)
      corpus["steps"].each_with_index do |step, index|
        engine.observe(step["action"])
        assert_equal step["state"], table.dump, "#{name}: passo #{index + 1} (#{step["action"]["t"]})"
      end
    end
  end

  def test_corpus_is_not_empty
    refute_empty Dir.glob(File.join(CORPUS_DIR, "*.json")), "il corpus si scrive da core: CORPUS_WRITE=1 npx vitest run test/corpus.test.ts"
  end
end
