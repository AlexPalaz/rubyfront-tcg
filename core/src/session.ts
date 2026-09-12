// La sessione: la partita di questo client, senza DOM.
//
// Lo stato vive qui, in una variabile sola. Ogni modifica passa da
// `dispatch`, che chiede il verdetto al tavolo, applica e fa ridisegnare. Non
// esiste altro modo di cambiare la partita — nemmeno per l'avversario, le cui
// azioni arrivano dal tavolo già approvate ed entrano dallo stesso imbuto
// (receive). Qui stanno anche la stanza e il suo giornale, il mazzo e
// l'apertura (§4), e la guida del bot.
//
// Tutto ciò che si vede lo fa la vista (`SessionView`): il ridisegno, il
// sigillo dell'arbitro, i voli e i suoni attorno a un'azione, i gesti del
// tavolo che il bot compie con le stesse scene di un giocatore. È uscita da
// main.ts del simulatore nella migrazione a PixiJS (F1, 2026-09-11): la
// usano tutti e due i client, con lo stesso ordine di sempre.

import { chooseAbility, chooseAttackers, chooseBlocks, chooseDiscards, chooseFlip, choosePlay, chooseResponse, freshMemory, pickBest, type BotMemory } from "./bot.js";
import { cardFacts, cardName, cardStats, deckTint, getDeck, isRubyfront, type Tint } from "./cards.js";
import { declareBlock } from "./combat.js";
import type { Ability, CardFacts, Ctx } from "./ctx.js";
import { releaseHeld } from "./effects.js";
import { connectEngine, type EngineLink, type EngineStatus, type EngineVerdict } from "./engine.js";
import { SLOT_X, backRowY } from "./geometry.js";
import { msg, t } from "./i18n.js";
import { renderLog } from "./log.js";
import { apply, controllerOf, fieldCards, freeFrontSlotOrNull, matterSpot, newGame, phaseCloser, replay, shuffled, zoneCards } from "./state.js";
import { endPhase, gameOverMsg, verdictByHp } from "./turn.js";
import type { Action, CardInstance, ChatEntry, GameState, Seat, ZoneId } from "./types.js";
import { SEATS, otherSeat } from "./types.js";

/** La memoria del client (nel browser: localStorage): nome, mazzo, stanza. */
export interface SessionStore {
  read(key: string, fallback: string): string;
  write(key: string, value: string): void;
}

/** Le scelte che il tavolo fa da sé per un posto (il bot): mira e pile. */
export interface AutoChooser {
  pickTarget(source: CardInstance, candidates: CardInstance[]): CardInstance | null;
  pickFromPile(zone: ZoneId, candidates: CardInstance[], visible?: CardInstance[]): CardInstance | null;
}

/**
 * Ciò che la sessione chiede alla vista. Niente ritorna dentro lo stato da
 * qui: la vista mostra, e i gesti che compie passano da `dispatch`.
 */
export interface SessionView {
  /** Ridisegna tutto dallo stato (la sessione ha già aggiornato temi e tinte). */
  render(): void;
  /** Il fermo dell'arbitro: il gesto non è avvenuto, e lo si deve sapere subito. */
  stop(verdict: EngineVerdict): void;
  /**
   * Un'azione propria (o del bot) sta per applicarsi: suoni, rivelazioni, i
   * fantasmi dei voli presi PRIMA che lo stato cambi. Il ritorno, se c'è,
   * parte dopo il ridisegno (i voli, i colpi).
   */
  beforeCommit(action: Action): (() => void) | void;
  /** Lo stesso per un'azione dell'avversario, già approvata dal tavolo. */
  beforeReceive(action: Action): (() => void) | void;
  /** Il filo verso il tavolo: com'è. */
  engineStatus(status: EngineStatus): void;
  /** La stanza: com'è il filo e quanti sono seduti (la «solo» non ha spia). */
  netStatus(status: EngineStatus, peers: number): void;
  /** In stanza senza l'altro giocatore: si resta all'accoglienza ad aspettarlo. */
  waitForPeer(): void;
  /** Si va al tavolo: via home e accoglienza. */
  seated(): void;
  /** L'insegna della fase che si apre (Preparazione, a partita nuova). */
  announce(): void;
  /** Finito l'ingresso dei Rubyfront a inizio partita col bot. */
  introDone(): void;
  /** Una partita contro il bot è finita per PV: vinta o persa. */
  botGameOver(won: boolean): void;
  /** Si cambia stanza: la chat vocale di prima si chiude, finché il filo è quello vecchio. */
  joining(): void;
  /** La segnalazione WebRTC dell'avversario. */
  rtc(payload: unknown): void;

  // I gesti del tavolo, con le loro scene: li compie il bot come un
  // giocatore, e dopo un'azione il tavolo offre gli effetti che toccano
  // a chi decide (io, o il bot).
  setAuto(seat: Seat | null, chooser: AutoChooser): void;
  playFromHand(card: CardInstance, spot: { x: number; y: number }): Promise<boolean>;
  assignObject(card: CardInstance, bearer: CardInstance): Promise<boolean>;
  deployRubyfront(seat: Seat): Promise<boolean>;
  attackWith(card: CardInstance): Promise<void>;
  useAbility(card: CardInstance, ability: Ability): Promise<boolean>;
  flipToNexus(card: CardInstance): Promise<boolean>;
  introRubyfronts(order: Seat[]): Promise<void>;
  promptDiscard(seat: Seat): boolean;
  offerLeaveReturns(before: GameState, after: GameState, owners: Seat[]): void;
  offerAssignTriggers(before: GameState, after: GameState, owners: Seat[]): void;
  offerDeathRemains(before: GameState, after: GameState, owners: Seat[]): void;
  /** Il tavolo è fermo: nessuna scena, nessun dado, nessuna mira, nessun effetto in corso. */
  quiet(): boolean;
}

export interface SessionOptions {
  /** Il posto di questo client: decide quale metà è «tua» e cosa puoi toccare. */
  seat: Seat;
  locale: string;
  store: SessionStore;
  /** L'indirizzo del tavolo (engine.ts, defaultEngineUrl). */
  engineUrl: string;
  /** Il tema delle carte di un posto senza mazzo. */
  defaultTheme: string;
  /**
   * I tempi dell'apertura (§4), che sono della vista: dopo quanto parte la
   * mano iniziale (l'insegna che svanisce) e, per chi apre, dopo quanto
   * dalla mano arriva la carta del turno 1 (la cascata più un respiro).
   */
  opening: { hand: number; turnDraw: number };
  view: SessionView;
}

export interface Session {
  ctx: Ctx;
  state(): GameState;
  /** La stanza in cui si è seduti; vuota = la stanza «solo» (partita locale o col bot). */
  room(): string;
  /** Il filo verso il tavolo, se c'è. */
  engine(): EngineLink | null;
  dispatch(action: Action): Promise<boolean>;
  /** Applica senza chiedere: solo per ciò che non è un gesto di gioco (leaveTable). */
  commit(action: Action): void;
  /** Temi, tinte, ridisegno — e il bot, se è il suo momento. */
  paint(): void;
  /** Il mazzo scelto da questo client, se c'è. */
  myDeck(): string | null;
  chooseDeck(deckId: string): void;
  loadDeck(deckId: string, seat: Seat): void;
  /** Sedersi a un tavolo: la stanza con quel nome, o la «solo» (nome vuoto). */
  join(name: string): void;
  /** Il tavolo rimanda saluto e giornale: la lavagna si ricostruisce da lì. */
  resync(): void;
  sendRtc(payload: unknown): boolean;
  shuffle(): void;
  draw(): void;
  /** La partita nuova, dall'insegna finale. */
  newGame(): void;
  /** La nuova partita azzera anche i nomi: il proprio si rimette da sé. */
  reapplyName(): void;
  /** Il mazzo va in tavola ora, oppure quando arriva l'altro giocatore. */
  seatOrWait(): void;
  awaitingPeer(): boolean;
  startBot(deckId: string): void;
  /** La partita col bot che comincia con l'ingresso dei Rubyfront. */
  startBotWithIntro(botDeckId: string, deckId: string | null): void;
  botSeat(): Seat | null;
  /** «Esci dal tavolo», la parte della sessione: via il bot e la stanza. */
  leaveRoom(): void;
  /** Il tavolo azzerato fuori dalla stanza: partita nuova, e il nome dell'altro posto si cancella. */
  resetTable(): void;
}

/** Il passo del bot: un gesto ogni tanto, per farsi seguire. */
const BOT_PACE_MS = 750;

/** Chi inizia, per ora a caso (§4: la scelta o il d20 arriveranno). */
export function randomSeat(): Seat {
  return Math.random() < 0.5 ? "a" : "b";
}

export function createSession(options: SessionOptions): Session {
  const { store, view, locale, engineUrl } = options;
  const mySeat = options.seat;

  let state: GameState = newGame(randomSeat());
  /** La stanza in cui si è seduti; vuota = la stanza «solo» (partita locale o col bot). */
  let room = "";
  /** Quanti client il tavolo conta nella stanza (me compreso), 0 se scollegati o nella «solo». */
  let roomPeers = 0;
  /**
   * Il tavolo si apre solo quando c'è anche l'altro giocatore: chi crea o
   * entra in una stanza resta all'accoglienza finché il tavolo conta due. Il
   * mazzo scelto si mette in tavola solo allora (deckDeferred), così
   * l'apertura — insegna, mano, carta del turno 1 — si vede insieme.
   */
  let awaitingPeer = false;
  let deckDeferred = false;
  /** L'arbitro esterno (engine/). */
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
  let botMemory: BotMemory = freshMemory(0);
  let botBusy = false;
  let botTimer: ReturnType<typeof setTimeout> | undefined;

  const themes: Record<Seat, string> = { a: options.defaultTheme, b: options.defaultTheme };
  const tints: Record<Seat, Tint> = { a: "dynamic", b: "dynamic" };

  // ---------------------------------------------------------------- dispatch

  function dispatch(action: Action): Promise<boolean> {
    // L'engine è l'unico a scrivere lo stato: l'azione parte solo col suo
    // benestare — un «no» la ferma prima che tocchi la lavagna, e si mostra
    // (view.stop); col sì il tavolo la inoltra lui all'avversario. In
    // stanza un tavolo scollegato o muto FERMA (stop.absent): senza arbitro
    // non si gioca contro qualcuno. Nella stanza «solo» (locale, bot) un
    // arbitro assente lascia il tavolo libero, come sempre. La promessa dice
    // se l'azione è passata: serve a chi ne accoda altre che senza questa
    // non hanno senso (endTurn).
    const judge = engine;
    const inRoom = room !== "";
    const absent = (): Promise<boolean> => {
      if (!(botSeat && actorFor(action) === botSeat)) view.stop({ t: "verdict", ok: false, ruled: true, reason: t("stop.absent"), reason_en: t("stop.absent") });
      paint();
      return Promise.resolve(false);
    };
    if (judge && judge.status() === "online") {
      return new Promise(resolve => {
        judge.judge(action, actorFor(action), verdict => {
          if (!verdict && inRoom) {
            void absent().then(resolve);
            return;
          }
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
              if (held > 7 && view.promptDiscard(closing)) {
                ctx.log(msg("log.discard.needed", { seat: closing, n: held }), closing);
              }
            }
            // Il bot che sbatte contro l'arbitro non mostra il sigillo a
            // chi guarda: prende nota (bot.ts, tried) e cambia gesto. Vale
            // per ogni gesto del suo posto, anche gli effetti risolti dopo.
            if (botSeat && actorFor(action) === botSeat) console.debug("bot fermato", action.t, verdict.reason);
            else view.stop(verdict);
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
    if (inRoom) return absent();
    commit(action);
    return Promise.resolve(true);
  }

  /** Applica e ridisegna: l'azione ormai è passata. */
  function commit(action: Action): void {
    const afterPaint = view.beforeCommit(action);
    const before = state;
    state = apply(state, action);
    paint();
    afterPaint?.();
    const deciders = botSeat ? [mySeat, botSeat] : [mySeat];
    // §8.2 — il ritorno vincolato: chi è appena uscita dal campo senza
    // Oggetti può tornare, e lo decide il proprietario — io, o il bot.
    if (action.t !== "revive") view.offerLeaveReturns(before, state, deciders);
    // §3.1 — «quando assegni questa carta a un'Entità»: l'Oggetto appena
    // assegnato innesca per chi lo comanda — io, o il bot.
    view.offerAssignTriggers(before, state, deciders);
    // §8.2 — «quando quell'Entità muore»: l'Oggetto che resta, per il proprietario — io, o il bot.
    if (action.t !== "remain") view.offerDeathRemains(before, state, deciders);
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
        if (botSeat) view.botGameOver(over.winner === mySeat);
      });
    }
  }

  /** Applica un'azione dell'avversario, già approvata dal tavolo (che l'ha giudicata con la sua copia: qui non si rigiudica). */
  function receive(action: Action): void {
    const afterPaint = view.beforeReceive(action);
    const before = state;
    state = apply(state, action);
    paint();
    afterPaint?.();
    // §8.2 — una mia carta uscita dal campo per mano dell'avversario (la sua
    // risoluzione, un suo effetto): il ritorno vincolato lo offro io.
    if (action.t !== "revive") view.offerLeaveReturns(before, state, [mySeat]);
    if (action.t !== "remain") view.offerDeathRemains(before, state, [mySeat]);
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
    // Il ritorno vincolato (§8.2) è del proprietario: la carta è nell'Abisso
    // o in Ritiro, dove chi la comandava non conta più.
    if (action.t === "revive") return state.cards[action.uid]?.owner ?? state.active;
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

  const factsOf = (cardId: string): CardFacts => cardFacts(cardId, locale);

  const ctx: Ctx = {
    state: () => state,
    dispatch,
    seat: () => mySeat,
    // Il mouse governa solo il proprio posto: l'altra metà è di chi c'è
    // (in rete) o del bot.
    controls: seat => seat === mySeat,
    arbitrated: () => engine?.status() === "online",
    themeFor: seat => themes[seat],
    tintFor: seat => tints[seat],
    locale: () => locale,
    promptDiscard: seat => view.promptDiscard(seat),
    card: factsOf,
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

  function paint(): void {
    syncThemes();
    view.render();
    scheduleBot();
  }

  /** Il tema di un posto è quello del suo mazzo (data/decks/*.json). */
  function syncThemes(): void {
    for (const seat of SEATS) {
      const deckId = state.players[seat].deckId;
      const deck = deckId ? getDeck(deckId) : undefined;
      themes[seat] = deck?.theme ?? options.defaultTheme;
      tints[seat] = deckId ? deckTint(deckId) : "dynamic";
    }
  }

  // ------------------------------------------------------------------ mazzi

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

  /** Il timer dell'apertura, per posto (insegna → mano → carta del turno 1):
      si azzera se il mazzo si ricarica prima che la fila sia finita. */
  const openingTimer: Record<Seat, ReturnType<typeof setTimeout> | undefined> = { a: undefined, b: undefined };
  /** L'apertura (§4) di un posto è in arrivo: il bot aspetta che sia passata. */
  const openingPending: Record<Seat, boolean> = { a: false, b: false };

  /** Il mazzo è ancora intero: tutte le carte del posto, Rubyfront a parte, stanno lì. */
  function deckUntouched(seat: Seat): boolean {
    const mine = Object.values(state.cards).filter(card => card.owner === seat && !isRubyfront(card.cardId));
    return mine.length > 0 && zoneCards(state, seat, "deck").length === mine.length;
  }

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
    if (introPending) return;
    view.announce();
    scheduleOpening(seat, deckId);
  }

  /** L'ingresso dei Rubyfront a inizio partita col bot: finito, l'insegna di
      Preparazione e l'apertura dei due posti ripartono come sempre. */
  let introPending = false;
  async function runIntro(): Promise<void> {
    const foe = botSeat ?? otherSeat(mySeat);
    try {
      // I mazzi passano dall'arbitro: le carte arrivano con la sua risposta.
      // Si aspetta che i due Rubyfront siano sul tavolo (al più 5 secondi).
      const onTable = (seat: Seat): boolean => fieldCards(state).some(card => card.owner === seat && isRubyfront(card.cardId));
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !(onTable(mySeat) && onTable(foe))) {
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      await view.introRubyfronts([mySeat, foe]);
    } finally {
      introPending = false;
      view.introDone();
      view.announce();
      for (const seat of SEATS) {
        const deckId = state.players[seat].deckId;
        if (deckId) scheduleOpening(seat, deckId);
      }
    }
  }

  /** La mano iniziale e la carta del turno 1 (§4, §6.1), a tempo dopo l'insegna. */
  function scheduleOpening(seat: Seat, deckId: string): void {
    clearTimeout(openingTimer[seat]);
    openingPending[seat] = true;
    openingTimer[seat] = setTimeout(() => {
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
      openingTimer[seat] = setTimeout(() => {
        openingPending[seat] = false;
        const untouched = state.players[seat].deckId === deckId && state.active === seat && handSize(seat) === 6;
        if (untouched) void dispatch({ t: "draw", seat, count: 1 });
      }, options.opening.turnDraw);
    }, options.opening.hand);
  }

  // ------------------------------------------------------------------- rete

  function onStatus(status: EngineStatus, peers: number): void {
    view.engineStatus(status);
    // L'HUD cambia faccia con l'arbitro (Fine fase al posto di Fine turno):
    // si ridisegna subito, non alla prossima mossa.
    paint();
    view.netStatus(status, peers);
    roomPeers = room && status === "online" ? peers : 0;
    if (awaitingPeer && roomPeers >= 2) seatTable();
  }

  /** L'altro è entrato: si va al tavolo, e il mazzo rimandato si mette giù. */
  function seatTable(): void {
    awaitingPeer = false;
    view.seated();
    if (deckDeferred && myDeckId) loadDeck(myDeckId, mySeat);
    deckDeferred = false;
  }

  function seatOrWait(): void {
    if (room && roomPeers < 2) {
      deckDeferred = true;
      awaitingPeer = true;
      view.waitForPeer();
      return;
    }
    view.seated();
    if (myDeckId) loadDeck(myDeckId, mySeat);
  }

  let seatClashWarned = false;
  function warnSeatClash(): void {
    if (seatClashWarned) return;
    seatClashWarned = true;
    ctx.log(t("log.seatclash", { seat: mySeat.toUpperCase() }));
  }

  /**
   * Sedersi a un tavolo: la stanza con quel nome, o la «solo» (nome vuoto:
   * partita locale o col bot). Un canale solo verso il tavolo (engine.ts),
   * per l'arbitro e per l'avversario insieme: si chiude quello di prima e se
   * ne apre uno nuovo, e la lavagna di una stanza con nome arriva dal
   * giornale del tavolo (rebuildFromJournal), non da un client.
   */
  function join(name: string): void {
    seatClashWarned = false;
    view.joining();
    room = name.trim();
    store.write("room", room);
    // In una stanza vera l'altra metà del tavolo è di qualcuno: il bot si
    // alza. Le sue carte spariscono con la lavagna, che in stanza si
    // ricostruisce dal giornale del tavolo.
    if (botDeckId && room) {
      botDeckId = null;
      botSeat = null;
      view.setAuto(null, botChooser);
    }
    connectTable();
  }

  /**
   * Il giornale della stanza (le azioni approvate dal tavolo, dal `newGame`
   * in poi) sostituisce la lavagna: lo stato è una funzione del giornale.
   * Arriva a ogni saluto — l'ingresso, la riconnessione, «Riallinea dal
   * tavolo». Mazzo e nome che mancano si rimettono, e stavolta passano dal
   * tavolo.
   */
  function rebuildFromJournal(entries: Parameters<typeof replay>[0]): void {
    const hadMine = Object.values(state.cards).some(card => card.owner === mySeat);
    state = replay(entries);
    paint();
    const incomingHasMine = Object.values(state.cards).some(card => card.owner === mySeat);
    // Il mio mazzo c'era e il tavolo non lo sa più (la stanza è stata
    // sparecchiata e riapparecchiata): si rimette, se il tavolo è aperto.
    if (hadMine && !incomingHasMine && myDeckId && !awaitingPeer && !deckDeferred && roomPeers >= 2) loadDeck(myDeckId, mySeat);
    // La mano iniziale che manca (§4): il giornale ha il mio mazzo ma non la
    // mia mano — la pagina è stata ricaricata prima che la pesca d'apertura
    // partisse, che è un tempo del client e non un'azione della lavagna. Al
    // turno 1 in Preparazione, a mazzo intero, la pesca riparte da qui;
    // altrimenti la mano vuota è vera.
    else if (incomingHasMine && myDeckId && state.players[mySeat].deckId === myDeckId && handSize(mySeat) === 0 && state.turn === 1 && state.phase === "preparazione" && deckUntouched(mySeat)) {
      scheduleOpening(mySeat, myDeckId);
    }
    // Il nome viaggia da qui: chi entra con stanza e mazzo già noti non passa
    // dall'accoglienza, e il giornale non lo sa ancora.
    const myName = store.read("name", "");
    if (myName && state.players[mySeat].name !== myName) {
      dispatch({ t: "player", seat: mySeat, patch: { name: myName } });
    }
  }

  /** Il saluto arriva a ogni riconnessione: in chat va una volta sola, salvo che l'engine sia cambiato nel frattempo (versione o regole). */
  let welcomed = "";

  function connectTable(): void {
    engine?.close();
    engine = null;
    engine = connectEngine(engineUrl, room, mySeat, {
      onStatus,
      onWelcome(version, rules) {
        // Nella stanza «solo» il tavolo parte con la copia vuota e il client
        // è la copia buona: gli si passa la lavagna com'è. In stanza no: la
        // lavagna arriva dal giornale, subito dopo il saluto.
        if (!room) engine?.snapshot(state);
        const signature = `${version}|${rules.join(",")}`;
        if (signature === welcomed) return;
        welcomed = signature;
        // In chat solo l'essenziale: la lista delle regole attive resta nel
        // protocollo, non nello storico della partita.
        ctx.log(msg("log.engine.hello", { version }));
      },
      onJournal: rebuildFromJournal,
      onAction(action, from) {
        // Un'azione col MIO posto come mittente non dovrebbe arrivare (il
        // tavolo rifiuta il secondo client sullo stesso posto): nel dubbio
        // si ignora e si dice forte.
        if (from === mySeat) {
          warnSeatClash();
          return;
        }
        // "Nuova partita" azzera il tavolo di entrambi: ognuno rimette poi il
        // proprio mazzo, perché il suo id è noto solo al suo client.
        receive(action);
        if (action.t === "newGame") {
          if (myDeckId) loadDeck(myDeckId, mySeat);
          reapplyName();
        }
      },
      onRtc(payload, from) {
        if (from !== mySeat) view.rtc(payload);
      },
      onSeatTaken: warnSeatClash,
    });
  }

  // ---------------------------------------------------------------- comandi

  function shuffle(): void {
    const order = shuffled(zoneCards(state, mySeat, "deck").map(card => card.uid));
    if (order.length === 0) return;
    dispatch({ t: "shuffle", seat: mySeat, order });
    ctx.log(msg("log.shuffle", { seat: mySeat, n: order.length }), mySeat);
  }

  function draw(): void {
    if (zoneCards(state, mySeat, "deck").length === 0) {
      ctx.log(msg("log.deck.empty.short", { seat: mySeat }), mySeat);
      return;
    }
    dispatch({ t: "draw", seat: mySeat, count: 1 });
    ctx.log(msg("log.draw1", { seat: mySeat }), mySeat);
  }

  function startNewGame(): void {
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
  }

  function reapplyName(): void {
    const myName = store.read("name", "");
    if (myName) dispatch({ t: "player", seat: mySeat, patch: { name: myName } });
  }

  // ------------------------------------------------------------------ il bot
  //
  // L'avversario automatico siede all'altra metà del tavolo — il suo mazzo
  // caricato al posto opposto, una partita senza stanza — e la gioca lui. Le
  // decisioni stanno in bot.ts (pure); qui la guida: a ogni ridisegno, se è
  // il suo momento, compie UN gesto — con le stesse azioni e lo stesso
  // arbitro di un giocatore — poi ridisegna e riparte. Per i gesti del suo
  // posto mira e conferme del tavolo rispondono da sole (view.setAuto:
  // legato al posto, così vale anche per gli effetti che si risolvono a
  // scena chiusa) e i «no» dell'arbitro non mostrano il sigillo: il bot
  // prende nota e cambia gesto. Le SCENE delle sue carte invece le chiude il
  // giocatore, con Continua o Risolvi: finché la scena è aperta il tavolo
  // non è fermo, e il bot aspetta.

  function startBot(deckId: string): void {
    if (!deckId) return;
    botDeckId = deckId;
    botSeat = otherSeat(mySeat);
    botMemory = freshMemory(state.turn);
    // Le scelte automatiche sono legate al posto del bot, non al momento:
    // valgono anche per gli effetti che si risolvono a scena chiusa.
    view.setAuto(botSeat, botChooser);
    dispatch({ t: "player", seat: botSeat, patch: { name: t("bot.name") } });
    loadDeck(deckId, botSeat);
    scheduleBot();
  }

  function scheduleBot(delay = BOT_PACE_MS): void {
    if (!botSeat) return;
    clearTimeout(botTimer);
    botTimer = setTimeout(() => void botTick(), delay);
  }

  const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

  async function awaitQuiet(limit = 15_000): Promise<void> {
    const start = Date.now();
    while (!view.quiet() && Date.now() - start < limit) await sleep(120);
  }

  const botChooser: AutoChooser = {
    pickTarget: (_source: CardInstance, candidates: CardInstance[]) => (botSeat ? pickBest(state, botSeat, candidates, ctx.card) : null),
    pickFromPile: (zone: ZoneId, candidates: CardInstance[]) =>
      botSeat ? pickBest(state, botSeat, candidates, ctx.card, zone === "hand" ? "weakest" : "auto") : null,
  };

  async function botTick(): Promise<void> {
    if (!botSeat || botBusy || state.over) return;
    // Le aperture (§4) prima di tutto: senza, il bot chiudeva il primo turno
    // a mano vuota e la sua pesca iniziale arrivava nel turno altrui.
    if (!view.quiet() || openingPending.a || openingPending.b) {
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
    // §7.2 — la catena: quando la parola è sua, il bot ci pensa un attimo
    // (così chi guarda vede la barra «può rispondere»), poi risponde con una
    // Reattiva che agisce, se ce l'ha e la paga — o accetta. Mentre la
    // catena si risolve, aspetta.
    if (s.chain) {
      if (!s.chain.resolving && s.chain.turn === bot) {
        await sleep(1400);
        const live = state;
        if (!live.chain || live.chain.resolving || live.chain.turn !== bot) return true;
        const answer = chooseResponse(live, bot, ctx.card);
        if (answer?.kind === "matter" && (await view.playFromHand(answer.card, answer.spot))) return true;
        await dispatch({ t: "pass", seat: bot });
        ctx.log(msg("log.chain.pass", { seat: bot }), bot);
        return true;
      }
      return false;
    }
    if (s.active === bot) {
      // §3.1 — il Rubyfront: prima lo schieramento, poi un'abilità speciale
      // (le gratuite in Preparazione prima delle carte, così lo sconto vale
      // per la carta che segue; il potenziamento in Fronte a ondata
      // dichiarata), poi il flip verso il Nexus appena il requisito c'è —
      // che riapre la finestra dell'abilità (state.ts, flip). Un «no»
      // dell'arbitro si annota e non si insiste.
      const rubyfrontMove = async (): Promise<boolean> => {
        const ability = chooseAbility(state, bot, ctx.card, botMemory);
        if (ability) {
          botMemory.abilities.add(ability.ability.id);
          if (await view.useAbility(ability.card, ability.ability)) return true;
        }
        const flip = chooseFlip(state, bot, ctx.card, botMemory);
        if (flip) {
          botMemory.flipped = true;
          if (await view.flipToNexus(flip)) return true;
        }
        return false;
      };
      if (s.phase === "preparazione") {
        if (await view.deployRubyfront(bot)) return true;
        if (await rubyfrontMove()) return true;
        const play = choosePlay(s, bot, ctx.card, botMemory);
        if (play) {
          if (play.useToken) {
            const player = s.players[bot];
            await dispatch({ t: "player", seat: bot, patch: { token: false, flux: player.flux + 1 } });
            ctx.log(msg("log.token.spend", { seat: bot }), bot);
          }
          const ok = play.kind === "object" ? await view.assignObject(play.card, play.to) : await view.playFromHand(play.card, play.spot);
          if (!ok) botMemory.tried.add(play.card.uid);
          else if (play.kind === "entity") botMemory.entered.add(play.card.uid);
          return true;
        }
        // §6.5 — sotto i 7 prima di chiudere: chi chiude a mano piena non chiude.
        const [discard] = chooseDiscards(s, bot, ctx.card);
        if (discard) {
          await dispatch({ t: "toZone", uid: discard.uid, zone: "ritiro" });
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
            await view.attackWith(attacker);
            await awaitQuiet();
            await sleep(350);
          }
          return true;
        }
        if (await rubyfrontMove()) return true;
        await endPhase(ctx);
        return true;
      }
      // Reazione: difende l'altro, e chiude lui (§6.4) — ma l'eccesso in mano
      // è di chi è di turno (§6.5): con più di 7 carte il bot scarta, o il
      // difensore non riuscirebbe mai a chiudere il suo turno.
      const [excess] = zoneCards(s, bot, "hand").length > 7 ? chooseDiscards(s, bot, ctx.card) : [];
      if (excess) {
        await dispatch({ t: "toZone", uid: excess.uid, zone: "ritiro" });
        ctx.log(msg("log.discard", { seat: bot, card: excess.cardId, n: zoneCards(state, bot, "hand").length }), bot);
        return true;
      }
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
      // §6.4/§7.2 — in Reazione il difensore gioca le sue Reattive: una che
      // agisce davvero (l'indebolimento dell'attaccante, la stappata), se la
      // paga — una sola per turno, poi la risoluzione.
      if (!botMemory.reacted) {
        botMemory.reacted = true;
        const answer = chooseResponse(s, bot, ctx.card);
        if (answer?.kind === "matter" && (await view.playFromHand(answer.card, answer.spot))) return true;
      }
      // Un respiro perché chi attacca veda i blocchi, poi la risoluzione.
      await sleep(1200);
      await endPhase(ctx);
      return true;
    }
    return false;
  }

  return {
    ctx,
    state: () => state,
    room: () => room,
    engine: () => engine,
    dispatch,
    commit,
    paint,
    myDeck: () => myDeckId,
    chooseDeck(deckId) {
      myDeckId = deckId;
      store.write("deck", deckId);
    },
    loadDeck,
    join,
    resync() {
      // Il tavolo rimanda saluto e giornale: la lavagna si ricostruisce da lì.
      engine?.hello();
      if (room) ctx.log(msg("log.resync"));
    },
    sendRtc: payload => (room && engine?.status() === "online" ? engine.sendRtc(payload) : false),
    shuffle,
    draw,
    newGame: startNewGame,
    reapplyName,
    seatOrWait,
    awaitingPeer: () => awaitingPeer,
    startBot,
    startBotWithIntro(botDeck, deckId) {
      // Prima l'ingresso dei Rubyfront (il tuo, poi il bot), poi l'insegna
      // e l'apertura: loadDeck li tiene in sospeso finché introPending.
      introPending = true;
      startBot(botDeck);
      if (deckId) loadDeck(deckId, mySeat);
      void runIntro();
    },
    botSeat: () => botSeat,
    leaveRoom() {
      clearTimeout(botTimer);
      awaitingPeer = false;
      deckDeferred = false;
      botSeat = null;
      view.setAuto(null, botChooser);
      botDeckId = null;
      join("");
      store.write("room", "");
    },
    resetTable() {
      void dispatch({ t: "newGame", active: randomSeat() });
      // Il nome dell'altro posto si cancella IN LOCALE (commit, non dispatch):
      // è una scritta, non un gesto di gioco, e l'arbitro fermerebbe un'azione
      // dell'altro posto fuori dal suo turno — col sigillo sopra la home.
      commit({ t: "player", seat: otherSeat(mySeat), patch: { name: "" } });
    },
  };
}
