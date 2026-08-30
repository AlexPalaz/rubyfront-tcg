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
});
document.querySelector("#side-close")!.addEventListener("click", toggleSide);
const overlay = mountOverlay(ctx, () => paint());
table.onBrowse((seat, zone) => overlay.open(seat, zone));

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
  net = connect(relay || DEFAULT_RELAY, room.trim(), mySeat, {
    onStatus: setStatus,
    onMessage(message) {
      if (message.t === "rtc") {
        if (message.from !== mySeat) voice.receive(message.payload as VoicePayload);
        return;
      }
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
        // La lavagna arrivata può non sapere come mi chiamo: glielo ridico.
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
  dispatch({ t: "newGame" });
  if (myDeckId) loadDeck(myDeckId, mySeat);
});

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
const obRoomNote = document.querySelector<HTMLElement>("#ob-room-note")!;

for (const option of deckPick.options) obDeck.append(new Option(option.textContent ?? "", option.value));
if (myDeckId) obDeck.value = myDeckId;

function obProfile(): void {
  onboard.hidden = false;
  obStepRoom.hidden = true;
  obStepProfile.hidden = false;
  obName.value = store.read("name", "");
  const room = roomInput.value.trim();
  obRoomNote.hidden = !room;
  obRoomNote.textContent = room ? `Sei nella stanza «${room}». Ancora due cose:` : "";
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

document.querySelector("#ob-local")!.addEventListener("click", () => obProfile());

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
  onboard.hidden = true;
});

if (!roomInput.value.trim()) {
  onboard.hidden = false;
} else if (!myDeckId) {
  obProfile();
}
