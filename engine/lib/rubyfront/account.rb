# frozen_string_literal: true

require_relative "auth"

module Rubyfront
  # L'utenza di una connessione: chi si è presentato, i suoi mazzi, i suoi
  # dati. Sta fra il trasporto e la stanza: i messaggi che sono suoi li
  # risponde e non arrivano al tavolo; il resto passa (`handle` torna false).
  #
  #   {t:"register", username, email, password, name?}   → me + token (e la posta di conferma)
  #   {t:"login", provider:"password", login, password}   → me + token
  #   {t:"login", provider:"google", idToken}             → me + token (il biglietto verificato da Google)
  #   {t:"resume", token}                                 → me (la sessione salvata dal client)
  #   {t:"logout"}                                        → me con player null (la sessione cancellata)
  #   {t:"verify", token}                                 → me (la mail confermata) o verified:false
  #   {t:"profile", name}                                 → me (il nome pubblico cambiato)
  #   {t:"loadout", card, loadout:{rubyfront:[…], nexus:[…]}} → {t:"progress", card, xp, level, loadout} (o ok:false, reason) — la progressione (2026-09-23)
  #   {t:"save", seq, key, value}                         → {t:"saved", seq, key, ok, reason?, reason_en?}
  #   {t:"load", seq, key}                                → {t:"data", seq, key, value}   (null se non c'è)
  #
  # `me` è {t:"me", player:{id, username, name, email, verified, providers, decks, rubyfronts}, token?}
  # (`rubyfronts`: la progressione per Rubyfront — card, xp, level, loadout — dal 2026-09-23)
  # o {t:"me", player:null, reason, reason_en} su un rifiuto.
  #
  # I mazzi (2026-09-20) sono del giocatore: all'accesso gli si assegnano i
  # gratuiti che ancora non ha; chi è entrato gioca solo coi suoi (un
  # `loadDeck` non suo è fermato qui, prima del tavolo). Le identità (google,
  # domani steam) sono più accessi allo stesso giocatore. L'utenza di prova a
  # chiave (`dev`) è stata tolta il 2026-09-23: si entra solo come tutti.
  class Account
    attr_reader :player

    def initialize(store, out, free_decks: [], google: nil, mailer: nil, progression: nil)
      @progression = progression
      @store = store
      @out = out
      @free_decks = free_decks
      @google = google || Auth::Google.new("")
      @mailer = mailer || Auth::Mailer.new
      @player = nil
      @session_hash = nil
    end

    def handle(message)
      case message["t"]
      when "register" then register(message)
      when "login" then login(message)
      when "resume" then resume(message)
      when "logout" then logout
      when "verify" then verify(message)
      when "profile" then profile(message)
      when "save" then save(message)
      when "load" then load(message)
      when "loadout" then loadout(message)
      when "judge" then return deck_stopped(message)
      else return false
      end
      true
    end

    private

    # ------------------------------------------------------------ l'accesso

    def register(message)
      return no_memory unless @store

      username = Auth.normalize_username(message["username"])
      email = Auth.normalize_email(message["email"])
      password = message["password"].to_s
      name = message["name"].to_s.strip
      name = username if name.empty?
      return refuse("il nome utente: da 3 a 20 fra lettere minuscole, cifre e _", "the username: 3 to 20 lowercase letters, digits and _") unless Auth.username_ok?(username)
      return refuse("l'email non è valida", "the email isn't valid") unless Auth.email_ok?(email)
      return refuse("la password: almeno #{Auth::PASSWORD_MIN} caratteri", "the password: at least #{Auth::PASSWORD_MIN} characters") unless Auth.password_strong?(password)
      return refuse("il nome pubblico: al più #{Auth::DISPLAY_MAX} caratteri", "the public name: at most #{Auth::DISPLAY_MAX} characters") if name.length > Auth::DISPLAY_MAX
      return refuse("quel nome utente è già preso", "that username is already taken") if @store.username_taken?(username)
      return refuse("quell'email è già registrata", "that email is already registered") if @store.email_taken?(email)

      token = Auth.new_token
      created = @store.create_player(username: username, display_name: name, email: email, password_hash: Auth.hash_password(password), verify_token: token)
      @mailer.send_verification(email, token)
      open_session(created)
    rescue StandardError => error
      warn "register: #{error.message}"
      refuse("la memoria non risponde", "the memory isn't answering")
    end

    def login(message)
      return no_memory unless @store

      case message["provider"]
      when "password"
        found = @store.player_by_login(Auth.normalize_username(message["login"]))
        return refuse("nome utente o password sbagliati", "wrong username or password") unless found && Auth.password_ok?(message["password"], found[:password_hash])

        open_session(found)
      when "google"
        info = @google.verify(message["idToken"])
        return refuse("Google non ha riconosciuto l'accesso", "Google didn't recognize the sign-in") unless info

        open_session(google_player(info))
      else
        refuse("accesso sconosciuto", "unknown sign-in")
      end
    rescue StandardError => error
      warn "login: #{error.message}"
      refuse("la memoria non risponde", "the memory isn't answering")
    end

    # Chi ha il biglietto di Google: la sua identità se c'è; se no la mail
    # (verificata da Google) di un giocatore registrato, e si collega; se no
    # un giocatore nuovo con un nome utente libero.
    def google_player(info)
      found = @store.player_by_identity("google", info[:sub])
      return found if found

      by_mail = @store.player_by_email(Auth.normalize_email(info[:email]))
      if by_mail
        @store.link_identity(by_mail[:id], "google", info[:sub])
        return by_mail
      end
      username = Auth.suggest_username(info[:email].to_s.split("@").first, taken: ->(candidate) { @store.username_taken?(candidate) })
      name = info[:name].to_s.strip[0, Auth::DISPLAY_MAX]
      created = @store.create_player(username: username, display_name: name.empty? ? username : name, email: Auth.normalize_email(info[:email]), verified: true)
      @store.link_identity(created[:id], "google", info[:sub])
      created
    end

    def resume(message)
      return no_memory unless @store

      hash = Auth.token_hash(message["token"])
      player = @store.player_by_session(hash)
      return refuse("la sessione è scaduta: accedi di nuovo", "the session has expired: log in again") unless player

      @session_hash = hash
      settle(player, token: nil)
    rescue StandardError => error
      warn "resume: #{error.message}"
      refuse("la memoria non risponde", "the memory isn't answering")
    end

    def logout
      @store.delete_session(@session_hash) if @store && @session_hash
      @session_hash = nil
      @player = nil
      @out.call({ t: "me", player: nil })
    rescue StandardError => error
      warn "logout: #{error.message}"
      @player = nil
      @out.call({ t: "me", player: nil })
    end

    def verify(message)
      return no_memory unless @store

      player = @store.verify_email(message["token"].to_s)
      return refuse("il link di conferma non vale più", "the confirmation link is no longer valid") unless player

      # Se è la stessa persona seduta qui, la sua utenza si aggiorna.
      if @player && @player[:id] == player[:id] then settle(player, token: nil)
      else @out.call({ t: "verified", username: player[:username] })
      end
    rescue StandardError => error
      warn "verify: #{error.message}"
      refuse("la memoria non risponde", "the memory isn't answering")
    end

    def profile(message)
      return refuse("prima l'accesso", "log in first") unless @player && @store

      name = message["name"].to_s.strip
      return refuse("il nome pubblico: da 1 a #{Auth::DISPLAY_MAX} caratteri", "the public name: 1 to #{Auth::DISPLAY_MAX} characters") if name.empty? || name.length > Auth::DISPLAY_MAX

      @store.set_display_name(@player[:id], name)
      settle(@store.player(@player[:id]), token: nil)
    rescue StandardError => error
      warn "profile: #{error.message}"
      refuse("la memoria non risponde", "the memory isn't answering")
    end

    # Una sessione nuova per il giocatore: il token va al client, l'impronta nella memoria.
    def open_session(player)
      token = Auth.new_token
      @session_hash = Auth.token_hash(token)
      @store.create_session(player[:id], @session_hash, days: Auth::SESSION_DAYS)
      settle(player, token: token)
    end

    # Il giocatore è seduto: i mazzi gratuiti che gli mancano, poi «me».
    def settle(player, token:)
      id = player[:id]
      @store.touch(id)
      missing = @free_decks - @store.decks_of(id)
      @store.grant_decks(id, missing, source: "free") unless missing.empty?
      @player = {
        id: id, username: player[:username], name: player[:name], email: player[:email], verified: player[:verified] == true,
        providers: @store.identities_of(id), decks: @store.decks_of(id),
        rubyfronts: rubyfronts_of(id)
      }
      payload = { t: "me", player: @player }
      payload[:token] = token if token
      @out.call(payload)
    end

    def refuse(reason, reason_en)
      @player = nil
      @out.call({ t: "me", player: nil, reason: reason, reason_en: reason_en })
    end

    def no_memory
      refuse("il tavolo non ha una memoria collegata", "the table has no memory attached")
    end

    # ------------------------------------------------------------- i mazzi

    # Il mazzo caricato dev'essere del giocatore, se il giocatore c'è. Torna
    # true (fermato, verdetto mandato) o false (passa al tavolo).
    # La progressione di ogni Rubyfront conosciuto (2026-09-23): la riga della
    # memoria se c'è, se no livello 1 e niente montato.
    def rubyfronts_of(id)
      return [] unless @progression

      rows = @store.rubyfronts_of(id).to_h { |row| [row[:card], row] }
      @progression.card_ids.map { |card| @progression.progress_of(card, rows[card]) }
    end

    # La configurazione delle abilità montate: convalidata contro il livello
    # attuale, poi scritta; la risposta è la progressione aggiornata.
    def loadout(message)
      card = message["card"].to_s
      return progress_refused(card, "serve l'accesso", "you need to be logged in") unless @player
      return progress_refused(card, "non c'è una memoria collegata", "no memory is connected") unless @store && @progression

      current = @store.rubyfronts_of(@player[:id]).find { |row| row[:card] == card }
      level = @progression.level_for(current ? current[:xp] : 0)
      ok, reason, reason_en = @progression.loadout_ok?(card, level, message["loadout"])
      return progress_refused(card, reason, reason_en) unless ok

      row = @store.set_loadout(@player[:id], card, message["loadout"])
      progress = @progression.progress_of(card, row)
      @player[:rubyfronts] = rubyfronts_of(@player[:id])
      @out.call({ t: "progress" }.merge(progress))
    rescue StandardError => error
      warn "loadout: #{error.message}"
      progress_refused(card, "la memoria non risponde", "the memory isn't answering")
    end

    def progress_refused(card, reason, reason_en)
      @out.call({ t: "progress", card: card, ok: false, reason: reason, reason_en: reason_en })
    end

    def deck_stopped(message)
      action = message["action"]
      return false unless @player && action.is_a?(Hash) && action["t"] == "loadDeck"

      deck = action["deckId"].to_s
      return false if @player[:decks].include?(deck)

      @out.call({ t: "verdict", seq: message["seq"], action: "loadDeck", ok: false, ruled: true,
                  reason: "quel mazzo non è tuo: si gioca coi mazzi assegnati al proprio account", reason_en: "that deck isn't yours: you play with the decks assigned to your account" })
      true
    end

    # -------------------------------------------------------------- i dati

    def save(message)
      key = message["key"].to_s
      unless @player && @store && !key.empty?
        return @out.call({ t: "saved", seq: message["seq"], key: key, ok: false, reason: "prima l'accesso", reason_en: "log in first" })
      end
      @store.set(@player[:id], key, message["value"])
      @out.call({ t: "saved", seq: message["seq"], key: key, ok: true })
    rescue StandardError => error
      warn "save: #{error.message}"
      @out.call({ t: "saved", seq: message["seq"], key: key, ok: false, reason: "la memoria non risponde", reason_en: "the memory isn't answering" })
    end

    def load(message)
      key = message["key"].to_s
      value = @player && @store && !key.empty? ? @store.get(@player[:id], key) : nil
      @out.call({ t: "data", seq: message["seq"], key: key, value: value })
    rescue StandardError => error
      warn "load: #{error.message}"
      @out.call({ t: "data", seq: message["seq"], key: key, value: nil })
    end
  end
end
