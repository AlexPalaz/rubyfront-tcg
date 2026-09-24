# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/account"
require_relative "../lib/rubyfront/progression"

# L'utenza di una connessione: registrazione, accesso (password, Google,
# prova), sessione, conferma, nome pubblico, mazzi assegnati, dati, e il
# mazzo non proprio fermato prima del tavolo. Memoria, Google e posta finti.
class AccountTest < Minitest::Test
  A = Rubyfront::Auth

  class FakeStore
    attr_reader :players, :identities, :sessions, :decks, :data, :rubyfronts

    def initialize
      @players = {}
      @identities = {}
      @sessions = {}
      @decks = Hash.new { |h, k| h[k] = [] }
      @data = {}
      @rubyfronts = {}
      @next = 0
    end

    def rubyfronts_of(id) = @rubyfronts.select { |(pid, _), _| pid == id }.map { |(_, card), row| { card: card, xp: row[:xp], loadout: row[:loadout] } }
    def add_xp(id, card, amount)
      row = (@rubyfronts[[id, card]] ||= { xp: 0, loadout: {} })
      row[:xp] += amount
      { card: card, xp: row[:xp], loadout: row[:loadout] }
    end

    def set_loadout(id, card, loadout)
      row = (@rubyfronts[[id, card]] ||= { xp: 0, loadout: {} })
      row[:loadout] = loadout
      { card: card, xp: row[:xp], loadout: row[:loadout] }
    end

    def player(id) = @players[id]&.reject { |k, _| k == :password_hash }
    def player_by_login(login) = @players.values.find { |p| p[:username] == login || p[:email] == login }
    def player_by_email(email) = @players.values.find { |p| p[:email] == email }
    def player_by_identity(provider, pid) = (id = @identities[[provider, pid]]) && @players[id]
    def username_taken?(u) = @players.values.any? { |p| p[:username] == u }
    def email_taken?(e) = @players.values.any? { |p| p[:email] == e }

    def create_player(username:, display_name:, email: nil, password_hash: nil, verify_token: nil, verified: false)
      @next += 1
      @players[@next] = { id: @next, username: username, name: display_name, email: email, password_hash: password_hash, verified: verified, verify_token: verify_token }
    end

    def link_identity(id, provider, pid) = (@identities[[provider, pid]] = id) && true
    def identities_of(id) = @identities.select { |_, v| v == id }.keys.map(&:first).sort
    def touch(_id) = true
    def set_display_name(id, name) = (@players[id][:name] = name) && true

    def verify_email(token)
      found = @players.values.find { |p| p[:verify_token] == token && !p[:verified] }
      return nil unless found

      found[:verified] = true
      found[:verify_token] = nil
      player(found[:id])
    end

    def create_session(id, hash, days:) = (@sessions[hash] = id) && true
    def player_by_session(hash) = (id = @sessions[hash]) && player(id)
    def delete_session(hash) = @sessions.delete(hash) && true
    def decks_of(id) = @decks[id].dup
    def grant_decks(id, ids, source:) = (@decks[id] |= Array(ids)) && true
    def set(id, key, value) = (@data[[id, key]] = value) && true
    def get(id, key) = @data[[id, key]]
  end

  # Una progressione sintetica: un Rubyfront «X-1», soglie di 10, slot 1 e 2.
  def progression
    rules = { "thresholds" => [0, 10, 20, 30, 40, 50, 60, 70, 80, 90], "points" => { "win" => 5, "loss" => 2, "draw" => 3 }, "slots" => { "rubyfront" => 1, "nexus" => 2 } }
    levels = (1..10).map { |n| { "level" => n, "rubyfront" => { "id" => "r#{n}" }, "nexus" => { "id" => "n#{n}" } } }
    Rubyfront::Progression.new(rules, { "X-1" => { "card" => "X-1", "levels" => levels } })
  end

  def opened(free: %w[alfa beta], store: FakeStore.new, google_fetch: nil, mail: [], testers: [])
    box = []
    google = A::Google.new(google_fetch ? "nostro" : "", fetch: google_fetch)
    mailer = A::Mailer.new(site: "https://gioco.example/", deliver: ->(_from, to, _subject, html) { mail << [to, html] })
    [Rubyfront::Account.new(store, ->(payload) { box << payload }, free_decks: free, google: google, mailer: mailer, progression: progression, testers: testers), box, store]
  end

  def register(account, **over)
    account.handle({ "t" => "register", "username" => "Mario", "email" => "Mario@Example.it", "password" => "segreto123", "name" => "Mario Rossi" }.merge(over.transform_keys(&:to_s)))
  end

  # Gli account di prova (2026-09-24): la busta `me` dice `tester` solo ai nomi della lista.
  def test_me_says_who_is_a_tester
    account, box = opened(testers: %w[mario])
    assert register(account)
    assert_equal true, box.last[:player][:tester]
    assert account.tester?
    other, box2 = opened
    assert register(other)
    assert_equal false, box2.last[:player][:tester]
    refute other.tester?
  end

  def test_register_creates_the_player_opens_a_session_grants_free_decks_and_mails_the_link
    mail = []
    account, box, store = opened(mail: mail)
    assert register(account)
    me = box.last
    assert_equal "me", me[:t]
    assert_equal({ id: 1, username: "mario", name: "Mario Rossi", email: "mario@example.it", verified: false, providers: [], decks: %w[alfa beta], rubyfronts: [{ card: "X-1", xp: 0, level: 1, loadout: { "rubyfront" => [], "nexus" => [] } }], tester: false }, me[:player])
    assert_match(/\A\h{64}\z/, me[:token], "la sessione al client")
    assert_equal me[:player][:id], store.sessions[A.token_hash(me[:token])], "nella memoria solo l'impronta"
    assert_equal "mario@example.it", mail[0][0]
    assert_includes mail[0][1], "?verify=#{store.players[1][:verify_token]}"
    assert A.password_ok?("segreto123", store.players[1][:password_hash])
  end

  def test_register_refuses_bad_or_taken_data_in_two_languages
    account, box, = opened
    register(account, username: "ab")
    assert_match(/nome utente/, box.last[:reason])
    assert_match(/username/, box.last[:reason_en])
    register(account, email: "no")
    assert_match(/email/, box.last[:reason])
    register(account, password: "corta")
    assert_match(/password/, box.last[:reason])
    assert register(account) && box.last[:player]
    register(account, email: "altra@example.it")
    assert_match(/già preso/, box.last[:reason])
    register(account, username: "altro")
    assert_match(/già registrata/, box.last[:reason])
  end

  def test_password_login_by_username_or_email_then_resume_then_logout
    account, box, store = opened
    register(account)
    account.handle({ "t" => "logout" })
    assert_nil box.last[:player]
    account.handle({ "t" => "login", "provider" => "password", "login" => "MARIO", "password" => "sbagliata" })
    assert_match(/sbagliati/, box.last[:reason])
    account.handle({ "t" => "login", "provider" => "password", "login" => "mario@example.it", "password" => "segreto123" })
    assert_equal "mario", box.last[:player][:username]
    token = box.last[:token]
    # Un'altra connessione riprende la sessione col token salvato.
    other, box2, = opened(store: store)
    other.handle({ "t" => "resume", "token" => token })
    assert_equal "mario", box2.last[:player][:username]
    refute box2.last.key?(:token), "riprendendo non se ne emette uno nuovo"
    other.handle({ "t" => "logout" })
    assert_empty store.sessions.select { |_, id| id == 1 }, "la sessione è cancellata"
    other.handle({ "t" => "resume", "token" => token })
    assert_match(/scaduta/, box2.last[:reason])
  end

  def test_google_login_creates_links_or_finds_the_player
    fetch = ->(_url) { '{"aud":"nostro","sub":"g-1","email":"anna@example.it","email_verified":"true","name":"Anna Verdi"}' }
    account, box, store = opened(google_fetch: fetch)
    account.handle({ "t" => "login", "provider" => "google", "idToken" => "biglietto" })
    me = box.last[:player]
    assert_equal({ username: "anna", name: "Anna Verdi", verified: true, providers: ["google"] }, me.slice(:username, :name, :verified, :providers))
    assert box.last[:token]
    # La stessa persona si era registrata con la mail: si collega, non si duplica.
    store2 = FakeStore.new
    a2, box2, = opened(store: store2)
    register(a2, email: "anna@example.it", username: "annav")
    a3, box3, = opened(store: store2, google_fetch: fetch)
    a3.handle({ "t" => "login", "provider" => "google", "idToken" => "biglietto" })
    assert_equal "annav", box3.last[:player][:username]
    assert_equal ["google"], box3.last[:player][:providers]
    assert_equal 1, store2.players.size
    # Senza client id Google è rifiutato.
    a4, box4, = opened
    a4.handle({ "t" => "login", "provider" => "google", "idToken" => "biglietto" })
    assert_match(/Google/, box4.last[:reason])
  end

  def test_verify_confirms_the_mail_once
    account, box, store = opened
    register(account)
    token = store.players[1][:verify_token]
    account.handle({ "t" => "verify", "token" => token })
    assert_equal true, box.last[:player][:verified], "seduto qui: l'utenza si aggiorna"
    account.handle({ "t" => "verify", "token" => token })
    assert_match(/non vale più/, box.last[:reason])
  end

  def test_profile_changes_the_public_name_not_the_username
    account, box, = opened
    register(account)
    account.handle({ "t" => "profile", "name" => "  Il Rosso " })
    assert_equal "Il Rosso", box.last[:player][:name]
    assert_equal "mario", box.last[:player][:username]
    account.handle({ "t" => "profile", "name" => "" })
    assert_match(/nome pubblico/, box.last[:reason])
  end

  # I mazzi gratuiti si assegnano una volta, e ogni accesso li elenca tutti (anche quelli arrivati dopo).
  def test_free_decks_are_granted_once_and_listed_at_every_login
    account, box, store = opened
    register(account)
    assert_equal %w[alfa beta], box.last[:player][:decks]
    account2, box2, = opened(free: %w[alfa beta gamma], store: store)
    account2.handle({ "t" => "login", "provider" => "password", "login" => "mario", "password" => "segreto123" })
    assert_equal %w[alfa beta gamma], box2.last[:player][:decks]
  end

  def test_unknown_provider_is_refused_and_nothing_is_granted
    account, box, store = opened
    account.handle({ "t" => "login", "provider" => "dev", "token" => "segreto" })
    assert_nil box.last[:player]
    assert_match(/rifiutato|sconosciuto/, box.last[:reason])
    assert_empty store.decks
  end

  def test_logged_player_loads_only_own_decks_and_others_pass
    account, box, = opened
    register(account)
    refute account.handle({ "t" => "judge", "seq" => 5, "action" => { "t" => "loadDeck", "deckId" => "alfa" } }), "il suo passa al tavolo"
    assert account.handle({ "t" => "judge", "seq" => 6, "action" => { "t" => "loadDeck", "deckId" => "omega" } }), "non suo: fermato qui"
    assert_equal({ t: "verdict", seq: 6, action: "loadDeck", ok: false, ruled: true }, box.last.slice(:t, :seq, :action, :ok, :ruled))
    refute account.handle({ "t" => "judge", "seq" => 7, "action" => { "t" => "turn" } }), "le altre azioni non sono sue"
  end

  # La progressione (2026-09-23): il `me` la porta per ogni Rubyfront noto
  # (livello 1 e niente montato senza righe); la configurazione si convalida
  # col livello attuale e la risposta è la progressione aggiornata.
  def test_me_carries_the_progression_and_loadout_is_validated_and_saved
    account, box, store = opened
    register(account)
    assert_equal [{ card: "X-1", xp: 0, level: 1, loadout: { "rubyfront" => [], "nexus" => [] } }], box.last[:player][:rubyfronts]
    id = box.last[:player][:id]
    store.add_xp(id, "X-1", 25)
    assert account.handle({ "t" => "loadout", "card" => "X-1", "loadout" => { "rubyfront" => ["r2"], "nexus" => %w[n1 n3] } })
    assert_equal({ t: "progress", card: "X-1", xp: 25, level: 3, loadout: { "rubyfront" => ["r2"], "nexus" => %w[n1 n3] } }, box.last)
    account.handle({ "t" => "loadout", "card" => "X-1", "loadout" => { "rubyfront" => ["r4"], "nexus" => [] } })
    assert_equal false, box.last[:ok]
    assert_match(/non sbloccata/, box.last[:reason])
    assert_match(/locked/, box.last[:reason_en])
    assert_equal({ "rubyfront" => ["r2"], "nexus" => %w[n1 n3] }, store.rubyfronts[[id, "X-1"]][:loadout], "il rifiuto non scrive")
  end

  def test_loadout_needs_the_login
    account, box, = opened
    account.handle({ "t" => "loadout", "card" => "X-1", "loadout" => {} })
    assert_equal false, box.last[:ok]
  end

  def test_without_login_every_deck_is_free_to_load
    account, = opened
    refute account.handle({ "t" => "judge", "seq" => 1, "action" => { "t" => "loadDeck", "deckId" => "omega" } })
  end

  def test_save_and_load_need_the_login
    account, box, = opened
    account.handle({ "t" => "save", "seq" => 1, "key" => "k", "value" => 1 })
    assert_equal false, box.last[:ok]
    register(account)
    account.handle({ "t" => "save", "seq" => 2, "key" => "k", "value" => { "a" => 1 } })
    assert_equal true, box.last[:ok]
    account.handle({ "t" => "load", "seq" => 3, "key" => "k" })
    assert_equal({ "a" => 1 }, box.last[:value])
  end
end
