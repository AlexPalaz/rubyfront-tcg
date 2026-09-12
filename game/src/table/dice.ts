// Il dado al centro del tavolo (simulatore/src/dice.ts): un tiro non è un
// numero in chat, è un momento. Su un velo chiaro il dado lampeggia le sue
// facce, poi si ferma sul risultato e resta acceso due secondi; sotto, il
// numero e il rigo «d20 · Furia». Il dado cade dall'alto e rimbalza
// (die-tumble) mentre le facce lampeggiano; fermo, pulsa di luce e il
// numero sale sotto di lui. Con prefers-reduced-motion il risultato compare
// e resta. Il velo non ferma i click (pointer-events: none).

import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { drawLines, fontMetrics, layout, totalHeight, textWidth, type Font, type TextShadow } from "../card/text";
import type { Stage } from "../stage";
import { bezier, key, tween, easeIn, easeOut, reducedMotion } from "./animation";
import { SANS, paintPiece, linearGradient, withShadow } from "./appearance";
import { setBlurred, below } from "./night";
import { FIXED } from "./layout";

const ROLL_MS = 1100;
const FLICKER_MS = 70;
const HOLD_MS = 2000;
const FADE_MS = 300;

/** Il lato del dado, e il margine attorno per l'ombra e il bagliore. */
const S = 96;
const M = 60;
/** Il numero sotto il dado: 2.2rem, e il suo spazio (min-height: 1.2em). */
const OUT: Font = { size: 35.2, weight: 700, family: SANS, spacing: 3.52 };
const OUT_H = 35.2 * 1.2;
const OUT_GLOW: TextShadow = { x: 0, y: 0, blur: 22, color: "rgba(210,74,100,.7)" };
const TAG: Font = { size: 13.6, weight: 400, family: SANS, spacing: 13.6 * 0.16, upper: true };
const FACE: Font = { size: 44, weight: 700, family: SANS };
const GAP = 14;

/** Le facce del d6 a pallini (celle di una griglia 3×3): gli altri tagli mostrano il numero. */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function paintCube(faces: number, value: number, settled: boolean, res: number): Texture {
  return paintPiece(S + 2 * M, S + 2 * M, res, ctx => {
    const rect = (): void => {
      ctx.fillStyle = "#000";
      ctx.fillRect(M, M, S, S);
    };
    // Fermo, il bagliore rubino (die-glow, a regime); sempre l'ombra che cade.
    if (settled) withShadow(ctx, res, { x: 0, y: 0, blur: 26, color: "rgba(210,74,100,.6)" }, rect);
    withShadow(ctx, res, { x: 0, y: 18, blur: 40, color: "rgba(0,0,0,.6)" }, rect);
    ctx.fillStyle = linearGradient(ctx, 145, M, M, S, S, [[0, "#fbf5ec"], [1, "#d9cfc3"]]);
    ctx.fillRect(M, M, S, S);
    // inset 0 -6px 0 rgba(0,0,0,.12): la fascia in fondo, dentro il bordo.
    ctx.fillStyle = "rgba(0,0,0,.12)";
    ctx.fillRect(M + 2, M + S - 2 - 6, S - 4, 6);
    ctx.strokeStyle = settled ? "#ff8ea6" : "#e56a86";
    ctx.lineWidth = 2;
    ctx.strokeRect(M + 1, M + 1, S - 2, S - 2);
    ctx.fillStyle = "#1b1015";
    if (faces === 6) {
      const grid = 72;
      const cell = grid / 3;
      const gx = M + (S - grid) / 2;
      const gy = M + (S - grid) / 2;
      for (const index of PIPS[value] ?? []) {
        ctx.fillRect(gx + (index % 3) * cell + (cell - 14) / 2, gy + Math.floor(index / 3) * cell + (cell - 14) / 2, 14, 14);
      }
      return;
    }
    const text = String(value);
    const { ascent, descent } = fontMetrics(FACE);
    ctx.font = `700 44px ${SANS}`;
    ctx.fillText(text, M + (S - textWidth(FACE, text)) / 2, M + (S + ascent - descent) / 2);
  });
}

/** Una scritta su una riga, centrata su `cx`, con margine per le ombre. */
function paintText(text: string, font: Font, color: string, lineHeight: number, res: number, shadows?: TextShadow[]): { sprite: Sprite; h: number } {
  const margin = 30;
  const lines = layout([{ kind: "text", text, font, color, ...(shadows ? { shadows } : {}) }], 10_000, { font, lineHeight });
  const w = lines.reduce((max, line) => Math.max(max, line.width), 0);
  const h = totalHeight(lines);
  const sprite = new Sprite(paintPiece(w + 2 * margin, h + 2 * margin, res, ctx => drawLines(ctx, lines, margin, margin)));
  sprite.pivot.set(margin + w / 2, margin);
  return { sprite, h };
}

export class Dice {
  private readonly layer = new Container({ label: "dice" });
  private rolls = 0;

  constructor(private readonly stage: Stage) {
    stage.world.addChild(this.layer);
  }

  /** Nessun dado in vista (per il passo del bot). */
  reducedMotion(): boolean {
    return this.rolls === 0;
  }

  /** Il tiro di un d`faces` che dà `result`: si risolve quando il velo è sparito. */
  roll(faces: number, result: number, label: string): Promise<void> {
    this.rolls += 1;
    return this.rollNow(faces, result, label).finally(() => {
      this.rolls -= 1;
    });
  }

  private rollNow(faces: number, result: number, label: string): Promise<void> {
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;
    const area = { x: v.x, y: v.y + FIXED.bar, w: v.width, h: v.height - FIXED.bar };
    const still = reducedMotion();

    const root = new Container({ label: "roll" });
    root.eventMode = "none";
    // Tema notte (style.css, :root e body[data-ui-theme="notte"]): --moment-veil, --muted, --ruby.
    const veil = new Graphics().rect(v.x, v.y, v.width, v.height).fill({ color: 0x05040a, alpha: 0.66 });
    const tag = paintText(`d${faces} · ${label}`, TAG, "#9a8e93", 13.6 * 1.25, res);
    const out = paintText(String(result), OUT, "#ff4d6d", OUT_H, res, [OUT_GLOW]);
    const totalH = S + GAP + OUT_H + GAP + tag.h;
    const top = area.y + (area.h - totalH) / 2;
    const cx = area.x + area.w / 2;
    const cube = new Sprite();
    // Il perno al centro del dado: la rotolata ruota e scala attorno a lui.
    cube.pivot.set(M + S / 2, M + S / 2);
    cube.position.set(cx, top + S / 2);
    out.sprite.position.set(cx, top + S + GAP);
    out.sprite.visible = false;
    tag.sprite.position.set(cx, top + S + GAP + OUT_H + GAP);
    root.addChild(veil, cube, out.sprite, tag.sprite);
    this.layer.addChild(root);
    this.layer.parent?.addChild(this.layer);
    // backdrop-filter: blur(3px): sotto il velo il tavolo si sfoca.
    const blurFilter = setBlurred(this.stage, below(this.stage.world, this.layer), 3);

    const ticker = this.stage.app.ticker;
    // Il velo entra in dissolvenza (dice-veil).
    void tween(ticker, 250, k => (veil.alpha = k), easeOut);
    const face = (value: number, settled: boolean): void => {
      const old = cube.texture;
      cube.texture = paintCube(faces, value, settled, res);
      if (old !== Texture.EMPTY && old !== Texture.WHITE) old.destroy(true);
    };
    const random = (): number => 1 + Math.floor(Math.random() * faces);

    return new Promise(resolve => {
      const settle = (): void => {
        face(result, true);
        out.sprite.visible = true;
        cube.rotation = 0;
        cube.position.set(cx, top + S / 2);
        // Fermo, si accende (die-glow) e il numero sale (dice-out).
        void tween(ticker, 400, k => cube.scale.set(key(k, [[0, 1], [0.2, 1.08], [1, 1]])), easeOut);
        const outY = out.sprite.y;
        void tween(ticker, 350, k => {
          out.sprite.alpha = k;
          out.sprite.y = outY + 6 * (1 - k);
        }, easeOut);
        setTimeout(() => {
          void tween(ticker, FADE_MS, k => (root.alpha = 1 - k), easeIn).then(() => {
            blurFilter();
            cube.texture.destroy(true);
            out.sprite.texture.destroy(true);
            tag.sprite.texture.destroy(true);
            root.destroy({ children: true });
            resolve();
          });
        }, HOLD_MS);
      };
      if (still) {
        settle();
        return;
      }
      face(random(), false);
      const flicker = setInterval(() => face(random(), false), FLICKER_MS);
      // La rotolata (die-tumble): cade dall'alto, rimbalza due volte, si posa.
      // Un giro intero: il numero non si ferma capovolto.
      void tween(ticker, ROLL_MS, k => {
        cube.y = top + S / 2 + key(k, [[0, -220], [0.35, 20], [0.55, -40], [0.75, 6], [1, 0]]);
        cube.rotation = (key(k, [[0, -40], [0.35, 70], [0.55, 150], [0.75, 300], [1, 360]]) * Math.PI) / 180;
        cube.scale.set(key(k, [[0, 0.7], [0.35, 1.05], [0.55, 1], [0.75, 1.02], [1, 1]]));
      }, bezier(0.3, 0.7, 0.3, 1));
      setTimeout(() => {
        clearInterval(flicker);
        settle();
      }, ROLL_MS);
    });
  }
}
