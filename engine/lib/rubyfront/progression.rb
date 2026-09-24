# frozen_string_literal: true

require "json"

module Rubyfront
  # La progressione dei Rubyfront (2026-09-23): un modulo a parte, fuori dal
  # giudizio. Legge una volta `data/progression/` — le regole (soglie di
  # livello, punti per esito, slot per faccia) e un file per Rubyfront con i
  # dieci livelli, ciascuno con un'abilità Rubyfront e una Nexus — e congela.
  # Sa dire il livello dato l'esperienza, quanto vale una partita, quali
  # abilità sono sbloccate a un livello e se una configurazione (`loadout`)
  # è lecita. Non tocca la memoria né la rete: chi la usa (account, trasporto)
  # le passa i numeri e ne riceve i verdetti. Le abilità di oggi sono
  # segnaposto: l'engine non le legge ancora (lo farà dai tre punti
  # dichiarati nel README).
  class Progression
    FACES = %w[rubyfront nexus].freeze
    OUTCOMES = %w[win loss draw].freeze
    LEVELS = 10

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

    # Le abilità sbloccate a quel livello, per faccia: gli id dei livelli
    # fino a `level` compreso.
    def unlocked(card_id, level)
      levels = Array(@cards.dig(card_id, "levels")).select { |entry| entry["level"].to_i <= level.to_i }
      FACES.to_h { |face| [face, levels.filter_map { |entry| entry.dig(face, "id") }] }
    end

    # La configurazione è lecita? Torna `[true]` oppure `[false, motivo,
    # motivo_en]`. Le chiavi sono solo le due facce; ogni lista è POSIZIONALE
    # (2026-09-24): l'indice è il blocco stampato sulla carta che l'abilità
    # sostituisce, `nil` lascia quello stampato; gli id devono esistere ed
    # essere sbloccati; niente doppioni; al più gli slot della faccia.
    def loadout_ok?(card_id, level, loadout)
      return [false, "Rubyfront sconosciuto alla progressione", "Rubyfront unknown to the progression"] unless known?(card_id)
      return [false, "la configurazione dev'essere un oggetto con rubyfront e nexus", "the loadout must be an object with rubyfront and nexus"] unless loadout.is_a?(Hash)

      extra = loadout.keys.map(&:to_s) - FACES
      return [false, "chiavi non previste: #{extra.join(", ")}", "unexpected keys: #{extra.join(", ")}"] unless extra.empty?

      open = unlocked(card_id, level)
      FACES.each do |face|
        slots_list = loadout[face] || loadout[face.to_sym] || []
        return [false, "#{face}: dev'essere una lista di id", "#{face}: must be a list of ids"] unless slots_list.is_a?(Array) && slots_list.all? { |id| id.nil? || id.is_a?(String) }
        return [false, "#{face}: al più #{slots(face)} abilità montate", "#{face}: at most #{slots(face)} mounted abilities"] if slots_list.size > slots(face)

        ids = slots_list.compact
        return [false, "#{face}: abilità ripetuta", "#{face}: repeated ability"] if ids.uniq.size != ids.size

        unknown = ids - open[face]
        return [false, "#{face}: abilità non sbloccata o sconosciuta (#{unknown.first})", "#{face}: ability locked or unknown (#{unknown.first})"] unless unknown.empty?
      end
      [true]
    end

    # La forma pubblica di una riga della memoria (o di nessuna riga: livello
    # 1, niente montato) per un Rubyfront.
    def progress_of(card_id, row = nil)
      xp = row ? row[:xp].to_i : 0
      loadout = row && row[:loadout].is_a?(Hash) ? row[:loadout] : {}
      {
        card: card_id,
        xp: xp,
        level: level_for(xp),
        loadout: FACES.to_h { |face| [face, Array(loadout[face] || loadout[face.to_sym]).map { |id| id.nil? ? nil : id.to_s }] }
      }
    end

    private

    def deep_freeze(value)
      case value
      when Hash then value.each_value { |inner| deep_freeze(inner) }.freeze
      when Array then value.each { |inner| deep_freeze(inner) }.freeze
      else value.freeze
      end
    end
  end
end
