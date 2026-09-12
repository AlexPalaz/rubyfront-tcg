// Il banco di prova, lato originale: la carta del sito, disegnata dal suo
// renderer (docs/cards/ui/card-render.js) come nel simulatore — compresa la
// seconda passata del fit che il simulatore aggiunge (renderer.ts, fitTexts:
// almeno 14px d'aria sotto l'ultima riga). È il metro: la carta Pixi si
// misura contro questa.

import { measure, type Measure } from "./measure.js";

interface RendererModule {
  createFace(card: unknown, face: unknown, cardCopy: unknown, themeId: string, localeId: string): HTMLElement;
  localized(resource: unknown, localeId: string): unknown;
  fitTextBoxes(root?: Element | Document): void;
}
interface CatalogModule {
  getCardById(id: string): { faces: { id: string }[] } | undefined;
}

const THEME = "t49";
const holder = document.querySelector<HTMLElement>("#holder")!;

// Caricati dal loro percorso vero, non bundlati (come in simulatore/src/renderer.ts):
// catalog.js risolve catalog.json e le illustrazioni con import.meta.url.
const RENDERER_URL = new URL("/cards/ui/card-render.js", location.href).href;
const CATALOG_URL = new URL("/cards/catalog.js", location.href).href;
const [renderer, catalog] = await Promise.all([
  import(/* @vite-ignore */ RENDERER_URL) as Promise<RendererModule>,
  import(/* @vite-ignore */ CATALOG_URL) as Promise<CatalogModule>,
]);

/** La seconda passata del simulatore (renderer.ts, fitTexts), identica. */
function simulatorFit(root: Element): void {
  renderer.fitTextBoxes(root);
  for (const box of root.querySelectorAll<HTMLElement>(".textbox")) {
    for (let guard = 0; guard < 3 && textboxSlack(box) < 14; guard += 1) {
      const current = parseFloat(box.style.fontSize) || 1;
      if (current <= 0.6) break;
      box.style.fontSize = `${Math.round((current - 0.04) * 100) / 100}em`;
    }
  }
}

function textboxSlack(box: HTMLElement): number {
  const rect = box.getBoundingClientRect();
  if (rect.height === 0) return Number.POSITIVE_INFINITY;
  let contentBottom = Number.NEGATIVE_INFINITY;
  for (const child of box.children) {
    const style = getComputedStyle(child);
    if (style.display === "none" || style.position === "absolute") continue;
    contentBottom = Math.max(contentBottom, child.getBoundingClientRect().bottom);
  }
  if (contentBottom === Number.NEGATIVE_INFINITY) return Number.POSITIVE_INFINITY;
  return (rect.bottom - contentBottom) * (box.offsetHeight / rect.height);
}

async function renderCard(cardId: string, faceId: string, locale: string): Promise<Measure | null> {
  holder.replaceChildren();
  const card = catalog.getCardById(cardId);
  const face = card?.faces.find(entry => entry.id === faceId);
  if (!card || !face) return null;
  holder.append(renderer.createFace(card, face, renderer.localized(card, locale), THEME, locale));
  await document.fonts.ready;
  await Promise.all([...holder.querySelectorAll("img")].map(image => image.decode().catch(() => undefined)));
  simulatorFit(holder);
  // Un fotogramma perché lo stile del fit sia applicato prima della foto.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return measure(holder.querySelector(".card")!);
}

(window as unknown as { renderCard: typeof renderCard }).renderCard = renderCard;
