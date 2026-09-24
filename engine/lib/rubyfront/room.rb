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
    # `on_over` (2026-09-23) è il gancio della fine partita: `->(room, action)`,
    # chiamato UNA volta per partita quando un `gameOver` passa il giudizio.
    # La stanza non sa chi sono i seduti: il trasporto glielo dice con
    # `attach` (una lambda per posto), e nel gancio legge `player_of` e
    # `deck_of` per assegnare l'esperienza. Niente memoria qui.
    def initialize(name, cards: {}, solo: false, starter: nil, on_over: nil)
      @name = name
      @solo = solo
      @engine = Engine.new(cards: cards)
      @clients = {}
      @whos = {}
      @testers = {}
      @on_over = on_over
      @over_told = false
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

    # Un client si siede: al posto che preferisce se è libero, se no al
    # primo libero (dal 2026-09-23 il posto lo assegna il tavolo, non il
    # link). Torna il posto assegnato, o `nil` a stanza piena: il trasporto
    # lo dice al client e chiude. Chi si siede lo sa subito (`seat`), prima
    # del conto dei seduti.
    def join(wanted, out)
      @mutex.synchronize do
        free = SEATS.reject { |candidate| @clients.key?(candidate) }
        seat = free.include?(wanted) ? wanted : free.first
        return nil unless seat

        @clients[seat] = out
        @emptied_at = nil
        send_to(seat, { t: "seat", seat: seat })
        announce
        seat
      end
    end

    # Chi è seduto a quel posto, come lambda (`-> { id o nil }`): vale anche se
    # l'accesso arriva dopo. Il trasporto la registra dopo il `join`.
    # `tester:` dice se chi siede è l'account di prova (`-> { true/false }`):
    # solo lui usa gli strumenti di prova (Engine.test_tool?).
    def attach(seat, who:, tester: nil)
      @mutex.synchronize do
        @whos[seat] = who
        @testers[seat] = tester
      end
    end

    def tester?(seat)
      tester = @testers[seat]
      tester ? tester.call == true : false
    rescue StandardError
      false
    end

    def player_of(seat)
      who = @whos[seat]
      who&.call
    rescue StandardError
      nil
    end

    # Il mazzo caricato a quel posto, dal giornale (l'ultimo `loadDeck` passato):
    # la stanza non apre l'engine per questo.
    def deck_of(seat)
      entry = @journal.reverse.find { |item| item[:action].is_a?(Hash) && item[:action]["t"] == "loadDeck" && item[:action]["seat"] == seat }
      entry && entry[:action]["deckId"].is_a?(String) ? entry[:action]["deckId"] : nil
    end

    # Un messaggio a un posto dal gancio della fine partita, che gira già
    # dentro il lucchetto della stanza.
    def reply(seat, payload)
      send_to(seat, payload)
    end

    def leave(seat, out)
      @mutex.synchronize do
        return unless @clients[seat].equal?(out)

        @clients.delete(seat)
        @whos.delete(seat)
        @testers.delete(seat)
        @emptied_at = Time.now if @clients.empty?
        announce
      end
    end

    # Un messaggio del client seduto a `seat`. Le buste:
    #
    #   hello           → il saluto dell'engine, poi il giornale (stanze con nome)
  #   (all'ingresso il tavolo manda da sé `seat`, il posto assegnato, e `peers`)
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
      verdict =
        if Engine.test_tool?(action) && !tester?(seat)
          { t: "verdict", action: action["t"], ok: false, ruled: true,
            reason: "gli strumenti di prova sono dell'account di prova", reason_en: "the test tools belong to the test account", seq: message["seq"] }
        else
          @engine.judge(action, actor: actor).merge(seq: message["seq"])
        end
      send_to(seat, verdict)
      return unless verdict[:ok]

      record(action, seat)
      broadcast({ t: "action", action: action, from: seat }, except: seat)
      tell_over(action)
    end

    # La fine partita passata al giudizio, al gancio, una volta sola: il
    # `newGame` riapre. Si è dentro il lucchetto della stanza: il gancio
    # risponde ai posti con `reply`, non con `notify` (che lo riprenderebbe).
    def tell_over(action)
      return unless action.is_a?(Hash)

      @over_told = false if action["t"] == "newGame"
      return unless action["t"] == "gameOver" && @on_over && !@over_told

      @over_told = true
      @on_over.call(self, action)
    rescue StandardError => error
      warn "fine partita, gancio: #{error.message}"
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
