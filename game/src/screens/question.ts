// La domanda del gioco (simulatore/src/ask.ts, lo stesso sigillo del fermo
// dell'arbitro): «Uscire dalla partita?». Non un confirm del browser ma il
// sigillo del gioco, tema «Notte» — il vetro pesante col filo di rubino, la
// gemma del marchio, il titolo rubino acceso, la frase, due tasti in riga sulla
// piastra del tema: il ripensamento a sinistra, col filo della linea; il gesto
// a destra, col filo e la scritta del rubino. Esc e il click fuori valgono «no».

import { Container, Graphics, Sprite } from "pixi.js";
import { drawLines, drawText, fontMetrics, layout, textWidth, type Font } from "../card/text";
import type { Stage } from "../stage";
import { SANS, paintPiece, linearGradient, withShadow } from "../table/appearance";
import { ACTION_EDGE, GLASS_HEAVY, INK, LINE, OVERLAY_VEIL, RUBY, ACTION_LABEL } from "./ui";

/** .ask-card: 460 di larghezza; .engine-stop-card: padding 26 28 22, gap 12. */
const W = 460;
const PAD_TOP = 26;
const PAD_X = 28;
const PAD_BOTTOM = 22;
const GAP = 12;
/** Il filo: color-mix(rubino 45%, linea) del Notte. */
const EDGE = "#933d4f";

export interface AskOptions {
  title: string;
  text: string;
  yes: string;
  no: string;
}

export function askQuestion(stage: Stage, ask: AskOptions): Promise<boolean> {
  const scale = stage.visible().scale;
  const res = scale * stage.app.renderer.resolution;
  const screen = stage.app.screen;
  const body: Font = { size: 16, weight: 400, family: SANS };
  const titleFont: Font = { size: 16.8, weight: 700, family: SANS, spacing: 16.8 * 0.22, upper: true };
  const noFont: Font = { size: 16, weight: 600, family: SANS, spacing: 1.6, upper: true };
  const yesFont: Font = { size: 16, weight: 700, family: SANS, spacing: 1.6, upper: true };
  // La frase: al più 34ch, centrata.
  const textW = Math.min(W - 2 * PAD_X, textWidth(body, "0") * 34);
  const lines = layout([{ kind: "text", text: ask.text, font: body, color: INK }], textW, { font: body, lineHeight: 24 });
  const textH = lines.reduce((sum, line) => sum + line.height, 0);
  const gem = 18;
  const titleH = Math.ceil(16.8 * 1.3);
  const buttonH = 44;
  const gemY = PAD_TOP + 2;
  const titleY = gemY + gem + GAP + 2;
  const textY = titleY + titleH + GAP;
  const buttonsY = textY + textH + GAP + 6;
  const h = buttonsY + buttonH + PAD_BOTTOM;
  const buttonW = (W - 2 * PAD_X - 10) / 2;
  const margin = 70;
  const texture = paintPiece(W + 2 * margin, h + 2 * margin, res, ctx => {
    ctx.translate(margin, margin);
    // L'ombra lunga e l'alone di rubino (box-shadow 0 30 80 .6, 0 0 44 rubino .14).
    withShadow(ctx, res, { x: 0, y: 30, blur: 80, color: "rgba(0,0,0,.6)" }, () => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, h);
    });
    withShadow(ctx, res, { x: 0, y: 0, blur: 44, color: "rgba(210,74,100,.14)" }, () => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, h);
    });
    ctx.clearRect(0, 0, W, h);
    ctx.fillStyle = GLASS_HEAVY;
    ctx.fillRect(0, 0, W, h);
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, h - 1);
    // La gemma del marchio, col suo alone.
    ctx.save();
    ctx.translate(W / 2, gemY + gem / 2);
    ctx.rotate(Math.PI / 4);
    withShadow(ctx, res, { x: 0, y: 0, blur: 14, color: "rgba(210,74,100,.65)" }, () => {
      ctx.fillStyle = "#9e0f34";
      ctx.fillRect(-gem / 2, -gem / 2, gem, gem);
    });
    ctx.strokeStyle = "#e56a86";
    ctx.strokeRect(-gem / 2 + 0.5, -gem / 2 + 0.5, gem - 1, gem - 1);
    ctx.restore();
    const { ascent: ta, descent: td } = fontMetrics(titleFont);
    drawText(
      ctx,
      { kind: "text", text: ask.title, font: titleFont, color: RUBY, shadows: [{ x: 0, y: 0, blur: 16, color: "rgba(210,74,100,.5)" }] },
      (W - textWidth(titleFont, ask.title)) / 2,
      titleY + (titleH + ta - td) / 2
    );
    for (const line of lines) drawLines(ctx, [line], (W - line.width) / 2, textY);
    // I due tasti sulla piastra del Notte (gradiente, filo di luce in cima): il ripensamento col filo della linea (.ask-no), il gesto col rubino (.engine-stop-ok).
    const plate = (x: number, edge: string): void => {
      ctx.fillStyle = linearGradient(ctx, 180, x, buttonsY, buttonW, buttonH, [[0, "#241d22"], [1, "#151116"]]);
      ctx.fillRect(x, buttonsY, buttonW, buttonH);
      ctx.fillStyle = "rgba(255,255,255,.07)";
      ctx.fillRect(x + 1, buttonsY + 1, buttonW - 2, 1);
      ctx.strokeStyle = edge;
      ctx.strokeRect(x + 0.5, buttonsY + 0.5, buttonW - 1, buttonH - 1);
    };
    plate(PAD_X, LINE);
    const { ascent, descent } = fontMetrics(noFont);
    const baseline = buttonsY + (buttonH + ascent - descent) / 2;
    drawText(ctx, { kind: "text", text: ask.no, font: noFont, color: INK }, PAD_X + (buttonW - textWidth(noFont, ask.no)) / 2, baseline);
    const yx = PAD_X + buttonW + 10;
    plate(yx, ACTION_EDGE);
    drawText(ctx, { kind: "text", text: ask.yes, font: yesFont, color: ACTION_LABEL }, yx + (buttonW - textWidth(yesFont, ask.yes)) / 2, baseline);
  });
  const root = new Container({ label: "question" });
  const veil = new Graphics().rect(0, 0, screen.width, screen.height).fill({ color: 0x080608, alpha: 0.82 });
  veil.eventMode = "static";
  const card = new Sprite(texture);
  card.width = (W + 2 * margin) * scale;
  card.height = (h + 2 * margin) * scale;
  const cardX = (screen.width - W * scale) / 2;
  const cardY = (screen.height - h * scale) / 2;
  card.position.set(cardX - margin * scale, cardY - margin * scale);
  // La carta si prende i suoi click: solo il velo fuori rinuncia.
  const slab = new Graphics({ label: "question-card" }).rect(cardX, cardY, W * scale, h * scale).fill({ color: 0xffffff, alpha: 0.001 });
  slab.eventMode = "static";
  // Le zone dei tasti sono rettangoli quasi trasparenti: si toccano, e hanno un riquadro da leggere (debug.ts).
  const zone = (x: number, label: string): Graphics => {
    const hit = new Graphics({ label }).rect(cardX + x * scale, cardY + buttonsY * scale, buttonW * scale, buttonH * scale).fill({ color: 0xffffff, alpha: 0.001 });
    hit.eventMode = "static";
    hit.cursor = "pointer";
    return hit;
  };
  const no = zone(PAD_X, "question-no");
  const yes = zone(PAD_X + buttonW + 10, "question-yes");
  root.addChild(veil, card, slab, no, yes);
  stage.app.stage.addChild(root);
  return new Promise(resolve => {
    const close = (answer: boolean): void => {
      window.removeEventListener("keydown", onKey);
      root.destroy({ children: true });
      texture.destroy(true);
      resolve(answer);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close(false);
    };
    veil.on("pointertap", () => close(false));
    no.on("pointertap", () => close(false));
    yes.on("pointertap", () => close(true));
    window.addEventListener("keydown", onKey);
  });
}

export { OVERLAY_VEIL };
