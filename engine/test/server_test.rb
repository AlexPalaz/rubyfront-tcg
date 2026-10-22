# frozen_string_literal: true

require "minitest/autorun"
require "json"
require "socket"
require "securerandom"
require "tempfile"
require "uri"
require_relative "support/ws_client"
require_relative "../lib/rubyfront/engine"

# Il tavolo VERO in ascolto (2026-10-21, audit T32 e le prove dal vivo di
# T13/T15/T16/T17/T27): si avvia engine/bin/server su una porta libera, con
# l'ambiente di prova (niente memoria, tester 7, un'Origin sola, grazia e
# sweeper brevi), e gli si parla in WebSocket come farebbe un browser.
class ServerTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  WS = Rubyfront::WebSocket

  ENV_BASE = {
    "DATABASE_URL" => "", "RUBYFRONT_TEST_IDS" => "7", "RUBYFRONT_ORIGINS" => "http://ok.test",
    "RUBYFRONT_SEAT_GRACE_S" => "1", "RUBYFRONT_SWEEP_S" => "1", "RUBYFRONT_PING_S" => "1",
    "RUBYFRONT_MAX_PER_IP" => "50", "RUBYFRONT_MAX_ROOMS" => "200", "RUBYFRONT_SEED" => "42",
    "RUBYFRONT_MESSAGES_PER_S" => "40", "RUBYFRONT_CONNECTS_PER_MIN" => "1000",
  }.freeze

  # Un tavolo in un processo a parte, su una porta libera: torna [porta, pid, log].
  def self.spawn_server(env = {})
    port = TCPServer.new("127.0.0.1", 0).then { |s| taken = s.addr[1]; s.close; taken }
    log = Tempfile.new("rubyfront-server")
    pid = Process.spawn(ENV_BASE.merge(env), "ruby", File.join(ROOT, "engine/bin/server"), port.to_s, chdir: ROOT, %i[out err] => log.path)
    deadline = Time.now + 15
    loop do
      begin
        TCPSocket.new("127.0.0.1", port).close
        break
      rescue SystemCallError
        raise "il tavolo non parte: #{File.read(log.path)}" if Time.now > deadline

        sleep 0.1
      end
    end
    [port, pid, log]
  end

  def self.stop_server(pid)
    Process.kill("TERM", pid) rescue nil
    Process.wait(pid) rescue nil
  end

  class << self
    attr_reader :port, :pid, :log

    def start!
      return if @pid

      @port, @pid, @log = spawn_server
      Minitest.after_run { stop! }
    end

    def stop!
      return unless @pid

      stop_server(@pid)
      @pid = nil
    end
  end

  # Un tavolo tutto suo per il test, con l'ambiente dato.
  def with_server(env)
    port, pid, = self.class.spawn_server(env)
    yield port
  ensure
    self.class.stop_server(pid) if pid
  end

  def setup
    require "tempfile"
    self.class.start!
    @port = self.class.port
    @room = "t#{SecureRandom.hex(3)}"
  end

  DECK_FILE = JSON.parse(File.read(File.join(ROOT, "data/decks/starter-umani.json")))
  DECK_IDS = DECK_FILE["cards"].flat_map { |entry| [entry["card"]] * entry["count"] }.freeze

  def whole_deck(seat)
    cards = DECK_IDS.each_with_index.map do |id, i|
      if id == "RBF-061"
        { "uid" => "#{seat}-#{i}", "owner" => seat, "zone" => "field", "order" => 0, "cardId" => id, "x" => 30, "y" => seat == "a" ? 1756 : -324, "face" => 0, "z" => 1, "tapped" => false, "facedown" => false }
      else
        { "uid" => "#{seat}-#{i}", "owner" => seat, "zone" => "deck", "order" => i, "cardId" => id, "x" => 0, "y" => 0, "face" => 0, "z" => 0, "tapped" => false, "facedown" => false }
      end
    end
    { "t" => "loadDeck", "seat" => seat, "deckId" => "starter-umani", "cards" => cards, "hp" => 20 }
  end

  # --- L'handshake --------------------------------------------------------------

  def test_handshake_ok_then_hello_engine_and_journal
    client = WsClient.open(@port, room: @room)
    seat = client.expect("seat")
    assert_equal "a", seat["seat"]
    assert_match(/\A\h{32}\z/, seat["token"])
    client.send({ "t" => "hello" })
    engine = client.expect("engine")
    assert_equal Rubyfront::Engine::VERSION, engine["version"]
    journal = client.expect("journal")
    assert_equal 1, journal["actions"].size
    assert_equal "newGame", journal["actions"][0]["action"]["t"]
    assert_match(/\A[0-9a-f-]{36}\z/, journal["match"])
    client.close
  end

  def test_plain_get_answers_200_text
    status = WsClient.raw(@port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n")
    assert_equal "HTTP/1.1 200 OK", status
  end

  def test_bad_origin_is_403_and_missing_origin_too
    assert_equal "HTTP/1.1 403 Forbidden", WsClient.raw(@port, "GET /engine HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: #{WsClient::KEY}\r\nOrigin: http://evil.test\r\n\r\n")
    assert_equal "HTTP/1.1 403 Forbidden", WsClient.raw(@port, "GET /engine HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: #{WsClient::KEY}\r\n\r\n")
    error = assert_raises(RuntimeError) { WsClient.open(@port, room: @room, origin: "http://evil.test") }
    assert_match(/403/, error.message)
  end

  def test_oversized_header_is_431
    big = "GET /engine HTTP/1.1\r\nHost: x\r\n" + ("X-Pad: #{"p" * 1000}\r\n" * 12) + "\r\n"
    assert_equal "HTTP/1.1 431 Request Header Fields Too Large", WsClient.raw(@port, big)
  end

  def test_slow_header_times_out
    socket = TCPSocket.new("127.0.0.1", @port)
    socket.write("GET /engine HTTP/1.1\r\nHost: x\r\n")
    started = Time.now
    ready = IO.select([socket], nil, nil, 8)
    assert ready, "entro la scadenza il tavolo risponde o chiude"
    line = socket.gets
    assert_operator Time.now - started, :<, 7.5
    assert_match(/408|\A\z/, line.to_s)
    socket.close
  end

  def test_wrong_version_is_426_and_bad_room_name_is_400
    assert_equal "HTTP/1.1 426 Upgrade Required", WsClient.raw(@port, "GET /engine HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 8\r\nSec-WebSocket-Key: #{WsClient::KEY}\r\nOrigin: http://ok.test\r\n\r\n")
    assert_equal "HTTP/1.1 400 Bad Request", WsClient.raw(@port, "GET /engine?room=con%20spazio HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: #{WsClient::KEY}\r\nOrigin: http://ok.test\r\n\r\n")
    assert_equal "HTTP/1.1 404 Not Found", WsClient.raw(@port, "GET /admin HTTP/1.1\r\nHost: x\r\n\r\n")
  end

  # --- Due client, il giornale e le viste --------------------------------------

  def test_two_clients_share_the_journal_in_their_own_view
    a = WsClient.open(@port, room: @room, seat: "a")
    assert_equal "a", a.expect("seat")["seat"]
    b = WsClient.open(@port, room: @room, seat: "b")
    assert_equal "b", b.expect("seat")["seat"]
    a.send({ "t" => "judge", "seq" => 1, "action" => whole_deck("a") })
    verdict = a.expect("verdict")
    assert verdict["ok"], verdict["reason"]
    assert verdict["applied"]["cards"].all? { |card| card["cardId"] }, "il mio mazzo intero, mescolato dal tavolo"
    orders = verdict["applied"]["cards"].select { |c| c["zone"] == "deck" }.map { |c| c["order"] }
    refute_equal orders.sort, orders, "mescolato (seme 42)"
    action = b.expect("action")
    assert_equal "loadDeck", action["action"]["t"]
    assert action["action"]["cards"].select { |c| c["zone"] == "deck" }.none? { |c| c.key?("cardId") || c.key?("order") }, "l'avversario vede i dorsi"
    assert_equal "a", action["from"]
    b.send({ "t" => "hello" })
    journal = b.expect("journal")
    assert journal["actions"].last["action"]["cards"].select { |c| c["zone"] == "deck" }.none? { |c| c.key?("cardId") }
    a.close
    b.close
  end

  def test_roll_is_rolled_by_the_table
    a = WsClient.open(@port, room: @room)
    a.expect("seat")
    a.send({ "t" => "judge", "seq" => 3, "action" => { "t" => "roll", "seat" => "a", "die" => 6, "for" => "cost|a-1", "value" => 99 } })
    verdict = a.expect("verdict")
    assert verdict["ok"], verdict["reason"]
    assert verdict["applied"]["value"].between?(1, 6)
    a.close
  end

  def test_malformed_judge_is_refused_not_journaled
    a = WsClient.open(@port, room: @room)
    a.expect("seat")
    a.send({ "t" => "judge", "seq" => 4, "action" => nil })
    verdict = a.expect("verdict")
    refute verdict["ok"]
    assert_match(/§protocollo/, verdict["reason"])
    a.send({ "t" => "judge", "seq" => 5, "action" => { "foo" => 1 } })
    refute a.expect("verdict")["ok"]
    a.send({ "t" => "hello" })
    assert_equal 1, a.expect("journal")["actions"].size
    a.close
  end

  def test_tester_tools_need_the_tester_account
    a = WsClient.open(@port, room: @room)
    a.expect("seat")
    a.send({ "t" => "judge", "seq" => 6, "action" => { "t" => "player", "seat" => "a", "patch" => { "flux" => 5 }, "test" => true } })
    verdict = a.expect("verdict")
    refute verdict["ok"]
    assert_match(/account di prova/, verdict["reason"])
    a.close
  end

  # --- I frame storti -----------------------------------------------------------

  def test_malformed_frame_closes_1002
    a = WsClient.open(@port, room: @room)
    a.expect("seat")
    a.send_raw(WS.encode_text("nudo", mask: false))
    assert_equal 1002, a.close_code
  end

  def test_oversized_frame_closes_1009
    a = WsClient.open(@port, room: @room)
    a.expect("seat")
    a.send_raw([0x81, 0x80 | 127, 10 * 1024 * 1024].pack("C2Q>") + ("k" * 4))
    assert_equal 1009, a.close_code
  end

  def test_binary_frame_closes_1003
    a = WsClient.open(@port, room: @room)
    a.expect("seat")
    a.send_raw(WS.encode_frame(0x2, "bin", mask: true))
    assert_equal 1003, a.close_code
  end

  def test_server_pings_and_pong_keeps_the_socket
    a = WsClient.open(@port, room: @room)
    a.expect("seat")
    pinged = false
    deadline = Time.now + 4
    while Time.now < deadline
      event = a.recv(timeout: 1)
      next unless event
      if event.first == :ping
        pinged = true
        a.send_raw(WS.encode_pong(event[1], mask: true))
      end
      break if event.first == :close || event.first == :eof
    end
    assert pinged, "il tavolo manda il ping"
    a.send({ "t" => "hello" })
    assert a.expect("engine"), "col pong il socket resta aperto"
    a.close
  end

  def test_message_flood_closes_1008
    a = WsClient.open(@port, room: @room)
    a.expect("seat")
    60.times { a.send({ "t" => "hello" }) rescue break }
    deadline = Time.now + 5
    code = nil
    while Time.now < deadline
      event = a.recv(timeout: 1)
      break if event.nil?
      if event.first == :close
        code = event[1]
        break
      end
      break if event.first == :eof
    end
    assert_equal 1008, code
  end

  # --- Il posto e la stanza -------------------------------------------------------

  def test_seat_token_resumes_after_reconnect_and_stranger_gets_room_full
    a = WsClient.open(@port, room: @room, seat: "a")
    token = a.expect("seat")["token"]
    b = WsClient.open(@port, room: @room, seat: "b")
    b.expect("seat")
    a.socket.close
    sleep 0.2
    stranger = WsClient.open(@port, room: @room, seat: "a")
    assert stranger.expect("room_full"), "il posto A è riservato al token, B è preso"
    back = WsClient.open(@port, room: @room, seat: "a", token: token)
    seat = back.expect("seat")
    assert_equal "a", seat["seat"]
    assert_equal true, seat["resumed"]
    assert_equal token, seat["token"]
    back.close
    b.close
  end

  def test_absent_seat_forfeits_after_grace
    a = WsClient.open(@port, room: @room, seat: "a")
    a.expect("seat")
    b = WsClient.open(@port, room: @room, seat: "b")
    b.expect("seat")
    a.send({ "t" => "judge", "seq" => 1, "action" => whole_deck("a") })
    assert a.expect("verdict")["ok"]
    b.send({ "t" => "judge", "seq" => 1, "action" => whole_deck("b") })
    assert b.expect("verdict")["ok"]
    [a, b].each_with_index do |client, i|
      seat = %w[a b][i]
      client.send({ "t" => "judge", "seq" => 2, "action" => { "t" => "draw", "seat" => seat, "count" => 6 } })
      assert client.expect("verdict")["ok"]
      client.send({ "t" => "judge", "seq" => 3, "action" => { "t" => "keep", "seat" => seat } })
      assert client.expect("verdict")["ok"]
    end
    a.socket.close
    over = nil
    deadline = Time.now + 6
    while Time.now < deadline && over.nil?
      event = b.recv(timeout: 1)
      next unless event && event.first == :message

      over = event[1] if event[1]["t"] == "action" && event[1]["action"]["t"] == "gameOver"
    end
    refute_nil over, "entro la grazia (1 s) più lo sweeper (1 s) B riceve l'abbandono"
    assert_equal({ "t" => "gameOver", "winner" => "b", "reason" => "forfeit" }, over["action"])
    assert_nil over["from"]
    b.close
  end

  def test_rooms_full_refuses_a_fourth_room
    with_server("RUBYFRONT_MAX_ROOMS" => "3") do |port|
      clients = 3.times.map { |i| WsClient.open(port, room: "#{@room}#{i}") }
      clients.each { |c| assert c.expect("seat") }
      fourth = WsClient.open(port, room: "#{@room}x")
      refused = fourth.expect("refused")
      assert_equal "rooms_full", refused["code"]
      assert_equal 1008, fourth.close_code
      clients.each(&:close)
    end
  end

  def test_per_ip_cap_is_429
    with_server("RUBYFRONT_MAX_PER_IP" => "2") do |port|
      clients = 2.times.map { |i| WsClient.open(port, room: "#{@room}#{i}") }
      clients.each { |c| assert c.expect("seat") }
      status = WsClient.raw(port, "GET /engine HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: #{WsClient::KEY}\r\nOrigin: http://ok.test\r\n\r\n")
      assert_equal "HTTP/1.1 429 Too Many Requests", status
      clients.each(&:close)
      sleep 0.3
      again = WsClient.open(port, room: "#{@room}z")
      assert again.expect("seat"), "chiuse le prime, il posto per l'indirizzo torna"
      again.close
    end
  end

  def test_solo_room_accepts_snapshot_and_has_no_journal
    solo = WsClient.open(@port)
    solo.expect("seat")
    solo.send({ "t" => "hello" })
    assert solo.expect("engine")
    assert_nil solo.expect("journal", timeout: 0.5)
    solo.send({ "t" => "snapshot", "state" => { "turn" => 3, "active" => "b" } })
    solo.send({ "t" => "judge", "seq" => 1, "action" => { "t" => "turn", "turn" => 4, "active" => "a" }, "actor" => "b" })
    verdict = solo.expect("verdict")
    assert verdict["ok"], verdict["reason"]
    solo.close
  end
end
