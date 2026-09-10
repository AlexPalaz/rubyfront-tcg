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

  # --- Il motivo in due lingue: il tavolo è bilingue, l'engine pure.

  def test_ogni_fermata_porta_il_motivo_anche_in_inglese
    verdict = @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "flux" => 21 } })
    refute verdict[:ok]
    assert_match(/Flusso/, verdict[:reason])
    assert_match(/Flux/, verdict[:reason_en])
    refute_equal verdict[:reason], verdict[:reason_en]
    # La targhetta del sigillo — il «(§x.y)» in coda — sta in entrambe.
    assert_match(/\(§3\.2\)/, verdict[:reason])
    assert_match(/\(§3\.2\)/, verdict[:reason_en])
  end

  def test_il_saluto_porta_le_regole_anche_in_inglese
    hello = @engine.hello
    assert_equal Rubyfront::Engine::RULES.size, hello[:rules_en].size
    hello[:rules].zip(hello[:rules_en]).each do |it, en|
      # Stesso § in testa, frase diversa.
      assert_equal it[/^§[\d.\/§]+/], en[/^§[\d.\/§]+/], "#{it} / #{en}"
      refute_equal it, en
    end
  end

  def test_le_parole_interpolate_seguono_la_lingua
    engine = Rubyfront::Engine.new
    engine.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => 0 } })
    engine.judge({ "t" => "gameOver", "winner" => "a", "reason" => "hp" })
    dopo = engine.judge({ "t" => "draw", "seat" => "a", "count" => 1 })
    refute dopo[:ok]
    assert_equal "la partita è finita: Nuova partita per ricominciare (§2)", dopo[:reason]
    assert_equal "the game is over: New game to start again (§2)", dopo[:reason_en]
  end

  def test_nessun_rifiuto_resta_senza_inglese
    sorgente = File.read(File.expand_path("../lib/rubyfront/engine.rb", __dir__))
    senza = sorgente.lines.select { |line| line =~ /refuse\(/ && line !~ /def refuse/ }
                    .reject { |line| line.scan(/"(?:[^"\\]|\\.)*"/).size >= 2 || line =~ /reason_en/ }
    assert_empty senza, "refuse senza la frase inglese:\n#{senza.join}"
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
    verdict = @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "name" => "Ale", "token" => true } })
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
    @engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "ritiro" })
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
    # Muore (la risoluzione la applica da sé): nell'Abisso a mano non si va (§5).
    engine.observe({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
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
    # Muore (la risoluzione la applica da sé): nell'Abisso a mano non si va (§5).
    engine.observe({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
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
    # Muore (la risoluzione la applica da sé): nell'Abisso a mano non si va (§5).
    engine.observe({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
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

  # §6.2 pone le sue condizioni al Ritiro, ma il gesto resta LIBERO
  # (decisione del designer, 2026-09-04): è anche l'attrezzo con cui si
  # risolve a mano ciò che l'engine non legge. È il ritorno a essere chiuso.
  def test_il_ritiro_e_libero
    # Un tavolo per condizione: il giudizio APPLICA, e la carta ritirata non
    # è più in campo per la prova dopo.
    campo = lambda do |card_id, &apparecchia|
      engine = con_carte
      scendi(engine, "a-1", card_id)
      giro_di_turno(engine) unless card_id == "SCATTANTE"
      apparecchia&.call(engine)
      engine
    end
    assert campo.call("SCATTANTE").judge(ritira("a-1"))[:ok], "anche nel turno d'ingresso"
    tappata = campo.call("LENTA") { |e| e.judge({ "t" => "tap", "uid" => "a-1", "tapped" => true }) }
    assert tappata.judge(ritira("a-1"))[:ok], "anche tappata"
    coperta = campo.call("LENTA") { |e| e.judge({ "t" => "facedown", "uid" => "a-1", "facedown" => true }) }
    assert coperta.judge(ritira("a-1"))[:ok], "anche coperta"
  end

  # §6.2 — «il ritiro è un'azione di preparazione del Fronte»: è il solo
  # vincolo rimasto, e vale anche in Reazione.
  def test_a_fronte_dichiarato_non_si_ritira
    engine = con_carte
    scendi(engine, "a-1", "LENTA")
    giro_di_turno(engine)
    fronte!(engine)
    verdict = engine.judge(ritira("a-1"))
    refute verdict[:ok]
    assert_match(/gesto di Preparazione.*§6\.2/, verdict[:reason])
    assert_match(/Preparation move.*§6\.2/, verdict[:reason_en])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    refute engine.judge(ritira("a-1"))[:ok], "e nemmeno in Reazione"
  end

  def test_l_entita_avversaria_si_ritira_in_ogni_fase
    # Non è un ritiro: è un effetto risolto a mano. Silenzio, in ogni fase.
    engine = con_carte
    mano_e_campo(engine, %w[LENTA], cala: 1, seat: "b")
    fronte!(engine)
    refute engine.judge(ritira("b-1"))[:ruled]
  end

  def test_dalla_zona_di_ritiro_si_esce_solo_per_effetto
    engine = con_carte
    cards = [{ "uid" => "a-1", "owner" => "a", "zone" => "ritiro", "order" => 0, "cardId" => "LENTA" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    %w[field hand deck].each do |zone|
      verdict = engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => zone, "x" => 442, "y" => 1260 })
      refute verdict[:ok], zone
      assert_match(/dalla Zona di Ritiro si esce solo per effetto.*§5, §6\.2/, verdict[:reason])
      assert_match(/leave the Retire Zone only through an effect.*§5, §6\.2/, verdict[:reason_en])
    end
    # Nemmeno nell'Abisso: ci resta quel che non è morto (§5), e lo dice.
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
    refute verdict[:ok]
    assert_match(/non si va nell'Abisso a mano.*§5/, verdict[:reason])
    assert_match(/Retire Zone to the Abyss by hand.*§5/, verdict[:reason_en])
  end

  def test_nella_zona_di_ritiro_non_si_va_dal_mazzo
    engine = con_carte
    cards = [{ "uid" => "a-2", "owner" => "a", "zone" => "deck", "order" => 0, "cardId" => "LENTA" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-2", "zone" => "ritiro" })
    refute verdict[:ok]
    assert_match(/dal Fronte, col Ritiro, o scartando dalla mano.*§6\.2, §6\.5/, verdict[:reason])
    assert_match(/from the Front, by retiring, or by discarding from hand.*§6\.2, §6\.5/, verdict[:reason_en])
  end

  def test_il_rubyfront_non_si_ritira
    engine = con_carte
    scendi(engine, "a-1", "RUBINO")
    giro_di_turno(engine)
    verdict = engine.judge(ritira("a-1"))
    refute verdict[:ok]
    assert_match(/resta in campo/, verdict[:reason])
  end

  def test_materie_e_carte_ignote_si_ritirano
    engine = con_carte
    scendi(engine, "a-1", "PIETRA")
    giro_di_turno(engine)
    assert engine.judge(ritira("a-1"))[:ok]
    scendi(engine, "a-1", "MISTERO")
    giro_di_turno(engine)
    assert engine.judge(ritira("a-1"))[:ok]
  end


  def test_dalla_mano_al_ritiro_solo_per_eccesso
    # Dal 2026-09-10: dalla mano in Zona di Ritiro si va scartando per eccesso (§6.5), non a mano.
    engine = con_carte
    mano_e_campo(engine, %w[LENTA], cala: 0)
    verdict = engine.judge(ritira("a-1"))
    refute verdict[:ok]
    assert_match(/solo per eccesso/, verdict[:reason])
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
    verdict = engine.judge(gioca("a-1", 442, 1260))
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
    refute engine.judge(gioca("a-1", 2368, 1260))[:ruled], "la fila delle Materie non è affare dell'engine"
    mano_e_campo(engine, %w[PIETRA], cala: 0)
    refute engine.judge(gioca("a-1", 500, 900))[:ruled], "rilascio a mano libera: lavagna libera"
  end

  def test_l_entita_sullo_slot_scende_regolarmente
    engine = con_carte
    mano_e_campo(engine, %w[LENTA], cala: 0)
    assert engine.judge(gioca("a-1", 442, 1260))[:ok]
  end

  def test_carta_ignota_sullo_slot_silenzio
    engine = con_carte
    mano_e_campo(engine, %w[MISTERO], cala: 0)
    refute engine.judge(gioca("a-1", 442, 1260))[:ruled]
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

  # Gli attrezzi degli effetti d'attacco nella risoluzione (§8.1, §8.2): il
  # bonus di Potenza fino a fine turno e la Vendetta, stampata o concessa.
  POTENZE_VENDETTA = POTENZE.merge("VENDICATIVO" => { type: "entity", keywords: ["revenge"], power: 5, counterattack: nil }).freeze

  def ondata_vendetta(*args)
    engine = ondata(*args)
    engine.instance_variable_set(:@cards, POTENZE_VENDETTA)
    engine
  end

  def test_il_bonus_di_potenza_entra_nel_conto
    engine = ondata([["a1", "FORTE"]], [["b1", "PARI"]], ["a1"], [["b1", "a1", "block"]])
    engine.observe({ "t" => "empower", "uid" => "a1", "power" => 1, "effect" => { "source" => "a1", "event" => "on_attack", "entering" => "a1" } })
    verdict = risolvi(engine, [battaglia("a1", blocker: "b1", kind: "block", blocker_dies: true)])
    assert verdict[:ok], verdict[:reason]
  end

  def test_la_vendetta_uccide_l_attaccante_superato
    engine = ondata_vendetta([["a1", "FORTE"]], [["b1", "VENDICATIVO"]], ["a1"], [["b1", "a1", "block"]])
    verdict = risolvi(engine, [battaglia("a1", blocker: "b1", kind: "block", attacker_dies: true)])
    assert verdict[:ok], verdict[:reason]
  end

  def test_la_vendetta_concessa_vale_come_quella_stampata
    engine = ondata([["a1", "DEBOLE"]], [["b1", "FORTE"]], ["a1"], [["b1", "a1", "block"]])
    engine.observe({ "t" => "empower", "uid" => "b1", "grants" => ["revenge"], "effect" => { "source" => "b1", "event" => "on_attack", "entering" => "b1" } })
    assert risolvi(engine, [battaglia("a1", blocker: "b1", kind: "block", attacker_dies: true)])[:ok]
    refute risolvi(engine, [battaglia("a1", blocker: "b1", kind: "block")])[:ok]
  end

  def test_chi_non_puo_bloccare_viene_fermato
    engine = ondata([["a1", "FORTE"]], [["b1", "PARI"]], ["a1"], [])
    engine.observe({ "t" => "empower", "uid" => "b1", "restrict" => "block", "effect" => { "source" => "a1", "event" => "on_attack", "entering" => "a1" } })
    verdict = engine.judge({ "t" => "declare", "declaration" => { "id" => "b1", "from" => "b1", "to" => "a1", "kind" => "block", "seat" => "b", "order" => 0 } })
    refute verdict[:ok]
    assert_match(/non può bloccare in questo turno/, verdict[:reason])
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

  # --- §3.1: i PV iniziali sono quelli stampati sul Rubyfront
  # Un Rubyfront con i PV in anagrafe, uno senza (forma ignota: silenzio).
  VITA = {
    "RUBINO" => { type: "rubyfront", keywords: [], health: 21 },
    "OPACO" => { type: "rubyfront", keywords: [] },
    "LENTA" => { type: "entity", keywords: [] },
  }.freeze

  def mazzo_con(engine, seat, rubyfront_id, hp: nil)
    cards = [{ "uid" => "#{seat}-rf", "owner" => seat, "zone" => "field", "order" => 0, "cardId" => rubyfront_id, "y" => 1580 }]
    action = { "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards }
    action["hp"] = hp unless hp.nil?
    engine.judge(action)
  end

  def test_il_mazzo_porta_i_pv_stampati_e_la_copia_parte_da_li
    engine = Rubyfront::Engine.new(cards: VITA)
    verdict = mazzo_con(engine, "a", "RUBINO", hp: 21)
    assert verdict[:ruled]
    assert verdict[:ok]
    assert_equal 21, engine.instance_variable_get(:@table).hp("a")
  end

  def test_pv_diversi_dallo_stampato_sono_fermati
    engine = Rubyfront::Engine.new(cards: VITA)
    verdict = mazzo_con(engine, "a", "RUBINO", hp: 20)
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_includes verdict[:reason], "(§3.1)"
    assert_includes verdict[:reason_en], "(§3.1)"
    assert_equal 20, engine.instance_variable_get(:@table).hp("a"), "la copia resta com'era"
  end

  def test_pv_assenti_con_rubyfront_noto_sono_fermati
    engine = Rubyfront::Engine.new(cards: VITA)
    verdict = mazzo_con(engine, "a", "RUBINO")
    assert verdict[:ruled]
    refute verdict[:ok]
  end

  def test_rubyfront_senza_pv_in_anagrafe_o_ignoto_non_ha_regola
    engine = Rubyfront::Engine.new(cards: VITA)
    refute mazzo_con(engine, "a", "OPACO", hp: 5)[:ruled]
    refute mazzo_con(engine, "b", "SCONOSCIUTO", hp: 5)[:ruled]
  end

  def test_un_mazzo_senza_rubyfront_non_ha_regola
    engine = Rubyfront::Engine.new(cards: VITA)
    cards = [{ "uid" => "a-1", "owner" => "a", "zone" => "deck", "order" => 0, "cardId" => "LENTA" }]
    verdict = engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards, "hp" => 7 })
    refute verdict[:ruled]
  end

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

  def test_nel_fronte_le_reattive_scendono_da_chi_e_di_turno
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "a", "a-1", "SCINTILLA")
    in_mano(engine, "b", "b-1", "SCINTILLA")
    fronte!(engine)
    verdict = engine.judge({ "t" => "toZone", "uid" => "b-1", "zone" => "field", "chain" => true })
    refute verdict[:ok], "prima dell'ondata la finestra è di chi è di turno: il difensore gioca in Reazione (§6.3, §7.2)"
    assert_match(/in Reazione/, verdict[:reason])
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "field", "chain" => true })
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
    assert engine.judge({ "t" => "player", "seat" => "b", "patch" => { "name" => "Ale" } }, actor: "b")[:ok], "il nome non è un gesto di gioco"
    refute engine.judge({ "t" => "player", "seat" => "b", "patch" => { "name" => "Ale", "hp" => 3 } }, actor: "b")[:ok], "coi contatori sì (in Preparazione altrui)"
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

  def test_l_avversario_non_gioca_una_reattiva_nel_mio_fronte_prima_dell_ondata
    engine = altrui
    in_mano(engine, "b", "b-1", "SCINTILLA")
    fronte!(engine)
    verdict = engine.judge({ "t" => "toZone", "uid" => "b-1", "zone" => "field", "chain" => true }, actor: "b")
    refute verdict[:ok], "il Pre-Fronte non c'è più: il difensore gioca le Reattive in Reazione (§6.3, §7.2)"
    assert_match(/di chi è di turno/, verdict[:reason])
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

  def test_chi_contrattacca_si_copre_nel_turno_altrui
    # §6.3, punto 4: «chi blocca si tappa, chi contrattacca si copre», e la
    # copertura scatta alla dichiarazione — quindi nel turno di chi attacca.
    engine = ondata([["a1", "FORTE"]], [["b1", "SPINOSO"]], ["a1"], [["b1", "a1", "counter"]])
    verdict = engine.judge({ "t" => "facedown", "uid" => "b1", "facedown" => true }, actor: "b")
    assert verdict[:ok], verdict[:reason]
    assert engine.judge({ "t" => "facedown", "uid" => "b1", "facedown" => false }, actor: "b")[:ok], "e il ripensamento la scopre"
  end

  def test_il_difensore_non_copre_le_carte_di_chi_attacca
    engine = ondata([["a1", "FORTE"]], [["b1", "SPINOSO"]], ["a1"], [["b1", "a1", "counter"]])
    verdict = engine.judge({ "t" => "facedown", "uid" => "a1", "facedown" => true }, actor: "b")
    refute verdict[:ok]
    assert_match(/non tocca a te/, verdict[:reason])
  end

  def test_fuori_dalla_reazione_il_difensore_non_copre
    engine = Rubyfront::Engine.new(cards: POTENZE)
    campo = [{ "uid" => "b1", "owner" => "b", "zone" => "field", "order" => 0, "cardId" => "SPINOSO" }]
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => campo })
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    fronte!(engine)
    verdict = engine.judge({ "t" => "facedown", "uid" => "b1", "facedown" => true }, actor: "b")
    refute verdict[:ok], "la copertura è quella del contrattacco, e i blocchi vivono in Reazione (§6.4)"
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
    cards = [{ "uid" => "a-1", "owner" => "a", "zone" => "deck", "order" => 0, "cardId" => "CARA" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    assert paga(engine, "a-1", nil)[:ok], "dal mazzo una carta scende per effetto: nessun costo"
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
    assert scendi_in_campo(engine, "a-1", x: 821, y: 1260)[:ok], "slot della fila di A"
    in_mano(engine, "a", "a-2", "LENTA")
    verdict = scendi_in_campo(engine, "a-2", x: 900, y: 1260)
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
    scendi_in_campo(engine, "a-1", x: 442, y: 1260)
    scendi_in_campo(engine, "m-1", x: 2368, y: 1260)
    # §5 — «un'Entità occupa lo slot in cui è scesa»: nemmeno su uno slot libero.
    verdict = engine.judge({ "t" => "move", "uid" => "a-1", "x" => 1199, "y" => 1260, "z" => 3 })
    refute verdict[:ok]
    assert_match(/resta nello slot.*§5/, verdict[:reason])
    assert_match(/stays in the slot.*§5/, verdict[:reason_en])
    refute engine.judge({ "t" => "move", "uid" => "a-1", "x" => 1000, "y" => 1300, "z" => 3 })[:ok]
    verdict = engine.judge({ "t" => "move", "uid" => "m-1", "x" => 2000, "y" => 1300, "z" => 3 })
    refute verdict[:ruled], "una Materia in campo si sposta liberamente"
  end

  def test_dal_campo_non_si_torna_in_mano_ne_nel_mazzo
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "a", "a-1", "LENTA")
    scendi_in_campo(engine, "a-1", x: 442, y: 1260)
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "hand" })
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/non torna in mano.*§5/, verdict[:reason])
    refute engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "deck" })[:ok]
    refute engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })[:ok], "e nell'Abisso non a mano (§5)"
  end

  def test_la_fila_ignota_lascia_la_dogana_della_forma
    # Lavagna vecchia, senza la fila: resta il vincolo dello slot (§5), non quello dello spostamento.
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    cards = [{ "uid" => "a-1", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "LENTA" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    assert engine.judge({ "t" => "move", "uid" => "a-1", "x" => 1199, "y" => 1260, "z" => 3 })[:ok]
    refute engine.judge({ "t" => "move", "uid" => "a-1", "x" => 442, "y" => 1260, "z" => 4 })[:ok], "annotata la fila, lo slot è quello"
  end

  # --- §5: l'Abisso -----------------------------------------------------------

  def test_nell_abisso_non_si_va_a_mano
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "a", "a-1", "LENTA")
    scendi_in_campo(engine, "a-1", x: 442, y: 1260)
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
    refute verdict[:ok]
    assert_match(/non a mano.*§5/, verdict[:reason])
    assert_match(/not by hand.*§5/, verdict[:reason_en])
  end

  def test_la_materia_in_campo_va_nell_abisso
    # «Materie risolte, decadute o svanite» (§5): la Materia in campo ci va sempre.
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "a", "m-1", "PIETRA")
    scendi_in_campo(engine, "m-1", x: 2368, y: 1260)
    assert engine.judge({ "t" => "toZone", "uid" => "m-1", "zone" => "abisso" })[:ok]
  end

  def test_lo_scarto_per_eccesso_passa_dalla_mano_alla_zona_di_ritiro
    # §6.5: «le carte in eccesso vanno scartate» — in Zona di Ritiro (dal
    # 2026-09-10), solo oltre le 7; nell'Abisso dalla mano mai.
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    cards = (1..8).map { |i| { "uid" => "a-#{i}", "owner" => "a", "zone" => "hand", "order" => i, "cardId" => "LENTA" } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-8", "zone" => "abisso" })
    refute verdict[:ok]
    assert_match(/vanno in Zona di Ritiro, non nell'Abisso.*§5, §6\.5/, verdict[:reason])
    assert engine.judge({ "t" => "toZone", "uid" => "a-8", "zone" => "ritiro" })[:ok], "otto in mano: l'ottava si scarta"
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-7", "zone" => "ritiro" })
    refute verdict[:ok], "a sette non si scarta più"
    assert_match(/solo per eccesso.*§6\.5/, verdict[:reason])
  end

  def test_dall_abisso_non_si_torna
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    cards = [{ "uid" => "a-1", "owner" => "a", "zone" => "abisso", "order" => 0, "cardId" => "LENTA" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    %w[hand deck field ritiro].each do |zone|
      verdict = engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => zone, "x" => 442, "y" => 1260 })
      refute verdict[:ok], zone
      assert_match(/dall'Abisso non si torna.*§5/, verdict[:reason])
    end
  end

  def test_la_carta_ignota_nell_abisso_tace
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    cards = [{ "uid" => "x-1", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "IGNOTA" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    refute engine.judge({ "t" => "toZone", "uid" => "x-1", "zone" => "abisso" })[:ruled]
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
        "y" => 1260, "face" => 0 }.merge((opts || {}).transform_keys(&:to_s))
    end
    cards += hand.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => seat, "zone" => "hand", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    engine
  end

  def gioca_materia(engine, uid)
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => 2368, "y" => 1260 })
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
    engine = tavolo([["rf", "RUBINO", { y: 1260 }]], [["r2", "ROVINA"]])
    refute gioca_materia(engine, "r2")[:ok], "schierato, ma la faccia Rubyfront arriva al primo grado"
    engine = tavolo([["rf", "RUBINO", { y: 1260, face: 1 }]], [["r2", "ROVINA"]])
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

  def schiera(engine, cost: nil, roll: nil, y: 1260, actor: "a")
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
    verdict = engine.judge({ "t" => "move", "uid" => "rf", "x" => 30, "y" => 1260, "z" => 4 })
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

  # --- §8.2: gli effetti certificati, l'ascoltatore d'ingresso ---------------

  ASCOLTATORI = {
    "ASCOLTATORE" => { type: "entity", keywords: [], race: "human",
                 enter_listeners: [{ entering_race: "human", requires: { count: 3, race: "human" }, draw: 1 }] },
    "UMANO" => { type: "entity", keywords: [], race: "human", enter_listeners: [] },
    "AUROS" => { type: "entity", keywords: [], race: "auros", enter_listeners: [] },
    "PIETRA" => { type: "matter", keywords: [], behavior: "normal", enter_listeners: [] },
  }.freeze

  # Il campo di A con quelle carte (già in campo, turno 1) e `hand` in mano;
  # poi `entra` fa scendere una carta dalla mano.
  def campo(field, hand)
    engine = Rubyfront::Engine.new(cards: ASCOLTATORI)
    cards = field.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "field", "order" => i, "cardId" => id, "y" => 1260 } }
    cards += hand.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "hand", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine
  end

  def entra(engine, uid, x: 1578)
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => x, "y" => 1260 })
  end

  def innesco(engine, source:, entering:, count: 1, seat: "a")
    engine.judge({ "t" => "draw", "seat" => seat, "count" => count,
                   "effect" => { "source" => source, "event" => "on_enter_field", "entering" => entering } })
  end

  def test_la_guida_si_innesca_al_terzo_umano
    engine = campo([["g", "ASCOLTATORE"], ["u1", "UMANO"]], [["u2", "UMANO"]])
    assert entra(engine, "u2")[:ok]
    verdict = innesco(engine, source: "g", entering: "u2")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
  end

  def test_con_due_umani_non_si_innesca
    engine = campo([["g", "ASCOLTATORE"]], [["u1", "UMANO"]])
    entra(engine, "u1")
    verdict = innesco(engine, source: "g", entering: "u1")
    refute verdict[:ok]
    assert_match(/non ha un effetto certificato.*§8\.2/, verdict[:reason])
  end

  def test_un_auros_che_entra_non_innesca_la_guida
    engine = campo([["g", "ASCOLTATORE"], ["u1", "UMANO"], ["u2", "UMANO"]], [["x", "AUROS"]])
    entra(engine, "x")
    refute innesco(engine, source: "g", entering: "x")[:ok]
  end

  def test_l_innesco_si_consuma_una_volta_per_ingresso
    engine = campo([["g", "ASCOLTATORE"], ["u1", "UMANO"]], [["u2", "UMANO"]])
    entra(engine, "u2")
    assert innesco(engine, source: "g", entering: "u2")[:ok]
    verdict = innesco(engine, source: "g", entering: "u2")
    refute verdict[:ok]
    assert_match(/già stato risolto/, verdict[:reason])
  end

  def test_un_ingresso_vecchio_non_innesca_piu
    engine = campo([["g", "ASCOLTATORE"], ["u1", "UMANO"]], [["u2", "UMANO"]])
    entra(engine, "u2")
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    verdict = innesco(engine, source: "g", entering: "u2")
    refute verdict[:ok]
    assert_match(/non è entrata sul Fronte questo turno/, verdict[:reason])
  end

  def test_la_forma_del_passo_deve_essere_quella_dell_effetto
    engine = campo([["g", "ASCOLTATORE"], ["u1", "UMANO"]], [["u2", "UMANO"]])
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
    assert_match(/§8\.2/, verdict[:reason], "fermato come effetto finto, non come gesto")
  end

  # --- §8.2: lo spostamento all'ingresso manda un'Entità avversaria in Ritiro --

  ARCIERI = {
    "SPOSTATORE" => { type: "entity", keywords: [], race: "human",
                   enter_moves: [{ target: { type: "entity", controller: "opponent" }, to: "ritiro" }] },
    "UMANO" => { type: "entity", keywords: [], race: "human" },
    "PIETRA" => { type: "matter", keywords: [], behavior: "normal" },
  }.freeze

  # A ha la fonte in mano, B quelle carte in campo; poi la fonte scende.
  def spostatore(b_field)
    engine = Rubyfront::Engine.new(cards: ARCIERI)
    a = [{ "uid" => "arc", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "SPOSTATORE" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    b = b_field.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "b", "zone" => "field", "order" => i, "cardId" => id, "y" => 172 } }
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => b })
    engine.judge({ "t" => "toZone", "uid" => "arc", "zone" => "field", "x" => 442, "y" => 1260 })
    engine
  end

  def manda(engine, uid, zone: "ritiro", source: "arc")
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => zone,
                   "effect" => { "source" => source, "event" => "on_enter_field", "entering" => source } })
  end

  def test_lo_spostamento_manda_un_entita_avversaria_in_ritiro
    engine = spostatore([["b1", "UMANO"]])
    verdict = manda(engine, "b1")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    assert_equal "ritiro", engine.instance_variable_get(:@table).card("b1")[:zone]
  end

  def test_l_effetto_si_consuma_una_volta
    engine = spostatore([["b1", "UMANO"], ["b2", "UMANO"]])
    assert manda(engine, "b1")[:ok]
    verdict = manda(engine, "b2")
    refute verdict[:ok]
    assert_match(/già stato risolto/, verdict[:reason])
  end

  def test_il_bersaglio_deve_essere_un_entita_avversaria_in_campo
    engine = spostatore([["b1", "PIETRA"]])
    refute manda(engine, "b1")[:ok], "una Materia no"
    engine = spostatore([])
    refute manda(engine, "arc")[:ok], "una propria carta no"
  end

  def test_l_innesco_vale_solo_nel_turno_d_ingresso
    engine = spostatore([["b1", "UMANO"]])
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    verdict = manda(engine, "b1")
    refute verdict[:ok]
    assert_match(/non è entrata sul Fronte questo turno/, verdict[:reason])
  end

  def test_la_zona_deve_essere_quella_della_forma
    engine = spostatore([["b1", "UMANO"]])
    refute manda(engine, "b1", zone: "abisso")[:ok], "nell'Abisso non è la forma dello spostamento"
  end

  # --- §8.2: l'esilio condizionato all'ingresso — un'Entità avversaria nell'Abisso
  #     finché chi entra resta in campo; quando lascia il campo, torna in gioco.

  ESILIATORI = {
    "TIRATORE" => { type: "entity", keywords: [], race: "human",
                    enter_moves: [{ target: { type: "entity", controller: "opponent" }, to: "abisso", hold: true }] },
    "UMANO" => { type: "entity", keywords: [], race: "human" },
    "PIETRA" => { type: "matter", keywords: [], behavior: "normal" },
  }.freeze

  def tiratore(b_field)
    engine = Rubyfront::Engine.new(cards: ESILIATORI)
    a = [{ "uid" => "tir", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "TIRATORE" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    b = b_field.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "b", "zone" => "field", "order" => i, "cardId" => id, "y" => 172 } }
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => b })
    engine.judge({ "t" => "toZone", "uid" => "tir", "zone" => "field", "x" => 442, "y" => 1260 })
    engine
  end

  def esilia(engine, uid, zone: "abisso", held_by: "tir")
    action = { "t" => "toZone", "uid" => uid, "zone" => zone,
               "effect" => { "source" => "tir", "event" => "on_enter_field", "entering" => "tir" } }
    action["heldBy"] = held_by if held_by
    engine.judge(action)
  end

  def test_l_esilio_all_ingresso_manda_un_entita_avversaria_nell_abisso_tenuta
    engine = tiratore([["b1", "UMANO"]])
    verdict = esilia(engine, "b1")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    card = engine.instance_variable_get(:@table).card("b1")
    assert_equal "abisso", card[:zone]
    assert_equal "tir", card[:held_by]
  end

  def test_l_esilio_all_ingresso_vuole_chi_entra_a_tenere
    engine = tiratore([["b1", "UMANO"]])
    verdict = esilia(engine, "b1", held_by: nil)
    refute verdict[:ok]
    assert_match(/tenuta da chi entra/, verdict[:reason])
    assert_includes verdict[:reason_en], "(§8.2)"
    refute esilia(engine, "b1", held_by: "b1")[:ok], "tenuta da un altro no"
    refute esilia(engine, "b1", zone: "ritiro")[:ok], "il Ritiro non è la forma"
  end

  def test_l_esilio_all_ingresso_vuole_un_entita_avversaria_in_campo
    engine = tiratore([["b1", "PIETRA"]])
    refute esilia(engine, "b1")[:ok], "una Materia no"
    engine = tiratore([])
    refute esilia(engine, "tir")[:ok], "una propria carta no"
  end

  def test_l_esiliata_torna_in_gioco_solo_quando_chi_la_tiene_lascia_il_campo
    engine = tiratore([["b1", "UMANO"]])
    assert esilia(engine, "b1")[:ok]
    trattenuta = engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "y" => 172 })
    refute trattenuta[:ok]
    assert_match(/finché la carta che lo tiene è in gioco/, trattenuta[:reason])
    # Chi tiene lascia il campo (il Ritiro, libero in Preparazione — §6.2):
    # nell'Abisso a mano non si va (§5).
    assert engine.judge({ "t" => "toZone", "uid" => "tir", "zone" => "ritiro" })[:ok]
    libera = engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "y" => 172 })
    assert libera[:ok], libera[:reason]
    card = engine.instance_variable_get(:@table).card("b1")
    assert_equal "field", card[:zone]
    assert_nil card[:held_by]
  end

  # --- §8.2: il ritorno riporta una permanente dalla Zona di Ritiro ----------

  EREDI = {
    "RIPORTANTE" => { type: "entity", keywords: [], race: "human",
                enter_returns: [{ from: "ritiro", filter: { permanent: true }, to: "field" }] },
    "PERMANENTE" => { type: "matter", keywords: [], behavior: "permanent" },
    "NORMALE" => { type: "matter", keywords: [], behavior: "normal" },
    "UMANO" => { type: "entity", keywords: [], race: "human" },
  }.freeze

  # A ha la fonte in mano e quelle carte in Zona di Ritiro; poi la fonte scende.
  # `campo` è quante Entità stanno già sul Fronte di A (per il Fronte pieno,
  # §6.2): la fonte compresa, che scende sempre per prima.
  def riportante(ritiro, foe_ritiro: [], campo: 1)
    engine = Rubyfront::Engine.new(cards: EREDI)
    a = [{ "uid" => "riportante", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "RIPORTANTE" }]
    a += (2..campo).map { |i| { "uid" => "f#{i}", "owner" => "a", "zone" => "field", "order" => i, "cardId" => "UMANO", "x" => Rubyfront::Engine::FRONT_SLOT_X[i - 1], "y" => 1260 } }
    a += ritiro.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "ritiro", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    b = foe_ritiro.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "b", "zone" => "ritiro", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => b })
    engine.judge({ "t" => "toZone", "uid" => "riportante", "zone" => "field", "x" => 442, "y" => 1260 })
    engine
  end

  def riporta(engine, uid)
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => 2368, "y" => 1260,
                   "effect" => { "source" => "riportante", "event" => "on_enter_field", "entering" => "riportante" } })
  end

  def test_il_ritorno_riporta_una_permanente_sul_fronte
    engine = riportante([["p1", "PERMANENTE"]])
    verdict = riporta(engine, "p1")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    assert_equal "field", engine.instance_variable_get(:@table).card("p1")[:zone]
  end

  def test_una_permanente_e_l_entita_o_la_materia_permanente
    # «Una carta permanente» (§10) è quel che resta in campo: l'Entità e la
    # Materia permanente. Non la Materia normale, non le carte altrui.
    engine = riportante([["n1", "NORMALE"], ["u1", "UMANO"]], foe_ritiro: [["bp", "PERMANENTE"]])
    refute riporta(engine, "n1")[:ok], "una Materia normale no"
    verdict = riporta(engine, "u1")
    assert verdict[:ok], "un'Entità sì: #{verdict[:reason]}"
    refute riporta(engine, "bp")[:ok], "dalla Zona di Ritiro avversaria no"
  end

  # §6.2, Fronte pieno: «anche la parte d'effetto che metterebbe in campo non
  # si applica» — per le Entità; una Materia permanente non occupa slot (§5).
  def test_a_fronte_pieno_l_entita_non_torna_la_materia_si
    engine = riportante([["u1", "UMANO"], ["p1", "PERMANENTE"]], campo: 5)
    verdict = riporta(engine, "u1")
    refute verdict[:ok]
    assert_match(/Fronte è pieno.*§6\.2/, verdict[:reason])
    assert_match(/Front is full.*§6\.2/, verdict[:reason_en])
    assert riporta(engine, "p1")[:ok], "la Materia permanente sta dietro il Fronte"
  end

  def test_il_ritorno_si_consuma_una_volta
    engine = riportante([["p1", "PERMANENTE"], ["p2", "PERMANENTE"]])
    assert riporta(engine, "p1")[:ok]
    refute riporta(engine, "p2")[:ok]
  end

  # --- §8.2: lo sguardo all'ingresso guarda le prime quattro -----------------

  CERCATORI = {
    "SGUARDO" => { type: "entity", keywords: [], race: "human",
                     enter_looks: [{ count: 4, die: nil, count_base: 0, reveal: { type: "entity", race: "human" }, then_retire: false }] },
    "SCRUTATORE" => { type: "entity", keywords: [], race: "auros",
                    enter_looks: [{ count: nil, die: 6, count_base: 2, reveal: { type: "object", race: nil }, then_retire: true }] },
    "GUARDIA" => { type: "entity", keywords: [], race: "auros",
                   enter_looks: [{ count: nil, die: 6, count_base: 0, reveal: { type: "object", race: nil }, then_retire: true, formula: "result" }] },
    "FERRO" => { type: "object", keywords: [] },
    "UMANO" => { type: "entity", keywords: [], race: "human" },
    "AUROS" => { type: "entity", keywords: [], race: "auros" },
    "PIETRA" => { type: "matter", keywords: [], behavior: "normal" },
  }.freeze

  # A ha la fonte in mano e quel mazzo (dalla cima); poi la fonte scende.
  def sguardo_ingresso(deck)
    engine = Rubyfront::Engine.new(cards: CERCATORI)
    cards = [{ "uid" => "cerc", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "SGUARDO" }]
    cards += deck.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "deck", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "toZone", "uid" => "cerc", "zone" => "field", "x" => 442, "y" => 1260 })
    engine
  end

  def guarda(engine, reveal: nil, count: 4, seat: "a")
    action = { "t" => "look", "seat" => seat, "count" => count,
               "effect" => { "source" => "cerc", "event" => "on_enter_field", "entering" => "cerc" } }
    action["reveal"] = reveal if reveal
    engine.judge(action)
  end

  def test_lo_sguardo_mostra_un_umano_fra_le_prime_quattro
    engine = sguardo_ingresso([["d1", "PIETRA"], ["d2", "UMANO"], ["d3", "AUROS"], ["d4", "PIETRA"], ["d5", "UMANO"]])
    verdict = guarda(engine, reveal: "d2")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    table = engine.instance_variable_get(:@table)
    assert_equal "hand", table.card("d2")[:zone]
    assert_equal %w[d5 d1 d3 d4], table.top_of_deck("a", 4)
  end

  def test_non_si_mostra_chi_non_e_fra_le_prime_o_non_e_umano
    engine = sguardo_ingresso([["d1", "PIETRA"], ["d2", "AUROS"], ["d3", "PIETRA"], ["d4", "PIETRA"], ["d5", "UMANO"]])
    refute guarda(engine, reveal: "d5")[:ok], "la quinta non si vede"
    refute guarda(engine, reveal: "d2")[:ok], "un Auros non si mostra"
    refute guarda(engine, count: 2)[:ok], "si guardano quattro carte"
    assert guarda(engine)[:ok], "nessuna da mostrare: tutte in fondo"
    refute guarda(engine)[:ok], "e l'innesco è consumato"
  end

  # --- §8.2: il controllo all'ingresso ----------------------------------------

  RADUNI = {
    "CONTROLLORE" => { type: "entity", keywords: [], race: "human",
                      enter_controls: [{ target: { type: "entity", controller: "opponent", max_cost: 3 }, grants: ["surge"] }] },
    "PICCOLA" => { type: "entity", keywords: [], race: "auros", flux_cost: 2 },
    "GRANDE" => { type: "entity", keywords: [], race: "auros", flux_cost: 5 },
    "PIETRA" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 1 },
  }.freeze

  # A ha la fonte in mano, B quelle carte in campo; poi la fonte scende.
  def controllore(b_field)
    engine = Rubyfront::Engine.new(cards: RADUNI)
    a = [{ "uid" => "rad", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "CONTROLLORE" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    b = b_field.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "b", "zone" => "field", "order" => i, "cardId" => id, "y" => 172 } }
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => b })
    engine.judge({ "t" => "toZone", "uid" => "rad", "zone" => "field", "x" => 442, "y" => 1260 })
    engine
  end

  def prendi(engine, uid, by: "a", grants: ["surge"])
    engine.judge({ "t" => "control", "uid" => uid, "by" => by, "grants" => grants,
                   "effect" => { "source" => "rad", "event" => "on_enter_field", "entering" => "rad" } })
  end

  def test_il_controllo_prende_un_entita_economica
    engine = controllore([["b1", "PICCOLA"]])
    verdict = prendi(engine, "b1")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    table = engine.instance_variable_get(:@table)
    assert_equal "a", table.controller_of(table.card("b1"))
  end

  def test_non_si_prende_chi_costa_troppo_ne_una_materia
    engine = controllore([["b1", "GRANDE"], ["b2", "PIETRA"]])
    refute prendi(engine, "b1")[:ok], "costa 5"
    refute prendi(engine, "b2")[:ok], "una Materia no"
    refute prendi(engine, "b1", grants: [])[:ok], "le concessioni sono quelle della carta"
  end

  def test_la_controllata_attacca_per_chi_la_comanda_con_slancio
    engine = controllore([["b1", "PICCOLA"]])
    prendi(engine, "b1")
    fronte!(engine)
    attacco = { "t" => "declare", "declaration" => { "id" => "x", "from" => "b1", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 } }
    verdict = engine.judge(attacco, actor: "a")
    assert verdict[:ok], verdict[:reason]
  end

  # §8.2 — «prendi il controllo … fino alla fine del turno»: te la comanda,
  # non te la dà. A mano non la si sposta fra le zone, nemmeno nella Zona di
  # Ritiro del proprietario. La restituzione ha la sua azione.
  def test_la_controllata_non_si_sposta_fra_le_zone
    engine = controllore([["b1", "PICCOLA"]])
    prendi(engine, "b1")
    %w[abisso ritiro hand deck].each do |zone|
      verdict = engine.judge({ "t" => "toZone", "uid" => "b1", "zone" => zone }, actor: "a")
      refute verdict[:ok], zone
      assert_match(/presa in controllo non si sposta.*§8\.2/, verdict[:reason])
      assert_match(/took control of doesn't move.*§8\.2/, verdict[:reason_en])
    end
    # Restituita, torna una carta come le altre: la manda in Ritiro il suo posto.
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" }, actor: "a")
    engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "x" => 442, "y" => 172 }, actor: "a")
    assert engine.judge({ "t" => "toZone", "uid" => "b1", "zone" => "ritiro" }, actor: "b")[:ok]
  end

  # §8.2 — il controllo non è un ingresso: la carta è già entrata sul Fronte,
  # cambia solo chi la comanda. Il suo effetto «quando entra» non si
  # riapplica per chi la prende (decisione del designer, 2026-09-07);
  # quello «quando attacca» sì (test sopra: attacca per chi la comanda).
  MOSSA = { type: "entity", keywords: [], race: "auros", flux_cost: 2,
            enter_moves: [{ target: { type: "entity", controller: "opponent" }, to: "ritiro" }] }.freeze

  def test_il_controllo_non_riapplica_l_effetto_d_ingresso
    engine = Rubyfront::Engine.new(cards: RADUNI.merge("MOSSA" => MOSSA))
    a = [{ "uid" => "rad", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "CONTROLLORE" },
         { "uid" => "a1", "owner" => "a", "zone" => "field", "order" => 1, "cardId" => "PICCOLA", "y" => 1260 }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    b = [{ "uid" => "b1", "owner" => "b", "zone" => "field", "order" => 0, "cardId" => "MOSSA", "y" => 172 },
         { "uid" => "b2", "owner" => "b", "zone" => "field", "order" => 1, "cardId" => "PICCOLA", "y" => 172 }]
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => b })
    # Le carte di B sono entrate al turno 1; il controllo arriva al turno 3.
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" }, actor: "a")
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" }, actor: "b")
    assert engine.judge({ "t" => "toZone", "uid" => "rad", "zone" => "field", "x" => 442, "y" => 1260 }, actor: "a")[:ok]
    assert prendi(engine, "b1")[:ok]
    table = engine.instance_variable_get(:@table)
    assert_equal 1, table.card("b1")[:entered], "il controllo non tocca il turno d'ingresso"
    # L'effetto «quando entra» della controllata, risolto da chi la comanda
    # contro l'altra carta di B: l'innesco è passato.
    verdict = engine.judge({ "t" => "toZone", "uid" => "b2", "zone" => "ritiro",
                             "effect" => { "source" => "b1", "event" => "on_enter_field", "entering" => "b1" } }, actor: "a")
    refute verdict[:ok]
    assert_match(/non è entrata sul Fronte questo turno.*§8\.2/, verdict[:reason])
    assert_match(/didn't enter the Front this turn.*§8\.2/, verdict[:reason_en])
    # E non conta nemmeno come «un'altra Entità che entra» per chi ascolta.
    refute engine.judge({ "t" => "draw", "seat" => "a", "count" => 1,
                          "effect" => { "source" => "a1", "event" => "on_enter_field", "entering" => "b1" } }, actor: "a")[:ok]
  end

  def test_la_restituzione_solo_a_fine_turno_e_solo_di_una_controllata
    engine = controllore([["b1", "PICCOLA"], ["b2", "PICCOLA"]])
    prendi(engine, "b1")
    refute engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "x" => 442, "y" => 172 }, actor: "a")[:ok], "non prima della fine del turno"
    refute engine.judge({ "t" => "release", "uid" => "b2", "zone" => "field" }, actor: "a")[:ok], "b2 non è controllata"
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" }, actor: "a")
    verdict = engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "x" => 442, "y" => 172 }, actor: "a")
    assert verdict[:ok], verdict[:reason]
    table = engine.instance_variable_get(:@table)
    assert_equal "b", table.controller_of(table.card("b1"))
  end

  # --- §8.2: lo sguardo col dado all'ingresso ---------------------------------

  def scrutatore(deck)
    engine = Rubyfront::Engine.new(cards: CERCATORI)
    cards = [{ "uid" => "art", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "SCRUTATORE" }]
    cards += deck.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "deck", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "toZone", "uid" => "art", "zone" => "field", "x" => 442, "y" => 1260 })
    engine
  end

  def tira_e_guarda(engine, roll:, count:, reveal: nil, retire: nil)
    action = { "t" => "look", "seat" => "a", "count" => count, "roll" => roll,
               "effect" => { "source" => "art", "event" => "on_enter_field", "entering" => "art" } }
    action["reveal"] = reveal if reveal
    action["retire"] = retire if retire
    engine.judge(action)
  end

  def test_lo_sguardo_col_dado_guarda_due_piu_meta_del_tiro
    engine = scrutatore([["d1", "PIETRA"], ["d2", "FERRO"], ["d3", "PIETRA"], ["d4", "PIETRA"], ["d5", "PIETRA"], ["d6", "PIETRA"]])
    # tiro 3 → 2 + ceil(3/2) = 4 carte
    verdict = tira_e_guarda(engine, roll: 3, count: 4, reveal: "d2", retire: "d1")
    assert verdict[:ok], verdict[:reason]
    table = engine.instance_variable_get(:@table)
    assert_equal "hand", table.card("d2")[:zone]
    assert_equal "ritiro", table.card("d1")[:zone]
    assert_equal %w[d5 d6 d3 d4], table.top_of_deck("a", 4), "le altre in fondo"
  end

  # Dal 2026-09-10: «tira un d6 e guarda tante carte quanto il tiro».
  def test_lo_sguardo_col_dado_puo_guardare_tante_carte_quanto_il_tiro
    engine = Rubyfront::Engine.new(cards: CERCATORI)
    cards = [{ "uid" => "art", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "GUARDIA" }]
    cards += [["d1", "PIETRA"], ["d2", "FERRO"], ["d3", "PIETRA"], ["d4", "PIETRA"], ["d5", "PIETRA"], ["d6", "PIETRA"]].map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "deck", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "toZone", "uid" => "art", "zone" => "field", "x" => 442, "y" => 1260 })
    refute tira_e_guarda(engine, roll: 3, count: 4, reveal: "d2", retire: "d1")[:ok], "con un 3 si guardano 3 carte, non 4"
    verdict = tira_e_guarda(engine, roll: 3, count: 3, reveal: "d2", retire: "d1")
    assert verdict[:ok], verdict[:reason]
    assert_equal "hand", copia(engine).card("d2")[:zone]
  end

  def test_il_conto_segue_il_tiro_e_il_ritiro_e_obbligatorio
    engine = scrutatore([["d1", "PIETRA"], ["d2", "FERRO"], ["d3", "PIETRA"], ["d4", "PIETRA"], ["d5", "PIETRA"]])
    refute tira_e_guarda(engine, roll: 3, count: 5)[:ok], "con un 3 si guardano 4 carte"
    refute tira_e_guarda(engine, roll: 7, count: 6)[:ok], "un tiro fuori dal dado"
    refute tira_e_guarda(engine, roll: 1, count: 3, reveal: "d2")[:ok], "una delle altre va in Ritiro"
    refute tira_e_guarda(engine, roll: 1, count: 3, reveal: "d2", retire: "d5")[:ok], "la quinta non è fra le guardate"
    refute tira_e_guarda(engine, roll: 1, count: 3, reveal: "d1", retire: "d2")[:ok], "si mostra solo un Oggetto"
    assert tira_e_guarda(engine, roll: 1, count: 3, retire: "d1")[:ok], "nessun Oggetto mostrato, una in Ritiro"
  end

  # --- §8.2: «quando attacca», lo stesso ritorno all'attacco -----------------

  EREDI_ATTACCO = EREDI.merge(
    "RIPORTANTE" => EREDI["RIPORTANTE"].merge(attack_returns: EREDI["RIPORTANTE"][:enter_returns])
  ).freeze

  # La fonte in campo dal turno 1, una permanente in Zona di Ritiro; al turno 3
  # A apre il Fronte e la fonte attacca.
  def rhen_in_carica
    engine = Rubyfront::Engine.new(cards: EREDI_ATTACCO)
    cards = [{ "uid" => "riportante", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "RIPORTANTE", "y" => 1260 },
             { "uid" => "p1", "owner" => "a", "zone" => "ritiro", "order" => 0, "cardId" => "PERMANENTE" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    engine
  end

  def riporta_attaccando(engine)
    engine.judge({ "t" => "toZone", "uid" => "p1", "zone" => "field", "x" => 2368, "y" => 1260,
                   "effect" => { "source" => "riportante", "event" => "on_attack", "entering" => "riportante" } })
  end

  def test_quando_la_fonte_attacca_riporta_una_permanente
    engine = rhen_in_carica
    fronte!(engine)
    assert engine.judge(attacco("riportante"))[:ok]
    verdict = riporta_attaccando(engine)
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    refute riporta_attaccando(engine)[:ok], "una volta per attacco"
  end

  def test_senza_attacco_dichiarato_niente_innesco
    engine = rhen_in_carica
    verdict = riporta_attaccando(engine)
    refute verdict[:ok]
    assert_match(/vuole un attacco dichiarato/, verdict[:reason])
    fronte!(engine)
    refute riporta_attaccando(engine)[:ok], "il Fronte da solo non basta"
  end

  # --- §8.2: «quando attacca con un Oggetto, pesca, poi scarta» --------------

  AVANSCOPERTA = {
    "PESCATORE" => { type: "entity", keywords: [], race: "auros",
                       attack_draws: [{ draw: 1, then_discard: 1, requires_object: true }] },
    "FERRO" => { type: "object", keywords: [] },
    "UMANO" => { type: "entity", keywords: [], race: "human" },
  }.freeze

  # L'Esploratore in campo dal turno 1, con (o senza) il Ferro addosso, una
  # carta in mano e una nel mazzo; al turno 3 A apre il Fronte e attacca.
  def esploratore(armato: true)
    engine = Rubyfront::Engine.new(cards: AVANSCOPERTA)
    cards = [{ "uid" => "esp", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "PESCATORE", "y" => 1260 },
             { "uid" => "h1", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "UMANO" },
             { "uid" => "d1", "owner" => "a", "zone" => "deck", "order" => 0, "cardId" => "UMANO" },
             { "uid" => "d2", "owner" => "a", "zone" => "deck", "order" => 1, "cardId" => "UMANO" }]
    cards << { "uid" => "ferro", "owner" => "a", "zone" => "field", "order" => 1, "cardId" => "FERRO", "assignedTo" => "esp" } if armato
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test",
                   "cards" => [{ "uid" => "bh", "owner" => "b", "zone" => "hand", "order" => 0, "cardId" => "UMANO" }] })
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    engine
  end

  def pesca_attaccando(engine, seat: "a", count: 1)
    engine.judge({ "t" => "draw", "seat" => seat, "count" => count,
                   "effect" => { "source" => "esp", "event" => "on_attack", "entering" => "esp" } })
  end

  def scarta_attaccando(engine, uid)
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "ritiro",
                   "effect" => { "source" => "esp", "event" => "on_attack", "entering" => "esp", "follow" => "discard" } })
  end

  def test_l_esploratore_armato_pesca_quando_attacca
    engine = esploratore
    fronte!(engine)
    assert engine.judge(attacco("esp"))[:ok]
    verdict = pesca_attaccando(engine)
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    refute pesca_attaccando(engine)[:ok], "una volta per attacco"
  end

  def test_l_attacco_che_ha_pescato_non_si_annulla_piu
    engine = esploratore
    fronte!(engine)
    assert engine.judge(attacco("esp"))[:ok]
    refute engine.judge({ "t" => "undeclare", "from" => "esp" })[:ruled], "prima dell'innesco l'annullamento è libero"
    assert engine.judge(attacco("esp"))[:ok]
    assert pesca_attaccando(engine)[:ok]
    verdict = engine.judge({ "t" => "undeclare", "from" => "esp" })
    refute verdict[:ok]
    assert_match(/già innescato i suoi effetti.*§8\.2/, verdict[:reason])
    assert_match(/already triggered its effects.*§8\.2/, verdict[:reason_en])
    assert copia(engine).attacking?("esp"), "la dichiarazione resta"
  end

  def test_senza_oggetto_l_innesco_non_scatta
    engine = esploratore(armato: false)
    fronte!(engine)
    engine.judge(attacco("esp"))
    verdict = pesca_attaccando(engine)
    refute verdict[:ok]
    assert_match(/senza Oggetto/, verdict[:reason])
  end

  def test_senza_attacco_dichiarato_niente_pesca
    engine = esploratore
    refute pesca_attaccando(engine)[:ok]
    fronte!(engine)
    verdict = pesca_attaccando(engine)
    refute verdict[:ok]
    assert_match(/vuole un attacco dichiarato/, verdict[:reason])
  end

  def test_la_pesca_e_di_chi_comanda_e_del_conto_della_forma
    engine = esploratore
    fronte!(engine)
    engine.judge(attacco("esp"))
    assert_match(/chi comanda/, pesca_attaccando(engine, seat: "b")[:reason])
    assert_match(/certificato/, pesca_attaccando(engine, count: 2)[:reason])
  end

  def test_lo_scarto_segue_la_pesca_una_volta_sola
    engine = esploratore
    fronte!(engine)
    engine.judge(attacco("esp"))
    prima = scarta_attaccando(engine, "h1")
    refute prima[:ok]
    assert_match(/prima si pesca/, prima[:reason])
    assert pesca_attaccando(engine)[:ok]
    verdict = scarta_attaccando(engine, "h1")
    assert verdict[:ok], verdict[:reason]
    assert_equal "ritiro", engine.instance_variable_get(:@table).card("h1")[:zone], "lo scarto va in Zona di Ritiro (§5, §6.5)"
    di_nuovo = scarta_attaccando(engine, "d1")
    refute di_nuovo[:ok]
    assert_match(/già stato fatto/, di_nuovo[:reason])
  end

  def test_si_scarta_dalla_propria_mano
    engine = esploratore
    fronte!(engine)
    engine.judge(attacco("esp"))
    assert pesca_attaccando(engine)[:ok]
    tavolo = engine.instance_variable_get(:@table)
    nel_mazzo = %w[d1 d2].find { |uid| tavolo.card(uid)[:zone] == "deck" }
    assert_match(/propria mano/, scarta_attaccando(engine, nel_mazzo)[:reason], "è ancora nel mazzo")
    assert_match(/propria mano/, scarta_attaccando(engine, "bh")[:reason], "bh è in mano a B")
  end

  def test_la_pesca_all_attacco_di_una_carta_ignota_tace
    engine = Rubyfront::Engine.new(cards: AVANSCOPERTA)
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test",
                   "cards" => [{ "uid" => "esp", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "IGNOTA", "y" => 1260 }] })
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    fronte!(engine)
    engine.judge(attacco("esp"))
    refute pesca_attaccando(engine)[:ruled]
  end

  # --- §8.2: le altre forme «quando attacca» ---------------------------------
  #
  # Le forme come le legge l'anagrafe dalle carte vere (card_index_test le
  # prova sui file): qui si prova la dogana, scenario per scenario.

  ARMATA = {
    "VIGILE" => { type: "entity", keywords: [], race: "human", power: 3, counterattack: 1,
                  attack_forms: [{ kind: "untap", who: "self", once: true, requires_object: true, face: 0 }] },
    "COMANDO" => { type: "entity", keywords: ["surge"], race: "auros", power: 3,
                   attack_forms: [{ kind: "empower", who: "self", requires_object: true, targets: "others_armed", power: 1, face: 0 }] },
    "REAGENTE" => { type: "object", keywords: [],
                 attack_forms: [{ kind: "empower", who: "object", targets: "bearer", power: 1, face: 0 },
                                { kind: "look", count: 4, reveal: { type: "matter", race: nil }, reveal_to: "hand", rest_to: "ritiro", who: "object", die: 6, on_roll: [5, 6], face: 0 }] },
    "FURIERE" => { type: "entity", keywords: [], race: "auros", power: 5,
                   attack_forms: [{ kind: "rearm", who: "ally", attacker_armed: true, face: 0 },
                                  { kind: "look", count: 2, reveal: { type: "object", race: nil }, reveal_to: "ritiro", rest_to: "deck", who: "ally", attacker_armed: true, once: true, die: nil, face: 0 }] },
    "CURATORE" => { type: "entity", keywords: [], race: "human", power: 2,
                     attack_forms: [{ kind: "heal", who: "self", amount: 2, die: 6, on_roll: [5, 6], then_recall: { type: "entity" }, face: 0 }] },
    "ECO" => { type: "entity", keywords: [], race: "human", power: 3,
               attack_forms: [{ kind: "return", who: "self", die: 6, on_roll: [5, 6], filter: { type: "entity", race: "human" }, joins: true, face: 0 }] },
    "CARICA" => { type: "entity", keywords: [], race: "human", power: 5, counterattack: 1,
                  enter_refreshes: [{ die: 20, on_roll: [15, 20] }], static_forms: [{ kind: "never_taps" }] },
    "EREDI" => { type: "matter", keywords: [], behavior: "permanent",
                 attack_forms: [{ kind: "heal", who: "permanent", attackers: { type: "entity", race: "human" }, die: 20, gain_on: [1, 6], drain_on: [15, 20], amount: "human_attackers", once: true, face: 0 }] },
    "RADUNO" => { type: "rubyfront", keywords: ["fury"],
                    attack_forms: [{ kind: "heal", who: "rubyfront", once: true, requires_attackers: { count: 3, race: "human" }, amount: 2, then_draw: 0, then_discard: 0, face: 0 },
                                   { kind: "heal", who: "rubyfront", once: true, requires_attackers: { count: 3, race: "human" }, amount: 2, then_draw: 1, then_discard: 1, face: 1 }] },
    "VENDICANTE" => { type: "entity", keywords: [], race: "human", power: 2,
                       attack_forms: [{ kind: "empower", who: "self", once: true, targets: "next_human_attacker", grants: ["revenge"], face: 0 }] },
    "RAZZIA" => { type: "entity", keywords: [], race: "human", power: 2, counterattack: 1,
                  attack_forms: [{ kind: "empower", who: "self", requires_previous_attackers: { count: 2, race: "human" }, targets: "opposing_entity", restrict: "block", face: 0 }] },
    # Il divieto di blocco «se almeno 2 Umani che controlli attaccano» (questo turno, la fonte compresa).
    "ASSALTO" => { type: "entity", keywords: [], race: "human", power: 2,
                   attack_forms: [{ kind: "empower", who: "self", requires_attackers: { count: 2, race: "human" }, targets: "opposing_entity", restrict: "block", face: 0 }] },
    "UMANO" => { type: "entity", keywords: [], race: "human", power: 2 },
    "AUROS" => { type: "entity", keywords: [], race: "auros", power: 2 },
    "FERRO" => { type: "object", keywords: [] },
    "MATERIA" => { type: "matter", keywords: [], behavior: "normal" },
  }.freeze

  # Un tavolo per gli attacchi: le carte di A (con la loro zona e i loro
  # extra) e di B scese al turno 1, poi turno 3 di A in Fase di Fronte,
  # con gli attacchi dichiarati nell'ordine dato.
  def scena(a, b: [], attacks: [])
    engine = Rubyfront::Engine.new(cards: ARMATA)
    load = lambda do |seat, list|
      cards = list.map.with_index do |(uid, id, extra), i|
        { "uid" => uid, "owner" => seat, "zone" => "field", "order" => i, "cardId" => id, "y" => seat == "a" ? 1260 : 172 }.merge(extra || {})
      end
      engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    end
    load.call("a", a)
    load.call("b", b + [["rf-b", "RADUNO", { "y" => 172 }]])
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    fronte!(engine)
    attacks.each_with_index do |uid, i|
      verdict = engine.judge({ "t" => "declare", "declaration" => { "id" => uid, "from" => uid, "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => i + 1 } })
      raise "attacco rifiutato: #{verdict[:reason]}" unless verdict[:ok]
    end
    engine
  end

  def copia(engine)
    engine.instance_variable_get(:@table)
  end

  def ref(source, entering = source, **extra)
    { "source" => source, "event" => "on_attack", "entering" => entering }.merge(extra.transform_keys(&:to_s))
  end

  # «Stappala dopo il combattimento».
  def test_il_vigile_armato_si_stappa_dopo_il_combattimento
    engine = scena([["v", "VIGILE"], ["f", "FERRO", { "assignedTo" => "v" }]], attacks: ["v"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    verdict = engine.judge({ "t" => "resolve", "seat" => "a", "battles" => [battaglia("v", damage: 3)], "untap" => ["v"] })
    assert verdict[:ok], verdict[:reason]
    refute copia(engine).card("v")[:tapped]
  end

  def test_senza_oggetto_o_senza_attacco_niente_stappata
    engine = scena([["v", "VIGILE"], ["u", "UMANO"]], attacks: ["v"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    disarmato = engine.judge({ "t" => "resolve", "seat" => "a", "battles" => [battaglia("v", damage: 3)], "untap" => ["v"] })
    assert_match(/senza Oggetto/, disarmato[:reason])
    fermo = engine.judge({ "t" => "resolve", "seat" => "a", "battles" => [battaglia("v", damage: 3)], "untap" => ["u"] })
    assert_match(/chi ha attaccato/, fermo[:reason])
  end

  # «Le altre Entità con un Oggetto assegnato che controlli prendono +1».
  def test_il_comando_potenzia_le_altre_armate
    engine = scena([["c", "COMANDO"], ["f1", "FERRO", { "assignedTo" => "c" }], ["u", "UMANO"], ["f2", "FERRO", { "assignedTo" => "u" }], ["n", "AUROS"]], attacks: ["c"])
    verdict = engine.judge({ "t" => "empower", "uid" => "u", "power" => 1, "effect" => ref("c") })
    assert verdict[:ok], verdict[:reason]
    assert_equal 1, copia(engine).card("u")[:power_bonus]
    assert_match(/già stato risolto/, engine.judge({ "t" => "empower", "uid" => "u", "power" => 1, "effect" => ref("c") })[:reason])
    assert_match(/ALTRE Entità/, engine.judge({ "t" => "empower", "uid" => "n", "power" => 1, "effect" => ref("c") })[:reason], "senza Oggetto")
    assert_match(/ALTRE Entità/, engine.judge({ "t" => "empower", "uid" => "c", "power" => 1, "effect" => ref("c") })[:reason], "non se stessa")
  end

  def test_il_comando_disarmato_non_potenzia
    engine = scena([["c", "COMANDO"], ["u", "UMANO"], ["f2", "FERRO", { "assignedTo" => "u" }]], attacks: ["c"])
    assert_match(/senza Oggetto/, engine.judge({ "t" => "empower", "uid" => "u", "power" => 1, "effect" => ref("c") })[:reason])
  end

  # L'Oggetto che potenzia chi lo porta, poi lo sguardo col dado.
  def test_il_catalizzatore_potenzia_il_portatore_e_poi_guarda_col_dado
    engine = scena([["u", "UMANO"], ["s", "REAGENTE", { "assignedTo" => "u" }], ["pescata", "UMANO", { "zone" => "deck" }], ["d1", "MATERIA", { "zone" => "deck" }], ["d2", "UMANO", { "zone" => "deck" }],
                    ["d3", "UMANO", { "zone" => "deck" }], ["d4", "UMANO", { "zone" => "deck" }]], attacks: ["u"])
    verdict = engine.judge({ "t" => "empower", "uid" => "u", "power" => 1, "effect" => ref("s", "u") })
    assert verdict[:ok], verdict[:reason]
    assert_match(/chi porta l'Oggetto/, engine.judge({ "t" => "empower", "uid" => "s", "power" => 1, "effect" => ref("s", "u") })[:reason])
    sguardo = { "t" => "look", "seat" => "a", "count" => 4, "revealTo" => "hand", "restTo" => "ritiro", "effect" => ref("s", "u", follow: "look") }
    assert_match(/non si guarda/, engine.judge(sguardo.merge("roll" => 3))[:reason])
    assert_match(/prime 4 carte/, engine.judge(sguardo.merge("roll" => 5, "count" => 3))[:reason])
    assert_match(/mostrare solo una Materia/, engine.judge(sguardo.merge("roll" => 5, "reveal" => "d2"))[:reason])
    ok = engine.judge(sguardo.merge("roll" => 6, "reveal" => "d1"))
    assert ok[:ok], ok[:reason]
    tavolo = copia(engine)
    assert_equal "hand", tavolo.card("d1")[:zone]
    assert_equal "ritiro", tavolo.card("d2")[:zone], "le altre nella Zona di Ritiro"
  end

  def test_l_oggetto_non_addosso_all_attaccante_tace
    engine = scena([["u", "UMANO"], ["n", "AUROS"], ["s", "REAGENTE", { "assignedTo" => "n" }]], attacks: ["u"])
    assert_match(/addosso a chi attacca/, engine.judge({ "t" => "empower", "uid" => "u", "power" => 1, "effect" => ref("s", "u") })[:reason])
  end

  # Il riarmo: un Oggetto dal Ritiro a chi attacca armato, e lo sguardo una volta per turno.
  def test_il_furiere_riarma_chi_attacca_armato_e_guarda_una_volta
    engine = scena([["q", "FURIERE"], ["u", "UMANO"], ["f", "FERRO", { "assignedTo" => "u" }], ["f2", "FERRO", { "zone" => "ritiro" }],
                    ["n", "AUROS"], ["f3", "FERRO", { "assignedTo" => "n" }], ["pescata", "UMANO", { "zone" => "deck" }], ["d1", "FERRO", { "zone" => "deck" }], ["d2", "UMANO", { "zone" => "deck" }]],
                   attacks: %w[u n])
    riarmo = { "t" => "toZone", "uid" => "f2", "zone" => "field", "y" => 1260, "assignTo" => "u", "effect" => ref("q", "u") }
    assert_match(/senza pagarne/, engine.judge(riarmo.merge("cost" => 2))[:reason])
    verdict = engine.judge(riarmo)
    assert verdict[:ok], verdict[:reason]
    assert_equal "u", copia(engine).card("f2")[:assigned_to]
    sguardo = { "t" => "look", "seat" => "a", "count" => 2, "revealTo" => "ritiro", "restTo" => "deck", "reveal" => "d1", "effect" => ref("q", "u", once: true) }
    assert_match(/una volta per turno/, engine.judge(sguardo.merge("effect" => ref("q", "u")))[:reason], "il riferimento deve dire once")
    ok = engine.judge(sguardo)
    assert ok[:ok], ok[:reason]
    assert_equal "ritiro", copia(engine).card("d1")[:zone]
    assert_match(/già stato risolto/, engine.judge(sguardo.merge("effect" => ref("q", "n", once: true), "reveal" => nil))[:reason], "una volta per turno, per qualunque attaccante")
  end

  def test_il_furiere_non_serve_chi_attacca_disarmato
    engine = scena([["q", "FURIERE"], ["u", "UMANO"], ["f2", "FERRO", { "zone" => "ritiro" }]], attacks: ["u"])
    verdict = engine.judge({ "t" => "toZone", "uid" => "f2", "zone" => "field", "y" => 1260, "assignTo" => "u", "effect" => ref("q", "u") })
    assert_match(/Entità con un Oggetto assegnato/, verdict[:reason])
  end

  # La cura: +2 PV, poi col dado un'Entità dal Ritiro in mano.
  def test_il_guaritore_cura_e_col_dado_riporta_in_mano
    engine = scena([["g", "CURATORE"], ["r", "UMANO", { "zone" => "ritiro" }]], attacks: ["g"])
    richiamo = { "t" => "toZone", "uid" => "r", "zone" => "hand", "roll" => 6, "effect" => ref("g", follow: "recall") }
    assert_match(/prima i PV/, engine.judge(richiamo)[:reason])
    assert_match(/2 PV/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 25 }, "effect" => ref("g") })[:reason])
    cura = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("g") })
    assert cura[:ok], cura[:reason]
    assert_equal 22, copia(engine).hp("a")
    assert_match(/non si riporta nulla/, engine.judge(richiamo.merge("roll" => 2))[:reason])
    ok = engine.judge(richiamo)
    assert ok[:ok], ok[:reason]
    assert_equal "hand", copia(engine).card("r")[:zone]
    assert_match(/già stato risolto/, engine.judge(richiamo)[:reason])
  end

  # Il ritorno: col dado un'Entità Umana dal Ritiro sul Fronte, che attacca insieme.
  def test_l_eco_riporta_un_umano_che_attacca_insieme
    engine = scena([["e", "ECO"], ["r", "UMANO", { "zone" => "ritiro" }], ["x", "AUROS", { "zone" => "ritiro" }]], attacks: ["e"])
    ritorno = { "t" => "toZone", "uid" => "r", "zone" => "field", "x" => 2368, "y" => 1260, "roll" => 5, "effect" => ref("e") }
    assert_match(/nessuno torna/, engine.judge(ritorno.merge("roll" => 4))[:reason])
    assert_match(/Entità Umana/, engine.judge(ritorno.merge("uid" => "x"))[:reason])
    ok = engine.judge(ritorno)
    assert ok[:ok], ok[:reason]
    insieme = { "t" => "declare", "declaration" => { "id" => "r", "from" => "r", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 2 },
                "effect" => ref("e", "r", follow: "join") }
    senza = engine.judge(insieme.reject { |key, _| key == "effect" })
    assert_match(/attesa di evocazione/, senza[:reason], "senza riferimento aspetta")
    verdict = engine.judge(insieme)
    assert verdict[:ok], verdict[:reason]
    assert copia(engine).attacking?("r")
  end

  # «Questa Entità non si tappa mai»: il gesto di tapparla è fermato, stapparla passa.
  def test_la_carica_non_si_tappa_mai
    engine = scena([["c", "CARICA"], ["u", "UMANO"]], attacks: ["c"])
    verdict = engine.judge({ "t" => "tap", "uid" => "c", "tapped" => true })
    refute verdict[:ok]
    assert_match(/non si tappa mai/, verdict[:reason])
    refute copia(engine).card("c")[:tapped], "attacca e resta stappata"
    assert engine.judge({ "t" => "tap", "uid" => "c", "tapped" => false })[:ok]
    assert engine.judge({ "t" => "tap", "uid" => "u", "tapped" => true })[:ok], "le altre si tappano"
    refute engine.judge({ "t" => "tap", "uid" => "zz", "tapped" => true })[:ruled], "carta ignota: silenzio"
  end

  # La stappata all'ingresso: un d20, con 15–20 stappa tutte le proprie Entità.
  def test_la_carica_entrando_col_tiro_stappa_tutti
    engine = scena([["c", "CARICA", { "zone" => "hand" }], ["u", "UMANO", { "tapped" => true }]])
    entra = { "source" => "c", "event" => "on_enter_field", "entering" => "c" }
    assert_match(/non è in campo/, engine.judge({ "t" => "refresh", "seat" => "a", "roll" => 17, "untap" => true, "effect" => entra })[:reason], "dalla mano non innesca")
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 5, "active" => "a" })
    engine.observe({ "t" => "tap", "uid" => "u", "tapped" => true })
    assert engine.judge({ "t" => "toZone", "uid" => "c", "zone" => "field", "x" => 1578, "y" => 1260, "cost" => 5 })[:ok], "la fonte scende in Preparazione"
    assert_match(/solo con 15–20/, engine.judge({ "t" => "refresh", "seat" => "a", "roll" => 3, "untap" => true, "effect" => entra })[:reason])
    assert_match(/solo con 15–20/, engine.judge({ "t" => "refresh", "seat" => "a", "roll" => 17, "untap" => false, "effect" => entra })[:reason])
    assert_match(/innesco d'ingresso/, engine.judge({ "t" => "refresh", "seat" => "a", "roll" => 17, "untap" => true, "effect" => ref("c") })[:reason])
    assert_match(/chi comanda la fonte/, engine.judge({ "t" => "refresh", "seat" => "b", "roll" => 17, "untap" => true, "effect" => entra })[:reason])
    verdict = engine.judge({ "t" => "refresh", "seat" => "a", "roll" => 17, "untap" => true, "effect" => entra })
    assert verdict[:ok], verdict[:reason]
    refute copia(engine).card("u")[:tapped]
    assert_match(/già stato risolto/, engine.judge({ "t" => "refresh", "seat" => "a", "roll" => 17, "untap" => true, "effect" => entra })[:reason])
    mancato = scena([["c", "CARICA", { "zone" => "hand" }], ["u", "UMANO", { "tapped" => true }]])
    mancato.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    mancato.judge({ "t" => "turn", "turn" => 5, "active" => "a" })
    mancato.observe({ "t" => "tap", "uid" => "u", "tapped" => true })
    assert mancato.judge({ "t" => "toZone", "uid" => "c", "zone" => "field", "x" => 1578, "y" => 1260, "cost" => 5 })[:ok]
    assert mancato.judge({ "t" => "refresh", "seat" => "a", "roll" => 3, "untap" => false, "effect" => entra })[:ok], "il tiro mancato passa e consuma l'innesco"
    assert copia(mancato).card("u")[:tapped], "col tiro mancato nessuno si stappa"
    assert_match(/già stato risolto/, mancato.judge({ "t" => "refresh", "seat" => "a", "roll" => 17, "untap" => true, "effect" => entra })[:reason])
  end

  # La Materia permanente: il d20 quando attaccano gli Umani.
  def test_gli_eredi_col_d20_curano_o_prosciugano_una_volta_per_turno
    engine = scena([["m", "EREDI"], ["u1", "UMANO"], ["u2", "UMANO"], ["n", "AUROS"]], attacks: %w[u1 u2 n])
    assert_match(/non succede nulla/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "roll" => 10, "effect" => ref("m", "u1", once: true) })[:reason])
    assert_match(/Entità Umane che controlli/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "roll" => 4, "effect" => ref("m", "n", once: true) })[:reason])
    assert_match(/una volta per turno/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "roll" => 4, "effect" => ref("m", "u1") })[:reason], "il riferimento deve dire «una volta»")
    cura = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "roll" => 4, "effect" => ref("m", "u1", once: true) })
    assert cura[:ok], cura[:reason]
    # L'ondata è una: col secondo Umano l'innesco è già scattato (deciso 2026-09-10).
    assert_match(/già stato risolto/, engine.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => 18 }, "roll" => 18, "effect" => ref("m", "u2", once: true) })[:reason])
    # Il prosciugamento, su un tavolo nuovo.
    engine = scena([["m", "EREDI"], ["u1", "UMANO"], ["u2", "UMANO"]], attacks: %w[u1 u2])
    assert_match(/perde 2 PV/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 24 }, "roll" => 18, "effect" => ref("m", "u2", once: true) })[:reason])
    danno = engine.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => 18 }, "roll" => 18, "effect" => ref("m", "u2", once: true) })
    assert danno[:ok], danno[:reason]
    assert_equal 18, copia(engine).hp("b")
  end

  # Il raduno: al terzo Umano, +2 PV una volta per turno; il Nexus poi pesca e scarta.
  # Il Rubyfront è SCHIERATO (fila del Fronte, 1260): in Zona di Richiamo
  # (1756) non avrebbe abilità (§3.1, test più sotto).
  def test_il_raduno_al_terzo_umano_una_volta_per_turno
    engine = scena([["rf", "RADUNO", { "y" => 1260 }], ["u1", "UMANO"], ["u2", "UMANO"], ["u3", "UMANO"]], attacks: %w[u1 u2])
    assert_match(/almeno 3 Entità Umane/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u2", once: true) })[:reason])
    engine.judge({ "t" => "declare", "declaration" => { "id" => "u3", "from" => "u3", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 3 } })
    verdict = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u3", once: true) })
    assert verdict[:ok], verdict[:reason]
    assert_match(/già stato risolto/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 24 }, "effect" => ref("rf", "u1", once: true) })[:reason])
    assert_match(/peschi dopo la cura/, engine.judge({ "t" => "draw", "seat" => "a", "count" => 1, "effect" => ref("rf", "u3", once: true, follow: "draw") })[:reason], "la faccia del Rubyfront non pesca")
  end

  def test_il_nexus_dopo_la_cura_pesca_e_scarta
    engine = scena([["rf", "RADUNO", { "y" => 1260, "face" => 1 }], ["u1", "UMANO"], ["u2", "UMANO"], ["u3", "UMANO"],
                    ["h", "UMANO", { "zone" => "hand" }], ["d", "UMANO", { "zone" => "deck" }]], attacks: %w[u1 u2 u3])
    pesca = { "t" => "draw", "seat" => "a", "count" => 1, "effect" => ref("rf", "u3", once: true, follow: "draw") }
    assert_match(/prima i PV/, engine.judge(pesca)[:reason])
    assert engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u3", once: true) })[:ok]
    assert engine.judge(pesca)[:ok]
    assert_match(/già stato risolto/, engine.judge(pesca)[:reason])
    scarto = engine.judge({ "t" => "toZone", "uid" => "h", "zone" => "ritiro", "effect" => ref("rf", "u3", once: true, follow: "discard") })
    assert scarto[:ok], scarto[:reason]
    assert_equal "ritiro", copia(engine).card("h")[:zone]
  end

  # §3.1 — «abilità (principale e speciali) e Materie sono utilizzabili solo
  # quando è in campo: schierarlo serve a sbloccarle». In Zona di Richiamo
  # il Rubyfront si attacca, ma non innesca niente.
  def test_il_rubyfront_in_zona_di_richiamo_non_ha_abilita
    engine = scena([["rf", "RADUNO", { "y" => 1756 }], ["u1", "UMANO"], ["u2", "UMANO"], ["u3", "UMANO"]], attacks: %w[u1 u2 u3])
    verdict = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u3", once: true) })
    refute verdict[:ok]
    assert_match(/Zona di Richiamo non ha abilità.*§3\.1/, verdict[:reason])
    assert_match(/Recall Zone has no abilities.*§3\.1/, verdict[:reason_en])
    # Schierato — la fila del Fronte — la stessa cura passa.
    engine.observe({ "t" => "move", "uid" => "rf", "x" => 30, "y" => 1260, "z" => 3, "cost" => 0 })
    assert_equal 1260, copia(engine).card("rf")[:row]
    verdict = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u3", once: true) })
    assert verdict[:ok], verdict[:reason]
  end

  def test_la_fila_ignota_del_rubyfront_non_accusa
    # Snapshot da una lavagna che non segnava la fila: nel dubbio è in gioco.
    engine = scena([["rf", "RADUNO", { "y" => nil }], ["u1", "UMANO"], ["u2", "UMANO"], ["u3", "UMANO"]], attacks: %w[u1 u2 u3])
    assert_nil copia(engine).card("rf")[:row]
    verdict = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u3", once: true) })
    assert verdict[:ok], verdict[:reason]
  end

  # La Vendetta al PROSSIMO Umano che attacca.
  def test_il_vendicatore_concede_vendetta_al_prossimo_umano
    engine = scena([["v", "VENDICANTE"], ["u1", "UMANO"], ["u2", "UMANO"], ["n", "AUROS"]], attacks: %w[v n u1 u2])
    assert_match(/PROSSIMA Entità Umana/, engine.judge({ "t" => "empower", "uid" => "u2", "grants" => ["revenge"], "effect" => ref("v", "v", once: true) })[:reason])
    assert_match(/PROSSIMA Entità Umana/, engine.judge({ "t" => "empower", "uid" => "n", "grants" => ["revenge"], "effect" => ref("v", "v", once: true) })[:reason])
    verdict = engine.judge({ "t" => "empower", "uid" => "u1", "grants" => ["revenge"], "effect" => ref("v", "v", once: true) })
    assert verdict[:ok], verdict[:reason]
    assert_equal ["revenge"], copia(engine).card("u1")[:grants]
  end

  # Il divieto di blocco: se nel turno precedente hanno attaccato almeno 2 Umani, un'Entità avversaria non blocca.
  def test_la_razzia_vieta_il_blocco_dopo_un_turno_di_umani
    engine = scena([["r", "RAZZIA"], ["u1", "UMANO"], ["u2", "UMANO"]], b: [["b1", "AUROS"]], attacks: %w[u1 u2])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert risolvi(engine, [battaglia("u1", damage: 2), battaglia("u2", damage: 2)])[:ok]
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 5, "active" => "a" })
    fronte!(engine)
    assert engine.judge({ "t" => "declare", "declaration" => { "id" => "r", "from" => "r", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 } })[:ok]
    verdict = engine.judge({ "t" => "empower", "uid" => "b1", "restrict" => "block", "effect" => ref("r") })
    assert verdict[:ok], verdict[:reason]
    assert copia(engine).card("b1")[:cannot_block]
    assert_match(/avversaria/, engine.judge({ "t" => "empower", "uid" => "u1", "restrict" => "block", "effect" => ref("r") })[:reason])
  end

  def test_la_razzia_senza_umani_nel_turno_precedente_tace
    engine = scena([["r", "RAZZIA"], ["u1", "UMANO"]], b: [["b1", "AUROS"]], attacks: ["r"])
    assert_match(/turno precedente/, engine.judge({ "t" => "empower", "uid" => "b1", "restrict" => "block", "effect" => ref("r") })[:reason])
  end

  # Il divieto di blocco di QUESTO turno: se almeno 2 Umani che controlli attaccano (la fonte compresa),
  # un'Entità avversaria non blocca. Il turno precedente non c'entra.
  def test_l_assalto_vieta_il_blocco_con_due_umani_all_attacco
    engine = scena([["s", "ASSALTO"], ["u1", "UMANO"]], b: [["b1", "AUROS"]], attacks: %w[s u1])
    verdict = engine.judge({ "t" => "empower", "uid" => "b1", "restrict" => "block", "effect" => ref("s") })
    assert verdict[:ok], verdict[:reason]
    assert copia(engine).card("b1")[:cannot_block]
    assert_match(/avversaria/, engine.judge({ "t" => "empower", "uid" => "u1", "restrict" => "block", "effect" => ref("s") })[:reason])
  end

  def test_l_assalto_da_solo_o_con_un_auros_tace
    solo = scena([["s", "ASSALTO"], ["u1", "UMANO"]], b: [["b1", "AUROS"]], attacks: ["s"])
    assert_match(/almeno 2 Entità Umane/, solo.judge({ "t" => "empower", "uid" => "b1", "restrict" => "block", "effect" => ref("s") })[:reason])
    auros = scena([["s", "ASSALTO"], ["n", "AUROS"]], b: [["b1", "AUROS"]], attacks: %w[s n])
    assert_match(/almeno 2 Entità Umane/, auros.judge({ "t" => "empower", "uid" => "b1", "restrict" => "block", "effect" => ref("s") })[:reason])
  end
  # --- Il secondo lotto di forme: statici, Stasi, blocco multiplo, Materie, Nexus ---
  #
  # Le forme come le legge l'anagrafe dalle carte vere (card_index_test);
  # qui la dogana, scenario per scenario, su un'anagrafe di prova.

  EREDITA = {
    "CORRIDORE" => { type: "entity", keywords: [], race: "human", power: 1, flux_cost: 1,
                   static_forms: [{ kind: "self_power", amount: 1, while_attacking: true, requires_other: { type: "entity", race: "human" } }] },
    "SIMULACRO" => { type: "entity", keywords: [], race: "simulacrum", power: 3, flux_cost: 4,
                     static_forms: [{ kind: "self_power", amount: 1, per_other: { type: "entity", race: "human" } }] },
    "SCUDO" => { type: "object", keywords: [], flux_cost: 2,
                 static_forms: [{ kind: "bearer_power", amount: 1 }],
                 grants_while_assigned: [{ keywords: ["stasis"], if_race: "human" }] },
    "CINTURA" => { type: "object", keywords: [], flux_cost: 3,
                   static_forms: [{ kind: "bearer_power", amount: 1, per: { type: "entity", race: "human" }, multi_block: true }] },
    "UMANO" => { type: "entity", keywords: [], race: "human", power: 2, flux_cost: 2, enables: [[{ type: "dynamic", max_grade: 2 }, { type: "destructive", max_grade: 2 }]] },
    "PICCOLO" => { type: "entity", keywords: [], race: "human", power: 1, flux_cost: 1 },
    "PRESA" => { type: "entity", keywords: [], race: "auros", power: 1, flux_cost: 1, static_forms: [{ kind: "self_power", amount: 1, while_armed: true }] },
    "AUROS" => { type: "entity", keywords: [], race: "auros", power: 2, flux_cost: 2 },
    "GROSSO" => { type: "entity", keywords: [], race: "auros", power: 4, counterattack: nil, flux_cost: 4 },
    "SPINOSO" => { type: "entity", keywords: [], race: "human", power: 3, counterattack: 1, flux_cost: 3 },
    "IRTA" => { type: "entity", keywords: [], race: "auros", power: 2, counterattack: 1, flux_cost: 3,
                static_forms: [{ kind: "self_counter", amount: 1, per_object: true }] },
    "SPINE" => { type: "object", keywords: [], flux_cost: 2, static_forms: [{ kind: "bearer_counter", amount: 1 }] },
    "RUBINO" => { type: "rubyfront", keywords: [] },
    "RADUNO" => { type: "rubyfront", keywords: ["fury"], enables: [[], []],
                    nexus: { face: 1, conditions: [{ count: 4, type: "entity", race: "human" }], discard: { count: 1, type: "entity" }, recovery: 5 },
                    flip_forms: [{ kind: "move", card_id: "RIPORTANTE", from: "field", to: "abisso" }, { kind: "seal", card_id: "RIPORTANTE" }, { kind: "draw", count: 1 }] },
    "FORGIA" => { type: "rubyfront", keywords: [], power: nil, counterattack: nil,
                  nexus: { face: 1, conditions: [{ count: 3, type: "entity", race: nil, armed: true }], discard: { count: 1, type: nil }, recovery: 5 },
                  assign_forms: [{ kind: "ends", face: 0, swap: true, then_draw: 1, then_discard: 1, once: true },
                                 { kind: "ends", face: 1, to_hand: true, other_to_retire: true, once: true }] },
    "CARICA" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 3, matter: { type: "dynamic", grade: 2 },
                  resolve_forms: [{ kind: "search", count: 5, die: 20, bands: { "matter" => [1, 7], "object" => [8, 14], "entity" => [15, 20] },
                                    reveal_to: "hand", if_no_reveal_top: true, then_retire: true, rest_to: "deck" }] },
    "VESTIGIO" => { type: "object", keywords: [], flux_cost: 3, static_forms: [{ kind: "bearer_power", amount: 2 }],
                    death_forms: [{ kind: "remain", to: "ritiro", then_rearm: { other: true, to: "unarmed", free: true } }] },
    "RIPORTANTE" => { type: "entity", keywords: [], race: "human", power: 6, flux_cost: 6 },
    "PERMANENTE" => { type: "matter", keywords: [], behavior: "permanent", flux_cost: 2, matter: { type: "dynamic", grade: 1 } },
    "ATTRAZIONE" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 2, matter: { type: "dynamic", grade: 1 },
                      resolve_forms: [{ kind: "look", count: 4, reveal: { type: "entity", race: "human" }, reveal_to: "hand", rest_to: "deck", show_up_to: 2 }] },
    "FORMAZIONE" => { type: "matter", keywords: [], behavior: "reactive", flux_cost: 2, matter: { type: "dynamic", grade: 1 },
                      resolve_forms: [{ kind: "empower", targets: "own_entity", race: "human", power: 1, untap: true }] },
    "IMPATTO" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 1, matter: { type: "dynamic", grade: 1 },
                   resolve_forms: [{ kind: "move", target: { type: "entity", controller: "opponent", max_cost: 2 }, to: "ritiro" }] },
    "CAMPO" => { type: "matter", keywords: [], behavior: "permanent", flux_cost: 3, matter: { type: "destructive", grade: 1 },
                 resolve_forms: [{ kind: "exile", target: { permanent: true, controller: "opponent" }, to: "abisso", hold: true }] },
    "FORZA" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 3, matter: { type: "dynamic", grade: 2 },
                 resolve_forms: [{ kind: "fortune", die: 20, gain: { on: [1, 6], amount: 4 }, deploy: { on: [7, 13], filter: { type: "entity", race: "human", max_cost: 2 } },
                                   draw: { on: [14, 19], count: 1 }, all_on: [20, 20] }] },
    "COORDINATO" => { type: "matter", keywords: [], behavior: "reactive", flux_cost: 4, matter: { type: "dynamic", grade: 2 },
                      resolve_forms: [{ kind: "empower", targets: "own_entities", race: "human", counter: 1, untap: true, requires: { count: 3, race: "human" } }] },
    "RIFLESSO" => { type: "matter", keywords: [], behavior: "reactive", flux_cost: 2, matter: nil,
                    resolve_forms: [{ kind: "block", requires_armed: 2, heal: 3, as_block: true }] },
    "GIUDIZIO" => { type: "matter", keywords: [], behavior: "reactive", flux_cost: 5, matter: { type: "destructive", grade: 2 },
                    resolve_forms: [{ kind: "destroy", target: { type: "entity", controller: "any" }, to: "abisso", discount: { amount: 3, if_target: "tapped" } }] },
    "FRATTURA" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 3, matter: { type: "dynamic", grade: 2 },
                    resolve_forms: [{ kind: "move", target: { type: "entity", controller: "opponent", max_cost: nil }, to: "ritiro", discount: { amount: 1, if_armed_at_least: 2 } }] },
    "RIFRAZIONE" => { type: "matter", keywords: [], behavior: "reactive", flux_cost: 2, matter: { type: "dynamic", grade: 1 },
                      resolve_forms: [{ kind: "weaken", target: { type: "entity", controller: "opponent", attacking: true }, amount: -1, per_armed: true }] },
    "AMPLIFICA" => { type: "matter", keywords: [], behavior: "reactive", flux_cost: 2, matter: { type: "dynamic", grade: 1 },
                     resolve_forms: [{ kind: "empower", targets: "own_armed", power: 1, up_to: 2, untap: true }] },
    "PRISMA" => { type: "object", keywords: [], flux_cost: 3,
                  assign_forms: [{ kind: "exile", target: { type: "entity", controller: "opponent" }, to: "abisso", hold: true }] },
    "PORTATORE" => { type: "entity", keywords: [], race: "auros", power: 3, flux_cost: 4,
                     static_forms: [{ kind: "assign_discount", amount: 1 }], assign_forms: [{ kind: "draw", count: 1, to_self: true }] },
    "LAMA" => { type: "entity", keywords: [], race: "auros", power: 5, flux_cost: 5, static_forms: [{ kind: "others_armed_power", amount: 1 }] },
    "ASSALTO" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 4, matter: { type: "destructive", grade: 2 },
                   resolve_forms: [{ kind: "drain", amount: "objects" }] },
    "EVERSIONE" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 3, matter: { type: "destructive", grade: 1 },
                     resolve_forms: [{ kind: "destroy", target: { type: "entity", controller: "opponent" }, to: "abisso", discount: nil, then_lose: 2 }] },
  }.freeze

  # Un tavolo del secondo lotto: le carte di A e di B (con zona ed extra)
  # scese al turno 1, poi turno 3 di A in Preparazione, con 10 Flussi per
  # posto. `attacks` dichiara il Fronte e gli attacchi di A.
  def eredita(a, b: [], attacks: nil)
    engine = Rubyfront::Engine.new(cards: EREDITA)
    load = lambda do |seat, list|
      cards = list.map.with_index do |(uid, id, extra), i|
        { "uid" => uid, "owner" => seat, "zone" => "field", "order" => i, "cardId" => id, "y" => seat == "a" ? 1260 : 172 }.merge(extra || {})
      end
      engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    end
    load.call("a", a + [["rf-a", "RUBINO", { "y" => 1260 }]])
    load.call("b", b + [["rf-b", "RUBINO", { "y" => 172 }]])
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    Rubyfront::Table::SEATS.each { |seat| engine.judge({ "t" => "player", "seat" => seat, "patch" => { "flux" => 10, "fluxMax" => 10 } }) }
    if attacks
      fronte!(engine)
      attacks.each_with_index do |uid, i|
        verdict = engine.judge({ "t" => "declare", "declaration" => { "id" => uid, "from" => uid, "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => i + 1 } })
        raise "attacco rifiutato: #{verdict[:reason]}" unless verdict[:ok]
      end
    end
    engine
  end

  def blocco(engine, blocker, attacker, kind = "block", actor: "b")
    engine.judge({ "t" => "declare", "declaration" => { "id" => blocker, "from" => blocker, "to" => attacker, "kind" => kind, "seat" => "b", "order" => 0 } }, actor: actor)
  end

  def res_ref(source)
    { "source" => source, "event" => "on_resolve", "entering" => source }
  end

  def esito(attacker, blocker: nil, kind: "unblocked", attacker_dies: false, blocker_dies: false, damage: 0, stasis: false, spent: false)
    battaglia(attacker, blocker: blocker, kind: kind, attacker_dies: attacker_dies, blocker_dies: blocker_dies, damage: damage)
      .merge("blockerStasis" => stasis, "blockerSpent" => spent)
  end

  # --- §8.2: gli statici di Potenza ------------------------------------------

  def test_il_ragazzo_vale_2_in_attacco_solo_con_un_altro_umano
    solo = eredita([["r", "CORRIDORE"], ["x", "AUROS"]], attacks: ["r"])
    solo.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/non torna/, risolvi(solo, [esito("r", damage: 2)])[:reason])
    assert risolvi(solo, [esito("r", damage: 1)])[:ok]
    insieme = eredita([["r", "CORRIDORE"], ["u", "UMANO"]], attacks: ["r"])
    insieme.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/non torna/, risolvi(insieme, [esito("r", damage: 1)])[:reason])
    assert risolvi(insieme, [esito("r", damage: 2)])[:ok]
  end

  def test_il_ragazzo_in_difesa_resta_un_1
    engine = eredita([["u", "UMANO"], ["r", "CORRIDORE"]], b: [["g", "GROSSO"]])
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    fronte!(engine)
    engine.judge({ "t" => "declare", "declaration" => { "id" => "g", "from" => "g", "to" => "rf-a", "kind" => "attack", "seat" => "b", "order" => 1 } }, actor: "b")
    engine.judge({ "t" => "phase", "phase" => "reazione" }, actor: "b")
    assert engine.judge({ "t" => "declare", "declaration" => { "id" => "r", "from" => "r", "to" => "g", "kind" => "block", "seat" => "a", "order" => 0 } }, actor: "a")[:ok]
    verdict = engine.judge({ "t" => "resolve", "seat" => "b", "battles" => [esito("g", blocker: "r", kind: "block", blocker_dies: true)] }, actor: "a")
    assert verdict[:ok], verdict[:reason]
  end

  def test_il_simulacro_conta_le_altre_entita_umane
    engine = eredita([["s", "SIMULACRO"], ["u1", "UMANO"], ["u2", "UMANO"], ["x", "AUROS"]], attacks: ["s"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/non torna/, risolvi(engine, [esito("s", damage: 3)])[:reason])
    assert risolvi(engine, [esito("s", damage: 5)])[:ok], "3 più 2 Umani"
  end

  def test_gli_oggetti_danno_potenza_al_portatore
    engine = eredita([["u", "UMANO"], ["p", "PICCOLO"], ["o", "SCUDO", { "assignedTo" => "u" }], ["c", "CINTURA", { "assignedTo" => "p" }]], attacks: %w[u p])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    # Scudo: 2 + 1. Cintura: 1 + 1 per ogni Umano sul Fronte (due, portatrice compresa).
    assert risolvi(engine, [esito("u", damage: 3), esito("p", damage: 3)])[:ok]
  end

  def test_la_presa_vale_uno_in_piu_solo_con_un_oggetto_addosso
    nuda = eredita([["r", "PRESA"]], attacks: ["r"])
    nuda.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/non torna/, risolvi(nuda, [esito("r", damage: 2)])[:reason])
    assert risolvi(nuda, [esito("r", damage: 1)])[:ok]
    armata = eredita([["r", "PRESA"], ["o", "SCUDO", { "assignedTo" => "r" }]], attacks: ["r"])
    armata.judge({ "t" => "phase", "phase" => "reazione" })
    # 1 stampato, +1 «se ha un Oggetto assegnato», +1 dello Scudo.
    assert_match(/non torna/, risolvi(armata, [esito("r", damage: 2)])[:reason])
    assert risolvi(armata, [esito("r", damage: 3)])[:ok]
  end

  # --- §6.3: gli statici di Contrattacco -------------------------------------

  def test_il_contrattacco_cresce_con_gli_oggetti_addosso_e_con_quello_dell_oggetto
    # Nuda: 2 + 1 di Contrattacco = 3 < 4, muore. Armata con l'Oggetto a
    # Contrattacco: 2 + 1 + 1 per l'Oggetto + 1 dell'Oggetto = 5 ≥ 4, vince.
    nuda = eredita([["g", "GROSSO"]], b: [["i", "IRTA"]], attacks: ["g"])
    nuda.judge({ "t" => "phase", "phase" => "reazione" })
    assert blocco(nuda, "i", "g", "counter")[:ok]
    assert_match(/non torna/, risolvi(nuda, [esito("g", blocker: "i", kind: "counter", attacker_dies: true)])[:reason])
    assert risolvi(nuda, [esito("g", blocker: "i", kind: "counter", blocker_dies: true)])[:ok]
    armata = eredita([["g", "GROSSO"]], b: [["i", "IRTA"], ["s", "SPINE", { "assignedTo" => "i" }]], attacks: ["g"])
    armata.judge({ "t" => "phase", "phase" => "reazione" })
    assert blocco(armata, "i", "g", "counter")[:ok]
    verdict = risolvi(armata, [esito("g", blocker: "i", kind: "counter", attacker_dies: true)])
    assert verdict[:ok], verdict[:reason]
  end

  def test_la_potenza_non_scende_sotto_zero
    engine = eredita([["p", "PICCOLO"]], attacks: ["p"])
    engine.observe({ "t" => "empower", "uid" => "p", "power" => -3, "effect" => { "source" => "p", "event" => "on_attack", "entering" => "p" } })
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert risolvi(engine, [esito("p", damage: 0)])[:ok]
  end

  # --- §8.1: la Stasi concessa da un Oggetto ---------------------------------

  def test_la_stasi_salva_l_umano_che_blocca_e_non_l_auros
    engine = eredita([["g", "GROSSO"], ["g2", "GROSSO"]], b: [["u", "UMANO"], ["x", "AUROS"], ["o", "SCUDO", { "assignedTo" => "u" }], ["o2", "SCUDO", { "assignedTo" => "x" }]], attacks: %w[g g2])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert blocco(engine, "u", "g")[:ok]
    assert blocco(engine, "x", "g2")[:ok]
    assert_match(/non torna/, risolvi(engine, [esito("g", blocker: "u", kind: "block", blocker_dies: true), esito("g2", blocker: "x", kind: "block", blocker_dies: true)])[:reason])
    verdict = risolvi(engine, [esito("g", blocker: "u", kind: "block", stasis: true), esito("g2", blocker: "x", kind: "block", blocker_dies: true)])
    assert verdict[:ok], verdict[:reason]
    u = copia(engine).card("u")
    assert_equal "field", u[:zone]
    assert u[:stasis]
    assert u[:tapped]
    assert_equal "abisso", copia(engine).card("x")[:zone]
  end

  def test_in_stasi_non_si_stappa_non_si_ritira_e_un_effetto_la_libera
    engine = eredita([["g", "GROSSO"]], b: [["u", "UMANO"], ["o", "SCUDO", { "assignedTo" => "u" }]], attacks: ["g"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    blocco(engine, "u", "g")
    assert risolvi(engine, [esito("g", blocker: "u", kind: "block", stasis: true)])[:ok]
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" }, actor: "b")
    assert copia(engine).card("u")[:tapped], "tappata per sempre"
    # Il Ritiro è un gesto libero (§6.2, decisione del designer): la Stasi
    # non lo ferma. Quel che la Stasi tiene è la tappata permanente.
    assert engine.judge({ "t" => "toZone", "uid" => "u", "zone" => "ritiro" }, actor: "b")[:ok]
    engine.observe({ "t" => "refresh", "seat" => "b", "roll" => 17, "untap" => true, "effect" => { "source" => "u", "event" => "on_enter_field", "entering" => "u" } })
    refute copia(engine).card("u")[:tapped], "un effetto la stappa"
  end

  def test_la_stasi_nel_contrattacco_sostituisce_la_copertura
    engine = eredita([["g", "GROSSO"]], b: [["s", "SPINOSO"], ["o", "SCUDO", { "assignedTo" => "s" }]], attacks: ["g"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    blocco(engine, "s", "g", "counter")
    # 3 + 1 (Scudo) + 1 (Contrattacco) = 5 > 4: l'attaccante muore, nessuna Stasi.
    assert risolvi(engine, [esito("g", blocker: "s", kind: "counter", attacker_dies: true)])[:ok]
  end

  # --- §8.2: il blocco multiplo -----------------------------------------------

  def test_la_cintura_apre_l_attaccante_a_piu_bloccanti
    engine = eredita([["u", "UMANO"], ["c", "CINTURA", { "assignedTo" => "u" }], ["x", "AUROS"]], b: [["b1", "AUROS"], ["b2", "AUROS"], ["b3", "AUROS"]], attacks: %w[u x])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert blocco(engine, "b1", "u")[:ok]
    assert blocco(engine, "b2", "u")[:ok], "la Cintura lo rende bloccabile da più Entità"
    assert blocco(engine, "b3", "x")[:ok]
    assert_match(/1 contro 1/, blocco(engine, "b3", "x")[:reason].to_s + engine.judge({ "t" => "declare", "declaration" => { "id" => "b3", "from" => "b3", "to" => "x", "kind" => "block", "seat" => "b", "order" => 0 } }, actor: "b")[:reason].to_s) if false
    # Senza Cintura il secondo bloccante è fermato.
    engine.judge({ "t" => "undeclare", "from" => "b3" }, actor: "b")
    assert blocco(engine, "b3", "x")[:ok]
    assert_match(/1 contro 1/, engine.judge({ "t" => "declare", "declaration" => { "id" => "b2", "from" => "b2", "to" => "x", "kind" => "block", "seat" => "b", "order" => 0 } }, actor: "b")[:reason])
    # Ogni bloccante ha la sua battaglia: u vale 2 + 1 = 3 contro due Auros da 2.
    battles = [esito("u", blocker: "b1", kind: "block", blocker_dies: true), esito("u", blocker: "b2", kind: "block", blocker_dies: true),
               esito("x", blocker: "b3", kind: "block", attacker_dies: true, blocker_dies: true)]
    verdict = risolvi(engine, battles)
    assert verdict[:ok], verdict[:reason]
    assert_equal "field", copia(engine).card("u")[:zone]
    assert_equal "abisso", copia(engine).card("b2")[:zone]
  end

  # --- §7.2: le finestre delle Reattive ---------------------------------------

  # Gioca dalla mano. Una Reattiva porta il segno della catena (§7.2), come
  # fa il client: la catena resta aperta finché l'avversario non `accetta!`.
  def gioca_carta(engine, uid, cost:, actor: "a", x: 2368, y: 1260, extra: {})
    card = copia(engine).card(uid)
    known = card && EREDITA[card[:card_id]]
    extra = { "chain" => true }.merge(extra) if known && known[:behavior] == "reactive"
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => x, "y" => y, "cost" => cost }.merge(extra), actor: actor)
  end

  # §7.2 — chi deve rispondere accetta: la catena si risolve.
  def accetta!(engine, seat)
    verdict = engine.judge({ "t" => "pass", "seat" => seat }, actor: seat)
    raise "accettazione rifiutata: #{verdict[:reason]}" unless verdict[:ok]
    verdict
  end

  def test_una_reattiva_prima_dell_ondata_e_solo_di_chi_e_di_turno
    engine = eredita([["u", "UMANO"], ["m", "FORMAZIONE", { "zone" => "hand" }]], b: [["v", "UMANO"], ["n", "FORMAZIONE", { "zone" => "hand" }]])
    assert_match(/solo in Fase di Fronte/, gioca_carta(engine, "m", cost: 2)[:reason])
    fronte!(engine)
    assert_match(/di chi è di turno/, gioca_carta(engine, "n", cost: 2, actor: "b", y: 172)[:reason], "il Pre-Fronte non c'è più (§6.3)")
    assert gioca_carta(engine, "m", cost: 2)[:ok]
    accetta!(engine, "b")
  end

  def test_a_ondata_dichiarata_le_reattive_sono_del_difensore_in_reazione
    engine = eredita([["u", "UMANO"], ["m", "FORMAZIONE", { "zone" => "hand" }]],
                     b: [["v", "UMANO"], ["v2", "UMANO"], ["v3", "UMANO"], ["n", "FORMAZIONE", { "zone" => "hand" }], ["c", "COORDINATO", { "zone" => "hand" }]], attacks: ["u"])
    assert_match(/ondata dichiarata/, gioca_carta(engine, "m", cost: 2)[:reason])
    assert_match(/ondata dichiarata/, gioca_carta(engine, "n", cost: 2, actor: "b", y: 172)[:reason])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/risponde solo in catena/, gioca_carta(engine, "m", cost: 2)[:reason], "chi attacca non inizia Reattive in Reazione (§6.4)")
    assert gioca_carta(engine, "n", cost: 2, actor: "b", y: 172)[:ok], "in Reazione il difensore gioca qualsiasi Reattiva, non solo un bloccante (§6.4, §7.2)"
    accetta!(engine, "a")
    assert engine.judge({ "t" => "toZone", "uid" => "n", "zone" => "abisso" }, actor: "b")[:ok], "la Reattiva risolta si consuma"
    assert gioca_carta(engine, "c", cost: 4, actor: "b", y: 172)[:ok], "e anche quella che non blocca nessuno"
  end

  # --- §7.2/§8.2: le Materie alla risoluzione ---------------------------------

  # Lo sguardo: guarda le prime 4, un'Entità Umana in mano, le altre in fondo.
  def test_lo_sguardo_alla_risoluzione_guarda_quattro_e_mostra_un_umano
    # La Pesca del turno 3 prende «d0»: sotto restano d1, d2, d3.
    engine = eredita([["u", "UMANO"], ["m", "ATTRAZIONE", { "zone" => "hand" }], ["d0", "AUROS", { "zone" => "deck", "order" => 0 }],
                      ["d1", "AUROS", { "zone" => "deck", "order" => 1 }], ["d2", "UMANO", { "zone" => "deck", "order" => 2 }], ["d3", "UMANO", { "zone" => "deck", "order" => 5 }]])
    assert gioca_carta(engine, "m", cost: 2)[:ok]
    accetta!(engine, "b")
    look = { "t" => "look", "seat" => "a", "count" => 4, "reveal" => "d2", "effect" => res_ref("m") }
    assert_match(/prime 4/, engine.judge(look.merge("count" => 3))[:reason])
    assert_match(/Entità Umana/, engine.judge(look.merge("reveal" => "d1"))[:reason])
    verdict = engine.judge(look)
    assert verdict[:ok], verdict[:reason]
    assert_equal "hand", copia(engine).card("d2")[:zone]
    assert_match(/già stato risolto/, engine.judge(look.merge("reveal" => "d3"))[:reason])
  end

  # La stappata: stappa un'Entità Umana che controlli: +1 Potenza.
  def test_la_stappata_singola_stappa_un_umano_e_lo_potenzia
    engine = eredita([["u", "UMANO", { "tapped" => true }], ["u2", "UMANO", { "tapped" => true }], ["x", "AUROS", { "tapped" => true }], ["m", "FORMAZIONE", { "zone" => "hand" }]])
    fronte!(engine)
    assert gioca_carta(engine, "m", cost: 2)[:ok]
    accetta!(engine, "b")
    passo = { "t" => "empower", "uid" => "u", "power" => 1, "untap" => true, "effect" => res_ref("m") }
    assert_match(/Entità Umana/, engine.judge(passo.merge("uid" => "x"))[:reason])
    assert_match(/non lo dice/, engine.judge(passo.reject { |k, _| k == "untap" })[:reason])
    assert_match(/Potenza in più è 1/, engine.judge(passo.merge("power" => 2))[:reason])
    verdict = engine.judge(passo)
    assert verdict[:ok], verdict[:reason]
    u = copia(engine).card("u")
    refute u[:tapped]
    assert_equal 1, u[:power_bonus]
    assert_match(/UN'Entità/, engine.judge(passo.merge("uid" => "u2"))[:reason])
  end

  # Lo spostamento: un'Entità avversaria con costo 2 o inferiore nella Zona di Ritiro.
  def test_lo_spostamento_in_ritiro_manda_solo_chi_costa_poco
    engine = eredita([["u", "UMANO"], ["m", "IMPATTO", { "zone" => "hand" }]], b: [["b1", "AUROS"], ["b2", "GROSSO"]])
    assert gioca_carta(engine, "m", cost: 1)[:ok]
    accetta!(engine, "b")
    passo = { "t" => "toZone", "uid" => "b1", "zone" => "ritiro", "effect" => res_ref("m") }
    assert_match(/2 o inferiore/, engine.judge(passo.merge("uid" => "b2"))[:reason])
    assert_match(/avversario/, engine.judge(passo.merge("uid" => "u"))[:reason])
    verdict = engine.judge(passo)
    assert verdict[:ok], verdict[:reason]
    assert_equal "ritiro", copia(engine).card("b1")[:zone]
  end

  # L'esilio condizionato: un permanente avversario nell'Abisso, finché questa carta resta in gioco.
  def test_l_esilio_condizionato_esilia_e_restituisce_quando_lascia_il_gioco
    engine = eredita([["u", "UMANO"], ["m", "CAMPO", { "zone" => "hand" }]], b: [["b1", "AUROS"], ["bm", "PERMANENTE"], ["bo", "SCUDO", { "assignedTo" => "b1" }]])
    assert gioca_carta(engine, "m", cost: 3)[:ok]
    accetta!(engine, "b")
    passo = { "t" => "toZone", "uid" => "b1", "zone" => "abisso", "heldBy" => "m", "effect" => res_ref("m") }
    assert_match(/Entità o una Materia permanente/, engine.judge(passo.merge("uid" => "bo"))[:reason])
    assert_match(/Entità o una Materia permanente/, engine.judge(passo.merge("uid" => "rf-b"))[:reason])
    assert_match(/tenuto da questa carta/, engine.judge(passo.reject { |k, _| k == "heldBy" })[:reason])
    verdict = engine.judge(passo)
    assert verdict[:ok], verdict[:reason]
    assert_equal "abisso", copia(engine).card("b1")[:zone]
    assert_equal "abisso", copia(engine).card("bo")[:zone], "l'Oggetto la segue"
    assert_match(/già stato risolto/, engine.judge(passo.merge("uid" => "bm"))[:reason])
    assert_match(/resta nell'Abisso/, engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "x" => 442, "y" => 172 })[:reason])
    assert engine.judge({ "t" => "toZone", "uid" => "m", "zone" => "abisso" })[:ok]
    ritorno = engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "x" => 442, "y" => 172 })
    assert ritorno[:ok], ritorno[:reason]
    assert_equal "field", copia(engine).card("b1")[:zone]
    assert_equal "abisso", copia(engine).card("bo")[:zone], "torna disarmata (§3.1)"
  end

  # Il d20 a fasce.
  def test_il_d20_a_fasce_segue_il_dado
    engine = eredita([["u", "UMANO"], ["m", "FORZA", { "zone" => "hand" }], ["h", "PICCOLO", { "zone" => "hand" }], ["g", "GROSSO", { "zone" => "hand" }], ["d", "AUROS", { "zone" => "deck" }]])
    assert gioca_carta(engine, "m", cost: 3)[:ok]
    accetta!(engine, "b")
    cura = { "t" => "player", "seat" => "a", "patch" => { "hp" => 24 }, "roll" => 3, "effect" => res_ref("m") }
    pesca = { "t" => "draw", "seat" => "a", "count" => 1, "roll" => 3, "effect" => res_ref("m") }
    scesa = { "t" => "toZone", "uid" => "h", "zone" => "field", "x" => 821, "y" => 1260, "roll" => 3, "effect" => res_ref("m") }
    assert_match(/non si pesca/, engine.judge(pesca)[:reason])
    assert_match(/nessuno scende/, engine.judge(scesa)[:reason])
    assert_match(/tiro valido/, engine.judge(cura.merge("roll" => 21))[:reason])
    assert engine.judge(cura)[:ok]
    assert_equal 24, copia(engine).hp("a")
    assert_match(/tira una volta/, engine.judge(pesca.merge("roll" => 15))[:reason], "il tiro è fissato dal primo passo")
    assert_match(/già stato risolto/, engine.judge(cura.merge("patch" => { "hp" => 28 }))[:reason])
  end

  def test_con_20_il_d20_a_fasce_fa_tutte_e_tre_le_cose
    engine = eredita([["u", "UMANO"], ["m", "FORZA", { "zone" => "hand" }], ["h", "PICCOLO", { "zone" => "hand" }], ["g", "GROSSO", { "zone" => "hand" }], ["d", "AUROS", { "zone" => "deck" }]])
    assert gioca_carta(engine, "m", cost: 3)[:ok]
    accetta!(engine, "b")
    assert engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 24 }, "roll" => 20, "effect" => res_ref("m") })[:ok]
    assert engine.judge({ "t" => "draw", "seat" => "a", "count" => 1, "roll" => 20, "effect" => res_ref("m") })[:ok]
    scesa = { "t" => "toZone", "uid" => "h", "zone" => "field", "x" => 821, "y" => 1260, "roll" => 20, "effect" => res_ref("m") }
    assert_match(/2 o inferiore/, engine.judge(scesa.merge("uid" => "g"))[:reason])
    assert_match(/senza pagarne/, engine.judge(scesa.merge("cost" => 1))[:reason])
    verdict = engine.judge(scesa)
    assert verdict[:ok], verdict[:reason]
    assert_equal "field", copia(engine).card("h")[:zone]
    assert_equal 7, copia(engine).flux("a"), "gratis: pagata solo la Materia"
  end

  # --- §7.2: la catena di risposta ------------------------------------------

  # A di turno in Fronte, ondata non dichiarata: Reattive in mano da entrambe le parti.
  def catena
    engine = eredita([["r1", "RIFLESSO", { "zone" => "hand" }], ["r3", "RIFLESSO", { "zone" => "hand" }], ["e", "UMANO", { "zone" => "hand" }]],
                     b: [["r2", "RIFLESSO", { "zone" => "hand" }]])
    fronte!(engine)
    engine
  end

  def in_catena(engine, uid, actor:, chain: true)
    gioca_carta(engine, uid, cost: 2, actor: actor, y: actor == "a" ? 1260 : 172, extra: { "chain" => chain })
  end

  def test_una_reattiva_apre_sempre_la_catena
    engine = catena
    senza = in_catena(engine, "r1", actor: "a", chain: false)
    refute senza[:ok]
    assert_match(/apre sempre la catena.*§7\.2/, senza[:reason])
    assert_match(/always opens the response chain.*§7\.2/, senza[:reason_en])
    # Il segno su una carta che non è Reattiva: in Preparazione, dove l'Entità scenderebbe.
    preparazione = eredita([["e", "UMANO", { "zone" => "hand" }]])
    falsa = preparazione.judge({ "t" => "toZone", "uid" => "e", "zone" => "field", "x" => 442, "y" => 1260, "chain" => true }, actor: "a")
    assert_match(/solo una Materia Reattiva.*§7\.2/, falsa[:reason])
    verdict = in_catena(engine, "r1", actor: "a")
    assert verdict[:ok], verdict[:reason]
    assert_equal({ stack: ["r1"], turn: "b", resolving: false }, copia(engine).chain)
  end

  def test_in_catena_risponde_l_avversario_e_accetta_chi_ha_la_parola
    engine = catena
    in_catena(engine, "r1", actor: "a")
    assert_match(/tocca a B.*§7\.2/, in_catena(engine, "r3", actor: "a")[:reason], "due proprie Reattive di fila no")
    assert_match(/tocca a B/, engine.judge({ "t" => "pass", "seat" => "a" }, actor: "a")[:reason])
    risposta = in_catena(engine, "r2", actor: "b")
    assert risposta[:ok], risposta[:reason]
    assert_equal({ stack: %w[r1 r2], turn: "a", resolving: false }, copia(engine).chain)
    assert_match(/tocca a A/, engine.judge({ "t" => "pass", "seat" => "b" }, actor: "b")[:reason])
    accetta = engine.judge({ "t" => "pass", "seat" => "a" }, actor: "a")
    assert accetta[:ok], accetta[:reason]
    assert copia(engine).chain[:resolving]
  end

  def test_la_catena_e_atomica_ma_il_gettone_passa
    engine = catena
    in_catena(engine, "r1", actor: "a")
    assert_match(/atomica.*§7\.2/, engine.judge({ "t" => "phase", "phase" => "reazione" }, actor: "a")[:reason])
    assert_match(/atomica/, engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" }, actor: "a")[:reason])
    assert_match(/atomica/, engine.judge({ "t" => "declare", "declaration" => { "id" => "e", "from" => "e", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 } }, actor: "a")[:reason])
    assert engine.judge({ "t" => "say", "entry" => {} }, actor: "b")[:ok]
    gettone = engine.judge({ "t" => "player", "seat" => "b", "patch" => { "token" => false, "flux" => 11 } }, actor: "b")
    assert gettone[:ok], gettone[:reason]
  end

  def test_risolta_la_catena_passa_solo_la_cima_e_poi_si_chiude
    engine = catena
    in_catena(engine, "r1", actor: "a")
    in_catena(engine, "r2", actor: "b")
    engine.judge({ "t" => "pass", "seat" => "a" }, actor: "a")
    assert_match(/si sta risolvendo/, in_catena(engine, "r3", actor: "a")[:reason], "nessuna Reattiva nuova")
    assert_match(/si sta risolvendo/, engine.judge({ "t" => "pass", "seat" => "a" }, actor: "a")[:reason])
    hp_a = copia(engine).hp("a")
    hp_b = copia(engine).hp("b")
    assert_match(/si sta risolvendo/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => hp_a + 3 }, "effect" => res_ref("r1") }, actor: "a")[:reason], "r1 non è la cima")
    # La cima passa alla dogana dell'effetto (che qui la ferma per gli armati: la catena l'ha lasciata passare).
    assert_match(/Oggetto assegnato/, engine.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => hp_b + 3 }, "effect" => res_ref("r2") }, actor: "b")[:reason])
    assert_match(/si sta risolvendo/, engine.judge({ "t" => "settle", "uid" => "r1" }, actor: "a")[:reason])
    assert engine.judge({ "t" => "toZone", "uid" => "r2", "zone" => "abisso" }, actor: "b")[:ok], "la Reattiva risolta si consuma: esce dalla pila"
    assert_equal ["r1"], copia(engine).chain[:stack]
    assert_match(/Oggetto assegnato/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => hp_a + 3 }, "effect" => res_ref("r1") }, actor: "a")[:reason], "ora la cima è r1")
    # Chi resta in campo (la Reattiva che blocca, §6.4) si chiude con `settle`.
    assert engine.judge({ "t" => "settle", "uid" => "r1" }, actor: "a")[:ok]
    assert_nil copia(engine).chain
    assert engine.judge({ "t" => "toZone", "uid" => "r1", "zone" => "abisso" }, actor: "a")[:ok]
    assert engine.judge({ "t" => "phase", "phase" => "reazione" }, actor: "a")[:ok], "chiusa la catena, il tavolo riparte"
  end

  def test_in_reazione_la_reattiva_come_blocco_apre_e_l_attaccante_risponde
    engine = eredita([["g", "GROSSO"], ["r3", "RIFLESSO", { "zone" => "hand" }]], b: [["r2", "RIFLESSO", { "zone" => "hand" }]], attacks: %w[g])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert in_catena(engine, "r2", actor: "b")[:ok]
    assert blocco(engine, "r2", "g")[:ok], "il blocco della cima passa in catena"
    risposta = in_catena(engine, "r3", actor: "a")
    assert risposta[:ok], "«l'attaccante può rispondere» (§6.4): #{risposta[:reason]}"
  end

  # La forma `block`: giocata come bloccante di un'Entità attaccante, l'attacco è bloccato; con 2 armati sul Fronte, +3 PV.
  def test_la_reattiva_bloccante_ferma_l_attaccante_e_cura_se_gli_armati_bastano
    engine = eredita([["g", "GROSSO"], ["g2", "GROSSO"]],
                     b: [["v1", "UMANO"], ["v2", "UMANO"], ["o1", "SCUDO", { "assignedTo" => "v1" }], ["o2", "SCUDO"], ["r", "RIFLESSO", { "zone" => "hand" }]], attacks: %w[g g2])
    refute gioca_carta(engine, "r", cost: 2, actor: "b", y: 172)[:ok], "nel Fronte a ondata dichiarata no (§7.2)"
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert gioca_carta(engine, "r", cost: 2, actor: "b", y: 172)[:ok], "in Reazione sì: si gioca come blocco (§7.2)"
    assert blocco(engine, "r", "g")[:ok], "la Reattiva ferma l'attaccante (§6.4)"
    accetta!(engine, "a")
    hp = copia(engine).hp("b")
    cura = { "t" => "player", "seat" => "b", "patch" => { "hp" => hp + 3 }, "effect" => res_ref("r") }
    assert_match(/Entità con un Oggetto assegnato.*§8\.2/, engine.judge(cura, actor: "b")[:reason], "un armato solo: niente PV")
    engine.observe({ "t" => "assign", "uid" => "o2", "to" => "v2" })
    assert_match(/dà 3 PV/, engine.judge(cura.merge("patch" => { "hp" => hp + 5 }), actor: "b")[:reason])
    assert_match(/chi comanda la fonte/, engine.judge(cura.merge("seat" => "a"), actor: "b")[:reason])
    verdict = engine.judge(cura, actor: "b")
    assert verdict[:ok], verdict[:reason]
    assert_equal hp + 3, copia(engine).hp("b")
    assert_match(/già stato risolto/, engine.judge(cura.merge("patch" => { "hp" => hp + 6 }), actor: "b")[:reason])
  end

  # La stappata di gruppo, in Reazione, senza bloccare: con 3 Umani, stappa gli Umani, Contrattacco +1.
  def test_la_stappata_di_gruppo_in_reazione_potenzia_gli_umani_senza_bloccare
    engine = eredita([["g", "GROSSO"], ["g2", "GROSSO"]],
                     b: [["v1", "UMANO", { "tapped" => true }], ["v2", "UMANO", { "tapped" => true }], ["v3", "SPINOSO"], ["c", "COORDINATO", { "zone" => "hand" }]], attacks: %w[g g2])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert gioca_carta(engine, "c", cost: 4, actor: "b", y: 172)[:ok]
    accetta!(engine, "a")
    # La carta non dice cosa blocca, quindi non blocca nessuno e non
    # pretende una dichiarazione (decisione del designer, 2026-09-05):
    # l'effetto parte subito, nella finestra del difensore (§6.4).
    passo = { "t" => "empower", "uid" => "v1", "counter" => 1, "untap" => true, "effect" => res_ref("c") }
    %w[v1 v2 v3].each do |uid|
      verdict = engine.judge(passo.merge("uid" => uid), actor: "b")
      assert verdict[:ok], verdict[:reason]
    end
    assert_match(/già stato risolto/, engine.judge(passo, actor: "b")[:reason])
    tavolo = copia(engine)
    refute tavolo.card("v1")[:tapped]
    assert_equal 1, tavolo.card("v3")[:counter_bonus]
    # La Reattiva risolta si consuma, e lo fa il difensore nel turno altrui (§7.2).
    assert engine.judge({ "t" => "toZone", "uid" => "c", "zone" => "abisso" }, actor: "b")[:ok]
    assert_equal "abisso", tavolo.card("c")[:zone], "la Reattiva si consuma"
    # Ora v3 contrattacca g2: 3 + 1 + 1 = 5 > 4. g, che nessuno ferma, passa.
    assert blocco(engine, "v3", "g2", "counter")[:ok]
    battles = [esito("g", damage: 4), esito("g2", blocker: "v3", kind: "counter", attacker_dies: true)]
    verdict = risolvi(engine, battles)
    assert verdict[:ok], verdict[:reason]
    assert_equal "abisso", tavolo.card("g2")[:zone]
    assert_equal 16, tavolo.hp("b"), "la Reattiva non ferma nessuno: i 4 di g passano"
  end

  def test_la_stappata_di_gruppo_vuole_tre_umani
    engine = eredita([["g", "GROSSO"]], b: [["v1", "UMANO"], ["v2", "UMANO"], ["c", "COORDINATO", { "zone" => "hand" }]], attacks: %w[g])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert gioca_carta(engine, "c", cost: 4, actor: "b", y: 172)[:ok]
    accetta!(engine, "a")
    assert_match(/almeno 3 Entità Umane/, engine.judge({ "t" => "empower", "uid" => "v1", "counter" => 1, "untap" => true, "effect" => res_ref("c") }, actor: "b")[:reason])
  end

  # La distruzione: distruggi un'Entità; contro una tappata costa 3 in meno.
  def test_la_distruzione_sconta_contro_la_tappata_e_colpisce_lei
    engine = eredita([["u", "UMANO"], ["m", "GIUDIZIO", { "zone" => "hand" }]], b: [["b1", "AUROS"], ["b2", "GROSSO"]])
    # Tappata ORA (il cambio di turno l'aveva stappata).
    engine.observe({ "t" => "tap", "uid" => "b1", "tapped" => true })
    fronte!(engine)
    assert_match(/costa 2 di Flusso/, gioca_carta(engine, "m", cost: 5, extra: { "target" => "b1" })[:reason])
    assert_match(/costa 5 di Flusso/, gioca_carta(engine, "m", cost: 2, extra: { "target" => "b2" })[:reason], "lo sconto vale solo contro una tappata")
    assert gioca_carta(engine, "m", cost: 2, extra: { "target" => "b1" })[:ok]
    accetta!(engine, "b")
    assert_equal 8, copia(engine).flux("a")
    passo = { "t" => "toZone", "uid" => "b2", "zone" => "abisso", "effect" => res_ref("m") }
    assert_match(/altro bersaglio/, engine.judge(passo)[:reason])
    verdict = engine.judge(passo.merge("uid" => "b1"))
    assert verdict[:ok], verdict[:reason]
    assert_equal "abisso", copia(engine).card("b1")[:zone]
  end

  def test_la_distruzione_senza_bersaglio_dichiarato_costa_pieno_e_colpisce_chiunque
    engine = eredita([["u", "UMANO"], ["m", "GIUDIZIO", { "zone" => "hand" }]], b: [["b1", "AUROS"]])
    engine.observe({ "t" => "tap", "uid" => "b1", "tapped" => true })
    fronte!(engine)
    assert gioca_carta(engine, "m", cost: 5)[:ok]
    accetta!(engine, "b")
    verdict = engine.judge({ "t" => "toZone", "uid" => "u", "zone" => "abisso", "effect" => res_ref("m") })
    assert verdict[:ok], verdict[:reason]
  end

  def test_una_materia_risolta_in_un_altro_turno_o_ignota_tace
    engine = eredita([["u", "UMANO"], ["m", "IMPATTO"]], b: [["b1", "AUROS"]])
    assert_match(/non è scesa in campo questo turno/, engine.judge({ "t" => "toZone", "uid" => "b1", "zone" => "ritiro", "effect" => res_ref("m") })[:reason])
    ignota = eredita([["u", "UMANO"], ["z", "IGNOTA"]], b: [["b1", "AUROS"]])
    refute ignota.judge({ "t" => "toZone", "uid" => "b1", "zone" => "ritiro", "effect" => res_ref("z") })[:ruled]
  end

  # L'indebolimento dell'attaccante: −1 per ogni propria Entità con un Oggetto, in Reazione.
  def test_l_indebolimento_toglie_all_attaccante_una_potenza_per_armata
    engine = eredita([["u", "UMANO"], ["u2", "UMANO"]],
                     b: [["bu", "UMANO"], ["b1", "AUROS"], ["bo", "SCUDO", { "assignedTo" => "b1" }], ["b2", "AUROS"], ["bo2", "SPINE", { "assignedTo" => "b2" }], ["n", "RIFRAZIONE", { "zone" => "hand" }]],
                     attacks: ["u"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert gioca_carta(engine, "n", cost: 2, actor: "b", y: 172)[:ok]
    accetta!(engine, "a")
    passo = { "t" => "empower", "uid" => "u", "power" => -2, "effect" => res_ref("n") }
    assert_match(/non attacca/, engine.judge(passo.merge("uid" => "u2"), actor: "b")[:reason])
    assert_match(/avversaria/, engine.judge(passo.merge("uid" => "b1"), actor: "b")[:reason])
    assert_match(/in meno è -2/, engine.judge(passo.merge("power" => -1), actor: "b")[:reason], "il conto è delle armate di adesso")
    assert_match(/toglie Potenza soltanto/, engine.judge(passo.merge("untap" => true), actor: "b")[:reason])
    verdict = engine.judge(passo, actor: "b")
    assert verdict[:ok], verdict[:reason]
    assert_equal(-2, copia(engine).card("u")[:power_bonus])
    assert_match(/già stato risolto/, engine.judge(passo, actor: "b")[:reason])
    engine.observe({ "t" => "declare", "declaration" => { "id" => "u2", "from" => "u2", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 2 } })
    assert_match(/UN'Entità/, engine.judge(passo.merge("uid" => "u2"), actor: "b")[:reason], "un bersaglio solo per risoluzione")
  end

  def test_l_indebolimento_senza_armate_non_toglie_nulla
    engine = eredita([["u", "UMANO"]], b: [["bu", "UMANO"], ["n", "RIFRAZIONE", { "zone" => "hand" }]], attacks: ["u"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert gioca_carta(engine, "n", cost: 2, actor: "b", y: 172)[:ok]
    accetta!(engine, "a")
    verdict = engine.judge({ "t" => "empower", "uid" => "u", "power" => -1, "effect" => res_ref("n") }, actor: "b")
    assert_match(/senza Entità con un Oggetto/, verdict[:reason])
    assert_includes verdict[:reason_en], "(§8.2)"
  end

  # Il potenziamento delle armate: fino a 2 proprie Entità con un Oggetto, +1 e stappate.
  def test_il_potenziamento_delle_armate_ne_stappa_al_massimo_due
    engine = eredita([["u", "UMANO"], ["uo", "SCUDO", { "assignedTo" => "u" }], ["v", "UMANO"], ["vo", "SPINE", { "assignedTo" => "v" }],
                      ["w", "UMANO"], ["wo", "SCUDO", { "assignedTo" => "w" }], ["x", "UMANO"], ["m", "AMPLIFICA", { "zone" => "hand" }]])
    engine.observe({ "t" => "tap", "uid" => "u", "tapped" => true })
    fronte!(engine)
    assert gioca_carta(engine, "m", cost: 2)[:ok]
    accetta!(engine, "b")
    passo = { "t" => "empower", "uid" => "u", "power" => 1, "untap" => true, "effect" => res_ref("m") }
    assert_match(/non ne ha/, engine.judge(passo.merge("uid" => "x"))[:reason], "senza Oggetto no")
    assert_match(/Potenza in più è 1/, engine.judge(passo.merge("power" => 2))[:reason])
    assert_match(/non lo dice/, engine.judge(passo.reject { |k, _| k == "untap" })[:reason])
    verdict = engine.judge(passo)
    assert verdict[:ok], verdict[:reason]
    assert_equal 1, copia(engine).card("u")[:power_bonus]
    refute copia(engine).card("u")[:tapped]
    assert_match(/già stato risolto/, engine.judge(passo)[:reason])
    assert engine.judge(passo.merge("uid" => "v"))[:ok]
    terza = engine.judge(passo.merge("uid" => "w"))
    assert_match(/fino a 2 Entità/, terza[:reason])
    assert_includes terza[:reason_en], "(§8.2)"
  end

  # Lo spostamento scontato: in Ritiro; con 2 armate sul Fronte costa 1 in meno.
  def test_lo_spostamento_scontato_costa_uno_in_meno_con_due_armate
    engine = eredita([["u", "UMANO"], ["uo", "SCUDO", { "assignedTo" => "u" }], ["v", "UMANO"], ["vo", "SPINE", { "assignedTo" => "v" }], ["m", "FRATTURA", { "zone" => "hand" }]],
                     b: [["b1", "GROSSO"]])
    assert_match(/costa 2 di Flusso/, gioca_carta(engine, "m", cost: 3)[:reason])
    assert gioca_carta(engine, "m", cost: 2)[:ok]
    accetta!(engine, "b")
    assert_equal 8, copia(engine).flux("a")
    verdict = engine.judge({ "t" => "toZone", "uid" => "b1", "zone" => "ritiro", "effect" => res_ref("m") })
    assert verdict[:ok], "senza limite di costo, anche la grossa: #{verdict[:reason]}"
    assert_equal "ritiro", copia(engine).card("b1")[:zone]
    poche = eredita([["u", "UMANO"], ["uo", "SCUDO", { "assignedTo" => "u" }], ["m", "FRATTURA", { "zone" => "hand" }]], b: [["b1", "GROSSO"]])
    assert_match(/costa 3 di Flusso/, gioca_carta(poche, "m", cost: 2)[:reason], "con una sola armata niente sconto")
    assert gioca_carta(poche, "m", cost: 3)[:ok]
  end

  # L'esilio all'assegnazione: «quando assegni questa carta a un'Entità», un'Entità avversaria nell'Abisso finché l'Oggetto resta in gioco.
  def test_l_esilio_all_assegnazione_tiene_un_entita_avversaria_finche_l_oggetto_resta
    engine = eredita([["u", "UMANO"], ["p", "PRISMA", { "zone" => "hand" }]], b: [["b1", "AUROS"], ["b2", "AUROS"]])
    ref = { "source" => "p", "event" => "on_assign_object", "entering" => "u" }
    passo = { "t" => "toZone", "uid" => "b1", "zone" => "abisso", "heldBy" => "p", "effect" => ref }
    assert_match(/non è in campo/, engine.judge(passo)[:reason], "dalla mano non innesca")
    assert engine.judge({ "t" => "assign", "uid" => "p", "to" => "u" })[:ok]
    assert gioca_carta(engine, "p", cost: 3, x: 470, y: 1288)[:ok]
    assert_match(/a cui l'Oggetto è assegnato/, engine.judge(passo.merge("effect" => ref.merge("entering" => "b1")))[:reason])
    assert_match(/tenuta da questo Oggetto/, engine.judge(passo.reject { |k, _| k == "heldBy" })[:reason])
    assert_match(/avversario/, engine.judge(passo.merge("uid" => "u"))[:reason])
    verdict = engine.judge(passo)
    assert verdict[:ok], verdict[:reason]
    assert_equal "abisso", copia(engine).card("b1")[:zone]
    assert_equal "p", copia(engine).card("b1")[:held_by]
    assert_match(/già stato risolto/, engine.judge(passo.merge("uid" => "b2"))[:reason], "un'assegnazione, un innesco")
    assert_match(/resta nell'Abisso/, engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "x" => 442, "y" => 172 })[:reason])
    assert engine.judge({ "t" => "toZone", "uid" => "p", "zone" => "ritiro" })[:ok]
    ritorno = engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "x" => 442, "y" => 172 })
    assert ritorno[:ok], ritorno[:reason]
    assert_equal "field", copia(engine).card("b1")[:zone]
  end

  def test_l_esilio_all_assegnazione_e_dell_oggetto_certificato_soltanto
    engine = eredita([["u", "UMANO"], ["s", "SCUDO", { "assignedTo" => "u" }]], b: [["b1", "AUROS"]])
    verdict = engine.judge({ "t" => "toZone", "uid" => "b1", "zone" => "abisso", "heldBy" => "s", "effect" => { "source" => "s", "event" => "on_assign_object", "entering" => "u" } })
    assert_match(/quando assegni/, verdict[:reason])
    assert_includes verdict[:reason_en], "(§8.2)"
    ignota = eredita([["u", "UMANO"], ["z", "IGNOTA", { "assignedTo" => "u" }]], b: [["b1", "AUROS"]])
    refute ignota.judge({ "t" => "toZone", "uid" => "b1", "zone" => "abisso", "heldBy" => "z", "effect" => { "source" => "z", "event" => "on_assign_object", "entering" => "u" } })[:ruled]
  end

  # Il prosciugamento: il Rubyfront/Nexus avversario perde PV pari ai propri Oggetti assegnati.
  def test_il_prosciugamento_toglie_un_pv_per_oggetto_assegnato
    engine = eredita([["u", "UMANO"], ["uo", "SCUDO", { "assignedTo" => "u" }], ["uo2", "SPINE", { "assignedTo" => "u" }], ["v", "UMANO"], ["vo", "SCUDO", { "assignedTo" => "v" }],
                      ["free", "SCUDO"], ["m", "ASSALTO", { "zone" => "hand" }]])
    assert gioca_carta(engine, "m", cost: 4)[:ok]
    accetta!(engine, "b")
    passo = { "t" => "player", "seat" => "b", "patch" => { "hp" => 17 }, "effect" => res_ref("m") }
    assert_match(/avversario/, engine.judge(passo.merge("seat" => "a"))[:reason])
    assert_match(/toglie 3 PV/, engine.judge(passo.merge("patch" => { "hp" => 18 }))[:reason], "tre Oggetti addosso: quello libero non conta")
    verdict = engine.judge(passo)
    assert verdict[:ok], verdict[:reason]
    assert_equal 17, copia(engine).hp("b")
    assert_match(/già stato risolto/, engine.judge(passo.merge("patch" => { "hp" => 14 }))[:reason])
    nudo = eredita([["u", "UMANO"], ["m", "ASSALTO", { "zone" => "hand" }]])
    assert gioca_carta(nudo, "m", cost: 4)[:ok]
    accetta!(nudo, "b")
    verdict = nudo.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => 20 }, "effect" => res_ref("m") })
    assert_match(/senza Oggetti/, verdict[:reason])
    assert_includes verdict[:reason_en], "(§8.2)"
  end

  # «Distruggi un'Entità avversaria. Poi perdi 2 PV».
  def test_la_distruzione_col_seguito_fa_perdere_pv_dopo
    engine = eredita([["u", "UMANO"], ["m", "EVERSIONE", { "zone" => "hand" }]], b: [["b1", "AUROS"]])
    assert gioca_carta(engine, "m", cost: 3)[:ok]
    accetta!(engine, "b")
    perdita = { "t" => "player", "seat" => "a", "patch" => { "hp" => 18 }, "effect" => res_ref("m") }
    assert_match(/prima la distruzione/, engine.judge(perdita)[:reason])
    assert engine.judge({ "t" => "toZone", "uid" => "b1", "zone" => "abisso", "effect" => res_ref("m") })[:ok]
    assert_match(/chi comanda la fonte/, engine.judge(perdita.merge("seat" => "b", "patch" => { "hp" => 18 }))[:reason])
    assert_match(/perdi 2 PV/, engine.judge(perdita.merge("patch" => { "hp" => 19 }))[:reason])
    verdict = engine.judge(perdita)
    assert verdict[:ok], verdict[:reason]
    assert_equal 18, copia(engine).hp("a")
    assert_match(/già stato risolto/, engine.judge(perdita.merge("patch" => { "hp" => 16 }))[:reason])
  end

  # Lo sconto d'assegnazione e la pesca «quando assegni un Oggetto a questa Entità».
  def test_il_portatore_sconta_gli_oggetti_che_riceve_e_pesca
    engine = eredita([["p", "PORTATORE"], ["u", "UMANO"], ["s", "SCUDO", { "zone" => "hand" }], ["s2", "SCUDO", { "zone" => "hand" }], ["d", "AUROS", { "zone" => "deck" }]])
    assert engine.judge({ "t" => "assign", "uid" => "s", "to" => "p" })[:ok]
    assert_match(/costa 1 di Flusso/, gioca_carta(engine, "s", cost: 2, x: 470, y: 1288)[:reason], "sul portatore lo Scudo costa 1")
    assert gioca_carta(engine, "s", cost: 1, x: 470, y: 1288)[:ok]
    assert engine.judge({ "t" => "assign", "uid" => "s2", "to" => "u" })[:ok]
    assert_match(/costa 2 di Flusso/, gioca_carta(engine, "s2", cost: 1, x: 850, y: 1288)[:reason], "su un altro, prezzo pieno")
    pesca = { "t" => "draw", "seat" => "a", "count" => 1, "effect" => { "source" => "p", "event" => "on_assign_object", "entering" => "s" } }
    assert_match(/pesca chi comanda l'Entità, 1/, engine.judge(pesca.merge("count" => 2))[:reason])
    assert_match(/Oggetto assegnato a questa Entità/, engine.judge(pesca.merge("effect" => pesca["effect"].merge("entering" => "s2")))[:reason])
    verdict = engine.judge(pesca)
    assert verdict[:ok], verdict[:reason]
    assert_match(/già stato risolto/, engine.judge(pesca)[:reason])
    assert_includes engine.judge(pesca)[:reason_en], "(§8.2)"
    senza = eredita([["u", "UMANO"], ["s", "SCUDO", { "assignedTo" => "u" }]])
    verdict = senza.judge({ "t" => "draw", "seat" => "a", "count" => 1, "effect" => { "source" => "u", "event" => "on_assign_object", "entering" => "s" } })
    assert_match(/quando le assegni un Oggetto/, verdict[:reason])
  end

  # L'aura delle armate: «le altre Entità con un Oggetto assegnato che controlli hanno +1».
  def test_l_aura_da_uno_in_piu_alle_altre_armate_non_a_se_e_non_alle_nude
    # L'Auros armato: 2 + 1 dello Scudo + 1 dell'aura = 4. L'aura stessa, armata: 5 + 1 dello Scudo, senza aura su di sé.
    engine = eredita([["l", "LAMA"], ["lo", "SCUDO", { "assignedTo" => "l" }], ["r", "AUROS"], ["ro", "SCUDO", { "assignedTo" => "r" }], ["n", "AUROS"]], attacks: %w[l r n])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/non torna/, risolvi(engine, [esito("l", damage: 7), esito("r", damage: 4), esito("n", damage: 2)])[:reason])
    assert_match(/non torna/, risolvi(engine, [esito("l", damage: 6), esito("r", damage: 3), esito("n", damage: 2)])[:reason])
    assert_match(/non torna/, risolvi(engine, [esito("l", damage: 6), esito("r", damage: 4), esito("n", damage: 3)])[:reason], "la nuda non prende l'aura")
    verdict = risolvi(engine, [esito("l", damage: 6), esito("r", damage: 4), esito("n", damage: 2)])
    assert verdict[:ok], verdict[:reason]
  end

  # La ricerca col dado: guarda le prime 5, mostra per fascia o una in cima, poi una in Ritiro.
  def test_la_ricerca_col_dado_mostra_per_fascia_o_rimette_una_in_cima
    mazzo = [["d0", "AUROS"], ["d1", "AUROS"], ["d2", "SCUDO"], ["d3", "PERMANENTE"], ["d4", "UMANO"], ["d5", "AUROS"], ["d6", "UMANO"]]
    deck = mazzo.map.with_index { |(uid, id), i| [uid, id, { "zone" => "deck", "order" => i }] }
    # La Pesca del turno 3 prende «d0»: guardate d1…d5, sotto resta d6.
    engine = eredita([["u", "UMANO"], ["m", "CARICA", { "zone" => "hand" }]] + deck)
    assert gioca_carta(engine, "m", cost: 3)[:ok]
    accetta!(engine, "b")
    look = { "t" => "look", "seat" => "a", "count" => 5, "roll" => 16, "reveal" => "d1", "retire" => "d2", "revealTo" => "hand", "restTo" => "deck", "effect" => res_ref("m") }
    assert_match(/tiro valido/, engine.judge(look.merge("roll" => 21))[:reason])
    assert_match(/prime 5/, engine.judge(look.merge("count" => 4))[:reason])
    assert_match(/solo un'Entità/, engine.judge(look.merge("reveal" => "d2"))[:reason], "con 16 si mostra un'Entità")
    assert_match(/solo un Oggetto/, engine.judge(look.merge("roll" => 9))[:reason])
    assert_match(/nessuna torna in cima/, engine.judge(look.merge("top" => "d3"))[:reason])
    assert_match(/una delle altre carte va nella Zona di Ritiro/, engine.judge(look.reject { |k, _| k == "retire" })[:reason])
    assert_match(/una delle altre carte va nella Zona di Ritiro/, engine.judge(look.merge("retire" => "d1"))[:reason], "non la mostrata")
    senza = look.reject { |k, _| k == "reveal" }
    assert_match(/una delle guardate va in cima/, engine.judge(senza)[:reason])
    assert_match(/una delle guardate va in cima/, engine.judge(senza.merge("top" => "d6"))[:reason], "fra le guardate")
    verdict = engine.judge(look)
    assert verdict[:ok], verdict[:reason]
    assert_equal "hand", copia(engine).card("d1")[:zone]
    assert_equal "ritiro", copia(engine).card("d2")[:zone]
    assert_equal %w[d6 d3 d4 d5], copia(engine).top_of_deck("a", 4), "le altre in fondo, nell'ordine"
    assert_match(/già stato risolto/, engine.judge(look)[:reason])
    cima = eredita([["u", "UMANO"], ["m", "CARICA", { "zone" => "hand" }]] + deck)
    assert gioca_carta(cima, "m", cost: 3)[:ok]
    accetta!(cima, "b")
    verdict = cima.judge(senza.merge("top" => "d3", "retire" => "d4"))
    assert verdict[:ok], verdict[:reason]
    assert_equal %w[d3 d6 d1 d2 d5], copia(cima).top_of_deck("a", 5), "la scelta resta in cima, le altre in fondo"
    assert_equal "ritiro", copia(cima).card("d4")[:zone]
  end

  # Il Rubyfront «la prima volta in ogni tuo turno che assegni un Oggetto»: gli estremi del mazzo.
  def test_il_rubyfront_scambia_gli_estremi_del_mazzo_poi_pesca_e_scarta_una_volta_per_turno
    deck = [["d0", "AUROS"], ["d1", "AUROS"], ["d2", "SCUDO"], ["d3", "UMANO"]].map.with_index { |(uid, id), i| [uid, id, { "zone" => "deck", "order" => i }] }
    engine = eredita([["forgia", "FORGIA", { "y" => 1260 }], ["u", "UMANO"], ["s", "SCUDO", { "zone" => "hand" }], ["s2", "SCUDO", { "zone" => "hand" }]] + deck)
    ref = { "source" => "forgia", "event" => "on_assign_object", "entering" => "s", "once" => true }
    ends = { "t" => "ends", "seat" => "a", "swap" => true, "effect" => ref }
    assert_match(/non lo è/, engine.judge(ends)[:reason], "l'Oggetto non è ancora assegnato")
    assert engine.judge({ "t" => "assign", "uid" => "s", "to" => "u" })[:ok]
    assert gioca_carta(engine, "s", cost: 2, x: 470, y: 1288)[:ok]
    assert_match(/prima volta nel turno/, engine.judge(ends.merge("effect" => ref.reject { |k, _| k == "once" }))[:reason])
    assert_match(/non lo è/, engine.judge(ends.merge("effect" => ref.merge("entering" => "u")))[:reason])
    assert_match(/scambia la prima e l'ultima/, engine.judge(ends.merge("swap" => nil, "toHand" => "d1"))[:reason], "questa faccia non mette in mano")
    assert_equal %w[d1 d2 d3], copia(engine).top_of_deck("a", 3)
    verdict = engine.judge(ends)
    assert verdict[:ok], verdict[:reason]
    assert_equal %w[d3 d2 d1], copia(engine).top_of_deck("a", 3), "prima e ultima scambiate"
    assert_match(/già scattato in questo turno/, engine.judge(ends)[:reason])
    scarto = { "t" => "toZone", "uid" => "s2", "zone" => "ritiro", "effect" => ref.merge("follow" => "discard") }
    assert_match(/prima si pesca/, engine.judge(scarto)[:reason])
    pesca = { "t" => "draw", "seat" => "a", "count" => 1, "effect" => ref.merge("follow" => "draw") }
    assert_match(/pesca 1/, engine.judge(pesca.merge("count" => 2))[:reason])
    assert engine.judge(pesca)[:ok]
    assert_equal "hand", copia(engine).card("d3")[:zone]
    assert_match(/già stato fatto/, engine.judge(pesca)[:reason])
    assert_match(/dalla propria mano/, engine.judge(scarto.merge("uid" => "u"))[:reason])
    assert engine.judge(scarto)[:ok]
    assert_equal "ritiro", copia(engine).card("s2")[:zone]
    assert_match(/già stato fatto/, engine.judge(scarto.merge("uid" => "d3"))[:reason])
  end

  def test_il_nexus_mette_un_estremo_in_mano_e_l_altro_in_ritiro
    deck = [["d0", "AUROS"], ["d1", "AUROS"], ["d2", "SCUDO"], ["d3", "UMANO"]].map.with_index { |(uid, id), i| [uid, id, { "zone" => "deck", "order" => i }] }
    engine = eredita([["forgia", "FORGIA", { "y" => 1260, "face" => 1 }], ["u", "UMANO"], ["s", "SCUDO", { "zone" => "hand" }]] + deck)
    assert engine.judge({ "t" => "assign", "uid" => "s", "to" => "u" })[:ok]
    assert gioca_carta(engine, "s", cost: 2, x: 470, y: 1288)[:ok]
    ref = { "source" => "forgia", "event" => "on_assign_object", "entering" => "s", "once" => true }
    ends = { "t" => "ends", "seat" => "a", "toHand" => "d3", "toRetire" => "d1", "effect" => ref }
    assert_match(/non scambia/, engine.judge(ends.merge("swap" => true))[:reason])
    assert_match(/la prima o l'ultima/, engine.judge(ends.merge("toHand" => "d2"))[:reason])
    assert_match(/l'altra va nella Zona di Ritiro/, engine.judge(ends.merge("toRetire" => "d2"))[:reason])
    verdict = engine.judge(ends)
    assert verdict[:ok], verdict[:reason]
    assert_equal "hand", copia(engine).card("d3")[:zone]
    assert_equal "ritiro", copia(engine).card("d1")[:zone]
    assert_equal %w[d2], copia(engine).top_of_deck("a", 3)
    assert_match(/il seguito pesca 0/, engine.judge({ "t" => "draw", "seat" => "a", "count" => 1, "effect" => ref.merge("follow" => "draw") })[:reason], "il Nexus non pesca")
    # Nel turno altrui non scatta.
    altrui = eredita([["forgia", "FORGIA", { "y" => 1260, "face" => 1 }], ["u", "UMANO"], ["s", "SCUDO", { "assignedTo" => "u" }]] + deck)
    altrui.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    assert_match(/nel proprio turno/, altrui.judge(ends)[:reason])
  end

  # «Quando quell'Entità muore, metti questo Oggetto in Ritiro invece che nell'Abisso; poi puoi riarmare».
  def test_il_vestigio_resta_in_ritiro_alla_morte_del_portatore_e_riarma_una_disarmata
    engine = eredita([["u", "UMANO"], ["v", "VESTIGIO", { "assignedTo" => "u" }], ["w", "SCUDO", { "zone" => "ritiro" }], ["n", "AUROS"], ["z", "AUROS"], ["zo", "SPINE", { "assignedTo" => "z" }]],
                     b: [["g", "GROSSO"]], attacks: ["u"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert blocco(engine, "g", "u")[:ok]
    ref = { "source" => "v", "event" => "on_death", "entering" => "u" }
    resta = { "t" => "remain", "uid" => "v", "effect" => ref }
    assert_match(/seguito questo turno/, engine.judge(resta)[:reason], "prima che muoia, niente")
    # UMANO 2 + 2 del Vestigio = 4 contro GROSSO 4: muoiono entrambi.
    verdict = risolvi(engine, [esito("u", blocker: "g", kind: "block", attacker_dies: true, blocker_dies: true)])
    assert verdict[:ok], verdict[:reason]
    assert_equal "abisso", copia(engine).card("v")[:zone]
    assert_match(/seguito questo turno/, engine.judge(resta.merge("effect" => ref.merge("entering" => "g")))[:reason])
    assert_match(/azione `remain`/, engine.judge(resta.merge("uid" => "u"))[:reason])
    verdict = engine.judge(resta)
    assert verdict[:ok], verdict[:reason]
    assert_equal "ritiro", copia(engine).card("v")[:zone]
    assert_match(/già stato risolto/, engine.judge(resta)[:reason])
    riarmo = { "t" => "toZone", "uid" => "w", "zone" => "field", "x" => 1230, "y" => 1288, "assignTo" => "n", "effect" => ref.merge("follow" => "rearm") }
    assert_match(/ALTRO Oggetto/, engine.judge(riarmo.merge("uid" => "v"))[:reason])
    assert_match(/SENZA Oggetto/, engine.judge(riarmo.merge("assignTo" => "z"))[:reason])
    assert_match(/senza pagarne il costo/, engine.judge(riarmo.merge("cost" => 2))[:reason])
    verdict = engine.judge(riarmo)
    assert verdict[:ok], verdict[:reason]
    assert_equal "field", copia(engine).card("w")[:zone]
    assert_equal "n", copia(engine).card("w")[:assigned_to]
    assert_match(/già stato fatto/, engine.judge(riarmo.merge("uid" => "v"))[:reason])
    nudo = eredita([["u", "UMANO"], ["s", "SCUDO", { "assignedTo" => "u" }]])
    verdict = nudo.judge({ "t" => "remain", "uid" => "s", "effect" => { "source" => "s", "event" => "on_death", "entering" => "u" } })
    assert_match(/quando quell'Entità muore/, verdict[:reason])
    assert_includes verdict[:reason_en], "(§8.2)"
  end

  def test_l_oggetto_resta_anche_se_il_difensore_ha_gia_chiuso_il_turno
    # La Reazione la chiude il difensore in un fiato: risoluzione e cambio di
    # turno. La scena del proprietario arriva dopo, nella Preparazione del
    # turno nuovo: l'innesco vale ancora — non oltre.
    engine = eredita([["u", "UMANO"], ["v", "VESTIGIO", { "assignedTo" => "u" }]], b: [["g", "GROSSO"]], attacks: ["u"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert blocco(engine, "g", "u")[:ok]
    assert risolvi(engine, [esito("u", blocker: "g", kind: "block", attacker_dies: true, blocker_dies: true)])[:ok]
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    resta = { "t" => "remain", "uid" => "v", "effect" => { "source" => "v", "event" => "on_death", "entering" => "u" } }
    verdict = engine.judge(resta)
    assert verdict[:ok], verdict[:reason]
    tardi = eredita([["u", "UMANO"], ["v", "VESTIGIO", { "assignedTo" => "u" }]], b: [["g", "GROSSO"]], attacks: ["u"])
    tardi.judge({ "t" => "phase", "phase" => "reazione" })
    assert blocco(tardi, "g", "u")[:ok]
    assert risolvi(tardi, [esito("u", blocker: "g", kind: "block", attacker_dies: true, blocker_dies: true)])[:ok]
    tardi.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    tardi.judge({ "t" => "phase", "phase" => "fronte" })
    assert_match(/seguito questo turno/, tardi.judge(resta)[:reason], "in Fronte del turno dopo, l'innesco è passato")
  end

  # --- §3.2: la tassa di Flusso viaggia nel cambio di turno ---------------------

  TASSE = EREDITA.merge(
    "GABELLIERE" => { type: "entity", keywords: [], race: "auros", power: 3, flux_cost: 3,
                      static_forms: [{ kind: "flux_toll", amount: 1 }] }
  ).freeze

  def test_la_tassa_di_flusso_di_chi_entra_deve_tornare_e_si_paga_alla_ricarica
    engine = Rubyfront::Engine.new(cards: TASSE)
    load = lambda do |seat, list|
      cards = list.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => seat, "zone" => "field", "order" => i, "cardId" => id, "y" => seat == "a" ? 1260 : 172 } }
      engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    end
    load.call("a", [["g1", "GABELLIERE"], ["g2", "GABELLIERE"], ["u", "UMANO"]])
    load.call("b", [["x", "AUROS"]])
    assert engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" }, actor: "a")[:ok], "B non ha tasse: senza toll"
    assert_match(/tassa di Flusso di chi entra è 2, non 0/, engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" }, actor: "b")[:reason])
    assert_match(/è 2, non 1/, engine.judge({ "t" => "turn", "turn" => 3, "active" => "a", "toll" => 1 }, actor: "b")[:reason])
    verdict = engine.judge({ "t" => "turn", "turn" => 3, "active" => "a", "toll" => 2 }, actor: "b")
    assert verdict[:ok], verdict[:reason]
    table = copia(engine)
    assert_equal 2, table.flux_max("a")
    assert_equal 0, table.flux("a"), "2 di massimo meno 2 di tassa"
    # In Ritiro non tassa più.
    engine.judge({ "t" => "toZone", "uid" => "g1", "zone" => "ritiro" }, actor: "a")
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" }, actor: "a")
    assert_match(/è 1, non 2/, engine.judge({ "t" => "turn", "turn" => 5, "active" => "a", "toll" => 2 }, actor: "b")[:reason])
    assert engine.judge({ "t" => "turn", "turn" => 5, "active" => "a", "toll" => 1 }, actor: "b")[:ok]
    assert_equal 2, copia(engine).flux("a"), "3 di massimo meno 1"
  end

  # --- §3.1: le abilità speciali del Rubyfront, con la Furia (§8.1) ------------

  ABILITA = EREDITA.merge(
    "ARCANO" => { type: "rubyfront", keywords: ["fury"], health: 21, fury_at: { 0 => 13 },
                  abilities: [
                    { id: "sguardo", face: 0, timing: %w[preparazione fronte], cost: nil, gain: 3, fury: true,
                      form: { kind: "look", count: 3, reveal: { type: "entity", race: "human" } } },
                    { id: "carica", face: 0, timing: %w[preparazione fronte], cost: 5, gain: nil, fury: true,
                      form: { kind: "power", amount: 1, targets: "all", race: "human", attacking: true, armed: false } },
                    { id: "colpo", face: 0, timing: %w[preparazione fronte], cost: 3, gain: nil, fury: true,
                      form: { kind: "power", amount: 2, targets: "one", race: nil, attacking: false, armed: true } },
                    { id: "sconto", face: 0, timing: %w[preparazione], cost: 3, gain: nil, fury: false,
                      form: { kind: "discount", amount: 1, type: "object", race: nil } },
                    { id: "ignota", face: 0, timing: %w[preparazione], cost: 7, gain: nil, fury: false, form: nil },
                    { id: "passo", face: 1, timing: %w[preparazione], cost: nil, gain: 3, fury: false,
                      form: { kind: "discount", amount: 1, type: "entity", race: "human" } },
                  ] },
    "FERRO" => { type: "object", keywords: [], flux_cost: 2 },
    "GEMMA" => { type: "object", keywords: [], flux_cost: 1 }
  ).freeze

  # A ha il Rubyfront ARCANO schierato, due Umani e un Auros sul Fronte, un
  # Oggetto addosso all'Umano u1; in mano un Oggetto (FERRO) e un Umano.
  def arcano(y: 1260, hand: [])
    engine = Rubyfront::Engine.new(cards: ABILITA)
    a = [["u1", "UMANO"], ["u2", "UMANO"], ["x", "AUROS"], ["rf", "ARCANO", { "y" => y }],
         ["o1", "FERRO", { "assignedTo" => "u1" }], ["h1", "FERRO", { "zone" => "hand" }], ["h2", "CORRIDORE", { "zone" => "hand" }]] + hand
    b = [["b1", "AUROS"], ["rf-b", "RUBINO", { "y" => 172 }]]
    load = lambda do |seat, list|
      cards = list.map.with_index do |(uid, id, extra), i|
        { "uid" => uid, "owner" => seat, "zone" => "field", "order" => i, "cardId" => id, "y" => seat == "a" ? 1260 : 172 }.merge(extra || {})
      end
      deck = { "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards }
      deck["hp"] = 21 if seat == "a"
      engine.judge(deck)
    end
    load.call("a", a + (1..4).map { |i| ["d#{i}", i.odd? ? "UMANO" : "AUROS", { "zone" => "deck" }] })
    load.call("b", b)
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    Rubyfront::Table::SEATS.each { |seat| engine.judge({ "t" => "player", "seat" => seat, "patch" => { "flux" => 10, "fluxMax" => 10 } }) }
    engine
  end

  def abilita(engine, id, cost: nil, gain: nil, roll: nil, fail: nil, targets: nil, power: nil, discount: nil, actor: "a")
    action = { "t" => "ability", "uid" => "rf", "ability" => id }
    action["cost"] = cost unless cost.nil?
    action["gain"] = gain unless gain.nil?
    action["roll"] = roll unless roll.nil?
    action["fail"] = fail unless fail.nil?
    action["targets"] = targets unless targets.nil?
    action["power"] = power unless power.nil?
    action["discount"] = discount unless discount.nil?
    engine.judge(action, actor: actor)
  end

  def test_l_abilita_paga_o_recupera_i_pv_stampati_e_vuole_il_tiro_della_furia
    engine = arcano
    assert_match(/costa 5 PV/, abilita(engine, "carica", cost: 4, roll: 15, fail: false, targets: [], power: 1)[:reason])
    assert_match(/non porta un tiro valido/, abilita(engine, "carica", cost: 5, targets: [], power: 1)[:reason])
    assert_match(/col 7 l'esito dev'essere il fallimento/, abilita(engine, "carica", cost: 5, roll: 7, fail: false, targets: [], power: 1)[:reason])
    verdict = abilita(engine, "carica", cost: 5, roll: 7, fail: true, targets: [], power: 1)
    assert verdict[:ok], verdict[:reason]
    assert_equal 15, copia(engine).hp("a"), "5 di costo e 1 di Furia fallita"
    assert_match(/una sola abilità speciale per turno/, abilita(engine, "sguardo", gain: 3, roll: 13, fail: false)[:reason], "la seconda nel turno non passa")
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" }, actor: "a")
    engine.judge({ "t" => "turn", "turn" => 5, "active" => "a" }, actor: "b")
    verdict = abilita(engine, "sguardo", gain: 3, roll: 13, fail: false)
    assert verdict[:ok], verdict[:reason]
    assert_equal 18, copia(engine).hp("a"), "il recupero, al turno dopo"
    assert_match(/non tira la Furia/, abilita(arcano, "sconto", cost: 3, roll: 20, fail: false, discount: { "amount" => 1, "type" => "object", "race" => nil })[:reason])
  end

  def test_l_abilita_vuole_pv_a_sufficienza_il_campo_il_turno_e_la_finestra
    engine = arcano
    engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 4 } })
    assert_match(/servono 5 PV, ne hai 4/, abilita(engine, "carica", cost: 5, roll: 15, fail: false, targets: [], power: 1)[:reason])
    engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 5 } })
    assert abilita(engine, "carica", cost: 5, roll: 15, fail: false, targets: [], power: 1)[:ok], "pagare fino a 0 esatto è legale"
    assert_match(/una sola abilità speciale per turno/, abilita(engine, "sguardo", gain: 3, roll: 15, fail: false)[:reason])
    assert_match(/Zona di Richiamo/, abilita(arcano(y: 1756), "sconto", cost: 3, discount: { "amount" => 1, "type" => "object", "race" => nil })[:reason])
    assert_match(/non tocca a te/, abilita(arcano, "sconto", cost: 3, discount: { "amount" => 1, "type" => "object", "race" => nil }, actor: "b")[:reason])
    engine = arcano
    fronte!(engine)
    assert_match(/in Fase di Preparazione \(§3.1\)/, abilita(engine, "sconto", cost: 3, discount: { "amount" => 1, "type" => "object", "race" => nil })[:reason], "lo sconto è solo di Preparazione")
    assert_match(/non ha quell'abilità/, abilita(engine, "passo", gain: 3, discount: { "amount" => 1, "type" => "entity", "race" => "human" })[:reason], "abilità dell'altra faccia")
    assert_match(/resta a mano/, abilita(arcano, "ignota", cost: 7)[:reason])
  end

  def test_il_potenziamento_dell_abilita_va_ai_bersagli_della_forma
    engine = arcano
    fronte!(engine)
    engine.judge({ "t" => "declare", "declaration" => { "id" => "u1", "from" => "u1", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 } }, actor: "a")
    assert_match(/TUTTE le Entità/, abilita(engine, "carica", cost: 5, roll: 15, fail: false, targets: %w[u1 u2], power: 1)[:reason], "u2 non attacca")
    assert_match(/\+1 Potenza, not|\+1 Potenza, non/, abilita(engine, "carica", cost: 5, roll: 15, fail: false, targets: %w[u1], power: 2)[:reason])
    verdict = abilita(engine, "carica", cost: 5, roll: 15, fail: false, targets: %w[u1], power: 1)
    assert verdict[:ok], verdict[:reason]
    assert_equal 1, copia(engine).card("u1")[:power_bonus]
    engine = arcano
    assert_match(/UNA Entità/, abilita(engine, "colpo", cost: 3, roll: 15, fail: false, targets: %w[u2], power: 2)[:reason], "u2 non ha Oggetti")
    assert abilita(engine, "colpo", cost: 3, roll: 15, fail: false, targets: %w[u1], power: 2)[:ok]
    assert_equal 2, copia(engine).card("u1")[:power_bonus]
  end

  def test_lo_sguardo_dell_abilita_si_risolve_dopo_una_volta_per_attivazione
    engine = arcano
    ref = { "source" => "rf", "event" => "on_ability", "entering" => "rf", "ability" => "sguardo" }
    assert_match(/non è stata attivata/, engine.judge({ "t" => "look", "seat" => "a", "count" => 3, "effect" => ref }, actor: "a")[:reason])
    assert abilita(engine, "sguardo", gain: 3, roll: 15, fail: false)[:ok]
    assert_match(/prime 3 carte, non 2/, engine.judge({ "t" => "look", "seat" => "a", "count" => 2, "effect" => ref }, actor: "a")[:reason])
    verdict = engine.judge({ "t" => "look", "seat" => "a", "count" => 3, "effect" => ref }, actor: "a")
    assert verdict[:ok], verdict[:reason]
    assert_match(/non è stata attivata|già stato fatto/, engine.judge({ "t" => "look", "seat" => "a", "count" => 3, "effect" => ref }, actor: "a")[:reason], "una volta sola")
  end

  def test_lo_sconto_dell_abilita_vale_sulla_prossima_carta_del_tipo_nel_turno
    engine = arcano
    assert abilita(engine, "sconto", cost: 3, discount: { "amount" => 1, "type" => "object", "race" => nil })[:ok]
    gioca = lambda do |uid, cost, discount = nil|
      action = { "t" => "toZone", "uid" => uid, "zone" => "field", "x" => 632, "y" => 1260, "cost" => cost, "assignTo" => "u2" }
      action["discount"] = discount if discount
      engine.judge(action, actor: "a")
    end
    assert_match(/costa 2 di Flusso e l'azione ne paga 1/, gioca.call("h1", 1)[:reason], "senza dichiararlo lo sconto non c'è")
    assert_match(/nessuno sconto di 2/, gioca.call("h1", 0, 2)[:reason])
    verdict = gioca.call("h1", 1, 1)
    assert verdict[:ok], verdict[:reason]
    assert_equal 9, copia(engine).flux("a")
    assert_empty copia(engine).discounts("a"), "consumato"
    # Un'Entità non è un Oggetto: lo sconto non vale (turno nuovo: una sola abilità per turno).
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" }, actor: "a")
    engine.judge({ "t" => "turn", "turn" => 5, "active" => "a" }, actor: "b")
    assert abilita(engine, "sconto", cost: 3, discount: { "amount" => 1, "type" => "object", "race" => nil })[:ok]
    assert_match(/nessuno sconto/, engine.judge({ "t" => "toZone", "uid" => "h2", "zone" => "field", "x" => 632, "y" => 1260, "cost" => 0, "discount" => 1 }, actor: "a")[:reason])
    engine.judge({ "t" => "turn", "turn" => 6, "active" => "b" }, actor: "a")
    assert_empty copia(engine).discounts("a"), "gli sconti cadono col turno"
  end

  # --- §3.1: il Nexus — il flip e «quando flippa» -----------------------------

  def nexus_pronto(humans: 4, hand: [["h", "AUROS", { "zone" => "hand" }]], y: 1260)
    mine = (1..humans).map { |i| ["u#{i}", "UMANO"] } + [["riportante", "RIPORTANTE"], ["rf", "RADUNO", { "y" => y }]] + hand + [["rip2", "RIPORTANTE", { "zone" => "hand" }]]
    eredita(mine)
  end

  def flip(engine, discard: "h", recover: 5, face: 1, actor: "a")
    engine.judge({ "t" => "flip", "uid" => "rf", "face" => face, "discard" => discard, "recover" => recover }, actor: actor)
  end

  def test_il_flip_vuole_quattro_umani_lo_scarto_e_il_recupero_giusto
    assert_match(/almeno 4 Entità Umane.*ne hai 3/, flip(nexus_pronto(humans: 2))[:reason])
    engine = nexus_pronto
    assert_match(/scartare una carta Entità/, flip(engine, discard: nil)[:reason])
    assert_match(/scartare una carta Entità/, flip(engine, discard: "u1")[:reason], "dalla mano")
    assert_match(/recupera 5 PV, non 0/, flip(engine, recover: nil)[:reason])
    assert_match(/Zona di Richiamo/, flip(nexus_pronto(y: 1756))[:reason])
    assert_match(/non tocca a te/, flip(engine, actor: "b")[:reason])
    verdict = flip(engine)
    assert verdict[:ok], verdict[:reason]
    tavolo = copia(engine)
    assert_equal 1, tavolo.card("rf")[:face]
    assert_equal 25, tavolo.hp("a")
    assert_equal "ritiro", tavolo.card("h")[:zone], "lo scarto del flip va in Zona di Ritiro (§5, §6.5)"
    assert_match(/non si torna al Rubyfront/, flip(engine, face: 0)[:reason])
  end

  def test_il_flip_si_fa_in_preparazione_o_al_fronte_non_in_reazione
    engine = nexus_pronto
    fronte!(engine)
    engine.judge({ "t" => "declare", "declaration" => { "id" => "u1", "from" => "u1", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 } })
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/dalla Preparazione al Fronte/, flip(engine)[:reason])
  end

  def test_quando_flippa_la_carta_nominata_va_nell_abisso_e_non_si_gioca_piu
    engine = nexus_pronto
    ref = { "source" => "rf", "event" => "on_flip", "entering" => "rf" }
    via = { "t" => "toZone", "uid" => "riportante", "zone" => "abisso", "effect" => ref }
    assert_match(/flippato questo turno/, engine.judge(via)[:reason])
    assert flip(engine)[:ok]
    assert_match(/dal proprio Fronte/, engine.judge(via.merge("uid" => "u1"))[:reason])
    verdict = engine.judge(via)
    assert verdict[:ok], verdict[:reason]
    assert_equal "abisso", copia(engine).card("riportante")[:zone]
    assert_match(/già stato risolto/, engine.judge(via)[:reason])
    sigillo = { "t" => "player", "seat" => "a", "patch" => { "sealed" => ["RIPORTANTE"] }, "effect" => ref }
    assert_match(/aggiunge RIPORTANTE/, engine.judge(sigillo.merge("patch" => { "sealed" => ["RIPORTANTE", "UMANO"] }))[:reason])
    assert engine.judge(sigillo)[:ok]
    assert copia(engine).sealed?("a", "RIPORTANTE")
    # «Poi pesca una carta» (dal 2026-09-10).
    pesca = { "t" => "draw", "seat" => "a", "count" => 1, "effect" => ref }
    assert_match(/pesca chi comanda il Nexus, 1/, engine.judge(pesca.merge("count" => 2))[:reason])
    assert_match(/pesca chi comanda il Nexus, 1/, engine.judge(pesca.merge("seat" => "b"))[:reason])
    verdict = engine.judge(pesca)
    assert verdict[:ok], verdict[:reason]
    assert_match(/già stato risolto/, engine.judge(pesca)[:reason])
    assert_match(/non si può più giocare/, engine.judge({ "t" => "toZone", "uid" => "rip2", "zone" => "field", "x" => 442, "y" => 1260, "cost" => 6 })[:reason])
    # Il turno dopo il flip è passato: l'innesco non si riscalda.
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 5, "active" => "a" })
    assert_match(/flippato questo turno/, engine.judge(via.merge("uid" => "u2"))[:reason])
  end

  def test_il_flip_armato_conta_le_entita_con_un_oggetto_e_scarta_una_carta_qualsiasi
    forgia = lambda do |armed|
      mine = (1..3).flat_map { |i| [["u#{i}", "UMANO"]] + (i <= armed ? [["s#{i}", "SCUDO", { "assignedTo" => "u#{i}" }]] : []) }
      eredita(mine + [["rf", "FORGIA", { "y" => 1260 }], ["m", "PIETRA", { "zone" => "hand" }]])
    end
    assert_match(/almeno 3 Entità con un Oggetto assegnato.*ne hai 2/, flip(forgia.call(2), discard: "m")[:reason])
    engine = forgia.call(3)
    assert_match(/scartare una carta dalla mano/, flip(engine, discard: nil)[:reason])
    verdict = flip(engine, discard: "m")
    assert verdict[:ok], verdict[:reason]
    assert_equal "ritiro", engine.instance_variable_get(:@table).card("m")[:zone]
  end

  def test_un_rubyfront_senza_requisito_certificato_flippa_a_mano
    engine = eredita([["rf", "RUBINO", { "y" => 1260 }]])
    refute engine.judge({ "t" => "flip", "uid" => "rf", "face" => 1 })[:ruled]
  end

  # --- §8.2: il disarmo con riarmo all'ingresso e il ritorno vincolato -------
  # Le forme certificate del 2026-09-10: «quando entra, ogni Oggetto
  # assegnato a un'Entità avversaria nella Zona di Ritiro del proprietario,
  # poi gli Oggetti del tuo Ritiro alle tue Entità, gratis» e «mandata
  # nell'Abisso o in Ritiro senza Oggetti addosso, torna sul Fronte con un
  # Oggetto entro il costo dal tuo Ritiro». Fixture a etichette di forma.

  DISARMI = {
    "DISARMATORE" => { type: "entity", keywords: [], race: "auros", power: 4, flux_cost: 4,
                 enter_disarms: [{ to: "ritiro" }], enter_rearms: [{ any: true }] },
    "FABBRO" => { type: "entity", keywords: [], race: "auros", power: 2, flux_cost: 3, enter_rearms: [{ self: true }] },
    "REDIVIVA" => { type: "entity", keywords: [], race: "auros", power: 1, flux_cost: 1, leave_returns: [{ max_cost: 2 }] },
    "UMANO" => { type: "entity", keywords: [], race: "human", power: 2, flux_cost: 2 },
    "SPINOSO" => { type: "entity", keywords: [], race: "human", power: 2, counterattack: 1, flux_cost: 3 },
    "LAMA" => { type: "object", keywords: [], flux_cost: 2 },
    "MAZZA" => { type: "object", keywords: [], flux_cost: 3 },
    "RUBINO" => { type: "rubyfront", keywords: [], power: nil, counterattack: nil },
  }.freeze

  # Tavolo al turno 3 di A, con 10 Flusso: le liste sono [uid, id, extra].
  def disarmi(a, b: [])
    engine = Rubyfront::Engine.new(cards: DISARMI)
    load = lambda do |seat, list|
      cards = list.map.with_index do |(uid, id, extra), i|
        { "uid" => uid, "owner" => seat, "zone" => "field", "order" => i, "cardId" => id, "y" => seat == "a" ? 1260 : 172 }.merge(extra || {})
      end
      engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    end
    load.call("a", a + [["rf-a", "RUBINO", { "y" => 1260 }]])
    load.call("b", b + [["rf-b", "RUBINO", { "y" => 172 }]])
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    Rubyfront::Table::SEATS.each { |seat| engine.judge({ "t" => "player", "seat" => seat, "patch" => { "flux" => 10, "fluxMax" => 10 } }) }
    engine
  end

  def entra_disarmatore(engine)
    verdict = engine.judge({ "t" => "toZone", "uid" => "dis", "zone" => "field", "x" => 821, "y" => 1260, "cost" => 4 })
    raise "l'ingresso non passa: #{verdict[:reason]}" unless verdict[:ok]
    engine
  end

  def disarma(engine, uid, zone: "ritiro")
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => zone,
                   "effect" => { "source" => "dis", "event" => "on_enter_field", "entering" => "dis", "follow" => "disarm" } })
  end

  def riarma(engine, uid, to, extra = {})
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => 472, "y" => 1266, "assignTo" => to,
                   "effect" => { "source" => "dis", "event" => "on_enter_field", "entering" => "dis", "follow" => "rearm" } }.merge(extra))
  end

  def disarmatore_in_campo(hand_objects: [])
    engine = disarmi(
      [["dis", "DISARMATORE", { "zone" => "hand" }], ["mio", "UMANO", { "x" => 442 }], ["lama-a", "LAMA", { "zone" => "ritiro" }], ["mazza-a", "MAZZA", { "zone" => "ritiro" }]] + hand_objects,
      b: [["suo", "UMANO", { "x" => 442 }], ["lama-b", "LAMA", { "x" => 472, "y" => 202, "assignedTo" => "suo" }], ["mazza-b", "MAZZA", { "zone" => "ritiro" }]]
    )
    entra_disarmatore(engine)
  end

  def test_il_disarmo_manda_in_ritiro_l_oggetto_assegnato_a_un_entita_avversaria
    engine = disarmatore_in_campo
    verdict = disarma(engine, "lama-b")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    card = engine.instance_variable_get(:@table).card("lama-b")
    assert_equal "ritiro", card[:zone]
    assert_nil card[:assigned_to]
  end

  def test_il_disarmo_non_tocca_gli_oggetti_propri_ne_quelli_sciolti_ne_le_entita
    engine = disarmatore_in_campo
    engine.judge({ "t" => "toZone", "uid" => "mazza-b", "zone" => "field", "x" => 821, "y" => 172 }, actor: "b")
    refute disarma(engine, "mazza-b")[:ok], "un Oggetto avversario non assegnato non si disarma"
    refute disarma(engine, "suo")[:ok], "un'Entità non è un Oggetto"
    engine.judge({ "t" => "toZone", "uid" => "lama-a", "zone" => "field", "x" => 472, "y" => 1266, "assignTo" => "mio" })
    refute disarma(engine, "lama-a")[:ok], "i propri Oggetti restano addosso"
    refute disarma(engine, "lama-b", zone: "abisso")[:ok], "in Ritiro, non nell'Abisso"
  end

  def test_il_disarmo_vale_solo_nel_turno_d_ingresso
    engine = disarmatore_in_campo
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 5, "active" => "a" })
    verdict = disarma(engine, "lama-b")
    refute verdict[:ok]
    assert_includes verdict[:reason], "§8.2"
  end

  def test_una_carta_senza_la_forma_non_disarma
    engine = disarmatore_in_campo
    verdict = engine.judge({ "t" => "toZone", "uid" => "lama-b", "zone" => "ritiro",
                             "effect" => { "source" => "mio", "event" => "on_enter_field", "entering" => "mio", "follow" => "disarm" } })
    refute verdict[:ok]
  end

  def test_il_riarmo_assegna_gratis_dal_proprio_ritiro_quanti_oggetti_si_vuole
    engine = disarmatore_in_campo
    disarma(engine, "lama-b")
    flux = engine.instance_variable_get(:@table).flux("a")
    verdict = riarma(engine, "lama-a", "mio")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    verdict = riarma(engine, "mazza-a", "dis")
    assert verdict[:ok], "quanti se ne vuole: #{verdict[:reason]}"
    table = engine.instance_variable_get(:@table)
    assert_equal "mio", table.card("lama-a")[:assigned_to]
    assert_equal "dis", table.card("mazza-a")[:assigned_to]
    assert_equal flux, table.flux("a"), "senza pagarne il costo"
  end

  def test_il_riarmo_non_prende_dal_ritiro_altrui_ne_va_su_entita_altrui_o_coperte_e_non_si_paga
    engine = disarmatore_in_campo
    disarma(engine, "lama-b")
    refute riarma(engine, "lama-b", "mio")[:ok], "l'Oggetto disarmato è nel Ritiro del suo proprietario, non nel mio"
    refute riarma(engine, "lama-a", "suo")[:ok], "solo alle Entità che controllo"
    refute riarma(engine, "lama-a", "mio", "cost" => 2)[:ok], "gratis, non pagando"
    engine.judge({ "t" => "facedown", "uid" => "mio", "facedown" => true })
    refute riarma(engine, "lama-a", "mio")[:ok], "un'Entità coperta è intoccabile (§3.1)"
  end

  def test_il_riarmo_su_di_se_all_ingresso_va_addosso_a_chi_entra_una_volta_sola
    engine = disarmi([["fab", "FABBRO", { "zone" => "hand" }], ["mio", "UMANO", { "x" => 442 }], ["lama-a", "LAMA", { "zone" => "ritiro" }], ["mazza-a", "MAZZA", { "zone" => "ritiro" }]])
    assert engine.judge({ "t" => "toZone", "uid" => "fab", "zone" => "field", "x" => 821, "y" => 1260, "cost" => 3 })[:ok]
    riarma_fab = lambda do |uid, to|
      engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => 851, "y" => 1290, "assignTo" => to,
                     "effect" => { "source" => "fab", "event" => "on_enter_field", "entering" => "fab", "follow" => "rearm" } })
    end
    refute riarma_fab.call("lama-a", "mio")[:ok], "su di sé, non su un'altra Entità"
    verdict = riarma_fab.call("lama-a", "fab")
    assert verdict[:ok], verdict[:reason]
    assert_equal "fab", engine.instance_variable_get(:@table).card("lama-a")[:assigned_to]
    refute riarma_fab.call("mazza-a", "fab")[:ok], "una volta per ingresso"
  end

  def test_il_riarmo_di_un_oggetto_ignoto_tace
    engine = disarmatore_in_campo(hand_objects: [["boh", "IGNOTA", { "zone" => "ritiro" }]])
    refute riarma(engine, "boh", "mio")[:ruled]
  end

  # Il ritorno vincolato: la carta esce e torna nello stesso turno (fixture REDIVIVA).
  def rediviva_in_campo
    disarmi(
      [["red", "REDIVIVA", { "x" => 442 }], ["lama-a", "LAMA", { "zone" => "ritiro" }], ["mazza-a", "MAZZA", { "zone" => "ritiro" }]],
      b: [["suo", "UMANO", { "x" => 442 }], ["lama-b", "LAMA", { "zone" => "ritiro" }]]
    )
  end

  def ritorna(engine, uid: "red", object: "lama-a", x: 821, y: 1260, actor: nil, ref: nil)
    engine.judge({ "t" => "revive", "uid" => uid, "x" => x, "y" => y, "z" => 9, "object" => object,
                   "effect" => ref || { "source" => uid, "event" => "on_leave_field", "entering" => uid } }, actor: actor)
  end

  def test_il_ritorno_vincolato_riporta_sul_fronte_chi_e_appena_uscita_con_un_oggetto_dal_ritiro
    engine = rediviva_in_campo
    engine.judge({ "t" => "toZone", "uid" => "red", "zone" => "ritiro" })
    verdict = ritorna(engine)
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    table = engine.instance_variable_get(:@table)
    assert_equal "field", table.card("red")[:zone]
    assert_equal "field", table.card("lama-a")[:zone]
    assert_equal "red", table.card("lama-a")[:assigned_to]
    assert_nil table.card("red")[:left]
  end

  def test_il_ritorno_vincolato_lo_decide_il_proprietario
    engine = rediviva_in_campo
    engine.judge({ "t" => "toZone", "uid" => "red", "zone" => "ritiro" })
    refute ritorna(engine, actor: "b")[:ok], "lo decide il proprietario"
    assert ritorna(engine, actor: "a")[:ok]
  end

  def test_il_ritorno_vincolato_non_vale_se_e_uscita_armata_o_in_un_altro_turno
    engine = disarmi([["red", "REDIVIVA", { "x" => 442 }], ["mazza-a", "MAZZA", { "x" => 472, "y" => 1266, "assignedTo" => "red" }], ["lama-a", "LAMA", { "zone" => "ritiro" }]])
    engine.judge({ "t" => "toZone", "uid" => "red", "zone" => "ritiro" })
    verdict = ritorna(engine)
    refute verdict[:ok]
    assert_includes verdict[:reason], "Oggetti addosso"

    engine = rediviva_in_campo
    engine.judge({ "t" => "toZone", "uid" => "red", "zone" => "ritiro" })
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    assert ritorna(engine, actor: "a")[:ok], "nella Preparazione del turno appena aperto l'innesco vale ancora (la Reazione si chiude in un fiato)"
    engine = rediviva_in_campo
    engine.judge({ "t" => "toZone", "uid" => "red", "zone" => "ritiro" })
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    engine.judge({ "t" => "phase", "phase" => "fronte" })
    refute ritorna(engine, actor: "a")[:ok], "l'innesco è passato col turno"
  end

  def test_il_ritorno_vincolato_vuole_un_oggetto_entro_il_costo_dal_proprio_ritiro_e_uno_slot_libero
    engine = rediviva_in_campo
    engine.judge({ "t" => "toZone", "uid" => "red", "zone" => "ritiro" })
    refute ritorna(engine, object: "mazza-a")[:ok], "costo 3 > 2"
    refute ritorna(engine, object: "lama-b")[:ok], "dal PROPRIO Ritiro"
    refute ritorna(engine, object: "suo")[:ok], "un Oggetto, non un'Entità"
    refute ritorna(engine, y: 172)[:ok], "sul proprio Fronte"
    refute ritorna(engine, x: 500)[:ok], "su uno slot"
    assert ritorna(engine, x: 442)[:ok], "lo slot lasciato libero va bene"
  end

  def test_il_ritorno_vincolato_con_il_fronte_pieno_non_passa
    engine = disarmi(
      [["red", "REDIVIVA", { "x" => 442 }], ["u1", "UMANO", { "x" => 821 }], ["u2", "UMANO", { "x" => 1199 }], ["u3", "UMANO", { "x" => 1578 }],
       ["u4", "UMANO", { "x" => 1956 }], ["lama-a", "LAMA", { "zone" => "ritiro" }], ["u5", "UMANO", { "zone" => "hand" }]]
    )
    engine.judge({ "t" => "toZone", "uid" => "red", "zone" => "ritiro" })
    engine.judge({ "t" => "toZone", "uid" => "u5", "zone" => "field", "x" => 442, "y" => 1260, "cost" => 2 })
    verdict = ritorna(engine)
    refute verdict[:ok]
    assert_includes verdict[:reason], "§6.2"
  end

  def test_il_ritorno_vincolato_senza_la_forma_o_ignoto_non_passa
    engine = disarmi([["mio", "UMANO", { "x" => 442 }], ["red", "REDIVIVA", { "x" => 821 }], ["lama-a", "LAMA", { "zone" => "ritiro" }]])
    engine.judge({ "t" => "toZone", "uid" => "mio", "zone" => "ritiro" })
    refute ritorna(engine, uid: "mio")[:ok], "senza la forma non si torna"
    engine.judge({ "t" => "toZone", "uid" => "red", "zone" => "ritiro" })
    refute ritorna(engine, ref: { "source" => "red", "event" => "on_enter_field", "entering" => "red" })[:ok], "l'evento è l'uscita dal campo"
    engine = disarmi([["boh", "IGNOTA", { "x" => 442 }], ["lama-a", "LAMA", { "zone" => "ritiro" }]])
    engine.judge({ "t" => "toZone", "uid" => "boh", "zone" => "ritiro" })
    refute ritorna(engine, uid: "boh")[:ruled]
  end

  def test_la_morte_in_battaglia_lascia_l_annotazione_dell_uscita
    engine = disarmi(
      [["red", "REDIVIVA", { "x" => 442 }], ["lama-a", "LAMA", { "zone" => "ritiro" }]],
      b: [["suo", "SPINOSO", { "x" => 442 }]]
    )
    fronte!(engine)
    engine.judge({ "t" => "declare", "declaration" => { "id" => "red", "from" => "red", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 } })
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    engine.judge({ "t" => "declare", "declaration" => { "id" => "suo", "from" => "suo", "to" => "red", "kind" => "counter", "seat" => "b", "order" => 0 } }, actor: "b")
    verdict = engine.judge({ "t" => "resolve", "seat" => "a", "battles" => [
                               { "attacker" => "red", "blocker" => "suo", "kind" => "counter", "attackerDies" => true, "blockerDies" => false, "damage" => 0 },
                             ] }, actor: "b")
    assert verdict[:ok], verdict[:reason]
    table = engine.instance_variable_get(:@table)
    assert_equal "abisso", table.card("red")[:zone]
    assert_equal({ turn: 3, armed: false, bearer: nil }, table.card("red")[:left])
    assert ritorna(engine, actor: "a")[:ok]
  end
end
