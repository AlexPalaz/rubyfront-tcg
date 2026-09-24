# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/lobby"

# L'atrio (2026-09-23): la fila della partita casuale. In due si apre una
# stanza e ciascuno sa dove sedersi; chi ci ripensa esce dalla fila.
class LobbyTest < Minitest::Test
  def box
    list = []
    [list, ->(payload) { list << payload }]
  end

  def new_lobby
    Rubyfront::Lobby.new(namer: -> { "prova-1234" })
  end

  def test_one_alone_waits
    lobby = new_lobby
    a, out = box
    assert lobby.handle({ "t" => "match" }, out)
    assert_equal 1, lobby.waiting
    assert_empty a
  end

  def test_two_are_matched_in_a_fresh_room_first_at_a_second_at_b
    lobby = new_lobby
    a, out_a = box
    b, out_b = box
    lobby.enqueue(out_a)
    lobby.enqueue(out_b)
    assert_equal [{ t: "matched", room: "prova-1234", seat: "a" }], a
    assert_equal [{ t: "matched", room: "prova-1234", seat: "b" }], b
    assert_equal 0, lobby.waiting
  end

  def test_same_client_twice_counts_once
    lobby = new_lobby
    a, out = box
    lobby.enqueue(out)
    lobby.enqueue(out)
    assert_equal 1, lobby.waiting
    assert_empty a
  end

  def test_cancel_leaves_the_line
    lobby = new_lobby
    _, out = box
    lobby.enqueue(out)
    assert lobby.handle({ "t" => "match_cancel" }, out)
    assert_equal 0, lobby.waiting
    _, other = box
    lobby.enqueue(other)
    assert_equal 1, lobby.waiting
  end

  def test_other_envelopes_are_not_of_the_lobby
    lobby = new_lobby
    _, out = box
    refute lobby.handle({ "t" => "hello" }, out)
    refute lobby.handle("no", out)
  end

  def test_a_client_that_cannot_receive_does_not_break_the_pair
    lobby = new_lobby
    b, out_b = box
    lobby.enqueue(->(_) { raise IOError })
    lobby.enqueue(out_b)
    assert_equal "b", b.first[:seat]
  end

  def test_random_name_is_a_gem_and_four_digits
    assert_match(/\A[a-z]+-\d{4}\z/, Rubyfront::Lobby.random_name)
  end
end
