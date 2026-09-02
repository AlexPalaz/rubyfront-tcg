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
    assert_match(/richiamo/, verdict[:reason])
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
end
