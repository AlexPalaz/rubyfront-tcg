# frozen_string_literal: true

module Rubyfront
  # Un limitatore a finestra fissa per chiave (dal 2026-10-21, audit RF-016):
  # `limit` passaggi ogni `window_s` secondi, per chiave (un IP, un nome
  # utente, un giocatore). Puro: l'orologio è iniettato, niente thread; le
  # finestre scadute si scartano con `sweep` (lo sweeper del trasporto) e
  # quando le chiavi superano `max_keys`.
  class RateLimiter
    attr_reader :limit, :window_s

    def initialize(limit:, window_s:, clock: -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }, max_keys: 10_000)
      @limit = limit
      @window_s = window_s
      @clock = clock
      @max_keys = max_keys
      @windows = {}
      @mutex = Mutex.new
    end

    # Conta il passaggio: vero se entro il limite, falso oltre (e il passaggio
    # non si conta: una raffica non allunga la propria punizione).
    def allow?(key)
      @mutex.synchronize do
        now = @clock.call
        sweep_locked(now) if @windows.size >= @max_keys
        window = @windows[key]
        if window.nil? || now - window[:since] >= @window_s
          @windows[key] = { since: now, count: 1 }
          return true
        end
        return false if window[:count] >= @limit

        window[:count] += 1
        true
      end
    end

    # Fra quanti secondi la chiave torna libera (0 se lo è già).
    def retry_after(key)
      @mutex.synchronize do
        window = @windows[key]
        return 0.0 unless window && window[:count] >= @limit

        [@window_s - (@clock.call - window[:since]), 0.0].max
      end
    end

    def sweep(now = @clock.call)
      @mutex.synchronize { sweep_locked(now) }
    end

    def size
      @mutex.synchronize { @windows.size }
    end

    private

    def sweep_locked(now)
      @windows.delete_if { |_key, window| now - window[:since] >= @window_s }
    end
  end
end
