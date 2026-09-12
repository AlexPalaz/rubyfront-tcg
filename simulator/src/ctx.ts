// La geometria di VISTA del simulatore: le viste piena, compatta e rincasso,
// e le trasformate fra coordinate canoniche e schermo. Le coordinate
// canoniche (quelle dello stato e della rete) stanno nel core,
// @rubyfront/core/geometry; qui si comprime e si capovolge solo ciò che si
// vede.
//
// Il modulo ripete anche il `Ctx` e le forme del core, e la geometria
// canonica: le viste del simulatore importano tutto da qui, come prima
// della migrazione (F1, 2026-09-11).

export * from "@rubyfront/core/geometry";
export type * from "@rubyfront/core/ctx";

import {
  BAND_TOP,
  BOTTOM_PAD,
  HALF_GAP,
  HALF_H,
  HALF_TILE,
  ROW_GAP,
  ROW_PAD,
  RUBYFRONT_X,
  SLOT_X,
  SWAP_Y,
  SURFACE_W,
  TILE_H,
  TOP_PAD,
  backRowY,
  bandOfCenter,
  canonBandTop,
  flipInBand,
  frontRowY,
  rowOfLocal,
} from "@rubyfront/core/geometry";
import type { Seat } from "@rubyfront/core/types";
import { otherSeat } from "@rubyfront/core/types";

/**
 * Vista compatta: sul campo le tessere mostrano solo barra del titolo (costo,
 * nome, potenza/PV) e illustrazione — il resto lo taglia l'overflow della
 * tessera, la carta sotto resta intera e intatta. È un VESTITO del client:
 * le coordinate canoniche condivise in rete non cambiano di un pixel; a
 * comprimersi è solo la geometria di vista, con la mappa `compress` qui
 * sotto. Obiettivo dichiarato: col tavolo compatto non si scorre affatto
 * (fitScale in table.ts aggancia anche l'altezza).
 */
let compactView = false;
export function setCompactView(on: boolean): void {
  compactView = on;
}
export function isCompactView(): boolean {
  return compactView;
}

/**
 * Le viste del tavolo. «Piena»: carte intere ovunque, si scorre.
 * «Compatta»: tutto nella finestra, senza scorrere; sul campo e in mano le
 * carte sono TESSERE (illustrazione, nome, costo, Potenza a corpo fisso),
 * il testo di regole si legge nell'ingrandimento al passaggio.
 * «Rincasso»: lo stesso tavolo a due file della piena, carte intere
 * OVUNQUE — Fronte, fila di servizio e mano — e senza scorrere. Ci sta
 * perché la fascia avversaria perde la sua fila di servizio: le sue pile
 * vanno in un pannello sopra la lavagna, e la sua Zona di Richiamo è il
 * riquadro del Rubyfront. Restano tre file di carte intere invece di
 * quattro. Le coordinate canoniche non cambiano di un pixel: cambia solo
 * la mappa di vista.
 */
export type ViewMode = "full" | "compact" | "recess";
let recessView = false;
export function setViewMode(mode: ViewMode): void {
  compactView = mode === "compact";
  recessView = mode === "recess";
}
export function viewMode(): ViewMode {
  return compactView ? "compact" : recessView ? "recess" : "full";
}
export function isRecessView(): boolean {
  return recessView;
}
/** Le viste che comprimono la geometria verticale (mappa `compress`). */
function stretched(): boolean {
  return compactView || recessView;
}
/**
 * Altezza della tessera compatta. Non deriva più dalla carta: è il riquadro
 * dell'illustrazione (302 di larghezza, poco meno di 3:2), con nome e
 * distintivi sovrapposti. Vale sul campo, nelle pile e in mano.
 */
export const COMPACT_TILE_H = 200;
/** Il varco fra le due file si stringe con le carte. */
const COMPACT_ROW_GAP = 48;
/** Il margine sopra e sotto le file, in compatta: più largo del canonico,
    perché lì sotto stanno le etichette a corpo fisso (16px reali, cioè
    fino a ~37px canonici a scala 0.43) con un po' d'aria dal riquadro. */
const COMPACT_ROW_PAD = 72;
/** In compatta la mano non si sovrappone più alla lavagna (il fit la conta,
    vedi fitScale in table.ts): la coda in fondo serve solo da respiro. */
const COMPACT_BOTTOM_PAD = 48;
/** Fra il Fronte e la fila di servizio, in rincasso, ci passa una riga di
    etichette a corpo fisso (16px reali) con la sua aria: meno del varco
    canonico, che lì porta anche le Materie permanenti. */
const RECESS_ROW_GAP = 64;
/** In rincasso la mano avversaria non è più una fascia in cima al tavolo
    (sta nel pannello delle pile, col suo conto): il margine di testa serve
    solo da aria, e quei pixel tornano alle carte. */
const RECESS_TOP_PAD = 40;
/**
 * Lavagna piccola: sotto una certa scala i margini si stringono ancora, e
 * quei pixel vanno alle carte — su una finestra da 1180×820 valgono più di
 * un dito d'aria. Lo accende fitScale (table.ts), che è l'unico a conoscere
 * la scala; qui restano solo le misure.
 */
let tightView = false;
export function setTightView(on: boolean): void {
  tightView = on;
}
export function isTightView(): boolean {
  return tightView;
}
const TIGHT = { ROW_PAD: 44, ROW_GAP: 40, TOP_PAD: 24, BOTTOM_PAD: 24, HALF_GAP: 28 } as const;
/**
 * Rincasso: quando comanda la larghezza, sotto e sopra il tavolo avanza
 * altezza. Invece di centrare il tavolo nel vuoto, quell'altezza (in unità
 * di vista, già divisa per la scala) si distribuisce nei margini — cima e
 * fondo, il varco fra i campi, i varchi fra le file — così le etichette
 * prendono aria e il tavolo riempie la finestra. Lo scrive fitScale
 * (table.ts), che è l'unico a conoscere la finestra; zero nelle altre viste.
 */
let viewSlack = 0;
export function setViewSlack(units: number): void {
  viewSlack = units;
}
/**
 * L'angolo in basso a destra è del gesto di fase (hud.ts, .hud-actions),
 * che sta sopra il tavolo in pixel di schermo: il margine di fondo gli fa
 * posto, così non copre le pile e le loro etichette. In unità di vista
 * (pixel divisi per la scala), lo scrive fitScale; zero fuori dal rincasso.
 */
let cornerReserve = 0;
export function setCornerReserve(units: number): void {
  cornerReserve = units;
}
/**
 * Lo spazio di un'etichetta sotto un riquadro (RUBYFRONT, FRONTE, MATERIE,
 * le pile): a corpo fisso, 16px più l'aria, quindi in unità di vista
 * dipende dalla scala. In rincasso i margini di fila e il varco fra le
 * file non scendono mai sotto questa misura, o l'etichetta finirebbe sul
 * bordo del campo o sulla fila sotto. Lo scrive fitScale (table.ts).
 */
let labelRoom = 0;
/** E lo spazio della testata del campo (targhetta e targa), che sporge
    dentro il campo dall'orlo in alto: la metà della sua altezza più l'aria. */
let headRoom = 0;
/** E il margine in cima al tavolo: la targhetta del campo avversario
    sporge sopra il suo orlo, e sotto l'header ci vuole aria vera. */
let topRoom = 0;
/** E il pannello delle pile avversarie, ripiegato a testata nell'angolo in
    alto del campo avversario (table.ts, .pile-dock): il suo stacco dall'orlo,
    la sua altezza e l'aria sotto, perché non cada sui riquadri del Fronte. */
let dockRoom = 0;
export function setLabelRoom(labels: number, head: number, top = head, dock = head): void {
  labelRoom = labels;
  headRoom = head;
  topRoom = top;
  dockRoom = dock;
}
/** Le quote della distribuzione: cima e fondo, varco fra i campi, varco fra
    le file (una sola, nel campo tuo), i quattro margini di fila. */
const SLACK = { TOP: 0.12, BOTTOM: 0.1, HALF_GAP: 0.3, ROW_GAP: 0.2, ROW_PAD: 0.07 } as const;
function topPadView(): number {
  if (recessView) return Math.max(tightView ? TIGHT.TOP_PAD : RECESS_TOP_PAD, topRoom) + viewSlack * SLACK.TOP;
  return TOP_PAD;
}
function halfGapView(): number {
  const base = stretched() && tightView ? TIGHT.HALF_GAP : HALF_GAP;
  // La testata del campo tuo sporge SOPRA il suo orlo, nel varco: il varco
  // non scende mai sotto il suo spazio, o finirebbe sull'orlo del campo
  // avversario (a 1180×820 il varco stretto è 7px, la testata ne sporge 15).
  return recessView ? Math.max(base, headRoom) + viewSlack * SLACK.HALF_GAP : base;
}

/** Altezza di VISTA di una tessera: in rincasso è la carta intera come
    nella vista piena, sul Fronte, nella fila di servizio e in mano. */
export function tileViewH(): number {
  return compactView ? COMPACT_TILE_H : TILE_H;
}
/** La carta sta in Zona di Richiamo (coordinate canoniche)? In rincasso
    quel posto non ha un riquadro suo: è il riquadro del Rubyfront
    nell'altro stato, e la carta ci si disegna lì. */
export function atRecall(x: number, y: number): boolean {
  const center = y + HALF_TILE;
  const band = bandOfCenter(center);
  if (!band || rowOfLocal(center - BAND_TOP[band]) !== "back") return false;
  return Math.abs(x - SLOT_X.richiamo) < 160;
}
function rowGapView(): number {
  if (compactView) return COMPACT_ROW_GAP;
  if (!recessView) return ROW_GAP;
  return Math.max(tightView ? TIGHT.ROW_GAP : RECESS_ROW_GAP, labelRoom) + viewSlack * SLACK.ROW_GAP;
}
/** Il margine in testa a una fascia: fa posto alla testata, che sporge —
    e, nella fascia avversaria in rincasso, al pannello delle pile ripiegato. */
function rowPadTopView(foe = false): number {
  if (!stretched()) return ROW_PAD;
  const base = tightView ? TIGHT.ROW_PAD : COMPACT_ROW_PAD;
  const room = foe ? Math.max(headRoom, dockRoom) : headRoom;
  return recessView ? Math.max(base, room) + viewSlack * SLACK.ROW_PAD : base;
}
/** Il margine in fondo a una fascia: fa posto alle etichette sotto i riquadri. */
function rowPadBottomView(): number {
  if (!stretched()) return ROW_PAD;
  const base = tightView ? TIGHT.ROW_PAD : COMPACT_ROW_PAD;
  return recessView ? Math.max(base, labelRoom) + viewSlack * SLACK.ROW_PAD : base;
}
function bottomPadView(): number {
  if (!stretched()) return BOTTOM_PAD;
  const base = tightView ? TIGHT.BOTTOM_PAD : COMPACT_BOTTOM_PAD;
  return recessView ? base + cornerReserve + viewSlack * SLACK.BOTTOM : base;
}
/**
 * Altezza di VISTA di una fascia. In rincasso la fascia AVVERSARIA (quella
 * in alto) non ha la fila di servizio: le sue pile stanno in un pannello
 * ripiegabile sopra il suo campo (`.pile-dock`, table.ts), e la Zona di
 * Richiamo è il riquadro del Rubyfront. Resta solo il Fronte.
 */
/**
 * Rincasso: la fila di servizio avversaria si riapre quando serve — quando
 * l'avversario controlla un'Entità (§8.2), che sta nel suo riquadro del
 * controllo, in quella fila, o quando si aprono le sue pile dalla testata
 * (table.ts): Abisso, Ritiro, Mazzo e la mano scendono sulla lavagna ai
 * loro posti. Chiusa, il riquadro del controllo cadrebbe sul Fronte, sopra
 * il terzo slot. Lo accende table.ts; costa scala finché resta aperta.
 */
let foeBackRow = false;
export function setFoeBackRow(on: boolean): void {
  foeBackRow = on;
}
export function hasFoeBackRow(): boolean {
  return foeBackRow;
}
export function bandViewH(foe = false): number {
  if (recessView && foe && !foeBackRow) return rowPadTopView(true) + tileViewH() + rowPadBottomView();
  return rowPadTopView(foe) + tileViewH() + rowGapView() + tileViewH() + rowPadBottomView();
}
/** Altezza di VISTA dell'intera superficie. */
/**
 * L'ordinata di VISTA della carta in catena di risposta (§7.2): centrata sul
 * varco fra il campo avversario e il tuo — «in mezzo fra il giocatore e
 * l'avversario» (deciso 2026-09-10), non sul centro della lavagna, che coi
 * margini diversi in cima e in fondo scivolava su un Fronte.
 */
export function chainRowY(): number {
  return topPadView() + bandViewH(true) + halfGapView() / 2 - tileViewH() / 2;
}

export function surfaceViewH(): number {
  return topPadView() + bandViewH(true) + bandViewH(false) + halfGapView() + bottomPadView();
}

/**
 * La mappa di compressione: canonico→compatto, piecewise lineare e monotona
 * sui punti fermi del layout (pad, file, varchi). Fuori dalla modalità
 * compatta è l'identità. `decompress` è l'inversa esatta.
 */
function anchors(): [number[], number[]] {
  const canon: number[] = [0];
  const view: number[] = [0];
  const seg = (dc: number, dv: number): void => {
    canon.push(canon[canon.length - 1] + dc);
    view.push(view[view.length - 1] + dv);
  };
  seg(TOP_PAD, topPadView());
  for (let band = 0; band < 2; band += 1) {
    // In metrica di vista la fascia in alto è sempre l'avversaria,
    // capovolta: prima la fila di servizio, poi il Fronte. La propria, in
    // basso, il contrario. Conta solo in rincasso, dove le due file hanno
    // altezze diverse.
    // In rincasso la fila di servizio avversaria si azzera: le sue carte
    // cadono sull'orlo del Fronte (le pile stanno nel pannello, che non
    // passa di qui).
    const foeBack = band === 0 && recessView && !foeBackRow;
    const rows = band === 0 ? [foeBack ? 0 : tileViewH(), tileViewH()] : [tileViewH(), tileViewH()];
    seg(ROW_PAD, rowPadTopView(band === 0));
    seg(TILE_H, rows[0]);
    seg(ROW_GAP, foeBack ? 0 : rowGapView());
    seg(TILE_H, rows[1]);
    seg(ROW_PAD, rowPadBottomView());
    if (band === 0) seg(HALF_GAP, halfGapView());
  }
  seg(BOTTOM_PAD, bottomPadView());
  return [canon, view];
}

function remap(y: number, from: number[], to: number[]): number {
  if (y <= from[0]) return to[0] + (y - from[0]);
  for (let i = 1; i < from.length; i += 1) {
    if (y <= from[i]) {
      const span = from[i] - from[i - 1];
      const ratio = span === 0 ? 0 : (y - from[i - 1]) / span;
      return to[i - 1] + ratio * (to[i] - to[i - 1]);
    }
  }
  return to[to.length - 1] + (y - from[from.length - 1]);
}

function compress(y: number): number {
  if (!stretched()) return y;
  const [canon, view] = anchors();
  return Math.round(remap(y, canon, view));
}
function decompress(y: number): number {
  if (!stretched()) return y;
  const [canon, view] = anchors();
  return Math.round(remap(y, view, canon));
}

/** Dove sta la fascia di `seat` sullo schermo di `viewer`: la propria in basso. */
export function viewBandTop(seat: Seat, viewer: Seat): number {
  return compress(canonBandTop(seat, viewer));
}

/**
 * Ordinata (in vista) della linea di battaglia: la cima del Fronte avversario,
 * che capovolto guarda il tuo dall'altra parte del varco. È l'inquadratura di
 * partenza: i due Fronti insieme, il proprio campo senza scorrere.
 */
export function viewBattleTop(viewer: Seat): number {
  return compress(canonBandTop(otherSeat(viewer), viewer) + HALF_H - ROW_PAD - TILE_H);
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
  if (!band) return compress(y);
  const local = center - BAND_TOP[band];
  const moved = canonBandTop(band, viewer) + (band === viewer ? local : flipInBand(local));
  return compress(moved - HALF_TILE);
}

/**
 * Da coordinata di schermo a coordinata condivisa: serve quando una carta
 * viene posata a mano libera, perché il punto in cui è stata lasciata va
 * riportato nel sistema comune prima di finire nello stato.
 */
export function fromView(y: number, viewer: Seat): number {
  const canonical = decompress(y);
  const center = canonical + HALF_TILE;
  let band: Seat;
  if (center >= TOP_PAD && center < TOP_PAD + HALF_H) band = otherSeat(viewer);
  else if (center >= TOP_PAD + SWAP_Y && center < TOP_PAD + SWAP_Y + HALF_H) band = viewer;
  else return canonical;
  const local = center - canonBandTop(band, viewer);
  const moved = BAND_TOP[band] + (band === viewer ? local : flipInBand(local));
  return moved - HALF_TILE;
}

/** Il posto di una carta sullo schermo. */
export interface ViewSpot {
  x: number;
  y: number;
}

/**
 * Da coordinata condivisa a posto sullo schermo, per questo giocatore, in
 * due dimensioni. La x non cambia mai e la y passa da `toView`; l'unica
 * eccezione è il rincasso, dove la Zona di Richiamo non ha un riquadro suo
 * e il Rubyfront in attesa si disegna in quello del Rubyfront, sulla fila
 * del Fronte.
 */
export function viewOf(x: number, y: number, viewer: Seat): ViewSpot {
  if (recessView && atRecall(x, y)) {
    // Le coordinate restano quelle della Zona di Richiamo: è solo dove lo
    // si vede — il riquadro dice lo stato, col tasto Schiera.
    const band = bandOfCenter(y + HALF_TILE)!;
    return { x: RUBYFRONT_X + Math.round(x - SLOT_X.richiamo), y: toView(frontRowY(band) + (y - backRowY(band)), viewer) };
  }
  return { x, y: toView(y, viewer) };
}

/** Da posto sullo schermo a coordinata condivisa: il rilascio a mano libera. */
export function fromViewPoint(vx: number, vy: number, viewer: Seat): { x: number; y: number } {
  return { x: vx, y: fromView(vy, viewer) };
}

/** Larghezza di VISTA della superficie. */
export function surfaceViewW(): number {
  return SURFACE_W;
}
