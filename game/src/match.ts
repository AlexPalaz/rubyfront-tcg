// La partita del gioco: la sessione del core (core/src/session.ts) col suo
// tavolo Pixi. La sessione tiene lo stato, chiede il verdetto al tavolo Ruby
// per ogni azione e guida il bot; i gesti e gli effetti che scatenano stanno
// nel core (core/src/gestures.ts). Qui la vista:
// il ridisegno, il sigillo dell'arbitro, le scene, il dado, la mira, la
// vetrina delle pile (F4) — e la resa (F5): l'insegna di fase, i voli delle
// carte, i colpi, le frecce, l'ingresso dei Rubyfront, i suoni e la musica,
// le mosse dell'avversario che si vedono anche qui.
//
// Sempre online (deciso 2026-09-11): anche la partita col bot passa dal
// tavolo Ruby (la stanza «solo»). Senza tavolo raggiungibile la «solo»
// resta libera.
//
// La partita nasce una volta, all'avvio, col posto di questo client
// (creaPartita); chi la guida — le schermate del gioco (gioco.ts, F6) o le
// prove da fuori (partitaControBot) — sceglie poi stanza, mazzi e bot, e
// ascolta la sessione dai ganci (l'attesa in stanza, il tavolo che si apre,
// la partita col bot finita).

import { cardName, cardStats, isRubyfront } from "@rubyfront/core/cards";
import { wornBy } from "@rubyfront/core/combat";
import { bestObjectCost, discountedCost } from "@rubyfront/core/effects";
import { defaultEngineUrl } from "@rubyfront/core/engine";
import { TRIGGER_LEAD_MS, TRIGGER_TAIL_MS, createGestures, sceneKey, type GestureView, type Gestures } from "@rubyfront/core/gestures";
import { t } from "@rubyfront/core/i18n";
import { createSession, type Session, type SessionStore, type SessionView } from "@rubyfront/core/session";
import { abilityDiscount, seatLabel } from "@rubyfront/core/state";
import { endPhase } from "@rubyfront/core/turn";
import type { Action, SceneRef, Seat } from "@rubyfront/core/types";
import { Director } from "./effects/director";
import type { Stage } from "./stage.js";
import { TABLE_MUSIC, playSound, startMusic, unlockSound } from "./sound";
import { Preview } from "./table/preview";
import { Dice } from "./table/dice";
import { Arrows } from "./table/arrows";
import { TableGestures } from "./table/gestures";
import { Entrance } from "./table/entrance";
import { Banner, PHASE_BANNER_MS } from "./table/banner";
import { Menu } from "./table/menu";
import { Aim } from "./table/aim";
import { Toast } from "./table/toast";
import { withoutSeat } from "./screens/chronicle";
import { isNotice, renderLog } from "@rubyfront/core/log";
import { Scene } from "./table/scene";
import { Seal } from "./table/seal";
import { Table, drawCascadeMs } from "./table/table";
import { PileViewer } from "./table/pile-viewer";
import { FLY_MS, Flights } from "./table/flights";

/** Il tema delle carte del gioco: «Cattedrale Rubino», l'unico (deciso 2026-09-11). */
const CARD_THEME = "t49";
/** Fra la mano iniziale e la carta del turno 1, un respiro. */
const OPENING_DRAW_PAUSE_MS = 250;

/** Gli Oggetti che escono con la loro Entità partono uno dopo l'altro. */
const WORN_STEP_MS = 180;

export const store: SessionStore = {
  read(key, fallback) {
    try {
      return localStorage.getItem(`rbf-game:${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(`rbf-game:${key}`, value);
    } catch {
      /* niente memoria: si gioca lo stesso */
    }
  },
};

export interface Match {
  session: Session;
  table: Table;
  gestures: Gestures;
  tableGestures: TableGestures;
  /** La mira degli effetti (§8.2): per le prove da fuori. */
  aim: Aim;
  /** La vetrina delle pile (§5): anche il catalogo dello strumento «Evoca» (game.ts). */
  pileViewer: PileViewer;
  scene: Scene;
  /** Gli avvisi in cima al tavolo (toast.ts): game.ts dice quando tacere. */
  toast: Toast;
  banner: Banner;
  seal: Seal;
  /** Gli effetti del tavolo e la loro regia (animazioni, 2026-09-12). */
  director: Director;
  /** La partita col bot comincia con l'ingresso dei Rubyfront: fino alla sua fine le fasi non si annunciano. */
  expectEntrance(): void;
  /** Il ridisegno di tutto dallo stato. */
  redraw(): void;
  /** Il gesto di fase, come il tasto in basso a destra: per le prove da fuori. */
  closePhase(): void;
  /** Il tavolo è fermo (la stessa quiete che aspetta il bot): per le prove da fuori. */
  isQuiet(): boolean;
}

export interface MatchOptions {
  seat: Seat;
  locale: string;
  /** Il tuo mazzo e quello del bot. */
  deck: string;
  botDeck: string;
}

/** Ciò che la sessione dice a chi guida la partita (SessionView): la rete, l'attesa, il tavolo che si apre, la fine col bot. */
export interface MatchHooks {
  engineStatus?: SessionView["engineStatus"];
  netStatus?: SessionView["netStatus"];
  waitForPeer?: SessionView["waitForPeer"];
  seated?: SessionView["seated"];
  introDone?: SessionView["introDone"];
  botGameOver?: SessionView["botGameOver"];
  /** Dopo ogni ridisegno (la chat). */
  afterPaint?(): void;
}

export interface CreateOptions {
  seat: Seat;
  locale: string;
  /** Il tavolo; senza, quello di ?engine= o di default (urlDelTavolo). */
  engineUrl?: string;
  hooks?: MatchHooks;
}

/** L'indirizzo del tavolo: ?engine= per le prove (mai un ws:// da una pagina https), se no quello di default (VITE_ENGINE_URL al build vince). */
export function tableUrl(): string {
  const param = new URLSearchParams(location.search).get("engine")?.trim() ?? "";
  if (param && !(location.protocol === "https:" && param.startsWith("ws://"))) return param;
  return defaultEngineUrl(location, import.meta.env.VITE_ENGINE_URL as string | undefined);
}

/** La partita di questo client: sessione, tavolo e vista, senza ancora stanza né mazzi. */
export function createMatch(stage: Stage, options: CreateOptions): Match {
  const me = options.seat;
  const locale = options.locale;
  const hooks = options.hooks ?? {};
  const table = new Table(stage, me, locale);
  const arrows = new Arrows(stage, table);
  const scene = new Scene(stage);
  const toast = new Toast(stage);
  const dice = new Dice(stage);
  const aim = new Aim(stage, table);
  aim.arrows = arrows;
  const pileViewer = new PileViewer(stage, locale);
  const menu = new Menu(stage);
  const banner = new Banner(stage, me, () => session.newGame());
  const seal = new Seal(stage);
  new Preview(stage, table, locale);

  // Ciò che vuole il ctx della sessione nasce dopo di lei.
  let gestures!: Gestures;
  let tableGestures: TableGestures | null = null;
  let flights!: Flights;
  let entrance!: Entrance;
  let director: Director | null = null;

  /** Il ridisegno: il tavolo, i gesti, le frecce, l'insegna, poi la catena che si risolve (§7.2). */
  const paint = (): void => {
    const state = session.state();
    table.show(state);
    tableGestures?.update();
    arrows.update(state);
    // Durante l'ingresso dei Rubyfront l'insegna tace: l'apertura la annuncia la sessione, a ingresso finito.
    // Aspetta anche le animazioni del regista (la risoluzione di un'ondata, una giocata): il turno nuovo si annuncia a tavolo fermo.
    if (!director?.entrancePending) {
      if (director?.isBusy()) void director.idle().then(() => banner.render(session.state()));
      else banner.render(state);
    }
    gestures.driveChain();
    director?.afterPaint(state);
    hooks.afterPaint?.();
  };

  /** Il bagliore di un effetto arrivato dall'avversario: la fonte si accende e si spegne col suo ritmo. */
  const flash = (uid: string, ms = TRIGGER_LEAD_MS + TRIGGER_TAIL_MS): void => {
    table.light(uid, true);
    setTimeout(() => table.light(uid, false), ms);
  };

  // --- i suoni (cueFor): le fasi non suonano, i gesti sì.
  let lastDeclareAt = 0;
  const cue = (action: Action): void => {
    if (action.t === "loadDeck" && action.seat === me) startMusic(TABLE_MUSIC);
    if (action.t === "newGame") startMusic(TABLE_MUSIC, true);
    if (action.t === "declare") {
      lastDeclareAt = Date.now();
      playSound(action.declaration.kind === "attack" ? "attack" : action.declaration.kind === "block" ? "block" : "counter");
      return;
    }
    // L'annullamento è muto; il tap che segue una dichiarazione non suona: un suono solo.
    if (action.t === "undeclare") {
      lastDeclareAt = Date.now();
      return;
    }
    if (action.t === "tap") {
      if (Date.now() - lastDeclareAt >= 600) playSound("tap");
      return;
    }
    // La giocata non suona qui: l'incastonamento parte all'urto sul tavolo (effects/director.ts, playSocket), a volo finito.
    if (action.t === "toZone" && action.zone === "field") return;
    // La pesca non suona qui: suona la carta quando compare in mano (table.onHandEntry), a tempo con lei.
  };

  /** «Mostrala all'avversario»: la carta che l'altro rivela da uno sguardo nel mazzo si vede anche qui. */
  const reveal = (action: Action): void => {
    if (action.t !== "look" || !action.reveal) return;
    const state = session.state();
    const card = state.cards[action.reveal];
    if (!card || card.owner === me) return;
    void scene.show({
      cardId: card.cardId,
      face: card.face,
      theme: CARD_THEME,
      locale,
      kicker: t("scene.reveal.kicker"),
      who: t("scene.reveals", { name: seatLabel(state, card.owner, me), card: `«${cardName(card.cardId, locale)}»` }),
      effects: [],
    });
  };

  /**
   * La risoluzione (effects/director.ts): ogni attaccante scatta sul bersaglio;
   * all'urto chi regge para o risponde, il Rubyfront colpito lampeggia col suo
   * numero, i morti si sbriciolano.
   */
  const resolution = (action: Action): (() => void) | null => director?.resolution(action) ?? null;

  /** Ciò che parte dopo il ridisegno: più di una cosa, in fila. */
  const together = (...parts: ((() => void) | null | undefined)[]): (() => void) | undefined => {
    const alive = parts.filter((part): part is () => void => typeof part === "function");
    return alive.length ? () => alive.forEach(part => part()) : undefined;
  };

  /** Un'azione propria (o del bot) sta per applicarsi: il suono, la carta rivelata, la risoluzione, gli effetti. */
  /**
   * L'avviso in cima al tavolo (toast.ts, dal 2026-09-15): le righe di chat
   * che raccontano un effetto — la pesca di un innesco, la carta tornata in
   * mano, l'Oggetto in Ritiro, il tiro a vuoto, il Fronte pieno — si vedono
   * anche senza aprire la chat, su entrambi i client.
   */
  const notify = (action: Action): void => {
    if (action.t !== "say" || action.entry.kind !== "log" || !action.entry.key || !isNotice(action.entry.key)) return;
    const state = session.state();
    const text = renderLog({ key: action.entry.key, ...(action.entry.params ? { params: action.entry.params } : {}) }, state, id => cardName(id, locale));
    const who = action.entry.seat ? seatLabel(state, action.entry.seat, me) : null;
    toast.show(who ? withoutSeat(text, who) : text, who ?? t("notice.kicker"));
  };

  /**
   * La mira dell'avversario (dal 2026-09-15, «sarebbe ottimo che anche
   * l'avversario veda cosa sto bersagliando»): viaggia sul canale rtc, senza
   * giudizio né giornale — la carta sotto il suo dito si accende qui, quella
   * scelta resta accesa un attimo.
   */
  let foeAim: string | null = null;
  const showFoeAim = (payload: unknown): void => {
    const message = payload as { kind?: unknown; uid?: unknown; chosen?: unknown } | null;
    if (!message || message.kind !== "aim") return;
    const uid = typeof message.uid === "string" ? message.uid : null;
    if (foeAim && foeAim !== uid) table.strike(foeAim, 0);
    foeAim = uid;
    if (uid) table.strike(uid, message.chosen === true ? 1600 : 60_000);
    if (message.chosen === true) foeAim = null;
  };

  const beforeCommit = (action: Action): (() => void) | undefined => {
    cue(action);
    reveal(action);
    notify(action);
    return together(resolution(action), director?.before(action), followFlights(action));
  };

  /**
   * I voli che seguono un'azione, propria o dell'avversario (2026-09-14,
   * «l'animazione non è chiara quando tornano le mie carte dall'Abisso»):
   * gli Oggetti che escono dal campo con la loro Entità vanno nella Zona di
   * Ritiro del proprietario, uno dopo l'altro (§3.1); la carta tenuta
   * nell'Abisso che torna sul Fronte (§8.2) vola dalla pila, dopo che le
   * altre sono arrivate (flights.ts, la fila dei ritorni).
   */
  const followFlights = (action: Action): (() => void) | null => {
    const state = session.state();
    if (action.t === "toZone" && (action.zone === "abisso" || action.zone === "ritiro") && state.cards[action.uid]?.zone === "field") {
      const worn = wornBy(state, action.uid).map(object => flights.toPile(object.uid, "ritiro"));
      if (worn.length === 0) return null;
      return () => {
        flights.holdReturns(WORN_STEP_MS * worn.length);
        worn.forEach((flight, index) => setTimeout(() => flight?.(), WORN_STEP_MS * (index + 1)));
      };
    }
    if (action.t === "release") {
      const back = state.cards[action.uid];
      if (back?.zone === "abisso" && action.zone === "field") return () => flights.fromPile(back.owner, "abisso", action.uid);
    }
    return null;
  };

  /** Un'azione dell'avversario, già approvata dal tavolo: la si vede anche qui — la giocata, gli effetti, i dadi, i voli. */
  const beforeReceive = (action: Action): (() => void) | undefined => {
    cue(action);
    reveal(action);
    notify(action);
    const state = session.state();
    // La giocata dell'avversario si vede anche qui, con «Continua»: entrambi
    // premono, e i suoi inneschi partono solo dopo (la stretta di mano,
    // 2026-09-15). La scena si legge dalla lavagna DOPO l'azione (afterEntry).
    // Vale anche per chi RIENTRA sul Fronte dal Ritiro o dall'Abisso (§8.2,
    // dal 2026-09-15): il ritorno per effetto, il ritorno vincolato, la fine
    // dell'esilio — un'Entità, con la sua scena d'ingresso.
    let afterEntry: (() => void) | null = null;
    const entering =
      action.t === "toZone" && action.zone === "field" ? action.uid
      : action.t === "revive" ? action.uid
      : action.t === "release" && action.zone === "field" ? action.uid
      : null;
    if (entering) {
      const card = state.cards[entering];
      const fromHand = card?.zone === "hand";
      const returning = card !== undefined && card.zone !== "field" && !fromHand && cardStats(card.cardId).kind === "entity";
      if (card && (fromHand || returning)) {
        const key = sceneKey({ kind: "enter", uid: entering }, state.turn);
        afterEntry = () => openTheirScene(key, { kind: "enter", uid: entering });
      }
    }
    if ((action.t === "draw" || action.t === "look") && action.effect) flash(action.effect.source);
    if (action.t === "look" && action.roll !== undefined && action.effect) {
      const source = state.cards[action.effect.source];
      const look = source ? cardStats(source.cardId).enterLooks.find(entry => entry.die !== null) : undefined;
      if (source && look?.die) void dice.roll(look.die, action.roll, t("dice.look", { name: cardName(source.cardId, locale) }));
    }
    let fly: (() => void) | null = null;
    if (action.t === "control") {
      table.strike(action.uid, TRIGGER_LEAD_MS + FLY_MS);
      flash(action.effect.source, 1600);
      fly = flights.slide(action.uid);
    }
    // Il controllo che torna scivola; dall'Abisso al Fronte vola dalla pila (followFlights).
    if (action.t === "release" && state.cards[action.uid]?.zone === "field") fly = flights.slide(action.uid);
    if (action.t === "toZone" && action.effect) {
      const moving = state.cards[action.uid];
      flash(action.effect.source, 1600);
      if (action.zone === "field" && moving && moving.zone !== "field") {
        const from = moving.zone;
        const owner = moving.owner;
        fly = () => flights.fromPile(owner, from, action.uid);
      } else {
        table.strike(action.uid, TRIGGER_LEAD_MS + FLY_MS);
        fly = flights.toPile(action.uid, action.zone === "abisso" ? "abisso" : "ritiro");
      }
    }
    // Il tiro dell'avversario si vede anche qui: la carta scende insieme, il momento è lo stesso.
    if (action.t === "move" && action.roll !== undefined) {
      const die = cardStats(state.cards[action.uid]?.cardId ?? "").deployment?.die ?? 6;
      void dice.roll(die, action.roll, t("dice.deploy"));
    }
    if (action.t === "resolve") fly = resolution(action);
    const effects = director?.before(action);
    // Il ritorno vincolato dell'avversario (§8.2): la carta e l'Oggetto volano dalle sue pile al Fronte.
    if (action.t === "revive") {
      const back = state.cards[action.uid];
      const object = state.cards[action.object];
      if (back && object) {
        const zone = back.zone;
        fly = () => {
          flights.fromPile(back.owner, zone, action.uid);
          flights.fromPile(object.owner, "ritiro", action.object);
        };
      }
    }
    return together(fly, effects, followFlights(action), afterEntry);
  };

  // La stretta di mano delle scene (2026-09-15): le scene dell'avversario
  // aperte qui, per chiave — la giocata all'ingresso, le altre quando arriva
  // il suo «pronto» —, e il «pronto» che parte da qui premendo «Continua».
  const theirScenes = new Set<string>();
  const openTheirScene = (key: string, ref: SceneRef): void => {
    if (theirScenes.has(key)) return;
    const show = gestures.sceneFor(ref);
    if (!show) return;
    theirScenes.add(key);
    void scene.show({ ...show, onContinue: () => session.ctx.acknowledge?.(key) });
  };

  // Ciò che i gesti chiedono alla vista.
  const gestureView: GestureView = {
    render: () => paint(),
    light: (uid, on) => table.light(uid, on),
    hold: on => table.setBlocked(on),
    waiting: on => aim.nameplate(on ? t("sync.waiting") : null),
    strike: (uid, ms) => table.strike(uid, ms),
    liftForFlight: (uid, zone) => flights.toPile(uid, zone ?? "ritiro"),
    liftToRetire: uid => flights.retire(uid),
    liftToFlight: uid => flights.slide(uid),
    // Il gioco non ha la fila di servizio avversaria da aprire: il controllo scivola e basta.
    liftToDissolve: () => null,
    flyFromPile: (seat, zone, uid) => flights.fromPile(seat, zone, uid),
    opensFoeRow: () => false,
    timing: { fly: FLY_MS, dissolve: FLY_MS },
    roll: (faces, result, label) => dice.roll(faces, result, label),
    scene: show => scene.show(show),
    // Gli inneschi di risoluzione (il ritorno vincolato, il Vestigio, gli
    // Oggetti in Ritiro) aspettano anche il tavolo fermo: prima le animazioni
    // di battaglia, poi le finestre di scelta (2026-09-17, «contro Immortale
    // Vincolato è comparso subito il popup»).
    sceneIdle: async () => {
      await scene.idle();
      await stillTable();
      await scene.idle();
    },
    notice: message => scene.notice(message),
    confirm: (question, labels) => scene.confirm(question, labels),
    choose: show => scene.choose(show),
    pickTarget: (source, candidates, hint) => aim.choose(candidates, hint, source.uid),
    // §7.2 — la Reattiva col bersaglio: al centro, accesa, prima della scena e della mira (effects/director.ts).
    stageReactive: card => director?.stageReactive(card) ?? null,
    pickFromPile: (_seat, _zone, candidates, title, visible) => pileViewer.choose(candidates, title, visible),
  };

  const view: SessionView = {
    render: () => paint(),
    stop: verdict => seal.show(verdict),
    beforeCommit: action => beforeCommit(action),
    beforeReceive: action => beforeReceive(action),
    engineStatus: status => hooks.engineStatus?.(status),
    netStatus: (status, peers) => hooks.netStatus?.(status, peers),
    waitForPeer: () => hooks.waitForPeer?.(),
    seated: () => hooks.seated?.(),
    announce: () => {
      banner.announce(session.state());
      director?.announce(session.state());
    },
    introDone: () => {
      if (director) director.entrancePending = false;
      entrance.release();
      hooks.introDone?.();
    },
    botGameOver: won => hooks.botGameOver?.(won),
    joining: () => undefined,
    rtc: payload => showFoeAim(payload),
    // I gesti del bot: le stesse vie del giocatore, con le loro scene.
    setAuto: (seat, chooser) => gestures.setAuto(seat, chooser),
    playFromHand: (card, spot) => gestures.playFromHand(card, spot),
    assignObject: (card, bearer) => gestures.assignObject(card, bearer),
    deployRubyfront: seat => gestures.deployRubyfront(seat),
    attackWith: card => gestures.attackWith(card),
    useAbility: (card, ability) => gestures.useAbility(card, ability),
    flipToNexus: card => gestures.flipToNexus(card),
    introRubyfronts: order => entrance.rubyfronts(order),
    // §6.5 — il Fine turno fermato dalla mano piena: la Zona di Ritiro si accende (gestures.ts, l'invito a scartare).
    promptDiscard: seat => playerGestures.promptDiscard(seat),
    offerTurnStart: (after, owners) => gestures.offerTurnStart(after, owners),
    offerLeaveReturns: (before, after, owners) => gestures.offerLeaveReturns(before, after, owners),
    offerAssignTriggers: (before, after, owners) => gestures.offerAssignTriggers(before, after, owners),
    offerDeathRemains: (before, after, owners) => gestures.offerDeathRemains(before, after, owners),
    resolveAttacks: () => gestures.resolveAttacks(),
    offerReturned: (before, after, owners) => gestures.offerReturned(before, after, owners),
    ready: action => {
      if (action.scene) openTheirScene(action.key, action.scene);
    },
    // Il tavolo è fermo: nessun sigillo, scena (né effetti di «Risolvi» in corso), dado, mira, scelta, effetto, insegna, ingresso, giocata in volo, volo di carte, cascata della pesca.
    // Sfogliare una pila non ferma nessuno: la vetrina non trattiene il bot.
    quiet: () =>
      !seal.isOpen() && scene.isFree() && dice.reducedMotion() && !aim.isOpen() && !pileViewer.isPicking() && !table.isBlocked() && !banner.isRunning() && !entrance.isRunning() && !director?.isBusy() && flights.isStill() && table.isStill(),
  };

  const session = createSession({
    seat: me,
    locale,
    store,
    engineUrl: options.engineUrl ?? tableUrl(),
    defaultTheme: CARD_THEME,
    // I tempi dell'apertura (§4): la mano dopo l'insegna, la carta del turno dopo la cascata della mano.
    opening: { hand: PHASE_BANNER_MS + 80, turnDraw: drawCascadeMs(6) + OPENING_DRAW_PAUSE_MS },
    view,
  });
  // La mia mira si vede anche di là (la carta sotto il dito, quella scelta).
  aim.onAim = (uid, chosen) => void session.sendRtc({ kind: "aim", uid, chosen });
  gestures = createGestures(session.ctx, gestureView);
  flights = new Flights(stage, table, session.ctx);
  entrance = new Entrance(stage, table, session.ctx, gestures);
  const playerGestures = new TableGestures(stage, table, session.ctx, gestures, aim, me, paint, menu, pileViewer, arrows);
  tableGestures = playerGestures;
  const directorInstance = new Director(stage, table, session.ctx, () => playerGestures.lastRelease, {
    parry: (uid, kind) => flights.clash(uid, kind),
    struckRubyfront: uid => table.strike(uid, TRIGGER_LEAD_MS + FLY_MS),
  });
  director = directorInstance;
  // L'ingresso dei Rubyfront: l'atterraggio senza il suono della giocata (scelta del designer, 2026-09-12).
  entrance.onLanding = uid => directorInstance.landing(uid, 1.5, false);
  // La carta del turno aspetta che l'insegna se ne vada.
  table.entryDelay = () => banner.remaining();
  // La pesca suona quando la carta compare in mano, non a tempo fisso dall'azione (2026-09-14).
  table.onHandEntry = () => playSound("draw");
  // Il costo di adesso delle carte in mano (2026-09-13): lo sconto di
  // un'abilità del Rubyfront, quello di una Materia con le armate sul Fronte,
  // e per un Oggetto quello del miglior portatore in campo («gli Oggetti
  // che assegni a questa Entità costano N in meno», 2026-09-15) — lo stesso
  // conto della giocata (core/gestures.ts), senza il bersaglio: quello si
  // sa solo mirando, e il costo vero lo dice il portatore su cui si posa.
  table.costOf = card => {
    if (card.zone !== "hand" || isRubyfront(card.cardId)) return null;
    const facts = session.ctx.card(card.cardId);
    if (facts.fluxCost === null) return null;
    const state = session.state();
    let now = facts.kind === "matter" ? (discountedCost(state, card, null, session.ctx.card) ?? facts.fluxCost) : facts.fluxCost;
    if (facts.kind === "object") now = bestObjectCost(state, card, session.ctx.card) ?? facts.fluxCost;
    const off = abilityDiscount(state, card.owner, facts);
    if (off) now = Math.max(0, now - off.amount);
    return now < facts.fluxCost ? { printed: facts.fluxCost, now } : null;
  };

  // Il gesto di fase: chiude la fase in corso (turn.ts, endPhase), passando
  // dall'arbitro come ogni altra azione. Prima aspetta che il tavolo sia
  // fermo — le scene chiuse (dissolvenza compresa), i passi di «Risolvi»
  // finiti, la carta giocata posata — così l'insegna della fase nuova non
  // cade sopra la carta della scena (2026-09-15); e una chiusura alla volta.
  let closing = false;
  const closePhase = (): void => {
    if (closing) return;
    closing = true;
    void (async () => {
      try {
        await scene.idle();
        await gestures.settled();
        await stillTable();
        await endPhase(session.ctx);
      } finally {
        closing = false;
      }
    })();
  };
  table.onEndPhase(closePhase);
  // Il tasto della fila avversaria cambia l'impaginazione: si ridisegna tutto, gesti e frecce compresi («Schiera» resta sulla carta).
  table.onRelayout(() => paint());
  // Il browser non suona prima di un gesto: il contesto audio nasce al primo tocco.
  window.addEventListener("pointerdown", () => unlockSound(), { capture: true });

  stage.onLayout(() => paint());
  /**
   * Il tavolo fermo (2026-09-16, «quando compare una scena non devono
   * esserci animazioni dietro»): la giocata che vola e si posa
   * (effects/director.ts), i voli delle carte, la cascata della pesca, il
   * dado, l'insegna di fase e l'ingresso dei Rubyfront — tutto finito,
   * e per un fotogramma intero, prima di andare avanti. Ogni pezzo può
   * accenderne un altro (il volo che atterra accende la pila): si torna a
   * guardare finché non tace tutto insieme.
   */
  const stillTable = async (): Promise<void> => {
    const moving = (): boolean => directorInstance.isBusy() || !flights.isStill() || !table.isStill() || !dice.reducedMotion() || banner.isRunning() || entrance.isRunning();
    for (;;) {
      await Promise.all([directorInstance.idle(), flights.idle(), table.idle()]);
      if (!moving()) {
        await nextFrame();
        if (!moving()) return;
      }
      await nextFrame();
    }
  };
  const nextFrame = (): Promise<void> => new Promise(resolve => stage.app.ticker.addOnce(() => resolve()));
  // La scena grande si apre a tavolo fermo.
  scene.waitBefore(stillTable);
  return {
    session,
    table,
    gestures,
    tableGestures: playerGestures,
    aim,
    pileViewer,
    scene,
    banner,
    seal,
    director: directorInstance,
    expectEntrance: () => {
      directorInstance.entrancePending = true;
      entrance.prepare();
    },
    closePhase,
    toast,
    isQuiet: () => view.quiet(),
    redraw: paint,
  };
}

/** Una partita contro il bot, subito, al tavolo Ruby della stanza «solo» (?match=bot: i banchi di prova). */
export function matchAgainstBot(stage: Stage, options: MatchOptions): Match {
  const match = createMatch(stage, { seat: options.seat, locale: options.locale });
  const { session } = match;
  session.join("");
  session.chooseDeck(options.deck);
  // Prima l'ingresso dei Rubyfront (il tuo, poi il bot), poi l'insegna e l'apertura.
  match.expectEntrance();
  session.startBotWithIntro(options.botDeck, options.deck);
  session.paint();
  return match;
}
