// Il contesto che le viste condividono: leggere lo stato, mandare un'azione,
// sapere chi sono. Niente altro — le viste non parlano mai fra loro.
//
// Qui vive anche la geometria della lavagna. Sta in un posto solo perché la
// usano in tre (il tavolo per disegnare le zone, main.ts per posare il
// Rubyfront in Zona di Richiamo, la ricerca per mandare una carta sul Fronte):
// se le misure si sparpagliassero, le zone e le carte finirebbero disallineate.

import type { Action, GameState, Seat } from "./types.js";
import { otherSeat } from "./types.js";

export interface Ctx {
  state(): GameState;
  /** Applica in locale e ritrasmette alla stanza. */
  dispatch(action: Action): void;
  /** Il posto occupato da questo browser. */
  seat(): Seat;
  /** Il tema grafico è una proprietà del mazzo: ogni posto ha il suo. */
  themeFor(seat: Seat): string;
  locale(): string;
  /** Riga di servizio in chat (dadi, mescola, pesca). Il posto di chi agisce
      colora la riga: si deve vedere a colpo d'occhio chi fa cosa. */
  log(text: string, seat?: Seat | null): void;
}

export const TILE_W = 302;
const TILE_H = 424;
/** Spazio fra due carte affiancate. */
const GUTTER = 20;
/** Rientro dai bordi della metà. */
const EDGE = 30;
/**
 * Margine sopra e sotto le due file, dentro la fascia. Sono UGUALI di
 * proposito: è quello che rende la fascia simmetrica, e quindi capovolgibile
 * scambiando semplicemente le due file di posto (vedi `toView`).
 */
const ROW_PAD = 44;
/**
 * Distanza fra il Fronte e la fila di servizio. È larga: lì sotto, dietro il
 * Fronte, ci vanno le Materie permanenti (§5), che stanno in campo senza uno
 * slot proprio.
 */
const ROW_GAP = 96;

export const SURFACE_W = 2700;

/**
 * Ogni metà è alta due file di carte: il campo di un giocatore da solo occupa
 * quanto prima occupavano i due messi insieme. Sullo schermo non ci sta tutto,
 * e va bene così — si scorre.
 */
export const HALF_H = ROW_PAD + TILE_H + ROW_GAP + TILE_H + ROW_PAD;
/** Margine in cima: sotto ci passa la fascia dei dorsi avversari. */
export const TOP_PAD = 128;
/**
 * Margine in fondo: la mano è un pannello sovrapposto al tavolo, e serve un
 * po' di coda perché la riga di servizio possa salire sopra di essa
 * scorrendo. Era 500 quando la mano stava sempre aperta a misura piena; ora
 * che si ripiega con un gesto (ed è in scala sugli schermi piccoli) basta
 * molto meno — e meno coda vuol dire meno scorrimento.
 */
const BOTTOM_PAD = 240;
const HALF_GAP = 32;
export const SURFACE_H = TOP_PAD + HALF_H * 2 + HALF_GAP + BOTTOM_PAD;

/**
 * I cinque slot del Fronte (§5). Sono cinque perché cinque è il limite di
 * Entità sul Fronte — ma restano posti segnati, non caselle chiuse: nessuno
 * impedisce di appoggiare la sesta carta dove si vuole.
 *
 * Non stanno più a ridosso l'uno dell'altro: si spartiscono tutta la campata
 * fra la colonna del Rubyfront e quella delle Materie, col respiro che ne
 * discende. Lo spazio c'è, tanto vale usarlo — e le misure restano CANONICHE,
 * uguali sui due schermi: è la sola spaziatura che non fa divergere le
 * lavagne (una spaziatura per-finestra sposterebbe gli slot di qua ma non le
 * coordinate condivise di là).
 */
export const FRONT_SLOTS = 5;
/** Aria fra il Fronte e le due colonne fisse che lo affiancano. */
const FRONT_CLEAR = 110;
export const FRONT_X = EDGE + TILE_W + FRONT_CLEAR;
export const FRONT_W = SURFACE_W - EDGE - TILE_W - FRONT_CLEAR - FRONT_X;
/** Passo fra le colonne: quel che avanza, diviso nei quattro varchi. */
const FRONT_STEP = (FRONT_W - TILE_W) / (FRONT_SLOTS - 1);
export const FRONT_SLOT_X: readonly number[] = Array.from(
  { length: FRONT_SLOTS },
  (_, index) => Math.round(FRONT_X + index * FRONT_STEP)
);

/**
 * Il posto del Rubyfront schierato, all'estremità sinistra della fila del
 * Fronte. Sta fuori dai cinque slot perché il Rubyfront non ne occupa uno
 * (§5): sta davanti al Fronte, per conto suo.
 */
export const RUBYFRONT_X = EDGE;

/**
 * Il posto delle Materie in gioco, all'altra estremità. Le permanenti si
 * dispongono una dietro l'altra nell'ordine in cui sono scese in campo, e la
 * fila tiene traccia della loro età (§5) — cosa che serve per l'ordine di
 * risoluzione (§8.2). L'impilamento a scaletta di `stackAt` disegna
 * esattamente quella fila: la prima scesa sta in fondo alla pila.
 */
export const MATTER_X = SURFACE_W - EDGE - TILE_W;

/**
 * Ascissa dei posti fissi nella fila di servizio: la Zona di Richiamo a
 * sinistra, le tre pile allineate a destra.
 */
const RIGHT_EDGE = SURFACE_W - EDGE;
export const SLOT_X = {
  richiamo: EDGE,
  abisso: RIGHT_EDGE - TILE_W * 3 - GUTTER * 2,
  ritiro: RIGHT_EDGE - TILE_W * 2 - GUTTER,
  deck: RIGHT_EDGE - TILE_W,
} as const;

/**
 * Ordinata della fascia di un posto, in coordinate CANONICHE.
 *
 * Le posizioni delle carte sono condivise: viaggiano sulla rete e devono voler
 * dire la stessa cosa sui due schermi. Perciò esiste un solo sistema di
 * riferimento — quello canonico, dove il posto A sta in basso e il B in alto —
 * ed è l'unico che finisce nello stato e nei messaggi.
 *
 * Che poi ciascuno voglia vedersi in basso è un fatto di VISTA, non di dati:
 * ci pensa `toView` al momento di disegnare. Non confondere le due cose: se un
 * y canonico finisse in un'azione già convertito, le due lavagne divergerebbero.
 */
export function halfTop(seat: Seat): number {
  return TOP_PAD + (seat === "a" ? HALF_H + HALF_GAP : 0);
}

/** Riga del Fronte: in cima alla propria metà, verso l'avversario. */
export function frontRowY(seat: Seat): number {
  return halfTop(seat) + ROW_PAD;
}

/** Riga di servizio: Zona di Richiamo, Abisso, Ritiro, Mazzo. */
export function backRowY(seat: Seat): number {
  return frontRowY(seat) + TILE_H + ROW_GAP;
}

/** Di quanto dista una fascia dall'altra: lo scambio è esattamente questo. */
const SWAP_Y = HALF_H + HALF_GAP;

/** Ordinata canonica di ciascuna fascia. */
const BAND_TOP: Record<Seat, number> = { b: TOP_PAD, a: TOP_PAD + SWAP_Y };

/**
 * Le due trasformate ragionano sul CENTRO della carta, non sul suo angolo.
 * Col centro il capovolgimento è una riflessione pulita dentro la fascia e
 * andata e ritorno tornano sempre; col bordo, una carta che sporge appena dal
 * fondo della fascia si ribaltava fuori e non rientrava più.
 */
const HALF_TILE = TILE_H / 2;

/** In quale fascia cade un centro (null: fuori da entrambe). */
function bandOfCenter(center: number): Seat | null {
  if (center >= BAND_TOP.b && center < BAND_TOP.b + HALF_H) return "b";
  if (center >= BAND_TOP.a && center < BAND_TOP.a + HALF_H) return "a";
  return null;
}

/** Dove sta la fascia di `seat` sullo schermo di `viewer`: la propria in basso. */
export function viewBandTop(seat: Seat, viewer: Seat): number {
  return seat === viewer ? TOP_PAD + SWAP_Y : TOP_PAD;
}

/**
 * Ordinata (in vista) della linea di battaglia: la cima del Fronte avversario,
 * che capovolto guarda il tuo dall'altra parte del varco. È l'inquadratura di
 * partenza: i due Fronti insieme, il proprio campo senza scorrere.
 */
export function viewBattleTop(viewer: Seat): number {
  return viewBandTop(otherSeat(viewer), viewer) + HALF_H - ROW_PAD - TILE_H;
}

/**
 * Riflessione dentro la fascia: la fila del Fronte va al posto della fila di
 * servizio e viceversa. È uno scambio esatto perché la fascia è simmetrica
 * (stesso `ROW_PAD` sopra e sotto). È l'inversa di sé stessa.
 */
function flipInBand(localCenter: number): number {
  return HALF_H - localCenter;
}

/**
 * Da coordinata condivisa a coordinata di schermo.
 *
 * Due cose insieme, e sono due cose diverse:
 *  1. la TUA fascia scende sempre in basso, l'avversaria sale in alto;
 *  2. la fascia AVVERSARIA si capovolge, così il suo Fronte guarda il tuo
 *     attraverso il centro del tavolo, e mazzo, Abisso, Ritiro, Zona di
 *     Richiamo e Rubyfront gli restano dietro le spalle.
 *
 * La tua fascia non si capovolge mai: il tuo Fronte ti sta davanti e la fila di
 * servizio dietro, come deve.
 */
export function toView(y: number, viewer: Seat): number {
  const center = y + HALF_TILE;
  const band = bandOfCenter(center);
  if (!band) return y;
  const local = center - BAND_TOP[band];
  const moved = viewBandTop(band, viewer) + (band === viewer ? local : flipInBand(local));
  return moved - HALF_TILE;
}

/**
 * Da coordinata di schermo a coordinata condivisa: serve quando una carta
 * viene posata a mano libera, perché il punto in cui è stata lasciata va
 * riportato nel sistema comune prima di finire nello stato.
 */
export function fromView(y: number, viewer: Seat): number {
  const center = y + HALF_TILE;
  let band: Seat;
  if (center >= TOP_PAD && center < TOP_PAD + HALF_H) band = otherSeat(viewer);
  else if (center >= TOP_PAD + SWAP_Y && center < TOP_PAD + SWAP_Y + HALF_H) band = viewer;
  else return y;
  const local = center - viewBandTop(band, viewer);
  const moved = BAND_TOP[band] + (band === viewer ? local : flipInBand(local));
  return moved - HALF_TILE;
}
