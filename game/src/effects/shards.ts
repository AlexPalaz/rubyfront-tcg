// La morte che si sbriciola (animazioni, 2026-09-12): la carta si rompe in
// tessere che volano via dal punto del colpo, girano, arrossano come brace e
// si fanno cenere; sotto, la cenere e le faville salgono.

import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import type { Stage } from "../stage";
import { tween } from "../table/animation";
import { random } from "./random";
import type { Particles } from "./particles";

export interface ShatterOptions {
  /** La texture della carta, dritta. */
  texture: Texture;
  /** Dove sta la carta (centro) e quanto è grande, in unità di progetto. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Il punto del colpo (da dove i pezzi scappano); senza, dal basso. */
  from?: { x: number; y: number };
  columns?: number;
  lines?: number;
}

/** Un colore fra tre, per k in 0..1 (bianco → brace → cenere). */
function ember(k: number): number {
  const colorStops = [
    [255, 255, 255],
    [255, 140, 70],
    [60, 30, 30],
  ] as const;
  const t = Math.min(1, Math.max(0, k)) * 2;
  const i = Math.min(1, Math.floor(t));
  const f = t - i;
  const a = colorStops[i]!;
  const b = colorStops[i + 1]!;
  const ch = (n: 0 | 1 | 2): number => Math.round(a[n] + (b[n] - a[n]) * f);
  return (ch(0) << 16) | (ch(1) << 8) | ch(2);
}

export function shatter(stage: Stage, layer: Container, particles: Particles, s: ShatterOptions): Promise<void> {
  const columns = s.columns ?? 6;
  const lines = s.lines ?? 8;
  const root = new Container({ label: "shards" });
  layer.addChild(root);
  const src = s.texture;
  const fw = src.frame.width / columns;
  const fh = src.frame.height / lines;
  const pw = s.w / columns;
  const ph = s.h / lines;
  const origin = s.from ?? { x: s.x, y: s.y + s.h / 2 };
  const pieces: { sprite: Sprite; vx: number; vy: number; spin: number; x0: number; y0: number; delay: number; texture: Texture }[] = [];
  for (let r = 0; r < lines; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const texture = new Texture({ source: src.source, frame: new Rectangle(src.frame.x + c * fw, src.frame.y + r * fh, fw, fh) });
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.width = pw + 0.5;
      sprite.height = ph + 0.5;
      const x0 = s.x - s.w / 2 + (c + 0.5) * pw;
      const y0 = s.y - s.h / 2 + (r + 0.5) * ph;
      sprite.position.set(x0, y0);
      root.addChild(sprite);
      const dx = x0 - origin.x;
      const dy = y0 - origin.y;
      const len = Math.hypot(dx, dy) || 1;
      const strength = 260 + random() * 380;
      pieces.push({
        sprite,
        vx: (dx / len) * strength + (random() - 0.5) * 120,
        vy: (dy / len) * strength - 180 - random() * 160,
        spin: (random() - 0.5) * 9,
        x0,
        y0,
        // Si stacca prima chi è più vicino al colpo.
        delay: Math.min(0.25, len / Math.hypot(s.w, s.h) * 0.3),
        texture,
      });
    }
  }
  // La cenere che sale e le faville, dal corpo della carta.
  particles.burst({ x: s.x, y: s.y, n: 60, shape: "ash", colors: [0x3a2a2a, 0x5a4040, 0x221818], velocity: [30, 120], angle: [-Math.PI * 0.85, -Math.PI * 0.15], life: [900, 1800], scale: [0.4, 1], gravity: -60, friction: 0.6, spin: [-4, 4], scatter: Math.min(s.w, s.h) * 0.5, sway: 30, light: false });
  particles.burst({ x: s.x, y: s.y, n: 50, shape: "dot", colors: [0xff8a3a, 0xffc070, 0xff4d3a], velocity: [60, 220], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [600, 1400], scale: [0.2, 0.55], gravity: -40, friction: 0.5, scatter: Math.min(s.w, s.h) * 0.5, sway: 40 });
  const g = 900;
  return tween(stage.app.ticker, 1300, k => {
    const t = k * 1.3;
    for (const p of pieces) {
      const tt = Math.max(0, t - p.delay);
      p.sprite.x = p.x0 + p.vx * tt;
      p.sprite.y = p.y0 + p.vy * tt + 0.5 * g * tt * tt;
      p.sprite.rotation = p.spin * tt;
      const life = Math.min(1, tt / 0.9);
      p.sprite.tint = ember(life);
      p.sprite.alpha = 1 - Math.pow(life, 2);
      p.sprite.scale.set((pw / p.texture.frame.width) * (1 - life * 0.5), (ph / p.texture.frame.height) * (1 - life * 0.5));
    }
  }).then(() => {
    for (const p of pieces) p.texture.destroy(false);
    root.destroy({ children: true });
  });
}
