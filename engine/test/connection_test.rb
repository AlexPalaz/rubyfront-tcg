# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/connection"

# La connessione col thread scrittore (2026-10-21, audit RF-017, T19): la
# coda d'uscita non blocca chi scrive, il lettore lento cade, il ping e la
# chiusura con codice escono dallo scrittore.
class ConnectionTest < Minitest::Test
  WS = Rubyfront::WebSocket

  # Un socket finto: una pipe, letta dall'altro capo col decodificatore (frame nudi: li scrive il server).
  def wired(**opts)
    reader, writer = IO.pipe
    connection = Rubyfront::Connection.new(writer, **opts)
    decoder = WS::Decoder.new(require_mask: false)
    [connection, reader, decoder]
  end

  def events_from(reader, decoder, timeout: 1)
    events = []
    deadline = Time.now + timeout
    while Time.now < deadline
      ready = IO.select([reader], nil, nil, 0.05)
      next unless ready

      chunk = reader.read_nonblock(65_536, exception: false)
      break if chunk.nil?
      next if chunk == :wait_readable

      events.concat(decoder.feed(chunk))
      break unless events.empty?
    end
    events
  end

  def test_out_writes_a_text_frame_from_the_writer_thread
    connection, reader, decoder = wired
    connection.run_writer
    assert connection.out.call({ t: "seat", seat: "a" })
    assert_equal [[:text, '{"t":"seat","seat":"a"}']], events_from(reader, decoder)
    connection.close
    connection.join
    assert_equal [[:close, 1000]], events_from(reader, decoder)
  end

  def test_queue_over_the_message_cap_closes_1008
    connection, = wired(max_queue: 3)
    # Senza scrittore nulla si svuota: la coda si riempie.
    3.times { |i| assert connection.push({ n: i }) }
    refute connection.push({ n: 4 })
    assert connection.closed?
    assert_equal WS::CLOSE_POLICY, connection.close_code
    refute connection.push({ n: 5 }), "chiusa: nulla più entra"
  end

  def test_queue_over_the_byte_cap_closes_1008
    connection, reader, decoder = wired(max_queue_bytes: 100)
    assert connection.push({ t: "x" * 50 })
    refute connection.push({ t: "x" * 50 })
    assert_equal WS::CLOSE_POLICY, connection.close_code
    connection.run_writer
    events = []
    3.times { events.concat(events_from(reader, decoder)) }
    assert_includes events, [:close, 1008]
  end

  def test_ping_when_idle_and_close_after_missed_pongs
    connection, reader, decoder = wired(ping_every_s: 0.05, max_missed_pongs: 1)
    connection.run_writer
    assert_equal [[:ping, "rf"]], events_from(reader, decoder)
    all = []
    5.times { all.concat(events_from(reader, decoder)) }
    assert_includes all, [:close, 1001], "due giri senza pong: 1001"
    connection.join
  end

  def test_pong_resets_the_missed_count
    connection, reader, decoder = wired(ping_every_s: 0.05, max_missed_pongs: 1)
    connection.run_writer
    4.times do
      assert_equal [[:ping, "rf"]], events_from(reader, decoder)
      connection.pong!
    end
    refute connection.closed?
    connection.close
    connection.join
  end

  def test_close_writes_the_status_code_then_closes_the_io
    connection, reader, decoder = wired
    connection.run_writer
    connection.close(1009, "troppo grande")
    assert_equal [[:close, 1009]], events_from(reader, decoder)
    connection.join
    assert_equal [], events_from(reader, decoder, timeout: 0.2)
    assert_raises(IOError, EOFError) { reader.readpartial(1) } rescue assert true
  end

  def test_push_frame_goes_out_as_is
    connection, reader, decoder = wired
    connection.run_writer
    connection.push_frame(WS.encode_pong("hi"))
    assert_equal [[:pong, "hi"]], events_from(reader, decoder)
    connection.close
    connection.join
  end
end
