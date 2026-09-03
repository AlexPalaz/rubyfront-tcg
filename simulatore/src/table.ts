// Il tavolo: la lavagna, le pile, le due mani.
//
// Il disegno è "riconciliato", non ricostruito: ogni carta ha un solo elemento
// DOM, che viene spostato da una zona all'altra. Ricrearlo a ogni cambio di
// stato significherebbe rilanciare il renderer e `fitTextBoxes` su decine di
// carte a ogni mossa — e vedere la mano sfarfallare a ogni tiro di dado.

import { msg, t } from "./i18n.js";
import { createArrowLayer, drawArrows, type Arrow } from "./arrows.js";
import { createCardEl, fitPending, syncCardEl, wirePreview } from "./cardview.js";
import { declareAttack as declareAttackVia, declareBlock, undeclare } from "./combat.js";
import { tapPreview } from "./preview.js";
import {
  COMPACT_TAIL_SAVED,
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
  fromView,
  isCompactView,
  surfaceViewH,
  tileViewH,
  toView,
  viewBandTop,
  type Ctx,
} from "./ctx.js";
import { showRoll } from "./dice.js";
import { confirmEffect, showEnterEffect } from "./effect.js";
import {
  describeControl,
  describeLook,
  describeMove,
  describeReturn,
  describeTrigger,
  enterControls,
  enterLooks,
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
  resolveMove,
  resolveReturn,
  resolveTrigger,
  type EnterControlStep,
  type EnterLookStep,
  type EnterMoveStep,
  type EnterReturnStep,
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
} from "./renderer.js";
import {
  STACK_STEP,
  controllerOf,
  declarationOf,
  fieldCards,
  matterSpot,
  playSpot,
  seatLabel,
  seatWaiting,
  shuffled,
  stackAt,
  zoneCards,
  freeFrontSlotOrNull,
  nextWaveOrder,
} from "./state.js";
import type { CardInstance, GameState, Seat, ZoneId } from "./types.js";
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
/** La cornice del cassetto oltre la carta (i 48px di --hand-h). */
const HAND_CHROME = 48;

export interface TableView {
  render(): void;
  /** Rifà la geometria di vista (misure, zone, scala): per il cambio di
      modo compatto/normale a caldo. Le carte restano dove sono. */
  refreshLayout(): void;
  /** Callback per aprire la ricerca: la fornisce main.ts. */
  onBrowse(handler: (seat: Seat, zone: ZoneId) => void): void;
  /** Callback per scegliere una carta da una pila (effetti): la fornisce main.ts. */
  onPick(
    handler: (seat: Seat, zone: ZoneId, candidates: CardInstance[], title: string, visible?: CardInstance[]) => Promise<CardInstance | null>
  ): void;
  /** Il bagliore di una carta che si innesca: per gli effetti arrivati dalla rete. */
  flash(uid: string, ms?: number): void;
  /** La freccia di un effetto dalla fonte al bersaglio, per un attimo. */
  flashArrow(fromUid: string, toUid: string): void;
  /** Prende la tessera prima che voli in una pila (chi riceve): ritorna il
      via al volo, da dare dopo aver applicato l'azione. */
  liftForFlight(uid: string): (() => void) | null;
  /** Il volo da una pila al campo (chi riceve): dopo aver applicato l'azione. */
  flyFromPile(seat: Seat, zone: ZoneId, uid: string): void;
  /** Il volo da dove sta a dove starà (controllo, restituzione): prima
      dell'azione; ritorna il via, da dare dopo il disegno. */
  liftToFlight(uid: string): (() => void) | null;
}

export function mountTable(root: HTMLElement, ctx: Ctx): TableView {
  const tiles = new Map<string, HTMLElement>();
  let browse: (seat: Seat, zone: ZoneId) => void = () => {};
  /** La scelta da una pila per un effetto: la fornisce main.ts (overlay). */
  let pickFromPile: (
    seat: Seat,
    zone: ZoneId,
    candidates: CardInstance[],
    title: string,
    visible?: CardInstance[]
  ) => Promise<CardInstance | null> = () => Promise.resolve(null);
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

  const surface = document.createElement("div");
  surface.className = "surface";
  surface.dataset.drop = "field";

  /** Larghezza fissa, altezza di VISTA (la compatta la stringe). Il transform
      di scala (style.css) non riduce l'ingombro nello scroll: lo pareggiano i
      margini, che tolgono esattamente la parte non disegnata. */
  function applySurfaceSize(): void {
    surface.style.width = `${SURFACE_W}px`;
    surface.style.height = `${surfaceViewH()}px`;
    surface.style.marginRight = `calc(${SURFACE_W}px * (var(--card-scale) - 1))`;
    surface.style.marginBottom = `calc(${surfaceViewH()}px * (var(--card-scale) - 1))`;
    // Anche lo strato delle frecce segue l'altezza di vista: alto quanto la
    // superficie canonica, allungherebbe lo scorrimento da sotto, invisibile.
    arrowLayer.setAttribute("height", String(surfaceViewH()));
    arrowLayer.setAttribute("viewBox", `0 0 ${SURFACE_W} ${surfaceViewH()}`);
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
  // swipe in su (o un tap sull'orlo ripiegato) lo riapre. E si parte ripiegati:
  // su uno schermo piccolo la mano aperta si mangerebbe il tavolo.
  if (window.matchMedia("(pointer: coarse)").matches) setHandCollapsed(true);
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

  root.append(board, oppHand, myHand, handDrop, handToggle, targetHint);

  // La lavagna si vede sempre tutta in larghezza: quando la finestra è più
  // stretta dei 2700px canonici, la superficie si scala di conseguenza (e le
  // carte in mano con lei, via CSS). Si vedono più piccole, ma a leggerle ci
  // pensa l'ingrandimento al passaggio, che resta a misura piena.
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
    // Due tetti in compatta: il tavolo con la mano sotto, e la misura di
    // sempre — la coda accorciata (COMPACT_TAIL_SAVED) non fa crescere le
    // carte, libera spazio.
    const heightFit = compact
      ? Math.min(
          (board.clientHeight - HAND_CHROME) / (surfaceViewH() + TILE_H * HAND_BOOST_COMPACT),
          board.clientHeight / (surfaceViewH() + COMPACT_TAIL_SAVED)
        )
      : Number.POSITIVE_INFINITY;
    const scale = Math.min(1, board.clientWidth / SURFACE_W, heightFit);
    // Su html, non su body: le variabili derivate (--hand-scale, --hand-h)
    // sono definite in :root e si risolvono LÌ — un override sul body non le
    // raggiungerebbe, e il cassetto resterebbe ad altezza piena.
    // floor, non round: arrotondare in su lascerebbe UN pixel di scorrimento
    // proprio nella vista che promette di non scorrere.
    document.documentElement.style.setProperty("--card-scale", String(Math.floor(scale * 1000) / 1000));
    document.documentElement.style.setProperty("--hand-boost", String(compact ? HAND_BOOST_COMPACT : HAND_BOOST));
    // Quando in compatta comanda l'altezza, la lavagna è più stretta della
    // finestra: si centra nello spazio a sinistra della corsia dell'HUD
    // (--hud-lane), invece di restare incollata a sinistra col vuoto a
    // destra — o di finire sotto l'HUD. Il margine è in percentuale della
    // lavagna e legge la scala dalla variabile: al ridimensionamento si
    // sistema da sé. Le coordinate dei rilasci partono dal rettangolo della
    // superficie, non dalla lavagna, quindi lo spostamento non le tocca.
    surface.style.marginLeft = compact
      ? `max(0px, calc((100% - var(--hud-lane) - ${SURFACE_W}px * var(--card-scale)) / 2))`
      : "";
  }
  fitScale();
  new ResizeObserver(fitScale).observe(board);

  /** Da coordinata condivisa a coordinata di schermo, per questo giocatore. */
  const view = (y: number): number => toView(y, ctx.seat());
  /** E il viaggio di ritorno, per il punto in cui una carta viene lasciata. */
  const unview = (y: number): number => fromView(y, ctx.seat());

  const pileSlots = new Map<string, HTMLElement>();
  /** Gli elementi delle zone: si buttano e si ridisegnano al cambio modo. */
  const zoneEls: HTMLElement[] = [];
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
  const surfaceScale = (): number => surface.getBoundingClientRect().width / SURFACE_W;

  board.addEventListener("pointermove", event => {
    if (!targeting) return;
    const box = surface.getBoundingClientRect();
    // La punta della freccia vive in coordinate canoniche, come le carte: la
    // posizione del puntatore va riportata fuori dalla scala del disegno.
    const scale = surfaceScale();
    targeting.pointer = { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale };
    paintArrows();
  });

  function buildStaticZones(): void {
    for (const el of zoneEls) el.remove();
    zoneEls.length = 0;
    pileSlots.clear();
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
      band.style.height = `${bandViewH()}px`;
      const name = document.createElement("span");
      name.className = "half-name";
      name.dataset.seatName = seat;
      band.append(name);
      surface.append(band);
      zoneEls.push(band);

      for (const pile of PILES) {
        const slot = document.createElement("div");
        slot.className = "slot pile";
        slot.dataset.drop = pile.zone;
        slot.dataset.seat = seat;
        slot.style.left = `${pile.x}px`;
        slot.style.top = `${view(back)}px`;
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
        slot.addEventListener("dblclick", () => {
          if (pile.zone === "deck" && ctx.controls(seat)) draw(seat, 1);
          else browse(seat, pile.zone);
        });

        surface.append(slot);
        zoneEls.push(slot);
        pileSlots.set(`${seat}:${pile.zone}`, slot);
      }

      // I posti segnati non sono zone a sé: la carta che ci finisce resta una
      // carta sul campo, con le sue coordinate. L'unica differenza è che ci si
      // aggancia dentro invece di posarsi dove capita — come chiedono i
      // riquadri di Abisso e Ritiro, che però sono pile vere.
      const markSlot = (x: number, y: number, label: string, extra = ""): void => {
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
      };

      // Zona di Richiamo (§5): il Rubyfront parte da qui, e una volta
      // schierato non ci torna (§3.1).
      markSlot(SLOT_X.richiamo, back, t("zone.richiamo"));
      // Lo slot extra del controllo (§8.2): un'Entità avversaria presa fino
      // a fine turno sta qui, e non conta nei 5 del Fronte.
      markSlot(CONTROL_X, back, t("zone.control"));

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
      markSlot(RUBYFRONT_X, front, t("zone.rubyfront"), "slot-rubyfront");

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
  function declareAttack(card: CardInstance): void {
    void (async () => {
      const passed = await declareAttackVia(ctx, card, rubyfrontOf(otherSeat(controllerOf(card))));
      if (!passed) return;
      // §8.2 — «quando attacca»: gli effetti certificati dell'attaccante, con
      // la stessa scena dell'ingresso ma la riga «Quando attacca».
      const live = ctx.state().cards[card.uid];
      if (!live) return;
      // RBF-004: la Vendetta promessa «al prossimo Umano che attacca» si
      // dà adesso, se è lui — senza scena, con la freccia.
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
          kicker: t("scene.attack"),
          onContinue: () => void playAttackSteps(group),
        });
      }
    })();
  }

  async function playAttackSteps(steps: AttackStep[]): Promise<void> {
    for (const step of steps) await playAttackStep(step);
  }

  /** RBF-004: la Vendetta al prossimo Umano, con la freccia dalla fonte. */
  async function playGrant(step: AttackStep, target: CardInstance): Promise<void> {
    if (step.form.kind !== "empower" || !step.form.grants) return;
    const by = controllerOf(step.source);
    light(step.source.uid, true);
    flashArrow(step.source.uid, target.uid, FLY_MS);
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
              flashArrow(step.source.uid, target.uid, FLY_MS);
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
            flashArrow(step.source.uid, target.uid, 60_000);
            const sure = await confirmEffect(root, t("confirm.raid", { card: `«${ctx.card(target.cardId).name}»` }));
            if (!sure) {
              flashArrow(step.source.uid, target.uid, 0);
              break;
            }
            const passed = await ctx.dispatch({ t: "empower", uid: target.uid, restrict: "block", effect: attackRef(step) });
            if (passed) ctx.log(msg("log.effect.restrict", { seat: by, sourceCard: step.source.cardId, card: target.cardId }), by);
            await wait(TRIGGER_TAIL_MS);
            flashArrow(step.source.uid, target.uid, 0);
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
              void ctx.dispatch({ t: "tap", uid: chosen.uid, tapped: true });
              ctx.log(msg("log.effect.recall.front", { seat: by, sourceCard: step.source.cardId, card: chosen.cardId }), by);
            }
          }
          break;
        }
        case "refresh": {
          const roll = rollDie(form.die);
          await showRoll(root, form.die, roll, t("dice.step", { name, what: t("dice.charge2", { lo: form.onRoll[0], hi: form.onRoll[1] }) }));
          const extra = inRange(roll, form.onRoll);
          const passed = await ctx.dispatch({ t: "refresh", seat: by, roll, extra, effect: attackRef(step) });
          if (passed) ctx.log(msg("log.effect.refresh", { seat: by, sourceCard: step.source.cardId, extra: extra ? msg("log.extra.promised") : "" }), by);
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
    return new Promise(resolve => {
      targeting = {
        mode: "effect",
        source: source.uid,
        candidates: new Set(candidates.map(card => card.uid)),
        pointer: null,
        pick: card => {
          targeting = null;
          document.body.classList.remove("is-targeting");
          targetHint.hidden = true;
          render();
          resolve(card);
        },
        cancel: () => resolve(null),
      };
      document.body.classList.add("is-targeting");
      targetHint.textContent = t("target.esc", { hint });
      targetHint.hidden = false;
      render();
    });
  }

  /** Una freccia di passaggio dalla fonte al bersaglio, per il tempo dell'effetto. */
  function flashArrow(fromUid: string, toUid: string, ms: number): void {
    const from = ctx.state().cards[fromUid];
    const to = ctx.state().cards[toUid];
    if (!from || !to || from.zone !== "field" || to.zone !== "field") return;
    transientArrows.push({ arrow: { kind: "effect", from: boxOf(from), to: boxOf(to) }, until: Date.now() + ms });
    render();
    window.setTimeout(render, ms + 20);
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
    if (faceCount(card.cardId) > 1) {
      const next = (card.face + 1) % faceCount(card.cardId);
      items.push({
        label: t(card.face === 0 ? "menu.flip.nexus" : "menu.flip.rubyfront"),
        run: () => ctx.dispatch({ t: "flip", uid: card.uid, face: next }),
      });
    }
    items.push({ rule: true, label: "" });
    const send = (zone: ZoneId, label: string, toBottom = false): MenuItem => ({
      label,
      disabled: card.zone === zone && !toBottom,
      run: () => ctx.dispatch({ t: "toZone", uid: card.uid, zone, toBottom }),
    });
    if (mine) items.push(send("hand", t("menu.to.hand")));
    items.push(send("abisso", t("menu.to.abisso")));
    items.push(send("ritiro", t("menu.to.ritiro")));
    if (mine) {
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
    if (card.zone === "field") return ctx.dispatch({ t: "move", uid: card.uid, x, y, z });
    const cost = card.zone === "hand" && !isRubyfront(card.cardId) ? cardStats(card.cardId).fluxCost : null;
    const passed = await ctx.dispatch({
      t: "toZone",
      uid: card.uid,
      zone: "field",
      x,
      y,
      z,
      ...(cost !== null ? { cost } : {}),
    });
    const effects = card.zone === "hand" ? enterEffects(card.cardId, card.face, ctx.locale()) : [];
    if (passed && cost !== null) {
      const player = ctx.state().players[card.owner];
      // In chat resta anche l'effetto: la storia della partita si rilegge.
      const told = effects.map(effect => ` — ${effect.tag}: ${effect.text}`).join("");
      ctx.log(msg("log.play", { seat: card.owner, card: card.cardId, cost, flux: player.flux, max: player.fluxMax, effects: told }), card.owner);
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
          ...triggers.map(trigger => describeTrigger(trigger, ctx.card)),
        ],
        onContinue:
          moves.length || returns.length || looks.length || controls.length || triggers.length ? () => void playTriggers(live) : undefined,
      });
    }
    return passed;
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
    const cost = cardStats(card.cardId).fluxCost;
    if (cost === null) return false;
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

  /**
   * La carta vola verso una pila: un fantasma della tessera, preso PRIMA che
   * lo stato cambi (la tessera vera sparirà nella pila), che scivola fino
   * al riquadro della pila del proprietario e svanisce. Chi la chiama la
   * prende prima dell'azione e la lascia partire dopo. FLY_MS è lo stesso
   * tempo della transizione di .fly-ghost in style.css.
   */
  function liftForFlight(uid: string): (() => void) | null {
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
    ghost.classList.remove("is-pickable", "is-legal", "is-triggering");
    ghost.style.position = "fixed";
    ghost.style.left = `${from.left}px`;
    ghost.style.top = `${from.top}px`;
    ghost.style.width = `${layoutW}px`;
    ghost.style.height = `${layoutH}px`;
    ghost.style.margin = "0";
    ghost.style.transform = `scale(${from.width / layoutW})`;
    document.body.append(ghost);
    return () => {
      const slot = pileSlots.get(`${live.owner}:ritiro`);
      const to = slot?.getBoundingClientRect();
      if (!to) {
        ghost.remove();
        return;
      }
      // Un frame dopo, così la transizione parte dalla posizione di ora.
      requestAnimationFrame(() => {
        ghost.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / layoutW})`;
        ghost.style.opacity = "0.15";
      });
      window.setTimeout(() => ghost.remove(), FLY_MS + 60);
    };
  }

  /**
   * Il volo da una pila al campo: il fantasma parte dal riquadro della
   * pila e arriva dove la tessera vera è comparsa (dopo il disegno).
   */
  function flyFromPile(seat: Seat, zone: ZoneId, uid: string): void {
    const slot = pileSlots.get(`${seat}:${zone}`);
    const tile = tiles.get(uid);
    if (!slot || !tile) return;
    const from = slot.getBoundingClientRect();
    const to = tile.getBoundingClientRect();
    // Come in liftForFlight: misura di layout, scala della lavagna.
    const layoutW = tile.offsetWidth;
    const layoutH = tile.offsetHeight;
    const ghost = tile.cloneNode(true) as HTMLElement;
    ghost.classList.add("fly-ghost");
    ghost.classList.remove("is-pickable", "is-legal", "is-triggering");
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
    const sure = await confirmEffect(root, t("confirm.return", { card: `«${ctx.card(card.cardId).name}»` }));
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
      ghost.classList.remove("is-pickable", "is-legal", "is-triggering");
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
    flashArrow(step.source.uid, target.uid, 60_000);
    const sure = await confirmEffect(root, t("confirm.control", { card: `«${ctx.card(target.cardId).name}»` }));
    if (!sure) {
      transientArrows = [];
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
      transientArrows = [];
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
    // §8.2 — entrando sul campo di chi la controlla, i suoi effetti
    // «quando entra in campo» si applicano.
    const taken = ctx.state().cards[target.uid];
    if (passed && taken && taken.zone === "field") await playTriggers(taken);
  }

  async function playLook(first: EnterLookStep): Promise<void> {
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
      const passed = await resolveLook(ctx, step, reveal, retire);
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
    const target = await pickTarget(step.source, step.candidates, t("target.retire"));
    if (!target) {
      light(step.source.uid, false);
      return;
    }
    // Scelto il bersaglio, si chiede conferma — con la freccia in vista.
    flashArrow(step.source.uid, target.uid, 60_000);
    const sure = await confirmEffect(root, t("confirm.retire", { card: `«${ctx.card(target.cardId).name}»` }));
    if (!sure) {
      transientArrows = [];
      light(step.source.uid, false);
      render();
      return;
    }
    hold(true);
    try {
      await wait(CONFIRMED_LEAD_MS);
      const fly = liftForFlight(target.uid);
      const passed = await resolveMove(ctx, step, target);
      transientArrows = [];
      if (passed) {
        fly?.();
        await wait(FLY_MS + TRIGGER_TAIL_MS);
      } else {
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
    if (!drop) return;
    if (drop.kind === "field") {
      // Il rilascio a mano libera arriva in coordinate di schermo: va riportato
      // in canoniche prima di finire nello stato, o al posto B ogni carta
      // comparirebbe nella metà sbagliata. L'aggancio no: i riquadri portano
      // già con sé la coordinata canonica.
      const free = { x: drop.x, y: unview(drop.y) };
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
        if (origin) void ctx.dispatch({ t: "move", uid: card.uid, x: origin.x, y: origin.y, z: origin.z });
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
    void ctx.dispatch({ t: "toZone", uid: card.uid, zone: drop.zone }).then(passed => {
      if (!passed && origin) void ctx.dispatch({ t: "move", uid: card.uid, x: origin.x, y: origin.y, z: origin.z });
    });
  }

  // -------------------------------------------------------------- disegno

  function tileFor(card: CardInstance, back: boolean): HTMLElement {
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
          return !(live.zone === "hand" && !ctx.controls(live.owner));
        },
        onDragMove: drop => {
          const live = ctx.state().cards[card.uid];
          if (!live || live.zone !== "field") return;
          // Con l'arbitro al tavolo i pixel non viaggiano in diretta: ogni
          // passo sarebbe un `move` fuori slot, e l'arbitro lo fermerebbe
          // (§5). Il fantasma segue comunque il dito; l'avversario vede la
          // carta al rilascio, quando ha un posto.
          if (ctx.arbitrated()) return;
          dragging = card.uid;
          // Sopra un riquadro le coordinate sono già canoniche; a mano libera
          // arrivano dallo schermo e vanno riportate indietro.
          const y = drop.snapped ? drop.y : unview(drop.y);
          ctx.dispatch({ t: "move", uid: card.uid, x: drop.x, y, z: Math.max(live.z, ctx.state().zTop) });
        },
        onStart: () => {
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
          if (live) openMenu(event.clientX, event.clientY, cardMenu(live));
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
        if (live) openMenu(event.clientX, event.clientY, cardMenu(live));
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
          if (unaffordable(live)) return;
          // Il doppio click gioca: Entità sul primo slot libero del Fronte,
          // Materie nella loro fila (§5) — mai sugli slot.
          const spot = playSpot(ctx.state(), live.owner, faceKind(live.cardId, live.face));
          void place(live, spot.x, spot.y, ctx.state().zTop + 1);
        }
      });
    }
    syncCardEl(tile, card, { back, theme: ctx.themeFor(card.owner), locale: ctx.locale() });
    return tile;
  }

  /** Rettangolo di una carta in coordinate della superficie. */
  function boxOf(card: CardInstance): Arrow["from"] {
    return { x: card.x, y: view(card.y), w: TILE_W, h: tileViewH() };
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

  /** Distintivo d'angolo: il numero d'ondata, o lo scudo di chi ferma. */
  function markCombat(tile: HTMLElement, card: CardInstance): void {
    const declaration = declarationOf(ctx.state(), card.uid);
    tile.classList.toggle("is-attacking", declaration?.kind === "attack");
    tile.classList.toggle("is-blocking", declaration?.kind === "block");
    tile.classList.toggle("is-countering", declaration?.kind === "counter");

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

  function render(): void {
    const state = ctx.state();
    const me = ctx.seat();
    const foe = otherSeat(me);
    const alive = new Set<string>();

    for (const seat of SEATS) {
      const label = surface.querySelector<HTMLElement>(`[data-seat-name="${seat}"]`);
      if (label) {
        label.textContent = `${seatLabel(state, seat, me)}${seat === me ? t("label.you") : ""}`;
      }
      for (const pile of PILES) {
        const slot = pileSlots.get(`${seat}:${pile.zone}`)!;
        const cards = zoneCards(state, seat, pile.zone);
        slot.dataset.count = String(cards.length);
        const caption = slot.querySelector<HTMLElement>(".slot-label")!;
        caption.textContent = `${t(pile.label)} · ${cards.length}`;
        const top = cards[0];
        if (top) {
          alive.add(top.uid);
          const tile = tileFor(top, pile.hidden);
          if (tile.parentElement !== slot) slot.append(tile);
          tile.style.left = "";
          tile.style.top = "";
          tile.style.marginLeft = "";
          tile.style.position = "absolute";
          // Anche la cima della pila si ritaglia in compatto, o sborderebbe
          // dallo slot e riporterebbe lo scorrimento che si voleva togliere.
          tile.style.height = `${tileViewH()}px`;
          tile.classList.toggle("is-cropped", isCompactView());
          tile.style.zIndex = "1";
        }
      }
    }

    for (const card of fieldCards(state)) {
      alive.add(card.uid);
      const tile = tileFor(card, card.facedown);
      markCombat(tile, card);
      // In modo bersaglio: le carte in campo del difensore sono scegliibili, e
      // fra queste si accendono quelle che le regole permetterebbero. Le altre
      // si smorzano soltanto — restano cliccabili.
      const canPick = pickable(card);
      tile.classList.toggle("is-pickable", canPick);
      tile.classList.toggle("is-legal", canPick && (targeting?.mode === "effect" || looksPlayable(card)));
      if (tile.parentElement !== surface) surface.append(tile);
      if (card.uid !== dragging) {
        tile.style.position = "absolute";
        tile.style.left = `${card.x}px`;
        tile.style.top = `${view(card.y)}px`;
      }
      // Il margine negativo è un vestito della mano affollata: se la tessera
      // arriva da lì e se lo tenesse addosso, si disegnerebbe a sinistra del
      // punto vero — «fuori dallo slot» pur essendoci, nei dati, dentro.
      tile.style.marginLeft = "";
      // In compatto la tessera si ritaglia al fondo dell'illustrazione: la
      // carta sotto è intera, la taglia l'overflow. In mano resta piena.
      tile.style.height = `${tileViewH()}px`;
      tile.classList.toggle("is-cropped", isCompactView());
      tile.classList.remove("is-unaffordable");
      tile.style.zIndex = String(10 + card.z);
    }

    for (const [seat, host, tag] of [[me, myHand, myTag], [foe, oppHand, oppTag]] as const) {
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
      const excess = seat === me && cards.length > 7 && ctx.controls(seat);
      tag.textContent = seat === me
        ? `${t("hand.mine", { n: cards.length })}${excess ? t("hand.excess") : ""}`
        : seatWaiting(state, seat)
          ? t("hand.waiting")
          : t("hand.theirs", { name: seatLabel(state, seat), n: cards.length });
      tag.classList.toggle("is-excess", excess);
      host.classList.toggle("is-empty", cards.length === 0);
      const wanted: HTMLElement[] = [];
      for (const card of cards) {
        alive.add(card.uid);
        // La mano di un posto governato si vede scoperta: in rete solo la
        // propria, in partita locale anche quella in alto.
        const tile = tileFor(card, !ctx.controls(seat));
        tile.style.position = "relative";
        tile.style.left = "";
        tile.style.top = "";
        tile.style.height = `${TILE_H}px`;
        tile.classList.remove("is-cropped");
        tile.classList.toggle("is-unaffordable", unaffordable(card));
        tile.style.zIndex = "";
        wanted.push(tile);
      }
      // Le carte in mano si sovrappongono quando sono troppe: restano
      // 302×424, si stringono soltanto le une sulle altre. Il conto va
      // fatto sulla larghezza VISIVA (la scala della mano, o quella del
      // campo per i dorsi avversari su touch): in pixel canonici le carte
      // sembrerebbero enormi e si accatasterebbero già in sei.
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      const scale = seat === me || !coarse
        ? Math.min(1, surfaceScale() * 1.3)
        : surfaceScale();
      const tileW = TILE_W * scale;
      // Su touch la targhetta avversaria sta nel flusso e ruba larghezza.
      const room = host.clientWidth - 32 - (coarse && seat !== me ? tag.offsetWidth + 14 : 0);
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
      let entrance = 0;
      for (const tile of wanted) {
        if (tile.parentElement === host) continue;
        const delay = entrance * DRAW_STEP_MS;
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
  }

  return {
    render,
    flash,
    flashArrow: (fromUid, toUid) => flashArrow(fromUid, toUid, TRIGGER_LEAD_MS + FLY_MS),
    liftForFlight,
    flyFromPile,
    liftToFlight,
    refreshLayout() {
      applySurfaceSize();
      buildStaticZones();
      fitScale();
      render();
    },
    onPick(handler) {
      pickFromPile = handler;
    },
    onBrowse(handler) {
      browse = handler;
    },
  };
}

export type { GameState };
