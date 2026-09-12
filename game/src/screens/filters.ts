// I filtri CSS delle schermate come matrici di colore: saturate, grayscale,
// contrast, brightness con le formule della specifica (Filter Effects), in
// fila come nella proprietà `filter` — il primo si applica per primo. Il
// ColorMatrixFilter di Pixi ha le sue scale per saturazione e contrasto:
// qui si scrivono le matrici a mano, così la carta spenta della home è
// quella del simulatore.

import { ColorMatrixFilter } from "pixi.js";

type ColorMatrixValues = number[];

const IDENTITY: ColorMatrixValues = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

/** `dopo ∘ prima`: prima si applica `prima`, poi `dopo`. */
function compose(after: ColorMatrixValues, before: ColorMatrixValues): ColorMatrixValues {
  const out: number[] = new Array<number>(20).fill(0);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 5; c += 1) {
      let sum = c === 4 ? after[r * 5 + 4]! : 0;
      for (let k = 0; k < 4; k += 1) sum += after[r * 5 + k]! * before[k * 5 + c]!;
      out[r * 5 + c] = sum;
    }
  }
  return out;
}

export type CssFilter = ["saturate" | "grayscale" | "contrast" | "brightness", number];

function toMatrix([name, v]: CssFilter): ColorMatrixValues {
  switch (name) {
    case "saturate":
      return [0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v, 0, 0, 0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v, 0, 0, 0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v, 0, 0, 0, 0, 0, 1, 0];
    case "grayscale": {
      const s = 1 - v;
      return [0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s, 0, 0, 0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s, 0, 0, 0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s, 0, 0, 0, 0, 0, 1, 0];
    }
    case "contrast": {
      const o = (1 - v) / 2;
      return [v, 0, 0, 0, o, 0, v, 0, 0, o, 0, 0, v, 0, o, 0, 0, 0, 1, 0];
    }
    case "brightness":
      return [v, 0, 0, 0, 0, 0, v, 0, 0, 0, 0, 0, v, 0, 0, 0, 0, 0, 1, 0];
  }
}

/** Un filtro di Pixi con la matrice di una fila di filtri CSS; `alpha` lo dosa da nessuno (0) a pieno (1). */
export function cssFilter(filters: CssFilter[]): ColorMatrixFilter {
  const filter = new ColorMatrixFilter();
  filter.matrix = filters.reduce((m, f) => compose(toMatrix(f), m), IDENTITY) as ColorMatrixFilter["matrix"];
  return filter;
}
