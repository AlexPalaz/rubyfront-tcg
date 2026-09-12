// I colpi del tavolo (animazioni, 2026-09-12): l'impatto di una carta che
// scende sul Fronte (l'onda d'urto sul tavolo, la polvere di rubino, lo
// scossone), lo scatto dell'attaccante verso il bersaglio con le sue scie e il
// ritorno, l'urto sul bersaglio.

import { Container, Graphics, type Ticker } from "pixi.js";
import type { Stage } from "../stage";
import { bezier, tween, easeOut, reducedMotion } from "../table/animation";
import type { Camera } from "./camera";
import { shockwave } from "./filters";
import type { Particles } from "./particles";

const RUBY = [0xd24a64, 0xe56a86, 0xffd0da] as const;

export class Hits {
  constructor(
    private readonly stage: Stage,
    private readonly layer: Container,
    private readonly particles: Particles,
    private readonly camera: Camera
  ) {}

  /**
   * La carta tocca il Fronte: l'onda d'urto sul mondo (dal punto, in
   * coordinate di progetto), la polvere che schizza ai lati, il filo di luce
   * attorno allo slot, lo scossone.
   */
  impact(x: number, y: number, w: number, h: number, strength = 1): Promise<void> {
    this.camera.shake(0.28 * strength);
    // Un anello di polvere radente al tavolo: nasce sul perimetro della carta e corre verso fuori, schiacciato come su un piano.
    const n = Math.round(56 * strength);
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * w * 0.5;
      const py = y + Math.sin(a) * h * 0.5;
      this.particles.burst({ x: px, y: py, n: 1, shape: "dot", colors: RUBY, velocity: [160, 380], angle: [a - 0.25, a + 0.25], life: [380, 760], scale: [0.35, 0.8], friction: 0.94, growth: 0.6 });
    }
    this.particles.burst({ x, y, n: Math.round(24 * strength), shape: "spark", colors: [0xffffff, ...RUBY], velocity: [380, 820], life: [220, 480], scale: [0.45, 0.85], friction: 0.95, align: true, scatter: Math.min(w, h) * 0.3 });
    // L'anello di luce che si allarga dal punto di contatto.
    this.particles.burst({ x, y, n: 1, shape: "ring", colors: [0xffd0da], velocity: [0, 0], life: [460, 460], scale: [Math.max(w, h) / 64, Math.max(w, h) / 64], growth: 6 });
    const edge = new Graphics();
    const flash = new Graphics();
    edge.blendMode = "add";
    flash.blendMode = "add";
    this.layer.addChild(flash, edge);
    const wave = this.wave(x, y, 28 * strength);
    return tween(this.stage.app.ticker, 560, k => {
      const r = 1 + 0.22 * easeOut(k);
      edge.clear().roundRect(x - (w * r) / 2, y - (h * r) / 2, w * r, h * r, 8).stroke({ color: 0xffd0da, width: 6 * (1 - k) + 0.5, alpha: 1 - k });
      // La carta s'illumina un attimo al contatto.
      flash.clear().roundRect(x - w / 2, y - h / 2, w, h, 6).fill({ color: 0xffffff, alpha: 0.55 * Math.max(0, 1 - k * 3) });
    }).then(async () => {
      edge.destroy();
      flash.destroy();
      await wave;
    });
  }

  /** L'onda d'urto sul mondo, dal punto dato (coordinate di progetto). */
  wave(x: number, y: number, amplitude = 22): Promise<void> {
    if (reducedMotion()) return Promise.resolve();
    const world = this.stage.world;
    const globalPoint = world.toGlobal({ x, y });
    const filter = shockwave(globalPoint.x * this.stage.app.renderer.resolution, globalPoint.y * this.stage.app.renderer.resolution, amplitude);
    world.filters = [...(world.filters ?? []), filter];
    return tween(this.stage.app.ticker, 700, k => {
      filter.time = k * 0.7;
      filter.amplitude = amplitude * (1 - k);
    }).then(() => {
      world.filters = (world.filters ?? []).filter(f => f !== filter);
      filter.destroy();
    });
  }

  /**
   * Lo scatto: `oggetto` (una carta in campo, coordinate di progetto) carica
   * un attimo all'indietro, schizza verso `verso` fino al 70% della strada
   * lasciando scie, urta, e torna al suo posto. `fantasma` fa la copia
   * d'una scia. Torna quando l'urto avviene (il resto scorre da sé).
   */
  dash(item: Container, direction: { x: number; y: number }, ghost: () => Container, impact?: () => void): Promise<void> {
    const x0 = item.x;
    const y0 = item.y;
    const dx = direction.x - x0;
    const dy = direction.y - y0;
    const ticker: Ticker = this.stage.app.ticker;
    const windup = bezier(0.3, 0, 0.7, 1);
    return new Promise(resolve => {
      void tween(ticker, 160, k => item.position.set(x0 - dx * 0.06 * windup(k), y0 - dy * 0.06 * windup(k))).then(() => {
        let last = 0;
        void tween(
          ticker,
          190,
          k => {
            item.position.set(x0 + dx * (-0.06 + 0.76 * k), y0 + dy * (-0.06 + 0.76 * k));
            if (k - last > 0.2) {
              last = k;
              this.trail(item, ghost);
            }
          },
          bezier(0.6, 0, 1, 0.6)
        ).then(() => {
          const px = x0 + dx * 0.7;
          const py = y0 + dy * 0.7;
          this.camera.shake(0.3);
          this.particles.burst({ x: direction.x, y: direction.y, n: 40, shape: "spark", colors: [0xffffff, 0xffd27a, 0xe56a86], velocity: [300, 800], angle: [Math.atan2(dy, dx) - 1.1, Math.atan2(dy, dx) + 1.1], life: [200, 500], scale: [0.4, 0.9], friction: 0.95, align: true });
          void this.wave(direction.x, direction.y, 16);
          impact?.();
          resolve();
          void tween(ticker, 420, k => item.position.set(px + (x0 - px) * k, py + (y0 - py) * k), easeOut);
        });
      });
    });
  }

  /** Una scia: la copia che resta indietro e si spegne. */
  private trail(item: Container, ghost: () => Container): void {
    const copy = ghost();
    copy.position.copyFrom(item.position);
    copy.rotation = item.rotation;
    copy.alpha = 0.45;
    copy.tint = 0xe56a86;
    copy.eventMode = "none";
    item.parent?.addChildAt(copy, Math.max(0, item.parent.getChildIndex(item)));
    void tween(this.stage.app.ticker, 260, k => (copy.alpha = 0.45 * (1 - k))).then(() => copy.destroy({ children: true }));
  }
}
