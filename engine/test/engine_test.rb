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
    %w[field hand deck abisso].each do |zone|
      verdict = engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => zone, "x" => 442, "y" => 1236 })
      refute verdict[:ok], zone
      assert_match(/dalla Zona di Ritiro si esce solo per effetto.*§5, §6\.2/, verdict[:reason])
      assert_match(/leave the Retire Zone only through an effect.*§5, §6\.2/, verdict[:reason_en])
    end
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

  def test_la_fase_di_fronte_addizionale_si_apre_dalla_reazione_solo_se_dovuta
    engine = ondata([["a1", "FORTE"]], [], ["a1"], [])
    refute engine.judge({ "t" => "phase", "phase" => "fronte" })[:ok], "senza promessa la fase è a senso unico"
    engine.observe({ "t" => "refresh", "seat" => "a", "roll" => 18, "extra" => true, "effect" => { "source" => "a1", "event" => "on_attack", "entering" => "a1" } })
    assert risolvi(engine, [battaglia("a1", damage: 4)])[:ok]
    # La apre chi chiude la Reazione: il difensore.
    verdict = engine.judge({ "t" => "phase", "phase" => "fronte" }, actor: "b")
    assert verdict[:ok], verdict[:reason]
    assert_equal "fronte", engine.instance_variable_get(:@table).phase
    refute engine.judge({ "t" => "phase", "phase" => "fronte" }, actor: "b")[:ok], "una volta sola"
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
    # §5 — «un'Entità occupa lo slot in cui è scesa»: nemmeno su uno slot libero.
    verdict = engine.judge({ "t" => "move", "uid" => "a-1", "x" => 1199, "y" => 1236, "z" => 3 })
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
    scendi_in_campo(engine, "a-1", x: 442, y: 1236)
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
    assert engine.judge({ "t" => "move", "uid" => "a-1", "x" => 1199, "y" => 1236, "z" => 3 })[:ok]
    refute engine.judge({ "t" => "move", "uid" => "a-1", "x" => 442, "y" => 1236, "z" => 4 })[:ok], "annotata la fila, lo slot è quello"
  end

  # --- §5: l'Abisso -----------------------------------------------------------

  def test_nell_abisso_non_si_va_a_mano
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "a", "a-1", "LENTA")
    scendi_in_campo(engine, "a-1", x: 442, y: 1236)
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
    refute verdict[:ok]
    assert_match(/non a mano.*§5/, verdict[:reason])
    assert_match(/not by hand.*§5/, verdict[:reason_en])
  end

  def test_la_materia_in_campo_va_nell_abisso
    # «Materie risolte, decadute o svanite» (§5): la Materia in campo ci va sempre.
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    in_mano(engine, "a", "m-1", "PIETRA")
    scendi_in_campo(engine, "m-1", x: 2368, y: 1236)
    assert engine.judge({ "t" => "toZone", "uid" => "m-1", "zone" => "abisso" })[:ok]
  end

  def test_lo_scarto_per_eccesso_passa_dalla_mano
    # §6.5: «le carte in eccesso vanno scartate (nell'Abisso)» — solo oltre le 7.
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    cards = (1..8).map { |i| { "uid" => "a-#{i}", "owner" => "a", "zone" => "hand", "order" => i, "cardId" => "LENTA" } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    assert engine.judge({ "t" => "toZone", "uid" => "a-8", "zone" => "abisso" })[:ok], "otto in mano: l'ottava si scarta"
    refute engine.judge({ "t" => "toZone", "uid" => "a-7", "zone" => "abisso" })[:ok], "a sette non si scarta più"
  end

  def test_dall_abisso_non_si_torna
    engine = Rubyfront::Engine.new(cards: FINESTRA)
    cards = [{ "uid" => "a-1", "owner" => "a", "zone" => "abisso", "order" => 0, "cardId" => "LENTA" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    %w[hand deck field ritiro].each do |zone|
      verdict = engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => zone, "x" => 442, "y" => 1236 })
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
    assert_match(/§8\.2/, verdict[:reason], "fermato come effetto finto, non come gesto")
  end

  # --- §8.2: l'Arciere manda un'Entità avversaria in Ritiro (RBF-007) ------

  ARCIERI = {
    "ARCIERE" => { type: "entity", keywords: [], race: "human",
                   enter_moves: [{ target: { type: "entity", controller: "opponent" }, to: "ritiro" }] },
    "UMANO" => { type: "entity", keywords: [], race: "human" },
    "PIETRA" => { type: "matter", keywords: [], behavior: "normal" },
  }.freeze

  # A ha l'Arciere in mano, B quelle carte in campo; poi l'Arciere scende.
  def arciere(b_field)
    engine = Rubyfront::Engine.new(cards: ARCIERI)
    a = [{ "uid" => "arc", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "ARCIERE" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    b = b_field.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "b", "zone" => "field", "order" => i, "cardId" => id, "y" => 172 } }
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => b })
    engine.judge({ "t" => "toZone", "uid" => "arc", "zone" => "field", "x" => 442, "y" => 1236 })
    engine
  end

  def manda(engine, uid, zone: "ritiro", source: "arc")
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => zone,
                   "effect" => { "source" => source, "event" => "on_enter_field", "entering" => source } })
  end

  def test_l_arciere_manda_un_entita_avversaria_in_ritiro
    engine = arciere([["b1", "UMANO"]])
    verdict = manda(engine, "b1")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    assert_equal "ritiro", engine.instance_variable_get(:@table).card("b1")[:zone]
  end

  def test_l_effetto_si_consuma_una_volta
    engine = arciere([["b1", "UMANO"], ["b2", "UMANO"]])
    assert manda(engine, "b1")[:ok]
    verdict = manda(engine, "b2")
    refute verdict[:ok]
    assert_match(/già stato risolto/, verdict[:reason])
  end

  def test_il_bersaglio_deve_essere_un_entita_avversaria_in_campo
    engine = arciere([["b1", "PIETRA"]])
    refute manda(engine, "b1")[:ok], "una Materia no"
    engine = arciere([])
    refute manda(engine, "arc")[:ok], "una propria carta no"
  end

  def test_l_innesco_vale_solo_nel_turno_d_ingresso
    engine = arciere([["b1", "UMANO"]])
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    verdict = manda(engine, "b1")
    refute verdict[:ok]
    assert_match(/non è entrata in campo questo turno/, verdict[:reason])
  end

  def test_la_zona_deve_essere_quella_della_forma
    engine = arciere([["b1", "UMANO"]])
    refute manda(engine, "b1", zone: "abisso")[:ok], "nell'Abisso non è la forma dell'Arciere"
  end

  # --- §8.2: Rhen riporta una permanente dalla Zona di Ritiro (RBF-012) -----

  EREDI = {
    "RHEN" => { type: "entity", keywords: [], race: "human",
                enter_returns: [{ from: "ritiro", filter: { permanent: true }, to: "field" }] },
    "PERMANENTE" => { type: "matter", keywords: [], behavior: "permanent" },
    "NORMALE" => { type: "matter", keywords: [], behavior: "normal" },
    "UMANO" => { type: "entity", keywords: [], race: "human" },
  }.freeze

  # A ha Rhen in mano e quelle carte in Zona di Ritiro; poi Rhen scende.
  # `campo` è quante Entità stanno già sul Fronte di A (per il Fronte pieno,
  # §6.2): Rhen compresa, che scende sempre per prima.
  def rhen(ritiro, foe_ritiro: [], campo: 1)
    engine = Rubyfront::Engine.new(cards: EREDI)
    a = [{ "uid" => "rhen", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "RHEN" }]
    a += (2..campo).map { |i| { "uid" => "f#{i}", "owner" => "a", "zone" => "field", "order" => i, "cardId" => "UMANO", "x" => Rubyfront::Engine::FRONT_SLOT_X[i - 1], "y" => 1236 } }
    a += ritiro.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "ritiro", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    b = foe_ritiro.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "b", "zone" => "ritiro", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => b })
    engine.judge({ "t" => "toZone", "uid" => "rhen", "zone" => "field", "x" => 442, "y" => 1236 })
    engine
  end

  def riporta(engine, uid)
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => 2368, "y" => 1236,
                   "effect" => { "source" => "rhen", "event" => "on_enter_field", "entering" => "rhen" } })
  end

  def test_rhen_riporta_una_permanente_sul_fronte
    engine = rhen([["p1", "PERMANENTE"]])
    verdict = riporta(engine, "p1")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    assert_equal "field", engine.instance_variable_get(:@table).card("p1")[:zone]
  end

  def test_una_permanente_e_l_entita_o_la_materia_permanente
    # «Una carta permanente» (§10) è quel che resta in campo: l'Entità e la
    # Materia permanente. Non la Materia normale, non le carte altrui.
    engine = rhen([["n1", "NORMALE"], ["u1", "UMANO"]], foe_ritiro: [["bp", "PERMANENTE"]])
    refute riporta(engine, "n1")[:ok], "una Materia normale no"
    verdict = riporta(engine, "u1")
    assert verdict[:ok], "un'Entità sì: #{verdict[:reason]}"
    refute riporta(engine, "bp")[:ok], "dalla Zona di Ritiro avversaria no"
  end

  # §6.2, Fronte pieno: «anche la parte d'effetto che metterebbe in campo non
  # si applica» — per le Entità; una Materia permanente non occupa slot (§5).
  def test_a_fronte_pieno_l_entita_non_torna_la_materia_si
    engine = rhen([["u1", "UMANO"], ["p1", "PERMANENTE"]], campo: 5)
    verdict = riporta(engine, "u1")
    refute verdict[:ok]
    assert_match(/Fronte è pieno.*§6\.2/, verdict[:reason])
    assert_match(/Front is full.*§6\.2/, verdict[:reason_en])
    assert riporta(engine, "p1")[:ok], "la Materia permanente sta dietro il Fronte"
  end

  def test_il_ritorno_si_consuma_una_volta
    engine = rhen([["p1", "PERMANENTE"], ["p2", "PERMANENTE"]])
    assert riporta(engine, "p1")[:ok]
    refute riporta(engine, "p2")[:ok]
  end

  # --- §8.2: il Cercatore guarda le prime quattro (RBF-006) ----------------

  CERCATORI = {
    "CERCATORE" => { type: "entity", keywords: [], race: "human",
                     enter_looks: [{ count: 4, die: nil, count_base: 0, reveal: { type: "entity", race: "human" }, then_retire: false }] },
    "ARTEFICE" => { type: "entity", keywords: [], race: "auros",
                    enter_looks: [{ count: nil, die: 6, count_base: 2, reveal: { type: "object", race: nil }, then_retire: true }] },
    "FERRO" => { type: "object", keywords: [] },
    "UMANO" => { type: "entity", keywords: [], race: "human" },
    "AUROS" => { type: "entity", keywords: [], race: "auros" },
    "PIETRA" => { type: "matter", keywords: [], behavior: "normal" },
  }.freeze

  # A ha il Cercatore in mano e quel mazzo (dalla cima); poi il Cercatore scende.
  def cercatore(deck)
    engine = Rubyfront::Engine.new(cards: CERCATORI)
    cards = [{ "uid" => "cerc", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "CERCATORE" }]
    cards += deck.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "deck", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "toZone", "uid" => "cerc", "zone" => "field", "x" => 442, "y" => 1236 })
    engine
  end

  def guarda(engine, reveal: nil, count: 4, seat: "a")
    action = { "t" => "look", "seat" => seat, "count" => count,
               "effect" => { "source" => "cerc", "event" => "on_enter_field", "entering" => "cerc" } }
    action["reveal"] = reveal if reveal
    engine.judge(action)
  end

  def test_il_cercatore_mostra_un_umano_fra_le_prime_quattro
    engine = cercatore([["d1", "PIETRA"], ["d2", "UMANO"], ["d3", "AUROS"], ["d4", "PIETRA"], ["d5", "UMANO"]])
    verdict = guarda(engine, reveal: "d2")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    table = engine.instance_variable_get(:@table)
    assert_equal "hand", table.card("d2")[:zone]
    assert_equal %w[d5 d1 d3 d4], table.top_of_deck("a", 4)
  end

  def test_non_si_mostra_chi_non_e_fra_le_prime_o_non_e_umano
    engine = cercatore([["d1", "PIETRA"], ["d2", "AUROS"], ["d3", "PIETRA"], ["d4", "PIETRA"], ["d5", "UMANO"]])
    refute guarda(engine, reveal: "d5")[:ok], "la quinta non si vede"
    refute guarda(engine, reveal: "d2")[:ok], "un Auros non si mostra"
    refute guarda(engine, count: 2)[:ok], "si guardano quattro carte"
    assert guarda(engine)[:ok], "nessuna da mostrare: tutte in fondo"
    refute guarda(engine)[:ok], "e l'innesco è consumato"
  end

  # --- §8.2: il Radunatore prende il controllo (RBF-009) ---------------------

  RADUNI = {
    "RADUNATORE" => { type: "entity", keywords: [], race: "human",
                      enter_controls: [{ target: { type: "entity", controller: "opponent", max_cost: 3 }, grants: ["surge"] }] },
    "PICCOLA" => { type: "entity", keywords: [], race: "auros", flux_cost: 2 },
    "GRANDE" => { type: "entity", keywords: [], race: "auros", flux_cost: 5 },
    "PIETRA" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 1 },
  }.freeze

  # A ha il Radunatore in mano, B quelle carte in campo; poi il Radunatore scende.
  def radunatore(b_field)
    engine = Rubyfront::Engine.new(cards: RADUNI)
    a = [{ "uid" => "rad", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "RADUNATORE" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    b = b_field.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "b", "zone" => "field", "order" => i, "cardId" => id, "y" => 172 } }
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => b })
    engine.judge({ "t" => "toZone", "uid" => "rad", "zone" => "field", "x" => 442, "y" => 1236 })
    engine
  end

  def prendi(engine, uid, by: "a", grants: ["surge"])
    engine.judge({ "t" => "control", "uid" => uid, "by" => by, "grants" => grants,
                   "effect" => { "source" => "rad", "event" => "on_enter_field", "entering" => "rad" } })
  end

  def test_il_radunatore_prende_un_entita_economica
    engine = radunatore([["b1", "PICCOLA"]])
    verdict = prendi(engine, "b1")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    table = engine.instance_variable_get(:@table)
    assert_equal "a", table.controller_of(table.card("b1"))
  end

  def test_non_si_prende_chi_costa_troppo_ne_una_materia
    engine = radunatore([["b1", "GRANDE"], ["b2", "PIETRA"]])
    refute prendi(engine, "b1")[:ok], "costa 5"
    refute prendi(engine, "b2")[:ok], "una Materia no"
    refute prendi(engine, "b1", grants: [])[:ok], "le concessioni sono quelle della carta"
  end

  def test_la_controllata_attacca_per_chi_la_comanda_con_slancio
    engine = radunatore([["b1", "PICCOLA"]])
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
    engine = radunatore([["b1", "PICCOLA"]])
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

  def test_la_restituzione_solo_a_fine_turno_e_solo_di_una_controllata
    engine = radunatore([["b1", "PICCOLA"], ["b2", "PICCOLA"]])
    prendi(engine, "b1")
    refute engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "x" => 442, "y" => 172 }, actor: "a")[:ok], "non prima della fine del turno"
    refute engine.judge({ "t" => "release", "uid" => "b2", "zone" => "field" }, actor: "a")[:ok], "b2 non è controllata"
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" }, actor: "a")
    verdict = engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "x" => 442, "y" => 172 }, actor: "a")
    assert verdict[:ok], verdict[:reason]
    table = engine.instance_variable_get(:@table)
    assert_equal "b", table.controller_of(table.card("b1"))
  end

  # --- §8.2: l'Artefice tira il dado e guarda (RBF-027) ----------------------

  def artefice(deck)
    engine = Rubyfront::Engine.new(cards: CERCATORI)
    cards = [{ "uid" => "art", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "ARTEFICE" }]
    cards += deck.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "deck", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "toZone", "uid" => "art", "zone" => "field", "x" => 442, "y" => 1236 })
    engine
  end

  def tira_e_guarda(engine, roll:, count:, reveal: nil, retire: nil)
    action = { "t" => "look", "seat" => "a", "count" => count, "roll" => roll,
               "effect" => { "source" => "art", "event" => "on_enter_field", "entering" => "art" } }
    action["reveal"] = reveal if reveal
    action["retire"] = retire if retire
    engine.judge(action)
  end

  def test_l_artefice_guarda_due_piu_meta_del_tiro
    engine = artefice([["d1", "PIETRA"], ["d2", "FERRO"], ["d3", "PIETRA"], ["d4", "PIETRA"], ["d5", "PIETRA"], ["d6", "PIETRA"]])
    # tiro 3 → 2 + ceil(3/2) = 4 carte
    verdict = tira_e_guarda(engine, roll: 3, count: 4, reveal: "d2", retire: "d1")
    assert verdict[:ok], verdict[:reason]
    table = engine.instance_variable_get(:@table)
    assert_equal "hand", table.card("d2")[:zone]
    assert_equal "ritiro", table.card("d1")[:zone]
    assert_equal %w[d5 d6 d3 d4], table.top_of_deck("a", 4), "le altre in fondo"
  end

  def test_il_conto_segue_il_tiro_e_il_ritiro_e_obbligatorio
    engine = artefice([["d1", "PIETRA"], ["d2", "FERRO"], ["d3", "PIETRA"], ["d4", "PIETRA"], ["d5", "PIETRA"]])
    refute tira_e_guarda(engine, roll: 3, count: 5)[:ok], "con un 3 si guardano 4 carte"
    refute tira_e_guarda(engine, roll: 7, count: 6)[:ok], "un tiro fuori dal dado"
    refute tira_e_guarda(engine, roll: 1, count: 3, reveal: "d2")[:ok], "una delle altre va in Ritiro"
    refute tira_e_guarda(engine, roll: 1, count: 3, reveal: "d2", retire: "d5")[:ok], "la quinta non è fra le guardate"
    refute tira_e_guarda(engine, roll: 1, count: 3, reveal: "d1", retire: "d2")[:ok], "si mostra solo un Oggetto"
    assert tira_e_guarda(engine, roll: 1, count: 3, retire: "d1")[:ok], "nessun Oggetto mostrato, una in Ritiro"
  end

  # --- §8.2: «quando attacca», il secondo innesco di Rhen ------------------

  EREDI_ATTACCO = EREDI.merge(
    "RHEN" => EREDI["RHEN"].merge(attack_returns: EREDI["RHEN"][:enter_returns])
  ).freeze

  # Rhen in campo dal turno 1, una permanente in Zona di Ritiro; al turno 3
  # A apre il Fronte e Rhen attacca.
  def rhen_in_carica
    engine = Rubyfront::Engine.new(cards: EREDI_ATTACCO)
    cards = [{ "uid" => "rhen", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "RHEN", "y" => 1236 },
             { "uid" => "p1", "owner" => "a", "zone" => "ritiro", "order" => 0, "cardId" => "PERMANENTE" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    engine
  end

  def riporta_attaccando(engine)
    engine.judge({ "t" => "toZone", "uid" => "p1", "zone" => "field", "x" => 2368, "y" => 1236,
                   "effect" => { "source" => "rhen", "event" => "on_attack", "entering" => "rhen" } })
  end

  def test_quando_rhen_attacca_riporta_una_permanente
    engine = rhen_in_carica
    fronte!(engine)
    assert engine.judge(attacco("rhen"))[:ok]
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

  # --- §8.2: «quando attacca con un Oggetto, pesca, poi scarta» (RBF-026) --

  AVANSCOPERTA = {
    "ESPLORATORE" => { type: "entity", keywords: [], race: "auros",
                       attack_draws: [{ draw: 1, then_discard: 1, requires_object: true }] },
    "FERRO" => { type: "object", keywords: [] },
    "UMANO" => { type: "entity", keywords: [], race: "human" },
  }.freeze

  # L'Esploratore in campo dal turno 1, con (o senza) il Ferro addosso, una
  # carta in mano e una nel mazzo; al turno 3 A apre il Fronte e attacca.
  def esploratore(armato: true)
    engine = Rubyfront::Engine.new(cards: AVANSCOPERTA)
    cards = [{ "uid" => "esp", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "ESPLORATORE", "y" => 1236 },
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
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "abisso",
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
    assert_equal "abisso", engine.instance_variable_get(:@table).card("h1")[:zone]
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
                   "cards" => [{ "uid" => "esp", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "IGNOTA", "y" => 1236 }] })
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
    "SIGMA" => { type: "object", keywords: [],
                 attack_forms: [{ kind: "empower", who: "object", targets: "bearer", power: 1, face: 0 },
                                { kind: "look", count: 4, reveal: { type: "matter", race: nil }, reveal_to: "hand", rest_to: "ritiro", who: "object", die: 6, on_roll: [5, 6], face: 0 }] },
    "FURIERE" => { type: "entity", keywords: [], race: "auros", power: 5,
                   attack_forms: [{ kind: "rearm", who: "ally", attacker_armed: true, face: 0 },
                                  { kind: "look", count: 2, reveal: { type: "object", race: nil }, reveal_to: "ritiro", rest_to: "deck", who: "ally", attacker_armed: true, once: true, die: nil, face: 0 }] },
    "GUARITORE" => { type: "entity", keywords: [], race: "human", power: 2,
                     attack_forms: [{ kind: "heal", who: "self", amount: 2, die: 6, on_roll: [5, 6], then_recall: { type: "entity" }, face: 0 }] },
    "ECO" => { type: "entity", keywords: [], race: "human", power: 3,
               attack_forms: [{ kind: "return", who: "self", die: 6, on_roll: [5, 6], filter: { type: "entity", race: "human" }, joins: true, face: 0 }] },
    "CARICA" => { type: "entity", keywords: [], race: "human", power: 5, counterattack: 1,
                  attack_forms: [{ kind: "refresh", who: "self", die: 20, on_roll: [15, 20], face: 0 }] },
    "EREDI" => { type: "matter", keywords: [], behavior: "permanent",
                 attack_forms: [{ kind: "heal", who: "permanent", attackers: { type: "entity", race: "human" }, die: 20, gain_on: [1, 6], drain_on: [15, 20], amount: "human_attackers", face: 0 }] },
    "OBLIVHAL" => { type: "rubyfront", keywords: ["fury"],
                    attack_forms: [{ kind: "heal", who: "rubyfront", once: true, requires_attackers: { count: 3, race: "human" }, amount: 2, then_draw: 0, then_discard: 0, face: 0 },
                                   { kind: "heal", who: "rubyfront", once: true, requires_attackers: { count: 3, race: "human" }, amount: 2, then_draw: 1, then_discard: 1, face: 1 }] },
    "VENDICATORE" => { type: "entity", keywords: [], race: "human", power: 2,
                       attack_forms: [{ kind: "empower", who: "self", once: true, targets: "next_human_attacker", grants: ["revenge"], face: 0 }] },
    "RAZZIA" => { type: "entity", keywords: [], race: "human", power: 2, counterattack: 1,
                  attack_forms: [{ kind: "empower", who: "self", requires_previous_attackers: { count: 2, race: "human" }, targets: "opposing_entity", restrict: "block", face: 0 }] },
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
        { "uid" => uid, "owner" => seat, "zone" => "field", "order" => i, "cardId" => id, "y" => seat == "a" ? 1236 : 172 }.merge(extra || {})
      end
      engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    end
    load.call("a", a)
    load.call("b", b + [["rf-b", "OBLIVHAL", { "y" => 172 }]])
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

  # RBF-028 — «stappala dopo il combattimento».
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

  # RBF-029 — «le altre Entità con un Oggetto assegnato che controlli prendono +1».
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

  # RBF-034 — l'Oggetto che potenzia chi lo porta, poi lo sguardo col dado.
  def test_il_catalizzatore_potenzia_il_portatore_e_poi_guarda_col_dado
    engine = scena([["u", "UMANO"], ["s", "SIGMA", { "assignedTo" => "u" }], ["pescata", "UMANO", { "zone" => "deck" }], ["d1", "MATERIA", { "zone" => "deck" }], ["d2", "UMANO", { "zone" => "deck" }],
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
    engine = scena([["u", "UMANO"], ["n", "AUROS"], ["s", "SIGMA", { "assignedTo" => "n" }]], attacks: ["u"])
    assert_match(/addosso a chi attacca/, engine.judge({ "t" => "empower", "uid" => "u", "power" => 1, "effect" => ref("s", "u") })[:reason])
  end

  # RBF-031 — il Furiere: un Oggetto dal Ritiro a chi attacca armato, e lo sguardo una volta per turno.
  def test_il_furiere_riarma_chi_attacca_armato_e_guarda_una_volta
    engine = scena([["q", "FURIERE"], ["u", "UMANO"], ["f", "FERRO", { "assignedTo" => "u" }], ["f2", "FERRO", { "zone" => "ritiro" }],
                    ["n", "AUROS"], ["f3", "FERRO", { "assignedTo" => "n" }], ["pescata", "UMANO", { "zone" => "deck" }], ["d1", "FERRO", { "zone" => "deck" }], ["d2", "UMANO", { "zone" => "deck" }]],
                   attacks: %w[u n])
    riarmo = { "t" => "toZone", "uid" => "f2", "zone" => "field", "y" => 1236, "assignTo" => "u", "effect" => ref("q", "u") }
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
    verdict = engine.judge({ "t" => "toZone", "uid" => "f2", "zone" => "field", "y" => 1236, "assignTo" => "u", "effect" => ref("q", "u") })
    assert_match(/Entità con un Oggetto assegnato/, verdict[:reason])
  end

  # RBF-008 — +2 PV, poi col dado un'Entità dal Ritiro in mano.
  def test_il_guaritore_cura_e_col_dado_riporta_in_mano
    engine = scena([["g", "GUARITORE"], ["r", "UMANO", { "zone" => "ritiro" }]], attacks: ["g"])
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

  # RBF-010 — col dado un'Entità Umana dal Ritiro sul Fronte, che attacca insieme.
  def test_l_eco_riporta_un_umano_che_attacca_insieme
    engine = scena([["e", "ECO"], ["r", "UMANO", { "zone" => "ritiro" }], ["x", "AUROS", { "zone" => "ritiro" }]], attacks: ["e"])
    ritorno = { "t" => "toZone", "uid" => "r", "zone" => "field", "x" => 2368, "y" => 1236, "roll" => 5, "effect" => ref("e") }
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

  # RBF-011 — stappa tutte le proprie Entità; con 15–20 la Fase di Fronte addizionale.
  def test_la_carica_stappa_tutti_e_col_tiro_promette_il_fronte_addizionale
    engine = scena([["c", "CARICA"], ["u", "UMANO", { "tapped" => true }]], attacks: ["c"])
    assert_match(/solo con 15–20/, engine.judge({ "t" => "refresh", "seat" => "a", "roll" => 3, "extra" => true, "effect" => ref("c") })[:reason])
    verdict = engine.judge({ "t" => "refresh", "seat" => "a", "roll" => 17, "extra" => true, "effect" => ref("c") })
    assert verdict[:ok], verdict[:reason]
    tavolo = copia(engine)
    refute tavolo.card("u")[:tapped]
    refute tavolo.card("c")[:tapped]
    assert tavolo.extra_front
  end

  # RBF-022 — la Materia permanente: il d20 quando attaccano gli Umani.
  def test_gli_eredi_col_d20_curano_o_prosciugano
    engine = scena([["m", "EREDI"], ["u1", "UMANO"], ["u2", "UMANO"], ["n", "AUROS"]], attacks: %w[u1 u2 n])
    assert_match(/non succede nulla/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "roll" => 10, "effect" => ref("m", "u1") })[:reason])
    assert_match(/Entità Umane che controlli/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "roll" => 4, "effect" => ref("m", "n") })[:reason])
    cura = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "roll" => 4, "effect" => ref("m", "u1") })
    assert cura[:ok], cura[:reason]
    assert_match(/perde 2 PV/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 24 }, "roll" => 18, "effect" => ref("m", "u2") })[:reason])
    danno = engine.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => 18 }, "roll" => 18, "effect" => ref("m", "u2") })
    assert danno[:ok], danno[:reason]
    assert_equal 18, copia(engine).hp("b")
  end

  # RBF-001 — il raduno: al terzo Umano, +2 PV una volta per turno; il Nexus poi pesca e scarta.
  # Il Rubyfront è SCHIERATO (fila del Fronte, 1236): in Zona di Richiamo
  # (1756) non avrebbe abilità (§3.1, test più sotto).
  def test_il_raduno_al_terzo_umano_una_volta_per_turno
    engine = scena([["rf", "OBLIVHAL", { "y" => 1236 }], ["u1", "UMANO"], ["u2", "UMANO"], ["u3", "UMANO"]], attacks: %w[u1 u2])
    assert_match(/almeno 3 Entità Umane/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u2", once: true) })[:reason])
    engine.judge({ "t" => "declare", "declaration" => { "id" => "u3", "from" => "u3", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 3 } })
    verdict = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u3", once: true) })
    assert verdict[:ok], verdict[:reason]
    assert_match(/già stato risolto/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 24 }, "effect" => ref("rf", "u1", once: true) })[:reason])
    assert_match(/peschi dopo la cura/, engine.judge({ "t" => "draw", "seat" => "a", "count" => 1, "effect" => ref("rf", "u3", once: true, follow: "draw") })[:reason], "la faccia del Rubyfront non pesca")
  end

  def test_il_nexus_dopo_la_cura_pesca_e_scarta
    engine = scena([["rf", "OBLIVHAL", { "y" => 1236, "face" => 1 }], ["u1", "UMANO"], ["u2", "UMANO"], ["u3", "UMANO"],
                    ["h", "UMANO", { "zone" => "hand" }], ["d", "UMANO", { "zone" => "deck" }]], attacks: %w[u1 u2 u3])
    pesca = { "t" => "draw", "seat" => "a", "count" => 1, "effect" => ref("rf", "u3", once: true, follow: "draw") }
    assert_match(/prima i PV/, engine.judge(pesca)[:reason])
    assert engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u3", once: true) })[:ok]
    assert engine.judge(pesca)[:ok]
    assert_match(/già stato risolto/, engine.judge(pesca)[:reason])
    scarto = engine.judge({ "t" => "toZone", "uid" => "h", "zone" => "abisso", "effect" => ref("rf", "u3", once: true, follow: "discard") })
    assert scarto[:ok], scarto[:reason]
    assert_equal "abisso", copia(engine).card("h")[:zone]
  end

  # §3.1 — «abilità (principale e speciali) e Materie sono utilizzabili solo
  # quando è in campo: schierarlo serve a sbloccarle». In Zona di Richiamo
  # il Rubyfront si attacca, ma non innesca niente.
  def test_il_rubyfront_in_zona_di_richiamo_non_ha_abilita
    engine = scena([["rf", "OBLIVHAL", { "y" => 1756 }], ["u1", "UMANO"], ["u2", "UMANO"], ["u3", "UMANO"]], attacks: %w[u1 u2 u3])
    verdict = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u3", once: true) })
    refute verdict[:ok]
    assert_match(/Zona di Richiamo non ha abilità.*§3\.1/, verdict[:reason])
    assert_match(/Recall Zone has no abilities.*§3\.1/, verdict[:reason_en])
    # Schierato — la fila del Fronte — la stessa cura passa.
    engine.observe({ "t" => "move", "uid" => "rf", "x" => 30, "y" => 1236, "z" => 3, "cost" => 0 })
    assert_equal 1236, copia(engine).card("rf")[:row]
    verdict = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u3", once: true) })
    assert verdict[:ok], verdict[:reason]
  end

  def test_la_fila_ignota_del_rubyfront_non_accusa
    # Snapshot da una lavagna che non segnava la fila: nel dubbio è in gioco.
    engine = scena([["rf", "OBLIVHAL", { "y" => nil }], ["u1", "UMANO"], ["u2", "UMANO"], ["u3", "UMANO"]], attacks: %w[u1 u2 u3])
    assert_nil copia(engine).card("rf")[:row]
    verdict = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u3", once: true) })
    assert verdict[:ok], verdict[:reason]
  end

  # RBF-004 — la Vendetta al PROSSIMO Umano che attacca.
  def test_il_vendicatore_concede_vendetta_al_prossimo_umano
    engine = scena([["v", "VENDICATORE"], ["u1", "UMANO"], ["u2", "UMANO"], ["n", "AUROS"]], attacks: %w[v n u1 u2])
    assert_match(/PROSSIMA Entità Umana/, engine.judge({ "t" => "empower", "uid" => "u2", "grants" => ["revenge"], "effect" => ref("v", "v", once: true) })[:reason])
    assert_match(/PROSSIMA Entità Umana/, engine.judge({ "t" => "empower", "uid" => "n", "grants" => ["revenge"], "effect" => ref("v", "v", once: true) })[:reason])
    verdict = engine.judge({ "t" => "empower", "uid" => "u1", "grants" => ["revenge"], "effect" => ref("v", "v", once: true) })
    assert verdict[:ok], verdict[:reason]
    assert_equal ["revenge"], copia(engine).card("u1")[:grants]
  end

  # RBF-005 — se nel turno precedente hanno attaccato almeno 2 Umani, un'Entità avversaria non blocca.
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
  # --- Eredità Perduta: statici, Stasi, blocco multiplo, Materie, Nexus ----------
  #
  # Le forme come le legge l'anagrafe dalle carte vere (card_index_test);
  # qui la dogana, scenario per scenario, su un'anagrafe di prova.

  EREDITA = {
    "RAGAZZO" => { type: "entity", keywords: [], race: "human", power: 1, flux_cost: 1,
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
    "AUROS" => { type: "entity", keywords: [], race: "auros", power: 2, flux_cost: 2 },
    "GROSSO" => { type: "entity", keywords: [], race: "auros", power: 4, counterattack: nil, flux_cost: 4 },
    "SPINOSO" => { type: "entity", keywords: [], race: "human", power: 3, counterattack: 1, flux_cost: 3 },
    "RUBINO" => { type: "rubyfront", keywords: [] },
    "OBLIVHAL" => { type: "rubyfront", keywords: ["fury"], enables: [[], []],
                    nexus: { face: 1, conditions: [{ count: 4, type: "entity", race: "human" }], discard: { count: 1, type: "entity" }, recovery: 5 },
                    flip_forms: [{ kind: "move", card_id: "RHEN", from: "field", to: "abisso" }, { kind: "seal", card_id: "RHEN" }] },
    "RHEN" => { type: "entity", keywords: [], race: "human", power: 6, flux_cost: 6 },
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
  }.freeze

  # Un tavolo di Eredità Perduta: le carte di A e di B (con zona ed extra)
  # scese al turno 1, poi turno 3 di A in Preparazione, con 10 Flussi per
  # posto. `attacks` dichiara il Fronte e gli attacchi di A.
  def eredita(a, b: [], attacks: nil)
    engine = Rubyfront::Engine.new(cards: EREDITA)
    load = lambda do |seat, list|
      cards = list.map.with_index do |(uid, id, extra), i|
        { "uid" => uid, "owner" => seat, "zone" => "field", "order" => i, "cardId" => id, "y" => seat == "a" ? 1236 : 172 }.merge(extra || {})
      end
      engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    end
    load.call("a", a + [["rf-a", "RUBINO", { "y" => 1236 }]])
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

  # --- §8.2: gli statici di Potenza (RBF-002, RBF-010, RBF-013, RBF-014) ---

  def test_il_ragazzo_vale_2_in_attacco_solo_con_un_altro_umano
    solo = eredita([["r", "RAGAZZO"], ["x", "AUROS"]], attacks: ["r"])
    solo.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/non torna/, risolvi(solo, [esito("r", damage: 2)])[:reason])
    assert risolvi(solo, [esito("r", damage: 1)])[:ok]
    insieme = eredita([["r", "RAGAZZO"], ["u", "UMANO"]], attacks: ["r"])
    insieme.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/non torna/, risolvi(insieme, [esito("r", damage: 1)])[:reason])
    assert risolvi(insieme, [esito("r", damage: 2)])[:ok]
  end

  def test_il_ragazzo_in_difesa_resta_un_1
    engine = eredita([["u", "UMANO"], ["r", "RAGAZZO"]], b: [["g", "GROSSO"]])
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

  def test_la_potenza_non_scende_sotto_zero
    engine = eredita([["p", "PICCOLO"]], attacks: ["p"])
    engine.observe({ "t" => "empower", "uid" => "p", "power" => -3, "effect" => { "source" => "p", "event" => "on_attack", "entering" => "p" } })
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert risolvi(engine, [esito("p", damage: 0)])[:ok]
  end

  # --- §8.1: la Stasi (RBF-013) --------------------------------------------

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
    engine.observe({ "t" => "refresh", "seat" => "b", "roll" => 17, "extra" => false, "effect" => { "source" => "u", "event" => "on_attack", "entering" => "u" } })
    refute copia(engine).card("u")[:tapped], "un effetto la stappa"
  end

  def test_la_stasi_nel_contrattacco_sostituisce_la_copertura
    engine = eredita([["g", "GROSSO"]], b: [["s", "SPINOSO"], ["o", "SCUDO", { "assignedTo" => "s" }]], attacks: ["g"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    blocco(engine, "s", "g", "counter")
    # 3 + 1 (Scudo) + 1 (Contrattacco) = 5 > 4: l'attaccante muore, nessuna Stasi.
    assert risolvi(engine, [esito("g", blocker: "s", kind: "counter", attacker_dies: true)])[:ok]
  end

  # --- §8.2: il blocco multiplo (RBF-014) -------------------------------------

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
  def gioca_carta(engine, uid, cost:, actor: "a", x: 2368, y: 1236, extra: {})
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

  # --- §7.2/§8.2: le Materie di Eredità Perduta alla risoluzione -------------

  # RBF-015 — guarda le prime 4, un'Entità Umana in mano, le altre in fondo.
  def test_l_attrazione_guarda_quattro_e_mostra_un_umano
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

  # RBF-016 — stappa un'Entità Umana che controlli: +1 Potenza.
  def test_la_formazione_stappa_un_umano_e_lo_potenzia
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

  # RBF-017 — un'Entità avversaria con costo 2 o inferiore nella Zona di Ritiro.
  def test_l_impatto_manda_in_ritiro_solo_chi_costa_poco
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

  # RBF-018 — un permanente avversario nell'Abisso, finché questa carta resta in gioco.
  def test_il_campo_repulsivo_esilia_e_restituisce_quando_lascia_il_gioco
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

  # RBF-019 — il d20 a fasce.
  def test_la_forza_della_radura_segue_il_dado
    engine = eredita([["u", "UMANO"], ["m", "FORZA", { "zone" => "hand" }], ["h", "PICCOLO", { "zone" => "hand" }], ["g", "GROSSO", { "zone" => "hand" }], ["d", "AUROS", { "zone" => "deck" }]])
    assert gioca_carta(engine, "m", cost: 3)[:ok]
    accetta!(engine, "b")
    cura = { "t" => "player", "seat" => "a", "patch" => { "hp" => 24 }, "roll" => 3, "effect" => res_ref("m") }
    pesca = { "t" => "draw", "seat" => "a", "count" => 1, "roll" => 3, "effect" => res_ref("m") }
    scesa = { "t" => "toZone", "uid" => "h", "zone" => "field", "x" => 821, "y" => 1236, "roll" => 3, "effect" => res_ref("m") }
    assert_match(/non si pesca/, engine.judge(pesca)[:reason])
    assert_match(/nessuno scende/, engine.judge(scesa)[:reason])
    assert_match(/tiro valido/, engine.judge(cura.merge("roll" => 21))[:reason])
    assert engine.judge(cura)[:ok]
    assert_equal 24, copia(engine).hp("a")
    assert_match(/tira una volta/, engine.judge(pesca.merge("roll" => 15))[:reason], "il tiro è fissato dal primo passo")
    assert_match(/già stato risolto/, engine.judge(cura.merge("patch" => { "hp" => 28 }))[:reason])
  end

  def test_con_20_la_forza_fa_tutte_e_tre_le_cose
    engine = eredita([["u", "UMANO"], ["m", "FORZA", { "zone" => "hand" }], ["h", "PICCOLO", { "zone" => "hand" }], ["g", "GROSSO", { "zone" => "hand" }], ["d", "AUROS", { "zone" => "deck" }]])
    assert gioca_carta(engine, "m", cost: 3)[:ok]
    accetta!(engine, "b")
    assert engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 24 }, "roll" => 20, "effect" => res_ref("m") })[:ok]
    assert engine.judge({ "t" => "draw", "seat" => "a", "count" => 1, "roll" => 20, "effect" => res_ref("m") })[:ok]
    scesa = { "t" => "toZone", "uid" => "h", "zone" => "field", "x" => 821, "y" => 1236, "roll" => 20, "effect" => res_ref("m") }
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
    gioca_carta(engine, uid, cost: 2, actor: actor, y: actor == "a" ? 1236 : 172, extra: { "chain" => chain })
  end

  def test_una_reattiva_apre_sempre_la_catena
    engine = catena
    senza = in_catena(engine, "r1", actor: "a", chain: false)
    refute senza[:ok]
    assert_match(/apre sempre la catena.*§7\.2/, senza[:reason])
    assert_match(/always opens the response chain.*§7\.2/, senza[:reason_en])
    # Il segno su una carta che non è Reattiva: in Preparazione, dove l'Entità scenderebbe.
    preparazione = eredita([["e", "UMANO", { "zone" => "hand" }]])
    falsa = preparazione.judge({ "t" => "toZone", "uid" => "e", "zone" => "field", "x" => 442, "y" => 1236, "chain" => true }, actor: "a")
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

  # RBF-040 — giocata come blocco a un attaccante: l'attacco è bloccato; con 2 armati sul Fronte, +3 PV.
  def test_lo_scudo_riflesso_ferma_l_attaccante_e_cura_se_gli_armati_bastano
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

  # RBF-020 — in Reazione, senza bloccare: con 3 Umani, stappa gli Umani, Contrattacco +1.
  def test_il_contrattacco_coordinato_in_reazione_potenzia_gli_umani_senza_bloccare
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

  def test_il_contrattacco_coordinato_vuole_tre_umani
    engine = eredita([["g", "GROSSO"]], b: [["v1", "UMANO"], ["v2", "UMANO"], ["c", "COORDINATO", { "zone" => "hand" }]], attacks: %w[g])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert gioca_carta(engine, "c", cost: 4, actor: "b", y: 172)[:ok]
    accetta!(engine, "a")
    assert_match(/almeno 3 Entità Umane/, engine.judge({ "t" => "empower", "uid" => "v1", "counter" => 1, "untap" => true, "effect" => res_ref("c") }, actor: "b")[:reason])
  end

  # RBF-021 — distruggi un'Entità; contro una tappata costa 3 in meno.
  def test_il_giudizio_cremisi_sconta_contro_la_tappata_e_colpisce_lei
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

  def test_il_giudizio_cremisi_senza_bersaglio_dichiarato_costa_pieno_e_colpisce_chiunque
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

  # --- §3.1: il Nexus — il flip e «quando flippa» (RBF-001) ------------------

  def nexus_pronto(humans: 4, hand: [["h", "AUROS", { "zone" => "hand" }]], y: 1236)
    mine = (1..humans).map { |i| ["u#{i}", "UMANO"] } + [["rhen", "RHEN"], ["rf", "OBLIVHAL", { "y" => y }]] + hand + [["rhen2", "RHEN", { "zone" => "hand" }]]
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
    assert_equal "abisso", tavolo.card("h")[:zone]
    assert_match(/non si torna al Rubyfront/, flip(engine, face: 0)[:reason])
  end

  def test_il_flip_si_fa_in_preparazione_o_al_fronte_non_in_reazione
    engine = nexus_pronto
    fronte!(engine)
    engine.judge({ "t" => "declare", "declaration" => { "id" => "u1", "from" => "u1", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 } })
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/dalla Preparazione al Fronte/, flip(engine)[:reason])
  end

  def test_quando_flippa_rhen_va_nell_abisso_e_non_si_gioca_piu
    engine = nexus_pronto
    ref = { "source" => "rf", "event" => "on_flip", "entering" => "rf" }
    via = { "t" => "toZone", "uid" => "rhen", "zone" => "abisso", "effect" => ref }
    assert_match(/flippato questo turno/, engine.judge(via)[:reason])
    assert flip(engine)[:ok]
    assert_match(/dal proprio Fronte/, engine.judge(via.merge("uid" => "u1"))[:reason])
    verdict = engine.judge(via)
    assert verdict[:ok], verdict[:reason]
    assert_equal "abisso", copia(engine).card("rhen")[:zone]
    assert_match(/già stato risolto/, engine.judge(via)[:reason])
    sigillo = { "t" => "player", "seat" => "a", "patch" => { "sealed" => ["RHEN"] }, "effect" => ref }
    assert_match(/aggiunge RHEN/, engine.judge(sigillo.merge("patch" => { "sealed" => ["RHEN", "UMANO"] }))[:reason])
    assert engine.judge(sigillo)[:ok]
    assert copia(engine).sealed?("a", "RHEN")
    assert_match(/non si può più giocare/, engine.judge({ "t" => "toZone", "uid" => "rhen2", "zone" => "field", "x" => 442, "y" => 1236, "cost" => 6 })[:reason])
    # Il turno dopo il flip è passato: l'innesco non si riscalda.
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 5, "active" => "a" })
    assert_match(/flippato questo turno/, engine.judge(via.merge("uid" => "u2"))[:reason])
  end

  def test_un_rubyfront_senza_requisito_certificato_flippa_a_mano
    engine = eredita([["rf", "RUBINO", { "y" => 1236 }]])
    refute engine.judge({ "t" => "flip", "uid" => "rf", "face" => 1 })[:ruled]
  end

end
