# frozen_string_literal: true

require_relative "engine"

module Rubyfront
  # La stanza: il tavolo di una partita, con UN Engine per tutti i client
  # seduti (deciso 2026-09-11: l'engine è l'unico a scrivere lo stato).
  #
  # Ogni azione arriva come richiesta di giudizio (`judge`); se passa, entra
  # nel giornale e viene inoltrata agli altri client come `action`. Chi
  # riceve applica ciò che il tavolo ha approvato, mai ciò che l'avversario
  # dice di aver fatto. Chi entra (o rientra) riceve il giornale intero e
  # ricostruisce la lavagna da lì: lo stato è una funzione del giornale, e
  # il giornale lo scrive solo il tavolo.
  #
  # In una stanza con nome l'attore di ogni gesto è il POSTO del client, non
  # quello che il client dichiara: un client modificato non può agire per
  # l'avversario. La stanza «solo» (nessun nome: partita locale o col bot) è
  # un sandbox senza avversario: si fida dell'attore dichiarato, accetta lo
  # snapshot del client e non manda il giornale — è il tavolo di prima.
  #
  # Niente socket qui: ogni client è una `out` (callable che riceve un Hash),
  # così i test parlano con la stanza direttamente e il trasporto
  # (bin/server) resta un dettaglio. Il lucchetto è della stanza: un thread
  # per client, ma dentro il tavolo si entra uno alla volta, e l'ordine in
  # cui i verdetti e gli inoltri escono è l'ordine del giornale.
  class Room
    SEATS = %w[a b].freeze

    attr_reader :name, :journal, :emptied_at

    # `starter` decide chi apre la partita (§4): il tavolo lo tira, non il
    # client — in una stanza con nome il giornale comincia da quel `newGame`.
    def initialize(name, cards: {}, solo: false, starter: nil)
      @name = name
      @solo = solo
      @engine = Engine.new(cards: cards)
      @clients = {}
      @journal = []
      @mutex = Mutex.new
      @emptied_at = Time.now
      return if solo

      first = { "t" => "newGame", "active" => SEATS.include?(starter) ? starter : SEATS.sample }
      @engine.judge(first)
      @journal << { action: first, from: nil }
    end

    def solo?
      @solo
    end

    def empty?
      @mutex.synchronize { @clients.empty? }
    end

    def seats
      @mutex.synchronize { @clients.keys.sort }
    end

    # Un client si siede. `false` se il posto è occupato: il trasporto lo
    # dice al client e chiude.
    def join(seat, out)
      @mutex.synchronize do
        return false if @clients.key?(seat)

        @clients[seat] = out
        @emptied_at = nil
        announce
        true
      end
    end

    def leave(seat, out)
      @mutex.synchronize do
        return unless @clients[seat].equal?(out)

        @clients.delete(seat)
        @emptied_at = Time.now if @clients.empty?
        announce
      end
    end

    # Un messaggio del client seduto a `seat`. Le buste:
    #
    #   hello           → il saluto dell'engine, poi il giornale (stanze con nome)
    #   judge           → il verdetto a chi chiede; se passa, `action` agli altri
    #   rtc             → inoltrata agli altri com'è (la chat vocale)
    #   snapshot        → solo nella stanza «solo»: allinea la copia del tavolo
    #   consult, altro  → ignorati: nessuno dice più al tavolo cos'è già successo
    def handle(seat, message)
      return unless message.is_a?(Hash)

      @mutex.synchronize do
        case message["t"]
        when "hello"
          send_to(seat, @engine.hello)
          send_to(seat, { t: "journal", actions: @journal }) unless @solo
        when "judge"
          judge(seat, message)
        when "rtc"
          broadcast({ t: "rtc", payload: message["payload"], from: seat }, except: seat)
        when "snapshot"
          @engine.snapshot(message["state"]) if @solo
        end
      end
    end

    private

    def judge(seat, message)
      action = message["action"]
      actor = @solo ? message["actor"] : seat
      verdict = @engine.judge(action, actor: actor).merge(seq: message["seq"])
      send_to(seat, verdict)
      return unless verdict[:ok]

      record(action, seat)
      broadcast({ t: "action", action: action, from: seat }, except: seat)
    end

    # Il giornale ricomincia a ogni partita nuova: chi entra dopo non ha
    # bisogno di rigiocare quelle prima.
    def record(action, seat)
      @journal = [] if action.is_a?(Hash) && action["t"] == "newGame"
      @journal << { action: action, from: seat }
    end

    def announce
      broadcast({ t: "peers", peers: @clients.size, seats: @clients.keys.sort })
    end

    def send_to(seat, payload)
      out = @clients[seat]
      return unless out

      out.call(payload)
    rescue StandardError
      # Un client che non riceve più è un client che se n'è andato: lo dirà
      # il suo trasporto con `leave`.
      nil
    end

    def broadcast(payload, except: nil)
      @clients.each_key { |seat| send_to(seat, payload) unless seat == except }
    end
  end
end
