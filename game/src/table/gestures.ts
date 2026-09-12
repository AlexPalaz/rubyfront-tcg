// I gesti del giocatore al tavolo del gioco (F4), come nel simulatore
// (table.ts): i tasti di combattimento sotto le carte (core/tabs.ts, §6.3,
// §6.4) in un velo scuro che si apre al passaggio, coi numeri della carta in
// testa; la mira dei blocchi; i tasti del Rubyfront («Schiera», «Abilità»,
// il flip dorato, §3.1); il doppio tocco che gioca dalla mano (§3.2); la
// barra della catena di risposta (§7.2); il trascinamento, con un fantasma
// che segue il dito — sulle tue pile, sul cassetto della mano, sul campo
// agganciato ai riquadri del tuo Fronte o a mano libera. Le regole stanno
// nel core (tabs.ts, gestures.ts: dropOnField, dropOnPile): qui si decide
// solo dove stanno i tasti e cosa si vede.

import { cardName, faceKind } from "@rubyfront/core/cards";
import { declareBlock, powerOf, staticCounter, undeclare } from "@rubyfront/core/combat";
import type { Ctx } from "@rubyfront/core/ctx";
import { FRONT_SLOT_X, MATTER_X, RUBYFRONT_X, SLOT_X, frontRowY } from "@rubyfront/core/geometry";
import type { Gestures } from "@rubyfront/core/gestures";
import { msg, t } from "@rubyfront/core/i18n";
import { chainTop, fieldCards, playSpot, seatLabel, zoneCards } from "@rubyfront/core/state";
import { cardMenu, combatTabs, handLocked, pickable, type CombatTab, type MenuAction, type TabAction, type TargetingMode } from "@rubyfront/core/tabs";
import type { CardInstance, GameState, Seat, ZoneId } from "@rubyfront/core/types";
import { Container, Graphics, Point, Rectangle, Sprite, Texture, Ticker, type FederatedPointerEvent } from "pixi.js";
import { faceTexture } from "../card/cache";
import { CARD_W } from "../card/theme";
import { drawText, fontMetrics, textWidth, type Font } from "../card/text";
import type { Stage } from "../stage";
import { SANS, THEME, paintPiece, linearGradient, withShadow } from "./appearance";
import { arrow, swords } from "./card";
import type { Arrows } from "./arrows";
import type { Menu } from "./menu";
import type { Aim } from "./aim";
import type { PileViewer } from "./pile-viewer";
import type { CardEvent, Table } from "./table";

const TAB: Font = { size: 16, weight: 700, family: SANS, spacing: 16 * 0.12, upper: true };
const STAT: Font = { size: 18.4, weight: 800, family: SANS };
const BAR: Font = { size: 16, weight: 400, family: SANS, spacing: 16 * 0.04 };
/** .combat-tab: padding 12px 10px, riga alta quanto il carattere. */
const TAB_H = 12 + 16 + 12 + 2;
const TAB_GAP = 10;
const VEIL_PAD = 14;
/** .combat-stat: padding 6px 11px, icona di 18. */
const STAT_H = 6 + 18.4 + 6 + 2;
/** Il margine attorno al velo per il suo alone e la sua ombra. */
const VEIL_MARGIN = 50;
/** .deploy-btn / .ability-btn / .flip-btn: padding 9px 18px, riga di 16. */
const RF_H = 9 + 16 + 9 + 2;

interface ChipColors {
  fill: string | [string, string];
  edge: string;
  ink: string;
  shadow: string | null;
}
const RUBY: ChipColors = { fill: ["#b81a41", "#9e0f34"], edge: "#e56a86", ink: "#fdeef1", shadow: "rgba(158,15,52,.5)" };
const TINTS: Record<CombatTab["kind"], ChipColors> = {
  attack: RUBY,
  block: RUBY,
  confirm: RUBY,
  counter: { fill: ["#e8b85a", "#c8922a"], edge: "#f5d68a", ink: "#1a1206", shadow: "rgba(200,146,42,.45)" },
  cancel: { fill: "rgba(255,255,255,.08)", edge: "rgba(255,255,255,.35)", ink: "#f3edf0", shadow: null },
};
const GOLD: ChipColors = { fill: ["#ffd977", "#d9a84e"], edge: "#fff0b8", ink: "#2a1a02", shadow: "rgba(120,80,10,.5)" };

/** Un tasto dipinto: fondo (pieno o in gradiente), filo, ombra, la scritta al centro. */
function button(ctx: CanvasRenderingContext2D, res: number, x: number, y: number, w: number, h: number, label: string, font: Font, tint: ChipColors): void {
  const fill = (): void => {
    ctx.fillStyle = typeof tint.fill === "string" ? tint.fill : linearGradient(ctx, 180, x, y, w, h, [[0, tint.fill[0]], [1, tint.fill[1]]]);
    ctx.fillRect(x, y, w, h);
  };
  if (tint.shadow) withShadow(ctx, res, { x: 0, y: 4, blur: 12, color: tint.shadow }, fill);
  fill();
  ctx.strokeStyle = tint.edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const { ascent, descent } = fontMetrics(font);
  drawText(ctx, { kind: "text", text: label, font, color: tint.ink }, x + (w - textWidth(font, label)) / 2, y + (h + ascent - descent) / 2);
}

/** Una zona che si tocca, sopra un pezzo dipinto. */
function tapZone(x: number, y: number, w: number, h: number, run: () => void): Container {
  const hit = new Container({ label: "tap" });
  hit.eventMode = "static";
  hit.cursor = "pointer";
  hit.hitArea = new Rectangle(x, y, w, h);
  hit.on("pointertap", (event: FederatedPointerEvent) => {
    event.stopPropagation();
    run();
  });
  return hit;
}

export class TableGestures {
  private readonly layer = new Container({ label: "gestures" });
  private readonly rubyfrontButtons = new Container({ label: "rubyfront-buttons" });
  private readonly toolbar = new Container({ label: "chain" });
  /** Le carte col velo: i loro tasti (anche nessuno: la coricata apre i suoi numeri). */
  private readonly veiled = new Map<string, CombatTab[]>();
  private veil: { uid: string; root: Container; texture: Texture } | null = null;
  /** La mira di un blocco (§6.3): dall'attaccante o dalla propria Entità. */
  private blockAim: TargetingMode | null = null;
  /** L'ultima carta lasciata dopo un trascinamento, e quando (effects/director.ts: la giocata trascinata non vola in arco). */
  lastRelease: { uid: string; at: number } | null = null;
  /** Il trascinamento: la carta presa, dove, da dove era partita; il fantasma quando il dito si è mosso davvero. */
  private held: {
    uid: string;
    start: { x: number; y: number };
    grab: { x: number; y: number };
    origin: { x: number; y: number; z: number } | null;
    ghost: Sprite | null;
  } | null = null;
  private rubyfrontKey = "";
  private barKey = "";
  private readonly paintedCount = { rubyfront: [] as Texture[], barra: [] as Texture[] };

  constructor(
    private readonly stage: Stage,
    private readonly table: Table,
    private readonly ctx: Ctx,
    private readonly gestures: Gestures,
    private readonly aim: Aim,
    private readonly me: Seat,
    /** Il ridisegno della partita (tavolo, gesti, catena). */
    private readonly redraw: () => void,
    /** Il menu delle carte (tasto destro, pressione lunga). */
    private readonly menu: Menu,
    /** La vetrina, per sfogliare le pile pubbliche. */
    private readonly pileViewer: PileViewer,
    /** Le frecce: in mira, quella tratteggiata che segue il dito. */
    private readonly arrows: Arrows
  ) {
    this.layer.addChild(this.rubyfrontButtons, this.toolbar);
    // Sopra le carte, sotto scene, dadi e vetrine (che si portano in cima da sé).
    stage.world.addChildAt(this.layer, stage.world.getChildIndex(table.root) + 1);
    table.onCard(cardEvent => this.overCard(cardEvent));
    // La mira di un effetto: il velo coi numeri starebbe sopra il bersaglio e
    // si prenderebbe il tocco (serviva il doppio clic); si chiude, e finché
    // si mira non si riapre.
    this.aim.onOpen(() => this.closeVeil());
    table.onPile((seat, zone) => this.browse(seat, zone));
    table.onEmpty(() => {
      if (this.blockAim) this.cancelAim();
    });
    window.addEventListener("keydown", event => {
      if (event.key === "Escape" && this.blockAim) this.cancelAim();
    });
    window.addEventListener("pointermove", event => this.move(event));
    window.addEventListener("pointerup", event => this.release(event));
    window.addEventListener("pointercancel", () => this.cancelGrab());
  }

  /**
   * L'invito a scartare (§6.5): non si accende da sé all'ottava carta —
   * pescarla a metà turno è legale, e sarebbe un rimprovero per tutto il
   * turno. Si accende quando il Fine turno viene fermato (session.ts,
   * turn.ts: promptDiscard), si spegne al primo scarto o al cambio di turno:
   * il turno se lo porta scritto. Come il simulatore (table.ts, discardPrompt).
   */
  private discardPrompt: { seat: Seat; turn: number } | null = null;

  /** Il Fine turno fermato dalla mano piena di `seat`: l'invito si accende; vero la prima volta nel turno (la riga in chat). */
  promptDiscard(seat: Seat): boolean {
    const turn = this.ctx.state().turn;
    const already = this.discardPrompt?.seat === seat && this.discardPrompt.turn === turn;
    this.discardPrompt = { seat, turn };
    this.redraw();
    return !already;
  }

  private clearDiscardPrompt(seat: Seat): void {
    if (this.discardPrompt?.seat === seat) this.discardPrompt = null;
  }

  /** Le carte che ora offrono un gesto (per le prove da fuori). */
  cardsWithActions(): string[] {
    return [...this.veiled].filter(([, tabs]) => tabs.length > 0).map(([uid]) => uid);
  }

  /** Dopo ogni disegno del tavolo: tasti, segni, velo aperto, Rubyfront, catena. */
  update(): void {
    const state = this.ctx.state();
    this.veiled.clear();
    const tableGestures: string[] = [];
    for (const card of fieldCards(state)) {
      const tabs = combatTabs(this.ctx, card, this.blockAim);
      // La carta coricata nasconde i suoi numeri sotto la vicina: al
      // passaggio apre il velo coi numeri, anche senza tasti.
      const entity = this.ctx.card(card.cardId).kind === "entity" && !card.facedown;
      if (tabs.length) tableGestures.push(card.uid);
      if (tabs.length || (entity && card.tapped)) this.veiled.set(card.uid, tabs);
    }
    const veiled = zoneCards(state, this.me, "hand").filter(card => this.gestures.unaffordable(card)).map(card => card.uid);
    this.table.marks({ tableGestures, veiled });
    // §6.5 — l'invito a scartare (simulatore, discardPrompt): la tua Zona di
    // Ritiro si accende quando il Fine turno è stato fermato dalla mano piena,
    // in quel turno e finché le carte sono più di 7.
    const prompt = this.discardPrompt;
    this.table.setDiscardHint(prompt?.seat === this.me && prompt.turn === state.turn && this.ctx.controls(this.me) && zoneCards(state, this.me, "hand").length > 7);
    if (this.blockAim) this.table.aim(this.candidates(this.blockAim));
    // Il velo aperto segue la carta: si rifà coi tasti nuovi, o si chiude.
    if (this.veil) {
      const uid = this.veil.uid;
      this.closeVeil();
      if (this.veiled.has(uid)) this.openVeil(uid);
    }
    this.updateRubyfront(state);
    this.updateChain(state);
  }

  private overCard(cardEvent: CardEvent): void {
    if (this.table.isBlocked()) return;
    const card = this.ctx.state().cards[cardEvent.uid];
    if (!card) return;
    if (cardEvent.type === "over" && cardEvent.zone === "field" && this.veiled.has(card.uid) && !this.aim.isOpen()) {
      // Mentre si trascina, il passaggio sopra una carta non apre il suo velo.
      if (!this.held?.ghost) this.openVeil(card.uid);
    }
    else if (cardEvent.type === "tap" && cardEvent.zone === "field" && this.blockAim && pickable(this.ctx, card, this.blockAim)) this.confirm(card);
    else if (cardEvent.type === "double" && cardEvent.zone === "hand") this.playFromHand(card);
    else if (cardEvent.type === "tap" && (cardEvent.zone === "abisso" || cardEvent.zone === "ritiro")) this.browse(card.owner, cardEvent.zone);
    else if (cardEvent.type === "grab") this.grab(card, cardEvent);
    else if (cardEvent.type === "menu") this.openMenu(card, cardEvent);
  }

  // ------------------------------------------------------------ le pile

  /** §5 — l'Abisso e la Zona di Ritiro sono pubblici: si sfogliano in ogni momento (non mentre si mira). */
  private browse(seat: Seat, zone: ZoneId): void {
    if (this.blockAim || this.aim.isOpen() || this.held?.ghost) return;
    const state = this.ctx.state();
    const title = t("overlay.title", { zone: t(zone === "ritiro" ? "zone.ritiro.full" : zone === "abisso" ? "zone.abisso" : "zone.deck"), name: seatLabel(state, seat, this.me) });
    void this.pileViewer.browse(title, zoneCards(state, seat, zone));
  }

  // --------------------------------------------------------------- il menu

  /** Il menu della carta (core/tabs.ts, cardMenu). Nella mira dei blocchi il tasto destro rinuncia; la mano chiusa a chiave non ne ha. */
  private openMenu(card: CardInstance, cardEvent: CardEvent): void {
    this.cancelGrab();
    if (this.blockAim) {
      this.cancelAim();
      return;
    }
    if (this.aim.isOpen()) return;
    if (card.zone === "hand" && handLocked(this.ctx, card.owner)) return;
    const items = cardMenu(this.ctx, card).map(entry =>
      "rule" in entry ? { label: "", rule: true } : { label: entry.label, ...(entry.disabled ? { disabled: true } : {}), run: () => this.item(card.uid, entry.action) }
    );
    this.menu.open(cardEvent.x, cardEvent.y, items);
  }

  /** La voce scelta (core/tabs.ts dice quale, qui si compie). */
  private item(uid: string, action: MenuAction): void {
    const card = this.ctx.state().cards[uid];
    if (!card || this.table.isBlocked()) return;
    switch (action.do) {
      case "tap":
        void this.ctx.dispatch({ t: "tap", uid, tapped: action.tapped });
        return;
      case "facedown":
        void this.ctx.dispatch({ t: "facedown", uid, facedown: action.facedown });
        return;
      case "flipNexus":
        void this.gestures.flipToNexus(card);
        return;
      case "flip":
        void this.ctx.dispatch({ t: "flip", uid, face: action.face });
        return;
      case "toZone":
        void this.ctx.dispatch({ t: "toZone", uid, zone: action.zone, toBottom: action.toBottom });
        return;
      case "discard":
        void this.gestures.discard(card).then(passed => {
          if (passed) this.clearDiscardPrompt(card.owner);
          this.redraw();
        });
        return;
    }
  }

  // ------------------------------------------------------ il trascinamento

  /**
   * La presa (drag.ts nel simulatore): parte davvero solo quando il dito si
   * muove, così il tocco e il doppio tocco restano del tavolo. La mano
   * avversaria e la tua quando è chiusa a chiave (§6) non si prendono; in
   * mira nemmeno.
   */
  private grab(card: CardInstance, cardEvent: CardEvent): void {
    if (this.blockAim || this.aim.isOpen()) return;
    if (card.zone !== "hand" && card.zone !== "field") return;
    if (card.zone === "hand" && (!this.ctx.controls(card.owner) || handLocked(this.ctx, card.owner))) return;
    const box = this.table.box(card.uid);
    if (!box) return;
    this.held = {
      uid: card.uid,
      start: { x: cardEvent.x, y: cardEvent.y },
      grab: { x: cardEvent.x - box.x, y: cardEvent.y - box.y },
      origin: card.zone === "field" ? { x: card.x, y: card.y, z: card.z } : null,
      ghost: null,
    };
  }

  /** Il punto del puntatore nel mondo (unità di progetto). */
  private worldPoint(event: PointerEvent): Point {
    const rect = this.stage.app.canvas.getBoundingClientRect();
    return this.stage.world.toLocal(new Point(event.clientX - rect.left, event.clientY - rect.top));
  }

  private move(event: PointerEvent): void {
    const held = this.held;
    if (!held) return;
    const point = this.worldPoint(event);
    if (!held.ghost) {
      if (Math.hypot(point.x - held.start.x, point.y - held.start.y) < 6) return;
      held.ghost = this.ghost(held.uid);
      if (!held.ghost) {
        this.held = null;
        return;
      }
    }
    held.ghost.position.set(point.x - held.grab.x, point.y - held.grab.y);
    // §3.1 — l'Entità che riceverebbe l'Oggetto, se lo lasciassi adesso.
    const live = this.ctx.state().cards[held.uid];
    const L = this.table.layout();
    if (live && L) {
      const at = L.canonical(held.ghost.x, held.ghost.y, this.me);
      this.table.markAssign(this.gestures.entityUnder(live, at.x, at.y)?.uid ?? null);
    }
  }

  /** Il fantasma della carta presa, a misura di tessera; l'originale si spegne finché non la lasci. */
  private ghost(uid: string): Sprite | null {
    const live = this.ctx.state().cards[uid];
    const L = this.table.layout();
    if (!live || !L) return null;
    const ghost = new Sprite(Texture.WHITE);
    ghost.width = L.tileW;
    ghost.height = L.tileH;
    ghost.alpha = 0.92;
    ghost.eventMode = "none";
    this.layer.addChild(ghost);
    const res = this.stage.visible().scale * this.stage.app.renderer.resolution;
    void faceTexture(live.cardId, live.face, this.ctx.locale(), (L.tileW / CARD_W) * res).then(texture => {
      if (!texture || ghost.destroyed) return;
      ghost.texture = texture;
      ghost.width = L.tileW;
      ghost.height = L.tileH;
    });
    const view = this.table.view(uid);
    if (view) view.alpha = 0.35;
    return ghost;
  }

  private cancelGrab(): void {
    const held = this.held;
    this.held = null;
    if (!held?.ghost) return;
    held.ghost.destroy();
    this.table.markAssign(null);
    this.redraw();
  }

  /** Il rilascio: sulle tue pile, sul cassetto della mano, o sul campo — il resto lo decide il core. */
  private release(event: PointerEvent): void {
    const held = this.held;
    this.held = null;
    // Senza movimento era un tocco: lo tiene il tavolo.
    if (!held?.ghost) return;
    this.lastRelease = { uid: held.uid, at: Date.now() };
    const point = this.worldPoint(event);
    const topLeft = { x: held.ghost.x, y: held.ghost.y };
    held.ghost.destroy();
    this.table.markAssign(null);
    const live = this.ctx.state().cards[held.uid];
    const L = this.table.layout();
    if (!live || !L || this.table.isBlocked()) {
      this.redraw();
      return;
    }
    const inside = (x: number, y: number, w: number, h: number): boolean => point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h;
    // Le tue pile, nella fila di servizio.
    const piles: { zone: "abisso" | "ritiro" | "deck"; x: number }[] = [
      { zone: "abisso", x: SLOT_X.abisso },
      { zone: "ritiro", x: SLOT_X.ritiro },
      { zone: "deck", x: SLOT_X.deck },
    ];
    const back = L.mine.back;
    const pile = back === null ? undefined : piles.find(entry => inside(L.x(entry.x), back, L.tileW, L.tileH));
    if (pile) {
      void this.gestures.dropOnPile(live, this.me, pile.zone, held.origin).then(dropped => {
        if (dropped) this.clearDiscardPrompt(live.owner);
        this.redraw();
      });
      return;
    }
    // Il cassetto della mano.
    if (inside(L.hand.x, L.hand.y, L.hand.w, L.hand.h)) {
      if (live.zone === "hand") this.redraw();
      else
        void this.gestures.dropOnPile(live, this.me, "hand", held.origin).then(dropped => {
          if (dropped) this.clearDiscardPrompt(live.owner);
          this.redraw();
        });
      return;
    }
    // Il campo: agganciata a un riquadro della tua fila del Fronte, o a mano libera.
    const snap = [RUBYFRONT_X, ...FRONT_SLOT_X, MATTER_X].find(x => inside(L.x(x), L.mine.front, L.tileW, L.tileH));
    const drop = snap !== undefined ? { x: snap, y: frontRowY(this.me), snapped: true } : { ...L.canonical(topLeft.x, topLeft.y, this.me), snapped: false };
    this.gestures.dropOnField(live, drop, held.origin);
    this.redraw();
  }

  // ------------------------------------------------------------ il velo

  private openVeil(uid: string): void {
    if (this.veil?.uid === uid) return;
    this.closeVeil();
    const state = this.ctx.state();
    const card = state.cards[uid];
    const tabs = this.veiled.get(uid);
    const box = this.table.box(uid);
    if (!card || !tabs || !box) return;
    const facts = this.ctx.card(card.cardId);
    // I numeri in testa: la Potenza di adesso, il Contrattacco se c'è.
    const stats: { icon: "swords" | "arrow"; text: string }[] = [];
    if (facts.kind === "entity" && !card.facedown) {
      const power = powerOf(card, this.ctx.card, state);
      if (power !== null) stats.push({ icon: "swords", text: String(power) });
      const counter = (facts.counterattack ?? 0) + (card.counterBonus ?? 0) + staticCounter(state, card, this.ctx.card);
      if (counter > 0) stats.push({ icon: "arrow", text: `+${counter}` });
    }
    const chipW = (text: string): number => 1 + 11 + 18 + 5 + textWidth(STAT, text) + 11 + 1;
    const statsW = stats.reduce((sum, stat) => sum + chipW(stat.text), 0) + TAB_GAP * Math.max(0, stats.length - 1);
    const tabsW = tabs.reduce((max, tab) => Math.max(max, textWidth(TAB, tab.label) + 20 + 2), 0);
    const contentH = (stats.length ? STAT_H : 0) + (stats.length && tabs.length ? TAB_GAP : 0) + tabs.length * TAB_H + TAB_GAP * Math.max(0, tabs.length - 1);
    // Il velo è grande quanto la carta; se i tasti chiedono di più, cresce oltre i suoi bordi.
    const w = Math.max(box.w, Math.max(statsW, tabsW) + 2 * VEIL_PAD);
    const h = Math.max(box.h, contentH + 2 * VEIL_PAD);
    const x = box.x + box.w / 2 - w / 2;
    const y = box.y + box.h / 2 - h / 2;
    const top = (h - contentH) / 2;
    const tabsTop = top + (stats.length ? STAT_H + (tabs.length ? TAB_GAP : 0) : 0);
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;

    const texture = paintPiece(w + 2 * VEIL_MARGIN, h + 2 * VEIL_MARGIN, res, ctx => {
      ctx.translate(VEIL_MARGIN, VEIL_MARGIN);
      // L'alone rubino a 2px e l'ombra sotto; poi il vetro scuro e il filo.
      withShadow(ctx, res, { x: 0, y: 10, blur: 30, color: "rgba(0,0,0,.5)" }, () => {
        ctx.fillStyle = "rgba(224,49,75,.35)";
        ctx.fillRect(-2, -2, w + 4, h + 4);
      });
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(9,7,9,.8)";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(224,49,75,.7)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      let chipX = (w - statsW) / 2;
      for (const stat of stats) {
        const cw = chipW(stat.text);
        ctx.fillStyle = "rgba(0,0,0,.55)";
        ctx.fillRect(chipX, top, cw, STAT_H);
        ctx.strokeStyle = "rgba(255,255,255,.35)";
        ctx.strokeRect(chipX + 0.5, top + 0.5, cw - 1, STAT_H - 1);
        if (stat.icon === "swords") swords(ctx, chipX + 12, top + (STAT_H - 18) / 2, 18, "#ffffff");
        else arrow(ctx, chipX + 12, top + (STAT_H - 18) / 2, 18, "#ffffff");
        const { ascent, descent } = fontMetrics(STAT);
        drawText(ctx, { kind: "text", text: stat.text, font: STAT, color: "#ffffff" }, chipX + 12 + 18 + 5, top + (STAT_H + ascent - descent) / 2);
        chipX += cw + TAB_GAP;
      }
      tabs.forEach((tab, index) => {
        button(ctx, res, VEIL_PAD, tabsTop + index * (TAB_H + TAB_GAP), w - 2 * VEIL_PAD, TAB_H, tab.label, TAB, TINTS[tab.kind]);
      });
    });
    const root = new Container({ label: "veil" });
    const sprite = new Sprite(texture);
    sprite.position.set(x - VEIL_MARGIN, y - VEIL_MARGIN);
    root.addChild(sprite);
    root.eventMode = "static";
    root.hitArea = new Rectangle(x, y, w, h);
    root.on("pointerleave", () => this.closeVeil());
    // In mira, il fondo del velo vale come la carta: sceglie.
    root.on("pointertap", () => {
      const live = this.ctx.state().cards[uid];
      if (live && this.blockAim && pickable(this.ctx, live, this.blockAim)) this.confirm(live);
    });
    tabs.forEach((tab, index) => {
      root.addChild(tapZone(x + VEIL_PAD, y + tabsTop + index * (TAB_H + TAB_GAP), w - 2 * VEIL_PAD, TAB_H, () => this.press(uid, tab.action)));
    });
    this.layer.addChildAt(root, 0);
    this.veil = { uid, root, texture };
  }

  private closeVeil(): void {
    if (!this.veil) return;
    this.veil.root.destroy({ children: true });
    this.veil.texture.destroy(true);
    this.veil = null;
  }

  /** Il gesto di un tasto (core/tabs.ts dice quale, qui si compie). */
  private press(uid: string, action: TabAction): void {
    this.closeVeil();
    if (this.table.isBlocked()) return;
    const card = this.ctx.state().cards[uid];
    if (!card) return;
    switch (action.do) {
      case "attack":
        void this.gestures.declareAttack(card);
        return;
      case "undeclare":
        void undeclare(this.ctx, card, action.declaration);
        return;
      case "target":
        this.startAim({ mode: "block", attacker: card.uid, kind: action.kind }, t(action.kind === "counter" ? "target.counter" : "target.block"));
        return;
      case "targetFrom":
        this.startAim({ mode: "blocker", blocker: card.uid, kind: action.kind }, t(action.kind === "counter" ? "target.attacker.counter" : "target.attacker.block"));
        return;
      case "confirm":
        this.confirm(card);
        return;
      case "cancel":
        this.cancelAim();
        return;
    }
  }

  // ----------------------------------------------------- la mira dei blocchi

  private candidates(mode: TargetingMode): { candidates: string[]; legalOnes: string[] } {
    const cards = fieldCards(this.ctx.state()).filter(card => pickable(this.ctx, card, mode));
    // Sceglibile ma sconsigliata: la tappata, la coperta, il Rubyfront (§6.3).
    // L'arbitro non è il tavolo: resta sceglibile lo stesso.
    const legalOnes = mode.mode === "block" ? cards.filter(card => this.gestures.looksPlayable(card)) : cards;
    return { candidates: cards.map(card => card.uid), legalOnes: legalOnes.map(card => card.uid) };
  }

  private startAim(mode: TargetingMode, hint: string): void {
    this.blockAim = mode;
    this.aim.nameplate(hint);
    // Dal dito all'attaccante da fermare, o dal bloccante scelto al dito.
    if (mode.mode === "block") this.arrows.follow({ kind: mode.kind, to: mode.attacker });
    else if (mode.mode === "blocker") this.arrows.follow({ kind: mode.kind, from: mode.blocker });
    this.redraw();
  }

  private cancelAim(): void {
    this.blockAim = null;
    this.table.aim(null);
    this.aim.nameplate(null);
    this.arrows.follow(null);
    this.redraw();
  }

  private confirm(chosen: CardInstance): void {
    const mode = this.blockAim;
    if (mode?.mode === "block") {
      this.cancelAim();
      void declareBlock(this.ctx, chosen, mode.attacker, mode.kind);
    } else if (mode?.mode === "blocker") {
      const blocker = this.ctx.state().cards[mode.blocker];
      this.cancelAim();
      if (blocker) void declareBlock(this.ctx, blocker, chosen.uid, mode.kind);
    }
  }

  // ------------------------------------------------------------- la mano

  /** Il doppio tocco gioca: Entità sul primo slot libero del Fronte, Materie nella loro fila (§5). */
  private playFromHand(card: CardInstance): void {
    if (card.zone !== "hand" || !this.ctx.controls(card.owner)) return;
    if (this.gestures.unaffordable(card) || handLocked(this.ctx, card.owner)) return;
    const state = this.ctx.state();
    const spot = playSpot(state, card.owner, faceKind(card.cardId, card.face));
    void this.gestures.place(card, spot.x, spot.y, state.zTop + 1);
  }

  // ----------------------------------------------------------- il Rubyfront

  /** I tasti sul riquadro del tuo Rubyfront: «Schiera» in Richiamo, «Abilità» schierato, il flip quando passerebbe. */
  private updateRubyfront(state: GameState): void {
    const L = this.table.layout();
    if (!L) return;
    const buttons: { label: string; tint: ChipColors; dimmed: boolean; line: 0 | 1; run: () => void }[] = [];
    const waiting = this.gestures.waitingRubyfront(this.me);
    // I tasti compaiono con la carta: durante il suo ingresso (nascosta) non ci sono.
    const hidden = (uid: string | undefined): boolean => uid !== undefined && this.table.view(uid)?.visible === false;
    if (hidden(waiting?.uid) || hidden(this.gestures.deployedRubyfront(this.me)?.uid)) {
      // niente tasti finché il Rubyfront non si è posato
    } else if (waiting && this.ctx.controls(this.me)) {
      // Spento quando lo schieramento non passerebbe (§3.1): la regola resta dell'engine.
      buttons.push({ label: t("recall.deploy"), tint: RUBY, dimmed: this.gestures.deployBlock(waiting) !== null, line: 0, run: () => void this.gestures.deployRubyfront(this.me) });
    } else if (!waiting && this.ctx.arbitrated() && this.ctx.controls(this.me)) {
      const rubyfront = this.gestures.deployedRubyfront(this.me);
      if (rubyfront) {
        // Spento nel turno altrui, e con la catena aperta (il tavolo è in penombra, §7.2).
        buttons.push({ label: t("recall.abilities"), tint: RUBY, dimmed: state.active !== this.me || Boolean(state.chain), line: 0, run: () => void this.gestures.openAbilities(this.me) });
        if (this.gestures.flipReady(rubyfront)) {
          buttons.push({
            label: t("recall.flip"),
            tint: GOLD,
            dimmed: false,
            line: 1,
            run: () => {
              const live = this.ctx.state().cards[rubyfront.uid];
              if (live && this.gestures.flipReady(live)) void this.gestures.flipToNexus(live);
            },
          });
        }
      }
    }
    const v = this.stage.visible();
    const boxX = L.x(RUBYFRONT_X);
    const bottom = L.mine.front + L.tileH;
    const key = JSON.stringify([boxX, bottom, L.tileW, v.scale, buttons.map(firstButton => [firstButton.label, firstButton.dimmed, firstButton.line])]);
    if (key === this.rubyfrontKey) return;
    this.rubyfrontKey = key;
    for (const texture of this.paintedCount.rubyfront.splice(0)) texture.destroy(true);
    for (const child of this.rubyfrontButtons.removeChildren()) child.destroy({ children: true });
    const res = v.scale * this.stage.app.renderer.resolution;
    const margin = 24;
    for (const entry of buttons) {
      const w = Math.ceil(textWidth(TAB, entry.label)) + 36 + 2;
      // A cavallo del bordo basso della carta (bottom: -17px); il flip una riga sotto (-58px).
      const x = boxX + L.tileW / 2 - w / 2;
      const y = bottom + (entry.line === 0 ? 17 : 58) - RF_H;
      const texture = paintPiece(w + 2 * margin, RF_H + 2 * margin, res, ctx => button(ctx, res, margin, margin, w, RF_H, entry.label, TAB, entry.tint));
      this.paintedCount.rubyfront.push(texture);
      const sprite = new Sprite(texture);
      sprite.position.set(x - margin, y - margin);
      sprite.alpha = entry.dimmed ? 0.45 : 1;
      // Il flip pronto respira (flip-btn-breathe, 1.6s): un anello dorato che si allarga e sfuma.
      if (entry.tint === GOLD) {
        const ring = new Graphics();
        ring.eventMode = "none";
        const tick = (): void => {
          if (ring.destroyed) {
            Ticker.shared.remove(tick);
            return;
          }
          const k = (performance.now() % 1600) / 1600;
          const up = k < 0.5 ? k * 2 : 2 - k * 2;
          const spread = 7 * up;
          ring.clear().rect(x - spread, y - spread, w + 2 * spread, RF_H + 2 * spread).stroke({ color: 0xffd666, width: 2, alpha: 0.75 * (1 - up) });
        };
        Ticker.shared.add(tick);
        this.rubyfrontButtons.addChild(ring);
      }
      this.rubyfrontButtons.addChild(sprite);
      if (!entry.dimmed) {
        this.rubyfrontButtons.addChild(tapZone(x, y, w, RF_H, () => {
          if (!this.table.isBlocked()) entry.run();
        }));
      }
    }
  }

  // ----------------------------------------------------------- la catena

  /** §7.2 — la barra della catena: cosa c'è in cima, a chi tocca; chi deve rispondere accetta da qui. */
  private updateChain(state: GameState): void {
    const chain = state.chain;
    const top = chainTop(state);
    let text: string | null = null;
    let mine = false;
    if (chain && top) {
      const card = `«${cardName(top.cardId, this.ctx.locale())}»`;
      mine = !chain.resolving && this.ctx.controls(chain.turn);
      text = chain.resolving
        ? t("chain.bar.resolving")
        : mine
          ? t("chain.bar.mine", { card })
          : t("chain.bar.theirs", { card, name: seatLabel(state, chain.turn, this.me) });
    }
    const v = this.stage.visible();
    const key = JSON.stringify([text, mine, v.x, v.y, v.width, v.scale]);
    if (key === this.barKey) return;
    this.barKey = key;
    for (const texture of this.paintedCount.barra.splice(0)) texture.destroy(true);
    for (const child of this.toolbar.removeChildren()) child.destroy({ children: true });
    if (text === null) return;
    const res = v.scale * this.stage.app.renderer.resolution;
    const accept = t("chain.accept");
    const textW = textWidth(BAR, text);
    const buttonW = mine ? Math.ceil(textWidth(BAR, accept)) + 28 + 2 : 0;
    const buttonH = 6 + 20 + 6 + 2;
    const h = 1 + 8 + (mine ? buttonH : 20) + 8 + 1;
    const w = Math.ceil(1 + 18 + textW + (mine ? 14 + buttonW : 0) + (mine ? 10 : 18) + 1);
    const x = v.x + (v.width - w) / 2;
    const y = v.y + 176;
    const margin = 50;
    const { ascent, descent } = fontMetrics(BAR);
    const texture = paintPiece(w + 2 * margin, h + 2 * margin, res, ctx => {
      ctx.translate(margin, margin);
      // Il vetro scuro del tema notte (--glass-heavy), col filo rubino.
      withShadow(ctx, res, { x: 0, y: 6, blur: 24, color: "rgba(0,0,0,.55)" }, () => {
        ctx.fillStyle = THEME.glass;
        ctx.fillRect(0, 0, w, h);
      });
      ctx.fillStyle = THEME.glass;
      ctx.fillRect(0, 0, w, h);
      // color-mix(in srgb, var(--ruby) 60%, var(--line)) del tema notte.
      ctx.strokeStyle = "rgb(176,65,87)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      drawText(ctx, { kind: "text", text: text!, font: BAR, color: THEME.ink }, 19, (h + ascent - descent) / 2);
      if (mine) {
        const bx = 19 + textW + 14;
        const by = (h - buttonH) / 2;
        // Il tasto di servizio: la piastra scura col filo di luce in cima.
        const g = ctx.createLinearGradient(0, by, 0, by + buttonH);
        g.addColorStop(0, "#241d22");
        g.addColorStop(1, "#151116");
        ctx.fillStyle = g;
        ctx.fillRect(bx, by, buttonW, buttonH);
        ctx.fillStyle = "rgba(255,255,255,.07)";
        ctx.fillRect(bx + 1, by + 1, buttonW - 2, 1);
        ctx.strokeStyle = THEME.line;
        ctx.strokeRect(bx + 0.5, by + 0.5, buttonW - 1, buttonH - 1);
        drawText(ctx, { kind: "text", text: accept, font: BAR, color: THEME.ink }, bx + 15, by + (buttonH + ascent - descent) / 2);
      }
    });
    this.paintedCount.barra.push(texture);
    const sprite = new Sprite(texture);
    sprite.position.set(x - margin, y - margin);
    this.toolbar.addChild(sprite);
    if (mine) {
      this.toolbar.addChild(tapZone(x + 19 + textW + 14, y + (h - buttonH) / 2, buttonW, buttonH, () => {
        const live = this.ctx.state().chain;
        if (!live || live.resolving) return;
        const seat = live.turn;
        void this.ctx.dispatch({ t: "pass", seat }).then(passed => {
          if (passed) this.ctx.log(msg("log.chain.pass", { seat }), seat);
        });
      }));
    }
  }
}
