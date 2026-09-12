// La partita del gioco: la sessione del core (core/src/session.ts) col suo
// tavolo Pixi. La sessione tiene lo stato, chiede il verdetto al tavolo Ruby
// per ogni azione e guida il bot; i gesti e gli effetti che scatenano stanno
// nel core (core/src/gestures.ts), gli stessi del simulatore. Qui la vista:
// il ridisegno, il sigillo dell'arbitro, le scene, il dado, la mira, la
// vetrina delle pile (F4) — e la resa (F5): l'insegna di fase, i voli delle
// carte, i colpi, le frecce, l'ingresso dei Rubyfront, i suoni e la musica,
// le mosse dell'avversario che si vedono anche qui.
//
// Sempre online (deciso 2026-09-11): anche la partita col bot passa dal
// tavolo Ruby (la stanza «solo»). Senza tavolo raggiungibile la «solo»
// resta libera, come nel simulatore.
//
// La partita nasce una volta, all'avvio, col posto di questo client
// (creaPartita); chi la guida — le schermate del gioco (gioco.ts, F6) o le
// prove da fuori (partitaControBot) — sceglie poi stanza, mazzi e bot, e
// ascolta la sessione dai ganci (l'attesa in stanza, il tavolo che si apre,
// la partita col bot finita).

import { cardName, cardStats, enterEffects } from "@rubyfront/core/cards";
import { defaultEngineUrl } from "@rubyfront/core/engine";
import { TRIGGER_LEAD_MS, TRIGGER_TAIL_MS, createGestures, type GestureView, type Gestures } from "@rubyfront/core/gestures";
import { t } from "@rubyfront/core/i18n";
import { createSession, type Session, type SessionStore, type SessionView } from "@rubyfront/core/session";
import { seatLabel, zoneCards } from "@rubyfront/core/state";
import { endPhase } from "@rubyfront/core/turn";
import type { Action, Seat } from "@rubyfront/core/types";
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
import { Scene } from "./table/scene";
import { Seal } from "./table/seal";
import { DRAW_STEP_MS, Table, drawCascadeMs } from "./table/table";
import { PileViewer } from "./table/pile-viewer";
import { FLY_MS, Flights } from "./table/flights";

/** Il tema delle carte del gioco: «Cattedrale Rubino», l'unico (deciso 2026-09-11). */
const CARD_THEME = "t49";
/** Fra la mano iniziale e la carta del turno 1, un respiro (main.ts del simulatore). */
const OPENING_DRAW_PAUSE_MS = 250;

/** La memoria del gioco nel browser: con un prefisso suo, separata da quella del simulatore. */
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

  // --- i suoni (main.ts del simulatore, cueFor): le fasi non suonano, i gesti sì.
  let lastDeclareAt = 0;
  const cue = (action: Action): void => {
    const state = session.state();
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
    if (action.t === "toZone" && action.zone === "field") {
      if (state.cards[action.uid]?.zone === "hand") playSound("play");
      return;
    }
    // La pesca: un suono per carta, col ritmo con cui entrano in mano — solo la propria.
    if (action.t === "draw" && action.seat === me) {
      const count = Math.min(action.count, zoneCards(state, me, "deck").length);
      for (let i = 0; i < count; i += 1) setTimeout(() => playSound("draw"), i * DRAW_STEP_MS);
      return;
    }
    // La carta del turno entra quando l'insegna se n'è andata: il suono la aspetta.
    if (action.t === "turn" && action.active === me && zoneCards(state, me, "deck").length > 0) {
      setTimeout(() => playSound("draw"), PHASE_BANNER_MS + 80);
    }
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
  const beforeCommit = (action: Action): (() => void) | undefined => {
    cue(action);
    reveal(action);
    return together(resolution(action), director?.before(action));
  };

  /** Un'azione dell'avversario, già approvata dal tavolo: la si vede anche qui — la giocata, gli effetti, i dadi, i voli. */
  const beforeReceive = (action: Action): (() => void) | undefined => {
    cue(action);
    reveal(action);
    const state = session.state();
    if (action.t === "toZone" && action.zone === "field") {
      const card = state.cards[action.uid];
      if (card && card.zone === "hand") {
        void scene.peek({
          cardId: card.cardId,
          face: card.face,
          theme: CARD_THEME,
          locale,
          who: t("scene.plays", { name: seatLabel(state, card.owner, me), card: `«${cardName(card.cardId, locale)}»` }),
          effects: enterEffects(card.cardId, card.face, locale),
        });
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
    if (action.t === "release") fly = flights.slide(action.uid);
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
    return together(fly, effects);
  };

  // Ciò che i gesti chiedono alla vista.
  const gestureView: GestureView = {
    render: () => paint(),
    light: (uid, on) => table.light(uid, on),
    hold: on => table.setBlocked(on),
    strike: (uid, ms) => table.strike(uid, ms),
    liftForFlight: (uid, zone) => flights.toPile(uid, zone ?? "ritiro"),
    liftToFlight: uid => flights.slide(uid),
    // Il gioco non ha la fila di servizio avversaria da aprire: il controllo scivola e basta.
    liftToDissolve: () => null,
    flyFromPile: (seat, zone, uid) => flights.fromPile(seat, zone, uid),
    opensFoeRow: () => false,
    timing: { fly: FLY_MS, dissolve: FLY_MS },
    roll: (faces, result, label) => dice.roll(faces, result, label),
    scene: show => scene.show(show),
    sceneIdle: () => scene.idle(),
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
      hooks.introDone?.();
    },
    botGameOver: won => hooks.botGameOver?.(won),
    joining: () => undefined,
    rtc: () => undefined,
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
    offerLeaveReturns: (before, after, owners) => gestures.offerLeaveReturns(before, after, owners),
    offerAssignTriggers: (before, after, owners) => gestures.offerAssignTriggers(before, after, owners),
    offerDeathRemains: (before, after, owners) => gestures.offerDeathRemains(before, after, owners),
    // Il tavolo è fermo: nessun sigillo, scena (né effetti di «Risolvi» in corso), dado, mira, scelta, effetto, insegna, ingresso, giocata in volo.
    // Sfogliare una pila non ferma nessuno (nel simulatore l'overlay non trattiene il bot).
    quiet: () =>
      !seal.isOpen() && scene.isFree() && dice.reducedMotion() && !aim.isOpen() && !pileViewer.isPicking() && !table.isBlocked() && !banner.isRunning() && !entrance.isRunning() && !director?.isBusy(),
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
  entrance.onLanding = uid => directorInstance.landing(uid);
  // La carta del turno aspetta che l'insegna se ne vada.
  table.entryDelay = () => banner.remaining();

  // Il gesto di fase: chiude la fase in corso (turn.ts, endPhase), passando
  // dall'arbitro come ogni altra azione.
  const closePhase = (): void => void endPhase(session.ctx);
  table.onEndPhase(closePhase);
  // Il browser non suona prima di un gesto: il contesto audio nasce al primo tocco.
  window.addEventListener("pointerdown", () => unlockSound(), { capture: true });

  stage.onLayout(() => paint());
  // La scena grande si apre dopo la giocata sul campo: la carta vola, si posa, si accende (effects/director.ts).
  scene.waitBefore(() => directorInstance.idle());
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
    expectEntrance: () => (directorInstance.entrancePending = true),
    closePhase,
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
