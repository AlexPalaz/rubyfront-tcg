// Il chip del mazzo scelto (2026-09-24): la copertina del mazzo — il suo
// Rubyfront, ritagliato nel quadrato col filo di rubino — con una luce che
// le scivola sopra piano e, al passaggio, si avvicina appena (la copertina
// cresce dentro il suo riquadro); accanto la didascalia «Mazzo» e il nome.
// Senza mazzo scelto è l'invito «Scegli il mazzo», sulla piastra col filo
// rosa dell'azione e la scritta chiara.

import { t } from "@rubyfront/core/i18n";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { loadImage, type ImageElement } from "../../card/resources";
import { drawText, fontMetrics, textWidth, type Font } from "../../card/text";
import type { Stage } from "../../stage";
import { SANS, paintPiece } from "../../table/appearance";
import { reducedMotion } from "../../table/animation";
import { BUTTON_FONT } from "../ui";
import { CHIP_H, HeaderChip, nightPlate } from "./chip";

const CAPTION: Font = { size: 9, weight: 700, family: SANS, spacing: 9 * 0.18, upper: true };
const NAME: Font = { size: 14, weight: 700, family: SANS };
const PAD = 10;
const COVER = 26;
const GAP = 9;

export interface DeckChipDeck {
  name: string;
  /** L'illustrazione del Rubyfront del mazzo (url completo), o niente. */
  art: string | null;
}

export class DeckChip extends HeaderChip {
  private deck: DeckChipDeck | null = null;
  private image: ImageElement | null = null;
  private cover: Sprite | null = null;
  private coverMask: Graphics | null = null;
  private coverLight: Sprite | null = null;
  private coverTexture: Texture | null = null;

  constructor(stage: Stage, onTap: () => void) {
    super(stage, `button:${t("html.deck.none")}`, onTap);
    this.ready();
  }

  /** Il mazzo scelto (nome e copertina), o niente. */
  set(deck: DeckChipDeck | null): void {
    if (deck?.name === this.deck?.name && deck?.art === this.deck?.art) return;
    this.deck = deck;
    this.image = null;
    this.label = deck ? `deckchip:${deck.name}` : `button:${t("html.deck.none")}`;
    this.relayout();
    if (!deck?.art) return;
    const wanted = deck.art;
    void loadImage(wanted)
      .then(image => {
        if (this.destroyed || this.deck?.art !== wanted) return;
        this.image = image;
        this.relayout();
      })
      .catch(() => undefined);
  }

  protected measure(): number {
    const deck = this.deck;
    if (!deck) return PAD + 6 + Math.ceil(textWidth(BUTTON_FONT, t("html.deck.none"))) + PAD + 6;
    const textW = Math.max(Math.ceil(textWidth(CAPTION, t("html.deck.caption"))), Math.ceil(textWidth(NAME, deck.name)));
    return PAD - 4 + COVER + GAP + textW + PAD + 2;
  }

  protected override glowColor(): string {
    return this.deck ? "224,49,75" : "229,106,134";
  }

  protected paintPlate(ctx: CanvasRenderingContext2D, w: number): void {
    const deck = this.deck;
    nightPlate(ctx, 0, w, CHIP_H, deck ? "#3a3037" : "#e56a86");
    if (!deck) {
      const m = fontMetrics(BUTTON_FONT);
      drawText(ctx, { kind: "text", text: t("html.deck.none"), font: BUTTON_FONT, color: "#fdeef1" }, PAD + 6, (CHIP_H + m.ascent - m.descent) / 2);
      return;
    }
    // Il buio della copertina (sotto l'immagine viva) e il suo filo di rubino.
    const cx = PAD - 4;
    const cy = (CHIP_H - COVER) / 2;
    ctx.fillStyle = "#0c0a0d";
    ctx.fillRect(cx, cy, COVER, COVER);
    ctx.strokeStyle = "#9e0f34";
    ctx.lineWidth = 1;
    ctx.strokeRect(cx + 0.5, cy + 0.5, COVER - 1, COVER - 1);
    const tx = cx + COVER + GAP;
    drawText(ctx, { kind: "text", text: t("html.deck.caption"), font: CAPTION, color: "#9a8e93" }, tx, 12);
    drawText(ctx, { kind: "text", text: deck.name, font: NAME, color: "#f1eae6" }, tx, 27);
  }

  protected buildLayer(_w: number, res: number): void {
    this.cover = null;
    this.coverMask = null;
    this.coverLight = null;
    this.coverTexture?.destroy(true);
    this.coverTexture = null;
    const image = this.image;
    if (!this.deck || !image) return;
    const cx = PAD - 4;
    const cy = (CHIP_H - COVER) / 2;
    const inner = COVER - 2;
    // La copertina: il quadrato centrale dell'illustrazione, dipinto un po' più grande per lo zoom al passaggio.
    const side = Math.min(image.width, image.height);
    const big = inner * 1.3;
    this.coverTexture = paintPiece(big, big, res, ctx => ctx.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, big, big));
    const cover = new Sprite(this.coverTexture);
    cover.anchor.set(0.5);
    cover.position.set(cx + COVER / 2, cy + COVER / 2);
    cover.scale.set(inner / big);
    const mask = new Graphics().rect(cx + 1, cy + 1, inner, inner).fill(0xffffff);
    const holder = new Container();
    holder.mask = mask;
    // La luce che scivola sulla copertina: una banda chiara additiva.
    const light = new Sprite(
      paintPiece(inner * 2, inner * 2, res, ctx => {
        const g = ctx.createLinearGradient(0, 0, inner * 2, inner * 2);
        g.addColorStop(0.35, "rgba(255,255,255,0)");
        g.addColorStop(0.5, "rgba(255,230,236,.45)");
        g.addColorStop(0.65, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, inner * 2, inner * 2);
      })
    );
    light.anchor.set(0.5);
    light.blendMode = "add";
    light.alpha = 0.8;
    holder.addChild(cover, light, mask);
    this.layer.addChild(holder);
    this.cover = cover;
    this.coverMask = mask;
    this.coverLight = light;
  }

  protected stepLayer(now: number, hover: number): void {
    const cover = this.cover;
    const light = this.coverLight;
    if (!cover || !light || cover.destroyed) return;
    const inner = COVER - 2;
    const big = inner * 1.3;
    cover.scale.set((inner / big) * (1 + 0.14 * hover));
    // La luce passa ogni 4 s, da un angolo all'altro; ferma col movimento ridotto.
    const k = reducedMotion() ? 0.5 : (now % 4000) / 4000;
    const travel = inner * 1.8;
    light.position.set(cover.position.x - travel / 2 + travel * k, cover.position.y - travel / 2 + travel * k);
    light.alpha = 0.55 + 0.45 * hover;
    void this.coverMask;
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.coverTexture?.destroy(true);
    super.destroy(options);
  }
}
