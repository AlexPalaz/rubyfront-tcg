// Gli avvisi del tavolo (dal 2026-09-15, «devi sempre in qualche modo far
// sapere al giocatore l'azione che è stata fatta»): ogni riga di chat che è
// un avviso (core/log.ts, isNotice) — la pesca di un innesco, la carta
// tornata in mano dal Ritiro, l'Oggetto messo in Ritiro, il tiro a vuoto —
// compare come targhetta di vetro in alto a destra, sotto la barra: il nome
// del posto in piccolo sopra, il testo coi nomi delle carte in grassetto, il
// filo rubino a sinistra e l'alone. Entra scivolando da destra, resta sei
// secondi, svanisce; se ne arrivano altre si impilano. Lo stesso su entrambi
// i client (la riga viaggia nel giornale); la cronaca (screens/chronicle.ts)
// le tiene tutte.
import { Container } from "pixi.js";
import { totalHeight, drawLines, layout, type Font } from "../card/text";
import { noticePieces } from "../screens/chronicle";
import type { Stage } from "../stage";
import { tween, easeIn, easeOut, reducedMotion } from "./animation";
import { CrispSprite, SANS, paintPiece, withShadow, linearGradient } from "./appearance";
import { FIXED } from "./layout";
import { NIGHT } from "./night";

const BODY: Font = { size: 17, weight: 400, family: SANS };
const BOLD: Font = { size: 17, weight: 700, family: SANS };
const KICKER: Font = { size: 11, weight: 700, family: SANS, spacing: 11 * 0.18, upper: true };
/** Il margine attorno alla targhetta per l'ombra e l'alone. */
const MARGIN = 48;
/** Quanto resta in vista, e quanto entra ed esce. */
const HOLD_MS = 6500;
const IN_MS = 260;
const OUT_MS = 420;
/** Da quanto lontano scivola dentro. */
const SLIDE = 28;
const GAP = 10;
/** Più di tante insieme non si leggono: le più vecchie se ne vanno prima. */
const MAX_SHOWN = 4;
const PAD_X = 18;
const PAD_Y = 12;
const KICKER_H = 15;
const MAX_W = 460;

interface Shown {
  root: Container;
  h: number;
}

export class Toast {
  private readonly layer = new Container({ label: "toasts" });
  private readonly shown: Shown[] = [];
  private hidden: () => boolean = () => false;

  constructor(private readonly stage: Stage) {
    this.layer.eventMode = "none";
    // Sul livello delle schermate, sopra il tavolo e le scene (che sfocano
    // il mondo sotto di sé): l'avviso si legge sempre nitido.
    stage.screens.addChild(this.layer);
  }

  /** Quando tacere: la cronaca o la chat aperte occupano lo stesso angolo, e la cronaca li mostra già (game.ts). */
  hiddenBy(predicate: () => boolean): void {
    this.hidden = predicate;
  }

  /** Un avviso: il testo (coi nomi fra «»), e sopra, in piccolo, chi l'ha compiuto. */
  show(text: string, kicker: string | null): void {
    if (this.hidden()) return;
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;
    const maxW = Math.min(MAX_W, v.width - 80);
    const lines = layout(noticePieces(text, BODY, BOLD, NIGHT.ink, "#ffd6de"), maxW - 2 * PAD_X - 4, { font: BODY, lineHeight: 22 });
    const textW = lines.reduce((max, line) => Math.max(max, line.width), 0);
    const w = Math.ceil(Math.max(textW, 160)) + 2 * PAD_X + 4;
    const head = kicker ? KICKER_H + 4 : 0;
    const h = PAD_Y + head + totalHeight(lines) + PAD_Y;
    const texture = paintPiece(w + 2 * MARGIN, h + 2 * MARGIN, res, ctx => {
      ctx.translate(MARGIN, MARGIN);
      // L'ombra sotto e l'alone rubino attorno; poi il vetro scuro brunito,
      // il filo di luce in cima, la cornice e la barra rubino a sinistra.
      withShadow(ctx, res, { x: 0, y: 12, blur: 30, color: "rgba(0,0,0,.65)" }, () => {
        ctx.fillStyle = NIGHT.glassHeavy;
        ctx.fillRect(0, 0, w, h);
      });
      withShadow(ctx, res, { x: 0, y: 0, blur: 22, color: "rgba(255,77,109,.28)" }, () => {
        ctx.fillStyle = NIGHT.glassHeavy;
        ctx.fillRect(0, 0, w, h);
      });
      ctx.fillStyle = linearGradient(ctx, 180, 0, 0, w, h, [
        [0, "rgba(36,29,34,.97)"],
        [1, "rgba(17,13,18,.97)"],
      ]);
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,.07)";
      ctx.fillRect(0, 0, w, 1);
      ctx.strokeStyle = NIGHT.rubyLine;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      ctx.fillStyle = NIGHT.ruby;
      ctx.fillRect(0, 0, 4, h);
      if (kicker) {
        const tag = layout([{ kind: "text", text: kicker, font: KICKER, color: NIGHT.bandaRuby }], w - 2 * PAD_X, { font: KICKER, lineHeight: KICKER_H });
        drawLines(ctx, tag, PAD_X, PAD_Y);
      }
      drawLines(ctx, lines, PAD_X, PAD_Y + head);
    });
    const sprite = new CrispSprite(texture);
    sprite.position.set(-MARGIN, -MARGIN);
    const root = new Container({ label: "toast" });
    root.addChild(sprite);
    // A destra, sotto la barra: sullo schermo largo cade nel margine accanto
    // al tavolo; su quello stretto sfiora l'angolo delle Materie avversarie,
    // non la testata del campo (2026-09-15, QC).
    const restX = v.x + v.width - w - 24;
    root.x = restX;
    root.alpha = 0;
    this.layer.addChild(root);
    const entry: Shown = { root, h };
    this.shown.push(entry);
    while (this.shown.length > MAX_SHOWN) this.remove(this.shown[0]);
    this.restack();
    const ticker = this.stage.app.ticker;
    const reduced = reducedMotion();
    if (reduced) root.alpha = 1;
    else {
      void tween(ticker, IN_MS, k => {
        root.alpha = k;
        root.x = restX + SLIDE * (1 - k);
      }, easeOut);
    }
    setTimeout(() => {
      if (!this.shown.includes(entry)) return;
      if (reduced) {
        this.remove(entry);
        return;
      }
      void tween(ticker, OUT_MS, k => {
        root.alpha = 1 - k;
        root.x = restX + SLIDE * 0.5 * k;
      }, easeIn).then(() => this.remove(entry));
    }, HOLD_MS);
  }

  private remove(entry: Shown): void {
    const index = this.shown.indexOf(entry);
    if (index < 0) return;
    this.shown.splice(index, 1);
    for (const child of entry.root.children) {
      if (child instanceof CrispSprite) child.texture.destroy(true);
    }
    entry.root.destroy({ children: true });
    this.restack();
  }

  /** Dall'alto in basso, nell'ordine d'arrivo, sotto la barra. */
  private restack(): void {
    const v = this.stage.visible();
    let y = v.y + FIXED.bar + 14;
    for (const entry of this.shown) {
      entry.root.y = y;
      y += entry.h + GAP;
    }
  }
}
