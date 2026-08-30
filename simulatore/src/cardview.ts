// La tessera: una carta sul tavolo, sempre 302×424.
//
// Dentro, la carta è disegnata dal renderer del sito alla sua misura vera
// (520×728) e rimpicciolita da un transform. Non si ridisegna in piccolo: così
// `fitTextBoxes` misura la carta reale e il corpo del testo resta quello
// giusto, identico alla pagina del mazzo.

import { armPreview, disarmPreview } from "./preview.js";
import { CARD_H, CARD_W, TILE_H, TILE_SCALE, TILE_W, fitTexts, renderFace } from "./renderer.js";
import type { CardInstance } from "./types.js";

export { TILE_H, TILE_W };

export interface FaceOptions {
  /** Mostra il dorso: carta coperta, mazzo, mano avversaria. */
  back: boolean;
  theme: string;
  locale: string;
}

export function createCardEl(uid: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "tile";
  element.dataset.uid = uid;
  element.style.width = `${TILE_W}px`;
  element.style.height = `${TILE_H}px`;

  const scaler = document.createElement("div");
  scaler.className = "tile-scaler";
  scaler.style.width = `${CARD_W}px`;
  scaler.style.height = `${CARD_H}px`;
  scaler.style.transform = `scale(${TILE_SCALE})`;
  element.append(scaler);
  return element;
}

function cardBack(): HTMLElement {
  const back = document.createElement("div");
  back.className = "card-back";
  back.innerHTML =
    '<svg viewBox="0 0 100 140" aria-hidden="true">' +
    '<rect x="6" y="6" width="88" height="128" rx="3" fill="none" stroke="currentColor" stroke-width="1"/>' +
    '<path d="M50 30 L70 70 L50 110 L30 70 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<circle cx="50" cy="70" r="8" fill="none" stroke="currentColor" stroke-width="1"/>' +
    "</svg>";
  return back;
}

/**
 * Allinea la tessera alla carta. Ridisegna solo se è cambiato qualcosa che si
 * vede: ricostruire una faccia costa (e farebbe ripartire `fitTextBoxes` su
 * ogni movimento del mouse).
 */
export function syncCardEl(element: HTMLElement, card: CardInstance, options: FaceOptions): void {
  const signature = options.back
    ? "back"
    : `${card.cardId}:${card.face}:${options.theme}:${options.locale}`;
  const scaler = element.firstElementChild as HTMLElement;

  if (element.dataset.signature !== signature) {
    element.dataset.signature = signature;
    if (options.back) {
      scaler.replaceChildren(cardBack());
    } else {
      const face = renderFace(card.cardId, card.face, options.theme, options.locale);
      scaler.replaceChildren(face ?? cardBack());
      // Il fit misura scrollHeight/clientHeight: serve che la carta sia già
      // nel documento. Se non lo è ancora, ci pensa fitPending().
      if (face && element.isConnected) fitTexts(face);
      else element.dataset.fit = "pending";
    }
  }

  element.dataset.theme = options.theme;
  element.classList.toggle("is-tapped", card.tapped);
  element.classList.toggle("is-back", options.back);
  element.dataset.cardId = card.cardId;
  element.dataset.face = String(card.face);
}

/** Completa il fit delle tessere costruite prima di entrare nel documento. */
export function fitPending(root: ParentNode): void {
  for (const element of root.querySelectorAll<HTMLElement>('.tile[data-fit="pending"]')) {
    if (!element.isConnected) continue;
    delete element.dataset.fit;
    fitTexts(element);
  }
}

/** Collega l'ingrandimento al passaggio del mouse. Il dorso non si ingrandisce. */
export function wirePreview(element: HTMLElement, locale: () => string): void {
  element.addEventListener("pointerenter", () => {
    if (element.classList.contains("is-back")) return;
    const cardId = element.dataset.cardId;
    if (!cardId) return;
    // Tema preso dalla tessera: l'ingrandimento dev'essere la stessa carta,
    // non la stessa carta in un altro tema.
    armPreview(element, cardId, Number(element.dataset.face ?? 0), element.dataset.theme ?? "t41", locale());
  });
  element.addEventListener("pointerleave", event => {
    // Su touch il dito "lascia" la carta a ogni tap: l'ingrandimento aperto
    // col tap deve restare, e lo chiude il tocco successivo (vedi tapPreview).
    if (event.pointerType === "touch") return;
    disarmPreview();
  });
}
