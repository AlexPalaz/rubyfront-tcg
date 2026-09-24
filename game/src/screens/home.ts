// La home del gioco (tema scuro «Notte»): il paesaggio di fondo sotto un
// velo scuro, l'insegna del
// saluto (la gemma che respira, il nome, le partite contro il bot) e le
// cinque carte d'ingresso in fila — lastre nere con l'illustrazione a tutta
// carta, un poco ingrandita, e i testi chiari sopra, dal basso, sul velo che
// scurisce il fondo: Contro il computer, Multigiocatore, Evento e Torneo (in
// grigio, in arrivo), Mazzi. Al passaggio una carta si allarga (flex-grow
// 2.2, .55s), l'illustrazione torna a misura (.8s) e il contenuto si scopre;
// le altre si spengono un poco. Al tocco si apre, per chi non ha un mouse.
// La musica della home parte con lei.

import { getCard } from "@rubyfront/core/cards";
import { t } from "@rubyfront/core/i18n";
import { BlurFilter, Container, Graphics, Rectangle, Sprite, Texture, type ColorMatrixFilter, type NineSliceSprite } from "pixi.js";
import { faceModel } from "../card/model";
import { loadImage } from "../card/resources";
import { textWidth, type Font } from "../card/text";
import type { Stage } from "../stage";
import { HOME_MUSIC, playSound, startMusic, unlockSound } from "../sound";
import { CrispSprite, SANS, paintPiece, linearGradient } from "../table/appearance";
import { bezier, reducedMotion } from "../table/animation";
import { cssFilter } from "./filters";
import { TextField, FONT_BASE, PAPER, Button, fitTitle, areaBelow, slabShadow, paintText } from "./ui";
import { BITE, CardFrame, type Magma } from "./home-fx";

/** .home: padding 22px 40px 30px, gap 18px; .home-deck: al più 1560×960, carte a 16px. */
const PAD_TOP = 22;
const PAD_X = 40;
const PAD_BOTTOM = 30;
const GAP = 18;
const ROW_MAX_W = 1560;
const ROW_MAX_H = 960;
const CARD_GAP = 16;
const GROW_OPEN = 2.2;
const GROW_OFF = 0.72;
/** .home-text: in fondo alla carta, padding 22 20 24, gap 8; dentro il contenuto che si scopre, gap 12. */
/** I testi stanno dentro la sagoma spezzata: più in là del morso più profondo (home-fx.ts). */
const TEXT_PAD_X = BITE + 10;
const TEXT_PAD_BOTTOM = BITE + 12;
const TEXT_GAP = 8;
const MORE_GAP = 12;
const GROW_MS = 550;
const MORE_MS = 500;
const DIM_MS = 500;
/** .home-art: scale(1.04) a carta chiusa, a misura aperta (.8s). */
const ZOOM = 1.04;
const ZOOM_MS = 800;
/** La lastra viva (2026-09-24): la pressione che schiaccia, il sollevamento della carta aperta, l'entrata a scalare, il parallasse dell'illustrazione. */
const PRESS_MS = 90;
const RELEASE_MS = 240;
const LIFT = 6;
const ENTER_MS = 640;
const ENTER_STAGGER_MS = 70;
const ENTER_RISE = 44;
const PARALLAX_X = 14;
const PARALLAX_Y = 9;
const DRIFT = 5;
/** Il testo chiaro sopra le illustrazioni, con le sue ombre (text-shadow). */
const TAG_SHADOW = [{ x: 0, y: 1, blur: 6, color: "rgba(0,0,0,.8)" }];
const TITLE_SHADOW = [{ x: 0, y: 2, blur: 10, color: "rgba(0,0,0,.8)" }];
const SHADOW_M = 70;
const curve = bezier(0.2, 0.8, 0.2, 1);

const TAG: Font = { size: 16, weight: 600, family: SANS, spacing: 16 * 0.22, upper: true };
const TITLE: Font = { size: 24, weight: 700, family: SANS, spacing: 24 * 0.06, upper: true };
const HELLO: Font = { size: 30, weight: 700, family: SANS, spacing: 30 * 0.16, upper: true };

type HomeCardId = "solo" | "multi" | "event" | "tourney" | "decks";

interface Def {
  id: HomeCardId;
  tag: string;
  title: string;
  lead?: string;
  off?: boolean;
  /** Lo sfondo in public/home/ (coppia 1x/2x) o, finché l'originale manca, l'illustrazione di una carta. */
  bg?: string;
  art?: string;
  /** Dove cade il ritaglio (background-position). */
  pos?: [number, number];
  /** Il colore del magma sotto la lastra (home-fx.ts). */
  magma?: Magma;
}

const DEFS: Def[] = [
  { id: "solo", tag: "html.home.solo.tag", title: "html.home.solo.title", lead: "html.home.solo.text", bg: "home/oblivhal", magma: "ruby" },
  { id: "multi", tag: "html.home.multi.tag", title: "html.home.multi.title", lead: "html.home.multi.text", bg: "home/duel", pos: [0.55, 0.5], magma: "white" },
  { id: "event", tag: "html.home.soon", title: "html.home.event.title", off: true, bg: "home/rhen", pos: [0.38, 0.5] },
  { id: "tourney", tag: "html.home.soon", title: "html.home.tourney.title", off: true, art: "RBF-023" },
  { id: "decks", tag: "html.home.decks.tag", title: "html.home.decks.title", lead: "html.home.decks.text", bg: "home/decks", magma: "blue" },
];

interface Anim {
  from: number;
  a: number;
  t0: number;
  ms: number;
  v: number;
}

const anim = (v: number): Anim => ({ from: v, a: v, t0: 0, ms: 1, v });

function start(a: Anim, target: number, ms: number, now: number): void {
  if (a.a === target) return;
  a.from = a.v;
  a.a = target;
  a.t0 = now;
  a.ms = reducedMotion() ? 1 : ms;
}

interface PaintedText {
  sprite: Sprite;
  w: number;
  h: number;
}

interface HomeCard {
  def: Def;
  root: Container;
  /** Il corpo, che si schiaccia alla pressione e si solleva aperto; dentro, `inner` è il ritaglio nella sagoma. */
  body: Container;
  inner: Container;
  frame: CardFrame;
  shadow: NineSliceSprite;
  openShadow: NineSliceSprite;
  slab: Graphics;
  art: Sprite;
  artMask: Graphics;
  veil: Sprite;
  dimmed: ColorMatrixFilter;
  text: Container;
  textMask: Graphics;
  tag: PaintedText | null;
  title: PaintedText | null;
  /** La larghezza per cui sono scritti tag e titolo. */
  textWidthUsed: number;
  more: Container;
  moreMask: Graphics;
  moreH: number;
  moreTop: number;
  grow: Anim;
  k: Anim;
  dim: Anim;
  zoom: Anim;
  press: Anim;
  enter: Anim;
  /** Il parallasse: dove sta il puntatore sulla carta (−0.5..0.5) e dove l'illustrazione è arrivata. */
  pointer: { x: number; y: number };
  parallax: { x: number; y: number };
  /** Dove l'illustrazione starebbe ferma: da qui si sposta di parallasse e deriva. */
  artBase: { x: number; y: number };
  phase: number;
  x: number;
  w: number;
}

let cardVeil: Texture | null = null;
/** Il velo della carta (.home-art::after): scuro in cima, quasi niente a un terzo, fitto in fondo dove stanno i testi. */
function veilTexture(): Texture {
  cardVeil ??= paintPiece(4, 256, 1, ctx => {
    ctx.fillStyle = linearGradient(ctx, 180, 0, 0, 4, 256, [
      [0, "rgba(6,4,8,.28)"],
      [0.3, "rgba(6,4,8,.06)"],
      [0.55, "rgba(6,4,8,.3)"],
      [1, "rgba(6,4,8,.94)"],
    ]);
    ctx.fillRect(0, 0, 4, 256);
  });
  return cardVeil;
}

export interface HomeActions {
  /** La carta «Contro il computer»: sempre una partita nuova (niente «Riprendi», dal 2026-09-20). */
  solo(): void;
  newGame(): void;
  /** «Partita casuale» (2026-09-23): in fila nell'atrio del tavolo. */
  random(): void;
  createRoom(): void;
  enter(room: string): void;
  decks(): void;
}

export class Home {
  readonly root = new Container({ label: "home" });
  private readonly background = new CrispSprite();
  private readonly landscape = new CrispSprite();
  private readonly veil = new CrispSprite();
  private readonly greeting = new Container({ label: "greeting" });
  private readonly gemGlow = new CrispSprite();
  /** Il magma sotto le carte (home-fx.ts): stessa quota della fila, sotto di lei. */
  private readonly ground = new Container({ label: "ground" });
  private readonly row = new Container({ label: "cards" });
  private readonly cards: HomeCard[] = [];
  private readonly field: TextField;
  private readonly blurFilter = new BlurFilter({ strength: 10, quality: 3 });
  private blurred = false;
  private greetingText = "";
  private overlay: HomeCardId | null = null;
  private tappedCard: HomeCardId | null = null;
  private roomFocused = false;
  private focusLater = false;
  private geometry = { x: 0, y: 0, w: 0, h: 0 };
  private fieldBox = { x: 0, y: 0, w: 0, h: 44 };
  private backgroundTextures: Texture[] = [];
  private density = "";
  private readonly tick = (): void => this.step();

  constructor(
    private readonly stage: Stage,
    private readonly locale: string,
    private readonly actions: HomeActions
  ) {
    this.root.visible = false;
    // .home-row input nel Notte: la piastra (la regola del tema pesa più della classe), il filo chiaro, segnaposto velato, rosa in fuoco.
    this.field = new TextField(stage, {
      placeholder: t("html.room.ph"),
      edge: "rgba(255,255,255,.28)",
      color: PAPER,
      placeholderColor: "rgba(243,237,240,.55)",
      fire: "#e56a86",
      onEnter: () => this.actions.enter(this.field.value.trim()),
    });
    this.field.el.addEventListener("focus", () => {
      this.roomFocused = true;
      this.retarget();
    });
    this.field.el.addEventListener("blur", () => {
      this.roomFocused = false;
      this.retarget();
    });
    // La home prende i click: il tavolo sotto aspetta.
    this.background.eventMode = "static";
    this.landscape.eventMode = "none";
    this.veil.eventMode = "none";
    this.ground.eventMode = "none";
    this.root.addChild(this.background, this.landscape, this.veil, this.greeting, this.ground, this.row);
    // La densità delle immagini si sceglie una volta: 2x sugli schermi fitti.
    this.density = stage.visible().scale * stage.app.renderer.resolution > 1.1 ? "@2x" : "";
    for (const def of DEFS) this.cards.push(this.createCard(def));
    void loadImage(new URL(`home/background${this.density}.jpg`, document.baseURI).href)
      .then(image => {
        this.landscape.texture = Texture.from(image);
        if (this.root.visible) this.layout();
      })
      .catch(() => undefined);
    stage.screens.addChild(this.root);
    stage.onLayout(() => this.root.visible && this.layout());
  }

  isVisible(): boolean {
    return this.root.visible;
  }

  show(): void {
    if (!this.root.visible) {
      this.root.visible = true;
      this.stage.app.ticker.add(this.tick);
      // L'entrata: le carte salgono una dopo l'altra, schiarendo.
      const now = performance.now();
      this.cards.forEach((c, index) => {
        c.enter.v = c.enter.from = 0;
        c.enter.a = 1;
        c.enter.t0 = now + index * ENTER_STAGGER_MS;
        c.enter.ms = reducedMotion() ? 1 : ENTER_MS;
      });
    }
    this.layout();
    startMusic(HOME_MUSIC);
    // I campioni dei tasti si caricano subito: anche il primo click in home scatta.
    unlockSound();
  }

  hide(): void {
    this.root.visible = false;
    this.stage.app.ticker.remove(this.tick);
    this.overlay = null;
    this.tappedCard = null;
    this.field.show(false);
    this.retarget(true);
  }

  /** Sotto il velo dell'accoglienza la home si sfoca (backdrop-filter: blur(6px)) e il campo della stanza sparisce. */
  setBlurred(on: boolean): void {
    this.blurred = on;
    this.blurFilter.strength = 6 * 1.6 * this.stage.visible().scale * this.stage.app.renderer.resolution;
    this.root.filters = on ? [this.blurFilter] : [];
    if (on) {
      this.overlay = null;
      this.retarget();
    }
    this.placeField();
  }

  /** L'insegna del saluto: il nome salvato e le partite contro il bot. */
  greet(text: string): void {
    this.greetingText = text;
    if (this.root.visible) this.layout();
  }

  closeCards(): void {
    this.overlay = null;
    this.tappedCard = null;
    this.retarget();
  }

  room(value: string): void {
    this.field.value = value;
  }

  /** «Entra» senza nome: il cursore torna nel campo. */
  focusRoom(): void {
    this.field.focus();
  }

  private createCard(def: Def): HomeCard {
    const off = def.off === true;
    const root = new Container({ label: `home-card:${def.id}` });
    // Le carte in grigio non hanno ombra; le altre la loro (0 18 50), e aperte quella più lunga col filo e l'alone di rubino.
    const shadow = slabShadow([{ x: 0, y: 18, blur: 50, color: "rgba(0,0,0,.45)" }], SHADOW_M);
    shadow.visible = !off;
    const openShadow = slabShadow(
      [
        { x: 0, y: 22, blur: 60, color: "rgba(0,0,0,.55)" },
        { x: 0, y: 0, blur: 34, color: "rgba(210,74,100,.28)" },
        { x: 0, y: 0, blur: 0, color: "rgba(229,106,134,.25)", spread: 2 },
      ],
      SHADOW_M
    );
    openShadow.alpha = 0;
    const slab = new Graphics();
    const art = new CrispSprite();
    // La sagoma spezzata (home-fx.ts): la maschera del ritaglio è la sua.
    const frame = new CardFrame(this.stage, off, t("html.home.soon"), def.magma);
    const artMask = frame.mask;
    const inner = new Container({ label: "inner" });
    inner.mask = artMask;
    // Le carte in grigio sono spente (grayscale, brightness .42); le altre si abbassano un poco quando se ne apre una.
    const dimmed = off ? cssFilter([["grayscale", 1], ["brightness", 0.42]]) : cssFilter([["brightness", 0.62], ["saturate", 0.85]]);
    dimmed.alpha = off ? 1 : 0;
    art.filters = [dimmed];
    const veil = new CrispSprite(veilTexture());
    veil.eventMode = "none";
    const text = new Container();
    const textMask = new Graphics();
    text.mask = textMask;
    const more = new Container();
    const moreMask = new Graphics();
    more.mask = moreMask;
    more.eventMode = "none";
    inner.addChild(art, veil, frame.inside);
    const body = new Container({ label: "body" });
    // Niente ombre rettangolari dietro la lastra spezzata (2026-09-24): l'alone lo fa il magma lungo la sagoma (home-fx.ts).
    shadow.visible = false;
    openShadow.visible = false;
    body.addChild(slab, inner, artMask, frame.frame, text, textMask, more, moreMask);
    root.addChild(body);
    this.ground.addChild(frame.ground);
    root.eventMode = "static";
    root.cursor = off ? "default" : "pointer";
    const card: HomeCard = {
      def,
      root,
      body,
      inner,
      frame,
      shadow,
      openShadow,
      slab,
      art,
      artMask,
      veil,
      dimmed,
      text,
      textMask,
      tag: null,
      title: null,
      textWidthUsed: -1,
      more,
      moreMask,
      moreH: 0,
      moreTop: 0,
      grow: anim(off ? GROW_OFF : 1),
      k: anim(0),
      dim: anim(0),
      zoom: anim(ZOOM),
      press: anim(0),
      enter: anim(1),
      pointer: { x: 0, y: 0 },
      parallax: { x: 0, y: 0 },
      artBase: { x: 0, y: 0 },
      phase: Math.random() * Math.PI * 2,
      x: 0,
      w: 0,
    };
    root.on("pointerenter", () => {
      if (off || this.blurred) return;
      this.overlay = def.id;
      card.frame.shine();
      this.retarget();
    });
    root.on("pointerleave", () => {
      card.pointer.x = 0;
      card.pointer.y = 0;
      start(card.press, 0, RELEASE_MS, performance.now());
      if (this.overlay !== def.id) return;
      this.overlay = null;
      this.retarget();
    });
    // Il parallasse: l'illustrazione segue il puntatore, piano.
    root.on("pointermove", event => {
      if (off || this.blurred) return;
      const local = root.toLocal(event.global);
      const h = this.geometry.h || 1;
      card.pointer.x = Math.max(-0.5, Math.min(0.5, local.x / Math.max(1, card.w) - 0.5));
      card.pointer.y = Math.max(-0.5, Math.min(0.5, local.y / h - 0.5));
    });
    root.on("pointerdown", () => !off && start(card.press, 1, PRESS_MS, performance.now()));
    root.on("pointerup", () => start(card.press, 0, RELEASE_MS, performance.now()));
    root.on("pointerupoutside", () => start(card.press, 0, RELEASE_MS, performance.now()));
    root.on("pointertap", () => this.tap(def));
    this.row.addChild(root);
    const src = def.bg ? new URL(`${def.bg}${this.density}.jpg`, document.baseURI).href : def.art ? this.cardArt(def.art) : null;
    if (src) {
      void loadImage(src)
        .then(image => {
          art.texture = Texture.from(image);
          if (this.root.visible) this.placeCards();
        })
        .catch(() => undefined);
    }
    return card;
  }

  /** L'illustrazione di una carta del catalogo (la carta Torneo, finché il suo quadro manca). */
  private cardArt(cardId: string): string | null {
    const faceId = getCard(cardId)?.faces[0]?.id;
    return faceId ? (faceModel(cardId, faceId, this.locale)?.art?.src ?? null) : null;
  }

  private tap(def: Def): void {
    if (def.off) return;
    if (def.id === "solo") return this.actions.solo();
    if (def.id === "decks") return this.actions.decks();
    // Multigiocatore si apre e si chiude al tocco (per chi non ha un mouse), col suo scatto.
    playSound("button");
    this.tappedCard = this.tappedCard === def.id ? null : def.id;
    this.focusLater = this.tappedCard === "multi";
    this.retarget();
  }

  /** La carta aperta: quella sotto il mouse, o quella col campo in fuoco, o quella toccata. */
  private isOpen(): HomeCardId | null {
    return this.overlay ?? (this.roomFocused ? "multi" : null) ?? this.tappedCard;
  }

  private retarget(immediate = false): void {
    const open = this.isOpen();
    const now = performance.now();
    for (const c of this.cards) {
      const off = c.def.off === true;
      start(c.grow, off ? GROW_OFF : c.def.id === open ? GROW_OPEN : 1, GROW_MS, now);
      start(c.k, c.def.id === open ? 1 : 0, MORE_MS, now);
      start(c.dim, !off && open !== null && c.def.id !== open ? 1 : 0, DIM_MS, now);
      start(c.zoom, !off && c.def.id === open ? 1 : ZOOM, ZOOM_MS, now);
      if (immediate) for (const a of [c.grow, c.k, c.dim, c.zoom, c.press]) a.v = a.from = a.a;
    }
  }

  private step(): void {
    const now = performance.now();
    let moving = false;
    for (const c of this.cards) {
      for (const a of [c.grow, c.k, c.dim, c.zoom, c.press, c.enter]) {
        const p = Math.max(0, Math.min(1, (now - a.t0) / a.ms));
        const v = p >= 1 ? a.a : a.from + (a.a - a.from) * curve(p);
        if (v !== a.v) {
          a.v = v;
          moving = true;
        }
      }
    }
    if (moving) this.placeCards();
    // Per frame, senza rifare la geometria: il parallasse e la deriva dell'illustrazione, il magma e le crepe della lastra.
    const still = reducedMotion();
    for (const c of this.cards) {
      const k = c.k.v;
      c.frame.tick(now, k);
      if (c.def.off) continue;
      const ease = 1 - Math.pow(0.001, 16 / 1000);
      c.parallax.x += (c.pointer.x * k - c.parallax.x) * ease * 0.35;
      c.parallax.y += (c.pointer.y * k - c.parallax.y) * ease * 0.35;
      const driftX = still ? 0 : Math.sin(now / 6200 + c.phase) * DRIFT;
      const driftY = still ? 0 : Math.cos(now / 7600 + c.phase) * DRIFT * 0.6;
      c.art.position.set(c.artBase.x - c.parallax.x * PARALLAX_X + driftX, c.artBase.y - c.parallax.y * PARALLAX_Y + driftY);
    }
    // La gemma del saluto respira (home-gem-breathe, 3.2s).
    this.gemGlow.alpha = reducedMotion() ? 0.75 : 0.5 + 0.5 * (0.5 - 0.5 * Math.cos((now / 3200) * Math.PI * 2));
  }

  private layout(): void {
    const v = this.stage.visible();
    const area = areaBelow(v);
    this.paintBackground(area);
    const helloH = this.layoutGreeting(area);
    const rowW = Math.min(area.w - 2 * PAD_X, ROW_MAX_W);
    const free = area.h - PAD_TOP - PAD_BOTTOM - (helloH ? helloH + GAP : 0);
    const rowH = Math.max(200, Math.min(free, ROW_MAX_H));
    // .home è una colonna centrata: lo spazio che avanza si divide sopra e sotto.
    const top = area.y + PAD_TOP + Math.max(0, free - rowH) / 2;
    this.greeting.position.set(area.x + area.w / 2, top);
    this.geometry = { x: area.x + (area.w - rowW) / 2, y: top + (helloH ? helloH + GAP : 0), w: rowW, h: rowH };
    // Il contenuto che si scopre si scrive per la carta aperta: la sua larghezza piena.
    const sumOpen = this.cards.reduce((sum, c) => sum + (c.def.off ? GROW_OFF : 1), 0) - 1 + GROW_OPEN;
    const wOpen = ((rowW - CARD_GAP * (this.cards.length - 1)) * GROW_OPEN) / sumOpen;
    for (const c of this.cards) {
      this.buildMore(c, wOpen - 2 * TEXT_PAD_X);
      c.textWidthUsed = -1;
    }
    this.placeCards();
  }

  /** Il fondo della home: il colore del tema coi due aloni, il paesaggio a coprire, il velo scuro sopra. */
  private paintBackground(area: { x: number; y: number; w: number; h: number }): void {
    for (const texture of this.backgroundTextures) texture.destroy(true);
    const res = 0.5;
    const radial = (ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, rgb: string, alpha: number): void => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(rx, ry);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      gradient.addColorStop(0, `rgba(${rgb},${alpha})`);
      gradient.addColorStop(0.7, `rgba(${rgb},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(-cx / rx, -cy / ry, area.w / rx, area.h / ry);
      ctx.restore();
    };
    const background = paintPiece(area.w, area.h, res, ctx => {
      ctx.fillStyle = "#0b090d";
      ctx.fillRect(0, 0, area.w, area.h);
      radial(ctx, area.w * 0.1, 0, area.w * 0.6, area.h * 0.5, "210,74,100", 0.16);
      radial(ctx, area.w, area.h, area.w * 0.5, area.h * 0.6, "86,68,128", 0.22);
    });
    const veil = paintPiece(area.w, area.h, res, ctx => {
      ctx.fillStyle = linearGradient(ctx, 180, 0, 0, area.w, area.h, [
        [0, "rgba(19,16,19,.3)"],
        [0.6, "rgba(19,16,19,.25)"],
        [1, "rgba(19,16,19,.6)"],
      ]);
      ctx.fillRect(0, 0, area.w, area.h);
    });
    this.backgroundTextures = [background, veil];
    this.background.texture = background;
    this.veil.texture = veil;
    this.background.position.set(area.x, area.y);
    this.veil.position.set(area.x, area.y);
    const image = this.landscape.texture;
    if (image !== Texture.EMPTY && image.width > 0) {
      const s = Math.max(area.w / image.width, area.h / image.height);
      this.landscape.scale.set(s);
      this.landscape.position.set(area.x + (area.w - image.width * s) / 2, area.y + (area.h - image.height * s) / 2);
    }
  }

  /** L'insegna: la gemma in cima, sotto la frase fra due fili di luce. Torna la sua altezza (0 senza saluto). */
  private layoutGreeting(area: { w: number }): number {
    for (const child of this.greeting.removeChildren()) if (child !== this.gemGlow) child.destroy({ children: true });
    if (!this.greetingText) return 0;
    const res = this.stage.visible().scale * this.stage.app.renderer.resolution;
    const gem = 18;
    const text = paintText(this.stage, this.greetingText, HELLO, "#ffffff", {
      shadows: [
        { x: 0, y: 2, blur: 6, color: "rgba(0,0,0,.75)" },
        { x: 0, y: 0, blur: 22, color: "rgba(0,0,0,.6)" },
      ],
    });
    const lineW = Math.max(48, Math.min(140, area.w * 0.07));
    const textY = gem + 12;
    text.sprite.position.set(-text.w / 2, textY);
    // La gemma: quadrato ruotato, gradiente rubino, filo rosa; la sua luce respira a parte.
    const m = 40;
    const gemSprite = new CrispSprite(
      paintPiece(gem * 2 + 2 * m, gem * 2 + 2 * m, res, ctx => {
        ctx.translate(gem + m, gem + m);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = linearGradient(ctx, 135, -gem / 2, -gem / 2, gem, gem, [
          [0, "#e0314b"],
          [1, "#9e0f34"],
        ]);
        ctx.fillRect(-gem / 2, -gem / 2, gem, gem);
        ctx.strokeStyle = "#ffb7c6";
        ctx.lineWidth = 1;
        ctx.strokeRect(-gem / 2 + 0.5, -gem / 2 + 0.5, gem - 1, gem - 1);
      })
    );
    gemSprite.anchor.set(0.5);
    gemSprite.position.set(0, gem / 2);
    // La texture vuota di partenza è di tutti (Texture.EMPTY): si distrugge solo quella dipinta qui.
    if (this.gemGlow.texture !== Texture.EMPTY) this.gemGlow.texture.destroy(true);
    this.gemGlow.texture = paintPiece(gem * 2 + 2 * m, gem * 2 + 2 * m, res, ctx => {
      ctx.translate(gem + m, gem + m);
      ctx.rotate(Math.PI / 4);
      for (const [blur, alpha] of [
        [22, 1],
        [56, 0.6],
      ] as const) {
        ctx.shadowColor = `rgba(224,49,75,${alpha})`;
        ctx.shadowBlur = blur * res;
        ctx.fillStyle = "#e0314b";
        ctx.fillRect(-gem / 2, -gem / 2, gem, gem);
      }
    });
    this.gemGlow.anchor.set(0.5);
    this.gemGlow.position.set(0, gem / 2);
    const edge = (direction: 1 | -1): Sprite => {
      const sprite = new CrispSprite(
        paintPiece(lineW + 20, 21, res, ctx => {
          ctx.shadowColor = "rgba(255,255,255,.6)";
          ctx.shadowBlur = 8 * res;
          ctx.fillStyle = linearGradient(ctx, direction === 1 ? 90 : 270, 10, 10, lineW, 1, [
            [0, "rgba(255,255,255,0)"],
            [1, "rgba(255,255,255,.9)"],
          ]);
          ctx.fillRect(10, 10, lineW, 1);
        })
      );
      sprite.position.set(direction === 1 ? -text.w / 2 - 18 - lineW - 10 : text.w / 2 + 18 - 10, textY + text.h / 2 - 10);
      return sprite;
    };
    this.greeting.addChild(this.gemGlow, gemSprite, edge(1), edge(-1), text.sprite);
    return textY + text.h;
  }

  private writeTexts(c: HomeCard, w: number): void {
    c.tag?.sprite.destroy();
    c.title?.sprite.destroy();
    const maxW = Math.max(40, w - 2 * TEXT_PAD_X);
    const off = c.def.off === true;
    // In grigio la targhetta in basso non c'è più: «In arrivo» sta sul nastro all'angolo (home-fx.ts).
    c.tag = off ? null : paintText(this.stage, t(c.def.tag), TAG, "#e56a86", { maxW, shadows: TAG_SHADOW });
    const title = fitTitle(t(c.def.title), TITLE, maxW);
    // Il titolo sta su UNA riga, sempre (2026-09-20: a carta stretta, aprendo o
    // chiudendo, «Contro il computer» andava a capo): se non ci entra, il
    // corpo scende quanto basta — spaziatura in proporzione — e non si spezza.
    const fit = Math.min(1, maxW / Math.max(1, textWidth(TITLE, title)));
    const font: Font = fit < 1 ? { ...TITLE, size: TITLE.size * fit, spacing: (TITLE.spacing ?? 0) * fit } : TITLE;
    const oneLine = { maxW: Number.MAX_SAFE_INTEGER, lineHeight: font.size * 1.1 };
    c.title = off
      ? paintText(this.stage, title, font, "rgba(243,237,240,.55)", oneLine)
      : paintText(this.stage, title, font, PAPER, { ...oneLine, shadows: TITLE_SHADOW });
    if (c.tag) c.text.addChild(c.tag.sprite);
    c.text.addChild(c.title.sprite);
    c.textWidthUsed = w;
  }

  /** Il contenuto che la carta scopre aprendosi: la frase e i suoi gesti. */
  private buildMore(c: HomeCard, w: number): void {
    for (const child of c.more.removeChildren()) child.destroy({ children: true });
    c.moreH = 0;
    if (!c.def.lead) return;
    let y = 4;
    const lead = paintText(this.stage, t(c.def.lead), FONT_BASE, "rgba(243,237,240,.88)", { maxW: w, lineHeight: 24, shadows: TAG_SHADOW });
    lead.sprite.position.set(0, y);
    c.more.addChild(lead.sprite);
    y += lead.h + 2 + MORE_GAP;
    const button = (label: string, style: "metal" | "secondary", onTap: () => void): void => {
      const button = new Button(this.stage, { label, style, w, onTap });
      button.position.set(0, y);
      c.more.addChild(button);
      y += button.h + MORE_GAP;
    };
    if (c.def.id === "solo") {
      button(t("html.newgame"), "metal", () => this.actions.newGame());
    } else if (c.def.id === "multi") {
      button(t("html.ob.random"), "metal", () => this.actions.random());
      button(t("html.ob.create"), "secondary", () => this.actions.createRoom());
      const or = paintText(this.stage, t("html.ob.or"), FONT_BASE, "rgba(243,237,240,.7)", { maxW: w, align: "center" });
      or.sprite.position.set((w - or.w) / 2, y);
      c.more.addChild(or.sprite);
      y += or.h + MORE_GAP;
      const enter = new Button(this.stage, { label: t("html.join"), style: "plate", edge: "rgba(255,255,255,.28)", color: PAPER, font: FONT_BASE, h: 44, onTap: () => this.actions.enter(this.field.value.trim()) });
      enter.position.set(w - enter.w, y);
      c.more.addChild(enter);
      this.fieldBox = { x: 0, y, w: w - enter.w - 8, h: 44 };
      y += 44 + MORE_GAP;
    } else if (c.def.id === "decks") {
      button(t("html.home.decks.go"), "metal", () => this.actions.decks());
    }
    c.moreH = y - MORE_GAP;
  }

  private placeCards(): void {
    const { x, y, w, h } = this.geometry;
    const sum = this.cards.reduce((total, c) => total + c.grow.v, 0);
    const avail = w - CARD_GAP * (this.cards.length - 1);
    this.row.position.set(0, y);
    this.ground.position.set(0, y);
    let cx = x;
    for (const c of this.cards) {
      const cw = (avail * c.grow.v) / sum;
      this.placeCard(c, cx, cw, h);
      cx += cw + CARD_GAP;
    }
    this.placeField();
  }

  private placeCard(c: HomeCard, x: number, w: number, h: number): void {
    c.x = x;
    c.w = w;
    c.root.position.set(x, 0);
    c.frame.ground.position.set(x, 0);
    c.root.hitArea = new Rectangle(0, 0, w, h);
    const off = c.def.off === true;
    const k = c.k.v;
    const o = off ? 0 : Math.max(0, Math.min(1, (c.grow.v - 1) / (GROW_OPEN - 1)));
    // Il corpo: si schiaccia appena alla pressione, si solleva aperto, entra salendo e schiarendo.
    const enter = c.enter.v;
    c.body.pivot.set(w / 2, h / 2);
    c.body.position.set(w / 2, h / 2 - LIFT * o + ENTER_RISE * (1 - enter));
    c.body.scale.set(1 - 0.018 * c.press.v);
    c.body.alpha = enter;
    c.frame.ground.alpha = enter;
    // La sagoma spezzata: maschera, bordo, magma e crepe (home-fx.ts); la lastra nera dentro la sagoma.
    c.frame.place(w, h, o, k);
    c.frame.fillSlab(c.slab);
    // L'illustrazione a tutta carta, a coprire col suo ritaglio, ingrandita attorno al centro.
    const aw = w;
    const ah = h;
    const texture = c.art.texture;
    if (texture !== Texture.EMPTY && texture.width > 0) {
      const s = Math.max(aw / texture.width, ah / texture.height);
      const [px, py] = c.def.pos ?? [0.5, 0.5];
      const bx = (aw - texture.width * s) * px;
      const by = (ah - texture.height * s) * py;
      const z = c.zoom.v;
      const cx = aw / 2;
      const cy = ah / 2;
      c.art.scale.set(s * z);
      c.artBase = { x: cx + (bx - cx) * z, y: cy + (by - cy) * z };
      c.art.position.set(c.artBase.x - c.parallax.x * PARALLAX_X, c.artBase.y - c.parallax.y * PARALLAX_Y);
    }
    c.veil.position.set(0, 0);
    c.veil.width = aw;
    c.veil.height = ah;
    if (!off) c.dimmed.alpha = c.dim.v;
    // Tag e titolo si riscrivono alla nuova larghezza quando la carta ha finito di muoversi.
    const stop = c.grow.v === c.grow.a;
    if (c.textWidthUsed < 0 || (stop && Math.abs(c.textWidthUsed - w) > 0.5)) this.writeTexts(c, w);
    const tagH = c.tag?.h ?? 0;
    const titleHeight = c.title?.h ?? 0;
    // I testi, appoggiati in fondo: il contenuto che si scopre, sopra il titolo, sopra il tag.
    const bottom = h - TEXT_PAD_BOTTOM;
    c.moreTop = bottom - c.moreH * k;
    c.more.position.set(TEXT_PAD_X, c.moreTop);
    c.more.alpha = k;
    c.more.eventMode = k > 0.5 ? "passive" : "none";
    c.moreMask.clear().rect(0, c.moreTop, w, c.moreH * k + TEXT_PAD_BOTTOM).fill(0xffffff);
    const titleTop = c.moreTop - TEXT_GAP - titleHeight;
    c.title?.sprite.position.set(TEXT_PAD_X, titleTop);
    c.tag?.sprite.position.set(TEXT_PAD_X, titleTop - TEXT_GAP - tagH);
    // Il filo di rubino sotto il titolo si disegna con l'apertura.
    c.frame.underlineAt(TEXT_PAD_X, titleTop + titleHeight + 3, k);
    c.textMask.clear().rect(0, 0, w, h).fill(0xffffff);
  }

  /** Il campo della stanza segue la sua carta, e c'è solo a carta aperta e home senza velo. */
  private placeField(): void {
    const multi = this.cards.find(c => c.def.id === "multi");
    if (!multi) return;
    const show = this.root.visible && !this.blurred && multi.k.a === 1 && multi.k.v > 0.98;
    if (show) {
      this.field.place(
        multi.x + TEXT_PAD_X + this.fieldBox.x,
        this.geometry.y + multi.moreTop + this.fieldBox.y,
        this.fieldBox.w,
        this.fieldBox.h
      );
    }
    if (show !== this.field.isVisible()) this.field.show(show);
    if (show && this.focusLater) {
      this.focusLater = false;
      this.field.focus();
    }
  }
}
