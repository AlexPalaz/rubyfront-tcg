// La mira di un effetto (§8.2) nel gioco, come nel simulatore (table.ts,
// pickTargetUi): si sceglie il bersaglio fra i candidati — accesi di verde,
// il resto del tavolo spento — con la targhetta in alto che dice cosa si
// cerca. Un tocco su un candidato sceglie; il tocco sul vuoto o Esc
// rinunciano. Mentre un effetto si risolve il tavolo è fermo (blocca), ma la
// mira È il gesto del giocatore: la presa si molla, e si riprende scelto il
// bersaglio — o rinunciando. La freccia dalla fonte al dito arriva con F5.
// Il candidato sotto il puntatore si accende pieno (l'anello «aimed»): un
// tocco solo lo sceglie. Chi apre veli sopra le carte (gestures.ts) ascolta
// onOpen e li chiude: un velo sopra il bersaglio si prenderebbe il tocco.

import { t } from "@rubyfront/core/i18n";
import type { CardInstance } from "@rubyfront/core/types";
import { Sprite, Texture } from "pixi.js";
import { totalHeight, drawLines, layout, type Font } from "../card/text";
import type { Stage } from "../stage";
import { SANS, paintPiece, withShadow } from "./appearance";
import type { Arrows } from "./arrows";
import type { Table } from "./table";

const HINT: Font = { size: 16, weight: 400, family: SANS, spacing: 16 * 0.06 };
/** Il margine attorno alla targhetta per la sua ombra (0 12px 30px). */
const MARGIN = 50;

export class Aim {
  private readonly sprite = new Sprite();
  private armed: { candidates: Map<string, CardInstance>; endAt: (card: CardInstance | null) => void } | null = null;
  /** Le frecce: dalla fonte dell'effetto al dito (partita.ts le presta). */
  arrows: Arrows | null = null;
  private readonly openListeners: (() => void)[] = [];

  constructor(
    private readonly stage: Stage,
    private readonly table: Table
  ) {
    this.sprite.eventMode = "none";
    this.sprite.visible = false;
    this.sprite.label = "aim";
    stage.world.addChild(this.sprite);
    table.onCard(cardEvent => {
      if (!this.armed) return;
      const card = this.armed.candidates.get(cardEvent.uid);
      if (cardEvent.type === "over") this.table.hoverAim(card ? card.uid : null);
      else if (cardEvent.type === "out") this.table.hoverAim(null);
      else if (cardEvent.type === "tap" && card) this.close(card);
    });
    table.onEmpty(() => this.close(null));
    window.addEventListener("keydown", event => {
      if (event.key === "Escape") this.close(null);
    });
  }

  isOpen(): boolean {
    return this.armed !== null;
  }

  /** Chi ascolta l'apertura della mira (i veli sopra le carte si chiudono). */
  onOpen(listener: () => void): void {
    this.openListeners.push(listener);
  }

  /** Il bersaglio fra i candidati, o null se si rinuncia. */
  choose(candidates: CardInstance[], hint: string, source?: string): Promise<CardInstance | null> {
    // Una mira alla volta: quella di prima rinuncia.
    this.close(null);
    const held = this.table.isBlocked();
    if (held) this.table.setBlocked(false);
    return new Promise(resolve => {
      this.armed = {
        candidates: new Map(candidates.map(card => [card.uid, card])),
        endAt: card => {
          if (held) this.table.setBlocked(true);
          resolve(card);
        },
      };
      this.table.aim({ candidates: candidates.map(card => card.uid) });
      for (const listener of this.openListeners) listener();
      if (source) this.arrows?.follow({ kind: "effect", from: source });
      this.nameplate(t("target.esc", { hint }));
    });
  }

  private close(card: CardInstance | null): void {
    const armed = this.armed;
    if (!armed) return;
    this.armed = null;
    this.table.aim(null);
    this.nameplate(null);
    this.arrows?.follow(null);
    armed.endAt(card);
  }

  /** La targhetta (.target-hint): vetro scuro del Notte col filo verde, in alto al centro; null la toglie. Serve anche alla mira dei blocchi. */
  nameplate(text: string | null): void {
    if (text === null) {
      this.sprite.visible = false;
      return;
    }
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;
    const lines = layout([{ kind: "text", text, font: HINT, color: "#f1eae6" }], v.width - 80, { font: HINT, lineHeight: 20 });
    const textW = lines.reduce((max, line) => Math.max(max, line.width), 0);
    const w = Math.ceil(textW) + 36 + 2;
    const h = totalHeight(lines) + 16 + 2;
    const old = this.sprite.texture;
    this.sprite.texture = paintPiece(w + 2 * MARGIN, h + 2 * MARGIN, res, ctx => {
      ctx.translate(MARGIN, MARGIN);
      withShadow(ctx, res, { x: 0, y: 12, blur: 30, color: "rgba(0,0,0,.7)" }, () => {
        ctx.fillStyle = "rgba(11,9,12,.98)";
        ctx.fillRect(0, 0, w, h);
      });
      ctx.fillStyle = "rgba(11,9,12,.98)";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#6fbf8b";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      drawLines(ctx, lines, 19, 9);
    });
    if (old !== Texture.EMPTY && old !== Texture.WHITE) old.destroy(true);
    this.sprite.position.set(v.x + (v.width - w) / 2 - MARGIN, v.y + 128 - MARGIN);
    this.sprite.visible = true;
    this.sprite.parent?.addChild(this.sprite);
  }
}
