# frozen_string_literal: true

require "json"
require "net/http"
require "uri"

module Rubyfront
  # La memoria del tavolo: i giocatori e i loro dati, su Postgres (Neon).
  #
  # Il tavolo resta Ruby senza gemme: si parla col database per HTTPS, sul
  # punto `/sql` che Neon espone accanto a ogni ramo (la stessa via del suo
  # driver serverless), con la stringa di connessione nell'intestazione.
  # Una richiesta per query, niente connessioni da tenere vive: per i salvataggi
  # di un gioco di carte basta e avanza, e in Docker non cambia nulla.
  #
  # Chi è il giocatore lo decide l'accesso (`dev_player`, e domani Steam): qui
  # ci sono le tabelle, le query e nient'altro. Il trasporto si può sostituire
  # (i test passano una lambda), l'engine del giudizio non sa che esistiamo.
  class Store
    Error = Class.new(StandardError)

    # Le tabelle: i giocatori (chi sono, da quale accesso) e i loro dati, una
    # riga per chiave, valore JSON. Cosa ci va dentro lo dirà il designer.
    SCHEMA = [
      <<~SQL,
        CREATE TABLE IF NOT EXISTS players (
          id BIGSERIAL PRIMARY KEY,
          provider TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (provider, provider_id)
        )
      SQL
      <<~SQL,
        CREATE TABLE IF NOT EXISTS player_data (
          player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (player_id, key)
        )
      SQL
    ].freeze

    # L'utenza di prova (2026-09-20): una sola, per tutti gli sviluppi finché
    # non c'è Steam. Si entra col segreto RUBYFRONT_DEV_TOKEN del tavolo.
    DEV_PROVIDER = "dev"
    DEV_ID = "test"
    DEV_NAME = "Tester"

    # Dall'ambiente: senza DATABASE_URL non c'è memoria (nil), e il tavolo
    # gioca come sempre.
    def self.from_env(env = ENV)
      url = env["DATABASE_URL"].to_s
      return nil if url.empty?

      new(url, dev_token: env["RUBYFRONT_DEV_TOKEN"].to_s)
    end

    attr_reader :dev_token

    # `transport` è `->(sql, params) { righe }`: di serie l'HTTPS di Neon.
    def initialize(url, dev_token: "", transport: nil)
      @url = url
      @dev_token = dev_token
      @transport = transport || method(:http_query)
      @endpoint = URI("https://#{URI(url).host}/sql")
    end

    # Le tabelle, se mancano. Da chiamare una volta all'avvio.
    def ensure_schema!
      SCHEMA.each { |sql| query(sql) }
      self
    end

    # Una query: righe come Hash con le colonne per nome.
    def query(sql, params = [])
      @transport.call(sql, params)
    end

    # L'accesso di prova: col segreto giusto torna l'utenza di prova (creata
    # alla prima volta), altrimenti nil senza toccare il database.
    def dev_player(token)
      return nil if @dev_token.empty? || !secure_equal?(token.to_s, @dev_token)

      rows = query(<<~SQL, [DEV_PROVIDER, DEV_ID, DEV_NAME])
        INSERT INTO players (provider, provider_id, name) VALUES ($1, $2, $3)
        ON CONFLICT (provider, provider_id) DO UPDATE SET last_seen_at = now()
        RETURNING id, provider, name
      SQL
      player_of(rows.first)
    end

    # Il dato `key` del giocatore, o nil.
    def get(player_id, key)
      rows = query("SELECT value::text AS value FROM player_data WHERE player_id = $1 AND key = $2", [player_id, key])
      row = rows.first
      row ? JSON.parse(row["value"]) : nil
    end

    # Scrive (o riscrive) il dato `key` del giocatore.
    def set(player_id, key, value)
      query(<<~SQL, [player_id, key, JSON.generate(value)])
        INSERT INTO player_data (player_id, key, value) VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (player_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      SQL
      true
    end

    # Le chiavi salvate del giocatore.
    def keys(player_id)
      query("SELECT key FROM player_data WHERE player_id = $1 ORDER BY key", [player_id]).map { |row| row["key"] }
    end

    private

    def player_of(row)
      return nil unless row

      { id: row["id"].to_i, provider: row["provider"], name: row["name"] }
    end

    def secure_equal?(a, b)
      return false unless a.bytesize == b.bytesize

      a.bytes.zip(b.bytes).reduce(0) { |acc, (x, y)| acc | (x ^ y) }.zero?
    end

    # Il punto `/sql` di Neon: POST col JSON {query, params}, la stringa di
    # connessione nell'intestazione; torna {rows: […], fields: […]}.
    def http_query(sql, params)
      request = Net::HTTP::Post.new(@endpoint)
      request["Neon-Connection-String"] = @url
      request["Content-Type"] = "application/json"
      request.body = JSON.generate({ query: sql, params: params })
      response = Net::HTTP.start(@endpoint.host, @endpoint.port, use_ssl: true, open_timeout: 8, read_timeout: 15) do |http|
        http.request(request)
      end
      body = JSON.parse(response.body) rescue {}
      raise Error, "Neon #{response.code}: #{body["message"] || body["error"] || response.body.to_s[0, 200]}" unless response.is_a?(Net::HTTPSuccess)

      Array(body["rows"])
    end
  end
end
