# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/room"

# La stanza: un Engine per tavolo, il giornale delle azioni approvate, e
# l'inoltro agli altri client SOLO dopo il verdetto (deciso 2026-09-11:
# l'engine è l'unico a scrivere lo stato).
class RoomTest < Minitest::Test
  REGISTRY = {
    "SLOW" => { type: "entity", keywords: [] },
  }.freeze

  # Una cassetta della posta per posto: quello che il tavolo gli manda.
  def seated(room, seat)
    box = []
    assert_equal seat, room.join(seat, ->(payload) { box << payload }), "il posto #{seat} era libero"
    box
  end

  def new_room(name = "prova", **opts)
    Rubyfront::Room.new(name, cards: REGISTRY, **opts)
  end

  def sample_deck(seat)
    { "t" => "loadDeck", "seat" => seat, "deckId" => "test",
      "cards" => [{ "uid" => "#{seat}-1", "owner" => seat, "zone" => "hand", "order" => 0, "cardId" => "SLOW" }] }
  end

  # Un mazzo intero e canonico (§4): tutte nel mazzo, in ordine canonico; la
  # stanza lo mescola lei.
  def whole_deck(seat, count = 8)
    cards = (1..count).map { |n| { "uid" => "#{seat}-#{n}", "owner" => seat, "zone" => "deck", "order" => n - 1, "cardId" => "SLOW" } }
    { "t" => "loadDeck", "seat" => seat, "deckId" => "test", "cards" => cards }
  end

  # L'orologio finto: `now` si sposta a mano.
  class FakeClock
    attr_accessor :now

    def initialize(now = Time.at(1_700_000_000))
      @now = now
    end

    def call
      @now
    end

    def advance(seconds)
      @now += seconds
    end
  end

  # Una stanza con nome a seme, orologio finto e token prevedibili.
  def seeded_room(name = "prova", seed: 7, **opts)
    @clock = FakeClock.new
    tokens = %w[aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb cccccccccccccccccccccccccccccccc dddddddddddddddddddddddddddddddd]
    new_room(name, random: Random.new(seed), clock: @clock, token_source: -> { tokens.shift }, **opts)
  end

  # Una partita cominciata: due mazzi interi, le mani iniziali, le tenute.
  def started_room(**opts)
    room = seeded_room(starter: "a", **opts)
    a = seated(room, "a")
    b = seated(room, "b")
    %w[a b].each { |seat| room.handle(seat, { "t" => "judge", "seq" => 1, "action" => whole_deck(seat) }) }
    %w[a b].each do |seat|
      room.handle(seat, { "t" => "judge", "seq" => 2, "action" => { "t" => "draw", "seat" => seat, "count" => 6 } })
      room.handle(seat, { "t" => "judge", "seq" => 3, "action" => { "t" => "keep", "seat" => seat } })
    end
    [room, a, b]
  end

  def verdicts(box)
    box.select { |m| m[:t] == "verdict" }
  end

  def actions(box)
    box.select { |m| m[:t] == "action" }.map { |m| m[:action] }
  end

  # La ricerca di Oggetti nel mazzo (dal 2026-10-22): chi cerca vede il suo
  # mazzo; l'avversario riceve l'identità dell'Oggetto che scende in campo
  # (esce da una zona nascosta), nulla di quello che va in mano.
  def test_object_search_reveals_only_what_comes_down
    room, a, b = started_room
    engine = room.instance_variable_get(:@engine)
    deck = engine.zone_uids("a", "deck")
    first, second = deck.first(2)
    a.clear
    b.clear
    # Uno spostamento dal mazzo al campo (vista: identità per l'avversario), e uno in mano (nessuna identità).
    room.handle("a", { "t" => "judge", "seq" => 10, "action" => { "t" => "toZone", "uid" => first, "zone" => "field", "x" => 1199, "y" => 1260 } })
    down = actions(b).last
    assert_equal first, down["uid"]
    assert_equal({ first => "SLOW" }, down["identities"], "ciò che scende in campo si fa conoscere")
    b.clear
    room.handle("a", { "t" => "judge", "seq" => 11, "action" => { "t" => "toZone", "uid" => second, "zone" => "hand" } })
    kept = actions(b).last
    assert_equal second, kept["uid"]
    refute kept.key?("identities"), "ciò che va in mano resta un dorso"
  end

  def test_journal_starts_from_table_rolled_new_game
    room = new_room(starter: "b")
    assert_equal 1, room.journal.size
    assert_equal({ "t" => "newGame", "active" => "b" }, room.journal.first[:action])
    assert_nil room.journal.first[:from]
  end

  def test_hello_carries_engine_and_journal
    room = new_room
    a = seated(room, "a")
    room.handle("a", { "t" => "hello" })
    assert_equal %w[seat peers engine journal], a.map { |m| m[:t] }
    assert_equal "a", a[0][:seat]
    assert_equal Rubyfront::Engine::VERSION, a[2][:version]
    assert_equal "newGame", a[3][:actions].first[:action]["t"]
  end

  # Gli strumenti di prova (evoca, patch `test`) li usa solo l'account di prova.
  def test_test_tools_only_from_the_test_account
    room = new_room
    a = seated(room, "a")
    spawn = { "t" => "spawn", "card" => { "uid" => "x", "owner" => "a", "zone" => "hand", "order" => 0, "cardId" => "SLOW" } }
    a.clear
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => spawn, "actor" => "a" })
    refute a.last[:ok]
    assert_match(/account di prova/, a.last[:reason])
    room.attach("a", who: -> { 1 }, tester: -> { true })
    a.clear
    room.handle("a", { "t" => "judge", "seq" => 2, "action" => spawn, "actor" => "a" })
    assert a.last[:ok], a.last[:reason]
    assert_equal 2, a.last[:seq]
  end

  # §3.3 — l'Ascesa del `loadDeck` non va oltre quella che la memoria dà al
  # posto caricato: chi non ha account (o il bot nella «solo») non ne ha.
  def test_the_deck_ascent_must_be_the_seat_s_own
    room = new_room
    a = seated(room, "a")
    b = seated(room, "b")
    asked = []
    room.attach("a", who: -> { 7 }, ascent: ->(deck) { asked << deck; { "hp" => 2, "fury" => 1 } })
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => sample_deck("a").merge("ascent" => { "hp" => 5, "fury" => 1 }) })
    refute a.last[:ok]
    assert_match(/\(§3\.3\)/, a.last[:reason])
    assert_match(/\(§3\.3\)/, a.last[:reason_en])
    room.handle("a", { "t" => "judge", "seq" => 2, "action" => sample_deck("a").merge("ascent" => { "hp" => 2, "fury" => 2 }) })
    refute a.last[:ok], "più Furia del percorso"
    room.handle("a", { "t" => "judge", "seq" => 3, "action" => sample_deck("a").merge("ascent" => { "hp" => 2, "fury" => 1 }) })
    assert a.last[:ok], a.last[:reason]
    assert_equal %w[test test test], asked
    room.handle("a", { "t" => "judge", "seq" => 6, "action" => sample_deck("a") })
    assert a.last[:ok], "meno del dovuto (il mazzo caricato prima dell'accesso) non si ferma"
    room.handle("b", { "t" => "judge", "seq" => 4, "action" => sample_deck("b").merge("ascent" => { "hp" => 0, "fury" => 3 }) })
    refute b.last[:ok], "senza account niente Ascesa"
    room.handle("b", { "t" => "judge", "seq" => 5, "action" => sample_deck("b").merge("ascent" => { "hp" => 0, "fury" => 0 }) })
    assert b.last[:ok], "l'Ascesa a zero è come nessuna"
  end

  # La memoria che non risponde non ferma la partita.
  def test_an_unreadable_ascent_lets_the_deck_through
    room = new_room
    a = seated(room, "a")
    room.attach("a", who: -> { 7 }, ascent: ->(_deck) { raise "giù" })
    _, err = capture_io { room.handle("a", { "t" => "judge", "seq" => 1, "action" => sample_deck("a").merge("ascent" => { "hp" => 0, "fury" => 1 }) }) }
    assert a.last[:ok], a.last[:reason]
    assert_match(/non verificata/, err)
  end

  def test_passing_action_goes_to_journal_and_others
    room = new_room
    a = seated(room, "a")
    b = seated(room, "b")
    a.clear
    b.clear
    room.handle("a", { "t" => "judge", "seq" => 7, "action" => sample_deck("a"), "actor" => "a" })
    verdict = a.last
    assert_equal "verdict", verdict[:t]
    assert_equal 7, verdict[:seq]
    assert verdict[:ok]
    assert_equal 1, b.size
    assert_equal "action", b.first[:t]
    assert_equal "a", b.first[:from]
    assert_equal "loadDeck", b.first[:action]["t"]
    assert_equal 2, room.journal.size
    assert_equal "a", room.journal.last[:from]
  end

  def test_stopped_action_reaches_nobody
    room = new_room(starter: "a")
    a = seated(room, "a")
    b = seated(room, "b")
    b.clear
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => { "t" => "player", "seat" => "a", "patch" => { "flux" => 21 } } })
    refute a.last[:ok]
    assert_match(/§3\.2/, a.last[:reason])
    assert_empty b
    assert_equal 1, room.journal.size
  end

  def test_in_room_actor_is_client_seat_not_declared
    room = new_room(starter: "a")
    a = seated(room, "a")
    b = seated(room, "b")
    # B dice di essere A e prova a chiudere il turno di A: il tavolo lo
    # giudica come B, cioè nel turno altrui.
    room.handle("b", { "t" => "judge", "seq" => 1, "action" => { "t" => "turn", "turn" => 2, "active" => "b" }, "actor" => "a" })
    refute b.last[:ok]
    assert_match(/§6/, b.last[:reason])
    assert_equal 1, room.journal.size
    # Lo stesso gesto da A passa.
    room.handle("a", { "t" => "judge", "seq" => 2, "action" => { "t" => "turn", "turn" => 2, "active" => "b" }, "actor" => "b" })
    assert a.last[:ok], a.last[:reason]
    assert_equal 2, room.journal.size
  end

  def test_new_game_restarts_journal
    room = new_room
    seated(room, "a")
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => sample_deck("a") })
    room.handle("a", { "t" => "judge", "seq" => 2, "action" => { "t" => "newGame", "active" => "b" } })
    assert_equal 1, room.journal.size
    assert_equal "newGame", room.journal.first[:action]["t"]
    assert_equal "a", room.journal.first[:from]
  end

  # Il posto lo assegna il tavolo (2026-09-23): chi chiede un posto occupato
  # prende l'altro, e lo sa subito; a stanza piena, nessun posto.
  def test_taken_seat_gives_the_other_one
    room = new_room
    seated(room, "a")
    box = []
    assert_equal "b", room.join("a", ->(payload) { box << payload })
    assert_equal "seat", box.first[:t]
    assert_equal "b", box.first[:seat]
    assert_match(/\A\h{32}\z/, box.first[:token])
    assert_equal %w[a b], room.seats
  end

  def test_full_room_refuses
    room = new_room
    seated(room, "a")
    seated(room, "b")
    assert_nil room.join("a", ->(_) {})
    assert_nil room.join("zz", ->(_) {})
    assert_equal %w[a b], room.seats
  end

  def test_unknown_seat_gets_the_first_free_one
    room = new_room
    assert_equal "a", room.join("", ->(_) {})
    assert_equal "b", room.join("", ->(_) {})
  end

  def test_leaving_client_frees_seat_and_others_know
    room = new_room
    out = ->(_) {}
    assert_equal "a", room.join("a", out)
    b = seated(room, "b")
    b.clear
    room.leave("a", out)
    assert_equal [{ t: "peers", peers: 1, seats: %w[b] }], b
    refute room.empty?
    room.leave("b", room.instance_variable_get(:@clients)["b"])
    assert room.empty?
    refute_nil room.emptied_at
  end

  # Il gancio della fine partita (2026-09-23, con l'esito dal 2026-10-21):
  # una volta per partita, FUORI dal lucchetto (i callback tornati da
  # `handle`), con l'esito — identità fissate, mazzi, chi ha vinto; non
  # parte su un gameOver fermato; il newGame lo riapre.
  def test_game_over_hook_fires_once_with_seats_and_decks
    calls = []
    room = new_room(starter: "a", rewards: true, on_over: ->(r, outcome) { calls << outcome; r.reply("a", { t: "progress", card: "X" }) })
    a = seated(room, "a")
    seated(room, "b")
    room.attach("a", who: -> { 7 }, verified: -> { true })
    room.attach("b", who: -> { nil }, tester: -> { true })
    run = ->(seat, seq, action) { room.handle(seat, { "t" => "judge", "seq" => seq, "action" => action }).each(&:call) }
    run.call("a", 1, sample_deck("a"))
    run.call("b", 2, sample_deck("b"))
    run.call("a", 3, { "t" => "gameOver", "winner" => "a", "reason" => "hp" })
    assert_empty calls, "senza PV a zero il gameOver è fermato: niente gancio"
    # T05 dell'audit: A non azzera i PV di B; a zero ci va B stesso, con lo strumento di prova.
    run.call("a", 4, { "t" => "player", "seat" => "b", "patch" => { "hp" => 0 } })
    refute verdicts(a).last[:ok]
    assert_empty calls
    run.call("b", 4, { "t" => "player", "seat" => "b", "patch" => { "hp" => 0 }, "test" => true })
    run.call("a", 5, { "t" => "gameOver", "winner" => "a", "reason" => "hp" })
    assert_equal 1, calls.size
    outcome = calls.first
    assert_equal "a", outcome[:winner]
    assert_equal "hp", outcome[:reason]
    assert_equal true, outcome[:rewards]
    assert_equal room.match_id, outcome[:match_id]
    assert_equal({ player_id: 7, verified: true, deck_id: "test" }, outcome[:seats]["a"])
    assert_equal({ player_id: nil, verified: false, deck_id: "test" }, outcome[:seats]["b"])
    assert_equal({ t: "progress", card: "X" }, a.last)
    run.call("a", 6, { "t" => "gameOver", "winner" => "a", "reason" => "hp" })
    assert_equal 1, calls.size, "una volta sola per partita"
    before = room.match_id
    run.call("a", 7, { "t" => "newGame", "active" => "a" })
    assert_nil room.deck_of("a"), "il giornale riparte col newGame"
    refute_equal before, room.match_id, "una partita nuova ha un id nuovo"
  end

  # Il «pronto» delle scene (dal 2026-09-15): un'azione senza regola, che la
  # stanza scrive nel giornale e inoltra all'altro — anche nel turno altrui.
  def test_ready_is_journaled_and_forwarded_in_anyones_turn
    room = new_room(starter: "a")
    a = seated(room, "a")
    b = seated(room, "b")
    a.clear
    b.clear
    ready = { "t" => "ready", "key" => "enter|a-1|||1", "seat" => "b", "scene" => { "kind" => "enter", "uid" => "a-1" } }
    room.handle("b", { "t" => "judge", "seq" => 3, "action" => ready })
    verdict = b.last
    assert_equal "verdict", verdict[:t]
    assert verdict[:ok]
    refute verdict[:ruled]
    assert_equal [{ t: "action", action: ready, from: "b" }], a
    assert_equal "ready", room.journal.last[:action]["t"]
  end

  def test_voice_is_forwarded_as_is
    room = new_room
    a = seated(room, "a")
    b = seated(room, "b")
    a.clear
    b.clear
    room.handle("a", { "t" => "rtc", "payload" => { "sdp" => "x" } })
    assert_empty a
    assert_equal [{ t: "rtc", payload: { "sdp" => "x" }, from: "a" }], b
  end

  def test_in_room_snapshot_and_consult_do_not_touch_table
    room = new_room(starter: "a")
    a = seated(room, "a")
    room.handle("a", { "t" => "snapshot", "state" => { "turn" => 9, "active" => "b" } })
    room.handle("a", { "t" => "consult", "action" => sample_deck("b"), "actor" => "b" })
    assert_equal 1, room.journal.size
    a.clear
    # Il turno è ancora quello del giornale: A può chiudere il suo turno 1.
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => { "t" => "turn", "turn" => 2, "active" => "b" } })
    assert a.last[:ok], a.last[:reason]
  end

  def test_solo_room_is_the_old_table
    room = new_room("", solo: true)
    assert room.solo?
    assert_empty room.journal
    a = seated(room, "a")
    room.handle("a", { "t" => "hello" })
    assert_equal %w[seat peers engine], a.map { |m| m[:t] }
    # Lo snapshot del client si accetta, e l'attore dichiarato vale: col bot
    # al tavolo i gesti di B partono dallo stesso client.
    room.handle("a", { "t" => "snapshot", "state" => { "turn" => 3, "active" => "b" } })
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => { "t" => "turn", "turn" => 4, "active" => "a" }, "actor" => "b" })
    assert a.last[:ok], a.last[:reason]
  end

  def test_client_not_receiving_does_not_stop_table
    room = new_room
    assert room.join("a", ->(_) { raise IOError, "chiuso" })
    b = seated(room, "b")
    b.clear
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => sample_deck("a") })
    assert_equal 1, b.size
    assert_equal "action", b.first[:t]
  end

  # ==========================================================================
  # --- Il tavolo fail-closed (audit 2026-10-20, dal 2026-10-21) --------------
  # ==========================================================================

  # --- §protocollo: le azioni malformate (T03, T04, T33) ---------------------

  def test_malformed_actions_are_refused_and_never_journaled
    room = new_room(starter: "a")
    a = seated(room, "a")
    b = seated(room, "b")
    b.clear
    [nil, "draw", 7, [], { "foo" => 1 }, { "t" => "hack" }, { "t" => "draw", "seat" => "c", "count" => 1 }].each_with_index do |action, i|
      a.clear
      room.handle("a", { "t" => "judge", "seq" => i, "action" => action })
      verdict = a.last
      assert_equal "verdict", verdict[:t], action.inspect
      refute verdict[:ok], action.inspect
      assert verdict[:ruled]
      assert_match(/§protocollo/, verdict[:reason])
      assert_equal i, verdict[:seq]
    end
    assert_empty b, "nulla arriva all'altro"
    assert_equal 1, room.journal.size, "solo il newGame del tavolo"
    b.clear
    room.handle("b", { "t" => "hello" })
    assert_equal 1, b.find { |m| m[:t] == "journal" }[:actions].size, "chi rientra rigioca un giornale pulito"
  end

  def test_an_engine_failure_is_a_refusal_not_a_crash
    room = new_room(starter: "a")
    a = seated(room, "a")
    broken = Object.new
    def broken.judge(*) = raise("boom")
    def broken.card_facts = {}
    def broken.roll_for(*) = nil
    def broken.zone_uids(*) = []
    def broken.top_of_deck(*) = []
    def broken.over? = false
    room.instance_variable_set(:@engine, broken)
    _, err = capture_io { room.handle("a", { "t" => "judge", "seq" => 1, "action" => { "t" => "say", "entry" => {} } }) }
    refute a.last[:ok]
    assert_match(/non ha potuto giudicare.*§protocollo/, a.last[:reason])
    assert_match(/boom/, err)
    assert_equal 1, room.journal.size
  end

  # --- La stanza tira (T10, T11) ----------------------------------------------

  def test_room_rolls_the_die_and_returns_the_completed_action
    room, a, b = started_room
    a.clear
    b.clear
    room.handle("a", { "t" => "judge", "seq" => 9, "action" => { "t" => "roll", "seat" => "a", "die" => 6, "for" => "cost|a-1" } })
    verdict = a.last
    assert verdict[:ok], verdict[:reason]
    applied = verdict[:applied]
    assert_equal "roll", applied["t"]
    assert applied["value"].between?(1, 6)
    assert_equal applied, room.journal.last[:action]
    assert_equal [applied], actions(b), "l'avversario riceve il tiro (lo anima)"
    assert_equal applied["value"], room.instance_variable_get(:@engine).roll_for("cost|a-1")[:value]
  end

  def test_same_key_same_turn_returns_the_same_value
    room, a, = started_room
    values = (1..6).map do |i|
      a.clear
      room.handle("a", { "t" => "judge", "seq" => i, "action" => { "t" => "roll", "seat" => "a", "die" => 20, "for" => "fury|a-1" } })
      a.last[:applied]["value"]
    end
    assert_equal 1, values.uniq.size, "non si ripesca un dado: #{values.inspect}"
    a.clear
    room.handle("a", { "t" => "judge", "seq" => 7, "action" => { "t" => "roll", "seat" => "a", "die" => 6, "for" => "fury|a-1" } })
    assert a.last[:applied]["value"].between?(1, 6), "con facce diverse è un altro dado"
  end

  def test_client_value_is_overwritten_by_the_rooms
    room, a, = started_room
    a.clear
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => { "t" => "roll", "seat" => "a", "die" => 20, "for" => "fury|a-1", "value" => 20 } })
    rolled = a.last[:applied]["value"]
    twin, c, = started_room
    c.clear
    twin.handle("a", { "t" => "judge", "seq" => 1, "action" => { "t" => "roll", "seat" => "a", "die" => 20, "for" => "fury|a-1", "value" => 1 } })
    assert_equal rolled, c.last[:applied]["value"], "stesso seme, stesso tiro: il valore del client non conta"
    refute_equal 20, Random.new(99).rand(1..20) == rolled && 20, "(il 20 chiesto non è garantito)"
  end

  def test_shuffle_and_mulligan_orders_come_from_the_room
    room, a, b = started_room
    deck = room.instance_variable_get(:@engine).zone_uids("a", "deck")
    a.clear
    b.clear
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => { "t" => "shuffle", "seat" => "a", "order" => ["a-1"] } })
    verdict = a.last
    assert verdict[:ok], verdict[:reason]
    assert_equal deck.sort, verdict[:applied]["order"].sort, "una permutazione intera del mazzo, non l'ordine del client"
    refute_equal ["a-1"], verdict[:applied]["order"]
    foe = actions(b).last
    assert_equal "shuffle", foe["t"]
    refute foe.key?("order"), "l'avversario non vede l'ordine"
    # Il mulligan: l'ordine della stanza, e per l'altro le pescate nominate.
    fresh = seeded_room(starter: "a")
    c = seated(fresh, "a")
    d = seated(fresh, "b")
    fresh.handle("a", { "t" => "judge", "seq" => 1, "action" => whole_deck("a") })
    fresh.handle("a", { "t" => "judge", "seq" => 2, "action" => { "t" => "draw", "seat" => "a", "count" => 6 } })
    c.clear
    d.clear
    fresh.handle("a", { "t" => "judge", "seq" => 3, "action" => { "t" => "mulligan", "seat" => "a" } })
    assert c.last[:ok], c.last[:reason]
    assert_equal 8, c.last[:applied]["order"].size
    foe = actions(d).last
    refute foe.key?("order")
    assert_equal 6, foe["drawn"].size
    assert foe["drawn"].all? { |uid| uid.start_with?("a-") }
  end

  def test_load_deck_order_is_rewritten_by_the_room
    room = seeded_room(starter: "a")
    a = seated(room, "a")
    a.clear
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => whole_deck("a") })
    applied = a.last[:applied]
    orders = applied["cards"].map { |card| card["order"] }
    assert_equal (0..7).to_a, orders.sort
    refute_equal (0..7).to_a, orders, "mescolato, non canonico (seme 7)"
    assert_equal applied["cards"].map { |c| c["uid"] }, whole_deck("a")["cards"].map { |c| c["uid"] }, "le carte sono le stesse, nello stesso elenco"
    twin = seeded_room(starter: "a")
    c = seated(twin, "a")
    c.clear
    twin.handle("a", { "t" => "judge", "seq" => 1, "action" => whole_deck("a") })
    assert_equal orders, c.last[:applied]["cards"].map { |card| card["order"] }, "a seme uguale, mescolata uguale"
  end

  def test_new_game_starter_is_the_rooms
    room = seeded_room(starter: "a")
    a = seated(room, "a")
    starters = (1..6).map do |i|
      a.clear
      room.handle("a", { "t" => "judge", "seq" => i, "action" => { "t" => "newGame", "active" => "a" } })
      a.last[:applied]["active"]
    end
    assert starters.include?("b"), "chi apre lo tira la stanza, non il client: #{starters.inspect}"
    assert_equal starters.last, room.journal.first[:action]["active"]
  end

  # --- La non divulgazione (T01, T02) -----------------------------------------

  def test_non_divulgazione
    room = seeded_room(starter: "a")
    a = seated(room, "a")
    b = seated(room, "b")
    a.clear
    b.clear
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => whole_deck("a") })
    mine = a.last[:applied]
    assert mine["cards"].all? { |card| card["cardId"] == "SLOW" && card.key?("order") }, "io vedo il mio mazzo intero"
    theirs = actions(b).last
    assert_equal "loadDeck", theirs["t"]
    assert theirs["cards"].none? { |card| card.key?("cardId") || card.key?("order") }, "l'avversario non vede identità né ordine"
    assert_equal mine["cards"].map { |c| c["uid"] }, theirs["cards"].map { |c| c["uid"] }
    # La mano iniziale: l'altro vede quali uid sono in mano, non cosa sono.
    b.clear
    room.handle("a", { "t" => "judge", "seq" => 2, "action" => { "t" => "draw", "seat" => "a", "count" => 6 } })
    drawn = actions(b).last
    assert_equal 6, drawn["drawn"].size
    refute drawn.key?("identities")
    # Chi rientra rigioca le viste: B non trova nessun cardId di A in mano o nel mazzo.
    b.clear
    room.handle("b", { "t" => "hello" })
    journal = b.find { |m| m[:t] == "journal" }[:actions]
    load_entry = journal.find { |entry| entry[:action]["t"] == "loadDeck" }
    assert load_entry[:action]["cards"].none? { |card| card.key?("cardId") }
    assert_equal 6, journal.last[:action]["drawn"].size
    a.clear
    room.handle("a", { "t" => "hello" })
    assert a.find { |m| m[:t] == "journal" }[:actions].find { |entry| entry[:action]["t"] == "loadDeck" }[:action]["cards"].all? { |card| card["cardId"] == "SLOW" }, "io rigioco il mio intero"
    # B carica e tiene; A tiene. Poi A gioca una carta: B riceve la sua identità.
    room.handle("b", { "t" => "judge", "seq" => 3, "action" => whole_deck("b") })
    room.handle("b", { "t" => "judge", "seq" => 4, "action" => { "t" => "draw", "seat" => "b", "count" => 6 } })
    room.handle("b", { "t" => "judge", "seq" => 5, "action" => { "t" => "keep", "seat" => "b" } })
    room.handle("a", { "t" => "judge", "seq" => 6, "action" => { "t" => "keep", "seat" => "a" } })
    hand = room.instance_variable_get(:@engine).zone_uids("a", "hand").first
    b.clear
    room.handle("a", { "t" => "judge", "seq" => 7, "action" => { "t" => "toZone", "uid" => hand, "zone" => "ritiro" } })
    played = actions(b).last
    assert_equal({ hand => "SLOW" }, played["identities"]) if played
    # Chi chiude il turno riceve anche lui la carta pescata dall'altro, per nome: non ne conosce l'ordine.
    room.handle("a", { "t" => "judge", "seq" => 8, "action" => { "t" => "draw", "seat" => "a", "count" => 1 } })
    a.clear
    b.clear
    room.handle("a", { "t" => "judge", "seq" => 9, "action" => { "t" => "turn", "turn" => 2, "active" => "b" } })
    assert a.last[:ok], a.last[:reason]
    assert_equal 1, a.last[:applied]["drawn"].size, "a chi chiude: la carta pescata da B, per nome"
    assert a.last[:applied]["drawn"].first.start_with?("b-")
    refute actions(b).last.key?("drawn"), "B conosce l'ordine del proprio mazzo: la sua vista non ha bisogno del nome"
    assert_empty room.journal.flat_map { |e| e[:views] ? [e[:views]["b"]] : [] }.select { |v| v["t"] == "loadDeck" && v["seat"] == "a" }.flat_map { |v| v["cards"] }.select { |c| c.key?("cardId") }
  end

  def test_solo_room_has_no_projection
    room = new_room("", solo: true, random: Random.new(1))
    a = seated(room, "a")
    a.clear
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => whole_deck("b"), "actor" => "b" })
    assert a.last[:ok], a.last[:reason]
    assert a.last[:applied]["cards"].all? { |card| card["cardId"] == "SLOW" }, "un solo client: vede tutto"
    assert_nil room.journal.last[:views]
  end

  # --- Il posto e il token (T13) ----------------------------------------------

  def test_join_issues_a_seat_token
    room = seeded_room
    box = []
    assert_equal "a", room.join("a", ->(m) { box << m })
    assert_equal({ t: "seat", seat: "a", token: "a" * 32 }, box.first)
    other = []
    assert_equal "b", room.join("b", ->(m) { other << m })
    assert_equal "b" * 32, other.first[:token]
  end

  def test_token_resumes_the_same_seat_within_grace
    room, a, = started_room
    out = room.instance_variable_get(:@clients)["a"]
    room.leave("a", out)
    assert_equal %w[b], room.seats
    @clock.advance(60)
    back = []
    assert_equal "a", room.join("b", ->(m) { back << m }, token: "a" * 32), "col token si riprende il proprio posto, anche chiedendo l'altro"
    assert_equal({ t: "seat", seat: "a", token: "a" * 32, resumed: true }, back.first)
    assert_equal %w[a b], room.seats
    room.handle("a", { "t" => "hello" })
    assert back.any? { |m| m[:t] == "journal" && m[:actions].size > 1 }, "e ritrova la partita"
    assert_nil room.expire.first, "nessun abbandono"
  end

  def test_stranger_cannot_take_a_reserved_seat
    room = seeded_room(starter: "a")
    a_out = ->(_) {}
    assert_equal "a", room.join("a", a_out)
    room.leave("a", a_out)
    stranger = []
    assert_equal "b", room.join("a", ->(m) { stranger << m }), "il posto A è riservato: l'estraneo prende B"
    assert_equal "d" * 32, stranger.first[:token] if stranger.first[:token] != "b" * 32
    assert_nil room.join("a", ->(_) {}), "e con B preso, la stanza è piena"
  end

  def test_stranger_gets_room_full_when_other_seat_reserved
    room, _a, _b = started_room
    room.leave("a", room.instance_variable_get(:@clients)["a"])
    assert_nil room.join("a", ->(_) {})
    assert_nil room.join("", ->(_) {})
  end

  def test_same_token_from_a_second_connection_replaces_the_first
    room, a, = started_room
    first = room.instance_variable_get(:@clients)["a"]
    second = []
    assert_equal "a", room.join("a", ->(m) { second << m }, token: "a" * 32)
    assert_equal "refused", a.last[:t]
    assert_equal "replaced", a.last[:code]
    assert_equal({ t: "seat", seat: "a", token: "a" * 32, resumed: true }, second.first)
    # La scheda congedata non parla più per il posto.
    before = room.journal.size
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => { "t" => "say", "entry" => {} } }, out: first)
    assert_equal before, room.journal.size
    room.leave("a", first)
    assert_equal %w[a b], room.seats, "il congedo della vecchia scheda non libera il posto"
  end

  def test_expire_forfeits_the_absent_seat_after_grace
    calls = []
    room, _a, b = started_room(rewards: true, on_over: ->(_r, outcome) { calls << outcome })
    room.leave("a", room.instance_variable_get(:@clients)["a"])
    @clock.advance(119)
    assert_empty room.expire, "entro la grazia non succede nulla"
    @clock.advance(2)
    b.clear
    after = room.expire
    assert_equal 1, after.size
    assert_equal "gameOver", room.journal.last[:action]["t"]
    assert_equal({ "t" => "gameOver", "winner" => "b", "reason" => "forfeit" }, room.journal.last[:action])
    assert_nil room.journal.last[:from]
    assert_equal [{ t: "action", action: room.journal.last[:action], from: nil }], b.select { |m| m[:t] == "action" }
    assert_empty calls, "il gancio gira fuori dal lucchetto, quando lo chiama il trasporto"
    after.each(&:call)
    assert_equal 1, calls.size
    assert_equal "b", calls.first[:winner]
    assert_equal "forfeit", calls.first[:reason]
    assert_empty room.expire, "una volta sola"
    fresh = []
    assert_equal "a", room.join("a", ->(m) { fresh << m }, token: "a" * 32), "il token è scaduto: il posto A è libero e si prende da capo"
    refute_equal "a" * 32, fresh.first[:token]
    refute fresh.first.key?(:resumed)
  end

  def test_expire_without_running_match_just_frees_the_seat
    room = seeded_room(starter: "a")
    out = ->(_) {}
    assert_equal "a", room.join("a", out)
    room.leave("a", out)
    @clock.advance(500)
    assert_empty room.expire
    assert_equal 1, room.journal.size, "nessun gameOver: la partita non era cominciata"
    fresh = []
    assert_equal "a", room.join("a", ->(m) { fresh << m })
    refute_equal "a" * 32, fresh.first[:token], "un posto nuovo, un token nuovo"
  end

  def test_rejoin_after_grace_is_a_new_seat
    room, = started_room
    room.leave("a", room.instance_variable_get(:@clients)["a"])
    @clock.advance(300)
    room.expire
    fresh = []
    assert_equal "a", room.join("a", ->(m) { fresh << m }, token: "a" * 32)
    assert_equal "c" * 32, fresh.first[:token], "un posto nuovo, un token nuovo"
    assert_nil room.pinned_player("a")
    assert room.instance_variable_get(:@engine).over?, "la partita è finita per abbandono"
  end

  # --- Le ricompense e l'identità (T12, T35) ----------------------------------

  def test_snapshot_in_solo_marks_the_game_sandbox
    calls = []
    room = new_room("", solo: true, rewards: true, random: Random.new(3), on_over: ->(_r, outcome) { calls << outcome })
    a = seated(room, "a")
    room.attach("a", who: -> { 7 })
    run = ->(action, actor) { room.handle("a", { "t" => "judge", "seq" => 1, "action" => action, "actor" => actor }).each(&:call) }
    run.call(whole_deck("a"), "a")
    run.call(whole_deck("b"), "b")
    room.handle("a", { "t" => "snapshot", "state" => { "turn" => 3, "active" => "a", "players" => { "b" => { "hp" => 0 } } } })
    run.call({ "t" => "gameOver", "winner" => "a", "reason" => "hp" }, "a")
    assert_equal 1, calls.size
    assert_equal false, calls.first[:rewards], "una partita ripresa da snapshot non dà ricompense"
    assert_equal 7, calls.first[:seats]["a"][:player_id]
    run.call({ "t" => "newGame", "active" => "a" }, "a")
    run.call(whole_deck("a"), "a")
    run.call(whole_deck("b"), "b")
    run.call({ "t" => "player", "seat" => "b", "patch" => { "hp" => 0 }, "test" => true }, "b")
    assert_equal 2, calls.size, "la patch di prova senza tester non passa: niente fine" if false
    room.attach("a", who: -> { 7 }, tester: -> { true })
    run.call({ "t" => "player", "seat" => "b", "patch" => { "hp" => 0 }, "test" => true }, "b")
    run.call({ "t" => "gameOver", "winner" => "a", "reason" => "hp" }, "a")
    assert_equal 2, calls.size
    assert_equal true, calls.last[:rewards], "la partita nuova, vista dall'inizio, dà ricompense"
    refute_equal calls.first[:match_id], calls.last[:match_id]
  end

  def test_player_is_pinned_at_first_load_deck_and_survives_logout
    calls = []
    room, a, _b = started_room(rewards: true, on_over: ->(_r, outcome) { calls << outcome })
    who = 7
    room.attach("a", who: -> { who }, verified: -> { true })
    # Il pin c'è dal primo carico: qui la stanza aveva già caricato (started_room) senza account → nil.
    assert_nil room.pinned_player("a")
    run = ->(seat, action) { room.handle(seat, { "t" => "judge", "seq" => 1, "action" => action }).each(&:call) }
    run.call("a", { "t" => "gameOver", "winner" => "b", "reason" => "concede" })
    run.call("a", { "t" => "newGame" })
    run.call("a", whole_deck("a"))
    assert_equal 7, room.pinned_player("a")
    who = nil # il logout, o un altro accesso, a partita in corso
    run.call("b", whole_deck("b"))
    %w[a b].each do |seat|
      run.call(seat, { "t" => "draw", "seat" => seat, "count" => 6 })
      run.call(seat, { "t" => "keep", "seat" => seat })
    end
    assert room.busy?("a")
    assert room.busy?("b")
    run.call("b", { "t" => "gameOver", "winner" => "a", "reason" => "concede" })
    refute room.busy?("a"), "a partita finita non si è più occupati"
    assert_equal 7, calls.last[:seats]["a"][:player_id], "l'esperienza va all'identità fissata"
    assert_equal true, calls.last[:seats]["a"][:verified]
    assert_equal "a", calls.last[:winner]
    assert a.any? { |m| m[:t] == "verdict" }
  end

  def test_busy_only_with_a_deck_loaded_and_the_game_not_over
    room = seeded_room(starter: "a")
    seated(room, "a")
    refute room.busy?("a")
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => whole_deck("a") })
    assert room.busy?("a")
    refute room.busy?("b")
    solo = new_room("", solo: true)
    seated(solo, "a")
    solo.handle("a", { "t" => "judge", "seq" => 1, "action" => whole_deck("a"), "actor" => "a" })
    refute solo.busy?("a"), "nella «solo» l'accesso si cambia sempre"
  end

  # --- Il tetto del giornale (T20) ----------------------------------------------

  def test_journal_cap_closes_the_game_with_limit
    calls = []
    room, a, b = started_room(rewards: true, on_over: ->(_r, outcome) { calls << outcome })
    after = []
    until room.journal.size >= Rubyfront::Room::JOURNAL_MAX
      after.concat(room.handle("a", { "t" => "judge", "seq" => 1, "action" => { "t" => "say", "entry" => {} } }))
    end
    assert_equal Rubyfront::Room::JOURNAL_MAX + 1, room.journal.size, "l'ultima voce è la fine per limite"
    assert_equal({ "t" => "gameOver", "winner" => nil, "reason" => "limit" }, room.journal.last[:action])
    assert_nil room.journal.last[:from]
    assert_equal "gameOver", actions(b).last["t"]
    a.clear
    room.handle("a", { "t" => "judge", "seq" => 2, "action" => { "t" => "phase", "phase" => "fronte" } })
    refute a.last[:ok], "a partita finita il tavolo si ferma"
    assert_match(/§2/, a.last[:reason])
    after.each(&:call)
    assert_equal 1, calls.size
    assert_nil calls.first[:winner]
    assert_equal "limit", calls.first[:reason]
  end

  # --- Il lucchetto ---------------------------------------------------------------

  def test_on_over_runs_after_the_lock_is_released
    room, a, = started_room(rewards: true, on_over: ->(r, _outcome) { r.handle("a", { "t" => "hello" }); r.reply("a", { t: "progress" }) })
    after = room.handle("a", { "t" => "judge", "seq" => 1, "action" => { "t" => "gameOver", "winner" => "b", "reason" => "concede" } })
    assert_equal 1, after.size
    a.clear
    after.each(&:call)
    assert_equal %w[engine journal progress], a.map { |m| m[:t] }, "il gancio rientra nella stanza senza bloccarsi"
  end

  def test_rtc_over_the_limit_is_dropped
    room = new_room
    seated(room, "a")
    b = seated(room, "b")
    b.clear
    room.handle("a", { "t" => "rtc", "payload" => { "sdp" => "x" * (16 * 1024) } })
    assert_empty b
    room.handle("a", { "t" => "rtc", "payload" => { "sdp" => "x" } })
    assert_equal 1, b.size
  end
end
