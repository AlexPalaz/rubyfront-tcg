# frozen_string_literal: true

module Rubyfront
  # L'atrio (2026-09-23): la coda della partita casuale. Chi vuole un
  # avversario qualunque si mette in fila dalla sua connessione «solo»; appena
  # sono in due, il tavolo apre loro una stanza con un nome nuovo e dice a
  # ciascuno dove sedersi (il primo arrivato ad A, il secondo a B). Poi i due
  # client si collegano a quella stanza come farebbero con un link d'invito.
  #
  # Niente socket qui: ogni client è una `out` (callable che riceve un Hash),
  # come nella stanza. Chi chiude il filo esce dalla fila da sé (il trasporto
  # chiama `cancel`). Il nome della stanza lo dà chi costruisce l'atrio
  # (`namer`), così il trasporto può evitare i nomi già in uso.
  class Lobby
    GEMS = %w[rubino ambra giada opale zaffiro onice perla agata topazio berillo].freeze
    # I due posti di una stanza, nell'ordine in cui la fila li assegna (lo specchio di Room::SEATS).
    SEATS = %w[a b].freeze

    def initialize(namer: nil)
      @waiting = []
      @mutex = Mutex.new
      @namer = namer || Lobby.method(:random_name)
    end

    def self.random_name
      "#{GEMS.sample}-#{rand(1000..9999)}"
    end

    # Quanti aspettano.
    def waiting
      @mutex.synchronize { @waiting.size }
    end

    # Le buste dell'atrio: `match` (in fila) e `match_cancel` (fuori dalla
    # fila). Vero se la busta era dell'atrio.
    def handle(message, out)
      return false unless message.is_a?(Hash)

      case message["t"]
      when "match"
        enqueue(out)
      when "match_cancel"
        cancel(out)
      else
        return false
      end
      true
    end

    # In fila. Chi c'è già non si conta due volte. Al secondo la coppia si
    # fa subito: entrambi ricevono `matched` con la stanza e il loro posto.
    def enqueue(out)
      pair = @mutex.synchronize do
        next nil if @waiting.include?(out)

        @waiting << out
        next nil if @waiting.size < 2

        @waiting.shift(2)
      end
      return unless pair

      name = @namer.call
      pair.zip(SEATS).each do |client, seat|
        notify(client, { t: "matched", room: name, seat: seat })
      end
    end

    def cancel(out)
      @mutex.synchronize { @waiting.delete(out) }
    end

    private

    def notify(out, payload)
      out.call(payload)
    rescue StandardError
      # Un client che non riceve più se n'è andato: il suo trasporto lo toglierà.
      nil
    end
  end
end
