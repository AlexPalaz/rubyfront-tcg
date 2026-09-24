// Il chip «Ascesa» dell'header (2026-09-24): la porta della sferografia. A
// sinistra l'icona viva — tre gemme che salgono unite dal sentiero, con una
// scintilla che lo percorre e l'alone che respira sulla cima (al passaggio
// va più svelta) — poi la scritta; a destra, se un mazzo è scelto, la targa
// del livello del suo Rubyfront («Lv 2»). Sulla piastra del Notte, col filo
// che si accende.

import { t } from "@rubyfront/core/i18n";
import { Sprite } from "pixi.js";
import { drawText, fontMetrics, textWidth, type Font } from "../../card/text";
import { shape } from "../../effects/shapes";
import type { Stage } from "../../stage";
import { SANS } from "../../table/appearance";
import { BUTTON_FONT } from "../ui";
import { CHIP_H, HeaderChip, nightPlate, paintGem } from "./chip";

const LEVEL_FONT: Font = { size: 11, weight: 700, family: SANS, spacing: 11 * 0.12, upper: true };
const PAD = 12;
/** L'icona: tre gemme che salgono da sinistra a destra, unite dal sentiero. */
const ICON_W = 30;
const STEPS: { x: number; y: number; side: number }[] = [
  { x: 4, y: CHIP_H / 2 + 8, side: 5 },
  { x: 15, y: CHIP_H / 2 + 1, side: 6.5 },
  { x: 26, y: CHIP_H / 2 - 7, side: 8 },
];
const CLIMB_MS = 1900;

export class ProgressionChip extends HeaderChip {
  private level: number | null = null;
  private climber: Sprite | null = null;
  private topHalo: Sprite | null = null;
  private climb = 0;
  private lastNow = performance.now();

  constructor(stage: Stage, onTap: () => void) {
    super(stage, `button:${t("html.progression")}`, onTap);
    this.ready();
  }

  /** Il livello del Rubyfront del mazzo scelto, o niente. */
  setLevel(level: number | null): void {
    if (level === this.level) return;
    this.level = level;
    this.relayout();
  }

  private levelText(): string {
    return this.level === null ? "" : t("progression.level.short", { n: this.level });
  }

  protected measure(): number {
    const label = t("html.progression");
    const badge = this.level === null ? 0 : 10 + Math.ceil(textWidth(LEVEL_FONT, this.levelText())) + 12;
    return PAD + ICON_W + 10 + Math.ceil(textWidth(BUTTON_FONT, label)) + PAD + badge;
  }

  protected paintPlate(ctx: CanvasRenderingContext2D, w: number, res: number): void {
    nightPlate(ctx, 0, w, CHIP_H, "#3a3037");
    // Il sentiero che sale, poi le gemme: le due sotto già passate (più piccole), la cima accesa.
    ctx.strokeStyle = "rgba(255,120,150,.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD + STEPS[0]!.x, STEPS[0]!.y);
    for (const step of STEPS.slice(1)) ctx.lineTo(PAD + step.x, step.y);
    ctx.stroke();
    STEPS.forEach((step, index) => paintGem(ctx, PAD + step.x, step.y, step.side, res, index === STEPS.length - 1 ? 0.8 : 0.35));
    const label = t("html.progression");
    const m = fontMetrics(BUTTON_FONT);
    const tx = PAD + ICON_W + 10;
    drawText(ctx, { kind: "text", text: label, font: BUTTON_FONT, color: "#f1eae6" }, tx, (CHIP_H + m.ascent - m.descent) / 2);
    if (this.level !== null) {
      const text = this.levelText();
      const bw = Math.ceil(textWidth(LEVEL_FONT, text)) + 12;
      const bx = tx + Math.ceil(textWidth(BUTTON_FONT, label)) + 10;
      const bh = 18;
      const by = (CHIP_H - bh) / 2;
      ctx.fillStyle = "rgba(255,77,109,.14)";
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = "#e56a86";
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      const lm = fontMetrics(LEVEL_FONT);
      drawText(ctx, { kind: "text", text, font: LEVEL_FONT, color: "#fdeef1" }, bx + 6, by + (bh + lm.ascent - lm.descent) / 2);
    }
  }

  protected buildLayer(): void {
    // La scintilla che sale lungo il sentiero, e l'alone che respira sulla cima.
    const climber = new Sprite(shape("dot"));
    climber.anchor.set(0.5);
    climber.blendMode = "add";
    climber.tint = 0xffd6de;
    climber.scale.set(0.2);
    const halo = new Sprite(shape("dot"));
    halo.anchor.set(0.5);
    halo.blendMode = "add";
    halo.tint = 0xff4d6d;
    halo.scale.set(0.5);
    const top = STEPS[STEPS.length - 1]!;
    halo.position.set(PAD + top.x, top.y);
    this.layer.addChild(halo, climber);
    this.climber = climber;
    this.topHalo = halo;
  }

  protected stepLayer(now: number, hover: number): void {
    const dt = Math.min(64, now - this.lastNow);
    this.lastNow = now;
    const climber = this.climber;
    const halo = this.topHalo;
    if (!climber || !halo || climber.destroyed) return;
    this.climb = (this.climb + dt / (CLIMB_MS * (1 - 0.55 * hover))) % 1.25;
    // Il tratto 0..1 è la salita; oltre, la scintilla riposa sulla cima e svanisce.
    const k = Math.min(1, this.climb);
    const span = STEPS.length - 1;
    const at = k * span;
    const i = Math.min(span - 1, Math.floor(at));
    const f = at - i;
    const a = STEPS[i]!;
    const b = STEPS[i + 1]!;
    climber.position.set(PAD + a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f - Math.sin(f * Math.PI) * 3);
    climber.alpha = this.climb <= 1 ? 0.9 : Math.max(0, 1 - (this.climb - 1) * 4);
    climber.scale.set(0.16 + 0.08 * hover);
    const breath = 0.5 - 0.5 * Math.cos((now / 1800) * Math.PI * 2);
    halo.alpha = 0.25 + 0.35 * breath + 0.4 * hover;
    halo.scale.set(0.45 + 0.15 * breath + 0.2 * hover);
  }
}
