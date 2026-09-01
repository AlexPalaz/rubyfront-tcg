// Trascinamento delle carte.
//
// Una sola meccanica per tutte le zone: si afferra la tessera, la segue un
// fantasma a grandezza di tessera, e al rilascio si guarda cosa c'è sotto il
// puntatore. I bersagli si dichiarano nel DOM con `data-drop` (e `data-seat`
// dove serve distinguere le due metà del tavolo): chi disegna una zona non
// deve registrare niente qui.

import { TILE_W, isCompactView, tileViewH } from "./ctx.js";
import type { Seat, ZoneId } from "./types.js";

/** `snapped`: la carta si è agganciata a un riquadro, non posata a mano libera. */
export interface FieldDrop {
  kind: "field";
  x: number;
  y: number;
  snapped: boolean;
}

export type Drop =
  | FieldDrop
  | { kind: "zone"; zone: ZoneId; seat: Seat }
  | null;

export interface DragOptions {
  /** Falso per bloccare il trascinamento (carta non tua, mano avversaria). */
  canDrag(): boolean;
  /** Il trascinamento è partito davvero (superata la soglia): il fantasma
      esiste. Un click secco non passa di qui. */
  onStart?(): void;
  /**
   * Posizione live durante il trascinamento. Passa il Drop intero e non due
   * numeri: chi ascolta deve sapere se sono coordinate di schermo (rilascio a
   * mano libera) o già canoniche (aggancio a un riquadro).
   */
  onDragMove?(drop: FieldDrop): void;
  onDrop(drop: Drop): void;
  /** Pressione e rilascio senza spostamento: un tap, non un trascinamento. */
  onTap?(up: PointerEvent): void;
  /** Pressione LUNGA senza spostamento, solo touch: il tasto destro del
      dito. Quando scatta, il gesto è consumato — niente drag, niente tap. */
  onContext?(event: PointerEvent): void;
}

const THRESHOLD = 4;
/** Quanto tenere premuto (touch) perché diventi un menu contestuale. */
const LONG_PRESS_MS = 450;

/**
 * Pressione lunga su un elemento qualsiasi (pile, slot): l'alternativa touch
 * al tasto destro. Un dito che si sposta o si alza in tempo la annulla.
 */
export function enableLongPress(element: HTMLElement, handler: (x: number, y: number) => void): void {
  let timer = 0;
  let startX = 0;
  let startY = 0;
  const cancel = (): void => window.clearTimeout(timer);
  element.addEventListener("pointerdown", event => {
    if (event.pointerType !== "touch") return;
    startX = event.clientX;
    startY = event.clientY;
    cancel();
    timer = window.setTimeout(() => handler(startX, startY), LONG_PRESS_MS);
  });
  element.addEventListener("pointermove", event => {
    if (Math.abs(event.clientX - startX) > 8 || Math.abs(event.clientY - startY) > 8) cancel();
  });
  element.addEventListener("pointerup", cancel);
  element.addEventListener("pointercancel", cancel);
  element.addEventListener("pointerleave", cancel);
}

/**
 * La scala a cui il tavolo è disegnato (--card-scale, la imposta table.ts):
 * sotto 1, tessere e superficie sono rimpicciolite via zoom e ogni misura di
 * schermo va divisa per tornare canonica.
 */
function tableScale(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--card-scale")) || 1;
}

export function enableDrag(element: HTMLElement, options: DragOptions): void {
  element.addEventListener("pointerdown", event => {
    // Solo tasto sinistro: il destro apre il menu contestuale.
    if (event.button !== 0 || !options.canDrag()) return;
    event.preventDefault();

    const box = element.getBoundingClientRect();
    let grabX = event.clientX - box.left;
    let grabY = event.clientY - box.top;
    const startX = event.clientX;
    const startY = event.clientY;
    // La carta afferrata può avere una scala sua: in mano sta più grande che
    // sul campo (--hand-scale). Il fantasma eredita QUELLA, e la presa torna
    // canonica dividendo per quella; il punto di rilascio invece si misura
    // sempre con la scala del campo (vedi resolve). Il rapporto col rettangolo
    // a schermo è affidabile per la mano (lì le carte non ruotano mai); sul
    // campo, dove una tappata è ruotata, si usa la scala globale.
    const fromHand = Boolean(element.closest(".hand"));
    let grabScale = fromHand
      ? element.getBoundingClientRect().width / element.offsetWidth || 1
      : tableScale();
    let ghost: HTMLElement | null = null;

    // Su touch il tasto destro non esiste: la pressione lunga senza
    // spostamento apre il menu contestuale. Se il dito parte davvero
    // (soglia del drag), il timer muore e resta un trascinamento.
    let menuTimer = 0;
    if (event.pointerType === "touch" && options.onContext) {
      menuTimer = window.setTimeout(() => {
        element.removeEventListener("pointermove", onMove);
        element.removeEventListener("pointerup", onUp);
        element.removeEventListener("pointercancel", onUp);
        try {
          element.releasePointerCapture?.(event.pointerId);
        } catch {
          /* niente cattura */
        }
        options.onContext!(event);
      }, LONG_PRESS_MS);
    }

    const start = (): void => {
      // Il documento sa che si sta trascinando: serve alle zone che di norma
      // lasciano passare il puntatore (la mano) e che invece, mentre una
      // carta è in volo, devono poterla ricevere. Vedi style.css.
      document.body.classList.add("is-dragging-card");
      ghost = element.cloneNode(true) as HTMLElement;
      ghost.classList.add("drag-ghost");
      // Il clone si porta dietro gli stili in linea della tessera, e quelli
      // battono qualsiasi regola di classe. Una carta in mano è
      // `position: relative` con un margine negativo: senza queste righe il
      // fantasma finirebbe in fondo al body invece che sotto il puntatore, e
      // la carta sembrerebbe sparire fino al rilascio. Vanno messi in linea
      // anche loro, non in .drag-ghost.
      ghost.style.position = "fixed";
      ghost.style.margin = "0";
      ghost.style.zIndex = "9500";
      // Inerte, altrimenti si intercetterebbe da solo su elementFromPoint.
      ghost.style.pointerEvents = "none";
      // Misure di layout, non il rettangolo a schermo: quello di una carta
      // tappata è ruotato, e in scala è già rimpicciolito. La stessa scala il
      // fantasma se la porta addosso con un transform (non zoom: WebKit lo
      // disegna a modo suo); left e top restano pixel veri.
      ghost.style.width = `${element.offsetWidth}px`;
      ghost.style.height = `${element.offsetHeight}px`;
      // In vista compatta la carta presa DALLA MANO diventa subito la sua
      // tessera da campo: ritagliata alla testa e alla scala del tavolo,
      // com'è dove sta per atterrare. La presa si ricentra sulla tessera
      // ridotta — e il rilascio, che ragiona sulla stessa presa, la posa
      // esattamente dove la si vede.
      if (fromHand && isCompactView()) {
        ghost.style.height = `${tileViewH()}px`;
        ghost.classList.add("is-cropped");
        grabScale = tableScale();
        grabX = (element.offsetWidth * grabScale) / 2;
        grabY = (tileViewH() * grabScale) / 2;
      }
      if (grabScale !== 1) {
        ghost.style.transformOrigin = "top left";
        ghost.style.transform = `scale(${grabScale})`;
      }
      moveGhost(startX, startY);
      document.body.append(ghost);
      element.classList.add("is-dragging");
      options.onStart?.();
    };

    const moveGhost = (clientX: number, clientY: number): void => {
      if (!ghost) return;
      ghost.style.left = `${clientX - grabX}px`;
      ghost.style.top = `${clientY - grabY}px`;
    };

    const onMove = (move: PointerEvent): void => {
      if (!ghost) {
        if (Math.abs(move.clientX - startX) < THRESHOLD && Math.abs(move.clientY - startY) < THRESHOLD) return;
        window.clearTimeout(menuTimer);
        start();
      }
      moveGhost(move.clientX, move.clientY);
      highlight(move.clientX, move.clientY);
      if (options.onDragMove) {
        const drop = resolve(move.clientX, move.clientY, grabX / grabScale, grabY / grabScale);
        if (drop?.kind === "field") options.onDragMove(drop);
      }
    };

    const onUp = (up: PointerEvent): void => {
      window.clearTimeout(menuTimer);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onUp);
      // Se la cattura non c'era (vedi sotto), il rilascio lancerebbe — e si
      // porterebbe via il drop.
      try {
        element.releasePointerCapture?.(event.pointerId);
      } catch {
        /* niente cattura, niente rilascio */
      }
      clearHighlight();
      if (!ghost) {
        document.body.classList.remove("is-dragging-card");
        options.onTap?.(up); // click secco, non un trascinamento
        return;
      }
      ghost.remove();
      ghost = null;
      element.classList.remove("is-dragging");
      // Il bersaglio si legge prima di togliere la classe: è quella a rendere
      // la mano ricevibile, e spegnendola prima il rilascio cadrebbe nel vuoto.
      const drop = resolve(up.clientX, up.clientY, grabX / grabScale, grabY / grabScale);
      document.body.classList.remove("is-dragging-card");
      options.onDrop(drop);
    };

    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onUp);
    // La cattura può fallire (puntatore già rilasciato, o sintetico nei
    // test): non deve portarsi via i listener, che stanno sopra apposta.
    try {
      element.setPointerCapture?.(event.pointerId);
    } catch {
      /* si trascina lo stesso, senza cattura */
    }
  });
}

let highlighted: HTMLElement | null = null;

/**
 * Un bersaglio "preciso" è un posto che il giocatore ha mirato: una pila o un
 * riquadro segnato. La lavagna nuda e la fascia della mano non lo sono: valgono
 * per esclusione, quando lì sotto non c'è niente di meglio.
 */
function isPrecise(target: HTMLElement): boolean {
  if (target.dataset.snapX !== undefined) return true;
  const zone = target.dataset.drop;
  return zone !== "field" && zone !== "hand";
}

function targetAt(clientX: number, clientY: number): HTMLElement | null {
  const found: HTMLElement[] = [];
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    const target = (node as HTMLElement).closest<HTMLElement>("[data-drop]");
    if (target && !found.includes(target)) found.push(target);
  }
  // La mano è disegnata sopra il tavolo: senza questa precedenza, lasciare una
  // carta nella Zona di Richiamo (che le sta sotto) la rimanderebbe in mano.
  return found.find(isPrecise) ?? found[0] ?? null;
}

function highlight(clientX: number, clientY: number): void {
  const target = targetAt(clientX, clientY);
  if (target === highlighted) return;
  highlighted?.classList.remove("is-drop-target");
  highlighted = target;
  if (target && target.dataset.drop !== "field") target.classList.add("is-drop-target");
  else if (target?.dataset.snapX !== undefined) target.classList.add("is-drop-target");
}

function clearHighlight(): void {
  highlighted?.classList.remove("is-drop-target");
  highlighted = null;
}

/**
 * Il riquadro segnato che l'impronta della carta copre di più, se la
 * copertura basta a leggere un'intenzione. L'impronta è la tessera com'è
 * VISTA al rilascio (dal fantasma: presa canonica × scala del campo): è
 * quella che il giocatore ha allineato allo slot, non il suo dito.
 */
function snapByFootprint(
  clientX: number,
  clientY: number,
  grabCanonX: number,
  grabCanonY: number
): HTMLElement | null {
  const scale = tableScale();
  const left = clientX - grabCanonX * scale;
  const top = clientY - grabCanonY * scale;
  const width = TILE_W * scale;
  const height = tileViewH() * scale;
  let best: HTMLElement | null = null;
  // Sotto il 40% di copertura non è un'intenzione: la lavagna resta libera.
  let bestShare = 0.4;
  for (const el of document.querySelectorAll<HTMLElement>("[data-snap-x]")) {
    const box = el.getBoundingClientRect();
    const acrossX = Math.min(left + width, box.right) - Math.max(left, box.left);
    const acrossY = Math.min(top + height, box.bottom) - Math.max(top, box.top);
    if (acrossX <= 0 || acrossY <= 0) continue;
    const share = (acrossX * acrossY) / Math.min(width * height, box.width * box.height);
    if (share > bestShare) {
      bestShare = share;
      best = el;
    }
  }
  return best;
}

/**
 * Il punto di rilascio diventa una destinazione. Per la lavagna si riporta
 * l'angolo in alto a sinistra della tessera, non il puntatore: la carta si
 * posa dove la si vede, non dove si tiene il dito. La presa arriva già in
 * misura CANONICA (divisa per la scala della carta afferrata): qui si
 * canonizza solo il punto del puntatore, con la scala del campo.
 */
function resolve(clientX: number, clientY: number, grabCanonX: number, grabCanonY: number): Drop {
  let target = targetAt(clientX, clientY);
  // Il dito può stare fuori dal riquadro mentre la CARTA ci sta sopra: presa
  // per la testata, la si centra nello slot a occhio e il puntatore resta
  // qualche pixel oltre il bordo — e la carta si poserebbe alta, «fuori
  // slot». Se il dito è sulla LAVAGNA NUDA, decide l'IMPRONTA: il riquadro
  // che la carta, com'è vista al rilascio, copre di più. Mano e pile restano
  // affare del dito: l'impronta non ruba i rilasci mirati altrove.
  if (target?.dataset.drop === "field" && target.dataset.snapX === undefined) {
    const byCard = snapByFootprint(clientX, clientY, grabCanonX, grabCanonY);
    if (byCard) target = byCard;
  }
  if (!target) return null;
  const zone = target.dataset.drop as ZoneId | "field" | undefined;
  if (zone === "field") {
    // Un riquadro segnato (i cinque slot del Fronte, il posto del Rubyfront,
    // la Zona di Richiamo) porta con sé le sue coordinate: la carta ci si
    // incastra dentro invece di posarsi storta dov'era il dito. Fuori dai
    // riquadri la lavagna resta libera.
    const snapX = target.dataset.snapX;
    if (snapX !== undefined) {
      return { kind: "field", x: Number(snapX), y: Number(target.dataset.snapY), snapped: true };
    }
    const box = target.getBoundingClientRect();
    // La lavagna può essere disegnata in scala: il punto di rilascio va
    // riportato in misura canonica, o la carta si poserebbe altrove.
    const scale = tableScale();
    return {
      kind: "field",
      x: Math.round((clientX - box.left) / scale - grabCanonX),
      y: Math.round((clientY - box.top) / scale - grabCanonY),
      snapped: false,
    };
  }
  if (!zone) return null;
  return { kind: "zone", zone, seat: (target.dataset.seat as Seat) ?? "a" };
}
