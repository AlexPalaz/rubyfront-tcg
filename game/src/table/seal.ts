// Il sigillo dell'arbitro: una regola ha fermato il gesto. Non un avviso di
// sistema ma un pezzo del gioco, come nel simulatore (main.ts, engineStop):
// la gemma del marchio, il titolo, il motivo in prosa, il riferimento al
// manuale su una targhetta, e il tasto per chiudere — o un click sul velo,
// o Esc. Il gesto non è avvenuto, e lo si deve sapere subito: sta sopra tutto.

import { verdictReason, type EngineVerdict } from "@rubyfront/core/engine";
import { t } from "@rubyfront/core/i18n";
import { Container, Graphics, Rectangle } from "pixi.js";
import { applyFont, drawLines, drawText, layout, textWidth, type Font } from "../card/text";
import type { Stage } from "../stage";
import { CrispSprite, SANS, paintPiece } from "./appearance";
import { NIGHT, VEIL_OVERLAY, plate, setBlurred } from "./night";

const W = 460;

export class Seal {
  private readonly root = new Container({ label: "seal" });
  private readonly veil = new Graphics();
  private readonly card = new CrispSprite();
  private readonly button = new Container({ label: "seal-ok" });
  private isVisible = false;
  /** Il tavolo e le schermate sfocati sotto il velo (backdrop-filter: blur(6px)). */
  private blurFilter: (() => void) | null = null;

  constructor(private readonly stage: Stage) {
    this.root.visible = false;
    this.root.addChild(this.veil, this.card, this.button);
    this.veil.eventMode = "static";
    this.veil.on("pointertap", () => this.close());
    this.button.eventMode = "static";
    this.button.cursor = "pointer";
    this.button.on("pointertap", () => this.close());
    stage.app.stage.addChild(this.root);
    window.addEventListener("keydown", event => {
      if (event.key === "Escape" && this.isVisible) this.close();
    });
  }

  isOpen(): boolean {
    return this.isVisible;
  }

  show(verdict: EngineVerdict): void {
    const raw = verdictReason(verdict) ?? t("stop.default", { action: verdict.action ?? "?" });
    // Il «(§6.2, attesa di evocazione)» in coda diventa la targhetta; la prosa resta pulita.
    const ref = raw.match(/\s*\(§([\d.]+)(?:,\s*([^)]+))?\)/);
    const prose = (ref ? raw.replace(ref[0], "") : raw).replace(/^\s*(\S)/, (_, ch: string) => ch.toUpperCase());
    const text = prose.endsWith(".") ? prose : `${prose}.`;
    const badge = ref ? `${t("stop.ref", { ref: ref[1] })}${ref[2] ? ` — ${ref[2]}` : ""}` : null;

    // Il sigillo sta sullo stage (fuori dal mondo): si posa in pixel di schermo, alla scala del mondo.
    this.root.parent?.addChild(this.root);
    const visible = this.stage.visible();
    const scale = visible.scale;
    const resolution = this.stage.app.renderer.resolution;
    const screen = this.stage.app.screen;
    this.veil.clear().rect(0, 0, screen.width, screen.height).fill(VEIL_OVERLAY);

    const body: Font = { size: 17, weight: 400, family: SANS };
    const lines = layout([{ kind: "text", text, font: body, color: NIGHT.ink }], W - 64, { font: body, lineHeight: 17 * 1.5 });
    const textH = lines.reduce((sum, line) => sum + line.height, 0);
    const refFont: Font = { size: 13, weight: 700, family: SANS, spacing: 1.3, upper: true };
    const titleFont: Font = { size: 18, weight: 700, family: SANS, spacing: 18 * 0.16, upper: true };
    const okFont: Font = { size: 15, weight: 700, family: SANS, spacing: 15 * 0.12, upper: true };
    const h = 40 + 26 + 18 + 30 + textH + (badge ? 18 + 28 : 0) + 26 + 44 + 30;

    this.card.texture = paintPiece(W, h, scale * resolution, ctx => {
      // Il vetro scuro del Notte (--glass-heavy) con la cornice rubino smorzata.
      ctx.fillStyle = NIGHT.glassHeavy;
      ctx.fillRect(0, 0, W, h);
      ctx.strokeStyle = NIGHT.rubyLine;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, W - 1, h - 1);
      // La gemma del marchio.
      ctx.save();
      ctx.translate(W / 2, 40 + 13);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "#9e0f34";
      ctx.fillRect(-9, -9, 18, 18);
      ctx.strokeStyle = "#e56a86";
      ctx.strokeRect(-8.5, -8.5, 17, 17);
      ctx.restore();
      let y = 40 + 26 + 18;
      const title = t("stop.title");
      applyFont(ctx, titleFont);
      drawText(
        ctx,
        { kind: "text", text: title, font: titleFont, color: NIGHT.ruby, shadows: [{ x: 0, y: 0, blur: 16, color: "rgba(210,74,100,.5)" }] },
        (W - textWidth(titleFont, title)) / 2,
        y + 18
      );
      y += 30;
      // La prosa, centrata riga per riga (le linee di base di `impagina` contano già dalla cima del blocco).
      for (const line of lines) drawLines(ctx, [line], (W - line.width) / 2, y);
      y += textH;
      if (badge) {
        y += 18;
        const bw = textWidth(refFont, badge) + 24;
        ctx.fillStyle = NIGHT.refPanel;
        ctx.fillRect((W - bw) / 2, y, bw, 28);
        ctx.strokeStyle = NIGHT.lineSoft;
        ctx.strokeRect((W - bw) / 2 + 0.5, y + 0.5, bw - 1, 27);
        applyFont(ctx, refFont);
        drawText(ctx, { kind: "text", text: badge, font: refFont, color: NIGHT.muted }, (W - bw) / 2 + 12, y + 19);
        y += 28;
      }
      y += 26;
      // Il tasto.
      const label = t("stop.ok");
      // Sul Notte il tasto è la piastra brunita con la cornice rosa.
      plate(ctx, 32, y, W - 64, 44, NIGHT.goLine);
      applyFont(ctx, okFont);
      drawText(ctx, { kind: "text", text: label, font: okFont, color: NIGHT.goInk }, (W - textWidth(okFont, label)) / 2, y + 27);
    });
    this.card.width = W * scale;
    this.card.height = h * scale;
    this.card.position.set((screen.width - W * scale) / 2, (screen.height - h * scale) / 2);
    this.card.eventMode = "static";
    // Il tasto: la sua fascia in fondo alla carta.
    this.button.hitArea = new Rectangle(this.card.x + 32 * scale, this.card.y + (h - 30 - 44) * scale, (W - 64) * scale, 44 * scale);
    this.root.visible = true;
    this.isVisible = true;
    this.blurFilter?.();
    this.blurFilter = setBlurred(this.stage, [this.stage.world, this.stage.screens], 6);
  }

  close(): void {
    this.root.visible = false;
    this.isVisible = false;
    this.blurFilter?.();
    this.blurFilter = null;
  }
}
