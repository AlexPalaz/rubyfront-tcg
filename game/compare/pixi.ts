// Il banco di prova, lato Pixi: la carta del gioco, dipinta dal pittore e
// messa sullo stage come sprite, alla risoluzione dello schermo della prova.
// renderCard() restituisce le righe posate, da mettere accanto alla misura
// dell'originale.

import { useCatalog, type CatalogCard, type CatalogDeck } from "@rubyfront/core/cards";
import { Application, Sprite } from "pixi.js";
import { CARD_H, CARD_W, cardTexture, paintCard } from "../src/card/index.js";
import { CARDS_BASE } from "../src/card/resources.js";

const catalog = (await fetch(new URL("catalog.json", CARDS_BASE)).then(response => response.json())) as { cards: CatalogCard[]; decks?: CatalogDeck[] };
useCatalog(catalog);

const resolution = window.devicePixelRatio || 1;
const app = new Application();
await app.init({ width: CARD_W, height: CARD_H, resolution, autoDensity: true, background: "#000000", preference: "webgl", antialias: true });
document.body.append(app.canvas);

let sprite: Sprite | null = null;

async function renderCard(cardId: string, faceId: string, locale: string) {
  const texture = await cardTexture(cardId, faceId, locale, resolution);
  if (!texture) return null;
  sprite?.destroy({ texture: true, textureSource: true });
  sprite = new Sprite(texture);
  sprite.width = CARD_W;
  sprite.height = CARD_H;
  app.stage.addChild(sprite);
  app.render();
  const painted = await paintCard(cardId, faceId, locale, 1);
  return { lines: painted?.lines ?? [] };
}

(window as unknown as { renderCard: typeof renderCard }).renderCard = renderCard;
