# frozen_string_literal: true

require "json"
require_relative "websocket"

module Rubyfront
  # La connessione di un client (dal 2026-10-21, audit RF-017): la CODA
  # d'uscita con un thread scrittore, così `out` non blocca mai chi lo chiama
  # — la stanza spedisce dentro il suo lucchetto, e un client che non legge
  # non ferma il tavolo: oltre `MAX_QUEUE` messaggi (o un MiB) la coda si
  # chiude con 1008 e il lettore lento cade. Lo scrittore fa anche da
  # orologio: senza nulla da scrivere per `ping_every_s` manda un ping, e
  # dopo `MAX_MISSED_PONGS` pong mancati chiude con 1001.
  #
  # Tutte le scritture sul socket passano dal thread scrittore: nessun
  # lucchetto di scrittura altrove. `close` accoda la chiusura: lo scrittore
  # scrive il frame e chiude il socket.
  class Connection
    MAX_QUEUE = 256
    MAX_QUEUE_BYTES = 1024 * 1024
    PING_EVERY_S = 30
    MAX_MISSED_PONGS = 2

    CLOSE = Object.new.freeze

    attr_reader :close_code

    def initialize(io, ping_every_s: PING_EVERY_S, max_queue: MAX_QUEUE, max_queue_bytes: MAX_QUEUE_BYTES, max_missed_pongs: MAX_MISSED_PONGS)
      @io = io
      @ping_every_s = ping_every_s
      @max_queue = max_queue
      @max_queue_bytes = max_queue_bytes
      @max_missed_pongs = max_missed_pongs
      @queue = Queue.new
      @queued_bytes = 0
      @missed = 0
      @closed = false
      @close_code = nil
      @mutex = Mutex.new
      @writer = nil
    end

    # La `out` per stanza, atrio e utenza: un Hash → JSON → frame, in coda.
    def out
      ->(payload) { push(payload) }
    end

    # Accoda un messaggio. Falso (e la connessione si chiude) oltre i limiti.
    def push(payload)
      push_frame(WebSocket.encode_text(JSON.generate(payload)))
    end

    def push_frame(frame)
      @mutex.synchronize do
        return false if @closed

        if @queue.size >= @max_queue || @queued_bytes + frame.bytesize > @max_queue_bytes
          close_locked(WebSocket::CLOSE_POLICY, "slow consumer")
          return false
        end
        @queued_bytes += frame.bytesize
        @queue << frame
        true
      end
    end

    # Il pong del client: il conto dei mancati riparte.
    def pong!
      @mutex.synchronize { @missed = 0 }
    end

    # Chiude: il frame di chiusura col codice, poi il socket.
    def close(code = WebSocket::CLOSE_NORMAL, reason = "")
      @mutex.synchronize { close_locked(code, reason) }
    end

    def closed?
      @mutex.synchronize { @closed }
    end

    # Lo scrittore: un thread che scrive i frame in coda; senza frame per
    # `ping_every_s` manda un ping e conta i pong mancati.
    def run_writer
      @writer = Thread.new do
        loop do
          item = @queue.pop(timeout: @ping_every_s)
          if item.nil?
            @missed += 1
            if @missed > @max_missed_pongs
              write_close(WebSocket::CLOSE_GOING_AWAY, "idle")
              break
            end
            @io.write(WebSocket.encode_ping("rf"))
            next
          end
          if item.equal?(CLOSE)
            write_close(@close_code, @close_reason)
            break
          end
          @mutex.synchronize { @queued_bytes -= item.bytesize }
          @io.write(item)
        end
      rescue IOError, SystemCallError
        nil
      ensure
        # Chiuso in scrittura: il lettore (il trasporto) finisce di leggere e chiude.
        (@io.close_write rescue nil) if @io.respond_to?(:close_write)
      end
    end

    # Aspetta che lo scrittore finisca (il trasporto, alla chiusura).
    def join(timeout = 2)
      @writer&.join(timeout)
    end

    private

    def close_locked(code, reason)
      return if @closed

      @closed = true
      @close_code = code
      @close_reason = reason.to_s
      @queue << CLOSE
    end

    def write_close(code, reason)
      @io.write(WebSocket.encode_close(code, reason.to_s))
    rescue IOError, SystemCallError
      nil
    end
  end
end
