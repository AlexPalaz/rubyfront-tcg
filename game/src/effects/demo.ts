// La pagina delle prove degli effetti (effects.html, solo in sviluppo): tre
// carte vere sul fondo notte, e ogni effetto a portata di tasto — per
// vederli e per fotografarli da fuori (window.__effetti).
//
//   1 giocata · 2 tilt al passaggio · 3 foil · 4 attacco · 5 morte
//   6 braci · 7 fase · 8 fascio distruttivo · 9 fascio dinamico · 0 fascio dimensionale · F flip · N numeri

import "@fontsource-variable/space-grotesk";
import { allDecks, getCard, isRubyfront, useCatalog, type CatalogCard, type CatalogDeck } from "@rubyfront/core/cards";
import { Sprite, Texture } from "pixi.js";
import { faceTexture } from "../card/cache";
import { CARD_H, CARD_W } from "../card/theme";
import { loadImage, CARDS_BASE } from "../card/resources";
import { createStage } from "../stage";
import { tween, easeOut } from "../table/animation";
import { Card3D, Effects, FoilFilter } from "./index";

const stage = await createStage(document.body);
await document.fonts.load(`700 16px "Space Grotesk Variable"`);
const catalog = (await fetch(new URL("catalog.json", CARDS_BASE)).then(r => r.json())) as { cards: CatalogCard[]; decks?: CatalogDeck[] };
useCatalog(catalog);

// Il fondo notte del tavolo.
const background = new Sprite(Texture.from(await loadImage(new URL("home/table-night.jpg", document.baseURI).href)));
const v = stage.visible();
const s = Math.max(v.width / background.texture.width, v.height / background.texture.height);
background.scale.set(s);
background.position.set(v.x + (v.width - background.texture.width * s) / 2, v.y + (v.height - background.texture.height * s) / 2);
stage.world.addChild(background);

const effects = new Effects(stage);
stage.world.addChildAt(effects.below, 1);

const deck = allDecks()[0]!;
const rubyfront = deck.cards.find(e => isRubyfront(e.card))!.card;
const entities = deck.cards.filter(e => !isRubyfront(e.card)).map(e => e.card);
const isUnique = catalog.cards.find(c => JSON.stringify(c).includes('"unique":true'))?.id ?? entities[0]!;
const res = v.scale * stage.app.renderer.resolution;
const tex = async (id: string, face = 0): Promise<Texture> => (await faceTexture(id, face, "it", res))!;
const W = CARD_W * 0.5;
const H = CARD_H * 0.5;

async function card(id: string, x: number, y: number, face = 0): Promise<Card3D> {
  const c = new Card3D(await tex(id, face), W, H);
  c.position.set(x, y);
  stage.world.addChild(c);
  return c;
}

const left = await card(entities[0]!, 560, 540);
const center = await card(isUnique, 960, 540);
const right = await card(rubyfront, 1360, 540);
effects.toTop();

// Il foil sull'Unica, sempre: il tempo scorre, la luce segue il puntatore.
const foil = new FoilFilter(0.7);
center.mesh.filters = [foil];
let time = 0;
let tilt = true;
let mouse = { x: 960, y: 540 };
stage.app.stage.eventMode = "static";
stage.app.stage.hitArea = stage.app.screen;
stage.app.stage.on("pointermove", e => (mouse = stage.world.toLocal(e.global)));
stage.app.ticker.add(t => {
  time += t.deltaMS / 1000;
  foil.time = time;
  if (!tilt) return;
  for (const c of [left, center, right]) {
    const dx = (mouse.x - c.x) / W;
    const dy = (mouse.y - c.y) / H;
    const near = Math.abs(dx) < 0.6 && Math.abs(dy) < 0.6;
    c.rotateTo(near ? -dy * 0.5 : 0, near ? dx * 0.6 : 0);
    if (c === center) foil.light(dx, dy);
  }
});

async function played(): Promise<void> {
  const c = await card(entities[1] ?? entities[0]!, 300, 1200);
  effects.toTop();
  const from = { x: 300, y: 1200 };
  const a = { x: 960, y: 300 };
  await tween(stage.app.ticker, 620, k => {
    c.position.set(from.x + (a.x - from.x) * k, from.y + (a.y - from.y) * k - Math.sin(k * Math.PI) * 260);
    c.scale.set(1 + 0.25 * Math.sin(k * Math.PI));
    c.rotateTo(-0.5 * (1 - k), 0.8 * (1 - k), -0.2 * (1 - k));
  });
  // Lo schianto: la carta si schiaccia un attimo, poi l'impatto.
  void tween(stage.app.ticker, 180, k => c.scale.set(1.12 - 0.12 * easeOut(k)));
  await effects.hits.impact(a.x, a.y, W, H, 1.2);
  setTimeout(() => c.destroy({ children: true }), 1500);
}

async function attack(): Promise<void> {
  const target = { x: right.x, y: right.y };
  await effects.hits.dash(
    left,
    target,
    () => {
      const copy = new Sprite(left.mesh.texture);
      copy.anchor.set(0.5);
      copy.width = W;
      copy.height = H;
      return copy;
    },
    () => void effects.popNumber(target.x, target.y - H / 2, "−4", "damage", true)
  );
}

async function death(): Promise<void> {
  const c = await card(entities[2] ?? entities[0]!, 960, 820);
  c.visible = false;
  await effects.shatter({ texture: c.mesh.texture, x: c.x, y: c.y, w: W, h: H, from: { x: 960, y: 700 } });
  c.destroy({ children: true });
}

async function flip(): Promise<void> {
  const card = getCard(rubyfront);
  if (!card || card.faces.length < 2) return;
  const nexus = await tex(rubyfront, 1);
  right.setBack(nexus);
  tilt = false;
  effects.camera.flash(0xffe0a0, 0.3, 400);
  await tween(stage.app.ticker, 900, k => {
    right.rotateTo(0, Math.PI * easeOut(k), 0);
    right.scale.set(1 + 0.2 * Math.sin(k * Math.PI));
  });
  // A giro finito il Nexus resta davanti.
  right.face(nexus);
  right.rotateTo(0, 0);
  effects.spells.explode({ x: right.x, y: right.y }, [0xffe0a0, 0xffffff, 0xe56a86], 1.4);
  effects.camera.shake(0.4);
  tilt = true;
}

const actions: Record<string, () => unknown> = {
  "1": played,
  "2": () => (tilt = !tilt),
  "3": () => (foil.strength = foil.strength > 0 ? 0 : 0.7),
  "4": attack,
  "5": death,
  "6": () => effects.startEmbers({ x: v.x, y: v.y, w: v.width, h: v.height }),
  "7": () => effects.lightBlade(0xd24a64),
  "8": () => effects.spells.cast("destructive", { x: left.x, y: left.y }, { x: right.x, y: right.y }),
  "9": () => effects.spells.cast("dynamic", { x: 960, y: 120 }, { x: left.x, y: left.y }),
  "0": () => effects.spells.cast("dimensional", { x: left.x, y: left.y }, { x: right.x, y: right.y }),
  f: flip,
  n: () => {
    void effects.popNumber(560, 300, "+3", "heal");
    void effects.popNumber(960, 300, "+2", "strength");
  },
};
window.addEventListener("keydown", e => void actions[e.key.toLowerCase()]?.());
effects.startEmbers({ x: v.x, y: v.y, w: v.width, h: v.height });
(window as unknown as { __effects: unknown }).__effects = { actions, effects, ready: true, count: () => effects.particles.count() + effects.atmosphere.count() };
