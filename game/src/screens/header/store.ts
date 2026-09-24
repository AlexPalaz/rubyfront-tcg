// Il chip delle gemme e del negozio (2026-09-24): a sinistra il saldo di
// gemme rubino sulla piastra — la gemma, che ogni tanto manda una scintilla
// da una faccetta, e il numero, che quando cambia si arrotola alla nuova
// cifra — a destra «Negozio» sul rubino sfaccettato della forgia. Si tocca
// ovunque e porta al negozio.

import { t } from "@rubyfront/core/i18n";
import { Sprite } from "pixi.js";
import { drawText, fontMetrics, textWidth, type Font } from "../../card/text";
import { shape } from "../../effects/shapes";
import type { Stage } from "../../stage";
import { SANS } from "../../table/appearance";
import { reducedMotion } from "../../table/animation";
import { Anim } from "../progression/fx";
import { BUTTON_FONT, paintText } from "../ui";
import { CHIP_H, HeaderChip, nightPlate, paintGem, rubyPlate } from "./chip";

const COUNT: Font = { size: 15, weight: 700, family: SANS };
const PAD = 12;
const GEM = 9;
const GAP = 8;
const SPARK_EVERY_MS = 3600;

export class StoreChip extends HeaderChip {
  private gems = 0;
  /** Il numero mostrato, che si arrotola verso `gems`. */
  private readonly shown = new Anim(0);
  private shownInt = 0;
  private counter: Sprite | null = null;
  private leftW = 0;
  private spark: Sprite | null = null;
  private sparkAt = performance.now() + Math.random() * SPARK_EVERY_MS;

  constructor(stage: Stage, onTap: () => void) {
    super(stage, "store:0", onTap);
    this.ready();
  }

  /** Il saldo di gemme rubino da mostrare: il numero si arrotola fino a lì. */
  setGems(n: number): void {
    if (n === this.gems) return;
    this.gems = n;
    this.label = `store:${n}`;
    this.shown.set(n, 700);
    // La larghezza segue le cifre della meta, così non balla durante la corsa.
    this.relayout();
  }

  private countWidth(): number {
    return Math.max(Math.ceil(textWidth(COUNT, String(this.gems))), Math.ceil(textWidth(COUNT, String(this.shownInt))));
  }

  protected measure(): number {
    const gemW = Math.ceil(GEM * Math.SQRT2);
    this.leftW = PAD + gemW + GAP + this.countWidth() + PAD;
    return this.leftW + PAD + 4 + Math.ceil(textWidth(BUTTON_FONT, t("html.store"))) + PAD + 4;
  }

  protected paintPlate(ctx: CanvasRenderingContext2D, w: number, res: number): void {
    const leftW = this.leftW;
    nightPlate(ctx, 0, leftW + 1, CHIP_H, "#3a3037");
    rubyPlate(ctx, leftW, w - leftW, CHIP_H, res);
    const gemW = GEM * Math.SQRT2;
    paintGem(ctx, PAD + gemW / 2, CHIP_H / 2, GEM, res);
    const m = fontMetrics(BUTTON_FONT);
    drawText(ctx, { kind: "text", text: t("html.store"), font: BUTTON_FONT, color: "#fdeef1", shadows: [{ x: 0, y: 1, blur: 0, color: "rgba(0,0,0,.4)" }] }, leftW + PAD + 4, (CHIP_H + m.ascent - m.descent) / 2);
  }

  protected buildLayer(): void {
    this.counter = null;
    this.paintCounter();
    const spark = new Sprite(shape("spark"));
    spark.anchor.set(0.5);
    spark.blendMode = "add";
    spark.tint = 0xfff0f3;
    spark.alpha = 0;
    spark.rotation = -0.6;
    spark.position.set(PAD + (GEM * Math.SQRT2) / 2 - 2, CHIP_H / 2 - 3);
    this.layer.addChild(spark);
    this.spark = spark;
  }

  /** Il numero, ridipinto quando cambia la cifra mostrata. */
  private paintCounter(): void {
    const value = Math.round(this.shown.v);
    if (this.counter && value === this.shownInt && !this.counter.destroyed) return;
    this.shownInt = value;
    if (this.counter && !this.counter.destroyed) this.counter.destroy();
    const written = paintText(this.stage, String(value), COUNT, "#f1eae6");
    const m = fontMetrics(COUNT);
    written.sprite.position.set(PAD + Math.ceil(GEM * Math.SQRT2) + GAP, (CHIP_H + m.ascent - m.descent) / 2 - m.ascent);
    this.layer.addChild(written.sprite);
    this.counter = written.sprite;
  }

  protected stepLayer(now: number, hover: number): void {
    if (this.shown.step(now)) this.paintCounter();
    const spark = this.spark;
    if (!spark || spark.destroyed) return;
    // La scintilla della gemma: un lampo breve a un angolo, ogni tanto; più spesso al passaggio.
    if (reducedMotion()) {
      spark.alpha = 0;
      return;
    }
    const every = SPARK_EVERY_MS * (1 - 0.6 * hover);
    if (now >= this.sparkAt) {
      const k = (now - this.sparkAt) / 420;
      if (k >= 1) {
        spark.alpha = 0;
        this.sparkAt = now + every + Math.random() * 1200;
        spark.position.set(PAD + (GEM * Math.SQRT2) / 2 + (Math.random() - 0.5) * 8, CHIP_H / 2 + (Math.random() - 0.5) * 8);
      } else {
        spark.alpha = Math.sin(k * Math.PI);
        spark.scale.set(0.1 + 0.14 * Math.sin(k * Math.PI));
      }
    }
  }
}
