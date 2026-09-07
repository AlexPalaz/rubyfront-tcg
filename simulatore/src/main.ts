// Avvio del simulatore: mette insieme lavagna, pannello, chat e rete.
//
// Lo stato vive qui, in una variabile sola. Ogni modifica passa da `dispatch`,
// che fa tre cose nell'ordine: applica, ritrasmette, ridisegna. Non esiste
// altro modo di cambiare la partita — nemmeno per la rete, che entra dallo
// stesso imbuto.

// Il carattere dell'interfaccia (le carte hanno il loro, da card.css):
// Space Grotesk, self-hosted — un grottesco geometrico che fa da macchina
// attorno al manufatto delle carte.
import { lang, msg, setLang, t } from "./i18n.js";
import { renderLog } from "./log.js";
import { gameOverMsg } from "./turn.js";
import type { ChatEntry } from "./types.js";
import "@fontsource-variable/space-grotesk";
import { mountChat } from "./chat.js";
import { SLOT_X, SURFACE_W, backRowY, isCompactView, isRecessView, setViewMode, viewBattleTop, viewMode, type Ctx, type ViewMode } from "./ctx.js";
import { connectEngine, DEFAULT_ENGINE, type EngineLink, type EngineStatus, type EngineVerdict, verdictReason } from "./engine.js";
import { connect, DEFAULT_RELAY, type Net, type NetStatus } from "./net.js";
import { mountOverlay } from "./overlay.js";
import { tapPreview } from "./preview.js";
import { PHASE_BANNER_MS, mountPhaseBanner } from "./banner.js";
import { showRoll } from "./dice.js";
import { showEnterPeek } from "./effect.js";
import { mountHud } from "./hud.js";
import { playSound, setSoundEnabled, unlockSound } from "./sound.js";
import { endPhase } from "./turn.js";
import { chooseAttackers, chooseBlocks, chooseDiscards, choosePlay, freshMemory, pickBest, type BotMemory } from "./bot.js";
import { declareBlock } from "./combat.js";
import { setupPreview } from "./preview.js";
import { allDecks, cardName, cardStats, defaultTheme, enterEffects, getDeck, isRubyfront, loadRenderer } from "./renderer.js";
import { apply, controllerOf, freeFrontSlotOrNull, matterSpot, newGame, phaseCloser, seatLabel, shuffled, zoneCards } from "./state.js";
import { releaseHeld } from "./effects.js";
import { DRAW_STEP_MS, drawCascadeMs, mountTable } from "./table.js";
import { verdictByHp } from "./turn.js";
import { createVoice, type VoicePayload } from "./voice.js";
import type { Action, CardInstance, GameState, Seat, ZoneId } from "./types.js";
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

/** I testi fissi della pagina (index.html) portano la loro chiave in
    `data-i18n` (testo), `data-i18n-title`, `data-i18n-placeholder`. */
function applyHtmlLang(): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) el.textContent = t(el.dataset.i18n!);
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
    el.title = t(el.dataset.i18nTitle!);
    if (el.hasAttribute("aria-label")) el.setAttribute("aria-label", el.title);
  }
  for (const el of document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder!);
  document.documentElement.lang = lang();
}

/** Chi inizia, per ora a caso (§4: la scelta o il d20 arriveranno). */
function randomSeat(): Seat {
  return Math.random() < 0.5 ? "a" : "b";
}

let state: GameState = newGame(randomSeat());
let mySeat: Seat = (params.get("seat") as Seat) ?? (store.read("seat", "a") as Seat);
if (!SEATS.includes(mySeat)) mySeat = "a";
let locale = params.get("lang") ?? store.read("lang", "it");
// La lingua del tavolo: interfaccia, chat, sigilli — e le carte. Si fissa
// prima di costruire qualunque vista, e la pagina la applica ai suoi testi.
setLang(locale);
applyHtmlLang();
let net: Net | null = null;
/** Quanti client il relay conta nella stanza (me compreso), 0 se scollegati. */
let roomPeers = 0;
/**
 * Il tavolo si apre solo quando c'è anche l'altro giocatore: chi crea o
 * entra in una stanza resta all'accoglienza finché il relay conta due. Il
 * mazzo scelto si mette in tavola solo allora (deckDeferred), così
 * l'apertura — insegna, mano, carta del turno 1 — si vede insieme.
 */
let awaitingPeer = false;
let deckDeferred = false;
/** L'arbitro esterno (engine/): c'è solo se il flag nelle impostazioni è acceso. */
let engine: EngineLink | null = null;
/**
 * Il mazzo scelto resta noto al client anche dopo "nuova partita": a tavola
 * pulita ciascuno rimette in tavola il proprio, senza rifare la scelta.
 */
let myDeckId: string | null = store.read("deck", "") || null;
/**
 * Il mazzo del bot (senza stanza): c'è solo dopo «Gioca contro il bot», e
 * cade appena si entra in una stanza vera. Il bot rimette il suo mazzo da
 * sé a «Nuova partita».
 */
let botDeckId: string | null = null;
/** Il posto del bot, quando l'altra metà del tavolo la gioca lui (botTick). */
let botSeat: Seat | null = null;
// Lo stato della guida del bot (in fondo al file): sta qui in testa perché
// paint() chiama scheduleBot già durante il montaggio.
let botMemory: BotMemory = freshMemory(0);
let botBusy = false;
let botTimer: number | undefined;
/** Il passo del bot: un gesto ogni tanto, per farsi seguire. */
const BOT_PACE_MS = 750;

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
          // §6.5 — il Fine turno fermato dalla mano piena: l'Abisso di chi
          // chiude si accende e invita, così il sigillo dice anche DOVE si
          // scarta. Nessuna frase da leggere: il posto è quello che chiude
          // e ha più di 7 carte.
          if (action.t === "turn") {
            const closing = state.active;
            const held = Object.values(state.cards).filter(card => card.owner === closing && card.zone === "hand").length;
            // Il sigillo lo vede solo chi ha premuto: l'avversario resterebbe
            // ad aspettare un turno che non passa, senza sapere perché. La
            // riga in chat viaggia in rete e lo dice a entrambi, una volta
            // sola per ogni volta che l'avviso si accende.
            if (held > 7 && table.promptDiscard(closing)) {
              ctx.log(msg("log.discard.needed", { seat: closing, n: held }), closing);
            }
          }
          // Il bot che sbatte contro l'arbitro non mostra il sigillo a
          // chi guarda: prende nota (bot.ts, tried) e cambia gesto. Vale
          // per ogni gesto del suo posto, anche gli effetti risolti dopo.
          if (!(botSeat && actorFor(action) === botSeat)) engineStop(verdict);
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

/**
 * Il suono di un'azione, letto PRIMA che si applichi (serve la zona di
 * partenza): la carta posata sul Fronte dalla mano, l'attacco, il blocco, il
 * contrattacco. Vale per le azioni di chiunque — le proprie, quelle del bot,
 * quelle arrivate dalla rete — perché il suono è del tavolo, non del mouse.
 */
let lastDeclareAt = 0;
function cueFor(action: Action): void {
  // Le fasi non suonano (deciso 2026-09-07: «togli i suoni di ogni fase»);
  // i tasti di fase tengono lo scatto dei tasti.
  if (action.t === "declare") {
    lastDeclareAt = Date.now();
    playSound(action.declaration.kind === "attack" ? "attack" : action.declaration.kind === "block" ? "block" : "counter");
    return;
  }
  // L'annullamento è muto; il tap che segue una dichiarazione (l'attacco
  // tappa da sé) o un annullamento (che stappa) non suona: un suono solo.
  if (action.t === "undeclare") {
    lastDeclareAt = Date.now();
    return;
  }
  if (action.t === "tap") {
    if (Date.now() - lastDeclareAt < 600) return;
    playSound("tap");
    return;
  }
  if (action.t === "toZone" && action.zone === "field") {
    const card = state.cards[action.uid];
    if (card && card.zone === "hand") playSound("play");
    return;
  }
  // La pesca: un suono per carta, in cascata col ritmo con cui entrano in
  // mano (DRAW_STEP_MS, table.ts) — non più di quante ce ne sono nel mazzo.
  // Solo la PROPRIA: le carte dell'avversario (bot o rete) entrano nella
  // sua mano, che qui non si vede, e il suo fruscio sarebbe solo rumore.
  if (action.t === "draw" && action.seat === mySeat) {
    const available = zoneCards(state, action.seat, "deck").length;
    const count = Math.min(action.count, available);
    for (let i = 0; i < count; i += 1) window.setTimeout(() => playSound("draw"), i * DRAW_STEP_MS);
    return;
  }
  // La pesca del turno (§6.1) non è un'azione a sé: la fa il cambio di
  // turno, dentro l'azione `turn` (state.ts). Se chi entra sono io e il
  // mazzo non è vuoto, la carta che arriva suona come le altre.
  // La carta entra in mano quando l'insegna del turno se n'è andata
  // (table.ts): il suono la aspetta.
  if (action.t === "turn" && action.active === mySeat && zoneCards(state, mySeat, "deck").length > 0) {
    window.setTimeout(() => playSound("draw"), PHASE_BANNER_MS + 80);
  }
}

/** Applica, ritrasmette, ridisegna: l'azione ormai è passata. */
function commit(action: Action): void {
  cueFor(action);
  state = apply(state, action);
  net?.send({ t: "action", action, from: mySeat });
  paint();
  // §8.2 (RBF-018) — chi teneva un permanente nell'Abisso ha lasciato il
  // gioco: il permanente torna, e lo manda il tavolo che l'ha visto uscire.
  if (action.t !== "release" && Object.values(state.cards).some(card => card.heldBy && card.zone === "abisso" && state.cards[card.heldBy]?.zone !== "field")) {
    void releaseHeld(ctx, freeFrontSlotOrNull, matterSpot);
  }
  // §2 — la fine per PV si guarda dopo ogni azione applicata in locale
  // (la risoluzione, un contatore a mano): la dichiara il client che l'ha
  // vista arrivare, e l'engine la verifica sulla sua copia. Una volta sola.
  if (action.t === "gameOver") return;
  const over = verdictByHp(state);
  if (over) {
    void dispatch({ t: "gameOver", ...over }).then(passed => {
      if (!passed) return;
      const { title, detail } = gameOverMsg(over);
      ctx.log(msg("log.over", { title, detail }), over.winner);
    });
  }
}

/** Applica senza ritrasmettere: per le azioni che arrivano già dalla rete. */
function receive(action: Action, from: Seat): void {
  cueFor(action);
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
        who: t("scene.plays", { name: seatLabel(state, card.owner, mySeat), card: `«${cardName(card.cardId, locale)}»` }),
        effects: enterEffects(card.cardId, card.face, locale),
      });
    }
  }
  // Un effetto dell'avversario si vede anche qui: la fonte si accende, e se
  // ha un bersaglio la freccia lo indica — prima che la carta parta.
  if ((action.t === "draw" || action.t === "look") && action.effect) table.flash(action.effect.source);
  if (action.t === "look" && action.roll !== undefined) {
    const source = state.cards[action.effect.source];
    const look = source ? cardStats(source.cardId).enterLooks.find(entry => entry.die !== null) : undefined;
    if (look?.die) void showRoll(document.querySelector<HTMLElement>("#table")!, look.die, action.roll, "Quante carte guardare");
  }
  let fly: (() => void) | null = null;
  if (action.t === "control") {
    // Il controllo dell'avversario: la fonte si accende, la freccia indica
    // la carta presa, e la carta vola nello slot extra.
    table.strike(action.uid);
    table.flash(action.effect.source, 1600);
    fly = table.liftToFlight(action.uid);
  }
  if (action.t === "release") fly = table.liftToFlight(action.uid);
  if (action.t === "toZone" && action.effect) {
    const moving = state.cards[action.uid];
    table.flash(action.effect.source, 1600);
    if (action.zone === "field" && moving && moving.zone !== "field") {
      // Un ritorno dalla pila: il volo parte dopo che la carta è comparsa.
      const from = moving.zone;
      const owner = moving.owner;
      fly = () => table.flyFromPile(owner, from, action.uid);
    } else {
      table.strike(action.uid);
      fly = table.liftForFlight(action.uid);
    }
  }
  // Il tiro del dado dell'avversario si vede anche qui: la carta scende
  // insieme, ma il momento è lo stesso.
  if (action.t === "move" && action.roll !== undefined) {
    const die = cardStats(state.cards[action.uid]?.cardId ?? "").deployment?.die ?? 6;
    void showRoll(document.querySelector<HTMLElement>("#table")!, die, action.roll, t("dice.deploy"));
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
 * In rete è sempre questo client, cioè il suo posto. Col bot al tavolo i
 * gesti passano di qui per entrambi i posti: l'attore è allora il
 * proprietario della carta toccata, o il posto del contatore o del mazzo —
 * e per i gesti senza posto (fase, turno) chi è di turno. Un passo
 * d'effetto è di chi comanda la fonte dell'effetto (vedi sotto), non della
 * carta che lo subisce.
 */
function actorFor(action: Action): Seat {
  if (botDeckId === null) return mySeat;
  // Un passo d'effetto è di chi comanda la FONTE dell'effetto, qualunque
  // carta tocchi: mandare nell'Abisso un'Entità avversaria è un gesto di
  // chi ha giocato la carta che lo fa, non dell'avversario che la subisce.
  // Senza questo l'arbitro fermava il passo con «non tocca a te».
  if ("effect" in action && action.effect) {
    const source = state.cards[action.effect.source];
    if (source) return controllerOf(source);
  }
  if ("uid" in action) {
    const card = state.cards[action.uid];
    return card ? controllerOf(card) : state.active;
  }
  if ("from" in action) {
    const card = state.cards[action.from];
    return card ? controllerOf(card) : state.active;
  }
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
  // Il mouse governa solo il proprio posto: l'altra metà è di chi c'è
  // (in rete) o del bot.
  controls: seat => seat === mySeat,
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
      fluxCost: stats.fluxCost,
      keywords: stats.keywords,
      enterListeners: stats.enterListeners,
      enterMoves: stats.enterMoves,
      behavior: stats.behavior,
      enterReturns: stats.enterReturns,
      enterLooks: stats.enterLooks,
      enterControls: stats.enterControls,
      enterRefreshes: stats.enterRefreshes,
      attackReturns: stats.attackReturns,
      attackDraws: stats.attackDraws,
      attackForms: stats.attackForms,
      staticForms: stats.staticForms,
      resolveForms: stats.resolveForms,
      flipForms: stats.flipForms,
      nexus: stats.nexus,
      grantsWhileAssigned: stats.grantsWhileAssigned,
    };
  },
  log(text, seat) {
    // Una chiave viaggia come tale (chi legge la rende nella sua lingua);
    // il testo reso qui è il ripiego per chi non la conosce.
    const entry: ChatEntry =
      typeof text === "string"
        ? { id: crypto.randomUUID(), seat: seat ?? null, kind: "log", text, ts: Date.now() }
        : {
            id: crypto.randomUUID(),
            seat: seat ?? null,
            kind: "log",
            key: text.key,
            ...(text.params ? { params: text.params } : {}),
            text: renderLog(text, state, id => cardName(id, locale)),
            ts: Date.now(),
          };
    dispatch({ t: "say", entry });
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

// La vista va decisa prima di montare il tavolo: le zone nascono già con la
// geometria giusta. Di default il rincasso — carte intere ovunque e tutto in
// vista; chi ha scelto un'altra vista la ritrova.
const savedView = store.read("view", "");
setViewMode(savedView === "full" || savedView === "compact" || savedView === "recess" ? savedView : "recess");

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
  paint();
}
// Turno, gesto di fase, Evoca, chat e microfono stanno in header; le targhe
// dei posti sull'orlo dei campi (table.onStats, sotto). L'overlay è montato
// poche righe sotto: ai click esiste già.
const hud = mountHud(ctx, {
  chat: toggleSide,
  voice: async () => {
    const before = voice.enabled();
    await voice.toggle();
    const after = voice.enabled();
    document.body.dataset.voice = after ? "on" : "";
    if (before !== after) {
      ctx.log(msg("log.mic", { seat: mySeat, onoff: msg(after ? "mic.on" : "mic.off") }), mySeat);
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
table.onStats(hud.chip);
document.querySelector("#side-close")!.addEventListener("click", toggleSide);
const overlay = mountOverlay(ctx, () => paint());
table.onBrowse((seat, zone) => overlay.open(seat, zone));
table.onPick((seat, zone, candidates, title, visible) => overlay.pick(seat, zone, candidates, title, visible));

/** Righe arrivate a chat chiusa: due spie — messaggi (blu) e azioni (oro). */
let unreadChat = 0;
let seenChat = 0;

function paint(): void {
  syncThemes();
  // A chat chiusa il tasto porta la spia dei messaggi non letti, altrimenti
  // ciò che arriva passerebbe inosservato. Contano solo i messaggi
  // dell'AVVERSARIO: i propri non sono notizie. La cronaca delle azioni
  // non si stampa più in chat, e non ha spia.
  const chats = state.chat.filter(entry => entry.kind === "chat" && entry.seat && entry.seat !== mySeat).length;
  if (document.body.classList.contains("side-closed")) unreadChat += Math.max(0, chats - seenChat);
  else unreadChat = 0;
  seenChat = chats;
  document.body.dataset.unread = unreadChat > 0 ? String(unreadChat) : "";
  // L'insegna PRIMA del tavolo: la mano legge se c'è una scritta in corso
  // per trattenere la carta del turno (data-announce-until).
  banner.render();
  table.render();
  chat.render();
  hud.render();
  scheduleBot();
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
/** L'apertura (§4) di un posto è in arrivo: il bot aspetta che sia passata. */
const openingPending: Record<Seat, boolean> = { a: false, b: false };

/** Quante carte ha in mano quel posto, adesso. */
/** Il mazzo è ancora intero: tutte le carte del posto, Rubyfront a parte, stanno lì. */
function deckUntouched(seat: Seat): boolean {
  const mine = Object.values(state.cards).filter(card => card.owner === seat && !isRubyfront(card.cardId));
  return mine.length > 0 && zoneCards(state, seat, "deck").length === mine.length;
}

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
  // §3.1 — i PV con cui si inizia sono quelli stampati sul Rubyfront del
  // mazzo: viaggiano nell'azione, e l'engine li confronta con l'anagrafe.
  const rubyfront = cards.find(card => isRubyfront(card.cardId));
  const hp = rubyfront ? cardStats(rubyfront.cardId).health : null;
  dispatch({ t: "loadDeck", seat, deckId, cards, ...(hp === null ? {} : { hp }) });
  const deck = getDeck(deckId);
  const name = deck?.locales[locale]?.name ?? deck?.locales[deck.defaultLocale]?.name ?? deckId;
  ctx.log(msg("log.loaded", { seat, name, n: cards.length }), seat);
  // L'apertura è una fila di tre tempi: l'insegna «Fase di Preparazione»
  // al centro del tavolo; poi, mentre svanisce, la mano iniziale; poi, a
  // cascata finita più un respiro, la carta del turno 1 di chi apre. Ogni
  // tempo controlla che il tavolo sia ancora quello (stesso mazzo, mano
  // com'era attesa): a mazzo ricaricato o partita nuova, la fila si lascia
  // cadere. Il mazzo dell'avversario locale passa di qui subito dopo il
  // proprio: l'insegna riparte da capo, e non si vede.
  banner.announce();
  scheduleOpening(seat, deckId);
}

/** La mano iniziale e la carta del turno 1 (§4, §6.1), a tempo dopo l'insegna. */
function scheduleOpening(seat: Seat, deckId: string): void {
  window.clearTimeout(openingTimer[seat]);
  openingPending[seat] = true;
  openingTimer[seat] = window.setTimeout(() => {
    openingPending[seat] = false;
    if (state.players[seat].deckId !== deckId || handSize(seat) !== 0) return;
    // §4, mano iniziale: «prima che inizi il primo turno, entrambi i
    // giocatori pescano 6 carte». Il mazzo esce da buildDeck già mescolato,
    // quindi la pesca parte da sola — a ogni via d'inizio (bot,
    // stanza, Nuova partita), perché tutte passano di qui. Il mulligan (§4,
    // punto 5) resta un gesto manuale: «Mescola» e poi «Pesca 6» dal mazzo.
    void dispatch({ t: "draw", seat, count: 6 });
    // §6.1 — «la pesca non si salta mai», nemmeno al primo turno di chi
    // inizia: il posto di turno pesca anche la carta del turno 1. In rete
    // ci pensa il client che governa quel posto: ognuno carica il proprio
    // mazzo, e solo chi apre passa di qui con `active` suo.
    const opening = seat === state.active;
    ctx.log(msg("log.opening", { seat }), seat);
    if (!opening) return;
    openingPending[seat] = true;
    openingTimer[seat] = window.setTimeout(() => {
      openingPending[seat] = false;
      const untouched = state.players[seat].deckId === deckId && state.active === seat && handSize(seat) === 6;
      if (untouched) void dispatch({ t: "draw", seat, count: 1 });
    }, drawCascadeMs(6) + OPENING_DRAW_PAUSE_MS);
  }, PHASE_BANNER_MS + 80);
}

// ----------------------------------------------------------------- rete

function setStatus(status: NetStatus, peers: number): void {
  const dot = document.querySelector<HTMLElement>("#net-dot")!;
  dot.dataset.status = status;
  dot.title = status === "online" ? t("net.online", { n: peers }) : t(status === "connecting" ? "net.connecting" : "net.offline");
  roomPeers = status === "online" ? peers : 0;
  obWaitText.textContent = t(status === "online" ? "html.ob.wait.alone" : "html.ob.wait.connecting");
  if (awaitingPeer && roomPeers >= 2) seatTable();
}

// L'accoglienza sta in fondo al file, ma il passo d'attesa serve già qui:
// setStatus parte con la prima join, prima che il wizard sia montato.
const onboard = document.querySelector<HTMLElement>("#onboard")!;
const obStepWait = document.querySelector<HTMLElement>("#ob-step-wait")!;
const obWaitNote = document.querySelector<HTMLElement>("#ob-wait-note")!;
const obWaitText = document.querySelector<HTMLElement>("#ob-wait-text")!;

/** Si resta all'accoglienza finché nella stanza non c'è anche l'altro. */
function waitForPeer(): void {
  awaitingPeer = true;
  obWaitNote.textContent = t("html.ob.wait.note", { room: roomInput.value.trim() });
  for (const step of onboard.querySelectorAll<HTMLElement>("[id^='ob-step-']")) step.hidden = step !== obStepWait;
  onboard.hidden = false;
}

/** L'altro è entrato: si va al tavolo, e il mazzo rimandato si mette giù. */
function seatTable(): void {
  awaitingPeer = false;
  onboard.hidden = true;
  obStepWait.hidden = true;
  if (deckDeferred && myDeckId) loadDeck(myDeckId, mySeat);
  deckDeferred = false;
}

/** Il mazzo va in tavola ora, oppure quando arriva l'altro giocatore. */
function seatOrWait(): void {
  if (net && roomPeers < 2) {
    deckDeferred = true;
    waitForPeer();
    return;
  }
  if (myDeckId) loadDeck(myDeckId, mySeat);
}

let seatClashWarned = false;
function warnSeatClash(): void {
  if (seatClashWarned) return;
  seatClashWarned = true;
  ctx.log(t("log.seatclash", { seat: mySeat.toUpperCase() }));
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
  // In una stanza vera l'altra metà del tavolo è di qualcuno: il bot si
  // alza — via le sue carte e il suo nome, il posto torna «In attesa…» per
  // chi arriva. (La rete qui è già chiusa: il congedo resta locale.)
  if (botDeckId) {
    botDeckId = null;
    botSeat = null;
    table.setAuto(null, botChooser);
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
        // La mano iniziale che manca (§4): la lavagna arrivata ha il mio
        // mazzo ma non la mia mano — la pagina è stata ricaricata prima che
        // la pesca d'apertura partisse, che è un tempo del client e non
        // un'azione della lavagna. Al turno 1 in Preparazione, a mazzo
        // intero, la pesca riparte da qui; altrimenti la mano vuota è vera.
        else if (incomingHasMine && myDeckId && state.players[mySeat].deckId === myDeckId && handSize(mySeat) === 0 && state.turn === 1 && state.phase === "preparazione" && deckUntouched(mySeat)) {
          scheduleOpening(mySeat, myDeckId);
        }
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
  ctx.log(msg("log.shuffle", { seat: mySeat, n: order.length }), mySeat);
}

function doDraw(): void {
  if (zoneCards(state, mySeat, "deck").length === 0) {
    ctx.log(msg("log.deck.empty.short", { seat: mySeat }), mySeat);
    return;
  }
  dispatch({ t: "draw", seat: mySeat, count: 1 });
  ctx.log(msg("log.draw1", { seat: mySeat }), mySeat);
}

document.querySelector("#do-new")!.addEventListener("click", () => {
  if (!confirm(t("html.newgame.confirm"))) return;
  const starter = randomSeat();
  void dispatch({ t: "newGame", active: starter }).then(passed => {
    if (!passed) return;
    ctx.log(msg("log.newgame", { seat: starter }));
  });
  // In stanza, senza l'altro giocatore, la partita nuova aspetta lui: si
  // torna all'attesa e il mazzo si rimette quando entra.
  seatOrWait();
  reapplyName();
  if (botDeckId) startBot(botDeckId);
});

/** La nuova partita azzera anche i nomi: il proprio si rimette da sé. */
function reapplyName(): void {
  const myName = store.read("name", "");
  if (myName) dispatch({ t: "player", seat: mySeat, patch: { name: myName } });
}

document.querySelector("#do-push")!.addEventListener("click", () => {
  net?.send({ t: "state", state, from: mySeat });
  ctx.log(msg("log.sent"));
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
async function copyInvite(button: HTMLButtonElement, resetKey: string): Promise<void> {
  const room = roomInput.value.trim();
  if (!room) return;
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("room", room);
  url.searchParams.set("seat", otherSeat(mySeat));
  if (relayInput.value && relayInput.value !== DEFAULT_RELAY) url.searchParams.set("relay", relayInput.value);
  try {
    await navigator.clipboard.writeText(url.href);
    button.textContent = t("copied");
  } catch {
    // Niente clipboard (contesto non sicuro): almeno si vede il link.
    prompt(t("invite.prompt"), url.href);
    return;
  }
  window.setTimeout(() => (button.textContent = t(resetKey)), 1600);
}
document.querySelector("#room-invite")!.addEventListener("click", function (this: HTMLButtonElement) {
  void copyInvite(this, "copylink");
});
document.querySelector("#ob-wait-invite")!.addEventListener("click", function (this: HTMLButtonElement) {
  void copyInvite(this, "html.ob.wait.invite");
});
document.querySelector("#ob-wait-leave")!.addEventListener("click", () => leaveTable());

// Il fermo dell'arbitro: una regola ha bloccato l'azione. Non un alert da
// browser ma un sigillo del gioco — la gemma del marchio, il motivo in
// prosa, il riferimento al manuale su una targhetta. Il gesto non è
// avvenuto e lo si deve sapere subito: sta sopra tutto e si chiude col
// tasto, con Esc o con un click sul fondo.
function engineStop(verdict: EngineVerdict): void {
  document.querySelector(".engine-stop")?.remove();
  const raw = verdictReason(verdict) ?? t("stop.default", { action: verdict.action ?? "?" });
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
  title.textContent = t("stop.title");

  const reason = document.createElement("p");
  reason.className = "engine-stop-text";
  reason.textContent = prose.endsWith(".") ? prose : `${prose}.`;

  const okay = document.createElement("button");
  okay.type = "button";
  okay.className = "engine-stop-ok";
  okay.textContent = t("stop.ok");

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
    badge.textContent = `${t("stop.ref", { ref: ref[1] })}${ref[2] ? ` — ${ref[2]}` : ""}`;
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
// Un indirizzo salvato in `ws://` su una pagina https non può funzionare
// (contenuto misto): si torna al default di produzione.
const savedEngineUrl = store.read("engineUrl", "");
engineUrlInput.value = savedEngineUrl && !(location.protocol === "https:" && savedEngineUrl.startsWith("ws://")) ? savedEngineUrl : DEFAULT_ENGINE;

function setEngineStatus(status: EngineStatus): void {
  engineDot.dataset.status = status;
  engineDot.title = t(`engine.${status === "online" ? "online" : status === "connecting" ? "connecting" : "offline"}`);
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
      // In chat solo l'essenziale: la lista delle regole attive resta nel
      // protocollo, non nello storico della partita.
      ctx.log(msg("log.engine.hello", { version }));
    },
    onVerdict(verdict) {
      // Qui arrivano solo le occhiate sulle azioni AVVERSARIE (receive): già
      // applicate dal client di là, non si possono fermare — una violazione
      // si annota in chat e basta.
      if (!verdict.ruled || verdict.ok) return;
      const reason = verdictReason(verdict);
      ctx.log(msg("log.engine.violation", { action: verdict.action ?? "?", reason: reason ? ` — ${reason}` : "" }));
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

// Vista compatta: tessere (illustrazione, nome, costo, Potenza) al posto
// delle carte, tavolo tutto in vista senza scorrere. Il testo di regole
// resta al passaggio del mouse (o al tap). Cambio a caldo: si rifà la sola
// geometria di vista, e le tessere si ridisegnano.
const viewPick = document.querySelector<HTMLSelectElement>("#view-pick")!;
viewPick.value = viewMode();
viewPick.addEventListener("change", () => {
  setViewMode(viewPick.value as ViewMode);
  store.write("view", viewPick.value);
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
// Il chiaro è il tema di casa (scelta del designer, 2026-09-07): chi non ha
// mai scelto lo trova, e un tema salvato da prima che non esiste più
// (rubino, smeraldo, solarizzato…) ricade sul chiaro. Chi ha scelto il
// Notte se lo tiene.
const savedTheme = store.read("uitheme", "chiaro");
const themePick = document.querySelector<HTMLSelectElement>("#theme-pick")!;
const knownTheme = [...themePick.options].some(option => option.value === savedTheme);
document.body.dataset.uiTheme = knownTheme ? savedTheme : "chiaro";
themePick.value = document.body.dataset.uiTheme;
themePick.addEventListener("change", () => {
  document.body.dataset.uiTheme = themePick.value;
  store.write("uitheme", themePick.value);
});

langPick.addEventListener("change", () => {
  store.write("lang", langPick.value);
  // La lingua veste ogni scritta del tavolo, molte stampate una volta sola
  // all'avvio: la pagina riparte, e rientra da sé nella stanza salvata.
  location.reload();
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
// file di servizio si scorre, su o giù. In compatta e in rincasso il tavolo
// sta tutto nella finestra: non c'è proprio niente da scorrere.
const board = document.querySelector<HTMLElement>(".board")!;
function frameBoard(): void {
  if (isCompactView() || isRecessView()) {
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

/** Da dove si è entrati: una stanza, o «Gioca contro il bot» (l'altra metà
    la gioca lui, e serve anche il suo mazzo). */
let obMode: "net" | "bot" = "net";

function obProfile(mode: "net" | "bot" = "net"): void {
  obMode = mode;
  const twoDecks = mode === "bot";
  onboard.hidden = false;
  obStepRoom.hidden = true;
  obStepWait.hidden = true;
  obStepProfile.hidden = false;
  obDeckB.hidden = !twoDecks;
  obDeckBLabel.hidden = !twoDecks;
  obName.value = store.read("name", "");
  const room = roomInput.value.trim();
  obRoomNote.hidden = !room && !twoDecks;
  obRoomNote.textContent = room ? t("html.ob.room.note", { room }) : mode === "bot" ? t("html.ob.bot.note") : "";
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

document.querySelector("#ob-bot")!.addEventListener("click", () => obProfile("bot"));

document.querySelector("#ob-go")!.addEventListener("click", () => {
  const name = obName.value.trim();
  if (name) {
    store.write("name", name);
    dispatch({ t: "player", seat: mySeat, patch: { name } });
  }
  if (obDeck.value) {
    deckPick.value = obDeck.value;
    myDeckId = obDeck.value;
    store.write("deck", obDeck.value);
  }
  onboard.hidden = true;
  if (obMode === "bot") startBot(obDeckB.value);
  // In stanza il tavolo si apre solo quando c'è anche l'altro giocatore:
  // il mazzo si mette giù ora o al suo arrivo.
  if (obMode === "net") seatOrWait();
  else if (myDeckId) loadDeck(myDeckId, mySeat);
});

/**
 * «Esci dal tavolo»: si lascia la stanza (o si congeda il bot), il tavolo
 * si azzera e si torna all'accoglienza, al primo passo.
 * La stanza salvata si dimentica: alla prossima visita si sceglie di nuovo.
 * Il proprio nome e il proprio mazzo restano ricordati.
 */
function leaveTable(): void {
  window.clearTimeout(botTimer);
  awaitingPeer = false;
  deckDeferred = false;
  botSeat = null;
  table.setAuto(null, botChooser);
  botDeckId = null;
  join("", relayInput.value);
  store.write("room", "");
  roomInput.value = "";
  obRoom.value = "";
  void dispatch({ t: "newGame", active: randomSeat() });
  const foe = otherSeat(mySeat);
  void dispatch({ t: "player", seat: foe, patch: { name: "" } });
  reapplyName();
  onboard.hidden = false;
  obStepRoom.hidden = false;
  obStepProfile.hidden = true;
  obStepWait.hidden = true;
  settingsPanel.hidden = true;
  paint();
}

// I suoni: il contesto audio nasce al primo tocco (il browser non suona
// prima di un gesto), ogni tasto fa il suo scatto, e l'interruttore nelle
// impostazioni spegne tutto — la scelta resta salvata.
document.addEventListener("pointerdown", () => unlockSound(), { capture: true });
document.addEventListener(
  "click",
  event => {
    const button = (event.target as HTMLElement | null)?.closest?.("button");
    if (button && !button.disabled) playSound("button");
  },
  { capture: true }
);
const soundToggle = document.querySelector<HTMLInputElement>("#sound-toggle")!;
soundToggle.checked = store.read("sound", "on") !== "off";
setSoundEnabled(soundToggle.checked);
soundToggle.addEventListener("change", () => {
  setSoundEnabled(soundToggle.checked);
  store.write("sound", soundToggle.checked ? "on" : "off");
  if (soundToggle.checked) playSound("button");
});

document.querySelector("#do-leave")!.addEventListener("click", () => {
  if (!confirm(t("html.leave.confirm"))) return;
  leaveTable();
});

// ------------------------------------------------------------------ il bot
//
// L'avversario automatico siede all'altra metà del tavolo — il suo mazzo
// caricato al posto opposto, una partita senza stanza — e la gioca lui. Le decisioni stanno in bot.ts (pure); qui la
// guida: a ogni ridisegno, se è il suo momento, compie UN gesto — con le
// stesse azioni e lo stesso arbitro di un giocatore — poi ridisegna e
// riparte. Per i gesti del suo posto mira e conferme del tavolo rispondono
// da sole (table.setAuto: legato al posto, così vale anche per gli effetti
// che si risolvono a scena chiusa) e i «no» dell'arbitro non mostrano il
// sigillo: il bot prende nota e cambia gesto. Le SCENE delle sue carte
// invece le chiude il giocatore, con Continua o Risolvi: finché la scena è
// aperta il tavolo non è fermo, e il bot aspetta.

function startBot(deckId: string): void {
  if (!deckId) return;
  botDeckId = deckId;
  botSeat = otherSeat(mySeat);
  botMemory = freshMemory(state.turn);
  // Le scelte automatiche sono legate al posto del bot, non al momento:
  // valgono anche per gli effetti che si risolvono a scena chiusa.
  table.setAuto(botSeat, botChooser);
  dispatch({ t: "player", seat: botSeat, patch: { name: t("bot.name") } });
  loadDeck(deckId, botSeat);
  scheduleBot();
}

function scheduleBot(delay = BOT_PACE_MS): void {
  if (!botSeat) return;
  window.clearTimeout(botTimer);
  botTimer = window.setTimeout(() => void botTick(), delay);
}

/** Il tavolo è fermo: nessuna scena, nessun dado, nessuna mira, nessun effetto in corso. */
function tableQuiet(): boolean {
  return (
    // L'insegna di fase ferma tutti, bot compreso (banner.ts).
    !document.body.classList.contains("is-announcing") &&
    !document.body.classList.contains("is-resolving") &&
    !document.body.classList.contains("is-targeting") &&
    !document.querySelector(".effect-veil, .effect-confirm, .dice-roll")
  );
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));

async function awaitQuiet(limit = 15_000): Promise<void> {
  const start = Date.now();
  while (!tableQuiet() && Date.now() - start < limit) await sleep(120);
}

const botChooser = {
  pickTarget: (_source: CardInstance, candidates: CardInstance[]) => (botSeat ? pickBest(state, botSeat, candidates, ctx.card) : null),
  pickFromPile: (zone: ZoneId, candidates: CardInstance[]) =>
    botSeat ? pickBest(state, botSeat, candidates, ctx.card, zone === "hand" ? "weakest" : "auto") : null,
};

async function botTick(): Promise<void> {
  if (!botSeat || botBusy || state.over) return;
  // Le aperture (§4) prima di tutto: senza, il bot chiudeva il primo turno
  // a mano vuota e la sua pesca iniziale arrivava nel turno altrui.
  if (!tableQuiet() || openingPending.a || openingPending.b) {
    scheduleBot(500);
    return;
  }
  if (state.turn !== botMemory.turn) botMemory = freshMemory(state.turn);
  botBusy = true;
  let again = false;
  try {
    again = await botStep(botSeat);
    await awaitQuiet();
  } catch (error) {
    console.warn("bot", error);
  } finally {
    botBusy = false;
  }
  if (again) scheduleBot();
}

/** Un gesto del bot. Torna vero se ha fatto qualcosa e potrebbe farne altro. */
async function botStep(bot: Seat): Promise<boolean> {
  const s = state;
  // §7.2 — la catena: quando la parola è sua, passa (le Reattive aspettano
  // una difficoltà più alta); mentre si risolve, aspetta.
  if (s.chain) {
    if (!s.chain.resolving && s.chain.turn === bot) {
      await dispatch({ t: "pass", seat: bot });
      return true;
    }
    return false;
  }
  if (s.active === bot) {
    if (s.phase === "preparazione") {
      if (await table.deployRubyfront(bot)) return true;
      const play = choosePlay(s, bot, ctx.card, botMemory);
      if (play) {
        if (play.useToken) {
          const player = s.players[bot];
          await dispatch({ t: "player", seat: bot, patch: { token: false, flux: player.flux + 1 } });
          ctx.log(msg("log.token.spend", { seat: bot }), bot);
        }
        const ok = play.kind === "object" ? await table.assignObject(play.card, play.to) : await table.playFromHand(play.card, play.spot);
        if (!ok) botMemory.tried.add(play.card.uid);
        else if (play.kind === "entity") botMemory.entered.add(play.card.uid);
        return true;
      }
      // §6.5 — sotto i 7 prima di chiudere: chi chiude a mano piena non chiude.
      const [discard] = chooseDiscards(s, bot, ctx.card);
      if (discard) {
        await dispatch({ t: "toZone", uid: discard.uid, zone: "abisso" });
        ctx.log(msg("log.discard", { seat: bot, card: discard.cardId, n: zoneCards(state, bot, "hand").length }), bot);
        return true;
      }
      await endPhase(ctx);
      return true;
    }
    if (s.phase === "fronte") {
      if (!botMemory.attacked) {
        botMemory.attacked = true;
        for (const attacker of chooseAttackers(s, bot, ctx.card, botMemory)) {
          await table.attackWith(attacker);
          await awaitQuiet();
          await sleep(350);
        }
        return true;
      }
      await endPhase(ctx);
      return true;
    }
    // Reazione: difende l'altro, e chiude lui (§6.4).
    return false;
  }
  if (s.phase === "reazione") {
    if (!botMemory.blocked) {
      botMemory.blocked = true;
      for (const block of chooseBlocks(s, bot, ctx.card)) {
        await declareBlock(ctx, block.blocker, block.attacker.uid, block.kind);
        await sleep(450);
      }
      return true;
    }
    // Un respiro perché chi attacca veda i blocchi, poi la risoluzione.
    await sleep(1200);
    await endPhase(ctx);
    return true;
  }
  return false;
}

if (!roomInput.value.trim()) {
  onboard.hidden = false;
} else if (!myDeckId) {
  obProfile();
}
