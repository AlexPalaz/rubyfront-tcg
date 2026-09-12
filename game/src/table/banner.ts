// L'insegna di fase (simulatore/src/banner.ts): a ogni cambio di fase, o di
// turno, una scritta compare al centro del tavolo sulla banda scura,
// resta un attimo e svanisce — il turno sopra, piccolo; il titolo della fase
// fra due rombi, nel suo colore; sotto, a chi tocca. È l'unico posto in cui
// si legge il turno. Finché è in vista il tavolo si FERMA per tutti, bot
// compreso (quiet, partita.ts): nessuno gioca sotto la scritta. A partita
// finita l'insegna finale resta, dice chi ha vinto e offre il solo gesto
// rimasto, la partita nuova.

import { t } from "@rubyfront/core/i18n";
import { seatLabel } from "@rubyfront/core/state";
import { describeGameOver } from "@rubyfront/core/turn";
import type { GameState, Phase, Seat } from "@rubyfront/core/types";
import { otherSeat } from "@rubyfront/core/types";
import { Container, Graphics, Rectangle, Sprite, type Texture } from "pixi.js";
import { drawText, fontMetrics, textWidth, type Font, type TextShadow } from "../card/text";
import type { Stage } from "../stage";
import { key, tween, easeOut, reducedMotion } from "./animation";
import { SANS, paintPiece, linearGradient } from "./appearance";
import { FIXED } from "./layout";
import { NIGHT, withAlpha, plate, setBlurred, below } from "./night";

/** Quanto resta in vista, corsa d'ingresso e d'uscita comprese (banner.ts). */
export const PHASE_BANNER_MS = 1800;

const TITLES: Record<Phase, string> = {
  preparazione: "phase.title.preparazione",
  fronte: "phase.title.fronte",
  reazione: "phase.title.reazione",
};

/** I toni di fase sul buio (le --banda-* di :root): l'inchiostro, il rubino il Fronte, il rosa della Reazione. */
const TONES: Record<Phase, string> = { preparazione: NIGHT.bandaInk, fronte: NIGHT.bandaRuby, reazione: NIGHT.bandaViola };
const INK = NIGHT.bandaInk;
const MUTED = NIGHT.bandaMuted;
/** Lo spazio sopra e sotto il titolo per il suo alone (--banda-title-shadow: 0 0 22px nel tono di fase). */
const GLOW = 30;

const TURN: Font = { size: 16, weight: 700, family: SANS, spacing: 16 * 0.24, upper: true };
const TITLE: Font = { size: 38.4, weight: 700, family: SANS, spacing: 38.4 * 0.28, upper: true };
const SUB: Font = { size: 16, weight: 400, family: SANS, spacing: 16 * 0.16, upper: true };
const BUTTON: Font = { size: 16, weight: 700, family: SANS, spacing: 16 * 0.16, upper: true };

/** Il rigo sotto: a chi tocca — in Reazione la parola è del difensore. */
function subtitle(state: GameState, me: Seat): string {
  const who = state.phase === "reazione" ? otherSeat(state.active) : state.active;
  const mine = who === me;
  const name = seatLabel(state, who, me);
  if (state.phase === "reazione") return t(mine ? "banner.defends.you" : "banner.defends.them", { turn: state.turn, name });
  return t(mine ? "banner.turn.you" : "banner.turn.them", { turn: state.turn, name });
}

/** La banda scura a tutta larghezza (--banda del buio: velo trasparente → .78 → trasparente), sfumata ai lati dal 18% all'82%. */
function paintBand(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = linearGradient(ctx, 180, 0, 0, w, h, [
    [0, "rgba(5,4,10,0)"],
    [0.3, "rgba(5,4,10,.78)"],
    [0.7, "rgba(5,4,10,.78)"],
    [1, "rgba(5,4,10,0)"],
  ]);
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = linearGradient(ctx, 90, 0, 0, w, h, [[0, "rgba(0,0,0,0)"], [0.18, "#000"], [0.82, "#000"], [1, "rgba(0,0,0,0)"]]);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Una scritta su una riga, dipinta al centro di `cx` con la linea di base in `baseline`. */
function line(ctx: CanvasRenderingContext2D, text: string, font: Font, color: string, cx: number, baseline: number, shadows?: TextShadow[]): void {
  drawText(ctx, { kind: "text", text, font, color, ...(shadows ? { shadows } : {}) }, cx - textWidth(font, text) / 2, baseline);
}

export class Banner {
  private readonly layer = new Container({ label: "banner" });
  private seen: string | null = null;
  private finalBanner: { root: Container; textures: Texture[] } | null = null;
  private current: { root: Container; textures: Texture[]; serial: number } | null = null;
  private serial = 0;
  /** Quando se ne va l'insegna in vista (per trattenere la carta del turno, e il bot). */
  private endAt = 0;
  /** La sfocatura del tavolo sotto l'insegna finale (backdrop-filter: blur(6px)). */
  private blurFilter: (() => void) | null = null;

  constructor(
    private readonly stage: Stage,
    private readonly me: Seat,
    /** «Gioca una nuova partita», dall'insegna finale. */
    private readonly newGame: () => void
  ) {
    stage.world.addChild(this.layer);
  }

  /** L'insegna è in vista: il tavolo è fermo. */
  isRunning(): boolean {
    return Date.now() < this.endAt || this.finalBanner !== null;
  }

  /** Quanto manca perché l'insegna se ne vada (0 se non c'è). */
  remaining(): number {
    return Math.max(0, this.endAt - Date.now());
  }

  /** A ogni disegno: la fine della partita, o una fase nuova da annunciare. */
  render(state: GameState): void {
    if (state.over) {
      if (!this.finalBanner) this.showFinal(state);
      this.seen = this.key(state);
      return;
    }
    if (this.finalBanner) this.closeFinal();
    const key = this.key(state);
    if (key === this.seen) return;
    const first = this.seen === null;
    this.seen = key;
    // Al primo disegno non c'è niente da annunciare: si prende nota e basta.
    if (!first) this.show(state);
  }

  /** Annuncia la fase com'è ORA, anche se non è cambiata: è l'apertura della partita. */
  announce(state: GameState): void {
    this.seen = this.key(state);
    this.show(state);
  }

  private key(state: GameState): string {
    return `${state.turn}|${state.active}|${state.phase}`;
  }

  private show(state: GameState): void {
    this.removeCurrent();
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;
    const bandH = 150;
    const cy = v.y + FIXED.bar + (v.height - FIXED.bar) / 2;
    const band = new Sprite(paintPiece(v.width, bandH, res, ctx => paintBand(ctx, v.width, bandH)));
    band.position.set(v.x, cy - bandH / 2);
    // Le tre righe: turno (20), titolo (46), sotto (20), 6 fra l'una e l'altra.
    const textW = Math.min(v.width, 1600);
    const textH = 20 + 6 + 46 + 6 + 20;
    const turn = t("hud.turn", { turn: state.turn });
    const title = t(TITLES[state.phase]);
    const sub = subtitle(state, this.me);
    const tone = TONES[state.phase];
    const titleTexture = paintPiece(textW, 46 + 2 * GLOW, res, ctx => {
      ctx.translate(0, GLOW);
      this.paintTitle(ctx, title, tone, textW / 2);
    });
    const linesTexture = paintPiece(textW, textH, res, ctx => {
      const turnM = fontMetrics(TURN);
      line(ctx, turn, TURN, INK, textW / 2, (20 + turnM.ascent - turnM.descent) / 2);
      const subM = fontMetrics(SUB);
      line(ctx, sub, SUB, MUTED, textW / 2, textH - 20 + (20 + subM.ascent - subM.descent) / 2);
    });
    const lines = new Sprite(linesTexture);
    lines.position.set(v.x + (v.width - textW) / 2, cy - textH / 2);
    const titleSprite = new Sprite(titleTexture);
    titleSprite.anchor.set(0.5);
    titleSprite.position.set(v.x + v.width / 2, cy - textH / 2 + 26 + 23);
    const root = new Container({ label: "phase-banner" });
    root.eventMode = "none";
    root.addChild(band, lines, titleSprite);
    // Sopra il tavolo ma sotto l'ingresso dei Rubyfront e le scene, che si portano in cima da sé.
    this.layer.addChild(root);
    const serial = ++this.serial;
    this.current = { root, textures: [band.texture, linesTexture, titleTexture], serial };
    this.endAt = Date.now() + PHASE_BANNER_MS;
    if (reducedMotion()) {
      setTimeout(() => this.serial === serial && this.removeCurrent(), PHASE_BANNER_MS);
      return;
    }
    void tween(this.stage.app.ticker, PHASE_BANNER_MS, k => {
      root.alpha = key(k, [[0, 0], [0.12, 1], [0.78, 1], [1, 0]]);
      titleSprite.scale.set(key(k, [[0, 0.9], [0.2, 1], [1, 1.03]]));
    }, easeOut).then(() => {
      if (this.serial === serial) this.removeCurrent();
    });
  }

  private paintTitle(ctx: CanvasRenderingContext2D, title: string, tone: string, cx: number): void {
    const m = fontMetrics(TITLE);
    const baseline = (46 + m.ascent - m.descent) / 2;
    const w = textWidth(TITLE, title);
    line(ctx, title, TITLE, tone, cx, baseline, [{ x: 0, y: 0, blur: 22, color: withAlpha(tone, 0.55) }]);
    // I rombi ai lati (◆ a .45em, margine .55em): sul buio l'ornamento è il tono stesso (currentColor), a .85.
    const size = TITLE.size * 0.45;
    const gap = TITLE.size * 0.55;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = tone;
    for (const x of [cx - w / 2 - gap - size / 2, cx + w / 2 + gap + size / 2]) {
      ctx.beginPath();
      ctx.moveTo(x, baseline - m.ascent * 0.45 - size / 2);
      ctx.lineTo(x + size / 2, baseline - m.ascent * 0.45);
      ctx.lineTo(x, baseline - m.ascent * 0.45 + size / 2);
      ctx.lineTo(x - size / 2, baseline - m.ascent * 0.45);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private removeCurrent(): void {
    const current = this.current;
    if (!current) return;
    this.current = null;
    current.root.destroy({ children: true });
    for (const texture of current.textures) texture.destroy(true);
  }

  /** L'insegna finale (§2, §9): resta, non svanisce — fino a Nuova partita. */
  private showFinal(state: GameState): void {
    this.removeCurrent();
    this.endAt = 0;
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;
    const { title: heading } = describeGameOver(state, state.over!, this.me);
    const won = state.over!.winner === this.me;
    const tone = won ? TONES.fronte : TONES.reazione;
    const bandH = 210;
    const cy = v.y + v.height / 2;
    const root = new Container({ label: "final-banner" });
    // Il velo copre tutto e spegne il tavolo (body.is-over): l'unico gesto è la partita nuova.
    // color-mix(in srgb, var(--bg) 74%, transparent) sul Notte, e sotto il tavolo sfocato.
    const veil = new Graphics().rect(v.x, v.y, v.width, v.height).fill({ color: 0x0b090d, alpha: 0.74 });
    veil.eventMode = "static";
    const band = new Sprite(paintPiece(v.width, bandH, res, ctx => paintBand(ctx, v.width, bandH)));
    band.position.set(v.x, cy - bandH / 2);
    const textW = Math.min(v.width, 1600);
    const label = t("over.newgame");
    const buttonW = Math.ceil(textWidth(BUTTON, label)) + 44 + 2;
    const buttonH = 16 + 24 + 2;
    const contentH = 46 + 14 + buttonH;
    const margin = 30;
    const texture = paintPiece(textW, contentH + margin + GLOW, res, ctx => {
      ctx.translate(0, GLOW);
      this.paintTitle(ctx, heading, tone, textW / 2);
      const bx = (textW - buttonW) / 2;
      const by = 46 + 14;
      // Sul Notte il tasto è la piastra brunita con la cornice rosa (:where(.phase-banner-new)).
      plate(ctx, bx, by, buttonW, buttonH, NIGHT.goLine);
      const m = fontMetrics(BUTTON);
      line(ctx, label, BUTTON, NIGHT.goInk, textW / 2, by + (buttonH + m.ascent - m.descent) / 2);
    });
    const content = new Sprite(texture);
    const top = cy - contentH / 2;
    content.position.set(v.x + (v.width - textW) / 2, top - GLOW);
    const button = new Container({ label: "new-game" });
    button.eventMode = "static";
    button.cursor = "pointer";
    button.hitArea = new Rectangle(v.x + (v.width - buttonW) / 2, top + 46 + 14, buttonW, buttonH);
    button.on("pointertap", () => this.newGame());
    root.addChild(veil, band, content, button);
    this.layer.addChild(root);
    this.layer.parent?.addChild(this.layer);
    this.blurFilter?.();
    this.blurFilter = setBlurred(this.stage, below(this.stage.world, this.layer), 6);
    this.finalBanner = { root, textures: [band.texture, texture] };
    void tween(this.stage.app.ticker, 300, k => (root.alpha = k), easeOut);
  }

  private closeFinal(): void {
    const finalBanner = this.finalBanner;
    if (!finalBanner) return;
    this.finalBanner = null;
    this.blurFilter?.();
    this.blurFilter = null;
    finalBanner.root.destroy({ children: true });
    for (const texture of finalBanner.textures) texture.destroy(true);
  }
}
