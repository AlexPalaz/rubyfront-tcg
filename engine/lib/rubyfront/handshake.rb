# frozen_string_literal: true

require "uri"
require_relative "websocket"

module Rubyfront
  # L'handshake HTTP → WebSocket, puro (dal 2026-10-21, audit RF-013/RF-025):
  # `read` legge la richiesta da un IO con scadenza e tetto, `parse` la
  # giudica senza toccare socket — metodo e versione, percorso, intestazioni
  # (non troppe, non troppo lunghe), la chiave, l'Origin ammessa, il nome
  # della stanza, il posto, il token — e `response_*` scrivono le risposte.
  # bin/server mette insieme i pezzi; i test li provano uno per uno.
  module Handshake
    MAX_HEADER_BYTES = 8 * 1024
    MAX_LINE_BYTES = 2 * 1024
    MAX_HEADERS = 64
    DEADLINE_S = 5
    PATHS = ["/", "/engine"].freeze
    ROOM_NAME = /\A[a-z0-9][a-z0-9_-]{0,31}\z/
    TOKEN = /\A\h{32}\z/

    Timeout = Class.new(StandardError)
    TooLong = Class.new(StandardError)
    Closed = Class.new(StandardError)

    # Com'è andata: `kind` è :upgrade (apri il WebSocket), :plain (una GET
    # semplice: la risposta di cortesia) o :error (status e motivo).
    Result = Struct.new(:kind, :key, :path, :room, :seat, :token, :origin, :client_ip, :status, :reason, :reason_en, keyword_init: true)

    module_function

    # Legge l'intestazione HTTP fino alla riga vuota: con IO.select e
    # read_nonblock, entro `deadline_s` e `max_bytes`. Torna il testo (senza
    # il corpo che eventualmente segue). `clock` è l'orologio monotono.
    def read(io, deadline_s: DEADLINE_S, max_bytes: MAX_HEADER_BYTES, clock: -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) })
      text = +"".b
      started = clock.call
      loop do
        index = text.index("\r\n\r\n")
        return text.byteslice(0, index + 4) if index

        raise TooLong, "header over #{max_bytes} bytes" if text.bytesize >= max_bytes

        left = deadline_s - (clock.call - started)
        raise Timeout, "header not completed within #{deadline_s}s" if left <= 0

        ready = IO.select([io], nil, nil, left)
        raise Timeout, "header not completed within #{deadline_s}s" unless ready

        chunk = io.read_nonblock(4096, exception: false)
        case chunk
        when :wait_readable then next
        when nil then raise Closed, "closed before the header ended"
        else text << chunk.b
        end
      end
    end

    # Giudica una richiesta. `origins` è l'elenco ammesso (vuoto: tutte,
    # in sviluppo; "*" ammette tutte; altrimenti schema://host[:porta]
    # esatti). `peer_ip` è l'indirizzo del socket: l'`X-Forwarded-For` conta
    # solo se il peer è il proxy locale.
    def parse(request_text, origins: nil, peer_ip: nil)
      lines = request_text.to_s.b.split("\r\n")
      request_line = lines.shift.to_s
      method, target, version = request_line.split(" ", 3)
      return error(400, "metodo o versione non ammessi", "method or version not allowed") unless method == "GET" && target && version.to_s.start_with?("HTTP/1.")

      headers = {}
      count = 0
      lines.each do |line|
        break if line.empty?

        return error(431, "intestazione troppo lunga", "header line too long") if line.bytesize > MAX_LINE_BYTES

        count += 1
        return error(431, "troppe intestazioni", "too many headers") if count > MAX_HEADERS

        name, value = line.split(":", 2)
        next unless name && value

        headers[name.strip.downcase] = value.strip
      end

      path, query = target.split("?", 2)
      path = "/" if path.to_s.empty?
      return error(404, "percorso sconosciuto", "unknown path") unless PATHS.include?(path)

      origin = headers["origin"]
      client_ip = client_ip(headers, peer_ip)
      upgrade = headers["upgrade"].to_s.downcase == "websocket" && headers["connection"].to_s.downcase.split(",").map(&:strip).include?("upgrade")
      return Result.new(kind: :plain, path: path, origin: origin, client_ip: client_ip) unless upgrade

      return error(426, "serve WebSocket versione 13", "WebSocket version 13 required") unless headers["sec-websocket-version"] == "13"

      key = headers["sec-websocket-key"]
      return error(400, "chiave WebSocket mancante o storta", "WebSocket key missing or malformed") unless key_ok?(key)
      return error(403, "origine non ammessa", "origin not allowed") unless origin_allowed?(origin, origins)

      params = query ? (URI.decode_www_form(query).to_h rescue {}) : {}
      room = params["room"].to_s.strip.downcase
      return error(400, "nome stanza non valido", "invalid room name") unless room.empty? || ROOM_NAME.match?(room)

      seat = %w[a b].include?(params["seat"]) ? params["seat"] : ""
      token = TOKEN.match?(params["token"].to_s) ? params["token"] : ""
      Result.new(kind: :upgrade, key: key, path: path, room: room, seat: seat, token: token, origin: origin, client_ip: client_ip)
    end

    def key_ok?(key)
      return false unless key.is_a?(String) && key.length == 24

      decoded = key.unpack1("m0") rescue nil
      decoded.is_a?(String) && decoded.bytesize == 16
    end

    # Senza elenco tutto passa (sviluppo); con l'elenco, `null` e l'assenza
    # non passano, "*" apre tutto, il resto si confronta esatto, minuscolo.
    def origin_allowed?(origin, allowlist)
      list = Array(allowlist).map { |entry| entry.to_s.strip.downcase }.reject(&:empty?)
      return true if list.empty?
      return true if list.include?("*")
      return false unless origin.is_a?(String) && !origin.empty? && origin.downcase != "null"

      list.include?(origin.downcase.sub(%r{/+\z}, ""))
    end

    # L'indirizzo del client: il primo di `X-Forwarded-For` quando chi parla è
    # il proxy sulla stessa macchina; altrimenti l'indirizzo del socket.
    def client_ip(headers, peer_ip)
      forwarded = headers["x-forwarded-for"].to_s.split(",").first.to_s.strip
      return forwarded if !forwarded.empty? && loopback?(peer_ip)

      peer_ip.to_s
    end

    def loopback?(ip)
      %w[127.0.0.1 ::1 ::ffff:127.0.0.1].include?(ip.to_s)
    end

    def response_101(key)
      "HTTP/1.1 101 Switching Protocols\r\n" \
        "Upgrade: websocket\r\nConnection: Upgrade\r\n" \
        "Sec-WebSocket-Accept: #{WebSocket.accept_key(key)}\r\n\r\n"
    end

    def response_plain(body, status: 200, reason: "OK")
      "HTTP/1.1 #{status} #{reason}\r\n" \
        "Content-Type: text/plain; charset=utf-8\r\n" \
        "Content-Length: #{body.bytesize}\r\nConnection: close\r\n\r\n#{body}"
    end

    STATUS_TEXT = { 400 => "Bad Request", 403 => "Forbidden", 404 => "Not Found", 408 => "Request Timeout", 426 => "Upgrade Required", 429 => "Too Many Requests", 431 => "Request Header Fields Too Large", 503 => "Service Unavailable" }.freeze

    def response_error(status, reason)
      extra = status == 426 ? "Sec-WebSocket-Version: 13\r\n" : ""
      body = "#{reason}\n"
      "HTTP/1.1 #{status} #{STATUS_TEXT.fetch(status, "Error")}\r\n#{extra}" \
        "Content-Type: text/plain; charset=utf-8\r\n" \
        "Content-Length: #{body.bytesize}\r\nConnection: close\r\n\r\n#{body}"
    end

    def error(status, reason, reason_en)
      Result.new(kind: :error, status: status, reason: reason, reason_en: reason_en)
    end
  end
end
