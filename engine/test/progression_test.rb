# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/progression"

# La progressione dei Rubyfront (2026-09-23, a percorso dal 2026-09-26):
# livelli dall'esperienza, punti per esito, il percorso (nodi collegati alla
# carta, al più uno per livello), ciò che dà in partita e le configurazioni
# lecite. Sui dati veri e su una griglia sintetica. Nessun nome di carta
# nelle asserzioni: si parla per nodi, livelli e facce.
class ProgressionTest < Minitest::Test
  DATA = File.expand_path("../../data", __dir__)
  RULES = { "thresholds" => [0, 10, 20, 30, 40, 50, 60, 70, 80, 90], "points" => { "win" => 5, "loss" => 2, "draw" => 3 }, "slots" => { "rubyfront" => 1, "nexus" => 2 } }.freeze

  def real
    @real ||= Rubyfront::Progression.load(DATA)
  end

  # La griglia sintetica:
  #
  #   carta ─ x1 (abilità A) ─ x2 (+2 PV) ─ x4 (Furia 1) ─ x5 (abilità A)
  #     └──── x3 (abilità B) ──────────────┘
  def synthetic
    nodes = [
      { "id" => "x1", "kind" => "ability", "face" => "rubyfront", "links" => ["card"] },
      { "id" => "x2", "kind" => "hp", "amount" => 2, "links" => ["x1"] },
      { "id" => "x3", "kind" => "ability", "face" => "nexus", "links" => ["card"] },
      { "id" => "x4", "kind" => "fury", "amount" => 1, "links" => %w[x2 x3] },
      { "id" => "x5", "kind" => "ability", "face" => "rubyfront", "links" => ["x4"] }
    ]
    Rubyfront::Progression.new(RULES, { "X-1" => { "card" => "X-1", "nodes" => nodes } })
  end

  def test_real_data_has_four_rubyfronts_with_twenty_connected_nodes
    assert_equal 4, real.card_ids.size
    assert_equal 10, real.rules["thresholds"].size
    assert_equal 2, real.slots("rubyfront")
    assert_equal 3, real.slots("nexus")
    real.card_ids.each do |card|
      nodes = real.cards[card]["nodes"]
      ids = nodes.map { |node| node["id"] }
      assert_equal real.rules["pathNodes"], nodes.size
      assert_equal ids.uniq, ids
      nodes.each do |node|
        assert_includes Rubyfront::Progression::KINDS, node["kind"]
        node["links"].each { |other| assert(other == "card" || ids.include?(other), "collegamento a un nodo che non c'è") }
        assert_includes Rubyfront::Progression::FACES, node["face"] if node["kind"] == "ability"
      end
      assert_equal ids.sort, real.normal_path(card, ids).sort, "tutti i nodi raggiungibili dalla carta"
      open = real.unlocked(card, ids)
      Rubyfront::Progression::FACES.each { |face| assert_operator open[face].size, :>=, real.slots(face), "abbastanza abilità per i blocchi della faccia" }
    end
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

  def test_points_per_outcome_and_one_path_point_per_level
    p = synthetic
    assert_equal 5, p.points_for("win")
    assert_equal 2, p.points_for(:loss)
    assert_equal 3, p.points_for("draw")
    assert_equal 0, p.points_for("boh")
    assert_equal 1, p.path_points(1)
    assert_equal 10, p.path_points(10)
  end

  def test_links_go_both_ways
    p = synthetic
    assert_equal %w[x1 x3], p.neighbors("X-1", "card").sort
    assert_equal %w[card x2], p.neighbors("X-1", "x1").sort
    assert_equal %w[x2 x3 x5], p.neighbors("X-1", "x4").sort
  end

  def test_path_grows_from_the_card_one_node_per_level
    p = synthetic
    assert_equal [true], p.path_ok?("X-1", 1, [])
    assert_equal [true], p.path_ok?("X-1", 1, ["x1"])
    assert_equal [true], p.path_ok?("X-1", 1, ["x3"])
    assert_equal [true], p.path_ok?("X-1", 4, %w[x1 x2 x4 x5])
    assert_equal [true], p.path_ok?("X-1", 4, %w[x3 x4 x5]), "dall'altro ramo"
  end

  def test_path_refuses_loose_too_many_repeated_or_unknown_in_two_languages
    p = synthetic
    ok, it, en = p.path_ok?("X-1", 3, ["x2"])
    refute ok
    assert_match(/staccato/, it)
    assert_match(/cut off/, en)
    ok, it, en = p.path_ok?("X-1", 1, %w[x1 x2])
    refute ok
    assert_match(/al più 1/, it)
    assert_match(/at most 1/, en)
    refute p.path_ok?("X-1", 5, %w[x1 x1]).first
    refute p.path_ok?("X-1", 5, %w[x1 zz]).first
    refute p.path_ok?("X-1", 5, "x1").first
    refute p.path_ok?("X-1", 5, [1]).first
    refute p.path_ok?("Y-9", 5, []).first
  end

  # Smontare: un nodo alla volta, finché il resto resta attaccato alla carta.
  def test_unmounting_keeps_what_stays_connected
    p = synthetic
    assert_equal [true], p.path_ok?("X-1", 4, %w[x1 x3 x4]), "senza x2, x4 passa da x3"
    refute p.path_ok?("X-1", 4, %w[x1 x4 x5]).first, "senza x3 e x2, x4 resta staccato"
  end

  def test_normal_path_orders_by_steps_from_the_card_and_drops_the_loose
    p = synthetic
    assert_equal %w[x3 x4 x5], p.normal_path("X-1", %w[x5 x4 x3])
    assert_equal %w[x1 x3 x2 x4], p.normal_path("X-1", %w[x1 x2 x4 x3])
    assert_equal %w[x1], p.normal_path("X-1", %w[x1 x5 zz x1])
  end

  def test_the_path_gives_the_ascent_and_unlocks_its_abilities
    p = synthetic
    assert_equal({ "hp" => 2, "fury" => 1 }, p.ascent("X-1", %w[x1 x2 x4]))
    assert_equal({ "hp" => 0, "fury" => 0 }, p.ascent("X-1", []))
    assert_equal({ "rubyfront" => %w[x1 x5], "nexus" => [] }, p.unlocked("X-1", %w[x1 x2 x4 x5]))
    assert_equal({ "rubyfront" => [], "nexus" => [] }, p.unlocked("altro", %w[x1]))
  end

  def test_loadout_mounts_path_abilities_of_the_right_face_within_the_slots
    p = synthetic
    path = %w[x1 x3]
    assert_equal [true], p.loadout_ok?("X-1", path, { "rubyfront" => %w[x1], "nexus" => %w[x3] })
    # Posizionale (2026-09-24): il buco lascia il blocco stampato; conta come slot.
    assert_equal [true], p.loadout_ok?("X-1", path, { "rubyfront" => [], "nexus" => [nil, "x3"] })
    assert_equal [true], p.loadout_ok?("X-1", [], {})
    refute p.loadout_ok?("X-1", path, { "rubyfront" => [], "nexus" => [nil, nil, "x3"] }).first, "tre posizioni su due slot"
    ok, it, en = p.loadout_ok?("X-1", path, { "rubyfront" => %w[x5], "nexus" => [] })
    refute ok
    assert_match(/fuori dal percorso/, it)
    assert_match(/off the path/, en)
    refute p.loadout_ok?("X-1", path, { "rubyfront" => %w[x3], "nexus" => [] }).first, "l'abilità dell'altra faccia"
    refute p.loadout_ok?("X-1", path, { "rubyfront" => [], "nexus" => %w[x3 x3] }).first
    refute p.loadout_ok?("X-1", path, { "rubyfront" => [], "nexus" => [], "altro" => [] }).first
    refute p.loadout_ok?("X-1", path, "no").first
    refute p.loadout_ok?("Y-9", path, {}).first
  end

  def test_progress_of_is_level_one_and_empty_without_a_row
    assert_equal({ card: "X-1", xp: 0, level: 1, path: [], loadout: { "rubyfront" => [], "nexus" => [] } }, synthetic.progress_of("X-1"))
  end

  # Le soglie ritarate (2026-09-24): il livello può scendere. Il percorso si
  # accorcia dalla coda e le abilità montate fuori dal percorso si smontano:
  # la forma pubblica è sempre lecita.
  def test_progress_of_trims_the_path_to_the_level_and_unmounts_what_it_lost
    p = synthetic
    row = { xp: 25, path: %w[x1 x2 x4 x5], loadout: { "rubyfront" => [nil, "x5"], "nexus" => [] } }
    progress = p.progress_of("X-1", row)
    assert_equal 3, progress[:level]
    assert_equal %w[x1 x2 x4], progress[:path]
    assert_equal({ "rubyfront" => [], "nexus" => [] }, progress[:loadout])
    assert p.path_ok?("X-1", 3, progress[:path]).first
    assert p.loadout_ok?("X-1", progress[:path], progress[:loadout]).first
    kept = p.progress_of("X-1", { xp: 25, path: %w[x1 x3], loadout: { "rubyfront" => ["x1"], "nexus" => [nil, "x3"] } })
    assert_equal({ "rubyfront" => ["x1"], "nexus" => [nil, "x3"] }, kept[:loadout])
  end
end
