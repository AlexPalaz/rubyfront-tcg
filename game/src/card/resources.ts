// Le immagini della carta: le texture del tema (lette da card.css, vedi
// vite-theme.ts) e le illustrazioni del catalogo (docs/cards/art, servite su
// VITE_CARDS). Si caricano una volta e restano: le carte al tavolo sono
// sempre le stesse quaranta.

import theme from "virtual:theme-t49";
import type { TintKind } from "./theme";

export type ImageElement = HTMLImageElement;

const cache = new Map<string, Promise<ImageElement>>();

export function loadImage(src: string): Promise<ImageElement> {
  let loading = cache.get(src);
  if (!loading) {
    // L'evento `load`, non `decode()`: Chrome rimanda la decodifica finché la
    // pagina è nascosta (una scheda in secondo piano), e le carte restavano
    // ad aspettare. Caricata, l'immagine si decodifica quando il pittore la disegna.
    loading = new Promise<ImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`immagine non caricata: ${src.slice(0, 80)}`));
      image.src = src;
    });
    cache.set(src, loading);
  }
  return loading;
}

/** Dove stanno i file del catalogo: /cards/ in sviluppo, ../catalog/cards/ pubblicato. */
export const CARDS_BASE = new URL((import.meta.env.VITE_CARDS as string | undefined) ?? "/cards/", document.baseURI).href;

export interface Resources {
  stone: ImageElement;
  ground: ImageElement;
  cracks: Record<TintKind, { cores: ImageElement; glow: ImageElement }>;
}

let resources: Promise<Resources> | null = null;

/** Le texture del tema, pronte. */
export function themeResources(): Promise<Resources> {
  resources ??= (async () => {
    const [stone, ground, dc, dg, yc, yg, mc, mg] = await Promise.all([
      loadImage(theme.stoneTex),
      loadImage(theme.groundTex),
      loadImage(theme.cracks.destructive.cores),
      loadImage(theme.cracks.destructive.glow),
      loadImage(theme.cracks.dynamic.cores),
      loadImage(theme.cracks.dynamic.glow),
      loadImage(theme.cracks.dimensional.cores),
      loadImage(theme.cracks.dimensional.glow),
    ]);
    return {
      stone,
      ground,
      cracks: { destructive: { cores: dc, glow: dg }, dynamic: { cores: yc, glow: yg }, dimensional: { cores: mc, glow: mg } },
    };
  })();
  return resources;
}
