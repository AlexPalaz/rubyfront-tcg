// Una carta sul tavolo: la faccia dipinta (src/card/, dalla cache) o il
// dorso, coricata se tappata, col filo e l'ombra, e — sul campo — i
// distintivi a corpo fisso del simulatore (costo, Potenza ATTUALE,
// Contrattacco, parole chiave), l'anello e il numero d'ondata di chi
// attacca, l'anello di chi blocca o contrattacca.
//
// Il contenitore ha l'origine al centro della carta: la rotazione della
// tappata gira attorno a lì, come nel simulatore.

import { ColorMatrixFilter, Container, Graphics, Rectangle, Sprite, Texture, Ticker, type Filter, type Renderer } from "pixi.js";
import { faceTexture } from "../card/cache";
import { SERIF } from "../card/theme";
import { applyFont, drawText, textWidth, type Font } from "../card/text";
import { bezier, reducedMotion, tween } from "./animation";
import { THEME, paintPiece, withShadow } from "./appearance";

/** Un segno di ciò che la carta ha in più rispetto allo stampato (§8.2): la colonna sotto la Potenza. */
export type Mark =
  | { kind: "power"; delta: number }
  | { kind: "counter"; extra: number }
  | { kind: "grant"; keyword: string }
  | { kind: "noblock"; text: string };

export interface Badges {
  /** Il costo stampato («2», il dado «6»). */
  cost: { text: string; die: boolean } | null;
  /** La Potenza attuale (stampata + bonus + statici, core/combat powerOf). */
  power: number | null;
  /** Il Contrattacco stampato e quello in più. */
  counter: number | null;
  /** Le parole chiave stampate (surge, stasis, revenge, fury). */
  keywords: string[];
  /** I segni, in colonna sotto la Potenza (e sotto il Contrattacco, se c'è). */
  marks: Mark[];
}

export interface CardLook {
  cardId: string;
  face: number;
  /** Il dorso al posto della faccia (coperta, o il mazzo). */
  back: boolean;
  tapped: boolean;
  /** Il ritardo della rotazione quando più carte si tappano o stappano insieme (la stappata del cambio turno): girano in fila. */
  tapDelay?: number;
  w: number;
  h: number;
  locale: string;
  /** Pixel del dispositivo per unità di progetto. */
  resolution: number;
  /** I distintivi (solo sul campo, scoperta). */
  badges: Badges | null;
  /** In combattimento: l'attacco col suo numero d'ondata, il blocco, il contrattacco. */
  combat: { kind: "attack"; order: number } | { kind: "block" } | { kind: "counter" } | null;
  /** L'anello del momento (ANELLI): prende il posto dell'ombra, come il box-shadow della tessera. */
  ring?: Ring | null;
  /** L'opacità: le carte che la mira non può scegliere si spengono. */
  alpha?: number;
  /** Velata (.is-unaffordable): la carta in mano che non ti puoi permettere, o quella che una scelta non prende. */
  veiled?: boolean;
}

/**
 * Gli anelli del momento (style.css): la fonte che si innesca (is-triggering),
 * la carta colpita (is-struck), il bersaglio valido della mira (is-legal) e
 * quello sceglibile ma sconsigliato (is-pickable), l'Entità che riceverebbe
 * l'Oggetto trascinato (is-assign-target), la carta con un gesto disponibile
 * (has-actions: nel simulatore respira, qui è fermo fino a F5), la Reattiva
 * in catena (.is-chained: oro dentro, rubino fuori, la luce della catena).
 * Nella mira il bersaglio valido respira di verde e quello sotto il
 * puntatore (aimed) si accende pieno: si vede cosa si può scegliere, e cosa
 * si sta per scegliere.
 * Colori del tema notte (il rubino dei posti è #ff4d6d, il verde --ok #6fbf8b).
 */
export type Ring = "trigger" | "struck" | "legal" | "aimed" | "pickable" | "assign" | "gestures" | "chain";

/** Il tap e lo stap (§6.3): la carta si alza appena, gira con un filo di slancio e si posa. */
const TAP_MS = 340;
const TAP_CURVE = bezier(0.34, 1.4, 0.64, 1);

export class TableCard extends Container {
  private readonly shadow = new Sprite();
  private readonly glow = new Sprite();
  /** Il respiro dell'anello dei gesti (has-actions::after): un velo interno che va e viene. */
  private readonly breath = new Graphics();
  private prevRing: Ring | null = null;
  /** Tappata secondo l'ultimo aspetto (null prima del primo disegno): la rotazione può essere ancora a metà corsa. */
  private tappedNow: boolean | null = null;
  private tapRun = 0;
  /** L'opacità chiesta dall'ultimo aspetto (la mira spegne le carte che non si scelgono). */
  private lookAlpha = 1;
  /** Nascosta sotto la sua copia sollevata (effects/hover.ts): trasparente ma sensibile — tocco, presa e menu restano suoi. */
  private ghost = false;
  private readonly face = new Sprite();
  /** Un filtro di luce sulla sola faccia (il foil delle Uniche, effects/director.ts), accanto alla velatura. */
  private sheen: Filter | null = null;
  private readonly veil = new Graphics();
  private readonly overlay = new Sprite();
  private faceKey = "";
  private overlayKey = "";
  private shadowKey = "";
  private glowKey = "";
  /** L'ultima faccia chiesta alla cache: se nel frattempo ne arriva un'altra, la vecchia si scarta. */
  private request = 0;
  /** La faccia è pronta (per chi aspetta il tavolo intero). */
  ready: Promise<void> = Promise.resolve();

  /** L'uid della carta (CardInstance.uid): `uid` è già di Pixi, un numero suo. */
  constructor(readonly cardUid: string) {
    super({ label: cardUid });
    this.glow.visible = false;
    this.veil.visible = false;
    this.breath.visible = false;
    this.breath.eventMode = "none";
    this.addChild(this.shadow, this.glow, this.face, this.veil, this.breath, this.overlay);
    this.on("destroyed", () => breathers.delete(this));
  }

  /**
   * La carta com'è ora, senza la sua ombra, in una texture centrata sulla sua
   * origine (il tilt al passaggio, effects/hover.ts: la copia in prospettiva e
   * la maschera del riflesso girano attorno allo stesso centro). La
   * rotazione della tappata non c'è: la aggiunge chi la usa.
   */
  snapshot(renderer: Renderer, resolution: number): { texture: Texture; w: number; h: number } {
    const shadowShown = this.shadow.visible;
    const alpha = this.alpha;
    this.shadow.visible = false;
    this.alpha = this.lookAlpha;
    const bounds = this.getLocalBounds();
    const halfW = Math.ceil(Math.max(-bounds.x, bounds.x + bounds.width));
    const halfH = Math.ceil(Math.max(-bounds.y, bounds.y + bounds.height));
    const texture = renderer.generateTexture({ target: this, frame: new Rectangle(-halfW, -halfH, halfW * 2, halfH * 2), resolution });
    this.shadow.visible = shadowShown;
    this.alpha = alpha;
    return { texture, w: halfW * 2, h: halfH * 2 };
  }

  /** Sotto la copia sollevata del passaggio: invisibile, ma il puntatore la trova ancora (renderable=false la toglierebbe dal tocco). */
  setGhost(on: boolean): void {
    this.ghost = on;
    this.alpha = on ? 0 : this.lookAlpha;
  }

  /** Tappata o no, anche mentre sta ancora girando. */
  get isTapped(): boolean {
    return this.tappedNow === true;
  }

  /** Il respiro dell'anello dei gesti e del bersaglio della mira, dall'orologio comune: col bersaglio respira anche l'alone. */
  breathe(alpha: number): void {
    this.breath.alpha = alpha;
    if (this.prevRing === "legal") this.glow.alpha = 0.55 + 0.45 * alpha;
  }

  /** Il lampo d'ingresso di un anello: l'alone sale e si posa. */
  private flash(ms: number): void {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    const tick = (): void => {
      if (this.destroyed) {
        Ticker.shared.remove(tick);
        return;
      }
      const k = Math.min(1, (performance.now() - start) / ms);
      // Sale a metà corsa (60% per l'innesco, 35% per il colpo) e si posa.
      const peak = ms > 450 ? 0.6 : 0.35;
      const up = k < peak ? k / peak : 1 - (k - peak) / (1 - peak);
      this.glow.scale.set(1 + 0.04 * up);
      this.glow.alpha = 0.75 + 0.25 * up;
      if (k >= 1) {
        this.glow.scale.set(1);
        this.glow.alpha = 1;
        Ticker.shared.remove(tick);
      }
    };
    Ticker.shared.add(tick);
  }

  /**
   * La rotazione della tappata: al primo disegno di colpo (una carta che
   * compare già coricata non gira), poi con la corsa — si alza del 6%, gira
   * oltre il segno e ci torna, si posa. Un nuovo tap a metà corsa riparte
   * da dove la carta è arrivata.
   */
  private turnTo(tapped: boolean, delay: number): void {
    if (this.tappedNow === tapped) return;
    const first = this.tappedNow === null;
    this.tappedNow = tapped;
    const run = ++this.tapRun;
    const target = tapped ? Math.PI / 2 : 0;
    if (first || reducedMotion()) {
      this.rotation = target;
      this.scale.set(1);
      return;
    }
    const start = (): void => {
      if (run !== this.tapRun || this.destroyed) return;
      const from = this.rotation;
      void tween(Ticker.shared, TAP_MS, k => {
        if (run !== this.tapRun || this.destroyed) return;
        this.rotation = from + (target - from) * TAP_CURVE(k);
        this.scale.set(1 + 0.06 * Math.sin(Math.PI * Math.min(1, k * 1.2)));
      }).then(() => {
        if (run !== this.tapRun || this.destroyed) return;
        this.rotation = target;
        this.scale.set(1);
      });
    };
    if (delay > 0) setTimeout(start, delay);
    else start();
  }

  /** La luce sulla faccia (il foil): la stessa istanza per tutte le Uniche, che scorre col tempo. */
  setSheen(filter: Filter | null): void {
    if (this.sheen === filter) return;
    this.sheen = filter;
    this.applyFaceFilters();
  }

  private applyFaceFilters(): void {
    this.face.filters = [...(this.veil.visible ? [veilFilter()] : []), ...(this.sheen ? [this.sheen] : [])];
  }

  update(look: CardLook): void {
    const { w, h } = look;
    this.turnTo(look.tapped, look.tapDelay ?? 0);
    // Si tocca la carta, non la sua ombra: l'area è la carta sola (ruota con lei).
    this.eventMode = "static";
    this.hitArea = new Rectangle(-w / 2, -h / 2, w, h);

    // L'ombra e il filo, dietro la carta (box-shadow del .tile).
    const nextShadowKey = `${w.toFixed(1)}|${h.toFixed(1)}|${look.resolution.toFixed(2)}`;
    if (nextShadowKey !== this.shadowKey) {
      this.shadowKey = nextShadowKey;
      this.shadow.texture = shadowOf(w, h, look.resolution);
      this.shadow.position.set(-w / 2 - SHADOW_MARGIN, -h / 2 - SHADOW_MARGIN);
    }

    // L'anello del momento, al posto dell'ombra.
    const ring = look.ring ?? null;
    this.shadow.visible = ring === null;
    const keyAlone = ring ? `${ring}|${nextShadowKey}` : "";
    if (keyAlone !== this.glowKey) {
      this.glowKey = keyAlone;
      this.glow.visible = ring !== null;
      if (ring) {
        this.glow.texture = glowOf(ring, w, h, look.resolution);
        this.glow.position.set(-w / 2 - GLOW_MARGIN, -h / 2 - GLOW_MARGIN);
      }
    }
    this.lookAlpha = look.alpha ?? 1;
    this.alpha = this.ghost ? 0 : this.lookAlpha;
    // Il respiro: sull'anello dei gesti (rubino) e sul bersaglio della mira
    // (verde), a tempo con tutte le altre (un orologio solo).
    const breathes = ring === "gestures" || ring === "legal";
    this.breath.visible = breathes;
    if (ring !== "legal") this.glow.alpha = 1;
    if (breathes) {
      const color = ring === "legal" ? 0x6fbf8b : 0xe0314b;
      this.breath.clear()
        .rect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2).stroke({ color, width: 2, alpha: 1 })
        .rect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8).stroke({ color, width: 6, alpha: 0.28 })
        .rect(-w / 2 + 9, -h / 2 + 9, w - 18, h - 18).stroke({ color, width: 6, alpha: 0.1 });
      breathers.add(this);
      startBreathing();
    } else breathers.delete(this);
    // La fonte che si innesca e la carta colpita partono con un lampo (tile-trigger, tile-struck).
    if (ring !== this.prevRing && (ring === "trigger" || ring === "struck")) this.flash(ring === "struck" ? 420 : 500);
    this.prevRing = ring;
    const veiled = look.veiled ?? false;
    if (veiled !== this.veil.visible) {
      this.veil.visible = veiled;
      this.applyFaceFilters();
    }
    if (veiled) this.veil.clear().rect(-w / 2, -h / 2, w, h).fill({ color: 0x05040a, alpha: 0.55 });

    // La faccia o il dorso.
    const nextFaceKey = look.back ? `dorso|${nextShadowKey}` : `${look.cardId}|${look.face}|${look.locale}|${nextShadowKey}`;
    if (nextFaceKey !== this.faceKey) {
      this.faceKey = nextFaceKey;
      this.face.position.set(-w / 2, -h / 2);
      if (look.back) {
        this.face.texture = backOf(w, h, look.resolution);
        this.face.width = w;
        this.face.height = h;
        this.ready = Promise.resolve();
      } else {
        const ticket = ++this.request;
        this.face.texture = Texture.WHITE;
        this.face.width = w;
        this.face.height = h;
        this.ready = faceTexture(look.cardId, look.face, look.locale, (w / 520) * look.resolution).then(texture => {
          if (ticket !== this.request || !texture) return;
          this.face.texture = texture;
          this.face.width = w;
          this.face.height = h;
        });
      }
    }

    // I distintivi e i segni del combattimento, in uno strato dipinto sopra.
    const nextOverlayKey = JSON.stringify([nextShadowKey, look.badges, look.combat]);
    if (nextOverlayKey !== this.overlayKey) {
      this.overlayKey = nextOverlayKey;
      const margin = SHADOW_MARGIN;
      this.overlay.texture = aboveOf(look, margin);
      this.overlay.position.set(-w / 2 - margin, -h / 2 - margin);
    }
  }
}

// ------------------------------------------------------------------ l'ombra

const SHADOW_MARGIN = 34;
const shadows = new Map<string, Texture>();

/** Il filo scuro di 1px e l'ombra sotto (0 8px 22px), fuori dalla carta. */
function shadowOf(w: number, h: number, resolution: number): Texture {
  const key = `${w.toFixed(1)}|${h.toFixed(1)}|${resolution.toFixed(2)}`;
  let texture = shadows.get(key);
  if (!texture) {
    texture = paintPiece(w + 2 * SHADOW_MARGIN, h + 2 * SHADOW_MARGIN, resolution, ctx => {
      const x = SHADOW_MARGIN;
      const y = SHADOW_MARGIN;
      ctx.save();
      ctx.shadowColor = THEME.cardShadow;
      ctx.shadowBlur = 22 * resolution;
      ctx.shadowOffsetY = 8 * resolution;
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      ctx.strokeStyle = THEME.cardRing;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    });
    shadows.set(key, texture);
  }
  return texture;
}

// ------------------------------------------------------------------ il respiro

/** Le carte con l'anello dei gesti: respirano insieme, opacità .35 ↔ 1 in 2,2 s (has-actions-breathe). */
const breathers = new Set<TableCard>();
let breathingStarted = false;

function startBreathing(): void {
  if (breathingStarted) return;
  breathingStarted = true;
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  Ticker.shared.add(() => {
    const phase = (performance.now() % 2200) / 2200;
    const alpha = reduced ? 1 : 0.35 + 0.65 * (0.5 - 0.5 * Math.cos(phase * 2 * Math.PI));
    for (const card of breathers) card.breathe(alpha);
  });
}

// ---------------------------------------------------------------- la velatura

let sharedVeil: ColorMatrixFilter | null = null;

/**
 * filter: grayscale(.55) brightness(.85) (.is-unaffordable), come matrice di
 * colore: la stessa per tutte le carte velate. Sopra, il velo scuro
 * (--tile-veil del tema notte, rgba(5,4,10,.55)).
 */
export function veilFilter(): ColorMatrixFilter {
  if (sharedVeil) return sharedVeil;
  const g = 1 - 0.55;
  const b = 0.85;
  sharedVeil = new ColorMatrixFilter();
  sharedVeil.matrix = [
    (0.2126 + 0.7874 * g) * b, (0.7152 - 0.7152 * g) * b, (0.0722 - 0.0722 * g) * b, 0, 0,
    (0.2126 - 0.2126 * g) * b, (0.7152 + 0.2848 * g) * b, (0.0722 - 0.0722 * g) * b, 0, 0,
    (0.2126 - 0.2126 * g) * b, (0.7152 - 0.7152 * g) * b, (0.0722 + 0.9278 * g) * b, 0, 0,
    0, 0, 0, 1, 0,
  ];
  return sharedVeil;
}

// ------------------------------------------------------------------ gli anelli

const GLOW_MARGIN = 80;
const glowCache = new Map<string, Texture>();

/** Ogni anello: il filo pieno attorno alla carta (lo spread) e i suoi aloni, dal primo del box-shadow in giù. */
const RINGS: Record<Ring, { spread: number; ring: string; inner?: { spread: number; color: string }; glows: { x: number; y: number; blur: number; color: string }[] }> = {
  trigger: { spread: 2, ring: "#ff8ea6", glows: [{ x: 0, y: 0, blur: 46, color: "rgba(210,74,100,1)" }] },
  struck: { spread: 3, ring: "#a62640", glows: [{ x: 0, y: 0, blur: 46, color: "rgba(166,38,64,.95)" }] },
  legal: {
    spread: 3,
    ring: "#8fe0a8",
    glows: [
      { x: 0, y: 0, blur: 14, color: "rgba(170,240,195,.7)" },
      { x: 0, y: 0, blur: 44, color: "rgba(111,191,139,.85)" },
    ],
  },
  aimed: {
    spread: 4,
    ring: "#d6ffe2",
    inner: { spread: 2, color: "#6fbf8b" },
    glows: [
      { x: 0, y: 0, blur: 20, color: "rgba(200,255,220,.9)" },
      { x: 0, y: 0, blur: 60, color: "rgba(120,230,160,1)" },
    ],
  },
  pickable: { spread: 2, ring: "rgba(153,141,144,.55)", glows: [{ x: 0, y: 8, blur: 22, color: "rgba(0,0,0,.6)" }] },
  gestures: { spread: 2, ring: "rgba(224,49,75,.9)", glows: [{ x: 0, y: 8, blur: 22, color: "rgba(0,0,0,.6)" }] },
  chain: {
    spread: 4,
    ring: "rgba(210,74,100,.9)",
    inner: { spread: 2, color: "#ffcf7a" },
    glows: [
      { x: 0, y: 0, blur: 42, color: "rgba(255,176,96,.75)" },
      { x: 0, y: 10, blur: 26, color: "rgba(0,0,0,.7)" },
    ],
  },
  assign: {
    spread: 3,
    ring: "#ff4d6d",
    glows: [
      { x: 0, y: 0, blur: 26, color: "rgba(210,74,100,.6)" },
      { x: 0, y: 8, blur: 22, color: "rgba(0,0,0,.6)" },
    ],
  },
};

function glowOf(ringKind: Ring, w: number, h: number, resolution: number): Texture {
  const key = `${ringKind}|${w.toFixed(1)}|${h.toFixed(1)}|${resolution.toFixed(2)}`;
  let texture = glowCache.get(key);
  if (!texture) {
    const { spread, ring, inner, glows } = RINGS[ringKind];
    texture = paintPiece(w + 2 * GLOW_MARGIN, h + 2 * GLOW_MARGIN, resolution, ctx => {
      ctx.translate(GLOW_MARGIN, GLOW_MARGIN);
      // Il primo alone della lista sta sopra: si dipingono dal fondo. Il
      // riquadro pieno sotto la carta non si vede, la faccia lo copre.
      for (const glow of [...glows].reverse()) {
        withShadow(ctx, resolution, glow, () => {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, w, h);
        });
      }
      ctx.fillStyle = ring;
      ctx.fillRect(-spread, -spread, w + 2 * spread, h + 2 * spread);
      // Il filo interno sta sopra quello esterno (il primo box-shadow è in cima).
      if (inner) {
        ctx.fillStyle = inner.color;
        ctx.fillRect(-inner.spread, -inner.spread, w + 2 * inner.spread, h + 2 * inner.spread);
      }
    });
    glowCache.set(key, texture);
  }
  return texture;
}

// ------------------------------------------------------------------- il dorso

const backs = new Map<string, Texture>();

/**
 * Il dorso (cardview.ts, cardBack; style.css, .card-back): righe diagonali
 * scure a 45°, e al centro — al 62% — la cornice, il rombo e il cerchio in
 * rubino cupo.
 */
function backOf(w: number, h: number, resolution: number): Texture {
  const key = `${w.toFixed(1)}|${h.toFixed(1)}|${resolution.toFixed(2)}`;
  let texture = backs.get(key);
  if (!texture) {
    texture = paintPiece(w, h, resolution, ctx => {
      ctx.fillStyle = "#150d10";
      ctx.fillRect(0, 0, w, h);
      // repeating-linear-gradient(45deg, #1a1013 0 8px, #150d10 8px 16px)
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      ctx.fillStyle = "#1a1013";
      const period = 16 * Math.SQRT2;
      for (let d = -h; d < w + h; d += period) {
        ctx.beginPath();
        ctx.moveTo(d, h);
        ctx.lineTo(d + 8 * Math.SQRT2, h);
        ctx.lineTo(d + 8 * Math.SQRT2 + h, 0);
        ctx.lineTo(d + h, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = THEME.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      // Il disegno: viewBox 100×140, al 62% della carta, centrato.
      const scale = Math.min((w * 0.62) / 100, (h * 0.62) / 140);
      ctx.save();
      ctx.translate((w - 100 * scale) / 2, (h - 140 * scale) / 2);
      ctx.scale(scale, scale);
      ctx.strokeStyle = THEME.rubyDeep;
      ctx.lineWidth = 1;
      const frame = new Path2D();
      frame.roundRect(6, 6, 88, 128, 3);
      ctx.stroke(frame);
      ctx.lineWidth = 1.5;
      ctx.stroke(new Path2D("M50 30 L70 70 L50 110 L30 70 Z"));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(50, 70, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });
    backs.set(key, texture);
  }
  return texture;
}

// ------------------------------------------------------------- i distintivi

const CHIP_H = 30;
const chipFont = (size: number): Font => ({ size, weight: 700, family: SERIF });

const KEY_ICON: Record<string, string[]> = {
  surge: ["M13 2 5 14h6l-1 8 8-12h-6z"],
  stasis: ["M7 4h3v16H7zM14 4h3v16h-3z"],
  revenge: ["M12 3 5 6v6c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6z", "m8.5 15.5 7-7"],
  fury: ["M12 2c1 4 6 6 6 11a6 6 0 0 1-12 0c0-2 1-4 2.5-5 0 2 1 3 2.5 3 1-3-1-6 1-9z"],
};

/** Lo strato sopra la carta: distintivi, anello, numero d'ondata (style.css, .tess-*, .combat-badge, .is-attacking). */
function aboveOf(look: CardLook, margin: number): Texture {
  const { w, h } = look;
  return paintPiece(w + 2 * margin, h + 2 * margin, look.resolution, ctx => {
    ctx.translate(margin, margin);

    // L'anello del combattimento: l'attacco rubino con l'alone, il blocco
    // nel colore dell'avversario, il contrattacco oro.
    const combat = look.combat;
    if (combat?.kind === "attack") {
      ctx.save();
      ctx.shadowColor = "rgba(210,74,100,.75)";
      ctx.shadowBlur = 30 * look.resolution;
      ctx.strokeStyle = THEME.ruby;
      ctx.lineWidth = 3;
      ctx.strokeRect(-1.5, -1.5, w + 3, h + 3);
      ctx.restore();
      // L'anello interno (respira nel simulatore: qui fermo).
      ctx.save();
      ctx.strokeStyle = "rgba(210,74,100,.9)";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);
      ctx.restore();
    } else if (combat?.kind === "block" || combat?.kind === "counter") {
      ctx.strokeStyle = combat.kind === "block" ? THEME.foe : THEME.gold;
      ctx.lineWidth = 2;
      ctx.strokeRect(-1, -1, w + 2, h + 2);
    }

    const badges = look.badges;
    if (badges) {
      const chip = (x: number, y: number, width: number, fill: string, frame: string, dashed = false): void => {
        ctx.save();
        ctx.shadowColor = THEME.badge.shadow;
        ctx.shadowBlur = 8 * look.resolution;
        ctx.shadowOffsetY = 2 * look.resolution;
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, width, CHIP_H);
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = frame;
        ctx.lineWidth = 1;
        if (dashed) ctx.setLineDash([3, 3]);
        ctx.strokeRect(x + 0.5, y + 0.5, width - 1, CHIP_H - 1);
        ctx.restore();
      };
      const number = (text: string, x: number, y: number, color: string, size = 17): void => {
        const font = chipFont(size);
        applyFont(ctx, font);
        drawText(ctx, { kind: "text", text, font, color }, x, y + CHIP_H / 2 + size * 0.36);
      };

      // Il costo, in alto a sinistra: rubino cupo, tratteggiato se a dado.
      if (badges.cost) {
        const width = Math.max(CHIP_H, 16 + textWidth(chipFont(17), badges.cost.text));
        chip(6, 6, width, THEME.rubyDeep, "rgba(255,255,255,.25)", badges.cost.die);
        number(badges.cost.text, 6 + (width - textWidth(chipFont(17), badges.cost.text)) / 2, 6, "#fdeef1");
      }
      // La Potenza attuale, in alto a destra, con le spade.
      if (badges.power !== null) {
        const text = String(badges.power);
        const width = 16 + 14 + 4 + textWidth(chipFont(17), text);
        const x = w - 6 - width;
        chip(x, 6, width, THEME.badge.background, THEME.badge.frame);
        swords(ctx, x + 8, 6 + (CHIP_H - 14) / 2, 14, THEME.badge.ruby);
        number(text, x + 8 + 14 + 4, 6, THEME.badge.ink);
      }
      // Il Contrattacco, sotto la Potenza, in oro.
      if (badges.counter !== null) {
        const text = `+${badges.counter}`;
        const width = 16 + 15 + 4 + textWidth(chipFont(17), text);
        const x = w - 6 - width;
        chip(x, 42, width, THEME.badge.background, THEME.badge.frame);
        arrow(ctx, x + 8, 42 + (CHIP_H - 15) / 2, 15, THEME.gold);
        number(text, x + 8 + 15 + 4, 42, THEME.gold);
      }
      // I segni (table.ts, markMarks): lo scarto di Potenza in grigio, il
      // Contrattacco in più in oro, le parole chiave concesse, «Non blocca».
      let markY = badges.counter !== null ? 78 : 42;
      for (const mark of badges.marks) {
        if (mark.kind === "power") {
          const text = mark.delta > 0 ? `+${mark.delta}` : `−${-mark.delta}`;
          const width = 16 + 14 + 4 + textWidth(chipFont(17), text);
          const x = w - 6 - width;
          // Lo scarto di Potenza: spento, in grigio (.power-delta, --tess-grey).
          chip(x, markY, width, THEME.badge.background, "rgba(185,180,183,.45)");
          swords(ctx, x + 8, markY + (CHIP_H - 14) / 2, 14, THEME.badge.grey);
          number(text, x + 8 + 14 + 4, markY, THEME.badge.grey);
        } else if (mark.kind === "counter") {
          const text = `+${mark.extra}`;
          const width = 16 + 15 + 4 + textWidth(chipFont(17), text);
          const x = w - 6 - width;
          chip(x, markY, width, THEME.badge.background, THEME.badge.frame);
          arrow(ctx, x + 8, markY + (CHIP_H - 15) / 2, 15, THEME.gold);
          number(text, x + 8 + 15 + 4, markY, THEME.gold);
        } else if (mark.kind === "grant") {
          const paths = KEY_ICON[mark.keyword];
          if (!paths) continue;
          const x = w - 6 - CHIP_H;
          chip(x, markY, CHIP_H, THEME.badge.background, THEME.badge.frame);
          icon(ctx, paths, x + 7, markY + 7, 16, mark.keyword === "stasis" ? THEME.badge.ink : THEME.badge.ruby);
        } else {
          const font: Font = { size: 12, weight: 800, family: '"Space Grotesk Variable", ui-sans-serif, sans-serif', spacing: 1.2, upper: true };
          const width = 16 + textWidth(font, mark.text);
          const x = w - 6 - width;
          // «Non blocca» (.noblock-mark): rubino cupo col filo rosa.
          chip(x, markY, width, THEME.rubyDeep, "#e56a86");
          applyFont(ctx, font);
          drawText(ctx, { kind: "text", text: mark.text, font, color: "#fdeef1" }, x + 8, markY + CHIP_H / 2 + 4.5);
        }
        markY += CHIP_H + 4;
      }

      // Le parole chiave, in colonna sotto il costo.
      badges.keywords.forEach((id, index) => {
        const paths = KEY_ICON[id];
        if (!paths) return;
        const y = 42 + index * (26 + 4);
        ctx.save();
        ctx.shadowColor = THEME.badge.shadow;
        ctx.shadowBlur = 8 * look.resolution;
        ctx.shadowOffsetY = 2 * look.resolution;
        ctx.fillStyle = THEME.badge.background;
        ctx.fillRect(6, y, 26, 26);
        ctx.restore();
        ctx.strokeStyle = THEME.badge.frame;
        ctx.lineWidth = 1;
        ctx.strokeRect(6.5, y + 0.5, 25, 25);
        icon(ctx, paths, 6 + 5, y + 5, 16, id === "stasis" ? THEME.badge.ink : THEME.badge.ruby);
      });
    }

    // Il numero d'ondata: in alto al centro (l'angolo è del costo), rubino.
    if (combat?.kind === "attack") {
      const text = String(combat.order);
      const font: Font = { size: 16, weight: 800, family: '"Space Grotesk Variable", ui-sans-serif, sans-serif' };
      const width = Math.max(CHIP_H, 16 + textWidth(font, text));
      const x = w / 2 - width / 2;
      const y = look.tapped ? h - 6 - CHIP_H : 6;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.7)";
      ctx.shadowBlur = 10 * look.resolution;
      ctx.shadowOffsetY = 2 * look.resolution;
      ctx.fillStyle = THEME.ruby;
      ctx.fillRect(x, y, width, CHIP_H);
      ctx.restore();
      applyFont(ctx, font);
      drawText(ctx, { kind: "text", text, font, color: "#ffffff" }, x + (width - textWidth(font, text)) / 2, y + CHIP_H / 2 + 5.5);
    }
  });
}

/** L'icona di una parola chiave (cardview.ts, KEY_ICON): tratti su viewBox 24, larga `size`. */
function icon(ctx: CanvasRenderingContext2D, paths: string[], x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of paths) ctx.stroke(new Path2D(d));
  ctx.restore();
}

/** Le spade incrociate (cardview.ts, TESS_SWORDS): viewBox 24. */
export function swords(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  const line = (x1: number, y1: number, x2: number, y2: number, width: number): void => {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  line(4.8, 19.2, 19.8, 4.2, 2);
  line(19.2, 19.2, 4.2, 4.2, 2);
  line(4.3, 15.4, 8.6, 19.7, 1.5);
  line(19.7, 15.4, 15.4, 19.7, 1.5);
  ctx.restore();
}

/** La freccia che torna del Contrattacco (cardview.ts, TESS_COUNTER): viewBox 20. */
export function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 20, size / 20);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.stroke(new Path2D("M 4.5 12.5 A 6 6 0 1 1 10 16.5"));
  ctx.lineCap = "round";
  ctx.stroke(new Path2D("M 4.5 12.5 L 2 9.8 M 4.5 12.5 L 8 11.2"));
  ctx.restore();
}
