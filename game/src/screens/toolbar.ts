// L'header del gioco (simulatore: index.html .toolbar): il marchio, che
// riporta alla home (al tavolo chiede prima); a destra, al tavolo, la spia
// della stanza, la chat (in stanza) e «Esci dalla partita»; in fondo
// l'ingranaggio delle impostazioni. Vetro chiaro alto 54, come la barra che
// il tavolo lascia libera in cima (impaginazione.ts, FISSI.barra). Tema
// «Notte»: la grana di pietra su un gradiente scuro, la luce in cima, il filo
// di rubino sotto con l'alone della forgia, e un bagliore rosa a sinistra
// sotto la barra (.toolbar::after).

import { t } from "@rubyfront/core/i18n";
import { Container, FillGradient, Graphics, Rectangle, Sprite, Texture, TilingSprite } from "pixi.js";
import { loadImage } from "../card/resources";
import { drawText, fontMetrics, textWidth, type Font } from "../card/text";
import type { Stage } from "../stage";
import { playSound } from "../sound";
import { SANS, paintPiece, linearGradient } from "../table/appearance";
import { tween, ease } from "../table/animation";
import { STONE } from "./stone";
import { TOOLBAR_H, FONT_BASE, INK, MUTED, RUBY, Button, hex } from "./ui";

const BRAND: Font = { size: 16, weight: 700, family: SANS, spacing: 16 * 0.12, upper: true };
/** L'ingranaggio del simulatore (index.html, #settings-toggle), 24×24. */
const GEAR =
  "M19.4 13c.04-.32.06-.65.06-1s-.02-.68-.07-1l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.3 7.3 0 0 0-1.73-1l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.63.26-1.21.6-1.74 1l-2.39-.96a.5.5 0 0 0-.6.22L2.68 8.78a.5.5 0 0 0 .12.64L4.83 11c-.05.32-.08.66-.08 1s.03.68.08 1l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.6.22l2.4-.96c.52.4 1.1.74 1.73 1l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54a7.3 7.3 0 0 0 1.73-1l2.4.96c.23.09.48 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64L19.4 13zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z";
/** I colori della spia della stanza: collegata, in collegamento, giù. */
const STATUS_COLORS: Record<string, number> = { online: 0x3f9b62, connecting: 0xd9a84e, offline: 0xc0392b };

export interface ToolbarActions {
  home(): void;
  leave(): void;
  settings(): void;
  chat(): void;
  /** STRUMENTI DI PROVA, temporanei (simulatore: Evoca e il «+» del Flusso): una carta del catalogo in mano, un Flusso in più. */
  spawn?(): void;
  flux?(): void;
}

export class Toolbar {
  readonly root = new Container({ label: "toolbar" });
  private readonly background = new Graphics();
  private readonly stone = new TilingSprite({ texture: Texture.EMPTY, width: 1, height: 1 });
  private readonly light = new Sprite();
  private lightTexture: Texture | null = null;
  private readonly glow = new Sprite();
  private glowTex: Texture | null = null;
  private readonly brand = new Container({ label: "logo" });
  private readonly brandSprite = new Sprite();
  private brandTextures: { base: Texture; light: Texture } | null = null;
  private readonly gear = new Container({ label: "gear" });
  private readonly rotateTo = new Sprite();
  private gearTexture: Texture | null = null;
  private readonly statusDot = new Graphics();
  private readonly leave: Button;
  private readonly chat: Button;
  /** STRUMENTI DI PROVA, temporanei: al tavolo, prima di «Esci» e della chat. */
  private readonly spawn: Button;
  private readonly flux: Button;
  private room = false;
  private unread = 0;

  constructor(
    private readonly stage: Stage,
    actions: ToolbarActions
  ) {
    this.leave = new Button(stage, { label: t("html.leave"), style: "metal", h: 34, onTap: () => actions.leave() });
    this.chat = new Button(stage, { label: t("html.chat"), style: "plate", font: FONT_BASE, h: 34, onTap: () => actions.chat() });
    this.spawn = new Button(stage, { label: t("hud.spawn"), style: "plate", font: FONT_BASE, h: 34, onTap: () => actions.spawn?.() });
    this.flux = new Button(stage, { label: t("hud.flux.more"), style: "plate", font: FONT_BASE, h: 34, onTap: () => actions.flux?.() });
    this.spawn.visible = false;
    this.flux.visible = false;
    this.stone.eventMode = "none";
    this.light.eventMode = "none";
    void loadImage(STONE).then(image => {
      this.stone.texture = Texture.from(image);
      this.layout();
    });
    this.leave.visible = false;
    this.chat.visible = false;
    this.statusDot.visible = false;
    // Il vetro prende i click: sotto la barra non si tocca il tavolo.
    this.background.eventMode = "static";
    this.brand.addChild(this.brandSprite);
    this.brand.eventMode = "static";
    this.brand.cursor = "pointer";
    this.brand.on("pointerover", () => this.brandTextures && (this.brandSprite.texture = this.brandTextures.light));
    this.brand.on("pointerout", () => this.brandTextures && (this.brandSprite.texture = this.brandTextures.base));
    this.brand.on("pointertap", () => {
      playSound("button");
      actions.home();
    });
    this.rotateTo.anchor.set(0.5);
    this.rotateTo.tint = hex(MUTED);
    this.gear.addChild(this.rotateTo);
    this.gear.eventMode = "static";
    this.gear.cursor = "pointer";
    this.gear.hitArea = new Rectangle(-16, -16, 32, 32);
    // Al passaggio l'ingranaggio si scurisce e gira di 45° (.25s).
    let spin = 0;
    const spinTo = (to: number): void => {
      const from = this.rotateTo.rotation;
      const run = ++spin;
      void tween(stage.app.ticker, 250, k => run === spin && (this.rotateTo.rotation = from + (to - from) * k), ease);
    };
    this.gear.on("pointerover", () => {
      this.rotateTo.tint = hex(INK);
      spinTo(Math.PI / 4);
    });
    this.gear.on("pointerout", () => {
      this.rotateTo.tint = hex(MUTED);
      spinTo(0);
    });
    this.gear.on("pointertap", () => {
      playSound("button");
      actions.settings();
    });
    this.glow.eventMode = "none";
    this.root.addChild(this.background, this.stone, this.light, this.glow, this.brand, this.statusDot, this.chat, this.leave, this.flux, this.spawn, this.gear);
    stage.screens.addChild(this.root);
    stage.onLayout(() => this.layout());
  }

  /** Al tavolo (non in home né nei mazzi): «Esci dalla partita»; in stanza anche la chat e la spia. */
  toTable(table: boolean, room: boolean): void {
    this.leave.visible = table;
    this.chat.visible = table && room;
    this.spawn.visible = table;
    this.flux.visible = table;
    this.room = room;
    this.statusDot.visible = table && room;
    this.layout();
  }

  /** La spia della stanza: com'è il filo verso il tavolo. */
  network(status: string): void {
    this.statusDot.clear().circle(0, 0, 5).fill(STATUS_COLORS[status] ?? STATUS_COLORS.offline!);
  }

  /** I messaggi dell'avversario non ancora letti: «Chat · 2». */
  setUnread(n: number): void {
    if (n === this.unread) return;
    this.unread = n;
    this.chat.paintText(n > 0 ? `${t("html.chat")} · ${n}` : t("html.chat"));
    this.layout();
  }

  private layout(): void {
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;
    this.root.position.set(v.x, v.y);
    // La barra del Notte: sotto, il gradiente #171216 → #0c0a0d; sopra, la grana di pietra (256, ripetuta) e la luce in cima.
    this.background
      .clear()
      .rect(0, 0, v.width, TOOLBAR_H)
      .fill(new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: 0x171216 }, { offset: 1, color: 0x0c0a0d }], textureSpace: "local" }))
      .rect(0, TOOLBAR_H - 1, v.width, 1)
      .fill(0xa62640);
    this.stone.width = v.width;
    this.stone.height = TOOLBAR_H - 1;
    this.lightTexture?.destroy(true);
    // La luce in cima (bianco .05 → niente al 40%) e, sotto il filo, le ombre: nero .9 a un pixel, la forgia, la profondità.
    this.lightTexture = paintPiece(v.width, TOOLBAR_H + 40, 1, ctx => {
      ctx.fillStyle = linearGradient(ctx, 180, 0, 0, v.width, TOOLBAR_H, [[0, "rgba(255,255,255,.05)"], [0.4, "rgba(255,255,255,0)"]]);
      ctx.fillRect(0, 0, v.width, TOOLBAR_H - 1);
      ctx.fillStyle = "rgba(0,0,0,.9)";
      ctx.fillRect(0, TOOLBAR_H, v.width, 1);
      ctx.fillStyle = linearGradient(ctx, 180, 0, TOOLBAR_H, v.width, 30, [[0, "rgba(0,0,0,.4)"], [1, "rgba(0,0,0,0)"]]);
      ctx.fillRect(0, TOOLBAR_H + 1, v.width, 30);
      ctx.fillStyle = linearGradient(ctx, 180, 0, TOOLBAR_H, v.width, 18, [[0, "rgba(166,38,64,.3)"], [1, "rgba(166,38,64,0)"]]);
      ctx.fillRect(0, TOOLBAR_H, v.width, 18);
    });
    this.light.texture = this.lightTexture;
    // L'alone sotto la barra: radial-gradient(46% 100% at 12% 0%, rosa della forgia .35, trasparente 70%), alto 9.
    this.glowTex?.destroy(true);
    this.glowTex = paintPiece(v.width, 9, 1, ctx => {
      ctx.save();
      ctx.translate(v.width * 0.12, 0);
      ctx.scale(v.width * 0.46, 9);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      gradient.addColorStop(0, "rgba(255,111,143,.35)");
      gradient.addColorStop(0.7, "rgba(255,111,143,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(-1, 0, 3, 1);
      ctx.restore();
    });
    this.glow.texture = this.glowTex;
    this.glow.position.set(0, TOOLBAR_H);
    this.paintBrand(res);
    this.paintGear(res);
    let right = v.width - 14;
    this.gear.position.set(right - 16, TOOLBAR_H / 2);
    right -= 32 + 14;
    for (const button of [this.leave, this.chat, this.flux, this.spawn]) {
      if (!button.visible) continue;
      button.position.set(right - button.w, (TOOLBAR_H - button.h) / 2);
      right -= button.w + 14;
    }
    this.statusDot.position.set(right - 5, TOOLBAR_H / 2);
    if (!this.room) this.statusDot.visible = false;
  }

  /** Il marchio: la gemma e il nome rubino con la sua luce (più forte al passaggio). */
  private paintBrand(res: number): void {
    const text = "Rubyfront";
    const tw = textWidth(BRAND, text);
    const margin = 26;
    const w = 12 * Math.SQRT2 + 11 + tw;
    const h = TOOLBAR_H;
    const paint = (glow: number, blur: number): Texture =>
      paintPiece(w + 2 * margin, h, res, ctx => {
        const gx = margin + (12 * Math.SQRT2) / 2;
        ctx.save();
        ctx.translate(gx, h / 2);
        ctx.rotate(Math.PI / 4);
        ctx.shadowColor = "rgba(210,74,100,.65)";
        ctx.shadowBlur = 10 * res;
        ctx.fillStyle = "#9e0f34";
        ctx.fillRect(-6, -6, 12, 12);
        ctx.shadowColor = "transparent";
        ctx.strokeStyle = "#e56a86";
        ctx.lineWidth = 1;
        ctx.strokeRect(-5.5, -5.5, 11, 11);
        ctx.restore();
        const { ascent, descent } = fontMetrics(BRAND);
        drawText(
          ctx,
          { kind: "text", text, font: BRAND, color: RUBY, shadows: [{ x: 0, y: 0, blur, color: `rgba(210,74,100,${glow})` }] },
          margin + 12 * Math.SQRT2 + 11,
          (h + ascent - descent) / 2
        );
      });
    this.brandTextures?.base.destroy(true);
    this.brandTextures?.light.destroy(true);
    this.brandTextures = { base: paint(0.6, 16), light: paint(0.9, 22) };
    this.brandSprite.texture = this.brandTextures.base;
    this.brandSprite.position.set(14 - margin, 0);
    this.brand.hitArea = new Rectangle(14, 8, w, h - 16);
  }

  private paintGear(res: number): void {
    const old = this.gearTexture;
    this.gearTexture = paintPiece(16, 16, res, ctx => {
      ctx.scale(16 / 24, 16 / 24);
      ctx.fillStyle = "#ffffff";
      ctx.fill(new Path2D(GEAR));
    });
    this.rotateTo.texture = this.gearTexture;
    old?.destroy(true);
  }
}

export { MUTED };
