# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/engine"

# Il contratto dei verdetti e le regole collegate, una sezione per punto.
class EngineTest < Minitest::Test
  def setup
    @engine = Rubyfront::Engine.new
  end

  def test_hello_declares_version_and_rules
    hello = @engine.hello
    assert_equal "engine", hello[:t]
    assert_equal Rubyfront::Engine::VERSION, hello[:version]
    assert_includes hello[:rules], "§3.2 Flusso: limite 20"
  end

  def test_actions_without_rule_pass
    verdict = @engine.judge({ "t" => "draw", "seat" => "a", "count" => 1 })
    assert_equal "verdict", verdict[:t]
    assert_equal "draw", verdict[:action]
    assert verdict[:ok]
    refute verdict[:ruled]
  end

  def test_malformed_action_does_not_disturb
    verdict = @engine.judge(nil)
    assert verdict[:ok]
    refute verdict[:ruled]
    assert_nil verdict[:action]
  end

  # --- §3.2: il limite dei 20 Flussi -------------------------------------

  def test_flux_at_20_is_fine
    verdict = @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "flux" => 20 } })
    assert verdict[:ruled]
    assert verdict[:ok]
  end

  def test_flux_at_21_is_stopped
    verdict = @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "flux" => 21 } })
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/§3\.2/, verdict[:reason])
  end

  # --- Il motivo in due lingue: il tavolo è bilingue, l'engine pure.

  def test_every_stop_carries_reason_in_english_too
    verdict = @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "flux" => 21 } })
    refute verdict[:ok]
    assert_match(/Flusso/, verdict[:reason])
    assert_match(/Flux/, verdict[:reason_en])
    refute_equal verdict[:reason], verdict[:reason_en]
    # La targhetta del sigillo — il «(§x.y)» in coda — sta in entrambe.
    assert_match(/\(§3\.2\)/, verdict[:reason])
    assert_match(/\(§3\.2\)/, verdict[:reason_en])
  end

  def test_hello_carries_rules_in_english_too
    hello = @engine.hello
    assert_equal Rubyfront::Engine::RULES.size, hello[:rules_en].size
    hello[:rules].zip(hello[:rules_en]).each do |it, en|
      # Stesso § in testa, frase diversa.
      assert_equal it[/^§[\d.\/§]+/], en[/^§[\d.\/§]+/], "#{it} / #{en}"
      refute_equal it, en
    end
  end

  def test_interpolated_words_follow_language
    engine = Rubyfront::Engine.new
    engine.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => 0 } })
    engine.judge({ "t" => "gameOver", "winner" => "a", "reason" => "hp" })
    later = engine.judge({ "t" => "draw", "seat" => "a", "count" => 1 })
    refute later[:ok]
    assert_equal "la partita è finita: Nuova partita per ricominciare (§2)", later[:reason]
    assert_equal "the game is over: New game to start again (§2)", later[:reason_en]
  end

  def test_no_refusal_left_without_english
    origin = File.read(File.expand_path("../lib/rubyfront/engine.rb", __dir__))
    without = origin.lines.select { |line| line =~ /refuse\(/ && line !~ /def refuse/ }
                    .reject { |line| line.scan(/"(?:[^"\\]|\\.)*"/).size >= 2 || line =~ /reason_en/ }
    assert_empty without, "refuse senza la frase inglese:\n#{without.join}"
  end

  def test_spent_token_reaches_21
    spending = { "t" => "player", "seat" => "b", "patch" => { "token" => false, "flux" => 21 } }
    verdict = @engine.judge(spending)
    assert verdict[:ruled]
    assert verdict[:ok], "la spesa del Gettone è l'unico 21 legale"
  end

  def test_not_even_token_exceeds_21
    verdict = @engine.judge({ "t" => "player", "seat" => "b", "patch" => { "token" => false, "flux" => 22 } })
    refute verdict[:ok]
  end

  def test_bar_does_not_exceed_20
    verdict = @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "fluxMax" => 21 } })
    assert verdict[:ruled]
    refute verdict[:ok]
  end

  def test_patch_not_touching_counters_is_not_judged
    verdict = @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "name" => "Ale", "token" => true } })
    assert verdict[:ok]
    refute verdict[:ruled]
  end

  # --- §3.1/§3.2: contatori mai sotto zero -------------------------------

  def test_hp_do_not_go_below_zero
    verdict = @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => -1 } })
    refute verdict[:ok]
    assert_match(/§3\.1/, verdict[:reason])
    assert @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 0 } })[:ok], "0 esatto è legale"
  end

  def test_flux_does_not_go_below_zero
    refute @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "flux" => -1 } })[:ok]
    refute @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "fluxMax" => -2 } })[:ok]
    assert @engine.judge({ "t" => "player", "seat" => "a", "patch" => { "flux" => 0 } })[:ok]
  end

  # --- §6.5: mano massima 7 a fine turno ---------------------------------

  def load_and_draw(seat, count)
    cards = (1..count).map do |serial|
      { "uid" => "#{seat}-#{serial}", "owner" => seat, "zone" => "deck", "order" => serial }
    end
    @engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    @engine.judge({ "t" => "draw", "seat" => seat, "count" => count })
  end

  def end_turn(turn: 2, active: "b")
    { "t" => "turn", "turn" => turn, "active" => active }
  end

  def test_end_turn_with_eight_cards_is_stopped
    load_and_draw("a", 8)
    verdict = @engine.judge(end_turn)
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/8 carte/, verdict[:reason])
    assert_match(/§6\.5/, verdict[:reason])
  end

  def test_stopped_end_turn_keeps_active_seat
    load_and_draw("a", 8)
    @engine.judge(end_turn)
    # Rifiutata: la copia del tavolo non deve averla applicata — scartata una
    # carta, lo stesso fine turno ripassa.
    @engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "ritiro" })
    verdict = @engine.judge(end_turn)
    assert verdict[:ok], "con 7 in mano il turno si chiude"
  end

  def test_end_turn_with_seven_cards_passes
    load_and_draw("a", 7)
    verdict = @engine.judge(end_turn)
    assert verdict[:ruled]
    assert verdict[:ok]
  end

  def test_counter_patch_is_not_end_turn
    load_and_draw("a", 9)
    verdict = @engine.judge({ "t" => "turn", "turn" => 5, "active" => "a" })
    refute verdict[:ruled], "active invariato: non è una chiusura di turno"
  end

  def test_observe_applies_violations_too
    load_and_draw("b", 8)
    @engine.judge(end_turn(active: "b")) # tocca a B
    # B (l'avversario) chiude il turno con 8 carte: da osservatore il
    # verdetto boccia ma la copia segue — di là è già successo.
    verdict = @engine.observe(end_turn(turn: 3, active: "a"))
    refute verdict[:ok]
    next_turn = @engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    assert next_turn[:ruled], "il posto attivo è tornato ad A: il fine turno di A si giudica"
  end

  def test_snapshot_aligns_hand
    @engine.snapshot({
      "turn" => 3,
      "active" => "a",
      "cards" => (1..9).to_h { |n| ["a-#{n}", { "owner" => "a", "zone" => "hand", "order" => n }] },
    })
    verdict = @engine.judge(end_turn(turn: 4))
    refute verdict[:ok]
    assert_match(/9 carte/, verdict[:reason])
  end

  # --- §6.2: attesa di evocazione ----------------------------------------

  REGISTRY = {
    "SLOW" => { type: "entity", keywords: [] },
    "QUICK" => { type: "entity", keywords: ["surge"] },
    "STONE" => { type: "matter", keywords: [] },
    "RUBY" => { type: "rubyfront", keywords: ["fury"] },
    "IRON" => { type: "object", keywords: [] },
  }.freeze

  def with_cards
    Rubyfront::Engine.new(cards: REGISTRY)
  end

  # Le dichiarazioni vivono in Fase di Fronte (§6): i test che dichiarano
  # aprono la fase per la via pubblica, come farebbe il giocatore attivo.
  def front!(engine)
    engine.judge({ "t" => "phase", "phase" => "fronte" })
  end

  # Difesa apparecchiata (§6.3): tocca a B, Fronte dichiarato, e «b-9»
  # attacca — l'osservazione registra la freccia anche senza conoscere la
  # carta, come per un'azione avversaria arrivata dalla rete.
  def defense!(engine)
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    front!(engine)
    engine.observe(declare_action("b-9", "rf-a", "attack"))
    engine.judge({ "t" => "phase", "phase" => "reazione" })
  end

  def put_down(engine, uid, card_id)
    cards = [{ "uid" => uid, "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => card_id }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field" })
  end

  def attack_decl(uid)
    { "t" => "declare",
      "declaration" => { "id" => "x", "from" => uid, "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 } }
  end

  def test_just_entered_cannot_attack
    engine = with_cards
    put_down(engine, "a-1", "SLOW")
    front!(engine)
    verdict = engine.judge(attack_decl("a-1"))
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/§6\.2/, verdict[:reason])
  end

  def test_attacks_from_next_turn
    engine = with_cards
    put_down(engine, "a-1", "SLOW")
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    front!(engine)
    verdict = engine.judge(attack_decl("a-1"))
    assert verdict[:ruled]
    assert verdict[:ok]
  end

  def test_with_surge_attacks_at_once
    engine = with_cards
    put_down(engine, "a-1", "QUICK")
    front!(engine)
    verdict = engine.judge(attack_decl("a-1"))
    assert verdict[:ruled]
    assert verdict[:ok], "Slancio ignora l'attesa di evocazione (§8.1)"
  end

  def test_non_entity_skips_wait
    engine = with_cards
    put_down(engine, "a-1", "STONE")
    front!(engine)
    verdict = engine.judge(attack_decl("a-1"))
    # L'attesa non la giudica: la ferma prima la dogana del tipo (§6.3,
    # dichiarano solo le Entità).
    refute verdict[:ok]
    assert_match(/solo le Entità/, verdict[:reason])
  end

  def test_unknown_card_or_missing_index_wait_is_silent
    engine = with_cards
    put_down(engine, "a-1", "MYSTERY")
    front!(engine)
    assert engine.judge(attack_decl("a-1"))[:ok], "carta fuori anagrafe: l'attesa non accusa"

    silent = Rubyfront::Engine.new
    put_down(silent, "a-1", "SLOW")
    front!(silent)
    assert silent.judge(attack_decl("a-1"))[:ok], "senza anagrafe: l'attesa non accusa"
  end

  def test_after_snapshot_does_not_accuse
    engine = with_cards
    engine.snapshot({
      "turn" => 5, "active" => "a",
      "cards" => { "a-1" => { "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "SLOW" } },
    })
    front!(engine)
    verdict = engine.judge(attack_decl("a-1"))
    assert verdict[:ok], "lo snapshot non dice quando la carta è scesa: nel dubbio, via libera"
  end

  def test_block_is_not_subject_to_wait
    engine = with_cards
    put_down(engine, "a-1", "SLOW")
    defense!(engine)
    assert engine.judge(declare_action("a-1", "b-9", "block"))[:ok], "§6.2: appena scesa può già bloccare nel turno avversario"
  end

  # --- §6.3: tappate, coperte, sfide 1 contro 1 --------------------------

  def declare_action(from, to, kind)
    { "t" => "declare",
      "declaration" => { "id" => "x", "from" => from, "to" => to, "kind" => kind, "seat" => "a", "order" => 0 } }
  end

  def test_tapped_cannot_attack
    engine = with_cards
    put_down(engine, "a-1", "QUICK")
    front!(engine)
    engine.judge({ "t" => "tap", "uid" => "a-1", "tapped" => true })
    verdict = engine.judge(attack_decl("a-1"))
    refute verdict[:ok]
    assert_match(/tappata.*attaccare/, verdict[:reason])
  end

  def test_tapped_cannot_block
    engine = with_cards
    put_down(engine, "a-1", "SLOW")
    defense!(engine)
    engine.judge({ "t" => "tap", "uid" => "a-1", "tapped" => true })
    verdict = engine.judge(declare_action("a-1", "b-9", "block"))
    refute verdict[:ok]
    assert_match(/tappata.*bloccare/, verdict[:reason])
  end

  def test_covered_card_does_nothing
    engine = with_cards
    put_down(engine, "a-1", "QUICK")
    front!(engine)
    engine.judge({ "t" => "facedown", "uid" => "a-1", "facedown" => true })
    refute engine.judge(attack_decl("a-1"))[:ok]
    refute engine.judge(declare_action("a-1", "b-9", "counter"))[:ok]
  end

  # Due bloccanti al posto A, già calati sul campo per la via pubblica:
  # un solo loadDeck (il secondo azzererebbe il posto), poi due toZone.
  def two_blockers(engine)
    cards = [
      { "uid" => "a-1", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "SLOW" },
      { "uid" => "a-2", "owner" => "a", "zone" => "hand", "order" => 1, "cardId" => "SLOW" },
    ]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "field" })
    engine.judge({ "t" => "toZone", "uid" => "a-2", "zone" => "field" })
  end

  def test_attacker_has_single_blocker
    engine = with_cards
    two_blockers(engine)
    defense!(engine)
    assert engine.judge(declare_action("a-1", "b-9", "block"))[:ok]
    verdict = engine.judge(declare_action("a-2", "b-9", "counter"))
    refute verdict[:ok]
    assert_match(/1 contro 1/, verdict[:reason])
  end

  def test_block_undone_frees_attacker
    engine = with_cards
    two_blockers(engine)
    defense!(engine)
    engine.judge(declare_action("a-1", "b-9", "block"))
    engine.judge({ "t" => "undeclare", "from" => "a-1" })
    assert engine.judge(declare_action("a-2", "b-9", "block"))[:ok]
  end

  def test_blocker_leaving_field_frees_attacker
    engine = with_cards
    two_blockers(engine)
    defense!(engine)
    engine.judge(declare_action("a-1", "b-9", "block"))
    # Muore (la risoluzione la applica da sé): nell'Abisso a mano non si va (§5).
    engine.observe({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
    assert engine.judge(declare_action("a-2", "b-9", "block"))[:ok]
  end

  def test_after_combat_cleared_play_restarts
    engine = with_cards
    two_blockers(engine)
    defense!(engine)
    engine.judge(declare_action("a-1", "b-9", "block"))
    engine.judge({ "t" => "clearCombat" })
    # Sgomberato tutto, anche l'attacco: un blocco vuole un'ondata nuova.
    refute engine.judge(declare_action("a-2", "b-9", "block"))[:ok]
    engine.observe(declare_action("b-9", "rf-a", "attack"))
    assert engine.judge(declare_action("a-2", "b-9", "block"))[:ok]
  end

  # --- §6.2: Fronte pieno (massimo 5 Entità) -----------------------------

  # Una mano piena di carte al posto voluto, poi le prime `cala` sul campo.
  def hand_and_field(engine, ids, drop:, seat: "a")
    cards = ids.each_with_index.map do |card_id, index|
      { "uid" => "#{seat}-#{index + 1}", "owner" => seat, "zone" => "hand", "order" => index, "cardId" => card_id }
    end
    engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    (1..drop).each { |n| engine.judge({ "t" => "toZone", "uid" => "#{seat}-#{n}", "zone" => "field" }) }
  end

  def test_sixth_entity_does_not_enter
    engine = with_cards
    hand_and_field(engine, ["SLOW"] * 6, drop: 5)
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-6", "zone" => "field" })
    refute verdict[:ok]
    assert_match(/Fronte è pieno/, verdict[:reason])
    # Rifiutata: la copia non l'ha applicata — riprovare rifiuta ancora
    # (se fosse scesa, il secondo tentativo sarebbe uno spostamento non giudicato).
    refute engine.judge({ "t" => "toZone", "uid" => "a-6", "zone" => "field" })[:ok]
  end

  def test_matters_and_rubyfront_take_no_slot
    engine = with_cards
    hand_and_field(engine, ["SLOW"] * 5 + ["STONE", "RUBY"], drop: 5)
    assert engine.judge({ "t" => "toZone", "uid" => "a-6", "zone" => "field" })[:ok], "la Materia scende anche a Fronte pieno"
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-7", "zone" => "field" })
    refute verdict[:ruled], "il Rubyfront non è un'Entità: nessun giudizio"
  end

  def test_field_move_is_not_entry
    engine = with_cards
    hand_and_field(engine, ["SLOW"] * 5, drop: 5)
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "field" })
    refute verdict[:ruled], "riposare una carta già in campo non conta"
  end

  def test_opponent_front_is_another_front
    engine = with_cards
    hand_and_field(engine, ["SLOW"] * 5, drop: 5)
    hand_and_field(engine, ["SLOW"], drop: 0, seat: "b")
    assert engine.judge({ "t" => "toZone", "uid" => "b-1", "zone" => "field" })[:ok], "i 5 slot sono per giocatore"
  end

  def test_freed_slot_reopens_front
    engine = with_cards
    hand_and_field(engine, ["SLOW"] * 6, drop: 5)
    # Muore (la risoluzione la applica da sé): nell'Abisso a mano non si va (§5).
    engine.observe({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
    assert engine.judge({ "t" => "toZone", "uid" => "a-6", "zone" => "field" })[:ok]
  end

  def test_unknown_card_front_is_silent
    engine = with_cards
    hand_and_field(engine, ["SLOW"] * 5 + ["MYSTERY"], drop: 5)
    refute engine.judge({ "t" => "toZone", "uid" => "a-6", "zone" => "field" })[:ruled]
  end

  # --- §3.1: l'assegnazione degli Oggetti --------------------------------

  # Un tavolo apparecchiato: a-1 Entità, a-2 Oggetto, a-3 Materia, a-4
  # seconda Entità (tutti di A, in campo), b-1 Entità di B in campo.
  def table_with_item(engine)
    hand_and_field(engine, %w[SLOW IRON STONE SLOW RUBY], drop: 5)
    hand_and_field(engine, %w[SLOW], drop: 1, seat: "b")
  end

  def assign_action(object, to)
    { "t" => "assign", "uid" => object, "to" => to }
  end

  def test_item_is_assigned_to_own_entity
    engine = with_cards
    table_with_item(engine)
    verdict = engine.judge(assign_action("a-2", "a-1"))
    assert verdict[:ruled]
    assert verdict[:ok]
  end

  def test_not_to_rubyfront_or_matter
    engine = with_cards
    table_with_item(engine)
    refute engine.judge(assign_action("a-2", "a-5"))[:ok], "a-5 è il Rubyfront"
    refute engine.judge(assign_action("a-2", "a-3"))[:ok], "a-3 è una Materia"
  end

  def test_not_to_opposing_entity
    engine = with_cards
    table_with_item(engine)
    verdict = engine.judge(assign_action("a-2", "b-1"))
    refute verdict[:ok]
    assert_match(/proprie Entità/, verdict[:reason])
  end

  def test_non_a_una_coperta
    engine = with_cards
    table_with_item(engine)
    engine.judge({ "t" => "facedown", "uid" => "a-1", "facedown" => true })
    refute engine.judge(assign_action("a-2", "a-1"))[:ok]
  end

  def test_once_assigned_it_does_not_move
    engine = with_cards
    table_with_item(engine)
    engine.judge(assign_action("a-2", "a-1"))
    verdict = engine.judge(assign_action("a-2", "a-4"))
    refute verdict[:ok]
    assert_match(/non si sposta/, verdict[:reason])
    assert engine.judge(assign_action("a-2", "a-1"))[:ok], "ribadire la stessa assegnazione non è uno spostamento"
  end

  def test_leaving_entity_releases_item
    engine = with_cards
    table_with_item(engine)
    engine.judge(assign_action("a-2", "a-1"))
    # Muore (la risoluzione la applica da sé): nell'Abisso a mano non si va (§5).
    engine.observe({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
    assert engine.judge(assign_action("a-2", "a-4"))[:ok], "sciolto: si può riassegnare"
  end

  def test_release_and_unknown_cards_not_judged
    engine = with_cards
    table_with_item(engine)
    engine.judge(assign_action("a-2", "a-1"))
    refute engine.judge({ "t" => "assign", "uid" => "a-2", "to" => nil })[:ruled]
    hand_and_field(engine, %w[MYSTERY SLOW], drop: 2, seat: "b")
    refute engine.judge(assign_action("b-1", "b-2"))[:ruled], "Oggetto ignoto all'anagrafe: silenzio"
  end

  # --- §6: le fasi del turno ---------------------------------------------

  def test_no_declaring_in_preparation
    engine = with_cards
    put_down(engine, "a-1", "QUICK")
    verdict = engine.judge(attack_decl("a-1"))
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/Fase di Fronte/, verdict[:reason])
  end

  def test_gate_applies_to_blocks_too
    engine = with_cards
    two_blockers(engine)
    refute engine.judge(declare_action("a-1", "b-9", "block"))[:ok]
    refute engine.judge(declare_action("a-2", "b-9", "counter"))[:ok]
  end

  def test_phase_does_not_go_back
    engine = with_cards
    front!(engine)
    verdict = engine.judge({ "t" => "phase", "phase" => "preparazione" })
    refute verdict[:ok]
    assert_match(/senso unico/, verdict[:reason])
  end

  def test_turn_change_returns_to_preparation
    engine = with_cards
    put_down(engine, "a-1", "QUICK")
    front!(engine)
    assert engine.judge(attack_decl("a-1"))[:ok]
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    refute engine.judge(attack_decl("a-1"))[:ok], "turno nuovo: si riparte dalla Preparazione"
  end

  def test_counter_patch_does_not_touch_phase
    engine = with_cards
    put_down(engine, "a-1", "QUICK")
    front!(engine)
    engine.judge({ "t" => "turn", "turn" => 9, "active" => "a" })
    assert engine.judge(attack_decl("a-1"))[:ok], "active invariato: la fase resta Fronte"
  end

  def test_snapshot_carries_phase
    field_setup = { "a-1" => { "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "QUICK" } }
    engine = with_cards
    engine.snapshot({ "turn" => 3, "active" => "a", "phase" => "fronte", "cards" => field_setup })
    assert engine.judge(attack_decl("a-1"))[:ok]
    engine.snapshot({ "turn" => 3, "active" => "a", "cards" => field_setup })
    refute engine.judge(attack_decl("a-1"))[:ok], "senza fase nello snapshot si riparte dalla Preparazione"
  end

  def test_unknown_phase_no_rule
    refute @engine.judge({ "t" => "phase", "phase" => "boh" })[:ruled]
  end

  # --- §6.2: il Ritiro -----------------------------------------------------

  def retire_action(uid)
    { "t" => "toZone", "uid" => uid, "zone" => "ritiro" }
  end

  # L'Entità è in campo dal turno scorso: il turno gira e torna ad A.
  def turn_round(engine)
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
  end

  def test_entity_retires_in_preparation
    engine = with_cards
    put_down(engine, "a-1", "SLOW")
    turn_round(engine)
    verdict = engine.judge(retire_action("a-1"))
    assert verdict[:ruled]
    assert verdict[:ok]
  end

  # §6.2 pone le sue condizioni al Ritiro, ma il gesto resta LIBERO
  # (decisione del designer, 2026-09-04): è anche l'attrezzo con cui si
  # risolve a mano ciò che l'engine non legge. È il ritorno a essere chiuso.
  def test_retire_is_free
    # Un tavolo per condizione: il giudizio APPLICA, e la carta ritirata non
    # è più in campo per la prova dopo.
    field_setup = lambda do |card_id, &setup_step|
      engine = with_cards
      put_down(engine, "a-1", card_id)
      turn_round(engine) unless card_id == "QUICK"
      setup_step&.call(engine)
      engine
    end
    assert field_setup.call("QUICK").judge(retire_action("a-1"))[:ok], "anche nel turno d'ingresso"
    tapped_card = field_setup.call("SLOW") { |e| e.judge({ "t" => "tap", "uid" => "a-1", "tapped" => true }) }
    assert tapped_card.judge(retire_action("a-1"))[:ok], "anche tappata"
    covered = field_setup.call("SLOW") { |e| e.judge({ "t" => "facedown", "uid" => "a-1", "facedown" => true }) }
    assert covered.judge(retire_action("a-1"))[:ok], "anche coperta"
  end

  # §6.2 — «il ritiro è un'azione di preparazione del Fronte»: è il solo
  # vincolo rimasto, e vale anche in Reazione.
  def test_with_front_declared_no_retire
    engine = with_cards
    put_down(engine, "a-1", "SLOW")
    turn_round(engine)
    front!(engine)
    verdict = engine.judge(retire_action("a-1"))
    refute verdict[:ok]
    assert_match(/gesto di Preparazione.*§6\.2/, verdict[:reason])
    assert_match(/Preparation move.*§6\.2/, verdict[:reason_en])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    refute engine.judge(retire_action("a-1"))[:ok], "e nemmeno in Reazione"
  end

  def test_opposing_entity_retires_in_any_phase
    # Non è un ritiro: è un effetto risolto a mano. Silenzio, in ogni fase.
    engine = with_cards
    hand_and_field(engine, %w[SLOW], drop: 1, seat: "b")
    front!(engine)
    refute engine.judge(retire_action("b-1"))[:ruled]
  end

  def test_retire_zone_left_only_by_effect
    engine = with_cards
    cards = [{ "uid" => "a-1", "owner" => "a", "zone" => "ritiro", "order" => 0, "cardId" => "SLOW" }]
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

  def test_retire_zone_not_from_deck
    engine = with_cards
    cards = [{ "uid" => "a-2", "owner" => "a", "zone" => "deck", "order" => 0, "cardId" => "SLOW" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-2", "zone" => "ritiro" })
    refute verdict[:ok]
    assert_match(/dal Fronte, col Ritiro, o scartando dalla mano.*§6\.2, §6\.5/, verdict[:reason])
    assert_match(/from the Front, by retiring, or by discarding from hand.*§6\.2, §6\.5/, verdict[:reason_en])
  end

  def test_rubyfront_does_not_retire
    engine = with_cards
    put_down(engine, "a-1", "RUBY")
    turn_round(engine)
    verdict = engine.judge(retire_action("a-1"))
    refute verdict[:ok]
    assert_match(/resta in campo/, verdict[:reason])
  end

  def test_matters_and_unknown_cards_retire
    engine = with_cards
    put_down(engine, "a-1", "STONE")
    turn_round(engine)
    assert engine.judge(retire_action("a-1"))[:ok]
    put_down(engine, "a-1", "MYSTERY")
    turn_round(engine)
    assert engine.judge(retire_action("a-1"))[:ok]
  end


  # §6.2 — «un Oggetto non si ritira da solo» (deciso 2026-09-11): a mano
  # è fermato; segue la sua Entità quando è lei a ritirarsi.
  def test_item_does_not_retire_alone_but_follows_entity
    engine = with_cards
    table_with_item(engine)
    assert engine.judge(assign_action("a-2", "a-1"))[:ok]
    verdict = engine.judge(retire_action("a-2"))
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/non si ritira da solo/, verdict[:reason])
    assert_equal "field", table_copy(engine).card("a-2")[:zone]
    assert engine.judge(retire_action("a-1"))[:ok], "l'Entità si ritira"
    assert_equal "ritiro", table_copy(engine).card("a-1")[:zone]
    assert_equal "ritiro", table_copy(engine).card("a-2")[:zone], "l'Oggetto la segue nella stessa azione"
  end

  def test_hand_to_retire_only_for_excess
    # Dal 2026-09-10: dalla mano in Zona di Ritiro si va scartando per eccesso (§6.5), non a mano.
    engine = with_cards
    hand_and_field(engine, %w[SLOW], drop: 0)
    verdict = engine.judge(retire_action("a-1"))
    refute verdict[:ok]
    assert_match(/solo per eccesso/, verdict[:reason])
  end

  def test_after_snapshot_retire_does_not_accuse
    engine = with_cards
    engine.snapshot({
      "turn" => 5, "active" => "a",
      "cards" => { "a-1" => { "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "SLOW" } },
    })
    assert engine.judge(retire_action("a-1"))[:ok], "lo snapshot non dice quando è scesa: nel dubbio, via libera"
  end

  # --- §5: le Materie mai sugli slot del Fronte ---------------------------

  def play(uid, x, y)
    { "t" => "toZone", "uid" => uid, "zone" => "field", "x" => x, "y" => y }
  end

  def test_matter_on_front_slot_is_stopped
    engine = with_cards
    hand_and_field(engine, %w[STONE], drop: 0)
    verdict = engine.judge(play("a-1", 442, 1260))
    refute verdict[:ok]
    assert_match(/spazio delle Materie/, verdict[:reason])
  end

  def test_ban_covers_both_front_rows
    engine = with_cards
    hand_and_field(engine, %w[STONE], drop: 0, seat: "b")
    refute engine.judge(play("b-1", 1956, 172))[:ok]
  end

  def test_matter_off_slots_enters_without_rule
    engine = with_cards
    hand_and_field(engine, %w[STONE], drop: 0)
    refute engine.judge(play("a-1", 2368, 1260))[:ruled], "la fila delle Materie non è affare dell'engine"
    hand_and_field(engine, %w[STONE], drop: 0)
    refute engine.judge(play("a-1", 500, 900))[:ruled], "rilascio a mano libera: lavagna libera"
  end

  def test_entity_on_slot_enters_normally
    engine = with_cards
    hand_and_field(engine, %w[SLOW], drop: 0)
    assert engine.judge(play("a-1", 442, 1260))[:ok]
  end

  def test_unknown_card_on_slot_silence
    engine = with_cards
    hand_and_field(engine, %w[MYSTERY], drop: 0)
    refute engine.judge(play("a-1", 442, 1260))[:ruled]
  end

  # --- §6.3: dichiarano solo le Entità ------------------------------------

  def test_rubyfront_does_not_attack
    engine = with_cards
    put_down(engine, "a-1", "RUBY")
    front!(engine)
    verdict = engine.judge(attack_decl("a-1"))
    refute verdict[:ok]
    assert_match(/Rubyfront non attacca/, verdict[:reason])
  end

  def test_rubyfront_does_not_block
    engine = with_cards
    put_down(engine, "a-1", "RUBY")
    front!(engine)
    refute engine.judge(declare_action("a-1", "b-9", "block"))[:ok]
    refute engine.judge(declare_action("a-1", "b-9", "counter"))[:ok]
  end

  def test_items_do_not_declare
    engine = with_cards
    put_down(engine, "a-1", "IRON")
    defense!(engine)
    verdict = engine.judge(declare_action("a-1", "b-9", "block"))
    refute verdict[:ok]
    assert_match(/solo le Entità/, verdict[:reason])
  end

  def test_type_is_judged_before_state
    engine = with_cards
    put_down(engine, "a-1", "RUBY")
    front!(engine)
    engine.judge({ "t" => "tap", "uid" => "a-1", "tapped" => true })
    # Un Rubyfront tappato non è «una tappata»: il rifiuto parla di lui.
    assert_match(/Rubyfront/, engine.judge(attack_decl("a-1"))[:reason])
  end

  def test_unknown_card_declares_without_type_gate
    silent = Rubyfront::Engine.new
    put_down(silent, "a-1", "RUBY")
    front!(silent)
    assert silent.judge(attack_decl("a-1"))[:ok], "senza anagrafe il tipo non si vede: via libera"
  end

  # --- §6.3: attacca chi è di turno, blocca chi difende --------------------

  def test_no_attack_in_opponent_turn
    engine = with_cards
    put_down(engine, "a-1", "QUICK")
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    front!(engine)
    verdict = engine.judge(attack_decl("a-1"))
    refute verdict[:ok]
    assert_match(/proprio turno/, verdict[:reason])
  end

  def test_active_seat_does_not_block
    engine = with_cards
    put_down(engine, "a-1", "QUICK")
    front!(engine)
    engine.observe(attack_decl("a-1"))
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    verdict = engine.judge(declare_action("a-1", "b-9", "block"))
    refute verdict[:ok]
    assert_match(/chi difende/, verdict[:reason])
    refute engine.judge(declare_action("a-1", "b-9", "counter"))[:ok]
  end

  def test_block_needs_real_attacker
    engine = with_cards
    put_down(engine, "a-1", "QUICK")
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    front!(engine)
    engine.observe(declare_action("b-8", "rf-a", "attack"))
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    # Nessun attacco dichiarato da b-9: la freccia non avrebbe senso.
    verdict = engine.judge(declare_action("a-1", "b-9", "block"))
    refute verdict[:ok]
    assert_match(/non sta attaccando/, verdict[:reason])
  end

  def test_regular_defense_passes
    engine = with_cards
    put_down(engine, "a-1", "QUICK")
    defense!(engine)
    assert engine.judge(declare_action("a-1", "b-9", "counter"))[:ok]
  end

  # --- §6.4: la Reazione — l'ondata passa al difensore ---------------------

  def test_no_new_attacks_in_reaction
    engine = with_cards
    put_down(engine, "a-1", "QUICK")
    front!(engine)
    assert engine.judge(attack_decl("a-1"))[:ok]
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    verdict = engine.judge(attack_decl("a-1"))
    refute verdict[:ok]
    assert_match(/niente nuovi attacchi/, verdict[:reason])
  end

  def test_blocks_wait_for_reaction
    engine = with_cards
    put_down(engine, "a-1", "SLOW")
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    front!(engine)
    engine.observe(declare_action("b-9", "rf-a", "attack"))
    # Ondata in corso, parola non ancora passata: il blocco aspetta.
    verdict = engine.judge(declare_action("a-1", "b-9", "block"))
    refute verdict[:ok]
    assert_match(/ondata completa/, verdict[:reason])
  end

  def test_turn_does_not_close_over_wave
    engine = with_cards
    put_down(engine, "a-1", "QUICK")
    front!(engine)
    engine.judge(attack_decl("a-1"))
    verdict = engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    refute verdict[:ok]
    assert_match(/passa al difensore/, verdict[:reason])
    # Passata la parola, il turno si chiude: quanto aspettare la difesa è
    # affare del tavolo (via semplice, niente stretta di mano).
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })[:ok]
  end

  def test_without_wave_front_closes_freely
    engine = with_cards
    put_down(engine, "a-1", "QUICK")
    front!(engine)
    assert engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })[:ok], "il passo non trattiene il turno"
  end

  def test_reaction_opens_only_from_front
    engine = with_cards
    verdict = engine.judge({ "t" => "phase", "phase" => "reazione" })
    refute verdict[:ok]
    assert_match(/si apre dal Fronte/, verdict[:reason])
    front!(engine)
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    refute engine.judge({ "t" => "phase", "phase" => "fronte" })[:ok], "dalla Reazione non si torna al Fronte"
  end

  # --- §6.3/§6.4: la risoluzione delle battaglie ---------------------------

  POWERS = {
    "STRONG" => { type: "entity", keywords: [], power: 4, counterattack: nil },
    "WEAK" => { type: "entity", keywords: [], power: 2, counterattack: nil },
    "EVEN" => { type: "entity", keywords: [], power: 4, counterattack: nil },
    "THORNY" => { type: "entity", keywords: [], power: 3, counterattack: 2 },
    "RUBY" => { type: "rubyfront", keywords: [], power: nil, counterattack: nil },
  }.freeze

  # Un tavolo apparecchiato per l'ondata: le carte di A e di B già in campo
  # (scese al turno 1, così al turno 3 l'attesa di evocazione è passata),
  # tocca ad A in Reazione. `attacks` e `blocks` sono [uid, ...] e
  # [[bloccante, attaccante, kind], ...].
  def wave(a_cards, b_cards, attacks, blocks)
    engine = Rubyfront::Engine.new(cards: POWERS)
    load = lambda do |seat, cards|
      list = cards.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => seat, "zone" => "field", "order" => i, "cardId" => id } }
      engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => list })
    end
    load.call("a", a_cards)
    load.call("b", b_cards)
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    front!(engine)
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

  def battle_entry(attacker, blocker: nil, kind: "unblocked", attacker_dies: false, blocker_dies: false, damage: 0)
    { "attacker" => attacker, "blocker" => blocker, "kind" => kind,
      "attackerDies" => attacker_dies, "blockerDies" => blocker_dies, "damage" => damage }.compact
  end

  def resolve_with(engine, battles, seat: "a")
    engine.judge({ "t" => "resolve", "seat" => seat, "battles" => battles })
  end

  def test_unblocked_deals_damage_equal_to_power
    engine = wave([["a1", "STRONG"]], [], ["a1"], [])
    verdict = resolve_with(engine, [battle_entry("a1", damage: 4)])
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
  end

  def test_weaker_blocker_dies_and_attack_is_blocked
    engine = wave([["a1", "STRONG"]], [["b1", "WEAK"]], ["a1"], [["b1", "a1", "block"]])
    verdict = resolve_with(engine, [battle_entry("a1", blocker: "b1", kind: "block", blocker_dies: true)])
    assert verdict[:ok], verdict[:reason]
    assert_equal "abisso", engine.instance_variable_get(:@table).card("b1")[:zone], "col sì la copia applica"
  end

  def test_equal_powers_both_die
    engine = wave([["a1", "STRONG"]], [["b1", "EVEN"]], ["a1"], [["b1", "a1", "block"]])
    verdict = resolve_with(engine, [battle_entry("a1", blocker: "b1", kind: "block", attacker_dies: true, blocker_dies: true)])
    assert verdict[:ok], verdict[:reason]
  end

  # Dal 2026-09-11 (§6.3): «il bloccante più forte uccide l'attaccante» —
  # l'esito di prima (nessun morto) non passa più.
  def test_stronger_blocker_kills_attacker
    engine = wave([["a1", "WEAK"]], [["b1", "STRONG"]], ["a1"], [["b1", "a1", "block"]])
    refute resolve_with(engine, [battle_entry("a1", blocker: "b1", kind: "block")])[:ok], "senza morti non torna più"
    verdict = resolve_with(engine, [battle_entry("a1", blocker: "b1", kind: "block", attacker_dies: true)])
    assert verdict[:ok], verdict[:reason]
    assert_equal "abisso", engine.instance_variable_get(:@table).card("a1")[:zone], "col sì la copia manda l'attaccante nell'Abisso"
    assert_equal "field", engine.instance_variable_get(:@table).card("b1")[:zone], "il bloccante resta in campo"
  end

  def test_stronger_attacker_survives_block
    engine = wave([["a1", "STRONG"]], [["b1", "WEAK"]], ["a1"], [["b1", "a1", "block"]])
    refute resolve_with(engine, [battle_entry("a1", blocker: "b1", kind: "block", attacker_dies: true, blocker_dies: true)])[:ok]
    assert resolve_with(engine, [battle_entry("a1", blocker: "b1", kind: "block", blocker_dies: true)])[:ok]
  end

  def test_stronger_counterattack_kills_attacker
    # 3 + 2 = 5 > 4
    engine = wave([["a1", "STRONG"]], [["b1", "THORNY"]], ["a1"], [["b1", "a1", "counter"]])
    verdict = resolve_with(engine, [battle_entry("a1", blocker: "b1", kind: "counter", attacker_dies: true)])
    assert verdict[:ok], verdict[:reason]
  end

  # Gli attrezzi degli effetti d'attacco nella risoluzione (§8.1, §8.2): il
  # bonus di Potenza fino a fine turno e la Vendetta, stampata o concessa —
  # dal 2026-09-11 il colpo di chi muore: il bloccante più debole muore e si
  # porta dietro l'attaccante.
  REVENGE_POWERS = POWERS.merge("VENGEFUL" => { type: "entity", keywords: ["revenge"], power: 2, counterattack: nil }).freeze

  def revenge_wave(*args)
    engine = wave(*args)
    engine.instance_variable_set(:@cards, REVENGE_POWERS)
    engine
  end

  def test_power_bonus_counts
    engine = wave([["a1", "STRONG"]], [["b1", "EVEN"]], ["a1"], [["b1", "a1", "block"]])
    engine.observe({ "t" => "empower", "uid" => "a1", "power" => 1, "effect" => { "source" => "a1", "event" => "on_attack", "entering" => "a1" } })
    verdict = resolve_with(engine, [battle_entry("a1", blocker: "b1", kind: "block", blocker_dies: true)])
    assert verdict[:ok], verdict[:reason]
  end

  def test_weaker_revenge_dies_taking_attacker
    # 2 < 4: il bloccante muore, e con lui l'attaccante
    engine = revenge_wave([["a1", "STRONG"]], [["b1", "VENGEFUL"]], ["a1"], [["b1", "a1", "block"]])
    refute resolve_with(engine, [battle_entry("a1", blocker: "b1", kind: "block", blocker_dies: true)])[:ok], "il solo bloccante morto non torna"
    verdict = resolve_with(engine, [battle_entry("a1", blocker: "b1", kind: "block", attacker_dies: true, blocker_dies: true)])
    assert verdict[:ok], verdict[:reason]
  end

  def test_granted_revenge_counts_as_printed
    engine = wave([["a1", "STRONG"]], [["b1", "WEAK"]], ["a1"], [["b1", "a1", "block"]])
    engine.observe({ "t" => "empower", "uid" => "b1", "grants" => ["revenge"], "effect" => { "source" => "b1", "event" => "on_attack", "entering" => "b1" } })
    assert resolve_with(engine, [battle_entry("a1", blocker: "b1", kind: "block", attacker_dies: true, blocker_dies: true)])[:ok]
    refute resolve_with(engine, [battle_entry("a1", blocker: "b1", kind: "block", blocker_dies: true)])[:ok]
  end

  def test_revenge_not_in_counterattack
    # Vendetta è del blocco normale: nel contrattacco fallito muore solo il contrattaccante.
    engine = wave([["a1", "STRONG"]], [["b1", "THORNY"]], ["a1"], [["b1", "a1", "counter"]])
    engine.observe({ "t" => "empower", "uid" => "a1", "power" => 2, "effect" => { "source" => "a1", "event" => "on_attack", "entering" => "a1" } })
    engine.observe({ "t" => "empower", "uid" => "b1", "grants" => ["revenge"], "effect" => { "source" => "b1", "event" => "on_attack", "entering" => "b1" } })
    # 3 + 2 = 5 < 6
    assert resolve_with(engine, [battle_entry("a1", blocker: "b1", kind: "counter", blocker_dies: true)])[:ok]
  end

  def test_unable_blocker_is_stopped
    engine = wave([["a1", "STRONG"]], [["b1", "EVEN"]], ["a1"], [])
    engine.observe({ "t" => "empower", "uid" => "b1", "restrict" => "block", "effect" => { "source" => "a1", "event" => "on_attack", "entering" => "a1" } })
    verdict = engine.judge({ "t" => "declare", "declaration" => { "id" => "b1", "from" => "b1", "to" => "a1", "kind" => "block", "seat" => "b", "order" => 0 } })
    refute verdict[:ok]
    assert_match(/non può bloccare in questo turno/, verdict[:reason])
  end

  def test_wrong_outcome_is_stopped
    engine = wave([["a1", "WEAK"]], [["b1", "STRONG"]], ["a1"], [["b1", "a1", "block"]])
    verdict = resolve_with(engine, [battle_entry("a1", blocker: "b1", kind: "block", blocker_dies: true)])
    assert verdict[:ruled]
    refute verdict[:ok], "il bloccante superiore non muore (§6.3)"
    assert_match(/§6\.3.*battaglia 1/, verdict[:reason])
    assert_equal "field", engine.instance_variable_get(:@table).card("b1")[:zone], "col no la copia non si tocca"
  end

  def test_battles_follow_declaration_order
    engine = wave([["a1", "STRONG"], ["a2", "WEAK"]], [], %w[a2 a1], [])
    correct = [battle_entry("a2", damage: 2), battle_entry("a1", damage: 4)]
    refute resolve_with(engine, correct.reverse)[:ok], "l'ordine è quello di dichiarazione (§6.4)"
    assert resolve_with(engine, correct)[:ok]
  end

  def test_resolve_only_in_reaction
    engine = wave([["a1", "STRONG"]], [], [], [])
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    verdict = resolve_with(engine, [], seat: "b")
    refute verdict[:ok]
    assert_match(/§6\.4/, verdict[:reason])
  end

  def test_active_seat_resolves
    engine = wave([["a1", "STRONG"]], [], ["a1"], [])
    verdict = resolve_with(engine, [battle_entry("a1", damage: 4)], seat: "b")
    refute verdict[:ok]
    assert_match(/di turno/, verdict[:reason])
  end

  def test_card_unknown_to_index_no_rule
    engine = wave([["a1", "MYSTERY"]], [], [], [])
    engine.observe({ "t" => "declare", "declaration" => { "from" => "a1", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 } })
    verdict = resolve_with(engine, [battle_entry("a1", damage: 9)])
    assert verdict[:ok]
    refute verdict[:ruled], "senza la Potenza il conto non si rifà: silenzio"
  end

  # --- §6.2: le carte si giocano in Preparazione ---------------------------

  # --- §3.1: i PV iniziali sono quelli stampati sul Rubyfront
  # Un Rubyfront con i PV in anagrafe, uno senza (forma ignota: silenzio).
  LIFE = {
    "RUBY" => { type: "rubyfront", keywords: [], health: 21 },
    "OPAQUE" => { type: "rubyfront", keywords: [] },
    "SLOW" => { type: "entity", keywords: [] },
  }.freeze

  def deck_with(engine, seat, rubyfront_id, hp: nil)
    cards = [{ "uid" => "#{seat}-rf", "owner" => seat, "zone" => "field", "order" => 0, "cardId" => rubyfront_id, "y" => 1580 }]
    action = { "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards }
    action["hp"] = hp unless hp.nil?
    engine.judge(action)
  end

  def test_deck_carries_printed_hp_and_copy_starts_there
    engine = Rubyfront::Engine.new(cards: LIFE)
    verdict = deck_with(engine, "a", "RUBY", hp: 21)
    assert verdict[:ruled]
    assert verdict[:ok]
    assert_equal 21, engine.instance_variable_get(:@table).hp("a")
  end

  def test_hp_different_from_printed_is_stopped
    engine = Rubyfront::Engine.new(cards: LIFE)
    verdict = deck_with(engine, "a", "RUBY", hp: 20)
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_includes verdict[:reason], "(§3.1)"
    assert_includes verdict[:reason_en], "(§3.1)"
    assert_equal 20, engine.instance_variable_get(:@table).hp("a"), "la copia resta com'era"
  end

  def test_missing_hp_with_known_rubyfront_is_stopped
    engine = Rubyfront::Engine.new(cards: LIFE)
    verdict = deck_with(engine, "a", "RUBY")
    assert verdict[:ruled]
    refute verdict[:ok]
  end

  def test_rubyfront_without_hp_in_index_or_unknown_has_no_rule
    engine = Rubyfront::Engine.new(cards: LIFE)
    refute deck_with(engine, "a", "OPAQUE", hp: 5)[:ruled]
    refute deck_with(engine, "b", "STRANGER", hp: 5)[:ruled]
  end

  def test_deck_without_rubyfront_has_no_rule
    engine = Rubyfront::Engine.new(cards: LIFE)
    cards = [{ "uid" => "a-1", "owner" => "a", "zone" => "deck", "order" => 0, "cardId" => "SLOW" }]
    verdict = engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards, "hp" => 7 })
    refute verdict[:ruled]
  end

  WINDOW = {
    "SLOW" => { type: "entity", keywords: [] },
    "STONE" => { type: "matter", keywords: [], behavior: "normal" },
    "SPARK" => { type: "matter", keywords: [], behavior: "reactive" },
    "RUBY" => { type: "rubyfront", keywords: [] },
    "IRON" => { type: "object", keywords: [] },
  }.freeze

  # Una carta in mano al posto `seat`, pronta a scendere.
  def in_hand(engine, seat, uid, card_id)
    cards = [{ "uid" => uid, "owner" => seat, "zone" => "hand", "order" => 0, "cardId" => card_id }]
    engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
  end

  # Senza coordinate l'ingresso non ha forma da giudicare (§5): i test che
  # vogliono uno slot lo dicono.
  def put_on_field(engine, uid, x: nil, y: nil)
    action = { "t" => "toZone", "uid" => uid, "zone" => "field" }
    action["x"] = x unless x.nil?
    action["y"] = y unless y.nil?
    engine.judge(action)
  end

  def test_playing_in_preparation
    engine = Rubyfront::Engine.new(cards: WINDOW)
    in_hand(engine, "a", "a-1", "SLOW")
    assert put_on_field(engine, "a-1")[:ok]
  end

  def test_in_front_entity_does_not_enter
    engine = Rubyfront::Engine.new(cards: WINDOW)
    in_hand(engine, "a", "a-1", "SLOW")
    front!(engine)
    verdict = put_on_field(engine, "a-1")
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/Fronte.*§6\.2/, verdict[:reason])
  end

  def test_in_front_not_even_normal_matters_and_items
    engine = Rubyfront::Engine.new(cards: WINDOW)
    in_hand(engine, "a", "a-1", "STONE")
    in_hand(engine, "b", "b-1", "IRON")
    front!(engine)
    refute put_on_field(engine, "a-1")[:ok]
    refute put_on_field(engine, "b-1")[:ok], "nel turno altrui non è Preparazione di nessuno"
  end

  def test_in_front_reactives_enter_from_active_seat
    engine = Rubyfront::Engine.new(cards: WINDOW)
    in_hand(engine, "a", "a-1", "SPARK")
    in_hand(engine, "b", "b-1", "SPARK")
    front!(engine)
    verdict = engine.judge({ "t" => "toZone", "uid" => "b-1", "zone" => "field", "chain" => true })
    refute verdict[:ok], "prima dell'ondata la finestra è di chi è di turno: il difensore gioca in Reazione (§6.3, §7.2)"
    assert_match(/in Reazione/, verdict[:reason])
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "field", "chain" => true })
    assert verdict[:ok], "le Reattive si giocano solo in Fase di Fronte (§7.2)"
  end

  def test_reactives_do_not_enter_in_preparation_even_own_turn
    engine = Rubyfront::Engine.new(cards: WINDOW)
    in_hand(engine, "a", "a-1", "SPARK")
    verdict = put_on_field(engine, "a-1")
    refute verdict[:ok]
    assert_match(/§7\.2/, verdict[:reason])
  end

  def test_rubyfront_deploys_even_after_attacks
    engine = Rubyfront::Engine.new(cards: WINDOW)
    in_hand(engine, "a", "rf-a", "RUBY")
    front!(engine)
    assert put_on_field(engine, "rf-a")[:ok], "finestra di movimento: tutto il proprio turno (§3.1)"
  end

  def test_no_playing_in_reaction
    engine = Rubyfront::Engine.new(cards: WINDOW)
    in_hand(engine, "a", "a-1", "SLOW")
    front!(engine)
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    verdict = put_on_field(engine, "a-1")
    refute verdict[:ok]
    assert_match(/Reazione/, verdict[:reason])
  end

  def test_unknown_card_in_front_no_rule
    engine = Rubyfront::Engine.new(cards: WINDOW)
    in_hand(engine, "a", "a-1", "MYSTERY")
    front!(engine)
    verdict = put_on_field(engine, "a-1")
    assert verdict[:ok]
    refute verdict[:ruled]
  end

  def test_turn_change_allows_playing_again
    engine = Rubyfront::Engine.new(cards: WINDOW)
    in_hand(engine, "b", "b-1", "SLOW")
    front!(engine)
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    assert put_on_field(engine, "b-1")[:ok]
  end

  # --- §6: nel turno altrui non si agisce ----------------------------------

  def foreign
    Rubyfront::Engine.new(cards: WINDOW)
  end

  def test_without_actor_turn_gate_is_silent
    verdict = foreign.judge({ "t" => "draw", "seat" => "b", "count" => 1 })
    refute verdict[:ruled]
  end

  def test_active_seat_acts
    verdict = foreign.judge({ "t" => "draw", "seat" => "a", "count" => 1 }, actor: "a")
    assert verdict[:ok]
  end

  def test_opponent_does_not_draw_in_my_turn
    engine = foreign
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    verdict = engine.judge({ "t" => "draw", "seat" => "b", "count" => 1 }, actor: "b")
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/non tocca a te.*§6/, verdict[:reason])
  end

  def test_setup_has_no_turn
    engine = foreign
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    assert engine.judge({ "t" => "player", "seat" => "b", "patch" => { "name" => "Ale" } }, actor: "b")[:ok], "il nome non è un gesto di gioco"
    refute engine.judge({ "t" => "player", "seat" => "b", "patch" => { "name" => "Ale", "hp" => 3 } }, actor: "b")[:ok], "coi contatori sì (in Preparazione altrui)"
    front!(engine)
    cards = [{ "uid" => "b-1", "owner" => "b", "zone" => "deck", "order" => 0, "cardId" => "SLOW" }]
    assert engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => cards }, actor: "b")[:ok], "il mazzo si carica all'ingresso, nel turno di chiunque"
    assert engine.judge({ "t" => "say", "entry" => {} }, actor: "b")[:ok]
    assert engine.judge({ "t" => "newGame" }, actor: "b")[:ok], "Nuova partita è di entrambi"
  end

  def test_before_first_turn_other_sets_up_deck_too
    # §4: mano iniziale e mulligan di chi NON apre, al turno 1 in Preparazione.
    engine = foreign
    in_hand(engine, "b", "b-1", "SLOW")
    assert engine.judge({ "t" => "draw", "seat" => "b", "count" => 6 }, actor: "b")[:ok], "la mano iniziale"
    assert engine.judge({ "t" => "shuffle", "seat" => "b", "order" => [] }, actor: "b")[:ok], "il mulligan mescola"
    assert engine.judge({ "t" => "toZone", "uid" => "b-1", "zone" => "deck" }, actor: "b")[:ok], "la mano torna nel mazzo"
    refute engine.judge({ "t" => "toZone", "uid" => "b-1", "zone" => "field" }, actor: "b")[:ok], "ma in campo no"
    front!(engine)
    refute engine.judge({ "t" => "draw", "seat" => "b", "count" => 1 }, actor: "b")[:ok], "chiusa la Preparazione del turno 1, finestra chiusa"
  end

  def test_opponent_does_not_play_entity_in_my_turn
    engine = foreign
    in_hand(engine, "b", "b-1", "SLOW")
    verdict = engine.judge({ "t" => "toZone", "uid" => "b-1", "zone" => "field" }, actor: "b")
    refute verdict[:ok]
  end

  def test_opponent_does_not_play_reactive_in_my_front_before_wave
    engine = foreign
    in_hand(engine, "b", "b-1", "SPARK")
    front!(engine)
    verdict = engine.judge({ "t" => "toZone", "uid" => "b-1", "zone" => "field", "chain" => true }, actor: "b")
    refute verdict[:ok], "il Pre-Fronte non c'è più: il difensore gioca le Reattive in Reazione (§6.3, §7.2)"
    assert_match(/di chi è di turno/, verdict[:reason])
  end

  def test_opponent_does_not_play_reactives_in_preparation
    engine = foreign
    in_hand(engine, "b", "b-1", "SPARK")
    verdict = engine.judge({ "t" => "toZone", "uid" => "b-1", "zone" => "field" }, actor: "b")
    refute verdict[:ok], "le Reattive si giocano solo in Fase di Fronte (§7.2)"
  end

  def test_opponent_blocks_in_reaction
    engine = wave([["a1", "STRONG"]], [["b1", "WEAK"]], ["a1"], [])
    block_action = { "t" => "declare", "declaration" => { "id" => "b1", "from" => "b1", "to" => "a1", "kind" => "block", "seat" => "b", "order" => 0 } }
    verdict = engine.judge(block_action, actor: "b")
    assert verdict[:ok], verdict[:reason]
    assert engine.judge({ "t" => "undeclare", "from" => "b1" }, actor: "b")[:ok], "e può ripensarci"
  end

  def test_counterattacker_covers_in_opponent_turn
    # §6.3, punto 4: «chi blocca si tappa, chi contrattacca si copre», e la
    # copertura scatta alla dichiarazione — quindi nel turno di chi attacca.
    engine = wave([["a1", "STRONG"]], [["b1", "THORNY"]], ["a1"], [["b1", "a1", "counter"]])
    verdict = engine.judge({ "t" => "facedown", "uid" => "b1", "facedown" => true }, actor: "b")
    assert verdict[:ok], verdict[:reason]
    assert engine.judge({ "t" => "facedown", "uid" => "b1", "facedown" => false }, actor: "b")[:ok], "e il ripensamento la scopre"
  end

  def test_defender_does_not_cover_attacker_cards
    engine = wave([["a1", "STRONG"]], [["b1", "THORNY"]], ["a1"], [["b1", "a1", "counter"]])
    verdict = engine.judge({ "t" => "facedown", "uid" => "a1", "facedown" => true }, actor: "b")
    refute verdict[:ok]
    assert_match(/non tocca a te/, verdict[:reason])
  end

  def test_outside_reaction_defender_does_not_cover
    engine = Rubyfront::Engine.new(cards: POWERS)
    field_setup = [{ "uid" => "b1", "owner" => "b", "zone" => "field", "order" => 0, "cardId" => "THORNY" }]
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => field_setup })
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    front!(engine)
    verdict = engine.judge({ "t" => "facedown", "uid" => "b1", "facedown" => true }, actor: "b")
    refute verdict[:ok], "la copertura è quella del contrattacco, e i blocchi vivono in Reazione (§6.4)"
  end

  def test_opponent_does_not_change_phase_or_turn
    engine = foreign
    refute engine.judge({ "t" => "phase", "phase" => "fronte" }, actor: "b")[:ok]
    refute engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" }, actor: "b")[:ok]
    assert engine.judge({ "t" => "phase", "phase" => "fronte" }, actor: "a")[:ok]
  end

  def test_opponent_pays_flux_only_in_front_and_reaction
    engine = foreign
    pay_for = { "t" => "player", "seat" => "b", "patch" => { "flux" => 1 } }
    refute engine.judge(pay_for, actor: "b")[:ok], "in Preparazione altrui i contatori non si toccano"
    front!(engine)
    assert engine.judge(pay_for, actor: "b")[:ok], "nel Fronte si pagano le Reattive"
  end

  def test_opponent_does_not_patch_my_counters
    engine = foreign
    front!(engine)
    refute engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 10 } }, actor: "b")[:ok]
  end

  def test_in_reaction_defender_resolves_and_closes
    engine = wave([["a1", "STRONG"]], [], ["a1"], [])
    from_a = engine.judge({ "t" => "resolve", "seat" => "a", "battles" => [battle_entry("a1", damage: 4)] }, actor: "a")
    refute from_a[:ok], "chi attacca aspetta la reazione (§6.4)"
    assert_match(/chiude chi difende/, from_a[:reason])
    refute engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" }, actor: "a")[:ok]
    from_b = engine.judge({ "t" => "resolve", "seat" => "a", "battles" => [battle_entry("a1", damage: 4)] }, actor: "b")
    assert from_b[:ok], from_b[:reason]
    assert engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" }, actor: "b")[:ok]
  end

  def test_outside_reaction_active_seat_closes
    engine = foreign
    front!(engine)
    refute engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" }, actor: "b")[:ok]
    assert engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" }, actor: "a")[:ok]
  end

  # --- §3.2: le carte si pagano ---------------------------------------------

  COSTS = {
    "COSTLY" => { type: "entity", keywords: [], flux_cost: 3 },
    "CHEAP" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 1 },
    "RUBY" => { type: "rubyfront", keywords: [] },
    "SLOW" => { type: "entity", keywords: [] },
  }.freeze

  def with_costs(flux)
    engine = Rubyfront::Engine.new(cards: COSTS)
    engine.judge({ "t" => "player", "seat" => "a", "patch" => { "flux" => flux } })
    engine
  end

  def pay_for(engine, uid, cost)
    action = { "t" => "toZone", "uid" => uid, "zone" => "field" }
    action["cost"] = cost unless cost.nil?
    engine.judge(action)
  end

  def test_with_enough_flux_play_and_pay
    engine = with_costs(3)
    in_hand(engine, "a", "a-1", "COSTLY")
    verdict = pay_for(engine, "a-1", 3)
    assert verdict[:ok], verdict[:reason]
    assert_equal 0, engine.instance_variable_get(:@table).flux("a"), "col sì la copia scala il costo"
  end

  def test_without_flux_card_does_not_enter
    engine = with_costs(2)
    in_hand(engine, "a", "a-1", "COSTLY")
    verdict = pay_for(engine, "a-1", 3)
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/Flusso insufficiente.*2.*3.*§3\.2/, verdict[:reason])
  end

  def test_mismatched_cost_is_stopped
    engine = with_costs(9)
    in_hand(engine, "a", "a-1", "COSTLY")
    refute pay_for(engine, "a-1", 1)[:ok], "pagare meno del costo stampato"
    refute pay_for(engine, "a-1", nil)[:ok], "non pagare affatto"
    assert_match(/costa 3.*paga 0/, pay_for(engine, "a-1", nil)[:reason])
  end

  def test_matters_are_paid_too
    engine = with_costs(0)
    in_hand(engine, "a", "a-1", "CHEAP")
    refute pay_for(engine, "a-1", 1)[:ok]
  end

  def test_from_outside_hand_no_payment
    engine = with_costs(0)
    cards = [{ "uid" => "a-1", "owner" => "a", "zone" => "deck", "order" => 0, "cardId" => "COSTLY" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    assert pay_for(engine, "a-1", nil)[:ok], "dal mazzo una carta scende per effetto: nessun costo"
  end

  def test_rubyfront_skips_cost_gate
    engine = with_costs(0)
    in_hand(engine, "a", "rf-a", "RUBY")
    assert pay_for(engine, "rf-a", nil)[:ok]
  end

  def test_card_without_cost_in_index_silence
    engine = with_costs(0)
    in_hand(engine, "a", "a-1", "SLOW")
    assert pay_for(engine, "a-1", nil)[:ok]
  end

  def test_spent_token_pays_card
    engine = with_costs(20)
    in_hand(engine, "a", "a-1", "COSTLY")
    engine.judge({ "t" => "player", "seat" => "a", "patch" => { "token" => false, "flux" => 21 } })
    assert pay_for(engine, "a-1", 3)[:ok]
    assert_equal 18, engine.instance_variable_get(:@table).flux("a")
  end

  # --- §5: la lavagna legata agli slot, e dal campo non si torna indietro ---

  def test_entity_enters_slot_of_own_row
    engine = Rubyfront::Engine.new(cards: WINDOW)
    in_hand(engine, "a", "a-1", "SLOW")
    assert put_on_field(engine, "a-1", x: 821, y: 1260)[:ok], "slot della fila di A"
    in_hand(engine, "a", "a-2", "SLOW")
    verdict = put_on_field(engine, "a-2", x: 900, y: 1260)
    refute verdict[:ok], "a mano libera no"
    assert_match(/slot.*§5/, verdict[:reason])
    refute put_on_field(engine, "a-2", x: 821, y: 172)[:ok], "nella fila avversaria no"
    assert put_on_field(engine, "a-2")[:ok], "senza coordinate niente da giudicare"
  end

  def test_moving_on_field_is_bound_to_slots_too
    engine = Rubyfront::Engine.new(cards: WINDOW)
    # Un carico solo: ricaricare il mazzo azzera il posto (test_ricaricare…).
    cards = [["a-1", "SLOW"], ["m-1", "STONE"]].map.with_index do |(uid, id), i|
      { "uid" => uid, "owner" => "a", "zone" => "hand", "order" => i, "cardId" => id }
    end
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    put_on_field(engine, "a-1", x: 442, y: 1260)
    put_on_field(engine, "m-1", x: 2368, y: 1260)
    # §5 — «un'Entità occupa lo slot in cui è scesa»: nemmeno su uno slot libero.
    verdict = engine.judge({ "t" => "move", "uid" => "a-1", "x" => 1199, "y" => 1260, "z" => 3 })
    refute verdict[:ok]
    assert_match(/resta nello slot.*§5/, verdict[:reason])
    assert_match(/stays in the slot.*§5/, verdict[:reason_en])
    refute engine.judge({ "t" => "move", "uid" => "a-1", "x" => 1000, "y" => 1300, "z" => 3 })[:ok]
    verdict = engine.judge({ "t" => "move", "uid" => "m-1", "x" => 2000, "y" => 1300, "z" => 3 })
    refute verdict[:ruled], "una Materia in campo si sposta liberamente"
  end

  def test_from_field_no_return_to_hand_or_deck
    engine = Rubyfront::Engine.new(cards: WINDOW)
    in_hand(engine, "a", "a-1", "SLOW")
    put_on_field(engine, "a-1", x: 442, y: 1260)
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "hand" })
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/non torna in mano.*§5/, verdict[:reason])
    refute engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "deck" })[:ok]
    refute engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })[:ok], "e nell'Abisso non a mano (§5)"
  end

  def test_unknown_row_skips_form_gate
    # Lavagna vecchia, senza la fila: resta il vincolo dello slot (§5), non quello dello spostamento.
    engine = Rubyfront::Engine.new(cards: WINDOW)
    cards = [{ "uid" => "a-1", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "SLOW" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    assert engine.judge({ "t" => "move", "uid" => "a-1", "x" => 1199, "y" => 1260, "z" => 3 })[:ok]
    refute engine.judge({ "t" => "move", "uid" => "a-1", "x" => 442, "y" => 1260, "z" => 4 })[:ok], "annotata la fila, lo slot è quello"
  end

  # --- §5: l'Abisso -----------------------------------------------------------

  def test_no_manual_move_to_abyss
    engine = Rubyfront::Engine.new(cards: WINDOW)
    in_hand(engine, "a", "a-1", "SLOW")
    put_on_field(engine, "a-1", x: 442, y: 1260)
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => "abisso" })
    refute verdict[:ok]
    assert_match(/non a mano.*§5/, verdict[:reason])
    assert_match(/not by hand.*§5/, verdict[:reason_en])
  end

  def test_matter_on_field_goes_to_abyss
    # «Materie risolte, decadute o svanite» (§5): la Materia in campo ci va sempre.
    engine = Rubyfront::Engine.new(cards: WINDOW)
    in_hand(engine, "a", "m-1", "STONE")
    put_on_field(engine, "m-1", x: 2368, y: 1260)
    assert engine.judge({ "t" => "toZone", "uid" => "m-1", "zone" => "abisso" })[:ok]
  end

  def test_excess_discard_goes_from_hand_to_retire_zone
    # §6.5: «le carte in eccesso vanno scartate» — in Zona di Ritiro (dal
    # 2026-09-10), solo oltre le 7; nell'Abisso dalla mano mai.
    engine = Rubyfront::Engine.new(cards: WINDOW)
    cards = (1..8).map { |i| { "uid" => "a-#{i}", "owner" => "a", "zone" => "hand", "order" => i, "cardId" => "SLOW" } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-8", "zone" => "abisso" })
    refute verdict[:ok]
    assert_match(/vanno in Zona di Ritiro, non nell'Abisso.*§5, §6\.5/, verdict[:reason])
    assert engine.judge({ "t" => "toZone", "uid" => "a-8", "zone" => "ritiro" })[:ok], "otto in mano: l'ottava si scarta"
    verdict = engine.judge({ "t" => "toZone", "uid" => "a-7", "zone" => "ritiro" })
    refute verdict[:ok], "a sette non si scarta più"
    assert_match(/solo per eccesso.*§6\.5/, verdict[:reason])
  end

  def test_no_return_from_abyss
    engine = Rubyfront::Engine.new(cards: WINDOW)
    cards = [{ "uid" => "a-1", "owner" => "a", "zone" => "abisso", "order" => 0, "cardId" => "SLOW" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    %w[hand deck field ritiro].each do |zone|
      verdict = engine.judge({ "t" => "toZone", "uid" => "a-1", "zone" => zone, "x" => 442, "y" => 1260 })
      refute verdict[:ok], zone
      assert_match(/dall'Abisso non si torna.*§5/, verdict[:reason])
    end
  end

  def test_unknown_card_in_abyss_is_silent
    engine = Rubyfront::Engine.new(cards: WINDOW)
    cards = [{ "uid" => "x-1", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "UNKNOWN" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    refute engine.judge({ "t" => "toZone", "uid" => "x-1", "zone" => "abisso" })[:ruled]
  end

  # --- §7: le Materie si giocano solo se abilitate -------------------------

  MATTERS = {
    "HUMAN" => { type: "entity", keywords: [], enables: [[{ type: "dynamic", max_grade: 1 }]] },
    "MASTER" => { type: "entity", keywords: [], enables: [[{ type: "dynamic", max_grade: 2 }]] },
    "AUROS" => { type: "entity", keywords: [], enables: [[{ type: "dimensional", max_grade: 2 }]] },
    "RUBY" => { type: "rubyfront", keywords: [],
                  enables: [[{ type: "destructive", max_grade: 1 }], [{ type: "destructive", max_grade: 2 }]] },
    "SPARK" => { type: "matter", keywords: [], behavior: "normal", matter: { type: "dynamic", grade: 1 } },
    "STORM" => { type: "matter", keywords: [], behavior: "normal", matter: { type: "dynamic", grade: 2 } },
    "RUIN" => { type: "matter", keywords: [], behavior: "normal", matter: { type: "destructive", grade: 2 } },
    "MYSTERY" => { type: "matter", keywords: [], behavior: "normal", matter: nil },
  }.freeze

  # Un tavolo per A: `field` sono [uid, id, opzioni] già in campo (con la
  # fila `y` e la faccia), `hand` [uid, id] in mano. Un carico solo.
  def table_setup(field, hand, seat: "a")
    engine = Rubyfront::Engine.new(cards: MATTERS)
    cards = field.map.with_index do |(uid, id, opts), i|
      { "uid" => uid, "owner" => seat, "zone" => "field", "order" => i, "cardId" => id,
        "y" => 1260, "face" => 0 }.merge((opts || {}).transform_keys(&:to_s))
    end
    cards += hand.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => seat, "zone" => "hand", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    engine
  end

  def play_matter(engine, uid)
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => 2368, "y" => 1260 })
  end

  def test_with_enabler_on_field_matter_enters
    engine = table_setup([["e1", "HUMAN"]], [["m1", "SPARK"]])
    assert play_matter(engine, "m1")[:ok]
  end

  def test_without_enabler_matter_does_not_enter
    engine = table_setup([], [["m1", "SPARK"]])
    verdict = play_matter(engine, "m1")
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/abilita la Materia Dinamica di grado 1.*§7/, verdict[:reason])
  end

  def test_grade_counts
    engine = table_setup([["e1", "HUMAN"]], [["m2", "STORM"]])
    refute play_matter(engine, "m2")[:ok], "un abilitatore di primo grado non basta per il secondo (§7.1)"
    engine = table_setup([["e1", "MASTER"]], [["m2", "STORM"]])
    assert play_matter(engine, "m2")[:ok]
  end

  def test_type_counts
    engine = table_setup([["e1", "AUROS"]], [["m1", "SPARK"]])
    refute play_matter(engine, "m1")[:ok], "la Dimensionale non abilita la Dinamica"
  end

  def test_covered_does_not_enable_tapped_does
    engine = table_setup([["e1", "HUMAN", { facedown: true }]], [["m1", "SPARK"]])
    refute play_matter(engine, "m1")[:ok], "l'Entità coperta non abilita (§6.3)"
    engine = table_setup([["e1", "HUMAN", { tapped: true }]], [["m1", "SPARK"]])
    assert play_matter(engine, "m1")[:ok], "la tappata abilita normalmente"
  end

  def test_rubyfront_enables_only_when_deployed
    engine = table_setup([["rf", "RUBY", { y: 1756 }]], [["r2", "RUIN"]])
    refute play_matter(engine, "r2")[:ok], "in Zona di Richiamo non abilita nulla (§3.1)"
    engine = table_setup([["rf", "RUBY", { y: 1260 }]], [["r2", "RUIN"]])
    refute play_matter(engine, "r2")[:ok], "schierato, ma la faccia Rubyfront arriva al primo grado"
    engine = table_setup([["rf", "RUBY", { y: 1260, face: 1 }]], [["r2", "RUIN"]])
    assert play_matter(engine, "r2")[:ok], "il Nexus abilita fino al secondo grado (§3.1)"
  end

  def test_opposing_enabler_does_not_count
    engine = table_setup([], [["m1", "SPARK"]])
    cards = [{ "uid" => "b1", "owner" => "b", "zone" => "field", "order" => 0, "cardId" => "HUMAN", "y" => 172 }]
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => cards })
    refute play_matter(engine, "m1")[:ok]
  end

  def test_matter_without_label_silence
    engine = table_setup([], [["m1", "MYSTERY"]])
    verdict = play_matter(engine, "m1")
    assert verdict[:ok]
  end

  # --- §2/§9: la fine della partita ----------------------------------------

  def finish(engine, winner, reason)
    engine.judge({ "t" => "gameOver", "winner" => winner, "reason" => reason })
  end

  def test_at_zero_hp_victory_passes_and_table_stops
    engine = Rubyfront::Engine.new
    engine.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => 0 } })
    verdict = finish(engine, "a", "hp")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    later = engine.judge({ "t" => "draw", "seat" => "a", "count" => 1 })
    refute later[:ok]
    assert_match(/partita è finita/, later[:reason])
    assert engine.judge({ "t" => "say", "entry" => {} })[:ok], "la chat resta"
    assert engine.judge({ "t" => "newGame", "active" => "a" })[:ok], "Nuova partita riapre"
    assert engine.judge({ "t" => "draw", "seat" => "a", "count" => 1 })[:ok]
  end

  def test_claimed_victory_with_hp_left_is_stopped
    engine = Rubyfront::Engine.new
    verdict = finish(engine, "a", "hp")
    refute verdict[:ok]
    assert_match(/PV di B non sono a zero.*§2/, verdict[:reason])
  end

  def test_draw_needs_both_at_zero
    engine = Rubyfront::Engine.new
    engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 0 } })
    refute finish(engine, nil, "draw")[:ok]
    engine.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => 0 } })
    assert finish(engine, nil, "draw")[:ok]
  end

  def test_empty_deck_checked_on_copy
    engine = Rubyfront::Engine.new
    cards = [{ "uid" => "b-1", "owner" => "b", "zone" => "deck", "order" => 0 }]
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => cards })
    verdict = finish(engine, "a", "deck")
    refute verdict[:ok]
    assert_match(/mazzo di B non è vuoto.*§9\.1/, verdict[:reason])
    engine.judge({ "t" => "draw", "seat" => "b", "count" => 1 }, actor: "b")
    assert finish(engine, "a", "deck")[:ok]
  end

  def test_resolution_brings_hp_to_zero_in_copy_too
    engine = wave([["a1", "STRONG"]], [], ["a1"], [])
    engine.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => 4 } })
    assert resolve_with(engine, [battle_entry("a1", damage: 4)])[:ok]
    assert finish(engine, "a", "hp")[:ok], "4 danni su 4 PV: la copia lo sa"
  end

  # --- §3.1: il Rubyfront si schiera pagando --------------------------------

  DEPLOYMENTS = {
    "FIXED" => { type: "rubyfront", keywords: [], deployment: { fixed: 3, die: nil } },
    "DIE" => { type: "rubyfront", keywords: [], deployment: { fixed: nil, die: 6 } },
    "UNKNOWN_B" => { type: "rubyfront", keywords: [] },
  }.freeze

  # Il Rubyfront di A in Zona di Richiamo (fila di servizio), con quel Flusso.
  def recall_setup(card_id, flux:, token: false)
    engine = Rubyfront::Engine.new(cards: DEPLOYMENTS)
    engine.judge({ "t" => "player", "seat" => "a", "patch" => { "flux" => flux, "token" => token } })
    cards = [{ "uid" => "rf", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => card_id, "y" => 1756 }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine
  end

  def deploy_rubyfront(engine, cost: nil, roll: nil, y: 1260, actor: "a")
    action = { "t" => "move", "uid" => "rf", "x" => 30, "y" => y, "z" => 2 }
    action["cost"] = cost unless cost.nil?
    action["roll"] = roll unless roll.nil?
    engine.judge(action, actor: actor)
  end

  def test_fixed_cost_paid_same_each_deployment
    engine = recall_setup("FIXED", flux: 3)
    assert deploy_rubyfront(engine, cost: 3)[:ok]
    assert_equal 0, engine.instance_variable_get(:@table).flux("a")
  end

  def test_once_deployed_no_return_to_recall_zone
    engine = recall_setup("FIXED", flux: 3)
    deploy_rubyfront(engine, cost: 3)
    verdict = deploy_rubyfront(engine, y: 1756)
    assert verdict[:ruled]
    refute verdict[:ok]
    assert_match(/non torna in Zona di Richiamo.*§3\.1/, verdict[:reason])
    refute engine.judge({ "t" => "toZone", "uid" => "rf", "zone" => "ritiro" })[:ok], "e non si ritira"
  end

  def test_fixed_cost_without_flux_or_wrong
    engine = recall_setup("FIXED", flux: 2)
    verdict = deploy_rubyfront(engine, cost: 3)
    refute verdict[:ok]
    assert_match(/Flusso insufficiente.*§3\.1/, verdict[:reason])
    refute deploy_rubyfront(engine, cost: 1)[:ok], "pagare meno dello stampato"
    refute deploy_rubyfront(engine)[:ok], "non pagare"
  end

  def test_token_counts_in_available_flux
    engine = recall_setup("FIXED", flux: 2, token: true)
    assert deploy_rubyfront(engine, cost: 3)[:ok]
    table = engine.instance_variable_get(:@table)
    assert_equal 0, table.flux("a")
    refute table.token?("a"), "il Gettone è speso"
  end

  def test_die_rolls_only_if_flux_covers_faces
    engine = recall_setup("DIE", flux: 5)
    verdict = deploy_rubyfront(engine, cost: 2, roll: 2)
    refute verdict[:ok]
    assert_match(/non si tira.*6 Flussi.*ne hai 5/, verdict[:reason])
    engine = recall_setup("DIE", flux: 5, token: true)
    assert deploy_rubyfront(engine, cost: 2, roll: 2)[:ok], "col Gettone il d6 è coperto (§3.1)"
  end

  def test_with_die_the_rolled_number_is_paid
    engine = recall_setup("DIE", flux: 6)
    refute deploy_rubyfront(engine, cost: 3)[:ok], "senza tiro"
    refute deploy_rubyfront(engine, cost: 7, roll: 7)[:ok], "un tiro fuori dal dado"
    refute deploy_rubyfront(engine, cost: 1, roll: 4)[:ok], "pagare meno del tiro"
    assert deploy_rubyfront(engine, cost: 4, roll: 4)[:ok]
    assert_equal 2, engine.instance_variable_get(:@table).flux("a")
  end

  def test_moves_along_row_are_free
    engine = recall_setup("FIXED", flux: 3)
    deploy_rubyfront(engine, cost: 3)
    verdict = engine.judge({ "t" => "move", "uid" => "rf", "x" => 30, "y" => 1260, "z" => 4 })
    refute verdict[:ruled], "già schierato: si sposta e basta"
    engine = recall_setup("FIXED", flux: 0)
    refute engine.judge({ "t" => "move", "uid" => "rf", "x" => 30, "y" => 1756, "z" => 4 })[:ruled], "e in Richiamo pure"
  end

  def test_deployment_is_own_turn_gesture
    engine = recall_setup("FIXED", flux: 3)
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    verdict = deploy_rubyfront(engine, cost: 3, actor: "a")
    refute verdict[:ok]
    assert_match(/non tocca a te/, verdict[:reason])
  end

  def test_without_cost_in_index_silence
    engine = recall_setup("UNKNOWN_B", flux: 0)
    refute deploy_rubyfront(engine)[:ruled]
  end

  # --- §8.2: gli effetti certificati, l'ascoltatore d'ingresso ---------------

  LISTENERS = {
    "LISTENER" => { type: "entity", keywords: [], race: "human",
                 enter_listeners: [{ entering_race: "human", requires: { count: 3, race: "human" }, draw: 1 }] },
    "HUMAN" => { type: "entity", keywords: [], race: "human", enter_listeners: [] },
    "AUROS" => { type: "entity", keywords: [], race: "auros", enter_listeners: [] },
    "STONE" => { type: "matter", keywords: [], behavior: "normal", enter_listeners: [] },
  }.freeze

  # Il campo di A con quelle carte (già in campo, turno 1) e `hand` in mano;
  # poi `entra` fa scendere una carta dalla mano.
  def field_setup(field, hand)
    engine = Rubyfront::Engine.new(cards: LISTENERS)
    cards = field.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "field", "order" => i, "cardId" => id, "y" => 1260 } }
    cards += hand.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "hand", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine
  end

  def step_in(engine, uid, x: 1578)
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => x, "y" => 1260 })
  end

  def fire_trigger(engine, source:, entering:, count: 1, seat: "a")
    engine.judge({ "t" => "draw", "seat" => seat, "count" => count,
                   "effect" => { "source" => source, "event" => "on_enter_field", "entering" => entering } })
  end

  def test_guide_fires_at_third_human
    engine = field_setup([["g", "LISTENER"], ["u1", "HUMAN"]], [["u2", "HUMAN"]])
    assert step_in(engine, "u2")[:ok]
    verdict = fire_trigger(engine, source: "g", entering: "u2")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
  end

  def test_with_two_humans_it_does_not_fire
    engine = field_setup([["g", "LISTENER"]], [["u1", "HUMAN"]])
    step_in(engine, "u1")
    verdict = fire_trigger(engine, source: "g", entering: "u1")
    refute verdict[:ok]
    assert_match(/non ha un effetto certificato.*§8\.2/, verdict[:reason])
  end

  def test_entering_auros_does_not_fire_guide
    engine = field_setup([["g", "LISTENER"], ["u1", "HUMAN"], ["u2", "HUMAN"]], [["x", "AUROS"]])
    step_in(engine, "x")
    refute fire_trigger(engine, source: "g", entering: "x")[:ok]
  end

  def test_trigger_is_consumed_once_per_entry
    engine = field_setup([["g", "LISTENER"], ["u1", "HUMAN"]], [["u2", "HUMAN"]])
    step_in(engine, "u2")
    assert fire_trigger(engine, source: "g", entering: "u2")[:ok]
    verdict = fire_trigger(engine, source: "g", entering: "u2")
    refute verdict[:ok]
    assert_match(/già stato risolto/, verdict[:reason])
  end

  def test_old_entry_no_longer_fires
    engine = field_setup([["g", "LISTENER"], ["u1", "HUMAN"]], [["u2", "HUMAN"]])
    step_in(engine, "u2")
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    verdict = fire_trigger(engine, source: "g", entering: "u2")
    refute verdict[:ok]
    assert_match(/non è entrata sul Fronte questo turno/, verdict[:reason])
  end

  def test_step_form_must_match_effect
    engine = field_setup([["g", "LISTENER"], ["u1", "HUMAN"]], [["u2", "HUMAN"]])
    step_in(engine, "u2")
    refute fire_trigger(engine, source: "g", entering: "u2", count: 3)[:ok], "pesca 1, non 3"
    refute fire_trigger(engine, source: "g", entering: "u2", seat: "b")[:ok], "pesca il controllore"
    refute fire_trigger(engine, source: "g", entering: "g")[:ok], "non se stessa"
    refute fire_trigger(engine, source: "u1", entering: "u2")[:ok], "una carta senza ascoltatore"
  end

  def test_fake_effect_is_not_any_gesture
    engine = field_setup([["u1", "HUMAN"]], [])
    verdict = engine.judge({ "t" => "toZone", "uid" => "u1", "zone" => "hand",
                             "effect" => { "source" => "u1", "event" => "on_enter_field", "entering" => "u1" } })
    refute verdict[:ok]
    assert_match(/§8\.2/, verdict[:reason], "fermato come effetto finto, non come gesto")
  end

  # --- §8.2: lo spostamento all'ingresso manda un'Entità avversaria in Ritiro --

  ARCHERS = {
    "MOVER" => { type: "entity", keywords: [], race: "human",
                   enter_moves: [{ target: { type: "entity", controller: "opponent" }, to: "ritiro" }] },
    "HUMAN" => { type: "entity", keywords: [], race: "human" },
    "STONE" => { type: "matter", keywords: [], behavior: "normal" },
  }.freeze

  # A ha la fonte in mano, B quelle carte in campo; poi la fonte scende.
  def mover(b_field)
    engine = Rubyfront::Engine.new(cards: ARCHERS)
    a = [{ "uid" => "arc", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "MOVER" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    b = b_field.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "b", "zone" => "field", "order" => i, "cardId" => id, "y" => 172 } }
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => b })
    engine.judge({ "t" => "toZone", "uid" => "arc", "zone" => "field", "x" => 442, "y" => 1260 })
    engine
  end

  def send_to_zone(engine, uid, zone: "ritiro", source: "arc")
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => zone,
                   "effect" => { "source" => source, "event" => "on_enter_field", "entering" => source } })
  end

  def test_move_sends_opposing_entity_to_retire
    engine = mover([["b1", "HUMAN"]])
    verdict = send_to_zone(engine, "b1")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    assert_equal "ritiro", engine.instance_variable_get(:@table).card("b1")[:zone]
  end

  def test_effect_is_consumed_once
    engine = mover([["b1", "HUMAN"], ["b2", "HUMAN"]])
    assert send_to_zone(engine, "b1")[:ok]
    verdict = send_to_zone(engine, "b2")
    refute verdict[:ok]
    assert_match(/già stato risolto/, verdict[:reason])
  end

  def test_target_must_be_opposing_entity_on_field
    engine = mover([["b1", "STONE"]])
    refute send_to_zone(engine, "b1")[:ok], "una Materia no"
    engine = mover([])
    refute send_to_zone(engine, "arc")[:ok], "una propria carta no"
  end

  def test_trigger_only_in_entry_turn
    engine = mover([["b1", "HUMAN"]])
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    verdict = send_to_zone(engine, "b1")
    refute verdict[:ok]
    assert_match(/non è entrata sul Fronte questo turno/, verdict[:reason])
  end

  def test_zone_must_match_form
    engine = mover([["b1", "HUMAN"]])
    refute send_to_zone(engine, "b1", zone: "abisso")[:ok], "nell'Abisso non è la forma dello spostamento"
  end

  # --- §8.2: l'esilio condizionato all'ingresso — un'Entità avversaria nell'Abisso
  #     finché chi entra resta in campo; quando lascia il campo, torna in gioco.

  EXILERS = {
    "SHOOTER" => { type: "entity", keywords: [], race: "human",
                    enter_moves: [{ target: { type: "entity", controller: "opponent" }, to: "abisso", hold: true }] },
    "HUMAN" => { type: "entity", keywords: [], race: "human" },
    "STONE" => { type: "matter", keywords: [], behavior: "normal" },
  }.freeze

  def shooter(b_field)
    engine = Rubyfront::Engine.new(cards: EXILERS)
    a = [{ "uid" => "tir", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "SHOOTER" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    b = b_field.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "b", "zone" => "field", "order" => i, "cardId" => id, "y" => 172 } }
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => b })
    engine.judge({ "t" => "toZone", "uid" => "tir", "zone" => "field", "x" => 442, "y" => 1260 })
    engine
  end

  def exile(engine, uid, zone: "abisso", held_by: "tir")
    action = { "t" => "toZone", "uid" => uid, "zone" => zone,
               "effect" => { "source" => "tir", "event" => "on_enter_field", "entering" => "tir" } }
    action["heldBy"] = held_by if held_by
    engine.judge(action)
  end

  def test_enter_exile_sends_opposing_entity_to_abyss_held
    engine = shooter([["b1", "HUMAN"]])
    verdict = exile(engine, "b1")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    card = engine.instance_variable_get(:@table).card("b1")
    assert_equal "abisso", card[:zone]
    assert_equal "tir", card[:held_by]
  end

  def test_enter_exile_needs_entering_card_as_holder
    engine = shooter([["b1", "HUMAN"]])
    verdict = exile(engine, "b1", held_by: nil)
    refute verdict[:ok]
    assert_match(/tenuta da chi entra/, verdict[:reason])
    assert_includes verdict[:reason_en], "(§8.2)"
    refute exile(engine, "b1", held_by: "b1")[:ok], "tenuta da un altro no"
    refute exile(engine, "b1", zone: "ritiro")[:ok], "il Ritiro non è la forma"
  end

  def test_enter_exile_needs_opposing_entity_on_field
    engine = shooter([["b1", "STONE"]])
    refute exile(engine, "b1")[:ok], "una Materia no"
    engine = shooter([])
    refute exile(engine, "tir")[:ok], "una propria carta no"
  end

  def test_exiled_returns_only_when_holder_leaves_field
    engine = shooter([["b1", "HUMAN"]])
    assert exile(engine, "b1")[:ok]
    retained = engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "y" => 172 })
    refute retained[:ok]
    assert_match(/finché la carta che lo tiene è in gioco/, retained[:reason])
    # Chi tiene lascia il campo (il Ritiro, libero in Preparazione — §6.2):
    # nell'Abisso a mano non si va (§5).
    assert engine.judge({ "t" => "toZone", "uid" => "tir", "zone" => "ritiro" })[:ok]
    freed = engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "y" => 172 })
    assert freed[:ok], freed[:reason]
    card = engine.instance_variable_get(:@table).card("b1")
    assert_equal "field", card[:zone]
    assert_nil card[:held_by]
  end

  # --- §8.2: il ritorno riporta una permanente dalla Zona di Ritiro ----------

  HEIRS = {
    "RETURNER" => { type: "entity", keywords: [], race: "human",
                enter_returns: [{ from: "ritiro", filter: { permanent: true }, to: "field" }] },
    "PERMANENT" => { type: "matter", keywords: [], behavior: "permanent" },
    "NORMAL" => { type: "matter", keywords: [], behavior: "normal" },
    "HUMAN" => { type: "entity", keywords: [], race: "human" },
  }.freeze

  # A ha la fonte in mano e quelle carte in Zona di Ritiro; poi la fonte scende.
  # `campo` è quante Entità stanno già sul Fronte di A (per il Fronte pieno,
  # §6.2): la fonte compresa, che scende sempre per prima.
  def returner(retired, foe_retired: [], field_setup: 1)
    engine = Rubyfront::Engine.new(cards: HEIRS)
    a = [{ "uid" => "riportante", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "RETURNER" }]
    a += (2..field_setup).map { |i| { "uid" => "f#{i}", "owner" => "a", "zone" => "field", "order" => i, "cardId" => "HUMAN", "x" => Rubyfront::Engine::FRONT_SLOT_X[i - 1], "y" => 1260 } }
    a += retired.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "ritiro", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    b = foe_retired.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "b", "zone" => "ritiro", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => b })
    engine.judge({ "t" => "toZone", "uid" => "riportante", "zone" => "field", "x" => 442, "y" => 1260 })
    engine
  end

  def bring_back(engine, uid)
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => 2368, "y" => 1260,
                   "effect" => { "source" => "riportante", "event" => "on_enter_field", "entering" => "riportante" } })
  end

  def test_return_brings_permanent_back_to_front
    engine = returner([["p1", "PERMANENT"]])
    verdict = bring_back(engine, "p1")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    assert_equal "field", engine.instance_variable_get(:@table).card("p1")[:zone]
  end

  def test_permanent_is_entity_or_permanent_matter
    # «Una carta permanente» (§10) è quel che resta in campo: l'Entità e la
    # Materia permanente. Non la Materia normale, non le carte altrui.
    engine = returner([["n1", "NORMAL"], ["u1", "HUMAN"]], foe_retired: [["bp", "PERMANENT"]])
    refute bring_back(engine, "n1")[:ok], "una Materia normale no"
    verdict = bring_back(engine, "u1")
    assert verdict[:ok], "un'Entità sì: #{verdict[:reason]}"
    refute bring_back(engine, "bp")[:ok], "dalla Zona di Ritiro avversaria no"
  end

  # §6.2, Fronte pieno: «anche la parte d'effetto che metterebbe in campo non
  # si applica» — per le Entità; una Materia permanente non occupa slot (§5).
  def test_with_full_front_entity_does_not_return_matter_does
    engine = returner([["u1", "HUMAN"], ["p1", "PERMANENT"]], field_setup: 5)
    verdict = bring_back(engine, "u1")
    refute verdict[:ok]
    assert_match(/Fronte è pieno.*§6\.2/, verdict[:reason])
    assert_match(/Front is full.*§6\.2/, verdict[:reason_en])
    assert bring_back(engine, "p1")[:ok], "la Materia permanente sta dietro il Fronte"
  end

  def test_return_is_consumed_once
    engine = returner([["p1", "PERMANENT"], ["p2", "PERMANENT"]])
    assert bring_back(engine, "p1")[:ok]
    refute bring_back(engine, "p2")[:ok]
  end

  # --- §8.2: lo sguardo all'ingresso guarda le prime quattro -----------------

  SEEKERS = {
    "GLANCE" => { type: "entity", keywords: [], race: "human",
                     enter_looks: [{ count: 4, die: nil, count_base: 0, reveal: { type: "entity", race: "human" }, then_retire: false }] },
    "WATCHER" => { type: "entity", keywords: [], race: "auros",
                    enter_looks: [{ count: nil, die: 6, count_base: 2, reveal: { type: "object", race: nil }, then_retire: true }] },
    "GUARD" => { type: "entity", keywords: [], race: "auros",
                   enter_looks: [{ count: nil, die: 6, count_base: 0, reveal: { type: "object", race: nil }, then_retire: true, formula: "result" }] },
    "IRON" => { type: "object", keywords: [] },
    "HUMAN" => { type: "entity", keywords: [], race: "human" },
    "AUROS" => { type: "entity", keywords: [], race: "auros" },
    "STONE" => { type: "matter", keywords: [], behavior: "normal" },
  }.freeze

  # A ha la fonte in mano e quel mazzo (dalla cima); poi la fonte scende.
  def entry_glance(deck)
    engine = Rubyfront::Engine.new(cards: SEEKERS)
    cards = [{ "uid" => "cerc", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "GLANCE" }]
    cards += deck.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "deck", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "toZone", "uid" => "cerc", "zone" => "field", "x" => 442, "y" => 1260 })
    engine
  end

  def glance_action(engine, reveal: nil, count: 4, seat: "a")
    action = { "t" => "look", "seat" => seat, "count" => count,
               "effect" => { "source" => "cerc", "event" => "on_enter_field", "entering" => "cerc" } }
    action["reveal"] = reveal if reveal
    engine.judge(action)
  end

  def test_glance_shows_human_among_top_four
    engine = entry_glance([["d1", "STONE"], ["d2", "HUMAN"], ["d3", "AUROS"], ["d4", "STONE"], ["d5", "HUMAN"]])
    verdict = glance_action(engine, reveal: "d2")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    table = engine.instance_variable_get(:@table)
    assert_equal "hand", table.card("d2")[:zone]
    assert_equal %w[d5 d1 d3 d4], table.top_of_deck("a", 4)
  end

  def test_cannot_show_card_not_in_top_or_not_human
    engine = entry_glance([["d1", "STONE"], ["d2", "AUROS"], ["d3", "STONE"], ["d4", "STONE"], ["d5", "HUMAN"]])
    refute glance_action(engine, reveal: "d5")[:ok], "la quinta non si vede"
    refute glance_action(engine, reveal: "d2")[:ok], "un Auros non si mostra"
    refute glance_action(engine, count: 2)[:ok], "si guardano quattro carte"
    assert glance_action(engine)[:ok], "nessuna da mostrare: tutte in fondo"
    refute glance_action(engine)[:ok], "e l'innesco è consumato"
  end

  # --- §8.2: il controllo all'ingresso ----------------------------------------

  RALLIES = {
    "CONTROLLER" => { type: "entity", keywords: [], race: "human",
                      enter_controls: [{ target: { type: "entity", controller: "opponent", max_cost: 3 }, grants: ["surge"] }] },
    "LITTLE" => { type: "entity", keywords: [], race: "auros", flux_cost: 2 },
    "LARGE" => { type: "entity", keywords: [], race: "auros", flux_cost: 5 },
    "STONE" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 1 },
  }.freeze

  # A ha la fonte in mano, B quelle carte in campo; poi la fonte scende.
  def commander_setup(b_field)
    engine = Rubyfront::Engine.new(cards: RALLIES)
    a = [{ "uid" => "rad", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "CONTROLLER" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    b = b_field.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "b", "zone" => "field", "order" => i, "cardId" => id, "y" => 172 } }
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => b })
    engine.judge({ "t" => "toZone", "uid" => "rad", "zone" => "field", "x" => 442, "y" => 1260 })
    engine
  end

  def take_control(engine, uid, by: "a", grants: ["surge"])
    engine.judge({ "t" => "control", "uid" => uid, "by" => by, "grants" => grants,
                   "effect" => { "source" => "rad", "event" => "on_enter_field", "entering" => "rad" } })
  end

  def test_control_takes_cheap_entity
    engine = commander_setup([["b1", "LITTLE"]])
    verdict = take_control(engine, "b1")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    table = engine.instance_variable_get(:@table)
    assert_equal "a", table.controller_of(table.card("b1"))
  end

  def test_cannot_take_too_costly_or_matter
    engine = commander_setup([["b1", "LARGE"], ["b2", "STONE"]])
    refute take_control(engine, "b1")[:ok], "costa 5"
    refute take_control(engine, "b2")[:ok], "una Materia no"
    refute take_control(engine, "b1", grants: [])[:ok], "le concessioni sono quelle della carta"
  end

  def test_controlled_attacks_for_commander_with_surge
    engine = commander_setup([["b1", "LITTLE"]])
    take_control(engine, "b1")
    front!(engine)
    attack_decl = { "t" => "declare", "declaration" => { "id" => "x", "from" => "b1", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 } }
    verdict = engine.judge(attack_decl, actor: "a")
    assert verdict[:ok], verdict[:reason]
  end

  # §8.2 — «prendi il controllo … fino alla fine del turno»: te la comanda,
  # non te la dà. A mano non la si sposta fra le zone, nemmeno nella Zona di
  # Ritiro del proprietario. La restituzione ha la sua azione.
  def test_controlled_does_not_change_zones
    engine = commander_setup([["b1", "LITTLE"]])
    take_control(engine, "b1")
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
  MOVE_SET = { type: "entity", keywords: [], race: "auros", flux_cost: 2,
            enter_moves: [{ target: { type: "entity", controller: "opponent" }, to: "ritiro" }] }.freeze

  def test_control_does_not_reapply_enter_effect
    engine = Rubyfront::Engine.new(cards: RALLIES.merge("MOVE" => MOVE_SET))
    a = [{ "uid" => "rad", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "CONTROLLER" },
         { "uid" => "a1", "owner" => "a", "zone" => "field", "order" => 1, "cardId" => "LITTLE", "y" => 1260 }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => a })
    b = [{ "uid" => "b1", "owner" => "b", "zone" => "field", "order" => 0, "cardId" => "MOVE", "y" => 172 },
         { "uid" => "b2", "owner" => "b", "zone" => "field", "order" => 1, "cardId" => "LITTLE", "y" => 172 }]
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test", "cards" => b })
    # Le carte di B sono entrate al turno 1; il controllo arriva al turno 3.
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" }, actor: "a")
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" }, actor: "b")
    assert engine.judge({ "t" => "toZone", "uid" => "rad", "zone" => "field", "x" => 442, "y" => 1260 }, actor: "a")[:ok]
    assert take_control(engine, "b1")[:ok]
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

  def test_release_only_at_end_of_turn_and_only_controlled
    engine = commander_setup([["b1", "LITTLE"], ["b2", "LITTLE"]])
    take_control(engine, "b1")
    refute engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "x" => 442, "y" => 172 }, actor: "a")[:ok], "non prima della fine del turno"
    refute engine.judge({ "t" => "release", "uid" => "b2", "zone" => "field" }, actor: "a")[:ok], "b2 non è controllata"
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" }, actor: "a")
    verdict = engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "x" => 442, "y" => 172 }, actor: "a")
    assert verdict[:ok], verdict[:reason]
    table = engine.instance_variable_get(:@table)
    assert_equal "b", table.controller_of(table.card("b1"))
  end

  # --- §8.2: lo sguardo col dado all'ingresso ---------------------------------

  def watcher(deck)
    engine = Rubyfront::Engine.new(cards: SEEKERS)
    cards = [{ "uid" => "art", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "WATCHER" }]
    cards += deck.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "deck", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "toZone", "uid" => "art", "zone" => "field", "x" => 442, "y" => 1260 })
    engine
  end

  def roll_and_look(engine, roll:, count:, reveal: nil, retire: nil)
    action = { "t" => "look", "seat" => "a", "count" => count, "roll" => roll,
               "effect" => { "source" => "art", "event" => "on_enter_field", "entering" => "art" } }
    action["reveal"] = reveal if reveal
    action["retire"] = retire if retire
    engine.judge(action)
  end

  def test_die_glance_looks_two_plus_half_roll
    engine = watcher([["d1", "STONE"], ["d2", "IRON"], ["d3", "STONE"], ["d4", "STONE"], ["d5", "STONE"], ["d6", "STONE"]])
    # tiro 3 → 2 + ceil(3/2) = 4 carte
    verdict = roll_and_look(engine, roll: 3, count: 4, reveal: "d2", retire: "d1")
    assert verdict[:ok], verdict[:reason]
    table = engine.instance_variable_get(:@table)
    assert_equal "hand", table.card("d2")[:zone]
    assert_equal "ritiro", table.card("d1")[:zone]
    assert_equal %w[d5 d6 d3 d4], table.top_of_deck("a", 4), "le altre in fondo"
  end

  # Dal 2026-09-10: «tira un d6 e guarda tante carte quanto il tiro».
  def test_die_glance_can_look_as_many_as_roll
    engine = Rubyfront::Engine.new(cards: SEEKERS)
    cards = [{ "uid" => "art", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "GUARD" }]
    cards += [["d1", "STONE"], ["d2", "IRON"], ["d3", "STONE"], ["d4", "STONE"], ["d5", "STONE"], ["d6", "STONE"]].map.with_index { |(uid, id), i| { "uid" => uid, "owner" => "a", "zone" => "deck", "order" => i, "cardId" => id } }
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "toZone", "uid" => "art", "zone" => "field", "x" => 442, "y" => 1260 })
    refute roll_and_look(engine, roll: 3, count: 4, reveal: "d2", retire: "d1")[:ok], "con un 3 si guardano 3 carte, non 4"
    verdict = roll_and_look(engine, roll: 3, count: 3, reveal: "d2", retire: "d1")
    assert verdict[:ok], verdict[:reason]
    assert_equal "hand", table_copy(engine).card("d2")[:zone]
  end

  def test_count_follows_roll_and_retire_is_mandatory
    engine = watcher([["d1", "STONE"], ["d2", "IRON"], ["d3", "STONE"], ["d4", "STONE"], ["d5", "STONE"]])
    refute roll_and_look(engine, roll: 3, count: 5)[:ok], "con un 3 si guardano 4 carte"
    refute roll_and_look(engine, roll: 7, count: 6)[:ok], "un tiro fuori dal dado"
    refute roll_and_look(engine, roll: 1, count: 3, reveal: "d2")[:ok], "una delle altre va in Ritiro"
    refute roll_and_look(engine, roll: 1, count: 3, reveal: "d2", retire: "d5")[:ok], "la quinta non è fra le guardate"
    refute roll_and_look(engine, roll: 1, count: 3, reveal: "d1", retire: "d2")[:ok], "si mostra solo un Oggetto"
    assert roll_and_look(engine, roll: 1, count: 3, retire: "d1")[:ok], "nessun Oggetto mostrato, una in Ritiro"
  end

  # --- §8.2: «quando attacca», lo stesso ritorno all'attacco -----------------

  HEIRS_ON_ATTACK = HEIRS.merge(
    "RETURNER" => HEIRS["RETURNER"].merge(attack_returns: HEIRS["RETURNER"][:enter_returns])
  ).freeze

  # La fonte in campo dal turno 1, una permanente in Zona di Ritiro; al turno 3
  # A apre il Fronte e la fonte attacca.
  def charging_returner
    engine = Rubyfront::Engine.new(cards: HEIRS_ON_ATTACK)
    cards = [{ "uid" => "riportante", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "RETURNER", "y" => 1260 },
             { "uid" => "p1", "owner" => "a", "zone" => "ritiro", "order" => 0, "cardId" => "PERMANENT" }]
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    engine
  end

  def return_on_attack(engine)
    engine.judge({ "t" => "toZone", "uid" => "p1", "zone" => "field", "x" => 2368, "y" => 1260,
                   "effect" => { "source" => "riportante", "event" => "on_attack", "entering" => "riportante" } })
  end

  def test_when_source_attacks_brings_back_permanent
    engine = charging_returner
    front!(engine)
    assert engine.judge(attack_decl("riportante"))[:ok]
    verdict = return_on_attack(engine)
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    refute return_on_attack(engine)[:ok], "una volta per attacco"
  end

  def test_without_declared_attack_no_trigger
    engine = charging_returner
    verdict = return_on_attack(engine)
    refute verdict[:ok]
    assert_match(/vuole un attacco dichiarato/, verdict[:reason])
    front!(engine)
    refute return_on_attack(engine)[:ok], "il Fronte da solo non basta"
  end

  # --- §8.2: «quando attacca con un Oggetto, pesca, poi scarta» --------------

  SCOUTING = {
    "DRAWER" => { type: "entity", keywords: [], race: "auros",
                       attack_draws: [{ draw: 1, then_discard: 1, requires_object: true }] },
    "IRON" => { type: "object", keywords: [] },
    "HUMAN" => { type: "entity", keywords: [], race: "human" },
  }.freeze

  # L'Esploratore in campo dal turno 1, con (o senza) il Ferro addosso, una
  # carta in mano e una nel mazzo; al turno 3 A apre il Fronte e attacca.
  def attack_drawer(armed: true)
    engine = Rubyfront::Engine.new(cards: SCOUTING)
    cards = [{ "uid" => "esp", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "DRAWER", "y" => 1260 },
             { "uid" => "h1", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "HUMAN" },
             { "uid" => "d1", "owner" => "a", "zone" => "deck", "order" => 0, "cardId" => "HUMAN" },
             { "uid" => "d2", "owner" => "a", "zone" => "deck", "order" => 1, "cardId" => "HUMAN" }]
    cards << { "uid" => "ferro", "owner" => "a", "zone" => "field", "order" => 1, "cardId" => "IRON", "assignedTo" => "esp" } if armed
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test", "cards" => cards })
    engine.judge({ "t" => "loadDeck", "seat" => "b", "deckId" => "test",
                   "cards" => [{ "uid" => "bh", "owner" => "b", "zone" => "hand", "order" => 0, "cardId" => "HUMAN" }] })
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    engine
  end

  def draw_on_attack(engine, seat: "a", count: 1)
    engine.judge({ "t" => "draw", "seat" => seat, "count" => count,
                   "effect" => { "source" => "esp", "event" => "on_attack", "entering" => "esp" } })
  end

  def discard_on_attack(engine, uid)
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "ritiro",
                   "effect" => { "source" => "esp", "event" => "on_attack", "entering" => "esp", "follow" => "discard" } })
  end

  def test_armed_attack_drawer_draws_on_attack
    engine = attack_drawer
    front!(engine)
    assert engine.judge(attack_decl("esp"))[:ok]
    verdict = draw_on_attack(engine)
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    refute draw_on_attack(engine)[:ok], "una volta per attacco"
  end

  def test_attack_that_drew_cannot_be_undone
    engine = attack_drawer
    front!(engine)
    assert engine.judge(attack_decl("esp"))[:ok]
    refute engine.judge({ "t" => "undeclare", "from" => "esp" })[:ruled], "prima dell'innesco l'annullamento è libero"
    assert engine.judge(attack_decl("esp"))[:ok]
    assert draw_on_attack(engine)[:ok]
    verdict = engine.judge({ "t" => "undeclare", "from" => "esp" })
    refute verdict[:ok]
    assert_match(/già innescato i suoi effetti.*§8\.2/, verdict[:reason])
    assert_match(/already triggered its effects.*§8\.2/, verdict[:reason_en])
    assert table_copy(engine).attacking?("esp"), "la dichiarazione resta"
  end

  def test_without_item_trigger_does_not_fire
    engine = attack_drawer(armed: false)
    front!(engine)
    engine.judge(attack_decl("esp"))
    verdict = draw_on_attack(engine)
    refute verdict[:ok]
    assert_match(/senza Oggetto/, verdict[:reason])
  end

  def test_without_declared_attack_no_draw
    engine = attack_drawer
    refute draw_on_attack(engine)[:ok]
    front!(engine)
    verdict = draw_on_attack(engine)
    refute verdict[:ok]
    assert_match(/vuole un attacco dichiarato/, verdict[:reason])
  end

  def test_draw_belongs_to_commander_and_form_count
    engine = attack_drawer
    front!(engine)
    engine.judge(attack_decl("esp"))
    assert_match(/chi comanda/, draw_on_attack(engine, seat: "b")[:reason])
    assert_match(/certificato/, draw_on_attack(engine, count: 2)[:reason])
  end

  def test_discard_follows_draw_once
    engine = attack_drawer
    front!(engine)
    engine.judge(attack_decl("esp"))
    first_try = discard_on_attack(engine, "h1")
    refute first_try[:ok]
    assert_match(/prima si pesca/, first_try[:reason])
    assert draw_on_attack(engine)[:ok]
    verdict = discard_on_attack(engine, "h1")
    assert verdict[:ok], verdict[:reason]
    assert_equal "ritiro", engine.instance_variable_get(:@table).card("h1")[:zone], "lo scarto va in Zona di Ritiro (§5, §6.5)"
    again = discard_on_attack(engine, "d1")
    refute again[:ok]
    assert_match(/già stato fatto/, again[:reason])
  end

  def test_discard_from_own_hand
    engine = attack_drawer
    front!(engine)
    engine.judge(attack_decl("esp"))
    assert draw_on_attack(engine)[:ok]
    table_setup = engine.instance_variable_get(:@table)
    in_deck = %w[d1 d2].find { |uid| table_setup.card(uid)[:zone] == "deck" }
    assert_match(/propria mano/, discard_on_attack(engine, in_deck)[:reason], "è ancora nel mazzo")
    assert_match(/propria mano/, discard_on_attack(engine, "bh")[:reason], "bh è in mano a B")
  end

  def test_attack_draw_of_unknown_card_is_silent
    engine = Rubyfront::Engine.new(cards: SCOUTING)
    engine.judge({ "t" => "loadDeck", "seat" => "a", "deckId" => "test",
                   "cards" => [{ "uid" => "esp", "owner" => "a", "zone" => "field", "order" => 0, "cardId" => "UNKNOWN", "y" => 1260 }] })
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    front!(engine)
    engine.judge(attack_decl("esp"))
    refute draw_on_attack(engine)[:ruled]
  end

  # --- §8.2: le altre forme «quando attacca» ---------------------------------
  #
  # Le forme come le legge l'anagrafe dalle carte vere (card_index_test le
  # prova sui file): qui si prova la dogana, scenario per scenario.

  ARMED_SET = {
    "WARDEN" => { type: "entity", keywords: [], race: "human", power: 3, counterattack: 1,
                  attack_forms: [{ kind: "untap", who: "self", once: true, requires_object: true, face: 0 }] },
    "COMMAND" => { type: "entity", keywords: ["surge"], race: "auros", power: 3,
                   attack_forms: [{ kind: "empower", who: "self", requires_object: true, targets: "others_armed", power: 1, face: 0 }] },
    "REAGENT" => { type: "object", keywords: [],
                 attack_forms: [{ kind: "empower", who: "object", targets: "bearer", power: 1, face: 0 },
                                { kind: "look", count: 4, reveal: { type: "matter", race: nil }, reveal_to: "hand", rest_to: "ritiro", who: "object", die: 6, on_roll: [5, 6], face: 0 }] },
    "QUARTERMASTER" => { type: "entity", keywords: [], race: "auros", power: 5,
                   attack_forms: [{ kind: "rearm", who: "ally", attacker_armed: true, face: 0 },
                                  { kind: "look", count: 2, reveal: { type: "object", race: nil }, reveal_to: "ritiro", rest_to: "deck", who: "ally", attacker_armed: true, once: true, die: nil, face: 0 }] },
    "HEALER" => { type: "entity", keywords: [], race: "human", power: 2,
                     attack_forms: [{ kind: "heal", who: "self", amount: 2, die: 6, on_roll: [5, 6], then_recall: { type: "entity" }, face: 0 }] },
    "ECO" => { type: "entity", keywords: [], race: "human", power: 3,
               attack_forms: [{ kind: "return", who: "self", die: 6, on_roll: [5, 6], filter: { type: "entity", race: "human" }, joins: true, face: 0 }] },
    "CHARGE" => { type: "entity", keywords: [], race: "human", power: 5, counterattack: 1,
                  enter_refreshes: [{ die: 20, on_roll: [15, 20] }], static_forms: [{ kind: "never_taps" }] },
    "HEIRS" => { type: "matter", keywords: [], behavior: "permanent",
                 attack_forms: [{ kind: "heal", who: "permanent", attackers: { type: "entity", race: "human" }, die: 20, gain_on: [1, 6], drain_on: [15, 20], amount: "human_attackers", once: true, face: 0 }] },
    "RALLY" => { type: "rubyfront", keywords: ["fury"],
                    attack_forms: [{ kind: "heal", who: "rubyfront", once: true, requires_attackers: { count: 3, race: "human" }, amount: 2, then_draw: 0, then_discard: 0, face: 0 },
                                   { kind: "heal", who: "rubyfront", once: true, requires_attackers: { count: 3, race: "human" }, amount: 2, then_draw: 1, then_discard: 1, face: 1 }] },
    "AVENGER" => { type: "entity", keywords: [], race: "human", power: 2,
                       attack_forms: [{ kind: "empower", who: "self", once: true, targets: "next_human_attacker", grants: ["revenge"], face: 0 }] },
    "RAID" => { type: "entity", keywords: [], race: "human", power: 2, counterattack: 1,
                  attack_forms: [{ kind: "empower", who: "self", requires_previous_attackers: { count: 2, race: "human" }, targets: "opposing_entity", restrict: "block", face: 0 }] },
    # Il divieto di blocco «se almeno 2 Umani che controlli attaccano» (questo turno, la fonte compresa).
    "ASSAULT" => { type: "entity", keywords: [], race: "human", power: 2,
                   attack_forms: [{ kind: "empower", who: "self", requires_attackers: { count: 2, race: "human" }, targets: "opposing_entity", restrict: "block", face: 0 }] },
    "HUMAN" => { type: "entity", keywords: [], race: "human", power: 2 },
    "AUROS" => { type: "entity", keywords: [], race: "auros", power: 2 },
    "IRON" => { type: "object", keywords: [] },
    "MATTER" => { type: "matter", keywords: [], behavior: "normal" },
  }.freeze

  # Un tavolo per gli attacchi: le carte di A (con la loro zona e i loro
  # extra) e di B scese al turno 1, poi turno 3 di A in Fase di Fronte,
  # con gli attacchi dichiarati nell'ordine dato.
  def setup_scene(a, b: [], attacks: [])
    engine = Rubyfront::Engine.new(cards: ARMED_SET)
    load = lambda do |seat, list|
      cards = list.map.with_index do |(uid, id, extra), i|
        { "uid" => uid, "owner" => seat, "zone" => "field", "order" => i, "cardId" => id, "y" => seat == "a" ? 1260 : 172 }.merge(extra || {})
      end
      engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    end
    load.call("a", a)
    load.call("b", b + [["rf-b", "RALLY", { "y" => 172 }]])
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    front!(engine)
    attacks.each_with_index do |uid, i|
      verdict = engine.judge({ "t" => "declare", "declaration" => { "id" => uid, "from" => uid, "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => i + 1 } })
      raise "attacco rifiutato: #{verdict[:reason]}" unless verdict[:ok]
    end
    engine
  end

  def table_copy(engine)
    engine.instance_variable_get(:@table)
  end

  def ref(source, entering = source, **extra)
    { "source" => source, "event" => "on_attack", "entering" => entering }.merge(extra.transform_keys(&:to_s))
  end

  # «Stappala dopo il combattimento».
  def test_armed_warden_untaps_after_combat
    engine = setup_scene([["v", "WARDEN"], ["f", "IRON", { "assignedTo" => "v" }]], attacks: ["v"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    verdict = engine.judge({ "t" => "resolve", "seat" => "a", "battles" => [battle_entry("v", damage: 3)], "untap" => ["v"] })
    assert verdict[:ok], verdict[:reason]
    refute table_copy(engine).card("v")[:tapped]
  end

  def test_without_item_or_attack_no_untap
    engine = setup_scene([["v", "WARDEN"], ["u", "HUMAN"]], attacks: ["v"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    disarmed = engine.judge({ "t" => "resolve", "seat" => "a", "battles" => [battle_entry("v", damage: 3)], "untap" => ["v"] })
    assert_match(/senza Oggetto/, disarmed[:reason])
    halted = engine.judge({ "t" => "resolve", "seat" => "a", "battles" => [battle_entry("v", damage: 3)], "untap" => ["u"] })
    assert_match(/chi ha attaccato/, halted[:reason])
  end

  # «Le altre Entità con un Oggetto assegnato che controlli prendono +1».
  def test_command_empowers_other_armed
    engine = setup_scene([["c", "COMMAND"], ["f1", "IRON", { "assignedTo" => "c" }], ["u", "HUMAN"], ["f2", "IRON", { "assignedTo" => "u" }], ["n", "AUROS"]], attacks: ["c"])
    verdict = engine.judge({ "t" => "empower", "uid" => "u", "power" => 1, "effect" => ref("c") })
    assert verdict[:ok], verdict[:reason]
    assert_equal 1, table_copy(engine).card("u")[:power_bonus]
    assert_match(/già stato risolto/, engine.judge({ "t" => "empower", "uid" => "u", "power" => 1, "effect" => ref("c") })[:reason])
    assert_match(/ALTRE Entità/, engine.judge({ "t" => "empower", "uid" => "n", "power" => 1, "effect" => ref("c") })[:reason], "senza Oggetto")
    assert_match(/ALTRE Entità/, engine.judge({ "t" => "empower", "uid" => "c", "power" => 1, "effect" => ref("c") })[:reason], "non se stessa")
  end

  def test_unarmed_command_does_not_empower
    engine = setup_scene([["c", "COMMAND"], ["u", "HUMAN"], ["f2", "IRON", { "assignedTo" => "u" }]], attacks: ["c"])
    assert_match(/senza Oggetto/, engine.judge({ "t" => "empower", "uid" => "u", "power" => 1, "effect" => ref("c") })[:reason])
  end

  # L'Oggetto che potenzia chi lo porta, poi lo sguardo col dado.
  def test_catalyst_empowers_bearer_then_looks_with_die
    engine = setup_scene([["u", "HUMAN"], ["s", "REAGENT", { "assignedTo" => "u" }], ["pescata", "HUMAN", { "zone" => "deck" }], ["d1", "MATTER", { "zone" => "deck" }], ["d2", "HUMAN", { "zone" => "deck" }],
                    ["d3", "HUMAN", { "zone" => "deck" }], ["d4", "HUMAN", { "zone" => "deck" }]], attacks: ["u"])
    verdict = engine.judge({ "t" => "empower", "uid" => "u", "power" => 1, "effect" => ref("s", "u") })
    assert verdict[:ok], verdict[:reason]
    assert_match(/chi porta l'Oggetto/, engine.judge({ "t" => "empower", "uid" => "s", "power" => 1, "effect" => ref("s", "u") })[:reason])
    glance = { "t" => "look", "seat" => "a", "count" => 4, "revealTo" => "hand", "restTo" => "ritiro", "effect" => ref("s", "u", follow: "look") }
    assert_match(/non si guarda/, engine.judge(glance.merge("roll" => 3))[:reason])
    assert_match(/prime 4 carte/, engine.judge(glance.merge("roll" => 5, "count" => 3))[:reason])
    assert_match(/mostrare solo una Materia/, engine.judge(glance.merge("roll" => 5, "reveal" => "d2"))[:reason])
    ok = engine.judge(glance.merge("roll" => 6, "reveal" => "d1"))
    assert ok[:ok], ok[:reason]
    table_setup = table_copy(engine)
    assert_equal "hand", table_setup.card("d1")[:zone]
    assert_equal "ritiro", table_setup.card("d2")[:zone], "le altre nella Zona di Ritiro"
  end

  def test_item_not_on_attacker_is_silent
    engine = setup_scene([["u", "HUMAN"], ["n", "AUROS"], ["s", "REAGENT", { "assignedTo" => "n" }]], attacks: ["u"])
    assert_match(/addosso a chi attacca/, engine.judge({ "t" => "empower", "uid" => "u", "power" => 1, "effect" => ref("s", "u") })[:reason])
  end

  # Il riarmo: un Oggetto dal Ritiro a chi attacca armato, e lo sguardo una volta per turno.
  def test_quartermaster_rearms_armed_attacker_and_looks_once
    engine = setup_scene([["q", "QUARTERMASTER"], ["u", "HUMAN"], ["f", "IRON", { "assignedTo" => "u" }], ["f2", "IRON", { "zone" => "ritiro" }],
                    ["n", "AUROS"], ["f3", "IRON", { "assignedTo" => "n" }], ["pescata", "HUMAN", { "zone" => "deck" }], ["d1", "IRON", { "zone" => "deck" }], ["d2", "HUMAN", { "zone" => "deck" }]],
                   attacks: %w[u n])
    rearming = { "t" => "toZone", "uid" => "f2", "zone" => "field", "y" => 1260, "assignTo" => "u", "effect" => ref("q", "u") }
    assert_match(/senza pagarne/, engine.judge(rearming.merge("cost" => 2))[:reason])
    verdict = engine.judge(rearming)
    assert verdict[:ok], verdict[:reason]
    assert_equal "u", table_copy(engine).card("f2")[:assigned_to]
    glance = { "t" => "look", "seat" => "a", "count" => 2, "revealTo" => "ritiro", "restTo" => "deck", "reveal" => "d1", "effect" => ref("q", "u", once: true) }
    assert_match(/una volta per turno/, engine.judge(glance.merge("effect" => ref("q", "u")))[:reason], "il riferimento deve dire once")
    ok = engine.judge(glance)
    assert ok[:ok], ok[:reason]
    assert_equal "ritiro", table_copy(engine).card("d1")[:zone]
    assert_match(/già stato risolto/, engine.judge(glance.merge("effect" => ref("q", "n", once: true), "reveal" => nil))[:reason], "una volta per turno, per qualunque attaccante")
  end

  def test_quartermaster_skips_unarmed_attacker
    engine = setup_scene([["q", "QUARTERMASTER"], ["u", "HUMAN"], ["f2", "IRON", { "zone" => "ritiro" }]], attacks: ["u"])
    verdict = engine.judge({ "t" => "toZone", "uid" => "f2", "zone" => "field", "y" => 1260, "assignTo" => "u", "effect" => ref("q", "u") })
    assert_match(/Entità con un Oggetto assegnato/, verdict[:reason])
  end

  # La cura: +2 PV, poi col dado un'Entità dal Ritiro in mano.
  def test_healer_heals_and_returns_to_hand_with_die
    engine = setup_scene([["g", "HEALER"], ["r", "HUMAN", { "zone" => "ritiro" }]], attacks: ["g"])
    recall_setup = { "t" => "toZone", "uid" => "r", "zone" => "hand", "roll" => 6, "effect" => ref("g", follow: "recall") }
    assert_match(/prima i PV/, engine.judge(recall_setup)[:reason])
    assert_match(/2 PV/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 25 }, "effect" => ref("g") })[:reason])
    healing = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("g") })
    assert healing[:ok], healing[:reason]
    assert_equal 22, table_copy(engine).hp("a")
    assert_match(/non si riporta nulla/, engine.judge(recall_setup.merge("roll" => 2))[:reason])
    ok = engine.judge(recall_setup)
    assert ok[:ok], ok[:reason]
    assert_equal "hand", table_copy(engine).card("r")[:zone]
    assert_match(/già stato risolto/, engine.judge(recall_setup)[:reason])
  end

  # Il ritorno: col dado un'Entità Umana dal Ritiro sul Fronte, che attacca insieme.
  def test_echo_brings_back_human_attacking_together
    engine = setup_scene([["e", "ECO"], ["r", "HUMAN", { "zone" => "ritiro" }], ["x", "AUROS", { "zone" => "ritiro" }]], attacks: ["e"])
    comeback = { "t" => "toZone", "uid" => "r", "zone" => "field", "x" => 2368, "y" => 1260, "roll" => 5, "effect" => ref("e") }
    assert_match(/nessuno torna/, engine.judge(comeback.merge("roll" => 4))[:reason])
    assert_match(/Entità Umana/, engine.judge(comeback.merge("uid" => "x"))[:reason])
    ok = engine.judge(comeback)
    assert ok[:ok], ok[:reason]
    together = { "t" => "declare", "declaration" => { "id" => "r", "from" => "r", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 2 },
                "effect" => ref("e", "r", follow: "join") }
    without = engine.judge(together.reject { |key, _| key == "effect" })
    assert_match(/attesa di evocazione/, without[:reason], "senza riferimento aspetta")
    verdict = engine.judge(together)
    assert verdict[:ok], verdict[:reason]
    assert table_copy(engine).attacking?("r")
  end

  # «Questa Entità non si tappa mai»: il gesto di tapparla è fermato, stapparla passa.
  def test_charge_never_taps
    engine = setup_scene([["c", "CHARGE"], ["u", "HUMAN"]], attacks: ["c"])
    verdict = engine.judge({ "t" => "tap", "uid" => "c", "tapped" => true })
    refute verdict[:ok]
    assert_match(/non si tappa mai/, verdict[:reason])
    refute table_copy(engine).card("c")[:tapped], "attacca e resta stappata"
    assert engine.judge({ "t" => "tap", "uid" => "c", "tapped" => false })[:ok]
    assert engine.judge({ "t" => "tap", "uid" => "u", "tapped" => true })[:ok], "le altre si tappano"
    refute engine.judge({ "t" => "tap", "uid" => "zz", "tapped" => true })[:ruled], "carta ignota: silenzio"
  end

  # La stappata all'ingresso: un d20, con 15–20 stappa tutte le proprie Entità.
  def test_charge_on_entry_with_roll_untaps_all
    engine = setup_scene([["c", "CHARGE", { "zone" => "hand" }], ["u", "HUMAN", { "tapped" => true }]])
    step_in = { "source" => "c", "event" => "on_enter_field", "entering" => "c" }
    assert_match(/non è in campo/, engine.judge({ "t" => "refresh", "seat" => "a", "roll" => 17, "untap" => true, "effect" => step_in })[:reason], "dalla mano non innesca")
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 5, "active" => "a" })
    engine.observe({ "t" => "tap", "uid" => "u", "tapped" => true })
    assert engine.judge({ "t" => "toZone", "uid" => "c", "zone" => "field", "x" => 1578, "y" => 1260, "cost" => 5 })[:ok], "la fonte scende in Preparazione"
    assert_match(/solo con 15–20/, engine.judge({ "t" => "refresh", "seat" => "a", "roll" => 3, "untap" => true, "effect" => step_in })[:reason])
    assert_match(/solo con 15–20/, engine.judge({ "t" => "refresh", "seat" => "a", "roll" => 17, "untap" => false, "effect" => step_in })[:reason])
    assert_match(/innesco d'ingresso/, engine.judge({ "t" => "refresh", "seat" => "a", "roll" => 17, "untap" => true, "effect" => ref("c") })[:reason])
    assert_match(/chi comanda la fonte/, engine.judge({ "t" => "refresh", "seat" => "b", "roll" => 17, "untap" => true, "effect" => step_in })[:reason])
    verdict = engine.judge({ "t" => "refresh", "seat" => "a", "roll" => 17, "untap" => true, "effect" => step_in })
    assert verdict[:ok], verdict[:reason]
    refute table_copy(engine).card("u")[:tapped]
    assert_match(/già stato risolto/, engine.judge({ "t" => "refresh", "seat" => "a", "roll" => 17, "untap" => true, "effect" => step_in })[:reason])
    missed = setup_scene([["c", "CHARGE", { "zone" => "hand" }], ["u", "HUMAN", { "tapped" => true }]])
    missed.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    missed.judge({ "t" => "turn", "turn" => 5, "active" => "a" })
    missed.observe({ "t" => "tap", "uid" => "u", "tapped" => true })
    assert missed.judge({ "t" => "toZone", "uid" => "c", "zone" => "field", "x" => 1578, "y" => 1260, "cost" => 5 })[:ok]
    assert missed.judge({ "t" => "refresh", "seat" => "a", "roll" => 3, "untap" => false, "effect" => step_in })[:ok], "il tiro mancato passa e consuma l'innesco"
    assert table_copy(missed).card("u")[:tapped], "col tiro mancato nessuno si stappa"
    assert_match(/già stato risolto/, missed.judge({ "t" => "refresh", "seat" => "a", "roll" => 17, "untap" => true, "effect" => step_in })[:reason])
  end

  # La Materia permanente: il d20 quando attaccano gli Umani.
  def test_heirs_with_d20_heal_or_drain_once_per_turn
    engine = setup_scene([["m", "HEIRS"], ["u1", "HUMAN"], ["u2", "HUMAN"], ["n", "AUROS"]], attacks: %w[u1 u2 n])
    assert_match(/non succede nulla/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "roll" => 10, "effect" => ref("m", "u1", once: true) })[:reason])
    assert_match(/Entità Umane che controlli/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "roll" => 4, "effect" => ref("m", "n", once: true) })[:reason])
    assert_match(/una volta per turno/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "roll" => 4, "effect" => ref("m", "u1") })[:reason], "il riferimento deve dire «una volta»")
    healing = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "roll" => 4, "effect" => ref("m", "u1", once: true) })
    assert healing[:ok], healing[:reason]
    # L'ondata è una: col secondo Umano l'innesco è già scattato (deciso 2026-09-10).
    assert_match(/già stato risolto/, engine.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => 18 }, "roll" => 18, "effect" => ref("m", "u2", once: true) })[:reason])
    # Il prosciugamento, su un tavolo nuovo.
    engine = setup_scene([["m", "HEIRS"], ["u1", "HUMAN"], ["u2", "HUMAN"]], attacks: %w[u1 u2])
    assert_match(/perde 2 PV/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 24 }, "roll" => 18, "effect" => ref("m", "u2", once: true) })[:reason])
    hit = engine.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => 18 }, "roll" => 18, "effect" => ref("m", "u2", once: true) })
    assert hit[:ok], hit[:reason]
    assert_equal 18, table_copy(engine).hp("b")
  end

  # Il raduno: al terzo Umano, +2 PV una volta per turno; il Nexus poi pesca e scarta.
  # Il Rubyfront è SCHIERATO (fila del Fronte, 1260): in Zona di Richiamo
  # (1756) non avrebbe abilità (§3.1, test più sotto).
  def test_rally_at_third_human_once_per_turn
    engine = setup_scene([["rf", "RALLY", { "y" => 1260 }], ["u1", "HUMAN"], ["u2", "HUMAN"], ["u3", "HUMAN"]], attacks: %w[u1 u2])
    assert_match(/almeno 3 Entità Umane/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u2", once: true) })[:reason])
    engine.judge({ "t" => "declare", "declaration" => { "id" => "u3", "from" => "u3", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 3 } })
    verdict = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u3", once: true) })
    assert verdict[:ok], verdict[:reason]
    assert_match(/già stato risolto/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 24 }, "effect" => ref("rf", "u1", once: true) })[:reason])
    assert_match(/peschi dopo la cura/, engine.judge({ "t" => "draw", "seat" => "a", "count" => 1, "effect" => ref("rf", "u3", once: true, follow: "draw") })[:reason], "la faccia del Rubyfront non pesca")
  end

  def test_nexus_after_heal_draws_and_discards
    engine = setup_scene([["rf", "RALLY", { "y" => 1260, "face" => 1 }], ["u1", "HUMAN"], ["u2", "HUMAN"], ["u3", "HUMAN"],
                    ["h", "HUMAN", { "zone" => "hand" }], ["d", "HUMAN", { "zone" => "deck" }]], attacks: %w[u1 u2 u3])
    drawing = { "t" => "draw", "seat" => "a", "count" => 1, "effect" => ref("rf", "u3", once: true, follow: "draw") }
    assert_match(/prima i PV/, engine.judge(drawing)[:reason])
    assert engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u3", once: true) })[:ok]
    assert engine.judge(drawing)[:ok]
    assert_match(/già stato risolto/, engine.judge(drawing)[:reason])
    discarded = engine.judge({ "t" => "toZone", "uid" => "h", "zone" => "ritiro", "effect" => ref("rf", "u3", once: true, follow: "discard") })
    assert discarded[:ok], discarded[:reason]
    assert_equal "ritiro", table_copy(engine).card("h")[:zone]
  end

  # §3.1 — «abilità (principale e speciali) e Materie sono utilizzabili solo
  # quando è in campo: schierarlo serve a sbloccarle». In Zona di Richiamo
  # il Rubyfront si attacca, ma non innesca niente.
  def test_rubyfront_in_recall_zone_has_no_abilities
    engine = setup_scene([["rf", "RALLY", { "y" => 1756 }], ["u1", "HUMAN"], ["u2", "HUMAN"], ["u3", "HUMAN"]], attacks: %w[u1 u2 u3])
    verdict = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u3", once: true) })
    refute verdict[:ok]
    assert_match(/Zona di Richiamo non ha abilità.*§3\.1/, verdict[:reason])
    assert_match(/Recall Zone has no abilities.*§3\.1/, verdict[:reason_en])
    # Schierato — la fila del Fronte — la stessa cura passa.
    engine.observe({ "t" => "move", "uid" => "rf", "x" => 30, "y" => 1260, "z" => 3, "cost" => 0 })
    assert_equal 1260, table_copy(engine).card("rf")[:row]
    verdict = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u3", once: true) })
    assert verdict[:ok], verdict[:reason]
  end

  def test_unknown_rubyfront_row_does_not_accuse
    # Snapshot da una lavagna che non segnava la fila: nel dubbio è in gioco.
    engine = setup_scene([["rf", "RALLY", { "y" => nil }], ["u1", "HUMAN"], ["u2", "HUMAN"], ["u3", "HUMAN"]], attacks: %w[u1 u2 u3])
    assert_nil table_copy(engine).card("rf")[:row]
    verdict = engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 22 }, "effect" => ref("rf", "u3", once: true) })
    assert verdict[:ok], verdict[:reason]
  end

  # La Vendetta al PROSSIMO Umano che attacca.
  def test_avenger_grants_revenge_to_next_human
    engine = setup_scene([["v", "AVENGER"], ["u1", "HUMAN"], ["u2", "HUMAN"], ["n", "AUROS"]], attacks: %w[v n u1 u2])
    assert_match(/PROSSIMA Entità Umana/, engine.judge({ "t" => "empower", "uid" => "u2", "grants" => ["revenge"], "effect" => ref("v", "v", once: true) })[:reason])
    assert_match(/PROSSIMA Entità Umana/, engine.judge({ "t" => "empower", "uid" => "n", "grants" => ["revenge"], "effect" => ref("v", "v", once: true) })[:reason])
    verdict = engine.judge({ "t" => "empower", "uid" => "u1", "grants" => ["revenge"], "effect" => ref("v", "v", once: true) })
    assert verdict[:ok], verdict[:reason]
    assert_equal ["revenge"], table_copy(engine).card("u1")[:grants]
  end

  # Il divieto di blocco: se nel turno precedente hanno attaccato almeno 2 Umani, un'Entità avversaria non blocca.
  def test_raid_bans_block_after_human_turn
    engine = setup_scene([["r", "RAID"], ["u1", "HUMAN"], ["u2", "HUMAN"]], b: [["b1", "AUROS"]], attacks: %w[u1 u2])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert resolve_with(engine, [battle_entry("u1", damage: 2), battle_entry("u2", damage: 2)])[:ok]
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 5, "active" => "a" })
    front!(engine)
    assert engine.judge({ "t" => "declare", "declaration" => { "id" => "r", "from" => "r", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 } })[:ok]
    verdict = engine.judge({ "t" => "empower", "uid" => "b1", "restrict" => "block", "effect" => ref("r") })
    assert verdict[:ok], verdict[:reason]
    assert table_copy(engine).card("b1")[:cannot_block]
    assert_match(/avversaria/, engine.judge({ "t" => "empower", "uid" => "u1", "restrict" => "block", "effect" => ref("r") })[:reason])
  end

  def test_raid_without_humans_last_turn_is_silent
    engine = setup_scene([["r", "RAID"], ["u1", "HUMAN"]], b: [["b1", "AUROS"]], attacks: ["r"])
    assert_match(/turno precedente/, engine.judge({ "t" => "empower", "uid" => "b1", "restrict" => "block", "effect" => ref("r") })[:reason])
  end

  # Il divieto di blocco di QUESTO turno: se almeno 2 Umani che controlli attaccano (la fonte compresa),
  # un'Entità avversaria non blocca. Il turno precedente non c'entra.
  def test_assault_bans_block_with_two_attacking_humans
    engine = setup_scene([["s", "ASSAULT"], ["u1", "HUMAN"]], b: [["b1", "AUROS"]], attacks: %w[s u1])
    verdict = engine.judge({ "t" => "empower", "uid" => "b1", "restrict" => "block", "effect" => ref("s") })
    assert verdict[:ok], verdict[:reason]
    assert table_copy(engine).card("b1")[:cannot_block]
    assert_match(/avversaria/, engine.judge({ "t" => "empower", "uid" => "u1", "restrict" => "block", "effect" => ref("s") })[:reason])
  end

  def test_assault_alone_or_with_auros_is_silent
    solo = setup_scene([["s", "ASSAULT"], ["u1", "HUMAN"]], b: [["b1", "AUROS"]], attacks: ["s"])
    assert_match(/almeno 2 Entità Umane/, solo.judge({ "t" => "empower", "uid" => "b1", "restrict" => "block", "effect" => ref("s") })[:reason])
    auros = setup_scene([["s", "ASSAULT"], ["n", "AUROS"]], b: [["b1", "AUROS"]], attacks: %w[s n])
    assert_match(/almeno 2 Entità Umane/, auros.judge({ "t" => "empower", "uid" => "b1", "restrict" => "block", "effect" => ref("s") })[:reason])
  end
  # --- Il secondo lotto di forme: statici, Stasi, blocco multiplo, Materie, Nexus ---
  #
  # Le forme come le legge l'anagrafe dalle carte vere (card_index_test);
  # qui la dogana, scenario per scenario, su un'anagrafe di prova.

  LEGACY = {
    "RUNNER" => { type: "entity", keywords: [], race: "human", power: 1, flux_cost: 1,
                   static_forms: [{ kind: "self_power", amount: 1, while_attacking: true, requires_other: { type: "entity", race: "human" } }] },
    "SIMULACRUM" => { type: "entity", keywords: [], race: "simulacrum", power: 3, flux_cost: 4,
                     static_forms: [{ kind: "self_power", amount: 1, per_other: { type: "entity", race: "human" } }] },
    "SHIELD" => { type: "object", keywords: [], flux_cost: 2,
                 static_forms: [{ kind: "bearer_power", amount: 1 }],
                 grants_while_assigned: [{ keywords: ["stasis"], if_race: "human" }] },
    "BELT" => { type: "object", keywords: [], flux_cost: 3,
                   static_forms: [{ kind: "bearer_power", amount: 1, per: { type: "entity", race: "human" }, multi_block: true }] },
    "HUMAN" => { type: "entity", keywords: [], race: "human", power: 2, flux_cost: 2, enables: [[{ type: "dynamic", max_grade: 2 }, { type: "destructive", max_grade: 2 }]] },
    "SMALL" => { type: "entity", keywords: [], race: "human", power: 1, flux_cost: 1 },
    "GRIP" => { type: "entity", keywords: [], race: "auros", power: 1, flux_cost: 1, static_forms: [{ kind: "self_power", amount: 1, while_armed: true }] },
    "AUROS" => { type: "entity", keywords: [], race: "auros", power: 2, flux_cost: 2 },
    "BIG" => { type: "entity", keywords: [], race: "auros", power: 4, counterattack: nil, flux_cost: 4 },
    "THORNY" => { type: "entity", keywords: [], race: "human", power: 3, counterattack: 1, flux_cost: 3 },
    "BRISTLY" => { type: "entity", keywords: [], race: "auros", power: 2, counterattack: 1, flux_cost: 3,
                static_forms: [{ kind: "self_counter", amount: 1, per_object: true }] },
    "THORNS" => { type: "object", keywords: [], flux_cost: 2, static_forms: [{ kind: "bearer_counter", amount: 1 }] },
    "RUBY" => { type: "rubyfront", keywords: [] },
    "RALLY" => { type: "rubyfront", keywords: ["fury"], enables: [[], []],
                    nexus: { face: 1, conditions: [{ count: 4, type: "entity", race: "human" }], discard: { count: 1, type: "entity" }, recovery: 5 },
                    flip_forms: [{ kind: "move", card_id: "RETURNER", from: "field", to: "abisso" }, { kind: "seal", card_id: "RETURNER" }, { kind: "draw", count: 1 }] },
    "FORGE" => { type: "rubyfront", keywords: [], power: nil, counterattack: nil,
                  nexus: { face: 1, conditions: [{ count: 3, type: "entity", race: nil, armed: true }], discard: { count: 1, type: nil }, recovery: 5 },
                  assign_forms: [{ kind: "ends", face: 0, swap: true, then_draw: 1, then_discard: 1, once: true },
                                 { kind: "ends", face: 1, to_hand: true, other_to_retire: true, once: true }] },
    "CHARGE" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 3, matter: { type: "dynamic", grade: 2 },
                  resolve_forms: [{ kind: "search", count: 5, die: 20, bands: { "matter" => [1, 7], "object" => [8, 14], "entity" => [15, 20] },
                                    reveal_to: "hand", if_no_reveal_top: true, then_retire: true, rest_to: "deck" }] },
    "VESTIGE" => { type: "object", keywords: [], flux_cost: 3, static_forms: [{ kind: "bearer_power", amount: 2 }],
                    death_forms: [{ kind: "remain", to: "ritiro", then_rearm: { other: true, to: "unarmed", free: true } }] },
    "RETURNER" => { type: "entity", keywords: [], race: "human", power: 6, flux_cost: 6 },
    "PERMANENT" => { type: "matter", keywords: [], behavior: "permanent", flux_cost: 2, matter: { type: "dynamic", grade: 1 } },
    "ATTRACTION" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 2, matter: { type: "dynamic", grade: 1 },
                      resolve_forms: [{ kind: "look", count: 4, reveal: { type: "entity", race: "human" }, reveal_to: "hand", rest_to: "deck", show_up_to: 2 }] },
    "FORMATION" => { type: "matter", keywords: [], behavior: "reactive", flux_cost: 2, matter: { type: "dynamic", grade: 1 },
                      resolve_forms: [{ kind: "empower", targets: "own_entity", race: "human", power: 1, untap: true }] },
    "IMPACT" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 1, matter: { type: "dynamic", grade: 1 },
                   resolve_forms: [{ kind: "move", target: { type: "entity", controller: "opponent", max_cost: 2 }, to: "ritiro" }] },
    "FIELD" => { type: "matter", keywords: [], behavior: "permanent", flux_cost: 3, matter: { type: "destructive", grade: 1 },
                 resolve_forms: [{ kind: "exile", target: { permanent: true, controller: "opponent" }, to: "abisso", hold: true }] },
    "FORCE" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 3, matter: { type: "dynamic", grade: 2 },
                 resolve_forms: [{ kind: "fortune", die: 20, gain: { on: [1, 6], amount: 4 }, deploy: { on: [7, 13], filter: { type: "entity", race: "human", max_cost: 2 } },
                                   draw: { on: [14, 19], count: 1 }, all_on: [20, 20] }] },
    "COORDINATED" => { type: "matter", keywords: [], behavior: "reactive", flux_cost: 4, matter: { type: "dynamic", grade: 2 },
                      resolve_forms: [{ kind: "empower", targets: "own_entities", race: "human", counter: 1, untap: true, requires: { count: 3, race: "human" } }] },
    "REFLEX" => { type: "matter", keywords: [], behavior: "reactive", flux_cost: 2, matter: nil,
                    resolve_forms: [{ kind: "block", requires_armed: 2, heal: 3, as_block: true }] },
    "JUDGMENT" => { type: "matter", keywords: [], behavior: "reactive", flux_cost: 5, matter: { type: "destructive", grade: 2 },
                    resolve_forms: [{ kind: "destroy", target: { type: "entity", controller: "any" }, to: "abisso", discount: { amount: 3, if_target: "tapped" } }] },
    "FRACTURE" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 3, matter: { type: "dynamic", grade: 2 },
                    resolve_forms: [{ kind: "move", target: { type: "entity", controller: "opponent", max_cost: nil }, to: "ritiro", discount: { amount: 1, if_armed_at_least: 2 } }] },
    "REFRACTION" => { type: "matter", keywords: [], behavior: "reactive", flux_cost: 2, matter: { type: "dynamic", grade: 1 },
                      resolve_forms: [{ kind: "weaken", target: { type: "entity", controller: "opponent", attacking: true }, amount: -1, per_armed: true }] },
    "AMPLIFY" => { type: "matter", keywords: [], behavior: "reactive", flux_cost: 2, matter: { type: "dynamic", grade: 1 },
                     resolve_forms: [{ kind: "empower", targets: "own_armed", power: 1, up_to: 2, untap: true }] },
    "PRISM" => { type: "object", keywords: [], flux_cost: 3,
                  assign_forms: [{ kind: "exile", target: { type: "entity", controller: "opponent" }, to: "abisso", hold: true }] },
    "BEARER" => { type: "entity", keywords: [], race: "auros", power: 3, flux_cost: 4,
                     static_forms: [{ kind: "assign_discount", amount: 1 }], assign_forms: [{ kind: "draw", count: 1, to_self: true }] },
    "BLADE" => { type: "entity", keywords: [], race: "auros", power: 5, flux_cost: 5, static_forms: [{ kind: "others_armed_power", amount: 1 }] },
    "ASSAULT" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 4, matter: { type: "destructive", grade: 2 },
                   resolve_forms: [{ kind: "drain", amount: "objects" }] },
    "SUBVERSION" => { type: "matter", keywords: [], behavior: "normal", flux_cost: 3, matter: { type: "destructive", grade: 1 },
                     resolve_forms: [{ kind: "destroy", target: { type: "entity", controller: "opponent" }, to: "abisso", discount: nil, then_lose: 2 }] },
  }.freeze

  # Un tavolo del secondo lotto: le carte di A e di B (con zona ed extra)
  # scese al turno 1, poi turno 3 di A in Preparazione, con 10 Flussi per
  # posto. `attacks` dichiara il Fronte e gli attacchi di A.
  def legacy_scene(a, b: [], attacks: nil)
    engine = Rubyfront::Engine.new(cards: LEGACY)
    load = lambda do |seat, list|
      cards = list.map.with_index do |(uid, id, extra), i|
        { "uid" => uid, "owner" => seat, "zone" => "field", "order" => i, "cardId" => id, "y" => seat == "a" ? 1260 : 172 }.merge(extra || {})
      end
      engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    end
    load.call("a", a + [["rf-a", "RUBY", { "y" => 1260 }]])
    load.call("b", b + [["rf-b", "RUBY", { "y" => 172 }]])
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    Rubyfront::Table::SEATS.each { |seat| engine.judge({ "t" => "player", "seat" => seat, "patch" => { "flux" => 10, "fluxMax" => 10 } }) }
    if attacks
      front!(engine)
      attacks.each_with_index do |uid, i|
        verdict = engine.judge({ "t" => "declare", "declaration" => { "id" => uid, "from" => uid, "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => i + 1 } })
        raise "attacco rifiutato: #{verdict[:reason]}" unless verdict[:ok]
      end
    end
    engine
  end

  def block_action(engine, blocker, attacker, kind = "block", actor: "b")
    engine.judge({ "t" => "declare", "declaration" => { "id" => blocker, "from" => blocker, "to" => attacker, "kind" => kind, "seat" => "b", "order" => 0 } }, actor: actor)
  end

  def res_ref(source)
    { "source" => source, "event" => "on_resolve", "entering" => source }
  end

  def outcome(attacker, blocker: nil, kind: "unblocked", attacker_dies: false, blocker_dies: false, damage: 0, stasis: false, spent: false)
    battle_entry(attacker, blocker: blocker, kind: kind, attacker_dies: attacker_dies, blocker_dies: blocker_dies, damage: damage)
      .merge("blockerStasis" => stasis, "blockerSpent" => spent)
  end

  # --- §8.2: gli statici di Potenza ------------------------------------------

  def test_pair_bonus_holder_is_2_on_attack_only_with_another_human
    solo = legacy_scene([["r", "RUNNER"], ["x", "AUROS"]], attacks: ["r"])
    solo.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/non torna/, resolve_with(solo, [outcome("r", damage: 2)])[:reason])
    assert resolve_with(solo, [outcome("r", damage: 1)])[:ok]
    together = legacy_scene([["r", "RUNNER"], ["u", "HUMAN"]], attacks: ["r"])
    together.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/non torna/, resolve_with(together, [outcome("r", damage: 1)])[:reason])
    assert resolve_with(together, [outcome("r", damage: 2)])[:ok]
  end

  def test_pair_bonus_holder_stays_1_on_defense
    engine = legacy_scene([["u", "HUMAN"], ["r", "RUNNER"]], b: [["g", "BIG"]])
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    front!(engine)
    engine.judge({ "t" => "declare", "declaration" => { "id" => "g", "from" => "g", "to" => "rf-a", "kind" => "attack", "seat" => "b", "order" => 1 } }, actor: "b")
    engine.judge({ "t" => "phase", "phase" => "reazione" }, actor: "b")
    assert engine.judge({ "t" => "declare", "declaration" => { "id" => "r", "from" => "r", "to" => "g", "kind" => "block", "seat" => "a", "order" => 0 } }, actor: "a")[:ok]
    verdict = engine.judge({ "t" => "resolve", "seat" => "b", "battles" => [outcome("g", blocker: "r", kind: "block", blocker_dies: true)] }, actor: "a")
    assert verdict[:ok], verdict[:reason]
  end

  def test_simulacrum_counts_other_human_entities
    engine = legacy_scene([["s", "SIMULACRUM"], ["u1", "HUMAN"], ["u2", "HUMAN"], ["x", "AUROS"]], attacks: ["s"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/non torna/, resolve_with(engine, [outcome("s", damage: 3)])[:reason])
    assert resolve_with(engine, [outcome("s", damage: 5)])[:ok], "3 più 2 Umani"
  end

  def test_items_give_power_to_bearer
    engine = legacy_scene([["u", "HUMAN"], ["p", "SMALL"], ["o", "SHIELD", { "assignedTo" => "u" }], ["c", "BELT", { "assignedTo" => "p" }]], attacks: %w[u p])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    # Scudo: 2 + 1. Cintura: 1 + 1 per ogni Umano sul Fronte (due, portatrice compresa).
    assert resolve_with(engine, [outcome("u", damage: 3), outcome("p", damage: 3)])[:ok]
  end

  def test_grip_is_one_more_only_with_worn_item
    bare_one = legacy_scene([["r", "GRIP"]], attacks: ["r"])
    bare_one.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/non torna/, resolve_with(bare_one, [outcome("r", damage: 2)])[:reason])
    assert resolve_with(bare_one, [outcome("r", damage: 1)])[:ok]
    armed_one = legacy_scene([["r", "GRIP"], ["o", "SHIELD", { "assignedTo" => "r" }]], attacks: ["r"])
    armed_one.judge({ "t" => "phase", "phase" => "reazione" })
    # 1 stampato, +1 «se ha un Oggetto assegnato», +1 dello Scudo.
    assert_match(/non torna/, resolve_with(armed_one, [outcome("r", damage: 2)])[:reason])
    assert resolve_with(armed_one, [outcome("r", damage: 3)])[:ok]
  end

  # --- §6.3: gli statici di Contrattacco -------------------------------------

  def test_counter_grows_with_worn_items_and_item_counter
    # Nuda: 2 + 1 di Contrattacco = 3 < 4, muore. Armata con l'Oggetto a
    # Contrattacco: 2 + 1 + 1 per l'Oggetto + 1 dell'Oggetto = 5 ≥ 4, vince.
    bare_one = legacy_scene([["g", "BIG"]], b: [["i", "BRISTLY"]], attacks: ["g"])
    bare_one.judge({ "t" => "phase", "phase" => "reazione" })
    assert block_action(bare_one, "i", "g", "counter")[:ok]
    assert_match(/non torna/, resolve_with(bare_one, [outcome("g", blocker: "i", kind: "counter", attacker_dies: true)])[:reason])
    assert resolve_with(bare_one, [outcome("g", blocker: "i", kind: "counter", blocker_dies: true)])[:ok]
    armed_one = legacy_scene([["g", "BIG"]], b: [["i", "BRISTLY"], ["s", "THORNS", { "assignedTo" => "i" }]], attacks: ["g"])
    armed_one.judge({ "t" => "phase", "phase" => "reazione" })
    assert block_action(armed_one, "i", "g", "counter")[:ok]
    verdict = resolve_with(armed_one, [outcome("g", blocker: "i", kind: "counter", attacker_dies: true)])
    assert verdict[:ok], verdict[:reason]
  end

  def test_power_does_not_go_below_zero
    engine = legacy_scene([["p", "SMALL"]], attacks: ["p"])
    engine.observe({ "t" => "empower", "uid" => "p", "power" => -3, "effect" => { "source" => "p", "event" => "on_attack", "entering" => "p" } })
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert resolve_with(engine, [outcome("p", damage: 0)])[:ok]
  end

  # --- §8.1: la Stasi concessa da un Oggetto ---------------------------------

  def test_stasis_saves_blocking_human_not_auros
    engine = legacy_scene([["g", "BIG"], ["g2", "BIG"]], b: [["u", "HUMAN"], ["x", "AUROS"], ["o", "SHIELD", { "assignedTo" => "u" }], ["o2", "SHIELD", { "assignedTo" => "x" }]], attacks: %w[g g2])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert block_action(engine, "u", "g")[:ok]
    assert block_action(engine, "x", "g2")[:ok]
    assert_match(/non torna/, resolve_with(engine, [outcome("g", blocker: "u", kind: "block", blocker_dies: true), outcome("g2", blocker: "x", kind: "block", blocker_dies: true)])[:reason])
    verdict = resolve_with(engine, [outcome("g", blocker: "u", kind: "block", stasis: true), outcome("g2", blocker: "x", kind: "block", blocker_dies: true)])
    assert verdict[:ok], verdict[:reason]
    u = table_copy(engine).card("u")
    assert_equal "field", u[:zone]
    assert u[:stasis]
    assert u[:tapped]
    assert_equal "abisso", table_copy(engine).card("x")[:zone]
  end

  def test_stasis_blocks_untap_and_retire_and_effect_frees
    engine = legacy_scene([["g", "BIG"]], b: [["u", "HUMAN"], ["o", "SHIELD", { "assignedTo" => "u" }]], attacks: ["g"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    block_action(engine, "u", "g")
    assert resolve_with(engine, [outcome("g", blocker: "u", kind: "block", stasis: true)])[:ok]
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" }, actor: "b")
    assert table_copy(engine).card("u")[:tapped], "tappata per sempre"
    # Il Ritiro è un gesto libero (§6.2, decisione del designer): la Stasi
    # non lo ferma. Quel che la Stasi tiene è la tappata permanente.
    assert engine.judge({ "t" => "toZone", "uid" => "u", "zone" => "ritiro" }, actor: "b")[:ok]
    engine.observe({ "t" => "refresh", "seat" => "b", "roll" => 17, "untap" => true, "effect" => { "source" => "u", "event" => "on_enter_field", "entering" => "u" } })
    refute table_copy(engine).card("u")[:tapped], "un effetto la stappa"
  end

  def test_stasis_in_counter_replaces_cover
    engine = legacy_scene([["g", "BIG"]], b: [["s", "THORNY"], ["o", "SHIELD", { "assignedTo" => "s" }]], attacks: ["g"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    block_action(engine, "s", "g", "counter")
    # 3 + 1 (Scudo) + 1 (Contrattacco) = 5 > 4: l'attaccante muore, nessuna Stasi.
    assert resolve_with(engine, [outcome("g", blocker: "s", kind: "counter", attacker_dies: true)])[:ok]
  end

  # --- §8.2: il blocco multiplo -----------------------------------------------

  def test_belt_opens_attacker_to_several_blockers
    engine = legacy_scene([["u", "HUMAN"], ["c", "BELT", { "assignedTo" => "u" }], ["x", "AUROS"]], b: [["b1", "AUROS"], ["b2", "AUROS"], ["b3", "AUROS"]], attacks: %w[u x])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert block_action(engine, "b1", "u")[:ok]
    assert block_action(engine, "b2", "u")[:ok], "la Cintura lo rende bloccabile da più Entità"
    assert block_action(engine, "b3", "x")[:ok]
    assert_match(/1 contro 1/, block_action(engine, "b3", "x")[:reason].to_s + engine.judge({ "t" => "declare", "declaration" => { "id" => "b3", "from" => "b3", "to" => "x", "kind" => "block", "seat" => "b", "order" => 0 } }, actor: "b")[:reason].to_s) if false
    # Senza Cintura il secondo bloccante è fermato.
    engine.judge({ "t" => "undeclare", "from" => "b3" }, actor: "b")
    assert block_action(engine, "b3", "x")[:ok]
    assert_match(/1 contro 1/, engine.judge({ "t" => "declare", "declaration" => { "id" => "b2", "from" => "b2", "to" => "x", "kind" => "block", "seat" => "b", "order" => 0 } }, actor: "b")[:reason])
    # Ogni bloccante ha la sua battaglia: u vale 2 + 1 = 3 contro due Auros da 2.
    battles = [outcome("u", blocker: "b1", kind: "block", blocker_dies: true), outcome("u", blocker: "b2", kind: "block", blocker_dies: true),
               outcome("x", blocker: "b3", kind: "block", attacker_dies: true, blocker_dies: true)]
    verdict = resolve_with(engine, battles)
    assert verdict[:ok], verdict[:reason]
    assert_equal "field", table_copy(engine).card("u")[:zone]
    assert_equal "abisso", table_copy(engine).card("b2")[:zone]
  end

  # --- §7.2: le finestre delle Reattive ---------------------------------------

  # Gioca dalla mano. Una Reattiva porta il segno della catena (§7.2), come
  # fa il client: la catena resta aperta finché l'avversario non `accetta!`.
  def play_card(engine, uid, cost:, actor: "a", x: 2368, y: 1260, extra: {})
    card = table_copy(engine).card(uid)
    known = card && LEGACY[card[:card_id]]
    extra = { "chain" => true }.merge(extra) if known && known[:behavior] == "reactive"
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => x, "y" => y, "cost" => cost }.merge(extra), actor: actor)
  end

  # §7.2 — chi deve rispondere accetta: la catena si risolve.
  def accept!(engine, seat)
    verdict = engine.judge({ "t" => "pass", "seat" => seat }, actor: seat)
    raise "accettazione rifiutata: #{verdict[:reason]}" unless verdict[:ok]
    verdict
  end

  def test_reactive_before_wave_only_for_active_seat
    engine = legacy_scene([["u", "HUMAN"], ["m", "FORMATION", { "zone" => "hand" }]], b: [["v", "HUMAN"], ["n", "FORMATION", { "zone" => "hand" }]])
    assert_match(/solo in Fase di Fronte/, play_card(engine, "m", cost: 2)[:reason])
    front!(engine)
    assert_match(/di chi è di turno/, play_card(engine, "n", cost: 2, actor: "b", y: 172)[:reason], "il Pre-Fronte non c'è più (§6.3)")
    assert play_card(engine, "m", cost: 2)[:ok]
    accept!(engine, "b")
  end

  def test_after_wave_declared_reactives_belong_to_defender_in_reaction
    engine = legacy_scene([["u", "HUMAN"], ["m", "FORMATION", { "zone" => "hand" }]],
                     b: [["v", "HUMAN"], ["v2", "HUMAN"], ["v3", "HUMAN"], ["n", "FORMATION", { "zone" => "hand" }], ["c", "COORDINATED", { "zone" => "hand" }]], attacks: ["u"])
    assert_match(/ondata dichiarata/, play_card(engine, "m", cost: 2)[:reason])
    assert_match(/ondata dichiarata/, play_card(engine, "n", cost: 2, actor: "b", y: 172)[:reason])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/risponde solo in catena/, play_card(engine, "m", cost: 2)[:reason], "chi attacca non inizia Reattive in Reazione (§6.4)")
    assert play_card(engine, "n", cost: 2, actor: "b", y: 172)[:ok], "in Reazione il difensore gioca qualsiasi Reattiva, non solo un bloccante (§6.4, §7.2)"
    accept!(engine, "a")
    assert engine.judge({ "t" => "toZone", "uid" => "n", "zone" => "abisso" }, actor: "b")[:ok], "la Reattiva risolta si consuma"
    assert play_card(engine, "c", cost: 4, actor: "b", y: 172)[:ok], "e anche quella che non blocca nessuno"
  end

  # --- §7.2/§8.2: le Materie alla risoluzione ---------------------------------

  # Lo sguardo: guarda le prime 4, un'Entità Umana in mano, le altre in fondo.
  def test_resolve_glance_looks_at_four_and_shows_human
    # La Pesca del turno 3 prende «d0»: sotto restano d1, d2, d3.
    engine = legacy_scene([["u", "HUMAN"], ["m", "ATTRACTION", { "zone" => "hand" }], ["d0", "AUROS", { "zone" => "deck", "order" => 0 }],
                      ["d1", "AUROS", { "zone" => "deck", "order" => 1 }], ["d2", "HUMAN", { "zone" => "deck", "order" => 2 }], ["d3", "HUMAN", { "zone" => "deck", "order" => 5 }]])
    assert play_card(engine, "m", cost: 2)[:ok]
    accept!(engine, "b")
    look = { "t" => "look", "seat" => "a", "count" => 4, "reveal" => "d2", "effect" => res_ref("m") }
    assert_match(/prime 4/, engine.judge(look.merge("count" => 3))[:reason])
    assert_match(/Entità Umana/, engine.judge(look.merge("reveal" => "d1"))[:reason])
    verdict = engine.judge(look)
    assert verdict[:ok], verdict[:reason]
    assert_equal "hand", table_copy(engine).card("d2")[:zone]
    assert_match(/già stato risolto/, engine.judge(look.merge("reveal" => "d3"))[:reason])
  end

  # La stappata: stappa un'Entità Umana che controlli: +1 Potenza.
  def test_single_untap_untaps_one_human_and_empowers
    engine = legacy_scene([["u", "HUMAN", { "tapped" => true }], ["u2", "HUMAN", { "tapped" => true }], ["x", "AUROS", { "tapped" => true }], ["m", "FORMATION", { "zone" => "hand" }]])
    front!(engine)
    assert play_card(engine, "m", cost: 2)[:ok]
    accept!(engine, "b")
    step_action = { "t" => "empower", "uid" => "u", "power" => 1, "untap" => true, "effect" => res_ref("m") }
    assert_match(/Entità Umana/, engine.judge(step_action.merge("uid" => "x"))[:reason])
    assert_match(/non lo dice/, engine.judge(step_action.reject { |k, _| k == "untap" })[:reason])
    assert_match(/Potenza in più è 1/, engine.judge(step_action.merge("power" => 2))[:reason])
    verdict = engine.judge(step_action)
    assert verdict[:ok], verdict[:reason]
    u = table_copy(engine).card("u")
    refute u[:tapped]
    assert_equal 1, u[:power_bonus]
    assert_match(/UN'Entità/, engine.judge(step_action.merge("uid" => "u2"))[:reason])
  end

  # Lo spostamento: un'Entità avversaria con costo 2 o inferiore nella Zona di Ritiro.
  def test_retire_move_sends_only_cheap
    engine = legacy_scene([["u", "HUMAN"], ["m", "IMPACT", { "zone" => "hand" }]], b: [["b1", "AUROS"], ["b2", "BIG"]])
    assert play_card(engine, "m", cost: 1)[:ok]
    accept!(engine, "b")
    step_action = { "t" => "toZone", "uid" => "b1", "zone" => "ritiro", "effect" => res_ref("m") }
    assert_match(/2 o inferiore/, engine.judge(step_action.merge("uid" => "b2"))[:reason])
    assert_match(/avversario/, engine.judge(step_action.merge("uid" => "u"))[:reason])
    verdict = engine.judge(step_action)
    assert verdict[:ok], verdict[:reason]
    assert_equal "ritiro", table_copy(engine).card("b1")[:zone]
  end

  # L'esilio condizionato: un permanente avversario nell'Abisso, finché questa carta resta in gioco.
  def test_conditional_exile_exiles_and_returns_when_leaving_play
    engine = legacy_scene([["u", "HUMAN"], ["m", "FIELD", { "zone" => "hand" }]], b: [["b1", "AUROS"], ["bm", "PERMANENT"], ["bo", "SHIELD", { "assignedTo" => "b1" }]])
    assert play_card(engine, "m", cost: 3)[:ok]
    accept!(engine, "b")
    step_action = { "t" => "toZone", "uid" => "b1", "zone" => "abisso", "heldBy" => "m", "effect" => res_ref("m") }
    assert_match(/Entità o una Materia permanente/, engine.judge(step_action.merge("uid" => "bo"))[:reason])
    assert_match(/Entità o una Materia permanente/, engine.judge(step_action.merge("uid" => "rf-b"))[:reason])
    assert_match(/tenuto da questa carta/, engine.judge(step_action.reject { |k, _| k == "heldBy" })[:reason])
    verdict = engine.judge(step_action)
    assert verdict[:ok], verdict[:reason]
    assert_equal "abisso", table_copy(engine).card("b1")[:zone]
    assert_equal "abisso", table_copy(engine).card("bo")[:zone], "l'Oggetto la segue"
    assert_match(/già stato risolto/, engine.judge(step_action.merge("uid" => "bm"))[:reason])
    assert_match(/resta nell'Abisso/, engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "x" => 442, "y" => 172 })[:reason])
    assert engine.judge({ "t" => "toZone", "uid" => "m", "zone" => "abisso" })[:ok]
    comeback = engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "x" => 442, "y" => 172 })
    assert comeback[:ok], comeback[:reason]
    assert_equal "field", table_copy(engine).card("b1")[:zone]
    assert_equal "abisso", table_copy(engine).card("bo")[:zone], "torna disarmata (§3.1)"
  end

  # Il d20 a fasce.
  def test_banded_d20_follows_die
    engine = legacy_scene([["u", "HUMAN"], ["m", "FORCE", { "zone" => "hand" }], ["h", "SMALL", { "zone" => "hand" }], ["g", "BIG", { "zone" => "hand" }], ["d", "AUROS", { "zone" => "deck" }]])
    assert play_card(engine, "m", cost: 3)[:ok]
    accept!(engine, "b")
    healing = { "t" => "player", "seat" => "a", "patch" => { "hp" => 24 }, "roll" => 3, "effect" => res_ref("m") }
    drawing = { "t" => "draw", "seat" => "a", "count" => 1, "roll" => 3, "effect" => res_ref("m") }
    landed = { "t" => "toZone", "uid" => "h", "zone" => "field", "x" => 821, "y" => 1260, "roll" => 3, "effect" => res_ref("m") }
    assert_match(/non si pesca/, engine.judge(drawing)[:reason])
    assert_match(/nessuno scende/, engine.judge(landed)[:reason])
    assert_match(/tiro valido/, engine.judge(healing.merge("roll" => 21))[:reason])
    assert engine.judge(healing)[:ok]
    assert_equal 24, table_copy(engine).hp("a")
    assert_match(/tira una volta/, engine.judge(drawing.merge("roll" => 15))[:reason], "il tiro è fissato dal primo passo")
    assert_match(/già stato risolto/, engine.judge(healing.merge("patch" => { "hp" => 28 }))[:reason])
  end

  def test_d20_bands_at_20_do_all_three
    engine = legacy_scene([["u", "HUMAN"], ["m", "FORCE", { "zone" => "hand" }], ["h", "SMALL", { "zone" => "hand" }], ["g", "BIG", { "zone" => "hand" }], ["d", "AUROS", { "zone" => "deck" }]])
    assert play_card(engine, "m", cost: 3)[:ok]
    accept!(engine, "b")
    assert engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 24 }, "roll" => 20, "effect" => res_ref("m") })[:ok]
    assert engine.judge({ "t" => "draw", "seat" => "a", "count" => 1, "roll" => 20, "effect" => res_ref("m") })[:ok]
    landed = { "t" => "toZone", "uid" => "h", "zone" => "field", "x" => 821, "y" => 1260, "roll" => 20, "effect" => res_ref("m") }
    assert_match(/2 o inferiore/, engine.judge(landed.merge("uid" => "g"))[:reason])
    assert_match(/senza pagarne/, engine.judge(landed.merge("cost" => 1))[:reason])
    verdict = engine.judge(landed)
    assert verdict[:ok], verdict[:reason]
    assert_equal "field", table_copy(engine).card("h")[:zone]
    assert_equal 7, table_copy(engine).flux("a"), "gratis: pagata solo la Materia"
  end

  # --- §7.2: la catena di risposta ------------------------------------------

  # A di turno in Fronte, ondata non dichiarata: Reattive in mano da entrambe le parti.
  def chain_fixture
    engine = legacy_scene([["r1", "REFLEX", { "zone" => "hand" }], ["r3", "REFLEX", { "zone" => "hand" }], ["e", "HUMAN", { "zone" => "hand" }]],
                     b: [["r2", "REFLEX", { "zone" => "hand" }]])
    front!(engine)
    engine
  end

  def in_chain(engine, uid, actor:, chain: true)
    play_card(engine, uid, cost: 2, actor: actor, y: actor == "a" ? 1260 : 172, extra: { "chain" => chain })
  end

  def test_reactive_always_opens_chain
    engine = chain_fixture
    without = in_chain(engine, "r1", actor: "a", chain: false)
    refute without[:ok]
    assert_match(/apre sempre la catena.*§7\.2/, without[:reason])
    assert_match(/always opens the response chain.*§7\.2/, without[:reason_en])
    # Il segno su una carta che non è Reattiva: in Preparazione, dove l'Entità scenderebbe.
    preparation = legacy_scene([["e", "HUMAN", { "zone" => "hand" }]])
    fake = preparation.judge({ "t" => "toZone", "uid" => "e", "zone" => "field", "x" => 442, "y" => 1260, "chain" => true }, actor: "a")
    assert_match(/solo una Materia Reattiva.*§7\.2/, fake[:reason])
    verdict = in_chain(engine, "r1", actor: "a")
    assert verdict[:ok], verdict[:reason]
    assert_equal({ stack: ["r1"], turn: "b", resolving: false }, table_copy(engine).chain)
  end

  def test_in_chain_opponent_answers_and_speaker_accepts
    engine = chain_fixture
    in_chain(engine, "r1", actor: "a")
    assert_match(/tocca a B.*§7\.2/, in_chain(engine, "r3", actor: "a")[:reason], "due proprie Reattive di fila no")
    assert_match(/tocca a B/, engine.judge({ "t" => "pass", "seat" => "a" }, actor: "a")[:reason])
    reply = in_chain(engine, "r2", actor: "b")
    assert reply[:ok], reply[:reason]
    assert_equal({ stack: %w[r1 r2], turn: "a", resolving: false }, table_copy(engine).chain)
    assert_match(/tocca a A/, engine.judge({ "t" => "pass", "seat" => "b" }, actor: "b")[:reason])
    acceptance = engine.judge({ "t" => "pass", "seat" => "a" }, actor: "a")
    assert acceptance[:ok], acceptance[:reason]
    assert table_copy(engine).chain[:resolving]
  end

  def test_chain_is_atomic_but_token_passes
    engine = chain_fixture
    in_chain(engine, "r1", actor: "a")
    assert_match(/atomica.*§7\.2/, engine.judge({ "t" => "phase", "phase" => "reazione" }, actor: "a")[:reason])
    assert_match(/atomica/, engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" }, actor: "a")[:reason])
    assert_match(/atomica/, engine.judge({ "t" => "declare", "declaration" => { "id" => "e", "from" => "e", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 } }, actor: "a")[:reason])
    assert engine.judge({ "t" => "say", "entry" => {} }, actor: "b")[:ok]
    with_token = engine.judge({ "t" => "player", "seat" => "b", "patch" => { "token" => false, "flux" => 11 } }, actor: "b")
    assert with_token[:ok], with_token[:reason]
  end

  def test_resolved_chain_passes_only_top_then_closes
    engine = chain_fixture
    in_chain(engine, "r1", actor: "a")
    in_chain(engine, "r2", actor: "b")
    engine.judge({ "t" => "pass", "seat" => "a" }, actor: "a")
    assert_match(/si sta risolvendo/, in_chain(engine, "r3", actor: "a")[:reason], "nessuna Reattiva nuova")
    assert_match(/si sta risolvendo/, engine.judge({ "t" => "pass", "seat" => "a" }, actor: "a")[:reason])
    hp_a = table_copy(engine).hp("a")
    hp_b = table_copy(engine).hp("b")
    assert_match(/si sta risolvendo/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => hp_a + 3 }, "effect" => res_ref("r1") }, actor: "a")[:reason], "r1 non è la cima")
    # La cima passa alla dogana dell'effetto (che qui la ferma per gli armati: la catena l'ha lasciata passare).
    assert_match(/Oggetto assegnato/, engine.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => hp_b + 3 }, "effect" => res_ref("r2") }, actor: "b")[:reason])
    assert_match(/si sta risolvendo/, engine.judge({ "t" => "settle", "uid" => "r1" }, actor: "a")[:reason])
    assert engine.judge({ "t" => "toZone", "uid" => "r2", "zone" => "abisso" }, actor: "b")[:ok], "la Reattiva risolta si consuma: esce dalla pila"
    assert_equal ["r1"], table_copy(engine).chain[:stack]
    assert_match(/Oggetto assegnato/, engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => hp_a + 3 }, "effect" => res_ref("r1") }, actor: "a")[:reason], "ora la cima è r1")
    # Chi resta in campo (la Reattiva che blocca, §6.4) si chiude con `settle`.
    assert engine.judge({ "t" => "settle", "uid" => "r1" }, actor: "a")[:ok]
    assert_nil table_copy(engine).chain
    assert engine.judge({ "t" => "toZone", "uid" => "r1", "zone" => "abisso" }, actor: "a")[:ok]
    assert engine.judge({ "t" => "phase", "phase" => "reazione" }, actor: "a")[:ok], "chiusa la catena, il tavolo riparte"
  end

  def test_in_reaction_blocking_reactive_opens_and_attacker_answers
    engine = legacy_scene([["g", "BIG"], ["r3", "REFLEX", { "zone" => "hand" }]], b: [["r2", "REFLEX", { "zone" => "hand" }]], attacks: %w[g])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert in_chain(engine, "r2", actor: "b")[:ok]
    assert block_action(engine, "r2", "g")[:ok], "il blocco della cima passa in catena"
    reply = in_chain(engine, "r3", actor: "a")
    assert reply[:ok], "«l'attaccante può rispondere» (§6.4): #{reply[:reason]}"
  end

  # La forma `block`: giocata come bloccante di un'Entità attaccante, l'attacco è bloccato; con 2 armati sul Fronte, +3 PV.
  def test_blocking_reactive_stops_attacker_and_heals_if_enough_armed
    engine = legacy_scene([["g", "BIG"], ["g2", "BIG"]],
                     b: [["v1", "HUMAN"], ["v2", "HUMAN"], ["o1", "SHIELD", { "assignedTo" => "v1" }], ["o2", "SHIELD"], ["r", "REFLEX", { "zone" => "hand" }]], attacks: %w[g g2])
    refute play_card(engine, "r", cost: 2, actor: "b", y: 172)[:ok], "nel Fronte a ondata dichiarata no (§7.2)"
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert play_card(engine, "r", cost: 2, actor: "b", y: 172)[:ok], "in Reazione sì: si gioca come blocco (§7.2)"
    assert block_action(engine, "r", "g")[:ok], "la Reattiva ferma l'attaccante (§6.4)"
    accept!(engine, "a")
    hp = table_copy(engine).hp("b")
    healing = { "t" => "player", "seat" => "b", "patch" => { "hp" => hp + 3 }, "effect" => res_ref("r") }
    assert_match(/Entità con un Oggetto assegnato.*§8\.2/, engine.judge(healing, actor: "b")[:reason], "un armato solo: niente PV")
    engine.observe({ "t" => "assign", "uid" => "o2", "to" => "v2" })
    assert_match(/dà 3 PV/, engine.judge(healing.merge("patch" => { "hp" => hp + 5 }), actor: "b")[:reason])
    assert_match(/chi comanda la fonte/, engine.judge(healing.merge("seat" => "a"), actor: "b")[:reason])
    verdict = engine.judge(healing, actor: "b")
    assert verdict[:ok], verdict[:reason]
    assert_equal hp + 3, table_copy(engine).hp("b")
    assert_match(/già stato risolto/, engine.judge(healing.merge("patch" => { "hp" => hp + 6 }), actor: "b")[:reason])
  end

  # La stappata di gruppo, in Reazione, senza bloccare: con 3 Umani, stappa gli Umani, Contrattacco +1.
  def test_group_untap_in_reaction_empowers_humans_without_blocking
    engine = legacy_scene([["g", "BIG"], ["g2", "BIG"]],
                     b: [["v1", "HUMAN", { "tapped" => true }], ["v2", "HUMAN", { "tapped" => true }], ["v3", "THORNY"], ["c", "COORDINATED", { "zone" => "hand" }]], attacks: %w[g g2])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert play_card(engine, "c", cost: 4, actor: "b", y: 172)[:ok]
    accept!(engine, "a")
    # La carta non dice cosa blocca, quindi non blocca nessuno e non
    # pretende una dichiarazione (decisione del designer, 2026-09-05):
    # l'effetto parte subito, nella finestra del difensore (§6.4).
    step_action = { "t" => "empower", "uid" => "v1", "counter" => 1, "untap" => true, "effect" => res_ref("c") }
    %w[v1 v2 v3].each do |uid|
      verdict = engine.judge(step_action.merge("uid" => uid), actor: "b")
      assert verdict[:ok], verdict[:reason]
    end
    assert_match(/già stato risolto/, engine.judge(step_action, actor: "b")[:reason])
    table_setup = table_copy(engine)
    refute table_setup.card("v1")[:tapped]
    assert_equal 1, table_setup.card("v3")[:counter_bonus]
    # La Reattiva risolta si consuma, e lo fa il difensore nel turno altrui (§7.2).
    assert engine.judge({ "t" => "toZone", "uid" => "c", "zone" => "abisso" }, actor: "b")[:ok]
    assert_equal "abisso", table_setup.card("c")[:zone], "la Reattiva si consuma"
    # Ora v3 contrattacca g2: 3 + 1 + 1 = 5 > 4. g, che nessuno ferma, passa.
    assert block_action(engine, "v3", "g2", "counter")[:ok]
    battles = [outcome("g", damage: 4), outcome("g2", blocker: "v3", kind: "counter", attacker_dies: true)]
    verdict = resolve_with(engine, battles)
    assert verdict[:ok], verdict[:reason]
    assert_equal "abisso", table_setup.card("g2")[:zone]
    assert_equal 16, table_setup.hp("b"), "la Reattiva non ferma nessuno: i 4 di g passano"
  end

  def test_group_untap_needs_three_humans
    engine = legacy_scene([["g", "BIG"]], b: [["v1", "HUMAN"], ["v2", "HUMAN"], ["c", "COORDINATED", { "zone" => "hand" }]], attacks: %w[g])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert play_card(engine, "c", cost: 4, actor: "b", y: 172)[:ok]
    accept!(engine, "a")
    assert_match(/almeno 3 Entità Umane/, engine.judge({ "t" => "empower", "uid" => "v1", "counter" => 1, "untap" => true, "effect" => res_ref("c") }, actor: "b")[:reason])
  end

  # La distruzione: distruggi un'Entità; contro una tappata costa 3 in meno.
  def test_destroy_discounts_against_tapped_and_hits_it
    engine = legacy_scene([["u", "HUMAN"], ["m", "JUDGMENT", { "zone" => "hand" }]], b: [["b1", "AUROS"], ["b2", "BIG"]])
    # Tappata ORA (il cambio di turno l'aveva stappata).
    engine.observe({ "t" => "tap", "uid" => "b1", "tapped" => true })
    front!(engine)
    assert_match(/costa 2 di Flusso/, play_card(engine, "m", cost: 5, extra: { "target" => "b1" })[:reason])
    assert_match(/costa 5 di Flusso/, play_card(engine, "m", cost: 2, extra: { "target" => "b2" })[:reason], "lo sconto vale solo contro una tappata")
    assert play_card(engine, "m", cost: 2, extra: { "target" => "b1" })[:ok]
    accept!(engine, "b")
    assert_equal 8, table_copy(engine).flux("a")
    step_action = { "t" => "toZone", "uid" => "b2", "zone" => "abisso", "effect" => res_ref("m") }
    assert_match(/altro bersaglio/, engine.judge(step_action)[:reason])
    verdict = engine.judge(step_action.merge("uid" => "b1"))
    assert verdict[:ok], verdict[:reason]
    assert_equal "abisso", table_copy(engine).card("b1")[:zone]
  end

  def test_destroy_without_declared_target_costs_full_and_hits_anyone
    engine = legacy_scene([["u", "HUMAN"], ["m", "JUDGMENT", { "zone" => "hand" }]], b: [["b1", "AUROS"]])
    engine.observe({ "t" => "tap", "uid" => "b1", "tapped" => true })
    front!(engine)
    assert play_card(engine, "m", cost: 5)[:ok]
    accept!(engine, "b")
    verdict = engine.judge({ "t" => "toZone", "uid" => "u", "zone" => "abisso", "effect" => res_ref("m") })
    assert verdict[:ok], verdict[:reason]
  end

  def test_matter_resolved_other_turn_or_unknown_is_silent
    engine = legacy_scene([["u", "HUMAN"], ["m", "IMPACT"]], b: [["b1", "AUROS"]])
    assert_match(/non è scesa in campo questo turno/, engine.judge({ "t" => "toZone", "uid" => "b1", "zone" => "ritiro", "effect" => res_ref("m") })[:reason])
    unknown = legacy_scene([["u", "HUMAN"], ["z", "UNKNOWN"]], b: [["b1", "AUROS"]])
    refute unknown.judge({ "t" => "toZone", "uid" => "b1", "zone" => "ritiro", "effect" => res_ref("z") })[:ruled]
  end

  # L'indebolimento dell'attaccante: −1 per ogni propria Entità con un Oggetto, in Reazione.
  def test_weaken_takes_one_power_per_armed_from_attacker
    engine = legacy_scene([["u", "HUMAN"], ["u2", "HUMAN"]],
                     b: [["bu", "HUMAN"], ["b1", "AUROS"], ["bo", "SHIELD", { "assignedTo" => "b1" }], ["b2", "AUROS"], ["bo2", "THORNS", { "assignedTo" => "b2" }], ["n", "REFRACTION", { "zone" => "hand" }]],
                     attacks: ["u"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert play_card(engine, "n", cost: 2, actor: "b", y: 172)[:ok]
    accept!(engine, "a")
    step_action = { "t" => "empower", "uid" => "u", "power" => -2, "effect" => res_ref("n") }
    assert_match(/non attacca/, engine.judge(step_action.merge("uid" => "u2"), actor: "b")[:reason])
    assert_match(/avversaria/, engine.judge(step_action.merge("uid" => "b1"), actor: "b")[:reason])
    assert_match(/in meno è -2/, engine.judge(step_action.merge("power" => -1), actor: "b")[:reason], "il conto è delle armate di adesso")
    assert_match(/toglie Potenza soltanto/, engine.judge(step_action.merge("untap" => true), actor: "b")[:reason])
    verdict = engine.judge(step_action, actor: "b")
    assert verdict[:ok], verdict[:reason]
    assert_equal(-2, table_copy(engine).card("u")[:power_bonus])
    assert_match(/già stato risolto/, engine.judge(step_action, actor: "b")[:reason])
    engine.observe({ "t" => "declare", "declaration" => { "id" => "u2", "from" => "u2", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 2 } })
    assert_match(/UN'Entità/, engine.judge(step_action.merge("uid" => "u2"), actor: "b")[:reason], "un bersaglio solo per risoluzione")
  end

  def test_weaken_without_armed_removes_nothing
    engine = legacy_scene([["u", "HUMAN"]], b: [["bu", "HUMAN"], ["n", "REFRACTION", { "zone" => "hand" }]], attacks: ["u"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert play_card(engine, "n", cost: 2, actor: "b", y: 172)[:ok]
    accept!(engine, "a")
    verdict = engine.judge({ "t" => "empower", "uid" => "u", "power" => -1, "effect" => res_ref("n") }, actor: "b")
    assert_match(/senza Entità con un Oggetto/, verdict[:reason])
    assert_includes verdict[:reason_en], "(§8.2)"
  end

  # Il potenziamento delle armate: fino a 2 proprie Entità con un Oggetto, +1 e stappate.
  def test_armed_empower_untaps_at_most_two
    engine = legacy_scene([["u", "HUMAN"], ["uo", "SHIELD", { "assignedTo" => "u" }], ["v", "HUMAN"], ["vo", "THORNS", { "assignedTo" => "v" }],
                      ["w", "HUMAN"], ["wo", "SHIELD", { "assignedTo" => "w" }], ["x", "HUMAN"], ["m", "AMPLIFY", { "zone" => "hand" }]])
    engine.observe({ "t" => "tap", "uid" => "u", "tapped" => true })
    front!(engine)
    assert play_card(engine, "m", cost: 2)[:ok]
    accept!(engine, "b")
    step_action = { "t" => "empower", "uid" => "u", "power" => 1, "untap" => true, "effect" => res_ref("m") }
    assert_match(/non ne ha/, engine.judge(step_action.merge("uid" => "x"))[:reason], "senza Oggetto no")
    assert_match(/Potenza in più è 1/, engine.judge(step_action.merge("power" => 2))[:reason])
    assert_match(/non lo dice/, engine.judge(step_action.reject { |k, _| k == "untap" })[:reason])
    verdict = engine.judge(step_action)
    assert verdict[:ok], verdict[:reason]
    assert_equal 1, table_copy(engine).card("u")[:power_bonus]
    refute table_copy(engine).card("u")[:tapped]
    assert_match(/già stato risolto/, engine.judge(step_action)[:reason])
    assert engine.judge(step_action.merge("uid" => "v"))[:ok]
    third = engine.judge(step_action.merge("uid" => "w"))
    assert_match(/fino a 2 Entità/, third[:reason])
    assert_includes third[:reason_en], "(§8.2)"
  end

  # Lo spostamento scontato: in Ritiro; con 2 armate sul Fronte costa 1 in meno.
  def test_discounted_move_costs_one_less_with_two_armed
    engine = legacy_scene([["u", "HUMAN"], ["uo", "SHIELD", { "assignedTo" => "u" }], ["v", "HUMAN"], ["vo", "THORNS", { "assignedTo" => "v" }], ["m", "FRACTURE", { "zone" => "hand" }]],
                     b: [["b1", "BIG"]])
    assert_match(/costa 2 di Flusso/, play_card(engine, "m", cost: 3)[:reason])
    assert play_card(engine, "m", cost: 2)[:ok]
    accept!(engine, "b")
    assert_equal 8, table_copy(engine).flux("a")
    verdict = engine.judge({ "t" => "toZone", "uid" => "b1", "zone" => "ritiro", "effect" => res_ref("m") })
    assert verdict[:ok], "senza limite di costo, anche la grossa: #{verdict[:reason]}"
    assert_equal "ritiro", table_copy(engine).card("b1")[:zone]
    few = legacy_scene([["u", "HUMAN"], ["uo", "SHIELD", { "assignedTo" => "u" }], ["m", "FRACTURE", { "zone" => "hand" }]], b: [["b1", "BIG"]])
    assert_match(/costa 3 di Flusso/, play_card(few, "m", cost: 2)[:reason], "con una sola armata niente sconto")
    assert play_card(few, "m", cost: 3)[:ok]
  end

  # L'esilio all'assegnazione: «quando assegni questa carta a un'Entità», un'Entità avversaria nell'Abisso finché l'Oggetto resta in gioco.
  def test_assign_exile_holds_opposing_entity_while_item_stays
    engine = legacy_scene([["u", "HUMAN"], ["p", "PRISM", { "zone" => "hand" }]], b: [["b1", "AUROS"], ["b2", "AUROS"]])
    ref = { "source" => "p", "event" => "on_assign_object", "entering" => "u" }
    step_action = { "t" => "toZone", "uid" => "b1", "zone" => "abisso", "heldBy" => "p", "effect" => ref }
    assert_match(/non è in campo/, engine.judge(step_action)[:reason], "dalla mano non innesca")
    assert engine.judge({ "t" => "assign", "uid" => "p", "to" => "u" })[:ok]
    assert play_card(engine, "p", cost: 3, x: 470, y: 1288)[:ok]
    assert_match(/a cui l'Oggetto è assegnato/, engine.judge(step_action.merge("effect" => ref.merge("entering" => "b1")))[:reason])
    assert_match(/tenuta da questo Oggetto/, engine.judge(step_action.reject { |k, _| k == "heldBy" })[:reason])
    assert_match(/avversario/, engine.judge(step_action.merge("uid" => "u"))[:reason])
    verdict = engine.judge(step_action)
    assert verdict[:ok], verdict[:reason]
    assert_equal "abisso", table_copy(engine).card("b1")[:zone]
    assert_equal "p", table_copy(engine).card("b1")[:held_by]
    assert_match(/già stato risolto/, engine.judge(step_action.merge("uid" => "b2"))[:reason], "un'assegnazione, un innesco")
    assert_match(/resta nell'Abisso/, engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "x" => 442, "y" => 172 })[:reason])
    # L'Oggetto esce dal campo seguendo la sua Entità (dal 2026-09-11 non si ritira da solo, §6.2).
    assert_match(/non si ritira da solo/, engine.judge({ "t" => "toZone", "uid" => "p", "zone" => "ritiro" })[:reason])
    assert engine.judge({ "t" => "toZone", "uid" => "u", "zone" => "ritiro" })[:ok]
    assert_equal "ritiro", table_copy(engine).card("p")[:zone]
    comeback = engine.judge({ "t" => "release", "uid" => "b1", "zone" => "field", "x" => 442, "y" => 172 })
    assert comeback[:ok], comeback[:reason]
    assert_equal "field", table_copy(engine).card("b1")[:zone]
  end

  def test_assign_exile_belongs_only_to_certified_item
    engine = legacy_scene([["u", "HUMAN"], ["s", "SHIELD", { "assignedTo" => "u" }]], b: [["b1", "AUROS"]])
    verdict = engine.judge({ "t" => "toZone", "uid" => "b1", "zone" => "abisso", "heldBy" => "s", "effect" => { "source" => "s", "event" => "on_assign_object", "entering" => "u" } })
    assert_match(/quando assegni/, verdict[:reason])
    assert_includes verdict[:reason_en], "(§8.2)"
    unknown = legacy_scene([["u", "HUMAN"], ["z", "UNKNOWN", { "assignedTo" => "u" }]], b: [["b1", "AUROS"]])
    refute unknown.judge({ "t" => "toZone", "uid" => "b1", "zone" => "abisso", "heldBy" => "z", "effect" => { "source" => "z", "event" => "on_assign_object", "entering" => "u" } })[:ruled]
  end

  # Il prosciugamento: il Rubyfront/Nexus avversario perde PV pari ai propri Oggetti assegnati.
  def test_drain_removes_one_hp_per_assigned_item
    engine = legacy_scene([["u", "HUMAN"], ["uo", "SHIELD", { "assignedTo" => "u" }], ["uo2", "THORNS", { "assignedTo" => "u" }], ["v", "HUMAN"], ["vo", "SHIELD", { "assignedTo" => "v" }],
                      ["free", "SHIELD"], ["m", "ASSAULT", { "zone" => "hand" }]])
    assert play_card(engine, "m", cost: 4)[:ok]
    accept!(engine, "b")
    step_action = { "t" => "player", "seat" => "b", "patch" => { "hp" => 17 }, "effect" => res_ref("m") }
    assert_match(/avversario/, engine.judge(step_action.merge("seat" => "a"))[:reason])
    assert_match(/toglie 3 PV/, engine.judge(step_action.merge("patch" => { "hp" => 18 }))[:reason], "tre Oggetti addosso: quello libero non conta")
    verdict = engine.judge(step_action)
    assert verdict[:ok], verdict[:reason]
    assert_equal 17, table_copy(engine).hp("b")
    assert_match(/già stato risolto/, engine.judge(step_action.merge("patch" => { "hp" => 14 }))[:reason])
    bare = legacy_scene([["u", "HUMAN"], ["m", "ASSAULT", { "zone" => "hand" }]])
    assert play_card(bare, "m", cost: 4)[:ok]
    accept!(bare, "b")
    verdict = bare.judge({ "t" => "player", "seat" => "b", "patch" => { "hp" => 20 }, "effect" => res_ref("m") })
    assert_match(/senza Oggetti/, verdict[:reason])
    assert_includes verdict[:reason_en], "(§8.2)"
  end

  # «Distruggi un'Entità avversaria. Poi perdi 2 PV».
  def test_destroy_with_follow_loses_hp_after
    engine = legacy_scene([["u", "HUMAN"], ["m", "SUBVERSION", { "zone" => "hand" }]], b: [["b1", "AUROS"]])
    assert play_card(engine, "m", cost: 3)[:ok]
    accept!(engine, "b")
    loss = { "t" => "player", "seat" => "a", "patch" => { "hp" => 18 }, "effect" => res_ref("m") }
    assert_match(/prima la distruzione/, engine.judge(loss)[:reason])
    assert engine.judge({ "t" => "toZone", "uid" => "b1", "zone" => "abisso", "effect" => res_ref("m") })[:ok]
    assert_match(/chi comanda la fonte/, engine.judge(loss.merge("seat" => "b", "patch" => { "hp" => 18 }))[:reason])
    assert_match(/perdi 2 PV/, engine.judge(loss.merge("patch" => { "hp" => 19 }))[:reason])
    verdict = engine.judge(loss)
    assert verdict[:ok], verdict[:reason]
    assert_equal 18, table_copy(engine).hp("a")
    assert_match(/già stato risolto/, engine.judge(loss.merge("patch" => { "hp" => 16 }))[:reason])
  end

  # Lo sconto d'assegnazione e la pesca «quando assegni un Oggetto a questa Entità».
  def test_bearer_discounts_received_items_and_draws
    engine = legacy_scene([["p", "BEARER"], ["u", "HUMAN"], ["s", "SHIELD", { "zone" => "hand" }], ["s2", "SHIELD", { "zone" => "hand" }], ["d", "AUROS", { "zone" => "deck" }]])
    assert engine.judge({ "t" => "assign", "uid" => "s", "to" => "p" })[:ok]
    assert_match(/costa 1 di Flusso/, play_card(engine, "s", cost: 2, x: 470, y: 1288)[:reason], "sul portatore lo Scudo costa 1")
    assert play_card(engine, "s", cost: 1, x: 470, y: 1288)[:ok]
    assert engine.judge({ "t" => "assign", "uid" => "s2", "to" => "u" })[:ok]
    assert_match(/costa 2 di Flusso/, play_card(engine, "s2", cost: 1, x: 850, y: 1288)[:reason], "su un altro, prezzo pieno")
    drawing = { "t" => "draw", "seat" => "a", "count" => 1, "effect" => { "source" => "p", "event" => "on_assign_object", "entering" => "s" } }
    assert_match(/pesca chi comanda l'Entità, 1/, engine.judge(drawing.merge("count" => 2))[:reason])
    assert_match(/Oggetto assegnato a questa Entità/, engine.judge(drawing.merge("effect" => drawing["effect"].merge("entering" => "s2")))[:reason])
    verdict = engine.judge(drawing)
    assert verdict[:ok], verdict[:reason]
    assert_match(/già stato risolto/, engine.judge(drawing)[:reason])
    assert_includes engine.judge(drawing)[:reason_en], "(§8.2)"
    without = legacy_scene([["u", "HUMAN"], ["s", "SHIELD", { "assignedTo" => "u" }]])
    verdict = without.judge({ "t" => "draw", "seat" => "a", "count" => 1, "effect" => { "source" => "u", "event" => "on_assign_object", "entering" => "s" } })
    assert_match(/quando le assegni un Oggetto/, verdict[:reason])
  end

  # L'aura delle armate: «le altre Entità con un Oggetto assegnato che controlli hanno +1».
  def test_aura_gives_one_to_other_armed_not_self_nor_bare
    # L'Auros armato: 2 + 1 dello Scudo + 1 dell'aura = 4. L'aura stessa, armata: 5 + 1 dello Scudo, senza aura su di sé.
    engine = legacy_scene([["l", "BLADE"], ["lo", "SHIELD", { "assignedTo" => "l" }], ["r", "AUROS"], ["ro", "SHIELD", { "assignedTo" => "r" }], ["n", "AUROS"]], attacks: %w[l r n])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/non torna/, resolve_with(engine, [outcome("l", damage: 7), outcome("r", damage: 4), outcome("n", damage: 2)])[:reason])
    assert_match(/non torna/, resolve_with(engine, [outcome("l", damage: 6), outcome("r", damage: 3), outcome("n", damage: 2)])[:reason])
    assert_match(/non torna/, resolve_with(engine, [outcome("l", damage: 6), outcome("r", damage: 4), outcome("n", damage: 3)])[:reason], "la nuda non prende l'aura")
    verdict = resolve_with(engine, [outcome("l", damage: 6), outcome("r", damage: 4), outcome("n", damage: 2)])
    assert verdict[:ok], verdict[:reason]
  end

  # La ricerca col dado: guarda le prime 5, mostra per fascia o una in cima, poi una in Ritiro.
  def test_die_search_shows_by_band_or_puts_one_on_top
    sample_deck = [["d0", "AUROS"], ["d1", "AUROS"], ["d2", "SHIELD"], ["d3", "PERMANENT"], ["d4", "HUMAN"], ["d5", "AUROS"], ["d6", "HUMAN"]]
    deck = sample_deck.map.with_index { |(uid, id), i| [uid, id, { "zone" => "deck", "order" => i }] }
    # La Pesca del turno 3 prende «d0»: guardate d1…d5, sotto resta d6.
    engine = legacy_scene([["u", "HUMAN"], ["m", "CHARGE", { "zone" => "hand" }]] + deck)
    assert play_card(engine, "m", cost: 3)[:ok]
    accept!(engine, "b")
    look = { "t" => "look", "seat" => "a", "count" => 5, "roll" => 16, "reveal" => "d1", "retire" => "d2", "revealTo" => "hand", "restTo" => "deck", "effect" => res_ref("m") }
    assert_match(/tiro valido/, engine.judge(look.merge("roll" => 21))[:reason])
    assert_match(/prime 5/, engine.judge(look.merge("count" => 4))[:reason])
    assert_match(/solo un'Entità/, engine.judge(look.merge("reveal" => "d2"))[:reason], "con 16 si mostra un'Entità")
    assert_match(/solo un Oggetto/, engine.judge(look.merge("roll" => 9))[:reason])
    assert_match(/nessuna torna in cima/, engine.judge(look.merge("top" => "d3"))[:reason])
    assert_match(/una delle altre carte va nella Zona di Ritiro/, engine.judge(look.reject { |k, _| k == "retire" })[:reason])
    assert_match(/una delle altre carte va nella Zona di Ritiro/, engine.judge(look.merge("retire" => "d1"))[:reason], "non la mostrata")
    without = look.reject { |k, _| k == "reveal" }
    assert_match(/una delle guardate va in cima/, engine.judge(without)[:reason])
    assert_match(/una delle guardate va in cima/, engine.judge(without.merge("top" => "d6"))[:reason], "fra le guardate")
    verdict = engine.judge(look)
    assert verdict[:ok], verdict[:reason]
    assert_equal "hand", table_copy(engine).card("d1")[:zone]
    assert_equal "ritiro", table_copy(engine).card("d2")[:zone]
    assert_equal %w[d6 d3 d4 d5], table_copy(engine).top_of_deck("a", 4), "le altre in fondo, nell'ordine"
    assert_match(/già stato risolto/, engine.judge(look)[:reason])
    top_card = legacy_scene([["u", "HUMAN"], ["m", "CHARGE", { "zone" => "hand" }]] + deck)
    assert play_card(top_card, "m", cost: 3)[:ok]
    accept!(top_card, "b")
    verdict = top_card.judge(without.merge("top" => "d3", "retire" => "d4"))
    assert verdict[:ok], verdict[:reason]
    assert_equal %w[d3 d6 d1 d2 d5], table_copy(top_card).top_of_deck("a", 5), "la scelta resta in cima, le altre in fondo"
    assert_equal "ritiro", table_copy(top_card).card("d4")[:zone]
  end

  # Il Rubyfront «la prima volta in ogni tuo turno che assegni un Oggetto»: gli estremi del mazzo.
  def test_rubyfront_swaps_deck_ends_then_draws_and_discards_once_per_turn
    deck = [["d0", "AUROS"], ["d1", "AUROS"], ["d2", "SHIELD"], ["d3", "HUMAN"]].map.with_index { |(uid, id), i| [uid, id, { "zone" => "deck", "order" => i }] }
    engine = legacy_scene([["forgia", "FORGE", { "y" => 1260 }], ["u", "HUMAN"], ["s", "SHIELD", { "zone" => "hand" }], ["s2", "SHIELD", { "zone" => "hand" }]] + deck)
    ref = { "source" => "forgia", "event" => "on_assign_object", "entering" => "s", "once" => true }
    ends = { "t" => "ends", "seat" => "a", "swap" => true, "effect" => ref }
    assert_match(/non lo è/, engine.judge(ends)[:reason], "l'Oggetto non è ancora assegnato")
    assert engine.judge({ "t" => "assign", "uid" => "s", "to" => "u" })[:ok]
    assert play_card(engine, "s", cost: 2, x: 470, y: 1288)[:ok]
    assert_match(/prima volta nel turno/, engine.judge(ends.merge("effect" => ref.reject { |k, _| k == "once" }))[:reason])
    assert_match(/non lo è/, engine.judge(ends.merge("effect" => ref.merge("entering" => "u")))[:reason])
    assert_match(/scambia la prima e l'ultima/, engine.judge(ends.merge("swap" => nil, "toHand" => "d1"))[:reason], "questa faccia non mette in mano")
    assert_equal %w[d1 d2 d3], table_copy(engine).top_of_deck("a", 3)
    verdict = engine.judge(ends)
    assert verdict[:ok], verdict[:reason]
    assert_equal %w[d3 d2 d1], table_copy(engine).top_of_deck("a", 3), "prima e ultima scambiate"
    assert_match(/già scattato in questo turno/, engine.judge(ends)[:reason])
    discarded = { "t" => "toZone", "uid" => "s2", "zone" => "ritiro", "effect" => ref.merge("follow" => "discard") }
    assert_match(/prima si pesca/, engine.judge(discarded)[:reason])
    drawing = { "t" => "draw", "seat" => "a", "count" => 1, "effect" => ref.merge("follow" => "draw") }
    assert_match(/pesca 1/, engine.judge(drawing.merge("count" => 2))[:reason])
    assert engine.judge(drawing)[:ok]
    assert_equal "hand", table_copy(engine).card("d3")[:zone]
    assert_match(/già stato fatto/, engine.judge(drawing)[:reason])
    assert_match(/dalla propria mano/, engine.judge(discarded.merge("uid" => "u"))[:reason])
    assert engine.judge(discarded)[:ok]
    assert_equal "ritiro", table_copy(engine).card("s2")[:zone]
    assert_match(/già stato fatto/, engine.judge(discarded.merge("uid" => "d3"))[:reason])
  end

  def test_nexus_puts_one_end_in_hand_and_other_in_retire
    deck = [["d0", "AUROS"], ["d1", "AUROS"], ["d2", "SHIELD"], ["d3", "HUMAN"]].map.with_index { |(uid, id), i| [uid, id, { "zone" => "deck", "order" => i }] }
    engine = legacy_scene([["forgia", "FORGE", { "y" => 1260, "face" => 1 }], ["u", "HUMAN"], ["s", "SHIELD", { "zone" => "hand" }]] + deck)
    assert engine.judge({ "t" => "assign", "uid" => "s", "to" => "u" })[:ok]
    assert play_card(engine, "s", cost: 2, x: 470, y: 1288)[:ok]
    ref = { "source" => "forgia", "event" => "on_assign_object", "entering" => "s", "once" => true }
    ends = { "t" => "ends", "seat" => "a", "toHand" => "d3", "toRetire" => "d1", "effect" => ref }
    assert_match(/non scambia/, engine.judge(ends.merge("swap" => true))[:reason])
    assert_match(/la prima o l'ultima/, engine.judge(ends.merge("toHand" => "d2"))[:reason])
    assert_match(/l'altra va nella Zona di Ritiro/, engine.judge(ends.merge("toRetire" => "d2"))[:reason])
    verdict = engine.judge(ends)
    assert verdict[:ok], verdict[:reason]
    assert_equal "hand", table_copy(engine).card("d3")[:zone]
    assert_equal "ritiro", table_copy(engine).card("d1")[:zone]
    assert_equal %w[d2], table_copy(engine).top_of_deck("a", 3)
    assert_match(/il seguito pesca 0/, engine.judge({ "t" => "draw", "seat" => "a", "count" => 1, "effect" => ref.merge("follow" => "draw") })[:reason], "il Nexus non pesca")
    # Nel turno altrui non scatta.
    foreign = legacy_scene([["forgia", "FORGE", { "y" => 1260, "face" => 1 }], ["u", "HUMAN"], ["s", "SHIELD", { "assignedTo" => "u" }]] + deck)
    foreign.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    assert_match(/nel proprio turno/, foreign.judge(ends)[:reason])
  end

  # «Quando quell'Entità muore, metti questo Oggetto in Ritiro invece che nell'Abisso; poi puoi riarmare».
  def test_vestige_stays_in_retire_on_bearer_death_and_rearms_unarmed
    engine = legacy_scene([["u", "HUMAN"], ["v", "VESTIGE", { "assignedTo" => "u" }], ["w", "SHIELD", { "zone" => "ritiro" }], ["n", "AUROS"], ["z", "AUROS"], ["zo", "THORNS", { "assignedTo" => "z" }]],
                     b: [["g", "BIG"]], attacks: ["u"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert block_action(engine, "g", "u")[:ok]
    ref = { "source" => "v", "event" => "on_death", "entering" => "u" }
    stays = { "t" => "remain", "uid" => "v", "effect" => ref }
    assert_match(/seguito questo turno/, engine.judge(stays)[:reason], "prima che muoia, niente")
    # UMANO 2 + 2 del Vestigio = 4 contro GROSSO 4: muoiono entrambi.
    verdict = resolve_with(engine, [outcome("u", blocker: "g", kind: "block", attacker_dies: true, blocker_dies: true)])
    assert verdict[:ok], verdict[:reason]
    assert_equal "abisso", table_copy(engine).card("v")[:zone]
    assert_match(/seguito questo turno/, engine.judge(stays.merge("effect" => ref.merge("entering" => "g")))[:reason])
    assert_match(/azione `remain`/, engine.judge(stays.merge("uid" => "u"))[:reason])
    verdict = engine.judge(stays)
    assert verdict[:ok], verdict[:reason]
    assert_equal "ritiro", table_copy(engine).card("v")[:zone]
    assert_match(/già stato risolto/, engine.judge(stays)[:reason])
    rearming = { "t" => "toZone", "uid" => "w", "zone" => "field", "x" => 1230, "y" => 1288, "assignTo" => "n", "effect" => ref.merge("follow" => "rearm") }
    assert_match(/ALTRO Oggetto/, engine.judge(rearming.merge("uid" => "v"))[:reason])
    assert_match(/SENZA Oggetto/, engine.judge(rearming.merge("assignTo" => "z"))[:reason])
    assert_match(/senza pagarne il costo/, engine.judge(rearming.merge("cost" => 2))[:reason])
    verdict = engine.judge(rearming)
    assert verdict[:ok], verdict[:reason]
    assert_equal "field", table_copy(engine).card("w")[:zone]
    assert_equal "n", table_copy(engine).card("w")[:assigned_to]
    assert_match(/già stato fatto/, engine.judge(rearming.merge("uid" => "v"))[:reason])
    bare = legacy_scene([["u", "HUMAN"], ["s", "SHIELD", { "assignedTo" => "u" }]])
    verdict = bare.judge({ "t" => "remain", "uid" => "s", "effect" => { "source" => "s", "event" => "on_death", "entering" => "u" } })
    assert_match(/quando quell'Entità muore/, verdict[:reason])
    assert_includes verdict[:reason_en], "(§8.2)"
  end

  def test_item_stays_even_if_defender_closed_turn
    # La Reazione la chiude il difensore in un fiato: risoluzione e cambio di
    # turno. La scena del proprietario arriva dopo, nella Preparazione del
    # turno nuovo: l'innesco vale ancora — non oltre.
    engine = legacy_scene([["u", "HUMAN"], ["v", "VESTIGE", { "assignedTo" => "u" }]], b: [["g", "BIG"]], attacks: ["u"])
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert block_action(engine, "g", "u")[:ok]
    assert resolve_with(engine, [outcome("u", blocker: "g", kind: "block", attacker_dies: true, blocker_dies: true)])[:ok]
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    stays = { "t" => "remain", "uid" => "v", "effect" => { "source" => "v", "event" => "on_death", "entering" => "u" } }
    verdict = engine.judge(stays)
    assert verdict[:ok], verdict[:reason]
    late = legacy_scene([["u", "HUMAN"], ["v", "VESTIGE", { "assignedTo" => "u" }]], b: [["g", "BIG"]], attacks: ["u"])
    late.judge({ "t" => "phase", "phase" => "reazione" })
    assert block_action(late, "g", "u")[:ok]
    assert resolve_with(late, [outcome("u", blocker: "g", kind: "block", attacker_dies: true, blocker_dies: true)])[:ok]
    late.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    late.judge({ "t" => "phase", "phase" => "fronte" })
    assert_match(/seguito questo turno/, late.judge(stays)[:reason], "in Fronte del turno dopo, l'innesco è passato")
  end

  # --- §3.2: la tassa di Flusso viaggia nel cambio di turno ---------------------

  TOLLS = LEGACY.merge(
    "TOLLKEEPER" => { type: "entity", keywords: [], race: "auros", power: 3, flux_cost: 3,
                      static_forms: [{ kind: "flux_toll", amount: 1 }] }
  ).freeze

  def test_incoming_flux_toll_must_match_and_is_paid_on_refill
    engine = Rubyfront::Engine.new(cards: TOLLS)
    load = lambda do |seat, list|
      cards = list.map.with_index { |(uid, id), i| { "uid" => uid, "owner" => seat, "zone" => "field", "order" => i, "cardId" => id, "y" => seat == "a" ? 1260 : 172 } }
      engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    end
    load.call("a", [["g1", "TOLLKEEPER"], ["g2", "TOLLKEEPER"], ["u", "HUMAN"]])
    load.call("b", [["x", "AUROS"]])
    assert engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" }, actor: "a")[:ok], "B non ha tasse: senza toll"
    assert_match(/tassa di Flusso di chi entra è 2, non 0/, engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" }, actor: "b")[:reason])
    assert_match(/è 2, non 1/, engine.judge({ "t" => "turn", "turn" => 3, "active" => "a", "toll" => 1 }, actor: "b")[:reason])
    verdict = engine.judge({ "t" => "turn", "turn" => 3, "active" => "a", "toll" => 2 }, actor: "b")
    assert verdict[:ok], verdict[:reason]
    table = table_copy(engine)
    assert_equal 2, table.flux_max("a")
    assert_equal 0, table.flux("a"), "2 di massimo meno 2 di tassa"
    # In Ritiro non tassa più.
    engine.judge({ "t" => "toZone", "uid" => "g1", "zone" => "ritiro" }, actor: "a")
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" }, actor: "a")
    assert_match(/è 1, non 2/, engine.judge({ "t" => "turn", "turn" => 5, "active" => "a", "toll" => 2 }, actor: "b")[:reason])
    assert engine.judge({ "t" => "turn", "turn" => 5, "active" => "a", "toll" => 1 }, actor: "b")[:ok]
    assert_equal 2, table_copy(engine).flux("a"), "3 di massimo meno 1"
  end

  # --- §3.1: le abilità speciali del Rubyfront, con la Furia (§8.1) ------------

  ABILITIES = LEGACY.merge(
    "ARCANE" => { type: "rubyfront", keywords: ["fury"], health: 21, fury_at: { 0 => 13 },
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
                    { id: "chiamata", face: 1, timing: %w[preparazione fronte], cost: 7, gain: nil, fury: false,
                      form: { kind: "summon", race: "human", grants: ["surge"], bonus: { amount: 1, race: "human" } } },
                  ] },
    "IRON" => { type: "object", keywords: [], flux_cost: 2 },
    "GEM" => { type: "object", keywords: [], flux_cost: 1 }
  ).freeze

  # A ha il Rubyfront ARCANO schierato, due Umani e un Auros sul Fronte, un
  # Oggetto addosso all'Umano u1; in mano un Oggetto (FERRO) e un Umano.
  def arcane(y: 1260, hand: [], face: 0)
    engine = Rubyfront::Engine.new(cards: ABILITIES)
    a = [["u1", "HUMAN"], ["u2", "HUMAN"], ["x", "AUROS"], ["rf", "ARCANE", { "y" => y, "face" => face }],
         ["o1", "IRON", { "assignedTo" => "u1" }], ["h1", "IRON", { "zone" => "hand" }], ["h2", "RUNNER", { "zone" => "hand" }]] + hand
    b = [["b1", "AUROS"], ["rf-b", "RUBY", { "y" => 172 }]]
    load = lambda do |seat, list|
      cards = list.map.with_index do |(uid, id, extra), i|
        { "uid" => uid, "owner" => seat, "zone" => "field", "order" => i, "cardId" => id, "y" => seat == "a" ? 1260 : 172 }.merge(extra || {})
      end
      deck = { "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards }
      deck["hp"] = 21 if seat == "a"
      engine.judge(deck)
    end
    load.call("a", a + (1..4).map { |i| ["d#{i}", i.odd? ? "HUMAN" : "AUROS", { "zone" => "deck" }] })
    load.call("b", b)
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    Rubyfront::Table::SEATS.each { |seat| engine.judge({ "t" => "player", "seat" => seat, "patch" => { "flux" => 10, "fluxMax" => 10 } }) }
    engine
  end

  def ability_action(engine, id, cost: nil, gain: nil, roll: nil, fail: nil, targets: nil, power: nil, discount: nil, bonus: nil, actor: "a")
    action = { "t" => "ability", "uid" => "rf", "ability" => id }
    action["bonus"] = bonus unless bonus.nil?
    action["cost"] = cost unless cost.nil?
    action["gain"] = gain unless gain.nil?
    action["roll"] = roll unless roll.nil?
    action["fail"] = fail unless fail.nil?
    action["targets"] = targets unless targets.nil?
    action["power"] = power unless power.nil?
    action["discount"] = discount unless discount.nil?
    engine.judge(action, actor: actor)
  end

  def test_ability_pays_or_recovers_printed_hp_and_needs_fury_roll
    engine = arcane
    assert_match(/costa 5 PV/, ability_action(engine, "carica", cost: 4, roll: 15, fail: false, targets: [], power: 1)[:reason])
    assert_match(/non porta un tiro valido/, ability_action(engine, "carica", cost: 5, targets: [], power: 1)[:reason])
    assert_match(/col 7 l'esito dev'essere il fallimento/, ability_action(engine, "carica", cost: 5, roll: 7, fail: false, targets: [], power: 1)[:reason])
    verdict = ability_action(engine, "carica", cost: 5, roll: 7, fail: true, targets: [], power: 1)
    assert verdict[:ok], verdict[:reason]
    assert_equal 15, table_copy(engine).hp("a"), "5 di costo e 1 di Furia fallita"
    assert_match(/una sola abilità speciale per turno/, ability_action(engine, "sguardo", gain: 3, roll: 13, fail: false)[:reason], "la seconda nel turno non passa")
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" }, actor: "a")
    engine.judge({ "t" => "turn", "turn" => 5, "active" => "a" }, actor: "b")
    verdict = ability_action(engine, "sguardo", gain: 3, roll: 13, fail: false)
    assert verdict[:ok], verdict[:reason]
    assert_equal 18, table_copy(engine).hp("a"), "il recupero, al turno dopo"
    assert_match(/non tira la Furia/, ability_action(arcane, "sconto", cost: 3, roll: 20, fail: false, discount: { "amount" => 1, "type" => "object", "race" => nil })[:reason])
  end

  def test_ability_needs_enough_hp_field_turn_and_window
    engine = arcane
    engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 4 } })
    assert_match(/servono 5 PV, ne hai 4/, ability_action(engine, "carica", cost: 5, roll: 15, fail: false, targets: [], power: 1)[:reason])
    engine.judge({ "t" => "player", "seat" => "a", "patch" => { "hp" => 5 } })
    assert ability_action(engine, "carica", cost: 5, roll: 15, fail: false, targets: [], power: 1)[:ok], "pagare fino a 0 esatto è legale"
    assert_match(/una sola abilità speciale per turno/, ability_action(engine, "sguardo", gain: 3, roll: 15, fail: false)[:reason])
    assert_match(/Zona di Richiamo/, ability_action(arcane(y: 1756), "sconto", cost: 3, discount: { "amount" => 1, "type" => "object", "race" => nil })[:reason])
    assert_match(/non tocca a te/, ability_action(arcane, "sconto", cost: 3, discount: { "amount" => 1, "type" => "object", "race" => nil }, actor: "b")[:reason])
    engine = arcane
    front!(engine)
    assert_match(/in Fase di Preparazione \(§3.1\)/, ability_action(engine, "sconto", cost: 3, discount: { "amount" => 1, "type" => "object", "race" => nil })[:reason], "lo sconto è solo di Preparazione")
    assert_match(/non ha quell'abilità/, ability_action(engine, "passo", gain: 3, discount: { "amount" => 1, "type" => "entity", "race" => "human" })[:reason], "abilità dell'altra faccia")
    assert_match(/resta a mano/, ability_action(arcane, "ignota", cost: 7)[:reason])
  end

  # Il flip riapre la finestra dell'abilità: usata quella del Rubyfront, dopo
  # il flip vale anche una del Nexus — una, poi la finestra è chiusa.
  def test_flip_reopens_ability_window_in_turn
    engine = arcane
    assert ability_action(engine, "sguardo", gain: 3, roll: 15, fail: false)[:ok]
    assert_match(/una sola abilità speciale per turno/, ability_action(engine, "sguardo", gain: 3, roll: 15, fail: false)[:reason])
    assert flip(engine)[:ok]
    verdict = ability_action(engine, "passo", gain: 3, discount: { "amount" => 1, "type" => "entity", "race" => "human" })
    assert verdict[:ok], verdict[:reason]
    assert_match(/una sola abilità speciale per turno/, ability_action(engine, "passo", gain: 3, discount: { "amount" => 1, "type" => "entity", "race" => "human" })[:reason])
  end

  def test_ability_empower_goes_to_form_targets
    engine = arcane
    front!(engine)
    engine.judge({ "t" => "declare", "declaration" => { "id" => "u1", "from" => "u1", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 } }, actor: "a")
    assert_match(/TUTTE le Entità/, ability_action(engine, "carica", cost: 5, roll: 15, fail: false, targets: %w[u1 u2], power: 1)[:reason], "u2 non attacca")
    assert_match(/\+1 Potenza, not|\+1 Potenza, non/, ability_action(engine, "carica", cost: 5, roll: 15, fail: false, targets: %w[u1], power: 2)[:reason])
    verdict = ability_action(engine, "carica", cost: 5, roll: 15, fail: false, targets: %w[u1], power: 1)
    assert verdict[:ok], verdict[:reason]
    assert_equal 1, table_copy(engine).card("u1")[:power_bonus]
    engine = arcane
    assert_match(/UNA Entità/, ability_action(engine, "colpo", cost: 3, roll: 15, fail: false, targets: %w[u2], power: 2)[:reason], "u2 non ha Oggetti")
    assert ability_action(engine, "colpo", cost: 3, roll: 15, fail: false, targets: %w[u1], power: 2)[:ok]
    assert_equal 2, table_copy(engine).card("u1")[:power_bonus]
  end

  def test_ability_glance_resolves_after_once_per_activation
    engine = arcane
    ref = { "source" => "rf", "event" => "on_ability", "entering" => "rf", "ability" => "sguardo" }
    assert_match(/non è stata attivata/, engine.judge({ "t" => "look", "seat" => "a", "count" => 3, "effect" => ref }, actor: "a")[:reason])
    assert ability_action(engine, "sguardo", gain: 3, roll: 15, fail: false)[:ok]
    assert_match(/prime 3 carte, non 2/, engine.judge({ "t" => "look", "seat" => "a", "count" => 2, "effect" => ref }, actor: "a")[:reason])
    verdict = engine.judge({ "t" => "look", "seat" => "a", "count" => 3, "effect" => ref }, actor: "a")
    assert verdict[:ok], verdict[:reason]
    assert_match(/non è stata attivata|già stato fatto/, engine.judge({ "t" => "look", "seat" => "a", "count" => 3, "effect" => ref }, actor: "a")[:reason], "una volta sola")
  end

  def test_ability_discount_applies_to_next_card_of_type_in_turn
    engine = arcane
    assert ability_action(engine, "sconto", cost: 3, discount: { "amount" => 1, "type" => "object", "race" => nil })[:ok]
    play = lambda do |uid, cost, discount = nil|
      action = { "t" => "toZone", "uid" => uid, "zone" => "field", "x" => 632, "y" => 1260, "cost" => cost, "assignTo" => "u2" }
      action["discount"] = discount if discount
      engine.judge(action, actor: "a")
    end
    assert_match(/costa 2 di Flusso e l'azione ne paga 1/, play.call("h1", 1)[:reason], "senza dichiararlo lo sconto non c'è")
    assert_match(/nessuno sconto di 2/, play.call("h1", 0, 2)[:reason])
    verdict = play.call("h1", 1, 1)
    assert verdict[:ok], verdict[:reason]
    assert_equal 9, table_copy(engine).flux("a")
    assert_empty table_copy(engine).discounts("a"), "consumato"
    # Un'Entità non è un Oggetto: lo sconto non vale (turno nuovo: una sola abilità per turno).
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" }, actor: "a")
    engine.judge({ "t" => "turn", "turn" => 5, "active" => "a" }, actor: "b")
    assert ability_action(engine, "sconto", cost: 3, discount: { "amount" => 1, "type" => "object", "race" => nil })[:ok]
    assert_match(/nessuno sconto/, engine.judge({ "t" => "toZone", "uid" => "h2", "zone" => "field", "x" => 632, "y" => 1260, "cost" => 0, "discount" => 1 }, actor: "a")[:reason])
    engine.judge({ "t" => "turn", "turn" => 6, "active" => "b" }, actor: "a")
    assert_empty table_copy(engine).discounts("a"), "gli sconti cadono col turno"
  end

  # --- §3.1: la chiamata sul Fronte del Nexus ---------------------------------
  #
  # «Puoi mettere sul tuo Fronte un'Entità Umana dalla tua mano senza
  # pagarne il costo di Flusso. Quell'Entità ottiene Slancio fino alla fine
  # del turno, e le prossime Entità Umane che attaccano in questo turno
  # prendono +1 Potenza fino alla fine del turno» (forma `summon`).

  BONUS = { "amount" => 1, "race" => "human" }.freeze

  def summon_ref
    { "source" => "rf", "event" => "on_ability", "entering" => "rf", "ability" => "chiamata" }
  end

  def descent(uid, x: 1199, grants: ["surge"], extra: {})
    { "t" => "toZone", "uid" => uid, "zone" => "field", "x" => x, "y" => 1260, "grants" => grants, "effect" => summon_ref }.merge(extra)
  end

  def test_summon_pays_hp_and_carries_printed_promise
    engine = arcane(face: 1)
    assert_match(/promette \+1 Potenza alle prossime Entità Umane.*§3\.1/, ability_action(engine, "chiamata", cost: 7)[:reason], "senza la promessa")
    assert_match(/promette \+1 Potenza/, ability_action(engine, "chiamata", cost: 7, bonus: { "amount" => 2, "race" => "human" })[:reason])
    assert_match(/scende dopo/, ability_action(engine, "chiamata", cost: 7, bonus: BONUS, targets: ["u1"])[:reason])
    assert_match(/non ha quell'abilità/, ability_action(arcane, "chiamata", cost: 7, bonus: BONUS)[:reason], "è del Nexus, non del Rubyfront")
    verdict = ability_action(engine, "chiamata", cost: 7, bonus: BONUS)
    assert verdict[:ok], verdict[:reason]
    assert_equal 14, table_copy(engine).hp("a")
    assert_equal [{ amount: 1, race: "human" }], table_copy(engine).attack_bonuses("a")
    assert table_copy(engine).pending_ability?("rf", "chiamata"), "l'Entità dalla mano aspetta"
  end

  def test_summon_descent_is_free_human_from_hand_to_front_and_single
    engine = arcane(face: 1, hand: [["h3", "HUMAN", { "zone" => "hand" }], ["h4", "AUROS", { "zone" => "hand" }]])
    assert_match(/non è stata attivata/, engine.judge(descent("h2"))[:reason], "prima l'abilità")
    assert ability_action(engine, "chiamata", cost: 7, bonus: BONUS)[:ok]
    assert_match(/senza pagarne il costo/, engine.judge(descent("h2", extra: { "cost" => 1 }))[:reason])
    assert_match(/senza pagarne il costo/, engine.judge(descent("h2", extra: { "discount" => 1 }))[:reason])
    assert_match(/un'Entità Umana dalla propria mano/, engine.judge(descent("h4"))[:reason], "un Auros no")
    assert_match(/un'Entità Umana dalla propria mano/, engine.judge(descent("h1"))[:reason], "un Oggetto no")
    assert_match(/un'Entità Umana dalla propria mano/, engine.judge(descent("u1"))[:reason], "dal campo no")
    assert_match(/ottiene Slancio fino alla fine del turno/, engine.judge(descent("h2", grants: []))[:reason])
    assert_match(/ottiene Slancio/, engine.judge(descent("h2", grants: ["surge", "revenge"]))[:reason])
    assert_match(/slot del Fronte/, engine.judge(descent("h2", x: 2368))[:reason])
    assert_match(/non altrove/, engine.judge(descent("h2", extra: { "zone" => "ritiro" }))[:reason])
    flux = table_copy(engine).flux("a")
    verdict = engine.judge(descent("h2"))
    assert verdict[:ok], verdict[:reason]
    assert_equal "field", table_copy(engine).card("h2")[:zone]
    assert_equal ["surge"], table_copy(engine).card("h2")[:grants]
    assert_equal flux, table_copy(engine).flux("a"), "gratis"
    assert_match(/già scesa/, engine.judge(descent("h3"))[:reason], "una sola per attivazione")
  end

  def test_summon_descent_respects_full_front_and_seal
    engine = arcane(face: 1, hand: [["h3", "HUMAN", { "zone" => "hand" }], ["h4", "HUMAN", { "zone" => "hand" }]])
    assert ability_action(engine, "chiamata", cost: 7, bonus: BONUS)[:ok]
    engine.judge({ "t" => "player", "seat" => "a", "patch" => { "sealed" => ["RUNNER"] } })
    assert_match(/sigillata/, engine.judge(descent("h2"))[:reason], "la carta sigillata dal flip non scende nemmeno gratis")
    assert engine.judge(descent("h3"))[:ok]
    # Quattro Entità in campo più questa: la sesta non scende.
    assert ability_action(engine, "chiamata", cost: 7, bonus: BONUS)[:reason]
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 5, "active" => "a" })
    engine.judge({ "t" => "toZone", "uid" => "d1", "zone" => "field", "x" => 1578, "y" => 1260, "cost" => 2 }, actor: "a")
    assert_equal 5, table_copy(engine).commanded_uids("a").count { |uid| %w[HUMAN AUROS].include?(table_copy(engine).card(uid)[:card_id]) }
    assert ability_action(engine, "chiamata", cost: 7, bonus: BONUS)[:ok]
    assert_match(/Fronte è pieno/, engine.judge(descent("h4", x: 1956))[:reason])
  end

  def test_summoned_entity_attacks_at_once_and_humans_carry_bonus
    engine = arcane(face: 1)
    assert ability_action(engine, "chiamata", cost: 7, bonus: BONUS)[:ok]
    assert engine.judge(descent("h2"))[:ok]
    front!(engine)
    attack = lambda { |uid, bonus| { "t" => "declare", "declaration" => { "id" => "x", "from" => uid, "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 }.merge(bonus.nil? ? {} : { "bonus" => bonus }) } }
    assert_match(/deve portare il bonus.*§3\.1/, engine.judge(attack.call("h2", nil))[:reason], "l'Umana appena scesa attacca (Slancio) col bonus")
    assert_match(/deve portare il bonus/, engine.judge(attack.call("h2", 2))[:reason])
    verdict = engine.judge(attack.call("h2", 1))
    assert verdict[:ok], verdict[:reason]
    assert_equal 1, table_copy(engine).card("h2")[:power_bonus]
    assert engine.judge(attack.call("h2", 1))[:ok], "ridichiarare porta lo stesso bonus"
    assert_equal 1, table_copy(engine).card("h2")[:power_bonus], "e non lo prende due volte"
    assert_match(/nessun bonus è promesso/, engine.judge(attack.call("x", 1))[:reason], "un Auros no")
    assert engine.judge(attack.call("x", nil))[:ok]
    assert engine.judge(attack.call("u1", 1))[:ok], "ogni Umana che attacca dopo lo prende"
    assert engine.judge({ "t" => "undeclare", "from" => "u1" })[:ok]
    assert_nil table_copy(engine).card("u1")[:power_bonus], "ritirare l'attacco restituisce il bonus"
    engine.judge({ "t" => "clearCombat" }, actor: "a")
    passed = engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" }, actor: "a")
    assert passed[:ok], passed[:reason]
    assert_empty table_copy(engine).attack_bonuses("a"), "la promessa cade col turno"
  end

  # --- §3.1: il Nexus — il flip e «quando flippa» -----------------------------

  def nexus_ready(humans: 4, hand: [["h", "AUROS", { "zone" => "hand" }]], y: 1260)
    mine = (1..humans).map { |i| ["u#{i}", "HUMAN"] } + [["riportante", "RETURNER"], ["rf", "RALLY", { "y" => y }]] + hand + [["rip2", "RETURNER", { "zone" => "hand" }]]
    legacy_scene(mine)
  end

  def flip(engine, discard: "h", recover: 5, face: 1, actor: "a")
    engine.judge({ "t" => "flip", "uid" => "rf", "face" => face, "discard" => discard, "recover" => recover }, actor: actor)
  end

  def test_flip_needs_four_humans_discard_and_right_recovery
    assert_match(/almeno 4 Entità Umane.*ne hai 3/, flip(nexus_ready(humans: 2))[:reason])
    engine = nexus_ready
    assert_match(/scartare una carta Entità/, flip(engine, discard: nil)[:reason])
    assert_match(/scartare una carta Entità/, flip(engine, discard: "u1")[:reason], "dalla mano")
    assert_match(/recupera 5 PV, non 0/, flip(engine, recover: nil)[:reason])
    assert_match(/Zona di Richiamo/, flip(nexus_ready(y: 1756))[:reason])
    assert_match(/non tocca a te/, flip(engine, actor: "b")[:reason])
    verdict = flip(engine)
    assert verdict[:ok], verdict[:reason]
    table_setup = table_copy(engine)
    assert_equal 1, table_setup.card("rf")[:face]
    assert_equal 25, table_setup.hp("a")
    assert_equal "ritiro", table_setup.card("h")[:zone], "lo scarto del flip va in Zona di Ritiro (§5, §6.5)"
    assert_match(/non si torna al Rubyfront/, flip(engine, face: 0)[:reason])
  end

  def test_flip_in_preparation_or_front_not_reaction
    engine = nexus_ready
    front!(engine)
    engine.judge({ "t" => "declare", "declaration" => { "id" => "u1", "from" => "u1", "to" => "rf-b", "kind" => "attack", "seat" => "a", "order" => 1 } })
    engine.judge({ "t" => "phase", "phase" => "reazione" })
    assert_match(/dalla Preparazione al Fronte/, flip(engine)[:reason])
  end

  def test_on_flip_named_card_goes_to_abyss_and_is_banned
    engine = nexus_ready
    ref = { "source" => "rf", "event" => "on_flip", "entering" => "rf" }
    via = { "t" => "toZone", "uid" => "riportante", "zone" => "abisso", "effect" => ref }
    assert_match(/flippato questo turno/, engine.judge(via)[:reason])
    assert flip(engine)[:ok]
    assert_match(/dal proprio Fronte/, engine.judge(via.merge("uid" => "u1"))[:reason])
    verdict = engine.judge(via)
    assert verdict[:ok], verdict[:reason]
    assert_equal "abisso", table_copy(engine).card("riportante")[:zone]
    assert_match(/già stato risolto/, engine.judge(via)[:reason])
    seal = { "t" => "player", "seat" => "a", "patch" => { "sealed" => ["RETURNER"] }, "effect" => ref }
    assert_match(/aggiunge RETURNER/, engine.judge(seal.merge("patch" => { "sealed" => ["RETURNER", "HUMAN"] }))[:reason])
    assert engine.judge(seal)[:ok]
    assert table_copy(engine).sealed?("a", "RETURNER")
    # «Poi pesca una carta» (dal 2026-09-10).
    drawing = { "t" => "draw", "seat" => "a", "count" => 1, "effect" => ref }
    assert_match(/pesca chi comanda il Nexus, 1/, engine.judge(drawing.merge("count" => 2))[:reason])
    assert_match(/pesca chi comanda il Nexus, 1/, engine.judge(drawing.merge("seat" => "b"))[:reason])
    verdict = engine.judge(drawing)
    assert verdict[:ok], verdict[:reason]
    assert_match(/già stato risolto/, engine.judge(drawing)[:reason])
    assert_match(/non si può più giocare/, engine.judge({ "t" => "toZone", "uid" => "rip2", "zone" => "field", "x" => 442, "y" => 1260, "cost" => 6 })[:reason])
    # Il turno dopo il flip è passato: l'innesco non si riscalda.
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 5, "active" => "a" })
    assert_match(/flippato questo turno/, engine.judge(via.merge("uid" => "u2"))[:reason])
  end

  def test_armed_flip_counts_armed_entities_and_discards_any_card
    forge = lambda do |armed|
      mine = (1..3).flat_map { |i| [["u#{i}", "HUMAN"]] + (i <= armed ? [["s#{i}", "SHIELD", { "assignedTo" => "u#{i}" }]] : []) }
      legacy_scene(mine + [["rf", "FORGE", { "y" => 1260 }], ["m", "STONE", { "zone" => "hand" }]])
    end
    assert_match(/almeno 3 Entità con un Oggetto assegnato.*ne hai 2/, flip(forge.call(2), discard: "m")[:reason])
    engine = forge.call(3)
    assert_match(/scartare una carta dalla mano/, flip(engine, discard: nil)[:reason])
    verdict = flip(engine, discard: "m")
    assert verdict[:ok], verdict[:reason]
    assert_equal "ritiro", engine.instance_variable_get(:@table).card("m")[:zone]
  end

  def test_rubyfront_without_certified_requirement_flips_by_hand
    engine = legacy_scene([["rf", "RUBY", { "y" => 1260 }]])
    refute engine.judge({ "t" => "flip", "uid" => "rf", "face" => 1 })[:ruled]
  end

  # --- §8.2: il disarmo con riarmo all'ingresso e il ritorno vincolato -------
  # Le forme certificate del 2026-09-10: «quando entra, ogni Oggetto
  # assegnato a un'Entità avversaria nella Zona di Ritiro del proprietario,
  # poi gli Oggetti del tuo Ritiro alle tue Entità, gratis» e «mandata
  # nell'Abisso o in Ritiro senza Oggetti addosso, torna sul Fronte con un
  # Oggetto entro il costo dal tuo Ritiro». Fixture a etichette di forma.

  DISARMS = {
    "DISARMER" => { type: "entity", keywords: [], race: "auros", power: 4, flux_cost: 4,
                 enter_disarms: [{ to: "ritiro" }], enter_rearms: [{ any: true }] },
    "SMITH" => { type: "entity", keywords: [], race: "auros", power: 2, flux_cost: 3, enter_rearms: [{ self: true }] },
    "REVIVED" => { type: "entity", keywords: [], race: "auros", power: 1, flux_cost: 1, leave_returns: [{ max_cost: 2 }] },
    "HUMAN" => { type: "entity", keywords: [], race: "human", power: 2, flux_cost: 2 },
    "THORNY" => { type: "entity", keywords: [], race: "human", power: 2, counterattack: 1, flux_cost: 3 },
    "BLADE" => { type: "object", keywords: [], flux_cost: 2 },
    "MACE" => { type: "object", keywords: [], flux_cost: 3 },
    "RUBY" => { type: "rubyfront", keywords: [], power: nil, counterattack: nil },
  }.freeze

  # Tavolo al turno 3 di A, con 10 Flusso: le liste sono [uid, id, extra].
  def disarm_scene(a, b: [])
    engine = Rubyfront::Engine.new(cards: DISARMS)
    load = lambda do |seat, list|
      cards = list.map.with_index do |(uid, id, extra), i|
        { "uid" => uid, "owner" => seat, "zone" => "field", "order" => i, "cardId" => id, "y" => seat == "a" ? 1260 : 172 }.merge(extra || {})
      end
      engine.judge({ "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards })
    end
    load.call("a", a + [["rf-a", "RUBY", { "y" => 1260 }]])
    load.call("b", b + [["rf-b", "RUBY", { "y" => 172 }]])
    engine.judge({ "t" => "turn", "turn" => 2, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 3, "active" => "a" })
    Rubyfront::Table::SEATS.each { |seat| engine.judge({ "t" => "player", "seat" => seat, "patch" => { "flux" => 10, "fluxMax" => 10 } }) }
    engine
  end

  def disarmer_enters(engine)
    verdict = engine.judge({ "t" => "toZone", "uid" => "dis", "zone" => "field", "x" => 821, "y" => 1260, "cost" => 4 })
    raise "l'ingresso non passa: #{verdict[:reason]}" unless verdict[:ok]
    engine
  end

  def disarm_action(engine, uid, zone: "ritiro")
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => zone,
                   "effect" => { "source" => "dis", "event" => "on_enter_field", "entering" => "dis", "follow" => "disarm" } })
  end

  def rearm_action(engine, uid, to, extra = {})
    engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => 472, "y" => 1266, "assignTo" => to,
                   "effect" => { "source" => "dis", "event" => "on_enter_field", "entering" => "dis", "follow" => "rearm" } }.merge(extra))
  end

  def disarmer_on_field(hand_objects: [])
    engine = disarm_scene(
      [["dis", "DISARMER", { "zone" => "hand" }], ["mio", "HUMAN", { "x" => 442 }], ["lama-a", "BLADE", { "zone" => "ritiro" }], ["mazza-a", "MACE", { "zone" => "ritiro" }]] + hand_objects,
      b: [["suo", "HUMAN", { "x" => 442 }], ["lama-b", "BLADE", { "x" => 472, "y" => 202, "assignedTo" => "suo" }], ["mazza-b", "MACE", { "zone" => "ritiro" }]]
    )
    disarmer_enters(engine)
  end

  def test_disarm_retires_item_on_opposing_entity
    engine = disarmer_on_field
    verdict = disarm_action(engine, "lama-b")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    card = engine.instance_variable_get(:@table).card("lama-b")
    assert_equal "ritiro", card[:zone]
    assert_nil card[:assigned_to]
  end

  def test_disarm_spares_own_loose_items_and_entities
    engine = disarmer_on_field
    engine.judge({ "t" => "toZone", "uid" => "mazza-b", "zone" => "field", "x" => 821, "y" => 172 }, actor: "b")
    refute disarm_action(engine, "mazza-b")[:ok], "un Oggetto avversario non assegnato non si disarma"
    refute disarm_action(engine, "suo")[:ok], "un'Entità non è un Oggetto"
    engine.judge({ "t" => "toZone", "uid" => "lama-a", "zone" => "field", "x" => 472, "y" => 1266, "assignTo" => "mio" })
    refute disarm_action(engine, "lama-a")[:ok], "i propri Oggetti restano addosso"
    refute disarm_action(engine, "lama-b", zone: "abisso")[:ok], "in Ritiro, non nell'Abisso"
  end

  def test_disarm_only_in_entry_turn
    engine = disarmer_on_field
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    engine.judge({ "t" => "turn", "turn" => 5, "active" => "a" })
    verdict = disarm_action(engine, "lama-b")
    refute verdict[:ok]
    assert_includes verdict[:reason], "§8.2"
  end

  def test_card_without_form_does_not_disarm
    engine = disarmer_on_field
    verdict = engine.judge({ "t" => "toZone", "uid" => "lama-b", "zone" => "ritiro",
                             "effect" => { "source" => "mio", "event" => "on_enter_field", "entering" => "mio", "follow" => "disarm" } })
    refute verdict[:ok]
  end

  def test_rearm_assigns_free_from_own_retire_any_number_of_items
    engine = disarmer_on_field
    disarm_action(engine, "lama-b")
    flux = engine.instance_variable_get(:@table).flux("a")
    verdict = rearm_action(engine, "lama-a", "mio")
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    verdict = rearm_action(engine, "mazza-a", "dis")
    assert verdict[:ok], "quanti se ne vuole: #{verdict[:reason]}"
    table = engine.instance_variable_get(:@table)
    assert_equal "mio", table.card("lama-a")[:assigned_to]
    assert_equal "dis", table.card("mazza-a")[:assigned_to]
    assert_equal flux, table.flux("a"), "senza pagarne il costo"
  end

  def test_rearm_not_from_foreign_retire_nor_onto_foreign_or_covered_entities_and_free
    engine = disarmer_on_field
    disarm_action(engine, "lama-b")
    refute rearm_action(engine, "lama-b", "mio")[:ok], "l'Oggetto disarmato è nel Ritiro del suo proprietario, non nel mio"
    refute rearm_action(engine, "lama-a", "suo")[:ok], "solo alle Entità che controllo"
    refute rearm_action(engine, "lama-a", "mio", "cost" => 2)[:ok], "gratis, non pagando"
    engine.judge({ "t" => "facedown", "uid" => "mio", "facedown" => true })
    refute rearm_action(engine, "lama-a", "mio")[:ok], "un'Entità coperta è intoccabile (§3.1)"
  end

  def test_self_rearm_on_entry_goes_on_entering_card_once
    engine = disarm_scene([["fab", "SMITH", { "zone" => "hand" }], ["mio", "HUMAN", { "x" => 442 }], ["lama-a", "BLADE", { "zone" => "ritiro" }], ["mazza-a", "MACE", { "zone" => "ritiro" }]])
    assert engine.judge({ "t" => "toZone", "uid" => "fab", "zone" => "field", "x" => 821, "y" => 1260, "cost" => 3 })[:ok]
    smith_rearm = lambda do |uid, to|
      engine.judge({ "t" => "toZone", "uid" => uid, "zone" => "field", "x" => 851, "y" => 1290, "assignTo" => to,
                     "effect" => { "source" => "fab", "event" => "on_enter_field", "entering" => "fab", "follow" => "rearm" } })
    end
    refute smith_rearm.call("lama-a", "mio")[:ok], "su di sé, non su un'altra Entità"
    verdict = smith_rearm.call("lama-a", "fab")
    assert verdict[:ok], verdict[:reason]
    assert_equal "fab", engine.instance_variable_get(:@table).card("lama-a")[:assigned_to]
    refute smith_rearm.call("mazza-a", "fab")[:ok], "una volta per ingresso"
  end

  def test_rearm_of_unknown_item_is_silent
    engine = disarmer_on_field(hand_objects: [["boh", "UNKNOWN", { "zone" => "ritiro" }]])
    refute rearm_action(engine, "boh", "mio")[:ruled]
  end

  # Il ritorno vincolato: la carta esce e torna nello stesso turno (fixture REDIVIVA).
  def revived_on_field
    disarm_scene(
      [["red", "REVIVED", { "x" => 442 }], ["lama-a", "BLADE", { "zone" => "ritiro" }], ["mazza-a", "MACE", { "zone" => "ritiro" }]],
      b: [["suo", "HUMAN", { "x" => 442 }], ["lama-b", "BLADE", { "zone" => "ritiro" }]]
    )
  end

  def come_back(engine, uid: "red", object: "lama-a", x: 821, y: 1260, actor: nil, ref: nil)
    engine.judge({ "t" => "revive", "uid" => uid, "x" => x, "y" => y, "z" => 9, "object" => object,
                   "effect" => ref || { "source" => uid, "event" => "on_leave_field", "entering" => uid } }, actor: actor)
  end

  def test_bound_return_brings_back_just_left_card_with_item_from_retire
    engine = revived_on_field
    engine.judge({ "t" => "toZone", "uid" => "red", "zone" => "ritiro" })
    verdict = come_back(engine)
    assert verdict[:ruled]
    assert verdict[:ok], verdict[:reason]
    table = engine.instance_variable_get(:@table)
    assert_equal "field", table.card("red")[:zone]
    assert_equal "field", table.card("lama-a")[:zone]
    assert_equal "red", table.card("lama-a")[:assigned_to]
    assert_nil table.card("red")[:left]
  end

  def test_bound_return_decided_by_owner
    engine = revived_on_field
    engine.judge({ "t" => "toZone", "uid" => "red", "zone" => "ritiro" })
    refute come_back(engine, actor: "b")[:ok], "lo decide il proprietario"
    assert come_back(engine, actor: "a")[:ok]
  end

  def test_bound_return_invalid_if_left_armed_or_other_turn
    engine = disarm_scene([["red", "REVIVED", { "x" => 442 }], ["mazza-a", "MACE", { "x" => 472, "y" => 1266, "assignedTo" => "red" }], ["lama-a", "BLADE", { "zone" => "ritiro" }]])
    engine.judge({ "t" => "toZone", "uid" => "red", "zone" => "ritiro" })
    verdict = come_back(engine)
    refute verdict[:ok]
    assert_includes verdict[:reason], "Oggetti addosso"

    engine = revived_on_field
    engine.judge({ "t" => "toZone", "uid" => "red", "zone" => "ritiro" })
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    assert come_back(engine, actor: "a")[:ok], "nella Preparazione del turno appena aperto l'innesco vale ancora (la Reazione si chiude in un fiato)"
    engine = revived_on_field
    engine.judge({ "t" => "toZone", "uid" => "red", "zone" => "ritiro" })
    engine.judge({ "t" => "turn", "turn" => 4, "active" => "b" })
    engine.judge({ "t" => "phase", "phase" => "fronte" })
    refute come_back(engine, actor: "a")[:ok], "l'innesco è passato col turno"
  end

  def test_bound_return_needs_item_within_cost_from_own_retire_and_free_slot
    engine = revived_on_field
    engine.judge({ "t" => "toZone", "uid" => "red", "zone" => "ritiro" })
    refute come_back(engine, object: "mazza-a")[:ok], "costo 3 > 2"
    refute come_back(engine, object: "lama-b")[:ok], "dal PROPRIO Ritiro"
    refute come_back(engine, object: "suo")[:ok], "un Oggetto, non un'Entità"
    refute come_back(engine, y: 172)[:ok], "sul proprio Fronte"
    refute come_back(engine, x: 500)[:ok], "su uno slot"
    assert come_back(engine, x: 442)[:ok], "lo slot lasciato libero va bene"
  end

  def test_bound_return_with_full_front_fails
    engine = disarm_scene(
      [["red", "REVIVED", { "x" => 442 }], ["u1", "HUMAN", { "x" => 821 }], ["u2", "HUMAN", { "x" => 1199 }], ["u3", "HUMAN", { "x" => 1578 }],
       ["u4", "HUMAN", { "x" => 1956 }], ["lama-a", "BLADE", { "zone" => "ritiro" }], ["u5", "HUMAN", { "zone" => "hand" }]]
    )
    engine.judge({ "t" => "toZone", "uid" => "red", "zone" => "ritiro" })
    engine.judge({ "t" => "toZone", "uid" => "u5", "zone" => "field", "x" => 442, "y" => 1260, "cost" => 2 })
    verdict = come_back(engine)
    refute verdict[:ok]
    assert_includes verdict[:reason], "§6.2"
  end

  def test_bound_return_without_form_or_unknown_fails
    engine = disarm_scene([["mio", "HUMAN", { "x" => 442 }], ["red", "REVIVED", { "x" => 821 }], ["lama-a", "BLADE", { "zone" => "ritiro" }]])
    engine.judge({ "t" => "toZone", "uid" => "mio", "zone" => "ritiro" })
    refute come_back(engine, uid: "mio")[:ok], "senza la forma non si torna"
    engine.judge({ "t" => "toZone", "uid" => "red", "zone" => "ritiro" })
    refute come_back(engine, ref: { "source" => "red", "event" => "on_enter_field", "entering" => "red" })[:ok], "l'evento è l'uscita dal campo"
    engine = disarm_scene([["boh", "UNKNOWN", { "x" => 442 }], ["lama-a", "BLADE", { "zone" => "ritiro" }]])
    engine.judge({ "t" => "toZone", "uid" => "boh", "zone" => "ritiro" })
    refute come_back(engine, uid: "boh")[:ruled]
  end

  def test_death_in_battle_records_leaving
    engine = disarm_scene(
      [["red", "REVIVED", { "x" => 442 }], ["lama-a", "BLADE", { "zone" => "ritiro" }]],
      b: [["suo", "THORNY", { "x" => 442 }]]
    )
    front!(engine)
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
    assert come_back(engine, actor: "a")[:ok]
  end
end
