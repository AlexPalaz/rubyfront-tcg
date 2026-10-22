# frozen_string_literal: true

require "digest/sha1"

module Rubyfront
  # Il minimo di WebSocket che serve al tavolo: handshake e frame di testo.
  # Nessuna dipendenza, solo lo standard che serve davvero.
  #
  # Dal 2026-10-21 (audit RF-014) il decodificatore ha i suoi limiti e
  # rifiuta il protocollo storto: frame e messaggi oltre il tetto, troppi
  # frammenti, frame del client senza maschera, bit RSV, opcode ignoti o
  # binari, frame di controllo spezzati o lunghi, testo che non è UTF-8.
  # Un errore è un evento `[:fail, codice, motivo]` e da lì il decodificatore
  # è morto: il trasporto chiude con quel codice.
  module WebSocket
    GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    # I tetti: un frame e un messaggio (anche lo snapshot della «solo», che
    # supera i 64 KiB) stanno in 256 KiB; i frammenti di un messaggio in 64.
    MAX_FRAME_BYTES = 256 * 1024
    MAX_MESSAGE_BYTES = 256 * 1024
    MAX_FRAGMENTS = 64
    MAX_CONTROL_BYTES = 125

    # I codici di chiusura (RFC 6455 §7.4.1).
    CLOSE_NORMAL = 1000
    CLOSE_GOING_AWAY = 1001
    CLOSE_PROTOCOL = 1002
    CLOSE_UNSUPPORTED = 1003
    CLOSE_BAD_DATA = 1007
    CLOSE_POLICY = 1008
    CLOSE_TOO_BIG = 1009
    CLOSE_INTERNAL = 1011

    OPCODE_CONTINUATION = 0x0
    OPCODE_TEXT = 0x1
    OPCODE_BINARY = 0x2
    OPCODE_CLOSE = 0x8
    OPCODE_PING = 0x9
    OPCODE_PONG = 0xA

    # La chiave di accettazione dell'handshake (RFC 6455 §4.2.2).
    def self.accept_key(key)
      [Digest::SHA1.digest(key + GUID)].pack("m0")
    end

    # Un frame completo con FIN. `mask: true` produce il frame lato client
    # (il client maschera sempre): serve ai test per parlare col server.
    # Un frame di controllo non porta più di 125 byte.
    def self.encode_frame(opcode, payload = "", mask: false, fin: true)
      data = payload.to_s.b
      length = data.bytesize
      raise ArgumentError, "un frame di controllo porta al più #{MAX_CONTROL_BYTES} byte" if opcode >= 0x8 && length > MAX_CONTROL_BYTES

      b0 = (fin ? 0x80 : 0) | (opcode & 0x0f)
      mask_bit = mask ? 0x80 : 0
      head =
        if length < 126 then [b0, mask_bit | length].pack("C2")
        elsif length < 65_536 then [b0, mask_bit | 126, length].pack("C2n")
        else [b0, mask_bit | 127, length].pack("C2Q>")
        end
      return head + data unless mask

      key = Random.bytes(4)
      head + key + xor(data, key)
    end

    def self.encode_text(payload, mask: false)
      encode_frame(OPCODE_TEXT, payload, mask: mask)
    end

    def self.encode_ping(payload = "", mask: false)
      encode_frame(OPCODE_PING, payload, mask: mask)
    end

    def self.encode_pong(payload = "", mask: false)
      encode_frame(OPCODE_PONG, payload, mask: mask)
    end

    # La chiusura, con codice e motivo (il motivo entro i 123 byte).
    def self.encode_close(code = nil, reason = "", mask: false)
      payload = code ? [code].pack("n") + reason.to_s.b[0, 123] : ""
      encode_frame(OPCODE_CLOSE, payload, mask: mask)
    end

    # [codice, motivo] dal payload di una chiusura: nil senza codice; 1002 su
    # un payload storto (un byte solo, o un motivo che non è UTF-8).
    def self.parse_close(payload)
      data = payload.to_s.b
      return [nil, ""] if data.empty?
      return [CLOSE_PROTOCOL, ""] if data.bytesize == 1

      reason = data.byteslice(2..).to_s.force_encoding(Encoding::UTF_8)
      return [CLOSE_PROTOCOL, ""] unless reason.valid_encoding?

      [data.unpack1("n"), reason]
    end

    def self.xor(data, key)
      data.bytes.each_with_index.map { |byte, index| byte ^ key.getbyte(index % 4) }.pack("C*")
    end

    # I byte possono arrivare spezzati o incollati, e un MESSAGGIO può a sua
    # volta viaggiare in più frame (FIN=0 + continuazioni 0x0, Safari lo fa
    # coi payload grossi): si accumula e si consegna solo ciò che è completo —
    # stessa lezione imparata dal relay. Il buffer ha un cursore (`@pos`) e si
    # compatta ogni tanto: niente byteslice a ogni frame.
    class Decoder
      attr_reader :failure

      def initialize(require_mask: true, max_frame: MAX_FRAME_BYTES, max_message: MAX_MESSAGE_BYTES, max_fragments: MAX_FRAGMENTS)
        @require_mask = require_mask
        @max_frame = max_frame
        @max_message = max_message
        @max_fragments = max_fragments
        @buffer = +"".b
        @pos = 0
        @parts = []
        @parts_bytes = 0
        @failure = nil
      end

      def failed?
        !@failure.nil?
      end

      # Mangia un pezzo di stream e restituisce gli eventi completi:
      # [:text, stringa], [:ping, payload], [:pong, payload], [:close, codice],
      # [:fail, codice, motivo]. Dopo un :fail non esce più nulla.
      def feed(chunk)
        return [] if failed?

        @buffer << chunk.b
        events = []
        loop do
          frame = next_frame
          if frame.is_a?(Array) && frame.first == :fail
            @failure = frame
            events << frame
            @buffer = +"".b
            @pos = 0
            break
          end
          break unless frame

          opcode, fin, payload = frame
          case opcode
          when OPCODE_CLOSE
            code, = WebSocket.parse_close(payload)
            events << [:close, code]
          when OPCODE_PING then events << [:ping, payload]
          when OPCODE_PONG then events << [:pong, payload]
          when OPCODE_TEXT, OPCODE_CONTINUATION
            @parts << payload
            @parts_bytes += payload.bytesize
            next unless fin

            text = @parts.join.force_encoding(Encoding::UTF_8)
            @parts = []
            @parts_bytes = 0
            unless text.valid_encoding?
              @failure = [:fail, CLOSE_BAD_DATA, "text is not UTF-8"]
              events << @failure
              break
            end
            events << [:text, text]
          end
        end
        compact
        events
      end

      private

      def pending
        @buffer.bytesize - @pos
      end

      def byte_at(index)
        @buffer.getbyte(@pos + index)
      end

      def compact
        return unless @pos.positive? && @pos > @buffer.bytesize / 2

        @buffer = @buffer.byteslice(@pos..) || +"".b
        @pos = 0
      end

      # Il frame successivo: [opcode, fin, payload]; nil se non è ancora tutto
      # arrivato; [:fail, codice, motivo] sul protocollo storto. I limiti si
      # giudicano sulla lunghezza DICHIARATA, prima di aspettare i byte.
      def next_frame
        return nil if pending < 2

        b0 = byte_at(0)
        b1 = byte_at(1)
        fin = b0.anybits?(0x80)
        return [:fail, CLOSE_PROTOCOL, "RSV bits set"] if b0.anybits?(0x70)

        opcode = b0 & 0x0f
        return [:fail, CLOSE_UNSUPPORTED, "binary frames are not accepted"] if opcode == OPCODE_BINARY
        return [:fail, CLOSE_PROTOCOL, "unknown opcode #{opcode}"] unless [OPCODE_CONTINUATION, OPCODE_TEXT, OPCODE_CLOSE, OPCODE_PING, OPCODE_PONG].include?(opcode)

        masked = b1.anybits?(0x80)
        return [:fail, CLOSE_PROTOCOL, "client frames must be masked"] if @require_mask && !masked

        length = b1 & 0x7f
        offset = 2
        control = opcode >= 0x8
        if control
          return [:fail, CLOSE_PROTOCOL, "control frame too long"] if length > MAX_CONTROL_BYTES
          return [:fail, CLOSE_PROTOCOL, "control frame fragmented"] unless fin
        end
        if length == 126
          return nil if pending < 4

          length = @buffer.byteslice(@pos + 2, 2).unpack1("n")
          offset = 4
        elsif length == 127
          return nil if pending < 10

          length = @buffer.byteslice(@pos + 2, 8).unpack1("Q>")
          return [:fail, CLOSE_PROTOCOL, "length with the top bit set"] if length.anybits?(1 << 63)

          offset = 10
        end
        return [:fail, CLOSE_TOO_BIG, "frame over #{@max_frame} bytes"] if length > @max_frame

        if opcode == OPCODE_CONTINUATION
          return [:fail, CLOSE_PROTOCOL, "continuation without a start"] if @parts.empty?
        elsif opcode == OPCODE_TEXT
          return [:fail, CLOSE_PROTOCOL, "text frame inside a fragmented message"] unless @parts.empty?
        end
        unless control
          return [:fail, CLOSE_TOO_BIG, "message over #{@max_message} bytes"] if @parts_bytes + length > @max_message
          return [:fail, CLOSE_TOO_BIG, "too many fragments"] if !fin && @parts.size >= @max_fragments
        end

        mask = nil
        if masked
          return nil if pending < offset + 4

          mask = @buffer.byteslice(@pos + offset, 4)
          offset += 4
        end
        return nil if pending < offset + length

        payload = @buffer.byteslice(@pos + offset, length)
        @pos += offset + length
        payload = WebSocket.xor(payload, mask) if mask
        [opcode, fin, payload]
      end
    end
  end
end
