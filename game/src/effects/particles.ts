// Le particelle del tavolo (animazioni, 2026-09-12): getti (la polvere di
// rubino di una giocata, le scintille di un colpo, la cenere di chi muore) e
// fondali (le braci che salgono dal tavolo). Un ParticleContainer per forma
// — Pixi vuole una sola texture per contenitore —, in fusione additiva: la
// luce si somma. Chi chiede meno movimento ne vede un quarto.

import { Container, Particle, ParticleContainer, type Ticker } from "pixi.js";
import type { Stage } from "../stage";
import { reducedMotion } from "../table/animation";
import { random, between, pick, type Range } from "./random";
import { shape, type Shape } from "./shapes";

export interface Burst {
  x: number;
  y: number;
  n: number;
  shape?: Shape;
  colors: readonly number[];
  /** Unità di progetto al secondo. */
  velocity: Range;
  /** Radianti (0 = destra, −π/2 = su); senza, tutto il giro. */
  angle?: Range;
  /** Millisecondi. */
  life: Range;
  scale: Range;
  /** Unità al secondo quadrato (positivo = giù). */
  gravity?: number;
  /** Quota di velocità persa al secondo (0..1). */
  friction?: number;
  /** Fattore di scala al secondo (1 = ferma, <1 si spegne, >1 si gonfia). */
  growth?: number;
  /** Radianti al secondo. */
  spin?: Range;
  /** Raggio in cui nascono. */
  scatter?: number;
  /** La particella guarda dove va (le scintille). */
  align?: boolean;
  /** Ampiezza dell'ondeggiamento di lato (le braci). */
  sway?: number;
  /** Additiva (luce) o normale (cenere, polvere scura). */
  light?: boolean;
}

export interface Emitter {
  area: { x: number; y: number; w: number; h: number };
  /** Particelle al secondo. */
  perSecond: number;
  burst: Omit<Burst, "x" | "y" | "n">;
}

interface LiveParticle {
  p: Particle;
  c: ParticleContainer;
  vx: number;
  vy: number;
  life: number;
  eta: number;
  scale: number;
  gravity: number;
  friction: number;
  growth: number;
  spin: number;
  align: boolean;
  sway: number;
  phase: number;
}

export class Particles {
  private readonly containers = new Map<string, ParticleContainer>();
  private readonly alive: LiveParticle[] = [];
  private readonly emitters = new Map<number, Emitter & { accumulator: number }>();
  private nextId = 1;

  constructor(
    stage: Stage,
    private readonly layer: Container
  ) {
    stage.app.ticker.add(this.step, this);
  }

  /** Quante particelle sono in volo (per le prove). */
  count(): number {
    return this.alive.length;
  }

  burst(g: Burst): void {
    const n = reducedMotion() ? Math.ceil(g.n / 4) : g.n;
    const name = g.shape ?? "dot";
    const c = this.container(name, g.light ?? true);
    for (let i = 0; i < n; i += 1) {
      const a = g.angle ? between(g.angle) : random() * Math.PI * 2;
      const v = between(g.velocity);
      const r = (g.scatter ?? 0) * Math.sqrt(random());
      const ra = random() * Math.PI * 2;
      const scale = between(g.scale);
      const p = new Particle({
        texture: shape(name),
        x: g.x + Math.cos(ra) * r,
        y: g.y + Math.sin(ra) * r,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: scale,
        scaleY: scale,
        rotation: random() * Math.PI * 2,
        tint: pick(g.colors),
        alpha: 0,
      });
      c.addParticle(p);
      this.alive.push({
        p,
        c,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: between(g.life),
        eta: 0,
        scale,
        gravity: g.gravity ?? 0,
        friction: g.friction ?? 0,
        growth: g.growth ?? 1,
        spin: g.spin ? between(g.spin) : 0,
        align: g.align ?? false,
        sway: g.sway ?? 0,
        phase: random() * Math.PI * 2,
      });
    }
  }

  /** Un fondale che emette da solo, finché non lo si ferma. */
  emitter(emitter: Emitter): number {
    const id = this.nextId++;
    this.emitters.set(id, { ...emitter, accumulator: 0 });
    return id;
  }

  stop(id: number): void {
    this.emitters.delete(id);
  }

  private container(name: Shape, light: boolean): ParticleContainer {
    const key = `${name}|${light ? 1 : 0}`;
    let c = this.containers.get(key);
    if (!c) {
      c = new ParticleContainer({ texture: shape(name), dynamicProperties: { position: true, rotation: true, vertex: true, color: true } });
      c.label = `particles:${key}`;
      c.eventMode = "none";
      if (light) c.blendMode = "add";
      this.containers.set(key, c);
      this.layer.addChild(c);
    }
    return c;
  }

  private step(ticker: Ticker): void {
    const dt = Math.min(0.05, ticker.deltaMS / 1000);
    for (const f of this.emitters.values()) {
      f.accumulator += dt * f.perSecond * (reducedMotion() ? 0.25 : 1);
      while (f.accumulator >= 1) {
        f.accumulator -= 1;
        this.burst({ ...f.burst, n: 1, x: f.area.x + random() * f.area.w, y: f.area.y + random() * f.area.h });
      }
    }
    for (let i = this.alive.length - 1; i >= 0; i -= 1) {
      const v = this.alive[i]!;
      v.eta += ticker.deltaMS;
      const k = v.eta / v.life;
      if (k >= 1) {
        v.c.removeParticle(v.p);
        this.alive[i] = this.alive[this.alive.length - 1]!;
        this.alive.pop();
        continue;
      }
      v.vy += v.gravity * dt;
      const damping = Math.pow(1 - Math.min(0.999, v.friction), dt);
      v.vx *= damping;
      v.vy *= damping;
      const side = v.sway ? Math.sin(v.phase + v.eta * 0.004) * v.sway : 0;
      v.p.x += (v.vx + side) * dt;
      v.p.y += v.vy * dt;
      const s = v.scale * Math.pow(v.growth, v.eta / 1000);
      v.p.scaleX = v.align ? s * (1 + Math.min(2, Math.hypot(v.vx, v.vy) / 400)) : s;
      v.p.scaleY = s;
      v.p.rotation = v.align ? Math.atan2(v.vy, v.vx) : v.p.rotation + v.spin * dt;
      // Accesa in fretta, spenta piano.
      v.p.alpha = k < 0.08 ? k / 0.08 : 1 - Math.pow((k - 0.08) / 0.92, 1.6);
    }
  }
}
