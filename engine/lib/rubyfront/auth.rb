# frozen_string_literal: true

require "json"
require "net/http"
require "openssl"
require "securerandom"
require "uri"

module Rubyfront
  # Gli attrezzi dell'accesso (2026-09-22), puri e senza gemme: le password
  # (PBKDF2-HMAC-SHA256 con sale, dalla libreria standard), i token di
  # sessione (a caso, in memoria solo l'impronta), le regole del nome utente,
  # la verifica del biglietto di Google, la posta di conferma.
  module Auth
    PBKDF2_ITERATIONS = 120_000
    USERNAME = /\A[a-z0-9_]{3,20}\z/
    EMAIL = /\A[^@\s]+@[^@\s]+\.[^@\s]+\z/
    PASSWORD_MIN = 8
    DISPLAY_MAX = 24
    SESSION_DAYS = 90

    module_function

    # «pbkdf2$iterazioni$sale$impronta», tutto in base64.
    def hash_password(password)
      salt = SecureRandom.random_bytes(16)
      digest = OpenSSL::KDF.pbkdf2_hmac(password, salt: salt, iterations: PBKDF2_ITERATIONS, length: 32, hash: "sha256")
      ["pbkdf2", PBKDF2_ITERATIONS, [salt].pack("m0"), [digest].pack("m0")].join("$")
    end

    def password_ok?(password, stored)
      scheme, iterations, salt, digest = stored.to_s.split("$", 4)
      return false unless scheme == "pbkdf2" && iterations && salt && digest

      candidate = OpenSSL::KDF.pbkdf2_hmac(password.to_s, salt: salt.unpack1("m0"), iterations: iterations.to_i, length: 32, hash: "sha256")
      secure_equal?([candidate].pack("m0"), digest)
    end

    def secure_equal?(a, b)
      a = a.to_s
      b = b.to_s
      return false unless a.bytesize == b.bytesize

      a.bytes.zip(b.bytes).reduce(0) { |acc, (x, y)| acc | (x ^ y) }.zero?
    end

    # Il token di sessione va al client; nel database resta solo l'impronta.
    def new_token = SecureRandom.hex(32)
    def token_hash(token) = OpenSSL::Digest::SHA256.hexdigest(token.to_s)

    def normalize_username(name) = name.to_s.strip.downcase
    def normalize_email(email) = email.to_s.strip.downcase
    def username_ok?(name) = USERNAME.match?(name.to_s)
    def email_ok?(email) = EMAIL.match?(email.to_s)
    def password_strong?(password) = password.to_s.length >= PASSWORD_MIN

    # Un nome utente libero a partire da una base (la parte prima della @ di
    # una mail, il nome di Google): ripulito, e con un numero in coda se serve.
    def suggest_username(base, taken:)
      root = base.to_s.downcase.gsub(/[^a-z0-9_]/, "_").gsub(/_+/, "_").delete_prefix("_").delete_suffix("_")[0, 16]
      root = "giocatore" if root.length < 3
      candidate = root
      n = 1
      while taken.call(candidate)
        n += 1
        candidate = "#{root}#{n}"
      end
      candidate
    end

    # Il biglietto di Google (l'ID token del bottone «Accedi con Google»):
    # lo si fa leggere a Google stesso, e si accetta solo se è per il NOSTRO
    # client e con la mail verificata. `fetch` è `->(url) { corpo }` (i test
    # lo fingono). Torna {sub:, email:, name:} o nil.
    class Google
      TOKENINFO = "https://oauth2.googleapis.com/tokeninfo"

      def initialize(client_id, fetch: nil)
        @client_id = client_id.to_s
        @fetch = fetch || method(:http_get)
      end

      def configured? = !@client_id.empty?

      def verify(id_token)
        return nil unless configured? && id_token.is_a?(String) && !id_token.empty?

        body = @fetch.call("#{TOKENINFO}?id_token=#{URI.encode_www_form_component(id_token)}")
        info = JSON.parse(body.to_s) rescue nil
        return nil unless info.is_a?(Hash) && info["aud"] == @client_id && info["sub"].is_a?(String)
        return nil unless %w[true].include?(info["email_verified"].to_s) && info["email"].is_a?(String)

        { sub: info["sub"], email: info["email"], name: info["name"].to_s }
      end

      private

      def http_get(url)
        uri = URI(url)
        Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 8, read_timeout: 10) do |http|
          response = http.get(uri.request_uri)
          response.is_a?(Net::HTTPSuccess) ? response.body : ""
        end
      end
    end

    # La posta di conferma: con RESEND_API_KEY parte davvero (Resend), senza
    # si scrive sul log del tavolo — così il giro si prova anche prima di
    # avere il servizio (2026-09-22: «impostalo solo»). `deliver` è
    # `->(from, to, subject, html) { }` per i test.
    class Mailer
      def initialize(api_key: "", from: "", site: "", deliver: nil)
        @api_key = api_key.to_s
        @from = from.to_s
        @site = site.to_s
        @deliver = deliver
      end

      def configured? = !@api_key.empty? && !@from.empty?

      # Il link di conferma: il sito col token; il client lo legge da `?verify=`.
      def verify_link(token)
        base = @site.empty? ? "http://localhost:5173/" : @site
        "#{base}#{base.include?("?") ? "&" : "?"}verify=#{token}"
      end

      def send_verification(to, token)
        link = verify_link(token)
        subject = "Rubyfront: conferma la tua email"
        html = "<p>Benvenuto al tavolo. Conferma la tua email aprendo questo link:</p><p><a href=\"#{link}\">#{link}</a></p>"
        if @deliver
          @deliver.call(@from, to, subject, html)
        elsif configured?
          resend(to, subject, html)
        else
          warn "[posta non configurata] conferma per #{to}: #{link}"
        end
        link
      end

      private

      def resend(to, subject, html)
        uri = URI("https://api.resend.com/emails")
        request = Net::HTTP::Post.new(uri)
        request["Authorization"] = "Bearer #{@api_key}"
        request["Content-Type"] = "application/json"
        request.body = JSON.generate({ from: @from, to: [to], subject: subject, html: html })
        Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 8, read_timeout: 15) { |http| http.request(request) }
      rescue StandardError => error
        warn "posta: #{error.message}"
      end
    end
  end
end
