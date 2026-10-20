# frozen_string_literal: true

require "json"

module Rubyfront
  # La progressione dei Rubyfront (2026-09-23): un modulo a parte, fuori dal
  # giudizio. Legge una volta `data/progression/` — le regole (soglie di
  # livello, punti per esito, blocchi sostituibili per faccia) e un file per
  # Rubyfront — e congela. Sa dire il livello dato l'esperienza, quanto vale
  # una partita, se un percorso e una configurazione (`loadout`) sono leciti
  # e cosa il percorso dà in partita (l'Ascesa). Non tocca la memoria né la
  # rete: chi la usa (account, trasporto) le passa i numeri e ne riceve i
  # verdetti.
  #
  # Il percorso (2026-09-26, al posto dei dieci livelli in fila): ogni
  # Rubyfront ha una griglia di nodi collegati, con la carta al centro
  # (`card` nei collegamenti). Al livello N si attivano al più N nodi, e ogni
  # nodo attivo dev'essere raggiungibile dalla carta passando solo per nodi
  # attivi — come la sferografia. I nodi sono di tre tipi: `ability`
  # (un'abilità della sua faccia, sbloccata: poi si monta al posto di un
  # blocco stampato), `hp` (+N PV iniziali e massimi, §3.1) e `fury` (la
  # soglia del d20 della Furia scende di N, §8.1). Le abilità di oggi sono
  # segnaposto: l'engine non le legge ancora; `hp` e `fury` sì, dal
  # `loadDeck` (l'Ascesa, verificata dalla stanza).
  class Progression
    FACES = %w[rubyfront nexus].freeze
    OUTCOMES = %w[win loss draw].freeze
    KINDS = %w[ability hp fury].freeze
    # Ciò che il percorso dà in partita, per tipo di nodo (l'Ascesa del `loadDeck`).
    ASCENT = %w[hp fury].freeze
    LEVELS = 10
    ROOT = "card"

    attr_reader :rules, :cards

    def self.load(data_dir)
      dir = File.join(data_dir, "progression")
      rules = JSON.parse(File.read(File.join(dir, "rules.json")))
      cards = Dir[File.join(dir, "*.json")].reject { |file| File.basename(file) == "rules.json" }.to_h do |file|
        doc = JSON.parse(File.read(file))
        [doc["card"], doc]
      end
      new(rules, cards)
    end

    def initialize(rules, cards)
      @rules = deep_freeze(rules)
      @cards = deep_freeze(cards)
      @thresholds = Array(@rules["thresholds"]).map(&:to_i).freeze
      @slots = FACES.to_h { |face| [face, @rules.dig("slots", face).to_i] }.freeze
      @points = OUTCOMES.to_h { |outcome| [outcome, @rules.dig("points", outcome).to_i] }.freeze
      @nodes = @cards.to_h { |card_id, doc| [card_id, Array(doc["nodes"]).to_h { |node| [node["id"], node] }.freeze] }.freeze
      @links = @cards.to_h { |card_id, doc| [card_id, adjacency(Array(doc["nodes"]))] }.freeze
    end

    def known?(card_id)
      @cards.key?(card_id)
    end

    def card_ids
      @cards.keys.sort
    end

    # Il livello dato l'esperienza cumulata: l'ultima soglia raggiunta, mai
    # oltre il decimo livello, mai sotto il primo.
    def level_for(xp)
      xp = xp.to_i
      level = @thresholds.count { |threshold| xp >= threshold }
      level.clamp(1, LEVELS)
    end

    # Le soglie di partenza e d'arrivo di un livello (per la barra): l'ultimo
    # livello non ha arrivo.
    def span(level)
      level = level.to_i.clamp(1, LEVELS)
      [@thresholds[level - 1], level < LEVELS ? @thresholds[level] : nil]
    end

    def points_for(outcome)
      @points.fetch(outcome.to_s, 0)
    end

    def slots(face)
      @slots.fetch(face.to_s, 0)
    end

    # I nodi attivabili a quel livello: uno per livello.
    def path_points(level)
      level.to_i.clamp(1, LEVELS)
    end

    def node(card_id, id)
      @nodes.dig(card_id, id)
    end

    # I vicini di un nodo (o della carta, `ROOT`).
    def neighbors(card_id, id)
      @links.dig(card_id, id) || []
    end

    # Il percorso messo in ordine di raggiungimento dalla carta: gli id noti,
    # senza doppioni, solo quelli collegati alla carta attraverso nodi del
    # percorso; ogni nodo viene dopo uno a cui è attaccato. Così togliere
    # dalla coda lascia sempre un percorso collegato.
    def normal_path(card_id, path)
      wanted = Array(path).select { |id| id.is_a?(String) && node(card_id, id) }.uniq
      depth = depths(card_id, wanted)
      # Per passo dalla carta; a pari passo, l'ordine dato (stabile per chi attiva in coda).
      wanted.select { |id| depth.key?(id) }.each_with_index.sort_by { |id, index| [depth[id], index] }.map(&:first)
    end

    # Il percorso del livello: in ordine, e al più i punti del livello (le
    # soglie ritarate possono far scendere il livello: si tolgono gli ultimi).
    def trimmed_path(card_id, path, level)
      normal_path(card_id, path).first(path_points(level))
    end

    # Il percorso è lecito? `[true]` oppure `[false, motivo, motivo_en]`:
    # una lista di id di nodi del Rubyfront, senza doppioni, al più i punti
    # del livello, tutti collegati alla carta attraverso il percorso stesso.
    def path_ok?(card_id, level, path)
      return [false, "Rubyfront sconosciuto alla progressione", "Rubyfront unknown to the progression"] unless known?(card_id)
      return [false, "il percorso dev'essere una lista di nodi", "the path must be a list of nodes"] unless path.is_a?(Array) && path.all? { |id| id.is_a?(String) }
      return [false, "nodo ripetuto nel percorso", "repeated node in the path"] if path.uniq.size != path.size

      unknown = path.find { |id| !node(card_id, id) }
      return [false, "nodo sconosciuto (#{unknown})", "unknown node (#{unknown})"] if unknown

      points = path_points(level)
      return [false, "al livello #{level} si attivano al più #{points} nodi", "at level #{level} you activate at most #{points} nodes"] if path.size > points

      loose = path - normal_path(card_id, path)
      return [false, "nodo staccato dal percorso (#{loose.first}): ogni nodo va attaccato alla carta o a un nodo attivo", "node cut off from the path (#{loose.first}): every node must touch the card or an active node"] unless loose.empty?

      [true]
    end

    # Le abilità sbloccate dal percorso, per faccia.
    def unlocked(card_id, path)
      nodes = Array(path).filter_map { |id| node(card_id, id) }.select { |entry| entry["kind"] == "ability" }
      FACES.to_h { |face| [face, nodes.select { |entry| entry["face"] == face }.map { |entry| entry["id"] }] }
    end

    # Ciò che il percorso dà in partita (l'Ascesa): la somma per tipo. Le
    # chiavi sono sempre tutte, a zero se il percorso non ne ha.
    def ascent(card_id, path)
      totals = ASCENT.to_h { |kind| [kind, 0] }
      Array(path).each do |id|
        entry = node(card_id, id)
        totals[entry["kind"]] += entry["amount"].to_i if entry && totals.key?(entry["kind"])
      end
      totals
    end

    # La configurazione è lecita? Torna `[true]` oppure `[false, motivo,
    # motivo_en]`. Le chiavi sono solo le due facce; ogni lista è POSIZIONALE
    # (2026-09-24): l'indice è il blocco stampato sulla carta che l'abilità
    # sostituisce, `nil` lascia quello stampato; gli id devono essere
    # abilità di quella faccia sul percorso; niente doppioni; al più gli
    # slot della faccia.
    def loadout_ok?(card_id, path, loadout)
      return [false, "Rubyfront sconosciuto alla progressione", "Rubyfront unknown to the progression"] unless known?(card_id)
      return [false, "la configurazione dev'essere un oggetto con rubyfront e nexus", "the loadout must be an object with rubyfront and nexus"] unless loadout.is_a?(Hash)

      extra = loadout.keys.map(&:to_s) - FACES
      return [false, "chiavi non previste: #{extra.join(", ")}", "unexpected keys: #{extra.join(", ")}"] unless extra.empty?

      open = unlocked(card_id, path)
      FACES.each do |face|
        slots_list = loadout[face] || loadout[face.to_sym] || []
        return [false, "#{face}: dev'essere una lista di id", "#{face}: must be a list of ids"] unless slots_list.is_a?(Array) && slots_list.all? { |id| id.nil? || id.is_a?(String) }
        return [false, "#{face}: al più #{slots(face)} abilità montate", "#{face}: at most #{slots(face)} mounted abilities"] if slots_list.size > slots(face)

        ids = slots_list.compact
        return [false, "#{face}: abilità ripetuta", "#{face}: repeated ability"] if ids.uniq.size != ids.size

        unknown = ids - open[face]
        return [false, "#{face}: abilità fuori dal percorso o sconosciuta (#{unknown.first})", "#{face}: ability off the path or unknown (#{unknown.first})"] unless unknown.empty?
      end
      [true]
    end

    # La configurazione ristretta al percorso: un'abilità montata che il
    # percorso non ha più (smontato il suo nodo, o il livello sceso) lascia
    # il suo posto vuoto; i buchi in coda non contano.
    def loadout_within(card_id, path, loadout)
      loadout = loadout.is_a?(Hash) ? loadout : {}
      open = unlocked(card_id, path)
      FACES.to_h do |face|
        ids = Array(loadout[face] || loadout[face.to_sym]).map { |id| id.nil? ? nil : id.to_s }
        kept = ids.map { |id| id && open[face].include?(id) ? id : nil }
        kept.pop while !kept.empty? && kept.last.nil?
        [face, kept]
      end
    end

    # La forma pubblica di una riga della memoria (o di nessuna riga: livello
    # 1, percorso vuoto, niente montato) per un Rubyfront. Il percorso si
    # accorcia al livello di oggi (le soglie ritarate, 2026-09-24: chi era al
    # 5 si è ritrovato al 3) e le abilità montate fuori dal percorso si
    # smontano da sé: la forma pubblica è sempre lecita.
    def progress_of(card_id, row = nil)
      xp = row ? row[:xp].to_i : 0
      level = level_for(xp)
      path = trimmed_path(card_id, row && row[:path].is_a?(Array) ? row[:path] : [], level)
      { card: card_id, xp: xp, level: level, path: path, loadout: loadout_within(card_id, path, row && row[:loadout]) }
    end

    private

    # I collegamenti sono senza verso: ognuno vale dalle due parti.
    def adjacency(nodes)
      links = Hash.new { |hash, key| hash[key] = [] }
      nodes.each do |node|
        Array(node["links"]).each do |other|
          links[node["id"]] << other unless links[node["id"]].include?(other)
          links[other] << node["id"] unless links[other].include?(node["id"])
        end
      end
      links.transform_values(&:freeze).to_h.freeze
    end

    # La distanza dalla carta di ogni nodo di `set` raggiungibile passando
    # solo per nodi di `set`.
    def depths(card_id, set)
      depth = { ROOT => 0 }
      frontier = [ROOT]
      until frontier.empty?
        current = frontier.shift
        neighbors(card_id, current).each do |next_id|
          next unless set.include?(next_id) && !depth.key?(next_id)

          depth[next_id] = depth[current] + 1
          frontier << next_id
        end
      end
      depth.except(ROOT)
    end

    def deep_freeze(value)
      case value
      when Hash then value.each_value { |inner| deep_freeze(inner) }.freeze
      when Array then value.each { |inner| deep_freeze(inner) }.freeze
      else value.freeze
      end
    end
  end
end
