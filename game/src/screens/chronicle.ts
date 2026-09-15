// La cronaca degli avvisi (dal 2026-09-15, «addirittura farei in modo di
// avere una history di quegli avvisi… pulsante in header»): le righe di log
// che sono avvisi del tavolo (core/log.ts, isNotice) — gli effetti risolti,
// le carte tornate in mano, gli Oggetti in Ritiro, i tiri a vuoto — raccolte
// in un pannello sotto l'header, a destra, come la chat: si apre dal tasto
// «Cronaca», la più nuova in fondo, e gli avvisi arrivati a pannello chiuso
// si contano sul tasto. Ogni riga nella lingua di chi legge (renderLog), con
// l'ora e il nome del posto; i nomi delle carte in grassetto. Le righe
// vivono nello stato condiviso: uguali per entrambi, via a nuova partita.

import { cardName } from "@rubyfront/core/cards";
import type { Ctx } from "@rubyfront/core/ctx";
import { t } from "@rubyfront/core/i18n";
import { isNotice, renderLog } from "@rubyfront/core/log";
import { seatLabel } from "@rubyfront/core/state";
import type { ChatEntry, Seat } from "@rubyfront/core/types";
import { Container, Graphics, Rectangle, type FederatedWheelEvent } from "pixi.js";
import { totalHeight, drawLines, layout, type Font, type Piece } from "../card/text";
import type { Stage } from "../stage";
import { CrispSprite, SANS, paintPiece } from "../table/appearance";
import { TOOLBAR_H, FONT_BASE, INK, LINE_SOFT, MUTED, SURFACE, Button, hex, slabShadow, placeShadow, paintText } from "./ui";

const W = 400;
const PAD = 12;
const HEAD_H = 44;
const ROW_GAP = 6;
const BOLD: Font = { ...FONT_BASE, weight: 700 };
const HEAD: Font = { size: 16, weight: 700, family: SANS, spacing: 1.6, upper: true };
const TAG: Font = { size: 11, weight: 700, family: SANS, spacing: 11 * 0.14, upper: true };
const SHADOW_M = 60;

/** Il testo di un avviso a pezzi: i nomi fra «» in grassetto, il resto normale. */
export function noticePieces(text: string, body: Font, bold: Font, ink: string, name: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const match of text.matchAll(/«[^»]*»/g)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at), font: body, color: ink });
    out.push({ kind: "text", text: match[0], font: bold, color: name });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last), font: body, color: ink });
  return out;
}

/** Il testo senza il «Posto: » in testa: il posto sta già nel cappello della targhetta e nell'etichetta della riga. */
export function withoutSeat(text: string, label: string): string {
  const prefix = `${label}: `;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

export class Chronicle {
  readonly root = new Container({ label: "chronicle" });
  private readonly panel = new Container({ label: "chronicle-panel" });
  private readonly lines = new Container({ label: "chronicle-lines" });
  private readonly mask = new Graphics();
  private paintedCount = -1;
  private readCount = 0;
  private scroll = 0;
  private rise = 0;
  private logH = 0;

  constructor(
    private readonly stage: Stage,
    private readonly ctx: Ctx,
    private readonly me: Seat,
    private readonly locale: string,
    private readonly onUnread: (n: number) => void
  ) {
    this.root.visible = false;
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
    this.readCount = this.notices().length;
    this.onUnread(0);
    this.build();
  }

  close(): void {
    this.root.visible = false;
  }

  /** Dopo ogni ridisegno del tavolo: le righe nuove, o il conto sul tasto a pannello chiuso. */
  update(): void {
    const count = this.notices().length;
    // A nuova partita la cronaca si svuota: il conto riparte.
    if (count < this.readCount) this.readCount = count;
    if (this.root.visible) {
      this.readCount = count;
      if (count !== this.paintedCount) this.build();
    } else {
      this.onUnread(count - this.readCount);
    }
  }

  private notices(): ChatEntry[] {
    return this.ctx.state().chat.filter(entry => entry.kind === "log" && entry.key !== undefined && isNotice(entry.key));
  }

  private textOf(entry: ChatEntry): string {
    return entry.key ? renderLog({ key: entry.key, ...(entry.params ? { params: entry.params } : {}) }, this.ctx.state(), id => cardName(id, this.locale)) : entry.text;
  }

  private build(): void {
    this.panel.removeChild(this.mask, this.lines);
    for (const child of this.panel.removeChildren()) child.destroy({ children: true });
    for (const child of this.lines.removeChildren()) child.destroy({ children: true });
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;
    const h = Math.min(620, (v.height - TOOLBAR_H) * 0.7);
    const x = v.x + v.width - 10 - W;
    const y = v.y + TOOLBAR_H + 8;
    const shadow = slabShadow([{ x: 0, y: 18, blur: 44, color: "rgba(0,0,0,.6)" }], SHADOW_M);
    placeShadow(shadow, SHADOW_M, x, y, W, h);
    const slab = new Graphics()
      .rect(x, y, W, h)
      .fill(hex(SURFACE))
      .stroke({ color: hex(LINE_SOFT), width: 1, alignment: 1 })
      .rect(x, y + HEAD_H, W, 1)
      .fill(hex(LINE_SOFT));
    slab.eventMode = "static";
    const title = paintText(this.stage, t("html.chronicle"), HEAD, MUTED);
    title.sprite.position.set(x + PAD, y + (HEAD_H - title.h) / 2);
    const close = new Button(this.stage, { label: "×", style: "thin", font: { ...FONT_BASE, size: 22 }, w: 28, h: 28, onTap: () => this.close() });
    close.position.set(x + W - PAD - 28, y + (HEAD_H - 28) / 2);
    this.panel.addChild(shadow, slab, title.sprite, close, this.mask, this.lines);
    const top = y + HEAD_H + 10;
    this.logH = h - HEAD_H - 20;
    this.mask.clear().rect(x, top, W, this.logH).fill(0xffffff);
    let ry = 0;
    const rowW = W - 2 * PAD;
    const notices = this.notices();
    if (notices.length === 0) {
      const empty = layout([{ kind: "text", text: t("chronicle.empty"), font: FONT_BASE, color: MUTED }], rowW, { font: FONT_BASE, lineHeight: 16 * 1.4 });
      const eh = Math.ceil(totalHeight(empty)) + 8;
      const texture = paintPiece(rowW, eh, res, c => drawLines(c, empty, 0, 4));
      const row = new CrispSprite(texture);
      row.on("destroyed", () => texture.destroy(true));
      row.position.set(x + PAD, top);
      this.lines.addChild(row);
      ry = eh;
    }
    for (const entry of notices) {
      const when = new Date(entry.ts);
      const tag = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}${entry.seat ? ` · ${seatLabel(this.ctx.state(), entry.seat, this.me)}` : ""}`;
      const text = entry.seat ? withoutSeat(this.textOf(entry), seatLabel(this.ctx.state(), entry.seat, this.me)) : this.textOf(entry);
      const lines = layout(noticePieces(text, FONT_BASE, BOLD, INK, "#ffd6de"), rowW - 11 - 8, { font: FONT_BASE, lineHeight: 16 * 1.4 });
      const tagH = 16;
      const lh = tagH + Math.ceil(totalHeight(lines)) + 8;
      const mine = entry.seat === this.me;
      const texture = paintPiece(rowW, lh, res, c => {
        c.fillStyle = "rgba(28,23,30,.9)";
        c.fillRect(0, 0, rowW, lh);
        c.fillStyle = mine ? "#ff6f8f" : "#56b6e6";
        c.fillRect(0, 0, 3, lh);
        const tagLines = layout([{ kind: "text", text: tag, font: TAG, color: MUTED }], rowW - 19, { font: TAG, lineHeight: tagH });
        drawLines(c, tagLines, 11, 3);
        drawLines(c, lines, 11, tagH + 3);
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
    this.paintedCount = notices.length;
    this.panel.hitArea = new Rectangle(x, y, W, h);
  }

  private placeLines(): void {
    const excess = Math.max(0, this.rise - this.logH);
    this.lines.y = -(excess - Math.min(this.scroll, excess));
  }
}
