// La galleria delle carte (fase F2): tutte le facce del catalogo, disegnate
// dal pittore (src/card/) e messe sullo stage di Pixi a tessera. Al
// passaggio del mouse la carta si ingrandisce e si ridisegna alla nuova
// misura — il senso della carta disegnata nel codice: nitida a ogni scala.
// La rotella scorre le file. È la vetrina del renderer finché non arriva il
// tavolo (F3).

import { getCard, useCatalog, type CatalogCard, type CatalogDeck } from "@rubyfront/core/cards";
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { CARD_H, CARD_W, cardTexture } from "./card/index";
import { CARDS_BASE } from "./card/resources";
import { DESIGN_W, type Stage } from "./stage.js";

const TILE_W = 240;
const TILE_H = (TILE_W * CARD_H) / CARD_W;
const GAP = 24;
const COLUMNS = 7;
const TOP = 200;
const ZOOM = 2;

export async function mountGallery(stage: Stage, locale: string): Promise<void> {
  const catalog = (await fetch(new URL("catalog.json", CARDS_BASE)).then(response => response.json())) as { cards: CatalogCard[]; decks?: CatalogDeck[] };
  useCatalog(catalog);
  const faces = catalog.cards.flatMap(card => card.faces.map(face => ({ cardId: card.id, faceId: face.id })));

  const gallery = new Container({ label: "gallery" });
  const rows = new Container({ label: "file" });
  const mask = new Graphics();
  // La carta ingrandita esce dalle file: sta in uno strato sopra, fuori dalla maschera.
  const preview = new Sprite();
  preview.label = "enlarged";
  preview.anchor.set(0.5);
  preview.eventMode = "none";
  preview.visible = false;
  let showing: Container | null = null;
  gallery.addChild(rows, mask, preview);
  rows.mask = mask;
  stage.world.addChild(gallery);

  const left = (DESIGN_W - (COLUMNS * TILE_W + (COLUMNS - 1) * GAP)) / 2;
  const rowCount = Math.ceil(faces.length / COLUMNS);
  const contentH = rowCount * TILE_H + (rowCount - 1) * GAP;
  let viewTop = TOP;
  let viewH = 0;
  let scroll = 0;
  let visibleBox = stage.visible();

  stage.onLayout(visible => {
    visibleBox = visible;
    viewTop = Math.max(TOP, visible.y + TOP);
    viewH = visible.y + visible.height - viewTop - 40;
    mask.clear().rect(visible.x, viewTop - 30, visible.width, viewH + 60).fill(0xffffff);
    scroll = Math.min(scroll, Math.max(0, contentH - viewH));
    rows.y = viewTop - scroll;
  });

  stage.app.canvas.addEventListener(
    "wheel",
    event => {
      event.preventDefault();
      scroll = Math.max(0, Math.min(scroll + event.deltaY, Math.max(0, contentH - viewH)));
      rows.y = viewTop - scroll;
    },
    { passive: false }
  );

  // La risoluzione della texture: i pixel dello schermo che la carta occupa.
  const resolutionFor = (width: number): number => (width / CARD_W) * stage.visible().scale * stage.app.renderer.resolution;

  faces.forEach(async ({ cardId, faceId }, index) => {
    const tile = new Container({ label: `${cardId}/${faceId}` });
    tile.position.set(left + (index % COLUMNS) * (TILE_W + GAP) + TILE_W / 2, Math.floor(index / COLUMNS) * (TILE_H + GAP) + TILE_H / 2);
    rows.addChild(tile);
    const small = await cardTexture(cardId, faceId, locale, resolutionFor(TILE_W));
    if (!small || !getCard(cardId)) return;
    const sprite = new Sprite(small);
    sprite.anchor.set(0.5);
    sprite.width = TILE_W;
    sprite.height = TILE_H;
    tile.addChild(sprite);

    let large: Texture | null = null;
    tile.eventMode = "static";
    tile.cursor = "pointer";
    tile.on("pointerover", async () => {
      // La copia ingrandita sta nello strato di sopra e non prende il
      // puntatore: l'uscita la decide la tessera vera, che resta al suo posto.
      const halfW = (TILE_W * ZOOM) / 2;
      const halfH = (TILE_H * ZOOM) / 2;
      const margin = 16;
      preview.texture = small;
      preview.width = TILE_W * ZOOM;
      preview.height = TILE_H * ZOOM;
      preview.x = Math.min(Math.max(tile.x, visibleBox.x + halfW + margin), visibleBox.x + visibleBox.width - halfW - margin);
      preview.y = Math.min(Math.max(rows.y + tile.y, visibleBox.y + halfH + margin), visibleBox.y + visibleBox.height - halfH - margin);
      preview.visible = true;
      showing = tile;
      large ??= await cardTexture(cardId, faceId, locale, resolutionFor(TILE_W * ZOOM));
      if (large && showing === tile) {
        preview.texture = large;
        preview.width = TILE_W * ZOOM;
        preview.height = TILE_H * ZOOM;
      }
    });
    tile.on("pointerout", () => {
      if (showing !== tile) return;
      showing = null;
      preview.visible = false;
    });
  });
}
