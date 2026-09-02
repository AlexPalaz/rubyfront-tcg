# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/engine"

# Il contratto dei verdetti e le regole collegate, una sezione per punto.
class EngineTest < Minitest::Test
  def setup
    @engine = Rubyfront::Engine.new
  end

  def test_il_saluto_dichiara_versione_e_regole
    hello = @engine.hello
    assert_equal "engine", hello[:t]
    assert_equal Rubyfront::Engine::VERSION, hello[:version]
    assert_includes hello[:rules], "§3.2 Flusso: limite 20"
  end

  def test_le_azioni_senza_regola_passano
    verdict = @engine.judge({ "t" => "draw", "seat" => "a", "count" => 1 })
    assert_equal "verdict", verdict[:t]
    assert_equal "draw", verdict[:action]
    assert verdict[:ok]
    refute verdict[:ruled]
  end

  def test_un_azione_malformata_non_lo_turba
    verdict = @engine.judge(nil)
    assert verdict[:ok]
    refute verdict[:ruled]
    assert_nil verdict[:action]
  end

  # --- §3.2: il limite dei 20 Flussi -------------------------------------

  def test_flusso_a_20_va_bene
    verdict = @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "flux" => 20 } })
    assert verdict[:ruled]
    assert verdict[:ok]
  end

  def test_flusso_a_21_viene_fermato
    verdict = @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "flux" => 21 } })
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/§3\.2/, verdict[:reason])
  end

  def test_il_gettone_speso_arriva_a_21
    spesa = { "t" => "player", "seat" => "b", "patch" => { "token" => false, "flux" => 21 } }
    verdict = @engine.judge(spesa)
    assert verdict[:ruled]
    assert verdict[:ok], "la spesa del Gettone è l'unico 21 legale"
  end

  def test_nemmeno_il_gettone_supera_21
    verdict = @engine.judge({ "t" => "player", "seat" => "b", "patch" => { "token" => false, "flux" => 22 } })
    refute verdict[:ok]
  end

  def test_la_barra_non_supera_20
    verdict = @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "fluxMax" => 21 } })
    assert verdict[:ruled]
    refute verdict[:ok]
  end

  def test_una_patch_che_non_tocca_i_contatori_non_e_giudicata
    verdict = @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "name" => "Ajmal", "token" => true } })
    assert verdict[:ok]
    refute verdict[:ruled]
  end

  # --- §3.1/§3.2: contatori mai sotto zero -------------------------------

  def test_i_pv_non_scendono_sotto_zero
    verdict = @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => -1 } })
    refute verdict[:ok]
    assert_match(/§3\.1/, verdict[:reason])
    assert @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 0 } })[:ok], "0 esatto è legale"
  end

  def test_il_flusso_non_scende_sotto_zero
    refute @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "flux" => -1 } })[:ok]
    refute @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "fluxMax" => -2 } })[:ok]
    assert @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "flux" => 0 } })[:ok]
  end

  # --- §6.5: mano massima 7 a fine turno ---------------------------------

  def carica_e_pesca(seat, count)
    cards = (1..count).map do |serial|
      { "uid" => "#{seat}-#{serial}", "owner" => seat, "zone" => "deck", "order" => serial }
    end
    @engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    @engine.judge({ "t" => "draw", "seat" => seat, "count" => count })
  end

  def fine_turno(turn: 2, active: "b")
    { "t" => "turn", "turn" => turn, "active" => active }
  end

  def test_fine_turno_con_otto_carte_viene_fermato
    carica_e_pesca("a", 8)
    verdict = @engine.judge(fine_turno)
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/8 carte/, verdict[:reason])
    assert_match(/§6\.5/, verdict[:reason])
  end

  def test_fine_turno_fermato_non_cambia_il_posto_attivo
    carica_e_pesca("a", 8)
    @engine.judge(fine_turno)
    # Rifiutata: la copia del tavolo non deve averla applicata — scartata una
    # carta, lo stesso fine turno ripassa.
    @engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
    verdict = @engine.judge(fine_turno)
    assert verdict[:ok], "con 7 in mano il turno si chiude"
  end

  def test_fine_turno_con_sette_carte_passa
    carica_e_pesca("a", 7)
    verdict = @engine.judge(fine_turno)
    assert verdict[:ruled]
    assert verdict[:ok]
  end

  def test_il_contatore_ritoccato_non_e_un_fine_turno
    carica_e_pesca("a", 9)
    verdict = @engine.judge({ "t" => "turn", "turn" => 5, "active" => "a" })
    refute verdict[:ruled], "active invariato: non è una chiusura di turno"
  end

  def test_observe_applica_anche_le_violazioni
    carica_e_pesca("b", 8)
    @engine.judge(fine_turno(active: "b")) # tocca a B
    # B (l'avversario) chiude il turno con 8 carte: da osservatore il
    # verdetto boccia ma la copia segue — di là è già successo.
    verdict = @engine.observe(fine_turno(turn: 3, active: "a"))
    refute verdict[:ok]
    next_turn = @engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    assert next_turn[:ruled], "il posto attivo è tornato ad A: il fine turno di A si giudica"
  end

  def test_snapshot_allinea_la_mano
    @engine.snapshot({
      "turn" => 3,
      "active" => "a",
      "cards" => (1..9).to_h { |n| ["a-#{n}", { "owner" => "a", "zone" => "hand", "order" => n }] },
    })
    verdict = @engine.judge(fine_turno(turn: 4))
    refute verdict[:ok]
    assert_match(/9 carte/, verdict[:reason])
  end

  # --- §6.2: attesa di evocazione ----------------------------------------

  ANAGRAFE = {
    "LENTA" => { type: "entity", keywords: [] },
    "SCATTANTE" => { type: "entity", keywords: ["surge"] },
    "PIETRA" => { type: "matter", keywords: [] },
    "RUBINO" => { type: "rubyfront", keywords: ["fury"] },
    "FERRO" => { type: "object", keywords: [] },
  }.freeze

  def con_carte
    Rubyfront::Engine.new(cards: ANAGRAFE)
  end

  # Le dichiarazioni vivono in Fase di Fronte (§6): i test che dichiarano
  # aprono la fase per la via pubblica, come farebbe il giocatore attivo.
  def fronte!(engine)
    engine.judge({ "t" => "phase", "phase" => "fronte" })
  end

  # Difesa apparecchiata (§6.3): tocca a B, Fronte dichiarato, e «b-9»
  # attacca — l'osservazione registra la freccia anche senza conoscere la
  # carta, come per un'azione avversaria arrivata dalla rete.
  def difesa!(engine)
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    fronte!(engine)
    engine.observe(dichiarazione("b-9", "rf-a", "attack"))
    engine.judge({ "t" => "phase", "phase" => "reazione" })
  end

  def scendi(engine, uid, card_id)
    cards = [{ "uid" => uid, "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => card_id }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field" })
  end

  def attacco(uid)
    { "t" => "declare",
      "declaration" => { "id" => "x", "from" => uid, "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 } }
  end

  def test_appena_scesa_non_attacca
    engine = con_carte
    scendi(engine, "a-1", "LENTA")
    fronte!(engine)
    verdict = engine.judge(attacco("a-1"))
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/§6\.2/, verdict[:reason])
  end

  def test_dal_turno_dopo_attacca
    engine = con_carte
    scendi(engine, "a-1", "LENTA")
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    fronte!(engine)
    verdict = engine.judge(attacco("a-1"))
    assert verdict[:ruled]
    assert verdict[:ok]
  end

  def test_con_slancio_attacca_subito
    engine = con_carte
    scendi(engine, "a-1", "SCATTANTE")
    fronte!(engine)
    verdict = engine.judge(attacco("a-1"))
    assert verdict[:ruled]
    assert verdict[:ok], "Slancio ignora l'attesa di evocazione (§8.1)"
  end

  def test_una_non_entita_non_arriva_all_attesa
    engine = con_carte
    scendi(engine, "a-1", "PIETRA")
    fronte!(engine)
    verdict = engine.judge(attacco("a-1"))
    # L'attesa non la giudica: la ferma prima la dogana del tipo (§6.3,
    # dichiarano solo le Entità).
    refute verdict[:ok]
    assert_match(/solo le Entità/, verdict[:reason])
  end

  def test_carta_ignota_o_anagrafe_assente_l_attesa_tace
    engine = con_carte
    scendi(engine, "a-1", "MISTERO")
    fronte!(engine)
    assert engine.judge(attacco("a-1"))[:ok], "carta fuori anagrafe: l'attesa non accusa"

    muto = Rubyfront::Engine.new
    scendi(muto, "a-1", "LENTA")
    fronte!(muto)
    assert muto.judge(attacco("a-1"))[:ok], "senza anagrafe: l'attesa non accusa"
  end

  def test_dopo_uno_snapshot_non_accusa
    engine = con_carte
    engine.snapshot({
      "turn" => 5, "active" => "a",
      "cards" => { "a-1" => { "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "LENTA" } },
    })
    fronte!(engine)
    verdict = engine.judge(attacco("a-1"))
    assert verdict[:ok], "lo snapshot non dice quando la carta è scesa: nel dubbio, via libera"
  end

  def test_il_blocco_non_e_soggetto_all_attesa
    engine = con_carte
    scendi(engine, "a-1", "LENTA")
    difesa!(engine)
    assert engine.judge(dichiarazione("a-1", "b-9", "block"))[:ok], "§6.2: appena scesa può già bloccare nel turno avversario"
  end

  # --- §6.3: tappate, coperte, sfide 1 contro 1 --------------------------

  def dichiarazione(from, to, kind)
    { "t" => "declare",
      "declaration" => { "id" => "x", "from" => from, "to" => to, "kind" => kind, "seat" => "a", "order" => 0 } }
  end

  def test_una_tappata_non_attacca
    engine = con_carte
    scendi(engine, "a-1", "SCATTANTE")
    fronte!(engine)
    engine.judge({ "t" => "tap", "uid" => "a-1", "tapped" => true })
    verdict = engine.judge(attacco("a-1"))
    refute verdict[:ok]
    assert_match(/tappata.*attaccare/, verdict[:reason])
  end

  def test_una_tappata_non_blocca
    engine = con_carte
    scendi(engine, "a-1", "LENTA")
    difesa!(engine)
    engine.judge({ "t" => "tap", "uid" => "a-1", "tapped" => true })
    verdict = engine.judge(dichiarazione("a-1", "b-9", "block"))
    refute verdict[:ok]
    assert_match(/tappata.*bloccare/, verdict[:reason])
  end

  def test_una_coperta_non_fa_nulla
    engine = con_carte
    scendi(engine, "a-1", "SCATTANTE")
    fronte!(engine)
    engine.judge({ "t" => "facedown", "uid" => "a-1", "facedown" => true })
    refute engine.judge(attacco("a-1"))[:ok]
    refute engine.judge(dichiarazione("a-1", "b-9", "counter"))[:ok]
  end

  # Due bloccanti al posto A, già calati sul campo per la via pubblica:
  # un solo loadDeck (il secondo azzererebbe il posto), poi due toZone.
  def due_bloccanti(engine)
    cards = [
      { "uid" => "a-1", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "LENTA" },
      { "uid" => "a-2", "owner" => "a", "zone" => "hand", "order" => 1, "cardId" => "LENTA" },
    ]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "field" })
    engine.judge({ "t" => "toZone", "uid" => "a-2", "zone" => "field" })
  end

  def test_un_attaccante_ha_un_solo_bloccante
    engine = con_carte
    due_bloccanti(engine)
    difesa!(engine)
    assert engine.judge(dichiarazione("a-1", "b-9", "block"))[:ok]
    verdict = engine.judge(dichiarazione("a-2", "b-9", "counter"))
    refute verdict[:ok]
    assert_match(/1 contro 1/, verdict[:reason])
  end

  def test_annullato_il_blocco_l_attaccante_torna_libero
    engine = con_carte
    due_bloccanti(engine)
    difesa!(engine)
    engine.judge(dichiarazione("a-1", "b-9", "block"))
    engine.judge({ "t" => "undeclare", "from" => "a-1" })
    assert engine.judge(dichiarazione("a-2", "b-9", "block"))[:ok]
  end

  def test_il_bloccante_uscito_dal_campo_libera_l_attaccante
    engine = con_carte
    due_bloccanti(engine)
    difesa!(engine)
    engine.judge(dichiarazione("a-1", "b-9", "block"))
    engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
    assert engine.judge(dichiarazione("a-2", "b-9", "block"))[:ok]
  end

  def test_sgomberato_il_combattimento_si_riparte
    engine = con_carte
    due_bloccanti(engine)
    difesa!(engine)
    engine.judge(dichiarazione("a-1", "b-9", "block"))
    engine.judge({ "t" => "clearCombat" })
    # Sgomberato tutto, anche l'attacco: un blocco vuole un'ondata nuova.
    refute engine.judge(dichiarazione("a-2", "b-9", "block"))[:ok]
    engine.observe(dichiarazione("b-9", "rf-a", "attack"))
    assert engine.judge(dichiarazione("a-2", "b-9", "block"))[:ok]
  end

  # --- §6.2: Fronte pieno (massimo 5 Entità) -----------------------------

  # Una mano piena di carte al posto voluto, poi le prime `cala` sul campo.
  def mano_e_campo(engine, ids, cala:, seat: "a")
    cards = ids.each_with_index.map do |card_id, index|
      { "uid" => "#{seat}-#{index + 1}", "owner" => seat, "zone" => "hand", "order" => index, "cardId" => card_id }
    end
    engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    (1..cala).each { |n| engine.judge({ "t" => "toZone", "uid" => "#{seat}-#{n}", "zone" => "field" }) }
  end

  def test_la_sesta_entita_non_scende
    engine = con_carte
    mano_e_campo(engine, ["LENTA"] * 6, cala: 5)
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-6", "zone" => "field" })
    refute verdict[:ok]
    assert_match(/Fronte è pieno/, verdict[:reason])
    # Rifiutata: la copia non l'ha applicata — riprovare rifiuta ancora
    # (se fosse scesa, il secondo tentativo sarebbe uno spostamento non giudicato).
    refute engine.judge({ "t" => "toZone", "uid" => "a-6", "zone" => "field" })[:ok]
  end

  def test_materie_e_rubyfront_non_occupano_slot
    engine = con_carte
    mano_e_campo(engine, ["LENTA"] * 5 + ["PIETRA", "RUBINO"], cala: 5)
    assert engine.judge({ "t" => "toZone", "uid" => "a-6", "zone" => "field" })[:ok], "la Materia scende anche a Fronte pieno"
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-7", "zone" => "field" })
    refute verdict[:ruled], "il Rubyfront non è un'Entità: nessun giudizio"
  end

  def test_lo_spostamento_sul_campo_non_e_un_ingresso
    engine = con_carte
    mano_e_campo(engine, ["LENTA"] * 5, cala: 5)
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "field" })
    refute verdict[:ruled], "riposare una carta già in campo non conta"
  end

  def test_il_fronte_avversario_e_un_altro_fronte
    engine = con_carte
    mano_e_campo(engine, ["LENTA"] * 5, cala: 5)
    mano_e_campo(engine, ["LENTA"], cala: 0, seat: "b")
    assert engine.judge({ "t" => "toZone", "uid" => "b-1", "zone" => "field" })[:ok], "i 5 slot sono per giocatore"
  end

  def test_uno_slot_liberato_riapre_il_fronte
    engine = con_carte
    mano_e_campo(engine, ["LENTA"] * 6, cala: 5)
    engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
    assert engine.judge({ "t" => "toZone", "uid" => "a-6", "zone" => "field" })[:ok]
  end

  def test_carta_ignota_il_fronte_tace
    engine = con_carte
    mano_e_campo(engine, ["LENTA"] * 5 + ["MISTERO"], cala: 5)
    refute engine.judge({ "t" => "toZone", "uid" => "a-6", "zone" => "field" })[:ruled]
  end

  # --- §3.1: l'assegnazione degli Oggetti --------------------------------

  # Un tavolo apparecchiato: a-1 Entità, a-2 Oggetto, a-3 Materia, a-4
  # seconda Entità (tutti di A, in campo), b-1 Entità di B in campo.
  def tavolo_con_oggetto(engine)
    mano_e_campo(engine, %w[LENTA FERRO PIETRA LENTA RUBINO], cala: 5)
    mano_e_campo(engine, %w[LENTA], cala: 1, seat: "b")
  end

  def assegna(object, to)
    { "t" => "assign", "uid" => object, "to" => to }
  end

  def test_l_oggetto_si_assegna_alla_propria_entita
    engine = con_carte
    tavolo_con_oggetto(engine)
    verdict = engine.judge(assegna("a-2", "a-1"))
    assert verdict[:ruled]
    assert verdict[:ok]
  end

  def test_non_al_rubyfront_ne_a_una_materia
    engine = con_carte
    tavolo_con_oggetto(engine)
    refute engine.judge(assegna("a-2", "a-5"))[:ok], "a-5 è il Rubyfront"
    refute engine.judge(assegna("a-2", "a-3"))[:ok], "a-3 è una Materia"
  end

  def test_non_a_un_entita_avversaria
    engine = con_carte
    tavolo_con_oggetto(engine)
    verdict = engine.judge(assegna("a-2", "b-1"))
    refute verdict[:ok]
    assert_match(/proprie Entità/, verdict[:reason])
  end

  def test_non_a_una_coperta
    engine = con_carte
    tavolo_con_oggetto(engine)
    engine.judge({ "t" => "facedown", "uid" => "a-1", "facedown" => true })
    refute engine.judge(assegna("a-2", "a-1"))[:ok]
  end

  def test_una_volta_assegnato_non_si_sposta
    engine = con_carte
    tavolo_con_oggetto(engine)
    engine.judge(assegna("a-2", "a-1"))
    verdict = engine.judge(assegna("a-2", "a-4"))
    refute verdict[:ok]
    assert_match(/non si sposta/, verdict[:reason])
    assert engine.judge(assegna("a-2", "a-1"))[:ok], "ribadire la stessa assegnazione non è uno spostamento"
  end

  def test_l_entita_uscita_scioglie_l_oggetto
    engine = con_carte
    tavolo_con_oggetto(engine)
    engine.judge(assegna("a-2", "a-1"))
    engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
    assert engine.judge(assegna("a-2", "a-4"))[:ok], "sciolto: si può riassegnare"
  end

  def test_scioglimento_e_carte_ignote_non_giudicati
    engine = con_carte
    tavolo_con_oggetto(engine)
    engine.judge(assegna("a-2", "a-1"))
    refute engine.judge({ "t" => "assign", "uid" => "a-2", "to" => nil })[:ruled]
    mano_e_campo(engine, %w[MISTERO LENTA], cala: 2, seat: "b")
    refute engine.judge(assegna("b-1", "b-2"))[:ruled], "Oggetto ignoto all'anagrafe: silenzio"
  end

  # --- §6: le fasi del turno ---------------------------------------------

  def test_in_preparazione_non_si_dichiara
    engine = con_carte
    scendi(engine, "a-1", "SCATTANTE")
    verdict = engine.judge(attacco("a-1"))
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/Fase di Fronte/, verdict[:reason])
  end

  def test_la_dogana_vale_anche_per_i_blocchi
    engine = con_carte
    due_bloccanti(engine)
    refute engine.judge(dichiarazione("a-1", "b-9", "block"))[:ok]
    refute engine.judge(dichiarazione("a-2", "b-9", "counter"))[:ok]
  end

  def test_la_fase_non_torna_indietro
    engine = con_carte
    fronte!(engine)
    verdict = engine.judge({ "t" => "phase", "phase" => "preparazione" })
    refute verdict[:ok]
    assert_match(/senso unico/, verdict[:reason])
  end

  def test_il_cambio_turno_riporta_in_preparazione
    engine = con_carte
    scendi(engine, "a-1", "SCATTANTE")
    fronte!(engine)
    assert engine.judge(attacco("a-1"))[:ok]
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    refute engine.judge(attacco("a-1"))[:ok], "turno nuovo: si riparte dalla Preparazione"
  end

  def test_il_contatore_ritoccato_non_tocca_la_fase
    engine = con_carte
    scendi(engine, "a-1", "SCATTANTE")
    fronte!(engine)
    engine.judge({ "t" => "turn", "turn" => 9, "active" => "a" })
    assert engine.judge(attacco("a-1"))[:ok], "active invariato: la fase resta Fronte"
  end

  def test_lo_snapshot_porta_la_fase
    campo = { "a-1" => { "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "SCATTANTE" } }
    engine = con_carte
    engine.snapshot({ "turn" => 3, "active" => "a", "phase" => "fronte", "cards" => campo })
    assert engine.judge(attacco("a-1"))[:ok]
    engine.snapshot({ "turn" => 3, "active" => "a", "cards" => campo })
    refute engine.judge(attacco("a-1"))[:ok], "senza fase nello snapshot si riparte dalla Preparazione"
  end

  def test_fase_ignota_nessuna_regola
    refute @engine.judge({ "t" => "phase", "phase" => "boh" })[:ruled]
  end

  # --- §6.2: il Ritiro -----------------------------------------------------

  def ritira(uid)
    { "t" => "toZone", "uid" => uid, "zone" => "ritiro" }
  end

  # L'Entità è in campo dal turno scorso: il turno gira e torna ad A.
  def giro_di_turno(engine)
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
  end

  def test_in_preparazione_l_entita_si_ritira
    engine = con_carte
    scendi(engine, "a-1", "LENTA")
    giro_di_turno(engine)
    verdict = engine.judge(ritira("a-1"))
    assert verdict[:ruled]
    assert verdict[:ok]
  end

  def test_nel_turno_d_ingresso_non_si_ritira_e_lo_slancio_non_aggira
    engine = con_carte
    scendi(engine, "a-1", "SCATTANTE")
    verdict = engine.judge(ritira("a-1"))
    refute verdict[:ok]
    assert_match(/Slancio non aggira/, verdict[:reason])
  end

  def test_a_fronte_dichiarato_non_si_ritira
    engine = con_carte
    scendi(engine, "a-1", "LENTA")
    giro_di_turno(engine)
    fronte!(engine)
    verdict = engine.judge(ritira("a-1"))
    refute verdict[:ok]
    assert_match(/Preparazione/, verdict[:reason])
  end

  def test_tappata_o_coperta_non_si_ritira
    engine = con_carte
    scendi(engine, "a-1", "LENTA")
    giro_di_turno(engine)
    engine.judge({ "t" => "tap", "uid" => "a-1", "tapped" => true })
    assert_match(/tappata/, engine.judge(ritira("a-1"))[:reason])
    engine.judge({ "t" => "tap", "uid" => "a-1", "tapped" => false })
    engine.judge({ "t" => "facedown", "uid" => "a-1", "facedown" => true })
    assert_match(/coperta/, engine.judge(ritira("a-1"))[:reason])
  end

  def test_il_rubyfront_non_si_ritira
    engine = con_carte
    scendi(engine, "a-1", "RUBINO")
    giro_di_turno(engine)
    verdict = engine.judge(ritira("a-1"))
    refute verdict[:ok]
    assert_match(/resta in campo/, verdict[:reason])
  end

  def test_materie_e_carte_ignote_il_ritiro_tace
    engine = con_carte
    scendi(engine, "a-1", "PIETRA")
    giro_di_turno(engine)
    refute engine.judge(ritira("a-1"))[:ruled]
    scendi(engine, "a-1", "MISTERO")
    giro_di_turno(engine)
    refute engine.judge(ritira("a-1"))[:ruled]
  end

  def test_l_entita_avversaria_in_ritiro_e_un_effetto
    engine = con_carte
    mano_e_campo(engine, %w[LENTA], cala: 1, seat: "b")
    # Entrata questo turno, eppure silenzio: nel turno di A un'Entità di B
    # mandata in Ritiro è la risoluzione a mano di un effetto, non un ritiro.
    refute engine.judge(ritira("b-1"))[:ruled]
  end

  def test_dalla_mano_al_ritiro_nessuna_regola
    engine = con_carte
    mano_e_campo(engine, %w[LENTA], cala: 0)
    refute engine.judge(ritira("a-1"))[:ruled]
  end

  def test_dopo_uno_snapshot_il_ritiro_non_accusa
    engine = con_carte
    engine.snapshot({
      "turn" => 5, "active" => "a",
      "cards" => { "a-1" => { "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "LENTA" } },
    })
    assert engine.judge(ritira("a-1"))[:ok], "lo snapshot non dice quando è scesa: nel dubbio, via libera"
  end

  # --- §5: le Materie mai sugli slot del Fronte ---------------------------

  def gioca(uid, x, y)
    { "t" => "toZone", "uid" => uid, "zone" => "field", "x" => x, "y" => y }
  end

  def test_la_materia_sullo_slot_del_fronte_viene_fermata
    engine = con_carte
    mano_e_campo(engine, %w[PIETRA], cala: 0)
    verdict = engine.judge(gioca("a-1", 442, 1236))
    refute verdict[:ok]
    assert_match(/spazio delle Materie/, verdict[:reason])
  end

  def test_il_divieto_copre_entrambe_le_file_del_fronte
    engine = con_carte
    mano_e_campo(engine, %w[PIETRA], cala: 0, seat: "b")
    refute engine.judge(gioca("b-1", 1956, 172))[:ok]
  end

  def test_fuori_dagli_slot_la_materia_scende_senza_regola
    engine = con_carte
    mano_e_campo(engine, %w[PIETRA], cala: 0)
    refute engine.judge(gioca("a-1", 2368, 1236))[:ruled], "la fila delle Materie non è affare dell'engine"
    mano_e_campo(engine, %w[PIETRA], cala: 0)
    refute engine.judge(gioca("a-1", 500, 900))[:ruled], "rilascio a mano libera: lavagna libera"
  end

  def test_l_entita_sullo_slot_scende_regolarmente
    engine = con_carte
    mano_e_campo(engine, %w[LENTA], cala: 0)
    assert engine.judge(gioca("a-1", 442, 1236))[:ok]
  end

  def test_carta_ignota_sullo_slot_silenzio
    engine = con_carte
    mano_e_campo(engine, %w[MISTERO], cala: 0)
    refute engine.judge(gioca("a-1", 442, 1236))[:ruled]
  end

  # --- §6.3: dichiarano solo le Entità ------------------------------------

  def test_il_rubyfront_non_attacca
    engine = con_carte
    scendi(engine, "a-1", "RUBINO")
    fronte!(engine)
    verdict = engine.judge(attacco("a-1"))
    refute verdict[:ok]
    assert_match(/Rubyfront non attacca/, verdict[:reason])
  end

  def test_il_rubyfront_non_blocca
    engine = con_carte
    scendi(engine, "a-1", "RUBINO")
    fronte!(engine)
    refute engine.judge(dichiarazione("a-1", "b-9", "block"))[:ok]
    refute engine.judge(dichiarazione("a-1", "b-9", "counter"))[:ok]
  end

  def test_gli_oggetti_non_dichiarano
    engine = con_carte
    scendi(engine, "a-1", "FERRO")
    difesa!(engine)
    verdict = engine.judge(dichiarazione("a-1", "b-9", "block"))
    refute verdict[:ok]
    assert_match(/solo le Entità/, verdict[:reason])
  end

  def test_il_tipo_si_giudica_prima_dello_stato
    engine = con_carte
    scendi(engine, "a-1", "RUBINO")
    fronte!(engine)
    engine.judge({ "t" => "tap", "uid" => "a-1", "tapped" => true })
    # Un Rubyfront tappato non è «una tappata»: il rifiuto parla di lui.
    assert_match(/Rubyfront/, engine.judge(attacco("a-1"))[:reason])
  end

  def test_carta_ignota_dichiara_senza_dogana_del_tipo
    muto = Rubyfront::Engine.new
    scendi(muto, "a-1", "RUBINO")
    fronte!(muto)
    assert muto.judge(attacco("a-1"))[:ok], "senza anagrafe il tipo non si vede: via libera"
  end

  # --- §6.3: attacca chi è di turno, blocca chi difende --------------------

  def test_non_si_attacca_nel_turno_avversario
    engine = con_carte
    scendi(engine, "a-1", "SCATTANTE")
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    fronte!(engine)
    verdict = engine.judge(attacco("a-1"))
    refute verdict[:ok]
    assert_match(/proprio turno/, verdict[:reason])
  end

  def test_chi_e_di_turno_non_blocca
    engine = con_carte
    scendi(engine, "a-1", "SCATTANTE")
    fronte!(engine)
    engine.observe(attacco("a-1"))
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    verdict = engine.judge(dichiarazione("a-1", "b-9", "block"))
    refute verdict[:ok]
    assert_match(/chi difende/, verdict[:reason])
    refute engine.judge(dichiarazione("a-1", "b-9", "counter"))[:ok]
  end

  def test_il_blocco_vuole_un_attaccante_vero
    engine = con_carte
    scendi(engine, "a-1", "SCATTANTE")
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    fronte!(engine)
    engine.observe(dichiarazione("b-8", "rf-a", "attack"))
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    # Nessun attacco dichiarato da b-9: la freccia non avrebbe senso.
    verdict = engine.judge(dichiarazione("a-1", "b-9", "block"))
    refute verdict[:ok]
    assert_match(/non sta attaccando/, verdict[:reason])
  end

  def test_la_difesa_regolare_passa
    engine = con_carte
    scendi(engine, "a-1", "SCATTANTE")
    difesa!(engine)
    assert engine.judge(dichiarazione("a-1", "b-9", "counter"))[:ok]
  end

  # --- §6.4: la Reazione — l'ondata passa al difensore ---------------------

  def test_in_reazione_niente_nuovi_attacchi
    engine = con_carte
    scendi(engine, "a-1", "SCATTANTE")
    fronte!(engine)
    assert engine.judge(attacco("a-1"))[:ok]
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    verdict = engine.judge(attacco("a-1"))
    refute verdict[:ok]
    assert_match(/niente nuovi attacchi/, verdict[:reason])
  end

  def test_i_blocchi_aspettano_la_reazione
    engine = con_carte
    scendi(engine, "a-1", "LENTA")
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    fronte!(engine)
    engine.observe(dichiarazione("b-9", "rf-a", "attack"))
    # Ondata in corso, parola non ancora passata: il blocco aspetta.
    verdict = engine.judge(dichiarazione("a-1", "b-9", "block"))
    refute verdict[:ok]
    assert_match(/ondata completa/, verdict[:reason])
  end

  def test_il_turno_non_si_chiude_sopra_l_ondata
    engine = con_carte
    scendi(engine, "a-1", "SCATTANTE")
    fronte!(engine)
    engine.judge(attacco("a-1"))
    verdict = engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    refute verdict[:ok]
    assert_match(/passa al difensore/, verdict[:reason])
    # Passata la parola, il turno si chiude: quanto aspettare la difesa è
    # affare del tavolo (via semplice, niente stretta di mano).
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })[:ok]
  end

  def test_senza_ondata_il_fronte_si_chiude_liberamente
    engine = con_carte
    scendi(engine, "a-1", "SCATTANTE")
    fronte!(engine)
    assert engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })[:ok], "il passo non trattiene il turno"
  end

  def test_la_reazione_si_apre_solo_dal_fronte
    engine = con_carte
    verdict = engine.judge({ "t" => "phase", "phase" => "reazione" })
    refute verdict[:ok]
    assert_match(/si apre dal Fronte/, verdict[:reason])
    fronte!(engine)
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    refute engine.judge({ "t" => "phase", "phase" => "fronte" })[:ok], "dalla Reazione non si torna al Fronte"
  end

  # --- §6.3/§6.4: la risoluzione delle battaglie ---------------------------

  POTENZE = {
    "FORTE" => { type: "entity", keywords: [], power: 4, counterattack: nil },
    "DEBOLE" => { type: "entity", keywords: [], power: 2, counterattack: nil },
    "PARI" => { type: "entity", keywords: [], power: 4, counterattack: nil },
    "SPINOSO" => { type: "entity", keywords: [], power: 3, counterattack: 2 },
    "RUBINO" => { type: "rubyfront", keywords: [], power: nil, counterattack: nil },
  }.freeze

  # Un tavolo apparecchiato per l'ondata: le carte di A e di B già in campo
  # (scese al turno 1, così al turno 3 l'attesa di evocazione è passata),
  # tocca ad A in Reazione. `attacks` e `blocks` sono [uid, ...] e
  # [[bloccante, attaccante, kind], ...].
  def ondata(a_cards, b_cards, attacks, blocks)
    engine = Rubyfront::Engine.new(cards: POTENZE)
    load = lambda do |seat, cards|
      list = cards.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => seat, "zone" => "field", "order" => i, "cardId" => id } }
      engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => list })
    end
    load.call("a", a_cards)
    load.call("b", b_cards)
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    fronte!(engine)
    attacks.each_with_index do |uid, i|
      verdict = engine.judge({ "t" => "declare", "declaration" => { "id" => uid, "from" => uid, "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => i + 1 } })
      raise "attacco rifiutato: #{verdict[:reason]}" unless verdict[:ok]
    end
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    blocks.each do |from, to, kind|
      verdict = engine.judge({ "t" => "declare", "declaration" => { "id" => from, "from" => from, "to" => to, "kind" => kind, "seat" => "b", "order" => 0 } })
      raise "blocco rifiutato: #{verdict[:reason]}" unless verdict[:ok]
    end
    engine
  end

  def battaglia(attacker, blocker: nil, kind: "unblocked", attacker_dies: false, blocker_dies: false, damage: 0)
    { "attacker" => attacker, "blocker" => blocker, "kind" => kind,
      "attackerDies" => attacker_dies, "blockerDies" => blocker_dies, "damage" => damage }.compact
  end

  def risolvi(engine, battles, seat: "a")
    engine.judge({ "t" => "resolve", "seat" => seat, "battles" => battles })
  end

  def test_non_bloccato_fa_danni_pari_alla_potenza
    engine = ondata([["a1", "FORTE"]], [], ["a1"], [])
    verdict = risolvi(engine, [battaglia("a1", damage: 4)])
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
  end

  def test_bloccante_inferiore_muore_e_l_attacco_e_bloccato
    engine = ondata([["a1", "FORTE"]], [["b1", "DEBOLE"]], ["a1"], [["b1", "a1", "block"]])
    verdict = risolvi(engine, [battaglia("a1", blocker: "b1", kind: "block", blocker_dies: true)])
    assert verdict[:ok], verdict[:reason]
    assert_equal "abisso", engine.instance_variable_get(:@table).card("b1")[:zone], "col sì la copia applica"
  end

  def test_potenze_pari_muoiono_entrambi
    engine = ondata([["a1", "FORTE"]], [["b1", "PARI"]], ["a1"], [["b1", "a1", "block"]])
    verdict = risolvi(engine, [battaglia("a1", blocker: "b1", kind: "block", attacker_dies: true, blocker_dies: true)])
    assert verdict[:ok], verdict[:reason]
  end

  def test_bloccante_superiore_non_muore_nessuno
    engine = ondata([["a1", "DEBOLE"]], [["b1", "FORTE"]], ["a1"], [["b1", "a1", "block"]])
    verdict = risolvi(engine, [battaglia("a1", blocker: "b1", kind: "block")])
    assert verdict[:ok], verdict[:reason]
  end

  def test_contrattacco_superiore_uccide_l_attaccante
    # 3 + 2 = 5 > 4
    engine = ondata([["a1", "FORTE"]], [["b1", "SPINOSO"]], ["a1"], [["b1", "a1", "counter"]])
    verdict = risolvi(engine, [battaglia("a1", blocker: "b1", kind: "counter", attacker_dies: true)])
    assert verdict[:ok], verdict[:reason]
  end

  def test_un_esito_sbagliato_viene_fermato
    engine = ondata([["a1", "DEBOLE"]], [["b1", "FORTE"]], ["a1"], [["b1", "a1", "block"]])
    verdict = risolvi(engine, [battaglia("a1", blocker: "b1", kind: "block", blocker_dies: true)])
    assert verdict[:ruled]
    refute verdict[:ok], "il bloccante superiore non muore (§6.3)"
    assert_match(/§6\.3.*battaglia 1/, verdict[:reason])
    assert_equal "field", engine.instance_variable_get(:@table).card("b1")[:zone], "col no la copia non si tocca"
  end

  def test_le_battaglie_vanno_nell_ordine_di_dichiarazione
    engine = ondata([["a1", "FORTE"], ["a2", "DEBOLE"]], [], %w[a2 a1], [])
    giusto = [battaglia("a2", damage: 2), battaglia("a1", damage: 4)]
    refute risolvi(engine, giusto.reverse)[:ok], "l'ordine è quello di dichiarazione (§6.4)"
    assert risolvi(engine, giusto)[:ok]
  end

  def test_si_risolve_solo_in_reazione
    engine = ondata([["a1", "FORTE"]], [], [], [])
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    verdict = risolvi(engine, [], seat: "b")
    refute verdict[:ok]
    assert_match(/§6\.4/, verdict[:reason])
  end

  def test_risolve_chi_e_di_turno
    engine = ondata([["a1", "FORTE"]], [], ["a1"], [])
    verdict = risolvi(engine, [battaglia("a1", damage: 4)], seat: "b")
    refute verdict[:ok]
    assert_match(/di turno/, verdict[:reason])
  end

  def test_carta_ignota_all_anagrafe_niente_regola
    engine = ondata([["a1", "MISTERO"]], [], [], [])
    engine.observe({ "t" => "declare", "declaration" => { "from" => "a1", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 } })
    verdict = risolvi(engine, [battaglia("a1", damage: 9)])
    assert verdict[:ok]
    refute verdict[:ruled], "senza la Potenza il conto non si rifà: silenzio"
  end

  # --- §6.2: le carte si giocano in Preparazione ---------------------------

  FINESTRA = {
    "LENTA" => { type: "entity", keywords: [] },
    "PIETRA" => { type: "matter", keywords: [], behavior: "normal" },
    "SCINTILLA" => { type: "matter", keywords: [], behavior: "reactive" },
    "RUBINO" => { type: "rubyfront", keywords: [] },
    "FERRO" => { type: "object", keywords: [] },
  }.freeze

  # Una carta in mano al posto `seat`, pronta a scendere.
  def in_mano(engine, seat, uid, card_id)
    cards = [{ "uid" => uid, "owner" => seat, "zone" => "hand", "order" => 0, "cardId" => card_id }]
    engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
  end

  # Senza coordinate l'ingresso non ha forma da giudicare (§5): i test che
  # vogliono uno slot lo dicono.
  def scendi_in_campo(engine, uid, x: nil, y: nil)
    action = { "t" => "toZone", "uid" => uid, "zone" => "field" }
    action["x"] = x unless x.nil?
    action["y"] = y unless y.nil?
    engine.judge(action)
  end

  def test_in_preparazione_si_gioca
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "a", "a-1", "LENTA")
    assert scendi_in_campo(engine, "a-1")[:ok]
  end

  def test_nel_fronte_un_entita_non_scende
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "a", "a-1", "LENTA")
    fronte!(engine)
    verdict = scendi_in_campo(engine, "a-1")
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/Fronte.*§6\.2/, verdict[:reason])
  end

  def test_nel_fronte_nemmeno_materie_normali_e_oggetti
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "a", "a-1", "PIETRA")
    in_mano(engine, "b", "b-1", "FERRO")
    fronte!(engine)
    refute scendi_in_campo(engine, "a-1")[:ok]
    refute scendi_in_campo(engine, "b-1")[:ok], "nel turno altrui non è Preparazione di nessuno"
  end

  def test_nel_fronte_le_reattive_scendono
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "b", "b-1", "SCINTILLA")
    fronte!(engine)
    verdict = scendi_in_campo(engine, "b-1")
    assert verdict[:ok], "le Reattive si giocano solo in Fase di Fronte (§7.2)"
  end

  def test_le_reattive_non_scendono_in_preparazione_nemmeno_nel_proprio_turno
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "a", "a-1", "SCINTILLA")
    verdict = scendi_in_campo(engine, "a-1")
    refute verdict[:ok]
    assert_match(/§7\.2/, verdict[:reason])
  end

  def test_il_rubyfront_si_schiera_anche_dopo_gli_attacchi
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "a", "rf-a", "RUBINO")
    fronte!(engine)
    assert scendi_in_campo(engine, "rf-a")[:ok], "finestra di movimento: tutto il proprio turno (§3.1)"
  end

  def test_in_reazione_non_si_gioca
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "a", "a-1", "LENTA")
    fronte!(engine)
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    verdict = scendi_in_campo(engine, "a-1")
    refute verdict[:ok]
    assert_match(/Reazione/, verdict[:reason])
  end

  def test_carta_ignota_nel_fronte_niente_regola
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "a", "a-1", "MISTERO")
    fronte!(engine)
    verdict = scendi_in_campo(engine, "a-1")
    assert verdict[:ok]
    refute verdict[:ruled]
  end

  def test_col_cambio_di_turno_si_torna_a_giocare
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "b", "b-1", "LENTA")
    fronte!(engine)
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert scendi_in_campo(engine, "b-1")[:ok]
  end

  # --- §6: nel turno altrui non si agisce ----------------------------------

  def altrui
    Rubyfront::Engine.new(cards: FINESTRA)
  end

  def test_senza_attore_la_dogana_del_turno_tace
    verdict = altrui.judge({ "t" => "draw", "seat" => "b", "count" => 1 })
    refute verdict[:ruled]
  end

  def test_chi_e_di_turno_agisce
    verdict = altrui.judge({ "t" => "draw", "seat" => "a", "count" => 1 }, actor: "a")
    assert verdict[:ok]
  end

  def test_l_avversario_non_pesca_nel_mio_turno
    engine = altrui
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    verdict = engine.judge({ "t" => "draw", "seat" => "b", "count" => 1 }, actor: "b")
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/non tocca a te.*§6/, verdict[:reason])
  end

  def test_apparecchiare_non_ha_turno
    engine = altrui
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    assert engine.judge({ "t" => "player", "seat" => "b", "patch" => { "name" => "Ajmal" } }, actor: "b")[:ok], "il nome non è un gesto di gioco"
    refute engine.judge({ "t" => "player", "seat" => "b", "patch" => { "name" => "Ajmal", "hp" => 3 } }, actor: "b")[:ok], "coi contatori sì (in Preparazione altrui)"
    fronte!(engine)
    cards = [{ "uid" => "b-1", "owner" => "b", "zone" => "deck", "order" => 0, "cardId" => "LENTA" }]
    assert engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => cards }, actor: "b")[:ok], "il mazzo si carica all'ingresso, nel turno di chiunque"
    assert engine.judge({ "t" => "say", "entry" => {} }, actor: "b")[:ok]
    assert engine.judge({ "t" => "newGame" }, actor: "b")[:ok], "Nuova partita è di entrambi"
  end

  def test_prima_del_primo_turno_anche_l_altro_apparecchia_il_mazzo
    # §4: mano iniziale e mulligan di chi NON apre, al turno 1 in Preparazione.
    engine = altrui
    in_mano(engine, "b", "b-1", "LENTA")
    assert engine.judge({ "t" => "draw", "seat" => "b", "count" => 6 }, actor: "b")[:ok], "la mano iniziale"
    assert engine.judge({ "t" => "shuffle", "seat" => "b", "order" => [] }, actor: "b")[:ok], "il mulligan mescola"
    assert engine.judge({ "t" => "toZone", "uid" => "b-1", "zone" => "deck" }, actor: "b")[:ok], "la mano torna nel mazzo"
    refute engine.judge({ "t" => "toZone", "uid" => "b-1", "zone" => "field" }, actor: "b")[:ok], "ma in campo no"
    fronte!(engine)
    refute engine.judge({ "t" => "draw", "seat" => "b", "count" => 1 }, actor: "b")[:ok], "chiusa la Preparazione del turno 1, finestra chiusa"
  end

  def test_l_avversario_non_gioca_un_entita_nel_mio_turno
    engine = altrui
    in_mano(engine, "b", "b-1", "LENTA")
    verdict = engine.judge({ "t" => "toZone", "uid" => "b-1", "zone" => "field" }, actor: "b")
    refute verdict[:ok]
  end

  def test_l_avversario_gioca_una_reattiva_nel_mio_fronte
    engine = altrui
    in_mano(engine, "b", "b-1", "SCINTILLA")
    fronte!(engine)
    verdict = engine.judge({ "t" => "toZone", "uid" => "b-1", "zone" => "field" }, actor: "b")
    assert verdict[:ok], "Pre-Fronte: l'avversario può giocare Reattive (§6.3, §7.2)"
  end

  def test_l_avversario_non_gioca_reattive_in_preparazione
    engine = altrui
    in_mano(engine, "b", "b-1", "SCINTILLA")
    verdict = engine.judge({ "t" => "toZone", "uid" => "b-1", "zone" => "field" }, actor: "b")
    refute verdict[:ok], "le Reattive si giocano solo in Fase di Fronte (§7.2)"
  end

  def test_l_avversario_blocca_in_reazione
    engine = ondata([["a1", "FORTE"]], [["b1", "DEBOLE"]], ["a1"], [])
    blocco = { "t" => "declare", "declaration" => { "id" => "b1", "from" => "b1", "to" => "a1", "kind" => "block", "seat" => "b", "order" => 0 } }
    verdict = engine.judge(blocco, actor: "b")
    assert verdict[:ok], verdict[:reason]
    assert engine.judge({ "t" => "undeclare", "from" => "b1" }, actor: "b")[:ok], "e può ripensarci"
  end

  def test_l_avversario_non_cambia_fase_ne_turno
    engine = altrui
    refute engine.judge({ "t" => "phase", "phase" => "fronte" }, actor: "b")[:ok]
    refute engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" }, actor: "b")[:ok]
    assert engine.judge({ "t" => "phase", "phase" => "fronte" }, actor: "a")[:ok]
  end

  def test_l_avversario_paga_il_flusso_solo_in_fronte_e_reazione
    engine = altrui
    paga = { "t" => "player", "seat" => "b", "patch" => { "flux" => 1 } }
    refute engine.judge(paga, actor: "b")[:ok], "in Preparazione altrui i contatori non si toccano"
    fronte!(engine)
    assert engine.judge(paga, actor: "b")[:ok], "nel Fronte si pagano le Reattive"
  end

  def test_l_avversario_non_ritocca_i_miei_contatori
    engine = altrui
    fronte!(engine)
    refute engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 10 } }, actor: "b")[:ok]
  end

  def test_in_reazione_risolve_e_chiude_chi_difende
    engine = ondata([["a1", "FORTE"]], [], ["a1"], [])
    da_a = engine.judge({ "t" => "resolve", "seat" => "a", "battles" => [battaglia("a1", damage: 4)] }, actor: "a")
    refute da_a[:ok], "chi attacca aspetta la reazione (§6.4)"
    assert_match(/chiude chi difende/, da_a[:reason])
    refute engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" }, actor: "a")[:ok]
    da_b = engine.judge({ "t" => "resolve", "seat" => "a", "battles" => [battaglia("a1", damage: 4)] }, actor: "b")
    assert da_b[:ok], da_b[:reason]
    assert engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" }, actor: "b")[:ok]
  end

  def test_fuori_dalla_reazione_chiude_chi_e_di_turno
    engine = altrui
    fronte!(engine)
    refute engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" }, actor: "b")[:ok]
    assert engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" }, actor: "a")[:ok]
  end

  # --- §3.2: le carte si pagano ---------------------------------------------

  COSTI = {
    "CARA" => { type: "entity", keywords: [], flux_cost: 3 },
    "ECONOMICA" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 1 },
    "RUBINO" => { type: "rubyfront", keywords: [] },
    "LENTA" => { type: "entity", keywords: [] },
  }.freeze

  def con_costi(flux)
    engine = Rubyfront::Engine.new(cards: COSTI)
    engine.judge({ "t" => "player", "seat" => "a", "patch" => { "flux" => flux } })
    engine
  end

  def paga(engine, uid, cost)
    action = { "t" => "toZone", "uid" => uid, "zone" => "field" }
    action["cost"] = cost unless cost.nil?
    engine.judge(action)
  end

  def test_con_flusso_sufficiente_si_gioca_e_si_paga
    engine = con_costi(3)
    in_mano(engine, "a", "a-1", "CARA")
    verdict = paga(engine, "a-1", 3)
    assert verdict[:ok], verdict[:reason]
    assert_equal 0, engine.instance_variable_get(:@table).flux("a"), "col sì la copia scala il costo"
  end

  def test_senza_flusso_la_carta_non_scende
    engine = con_costi(2)
    in_mano(engine, "a", "a-1", "CARA")
    verdict = paga(engine, "a-1", 3)
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/Flusso insufficiente.*2.*3.*§3\.2/, verdict[:reason])
  end

  def test_un_costo_che_non_torna_viene_fermato
    engine = con_costi(9)
    in_mano(engine, "a", "a-1", "CARA")
    refute paga(engine, "a-1", 1)[:ok], "pagare meno del costo stampato"
    refute paga(engine, "a-1", nil)[:ok], "non pagare affatto"
    assert_match(/costa 3.*paga 0/, paga(engine, "a-1", nil)[:reason])
  end

  def test_anche_le_materie_si_pagano
    engine = con_costi(0)
    in_mano(engine, "a", "a-1", "ECONOMICA")
    refute paga(engine, "a-1", 1)[:ok]
  end

  def test_da_fuori_mano_non_si_paga
    engine = con_costi(0)
    cards = [{ "uid" => "a-1", "owner" => "a", "zone" => "abisso", "order" => 0, "cardId" => "CARA" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    assert paga(engine, "a-1", nil)[:ok], "dall'Abisso una carta torna per effetto: nessun costo"
  end

  def test_il_rubyfront_non_passa_dalla_dogana_del_costo
    engine = con_costi(0)
    in_mano(engine, "a", "rf-a", "RUBINO")
    assert paga(engine, "rf-a", nil)[:ok]
  end

  def test_carta_senza_costo_in_anagrafe_silenzio
    engine = con_costi(0)
    in_mano(engine, "a", "a-1", "LENTA")
    assert paga(engine, "a-1", nil)[:ok]
  end

  def test_il_gettone_speso_paga_la_carta
    engine = con_costi(20)
    in_mano(engine, "a", "a-1", "CARA")
    engine.judge({ "t" => "player", "seat" => "a", "patch" => { "token" => false, "flux" => 21 } })
    assert paga(engine, "a-1", 3)[:ok]
    assert_equal 18, engine.instance_variable_get(:@table).flux("a")
  end

  # --- §5: la lavagna legata agli slot, e dal campo non si torna indietro ---

  def test_l_entita_scende_su_uno_slot_della_propria_fila
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "a", "a-1", "LENTA")
    assert scendi_in_campo(engine, "a-1", x: 821, y: 1236)[:ok], "slot della fila di A"
    in_mano(engine, "a", "a-2", "LENTA")
    verdict = scendi_in_campo(engine, "a-2", x: 900, y: 1236)
    refute verdict[:ok], "a mano libera no"
    assert_match(/slot.*§5/, verdict[:reason])
    refute scendi_in_campo(engine, "a-2", x: 821, y: 172)[:ok], "nella fila avversaria no"
    assert scendi_in_campo(engine, "a-2")[:ok], "senza coordinate niente da giudicare"
  end

  def test_anche_lo_spostamento_sul_campo_e_legato_agli_slot
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    # Un carico solo: ricaricare il mazzo azzera il posto (test_ricaricare…).
    cards = [["a-1", "LENTA"], ["m-1", "PIETRA"]].map.with_index do |(uid, id), i|
      { "uid" => uid, "owner" => "a", "zone" => "hand", "order" => i, "cardId" => id }
    end
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    scendi_in_campo(engine, "a-1", x: 442, y: 1236)
    scendi_in_campo(engine, "m-1", x: 2368, y: 1236)
    assert engine.judge({ "t" => "move", "uid" => "a-1", "x" => 1199, "y" => 1236, "z" => 3 })[:ok]
    refute engine.judge({ "t" => "move", "uid" => "a-1", "x" => 1000, "y" => 1300, "z" => 3 })[:ok]
    verdict = engine.judge({ "t" => "move", "uid" => "m-1", "x" => 2000, "y" => 1300, "z" => 3 })
    refute verdict[:ruled], "una Materia in campo si sposta liberamente"
  end

  def test_dal_campo_non_si_torna_in_mano_ne_nel_mazzo
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "a", "a-1", "LENTA")
    scendi_in_campo(engine, "a-1", x: 442, y: 1236)
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "hand" })
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/non torna in mano.*§5/, verdict[:reason])
    refute engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "deck" })[:ok]
    assert engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })[:ok], "l'Abisso sì"
  end

  # --- §7: le Materie si giocano solo se abilitate -------------------------

  MATERIE = {
    "UMANO" => { type: "entity", keywords: [], enables: [[{ type: "dynamic", max_grade: 1 }]] },
    "MAESTRO" => { type: "entity", keywords: [], enables: [[{ type: "dynamic", max_grade: 2 }]] },
    "AUROS" => { type: "entity", keywords: [], enables: [[{ type: "dimensional", max_grade: 2 }]] },
    "RUBINO" => { type: "rubyfront", keywords: [],
                  enables: [[{ type: "destructive", max_grade: 1 }], [{ type: "destructive", max_grade: 2 }]] },
    "SCINTILLA" => { type: "matter", keywords: [], behavior: "normal", matter: { type: "dynamic", grade: 1 } },
    "TEMPESTA" => { type: "matter", keywords: [], behavior: "normal", matter: { type: "dynamic", grade: 2 } },
    "ROVINA" => { type: "matter", keywords: [], behavior: "normal", matter: { type: "destructive", grade: 2 } },
    "MISTERO" => { type: "matter", keywords: [], behavior: "normal", matter: nil },
  }.freeze

  # Un tavolo per A: `field` sono [uid, id, opzioni] già in campo (con la
  # fila `y` e la faccia), `hand` [uid, id] in mano. Un carico solo.
  def tavolo(field, hand, seat: "a")
    engine = Rubyfront::Engine.new(cards: MATERIE)
    cards = field.map.with_index do |(uid, id, opts), i|
      { "uid" => uid, "owner" => seat, "zone" => "field", "order" => i, "cardId" => id,
        "y" => 1236, "face" => 0 }.merge((opts || {}).transform_keys(&:to_s))
    end
    cards += hand.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => seat, "zone" => "hand", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    engine
  end

  def gioca_materia(engine, uid)
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => 2368, "y" => 1236 })
  end

  def test_con_l_abilitante_in_campo_la_materia_scende
    engine = tavolo([["e1", "UMANO"]], [["m1", "SCINTILLA"]])
    assert gioca_materia(engine, "m1")[:ok]
  end

  def test_senza_abilitante_la_materia_non_scende
    engine = tavolo([], [["m1", "SCINTILLA"]])
    verdict = gioca_materia(engine, "m1")
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/abilita la Materia Dinamica di grado 1.*§7/, verdict[:reason])
  end

  def test_il_grado_conta
    engine = tavolo([["e1", "UMANO"]], [["m2", "TEMPESTA"]])
    refute gioca_materia(engine, "m2")[:ok], "un abilitatore di primo grado non basta per il secondo (§7.1)"
    engine = tavolo([["e1", "MAESTRO"]], [["m2", "TEMPESTA"]])
    assert gioca_materia(engine, "m2")[:ok]
  end

  def test_il_tipo_conta
    engine = tavolo([["e1", "AUROS"]], [["m1", "SCINTILLA"]])
    refute gioca_materia(engine, "m1")[:ok], "la Dimensionale non abilita la Dinamica"
  end

  def test_la_coperta_non_abilita_la_tappata_si
    engine = tavolo([["e1", "UMANO", { facedown: true }]], [["m1", "SCINTILLA"]])
    refute gioca_materia(engine, "m1")[:ok], "l'Entità coperta non abilita (§6.3)"
    engine = tavolo([["e1", "UMANO", { tapped: true }]], [["m1", "SCINTILLA"]])
    assert gioca_materia(engine, "m1")[:ok], "la tappata abilita normalmente"
  end

  def test_il_rubyfront_abilita_solo_schierato
    engine = tavolo([["rf", "RUBINO", { y: 1756 }]], [["r2", "ROVINA"]])
    refute gioca_materia(engine, "r2")[:ok], "in Zona di Richiamo non abilita nulla (§3.1)"
    engine = tavolo([["rf", "RUBINO", { y: 1236 }]], [["r2", "ROVINA"]])
    refute gioca_materia(engine, "r2")[:ok], "schierato, ma la faccia Rubyfront arriva al primo grado"
    engine = tavolo([["rf", "RUBINO", { y: 1236, face: 1 }]], [["r2", "ROVINA"]])
    assert gioca_materia(engine, "r2")[:ok], "il Nexus abilita fino al secondo grado (§3.1)"
  end

  def test_l_abilitante_avversario_non_conta
    engine = tavolo([], [["m1", "SCINTILLA"]])
    cards = [{ "uid" => "b1", "owner" => "b", "zone" => "field", "order" => 0, "cardId" => "UMANO", "y" => 172 }]
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => cards })
    refute gioca_materia(engine, "m1")[:ok]
  end

  def test_materia_senza_etichetta_silenzio
    engine = tavolo([], [["m1", "MISTERO"]])
    verdict = gioca_materia(engine, "m1")
    assert verdict[:ok]
  end

  # --- §2/§9: la fine della partita ----------------------------------------

  def fine(engine, winner, reason)
    engine.judge({ "t" => "gameOver", "winner" => winner, "reason" => reason })
  end

  def test_a_zero_pv_la_vittoria_passa_e_il_tavolo_si_ferma
    engine = Rubyfront::Engine.new
    engine.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => 0 } })
    verdict = fine(engine, "a", "hp")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    dopo = engine.judge({ "t" => "draw", "seat" => "a", "count" => 1 })
    refute dopo[:ok]
    assert_match(/partita è finita/, dopo[:reason])
    assert engine.judge({ "t" => "say", "entry" => {} })[:ok], "la chat resta"
    assert engine.judge({ "t" => "newGame", "active" => "a" })[:ok], "Nuova partita riapre"
    assert engine.judge({ "t" => "draw", "seat" => "a", "count" => 1 })[:ok]
  end

  def test_una_vittoria_pretesa_con_pv_in_piedi_viene_fermata
    engine = Rubyfront::Engine.new
    verdict = fine(engine, "a", "hp")
    refute verdict[:ok]
    assert_match(/PV di B non sono a zero.*§2/, verdict[:reason])
  end

  def test_il_pareggio_vuole_entrambi_a_zero
    engine = Rubyfront::Engine.new
    engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 0 } })
    refute fine(engine, nil, "draw")[:ok]
    engine.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => 0 } })
    assert fine(engine, nil, "draw")[:ok]
  end

  def test_il_mazzo_esaurito_si_verifica_sulla_copia
    engine = Rubyfront::Engine.new
    cards = [{ "uid" => "b-1", "owner" => "b", "zone" => "deck", "order" => 0 }]
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => cards })
    verdict = fine(engine, "a", "deck")
    refute verdict[:ok]
    assert_match(/mazzo di B non è vuoto.*§9\.1/, verdict[:reason])
    engine.judge({ "t" => "draw", "seat" => "b", "count" => 1 }, actor: "b")
    assert fine(engine, "a", "deck")[:ok]
  end

  def test_la_risoluzione_porta_i_pv_a_zero_anche_nella_copia
    engine = ondata([["a1", "FORTE"]], [], ["a1"], [])
    engine.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => 4 } })
    assert risolvi(engine, [battaglia("a1", damage: 4)])[:ok]
    assert fine(engine, "a", "hp")[:ok], "4 danni su 4 PV: la copia lo sa"
  end

  # --- §3.1: il Rubyfront si schiera pagando --------------------------------

  SCHIERAMENTI = {
    "FISSO" => { type: "rubyfront", keywords: [], deployment: { fixed: 3, die: nil } },
    "DADO" => { type: "rubyfront", keywords: [], deployment: { fixed: nil, die: 6 } },
    "IGNOTO" => { type: "rubyfront", keywords: [] },
  }.freeze

  # Il Rubyfront di A in Zona di Richiamo (fila di servizio), con quel Flusso.
  def richiamo(card_id, flux:, token: false)
    engine = Rubyfront::Engine.new(cards: SCHIERAMENTI)
    engine.judge({ "t" => "player", "seat" => "a", "patch" => { "flux" => flux, "token" => token } })
    cards = [{ "uid" => "rf", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => card_id, "y" => 1756 }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine
  end

  def schiera(engine, cost: nil, roll: nil, y: 1236, actor: "a")
    action = { "t" => "move", "uid" => "rf", "x" => 30, "y" => y, "z" => 2 }
    action["cost"] = cost unless cost.nil?
    action["roll"] = roll unless roll.nil?
    engine.judge(action, actor: actor)
  end

  def test_costo_fisso_si_paga_identico_a_ogni_schieramento
    engine = richiamo("FISSO", flux: 3)
    assert schiera(engine, cost: 3)[:ok]
    assert_equal 0, engine.instance_variable_get(:@table).flux("a")
  end

  def test_una_volta_schierato_non_torna_in_zona_di_richiamo
    engine = richiamo("FISSO", flux: 3)
    schiera(engine, cost: 3)
    verdict = schiera(engine, y: 1756)
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/non torna in Zona di Richiamo.*§3\.1/, verdict[:reason])
    refute engine.judge({ "t" => "toZone", "uid" => "rf", "zone" => "ritiro" })[:ok], "e non si ritira"
  end

  def test_costo_fisso_senza_flusso_o_sbagliato
    engine = richiamo("FISSO", flux: 2)
    verdict = schiera(engine, cost: 3)
    refute verdict[:ok]
    assert_match(/Flusso insufficiente.*§3\.1/, verdict[:reason])
    refute schiera(engine, cost: 1)[:ok], "pagare meno dello stampato"
    refute schiera(engine)[:ok], "non pagare"
  end

  def test_il_gettone_conta_nel_flusso_disponibile
    engine = richiamo("FISSO", flux: 2, token: true)
    assert schiera(engine, cost: 3)[:ok]
    table = engine.instance_variable_get(:@table)
    assert_equal 0, table.flux("a")
    refute table.token?("a"), "il Gettone è speso"
  end

  def test_il_dado_si_tira_solo_se_il_flusso_copre_le_facce
    engine = richiamo("DADO", flux: 5)
    verdict = schiera(engine, cost: 2, roll: 2)
    refute verdict[:ok]
    assert_match(/non si tira.*6 Flussi.*ne hai 5/, verdict[:reason])
    engine = richiamo("DADO", flux: 5, token: true)
    assert schiera(engine, cost: 2, roll: 2)[:ok], "col Gettone il d6 è coperto (§3.1)"
  end

  def test_col_dado_si_paga_il_numero_uscito
    engine = richiamo("DADO", flux: 6)
    refute schiera(engine, cost: 3)[:ok], "senza tiro"
    refute schiera(engine, cost: 7, roll: 7)[:ok], "un tiro fuori dal dado"
    refute schiera(engine, cost: 1, roll: 4)[:ok], "pagare meno del tiro"
    assert schiera(engine, cost: 4, roll: 4)[:ok]
    assert_equal 2, engine.instance_variable_get(:@table).flux("a")
  end

  def test_gli_spostamenti_sulla_fila_sono_liberi
    engine = richiamo("FISSO", flux: 3)
    schiera(engine, cost: 3)
    verdict = engine.judge({ "t" => "move", "uid" => "rf", "x" => 30, "y" => 1236, "z" => 4 })
    refute verdict[:ruled], "già schierato: si sposta e basta"
    engine = richiamo("FISSO", flux: 0)
    refute engine.judge({ "t" => "move", "uid" => "rf", "x" => 30, "y" => 1756, "z" => 4 })[:ruled], "e in Richiamo pure"
  end

  def test_lo_schieramento_e_un_gesto_del_proprio_turno
    engine = richiamo("FISSO", flux: 3)
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    verdict = schiera(engine, cost: 3, actor: "a")
    refute verdict[:ok]
    assert_match(/non tocca a te/, verdict[:reason])
  end

  def test_senza_costo_in_anagrafe_silenzio
    engine = richiamo("IGNOTO", flux: 0)
    refute schiera(engine)[:ruled]
  end

  # --- §8.2: gli effetti certificati, l'ascoltatore di RBF-003 -------------

  ASCOLTATORI = {
    "GUIDA" => { type: "entity", keywords: [], race: "human",
                 enter_listeners: [{ entering_race: "human", requires: { count: 3, race: "human" }, draw: 1 }] },
    "UMANO" => { type: "entity", keywords: [], race: "human", enter_listeners: [] },
    "AUROS" => { type: "entity", keywords: [], race: "auros", enter_listeners: [] },
    "PIETRA" => { type: "matter", keywords: [], behavior: "normal", enter_listeners: [] },
  }.freeze

  # Il campo di A con quelle carte (già in campo, turno 1) e `hand` in mano;
  # poi `entra` fa scendere una carta dalla mano.
  def campo(field, hand)
    engine = Rubyfront::Engine.new(cards: ASCOLTATORI)
    cards = field.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "field", "order" => i, "cardId" => id, "y" => 1236 } }
    cards += hand.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "hand", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine
  end

  def entra(engine, uid, x: 1578)
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => x, "y" => 1236 })
  end

  def innesco(engine, source:, entering:, count: 1, seat: "a")
    engine.judge({ "t" => "draw", "seat" => seat, "count" => count,
                   "effect" => { "source" => source, "event" => "on_enter_field", "entering" => entering } })
  end

  def test_la_guida_si_innesca_al_terzo_umano
    engine = campo([["g", "GUIDA"], ["u1", "UMANO"]], [["u2", "UMANO"]])
    assert entra(engine, "u2")[:ok]
    verdict = innesco(engine, source: "g", entering: "u2")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
  end

  def test_con_due_umani_non_si_innesca
    engine = campo([["g", "GUIDA"]], [["u1", "UMANO"]])
    entra(engine, "u1")
    verdict = innesco(engine, source: "g", entering: "u1")
    refute verdict[:ok]
    assert_match(/non ha un effetto certificato.*§8\.2/, verdict[:reason])
  end

  def test_un_auros_che_entra_non_innesca_la_guida
    engine = campo([["g", "GUIDA"], ["u1", "UMANO"], ["u2", "UMANO"]], [["x", "AUROS"]])
    entra(engine, "x")
    refute innesco(engine, source: "g", entering: "x")[:ok]
  end

  def test_l_innesco_si_consuma_una_volta_per_ingresso
    engine = campo([["g", "GUIDA"], ["u1", "UMANO"]], [["u2", "UMANO"]])
    entra(engine, "u2")
    assert innesco(engine, source: "g", entering: "u2")[:ok]
    verdict = innesco(engine, source: "g", entering: "u2")
    refute verdict[:ok]
    assert_match(/già stato risolto/, verdict[:reason])
  end

  def test_un_ingresso_vecchio_non_innesca_piu
    engine = campo([["g", "GUIDA"], ["u1", "UMANO"]], [["u2", "UMANO"]])
    entra(engine, "u2")
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    verdict = innesco(engine, source: "g", entering: "u2")
    refute verdict[:ok]
    assert_match(/non è entrata in campo questo turno/, verdict[:reason])
  end

  def test_la_forma_del_passo_deve_essere_quella_dell_effetto
    engine = campo([["g", "GUIDA"], ["u1", "UMANO"]], [["u2", "UMANO"]])
    entra(engine, "u2")
    refute innesco(engine, source: "g", entering: "u2", count: 3)[:ok], "pesca 1, non 3"
    refute innesco(engine, source: "g", entering: "u2", seat: "b")[:ok], "pesca il controllore"
    refute innesco(engine, source: "g", entering: "g")[:ok], "non se stessa"
    refute innesco(engine, source: "u1", entering: "u2")[:ok], "una carta senza ascoltatore"
  end

  def test_un_effetto_finto_non_e_un_gesto_qualunque
    engine = campo([["u1", "UMANO"]], [])
    verdict = engine.judge({ "t" => "toZone", "uid" => "u1", "zone" => "hand",
                             "effect" => { "source" => "u1", "event" => "on_enter_field", "entering" => "u1" } })
    refute verdict[:ok]
    assert_match(/pesca soltanto/, verdict[:reason])
  end
end
