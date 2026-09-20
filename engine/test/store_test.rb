# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/store"

# La memoria del tavolo (Neon): il trasporto è finto — si guarda cosa chiede
# e si risponde a comando — così la prova non tocca la rete.
class StoreTest < Minitest::Test
  def fake_store(answers = [], token: "segreto")
    calls = []
    transport = lambda do |sql, params|
      calls << [sql.strip.split("\n").first.strip, params]
      answers.shift || []
    end
    [Rubyfront::Store.new("postgresql://u:p@host.neon.tech/db", dev_token: token, transport: transport), calls]
  end

  def test_from_env_is_nil_without_database_url
    assert_nil Rubyfront::Store.from_env({})
    assert_kind_of Rubyfront::Store, Rubyfront::Store.from_env({ "DATABASE_URL" => "postgresql://u:p@h.neon.tech/db" })
  end

  def test_ensure_schema_creates_the_two_tables
    store, calls = fake_store
    store.ensure_schema!
    assert_equal 2, calls.size
    assert_match(/CREATE TABLE IF NOT EXISTS players/, calls[0][0])
    assert_match(/CREATE TABLE IF NOT EXISTS player_data/, calls[1][0])
  end

  def test_dev_login_refuses_wrong_or_missing_token_without_touching_the_db
    store, calls = fake_store
    assert_nil store.dev_player("altro")
    assert_nil store.dev_player(nil)
    assert_empty calls
    silent, calls2 = fake_store(token: "")
    assert_nil silent.dev_player("qualunque"), "senza segreto configurato nessuno entra"
    assert_empty calls2
  end

  def test_dev_login_upserts_the_test_player_and_returns_it
    store, calls = fake_store([[{ "id" => "1", "provider" => "dev", "name" => "Tester" }]])
    assert_equal({ id: 1, provider: "dev", name: "Tester" }, store.dev_player("segreto"))
    assert_match(/INSERT INTO players/, calls[0][0])
    assert_equal %w[dev test Tester], calls[0][1]
  end

  def test_set_and_get_round_trip_json
    store, calls = fake_store([[], [{ "value" => '{"mazzo":"scissione","n":2}' }], []])
    assert store.set(1, "prefs", { "mazzo" => "scissione", "n" => 2 })
    assert_equal [1, "prefs", '{"mazzo":"scissione","n":2}'], calls[0][1]
    assert_equal({ "mazzo" => "scissione", "n" => 2 }, store.get(1, "prefs"))
    assert_nil store.get(1, "manca")
  end
end
