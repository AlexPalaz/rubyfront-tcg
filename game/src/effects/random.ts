// Il caso degli effetti: un generatore suo (mulberry32), seminato dall'orologio.
// Gli effetti non toccano Math.random, così le prove col caso a seme fisso
// (i banchi) danno le stesse partite con o senza animazioni.

let seed = (Date.now() ^ 0x9e3779b9) >>> 0;

/** Un numero in [0, 1). */
export function random(): number {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export type Range = readonly [number, number];

/** Un numero a caso nell'intervallo. */
export function between(r: Range): number {
  return r[0] + random() * (r[1] - r[0]);
}

/** Un elemento a caso. */
export function pick<T>(list: readonly T[]): T {
  return list[Math.floor(random() * list.length)] ?? list[0]!;
}
