// Le Materie che agiscono (animazioni, 2026-09-12): un effetto per tinta,
// dalla fonte al bersaglio. Il fascio (scelta del designer, 2026-09-12: niente
// fulmini, niente fuoco né portale): filamenti di luce sinuosi, come le
// venature delle cornici delle carte, che corrono dalla fonte al bersaglio
// e lì scoppiano. I colori sono quelli delle cornici (card/theme.ts):
// Distruttiva rosso, Dimensionale blu, Dinamica bianco argento.

import { BlurFilter, Graphics, type Container } from "pixi.js";
import type { Stage } from "../stage";
import { tween, easeIn, easeOut } from "../table/animation";
import type { Camera } from "./camera";
import { random } from "./random";
import type { Particles } from "./particles";

export type TintKind = "destructive" | "dynamic" | "dimensional";

/** Per tinta: l'alone del fascio, i filamenti, il filo più acceso al centro. */
export const TINT_COLORS: Record<TintKind, readonly number[]> = {
  destructive: [0xff2e4d, 0xff9fb3, 0xfff0f3],
  dynamic: [0xdfe6f2, 0xffffff, 0xffffff],
  dimensional: [0x3d6dff, 0x9fb8ff, 0xeef3ff],
};

interface XY {
  x: number;
  y: number;
}

/** Un filamento del fascio: quanto ondeggia, quante onde, dove parte l'onda, quanto corre, quanto è spesso. */
interface Strand {
  amp: number;
  waves: number;
  phase: number;
  speed: number;
  width: number;
}

const BEAM_MS = 900;
/** Il fascio arriva al bersaglio a questo punto della corsa; poi la coda lo raggiunge e si spegne. */
const BEAM_ARRIVAL = 0.42;
const BEAM_STEPS = 28;

export class Spells {
  constructor(
    private readonly stage: Stage,
    private readonly layer: Container,
    private readonly particles: Particles,
    private readonly camera: Camera
  ) {}

  /** L'effetto della tinta: il fascio dalla fonte al bersaglio (senza bersaglio, verso l'alto). */
  cast(tint: TintKind, from: XY, a: XY | null): Promise<void> {
    return this.beam(tint, from, a ?? { x: from.x, y: from.y - 260 });
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

  /**
   * Il fascio: cinque filamenti che ondeggiano attorno alla retta dalla
   * fonte al bersaglio — più larghi a metà strada, fermi agli estremi —, un
   * alone sfocato sotto e il filo acceso sopra. La testa corre fino al
   * bersaglio lasciando scintille; arrivata, lo scoppio, un lampo e un colpo
   * di camera; poi la coda la raggiunge e il fascio si spegne.
   */
  private beam(tint: TintKind, from: XY, to: XY): Promise<void> {
    const colors = TINT_COLORS[tint];
    const glow = new Graphics();
    glow.blendMode = "add";
    glow.filters = [new BlurFilter({ strength: 8, quality: 3 })];
    const core = new Graphics();
    core.blendMode = "add";
    this.layer.addChild(glow, core);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const reach = Math.min(46, length * 0.12);
    const strands: Strand[] = Array.from({ length: 5 }, (_, index) => ({
      amp: (index === 0 ? 0.25 : 0.45 + random() * 0.55) * reach * (index % 2 ? -1 : 1),
      waves: 1.2 + random() * 1.6,
      phase: random() * Math.PI * 2,
      speed: 5 + random() * 5,
      width: index === 0 ? 3 : 1.1 + random() * 1.2,
    }));
    const at = (strand: Strand, u: number, time: number): XY => {
      const off = strand.amp * Math.sin(Math.PI * u) * Math.sin(strand.waves * Math.PI * 2 * u + strand.phase + time * strand.speed);
      return { x: from.x + dx * u + nx * off, y: from.y + dy * u + ny * off };
    };
    let landed = false;
    let lastSpark = -1;
    return tween(this.stage.app.ticker, BEAM_MS, k => {
      const time = (k * BEAM_MS) / 1000;
      const head = k < BEAM_ARRIVAL ? easeOut(k / BEAM_ARRIVAL) : 1;
      const tail = k < 0.5 ? Math.max(0, head - 0.6) : Math.max(0.4, easeIn((k - 0.5) / 0.5));
      const alpha = k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1;
      glow.clear();
      core.clear();
      if (head > tail) {
        strands.forEach((strand, index) => {
          for (let step = 0; step <= BEAM_STEPS; step += 1) {
            const p = at(strand, tail + ((head - tail) * step) / BEAM_STEPS, time);
            if (step === 0) {
              glow.moveTo(p.x, p.y);
              core.moveTo(p.x, p.y);
            } else {
              glow.lineTo(p.x, p.y);
              core.lineTo(p.x, p.y);
            }
          }
          glow.stroke({ color: colors[0]!, width: strand.width * 6, alpha: 0.5 * alpha, cap: "round", join: "round" });
          core.stroke({ color: index === 0 ? colors[2]! : colors[1]!, width: strand.width, alpha, cap: "round", join: "round" });
        });
      }
      // Le scintille alla testa, finché corre.
      if (head < 1 && k - lastSpark > 0.03) {
        lastSpark = k;
        const p = at(strands[0]!, head, time);
        this.particles.burst({ x: p.x, y: p.y, n: 3, shape: "spark", colors, velocity: [60, 180], life: [200, 420], scale: [0.3, 0.6], friction: 0.6, align: true });
      }
      if (!landed && head >= 1) {
        landed = true;
        this.explode(to, colors, 0.9);
        this.camera.flash(colors[1]!, 0.16, 200);
        this.camera.shake(0.28);
      }
    }).then(() => {
      glow.destroy();
      core.destroy();
    });
  }

  /** Lo scoppio sul bersaglio: scintille, un anello che si allarga, braci. */
  explode(p: XY, colors: readonly number[], strength: number): void {
    this.particles.burst({ x: p.x, y: p.y, n: Math.round(40 * strength), shape: "spark", colors, velocity: [260, 700], life: [250, 600], scale: [0.4, 0.9], friction: 0.9, align: true });
    this.particles.burst({ x: p.x, y: p.y, n: Math.round(30 * strength), shape: "dot", colors, velocity: [40, 200], life: [500, 1100], scale: [0.3, 0.8], gravity: -60, friction: 0.7, sway: 20 });
    this.particles.burst({ x: p.x, y: p.y, n: 1, shape: "ring", colors: [colors[0]!], velocity: [0, 0], life: [420, 420], scale: [0.6, 0.6], growth: 60 });
  }
}
