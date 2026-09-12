// Il tema «Cattedrale Rubino» (t49), l'unico che il gioco disegna (deciso
// dal designer, 2026-09-11): i colori trascritti da docs/cards/ui/card.css,
// variabile per variabile, con le tre tinte della Materia (`mat-*` nel
// renderer del sito). Le texture (pietra, grafite, crepe) non stanno qui:
// le legge da card.css il modulo virtuale (vite-theme.ts).
//
// Se il designer ritocca un colore in card.css va ritoccato anche qui: il
// confronto automatico (scripts/compare-cards.mjs) lo fa vedere.

/** Distruttiva vince su Dimensionale, che vince su Dinamica (card-render.js, tintFor). */
export type TintKind = "destructive" | "dimensional" | "dynamic";

export interface Palette {
  // .card.t49 — la carta
  /** --bg: il fondo della carta, qui solo il taglio fra gli anelli del Nexus. */
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  ornament: string;
  frame: string;
  frameDim: string;
  ruby: string;
  rubyLight: string;
  hpGreen: string;
  stoneHi: string;
  stoneMid: string;
  stoneLow: string;
  stoneVeil: string;
  hair: string;
  hairRgb: string;
  slabEdge: string;
  slabShadowRgb: string;
  slabTintRgb: string;
  slabLineRgb: string;
  typeInk: string;
  tagInk: string;
  slabAccent: string;
  slabRuby: string;
  slabOrnament: string;
  cardHi: string;
  cardMid: string;
  cardLow: string;
  gemTop: string;
  gemMid: string;
  gemLow: string;
  /** I fili del titolo: la cornice, salvo la Dimensionale (un azzurro chiaro). */
  titleLine: string;
}

const RUBY: Palette = {
  bg: "#2a0a14",
  ink: "#fdeef1",
  muted: "#d99aa9",
  accent: "#f2c56f",
  ornament: "#c2506a",
  frame: "#a62640",
  frameDim: "#5c1428",
  ruby: "#9e0f34",
  rubyLight: "#ff9fb3",
  hpGreen: "#b6e3b0",
  stoneHi: "#901731",
  stoneMid: "#363636",
  stoneLow: "#7e1630",
  stoneVeil: "rgba(255,159,179,.22)",
  hair: "#a62640",
  hairRgb: "158,15,52",
  slabEdge: "rgba(255,150,175,.6)",
  slabShadowRgb: "40,4,14",
  slabTintRgb: "120,20,50",
  slabLineRgb: "60,6,20",
  typeInk: "#5e4e55",
  tagInk: "#b8657a",
  slabAccent: "#8c1a2a",
  slabRuby: "#9e0f34",
  slabOrnament: "#b8657a",
  cardHi: "#1c1b1f",
  cardMid: "#151418",
  cardLow: "#0f0e12",
  gemTop: "#ff4d6d",
  gemMid: "#b81a41",
  gemLow: "#5f0d1c",
  titleLine: "#a62640",
};

/** .card.t49.mat-dynamic: bianco argento. */
const SILVER: Palette = {
  ...RUBY,
  frame: "#c9ced9",
  frameDim: "#6e7480",
  ruby: "#aeb6c6",
  rubyLight: "#f2f5fa",
  ornament: "#b7bfcc",
  stoneHi: "#8d949f",
  stoneLow: "#7a808c",
  stoneVeil: "rgba(230,236,255,.22)",
  gemTop: "#ffffff",
  gemMid: "#b8c0d0",
  gemLow: "#5a6170",
  hair: "#c9ced9",
  hairRgb: "120,128,140",
  slabEdge: "rgba(235,240,248,.7)",
  slabShadowRgb: "18,20,26",
  slabTintRgb: "70,80,100",
  slabLineRgb: "30,34,42",
  typeInk: "#575b63",
  tagInk: "#9aa3b3",
  slabAccent: "#4a5160",
  slabRuby: "#5f6775",
  slabOrnament: "#9aa3b3",
  titleLine: "#c9ced9",
};

/** .card.t49.mat-dimensional: blu. */
const BLUE: Palette = {
  ...RUBY,
  frame: "#2f4bb0",
  frameDim: "#1c2d6e",
  ruby: "#2a4aa8",
  rubyLight: "#9fb8ff",
  ornament: "#5f7bd6",
  stoneHi: "#22357f",
  stoneLow: "#1c2d6e",
  stoneVeil: "rgba(159,184,255,.22)",
  gemTop: "#8fb0ff",
  gemMid: "#2f4bb0",
  gemLow: "#14204f",
  hair: "#2f4bb0",
  hairRgb: "47,75,176",
  slabEdge: "rgba(150,180,255,.6)",
  slabShadowRgb: "6,10,30",
  slabTintRgb: "30,50,130",
  slabLineRgb: "10,16,50",
  typeInk: "#4a5170",
  tagInk: "#6f86c8",
  slabAccent: "#1f3a9e",
  slabRuby: "#2a4aa8",
  slabOrnament: "#6f86c8",
  titleLine: "#8fc3ff",
};

export const PALETTE: Record<TintKind, Palette> = { destructive: RUBY, dynamic: SILVER, dimensional: BLUE };

/**
 * Dentro la lastra del testo (`.t49 .textbox`) alcune variabili cambiano:
 * l'inchiostro è scuro sulla pietra chiara.
 */
export interface Slab {
  ink: string;
  muted: string;
  accent: string;
  rubyLight: string;
  well: string;
  frameDim: string;
  ornament: string;
  hpGreen: string;
}

export function slabOf(palette: Palette): Slab {
  return {
    ink: "#1b1719",
    muted: "#6a6266",
    accent: palette.slabAccent,
    rubyLight: palette.slabRuby,
    well: "#e9e6e3",
    frameDim: "#c6c0bc",
    ornament: palette.slabOrnament,
    hpGreen: "#2f6a3a",
  };
}

/** Il carattere della carta (card.css, .card): lo stesso del sito, quello di sistema. */
export const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
/** I codici carta (card.css, .card-id). */
export const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** La carta a grandezza piena: 520×728, corpo 20px (card.css, la misura Magic). */
export const CARD_W = 520;
export const CARD_H = 728;
export const EM = 20;
