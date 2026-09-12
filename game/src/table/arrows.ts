// Le frecce del combattimento (simulatore/src/arrows.ts, table.ts
// paintArrows): dal bloccante all'attaccante che ferma (§6.3), blu d'acciaio
// il blocco, oro il contrattacco. L'attacco non ha freccia: si attacca sempre
// il Rubyfront avversario, e l'attaccante si illumina e basta. In mira la
// freccia tratteggiata segue il dito: dal puntatore all'attaccante da
// fermare, dal bloccante scelto al dito, dalla fonte di un effetto al dito.
// Una curva leggera (si segue meglio di una retta quando sono parecchie),
// che parte dal bordo della carta e si ferma sul bordo del bersaglio.

import type { GameState } from "@rubyfront/core/types";
import { BlurFilter, Container, Graphics, Point } from "pixi.js";
import type { Stage } from "../stage";
import type { Table } from "./table";

export type ArrowKind = "attack" | "block" | "counter" | "effect";

type Box = { x: number; y: number; w: number; h: number };

const COLOR: Record<ArrowKind, number> = { attack: 0xd24a64, block: 0x7fa3bc, counter: 0xd9a84e, effect: 0xff8ea6 };
/** L'alone di ogni freccia (drop-shadow): il blocco prende il blu del posto avversario (--foe del tema notte, all'85%). */
const GLOW: Record<ArrowKind, { color: number; alpha: number; blur: number }> = {
  attack: { color: 0xd24a64, alpha: 0.85, blur: 9 },
  block: { color: 0x8fb0ff, alpha: 0.85, blur: 9 },
  counter: { color: 0xd9a84e, alpha: 0.85, blur: 9 },
  effect: { color: 0xff8ea6, alpha: 0.95, blur: 10 },
};

/** La mira in corso: da una carta al dito, o dal dito a una carta. */
export interface AimArrow {
  kind: ArrowKind;
  from?: string;
  to?: string;
}

function center(box: Box): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** Dove la retta centro→centro esce dal rettangolo: la freccia parte e si ferma sul bordo. */
function edge(box: Box, toward: { x: number; y: number }): { x: number; y: number } {
  const c = center(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const scale = Math.min(dx === 0 ? Infinity : box.w / 2 / Math.abs(dx), dy === 0 ? Infinity : box.h / 2 / Math.abs(dy));
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

export class Arrows {
  private readonly glow = new Graphics();
  private readonly lines = new Graphics();
  private readonly blur = new BlurFilter({ strength: 5, quality: 3 });
  private state: GameState | null = null;
  private aim: AimArrow | null = null;
  private pointer: { x: number; y: number } | null = null;

  constructor(
    stage: Stage,
    private readonly table: Table
  ) {
    const layer: Container = table.arrows;
    this.glow.filters = [this.blur];
    layer.addChild(this.glow, this.lines);
    window.addEventListener("pointermove", event => {
      if (!this.aim) return;
      const rect = stage.app.canvas.getBoundingClientRect();
      const point = stage.world.toLocal(new Point(event.clientX - rect.left, event.clientY - rect.top));
      this.pointer = { x: point.x, y: point.y };
      this.draw();
    });
  }

  /** Dopo ogni disegno del tavolo: le frecce delle dichiarazioni. */
  update(state: GameState): void {
    this.state = state;
    this.draw();
  }

  /** La mira in corso (null la toglie): la freccia tratteggiata che segue il dito. */
  follow(aim: AimArrow | null): void {
    this.aim = aim;
    if (!aim) this.pointer = null;
    this.draw();
  }

  private draw(): void {
    this.glow.clear();
    this.lines.clear();
    const L = this.table.layout();
    const state = this.state;
    if (!L || !state) return;
    // La lavagna del simulatore è in scala: le frecce ci stanno dentro, e la seguono.
    const s = L.s;
    this.blur.strength = 5 * s + 2;
    const arrows: { kind: ArrowKind; from: Box; to: Box; pending?: boolean }[] = [];
    for (const declaration of state.declarations) {
      if (declaration.kind === "attack") continue;
      const from = state.cards[declaration.from];
      const to = state.cards[declaration.to];
      if (!from || !to || from.zone !== "field" || to.zone !== "field") continue;
      const a = this.table.box(from.uid);
      const b = this.table.box(to.uid);
      if (a && b) arrows.push({ kind: declaration.kind, from: a, to: b });
    }
    if (this.aim && this.pointer) {
      const point: Box = { x: this.pointer.x, y: this.pointer.y, w: 0, h: 0 };
      const from = this.aim.from ? this.table.box(this.aim.from) : point;
      const to = this.aim.to ? this.table.box(this.aim.to) : point;
      if (from && to) arrows.push({ kind: this.aim.kind, from, to, pending: true });
    }
    for (const arrow of arrows) {
      const pointFrom = arrow.from.w === 0 && arrow.from.h === 0;
      const pointTo = arrow.to.w === 0 && arrow.to.h === 0;
      const start = pointFrom ? { x: arrow.from.x, y: arrow.from.y } : edge(arrow.from, pointTo ? { x: arrow.to.x, y: arrow.to.y } : center(arrow.to));
      const end = pointTo ? { x: arrow.to.x, y: arrow.to.y } : edge(arrow.to, pointFrom ? { x: arrow.from.x, y: arrow.from.y } : center(arrow.from));
      this.arrow(arrow.kind, start, end, Boolean(arrow.pending), s);
    }
  }

  private arrow(kind: ArrowKind, from: { x: number; y: number }, to: { x: number; y: number }, pending: boolean, s: number): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const bend = Math.min(90 * s, length * 0.16);
    const control = { x: (from.x + to.x) / 2 - (dy / length) * bend, y: (from.y + to.y) / 2 + (dx / length) * bend };
    // La punta arretra di quanto è lunga, per non sbordare oltre il bersaglio.
    const head = 26 * s;
    const tipDx = to.x - control.x;
    const tipDy = to.y - control.y;
    const tipLen = Math.hypot(tipDx, tipDy) || 1;
    const base = { x: to.x - (tipDx / tipLen) * head, y: to.y - (tipDy / tipLen) * head };
    const normal = { x: -tipDy / tipLen, y: tipDx / tipLen };
    const wing = 13 * s;
    const width = 7 * s;
    const color = COLOR[kind];
    const glow = GLOW[kind];
    for (const [g, c, a] of [[this.glow, glow.color, glow.alpha], [this.lines, color, 1]] as const) {
      if (pending) this.dashes(g, from, control, base, 16 * s, 12 * s, c, a, width);
      else g.moveTo(from.x, from.y).quadraticCurveTo(control.x, control.y, base.x, base.y).stroke({ color: c, alpha: a, width, cap: "round" });
      g.poly([to.x, to.y, base.x + normal.x * wing, base.y + normal.y * wing, base.x - normal.x * wing, base.y - normal.y * wing]).fill({ color: c, alpha: a });
    }
  }

  /** La curva tratteggiata (stroke-dasharray 16 12): si campiona la quadratica e si posano i tratti lungo l'arco. */
  private dashes(
    g: Graphics,
    from: { x: number; y: number },
    control: { x: number; y: number },
    to: { x: number; y: number },
    dash: number,
    gap: number,
    color: number,
    alpha: number,
    width: number
  ): void {
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= 48; i += 1) {
      const t = i / 48;
      const u = 1 - t;
      points.push({ x: u * u * from.x + 2 * u * t * control.x + t * t * to.x, y: u * u * from.y + 2 * u * t * control.y + t * t * to.y });
    }
    let drawing = true;
    let left = dash;
    let current = points[0];
    g.moveTo(current.x, current.y);
    for (let i = 1; i < points.length; i += 1) {
      let next = points[i];
      let segment = Math.hypot(next.x - current.x, next.y - current.y);
      while (segment > left) {
        const k = left / segment;
        const cut = { x: current.x + (next.x - current.x) * k, y: current.y + (next.y - current.y) * k };
        if (drawing) g.lineTo(cut.x, cut.y);
        else g.moveTo(cut.x, cut.y);
        drawing = !drawing;
        current = cut;
        segment = Math.hypot(next.x - current.x, next.y - current.y);
        left = drawing ? dash : gap;
      }
      left -= segment;
      if (drawing) g.lineTo(next.x, next.y);
      else g.moveTo(next.x, next.y);
      current = next;
      next = points[i];
    }
    g.stroke({ color, alpha, width, cap: "round" });
  }
}
