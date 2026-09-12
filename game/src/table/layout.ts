// L'impaginazione del tavolo (F3): dove sta ogni cosa, in unità di progetto
// (1920×1080, stage.ts). È la vista «rincasso» del simulatore rifatta per lo
// schermo del gioco: la tua metà in basso con due file (Fronte e fila di
// servizio), l'avversaria in alto capovolta e ridotta al Fronte (le sue pile
// stanno nel pannello), la mano in un cassetto sopra il tavolo.
//
// La scala viene da sé: dall'altezza, tolti gli spazi fissi (la barra in
// alto, le targhe, le etichette a 16px, l'angolo del gesto di fase), restano
// tre file di carte. A 1920×1080 viene 0,524, la stessa del simulatore; su uno
// schermo 16:10 le carte crescono. Le coordinate delle carte nello stato sono
// canoniche (core/geometry): qui si traducono in posti sullo schermo.

import { BAND_TOP, HALF_H, HALF_TILE, ROW_GAP, ROW_PAD, SLOT_X, SURFACE_W, TILE_H, TILE_W, backRowY, bandOfCenter, frontRowY } from "@rubyfront/core/geometry";
import type { Seat } from "@rubyfront/core/types";
import type { Visible } from "../stage";

/** Gli spazi fissi, in unità di progetto (= px a 1920×1080): quelli del simulatore. */
export const FIXED = {
  /** La barra in alto (l'header del simulatore). */
  bar: 54,
  /** Dalla barra all'orlo del campo avversario: la sua targa sporge sopra. */
  top: 41,
  /** Dall'orlo di un campo alla sua prima fila: la targa sporge dentro. */
  head: 37,
  /** Sotto una fila: l'etichetta a 16px e la sua aria. */
  label: 42,
  /** Fra i due campi. */
  gap: 31,
  /** In fondo: l'angolo del gesto di fase. */
  bottom: 87,
  /** Il margine minimo ai lati. */
  side: 24,
} as const;

export interface FieldArea {
  /** L'orlo in alto e in basso del campo. */
  top: number;
  bottom: number;
  /** La cima della fila del Fronte. */
  front: number;
  /** La cima della fila di servizio (solo il tuo campo: l'avversario non ce l'ha). */
  back: number | null;
}

export interface TableLayout {
  /** Da unità canoniche a unità di progetto. */
  s: number;
  /** La x di progetto dello zero canonico. */
  left: number;
  tileW: number;
  tileH: number;
  /** Il campo avversario (in alto) e il tuo (in basso). */
  foe: FieldArea;
  mine: FieldArea;
  /** Gli orli sinistro e destro dei campi (i tappeti stanno a 12 canonici dai bordi). */
  halfX: number;
  halfW: number;
  /** Il cassetto della mano: largo tre quarti, da sinistra, in fondo. */
  hand: { x: number; y: number; w: number; h: number };
  /** L'angolo del gesto di fase: il bordo destro e il fondo. */
  corner: { right: number; bottom: number };
  /** La x di progetto di una x canonica. */
  x(canonX: number): number;
  /** Il posto sullo schermo di una carta sul campo (l'angolo in alto a sinistra), per chi guarda. */
  screenPos(canonX: number, canonY: number, viewer: Seat): { x: number; y: number };
  /**
   * Il contrario di `posto` per la TUA metà: da un punto dello schermo
   * (l'angolo in alto a sinistra di una carta lasciata a mano libera) alle
   * coordinate canoniche. Il rilascio si fa nella propria metà; il resto lo
   * decide la lavagna (core/gestures.ts, dropOnField).
   */
  canonical(px: number, py: number, viewer: Seat): { x: number; y: number };
}

export function layout(visible: Visible): TableLayout {
  const top = visible.y + FIXED.bar;
  const bottom = visible.y + visible.height - FIXED.bottom;
  const fixed = FIXED.top + 2 * FIXED.head + 3 * FIXED.label + FIXED.gap;
  const byHeight = (bottom - top - fixed) / (3 * TILE_H);
  const byWidth = (visible.width - 2 * FIXED.side) / SURFACE_W;
  const s = Math.min(byHeight, byWidth);
  const tileW = TILE_W * s;
  const tileH = TILE_H * s;
  const left = visible.x + (visible.width - SURFACE_W * s) / 2;

  const foeTop = top + FIXED.top;
  const foe: FieldArea = { top: foeTop, front: foeTop + FIXED.head, back: null, bottom: foeTop + FIXED.head + tileH + FIXED.label };
  const mineTop = foe.bottom + FIXED.gap;
  const mineFront = mineTop + FIXED.head;
  const mineBack = mineFront + tileH + FIXED.label;
  const mine: FieldArea = { top: mineTop, front: mineFront, back: mineBack, bottom: mineBack + tileH + FIXED.label };

  const handH = tileH + 48;
  const x = (canonX: number): number => left + canonX * s;

  // Da canonico a schermo come ctx.ts del simulatore (compress): la fascia si
  // sceglie dal CENTRO della carta, poi si traduce la sua CIMA con punti fermi
  // sugli orli delle file — dentro una fila si scala di s (una pila sfalsata
  // di 30 scende di 30·s), il varco fra le file si stringe da sé.
  const ROW_TOP = ROW_PAD;
  const BACK_TOP = ROW_PAD + TILE_H + ROW_GAP;
  const topY = (canonTop: number, viewer: Seat): number => {
    const band = bandOfCenter(canonTop + HALF_TILE);
    // Fuori dalle fasce: come la propria fila del Fronte.
    if (!band) return mine.front + (canonTop - frontRowY(viewer)) * s;
    const local = canonTop - BAND_TOP[band];
    if (band === viewer) {
      if (local <= ROW_TOP + TILE_H) return mine.front + (local - ROW_TOP) * s;
      if (local >= BACK_TOP) return mineBack + (local - BACK_TOP) * s;
      const k = (local - ROW_TOP - TILE_H) / ROW_GAP;
      return mine.front + tileH + k * (mineBack - mine.front - tileH);
    }
    // L'avversario, capovolto dentro la sua fascia (core/geometry, flipInBand,
    // sul centro): il suo Fronte guarda il tuo attraverso il varco. La sua
    // fila di servizio non c'è (rincasso), e ciò che salirebbe oltre il
    // Fronte si schiaccia sul suo orlo — un Oggetto assegnato resta dietro la
    // sua Entità invece di sbucare sopra.
    const flippedTop = HALF_H - local - TILE_H;
    return foe.front + Math.max(0, flippedTop - BACK_TOP) * s;
  };

  return {
    s,
    left,
    tileW,
    tileH,
    foe,
    mine,
    halfX: x(12),
    halfW: (SURFACE_W - 24) * s,
    hand: { x: visible.x, y: visible.y + visible.height - handH, w: visible.width * 0.75, h: handH },
    corner: { right: visible.x + visible.width - 16, bottom: visible.y + visible.height - 12 },
    x,
    screenPos(canonX, canonY, viewer) {
      // La Zona di Richiamo non ha un riquadro suo (rincasso): il Rubyfront
      // in attesa si disegna nel riquadro del Rubyfront, sulla fila del Fronte.
      const band = bandOfCenter(canonY + HALF_TILE);
      if (band && Math.abs(canonX - SLOT_X.richiamo) < 160 && Math.abs(canonY - backRowY(band)) < TILE_H / 2) {
        return { x: x(canonX), y: topY(frontRowY(band) + (canonY - backRowY(band)), viewer) };
      }
      return { x: x(canonX), y: topY(canonY, viewer) };
    },
    canonical(px, py, viewer) {
      // Le stesse file di topY, a ritroso: dentro una fila si divide per s,
      // nel varco fra Fronte e fila di servizio si interpola.
      let local: number;
      if (py <= mine.front + tileH) local = ROW_TOP + (py - mine.front) / s;
      else if (py >= mineBack) local = BACK_TOP + (py - mineBack) / s;
      else local = ROW_TOP + TILE_H + ((py - mine.front - tileH) / (mineBack - mine.front - tileH)) * ROW_GAP;
      return { x: (px - left) / s, y: BAND_TOP[viewer] + local };
    },
  };
}
