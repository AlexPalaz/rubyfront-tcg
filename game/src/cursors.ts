// I cursori del tavolo («il cursore del tavolo», deciso 2026-09-07): una
// PUNTA rubino con
// l'intaglio in basso e un alone morbido, inclinata come un puntatore. Sui
// tasti si schiarisce con un alone bianco (point); per prendere una carta la
// punta si svuota (grab), tenendola si fa granata (grabbing); il mirino per
// scegliere un bersaglio (aim). SVG in linea; dove il browser non li
// accetta resta il cursore di sistema, dopo la virgola. Il punto attivo è la
// cima (5 3); il mirino punta al centro.

import type { Application } from "pixi.js";

export const CURSORS = {
  arrow: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><defs><filter id='g' x='-60%' y='-60%' width='220%' height='220%'><feGaussianBlur stdDeviation='2.2'/></filter></defs><g transform='rotate(-35 5 3)'><path d='M5 3 L17 29 L5 22.5 L-7 29 Z' fill='%23d24a64' fill-opacity='0.85' filter='url(%23g)'/><path d='M5 3 L17 29 L5 22.5 L-7 29 Z' fill='%23d24a64' stroke='%23fbe0e6' stroke-width='1.2' stroke-linejoin='round'/></g></svg>\") 5 3, default",
  point: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><defs><filter id='g' x='-60%' y='-60%' width='220%' height='220%'><feGaussianBlur stdDeviation='2.2'/></filter></defs><g transform='rotate(-35 5 3)'><path d='M5 3 L17 29 L5 22.5 L-7 29 Z' fill='%23ffffff' fill-opacity='0.8' filter='url(%23g)'/><path d='M5 3 L17 29 L5 22.5 L-7 29 Z' fill='%23e56a86' stroke='%23ffffff' stroke-width='1.2' stroke-linejoin='round'/></g></svg>\") 5 3, pointer",
  grab: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><defs><filter id='g' x='-60%' y='-60%' width='220%' height='220%'><feGaussianBlur stdDeviation='2.2'/></filter></defs><g transform='rotate(-35 5 3)'><path d='M5 3 L17 29 L5 22.5 L-7 29 Z' fill='%23d24a64' fill-opacity='0.6' filter='url(%23g)'/><path d='M5 3 L17 29 L5 22.5 L-7 29 Z' fill='none' stroke='%23e56a86' stroke-width='2.6' stroke-linejoin='round'/></g></svg>\") 5 3, grab",
  grabbing: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><defs><filter id='g' x='-60%' y='-60%' width='220%' height='220%'><feGaussianBlur stdDeviation='2.2'/></filter></defs><g transform='rotate(-35 5 3)'><path d='M5 3 L17 29 L5 22.5 L-7 29 Z' fill='%23ff8ea6' fill-opacity='0.95' filter='url(%23g)'/><path d='M5 3 L17 29 L5 22.5 L-7 29 Z' fill='%239e0f34' stroke='%23ffffff' stroke-width='1.6' stroke-linejoin='round'/></g></svg>\") 5 3, grabbing",
  aim: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><defs><filter id='g' x='-60%' y='-60%' width='220%' height='220%'><feGaussianBlur stdDeviation='2.2'/></filter></defs><circle cx='16' cy='16' r='9' fill='none' stroke='%23d24a64' stroke-opacity='0.8' stroke-width='5' filter='url(%23g)'/><circle cx='16' cy='16' r='9' fill='none' stroke='%23fbe0e6' stroke-width='2'/><path d='M16 1.5 V6.5 M16 25.5 V30.5 M1.5 16 H6.5 M25.5 16 H30.5' stroke='%23fbe0e6' stroke-width='2.4' stroke-linecap='round'/><circle cx='16' cy='16' r='2' fill='%23d24a64'/></svg>\") 16 16, crosshair",
} as const;

/** I nomi che le figure di Pixi chiedono (`cursor = "pointer"`…) e la punta che ricevono. */
const STYLES: Record<string, string> = {
  default: CURSORS.arrow,
  pointer: CURSORS.point,
  grab: CURSORS.grab,
  grabbing: CURSORS.grabbing,
  aim: CURSORS.aim,
};

/** La pagina e il canvas prendono le punte rubino. */
export function installCursors(app: Application): void {
  Object.assign(app.renderer.events.cursorStyles, STYLES);
  document.documentElement.style.cursor = CURSORS.arrow;
}

/**
 * Tenendo una carta la punta è granata dappertutto: finché dura, ogni nome
 * dà «grabbing»; lasciata, tornano quelle di prima.
 */
export function holdCursor(app: Application, on: boolean): void {
  const styles = app.renderer.events.cursorStyles;
  for (const [name, style] of Object.entries(STYLES)) styles[name] = on ? CURSORS.grabbing : style;
  app.renderer.events.setCursor(on ? "grabbing" : "default");
}
