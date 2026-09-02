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

  # --- §6.4: la risoluzione applicata ------------------------------------

  def battlefield
    a = [1, 2].map { |n| { "uid" => "a-#{n}", "owner" => "a", "zone" => "field", "order" => 0 } }
    b = [{ "uid" => "b-1", "owner" => "b", "zone" => "field", "order" => 0 }]
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    @table.apply({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => b })
    @table.apply({ "t" => "declare", "declaration" => { "from" => "a-1", "to" => "rf", "kind" => "attack", "seat" => "a", "order" => 1 } })
    @table.apply({ "t" => "declare", "declaration" => { "from" => "b-1", "to" => "a-1", "kind" => "block", "seat" => "b", "order" => 0 } })
  end

  def test_resolve_manda_i_morti_nell_abisso_e_sgombera_le_frecce
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

  def test_l_ondata_si_legge_nell_ordine_di_dichiarazione
    battlefield
    @table.apply({ "t" => "declare", "declaration" => { "from" => "a-2", "to" => "rf", "kind" => "attack", "seat" => "a", "order" => 0 } })
    assert_equal %w[a-2 a-1], @table.attackers_in_order
    assert_equal ["b-1", "block"], @table.blocker_of("a-1")
    assert_nil @table.blocker_of("a-2")
  end

  def test_chi_esce_dal_campo_non_e_piu_nell_ondata
    battlefield
    @table.apply({ "t" => "toZone", "uid" => "b-1", "zone" => "hand" })
    assert_nil @table.blocker_of("a-1"), "il bloccante uscito lascia l'attacco non bloccato (§6.3)"
  end

  # --- il cambio di turno apparecchia chi entra ----------------------------

  def test_il_cambio_di_turno_stappa_chi_entra_e_sgombera_le_frecce
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

  def test_il_cambio_di_turno_pesca_la_carta_del_turno
    @table.apply(deck_for("b", 2))
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_equal 1, @table.hand_count("b"), "la Pesca non si salta mai (§6.1)"
    assert_equal 1, @table.zone_count("b", "deck")
    @table.apply({ "t" => "turn", "turn" => 3, "active" => "a" })
    assert_equal 0, @table.hand_count("a"), "a mazzo vuoto non si pesca"
  end

  def test_il_contatore_ritoccato_non_apparecchia_nulla
    battlefield
    @table.apply({ "t" => "tap", "uid" => "a-1", "tapped" => true })
    @table.apply({ "t" => "turn", "turn" => 7, "active" => "a" })
    assert @table.card("a-1")[:tapped]
    assert @table.wave_declared?
    assert_equal 7, @table.turn
  end

  # --- il Flusso (§3.2), come lo conta il client -----------------------------

  def test_il_flusso_parte_da_1_e_cresce_dal_secondo_turno
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
  end

  def test_la_nuova_partita_dice_chi_inizia
    @table.apply({ "t" => "turn", "turn" => 5, "active" => "a" })
    @table.apply({ "t" => "newGame", "active" => "b" })
    assert_equal "b", @table.active
    assert_equal 1, @table.turn
  end

  def test_il_flusso_massimo_non_supera_20
    @table.apply({ "t" => "player", "seat" => "b", "patch" => { "fluxMax" => 20, "flux" => 3 } })
    @table.apply({ "t" => "turn", "turn" => 4, "active" => "b" })
    assert_equal 20, @table.flux_max("b")
    assert_equal 20, @table.flux("b")
  end

  def test_la_patch_dei_contatori_e_lo_snapshot_allineano_il_flusso
    @table.apply({ "t" => "player", "seat" => "a", "patch" => { "flux" => 5 } })
    assert_equal 5, @table.flux("a")
    @table.load({ "active" => "a", "turn" => 4, "players" => { "a" => { "flux" => 7, "fluxMax" => 9 }, "b" => { "flux" => 2 } } })
    assert_equal 7, @table.flux("a")
    assert_equal 9, @table.flux_max("a")
    assert_equal 2, @table.flux("b")
  end

  def test_giocare_dalla_mano_scala_il_costo
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

  # --- faccia e fila (§3.1, §7) ---------------------------------------------

  def test_la_copia_segue_la_faccia_e_la_fila
    cards = [{ "uid" => "rf", "owner" => "a", "zone" => "field", "order" => 0, "face" => 0, "y" => 1756 }]
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    assert_equal 0, @table.card("rf")[:face]
    assert_equal 1756, @table.card("rf")[:row], "in Zona di Richiamo, fila di servizio"
    @table.apply({ "t" => "move", "uid" => "rf", "x" => 30, "y" => 1236, "z" => 2 })
    assert_equal 1236, @table.card("rf")[:row], "schierato, fila del Fronte"
    @table.apply({ "t" => "flip", "uid" => "rf", "face" => 1 })
    assert_equal 1, @table.card("rf")[:face], "il Nexus"
    @table.apply({ "t" => "toZone", "uid" => "rf", "zone" => "hand" })
    assert_nil @table.card("rf")[:row], "fuori dal campo la fila non dice niente"
  end

  def test_lo_snapshot_porta_faccia_e_fila
    @table.load({ "cards" => { "rf" => { "owner" => "b", "zone" => "field", "face" => 1, "y" => 172, "cardId" => "X" } } })
    assert_equal 1, @table.card("rf")[:face]
    assert_equal 172, @table.card("rf")[:row]
  end

  # --- i PV e la fine (§2, §9) ----------------------------------------------

  def test_i_pv_scendono_con_la_risoluzione_e_con_le_patch
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

  def test_la_fine_si_annota_e_la_nuova_partita_la_toglie
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

  def test_il_gettone_va_a_chi_non_inizia_e_paga_quando_la_barra_non_basta
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

  def test_lo_schieramento_si_paga_col_move
    @table.apply({ "t" => "player", "seat" => "a", "patch" => { "flux" => 5 } })
    cards = [{ "uid" => "rf", "owner" => "a", "zone" => "field", "order" => 0, "y" => 1756 }]
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    @table.apply({ "t" => "move", "uid" => "rf", "x" => 30, "y" => 1236, "z" => 2, "cost" => 4, "roll" => 4 })
    assert_equal 1, @table.flux("a")
    assert_equal 1236, @table.card("rf")[:row]
  end

  # --- la scoperta a T+3 e gli Oggetti che seguono (§6.3, §6.2, §5) ---------

  def test_coprire_annota_il_turno_e_il_cambio_di_turno_scopre_a_t3
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

  def test_una_coperta_senza_data_resta_coperta
    @table.load({ "active" => "b", "turn" => 2, "cards" => { "a-1" => { "owner" => "a", "zone" => "field", "facedown" => true } } })
    @table.apply({ "t" => "turn", "turn" => 3, "active" => "a" })
    @table.apply({ "t" => "turn", "turn" => 4, "active" => "b" })
    @table.apply({ "t" => "turn", "turn" => 5, "active" => "a" })
    assert @table.card("a-1")[:facedown]
  end

  def test_gli_oggetti_seguono_l_entita_in_ritiro_e_abisso_non_in_mano
    cards = %w[a-1 a-2 a-3].map { |uid| { "uid" => uid, "owner" => "a", "zone" => "field", "order" => 0 } }
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    @table.apply({ "t" => "assign", "uid" => "a-2", "to" => "a-1" })
    @table.apply({ "t" => "assign", "uid" => "a-3", "to" => "a-1" })
    @table.apply({ "t" => "toZone", "uid" => "a-1", "zone" => "ritiro" })
    assert_equal "ritiro", @table.card("a-2")[:zone]
    assert_equal "ritiro", @table.card("a-3")[:zone]
    assert_nil @table.card("a-2")[:assigned_to]
    assert_equal 3, @table.zone_count("a", "ritiro")

    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    @table.apply({ "t" => "assign", "uid" => "a-2", "to" => "a-1" })
    @table.apply({ "t" => "toZone", "uid" => "a-1", "zone" => "hand" })
    assert_equal "field", @table.card("a-2")[:zone], "in mano no"
    assert_nil @table.card("a-2")[:assigned_to]
  end

  # --- gli inneschi consumati (§8.2) -----------------------------------------

  def test_un_innesco_si_consuma_una_volta_e_il_turno_lo_azzera
    refute @table.fired?("g", "e")
    @table.fire("g", "e")
    assert @table.fired?("g", "e")
    refute @table.fired?("g", "altro")
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    refute @table.fired?("g", "e")
  end
end
