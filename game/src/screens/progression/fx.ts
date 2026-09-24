// I pezzi condivisi della sferografia (2026-09-23): il valore che si
// ritarget-a senza promesse (Anim, il record della home reso classe), le
// texture dipinte una volta e condivise (la gemma nei suoi stati, l'alone,
// il vetro), la barra dell'esperienza che si riempie da sé.

import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { bezier, reducedMotion, type Curve } from "../../table/animation";
import { CrispSprite, linearGradient, paintPiece, withShadow } from "../../table/appearance";
import { GLASS_HEAVY, LINE } from "../ui";

/** La curva morbida della home (bezier .2 .8 .2 1). */
export const SOFT: Curve = bezier(0.2, 0.8, 0.2, 1);

/** Un valore animato che si può ritarget-are in ogni momento: riparte da dov'è. */
export class Anim {
  v: number;
  private from: number;
  private target: number;
  private t0 = 0;
  private ms = 1;
  private curve: Curve = SOFT;

  constructor(v: number) {
    this.v = v;
    this.from = v;
    this.target = v;
  }

  set(target: number, ms: number, curve: Curve = SOFT): void {
    if (target === this.target && this.moving()) return;
    this.from = this.v;
    this.target = target;
    this.t0 = performance.now();
    this.ms = reducedMotion() ? 1 : Math.max(1, ms);
    this.curve = curve;
  }

  snap(v: number): void {
    this.v = v;
    this.from = v;
    this.target = v;
  }

  moving(): boolean {
    return this.v !== this.target;
  }

  /** Avanza al tempo dato; vero se il valore è cambiato. */
  step(now: number): boolean {
    if (!this.moving()) return false;
    const p = Math.min(1, (now - this.t0) / this.ms);
    this.v = p >= 1 ? this.target : this.from + (this.target - this.from) * this.curve(p);
    return true;
  }
}

export type GemState = "locked" | "reached" | "current";

const gems = new Map<string, Texture>();
const halos = new Map<string, Texture>();

/** Il margine attorno alla gemma nella sua texture (l'ombra/alone ha spazio). */
export const GEM_MARGIN = 40;

/** La gemma del marchio, quadrato ruotato: rubino a gradiente se raggiunta, spenta se da raggiungere. Condivisa per stato. */
export function gemTexture(side: number, state: GemState, res: number): Texture {
  const key = `${side}|${state}|${res}`;
  const found = gems.get(key);
  if (found) return found;
  const size = side * 2 + 2 * GEM_MARGIN;
  const texture = paintPiece(size, size, res, ctx => {
    ctx.translate(size / 2, size / 2);
    ctx.rotate(Math.PI / 4);
    if (state === "locked") {
      ctx.fillStyle = "#1c171e";
      ctx.fillRect(-side / 2, -side / 2, side, side);
      ctx.strokeStyle = "#3a3037";
    } else {
      withShadow(ctx, res, { x: 0, y: 0, blur: state === "current" ? 16 : 10, color: "rgba(210,74,100,.7)" }, () => {
        ctx.fillStyle = linearGradient(ctx, 135, -side / 2, -side / 2, side, side, [
          [0, "#e0314b"],
          [1, "#9e0f34"],
        ]);
        ctx.fillRect(-side / 2, -side / 2, side, side);
      });
      // La sfaccettatura: un triangolo di luce in alto a sinistra.
      ctx.fillStyle = "rgba(255,255,255,.14)";
      ctx.beginPath();
      ctx.moveTo(-side / 2, -side / 2);
      ctx.lineTo(side / 2, -side / 2);
      ctx.lineTo(-side / 2, side / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#ffb7c6";
    }
    ctx.lineWidth = 1;
    ctx.strokeRect(-side / 2 + 0.5, -side / 2 + 0.5, side - 1, side - 1);
  });
  gems.set(key, texture);
  return texture;
}

/** L'alone della gemma, a due passate (la luce che respira, a parte dalla gemma). */
export function haloTexture(side: number, res: number, rgb = "224,49,75"): Texture {
  const key = `${side}|${rgb}|${res}`;
  const found = halos.get(key);
  if (found) return found;
  const size = side * 2 + 2 * GEM_MARGIN;
  const texture = paintPiece(size, size, res, ctx => {
    ctx.translate(size / 2, size / 2);
    ctx.rotate(Math.PI / 4);
    for (const [blur, alpha] of [
      [18, 1],
      [44, 0.6],
    ] as const) {
      ctx.shadowColor = `rgba(${rgb},${alpha})`;
      ctx.shadowBlur = blur * res;
      ctx.fillStyle = `rgb(${rgb})`;
      ctx.fillRect(-side / 2, -side / 2, side, side);
    }
  });
  halos.set(key, texture);
  return texture;
}

/** Uno sprite centrato su una texture della gemma o dell'alone. */
export function centered(texture: Texture): CrispSprite {
  const sprite = new CrispSprite(texture);
  sprite.anchor.set(0.5);
  return sprite;
}

/** Un bagliore radiale morbido (per il fondo dietro la carta). */
export function radialGlow(w: number, h: number, rgb: string, alpha: number, res: number): Sprite {
  const texture = paintPiece(w, h, res, ctx => {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(w / 2, h / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(0.55, `rgba(${rgb},${alpha * 0.35})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  });
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.eventMode = "none";
  return sprite;
}

/** Il vetro pesante col filo di rubino del sigillo (question.ts), come texture. */
export function glassPanel(w: number, h: number, res: number): Texture {
  const margin = 60;
  return paintPiece(w + 2 * margin, h + 2 * margin, res, ctx => {
    ctx.translate(margin, margin);
    withShadow(ctx, res, { x: 0, y: 24, blur: 60, color: "rgba(0,0,0,.55)" }, () => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
    });
    withShadow(ctx, res, { x: 0, y: 0, blur: 40, color: "rgba(210,74,100,.12)" }, () => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
    });
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = GLASS_HEAVY;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,.05)";
    ctx.fillRect(1, 1, w - 2, 1);
    ctx.strokeStyle = "#933d4f";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  });
}

export const GLASS_MARGIN = 60;

/** La barra dell'esperienza: il solco della piastra e il tratto di rubino che si riempie da sé. */
export class XpBar extends Container {
  private readonly fill = new Graphics();
  readonly k = new Anim(0);

  constructor(
    readonly w: number,
    readonly h = 8
  ) {
    super({ label: "xp-bar" });
    const trough = new Graphics().rect(0, 0, w, h).fill(0x151116).rect(0.5, 0.5, w - 1, h - 1).stroke({ color: Number.parseInt(LINE.slice(1), 16), width: 1 });
    // Il tratto pieno: rubino, con la punta più chiara (due rettangoli, niente gradiente: si scala in x).
    this.fill.rect(0, 0, w - 2, h - 2).fill(0xd1244f).rect(0, 0, w - 2, 1).fill({ color: 0xff8ea6, alpha: 0.7 });
    this.fill.position.set(1, 1);
    this.fill.scale.x = 0.001;
    this.addChild(trough, this.fill);
    this.eventMode = "none";
  }

  /** Il riempimento (0..1), subito o animato. */
  set(k: number, ms = 0): void {
    const clamped = Math.max(0, Math.min(1, k));
    if (ms <= 0) this.k.snap(clamped);
    else this.k.set(clamped, ms);
    this.apply();
  }

  step(now: number): void {
    if (this.k.step(now)) this.apply();
  }

  private apply(): void {
    this.fill.scale.x = Math.max(0.001, this.k.v);
    this.fill.visible = this.k.v > 0.002;
  }
}
