// La costellazione (2026-09-23): la sferografia di un Rubyfront. La carta
// al centro, in prospettiva, che si inclina piano; i dieci nodi in orbita
// ellittica attorno (una spirale appena accennata), dal basso a sinistra
// sopra la cima fino al basso a destra; i raggi dalla carta a ogni nodo e la
// catena fra nodi consecutivi; l'energia — scintille additive — che scorre
// lungo la catena fino al livello raggiunto; le braci lente attorno alla
// carta. Una camera (il contenitore `view`) che si avvicina al nodo scelto.
// L'entrata (la tessera che vola al centro, i nodi che sbocciano, i fili
// che si disegnano), la rivelazione dei livelli nuovi (l'impulso, la
// gemma che si accende, le scintille, il suono), l'uscita.
//
// Niente Graphics ridisegnate per frame: i fili sono disegnati una volta per
// tratto; per frame si muovono solo sprite e alpha.

import { BlurFilter, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { resolutionStep } from "../../card/cache";
import { paintCard } from "../../card/index";
import type { FaceOverrides } from "../../card/model";
import { CARD_H, CARD_W } from "../../card/theme";
import { Card3D } from "../../effects/projection";
import { glowFilter } from "../../effects/filters";
import type { Particles } from "../../effects/particles";
import { shape } from "../../effects/shapes";
import type { Stage } from "../../stage";
import { ease, easeInOut, easeOut, key, reducedMotion, tween, wait } from "../../table/animation";
import { CrispSprite, SANS } from "../../table/appearance";
import { playSocket, playWhoosh } from "../../sound";
import { MUTED, paintText } from "../ui";
import { Anim, centered, gemTexture, haloTexture, radialGlow, type GemState } from "./fx";
import type { Font } from "../../card/text";
import { PROGRESSION_LEVELS } from "@rubyfront/core/progression";

const LEVEL_FONT: Font = { size: 13, weight: 700, family: SANS };
/** Il lato della gemma di un nodo. */
export const NODE_GEM = 26;
/** Quante scintille per tratto raggiunto, e quanto ci mettono a percorrerlo. */
const SPARKS_PER_SEGMENT = 2;
const SPARK_MS = 1500;
/** La cadenza del respiro del nodo corrente. */
const BREATH_MS = 2400;

interface Node {
  level: number;
  root: Container;
  halo: CrispSprite;
  gem: CrispSprite;
  ring: Graphics;
  number: Sprite;
  x: number;
  y: number;
  hover: Anim;
  ray: Graphics;
  rayLit: Graphics;
}

interface Segment {
  from: number;
  /** I punti della curva, dal nodo `from` al successivo. */
  points: { x: number; y: number }[];
  lengths: number[];
  total: number;
  dim: Graphics;
  lit: Container;
}

interface Spark {
  sprite: Sprite;
  segment: number;
  t: number;
}

export interface ConstellationOptions {
  cardId: string;
  locale: string;
  w: number;
  h: number;
  particles: Particles;
  particleLayer: Container;
  /** Le abilità montate sulla faccia A, per posizione: la carta al centro è quella «aggiornata». */
  overrides?: FaceOverrides;
  onPick(level: number): void;
}

export class Constellation extends Container {
  /** La camera: tutto ciò che si muove sta qui dentro. */
  readonly view = new Container({ label: "constellation-view" });
  private readonly cardHolder = new Container({ label: "constellation-card" });
  private card: Card3D | null = null;
  private readonly nodes: Node[] = [];
  private readonly segments: Segment[] = [];
  private readonly sparks: Spark[] = [];
  private readonly sparkLayer = new Container({ label: "sparks" });
  private readonly cam = { x: new Anim(0), y: new Anim(0), zoom: new Anim(1) };
  private shakeAmount = 0;
  private level = 1;
  private currentGlow = glowFilter(0xff4d6d, 2.5);
  private emitter: number | null = null;
  private lastNow = performance.now();
  private readonly cardW: number;
  private readonly cardH: number;
  private res: number;
  private gone = false;

  constructor(
    private readonly stage: Stage,
    private readonly opts: ConstellationOptions
  ) {
    super({ label: "constellation" });
    const v = stage.visible();
    this.res = v.scale * stage.app.renderer.resolution;
    this.cardW = Math.min(CARD_W * 0.42, opts.w * 0.24);
    this.cardH = (this.cardW * CARD_H) / CARD_W;
    this.view.position.set(opts.w / 2, opts.h / 2);
    this.addChild(this.view);
    // Il bagliore dietro la carta, poi i fili, la carta, i nodi, le scintille e le braci sopra tutto.
    const glow = radialGlow(this.cardW * 3.2, this.cardH * 2.4, "210,74,100", 0.18, this.res);
    this.view.addChild(glow);
    this.geometry();
    this.view.addChild(this.cardHolder);
    for (const node of this.nodes) this.view.addChild(node.root);
    this.view.addChild(this.sparkLayer);
    this.view.addChild(opts.particleLayer);
    this.eventMode = "static";
    this.hitArea = new Rectangle(0, 0, opts.w, opts.h);
  }

  // ------------------------------------------------------------ geometria
  /** I nodi in orbita ellittica attorno alla carta, i raggi e la catena (dipinti una volta). */
  private geometry(): void {
    const { w, h } = this.opts;
    const rx = Math.min(this.cardW / 2 + 230, w / 2 - 90);
    const ry = Math.min(this.cardH / 2 + 130, h / 2 - 80);
    const sweep = 320;
    for (let i = 0; i < PROGRESSION_LEVELS; i += 1) {
      const angle = ((190 + (i * sweep) / (PROGRESSION_LEVELS - 1)) * Math.PI) / 180;
      const spiral = 1 + i * 0.012;
      const x = Math.cos(angle) * rx * spiral;
      const y = Math.sin(angle) * ry * spiral;
      this.nodes.push(this.makeNode(i + 1, x, y));
    }
    // I raggi: dalla gemma della carta (in alto sulla carta) a ogni nodo.
    const gemAt = { x: 0, y: -this.cardH / 2 + 26 };
    for (const node of this.nodes) {
      node.ray.moveTo(gemAt.x, gemAt.y).lineTo(node.x, node.y).stroke({ color: 0x29222a, width: 1, alpha: 0.9 });
      node.rayLit.moveTo(gemAt.x, gemAt.y).lineTo(node.x, node.y).stroke({ color: 0xa62640, width: 1.5, alpha: 0.6 });
      node.rayLit.alpha = 0;
      this.view.addChild(node.ray, node.rayLit);
    }
    // La catena: curve bombate verso l'esterno fra nodi consecutivi, campionate per le scintille.
    for (let i = 0; i < this.nodes.length - 1; i += 1) {
      const a = this.nodes[i]!;
      const b = this.nodes[i + 1]!;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const control = { x: mid.x * 1.16, y: mid.y * 1.16 };
      const points: { x: number; y: number }[] = [];
      for (let s = 0; s <= 16; s += 1) {
        const t = s / 16;
        const u = 1 - t;
        points.push({ x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, y: u * u * a.y + 2 * u * t * control.y + t * t * b.y });
      }
      const lengths: number[] = [];
      let total = 0;
      for (let s = 1; s < points.length; s += 1) {
        const d = Math.hypot(points[s]!.x - points[s - 1]!.x, points[s]!.y - points[s - 1]!.y);
        lengths.push(d);
        total += d;
      }
      const dim = new Graphics();
      dim.moveTo(a.x, a.y).quadraticCurveTo(control.x, control.y, b.x, b.y).stroke({ color: 0x3a3037, width: 1.5 });
      const core = new Graphics();
      core.moveTo(a.x, a.y).quadraticCurveTo(control.x, control.y, b.x, b.y).stroke({ color: 0xff4d6d, width: 2 });
      const haze = new Graphics();
      haze.moveTo(a.x, a.y).quadraticCurveTo(control.x, control.y, b.x, b.y).stroke({ color: 0xff4d6d, width: 8, alpha: 0.7 });
      haze.filters = [new BlurFilter({ strength: 6, quality: 2 })];
      haze.blendMode = "add";
      const lit = new Container();
      lit.addChild(haze, core);
      lit.alpha = 0;
      this.view.addChild(dim, lit);
      this.segments.push({ from: i, points, lengths, total, dim, lit });
    }
  }

  private makeNode(level: number, x: number, y: number): Node {
    const root = new Container({ label: `node:${level}` });
    root.position.set(x, y);
    const halo = centered(haloTexture(NODE_GEM, this.res));
    halo.alpha = 0;
    halo.blendMode = "add";
    const gem = centered(gemTexture(NODE_GEM, "locked", this.res));
    const ring = new Graphics().rect(-NODE_GEM - 3, -NODE_GEM - 3, NODE_GEM * 2 + 6, NODE_GEM * 2 + 6).stroke({ color: 0xe56a86, width: 2 });
    ring.visible = false;
    const number = paintText(this.stage, String(level), LEVEL_FONT, MUTED).sprite;
    number.position.set(-number.width / 2, NODE_GEM * 0.72 + 4);
    root.addChild(halo, gem, ring, number);
    root.eventMode = "static";
    root.cursor = "pointer";
    root.hitArea = new Rectangle(-NODE_GEM - 6, -NODE_GEM - 6, NODE_GEM * 2 + 12, NODE_GEM * 2 + 30);
    const node: Node = { level, root, halo, gem, ring, number, x, y, hover: new Anim(1), ray: new Graphics(), rayLit: new Graphics() };
    root.on("pointerover", () => node.hover.set(1.16, 180));
    root.on("pointerout", () => node.hover.set(1, 220));
    root.on("pointertap", () => this.opts.onPick(level));
    return node;
  }

  // --------------------------------------------------------------- stato
  /** Il livello raggiunto e il nodo scelto: gli stati delle gemme, i fili accesi, le scintille. Subito, senza animazione. */
  setProgress(level: number, chosen: number): void {
    this.level = level;
    for (const node of this.nodes) {
      const state: GemState = node.level < level ? "reached" : node.level === level ? "current" : "locked";
      this.paintNode(node, state);
      node.rayLit.alpha = node.level <= level ? 1 : 0;
      node.ring.visible = node.level === chosen;
    }
    for (const segment of this.segments) segment.lit.alpha = segment.from + 2 <= level ? 1 : 0;
    this.settleSparks();
  }

  private paintNode(node: Node, state: GemState): void {
    node.gem.texture = gemTexture(NODE_GEM, state, this.res);
    node.halo.alpha = state === "locked" ? 0 : state === "reached" ? 0.35 : 0.6;
    node.number.tint = state === "locked" ? 0xffffff : 0xffffff;
    node.number.alpha = state === "locked" ? 0.55 : 1;
    node.root.filters = state === "current" ? [this.currentGlow] : [];
  }

  /** Le scintille: tante quanti i tratti raggiunti, distribuite lungo il cammino. */
  private settleSparks(): void {
    const wanted = Math.max(0, this.level - 1) * SPARKS_PER_SEGMENT;
    while (this.sparks.length > wanted) {
      const spark = this.sparks.pop()!;
      spark.sprite.destroy();
    }
    while (this.sparks.length < wanted) {
      const index = this.sparks.length;
      const sprite = new Sprite(shape("spark"));
      sprite.anchor.set(0.5);
      sprite.blendMode = "add";
      sprite.tint = 0xff8ea6;
      sprite.scale.set(0.9);
      this.sparkLayer.addChild(sprite);
      this.sparks.push({ sprite, segment: Math.floor(index / SPARKS_PER_SEGMENT), t: (index % SPARKS_PER_SEGMENT) / SPARKS_PER_SEGMENT });
    }
  }

  /** Il nodo scelto: l'anello con un pop, e la camera che si avvicina fra la carta e il nodo. */
  choose(level: number): void {
    for (const node of this.nodes) {
      const on = node.level === level;
      node.ring.visible = on;
      if (on) {
        node.ring.scale.set(0.6);
        void tween(this.stage.app.ticker, 260, k => !node.ring.destroyed && node.ring.scale.set(key(k, [[0, 0.6], [0.6, 1.12], [1, 1]])), easeOut);
        this.focus(node.x * 0.55, node.y * 0.55, 1.18, 520);
      }
    }
  }

  /** La camera su un punto della scena (coordinate della vista), con quello zoom. */
  focus(x: number, y: number, zoom: number, ms: number): void {
    this.cam.x.set(x, ms, easeInOut);
    this.cam.y.set(y, ms, easeInOut);
    this.cam.zoom.set(zoom, ms, easeInOut);
  }

  /** La camera torna al centro. */
  unfocus(ms = 520): void {
    this.focus(0, 0, 1, ms);
  }

  /** Il riquadro della carta al centro, in pixel dello schermo (per lo zoom del montaggio). */
  cardBox(): { x: number; y: number; width: number; height: number } | null {
    if (!this.card) return null;
    const b = this.card.getBounds();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }

  // ------------------------------------------------------------ entrata
  /**
   * L'entrata: la faccia vola dal riquadro dato (pixel dello schermo) al
   * centro, i nodi sbocciano uno dopo l'altro, i raggi e la catena si
   * disegnano, poi l'energia parte.
   */
  async enter(from: { x: number; y: number; width: number; height: number } | null, level: number, chosen: number): Promise<void> {
    const texture = (await Promise.race([this.paintFace(this.opts.overrides ?? {}), wait(600).then(() => null)])) ?? Texture.WHITE;
    if (this.gone) return;
    const card = new Card3D(texture, this.cardW, this.cardH, 1400);
    this.card = card;
    this.cardHolder.addChild(card);
    for (const node of this.nodes) {
      node.root.alpha = 0;
      node.root.scale.set(0.6);
      node.ray.alpha = 0;
      node.rayLit.alpha = 0;
    }
    for (const segment of this.segments) {
      segment.dim.alpha = 0;
      segment.lit.alpha = 0;
    }
    this.setProgressSilently(level, chosen);
    const ticker = this.stage.app.ticker;
    // La carta: dal riquadro di partenza (nella pick) al centro, crescendo.
    if (from && !reducedMotion()) {
      const center = this.view.toGlobal({ x: 0, y: 0 });
      const scale = this.stage.visible().scale;
      const startScale = from.width / (this.cardW * scale);
      const dx = (from.x + from.width / 2 - center.x) / scale;
      const dy = (from.y + from.height / 2 - center.y) / scale;
      playWhoosh(560);
      await tween(
        ticker,
        560,
        k => {
          if (card.destroyed) return;
          card.position.set(dx * (1 - k), dy * (1 - k) - Math.sin(k * Math.PI) * 40);
          const s = startScale + (1 - startScale) * k;
          card.scale.set(s);
          card.rotateTo(-0.25 * (1 - k), 0.5 * (1 - k));
        },
        easeInOut
      );
      if (this.gone) return;
      card.position.set(0, 0);
      card.scale.set(1);
    }
    // I nodi sbocciano, i raggi si accendono, poi la catena.
    const bloom = this.nodes.map((node, index) =>
      wait(index * 55).then(() =>
        tween(
          ticker,
          420,
          k => {
            if (node.root.destroyed) return;
            node.root.alpha = k;
            node.root.scale.set(key(k, [[0, 0.6], [0.6, 1.1], [1, 1]]));
            node.ray.alpha = k;
            node.rayLit.alpha = node.level <= this.level ? k : 0;
          },
          easeOut
        )
      )
    );
    const chain = this.segments.map((segment, index) =>
      wait(140 + index * 55).then(() =>
        tween(
          ticker,
          380,
          k => {
            if (segment.dim.destroyed) return;
            segment.dim.alpha = k;
            segment.lit.alpha = segment.from + 2 <= this.level ? k : 0;
          },
          ease
        )
      )
    );
    await Promise.all([...bloom, ...chain]);
    if (this.gone) return;
    this.settleSparks();
    this.startEmbers();
  }

  /** La faccia A dipinta con le abilità montate, alla risoluzione della camera (a gradini, o Pixi svuota il canvas). */
  private async paintFace(overrides: FaceOverrides): Promise<Texture | null> {
    const res = resolutionStep((this.cardW / CARD_W) * this.stage.app.renderer.resolution * this.stage.visible().scale * 1.6);
    const painted = await paintCard(this.opts.cardId, "rubyfront", this.opts.locale, res, overrides);
    return painted ? Texture.from({ resource: painted.canvas, resolution: res, width: CARD_W, height: CARD_H }) : null;
  }

  /** Le abilità montate sono cambiate: la carta al centro si ridipinge. */
  async setAbilities(overrides: FaceOverrides): Promise<void> {
    const texture = await this.paintFace(overrides);
    if (!texture || this.gone || !this.card || this.card.destroyed) return;
    this.card.face(texture);
  }

  private setProgressSilently(level: number, chosen: number): void {
    this.level = level;
    for (const node of this.nodes) {
      this.paintNode(node, node.level < level ? "reached" : node.level === level ? "current" : "locked");
      node.ring.visible = node.level === chosen;
    }
  }

  /** Le braci lente attorno alla carta. */
  private startEmbers(): void {
    if (this.emitter !== null) return;
    this.emitter = this.opts.particles.emitter({
      area: { x: -this.cardW * 0.8, y: -this.cardH * 0.6, w: this.cardW * 1.6, h: this.cardH * 1.2 },
      perSecond: 7,
      burst: { shape: "dot", colors: [0xff4d6d, 0xe0314b, 0xff9fb3], velocity: [8, 22], angle: [-Math.PI / 2 - 0.4, -Math.PI / 2 + 0.4], life: [2200, 3800], scale: [0.16, 0.34], gravity: -4, sway: 6, light: true },
    });
  }

  /** L'uscita: tutto si spegne in fretta; poi il contenitore si può distruggere. */
  async leave(): Promise<void> {
    this.stopEmbers();
    const ticker = this.stage.app.ticker;
    await tween(ticker, 320, k => !this.destroyed && (this.view.alpha = 1 - k), ease);
  }

  private stopEmbers(): void {
    if (this.emitter === null) return;
    this.opts.particles.stop(this.emitter);
    this.emitter = null;
  }

  // --------------------------------------------------------- rivelazione
  /** I livelli appena raggiunti, uno dopo l'altro: l'impulso lungo la catena, la gemma che si accende, le scintille, il suono. */
  async reveal(levels: number[], onLevel?: (level: number) => void): Promise<void> {
    const ticker = this.stage.app.ticker;
    for (const level of levels) {
      if (this.gone) return;
      const node = this.nodes[level - 1];
      if (!node) continue;
      const segment = this.segments[level - 2];
      // L'impulso: una scintilla grande che corre il tratto precedente.
      if (segment) {
        const pulse = new Sprite(shape("spark"));
        pulse.anchor.set(0.5);
        pulse.blendMode = "add";
        pulse.tint = 0xffd6de;
        pulse.scale.set(1.8);
        this.sparkLayer.addChild(pulse);
        await tween(
          ticker,
          420,
          k => {
            if (pulse.destroyed) return;
            const at = this.pointOn(segment, k);
            pulse.position.set(at.x, at.y);
            pulse.rotation = at.angle;
            segment.lit.alpha = Math.max(segment.lit.alpha, k);
          },
          easeInOut
        );
        pulse.destroy();
      }
      if (this.gone) return;
      // La gemma si accende: flash bianco, pop, alone, scintille, scossa, suono.
      const previous = this.nodes[level - 2];
      if (previous) this.paintNode(previous, "reached");
      this.paintNode(node, "current");
      this.level = Math.max(this.level, level);
      node.gem.tint = 0xffffff;
      node.halo.alpha = 1;
      this.currentGlow.outerStrength = 6;
      this.opts.particles.burst({ x: node.x, y: node.y, n: 26, shape: "spark", colors: [0xff4d6d, 0xff9fb3, 0xfff0f3], velocity: [90, 260], life: [400, 900], scale: [0.5, 1.1], gravity: 60, friction: 0.9, align: true, light: true });
      this.opts.particles.burst({ x: node.x, y: node.y, n: 1, shape: "ring", colors: [0xff8ea6], velocity: [0, 0], life: [520, 520], scale: [0.4, 0.4], growth: 60, light: true });
      this.shakeAmount = 7;
      playSocket("destructive", 1.2);
      onLevel?.(level);
      await tween(
        ticker,
        620,
        k => {
          if (node.root.destroyed) return;
          node.root.scale.set(key(k, [[0, 0.6], [0.45, 1.3], [1, 1]]));
          node.rayLit.alpha = k;
          this.currentGlow.outerStrength = 6 - 3.5 * k;
        },
        easeOut
      );
      node.gem.tint = 0xffffff;
      node.halo.alpha = 0.6;
      await wait(180);
    }
    this.settleSparks();
  }

  // -------------------------------------------------------------- frame
  /** Un frame: camera, hover, respiro, inclinazione della carta, scintille, scossa. */
  step(now: number): void {
    const dt = Math.min(64, now - this.lastNow);
    this.lastNow = now;
    const breath = reducedMotion() ? 1 : 0.5 - 0.5 * Math.cos((now / BREATH_MS) * Math.PI * 2);
    for (const node of this.nodes) {
      if (node.hover.step(now)) node.root.scale.set(node.hover.v);
      if (node.level === this.level) node.halo.alpha = 0.35 + 0.5 * breath;
    }
    if (!reducedMotion() && this.card) this.card.rotateTo(0.05 * Math.sin((now / 6000) * Math.PI * 2), 0.09 * Math.cos((now / 7300) * Math.PI * 2));
    for (const spark of this.sparks) {
      spark.t += dt / SPARK_MS;
      if (spark.t >= 1) spark.t -= 1;
      const segment = this.segments[spark.segment];
      if (!segment) continue;
      const at = this.pointOn(segment, spark.t);
      spark.sprite.position.set(at.x, at.y);
      spark.sprite.rotation = at.angle;
      spark.sprite.alpha = 0.35 + 0.65 * Math.sin(spark.t * Math.PI);
    }
    // La camera: il punto in fuoco al centro del pannello, con lo zoom; la scossa decade.
    const moved = [this.cam.x.step(now), this.cam.y.step(now), this.cam.zoom.step(now)].some(Boolean);
    if (this.shakeAmount > 0.05 || moved) {
      const shake = this.shakeAmount;
      this.shakeAmount = Math.max(0, this.shakeAmount - dt / 45);
      const jx = shake ? (Math.sin(now / 17) * shake) / 2 : 0;
      const jy = shake ? (Math.cos(now / 23) * shake) / 2 : 0;
      const zoom = this.cam.zoom.v;
      this.view.scale.set(zoom);
      this.view.position.set(this.opts.w / 2 - this.cam.x.v * zoom + jx, this.opts.h / 2 - this.cam.y.v * zoom + jy);
    }
  }

  /** Un punto lungo la curva di un tratto (0..1), con l'angolo della tangente. */
  private pointOn(segment: Segment, t: number): { x: number; y: number; angle: number } {
    const target = Math.max(0, Math.min(1, t)) * segment.total;
    let run = 0;
    for (let i = 0; i < segment.lengths.length; i += 1) {
      const length = segment.lengths[i]!;
      if (run + length >= target || i === segment.lengths.length - 1) {
        const a = segment.points[i]!;
        const b = segment.points[i + 1]!;
        const k = length > 0 ? (target - run) / length : 0;
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, angle: Math.atan2(b.y - a.y, b.x - a.x) };
      }
      run += length;
    }
    const last = segment.points[segment.points.length - 1]!;
    return { x: last.x, y: last.y, angle: 0 };
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.gone = true;
    this.stopEmbers();
    // Il livello delle particelle è del proprietario: si sfila prima di distruggere il resto.
    this.view.removeChild(this.opts.particleLayer);
    super.destroy(options);
  }
}
