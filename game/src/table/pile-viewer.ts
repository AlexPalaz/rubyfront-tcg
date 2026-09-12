// La vetrina (simulatore/src/overlay.ts): la scelta di una carta da una pila,
// o dalla mano, per un effetto (§8.2) — e lo sfogliare una pila pubblica
// (§5: l'Abisso e la Zona di Ritiro si consultano in ogni momento), dove le
// carte si guardano e basta. Le carte in vista
// in griglia, a misura di tessera (302×424); quelle che non si possono
// scegliere restano velate, come la carta che non ci si può permettere. Un
// tocco sceglie; Chiudi, Esc o il velo fuori dal pannello rinunciano (null).
// La ricerca per nome del simulatore qui non c'è: le carte di una scelta sono
// poche. Se non ci stanno, la rotella scorre la griglia.

import { t } from "@rubyfront/core/i18n";
import type { CardInstance } from "@rubyfront/core/types";
import { Container, Graphics, Rectangle } from "pixi.js";
import { totalHeight, drawLines, drawText, fontMetrics, layout, textWidth, type Font } from "../card/text";
import type { Stage } from "../stage";
import { CrispSprite, SANS, paintPiece } from "./appearance";
import { TableCard } from "./card";
import { NIGHT, VEIL_OVERLAY, plate } from "./night";

const TILE_W = 302;
const TILE_H = 424;
/** .overlay-grid: gap 34px 18px, padding 20px. */
const GAP_X = 18;
const GAP_Y = 34;
const PAD = 20;
// Il tema notte (style.css, .overlay e .overlay-panel sul Notte).
const INK = NIGHT.ink;
const LINE = NIGHT.line;
const TITLE: Font = { size: 16, weight: 700, family: SANS };
const BUTTON: Font = { size: 16, weight: 400, family: SANS };

export class PileViewer {
  private readonly layer = new Container({ label: "pile-viewers" });
  private close: ((card: CardInstance | null) => void) | null = null;
  /** Aperta per scegliere (trattiene il bot) o per sfogliare (no). */
  private mode: "choice" | "browse" | null = null;

  constructor(
    private readonly stage: Stage,
    private readonly locale: string
  ) {
    stage.world.addChild(this.layer);
    window.addEventListener("keydown", event => {
      if (event.key === "Escape") this.close?.(null);
    });
  }

  isOpen(): boolean {
    return this.close !== null;
  }

  /** Aperta per una scelta: il tavolo aspetta il giocatore. */
  isPicking(): boolean {
    return this.mode === "choice";
  }

  /** La carta scelta fra i candidati, mostrando `visible` (di norma i candidati stessi). */
  choose(candidates: CardInstance[], title: string, visible?: CardInstance[]): Promise<CardInstance | null> {
    return this.show(visible ?? candidates, title, new Set(candidates.map(card => card.uid)));
  }

  /** Sfogliare una pila: le carte si guardano, nessuna si sceglie. */
  browse(title: string, cards: CardInstance[]): Promise<void> {
    return this.show(cards, title, null).then(() => undefined);
  }

  private show(cards: CardInstance[], title: string, pickable: Set<string> | null): Promise<CardInstance | null> {
    this.close?.(null);
    this.mode = pickable ? "choice" : "browse";
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;

    const pw = Math.min(1500, v.width * 0.94);
    const ph = Math.min(v.height * 0.92, 1100);
    const px = v.x + (v.width - pw) / 2;
    const py = v.y + (v.height - ph) / 2;

    // La testata: il titolo a sinistra, Chiudi a destra.
    const closeLabel = t("overlay.close");
    const closeW = Math.ceil(textWidth(BUTTON, closeLabel)) + 20 + 2;
    const closeH = 32;
    const titleLines = layout([{ kind: "text", text: title, font: TITLE, color: INK }], pw - 32 - closeW - 12, { font: TITLE, lineHeight: 20 });
    const headH = 12 + Math.max(totalHeight(titleLines), closeH) + 12 + 1;
    const { ascent, descent } = fontMetrics(BUTTON);
    const panel = paintPiece(pw, ph, res, ctx => {
      ctx.fillStyle = NIGHT.panel;
      ctx.fillRect(0, 0, pw, ph);
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, pw - 1, ph - 1);
      ctx.fillStyle = LINE;
      ctx.fillRect(0, headH - 1, pw, 1);
      drawLines(ctx, titleLines, 16, (headH - 1 - totalHeight(titleLines)) / 2);
      const bx = pw - 16 - closeW;
      const by = (headH - 1 - closeH) / 2;
      // «Chiudi» è un tasto: sul Notte la piastra brunita col filo --line.
      plate(ctx, bx, by, closeW, closeH, LINE);
      drawText(ctx, { kind: "text", text: closeLabel, font: BUTTON, color: INK }, bx + 11, by + (closeH + ascent - descent) / 2);
      if (cards.length === 0) {
        const empty = t("overlay.empty");
        drawText(ctx, { kind: "text", text: empty, font: BUTTON, color: NIGHT.muted }, (pw - textWidth(BUTTON, empty)) / 2, headH + 40 + 16);
      }
    });

    const root = new Container({ label: "pile-viewer" });
    const veil = new Graphics().rect(v.x, v.y, v.width, v.height).fill(VEIL_OVERLAY);
    veil.eventMode = "static";
    const panelSprite = new CrispSprite(panel);
    panelSprite.position.set(px, py);
    // Il pannello si prende i suoi click: solo il velo fuori rinuncia.
    panelSprite.eventMode = "static";
    const closeButton = new Container({ label: "close" });
    closeButton.eventMode = "static";
    closeButton.cursor = "pointer";
    closeButton.hitArea = new Rectangle(px + pw - 16 - closeW, py + (headH - 1 - closeH) / 2, closeW, closeH);

    // La griglia: colonne di tessere centrate, sotto la testata, con la sua maschera.
    const gridTop = py + headH;
    const gridH = ph - headH - 1;
    const cols = Math.max(1, Math.floor((pw - 2 * PAD + GAP_X) / (TILE_W + GAP_X)));
    // Come la griglia del simulatore (auto-fill, centrata): le colonne ci sono tutte, le carte partono dalla prima.
    const rowW = cols * (TILE_W + GAP_X) - GAP_X;
    const left = px + (pw - rowW) / 2;
    const rows = Math.ceil(cards.length / cols);
    const contentH = rows * (TILE_H + GAP_Y) - GAP_Y + 2 * PAD;
    const grid = new Container({ label: "grid" });
    const mask = new Graphics().rect(px, gridTop, pw, gridH).fill(0xffffff);
    grid.mask = mask;
    const edge = new Graphics();
    edge.eventMode = "none";

    root.addChild(veil, panelSprite, mask, grid, closeButton);

    return new Promise(resolve => {
      const onWheel = (event: WheelEvent): void => {
        const room = Math.max(0, contentH - gridH);
        grid.y = Math.max(-room, Math.min(0, grid.y - event.deltaY / v.scale));
      };
      const endAt = (card: CardInstance | null): void => {
        this.close = null;
        this.mode = null;
        this.stage.app.canvas.removeEventListener("wheel", onWheel);
        root.destroy({ children: true });
        panel.destroy(true);
        resolve(card);
      };
      this.close = endAt;
      veil.on("pointertap", () => endAt(null));
      closeButton.on("pointertap", () => endAt(null));
      this.stage.app.canvas.addEventListener("wheel", onWheel, { passive: true });

      cards.forEach((card, index) => {
        const x = left + (index % cols) * (TILE_W + GAP_X);
        const y = gridTop + PAD + Math.floor(index / cols) * (TILE_H + GAP_Y);
        const tile = new TableCard(card.uid);
        // Si vede ma non si sceglie: velata, come la carta che non ci si può permettere in mano.
        const veiled = pickable !== null && !pickable.has(card.uid);
        tile.update({ cardId: card.cardId, face: card.face, back: false, tapped: false, w: TILE_W, h: TILE_H, locale: this.locale, resolution: res, badges: null, combat: null, veiled });
        tile.position.set(x + TILE_W / 2, y + TILE_H / 2);
        grid.addChild(tile);
        if (veiled || pickable === null) {
          tile.eventMode = "none";
          return;
        }
        tile.cursor = "pointer";
        tile.on("pointerover", () => {
          edge.clear().rect(tile.x - TILE_W / 2 - 2, tile.y - TILE_H / 2 - 2, TILE_W + 4, TILE_H + 4).stroke({ color: 0xff4d6d, width: 2, alignment: 1 });
          grid.addChild(edge);
        });
        tile.on("pointerout", () => edge.clear());
        tile.on("pointertap", () => endAt(card));
      });
      this.layer.addChild(root);
      this.layer.parent?.addChild(this.layer);
    });
  }
}
