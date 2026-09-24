// I chip dell'header (2026-09-24): un motore comune per i tasti vivi in cima
// — Rubyfront, il mazzo, le gemme col negozio. Ogni chip è una piastra
// dipinta (canvas, una volta per misura) con sopra i pezzi vivi in Pixi: il
// riflesso obliquo che scorre (di tanto in tanto da solo, sempre al
// passaggio), l'alone del filo che respira e si accende al passaggio, la
// pressione che schiaccia appena, e per ciascuno il suo dettaglio animato
// (l'orbita del Rubyfront, la luce sulla copertina, la scintilla della
// gemma). Le sottoclassi dipingono la piastra e i loro pezzi; qui il resto.

import { Container, Graphics, Rectangle, Sprite, type FederatedPointerEvent, type Texture } from "pixi.js";
import type { Stage } from "../../stage";
import { reducedMotion } from "../../table/animation";
import { CrispSprite, paintPiece, withShadow } from "../../table/appearance";
import { playSound } from "../../sound";
import { Anim } from "../progression/fx";

export const CHIP_H = 34;
/** Il margine della texture della piastra (per ombre e aloni). */
export const CHIP_MARGIN = 18;
/** Il riflesso: ogni quanto passa da solo, e quanto ci mette. */
const SHINE_EVERY_MS = 5200;
const SHINE_MS = 900;

export abstract class HeaderChip extends Container {
  /** Il corpo, col perno al centro: la pressione lo schiaccia. */
  protected readonly body = new Container();
  protected readonly plate = new CrispSprite();
  /** I pezzi vivi delle sottoclassi, sopra la piastra e sotto il riflesso. */
  protected readonly layer = new Container();
  private readonly glowSprite = new Sprite();
  private readonly shine = new Sprite();
  private readonly shineMask = new Graphics();
  private readonly edge = new Graphics();
  private plateTexture: Texture | null = null;
  private glowTexture: Texture | null = null;
  private shineTexture: Texture | null = null;
  protected readonly hover = new Anim(0);
  private readonly press = new Anim(0);
  private shineAt = performance.now() + Math.random() * SHINE_EVERY_MS;
  private shineForced = false;
  protected res = 1;
  w = 0;
  readonly h = CHIP_H;
  private readonly onLayout = (): void => this.relayout();
  private readonly onTick = (): void => this.tick();

  constructor(
    protected readonly stage: Stage,
    label: string,
    private readonly onTap: () => void
  ) {
    super({ label });
    this.glowSprite.eventMode = "none";
    this.shine.eventMode = "none";
    this.shine.blendMode = "add";
    this.shine.mask = this.shineMask;
    this.plate.eventMode = "none";
    this.layer.eventMode = "none";
    this.edge.eventMode = "none";
    this.body.addChild(this.glowSprite, this.plate, this.layer, this.shine, this.shineMask, this.edge);
    this.addChild(this.body);
    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointerover", () => {
      this.hover.set(1, 180);
      this.shineForced = true;
      this.shineAt = Math.min(this.shineAt, performance.now());
    });
    this.on("pointerout", () => {
      this.hover.set(0, 260);
      this.press.set(0, 200);
    });
    this.on("pointerdown", () => this.press.set(1, 90));
    this.on("pointerup", () => this.press.set(0, 220));
    this.on("pointerupoutside", () => this.press.set(0, 220));
    this.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      playSound("button");
      this.onTap();
    });
  }

  /** Da chiamare in coda al costruttore della sottoclasse (i suoi campi devono esistere): il layout e l'orologio partono qui. */
  protected ready(): void {
    this.stage.onLayout(this.onLayout);
    this.stage.app.ticker.add(this.onTick);
  }

  /** La larghezza del chip per il contenuto attuale (unità di progetto). */
  protected abstract measure(): number;
  /** La piastra: il fondo, i fili, ciò che non si muove. Origine in (0,0), misura w×h. */
  protected abstract paintPlate(ctx: CanvasRenderingContext2D, w: number, res: number): void;
  /** I pezzi vivi, ricostruiti a ogni misura (nel `layer`). */
  protected abstract buildLayer(w: number, res: number): void;
  /** Un frame per i pezzi vivi della sottoclasse. */
  protected abstract stepLayer(now: number, hover: number): void;
  /** Il colore dell'alone del filo. */
  protected glowColor(): string {
    return "224,49,75";
  }

  /** Rifà misura, piastra, alone, riflesso e pezzi: quando il contenuto cambia. */
  protected relayout(): void {
    if (this.destroyed) return;
    const v = this.stage.visible();
    this.res = v.scale * this.stage.app.renderer.resolution;
    const res = this.res;
    this.w = Math.ceil(this.measure());
    const { w, h } = this;
    this.hitArea = new Rectangle(0, 0, w, h);
    this.body.pivot.set(w / 2, h / 2);
    this.body.position.set(w / 2, h / 2);
    const oldPlate = this.plateTexture;
    this.plateTexture = paintPiece(w + 2 * CHIP_MARGIN, h + 2 * CHIP_MARGIN, res, ctx => {
      ctx.translate(CHIP_MARGIN, CHIP_MARGIN);
      this.paintPlate(ctx, w, res);
    });
    this.plate.texture = this.plateTexture;
    this.plate.position.set(-CHIP_MARGIN, -CHIP_MARGIN);
    oldPlate?.destroy(true);
    // L'alone: il rettangolo del chip con la sua ombra colorata, senza il rettangolo.
    const oldGlow = this.glowTexture;
    this.glowTexture = paintPiece(w + 2 * CHIP_MARGIN, h + 2 * CHIP_MARGIN, res, ctx => {
      ctx.translate(CHIP_MARGIN, CHIP_MARGIN);
      withShadow(ctx, res, { x: 0, y: 0, blur: 16, color: `rgba(${this.glowColor()},.85)` }, () => {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
      });
      ctx.clearRect(0, 0, w, h);
    });
    this.glowSprite.texture = this.glowTexture;
    this.glowSprite.position.set(-CHIP_MARGIN, -CHIP_MARGIN);
    this.glowSprite.alpha = 0.25;
    oldGlow?.destroy(true);
    // Il riflesso: una banda obliqua di luce, mascherata dal chip.
    const band = 46;
    const oldShine = this.shineTexture;
    this.shineTexture = paintPiece(band + h, h, res, ctx => {
      ctx.transform(1, 0, -0.55, 1, h * 0.55, 0);
      const g = ctx.createLinearGradient(0, 0, band, 0);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(255,255,255,.22)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, band, h);
    });
    this.shine.texture = this.shineTexture;
    this.shine.position.set(-band - h, 0);
    this.shine.visible = false;
    oldShine?.destroy(true);
    this.shineMask.clear().rect(0, 0, w, h).fill(0xffffff);
    this.edge.clear().rect(0.5, 0.5, w - 1, h - 1).stroke({ color: 0xff7b98, width: 1 });
    this.edge.alpha = 0;
    for (const child of this.layer.removeChildren()) child.destroy({ children: true });
    this.buildLayer(w, res);
  }

  private tick(): void {
    if (this.destroyed || !this.visible || !this.parent?.visible) return;
    const now = performance.now();
    this.hover.step(now);
    this.press.step(now);
    const hover = this.hover.v;
    const breath = reducedMotion() ? 0.5 : 0.5 - 0.5 * Math.cos((now / 2600) * Math.PI * 2);
    this.glowSprite.alpha = 0.18 + 0.12 * breath + 0.55 * hover;
    this.edge.alpha = hover;
    this.body.scale.set(1 - 0.035 * this.press.v);
    // Il riflesso: parte da solo ogni tanto, e subito al passaggio.
    if (!reducedMotion() && now >= this.shineAt) {
      const k = (now - this.shineAt) / SHINE_MS;
      if (k >= 1) {
        this.shine.visible = false;
        this.shineAt = now + SHINE_EVERY_MS * (this.shineForced ? 1.6 : 1) + Math.random() * 1500;
        this.shineForced = false;
      } else {
        this.shine.visible = true;
        const band = 46 + this.h;
        this.shine.position.x = -band + (this.w + band) * k;
        this.shine.alpha = 0.6 + 0.4 * hover;
      }
    }
    this.stepLayer(now, hover);
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.stage.offLayout(this.onLayout);
    this.stage.app.ticker.remove(this.onTick);
    this.plateTexture?.destroy(true);
    this.glowTexture?.destroy(true);
    this.shineTexture?.destroy(true);
    super.destroy(options);
  }
}

/** La piastra del Notte: gradiente scuro, filo di luce in cima, filo del bordo. */
export function nightPlate(ctx: CanvasRenderingContext2D, x: number, w: number, h: number, edge: string): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#241d22");
  g.addColorStop(1, "#151116");
  ctx.fillStyle = g;
  ctx.fillRect(x, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,.07)";
  ctx.fillRect(x + 1, 1, w - 2, 1);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, 0.5, w - 1, h - 1);
}

/** Il rubino sfaccettato dei tasti «metal», con l'alone della forgia. */
export function rubyPlate(ctx: CanvasRenderingContext2D, x: number, w: number, h: number, res: number): void {
  const fill = (): void => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#d1244f");
    g.addColorStop(0.52, "#a41539");
    g.addColorStop(1, "#7f0c2b");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, w, h);
  };
  withShadow(ctx, res, { x: 0, y: 0, blur: 14, color: "rgba(255,77,109,.35)" }, fill);
  fill();
  ctx.fillStyle = "rgba(255,255,255,.28)";
  ctx.fillRect(x + 1, 1, w - 2, 1);
  ctx.fillStyle = "rgba(0,0,0,.28)";
  ctx.fillRect(x + 1, h - 3, w - 2, 2);
  ctx.strokeStyle = "#e56a86";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, 0.5, w - 1, h - 1);
}

/** La gemma del marchio: quadrato ruotato col gradiente, la faccetta di luce, il filo rosa e l'alone. */
export function paintGem(ctx: CanvasRenderingContext2D, cx: number, cy: number, side: number, res: number, glow = 0.65): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  withShadow(ctx, res, { x: 0, y: 0, blur: 8, color: `rgba(210,74,100,${glow})` }, () => {
    const g = ctx.createLinearGradient(-side / 2, -side / 2, side / 2, side / 2);
    g.addColorStop(0, "#e0314b");
    g.addColorStop(1, "#9e0f34");
    ctx.fillStyle = g;
    ctx.fillRect(-side / 2, -side / 2, side, side);
  });
  ctx.fillStyle = "rgba(255,255,255,.16)";
  ctx.beginPath();
  ctx.moveTo(-side / 2, -side / 2);
  ctx.lineTo(side / 2, -side / 2);
  ctx.lineTo(-side / 2, side / 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#ffb7c6";
  ctx.lineWidth = 1;
  ctx.strokeRect(-side / 2 + 0.5, -side / 2 + 0.5, side - 1, side - 1);
  ctx.restore();
}
