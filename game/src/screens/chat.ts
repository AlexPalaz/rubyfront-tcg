// La chat in stanza (simulatore: chat.ts): solo conversazione — le righe
// dei giocatori (kind "chat"), non la cronaca del tavolo, che racconta da
// sé. Un pannello chiaro sotto l'header, a destra, che si apre dal tasto
// «Chat» dell'header; i messaggi dell'avversario arrivati a pannello chiuso
// si contano sul tasto. Si scrive in un <input> vero (ui.ts, Campo). Tema
// «Notte»: la superficie della colonna del simulatore, le righe in banda — la
// tua rubino (--mine-band), i messaggi dell'avversario azzurri (is-chat). Le
// righe vivono nello stato condiviso: arrivano a entrambi e spariscono a
// nuova partita.

import type { Ctx } from "@rubyfront/core/ctx";
import { t } from "@rubyfront/core/i18n";
import { seatLabel } from "@rubyfront/core/state";
import type { Seat } from "@rubyfront/core/types";
import { Container, Graphics, Rectangle, type FederatedWheelEvent } from "pixi.js";
import { totalHeight, drawLines, layout, type Font } from "../card/text";
import type { Stage } from "../stage";
import { CrispSprite, SANS, paintPiece } from "../table/appearance";
import { TOOLBAR_H, TextField, FONT_BASE, INK, LINE, LINE_SOFT, MUTED, SURFACE, Button, hex, slabShadow, placeShadow, paintText } from "./ui";

const W = 340;
const PAD = 12;
const HEAD_H = 44;
const FORM_H = 56;
const ROW_GAP = 5;
const BOLD: Font = { ...FONT_BASE, weight: 700 };
const HEAD: Font = { size: 16, weight: 700, family: SANS, spacing: 1.6, upper: true };
const SHADOW_M = 60;

export class Chat {
  readonly root = new Container({ label: "chat" });
  private readonly panel = new Container({ label: "chat-panel" });
  private readonly lines = new Container({ label: "chat-lines" });
  private readonly mask = new Graphics();
  private readonly field: TextField;
  /** Le righe dipinte l'ultima volta, e i messaggi dell'avversario già letti. */
  private paintedCount = -1;
  private readCount = 0;
  private scroll = 0;
  private rise = 0;
  private logH = 0;

  constructor(
    private readonly stage: Stage,
    private readonly ctx: Ctx,
    private readonly me: Seat,
    private readonly onUnread: (n: number) => void
  ) {
    this.root.visible = false;
    this.field = new TextField(stage, { placeholder: t("chat.placeholder"), maxLength: 400, onEnter: () => this.send() });
    this.lines.mask = this.mask;
    this.root.eventMode = "static";
    this.root.on("wheel", (event: FederatedWheelEvent) => {
      this.scroll = Math.max(0, Math.min(Math.max(0, this.rise - this.logH), this.scroll - event.deltaY / this.stage.visible().scale));
      this.placeLines();
    });
    this.root.addChild(this.panel);
    stage.screens.addChild(this.root);
    stage.onLayout(() => this.root.visible && this.build());
  }

  isOpen(): boolean {
    return this.root.visible;
  }

  toggle(): void {
    if (this.root.visible) this.close();
    else this.open();
  }

  open(): void {
    this.root.visible = true;
    this.scroll = 0;
    this.readCount = this.theirs().length;
    this.onUnread(0);
    this.build();
    this.field.focus();
  }

  close(): void {
    this.root.visible = false;
    this.field.show(false);
  }

  /** Dopo ogni ridisegno del tavolo: le righe nuove, o il conto sul tasto a pannello chiuso. */
  update(): void {
    const theirs = this.theirs().length;
    // A nuova partita la chat si svuota: il conto riparte.
    if (theirs < this.readCount) this.readCount = theirs;
    if (this.root.visible) {
      this.readCount = theirs;
      if (this.messages().length !== this.paintedCount) this.build();
    } else {
      this.onUnread(theirs - this.readCount);
    }
  }

  private messages(): ReturnType<Ctx["state"]>["chat"] {
    return this.ctx.state().chat.filter(entry => entry.kind === "chat");
  }

  private theirs(): ReturnType<Ctx["state"]>["chat"] {
    return this.messages().filter(entry => entry.seat && entry.seat !== this.me);
  }

  private send(): void {
    const text = this.field.value.trim();
    if (!text) return;
    this.field.value = "";
    void this.ctx.dispatch({ t: "say", entry: { id: crypto.randomUUID(), seat: this.me, kind: "chat", text, ts: Date.now() } });
  }

  private build(): void {
    // La maschera e le righe restano (il pannello le riprende): si staccano prima di svuotarlo.
    this.panel.removeChild(this.mask, this.lines);
    for (const child of this.panel.removeChildren()) child.destroy({ children: true });
    for (const child of this.lines.removeChildren()) child.destroy({ children: true });
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;
    const h = Math.min(560, (v.height - TOOLBAR_H) * 0.6);
    const x = v.x + v.width - 10 - W;
    const y = v.y + TOOLBAR_H + 8;
    const shadow = slabShadow([{ x: 0, y: 18, blur: 44, color: "rgba(0,0,0,.6)" }], SHADOW_M);
    placeShadow(shadow, SHADOW_M, x, y, W, h);
    const slab = new Graphics()
      .rect(x, y, W, h)
      .fill(hex(SURFACE))
      .stroke({ color: hex(LINE_SOFT), width: 1, alignment: 1 })
      .rect(x, y + HEAD_H, W, 1)
      .fill(hex(LINE_SOFT))
      .rect(x, y + h - FORM_H, W, 1)
      .fill(hex(LINE));
    slab.eventMode = "static";
    const title = paintText(this.stage, t("html.chat"), HEAD, MUTED);
    title.sprite.position.set(x + PAD, y + (HEAD_H - title.h) / 2);
    const close = new Button(this.stage, { label: "×", style: "thin", font: { ...FONT_BASE, size: 22 }, w: 28, h: 28, onTap: () => this.close() });
    close.position.set(x + W - PAD - 28, y + (HEAD_H - 28) / 2);
    this.panel.addChild(shadow, slab, title.sprite, close, this.mask, this.lines);
    // Le righe, dall'alto; la più nuova in fondo, e il fondo in vista.
    const top = y + HEAD_H + 10;
    this.logH = h - HEAD_H - FORM_H - 20;
    this.mask.clear().rect(x, top, W, this.logH).fill(0xffffff);
    let ry = 0;
    const rowW = W - 2 * PAD;
    const messages = this.messages();
    for (const entry of messages) {
      const pieces = [
        ...(entry.seat ? [{ kind: "text" as const, text: `${seatLabel(this.ctx.state(), entry.seat, this.me)}: `, font: BOLD, color: entry.seat === this.me ? "#ffb3c2" : "#9fdcff" }] : []),
        { kind: "text" as const, text: entry.text ?? "", font: FONT_BASE, color: INK },
      ];
      const lines = layout(pieces, rowW - 11 - 8, { font: FONT_BASE, lineHeight: 16 * 1.4 });
      const lh = Math.ceil(totalHeight(lines)) + 6;
      const mine = entry.seat === this.me;
      const texture = paintPiece(rowW, lh, res, c => {
        // Chi scrive si vede dal colore: la tua banda rubino (.is-me del Notte), i messaggi dell'avversario azzurri (.is-them.is-chat).
        c.fillStyle = mine ? "rgba(200,38,76,.3)" : "rgba(38,108,158,.32)";
        c.fillRect(0, 0, rowW, lh);
        c.fillStyle = mine ? "#ff6f8f" : "#56b6e6";
        c.fillRect(0, 0, 3, lh);
        drawLines(c, lines, 11, 3);
      });
      const row = new CrispSprite(texture);
      row.on("destroyed", () => texture.destroy(true));
      row.position.set(x + PAD, top + ry);
      this.lines.addChild(row);
      ry += lh + ROW_GAP;
    }
    this.rise = Math.max(0, ry - ROW_GAP);
    this.lines.pivot.set(0, 0);
    this.placeLines();
    this.paintedCount = messages.length;
    // Il modulo: il campo e «Invia».
    const send = new Button(this.stage, { label: t("chat.send"), style: "plate", font: FONT_BASE, h: 36, onTap: () => this.send() });
    const fy = y + h - FORM_H + (FORM_H - 36) / 2;
    send.position.set(x + W - PAD - send.w, fy);
    this.panel.addChild(send);
    this.field.place(x + PAD, fy, W - 2 * PAD - send.w - 6, 36);
    this.field.show(true);
    this.panel.hitArea = new Rectangle(x, y, W, h);
  }

  /** Lo scorrimento parte dal fondo: `scorri` è quanto si è risaliti. */
  private placeLines(): void {
    const excess = Math.max(0, this.rise - this.logH);
    this.lines.y = -(excess - Math.min(this.scroll, excess));
  }
}
