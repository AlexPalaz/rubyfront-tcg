// La sagoma spezzata delle carte della home (2026-09-24, «non un bordo
// rettangolare ma crepato»): la carta NON è un rettangolo. È una lastra di
// pietra spezzata: lati quasi dritti con poche rotture nette — un morso a V
// o una tacca a gradino, uno o due per lato — e gli angoli tagliati; dentro
// quella sagoma è ritagliata l'illustrazione. Il bordo ha SPESSORE: fuori il
// filo d'ombra, poi il corpo di pietra, dentro il filo di luce del taglio, e
// sull'illustrazione l'ombra del labbro che entra. Il MAGMA sta sotto la
// lastra e si vede solo dove è rotta: dalle rotture filtra la luce di
// rubino, e da lì partono le CREPE che entrano nell'illustrazione. Al
// passaggio la lastra si accende dal di dentro — le rotture brillano, il
// taglio si fa rosa, le crepe si allungano col cuore incandescente, le
// schegge di pietra saltano via dai punti rotti e le braci salgono —, il
// riflesso attraversa l'illustrazione e il filo sotto il titolo si disegna.
// Le carte «in arrivo» hanno la lastra spenta e il nastro diagonale.
//
// La sagoma è geometria (un caso a seme per carta: vertici come frazioni
// lungo i lati con la profondità in pixel) ridisegnata in Graphics quando
// la carta cambia misura: segue l'apertura a fisarmonica senza deformarsi.
// Col movimento ridotto restano solo le cose ferme.

import { BlurFilter, Container, Graphics, Sprite } from "pixi.js";
import { drawText, fontMetrics, textWidth, type Font } from "../card/text";
import { Particles, type Emitter } from "../effects/particles";
import type { Stage } from "../stage";
import { CrispSprite, SANS, linearGradient, paintPiece } from "../table/appearance";
import { bezier, reducedMotion } from "../table/animation";

/** La rottura più profonda che il contorno può fare: i testi stanno più dentro di così. */
export const BITE = 24;
const GROWTH_IDLE = 0.4;
const GROWTH_MS = 620;
const SWEEP_MS = 760;
const RIBBON_FONT: Font = { size: 12, weight: 700, family: SANS, spacing: 12 * 0.24, upper: true };
const RUBY = 0xe0314b;

/** Il colore del magma di una carta (2026-09-24: «oblivhal rosso, multiplayer bianco e decks blu»). */
export type Magma = "ruby" | "white" | "blue";
interface Palette {
  deep: number;
  light: number;
  hot: number;
}
const PALETTES: Record<Magma, Palette> = {
  ruby: { deep: RUBY, light: 0xff6a88, hot: 0xfff1f4 },
  white: { deep: 0xc9d3e6, light: 0xf2f6ff, hot: 0xffffff },
  blue: { deep: 0x2f8cff, light: 0x8ad0ff, hot: 0xeaf7ff },
};
const growthCurve = bezier(0.2, 0.8, 0.2, 1);

/** Il caso a seme (mulberry32): la sagoma di una carta è sempre la stessa. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Edge = "top" | "right" | "bottom" | "left";

/** Un vertice del contorno: su quale lato, a che frazione, quanto dentro (in pixel); `broken` se sta su una rottura (lì filtra il magma). */
interface Vertex {
  edge: Edge;
  f: number;
  d: number;
  broken: boolean;
}

/** Una crepa che entra nella lastra da una rottura: punti «dentro/lungo» rispetto al vertice, con la quota di crescita. */
interface Crack {
  from: Vertex;
  points: { inward: number; along: number; at: number }[];
}

/** Il contorno, in senso orario da in alto a sinistra: lati quasi dritti, poche rotture nette, angoli tagliati. */
function outline(rng: () => number): Vertex[] {
  const out: Vertex[] = [];
  const side = (edge: Edge, long: boolean): void => {
    // L'angolo tagliato: il lato comincia un po' dentro.
    out.push({ edge, f: 0, d: 5 + rng() * 8, broken: true });
    // Le rotture: una o due per lato (due sui lati lunghi), lontane dagli angoli e fra loro.
    const breaks = long ? (rng() < 0.6 ? 2 : 1) : rng() < 0.45 ? 2 : 1;
    const slots = breaks === 2 ? [0.14 + rng() * 0.25, 0.58 + rng() * 0.25] : [0.25 + rng() * 0.5];
    let f = 0.04 + rng() * 0.03;
    // Un vertice appena fuori linea, per dare al lato la sua leggera inclinazione.
    out.push({ edge, f, d: rng() * 2, broken: false });
    for (const at of slots) {
      const depth = 12 + rng() * (BITE - 12);
      const span = long ? 0.045 + rng() * 0.04 : 0.07 + rng() * 0.06;
      if (rng() < 0.5) {
        // Il morso a V.
        out.push({ edge, f: at, d: 1 + rng() * 2, broken: true });
        out.push({ edge, f: at + span * (0.35 + rng() * 0.3), d: depth, broken: true });
        out.push({ edge, f: at + span, d: 1 + rng() * 2, broken: true });
      } else {
        // La tacca a gradino: entra netta, corre, torna.
        out.push({ edge, f: at, d: 1 + rng() * 2, broken: true });
        out.push({ edge, f: at + span * 0.18, d: depth, broken: true });
        out.push({ edge, f: at + span * 0.8, d: depth * (0.55 + rng() * 0.35), broken: true });
        out.push({ edge, f: at + span, d: 1 + rng() * 2, broken: true });
      }
      f = at + span;
    }
    out.push({ edge, f: 0.94 + rng() * 0.03, d: rng() * 2, broken: false });
    out.push({ edge, f: 1, d: 5 + rng() * 8, broken: true });
  };
  side("top", false);
  side("right", true);
  side("bottom", false);
  side("left", true);
  return out;
}

/** Le crepe dalle rotture: una camminata verso dentro, con qualche ramo. */
function cracks(rng: () => number, vertices: Vertex[]): Crack[] {
  const out: Crack[] = [];
  const walk = (inward0: number, along0: number, bias: number, steps: number, reach: number): Crack["points"] => {
    const points: Crack["points"] = [{ inward: inward0, along: along0, at: 0 }];
    let angle = bias;
    let inward = inward0;
    let along = along0;
    for (let i = 0; i < steps; i += 1) {
      angle = Math.max(-1.25, Math.min(1.25, angle + (rng() - 0.5) * 1.3));
      const length = (reach / steps) * (0.6 + rng() * 0.8);
      inward += Math.cos(angle) * length;
      along += Math.sin(angle) * length;
      points.push({ inward, along, at: (i + 1) / steps });
    }
    return points;
  };
  // Dal fondo di ogni rottura (il vertice più profondo di ogni gruppo) parte una crepa.
  let deepest: Vertex | null = null;
  const flush = (): void => {
    if (!deepest || deepest.d < 8) return;
    const reach = 22 + rng() * 40;
    const main = walk(0, 0, (rng() - 0.5) * 1.2, 3 + Math.floor(rng() * 4), reach);
    out.push({ from: deepest, points: main });
    if (rng() < 0.7) {
      const at = main[1 + Math.floor(rng() * (main.length - 2))]!;
      const branch = walk(at.inward, at.along, (rng() < 0.5 ? 1 : -1) * (0.8 + rng() * 0.6), 2 + Math.floor(rng() * 2), reach * 0.5);
      out.push({ from: deepest, points: branch.map(p => ({ ...p, at: at.at + p.at * (1 - at.at) })) });
    }
    deepest = null;
  };
  for (const v of vertices) {
    if (v.broken && v.d >= 8) {
      if (!deepest || v.d > deepest.d) deepest = v;
    } else flush();
  }
  flush();
  return out;
}

/** Un punto in coordinate della carta (w×h): `d` verso dentro, `along` lungo il lato, in senso orario. */
function locate(edge: Edge, f: number, d: number, along: number, w: number, h: number): [number, number] {
  switch (edge) {
    case "top":
      return [f * w + along, d];
    case "right":
      return [w - d, f * h + along];
    case "bottom":
      return [w - f * w - along, h - d];
    default:
      return [d, h - f * h - along];
  }
}

function polygon(vertices: Vertex[], w: number, h: number): number[] {
  const flat: number[] = [];
  for (const v of vertices) {
    const [x, y] = locate(v.edge, v.f, v.d, 0, w, h);
    flat.push(x, y);
  }
  return flat;
}

/** I tratti rotti del contorno (dove filtra il magma): le corse di vertici `broken`, con un vicino per parte. */
function brokenRuns(g: Graphics, vertices: Vertex[], w: number, h: number): void {
  const n = vertices.length;
  let i = 0;
  while (i < n) {
    if (!vertices[i]!.broken) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && vertices[j]!.broken) j += 1;
    const from = (i - 1 + n) % n;
    const to = j % n;
    const run = [from, ...Array.from({ length: j - i }, (_, k) => i + k), to];
    run.forEach((index, k) => {
      const v = vertices[index]!;
      const [x, y] = locate(v.edge, v.f, v.d, 0, w, h);
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    i = j;
  }
}

/** Il tracciato delle crepe fino alla quota di crescita, con l'ultimo tratto interpolato. */
function trace(g: Graphics, lines: Crack[], w: number, h: number, growth: number): void {
  for (const crack of lines) {
    const { from, points } = crack;
    const [x0, y0] = locate(from.edge, from.f, from.d + points[0]!.inward, points[0]!.along, w, h);
    g.moveTo(x0, y0);
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i]!;
      const prev = points[i - 1]!;
      if (p.at <= growth) {
        const [x, y] = locate(from.edge, from.f, from.d + p.inward, p.along, w, h);
        g.lineTo(x, y);
      } else {
        const k = (growth - prev.at) / Math.max(0.0001, p.at - prev.at);
        if (k <= 0) break;
        const [x, y] = locate(from.edge, from.f, from.d + prev.inward + (p.inward - prev.inward) * k, prev.along + (p.along - prev.along) * k, w, h);
        g.lineTo(x, y);
        break;
      }
    }
  }
}

let seedCounter = 1;

export class CardFrame {
  /** La maschera della sagoma: l'illustrazione (e ciò che sta dentro) si ritaglia qui. */
  readonly mask = new Graphics();
  /** Il magma: nel fondo della home, SOTTO le carte, alla posizione della carta. La lastra è incassata: niente ombra portata. */
  readonly ground = new Container({ label: "magma" });
  /** Il riflesso, il nastro, il filo del titolo: sopra il velo, sotto i testi (nel ritaglio). */
  readonly inside = new Container({ label: "inside" });
  /** Il bordo di pietra, le crepe, le schegge e le braci: sopra tutto, sulla carta. */
  readonly frame = new Container({ label: "rim" });
  private readonly vertices: Vertex[];
  private readonly lines: Crack[];
  private readonly glow = new Graphics();
  private readonly rim = new Graphics();
  private readonly fissures = new Graphics();
  private readonly core = new Graphics();
  private readonly fx = new Container({ label: "fx" });
  private readonly sweep: Sprite;
  private sweepAt = -1;
  private readonly ribbon: CrispSprite | null = null;
  private readonly underline = new Graphics();
  private readonly particles: Particles | null;
  private readonly emberArea = { x: 0, y: 0, w: 0, h: 0 };
  private emberId: number | null = null;
  private w = 0;
  private h = 0;
  private open = 0;
  private growth = GROWTH_IDLE;
  private growthFrom = GROWTH_IDLE;
  private growthTo = GROWTH_IDLE;
  private growthAt = 0;
  private drawnGrowth = -1;
  private drawnLit = -1;

  private readonly palette: Palette;

  constructor(
    stage: Stage,
    private readonly off: boolean,
    ribbonText: string,
    magma: Magma = "ruby"
  ) {
    this.palette = PALETTES[magma];
    const res = stage.visible().scale * stage.app.renderer.resolution;
    const rng = seeded(1000 + seedCounter++ * 7919);
    this.vertices = outline(rng);
    this.lines = cracks(rng, this.vertices);
    for (const g of [this.mask, this.glow, this.rim, this.fissures, this.core, this.underline]) g.eventMode = "none";
    this.glow.blendMode = "add";
    // Il magma sfuma con una sfocatura vera (2026-09-24: «il glow va sfumato meglio»), non a strati di tratti.
    if (!off) {
      const blur = new BlurFilter({ strength: 16, quality: 5 });
      // Il margine della sfocatura: senza, l'alone finisce tagliato al rettangolo del disegno.
      blur.padding = 72;
      this.glow.filters = [blur];
    }
    this.core.blendMode = "add";
    this.ground.eventMode = "none";
    this.inside.eventMode = "none";
    this.frame.eventMode = "none";
    this.fx.eventMode = "none";
    this.ground.addChild(this.glow);
    this.frame.addChild(this.rim, this.fissures, this.core, this.fx);
    // Il riflesso che attraversa l'illustrazione: una banda obliqua di luce.
    this.sweep = new Sprite(
      paintPiece(240, 8, 0.5, ctx => {
        ctx.fillStyle = linearGradient(ctx, 90, 0, 0, 240, 8, [
          [0, "rgba(255,255,255,0)"],
          [0.5, "rgba(255,236,240,.5)"],
          [1, "rgba(255,255,255,0)"],
        ]);
        ctx.fillRect(0, 0, 240, 8);
      })
    );
    this.sweep.blendMode = "add";
    this.sweep.visible = false;
    this.sweep.skew.x = -0.42;
    this.sweep.eventMode = "none";
    this.inside.addChild(this.sweep, this.underline);
    if (off) {
      // Il nastro diagonale «In arrivo» all'angolo in alto a destra.
      const ribbonW = 320;
      const ribbonH = 30;
      this.ribbon = new CrispSprite(
        paintPiece(ribbonW, ribbonH, res, ctx => {
          ctx.fillStyle = "rgba(11,9,12,.94)";
          ctx.fillRect(0, 0, ribbonW, ribbonH);
          ctx.fillStyle = "rgba(255,255,255,.06)";
          ctx.fillRect(0, 1, ribbonW, 1);
          ctx.strokeStyle = "#7a1030";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, 3.5);
          ctx.lineTo(ribbonW, 3.5);
          ctx.moveTo(0, ribbonH - 3.5);
          ctx.lineTo(ribbonW, ribbonH - 3.5);
          ctx.stroke();
          const m = fontMetrics(RIBBON_FONT);
          drawText(ctx, { kind: "text", text: ribbonText, font: RIBBON_FONT, color: "rgba(243,237,240,.8)" }, (ribbonW - textWidth(RIBBON_FONT, ribbonText)) / 2, (ribbonH + m.ascent - m.descent) / 2);
        })
      );
      this.ribbon.anchor.set(0.5);
      this.ribbon.rotation = Math.PI / 4;
      this.ribbon.eventMode = "none";
      this.inside.addChild(this.ribbon);
      this.particles = null;
    } else {
      this.particles = new Particles(stage, this.fx);
    }
  }

  /** La geometria della carta e quanto è aperta (`open` 0..1 la larghezza, `k` il contenuto scoperto). Ridisegna la sagoma. */
  place(w: number, h: number, open: number, k: number): void {
    const moved = w !== this.w || h !== this.h;
    this.w = w;
    this.h = h;
    this.open = this.off ? 0 : open;
    const target = this.off || reducedMotion() ? GROWTH_IDLE : k > 0.02 ? 1 : GROWTH_IDLE;
    if (target !== this.growthTo) {
      this.growthFrom = this.growth;
      this.growthTo = target;
      this.growthAt = performance.now();
    }
    if (moved) {
      this.drawnGrowth = -1;
      const poly = polygon(this.vertices, w, h);
      this.mask.clear().poly(poly).fill(0xffffff);
    }
    this.redraw(performance.now());
    if (this.ribbon) this.ribbon.position.set(w - 62, 62);
    this.sweep.height = h * 1.6;
    // Le braci salgono dalle rotture in basso, davanti alla carta.
    this.emberArea.x = 8;
    this.emberArea.y = h - BITE;
    this.emberArea.w = Math.max(1, w - 16);
    this.emberArea.h = BITE;
    const particles = this.particles;
    if (particles && !reducedMotion()) {
      if (k > 0.4 && this.emberId === null) this.emberId = particles.emitter(this.emberEmitter());
      if (k <= 0.4 && this.emberId !== null) {
        particles.stop(this.emberId);
        this.emberId = null;
      }
    }
  }

  /** La lastra nera sotto l'illustrazione, nella sagoma: la disegna nel Graphics della carta. */
  fillSlab(slab: Graphics): void {
    slab.clear().poly(polygon(this.vertices, this.w, this.h)).fill(0x0b090c);
  }

  /** Il filo sotto il titolo, che si disegna con l'apertura: da (x, y) verso destra. */
  underlineAt(x: number, y: number, k: number): void {
    this.underline.clear();
    if (this.off || k <= 0.01) return;
    const length = 54 * k;
    this.underline.rect(x, y, length, 2).fill({ color: this.palette.deep, alpha: 0.95 });
    this.underline.rect(x + length, y, 26, 1).fill({ color: this.palette.deep, alpha: 0.35 * k });
  }

  /** All'apertura: il riflesso attraversa l'illustrazione e le schegge di pietra saltano via dalle rotture, con le scintille. */
  shine(): void {
    if (reducedMotion()) return;
    this.sweepAt = performance.now();
    const particles = this.particles;
    if (!particles) return;
    for (const v of this.vertices) {
      if (!v.broken || v.d < 8) continue;
      const [x, y] = locate(v.edge, v.f, v.d, 0, this.w, this.h);
      // Verso fuori dal lato: la normale del lato.
      const normal = v.edge === "top" ? -Math.PI / 2 : v.edge === "bottom" ? Math.PI / 2 : v.edge === "left" ? Math.PI : 0;
      particles.burst({ x, y, n: 4, shape: "ash", colors: [0x1a1418, 0x2b2429, 0x3a3037], velocity: [40, 120], angle: [normal - 0.9, normal + 0.9], life: [500, 900], scale: [0.08, 0.18], gravity: 260, friction: 0.4, spin: [-6, 6], light: false });
      particles.burst({ x, y, n: 5, shape: "spark", colors: [this.palette.deep, this.palette.light, this.palette.hot], velocity: [60, 180], angle: [normal - 0.7, normal + 0.7], life: [300, 600], scale: [0.1, 0.22], gravity: 120, align: true, light: true });
    }
  }

  /** Un frame: le crepe che crescono, il magma che pulsa, il riflesso in viaggio. */
  tick(now: number, _k: number): void {
    this.redraw(now);
    if (this.off || this.sweepAt < 0) return;
    const p = (now - this.sweepAt) / SWEEP_MS;
    if (p >= 1) {
      this.sweep.visible = false;
      this.sweepAt = -1;
    } else {
      this.sweep.visible = true;
      this.sweep.position.set(-240 + (this.w + 480) * p, -this.h * 0.3);
      this.sweep.alpha = 0.9 * Math.sin(p * Math.PI);
    }
  }

  /** Ridisegna bordo, magma e crepe solo quando qualcosa è cambiato: la crescita, la luce, la misura. */
  private redraw(now: number): void {
    const still = reducedMotion();
    const p = still ? 1 : Math.min(1, (now - this.growthAt) / GROWTH_MS);
    this.growth = this.growthFrom + (this.growthTo - this.growthFrom) * growthCurve(p);
    const pulse = still ? 1 : 0.86 + 0.14 * Math.sin(now / 480);
    const lit = this.off ? 0 : Math.round(this.open * pulse * 40) / 40;
    if (this.growth === this.drawnGrowth && lit === this.drawnLit) return;
    this.drawnGrowth = this.growth;
    this.drawnLit = lit;
    const { w, h, off, lines, growth, vertices } = this;
    const poly = polygon(vertices, w, h);
    // Il magma: filtra dalle rotture (largo e tenue, poi vivo); acceso, un filo di luce corre anche lungo tutto il contorno.
    const glow = this.glow.clear();
    if (!off) {
      // Sotto la sfocatura: dalle rotture un tratto pieno (più vivo al centro), acceso anche lungo tutta la sagoma.
      const { deep, light } = this.palette;
      const base = 0.45 + 0.55 * lit;
      brokenRuns(glow, vertices, w, h);
      glow.stroke({ color: deep, width: 22, alpha: 0.55 * base, cap: "round", join: "round" });
      brokenRuns(glow, vertices, w, h);
      glow.stroke({ color: light, width: 8, alpha: 0.7 * base, cap: "round", join: "round" });
      if (lit > 0.02) {
        glow.poly(poly).stroke({ color: deep, width: 18, alpha: 0.5 * lit, join: "round" });
        glow.poly(poly).stroke({ color: light, width: 6, alpha: 0.45 * lit, join: "round" });
      }
    }
    // Niente bordo disegnato (2026-09-24: «non vorrei che si veda come un bordo rosso»): il taglio lo dice l'illustrazione
    // che finisce, con un filo di luce appena percettibile; acceso, è il magma sotto a definirlo, morbido.
    const rim = this.rim.clear();
    rim.poly(poly).stroke({ color: off ? 0x8a8090 : this.palette.hot, width: 1, alpha: off ? 0.18 : 0.1 + 0.2 * lit, alignment: 1, join: "miter" });
    // Le crepe dalle rotture verso dentro: il solco scuro col suo filo di luce sull'illustrazione, e il cuore incandescente.
    const fissures = this.fissures.clear();
    trace(fissures, lines, w, h, growth);
    fissures.stroke({ color: 0xffffff, width: 2.6, alpha: off ? 0.05 : 0.09, cap: "round", join: "round" });
    trace(fissures, lines, w, h, growth);
    fissures.stroke({ color: 0x050405, width: off ? 1.4 : 1.8, alpha: off ? 0.7 : 0.8, cap: "round", join: "round" });
    const core = this.core.clear();
    if (!off) {
      trace(core, lines, w, h, growth);
      core.stroke({ color: this.palette.light, width: 2.4, alpha: 0.14 + 0.32 * lit, cap: "round", join: "round" });
      trace(core, lines, w, h, growth);
      core.stroke({ color: this.palette.hot, width: 0.9, alpha: 0.22 + 0.7 * lit, cap: "round", join: "round" });
    }
  }

  private emberEmitter(): Emitter {
    return {
      area: this.emberArea,
      perSecond: 12,
      burst: {
        shape: "dot",
        colors: [this.palette.deep, this.palette.light, this.palette.hot],
        velocity: [20, 56],
        angle: [-Math.PI / 2 - 0.4, -Math.PI / 2 + 0.4],
        life: [1400, 2800],
        scale: [0.05, 0.14],
        sway: 12,
        growth: 0.8,
        light: true,
      },
    };
  }
}
