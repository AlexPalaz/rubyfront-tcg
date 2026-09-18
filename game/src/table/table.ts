// Il tavolo del gioco (F3, «il tavolo fermo»): la partita com'è nello stato
// del core, disegnata in Pixi — i due campi con i riquadri e le etichette,
// le targhe dei posti (PV, Gettone, Flusso) e i nomi, le carte in campo, le
// tue pile, il pannello delle pile avversarie, il cassetto della mano, il
// gesto di fase. Si ridisegna con `show(state)`: le carte si riallineano
// per uid (nessuna si ricrea se c'era già), il resto — riquadri e scritte —
// si ridipinge solo nei pezzi dove qualcosa è cambiato (paintKeyed).
//
// Il tema è «Notte» (2026-09-12, aspetto.ts): la valle sotto un velo scuro,
// i campi come castoni al neon nella tinta del mazzo di ciascun posto, gli
// alloggi degli slot, le targhe brunite, il cassetto col filo neon.

import { cardFacts, cardStats, deckTint, getCard, isRubyfront, type Tint } from "@rubyfront/core/cards";
import { hasKeyword, powerOf, staticCounter } from "@rubyfront/core/combat";
import { CONTROL_X, FRONT_SLOT_X, FRONT_W, FRONT_X, MATTER_X, RUBYFRONT_X, SLOT_X, SURFACE_W } from "@rubyfront/core/geometry";
import { lang, t } from "@rubyfront/core/i18n";
import { MULLIGANS_MAX, mayKeep, mayMulligan, mustDiscard, mustKeep, openingPending, phaseCloser, seatLabel, waveDeclared, whoActs, zoneCards } from "@rubyfront/core/state";
import type { CardInstance, GameState, Phase, Seat, ZoneId } from "@rubyfront/core/types";
import { otherSeat } from "@rubyfront/core/types";
import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { fillLinear } from "../card/css";
import { applyFont, drawText, textWidth, type Font } from "../card/text";
import type { Stage, Visible } from "../stage";
import { CrispSprite, NIGHT, SEAT_PALETTE, SANS, THEME, slotFrame, loadNight, lighten, paintPiece, grain, octagon, plate, dashedRect, rgba, type SeatPalette } from "./appearance";
import { TableCard, type Ring, type Badges, type Mark, type CardLook } from "./card";
import { Stillness, bezier, easeInOut, easeOut, tween, reducedMotion } from "./animation";
import { layout, type TableLayout } from "./layout";

/** Un gesto del puntatore su una carta del tavolo: chi ascolta decide cosa vuol dire (F4). */
export interface CardEvent {
  type: "over" | "out" | "tap" | "double" | "grab" | "menu";
  uid: string;
  /** Dove sta la carta: sul campo, in cima a una pila, in mano. */
  zone: ZoneId;
  /** Il punto del puntatore, in unità di progetto. */
  x: number;
  y: number;
}

/** La pesca animata (card-drawn): corsa di una carta e passo della cascata (table.ts). */
export const DRAW_RUN_MS = 380;
export const DRAW_STEP_MS = 70;
/** Più carte che si tappano o stappano insieme (la stappata del cambio turno): una ogni 70 ms, da sinistra. */
const TAP_STAGGER_MS = 70;
/** Quanto salgono i candidati della mira sopra il resto del tavolo. */
const AIM_LIFT = 10_000;

/** Quanto dura, in tutto, l'entrata in cascata di `count` carte (zero con prefers-reduced-motion). */
export function drawCascadeMs(count: number): number {
  if (count <= 0 || reducedMotion()) return 0;
  return (count - 1) * DRAW_STEP_MS + DRAW_RUN_MS;
}

/** Due tocchi sulla stessa carta entro questo tempo sono un doppio tocco. */
const DOUBLE_TAP_MS = 320;
/** La pressione lunga al tocco è il tasto destro del dito: apre il menu. */
const LONG_PRESS_MS = 500;

const PILE: { zone: ZoneId; x: number; label: string }[] = [
  { zone: "abisso", x: SLOT_X.abisso, label: "zone.abisso" },
  { zone: "ritiro", x: SLOT_X.ritiro, label: "zone.ritiro" },
  { zone: "deck", x: SLOT_X.deck, label: "zone.deck" },
];

/**
 * La fila di servizio avversaria, aperta dal tasto: le sue tre pile dove
 * stanno le tue, e la sua mano (un dorso col conto) nel posto della Zona di
 * Richiamo, che nella sua fila non si disegna (il Rubyfront in attesa sta nel
 * riquadro del Rubyfront, sul Fronte).
 */
const FOE_PILES: { zone: ZoneId; x: number; label: string; back: boolean }[] = [
  { zone: "hand", x: SLOT_X.richiamo, label: "zone.hand", back: true },
  ...PILE.map(pile => ({ ...pile, back: pile.zone === "deck" })),
];

function foePileX(zone: ZoneId): number | null {
  return FOE_PILES.find(entry => entry.zone === zone)?.x ?? null;
}

const PHASE_END: Record<Phase, string> = {
  preparazione: "phase.end.preparazione",
  fronte: "phase.end.fronte",
  reazione: "phase.end.reazione",
};

/** Le scritte della lavagna nel tema notte: 16px, 700, maiuscole spaziate .2em; la riga del Fronte .12em. */
const rowLabel: Font = { size: 16, weight: 700, family: SANS, spacing: 16 * 0.2, upper: true };
const line: Font = { ...rowLabel, spacing: 16 * 0.12 };
/** Le scritte del tasto della fila avversaria: il nome (16px, .12em) e il conto, in grassetto. */
const header: Font = { size: 16, weight: 400, family: SANS, spacing: 16 * 0.12, upper: true };
const headerNum: Font = { size: 16, weight: 700, family: SANS, spacing: 16 * 0.04 };
const tag: Font = { size: 16, weight: 600, family: SANS, spacing: 16 * 0.18, upper: true };
/** Le scritte sulla valle: avorio con l'ombra nera (0 1px 2px, 0 0 8px). */
const LABEL_SHADOWS = [
  { x: 0, y: 1, blur: 2, color: "rgba(0,0,0,.95)" },
  { x: 0, y: 0, blur: 8, color: "rgba(0,0,0,.6)" },
];
/** Sopra il cassetto della mano, l'aria per le ombre e l'alone buttati all'insù. */
const DRAWER_GAP = 60;
/** La mano ripiegata lascia in vista l'orlo con la targhetta (translateY(hand-h − 22px)) e scivola in --morph-ms. */
const HAND_PEEK = 22;
const HAND_SLIDE_MS = 380;
/** Il tasto della mano (.hand-toggle, 34×30 a 12 dall'orlo destro): le carte gli lasciano il posto. */
const TOGGLE_W = 34;
const TOGGLE_H = 30;
const TOGGLE_MARGIN = 12;
/**
 * §6.5 — la mano oltre le 7: la tua Zona di Ritiro si accende d'oro (--warn,
 * il colore degli avvisi del tavolo) e chiama, con la targhetta sopra
 * (.slot.is-discard). L'alone respira in 2,2 s come slot-discard.
 */
const DISCARD_GOLD = 0xd9a84e;
const DISCARD_PULSE_MS = 2200;
const DISCARD_MARGIN = 60;
const discardTag: Font = { size: 15, weight: 700, family: SANS, spacing: 15 * 0.04 };

export class Table {
  readonly root = new Container({ label: "table" });
  private readonly background = new CrispSprite();
  private readonly cards = new Container({ label: "cards" });
  private readonly hand = new Container({ label: "hand" });
  private readonly drawer = new CrispSprite();
  /** La tinta di ogni posto (il suo mazzo, core/cards deckTint): orli, lastre, alloggi, targhe, cassetto. */
  private readonly tints: Record<Seat, Tint> = { a: "dynamic", b: "dynamic" };
  /** La valle e la grana si caricano una volta: arrivate, il tavolo si ridisegna. */
  private nightReady = false;
  private last: { state: GameState; L: TableLayout } | null = null;
  /** Sopra tutto, in pezzi piccoli: le due testate dei posti, il tasto della fila avversaria, il gesto di fase. */
  private readonly overlay = new Container({ label: "overlay" });
  private readonly seatHeads = { a: new CrispSprite(), b: new CrispSprite() };
  private readonly foeToggle = new CrispSprite();
  /** Il puntatore sul tasto della fila avversaria: la piastra si accende. */
  private foeToggleHover = false;
  /** L'ultimo disegno (finestra e risoluzione): per ridipingere un pezzo da solo, come il tasto al passaggio. */
  private lastPaint: { visible: Visible; resolution: number } | null = null;
  /** La foto del fondo e delle targhe di prima, che si dissolve sul nuovo quando la fila avversaria si apre o si chiude (beginMorph, endMorph). */
  private readonly transition = new Sprite();
  /** Chi ridisegna tutto — i gesti compresi — quando il tavolo cambia impaginazione dal tasto (match.ts, paint). */
  private relayout: (() => void) | null = null;
  private readonly phaseFace = new CrispSprite();
  /** §4 — il tasto «Mulligan n/3», a sinistra del gesto di fase, solo nell'apertura. */
  private readonly mulliganFace = new CrispSprite();
  /** Le scritte delle tue pile col loro conto: cambiano a ogni pesca, il fondo no. */
  private readonly pileLabels = new CrispSprite();
  /** Le scritte delle pile avversarie (e della sua mano), quando la sua fila di servizio è aperta. */
  private readonly foePileLabels = new CrispSprite();
  /** La targhetta «La tua mano · n»: cambia a ogni carta, il cassetto no. */
  private readonly handTag = new CrispSprite();
  /** Le carte che nascono nascoste (i Rubyfront prima del loro ingresso, table/entrance.ts). */
  hideOnCreate: ((card: CardInstance) => boolean) | null = null;
  /** Il costo di adesso di una carta in mano, se uno sconto lo ha fatto scendere (match.ts lo presta). */
  costOf: ((card: CardInstance) => { printed: number; now: number } | null) | null = null;
  /** Ciò che ogni pezzo dipinto mostra (paintKeyed): uguale, non si ridipinge. */
  private readonly painted = new WeakMap<Sprite, string>();
  /** I PV sulle testate: quelli mostrati scalano verso il bersaglio un punto alla volta (stepHp). */
  private readonly hpShown: Record<Seat, number | null> = { a: null, b: null };
  private readonly hpTarget: Record<Seat, number> = { a: 0, b: 0 };
  /** Le prese sui PV (la risoluzione): finché ce n'è una, lo stato non muove il bersaglio — lo muove chi tiene, colpo per colpo (countHp). */
  private readonly hpHolds = new Set<number>();
  private hpHoldSeq = 0;
  private hpNextStep = 0;
  /** §7.2 — le Reattive in catena, al centro in luce; sotto di loro la penombra del tavolo. */
  private readonly chain = new Container({ label: "chain" });
  /** I fantasmi dei voli (voli.ts): sopra le carte, sotto il cassetto della mano (fly-ghost, z 25). */
  readonly flights = new Container({ label: "flights" });
  /** Le frecce del combattimento e della mira (frecce.ts): sopra le carte in campo. */
  readonly arrows = new Container({ label: "arrows" });
  /** Il centro di ogni carta com'è disegnata ora (le animazioni si muovono da qui). */
  private readonly bases = new Map<string, { x: number; y: number }>();
  /** La tua mano all'ultimo disegno: le carte nuove entrano in cascata. */
  private handBefore: Set<string> | null = null;
  /** La cascata della pesca in corso: le scene aspettano che finisca (match.ts, stillTable). */
  private readonly still = new Stillness();
  /** Quanto manca perché l'insegna di fase se ne vada: la carta del turno la aspetta (partita.ts). */
  entryDelay: () => number = () => 0;
  /** Una carta compare nella tua mano (la pesca): chi ascolta ci mette il suono, a tempo con lei. */
  onHandEntry: (() => void) | null = null;
  private readonly dimmer = new Graphics();
  private inChain = new Set<string>();
  private chainOpen = false;
  /** Le pile che si toccano: le tue Abisso e Ritiro e, a fila aperta, quelle avversarie (sotto le carte). */
  private readonly pileHits = new Container({ label: "pile-hits" });
  /** Il tasto che apre e chiude la fila di servizio avversaria (sopra tutto). */
  private readonly foeRowHits = new Container({ label: "foe-row-hits" });
  /**
   * La fila di servizio avversaria aperta dal tasto (2026-09-16, «un tasto
   * che espande il campo avversario»): Abisso, Ritiro, Mazzo e Mano sopra il
   * suo Fronte, capovolti come il resto della sua metà; il tavolo passa a
   * quattro file. La Zona di Controllo la apre da sé (layout.ts, foeBack).
   */
  private foeRowOpen = false;
  private readonly pileListeners: ((seat: Seat, zone: ZoneId) => void)[] = [];
  private readonly views = new Map<string, TableCard>();
  /** Il gesto di fase: la sua area e chi ascolta. */
  private readonly phaseButton = new Container({ label: "end-phase" });
  private readonly mulliganButton = new Container({ label: "mulligan" });
  private closePhase: (() => void) | null = null;
  private doMulligan: (() => void) | null = null;
  private mulliganActive = false;
  private readonly listeners: ((cardEvent: CardEvent) => void)[] = [];
  private lastTap = { uid: "", at: 0 };
  /** La zona di ogni carta in vista, per gli eventi. */
  private readonly zone = new Map<string, ZoneId>();
  private readonly info = new Map<string, { cardId: string; face: number; back: boolean }>();
  private buttonActive = false;
  /** I momenti degli effetti (F4): le fonti accese, le carte colpite, la mira, l'Entità che riceverebbe l'Oggetto. */
  private readonly lights = new Set<string>();
  private readonly hits = new Map<string, ReturnType<typeof setTimeout>>();
  private aimState: { candidates: Set<string>; legalOnes: Set<string> } | null = null;
  private assignTarget: string | null = null;
  /** Il candidato della mira sotto il puntatore (aim.ts): si accende pieno. */
  private aimHover: string | null = null;
  /** Lo z di ogni carta secondo la lavagna (senza il sollevamento della mira). */
  private readonly baseZ = new Map<string, number>();
  /** La mano ripiegata (hand-mine.is-collapsed): il cassetto scende e ne resta in vista l'orlo con la targhetta. */
  private handCollapsed = false;
  private handSlide = 0;
  private handSliding = false;
  /** Il tasto che ripiega la mano (.hand-toggle), dentro l'orlo destro del cassetto. */
  private readonly handToggle = new Container({ label: "hand-toggle" });
  private readonly handToggleFace = new CrispSprite();
  /** §6.5 — lo scarto possibile (gestures.ts, canDiscard): la Zona di Ritiro accesa, l'alone, la targhetta. */
  private discardOn = false;
  private readonly discardHalo = new CrispSprite();
  private readonly discardFrame = new Graphics();
  private readonly discardTag = new CrispSprite();
  /** L'ultima vista data a ogni carta: i momenti la ridipingono senza rifare il tavolo. */
  private readonly lastLooks = new Map<string, CardLook>();
  private readonly emptyListeners: (() => void)[] = [];
  /** I segni che mette chi offre i gesti (gesti.ts): le carte con un gesto disponibile, quelle in mano velate. */
  private actionUids = new Set<string>();
  private veiledUids = new Set<string>();

  constructor(
    private readonly stage: Stage,
    private readonly me: Seat,
    private readonly locale: string
  ) {
    this.cards.sortableChildren = true;
    // Il cassetto del tema notte non ha vetro sfocato: il velo scuro basta (e non costa un fotogramma).
    this.hand.addChild(this.drawer, this.handTag);
    this.overlay.addChild(this.seatHeads.a, this.seatHeads.b, this.foeToggle, this.phaseFace, this.mulliganFace);
    this.pileLabels.eventMode = "none";
    this.foePileLabels.eventMode = "none";
    this.transition.eventMode = "none";
    this.transition.visible = false;
    this.dimmer.eventMode = "none";
    this.flights.eventMode = "none";
    this.arrows.eventMode = "none";
    this.discardHalo.eventMode = "none";
    this.discardFrame.eventMode = "none";
    this.discardTag.eventMode = "none";
    this.discardHalo.visible = this.discardFrame.visible = this.discardTag.visible = false;
    // L'alone e il filo sotto le carte (la carta in cima alla pila copre il velo, non l'alone); la targhetta sopra il cassetto.
    this.root.addChild(this.background, this.pileLabels, this.foePileLabels, this.discardHalo, this.discardFrame, this.pileHits, this.cards, this.arrows, this.dimmer, this.chain, this.flights, this.hand, this.discardTag, this.overlay, this.transition, this.foeRowHits, this.phaseButton, this.mulliganButton, this.handToggle);
    this.phaseButton.eventMode = "static";
    this.phaseButton.on("pointertap", () => {
      if (this.buttonActive) this.closePhase?.();
    });
    this.mulliganButton.eventMode = "static";
    this.mulliganButton.on("pointertap", () => {
      if (this.mulliganActive) this.doMulligan?.();
    });
    this.handToggle.addChild(this.handToggleFace);
    this.handToggle.eventMode = "static";
    this.handToggle.cursor = "pointer";
    this.handToggle.on("pointertap", () => this.toggleHand());
    const reduced = reducedMotion();
    stage.app.ticker.add(() => {
      if (!this.discardHalo.visible) return;
      const phase = (performance.now() % DISCARD_PULSE_MS) / DISCARD_PULSE_MS;
      this.discardHalo.alpha = reduced ? 1 : 0.6 + 0.4 * (0.5 - 0.5 * Math.cos(phase * 2 * Math.PI));
    });
    stage.app.ticker.add(() => this.stepHp());
    // Il tasto destro è del gioco (il menu delle carte), non del browser.
    stage.app.canvas.addEventListener("contextmenu", event => event.preventDefault());
    // Il tocco sul vuoto (il fondo del tavolo): chi mira rinuncia.
    this.background.eventMode = "static";
    this.background.on("pointertap", () => {
      for (const listener of this.emptyListeners) listener();
    });
    stage.world.addChild(this.root);
  }

  /** Chi ascolta i gesti sulle carte (passaggio, tocco, doppio tocco, presa). */
  onCard(listener: (cardEvent: CardEvent) => void): void {
    this.listeners.push(listener);
  }

  /** Che cosa mostra una carta in vista: la faccia, o il dorso. */
  cardInfo(uid: string): { cardId: string; face: number; back: boolean } | undefined {
    return this.info.get(uid);
  }

  /**
   * Il riquadro della carta sullo schermo (in pixel di schermo, come getBounds),
   * senza l'ombra: coricata, largo e alto si scambiano.
   */
  screenBox(uid: string): { x: number; y: number; width: number; height: number } | undefined {
    const view = this.views.get(uid);
    if (!view || !this.last) return undefined;
    const { tileW, tileH } = this.last.L;
    const tapped = view.isTapped;
    const w = tapped ? tileH : tileW;
    const h = tapped ? tileW : tileH;
    const a = view.parent!.toGlobal({ x: view.x - w / 2, y: view.y - h / 2 });
    const b = view.parent!.toGlobal({ x: view.x + w / 2, y: view.y + h / 2 });
    return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
  }

  /** La vista di una carta, per chi deve animarla o trascinarla. */
  view(uid: string): TableCard | undefined {
    return this.views.get(uid);
  }

  /** Un «over»/«out» rimandato da chi copre la carta (il velo coi numeri e i tasti, gestures.ts): l'anteprima segue la carta anche sotto il velo (2026-09-15). */
  relay(type: "over" | "out" | "tap", uid: string, global: { x: number; y: number }): void {
    this.emit(type, uid, global);
  }

  private emit(type: CardEvent["type"], uid: string, global: { x: number; y: number }): void {
    const local = this.root.toLocal(global);
    const cardEvent: CardEvent = { type, uid, zone: this.zone.get(uid) ?? "field", x: local.x, y: local.y };
    for (const listener of this.listeners) listener(cardEvent);
  }

  /**
   * La pesca si vede (card-drawn): le carte NUOVE della tua mano entrano dal
   * bordo del cassetto, in cascata, 70 ms l'una dall'altra. Sotto l'insegna
   * di fase la carta del turno aspetta: prima la scritta, poi sparisce, poi
   * la pesca. Al primo disegno non entra niente: la mano è già lì.
   */
  private handEntries(uids: string[]): void {
    const before = this.handBefore;
    this.handBefore = new Set(uids);
    if (!before) return;
    const reduced = reducedMotion();
    const showWaiting = this.entryDelay();
    const hold = showWaiting > 0 ? showWaiting + 80 : 0;
    let entrance = 0;
    for (const uid of uids) {
      if (before.has(uid)) continue;
      const view = this.views.get(uid);
      if (!view) continue;
      const delay = hold + entrance * DRAW_STEP_MS;
      entrance += 1;
      // Senza movimento la carta è già lì: resta solo il suono, col suo passo.
      if (reduced) {
        setTimeout(() => this.onHandEntry?.(), delay);
        continue;
      }
      // `backwards`: invisibile nell'attesa, poi sale di 90 e si accende — e il suono con lei.
      view.visible = false;
      const done = this.still.hold();
      setTimeout(() => {
        if (view.destroyed) {
          done();
          return;
        }
        this.onHandEntry?.();
        view.visible = true;
        tween(this.stage.app.ticker, DRAW_RUN_MS, k => {
          if (view.destroyed) throw new Error("carta sparita");
          const base = this.bases.get(uid);
          if (base) view.y = base.y + 90 * (1 - k);
          view.alpha = k;
        }, bezier(0.2, 0.8, 0.3, 1)).then(done, done);
      }, delay);
    }
  }

  /** L'ultima vista data a una carta (i fantasmi dei voli la copiano). */
  lookOf(uid: string): CardLook | undefined {
    return this.lastLooks.get(uid);
  }

  /**
   * Il riquadro di una pila, in unità di progetto: la tua nella fila di
   * servizio; l'avversaria nel pannello aperto, o — ripiegato — la sua
   * testata, dove i voli vanno a spegnersi (table.ts, liftForFlight).
   */
  pileBox(seat: Seat, zone: ZoneId): { x: number; y: number; w: number; h: number } | null {
    const L = this.last?.L;
    if (!L) return null;
    if (seat === this.me) {
      const pile = PILE.find(entry => entry.zone === zone);
      if (!pile || L.mine.back === null) return null;
      return { x: L.x(pile.x), y: L.mine.back, w: L.tileW, h: L.tileH };
    }
    // La fila avversaria chiusa: i voli vanno a spegnersi sul tasto che la apre.
    if (L.foe.back === null) {
      const toggle = this.foeToggleBox(L);
      return { x: toggle.x, y: toggle.y, w: toggle.w, h: toggle.h };
    }
    const x = foePileX(zone);
    return x === null ? null : { x: L.x(x), y: L.foe.back, w: L.tileW, h: L.tileH };
  }

  /**
   * Il centro di una carta sul tavolo, dov'è (o dove sta andando): i voli
   * puntano qui, non alla vista, che un'animazione in corso (l'apertura della
   * fila avversaria, endMorph) può tenere ancora al posto di prima.
   */
  baseOf(uid: string): { x: number; y: number } | null {
    return this.bases.get(uid) ?? null;
  }

  /** Apre o chiude la fila di servizio avversaria (lo fa il tasto; qui per le prove). */
  openFoeRow(isOpen: boolean): void {
    if (this.foeRowOpen === isOpen) return;
    this.foeRowOpen = isOpen;
    this.redraw();
  }

  /** Chi ridisegna tutto quando il tavolo cambia impaginazione da sé (il tasto della fila avversaria): i gesti e le frecce seguono. */
  onRelayout(listener: () => void): void {
    this.relayout = listener;
  }

  /** Il tavolo si ridisegna sull'ultimo stato: da fuori se qualcuno ascolta (così «Schiera» e i tasti si riallineano), altrimenti da solo. */
  private redraw(): void {
    if (this.relayout) this.relayout();
    else if (this.last) this.show(this.last.state);
  }

  /** Il passaggio del puntatore sul tasto della fila avversaria: solo quel pezzo si ridipinge. */
  private hoverFoeToggle(on: boolean): void {
    if (this.foeToggleHover === on) return;
    this.foeToggleHover = on;
    if (this.last && this.lastPaint) this.paintFoeToggle(this.last.state, this.last.L, this.lastPaint.visible, this.lastPaint.resolution);
  }

  /** Chi ascolta il tocco su una pila pubblica (§5): l'Abisso e la Zona di Ritiro, tue o avversarie. */
  onPile(listener: (seat: Seat, zone: ZoneId) => void): void {
    this.pileListeners.push(listener);
  }

  private pile(seat: Seat, zone: ZoneId): void {
    for (const listener of this.pileListeners) listener(seat, zone);
  }

  /** Chi ascolta il tocco sul vuoto del tavolo (le mire: si rinuncia). */
  onEmpty(listener: () => void): void {
    this.emptyListeners.push(listener);
  }

  /** §8.2 — la fonte che si innesca si accende, e resta accesa finché l'effetto agisce. */
  light(uid: string, on: boolean): void {
    if (on) this.lights.add(uid);
    else this.lights.delete(uid);
    this.restyle(uid);
  }

  /** La carta colpita da un effetto: il lampo per `ms`; a zero si spegne subito. */
  strike(uid: string, ms: number): void {
    clearTimeout(this.hits.get(uid));
    this.hits.delete(uid);
    if (ms > 0) {
      this.hits.set(uid, setTimeout(() => {
        this.hits.delete(uid);
        this.restyle(uid);
      }, ms));
    }
    this.restyle(uid);
  }

  /**
   * La mira (§8.2, §6.3): i candidati si accendono — di verde quelli
   * validi —, il resto del tavolo si spegne; null la chiude.
   */
  aim(status: { candidates: Iterable<string>; legalOnes?: Iterable<string> } | null): void {
    this.aimState = status ? { candidates: new Set(status.candidates), legalOnes: new Set(status.legalOnes ?? status.candidates) } : null;
    if (!status) this.aimHover = null;
    // I candidati salgono sopra tutto finché dura la mira: un Oggetto sotto
    // la sua Entità tappata (chi attacca col Catalizzatore, 2026-09-15) non
    // si toccherebbe mai, coperto da lei.
    for (const [uid, view] of this.views) view.zIndex = this.liftedZ(uid);
    this.restyle();
    this.updateDimmer();
  }

  /** L'ordine di una carta: il suo z, più il sollevamento dei candidati in mira. */
  private liftedZ(uid: string): number {
    return (this.baseZ.get(uid) ?? 0) + (this.aimState?.candidates.has(uid) ? AIM_LIFT : 0);
  }

  /** §7.2 — il posto della Reattiva numero `index` in catena (al centro, a scaletta): la regia ci fa volare la carta prima che si giochi. */
  chainSpot(index: number): { x: number; y: number; w: number; h: number } | null {
    const L = this.last?.L;
    if (!L) return null;
    return { ...chainSpotOf(L, index), w: L.tileW, h: L.tileH };
  }

  /** Il candidato sotto il puntatore durante la mira: l'anello pieno (aimed); null lo spegne. */
  hoverAim(uid: string | null): void {
    if (this.aimHover === uid) return;
    const before = this.aimHover;
    this.aimHover = uid;
    if (before) this.restyle(before);
    if (uid) this.restyle(uid);
  }

  /** §6.5 — lo scarto possibile: la tua Zona di Ritiro si accende (gestures.ts lo decide con canDiscard). */
  setDiscardHint(on: boolean): void {
    if (this.discardOn === on) return;
    this.discardOn = on;
    if (this.last) this.paintDiscard(this.last.L, this.stage.visible().scale * this.stage.app.renderer.resolution);
  }

  /** I segni dei gesti (gesti.ts): l'anello rubino di chi ha un gesto, il velo di chi in mano non si può giocare. */
  marks(marks: { tableGestures: Iterable<string>; veiled: Iterable<string> }): void {
    this.actionUids = new Set(marks.tableGestures);
    this.veiledUids = new Set(marks.veiled);
    this.restyle();
  }

  /** Il riquadro di una carta in unità di progetto, senza l'ombra: coricata, largo e alto si scambiano. */
  box(uid: string): { x: number; y: number; w: number; h: number } | undefined {
    const view = this.views.get(uid);
    if (!view || !this.last) return undefined;
    const { tileW, tileH } = this.last.L;
    const tapped = view.isTapped;
    const w = tapped ? tileH : tileW;
    const h = tapped ? tileW : tileH;
    // Le carte della mano stanno nel cassetto, che ripiegato scende.
    const lift = view.parent === this.hand ? this.hand.y : 0;
    return { x: view.x - w / 2, y: view.y - h / 2 + lift, w, h };
  }

  /** L'impaginazione dell'ultimo disegno: dove stanno le file e i riquadri. */
  layout(): TableLayout | null {
    return this.last?.L ?? null;
  }

  /** §3.1 — l'Entità che riceverebbe l'Oggetto trascinato, finché il dito è sopra. */
  markAssign(uid: string | null): void {
    if (this.assignTarget === uid) return;
    const before = this.assignTarget;
    this.assignTarget = uid;
    if (before) this.restyle(before);
    if (uid) this.restyle(uid);
  }

  /** Mentre un effetto agisce il tavolo è fermo: niente gesti su campo, mano e fase finché la fonte non si spegne. */
  setBlocked(on: boolean): void {
    this.root.eventMode = on ? "none" : "passive";
  }

  isBlocked(): boolean {
    return this.root.eventMode === "none";
  }

  /** Nessuna carta sta entrando in mano. */
  isStill(): boolean {
    return this.still.isStill();
  }

  /** Si risolve quando la cascata della pesca è finita. */
  idle(): Promise<void> {
    return this.still.idle();
  }

  /** Il momento di una carta: l'anello (il colpo vince sulla luce, la luce sulla mira, la mira sui gesti), l'opacità della mira, il velo. */
  private moment(uid: string, zone: ZoneId): { ring: Ring | null; alpha: number; veiled: boolean } {
    const aim = this.aimState;
    let ring: Ring | null = this.actionUids.has(uid) ? "gestures" : null;
    let alpha = 1;
    if (aim) {
      ring = null;
      if (aim.candidates.has(uid)) ring = aim.legalOnes.has(uid) ? "legal" : "pickable";
      if (ring !== null && this.aimHover === uid) ring = "aimed";
      if (ring === "pickable") alpha = 0.6;
      else if (!ring) alpha = zone === "hand" ? 0.35 : 0.3;
    }
    // Le Reattive in catena restano accese, anche durante la mira.
    if (this.inChain.has(uid)) {
      ring = "chain";
      alpha = 1;
    }
    if (this.assignTarget === uid) ring = "assign";
    if (this.lights.has(uid)) ring = "trigger";
    if (this.hits.has(uid)) ring = "struck";
    return { ring, alpha, veiled: this.veiledUids.has(uid) };
  }

  /**
   * §7.2 — con la catena aperta il tavolo va in penombra e non si tocca
   * (deciso 2026-09-11): si risponde dalla mano, o si accetta dalla barra.
   * La mira di un effetto mentre la catena si risolve ritira la penombra —
   * spegne da sé ciò che non si sceglie — e il campo torna sensibile.
   */
  private updateDimmer(): void {
    const dark = this.chainOpen && !this.aimState;
    this.dimmer.clear();
    if (dark) {
      const visible = this.stage.visible();
      this.dimmer.rect(visible.x, visible.y, visible.width, visible.height).fill({ color: 0x060408, alpha: 0.5 });
    }
    this.cards.eventMode = dark ? "none" : "passive";
    this.pileHits.eventMode = dark ? "none" : "passive";
  }

  /** Le zone delle pile pubbliche e il tasto della fila avversaria: si rifanno a ogni disegno. */
  private updateHits(L: TableLayout): void {
    for (const child of this.pileHits.removeChildren()) child.destroy();
    for (const child of this.foeRowHits.removeChildren()) child.destroy();
    const tapZone = (layer: Container, x: number, y: number, w: number, h: number, run: () => void): void => {
      const hit = new Container({ label: "pile" });
      hit.eventMode = "static";
      hit.cursor = "pointer";
      hit.hitArea = new Rectangle(x, y, w, h);
      hit.on("pointertap", run);
      layer.addChild(hit);
    };
    // §5 — l'Abisso e la Zona di Ritiro sono pubblici: si aprono con un tocco.
    if (L.mine.back !== null) {
      for (const pile of PILE) {
        if (pile.zone === "deck") continue;
        tapZone(this.pileHits, L.x(pile.x), L.mine.back, L.tileW, L.tileH, () => this.pile(this.me, pile.zone));
      }
    }
    const foe = otherSeat(this.me);
    // Il tasto tace quando la Zona di Controllo tiene la fila aperta da sé: non c'è nulla da ridurre.
    const toggle = this.foeToggleBox(L);
    if (!this.last || !this.foeControls(this.last.state)) {
      const hit = new Container({ label: "foe-row-toggle" });
      hit.eventMode = "static";
      hit.cursor = "pointer";
      hit.hitArea = new Rectangle(toggle.x, toggle.y, toggle.w, toggle.h);
      hit.on("pointertap", () => {
        this.foeRowOpen = !this.foeRowOpen;
        this.hoverFoeToggle(false);
        this.redraw();
      });
      hit.on("pointerover", () => this.hoverFoeToggle(true));
      hit.on("pointerout", () => this.hoverFoeToggle(false));
      this.foeRowHits.addChild(hit);
    } else {
      this.foeToggleHover = false;
    }
    if (L.foe.back !== null) {
      for (const zone of ["abisso", "ritiro"] as const) tapZone(this.pileHits, L.x(foePileX(zone)!), L.foe.back, L.tileW, L.tileH, () => this.pile(foe, zone));
    }
  }

  /** §8.2 — l'avversario controlla una carta: la sua fila di servizio resta aperta da sé (layout.ts, foeBack). */
  private foeControls(state: GameState): boolean {
    return Object.values(state.cards).some(card => card.zone === "field" && card.controller === otherSeat(this.me));
  }

  /** Le voci del tasto della fila avversaria: chiuso, i conti (Mano 4 · Abisso 2 · Ritiro 5 · Mazzo 26); aperto, «Riduci». */
  private foeToggleTokens(state: GameState, L: TableLayout): { open: boolean; tokens: ToggleToken[] } {
    const foe = otherSeat(this.me);
    if (L.foe.back !== null) return { open: true, tokens: [{ label: t("foe.row.close"), n: null }] };
    return { open: false, tokens: FOE_PILES.map(entry => ({ label: t(entry.label), n: String(zoneCards(state, foe, entry.zone).length) })) };
  }

  /** Il tasto della fila avversaria: in alto a destra, a cavallo dell'orlo del campo avversario, largo quanto le sue voci. */
  private foeToggleBox(L: TableLayout): { x: number; y: number; w: number; h: number } {
    const tokens = this.last ? this.foeToggleTokens(this.last.state, L).tokens : [];
    const inner = tokens.reduce((sum, token, index) => sum + textWidth(header, token.label) + (token.n === null ? 0 : TOKEN_GAP + textWidth(headerNum, token.n)) + (index > 0 ? TOKEN_SEP : 0), 0);
    const w = Math.max(120, TOGGLE_PAD + CHEVRON + TOGGLE_INNER + inner + TOGGLE_PAD);
    return { x: L.halfX + L.halfW - w, y: L.foe.top - FOE_TOGGLE_H / 2, w, h: FOE_TOGGLE_H };
  }

  /**
   * Il tasto della fila avversaria (2026-09-16): la piastra brunita col filo
   * nella tinta del posto avversario, le due frecce — giù per aprire, su per
   * ridurre — e le voci: il nome smorzato, il conto acceso, un punto di tinta
   * fra l'una e l'altra. Al passaggio si accende (filo pieno, alone, scritte
   * chiare). Tace quando la Zona di Controllo tiene la fila aperta da sé.
   */
  private paintFoeToggle(state: GameState, L: TableLayout, visible: Visible, resolution: number): void {
    this.foeToggle.visible = !this.foeControls(state);
    if (!this.foeToggle.visible) return;
    const tint = this.tints[otherSeat(this.me)];
    const palette = SEAT_PALETTE[tint];
    const { open, tokens } = this.foeToggleTokens(state, L);
    const box = this.foeToggleBox(L);
    const hover = this.foeToggleHover;
    const key = JSON.stringify([open, tokens, box.x, box.w, hover, tint]);
    const area = snapped(visible, resolution, box.x - PIECE_MARGIN, box.y - PIECE_MARGIN, box.w + 2 * PIECE_MARGIN, box.h + 2 * PIECE_MARGIN);
    this.paintRegion(this.foeToggle, key, area, resolution, ctx => {
      const rim = [palette.rim[0], palette.rim[1], palette.rim[2]] as [number, number, number];
      plate(ctx, box.x, box.y, box.w, box.h, { shadow: true, edge: rgba(rim, hover ? 0.95 : 0.5), ...(hover ? { glow: rgba(rim, 0.55) } : {}), darkBackground: true });
      // Il filo di tinta in cima, al posto di quello bianco.
      ctx.fillStyle = rgba(rim, hover ? 0.9 : 0.5);
      ctx.fillRect(box.x + 1, box.y + 1, box.w - 2, 1);
      // Le due frecce (viewBox 24, a 16 px, come il tasto della mano).
      const cy = box.y + box.h / 2;
      ctx.save();
      ctx.translate(box.x + TOGGLE_PAD + CHEVRON / 2 - 8, cy - 8);
      ctx.scale(16 / 24, 16 / 24);
      ctx.strokeStyle = hover ? "#ffffff" : palette.name;
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const [edge, tip] of open ? [[11, 6], [18, 13]] : [[6, 11], [13, 18]]) {
        ctx.beginPath();
        ctx.moveTo(7, edge);
        ctx.lineTo(12, tip);
        ctx.lineTo(17, edge);
        ctx.stroke();
      }
      ctx.restore();
      let x = box.x + TOGGLE_PAD + CHEVRON + TOGGLE_INNER;
      const textY = box.y + (box.h - header.size) / 2 - 1;
      tokens.forEach((token, index) => {
        if (index > 0) {
          ctx.fillStyle = rgba(rim, 0.85);
          ctx.beginPath();
          ctx.arc(x + TOKEN_SEP / 2, cy, 1.7, 0, Math.PI * 2);
          ctx.fill();
          x += TOKEN_SEP;
        }
        paintText(ctx, token.label, x, textY, hover ? THEME.ink : THEME.muted, header);
        x += textWidth(header, token.label);
        if (token.n !== null) {
          x += TOKEN_GAP;
          paintText(ctx, token.n, x, textY, hover ? "#ffffff" : THEME.ink, headerNum);
          x += textWidth(headerNum, token.n);
        }
      });
    });
  }

  /** Ridipinge i momenti (di una carta, o di tutte) sull'ultima vista. */
  private restyle(only?: string): void {
    for (const [uid, view] of this.views) {
      if (only !== undefined && uid !== only) continue;
      const look = this.lastLooks.get(uid);
      if (look) view.update({ ...look, ...this.moment(uid, this.zone.get(uid) ?? "field") });
    }
  }

  /** Chi chiude la fase quando si preme il gesto di fase (F4). Nell'apertura (§4) il gesto è «Tieni la mano». */
  onEndPhase(listener: () => void): void {
    this.closePhase = listener;
  }

  /** §4 — chi fa il mulligan quando si preme il tasto «Mulligan». */
  onMulligan(listener: () => void): void {
    this.doMulligan = listener;
  }

  /** I Rubyfront nascosti per l'ingresso tornano in vista (l'ingresso non c'è stato). */
  revealRubyfronts(): void {
    for (const [uid, view] of this.views) {
      const info = this.info.get(uid);
      if (info && isRubyfront(info.cardId) && !view.destroyed) view.visible = true;
    }
  }

  /** Aspetta che tutte le facce in vista siano dipinte. */
  async ready(): Promise<void> {
    await Promise.all([...this.views.values()].map(view => view.ready));
  }

  show(state: GameState): void {
    const visible = this.stage.visible();
    // §8.2 — se l'avversario controlla una carta, il suo campo si estende
    // con la Zona di Controllo (layout.ts, foeBack); e si estende anche dal
    // tasto, per vedere le sue pile e la sua mano.
    const foeControls = this.foeControls(state);
    const foeBack = foeControls || this.foeRowOpen;
    const L = layout(visible, { foeBack });
    const resolution = visible.scale * this.stage.app.renderer.resolution;
    const facts = (cardId: string) => cardFacts(cardId, this.locale);
    this.lastPaint = { visible, resolution };
    // La fila avversaria che si apre o si chiude: la foto e i posti di prima, per l'animazione (endMorph, in fondo).
    const morph = this.last && this.last.L.foe.back !== null !== foeBack && !reducedMotion() ? this.beginMorph(visible, resolution) : null;
    this.last = { state, L };
    for (const seat of ["a", "b"] as const) {
      const deckId = state.players[seat].deckId;
      this.tints[seat] = deckId ? deckTint(deckId) : "dynamic";
    }
    // La valle e la grana del tema notte: al primo disegno si caricano, e arrivate si ridisegna.
    if (!this.nightReady) {
      this.nightReady = true;
      void loadNight(resolution).then(() => {
        if (this.last && !this.root.destroyed) this.show(this.last.state);
      });
    }

    // Il fondo: i due campi, i riquadri, le etichette. Un pezzo solo, che
    // cambia con la finestra, le tinte e il Controllo; le scritte delle pile
    // col loro conto stanno in un pezzo a parte, sopra.
    const controlled = Object.values(state.cards).some(card => card.zone === "field" && card.controller === this.me);
    this.paintKeyed(this.background, `${visible.x}|${visible.y}|${this.tints.a}|${this.tints.b}|${controlled}|${foeControls}|${foeBack}|${Boolean(NIGHT.valley)}|${Boolean(NIGHT.stone)}`, visible.width, visible.height, resolution, ctx => {
      ctx.translate(-visible.x, -visible.y);
      this.paintBackground(ctx, controlled, foeControls, L, visible);
    });
    this.background.position.set(visible.x, visible.y);
    this.paintPileLabels(state, L, visible, resolution);
    this.paintFoePileLabels(state, L, visible, resolution);

    // Le carte: in campo, in cima alle tue pile, nella tua mano.
    const alive = new Set<string>();
    // Il tap e lo stap di più carte insieme girano in fila, da sinistra.
    const turning = Object.values(state.cards)
      .filter(card => card.zone === "field" && this.lastLooks.has(card.uid) && this.lastLooks.get(card.uid)!.tapped !== card.tapped)
      .sort((p, q) => p.x - q.x);
    const tapDelays = new Map(turning.map((card, index) => [card.uid, Math.min(index, 8) * TAP_STAGGER_MS]));
    const place = (card: CardInstance, layer: Container, x: number, y: number, look: Omit<CardLook, "w" | "h" | "locale" | "resolution">): void => {
      alive.add(card.uid);
      let view = this.views.get(card.uid);
      if (!view) {
        const created = new TableCard(card.uid);
        const uid = card.uid;
        created.on("pointerover", event => this.emit("over", uid, event.global));
        created.on("pointerout", event => this.emit("out", uid, event.global));
        let pressTimer: ReturnType<typeof setTimeout> | undefined;
        created.on("pointerdown", event => {
          this.emit("grab", uid, event.global);
          if (event.pointerType !== "touch") return;
          const at = { x: event.global.x, y: event.global.y };
          clearTimeout(pressTimer);
          pressTimer = setTimeout(() => this.emit("menu", uid, at), LONG_PRESS_MS);
        });
        const release = (): void => clearTimeout(pressTimer);
        created.on("pointerup", release);
        created.on("pointerupoutside", release);
        created.on("pointerleave", release);
        created.on("rightclick", event => this.emit("menu", uid, event.global));
        created.on("pointertap", event => {
          const now = performance.now();
          const isDouble = this.lastTap.uid === uid && now - this.lastTap.at < DOUBLE_TAP_MS;
          this.lastTap = isDouble ? { uid: "", at: 0 } : { uid, at: now };
          this.emit(isDouble ? "double" : "tap", uid, event.global);
        });
        view = created;
        if (this.hideOnCreate?.(card)) created.visible = false;
        this.views.set(card.uid, view);
      }
      this.zone.set(card.uid, card.zone);
      this.info.set(card.uid, { cardId: look.cardId, face: look.face, back: look.back });
      if (view.parent !== layer) layer.addChild(view);
      view.position.set(x + L.tileW / 2, y + L.tileH / 2);
      this.bases.set(card.uid, { x: x + L.tileW / 2, y: y + L.tileH / 2 });
      this.baseZ.set(card.uid, card.zone === "field" ? card.z : 0);
      view.zIndex = this.liftedZ(card.uid);
      const full: CardLook = { ...look, tapDelay: tapDelays.get(card.uid) ?? 0, w: L.tileW, h: L.tileH, ui: L.ui, locale: this.locale, resolution };
      this.lastLooks.set(card.uid, full);
      view.update({ ...full, ...this.moment(card.uid, card.zone) });
    };

    const combat = new Map<string, CardLook["combat"]>();
    for (const declaration of state.declarations) {
      if (declaration.kind === "attack") combat.set(declaration.from, { kind: "attack", order: declaration.order });
      else combat.set(declaration.from, { kind: declaration.kind });
    }

    // §7.2 — la catena: le Reattive giocate stanno al centro, nel varco fra
    // i due campi, a scaletta (table.ts, chainSpot), in luce sopra la penombra.
    const stack = state.chain?.stack ?? [];
    this.inChain = new Set(stack);
    this.chainOpen = Boolean(state.chain);
    for (const card of Object.values(state.cards)) {
      if (card.zone !== "field") continue;
      const chainIndex = stack.indexOf(card.uid);
      const spot = chainIndex >= 0 ? chainSpotOf(L, chainIndex) : L.screenPos(card.x, card.y, this.me);
      place(card, chainIndex >= 0 ? this.chain : this.cards, spot.x, spot.y, {
        cardId: card.cardId,
        face: card.face,
        back: card.facedown,
        tapped: card.tapped,
        badges: card.facedown ? null : badges(state, card, facts, t("tile.noblock")),
        combat: combat.get(card.uid) ?? null,
      });
    }

    // Le tue pile: la carta in cima, il mazzo sempre coperto.
    for (const pile of PILE) {
      const top = zoneCards(state, this.me, pile.zone)[0];
      if (!top) continue;
      place(top, this.cards, L.x(pile.x), L.mine.back!, { cardId: top.cardId, face: top.face, back: pile.zone === "deck", tapped: false, badges: null, combat: null });
    }

    // La fila di servizio avversaria aperta: le cime delle sue tre pile e un
    // dorso per la sua mano, sopra il suo Fronte.
    const foe = otherSeat(this.me);
    if (L.foe.back !== null) {
      for (const entry of FOE_PILES) {
        const top = zoneCards(state, foe, entry.zone)[0];
        if (!top) continue;
        place(top, this.cards, L.x(entry.x), L.foe.back, { cardId: top.cardId, face: top.face, back: entry.back, tapped: false, badges: null, combat: null });
      }
    }

    // La mano: una fila da sinistra, 10 fra una carta e l'altra; se non ci
    // stanno si accavallano.
    const hand = zoneCards(state, this.me, "hand");
    const room = L.hand.w - 32 - (TOGGLE_W + TOGGLE_MARGIN);
    const step = hand.length > 1 ? Math.min(L.tileW + 10, (room - L.tileW) / (hand.length - 1)) : 0;
    const handY = L.hand.y + L.hand.h - 14 - L.tileH;
    hand.forEach((card, index) => {
      place(card, this.hand, L.hand.x + 16 + index * step, handY, { cardId: card.cardId, face: card.face, back: false, tapped: false, badges: null, combat: null, cost: this.costOf?.(card) ?? null });
    });
    this.handEntries(hand.map(card => card.uid));

    for (const [uid, view] of this.views) {
      if (alive.has(uid)) continue;
      view.destroy({ children: true });
      this.views.delete(uid);
      this.zone.delete(uid);
      this.info.delete(uid);
      this.lastLooks.delete(uid);
      this.bases.delete(uid);
    }

    // Il cassetto della mano, sotto le sue carte.
    this.paintKeyed(this.drawer, this.tints[this.me], L.hand.w, L.hand.h + DRAWER_GAP, resolution, ctx => this.paintDrawer(ctx, L));
    this.drawer.position.set(L.hand.x, L.hand.y - DRAWER_GAP);
    this.paintHandTag(hand.length, L, resolution);
    this.paintDiscard(L, resolution);
    // Ripiegata, la mano resta giù (se non sta già scivolando); il tasto si ridipinge col tavolo.
    if (!this.handSliding) this.hand.y = this.handLift(L, hand.length);
    this.paintHandToggle(L, resolution);

    // Sopra tutto: le targhe dei posti, il tasto della fila avversaria, il gesto di fase — ognuno nel suo pezzo.
    this.syncHp(state);
    this.paintOverlay(state, L, visible, resolution);

    // Le zone che si toccano.
    this.updateHits(L);
    this.updateDimmer();

    // La fila avversaria che si apre o si chiude: il fondo di prima si dissolve, le carte scivolano al posto nuovo.
    if (morph) this.endMorph(morph, L, visible);

    // Il vetro del cassetto si rifà quando le facce in vista sono pronte.
    void this.ready();
  }

  // ------------------------------------------- la fila avversaria che si apre

  /**
   * Prima del ridisegno: i centri delle carte com'erano, e una foto del fondo
   * e delle targhe (senza carte né voli) da dissolvere sul nuovo.
   */
  private beginMorph(visible: Visible, resolution: number): Morph {
    const bases = new Map<string, { x: number; y: number }>();
    for (const [uid, base] of this.bases) bases.set(uid, { x: base.x, y: base.y });
    const layers = [this.cards, this.hand, this.flights, this.arrows, this.chain, this.dimmer, this.discardHalo, this.discardFrame, this.discardTag, this.transition, this.handToggle, this.foeRowHits, this.pileHits];
    const shown = layers.map(layer => layer.visible);
    for (const layer of layers) layer.visible = false;
    let texture: Texture | null = null;
    try {
      texture = this.stage.app.renderer.generateTexture({ target: this.root, frame: new Rectangle(visible.x, visible.y, visible.width, visible.height), resolution: Math.min(resolution, 1.5) });
    } catch {
      texture = null;
    }
    layers.forEach((layer, index) => (layer.visible = shown[index] ?? true));
    return { bases, tileW: this.last?.L.tileW ?? 0, texture };
  }

  /**
   * Dopo il ridisegno (2026-09-16, «un'animazione all'apertura»): la foto di
   * prima si dissolve in MORPH_MS; ogni carta parte dal centro e dalla
   * misura di prima e scivola al posto nuovo; le carte nuove (la fila
   * avversaria appena aperta) scendono dall'orlo accendendosi. Le scene
   * aspettano che finisca (Stillness).
   */
  private endMorph(morph: Morph, L: TableLayout, visible: Visible): void {
    const ticker = this.stage.app.ticker;
    const done = this.still.hold();
    const runs: Promise<void>[] = [];
    if (morph.texture) {
      const texture = morph.texture;
      this.transition.texture = texture;
      this.transition.position.set(visible.x, visible.y);
      this.transition.width = visible.width;
      this.transition.height = visible.height;
      this.transition.alpha = 1;
      this.transition.visible = true;
      // La foto se ne va prima che le carte arrivino: meno doppia esposizione.
      runs.push(
        tween(ticker, MORPH_MS * 0.7, k => (this.transition.alpha = 1 - k), easeOut).finally(() => {
          if (this.transition.texture === texture) {
            this.transition.visible = false;
            this.transition.texture = Texture.EMPTY;
          }
          texture.destroy(true);
        })
      );
    }
    const ratio = morph.tileW > 0 ? morph.tileW / L.tileW : 1;
    for (const [uid, view] of this.views) {
      if (view.destroyed || (view.parent !== this.cards && view.parent !== this.hand)) continue;
      const to = this.bases.get(uid);
      if (!to) continue;
      const from = morph.bases.get(uid);
      // Il posto d'arrivo si rilegge a ogni passo: un ridisegno nel frattempo lo può spostare.
      const target = (): { x: number; y: number } => this.bases.get(uid) ?? to;
      if (from) {
        if (Math.abs(from.x - to.x) < 0.5 && Math.abs(from.y - to.y) < 0.5 && Math.abs(ratio - 1) < 0.001) continue;
        view.position.set(from.x, from.y);
        view.scale.set(ratio);
        runs.push(
          tween(ticker, MORPH_MS, k => {
            if (view.destroyed) throw new Error("carta sparita");
            const at = target();
            view.position.set(from.x + (at.x - from.x) * k, from.y + (at.y - from.y) * k);
            view.scale.set(ratio + (1 - ratio) * k);
          }, easeInOut).then(
            () => {
              if (view.destroyed) return;
              const at = target();
              view.position.set(at.x, at.y);
              view.scale.set(1);
            },
            () => undefined
          )
        );
      } else {
        // La carta nuova può non avere ancora la faccia (alpha 0 finché non è
        // pronta): il traguardo è l'opacità del suo momento, non quella di adesso.
        const alpha = this.lastLooks.get(uid)?.alpha ?? 1;
        const lift = L.tileH * 0.4;
        view.alpha = 0;
        view.position.set(to.x, to.y - lift);
        runs.push(
          tween(ticker, MORPH_MS, k => {
            if (view.destroyed) throw new Error("carta sparita");
            const at = target();
            view.position.set(at.x, at.y - lift * (1 - k));
            view.alpha = alpha * k;
          }, easeOut).then(
            () => {
              if (view.destroyed) return;
              const at = target();
              view.position.set(at.x, at.y);
              view.alpha = alpha;
            },
            () => undefined
          )
        );
      }
    }
    void Promise.allSettled(runs).then(done);
  }

  // ------------------------------------------------------ i pezzi dipinti

  /**
   * Dipinge un pezzo solo se ciò che mostra è cambiato (2026-09-13, «quando
   * ci sono più animazioni il gioco inizia a laggare»): a ogni stato nuovo il
   * tavolo rifaceva il fondo e il sopra a tutto schermo — la grana, i
   * castoni, due fogli da milioni di pixel da ricaricare sulla scheda video —
   * e i fotogrammi si fermavano fino a 300 ms proprio mentre le animazioni
   * correvano. `key` dice tutto ciò che `draw` legge oltre alla misura, alla
   * risoluzione e alla lingua: se `draw` legge altro, va nella chiave.
   */
  private paintKeyed(sprite: Sprite, key: string, w: number, h: number, resolution: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
    const full = `${key}|${w}|${h}|${resolution}|${lang()}`;
    if (this.painted.get(sprite) === full) return;
    this.painted.set(sprite, full);
    replace(sprite, paintPiece(w, h, resolution, draw));
  }

  /** Un pezzo dipinto in coordinate del tavolo dentro il suo riquadro (`snapped`), e posato lì. */
  private paintRegion(sprite: Sprite, key: string, box: PieceBox, resolution: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
    this.paintKeyed(sprite, `${key}|${box.x}|${box.y}`, box.w, box.h, resolution, ctx => {
      ctx.translate(-box.x, -box.y);
      draw(ctx);
    });
    sprite.position.set(box.x, box.y);
  }

  /** Le scritte delle tue pile col loro conto, sotto gli alloggi della fila di servizio. */
  private paintPileLabels(state: GameState, L: TableLayout, visible: Visible, resolution: number): void {
    const back = L.mine.back;
    this.pileLabels.visible = back !== null;
    if (back === null) return;
    const font = scaled(rowLabel, L.ui);
    const labels = PILE.map(pile => ({ x: L.x(pile.x) + 4, text: `${t(pile.label)} · ${zoneCards(state, this.me, pile.zone).length}` }));
    const left = Math.min(...labels.map(label => label.x));
    const right = Math.max(...labels.map(label => label.x + textWidth(font, label.text)));
    const top = back + L.tileH + 10;
    const box = snapped(visible, resolution, left - PIECE_MARGIN, top - PIECE_MARGIN, right - left + 2 * PIECE_MARGIN, font.size + 2 * PIECE_MARGIN);
    this.paintRegion(this.pileLabels, `${labels.map(label => label.text).join("|")}|${L.ui}`, box, resolution, ctx => {
      for (const label of labels) paintText(ctx, label.text, label.x, top, THEME.lettering, font, LABEL_SHADOWS);
    });
  }

  /** Le scritte delle pile avversarie e della sua mano col loro conto, sotto la sua fila di servizio (aperta). */
  private paintFoePileLabels(state: GameState, L: TableLayout, visible: Visible, resolution: number): void {
    const back = L.foe.back;
    this.foePileLabels.visible = back !== null;
    if (back === null) return;
    const foe = otherSeat(this.me);
    const font = scaled(rowLabel, L.ui);
    const labels = FOE_PILES.map(entry => ({ x: L.x(entry.x) + 4, text: `${t(entry.label)} · ${zoneCards(state, foe, entry.zone).length}` }));
    const left = Math.min(...labels.map(label => label.x));
    const right = Math.max(...labels.map(label => label.x + textWidth(font, label.text)));
    const top = back + L.tileH + 10;
    const box = snapped(visible, resolution, left - PIECE_MARGIN, top - PIECE_MARGIN, right - left + 2 * PIECE_MARGIN, font.size + 2 * PIECE_MARGIN);
    this.paintRegion(this.foePileLabels, `${labels.map(label => label.text).join("|")}|${L.ui}`, box, resolution, ctx => {
      for (const label of labels) paintText(ctx, label.text, label.x, top, THEME.lettering, font, LABEL_SHADOWS);
    });
  }

  // ------------------------------------------------------------- il fondo

  /** Legge solo ciò che sta nella sua chiave (show): la finestra, le tinte, il Controllo, la notte caricata. */
  private paintBackground(ctx: CanvasRenderingContext2D, controlled: boolean, foeControls: boolean, L: TableLayout, visible: { x: number; y: number; width: number; height: number }): void {
    const { x: vx, y: vy, width: vw, height: vh } = visible;
    // La stanza (.board del tema notte), dal fondo in su: il vuoto, la valle
    // già sfocata a coprire, un velo scuro, la grana di grafite, il bagliore
    // rubino della forgia in cima.
    ctx.fillStyle = THEME.background;
    ctx.fillRect(vx, vy, vw, vh);
    const valley = NIGHT.valley;
    if (valley) {
      const s = Math.max(vw / valley.naturalWidth, vh / valley.naturalHeight);
      const iw = valley.naturalWidth * s;
      const ih = valley.naturalHeight * s;
      ctx.drawImage(valley, vx + (vw - iw) / 2, vy + (vh - ih) / 2, iw, ih);
    }
    const veil = ctx.createLinearGradient(0, vy, 0, vy + vh);
    veil.addColorStop(0, "rgba(6,5,10,.36)");
    veil.addColorStop(0.45, "rgba(6,5,10,.2)");
    veil.addColorStop(1, "rgba(6,5,10,.42)");
    ctx.fillStyle = veil;
    ctx.fillRect(vx, vy, vw, vh);
    grain(ctx, vx, vy, vw, vh);
    // radial-gradient(70% 50% at 50% 0%, rgba(forge, .10), transparent 70%)
    ctx.save();
    ctx.translate(vx + vw / 2, vy);
    ctx.scale(vw * 0.7, vh * 0.5);
    const forge = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    forge.addColorStop(0, `rgba(${THEME.forge},.1)`);
    forge.addColorStop(0.7, `rgba(${THEME.forge},0)`);
    ctx.fillStyle = forge;
    ctx.fillRect(-1.5, -1, 3, 2);
    ctx.restore();

    const foe = otherSeat(this.me);
    for (const [seat, field] of [[foe, L.foe], [this.me, L.mine]] as const) {
      const mine = seat === this.me;
      const palette = SEAT_PALETTE[this.tints[seat]];
      bezel(ctx, { x: L.halfX, y: field.top, w: L.halfW, h: field.bottom - field.top }, palette);

      // Gli alloggi della fila del Fronte: il Rubyfront (col filo rubino), i cinque slot, le Materie (col filo blu).
      const slot = (canonX: number, y: number, edge: string | null, label: string | null): void => {
        const x = L.x(canonX);
        slotFrame(ctx, x, y, L.tileW, L.tileH, palette);
        if (edge) dashedRect(ctx, x, y, L.tileW, L.tileH, edge);
        if (label) paintText(ctx, t(label), x + 4, y + L.tileH + 10, THEME.lettering, scaled(rowLabel, L.ui), LABEL_SHADOWS);
      };
      slot(RUBYFRONT_X, field.front, "rgba(210,74,100,.42)", null);
      for (const x of FRONT_SLOT_X) slot(x, field.front, null, null);
      slot(MATTER_X, field.front, "rgba(143,176,255,.42)", "zone.matters");
      // Un'etichetta sola per i cinque slot, centrata sotto.
      const front = t("zone.front");
      paintText(ctx, front, L.x(FRONT_X) + (FRONT_W * L.s - textWidth(scaled(line, L.ui), front)) / 2, field.front + L.tileH + 13, THEME.lettering, scaled(line, L.ui), LABEL_SHADOWS);

      // La tua fila di servizio: gli alloggi delle pile (il conto lo scrive
      // paintPileLabels), e il Controllo se occupato.
      if (mine && field.back !== null) {
        for (const pile of PILE) slot(pile.x, field.back, null, null);
        if (controlled) slot(CONTROL_X, field.back, null, "zone.control");
      }
      // La fila di servizio avversaria (dal tasto, o per la sua Zona di
      // Controllo): le sue pile e la sua mano (il conto lo scrive
      // paintFoePileLabels), e il Controllo se occupato.
      if (!mine && field.back !== null) {
        for (const entry of FOE_PILES) slot(entry.x, field.back, null, null);
        if (foeControls) slot(CONTROL_X, field.back, null, "zone.control");
      }
    }
  }

  // ------------------------------------------------------------- lo scarto

  /**
   * La Zona di Ritiro che chiama (.slot.is-discard): il filo d'oro pieno e il
   * velo sull'alloggio, l'alone che respira attorno, e la targhetta d'oro
   * «Scarta qui fino a 7». La targhetta sta DENTRO l'alloggio, in cima: sopra
   * non c'è posto (il Fronte e l'etichetta delle Materie, a filo), e più giù
   * la coprirebbe il cassetto della mano. Spento, sparisce tutto.
   */
  private paintDiscard(L: TableLayout, resolution: number): void {
    const back = L.mine.back;
    const on = this.discardOn && back !== null;
    this.discardHalo.visible = this.discardFrame.visible = this.discardTag.visible = on;
    if (!on || back === null) return;
    const x = L.x(SLOT_X.ritiro);
    const y = back;
    const w = L.tileW;
    const h = L.tileH;
    // L'alone: l'ombra d'oro di un riquadro che poi si toglie (resta solo fuori), come il box-shadow.
    this.paintKeyed(this.discardHalo, "halo", w + 2 * DISCARD_MARGIN, h + 2 * DISCARD_MARGIN, resolution, ctx => {
      const a = ctx.getTransform().a;
      ctx.translate(DISCARD_MARGIN, DISCARD_MARGIN);
      // Due aloni: largo e caldo, poi stretto e chiaro a filo dell'alloggio.
      for (const [blur, color] of [[48, "rgba(217,168,78,.9)"], [16, "rgba(255,214,130,.95)"]] as const) {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = blur * a;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      ctx.clearRect(0, 0, w, h);
    });
    this.discardHalo.position.set(x - DISCARD_MARGIN, y - DISCARD_MARGIN);
    this.discardFrame.clear().rect(x, y, w, h).fill({ color: DISCARD_GOLD, alpha: 0.16 }).stroke({ color: DISCARD_GOLD, width: 2, alignment: 1 });
    // La targhetta, in cima all'alloggio e centrata: si legge come una richiesta.
    const label = t("slot.discard");
    const tw = Math.ceil(textWidth(discardTag, label)) + 24;
    const th = 26;
    const pad = 16;
    this.paintKeyed(this.discardTag, label, tw + 2 * pad, th + 2 * pad, resolution, ctx => {
      ctx.translate(pad, pad);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.55)";
      ctx.shadowBlur = 8 * ctx.getTransform().a;
      ctx.shadowOffsetY = 2 * ctx.getTransform().a;
      ctx.fillStyle = THEME.gold;
      ctx.fillRect(0, 0, tw, th);
      ctx.restore();
      paintText(ctx, label, 12, 5, "#0b090b", discardTag);
    });
    this.discardTag.position.set(x + (w - tw) / 2 - pad, y + 10 - pad);
  }

  // ------------------------------------------------------- la mano ripiegata

  /** Quanto scende la mano: ripiegata, tutto meno l'orlo; vuota non si ripiega (hand-mine.is-empty.is-collapsed). */
  private handLift(L: TableLayout, cards: number): number {
    return this.handCollapsed && cards > 0 ? L.hand.h - HAND_PEEK : 0;
  }

  /** Il tasto della mano: ripiega o riapre il cassetto, che scivola (hand-mine, transform in --morph-ms). */
  private toggleHand(): void {
    const last = this.last;
    if (!last) return;
    this.handCollapsed = !this.handCollapsed;
    const from = this.hand.y;
    const to = this.handLift(last.L, zoneCards(last.state, this.me, "hand").length);
    const slide = ++this.handSlide;
    this.handSliding = true;
    void tween(this.stage.app.ticker, HAND_SLIDE_MS, k => {
      if (slide === this.handSlide) this.hand.y = from + (to - from) * k;
    }, easeInOut).then(() => {
      if (slide === this.handSlide) this.handSliding = false;
    });
    this.paintHandToggle(last.L, this.stage.visible().scale * this.stage.app.renderer.resolution);
  }

  /**
   * Il tasto (.hand-toggle): piastra brunita dentro l'orlo destro del
   * cassetto; la doppia freccia in giù ripiega la mano, in su (spenta,
   * .is-off) la riapre. Resta fermo in fondo: la mano gli scivola sotto.
   */
  private paintHandToggle(L: TableLayout, resolution: number): void {
    const w = TOGGLE_W;
    const h = TOGGLE_H;
    const x = L.hand.x + L.hand.w - TOGGLE_MARGIN - w;
    const y = L.hand.y + L.hand.h - TOGGLE_MARGIN - h;
    const up = this.handCollapsed;
    const pad = 12;
    this.paintKeyed(this.handToggleFace, String(up), w + 2 * pad, h + 2 * pad, resolution, ctx => {
      ctx.translate(pad, pad);
      plate(ctx, 0, 0, w, h, { shadow: true, edge: THEME.line, darkBackground: true });
      // Le due frecce (viewBox 24, a 16 px): polilinee a tratto tondo.
      ctx.save();
      ctx.translate(w / 2 - 8, h / 2 - 8);
      ctx.scale(16 / 24, 16 / 24);
      ctx.strokeStyle = up ? THEME.muted : THEME.ink;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const [edge, tip] of up ? [[11, 6], [18, 13]] : [[6, 11], [13, 18]]) {
        ctx.beginPath();
        ctx.moveTo(7, edge);
        ctx.lineTo(12, tip);
        ctx.lineTo(17, edge);
        ctx.stroke();
      }
      ctx.restore();
    });
    this.handToggleFace.position.set(x - pad, y - pad);
    this.handToggle.hitArea = new Rectangle(x, y, w, h);
  }

  // ----------------------------------------------------------- il cassetto

  private paintDrawer(ctx: CanvasRenderingContext2D, L: TableLayout): void {
    const top = DRAWER_GAP;
    const a = ctx.getTransform().a;
    const { w, h } = L.hand;
    const tint = SEAT_PALETTE[this.tints[this.me]].hand;
    const hi = lighten(tint, 0.35);
    // Le ombre buttate all'insù (0 -20px 46px nero, 0 -6px 14px nella tinta):
    // si dipingono sotto una sagoma che poi si toglie, come il box-shadow.
    for (const [oy, blur, color] of [
      [-20, 46, "rgba(0,0,0,.55)"],
      [-6, 14, rgba(tint, 0.28)],
    ] as const) {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = blur * a;
      ctx.shadowOffsetY = oy * a;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, top, w, h);
      ctx.restore();
    }
    ctx.clearRect(0, top, w, h);
    // Il velo scuro, appena più denso in fondo, e la luce della tinta che scende dall'orlo.
    const veil = ctx.createLinearGradient(0, top, 0, top + h);
    veil.addColorStop(0, "rgba(5,4,9,.5)");
    veil.addColorStop(1, "rgba(5,4,9,.66)");
    ctx.fillStyle = veil;
    ctx.fillRect(0, top, w, h);
    const light = ctx.createLinearGradient(0, top + 2, 0, top + 62);
    light.addColorStop(0, rgba(tint, 0.28));
    light.addColorStop(18 / 60, rgba(tint, 0.06));
    light.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = light;
    ctx.fillRect(0, top + 2, w, 60);
    // Il filo neon in cima e la barra d'accento a sinistra.
    ctx.fillStyle = hi;
    ctx.fillRect(0, top, w, 2);
    ctx.fillRect(24, top + 2, w * 0.22, 6);
    // L'appiglio.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.8)";
    ctx.shadowOffsetY = 1 * a;
    ctx.fillStyle = "rgba(255,255,255,.28)";
    ctx.fillRect(w / 2 - 36, top + 10, 72, 4);
    ctx.restore();
  }

  /**
   * La targhetta «La tua mano · n», appoggiata sull'orlo del cassetto: piastra
   * scura col filo nella tua tinta, rubino oltre le 7. Nel cassetto stava a 24
   * dall'orlo sinistro e 11 sopra il filo: il pezzo si aggancia alla griglia
   * dei pixel del cassetto, così cade dove cadeva.
   */
  private paintHandTag(n: number, L: TableLayout, resolution: number): void {
    const tint = SEAT_PALETTE[this.tints[this.me]].hand;
    const hi = lighten(tint, 0.35);
    const excess = n > 7;
    const font: Font = { ...tag, weight: 700 };
    const label = t("hand.mine", { n });
    const tw = textWidth(font, label) + 24;
    const tx = L.hand.x + 24;
    const ty = L.hand.y - 11;
    const box = snapped({ x: L.hand.x, y: L.hand.y - DRAWER_GAP }, resolution, tx - PIECE_MARGIN, ty - PIECE_MARGIN, tw + 2 * PIECE_MARGIN, 26 + 2 * PIECE_MARGIN);
    this.paintRegion(this.handTag, `${label}|${excess}|${tint}`, box, resolution, ctx => {
      const a = ctx.getTransform().a;
      const edge = excess ? THEME.ruby : hi;
      ctx.save();
      ctx.shadowColor = rgba(tint, 0.35);
      ctx.shadowBlur = 10 * a;
      ctx.fillStyle = "rgba(6,5,10,.94)";
      ctx.fillRect(tx, ty, tw, 26);
      ctx.restore();
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.55)";
      ctx.shadowBlur = 8 * a;
      ctx.shadowOffsetY = 2 * a;
      ctx.fillStyle = "rgba(6,5,10,.94)";
      ctx.fillRect(tx, ty, tw, 26);
      ctx.restore();
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1;
      ctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, 25);
      paintText(ctx, label, tx + 12, ty + 5, excess ? "#ffb3c2" : "#f4f1f3", font);
    });
  }

  // ---------------------------------------------------------------- sopra

  // --------------------------------------------------- i PV che scalano

  /**
   * I PV delle testate non saltano al numero nuovo: scalano un punto alla
   * volta (2026-09-13, «far scalare i punti progressivamente ogni volta che
   * si riceve un attacco»). Senza prese il bersaglio è lo stato; la prima
   * volta si parte già lì.
   */
  private syncHp(state: GameState): void {
    for (const seat of ["a", "b"] as const) {
      const hp = state.players[seat].hp;
      if (this.hpShown[seat] === null) this.hpShown[seat] = this.hpTarget[seat] = hp;
      else if (this.hpHolds.size === 0) this.hpTarget[seat] = hp;
    }
  }

  /**
   * La risoluzione tiene i PV delle testate dove sono: scaleranno a ogni
   * colpo che arriva (countHp) e, lasciati, fino allo stato. Torna chi
   * lascia; una presa dimenticata si lascia da sola dopo HP_HOLD_MAX_MS.
   */
  holdHp(): () => void {
    const id = ++this.hpHoldSeq;
    this.hpHolds.add(id);
    for (const seat of ["a", "b"] as const) {
      const shown = this.hpShown[seat];
      if (shown !== null) this.hpTarget[seat] = shown;
    }
    const release = (): void => {
      clearTimeout(timer);
      if (!this.hpHolds.delete(id)) return;
      if (this.hpHolds.size === 0 && this.last) this.syncHp(this.last.state);
    };
    const timer = setTimeout(release, HP_HOLD_MAX_MS);
    return release;
  }

  /** Un colpo che arriva durante la presa: i PV mostrati del posto scalano di `delta` (negativo il danno). */
  countHp(seat: Seat, delta: number): void {
    if (this.hpHolds.size === 0 || this.hpShown[seat] === null) return;
    this.hpTarget[seat] += delta;
  }

  /** Un punto per passo verso il bersaglio: tanti punti da scalare, passo svelto; gli ultimi si contano. */
  private stepHp(): void {
    const now = performance.now();
    const last = this.last;
    if (now < this.hpNextStep || !last) return;
    let left = -1;
    for (const seat of ["a", "b"] as const) {
      const shown = this.hpShown[seat];
      const target = this.hpTarget[seat];
      if (shown === null || shown === target) continue;
      const next = reducedMotion() ? target : shown + Math.sign(target - shown);
      this.hpShown[seat] = next;
      left = Math.max(left, Math.abs(target - next));
      const visible = this.stage.visible();
      this.paintSeatHead(seat, last.state, last.L, visible, visible.scale * this.stage.app.renderer.resolution);
    }
    if (left >= 0) this.hpNextStep = now + Math.max(HP_STEP_MIN_MS, Math.min(HP_STEP_MAX_MS, HP_RUN_MS / (left + 1)));
  }

  /** La testata di un posto, a cavallo dell'orlo in alto a sinistra: i PV mostrati, Gettone e Flusso sul filo, poi la targhetta del nome. */
  private paintSeatHead(seat: Seat, state: GameState, L: TableLayout, visible: Visible, resolution: number): void {
    const mine = seat === this.me;
    const field = mine ? L.mine : L.foe;
    const palette = SEAT_PALETTE[this.tints[seat]];
    const player = state.players[seat];
    const hp = this.hpShown[seat] ?? player.hp;
    const headX = L.halfX + 24;
    const name = `${seatLabel(state, seat, this.me)}${mine ? t("label.you") : ""}`;
    // L'indicatore fisso di chi agisce (2026-09-18): la targhetta accesa sulla
    // testata di chi deve muovere — tocca a te / sta giocando, difendi,
    // rispondi, scegli la mano, scarta — nel colore della fase.
    const acts = actsLabel(state, seat, this.me);
    const width = Math.max(HEAD_W, HEAD_W / 2 + textWidth(tag, name) + (acts ? textWidth(tag, acts) + 40 : 0));
    const box = snapped(visible, resolution, headX - PIECE_MARGIN, field.top - HEAD_H / 2 - PIECE_MARGIN, width + 2 * PIECE_MARGIN, HEAD_H + 2 * PIECE_MARGIN);
    this.paintRegion(this.seatHeads[seat], `${hp}|${player.token}|${player.flux}|${name}|${this.tints[seat]}|${acts ?? ""}|${state.phase}`, box, resolution, ctx => {
      const plateW = seatPlate(ctx, state, seat, headX, field.top, hp);
      const nameW = nameplate(ctx, name, headX + plateW + 12, field.top - 13, palette);
      if (acts) actsPill(ctx, acts, headX + plateW + 12 + nameW + 10, field.top - 13, state.phase);
    });
  }

  /**
   * Sopra tutto, in quattro pezzi piccoli al posto di un foglio a tutto
   * schermo: le due testate dei posti, il pannello ripiegato, il gesto di
   * fase. Ognuno si ridipinge solo quando cambia ciò che mostra (PV, Flusso,
   * Gettone, conti, fase) e cade pixel su pixel dove cadeva il foglio.
   */
  private paintOverlay(state: GameState, L: TableLayout, visible: Visible, resolution: number): void {
    const foe = otherSeat(this.me);
    for (const seat of [foe, this.me]) this.paintSeatHead(seat, state, L, visible, resolution);

    // Il tasto della fila avversaria, in alto a destra.
    this.paintFoeToggle(state, L, visible, resolution);

    // Il gesto di fase, in basso a destra: dice quale fase chiude, e ne ha il colore.
    // §4 — nell'apertura è «Tieni la mano» (o «Aspetta l'avversario» a mano tenuta), col «Mulligan n/3» accanto.
    const opening = openingPending(state);
    const keepMine = opening && mustKeep(state, this.me);
    const endsTurn = state.phase === "fronte" && !waveDeclared(state);
    // §6.5 — a mano piena il tasto dice perché: «Scarta fino a 7» a chi deve, «X deve scartare» a chi aspetta (2026-09-18).
    const discarding = [this.me, otherSeat(this.me)].find(seat => mustDiscard(state, seat)) ?? null;
    const label = t(
      opening ? (keepMine ? "hud.keep" : "hud.keep.waiting")
        : discarding === this.me ? "hud.discard.mine"
          : discarding ? "hud.discard.theirs"
            : endsTurn ? "hud.endturn" : PHASE_END[state.phase],
      discarding && discarding !== this.me ? { name: seatLabel(state, discarding, this.me) } : undefined,
    );
    const font: Font = { size: 16, weight: 700, family: SANS, spacing: 16 * 0.12, upper: true };
    const w = textWidth(font, label) + 36;
    const h = 38;
    const x = L.corner.right - w;
    const y = L.corner.bottom - h;
    const colors: Record<Phase, [string, string, string]> = {
      preparazione: ["#b81a41", "#9e0f34", "#e56a86"],
      fronte: ["#8e0c2f", "#6b0822", "#d24a64"],
      reazione: ["#6a57a3", "#564480", "#a494cf"],
    };
    const [hi, lo, edge] = colors[state.phase];
    // La fase la chiude chi è di turno (in Reazione il difensore, §6.4): se
    // non sei tu, il tasto c'è ma è spento (filter: saturate(.4) brightness(.75)).
    const mine = opening ? keepMine && mayKeep(state, this.me) : phaseCloser(state) === this.me && !state.over && (!discarding || discarding === this.me);
    this.paintMulliganButton(state, keepMine, x - 12, y, h, visible, resolution);
    // L'area del tasto, per il click: accesa solo se la fase la chiudi tu.
    this.phaseButton.hitArea = new Rectangle(x, y, w, h);
    this.phaseButton.cursor = mine ? "pointer" : "default";
    this.buttonActive = mine;
    const phaseBox = snapped(visible, resolution, x - PIECE_MARGIN, y - PIECE_MARGIN, w + 2 * PIECE_MARGIN, h + 2 * PIECE_MARGIN);
    this.paintRegion(this.phaseFace, `${state.phase}|${label}|${mine}`, phaseBox, resolution, ctx => {
      ctx.save();
      if (!mine) ctx.filter = "saturate(.4) brightness(.75)";
      ctx.save();
      ctx.shadowColor = state.phase === "reazione" ? "rgba(86,68,128,.45)" : state.phase === "fronte" ? "rgba(107,8,34,.45)" : "rgba(158,15,52,.4)";
      ctx.shadowBlur = 10 * ctx.getTransform().a;
      ctx.shadowOffsetY = 4 * ctx.getTransform().a;
      fillLinear(ctx, { x, y, w, h }, 180, [[hi, 0], [lo, 1]]);
      ctx.restore();
      fillLinear(ctx, { x, y, w, h }, 180, [[hi, 0], [lo, 1]]);
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      applyFont(ctx, font);
      drawText(ctx, { kind: "text", text: label, font, color: state.phase === "reazione" ? "#f1ecfa" : "#fdeef1" }, x + 18, y + h / 2 + 5.5);
      ctx.restore();
    });
  }

  /**
   * §4 — «Mulligan n/3», a sinistra di «Tieni la mano», solo finché il posto
   * deve ancora tenere; spento dopo il terzo (la mano si tiene da sé). Viola
   * come la Reazione, per distinguerlo dal gesto di fase.
   */
  private paintMulliganButton(state: GameState, show: boolean, right: number, y: number, h: number, visible: Visible, resolution: number): void {
    if (!show) {
      this.mulliganFace.visible = false;
      this.mulliganButton.hitArea = new Rectangle(0, 0, 0, 0);
      this.mulliganActive = false;
      return;
    }
    const done = state.players[this.me].opening?.mulligans ?? 0;
    const label = t("hud.mulligan", { n: done, max: MULLIGANS_MAX });
    const font: Font = { size: 16, weight: 700, family: SANS, spacing: 16 * 0.12, upper: true };
    const w = textWidth(font, label) + 36;
    const x = right - w;
    const active = mayMulligan(state, this.me);
    this.mulliganFace.visible = true;
    this.mulliganButton.hitArea = new Rectangle(x, y, w, h);
    this.mulliganButton.cursor = active ? "pointer" : "default";
    this.mulliganActive = active;
    const box = snapped(visible, resolution, x - PIECE_MARGIN, y - PIECE_MARGIN, w + 2 * PIECE_MARGIN, h + 2 * PIECE_MARGIN);
    this.paintRegion(this.mulliganFace, `mulligan|${label}|${active}`, box, resolution, ctx => {
      ctx.save();
      if (!active) ctx.filter = "saturate(.4) brightness(.75)";
      ctx.save();
      ctx.shadowColor = "rgba(86,68,128,.45)";
      ctx.shadowBlur = 10 * ctx.getTransform().a;
      ctx.shadowOffsetY = 4 * ctx.getTransform().a;
      fillLinear(ctx, { x, y, w, h }, 180, [["#6a57a3", 0], ["#564480", 1]]);
      ctx.restore();
      fillLinear(ctx, { x, y, w, h }, 180, [["#6a57a3", 0], ["#564480", 1]]);
      ctx.strokeStyle = "#a494cf";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      applyFont(ctx, font);
      drawText(ctx, { kind: "text", text: label, font, color: "#f1ecfa" }, x + 18, y + h / 2 + 5.5);
      ctx.restore();
    });
  }
}

// ------------------------------------------------------------ gli attrezzi

/** Un pezzo piccolo del tavolo: il suo riquadro in unità di progetto. */
interface PieceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** L'aria attorno ai pezzi piccoli per ombre e aloni (il più largo: 12 di sfocatura, 4 di scarto). */
const PIECE_MARGIN = 32;
/** La testata di un posto: la gemma dei PV è alta 54; largo quanto basta a targa e nome (se il nome è lungo, di più). */
const HEAD_W = 900;
const HEAD_H = 54;
/**
 * I PV che scalano: un punto per passo, fra 40 e 110 ms — un colpo grosso
 * corre, uno piccolo si conta —; una presa non dura oltre 20 s.
 */
const HP_STEP_MIN_MS = 40;
const HP_STEP_MAX_MS = 110;
const HP_RUN_MS = 800;
const HP_HOLD_MAX_MS = 20_000;

/**
 * Il riquadro (x, y, w, h) agganciato alla griglia dei pixel di `origin`
 * (l'angolo del foglio in cui il disegno cadeva prima): l'angolo arretra fino
 * a un pixel intero, così ogni tratto cade sullo stesso pixel di prima e i
 * pezzi (CrispSprite) non si spostano di mezzo pixel.
 */
function snapped(origin: { x: number; y: number }, resolution: number, x: number, y: number, w: number, h: number): PieceBox {
  const bx = origin.x + Math.floor((x - origin.x) * resolution) / resolution;
  const by = origin.y + Math.floor((y - origin.y) * resolution) / resolution;
  return { x: bx, y: by, w: w + (x - bx), h: h + (y - by) };
}

/** Il tasto della fila avversaria: l'altezza, i margini, le frecce, l'aria fra nome e conto e fra una voce e l'altra. */
const FOE_TOGGLE_H = 32;
const TOGGLE_PAD = 14;
const TOGGLE_INNER = 10;
const CHEVRON = 16;
const TOKEN_GAP = 6;
const TOKEN_SEP = 22;
interface ToggleToken {
  label: string;
  n: string | null;
}

/** L'apertura o la chiusura della fila avversaria: quanto dura, e ciò che si porta dietro dal disegno di prima (beginMorph). */
const MORPH_MS = 420;
interface Morph {
  bases: Map<string, { x: number; y: number }>;
  tileW: number;
  texture: Texture | null;
}

/** Un carattere nella scala dell'interfaccia (layout.ts, ui): corpo e spaziatura scendono insieme. */
function scaled(font: Font, ui: number): Font {
  return ui === 1 ? font : { ...font, size: font.size * ui, spacing: (font.spacing ?? 0) * ui };
}

/** Cambia la texture di uno sprite distruggendo la vecchia — mai quella vuota condivisa di Pixi. */
/** §7.2 — la catena: le Reattive stanno al centro, nel varco fra i due campi, a scaletta (44 e 26 canonici l'una dall'altra). */
function chainSpotOf(L: TableLayout, index: number): { x: number; y: number } {
  const gapMid = (L.foe.bottom + L.mine.top) / 2;
  return { x: L.left + (SURFACE_W * L.s) / 2 - L.tileW / 2 + index * 44 * L.s, y: gapMid - L.tileH / 2 + index * 26 * L.s };
}

function replace(sprite: Sprite, texture: Texture): void {
  const old = sprite.texture;
  sprite.texture = texture;
  if (old && old !== Texture.EMPTY && old !== Texture.WHITE) old.destroy(true);
}

/** Una scritta della lavagna, con la cima in y (e le sue ombre, se ne ha). */
function paintText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, font: Font = rowLabel, shadows?: { x: number; y: number; blur: number; color: string }[]): void {
  applyFont(ctx, font);
  drawText(ctx, { kind: "text", text, font, color, ...(shadows ? { shadows } : {}) }, x, y + font.size * 0.8);
}

/**
 * Il castone di un campo (tema notte, .half::before e ::after): il telaio al
 * neon staccato dalla lastra — otto fili (quattro lati e quattro tagli a 45°)
 * con l'alone, due barre d'accento asimmetriche — e dentro, 5px più in là,
 * la lastra ottagonale di pietra fumé nella tinta del posto, con la luce che
 * scende dall'orlo in cima, la grana e il buio che si addensa ai bordi.
 */
function bezel(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, palette: SeatPalette): void {
  const a = ctx.getTransform().a;
  // Il riquadro interno (dentro il bordo trasparente di 2px), il telaio (inset −6px), la lastra (inset 5px).
  const pad = { x: box.x + 2, y: box.y + 2, w: box.w - 4, h: box.h - 4 };
  const F = { x: pad.x - 6, y: pad.y - 6, w: pad.w + 12, h: pad.h + 12 };
  const S = { x: pad.x + 5, y: pad.y + 5, w: pad.w - 10, h: pad.h - 10 };
  const c = 46;
  const hi = lighten(palette.rim, 0.35);
  const glow = rgba(palette.rim, 0.45);
  // I tagli: una diagonale per angolo, dentro il suo quadrato c×c.
  const diagonals = (color: string, width: number): void => {
    const corners: [number, number, number, number][] = [
      [F.x + c, F.y, F.x, F.y + c],
      [F.x + F.w - c, F.y, F.x + F.w, F.y + c],
      [F.x + F.w, F.y + F.h - c, F.x + F.w - c, F.y + F.h],
      [F.x, F.y + F.h - c, F.x + c, F.y + F.h],
    ];
    const squares: [number, number][] = [
      [F.x, F.y],
      [F.x + F.w - c, F.y],
      [F.x + F.w - c, F.y + F.h - c],
      [F.x, F.y + F.h - c],
    ];
    corners.forEach(([x1, y1, x2, y2], i) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(squares[i]![0], squares[i]![1], c, c);
      ctx.clip();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    });
  };
  // L'alone: fasce di 11px lungo i lati, 10px sui tagli.
  ctx.fillStyle = glow;
  ctx.fillRect(F.x + c, F.y, F.w - 2 * c, 11);
  ctx.fillRect(F.x + c, F.y + F.h - 11, F.w - 2 * c, 11);
  ctx.fillRect(F.x, F.y + c, 11, F.h - 2 * c);
  ctx.fillRect(F.x + F.w - 11, F.y + c, 11, F.h - 2 * c);
  diagonals(glow, 10);
  // Le barre d'accento: in alto a sinistra e in basso a destra, con la tacca.
  const bar = F.w * 0.24;
  ctx.fillStyle = hi;
  ctx.fillRect(F.x + c, F.y, bar, 9);
  ctx.fillRect(F.x + c + bar + 10, F.y, 14, 9);
  ctx.fillRect(F.x + F.w - c - bar, F.y + F.h - 9, bar, 9);
  ctx.fillRect(F.x + F.w - c - bar - 10 - 14, F.y + F.h - 9, 14, 9);
  // Il filo: 2px sui lati, 3px sui tagli.
  ctx.fillRect(F.x + c, F.y, F.w - 2 * c, 2);
  ctx.fillRect(F.x + c, F.y + F.h - 2, F.w - 2 * c, 2);
  ctx.fillRect(F.x, F.y + c, 2, F.h - 2 * c);
  ctx.fillRect(F.x + F.w - 2, F.y + c, 2, F.h - 2 * c);
  diagonals(hi, 3);

  // La lastra: ottagono tagliato a 41px.
  ctx.save();
  octagon(ctx, S.x, S.y, S.w, S.h, 41);
  ctx.clip();
  ctx.save();
  ctx.translate(S.x + S.w / 2, S.y + S.h * 0.4);
  ctx.scale(S.w * 0.9, S.h);
  const slab = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  slab.addColorStop(0, palette.slabTop);
  slab.addColorStop(1, palette.slabBottom);
  ctx.fillStyle = slab;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  grain(ctx, S.x, S.y, S.w, S.h);
  const light = ctx.createLinearGradient(0, S.y, 0, S.y + S.h);
  light.addColorStop(0, rgba(palette.rim, 0.3));
  light.addColorStop(0.14, rgba(palette.rim, 0.09));
  light.addColorStop(0.36, rgba(palette.rim, 0));
  ctx.fillStyle = light;
  ctx.fillRect(S.x, S.y, S.w, S.h);
  // Dentro: il filo della tinta a 1px e il buio di 60px che si addensa agli orli.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.4)";
  ctx.shadowBlur = 60 * a;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.rect(S.x - 400, S.y - 400, S.w + 800, S.h + 800);
  ctx.rect(S.x, S.y, S.w, S.h);
  ctx.fill("evenodd");
  ctx.restore();
  ctx.strokeStyle = rgba(palette.rim, 0.35);
  ctx.lineWidth = 1;
  ctx.strokeRect(S.x + 0.5, S.y + 0.5, S.w - 1, S.h - 1);
  ctx.restore();
}

/** La targhetta del nome (.half-name del tema notte): piastra brunita, filo e alone nella tinta, maiuscole .18em. */
function nameplate(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, palette: SeatPalette): number {
  const w = textWidth(tag, text) + 24;
  const h = 26;
  plate(ctx, x, y, w, h, { shadow: true, glow: rgba(palette.rim, 0.3), edge: rgba(palette.rim) });
  paintText(ctx, text, x + 12, y + 5, palette.name, tag);
  return w;
}

/** La scritta dell'indicatore di chi agisce sulla testata di `seat`, o null se non tocca a lui. */
function actsLabel(state: GameState, seat: Seat, me: Seat): string | null {
  if (!whoActs(state).includes(seat)) return null;
  const you = seat === me;
  if (openingPending(state)) return t(you ? "head.keeps.you" : "head.keeps.them");
  if (mustDiscard(state, seat)) return t(you ? "head.discards.you" : "head.discards.them");
  if (state.chain && !state.chain.resolving) return t(you ? "head.responds.you" : "head.responds.them");
  if (state.phase === "reazione") return t(you ? "head.defends.you" : "head.defends.them");
  return t(you ? "head.acts.you" : "head.acts.them");
}

/** La pillola accesa di chi agisce: il colore della fase, il testo in maiuscole spaziate, il bagliore. */
function actsPill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, phase: Phase): void {
  const colors: Record<Phase, [string, string, string]> = {
    preparazione: ["#b81a41", "#e56a86", "rgba(229,106,134,.55)"],
    fronte: ["#8e0c2f", "#d24a64", "rgba(210,74,100,.55)"],
    reazione: ["#6a57a3", "#a494cf", "rgba(164,148,207,.55)"],
  };
  const [fill, edge, glow] = colors[phase];
  const w = textWidth(tag, text) + 24;
  const h = 26;
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = 14 * ctx.getTransform().a;
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  paintText(ctx, text, x + 12, y + 5, "#fdeef1", tag);
}

/** La stella a quattro punte del Gettone, coi lati che curvano (viewBox 24). */
const STAR = new Path2D("M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0 Z");

/**
 * La targa del posto nel tema notte (.hud-chip): senza rettangolo dietro, i
 * pezzi poggiano sull'orlo del campo (`edge`) — il medaglione verde dei PV
 * (rubino sotto i 6) col numero grande e «PV» in bianco, il Gettone (il disco
 * scuro con la stella d'oro, vuota o piena e accesa), il rombo rubino del
 * Flusso. `hp` sono i PV mostrati, che scalano verso quelli dello stato
 * (stepHp). Torna la sua larghezza.
 */
function seatPlate(ctx: CanvasRenderingContext2D, state: GameState, seat: Seat, x: number, edge: number, hp: number): number {
  const player = state.players[seat];
  const a = ctx.getTransform().a;
  let cx = x + 4 + 1;

  // I PV.
  const gem = 54;
  const gy = edge - gem / 2;
  const low = hp <= 5;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx + gem / 2, gy);
  ctx.lineTo(cx + gem, gy + gem / 2);
  ctx.lineTo(cx + gem / 2, gy + gem);
  ctx.lineTo(cx, gy + gem / 2);
  ctx.closePath();
  ctx.clip();
  fillLinear(ctx, { x: cx, y: gy, w: gem, h: gem }, 160, low ? [["#ff6f8f", 0], ["#c21c45", "46%"], ["#7d0a2a", "100%"]] : [["#7fe6a4", 0], ["#2f9f60", "46%"], ["#135a36", "100%"]]);
  ctx.restore();
  const hpFont: Font = { size: 21, weight: 800, family: SANS, spacing: -0.42 };
  const hpText = String(hp);
  applyFont(ctx, hpFont);
  drawText(
    ctx,
    { kind: "text", text: hpText, font: hpFont, color: "#ffffff", shadows: [{ x: 0, y: 1, blur: 2, color: "rgba(0,0,0,.8)" }, { x: 0, y: 0, blur: 6, color: "rgba(0,0,0,.6)" }] },
    cx + gem / 2 - textWidth(hpFont, hpText) / 2,
    edge + 7.5
  );
  cx += gem + 3;
  const unitFont: Font = { size: 13, weight: 800, family: SANS, spacing: 13 * 0.12 };
  const unit = t("hud.hp.unit");
  applyFont(ctx, unitFont);
  drawText(
    ctx,
    {
      kind: "text",
      text: unit,
      font: unitFont,
      color: "#ffffff",
      shadows: [
        { x: 0, y: 0, blur: 3, color: "rgba(0,0,0,1)" },
        { x: 0, y: 0, blur: 3, color: "rgba(0,0,0,1)" },
        { x: 0, y: 1, blur: 2, color: "rgba(0,0,0,1)" },
        { x: 0, y: 0, blur: 8, color: "rgba(0,0,0,.8)" },
      ],
    },
    cx,
    edge + 4.5
  );
  cx += textWidth(unitFont, unit) + 2 + 10;

  // Il Gettone.
  const coin = 32;
  const ccx = cx + coin / 2;
  ctx.save();
  if (player.token) {
    ctx.shadowColor = "rgba(217,168,78,.7)";
    ctx.shadowBlur = 12 * a;
    ctx.beginPath();
    ctx.arc(ccx, edge, coin / 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(6,5,10,.92)";
    ctx.fill();
  }
  ctx.shadowColor = "rgba(0,0,0,.6)";
  ctx.shadowBlur = 10 * a;
  ctx.beginPath();
  ctx.arc(ccx, edge, coin / 2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(6,5,10,.92)";
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = player.token ? "rgba(255,217,138,.9)" : "rgba(240,197,106,.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(ccx, edge, coin / 2 - 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.translate(ccx - 9, edge - 9);
  ctx.scale(18 / 24, 18 / 24);
  if (player.token) {
    const gold = ctx.createLinearGradient(0, 0, 24, 24);
    gold.addColorStop(0, "#ffe4a3");
    gold.addColorStop(0.55, "#f0c56a");
    gold.addColorStop(1, "#b8862e");
    ctx.fillStyle = gold;
    ctx.fill(STAR);
  } else {
    ctx.strokeStyle = "#f0c56a";
    ctx.lineWidth = 1.6;
    ctx.stroke(STAR);
  }
  ctx.restore();
  cx += coin + 10;

  // Il Flusso: il rombo rubino da 32, col numero.
  cx += 12;
  const fx = cx + 16;
  ctx.save();
  ctx.translate(fx, edge);
  ctx.rotate(Math.PI / 4);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.6)";
  ctx.shadowBlur = 6 * a;
  ctx.shadowOffsetY = 2 * a;
  ctx.fillStyle = "#9e0f34";
  ctx.fillRect(-16, -16, 32, 32);
  ctx.restore();
  ctx.strokeStyle = "#e56a86";
  ctx.lineWidth = 1;
  ctx.strokeRect(-15.5, -15.5, 31, 31);
  ctx.restore();
  const fluxFont: Font = { size: 19.2, weight: 700, family: SANS };
  const flux = String(player.flux);
  applyFont(ctx, fluxFont);
  drawText(ctx, { kind: "text", text: flux, font: fluxFont, color: "#fdeef1" }, fx - textWidth(fluxFont, flux) / 2, edge + 6.8);
  cx += 32 + 12;
  return cx + 4 - x;
}

/** Le parole chiave che hanno un'icona (cardview.ts, KEY_ICON). */
const ICON_KEYWORDS = ["surge", "stasis", "revenge", "fury"];

/**
 * I distintivi di una carta in campo: il costo stampato, la Potenza attuale,
 * il Contrattacco, le parole chiave — e i segni di ciò che ha in più (table.ts,
 * markMarks): lo scarto di Potenza, il Contrattacco in più, le parole chiave
 * concesse (fino a fine turno o dagli Oggetti), «Non blocca».
 */
function badges(state: GameState, card: CardInstance, facts: (cardId: string) => ReturnType<typeof cardFacts>, noBlock: string): Badges {
  const stats = cardStats(card.cardId);
  const face = getCard(card.cardId)?.faces[card.face] as { stats?: { deploymentCost?: { die?: string; base?: number } } } | undefined;
  const deployment = face?.stats?.deploymentCost;
  let cost: Badges["cost"] = null;
  if (deployment) cost = { text: deployment.die ? deployment.die.replace(/^d/, "") : String(deployment.base ?? ""), die: Boolean(deployment.die) };
  else if (stats.fluxCost !== null) cost = { text: String(stats.fluxCost), die: false };
  const printed = facts(card.cardId);
  const power = isRubyfront(card.cardId) ? null : powerOf(card, facts, state);
  const marks: Mark[] = [];
  if (power !== null && printed.power !== null && power !== printed.power) marks.push({ kind: "power", delta: power - printed.power });
  const counterExtra = (card.counterBonus ?? 0) + staticCounter(state, card, facts);
  if (counterExtra > 0) marks.push({ kind: "counter", extra: counterExtra });
  for (const keyword of ICON_KEYWORDS) {
    if (!printed.keywords.includes(keyword) && hasKeyword(card, keyword, facts, state)) marks.push({ kind: "grant", keyword });
  }
  if (card.cannotBlock) marks.push({ kind: "noblock", text: noBlock });
  return {
    cost,
    power,
    // Il Contrattacco stampato: quello in più è un segno a parte.
    counter: printed.counterattack,
    keywords: printed.keywords.filter(keyword => ICON_KEYWORDS.includes(keyword)),
    marks,
  };
}

export { SURFACE_W };
