# frozen_string_literal: true

require "json"
require "socket"
require "uri"
require_relative "../../lib/rubyfront/websocket"
require_relative "../../lib/rubyfront/handshake"

# Un client WebSocket minimo per le prove d'integrazione (2026-10-21): parla
# col tavolo vero su un TCPSocket, con l'Encoder/Decoder del progetto (frame
# mascherati come fa un browser). Niente gemme.
class WsClient
  WS = Rubyfront::WebSocket
  KEY = "dGhlIHNhbXBsZSBub25jZQ=="

  attr_reader :socket, :status_line

  # Apre l'handshake: alza se non è un 101.
  def self.open(port, room: "", seat: "", token: "", origin: "http://ok.test", path: "/engine", headers: [])
    client = new(port)
    client.handshake!(room: room, seat: seat, token: token, origin: origin, path: path, headers: headers)
    client
  end

  # Una richiesta grezza: torna la riga di stato (o nil se il tavolo chiude senza rispondere).
  def self.raw(port, request_text, timeout: 3)
    socket = TCPSocket.new("127.0.0.1", port)
    socket.write(request_text)
    ready = IO.select([socket], nil, nil, timeout)
    return nil unless ready

    line = socket.gets
    socket.close rescue nil
    line&.strip
  end

  def initialize(port)
    @socket = TCPSocket.new("127.0.0.1", port)
    @decoder = WS::Decoder.new(require_mask: false)
    @events = []
    @status_line = nil
  end

  def handshake!(room:, seat:, token:, origin:, path:, headers:)
    query = { "room" => room, "seat" => seat, "token" => token }.reject { |_, v| v.to_s.empty? }
    target = query.empty? ? path : "#{path}?#{URI.encode_www_form(query)}"
    lines = ["GET #{target} HTTP/1.1", "Host: 127.0.0.1", "Upgrade: websocket", "Connection: Upgrade", "Sec-WebSocket-Version: 13", "Sec-WebSocket-Key: #{KEY}"]
    lines << "Origin: #{origin}" if origin
    lines += headers
    @socket.write(lines.join("\r\n") + "\r\n\r\n")
    response = +""
    loop do
      line = @socket.gets
      raise "handshake chiuso" unless line

      response << line
      break if line == "\r\n"
    end
    @status_line = response.lines.first.to_s.strip
    raise "handshake rifiutato: #{@status_line}" unless @status_line.include?("101")

    self
  end

  def send(hash)
    @socket.write(WS.encode_text(JSON.generate(hash), mask: true))
  end

  def send_raw(bytes)
    @socket.write(bytes)
  end

  # Il prossimo evento del decodificatore (testo già decodificato in Hash), o nil allo scadere.
  def recv(timeout: 2)
    deadline = Time.now + timeout
    loop do
      return @events.shift unless @events.empty?

      left = deadline - Time.now
      return nil if left <= 0

      # Prima il buffer interno dell'IO (i byte arrivati insieme all'handshake
      # letto con `gets` non svegliano la select), poi la select.
      chunk = read_chunk
      if chunk == :wait_readable
        ready = IO.select([@socket], nil, nil, left)
        return nil unless ready

        chunk = read_chunk
        next if chunk == :wait_readable
      end
      return [:eof] if chunk.nil?

      @decoder.feed(chunk).each do |event, payload, reason|
        @events << (event == :text ? [:message, JSON.parse(payload)] : [event, payload, reason])
      end
    end
  end

  # Scarta fino al messaggio col tipo dato: lo torna (il Hash), o nil.
  def expect(type, timeout: 3)
    deadline = Time.now + timeout
    while (left = deadline - Time.now).positive?
      event = recv(timeout: left)
      return nil if event.nil? || event.first == :eof
      return event[1] if event.first == :message && event[1]["t"] == type
    end
    nil
  end

  # Aspetta la chiusura: il codice (o nil), o :eof.
  def close_code(timeout: 3)
    deadline = Time.now + timeout
    while (left = deadline - Time.now).positive?
      event = recv(timeout: left)
      return nil if event.nil?
      return :eof if event.first == :eof
      return event[1] if event.first == :close
    end
    nil
  end

  def close
    @socket.write(WS.encode_close(1000, "", mask: true)) rescue nil
    @socket.close rescue nil
  end

  private

  def read_chunk
    @socket.read_nonblock(65_536, exception: false)
  rescue SystemCallError, IOError
    nil
  end
end
