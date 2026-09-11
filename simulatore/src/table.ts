// Il tavolo: la lavagna, le pile, le due mani.
//
// Il disegno è "riconciliato", non ricostruito: ogni carta ha un solo elemento
// DOM, che viene spostato da una zona all'altra. Ricrearlo a ogni cambio di
// stato significherebbe rilanciare il renderer e `fitTextBoxes` su decine di
// carte a ogni mossa — e vedere la mano sfarfallare a ogni tiro di dado.

import { msg, t } from "./i18n.js";
import { createArrowLayer, drawArrows, type Arrow } from "./arrows.js";
import { createCardEl, fitPending, keywordIcon, setTessPower, syncCardEl, wirePreview } from "./cardview.js";
import { playSound } from "./sound.js";
import { declareAttack as declareAttackVia, declareBlock, neverTaps, powerOf, staticCounter, staticPower, undeclare, wornBy } from "./combat.js";
import { armPreview, disarmPreview, tapPreview } from "./preview.js";
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
  chainRowY,
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
import { confirmEffect, noticeEffect, sceneIdle, showChoices, showEnterEffect } from "./effect.js";
import {
  describeControl,
  describeRefresh,
  describeLook,
  describeMove,
  describeReturn,
  enterDisarms,
  enterRearms,
  leaveReturns,
  rearmChoices,
  underStack,
  resolveDisarm,
  resolveRearm,
  resolveLeaveReturn,
  type EnterDisarmStep,
  type EnterRearmStep,
  type LeaveReturnStep,
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
  assignCandidates,
  assignRef,
  assignSteps,
  describeAssignStep,
  describeFlipStep,
  describeResolveStep,
  discountedCost,
  weakenAmount,
  wornObjects,
  objectCost,
  searchCandidates,
  deckEnds,
  deathSteps,
  deathRef,
  describeDeathStep,
  rearmAfterDeath,
  type AssignStep,
  type DeathStep,
  flipCandidates,
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
  nexusRequirementCopy,
  CARD_H,
  CARD_W,
  fitTexts,
  renderFace,
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
import type { Ability, AssignForm } from "./ctx.js";
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

/** Il suggerimento del flip per ogni «perché no» di nexusCheck (effects.ts). */
const FLIP_HINTS: Record<string, string> = {
  "log.nexus.few": "flip.hint.few",
  "log.nexus.few.armed": "flip.hint.few.armed",
  "log.nexus.nodiscard": "flip.hint.nodiscard",
  "log.nexus.nocard": "flip.hint.nocard",
};

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
  /** §8.2 — il ritorno vincolato: dopo ogni azione applicata, main.ts
      confronta lo stato di prima con quello di dopo e, per ogni carta con
      la forma appena uscita dal campo, offre il ritorno a chi la possiede
      (il giocatore, o il bot col suo selettore). */
  offerLeaveReturns(before: GameState, after: GameState, owners: Seat[]): void;
  /** §3.1 — «quando assegni questa carta»: dopo ogni azione applicata, gli
      Oggetti con la forma appena assegnati innescano per chi li comanda
      (il giocatore, o il bot col suo selettore). */
  offerAssignTriggers(before: GameState, after: GameState, owners: Seat[]): void;
  /** §8.2 — «quando quell'Entità muore»: l'Oggetto con la forma appena
      finito nell'Abisso con la sua Entità resta in Ritiro, per chi lo possiede. */
  offerDeathRemains(before: GameState, after: GameState, owners: Seat[]): void;
  assignObject(card: CardInstance, bearer: CardInstance): Promise<boolean>;
  /** Vero se ha schierato (o tirato); falso se lo schieramento non passerebbe. */
  deployRubyfront(seat: Seat): Promise<boolean>;
  attackWith(card: CardInstance): Promise<void>;
  /** §3.1 — un'abilità speciale del Rubyfront, per il bot (main.ts): la
      stessa via del menu, mira e conferme rispondono da sole (setAuto).
      Vero se l'arbitro l'ha passata. */
  useAbility(card: CardInstance, ability: Ability): Promise<boolean>;
  /** §3.1 — il flip verso il Nexus, per il bot: requisito, scarto (dal
      selettore) e recupero in un'azione sola. Vero se è passato. */
  flipToNexus(card: CardInstance): Promise<boolean>;
  /** Callback per scegliere una carta da una pila (effetti): la fornisce main.ts. */
  onPick(
    handler: (seat: Seat, zone: ZoneId, candidates: CardInstance[], title: string, visible?: CardInstance[]) => Promise<CardInstance | null>
  ): void;
  /** §6.5 — il Fine turno fermato dalla mano piena: da qui l'Abisso di quel
      posto si accende e invita, finché non si scarta o non cambia il turno.
      Dice se l'ha acceso ADESSO: il sigillo lo vede solo chi ha premuto, e
      la riga in chat che avvisa l'avversario va scritta una volta sola. */
  promptDiscard(seat: Seat): boolean;
  /** Riallinea la tinta dei campi e degli slot a quella dei mazzi (ctx.tintFor):
      i riquadri nascono prima che i mazzi siano caricati. */
  retint(): void;
  /** Il bagliore di una carta che si innesca: per gli effetti arrivati dalla rete. */
  flash(uid: string, ms?: number): void;
  /** Il lampo rosso sulla carta colpita da un effetto, per un attimo. */
  strike(uid: string): void;
  /** Prende la tessera prima che voli in una pila (chi riceve): ritorna il
      via al volo, da dare dopo aver applicato l'azione. */
  liftForFlight(uid: string, zone?: "ritiro" | "abisso", opts?: { slain?: boolean }): Flight | null;
  /** Il colpo di una battaglia su chi resta in campo (§6.3): la parata del
      bloccante, la risposta di chi contrattacca — un segno sulla tessera. */
  clash(uid: string, kind: "parry" | "riposte"): void;
  /** Il volo da una pila al campo (chi riceve): dopo aver applicato l'azione. */
  flyFromPile(seat: Seat, zone: ZoneId, uid: string): void;
  /** L'INGRESSO dei Rubyfront a inizio partita (col bot): uno alla volta,
      nell'ordine dato, la carta arriva dal proprio lato, si mostra grande al
      centro, si accende nella tinta del mazzo e si posa in Zona di Richiamo.
      Il tavolo è fermo finché non finisce (body.is-intro). */
  introRubyfronts(order: Seat[]): Promise<void>;
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
    /** Dalla propria carta: si è scelto il bloccante, si cerca l'attaccante. */
    | { mode: "blocker"; blocker: string; kind: "block" | "counter"; pointer: { x: number; y: number } | null }
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
  // I tasti di combattimento (§6.3, §6.4): «Attacca», «Blocca»,
  // «Contrattacca», «Con questa», «Annulla» — a cavallo del bordo basso
  // della carta, come «Schiera» sotto il Rubyfront. Un livello a sé sopra
  // le tessere: le tessere ritagliano ciò che sborda, e ruotano da tappate.
  const combatLayer = document.createElement("div");
  combatLayer.className = "combat-layer";
  surface.append(combatLayer);
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

  // §7.2 — con la catena aperta il tavolo va sotto un velo e non si tocca
  // (deciso 2026-09-11): si risponde dalla mano, o si accetta dalla barra.
  const chainVeil = document.createElement("div");
  chainVeil.className = "chain-veil";
  chainVeil.hidden = true;
  root.append(board, chainVeil, oppHand, myHand, handDrop, handToggle, targetHint, chainBar);

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
    // Schierato, al posto di «Schiera» sta «Abilità»: apre la scelta fra le
    // abilità speciali della faccia in vista e il flip verso il Nexus
    // (§3.1) — un tasto, non il tasto destro (deciso 2026-09-08).
    const abilities = document.createElement("button");
    abilities.type = "button";
    abilities.className = "ability-btn";
    abilities.textContent = t("recall.abilities");
    abilities.title = t("recall.abilities.tip");
    abilities.addEventListener("click", event => {
      event.stopPropagation();
      void openAbilities(seat);
    });
    slot.append(abilities);
    // Il flip pronto (§3.1): quando il requisito del Nexus è soddisfatto,
    // nel proprio turno, un tasto dorato che respira compare sotto la
    // carta — non si va a controllare a mano (deciso 2026-09-10). Un click
    // e si flippa, con lo scarto dalla mano e la scena «Quando flippa».
    const flipButton = document.createElement("button");
    flipButton.type = "button";
    flipButton.className = "flip-btn";
    flipButton.textContent = t("recall.flip");
    flipButton.title = t("recall.flip.tip");
    flipButton.addEventListener("click", event => {
      event.stopPropagation();
      const card = deployedRubyfront(seat);
      if (card && flipReady(card)) void flipToNexus(card);
    });
    slot.append(flipButton);
  }

  /**
   * Il flip verso il Nexus passerebbe adesso? Con l'arbitro, per chi comanda
   * il Rubyfront schierato con la faccia del Rubyfront in vista, nel proprio
   * turno in Preparazione o Fronte, fuori da una catena, col requisito
   * certificato soddisfatto (nexusCheck).
   */
  function flipReady(card: CardInstance): boolean {
    if (!ctx.arbitrated() || !ctx.controls(card.owner)) return false;
    const state = ctx.state();
    const nexus = ctx.card(card.cardId).nexus;
    if (!nexus || card.face === nexus.face) return false;
    if (state.active !== card.owner || (state.phase !== "preparazione" && state.phase !== "fronte")) return false;
    if (state.chain || state.over) return false;
    return nexusCheck(state, card, ctx.card).ok;
  }

  /** Il Rubyfront/Nexus di `seat` schierato, in gioco. */
  function deployedRubyfront(seat: Seat): CardInstance | undefined {
    return fieldCards(ctx.state()).find(card => card.owner === seat && isRubyfront(card.cardId) && inPlay(card, ctx.card(card.cardId).kind));
  }

  /**
   * La scelta delle abilità (§3.1): la carta di fianco, una voce per
   * abilità della faccia in vista — nome, prezzo, testo — e il flip verso
   * il Nexus col suo requisito. Le voci che ora non passerebbero restano in
   * vista, spente, col perché.
   */
  async function openAbilities(seat: Seat): Promise<void> {
    const card = deployedRubyfront(seat);
    if (!card || !ctx.controls(seat) || !ctx.arbitrated()) return;
    const state = ctx.state();
    const facts = ctx.card(card.cardId);
    const own = state.active === seat;
    const player = state.players[seat];
    const spent = player.abilityTurn === state.turn;
    const options: Parameters<typeof showChoices>[1]["options"] = [];
    for (const ability of facts.abilities.filter(candidate => candidate.face === card.face)) {
      const copy = abilityCopy(card.cardId, ability.face, ability.displayKey, ctx.locale());
      const price = ability.cost !== null ? t("ability.cost", { n: ability.cost }) : t("ability.gain", { n: ability.gain ?? 0 });
      let hint: string | null = null;
      if (!ability.form) hint = t("ability.hint.manual");
      else if (!own) hint = t("ability.hint.turn");
      else if (!ability.timing.includes(state.phase)) hint = t("ability.hint.window", { phase: t(ability.timing.length === 1 ? `phase.title.${ability.timing[0]}` : "ability.window.both") });
      else if (spent) hint = t("ability.hint.used");
      else if (player.hp < (ability.cost ?? 0)) hint = t("ability.hint.hp", { n: ability.cost ?? 0 });
      options.push({ id: `ability:${ability.id}`, label: copy.name, price, text: copy.text, disabled: hint !== null, ...(hint ? { hint } : {}) });
    }
    const nexus = facts.nexus;
    if (nexus && card.face !== nexus.face) {
      const check = nexusCheck(state, card, ctx.card);
      let hint: string | null = null;
      if (!own || (state.phase !== "preparazione" && state.phase !== "fronte")) hint = t("ability.hint.turn");
      else if (!check.ok) hint = t(FLIP_HINTS[check.why] ?? "flip.hint.nodiscard", { n: check.n ?? 0 });
      options.push({
        id: "flip",
        label: t("menu.flip.nexus"),
        ...(nexus.recovery ? { price: t("ability.gain", { n: nexus.recovery }) } : {}),
        text: nexusRequirementCopy(card.cardId, ctx.locale()),
        disabled: hint !== null,
        ...(hint ? { hint } : {}),
      });
    }
    const chosen = await showChoices(root, {
      cardId: card.cardId,
      face: card.face,
      theme: ctx.themeFor(card.owner),
      locale: ctx.locale(),
      kicker: t("scene.abilities"),
      who: t("scene.abilities.who", { name: cardName(card.cardId, ctx.locale()), hp: player.hp }),
      options,
      closeLabel: t("overlay.close"),
    });
    if (!chosen) return;
    const live = ctx.state().cards[card.uid];
    if (!live) return;
    if (chosen === "flip") {
      await flipToNexus(live);
      return;
    }
    const ability = facts.abilities.find(candidate => `ability:${candidate.id}` === chosen && candidate.face === live.face);
    if (ability) await useAbility(live, ability);
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
      // La tinta del campo segue il mazzo del posto (ctx.tintFor): i temi la
      // leggono come data-tint, il layout no.
      band.dataset.seat = seat;
      band.dataset.tint = ctx.tintFor(seat);
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
        slot.dataset.side = mine ? "mine" : "foe";
        slot.dataset.tint = ctx.tintFor(seat);
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
        slot.dataset.side = mine ? "mine" : "foe";
        slot.dataset.seat = seat;
        slot.dataset.tint = ctx.tintFor(seat);
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
        // Il lato del posto (tuo/avversario): ai temi serve per tingere
        // l'alloggio, il layout non lo legge.
        slot.dataset.side = mine ? "mine" : "foe";
        slot.dataset.seat = seat;
        slot.dataset.tint = ctx.tintFor(seat);
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
      const rubySlot = markSlot(RUBYFRONT_X, front, "", "slot-rubyfront");
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
            const passed = await ctx.dispatch({ t: "toZone", uid: chosen.uid, zone: "ritiro", effect: attackRef(step, "discard") });
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
          const worn = Object.values(ctx.state().cards).filter(other => other.assignedTo === attacker.uid && other.zone === "field");
          const spot = { x: attacker.x + STACK_STEP * (worn.length + 1), y: attacker.y + STACK_STEP * (worn.length + 1) };
          const passed = await ctx.dispatch({ t: "toZone", uid: chosen.uid, zone: "field", ...spot, z: underStack(attacker, worn), assignTo: attacker.uid, effect: attackRef(step) });
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

  /** Il verso opposto: dalla propria Entità, si sceglie l'attaccante da fermare. */
  function startTargetingFrom(blocker: CardInstance, kind: "block" | "counter"): void {
    targeting = { mode: "blocker", blocker: blocker.uid, kind, pointer: null };
    document.body.classList.add("is-targeting");
    targetHint.textContent = t(kind === "counter" ? "target.attacker.counter" : "target.attacker.block");
    targetHint.hidden = false;
    render();
  }

  /**
   * I tasti di combattimento sotto le carte (§6.3, §6.4) — non il click
   * sulla carta, non il tasto destro, non il trascinamento (deciso
   * 2026-09-09): un tasto, come «Schiera».
   *
   * In Fase di Fronte, nel proprio turno, sotto ogni propria Entità che può
   * attaccare: «Attacca»; sotto l'attaccante dichiarato: «Annulla attacco».
   * In Reazione, per chi governa il difensore: sotto ogni attaccante
   * avversario «Blocca» e «Contrattacca», poi sotto le proprie Entità «Con
   * questa»; oppure sotto la propria Entità «Blocca» e «Contrattacca», poi
   * sotto gli attaccanti «Ferma questo»; sotto un bloccante dichiarato, e
   * sotto la carta da cui è partita una scelta, «Annulla».
   */
  type Tab = { label: string; kind: "attack" | "block" | "counter" | "confirm" | "cancel"; run: () => void };

  function combatTabsFor(card: CardInstance): Tab[] {
    const state = ctx.state();
    if (card.zone !== "field") return [];
    const controller = controllerOf(card);
    const declared = declarationOf(state, card.uid);
    const kind = faceKind(card.cardId, card.face);
    const entity = kind === null || kind === "entity";
    // Un effetto in mira: nessun tasto di combattimento in mezzo.
    if (targeting?.mode === "effect") return [];
    // Una coperta non fa nulla (§6.3) — salvo ripensare il contrattacco che
    // l'ha coperta: quel tasto resta, in Reazione, a chi la governa.
    if (card.facedown) {
      if (!targeting && state.phase === "reazione" && declared && declared.kind !== "attack" && !declared.sealed && ctx.controls(controller)) {
        return [{ label: t("tab.cancel"), kind: "cancel", run: () => void undeclare(ctx, card, declared) }];
      }
      return [];
    }

    // La scelta in corso: si conferma o si annulla.
    if (targeting?.mode === "block") {
      if (card.uid === targeting.attacker) return [{ label: t("tab.cancel"), kind: "cancel", run: cancelTargeting }];
      if (pickable(card) && entity && !declared) return [{ label: t("tab.with"), kind: targeting.kind, run: () => confirmBlock(card) }];
      return [];
    }
    if (targeting?.mode === "blocker") {
      if (card.uid === targeting.blocker) return [{ label: t("tab.cancel"), kind: "cancel", run: cancelTargeting }];
      if (pickable(card)) return [{ label: t("tab.this"), kind: targeting.kind, run: () => confirmBlock(card) }];
      return [];
    }

    // Fase di Fronte, il proprio turno: si attacca (§6.3). Il Rubyfront non
    // attacca (§3.1), dichiarano le Entità; una tappata non può.
    if (state.phase === "fronte" && state.active === controller && ctx.controls(controller) && entity) {
      // L'attacco che ha già innescato i suoi effetti è fermo (§8.2): niente Annulla.
      if (declared?.kind === "attack") return declared.sealed ? [] : [{ label: t("tab.cancel"), kind: "cancel", run: () => void undeclare(ctx, card, declared) }];
      if (!declared && !card.tapped) return [{ label: t("menu.attack"), kind: "attack", run: () => void declareAttack(card) }];
      return [];
    }

    // Reazione: il difensore (l'altro posto rispetto a chi è di turno) ferma
    // gli attaccanti, «vista l'intera ondata» (§6.4).
    if (state.phase !== "reazione") return [];
    const defender = otherSeat(state.active);
    if (!ctx.controls(defender)) return [];
    if (declared?.kind === "attack" && controller === state.active) {
      return [
        { label: t("tab.block"), kind: "block", run: () => startTargeting(card, "block") },
        { label: t("tab.counter"), kind: "counter", run: () => startTargeting(card, "counter") },
      ];
    }
    if (controller !== defender) return [];
    if (declared) return declared.sealed ? [] : [{ label: t("tab.cancel"), kind: "cancel", run: () => void undeclare(ctx, card, declared) }];
    if (!entity || card.tapped || card.cannotBlock) return [];
    const attackers = state.declarations.some(d => d.kind === "attack" && controllerOf(state.cards[d.from]) === state.active);
    if (!attackers) return [];
    return [
      { label: t("tab.block"), kind: "block", run: () => startTargetingFrom(card, "block") },
      { label: t("tab.counter"), kind: "counter", run: () => startTargetingFrom(card, "counter") },
    ];
  }

  /**
   * Ridisegna i tasti di combattimento. La carta resta pulita: chi ha un
   * gesto disponibile porta un anello rubino che respira (has-actions), e
   * al passaggio del mouse (al tocco, su touch) si apre un VELO scuro
   * grande quanto la carta, coi tasti in colonna, larghi uguali (deciso
   * 2026-09-09: «un overlay con i bottoni, Blocca e Contrattacca a capo»).
   * Il velo si chiude quando il puntatore lo lascia. La carta coricata ruota
   * attorno al suo centro: il velo prende la misura che si vede. I tasti
   * sono a misura di schermo: se la carta è più piccola di loro, il velo
   * cresce oltre i bordi della carta (style.css, min-width: max-content).
   */
  const combatGroups = new Map<string, HTMLElement>();
  /** La carta col velo aperto: sopravvive ai ridisegni (ogni render rifà i
      veli), finché il puntatore non lo lascia. */
  let openCombatUid: string | null = null;
  function openCombatGroup(uid: string): void {
    openCombatUid = uid;
    for (const [other, group] of combatGroups) group.classList.toggle("is-open", other === uid);
  }
  /** Una targhetta del velo: icona e numero, col nome al passaggio. */
  function statChip(icon: string, text: string, title: string): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "combat-stat";
    chip.innerHTML = icon;
    chip.append(document.createTextNode(text));
    chip.title = title;
    return chip;
  }

  function paintCombatTabs(): void {
    combatLayer.replaceChildren();
    combatGroups.clear();
    // Le tessere si riusano da una zona all'altra: chi ha lasciato il campo
    // (il bloccante morto, nell'Abisso) perde l'anello e il velo, o
    // arrivava sulla cima della pila ancora contornato di rubino.
    for (const tile of tiles.values()) {
      tile.classList.remove("has-actions");
      tile.onpointerenter = null;
    }
    for (const card of fieldCards(ctx.state())) {
      const tabs = combatTabsFor(card);
      const tile = tiles.get(card.uid);
      // La carta coricata nasconde i suoi numeri sotto la vicina (deciso
      // 2026-09-10): al passaggio apre il velo coi numeri, anche senza tasti.
      const facts = ctx.card(card.cardId);
      const entity = facts.kind === "entity" && !card.facedown;
      const veiled = tabs.length > 0 || (entity && card.tapped);
      if (tile) {
        tile.classList.toggle("has-actions", tabs.length > 0);
        tile.onpointerenter = veiled ? event => { if (event.pointerType !== "touch") openCombatGroup(card.uid); } : null;
      }
      if (!veiled) continue;
      const box = boxOf(card);
      const group = document.createElement("div");
      group.className = "combat-tabs";
      // I numeri della carta in testa al velo: Potenza di adesso, Contrattacco
      // (stampato, dagli Oggetti, concesso) se c'è.
      if (entity) {
        const stats = document.createElement("div");
        stats.className = "combat-stats";
        const power = powerOf(card, ctx.card, ctx.state());
        if (power !== null) stats.append(statChip(SWORDS_SVG, String(power), t("stat.power")));
        const counter = (facts.counterattack ?? 0) + (card.counterBonus ?? 0) + staticCounter(ctx.state(), card, ctx.card);
        if (counter > 0) stats.append(statChip(COUNTER_SVG, `+${counter}`, t("stat.counter")));
        group.append(stats);
      }
      group.style.left = `${box.x + box.w / 2}px`;
      group.style.top = `${box.y + box.h / 2}px`;
      group.style.width = `${card.tapped ? box.h : box.w}px`;
      group.style.height = `${card.tapped ? box.w : box.h}px`;
      // Il velo aperto sta sopra la tessera e le ruba il puntatore: la
      // tessera vede un pointerleave e l'ingrandimento si chiude. È il velo
      // a tenerlo armato (e a spegnerlo quando il puntatore lo lascia): la
      // carta coricata si legge in grande come tutte le altre. Ancora è il
      // velo stesso, che può essere più largo della carta: l'ingrandimento
      // si affianca a lui e non copre mai i tasti.
      group.addEventListener("pointerenter", event => {
        if (event.pointerType === "touch" || !tile || tile.classList.contains("is-back")) return;
        const live = ctx.state().cards[card.uid];
        if (live) armPreview(group, live.cardId, live.face, ctx.themeFor(live.owner), ctx.locale());
      });
      group.addEventListener("pointerleave", () => {
        group.classList.remove("is-open");
        if (openCombatUid === card.uid) openCombatUid = null;
        disarmPreview();
      });
      if (openCombatUid === card.uid) group.classList.add("is-open");
      // In mira, la carta scegliibile si sceglie anche cliccandola: il velo
      // aperto sta sopra la tessera, e il click sul suo fondo (non sul
      // tasto) vale come «Con questa» / «Ferma questo».
      // E nella mira di un effetto la coricata scegliibile si sceglie
      // cliccando il velo, che altrimenti mangiava il click (e la mira
      // leggeva un click a vuoto: rinuncia).
      if (targeting && pickable(card)) {
        const mode = targeting.mode;
        group.addEventListener("click", event => {
          if ((event.target as HTMLElement).closest("button")) return;
          event.stopPropagation();
          if (mode === "effect") {
            const live = ctx.state().cards[card.uid];
            if (live && targeting?.mode === "effect") targeting.pick(live);
          } else {
            confirmBlock(card);
          }
        });
      }
      combatGroups.set(card.uid, group);
      for (const tab of tabs) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `combat-tab is-${tab.kind}`;
        button.textContent = tab.label;
        button.addEventListener("pointerdown", event => event.stopPropagation());
        button.addEventListener("click", event => {
          event.stopPropagation();
          tab.run();
        });
        group.append(button);
      }
      combatLayer.append(group);
    }
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
   * proprio turno, le carte in eccesso vanno scartate» — in Zona di Ritiro
   * (§5, dal 2026-09-10: lo scarto non è una morte). Con l'eccesso in mano
   * lo scarto è l'unico modo di andare in Zona di Ritiro dalla mano, e il
   * gesto resta sempre possibile.
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
    // §6.5 — l'eccesso si scarta alla fine del PROPRIO turno, anche quando
    // la Reazione la chiude il difensore (§6.4): con più di 7 carte la mano
    // di chi è di turno resta aperta, o il turno non passerebbe mai (visto
    // 2026-09-10: pescate in più da effetto, Reazione in mano al bot, e
    // nessuno poteva scartare).
    if (state.active === seat && zoneCards(state, seat, "hand").length > 7) return false;
    return phaseCloser(state) !== seat;
  }

  /**
   * L'invito a scartare: la Zona di Ritiro accesa. Non si accende da sé alla settima
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
    if (targeting.mode === "blocker") {
      // Si cerca l'attaccante: le carte dichiarate in attacco dall'altra metà.
      const blocker = ctx.state().cards[targeting.blocker];
      if (!blocker) return false;
      return controllerOf(card) === otherSeat(controllerOf(blocker)) && declarationOf(ctx.state(), card.uid)?.kind === "attack";
    }
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

  function confirmBlock(chosen: CardInstance): void {
    if (targeting?.mode === "block") {
      const { attacker, kind } = targeting;
      cancelTargeting();
      void declareBlock(ctx, chosen, attacker, kind);
      return;
    }
    if (targeting?.mode === "blocker") {
      const { blocker, kind } = targeting;
      const blockerCard = ctx.state().cards[blocker];
      cancelTargeting();
      if (blockerCard) void declareBlock(ctx, blockerCard, chosen.uid, kind);
    }
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

    // Attaccare, bloccare, contrattaccare e annullare NON passano dal tasto
    // destro: sono i tasti sotto le carte (combatTabsFor), come «Schiera»
    // (deciso 2026-09-09). Qui restano i gesti di lavagna.
    if (card.zone === "field") {
      void mine;
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
    // §3.1 — le abilità speciali e il flip verso il Nexus, con l'arbitro,
    // stanno sul tasto «Abilità» sotto il Rubyfront (openAbilities), non nel
    // menu (deciso 2026-09-08). A tavolo libero il flip resta qui.
    if (faceCount(card.cardId) > 1 && !(ctx.arbitrated() && mine)) {
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
    // §5/§6.5 — con l'arbitro nell'Abisso non si va a mano: ci si va morendo
    // o consumandosi (una Materia in campo). Lo scarto per eccesso va in Zona
    // di Ritiro e ha la sua voce, che dice perché si può. La voce libera
    // resta solo dove l'arbitro la lascerebbe passare.
    if (canDiscard(card)) {
      items.push({
        label: t("menu.discard"),
        run: () =>
          void ctx.dispatch({ t: "toZone", uid: card.uid, zone: "ritiro" }).then(passed => {
            if (!passed) return;
            clearDiscardPrompt(card.owner);
            ctx.log(msg("log.discard", { seat: card.owner, card: card.cardId, n: zoneCards(ctx.state(), card.owner, "hand").length }), card.owner);
            render();
          }),
      });
    } else if (!sealed && (!ctx.arbitrated() || (card.zone === "field" && ctx.card(card.cardId).kind === "matter"))) {
      items.push(send("abisso", t("menu.to.abisso")));
    }
    // Il Ritiro è un gesto del Fronte (§6.2): con l'arbitro, dalla mano ci si
    // va solo scartando per eccesso (la voce sopra) e dal mazzo mai; a
    // engine spento resta libero, da dove sia.
    if (!sealed && !canDiscard(card) && (!ctx.arbitrated() || card.zone === "field")) items.push(send("ritiro", t("menu.to.ritiro")));
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
    // L'Oggetto sul portatore che sconta («gli Oggetti che assegni a questa
    // Entità costano N in meno»): il costo lo dice objectCost, come l'engine.
    if (card.zone === "hand" && facts.kind === "object") cost = objectCost(ctx.state(), ctx.state().cards[card.uid] ?? card, ctx.card);
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
    }
    // Il costo di una Materia con uno sconto (contro la tappata dichiarata,
    // o con le armate sul Fronte): lo dice discountedCost, come l'engine.
    if (card.zone === "hand" && facts.kind === "matter") cost = discountedCost(ctx.state(), card, target, ctx.card);
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
      const disarms = enterDisarms(ctx.state(), live, ctx.card);
      const rearms = enterRearms(live, ctx.card);
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
          ...disarms.map(step => t("trigger.disarm", { card: `«${ctx.card(step.source.cardId).name}»` })),
          ...rearms.map(step => t(step.self ? "trigger.rearm.self" : "trigger.rearm.any", { card: `«${ctx.card(step.source.cardId).name}»` })),
          ...triggers.map(trigger => describeTrigger(trigger, ctx.card)),
        ],
        onContinue:
          moves.length || returns.length || looks.length || controls.length || refreshes.length || disarms.length || rearms.length || triggers.length
            ? () => void playTriggers(live)
            : undefined,
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
   * (la Reattiva bloccante (forma `block`), §6.4) lo sceglie subito: il blocco è la giocata; senza
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

  /** «Poi perdi N PV»: il seguito della distruzione, di chi comanda la fonte. */
  async function loseAfterDestroy(step: ResolveStep, ref: EffectRef, n: number): Promise<void> {
    const by = controllerOf(step.source);
    hold(true);
    await wait(TRIGGER_LEAD_MS);
    const hp = Math.max(0, ctx.state().players[by].hp - n);
    const passed = await ctx.dispatch({ t: "player", seat: by, patch: { hp }, effect: ref });
    if (passed) ctx.log(msg("log.effect.lose", { seat: by, sourceCard: step.source.cardId, n, hp }), by);
    await wait(TRIGGER_TAIL_MS);
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
    // Col bot al tavolo le sue Reattive in catena le risolve questa lavagna,
    // col suo selettore (setAuto): nessun altro client lo farebbe.
    if (!top || top.zone !== "field" || !(ctx.controls(controllerOf(top)) || isAuto(controllerOf(top)))) return;
    chainBusy = top.uid;
    const blocking = state.declarations.some(d => d.from === top.uid && d.kind === "block");
    void resolveMatter(top, enterEffects(top.cardId, top.face, ctx.locale()), blocking).finally(() => {
      chainBusy = null;
      render();
    });
  }

  /** Il posto della carta in catena, nel varco fra i due campi, a scaletta: in coordinate di VISTA. */
  function chainSpot(index: number): { x: number; y: number } {
    const centerX = SURFACE_W / 2;
    return { x: centerX - TILE_W / 2 + index * 44, y: chainRowY() + index * 26 };
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
        case "weaken": {
          const target = await pickTarget(step.source, step.candidates, t("target.refract"));
          if (!target) break;
          hold(true);
          strike(target.uid, FLY_MS);
          await wait(CONFIRMED_LEAD_MS);
          const power = weakenAmount(ctx.state(), by, form, ctx.card);
          const passed = await ctx.dispatch({ t: "empower", uid: target.uid, power, effect: ref });
          if (passed) ctx.log(msg("log.effect.weaken", { seat: by, sourceCard: step.source.cardId, card: target.cardId, n: -power }), by);
          break;
        }
        case "empower": {
          if (form.targets === "own_armed") {
            // «Fino a N»: una scelta per volta, Chiudi per fermarsi prima.
            let left = form.upTo;
            let pool = step.candidates;
            while (left > 0 && pool.length > 0) {
              const target = await pickTarget(step.source, pool, t("target.amplify", { n: left }));
              if (!target) break;
              hold(true);
              strike(target.uid, FLY_MS);
              await wait(CONFIRMED_LEAD_MS);
              const passed = await ctx.dispatch({ t: "empower", uid: target.uid, power: form.power, untap: true, effect: ref });
              if (passed) ctx.log(msg("log.effect.untap", { seat: by, sourceCard: step.source.cardId, card: target.cardId, n: form.power }), by);
              left -= 1;
              pool = pool.filter(other => other.uid !== target.uid);
              await wait(TRIGGER_TAIL_MS);
            }
          } else if (form.targets === "own_entity") {
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
        case "search": {
          const roll = rollDie(form.die);
          await showRoll(root, form.die, roll, t("dice.step", { name, what: t("dice.search") }));
          const live = pendingResolve(ctx.state(), step.source, ctx.card).find(candidate => candidate.form === form) ?? step;
          const looked = live.looked;
          if (looked.length === 0) break;
          const { type, candidates } = searchCandidates(form, looked, roll, ctx.card);
          const what = t(type === "matter" ? "pick.look.matter" : type === "object" ? "pick.look.object" : "pick.look.entity");
          const reveal = candidates.length
            ? await pickFromPile(by, "deck", candidates, t("pick.search.some", { roll, what }), looked)
            : await pickFromPile(by, "deck", [], t("pick.search.none", { roll, what }), looked);
          // Senza mostrata, una delle guardate torna in cima: obbligatoria.
          let top: CardInstance | null = null;
          while (!reveal && !top) top = await pickFromPile(by, "deck", looked, t("pick.search.top"), looked);
          // Poi una delle altre nella Zona di Ritiro: obbligatoria, se restano carte.
          const others = looked.filter(card => card.uid !== reveal?.uid && card.uid !== top?.uid);
          let retire: CardInstance | null = null;
          while (others.length && !retire) retire = await pickFromPile(by, "deck", others, t("pick.retire"), others);
          hold(true);
          await wait(CONFIRMED_LEAD_MS);
          const passed = await ctx.dispatch({
            t: "look", seat: by, count: form.count, roll,
            ...(reveal ? { reveal: reveal.uid } : {}),
            ...(top ? { top: top.uid } : {}),
            ...(retire ? { retire: retire.uid } : {}),
            revealTo: "hand", restTo: "deck", effect: ref,
          });
          if (passed) {
            ctx.log(msg("log.effect.look", { seat: by, sourceCard: step.source.cardId, parts: [
              msg("look.rolled", { die: form.die, roll, n: looked.length }),
              reveal ? msg("look.reveal", { card: reveal.cardId }) : msg("look.noreveal"),
              ...(top ? [msg("look.top", { card: top.cardId })] : []),
              ...(retire ? [msg("look.retire", { card: retire.cardId })] : []),
              msg("look.rest"),
            ] }), by);
          }
          break;
        }
        case "drain": {
          hold(true);
          await wait(TRIGGER_LEAD_MS);
          const foe = otherSeat(by);
          const n = wornObjects(ctx.state(), by);
          const hp = Math.max(0, ctx.state().players[foe].hp - n);
          const passed = await ctx.dispatch({ t: "player", seat: foe, patch: { hp }, effect: ref });
          if (passed) ctx.log(msg("log.effect.drain", { seat: by, otherSeat: foe, sourceCard: step.source.cardId, n, hp }), by);
          await wait(TRIGGER_TAIL_MS);
          break;
        }
        case "move":
        case "exile":
        case "destroy": {
          // La distruzione già passata: resta solo il seguito «poi perdi N PV».
          if (form.kind === "destroy" && form.thenLose !== null && step.candidates.length === 0) {
            await loseAfterDestroy(step, ref, form.thenLose);
            break;
          }
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
            if (form.kind === "destroy" && form.thenLose !== null) await loseAfterDestroy(step, ref, form.thenLose);
          } else {
            fly?.cancel();
            render();
          }
          break;
        }
        case "block": {
          // la Reattiva bloccante (forma `block`) — il blocco è già avvenuto giocandola (§6.4); qui la
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
  async function flipToNexus(card: CardInstance): Promise<boolean> {
    const facts = ctx.card(card.cardId);
    const nexus = facts.nexus;
    if (!nexus) {
      return ctx.dispatch({ t: "flip", uid: card.uid, face: (card.face + 1) % faceCount(card.cardId) });
    }
    const by = controllerOf(card);
    const check = nexusCheck(ctx.state(), card, ctx.card);
    if (!check.ok) {
      ctx.log(msg(check.why, { seat: by, n: check.n ?? 0 }), by);
      return false;
    }
    let discard: CardInstance | null = null;
    if (nexus.discard) {
      while (!discard) discard = await pickFromPile(by, "hand", check.discards, t(nexus.discard.kind === null ? "pick.nexus.discard.any" : "pick.nexus.discard"));
    }
    const passed = await ctx.dispatch({ t: "flip", uid: card.uid, face: nexus.face, ...(discard ? { discard: discard.uid } : {}), ...(nexus.recovery ? { recover: nexus.recovery } : {}) });
    if (!passed) return false;
    const hp = ctx.state().players[by].hp;
    ctx.log(msg("log.flip", { seat: by, card: card.cardId, recover: nexus.recovery ? msg("log.flip.recover", { n: nexus.recovery, hp }) : "" }), by);
    if (discard) ctx.log(msg("log.flip.discard", { seat: by, card: discard.cardId }), by);
    const live = ctx.state().cards[card.uid];
    if (!live) return true;
    const steps = flipSteps(ctx.state(), live, ctx.card);
    if (steps.length === 0) return true;
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
    return true;
  }

  async function playFlipSteps(steps: FlipStep[]): Promise<void> {
    for (const step of steps) {
      const by = controllerOf(step.source);
      hold(true);
      light(step.source.uid, true);
      try {
        await wait(TRIGGER_LEAD_MS);
        if (step.form.kind === "move") {
          // I candidati si rileggono dallo stato vivo, per contenuto della
          // forma: un confronto per riferimento non troverebbe mai nulla.
          for (const target of flipCandidates(ctx.state(), step.source, step.form)) {
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
        } else if (step.form.kind === "draw") {
          const passed = await ctx.dispatch({ t: "draw", seat: by, count: step.form.count, effect: flipRef(step.source) });
          if (passed) ctx.log(msg("log.effect.trigger", { seat: by, card: step.source.cardId, n: step.form.count, cards: msg(step.form.count === 1 ? "cards.one" : "cards.many") }), by);
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

  /** Lo scudo del bloccante (combat-badge), lo stesso tratto delle icone delle tessere. */
  const SHIELD_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3 5 6v6c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6z"/></svg>';

  /** Quanto dura l'andata di una carta in una pila: dissolvenza della
      tessera più corsa della scintilla (i tempi in style.css). */
  const FLY_MS = 1600;
  /** Quando la scintilla tocca la pila (ritardo + corsa, .fly-spark). */
  const SPARK_ARRIVE_MS = 1050;

  /**
   * Dove e come si posa il fantasma di una tessera perché copra ESATTAMENTE
   * la tessera vera. Il fantasma ha l'origine in alto a sinistra e porta il
   * transform in linea, che CANCELLA la rotazione della classe
   * (.tile.is-tapped): la coricata è ruotata di 90° attorno al centro e il
   * suo rettangolo sullo schermo ha larghezza e altezza scambiate, quindi
   * il fantasma si ancora all'angolo in alto a DESTRA del rettangolo, si
   * scala sull'altezza di layout e ruota da lì. Senza, la carta coricata
   * volava (o si dissolveva) in piedi e si ricoricava di colpo all'arrivo.
   */
  function ghostPose(tile: HTMLElement, rect: DOMRect): { x: number; y: number; scale: number; rotate: string } {
    if (tile.classList.contains("is-tapped")) {
      return { x: rect.left + rect.width, y: rect.top, scale: rect.width / tile.offsetHeight, rotate: " rotate(90deg)" };
    }
    return { x: rect.left, y: rect.top, scale: rect.width / tile.offsetWidth, rotate: "" };
  }

  /**
   * La carta va in una pila: un fantasma della tessera, preso PRIMA che lo
   * stato cambi (la tessera vera sparirà nella pila), che si solleva e si
   * DISSOLVE sul posto — luce, sfocatura, via — mentre una scintilla
   * rubino corre fino al riquadro della pila del proprietario, che si
   * accende al suo arrivo. Chi la chiama la prende prima dell'azione e la
   * lascia partire dopo. FLY_MS è la durata dell'insieme (i tempi stanno in
   * style.css: fly-dissolve, .fly-spark, pile-landing).
   */
  /** Quanto dura il taglio sulla carta che muore, prima che si dissolva (style.css, card-slash). */
  const SLASH_MS = 620;

  /**
   * Il segno di un colpo su una tessera (o su un fantasma): una lama che
   * attraversa la carta (`slash`, rubino; `riposte`, oro, in senso
   * contrario) o la parata (`parry`, un anello che si allarga). Un figlio
   * che si toglie da sé a fine corsa.
   */
  function slashMark(el: HTMLElement, kind: "slash" | "riposte" | "parry"): void {
    const mark = document.createElement("span");
    mark.className = `slash-mark is-${kind}`;
    el.append(mark);
    el.classList.add("is-hit");
    window.setTimeout(() => {
      mark.remove();
      el.classList.remove("is-hit");
    }, SLASH_MS + 80);
  }

  function liftForFlight(uid: string, zone: "ritiro" | "abisso" = "ritiro", opts: { slain?: boolean } = {}): Flight | null {
    const tile = tiles.get(uid);
    const live = ctx.state().cards[uid];
    if (!tile || !live || tile.offsetParent === null) return null;
    const from = tile.getBoundingClientRect();
    // La tessera vive dentro la lavagna, che è disegnata in scala: il
    // fantasma sta fuori, in misura di layout, e si scala con la stessa
    // trasformazione — sennò mostrerebbe la carta a misura piena, tagliata.
    const layoutW = tile.offsetWidth;
    const layoutH = tile.offsetHeight;
    const pose = ghostPose(tile, from);
    const ghost = tile.cloneNode(true) as HTMLElement;
    ghost.classList.add("fly-ghost");
    // Sotto le mani e i pannelli (z 30+), sopra la lavagna: il clone porta
    // con sé lo z-index in linea della tessera, che con tante carte supera
    // quello della mano e per un attimo la carta volava DAVANTI al cassetto.
    ghost.style.zIndex = "25";
    ghost.classList.remove("is-pickable", "is-legal", "is-triggering", "is-struck", "is-attacking", "is-blocking", "is-countering", "has-actions", "is-badged");
    ghost.querySelector(".combat-badge")?.remove();
    ghost.style.position = "fixed";
    ghost.style.left = `${pose.x}px`;
    ghost.style.top = `${pose.y}px`;
    ghost.style.width = `${layoutW}px`;
    ghost.style.height = `${layoutH}px`;
    ghost.style.margin = "0";
    ghost.style.transform = `scale(${pose.scale})${pose.rotate}`;
    // La dissolvenza (fly-dissolve) rifà il transform: scala e rotazione le legge da qui.
    ghost.style.setProperty("--fly-scale", String(pose.scale));
    ghost.style.setProperty("--fly-rot", pose.rotate ? "90deg" : "0deg");
    document.body.append(ghost);
    // Chi muore in battaglia (§6.3) prima viene tagliata — la lama, il
    // sussulto — e solo dopo si dissolve: la dissolvenza e la scintilla
    // aspettano il taglio (deciso 2026-09-10: «non che sparisca così
    // violentemente»).
    const delay = opts.slain ? SLASH_MS : 0;
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
      // La scintilla: parte dal cuore della carta e corre al centro della
      // pila (o della testata del pannello), poi si spegne.
      const spark = document.createElement("span");
      spark.className = "fly-spark";
      spark.style.left = `${from.left + from.width / 2}px`;
      spark.style.top = `${from.top + from.height / 2}px`;
      document.body.append(spark);
      if (opts.slain) slashMark(ghost, "slash");
      // Un frame dopo (o dopo il taglio), così le transizioni partono dalla posizione di ora.
      window.setTimeout(() => requestAnimationFrame(() => {
        ghost.classList.add("is-dissolving");
        const dx = target.left + target.width / 2 - (from.left + from.width / 2);
        const dy = target.top + target.height / 2 - (from.top + from.height / 2);
        spark.style.transform = `translate(${dx}px, ${dy}px) rotate(45deg)`;
        spark.classList.add("is-flying");
      }), delay);
      // All'arrivo la pila si accende (il riquadro vero, non la testata).
      if (!docked && slot) {
        window.setTimeout(() => {
          slot.classList.add("pile-landing");
          window.setTimeout(() => slot.classList.remove("pile-landing"), 700);
        }, delay + SPARK_ARRIVE_MS);
      }
      window.setTimeout(() => {
        ghost.remove();
        spark.remove();
      }, delay + FLY_MS + 60);
    }) as Flight;
    // Il «no» dell'arbitro: la carta non parte, e il fantasma — che è
    // già sul tavolo, sopra la tessera vera — deve sparire, o resta lì
    // come un doppione della carta (la scintilla non è ancora nata: nasce
    // solo se il volo parte).
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
    // Come in liftForFlight: misura di layout, scala della lavagna (e la
    // coricata arriva già coricata, ghostPose).
    const layoutW = tile.offsetWidth;
    const layoutH = tile.offsetHeight;
    const pose = ghostPose(tile, to);
    const ghost = tile.cloneNode(true) as HTMLElement;
    ghost.classList.add("fly-ghost");
    // Sotto le mani e i pannelli (z 30+), sopra la lavagna: il clone porta
    // con sé lo z-index in linea della tessera, che con tante carte supera
    // quello della mano e per un attimo la carta volava DAVANTI al cassetto.
    ghost.style.zIndex = "25";
    ghost.classList.remove("is-pickable", "is-legal", "is-triggering", "is-struck", "is-attacking", "is-blocking", "is-countering", "has-actions", "is-badged");
    ghost.querySelector(".combat-badge")?.remove();
    ghost.style.position = "fixed";
    ghost.style.left = `${pose.x}px`;
    ghost.style.top = `${pose.y}px`;
    ghost.style.width = `${layoutW}px`;
    ghost.style.height = `${layoutH}px`;
    ghost.style.margin = "0";
    ghost.style.transition = "none";
    ghost.style.transform = `translate(${from.left - pose.x}px, ${from.top - pose.y}px) scale(${from.width / layoutW})${pose.rotate}`;
    ghost.style.opacity = "0.4";
    document.body.append(ghost);
    // La tessera vera si nasconde finché il fantasma non è arrivato.
    tile.style.visibility = "hidden";
    requestAnimationFrame(() => {
      ghost.style.transition = "";
      ghost.style.transform = `scale(${pose.scale})${pose.rotate}`;
      ghost.style.opacity = "1";
    });
    window.setTimeout(() => {
      ghost.remove();
      tile.style.visibility = "";
    }, FLY_MS + 60);
  }

  const pause = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));

  /** L'ingresso di un Rubyfront: arrivo dal lato, posa al centro, accensione,
      volo al suo posto (style.css: .intro-card, .intro-veil). */
  async function introOne(seat: Seat, card: CardInstance): Promise<void> {
    const tile = tiles.get(card.uid);
    if (!tile) return;
    const mine = seat === ctx.seat();
    const scale = Math.min(0.92, (window.innerHeight - 160) / CARD_H, (window.innerWidth - 200) / CARD_W);
    const w = CARD_W * scale;
    const h = CARD_H * scale;
    const cx = (window.innerWidth - w) / 2;
    const cy = (window.innerHeight - h) / 2;
    const ghost = document.createElement("div");
    ghost.className = "intro-card";
    ghost.dataset.tint = ctx.tintFor(seat);
    ghost.style.width = `${CARD_W}px`;
    ghost.style.height = `${CARD_H}px`;
    const holder = renderFace(card.cardId, 0, ctx.themeFor(seat), ctx.locale());
    if (holder) {
      holder.style.width = `${CARD_W}px`;
      holder.style.height = `${CARD_H}px`;
      ghost.append(holder);
      // L'illustrazione arriva dalla rete: si aspetta che sia pronta (al più
      // un secondo e mezzo), o la carta entrerebbe con la finestra vuota.
      const images = [...holder.querySelectorAll("img")];
      await Promise.race([
        Promise.all(images.map(img => (img.complete ? Promise.resolve() : new Promise<void>(done => { img.onload = () => done(); img.onerror = () => done(); })))),
        pause(1500),
      ]);
    }
    // Il tuo arriva da sinistra, dal basso; l'avversario da destra, dall'alto.
    const x0 = mine ? -w - 120 : window.innerWidth + 120;
    const y0 = cy + (mine ? 220 : -220);
    const rot = mine ? -16 : 16;
    ghost.style.transform = `translate(${x0}px, ${y0}px) rotate(${rot}deg) scale(${scale})`;
    ghost.style.opacity = "0";
    document.body.append(ghost);
    if (holder) fitTexts(holder);
    void ghost.offsetWidth;
    ghost.classList.add("is-arriving");
    ghost.style.transform = `translate(${cx}px, ${cy}px) rotate(0deg) scale(${scale})`;
    ghost.style.opacity = "1";
    // L'ingresso del Rubyfront è muto (deciso 2026-09-11): né i suoni delle
    // carte né suoni suoi.
    await pause(950);
    // Si accende.
    ghost.classList.add("is-lit");
    await pause(1250);
    // Vola al suo posto in Zona di Richiamo e ci si posa.
    const to = tile.getBoundingClientRect();
    ghost.classList.remove("is-arriving");
    ghost.classList.add("is-landing");
    void ghost.offsetWidth;
    ghost.style.transform = `translate(${to.left}px, ${to.top}px) rotate(0deg) scale(${to.width / CARD_W})`;
    await pause(780);
    tile.style.visibility = "";
    tile.classList.add("intro-landed");
    // Il riquadro del posto (mirino e tasto Schiera) si scopre con la carta.
    rubySlots.get(seat)?.classList.add("is-landed");
    window.setTimeout(() => tile.classList.remove("intro-landed"), 900);
    ghost.remove();
    await pause(350);
  }

  async function introRubyfronts(order: Seat[]): Promise<void> {
    const entries = order
      .map(seat => ({ seat, card: waitingRubyfront(seat) }))
      .filter((entry): entry is { seat: Seat; card: CardInstance } => entry.card !== undefined);
    if (entries.length === 0) return;
    document.body.classList.add("is-intro");
    const veil = document.createElement("div");
    veil.className = "intro-veil";
    document.body.append(veil);
    // Le tessere vere aspettano nascoste: entrano col volo. Fin qui le ha
    // tenute nascoste body.is-intro-wait (main.ts), da quando sono nate.
    for (const entry of entries) {
      const tile = tiles.get(entry.card.uid);
      if (tile) tile.style.visibility = "hidden";
    }
    document.body.classList.remove("is-intro-wait");
    try {
      await pause(300);
      for (const entry of entries) await introOne(entry.seat, entry.card);
    } finally {
      for (const entry of entries) {
        const tile = tiles.get(entry.card.uid);
        if (tile) tile.style.visibility = "";
      }
      veil.classList.add("is-leaving");
      window.setTimeout(() => veil.remove(), 350);
      document.body.classList.remove("is-intro");
      for (const slot of rubySlots.values()) slot.classList.remove("is-landed");
    }
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
  /**
   * Il volo di una carta da dov'è a dove sarà (il controllo, §8.2): si
   * prende la tessera PRIMA che lo stato cambi, e a stato cambiato il
   * fantasma parte dal posto vecchio verso il nuovo. Gli Oggetti addosso
   * volano con lei (deciso 2026-09-11), sotto, a scaletta com'erano.
   */
  function liftToFlight(uid: string): Flight | null {
    // Prima gli Oggetti, poi l'Entità: i fantasmi si appendono in quest'ordine
    // e l'Entità resta sopra la sua pila.
    const group = [...wornBy(ctx.state(), uid).map(object => object.uid), uid];
    const starts = group.flatMap(member => {
      const tile = tiles.get(member);
      if (!tile || tile.offsetParent === null) return [];
      const from = tile.getBoundingClientRect();
      return [{ member, from: ghostPose(tile, from), layoutW: tile.offsetWidth, layoutH: tile.offsetHeight }];
    });
    if (!starts.some(start => start.member === uid)) return null;
    const flight = (() => {
      for (const { member, from, layoutW, layoutH } of starts) {
        const landed = tiles.get(member);
        if (!landed || landed.offsetParent === null) continue;
        // La coricata vola coricata: posa e rotazione dal fantasma (ghostPose).
        const to = ghostPose(landed, landed.getBoundingClientRect());
        const ghost = landed.cloneNode(true) as HTMLElement;
        ghost.classList.add("fly-ghost");
    // Sotto le mani e i pannelli (z 30+), sopra la lavagna: il clone porta
    // con sé lo z-index in linea della tessera, che con tante carte supera
    // quello della mano e per un attimo la carta volava DAVANTI al cassetto.
    ghost.style.zIndex = "25";
        ghost.classList.remove("is-pickable", "is-legal", "is-triggering", "is-struck", "is-attacking", "is-blocking", "is-countering", "has-actions", "is-badged");
        ghost.querySelector(".combat-badge")?.remove();
        ghost.style.position = "fixed";
        ghost.style.left = `${to.x}px`;
        ghost.style.top = `${to.y}px`;
        ghost.style.width = `${layoutW}px`;
        ghost.style.height = `${layoutH}px`;
        ghost.style.margin = "0";
        ghost.style.visibility = "";
        ghost.style.transition = "none";
        ghost.style.transform = `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.scale})${to.rotate}`;
        document.body.append(ghost);
        landed.style.visibility = "hidden";
        requestAnimationFrame(() => {
          ghost.style.transition = "";
          ghost.style.transform = `scale(${to.scale})${to.rotate}`;
        });
        window.setTimeout(() => {
          ghost.remove();
          landed.style.visibility = "";
        }, FLY_MS + 60);
      }
    }) as Flight;
    // Niente da annullare: i fantasmi nascono solo al via.
    flight.cancel = () => undefined;
    return flight;
  }

  /**
   * Il controllo che APRE la fila di servizio avversaria (rincasso, §8.2):
   * niente volo attraverso il tavolo che si sta allargando — la carta (con
   * gli Oggetti addosso) si DISSOLVE dov'è, come per l'Abisso, la fila si
   * apre, e la scintilla rubino corre allo slot Controllo dove la carta
   * ricompare accendendosi (deciso 2026-09-11). Si prende PRIMA che lo
   * stato cambi; il via parte dopo, e aspetta la corsa della fila.
   */
  function liftToDissolve(uid: string): Flight | null {
    const group = [...wornBy(ctx.state(), uid).map(object => object.uid), uid];
    const ghosts: HTMLElement[] = [];
    let heart: DOMRect | null = null;
    for (const member of group) {
      const tile = tiles.get(member);
      if (!tile || tile.offsetParent === null) continue;
      const from = tile.getBoundingClientRect();
      if (member === uid) heart = from;
      const layoutW = tile.offsetWidth;
      const pose = ghostPose(tile, from);
      const ghost = tile.cloneNode(true) as HTMLElement;
      ghost.classList.add("fly-ghost");
      ghost.style.zIndex = "25";
      ghost.classList.remove("is-pickable", "is-legal", "is-triggering", "is-struck", "is-attacking", "is-blocking", "is-countering", "has-actions", "is-badged");
      ghost.querySelector(".combat-badge")?.remove();
      ghost.style.position = "fixed";
      ghost.style.left = `${pose.x}px`;
      ghost.style.top = `${pose.y}px`;
      ghost.style.width = `${layoutW}px`;
      ghost.style.height = `${tile.offsetHeight}px`;
      ghost.style.margin = "0";
      ghost.style.transform = `scale(${pose.scale})${pose.rotate}`;
      ghost.style.setProperty("--fly-scale", String(pose.scale));
      ghost.style.setProperty("--fly-rot", pose.rotate ? "90deg" : "0deg");
      document.body.append(ghost);
      ghosts.push(ghost);
    }
    if (!heart) {
      ghosts.forEach(ghost => ghost.remove());
      return null;
    }
    const from = heart;
    const flight = (() => {
      // Le tessere vere, appena posate nello slot, aspettano nascoste la scintilla.
      for (const member of group) {
        const tile = tiles.get(member);
        if (tile) tile.style.visibility = "hidden";
      }
      const spark = document.createElement("span");
      spark.className = "fly-spark";
      spark.style.left = `${from.left + from.width / 2}px`;
      spark.style.top = `${from.top + from.height / 2}px`;
      document.body.append(spark);
      requestAnimationFrame(() => ghosts.forEach(ghost => ghost.classList.add("is-dissolving")));
      // La fila si è aperta (morphZones, MORPH_MS) e il tavolo è ridisegnato:
      // solo ora si sa dove sta lo slot, e la scintilla ci corre.
      window.setTimeout(() => {
        const landed = tiles.get(uid);
        const to = landed && landed.offsetParent !== null ? landed.getBoundingClientRect() : null;
        if (to) {
          requestAnimationFrame(() => {
            spark.style.transform = `translate(${to.left + to.width / 2 - (from.left + from.width / 2)}px, ${to.top + to.height / 2 - (from.top + from.height / 2)}px) rotate(45deg)`;
            spark.classList.add("is-flying");
          });
        }
        // All'arrivo la carta ricompare, accendendosi.
        window.setTimeout(() => {
          for (const member of group) {
            const tile = tiles.get(member);
            if (!tile) continue;
            tile.style.visibility = "";
            tile.classList.add("is-materializing");
            window.setTimeout(() => tile.classList.remove("is-materializing"), 900);
          }
          spark.remove();
        }, to ? SPARK_ARRIVE_MS : 0);
      }, MORPH_MS + 140);
      window.setTimeout(() => ghosts.forEach(ghost => ghost.remove()), FLY_MS + 60);
    }) as Flight;
    flight.cancel = () => ghosts.forEach(ghost => ghost.remove());
    return flight;
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
      // Se il controllo apre la fila di servizio avversaria (rincasso),
      // niente volo: dissolvenza, fila che si apre, scintilla e ricomparsa.
      const opens = isRecessView() && by !== ctx.seat() && !hasFoeBackRow();
      const fly = opens ? liftToDissolve(target.uid) : liftToFlight(target.uid);
      passed = await resolveControl(ctx, step, target);
      strike(target.uid, 0);
      if (passed) {
        fly?.();
        await wait(opens ? MORPH_MS + 140 + SPARK_ARRIVE_MS + 300 : FLY_MS);
      } else {
        fly?.cancel();
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
  async function useAbility(card: CardInstance, ability: Ability): Promise<boolean> {
    const by = controllerOf(card);
    const copy = abilityCopy(card.cardId, ability.face, ability.displayKey, ctx.locale());
    const price = ability.cost !== null ? t("ability.cost", { n: ability.cost }) : t("ability.gain", { n: ability.gain ?? 0 });
    const form = ability.form;
    if (!form) return false;
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
          if (!go) return false;
          targets = [];
        } else {
          light(card.uid, true);
          const chosen = await pickTarget(card, candidates, t("target.ability.power", { n: form.amount }));
          light(card.uid, false);
          if (!chosen) return false;
          targets = [chosen.uid];
        }
      } else {
        if (candidates.length === 0) {
          const go = await confirmFor(by, t("confirm.ability.notargets", { name: copy.name, price }));
          if (!go) return false;
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
      return passed;
    }
    // Lo sguardo nel mazzo: le prime N, con la vetrina degli ingressi.
    const live = ctx.state().cards[card.uid];
    if (!live) return true;
    const step = lookAfterRoll(ctx.state(), live, { count: form.count, die: null, countBase: 0, reveal: form.reveal, thenRetire: false }, null, ctx.card);
    await playLook(step, { source: live.uid, event: "on_ability", entering: live.uid, ability: ability.id });
    return true;
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

  /**
   * Il disarmo all'ingresso (§8.2, dal 2026-09-10): nessuna scelta — ogni
   * Oggetto assegnato a un'Entità avversaria vola nella Zona di Ritiro del
   * suo proprietario, uno dopo l'altro, con la fonte accesa.
   */
  async function playDisarm(step: EnterDisarmStep): Promise<void> {
    if (step.candidates.length === 0) {
      ctx.log(msg("log.no.target", { seat: step.source.owner, card: step.source.cardId }), step.source.owner);
      return;
    }
    light(step.source.uid, true);
    hold(true);
    try {
      await wait(CONFIRMED_LEAD_MS);
      for (const object of step.candidates) {
        const live = ctx.state().cards[object.uid];
        if (!live || live.zone !== "field") continue;
        strike(object.uid, 60_000);
        const fly = liftForFlight(object.uid, step.to);
        const passed = await resolveDisarm(ctx, step, live);
        strike(object.uid, 0);
        if (passed) {
          fly?.();
          await wait(FLY_MS);
        } else {
          fly?.cancel();
          render();
        }
      }
      await wait(TRIGGER_TAIL_MS);
    } finally {
      light(step.source.uid, false);
      hold(false);
    }
  }

  /**
   * Il riarmo all'ingresso (§8.2, dal 2026-09-10): a giri — un Oggetto dalla
   * propria Zona di Ritiro, poi l'Entità che lo riceve — finché ci sono
   * Oggetti ed Entità, o finché si chiude la pila.
   */
  async function playRearm(step: EnterRearmStep): Promise<void> {
    const by = controllerOf(step.source);
    light(step.source.uid, true);
    try {
      for (;;) {
        const { objects, bearers } = rearmChoices(ctx.state(), step.source, ctx.card, step.self);
        if (objects.length === 0 || bearers.length === 0) break;
        const object = await pickFromPile(by, "ritiro", objects, t(step.self ? "pick.rearm.self" : "pick.rearm.any"));
        if (!object) break;
        // Su di sé non c'è da mirare: l'Oggetto va addosso a chi entra.
        const bearer = step.self ? bearers[0] : await pickTarget(step.source, bearers, t("target.rearm"));
        if (!bearer) break;
        hold(true);
        try {
          const passed = await resolveRearm(ctx, step, object, bearer);
          if (passed) {
            flyFromPile(by, "ritiro", object.uid);
            await wait(FLY_MS);
          }
        } finally {
          hold(false);
        }
        if (step.self) break;
        // Il bot riarma una volta per Entità e basta: il suo selettore non chiude mai la pila.
        if (isAuto(by) && rearmChoices(ctx.state(), step.source, ctx.card).bearers.every(entity => wornBy(ctx.state(), entity.uid).length > 0)) break;
      }
    } finally {
      light(step.source.uid, false);
    }
  }

  /**
   * Il ritorno vincolato (§8.2, dal 2026-09-10): la carta è appena finita
   * nell'Abisso o in Ritiro senza Oggetti addosso; il proprietario sceglie
   * dalla sua Zona di Ritiro l'Oggetto da assegnarle — o chiude la pila e
   * la lascia dov'è. Il Fronte pieno e la pila senza Oggetti adatti si
   * dicono in chat.
   */
  async function playLeaveReturn(step: LeaveReturnStep): Promise<void> {
    const seat = step.card.owner;
    if (step.frontFull) {
      ctx.log(msg("log.revive.frontfull", { seat, card: step.card.cardId }), seat);
      return;
    }
    if (step.candidates.length === 0) {
      ctx.log(msg("log.revive.noobject", { seat, card: step.card.cardId }), seat);
      return;
    }
    const object = await pickFromPile(seat, "ritiro", step.candidates, t("pick.revive", { card: `«${ctx.card(step.card.cardId).name}»` }));
    if (!object) return;
    const spot = freeFrontSlotOrNull(ctx.state(), seat);
    if (!spot) {
      ctx.log(msg("log.revive.frontfull", { seat, card: step.card.cardId }), seat);
      return;
    }
    hold(true);
    try {
      await wait(CONFIRMED_LEAD_MS);
      const passed = await resolveLeaveReturn(ctx, step, object, spot);
      if (passed) {
        flyFromPile(seat, step.card.zone, step.card.uid);
        flyFromPile(seat, "ritiro", object.uid);
        await wait(FLY_MS + TRIGGER_TAIL_MS);
      }
    } finally {
      hold(false);
    }
  }

  /**
   * §3.1/§8.2 — «quando assegni questa carta a un'Entità»: la scena
   * dell'Oggetto appena assegnato, con l'esilio condizionato — si mira
   * un'Entità avversaria, si conferma, e va nell'Abisso tenuta dall'Oggetto
   * (heldBy: torna quando l'Oggetto lascia il gioco, come per la Materia).
   */
  async function playAssignStep(step: AssignStep): Promise<void> {
    const by = controllerOf(step.source);
    // La giocata dalla mano annuncia la sua scena («gioca …») subito dopo
    // che l'azione è passata: questa viene dopo, non sopra.
    await new Promise(resolve => setTimeout(resolve, 0));
    await sceneIdle();
    const candidates = step.form.kind === "exile" ? assignCandidates(ctx.state(), step, ctx.card) : [];
    if (step.form.kind === "exile" && candidates.length === 0) {
      ctx.log(msg("log.no.target", { seat: by, card: step.source.cardId }), by);
      return;
    }
    await showEnterEffect(root, {
      cardId: step.source.cardId,
      face: step.source.face,
      theme: ctx.themeFor(step.source.owner),
      locale: ctx.locale(),
      who: t("scene.assigns", { name: seatLabel(ctx.state(), by), card: `«${cardName(step.object.cardId, ctx.locale())}»`, toCard: `«${cardName(step.bearer.cardId, ctx.locale())}»` }),
      effects: enterEffects(step.source.cardId, step.source.face, ctx.locale()),
      triggers: [describeAssignStep(step, ctx.card)],
      kicker: t("scene.resolve.matter"),
      onContinue: () => undefined,
    });
    light(step.source.uid, true);
    try {
      if (step.form.kind === "draw") {
        hold(true);
        await wait(TRIGGER_LEAD_MS);
        const passed = await ctx.dispatch({ t: "draw", seat: by, count: step.form.count, effect: assignRef(step) });
        if (passed) ctx.log(msg("log.effect.trigger", { seat: by, card: step.source.cardId, n: step.form.count, cards: msg(step.form.count === 1 ? "cards.one" : "cards.many") }), by);
        await wait(TRIGGER_TAIL_MS);
        return;
      }
      if (step.form.kind === "ends") {
        await playEnds(step, step.form);
        return;
      }
      const target = await pickTarget(step.source, candidates, t("target.confine"));
      if (!target) return;
      strike(target.uid, 60_000);
      const sure = await confirmFor(by, t("confirm.confine", { card: `«${ctx.card(target.cardId).name}»` }));
      if (!sure) {
        strike(target.uid, 0);
        render();
        return;
      }
      hold(true);
      await wait(CONFIRMED_LEAD_MS);
      const fly = liftForFlight(target.uid, "abisso");
      const passed = await ctx.dispatch({ t: "toZone", uid: target.uid, zone: "abisso", heldBy: step.source.uid, effect: assignRef(step) });
      strike(target.uid, 0);
      if (passed) {
        fly?.();
        ctx.log(msg("log.effect.exile", { seat: by, sourceCard: step.source.cardId, card: target.cardId }), by);
        await wait(FLY_MS);
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
   * §3.1 — il Rubyfront/Nexus «la prima volta in ogni tuo turno che assegni
   * un Oggetto»: la prima e l'ultima carta del mazzo in vista; sul Rubyfront
   * si possono scambiare (e poi si pesca e si scarta), sul Nexus una va in
   * mano e l'altra nella Zona di Ritiro.
   */
  async function playEnds(step: AssignStep, form: Extract<AssignForm, { kind: "ends" }>): Promise<void> {
    const by = controllerOf(step.source);
    const ref = assignRef(step);
    const ends = deckEnds(ctx.state(), by);
    if (!ends) {
      ctx.log(msg("log.look.empty", { seat: by, card: step.source.cardId }), by);
      return;
    }
    const pair = ends.top.uid === ends.bottom.uid ? [ends.top] : [ends.top, ends.bottom];
    if ("swap" in form) {
      // Scegliere una delle due vale «scambiale»; Chiudi le lascia.
      const chosen = pair.length === 2 ? await pickFromPile(by, "deck", pair, t("pick.ends.swap"), pair) : null;
      hold(true);
      await wait(CONFIRMED_LEAD_MS);
      const passed = await ctx.dispatch({ t: "ends", seat: by, ...(chosen ? { swap: true as const } : {}), effect: ref });
      if (!passed) return;
      ctx.log(msg(chosen ? "log.effect.ends.swap" : "log.effect.ends.kept", { seat: by, sourceCard: step.source.cardId }), by);
      await wait(TRIGGER_TAIL_MS);
      // «Poi pesca una carta e scarta una carta».
      if (form.thenDraw > 0) {
        const drew = await ctx.dispatch({ t: "draw", seat: by, count: form.thenDraw, effect: { ...ref, follow: "draw" } });
        if (!drew) return;
        ctx.log(msg("log.effect.trigger", { seat: by, card: step.source.cardId, n: form.thenDraw, cards: msg(form.thenDraw === 1 ? "cards.one" : "cards.many") }), by);
        await wait(TRIGGER_TAIL_MS);
      }
      for (let left = form.thenDiscard; left > 0; left -= 1) {
        const hand = zoneCards(ctx.state(), by, "hand");
        if (hand.length === 0) break;
        let chosen: CardInstance | null = null;
        while (!chosen) chosen = await pickFromPile(by, "hand", hand, t("pick.discard"));
        const fly = liftForFlight(chosen.uid, "ritiro");
        const discarded = await ctx.dispatch({ t: "toZone", uid: chosen.uid, zone: "ritiro", effect: { ...ref, follow: "discard" } });
        if (discarded) {
          fly?.();
          ctx.log(msg("log.effect.discard", { seat: by, sourceCard: step.source.cardId, card: chosen.cardId }), by);
        } else {
          fly?.cancel();
          break;
        }
      }
      return;
    }
    // Il Nexus: una in mano, l'altra in Ritiro — la scelta è obbligatoria.
    let chosen: CardInstance | null = null;
    while (!chosen) chosen = await pickFromPile(by, "deck", pair, t("pick.ends.hand"), pair);
    const other = pair.find(card => card.uid !== chosen?.uid);
    hold(true);
    await wait(CONFIRMED_LEAD_MS);
    const passed = await ctx.dispatch({ t: "ends", seat: by, toHand: chosen.uid, ...(other ? { toRetire: other.uid } : {}), effect: ref });
    if (passed) ctx.log(msg("log.effect.ends.pick", { seat: by, sourceCard: step.source.cardId, card: chosen.cardId, ...(other ? { otherCard: other.cardId } : {}) }), by);
    await wait(TRIGGER_TAIL_MS);
  }

  /**
   * §5/§8.2 — «quando quell'Entità muore, metti questo Oggetto nella tua
   * Zona di Ritiro invece che nell'Abisso. Poi puoi assegnare un altro
   * Oggetto dalla tua Zona di Ritiro, senza pagarne il costo, a un'Entità
   * senza Oggetto che controlli»: l'Oggetto vola dall'Abisso al Ritiro, poi
   * la scelta dell'altro Oggetto e del portatore — Chiudi per nessuno.
   */
  async function playRemainStep(step: DeathStep): Promise<void> {
    const by = step.object.owner;
    await new Promise(resolve => setTimeout(resolve, 0));
    await sceneIdle();
    await showEnterEffect(root, {
      cardId: step.object.cardId,
      face: step.object.face,
      theme: ctx.themeFor(step.object.owner),
      locale: ctx.locale(),
      who: t("scene.dies", { name: seatLabel(ctx.state(), by), card: `«${cardName(step.bearer.cardId, ctx.locale())}»`, object: `«${cardName(step.object.cardId, ctx.locale())}»` }),
      effects: enterEffects(step.object.cardId, step.object.face, ctx.locale()),
      triggers: [describeDeathStep(step, ctx.card)],
      kicker: t("scene.resolve.matter"),
      onContinue: () => undefined,
    });
    hold(true);
    try {
      await wait(CONFIRMED_LEAD_MS);
      const passed = await ctx.dispatch({ t: "remain", uid: step.object.uid, effect: deathRef(step) });
      if (!passed) return;
      flyFromPile(by, "abisso", step.object.uid);
      ctx.log(msg("log.effect.remain", { seat: by, card: step.object.cardId }), by);
      await wait(FLY_MS + TRIGGER_TAIL_MS);
      const { objects, bearers } = rearmAfterDeath(ctx.state(), step, ctx.card);
      if (objects.length === 0 || bearers.length === 0) return;
      const object = await pickFromPile(by, "ritiro", objects, t("pick.remain.rearm"));
      if (!object) return;
      const bearer = await pickTarget(object, bearers, t("target.remain.bearer"));
      if (!bearer) return;
      const live = ctx.state().cards[bearer.uid] ?? bearer;
      const worn = Object.values(ctx.state().cards).filter(other => other.assignedTo === live.uid && other.zone === "field");
      const rearmed = await ctx.dispatch({
        t: "toZone", uid: object.uid, zone: "field",
        x: live.x + STACK_STEP * (worn.length + 1), y: live.y + STACK_STEP * (worn.length + 1), z: underStack(live, worn),
        assignTo: live.uid, effect: deathRef(step, "rearm"),
      });
      if (rearmed) {
        flyFromPile(by, "ritiro", object.uid);
        ctx.log(msg("log.effect.rearm", { seat: by, sourceCard: step.object.cardId, card: object.cardId, toCard: live.cardId }), by);
        await wait(FLY_MS);
      }
    } finally {
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
    for (const step of enterDisarms(ctx.state(), entering, ctx.card)) {
      await playDisarm(step);
    }
    for (const step of enterRearms(entering, ctx.card)) {
      await playRearm(step);
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
    const discarding = drop.zone === "ritiro" && canDiscard(card);
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
          // Una carta coi tasti di combattimento: il tocco apre il velo.
          if (combatGroups.has(card.uid)) {
            openCombatGroup(card.uid);
            return;
          }
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
    // I temi e l'ingresso a inizio partita (body.is-intro-wait) riconoscono
    // il Rubyfront dalla classe.
    tile.classList.toggle("is-rubyfront", isRubyfront(card.cardId));
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
      } else if (targeting.mode === "blocker") {
        // Dal bloccante scelto al dito: si cerca chi fermare.
        const blocker = state.cards[targeting.blocker];
        if (blocker) arrows.push({ kind: targeting.kind, from: boxOf(blocker), to: { ...targeting.pointer, w: 0, h: 0 }, pending: true });
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
    tile.classList.toggle("is-legal", canPick && (targeting?.mode === "effect" || targeting?.mode === "blocker" || looksPlayable(card)));
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
    // Il numero d'ondata sull'attaccante; sul bloccante lo scudo (disegnato:
    // il glifo ⛨ del font usciva come un quadrato nero sul tema chiaro).
    if (declaration.kind === "attack") badge.textContent = String(declaration.order);
    else badge.innerHTML = SHIELD_SVG;
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
        // La stessa icona della parola chiave stampata (deciso 2026-09-10):
        // il nome per esteso sta nel suggerimento.
        const what = t(`grant.${keyword}`);
        const how = untilEnd.includes(keyword) ? "tile.grant.turn" : "tile.grant.assigned";
        const icon = keywordIcon(keyword);
        marks.push({ key: `grant:${keyword}`, cls: `grant-mark is-${keyword}`, icon: icon ?? "", text: icon ? "" : what, title: t(how, { what }) });
      }
      // Il Contrattacco in più: concesso fino a fine turno, o statico dagli
      // Oggetti addosso (§6.3, §8.2).
      const counterExtra = (card.counterBonus ?? 0) + staticCounter(state, card, ctx.card);
      if (counterExtra > 0) {
        marks.push({ key: "counter", cls: "counter-mark", icon: COUNTER_SVG, text: `+${counterExtra}`, title: card.counterBonus ? t("tile.counter.turn", { n: card.counterBonus }) : t("tile.counter.objects", { n: counterExtra }) });
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
  /** Le tessere da far scivolare a fine disegno (finishMorph): dov'erano prima della ricostruzione. */
  let morphTiles: Map<string, { left: number; top: number }> | null = null;

  function morphZones(rebuild: () => void): void {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      rebuild();
      return;
    }
    // Dov'era ciascun pezzo prima: riquadri (top, altezza), tessere
    // (left, top) e la scala del tavolo.
    const before = new Map<string, { top: string; height: string }>();
    for (const el of surface.querySelectorAll<HTMLElement>(".half, .slot, .pile-dock")) {
      if (el.parentElement !== surface) continue;
      before.set(zoneKey(el), { top: el.style.top, height: el.style.height });
    }
    morphTiles = new Map();
    for (const [uid, tile] of tiles) {
      if (tile.parentElement !== surface) continue;
      morphTiles.set(uid, { left: parseFloat(tile.style.left) || 0, top: parseFloat(tile.style.top) || 0 });
    }
    const scaleBefore = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--card-scale")) || 1;
    rebuild();
    // La scala: salta al valore nuovo (fitScale, dentro rebuild) e la
    // superficie parte da quella vecchia in linea, poi la transizione sul
    // transform la porta a zero — sul compositore, senza rimpaginare.
    surface.style.transform = `scale(${scaleBefore})`;
    void surface.offsetWidth;
    surface.classList.add("is-morphing");
    surface.style.transform = "";
    // I riquadri: al posto nuovo subito, spostati indietro dello scarto
    // (--my), e la transizione li riporta a zero. L'altezza dei campi va in
    // transizione da sé (due riquadri).
    for (const el of surface.querySelectorAll<HTMLElement>(".half, .slot, .pile-dock")) {
      if (el.parentElement !== surface) continue;
      const old = before.get(zoneKey(el));
      if (!old || !old.top) {
        el.classList.add("is-arriving");
        continue;
      }
      const oldTop = parseFloat(old.top);
      const newTop = parseFloat(el.style.top);
      const next = el.style.height;
      if (Number.isFinite(oldTop) && Number.isFinite(newTop)) el.style.setProperty("--my", `${oldTop - newTop}px`);
      if (el.classList.contains("half")) el.style.height = old.height;
      // La classe porta il transform: si mette a transizione spenta, così
      // parte dallo scarto e non da zero.
      el.style.transition = "none";
      el.classList.add("is-morphing");
      void el.offsetHeight;
      el.style.transition = "";
      el.style.setProperty("--my", "0px");
      if (el.classList.contains("half")) el.style.height = next;
    }
    window.setTimeout(() => {
      surface.classList.remove("is-morphing");
      for (const el of surface.querySelectorAll<HTMLElement>(".is-morphing, .is-arriving")) {
        el.classList.remove("is-morphing", "is-arriving");
        el.style.removeProperty("--my");
      }
      for (const tile of tiles.values()) {
        tile.classList.remove("is-morphing");
        tile.style.removeProperty("--mx");
        tile.style.removeProperty("--my");
      }
      render();
    }, MORPH_MS + 40);
  }

  /**
   * La coda del morph, a tessere già posate dal disegno (render): ognuna
   * si sposta indietro di quanto è cambiata la sua posizione (--mx/--my) e
   * la transizione sul transform la riporta al posto nuovo.
   */
  function finishMorph(): void {
    if (!morphTiles) return;
    const starts = morphTiles;
    morphTiles = null;
    const moved: HTMLElement[] = [];
    for (const [uid, tile] of tiles) {
      const old = starts.get(uid);
      if (!old || tile.parentElement !== surface) continue;
      const dx = old.left - (parseFloat(tile.style.left) || 0);
      const dy = old.top - (parseFloat(tile.style.top) || 0);
      if (!dx && !dy) continue;
      tile.style.setProperty("--mx", `${dx}px`);
      tile.style.setProperty("--my", `${dy}px`);
      tile.style.transition = "none";
      tile.classList.add("is-morphing");
      moved.push(tile);
    }
    if (moved.length === 0) return;
    void surface.offsetWidth;
    for (const tile of moved) {
      tile.style.transition = "";
      tile.style.setProperty("--mx", "0px");
      tile.style.setProperty("--my", "0px");
    }
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
        // §6.5 — la mano oltre le 7: la Zona di Ritiro di quel posto si accende
        // e invita, perché scartare lì è l'ultimo gesto prima del Fine turno.
        const discard =
          pile.zone === "ritiro" &&
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
      // Schierato: il tasto Abilità, di chi lo comanda, con l'arbitro. Nel
      // turno altrui resta in vista ma spento.
      const abilitiesButton = slot.querySelector<HTMLButtonElement>(".ability-btn");
      if (abilitiesButton) {
        const deployed = !waiting && ctx.arbitrated() && ctx.controls(seat) && deployedRubyfront(seat) !== undefined;
        slot.classList.toggle("can-abilities", deployed);
        abilitiesButton.disabled = deployed && state.active !== seat;
        abilitiesButton.title = abilitiesButton.disabled ? t("ability.hint.turn") : t("recall.abilities.tip");
        const rubyfront = deployed ? deployedRubyfront(seat) : undefined;
        slot.classList.toggle("can-flip", rubyfront !== undefined && flipReady(rubyfront));
      }
      // Il posto del Rubyfront non porta etichetta (tolta su richiesta,
      // 2026-09-10: la carta e il tasto Schiera dicono già tutto).
      delete slot.dataset.label;
    }

    // §7.2 — la barra della catena: cosa c'è in cima, e a chi tocca. Col
    // velo sul tavolo, che resta inerte finché la catena non si è sciolta.
    const chain = state.chain;
    const top = chainTop(state);
    chainVeil.hidden = !chain;
    document.body.classList.toggle("is-chain", !!chain);
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
    paintCombatTabs();
    fitPending(document.body);
    finishMorph();
    driveChain();
  }

  return {
    render,
    flash,
    retint() {
      for (const el of zoneEls) {
        const seat = el.dataset.seat as Seat | undefined;
        if (seat && el.dataset.tint !== undefined) el.dataset.tint = ctx.tintFor(seat);
      }
    },
    promptDiscard(seat) {
      const turn = ctx.state().turn;
      const already = discardPrompt?.seat === seat && discardPrompt.turn === turn;
      discardPrompt = { seat, turn };
      render();
      return !already;
    },
    strike: uid => strike(uid, TRIGGER_LEAD_MS + FLY_MS),
    clash(uid, kind) {
      const tile = tiles.get(uid);
      if (tile && tile.offsetParent !== null) slashMark(tile, kind);
    },
    liftForFlight,
    flyFromPile,
    introRubyfronts,
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
    offerLeaveReturns(before, after, owners) {
      const steps = leaveReturns(before, after, ctx.card).filter(step => owners.includes(step.card.owner));
      if (steps.length === 0) return;
      void (async () => {
        for (const step of steps) await playLeaveReturn(step);
      })();
    },
    offerDeathRemains(before, after, owners) {
      const steps = deathSteps(before, after, ctx.card).filter(step => owners.includes(step.object.owner));
      if (steps.length === 0) return;
      void (async () => {
        for (const step of steps) await playRemainStep(step);
      })();
    },
    offerAssignTriggers(before, after, owners) {
      const steps = assignSteps(before, after, ctx.card).filter(step => owners.includes(controllerOf(step.source)));
      if (steps.length === 0) return;
      void (async () => {
        for (const step of steps) await playAssignStep(step);
      })();
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
    useAbility(card, ability) {
      return useAbility(card, ability);
    },
    flipToNexus(card) {
      return flipToNexus(card);
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
