# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/websocket"

class WebSocketTest < Minitest::Test
  WS = Rubyfront::WebSocket

  def test_andata_e_ritorno_di_un_frame_mascherato
    events = WS::Decoder.new.feed(WS.encode_text("ciao dal client", mask: true))
    assert_equal [[:text, "ciao dal client"]], events
  end

  def test_i_byte_possono_arrivare_spezzati
    decoder = WS::Decoder.new
    frame = WS.encode_text("un messaggio in due pezzi", mask: true)
    assert_equal [], decoder.feed(frame.byteslice(0, 5))
    assert_equal [[:text, "un messaggio in due pezzi"]], decoder.feed(frame.byteslice(5..))
  end

  def test_payload_grande_con_lunghezza_estesa
    long = "x" * 70_000
    events = WS::Decoder.new.feed(WS.encode_text(long, mask: true))
    assert_equal [[:text, long]], events
  end

  def test_un_messaggio_frammentato_in_piu_frame
    # FIN=0 sul primo frame, continuazione 0x0 con FIN=1: come fa Safari.
    first = [0x01, 0x05].pack("C2") + "primo"
    second = [0x80, 0x08].pack("C2") + " secondo"
    decoder = WS::Decoder.new
    assert_equal [], decoder.feed(first)
    assert_equal [[:text, "primo secondo"]], decoder.feed(second)
  end

  def test_ping_e_close_diventano_eventi
    decoder = WS::Decoder.new
    ping = [0x89, 0x02].pack("C2") + "hi"
    assert_equal [[:ping, "hi"]], decoder.feed(ping)
    assert_equal [[:close]], decoder.feed(WS.encode_close)
  end

  def test_due_frame_incollati_nello_stesso_chunk
    glued = WS.encode_text("uno", mask: true) + WS.encode_text("due", mask: true)
    assert_equal [[:text, "uno"], [:text, "due"]], WS::Decoder.new.feed(glued)
  end
end
