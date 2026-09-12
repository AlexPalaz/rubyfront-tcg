// L'ingresso dei Rubyfront a inizio partita col bot (simulatore/src/
// table.ts, introRubyfronts; style.css, .intro-*): un velo sul tavolo, e uno
// alla volta — il tuo, poi l'avversario — la carta grande arriva dal proprio
// lato (il tuo da sinistra, dal basso; l'altro da destra, dall'alto), si
// ferma al centro, si ACCENDE nella tinta del mazzo (un anello di luce che
// si allarga e resta come alone, un lampo sulla carta) e vola a posarsi nel
// riquadro del Rubyfront, dove la carta vera si accende a sua volta. Muto
// (deciso 2026-09-11). Finché dura il tavolo è fermo.

import type { Ctx } from "@rubyfront/core/ctx";
import type { Gestures } from "@rubyfront/core/gestures";
import type { CardInstance, Seat } from "@rubyfront/core/types";
import { ColorMatrixFilter, Container, Graphics, Sprite, Texture } from "pixi.js";
import { faceTexture } from "../card/cache";
import { CARD_H, CARD_W } from "../card/theme";
import type { Stage } from "../stage";
import { wait, bezier, key, tween, easeIn, easeOut, reducedMotion } from "./animation";
import { paintPiece, withShadow } from "./appearance";
import type { Table } from "./table";

/** La luce dell'accensione, nella tinta del mazzo (.intro-card[data-tint]). */
const GLOW: Record<string, string> = { destructive: "255,46,90", dimensional: "64,110,255", dynamic: "214,222,240" };

export class Entrance {
  /** Il Rubyfront si è posato al suo posto (effects/director.ts: l'impatto e la sua tinta). */
  onLanding: ((uid: string) => void) | null = null;
  private readonly layer = new Container({ label: "entrance" });
  private enabled = false;

  constructor(
    private readonly stage: Stage,
    private readonly table: Table,
    private readonly ctx: Ctx,
    private readonly gestures: Gestures
  ) {
    stage.world.addChild(this.layer);
  }

  isRunning(): boolean {
    return this.enabled;
  }

  /** L'ingresso dei Rubyfront in Zona di Richiamo, nell'ordine dato. */
  async rubyfronts(order: Seat[]): Promise<void> {
    const entries = order
      .map(seat => ({ seat, card: this.gestures.waitingRubyfront(seat) }))
      .filter((entry): entry is { seat: Seat; card: CardInstance } => entry.card !== undefined);
    if (entries.length === 0 || reducedMotion()) return;
    this.enabled = true;
    const v = this.stage.visible();
    const veil = new Graphics().rect(v.x, v.y, v.width, v.height).fill({ color: 0x05040a, alpha: 0.66 });
    veil.eventMode = "static";
    this.layer.addChild(veil);
    this.layer.parent?.addChild(this.layer);
    // Le carte vere aspettano nascoste: entrano col volo.
    for (const entry of entries) {
      const view = this.table.view(entry.card.uid);
      if (view) view.visible = false;
    }
    const ticker = this.stage.app.ticker;
    void tween(ticker, 300, k => (veil.alpha = k), easeOut);
    try {
      await wait(300);
      for (const entry of entries) await this.pick(entry.seat, entry.card);
    } finally {
      for (const entry of entries) {
        const view = this.table.view(entry.card.uid);
        if (view && !view.destroyed) view.visible = true;
      }
      await tween(ticker, 350, k => (veil.alpha = 1 - k), easeIn);
      veil.destroy();
      this.enabled = false;
    }
  }

  private async pick(seat: Seat, card: CardInstance): Promise<void> {
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;
    const mine = seat === this.ctx.seat();
    const scale = Math.min(0.92, (v.height - 160) / CARD_H, (v.width - 200) / CARD_W);
    const w = CARD_W * scale;
    const h = CARD_H * scale;
    const cx = v.x + v.width / 2;
    const cy = v.y + v.height / 2;
    // L'illustrazione arriva dalla rete: si aspetta la faccia (al più un secondo e mezzo).
    const face = await Promise.race([faceTexture(card.cardId, 0, this.ctx.locale(), scale * res), wait(1500).then(() => null)]);
    const glow = GLOW[this.ctx.tintFor(seat)] ?? GLOW.destructive;
    const margin = 160;
    const glowTexture = paintPiece(w + 2 * margin, h + 2 * margin, res, ctx => {
      ctx.translate(margin, margin);
      const frame = (): void => {
        ctx.strokeStyle = `rgba(${glow},.95)`;
        ctx.lineWidth = 2;
        ctx.strokeRect(-4, -4, w + 8, h + 8);
      };
      withShadow(ctx, res, { x: 0, y: 0, blur: 120, color: `rgba(${glow},.7)` }, frame);
      withShadow(ctx, res, { x: 0, y: 0, blur: 40, color: `rgba(${glow},.95)` }, frame);
      frame();
    });
    const group = new Container({ label: "entrance-card" });
    const glowSprite = new Sprite(glowTexture);
    glowSprite.anchor.set(0.5);
    glowSprite.alpha = 0;
    const cardSprite = new Sprite(face ?? Texture.WHITE);
    cardSprite.anchor.set(0.5);
    cardSprite.width = w;
    cardSprite.height = h;
    const flash = new ColorMatrixFilter();
    cardSprite.filters = [flash];
    group.addChild(glowSprite, cardSprite);
    const x0 = mine ? v.x - w / 2 - 120 : v.x + v.width + w / 2 + 120;
    const y0 = cy + (mine ? 220 : -220);
    const rot = ((mine ? -16 : 16) * Math.PI) / 180;
    group.position.set(x0, y0);
    group.rotation = rot;
    group.alpha = 0;
    this.layer.addChild(group);
    const ticker = this.stage.app.ticker;

    // Arriva (.is-arriving: .95s, l'opacità in .4s).
    void tween(ticker, 400, k => (group.alpha = k), easeOut);
    await tween(ticker, 950, k => {
      group.position.set(x0 + (cx - x0) * k, y0 + (cy - y0) * k);
      group.rotation = rot * (1 - k);
    }, bezier(0.2, 0.85, 0.25, 1));
    // Si accende (intro-ignite, intro-flash: 1.25s).
    await tween(ticker, 1250, k => {
      glowSprite.alpha = key(k, [[0, 0], [0.22, 1], [1, 0.9]]);
      glowSprite.scale.set(key(k, [[0, 1.12], [0.22, 1], [1, 1]]));
      flash.brightness(key(k, [[0, 1], [0.2, 1.9], [1, 1.05]]), false);
    }, bezier(0.2, 0.7, 0.3, 1));
    // Vola al suo posto e ci si posa (.is-landing: .78s).
    const box = this.table.box(card.uid);
    if (box) {
      const to = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      const from = { x: group.x, y: group.y };
      const endScale = box.w / w;
      await tween(ticker, 780, k => {
        group.position.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
        group.scale.set(1 + (endScale - 1) * k);
        glowSprite.alpha = 0.9 * (1 - k);
      }, bezier(0.45, 0.05, 0.2, 1));
    }
    const view = this.table.view(card.uid);
    if (view && !view.destroyed) {
      view.visible = true;
      this.table.light(card.uid, true);
      setTimeout(() => this.table.light(card.uid, false), 900);
    }
    this.onLanding?.(card.uid);
    group.destroy({ children: true });
    glowTexture.destroy(true);
    await wait(350);
  }
}
