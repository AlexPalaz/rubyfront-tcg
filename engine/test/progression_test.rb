# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/progression"

# La progressione dei Rubyfront (2026-09-23): livelli dall'esperienza, punti
# per esito, abilità sbloccate e configurazioni lecite. Sui dati veri e su
# casi sintetici. Nessun nome di carta nelle asserzioni: si parla per livelli
# e per facce.
class ProgressionTest < Minitest::Test
  DATA = File.expand_path("../../data", __dir__)

  def real
    @real ||= Rubyfront::Progression.load(DATA)
  end

  def synthetic
    rules = { "thresholds" => [0, 10, 20, 30, 40, 50, 60, 70, 80, 90], "points" => { "win" => 5, "loss" => 2, "draw" => 3 }, "slots" => { "rubyfront" => 1, "nexus" => 2 } }
    levels = (1..10).map do |n|
      { "level" => n, "rubyfront" => { "id" => "r#{n}", "locales" => {} }, "nexus" => { "id" => "n#{n}", "locales" => {} } }
    end
    Rubyfront::Progression.new(rules, { "X-1" => { "card" => "X-1", "levels" => levels } })
  end

  def test_real_data_has_four_rubyfronts_with_ten_levels_and_unique_ids
    assert_equal 4, real.card_ids.size
    real.card_ids.each do |card|
      levels = real.cards[card]["levels"]
      assert_equal (1..10).to_a, levels.map { |entry| entry["level"] }
      ids = levels.flat_map { |entry| [entry.dig("rubyfront", "id"), entry.dig("nexus", "id")] }
      assert_equal ids.uniq, ids
    end
    assert_equal 10, real.rules["thresholds"].size
    assert_equal 2, real.slots("rubyfront")
    assert_equal 3, real.slots("nexus")
  end

  def test_level_follows_the_thresholds_and_stays_within_one_and_ten
    p = synthetic
    assert_equal 1, p.level_for(0)
    assert_equal 1, p.level_for(9)
    assert_equal 2, p.level_for(10)
    assert_equal 10, p.level_for(90)
    assert_equal 10, p.level_for(100_000)
    assert_equal 1, p.level_for(-5)
    assert_equal [10, 20], p.span(2)
    assert_equal [90, nil], p.span(10)
  end

  def test_points_per_outcome
    p = synthetic
    assert_equal 5, p.points_for("win")
    assert_equal 2, p.points_for(:loss)
    assert_equal 3, p.points_for("draw")
    assert_equal 0, p.points_for("boh")
  end

  def test_unlocked_grows_with_the_level
    p = synthetic
    assert_equal({ "rubyfront" => %w[r1], "nexus" => %w[n1] }, p.unlocked("X-1", 1))
    assert_equal %w[r1 r2 r3], p.unlocked("X-1", 3)["rubyfront"]
    assert_equal({ "rubyfront" => [], "nexus" => [] }, p.unlocked("altro", 3))
  end

  def test_loadout_accepts_unlocked_abilities_within_the_slots
    p = synthetic
    assert_equal [true], p.loadout_ok?("X-1", 3, { "rubyfront" => %w[r2], "nexus" => %w[n1 n3] })
    # Posizionale (2026-09-24): il buco lascia il blocco stampato; conta come slot.
    assert_equal [true], p.loadout_ok?("X-1", 3, { "rubyfront" => [], "nexus" => [nil, "n3"] })
    refute p.loadout_ok?("X-1", 3, { "rubyfront" => [], "nexus" => [nil, nil, "n3"] }).first, "tre posizioni su due slot"
    assert_equal({ "rubyfront" => [], "nexus" => [nil, "n3"] }, p.progress_of("X-1", { xp: 25, loadout: { "nexus" => [nil, "n3"] } })[:loadout])
    assert_equal [true], p.loadout_ok?("X-1", 1, { "rubyfront" => [], "nexus" => [] })
    assert_equal [true], p.loadout_ok?("X-1", 1, {})
  end

  def test_loadout_refuses_locked_unknown_repeated_or_too_many_in_two_languages
    p = synthetic
    ok, it, en = p.loadout_ok?("X-1", 2, { "rubyfront" => %w[r3], "nexus" => [] })
    refute ok
    assert_match(/non sbloccata/, it)
    assert_match(/locked/, en)
    refute p.loadout_ok?("X-1", 5, { "rubyfront" => [], "nexus" => %w[n1 n1] }).first
    refute p.loadout_ok?("X-1", 5, { "rubyfront" => %w[r1 r2], "nexus" => [] }).first
    refute p.loadout_ok?("X-1", 5, { "rubyfront" => [], "nexus" => %w[n1 n2 n3] }).first
    refute p.loadout_ok?("X-1", 5, { "rubyfront" => [], "nexus" => [], "altro" => [] }).first
    refute p.loadout_ok?("X-1", 5, "no").first
    refute p.loadout_ok?("Y-9", 5, {}).first
  end

  def test_progress_of_derives_the_level_and_normalizes_the_loadout
    p = synthetic
    assert_equal({ card: "X-1", xp: 0, level: 1, loadout: { "rubyfront" => [], "nexus" => [] } }, p.progress_of("X-1"))
    row = { xp: 25, loadout: { "rubyfront" => ["r1"] } }
    assert_equal({ card: "X-1", xp: 25, level: 3, loadout: { "rubyfront" => ["r1"], "nexus" => [] } }, p.progress_of("X-1", row))
  end
end
