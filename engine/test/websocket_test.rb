# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/websocket"

class WebSocketTest < Minitest::Test
  WS = Rubyfront::WebSocket

  def test_masked_frame_round_trip
    events = WS::Decoder.new.feed(WS.encode_text("ciao dal client", mask: true))
    assert_equal [[:text, "ciao dal client"]], events
  end

  def test_bytes_can_arrive_split
    decoder = WS::Decoder.new
    frame = WS.encode_text("un messaggio in due pezzi", mask: true)
    assert_equal [], decoder.feed(frame.byteslice(0, 5))
    assert_equal [[:text, "un messaggio in due pezzi"]], decoder.feed(frame.byteslice(5..))
  end

  def test_large_payload_with_extended_length
    long = "x" * 70_000
    events = WS::Decoder.new.feed(WS.encode_text(long, mask: true))
    assert_equal [[:text, long]], events
  end

  def test_message_fragmented_in_several_frames
    # FIN=0 sul primo frame, continuazione 0x0 con FIN=1: come fa Safari.
    first = [0x01, 0x05].pack("C2") + "primo"
    second = [0x80, 0x08].pack("C2") + " secondo"
    decoder = WS::Decoder.new
    assert_equal [], decoder.feed(first)
    assert_equal [[:text, "primo secondo"]], decoder.feed(second)
  end

  def test_ping_and_close_become_events
    decoder = WS::Decoder.new
    ping = [0x89, 0x02].pack("C2") + "hi"
    assert_equal [[:ping, "hi"]], decoder.feed(ping)
    assert_equal [[:close]], decoder.feed(WS.encode_close)
  end

  def test_two_frames_glued_in_one_chunk
    glued = WS.encode_text("uno", mask: true) + WS.encode_text("due", mask: true)
    assert_equal [[:text, "uno"], [:text, "due"]], WS::Decoder.new.feed(glued)
  end
end
