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
    assert_equal({ t: "seat", seat: "b" }, box.first)
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

  # Il gancio della fine partita (2026-09-23): una volta per partita, con la
  # stanza (chi è seduto, con quale mazzo) e l'azione; non parte su un
  # gameOver fermato; il newGame lo riapre.
  def test_game_over_hook_fires_once_with_seats_and_decks
    calls = []
    room = new_room(starter: "a", on_over: ->(r, action) { calls << [r.player_of("a"), r.player_of("b"), r.deck_of("a"), r.deck_of("b"), action["winner"]]; r.reply("a", { t: "progress", card: "X" }) })
    a = seated(room, "a")
    seated(room, "b")
    room.attach("a", who: -> { 7 })
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => sample_deck("a"), "actor" => "a" })
    room.handle("b", { "t" => "judge", "seq" => 2, "action" => sample_deck("b"), "actor" => "b" })
    room.handle("a", { "t" => "judge", "seq" => 3, "action" => { "t" => "gameOver", "winner" => "a", "reason" => "hp" }, "actor" => "a" })
    assert_empty calls, "senza PV a zero il gameOver è fermato: niente gancio"
    room.handle("a", { "t" => "judge", "seq" => 4, "action" => { "t" => "player", "seat" => "b", "patch" => { "hp" => 0 } }, "actor" => "a" })
    room.handle("a", { "t" => "judge", "seq" => 5, "action" => { "t" => "gameOver", "winner" => "a", "reason" => "hp" }, "actor" => "a" })
    assert_equal [[7, nil, "test", "test", "a"]], calls
    assert_equal({ t: "progress", card: "X" }, a.last)
    room.handle("a", { "t" => "judge", "seq" => 6, "action" => { "t" => "gameOver", "winner" => "a", "reason" => "hp" }, "actor" => "a" })
    assert_equal 1, calls.size, "una volta sola per partita"
    room.handle("a", { "t" => "judge", "seq" => 7, "action" => { "t" => "newGame", "active" => "a" }, "actor" => "a" })
    assert_nil room.deck_of("a"), "il giornale riparte col newGame"
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
end
