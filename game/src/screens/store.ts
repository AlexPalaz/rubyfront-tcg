// Il tasto del negozio nell'header (2026-09-22): un pezzo solo in due parti.
// A sinistra il saldo di gemme rubino — la gemma del marchio, piccola, e il
// numero — sulla piastra del Notte; a destra «Negozio» sul rubino della forgia,
// col suo alone. Si tocca ovunque e porta al negozio, che oggi risponde «non
// ancora disponibile». Le gemme sono quelle dell'account: zero finché il
// tavolo non le manda (nessun acquisto esiste ancora).

import { t } from "@rubyfront/core/i18n";
import { ColorMatrixFilter, Container, Rectangle, type FederatedPointerEvent, type Texture } from "pixi.js";
import { drawText, fontMetrics, textWidth, type Font } from "../card/text";
import type { Stage } from "../stage";
import { playSound } from "../sound";
import { CrispSprite, SANS, paintPiece, linearGradient, withShadow } from "../table/appearance";
import { ACTION_EDGE, ACTION_LABEL, BUTTON_FONT, INK, LINE } from "./ui";

/** Il numero delle gemme: tondo, come i contatori del tavolo. */
const COUNT: Font = { size: 15, weight: 700, family: SANS };
const H = 34;
const PAD = 12;
/** Il lato della gemma (ruotata di 45°: ingombra GEM·√2). */
const GEM = 9;
const GAP = 8;

export class StoreChip extends Container {
  private readonly sprite = new CrispSprite();
  private readonly light = new ColorMatrixFilter();
  private texture: Texture | null = null;
  private gems = 0;
  private readonly onLayout = (): void => this.paint();
  w = 0;
  readonly h = H;

  constructor(
    private readonly stage: Stage,
    onTap: () => void
  ) {
    super({ label: "store" });
    this.addChild(this.sprite);
    this.eventMode = "static";
    this.cursor = "pointer";
    this.light.brightness(1.12, false);
    this.on("pointerover", () => (this.sprite.filters = [this.light]));
    this.on("pointerout", () => (this.sprite.filters = []));
    this.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      playSound("button");
      onTap();
    });
    stage.onLayout(this.onLayout);
    this.paint();
  }

  /** Il saldo di gemme rubino da mostrare. */
  setGems(n: number): void {
    if (n === this.gems) return;
    this.gems = n;
    this.paint();
  }

  private paint(): void {
    if (this.destroyed) return;
    const res = this.stage.visible().scale * this.stage.app.renderer.resolution;
    const count = String(this.gems);
    const store = t("html.store");
    const gemW = GEM * Math.SQRT2;
    const leftW = PAD + Math.ceil(gemW) + GAP + Math.ceil(textWidth(COUNT, count)) + PAD;
    const rightW = PAD + 4 + Math.ceil(textWidth(BUTTON_FONT, store)) + PAD + 4;
    this.w = leftW + rightW;
    this.label = `store:${count}`;
    this.hitArea = new Rectangle(0, 0, this.w, H);
    const margin = 16;
    const old = this.texture;
    this.texture = paintPiece(this.w + 2 * margin, H + 2 * margin, res, ctx => {
      ctx.translate(margin, margin);
      // Il saldo: la piastra del Notte, il filo di luce in cima, il filo della linea.
      ctx.fillStyle = linearGradient(ctx, 180, 0, 0, leftW, H, [[0, "#241d22"], [1, "#151116"]]);
      ctx.fillRect(0, 0, leftW, H);
      ctx.fillStyle = "rgba(255,255,255,.07)";
      ctx.fillRect(1, 1, leftW - 2, 1);
      // Il negozio: il rubino sfaccettato del tasto «metal», con l'alone della forgia.
      const ruby = (): void => {
        ctx.fillStyle = linearGradient(ctx, 180, leftW, 0, rightW, H, [[0, "#d1244f"], [0.52, "#a41539"], [1, "#7f0c2b"]]);
        ctx.fillRect(leftW, 0, rightW, H);
      };
      withShadow(ctx, res, { x: 0, y: 0, blur: 14, color: "rgba(255,77,109,.35)" }, ruby);
      ruby();
      ctx.fillStyle = "rgba(255,255,255,.28)";
      ctx.fillRect(leftW + 1, 1, rightW - 2, 1);
      ctx.fillStyle = "rgba(0,0,0,.28)";
      ctx.fillRect(leftW + 1, H - 3, rightW - 2, 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = LINE;
      ctx.strokeRect(0.5, 0.5, leftW, H - 1);
      ctx.strokeStyle = ACTION_EDGE;
      ctx.strokeRect(leftW + 0.5, 0.5, rightW - 1, H - 1);
      // La gemma del marchio, piccola, col suo alone.
      ctx.save();
      ctx.translate(PAD + gemW / 2, H / 2);
      ctx.rotate(Math.PI / 4);
      withShadow(ctx, res, { x: 0, y: 0, blur: 8, color: "rgba(210,74,100,.65)" }, () => {
        ctx.fillStyle = "#9e0f34";
        ctx.fillRect(-GEM / 2, -GEM / 2, GEM, GEM);
      });
      ctx.strokeStyle = "#e56a86";
      ctx.strokeRect(-GEM / 2 + 0.5, -GEM / 2 + 0.5, GEM - 1, GEM - 1);
      ctx.restore();
      const c = fontMetrics(COUNT);
      drawText(ctx, { kind: "text", text: count, font: COUNT, color: INK }, PAD + Math.ceil(gemW) + GAP, (H + c.ascent - c.descent) / 2);
      const s = fontMetrics(BUTTON_FONT);
      drawText(
        ctx,
        { kind: "text", text: store, font: BUTTON_FONT, color: ACTION_LABEL, shadows: [{ x: 0, y: 1, blur: 0, color: "rgba(0,0,0,.4)" }] },
        leftW + PAD + 4,
        (H + s.ascent - s.descent) / 2
      );
    });
    this.sprite.texture = this.texture;
    this.sprite.position.set(-margin, -margin);
    old?.destroy(true);
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.stage.offLayout(this.onLayout);
    this.texture?.destroy(true);
    this.texture = null;
    super.destroy(options);
  }
}
