// Avvio del simulatore: mette insieme lavagna, pannello, chat e rete.
//
// Lo stato vive qui, in una variabile sola. Ogni modifica passa da `dispatch`,
// che fa tre cose nell'ordine: applica, ritrasmette, ridisegna. Non esiste
// altro modo di cambiare la partita — nemmeno per la rete, che entra dallo
// stesso imbuto.

// Il carattere dell'interfaccia (le carte hanno il loro, da card.css):
// Space Grotesk, self-hosted — un grottesco geometrico che fa da macchina
// attorno al manufatto delle carte.
import "@fontsource-variable/space-grotesk";
import { mountChat } from "./chat.js";
import { SLOT_X, SURFACE_W, backRowY, isCompactView, setCompactView, viewBattleTop, type Ctx } from "./ctx.js";
import { connectEngine, DEFAULT_ENGINE, type EngineLink, type EngineStatus, type EngineVerdict } from "./engine.js";
import { connect, DEFAULT_RELAY, type Net, type NetStatus } from "./net.js";
import { mountOverlay } from "./overlay.js";
import { tapPreview } from "./preview.js";
import { PHASE_BANNER_HOLD_MS, mountPhaseBanner } from "./banner.js";
import { showRoll } from "./dice.js";
import { showEnterPeek } from "./effect.js";
import { mountHud } from "./hud.js";
import { setupPreview } from "./preview.js";
import { allDecks, cardName, cardStats, defaultTheme, enterEffects, getDeck, isRubyfront, loadRenderer } from "./renderer.js";
import { apply, newGame, phaseCloser, seatLabel, shuffled, zoneCards } from "./state.js";
import { drawCascadeMs, mountTable } from "./table.js";
import { describeGameOver, verdictByHp } from "./turn.js";
import { createVoice, type VoicePayload } from "./voice.js";
import type { Action, CardInstance, GameState, Seat } from "./types.js";
import { SEATS, otherSeat } from "./types.js";

const boot = document.querySelector<HTMLElement>("#boot")!;

try {
  await loadRenderer();
} catch (error) {
  boot.textContent =
    "Non riesco a caricare le carte dal sito (docs/cards). " +
    "In sviluppo serve `npm run dev` da questa cartella. " +
    String(error);
  boot.classList.add("is-error");
  throw error;
}

const params = new URLSearchParams(location.search);
const store = {
  read: (key: string, fallback: string): string => localStorage.getItem(`rbf-sim:${key}`) ?? fallback,
  write: (key: string, value: string): void => localStorage.setItem(`rbf-sim:${key}`, value),
};

/** Chi inizia, per ora a caso (§4: la scelta o il d20 arriveranno). */
function randomSeat(): Seat {
  return Math.random() < 0.5 ? "a" : "b";
}

let state: GameState = newGame(randomSeat());
let mySeat: Seat = (params.get("seat") as Seat) ?? (store.read("seat", "a") as Seat);
if (!SEATS.includes(mySeat)) mySeat = "a";
let locale = params.get("lang") ?? store.read("lang", "it");
let net: Net | null = null;
/** L'arbitro esterno (engine/): c'è solo se il flag nelle impostazioni è acceso. */
let engine: EngineLink | null = null;
/**
 * Il mazzo scelto resta noto al client anche dopo "nuova partita": a tavola
 * pulita ciascuno rimette in tavola il proprio, senza rifare la scelta.
 */
let myDeckId: string | null = store.read("deck", "") || null;
/**
 * Il mazzo dell'avversario simulato in partita locale (senza stanza): c'è
 * solo dopo «Gioca in locale», e cade appena si entra in una stanza vera.
 */
let localFoeDeckId: string | null = null;

const themes: Record<Seat, string> = { a: defaultTheme(), b: defaultTheme() };

// ------------------------------------------------------------------ ctx

function dispatch(action: Action): Promise<boolean> {
  // Il poliziotto: con l'engine collegato, l'azione parte solo col suo
  // benestare — un «no» la ferma prima che tocchi lavagna e rete, e si
  // mostra (engineStop). Engine spento o irraggiungibile: tavolo libero,
  // come sempre. La promessa dice se l'azione è passata: serve a chi ne
  // accoda altre che senza questa non hanno senso (endTurn).
  const judge = engine;
  if (judge && judge.status() === "online") {
    return new Promise(resolve => {
      judge.judge(action, actorFor(action), verdict => {
        if (verdict?.ruled && !verdict.ok) {
          engineStop(verdict);
          // Un gesto trascinato (una carta posata sul Fronte) può aver già
          // mosso i pixel: si ridisegna dallo stato — che non è cambiato —
          // e tutto torna al suo posto.
          paint();
          resolve(false);
          return;
        }
        commit(action);
        resolve(true);
      });
    });
  }
  commit(action);
  return Promise.resolve(true);
}

/** Applica, ritrasmette, ridisegna: l'azione ormai è passata. */
function commit(action: Action): void {
  state = apply(state, action);
  net?.send({ t: "action", action, from: mySeat });
  paint();
  // §2 — la fine per PV si guarda dopo ogni azione applicata in locale
  // (la risoluzione, un contatore a mano): la dichiara il client che l'ha
  // vista arrivare, e l'engine la verifica sulla sua copia. Una volta sola.
  if (action.t === "gameOver") return;
  const over = verdictByHp(state);
  if (over) {
    void dispatch({ t: "gameOver", ...over }).then(passed => {
      if (!passed) return;
      const { title, detail } = describeGameOver(state, over);
      ctx.log(`${title} — ${detail}.`, over.winner);
    });
  }
}

/** Applica senza ritrasmettere: per le azioni che arrivano già dalla rete. */
function receive(action: Action, from: Seat): void {
  // La giocata dell'avversario si vede anche qui, senza fermare nulla: la
  // carta accesa un attimo, poi la tessera «ultima giocata» (effect.ts).
  if (action.t === "toZone" && action.zone === "field") {
    const card = state.cards[action.uid];
    if (card && card.zone === "hand") {
      void showEnterPeek(document.querySelector<HTMLElement>("#table")!, {
        cardId: card.cardId,
        face: card.face,
        theme: themes[card.owner],
        locale,
        who: `${seatLabel(state, card.owner, mySeat)} gioca «${cardName(card.cardId, locale)}»`,
        effects: enterEffects(card.cardId, card.face, locale),
      });
    }
  }
  // Un effetto dell'avversario si vede anche qui: la fonte si accende, e se
  // ha un bersaglio la freccia lo indica — prima che la carta parta.
  if ((action.t === "draw" || action.t === "look") && action.effect) table.flash(action.effect.source);
  let fly: (() => void) | null = null;
  if (action.t === "toZone" && action.effect) {
    const moving = state.cards[action.uid];
    table.flash(action.effect.source, 1600);
    if (action.zone === "field" && moving && moving.zone !== "field") {
      // Un ritorno dalla pila: il volo parte dopo che la carta è comparsa.
      const from = moving.zone;
      const owner = moving.owner;
      fly = () => table.flyFromPile(owner, from, action.uid);
    } else {
      table.flashArrow(action.effect.source, action.uid);
      fly = table.liftForFlight(action.uid);
    }
  }
  // Il tiro del dado dell'avversario si vede anche qui: la carta scende
  // insieme, ma il momento è lo stesso.
  if (action.t === "move" && action.roll !== undefined) {
    const die = cardStats(state.cards[action.uid]?.cardId ?? "").deployment?.die ?? 6;
    void showRoll(document.querySelector<HTMLElement>("#table")!, die, action.roll, "Schieramento del Rubyfront");
  }
  state = apply(state, action);
  // Anche le azioni dell'avversario passano all'engine: l'arbitro guarda la
  // partita intera, non una metà.
  engine?.consult(action, from);
  paint();
  fly?.();
}

/**
 * Chi compie il gesto, per l'arbitro (§6: nel turno altrui non si agisce).
 * In rete è sempre questo client, cioè il suo posto. In partita locale lo
 * stesso mouse governa entrambi i posti: l'attore è allora il proprietario
 * della carta toccata, o il posto del contatore o del mazzo — e per i gesti
 * senza posto (fase, turno) chi è di turno. Limite dichiarato: in locale un
 * effetto risolto a mano sulle carte AVVERSARIE, nel proprio turno, risulta
 * un gesto dell'avversario e l'arbitro lo ferma; in rete no, perché lì il
 * gesto è di chi trascina.
 */
function actorFor(action: Action): Seat {
  if (localFoeDeckId === null) return mySeat;
  if ("uid" in action) return state.cards[action.uid]?.owner ?? state.active;
  if ("from" in action) return state.cards[action.from]?.owner ?? state.active;
  if (action.t === "declare") return action.declaration.seat;
  // Chiudere la fase (turno, fase, risoluzione) è di chi chiude: in
  // Reazione il difensore (§6.4), altrimenti chi è di turno.
  if (action.t === "turn" || action.t === "phase" || action.t === "resolve") return phaseCloser(state);
  if ("seat" in action) return action.seat;
  return state.active;
}

const ctx: Ctx = {
  state: () => state,
  dispatch,
  seat: () => mySeat,
  // In partita locale (hotseat) si governano entrambi i posti: turni, mani
  // e mazzi dei due giocatori rispondono allo stesso mouse.
  controls: seat => seat === mySeat || localFoeDeckId !== null,
  arbitrated: () => engine?.status() === "online",
  themeFor: seat => themes[seat],
  locale: () => locale,
  card: cardId => {
    const stats = cardStats(cardId);
    return {
      name: cardName(cardId, locale),
      kind: stats.kind,
      race: stats.race,
      power: stats.power,
      counterattack: stats.counterattack,
      enterListeners: stats.enterListeners,
      enterMoves: stats.enterMoves,
      behavior: stats.behavior,
      enterReturns: stats.enterReturns,
      enterLooks: stats.enterLooks,
    };
  },
  log(text, seat) {
    dispatch({
      t: "say",
      entry: { id: crypto.randomUUID(), seat: seat ?? null, kind: "log", text, ts: Date.now() },
    });
  },
};

// ----------------------------------------------------------------- voce

const voice = createVoice({
  seat: () => mySeat,
  send: payload => {
    if (!net || net.status() !== "online") return false;
    net.send({ t: "rtc", payload, from: mySeat });
    return true;
  },
  log: (text, seat) => ctx.log(text, seat ?? mySeat),
  micId: () => store.read("mic", ""),
  // Il VU meter sul tasto del microfono: un riempimento verde che segue la
  // voce (style.css legge --mic-level).
  onLevel: level => document.body.style.setProperty("--mic-level", level.toFixed(3)),
});

// ----------------------------------------------------------------- viste

// La vista compatta va decisa prima di montare il tavolo: le zone nascono
// già con la geometria giusta.
setCompactView(store.read("compact", "") === "1");

const table = mountTable(document.querySelector<HTMLElement>("#table")!, ctx);
// L'insegna di fase sta sul tavolo, sopra le carte: è lì che si guarda.
const banner = mountPhaseBanner(document.querySelector<HTMLElement>("#table")!, ctx);
const chat = mountChat(document.querySelector<HTMLElement>("#chat")!, ctx);
// La colonna è solo la chat; si apre e si chiude, e la scelta resta fra una
// partita e l'altra. Aperta la chat l'HUD si ritira: dall'HUD si apre con
// l'ingranaggio, dalla chat si chiude con la ×.
// La chat parte chiusa: il tavolo prima di tutto. Chi la apre se la
// ritrova aperta alla prossima visita.
if (store.read("side", "closed") === "closed") document.body.classList.add("side-closed");
function toggleSide(): void {
  const closed = document.body.classList.toggle("side-closed");
  store.write("side", closed ? "closed" : "open");
  unreadChat = 0;
  unreadLog = 0;
  paint();
}
// Mescola, pesca e cerca stanno sull'HUD: sono gesti di partita, non di
// impostazione. L'overlay è montato poche righe sotto: ai click esiste già.
const hud = mountHud(document.querySelector<HTMLElement>("#hud")!, ctx, {
  chat: toggleSide,
  voice: async () => {
    const before = voice.enabled();
    await voice.toggle();
    const after = voice.enabled();
    document.body.dataset.voice = after ? "on" : "";
    if (before !== after) {
      ctx.log(`Posto ${mySeat.toUpperCase()} ${after ? "accende" : "spegne"} il microfono.`, mySeat);
    }
    // Col permesso appena concesso i nomi dei microfoni diventano leggibili.
    void fillMics();
    paint();
  },
  shuffle: doShuffle,
  draw: doDraw,
  search: () => overlay.open(mySeat, "deck"),
  spawn: () => overlay.openCatalog(mySeat),
});
document.querySelector("#side-close")!.addEventListener("click", toggleSide);
const overlay = mountOverlay(ctx, () => paint());
table.onBrowse((seat, zone) => overlay.open(seat, zone));
table.onPick((seat, zone, candidates, title, visible) => overlay.pick(seat, zone, candidates, title, visible));

/** Righe arrivate a chat chiusa: due spie — messaggi (blu) e azioni (oro). */
let unreadChat = 0;
let unreadLog = 0;
let seenChat = 0;
let seenLog = 0;

function paint(): void {
  syncThemes();
  // A chat chiusa i tasti portano due spie — blu i messaggi, oro le azioni —
  // altrimenti ciò che arriva passerebbe inosservato. Contano solo le righe
  // dell'AVVERSARIO: le proprie non sono notizie.
  const fromFoe = state.chat.filter(entry => entry.seat && entry.seat !== mySeat);
  const chats = fromFoe.filter(entry => entry.kind === "chat").length;
  const logs = fromFoe.filter(entry => entry.kind === "log").length;
  if (document.body.classList.contains("side-closed")) {
    unreadChat += Math.max(0, chats - seenChat);
    unreadLog += Math.max(0, logs - seenLog);
  } else {
    unreadChat = 0;
    unreadLog = 0;
  }
  seenChat = chats;
  seenLog = logs;
  document.body.dataset.unread = unreadChat > 0 ? String(unreadChat) : "";
  document.body.dataset.unreadLog = unreadLog > 0 ? String(unreadLog) : "";
  table.render();
  banner.render();
  chat.render();
  hud.render();
}

/** Il tema di un posto è quello del suo mazzo (data/decks/*.json). */
function syncThemes(): void {
  for (const seat of SEATS) {
    const deckId = state.players[seat].deckId;
    const deck = deckId ? getDeck(deckId) : undefined;
    themes[seat] = deck?.theme ?? defaultTheme();
  }
}

// ------------------------------------------------------------- mazzi

/**
 * Espande un mazzo in carte fisiche. Il Rubyfront non entra nel mazzo: parte
 * in Zona di Richiamo (§3.1), cioè appoggiato al suo posto sulla lavagna.
 */
function buildDeck(deckId: string, seat: Seat): CardInstance[] | null {
  const deck = getDeck(deckId);
  if (!deck) return null;

  const cards: CardInstance[] = [];
  let serial = 0;
  for (const entry of deck.cards) {
    for (let copy = 0; copy < entry.count; copy += 1) {
      serial += 1;
      cards.push({
        uid: `${seat}-${serial}`,
        cardId: entry.card,
        owner: seat,
        zone: "deck",
        face: 0,
        x: 0,
        y: 0,
        order: serial,
        tapped: false,
        facedown: false,
        z: 0,
      });
    }
  }

  const library = cards.filter(card => !isRubyfront(card.cardId));
  shuffled(library).forEach((card, index) => {
    card.order = index;
  });
  for (const card of cards) {
    if (!isRubyfront(card.cardId)) continue;
    card.zone = "field";
    card.x = SLOT_X.richiamo;
    card.y = backRowY(seat);
    card.z = 1;
  }
  return cards;
}

/** Pausa tra la fine della cascata iniziale e la carta del turno 1. */
const OPENING_DRAW_PAUSE_MS = 250;
/** Il timer dell'apertura, per posto (insegna → mano → carta del turno 1):
    si azzera se il mazzo si ricarica prima che la fila sia finita. */
const openingTimer: Record<Seat, number | undefined> = { a: undefined, b: undefined };

/** Quante carte ha in mano quel posto, adesso. */
function handSize(seat: Seat): number {
  return Object.values(state.cards).filter(c => c.owner === seat && c.zone === "hand").length;
}

function loadDeck(deckId: string, seat: Seat): void {
  const cards = buildDeck(deckId, seat);
  if (!cards) return;
  // Si ricorda solo il PROPRIO mazzo: quello dell'avversario locale non deve
  // diventare "il mio" alla prossima visita.
  if (seat === mySeat) {
    myDeckId = deckId;
    store.write("deck", deckId);
  }
  dispatch({ t: "loadDeck", seat, deckId, cards });
  const deck = getDeck(deckId);
  const name = deck?.locales[locale]?.name ?? deck?.locales[deck.defaultLocale]?.name ?? deckId;
  ctx.log(`Posto ${seat.toUpperCase()}: caricato «${name}» (${cards.length} carte).`, seat);
  // L'apertura è una fila di tre tempi: l'insegna «Fase di Preparazione»
  // al centro del tavolo; poi, mentre svanisce, la mano iniziale; poi, a
  // cascata finita più un respiro, la carta del turno 1 di chi apre. Ogni
  // tempo controlla che il tavolo sia ancora quello (stesso mazzo, mano
  // com'era attesa): a mazzo ricaricato o partita nuova, la fila si lascia
  // cadere. Il mazzo dell'avversario locale passa di qui subito dopo il
  // proprio: l'insegna riparte da capo, e non si vede.
  banner.announce();
  window.clearTimeout(openingTimer[seat]);
  openingTimer[seat] = window.setTimeout(() => {
    if (state.players[seat].deckId !== deckId || handSize(seat) !== 0) return;
    // §4, mano iniziale: «prima che inizi il primo turno, entrambi i
    // giocatori pescano 6 carte». Il mazzo esce da buildDeck già mescolato,
    // quindi la pesca parte da sola — a ogni via d'inizio (partita locale,
    // stanza, Nuova partita), perché tutte passano di qui. Il mulligan (§4,
    // punto 5) resta un gesto manuale: «Mescola» e poi «Pesca 6» dal mazzo.
    void dispatch({ t: "draw", seat, count: 6 });
    // §6.1 — «la pesca non si salta mai», nemmeno al primo turno di chi
    // inizia: il posto di turno pesca anche la carta del turno 1. In rete
    // ci pensa il client che governa quel posto: ognuno carica il proprio
    // mazzo, e solo chi apre passa di qui con `active` suo.
    const opening = seat === state.active;
    ctx.log(
      `Posto ${seat.toUpperCase()}: mano iniziale pescata` +
        `${opening ? " — apre la partita, pesca anche la carta del turno 1" : ""}.`,
      seat
    );
    if (!opening) return;
    openingTimer[seat] = window.setTimeout(() => {
      const untouched = state.players[seat].deckId === deckId && state.active === seat && handSize(seat) === 6;
      if (untouched) void dispatch({ t: "draw", seat, count: 1 });
    }, drawCascadeMs(6) + OPENING_DRAW_PAUSE_MS);
  }, PHASE_BANNER_HOLD_MS);
}

// ----------------------------------------------------------------- rete

function setStatus(status: NetStatus, peers: number): void {
  const dot = document.querySelector<HTMLElement>("#net-dot")!;
  dot.dataset.status = status;
  dot.title =
    status === "online"
      ? `Collegato · ${peers} nella stanza`
      : status === "connecting"
        ? "Mi sto collegando…"
        : "Non collegato — si gioca in locale";
}

let seatClashWarned = false;
function warnSeatClash(): void {
  if (seatClashWarned) return;
  seatClashWarned = true;
  ctx.log(
    `Attenzione: nella stanza ci sono due giocatori al posto ${mySeat.toUpperCase()}. Uno dei due cambi posto (ingranaggio → Posto), poi «Sincronizza la lavagna».`
  );
}

function join(room: string, relay: string): void {
  seatClashWarned = false;
  voice.shutdown();
  document.body.dataset.voice = "";
  net?.close();
  net = null;
  if (!room.trim()) {
    setStatus("offline", 0);
    return;
  }
  store.write("room", room);
  store.write("relay", relay);
  // In una stanza vera l'altra metà del tavolo è di qualcuno: l'avversario
  // simulato della partita locale si alza — via le sue carte e il suo nome,
  // il posto torna «In attesa…» per chi arriva. (La rete qui è già chiusa:
  // il congedo resta locale.)
  if (localFoeDeckId) {
    localFoeDeckId = null;
    const foe = otherSeat(mySeat);
    void dispatch({ t: "loadDeck", seat: foe, deckId: "", cards: [] });
    void dispatch({ t: "player", seat: foe, patch: { name: "" } });
  }
  net = connect(relay || DEFAULT_RELAY, room.trim(), mySeat, {
    onStatus: setStatus,
    onMessage(message) {
      // Un messaggio col MIO posto come mittente: nella stanza c'è un altro
      // client seduto dove sono io. Applicarlo scombinerebbe la lavagna:
      // meglio ignorarlo e dirlo forte.
      if ("from" in message && message.from === mySeat) {
        warnSeatClash();
        return;
      }
      if (message.t === "rtc") {
        if (message.from !== mySeat) voice.receive(message.payload as VoicePayload);
        return;
      }
      if (message.t === "action") {
        // "Nuova partita" azzera il tavolo di entrambi: ognuno rimette poi il
        // proprio mazzo, perché il suo id è noto solo al suo client.
        receive(message.action, message.from);
        if (message.action.t === "newGame") {
          if (myDeckId) loadDeck(myDeckId, mySeat);
          reapplyName();
        }
        return;
      }
      if (message.t === "hello") {
        // Chi è già nella stanza passa la lavagna a chi entra. Se non ho
        // ancora niente in tavola non rispondo: non sono io la copia buona.
        if (Object.keys(state.cards).length > 0) {
          net?.send({ t: "state", state, from: mySeat });
        }
        return;
      }
      if (message.t === "state") {
        // La lavagna di chi era già dentro sostituisce la mia — ma può non
        // sapere niente di me, se il mio carico è partito mentre il relay
        // ancora dormiva. Mazzo e nome si rimettono, e stavolta viaggiano.
        const hadMine = Object.values(state.cards).some(card => card.owner === mySeat);
        // Una lavagna arrivata da un client più vecchio può non sapere delle
        // fasi (§6): senza il campo, si riparte dalla Preparazione.
        state = { ...message.state, phase: message.state.phase ?? "preparazione" };
        // La lavagna è appena stata sostituita in blocco: anche la copia
        // dell'engine deve ripartire da qui, non dalle azioni che ha visto.
        engine?.snapshot(state);
        paint();
        const incomingHasMine = Object.values(state.cards).some(card => card.owner === mySeat);
        if (hadMine && !incomingHasMine && myDeckId) loadDeck(myDeckId, mySeat);
        const myName = store.read("name", "");
        if (myName && state.players[mySeat].name !== myName) {
          dispatch({ t: "player", seat: mySeat, patch: { name: myName } });
        }
      }
    },
  });
}

// -------------------------------------------------------------- comandi

const deckPick = document.querySelector<HTMLSelectElement>("#deck-pick")!;
for (const deck of allDecks()) {
  const option = document.createElement("option");
  option.value = deck.id;
  option.textContent = deck.locales[locale]?.name ?? deck.locales[deck.defaultLocale]?.name ?? deck.id;
  deckPick.append(option);
}
if (myDeckId) deckPick.value = myDeckId;

const seatPick = document.querySelector<HTMLSelectElement>("#seat-pick")!;
const roomInput = document.querySelector<HTMLInputElement>("#room-name")!;
const relayInput = document.querySelector<HTMLInputElement>("#relay-url")!;
const langPick = document.querySelector<HTMLSelectElement>("#lang-pick")!;

seatPick.value = mySeat;
langPick.value = locale;
roomInput.value = params.get("room") ?? store.read("room", "");
// Il relay può arrivare dal link d'invito: chi entra così non deve sapere
// nemmeno che esiste.
relayInput.value = params.get("relay") ?? store.read("relay", DEFAULT_RELAY);

document.querySelector("#deck-load")!.addEventListener("click", () => loadDeck(deckPick.value, mySeat));

function doShuffle(): void {
  const order = shuffled(zoneCards(state, mySeat, "deck").map(card => card.uid));
  if (order.length === 0) return;
  dispatch({ t: "shuffle", seat: mySeat, order });
  ctx.log(`Posto ${mySeat.toUpperCase()} mescola il mazzo (${order.length} carte).`, mySeat);
}

function doDraw(): void {
  if (zoneCards(state, mySeat, "deck").length === 0) {
    ctx.log(`Posto ${mySeat.toUpperCase()}: mazzo vuoto.`, mySeat);
    return;
  }
  dispatch({ t: "draw", seat: mySeat, count: 1 });
  ctx.log(`Posto ${mySeat.toUpperCase()} pesca 1 carta.`, mySeat);
}

document.querySelector("#do-new")!.addEventListener("click", () => {
  if (!confirm("Nuova partita: tavolo, contatori e chat vengono azzerati. Procedo?")) return;
  const starter = randomSeat();
  void dispatch({ t: "newGame", active: starter }).then(passed => {
    if (!passed) return;
    ctx.log(
      `Nuova partita: inizia ${seatLabel(state, starter)}, il Gettone Flusso va a ${seatLabel(state, otherSeat(starter))} (§4).`
    );
  });
  if (myDeckId) loadDeck(myDeckId, mySeat);
  reapplyName();
  if (localFoeDeckId) startLocalFoe(localFoeDeckId);
});

/** La nuova partita azzera anche i nomi: il proprio si rimette da sé. */
function reapplyName(): void {
  const myName = store.read("name", "");
  if (myName) dispatch({ t: "player", seat: mySeat, patch: { name: myName } });
}

document.querySelector("#do-push")!.addEventListener("click", () => {
  net?.send({ t: "state", state, from: mySeat });
  ctx.log("Lavagna inviata all'avversario.");
});

document.querySelector("#do-join")!.addEventListener("click", () => join(roomInput.value, relayInput.value));

// Una stanza è solo un nome: chi lo conosce entra. "Crea stanza" ne inventa
// uno difficile da indovinare e ci entra subito; "Copia link" impacchetta
// stanza, posto OPPOSTO e relay in un URL — chi lo apre è dentro, seduto
// dall'altra parte, senza toccare un'impostazione.
const GEMME = ["rubino", "ambra", "giada", "opale", "zaffiro", "onice", "perla", "agata", "topazio", "berillo"];
document.querySelector("#room-create")!.addEventListener("click", () => {
  const name = `${GEMME[Math.floor(Math.random() * GEMME.length)]}-${Math.floor(1000 + Math.random() * 9000)}`;
  roomInput.value = name;
  join(name, relayInput.value);
});
document.querySelector("#room-invite")!.addEventListener("click", async () => {
  const room = roomInput.value.trim();
  if (!room) return;
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("room", room);
  url.searchParams.set("seat", otherSeat(mySeat));
  if (relayInput.value && relayInput.value !== DEFAULT_RELAY) url.searchParams.set("relay", relayInput.value);
  const button = document.querySelector<HTMLButtonElement>("#room-invite")!;
  try {
    await navigator.clipboard.writeText(url.href);
    button.textContent = "Copiato ✓";
  } catch {
    // Niente clipboard (contesto non sicuro): almeno si vede il link.
    prompt("Copia il link d'invito:", url.href);
    return;
  }
  window.setTimeout(() => (button.textContent = "Copia link"), 1600);
});

// Il fermo dell'arbitro: una regola ha bloccato l'azione. Non un alert da
// browser ma un sigillo del gioco — la gemma del marchio, il motivo in
// prosa, il riferimento al manuale su una targhetta. Il gesto non è
// avvenuto e lo si deve sapere subito: sta sopra tutto e si chiude col
// tasto, con Esc o con un click sul fondo.
function engineStop(verdict: EngineVerdict): void {
  document.querySelector(".engine-stop")?.remove();
  const raw = verdict.reason ?? `l'azione «${verdict.action ?? "?"}» viola una regola del manuale`;
  // Il «(§6.2, attesa di evocazione)» in coda diventa la targhetta; la prosa
  // resta pulita. Se il riferimento sta a metà frase, si sfila e basta.
  const ref = raw.match(/\s*\(§([\d.]+)(?:,\s*([^)]+))?\)/);
  const prose = (ref ? raw.replace(ref[0], "") : raw).replace(/^\s*(\S)/, (_, ch: string) => ch.toUpperCase());

  const backdrop = document.createElement("div");
  backdrop.className = "engine-stop";
  const card = document.createElement("div");
  card.className = "engine-stop-card";

  const gem = document.createElement("span");
  gem.className = "engine-stop-gem";
  gem.setAttribute("aria-hidden", "true");

  const title = document.createElement("h3");
  title.className = "engine-stop-title";
  title.textContent = "Azione fermata";

  const reason = document.createElement("p");
  reason.className = "engine-stop-text";
  reason.textContent = prose.endsWith(".") ? prose : `${prose}.`;

  const okay = document.createElement("button");
  okay.type = "button";
  okay.className = "engine-stop-ok";
  okay.textContent = "Va bene";

  const close = (): void => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };
  okay.addEventListener("click", close);
  backdrop.addEventListener("pointerdown", event => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);

  card.append(gem, title, reason);
  if (ref) {
    const badge = document.createElement("span");
    badge.className = "engine-stop-ref";
    badge.textContent = `Manuale · §${ref[1]}${ref[2] ? ` — ${ref[2]}` : ""}`;
    card.append(badge);
  }
  card.append(okay);
  backdrop.append(card);
  document.body.append(backdrop);
  okay.focus();
}

// L'engine: l'arbitro esterno, dietro un flag e ACCESO di default — chi
// non l'ha mai toccato gioca arbitrato (chi l'ha spento apposta resta
// spento). Senza un engine raggiungibile la spia va in rosso e il tavolo
// resta libero, come sempre: un arbitro assente non ferma nessuno. Acceso,
// giudica le azioni locali PRIMA che si applichino (vedi dispatch): l'engine
// dà solo le regole, il poliziotto è il simulatore — trattiene l'azione,
// e su un «no» la lascia cadere mostrando l'avviso. Le azioni avversarie
// arrivano già applicate: a quelle va solo un'occhiata (receive).
const engineToggle = document.querySelector<HTMLInputElement>("#engine-toggle")!;
const engineUrlInput = document.querySelector<HTMLInputElement>("#engine-url")!;
const engineDot = document.querySelector<HTMLElement>("#engine-dot")!;
engineToggle.checked = store.read("engine", "1") === "1";
engineUrlInput.value = store.read("engineUrl", DEFAULT_ENGINE);

function setEngineStatus(status: EngineStatus): void {
  engineDot.dataset.status = status;
  engineDot.title =
    status === "online"
      ? "Engine collegato"
      : status === "connecting"
        ? "Engine: mi sto collegando…"
        : "Engine non raggiungibile";
  // L'HUD cambia faccia con l'arbitro (Fine fase al posto di Fine turno):
  // si ridisegna subito, non alla prossima mossa.
  paint();
}

function engineApply(): void {
  engine?.close();
  engine = null;
  engineDot.hidden = !engineToggle.checked;
  if (!engineToggle.checked) return;
  // Il saluto arriva a ogni riconnessione: in chat va una volta sola, salvo
  // che l'engine sia cambiato nel frattempo (versione o regole).
  let welcomed = "";
  engine = connectEngine(engineUrlInput.value.trim() || DEFAULT_ENGINE, {
    onStatus: setEngineStatus,
    onWelcome(version, rules) {
      // Il saluto vuol dire connessione (o riconnessione) fresca: l'engine
      // parte con la copia del tavolo vuota — gli si passa la lavagna com'è.
      engine?.snapshot(state);
      const signature = `${version}|${rules.join(",")}`;
      if (signature === welcomed) return;
      welcomed = signature;
      ctx.log(
        `Engine collegato (v${version}): ` +
          (rules.length === 0 ? "osserva soltanto, nessuna regola attiva." : `regole attive — ${rules.join(", ")}.`)
      );
    },
    onVerdict(verdict) {
      // Qui arrivano solo le occhiate sulle azioni AVVERSARIE (receive): già
      // applicate dal client di là, non si possono fermare — una violazione
      // si annota in chat e basta.
      if (!verdict.ruled || verdict.ok) return;
      ctx.log(`Engine: l'azione avversaria «${verdict.action}» viola una regola${verdict.reason ? ` — ${verdict.reason}` : ""}.`);
    },
  });
}
engineApply();
engineToggle.addEventListener("change", () => {
  store.write("engine", engineToggle.checked ? "1" : "");
  engineApply();
});
engineUrlInput.addEventListener("change", () => {
  store.write("engineUrl", engineUrlInput.value.trim());
  if (engineToggle.checked) engineApply();
});

// Vista compatta: sul campo solo testa e illustrazione delle carte, tavolo
// tutto in vista senza scorrere. Il dettaglio pieno resta al passaggio del
// mouse (o al tap). Cambio a caldo: si rifà la sola geometria di vista.
const compactToggle = document.querySelector<HTMLInputElement>("#compact-toggle")!;
compactToggle.checked = isCompactView();
compactToggle.addEventListener("change", () => {
  setCompactView(compactToggle.checked);
  store.write("compact", compactToggle.checked ? "1" : "");
  table.refreshLayout();
  frameBoard();
  paint();
});

// Il microfono da usare: l'elenco si riempie coi dispositivi visibili (i
// nomi veri compaiono dopo il primo permesso) e la scelta resta salvata.
const micPick = document.querySelector<HTMLSelectElement>("#mic-pick")!;
async function fillMics(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const mics = devices.filter(device => device.kind === "audioinput");
  const chosen = store.read("mic", "");
  micPick.replaceChildren(new Option("Predefinito", ""));
  mics.forEach((mic, index) => {
    micPick.append(new Option(mic.label || `Microfono ${index + 1}`, mic.deviceId));
  });
  micPick.value = [...micPick.options].some(option => option.value === chosen) ? chosen : "";
}
void fillMics();
navigator.mediaDevices?.addEventListener?.("devicechange", () => void fillMics());
micPick.addEventListener("change", () => store.write("mic", micPick.value));

// L'ingranaggio apre le impostazioni; un click fuori (o Esc) le richiude.
const settingsPanel = document.querySelector<HTMLElement>("#settings")!;
const settingsToggle = document.querySelector<HTMLElement>("#settings-toggle")!;
settingsToggle.addEventListener("click", () => {
  settingsPanel.hidden = !settingsPanel.hidden;
});
document.addEventListener("pointerdown", event => {
  if (settingsPanel.hidden) return;
  const target = event.target as HTMLElement;
  if (settingsPanel.contains(target) || settingsToggle.contains(target)) return;
  settingsPanel.hidden = true;
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") settingsPanel.hidden = true;
});

seatPick.addEventListener("change", () => {
  // Il posto decide quale metà è "tua" e cosa puoi toccare: si rilegge tutto
  // da capo invece di ricucire le viste già montate.
  store.write("seat", seatPick.value);
  const next = new URL(location.href);
  next.searchParams.set("seat", seatPick.value);
  location.href = next.href;
});

// Il tema del tavolo è tutto CSS: si stampa sul body e il foglio fa il resto.
// È un vestito del client, non dello stato: ognuno gioca col tema suo.
const themePick = document.querySelector<HTMLSelectElement>("#theme-pick")!;
document.body.dataset.uiTheme = store.read("uitheme", "notte");
themePick.value = document.body.dataset.uiTheme;
themePick.addEventListener("change", () => {
  document.body.dataset.uiTheme = themePick.value;
  store.write("uitheme", themePick.value);
});

langPick.addEventListener("change", () => {
  locale = langPick.value;
  store.write("lang", locale);
  // La lingua cambia il testo stampato: le tessere vanno ridisegnate.
  for (const tile of document.querySelectorAll<HTMLElement>(".tile")) delete tile.dataset.signature;
  paint();
});

// ---------------------------------------------------------------- avvio

setupPreview();
setStatus("offline", 0);
paint();
boot.remove();

// Strumento di servizio: ?preview=RBF-001 apre subito l'ingrandimento di una
// carta. Serve a controllare la resa su browser che non si lasciano guidare
// (Safari, iPad) senza dover pescare e passarci sopra.
const previewId = params.get("preview");
if (previewId) {
  tapPreview(document.querySelector<HTMLElement>(".toolbar")!, previewId, 0, defaultTheme(), locale);
}

// Ogni metà è alta due file di carte: sullo schermo non ci sta tutto. Si
// parte inquadrando la LINEA DI BATTAGLIA — il Fronte avversario sopra, il
// tuo subito sotto — così il proprio campo si vede senza scorrere; per le
// file di servizio si scorre, su o giù. In vista compatta il tavolo sta
// tutto nella finestra: non c'è proprio niente da scorrere.
const board = document.querySelector<HTMLElement>(".board")!;
function frameBoard(): void {
  if (isCompactView()) {
    board.scrollTop = 0;
    board.scrollLeft = 0;
    return;
  }
  // Lo scorrimento è in pixel di schermo: se la lavagna è disegnata in scala
  // (schermi stretti, vedi fitScale in table.ts), la misura canonica scala.
  const boardScale = Math.min(1, board.clientWidth / SURFACE_W);
  board.scrollTop = Math.max(0, (viewBattleTop(mySeat) - 40) * boardScale);
  board.scrollLeft = 0;
}
frameBoard();

if (roomInput.value) join(roomInput.value, relayInput.value);

// ------------------------------------------------------------ onboarding
// Al primo arrivo (nessuna stanza nota) il tavolo non si spiega da solo:
// il wizard accompagna dentro — stanza, poi nome e mazzo. Chi arriva con
// una stanza (salvata o da link d'invito) ma senza mazzo parte dal secondo
// passo; chi ha già tutto non lo vede.
const onboard = document.querySelector<HTMLElement>("#onboard")!;
const obStepRoom = document.querySelector<HTMLElement>("#ob-step-room")!;
const obStepProfile = document.querySelector<HTMLElement>("#ob-step-profile")!;
const obRoom = document.querySelector<HTMLInputElement>("#ob-room")!;
const obName = document.querySelector<HTMLInputElement>("#ob-name")!;
const obDeck = document.querySelector<HTMLSelectElement>("#ob-deck")!;
const obDeckB = document.querySelector<HTMLSelectElement>("#ob-deck-b")!;
const obDeckBLabel = document.querySelector<HTMLElement>("#ob-deck-b-label")!;
const obRoomNote = document.querySelector<HTMLElement>("#ob-room-note")!;

for (const option of deckPick.options) {
  obDeck.append(new Option(option.textContent ?? "", option.value));
  obDeckB.append(new Option(option.textContent ?? "", option.value));
}
if (myDeckId) obDeck.value = myDeckId;
// All'avversario locale un mazzo diverso dal tuo, se ce n'è più d'uno.
const otherDeck = allDecks().find(deck => deck.id !== obDeck.value);
if (otherDeck) obDeckB.value = otherDeck.id;

/** Vero quando si è entrati dal tasto «Gioca in locale»: si guidano entrambi i posti. */
let obLocalMode = false;

function obProfile(local = false): void {
  obLocalMode = local;
  onboard.hidden = false;
  obStepRoom.hidden = true;
  obStepProfile.hidden = false;
  obDeckB.hidden = !local;
  obDeckBLabel.hidden = !local;
  obName.value = store.read("name", "");
  const room = roomInput.value.trim();
  obRoomNote.hidden = !room && !local;
  obRoomNote.textContent = room
    ? `Sei nella stanza «${room}». Ancora due cose:`
    : local
      ? "Partita locale: guiderai entrambi i posti del tavolo."
      : "";
  obName.focus();
}

document.querySelector("#ob-create")!.addEventListener("click", () => {
  const name = `${GEMME[Math.floor(Math.random() * GEMME.length)]}-${Math.floor(1000 + Math.random() * 9000)}`;
  roomInput.value = name;
  join(name, relayInput.value);
  obProfile();
});

document.querySelector("#ob-join")!.addEventListener("click", () => {
  const room = obRoom.value.trim();
  if (!room) {
    obRoom.focus();
    return;
  }
  roomInput.value = room;
  join(room, relayInput.value);
  obProfile();
});
obRoom.addEventListener("keydown", event => {
  if (event.key === "Enter") document.querySelector<HTMLButtonElement>("#ob-join")!.click();
});

document.querySelector("#ob-local")!.addEventListener("click", () => obProfile(true));

document.querySelector("#ob-go")!.addEventListener("click", () => {
  const name = obName.value.trim();
  if (name) {
    store.write("name", name);
    dispatch({ t: "player", seat: mySeat, patch: { name } });
  }
  if (obDeck.value) {
    deckPick.value = obDeck.value;
    loadDeck(obDeck.value, mySeat);
  }
  if (obLocalMode) startLocalFoe(obDeckB.value);
  onboard.hidden = true;
});

/**
 * La partita locale siede anche l'altra metà del tavolo: mazzo caricato al
 * posto opposto e un nome al giocatore simulato. Il mazzo resta noto al
 * client: a «nuova partita» l'avversario locale si rimette in tavola da sé.
 */
function startLocalFoe(deckId: string): void {
  if (!deckId) return;
  localFoeDeckId = deckId;
  const foe = otherSeat(mySeat);
  dispatch({ t: "player", seat: foe, patch: { name: "Avversario" } });
  loadDeck(deckId, foe);
}

if (!roomInput.value.trim()) {
  onboard.hidden = false;
} else if (!myDeckId) {
  obProfile();
}
