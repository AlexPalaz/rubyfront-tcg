// Il tempo delle animazioni (F5): una corsa sul ticker di Pixi, con un timer
// di riserva — una scheda in secondo piano non fa girare il ticker, e le
// promesse di cui la partita ha bisogno (il bot aspetta la quiete, le scene
// si mettono in fila) non devono restare appese. Con prefers-reduced-motion
// le corse saltano subito alla fine, come il simulatore spegne le sue.

import type { Ticker } from "pixi.js";

export type Curve = (t: number) => number;

export const linear: Curve = t => t;

/** La cubic-bezier del CSS: da t (tempo) a progresso, risolvendo la x per bisezione e Newton. */
export function bezier(x1: number, y1: number, x2: number, y2: number): Curve {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number): number => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number): number => ((ay * u + by) * u + cy) * u;
  const slopeX = (u: number): number => (3 * ax * u + 2 * bx) * u + cx;
  return t => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i += 1) {
      const error = sampleX(u) - t;
      if (Math.abs(error) < 1e-5) return sampleY(u);
      const slope = slopeX(u);
      if (Math.abs(slope) < 1e-6) break;
      u -= error / slope;
    }
    let lo = 0;
    let hi = 1;
    u = t;
    for (let i = 0; i < 30; i += 1) {
      const x = sampleX(u);
      if (Math.abs(x - t) < 1e-5) break;
      if (x < t) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sampleY(u);
  };
}

export const ease = bezier(0.25, 0.1, 0.25, 1);
export const easeIn = bezier(0.42, 0, 1, 1);
export const easeOut = bezier(0, 0, 0.58, 1);
export const easeInOut = bezier(0.42, 0, 0.58, 1);

/** prefers-reduced-motion: le animazioni si spengono, restano gli stati finali. */
export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Una corsa di `ms` millisecondi: `frame(k)` riceve il progresso secondo la
 * curva, da 0 a 1, a ogni fotogramma; l'ultimo fotogramma (k = 1) arriva
 * sempre, anche se il ticker è fermo. Un fotogramma che lancia (l'oggetto
 * animato è stato distrutto) chiude la corsa.
 */
export function tween(ticker: Ticker, ms: number, frame: (k: number) => void, curve: Curve = linear): Promise<void> {
  const safe = (k: number): boolean => {
    try {
      frame(k);
      return true;
    } catch {
      return false;
    }
  };
  if (ms <= 0 || reducedMotion()) {
    safe(1);
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const start = performance.now();
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      ticker.remove(tick);
      clearTimeout(timer);
      safe(1);
      resolve();
    };
    const tick = (): void => {
      const t = (performance.now() - start) / ms;
      if (t >= 1 || !safe(curve(t))) finish();
    };
    ticker.add(tick);
    const timer = setTimeout(finish, ms + 80);
    safe(curve(0));
  });
}

/** Un'attesa semplice (il timer, non il ticker). */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Un valore lungo i fotogrammi chiave di un'animazione CSS: `stops` sono
 * coppie [offset 0..1, valore], in ordine; fra due fotogrammi si interpola
 * in linea retta (la curva dell'animazione sta nel `k` che si passa).
 */
export function key(k: number, stops: [number, number][]): number {
  if (k <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i += 1) {
    const [at, value] = stops[i];
    if (k <= at) {
      const [prevAt, prevValue] = stops[i - 1];
      const span = at - prevAt || 1;
      return prevValue + ((k - prevAt) / span) * (value - prevValue);
    }
  }
  return stops[stops.length - 1][1];
}
