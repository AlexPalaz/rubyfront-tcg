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
    assert_equal 6, calls.size
    assert_match(/CREATE TABLE IF NOT EXISTS players/, calls[0][0])
    assert_match(/CREATE TABLE IF NOT EXISTS player_identities/, calls[1][0])
    assert_match(/CREATE TABLE IF NOT EXISTS sessions/, calls[2][0])
    assert_match(/CREATE TABLE IF NOT EXISTS player_decks/, calls[3][0])
    assert_match(/CREATE TABLE IF NOT EXISTS player_data/, calls[4][0])
    assert_match(/CREATE TABLE IF NOT EXISTS player_rubyfronts/, calls[5][0])
  end

  # La progressione (2026-09-23): l'esperienza si somma nella riga, la
  # configurazione si riscrive, e le righe tornano con il jsonb già letto.
  def test_rubyfront_progress_rows_add_xp_and_rewrite_the_loadout
    row = { "card_id" => "X-1", "xp" => "140", "loadout" => "{\"rubyfront\":[\"a\"]}" }
    store, calls = fake_store([[row], [row], [row]])
    assert_equal({ card: "X-1", xp: 140, loadout: { "rubyfront" => ["a"] } }, store.add_xp(7, "X-1", 40))
    assert_match(/INSERT INTO player_rubyfronts/, calls[0][0])
    assert_equal [7, "X-1", 40], calls[0][1]
    assert_equal 140, store.set_loadout(7, "X-1", { "rubyfront" => ["a"] })[:xp]
    assert_equal [7, "X-1", "{\"rubyfront\":[\"a\"]}"], calls[1][1]
    assert_equal ["X-1"], store.rubyfronts_of(7).map { |r| r[:card] }
    assert_match(/SELECT card_id, xp/, calls[2][0])
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
end
