// La carta del gioco, disegnata nel codice (nessun DOM, nessun CSS): il
// modello della faccia (modello.ts) dipinto dal pittore (pittore.ts) su un
// canvas alla risoluzione chiesta, e consegnato a Pixi come texture. La
// stessa carta si ridisegna a ogni misura — la tessera al tavolo, la carta
// ingrandita — sempre nitida.

import { Texture } from "pixi.js";
import { faceModel, setCardsBase, type FaceModel } from "./model";
import { paint, type PlacedLine } from "./painter";
import { CARDS_BASE, loadImage, themeResources } from "./resources";
import { CARD_H, CARD_W } from "./theme";

setCardsBase(CARDS_BASE);

export { CARD_H, CARD_W };
export type { FaceModel, PlacedLine };

export interface PaintedCard {
  face: FaceModel;
  canvas: HTMLCanvasElement;
  lines: PlacedLine[];
}

/** Dipinge una faccia su un canvas nuovo, `resolution` pixel per px della carta. */
export async function paintCard(cardId: string, faceId: string, locale: string, resolution = 2): Promise<PaintedCard | null> {
  const face = faceModel(cardId, faceId, locale);
  if (!face) return null;
  const [resources, art] = await Promise.all([themeResources(), face.art ? loadImage(face.art.src).catch(() => null) : Promise.resolve(null)]);
  // I caratteri di sistema (Iowan Old Style, il mono dei codici) vanno caricati prima di misurare.
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(CARD_W * resolution);
  canvas.height = Math.round(CARD_H * resolution);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(resolution, resolution);
  const { lines } = paint(ctx, face, resources, art);
  return { face, canvas, lines };
}

/** La texture Pixi di una faccia. */
export async function cardTexture(cardId: string, faceId: string, locale: string, resolution = 2): Promise<Texture | null> {
  const painted = await paintCard(cardId, faceId, locale, resolution);
  if (!painted) return null;
  // La misura esplicita: Pixi non la ricalcola dai pixel (in virgola mobile) e non riscrive il canvas, che lo svuoterebbe.
  return Texture.from({ resource: painted.canvas, resolution, width: CARD_W, height: CARD_H });
}
