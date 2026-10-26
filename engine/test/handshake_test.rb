# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/handshake"

# L'handshake puro (2026-10-21, audit RF-013/RF-025): la richiesta si
# giudica senza socket; la lettura ha scadenza e tetto.
class HandshakeTest < Minitest::Test
  H = Rubyfront::Handshake
  KEY = "dGhlIHNhbXBsZSBub25jZQ==" # 16 byte in base64 (RFC 6455 §1.3)

  def request(path: "/engine?room=Rubino-12&seat=b&token=#{"a" * 32}", origin: "https://rubyfront.app", version: "13", key: KEY, extra: [], upgrade: true, method: "GET")
    lines = ["#{method} #{path} HTTP/1.1", "Host: tavolo"]
    lines += ["Upgrade: websocket", "Connection: keep-alive, Upgrade", "Sec-WebSocket-Version: #{version}"] if upgrade
    lines << "Sec-WebSocket-Key: #{key}" if key && upgrade
    lines << "Origin: #{origin}" if origin
    lines += extra
    lines.join("\r\n") + "\r\n\r\n"
  end

  def test_parses_key_room_seat_token_and_origin
    result = H.parse(request, origins: ["https://rubyfront.app"], peer_ip: "1.2.3.4")
    assert_equal :upgrade, result.kind
    assert_equal KEY, result.key
    assert_equal "/engine", result.path
    assert_equal "rubino-12", result.room, "il nome in minuscolo"
    assert_equal "b", result.seat
    assert_equal "a" * 32, result.token
    assert_equal "https://rubyfront.app", result.origin
    assert_equal "1.2.3.4", result.client_ip
  end

  def test_plain_get_is_the_courtesy_text
    result = H.parse(request(upgrade: false, key: nil))
    assert_equal :plain, result.kind
    assert_equal "/engine", result.path
    assert_equal :plain, H.parse("GET / HTTP/1.1\r\nHost: x\r\n\r\n").kind
  end

  def test_missing_or_malformed_key_is_400
    assert_equal 400, H.parse(request(key: nil)).status
    assert_equal 400, H.parse(request(key: "corta")).status
    assert_equal 400, H.parse(request(key: "x" * 24)).status
    result = H.parse(request(key: nil))
    assert_equal :error, result.kind
    assert_match(/chiave/, result.reason)
    assert_match(/key/, result.reason_en)
  end

  def test_wrong_version_is_426
    result = H.parse(request(version: "8"))
    assert_equal 426, result.status
    assert_match(/Sec-WebSocket-Version: 13/, H.response_error(426, result.reason))
  end

  def test_bad_path_is_404
    assert_equal 404, H.parse(request(path: "/admin")).status
    assert_equal 404, H.parse(request(path: "/engine/x")).status
    assert_equal :upgrade, H.parse(request(path: "/")).kind
  end

  def test_post_or_bad_version_is_400
    assert_equal 400, H.parse(request(method: "POST")).status
    assert_equal 400, H.parse("GET / HTTP/0.9\r\n\r\n").status
    assert_equal 400, H.parse("").status
    assert_equal 400, H.parse("garbage\r\n\r\n").status
  end

  def test_header_line_too_long_is_431
    assert_equal 431, H.parse(request(extra: ["X-Big: #{"x" * 3000}"])).status
  end

  # I cookie di localhost (di ogni porta, di ogni progetto) arrivano anche al
  # tavolo: una riga Cookie lunga si ignora, non è un 431 (dal 2026-10-23).
  def test_long_cookie_line_is_ignored_not_431
    result = H.parse(request(extra: ["Cookie: #{(1..6).map { |i| "progetto_#{i}=#{"x" * 500}" }.join("; ")}"]))
    assert_equal :upgrade, result.kind
  end

  def test_too_many_headers_is_431
    assert_equal 431, H.parse(request(extra: (1..70).map { |i| "X-N#{i}: #{i}" })).status
  end

  def test_origin_refused_when_allowlist_set
    result = H.parse(request(origin: "https://evil.example"), origins: ["https://rubyfront.app"])
    assert_equal 403, result.status
    assert_match(/origine/, result.reason)
    assert_equal 403, H.parse(request(origin: nil), origins: ["https://rubyfront.app"]).status, "senza Origin, con l'elenco, no"
  end

  def test_origin_allowed_when_allowlist_empty_or_matching
    assert_equal :upgrade, H.parse(request(origin: "https://evil.example"), origins: []).kind
    assert_equal :upgrade, H.parse(request(origin: nil), origins: nil).kind
    assert_equal :upgrade, H.parse(request(origin: "HTTPS://Rubyfront.app/"), origins: ["https://rubyfront.app"]).kind, "maiuscole e barra finale non contano"
    assert_equal :upgrade, H.parse(request(origin: "http://localhost:5200"), origins: ["https://rubyfront.app", "http://localhost:5200"]).kind
  end

  def test_null_origin_refused_with_allowlist
    assert_equal 403, H.parse(request(origin: "null"), origins: ["https://rubyfront.app"]).status
  end

  def test_wildcard_allows_everything
    assert_equal :upgrade, H.parse(request(origin: "https://evil.example"), origins: ["*"]).kind
    assert_equal :upgrade, H.parse(request(origin: nil), origins: ["*"]).kind
  end

  def test_invalid_room_name_is_400
    ["/engine?room=con%20spazio", "/engine?room=#{"x" * 33}", "/engine?room=-inizio", "/engine?room=%C3%A8"].each do |path|
      assert_equal 400, H.parse(request(path: path)).status, path
    end
    assert_equal "", H.parse(request(path: "/engine")).room, "senza stanza: la «solo»"
    assert_equal "gem_12-x", H.parse(request(path: "/engine?room=gem_12-x")).room
  end

  def test_seat_outside_a_b_is_empty_and_token_must_be_32_hex
    assert_equal "", H.parse(request(path: "/engine?seat=c")).seat
    assert_equal "", H.parse(request(path: "/engine?token=abc")).token
    assert_equal "", H.parse(request(path: "/engine?token=#{"Z" * 32}")).token
    assert_equal "f" * 32, H.parse(request(path: "/engine?token=#{"f" * 32}")).token
  end

  def test_client_ip_uses_forwarded_only_from_loopback
    forwarded = request(extra: ["X-Forwarded-For: 9.9.9.9, 10.0.0.1"])
    assert_equal "9.9.9.9", H.parse(forwarded, peer_ip: "127.0.0.1").client_ip
    assert_equal "9.9.9.9", H.parse(forwarded, peer_ip: "::1").client_ip
    assert_equal "5.5.5.5", H.parse(forwarded, peer_ip: "5.5.5.5").client_ip, "da un peer vero l'intestazione non conta"
    assert_equal "5.5.5.5", H.parse(request, peer_ip: "5.5.5.5").client_ip
  end

  def test_responses
    assert_match(/\AHTTP\/1.1 101 Switching Protocols\r\n.*Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=\r\n\r\n\z/m, H.response_101(KEY))
    plain = H.response_plain("ciao\n")
    assert_match(/\AHTTP\/1.1 200 OK\r\n/, plain)
    assert_match(/Content-Length: 5\r\n/, plain)
    assert_match(/Connection: close/, plain)
    assert_match(/\AHTTP\/1.1 431 Request Header Fields Too Large\r\n/, H.response_error(431, "troppo"))
    assert_match(/\AHTTP\/1.1 503 Service Unavailable\r\n/, H.response_plain("pieno\n", status: 503, reason: "Service Unavailable"))
  end

  # --- La lettura con scadenza e tetto -----------------------------------------

  def pipe_with(text)
    reader, writer = IO.pipe
    writer.write(text)
    [reader, writer]
  end

  def test_read_returns_at_blank_line_with_body_bytes_left
    reader, writer = pipe_with("GET / HTTP/1.1\r\nHost: x\r\n\r\nCORPO")
    text = H.read(reader, deadline_s: 1)
    assert_equal "GET / HTTP/1.1\r\nHost: x\r\n\r\n", text
    writer.close
  end

  def test_read_stops_at_deadline
    reader, writer = pipe_with("GET / HTTP/1.1\r\nHost: x\r\n")
    now = 0.0
    clock = -> { now }
    thread = Thread.new do
      sleep 0.05
      now = 10.0
      writer.write("x") # sveglia la select: la scadenza è passata
    end
    assert_raises(H::Timeout) { H.read(reader, deadline_s: 5, clock: clock) }
    thread.join
    # Anche con l'orologio vero, senza byte in arrivo.
    assert_raises(H::Timeout) { H.read(reader, deadline_s: 0.05) }
  end

  def test_read_refuses_more_than_the_cap
    reader, writer = pipe_with("GET / HTTP/1.1\r\n" + ("X: #{"y" * 1000}\r\n" * 10))
    assert_raises(H::TooLong) { H.read(reader, deadline_s: 1, max_bytes: 8 * 1024) }
    writer.close
  end

  def test_read_notices_the_closed_end
    reader, writer = pipe_with("GET / HTTP/1.1\r\n")
    writer.close
    assert_raises(H::Closed) { H.read(reader, deadline_s: 1) }
  end
end
