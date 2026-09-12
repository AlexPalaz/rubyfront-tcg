// I mazzi, per chi gioca (simulatore: src/mazzi.ts, style.css «mazzi»): la
// vista che si apre dalla carta «Mazzi» della home. I mazzi pronti, uno per
// stampa — il Rubyfront in copertina (72% della carta vera), il nome, la
// composizione — con due gesti: giocarci subito contro il bot, o sfogliarne
// le carte, a tessera (302×424, come al tavolo), con l'ingrandimento al
// passaggio (table/preview.ts: questa vista ne è una fonte). Scorre con
// la rotella: quaranta tessere non stanno in una schermata. Tema scuro: il
// fondo della pagina, le stampe sul pannello col filo della linea.

import { allDecks, cardStats, faceCount, isRubyfront, type CatalogDeck } from "@rubyfront/core/cards";
import { t } from "@rubyfront/core/i18n";
import { Container, Graphics, Sprite, type FederatedWheelEvent } from "pixi.js";
import { drawText, fontMetrics, textWidth, type Font } from "../card/text";
import { CARD_H, CARD_W } from "../card/theme";
import type { Stage } from "../stage";
import { SANS, paintPiece } from "../table/appearance";
import { TableCard } from "../table/card";
import type { PreviewSource } from "../table/preview";
import { BG, ACTION_EDGE, FONT_BASE, INK, LINE, LINE_SOFT, MUTED, PANEL, ACTION_LABEL, Button, areaBelow, hex, slabShadow, placeShadow, paintText } from "./ui";

const TILE_W = 302;
const TILE_H = 424;
const COVER = 0.72;
const PAD = 18;
const TILE_GAP = 14;
const SHADOW_M = 60;
const TITLE: Font = { size: 25.6, weight: 700, family: SANS, spacing: 2.56, upper: true };
const NAME: Font = { size: 24, weight: 700, family: SANS, spacing: 1.92, upper: true };
const BUTTON: Font = { size: 16, weight: 600, family: SANS, spacing: 1.28, upper: true };
const FACTS: Font = { ...FONT_BASE, spacing: 0.48 };
const COPIES: Font = { size: 16, weight: 700, family: SANS };

/** L'ordine con cui si sfogliano le carte: prima il Rubyfront, poi Entità, Materie, Oggetti, dentro ogni gruppo per costo. */
const KIND_ORDER: Record<string, number> = { rubyfront: 0, entity: 1, matter: 2, object: 3 };

type CardEvent = { type: "over" | "out"; uid: string };

export class DeckBrowser implements PreviewSource {
  readonly root = new Container({ label: "decks" });
  private readonly background = new Graphics();
  private readonly content = new Container({ label: "decks-content" });
  private readonly mask = new Graphics();
  private readonly listeners: ((cardEvent: CardEvent) => void)[] = [];
  private readonly info = new Map<string, { cardId: string; face: number; back: boolean }>();
  private readonly tiles = new Map<string, Container>();
  private readonly expanded = new Set<string>();
  private scroll = 0;
  private rise = 0;
  private areaH = 0;

  constructor(
    private readonly stage: Stage,
    private readonly locale: string,
    private readonly onPlay: (deckId: string) => void,
    private readonly onClose: () => void
  ) {
    this.root.visible = false;
    // La vista copre la home: i click restano qui.
    this.background.eventMode = "static";
    this.content.mask = this.mask;
    this.root.addChild(this.background, this.mask, this.content);
    this.root.eventMode = "static";
    this.root.on("wheel", (event: FederatedWheelEvent) => this.wheel(event.deltaY));
    stage.screens.addChild(this.root);
    stage.onLayout(() => this.root.visible && this.build());
  }

  isOpen(): boolean {
    return this.root.visible;
  }

  open(): void {
    this.root.visible = true;
    this.scroll = 0;
    this.build();
  }

  close(): void {
    if (!this.root.visible) return;
    this.root.visible = false;
    this.emit({ type: "out", uid: "" });
    this.clearAll();
  }

  onCard(listener: (cardEvent: CardEvent) => void): void {
    this.listeners.push(listener);
  }

  cardInfo(uid: string): { cardId: string; face: number; back: boolean } | undefined {
    return this.info.get(uid);
  }

  screenBox(uid: string): { x: number; y: number; width: number; height: number } | undefined {
    const tile = this.tiles.get(uid);
    if (!tile || tile.destroyed) return undefined;
    const box = tile.getBounds();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }

  private emit(cardEvent: CardEvent): void {
    for (const listener of this.listeners) listener(cardEvent);
  }

  private wheel(deltaY: number): void {
    const scale = this.stage.visible().scale;
    this.scroll = Math.max(0, Math.min(Math.max(0, this.rise - this.areaH), this.scroll + deltaY / scale));
    this.content.y = -this.scroll;
  }

  private clearAll(): void {
    for (const child of this.content.removeChildren()) child.destroy({ children: true });
    this.tiles.clear();
    this.info.clear();
  }

  private build(): void {
    this.clearAll();
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;
    const area = areaBelow(v);
    this.areaH = area.h;
    this.background.clear().rect(area.x, area.y, area.w, area.h).fill(hex(BG));
    this.mask.clear().rect(area.x, area.y, area.w, area.h).fill(0xffffff);
    const width = Math.min(area.w - 80, 1560);
    const x0 = area.x + (area.w - width) / 2;
    let y = area.y + 22;
    // La testata: «← Home» a sinistra, il titolo e la frase accanto.
    const back = new Button(this.stage, {
      label: t("decks.back"),
      style: "plate",
      font: BUTTON,
      h: 36,
      onTap: () => {
        this.close();
        this.onClose();
      },
    });
    back.position.set(x0, y);
    const title = paintText(this.stage, t("decks.title"), TITLE, INK);
    const lead = paintText(this.stage, t("decks.lead"), FONT_BASE, MUTED, { maxW: width - back.w - 22 });
    title.sprite.position.set(x0 + back.w + 22, y);
    lead.sprite.position.set(x0 + back.w + 22, y + title.h + 4);
    this.content.addChild(back, title.sprite, lead.sprite);
    y += Math.max(back.h, title.h + 4 + lead.h) + 22;
    for (const deck of allDecks()) y = this.deckPrint(deck, x0, y, width, res) + 22;
    this.rise = y - 22 + 40 - area.y;
    this.scroll = Math.min(this.scroll, Math.max(0, this.rise - this.areaH));
    this.content.y = -this.scroll;
  }

  /** Una stampa: copertina, nome, composizione, gesti; sotto, se aperte, le carte. Torna il fondo della stampa. */
  private deckPrint(deck: CatalogDeck, x: number, y: number, width: number, res: number): number {
    const words = deck.locales[this.locale] ?? deck.locales[deck.defaultLocale];
    const rubyfront = deck.cards.find(entry => isRubyfront(entry.card))?.card ?? null;
    const print = new Container({ label: `deck:${deck.id}` });
    print.position.set(x, y);
    const coverW = CARD_W * COVER;
    const coverH = CARD_H * COVER;
    const bodyX = PAD + coverW + 28;
    const bodyW = width - bodyX - PAD;
    const items: Container[] = [];
    if (rubyfront) items.push(this.tile(`${deck.id}|cover`, rubyfront, 0, coverW, coverH, PAD, PAD, 0, res));
    let by = PAD + 6;
    const name = paintText(this.stage, words?.name ?? deck.id, NAME, INK, { maxW: bodyW });
    name.sprite.position.set(bodyX, by);
    by += name.h + 12;
    const facts = paintText(this.stage, this.composition(deck), FACTS, MUTED, { maxW: bodyW });
    facts.sprite.position.set(bodyX, by);
    by += facts.h + 12 + 6;
    const isOpen = this.expanded.has(deck.id);
    // .mazzi-play nel Notte: la piastra, col filo e la scritta del rubino.
    const play = new Button(this.stage, { label: t("decks.play"), style: "plate", edge: ACTION_EDGE, color: ACTION_LABEL, h: 44, onTap: () => this.onPlay(deck.id) });
    const browse = new Button(this.stage, {
      label: t(isOpen ? "decks.browse.close" : "decks.browse"),
      style: "plate",
      font: BUTTON,
      h: 44,
      onTap: () => {
        if (isOpen) this.expanded.delete(deck.id);
        else this.expanded.add(deck.id);
        this.build();
      },
    });
    play.position.set(bodyX, by);
    if (play.w + 10 + browse.w <= bodyW) browse.position.set(bodyX + play.w + 10, by);
    else {
      by += 44 + 10;
      browse.position.set(bodyX, by);
    }
    by += 44;
    items.push(name.sprite, facts.sprite, play, browse);
    let bottom = Math.max(PAD + coverH, by);
    if (isOpen) {
      bottom += 20;
      const edge = new Graphics().rect(PAD, bottom, width - 2 * PAD, 1).fill(hex(LINE_SOFT));
      items.push(edge);
      bottom += 1 + 20;
      const cols = Math.max(1, Math.floor((width - 2 * PAD + TILE_GAP) / (TILE_W + TILE_GAP)));
      let index = 0;
      for (const entry of this.sorted(deck)) {
        const faces = faceCount(entry.card);
        for (let face = 0; face < faces; face += 1) {
          const tx = PAD + (index % cols) * (TILE_W + TILE_GAP);
          const ty = bottom + Math.floor(index / cols) * (TILE_H + TILE_GAP);
          items.push(this.tile(`${deck.id}|${entry.card}|${face}`, entry.card, face, TILE_W, TILE_H, tx, ty, face === 0 ? entry.count : 0, res));
          index += 1;
        }
      }
      bottom += Math.ceil(index / cols) * (TILE_H + TILE_GAP) - TILE_GAP;
    }
    const h = bottom + PAD;
    const shadow = slabShadow([{ x: 0, y: 14, blur: 34, color: "rgba(0,0,0,.25)" }], SHADOW_M);
    placeShadow(shadow, SHADOW_M, 0, 0, width, h);
    const slab = new Graphics().rect(0, 0, width, h).fill(hex(PANEL)).stroke({ color: hex(LINE), width: 1, alignment: 1 });
    print.addChild(shadow, slab, ...items);
    this.content.addChild(print);
    return y + h;
  }

  /** Una tessera: la carta a misura, le copie in basso a destra, l'ingrandimento al passaggio. */
  private tile(uid: string, cardId: string, face: number, w: number, h: number, x: number, y: number, copies: number, res: number): Container {
    const tile = new TableCard(uid);
    tile.update({ cardId, face, back: false, tapped: false, w, h, locale: this.locale, resolution: res, badges: null, combat: null });
    tile.position.set(x + w / 2, y + h / 2);
    tile.eventMode = "static";
    tile.on("pointerenter", () => this.emit({ type: "over", uid }));
    tile.on("pointerleave", () => this.emit({ type: "out", uid }));
    this.info.set(uid, { cardId, face, back: false });
    this.tiles.set(uid, tile);
    if (copies <= 1) return tile;
    const group = new Container();
    group.addChild(tile);
    const text = `×${copies}`;
    const bw = Math.ceil(textWidth(COPIES, text)) + 16 + 2;
    const bh = Math.ceil(16 * 1.2) + 4 + 2;
    const texture = paintPiece(bw, bh, res, ctx => {
      ctx.beginPath();
      ctx.roundRect(0.5, 0.5, bw - 1, bh - 1, bh / 2);
      ctx.fillStyle = "#9e0f34";
      ctx.fill();
      ctx.strokeStyle = "#e56a86";
      ctx.lineWidth = 1;
      ctx.stroke();
      const { ascent, descent } = fontMetrics(COPIES);
      drawText(ctx, { kind: "text", text, font: COPIES, color: "#fdeef1" }, 9, (bh + ascent - descent) / 2);
    });
    const badge = new Sprite(texture);
    badge.eventMode = "none";
    badge.on("destroyed", () => texture.destroy(true));
    badge.position.set(x + w - 10 - bw, y + h - 10 - bh);
    group.addChild(badge);
    return group;
  }

  private sorted(deck: CatalogDeck): CatalogDeck["cards"] {
    return [...deck.cards].sort((a, b) => {
      const sa = cardStats(a.card);
      const sb = cardStats(b.card);
      const ka = KIND_ORDER[sa.kind ?? ""] ?? 9;
      const kb = KIND_ORDER[sb.kind ?? ""] ?? 9;
      if (ka !== kb) return ka - kb;
      return (sa.fluxCost ?? 0) - (sb.fluxCost ?? 0) || a.card.localeCompare(b.card);
    });
  }

  /** «40 carte più il Rubyfront · 22 Entità · 14 Materie · 4 Oggetti». */
  private composition(deck: CatalogDeck): string {
    const counts = { entity: 0, matter: 0, object: 0 };
    let total = 0;
    for (const entry of deck.cards) {
      const kind = cardStats(entry.card).kind;
      if (kind === "entity" || kind === "matter" || kind === "object") {
        counts[kind] += entry.count;
        total += entry.count;
      }
    }
    return t("decks.facts", { total, entity: counts.entity, matter: counts.matter, object: counts.object });
  }
}
