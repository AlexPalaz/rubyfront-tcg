// L'ingrandimento al passaggio del mouse.
//
// Sul tavolo le carte stanno a 302×424 e non cambiano mai misura. Per leggerle
// ci si passa sopra: compare la stessa carta a 520×728, la grandezza piena del
// renderer. È un pannello inerte (`pointer-events: none`) e sparisce al primo
// pointerdown, così il click che lo fa sparire è già l'inizio del trascinamento
// e non serve un secondo gesto.

import { CARD_H, CARD_W, fitTexts, renderFace } from "./renderer.js";

const OPEN_DELAY = 130;
const MARGIN = 12;

let layer: HTMLElement;
let openTimer: number | undefined;
/** Chiave della carta per cui il popup è stato soppresso finché il mouse non esce. */
let suppressed: string | null = null;
const cache = new Map<string, HTMLElement>();

export function setupPreview(): void {
  layer = document.createElement("div");
  layer.className = "preview-layer";
  layer.hidden = true;
  document.body.append(layer);

  // Qualunque pressione chiude: si sta per trascinare, o per cliccare altrove.
  document.addEventListener("pointerdown", () => hidePreview(true), true);
  document.addEventListener("wheel", () => hidePreview(false), { passive: true, capture: true });
}

function keyOf(cardId: string, face: number, theme: string, locale: string): string {
  return `${cardId}:${face}:${theme}:${locale}`;
}

/** Chiama questa su pointerenter della tessera. */
export function armPreview(
  anchor: HTMLElement,
  cardId: string,
  face: number,
  theme: string,
  locale: string
): void {
  const key = keyOf(cardId, face, theme, locale);
  if (suppressed === key) return;
  window.clearTimeout(openTimer);
  openTimer = window.setTimeout(() => showPreview(anchor, cardId, face, theme, locale), OPEN_DELAY);
}

/**
 * Il tap su touch: niente hover, è il dito a chiedere l'ingrandimento.
 * Subito, senza attesa — e lo stesso tap sulla stessa carta lo richiude:
 * il pointerdown del tap ha appena chiuso (e soppresso) l'eventuale
 * ingrandimento aperto, e se era proprio questa carta il gesto è "chiudi".
 */
export function tapPreview(
  anchor: HTMLElement,
  cardId: string,
  face: number,
  theme: string,
  locale: string
): void {
  const key = keyOf(cardId, face, theme, locale);
  if (suppressed === key) {
    suppressed = null;
    return;
  }
  suppressed = null;
  window.clearTimeout(openTimer);
  showPreview(anchor, cardId, face, theme, locale);
}

/** Chiama questa su pointerleave della tessera. */
export function disarmPreview(): void {
  window.clearTimeout(openTimer);
  suppressed = null;
  layer.hidden = true;
}

function hidePreview(suppress: boolean): void {
  window.clearTimeout(openTimer);
  if (suppress && !layer.hidden) suppressed = layer.dataset.key ?? null;
  layer.hidden = true;
}

function showPreview(
  anchor: HTMLElement,
  cardId: string,
  face: number,
  theme: string,
  locale: string
): void {
  // Fra l'armamento e lo scadere del timer la carta può essere sparita dal
  // DOM (mossa, pescata, rimescolata): in quel caso non si mostra nulla.
  if (!anchor.isConnected) return;
  const key = keyOf(cardId, face, theme, locale);
  if (suppressed === key) return;

  let visual = cache.get(key);
  const fresh = !visual;
  if (!visual) {
    const rendered = renderFace(cardId, face, theme, locale);
    if (!rendered) return;
    visual = rendered;
    cache.set(key, visual);
  }
  layer.dataset.key = key;
  layer.replaceChildren(visual);
  layer.hidden = false;
  // fitTextBoxes misura: la carta dev'essere già nel documento e visibile.
  if (fresh) fitTexts(layer);

  place(anchor);
}

/**
 * Il pannello si affianca alla carta, dal lato dove c'è spazio, e resta
 * dentro la finestra. Non copre mai la tessera da cui nasce: serve a leggere,
 * non a nascondere il tavolo.
 */
function place(anchor: HTMLElement): void {
  const box = anchor.getBoundingClientRect();
  // L'ingrandimento si misura sullo schermo: circa l'80% dell'altezza della
  // finestra (e mai oltre metà larghezza), col tetto della misura piena.
  // Sul desktop resta il 520×728 di sempre; su un iPad si fa della taglia
  // giusta invece di dominare il tavolo. Un solo fattore per larghezza e
  // altezza: le proporzioni della carta non si toccano mai.
  const zoom = Math.min(
    1,
    (window.innerHeight * .8) / CARD_H,
    (window.innerWidth * .5) / CARD_W
  );
  // Transform, non zoom: WebKit lo disegna a modo suo. Left e top restano
  // pixel veri.
  layer.style.transformOrigin = "top left";
  layer.style.transform = zoom < 1 ? `scale(${Math.round(zoom * 1000) / 1000})` : "";
  const width = CARD_W * zoom;
  const height = CARD_H * zoom;
  const spaceRight = window.innerWidth - box.right;
  const left = spaceRight >= width + MARGIN * 2
    ? box.right + MARGIN
    : Math.max(MARGIN, box.left - width - MARGIN);
  const top = Math.min(
    Math.max(MARGIN, box.top + box.height / 2 - height / 2),
    Math.max(MARGIN, window.innerHeight - height - MARGIN)
  );
  layer.style.left = `${Math.round(left)}px`;
  layer.style.top = `${Math.round(top)}px`;
}

/** Il cambio di tema invalida tutte le carte già disegnate. */
export function clearPreviewCache(): void {
  cache.clear();
}
