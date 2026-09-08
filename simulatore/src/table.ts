// Il tavolo: la lavagna, le pile, le due mani.
//
// Il disegno è "riconciliato", non ricostruito: ogni carta ha un solo elemento
// DOM, che viene spostato da una zona all'altra. Ricrearlo a ogni cambio di
// stato significherebbe rilanciare il renderer e `fitTextBoxes` su decine di
// carte a ogni mossa — e vedere la mano sfarfallare a ogni tiro di dado.

import { msg, t } from "./i18n.js";
import { createArrowLayer, drawArrows, type Arrow } from "./arrows.js";
import { createCardEl, fitPending, setTessPower, syncCardEl, wirePreview } from "./cardview.js";
import { playSound } from "./sound.js";
import { declareAttack as declareAttackVia, declareBlock, neverTaps, powerOf, staticPower, undeclare, wornBy } from "./combat.js";
import { tapPreview } from "./preview.js";
import {
  COMPACT_TILE_H,
  fromViewPoint,
  surfaceViewW,
  viewOf,
  CONTROL_X,
  FRONT_SLOT_X,
  FRONT_W,
  FRONT_X,
  MATTER_X,
  RUBYFRONT_X,
  SLOT_X,
  SURFACE_H,
  SURFACE_W,
  backRowY,
  frontRowY,
  bandViewH,
  isCompactView,
  isRecessView,
  isTightView,
  setTightView,
  surfaceViewH,
  setViewSlack,
  setCornerReserve,
  setLabelRoom,
  setFoeBackRow,
  hasFoeBackRow,
  tileViewH,
  toView,
  viewBandTop,
  type Ctx,
} from "./ctx.js";
import { showRoll } from "./dice.js";
import { confirmEffect, noticeEffect, showEnterEffect } from "./effect.js";
import {
  describeControl,
  describeRefresh,
  describeLook,
  describeMove,
  describeReturn,
  describeTrigger,
  enterControls,
  enterLooks,
  enterRefreshes,
  enterMoves,
  enterReturns,
  enterTriggers,
  lookAfterRoll,
  returnsFor,
  attackDraws,
  describeAttackDraw,
  resolveAttackDraw,
  resolveAttackDiscard,
  type AttackDrawStep,
  attackSteps,
  attackRef,
  attackersOf,
  describeAttackStep,
  inRange,
  otherArmed,
  pendingGrants,
  rollDie,
  type AttackStep,
  resolveControl,
  resolveLook,
  resolveRefresh,
  resolveMove,
  resolveReturn,
  resolveTrigger,
  type EnterControlStep,
  type EnterLookStep,
  type EnterRefreshStep,
  type EnterMoveStep,
  type EnterReturnStep,
  describeFlipStep,
  describeResolveStep,
  discountedCost,
  flipRef,
  flipSteps,
  nexusCheck,
  pendingResolve,
  blocksAttacker,
  resolveSteps,
  resolveRef,
  wantsTargetOnPlay,
  type FlipStep,
  type ResolveStep,
} from "./effects.js";
import { enableDrag, enableLongPress, type Drop } from "./drag.js";
import { openMenu, type MenuItem } from "./menu.js";
import {
  TILE_H,
  TILE_W,
  attackEffects,
  cardName,
  cardStats,
  enterEffects,
  faceCount,
  faceKind,
  isRubyfront,
  type Deployment,
  abilityCopy,
} from "./renderer.js";
import {
  STACK_STEP,
  controllerOf,
  declarationOf,
  fieldCards,
  matterSpot,
  phaseCloser,
  playSpot,
  seatLabel,
  seatWaiting,
  shuffled,
  stackAt,
  zoneCards,
  freeFrontSlotOrNull,
  nextWaveOrder, chainTop,
  abilityDiscount,
  inPlay,
} from "./state.js";
import type { CardInstance, Discount, EffectRef, GameState, Seat, ZoneId } from "./types.js";
import type { Ability } from "./ctx.js";
import { SEATS, otherSeat } from "./types.js";

// Le tre pile stanno in fila a destra, nella riga di servizio. Il Mazzo è
// coperto per definizione (§5); Abisso e Zona di Ritiro sono pubblici e
// mostrano la carta in cima.
const PILES: { zone: ZoneId; label: string; x: number; hidden: boolean }[] = [
  { zone: "abisso", label: "zone.abisso", x: SLOT_X.abisso, hidden: false },
  { zone: "ritiro", label: "zone.ritiro", x: SLOT_X.ritiro, hidden: false },
  { zone: "deck", label: "zone.deck", x: SLOT_X.deck, hidden: true },
];

/** Tempi della pesca animata (`card-drawn` in style.css): corsa di una carta
    e passo della cascata. Stanno qui, esportati, perché chi accoda una pesca
    all'altra (main.ts: la carta del turno 1 dopo la mano iniziale) deve
    sapere quando la prima ha finito di muoversi. */
export const DRAW_RUN_MS = 380;
export const DRAW_STEP_MS = 70;
/** Quanto dura, in tutto, l'entrata in cascata di `count` carte. Zero con
    prefers-reduced-motion: lì l'animazione è spenta e non c'è da aspettare. */
export function drawCascadeMs(count: number): number {
  if (count <= 0) return 0;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
  return (count - 1) * DRAW_STEP_MS + DRAW_RUN_MS;
}

/** La mano rispetto al campo: in vista normale le carte in mano stanno un
    30% sopra la scala del campo (sono quelle da leggere e da giocare), in
    compatta alla scala del campo — il cassetto deve starci sotto il tavolo.
    Specchio di --hand-boost in style.css. */
const HAND_BOOST = 1.3;
const HAND_BOOST_COMPACT = 1;
/** …e fin dove può crescere quando sotto la lavagna resta spazio. */
const HAND_BOOST_COMPACT_MAX = 1.5;
/** La cornice del cassetto oltre la carta (i 48px di --hand-h). */
const HAND_CHROME = 48;
/** Un'etichetta sotto un riquadro: stacco (10), rigo di testo (20), aria (12); pixel reali. */
const LABEL_ROOM_PX = 42;
/** La testata del campo sporge dentro il campo di metà della sua altezza (15px), più l'aria. */
const HEAD_ROOM_PX = 24;
/** In cima al tavolo la testata sporge SOPRA l'orlo, verso l'header: 15px di sporgenza e 25 d'aria. */
const TOP_ROOM_PX = 40;
/** Il pannello delle pile avversarie, in testa al campo avversario, sta a cavallo dell'orlo come la targhetta
    (15px sopra): dentro il campo ne restano 17 di testata, più 12 d'aria. */
const DOCK_ROOM_PX = 30;

/** Le scelte del bot al posto delle finestre (bot.ts, pickBest). */
/** Il volo di una carta verso una pila: si fa partire, o si annulla se l'azione non è passata. */
export type Flight = (() => void) & { cancel(): void };

export interface AutoChooser {
  pickTarget(source: CardInstance, candidates: CardInstance[]): CardInstance | null;
  pickFromPile(zone: ZoneId, candidates: CardInstance[], visible?: CardInstance[]): CardInstance | null;
}

export interface TableView {
  render(): void;
  /** Rifà la geometria di vista (misure, zone, scala): per il cambio di
      modo compatto/normale a caldo. Le carte restano dove sono. */
  refreshLayout(): void;
  /** Le targhe dei posti (Gettone, PV, Flusso), da appendere in testa a ciascun campo: le fornisce hud.ts. */
  onStats(provider: (seat: Seat) => HTMLElement): void;
  /** Callback per aprire la ricerca: la fornisce main.ts. */
  onBrowse(handler: (seat: Seat, zone: ZoneId) => void): void;
  /** La lista delle carte controllate (§8.2), con un menu per carta: la apre main.ts. */
  onListControl(handler: (seat: Seat, cards: () => CardInstance[], menuFor: (card: CardInstance) => MenuItem[]) => void): void;
  /**
   * Il bot (main.ts): il selettore che risponde a mira e pile al posto
   * delle finestre, e i gesti del tavolo che il bot compie — giocare dalla
   * mano, armare un'Entità, schierare il Rubyfront, attaccare — con le
   * stesse scene ed effetti di un giocatore.
   */
  setAuto(seat: Seat | null, chooser: AutoChooser): void;
  playFromHand(card: CardInstance, spot: { x: number; y: number }): Promise<boolean>;
  assignObject(card: CardInstance, bearer: CardInstance): Promise<boolean>;
  /** Vero se ha schierato (o tirato); falso se lo schieramento non passerebbe. */
  deployRubyfront(seat: Seat): Promise<boolean>;
  attackWith(card: CardInstance): Promise<void>;
  /** Callback per scegliere una carta da una pila (effetti): la fornisce main.ts. */
  onPick(
    handler: (seat: Seat, zone: ZoneId, candidates: CardInstance[], title: string, visible?: CardInstance[]) => Promise<CardInstance | null>
  ): void;
  /** §6.5 — il Fine turno fermato dalla mano piena: da qui l'Abisso di quel
      posto si accende e invita, finché non si scarta o non cambia il turno.
      Dice se l'ha acceso ADESSO: il sigillo lo vede solo chi ha premuto, e
      la riga in chat che avvisa l'avversario va scritta una volta sola. */
  promptDiscard(seat: Seat): boolean;
  /** Il bagliore di una carta che si innesca: per gli effetti arrivati dalla rete. */
  flash(uid: string, ms?: number): void;
  /** Il lampo rosso sulla carta colpita da un effetto, per un attimo. */
  strike(uid: string): void;
  /** Prende la tessera prima che voli in una pila (chi riceve): ritorna il
      via al volo, da dare dopo aver applicato l'azione. */
  liftForFlight(uid: string, zone?: "ritiro" | "abisso"): Flight | null;
  /** Il volo da una pila al campo (chi riceve): dopo aver applicato l'azione. */
  flyFromPile(seat: Seat, zone: ZoneId, uid: string): void;
  /** Il volo da dove sta a dove starà (controllo, restituzione): prima
      dell'azione; ritorna il via, da dare dopo il disegno. */
  liftToFlight(uid: string): (() => void) | null;
}

/**
 * Le icone della Potenza e del Contrattacco stampati (card-render.js,
 * createPowerBadge e createCounterattackBadge), in currentColor: i segni
 * sulle tessere sono pezzi della carta, non adesivi sopra.
 */
const SWORDS_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<line x1="4.8" y1="19.2" x2="19.8" y2="4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '<line x1="19.2" y1="19.2" x2="4.2" y2="4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '<line x1="4.3" y1="15.4" x2="8.6" y2="19.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
  '<line x1="19.7" y1="15.4" x2="15.4" y2="19.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
  '<circle cx="3.4" cy="20.6" r="1.15" fill="currentColor"/>' +
  '<circle cx="20.6" cy="20.6" r="1.15" fill="currentColor"/>' +
  "</svg>";
const COUNTER_SVG =
  '<svg viewBox="0 0 20 20" aria-hidden="true">' +
  '<path d="M 4.5 12.5 A 6 6 0 1 1 10 16.5" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
  '<path d="M 4.5 12.5 L 2 9.8 M 4.5 12.5 L 8 11.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
  "</svg>";

export function mountTable(root: HTMLElement, ctx: Ctx): TableView {
  const tiles = new Map<string, HTMLElement>();
  let browse: (seat: Seat, zone: ZoneId) => void = () => {};
  /** La lista delle carte controllate (§8.2), con un menu per carta: la
      apre main.ts nell'overlay. */
  let listControlHandler: (seat: Seat, cards: () => CardInstance[], menuFor: (card: CardInstance) => MenuItem[]) => void = () => {};
  function listControlled(seat: Seat): void {
    const cards = (): CardInstance[] =>
      fieldCards(ctx.state())
        .filter(card => card.controller === seat && !card.assignedTo)
        .sort((first, second) => first.z - second.z);
    listControlHandler(seat, cards, card => cardMenu(card));
  }
  /** I riquadri del Rubyfront, per posto: cambiano stato col Richiamo. */
  const rubySlots = new Map<Seat, HTMLElement>();
  /** Le zone esistono già? Al primo fitScale (che gira PRIMA del primo
      buildStaticZones) non c'è ancora niente da ridisegnare — e chiederlo
      toccherebbe const non ancora inizializzate. */
  let zonesReady = false;
  /** Rincasso: il pannello ripiegabile con le pile avversarie, sopra il suo campo. */
  let pileDock: HTMLElement | null = null;
  /** …e dentro il pannello, la mano avversaria: dorsi in pila, col conto.
      In rincasso non è più una fascia in cima al tavolo. */
  let dockHand: HTMLElement | null = null;
  const PILE_DOCK_KEY = "rbf-sim:piledock";
  /** Il pannello parte CHIUSO (scelta del designer, 2026-09-07): si apre
      solo chi l'ha aperto l'ultima volta. */
  function pileDockOpen(): boolean {
    try {
      return localStorage.getItem(PILE_DOCK_KEY) === "open";
    } catch {
      return false;
    }
  }
  /** La scelta di questa seduta: prima del primo click vale quella salvata
      (ma a lavagna piccola si parte chiusi). */
  let pileChoice: boolean | null = null;
  function foePilesOpen(): boolean {
    return pileChoice ?? (pileDockOpen() && !isTightView());
  }
  function setPileDockOpen(open: boolean): void {
    try {
      localStorage.setItem(PILE_DOCK_KEY, open ? "open" : "closed");
    } catch {
      /* niente memoria: si riparte chiuso */
    }
    pileChoice = open;
    // Il pannello si apre e si chiude sul posto, con la sua transizione
    // (style.css, .pile-dock-body): niente geometria da rifare.
    pileDock?.classList.toggle("is-collapsed", !open);
  }
  /** La scelta da una pila per un effetto: la fornisce main.ts (overlay). */
  let pickFromPileUi: (
    seat: Seat,
    zone: ZoneId,
    candidates: CardInstance[],
    title: string,
    visible?: CardInstance[]
  ) => Promise<CardInstance | null> = () => Promise.resolve(null);
  /** Il selettore automatico del bot (main.ts), legato al SUO posto: per
      i gesti di quel posto mira, pile e conferme rispondono da sole, senza
      finestre — anche negli effetti che si risolvono dopo, a scena chiusa.
      I gesti dell'altro posto restano del giocatore. */
  let auto: { seat: Seat; chooser: AutoChooser } | null = null;
  const isAuto = (seat: Seat): boolean => auto !== null && auto.seat === seat;
  const pickFromPile = (
    seat: Seat,
    zone: ZoneId,
    candidates: CardInstance[],
    title: string,
    visible?: CardInstance[]
  ): Promise<CardInstance | null> => {
    if (auto && isAuto(seat)) return Promise.resolve(auto.chooser.pickFromPile(zone, candidates, visible));
    return pickFromPileUi(seat, zone, candidates, title, visible);
  };
  /** La conferma di un effetto: per il bot è un sì, per il giocatore la finestra. */
  const confirmFor = (seat: Seat, question: string, labels?: { yes: string; no: string }): Promise<boolean> =>
    isAuto(seat) ? Promise.resolve(true) : confirmEffect(root, question, labels);
  /** Uid della carta in trascinamento: non va riposizionata dal render. */
  let dragging: string | null = null;
  /**
   * Da dove è partita la carta presa in mano: il trascinamento è condiviso
   * IN DIRETTA (onDragMove manda i move mentre trascini), quindi se al
   * rilascio l'engine ferma il gesto i pixel hanno già viaggiato — e la
   * carta deve poter tornare esattamente qui.
   */
  let dragOrigin: { x: number; y: number; z: number } | null = null;
  /**
   * Dichiarazione di blocco in corso: si è scelto l'attaccante e si sta
   * scegliendo con chi bloccarlo. `pointer` è la punta della freccia in volo.
   */
  /**
   * Il modo bersaglio: si sceglie una carta sul campo. Per i blocchi
   * (§6.3) l'attaccante da fermare; per un effetto (§8.2) il bersaglio fra
   * i candidati — la freccia parte dalla fonte e segue il dito.
   */
  type Targeting =
    | { mode: "block"; attacker: string; kind: "block" | "counter"; pointer: { x: number; y: number } | null }
    | {
        mode: "effect";
        source: string;
        candidates: Set<string>;
        pointer: { x: number; y: number } | null;
        pick: (card: CardInstance) => void;
        cancel: () => void;
      };
  let targeting: Targeting | null = null;
  /** Frecce di passaggio (un effetto che agisce): si spengono da sole. */
  let transientArrows: { arrow: Arrow; until: number }[] = [];
  /** Quando è finito l'ultimo trascinamento: il click che lo chiude non apre le pile. */
  let lastDropAt = 0;

  const surface = document.createElement("div");
  surface.className = "surface";
  surface.dataset.drop = "field";

  /** Larghezza fissa, altezza di VISTA (la compatta la stringe). Il transform
      di scala (style.css) non riduce l'ingombro nello scroll: lo pareggiano i
      margini, che tolgono esattamente la parte non disegnata. */
  function applySurfaceSize(): void {
    surface.style.width = `${surfaceViewW()}px`;
    surface.style.height = `${surfaceViewH()}px`;
    surface.style.marginRight = `calc(${surfaceViewW()}px * (var(--card-scale) - 1))`;
    surface.style.marginBottom = `calc(${surfaceViewH()}px * (var(--card-scale) - 1))`;
    // Anche lo strato delle frecce segue la misura di vista: alto quanto la
    // superficie canonica, allungherebbe lo scorrimento da sotto, invisibile.
    arrowLayer.setAttribute("width", String(surfaceViewW()));
    arrowLayer.setAttribute("height", String(surfaceViewH()));
    arrowLayer.setAttribute("viewBox", `0 0 ${surfaceViewW()} ${surfaceViewH()}`);
  }
  // Le frecce stanno sopra le carte: una punta nascosta sotto una tessera non
  // direbbe niente. Lo strato è inerte al puntatore.
  const arrowLayer = createArrowLayer(SURFACE_W, SURFACE_H);
  surface.append(arrowLayer);
  applySurfaceSize();

  const board = document.createElement("div");
  board.className = "board";
  board.append(surface);

  const oppHand = document.createElement("div");
  oppHand.className = "hand hand-opponent";
  const oppTag = document.createElement("span");
  oppTag.className = "hand-tag";
  oppHand.append(oppTag);

  const myHand = document.createElement("div");
  myHand.className = "hand hand-mine";
  myHand.dataset.drop = "hand";
  const myTag = document.createElement("span");
  myTag.className = "hand-tag";
  myHand.append(myTag);

  // Fascia di rilascio in fondo al tavolo: portare una carta quaggiù la
  // rimette in mano. Esiste a prescindere dalla mano — che può essere vuota,
  // ripiegata o troppo bassa da centrare — ed è inerte finché non si trascina.
  const handDrop = document.createElement("div");
  handDrop.className = "hand-drop";
  handDrop.dataset.drop = "hand";
  handDrop.dataset.seat = ctx.seat();
  handDrop.append(Object.assign(document.createElement("span"), {
    className: "hand-drop-hint",
    textContent: "rimetti in mano",
  }));

  const handToggle = document.createElement("button");
  handToggle.type = "button";
  handToggle.className = "hand-toggle";

  // Doppia freccia, non una parola: in su per aprire la mano, in giù per
  // richiuderla.
  const chevrons = (up: boolean): string =>
    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
      up
        ? '<polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>'
        : '<polyline points="7 6 12 11 17 6"/><polyline points="7 13 12 18 17 13"/>'
    }</svg>`;

  function setHandCollapsed(collapsed: boolean): void {
    myHand.classList.toggle("is-collapsed", collapsed);
    handToggle.classList.toggle("is-off", collapsed);
    handToggle.innerHTML = chevrons(collapsed);
    handToggle.title = t(collapsed ? "hand.open" : "hand.close");
    handToggle.setAttribute("aria-label", handToggle.title);
  }
  setHandCollapsed(false);
  handToggle.addEventListener("click", () => setHandCollapsed(!myHand.classList.contains("is-collapsed")));

  // Su touch il cassetto si governa anche col gesto: swipe in giù lo ripiega,
  // swipe in su (o un tap sull'orlo ripiegato) lo riapre. Si parte APERTI
  // ovunque: in compatta la mano è di tessere e il fit la conta, non si
  // mangia il tavolo.
  myHand.addEventListener("pointerdown", event => {
    if (event.pointerType !== "touch") return;
    // Le carte si trascinano: il gesto del cassetto vale solo fuori da esse.
    if ((event.target as HTMLElement).closest(".tile")) return;
    const startY = event.clientY;
    const move = (ev: PointerEvent): void => {
      const delta = ev.clientY - startY;
      if (Math.abs(delta) < 36) return;
      setHandCollapsed(delta > 0);
      release();
    };
    const release = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  });
  /** La mano era aperta quando è partito un trascinamento da lei: al
      rilascio va riaperta. */
  let handWasOpen = false;
  /** Quante carte aveva la mia mano all'ultimo render: se cresce, il
      cassetto ripiegato si apre. -1 = ancora nessun render. */
  let lastMyHand = -1;

  myHand.addEventListener("click", event => {
    if ((event.target as HTMLElement).closest(".tile")) return;
    if (myHand.classList.contains("is-collapsed")) setHandCollapsed(false);
  });

  // Scegliere il bloccante è una modalità: va detto che si è dentro, e come
  // uscirne.
  const targetHint = document.createElement("div");
  targetHint.className = "target-hint";
  targetHint.hidden = true;

  // §7.2 — la catena di risposta: chi deve rispondere legge cosa c'è in
  // catena e accetta con un tasto (o risponde giocando una Reattiva, come
  // sempre); l'altro legge chi ha la parola.
  const chainBar = document.createElement("div");
  chainBar.className = "chain-bar";
  chainBar.hidden = true;
  const chainText = document.createElement("span");
  const chainAccept = document.createElement("button");
  chainAccept.type = "button";
  chainAccept.textContent = t("chain.accept");
  chainAccept.title = t("chain.accept.tip");
  chainAccept.addEventListener("click", () => {
    const chain = ctx.state().chain;
    if (!chain || chain.resolving) return;
    const seat = chain.turn;
    void ctx.dispatch({ t: "pass", seat }).then(passed => {
      if (passed) ctx.log(msg("log.chain.pass", { seat }), seat);
    });
  });
  chainBar.append(chainText, chainAccept);

  root.append(board, oppHand, myHand, handDrop, handToggle, targetHint, chainBar);

  // La lavagna si vede sempre tutta in larghezza: quando la finestra è più
  // stretta dei 2700px canonici, la superficie si scala di conseguenza (e le
  // carte in mano con lei, via CSS). Si vedono più piccole, ma a leggerle ci
  // pensa l'ingrandimento al passaggio, che resta a misura piena.
  /** L'ultima aria distribuita nei margini, e l'ultimo angolo riservato al
      gesto di fase (unità di vista): le zone si rifanno solo se cambiano. */
  let viewSlackUnits = 0;
  let cornerUnits = 0;
  function fitScale(): void {
    // In vista compatta il tavolo deve stare TUTTO nella finestra, MANO
    // COMPRESA: il cassetto è un pannello sopra la lavagna, e se il fit non
    // lo contasse coprirebbe la fila di servizio (Richiamo, pile). Qui le
    // carte in mano stanno alla scala del campo (HAND_BOOST_COMPACT), non
    // al 30% in più della vista normale — un po' più piccole, per farci
    // stare tutto. L'altezza del cassetto è quella di --hand-h in CSS,
    // 48px di cornice più una carta in scala di mano: risolvendo
    // h = surface·s + 48 + 424·s·boost si ha la scala che fa combaciare il
    // fondo della lavagna con l'orlo della mano.
    const compact = isCompactView();
    // Il rincasso si adatta all'altezza della finestra come la compatta,
    // ma SENZA contare la mano: la mano resta un cassetto fisso sopra il
    // tavolo, come in «Carte intere» (si ripiega col gesto), e il tavolo
    // prende tutta l'altezza — è quello che decide la scala.
    const recess = isRecessView();
    const fitAll = compact || recess;
    document.documentElement.style.setProperty("--hand-cap", "1");
    // In compatta anche la mano è di tessere (tileViewH): il fit conta
    // quella. Un tetto solo: il tavolo con la mano sotto — le tessere più
    // sono grandi meglio è, il corpo dei testi non dipende dalla scala.
    const handTileH = compact ? tileViewH() : TILE_H;
    // Il tavolo prende tutta l'altezza della lavagna (sotto l'header, sopra
    // l'orlo della finestra): nient'altro è nel conto, la mano è un
    // pannello sopra.
    const heightFit = (): number => {
      if (!fitAll) return Number.POSITIVE_INFINITY;
      const h = board.clientHeight;
      if (recess) return h / surfaceViewH();
      return Math.min((h - HAND_CHROME) / (surfaceViewH() + handTileH * HAND_BOOST_COMPACT), h / surfaceViewH());
    };
    const fit = (): number => Math.min(1, board.clientWidth / SURFACE_W, heightFit());
    // La scala si misura a margini di base: l'altezza che avanza si
    // distribuisce DOPO (setViewSlack), e non deve rientrare nel conto.
    // L'angolo del gesto di fase invece SÌ: è spazio che il tavolo cede
    // (setCornerReserve, ctx.ts). In unità di vista dipende dalla scala,
    // e la scala da lui: due passate, e si è a posto (la seconda cambia
    // la scala solo se comanda l'altezza, e di poco).
    const actionsEl = root.querySelector<HTMLElement>(":scope > .hud-actions");
    const cornerPx = recess && actionsEl ? actionsEl.offsetHeight + 24 : 0;
    // E lo spazio delle etichette sotto i riquadri, stessa storia: 10px di
    // stacco, 16 di testo, 8 d'aria (LABEL_ROOM_PX), in unità di vista.
    const labelPx = recess ? LABEL_ROOM_PX : 0;
    const headPx = recess ? HEAD_ROOM_PX : 0;
    const topPx = recess ? TOP_ROOM_PX : 0;
    const dockPx = recess ? DOCK_ROOM_PX : 0;
    const reserve = (at: number): void => {
      setCornerReserve(cornerPx / at);
      setLabelRoom(labelPx / at, headPx / at, topPx / at, dockPx / at);
    };
    setViewSlack(0);
    reserve(Number.POSITIVE_INFINITY);
    let scale = fit();
    // Le riserve in unità di vista crescono quando la scala cala, e la
    // scala cala quando le riserve crescono: quando comanda l'altezza si
    // converge per punto fisso, in pochi giri (il rapporto è piccolo).
    // Fermarsi a una passata lasciava la lavagna più alta della finestra
    // di una decina di pixel: si scorreva, nella vista che promette di no.
    if (cornerPx || labelPx) {
      for (let round = 0; round < 6; round += 1) {
        reserve(scale);
        const next = fit();
        if (Math.abs(next - scale) < 0.0005) break;
        scale = next;
      }
      reserve(scale);
    }
    // Lavagne piccole: sotto il 50% i margini si stringono (setTightView in
    // ctx.ts) e la scala si rifà — quei pixel vanno alle carte, che a quelle
    // misure sono già piccole. Due soglie diverse, per non far ballare il
    // tavolo attorno a una sola: si stringe sotto 0,5 e si allarga sopra
    // 0,56. La geometria cambia, quindi le zone vanno ridisegnate.
    let geometryChanged = false;
    if (fitAll && (scale < 0.5) !== isTightView()) {
      setTightView(scale < 0.5 || (isTightView() && scale < 0.56));
      geometryChanged = true;
      for (let round = 0; round < 6; round += 1) {
        const next = fit();
        if (Math.abs(next - scale) < 0.0005) break;
        scale = next;
        reserve(scale);
      }
    }
    // L'ultima parola: la lavagna non deve MAI superare la finestra, nemmeno
    // di un pixel (la scala in CSS è arrotondata per difetto, e basta).
    if (fitAll) scale = Math.min(scale, board.clientHeight / surfaceViewH());
    // La riserva cambia con la scala: se è cambiata, le zone si rifanno
    // (il fondo della fascia si sposta). A scatti, come l'aria qui sotto.
    const corner = Math.ceil((cornerPx + labelPx) / Math.max(scale, 0.1) / 8) * 8;
    if (corner !== cornerUnits) geometryChanged = true;
    cornerUnits = corner;
    // Un fondo alla scala: se la lavagna viene misurata a zero (succede
    // sulle finestre strettissime, prima che il layout si assesti) senza
    // questo il tavolo sparirebbe del tutto invece di restare piccolo.
    scale = Math.max(0.1, scale);
    // Rincasso: quando comanda la larghezza, l'altezza che avanza va nei
    // margini del tavolo (ctx.ts, setViewSlack) invece che nel vuoto sopra e
    // sotto. In unità di vista, a scatti di 16: la scala cambia a ogni pixel
    // di finestra, e non vale la pena rifare le zone per un'unità in più.
    const air = recess
      ? Math.floor(Math.max(0, board.clientHeight / scale - surfaceViewH()) / 16) * 16
      : 0;
    if (air !== viewSlackUnits) geometryChanged = true;
    viewSlackUnits = air;
    setViewSlack(air);
    // La geometria è cambiata (margini stretti o larghi, o l'aria che
    // avanza): zone da rifare. Alla prima passata non ci sono ancora, e
    // nascono già giuste.
    // La misura della superficie si riscrive sempre (è a buon mercato): le
    // riserve la cambiano anche quando le zone non vanno rifatte.
    applySurfaceSize();
    if (geometryChanged && zonesReady) buildStaticZones();
    // Quando in compatta comanda la larghezza, sotto la lavagna resta
    // spazio: lo prende la mano, che cresce (fino a una volta e mezza) —
    // sono le carte da giocare, e il corpo dei testi non cambia comunque.
    const slack = board.clientHeight - HAND_CHROME - surfaceViewH() * scale;
    // In rincasso la mano sta alla scala del tavolo: al 30% in più
    // coprirebbe mezzo Fronte.
    const handBoost = compact
      ? Math.max(HAND_BOOST_COMPACT, Math.min(HAND_BOOST_COMPACT_MAX, slack / (handTileH * scale)))
      : recess
        ? HAND_BOOST_COMPACT
        : HAND_BOOST;
    document.documentElement.style.setProperty("--hand-tile-h", `${handTileH}px`);
    document.body.classList.toggle("view-compact", compact);
    document.body.classList.toggle("view-recess", isRecessView());
    // Su html, non su body: le variabili derivate (--hand-scale, --hand-h)
    // sono definite in :root e si risolvono LÌ — un override sul body non le
    // raggiungerebbe, e il cassetto resterebbe ad altezza piena.
    // floor, non round: arrotondare in su lascerebbe UN pixel di scorrimento
    // proprio nella vista che promette di non scorrere.
    document.documentElement.style.setProperty("--card-scale", String(Math.floor(scale * 1000) / 1000));
    document.documentElement.style.setProperty("--hand-boost", String(Math.floor(handBoost * 1000) / 1000));
    // Quando in compatta comanda l'altezza, la lavagna è più stretta della
    // finestra: si centra nello spazio a sinistra della corsia dell'HUD
    // (--hud-lane), invece di restare incollata a sinistra col vuoto a
    // destra — o di finire sotto l'HUD. Il margine è in percentuale della
    // lavagna e legge la scala dalla variabile: al ridimensionamento si
    // sistema da sé. Le coordinate dei rilasci partono dal rettangolo della
    // superficie, non dalla lavagna, quindi lo spostamento non le tocca.
    surface.style.marginLeft = fitAll
      ? `max(0px, calc((100% - ${SURFACE_W}px * var(--card-scale)) / 2))`
      : "";
    // E quando anche la mano cresciuta non basta a riempire l'altezza
    // (finestre molto larghe), la lavagna si centra in verticale fra la
    // fascia dei dorsi avversari e il cassetto, invece di lasciare tutto il
    // vuoto in fondo.
    const handH = HAND_CHROME + handTileH * scale * handBoost;
    const rest = compact
      ? board.clientHeight - surfaceViewH() * scale - handH
      : recess
        ? board.clientHeight - surfaceViewH() * scale
        : 0;
    surface.style.marginTop = rest > 0 ? `${Math.floor(rest / 2)}px` : "";
    // Il pannello delle pile avversarie tiene quattro carte intere in fila:
    // su una lavagna piccola sarebbe mezzo campo. Sotto una certa scala si
    // dispone a due per riga.
    pileDock?.classList.toggle("is-tight", scale < 0.52);
  }

  fitScale();
  // Al ridimensionamento non basta rifare la scala: la disposizione della
  // mano (quanto le carte si accavallano, e con quale spinta) la calcola il
  // render sulla larghezza del cassetto e sulla scala del momento. Senza il
  // render le carte restavano ai margini di prima e sbordavano dal cassetto
  // finché una mossa qualunque non lo ridisegnava.
  const refit = new ResizeObserver(() => {
    fitScale();
    render();
  });
  refit.observe(board);

  /** Da coordinata condivisa a coordinata di schermo, per questo giocatore. */
  const view = (y: number): number => toView(y, ctx.seat());
  /** In due dimensioni: dove va una carta (e se è una miniatura, in Arena). */
  const spotOf = (x: number, y: number) => viewOf(x, y, ctx.seat());
  /** E il viaggio di ritorno, per il punto in cui una carta viene lasciata. */
  const unspot = (vx: number, vy: number) => fromViewPoint(vx, vy, ctx.seat());
  /** Le targhe dei posti (hud.ts): appese in testa a ciascun campo. */
  let statsFor: ((seat: Seat) => HTMLElement) | null = null;
  const pileSlots = new Map<string, HTMLElement>();
  /** Gli elementi delle zone: si buttano e si ridisegnano al cambio modo. */
  const zoneEls: HTMLElement[] = [];
  /** Il riquadro del controllo di ciascun posto (§8.2), acceso solo se
      occupato. Sta QUI, prima della chiamata: buildStaticZones lo riempie,
      e una const dichiarata più sotto sarebbe ancora nella sua zona morta. */
  const controlSlots = new Map<Seat, HTMLElement>();
  /** …e il suo coperchio: con più carte controllate (§8.2) copre la pila,
      al passaggio si accende e al click apre la lista (main.ts → overlay)
      con un menu per carta. Sopra le tessere, sotto le mani. */
  const controlLids = new Map<Seat, HTMLElement>();
  buildStaticZones();

  // Click a vuoto sulla lavagna: chiude il menu contestuale (ci pensa menu.ts)
  // e nient'altro. Non esiste "deseleziona": non c'è selezione.
  surface.addEventListener("contextmenu", event => {
    if ((event.target as HTMLElement).closest(".tile")) return;
    event.preventDefault();
    cancelTargeting();
  });

  // Cliccare a vuoto o premere Esc lascia perdere il blocco.
  surface.addEventListener("click", event => {
    if (targeting && !(event.target as HTMLElement).closest(".tile")) cancelTargeting();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") cancelTargeting();
  });

  // La freccia in volo segue il puntatore finché non si sceglie.
  /** La scala a cui la superficie è disegnata (1 a tutta larghezza). */
  const surfaceScale = (): number => surface.getBoundingClientRect().width / surfaceViewW();

  board.addEventListener("pointermove", event => {
    if (!targeting) return;
    const box = surface.getBoundingClientRect();
    // La punta della freccia vive in coordinate canoniche, come le carte: la
    // posizione del puntatore va riportata fuori dalla scala del disegno.
    const scale = surfaceScale();
    targeting.pointer = { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale };
    paintArrows();
  });

  /**
   * Il riquadro del Rubyfront che fa anche da Zona di Richiamo (rincasso):
   * il render gli dà lo stato (is-recall / can-deploy), e sulla
   * carta in attesa compare «Schiera» — paga il costo, col dado se c'è (§3.1).
   */
  /**
   * Lo schieramento passerebbe? (§3.1) Nel proprio turno, a partita in
   * corso, fuori da una catena di risposta (§7.2), e col Flusso che copre
   * il costo — fisso, o ogni faccia del dado, Gettone compreso. È un
   * aiuto al tasto, non la regola: la regola è dell'engine (judge_deploy),
   * che ferma comunque il gesto di chi forzasse il tasto. Torna la chiave
   * del motivo, o null se si può.
   */
  function deployBlock(waiting: CardInstance): string | null {
    const state = ctx.state();
    const deployment = cardStats(waiting.cardId).deployment;
    if (!deployment) return "recall.deploy.unknown";
    if (state.over) return "hud.over";
    if (state.active !== waiting.owner) return "recall.deploy.theirs";
    if (state.chain) return "recall.deploy.chain";
    const player = state.players[waiting.owner];
    const available = player.flux + (player.token ? 1 : 0);
    const needed = deployment.die ?? deployment.fixed ?? 0;
    if (available < needed) return deployment.die ? "recall.deploy.nodie" : "recall.deploy.noflux";
    return null;
  }
  function waitingRubyfront(seat: Seat): CardInstance | undefined {
    const back = backRowY(seat);
    return fieldCards(ctx.state()).find(
      card => card.owner === seat && Math.abs(card.x - SLOT_X.richiamo) < 160 && Math.abs(card.y - back) < 160
    );
  }

  function armRecallSlot(seat: Seat, slot: HTMLElement): void {
    rubySlots.set(seat, slot);
    const front = frontRowY(seat);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "deploy-btn";
    button.textContent = t("recall.deploy");
    button.title = t("recall.deploy.tip");
    button.addEventListener("click", event => {
      event.stopPropagation();
      const waiting = waitingRubyfront(seat);
      const deployment = waiting ? cardStats(waiting.cardId).deployment : undefined;
      // Il tasto spento non parte; se qualcuno lo forza, l'engine ferma il
      // gesto (§3.1) e la carta torna da dov'era.
      if (!waiting || !deployment || !ctx.controls(seat) || deployBlock(waiting)) return;
      void deploy(waiting, RUBYFRONT_X, front, dropZ(waiting, RUBYFRONT_X, front), deployment, { x: waiting.x, y: waiting.y, z: waiting.z });
    });
    slot.append(button);
  }

  function buildStaticZones(): void {
    zonesReady = true;
    for (const el of zoneEls) el.remove();
    zoneEls.length = 0;
    pileSlots.clear();
    rubySlots.clear();
    pileDock = null;
    dockHand = null;
    for (const seat of SEATS) {
      const mine = seat === ctx.seat();
      // La fascia NON passa da `view`: quella trasformata capovolge una carta
      // dentro la fascia, e ragiona sull'altezza di una carta. La fascia è la
      // fascia — la sua posizione sullo schermo la dice `viewBandTop`, e basta.
      const bandTop = viewBandTop(seat, ctx.seat());
      const front = frontRowY(seat);
      const back = backRowY(seat);

      const band = document.createElement("div");
      band.className = `half ${mine ? "is-mine" : "is-foe"}`;
      band.style.top = `${bandTop}px`;
      band.style.height = `${bandViewH(!mine)}px`;
      // La testata del campo, sull'orlo in alto a sinistra: la targhetta col
      // nome e, accanto, la targa del posto (Gettone, PV, Flusso) che crea
      // hud.ts e arriva da onStats — anche dopo, a zone già costruite.
      const head = document.createElement("div");
      head.className = "half-head";
      head.dataset.seat = seat;
      // Prima la targa (PV, Gettone, Flusso), poi il nome: i numeri sono la
      // cosa da leggere, il nome li firma (scelta del designer, 2026-09-08).
      const name = document.createElement("span");
      name.className = "half-name";
      name.dataset.seatName = seat;
      if (statsFor) head.append(statsFor(seat));
      head.append(name);
      band.append(head);
      surface.append(band);
      zoneEls.push(band);

      // Rincasso: le pile avversarie non hanno una fila sulla lavagna. Stanno
      // in un pannello sopra il suo campo, in alto a destra, che si ripiega a
      // una testata coi conti — è informazione, non spazio di gioco. Si apre
      // e si chiude con una transizione (style.css, .pile-dock-body).
      // (Provato ad aprire la fila vera, come per il controllo: quattro
      // file di carte intere a 1180×820 fanno una scala da 0,28 — «tornerei
      // alla visualizzazione di prima, però con un'animazione».)
      const docked = isRecessView() && !mine;
      let dockRow: HTMLElement | null = null;
      if (docked) {
        const dock = document.createElement("div");
        // A lavagna piccola il pannello aperto è mezzo campo avversario:
        // parte ripiegato (una testata coi conti), e si apre col click; la
        // scelta salvata vale per la lavagna grande.
        dock.className = `pile-dock${foePilesOpen() ? "" : " is-collapsed"}`;
        // Ancorato al bordo destro della lavagna, non a una colonna: dentro
        // ci stanno quattro riquadri (tre pile e la mano) e la misura la fa
        // il contenuto.
        dock.style.right = "16px";
        // A cavallo dell'orlo in alto, sulla stessa linea della targhetta
        // del posto (.half-head, 15px sopra a corpo fisso): così ruba al
        // campo solo metà della sua testata, e i riquadri del Fronte
        // restano liberi (DOCK_ROOM_PX, rowPadTopView in ctx.ts).
        dock.style.top = `calc(${bandTop}px - 15px / var(--card-scale))`;
        const head = document.createElement("button");
        head.type = "button";
        head.className = "pile-dock-head";
        // Aperto, la testata è solo il titolo: i conti li dicono le
        // etichette delle pile. Ripiegato, i conti passano nella testata.
        const title = document.createElement("span");
        title.className = "pile-dock-title";
        title.textContent = t("recess.piles");
        const counts = document.createElement("span");
        counts.className = "pile-dock-counts";
        head.append(title, counts);
        head.addEventListener("click", () => setPileDockOpen(dock.classList.contains("is-collapsed")));
        // Il corpo è una griglia a una riga che va da 1fr a 0fr: è ciò che
        // si anima. Dentro, un ritaglio senza padding (una traccia a 0fr
        // non scende sotto il padding di ciò che contiene) e poi la fila
        // coi riquadri.
        const body = document.createElement("div");
        body.className = "pile-dock-body";
        const clip = document.createElement("div");
        clip.className = "pile-dock-clip";
        dockRow = document.createElement("div");
        dockRow.className = "pile-dock-row";
        clip.append(dockRow);
        body.append(clip);
        dock.append(head, body);
        surface.append(dock);
        zoneEls.push(dock);
        pileDock = dock;
      }

      for (const pile of PILES) {
        const slot = document.createElement("div");
        slot.className = "slot pile";
        slot.dataset.drop = pile.zone;
        slot.dataset.seat = seat;
        if (!docked) {
          slot.style.left = `${pile.x}px`;
          slot.style.top = `${view(back)}px`;
        }
        slot.style.width = `${TILE_W}px`;
        slot.style.height = `${tileViewH()}px`;

        const label = document.createElement("span");
        label.className = "slot-label";
        slot.append(label);
        slot.dataset.label = pile.label;

        slot.addEventListener("contextmenu", event => {
          event.preventDefault();
          openMenu(event.clientX, event.clientY, pileMenu(seat, pile.zone));
        });
        // Su touch: pressione lunga al posto del tasto destro.
        enableLongPress(slot, (x, y) => openMenu(x, y, pileMenu(seat, pile.zone)));
        // L'Abisso e la Zona di Ritiro sono PUBBLICI (§5): «consultabili da
        // entrambi i giocatori in qualsiasi momento», quindi si aprono con
        // un click solo. Il mazzo no: è nascosto, e il doppio click lì pesca.
        if (pile.zone === "abisso" || pile.zone === "ritiro") {
          slot.addEventListener("click", () => {
            // Non mentre si mira (il click sceglie il bersaglio), e non
            // subito dopo un rilascio: il click che chiude un trascinamento
            // arriva sulla tessera appena posata, e da lì risale allo slot.
            if (targeting || Date.now() - lastDropAt < 300) return;
            browse(seat, pile.zone);
          });
        }
        slot.addEventListener("dblclick", () => {
          if (pile.zone === "deck" && ctx.controls(seat)) draw(seat, 1);
          else browse(seat, pile.zone);
        });

        (dockRow ?? surface).append(slot);
        zoneEls.push(slot);
        pileSlots.set(`${seat}:${pile.zone}`, slot);
      }

      // La mano avversaria sta nel pannello insieme alle pile: un mazzetto di
      // dorsi col conto, non più una fascia che toglie un margine di tavolo
      // in cima. In partita locale è anche la zona di rientro delle sue carte.
      if (dockRow) {
        const slot = document.createElement("div");
        slot.className = "slot pile dock-hand";
        slot.dataset.seat = seat;
        if (ctx.controls(seat)) slot.dataset.drop = "hand";
        slot.style.width = `${TILE_W}px`;
        slot.style.height = `${tileViewH()}px`;
        const label = document.createElement("span");
        label.className = "slot-label";
        slot.append(label);
        dockRow.append(slot);
        zoneEls.push(slot);
        dockHand = slot;
      }

      // I posti segnati non sono zone a sé: la carta che ci finisce resta una
      // carta sul campo, con le sue coordinate. L'unica differenza è che ci si
      // aggancia dentro invece di posarsi dove capita — come chiedono i
      // riquadri di Abisso e Ritiro, che però sono pile vere.
      const markSlot = (x: number, y: number, label: string, extra = ""): HTMLElement => {
        const slot = document.createElement("div");
        slot.className = `slot slot-mark ${extra}`.trim();
        slot.dataset.drop = "field";
        // snapX/snapY restano CANONICI: sono i dati che finiranno nell'azione.
        // A spostarsi è soltanto il riquadro sullo schermo.
        slot.dataset.snapX = String(x);
        slot.dataset.snapY = String(y);
        slot.style.left = `${x}px`;
        slot.style.top = `${view(y)}px`;
        slot.style.width = `${TILE_W}px`;
        slot.style.height = `${tileViewH()}px`;
        if (label) slot.dataset.label = label;
        surface.append(slot);
        zoneEls.push(slot);
        return slot;
      };

      // Zona di Richiamo (§5): il Rubyfront parte da qui, e una volta
      // schierato non ci torna (§3.1). In rincasso non ha un riquadro suo:
      // è il riquadro del Rubyfront nell'altro stato (vedi sotto).
      if (!isRecessView()) markSlot(SLOT_X.richiamo, back, t("zone.richiamo"));
      // Lo slot extra del controllo (§8.2): un'Entità avversaria presa fino
      // a fine turno sta qui, e non conta nei 5 del Fronte. Si vede solo
      // quando c'è: un riquadro vuoto sempre acceso diceva una regola che
      // quasi mai è in gioco (render lo accende e lo spegne).
      const controlSlot = markSlot(CONTROL_X, back, t("zone.control"));
      controlSlots.set(seat, controlSlot);
      const lid = document.createElement("button");
      lid.type = "button";
      lid.className = "control-lid";
      lid.hidden = true;
      lid.style.left = controlSlot.style.left;
      lid.style.top = controlSlot.style.top;
      lid.style.width = controlSlot.style.width;
      lid.style.height = controlSlot.style.height;
      lid.addEventListener("click", event => {
        event.stopPropagation();
        listControlled(seat);
      });
      surface.append(lid);
      zoneEls.push(lid);
      controlLids.set(seat, lid);

      // I cinque slot del Fronte, al centro. L'etichetta è una sola per il
      // gruppo: cinque scritte "Fronte" in fila sarebbero solo rumore.
      for (const x of FRONT_SLOT_X) markSlot(x, front, "", "slot-front");

      const frontLabel = document.createElement("div");
      frontLabel.className = "row-label";
      frontLabel.textContent = t("zone.front");
      frontLabel.style.left = `${FRONT_X}px`;
      frontLabel.style.width = `${FRONT_W}px`;
      frontLabel.style.top = `${view(front) + tileViewH() + 9}px`;
      surface.append(frontLabel);
      zoneEls.push(frontLabel);

      // Il Rubyfront schierato sta davanti al Fronte, senza occupare uno slot.
      const rubySlot = markSlot(RUBYFRONT_X, front, t("zone.rubyfront"), "slot-rubyfront");
      if (isRecessView()) armRecallSlot(seat, rubySlot);

      // Le Materie in gioco, all'altra estremità della fila.
      markSlot(MATTER_X, front, t("zone.materie"), "slot-matter");
    }
  }

  // ---------------------------------------------------------------- azioni

  function draw(seat: Seat, count: number): void {
    const left = zoneCards(ctx.state(), seat, "deck").length;
    if (left === 0) {
      ctx.log(msg("log.deck.empty", { seat }), seat);
      return;
    }
    const taken = Math.min(count, left);
    ctx.dispatch({ t: "draw", seat, count: taken });
    ctx.log(msg("log.draw", { seat, n: taken, cards: msg(taken === 1 ? "cards.one" : "cards.many") }), seat);
  }

  function shuffle(seat: Seat): void {
    const order = shuffled(zoneCards(ctx.state(), seat, "deck").map(card => card.uid));
    ctx.dispatch({ t: "shuffle", seat, order });
    ctx.log(msg("log.shuffle", { seat, n: order.length }), seat);
  }

  // ------------------------------------------------------- combattimento

  /** Il Rubyfront (o Nexus) di un posto, ovunque si trovi sul campo. */
  function rubyfrontOf(seat: Seat): CardInstance | undefined {
    return fieldCards(ctx.state()).find(card => card.owner === seat && isRubyfront(card.cardId));
  }

  /**
   * §6.3: un'Entità tappata non può attaccare né bloccare, una coperta non può
   * fare nulla, e il Rubyfront non è un'Entità. Qui la regola serve solo a
   * smorzare: la carta resta scegliibile lo stesso. L'arbitro non è il
   * simulatore.
   */
  function looksPlayable(card: CardInstance): boolean {
    if (card.tapped || card.facedown) return false;
    const kind = faceKind(card.cardId, card.face);
    return kind !== "rubyfront" && kind !== "nexus";
  }

  // Dichiarazioni e loro conseguenze stanno in combat.ts: passano dal
  // giudizio dell'engine, e il tavolo si limita a fornire il bersaglio.
  function declareAttack(card: CardInstance): Promise<void> {
    return (async () => {
      const passed = await declareAttackVia(ctx, card, rubyfrontOf(otherSeat(controllerOf(card))));
      if (!passed) return;
      // §8.2 — «quando attacca»: gli effetti certificati dell'attaccante, con
      // la stessa scena dell'ingresso ma la riga «Quando attacca».
      const live = ctx.state().cards[card.uid];
      if (!live) return;
      // RBF-004: la Vendetta promessa «al prossimo Umano che attacca» si
      // dà adesso, se è lui — senza scena: il segno resta sulla carta.
      for (const grant of pendingGrants(ctx.state(), live, ctx.card)) await playGrant(grant, live);
      const returns = returnsFor(ctx.state(), live, ctx.card, "on_attack");
      const draws = attackDraws(ctx.state(), live, ctx.card);
      const steps = attackSteps(ctx.state(), live, ctx.card);
      const who = t("scene.attacks", { name: seatLabel(ctx.state(), controllerOf(live)), card: `«${cardName(live.cardId, ctx.locale())}»` });
      // Una scena per fonte: prima chi attacca (i suoi ritorni, le sue
      // pesche, le sue forme), poi ogni altra carta che si innesca — gli
      // Oggetti addosso, le alleate, le Materie permanenti, il Rubyfront.
      // Le scene si accodano; «Risolvi» esegue i passi di quella fonte.
      const own = steps.filter(step => step.source.uid === live.uid);
      if (returns.length || draws.length || own.length) {
        void showEnterEffect(root, {
          cardId: live.cardId,
          face: live.face,
          theme: ctx.themeFor(live.owner),
          locale: ctx.locale(),
          who,
          effects: attackEffects(live.cardId, live.face, ctx.locale()),
          triggers: [
            ...returns.map(step => describeReturn(step, ctx.card)),
            ...draws.map(step => describeAttackDraw(step, ctx.card)),
            ...own.map(step => describeAttackStep(step, ctx.card)),
          ],
          kicker: t("scene.attack"),
          onContinue: () => void playAttackTriggers(live, own),
        });
      }
      const others = new Map<string, AttackStep[]>();
      for (const step of steps) {
        if (step.source.uid === live.uid) continue;
        others.set(step.source.uid, [...(others.get(step.source.uid) ?? []), step]);
      }
      for (const group of others.values()) {
        const source = group[0].source;
        void showEnterEffect(root, {
          cardId: source.cardId,
          face: source.face,
          theme: ctx.themeFor(source.owner),
          locale: ctx.locale(),
          who,
          effects: attackEffects(source.cardId, source.face, ctx.locale()),
          triggers: group.map(step => describeAttackStep(step, ctx.card)),
          // Non è questa carta ad attaccare: si innesca PERCHÉ qualcuno
          // attacca. Il Rubyfront non attacca mai (§3.1), e leggergli sopra
          // «Quando attacca» faceva pensare a un attacco suo — la riga sotto
          // dice già chi attacca e con che carta.
          kicker: t("scene.attack.other"),
          onContinue: () => void playAttackSteps(group),
        });
      }
    })();
  }

  async function playAttackSteps(steps: AttackStep[]): Promise<void> {
    for (const step of steps) await playAttackStep(step);
  }

  /**
   * RBF-004: la Vendetta al prossimo Umano. La fonte si accende e basta:
   * la parola chiave ottenuta si segna sulla carta che la ottiene
   * (markMarks), e quel segno resta finché dura — una freccia che sparisce
   * non lo diceva.
   */
  async function playGrant(step: AttackStep, target: CardInstance): Promise<void> {
    if (step.form.kind !== "empower" || !step.form.grants) return;
    const by = controllerOf(step.source);
    light(step.source.uid, true);
    await wait(TRIGGER_LEAD_MS);
    const passed = await ctx.dispatch({ t: "empower", uid: target.uid, grants: step.form.grants, effect: attackRef(step) });
    if (passed) {
      const what = step.form.grants.map(keyword => t(`grant.${keyword}`)).join(", ");
      ctx.log(msg("log.effect.grant", { seat: by, sourceCard: step.source.cardId, card: target.cardId, what }), by);
    }
    await wait(TRIGGER_TAIL_MS);
    light(step.source.uid, false);
  }

  /**
   * Un passo d'attacco (§8.2, le forme di attackSteps): la fonte si accende,
   * il dado si tira se c'è, si sceglie se c'è da scegliere, l'azione parte
   * col suo riferimento. Il «no» dell'engine ferma il passo e basta.
   */
  async function playAttackStep(step: AttackStep): Promise<void> {
    const by = controllerOf(step.source);
    const form = step.form;
    const name = ctx.card(step.source.cardId).name;
    hold(true);
    light(step.source.uid, true);
    try {
      await wait(TRIGGER_LEAD_MS);
      switch (form.kind) {
        case "empower": {
          if (form.targets === "bearer") {
            const passed = await ctx.dispatch({ t: "empower", uid: step.attacker.uid, power: form.power, effect: attackRef(step) });
            if (passed) ctx.log(msg("log.effect.empower", { seat: by, sourceCard: step.source.cardId, card: step.attacker.cardId, n: form.power ?? 0 }), by);
          } else if (form.targets === "others_armed") {
            for (const target of otherArmed(ctx.state(), by, step.source.uid, ctx.card)) {
              strike(target.uid, FLY_MS);
              const passed = await ctx.dispatch({ t: "empower", uid: target.uid, power: form.power, effect: attackRef(step) });
              if (passed) ctx.log(msg("log.effect.empower", { seat: by, sourceCard: step.source.cardId, card: target.cardId, n: form.power ?? 0 }), by);
              await wait(TRIGGER_TAIL_MS);
            }
          } else if (form.targets === "opposing_entity") {
            const foes = fieldCards(ctx.state()).filter(card => controllerOf(card) !== by && ctx.card(card.cardId).kind === "entity");
            if (foes.length === 0) {
              ctx.log(msg("log.no.target", { seat: by, card: step.source.cardId }), by);
              break;
            }
            const target = await pickTarget(step.source, foes, t("target.raid"));
            if (!target) break;
            strike(target.uid, 60_000);
            const sure = await confirmFor(by, t("confirm.raid", { card: `«${ctx.card(target.cardId).name}»` }));
            if (!sure) {
              strike(target.uid, 0);
              break;
            }
            const passed = await ctx.dispatch({ t: "empower", uid: target.uid, restrict: "block", effect: attackRef(step) });
            if (passed) ctx.log(msg("log.effect.restrict", { seat: by, sourceCard: step.source.cardId, card: target.cardId }), by);
            await wait(TRIGGER_TAIL_MS);
            strike(target.uid, 0);
          }
          break;
        }
        case "look": {
          let roll: number | undefined;
          if (form.die !== null) {
            roll = rollDie(form.die);
            await showRoll(root, form.die, roll, t("dice.step", { name, what: t("dice.sift") }));
            if (!inRange(roll, form.onRoll)) {
              ctx.log(msg("log.effect.roll", { seat: by, sourceCard: step.source.cardId, die: form.die, roll, what: msg("roll.nothing") }), by);
              break;
            }
          }
          const looked = zoneCards(ctx.state(), by, "deck").slice(0, form.count);
          if (looked.length === 0) {
            ctx.log(msg("log.look.empty", { seat: by, card: step.source.cardId }), by);
            break;
          }
          const candidates = looked.filter(card => {
            const f = ctx.card(card.cardId);
            return f.kind === form.reveal.kind && (form.reveal.race === null || f.race === form.reveal.race);
          });
          const what = t(form.reveal.kind === "matter" ? "pick.look.matter" : form.reveal.kind === "object" ? "pick.look.object" : "pick.look.one");
          const title = form.revealTo === "ritiro"
            ? t("pick.look.retire", { n: looked.length, what })
            : form.restTo === "ritiro"
              ? t("pick.look.rest.retire", { n: looked.length, what })
              : t(candidates.length ? "pick.look.some" : "pick.look.none", { n: looked.length, what });
          const reveal = await pickFromPile(by, "deck", candidates, title, looked);
          const passed = await ctx.dispatch({
            t: "look",
            seat: by,
            count: form.count,
            ...(reveal ? { reveal: reveal.uid } : {}),
            ...(roll !== undefined ? { roll } : {}),
            revealTo: form.revealTo,
            restTo: form.restTo,
            effect: attackRef(step),
          });
          if (passed) {
            const shown = reveal
              ? form.revealTo === "ritiro" ? msg("look.toretire", { card: reveal.cardId }) : msg("look.reveal", { card: reveal.cardId })
              : msg("look.noreveal");
            ctx.log(msg(form.restTo === "ritiro" ? "log.effect.look.hand" : "log.effect.look.retire", { seat: by, sourceCard: step.source.cardId, n: looked.length, what: shown }), by);
          }
          break;
        }
        case "heal": {
          const foe = otherSeat(by);
          if (form.who === "permanent") {
            const roll = rollDie(form.die ?? 20);
            await showRoll(root, form.die ?? 20, roll, t("dice.step", { name, what: t("dice.heirs") }));
            const count = attackersOf(ctx.state(), by, form.attackers?.race ?? "human", ctx.card).length;
            if (inRange(roll, form.gainOn ?? null)) {
              const hp = ctx.state().players[by].hp + count;
              const passed = await ctx.dispatch({ t: "player", seat: by, patch: { hp }, roll, effect: attackRef(step) });
              if (passed) ctx.log(msg("log.effect.heal", { seat: by, sourceCard: step.source.cardId, n: count, hp }), by);
            } else if (inRange(roll, form.drainOn ?? null)) {
              const hp = Math.max(0, ctx.state().players[foe].hp - count);
              const passed = await ctx.dispatch({ t: "player", seat: foe, patch: { hp }, roll, effect: attackRef(step) });
              if (passed) ctx.log(msg("log.effect.drain", { seat: by, sourceCard: step.source.cardId, otherSeat: foe, n: count, hp }), by);
            } else {
              ctx.log(msg("log.effect.roll", { seat: by, sourceCard: step.source.cardId, die: form.die ?? 20, roll, what: msg("roll.nothing") }), by);
            }
            break;
          }
          const amount = typeof form.amount === "number" ? form.amount : 0;
          const hp = ctx.state().players[by].hp + amount;
          const healed = await ctx.dispatch({ t: "player", seat: by, patch: { hp }, effect: attackRef(step) });
          if (!healed) break;
          ctx.log(msg("log.effect.heal", { seat: by, sourceCard: step.source.cardId, n: amount, hp }), by);
          await wait(TRIGGER_TAIL_MS);
          if (form.thenRecall && form.die !== null) {
            const roll = rollDie(form.die);
            await showRoll(root, form.die, roll, t("dice.step", { name, what: t("dice.mend", { lo: form.onRoll?.[0] ?? 0, hi: form.onRoll?.[1] ?? 0 }) }));
            if (!inRange(roll, form.onRoll)) {
              ctx.log(msg("log.effect.roll", { seat: by, sourceCard: step.source.cardId, die: form.die, roll, what: msg("roll.nothing") }), by);
              break;
            }
            const candidates = zoneCards(ctx.state(), by, "ritiro").filter(card => ctx.card(card.cardId).kind === "entity");
            if (candidates.length === 0) {
              ctx.log(msg("log.no.permanent", { seat: by, card: step.source.cardId }), by);
              break;
            }
            let chosen: CardInstance | null = null;
            while (!chosen) chosen = await pickFromPile(by, "ritiro", candidates, t("pick.recall.hand"));
            const passed = await ctx.dispatch({ t: "toZone", uid: chosen.uid, zone: "hand", roll, effect: attackRef(step, "recall") });
            if (passed) ctx.log(msg("log.effect.recall.hand", { seat: by, sourceCard: step.source.cardId, card: chosen.cardId }), by);
          }
          if (form.thenDraw) {
            const drawn = await ctx.dispatch({ t: "draw", seat: by, count: form.thenDraw, effect: attackRef(step, "draw") });
            if (drawn) ctx.log(msg("log.effect.trigger", { seat: by, card: step.source.cardId, n: form.thenDraw, cards: msg(form.thenDraw === 1 ? "cards.one" : "cards.many") }), by);
            await wait(TRIGGER_TAIL_MS);
          }
          for (let left = form.thenDiscard ?? 0; left > 0; left -= 1) {
            const hand = zoneCards(ctx.state(), by, "hand");
            if (hand.length === 0) break;
            let chosen: CardInstance | null = null;
            while (!chosen) chosen = await pickFromPile(by, "hand", hand, t("pick.discard"));
            const passed = await ctx.dispatch({ t: "toZone", uid: chosen.uid, zone: "abisso", effect: attackRef(step, "discard") });
            if (passed) ctx.log(msg("log.effect.discard", { seat: by, sourceCard: step.source.cardId, card: chosen.cardId }), by);
            else break;
          }
          break;
        }
        case "return": {
          const roll = rollDie(form.die);
          await showRoll(root, form.die, roll, t("dice.step", { name, what: t("dice.recall", { lo: form.onRoll[0], hi: form.onRoll[1] }) }));
          if (!inRange(roll, form.onRoll)) {
            ctx.log(msg("log.effect.roll", { seat: by, sourceCard: step.source.cardId, die: form.die, roll, what: msg("roll.nothing") }), by);
            break;
          }
          const candidates = zoneCards(ctx.state(), by, "ritiro").filter(card => {
            const f = ctx.card(card.cardId);
            return f.kind === form.filter.kind && f.race === form.filter.race;
          });
          if (candidates.length === 0) {
            ctx.log(msg("log.no.permanent", { seat: by, card: step.source.cardId }), by);
            break;
          }
          const spot = freeFrontSlotOrNull(ctx.state(), by);
          if (!spot) {
            ctx.log(msg("log.front.full", { seat: by, card: step.source.cardId }), by);
            break;
          }
          let chosen: CardInstance | null = null;
          while (!chosen) chosen = await pickFromPile(by, "ritiro", candidates, t("pick.recall.front"));
          const passed = await ctx.dispatch({ t: "toZone", uid: chosen.uid, zone: "field", ...spot, z: ctx.state().zTop + 1, roll, effect: attackRef(step) });
          if (!passed) break;
          flyFromPile(by, "ritiro", chosen.uid);
          await wait(FLY_MS);
          const target = rubyfrontOf(otherSeat(by));
          if (target) {
            const order = nextWaveOrder(ctx.state(), by);
            const joined = await ctx.dispatch({
              t: "declare",
              declaration: { id: crypto.randomUUID(), from: chosen.uid, to: target.uid, kind: "attack", seat: by, order },
              effect: { source: step.source.uid, event: "on_attack", entering: chosen.uid, follow: "join" },
            });
            if (joined) {
              if (!neverTaps(ctx.card(chosen.cardId))) void ctx.dispatch({ t: "tap", uid: chosen.uid, tapped: true });
              ctx.log(msg("log.effect.recall.front", { seat: by, sourceCard: step.source.cardId, card: chosen.cardId }), by);
            }
          }
          break;
        }
        case "rearm": {
          const objects = zoneCards(ctx.state(), by, "ritiro").filter(card => ctx.card(card.cardId).kind === "object");
          if (objects.length === 0) break;
          const chosen = await pickFromPile(by, "ritiro", objects, t("pick.rearm"));
          if (!chosen) break;
          const attacker = ctx.state().cards[step.attacker.uid];
          if (!attacker) break;
          const worn = Object.values(ctx.state().cards).filter(other => other.assignedTo === attacker.uid && other.zone === "field").length;
          const spot = { x: attacker.x + STACK_STEP * (worn + 1), y: attacker.y + STACK_STEP * (worn + 1) };
          const passed = await ctx.dispatch({ t: "toZone", uid: chosen.uid, zone: "field", ...spot, z: attacker.z - 1, assignTo: attacker.uid, effect: attackRef(step) });
          if (passed) {
            flyFromPile(by, "ritiro", chosen.uid);
            await wait(FLY_MS);
            ctx.log(msg("log.effect.rearm", { seat: by, sourceCard: step.source.cardId, card: chosen.cardId, toCard: attacker.cardId }), by);
          }
          break;
        }
        case "untap":
          break;
      }
      await wait(TRIGGER_TAIL_MS);
    } finally {
      light(step.source.uid, false);
      hold(false);
    }
  }

  async function playAttackTriggers(attacker: CardInstance, own: AttackStep[] = []): Promise<void> {
    for (const step of returnsFor(ctx.state(), attacker, ctx.card, "on_attack")) {
      await playReturn(step);
    }
    for (const step of attackDraws(ctx.state(), attacker, ctx.card)) {
      await playAttackDraw(step);
    }
    await playAttackSteps(own);
  }

  /**
   * La pesca all'attacco (§8.2, RBF-026): la fonte si accende, si pesca;
   * poi «scarta una carta» — obbligatoria: la finestra torna finché non si
   * sceglie (a mano vuota, non c'è nulla da scartare).
   */
  async function playAttackDraw(step: AttackDrawStep): Promise<void> {
    const by = controllerOf(step.source);
    hold(true);
    light(step.source.uid, true);
    try {
      await wait(TRIGGER_LEAD_MS);
      const passed = await resolveAttackDraw(ctx, step);
      if (!passed) return;
      await wait(TRIGGER_TAIL_MS);
      for (let left = step.thenDiscard; left > 0; left -= 1) {
        const hand = zoneCards(ctx.state(), by, "hand");
        if (hand.length === 0) break;
        let chosen: CardInstance | null = null;
        while (!chosen) chosen = await pickFromPile(by, "hand", hand, t("pick.discard"));
        if (!(await resolveAttackDiscard(ctx, step, chosen))) break;
      }
    } finally {
      light(step.source.uid, false);
      hold(false);
    }
  }

  function startTargeting(attacker: CardInstance, kind: "block" | "counter"): void {
    targeting = { mode: "block", attacker: attacker.uid, kind, pointer: null };
    document.body.classList.add("is-targeting");
    targetHint.textContent =
      kind === "counter"
        ? t("target.counter")
        : t("target.block");
    targetHint.hidden = false;
    render();
  }

  /**
   * Il posto che sceglie il bloccante: l'altra metà rispetto all'attaccante.
   * In rete è sempre il proprio; in partita locale può essere l'uno o l'altro,
   * a seconda di chi ha dichiarato l'attacco. Null fuori dal modo bersaglio.
   */
  function defenderSeat(): Seat | null {
    if (targeting?.mode !== "block") return null;
    const attacker = ctx.state().cards[targeting.attacker];
    return attacker ? otherSeat(controllerOf(attacker)) : null;
  }

  /**
   * §6.5 — «non si possono avere più di 7 carte in mano: alla fine del
   * proprio turno, le carte in eccesso vanno scartate (nell'Abisso)». Con
   * l'eccesso in mano lo scarto è l'unico modo di andare nell'Abisso a
   * mano, e il gesto resta sempre possibile.
   */
  function canDiscard(card: CardInstance): boolean {
    return card.zone === "hand" && ctx.controls(card.owner) && !handLocked(card.owner) && zoneCards(ctx.state(), card.owner, "hand").length > 7;
  }

  /**
   * §6 — «nel turno altrui non si agisce»: la mano di `seat` è chiusa a
   * chiave quando il momento non è suo. Il momento è suo quando chiude la
   * fase (chi è di turno; in Reazione il difensore, §6.4) o quando la
   * catena di risposta aspetta lui (§7.2). Fuori di lì la mano si guarda e
   * basta: niente trascinamento, niente doppio click, niente menu — salvo
   * che il tavolo gli chieda esplicitamente una carta (pickFromPile apre
   * la sua vetrina, non passa dalla mano). Vale per il bot come per un
   * avversario in rete: a tavolo libero (senza arbitro) resta libera.
   */
  function handLocked(seat: Seat): boolean {
    if (!ctx.arbitrated()) return false;
    const state = ctx.state();
    if (state.chain && !state.chain.resolving) return state.chain.turn !== seat;
    return phaseCloser(state) !== seat;
  }

  /**
   * L'invito a scartare: l'Abisso acceso. Non si accende da sé alla settima
   * carta — sarebbe un rimprovero per tutto il turno, e §6.5 è una regola di
   * CHIUSURA: pescare l'ottava a metà turno è legale. Si accende quando il
   * Fine turno viene fermato, e si spegne al primo scarto o al cambio di
   * turno: il turno se lo porta scritto, così non riaccende quello dopo.
   */
  let discardPrompt: { seat: Seat; turn: number } | null = null;

  function clearDiscardPrompt(seat: Seat): void {
    if (discardPrompt?.seat === seat) discardPrompt = null;
  }

  /** La carta è scegliibile nel modo bersaglio in corso? */
  function pickable(card: CardInstance): boolean {
    if (!targeting) return false;
    if (targeting.mode === "effect") return targeting.candidates.has(card.uid);
    return controllerOf(card) === defenderSeat() && card.uid !== targeting.attacker;
  }

  function cancelTargeting(): void {
    if (!targeting) return;
    const was = targeting;
    targeting = null;
    document.body.classList.remove("is-targeting");
    targetHint.hidden = true;
    render();
    if (was.mode === "effect") was.cancel();
  }

  function confirmBlock(blocker: CardInstance): void {
    if (targeting?.mode !== "block") return;
    const { attacker, kind } = targeting;
    cancelTargeting();
    void declareBlock(ctx, blocker, attacker, kind);
  }

  /**
   * La mira di un effetto (§8.2): si sceglie il bersaglio fra i candidati,
   * con la freccia dalla fonte al dito. Risolve con la carta scelta, o con
   * null se si rinuncia (Esc, click a vuoto).
   */
  function pickTarget(source: CardInstance, candidates: CardInstance[], hint: string): Promise<CardInstance | null> {
    // Il bot sceglie da sé: il bersaglio si accende un attimo, così chi
    // guarda vede cosa è stato scelto, e la mira non si apre.
    if (auto && isAuto(controllerOf(source))) {
      const chosen = auto.chooser.pickTarget(source, candidates);
      if (chosen) strike(chosen.uid, 900);
      return wait(450).then(() => chosen);
    }
    return new Promise(resolve => {
      // Mentre un effetto si risolve il tavolo è insensibile al puntatore
      // (`is-resolving`), perché nessuno ci metta le mani a metà. Ma la mira
      // È il gesto del giocatore: qui la presa si molla, e si riprende
      // scelto il bersaglio — o rinunciando. Senza, la carta da colpire non
      // si lasciava cliccare (RBF-005, «un'Entità avversaria non potrà
      // bloccare»).
      const held = document.body.classList.contains("is-resolving");
      if (held) hold(false);
      const release = (): void => {
        if (held) hold(true);
      };
      targeting = {
        mode: "effect",
        source: source.uid,
        candidates: new Set(candidates.map(card => card.uid)),
        pointer: null,
        pick: card => {
          targeting = null;
          document.body.classList.remove("is-targeting");
          targetHint.hidden = true;
          release();
          render();
          playSound("select");
          resolve(card);
        },
        cancel: () => {
          release();
          resolve(null);
        },
      };
      document.body.classList.add("is-targeting");
      targetHint.textContent = t("target.esc", { hint });
      targetHint.hidden = false;
      render();
    });
  }

  /**
   * La carta colpita da un effetto si accende di rosso per un attimo.
   *
   * Prima era una freccia dalla fonte al bersaglio, ma una freccia che
   * compare e sparisce si legge male: chiede di seguire due punti mentre la
   * cosa che conta è UNA, la carta toccata. Il lampo sta addosso a lei.
   * `ms` a zero spegne subito — serve a chi tiene acceso il bersaglio
   * mentre chiede conferma, e poi lo lascia.
   */
  const strikes = new Map<string, number>();

  function strike(uid: string, ms: number): void {
    const tile = tiles.get(uid);
    window.clearTimeout(strikes.get(uid));
    strikes.delete(uid);
    if (!tile) return;
    if (ms <= 0) {
      tile.classList.remove("is-struck");
      return;
    }
    // Togliere e rimettere la classe fa ripartire l'animazione anche se la
    // stessa carta viene colpita due volte di fila.
    tile.classList.remove("is-struck");
    void tile.offsetWidth;
    tile.classList.add("is-struck");
    strikes.set(uid, window.setTimeout(() => {
      tile.classList.remove("is-struck");
      strikes.delete(uid);
    }, ms));
  }

  function pileMenu(seat: Seat, zone: ZoneId): MenuItem[] {
    const mine = ctx.controls(seat);
    const count = zoneCards(ctx.state(), seat, zone).length;
    if (zone === "deck") {
      return [
        { label: t("menu.draw1"), run: () => draw(seat, 1), disabled: !mine || count === 0 },
        { label: t("menu.draw6"), run: () => draw(seat, 6), disabled: !mine || count === 0 },
        { label: t("menu.shuffle"), run: () => shuffle(seat), disabled: !mine || count === 0 },
        { rule: true, label: "" },
        { label: t("menu.search", { n: count }), run: () => browse(seat, "deck"), disabled: !mine || count === 0 },
      ];
    }
    return [{ label: t("menu.browse", { n: count }), run: () => browse(seat, zone), disabled: count === 0 }];
  }

  function cardMenu(card: CardInstance): MenuItem[] {
    const items: MenuItem[] = [];
    // «Mia» = di un posto che governo: in rete solo il proprio, in partita
    // locale entrambi.
    // «Mia» = comandata da un posto che governo: chi la controlla, o il
    // proprietario (§8.2).
    const mine = ctx.controls(controllerOf(card));
    const declared = declarationOf(ctx.state(), card.uid);

    // Il combattimento sta in cima al menu: è quello che si cerca in Fase di
    // Fronte. Tappa/Stappa resta subito sotto e sempre disponibile.
    if (card.zone === "field") {
      if (mine) {
        if (declared?.kind === "attack") {
          items.push({
            label: t("menu.attack.undo", { n: declared.order ?? "" }),
            run: () => void undeclare(ctx, card, declared),
          });
        } else if (declared) {
          items.push({
            label: t(declared.kind === "counter" ? "menu.counter.undo" : "menu.block.undo"),
            run: () => void undeclare(ctx, card, declared),
          });
        } else {
          // «Attacca» solo a chi può attaccare, e solo quando si attacca:
          // in Fase di Fronte (§6.3), nel proprio turno. Il Rubyfront non
          // attacca (§3.1) e dichiarano solo le Entità (§6.3) — il gesto che
          // l'arbitro fermerebbe comunque non si offre nemmeno. La carta
          // ignota resta permissiva, come per l'engine; quando la regola
          // d'oro concederà eccezioni, sarà lei a riaprire la voce.
          const state = ctx.state();
          const kind = faceKind(card.cardId, card.face);
          if ((kind === null || kind === "entity") && state.phase === "fronte" && state.active === controllerOf(card)) {
            items.push({ label: t("menu.attack"), run: () => declareAttack(card) });
          }
        }
      }
      // Un attaccante dichiarato si ferma dall'altra metà del tavolo: in rete
      // è sempre una carta avversaria, in locale anche la propria — chi guida
      // entrambi i posti blocca con le Entità del difensore.
      // E si blocca in Reazione, «vista l'intera ondata» (§6.4).
      if (declared?.kind === "attack" && ctx.controls(otherSeat(controllerOf(card))) && ctx.state().phase === "reazione") {
        items.push({ label: t("menu.block"), run: () => startTargeting(card, "block") });
        items.push({ label: t("menu.counter"), run: () => startTargeting(card, "counter") });
      }
      if (items.length) items.push({ rule: true, label: "" });
    }

    if (card.zone === "field") {
      // Con l'arbitro al tavolo, tappare/stappare/coprire/scoprire non sono
      // più gesti liberi: il tap arriva dall'attacco, la copertura dal
      // contrattacco, la stappata e la scoperta a fine giro (§6.3, T+3) dal
      // cambio di turno. Resta «Scopri» solo per una coperta SENZA data —
      // arrivata da una lavagna che non la segnava — che altrimenti non si
      // scoprirebbe mai. Quando una carta concederà questi gesti (regola
      // d'oro), sarà l'engine a riaprirli. A engine spento: lavagna libera.
      if (!ctx.arbitrated()) {
        items.push({
          label: t(card.tapped ? "menu.untap" : "menu.tap"),
          run: () => ctx.dispatch({ t: "tap", uid: card.uid, tapped: !card.tapped }),
        });
        items.push({
          label: t(card.facedown ? "menu.uncover" : "menu.cover"),
          run: () => ctx.dispatch({ t: "facedown", uid: card.uid, facedown: !card.facedown }),
        });
      } else if (card.facedown && card.coveredTurn === undefined) {
        items.push({
          label: t("menu.uncover"),
          run: () => ctx.dispatch({ t: "facedown", uid: card.uid, facedown: false }),
        });
      }
    }
    // §3.1 — le abilità speciali del Rubyfront/Nexus, con l'arbitro: quelle
    // della faccia in vista, nel proprio turno e nella loro finestra, coi PV
    // che coprono il costo. Senza forma certificata restano a mano: la voce
    // lo dice, spenta.
    if (ctx.arbitrated() && mine && card.zone === "field" && inPlay(card, ctx.card(card.cardId).kind)) {
      const state = ctx.state();
      const facts = ctx.card(card.cardId);
      const own = state.active === controllerOf(card);
      for (const ability of facts.abilities.filter(candidate => candidate.face === card.face)) {
        const copy = abilityCopy(card.cardId, ability.face, ability.displayKey, ctx.locale());
        const price = ability.cost !== null ? t("ability.cost", { n: ability.cost }) : t("ability.gain", { n: ability.gain ?? 0 });
        if (!ability.form) {
          items.push({ label: t("ability.manual", { name: copy.name }), disabled: true });
          continue;
        }
        const open = own && ability.timing.includes(state.phase) && state.players[card.owner].hp >= (ability.cost ?? 0);
        items.push({ label: t("menu.ability", { name: copy.name, price }), disabled: !open, run: () => void useAbility(card, ability) });
      }
      if (facts.abilities.some(candidate => candidate.face === card.face)) items.push({ rule: true, label: "" });
    }
    if (faceCount(card.cardId) > 1) {
      const next = (card.face + 1) % faceCount(card.cardId);
      const nexus = ctx.card(card.cardId).nexus;
      // Con l'arbitro il flip verso il Nexus passa dal requisito (§3.1);
      // il Nexus non torna Rubyfront. Requisito non certificato, o engine
      // spento: la carta si gira liberamente, come prima.
      if (ctx.arbitrated() && nexus && mine) {
        if (card.face !== nexus.face && card.zone === "field") items.push({ label: t("menu.flip.nexus"), run: () => void flipToNexus(card) });
      } else {
        items.push({
          label: t(card.face === 0 ? "menu.flip.nexus" : "menu.flip.rubyfront"),
          run: () => ctx.dispatch({ t: "flip", uid: card.uid, face: next }),
        });
      }
    }
    items.push({ rule: true, label: "" });
    const send = (zone: ZoneId, label: string, toBottom = false): MenuItem => ({
      label,
      disabled: card.zone === zone && !toBottom,
      run: () => ctx.dispatch({ t: "toZone", uid: card.uid, zone, toBottom }),
    });
    // §5/§6.2 — con l'arbitro, dall'Abisso e dalla Zona di Ritiro si esce
    // solo per effetto: nessuna destinazione a mano. Ci si ENTRA liberamente
    // (il Ritiro è un gesto, §6.2), ma non se ne torna.
    //
    // §8.2 — e l'Entità PRESA IN CONTROLLO non è tua: te la comanda fino a
    // fine turno, poi torna al proprietario. Non si manda da nessuna parte,
    // men che meno nella Zona di Ritiro di chi la possiede.
    const borrowed = ctx.arbitrated() && card.controller !== undefined && card.controller !== card.owner;
    const sealed = borrowed || (ctx.arbitrated() && (card.zone === "abisso" || card.zone === "ritiro"));
    const owned = ctx.controls(card.owner);
    if (owned && !sealed) items.push(send("hand", t("menu.to.hand")));
    // §5/§6.5 — con l'arbitro nell'Abisso non si va a mano: ci si va morendo,
    // consumandosi (una Materia in campo) o scartando per eccesso a fine
    // turno. La voce libera resta solo dove l'arbitro la lascerebbe passare;
    // lo scarto per eccesso ha la sua, che dice perché si può.
    if (canDiscard(card)) {
      items.push({
        label: t("menu.discard"),
        run: () =>
          void ctx.dispatch({ t: "toZone", uid: card.uid, zone: "abisso" }).then(passed => {
            if (!passed) return;
            clearDiscardPrompt(card.owner);
            ctx.log(msg("log.discard", { seat: card.owner, card: card.cardId, n: zoneCards(ctx.state(), card.owner, "hand").length }), card.owner);
            render();
          }),
      });
    } else if (!sealed && (!ctx.arbitrated() || (card.zone === "field" && ctx.card(card.cardId).kind === "matter"))) {
      items.push(send("abisso", t("menu.to.abisso")));
    }
    // Il Ritiro resta un gesto libero: ci si manda una carta da dove sia.
    if (!sealed) items.push(send("ritiro", t("menu.to.ritiro")));
    if (owned && !sealed) {
      items.push(send("deck", t("menu.to.deck.top")));
      items.push({
        label: t("menu.to.deck.bottom"),
        run: () => ctx.dispatch({ t: "toZone", uid: card.uid, zone: "deck", toBottom: true }),
      });
    }
    return items;
  }

  /**
   * Un Oggetto lasciato sopra un'Entità le va DIETRO: chi agisce resta in
   * vista, l'equipaggiamento fa capolino da sotto (la scaletta di stackAt gli
   * lascia già l'angolo fuori). E dietro vuol dire in fondo alla pila: sotto
   * l'Entità E sotto gli Oggetti già appesi, sennò il secondo si accavalla al
   * primo con lo stesso z e uno dei due si perde. Tutto il resto sale in cima
   * come sempre.
   */
  /** Le carte in campo toccate da un rilascio in (x, y), esclusa la mossa. */
  function touchedAt(card: CardInstance, x: number, y: number): CardInstance[] {
    return fieldCards(ctx.state()).filter(
      other =>
        other.uid !== card.uid &&
        Math.abs(other.x - x) < TILE_W &&
        Math.abs(other.y - y) < TILE_H
    );
  }

  /**
   * §3.1 — l'Entità che riceverebbe l'Oggetto se lo lasciassi adesso: si
   * accende di rubino mentre il dito è sopra, e si spegne al rilascio.
   * L'assegnazione è l'unico gesto del tavolo in cui una carta ne cerca
   * un'altra, e senza un segno si tira a indovinare — soprattutto con
   * l'arbitro, che tiene i pixel fermi fino al rilascio.
   */
  let bersaglioAssegnazione = null as string | null;

  function segnaAssegnazione(uid: string | null): void {
    if (bersaglioAssegnazione === uid) return;
    if (bersaglioAssegnazione) tiles.get(bersaglioAssegnazione)?.classList.remove("is-assign-target");
    bersaglioAssegnazione = uid;
    if (uid) tiles.get(uid)?.classList.add("is-assign-target");
  }

  /** L'Entità su cui un Oggetto è stato posato, se c'è: è lei che lo riceve. */
  function entityUnder(card: CardInstance, x: number, y: number): CardInstance | undefined {
    if (faceKind(card.cardId, card.face) !== "object") return undefined;
    return touchedAt(card, x, y).find(other => faceKind(other.cardId, other.face) === "entity");
  }

  function dropZ(card: CardInstance, x: number, y: number): number {
    const state = ctx.state();
    const top = state.zTop + 1;
    // Va dietro solo se sotto c'è un'Entità: l'Oggetto posato sul vuoto (o su
    // altre carte qualsiasi) resta una carta come le altre.
    if (!entityUnder(card, x, y)) return top;
    const pile = touchedAt(card, x, y).filter(other => {
      const kind = faceKind(other.cardId, other.face);
      return kind === "entity" || kind === "object";
    });
    // Il -9 tiene lo z-index del DOM sopra lo zero (il disegno somma 10):
    // più giù, la carta finirebbe sotto il tappeto.
    return Math.max(-9, Math.min(...pile.map(other => other.z)) - 1);
  }

  /**
   * Posa la carta in campo: sposta se c'era già, altrimenti ce la porta —
   * e dalla mano la GIOCA, pagando il costo di Flusso stampato (§3.2). Il
   * costo lo legge il catalogo e viaggia nell'azione: l'arbitro lo verifica
   * e lo ferma se il Flusso non basta; il riduttore lo scala. Il Rubyfront
   * non paga di qui: il suo costo di schieramento può essere un dado, e si
   * regola a mano (§3.1). Dice se il gesto è passato.
   */
  async function place(card: CardInstance, x: number, y: number, z: number): Promise<boolean> {
    if (card.zone === "field") {
      // Con l'arbitro i pixel non si sono mossi durante il trascinamento:
      // riposare la carta dov'era non è uno spostamento, e la dogana degli
      // slot (§5) fermerebbe a torto un gesto che non c'è.
      if (ctx.arbitrated() && card.x === x && card.y === y) return true;
      return ctx.dispatch({ t: "move", uid: card.uid, x, y, z });
    }
    const facts = ctx.card(card.cardId);
    // Una Materia che adesso non farebbe nulla (nessun bersaglio, la
    // condizione non c'è) si gioca solo apposta: l'avviso lo dice prima
    // di pagare. Il blocco di una Reattiva bloccante è già un effetto.
    if (card.zone === "hand" && facts.kind === "matter" && facts.resolveForms.length) {
      const steps = resolveSteps(ctx.state(), card, ctx.card);
      if (steps.length && steps.every(step => step.blocked !== null && step.form.kind !== "block")) {
        const go = await confirmFor(card.owner, t("confirm.matter.noeffect", { card: `«${cardName(card.cardId, ctx.locale())}»` }), { yes: t("confirm.play.anyway"), no: t("confirm.play.not") });
        if (!go) {
          render();
          return false;
        }
      }
    }
    let cost = card.zone === "hand" && !isRubyfront(card.cardId) ? facts.fluxCost : null;
    // Una Materia che chiede il bersaglio già giocandola (RBF-021: «se
    // bersaglia un'Entità tappata, costa 3 in meno»): si mira prima, il
    // bersaglio viaggia nell'azione e lo sconto ne discende. Esc: nessun
    // bersaglio, costo pieno, e l'effetto sceglierà dopo.
    let target: CardInstance | null = null;
    if (card.zone === "hand" && facts.kind === "matter" && wantsTargetOnPlay(facts)) {
      const form = facts.resolveForms.find(candidate => candidate.kind === "destroy");
      const foes = fieldCards(ctx.state()).filter(other => ctx.card(other.cardId).kind === "entity" && (!form || form.kind !== "destroy" || form.target.controller !== "opponent" || controllerOf(other) !== card.owner));
      const discount = form && form.kind === "destroy" ? form.discount?.amount ?? 0 : 0;
      if (foes.length) target = await pickTarget(card, foes, t("target.judgment.play", { n: discount }));
      cost = discountedCost(ctx.state(), card.cardId, target, ctx.card);
    }
    // §3.1 — lo sconto di un'abilità del Rubyfront («la prossima carta X
    // del turno costa N in meno»): si dichiara nell'azione, e il costo
    // scende — mai sotto 1. Lo consuma il riduttore.
    const abilityOff = card.zone === "hand" && cost !== null ? abilityDiscount(ctx.state(), card.owner, facts) : null;
    if (abilityOff && cost !== null) cost = Math.max(1, cost - abilityOff.amount);
    // §7.2 — la Reattiva giocata apre (o allunga) la catena di risposta: il
    // segno viaggia nell'azione, e l'engine lo pretende.
    const reactive = card.zone === "hand" && facts.kind === "matter" && facts.behavior === "reactive";
    const passed = await ctx.dispatch({
      t: "toZone",
      uid: card.uid,
      zone: "field",
      x,
      y,
      z,
      ...(cost !== null ? { cost } : {}),
      ...(abilityOff ? { discount: abilityOff.amount } : {}),
      ...(target ? { target: target.uid } : {}),
      ...(reactive ? { chain: true as const } : {}),
    });
    const effects = card.zone === "hand" ? enterEffects(card.cardId, card.face, ctx.locale()) : [];
    if (passed && cost !== null) {
      const player = ctx.state().players[card.owner];
      // In chat solo il gesto: il testo dell'effetto si legge sulla carta,
      // lo storico resta pulito.
      ctx.log(msg("log.play", { seat: card.owner, card: card.cardId, cost, flux: player.flux, max: player.fluxMax }), card.owner);
      if (abilityOff) ctx.log(msg("log.play.discount", { n: abilityOff.amount }), card.owner);
    }
    // Una Materia con un effetto certificato (§7.2): la scena elenca i
    // passi, «Risolvi» li esegue, e la carta — se non è permanente — va
    // nell'Abisso. Quella che «si gioca come blocco» (RBF-020) prima
    // sceglie l'attaccante da fermare.
    if (passed && reactive) {
      // La Reattiva aspetta in catena: si risolve quando l'avversario
      // accetta (driveChain), non adesso.
      void openChain(ctx.state().cards[card.uid] ?? card);
      return passed;
    }
    if (passed && card.zone === "hand" && facts.kind === "matter" && facts.resolveForms.length) {
      const live = ctx.state().cards[card.uid] ?? card;
      void playMatter(live, effects);
      return passed;
    }
    // Il momento d'ingresso: ogni carta giocata dalla mano si ferma in primo
    // piano e si accende; se ha un effetto che scatta entrando, lo annuncia
    // (effect.ts).
    if (passed && card.zone === "hand") {
      // Gli inneschi delle carte già in campo (effects.ts): la scena li
      // elenca, e «Risolvi» li esegue — con un bagliore sulla fonte.
      const live = ctx.state().cards[card.uid] ?? card;
      const moves = enterMoves(ctx.state(), live, ctx.card);
      const returns = enterReturns(ctx.state(), live, ctx.card);
      const looks = enterLooks(ctx.state(), live, ctx.card);
      const controls = enterControls(ctx.state(), live, ctx.card);
      const refreshes = enterRefreshes(live, ctx.card);
      const triggers = enterTriggers(ctx.state(), live, ctx.card);
      void showEnterEffect(root, {
        cardId: card.cardId,
        face: card.face,
        theme: ctx.themeFor(card.owner),
        locale: ctx.locale(),
        who: t("scene.plays", { name: seatLabel(ctx.state(), card.owner), card: `«${cardName(card.cardId, ctx.locale())}»` }),
        effects,
        triggers: [
          ...moves.map(step => describeMove(step, ctx.card)),
          ...returns.map(step => describeReturn(step, ctx.card)),
          ...looks.map(step => describeLook(step, ctx.card)),
          ...controls.map(step => describeControl(step, ctx.card)),
          ...refreshes.map(step => describeRefresh(step, ctx.card)),
          ...triggers.map(trigger => describeTrigger(trigger, ctx.card)),
        ],
        onContinue:
          moves.length || returns.length || looks.length || controls.length || refreshes.length || triggers.length ? () => void playTriggers(live) : undefined,
      });
    }
    return passed;
  }

  /**
   * Una Materia normale o permanente giocata (§7.2): la scena coi passi e
   * «Risolvi», e la normale va nell'Abisso. Le Reattive non passano di qui:
   * aprono la catena (openChain) e si risolvono quando l'avversario accetta.
   */
  async function playMatter(matter: CardInstance, effects: { tag: string; text: string }[]): Promise<void> {
    await resolveMatter(matter, effects, false);
  }

  /**
   * §7.2 — la Reattiva giocata è in catena. Quella che ferma un attaccante
   * (RBF-040, §6.4) lo sceglie subito: il blocco è la giocata; senza
   * attaccante si consuma a vuoto ed esce dalla catena. Poi si aspetta la
   * parola dell'avversario.
   */
  async function openChain(matter: CardInstance): Promise<void> {
    const facts = ctx.card(matter.cardId);
    const by = controllerOf(matter);
    if (blocksAttacker(facts)) {
      const blocking = await declareMatterBlock(matter);
      if (!blocking) {
        await spendMatter(matter);
        return;
      }
    }
    const stack = ctx.state().chain?.stack ?? [];
    ctx.log(msg(stack.length > 1 ? "log.chain.respond" : "log.chain.open", { seat: by, card: matter.cardId }), by);
  }

  /** «Gioca questa carta come blocco a un attaccante» (§6.4): sceglie e dichiara. Dice se blocca. */
  async function declareMatterBlock(matter: CardInstance): Promise<boolean> {
    const by = controllerOf(matter);
    const attackers = attackersOf(ctx.state(), otherSeat(by), null, ctx.card).filter(card => !ctx.state().declarations.some(d => d.to === card.uid && d.kind !== "attack"));
    const attacker = attackers.length ? await pickTarget(matter, attackers, t("target.blockwith")) : null;
    if (!attacker) return false;
    const passed = await ctx.dispatch({
      t: "declare",
      declaration: { id: crypto.randomUUID(), from: matter.uid, to: attacker.uid, kind: "block", seat: by, order: 0 },
    });
    if (passed) ctx.log(msg("log.effect.blockwith", { seat: by, card: attacker.cardId, sourceCard: matter.cardId }), by);
    return passed;
  }

  /**
   * La risoluzione di una Materia (§7.2): la scena coi passi e «Risolvi»;
   * risolta, la normale o Reattiva va nell'Abisso — la Reattiva che blocca
   * resta finché l'ondata si risolve (§6.4), la permanente resta in gioco.
   * Se era in catena, chiuso il passo esce dalla pila (`settle`), e la
   * catena passa alla carta sotto.
   */
  async function resolveMatter(matter: CardInstance, effects: { tag: string; text: string }[], blocking: boolean): Promise<void> {
    const facts = ctx.card(matter.cardId);
    const by = controllerOf(matter);
    const steps = pendingResolve(ctx.state(), matter, ctx.card);
    await showEnterEffect(root, {
      cardId: matter.cardId,
      face: matter.face,
      theme: ctx.themeFor(matter.owner),
      locale: ctx.locale(),
      who: t("scene.resolves", { name: seatLabel(ctx.state(), by), card: `«${cardName(matter.cardId, ctx.locale())}»` }),
      effects,
      triggers: steps.map(step => describeResolveStep(step, ctx.card)),
      kicker: t("scene.resolve.matter"),
      // I passi seguono la scena, qui sotto: il tasto dice solo «Risolvi».
      onContinue: () => undefined,
    });
    for (const step of steps) await playResolveStep(step);
    if (facts.behavior !== "permanent" && !blocking) await spendMatter(matter);
    if (ctx.state().chain?.stack.includes(matter.uid)) await ctx.dispatch({ t: "settle", uid: matter.uid });
  }

  /**
   * §7.2 — la catena si risolve «in ordine inverso: l'ultima Materia giocata
   * si risolve per prima». Chi comanda la carta in cima la risolve; risolta,
   * esce dalla pila e la cima passa alla carta sotto, che il suo client
   * risolverà a sua volta — ogni lavagna passa di qui a ogni ridisegno, e
   * si muove solo per una carta sua, una alla volta.
   */
  let chainBusy: string | null = null;
  function driveChain(): void {
    const state = ctx.state();
    if (!state.chain?.resolving || chainBusy) return;
    const top = chainTop(state);
    if (!top || top.zone !== "field" || !ctx.controls(controllerOf(top))) return;
    chainBusy = top.uid;
    const blocking = state.declarations.some(d => d.from === top.uid && d.kind === "block");
    void resolveMatter(top, enterEffects(top.cardId, top.face, ctx.locale()), blocking).finally(() => {
      chainBusy = null;
      render();
    });
  }

  /** Il posto della carta in catena, al centro del tavolo, a scaletta: in coordinate di VISTA. */
  function chainSpot(index: number): { x: number; y: number } {
    const centerX = SURFACE_W / 2;
    return { x: centerX - TILE_W / 2 + index * 44, y: (surfaceViewH() - tileViewH()) / 2 + index * 26 };
  }

  /** La Materia risolta va nell'Abisso (§7.2: «poi la carta va nell'Abisso»). */
  async function spendMatter(matter: CardInstance): Promise<void> {
    const live = ctx.state().cards[matter.uid];
    if (!live || live.zone !== "field") return;
    const fly = liftForFlight(matter.uid, "abisso");
    const passed = await ctx.dispatch({ t: "toZone", uid: matter.uid, zone: "abisso" });
    if (passed) {
      fly?.();
      ctx.log(msg("log.effect.spent", { seat: controllerOf(matter), card: matter.cardId }), controllerOf(matter));
    } else {
      fly?.cancel();
    }
  }

  /**
   * Un passo di una Materia (§7.2, le forme di resolveSteps): la fonte si
   * accende, si mira o si sceglie se c'è da scegliere, il dado si tira se
   * c'è, l'azione parte col suo riferimento. Il «no» dell'engine ferma il
   * passo e basta.
   */
  async function playResolveStep(first: ResolveStep): Promise<void> {
    const by = controllerOf(first.source);
    const form = first.form;
    const name = ctx.card(first.source.cardId).name;
    // I candidati si rileggono adesso: i passi precedenti possono aver mosso carte.
    const step = pendingResolve(ctx.state(), first.source, ctx.card).find(candidate => candidate.form === form) ?? first;
    const ref = resolveRef(step.source);
    if (step.blocked) {
      ctx.log(msg(step.blocked, { seat: by, card: step.source.cardId }), by);
      return;
    }
    light(step.source.uid, true);
    try {
      switch (form.kind) {
        case "look": {
          const reveal = await pickFromPile(by, "deck", step.candidates, t("pick.lure", { n: step.looked.length }), step.looked);
          hold(true);
          await wait(CONFIRMED_LEAD_MS);
          const passed = await ctx.dispatch({ t: "look", seat: by, count: form.count, ...(reveal ? { reveal: reveal.uid } : {}), revealTo: "hand", restTo: "deck", effect: ref });
          if (passed) {
            ctx.log(msg("log.effect.look", { seat: by, sourceCard: step.source.cardId, parts: [msg("look.looked", { n: step.looked.length }), reveal ? msg("look.reveal", { card: reveal.cardId }) : msg("look.noreveal"), msg("look.rest")] }), by);
          }
          break;
        }
        case "empower": {
          if (form.targets === "own_entity") {
            const target = await pickTarget(step.source, step.candidates, t("target.formation"));
            if (!target) break;
            hold(true);
            strike(target.uid, FLY_MS);
            await wait(CONFIRMED_LEAD_MS);
            const passed = await ctx.dispatch({ t: "empower", uid: target.uid, power: form.power, untap: true, effect: ref });
            if (passed) ctx.log(msg("log.effect.untap", { seat: by, sourceCard: step.source.cardId, card: target.cardId, n: form.power }), by);
          } else {
            hold(true);
            await wait(TRIGGER_LEAD_MS);
            for (const target of step.candidates) {
              strike(target.uid, FLY_MS);
              const passed = await ctx.dispatch({ t: "empower", uid: target.uid, counter: form.counter, untap: true, effect: ref });
              if (passed) ctx.log(msg("log.effect.counter", { seat: by, sourceCard: step.source.cardId, card: target.cardId, n: form.counter }), by);
              await wait(TRIGGER_TAIL_MS);
            }
          }
          break;
        }
        case "move":
        case "exile":
        case "destroy": {
          const hint = form.kind === "move" ? "target.impact" : form.kind === "exile" ? "target.repulse" : "target.judgment";
          const target = step.candidates.length === 1 && step.source.target ? step.candidates[0] : await pickTarget(step.source, step.candidates, t(hint));
          if (!target) break;
          strike(target.uid, 60_000);
          const question = form.kind === "move" ? "confirm.impact" : form.kind === "exile" ? "confirm.repulse" : "confirm.judgment";
          const sure = await confirmFor(controllerOf(step.source), t(question, { card: `«${ctx.card(target.cardId).name}»` }));
          if (!sure) {
            strike(target.uid, 0);
            render();
            break;
          }
          hold(true);
          await wait(CONFIRMED_LEAD_MS);
          const fly = liftForFlight(target.uid, form.kind === "move" ? "ritiro" : "abisso");
          const passed = await ctx.dispatch(
            form.kind === "move"
              ? { t: "toZone", uid: target.uid, zone: "ritiro", effect: ref }
              : form.kind === "exile"
                ? { t: "toZone", uid: target.uid, zone: "abisso", heldBy: step.source.uid, effect: ref }
                : { t: "toZone", uid: target.uid, zone: "abisso", effect: ref }
          );
          strike(target.uid, 0);
          if (passed) {
            fly?.();
            const line = form.kind === "move" ? "log.effect.retire" : form.kind === "exile" ? "log.effect.exile" : "log.effect.destroy";
            ctx.log(msg(line, { seat: by, sourceCard: step.source.cardId, card: target.cardId }), by);
            await wait(FLY_MS);
          } else {
            fly?.cancel();
            render();
          }
          break;
        }
        case "block": {
          // RBF-040 — il blocco è già avvenuto giocandola (§6.4); qui la
          // cura, se gli armati sul Fronte bastano (sennò step.blocked).
          hold(true);
          await wait(TRIGGER_LEAD_MS);
          const hp = ctx.state().players[by].hp + form.heal;
          const passed = await ctx.dispatch({ t: "player", seat: by, patch: { hp }, effect: ref });
          if (passed) ctx.log(msg("log.effect.heal", { seat: by, sourceCard: step.source.cardId, n: form.heal, hp }), by);
          await wait(TRIGGER_TAIL_MS);
          break;
        }
        case "fortune": {
          const roll = rollDie(form.die);
          await showRoll(root, form.die, roll, t("dice.step", { name, what: t("dice.fortune") }));
          const all = inRange(roll, form.allOn);
          hold(true);
          if (all || inRange(roll, form.gain.on)) {
            const hp = ctx.state().players[by].hp + form.gain.amount;
            const passed = await ctx.dispatch({ t: "player", seat: by, patch: { hp }, roll, effect: ref });
            if (passed) ctx.log(msg("log.effect.heal", { seat: by, sourceCard: step.source.cardId, n: form.gain.amount, hp }), by);
            await wait(TRIGGER_TAIL_MS);
          }
          if (all || inRange(roll, form.deploy.on)) {
            const filter = form.deploy.filter;
            const candidates = zoneCards(ctx.state(), by, "hand").filter(card => {
              const f = ctx.card(card.cardId);
              return f.kind === filter.kind && (filter.race === null || f.race === filter.race) && (filter.maxCost === null || (f.fluxCost !== null && f.fluxCost <= filter.maxCost));
            });
            const spot = freeFrontSlotOrNull(ctx.state(), by);
            if (candidates.length === 0) ctx.log(msg("log.no.target", { seat: by, card: step.source.cardId }), by);
            else if (!spot) ctx.log(msg("log.front.full", { seat: by, card: step.source.cardId }), by);
            else {
              const chosen = await pickFromPile(by, "hand", candidates, t("pick.fortune.deploy", { n: filter.maxCost ?? 0 }));
              if (chosen) {
                const passed = await ctx.dispatch({ t: "toZone", uid: chosen.uid, zone: "field", ...spot, z: ctx.state().zTop + 1, roll, effect: ref });
                if (passed) ctx.log(msg("log.effect.deploy", { seat: by, sourceCard: step.source.cardId, card: chosen.cardId }), by);
                await wait(TRIGGER_TAIL_MS);
              }
            }
          }
          if (all || inRange(roll, form.draw.on)) {
            const passed = await ctx.dispatch({ t: "draw", seat: by, count: form.draw.count, roll, effect: ref });
            if (passed) ctx.log(msg("log.effect.trigger", { seat: by, card: step.source.cardId, n: form.draw.count, cards: msg(form.draw.count === 1 ? "cards.one" : "cards.many") }), by);
          }
          if (!all && !inRange(roll, form.gain.on) && !inRange(roll, form.deploy.on) && !inRange(roll, form.draw.on)) {
            ctx.log(msg("log.effect.roll", { seat: by, sourceCard: step.source.cardId, die: form.die, roll, what: msg("roll.nothing") }), by);
          }
          break;
        }
      }
      await wait(TRIGGER_TAIL_MS);
    } finally {
      light(step.source.uid, false);
      hold(false);
    }
  }

  /**
   * Il flip verso il Nexus (§3.1), con l'arbitro: il requisito certificato
   * si legge qui (nexusCheck), lo scarto si sceglie dalla mano, il recupero
   * di PV è quello stampato — tutto in un'azione sola, che l'engine
   * verifica. Poi la scena «Quando flippa» coi passi del Nexus.
   */
  async function flipToNexus(card: CardInstance): Promise<void> {
    const facts = ctx.card(card.cardId);
    const nexus = facts.nexus;
    if (!nexus) {
      void ctx.dispatch({ t: "flip", uid: card.uid, face: (card.face + 1) % faceCount(card.cardId) });
      return;
    }
    const by = controllerOf(card);
    const check = nexusCheck(ctx.state(), card, ctx.card);
    if (!check.ok) {
      ctx.log(msg(check.why, { seat: by, n: check.n ?? 0 }), by);
      return;
    }
    let discard: CardInstance | null = null;
    if (nexus.discard) {
      while (!discard) discard = await pickFromPile(by, "hand", check.discards, t("pick.nexus.discard"));
    }
    const passed = await ctx.dispatch({ t: "flip", uid: card.uid, face: nexus.face, ...(discard ? { discard: discard.uid } : {}), ...(nexus.recovery ? { recover: nexus.recovery } : {}) });
    if (!passed) return;
    const hp = ctx.state().players[by].hp;
    ctx.log(msg("log.flip", { seat: by, card: card.cardId, recover: nexus.recovery ? msg("log.flip.recover", { n: nexus.recovery, hp }) : "" }), by);
    if (discard) ctx.log(msg("log.flip.discard", { seat: by, card: discard.cardId }), by);
    const live = ctx.state().cards[card.uid];
    if (!live) return;
    const steps = flipSteps(ctx.state(), live, ctx.card);
    if (steps.length === 0) return;
    void showEnterEffect(root, {
      cardId: live.cardId,
      face: live.face,
      theme: ctx.themeFor(live.owner),
      locale: ctx.locale(),
      who: t("scene.flips", { name: seatLabel(ctx.state(), by), card: `«${cardName(live.cardId, ctx.locale())}»` }),
      effects: [],
      triggers: steps.map(step => describeFlipStep(step, ctx.card)),
      kicker: t("scene.flip"),
      onContinue: () => void playFlipSteps(steps),
    });
  }

  async function playFlipSteps(steps: FlipStep[]): Promise<void> {
    for (const step of steps) {
      const by = controllerOf(step.source);
      hold(true);
      light(step.source.uid, true);
      try {
        await wait(TRIGGER_LEAD_MS);
        if (step.form.kind === "move") {
          for (const target of flipSteps(ctx.state(), step.source, ctx.card).find(s => s.form === step.form)?.candidates ?? []) {
            strike(target.uid, FLY_MS);
            const fly = liftForFlight(target.uid, "abisso");
            const passed = await ctx.dispatch({ t: "toZone", uid: target.uid, zone: "abisso", effect: flipRef(step.source) });
            if (passed) {
              fly?.();
              ctx.log(msg("log.flip.absorb", { seat: by, sourceCard: step.source.cardId, card: target.cardId }), by);
              await wait(FLY_MS);
            } else {
              fly?.cancel();
            }
          }
        } else {
          const sealed = [...new Set([...(ctx.state().players[by].sealed ?? []), step.form.cardId])];
          const passed = await ctx.dispatch({ t: "player", seat: by, patch: { sealed }, effect: flipRef(step.source) });
          if (passed) ctx.log(msg("log.flip.seal", { seat: by, sourceCard: step.source.cardId, card: step.form.cardId }), by);
        }
        await wait(TRIGGER_TAIL_MS);
      } finally {
        light(step.source.uid, false);
        hold(false);
      }
    }
  }

  /**
   * Con l'arbitro al tavolo la lavagna non è più libera: ogni carta ha il
   * suo posto segnato (§5) e ci si incastra, o non si posa affatto. Le
   * Entità stanno sugli slot del Fronte — quello del rilascio se è libero,
   * altrimenti il primo libero; a Fronte pieno il gesto cade. Le Materie
   * vanno nella loro fila, dietro. Il Rubyfront ha due posti soli, la Zona
   * di Richiamo da cui parte e il suo davanti al Fronte, e ci arriva solo
   * agganciato — e una volta schierato non torna indietro (§3.1).
   * Gli Oggetti non passano di qui: il loro posto è addosso a un'Entità, e
   * lo decide il rilascio (vedi applyDrop). `null` = il gesto non si fa.
   */
  function boundSpot(card: CardInstance, drop: { x: number; y: number; snapped: boolean }): { x: number; y: number } | null {
    const state = ctx.state();
    const kind = faceKind(card.cardId, card.face);
    const front = frontRowY(card.owner);
    if (kind === "rubyfront" || kind === "nexus") {
      if (!drop.snapped) return null;
      const deployed = drop.x === RUBYFRONT_X && drop.y === front;
      // In Zona di Richiamo si sta solo se non si è ancora schierati.
      const recalled = drop.x === SLOT_X.richiamo && drop.y === backRowY(card.owner) && card.y !== front;
      return deployed || recalled ? { x: drop.x, y: drop.y } : null;
    }
    if (kind === "matter") return matterSpot(state, card.owner);
    if (kind !== "entity") return { x: drop.x, y: drop.y };
    const others = fieldCards(state).filter(other => other.uid !== card.uid && Math.abs(other.y - front) < 40);
    const busy = (x: number): boolean => others.some(other => Math.abs(other.x - x) < 40);
    if (drop.snapped && drop.y === front && FRONT_SLOT_X.includes(drop.x) && !busy(drop.x)) return { x: drop.x, y: front };
    const free = FRONT_SLOT_X.find(x => !busy(x));
    return free === undefined ? null : { x: free, y: front };
  }

  /**
   * Schiera il Rubyfront pagando (§3.1): «il costo non cresce mai, si paga
   * identico a ogni schieramento». Col dado si tira qui — il dado gira al
   * centro del tavolo, poi la carta scende — e si paga il risultato; il
   * tiro è permesso solo se il Flusso disponibile, Gettone compreso, copre
   * le facce del dado. Il costo e il tiro viaggiano nell'azione: l'arbitro
   * li verifica (il tiro nella forma, non nella fortuna), il riduttore
   * scala. Fermato, il Rubyfront torna da dove era.
   */
  async function deploy(
    card: CardInstance,
    x: number,
    y: number,
    z: number,
    deployment: Deployment,
    origin: { x: number; y: number; z: number } | null
  ): Promise<void> {
    const giveBack = (): void => {
      if (origin) void ctx.dispatch({ t: "move", uid: card.uid, x: origin.x, y: origin.y, z: origin.z });
    };
    const player = ctx.state().players[card.owner];
    const available = player.flux + (player.token ? 1 : 0);
    let cost: number;
    let roll: number | undefined;
    if (deployment.die) {
      if (available < deployment.die) {
        ctx.log(msg("log.deploy.nodie", { seat: card.owner, die: deployment.die ?? 0, available }), card.owner);
        giveBack();
        return;
      }
      roll = 1 + Math.floor(Math.random() * deployment.die);
      cost = roll;
      await showRoll(root, deployment.die, roll, t("dice.deploy"));
    } else {
      cost = deployment.fixed ?? 0;
    }
    const passed = await ctx.dispatch({ t: "move", uid: card.uid, x, y, z, cost, ...(roll !== undefined ? { roll } : {}) });
    if (!passed) {
      giveBack();
      return;
    }
    const after = ctx.state().players[card.owner];
    const token = after.token ? msg("log.token.plus") : "";
    ctx.log(
      roll !== undefined
        ? msg("log.deploy.roll", { seat: card.owner, die: deployment.die ?? 0, roll, cost, flux: after.flux, max: after.fluxMax, token })
        : msg("log.deploy", { seat: card.owner, cost, flux: after.flux, max: after.fluxMax, token }),
      card.owner
    );
  }

  /**
   * Con l'arbitro al tavolo, una carta in mano che costa più del Flusso
   * disponibile — barra più Gettone (§3.2) — non si gioca: si vela, e il
   * doppio click non la gioca; si trascina però, perché scartarla non
   * costa. È un aiuto, non una regola: la regola è dell'engine (§3.2, il
   * costo delle carte), che fermerebbe comunque il gesto. Il Rubyfront ha il
   * costo di schieramento, un'altra cosa; costo ignoto, carta libera.
   */
  function unaffordable(card: CardInstance): boolean {
    if (!ctx.arbitrated() || card.zone !== "hand" || !ctx.controls(card.owner) || isRubyfront(card.cardId)) return false;
    const stats = cardStats(card.cardId);
    let cost = stats.fluxCost;
    if (cost === null) return false;
    const off = abilityDiscount(ctx.state(), card.owner, stats);
    if (off) cost = Math.max(1, cost - off.amount);
    const player = ctx.state().players[card.owner];
    return cost > player.flux + (player.token ? 1 : 0);
  }

  /** Il tempo in cui la fonte resta accesa prima che l'effetto agisca. */
  const TRIGGER_LEAD_MS = 650;
  /** Dopo una scelta e una conferma la fonte è già accesa da un pezzo: il
      volo parte quasi subito, o sembra un caricamento. */
  const CONFIRMED_LEAD_MS = 200;
  /** E quanto resta accesa dopo che l'effetto ha agito. */
  const TRIGGER_TAIL_MS = 350;

  /** Accende o spegne una carta che si innesca (§8.2). */
  function light(uid: string, on: boolean): void {
    tiles.get(uid)?.classList.toggle("is-triggering", on);
  }

  /** Mentre un effetto agisce il tavolo è fermo: niente click su campo,
      mani e HUD finché la fonte non si spegne (body.is-resolving). */
  function hold(on: boolean): void {
    document.body.classList.toggle("is-resolving", on);
  }

  /** Il bagliore per un effetto arrivato dalla rete: la pesca è già
      avvenuta, la fonte si accende e si spegne col ritmo di chi ha giocato. */
  function flash(uid: string, ms: number = TRIGGER_LEAD_MS + TRIGGER_TAIL_MS): void {
    light(uid, true);
    hold(true);
    window.setTimeout(() => {
      light(uid, false);
      hold(false);
    }, ms);
  }

  const wait = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));

  /** Quanto dura il volo di una carta verso una pila (come .fly-ghost). */
  const FLY_MS = 1600;
  /** …e verso il pannello ripiegato delle pile avversarie: un guizzo, non un volo. */
  const DOCK_FLY_MS = 400;

  /**
   * La carta vola verso una pila: un fantasma della tessera, preso PRIMA che
   * lo stato cambi (la tessera vera sparirà nella pila), che scivola fino
   * al riquadro della pila del proprietario e svanisce. Chi la chiama la
   * prende prima dell'azione e la lascia partire dopo. FLY_MS è lo stesso
   * tempo della transizione di .fly-ghost in style.css.
   */
  function liftForFlight(uid: string, zone: "ritiro" | "abisso" = "ritiro"): Flight | null {
    const tile = tiles.get(uid);
    const live = ctx.state().cards[uid];
    if (!tile || !live || tile.offsetParent === null) return null;
    const from = tile.getBoundingClientRect();
    // La tessera vive dentro la lavagna, che è disegnata in scala: il
    // fantasma sta fuori, in misura di layout, e si scala con la stessa
    // trasformazione — sennò mostrerebbe la carta a misura piena, tagliata.
    const layoutW = tile.offsetWidth;
    const layoutH = tile.offsetHeight;
    const ghost = tile.cloneNode(true) as HTMLElement;
    ghost.classList.add("fly-ghost");
    ghost.classList.remove("is-pickable", "is-legal", "is-triggering", "is-struck");
    ghost.style.position = "fixed";
    ghost.style.left = `${from.left}px`;
    ghost.style.top = `${from.top}px`;
    ghost.style.width = `${layoutW}px`;
    ghost.style.height = `${layoutH}px`;
    ghost.style.margin = "0";
    ghost.style.transform = `scale(${from.width / layoutW})`;
    document.body.append(ghost);
    const flight = (() => {
      const slot = pileSlots.get(`${live.owner}:${zone}`);
      let to = slot?.getBoundingClientRect();
      // In rincasso le pile avversarie stanno nel pannello: ripiegato, il
      // riquadro non si vede (la fila si chiude in ALTEZZA: la larghezza
      // resta, quindi non basta misurarla) e il fantasma restava a
      // rimpicciolirsi nel vuoto per un secondo e mezzo, con un velo
      // residuo. Si vola alla TESTATA del pannello (i conti), in fretta,
      // e si svanisce del tutto.
      const docked =
        !!to && pileDock !== null && (pileDock.classList.contains("is-collapsed") && pileDock.contains(slot!) || to.width < 4 || to.height < 4);
      if (docked) to = pileDock!.querySelector<HTMLElement>(".pile-dock-head")?.getBoundingClientRect() ?? undefined;
      if (!to) {
        ghost.remove();
        return;
      }
      const target = to;
      if (docked) ghost.style.transitionDuration = `${DOCK_FLY_MS}ms`;
      // Un frame dopo, così la transizione parte dalla posizione di ora.
      requestAnimationFrame(() => {
        const scale = docked ? 0.25 : target.width / layoutW;
        const dx = docked ? target.left + target.width / 2 - from.left - (layoutW * scale) / 2 : target.left - from.left;
        const dy = docked ? target.top + target.height / 2 - from.top - (layoutH * scale) / 2 : target.top - from.top;
        ghost.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
        ghost.style.opacity = docked ? "0" : "0.15";
      });
      window.setTimeout(() => ghost.remove(), (docked ? DOCK_FLY_MS : FLY_MS) + 60);
    }) as Flight;
    // Il «no» dell'arbitro: la carta non parte, e il fantasma — che è
    // già sul tavolo, sopra la tessera vera — deve sparire, o resta lì
    // come un doppione della carta.
    flight.cancel = () => ghost.remove();
    return flight;
  }

  /**
   * Il volo da una pila al campo: il fantasma parte dal riquadro della
   * pila e arriva dove la tessera vera è comparsa (dopo il disegno).
   */
  function flyFromPile(seat: Seat, zone: ZoneId, uid: string): void {
    const slot = pileSlots.get(`${seat}:${zone}`);
    const tile = tiles.get(uid);
    if (!slot || !tile) return;
    let from = slot.getBoundingClientRect();
    // Pila avversaria nel pannello ripiegato (rincasso): si parte dalla
    // sua testata, che sullo schermo c'è.
    if (from.width < 4 && pileDock) from = pileDock.querySelector<HTMLElement>(".pile-dock-head")?.getBoundingClientRect() ?? from;
    if (from.width < 4) return;
    const to = tile.getBoundingClientRect();
    // Come in liftForFlight: misura di layout, scala della lavagna.
    const layoutW = tile.offsetWidth;
    const layoutH = tile.offsetHeight;
    const ghost = tile.cloneNode(true) as HTMLElement;
    ghost.classList.add("fly-ghost");
    ghost.classList.remove("is-pickable", "is-legal", "is-triggering", "is-struck");
    ghost.style.position = "fixed";
    ghost.style.left = `${to.left}px`;
    ghost.style.top = `${to.top}px`;
    ghost.style.width = `${layoutW}px`;
    ghost.style.height = `${layoutH}px`;
    ghost.style.margin = "0";
    ghost.style.transition = "none";
    ghost.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / layoutW})`;
    ghost.style.opacity = "0.4";
    document.body.append(ghost);
    // La tessera vera si nasconde finché il fantasma non è arrivato.
    tile.style.visibility = "hidden";
    requestAnimationFrame(() => {
      ghost.style.transition = "";
      ghost.style.transform = `scale(${to.width / layoutW})`;
      ghost.style.opacity = "1";
    });
    window.setTimeout(() => {
      ghost.remove();
      tile.style.visibility = "";
    }, FLY_MS + 60);
  }

  async function playReturn(step: EnterReturnStep): Promise<void> {
    const who = `«${cardName(step.source.cardId, ctx.locale())}»`;
    // §6.2, Fronte pieno: «anche la parte d'effetto che metterebbe in campo
    // non si applica». Il giocatore lo deve sapere: un pannello vuoto, o il
    // silenzio, sembrerebbero un difetto del tavolo.
    if (step.candidates.length === 0 && step.frontFull) {
      ctx.log(msg("log.front.full", { seat: step.source.owner, card: step.source.cardId }), step.source.owner);
      await noticeEffect(root, t("notice.front.full", { card: who }));
      return;
    }
    if (step.candidates.length === 0) {
      ctx.log(msg("log.no.permanent", { seat: step.source.owner, card: step.source.cardId }), step.source.owner);
      return;
    }
    light(step.source.uid, true);
    const card = await pickFromPile(step.source.owner, step.from, step.candidates, t("pick.return"));
    if (!card) {
      light(step.source.uid, false);
      return;
    }
    const sure = await confirmFor(controllerOf(step.source), t("confirm.return", { card: `«${ctx.card(card.cardId).name}»` }));
    if (!sure) {
      light(step.source.uid, false);
      return;
    }
    hold(true);
    try {
      await wait(CONFIRMED_LEAD_MS);
      const passed = await resolveReturn(ctx, step, card);
      if (passed) {
        flyFromPile(card.owner, step.from, card.uid);
        // La fonte si spegne appena la Materia è arrivata: il volo è
        // l'effetto, non c'è altro da aspettare.
        await wait(FLY_MS);
      }
    } finally {
      light(step.source.uid, false);
      hold(false);
    }
  }

  /**
   * Il volo di una tessera da dove sta a dove starà: si prende il suo
   * rettangolo PRIMA dell'azione, e dopo il disegno il fantasma scivola
   * fino al nuovo posto. Per il controllo e la restituzione (§8.2).
   */
  function liftToFlight(uid: string): (() => void) | null {
    const tile = tiles.get(uid);
    if (!tile || tile.offsetParent === null) return null;
    const from = tile.getBoundingClientRect();
    const layoutW = tile.offsetWidth;
    const layoutH = tile.offsetHeight;
    return () => {
      const landed = tiles.get(uid);
      if (!landed || landed.offsetParent === null) return;
      const to = landed.getBoundingClientRect();
      const ghost = landed.cloneNode(true) as HTMLElement;
      ghost.classList.add("fly-ghost");
      ghost.classList.remove("is-pickable", "is-legal", "is-triggering", "is-struck");
      ghost.style.position = "fixed";
      ghost.style.left = `${to.left}px`;
      ghost.style.top = `${to.top}px`;
      ghost.style.width = `${layoutW}px`;
      ghost.style.height = `${layoutH}px`;
      ghost.style.margin = "0";
      ghost.style.visibility = "";
      ghost.style.transition = "none";
      ghost.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / layoutW})`;
      document.body.append(ghost);
      landed.style.visibility = "hidden";
      requestAnimationFrame(() => {
        ghost.style.transition = "";
        ghost.style.transform = `scale(${to.width / layoutW})`;
      });
      window.setTimeout(() => {
        ghost.remove();
        landed.style.visibility = "";
      }, FLY_MS + 60);
    };
  }

  async function playControl(step: EnterControlStep): Promise<void> {
    const by = controllerOf(step.source);
    if (step.candidates.length === 0) {
      ctx.log(msg("log.no.control", { seat: by, card: step.source.cardId }), by);
      return;
    }
    light(step.source.uid, true);
    const target = await pickTarget(step.source, step.candidates, t("target.control"));
    if (!target) {
      light(step.source.uid, false);
      return;
    }
    strike(target.uid, 60_000);
    const sure = await confirmFor(by, t("confirm.control", { card: `«${ctx.card(target.cardId).name}»` }));
    if (!sure) {
      strike(target.uid, 0);
      light(step.source.uid, false);
      render();
      return;
    }
    hold(true);
    let passed = false;
    try {
      await wait(CONFIRMED_LEAD_MS);
      const fly = liftToFlight(target.uid);
      passed = await resolveControl(ctx, step, target);
      strike(target.uid, 0);
      if (passed) {
        fly?.();
        await wait(FLY_MS);
      } else {
        render();
      }
    } finally {
      light(step.source.uid, false);
      hold(false);
    }
    // §8.2 — il controllo non è un ingresso: la carta è già entrata in
    // campo, cambia solo chi la comanda. I suoi effetti «quando entra» NON
    // si riapplicano (decisione del designer, 2026-09-07); quelli «quando
    // attacca» valgono per chi la comanda, e passano dalla via normale.
  }

  /**
   * La stappata di chi entra (§8.2, RBF-011): la fonte si accende, il dado
   * gira al centro, e l'esito — stappata o niente — va all'engine in
   * un'azione sola.
   */
  async function playRefresh(step: EnterRefreshStep): Promise<void> {
    const name = ctx.card(step.source.cardId).name;
    light(step.source.uid, true);
    hold(true);
    try {
      const roll = rollDie(step.refresh.die);
      await showRoll(root, step.refresh.die, roll, t("dice.step", { name, what: t("dice.rally", { lo: step.refresh.onRoll[0], hi: step.refresh.onRoll[1] }) }));
      const passed = await resolveRefresh(ctx, step, roll);
      await wait(passed ? TRIGGER_TAIL_MS : 0);
    } finally {
      light(step.source.uid, false);
      hold(false);
    }
  }

  /**
   * L'abilità speciale del Rubyfront (§3.1): la Furia tira il d20 al
   * centro (§8.1), il potenziamento sceglie i bersagli PRIMA di pagare (chi
   * rinuncia non paga), poi l'azione — PV, tiro, esito, bersagli o sconto —
   * va all'engine in un colpo solo; lo sguardo nel mazzo si risolve dopo,
   * con la stessa vetrina degli ingressi, marcato `on_ability`.
   */
  async function useAbility(card: CardInstance, ability: Ability): Promise<void> {
    const by = controllerOf(card);
    const copy = abilityCopy(card.cardId, ability.face, ability.displayKey, ctx.locale());
    const price = ability.cost !== null ? t("ability.cost", { n: ability.cost }) : t("ability.gain", { n: ability.gain ?? 0 });
    const form = ability.form;
    if (!form) return;
    let targets: string[] | null = null;
    if (form.kind === "power") {
      const candidates = fieldCards(ctx.state()).filter(other => {
        if (controllerOf(other) !== by) return false;
        const facts = ctx.card(other.cardId);
        if (facts.kind !== "entity") return false;
        if (form.race !== null && facts.race !== form.race) return false;
        if (form.attacking && declarationOf(ctx.state(), other.uid)?.kind !== "attack") return false;
        if (form.armed && wornBy(ctx.state(), other.uid).length === 0) return false;
        return true;
      });
      if (form.targets === "one") {
        if (candidates.length === 0) {
          const go = await confirmFor(by, t("confirm.ability.notargets", { name: copy.name, price }));
          if (!go) return;
          targets = [];
        } else {
          light(card.uid, true);
          const chosen = await pickTarget(card, candidates, t("target.ability.power", { n: form.amount }));
          light(card.uid, false);
          if (!chosen) return;
          targets = [chosen.uid];
        }
      } else {
        if (candidates.length === 0) {
          const go = await confirmFor(by, t("confirm.ability.notargets", { name: copy.name, price }));
          if (!go) return;
        }
        targets = candidates.map(other => other.uid);
      }
    }
    // §8.1 — la Furia: il d20 al centro, prima dell'abilità.
    let roll: number | null = null;
    let fail = false;
    if (ability.fury) {
      const threshold = ctx.card(card.cardId).furyAt[card.face] ?? 12;
      roll = 1 + Math.floor(Math.random() * 20);
      await showRoll(root, 20, roll, t("dice.fury", { name: copy.name, n: threshold }));
      fail = roll < threshold;
    }
    const discount: Discount | null = form.kind === "discount" ? { amount: form.amount, type: form.type, race: form.race } : null;
    light(card.uid, true);
    hold(true);
    let passed = false;
    try {
      passed = await ctx.dispatch({
        t: "ability",
        uid: card.uid,
        ability: ability.id,
        ...(ability.cost !== null ? { cost: ability.cost } : {}),
        ...(ability.gain !== null ? { gain: ability.gain } : {}),
        ...(roll !== null ? { roll } : {}),
        ...(fail ? { fail: true as const } : {}),
        ...(targets !== null ? { targets, power: form.kind === "power" ? form.amount : 0 } : {}),
        ...(discount ? { discount } : {}),
      });
      if (passed) {
        if (roll !== null) ctx.log(msg("log.ability.fury", { seat: by, roll, outcome: msg(fail ? "fury.fail" : "fury.ok") }), by);
        ctx.log(msg("log.ability", { seat: by, name: copy.name, price, hp: ctx.state().players[by].hp }), by);
        if (form.kind === "power" && targets && targets.length) {
          ctx.log(msg("log.ability.power", { seat: by, n: form.amount, cards: targets.map(uid => cardName(ctx.state().cards[uid]?.cardId ?? uid, ctx.locale())).join(", ") }), by);
          for (const uid of targets) strike(uid, 900);
        }
        if (discount) {
          const what = msg(discount.type === "object" ? "what.object" : discount.race === "human" ? "what.entity.human" : "what.entity");
          ctx.log(msg("log.ability.discount", { seat: by, what, n: discount.amount }), by);
        }
        await wait(TRIGGER_TAIL_MS);
      }
    } finally {
      light(card.uid, false);
      hold(false);
    }
    if (!passed || form.kind !== "look") {
      render();
      return;
    }
    // Lo sguardo nel mazzo: le prime N, con la vetrina degli ingressi.
    const live = ctx.state().cards[card.uid];
    if (!live) return;
    const step = lookAfterRoll(ctx.state(), live, { count: form.count, die: null, countBase: 0, reveal: form.reveal, thenRetire: false }, null, ctx.card);
    await playLook(step, { source: live.uid, event: "on_ability", entering: live.uid, ability: ability.id });
  }

  async function playLook(first: EnterLookStep, ref: EffectRef | null = null): Promise<void> {
    const by = controllerOf(first.source);
    const name = ctx.card(first.source.cardId).name;
    light(first.source.uid, true);
    // Col dado (RBF-027): si tira, il dado gira al centro, e il conto delle
    // carte discende dal tiro.
    let step = first;
    if (first.look.die !== null) {
      const roll = 1 + Math.floor(Math.random() * first.look.die);
      await showRoll(root, first.look.die, roll, t("dice.look", { name }));
      step = lookAfterRoll(ctx.state(), first.source, first.look, roll, ctx.card);
    }
    if (step.looked.length === 0) {
      ctx.log(msg("log.look.empty", { seat: by, card: first.source.cardId }), by);
      light(first.source.uid, false);
      return;
    }
    const what = t(step.look.reveal?.kind === "object" ? "pick.look.object" : "pick.look.one");
    const title = step.candidates.length
      ? t("pick.look.some", { n: step.looked.length, what })
      : t("pick.look.none", { n: step.looked.length });
    const reveal = await pickFromPile(by, "deck", step.candidates, title, step.looked);
    // «Metti una delle altre nella tua Zona di Ritiro»: obbligatoria, se
    // restano carte — la finestra torna finché non si sceglie.
    let retire: CardInstance | null = null;
    if (step.look.thenRetire) {
      const others = step.looked.filter(card => card.uid !== reveal?.uid);
      while (others.length && !retire) {
        retire = await pickFromPile(by, "deck", others, t("pick.retire"), others);
      }
    }
    hold(true);
    try {
      await wait(CONFIRMED_LEAD_MS);
      const passed = await resolveLook(ctx, step, reveal, retire, ref);
      await wait(passed ? TRIGGER_TAIL_MS : 0);
    } finally {
      light(first.source.uid, false);
      hold(false);
    }
  }

  async function playMove(step: EnterMoveStep): Promise<void> {
    if (step.candidates.length === 0) {
      ctx.log(msg("log.no.target", { seat: step.source.owner, card: step.source.cardId }), step.source.owner);
      return;
    }
    light(step.source.uid, true);
    const target = await pickTarget(step.source, step.candidates, t(step.hold ? "target.loose" : "target.retire"));
    if (!target) {
      light(step.source.uid, false);
      return;
    }
    // Scelto il bersaglio, si chiede conferma — con la carta accesa.
    strike(target.uid, 60_000);
    const sure = await confirmFor(controllerOf(step.source), t(step.hold ? "confirm.loose" : "confirm.retire", { card: `«${ctx.card(target.cardId).name}»` }));
    if (!sure) {
      strike(target.uid, 0);
      light(step.source.uid, false);
      render();
      return;
    }
    hold(true);
    try {
      await wait(CONFIRMED_LEAD_MS);
      const fly = liftForFlight(target.uid, step.to);
      const passed = await resolveMove(ctx, step, target);
      strike(target.uid, 0);
      if (passed) {
        fly?.();
        await wait(FLY_MS + TRIGGER_TAIL_MS);
      } else {
        fly?.cancel();
        render();
      }
    } finally {
      light(step.source.uid, false);
      hold(false);
    }
  }

  /**
   * Il ritmo di un innesco: la fonte si accende e resta accesa; mentre è
   * accesa l'effetto agisce (la carta entra in mano); 350ms dopo si spegne.
   * Un innesco alla volta.
   */
  async function playTriggers(entering: CardInstance): Promise<void> {
    // Prima gli effetti di chi entra (§8.2, la forma di RBF-007): si mira,
    // poi la fonte si accende, la freccia va al bersaglio, la carta parte.
    for (const step of enterMoves(ctx.state(), entering, ctx.card)) {
      await playMove(step);
    }
    for (const step of enterReturns(ctx.state(), entering, ctx.card)) {
      await playReturn(step);
    }
    for (const step of enterLooks(ctx.state(), entering, ctx.card)) {
      await playLook(step);
    }
    for (const step of enterControls(ctx.state(), entering, ctx.card)) {
      await playControl(step);
    }
    for (const step of enterRefreshes(entering, ctx.card)) {
      await playRefresh(step);
    }
    hold(true);
    try {
      for (const trigger of enterTriggers(ctx.state(), entering, ctx.card)) {
        light(trigger.source.uid, true);
        await wait(TRIGGER_LEAD_MS);
        const passed = await resolveTrigger(ctx, entering, trigger);
        await wait(passed ? TRIGGER_TAIL_MS : 0);
        light(trigger.source.uid, false);
      }
    } finally {
      hold(false);
    }
  }

  function applyDrop(card: CardInstance, drop: Drop): void {
    lastDropAt = Date.now();
    segnaAssegnazione(null);
    if (!drop) return;
    if (drop.kind === "field") {
      // Il rilascio a mano libera arriva in coordinate di schermo: va riportato
      // in canoniche prima di finire nello stato, o al posto B ogni carta
      // comparirebbe nella metà sbagliata. L'aggancio no: i riquadri portano
      // già con sé la coordinata canonica.
      const free = unspot(drop.x, drop.y);
      // Le Materie non si giocano sugli slot del Fronte (§5): il divieto è
      // dell'ARBITRO, non del tavolo — il rilascio parte com'è e, con
      // l'engine collegato, torna indietro col sigillo. A engine spento,
      // lavagna libera come sempre.
      let spot = drop.snapped ? stackAt(ctx.state(), drop.x, drop.y, card.uid) : free;
      // Arbitro al tavolo: il posto lo decide la lavagna, non il dito. Un
      // gesto senza posto (Fronte pieno, Rubyfront fuori dai suoi due
      // riquadri) non si fa: la carta torna da dove era partita.
      const bound = ctx.arbitrated() ? boundSpot(card, { ...free, ...(drop.snapped ? { x: drop.x, y: drop.y } : {}), snapped: drop.snapped }) : undefined;
      const origin = dragOrigin;
      const giveBack = (): void => {
        // Con l'arbitro i pixel non hanno viaggiato: la carta è già dov'era,
        // e un «torna indietro» sarebbe uno spostamento vero — che la dogana
        // degli slot (§5) fermerebbe con un secondo sigillo. Basta ridisegnare.
        const live = ctx.state().cards[card.uid];
        if (origin && live && (live.x !== origin.x || live.y !== origin.y)) {
          void ctx.dispatch({ t: "move", uid: card.uid, x: origin.x, y: origin.y, z: origin.z });
        } else {
          render();
        }
      };
      if (bound === null) {
        giveBack();
        return;
      }
      if (bound) spot = bound;
      let x = Math.max(0, Math.min(SURFACE_W - TILE_W, spot.x));
      let y = Math.max(0, Math.min(SURFACE_H - TILE_H, spot.y));
      // Lo schieramento del Rubyfront (§3.1): dalla Zona di Richiamo alla
      // sua fila si paga il costo stampato — fisso, o un dado tirato qui.
      if (isRubyfront(card.cardId) && card.zone === "field") {
        const front = frontRowY(card.owner);
        const deployment = cardStats(card.cardId).deployment;
        if (deployment && card.y !== front && y === front) {
          void deploy(card, x, y, dropZ(card, x, y), deployment, origin);
          return;
        }
      }
      // Un Oggetto posato su un'Entità non resta dove l'ha lasciato il dito:
      // si accomoda da solo dietro di lei, a scaletta — in linea con la sua
      // portatrice, un gradino per ogni Oggetto già addosso.
      const under = entityUnder(card, x, y);
      // Con l'arbitro un Oggetto ha un posto solo: addosso a un'Entità (§3.1).
      if (ctx.arbitrated() && faceKind(card.cardId, card.face) === "object" && !under) {
        giveBack();
        return;
      }
      if (under) {
        const worn = Object.values(ctx.state().cards)
          .filter(other => other.assignedTo === under.uid && other.uid !== card.uid).length;
        const step = STACK_STEP * (worn + 1);
        x = Math.max(0, Math.min(SURFACE_W - TILE_W, under.x + step));
        y = Math.max(0, Math.min(SURFACE_H - TILE_H, under.y + step));
      }
      const z = dropZ(card, x, y);
      // L'assegnazione è un fatto di gioco, non di pixel: il rilascio sopra
      // un'Entità la dichiara (azione `assign`, §3.1), il rilascio sul vuoto
      // la scioglie. E l'ORDINE conta: se il rilascio è una RIASSEGNAZIONE
      // (l'Oggetto era già addosso a qualcun altro), prima si chiede il
      // permesso e solo col sì si muovono i pixel — sennò il sigillo dice
      // «non si sposta» ma la carta intanto si è spostata.
      const current = ctx.state().cards[card.uid]?.assignedTo;
      void (async () => {
        if (under && under.uid !== current) {
          if (!(await ctx.dispatch({ t: "assign", uid: card.uid, to: under.uid }))) {
            // Fermata: i pixel del trascinamento in diretta hanno già
            // viaggiato — la carta torna da dove era partita.
            if (origin) void ctx.dispatch({ t: "move", uid: card.uid, x: origin.x, y: origin.y, z: origin.z });
            return;
          }
          if (!(await place(card, x, y, z))) {
            // L'assegnazione era passata ma il gioco no (Flusso): si scioglie,
            // e la carta torna da dove era partita.
            void ctx.dispatch({ t: "assign", uid: card.uid, to: null });
            if (origin) void ctx.dispatch({ t: "move", uid: card.uid, x: origin.x, y: origin.y, z: origin.z });
            return;
          }
          ctx.log(msg("log.assign", { seat: card.owner, card: card.cardId, toCard: under.cardId }), card.owner);
          return;
        }
        void place(card, x, y, z);
        if (!under && current) void ctx.dispatch({ t: "assign", uid: card.uid, to: null });
      })();
      return;
    }
    // Le pile e la mano sono di chi le possiede: una carta non cambia
    // proprietario trascinandola nella metà avversaria.
    if (drop.seat !== card.owner) {
      ctx.log(msg("log.keep.owner", { seat: card.owner }), card.owner);
      return;
    }
    // Fermata dall'arbitro (es. §5: dal campo non si torna in mano): i pixel
    // del trascinamento possono aver mosso la carta — torna da dove era.
    const origin = dragOrigin;
    const discarding = drop.zone === "abisso" && canDiscard(card);
    void ctx.dispatch({ t: "toZone", uid: card.uid, zone: drop.zone }).then(passed => {
      if (!passed && origin) void ctx.dispatch({ t: "move", uid: card.uid, x: origin.x, y: origin.y, z: origin.z });
      if (passed && discarding) {
        clearDiscardPrompt(card.owner);
        ctx.log(msg("log.discard", { seat: card.owner, card: card.cardId, n: zoneCards(ctx.state(), card.owner, "hand").length }), card.owner);
        render();
      }
    });
  }

  // -------------------------------------------------------------- disegno

  function tileFor(card: CardInstance, back: boolean, tess = isCompactView()): HTMLElement {
    let tile = tiles.get(card.uid);
    if (!tile) {
      tile = createCardEl(card.uid);
      tiles.set(card.uid, tile);
      wirePreview(tile, ctx.locale);
      enableDrag(tile, {
        canDrag: () => {
          if (targeting) return false;
          const live = ctx.state().cards[card.uid];
          if (!live) return false;
          // La mano avversaria è nascosta (§5): non si tocca — salvo in
          // partita locale, dove anche quella mano è di chi guida il tavolo.
          // La carta che non ci si può permettere si prende lo stesso: sul
          // campo la ferma l'arbitro (§3.2), ma scartarla nell'Abisso o
          // rimetterla nel mazzo non costa nulla.
          return !(live.zone === "hand" && (!ctx.controls(live.owner) || handLocked(live.owner)));
        },
        onDragMove: drop => {
          const live = ctx.state().cards[card.uid];
          if (!live) return;
          // Il segno sull'Entità sotto il dito vale anche per l'Oggetto che
          // arriva DALLA MANO, e anche con l'arbitro, che ferma i pixel ma
          // non il gesto: va calcolato prima delle uscite qui sotto.
          const at = drop.snapped ? { x: drop.x, y: drop.y } : unspot(drop.x, drop.y);
          segnaAssegnazione(entityUnder(live, at.x, at.y)?.uid ?? null);
          if (live.zone !== "field") return;
          // Con l'arbitro al tavolo i pixel non viaggiano in diretta: ogni
          // passo sarebbe un `move` fuori slot, e l'arbitro lo fermerebbe
          // (§5). Il fantasma segue comunque il dito; l'avversario vede la
          // carta al rilascio, quando ha un posto.
          if (ctx.arbitrated()) return;
          dragging = card.uid;
          // Sopra un riquadro le coordinate sono già canoniche; a mano libera
          // arrivano dallo schermo e vanno riportate indietro.
          ctx.dispatch({ t: "move", uid: card.uid, x: at.x, y: at.y, z: Math.max(live.z, ctx.state().zTop) });
        },
        onStart: () => {
          // Il suono del prendere parte col trascinamento vero, non a ogni
          // pressione: il doppio click che tappa ha il suo suono (cueFor).
          playSound("select");
          segnaAssegnazione(null);
          const live = ctx.state().cards[card.uid];
          // La posizione di partenza serve al ripensamento (vedi applyDrop).
          dragOrigin = live && live.zone === "field" ? { x: live.x, y: live.y, z: live.z } : null;
          // Una carta presa DALLA MANO vuole essere posata sul tavolo, e il
          // cassetto aperto lo coprirebbe: si ripiega da solo, e al rilascio
          // torna com'era.
          if (!live || live.zone !== "hand" || live.owner !== ctx.seat()) return;
          if (!myHand.classList.contains("is-collapsed")) {
            handWasOpen = true;
            setHandCollapsed(true);
          }
        },
        onDrop: drop => {
          dragging = null;
          const live = ctx.state().cards[card.uid];
          if (live) applyDrop(live, drop);
          if (handWasOpen) {
            handWasOpen = false;
            setHandCollapsed(false);
          }
          render();
        },
        onContext: event => {
          // La pressione lunga è il tasto destro del dito: stesso menu.
          if (targeting) {
            cancelTargeting();
            return;
          }
          const live = ctx.state().cards[card.uid];
          if (live && !(live.zone === "hand" && handLocked(live.owner))) openMenu(event.clientX, event.clientY, cardMenu(live));
        },
        onTap: up => {
          // Su touch non c'è hover: è il tap a chiedere l'ingrandimento (e a
          // richiuderlo, sulla stessa carta). In targeting il tap sceglie il
          // bloccante e l'ingrandimento non deve mettersi in mezzo.
          if (up.pointerType !== "touch" || targeting) return;
          const live = ctx.state().cards[card.uid];
          const element = tiles.get(card.uid);
          if (!live || !element || element.classList.contains("is-back")) return;
          tapPreview(element, live.cardId, live.face, ctx.themeFor(live.owner), ctx.locale());
        },
      });
      tile.addEventListener("click", () => {
        if (!targeting) return;
        const live = ctx.state().cards[card.uid];
        if (!live || live.zone !== "field" || !pickable(live)) return;
        if (targeting.mode === "effect") targeting.pick(live);
        else confirmBlock(live);
      });
      tile.addEventListener("contextmenu", event => {
        event.preventDefault();
        if (targeting) {
          cancelTargeting();
          return;
        }
        const live = ctx.state().cards[card.uid];
        if (live && !(live.zone === "hand" && handLocked(live.owner))) openMenu(event.clientX, event.clientY, cardMenu(live));
      });
      tile.addEventListener("dblclick", () => {
        const live = ctx.state().cards[card.uid];
        if (!live) return;
        if (live.zone === "field") {
          // Stesso discorso del menu: con l'arbitro al tavolo il tap non è
          // un gesto libero, e il doppio click non lo aggira.
          if (ctx.arbitrated()) return;
          ctx.dispatch({ t: "tap", uid: live.uid, tapped: !live.tapped });
        } else if (live.zone === "hand" && ctx.controls(live.owner)) {
          if (unaffordable(live) || handLocked(live.owner)) return;
          // Il doppio click gioca: Entità sul primo slot libero del Fronte,
          // Materie nella loro fila (§5) — mai sugli slot.
          const spot = playSpot(ctx.state(), live.owner, faceKind(live.cardId, live.face));
          void place(live, spot.x, spot.y, ctx.state().zTop + 1);
        }
      });
    }
    // In rincasso la carta intera SUL CAMPO porta i distintivi della tessera
    // (costo, Potenza o PV, parole chiave) a corpo fisso: la carta a un
    // terzo non si legge, i distintivi sì. Non in mano (scelta del
    // designer: lì la carta è più grande e si legge al passaggio), non
    // nelle pile aperte (overlay.ts), a scala piena.
    syncCardEl(tile, card, {
      back,
      theme: ctx.themeFor(card.owner),
      locale: ctx.locale(),
      tess,
      // (I PV del giocatore stanno nel medaglione della targa, hud.ts.)
      badges: card.zone === "field" && isRecessView(),
    });
    return tile;
  }

  /** Rettangolo di una carta in coordinate della superficie. */
  function boxOf(card: CardInstance): Arrow["from"] {
    const chainIndex = ctx.state().chain?.stack.indexOf(card.uid) ?? -1;
    if (chainIndex >= 0) return { ...chainSpot(chainIndex), w: TILE_W, h: tileViewH() };
    const spot = spotOf(card.x, card.y);
    return { x: spot.x, y: spot.y, w: TILE_W, h: tileViewH() };
  }

  function paintArrows(): void {
    const state = ctx.state();
    const arrows: Arrow[] = [];
    for (const declaration of state.declarations) {
      // L'attacco non ha freccia: si attacca sempre il Rubyfront avversario
      // (§6.3), quindi tutte punterebbero là e non direbbero niente che il
      // bersaglio non dica già. L'attaccante si illumina, e basta.
      if (declaration.kind === "attack") continue;
      const from = state.cards[declaration.from];
      const to = state.cards[declaration.to];
      if (!from || !to || from.zone !== "field" || to.zone !== "field") continue;
      arrows.push({ kind: declaration.kind, from: boxOf(from), to: boxOf(to) });
    }
    if (targeting?.pointer) {
      if (targeting.mode === "block") {
        const attacker = state.cards[targeting.attacker];
        // La freccia in volo parte dal puntatore e punta all'attaccante: si
        // sta scegliendo chi lo ferma, non dove mandarlo.
        if (attacker) {
          arrows.push({ kind: targeting.kind, from: { ...targeting.pointer, w: 0, h: 0 }, to: boxOf(attacker), pending: true });
        }
      } else {
        // Un effetto invece mira: dalla fonte al dito.
        const source = state.cards[targeting.source];
        if (source) arrows.push({ kind: "effect", from: boxOf(source), to: { ...targeting.pointer, w: 0, h: 0 }, pending: true });
      }
    }
    const now = Date.now();
    transientArrows = transientArrows.filter(entry => entry.until > now);
    for (const entry of transientArrows) arrows.push(entry.arrow);
    drawArrows(arrowLayer, arrows);
  }

  /**
   * I segni che valgono solo in campo: combattimento — col distintivo
   * d'angolo, il numero d'ondata o lo scudo di chi ferma — Stasi, bersaglio.
   *
   * Le tessere stanno in cache per uid e si riusano da una zona all'altra,
   * quindi i segni vanno spenti a mano quando la carta lascia la lavagna:
   * l'attaccante che muore sotto Vendetta arrivava sulla cima dell'Abisso
   * ancora contornato di rosso, col suo numero d'ondata addosso.
   */
  function markField(tile: HTMLElement, card: CardInstance): void {
    const onField = card.zone === "field";
    const declaration = onField ? declarationOf(ctx.state(), card.uid) : undefined;
    tile.classList.toggle("is-attacking", declaration?.kind === "attack");
    tile.classList.toggle("is-blocking", declaration?.kind === "block");
    tile.classList.toggle("is-countering", declaration?.kind === "counter");

    // In modo bersaglio: le carte in campo del difensore sono scegliibili, e
    // fra queste si accendono quelle che le regole permetterebbero. Le altre
    // si smorzano soltanto — restano cliccabili.
    const canPick = onField && pickable(card);
    const stasis = onField && card.stasis === true;
    tile.classList.toggle("is-stasis", stasis);
    if (stasis) tile.dataset.stasis = t("tile.stasis");
    else delete tile.dataset.stasis;
    tile.classList.toggle("is-pickable", canPick);
    tile.classList.toggle("is-legal", canPick && (targeting?.mode === "effect" || looksPlayable(card)));
    markMarks(tile, card, onField);

    let badge = tile.querySelector<HTMLElement>(".combat-badge");
    if (!declaration) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "combat-badge";
      tile.append(badge);
    }
    badge.textContent = declaration.kind === "attack" ? String(declaration.order) : "⛨";
    badge.className = `combat-badge is-${declaration.kind}`;
  }

  /**
   * §8.2 — i segni di ciò che la carta ha in più rispetto allo stampato, in
   * colonna in basso a destra: lo scarto di Potenza (statici e potenziamenti
   * fino a fine turno: «+1 mentre attacca, se sul tuo Fronte c'è un'altra
   * Entità Umana», RBF-002), le parole chiave ottenute — da un effetto fino
   * a fine turno («la prossima Entità Umana che attacca ottiene Vendetta»,
   * RBF-004) o da un Oggetto addosso («se è Umana ha anche Stasi»,
   * RBF-013) — e il Contrattacco in più (RBF-020). Ogni abilità ottenuta si
   * segna sulla carta che la ottiene: è la regola generale del tavolo, e
   * prende il posto delle frecce, che sparivano.
   *
   * Il numero stampato sulla carta non cambia mai, e senza un segno il
   * giocatore non ha modo di accorgersi di ciò che si accende e si spegne
   * da solo. I segni sono pezzi della carta (le sue icone, il suo serif, il
   * suo rubino), non adesivi. Non si mostrano su una carta coperta: finché
   * è coperta è come se non fosse in campo (§6.3).
   */
  function markMarks(tile: HTMLElement, card: CardInstance, onField: boolean): void {
    let box = tile.querySelector<HTMLElement>(".tile-marks");
    const marks: { key: string; cls: string; icon: string; text: string; title: string }[] = [];
    if (onField && !card.facedown) {
      const facts = ctx.card(card.cardId);
      const state = ctx.state();
      const now = facts.power === null ? null : powerOf(card, ctx.card, state);
      // Sulla tessera compatta il numero mostrato è la Potenza attuale.
      setTessPower(tile, now);
      if (now !== null && facts.power !== null && now !== facts.power) {
        const delta = now - facts.power;
        // Il segno meno è quello tipografico (U+2212), come sulle carte.
        const sign = delta > 0 ? `+${delta}` : `−${-delta}`;
        // Da dove viene lo scarto: gli statici delle carte in campo restano
        // finché resta la carta che li dà (l'Oggetto assegnato, l'Umano
        // accanto), i potenziamenti cadono col turno. Sono due cose diverse
        // e il numero da solo non le distingue: il suggerimento sì.
        const fromTurn = card.powerBonus ?? 0;
        const fromField = staticPower(state, card, ctx.card);
        const parts =
          (fromField ? t("tile.power.static", { delta: fromField > 0 ? `+${fromField}` : `−${-fromField}` }) : "") +
          (fromTurn ? t("tile.power.turn", { delta: fromTurn > 0 ? `+${fromTurn}` : `−${-fromTurn}` }) : "");
        marks.push({ key: "power", cls: delta > 0 ? "power-delta is-up" : "power-delta is-down", icon: SWORDS_SVG, text: sign, title: t("tile.power", { n: now, printed: facts.power, parts }) });
      }
      // Le parole chiave date da un Oggetto «mentre assegnato» (RBF-013),
      // se la razza è quella chiesta; poi quelle concesse fino a fine turno.
      const fromObjects = new Set<string>();
      for (const object of wornBy(state, card.uid)) {
        for (const grant of ctx.card(object.cardId).grantsWhileAssigned) {
          if (grant.ifRace === null || grant.ifRace === facts.race) grant.keywords.forEach(keyword => fromObjects.add(keyword));
        }
      }
      const untilEnd = card.grants ?? [];
      for (const keyword of new Set([...untilEnd, ...fromObjects])) {
        // Stampata sulla carta: niente da segnare.
        if (facts.keywords.includes(keyword)) continue;
        const what = t(`grant.${keyword}`);
        const how = untilEnd.includes(keyword) ? "tile.grant.turn" : "tile.grant.assigned";
        marks.push({ key: `grant:${keyword}`, cls: "grant-mark", icon: "", text: what, title: t(how, { what }) });
      }
      if (card.counterBonus) {
        marks.push({ key: "counter", cls: "counter-mark", icon: COUNTER_SVG, text: `+${card.counterBonus}`, title: t("tile.counter.turn", { n: card.counterBonus }) });
      }
      // «Non può bloccare in questo turno» (§8.2): il segno, e la carta
      // resta accesa fino a fine turno — così in Reazione il difensore vede
      // subito quale delle sue non blocca.
      if (card.cannotBlock) {
        marks.push({ key: "noblock", cls: "noblock-mark", icon: "", text: t("tile.noblock"), title: t("tile.noblock.tip") });
      }
    }
    tile.classList.toggle("is-restrained", onField && !card.facedown && card.cannotBlock === true);
    if (!onField || card.facedown) setTessPower(tile, null);
    if (marks.length === 0) {
      box?.remove();
      return;
    }
    if (!box) {
      box = document.createElement("div");
      box.className = "tile-marks";
      tile.append(box);
    }
    // Ogni render passa di qui: si ricostruisce solo se qualcosa è cambiato.
    const signature = marks.map(mark => `${mark.key}=${mark.text}`).join("|");
    if (box.dataset.signature === signature) return;
    box.dataset.signature = signature;
    box.replaceChildren(
      ...marks.map(mark => {
        const chip = document.createElement("span");
        chip.className = mark.cls;
        chip.innerHTML = mark.icon;
        const label = document.createElement("b");
        label.textContent = mark.text;
        chip.append(label);
        chip.title = mark.title;
        return chip;
      })
    );
  }

  /** Quanto dura l'apertura della fila (specchio di --morph-ms in style.css). */
  const MORPH_MS = 380;
  /** La chiave con cui un riquadro si riconosce da una costruzione all'altra. */
  const zoneKey = (el: HTMLElement): string =>
    el.classList.contains("half")
      ? `half:${el.classList.contains("is-mine") ? "mine" : "foe"}`
      : el.classList.contains("pile-dock")
        ? "dock"
        : `slot:${el.dataset.seat ?? ""}:${el.dataset.drop ?? ""}:${el.dataset.label ?? ""}:${el.dataset.snapX ?? ""}:${el.classList.contains("dock-hand") ? "hand" : ""}`;
  /**
   * La fila di servizio avversaria che si apre e si chiude non salta: si
   * anima. Le zone si ricostruiscono da capo (buildStaticZones), quindi si
   * ricorda dov'era ciascun riquadro, si ricostruisce, e ogni riquadro
   * nuovo parte dal posto vecchio e scivola al suo (transizione su top e
   * height, style.css .is-morphing); chi non c'era entra con una
   * dissolvenza (.is-arriving); la scala del tavolo scivola con loro
   * (html.is-morphing: --card-scale è una proprietà registrata, e va in
   * transizione). Le carte, che restano le stesse, seguono con la loro
   * transizione. A corsa finita si toglie tutto e si ridisegna una volta:
   * la scala letta a metà corsa (drag.ts, la mano) torna quella vera.
   */
  function morphZones(rebuild: () => void): void {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      rebuild();
      return;
    }
    const before = new Map<string, { top: string; height: string }>();
    for (const el of surface.querySelectorAll<HTMLElement>(".half, .slot, .pile-dock")) {
      if (el.parentElement !== surface) continue;
      before.set(zoneKey(el), { top: el.style.top, height: el.style.height });
    }
    document.documentElement.classList.add("is-morphing");
    for (const tile of tiles.values()) tile.classList.add("is-morphing");
    rebuild();
    for (const el of surface.querySelectorAll<HTMLElement>(".half, .slot, .pile-dock")) {
      if (el.parentElement !== surface) continue;
      const old = before.get(zoneKey(el));
      if (!old || !old.top) {
        el.classList.add("is-arriving");
        continue;
      }
      const next = { top: el.style.top, height: el.style.height };
      el.style.top = old.top;
      if (el.classList.contains("half")) el.style.height = old.height;
      el.classList.add("is-morphing");
      void el.offsetHeight;
      el.style.top = next.top;
      if (el.classList.contains("half")) el.style.height = next.height;
    }
    window.setTimeout(() => {
      document.documentElement.classList.remove("is-morphing");
      for (const el of surface.querySelectorAll<HTMLElement>(".is-morphing, .is-arriving")) {
        el.classList.remove("is-morphing", "is-arriving");
      }
      for (const tile of tiles.values()) tile.classList.remove("is-morphing");
      render();
    }, MORPH_MS + 40);
  }

  function render(): void {
    const state = ctx.state();
    const me = ctx.seat();
    const foe = otherSeat(me);
    // Rincasso: la fila di servizio avversaria si riapre finché l'avversario
    // controlla un'Entità (§8.2) — il suo riquadro del controllo sta lì — e
    // si richiude dopo. Geometria nuova: zone e scala da rifare, prima di
    // posare le carte, con l'animazione (morphZones).
    const foeRow = isRecessView() && fieldCards(state).some(card => card.controller === foe);
    if (foeRow !== hasFoeBackRow()) {
      morphZones(() => {
        setFoeBackRow(foeRow);
        applySurfaceSize();
        buildStaticZones();
        fitScale();
      });
    }
    const alive = new Set<string>();

    for (const seat of SEATS) {
      const label = surface.querySelector<HTMLElement>(`[data-seat-name="${seat}"]`);
      if (label) {
        label.textContent = `${seatLabel(state, seat, me)}${seat === me ? t("label.you") : ""}`;
      }
      for (const pile of PILES) {
        const slot = pileSlots.get(`${seat}:${pile.zone}`)!;
        const cards = zoneCards(state, seat, pile.zone);
        // §6.5 — la mano oltre le 7: l'Abisso di quel posto si accende e
        // invita, perché scartare lì è l'ultimo gesto prima del Fine turno.
        const discard =
          pile.zone === "abisso" &&
          discardPrompt?.seat === seat &&
          discardPrompt.turn === state.turn &&
          ctx.controls(seat) &&
          zoneCards(state, seat, "hand").length > 7;
        slot.classList.toggle("is-discard", discard);
        if (discard) slot.dataset.hint = t("slot.discard");
        else delete slot.dataset.hint;
        slot.dataset.count = String(cards.length);
        const caption = slot.querySelector<HTMLElement>(".slot-label")!;
        caption.textContent = `${t(pile.label)} · ${cards.length}`;
        const top = cards[0];
        if (top) {
          alive.add(top.uid);
          const tile = tileFor(top, pile.hidden);
          markField(tile, top);
          if (tile.parentElement !== slot) slot.append(tile);
          tile.style.marginLeft = "";
          tile.style.position = "absolute";
          // Anche la cima della pila è una tessera in compatto, o sborderebbe
          // dallo slot e riporterebbe lo scorrimento che si voleva togliere.
          tile.style.height = `${tileViewH()}px`;
          tile.style.left = "";
          tile.style.top = "";
          tile.style.zIndex = "1";
        }
      }
    }

    for (const [seat, slot] of controlSlots) {
      const held = fieldCards(state).filter(card => card.controller === seat && !card.assignedTo);
      slot.style.visibility = held.length ? "" : "hidden";
      // Il coperchio: solo con più carte, e solo per chi le comanda — a
      // carta sola si agisce su di lei direttamente, come su ogni altra.
      const lid = controlLids.get(seat);
      if (lid) {
        const stacked = held.length > 1 && ctx.controls(seat);
        lid.hidden = !stacked;
        lid.dataset.count = String(held.length);
        lid.dataset.hint = t("control.open", { n: held.length });
        lid.title = t("control.open", { n: held.length });
      }
    }
    // La testata del pannello delle pile avversarie: i conti, sempre in vista.
    if (pileDock) {
      const counts = pileDock.querySelector<HTMLElement>(".pile-dock-counts")!;
      counts.textContent = PILES.map(pile => `${t(pile.label)} · ${zoneCards(state, foe, pile.zone).length}`).join("   ");
    }
    // Il riquadro del Rubyfront dice se il Rubyfront è ancora in Zona di
    // Richiamo: tratteggiato, col tasto Schiera.
    for (const [seat, slot] of rubySlots) {
      const card = waitingRubyfront(seat);
      const waiting = card !== undefined;
      slot.classList.toggle("is-recall", waiting);
      slot.classList.toggle("can-deploy", waiting && ctx.controls(seat));
      // Il tasto si spegne quando lo schieramento non passerebbe (§3.1), e
      // dice perché nel suggerimento.
      const button = slot.querySelector<HTMLButtonElement>(".deploy-btn");
      if (button) {
        const block = card ? deployBlock(card) : null;
        button.disabled = block !== null;
        const player = card ? state.players[card.owner] : null;
        const available = player ? player.flux + (player.token ? 1 : 0) : 0;
        const deployment = card ? cardStats(card.cardId).deployment : null;
        button.title = block
          ? t(block, { available, cost: deployment?.fixed ?? 0, die: deployment?.die ?? 0 })
          : t("recall.deploy.tip");
      }
      // Un posto solo, due stati. Finché il Rubyfront aspetta l'etichetta
      // non c'è: al suo posto, a cavallo del bordo basso della carta, sta il
      // tasto Schiera — e un'etichetta lì sotto ci finirebbe dietro.
      slot.dataset.label = waiting ? "" : t("zone.rubyfront");
    }

    // §7.2 — la barra della catena: cosa c'è in cima, e a chi tocca.
    const chain = state.chain;
    const top = chainTop(state);
    if (chain && top) {
      const card = `«${cardName(top.cardId, ctx.locale())}»`;
      const mine = !chain.resolving && ctx.controls(chain.turn);
      chainText.textContent = chain.resolving
        ? t("chain.bar.resolving")
        : mine
          ? t("chain.bar.mine", { card })
          : t("chain.bar.theirs", { card, name: seatLabel(state, chain.turn, me) });
      chainAccept.hidden = !mine;
      chainBar.hidden = false;
    } else {
      chainBar.hidden = true;
    }

    for (const card of fieldCards(state)) {
      alive.add(card.uid);
      // La carta in catena (§7.2) sta al centro del tavolo, a scaletta,
      // sopra tutto: i suoi pixel di lavagna restano quelli della fila
      // delle Materie, dove tornerebbe se la catena si sciogliesse.
      const chainIndex = chain?.stack.indexOf(card.uid) ?? -1;
      const spot = spotOf(card.x, card.y);
      const tile = tileFor(card, card.facedown, isCompactView());
      markField(tile, card);
      if (tile.parentElement !== surface) surface.append(tile);
      if (card.uid !== dragging) {
        tile.style.position = "absolute";
        if (chainIndex >= 0) {
          const at = chainSpot(chainIndex);
          tile.style.left = `${at.x}px`;
          tile.style.top = `${at.y}px`;
        } else {
          tile.style.left = `${spot.x}px`;
          tile.style.top = `${spot.y}px`;
        }
      }
      // Il margine negativo è un vestito della mano affollata: se la tessera
      // arriva da lì e se lo tenesse addosso, si disegnerebbe a sinistra del
      // punto vero — «fuori dallo slot» pur essendoci, nei dati, dentro.
      tile.style.marginLeft = "";
      // In compatto la tessera è il riquadro dell'illustrazione (tileViewH);
      // la forma la decide syncCardEl (tileFor), qui solo la misura.
      tile.style.height = `${tileViewH()}px`;
      tile.classList.remove("is-unaffordable");
      tile.style.zIndex = chainIndex >= 0 ? String(900 + chainIndex) : String(10 + card.z);
    }

    // In rincasso la mano avversaria vive nel pannello: la fascia in cima
    // non c'è (CSS), e qui si disegna il mazzetto col conto.
    if (dockHand) {
      const cards = zoneCards(state, foe, "hand");
      dockHand.querySelector<HTMLElement>(".slot-label")!.textContent = t("recess.hand", { n: cards.length });
      dockHand.classList.toggle("is-empty", cards.length === 0);
      const top = cards[cards.length - 1];
      if (top) {
        alive.add(top.uid);
        const tile = tileFor(top, !ctx.controls(foe));
        markField(tile, top);
        if (tile.parentElement !== dockHand) dockHand.append(tile);
        tile.style.position = "absolute";
        tile.style.left = "";
        tile.style.top = "";
        tile.style.marginLeft = "";
        tile.style.height = `${tileViewH()}px`;
        tile.style.zIndex = "1";
      }
    }
    for (const [seat, host, tag] of ([[me, myHand, myTag], ...(dockHand ? [] : [[foe, oppHand, oppTag] as const])] as const)) {
      host.dataset.seat = seat;
      // `data-drop=""` sarebbe comunque selezionato da [data-drop]: la mano
      // avversaria non deve avere l'attributo del tutto — in partita locale
      // invece lo porta, e le carte del secondo posto vi tornano trascinandole.
      if (ctx.controls(seat)) host.dataset.drop = "hand";
      else delete host.dataset.drop;
      const cards = zoneCards(state, seat, "hand");
      // Una carta appena arrivata in mano va vista: se il cassetto è
      // ripiegato, si apre da solo. Vale per ogni via (Pesca, menu della
      // pila, «rimetti in mano») ma non al primo render, che è solo lo
      // stato di partenza — e non durante un trascinamento dalla mano, che
      // la ripiega apposta (lì il conto non cresce).
      if (seat === me) {
        if (lastMyHand >= 0 && cards.length > lastMyHand && myHand.classList.contains("is-collapsed")) {
          setHandCollapsed(false);
        }
        lastMyHand = cards.length;
      }
      // §6.5 — «non si possono avere più di 7 carte in mano» a fine turno:
      // la targhetta lo dice prima che sia il sigillo a dirlo.
      const over = seat === me && cards.length > 7 && ctx.controls(seat);
      // La mano chiusa a chiave (§6) lo dice sulla targhetta e si spegne un
      // po': si guarda, non si tocca, finché il momento non torna suo.
      const locked = seat === me && ctx.controls(seat) && handLocked(seat);
      host.classList.toggle("is-locked", locked);
      // §6.5 — l'eccesso si scarta alla fine del PROPRIO turno: l'invito a
      // scartare vale nel proprio turno; nel turno altrui, con la mano
      // chiusa, la targhetta dice solo che si scarterà a fine del proprio.
      const excess = over && !locked && state.active === seat;
      const foeName = seatLabel(state, otherSeat(seat), me);
      tag.textContent = seat === me
        ? `${t("hand.mine", { n: cards.length })}${excess ? t("hand.excess") : locked ? t(over ? "hand.excess.later" : "hand.locked", { name: foeName }) : ""}`
        : seatWaiting(state, seat)
          ? t("hand.waiting")
          : t("hand.theirs", { name: seatLabel(state, seat), n: cards.length });
      tag.classList.toggle("is-excess", excess);
      host.classList.toggle("is-empty", cards.length === 0);
      const wanted: HTMLElement[] = [];
      cards.forEach(card => {
        alive.add(card.uid);
        // La mano di un posto governato si vede scoperta: in rete solo la
        // propria, in partita locale anche quella in alto.
        const tile = tileFor(card, !ctx.controls(seat));
        markField(tile, card);
        tile.style.position = "relative";
        tile.style.left = "";
        tile.style.top = "";
        // In compatto anche in mano si sta a tessere: la mano entra nella
        // finestra e la carta si legge al passaggio.
        tile.style.height = `${isCompactView() ? COMPACT_TILE_H : TILE_H}px`;
        tile.style.zIndex = "";
        tile.classList.toggle("is-unaffordable", unaffordable(card));
        wanted.push(tile);
      });
      // Le carte in mano si sovrappongono quando sono troppe: restano
      // 302×424, si stringono soltanto le une sulle altre. Il conto va
      // fatto sulla larghezza VISIVA (la scala della mano, o quella del
      // campo per i dorsi avversari su touch): in pixel canonici le carte
      // sembrerebbero enormi e si accatasterebbero già in sei.
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      // La spinta della mano è quella che fitScale ha scritto in --hand-boost.
      const boost = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hand-boost")) || 1;
      const scale = seat === me || !coarse
        ? Math.min(1, surfaceScale() * boost)
        : surfaceScale();
      const tileW = TILE_W * scale;
      // Su touch la targhetta avversaria sta nel flusso e ruba larghezza.
      // Nella propria mano, sull'orlo destro, sta il tasto che ripiega: le
      // carte si fermano prima. (Il gesto di fase sta fuori dal cassetto,
      // nell'angolo che il tavolo gli riserva.)
      const corner = seat === me ? 50 : 0;
      const room = host.clientWidth - 32 - corner - (coarse && seat !== me ? tag.offsetWidth + 14 : 0);
      const overlap = wanted.length > 1 && wanted.length * (tileW + 10) > room
        ? Math.min(0, (room - tileW) / (wanted.length - 1) - tileW - 10)
        : 0;
      wanted.forEach((tile, index) => {
        tile.style.marginLeft = index === 0 ? "0" : `${Math.round(overlap)}px`;
      });
      // La pesca si vede: le carte NUOVE della mano entrano dal bordo del
      // cassetto, in cascata (delay per ordine d'arrivo). Il segno si mette
      // prima dell'aggancio e cade a fine corsa — e la mano si riaggancia
      // al DOM solo se è davvero cambiata, sennò ogni render qualunque
      // (un dado, una mossa altrui) farebbe ripartire l'animazione.
      // Sotto l'insegna di fase (banner.ts) la carta del turno aspetta:
      // prima la scritta, poi sparisce, poi la pesca. `backwards` la tiene
      // invisibile nell'attesa; il posto in fila lo prende subito.
      const until = Number(document.body.dataset.announceUntil ?? 0);
      const hold = until > Date.now() ? until - Date.now() + 80 : 0;
      let entrance = 0;
      for (const tile of wanted) {
        if (tile.parentElement === host) continue;
        const delay = hold + entrance * DRAW_STEP_MS;
        tile.classList.add("is-drawn");
        tile.style.animationDelay = `${delay}ms`;
        entrance += 1;
        // Un timer, non animationend: gli eventi dei figli risalgono e un
        // listener `once` se li berrebbe. 70ms di margine sulla corsa.
        window.setTimeout(() => {
          tile.classList.remove("is-drawn");
          tile.style.animationDelay = "";
        }, DRAW_RUN_MS + 70 + delay);
      }
      const settled =
        host.children.length === wanted.length + 1 &&
        wanted.every((tile, index) => host.children[index + 1] === tile);
      if (!settled) host.replaceChildren(tag, ...wanted);
    }

    for (const [uid, tile] of tiles) {
      if (alive.has(uid)) continue;
      tile.remove();
      tiles.delete(uid);
    }
    paintArrows();
    fitPending(document.body);
    driveChain();
  }

  return {
    render,
    flash,
    promptDiscard(seat) {
      const turn = ctx.state().turn;
      const already = discardPrompt?.seat === seat && discardPrompt.turn === turn;
      discardPrompt = { seat, turn };
      render();
      return !already;
    },
    strike: uid => strike(uid, TRIGGER_LEAD_MS + FLY_MS),
    liftForFlight,
    flyFromPile,
    liftToFlight,
    refreshLayout() {
      applySurfaceSize();
      buildStaticZones();
      fitScale();
      render();
    },
    onStats(provider) {
      statsFor = provider;
      // Le zone sono già costruite (main.ts monta l'HUD dopo il tavolo):
      // le targhe si appendono adesso, e a ogni ricostruzione da qui in poi.
      for (const head of surface.querySelectorAll<HTMLElement>(".half-head")) {
        head.append(provider(head.dataset.seat as Seat));
      }
    },
    onPick(handler) {
      pickFromPileUi = handler;
    },
    setAuto(seat, chooser) {
      auto = seat ? { seat, chooser } : null;
    },
    playFromHand(card, spot) {
      return place(card, spot.x, spot.y, dropZ(card, spot.x, spot.y));
    },
    async assignObject(card, bearer) {
      // Lo stesso ordine del rilascio sopra un'Entità: prima l'assegnazione
      // (§3.1), poi la giocata; se la giocata non passa, si scioglie.
      if (!(await ctx.dispatch({ t: "assign", uid: card.uid, to: bearer.uid }))) return false;
      const worn = Object.values(ctx.state().cards).filter(other => other.assignedTo === bearer.uid && other.uid !== card.uid).length;
      const step = STACK_STEP * (worn + 1);
      const x = Math.max(0, Math.min(SURFACE_W - TILE_W, bearer.x + step));
      const y = Math.max(0, Math.min(SURFACE_H - TILE_H, bearer.y + step));
      if (!(await place(card, x, y, dropZ(card, x, y)))) {
        void ctx.dispatch({ t: "assign", uid: card.uid, to: null });
        return false;
      }
      ctx.log(msg("log.assign", { seat: card.owner, card: card.cardId, toCard: bearer.cardId }), card.owner);
      return true;
    },
    async deployRubyfront(seat) {
      const waiting = waitingRubyfront(seat);
      if (!waiting || deployBlock(waiting)) return false;
      const deployment = cardStats(waiting.cardId).deployment;
      if (!deployment) return false;
      const front = frontRowY(seat);
      await deploy(waiting, RUBYFRONT_X, front, dropZ(waiting, RUBYFRONT_X, front), deployment, { x: waiting.x, y: waiting.y, z: waiting.z });
      return true;
    },
    attackWith(card) {
      return declareAttack(card);
    },
    onBrowse(handler) {
      browse = handler;
    },
    onListControl(handler) {
      listControlHandler = handler;
    },
  };
}

export type { GameState };
