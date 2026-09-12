// Le Materie che agiscono (animazioni, 2026-09-12): un effetto per tinta,
// dalla fonte al bersaglio. Distruttiva: una palla di fuoco rubino con la sua
// coda, che scoppia in braci. Dinamica: il fulmine azzurro, spezzato,
// che lampeggia tre volte e sparge scintille. Dimensionale: il portale viola
// che si apre sul bersaglio, gira, risucchia le sue particelle e si chiude.

import { BlurFilter, Container, Graphics } from "pixi.js";
import type { Stage } from "../stage";
import { tween, easeIn, easeOut } from "../table/animation";
import type { Camera } from "./camera";
import { random } from "./random";
import type { Particles } from "./particles";

export type TintKind = "destructive" | "dynamic" | "dimensional";

export const TINT_COLORS: Record<TintKind, readonly number[]> = {
  destructive: [0xff4d5e, 0xff8a3a, 0xffd27a],
  dynamic: [0x7fe3ff, 0xffffff, 0x4aa8ff],
  dimensional: [0xb48cff, 0x7a4fe0, 0xf0d6ff],
};

interface XY {
  x: number;
  y: number;
}

export class Spells {
  constructor(
    private readonly stage: Stage,
    private readonly layer: Container,
    private readonly particles: Particles,
    private readonly camera: Camera
  ) {}

  /** L'effetto della tinta, dalla fonte al bersaglio (senza bersaglio, sulla fonte). */
  cast(tint: TintKind, from: XY, a: XY | null): Promise<void> {
    if (tint === "destructive") return this.fire(from, a ?? from);
    if (tint === "dynamic") return this.lightning(from, a ?? { x: from.x, y: from.y - 260 });
    return this.portal(a ?? from, from);
  }

  /** L'aura di una carta che si accende nella sua tinta (una Materia che agisce, il Rubyfront che usa un'abilità). */
  aura(tint: TintKind, x: number, y: number, w: number, h: number): Promise<void> {
    const colors = TINT_COLORS[tint];
    const ring = new Graphics();
    ring.blendMode = "add";
    ring.filters = [new BlurFilter({ strength: 6, quality: 2 })];
    this.layer.addChild(ring);
    this.particles.burst({ x, y, n: 40, shape: "dot", colors, velocity: [20, 90], angle: [-Math.PI, 0], life: [500, 1100], scale: [0.25, 0.6], gravity: -80, scatter: Math.max(w, h) * 0.45, sway: 20 });
    return tween(this.stage.app.ticker, 900, k => {
      const r = 1 + 0.12 * easeOut(k);
      ring
        .clear()
        .roundRect(x - (w * r) / 2, y - (h * r) / 2, w * r, h * r, 10)
        .stroke({ color: colors[0]!, width: 6 * (1 - k) + 1, alpha: 1 - k });
    }).then(() => ring.destroy());
  }

  private fire(from: XY, a: XY): Promise<void> {
    const colors = TINT_COLORS.destructive;
    // Il nucleo bianco-oro dentro la vampa rossa.
    const ball = new Graphics().circle(0, 0, 44).fill({ color: 0xff3a2a, alpha: 0.35 }).circle(0, 0, 28).fill({ color: 0xff7a1a, alpha: 0.7 }).circle(0, 0, 14).fill({ color: 0xfff0c0 });
    ball.blendMode = "add";
    ball.filters = [new BlurFilter({ strength: 5, quality: 2 })];
    ball.position.set(from.x, from.y);
    this.layer.addChild(ball);
    // L'arco: la palla sale un poco e ricade sul bersaglio.
    const rise = Math.min(220, Math.hypot(a.x - from.x, a.y - from.y) * 0.35);
    let last = 0;
    return tween(
      this.stage.app.ticker,
      560,
      k => {
        const x = from.x + (a.x - from.x) * k;
        const y = from.y + (a.y - from.y) * k - Math.sin(k * Math.PI) * rise;
        ball.position.set(x, y);
        ball.scale.set(0.8 + 0.4 * k);
        if (k - last > 0.02) {
          last = k;
          // La coda in due passate: il fumo rosso scuro, disegnato normale, e il cuore acceso, additivo.
          this.particles.burst({ x, y, n: 5, shape: "flame", colors: [0x8a1010, 0xb02010, 0x601008], velocity: [10, 50], life: [380, 700], scale: [0.8, 1.3], growth: 0.5, gravity: -90, scatter: 14, light: false });
          this.particles.burst({ x, y, n: 6, shape: "flame", colors: [0xff3a1a, 0xff7a1a, 0xffb040], velocity: [10, 60], life: [220, 460], scale: [0.5, 0.9], growth: 0.3, gravity: -120, scatter: 8 });
        }
      },
      easeIn
    ).then(() => {
      ball.destroy();
      this.explode(a, colors, 1);
      this.camera.shake(0.35);
      this.camera.flash(0xff6a4a, 0.18, 220);
    });
  }

  private lightning(from: XY, a: XY): Promise<void> {
    const colors = TINT_COLORS.dynamic;
    const flash = new Graphics();
    const glow = new Graphics();
    glow.blendMode = "add";
    glow.filters = [new BlurFilter({ strength: 10, quality: 3 })];
    flash.blendMode = "add";
    this.layer.addChild(glow, flash);
    const draw = (): void => {
      const points = boltPoints(from, a, 7, 70);
      flash.clear().moveTo(points[0]!.x, points[0]!.y);
      glow.clear().moveTo(points[0]!.x, points[0]!.y);
      for (const p of points.slice(1)) {
        flash.lineTo(p.x, p.y);
        glow.lineTo(p.x, p.y);
      }
      flash.stroke({ color: 0xffffff, width: 3, cap: "round", join: "round" });
      glow.stroke({ color: 0x7fe3ff, width: 14, cap: "round", join: "round" });
      // Un ramo che si stacca a metà strada.
      const m = points[Math.floor(points.length / 2)]!;
      const branch = boltPoints(m, { x: m.x + (random() - 0.5) * 220, y: m.y + 60 + random() * 120 }, 4, 40);
      flash.moveTo(branch[0]!.x, branch[0]!.y);
      for (const p of branch.slice(1)) flash.lineTo(p.x, p.y);
      flash.stroke({ color: 0xcff6ff, width: 1.5 });
    };
    this.camera.flash(0xbfefff, 0.25, 180);
    this.camera.shake(0.3);
    this.explode(a, colors, 0.8);
    let last = -1;
    return tween(this.stage.app.ticker, 420, k => {
      // Tre guizzi: ogni volta un fulmine nuovo, poi si spegne.
      const phase = Math.floor(k * 3);
      if (phase !== last) {
        last = phase;
        draw();
      }
      const inside = (k * 3) % 1;
      flash.alpha = glow.alpha = inside < 0.6 ? 1 : 1 - (inside - 0.6) / 0.4;
    }).then(() => {
      flash.destroy();
      glow.destroy();
    });
  }

  private portal(where: XY, from: XY): Promise<void> {
    const colors = TINT_COLORS.dimensional;
    const root = new Container({ label: "portal" });
    root.position.set(where.x, where.y);
    const rings = [0, 1, 2].map(() => {
      const g = new Graphics();
      g.blendMode = "add";
      root.addChild(g);
      return g;
    });
    root.filters = [new BlurFilter({ strength: 2, quality: 2 })];
    this.layer.addChild(root);
    // Dalla fonte parte una scia viola verso il portale.
    this.particles.burst({ x: from.x, y: from.y, n: 30, shape: "dot", colors, velocity: [40, 140], life: [400, 900], scale: [0.3, 0.7], scatter: 30 });
    let last = 0;
    return tween(this.stage.app.ticker, 1100, k => {
      const aperture = k < 0.3 ? easeOut(k / 0.3) : k > 0.75 ? 1 - easeIn((k - 0.75) / 0.25) : 1;
      rings.forEach((g, i) => {
        const r = (70 + i * 22) * aperture;
        const spin = k * (6 + i * 2) * (i % 2 ? -1 : 1);
        g.clear();
        for (let s = 0; s < 3; s += 1) {
          const a0 = spin + (s * Math.PI * 2) / 3;
          g.arc(0, 0, Math.max(1, r), a0, a0 + Math.PI * 0.45).stroke({ color: colors[i % colors.length]!, width: 5 - i, alpha: 0.9 });
        }
      });
      root.scale.set(1, 0.55);
      // Le particelle vengono risucchiate verso il centro.
      if (k - last > 0.03 && k < 0.8) {
        last = k;
        for (let i = 0; i < 4; i += 1) {
          const ang = random() * Math.PI * 2;
          const r = 160 + random() * 60;
          this.particles.burst({ x: where.x + Math.cos(ang) * r, y: where.y + Math.sin(ang) * r * 0.55, n: 1, shape: "spark", colors, velocity: [260, 340], angle: [ang + Math.PI, ang + Math.PI], life: [450, 550], scale: [0.4, 0.7], align: true, friction: 0.2 });
        }
      }
    }).then(() => {
      root.destroy({ children: true });
      this.explode(where, colors, 0.6);
    });
  }

  /** Lo scoppio sul bersaglio: scintille, un anello che si allarga, braci. */
  explode(p: XY, colors: readonly number[], strength: number): void {
    this.particles.burst({ x: p.x, y: p.y, n: Math.round(40 * strength), shape: "spark", colors, velocity: [260, 700], life: [250, 600], scale: [0.4, 0.9], friction: 0.9, align: true });
    this.particles.burst({ x: p.x, y: p.y, n: Math.round(30 * strength), shape: "dot", colors, velocity: [40, 200], life: [500, 1100], scale: [0.3, 0.8], gravity: -60, friction: 0.7, sway: 20 });
    this.particles.burst({ x: p.x, y: p.y, n: 1, shape: "ring", colors: [colors[0]!], velocity: [0, 0], life: [420, 420], scale: [0.6, 0.6], growth: 60 });
  }
}

/** Un fulmine spezzato da a a b: punti con lo spostamento a metà che si dimezza (spostamento del punto medio). */
function boltPoints(a: XY, b: XY, levels: number, discard: number): XY[] {
  let points: XY[] = [a, b];
  let s = discard;
  for (let l = 0; l < levels; l += 1) {
    const unread: XY[] = [points[0]!];
    for (let i = 0; i < points.length - 1; i += 1) {
      const p = points[i]!;
      const q = points[i + 1]!;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const off = (random() - 0.5) * s;
      unread.push({ x: (p.x + q.x) / 2 + (-dy / len) * off, y: (p.y + q.y) / 2 + (dx / len) * off }, q);
    }
    points = unread;
    s *= 0.55;
  }
  return points;
}
