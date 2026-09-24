# frozen_string_literal: true

require "json"
require "net/http"
require "socket"
require "openssl"
require "uri"
require_relative "auth"

module Rubyfront
  # La memoria del tavolo: i giocatori e i loro dati, su Postgres (Neon).
  #
  # Il tavolo resta Ruby senza gemme: si parla col database per HTTPS, sul
  # punto `/sql` che Neon espone accanto a ogni ramo (la stessa via del suo
  # driver serverless), con la stringa di connessione nell'intestazione.
  # Una richiesta per query, niente connessioni da tenere vive: per i salvataggi
  # di un gioco di carte basta e avanza, e in Docker non cambia nulla.
  #
  # Qui ci sono le tabelle e le query, e nient'altro: chi è il giocatore lo
  # decide l'accesso (account.rb). Il trasporto si può sostituire (i test
  # passano una lambda); l'engine del giudizio non sa che esistiamo.
  class Store
    Error = Class.new(StandardError)

    # Le tabelle (2026-09-22): i giocatori (nome utente unico, nome pubblico,
    # email e password per l'accesso classico), le loro identità esterne
    # (google, e domani steam: più accessi, un giocatore), le sessioni
    # (solo l'impronta del token), i mazzi assegnati e i dati, una riga per chiave.
    SCHEMA = [
      <<~SQL,
        CREATE TABLE IF NOT EXISTS players (
          id BIGSERIAL PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          email TEXT UNIQUE,
          password_hash TEXT,
          email_verified_at TIMESTAMPTZ,
          verify_token TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      SQL
      <<~SQL,
        CREATE TABLE IF NOT EXISTS player_identities (
          provider TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (provider, provider_id)
        )
      SQL
      <<~SQL,
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL
        )
      SQL
      <<~SQL,
        CREATE TABLE IF NOT EXISTS player_decks (
          player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          deck_id TEXT NOT NULL,
          source TEXT NOT NULL,
          granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (player_id, deck_id)
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
      <<~SQL,
        CREATE TABLE IF NOT EXISTS player_rubyfronts (
          player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          card_id TEXT NOT NULL,
          xp INTEGER NOT NULL DEFAULT 0,
          loadout JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (player_id, card_id)
        )
      SQL
    ].freeze

    PLAYER_COLUMNS = "p.id, p.username, p.display_name, p.email, p.password_hash, p.email_verified_at"

    # Dall'ambiente: senza DATABASE_URL non c'è memoria (nil), e il tavolo
    # gioca come sempre.
    def self.from_env(env = ENV)
      url = env["DATABASE_URL"].to_s
      return nil if url.empty?

      new(url)
    end

    # `transport` è `->(sql, params) { righe }`: di serie l'HTTPS di Neon.
    def initialize(url, transport: nil)
      @url = url
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

    # ---------------------------------------------------------- i giocatori

    # Il giocatore per id, nella forma pubblica (con le sue identità), o nil.
    def player(id)
      row = query("SELECT #{PLAYER_COLUMNS} FROM players p WHERE p.id = $1", [id]).first
      row && public_player(row)
    end

    # Per nome utente o email (l'accesso classico): la riga intera, con l'impronta della password.
    def player_by_login(login)
      row = query("SELECT #{PLAYER_COLUMNS} FROM players p WHERE p.username = $1 OR p.email = $1", [login]).first
      row && private_player(row)
    end

    def player_by_email(email)
      row = query("SELECT #{PLAYER_COLUMNS} FROM players p WHERE p.email = $1", [email]).first
      row && private_player(row)
    end

    def player_by_identity(provider, provider_id)
      row = query("SELECT #{PLAYER_COLUMNS} FROM players p JOIN player_identities i ON i.player_id = p.id WHERE i.provider = $1 AND i.provider_id = $2", [provider, provider_id]).first
      row && private_player(row)
    end

    def username_taken?(username)
      !query("SELECT 1 FROM players WHERE username = $1", [username]).empty?
    end

    def email_taken?(email)
      !query("SELECT 1 FROM players WHERE email = $1", [email]).empty?
    end

    # Un giocatore nuovo; torna la forma privata. Password e mail possono mancare (Google).
    def create_player(username:, display_name:, email: nil, password_hash: nil, verify_token: nil, verified: false)
      row = query(<<~SQL, [username, display_name, email, password_hash, verify_token, verified]).first
        INSERT INTO players (username, display_name, email, password_hash, verify_token, email_verified_at)
        VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN now() ELSE NULL END)
        RETURNING id, username, display_name, email, password_hash, email_verified_at
      SQL
      private_player(row)
    end

    def link_identity(player_id, provider, provider_id)
      query("INSERT INTO player_identities (provider, provider_id, player_id) VALUES ($1, $2, $3) ON CONFLICT (provider, provider_id) DO NOTHING", [provider, provider_id, player_id])
      true
    end

    def identities_of(player_id)
      query("SELECT provider FROM player_identities WHERE player_id = $1 ORDER BY provider", [player_id]).map { |row| row["provider"] }
    end

    def touch(player_id)
      query("UPDATE players SET last_seen_at = now() WHERE id = $1", [player_id])
      true
    end

    def set_display_name(player_id, name)
      query("UPDATE players SET display_name = $2 WHERE id = $1", [player_id, name])
      true
    end

    # La conferma della mail col token: il giocatore confermato, o nil.
    def verify_email(token)
      row = query("UPDATE players SET email_verified_at = now(), verify_token = NULL WHERE verify_token = $1 AND email_verified_at IS NULL RETURNING id", [token]).first
      row && player(row["id"].to_i)
    end

    # ------------------------------------------------------------ le sessioni

    def create_session(player_id, token_hash, days:)
      query("INSERT INTO sessions (token_hash, player_id, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)", [token_hash, player_id, days.to_i.to_s])
      true
    end

    def player_by_session(token_hash)
      row = query("SELECT #{PLAYER_COLUMNS} FROM players p JOIN sessions s ON s.player_id = p.id WHERE s.token_hash = $1 AND s.expires_at > now()", [token_hash]).first
      row && public_player(row)
    end

    def delete_session(token_hash)
      query("DELETE FROM sessions WHERE token_hash = $1", [token_hash])
      true
    end

    # -------------------------------------------------------------- i mazzi

    # I mazzi del giocatore (2026-09-20): gli id, in ordine di assegnazione.
    def decks_of(player_id)
      query("SELECT deck_id FROM player_decks WHERE player_id = $1 ORDER BY granted_at, deck_id", [player_id]).map { |row| row["deck_id"] }
    end

    # Assegna al giocatore i mazzi dati (`source`: "free" o "purchase"); chi c'è già resta com'è.
    def grant_decks(player_id, deck_ids, source:)
      Array(deck_ids).each do |deck_id|
        query("INSERT INTO player_decks (player_id, deck_id, source) VALUES ($1, $2, $3) ON CONFLICT (player_id, deck_id) DO NOTHING", [player_id, deck_id, source])
      end
      true
    end

    # -------------------------------------------- la progressione dei Rubyfront

    # Le righe di progressione del giocatore (2026-09-23): esperienza e
    # configurazione per Rubyfront. Il livello lo deriva `Progression`.
    def rubyfronts_of(player_id)
      query("SELECT card_id, xp, loadout::text AS loadout FROM player_rubyfronts WHERE player_id = $1 ORDER BY card_id", [player_id]).map { |row| rubyfront_row(row) }
    end

    # Aggiunge esperienza a un Rubyfront del giocatore (la riga nasce se manca); torna la riga aggiornata.
    def add_xp(player_id, card_id, amount)
      row = query(<<~SQL, [player_id, card_id, amount.to_i]).first
        INSERT INTO player_rubyfronts (player_id, card_id, xp) VALUES ($1, $2, $3)
        ON CONFLICT (player_id, card_id) DO UPDATE SET xp = player_rubyfronts.xp + EXCLUDED.xp, updated_at = now()
        RETURNING card_id, xp, loadout::text AS loadout
      SQL
      row && rubyfront_row(row)
    end

    # Scrive la configurazione (le abilità montate) di un Rubyfront del giocatore; torna la riga.
    def set_loadout(player_id, card_id, loadout)
      row = query(<<~SQL, [player_id, card_id, JSON.generate(loadout)]).first
        INSERT INTO player_rubyfronts (player_id, card_id, loadout) VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (player_id, card_id) DO UPDATE SET loadout = EXCLUDED.loadout, updated_at = now()
        RETURNING card_id, xp, loadout::text AS loadout
      SQL
      row && rubyfront_row(row)
    end

    # --------------------------------------------------------------- i dati

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

    def rubyfront_row(row)
      loadout = row["loadout"].is_a?(String) ? JSON.parse(row["loadout"]) : (row["loadout"] || {})
      { card: row["card_id"], xp: row["xp"].to_i, loadout: loadout.is_a?(Hash) ? loadout : {} }
    end

    # La forma pubblica: quella che va al client (mai l'impronta della password).
    def public_player(row)
      { id: row["id"].to_i, username: row["username"], name: row["display_name"], email: row["email"],
        verified: !row["email_verified_at"].nil? }
    end

    def public_of(private_row) = private_row.reject { |key, _| key == :password_hash }

    # La forma privata: con l'impronta della password, per l'accesso.
    def private_player(row)
      public_player(row).merge(password_hash: row["password_hash"])
    end

    # Il punto `/sql` di Neon: POST col JSON {query, params}, la stringa di
    # connessione nell'intestazione; torna {rows: […], fields: […]}.
    # Il ramo di Neon si addormenta quando nessuno lo usa e la prima richiesta
    # può cadere mentre si sveglia (2026-09-22: «Broken pipe - SSL_connect» al
    # primo accesso dopo una pausa): si riprova tre volte, con un respiro.
    RETRIES = 3

    # L'IPv4 del punto di Neon, cercato una volta al minuto.
    def ipv4_of(host)
      now = Time.now
      if @ipv4.nil? || @ipv4_at.nil? || now - @ipv4_at > 60
        @ipv4 = Socket.getaddrinfo(host, nil, Socket::AF_INET).map { |entry| entry[3] }.first
        @ipv4_at = now
      end
      @ipv4
    end

    def http_query(sql, params)
      attempt = 0
      begin
        attempt += 1
        request = Net::HTTP::Post.new(@endpoint)
        request["Neon-Connection-String"] = @url
        request["Content-Type"] = "application/json"
        request.body = JSON.generate({ query: sql, params: params })
        http = Net::HTTP.new(@endpoint.host, @endpoint.port)
        http.use_ssl = true
        http.open_timeout = 8
        http.read_timeout = 15
        # Dai thread dei client la connessione cadeva a caso (setsockopt EINVAL,
        # SSL_connect broken pipe, 2026-09-22): il nome di Neon risolve anche in
        # IPv6, e da un thread Ruby sceglieva a volte un indirizzo senza rotta.
        # Si connette all'IPv4, tenendo il nome per SNI e certificato.
        http.ipaddr = ipv4_of(@endpoint.host)
        response = http.start { http.request(request) }
      rescue IOError, SystemCallError, OpenSSL::SSL::SSLError, Net::OpenTimeout, Net::ReadTimeout => error
        raise Error, "Neon irraggiungibile: #{error.message}" if attempt >= RETRIES

        sleep(0.4 * attempt)
        retry
      end
      body = JSON.parse(response.body) rescue {}
      raise Error, "Neon #{response.code}: #{body["message"] || body["error"] || response.body.to_s[0, 200]}" unless response.is_a?(Net::HTTPSuccess)

      Array(body["rows"])
    end
  end
end
