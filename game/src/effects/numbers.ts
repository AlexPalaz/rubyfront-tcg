// I numeri che saltano (animazioni, 2026-09-12): il danno sul Rubyfront, i
// PV guadagnati, la Potenza in più — grossi, col contorno scuro e la luce del
// loro colore; nascono piccoli, scoppiano oltre la misura, salgono su un
// arco e si spengono.

import { Container, Sprite, type Ticker } from "pixi.js";
import { drawText, fontMetrics, textWidth, type Font } from "../card/text";
import type { Stage } from "../stage";
import { SANS, paintPiece } from "../table/appearance";
import { tween } from "../table/animation";
import { random } from "./random";

export type Tone = "damage" | "heal" | "strength";

const COLORS: Record<Tone, { fill: string; glow: string }> = {
  damage: { fill: "#ff5a6e", glow: "rgba(255,40,70,.9)" },
  heal: { fill: "#7fe0ae", glow: "rgba(80,220,150,.85)" },
  strength: { fill: "#ffd27a", glow: "rgba(255,190,80,.85)" },
};

/** Un numero che salta da (x, y), in unità di progetto, nello strato dato. */
export function popNumber(stage: Stage, layer: Container, x: number, y: number, text: string, tone: Tone, big = false): Promise<void> {
  const size = big ? 64 : 44;
  const font: Font = { size, weight: 700, family: SANS };
  const res = stage.visible().scale * stage.app.renderer.resolution;
  const w = Math.ceil(textWidth(font, text)) + 40;
  const h = Math.ceil(size * 1.3) + 40;
  const { fill, glow } = COLORS[tone];
  const texture = paintPiece(w, h, res, ctx => {
    const { ascent, descent } = fontMetrics(font);
    const baseline = (h + ascent - descent) / 2;
    ctx.lineJoin = "round";
    ctx.font = `700 ${size}px ${SANS}`;
    ctx.lineWidth = size * 0.16;
    ctx.strokeStyle = "rgba(10,6,10,.95)";
    ctx.strokeText(text, 20, baseline);
    drawText(ctx, { kind: "text", text: text, font, color: fill, shadows: [{ x: 0, y: 0, blur: 18, color: glow }] }, 20, baseline);
  });
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.position.set(x, y);
  sprite.eventMode = "none";
  sprite.scale.set(0.3);
  const root = new Container({ label: "number" });
  root.addChild(sprite);
  layer.addChild(root);
  const drift = (random() - 0.5) * 60;
  const ticker: Ticker = stage.app.ticker;
  return tween(ticker, 1250, k => {
    // Scoppio (0–18%), assestamento (18–30%), salita e spegnimento.
    const s = k < 0.18 ? 0.3 + (1.3 - 0.3) * (k / 0.18) : k < 0.3 ? 1.3 - 0.3 * ((k - 0.18) / 0.12) : 1;
    sprite.scale.set(s);
    sprite.x = x + drift * k;
    sprite.y = y - 90 * Math.sin(k * Math.PI * 0.5) - (k > 0.6 ? (k - 0.6) * 40 : 0);
    sprite.alpha = k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35;
  }).then(() => {
    root.destroy({ children: true });
    texture.destroy(true);
  });
}
