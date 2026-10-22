# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/store"

# La memoria del tavolo (Neon): il trasporto è finto — si guarda cosa chiede
# e si risponde a comando — così la prova non tocca la rete.
class StoreTest < Minitest::Test
  def fake_store(answers = [])
    calls = []
    transport = lambda do |sql, params|
      calls << [sql.strip.split("\n").first.strip, params]
      answers.shift || []
    end
    [Rubyfront::Store.new("postgresql://u:p@host.neon.tech/db", transport: transport), calls]
  end

  def test_from_env_is_nil_without_database_url
    assert_nil Rubyfront::Store.from_env({})
    assert_kind_of Rubyfront::Store, Rubyfront::Store.from_env({ "DATABASE_URL" => "postgresql://u:p@h.neon.tech/db" })
  end

  def test_ensure_schema_creates_the_two_tables
    store, calls = fake_store
    store.ensure_schema!
    assert_equal 9, calls.size
    assert_match(/ADD COLUMN IF NOT EXISTS verify_sent_at/, calls[7][0])
    assert_match(/CREATE TABLE IF NOT EXISTS player_matches/, calls[8][0])
    assert_match(/CREATE TABLE IF NOT EXISTS players/, calls[0][0])
    assert_match(/CREATE TABLE IF NOT EXISTS player_identities/, calls[1][0])
    assert_match(/CREATE TABLE IF NOT EXISTS sessions/, calls[2][0])
    assert_match(/CREATE TABLE IF NOT EXISTS player_decks/, calls[3][0])
    assert_match(/CREATE TABLE IF NOT EXISTS player_data/, calls[4][0])
    assert_match(/CREATE TABLE IF NOT EXISTS player_rubyfronts/, calls[5][0])
    assert_match(/ADD COLUMN IF NOT EXISTS path JSONB/, calls[6][0])
  end

  # La progressione (2026-09-23): l'esperienza si somma nella riga, la
  # configurazione si riscrive, e le righe tornano con il jsonb già letto.
  def test_rubyfront_progress_rows_add_xp_and_rewrite_the_loadout
    row = { "card_id" => "X-1", "xp" => "140", "loadout" => "{\"rubyfront\":[\"a\"]}", "path" => "[\"a\",\"b\"]" }
    store, calls = fake_store([[row], [row], [row], [row]])
    assert_equal({ card: "X-1", xp: 140, path: %w[a b], loadout: { "rubyfront" => ["a"] } }, store.add_xp(7, "X-1", 40))
    assert_match(/INSERT INTO player_rubyfronts/, calls[0][0])
    assert_equal [7, "X-1", 40], calls[0][1]
    assert_equal 140, store.set_loadout(7, "X-1", { "rubyfront" => ["a"] })[:xp]
    assert_equal [7, "X-1", "{\"rubyfront\":[\"a\"]}"], calls[1][1]
    assert_equal ["X-1"], store.rubyfronts_of(7).map { |r| r[:card] }
    assert_match(/SELECT card_id, xp/, calls[2][0])
    # Il percorso (2026-09-26): si riscrive insieme alla configurazione.
    assert_equal %w[a b], store.set_path(7, "X-1", %w[a b], { "rubyfront" => ["a"] })[:path]
    assert_equal [7, "X-1", "[\"a\",\"b\"]", "{\"rubyfront\":[\"a\"]}"], calls[3][1]
    assert_match(/INSERT INTO player_rubyfronts \(player_id, card_id, path, loadout\)/, calls[3][0])
  end

  # Una riga di prima del percorso (senza la colonna): percorso vuoto.
  def test_a_row_without_the_path_reads_as_an_empty_path
    store, = fake_store([[{ "card_id" => "X-1", "xp" => "5", "loadout" => "{}" }]])
    assert_equal [], store.rubyfronts_of(7).first[:path]
  end

  def test_sessions_and_public_shape_never_carry_the_password_hash
    row = { "id" => "7", "username" => "anna", "display_name" => "Anna", "email" => "a@b.it", "password_hash" => "pbkdf2$…", "email_verified_at" => nil }
    store, calls = fake_store([[], [row], []])
    assert store.create_session(7, "impronta", days: 90)
    assert_equal ["impronta", 7, "90"], calls[0][1]
    me = store.player_by_session("impronta")
    assert_equal({ id: 7, username: "anna", name: "Anna", email: "a@b.it", verified: false }, me)
    refute me.key?(:password_hash)
    assert store.delete_session("impronta")
    assert_match(/DELETE FROM sessions/, calls[2][0])
  end

  def test_grant_and_decks_of
    store, calls = fake_store([[], [], [{ "deck_id" => "alfa" }, { "deck_id" => "beta" }]])
    assert store.grant_decks(1, %w[alfa beta], source: "free")
    assert_equal 2, calls.size
    assert_match(/INSERT INTO player_decks/, calls[0][0])
    assert_equal [1, "alfa", "free"], calls[0][1]
    assert_equal %w[alfa beta], store.decks_of(1)
  end

  def test_set_and_get_round_trip_json
    store, calls = fake_store([[], [{ "value" => '{"mazzo":"scissione","n":2}' }], []])
    assert store.set(1, "prefs", { "mazzo" => "scissione", "n" => 2 })
    assert_equal [1, "prefs", '{"mazzo":"scissione","n":2}'], calls[0][1]
    assert_equal({ "mazzo" => "scissione", "n" => 2 }, store.get(1, "prefs"))
    assert_nil store.get(1, "manca")
  end

  # --- Dal 2026-10-21 (audit) ---------------------------------------------------

  def test_create_player_stores_the_verify_hash_with_the_sent_time
    clock = -> { Time.utc(2026, 10, 21, 12, 0, 0) }
    calls = []
    transport = ->(sql, params) { calls << [sql, params]; [{ "id" => "3", "username" => "u", "display_name" => "U", "email" => "u@x.it", "password_hash" => "h", "email_verified_at" => nil }] }
    store = Rubyfront::Store.new("postgresql://u:p@host.neon.tech/db", transport: transport, clock: clock)
    store.create_player(username: "u", display_name: "U", email: "u@x.it", password_hash: "h", verify_token: "impronta")
    assert_match(/verify_sent_at/, calls[0][0])
    assert_equal "impronta", calls[0][1][4]
    assert_equal "2026-10-21T12:00:00Z", calls[0][1][6]
    store.create_player(username: "g", display_name: "G", verified: true)
    assert_nil calls[1][1][6], "senza link, senza data"
  end

  def test_verify_email_checks_the_hash_the_legacy_token_and_the_ttl
    clock = -> { Time.utc(2026, 10, 21, 12, 0, 0) }
    calls = []
    transport = ->(sql, params) { calls << [sql, params]; sql.include?("UPDATE players SET email_verified_at") ? [{ "id" => "3" }] : [{ "id" => "3", "username" => "u", "display_name" => "U", "email" => "u@x.it", "email_verified_at" => "2026-10-21" }] }
    store = Rubyfront::Store.new("postgresql://u:p@host.neon.tech/db", transport: transport, clock: clock)
    me = store.verify_email("impronta", legacy_token: "chiaro")
    assert_equal 3, me[:id]
    sql, params = calls[0]
    assert_match(/verify_token = \$1 OR \(\$3 <> '' AND verify_token = \$3\)/, sql)
    assert_match(/verify_sent_at IS NULL OR verify_sent_at > \$2::timestamptz/, sql)
    assert_equal ["impronta", "2026-10-19T12:00:00Z", "chiaro"], params, "48 ore prima dell'orologio"
    store.verify_email("impronta", max_age_s: 3600)
    assert_equal "2026-10-21T11:00:00Z", calls[2][1][1]
    assert_equal "", calls[2][1][2]
  end

  def test_reset_verify_token_sets_the_new_hash_and_time
    clock = -> { Time.utc(2026, 10, 21, 12, 0, 0) }
    calls = []
    store = Rubyfront::Store.new("postgresql://u:p@host.neon.tech/db", transport: ->(sql, params) { calls << [sql, params]; [] }, clock: clock)
    assert store.reset_verify_token(3, "nuova")
    assert_match(/UPDATE players SET verify_token = \$2, verify_sent_at = \$3::timestamptz WHERE id = \$1 AND email_verified_at IS NULL/, calls[0][0])
    assert_equal [3, "nuova", "2026-10-21T12:00:00Z"], calls[0][1]
  end

  def test_record_match_is_idempotent
    store, calls = fake_store([[{ "match_id" => "m-1" }], []])
    assert_equal true, store.record_match("m-1", 7, "RBF-001", "win", 100)
    assert_match(/INSERT INTO player_matches/, calls[0][0])
    assert_equal ["m-1", 7, "RBF-001", "win", 100], calls[0][1]
    assert_equal false, store.record_match("m-1", 7, "RBF-001", "win", 100), "la seconda volta la riga c'è già: niente accredito"
  end

  def test_count_keys
    store, calls = fake_store([[{ "n" => "42" }], []])
    assert_equal 42, store.count_keys(7)
    assert_match(/SELECT count\(\*\) AS n FROM player_data/, calls[0][0])
    assert_equal 0, store.count_keys(8)
  end
end
