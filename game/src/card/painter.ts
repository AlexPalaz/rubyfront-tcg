// Il pittore della carta «Cattedrale Rubino»: disegna una faccia sul canvas
// strato per strato, nell'ordine in cui il browser dipinge card.css — il fondo
// e l'orlo, la finestra dell'illustrazione con la sua pietra e la gemma, la
// barra del titolo, le parole chiave, e il riquadro del testo (il castone con
// le crepe al neon, la lastra di pietra, la filigrana, i blocchi di regole
// col fit tipografico). Ogni misura viene da card.css, in em della carta
// (20px) come lì; i numeri fra parentesi sono i selettori da cui vengono.
//
// Il contesto arriva già scalato alla risoluzione voluta: qui si ragiona in
// px della carta, 520×728. Il pittore restituisce anche le righe di testo che
// ha posato, con le loro posizioni: il confronto le mette accanto a quelle
// del renderer del sito.

import { drawCover, fillLinear, fillPattern, fillRadial, insetShadow, octagon, outerShadow, polygon, roundRect, snapBox, type Box, type Stop } from "./css";
import type { TextBlock, CounterStat, FaceModel, Medallion } from "./model";
import type { ImageElement, Resources } from "./resources";
import { CARD_H, CARD_W, EM, MONO, PALETTE, SERIF, slabOf, type Slab, type Palette } from "./theme";
import { applyFont, drawLines, drawText, fontMetrics, layout, textExtent, textWidth, type Font, type TextShadow, type Piece, type BoxPiece, type TextLine } from "./text";

/** Una riga di testo posata, per il confronto (come compare/measure.ts). */
export interface PlacedLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  body: number;
}

const serif = (size: number, weight = 400, extra: Partial<Font> = {}): Font => ({ size, weight, family: SERIF, ...extra });

// La scatola della carta (card.css, .card e .card.cathedral.t49).
const BORDER = 4;
const PAD_TOP = 0.95 * EM;
const PAD_X = 0.8 * EM;
const PAD_BOTTOM = 0.65 * EM;
const GAP = 0.34 * EM;
const CONTENT_X = BORDER + PAD_X;
const CONTENT_W = CARD_W - 2 * (BORDER + PAD_X);
const CONTENT_TOP = BORDER + PAD_TOP;
const CONTENT_BOTTOM = CARD_H - BORDER - PAD_BOTTOM;
/** .art: flex 0 0 40% dell'altezza del contenuto. */
const ART_H = 0.4 * (CONTENT_BOTTOM - CONTENT_TOP);
/** La linea della carta: line-height 1.26 (.card). */
const CARD_LINE = 1.26;
/** La linea della lastra: line-height 1.34 (.textbox). */
const BOX_LINE = 1.34;

const FIT_STEPS = [1, 0.96, 0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.68, 0.64, 0.6];
const NAME_FIT_STEPS = [1.05, 0.98, 0.92, 0.86, 0.8, 0.75];

export interface Painted {
  lines: PlacedLine[];
}

export function paint(ctx: CanvasRenderingContext2D, face: FaceModel, resources: Resources, artImage: ImageElement | null): Painted {
  const p = PALETTE[face.tint];
  const slabStyle = slabOf(p);
  const placedLines: PlacedLine[] = [];
  const record = (line: TextLine, dx: number, dy = 0): void => recordLine(placedLines, line, dx, dy);

  const card: Box = { x: 0, y: 0, w: CARD_W, h: CARD_H };
  const padding: Box = { x: BORDER, y: BORDER, w: CARD_W - 2 * BORDER, h: CARD_H - 2 * BORDER };

  // ---- il fondo e l'orlo (.card.cathedral.t49)
  ctx.save();
  ctx.clip(roundRect(card, 3));
  fillLinear(ctx, card, 180, [["#2a292e", 0], ["#1a191d", 1]]);
  ctx.save();
  ctx.beginPath();
  ctx.rect(padding.x, padding.y, padding.w, padding.h);
  ctx.clip();
  fillLinear(ctx, padding, 180, [[p.cardHi, 0], ["#19181c", "26%"], [p.cardMid, "50%"], ["#121116", "74%"], [p.cardLow, "100%"]]);
  fillPattern(ctx, resources.ground, padding, 300, 640, padding.x, padding.y);
  fillLinear(ctx, padding, 160, [["rgba(255,255,255,0)", "30%"], ["rgba(255,255,255,.06)", "46%"], ["rgba(255,255,255,0)", "62%"]]);
  ctx.restore();
  // box-shadow: inset 0 0 0 1px var(--hair) — il filo di rubino dentro l'orlo.
  insetShadow(ctx, padding, 0, { x: 0, y: 0, blur: 0, spread: 1, color: p.hair });

  // ---- la full art: l'illustrazione fa da sfondo (.card.full-art .bg-art, .bg-scrim)
  if (face.fullArt && artImage && face.art) paintBackdrop(ctx, face, artImage, padding);

  // ---- l'impaginazione verticale della colonna (flex column, gap .34em)
  const title = titleBlock(face, p);
  const titleTop = CONTENT_TOP;
  const artTop = titleTop + title.h + GAP;
  let y = artTop + ART_H + GAP;
  const keywordRows = face.keywords.map(keyword => {
    const row = keywordLine(keyword, face.fullArt, p);
    const top = y;
    y += row.h + GAP;
    return { row, top };
  });
  let dividerTop: number | null = null;
  if (face.divider) {
    dividerTop = y;
    y += DIVIDER_H + GAP;
  }
  const textbox: Box = { x: CONTENT_X, y, w: CONTENT_W, h: CONTENT_BOTTOM - y };
  // I riquadri si dipingono agganciati ai pixel; il testo dentro segue la
  // sua impaginazione, non l'aggancio.
  const textboxPaint = snapBox(ctx, textbox);

  // ---- la finestra dell'illustrazione (.cathedral .art)
  const artBox: Box = snapBox(ctx, { x: CONTENT_X, y: artTop, w: CONTENT_W, h: ART_H });
  if (!face.fullArt) paintPane(ctx, artBox, p, artImage, face.placeholder);

  // ---- la barra del titolo
  title.draw(ctx, titleTop, placedLines);

  // ---- le parole chiave e il divisore del Nexus
  for (const { row, top } of keywordRows) row.draw(ctx, top, record);
  if (dividerTop !== null) paintDivider(ctx, dividerTop, p, placedLines);

  // ---- il riquadro del testo
  paintBox(ctx, textbox, textboxPaint, face, p, slabStyle, resources, placedLines);

  ctx.restore();
  return { lines: placedLines };
}

// ================================================================ lo sfondo

function percentOf(value: string | null, base: number, fallback: number): number {
  if (!value) return fallback;
  if (value.endsWith("%")) return (parseFloat(value) / 100) * base;
  if (value.endsWith("px")) return parseFloat(value);
  return fallback;
}

function paintBackdrop(ctx: CanvasRenderingContext2D, face: FaceModel, artImage: ImageElement, padding: Box): void {
  const art = face.art!;
  // .bg-art: left 0 right 0, top var(--art-shift, 0), height var(--art-zoom, 100%),
  // object-fit cover, object-position `artFocusX 50%`, sfuma in fondo (mask 78% → 100%).
  const top = padding.y + percentOf(art.shift, padding.h, 0);
  // Il riquadro dell'immagine agganciato ai pixel, come lo dipinge Chrome (object-fit sul riquadro agganciato).
  const box: Box = snapBox(ctx, { x: padding.x, y: top, w: padding.w, h: percentOf(art.zoom, padding.h, padding.h) });
  const scale = ctx.getTransform().a;
  const layer = document.createElement("canvas");
  layer.width = Math.ceil(CARD_W * scale);
  layer.height = Math.ceil(CARD_H * scale);
  const lc = layer.getContext("2d")!;
  lc.scale(scale, scale);
  lc.imageSmoothingQuality = "high";
  lc.save();
  lc.beginPath();
  lc.rect(box.x, box.y, box.w, box.h);
  lc.clip();
  drawCover(lc, artImage, box, art.focusX ? parseFloat(art.focusX) / 100 : 0.5, 0.5);
  lc.restore();
  lc.globalCompositeOperation = "destination-in";
  fillLinear(lc, box, 180, [["#000", 0], ["#000", "78%"], ["rgba(0,0,0,0)", "100%"]]);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.restore();

  // .bg-scrim: il velo che scurisce alto e basso (inset 0, opacità --art-veil).
  ctx.save();
  ctx.globalAlpha = art.veil ?? 1;
  const dim = art.dim ?? 0;
  if (dim > 0) {
    ctx.fillStyle = `rgba(10,8,6,${dim})`;
    ctx.fillRect(padding.x, padding.y, padding.w, padding.h);
  }
  fillLinear(ctx, padding, 180, [
    ["rgba(10,8,6,.61)", "0%"],
    ["rgba(10,8,6,.31)", "20%"],
    ["rgba(10,8,6,.18)", "38%"],
    ["rgba(10,8,6,.38)", "58%"],
    ["rgba(10,8,6,.65)", "78%"],
    ["rgba(10,8,6,.74)", "100%"],
  ]);
  ctx.restore();
}

/**
 * backdrop-filter: blur(2px) — le bande sull'illustrazione sfocano ciò che
 * hanno dietro: si ridisegna il canvas su sé stesso, sfocato, dentro la forma.
 */
function blurBehind(ctx: CanvasRenderingContext2D, shape: Path2D, blur: number): void {
  const scale = ctx.getTransform().a;
  const copy = document.createElement("canvas");
  copy.width = ctx.canvas.width;
  copy.height = ctx.canvas.height;
  copy.getContext("2d")!.drawImage(ctx.canvas, 0, 0);
  ctx.save();
  ctx.clip(shape);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = `blur(${blur * scale}px)`;
  ctx.drawImage(copy, 0, 0);
  ctx.restore();
}

// ============================================================ la finestra

const GROOVE_H: Stop[] = [["rgba(255,255,255,.14)", "0px"], ["rgba(255,255,255,.14)", "1px"], ["rgba(0,0,0,.5)", "1px"], ["rgba(0,0,0,.5)", "2px"]];
const CORNER: Stop[] = [
  ["rgba(0,0,0,0)", "0px"],
  ["rgba(0,0,0,0)", `${0.94 * EM}px`],
  ["rgba(255,255,255,.14)", `${0.94 * EM}px`],
  ["rgba(255,255,255,.14)", `${0.94 * EM + 1}px`],
  ["rgba(0,0,0,.5)", `${0.94 * EM + 1}px`],
  ["rgba(0,0,0,.5)", `${0.94 * EM + 2}px`],
  ["rgba(0,0,0,0)", `${0.94 * EM + 2}px`],
];

function paintPane(ctx: CanvasRenderingContext2D, art: Box, p: Palette, artImage: ImageElement | null, placeholder: string): void {
  // ::before — la lastra di pietra ottagonale coi solchi incisi.
  ctx.save();
  ctx.clip(octagon(art, 0.9 * EM));
  fillRadial(ctx, art, 1.2 * art.w, 1.3 * art.h, art.x + art.w / 2, art.y - 0.2 * art.h, [[p.stoneHi, 0], [p.stoneMid, "48%"], [p.stoneLow, "100%"]]);
  const corner = 1.7 * EM;
  fillLinear(ctx, { x: art.x, y: art.y + art.h - corner, w: corner, h: corner }, 45, CORNER);
  fillLinear(ctx, { x: art.x + art.w - corner, y: art.y + art.h - corner, w: corner, h: corner }, 315, CORNER);
  fillLinear(ctx, { x: art.x + art.w - corner, y: art.y, w: corner, h: corner }, 225, CORNER);
  fillLinear(ctx, { x: art.x, y: art.y, w: corner, h: corner }, 135, CORNER);
  const inset = 0.3 * EM;
  const sideH = art.h - 3.4 * EM;
  fillLinear(ctx, { x: art.x + art.w - inset - 2, y: art.y + (art.h - sideH) / 2, w: 2, h: sideH }, 270, GROOVE_H);
  fillLinear(ctx, { x: art.x + inset, y: art.y + (art.h - sideH) / 2, w: 2, h: sideH }, 90, GROOVE_H);
  const bottomW = art.w - 3.4 * EM;
  fillLinear(ctx, { x: art.x + (art.w - bottomW) / 2, y: art.y + art.h - inset - 2, w: bottomW, h: 2 }, 0, GROOVE_H);
  const topW = art.w / 2 - 2.34 * EM;
  fillLinear(ctx, { x: art.x + art.w - corner - topW, y: art.y + inset, w: topW, h: 2 }, 180, GROOVE_H);
  fillLinear(ctx, { x: art.x + corner, y: art.y + inset, w: topW, h: 2 }, 180, GROOVE_H);
  const veil: Box = { x: art.x + (art.w - 7 * EM) / 2, y: art.y, w: 7 * EM, h: 2.2 * EM };
  fillRadial(ctx, veil, veil.w / 2, veil.h, veil.x + veil.w / 2, veil.y, [[p.stoneVeil, 0], ["rgba(0,0,0,0)", "72%"]]);
  ctx.restore();

  // L'illustrazione, ritagliata a ottagono (.cathedral .art img).
  const pad = 0.55 * EM;
  const image: Box = { x: art.x + pad, y: art.y + pad, w: art.w - 2 * pad, h: art.h - 2 * pad };
  ctx.save();
  ctx.clip(octagon(image, 0.45 * EM));
  if (artImage) {
    ctx.imageSmoothingQuality = "high";
    drawCover(ctx, artImage, image);
  } else {
    // Il segnaposto (.art: maiuscole spaziate, muted al 45%).
    const font = serif(EM, 400, { upper: true, spacing: 0.4 * EM });
    const w = textWidth(font, placeholder);
    const { ascent, descent } = fontMetrics(font);
    drawText(ctx, { kind: "text", text: placeholder, font, color: "rgba(217,154,169,.45)" }, image.x + (image.w - w) / 2, image.y + image.h / 2 + (ascent - descent) / 2);
  }
  ctx.restore();

  // ::after — la gemma nella cuspide.
  const gem: Box = { x: art.x + art.w / 2 - (0.95 * EM) / 2, y: art.y - 0.22 * EM, w: 0.95 * EM, h: 1.2 * EM };
  ctx.save();
  ctx.clip(polygon(gem, [[0.5, 0], [1, 0.62], [0.5, 1], [0, 0.62]]));
  fillLinear(ctx, gem, 180, [[p.gemTop, 0], [p.gemMid, "42%"], [p.gemLow, "100%"]]);
  fillRadial(ctx, gem, 1.3 * gem.w, 1.2 * gem.h, gem.x + gem.w / 2, gem.y + 0.45 * gem.h, [["rgba(16,3,7,0)", "50%"], ["rgba(16,3,7,.5)", "100%"]]);
  fillRadial(ctx, gem, 0.65 * gem.w, 0.55 * gem.h, gem.x + gem.w / 2, gem.y + 0.38 * gem.h, [["rgba(240,130,150,.2)", 0], ["rgba(0,0,0,0)", "70%"]]);
  ctx.restore();
}

// ======================================================= la barra del titolo

interface Title {
  h: number;
  draw(ctx: CanvasRenderingContext2D, top: number, placedLines: PlacedLine[]): void;
}

const COST = 2.15 * EM;
const NEXUS_MARK = { w: 3.1 * EM, h: 2.2 * EM };
const COL = 2.9 * EM;
const COL_GAP = 0.5 * EM;
const NAME_X = CONTENT_X + COL + COL_GAP;
const NAME_W = CONTENT_W - 2 * (COL + COL_GAP);

function titleBlock(face: FaceModel, p: Palette): Title {
  // Il nome su una riga: il corpo scende finché ci sta (NAME_FIT_STEPS).
  const nameFont = (size: number): Font => serif(size, 700, { caps: true, spacing: 0.08 * size });
  let nameSize = NAME_FIT_STEPS[0] * EM;
  for (const step of NAME_FIT_STEPS) {
    nameSize = step * EM;
    if (Math.round(nameWidth(face, nameFont(nameSize))) <= Math.round(NAME_W)) break;
  }
  const font = nameFont(nameSize);
  const namePadTop = 0.26 * nameSize;
  const namePadBottom = (face.fullArt ? 0.42 : 0.3) * nameSize;
  const nameH = namePadTop + 1.2 * nameSize + namePadBottom;

  const costH = face.cost?.kind === "nexus" ? NEXUS_MARK.h : face.cost ? COST : 0;
  const right = rightPart(face, p);
  const h = Math.max(2 * EM, costH, nameH, right.h);

  return {
    h,
    draw(ctx, top, placedLines) {
      const cy = top + h / 2;
      paintCost(ctx, face, p, cy, placedLines);

      // Il nome (.cathedral .name, .card.cathedral.t49 .name).
      const nameTop = cy - nameH / 2;
      const box: Box = snapBox(ctx, { x: NAME_X, y: nameTop, w: NAME_W, h: nameH });
      const line = (y: number, color: string): void =>
        fillLinear(ctx, { x: box.x, y, w: box.w, h: 1 }, 90, [[transparentOf(color), 0], [color, "20%"], [color, "80%"], [transparentOf(color), "100%"]]);
      line(box.y, p.titleLine);
      line(box.y + 1, "rgba(0,0,0,.75)");
      line(box.y + box.h - 2, p.titleLine);
      line(box.y + box.h - 1, "rgba(0,0,0,.75)");
      const shadows: TextShadow[] = face.fullArt
        ? [{ x: 0, y: 1, blur: 2, color: "rgba(0,0,0,.75)" }, { x: 0, y: 0, blur: 8, color: "rgba(0,0,0,.5)" }]
        : [{ x: 0, y: 1, blur: 0, color: "rgba(0,0,0,.7)" }, { x: 0, y: -1, blur: 0, color: "rgba(255,255,255,.07)" }];
      const width = nameWidth(face, font);
      let x = box.x + (box.w - width) / 2;
      const baseline = nameTop + namePadTop + textExtent(font, 1.2 * nameSize).ascent;
      if (face.unique) {
        // La stella dell'Unica: .78em, vertical-align -.05em, margine .32em.
        const star = 0.78 * nameSize;
        paintStar(ctx, x, baseline + 0.05 * nameSize - star, star, p);
        x += star + 0.32 * nameSize;
      }
      drawText(ctx, { kind: "text", text: face.title, font, color: p.ink, shadows }, x, baseline);
      recordText(placedLines, face.title, font, x, baseline);
      if (face.fullArt) {
        // ::after — la gemma minuta sul filo di sotto.
        const size = 0.34 * nameSize;
        const gx = box.x + box.w / 2;
        const gy = box.y + box.h - 0.1 * nameSize - size / 2;
        ctx.save();
        ctx.translate(gx, gy);
        ctx.rotate(Math.PI / 4);
        const gem: Box = { x: -size / 2, y: -size / 2, w: size, h: size };
        outerShadow(ctx, roundRect(gem, 0), { x: 0, y: 0, blur: 0, spread: 1, color: "rgba(0,0,0,.75)" });
        fillLinear(ctx, gem, 135, [[p.gemTop, 0], [p.gemMid, "60%"], [p.gemLow, "100%"]]);
        insetShadow(ctx, gem, 0, { x: 0, y: 0, blur: 0, spread: 1, color: "rgba(255,255,255,.25)" });
        ctx.restore();
      }

      right.draw(ctx, top, h, placedLines);
    },
  };
}

function nameWidth(face: FaceModel, font: Font): number {
  const star = face.unique ? 0.78 * font.size + 0.32 * font.size : 0;
  return star + textWidth(font, face.title);
}

function transparentOf(color: string): string {
  return color.startsWith("#") ? `${color}00` : color.replace(/,\s*[\d.]+\)$/, ",0)");
}

function paintStar(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, p: Palette): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 20, size / 20);
  const star = new Path2D("M 10 1.5 L 12.3 7.7 L 18.5 10 L 12.3 12.3 L 10 18.5 L 7.7 12.3 L 1.5 10 L 7.7 7.7 Z");
  ctx.fillStyle = p.accent;
  ctx.fill(star);
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = p.frameDim;
  ctx.stroke(star);
  ctx.restore();
}

/** Il rombo (o il dado) del costo, in pietra chiara con la cifra scura (.card.cathedral.t49 .cost). */
function paintCost(ctx: CanvasRenderingContext2D, face: FaceModel, p: Palette, cy: number, placedLines: PlacedLine[]): void {
  const cost = face.cost;
  if (!cost) return;
  if (cost.kind === "nexus") {
    const mark: Box = { x: CONTENT_X, y: cy - NEXUS_MARK.h / 2, w: NEXUS_MARK.w, h: NEXUS_MARK.h };
    paintRings(ctx, mark, p.rubyLight, p.bg);
    return;
  }
  const die = cost.kind === "die";
  // Il rombo sta nella prima colonna, in alto di .34em (position: relative).
  const cx = CONTENT_X + COST / 2;
  const top = cy - 0.34 * EM;
  ctx.save();
  ctx.translate(cx, top);
  if (!die) ctx.rotate(Math.PI / 4);
  const box: Box = { x: -COST / 2, y: -COST / 2, w: COST, h: COST };
  const shape = roundRect(box, 3);
  outerShadow(ctx, shape, { x: 0, y: 2, blur: 6, color: "rgba(0,0,0,.35)" });
  outerShadow(ctx, shape, { x: 0, y: 0, blur: 0, spread: 1, color: p.hair });
  ctx.save();
  ctx.clip(shape);
  fillLinear(ctx, box, 160, [["#f3f1ee", 0], ["#dcd8d4", "55%"], ["#c3beb9", "100%"]]);
  ctx.restore();
  ctx.save();
  ctx.clip(shape);
  fillPatternLocal(ctx, box);
  ctx.restore();
  insetShadow(ctx, box, 3, { x: 0, y: -3, blur: 6, color: "rgba(0,0,0,.28)" });
  insetShadow(ctx, box, 3, { x: 0, y: 2, blur: 0, color: "rgba(255,255,255,.9)" });
  if (die) {
    // I due punti del dado (.cost.die::before e la sua copia in box-shadow).
    ctx.fillStyle = "rgba(42,34,38,.62)";
    const dot = 0.19 * EM;
    for (const offset of [0, 1.32 * EM]) {
      ctx.beginPath();
      ctx.arc(box.x + 0.3 * EM + offset + dot / 2, box.y + 0.3 * EM + offset + dot / 2, dot / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (!die) ctx.rotate(-Math.PI / 4);
  const font = die ? serif(1.12 * EM, 400, { spacing: -0.02 * 1.12 * EM }) : serif(EM, 400);
  const w = textWidth(font, cost.value);
  const lineH = CARD_LINE * font.size;
  const baseline = -lineH / 2 + textExtent(font, lineH).ascent;
  drawText(ctx, { kind: "text", text: cost.value, font, color: "#2a2226" }, -w / 2, baseline);
  ctx.restore();
  recordText(placedLines, cost.value, font, cx - w / 2, top + baseline);
}

let stonePattern: ImageElement | null = null;
/** La grana della pietra nel rombo: 128px, dall'angolo del rombo (non ruotata a parte). */
function fillPatternLocal(ctx: CanvasRenderingContext2D, box: Box): void {
  if (!stonePattern) return;
  fillPattern(ctx, stonePattern, box, 128, 128, box.x, box.y);
}

/** I due anelli del Nexus (createNexusMark): viewBox 40×28, adattato al riquadro. */
function paintRings(ctx: CanvasRenderingContext2D, box: Box, ring: string, gap: string): void {
  const scale = Math.min(box.w / 40, box.h / 28);
  ctx.save();
  ctx.translate(box.x + (box.w - 40 * scale) / 2, box.y + (box.h - 28 * scale) / 2);
  ctx.scale(scale, scale);
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = ring;
  for (const cx of [14, 26]) {
    ctx.beginPath();
    ctx.arc(cx, 15, 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  const arc = new Path2D("M 17.25 7.69 A 8 8 0 0 1 21.61 12.53");
  ctx.lineWidth = 5.6;
  ctx.strokeStyle = gap;
  ctx.stroke(arc);
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = ring;
  ctx.stroke(arc);
  ctx.restore();
}

interface Right {
  h: number;
  draw(ctx: CanvasRenderingContext2D, top: number, barH: number, placedLines: PlacedLine[]): void;
}

const RIGHT_EDGE = CONTENT_X + CONTENT_W;

function rightPart(face: FaceModel, p: Palette): Right {
  const right = face.right;
  if (right.kind === "hp" || right.kind === "dash") {
    // .titlebar > .hp: il serif della carta, corpo pieno, rubino chiaro.
    const font = serif(EM, 400);
    const text = right.kind === "hp" ? `${right.value} ${right.label}` : "—";
    const lineH = CARD_LINE * EM;
    const padY = face.fullArt ? 0.08 * EM : 0;
    const padX = face.fullArt ? 0.35 * EM : 0;
    const h = lineH + 2 * padY;
    return {
      h,
      draw(ctx, top, barH, placedLines) {
        const w = textWidth(font, text) + 2 * padX;
        const box: Box = { x: RIGHT_EDGE - w, y: top + (barH - h) / 2, w, h };
        const band = snapBox(ctx, box);
        const shadows: TextShadow[] | undefined = face.fullArt ? [{ x: 0, y: 1, blur: 2, color: "rgba(0,0,0,.75)" }, { x: 0, y: 0, blur: 8, color: "rgba(0,0,0,.5)" }] : undefined;
        if (face.fullArt) {
          const shape = roundRect(band, 3);
          blurBehind(ctx, shape, 2);
          ctx.fillStyle = "rgba(10,8,6,.58)";
          ctx.fill(shape);
        }
        const baseline = box.y + padY + textExtent(font, lineH).ascent;
        let x = box.x + padX;
        if (right.kind === "hp") {
          // Il numero e l'etichetta sono due nodi di testo nel sito: si annotano separati.
          const number = right.value;
          drawText(ctx, { kind: "text", text: number, font, color: p.rubyLight, shadows }, x, baseline);
          recordText(placedLines, number, font, x, baseline);
          x += textWidth(font, `${number} `);
          drawText(ctx, { kind: "text", text: right.label, font, color: p.rubyLight, shadows }, x, baseline);
          recordText(placedLines, right.label, font, x, baseline);
        } else {
          drawText(ctx, { kind: "text", text, font, color: p.rubyLight, shadows }, x, baseline);
          recordText(placedLines, text, font, x, baseline);
        }
      },
    };
  }
  if (right.kind === "power") {
    // .power-badge: le spade (1.2em) e la cifra, allineate a destra, alte 2.15em.
    const font = serif(EM, 600);
    const text = String(right.value);
    return {
      h: COST,
      draw(ctx, top, barH, placedLines) {
        const w = textWidth(font, text);
        const cy = top + barH / 2;
        const x = RIGHT_EDGE - w;
        const lineH = CARD_LINE * EM;
        const baseline = cy - lineH / 2 + textExtent(font, lineH).ascent;
        drawText(ctx, { kind: "text", text, font, color: p.rubyLight }, x, baseline);
        recordText(placedLines, text, font, x, baseline);
        paintSwords(ctx, x - 0.26 * EM - 1.2 * EM, cy - 0.6 * EM, 1.2 * EM, p.rubyLight);
      },
    };
  }
  if (right.kind === "matter") {
    // .matter-identity: il medaglione a 2.1em e il grado, sulla pietra scura.
    const size = 2.1 * EM;
    return {
      h: size,
      draw(ctx, top, barH, placedLines) {
        const grade = right.matter.grade ? roman(right.matter.grade) : "";
        const font = serif(EM, 700);
        const gradeW = grade ? textWidth(font, grade) : 0;
        const w = size + (grade ? 0.45 * EM + gradeW : 0);
        const x = RIGHT_EDGE - w;
        const cy = top + barH / 2;
        paintMedallion(ctx, right.matter.type, x, cy - size / 2, size);
        if (grade) {
          const baseline = cy - EM / 2 + textExtent(font, EM).ascent + 0.09 * EM;
          const gx = x + size + 0.45 * EM;
          drawText(ctx, { kind: "text", text: grade, font, color: "#f3efe6" }, gx, baseline);
          recordText(placedLines, grade, font, gx, baseline);
        }
      },
    };
  }
  return { h: 0, draw() {} };
}

function paintSwords(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  const line = (x1: number, y1: number, x2: number, y2: number, w: number): void => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  line(4.8, 19.2, 19.8, 4.2, 2);
  line(19.2, 19.2, 4.2, 4.2, 2);
  line(4.3, 15.4, 8.6, 19.7, 1.5);
  line(19.7, 15.4, 15.4, 19.7, 1.5);
  for (const cx of [3.4, 20.6]) {
    ctx.beginPath();
    ctx.arc(cx, 20.6, 1.15, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const MATTER_COLORS: Record<string, [string, string]> = {
  destructive: ["#9e0f34", "#e56a86"],
  dynamic: ["#6b7280", "#e5e7eb"],
  dimensional: ["#3d4c99", "#9ba9ff"],
  dominant: ["#5e2d85", "#c597ec"],
};

/** Il medaglione di una Materia (createMatter): viewBox 20×20. */
function paintMedallion(ctx: CanvasRenderingContext2D, type: string, x: number, y: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 20, size / 20);
  if (type === "zero") {
    ctx.beginPath();
    ctx.arc(10, 10, 9, 0, Math.PI * 2);
    ctx.fillStyle = "#23232b";
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "#8f93a3";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(10, 10, 4.6, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#d6d9e4";
    ctx.stroke();
  } else {
    const [fill, stroke] = MATTER_COLORS[type] ?? ["#40404a", "#a7a7b0"];
    ctx.beginPath();
    ctx.arc(10, 10, 9, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.font = "8px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.letterSpacing = "0px";
    ctx.fontVariantCaps = "normal";
    ctx.fillStyle = "#fff";
    ctx.fillText(type.slice(0, 1).toUpperCase(), 10, 13);
  }
  ctx.restore();
}

function roman(value: number): string {
  const numerals: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let number = value;
  let result = "";
  for (const [amount, symbol] of numerals) {
    while (number >= amount) {
      result += symbol;
      number -= amount;
    }
  }
  return result;
}

// ========================================================= parole chiave

interface KeywordLine {
  h: number;
  draw(ctx: CanvasRenderingContext2D, top: number, record: (line: TextLine, dx: number, dy?: number) => void): void;
}

const KEYWORD = 0.85 * EM;

function keywordLine(keyword: { name: string; rules: string }, fullArt: boolean, p: Palette): KeywordLine {
  // .keyword: centrata, .85em, maiuscoletto rubino chiaro; ✠ ai lati (.cathedral), gap .6em.
  const padY = fullArt ? 0.22 * KEYWORD : 0;
  const lineH = CARD_LINE * KEYWORD;
  const h = lineH + 2 * padY;
  return {
    h,
    draw(ctx, top, record) {
      const spanFont = serif(KEYWORD, 400);
      const crossFont = serif(0.8 * KEYWORD, 400, { caps: true, spacing: 0.08 * 0.8 * KEYWORD });
      const color = fullArt ? "#d9d4ca" : p.muted;
      const gap = 0.6 * KEYWORD;
      const shadows: TextShadow[] | undefined = fullArt ? [{ x: 0, y: 1, blur: 2, color: "rgba(0,0,0,.75)" }, { x: 0, y: 0, blur: 8, color: "rgba(0,0,0,.5)" }] : undefined;
      const parts = [
        { text: "✠", font: crossFont, color: p.ornament },
        { text: keyword.name, font: spanFont, color },
        { text: keyword.rules, font: spanFont, color },
        { text: "✠", font: crossFont, color: p.ornament },
      ].filter(part => part.text);
      const widths = parts.map(part => textWidth(part.font, part.text));
      const total = widths.reduce((sum, w) => sum + w, 0) + gap * (parts.length - 1);
      if (fullArt) {
        const band = roundRect(snapBox(ctx, { x: CONTENT_X - 0.3 * KEYWORD, y: top, w: CONTENT_W + 0.6 * KEYWORD, h }), 3);
        blurBehind(ctx, band, 2);
        ctx.fillStyle = "rgba(10,8,6,.58)";
        ctx.fill(band);
      }
      let x = CONTENT_X + (CONTENT_W - total) / 2;
      parts.forEach((part, index) => {
        // Ogni pezzo è un elemento flex centrato nella riga: la sua linea è la sua.
        const partLine = CARD_LINE * part.font.size;
        const partTop = top + padY + (lineH - partLine) / 2;
        const line = layout([{ kind: "text", text: part.text, font: part.font, color: part.color, ...(shadows ? { shadows } : {}) }], Infinity, { font: part.font, lineHeight: partLine }, partTop);
        drawLines(ctx, line, x);
        if (part.text !== "✠") record(line[0], x);
        x += widths[index] + gap;
      });
    },
  };
}

/** .divider: flex, line-height 1.48 — alto quanto la sua ◆ a .55em, non quanto la carta. */
const DIVIDER_H = 1.48 * 0.55 * EM;

function paintDivider(ctx: CanvasRenderingContext2D, top: number, p: Palette, placedLines: PlacedLine[]): void {
  // ◆ fra due fili di 3.5em (frame-dim), gap .7em, tutto centrato.
  const font = serif(0.55 * EM, 400);
  const w = textWidth(font, "◆");
  const gap = 0.7 * EM;
  const line = 3.5 * EM;
  const total = line * 2 + gap * 2 + w;
  let x = CONTENT_X + (CONTENT_W - total) / 2;
  const cy = top + DIVIDER_H / 2;
  ctx.fillStyle = p.frameDim;
  const left = snapBox(ctx, { x, y: cy - 0.5, w: line, h: 1 });
  ctx.fillRect(left.x, left.y, left.w, left.h);
  x += line + gap;
  const baseline = top + textExtent(font, DIVIDER_H).ascent;
  drawText(ctx, { kind: "text", text: "◆", font, color: p.ornament }, x, baseline);
  recordText(placedLines, "◆", font, x, baseline);
  x += w + gap;
  ctx.fillStyle = p.frameDim;
  const right = snapBox(ctx, { x, y: cy - 0.5, w: line, h: 1 });
  ctx.fillRect(right.x, right.y, right.w, right.h);
}

// ======================================================= il riquadro del testo

interface Child {
  h: number;
  /** Il margine sotto (la riga del tipo ha .1em). */
  after: number;
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, placedLines: PlacedLine[]): void;
}

function paintBox(ctx: CanvasRenderingContext2D, layoutBox: Box, box: Box, face: FaceModel, p: Palette, slabStyle: Slab, resources: Resources, placedLines: PlacedLine[]): void {
  stonePattern = resources.stone;
  const nexus = face.kind === "nexus";

  // Il fit tipografico (fitTextBoxes) e la seconda passata del simulatore:
  // almeno 14px d'aria sotto l'ultima riga.
  const measure = (f: number) => {
    const padTop = 0.55 * f + 9;
    const padX = 0.7 * f + 9;
    const padBottom = (nexus ? 0.85 : 0.3) * f;
    const children = childNodes(face, f, layoutBox.w - 2 * padX, p, slabStyle);
    const content = children.reduce((sum, child, index) => sum + child.h + child.after + (index ? 0.34 * f : 0), 0);
    return { f, padTop, padX, padBottom, children, content };
  };
  let step = FIT_STEPS[0];
  let layout = measure(step * EM);
  for (const candidate of FIT_STEPS) {
    step = candidate;
    layout = measure(step * EM);
    if (Math.round(layout.padTop + layout.content + layout.padBottom) <= Math.round(layoutBox.h)) break;
  }
  for (let guard = 0; guard < 3 && layoutBox.h - layout.padTop - layout.content < 14; guard += 1) {
    if (step <= 0.6) break;
    step = Math.round((step - 0.04) * 100) / 100;
    layout = measure(step * EM);
  }
  const f = layout.f;

  // Il castone: pietra scura, crepe al neon (--castone), ritagliato a ottagono .7em.
  ctx.save();
  ctx.clip(octagon(box, 0.7 * f));
  fillLinear(ctx, box, 180, [["#171416", 0], ["#211d1f", "45%"], ["#302a2d", "100%"]]);
  fillPattern(ctx, resources.stone, box, 256, 256, box.x, box.y);
  const cracks = resources.cracks[face.tint];
  ctx.drawImage(cracks.glow, box.x, box.y, box.w, box.h);
  ctx.drawImage(cracks.cores, box.x, box.y, box.w, box.h);
  insetShadow(ctx, box, 0, { x: 0, y: 0, blur: 0, spread: 1, color: "rgba(0,0,0,.35)" });
  insetShadow(ctx, box, 0, { x: 0, y: -1, blur: 0, color: "rgba(255,235,240,.22)" });
  insetShadow(ctx, box, 0, { x: 0, y: 2, blur: 6, color: "rgba(0,0,0,.7)" });

  // ::before — la lastra di pietra chiara, inset 9px, ottagono .5em.
  const slab: Box = { x: box.x + 9, y: box.y + 9, w: box.w - 18, h: box.h - 18 };
  const inner: Box = { x: slab.x + 1, y: slab.y + 1, w: slab.w - 2, h: slab.h - 2 };
  ctx.save();
  ctx.clip(octagon(slab, 0.5 * f));
  ctx.save();
  ctx.beginPath();
  ctx.rect(slab.x, slab.y, slab.w, slab.h);
  ctx.clip();
  fillLinear(ctx, { ...inner, y: slab.y, h: slab.h }, 180, [["#e9e6e2", 0], ["#ddd9d4", "55%"], ["#cfcac5", "100%"]]);
  fillPattern(ctx, resources.stone, slab, 256, 256, inner.x, inner.y);
  fillRadial(ctx, slab, 1.1 * inner.w, 0.7 * inner.h, inner.x + inner.w / 2, inner.y - 0.1 * inner.h, [["rgba(255,255,255,.5)", 0], ["rgba(255,255,255,0)", "60%"]]);
  ctx.restore();
  // Il bordo (1px, slab-edge) e le ombre interne della lastra.
  const ring = new Path2D();
  ring.rect(slab.x, slab.y, slab.w, slab.h);
  ring.rect(inner.x, inner.y, inner.w, inner.h);
  ctx.fillStyle = p.slabEdge;
  ctx.fill(ring, "evenodd");
  insetShadow(ctx, inner, 0, { x: 0, y: 1, blur: 0, color: "rgba(255,255,255,.35)" });
  insetShadow(ctx, inner, 0, { x: 0, y: 0, blur: 22, color: `rgba(${p.slabTintRgb},.16)` });
  insetShadow(ctx, inner, 0, { x: 0, y: -2, blur: 5, color: `rgba(${p.slabShadowRgb},.22)` });
  insetShadow(ctx, inner, 0, { x: 0, y: 3, blur: 7, color: `rgba(${p.slabShadowRgb},.42)` });
  insetShadow(ctx, inner, 0, { x: 0, y: 0, blur: 0, spread: 1, color: `rgba(${p.slabLineRgb},.5)` });
  ctx.restore();

  // ::after — la filigrana del rombo nel vuoto in basso.
  const notch: Box = { x: box.x + box.w / 2 - 2.1 * f, y: box.y + box.h - 1.2 * f - 5.2 * f, w: 4.2 * f, h: 5.2 * f };
  ctx.save();
  ctx.clip(polygon(notch, [[0.5, 0], [1, 0.46], [0.5, 1], [0, 0.46]]));
  fillLinear(ctx, notch, 180, [[`rgba(${p.hairRgb},.09)`, 0], [`rgba(${p.hairRgb},.025)`, 1]]);
  ctx.restore();

  // Il testo.
  let y = layoutBox.y + layout.padTop;
  layout.children.forEach((child, index) => {
    if (index) y += 0.34 * f;
    child.draw(ctx, layoutBox.x + layout.padX, y, placedLines);
    y += child.h + child.after;
  });

  // Il codice carta, in basso a destra (.t49 .textbox .card-id).
  const codeFont: Font = { size: 11.5, weight: 600, family: MONO, spacing: 0.08 * 11.5 };
  const codeW = textWidth(codeFont, face.code);
  const codeBottom = layoutBox.y + layoutBox.h - (4 + 9);
  const codeBaseline = codeBottom - 11.5 + textExtent(codeFont, 11.5).ascent;
  const codeX = layoutBox.x + layoutBox.w - (10 + 9) - codeW;
  drawText(ctx, { kind: "text", text: face.code, font: codeFont, color: "#8d8589" }, codeX, codeBaseline);
  recordText(placedLines, face.code, codeFont, codeX, codeBaseline);
  ctx.restore();
}

function childNodes(face: FaceModel, f: number, width: number, p: Palette, slabStyle: Slab): Child[] {
  const out: Child[] = [];
  if (face.textline) out.push(typeRow(face.textline, f, width, p, slabStyle));
  for (const block of face.blocks) out.push(blockOf(block, f, width, p, slabStyle));
  return out;
}

function typeRow(textline: { type: string; idents: (Medallion | CounterStat)[] }, f: number, width: number, p: Palette, slabStyle: Slab): Child {
  const m = 0.92 * f;
  const typeFont = serif(m, 400, { caps: true, spacing: 0.12 * m });
  const typeLine = BOX_LINE * m;
  const idents = textline.idents.map(ident => identity(ident, m, slabStyle));
  const identH = Math.max(0, ...idents.map(ident => ident.h));
  const rowH = Math.max(textline.type ? typeLine : 0, identH);
  const h = 0.1 * f + rowH + 0.4 * f;
  return {
    h,
    after: 0.1 * f,
    draw(ctx, x, y, placedLines) {
      const rowTop = y + 0.1 * f;
      if (textline.type) {
        const line = layout([{ kind: "text", text: textline.type, font: typeFont, color: p.typeInk }], Infinity, { font: typeFont, lineHeight: typeLine }, rowTop + (rowH - typeLine) / 2);
        drawLines(ctx, line, x);
        recordLine(placedLines, line[0], x);
      }
      const gap = 0.4 * f;
      const total = idents.reduce((sum, ident) => sum + ident.w, 0) + gap * Math.max(0, idents.length - 1);
      let ix = x + width - total;
      for (const ident of idents) {
        ident.draw(ctx, ix, rowTop + (rowH - ident.h) / 2, placedLines);
        ix += ident.w + gap;
      }
      // Il filo sotto la riga: rubino che sfuma verso destra.
      fillLinear(ctx, snapBox(ctx, { x, y: y + h - 1, w: width, h: 1 }), 90, [[`rgba(${p.hairRgb},.55)`, 0], [`rgba(${p.hairRgb},.12)`, "70%"], [`rgba(${p.hairRgb},0)`, "100%"]]);
    },
  };
}

function identity(ident: Medallion | CounterStat, m: number, slabStyle: Slab): { w: number; h: number; draw(ctx: CanvasRenderingContext2D, x: number, y: number, placedLines: PlacedLine[]): void } {
  const icon = 1.2 * m;
  const gap = 0.45 * m;
  if (ident.kind === "matter") {
    // .card.cathedral.t49 .textbox .matter: niente scatola, padding .12em .1em; il grado scuro.
    const font = serif(m, 700);
    const grade = ident.grade ? roman(ident.grade) : "";
    const gradeW = grade ? textWidth(font, grade) : 0;
    const padX = 0.1 * m;
    const padY = 0.12 * m;
    const inner = Math.max(icon, grade ? m : 0);
    const w = padX * 2 + icon + (grade ? gap + gradeW : 0);
    const h = padY * 2 + inner;
    return {
      w,
      h,
      draw(ctx, x, y, placedLines) {
        paintMedallion(ctx, ident.type, x + padX, y + padY + (inner - icon) / 2, icon);
        if (grade) {
          const top = y + padY + (inner - m) / 2 + 0.09 * m;
          const baseline = top + textExtent(font, m).ascent;
          const gx = x + padX + icon + gap;
          drawText(ctx, { kind: "text", text: grade, font, color: "#3a3034" }, gx, baseline);
          recordText(placedLines, grade, font, gx, baseline);
        }
      },
    };
  }
  // .counter-badge dentro la lastra: scatola chiara, filo #c6c0bc, freccia e «+N».
  const font = serif(m, 700);
  const text = `+${ident.value}`;
  const textW = textWidth(font, text);
  const lineH = BOX_LINE * m;
  const padX = 0.42 * m;
  const padY = 0.12 * m;
  const inner = Math.max(icon, lineH);
  const w = 2 + padX * 2 + icon + gap + textW;
  const h = 2 + padY * 2 + inner;
  return {
    w,
    h,
    draw(ctx, x, y, placedLines) {
      const box: Box = snapBox(ctx, { x, y, w, h });
      ctx.fillStyle = "#c6c0bc";
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = "#f4f2f0";
      ctx.fillRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
      const ix = x + 1 + padX;
      const iy = y + 1 + padY + (inner - icon) / 2;
      ctx.save();
      ctx.translate(ix, iy);
      ctx.scale(icon / 20, icon / 20);
      ctx.strokeStyle = slabStyle.rubyLight;
      ctx.lineWidth = 1.8;
      ctx.stroke(new Path2D("M 4.5 12.5 A 6 6 0 1 1 10 16.5"));
      ctx.lineCap = "round";
      ctx.stroke(new Path2D("M 4.5 12.5 L 2 9.8 M 4.5 12.5 L 8 11.2"));
      ctx.restore();
      const top = y + 1 + padY + (inner - lineH) / 2;
      const baseline = top + textExtent(font, lineH).ascent;
      const tx = ix + icon + gap;
      drawText(ctx, { kind: "text", text, font, color: slabStyle.rubyLight }, tx, baseline);
      recordText(placedLines, text, font, tx, baseline);
    },
  };
}

function blockOf(block: TextBlock, f: number, width: number, p: Palette, slabStyle: Slab): Child {
  const body = serif(f, 400);
  const strut = { font: body, lineHeight: BOX_LINE * f };
  const text = (value: string, font: Font = body, color = slabStyle.ink): Piece => ({ kind: "text", text: value, font, color });

  if (block.kind === "requirement") {
    // .requirement: .92em, padding .22em .45em, pozzo chiaro e filo; gli anelli in linea.
    const m = 0.92 * f;
    const font = serif(m, 400);
    const padY = 0.22 * m;
    const padX = 0.45 * m;
    const markW = 1.55 * m;
    const markH = 1.1 * m;
    const mark: BoxPiece = {
      kind: "box",
      w: markW + 0.38 * m,
      // vertical-align: -.26em — il fondo degli anelli scende sotto la linea di base.
      ascent: markH - 0.26 * m,
      descent: 0.26 * m,
      draw: (ctx, x, baseline) => paintRings(ctx, { x, y: baseline + 0.26 * m - markH, w: markW, h: markH }, slabStyle.rubyLight, p.bg),
    };
    const lines = layout([mark, text(block.text, font)], width - 2 * padX - 2, { font, lineHeight: BOX_LINE * m });
    const linesH = lines.reduce((sum, line) => sum + line.height, 0);
    const h = 2 + 2 * padY + linesH;
    return {
      h,
      after: 0,
      draw(ctx, x, y, placedLines) {
        const frame = snapBox(ctx, { x, y, w: width, h });
        ctx.fillStyle = slabStyle.frameDim;
        ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
        ctx.fillStyle = slabStyle.well;
        ctx.fillRect(frame.x + 1, frame.y + 1, frame.w - 2, frame.h - 2);
        const dx = x + 1 + padX;
        const dy = y + 1 + padY;
        drawLines(ctx, lines, dx, dy);
        for (const line of lines) recordLine(placedLines, line, dx, dy);
      },
    };
  }

  if (block.kind === "effect") {
    const pieces: Piece[] = [];
    if (block.behavior) {
      // Il simbolo del comportamento (1.1em, vertical-align -.18em, margine .18em) e la parola in grassetto.
      const icon = 1.1 * f;
      const behavior = block.behavior.id;
      pieces.push({
        kind: "box",
        w: icon + 0.18 * f,
        ascent: icon - 0.18 * f,
        descent: 0.18 * f,
        draw: (ctx, x, baseline) => paintBehavior(ctx, behavior, x, baseline + 0.18 * f - icon, icon, slabStyle),
      });
      pieces.push(text(" "), text(block.behavior.label, serif(f, 700), slabStyle.accent), text(". "));
    }
    pieces.push(text(block.text));
    return paragraph(pieces, width, strut);
  }

  if (block.kind === "fx") {
    // .fx .tag: .85em, maiuscole spaziate, rubino; il filo che sfuma (2px) riempie la riga.
    const t = 0.85 * f;
    const tagFont = serif(t, 400, { upper: true, spacing: 0.12 * t });
    const tagLine = BOX_LINE * t;
    const bodies = block.bodies.map(entry => {
      const pieces: Piece[] = [];
      if (entry.name) pieces.push(text(entry.name, serif(f, 600), slabStyle.accent), text(": "));
      pieces.push(text(entry.text));
      return layout(pieces, width, strut);
    });
    const tagGap = 0.22 * t;
    // La riga dell'etichetta è flex: il testo e il filo (flex: 1, base 0) con .8em fra loro.
    // Il testo prende quanto gli serve; se non ci sta, va a capo e il filo resta a zero.
    const tagTextW = width - 0.8 * t;
    const tag = layout([{ kind: "text", text: block.tag, font: tagFont, color: slabStyle.rubyLight }], tagTextW, { font: tagFont, lineHeight: tagLine });
    const tagH = tag.reduce((sum, line) => sum + line.height, 0);
    const h = tagH + tagGap + bodies.reduce((sum, lines) => sum + lines.reduce((s, line) => s + line.height, 0), 0);
    return {
      h,
      after: 0,
      draw(ctx, x, y, placedLines) {
        drawLines(ctx, tag, x, y);
        for (const line of tag) recordLine(placedLines, line, x, y);
        const textW = tag.length === 1 ? tag[0].width : tagTextW;
        const lineX = x + textW + 0.8 * t;
        if (x + width - lineX > 0) fillLinear(ctx, snapBox(ctx, { x: lineX, y: y + tagH / 2 - 1, w: x + width - lineX, h: 2 }), 90, [[p.tagInk, 0], [transparentOf(p.tagInk), "100%"]]);
        let by = y + tagH + tagGap;
        for (const lines of bodies) {
          drawLines(ctx, lines, x, by);
          for (const line of lines) recordLine(placedLines, line, x, by);
          by += lines.reduce((sum, line) => sum + line.height, 0);
        }
      },
    };
  }

  // L'abilità: la pastiglia del costo (−N PV, +N PV, N Flusso), il nome in grassetto, il testo.
  const c = 0.9 * f;
  const chipFont = serif(c, 400);
  const chipLine = BOX_LINE * c;
  const padX = 0.3 * c;
  const flux = block.cost.kind === "flux";
  const icon = 1.15 * c;
  const contentW = textWidth(chipFont, block.cost.value) + (flux ? 0.22 * c + icon : 0);
  const chipW = 2 + 2 * padX + contentW;
  const chipH = 2 + chipLine;
  const chipExtent = textExtent(chipFont, chipLine);
  const color = block.cost.kind === "gain" ? slabStyle.hpGreen : slabStyle.rubyLight;
  const cost = block.cost;
  let chipText: { x: number; baseline: number } | null = null;
  const chip: BoxPiece = {
    kind: "box",
    w: chipW + 0.15 * c,
    ascent: 1 + chipExtent.ascent,
    descent: chipH - 1 - chipExtent.ascent,
    draw: (ctx, x, baseline) => {
      const top = baseline - 1 - chipExtent.ascent;
      const frame = snapBox(ctx, { x, y: top, w: chipW, h: chipH });
      ctx.fillStyle = "#c6c0bc";
      ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
      ctx.fillStyle = "#f4f2f0";
      ctx.fillRect(frame.x + 1, frame.y + 1, frame.w - 2, frame.h - 2);
      const tx = x + 1 + padX;
      drawText(ctx, { kind: "text", text: cost.value, font: chipFont, color }, tx, baseline);
      chipText = { x: tx, baseline };
      if (flux) paintFlux(ctx, tx + textWidth(chipFont, cost.value) + 0.22 * c, baseline + 0.2 * c - icon, icon, p);
    },
  };
  const para = paragraph([chip, text(" "), text(block.name, serif(f, 600), slabStyle.accent), text(": "), text(block.text)], width, strut);
  return {
    ...para,
    draw(ctx, x, y, placedLines) {
      para.draw(ctx, x, y, placedLines);
      if (chipText) recordText(placedLines, cost.value, chipFont, (chipText as { x: number }).x, (chipText as { baseline: number }).baseline);
    },
  };
}

function paragraph(pieces: Piece[], width: number, strut: { font: Font; lineHeight: number }): Child {
  const lines = layout(pieces, width, strut);
  const h = lines.reduce((sum, line) => sum + line.height, 0);
  return {
    h,
    after: 0,
    draw(ctx, x, y, placedLines) {
      drawLines(ctx, lines, x, y);
      for (const line of lines) recordLine(placedLines, line, x, y);
    },
  };
}

function paintBehavior(ctx: CanvasRenderingContext2D, behavior: "reactive" | "permanent", x: number, y: number, size: number, slabStyle: Slab): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 20, size / 20);
  if (behavior === "reactive") {
    const bolt = new Path2D("M 11.2 1.5 L 4.4 11.2 H 8.6 L 7.4 18.5 L 15.6 8.2 H 10.6 Z");
    ctx.fillStyle = slabStyle.accent;
    ctx.fill(bolt);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = slabStyle.frameDim;
    ctx.stroke(bolt);
  } else {
    ctx.beginPath();
    ctx.arc(10, 10, 6.5, 0, Math.PI * 2);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = slabStyle.accent;
    ctx.stroke();
  }
  ctx.restore();
}

function paintFlux(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, p: Palette): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 20, size / 20);
  ctx.translate(10, 10);
  ctx.rotate(Math.PI / 4);
  const rect = new Path2D();
  rect.roundRect(-5.4, -5.4, 10.8, 10.8, 1);
  ctx.fillStyle = p.ruby;
  ctx.fill(rect);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = p.rubyLight;
  ctx.stroke(rect);
  ctx.rotate(-Math.PI / 4);
  ctx.translate(-10, -10);
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 1;
  ctx.stroke(new Path2D("M 10 5.8 L 13.2 10 L 10 14.2"));
  ctx.restore();
}

// ================================================================ le righe

function recordText(placedLines: PlacedLine[], text: string, font: Font, x: number, baseline: number): void {
  const { ascent, descent } = fontMetrics(font);
  placedLines.push({ text, x: round(x), y: round(baseline - ascent), w: round(textWidth(font, text)), h: ascent + descent, body: font.size });
}

/** Una riga impaginata: un'annotazione per pezzo di testo contiguo (come i nodi di testo del sito). */
function recordLine(placedLines: PlacedLine[], line: TextLine, dx: number, dy = 0): void {
  let current: { text: string; x: number; font: Font; source: unknown; end: number } | null = null;
  const flush = (): void => {
    if (current) recordText(placedLines, current.text, current.font, current.x, line.baseline + dy);
    current = null;
  };
  for (const item of line.items) {
    if (item.sourcePiece.kind !== "text") {
      flush();
      continue;
    }
    const piece = item.sourcePiece;
    const source = item.source;
    if (current && current.source === source) {
      const gap = dx + item.x - current.end;
      current.text += `${gap > 0.5 ? " " : ""}${piece.text}`;
      current.end = dx + item.x + item.w;
    } else {
      flush();
      current = { text: piece.text, x: dx + item.x, font: piece.font, source, end: dx + item.x + item.w };
    }
  }
  flush();
}

const round = (value: number): number => Math.round(value * 10) / 10;

// Il contesto di disegno dei testi in uso nell'impaginazione: serve a chi
// misura fuori dal pittore.
export { applyFont };
