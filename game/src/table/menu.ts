// Il menu di una carta (simulatore/src/menu.ts): ciò che si fa a una carta
// senza trascinarla — tasto destro, o pressione lunga. Le voci le dà il core
// (tabs.ts, cardMenu); qui un pannello del tema chiaro che resta dentro la
// finestra, sceglie al tocco e si chiude al primo tocco fuori (che vale
// comunque per ciò che sta sotto) o con Esc. Il passaggio accende la voce
// di una velatura rubino: il rubino cupo pieno del simulatore, sul chiaro,
// lascerebbe il testo scuro su fondo scuro.

import { Container, Graphics, Point, Rectangle, Sprite, type Texture } from "pixi.js";
import { drawText, fontMetrics, textWidth, type Font } from "../card/text";
import type { Stage } from "../stage";
import { SANS, paintPiece, withShadow } from "./appearance";
import { NIGHT, plate } from "./night";

export interface MenuItem {
  label: string;
  run?: () => void;
  disabled?: boolean;
  /** Riga di separazione: label ignorata. */
  rule?: boolean;
}

const FONT: Font = { size: 16, weight: 400, family: SANS };
/** .menu button: padding 7px 10px su una riga di 16. */
const ITEM_H = 7 + 20 + 7;
/** .menu hr: margin 5px 2px, filo di 1. */
const RULE_H = 5 + 1 + 5;
const PAD = 5;
const MIN_W = 190;
/** Il margine attorno al pannello per la sua ombra (0 16px 36px). */
const MARGIN = 60;

export class Menu {
  private readonly layer = new Container({ label: "menu" });
  private opened: { root: Container; textures: Texture[]; box: Rectangle; dismiss: (event: PointerEvent) => void } | null = null;

  constructor(private readonly stage: Stage) {
    stage.world.addChild(this.layer);
    window.addEventListener("keydown", event => {
      if (event.key === "Escape") this.close();
    });
  }

  isOpen(): boolean {
    return this.opened !== null;
  }

  /** Apre il menu con l'angolo in (x, y), in unità di progetto; vicino ai bordi si apre verso l'interno. */
  open(x: number, y: number, items: MenuItem[]): void {
    this.close();
    if (!items.some(item => !item.rule)) return;
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;
    const innerW = Math.max(MIN_W - 2 * PAD - 2, ...items.filter(item => !item.rule).map(item => Math.ceil(textWidth(FONT, item.label)) + 20));
    const w = innerW + 2 * PAD + 2;
    const tops: number[] = [];
    let h = 1 + PAD;
    for (const item of items) {
      tops.push(h);
      h += item.rule ? RULE_H : ITEM_H;
    }
    h += PAD + 1;
    const left = Math.min(x, v.x + v.width - w - 8);
    const top = Math.min(y, v.y + v.height - h - 8);
    const { ascent, descent } = fontMetrics(FONT);

    // Sul Notte il pannello è --panel-2 col filo --line, e ogni voce è una
    // piastra brunita (:where(button…)); il passaggio la accende di
    // --ruby-deep, sotto la scritta: fondo, luce, scritte, in quest'ordine.
    const background = paintPiece(w + 2 * MARGIN, h + 2 * MARGIN, res, ctx => {
      ctx.translate(MARGIN, MARGIN);
      withShadow(ctx, res, { x: 0, y: 16, blur: 36, color: "rgba(0,0,0,.6)" }, () => {
        ctx.fillStyle = NIGHT.panel2;
        ctx.fillRect(0, 0, w, h);
      });
      ctx.fillStyle = NIGHT.panel2;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = NIGHT.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      items.forEach((item, index) => {
        if (item.rule) {
          ctx.fillStyle = NIGHT.line;
          ctx.fillRect(1 + PAD + 2, tops[index] + 5, innerW - 4, 1);
          return;
        }
        ctx.save();
        if (item.disabled) ctx.globalAlpha = 0.38;
        plate(ctx, 1 + PAD, tops[index], innerW, ITEM_H, null);
        ctx.restore();
      });
    });
    const labels = paintPiece(w, h, res, ctx => {
      items.forEach((item, index) => {
        if (item.rule) return;
        ctx.save();
        if (item.disabled) ctx.globalAlpha = 0.38;
        drawText(ctx, { kind: "text", text: item.label, font: FONT, color: NIGHT.ink }, 1 + PAD + 10, tops[index] + (ITEM_H + ascent - descent) / 2);
        ctx.restore();
      });
    });

    const root = new Container({ label: "open-menu" });
    const sprite = new Sprite(background);
    sprite.position.set(left - MARGIN, top - MARGIN);
    const light = new Graphics();
    light.eventMode = "none";
    const text = new Sprite(labels);
    text.position.set(left, top);
    text.eventMode = "none";
    root.addChild(sprite, light, text);
    items.forEach((item, index) => {
      if (item.rule || item.disabled) return;
      const hit = new Container({ label: "item" });
      hit.eventMode = "static";
      hit.cursor = "pointer";
      hit.hitArea = new Rectangle(left + 1 + PAD, top + tops[index], innerW, ITEM_H);
      hit.on("pointerover", () => light.clear().rect(left + 1 + PAD, top + tops[index], innerW, ITEM_H).fill(0xa62640));
      hit.on("pointerout", () => light.clear());
      hit.on("pointertap", () => {
        this.close();
        item.run?.();
      });
      root.addChild(hit);
    });
    const box = new Rectangle(left, top, w, h);
    // Il primo tocco fuori chiude il menu, e vale comunque per ciò che sta sotto.
    const dismiss = (event: PointerEvent): void => {
      const rect = this.stage.app.canvas.getBoundingClientRect();
      const point = this.stage.world.toLocal(new Point(event.clientX - rect.left, event.clientY - rect.top));
      if (!box.contains(point.x, point.y)) this.close();
    };
    window.addEventListener("pointerdown", dismiss, true);
    this.layer.addChild(root);
    this.layer.parent?.addChild(this.layer);
    this.opened = { root, textures: [background, labels], box, dismiss };
  }

  close(): void {
    const opened = this.opened;
    if (!opened) return;
    this.opened = null;
    window.removeEventListener("pointerdown", opened.dismiss, true);
    opened.root.destroy({ children: true });
    for (const texture of opened.textures) texture.destroy(true);
  }
}
