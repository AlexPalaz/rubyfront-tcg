// Il tavolo del gioco (F3, «il tavolo fermo»): la partita com'è nello stato
// del core, disegnata in Pixi — i due campi con i riquadri e le etichette,
// le targhe dei posti (PV, Gettone, Flusso) e i nomi, le carte in campo, le
// tue pile, il pannello delle pile avversarie, il cassetto della mano, il
// gesto di fase. Si ridisegna con `mostra(state)`: le carte si riallineano
// per uid (nessuna si ricrea se c'era già), il resto — riquadri e scritte —
// si ridipinge, che costa poco.
//
// Il tema è «Notte» (2026-09-12, aspetto.ts): la valle sotto un velo scuro,
// i campi come castoni al neon nella tinta del mazzo di ciascun posto, gli
// alloggi degli slot, le targhe brunite, il cassetto col filo neon.

import { cardFacts, cardStats, deckTint, getCard, isRubyfront, type Tint } from "@rubyfront/core/cards";
import { hasKeyword, powerOf, staticCounter } from "@rubyfront/core/combat";
import { CONTROL_X, FRONT_SLOT_X, FRONT_W, FRONT_X, MATTER_X, RUBYFRONT_X, SLOT_X, SURFACE_W } from "@rubyfront/core/geometry";
import { t } from "@rubyfront/core/i18n";
import { phaseCloser, seatLabel, waveDeclared, zoneCards } from "@rubyfront/core/state";
import type { CardInstance, GameState, Phase, Seat, ZoneId } from "@rubyfront/core/types";
import { otherSeat } from "@rubyfront/core/types";
import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { fillLinear } from "../card/css";
import { applyFont, drawText, textWidth, type Font } from "../card/text";
import type { Stage } from "../stage";
import { NIGHT, SEAT_PALETTE, SANS, THEME, slotFrame, loadNight, lighten, paintPiece, grain, octagon, plate, dashedRect, rgba, type SeatPalette } from "./appearance";
import { TableCard, type Ring, type Badges, type Mark, type CardLook } from "./card";
import { bezier, easeInOut, tween, reducedMotion } from "./animation";
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

const PHASE_END: Record<Phase, string> = {
  preparazione: "phase.end.preparazione",
  fronte: "phase.end.fronte",
  reazione: "phase.end.reazione",
};

/** Le scritte della lavagna nel tema notte: 16px, 700, maiuscole spaziate .2em (.slot::after); la riga del Fronte .12em (.row-label del rincasso). */
const rowLabel: Font = { size: 16, weight: 700, family: SANS, spacing: 16 * 0.2, upper: true };
const line: Font = { ...rowLabel, spacing: 16 * 0.12 };
/** La testata del pannello delle pile (.pile-dock-head): 16px, .12em. */
const header: Font = { size: 16, weight: 400, family: SANS, spacing: 16 * 0.12, upper: true };
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
  private readonly background = new Sprite();
  private readonly cards = new Container({ label: "cards" });
  private readonly hand = new Container({ label: "hand" });
  private readonly drawer = new Sprite();
  /** La tinta di ogni posto (il suo mazzo, core/cards deckTint): orli, lastre, alloggi, targhe, cassetto. */
  private readonly tints: Record<Seat, Tint> = { a: "dynamic", b: "dynamic" };
  /** La valle e la grana si caricano una volta: arrivate, il tavolo si ridisegna. */
  private nightReady = false;
  private last: { state: GameState; L: TableLayout } | null = null;
  private readonly overlay = new Sprite();
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
  /** Quanto manca perché l'insegna di fase se ne vada: la carta del turno la aspetta (partita.ts). */
  entryDelay: () => number = () => 0;
  private readonly dimmer = new Graphics();
  private inChain = new Set<string>();
  private chainOpen = false;
  /** Le pile che si toccano: le tue Abisso e Ritiro (sotto le carte), il pannello avversario (sopra tutto). */
  private readonly pileHits = new Container({ label: "pile-hits" });
  private readonly panel = new Sprite();
  private readonly panelHits = new Container({ label: "panel-hits" });
  private readonly panelCards = new Container({ label: "panel-cards" });
  /** Il pannello delle pile avversarie aperto (rincasso: parte ripiegato sulla testata coi conti). */
  private panelOpen = false;
  private readonly pileListeners: ((seat: Seat, zone: ZoneId) => void)[] = [];
  private readonly views = new Map<string, TableCard>();
  /** Il gesto di fase: la sua area e chi ascolta. */
  private readonly phaseButton = new Container({ label: "end-phase" });
  private closePhase: (() => void) | null = null;
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
  /** La mano ripiegata (hand-mine.is-collapsed): il cassetto scende e ne resta in vista l'orlo con la targhetta. */
  private handCollapsed = false;
  private handSlide = 0;
  private handSliding = false;
  /** Il tasto che ripiega la mano (.hand-toggle), dentro l'orlo destro del cassetto. */
  private readonly handToggle = new Container({ label: "hand-toggle" });
  private readonly handToggleFace = new Sprite();
  /** §6.5 — lo scarto possibile (gestures.ts, canDiscard): la Zona di Ritiro accesa, l'alone, la targhetta. */
  private discardOn = false;
  private readonly discardHalo = new Sprite();
  private readonly discardFrame = new Graphics();
  private readonly discardTag = new Sprite();
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
    this.hand.addChild(this.drawer);
    this.dimmer.eventMode = "none";
    // Il pannello aperto copre il campo avversario: sotto di lui non si tocca nulla.
    this.panel.eventMode = "static";
    this.panel.visible = false;
    this.flights.eventMode = "none";
    this.arrows.eventMode = "none";
    this.discardHalo.eventMode = "none";
    this.discardFrame.eventMode = "none";
    this.discardTag.eventMode = "none";
    this.discardHalo.visible = this.discardFrame.visible = this.discardTag.visible = false;
    // L'alone e il filo sotto le carte (la carta in cima alla pila copre il velo, non l'alone); la targhetta sopra il cassetto.
    this.root.addChild(this.background, this.discardHalo, this.discardFrame, this.pileHits, this.cards, this.arrows, this.dimmer, this.chain, this.flights, this.hand, this.discardTag, this.overlay, this.panel, this.panelHits, this.panelCards, this.phaseButton, this.handToggle);
    this.phaseButton.eventMode = "static";
    this.phaseButton.on("pointertap", () => {
      if (this.buttonActive) this.closePhase?.();
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
    if (!before || reducedMotion()) return;
    const showWaiting = this.entryDelay();
    const hold = showWaiting > 0 ? showWaiting + 80 : 0;
    let entrance = 0;
    for (const uid of uids) {
      if (before.has(uid)) continue;
      const view = this.views.get(uid);
      if (!view) continue;
      const delay = hold + entrance * DRAW_STEP_MS;
      entrance += 1;
      // `backwards`: invisibile nell'attesa, poi sale di 90 e si accende.
      view.visible = false;
      setTimeout(() => {
        if (view.destroyed) return;
        view.visible = true;
        void tween(this.stage.app.ticker, DRAW_RUN_MS, k => {
          if (view.destroyed) throw new Error("carta sparita");
          const base = this.bases.get(uid);
          if (base) view.y = base.y + 90 * (1 - k);
          view.alpha = k;
        }, bezier(0.2, 0.8, 0.3, 1));
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
    const dock = dockOf(L);
    if (!this.panelOpen) return { x: dock.x, y: dock.y, w: dock.w, h: DOCK_HEAD_H };
    const index = (["abisso", "ritiro", "deck", "hand"] as ZoneId[]).indexOf(zone);
    return index < 0 ? null : { x: dock.slotX(index), y: dock.slotY, w: L.tileW, h: L.tileH };
  }

  /** Apre o ripiega il pannello delle pile avversarie (lo fa il tocco sulla testata; qui per le prove). */
  openPanel(isOpen: boolean): void {
    this.panelOpen = isOpen;
    if (this.last) this.show(this.last.state);
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
    this.restyle();
    this.updateDimmer();
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

  /** Le zone delle pile pubbliche e la testata del pannello: si rifanno a ogni disegno. */
  private updateHits(L: TableLayout, dock: Panel): void {
    for (const child of this.pileHits.removeChildren()) child.destroy();
    for (const child of this.panelHits.removeChildren()) child.destroy();
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
    tapZone(this.panelHits, dock.x, dock.y, dock.w, DOCK_HEAD_H, () => {
      this.panelOpen = !this.panelOpen;
      if (this.last) this.show(this.last.state);
    });
    if (this.panelOpen) {
      (["abisso", "ritiro"] as const).forEach((zone, index) => tapZone(this.panelHits, dock.slotX(index), dock.slotY, L.tileW, L.tileH, () => this.pile(foe, zone)));
    }
  }

  /** Il pannello aperto (style.css, .pile-dock): la piastra brunita, la testata «▾ Pile», poi gli alloggi nella tinta avversaria con le etichette. */
  private paintPanel(ctx: CanvasRenderingContext2D, state: GameState, L: TableLayout, dock: Panel): void {
    const foe = otherSeat(this.me);
    const palette = SEAT_PALETTE[this.tints[foe]];
    plate(ctx, 0, 0, dock.w, dock.h, { shadow: true, edge: THEME.line, darkBackground: true });
    paintText(ctx, "▾", 14, 7, THEME.ink, header);
    paintText(ctx, t("recess.piles"), 36, 7, THEME.muted, header);
    const zones: ZoneId[] = ["abisso", "ritiro", "deck", "hand"];
    zones.forEach((zone, index) => {
      const x = dock.slotX(index) - dock.x;
      const y = dock.slotY - dock.y;
      slotFrame(ctx, x, y, L.tileW, L.tileH, palette);
      const n = zoneCards(state, foe, zone).length;
      const label = zone === "hand" ? t("recess.hand", { n }) : `${t(PILE.find(pile => pile.zone === zone)!.label)} · ${n}`;
      paintText(ctx, label, x + 4, y + L.tileH + 10, THEME.lettering, rowLabel, LABEL_SHADOWS);
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

  /** Chi chiude la fase quando si preme il gesto di fase (F4). */
  onEndPhase(listener: () => void): void {
    this.closePhase = listener;
  }

  /** Aspetta che tutte le facce in vista siano dipinte. */
  async ready(): Promise<void> {
    await Promise.all([...this.views.values()].map(view => view.ready));
  }

  show(state: GameState): void {
    const visible = this.stage.visible();
    const L = layout(visible);
    const resolution = visible.scale * this.stage.app.renderer.resolution;
    const facts = (cardId: string) => cardFacts(cardId, this.locale);
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

    // Il fondo: i due campi, i riquadri, le etichette. Un pezzo solo.
    replace(this.background, paintPiece(visible.width, visible.height, resolution, ctx => {
      ctx.translate(-visible.x, -visible.y);
      this.paintBackground(ctx, state, L, visible);
    }));
    this.background.position.set(visible.x, visible.y);

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
        this.views.set(card.uid, view);
      }
      this.zone.set(card.uid, card.zone);
      this.info.set(card.uid, { cardId: look.cardId, face: look.face, back: look.back });
      if (view.parent !== layer) layer.addChild(view);
      view.position.set(x + L.tileW / 2, y + L.tileH / 2);
      this.bases.set(card.uid, { x: x + L.tileW / 2, y: y + L.tileH / 2 });
      view.zIndex = card.zone === "field" ? card.z : 0;
      const full: CardLook = { ...look, tapDelay: tapDelays.get(card.uid) ?? 0, w: L.tileW, h: L.tileH, locale: this.locale, resolution };
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

    // Il pannello delle pile avversarie aperto: le cime delle tre pile e un
    // dorso per la mano (table.ts, pile-dock). Ripiegato, lo dipinge `sopra`.
    const foe = otherSeat(this.me);
    const dock = dockOf(L);
    if (this.panelOpen) {
      const piles: { zone: ZoneId; back: boolean }[] = [{ zone: "abisso", back: false }, { zone: "ritiro", back: false }, { zone: "deck", back: true }, { zone: "hand", back: true }];
      piles.forEach((entry, index) => {
        const top = zoneCards(state, foe, entry.zone)[0];
        if (!top) return;
        place(top, this.panelCards, dock.slotX(index), dock.slotY, { cardId: top.cardId, face: top.face, back: entry.back, tapped: false, badges: null, combat: null });
      });
    }

    // La mano: una fila da sinistra, 10 fra una carta e l'altra; se non ci
    // stanno si accavallano.
    const hand = zoneCards(state, this.me, "hand");
    const room = L.hand.w - 32 - (TOGGLE_W + TOGGLE_MARGIN);
    const step = hand.length > 1 ? Math.min(L.tileW + 10, (room - L.tileW) / (hand.length - 1)) : 0;
    const handY = L.hand.y + L.hand.h - 14 - L.tileH;
    hand.forEach((card, index) => {
      place(card, this.hand, L.hand.x + 16 + index * step, handY, { cardId: card.cardId, face: card.face, back: false, tapped: false, badges: null, combat: null });
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
    replace(this.drawer, paintPiece(L.hand.w, L.hand.h + DRAWER_GAP, resolution, ctx => this.paintDrawer(ctx, state, L)));
    this.drawer.position.set(L.hand.x, L.hand.y - DRAWER_GAP);
    this.paintDiscard(L, resolution);
    // Ripiegata, la mano resta giù (se non sta già scivolando); il tasto si ridipinge col tavolo.
    if (!this.handSliding) this.hand.y = this.handLift(L, hand.length);
    this.paintHandToggle(L, resolution);

    // Sopra tutto: le targhe dei posti, il pannello delle pile avversarie, il gesto di fase.
    replace(this.overlay, paintPiece(visible.width, visible.height, resolution, ctx => {
      ctx.translate(-visible.x, -visible.y);
      this.paintOverlay(ctx, state, L);
    }));
    this.overlay.position.set(visible.x, visible.y);

    // Il pannello aperto, sopra la testata; e le zone che si toccano.
    this.panel.visible = this.panelOpen;
    if (this.panelOpen) {
      replace(this.panel, paintPiece(dock.w + 2 * PANEL_DROP_SHADOW, dock.h + 2 * PANEL_DROP_SHADOW, resolution, ctx => {
        ctx.translate(PANEL_DROP_SHADOW, PANEL_DROP_SHADOW);
        this.paintPanel(ctx, state, L, dock);
      }));
      this.panel.position.set(dock.x - PANEL_DROP_SHADOW, dock.y - PANEL_DROP_SHADOW);
      this.panel.hitArea = new Rectangle(PANEL_DROP_SHADOW, PANEL_DROP_SHADOW, dock.w, dock.h);
    }
    this.updateHits(L, dock);
    this.updateDimmer();

    // Il vetro del cassetto si rifà quando le facce in vista sono pronte.
    void this.ready();
  }

  // ------------------------------------------------------------- il fondo

  private paintBackground(ctx: CanvasRenderingContext2D, state: GameState, L: TableLayout, visible: { x: number; y: number; width: number; height: number }): void {
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
        if (label) paintText(ctx, t(label), x + 4, y + L.tileH + 10, THEME.lettering, rowLabel, LABEL_SHADOWS);
      };
      slot(RUBYFRONT_X, field.front, "rgba(210,74,100,.42)", null);
      for (const x of FRONT_SLOT_X) slot(x, field.front, null, null);
      slot(MATTER_X, field.front, "rgba(143,176,255,.42)", "zone.matters");
      // Un'etichetta sola per i cinque slot, centrata sotto.
      const front = t("zone.front");
      paintText(ctx, front, L.x(FRONT_X) + (FRONT_W * L.s - textWidth(line, front)) / 2, field.front + L.tileH + 13, THEME.lettering, line, LABEL_SHADOWS);

      // La tua fila di servizio: le pile col loro conto, e il Controllo se occupato.
      if (mine && field.back !== null) {
        for (const pile of PILE) {
          const n = zoneCards(state, seat, pile.zone).length;
          slot(pile.x, field.back, null, null);
          paintText(ctx, `${t(pile.label)} · ${n}`, L.x(pile.x) + 4, field.back + L.tileH + 10, THEME.lettering, rowLabel, LABEL_SHADOWS);
        }
        const controlled = Object.values(state.cards).some(card => card.zone === "field" && card.controller === seat);
        if (controlled) slot(CONTROL_X, field.back, null, "zone.control");
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
    replace(this.discardHalo, paintPiece(w + 2 * DISCARD_MARGIN, h + 2 * DISCARD_MARGIN, resolution, ctx => {
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
    }));
    this.discardHalo.position.set(x - DISCARD_MARGIN, y - DISCARD_MARGIN);
    this.discardFrame.clear().rect(x, y, w, h).fill({ color: DISCARD_GOLD, alpha: 0.16 }).stroke({ color: DISCARD_GOLD, width: 2, alignment: 1 });
    // La targhetta, in cima all'alloggio e centrata: si legge come una richiesta.
    const label = t("slot.discard");
    const tw = Math.ceil(textWidth(discardTag, label)) + 24;
    const th = 26;
    const pad = 16;
    replace(this.discardTag, paintPiece(tw + 2 * pad, th + 2 * pad, resolution, ctx => {
      ctx.translate(pad, pad);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.55)";
      ctx.shadowBlur = 8 * ctx.getTransform().a;
      ctx.shadowOffsetY = 2 * ctx.getTransform().a;
      ctx.fillStyle = THEME.gold;
      ctx.fillRect(0, 0, tw, th);
      ctx.restore();
      paintText(ctx, label, 12, 5, "#0b090b", discardTag);
    }));
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
    replace(this.handToggleFace, paintPiece(w + 2 * pad, h + 2 * pad, resolution, ctx => {
      ctx.translate(pad, pad);
      plate(ctx, 0, 0, w, h, { shadow: true, edge: THEME.line, darkBackground: true });
      // Le due frecce del simulatore (viewBox 24, a 16 px): polilinee a tratto tondo.
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
    }));
    this.handToggleFace.position.set(x - pad, y - pad);
    this.handToggle.hitArea = new Rectangle(x, y, w, h);
  }

  // ----------------------------------------------------------- il cassetto

  private paintDrawer(ctx: CanvasRenderingContext2D, state: GameState, L: TableLayout): void {
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
    // La targhetta «La tua mano · n», appoggiata sull'orlo: piastra scura col filo nella tua tinta.
    const n = zoneCards(state, this.me, "hand").length;
    const excess = n > 7;
    const font: Font = { ...tag, weight: 700 };
    const label = t("hand.mine", { n });
    const tw = textWidth(font, label) + 24;
    const tx = 24;
    const ty = top - 11;
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
  }

  // ---------------------------------------------------------------- sopra

  private paintOverlay(ctx: CanvasRenderingContext2D, state: GameState, L: TableLayout): void {
    const foe = otherSeat(this.me);
    for (const [seat, field] of [[foe, L.foe], [this.me, L.mine]] as const) {
      const mine = seat === this.me;
      const palette = SEAT_PALETTE[this.tints[seat]];
      // La testata, a cavallo dell'orlo in alto a sinistra: PV, Gettone e Flusso sul filo, poi la targhetta del nome.
      const headX = L.halfX + 24;
      const width = seatPlate(ctx, state, seat, headX, field.top);
      const name = `${seatLabel(state, seat, this.me)}${mine ? t("label.you") : ""}`;
      nameplate(ctx, name, headX + width + 12, field.top - 13, palette);
    }

    // Il pannello delle pile avversarie, ripiegato: la piastra coi conti, in alto a destra.
    const counts = PILE.map(pile => `${t(pile.label)} · ${zoneCards(state, foe, pile.zone).length}`).join("   ");
    const { w: dockW, x: dockX, y: dockY } = dockOf(L);
    plate(ctx, dockX, dockY, dockW, DOCK_HEAD_H, { shadow: true, edge: THEME.line, darkBackground: true });
    paintText(ctx, "▸", dockX + 14, dockY + 7, THEME.ink, header);
    paintText(ctx, counts, dockX + 36, dockY + 7, THEME.muted, header);

    // Il gesto di fase, in basso a destra: dice quale fase chiude, e ne ha il colore.
    const endsTurn = state.phase === "fronte" && !waveDeclared(state);
    const label = t(endsTurn ? "hud.endturn" : PHASE_END[state.phase]);
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
    const mine = phaseCloser(state) === this.me && !state.over;
    // L'area del tasto, per il click: accesa solo se la fase la chiudi tu.
    this.phaseButton.hitArea = new Rectangle(x, y, w, h);
    this.phaseButton.cursor = mine ? "pointer" : "default";
    this.buttonActive = mine;
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
  }
}

// ------------------------------------------------------------ gli attrezzi

/** La testata del pannello delle pile avversarie, e il margine per l'ombra del pannello aperto. */
const DOCK_HEAD_H = 30;
const PANEL_DROP_SHADOW = 40;

interface Panel {
  x: number;
  y: number;
  w: number;
  /** Alto da aperto: testata, riquadri, etichette. */
  h: number;
  slotY: number;
  slotX(index: number): number;
}

/** Il pannello delle pile avversarie: in alto a destra, a cavallo dell'orlo del campo avversario. */
function dockOf(L: TableLayout): Panel {
  const w = 4 * L.tileW + 3 * 16 + 24;
  const x = L.halfX + L.halfW - w;
  const y = L.foe.top - 15;
  // Sotto i riquadri le etichette e l'aria del simulatore (.pile-dock-row: padding-bottom 44px): da aperto copre il campo avversario fino alle sue etichette.
  return { x, y, w, h: DOCK_HEAD_H + 8 + L.tileH + 44, slotY: y + DOCK_HEAD_H + 8, slotX: index => x + 12 + index * (L.tileW + 16) };
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

/** La stella a quattro punte del Gettone, coi lati che curvano (viewBox 24). */
const STAR = new Path2D("M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0 Z");

/**
 * La targa del posto nel tema notte (.hud-chip): senza rettangolo dietro, i
 * pezzi poggiano sull'orlo del campo (`edge`) — il medaglione verde dei PV
 * (rubino sotto i 6) col numero grande e «PV» in bianco, il Gettone (il disco
 * scuro con la stella d'oro, vuota o piena e accesa), il rombo rubino del
 * Flusso. Torna la sua larghezza.
 */
function seatPlate(ctx: CanvasRenderingContext2D, state: GameState, seat: Seat, x: number, edge: number): number {
  const player = state.players[seat];
  const a = ctx.getTransform().a;
  let cx = x + 4 + 1;

  // I PV.
  const gem = 54;
  const gy = edge - gem / 2;
  const low = player.hp <= 5;
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
  const hp = String(player.hp);
  applyFont(ctx, hpFont);
  drawText(
    ctx,
    { kind: "text", text: hp, font: hpFont, color: "#ffffff", shadows: [{ x: 0, y: 1, blur: 2, color: "rgba(0,0,0,.8)" }, { x: 0, y: 0, blur: 6, color: "rgba(0,0,0,.6)" }] },
    cx + gem / 2 - textWidth(hpFont, hp) / 2,
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
