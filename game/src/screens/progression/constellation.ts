// La costellazione (2026-09-23, a percorso dal 2026-09-26): la sferografia
// di un Rubyfront. La carta al centro, in prospettiva, che si inclina piano;
// attorno i venti nodi del percorso alle posizioni del file dei dati, coi
// collegamenti fra loro e con la carta; l'energia — scintille additive —
// che scorre dalla carta lungo i tratti accesi (fra nodi attivi); le braci
// lente attorno alla carta. Tre stati per nodo: attivo (gemma accesa),
// aperto (si può attivare: gemma scura col filo acceso, che respira) e
// chiuso. Una camera (il contenitore `view`) che si avvicina al nodo scelto.
// L'entrata (la tessera che vola al centro, i nodi che sbocciano, i fili
// che si disegnano), l'accensione e lo spegnimento di un nodo, la
// rivelazione dei punti nuovi (l'impulso sulla carta e sui nodi aperti),
// l'uscita.
//
// Niente Graphics ridisegnate per frame: i fili sono disegnati una volta per
// tratto (spento e acceso); per frame si muovono solo sprite e alpha.

import { t } from "@rubyfront/core/i18n";
import { PATH_ROOT, abilityWords, progressionOf, reachable, type PathNode, type ProgressionCard } from "@rubyfront/core/progression";
import { BlurFilter, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { resolutionStep } from "../../card/cache";
import { paintCard } from "../../card/index";
import type { FaceOverrides } from "../../card/model";
import type { Font } from "../../card/text";
import { CARD_H, CARD_W } from "../../card/theme";
import { glowFilter } from "../../effects/filters";
import type { Particles } from "../../effects/particles";
import { Card3D } from "../../effects/projection";
import { shape } from "../../effects/shapes";
import { playSocket, playWhoosh } from "../../sound";
import type { Stage } from "../../stage";
import { ease, easeInOut, easeOut, key, reducedMotion, tween, wait } from "../../table/animation";
import { CrispSprite, SANS } from "../../table/appearance";
import { INK, paintText } from "../ui";
import { Anim, centered, gemTexture, haloTexture, radialGlow, type GemState } from "./fx";

const GLYPH_FONT: Font = { size: 13, weight: 700, family: SANS };
const LABEL_FONT: Font = { size: 13, weight: 600, family: SANS };
/** Il lato della gemma di un nodo. */
export const NODE_GEM = 24;
/** Quante scintille per tratto acceso, e quanto ci mettono a percorrerlo. */
const SPARKS_PER_SEGMENT = 2;
const SPARK_MS = 1300;
/** La cadenza del respiro dei nodi aperti. */
const BREATH_MS = 2400;
/** La larghezza massima dell'etichetta sotto un nodo. */
const LABEL_W = 118;

type NodeState = "active" | "open" | "closed";

interface NodeView {
  id: string;
  data: PathNode;
  root: Container;
  halo: CrispSprite;
  gem: CrispSprite;
  ring: Graphics;
  glyph: Sprite;
  label: Sprite;
  x: number;
  y: number;
  hover: Anim;
  state: NodeState;
}

interface Segment {
  /** Da dove parte l'energia (più vicino alla carta nel file: il nodo a cui ci si attacca). */
  from: string;
  to: string;
  a: { x: number; y: number };
  b: { x: number; y: number };
  total: number;
  dim: Graphics;
  lit: Container;
  on: boolean;
}

interface Spark {
  sprite: Sprite;
  segment: Segment;
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
  onPick(id: string): void;
}

export class Constellation extends Container {
  /** La camera: tutto ciò che si muove sta qui dentro. */
  readonly view = new Container({ label: "constellation-view" });
  private readonly cardHolder = new Container({ label: "constellation-card" });
  private card: Card3D | null = null;
  private readonly nodes = new Map<string, NodeView>();
  private readonly segments: Segment[] = [];
  private readonly sparks: Spark[] = [];
  private readonly sparkLayer = new Container({ label: "sparks" });
  private readonly cam = { x: new Anim(0), y: new Anim(0), zoom: new Anim(1) };
  private readonly data: ProgressionCard | null;
  private shakeAmount = 0;
  private path: string[] = [];
  private free = 0;
  private readonly openGlow = glowFilter(0xff4d6d, 2);
  private emitter: number | null = null;
  private lastNow = performance.now();
  private readonly cardW: number;
  private readonly cardH: number;
  private readonly unit: number;
  /** Il centro dell'ingombro della griglia (carta compresa), nella vista: la camera a riposo guarda lì. */
  private readonly rest: { x: number; y: number };
  private readonly res: number;
  private gone = false;

  constructor(
    private readonly stage: Stage,
    private readonly opts: ConstellationOptions
  ) {
    super({ label: "constellation" });
    const v = stage.visible();
    this.res = v.scale * stage.app.renderer.resolution;
    this.data = progressionOf(opts.cardId);
    // L'unità della griglia: l'ingombro dei nodi (e della carta) sta dentro
    // il pannello, con lo spazio per la gemma e l'etichetta, ed è centrato.
    const nodes = this.data?.nodes ?? [];
    const xs = [0, ...nodes.map(node => node.at[0])];
    const ys = [-1.4, 1.4, ...nodes.map(node => node.at[1])];
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    this.unit = Math.max(40, Math.min((opts.w - LABEL_W - 24) / Math.max(1, maxX - minX), (opts.h - 2 * NODE_GEM - 60) / Math.max(1, maxY - minY)));
    this.rest = { x: ((minX + maxX) / 2) * this.unit, y: ((minY + maxY) / 2 + 0.25) * this.unit };
    // La carta sta dentro l'anello dei nodi più vicini (larga al più 1,9 unità).
    this.cardW = Math.min(CARD_W * 0.42, this.unit * 1.9);
    this.cardH = (this.cardW * CARD_H) / CARD_W;
    this.cam.x.snap(this.rest.x);
    this.cam.y.snap(this.rest.y);
    this.view.position.set(opts.w / 2 - this.rest.x, opts.h / 2 - this.rest.y);
    this.addChild(this.view);
    // Il bagliore dietro la carta, poi i fili, la carta, i nodi, le scintille e le braci sopra tutto.
    const glow = radialGlow(this.cardW * 3.2, this.cardH * 2.4, "210,74,100", 0.18, this.res);
    this.view.addChild(glow);
    this.geometry();
    this.view.addChild(this.cardHolder);
    for (const node of this.nodes.values()) this.view.addChild(node.root);
    this.view.addChild(this.sparkLayer);
    this.view.addChild(opts.particleLayer);
    this.eventMode = "static";
    this.hitArea = new Rectangle(0, 0, opts.w, opts.h);
  }

  // ------------------------------------------------------------ geometria
  /** I nodi alle loro posizioni, i collegamenti (dipinti una volta, spento e acceso). */
  private geometry(): void {
    for (const data of this.data?.nodes ?? []) this.nodes.set(data.id, this.makeNode(data, data.at[0] * this.unit, data.at[1] * this.unit));
    const seen = new Set<string>();
    for (const data of this.data?.nodes ?? []) {
      for (const from of data.links) {
        const pair = [from, data.id].sort().join("|");
        if (seen.has(pair)) continue;
        seen.add(pair);
        const a = this.pointOf(from);
        const b = this.pointOf(data.id);
        const total = Math.hypot(b.x - a.x, b.y - a.y);
        const dim = new Graphics().moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0x3a3037, width: 1.5 });
        const core = new Graphics().moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0xff4d6d, width: 2 });
        const haze = new Graphics().moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0xff4d6d, width: 8, alpha: 0.7 });
        haze.filters = [new BlurFilter({ strength: 6, quality: 2 })];
        haze.blendMode = "add";
        const lit = new Container();
        lit.addChild(haze, core);
        lit.alpha = 0;
        this.view.addChild(dim, lit);
        this.segments.push({ from, to: data.id, a, b, total, dim, lit, on: false });
      }
    }
  }

  /** Il centro di un nodo nella vista; la carta è al centro. */
  private pointOf(id: string): { x: number; y: number } {
    if (id === PATH_ROOT) return { x: 0, y: 0 };
    const node = this.nodes.get(id);
    return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
  }

  private makeNode(data: PathNode, x: number, y: number): NodeView {
    const root = new Container({ label: `node:${data.id}` });
    root.position.set(x, y);
    const halo = centered(haloTexture(NODE_GEM, this.res));
    halo.alpha = 0;
    halo.blendMode = "add";
    const gem = centered(gemTexture(NODE_GEM, "locked", this.res));
    // L'anello della scelta: un rombo attorno alla gemma, sopra l'etichetta.
    const r = NODE_GEM;
    const ring = new Graphics().poly([0, -r, r, 0, 0, r, -r, 0]).stroke({ color: 0xe56a86, width: 2 });
    ring.visible = false;
    const glyph = paintText(this.stage, this.glyphOf(data), GLYPH_FONT, INK).sprite;
    glyph.position.set(-glyph.width / 2, -glyph.height / 2);
    const label = paintText(this.stage, this.labelOf(data), LABEL_FONT, INK, { maxW: LABEL_W, align: "center" }).sprite;
    label.position.set(-label.width / 2, NODE_GEM + 6);
    root.addChild(halo, gem, ring, glyph, label);
    root.eventMode = "static";
    root.cursor = "pointer";
    root.hitArea = new Rectangle(-NODE_GEM - 6, -NODE_GEM - 6, NODE_GEM * 2 + 12, NODE_GEM * 2 + 30);
    const node: NodeView = { id: data.id, data, root, halo, gem, ring, glyph, label, x, y, hover: new Anim(1), state: "closed" };
    root.on("pointerover", () => node.hover.set(1.16, 180));
    root.on("pointerout", () => node.hover.set(1, 220));
    root.on("pointertap", () => this.opts.onPick(data.id));
    return node;
  }

  /** Il segno dentro la gemma: la faccia dell'abilità, o il numero di PV e Furia. */
  private glyphOf(data: PathNode): string {
    if (data.kind === "ability") return t(`progression.glyph.${data.face ?? "rubyfront"}`);
    return t(`progression.glyph.${data.kind}`, { n: data.amount ?? 0 });
  }

  /** L'etichetta sotto il nodo: il nome dell'abilità, o il tipo. */
  private labelOf(data: PathNode): string {
    if (data.kind === "ability") return abilityWords({ id: data.id, locales: data.locales ?? {} }, this.opts.locale).name;
    return t(`progression.node.${data.kind}.name`, { n: data.amount ?? 0 });
  }

  // --------------------------------------------------------------- stato
  /** Il percorso, i punti liberi e il nodo scelto: gli stati delle gemme, i fili accesi, le scintille. Subito, senza animazione. */
  setPath(path: string[], level: number, chosen: string | null): void {
    this.path = [...path];
    this.free = Math.max(0, level - path.length);
    const open = new Set(this.free > 0 ? reachable(this.data, path) : []);
    for (const node of this.nodes.values()) {
      this.paintNode(node, path.includes(node.id) ? "active" : open.has(node.id) ? "open" : "closed");
      node.ring.visible = node.id === chosen;
    }
    for (const segment of this.segments) {
      segment.on = this.activeEnd(segment.from) && this.activeEnd(segment.to);
      segment.lit.alpha = segment.on ? 1 : 0;
    }
    this.settleSparks();
  }

  private activeEnd(id: string): boolean {
    return id === PATH_ROOT || this.path.includes(id);
  }

  private paintNode(node: NodeView, state: NodeState): void {
    node.state = state;
    const gem: GemState = state === "active" ? "reached" : state === "open" ? "open" : "locked";
    node.gem.texture = gemTexture(NODE_GEM, gem, this.res);
    node.halo.alpha = state === "active" ? 0.35 : 0;
    node.glyph.alpha = state === "closed" ? 0.5 : 1;
    node.label.alpha = state === "active" ? 1 : state === "open" ? 0.8 : 0.45;
    // Il bagliore solo sulla gemma: sull'etichetta la sfocherebbe.
    node.gem.filters = state === "open" ? [this.openGlow] : [];
  }

  /** Le scintille: per ogni tratto acceso, dalla parte della carta verso fuori. */
  private settleSparks(): void {
    for (const spark of this.sparks.splice(0)) spark.sprite.destroy();
    for (const segment of this.segments) {
      if (!segment.on) continue;
      for (let i = 0; i < SPARKS_PER_SEGMENT; i += 1) {
        const sprite = new Sprite(shape("spark"));
        sprite.anchor.set(0.5);
        sprite.blendMode = "add";
        sprite.tint = 0xff8ea6;
        sprite.scale.set(0.8);
        this.sparkLayer.addChild(sprite);
        this.sparks.push({ sprite, segment, t: i / SPARKS_PER_SEGMENT + Math.random() * 0.2 });
      }
    }
  }

  /** Il nodo scelto: l'anello con un pop. La camera resta ferma: avvicinandosi spingerebbe i nodi del bordo sotto il pannello. */
  choose(id: string | null): void {
    for (const node of this.nodes.values()) {
      const on = node.id === id;
      node.ring.visible = on;
      if (!on) continue;
      node.ring.scale.set(0.6);
      void tween(this.stage.app.ticker, 260, k => !node.ring.destroyed && node.ring.scale.set(key(k, [[0, 0.6], [0.6, 1.12], [1, 1]])), easeOut);
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
    this.focus(this.rest.x, this.rest.y, 1, ms);
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
   * centro, i nodi sbocciano dal centro in fuori, i fili si disegnano, poi
   * l'energia parte.
   */
  async enter(from: { x: number; y: number; width: number; height: number } | null, path: string[], level: number, chosen: string | null): Promise<void> {
    const texture = (await Promise.race([this.paintFace(this.opts.overrides ?? {}), wait(600).then(() => null)])) ?? Texture.WHITE;
    if (this.gone) return;
    const card = new Card3D(texture, this.cardW, this.cardH, 1400);
    this.card = card;
    this.cardHolder.addChild(card);
    for (const node of this.nodes.values()) {
      node.root.alpha = 0;
      node.root.scale.set(0.6);
    }
    for (const segment of this.segments) {
      segment.dim.alpha = 0;
      segment.lit.alpha = 0;
    }
    this.setPath(path, level, chosen);
    for (const spark of this.sparks) spark.sprite.alpha = 0;
    for (const segment of this.segments) segment.lit.alpha = 0;
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
    // I nodi sbocciano dal centro in fuori, i fili con loro.
    const distance = (point: { x: number; y: number }): number => Math.hypot(point.x, point.y) / this.unit;
    const bloom = [...this.nodes.values()].map(node =>
      wait(distance(node) * 70).then(() =>
        tween(
          ticker,
          420,
          k => {
            if (node.root.destroyed) return;
            node.root.alpha = k;
            node.root.scale.set(key(k, [[0, 0.6], [0.6, 1.1], [1, 1]]));
          },
          easeOut
        )
      )
    );
    const wires = this.segments.map(segment =>
      wait(80 + distance(segment.b) * 70).then(() =>
        tween(
          ticker,
          380,
          k => {
            if (segment.dim.destroyed) return;
            segment.dim.alpha = k;
            segment.lit.alpha = segment.on ? k : 0;
          },
          ease
        )
      )
    );
    await Promise.all([...bloom, ...wires]);
    if (this.gone) return;
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

  // --------------------------------------------------------- animazioni
  /**
   * Un nodo si è acceso: l'impulso corre il tratto da un vicino attivo (o
   * dalla carta), la gemma lampeggia, scintille, scossa, suono. Il resto lo
   * rimette in ordine `setPath` (già chiamato).
   */
  async lightUp(id: string): Promise<void> {
    const node = this.nodes.get(id);
    if (!node || this.gone) return;
    const ticker = this.stage.app.ticker;
    const segment = this.segments.find(candidate => candidate.on && (candidate.to === id || candidate.from === id));
    if (segment && !reducedMotion()) {
      const outward = segment.to === id;
      const pulse = new Sprite(shape("spark"));
      pulse.anchor.set(0.5);
      pulse.blendMode = "add";
      pulse.tint = 0xffd6de;
      pulse.scale.set(1.8);
      this.sparkLayer.addChild(pulse);
      await tween(
        ticker,
        360,
        k => {
          if (pulse.destroyed) return;
          const at = this.pointOn(segment, outward ? k : 1 - k);
          pulse.position.set(at.x, at.y);
          pulse.rotation = at.angle;
        },
        easeInOut
      );
      pulse.destroy();
    }
    if (this.gone || node.root.destroyed) return;
    node.halo.alpha = 1;
    this.opts.particles.burst({ x: node.x, y: node.y, n: 22, shape: "spark", colors: [0xff4d6d, 0xff9fb3, 0xfff0f3], velocity: [90, 240], life: [400, 850], scale: [0.5, 1], gravity: 60, friction: 0.9, align: true, light: true });
    this.opts.particles.burst({ x: node.x, y: node.y, n: 1, shape: "ring", colors: [0xff8ea6], velocity: [0, 0], life: [480, 480], scale: [0.4, 0.4], growth: 56, light: true });
    this.shakeAmount = 5;
    playSocket("destructive", 1.2);
    await tween(ticker, 560, k => {
      if (node.root.destroyed) return;
      node.root.scale.set(key(k, [[0, 0.6], [0.45, 1.3], [1, 1]]));
      node.halo.alpha = 1 - 0.65 * k;
    }, easeOut);
  }

  /** Un nodo si è spento: la gemma si stringe e torna scura, due braci che cadono. */
  async dim(id: string): Promise<void> {
    const node = this.nodes.get(id);
    if (!node || this.gone) return;
    this.opts.particles.burst({ x: node.x, y: node.y, n: 8, shape: "dot", colors: [0x9e0f34, 0x3a3037], velocity: [20, 70], life: [400, 700], scale: [0.3, 0.5], gravity: 120, light: false });
    await tween(this.stage.app.ticker, 320, k => !node.root.destroyed && node.root.scale.set(key(k, [[0, 1], [0.4, 0.78], [1, 1]])), easeOut);
  }

  /** I punti nuovi (livelli saliti dall'ultima visita): l'onda dalla carta ai nodi aperti. */
  async reveal(): Promise<void> {
    if (this.gone || !this.card) return;
    const ticker = this.stage.app.ticker;
    this.opts.particles.burst({ x: 0, y: 0, n: 1, shape: "ring", colors: [0xff8ea6], velocity: [0, 0], life: [700, 700], scale: [0.6, 0.6], growth: 140, light: true });
    this.opts.particles.burst({ x: 0, y: -this.cardH * 0.3, n: 30, shape: "spark", colors: [0xff4d6d, 0xff9fb3, 0xfff0f3], velocity: [80, 260], life: [500, 1000], scale: [0.5, 1.1], gravity: 40, friction: 0.9, align: true, light: true });
    this.shakeAmount = 6;
    playSocket("destructive", 1.2);
    const open = [...this.nodes.values()].filter(node => node.state === "open");
    await Promise.all(
      open.map(node =>
        wait((Math.hypot(node.x, node.y) / this.unit) * 90).then(() =>
          tween(ticker, 520, k => {
            if (node.root.destroyed) return;
            node.root.scale.set(key(k, [[0, 1], [0.4, 1.28], [1, 1]]));
            node.halo.alpha = 0.9 * (1 - k);
          }, easeOut)
        )
      )
    );
  }

  // -------------------------------------------------------------- frame
  /** Un frame: camera, hover, respiro dei nodi aperti, inclinazione della carta, scintille, scossa. */
  step(now: number): void {
    const dt = Math.min(64, now - this.lastNow);
    this.lastNow = now;
    const breath = reducedMotion() ? 1 : 0.5 - 0.5 * Math.cos((now / BREATH_MS) * Math.PI * 2);
    this.openGlow.outerStrength = 1 + 2.5 * breath;
    for (const node of this.nodes.values()) {
      if (node.hover.step(now)) node.root.scale.set(node.hover.v);
      if (node.state === "open") node.halo.alpha = 0.15 + 0.35 * breath;
    }
    if (!reducedMotion() && this.card) this.card.rotateTo(0.05 * Math.sin((now / 6000) * Math.PI * 2), 0.09 * Math.cos((now / 7300) * Math.PI * 2));
    for (const spark of this.sparks) {
      spark.t += (dt / SPARK_MS) * Math.max(0.6, 140 / Math.max(1, spark.segment.total));
      if (spark.t >= 1) spark.t -= 1;
      const at = this.pointOn(spark.segment, spark.t);
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

  /** Un punto lungo un tratto (0..1, dalla parte della carta), con l'angolo. */
  private pointOn(segment: Segment, k: number): { x: number; y: number; angle: number } {
    const u = Math.max(0, Math.min(1, k));
    return { x: segment.a.x + (segment.b.x - segment.a.x) * u, y: segment.a.y + (segment.b.y - segment.a.y) * u, angle: Math.atan2(segment.b.y - segment.a.y, segment.b.x - segment.a.x) };
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.gone = true;
    this.stopEmbers();
    // Il livello delle particelle è del proprietario: si sfila prima di distruggere il resto.
    this.view.removeChild(this.opts.particleLayer);
    super.destroy(options);
  }
}
