// Il mazzo scelto nell'header (2026-09-23): una targa con la copertina del
// mazzo — il Rubyfront, ritagliato in un quadrato col filo di rubino — la
// didascalia «Mazzo» e il nome del mazzo. Senza mazzo scelto è l'invito
// «Scegli il mazzo», sulla piastra col filo rosa dell'azione. Si tocca e
// porta alla collezione. L'illustrazione arriva da sola quando è caricata.

import { t } from "@rubyfront/core/i18n";
import { ColorMatrixFilter, Container, Graphics, Rectangle, type FederatedPointerEvent, type Texture } from "pixi.js";
import { loadImage, type ImageElement } from "../card/resources";
import { drawText, fontMetrics, textWidth, type Font } from "../card/text";
import type { Stage } from "../stage";
import { playSound } from "../sound";
import { CrispSprite, SANS, paintPiece, linearGradient } from "../table/appearance";
import { ACTION_EDGE, ACTION_LABEL, BUTTON_FONT, INK, LINE, MUTED, RUBY, hex } from "./ui";

/** La didascalia sopra il nome: piccola, maiuscola, spaziata. */
const CAPTION: Font = { size: 9, weight: 700, family: SANS, spacing: 9 * 0.18, upper: true };
/** Il nome del mazzo. */
const NAME: Font = { size: 14, weight: 700, family: SANS };
const H = 34;
const PAD = 10;
/** Il lato della copertina, dentro la targa. */
const COVER = 26;
const GAP = 9;

export interface DeckChipDeck {
  name: string;
  /** L'illustrazione del Rubyfront del mazzo (url completo), o niente. */
  art: string | null;
}

export class DeckChip extends Container {
  private readonly sprite = new CrispSprite();
  private readonly light = new ColorMatrixFilter();
  private readonly edge = new Graphics();
  private texture: Texture | null = null;
  private deck: DeckChipDeck | null = null;
  private image: ImageElement | null = null;
  private readonly onLayout = (): void => this.paint();
  w = 0;
  readonly h = H;

  constructor(
    private readonly stage: Stage,
    onTap: () => void
  ) {
    super({ label: `button:${t("html.deck.none")}` });
    this.edge.visible = false;
    this.addChild(this.sprite, this.edge);
    this.eventMode = "static";
    this.cursor = "pointer";
    this.light.brightness(1.12, false);
    this.on("pointerover", () => {
      this.edge.visible = true;
      this.sprite.filters = [this.light];
    });
    this.on("pointerout", () => {
      this.edge.visible = false;
      this.sprite.filters = [];
    });
    this.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      playSound("button");
      onTap();
    });
    stage.onLayout(this.onLayout);
    this.paint();
  }

  /** Il mazzo scelto (nome e copertina), o niente. */
  set(deck: DeckChipDeck | null): void {
    if (deck?.name === this.deck?.name && deck?.art === this.deck?.art) return;
    this.deck = deck;
    this.image = null;
    this.paint();
    if (!deck?.art) return;
    const wanted = deck.art;
    void loadImage(wanted)
      .then(image => {
        if (this.destroyed || this.deck?.art !== wanted) return;
        this.image = image;
        this.paint();
      })
      .catch(() => undefined);
  }

  private paint(): void {
    if (this.destroyed) return;
    const res = this.stage.visible().scale * this.stage.app.renderer.resolution;
    const deck = this.deck;
    const caption = t("html.deck.caption");
    const none = t("html.deck.none");
    // Senza mazzo: la scritta dell'invito, come un tasto. Col mazzo: copertina, didascalia e nome.
    const textW = deck ? Math.max(Math.ceil(textWidth(CAPTION, caption)), Math.ceil(textWidth(NAME, deck.name))) : Math.ceil(textWidth(BUTTON_FONT, none));
    this.w = deck ? PAD - 4 + COVER + GAP + textW + PAD + 2 : PAD + 6 + textW + PAD + 6;
    this.label = deck ? `deckchip:${deck.name}` : `button:${none}`;
    this.hitArea = new Rectangle(0, 0, this.w, H);
    this.edge.clear().rect(0.5, 0.5, this.w - 1, H - 1).stroke({ color: deck ? hex(RUBY) : 0xf0a0b4, width: 1 });
    const margin = 2;
    const old = this.texture;
    const image = this.image;
    this.texture = paintPiece(this.w + 2 * margin, H + 2 * margin, res, ctx => {
      ctx.translate(margin, margin);
      // La piastra del Notte, il filo di luce in cima.
      ctx.fillStyle = linearGradient(ctx, 180, 0, 0, this.w, H, [[0, "#241d22"], [1, "#151116"]]);
      ctx.fillRect(0, 0, this.w, H);
      ctx.fillStyle = "rgba(255,255,255,.07)";
      ctx.fillRect(1, 1, this.w - 2, 1);
      ctx.lineWidth = 1;
      ctx.strokeStyle = deck ? LINE : ACTION_EDGE;
      ctx.strokeRect(0.5, 0.5, this.w - 1, H - 1);
      if (!deck) {
        const m = fontMetrics(BUTTON_FONT);
        drawText(ctx, { kind: "text", text: none, font: BUTTON_FONT, color: ACTION_LABEL }, PAD + 6, (H + m.ascent - m.descent) / 2);
        return;
      }
      // La copertina: il quadrato centrale dell'illustrazione, col filo di rubino; senza, il buio della carta.
      const cx = PAD - 4;
      const cy = (H - COVER) / 2;
      ctx.fillStyle = "#0c0a0d";
      ctx.fillRect(cx, cy, COVER, COVER);
      if (image) {
        const side = Math.min(image.width, image.height);
        ctx.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, cx, cy, COVER, COVER);
      }
      ctx.strokeStyle = "#9e0f34";
      ctx.strokeRect(cx + 0.5, cy + 0.5, COVER - 1, COVER - 1);
      const tx = cx + COVER + GAP;
      // Due righe in 34 punti: la didascalia posa a 12, il nome a 27 — sei punti d'aria fra le due.
      drawText(ctx, { kind: "text", text: caption, font: CAPTION, color: MUTED }, tx, 12);
      drawText(ctx, { kind: "text", text: deck.name, font: NAME, color: INK }, tx, 27);
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
