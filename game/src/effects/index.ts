// Gli effetti del tavolo (animazioni, 2026-09-12): il regista del kit. Uno
// strato sopra il tavolo per ciò che vola (particelle, incantesimi, colpi,
// numeri, frammenti), uno sotto le carte per l'atmosfera (le braci che
// salgono), la camera (scossoni, lampi) e i momenti composti: la giocata con
// l'impatto, lo scatto dell'attacco, la morte che si sbriciola, la lama di
// luce del cambio di fase. Il tavolo e i suoi momenti li chiamano; qui non si
// sa niente di regole.

import { Container, Sprite, type Texture } from "pixi.js";
import type { Stage } from "../stage";
import { paintPiece } from "../table/appearance";
import { tween, easeInOut, reducedMotion } from "../table/animation";
import { Camera } from "./camera";
import { Hits } from "./hits";
import { shatter, type ShatterOptions } from "./shards";
import { popNumber, type Tone } from "./numbers";
import { Particles } from "./particles";
import { Spells, type TintKind } from "./tints";

export { Camera, Hits, Spells, Particles };
export { Card3D } from "./projection";
export { BurnFilter, FoilFilter } from "./filters";
export type { TintKind, Tone };

/** Le braci del tavolo: rubino e ambra, lente, che ondeggiano salendo. */
const EMBERS = [0xd24a64, 0xff8a3a, 0xffc070, 0xe56a86] as const;

export class Effects {
  /** Sopra il tavolo: ciò che vola. */
  readonly overlay = new Container({ label: "effects" });
  /** Sotto le carte: l'atmosfera (il tavolo lo posa sopra il suo fondo). */
  readonly below = new Container({ label: "atmosphere" });
  readonly camera: Camera;
  readonly particles: Particles;
  readonly atmosphere: Particles;
  readonly spells: Spells;
  readonly hits: Hits;
  private embers: number | null = null;

  constructor(private readonly stage: Stage) {
    this.overlay.eventMode = "none";
    this.below.eventMode = "none";
    stage.world.addChild(this.overlay);
    this.camera = new Camera(stage);
    this.particles = new Particles(stage, this.overlay);
    this.atmosphere = new Particles(stage, this.below);
    this.spells = new Spells(stage, this.overlay, this.particles, this.camera);
    this.hits = new Hits(stage, this.overlay, this.particles, this.camera);
  }

  /** Lo strato di sopra torna in cima al mondo (dopo che il tavolo ha aggiunto i suoi). */
  toTop(): void {
    this.overlay.parent?.addChild(this.overlay);
  }

  /** Le braci che salgono dal fondo dell'area data (il tavolo), finché non si spengono. */
  startEmbers(area: { x: number; y: number; w: number; h: number }): void {
    this.stopEmbers();
    this.embers = this.atmosphere.emitter({
      area: { x: area.x, y: area.y + area.h * 0.55, w: area.w, h: area.h * 0.45 },
      perSecond: 16,
      burst: { shape: "dot", colors: EMBERS, velocity: [18, 55], angle: [-Math.PI * 0.62, -Math.PI * 0.38], life: [3200, 6500], scale: [0.08, 0.3], gravity: -6, sway: 22, friction: 0.05 },
    });
  }

  stopEmbers(): void {
    if (this.embers !== null) this.atmosphere.stop(this.embers);
    this.embers = null;
  }

  popNumber(x: number, y: number, text: string, tone: Tone, big = false): Promise<void> {
    return popNumber(this.stage, this.overlay, x, y, text, tone, big);
  }

  shatter(s: ShatterOptions): Promise<void> {
    return shatter(this.stage, this.overlay, this.particles, s);
  }

  /**
   * Il cambio di fase, cinematico: una lama di luce del tono della fase
   * attraversa il tavolo in diagonale, un lampo tenue, un velo di faville.
   */
  lightBlade(color: number): Promise<void> {
    const v = this.stage.visible();
    const w = 520;
    const h = v.height * 1.6;
    const texture: Texture = paintPiece(w, 64, 1, ctx => {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.45, "rgba(255,255,255,.35)");
      g.addColorStop(0.5, "rgba(255,255,255,.9)");
      g.addColorStop(0.55, "rgba(255,255,255,.35)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, 64);
    });
    const blade = new Sprite(texture);
    blade.anchor.set(0.5);
    blade.height = h;
    blade.width = w;
    blade.rotation = 0.35;
    blade.tint = color;
    blade.blendMode = "add";
    blade.alpha = reducedMotion() ? 0.3 : 0.55;
    this.overlay.addChild(blade);
    this.camera.flash(color, 0.12, 500);
    const from = v.x - w;
    const a = v.x + v.width + w;
    return tween(this.stage.app.ticker, reducedMotion() ? 1 : 900, k => blade.position.set(from + (a - from) * k, v.y + v.height / 2), easeInOut).then(() => {
      blade.destroy();
      texture.destroy(true);
    });
  }
}
