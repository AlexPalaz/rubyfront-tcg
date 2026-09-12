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
    assert room.join(seat, ->(payload) { box << payload }), "il posto #{seat} era libero"
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
    assert_equal %w[peers engine journal], a.map { |m| m[:t] }
    assert_equal Rubyfront::Engine::VERSION, a[1][:version]
    assert_equal "newGame", a[2][:actions].first[:action]["t"]
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

  def test_taken_seat_is_refused
    room = new_room
    seated(room, "a")
    refute room.join("a", ->(_) {})
    assert_equal %w[a], room.seats
  end

  def test_leaving_client_frees_seat_and_others_know
    room = new_room
    out = ->(_) {}
    assert room.join("a", out)
    b = seated(room, "b")
    b.clear
    room.leave("a", out)
    assert_equal [{ t: "peers", peers: 1, seats: %w[b] }], b
    refute room.empty?
    room.leave("b", room.instance_variable_get(:@clients)["b"])
    assert room.empty?
    refute_nil room.emptied_at
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
    assert_equal %w[peers engine], a.map { |m| m[:t] }
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
