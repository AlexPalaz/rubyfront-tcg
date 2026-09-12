// L'impaginazione del testo della carta, come la fa il browser: le parole
// misurate dal motore dei caratteri del canvas (lo stesso della pagina), le
// righe spezzate agli spazi, e le «line box» del CSS — ogni pezzo in linea
// porta sopra e sotto la linea di base la sua altezza (il testo con la sua
// mezza interlinea, le pastiglie inline-block con la loro linea di base, le
// icone col loro vertical-align), e la riga è alta quanto il pezzo più alto
// sopra più il più basso sotto, mai meno del «montante» del paragrafo.

import { shadowOnly, snapY } from "./css";

export interface Font {
  size: number;
  weight: number;
  family: string;
  italic?: boolean;
  /** font-variant: small-caps */
  caps?: boolean;
  /** letter-spacing, in px */
  spacing?: number;
  /** text-transform: uppercase */
  upper?: boolean;
}

export interface TextShadow {
  x: number;
  y: number;
  blur: number;
  color: string;
}

export interface TextPiece {
  kind: "text";
  text: string;
  font: Font;
  color: string;
  shadows?: TextShadow[];
}

/** Un pezzo atomico in linea (inline-block, svg): largo w, alto `ascent` sopra la linea di base e `descent` sotto. */
export interface BoxPiece {
  kind: "box";
  w: number;
  ascent: number;
  descent: number;
  draw(ctx: CanvasRenderingContext2D, x: number, baseline: number): void;
}

export type Piece = TextPiece | BoxPiece;

export interface Placed {
  x: number;
  w: number;
  sourcePiece: Piece;
  /** Il pezzo d'origine (un pezzo di testo si spezza in parole): come un nodo di testo del sito. */
  source: Piece;
}

export interface TextLine {
  top: number;
  height: number;
  baseline: number;
  /** La larghezza occupata (senza gli spazi in coda). */
  width: number;
  items: Placed[];
}

const measure = document.createElement("canvas").getContext("2d")!;

export function fontString(font: Font): string {
  return `${font.italic ? "italic " : ""}${font.weight} ${font.size}px ${font.family}`;
}

export function applyFont(ctx: CanvasRenderingContext2D, font: Font): void {
  ctx.font = fontString(font);
  ctx.fontVariantCaps = font.caps ? "small-caps" : "normal";
  ctx.letterSpacing = `${font.spacing ?? 0}px`;
  ctx.fontKerning = "normal";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
}

function shown(text: string, font: Font): string {
  return font.upper ? text.toLocaleUpperCase() : text;
}

const widthCache = new Map<string, number>();

/** La larghezza di un testo, con spaziatura (anche dopo l'ultimo carattere, come il CSS). */
export function textWidth(font: Font, text: string): number {
  const key = `${fontString(font)}|${font.caps ? 1 : 0}|${font.spacing ?? 0}|${font.upper ? 1 : 0}|${text}`;
  let width = widthCache.get(key);
  if (width === undefined) {
    applyFont(measure, font);
    width = measure.measureText(shown(text, font)).width;
    widthCache.set(key, width);
  }
  return width;
}

const metricCache = new Map<string, { ascent: number; descent: number }>();

/** L'ascendente e il discendente del carattere (la «content area» del CSS). */
export function fontMetrics(font: Font): { ascent: number; descent: number } {
  const key = `${fontString(font)}|${font.caps ? 1 : 0}`;
  let metrics = metricCache.get(key);
  if (!metrics) {
    applyFont(measure, font);
    const m = measure.measureText("Hg");
    // Blink impagina con ascendente e discendente arrotondati al pixel.
    metrics = { ascent: Math.round(m.fontBoundingBoxAscent), descent: Math.round(m.fontBoundingBoxDescent) };
    metricCache.set(key, metrics);
  }
  return metrics;
}

/**
 * Quanto un testo di quel carattere occupa sopra e sotto la linea di base,
 * con la sua interlinea. Blink mette la linea di base a un numero INTERO di
 * px dalla cima della riga: floor(ascendente + mezza interlinea) — misurato
 * su tutti i corpi e le interlinee della carta (confronto, 2026-09-11).
 */
export function textExtent(font: Font, lineHeight: number): { ascent: number; descent: number } {
  const { ascent, descent } = fontMetrics(font);
  const above = Math.floor(ascent + (lineHeight - (ascent + descent)) / 2);
  return { ascent: above, descent: lineHeight - above };
}

interface Atom {
  sourcePiece: Piece;
  text: string;
  w: number;
  space: boolean;
  /** Dopo questo atomo si può andare a capo anche senza spazio (dopo un trattino). */
  breakAfter: boolean;
}

/**
 * Le parole si spezzano anche dopo i trattini, come fa Chrome con le regole
 * di Unicode (UAX #14): dopo «–» e «—» (e prima di «—»), e dopo «-» salvo
 * davanti a una cifra («-5» resta unito). «con 14–19» va a capo dopo «14–».
 */
function splitAtDashes(word: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < word.length; index += 1) {
    const ch = word[index];
    const next = word[index + 1] ?? "";
    const breakAfter = next !== "" && (ch === "–" || ch === "—" || (ch === "-" && !/\d/.test(next)));
    const breakBefore = ch === "—" && index > start;
    if (breakBefore) {
      parts.push(word.slice(start, index));
      start = index;
    }
    if (breakAfter) {
      parts.push(word.slice(start, index + 1));
      start = index + 1;
    }
  }
  parts.push(word.slice(start));
  return parts.filter(Boolean);
}

function atomsOf(pieces: Piece[]): Atom[] {
  const atoms: Atom[] = [];
  for (const sourcePiece of pieces) {
    if (sourcePiece.kind === "box") {
      atoms.push({ sourcePiece, text: "", w: sourcePiece.w, space: false, breakAfter: false });
      continue;
    }
    // Le parole e gli spazi (normali: lo spazio indivisibile tiene unite le parole).
    for (const part of sourcePiece.text.split(/( +)/)) {
      if (!part) continue;
      if (/^ +$/.test(part)) {
        atoms.push({ sourcePiece, text: part, w: textWidth(sourcePiece.font, part), space: true, breakAfter: false });
        continue;
      }
      const pieces = splitAtDashes(part);
      pieces.forEach((piece, index) => {
        atoms.push({ sourcePiece, text: piece, w: textWidth(sourcePiece.font, piece), space: false, breakAfter: index < pieces.length - 1 });
      });
    }
  }
  return atoms;
}

/**
 * Impagina i pezzi in righe larghe al più `maxWidth`, a partire da `top`.
 * `strut` è il carattere del paragrafo con la sua interlinea: ogni riga è
 * alta almeno quanto lui (il «montante» del CSS).
 */
export function layout(pieces: Piece[], maxWidth: number, strut: { font: Font; lineHeight: number }, top = 0): TextLine[] {
  const atoms = atomsOf(pieces);
  const lines: Atom[][] = [];
  let line: Atom[] = [];
  let width = 0;
  let lastBreak = -1;
  for (const atom of atoms) {
    if (atom.space) {
      line.push(atom);
      width += atom.w;
      lastBreak = line.length;
      continue;
    }
    if (width + atom.w > maxWidth + 0.01 && lastBreak > 0) {
      // Si va a capo all'ultima occasione (uno spazio, un trattino): quel che segue passa alla riga nuova.
      const carry = line.slice(lastBreak);
      lines.push(line.slice(0, lastBreak));
      line = carry;
      width = carry.reduce((sum, item) => sum + item.w, 0);
      lastBreak = -1;
      for (let index = 0; index < line.length; index += 1) if (line[index].space || line[index].breakAfter) lastBreak = index + 1;
    }
    line.push(atom);
    width += atom.w;
    if (atom.breakAfter) lastBreak = line.length;
  }
  if (line.length) lines.push(line);

  const strutExtent = textExtent(strut.font, strut.lineHeight);
  const out: TextLine[] = [];
  let y = top;
  for (const atomsOnLine of lines) {
    // Gli spazi in coda non occupano posto (e non si disegnano).
    let end = atomsOnLine.length;
    while (end > 0 && atomsOnLine[end - 1].space) end -= 1;
    const visible = atomsOnLine.slice(0, end);
    let above = strutExtent.ascent;
    let below = strutExtent.descent;
    let x = 0;
    const items: Placed[] = [];
    for (const atom of visible) {
      const extent =
        atom.sourcePiece.kind === "box"
          ? { ascent: atom.sourcePiece.ascent, descent: atom.sourcePiece.descent }
          : textExtent(atom.sourcePiece.font, (strut.lineHeight / strut.font.size) * atom.sourcePiece.font.size);
      above = Math.max(above, extent.ascent);
      below = Math.max(below, extent.descent);
      if (!atom.space) items.push({ x, w: atom.w, sourcePiece: atom.sourcePiece.kind === "text" ? { ...atom.sourcePiece, text: atom.text } : atom.sourcePiece, source: atom.sourcePiece });
      x += atom.w;
    }
    out.push({ top: y, height: above + below, baseline: y + above, width: x, items });
    y += above + below;
  }
  return out;
}

/** Disegna le righe, spostate di (dx, dy). */
export function drawLines(ctx: CanvasRenderingContext2D, lines: TextLine[], dx: number, dy = 0): void {
  for (const line of lines) {
    for (const item of line.items) {
      if (item.sourcePiece.kind === "box") item.sourcePiece.draw(ctx, dx + item.x, dy + line.baseline);
      else drawText(ctx, item.sourcePiece, dx + item.x, dy + line.baseline);
    }
  }
}

/** Un pezzo di testo sulla sua linea di base, con le sue ombre (text-shadow: la prima sta sopra). */
export function drawText(ctx: CanvasRenderingContext2D, sourcePiece: TextPiece, x: number, rawBaseline: number): void {
  const text = shown(sourcePiece.text, sourcePiece.font);
  // Chrome posa i glifi su una linea di base a pixel intero del dispositivo
  // (in orizzontale no: lì tiene il sottopixel).
  const baseline = snapY(ctx, rawBaseline);
  ctx.save();
  applyFont(ctx, sourcePiece.font);
  // Solo le ombre prima (text-shadow: la prima della lista sta sopra), poi il testo.
  for (const shadow of [...(sourcePiece.shadows ?? [])].reverse()) {
    shadowOnly(ctx, shadow, () => {
      ctx.fillStyle = "#000";
      ctx.fillText(text, x, baseline);
    });
  }
  ctx.fillStyle = sourcePiece.color;
  ctx.fillText(text, x, baseline);
  ctx.restore();
}

/** L'altezza complessiva di un gruppo di righe. */
export function totalHeight(lines: TextLine[]): number {
  return lines.reduce((sum, line) => sum + line.height, 0);
}
