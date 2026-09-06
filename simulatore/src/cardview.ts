// La tessera: una carta sul tavolo, sempre 302×424.
//
// Dentro, la carta è disegnata dal renderer del sito alla sua misura vera
// (520×728) e rimpicciolita da un transform. Non si ridisegna in piccolo: così
// `fitTextBoxes` misura la carta reale e il corpo del testo resta quello
// giusto, identico alla pagina del mazzo.

import { t } from "./i18n.js";
import { armPreview, disarmPreview } from "./preview.js";
import { CARD_H, CARD_W, TILE_H, TILE_SCALE, TILE_W, fitTexts, getCard, renderFace } from "./renderer.js";
import type { CardInstance } from "./types.js";

export { TILE_H, TILE_W };

export interface FaceOptions {
  /** Mostra il dorso: carta coperta, mazzo, mano avversaria. */
  back: boolean;
  theme: string;
  locale: string;
  /**
   * La TESSERA della vista compatta: non la carta rimpicciolita, ma la sua
   * illustrazione col nome, il costo e la Potenza (o i PV) sovrapposti in
   * corpo fisso — leggibili a qualunque scala del tavolo, perché il corpo
   * si contro-scala col CSS (--ui-inv). Il testo di regole si legge
   * nell'ingrandimento al passaggio, che resta la carta intera.
   */
  tess?: boolean;
  /**
   * I DISTINTIVI della tessera sopra la carta intera (rincasso): costo,
   * Potenza o PV, Contrattacco e parole chiave a corpo fisso agli angoli,
   * come nella vista compatta, mentre sotto resta la carta vera. La carta
   * rimpicciolita non si legge; i distintivi sì, a qualunque scala.
   */
  badges?: boolean;
}

/** Le spade della Potenza, le stesse della carta e dei segni del tavolo. */
const TESS_SWORDS =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<line x1="4.8" y1="19.2" x2="19.8" y2="4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '<line x1="19.2" y1="19.2" x2="4.2" y2="4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '<line x1="4.3" y1="15.4" x2="8.6" y2="19.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
  '<line x1="19.7" y1="15.4" x2="15.4" y2="19.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
  "</svg>";

/** La freccia del Contrattacco, la stessa della carta (card-render.js). */
const TESS_COUNTER =
  '<svg viewBox="0 0 20 20" aria-hidden="true">' +
  '<path d="M 4.5 12.5 A 6 6 0 1 1 10 16.5" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
  '<path d="M 4.5 12.5 L 2 9.8 M 4.5 12.5 L 8 11.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
  "</svg>";

/**
 * Le parole chiave stampate (§8.1) come icone sulla tessera, alla maniera
 * dei giochi digitali: si capisce cosa fa la carta senza aprirla. Il nome
 * per esteso sta nel suggerimento.
 */
const KEY_ICON: Record<string, string> = {
  // Slancio: il fulmine, attacca subito.
  surge: '<path d="M13 2 5 14h6l-1 8 8-12h-6z"/>',
  // Stasi: fermo, congelato.
  stasis: '<path d="M7 4h3v16H7zM14 4h3v16h-3z"/>',
  // Vendetta: lo scudo che colpisce — bloccando, uccide. (Niente frecce:
  // la freccia che torna è del Contrattacco.)
  revenge: '<path d="M12 3 5 6v6c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6z"/><path d="m8.5 15.5 7-7"/>',
  // Furia: la fiamma.
  fury: '<path d="M12 2c1 4 6 6 6 11a6 6 0 0 1-12 0c0-2 1-4 2.5-5 0 2 1 3 2.5 3 1-3-1-6 1-9z"/>',
};
const keyIcon = (paths: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

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

  const tess = options.tess === true;
  const badges = !tess && options.badges === true && !options.back;
  // La tessera e i distintivi entrano nella firma: al cambio di vista ogni
  // carta si ridisegna nella forma giusta, e la carta intera rifà il suo fit.
  const fullSignature = tess ? `tess:${signature}` : badges ? `badges:${signature}` : signature;

  if (element.dataset.signature !== fullSignature) {
    element.dataset.signature = fullSignature;
    element.classList.toggle("is-tess", tess);
    element.classList.toggle("is-badged", badges);
    element.querySelector(":scope > .tess")?.remove();
    delete element.dataset.fit;
    if (tess) {
      // La carta si disegna lo stesso, ma solo per leggerne i dati: da lì
      // escono illustrazione, nome, costo e Potenza. Non entra nel documento
      // e non passa dal fit.
      scaler.replaceChildren();
      const face = options.back ? null : renderFace(card.cardId, card.face, options.theme, options.locale);
      element.append(buildTess(face, card.cardId, card.face));
    } else if (options.back) {
      scaler.replaceChildren(cardBack());
    } else {
      const face = renderFace(card.cardId, card.face, options.theme, options.locale);
      scaler.replaceChildren(face ?? cardBack());
      // Il fit misura scrollHeight/clientHeight: serve che la carta sia già
      // nel documento. Se non lo è ancora, ci pensa fitPending().
      if (face && element.isConnected) fitTexts(face);
      else element.dataset.fit = "pending";
      // I distintivi si leggono dalla stessa carta appena disegnata.
      if (face && badges) element.append(buildBadges(face, card.cardId, card.face));
    }
  }

  element.dataset.theme = options.theme;
  element.classList.toggle("is-tapped", card.tapped);
  element.classList.toggle("is-back", options.back);
  element.dataset.cardId = card.cardId;
  element.dataset.face = String(card.face);
}

/**
 * La tessera compatta, letta dalla carta disegnata dal renderer: così il
 * costo a dado, i PV del Rubyfront, il nome della faccia sono ESATTAMENTE
 * quelli stampati, senza rifare la logica della carta. Niente carta: dorso.
 */
function buildTess(face: HTMLElement | null, cardId: string, faceIndex: number): HTMLElement {
  const tess = document.createElement("div");
  tess.className = "tess";
  if (!face) {
    tess.append(cardBack());
    return tess;
  }
  const source =
    face.querySelector<HTMLImageElement>(".bg-art") ??
    face.querySelector<HTMLImageElement>(".art img");
  const art = document.createElement("img");
  art.className = "tess-art";
  art.alt = "";
  art.draggable = false;
  if (source?.src) art.src = source.src;
  else art.classList.add("is-missing");
  tess.append(art);
  appendBadges(tess, face, cardId, faceIndex);

  const name = document.createElement("div");
  name.className = "tess-name";
  name.textContent = face.querySelector(".titlebar .name")?.textContent?.trim() ?? "";
  tess.append(name);
  return tess;
}

/**
 * I distintivi soli, sopra la carta intera (rincasso): lo stesso strato
 * della tessera (.tess, così setTessPower e i segni del tavolo li trovano
 * allo stesso posto), ma trasparente e senza arte né nome — sotto c'è la
 * carta vera.
 */
function buildBadges(face: HTMLElement, cardId: string, faceIndex: number): HTMLElement {
  const layer = document.createElement("div");
  layer.className = "tess is-badges";
  appendBadges(layer, face, cardId, faceIndex);
  return layer;
}

/** Costo, Potenza o PV, Contrattacco e parole chiave, letti dalla carta disegnata. */
function appendBadges(tess: HTMLElement, face: HTMLElement, cardId: string, faceIndex: number): void {
  const cost = face.querySelector<HTMLElement>(".titlebar .cost");
  if (cost) {
    const chip = document.createElement("span");
    chip.className = "tess-cost";
    if (cost.classList.contains("die")) {
      chip.classList.add("is-die");
      chip.title = cost.title;
    }
    chip.textContent = cost.textContent?.trim() ?? "";
    tess.append(chip);
  }

  const hp = face.querySelector<HTMLElement>(".titlebar .hp");
  const power = face.querySelector<HTMLElement>(".titlebar .power-badge");
  if (hp && hp.textContent?.trim() !== "—") {
    const chip = document.createElement("span");
    chip.className = "tess-hp";
    const value = hp.firstChild?.textContent?.trim() ?? "";
    const unit = hp.querySelector("small")?.textContent?.trim() ?? "";
    chip.append(Object.assign(document.createElement("b"), { textContent: value }), " ", Object.assign(document.createElement("small"), { textContent: unit }));
    tess.append(chip);
  } else if (power) {
    const chip = document.createElement("span");
    chip.className = "tess-power";
    chip.title = power.title;
    chip.innerHTML = TESS_SWORDS;
    const printed = power.textContent?.trim() ?? "";
    chip.dataset.printed = printed;
    chip.append(Object.assign(document.createElement("b"), { textContent: printed }));
    tess.append(chip);
  }

  // Il Contrattacco stampato (§6.3), sotto la Potenza, con la sua freccia:
  // è l'altro numero del combattimento, e non va confuso con le spade.
  const counter = face.querySelector<HTMLElement>(".counter-badge b");
  if (counter?.textContent) {
    const chip = document.createElement("span");
    chip.className = "tess-counter";
    chip.title = face.querySelector<HTMLElement>(".counter-badge")?.title ?? "";
    chip.innerHTML = TESS_COUNTER;
    chip.append(Object.assign(document.createElement("b"), { textContent: counter.textContent.trim() }));
    tess.append(chip);
  }

  // Le parole chiave stampate, in colonna sotto il costo.
  const printed = getCard(cardId)?.faces[faceIndex]?.keywords ?? [];
  const ids = printed
    .map(keyword => (typeof keyword === "string" ? keyword : (keyword as { id?: unknown })?.id))
    .filter((id): id is string => typeof id === "string" && id in KEY_ICON);
  if (ids.length > 0) {
    const keys = document.createElement("div");
    keys.className = "tess-keys";
    for (const id of ids) {
      const chip = document.createElement("span");
      chip.className = `tess-key is-${id}`;
      chip.innerHTML = keyIcon(KEY_ICON[id]);
      chip.title = t(`grant.${id}`);
      keys.append(chip);
    }
    tess.append(keys);
  }
}

/**
 * La Potenza attuale sulla tessera (§8.2): il numero stampato resta nel
 * dato, quello mostrato è ciò che vale adesso — in rubino se sale, spento se
 * scende. `null` riporta lo stampato.
 */
export function setTessPower(element: HTMLElement, now: number | null): void {
  const chip = element.querySelector<HTMLElement>(":scope > .tess > .tess-power");
  if (!chip) return;
  const printed = Number(chip.dataset.printed);
  const shown = now === null || Number.isNaN(printed) ? chip.dataset.printed ?? "" : String(now);
  const label = chip.querySelector("b");
  if (label && label.textContent !== shown) label.textContent = shown;
  const delta = now === null || Number.isNaN(printed) ? 0 : now - printed;
  chip.classList.toggle("is-up", delta > 0);
  chip.classList.toggle("is-down", delta < 0);
}

/**
 * I Punti Vita del giocatore SUL Rubyfront (§3): il distintivo dei PV mostra
 * quelli rimasti, non lo stampato — i PV si segnano una volta sola, dove
 * sta il Rubyfront. Quando cambiano, il numero scorre fino al nuovo valore
 * e il distintivo lampeggia: rubino se scende, verde se sale. `null`
 * riporta lo stampato (carta fuori dal campo).
 */
export function setTessHp(element: HTMLElement, now: number | null): void {
  const chip = element.querySelector<HTMLElement>(":scope > .tess > .tess-hp");
  if (!chip) return;
  const label = chip.querySelector("b");
  if (!label) return;
  const printed = chip.dataset.printed ?? label.textContent ?? "";
  chip.dataset.printed = printed;
  const target = now === null ? Number(printed) : now;
  const shown = Number(chip.dataset.shown ?? printed);
  if (target === shown || Number.isNaN(target)) {
    if (Number.isNaN(target)) label.textContent = printed;
    return;
  }
  const from = Number.isNaN(shown) ? target : shown;
  chip.dataset.shown = String(target);
  // La corsa del numero: scorre di uno in uno, in HP_TWEEN_MS, e il colore
  // resta acceso un attimo oltre la fine. Una corsa nuova soppianta quella
  // in atto (la sua chiave la ferma).
  const run = String(Date.now() + Math.random());
  chip.dataset.run = run;
  chip.classList.remove("is-down", "is-up");
  void chip.offsetWidth;
  chip.classList.add(target < from ? "is-down" : "is-up");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    label.textContent = String(target);
    return;
  }
  const start = performance.now();
  const step = (time: number): void => {
    if (chip.dataset.run !== run) return;
    const k = Math.min(1, (time - start) / HP_TWEEN_MS);
    const eased = 1 - (1 - k) * (1 - k);
    label.textContent = String(Math.round(from + (target - from) * eased));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const HP_TWEEN_MS = 650;

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
