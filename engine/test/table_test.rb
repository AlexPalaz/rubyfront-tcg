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
    refute @table.fired?("g", "on_enter_field", "e")
    @table.fire("g", "on_enter_field", "e")
    assert @table.fired?("g", "on_enter_field", "e")
    refute @table.fired?("g", "on_enter_field", "altro")
    refute @table.fired?("g", "on_attack", "e"), "un altro evento è un altro innesco"
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    refute @table.fired?("g", "on_enter_field", "e")
  end

  # --- lo sguardo nel mazzo (§8.2) ---------------------------------------------

  def test_look_mostra_una_carta_e_mette_le_altre_in_fondo
    @table.apply(deck_for("a", 6))
    assert_equal %w[a-1 a-2 a-3 a-4], @table.top_of_deck("a", 4)
    @table.apply({ "t" => "look", "seat" => "a", "count" => 4, "reveal" => "a-2",
                   "effect" => { "source" => "x", "event" => "on_enter_field", "entering" => "x" } })
    assert_equal 1, @table.hand_count("a")
    assert_equal "hand", @table.card("a-2")[:zone]
    assert_equal %w[a-5 a-6 a-1 a-3 a-4], @table.top_of_deck("a", 5), "le altre in fondo, nell'ordine in cui stavano"
  end

  def test_look_senza_rivelata_mette_tutto_in_fondo
    @table.apply(deck_for("a", 5))
    @table.apply({ "t" => "look", "seat" => "a", "count" => 2, "effect" => { "source" => "x", "event" => "on_enter_field", "entering" => "x" } })
    assert_equal 0, @table.hand_count("a")
    assert_equal %w[a-3 a-4 a-5 a-1 a-2], @table.top_of_deck("a", 5)
  end

  # --- il controllo e la restituzione (§8.2) ----------------------------------

  def test_il_controllo_cambia_chi_comanda_non_il_proprietario
    cards = [{ "uid" => "b-1", "owner" => "b", "zone" => "field", "order" => 0, "y" => 172 }]
    @table.apply({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => cards })
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    @table.apply({ "t" => "turn", "turn" => 3, "active" => "a" })
    @table.apply({ "t" => "control", "uid" => "b-1", "by" => "a", "grants" => ["surge"], "effect" => {} })
    assert_equal "a", @table.controller_of(@table.card("b-1"))
    assert_equal "b", @table.card("b-1")[:owner]
    assert_equal ["surge"], @table.card("b-1")[:grants]
    assert_equal 3, @table.card("b-1")[:entered], "entra ora sul campo di chi la controlla"
    @table.apply({ "t" => "release", "uid" => "b-1", "zone" => "field", "x" => 442, "y" => 172 })
    assert_equal "b", @table.controller_of(@table.card("b-1"))
    assert_nil @table.card("b-1")[:grants]
    assert_equal 172, @table.card("b-1")[:row]
    @table.apply({ "t" => "control", "uid" => "b-1", "by" => "a", "grants" => [], "effect" => {} })
    @table.apply({ "t" => "release", "uid" => "b-1", "zone" => "ritiro" })
    assert_equal "ritiro", @table.card("b-1")[:zone], "a Fronte pieno, in Zona di Ritiro"
  end

  def test_look_manda_una_carta_in_ritiro
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

  def test_empower_somma_concede_vieta_e_il_turno_cancella
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

  def test_refresh_stappa_chi_comanda_solo_col_tiro
    @table.apply({ "t" => "refresh", "seat" => "a", "roll" => 3, "untap" => false })
    assert @table.card("a1")[:tapped], "col tiro mancato nessuno si stappa"
    @table.apply({ "t" => "refresh", "seat" => "a", "roll" => 17, "untap" => true })
    refute @table.card("a1")[:tapped]
    assert @table.card("e")[:tapped]
  end

  def test_resolve_stappa_chi_lo_chiede_e_ricorda_l_ondata
    @table.apply({ "t" => "declare", "declaration" => { "from" => "a2", "to" => "rf", "kind" => "attack", "order" => 2 } })
    @table.apply({ "t" => "declare", "declaration" => { "from" => "a1", "to" => "rf", "kind" => "attack", "order" => 1 } })
    @table.apply({ "t" => "resolve", "seat" => "a", "battles" => [], "untap" => ["a1"] })
    refute @table.card("a1")[:tapped]
    assert @table.card("a2")[:tapped]
    assert_equal %w[a1 a2], @table.last_wave("a")
  end

  def test_to_zone_con_assign_to_rimette_un_oggetto_gia_assegnato
    @table.apply({ "t" => "toZone", "uid" => "obj", "zone" => "field", "y" => 1236, "assignTo" => "a1" })
    assert_equal "a1", @table.card("obj")[:assigned_to]
  end
  # --- gli attrezzi di Eredità Perduta: Stasi, Contrattacco concesso, esilio, flip, sigillo ---

  def campo(seat, uid, extra = {})
    { "uid" => uid, "owner" => seat, "zone" => "field", "order" => 0, "cardId" => "X" }.merge(extra)
  end

  def test_empower_stappa_anche_dalla_stasi_e_concede_contrattacco
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => [campo("a", "a1", "tapped" => true)] })
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

  def test_la_stasi_alla_risoluzione_e_il_turno_non_la_stappa
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => [campo("a", "a1"), campo("a", "a2")] })
    @table.apply({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => [campo("b", "b1", "facedown" => true), campo("b", "m1")] })
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

  def test_con_piu_bloccanti_l_attaccante_muore_una_volta_sola
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => [campo("a", "a1")] })
    @table.apply({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => [campo("b", "b1"), campo("b", "b2")] })
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

  def test_l_esilio_tiene_la_carta_e_la_restituzione_la_riporta_in_gioco
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => [campo("a", "m")] })
    @table.apply({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => [campo("b", "b1", "y" => 172)] })
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

  def test_il_flip_scarta_recupera_e_annota_il_turno
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => [campo("a", "rf", "y" => 1236), campo("a", "h", "zone" => "hand")] })
    @table.apply({ "t" => "player", "seat" => "a", "patch" => { "hp" => 12 } })
    @table.apply({ "t" => "flip", "uid" => "rf", "face" => 1, "discard" => "h", "recover" => 5 })
    rf = @table.card("rf")
    assert_equal 1, rf[:face]
    assert_equal 1, rf[:flipped]
    assert_equal 17, @table.hp("a")
    assert_equal "abisso", @table.card("h")[:zone]
  end

  def test_il_sigillo_e_il_bersaglio_dichiarato_viaggiano_anche_nello_snapshot
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => [campo("a", "m", "zone" => "hand")] })
    @table.apply({ "t" => "player", "seat" => "a", "patch" => { "sealed" => ["RBF-012"] } })
    assert @table.sealed?("a", "RBF-012")
    refute @table.sealed?("b", "RBF-012")
    @table.apply({ "t" => "toZone", "uid" => "m", "zone" => "field", "target" => "x1" })
    assert_equal "x1", @table.card("m")[:target]
    @table.apply({ "t" => "toZone", "uid" => "m", "zone" => "abisso" })
    assert_nil @table.card("m")[:target]
    @table.load({
      "turn" => 4, "active" => "a",
      "players" => { "a" => { "sealed" => ["RBF-012"] } },
      "cards" => {
        "a1" => { "owner" => "a", "zone" => "field", "order" => 0, "stasis" => true, "tapped" => true, "target" => "b1" },
        "b1" => { "owner" => "b", "zone" => "abisso", "order" => 0, "heldBy" => "a1" },
      },
    })
    assert @table.sealed?("a", "RBF-012")
    assert @table.card("a1")[:stasis]
    assert_equal "b1", @table.card("a1")[:target]
    assert_equal "a1", @table.card("b1")[:held_by]
    @table.apply({ "t" => "turn", "turn" => 5, "active" => "b" })
    @table.apply({ "t" => "turn", "turn" => 6, "active" => "a" })
    assert @table.card("a1")[:tapped], "dallo snapshot la Stasi resta una tappata permanente"
  end

end

# §7.2 — la catena di risposta. Gemello: state.test.ts, «la catena di risposta».
class TableChainTest < Minitest::Test
  def setup
    @table = Rubyfront::Table.new
    @table.apply({ "t" => "loadDeck", "seat" => "a", "deckId" => "t", "cards" => [{ "uid" => "r1", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "R" }] })
    @table.apply({ "t" => "loadDeck", "seat" => "b", "deckId" => "t", "cards" => [{ "uid" => "r2", "owner" => "b", "zone" => "hand", "order" => 0, "cardId" => "R" }] })
  end

  def gioca(uid, chain: true)
    @table.apply({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => 10, "y" => 10, "z" => 2 }.merge(chain ? { "chain" => true } : {}))
  end

  def test_la_reattiva_apre_la_risposta_allunga_e_l_accettazione_risolve_al_contrario
    gioca("r1")
    assert_equal({ stack: ["r1"], turn: "b", resolving: false }, @table.chain)
    gioca("r2")
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

  def test_senza_il_segno_non_si_apre_il_turno_chiude_e_accettare_senza_catena_non_fa_nulla
    gioca("r1", chain: false)
    assert_nil @table.chain
    @table.apply({ "t" => "pass", "seat" => "b" })
    assert_nil @table.chain
    @table.apply({ "t" => "toZone", "uid" => "r1", "zone" => "hand" })
    gioca("r1")
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
                   { "uid" => "u", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "U", "y" => 1236 }] })
    @table.apply({ "t" => "empower", "uid" => "u", "power" => 1, "counter" => 2, "grants" => ["revenge"], "restrict" => "block" })
  end

  def test_il_cambio_di_turno_azzera_i_bonus
    assert_equal 1, @table.card("u")[:power_bonus]
    @table.apply({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert_nil @table.card("u")[:power_bonus]
    assert_nil @table.card("u")[:counter_bonus]
    assert_nil @table.card("u")[:cannot_block]
    assert_nil @table.card("u")[:grants]
  end

  def test_chi_lascia_il_campo_lascia_i_bonus
    @table.apply({ "t" => "toZone", "uid" => "u", "zone" => "abisso" })
    assert_nil @table.card("u")[:power_bonus], "il ritorno in campo è sempre quello stampato (§3.1, §8.2)"
    assert_nil @table.card("u")[:counter_bonus]
    assert_nil @table.card("u")[:cannot_block]
    assert_nil @table.card("u")[:grants]
  end
end
