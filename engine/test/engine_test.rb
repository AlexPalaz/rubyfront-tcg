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
                enter_returns: [{ from: "ritiro", filter: { type: "matter", behavior: "permanent" }, to: "field" }] },
    "PERMANENTE" => { type: "matter", keywords: [], behavior: "permanent" },
    "NORMALE" => { type: "matter", keywords: [], behavior: "normal" },
    "UMANO" => { type: "entity", keywords: [], race: "human" },
  }.freeze

  # A ha Rhen in mano e quelle carte in Zona di Ritiro; poi Rhen scende.
  def rhen(ritiro, foe_ritiro: [])
    engine = Rubyfront::Engine.new(cards: EREDI)
    a = [{ "uid" => "rhen", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "RHEN" }]
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

  def test_solo_una_permanente_e_solo_dalla_propria_zona_di_ritiro
    engine = rhen([["n1", "NORMALE"], ["u1", "UMANO"]], foe_ritiro: [["bp", "PERMANENTE"]])
    refute riporta(engine, "n1")[:ok], "una Materia normale no"
    refute riporta(engine, "u1")[:ok], "un'Entità no"
    refute riporta(engine, "bp")[:ok], "dalla Zona di Ritiro avversaria no"
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
end
