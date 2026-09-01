# frozen_string_literal: true

require "digest/sha1"

module Rubyfront
  # Il minimo di WebSocket che serve all'engine: handshake e frame di testo.
  # È lo speculare in Ruby del relay Node (scripts/relay.mjs), con la stessa
  # filosofia: nessuna dipendenza, solo lo standard che serve davvero.
  module WebSocket
    GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    # La chiave di accettazione dell'handshake (RFC 6455 §4.2.2).
    def self.accept_key(key)
      [Digest::SHA1.digest(key + GUID)].pack("m0")
    end

    # Un frame di testo completo. `mask: true` produce il frame lato client
    # (il client maschera sempre): serve ai test per parlare col server.
    def self.encode_text(payload, mask: false)
      data = payload.b
      length = data.bytesize
      mask_bit = mask ? 0x80 : 0
      head =
        if length < 126 then [0x81, mask_bit | length].pack("C2")
        elsif length < 65_536 then [0x81, mask_bit | 126, length].pack("C2n")
        else [0x81, mask_bit | 127, length].pack("C2Q>")
        end
      return head + data unless mask

      key = Random.bytes(4)
      head + key + xor(data, key)
    end

    def self.encode_pong(payload)
      [0x8a, payload.bytesize].pack("C2") + payload
    end

    def self.encode_close
      [0x88, 0].pack("C2")
    end

    def self.xor(data, key)
      data.bytes.each_with_index.map { |byte, index| byte ^ key.getbyte(index % 4) }.pack("C*")
    end

    # I byte possono arrivare spezzati o incollati, e un MESSAGGIO può a sua
    # volta viaggiare in più frame (FIN=0 + continuazioni 0x0, Safari lo fa
    # coi payload grossi): si accumula e si consegna solo ciò che è completo —
    # stessa lezione imparata dal relay.
    class Decoder
      def initialize
        @buffer = +"".b
        @parts = []
      end

      # Mangia un pezzo di stream e restituisce gli eventi completi:
      # [:text, stringa], [:ping, payload], [:close].
      def feed(chunk)
        @buffer << chunk.b
        events = []
        while (frame = next_frame)
          opcode, fin, payload = frame
          case opcode
          when 0x8 then events << [:close]
          when 0x9 then events << [:ping, payload]
          when 0x1, 0x0
            # Una continuazione senza inizio non appartiene a nessuno: si butta.
            next if opcode == 0x0 && @parts.empty?

            @parts << payload
            if fin
              events << [:text, @parts.join.force_encoding(Encoding::UTF_8)]
              @parts = []
            end
          end
        end
        events
      end

      private

      def next_frame
        return nil if @buffer.bytesize < 2

        b0 = @buffer.getbyte(0)
        b1 = @buffer.getbyte(1)
        fin = b0.anybits?(0x80)
        opcode = b0 & 0x0f
        masked = b1.anybits?(0x80)
        length = b1 & 0x7f
        offset = 2
        if length == 126
          return nil if @buffer.bytesize < 4

          length = @buffer.byteslice(2, 2).unpack1("n")
          offset = 4
        elsif length == 127
          return nil if @buffer.bytesize < 10

          length = @buffer.byteslice(2, 8).unpack1("Q>")
          offset = 10
        end
        mask = nil
        if masked
          return nil if @buffer.bytesize < offset + 4

          mask = @buffer.byteslice(offset, 4)
          offset += 4
        end
        return nil if @buffer.bytesize < offset + length

        payload = @buffer.byteslice(offset, length)
        @buffer = @buffer.byteslice(offset + length..) || +"".b
        payload = WebSocket.xor(payload, mask) if mask
        [opcode, fin, payload]
      end
    end
  end
end
