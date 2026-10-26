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

  # §3.1 — il mazzo porta i PV stampati sul Rubyfront: la copia parte da lì.
  # Gemello: state.test.ts, «loadDeck porta i PV del Rubyfront».
  def test_deck_carries_starting_hp
    action = deck_for("a", 3)
    @table.apply(action.merge("hp" => 21))
    assert_equal 21, @table.hp("a")
    assert_equal 20, @table.hp("b")
    @table.apply(deck_for("b", 3))
    assert_equal 20, @table.hp("b"), "senza hp la copia non tocca i PV"
  end

  # Regola sperimentale (2026-09-17): i PV non superano quelli stampati.
  # Gemello: state.test.ts, «i PV non superano quelli stampati sul Rubyfront».
  def test_hp_never_exceeds_printed
    @table.apply(deck_for("a", 3).merge("hp" => 21))
    @table.apply({ "t" => "player", "seat" => "a", "patch" => { "hp" => 25 } })
    assert_equal 21, @table.hp("a"), "la patch si ferma al tetto"
    @table.apply({ "t" => "player", "seat" => "a", "patch" => { "hp" => 18 } })
    assert_equal 18, @table.hp("a")
    @table.apply({ "t" => "player", "seat" => "b", "patch" => { "hp" => 30 } })
    assert_equal 30, @table.hp("b"), "senza mazzo caricato non c'è tetto"
  end

  # §3.3 — l'Ascesa del mazzo: i PV (già dentro `hp`) alzano anche il tetto,
  # la Furia resta sul posto; ogni carico la riscrive, e lo snapshot la porta.
  # Gemello: state.test.ts, «loadDeck porta l'Ascesa».
  def test_deck_carries_the_ascent
    @table.apply(deck_for("a", 3).merge("hp" => 24, "ascent" => { "hp" => 3, "fury" => 2 }))
    assert_equal 2, @table.fury_relief("a")
    assert_equal 0, @table.fury_relief("b")
    @table.apply({ "t" => "player", "seat" => "a", "patch" => { "hp" => 30 } })
    assert_equal 24, @table.hp("a")
    @table.apply(deck_for("a", 3).merge("hp" => 21))
    assert_equal 0, @table.fury_relief("a"), "il carico senza Ascesa la azzera"
    @table.load({ "players" => { "a" => { "hp" => 20, "ascent" => { "hp" => 0, "fury" => 1 } }, "b" => { "hp" => 20 } } })
    assert_equal 1, @table.fury_relief("a")
    assert_equal 0, @table.fury_relief("b")
  end

  # §4 — il mulligan, gemello di state.test.ts.
  def test_mulligan_puts_hand_back_draws_six_and_keeps_at_third
    @table.apply(deck_for("a", 10))
    assert_equal({ mulligans: 0, kept: false }, @table.opening("a"), "col mazzo comincia l'apertura")
    @table.apply({ "t" => "draw", "seat" => "a", "count" => 6 })
    order = (1..10).map { |n| "a-#{n}" }.reverse
    @table.apply({ "t" => "mulligan", "seat" => "a", "order" => order })
    assert_equal 6, @table.hand_count("a")
    assert_equal 4, @table.zone_count("a", "deck")
    assert_equal %w[a-10 a-9 a-8 a-7 a-6 a-5], @table.zone_uids("a", "hand")
    assert_equal({ mulligans: 1, kept: false }, @table.opening("a"))
    2.times { @table.apply({ "t" => "mulligan", "seat" => "a", "order" => order }) }
    assert_equal({ mulligans: 3, kept: true }, @table.opening("a"), "al terzo si tiene da sé")
  end

  def test_keep_and_opening_pending
    @table.apply(deck_for("a", 10))
    @table.apply(deck_for("b", 10))
    assert @table.opening_pending?
    @table.apply({ "t" => "keep", "seat" => "a" })
    assert @table.opening_pending?, "manca B"
    @table.apply({ "t" => "keep", "seat" => "b" })
    refute @table.opening_pending?
    @table.apply({ "t" => "newGame" })
    assert_nil @table.opening("a"), "Nuova partita azzera l'apertura"
  end

  def test_load_and_draw
    @table.apply(deck_for("a", 10))
    assert_equal 0, @table.hand_count("a")
    @table.apply({ "t" => "draw", "seat" => "a", "count" => 3 })
    assert_equal 3, @table.hand_count("a")
    assert_equal 7, @table.zone_count("a", "deck")
  end

  def test_reloading_deck_resets_only_that_seat
    @table.apply(deck_for("a", 5))
    @table.apply(deck_for("b", 5))
    @table.apply({ "t" => "draw", "seat" => "a", "count" => 2 })
    @table.apply(deck_for("a", 4))
    assert_equal 0, @table.hand_count("a"), "il mazzo ricaricato riparte da zero"
    assert_equal 4, @table.zone_count("a", "deck")
    assert_equal 5, @table.zone_count("b", "deck"), "l'altro posto non si tocca"
  end

  def test_to_zone_moves_between_zones
    @table.apply(deck_for("a", 3))
    @table.apply({ "t" => "draw", "seat" => "a", "count" => 2 })
    @table.apply({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
    assert_equal 1, @table.hand_count("a")
    assert_equal 1, @table.zone_count("a", "abisso")
    @table.apply({ "t" => "toZone", "uid" => "a-2", "zone" => "field" })
    assert_equal 0, @table.hand_count("a")
  end

  def test_drawing_from_empty_deck_does_nothing
    @table.apply(deck_for("a", 1))
    @table.apply({ "t" => "draw", "seat" => "a", "count" => 3 })
    assert_equal 1, @table.hand_count("a"), "si pesca solo ciò che c'è"
  end

  def test_turn_and_active_seat
    assert_equal "a", @table.active
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_equal "b", @table.active
    assert_equal 2, @table.turn
  end

  def test_snapshot_replaces_everything
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

  def test_new_game_resets
    @table.apply(deck_for("a", 5))
    @table.apply({ "t" => "turn", "turn" => 3, "active" => "b" })
    @table.apply({ "t" => "newGame" })
    assert_equal 0, @table.zone_count("a", "deck")
    assert_equal "a", @table.active
    assert_equal 1, @table.turn
  end

  # --- §6.4: la risoluzione applicata ------------------------------------

  def battlefield
    a = [1, 2].map { |n| { "uid" => "a-#{n}", "owner" => "a", "zone" => "field", "order" => 0 } }
    b = [{ "uid" => "b-1", "owner" => "b", "zone" => "field", "order" => 0 }]
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    @table.apply({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => b })
    @table.apply({ "t" => "declare", "declaration" => { "from" => "a-1", "to" => "rf", "kind" => "attack", "seat" => "a", "order" => 1 } })
    @table.apply({ "t" => "declare", "declaration" => { "from" => "b-1", "to" => "a-1", "kind" => "block", "seat" => "b", "order" => 0 } })
  end

  def test_resolve_sends_dead_to_abyss_and_clears_arrows
    battlefield
    @table.apply({ "t" => "resolve", "seat" => "a", "battles" => [
                   { "attacker" => "a-1", "blocker" => "b-1", "kind" => "block",
                     "attackerDies" => true, "blockerDies" => true, "damage" => 0 },
                 ] })
    assert_equal "abisso", @table.card("a-1")[:zone]
    assert_equal "abisso", @table.card("b-1")[:zone]
    assert_equal "field", @table.card("a-2")[:zone]
    refute @table.wave_declared?
    assert_empty @table.attackers_in_order
  end

  def test_wave_is_read_in_declaration_order
    battlefield
    @table.apply({ "t" => "declare", "declaration" => { "from" => "a-2", "to" => "rf", "kind" => "attack", "seat" => "a", "order" => 0 } })
    assert_equal %w[a-2 a-1], @table.attackers_in_order
    assert_equal ["b-1", "block"], @table.blocker_of("a-1")
    assert_nil @table.blocker_of("a-2")
  end

  def test_leaving_field_drops_out_of_wave
    battlefield
    @table.apply({ "t" => "toZone", "uid" => "b-1", "zone" => "hand" })
    assert_nil @table.blocker_of("a-1"), "il bloccante uscito lascia l'attacco non bloccato (§6.3)"
  end

  # --- il cambio di turno apparecchia chi entra ----------------------------

  def test_turn_change_untaps_incoming_and_clears_arrows
    battlefield
    @table.apply({ "t" => "tap", "uid" => "b-1", "tapped" => true })
    @table.apply({ "t" => "tap", "uid" => "a-1", "tapped" => true })
    @table.apply({ "t" => "phase", "phase" => "fronte" })
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    refute @table.card("b-1")[:tapped], "chi entra si stappa (§6.3)"
    assert @table.card("a-1")[:tapped], "chi esce resta com'era"
    refute @table.wave_declared?
    assert_equal "preparazione", @table.phase
  end

  def test_turn_change_draws_turn_card
    @table.apply(deck_for("b", 2))
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_equal 1, @table.hand_count("b"), "la Pesca non si salta mai (§6.1)"
    assert_equal 1, @table.zone_count("b", "deck")
    @table.apply({ "t" => "turn", "turn" => 3, "active" => "a" })
    assert_equal 0, @table.hand_count("a"), "a mazzo vuoto non si pesca"
  end

  def test_counter_patch_sets_nothing_up
    battlefield
    @table.apply({ "t" => "tap", "uid" => "a-1", "tapped" => true })
    @table.apply({ "t" => "turn", "turn" => 7, "active" => "a" })
    assert @table.card("a-1")[:tapped]
    assert @table.wave_declared?
    # §6.5 (dal 2026-10-21): il contatore avanza solo col cambio di posto. Gemello: state.test.ts.
    assert_equal 1, @table.turn
  end

  # --- il Flusso (§3.2), come lo conta il client -----------------------------

  def test_flux_starts_at_1_and_grows_from_second_turn
    assert_equal 1, @table.flux("a")
    assert_equal 1, @table.flux_max("b")
    @table.apply({ "t" => "player", "seat" => "b", "patch" => { "flux" => 0 } })
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_equal 1, @table.flux_max("b"), "al primo turno di chi entra resta 1 (§3.2)"
    assert_equal 1, @table.flux("b"), "ma si ricarica"
    @table.apply({ "t" => "turn", "turn" => 3, "active" => "a" })
    assert_equal 2, @table.flux("a")
    @table.apply({ "t" => "turn", "turn" => 4, "active" => "b" })
    assert_equal 2, @table.flux("b")
    # La tassa di Flusso (§3.2) viaggia nell'azione: si ricarica al massimo meno la tassa. Gemello: state.test.ts.
    @table.apply({ "t" => "turn", "turn" => 5, "active" => "a", "toll" => 2 })
    assert_equal 3, @table.flux_max("a")
    assert_equal 1, @table.flux("a")
    @table.apply({ "t" => "turn", "turn" => 6, "active" => "b", "toll" => 9 })
    assert_equal 0, @table.flux("b"), "mai sotto zero"
  end

  def test_new_game_says_who_starts
    @table.apply({ "t" => "turn", "turn" => 5, "active" => "a" })
    @table.apply({ "t" => "newGame", "active" => "b" })
    assert_equal "b", @table.active
    assert_equal 1, @table.turn
  end

  def test_max_flux_does_not_exceed_20
    @table.apply({ "t" => "player", "seat" => "b", "patch" => { "fluxMax" => 20, "flux" => 3 } })
    @table.apply({ "t" => "turn", "turn" => 4, "active" => "b" })
    assert_equal 20, @table.flux_max("b")
    assert_equal 20, @table.flux("b")
  end

  def test_counter_patch_and_snapshot_align_flux
    @table.apply({ "t" => "player", "seat" => "a", "patch" => { "flux" => 5 } })
    assert_equal 5, @table.flux("a")
    @table.load({ "active" => "a", "turn" => 4, "players" => { "a" => { "flux" => 7, "fluxMax" => 9 }, "b" => { "flux" => 2 } } })
    assert_equal 7, @table.flux("a")
    assert_equal 9, @table.flux_max("a")
    assert_equal 2, @table.flux("b")
  end

  def test_playing_from_hand_deducts_cost
    @table.apply(deck_for("a", 2))
    @table.apply({ "t" => "draw", "seat" => "a", "count" => 2 })
    @table.apply({ "t" => "player", "seat" => "a", "patch" => { "flux" => 3 } })
    @table.apply({ "t" => "toZone", "uid" => "a-1", "zone" => "field", "cost" => 2 })
    assert_equal 1, @table.flux("a")
    @table.apply({ "t" => "toZone", "uid" => "a-2", "zone" => "field", "cost" => 5 })
    assert_equal 0, @table.flux("a"), "mai sotto zero"
    @table.apply({ "t" => "toZone", "uid" => "a-1", "zone" => "hand" })
    @table.apply({ "t" => "toZone", "uid" => "a-1", "zone" => "field" })
    assert_equal 0, @table.flux("a"), "senza costo nell'azione non si paga"
  end

  # §6.2 — l'Oggetto che si mette in Ritiro «pagandone il costo» (dal
  # 2026-09-15): dal campo alla Zona di Ritiro col costo nell'azione si paga;
  # il Ritiro senza costo no. Gemello: state.test.ts.
  # §6.2 — la sostituzione a Fronte pieno (dal 2026-09-15): `replace` manda in
  # Zona di Ritiro l'Entità indicata coi suoi Oggetti, poi l'altra scende.
  # Gemello: state.test.ts, «toZone con replace».
  def test_replace_sends_the_replaced_entity_and_its_objects_to_retire
    a = [
      { "uid" => "e", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "X", "x" => 442, "y" => 1260 },
      { "uid" => "o", "owner" => "a", "zone" => "field", "order" => 1, "cardId" => "Y", "x" => 472, "y" => 1266, "assignedTo" => "e" },
      { "uid" => "r", "owner" => "a", "zone" => "ritiro", "order" => 0, "cardId" => "X" },
    ]
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    @table.apply({ "t" => "toZone", "uid" => "r", "zone" => "field", "x" => 442, "y" => 1260, "replace" => "e" })
    assert_equal "field", @table.card("r")[:zone]
    assert_equal "ritiro", @table.card("e")[:zone]
    assert_equal "ritiro", @table.card("o")[:zone], "l'Oggetto segue la sostituita"
    assert_nil @table.card("o")[:assigned_to]
  end

  def test_retiring_from_field_with_cost_pays
    @table.apply(deck_for("a", 2))
    @table.apply({ "t" => "draw", "seat" => "a", "count" => 2 })
    @table.apply({ "t" => "player", "seat" => "a", "patch" => { "flux" => 3 } })
    @table.apply({ "t" => "toZone", "uid" => "a-1", "zone" => "field" })
    @table.apply({ "t" => "toZone", "uid" => "a-2", "zone" => "field" })
    @table.apply({ "t" => "toZone", "uid" => "a-1", "zone" => "ritiro", "cost" => 1 })
    assert_equal 2, @table.flux("a"), "in Ritiro col costo si paga"
    assert_equal "ritiro", @table.card("a-1")[:zone]
    @table.apply({ "t" => "toZone", "uid" => "a-2", "zone" => "ritiro" })
    assert_equal 2, @table.flux("a"), "il Ritiro senza costo non paga"
  end

  # --- faccia e fila (§3.1, §7) ---------------------------------------------

  def test_copy_follows_face_and_row
    cards = [{ "uid" => "rf", "owner" => "a", "zone" => "field", "order" => 0, "face" => 0, "y" => 1756 }]
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    assert_equal 0, @table.card("rf")[:face]
    assert_equal 1756, @table.card("rf")[:row], "in Zona di Richiamo, fila di servizio"
    @table.apply({ "t" => "move", "uid" => "rf", "x" => 30, "y" => 1260, "z" => 2 })
    assert_equal 1260, @table.card("rf")[:row], "schierato, fila del Fronte"
    @table.apply({ "t" => "flip", "uid" => "rf", "face" => 1 })
    assert_equal 1, @table.card("rf")[:face], "il Nexus"
    @table.apply({ "t" => "toZone", "uid" => "rf", "zone" => "hand" })
    assert_nil @table.card("rf")[:row], "fuori dal campo la fila non dice niente"
  end

  def test_snapshot_carries_face_and_row
    @table.load({ "cards" => { "rf" => { "owner" => "b", "zone" => "field", "face" => 1, "y" => 172, "cardId" => "X" } } })
    assert_equal 1, @table.card("rf")[:face]
    assert_equal 172, @table.card("rf")[:row]
  end

  # --- i PV e la fine (§2, §9) ----------------------------------------------

  def test_hp_drop_with_resolution_and_patches
    assert_equal 20, @table.hp("b")
    @table.apply({ "t" => "resolve", "seat" => "a", "battles" => [
                   { "attacker" => "x", "kind" => "unblocked", "attackerDies" => false, "blockerDies" => false, "damage" => 4 },
                   { "attacker" => "y", "kind" => "unblocked", "attackerDies" => false, "blockerDies" => false, "damage" => 3 },
                 ] })
    assert_equal 13, @table.hp("b")
    assert_equal 20, @table.hp("a")
    @table.apply({ "t" => "player", "seat" => "b", "patch" => { "hp" => 2 } })
    @table.apply({ "t" => "resolve", "seat" => "a", "battles" => [
                   { "attacker" => "x", "kind" => "unblocked", "attackerDies" => false, "blockerDies" => false, "damage" => 9 },
                 ] })
    assert_equal 0, @table.hp("b"), "mai sotto zero"
  end

  def test_end_is_recorded_and_new_game_clears_it
    refute @table.over?
    @table.apply({ "t" => "gameOver", "winner" => "a", "reason" => "hp" })
    assert @table.over?
    assert_equal({ winner: "a", reason: "hp" }, @table.over)
    @table.apply({ "t" => "newGame", "active" => "b" })
    refute @table.over?
    @table.load({ "players" => { "a" => { "hp" => 0 } }, "over" => { "winner" => "b", "reason" => "hp" } })
    assert @table.over?
    assert_equal 0, @table.hp("a")
  end

  # --- il Gettone e il pagamento (§3.2) --------------------------------------

  def test_token_goes_to_second_player_and_pays_when_bar_short
    refute @table.token?("a")
    assert @table.token?("b")
    assert_equal 2, @table.available("b")
    @table.apply({ "t" => "newGame", "active" => "b" })
    assert @table.token?("a")
    refute @table.token?("b")
    @table.apply(deck_for("a", 1))
    @table.apply({ "t" => "draw", "seat" => "a", "count" => 1 })
    @table.apply({ "t" => "toZone", "uid" => "a-1", "zone" => "field", "cost" => 2 })
    assert_equal 0, @table.flux("a"), "1 dalla barra e 1 dal Gettone"
    refute @table.token?("a"), "il Gettone è speso"
  end

  def test_deployment_is_paid_with_move
    @table.apply({ "t" => "player", "seat" => "a", "patch" => { "flux" => 5 } })
    cards = [{ "uid" => "rf", "owner" => "a", "zone" => "field", "order" => 0, "y" => 1756 }]
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    @table.apply({ "t" => "move", "uid" => "rf", "x" => 30, "y" => 1260, "z" => 2, "cost" => 4, "roll" => 4 })
    assert_equal 1, @table.flux("a")
    assert_equal 1260, @table.card("rf")[:row]
  end

  # --- la scoperta a T+3 e gli Oggetti che seguono (§6.3, §6.2, §5) ---------

  def test_covering_records_turn_and_turn_change_uncovers_at_t3
    cards = [{ "uid" => "a-1", "owner" => "a", "zone" => "field", "order" => 0 }]
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    @table.apply({ "t" => "facedown", "uid" => "a-1", "facedown" => true })
    assert_equal 2, @table.card("a-1")[:covered_turn]
    @table.apply({ "t" => "turn", "turn" => 3, "active" => "a" })
    assert @table.card("a-1")[:facedown], "T+1: ancora coperta"
    @table.apply({ "t" => "turn", "turn" => 4, "active" => "b" })
    @table.apply({ "t" => "turn", "turn" => 5, "active" => "a" })
    refute @table.card("a-1")[:facedown], "T+3: scoperta"
    assert_nil @table.card("a-1")[:covered_turn]
  end

  def test_covered_without_date_stays_covered
    @table.load({ "active" => "b", "turn" => 2, "cards" => { "a-1" => { "owner" => "a", "zone" => "field", "facedown" => true } } })
    @table.apply({ "t" => "turn", "turn" => 3, "active" => "a" })
    @table.apply({ "t" => "turn", "turn" => 4, "active" => "b" })
    @table.apply({ "t" => "turn", "turn" => 5, "active" => "a" })
    assert @table.card("a-1")[:facedown]
  end

  def test_items_follow_entity_to_retire_and_abyss_not_hand
    cards = %w[a-1 a-2 a-3].map { |uid| { "uid" => uid, "owner" => "a", "zone" => "field", "order" => 0 } }
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    @table.apply({ "t" => "assign", "uid" => "a-2", "to" => "a-1" })
    @table.apply({ "t" => "assign", "uid" => "a-3", "to" => "a-1" })
    @table.apply({ "t" => "toZone", "uid" => "a-1", "zone" => "ritiro" })
    assert_equal "ritiro", @table.card("a-2")[:zone]
    assert_equal "ritiro", @table.card("a-3")[:zone]
    assert_nil @table.card("a-2")[:assigned_to]
    assert_equal 3, @table.zone_count("a", "ritiro")

    # L'Entità muore e va nell'Abisso: i suoi Oggetti no, vanno in Zona di
    # Ritiro (§3.1, dal 2026-09-13). Gemello: state.test.ts.
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    @table.apply({ "t" => "assign", "uid" => "a-2", "to" => "a-1" })
    @table.apply({ "t" => "assign", "uid" => "a-3", "to" => "a-1" })
    @table.apply({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
    assert_equal "abisso", @table.card("a-1")[:zone]
    assert_equal %w[ritiro ritiro], [@table.card("a-2")[:zone], @table.card("a-3")[:zone]], "gli Oggetti non vanno nell'Abisso"
    assert_nil @table.card("a-2")[:assigned_to]
    assert_equal 1, @table.zone_count("a", "abisso")

    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    @table.apply({ "t" => "assign", "uid" => "a-2", "to" => "a-1" })
    @table.apply({ "t" => "toZone", "uid" => "a-1", "zone" => "hand" })
    assert_equal "field", @table.card("a-2")[:zone], "in mano no"
    assert_nil @table.card("a-2")[:assigned_to]
  end

  # --- gli inneschi consumati (§8.2) -----------------------------------------

  def test_trigger_consumed_once_and_turn_resets_it
    refute @table.fired?("g", "on_enter_field", "e")
    @table.fire("g", "on_enter_field", "e")
    assert @table.fired?("g", "on_enter_field", "e")
    refute @table.fired?("g", "on_enter_field", "altro")
    refute @table.fired?("g", "on_attack", "e"), "un altro evento è un altro innesco"
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    refute @table.fired?("g", "on_enter_field", "e")
  end

  # --- lo sguardo nel mazzo (§8.2) ---------------------------------------------

  def test_look_shows_card_and_puts_rest_at_bottom
    @table.apply(deck_for("a", 6))
    assert_equal %w[a-1 a-2 a-3 a-4], @table.top_of_deck("a", 4)
    @table.apply({ "t" => "look", "seat" => "a", "count" => 4, "reveal" => "a-2",
                   "effect" => { "source" => "x", "event" => "on_enter_field", "entering" => "x" } })
    assert_equal 1, @table.hand_count("a")
    assert_equal "hand", @table.card("a-2")[:zone]
    assert_equal %w[a-5 a-6 a-1 a-3 a-4], @table.top_of_deck("a", 5), "le altre in fondo, nell'ordine in cui stavano"
  end

  def test_look_without_reveal_puts_all_at_bottom
    @table.apply(deck_for("a", 5))
    @table.apply({ "t" => "look", "seat" => "a", "count" => 2, "effect" => { "source" => "x", "event" => "on_enter_field", "entering" => "x" } })
    assert_equal 0, @table.hand_count("a")
    assert_equal %w[a-3 a-4 a-5 a-1 a-2], @table.top_of_deck("a", 5)
  end

  # --- il controllo e la restituzione (§8.2) ----------------------------------

  def test_control_changes_commander_not_owner
    cards = [{ "uid" => "b-1", "owner" => "b", "zone" => "field", "order" => 0, "y" => 172 }]
    @table.apply({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => cards })
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    @table.apply({ "t" => "turn", "turn" => 3, "active" => "a" })
    @table.apply({ "t" => "control", "uid" => "b-1", "by" => "a", "grants" => ["surge"], "effect" => {} })
    assert_equal "a", @table.controller_of(@table.card("b-1"))
    assert_equal "b", @table.card("b-1")[:owner]
    assert_equal ["surge"], @table.card("b-1")[:grants]
    assert_equal 1, @table.card("b-1")[:entered], "il controllo non è un ingresso: entered resta (§8.2)"
    @table.apply({ "t" => "release", "uid" => "b-1", "zone" => "field", "x" => 442, "y" => 172 })
    assert_equal "b", @table.controller_of(@table.card("b-1"))
    assert_nil @table.card("b-1")[:grants]
    assert_equal 172, @table.card("b-1")[:row]
    @table.apply({ "t" => "control", "uid" => "b-1", "by" => "a", "grants" => [], "effect" => {} })
    @table.apply({ "t" => "release", "uid" => "b-1", "zone" => "ritiro" })
    assert_equal "ritiro", @table.card("b-1")[:zone], "a Fronte pieno, in Zona di Ritiro"
  end

  def test_look_sends_card_to_retire
    @table.apply(deck_for("a", 5))
    @table.apply({ "t" => "look", "seat" => "a", "count" => 4, "reveal" => "a-2", "retire" => "a-3",
                   "effect" => { "source" => "x", "event" => "on_enter_field", "entering" => "x" } })
    assert_equal "hand", @table.card("a-2")[:zone]
    assert_equal "ritiro", @table.card("a-3")[:zone]
    assert_equal %w[a-5 a-1 a-4], @table.top_of_deck("a", 3)
  end
end

# Gli attrezzi degli effetti d'attacco (§8.2). Gemelli: state.test.ts,
# «attrezzi degli effetti d'attacco».
class TableAttackToolsTest < Minitest::Test
  def setup
    @table = Rubyfront::Table.new
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "t", "cards" => [
                   { "uid" => "a1", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "X", "tapped" => true },
                   { "uid" => "a2", "owner" => "a", "zone" => "field", "order" => 1, "cardId" => "X", "tapped" => true },
                   { "uid" => "obj", "owner" => "a", "zone" => "ritiro", "order" => 0, "cardId" => "O" }] })
    @table.apply({ "t" => "loadDeck", "seat" => "b", "deckId" => "t", "cards" => [
                   { "uid" => "e", "owner" => "b", "zone" => "field", "order" => 0, "cardId" => "X", "tapped" => true }] })
  end

  def test_empower_adds_grants_forbids_and_turn_clears
    @table.apply({ "t" => "empower", "uid" => "e", "power" => 1 })
    @table.apply({ "t" => "empower", "uid" => "e", "power" => 1, "grants" => ["revenge"], "restrict" => "block" })
    assert_equal 2, @table.card("e")[:power_bonus]
    assert_equal ["revenge"], @table.card("e")[:grants]
    assert @table.card("e")[:cannot_block]
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_nil @table.card("e")[:power_bonus]
    assert_nil @table.card("e")[:cannot_block]
    assert_nil @table.card("e")[:grants]
  end

  def test_refresh_untaps_commander_only_with_roll
    @table.apply({ "t" => "refresh", "seat" => "a", "roll" => 3, "untap" => false })
    assert @table.card("a1")[:tapped], "col tiro mancato nessuno si stappa"
    @table.apply({ "t" => "refresh", "seat" => "a", "roll" => 17, "untap" => true })
    refute @table.card("a1")[:tapped]
    assert @table.card("e")[:tapped]
  end

  def test_resolve_untaps_requested_and_remembers_wave
    @table.apply({ "t" => "declare", "declaration" => { "from" => "a2", "to" => "rf", "kind" => "attack", "order" => 2 } })
    @table.apply({ "t" => "declare", "declaration" => { "from" => "a1", "to" => "rf", "kind" => "attack", "order" => 1 } })
    @table.apply({ "t" => "resolve", "seat" => "a", "battles" => [], "untap" => ["a1"] })
    refute @table.card("a1")[:tapped]
    assert @table.card("a2")[:tapped]
    assert_equal %w[a1 a2], @table.last_wave("a")
  end

  def test_to_zone_with_assign_to_reattaches_assigned_item
    @table.apply({ "t" => "toZone", "uid" => "obj", "zone" => "field", "y" => 1260, "assignTo" => "a1" })
    assert_equal "a1", @table.card("obj")[:assigned_to]
  end
  # --- gli attrezzi degli effetti: Stasi, Contrattacco concesso, esilio, flip, sigillo ---

  def field_setup(seat, uid, extra = {})
    { "uid" => uid, "owner" => seat, "zone" => "field", "order" => 0, "cardId" => "X" }.merge(extra)
  end

  def test_empower_untaps_even_from_stasis_and_grants_counter
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => [field_setup("a", "a1", "tapped" => true)] })
    @table.card("a1")[:stasis] = true
    ref = { "source" => "m", "event" => "on_resolve", "entering" => "m" }
    @table.apply({ "t" => "empower", "uid" => "a1", "counter" => 1, "untap" => true, "effect" => ref })
    card = @table.card("a1")
    refute card[:tapped]
    assert_nil card[:stasis]
    assert_equal 1, card[:counter_bonus]
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_nil card[:counter_bonus], "«fino alla fine del turno»"
  end

  def test_stasis_at_resolution_and_turn_does_not_untap
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => [field_setup("a", "a1"), field_setup("a", "a2")] })
    @table.apply({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => [field_setup("b", "b1", "facedown" => true), field_setup("b", "m1")] })
    @table.apply({ "t" => "declare", "declaration" => { "from" => "a1", "to" => "rf-b", "kind" => "attack", "order" => 1 } })
    @table.apply({ "t" => "declare", "declaration" => { "from" => "a2", "to" => "rf-b", "kind" => "attack", "order" => 2 } })
    @table.apply({ "t" => "declare", "declaration" => { "from" => "b1", "to" => "a1", "kind" => "counter", "order" => 0 } })
    @table.apply({ "t" => "declare", "declaration" => { "from" => "m1", "to" => "a2", "kind" => "block", "order" => 0 } })
    @table.apply({ "t" => "resolve", "seat" => "a", "battles" => [
      { "attacker" => "a1", "blocker" => "b1", "kind" => "counter", "attackerDies" => false, "blockerDies" => false, "blockerStasis" => true, "damage" => 0 },
      { "attacker" => "a2", "blocker" => "m1", "kind" => "block", "attackerDies" => false, "blockerDies" => false, "blockerSpent" => true, "damage" => 0 },
    ] })
    b1 = @table.card("b1")
    assert_equal "field", b1[:zone], "la Stasi salva"
    assert b1[:stasis]
    assert b1[:tapped]
    refute b1[:facedown], "la stasi sostituisce la copertura"
    assert_equal "abisso", @table.card("m1")[:zone], "la Reattiva come blocco si consuma"
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert @table.card("b1")[:tapped], "tappata per sempre (§8.1)"
    @table.apply({ "t" => "refresh", "seat" => "b", "roll" => 17, "untap" => true, "effect" => {} })
    refute @table.card("b1")[:tapped], "stappata da un effetto torna normale"
    assert_nil @table.card("b1")[:stasis]
  end

  def test_with_several_blockers_attacker_dies_once
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => [field_setup("a", "a1")] })
    @table.apply({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => [field_setup("b", "b1"), field_setup("b", "b2")] })
    @table.apply({ "t" => "declare", "declaration" => { "from" => "a1", "to" => "rf-b", "kind" => "attack", "order" => 1 } })
    @table.apply({ "t" => "declare", "declaration" => { "from" => "b1", "to" => "a1", "kind" => "block", "order" => 0 } })
    @table.apply({ "t" => "declare", "declaration" => { "from" => "b2", "to" => "a1", "kind" => "block", "order" => 0 } })
    assert_equal [["b1", "block"], ["b2", "block"]], @table.blockers_of("a1")
    @table.apply({ "t" => "resolve", "seat" => "a", "battles" => [
      { "attacker" => "a1", "blocker" => "b1", "kind" => "block", "attackerDies" => true, "blockerDies" => true, "damage" => 0 },
      { "attacker" => "a1", "blocker" => "b2", "kind" => "block", "attackerDies" => true, "blockerDies" => false, "damage" => 0 },
    ] })
    assert_equal "abisso", @table.card("a1")[:zone]
    assert_equal 1, @table.zone_count("a", "abisso")
    assert_equal "abisso", @table.card("b1")[:zone]
    assert_equal "field", @table.card("b2")[:zone]
  end

  def test_exile_holds_card_and_release_brings_it_back
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => [field_setup("a", "m")] })
    @table.apply({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => [field_setup("b", "b1", "y" => 172)] })
    @table.apply({ "t" => "toZone", "uid" => "b1", "zone" => "abisso", "heldBy" => "m" })
    assert_equal "m", @table.card("b1")[:held_by]
    assert_equal "abisso", @table.card("b1")[:zone]
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    @table.apply({ "t" => "release", "uid" => "b1", "zone" => "field", "x" => 442, "y" => 172 })
    b1 = @table.card("b1")
    assert_equal "field", b1[:zone]
    assert_equal 2, b1[:entered], "torna in gioco: entra ora"
    assert_equal 172, b1[:row]
    assert_nil b1[:held_by]
    # E chi torna a Fronte pieno va in Zona di Ritiro.
    @table.apply({ "t" => "toZone", "uid" => "b1", "zone" => "abisso", "heldBy" => "m" })
    @table.apply({ "t" => "release", "uid" => "b1", "zone" => "ritiro" })
    assert_equal "ritiro", @table.card("b1")[:zone]
    # Uno spostamento qualunque scioglie la presa.
    @table.apply({ "t" => "toZone", "uid" => "b1", "zone" => "abisso", "heldBy" => "m" })
    @table.apply({ "t" => "toZone", "uid" => "b1", "zone" => "hand" })
    assert_nil @table.card("b1")[:held_by]
  end

  def test_flip_discards_recovers_and_records_turn
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => [field_setup("a", "rf", "y" => 1260), field_setup("a", "h", "zone" => "hand")] })
    @table.apply({ "t" => "player", "seat" => "a", "patch" => { "hp" => 12 } })
    @table.apply({ "t" => "flip", "uid" => "rf", "face" => 1, "discard" => "h", "recover" => 5 })
    rf = @table.card("rf")
    assert_equal 1, rf[:face]
    assert_equal 1, rf[:flipped]
    assert_equal 17, @table.hp("a")
    assert_equal "ritiro", @table.card("h")[:zone], "lo scarto del flip va in Zona di Ritiro (§5, §6.5)"
  end

  def test_seal_and_declared_target_travel_in_snapshot
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => [field_setup("a", "m", "zone" => "hand")] })
    @table.apply({ "t" => "player", "seat" => "a", "patch" => { "sealed" => ["CARTA-1"] } })
    assert @table.sealed?("a", "CARTA-1")
    refute @table.sealed?("b", "CARTA-1")
    @table.apply({ "t" => "toZone", "uid" => "m", "zone" => "field", "target" => "x1" })
    assert_equal "x1", @table.card("m")[:target]
    @table.apply({ "t" => "toZone", "uid" => "m", "zone" => "abisso" })
    assert_nil @table.card("m")[:target]
    @table.load({
      "turn" => 4, "active" => "a",
      "players" => { "a" => { "sealed" => ["CARTA-1"] } },
      "cards" => {
        "a1" => { "owner" => "a", "zone" => "field", "order" => 0, "stasis" => true, "tapped" => true, "target" => "b1" },
        "b1" => { "owner" => "b", "zone" => "abisso", "order" => 0, "heldBy" => "a1" },
      },
    })
    assert @table.sealed?("a", "CARTA-1")
    assert @table.card("a1")[:stasis]
    assert_equal "b1", @table.card("a1")[:target]
    assert_equal "a1", @table.card("b1")[:held_by]
    @table.apply({ "t" => "turn", "turn" => 5, "active" => "b" })
    @table.apply({ "t" => "turn", "turn" => 6, "active" => "a" })
    assert @table.card("a1")[:tapped], "dallo snapshot la Stasi resta una tappata static carde"
  end

end

# §7.2 — la catena di risposta. Gemello: state.test.ts, «la catena di risposta».
class TableChainTest < Minitest::Test
  def setup
    @table = Rubyfront::Table.new
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "t", "cards" => [{ "uid" => "r1", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "R" }] })
    @table.apply({ "t" => "loadDeck", "seat" => "b", "deckId" => "t", "cards" => [{ "uid" => "r2", "owner" => "b", "zone" => "hand", "order" => 0, "cardId" => "R" }] })
  end

  def play(uid, chain: true)
    @table.apply({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => 10, "y" => 10, "z" => 2 }.merge(chain ? { "chain" => true } : {}))
  end

  def test_reactive_opens_response_extends_and_accept_resolves_reversed
    play("r1")
    assert_equal({ stack: ["r1"], turn: "b", resolving: false }, @table.chain)
    play("r2")
    assert_equal({ stack: %w[r1 r2], turn: "a", resolving: false }, @table.chain)
    @table.apply({ "t" => "pass", "seat" => "a" })
    assert_equal({ stack: %w[r1 r2], turn: "a", resolving: true }, @table.chain)
    assert_equal "r2", @table.chain_top
    @table.apply({ "t" => "settle", "uid" => "r2" })
    assert_equal ["r1"], @table.chain[:stack], "risolta, esce dalla pila anche restando in campo"
    assert_equal "r1", @table.chain_top
    @table.apply({ "t" => "toZone", "uid" => "r1", "zone" => "abisso" })
    assert_nil @table.chain
    assert_nil @table.chain_top
  end

  def test_without_mark_no_opening_turn_closes_and_accept_without_chain_does_nothing
    play("r1", chain: false)
    assert_nil @table.chain
    @table.apply({ "t" => "pass", "seat" => "b" })
    assert_nil @table.chain
    @table.apply({ "t" => "toZone", "uid" => "r1", "zone" => "hand" })
    play("r1")
    assert_equal ["r1"], @table.chain[:stack]
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_nil @table.chain
  end

  def test_lo_snapshot_porta_la_catena
    @table.load({ "active" => "a", "turn" => 3, "phase" => "fronte", "cards" => [], "players" => {},
                  "chain" => { "stack" => %w[r1 r2], "turn" => "a", "resolving" => true } })
    assert_equal({ stack: %w[r1 r2], turn: "a", resolving: true }, @table.chain)
    @table.load({ "active" => "a", "turn" => 3, "cards" => [], "players" => {}, "chain" => { "stack" => [], "turn" => "a" } })
    assert_nil @table.chain, "pila vuota: nessuna catena"
  end
end

# §8.2 — i bonus «fino alla fine del turno» sulla carta che lascia il campo.
# Gemello: state.test.ts, «il bonus fino a fine turno».
class TableBonusTest < Minitest::Test
  def setup
    @table = Rubyfront::Table.new
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "t", "cards" => [
                   { "uid" => "u", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "U", "y" => 1260 }] })
    @table.apply({ "t" => "empower", "uid" => "u", "power" => 1, "counter" => 2, "grants" => ["revenge"], "restrict" => "block" })
  end

  def test_turn_change_clears_bonuses
    assert_equal 1, @table.card("u")[:power_bonus]
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_nil @table.card("u")[:power_bonus]
    assert_nil @table.card("u")[:counter_bonus]
    assert_nil @table.card("u")[:cannot_block]
    assert_nil @table.card("u")[:grants]
  end

  def test_leaving_field_drops_bonuses
    @table.apply({ "t" => "toZone", "uid" => "u", "zone" => "abisso" })
    assert_nil @table.card("u")[:power_bonus], "il ritorno in campo è sempre quello stampato (§3.1, §8.2)"
    assert_nil @table.card("u")[:counter_bonus]
    assert_nil @table.card("u")[:cannot_block]
    assert_nil @table.card("u")[:grants]
  end

  # --- le abilità speciali del Rubyfront (§3.1) e gli sconti ------------------

  def test_ability_pays_hp_empowers_targets_and_leaves_discount
    cards = [{ "uid" => "rf", "owner" => "a", "zone" => "field", "order" => 0, "y" => 1260 },
             { "uid" => "u", "owner" => "a", "zone" => "field", "order" => 1, "y" => 1260 },
             { "uid" => "o", "owner" => "a", "zone" => "hand", "order" => 2 }]
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    @table.apply({ "t" => "player", "seat" => "a", "patch" => { "hp" => 20, "flux" => 5 } })
    @table.apply({ "t" => "ability", "uid" => "rf", "ability" => "carica", "cost" => 5, "roll" => 3, "fail" => true, "targets" => ["u"], "power" => 1 })
    assert_equal 14, @table.hp("a"), "5 di costo e 1 di Furia fallita"
    assert @table.ability_used?("a"), "una sola per turno: la copia lo annota"
    assert_equal 1, @table.card("u")[:power_bonus]
    @table.apply({ "t" => "ability", "uid" => "rf", "ability" => "sguardo", "gain" => 3 })
    assert_equal 17, @table.hp("a")
    assert @table.pending_ability?("rf", "sguardo"), "lo sguardo aspetta"
    @table.apply({ "t" => "look", "seat" => "a", "count" => 3, "effect" => { "source" => "rf", "event" => "on_ability", "entering" => "rf", "ability" => "sguardo" } })
    refute @table.pending_ability?("rf", "sguardo")
    @table.apply({ "t" => "ability", "uid" => "rf", "ability" => "sconto", "cost" => 3, "discount" => { "amount" => 1, "type" => "object", "race" => nil } })
    assert_equal [{ amount: 1, type: "object", race: nil }], @table.discounts("a")
    @table.apply({ "t" => "toZone", "uid" => "o", "zone" => "field", "x" => 632, "y" => 1260, "cost" => 1, "discount" => 1, "assignTo" => "u" })
    assert_equal 4, @table.flux("a")
    assert_empty @table.discounts("a"), "consumato giocando"
    @table.apply({ "t" => "ability", "uid" => "rf", "ability" => "sconto", "cost" => 3, "discount" => { "amount" => 1, "type" => "object", "race" => nil } })
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_empty @table.discounts("a"), "cadono col turno"
    refute @table.ability_used?("a"), "e l'uso è del turno passato"
    assert_nil @table.card("u")[:power_bonus]
  end

  # «…e ottengono Slancio fino alla fine del turno» (dal 2026-10-20). Gemello: state.test.ts, «il potenziamento con le parole chiave».
  def test_ability_with_grants_gives_keywords_until_end_of_turn
    cards = [{ "uid" => "rf", "owner" => "a", "zone" => "field", "order" => 0, "y" => 1260 },
             { "uid" => "u", "owner" => "a", "zone" => "field", "order" => 1, "y" => 1260 }]
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    @table.apply({ "t" => "ability", "uid" => "rf", "ability" => "incendio", "cost" => 6, "targets" => ["u"], "power" => 1, "grants" => ["surge"] })
    assert_equal 14, @table.hp("a")
    assert_equal 1, @table.card("u")[:power_bonus]
    assert_equal ["surge"], @table.card("u")[:grants]
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_nil @table.card("u")[:grants]
  end

  # «Puoi pagare N PV. Se lo fai, quell'Entità prende +M» (§3.1, dal 2026-10-20): i PV li paga chi comanda la fonte. Gemello: state.test.ts, «empower con pay».
  def test_empower_with_pay_takes_hp_from_whoever_commands_the_source
    cards = [{ "uid" => "rf", "owner" => "a", "zone" => "field", "order" => 0, "y" => 1260 },
             { "uid" => "u", "owner" => "a", "zone" => "field", "order" => 1, "y" => 1260 }]
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    @table.apply({ "t" => "empower", "uid" => "u", "power" => 1, "pay" => 1, "effect" => { "source" => "rf", "event" => "on_attack", "entering" => "u", "once" => true } })
    assert_equal 1, @table.card("u")[:power_bonus]
    assert_equal 19, @table.hp("a")
    @table.apply({ "t" => "player", "seat" => "a", "patch" => { "hp" => 0 } })
    @table.apply({ "t" => "empower", "uid" => "u", "power" => 1, "pay" => 1, "effect" => { "source" => "rf", "event" => "on_attack", "entering" => "u" } })
    assert_equal 0, @table.hp("a"), "mai sotto zero"
  end

  # §3.1 — la chiamata sul Fronte del Nexus: la promessa alle prossime
  # attaccanti sul posto, l'Entità dalla mano con le parole chiave concesse
  # (e l'attivazione che si chiude con la discesa), il bonus che viaggia
  # nella dichiarazione d'attacco. Gemello: state.test.ts.
  def test_front_summon_promises_descent_with_surge_and_attack_bonus
    cards = [{ "uid" => "rf", "owner" => "a", "zone" => "field", "order" => 0, "y" => 1260, "face" => 1 },
             { "uid" => "h", "owner" => "a", "zone" => "hand", "order" => 1 },
             { "uid" => "k", "owner" => "a", "zone" => "hand", "order" => 2 }]
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    @table.apply({ "t" => "player", "seat" => "a", "patch" => { "hp" => 21, "flux" => 3 } })
    @table.apply({ "t" => "ability", "uid" => "rf", "ability" => "chiamata", "cost" => 7, "bonus" => { "amount" => 1, "race" => "human" } })
    assert_equal 14, @table.hp("a")
    assert_equal [{ amount: 1, race: "human" }], @table.attack_bonuses("a")
    assert @table.pending_ability?("rf", "chiamata"), "l'Entità dalla mano aspetta"
    ref = { "source" => "rf", "event" => "on_ability", "entering" => "rf", "ability" => "chiamata" }
    @table.apply({ "t" => "toZone", "uid" => "h", "zone" => "field", "x" => 442, "y" => 1260, "grants" => ["surge"], "effect" => ref })
    assert_equal "field", @table.card("h")[:zone]
    assert_equal ["surge"], @table.card("h")[:grants]
    assert_equal 3, @table.flux("a"), "gratis"
    refute @table.pending_ability?("rf", "chiamata"), "la discesa chiude l'attivazione"
    attack = { "id" => "d", "from" => "h", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1, "bonus" => 1 }
    @table.apply({ "t" => "declare", "declaration" => attack })
    assert_equal 1, @table.card("h")[:power_bonus]
    assert_equal 1, @table.declaration("h")[:bonus]
    @table.apply({ "t" => "declare", "declaration" => attack.merge("id" => "d2") })
    assert_equal 1, @table.card("h")[:power_bonus], "ridichiarare non lo dà due volte"
    @table.apply({ "t" => "undeclare", "from" => "h" })
    assert_nil @table.card("h")[:power_bonus], "ritirare lo restituisce"
    @table.apply({ "t" => "declare", "declaration" => attack })
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_empty @table.attack_bonuses("a"), "la promessa cade col turno"
    assert_nil @table.card("h")[:power_bonus]
    assert_nil @table.card("h")[:grants]
  end

  # --- §8.2: la dichiarazione ferma (gemello: state.ts, apply) ---------------

  def test_declaration_is_sealed_and_snapshot_remembers
    @table.apply({ "t" => "declare", "declaration" => { "from" => "u", "to" => "rf", "kind" => "attack", "seat" => "a", "order" => 1 } })
    refute @table.declaration_sealed?("u")
    @table.seal_declaration("u")
    assert @table.declaration_sealed?("u")
    @table.apply({ "t" => "undeclare", "from" => "u" })
    refute @table.declaration_sealed?("u"), "sciolta (a engine spento), il sigillo se ne va con lei"
    @table.load({ "cards" => [], "declarations" => [{ "from" => "x", "to" => "rf", "kind" => "attack", "seat" => "a", "order" => 1, "sealed" => true }], "players" => {} })
    assert @table.declaration_sealed?("x")
  end

  # --- §8.2: l'uscita annotata e il ritorno vincolato (gemello: state.ts, revive)

  def test_leaving_field_records_turn_and_worn_items
    a = [
      { "uid" => "e", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "X", "x" => 442, "y" => 1260 },
      { "uid" => "o", "owner" => "a", "zone" => "field", "order" => 1, "cardId" => "Y", "x" => 472, "y" => 1266, "assignedTo" => "e" },
      { "uid" => "p", "owner" => "a", "zone" => "ritiro", "order" => 0, "cardId" => "Y" },
    ]
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    @table.apply({ "t" => "toZone", "uid" => "e", "zone" => "abisso" })
    assert_equal({ turn: 2, armed: true, bearer: nil }, @table.card("e")[:left])
    assert_equal({ turn: 2, armed: false, bearer: "e" }, @table.card("o")[:left], "l'Oggetto che segue annota a chi era addosso")
    @table.apply({ "t" => "revive", "uid" => "e", "x" => 821, "y" => 1260, "z" => 5, "object" => "p" })
    assert_equal "field", @table.card("e")[:zone]
    assert_nil @table.card("e")[:left], "rientrando, l'annotazione si cancella"
    assert_equal "field", @table.card("p")[:zone]
    assert_equal "e", @table.card("p")[:assigned_to]
    @table.apply({ "t" => "toZone", "uid" => "e", "zone" => "hand" })
    assert_nil @table.card("e")[:left], "in mano non è un'uscita che conta"
  end

  # Il ritorno vincolato dopo il cambio di turno (§6.2, 2026-09-13): conta il
  # turno in cui la carta è uscita, non quello in cui torna.
  def test_revive_after_turn_change_counts_the_turn_it_left
    a = [
      { "uid" => "e", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "X", "x" => 442, "y" => 1260 },
      { "uid" => "p", "owner" => "a", "zone" => "ritiro", "order" => 0, "cardId" => "Y" },
    ]
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    @table.apply({ "t" => "toZone", "uid" => "e", "zone" => "abisso" })
    @table.apply({ "t" => "turn", "turn" => 3, "active" => "a" })
    @table.apply({ "t" => "revive", "uid" => "e", "x" => 821, "y" => 1260, "z" => 5, "object" => "p" })
    assert_equal 2, @table.card("e")[:entered], "tornata nella Preparazione del turno dopo: conta il turno in cui è uscita"
    @table.apply({ "t" => "toZone", "uid" => "e", "zone" => "abisso" })
    @table.apply({ "t" => "revive", "uid" => "e", "x" => 821, "y" => 1260, "z" => 5, "object" => "p" })
    assert_equal 3, @table.card("e")[:entered], "uscita e tornata nello stesso turno: entra adesso"
  end

  # --- Il caso lo tira il tavolo (§8.2, dal 2026-10-21) — gemello: state.test.ts

  def test_roll_remembers_the_tables_roll_by_key_and_turn_change_forgets_it
    @table.apply({ "t" => "roll", "seat" => "a", "die" => 6, "for" => "cost|a-1", "value" => 4 })
    assert_equal({ die: 6, value: 4 }, @table.roll_for("cost|a-1"))
    @table.apply({ "t" => "roll", "seat" => "a", "die" => 20, "for" => "fury|rf", "value" => 17 })
    assert_equal 17, @table.roll_for("fury|rf")[:value]
    assert_equal 4, @table.roll_for("cost|a-1")[:value]
    @table.apply({ "t" => "roll", "seat" => "a", "die" => 6, "for" => "deploy|rf" })
    assert_nil @table.roll_for("deploy|rf"), "senza valore non si annota"
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "a" })
    assert_equal 4, @table.roll_for("cost|a-1")[:value], "il posto invariato non è un cambio di turno"
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_nil @table.roll_for("cost|a-1")
    @table.apply({ "t" => "roll", "seat" => "b", "die" => 6, "for" => "cost|b-1", "value" => 2 })
    @table.apply({ "t" => "newGame", "active" => "a" })
    assert_nil @table.roll_for("cost|b-1")
  end

  # --- Le viste proiettate (room.rb, project) — gemello: state.test.ts

  def hidden_deck(seat, count)
    cards = (1..count).map { |serial| { "uid" => "#{seat}-#{serial}", "owner" => seat, "zone" => "deck" } }
    { "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards }
  end

  def deck_for(seat, count)
    cards = (1..count).map { |serial| { "uid" => "#{seat}-#{serial}", "owner" => seat, "zone" => "deck", "order" => serial } }
    { "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards }
  end

  def test_load_deck_without_identity_or_order_loads_hidden_cards
    @table.apply(hidden_deck("b", 3))
    deck = @table.zone_uids("b", "deck")
    assert_equal 3, deck.size
    assert deck.all? { |uid| @table.card(uid)[:card_id].nil? && @table.card(uid)[:order].zero? }
    assert_equal({ mulligans: 0, kept: false }, @table.opening("b"))
    assert_equal({ owner: "b", zone: "deck", card_id: nil }, @table.card_facts["b-1"])
  end

  def test_shuffle_without_order_moves_nothing
    @table.apply(deck_for("a", 3))
    before = @table.zone_uids("a", "deck")
    @table.apply({ "t" => "shuffle", "seat" => "a" })
    assert_equal before, @table.zone_uids("a", "deck")
  end

  def test_draw_with_drawn_takes_exactly_those_cards_in_the_named_order
    @table.apply(hidden_deck("b", 4))
    @table.apply({ "t" => "draw", "seat" => "b", "count" => 2, "drawn" => %w[b-3 b-1] })
    assert_equal %w[b-3 b-1], @table.zone_uids("b", "hand")
    assert_equal %w[b-2 b-4], @table.zone_uids("b", "deck").sort
    @table.apply({ "t" => "draw", "seat" => "b", "count" => 1, "drawn" => %w[a-9 b-3] })
    assert_equal 2, @table.hand_count("b"), "un uid che non è nel mazzo di quel posto non si pesca"
  end

  def test_mulligan_without_order_returns_the_hand_to_the_bottom_and_draws_the_named
    @table.apply(hidden_deck("b", 8))
    @table.apply({ "t" => "draw", "seat" => "b", "count" => 6, "drawn" => %w[b-1 b-2 b-3 b-4 b-5 b-6] })
    @table.apply({ "t" => "mulligan", "seat" => "b", "drawn" => %w[b-7 b-8 b-1 b-2 b-3 b-4] })
    assert_equal %w[b-7 b-8 b-1 b-2 b-3 b-4], @table.zone_uids("b", "hand")
    assert_equal %w[b-5 b-6], @table.zone_uids("b", "deck").sort
    assert_equal({ mulligans: 1, kept: false }, @table.opening("b"))
  end

  def test_turn_with_drawn_draws_the_named_card_for_the_incoming_seat
    @table.apply(hidden_deck("b", 3))
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b", "drawn" => ["b-2"] })
    assert_equal ["b-2"], @table.zone_uids("b", "hand")
    assert_equal 2, @table.turn
  end

  def test_look_with_looked_and_identities_reveal_before_applying
    @table.apply(hidden_deck("b", 4))
    effect = { "source" => "b-1", "event" => "on_enter_field", "entering" => "b-1" }
    @table.apply({ "t" => "look", "seat" => "b", "count" => 2, "reveal" => "b-3", "looked" => %w[b-3 b-4], "effect" => effect, "identities" => { "b-3" => "RBF-010" } })
    assert_equal "hand", @table.card("b-3")[:zone]
    assert_equal "RBF-010", @table.card("b-3")[:card_id]
    assert_equal "deck", @table.card("b-4")[:zone]
    assert_nil @table.card("b-4")[:card_id]
  end

  def test_identities_do_not_touch_known_or_missing_cards
    @table.apply(deck_for("a", 2))
    @table.apply({ "t" => "say", "entry" => {}, "identities" => { "a-1" => "RBF-099", "zz" => "RBF-001" } })
    assert_equal "RBF-099", @table.card("a-1")[:card_id], "il mazzo di prova non ha identità (nil): la nota la prende"
    assert_nil @table.card("zz")
    @table.apply({ "t" => "say", "entry" => {}, "identities" => { "a-1" => "RBF-001", "a-2" => 7 } })
    assert_equal "RBF-099", @table.card("a-1")[:card_id], "una carta già nota non cambia"
    assert_nil @table.card("a-2")[:card_id], "un'identità che non è una stringa non si prende"
  end

  def test_turn_card_is_remembered_once_for_the_starter
    @table.apply(deck_for("a", 8))
    @table.apply(deck_for("b", 8))
    @table.apply({ "t" => "draw", "seat" => "a", "count" => 6 })
    refute @table.turn_card_drawn?("a"), "la mano iniziale non è la carta del turno"
    @table.apply({ "t" => "keep", "seat" => "a" })
    @table.apply({ "t" => "draw", "seat" => "b", "count" => 6 })
    @table.apply({ "t" => "keep", "seat" => "b" })
    refute @table.turn_card_drawn?("a")
    @table.apply({ "t" => "draw", "seat" => "a", "count" => 1 })
    assert @table.turn_card_drawn?("a")
    refute @table.turn_card_drawn?("b")
  end

  def test_started_means_both_decks_kept_or_a_later_turn
    refute @table.started?
    @table.apply(deck_for("a", 3))
    @table.apply({ "t" => "draw", "seat" => "a", "count" => 1 })
    @table.apply({ "t" => "keep", "seat" => "a" })
    refute @table.started?, "B non ha ancora il mazzo"
    @table.apply(deck_for("b", 3))
    refute @table.started?
    @table.apply({ "t" => "draw", "seat" => "b", "count" => 1 })
    @table.apply({ "t" => "keep", "seat" => "b" })
    assert @table.started?
    fresh = Rubyfront::Table.new
    fresh.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert fresh.started?
  end

  # --- §8.1/§8.2 (2026-10-22): la Stasi per effetto, le concessioni a scadenza, l'esilio a tempo ---
  # Gemello: state.test.ts, «la Stasi per effetto, le concessioni a scadenza e l'esilio a tempo».

  def stasis_field
    a = [1, 2].map { |n| { "uid" => "a-#{n}", "owner" => "a", "zone" => "field", "order" => 0 } }
    b = [1, 2].map { |n| { "uid" => "b-#{n}", "owner" => "b", "zone" => "field", "order" => 0 } }
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    @table.apply({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => b })
  end

  def test_tap_with_stasis_freezes_numbers_and_counts_for_the_nexus
    stasis_field
    @table.apply({ "t" => "facedown", "uid" => "b-1", "facedown" => true })
    @table.apply({ "t" => "tap", "uid" => "b-1", "tapped" => true, "stasis" => true, "effect" => { "source" => "a-1", "event" => "on_enter_field", "entering" => "a-1" } })
    frozen = @table.card("b-1")
    assert frozen[:stasis]
    assert frozen[:tapped]
    refute frozen[:facedown], "lo stato di Stasi sostituisce la copertura (§8.1)"
    assert_equal 1, frozen[:stasis_at]
    assert_equal 1, @table.stasis_seq
    assert_equal 1, @table.stasis_inflicted("a"), "A ha messo in Stasi un'avversaria"
    assert_equal 0, @table.stasis_inflicted("b")
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert @table.card("b-1")[:tapped], "il turno non stappa la Stasi (§8.1)"
    @table.apply({ "t" => "empower", "uid" => "b-1", "untap" => true, "effect" => { "source" => "b-2", "event" => "on_enter_field", "entering" => "b-2" } })
    refute @table.card("b-1")[:stasis]
    assert_equal 1, @table.card("b-1")[:stasis_at], "la storia dell'ingresso resta"
    @table.apply({ "t" => "tap", "uid" => "b-1", "tapped" => true, "stasis" => true, "effect" => { "source" => "a-2", "event" => "on_resolve", "entering" => "a-2" } })
    assert_equal 2, @table.card("b-1")[:stasis_at], "un nuovo ingresso, un nuovo numero"
    assert_equal 2, @table.stasis_inflicted("a")
    # Sulla propria Entità, o senza fonte: entra in Stasi ma non conta per il Nexus.
    @table.apply({ "t" => "tap", "uid" => "a-2", "tapped" => true, "stasis" => true, "effect" => { "source" => "a-1", "event" => "on_ability", "entering" => "a-1" } })
    @table.apply({ "t" => "tap", "uid" => "b-2", "tapped" => true, "stasis" => true })
    assert @table.card("a-2")[:stasis]
    assert @table.card("b-2")[:stasis]
    assert_equal 2, @table.stasis_inflicted("a")
    assert_equal 4, @table.stasis_seq
    @table.apply({ "t" => "tap", "uid" => "a-1", "tapped" => true })
    assert @table.card("a-1")[:tapped]
    refute @table.card("a-1")[:stasis], "una tappata semplice non è Stasi"
  end

  # Gemello: state.test.ts, «la tappata prende il suo numero …».
  def test_tap_takes_a_number_once_per_tap_and_stasis_counts_as_a_tap
    stasis_field
    @table.apply({ "t" => "tap", "uid" => "a-1", "tapped" => true })
    assert_equal 1, @table.card("a-1")[:tap_at]
    assert_equal 1, @table.tap_seq
    # Una tappata su una già tappata non è una tappata.
    @table.apply({ "t" => "tap", "uid" => "a-1", "tapped" => true })
    assert_equal 1, @table.card("a-1")[:tap_at]
    assert_equal 1, @table.tap_seq
    # Stappata e ritappata: un numero nuovo. La Stasi imposta su una stappata è una tappata.
    @table.apply({ "t" => "tap", "uid" => "a-1", "tapped" => false })
    @table.apply({ "t" => "tap", "uid" => "a-1", "tapped" => true })
    assert_equal 2, @table.card("a-1")[:tap_at]
    @table.apply({ "t" => "tap", "uid" => "b-1", "tapped" => true, "stasis" => true })
    assert_equal 3, @table.card("b-1")[:tap_at]
    assert_equal 1, @table.card("b-1")[:stasis_at]
    # La Stasi su una GIÀ tappata non ritappa.
    @table.apply({ "t" => "tap", "uid" => "a-1", "tapped" => true, "stasis" => true })
    assert_equal 2, @table.card("a-1")[:tap_at]
    assert_equal 3, @table.tap_seq
    # Il turno stappa senza numerare; lo snapshot porta sequenza e numeri.
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_equal 3, @table.tap_seq
    assert_equal 3, @table.dump["tapSeq"]
    assert_equal 2, @table.dump["cards"].find { |card| card["uid"] == "a-1" }["tapAt"]
  end

  # Gemello: state.test.ts, «look con order rimette le guardate in cima …».
  def test_look_with_order_puts_the_looked_cards_back_on_top_in_that_order
    deck = (1..5).map { |n| { "uid" => "a-#{n}", "owner" => "a", "zone" => "deck", "order" => n } }
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => deck })
    assert_equal %w[a-1 a-2 a-3 a-4 a-5], @table.zone_uids("a", "deck")
    @table.apply({ "t" => "look", "seat" => "a", "count" => 3, "restTo" => "deck", "order" => %w[a-3 a-1 a-2], "effect" => { "source" => "x", "event" => "on_enter_field", "entering" => "x", "follow" => "sort" } })
    assert_equal %w[a-3 a-1 a-2 a-4 a-5], @table.zone_uids("a", "deck")
    # Un ordine parziale: le elencate sopra, le altre guardate dopo, com'erano.
    @table.apply({ "t" => "look", "seat" => "a", "count" => 3, "restTo" => "deck", "order" => %w[a-2], "effect" => { "source" => "x", "event" => "on_enter_field", "entering" => "x", "follow" => "sort" } })
    assert_equal %w[a-2 a-3 a-1 a-4 a-5], @table.zone_uids("a", "deck")
  end

  def test_combat_stasis_takes_a_number_too
    stasis_field
    @table.apply({ "t" => "declare", "declaration" => { "from" => "a-1", "to" => "rf", "kind" => "attack", "seat" => "a", "order" => 1 } })
    @table.apply({ "t" => "declare", "declaration" => { "from" => "b-1", "to" => "a-1", "kind" => "block", "seat" => "b", "order" => 0 } })
    @table.apply({ "t" => "resolve", "seat" => "a", "battles" => [
                   { "attacker" => "a-1", "blocker" => "b-1", "kind" => "block", "attackerDies" => false, "blockerDies" => false, "blockerStasis" => true, "damage" => 0 },
                 ] })
    assert @table.card("b-1")[:stasis]
    assert_equal 1, @table.card("b-1")[:stasis_at]
    assert_equal 0, @table.stasis_inflicted("a"), "il combattimento non conta per il Nexus"
  end

  def test_ability_untaps_grants_with_a_deadline_and_freezes
    stasis_field
    @table.apply({ "t" => "tap", "uid" => "a-1", "tapped" => true, "stasis" => true })
    @table.apply({ "t" => "ability", "uid" => "a-2", "ability" => "wake", "cost" => 4, "targets" => ["a-1"], "untap" => true })
    refute @table.card("a-1")[:tapped]
    refute @table.card("a-1")[:stasis]
    assert_equal 16, @table.hp("a")
    @table.apply({ "t" => "ability", "uid" => "a-2", "ability" => "hold", "gain" => 2, "targets" => ["a-1"], "grants" => ["stasis"], "until" => "controller_next_turn" })
    assert_equal ["stasis"], @table.card("a-1")[:grants]
    assert_equal "a", @table.card("a-1")[:grants_until]
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_equal ["stasis"], @table.card("a-1")[:grants], "«fino al tuo prossimo turno»: il turno altrui non la toglie"
    @table.apply({ "t" => "turn", "turn" => 3, "active" => "a" })
    assert_nil @table.card("a-1")[:grants], "al proprio turno cade"
    assert_nil @table.card("a-1")[:grants_until]
    @table.apply({ "t" => "ability", "uid" => "a-2", "ability" => "vigil-hold", "gain" => 2, "targets" => ["a-1"], "grants" => ["stasis"], "until" => "permanent" })
    assert_equal "game", @table.card("a-1")[:grants_until]
    @table.apply({ "t" => "turn", "turn" => 4, "active" => "b" })
    @table.apply({ "t" => "turn", "turn" => 5, "active" => "a" })
    assert_equal ["stasis"], @table.card("a-1")[:grants], "«per sempre»: nessun turno la toglie"
    @table.apply({ "t" => "toZone", "uid" => "a-1", "zone" => "ritiro" })
    assert_nil @table.card("a-1")[:grants], "ma chi esce dal campo la lascia lì"
    assert_nil @table.card("a-1")[:grants_until]
    @table.apply({ "t" => "ability", "uid" => "a-2", "ability" => "vigil-seal", "cost" => 7, "targets" => %w[b-1 b-2], "stasis" => true })
    assert @table.card("b-1")[:stasis]
    assert @table.card("b-2")[:stasis]
    assert_equal 2, @table.stasis_inflicted("a")
  end

  def test_timed_exile_counts_the_controllers_turns_and_waits_for_the_die
    stasis_field
    @table.apply({ "t" => "assign", "uid" => "b-2", "to" => "b-1" })
    @table.apply({ "t" => "toZone", "uid" => "b-1", "zone" => "ritiro", "exile" => { "turns" => 3 }, "effect" => { "source" => "a-1", "event" => "on_resolve", "entering" => "a-1" } })
    assert_equal({ seat: "b", remaining: 3, source: "a-1" }, @table.card("b-1")[:exile])
    assert_equal "ritiro", @table.card("b-2")[:zone], "gli Oggetti seguono l'Entità in Ritiro (§6.2)"
    assert_nil @table.card("b-2")[:exile], "l'Oggetto non è esiliato"
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_equal 3, @table.card("b-1")[:exile][:remaining], "il turno chiuso da A non conta"
    @table.apply({ "t" => "turn", "turn" => 3, "active" => "a" })
    assert_equal 2, @table.card("b-1")[:exile][:remaining], "il primo turno di B è passato"
    assert_empty @table.exiles_due("b")
    @table.apply({ "t" => "turn", "turn" => 4, "active" => "b" })
    @table.apply({ "t" => "turn", "turn" => 5, "active" => "a" })
    assert_equal 1, @table.card("b-1")[:exile][:remaining]
    @table.apply({ "t" => "turn", "turn" => 6, "active" => "b" })
    assert_equal ["b-1"], @table.exiles_due("b"), "al terzo turno di B il d12 è dovuto"
    assert_empty @table.exiles_due("a")
    @table.apply({ "t" => "toZone", "uid" => "b-1", "zone" => "field", "y" => 172 })
    assert_nil @table.card("b-1")[:exile], "il ritorno chiude l'esilio"
    refute @table.card("b-1")[:tapped]
    @table.apply({ "t" => "toZone", "uid" => "b-1", "zone" => "ritiro" })
    assert_nil @table.card("b-1")[:exile], "un Ritiro senza esilio non ne apre uno"
    @table.apply({ "t" => "toZone", "uid" => "a-1", "zone" => "ritiro", "exile" => { "turns" => 3 } })
    @table.apply({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
    assert_nil @table.card("a-1")[:exile], "ogni altra uscita dal Ritiro chiude l'esilio"
  end

  def test_flip_can_cost_an_object_to_retire
    stasis_field
    @table.apply({ "t" => "assign", "uid" => "a-2", "to" => "a-1" })
    @table.apply({ "t" => "flip", "uid" => "a-1", "face" => 1, "retire" => "a-2", "recover" => 5 })
    assert_equal "ritiro", @table.card("a-2")[:zone]
    assert_nil @table.card("a-2")[:assigned_to]
    assert_equal 1, @table.card("a-1")[:face]
  end

  def test_snapshot_and_dump_carry_stasis_grants_and_exile
    @table.load({
      "turn" => 4, "active" => "b", "phase" => "preparazione", "stasisSeq" => 3,
      "players" => { "a" => { "hp" => 20, "stasisInflicted" => 2 }, "b" => { "hp" => 20 } },
      "cards" => {
        "a-1" => { "owner" => "a", "zone" => "field", "stasis" => true, "stasisAt" => 3, "grantsUntil" => "game", "grants" => ["stasis"] },
        "b-1" => { "owner" => "b", "zone" => "ritiro", "exile" => { "seat" => "b", "remaining" => 1, "source" => "m" } },
        "b-2" => { "owner" => "b", "zone" => "field", "grantsUntil" => "nope", "exile" => { "seat" => "c" } },
      },
    })
    assert_equal 3, @table.stasis_seq
    assert_equal 2, @table.stasis_inflicted("a")
    assert_equal 3, @table.card("a-1")[:stasis_at]
    assert_equal "game", @table.card("a-1")[:grants_until]
    assert_equal({ seat: "b", remaining: 1, source: "m" }, @table.card("b-1")[:exile])
    assert_nil @table.card("b-2")[:grants_until], "una scadenza ignota non si prende"
    assert_nil @table.card("b-2")[:exile]
    assert_equal ["b-1"], @table.exiles_due("b")
    dump = @table.dump
    assert_equal 3, dump["stasisSeq"]
    assert_equal 2, dump["players"]["a"]["stasisInflicted"]
    a1 = dump["cards"].find { |card| card["uid"] == "a-1" }
    assert_equal 3, a1["stasisAt"]
    assert_equal "game", a1["grantsUntil"]
    b1 = dump["cards"].find { |card| card["uid"] == "b-1" }
    assert_equal({ "seat" => "b", "remaining" => 1, "source" => "m" }, b1["exile"])
  end
end
