# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/table"

# La copia della lavagna: deve contare come contano i client (state.ts).
class TableTest < Minitest::Test
  def setup
    @table = Rubyfront::Table.new
  end

  def deck_for(seat, count)
    cards = (1..count).map do |serial|
      { "uid" => "#{seat}-#{serial}", "owner" => seat, "zone" => "deck", "order" => serial }
    end
    { "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards }
  end

  def test_carico_e_pesca
    @table.apply(deck_for("a", 10))
    assert_equal 0, @table.hand_count("a")
    @table.apply({ "t" => "draw", "seat" => "a", "count" => 3 })
    assert_equal 3, @table.hand_count("a")
    assert_equal 7, @table.zone_count("a", "deck")
  end

  def test_ricaricare_il_mazzo_azzera_solo_quel_posto
    @table.apply(deck_for("a", 5))
    @table.apply(deck_for("b", 5))
    @table.apply({ "t" => "draw", "seat" => "a", "count" => 2 })
    @table.apply(deck_for("a", 4))
    assert_equal 0, @table.hand_count("a"), "il mazzo ricaricato riparte da zero"
    assert_equal 4, @table.zone_count("a", "deck")
    assert_equal 5, @table.zone_count("b", "deck"), "l'altro posto non si tocca"
  end

  def test_to_zone_sposta_fra_le_zone
    @table.apply(deck_for("a", 3))
    @table.apply({ "t" => "draw", "seat" => "a", "count" => 2 })
    @table.apply({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
    assert_equal 1, @table.hand_count("a")
    assert_equal 1, @table.zone_count("a", "abisso")
    @table.apply({ "t" => "toZone", "uid" => "a-2", "zone" => "field" })
    assert_equal 0, @table.hand_count("a")
  end

  def test_pescare_da_mazzo_vuoto_non_fa_nulla
    @table.apply(deck_for("a", 1))
    @table.apply({ "t" => "draw", "seat" => "a", "count" => 3 })
    assert_equal 1, @table.hand_count("a"), "si pesca solo ciò che c'è"
  end

  def test_turno_e_posto_attivo
    assert_equal "a", @table.active
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_equal "b", @table.active
    assert_equal 2, @table.turn
  end

  def test_snapshot_sostituisce_tutto
    @table.apply(deck_for("a", 5))
    @table.load({
      "turn" => 4,
      "active" => "b",
      "cards" => {
        "b-1" => { "owner" => "b", "zone" => "hand", "order" => 0 },
        "b-2" => { "owner" => "b", "zone" => "hand", "order" => 1 },
      },
    })
    assert_equal 0, @table.zone_count("a", "deck")
    assert_equal 2, @table.hand_count("b")
    assert_equal "b", @table.active
  end

  def test_new_game_azzera
    @table.apply(deck_for("a", 5))
    @table.apply({ "t" => "turn", "turn" => 3, "active" => "b" })
    @table.apply({ "t" => "newGame" })
    assert_equal 0, @table.zone_count("a", "deck")
    assert_equal "a", @table.active
    assert_equal 1, @table.turn
  end
end
