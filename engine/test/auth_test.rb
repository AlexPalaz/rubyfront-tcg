# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/auth"

# Gli attrezzi dell'accesso: password, token, nomi utente, Google (finto), posta (finta).
class AuthTest < Minitest::Test
  A = Rubyfront::Auth

  def test_password_hash_verifies_only_the_right_password_and_never_repeats
    h1 = A.hash_password("segreto123")
    h2 = A.hash_password("segreto123")
    refute_equal h1, h2, "sale diverso ogni volta"
    assert A.password_ok?("segreto123", h1)
    refute A.password_ok?("segreto124", h1)
    refute A.password_ok?("segreto123", "spazzatura")
    assert_match(/\Apbkdf2\$120000\$/, h1)
  end

  def test_tokens_are_random_and_only_the_hash_is_stored
    t1 = A.new_token
    refute_equal t1, A.new_token
    assert_equal 64, t1.length
    assert_equal A.token_hash(t1), A.token_hash(t1)
    refute_equal t1, A.token_hash(t1)
  end

  def test_username_email_and_password_rules
    assert A.username_ok?("mario_77")
    refute A.username_ok?("Mario"), "solo minuscole: si normalizza prima"
    assert_equal "mario", A.normalize_username("  Mario ")
    refute A.username_ok?("ab")
    refute A.username_ok?("a" * 21)
    assert A.email_ok?("a@b.it")
    refute A.email_ok?("a@b")
    assert A.password_strong?("12345678")
    refute A.password_strong?("1234567")
  end

  def test_suggest_username_cleans_and_disambiguates
    taken = %w[mario mario2]
    assert_equal "mario3", A.suggest_username("Mario", taken: ->(u) { taken.include?(u) })
    assert_equal "giocatore", A.suggest_username("!!", taken: ->(_) { false })
    assert_equal "anna_rossi", A.suggest_username("anna.rossi", taken: ->(_) { false })
  end

  def test_google_accepts_only_our_audience_with_a_verified_mail
    fetch = ->(_url) { '{"aud":"nostro","sub":"123","email":"a@b.it","email_verified":"true","name":"Anna"}' }
    google = A::Google.new("nostro", fetch: fetch)
    assert_equal({ sub: "123", email: "a@b.it", name: "Anna" }, google.verify("biglietto"))
    assert_nil A::Google.new("altro", fetch: fetch).verify("biglietto"), "biglietto per un altro client"
    unverified = ->(_url) { '{"aud":"nostro","sub":"123","email":"a@b.it","email_verified":"false"}' }
    assert_nil A::Google.new("nostro", fetch: unverified).verify("biglietto")
    assert_nil A::Google.new("", fetch: fetch).verify("biglietto"), "senza client id Google non è offerto"
    assert_nil A::Google.new("nostro", fetch: ->(_) { "non json" }).verify("biglietto")
  end

  def test_mailer_builds_the_verify_link_and_delivers_through_the_given_channel
    sent = []
    mailer = A::Mailer.new(site: "https://gioco.example/", deliver: ->(from, to, subject, html) { sent << [from, to, subject, html] })
    link = mailer.send_verification("a@b.it", "tok")
    assert_equal "https://gioco.example/?verify=tok", link
    assert_equal "a@b.it", sent[0][1]
    assert_includes sent[0][3], link
    refute A::Mailer.new.configured?, "senza chiave e mittente la posta va sul log"
  end
end
