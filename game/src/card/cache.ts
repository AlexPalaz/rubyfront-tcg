// La cache delle facce dipinte: una texture per carta, faccia, lingua e
// risoluzione. Il tavolo ridisegna spesso (ogni azione), e una faccia già
// dipinta alla stessa misura non si ridipinge. Le risoluzioni vanno a
// gradini, così una carta che si muove o una finestra che cambia di poco
// non riempiono la cache di quasi-doppioni.

import { getCard } from "@rubyfront/core/cards";
import type { Texture } from "pixi.js";
import { cardTexture } from "./index";

/** Il gradino delle risoluzioni: pixel del dispositivo per px della carta. */
const STEP = 0.25;

const cache = new Map<string, Promise<Texture | null>>();

/** La risoluzione arrotondata al gradino di sopra: mai meno nitida del chiesto. */
export function resolutionStep(resolution: number): number {
  return Math.max(STEP, Math.ceil(resolution / STEP - 1e-6) * STEP);
}

/** La texture di una faccia, per indice (CardInstance.face): dipinta una volta, poi dalla cache. */
export function faceTexture(cardId: string, face: number, locale: string, resolution: number): Promise<Texture | null> {
  const card = getCard(cardId);
  const faceId = card?.faces[face]?.id ?? card?.faces[0]?.id;
  if (!faceId) return Promise.resolve(null);
  const res = resolutionStep(resolution);
  const key = `${cardId}|${faceId}|${locale}|${res}`;
  let texture = cache.get(key);
  if (!texture) {
    texture = cardTexture(cardId, faceId, locale, res);
    cache.set(key, texture);
  }
  return texture;
}
