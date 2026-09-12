// L'aspetto del tavolo: il tema «Notte» del simulatore (scelta del designer,
// 2026-09-12: tutto il gioco scuro) — le variabili di :root di
// simulatore/src/style.css e il blocco body[data-ui-theme="notte"]
// trascritti per il gioco. La stanza è la valle di ghiaccio sfocata sotto un
// velo scuro e la grana di grafite; i campi sono castoni al neon nella TINTA
// del mazzo del posto (rubino le Distruttive, blu le Dimensionali, argento
// le Dinamiche: core/cards deckTint), con la lastra di pietra fumé; gli slot
// alloggi al neon; targhe e pannelli piastre brunite col filo di luce. E gli
// attrezzi per dipingere i pezzi d'interfaccia col canvas, come le carte.

import type { Tint } from "@rubyfront/core/cards";
import { Sprite, Texture, type SpriteOptions } from "pixi.js";
import stoneUrl from "./night-stone.png";

export const SANS = '"Space Grotesk Variable", ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** I colori del tema notte, come stringhe CSS (li usa il canvas). */
export const THEME = {
  /** --void: il fondo della stanza e delle targhette. */
  background: "#07060a",
  void: "#07060a",
  line: "#3a3037",
  lineFaint: "#29222a",
  /** Lo slot vuoto che non sparisce nel buio (.slot-mark). */
  veil: "rgba(255,255,255,.018)",
  muted: "#9a8e93",
  ink: "#f1eae6",
  /** Le scritte della lavagna sulla valle: avorio, in grassetto, con l'ombra nera. */
  lettering: "#f4f1f3",
  /** --ruby del tema notte: il rubino dei posti e del combattimento. */
  ruby: "#ff4d6d",
  rubyDeep: "#a62640",
  gold: "#d9a84e",
  ok: "#6fbf8b",
  /** --foe: il blocco e le Materie. */
  foe: "#8fb0ff",
  /** --forge: il bagliore rubino della forgia, in cima alla stanza (r, g, b). */
  forge: "166,38,64",
  /** Le piastre brunite (targhe, pannelli, tasti di servizio). */
  plate: { top: "#241d22", bottom: "#120f12" },
  /** --glass-heavy: il vetro delle barre sopra il tavolo. */
  glass: "rgba(11,9,12,.98)",
  /** I distintivi sulle carte in campo (--tess-chip-*). */
  badge: { background: "rgba(14,10,15,.92)", frame: "rgba(229,106,134,.55)", ink: "#e9dfe4", ruby: "#e56a86", shadow: "rgba(0,0,0,.7)", grey: "#b9b4b7" },
  /** Il filo attorno alle carte e la loro ombra (--tile-ring, .tile). */
  cardRing: "rgba(0,0,0,.75)",
  cardShadow: "rgba(0,0,0,.6)",
  /** --tile-veil: il velo della carta che non ti puoi permettere. */
  cardVeil: "rgba(5,4,10,.55)",
} as const;

type Rgb = readonly [number, number, number];

/** La tinta di un posto: la lastra, l'orlo al neon, il nome, il filo del cassetto, gli alloggi degli slot. */
export interface SeatPalette {
  /** --slab-hi / --slab-lo: la lastra, dal centro chiaro agli orli scuri. */
  slabTop: string;
  slabBottom: string;
  /** --edge (r, g, b, alpha). */
  rim: readonly [number, number, number, number];
  /** Il nome del posto sulla targhetta. */
  name: string;
  /** --hand-edge: il filo neon del cassetto della mano. */
  hand: Rgb;
  /** Gli alloggi degli slot (--crk-*-socket): il filo e la barra d'accento. */
  slotFrame: { edge: Rgb; toolbar: Rgb };
}

export const SEAT_PALETTE: Record<Tint, SeatPalette> = {
  destructive: {
    slabTop: "rgba(74,10,28,.74)",
    slabBottom: "rgba(42,6,18,.84)",
    rim: [255, 77, 109, 0.8],
    name: "#ff9fb3",
    hand: [255, 77, 109],
    slotFrame: { edge: [255, 46, 90], toolbar: [255, 122, 150] },
  },
  dimensional: {
    slabTop: "rgba(18,30,92,.74)",
    slabBottom: "rgba(10,16,56,.84)",
    rim: [90, 130, 255, 0.8],
    name: "#b9ccff",
    hand: [90, 130, 255],
    slotFrame: { edge: [64, 110, 255], toolbar: [159, 187, 255] },
  },
  dynamic: {
    slabTop: "rgba(48,52,66,.72)",
    slabBottom: "rgba(26,28,38,.84)",
    rim: [214, 222, 240, 0.75],
    name: "#f1f4fa",
    hand: [214, 222, 240],
    slotFrame: { edge: [190, 215, 255], toolbar: [230, 240, 255] },
  },
};

/** Un colore (r, g, b[, a]) come stringa, con l'alfa moltiplicata per `k` (color-mix con transparent). */
export function rgba(c: readonly number[], k = 1): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${+((c[3] ?? 1) * k).toFixed(3)})`;
}

/** color-mix(in srgb, c 100%, #fff k·100%): il colore schiarito verso il bianco, come il CSS (alfa premoltiplicata). */
export function lighten(c: readonly number[], k: number): string {
  const baseAlpha = c[3] ?? 1;
  const p = 1 / (1 + k);
  const q = k / (1 + k);
  const alpha = baseAlpha * p + q;
  const mix = (v: number): number => Math.round((v * baseAlpha * p + 255 * q) / alpha);
  return `rgba(${mix(c[0]!)},${mix(c[1]!)},${mix(c[2]!)},${+alpha.toFixed(3)})`;
}

/** L'ottagono dei castoni: il rettangolo con gli angoli tagliati a 45° di `cut`. */
export function octagon(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cut: number): void {
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h - cut);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x + cut, y + h);
  ctx.lineTo(x, y + h - cut);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

/**
 * La piastra brunita (targhe, pannello delle pile, tasti di servizio): il
 * gradiente #241d22 → #120f12, dentro il filo di luce in cima (e l'ombra in
 * fondo), fuori l'ombra 0 2px 8px e l'alone del posto, se chiesti.
 */
export function plate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { shadow?: boolean; glow?: string; edge?: string; darkBackground?: boolean } = {}
): void {
  const a = ctx.getTransform().a;
  if (opts.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = 8 * a;
    ctx.shadowOffsetY = 2 * a;
    ctx.fillStyle = THEME.plate.bottom;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  if (opts.glow) {
    ctx.save();
    ctx.shadowColor = opts.glow;
    ctx.shadowBlur = 12 * a;
    ctx.fillStyle = THEME.plate.bottom;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, THEME.plate.top);
  g.addColorStop(1, THEME.plate.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(255,255,255,.09)";
  ctx.fillRect(x + 1, y + 1, w - 2, 1);
  if (opts.darkBackground) {
    ctx.fillStyle = "rgba(0,0,0,.6)";
    ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
  }
  if (opts.edge) {
    ctx.strokeStyle = opts.edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}

/**
 * L'alloggio al neon di uno slot vuoto (--crk-*-socket, SVG 520×728 stirato
 * sullo slot): il pozzo scuro, il filo nella tinta del posto col suo alone,
 * le barre d'accento in alto a sinistra e in basso a destra, il filo
 * interno tenue, il rombo inciso al centro.
 */
export function slotFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seat: SeatPalette): void {
  const edge = (k: number): string => rgba(seat.slotFrame.edge, k);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / 520, h / 728);
  ctx.lineJoin = "miter";
  ctx.fillStyle = "rgba(0,0,0,.38)";
  ctx.fillRect(3, 3, 514, 722);
  ctx.strokeStyle = edge(0.14);
  ctx.lineWidth = 9;
  ctx.strokeRect(3, 3, 514, 722);
  ctx.strokeStyle = edge(0.75);
  ctx.lineWidth = 2;
  ctx.strokeRect(3, 3, 514, 722);
  ctx.strokeStyle = rgba(seat.slotFrame.toolbar);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(3, 3);
  ctx.lineTo(163, 3);
  ctx.moveTo(517, 725);
  ctx.lineTo(357, 725);
  ctx.stroke();
  ctx.strokeStyle = edge(0.22);
  ctx.lineWidth = 1;
  ctx.strokeRect(14, 14, 492, 700);
  ctx.strokeStyle = edge(0.3);
  ctx.lineWidth = 2;
  ctx.stroke(new Path2D("M260 320 L287.28 364 L260 408 L232.72 364Z"));
  ctx.fillStyle = edge(0.16);
  ctx.fill(new Path2D("M260 344.2 L272.32 364 L260 383.8 L247.68 364Z"));
  ctx.restore();
}

/** La valle (public/home/table-night, già sfocata) e la grana di grafite (--stone): si caricano una volta. */
export const NIGHT: { valley: HTMLImageElement | null; stone: HTMLImageElement | null } = { valley: null, stone: null };
let loading: Promise<void> | null = null;

function windup(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/** Carica valle e grana (la valle a 2x sugli schermi fitti); si risolve anche se mancano. */
export function loadNight(resolution: number): Promise<void> {
  loading ??= Promise.all([
    windup(new URL(`home/table-night${resolution > 1.1 ? "@2x" : ""}.jpg`, document.baseURI).href).then(image => (NIGHT.valley = image)),
    windup(stoneUrl).then(image => (NIGHT.stone = image)),
  ]).then(() => undefined);
  return loading;
}

/** La grana di grafite a 256px, ripetuta sul riquadro (var(--stone) left top / 256px 256px repeat). */
export function grain(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  if (!NIGHT.stone) return;
  const pattern = ctx.createPattern(NIGHT.stone, "repeat");
  if (!pattern) return;
  ctx.save();
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/**
 * Uno Sprite d'interfaccia agganciato ai pixel del dispositivo (2026-09-13:
 * «le scritte dei tasti non sono in alta qualità»): a una scala qualunque —
 * 0,7875 su un MacBook — i tasti cadevano a mezzo pixel e la scheda video,
 * ricampionandoli, li sfumava. Solo l'interfaccia: le carte in prospettiva,
 * i voli e il dado che gira no, lì l'aggancio farebbe tremare i contorni.
 */
export class CrispSprite extends Sprite {
  constructor(options?: SpriteOptions | Texture) {
    super(options);
    this.roundPixels = true;
  }
}

/**
 * Un pezzo d'interfaccia dipinto col canvas: largo w e alto h in unità di
 * progetto, `resolution` pixel per unità. La texture ha già la risoluzione:
 * uno Sprite la mostra alla misura giusta.
 */
export function paintPiece(w: number, h: number, resolution: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w * resolution));
  canvas.height = Math.max(1, Math.ceil(h * resolution));
  // Prima la texture, poi il disegno: Pixi ricalcola i pixel del canvas come
  // (larghezza / risoluzione) × risoluzione, e a una risoluzione frazionaria
  // (una finestra di misura qualunque) può tornare 229,999… e riscrivere
  // canvas.width — che lo svuota. Dipinto dopo, il disegno resta.
  const texture = Texture.from({ resource: canvas, resolution });
  const ctx = canvas.getContext("2d")!;
  ctx.scale(resolution, resolution);
  draw(ctx);
  texture.source.update();
  return texture;
}

/** Un filo tratteggiato come i bordi `dashed` di Chrome a 1px: tratti di 3, vuoti di 3. */
export function dashedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();
}

/**
 * Il linear-gradient del CSS sul riquadro (x, y, w, h): l'angolo in gradi
 * (0 verso l'alto, 90 verso destra, 180 verso il basso) e la linea lunga
 * quanto la vuole il CSS, perché le fermate cadano dove cadono nel sito.
 */
export function linearGradient(
  ctx: CanvasRenderingContext2D,
  angleDeg: number,
  x: number,
  y: number,
  w: number,
  h: number,
  stops: [number, string][]
): CanvasGradient {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const gradient = ctx.createLinearGradient(cx - (dx * len) / 2, cy - (dy * len) / 2, cx + (dx * len) / 2, cy + (dy * len) / 2);
  for (const [at, color] of stops) gradient.addColorStop(at, color);
  return gradient;
}

/**
 * Un'ombra come il box-shadow del CSS, in unità di progetto: il canvas vuole
 * spostamento e sfocatura in pixel del dispositivo (la scala del contesto non
 * li tocca). La sfocatura B del CSS è la shadowBlur B del canvas.
 */
export function withShadow(
  ctx: CanvasRenderingContext2D,
  resolution: number,
  shadow: { x: number; y: number; blur: number; color: string },
  paint: () => void
): void {
  ctx.save();
  ctx.shadowColor = shadow.color;
  ctx.shadowOffsetX = shadow.x * resolution;
  ctx.shadowOffsetY = shadow.y * resolution;
  ctx.shadowBlur = shadow.blur * resolution;
  paint();
  ctx.restore();
}
