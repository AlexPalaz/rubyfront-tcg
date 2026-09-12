// Il gioco (F6): le schermate attorno al tavolo, come nel simulatore
// (main.ts): l'header, la home con le sue carte, l'accoglienza (nome e
// mazzo, l'attesa in stanza), i mazzi, le impostazioni, il sipario, la
// domanda prima di lasciare il tavolo — e la chat in stanza. Una sessione
// sola, creata all'avvio col posto di questo client (partita.ts): la home
// la porta verso la partita col bot (la stanza «solo») o verso una stanza
// con nome.
//
// Il posto non si sceglie: chi crea la stanza è A, chi entra (a mano o dal
// link d'invito, che porta `seat`) è B; contro il bot si è A. Resta salvato
// con la stanza, e il cambio passa da una ricarica, come nel simulatore: il
// posto è cucito in ogni vista.

import { allCards, allDecks, getDeck, isRubyfront } from "@rubyfront/core/cards";
import { lang, msg, t } from "@rubyfront/core/i18n";
import { seatLabel } from "@rubyfront/core/state";
import type { CardInstance, Seat } from "@rubyfront/core/types";
import { createMatch, store, type Match } from "./match";
import { Onboarding, type Mode, type Choice } from "./screens/onboarding";
import { Toolbar } from "./screens/toolbar";
import { Chat } from "./screens/chat";
import { askQuestion } from "./screens/question";
import { Home } from "./screens/home";
import { Settings } from "./screens/settings";
import { DeckBrowser } from "./screens/decks";
import { Curtain } from "./screens/curtain";
import type { Stage } from "./stage.js";
import { stopMusic } from "./sound";
import { Preview } from "./table/preview";

/** Le stanze nuove: una gemma e quattro cifre, un nome difficile da indovinare. */
const GEMS = ["rubino", "ambra", "giada", "opale", "zaffiro", "onice", "perla", "agata", "topazio", "berillo"];

export interface Screens {
  home: Home;
  onboarding: Onboarding;
  decks: DeckBrowser;
  toolbar: Toolbar;
  chat: Chat;
  settings: Settings;
  /** La stanza in cui si è (vuota: la «solo»). */
  room(): string;
}

export function startGame(stage: Stage, locale: string): { match: Match; screens: Screens } {
  const params = new URLSearchParams(location.search);
  const mySeat: Seat = (params.get("seat") ?? store.read("seat", "a")) === "b" ? "b" : "a";
  const otherSeat: Seat = mySeat === "a" ? "b" : "a";
  let room = (params.get("room") ?? store.read("room", "")).trim();

  // Le schermate nascono dopo la partita (stanno sopra il suo mondo), ma i ganci le chiamano.
  let home!: Home;
  let onboarding!: Onboarding;
  let decks!: DeckBrowser;
  let toolbar!: Toolbar;
  let chat!: Chat;

  const match = createMatch(stage, {
    seat: mySeat,
    locale,
    hooks: {
      netStatus: status => {
        onboarding?.status(t(status === "online" ? "html.ob.wait.alone" : "html.ob.wait.connecting"));
        toolbar?.network(status);
      },
      waitForPeer: () => onboarding.showWaiting(t("html.ob.wait.note", { room })),
      seated: () => {
        onboarding.close();
        home.hide();
        decks.close();
        update();
      },
      botGameOver: won => recordBotGame(won),
      afterPaint: () => chat?.update(),
    },
  });
  const { session } = match;

  const curtain = new Curtain(stage);
  home = new Home(stage, locale, {
    solo: () => (ready() ? resume() : profile("bot")),
    resume: () => resume(),
    newGame: () => profile("bot"),
    createRoom: () => joinAs(`${GEMS[Math.floor(Math.random() * GEMS.length)]}-${Math.floor(1000 + Math.random() * 9000)}`, "a"),
    enter: name => (name ? joinAs(name, "b") : home.focusRoom()),
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
      // «Gioca con questo mazzo»: lo sceglie e passa dal nome (poi il bot).
      decks.close();
      session.chooseDeck(deckId);
      updateResume();
      update();
      profile("bot", deckId);
    },
    () => update()
  );
  new Preview(stage, decks, locale);
  onboarding = new Onboarding(stage, locale, {
    toTable: choice => toTable(choice),
    invite: () => copyInvite(),
    leave: () => leaveTable(),
    backdrop: isOpen => home.setBlurred(isOpen),
  });
  chat = new Chat(stage, session.ctx, mySeat, n => toolbar.setUnread(n));
  toolbar = new Toolbar(stage, {
    home: () => goHome(),
    leave: () => askLeave(),
    settings: () => settings.toggle(),
    chat: () => chat.toggle(),
    spawn: () => void spawnCard(),
    flux: () => addFlux(),
  });

  /**
   * STRUMENTO DI PROVA, temporaneo (simulatore: overlay.ts, openCatalog): il
   * catalogo intero nella vetrina, la carta scelta arriva nella tua mano
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

  /** STRUMENTO DI PROVA, temporaneo: un Flusso in più (il «+» del simulatore), mai oltre 20 (§3.2). */
  function addFlux(): void {
    const player = session.state().players[mySeat];
    void session.dispatch({ t: "player", seat: mySeat, patch: { flux: Math.min(20, player.flux + 1) } });
  }
  const settings = new Settings(stage, {
    resync: () => session.resync(),
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
    const covers = home.isVisible() || decks.isOpen();
    stage.world.visible = !covers;
    toolbar.toTable(!covers, room !== "");
    if (covers) chat.close();
  }

  function showHome(): void {
    home.show();
    update();
  }

  function deckName(id: string): string {
    const deck = getDeck(id);
    return deck?.locales[lang()]?.name ?? deck?.locales[deck.defaultLocale]?.name ?? id;
  }

  /** Il profilo: la nota dice la stanza, o che si gioca col bot. */
  function profile(mode: Mode, deck?: string): void {
    const isMine = deck ?? session.myDeck() ?? allDecks()[0]?.id ?? null;
    const wasStandIn = allDecks().find(deck => deck.id !== isMine)?.id ?? isMine;
    onboarding.profile({
      mode,
      note: room ? t("html.ob.room.note", { room }) : mode === "bot" ? t("html.ob.bot.note") : "",
      name: store.read("name", ""),
      deck: isMine,
      botDeck: wasStandIn,
    });
  }

  /** «Al tavolo»: il nome e il mazzo si ricordano; col bot si passa dal sipario, in stanza si aspetta l'altro. */
  function toTable(choice: Choice): void {
    if (choice.name) {
      store.write("name", choice.name);
      void session.dispatch({ t: "player", seat: mySeat, patch: { name: choice.name } });
    }
    if (choice.deck) session.chooseDeck(choice.deck);
    greet();
    updateResume();
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
    settings.close();
    chat.close();
    showHome();
    session.paint();
  }

  /** Entrare in una stanza al posto dovuto: A chi la crea, B chi entra. Se il posto cambia, la pagina riparte con stanza e posto nell'indirizzo. */
  function joinAs(name: string, seat: Seat): void {
    if (mySeat === seat) {
      room = name;
      session.join(name);
      update();
      profile("net");
      return;
    }
    store.write("seat", seat);
    store.write("room", name);
    const next = new URL(location.href);
    next.search = "";
    next.searchParams.set("room", name);
    next.searchParams.set("seat", seat);
    location.href = next.href;
  }

  /** Il link d'invito: stanza e posto opposto. Dal desktop porta al gioco sul sito (VITE_INVITE_BASE), non alla pagina locale. */
  async function copyInvite(): Promise<boolean> {
    if (!room) return false;
    const base = (import.meta.env.VITE_INVITE_BASE as string | undefined) || location.href;
    const url = new URL(base);
    url.search = "";
    url.searchParams.set("room", room);
    url.searchParams.set("seat", otherSeat);
    try {
      await navigator.clipboard.writeText(url.href);
      return true;
    } catch {
      // Niente appunti (contesto non sicuro): almeno si vede il link.
      window.prompt(t("invite.prompt"), url.href);
      return false;
    }
  }

  // Il saluto in home: il nome salvato e il conto delle partite contro il bot (`stats`).
  function readStats(): { games: number; wins: number } {
    try {
      const parsed = JSON.parse(store.read("stats", "")) as { games?: number; wins?: number };
      return { games: parsed.games ?? 0, wins: parsed.wins ?? 0 };
    } catch {
      return { games: 0, wins: 0 };
    }
  }
  function recordBotGame(won: boolean): void {
    const stats = readStats();
    stats.games += 1;
    if (won) stats.wins += 1;
    store.write("stats", JSON.stringify(stats));
    greet();
  }
  function greet(): void {
    const name = store.read("name", "");
    const stats = readStats();
    const hello = name ? t("html.home.hello", { name }) : t("html.home.hello.new");
    const record = stats.games === 0 ? "" : t(stats.games === 1 ? "html.home.record.one" : "html.home.record", { games: stats.games, wins: stats.wins });
    home.greet(record ? `${hello} · ${record}` : hello);
  }

  // «Riprendi con …»: nome e mazzo già salvati, si va al tavolo con un click, il bot col mazzo diverso dal tuo.
  function ready(): boolean {
    const id = session.myDeck();
    return Boolean(store.read("name", "") && id && getDeck(id));
  }
  function updateResume(): void {
    const id = session.myDeck();
    home.resume(ready() && id ? t("html.home.resume", { deck: deckName(id) }) : null);
  }
  function resume(): void {
    const id = session.myDeck();
    if (!id) return;
    const bot = allDecks().find(deck => deck.id !== id) ?? getDeck(id);
    if (!bot) return;
    intoTable(() => {
      session.startBot(bot.id);
      session.loadDeck(id, mySeat);
    });
  }

  /** Il marchio riporta alla home: dai mazzi o dal velo si torna e basta; al tavolo si chiede, perché la partita si chiude. */
  function goHome(): void {
    settings.close();
    if (home.isVisible()) {
      decks.close();
      onboarding.close();
      update();
      if (session.awaitingPeer() || room) leaveTable();
      return;
    }
    chat.close();
    void askQuestion(stage, { title: t("ask.home.title"), text: t("html.brand.confirm"), yes: t("ask.home.yes"), no: t("ask.stay") }).then(yes => {
      if (yes) toHome();
    });
  }

  function askLeave(): void {
    settings.close();
    chat.close();
    void askQuestion(stage, { title: t("ask.leave.title"), text: t("html.leave.confirm"), yes: t("ask.leave.yes"), no: t("ask.stay") }).then(yes => {
      if (yes) toHome();
    });
  }

  // L'avvio: la stanza salvata (o del link), poi la home — col profilo se in
  // stanza manca il mazzo, o l'attesa dell'altro se c'è già tutto.
  session.join(room);
  greet();
  updateResume();
  if (!room) showHome();
  else if (!session.myDeck()) {
    showHome();
    profile("net");
  } else {
    showHome();
    session.seatOrWait();
  }
  session.paint();

  return { match, screens: { home, onboarding, decks, toolbar, chat, settings, room: () => room } };
}
