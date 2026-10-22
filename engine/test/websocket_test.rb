# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/websocket"

# Il decodificatore dei frame: ciò che arriva spezzato, incollato o a
# frammenti si consegna completo; dal 2026-10-21 (audit RF-014) i limiti e
# il protocollo storto fermano la connessione con un codice di chiusura.
class WebSocketTest < Minitest::Test
  WS = Rubyfront::WebSocket

  def frame(opcode, payload = "", fin: true, mask: true)
    WS.encode_frame(opcode, payload, fin: fin, mask: mask)
  end

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
    decoder = WS::Decoder.new
    assert_equal [], decoder.feed(frame(0x1, "primo", fin: false))
    assert_equal [[:text, "primo secondo"]], decoder.feed(frame(0x0, " secondo"))
  end

  def test_ping_and_close_become_events
    decoder = WS::Decoder.new
    assert_equal [[:ping, "hi"]], decoder.feed(frame(0x9, "hi"))
    assert_equal [[:close, nil]], decoder.feed(WS.encode_close(mask: true))
  end

  def test_two_frames_glued_in_one_chunk
    glued = WS.encode_text("uno", mask: true) + WS.encode_text("due", mask: true)
    assert_equal [[:text, "uno"], [:text, "due"]], WS::Decoder.new.feed(glued)
  end

  # --- I limiti e il protocollo (T16) ------------------------------------------

  def fail_of(bytes, **opts)
    events = WS::Decoder.new(**opts).feed(bytes)
    assert_equal :fail, events.last&.first, events.inspect
    events.last
  end

  def test_unmasked_client_frame_fails_1002
    failure = fail_of(WS.encode_text("nudo", mask: false))
    assert_equal WS::CLOSE_PROTOCOL, failure[1]
    assert_match(/masked/, failure[2])
    assert_equal [[:text, "nudo"]], WS::Decoder.new(require_mask: false).feed(WS.encode_text("nudo", mask: false)), "il test parla col server a frame nudi, se vuole"
  end

  def test_rsv_bits_fail_1002
    bytes = WS.encode_text("x", mask: true)
    bytes.setbyte(0, bytes.getbyte(0) | 0x40)
    assert_equal WS::CLOSE_PROTOCOL, fail_of(bytes)[1]
  end

  def test_unknown_opcode_fails_1002
    [0x3, 0x7, 0xB, 0xF].each do |opcode|
      assert_equal WS::CLOSE_PROTOCOL, fail_of(frame(opcode, "x"))[1], opcode.to_s
    end
  end

  def test_binary_frame_fails_1003
    assert_equal WS::CLOSE_UNSUPPORTED, fail_of(frame(0x2, "\x00\x01"))[1]
  end

  def test_control_frame_over_125_fails_1002
    bytes = [0x89 | 0x00, 0x80 | 126, 200].pack("C2n") + ("k" * 4) + ("p" * 200)
    assert_equal WS::CLOSE_PROTOCOL, fail_of(bytes)[1]
    assert_raises(ArgumentError) { WS.encode_pong("p" * 126) }
  end

  def test_fragmented_control_frame_fails_1002
    assert_equal WS::CLOSE_PROTOCOL, fail_of(frame(0x9, "hi", fin: false))[1]
  end

  def test_frame_over_max_fails_1009_before_payload_arrives
    head = [0x81, 0x80 | 127, WS::MAX_FRAME_BYTES + 1].pack("C2Q>") + ("k" * 4)
    failure = fail_of(head)
    assert_equal WS::CLOSE_TOO_BIG, failure[1]
    assert_match(/frame over/, failure[2])
    exact = WS::Decoder.new(max_frame: 10).feed(WS.encode_text("x" * 10, mask: true))
    assert_equal [[:text, "x" * 10]], exact, "al tetto esatto passa"
  end

  def test_message_over_max_across_fragments_fails_1009
    decoder = WS::Decoder.new(max_frame: 100, max_message: 150)
    assert_equal [], decoder.feed(frame(0x1, "a" * 100, fin: false))
    failure = decoder.feed(frame(0x0, "b" * 60))
    assert_equal [:fail, WS::CLOSE_TOO_BIG, "message over 150 bytes"], failure.last
  end

  def test_too_many_fragments_fails_1009
    decoder = WS::Decoder.new(max_fragments: 3)
    assert_equal [], decoder.feed(frame(0x1, "a", fin: false))
    assert_equal [], decoder.feed(frame(0x0, "b", fin: false))
    assert_equal [], decoder.feed(frame(0x0, "c", fin: false))
    assert_equal [:fail, WS::CLOSE_TOO_BIG, "too many fragments"], decoder.feed(frame(0x0, "d", fin: false)).last
    fine = WS::Decoder.new(max_fragments: 3)
    fine.feed(frame(0x1, "a", fin: false))
    fine.feed(frame(0x0, "b", fin: false))
    fine.feed(frame(0x0, "c", fin: false))
    assert_equal [[:text, "abcd"]], fine.feed(frame(0x0, "d")), "l'ultimo frammento (FIN) chiude entro il tetto"
  end

  def test_continuation_without_start_fails_1002
    failure = fail_of(frame(0x0, "orfana"))
    assert_equal WS::CLOSE_PROTOCOL, failure[1]
    assert_match(/continuation/, failure[2])
  end

  def test_text_frame_inside_fragmented_message_fails_1002
    decoder = WS::Decoder.new
    decoder.feed(frame(0x1, "a", fin: false))
    assert_equal [:fail, WS::CLOSE_PROTOCOL, "text frame inside a fragmented message"], decoder.feed(frame(0x1, "b")).last
  end

  def test_invalid_utf8_text_fails_1007
    failure = fail_of(frame(0x1, "\xff\xfe".b))
    assert_equal WS::CLOSE_BAD_DATA, failure[1]
    decoder = WS::Decoder.new
    decoder.feed(frame(0x1, "\xe2\x82".b, fin: false))
    assert_equal [:fail, WS::CLOSE_BAD_DATA, "text is not UTF-8"], decoder.feed(frame(0x0, "x")).last, "un carattere spezzato fra i frammenti"
    whole = WS::Decoder.new
    whole.feed(frame(0x1, "\xe2\x82".b, fin: false))
    assert_equal [[:text, "€"]], whole.feed(frame(0x0, "\xac".b)), "ricomposto è UTF-8 valido"
  end

  def test_ping_between_fragments_is_delivered_and_message_completes
    decoder = WS::Decoder.new
    assert_equal [], decoder.feed(frame(0x1, "pri", fin: false))
    assert_equal [[:ping, "x"]], decoder.feed(frame(0x9, "x"))
    assert_equal [[:text, "primo"]], decoder.feed(frame(0x0, "mo"))
  end

  def test_pong_becomes_event
    assert_equal [[:pong, "rf"]], WS::Decoder.new.feed(frame(0xA, "rf"))
  end

  def test_close_carries_status_code
    assert_equal [[:close, 1000]], WS::Decoder.new.feed(WS.encode_close(1000, "bye", mask: true))
    assert_equal [[:close, nil]], WS::Decoder.new.feed(WS.encode_close(mask: true))
    assert_equal [[:close, 1002]], WS::Decoder.new.feed(frame(0x8, "\x03")), "un byte solo è protocollo storto"
  end

  def test_decoder_is_dead_after_fail
    decoder = WS::Decoder.new
    assert_equal :fail, decoder.feed(frame(0x2, "bin")).last.first
    assert decoder.failed?
    assert_equal [], decoder.feed(WS.encode_text("dopo", mask: true))
    assert_equal WS::CLOSE_UNSUPPORTED, decoder.failure[1]
  end

  def test_encode_ping_and_pong_round_trip
    assert_equal [[:ping, "p" * 125]], WS::Decoder.new(require_mask: false).feed(WS.encode_ping("p" * 125))
    assert_equal [[:pong, "q" * 125]], WS::Decoder.new(require_mask: false).feed(WS.encode_pong("q" * 125))
  end

  def test_encode_close_with_code_and_reason_round_trips_through_parse_close
    bytes = WS.encode_close(1009, "troppo grande")
    assert_equal [1009, "troppo grande"], WS.parse_close(bytes.byteslice(2..))
    assert_equal [nil, ""], WS.parse_close("")
    assert_equal [1002, ""], WS.parse_close("\x03")
    assert_equal [1002, ""], WS.parse_close("\x03\xe8\xff".b)
    assert_equal 2 + 2 + 123, WS.encode_close(1000, "r" * 200).bytesize, "il motivo entro i 123 byte"
  end

  def test_length_64_bit_with_top_bit_fails_1002
    head = [0x81, 0x80 | 127, (1 << 63) | 10].pack("C2Q>") + ("k" * 4)
    assert_equal WS::CLOSE_PROTOCOL, fail_of(head)[1]
  end

  def test_large_buffer_without_a_complete_header_fails_1009
    # Un frame dichiarato enorme, servito a pezzi: cade sulla dichiarazione, non riempie la RAM.
    decoder = WS::Decoder.new
    head = [0x81, 0x80 | 127, 10 * 1024 * 1024].pack("C2Q>")
    assert_equal :fail, decoder.feed(head + ("k" * 4)).last.first
  end

  def test_many_small_frames_keep_the_buffer_compact
    decoder = WS::Decoder.new
    2000.times { |i| assert_equal [[:text, i.to_s]], decoder.feed(WS.encode_text(i.to_s, mask: true)) }
    assert_operator decoder.instance_variable_get(:@buffer).bytesize, :<, 64
  end
end
