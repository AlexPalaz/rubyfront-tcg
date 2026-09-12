// Avvio del simulatore: mette insieme lavagna, pannello, chat e tavolo.
//
// Lo stato vive nella sessione (@rubyfront/core/session): ogni modifica
// passa dal suo `dispatch`, che chiede il verdetto al tavolo, applica e fa
// ridisegnare. Qui c'è la vista — ciò che la sessione chiede di mostrare
// (SessionView) e i gesti della pagina: home, accoglienza, impostazioni.

// Il carattere dell'interfaccia (le carte hanno il loro, da card.css):
// Space Grotesk, self-hosted — un grottesco geometrico che fa da macchina
// attorno al manufatto delle carte.
import { lang, msg, setLang, t } from "@rubyfront/core/i18n";
import "@fontsource-variable/space-grotesk";
import { mountChat } from "./chat.js";
import { SURFACE_W, isCompactView, isRecessView, setViewMode, viewBattleTop, viewMode, type ViewMode } from "./ctx.js";
import { defaultEngineUrl, type EngineStatus, type EngineVerdict, verdictReason } from "@rubyfront/core/engine";
import { clashesOf as clashesOfState, fallenOf as fallenOfState, type Clash } from "@rubyfront/core/clashes";
import { createSession, type SessionView } from "@rubyfront/core/session";
import { mountLegend } from "./legend.js";
import { mountOverlay } from "./overlay.js";
import { tapPreview } from "./preview.js";
import { PHASE_BANNER_MS, mountPhaseBanner } from "./banner.js";
import { showRoll } from "./dice.js";
import { showEnterEffect, showEnterPeek } from "./effect.js";
import { mountHud } from "./hud.js";
import { musicState, playSound, setMusicEnabled, setSoundEnabled, startMusic, stopMusic, unlockSound } from "./sound.js";
import { setupPreview } from "./preview.js";
import { mountDeckView } from "./decks";
import { askConfirm } from "./ask.js";
import { allDecks, artUrl, cardName, cardStats, defaultTheme, enterEffects, getDeck, loadRenderer } from "./renderer.js";
import { playSpot, seatLabel, zoneCards } from "@rubyfront/core/state";
import { DRAW_STEP_MS, drawCascadeMs, mountTable } from "./table.js";
import { createVoice, type VoicePayload } from "./voice.js";
import type { Action, Seat } from "@rubyfront/core/types";
import { SEATS, otherSeat } from "@rubyfront/core/types";

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

// Il posto non si sceglie: chi crea la stanza è A, chi entra (a mano o dal
// link d'invito, che porta `seat`) è B; contro il bot si è A. Resta salvato
// con la stanza, e il cambio passa da una ricarica (enterRoomAs).
let mySeat: Seat = (params.get("seat") as Seat) ?? (store.read("seat", "a") as Seat);
if (!SEATS.includes(mySeat)) mySeat = "a";
let locale = params.get("lang") ?? store.read("lang", "it");
// La lingua del tavolo: interfaccia, chat, sigilli — e le carte. Si fissa
// prima di costruire qualunque vista, e la pagina la applica ai suoi testi.
setLang(locale);
applyHtmlLang();

// Il tavolo: l'arbitro esterno, sempre acceso (deciso 2026-09-09: via
// l'interruttore e il campo dell'indirizzo dalle impostazioni) e dal
// 2026-09-11 l'unico a scrivere lo stato. Giudica ogni azione PRIMA che si
// applichi (session.ts, dispatch) e inoltra lui quelle approvate
// all'avversario, che arrivano da `onAction` (receive). Senza un tavolo raggiungibile
// la spia va in rosso: nella stanza «solo» il tavolo resta libero, in
// stanza si aspetta. L'indirizzo è quello di produzione (DEFAULT_ENGINE),
// o ?engine= per le prove; un ws:// su una pagina https non può
// funzionare (contenuto misto) e si ignora.
const engineDot = document.querySelector<HTMLElement>("#engine-dot")!;
// Il tavolo di default (engine.ts, defaultEngineUrl): quello di produzione su
// una pagina https, quello di fianco (porta 8788) in sviluppo;
// VITE_ENGINE_URL al build vince su tutto.
const DEFAULT_ENGINE = defaultEngineUrl(location, import.meta.env.VITE_ENGINE_URL as string | undefined);
const engineParam = params.get("engine")?.trim() ?? "";
const engineUrl = engineParam && !(location.protocol === "https:" && engineParam.startsWith("ws://")) ? engineParam : DEFAULT_ENGINE;

/** Pausa tra la fine della cascata iniziale e la carta del turno 1. */
const OPENING_DRAW_PAUSE_MS = 250;

// La sessione: stato, stanza, arbitro, apertura e bot. Chiede alla vista
// quello che si vede; le funzioni qui sotto (dichiarate più avanti nel
// file) glielo danno.
const view: SessionView = {
  render: renderView,
  stop: engineStop,
  beforeCommit,
  beforeReceive,
  engineStatus: engineStatusDom,
  netStatus: netStatusDom,
  waitForPeer,
  seated,
  announce: () => banner.announce(),
  // I Rubyfront e i loro riquadri erano nascosti fino al loro ingresso
  // (style.css, body.is-intro-wait).
  introDone: () => document.body.classList.remove("is-intro-wait"),
  botGameOver: recordBotGame,
  joining: () => {
    voice.shutdown();
    document.body.dataset.voice = "";
  },
  rtc: payload => voice.receive(payload as VoicePayload),
  setAuto: (seat, chooser) => table.setAuto(seat, chooser),
  playFromHand: (card, spot) => table.playFromHand(card, spot),
  assignObject: (card, bearer) => table.assignObject(card, bearer),
  deployRubyfront: seat => table.deployRubyfront(seat),
  attackWith: card => table.attackWith(card),
  useAbility: (card, ability) => table.useAbility(card, ability),
  flipToNexus: card => table.flipToNexus(card),
  introRubyfronts: order => table.introRubyfronts(order),
  promptDiscard: seat => table.promptDiscard(seat),
  offerLeaveReturns: (before, after, owners) => table.offerLeaveReturns(before, after, owners),
  offerAssignTriggers: (before, after, owners) => table.offerAssignTriggers(before, after, owners),
  offerDeathRemains: (before, after, owners) => table.offerDeathRemains(before, after, owners),
  quiet: tableQuiet,
};
const session = createSession({
  seat: mySeat,
  locale,
  store,
  engineUrl,
  defaultTheme: defaultTheme(),
  opening: { hand: PHASE_BANNER_MS + 80, turnDraw: drawCascadeMs(6) + OPENING_DRAW_PAUSE_MS },
  view,
});
const ctx = session.ctx;
// --------------------------------------------------------- attorno alle azioni

/**
 * Il suono di un'azione, letto PRIMA che si applichi (serve la zona di
 * partenza): la carta posata sul Fronte dalla mano, l'attacco, il blocco, il
 * contrattacco. Vale per le azioni di chiunque — le proprie, quelle del bot,
 * quelle arrivate dalla rete — perché il suono è del tavolo, non del mouse.
 */
let lastDeclareAt = 0;
/** Il brano del tavolo (public/music, fornito dal designer). */
const TABLE_MUSIC = "neon-medieval-arena";
/** Il brano della home: parte con la home, in loop, e lascia il posto a
    quello del tavolo (in dissolvenza) quando il mazzo si mette giù. */
const HOME_MUSIC = "strategic-dawn";

function cueFor(action: Action): void {
  // La musica del tavolo: parte quando la partita comincia (il proprio
  // mazzo al tavolo), gira in loop per tutta la seduta, e a partita nuova
  // riparte da capo. Si spegne solo uscendo dal tavolo (leaveTable).
  if (action.t === "loadDeck" && action.seat === mySeat) startMusic(TABLE_MUSIC);
  // La partita nuova che azzera il tavolo uscendo (leaveTable) non è una
  // partita: lì suona la home.
  if (action.t === "newGame" && home.hidden) startMusic(TABLE_MUSIC, true);
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
    const card = session.state().cards[action.uid];
    if (card && card.zone === "hand") playSound("play");
    return;
  }
  // La pesca: un suono per carta, in cascata col ritmo con cui entrano in
  // mano (DRAW_STEP_MS, table.ts) — non più di quante ce ne sono nel mazzo.
  // Solo la PROPRIA: le carte dell'avversario (bot o rete) entrano nella
  // sua mano, che qui non si vede, e il suo fruscio sarebbe solo rumore.
  if (action.t === "draw" && action.seat === mySeat) {
    const available = zoneCards(session.state(), action.seat, "deck").length;
    const count = Math.min(action.count, available);
    for (let i = 0; i < count; i += 1) window.setTimeout(() => playSound("draw"), i * DRAW_STEP_MS);
    return;
  }
  // La pesca del turno (§6.1) non è un'azione a sé: la fa il cambio di
  // turno, dentro l'azione `turn` (state.ts). Se chi entra sono io e il
  // mazzo non è vuoto, la carta che arriva suona come le altre.
  // La carta entra in mano quando l'insegna del turno se n'è andata
  // (table.ts): il suono la aspetta.
  if (action.t === "turn" && action.active === mySeat && zoneCards(session.state(), mySeat, "deck").length > 0) {
    window.setTimeout(() => playSound("draw"), PHASE_BANNER_MS + 80);
  }
}

/** Chi muore nella risoluzione (§6.4) e i colpi da mostrare (§6.3): core/resa.ts, sullo stato di prima dell'azione. */
function fallenOf(action: Action): string[] {
  return fallenOfState(session.state(), action);
}

function clashesOf(action: Action): Clash[] {
  return clashesOfState(session.state(), action);
}

/** Un'azione propria (o del bot) sta per applicarsi: il suono, la carta
    rivelata, e i voli dei morti — il fantasma si prende prima, il volo
    parte dopo il disegno, col taglio, prima di dissolversi. */
function beforeCommit(action: Action): () => void {
  cueFor(action);
  peekReveal(action);
  const flights = fallenOf(action).map(uid => table.liftForFlight(uid, "abisso", { slain: true }));
  const clashes = clashesOf(action);
  return () => {
    flights.forEach(flight => flight?.());
    for (const clash of clashes) {
      if (clash.kind === "strike") table.strike(clash.uid);
      else table.clash(clash.uid, clash.kind);
    }
  };
}

/**
 * «Mostrala all'avversario»: la carta che l'altro rivela da uno sguardo nel
 * mazzo (un effetto o un'abilità del Rubyfront) si vede anche qui, a
 * grandezza piena, prima che finisca in mano. Vale per l'avversario in rete
 * (receive) e per il bot (commit): chi rivela sono sempre loro, mai io.
 */
function peekReveal(action: Action): void {
  if (action.t !== "look" || !action.reveal) return;
  const card = session.state().cards[action.reveal];
  if (!card || card.owner === mySeat) return;
  // La carta mostrata resta finché non si preme «Continua» (deciso
  // 2026-09-09): è una carta da leggere, non un lampo che passa da sé come
  // la giocata avversaria (showEnterPeek).
  void showEnterEffect(document.querySelector<HTMLElement>("#table")!, {
    cardId: card.cardId,
    face: card.face,
    theme: ctx.themeFor(card.owner),
    locale,
    kicker: t("scene.reveal.kicker"),
    who: t("scene.reveals", { name: seatLabel(session.state(), card.owner, mySeat), card: `«${cardName(card.cardId, locale)}»` }),
    effects: [],
  });
}

/** Un'azione dell'avversario, già approvata dal tavolo, sta per applicarsi:
    la si vede anche qui — la giocata, gli effetti, i dadi, i voli. */
function beforeReceive(action: Action): (() => void) | undefined {
  cueFor(action);
  peekReveal(action);
  // La giocata dell'avversario si vede anche qui, senza fermare nulla: la
  // carta accesa un attimo, poi la tessera «ultima giocata» (effect.ts).
  if (action.t === "toZone" && action.zone === "field") {
    const card = session.state().cards[action.uid];
    if (card && card.zone === "hand") {
      void showEnterPeek(document.querySelector<HTMLElement>("#table")!, {
        cardId: card.cardId,
        face: card.face,
        theme: ctx.themeFor(card.owner),
        locale,
        who: t("scene.plays", { name: seatLabel(session.state(), card.owner, mySeat), card: `«${cardName(card.cardId, locale)}»` }),
        effects: enterEffects(card.cardId, card.face, locale),
      });
    }
  }
  // Un effetto dell'avversario si vede anche qui: la fonte si accende, e se
  // ha un bersaglio la freccia lo indica — prima che la carta parta.
  if ((action.t === "draw" || action.t === "look") && action.effect) table.flash(action.effect.source);
  if (action.t === "look" && action.roll !== undefined) {
    const source = session.state().cards[action.effect.source];
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
    const moving = session.state().cards[action.uid];
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
    const die = cardStats(session.state().cards[action.uid]?.cardId ?? "").deployment?.die ?? 6;
    void showRoll(document.querySelector<HTMLElement>("#table")!, die, action.roll, t("dice.deploy"));
  }
  // La risoluzione dell'avversario: i suoi morti (e i miei) volano nell'Abisso.
  if (action.t === "resolve") {
    const flights = fallenOf(action).map(uid => table.liftForFlight(uid, "abisso", { slain: true }));
    const clashes = clashesOf(action);
    fly = () => {
      flights.forEach(flight => flight?.());
      for (const clash of clashes) {
        if (clash.kind === "strike") table.strike(clash.uid);
        else table.clash(clash.uid, clash.kind);
      }
    };
  }
  // Il ritorno vincolato dell'avversario (§8.2): la carta e l'Oggetto
  // volano dalle sue pile al suo Fronte, dopo il disegno.
  if (action.t === "revive") {
    const back = session.state().cards[action.uid];
    const object = session.state().cards[action.object];
    if (back && object) {
      const zone = back.zone;
      fly = () => {
        table.flyFromPile(back.owner, zone, action.uid);
        table.flyFromPile(object.owner, "ritiro", action.object);
      };
    }
  }
  return fly ?? undefined;
}

// ----------------------------------------------------------------- voce

const voice = createVoice({
  seat: () => mySeat,
  send: payload => session.sendRtc(payload),
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
// La vista compatta («Tavolo») non si sceglie più (tolta dalle impostazioni
// il 2026-09-09): chi l'aveva salvata torna al rincasso.
const savedView = store.read("view", "");
setViewMode(savedView === "full" || savedView === "recess" ? savedView : "recess");

const table = mountTable(document.querySelector<HTMLElement>("#table")!, ctx);
// L'insegna di fase sta sul tavolo, sopra le carte: è lì che si guarda.
// In sviluppo il tavolo si può pilotare dalla console (prove a mano di
// stati difficili da raggiungere: la fine partita, un contatore). In
// produzione non esiste.
if (import.meta.env.DEV) {
  (window as unknown as { __rbf: unknown }).__rbf = {
    dispatch: (action: Action) => session.dispatch(action),
    state: () => session.state(),
    music: musicState,
    // Il tavolo, coi suoi gesti (playFromHand, assignObject…): per provare le scene senza il mouse.
    table,
    // Dove si posa una carta di quel tipo per quel posto (per montare a mano uno stato).
    spot: (seat: Seat, kind: "entity" | "matter" | "object" | "rubyfront" | "nexus" | null) => playSpot(session.state(), seat, kind),
  };
}

const banner = mountPhaseBanner(document.querySelector<HTMLElement>("#table")!, ctx, { newGame: () => session.newGame() });
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
  session.paint();
}
// Turno, gesto di fase, Evoca, chat e microfono stanno in header; le targhe
// dei posti sull'orlo dei campi (table.onStats, sotto). L'overlay è montato
// poche righe sotto: ai click esiste già.
let legendPanel: ReturnType<typeof mountLegend> | null = null;
const hud = mountHud(ctx, {
  chat: toggleSide,
  legend: button => {
    legendPanel ??= mountLegend(document.body, button);
    legendPanel.toggle();
  },
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
    session.paint();
  },
  shuffle: () => session.shuffle(),
  draw: () => session.draw(),
  search: () => overlay.open(mySeat, "deck"),
  spawn: () => overlay.openCatalog(mySeat),
});
table.onStats(hud.chip);
document.querySelector("#side-close")!.addEventListener("click", toggleSide);
const overlay = mountOverlay(ctx, () => session.paint());
table.onBrowse((seat, zone) => overlay.open(seat, zone));
table.onListControl((_seat, cards, menuFor) => overlay.list(t("overlay.control", { n: cards().length }), cards, menuFor));
table.onPick((seat, zone, candidates, title, visible) => overlay.pick(seat, zone, candidates, title, visible));

/** Righe arrivate a chat chiusa: due spie — messaggi (blu) e azioni (oro). */
let unreadChat = 0;
let seenChat = 0;

/** Il ridisegno che la sessione chiede (SessionView.render): temi e tinte
    li ha appena aggiornati lei. */
function renderView(): void {
  // Il cassetto della mano sta fuori dai campi: la tua tinta la legge dal body.
  document.body.dataset.myTint = ctx.tintFor(mySeat);
  table.retint();
  // A chat chiusa il tasto porta la spia dei messaggi non letti, altrimenti
  // ciò che arriva passerebbe inosservato. Contano solo i messaggi
  // dell'AVVERSARIO: i propri non sono notizie. La cronaca delle azioni
  // non si stampa più in chat, e non ha spia.
  const chats = session.state().chat.filter(entry => entry.kind === "chat" && entry.seat && entry.seat !== mySeat).length;
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
}

// ----------------------------------------------------------------- rete

/** La spia della stanza e la frase dell'attesa (SessionView.netStatus). */
function netStatusDom(status: EngineStatus, peers: number): void {
  const room = session.room();
  const dot = document.querySelector<HTMLElement>("#net-dot")!;
  // Nella stanza «solo» la spia della stanza resta spenta: il filo c'è (è
  // quello dell'arbitro, engine-dot), ma nessuno è seduto di fronte.
  dot.dataset.status = room ? status : "offline";
  dot.title = !room ? t("net.solo") : status === "online" ? t("net.online", { n: peers }) : t(status === "connecting" ? "net.connecting" : "net.offline");
  obWaitText.textContent = t(status === "online" ? "html.ob.wait.alone" : "html.ob.wait.connecting");
}

// L'accoglienza sta in fondo al file, ma il passo d'attesa serve già qui:
// netStatusDom parte con la prima join, prima che il wizard sia montato.
const onboard = document.querySelector<HTMLElement>("#onboard")!;
// La home (le carte d'ingresso) sta sotto il velo dell'accoglienza: gli fa
// da sfondo finché non si è seduti al tavolo. Con la home parte il suo brano
// (il browser lo lascia suonare dal primo gesto, unlockSound).
const home = document.querySelector<HTMLElement>("#home")!;
function showHome(): void {
  home.hidden = false;
  startMusic(HOME_MUSIC);
  // I campioni dei tasti si caricano subito: così anche il primo click in
  // home scatta (il contesto resta sospeso finché il browser non vede un
  // gesto, ma decodificare si può).
  unlockSound();
}
const obStepWait = document.querySelector<HTMLElement>("#ob-step-wait")!;
const obWaitNote = document.querySelector<HTMLElement>("#ob-wait-note")!;
const obWaitText = document.querySelector<HTMLElement>("#ob-wait-text")!;

/** Si resta all'accoglienza finché nella stanza non c'è anche l'altro. */
function waitForPeer(): void {
  obWaitNote.textContent = t("html.ob.wait.note", { room: roomInput.value.trim() });
  for (const step of onboard.querySelectorAll<HTMLElement>("[id^='ob-step-']")) step.hidden = step !== obStepWait;
  onboard.hidden = false;
}

/** Si va al tavolo (SessionView.seated): via home e accoglienza. */
function seated(): void {
  onboard.hidden = true;
  home.hidden = true;
  obStepWait.hidden = true;
}

// -------------------------------------------------------------- comandi

/** Il nome di un mazzo nella lingua del tavolo. */
function deckName(deckId: string): string {
  const deck = getDeck(deckId);
  return deck?.locales[locale]?.name ?? deck?.locales[deck.defaultLocale]?.name ?? deckId;
}

// La stanza non ha più un campo nelle impostazioni: si sceglie dalla home.
// Qui resta il suo valore corrente (link, memoria del browser, o vuoto).
const roomInput = { value: params.get("room") ?? store.read("room", "") };
// Il tavolo non ha un campo nelle impostazioni: è quello di produzione
// (DEFAULT_ENGINE), o ?engine= per le prove.
const langPick = document.querySelector<HTMLSelectElement>("#lang-pick")!;

langPick.value = locale;

document.querySelector("#do-push")!.addEventListener("click", () => session.resync());

// Una stanza è solo un nome: chi lo conosce entra. «Crea una stanza» (home)
// ne inventa uno difficile da indovinare e ci entra subito, al posto A;
// «Copia il link d'invito» impacchetta stanza e posto OPPOSTO in un URL —
// chi lo apre è dentro, seduto dall'altra parte, senza toccare
// un'impostazione.
const GEMS = ["rubino", "ambra", "giada", "opale", "zaffiro", "onice", "perla", "agata", "topazio", "berillo"];

/**
 * Entrare in una stanza al posto dovuto: A chi la crea, B chi entra. Se il
 * posto è già quello, si entra e si passa al nome; se no la pagina riparte
 * con stanza e posto nell'indirizzo — il posto decide quale metà è «tua» e
 * cosa puoi toccare, e si rilegge tutto da capo invece di ricucire le viste
 * già montate (è la stessa strada del link d'invito).
 */
function enterRoomAs(room: string, seat: Seat): void {
  if (mySeat === seat) {
    roomInput.value = room;
    session.join(room);
    obProfile();
    return;
  }
  store.write("seat", seat);
  store.write("room", room);
  const next = new URL(location.href);
  next.search = "";
  next.searchParams.set("room", room);
  next.searchParams.set("seat", seat);
  location.href = next.href;
}
async function copyInvite(button: HTMLButtonElement, resetKey: string): Promise<void> {
  const room = roomInput.value.trim();
  if (!room) return;
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("room", room);
  url.searchParams.set("seat", otherSeat(mySeat));
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

/** La spia del tavolo (SessionView.engineStatus). */
function engineStatusDom(status: EngineStatus): void {
  engineDot.hidden = false;
  engineDot.dataset.status = status;
  engineDot.title = t(`engine.${status === "online" ? "online" : status === "connecting" ? "connecting" : "offline"}`);
}

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
  session.paint();
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

// Il tema del tavolo è tutto CSS: si stampa sul body e il foglio fa il resto.
// È un vestito del client, non dello stato: ognuno gioca col tema suo.
// Il chiaro è il tema di casa (scelta del designer, 2026-09-07): chi non ha
// mai scelto lo trova, e un tema salvato da prima che non esiste più
// (rubino, smeraldo, solarizzato…) ricade sul chiaro. Chi ha scelto il
// Notte se lo tiene.
const LEGACY_THEMES: Record<string, string> = { chiaro: "light", notte: "night", "notte-ardesia": "night-slate", "notte-panno": "night-baize" };
const storedTheme = store.read("uitheme", "light");
const savedTheme = LEGACY_THEMES[storedTheme] ?? storedTheme;
const themePick = document.querySelector<HTMLSelectElement>("#theme-pick")!;
const knownTheme = [...themePick.options].some(option => option.value === savedTheme);
document.body.dataset.uiTheme = knownTheme ? savedTheme : "light";
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
netStatusDom("offline", 0);
session.paint();
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

session.join(roomInput.value);

// ------------------------------------------------------------ onboarding
// Al primo arrivo (nessuna stanza nota) si parte dalla home: le quattro
// carte d'ingresso. Da lì il velo accompagna dentro — nome e mazzo, poi
// (in stanza) l'attesa dell'altro. Chi arriva con una stanza (salvata o da
// link d'invito) ma senza mazzo parte dal nome; chi ha già tutto non vede
// nulla di tutto questo.
const obStepProfile = document.querySelector<HTMLElement>("#ob-step-profile")!;
const obRoom = document.querySelector<HTMLInputElement>("#ob-room")!;
const obName = document.querySelector<HTMLInputElement>("#ob-name")!;
const obDeck = document.querySelector<HTMLSelectElement>("#ob-deck")!;
const obDeckB = document.querySelector<HTMLSelectElement>("#ob-deck-b")!;
const obDeckBLabel = document.querySelector<HTMLElement>("#ob-deck-b-label")!;
const obRoomNote = document.querySelector<HTMLElement>("#ob-room-note")!;

for (const deck of allDecks()) {
  obDeck.append(new Option(deckName(deck.id), deck.id));
  obDeckB.append(new Option(deckName(deck.id), deck.id));
}
if (session.myDeck()) obDeck.value = session.myDeck()!;
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
  const name = `${GEMS[Math.floor(Math.random() * GEMS.length)]}-${Math.floor(1000 + Math.random() * 9000)}`;
  enterRoomAs(name, "a");
});

document.querySelector("#ob-join")!.addEventListener("click", () => {
  const room = obRoom.value.trim();
  if (!room) {
    obRoom.focus();
    return;
  }
  enterRoomAs(room, "b");
});
obRoom.addEventListener("keydown", event => {
  if (event.key === "Enter") document.querySelector<HTMLButtonElement>("#ob-join")!.click();
});

document.querySelector("#ob-bot")!.addEventListener("click", () => obProfile("bot"));

document.querySelector("#ob-go")!.addEventListener("click", () => {
  const name = obName.value.trim();
  if (name) {
    store.write("name", name);
    session.dispatch({ t: "player", seat: mySeat, patch: { name } });
  }
  if (obDeck.value) session.chooseDeck(obDeck.value);
  paintHello();
  paintResume();
  if (obMode === "bot") {
    // Col bot si passa dal sipario: il velo e la home spariscono al buio.
    const botDeck = obDeckB.value;
    const deckId = session.myDeck();
    // I Rubyfront e i loro riquadri non devono comparire prima del loro
    // ingresso: nascosti fin da ORA, prima che il sipario si alzi sul tavolo
    // (style.css, body.is-intro-wait); l'intro li scopre uno alla volta.
    document.body.classList.add("is-intro-wait");
    curtainInto(() => session.startBotWithIntro(botDeck, deckId));
    return;
  }
  onboard.hidden = true;
  // In stanza il tavolo si apre solo quando c'è anche l'altro giocatore:
  // il mazzo si mette giù ora o al suo arrivo (la home resta dietro al velo).
  session.seatOrWait();
});

// Il sipario verso la partita col bot: il nero cala sulla home (.6s), resta
// giù due secondi — intanto home e velo spariscono e sotto c'è il tavolo
// vuoto —, poi si alza (.8s); a sipario alzato, dopo un respiro, la partita
// parte (bot, mazzo, insegna «Fase di Preparazione»): la Preparazione si
// vede nascere sul tavolo già in vista, non al buio né mentre affiora. La musica della home
// sfuma col nero; quella del tavolo attacca con la partita (dopo il suo
// silenzio, sound.ts).
const curtain = document.querySelector<HTMLElement>("#curtain")!;
const CURTAIN_FALL_MS = 600;
const CURTAIN_HOLD_MS = 2000;
const CURTAIN_RISE_MS = 800;
const CURTAIN_START_AFTER_MS = CURTAIN_RISE_MS + 400;
/** Il sipario: cala, a nero fa `atBlack` (cambiare schermata), resta giù
    `hold` ms, si alza, e a sipario alzato più un respiro fa `afterRise`. */
function curtainPass(run: { atBlack: () => void; afterRise?: () => void; hold?: number }): void {
  curtain.hidden = false;
  curtain.classList.remove("is-rising");
  // Da display:none il browser non ha uno stile «prima» da cui partire, e
  // il nero calerebbe di colpo: si forza un calcolo di stile a sipario
  // trasparente, poi si abbassa.
  void curtain.offsetWidth;
  curtain.classList.add("is-down");
  window.setTimeout(run.atBlack, CURTAIN_FALL_MS);
  window.setTimeout(() => {
    curtain.classList.add("is-rising");
    curtain.classList.remove("is-down");
    if (run.afterRise) window.setTimeout(run.afterRise, CURTAIN_START_AFTER_MS);
    window.setTimeout(() => {
      curtain.hidden = true;
      curtain.classList.remove("is-rising");
    }, CURTAIN_RISE_MS + 50);
  }, CURTAIN_FALL_MS + (run.hold ?? CURTAIN_HOLD_MS));
}
/** Dalla home alla partita col bot: al nero spariscono home e velo. */
function curtainInto(begin: () => void): void {
  stopMusic();
  curtainPass({
    atBlack: () => {
      home.hidden = true;
      onboard.hidden = true;
      deckView.close();
      session.paint();
    },
    afterRise: begin,
  });
}
/** Dalla partita alla home: al nero il tavolo si azzera e la home torna
    (leaveTable); il nero resta meno, non c'è niente da preparare. */
function curtainHome(): void {
  curtainPass({ atBlack: leaveTable, hold: 900 });
}

// Il saluto in home: il nome salvato e il conto delle partite contro il
// bot (`stats`, nel browser: si scrive a ogni fine partita per PV).
const homeHello = document.querySelector<HTMLElement>("#home-hello")!;
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
  paintHello();
}
function paintHello(): void {
  const name = store.read("name", "");
  const stats = readStats();
  const hello = name ? t("html.home.hello", { name }) : t("html.home.hello.new");
  const record = stats.games === 0 ? "" : t(stats.games === 1 ? "html.home.record.one" : "html.home.record", { games: stats.games, wins: stats.wins });
  // L'insegna: la gemma sopra (CSS, ::before), la frase fra due fili di luce.
  const text = document.createElement("span");
  text.className = "home-hello-text";
  text.textContent = record ? `${hello} · ${record}` : hello;
  homeHello.replaceChildren(text);
}

// «Riprendi con …»: nome e mazzo già salvati, si va al tavolo con un click,
// il bot col mazzo diverso dal tuo (o lo stesso, se è l'unico). Il tasto
// «Nuova partita» resta sotto e passa da nome e mazzo.
const obResume = document.querySelector<HTMLButtonElement>("#ob-resume")!;
const obBot = document.querySelector<HTMLButtonElement>("#ob-bot")!;
function paintResume(): void {
  const myDeckId = session.myDeck();
  const deck = myDeckId ? getDeck(myDeckId) : undefined;
  const ready = Boolean(store.read("name", "") && deck);
  obResume.hidden = !ready;
  obBot.classList.toggle("home-secondary", ready);
  if (deck) obResume.textContent = t("html.home.resume", { deck: deck.locales[lang()]?.name ?? deck.locales[deck.defaultLocale]?.name ?? deck.id });
}
obResume.addEventListener("click", () => {
  const myDeckId = session.myDeck();
  if (!myDeckId) return;
  const botDeck = allDecks().find(deck => deck.id !== myDeckId) ?? getDeck(myDeckId);
  if (!botDeck) return;
  const deckId = myDeckId;
  curtainInto(() => {
    session.startBot(botDeck.id);
    session.loadDeck(deckId, mySeat);
  });
});
// La carta «Contro il computer» apre il gesto giusto: Riprendi se c'è, se
// no Nuova partita.
document.querySelector<HTMLElement>("#home-solo")!.dataset.openWith = "ob-bot";
paintHello();
paintResume();

// I mazzi, per chi gioca: la vista che si apre dalla carta «Mazzi».
// «Gioca con questo mazzo» lo sceglie e passa dal nome (poi il bot).
const deckView = mountDeckView(
  document.querySelector<HTMLElement>("#decks")!,
  deckId => {
    deckView.close();
    session.chooseDeck(deckId);
    obDeck.value = deckId;
    paintResume();
    obProfile("bot");
  },
  () => {}
);
document.querySelector("#home-decks-go")!.addEventListener("click", () => deckView.open());

// Le carte della home: l'illustrazione di sfondo e il tocco. Lo sfondo è
// una coppia di file in public/home/ (`data-bg`, senza estensione: <nome>.jpg
// per gli schermi normali e <nome>@2x.jpg per i Retina, fatti da
// scripts/home-art.mjs dall'upscale di Midjourney; il browser sceglie con
// image-set) oppure, finché l'originale manca, l'art di una carta
// (`data-art`: ridotta a 1040px per il sito, su una colonna alta sfoca). Una carta con `data-open-with` è un unico gesto (il suo tasto);
// le altre si aprono al tocco, per chi non ha un mouse da passarci sopra.
// Le carte in grigio (is-off) non rispondono.
const homeCards = [...home.querySelectorAll<HTMLElement>(".home-card")];
for (const card of homeCards) {
  const art = card.querySelector<HTMLElement>(".home-art");
  if (art && card.dataset.bg) art.style.backgroundImage = homeArtSet(card.dataset.bg);
  else if (art && card.dataset.art) art.style.backgroundImage = `url("${artUrl(card.dataset.art)}")`;
  // `data-pos`: dove cade il ritaglio (background-position), quando il
  // soggetto non sta al centro del quadro.
  if (art && card.dataset.pos) art.style.backgroundPosition = card.dataset.pos;
  // `data-fit`: l'illustrazione non copre tutta la colonna ma solo quella
  // quota d'altezza, appesa in alto — si vede più quadro (è l'unico modo di
  // «allontanare» un 16:9 in una carta verticale); il fondo che resta
  // scoperto sfuma nel nero della zona del testo (is-fit, style.css).
  if (art && card.dataset.fit) {
    const [x = "50%"] = (card.dataset.pos ?? "").split(" ");
    art.style.backgroundSize = `auto ${card.dataset.fit}`;
    art.style.backgroundPosition = `${x} top`;
    card.classList.add("is-fit");
  }
  card.addEventListener("click", event => {
    if (card.classList.contains("is-off")) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, a")) return;
    const go = card.dataset.openWith;
    if (go) {
      // Contro il computer: se c'è «Riprendi», è quello il gesto della carta.
      // (Il click sul tasto porta con sé lo scatto, come ogni tasto.)
      if (go === "ob-bot" && !obResume.hidden) obResume.click();
      else document.getElementById(go)?.click();
      return;
    }
    // Aprire o chiudere una carta al tocco è un gesto come un tasto: scatta.
    playSound("button");
    for (const other of homeCards) other.classList.toggle("is-open", other === card && !card.classList.contains("is-open"));
    if (card.classList.contains("is-open")) card.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  });
}
/** L'image-set dei due file di uno sfondo della home (1x e 2x); dove il
    browser non lo conosce, il solo 1x. */
function homeArtSet(base: string): string {
  const one = new URL(`${base}.jpg`, document.baseURI).href;
  const two = new URL(`${base}@2x.jpg`, document.baseURI).href;
  const set = `url("${one}") 1x, url("${two}") 2x`;
  if (CSS.supports("background-image", `image-set(${set})`)) return `image-set(${set})`;
  if (CSS.supports("background-image", `-webkit-image-set(${set})`)) return `-webkit-image-set(${set})`;
  return `url("${one}")`;
}
// Il paesaggio dietro la home, con la stessa coppia di file 1x/2x.
if (home.dataset.bg) home.querySelector<HTMLElement>(".home-bg")!.style.backgroundImage = homeArtSet(home.dataset.bg);
function closeHomeCards(): void {
  for (const card of homeCards) card.classList.remove("is-open");
}

/**
 * «Esci dal tavolo»: si lascia la stanza (o si congeda il bot), il tavolo
 * si azzera e si torna all'accoglienza, al primo passo.
 * La stanza salvata si dimentica: alla prossima visita si sceglie di nuovo.
 * Il proprio nome e il proprio mazzo restano ricordati.
 */
function leaveTable(): void {
  stopMusic(true);
  session.leaveRoom();
  roomInput.value = "";
  obRoom.value = "";
  // Fuori dalla stanza il posto torna A (chi crea la prossima è A); se qui si
  // era B, la pagina riparte: il posto è cucito in ogni vista.
  if (mySeat !== "a") {
    store.write("seat", "a");
    const next = new URL(location.href);
    next.search = "";
    location.href = next.href;
    return;
  }
  // La partita nuova, e il nome dell'altro posto cancellato in locale.
  session.resetTable();
  document.querySelector(".engine-stop")?.remove();
  session.reapplyName();
  onboard.hidden = true;
  obStepProfile.hidden = true;
  obStepWait.hidden = true;
  closeHomeCards();
  deckView.close();
  showHome();
  settingsPanel.hidden = true;
  session.paint();
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
// Due tasti indipendenti nelle impostazioni: i suoni delle carte e la
// musica. Ognuno dice il suo stato; la scelta resta salvata.
function mountAudioToggle(id: string, key: string, onKey: string, offKey: string, apply: (on: boolean) => void): void {
  const button = document.querySelector<HTMLButtonElement>(`#${id}`)!;
  let on = store.read(key, "on") !== "off";
  const paintToggle = (): void => {
    button.textContent = t(on ? onKey : offKey);
    button.setAttribute("aria-pressed", String(on));
    button.classList.toggle("is-off", !on);
  };
  apply(on);
  paintToggle();
  button.addEventListener("click", () => {
    on = !on;
    apply(on);
    store.write(key, on ? "on" : "off");
    paintToggle();
  });
}
mountAudioToggle("sound-toggle", "sound", "html.sound.on", "html.sound.off", setSoundEnabled);
mountAudioToggle("music-toggle", "music", "html.music.on", "html.music.off", setMusicEnabled);

/** «Uscire dalla partita?» — il sigillo del gioco, non un alert del browser. */
function askLeave(titleKey: string, textKey: string, yesKey: string): Promise<boolean> {
  return askConfirm({ title: t(titleKey), text: t(textKey), yes: t(yesKey), no: t("ask.stay") });
}
document.querySelector("#do-leave")!.addEventListener("click", () => {
  void askLeave("ask.leave.title", "html.leave.confirm", "ask.leave.yes").then(yes => {
    if (yes) curtainHome();
  });
});

// Il marchio riporta alla home. Dalla vista dei mazzi o dal velo
// dell'accoglienza si torna e basta; al tavolo (stanza o bot) si chiede,
// perché la partita in corso si chiude.
document.querySelector("#brand-home")!.addEventListener("click", () => {
  if (!home.hidden) {
    deckView.close();
    onboard.hidden = true;
    obStepProfile.hidden = true;
    obStepWait.hidden = true;
    if (session.awaitingPeer() || roomInput.value.trim()) leaveTable();
    return;
  }
  void askLeave("ask.home.title", "html.brand.confirm", "ask.home.yes").then(yes => {
    if (yes) curtainHome();
  });
});

// La quiete del tavolo, per il passo del bot (SessionView.quiet): la
// guida del bot sta nella sessione, ma cosa si muove sullo schermo lo sa
// solo la vista.

/** Il tavolo è fermo: nessuna scena, nessun dado, nessuna mira, nessun effetto in corso. */
function tableQuiet(): boolean {
  return (
    // L'insegna di fase ferma tutti, bot compreso (banner.ts).
    !document.body.classList.contains("is-announcing") &&
    !document.body.classList.contains("is-intro") &&
    !document.body.classList.contains("is-resolving") &&
    !document.body.classList.contains("is-targeting") &&
    !document.querySelector(".effect-veil, .effect-confirm, .dice-roll")
  );
}

if (!roomInput.value.trim()) {
  showHome();
} else if (!session.myDeck()) {
  showHome();
  obProfile();
} else {
  // Stanza e mazzo già noti (link d'invito, o il cambio posto entrando in
  // una stanza): si aspetta l'altro giocatore, e il mazzo si mette giù
  // quando c'è — o subito, se c'è già.
  showHome();
  session.seatOrWait();
}
