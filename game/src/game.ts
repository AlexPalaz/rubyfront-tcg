// Il gioco (F6): le schermate attorno al tavolo: l'header, la home con le sue carte, l'accoglienza (nome e
// mazzo, l'attesa in stanza), i mazzi, le impostazioni, il sipario, la
// domanda prima di lasciare il tavolo — e la chat in stanza. Una sessione
// sola, creata all'avvio col posto di questo client (partita.ts): la home
// la porta verso la partita col bot (la stanza «solo») o verso una stanza
// con nome.
//
// Il posto non si sceglie: chi crea la stanza è A, chi entra (a mano o dal
// link d'invito, che porta `seat`) è B; contro il bot si è A. Resta salvato
// con la stanza, e il cambio passa da una ricarica: il posto è cucito in
// ogni vista.

import { allCards, availableDecks, getCard, isRubyfront } from "@rubyfront/core/cards";
import { msg, t } from "@rubyfront/core/i18n";
import { seatLabel } from "@rubyfront/core/state";
import type { CardInstance, Seat } from "@rubyfront/core/types";
import { createMatch, store, type Match } from "./match";
import { Onboarding, type Mode, type Choice } from "./screens/onboarding";
import { Toolbar } from "./screens/toolbar";
import { Chat } from "./screens/chat";
import { Chronicle } from "./screens/chronicle";
import { askQuestion } from "./screens/question";
import { Home } from "./screens/home";
import { Settings } from "./screens/settings";
import { DeckBrowser } from "./screens/decks";
import { ProgressionScreen } from "./screens/progression/index";
import { RewardOverlay, type RewardShow } from "./screens/progression/reward";
import { Curtain } from "./screens/curtain";
import { Auth } from "./screens/auth";
import type { Stage } from "./stage.js";
import { stopMusic } from "./sound";
import { Preview } from "./table/preview";
import { faceModel } from "./card/model";

/** Le stanze nuove: una gemma e quattro cifre, un nome difficile da indovinare. */
const GEMS = ["rubino", "ambra", "giada", "opale", "zaffiro", "onice", "perla", "agata", "topazio", "berillo"];

export interface Screens {
  home: Home;
  onboarding: Onboarding;
  decks: DeckBrowser;
  toolbar: Toolbar;
  chat: Chat;
  chronicle: Chronicle;
  settings: Settings;
  /** La sferografia dei Rubyfront (2026-09-23). */
  progression: ProgressionScreen;
  /** La ricompensa a fine partita (2026-09-24), da fuori per le prove. */
  reward(show: RewardShow): Promise<void>;
  /** La stanza in cui si è (vuota: la «solo»). */
  room(): string;
}

export function startGame(stage: Stage, locale: string): { match: Match; screens: Screens } {
  const params = new URLSearchParams(location.search);
  const mySeat: Seat = (params.get("seat") ?? store.read("seat", "a")) === "b" ? "b" : "a";
  let room = (params.get("room") ?? store.read("room", "")).trim();

  // Le schermate nascono dopo la partita (stanno sopra il suo mondo), ma i ganci le chiamano.
  let home!: Home;
  let onboarding!: Onboarding;
  let decks!: DeckBrowser;
  let progression!: ProgressionScreen;
  let toolbar!: Toolbar;
  let chat!: Chat;
  let chronicle!: Chronicle;

  const match = createMatch(stage, {
    seat: mySeat,
    locale,
    hooks: {
      netStatus: status => {
        onboarding?.status(t(status === "online" ? "html.ob.wait.alone" : "html.ob.wait.connecting"));
        toolbar?.network(status);
      },
      engineStatus: status => auth?.offline(status !== "online"),
      waitForPeer: () => onboarding.showWaiting(t("html.ob.wait.note", { room })),
      // Il posto lo assegna il tavolo (2026-09-23): se non è il mio, la pagina riparte con stanza e posto.
      reseat: (name, seat) => restartAs(name, seat),
      roomFull: name => {
        room = "";
        home.room("");
        onboarding.close();
        showHome();
        void askQuestion(stage, { title: t("html.ob.full.title"), text: t("html.ob.full.text", { room: name }), yes: t("html.store.soon.ok") });
      },
      searching: () => onboarding.showSearching(t("html.ob.search.note")),
      matched: (name, seat) => joinAs(name, seat),
      // L'utenza è cambiata: i mazzi disponibili con lei (il tasto nell'header, il pannello se è aperto);
      // con un account la porta si apre (o si chiude, all'uscita): la schermata d'accesso sta davanti alla home (2026-09-22).
      accountChanged: player => {
        updateDeckChip();
        greet();
        if (settings?.isOpen()) settings.open();
        if (player) {
          if (auth?.isOpen()) {
            auth.close();
            enter();
          }
        } else if (!room && !auth?.isOpen()) {
          settings?.close();
          decks.close();
          progression.close();
          onboarding.close();
          showHome();
          auth?.open(false);
        }
      },
      accountRefused: reason => auth?.refused(reason),
      // La progressione (2026-09-23): il pannello si ridisegna; a fine partita l'avviso in cima e la riga in cronaca (la scrive la sessione).
      progressChanged: update => {
        progression?.refresh();
        updateDeckChip();
        // A fine partita: la ricompensa animata, dopo che l'insegna finale si è vista (2026-09-24).
        if (update.gained) {
          const show: RewardShow = { card: update.card, gained: update.gained, outcome: update.outcome ?? "draw", after: { card: update.card, xp: update.xp, level: update.level, loadout: update.loadout }, locale };
          setTimeout(() => void showReward(show), 1500);
        }
      },
      progressRefused: (_card, reason) => progression?.refused(reason),
      seated: () => {
        onboarding.close();
        home.hide();
        decks.close();
        progression.close();
        update();
      },
      afterPaint: () => {
        chat?.update();
        chronicle?.update();
      },
    },
  });
  const { session } = match;

  const curtain = new Curtain(stage);
  home = new Home(stage, locale, {
    solo: () => profile("bot"),
    newGame: () => profile("bot"),
    random: () => {
      if (!session.findMatch()) void askQuestion(stage, { title: t("html.ob.search.fail.title"), text: t("html.ob.search.fail.text"), yes: t("html.store.soon.ok") });
    },
    createRoom: () => joinAs(`${GEMS[Math.floor(Math.random() * GEMS.length)]}-${Math.floor(1000 + Math.random() * 9000)}`, mySeat),
    // Il posto lo decide il tavolo: si entra col proprio, e se è preso la pagina riparte con l'altro (reseat).
    enter: name => (name ? joinAs(name, mySeat) : home.focusRoom()),
    decks: () => {
      home.closeCards();
      decks.open();
      update();
    },
  });
  decks = new DeckBrowser(
    stage,
    locale,
    deckId => {
      // «Scegli questo mazzo» (2026-09-20): scelto e basta — il nome sale nell'header, si torna in home.
      session.chooseDeck(deckId);
      updateDeckChip();
      decks.close();
      progression.close();
      update();
      // In stanza senza mazzo si era passati di qui: scelto, si aspetta l'altro (o ci si siede).
      if (room && !session.awaitingPeer()) session.seatOrWait();
    },
    () => session.myDeck(),
    () => update()
  );
  new Preview(stage, decks, locale);
  progression = new ProgressionScreen(stage, locale, {
    progress: card => session.progress(card),
    setLoadout: (card, loadout) => session.setLoadout(card, loadout),
    onClose: () => update(),
  });
  new Preview(stage, progression, locale);
  onboarding = new Onboarding(stage, locale, {
    toTable: choice => toTable(choice),
    invite: () => copyInvite(),
    leave: () => leaveTable(),
    cancelSearch: () => {
      session.cancelMatch();
      onboarding.close();
    },
    backdrop: isOpen => home.setBlurred(isOpen),
    dismiss: () => goHome(),
  });
  chat = new Chat(stage, session.ctx, mySeat, n => toolbar.setUnread(n));
  chronicle = new Chronicle(stage, session.ctx, mySeat, locale);
  // Le targhette tacciono quando il loro angolo è preso dalla cronaca (che le mostra già) o dalla chat.
  match.toast.hiddenBy(() => chronicle.isOpen() || chat.isOpen());
  toolbar = new Toolbar(stage, {
    home: () => goHome(),
    leave: () => askLeave(),
    settings: () => settings.toggle(),
    chat: () => {
      chronicle.close();
      chat.toggle();
    },
    deck: () => {
      home.closeCards();
      onboarding.close();
      decks.open();
      update();
    },
    chronicle: () => {
      chat.close();
      chronicle.toggle();
    },
    progression: () => {
      home.closeCards();
      onboarding.close();
      decks.close();
      progression.open();
      update();
    },
    // Il negozio non è ancora aperto: l'avviso col sigillo del gioco.
    store: () => void askQuestion(stage, { title: t("html.store.soon.title"), text: t("html.store.soon.text"), yes: t("html.store.soon.ok") }),
    spawn: () => void spawnCard(),
    flux: () => addFlux(),
    win: () => endNow(true),
    lose: () => endNow(false),
  });

  /** STRUMENTO DI PROVA (solo account di prova, 2026-09-24): la partita finisce subito, vinta o persa — i PV di chi perde a zero, e la fine la giudica il tavolo come sempre. */
  function endNow(won: boolean): void {
    const loser: Seat = won ? (mySeat === "a" ? "b" : "a") : mySeat;
    void session.dispatch({ t: "player", seat: loser, patch: { hp: 0 }, test: true });
  }

  /**
   * STRUMENTO DI PROVA, temporaneo: il catalogo intero nella vetrina, la carta scelta arriva nella tua mano
   * (`spawn`, che il tavolo lascia passare come strumento di prova).
   */
  async function spawnCard(): Promise<void> {
    const state = session.state();
    const ghosts: CardInstance[] = allCards()
      .filter(entry => !isRubyfront(entry.id))
      .map(entry => ({ uid: `catalog:${entry.id}`, cardId: entry.id, owner: mySeat, zone: "hand", face: 0, x: 0, y: 0, order: 0, tapped: false, facedown: false, z: 0 }));
    const chosen = await match.pileViewer.choose(ghosts, t("overlay.catalog", { name: seatLabel(state, mySeat) }));
    if (!chosen) return;
    const card: CardInstance = { ...chosen, uid: crypto.randomUUID() };
    if (await session.dispatch({ t: "spawn", card })) session.ctx.log(msg("log.spawn", { seat: mySeat, id: chosen.cardId }), mySeat);
  }

  /** STRUMENTO DI PROVA, temporaneo: un Flusso in più, mai oltre 20 (§3.2). */
  function addFlux(): void {
    const player = session.state().players[mySeat];
    void session.dispatch({ t: "player", seat: mySeat, patch: { flux: Math.min(20, player.flux + 1) }, test: true });
  }
  const auth = new Auth(
    stage,
    {
      login: (login, password) => session.loginPassword(login, password),
      register: (username, email, password, name) => session.register(username, email, password, name),
      google: idToken => session.loginGoogle(idToken),
    },
    (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ""
  );
  const settings = new Settings(stage, {
    resync: () => session.resync(),
    account: () => session.account(),
    login: () => {
      settings.close();
      auth.open(false);
    },
    setDisplayName: name => session.setDisplayName(name),
    logout: () => session.logout(),
    language: next => {
      // La lingua veste ogni scritta, molte dipinte una volta sola: la pagina riparte, e rientra da sé nella stanza salvata.
      store.write("lang", next);
      const url = new URL(location.href);
      url.searchParams.delete("lang");
      location.href = url.href;
    },
  });

  /** Chi copre il tavolo: la home e i mazzi lo nascondono; al tavolo l'header offre «Esci dalla partita». */
  function update(): void {
    const covers = home.isVisible() || decks.isOpen() || progression.isOpen();
    stage.world.visible = !covers;
    toolbar.toTable(!covers, room !== "");
    if (covers) {
      chat.close();
      chronicle.close();
    }
  }

  function showHome(): void {
    home.show();
    update();
  }


  /** Il profilo: la nota dice la stanza, o che si gioca col bot. */
  /** La ricompensa a fine partita (2026-09-24): un overlay alla volta. */
  let reward: RewardOverlay | null = null;
  async function showReward(show: RewardShow): Promise<void> {
    if (reward) return;
    reward = new RewardOverlay(stage, show);
    await reward.open();
    reward = null;
  }

  /** Il tasto del mazzo nell'header (2026-09-20): il nome del mazzo scelto, o l'invito a sceglierlo. */
  function updateDeckChip(): void {
    const id = session.myDeck();
    const deck = id ? availableDecks().find(candidate => candidate.id === id) : undefined;
    // La copertina è il Rubyfront del mazzo: la sua illustrazione, se c'è.
    const cover = deck?.cards.find(entry => isRubyfront(entry.card))?.card;
    const face = cover ? getCard(cover)?.faces[0]?.id : undefined;
    const art = cover && face ? faceModel(cover, face, locale)?.art?.src ?? null : null;
    toolbar?.setDeck(deck ? { name: deck.locales[locale]?.name ?? deck.locales[deck.defaultLocale]?.name ?? deck.id, art } : null, Boolean(session.account()));
    toolbar?.setGems(session.account()?.gems ?? 0);
    // Gli strumenti di prova (Evoca, +1 Flusso, Vinci, Perdi) solo con un account di prova: lo dice il tavolo (2026-09-24).
    toolbar?.setDev(session.account()?.tester === true);
    toolbar?.setLevel(cover && session.account() ? session.progress(cover).level : null);
  }

  function profile(mode: Mode, deck?: string): void {
    const isMine = deck ?? session.myDeck() ?? null;
    // Senza un mazzo scelto non si chiede: si va alla collezione, dove si sceglie giocando.
    if (!isMine) {
      home.closeCards();
      decks.open();
      update();
      return;
    }
    const wasStandIn = availableDecks().find(deck => deck.id !== isMine)?.id ?? isMine;
    onboarding.profile({
      mode,
      note: room ? t("html.ob.room.note", { room }) : mode === "bot" ? t("html.ob.bot.note") : "",
      deck: isMine,
      botDeck: wasStandIn,
    });
  }

  /** «Al tavolo»: il nome e il mazzo si ricordano; col bot si passa dal sipario, in stanza si aspetta l'altro. */
  function toTable(choice: Choice): void {
    if (choice.deck) session.chooseDeck(choice.deck);
    greet();
    updateDeckChip();
    if (choice.mode === "bot") {
      const deckId = session.myDeck();
      const botDeck = choice.botDeck ?? deckId;
      if (!botDeck) return;
      intoTable(() => {
        match.expectEntrance();
        session.startBotWithIntro(botDeck, deckId);
      });
      return;
    }
    onboarding.close();
    session.seatOrWait();
  }

  /**
   * Il sipario verso la partita col bot: il nero cala sulla home, resta giù
   * — intanto home e velo spariscono e sotto c'è il tavolo vuoto —, si alza,
   * e a sipario alzato la partita parte: la Preparazione nasce sul tavolo in
   * vista. La musica della home sfuma col nero.
   */
  function intoTable(begin: () => void): void {
    stopMusic();
    onboarding.showFields(false);
    settings.close();
    curtain.pass({
      atBlack: () => {
        home.hide();
        onboarding.close();
        decks.close();
        progression.close();
        update();
        session.paint();
      },
      afterRise: begin,
    });
  }

  /** Dalla partita alla home: al nero il tavolo si azzera e la home torna; il nero resta meno. */
  function toHome(): void {
    curtain.pass({ atBlack: () => leaveTable(), hold: 900 });
  }

  /**
   * «Esci dal tavolo»: si lascia la stanza (o si congeda il bot), il tavolo
   * si azzera e si torna alla home. La stanza salvata si dimentica; nome e
   * mazzo restano.
   */
  function leaveTable(): void {
    stopMusic(true);
    session.leaveRoom();
    room = "";
    home.room("");
    // Fuori dalla stanza il posto torna A; se qui si era B, la pagina riparte.
    if (mySeat !== "a") {
      store.write("seat", "a");
      const next = new URL(location.href);
      next.search = "";
      location.href = next.href;
      return;
    }
    session.resetTable();
    session.reapplyName();
    onboarding.close();
    home.closeCards();
    decks.close();
    progression.close();
    settings.close();
    chat.close();
    chronicle.close();
    showHome();
    session.paint();
  }

  /**
   * Entrare in una stanza (2026-09-23): il posto lo assegna il tavolo. Si
   * entra col proprio e, se il tavolo ne dà un altro (o l'atrio lo ha già
   * deciso), la pagina riparte con stanza e posto nell'indirizzo — il posto è
   * cucito nella sessione e cambia solo così. Niente passo «Al tavolo»: col
   * mazzo scelto si aspetta l'altro, senza si passa dalla collezione.
   */
  function joinAs(name: string, seat: Seat): void {
    if (mySeat !== seat) {
      restartAs(name, seat);
      return;
    }
    room = name;
    session.join(name);
    sitInRoom();
  }

  function sitInRoom(): void {
    onboarding.close();
    showHome();
    if (!session.myDeck()) {
      home.closeCards();
      decks.open();
      update();
      return;
    }
    session.seatOrWait();
  }

  /** La pagina riparte in quella stanza a quel posto. */
  function restartAs(name: string, seat: Seat): void {
    store.write("seat", seat);
    store.write("room", name);
    const next = new URL(location.href);
    next.search = "";
    next.searchParams.set("room", name);
    next.searchParams.set("seat", seat);
    location.href = next.href;
  }

  /** Il link d'invito: la stanza e basta — il posto lo assegna il tavolo (2026-09-23). Dal desktop porta al gioco sul sito (VITE_INVITE_BASE), non alla pagina locale. */
  async function copyInvite(): Promise<boolean> {
    if (!room) return false;
    const base = (import.meta.env.VITE_INVITE_BASE as string | undefined) || location.href;
    const url = new URL(base);
    url.search = "";
    url.searchParams.set("room", room);
    try {
      await navigator.clipboard.writeText(url.href);
      return true;
    } catch {
      // Niente appunti (contesto non sicuro): almeno si vede il link.
      window.prompt(t("invite.prompt"), url.href);
      return false;
    }
  }

  // Il saluto in home: il nome salvato. Il conto delle partite non si tiene
  // più nel browser (tolto il 2026-09-20): i dati del giocatore andranno
  // nella memoria del tavolo (session.save/load), quando il designer dirà quali.
  function greet(): void {
    const name = session.account()?.name ?? store.read("name", "");
    home.greet(name ? t("html.home.hello", { name }) : t("html.home.hello.new"));
  }

  // Niente «Riprendi con …» (tolto il 2026-09-20): ogni partita è nuova, si passa sempre da nome e mazzo.

  /** Il marchio riporta alla home: dai mazzi o dal velo si torna e basta; al tavolo si chiede, perché la partita si chiude. */
  function goHome(): void {
    settings.close();
    if (home.isVisible()) {
      decks.close();
      progression.close();
      onboarding.close();
      update();
      if (session.awaitingPeer() || room) leaveTable();
      return;
    }
    chat.close();
    chronicle.close();
    void askQuestion(stage, { title: t("ask.home.title"), text: t("html.brand.confirm"), yes: t("ask.home.yes"), no: t("ask.stay") }).then(yes => {
      if (yes) toHome();
    });
  }

  function askLeave(): void {
    settings.close();
    chat.close();
    chronicle.close();
    void askQuestion(stage, { title: t("ask.leave.title"), text: t("html.leave.confirm"), yes: t("ask.leave.yes"), no: t("ask.stay") }).then(yes => {
      if (yes) toHome();
    });
  }

  // L'ingresso, a account presente: la stanza salvata (o del link), poi la
  // home — la collezione se in stanza manca il mazzo, o l'attesa dell'altro
  // se c'è già tutto.
  function enter(): void {
    if (!room) showHome();
    else sitInRoom();
  }

  // L'avvio: il tavolo, poi la porta (2026-09-22) — la schermata d'accesso
  // finché non c'è un account; una sessione salvata rientra da sé al saluto.
  session.join(room);
  greet();
  updateDeckChip();
  // La home sta dietro la porta, sfocata dal velo; si entra solo con l'account.
  showHome();
  auth.open(session.hasSavedSession());
  session.paint();

  return { match, screens: { home, onboarding, decks, progression, toolbar, chat, chronicle, settings, reward: show => showReward(show), room: () => room } };
}
