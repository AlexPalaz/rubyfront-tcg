// Avvio del simulatore: mette insieme lavagna, pannello, chat e rete.
//
// Lo stato vive qui, in una variabile sola. Ogni modifica passa da `dispatch`,
// che fa tre cose nell'ordine: applica, ritrasmette, ridisegna. Non esiste
// altro modo di cambiare la partita — nemmeno per la rete, che entra dallo
// stesso imbuto.

import { mountChat } from "./chat.js";
import { SLOT_X, SURFACE_W, backRowY, viewBandTop, type Ctx } from "./ctx.js";
import { connect, DEFAULT_RELAY, type Net, type NetStatus } from "./net.js";
import { mountOverlay } from "./overlay.js";
import { tapPreview } from "./preview.js";
import { mountHud } from "./hud.js";
import { setupPreview } from "./preview.js";
import {
  allDecks,
  defaultTheme,
  getDeck,
  isRubyfront,
  loadRenderer,
} from "./renderer.js";
import { apply, newGame, shuffled, zoneCards } from "./state.js";
import { mountTable } from "./table.js";
import type { Action, CardInstance, GameState, Seat } from "./types.js";
import { SEATS } from "./types.js";

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

let state: GameState = newGame();
let mySeat: Seat = (params.get("seat") as Seat) ?? (store.read("seat", "a") as Seat);
if (!SEATS.includes(mySeat)) mySeat = "a";
let locale = params.get("lang") ?? store.read("lang", "it");
let net: Net | null = null;
/**
 * Il mazzo scelto resta noto al client anche dopo "nuova partita": a tavola
 * pulita ciascuno rimette in tavola il proprio, senza rifare la scelta.
 */
let myDeckId: string | null = store.read("deck", "") || null;

const themes: Record<Seat, string> = { a: defaultTheme(), b: defaultTheme() };

// ------------------------------------------------------------------ ctx

function dispatch(action: Action): void {
  state = apply(state, action);
  net?.send({ t: "action", action, from: mySeat });
  paint();
}

/** Applica senza ritrasmettere: per le azioni che arrivano già dalla rete. */
function receive(action: Action): void {
  state = apply(state, action);
  paint();
}

const ctx: Ctx = {
  state: () => state,
  dispatch,
  seat: () => mySeat,
  themeFor: seat => themes[seat],
  locale: () => locale,
  log(text, seat) {
    dispatch({
      t: "say",
      entry: { id: crypto.randomUUID(), seat: seat ?? null, kind: "log", text, ts: Date.now() },
    });
  },
};

// ----------------------------------------------------------------- viste

const table = mountTable(document.querySelector<HTMLElement>("#table")!, ctx);
const chat = mountChat(document.querySelector<HTMLElement>("#chat")!, ctx);
// La colonna è solo la chat; si apre e si chiude, e la scelta resta fra una
// partita e l'altra. Aperta la chat l'HUD si ritira: dall'HUD si apre con
// l'ingranaggio, dalla chat si chiude con la ×.
if (store.read("side", "open") === "closed") document.body.classList.add("side-closed");
function toggleSide(): void {
  const closed = document.body.classList.toggle("side-closed");
  store.write("side", closed ? "closed" : "open");
  unread = 0;
  paint();
}
const hud = mountHud(document.querySelector<HTMLElement>("#hud")!, ctx, toggleSide);
document.querySelector("#side-close")!.addEventListener("click", toggleSide);
const overlay = mountOverlay(ctx, () => paint());
table.onBrowse((seat, zone) => overlay.open(seat, zone));

/** Righe di chat arrivate a pannello chiuso: la spia sul tasto le conta. */
let unread = 0;
let seenChat = 0;

function paint(): void {
  syncThemes();
  // A pannello chiuso la chat non si vede: il tasto porta una spia, altrimenti
  // i messaggi dell'avversario passerebbero inosservati.
  const total = state.chat.length;
  if (document.body.classList.contains("side-closed")) unread += Math.max(0, total - seenChat);
  else unread = 0;
  seenChat = total;
  document.body.dataset.unread = unread > 0 ? String(unread) : "";
  table.render();
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

function loadDeck(deckId: string, seat: Seat): void {
  const cards = buildDeck(deckId, seat);
  if (!cards) return;
  myDeckId = deckId;
  store.write("deck", deckId);
  dispatch({ t: "loadDeck", seat, deckId, cards });
  const deck = getDeck(deckId);
  const name = deck?.locales[locale]?.name ?? deck?.locales[deck.defaultLocale]?.name ?? deckId;
  ctx.log(`Posto ${seat.toUpperCase()}: caricato «${name}» (${cards.length} carte).`, seat);
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

function join(room: string, relay: string): void {
  net?.close();
  net = null;
  if (!room.trim()) {
    setStatus("offline", 0);
    return;
  }
  store.write("room", room);
  store.write("relay", relay);
  net = connect(relay || DEFAULT_RELAY, room.trim(), mySeat, {
    onStatus: setStatus,
    onMessage(message) {
      if (message.t === "action") {
        // "Nuova partita" azzera il tavolo di entrambi: ognuno rimette poi il
        // proprio mazzo, perché il suo id è noto solo al suo client.
        receive(message.action);
        if (message.action.t === "newGame" && myDeckId) loadDeck(myDeckId, mySeat);
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
        state = message.state;
        paint();
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
relayInput.value = store.read("relay", DEFAULT_RELAY);

document.querySelector("#deck-load")!.addEventListener("click", () => loadDeck(deckPick.value, mySeat));

document.querySelector("#do-shuffle")!.addEventListener("click", () => {
  const order = shuffled(zoneCards(state, mySeat, "deck").map(card => card.uid));
  if (order.length === 0) return;
  dispatch({ t: "shuffle", seat: mySeat, order });
  ctx.log(`Posto ${mySeat.toUpperCase()} mescola il mazzo (${order.length} carte).`, mySeat);
});

document.querySelector("#do-draw")!.addEventListener("click", () => {
  if (zoneCards(state, mySeat, "deck").length === 0) {
    ctx.log(`Posto ${mySeat.toUpperCase()}: mazzo vuoto.`, mySeat);
    return;
  }
  dispatch({ t: "draw", seat: mySeat, count: 1 });
  ctx.log(`Posto ${mySeat.toUpperCase()} pesca 1 carta.`, mySeat);
});

document.querySelector("#do-search")!.addEventListener("click", () => overlay.open(mySeat, "deck"));

document.querySelector("#do-new")!.addEventListener("click", () => {
  if (!confirm("Nuova partita: tavolo, contatori e chat vengono azzerati. Procedo?")) return;
  dispatch({ t: "newGame" });
  if (myDeckId) loadDeck(myDeckId, mySeat);
});

document.querySelector("#do-push")!.addEventListener("click", () => {
  net?.send({ t: "state", state, from: mySeat });
  ctx.log("Lavagna inviata all'avversario.");
});

document.querySelector("#do-join")!.addEventListener("click", () => join(roomInput.value, relayInput.value));

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

// Ogni metà è alta due file di carte: sullo schermo non ci sta insieme
// all'altra. Si parte inquadrando la propria dall'alto — cioè dal Fronte, che
// è dove si gioca; per la fila di servizio si scorre giù, o si ripiega la mano
// col tasto "Mano".
const board = document.querySelector<HTMLElement>(".board")!;
// Lo scorrimento è in pixel di schermo: se la lavagna è disegnata in scala
// (schermi stretti, vedi fitScale in table.ts), la misura canonica va scalata.
const boardScale = Math.min(1, board.clientWidth / SURFACE_W);
board.scrollTop = Math.max(0, (viewBandTop(mySeat, mySeat) - 24) * boardScale);
board.scrollLeft = 0;

if (roomInput.value) join(roomInput.value, relayInput.value);
