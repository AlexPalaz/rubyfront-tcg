# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/room"

# La stanza: un Engine per tavolo, il giornale delle azioni approvate, e
# l'inoltro agli altri client SOLO dopo il verdetto (deciso 2026-09-11:
# l'engine è l'unico a scrivere lo stato).
class RoomTest < Minitest::Test
  ANAGRAFE = {
    "LENTA" => { type: "entity", keywords: [] },
  }.freeze

  # Una cassetta della posta per posto: quello che il tavolo gli manda.
  def seduto(room, seat)
    box = []
    assert room.join(seat, ->(payload) { box << payload }), "il posto #{seat} era libero"
    box
  end

  def stanza(name = "prova", **opts)
    Rubyfront::Room.new(name, cards: ANAGRAFE, **opts)
  end

  def mazzo(seat)
    { "t" => "loadDeck", "seat" => seat, "deckId" => "test",
      "cards" => [{ "uid" => "#{seat}-1", "owner" => seat, "zone" => "hand", "order" => 0, "cardId" => "LENTA" }] }
  end

  def test_il_giornale_comincia_dal_new_game_tirato_dal_tavolo
    room = stanza(starter: "b")
    assert_equal 1, room.journal.size
    assert_equal({ "t" => "newGame", "active" => "b" }, room.journal.first[:action])
    assert_nil room.journal.first[:from]
  end

  def test_il_saluto_porta_engine_e_giornale
    room = stanza
    a = seduto(room, "a")
    room.handle("a", { "t" => "hello" })
    assert_equal %w[peers engine journal], a.map { |m| m[:t] }
    assert_equal Rubyfront::Engine::VERSION, a[1][:version]
    assert_equal "newGame", a[2][:actions].first[:action]["t"]
  end

  def test_un_azione_che_passa_va_nel_giornale_e_agli_altri
    room = stanza
    a = seduto(room, "a")
    b = seduto(room, "b")
    a.clear
    b.clear
    room.handle("a", { "t" => "judge", "seq" => 7, "action" => mazzo("a"), "actor" => "a" })
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

  def test_un_azione_fermata_non_arriva_a_nessuno
    room = stanza(starter: "a")
    a = seduto(room, "a")
    b = seduto(room, "b")
    b.clear
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => { "t" => "player", "seat" => "a", "patch" => { "flux" => 21 } } })
    refute a.last[:ok]
    assert_match(/§3\.2/, a.last[:reason])
    assert_empty b
    assert_equal 1, room.journal.size
  end

  def test_in_stanza_l_attore_e_il_posto_del_client_non_quello_dichiarato
    room = stanza(starter: "a")
    a = seduto(room, "a")
    b = seduto(room, "b")
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

  def test_la_partita_nuova_ricomincia_il_giornale
    room = stanza
    seduto(room, "a")
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => mazzo("a") })
    room.handle("a", { "t" => "judge", "seq" => 2, "action" => { "t" => "newGame", "active" => "b" } })
    assert_equal 1, room.journal.size
    assert_equal "newGame", room.journal.first[:action]["t"]
    assert_equal "a", room.journal.first[:from]
  end

  def test_il_posto_occupato_si_rifiuta
    room = stanza
    seduto(room, "a")
    refute room.join("a", ->(_) {})
    assert_equal %w[a], room.seats
  end

  def test_chi_si_alza_libera_il_posto_e_gli_altri_lo_sanno
    room = stanza
    out = ->(_) {}
    assert room.join("a", out)
    b = seduto(room, "b")
    b.clear
    room.leave("a", out)
    assert_equal [{ t: "peers", peers: 1, seats: %w[b] }], b
    refute room.empty?
    room.leave("b", room.instance_variable_get(:@clients)["b"])
    assert room.empty?
    refute_nil room.emptied_at
  end

  def test_la_voce_si_inoltra_agli_altri_com_e
    room = stanza
    a = seduto(room, "a")
    b = seduto(room, "b")
    a.clear
    b.clear
    room.handle("a", { "t" => "rtc", "payload" => { "sdp" => "x" } })
    assert_empty a
    assert_equal [{ t: "rtc", payload: { "sdp" => "x" }, from: "a" }], b
  end

  def test_in_stanza_snapshot_e_consult_non_toccano_il_tavolo
    room = stanza(starter: "a")
    a = seduto(room, "a")
    room.handle("a", { "t" => "snapshot", "state" => { "turn" => 9, "active" => "b" } })
    room.handle("a", { "t" => "consult", "action" => mazzo("b"), "actor" => "b" })
    assert_equal 1, room.journal.size
    a.clear
    # Il turno è ancora quello del giornale: A può chiudere il suo turno 1.
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => { "t" => "turn", "turn" => 2, "active" => "b" } })
    assert a.last[:ok], a.last[:reason]
  end

  def test_la_stanza_solo_e_il_tavolo_di_prima
    room = stanza("", solo: true)
    assert room.solo?
    assert_empty room.journal
    a = seduto(room, "a")
    room.handle("a", { "t" => "hello" })
    assert_equal %w[peers engine], a.map { |m| m[:t] }
    # Lo snapshot del client si accetta, e l'attore dichiarato vale: col bot
    # al tavolo i gesti di B partono dallo stesso client.
    room.handle("a", { "t" => "snapshot", "state" => { "turn" => 3, "active" => "b" } })
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => { "t" => "turn", "turn" => 4, "active" => "a" }, "actor" => "b" })
    assert a.last[:ok], a.last[:reason]
  end

  def test_un_client_che_non_riceve_non_ferma_il_tavolo
    room = stanza
    assert room.join("a", ->(_) { raise IOError, "chiuso" })
    b = seduto(room, "b")
    b.clear
    room.handle("a", { "t" => "judge", "seq" => 1, "action" => mazzo("a") })
    assert_equal 1, b.size
    assert_equal "action", b.first[:t]
  end
end
