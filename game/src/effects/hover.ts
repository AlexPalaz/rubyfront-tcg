// Il passaggio sopra una carta (2026-09-12, «bellissimo l'effetto che si
// muove la carta, ma dev'essere fatto meglio e più realistico»): al posto
// dello skew, una copia della carta in prospettiva vera (Card3D) che si
// inclina verso il puntatore — il lato sotto il dito cede, l'altro sale —
// su una molla con un filo di peso; la carta si solleva appena, la sua ombra
// si stacca dal tavolo e scivola con l'inclinazione, un riflesso le scorre
// sopra dalla parte opposta al dito. Lasciata, torna piatta con la stessa
// molla e l'originale ricompare. La copia sta nello stesso livello della
// carta (sopra le vicine, sotto i veli coi tasti): l'originale resta lì,
// invisibile ma sensibile — il tocco, la presa, il menu restano suoi.

import { Container, Sprite, Texture, type Renderer } from "pixi.js";
import type { Stage } from "../stage";
import { reducedMotion } from "../table/animation";
import { paintPiece } from "../table/appearance";
import type { TableCard } from "../table/card";
import type { Table } from "../table/table";
import { Card3D } from "./projection";

/** L'inclinazione massima (≈14°), il sollevamento, la molla (rigidità, smorzamento: appena sotto il critico, un filo di rimbalzo). */
const MAX_TILT = 0.24;
const LIFT = 0.06;
const STIFFNESS = 190;
const DAMPING = 21;
/** La camera: più vicina del volo, la prospettiva si legge su una carta piccola. */
const PERSPECTIVE = 720;
/** Ogni quanto si rifà la foto della carta (anelli che respirano, numeri che cambiano). */
const SNAPSHOT_MS = 300;
/** Sotto questa soglia la carta è tornata piatta. */
const REST = 0.002;

interface Lifted {
  uid: string;
  view: TableCard;
  parent: Container;
  layer: Container;
  card: Card3D;
  mask: Card3D;
  glare: Sprite;
  shadow: Sprite;
  texture: Texture;
  shotAt: number;
  rx: number;
  ry: number;
  lift: number;
  vrx: number;
  vry: number;
  vlift: number;
  leaving: boolean;
}

export class HoverTilt {
  private readonly lifted = new Map<string, Lifted>();
  private below: string | null = null;
  private pointer: { x: number; y: number } | null = null;
  private glareTexture: Texture | null = null;
  private shadowTextures = new Map<string, Texture>();
  /** La luce del foil delle Uniche segue lo stesso puntatore (effects/filters.ts, FoilFilter.light). */
  onLight: ((dx: number, dy: number) => void) | null = null;

  constructor(
    private readonly stage: Stage,
    private readonly table: Table
  ) {
    window.addEventListener(
      "pointermove",
      event => {
        const rect = stage.app.canvas.getBoundingClientRect();
        this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      },
      { passive: true }
    );
  }

  /** Il puntatore entra in una carta: si solleva (quella di prima torna giù). */
  over(uid: string): void {
    if (reducedMotion()) return;
    if (this.below && this.below !== uid) this.leave(this.below);
    this.below = uid;
    const known = this.lifted.get(uid);
    if (known) known.leaving = false;
    else this.take(uid);
  }

  /** Il puntatore esce: la carta torna piatta con la molla. */
  out(uid: string): void {
    if (this.below === uid) this.below = null;
    this.leave(uid);
  }

  /** La presa (il trascinamento): la copia sparisce subito, la carta è di chi la prende. */
  drop(uid: string): void {
    if (this.below === uid) this.below = null;
    const known = this.lifted.get(uid);
    if (known) this.dispose(known);
  }

  update(seconds: number): void {
    const dt = Math.min(0.05, seconds);
    const now = performance.now();
    for (const lifted of [...this.lifted.values()]) {
      const { view } = lifted;
      if (view.destroyed || view.parent !== lifted.parent) {
        this.dispose(lifted);
        continue;
      }
      if (!lifted.leaving && now - lifted.shotAt > SNAPSHOT_MS) this.reshoot(lifted, now);
      // Il riquadro sullo schermo: coricata, largo e alto si scambiano.
      const cos = Math.abs(Math.cos(view.rotation));
      const sin = Math.abs(Math.sin(view.rotation));
      const look = this.table.lookOf(lifted.uid);
      const cardW = look?.w ?? lifted.card.w;
      const cardH = look?.h ?? lifted.card.h;
      const halfW = (cos * cardW + sin * cardH) / 2;
      const halfH = (sin * cardW + cos * cardH) / 2;
      let targetRx = 0;
      let targetRy = 0;
      let targetLift = 0;
      if (!lifted.leaving && this.pointer) {
        const p = lifted.parent.toLocal(this.pointer);
        const dx = Math.max(-1, Math.min(1, (p.x - view.x) / halfW));
        const dy = Math.max(-1, Math.min(1, (p.y - view.y) / halfH));
        // Il lato sotto il dito cede (si allontana), l'altro sale verso chi guarda.
        targetRx = dy * MAX_TILT;
        targetRy = -dx * MAX_TILT;
        targetLift = LIFT;
        this.onLight?.(dx, dy);
      }
      lifted.vrx += ((targetRx - lifted.rx) * STIFFNESS - lifted.vrx * DAMPING) * dt;
      lifted.vry += ((targetRy - lifted.ry) * STIFFNESS - lifted.vry * DAMPING) * dt;
      lifted.vlift += ((targetLift - lifted.lift) * STIFFNESS - lifted.vlift * DAMPING) * dt;
      lifted.rx += lifted.vrx * dt;
      lifted.ry += lifted.vry * dt;
      lifted.lift += lifted.vlift * dt;
      if (lifted.leaving && Math.abs(lifted.rx) < REST && Math.abs(lifted.ry) < REST && Math.abs(lifted.lift) < REST && Math.abs(lifted.vrx) + Math.abs(lifted.vry) < 0.02) {
        this.dispose(lifted);
        continue;
      }
      this.pose(lifted, halfW, halfH);
    }
  }

  private pose(lifted: Lifted, halfW: number, halfH: number): void {
    const { view, card, mask, glare, shadow, layer } = lifted;
    layer.position.set(view.x, view.y);
    const scale = view.scale.x * (1 + lifted.lift);
    for (const piece of [card, mask]) {
      piece.rotateTo(lifted.rx, lifted.ry, view.rotation);
      piece.scale.set(scale);
    }
    // Il riflesso: dalla parte che sale verso chi guarda (opposta al dito), più acceso quanto più è inclinata.
    const tilt = Math.min(1, Math.hypot(lifted.rx, lifted.ry) / MAX_TILT);
    glare.position.set((lifted.ry / MAX_TILT) * halfW * 0.6, -(lifted.rx / MAX_TILT) * halfH * 0.6);
    glare.alpha = 0.05 + 0.2 * tilt;
    glare.width = glare.height = Math.max(halfW, halfH) * 2.4;
    // L'ombra: si stacca col sollevamento, scivola col lato che sale, si fa più morbida e più chiara.
    const up = Math.max(0, lifted.lift / LIFT);
    shadow.rotation = view.rotation;
    shadow.position.set((lifted.ry / MAX_TILT) * 7, 5 + 15 * up);
    shadow.scale.set(view.scale.x * (1 + 0.05 * up));
    shadow.alpha = 0.55 - 0.15 * up;
  }

  private take(uid: string): void {
    const view = this.table.view(uid);
    const look = this.table.lookOf(uid);
    if (!view || view.destroyed || !view.parent || !look) return;
    const { texture, w, h } = view.snapshot(this.stage.app.renderer as Renderer, this.resolution());
    const layer = new Container({ label: "hover-lift" });
    layer.eventMode = "none";
    layer.zIndex = 100_000;
    const shadow = new Sprite(this.shadowTexture(look.w, look.h));
    shadow.anchor.set(0.5);
    const card = new Card3D(texture, w, h, PERSPECTIVE);
    const mask = new Card3D(Texture.WHITE, look.w, look.h, PERSPECTIVE);
    const glare = new Sprite(this.glare());
    glare.anchor.set(0.5);
    glare.blendMode = "add";
    glare.mask = mask;
    layer.addChild(shadow, card, glare, mask);
    view.parent.addChild(layer);
    view.setGhost(true);
    const lifted: Lifted = { uid, view, parent: view.parent, layer, card, mask, glare, shadow, texture, shotAt: performance.now(), rx: 0, ry: 0, lift: 0, vrx: 0, vry: 0, vlift: 0, leaving: false };
    this.lifted.set(uid, lifted);
  }

  private reshoot(lifted: Lifted, now: number): void {
    const { texture } = lifted.view.snapshot(this.stage.app.renderer as Renderer, this.resolution());
    const old = lifted.texture;
    lifted.card.face(texture);
    lifted.texture = texture;
    lifted.shotAt = now;
    old.destroy(true);
  }

  private leave(uid: string): void {
    const known = this.lifted.get(uid);
    if (known) known.leaving = true;
  }

  private dispose(lifted: Lifted): void {
    this.lifted.delete(lifted.uid);
    if (!lifted.view.destroyed) lifted.view.setGhost(false);
    lifted.layer.destroy({ children: true });
    lifted.texture.destroy(true);
  }

  private resolution(): number {
    return this.stage.visible().scale * this.stage.app.renderer.resolution;
  }

  /** Il riflesso: un cerchio di luce che sfuma, dipinto una volta. */
  private glare(): Texture {
    this.glareTexture ??= paintPiece(256, 256, 1, ctx => {
      const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, "rgba(255,255,255,.9)");
      gradient.addColorStop(0.35, "rgba(255,255,255,.35)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);
    });
    return this.glareTexture;
  }

  /** L'ombra sotto la carta sollevata: un riquadro nero sfocato, uno per misura di carta. */
  private shadowTexture(w: number, h: number): Texture {
    const key = `${w.toFixed(1)}|${h.toFixed(1)}`;
    let texture = this.shadowTextures.get(key);
    if (!texture) {
      const margin = 40;
      texture = paintPiece(w + margin * 2, h + margin * 2, this.resolution(), ctx => {
        const a = ctx.getTransform().a;
        ctx.shadowColor = "rgba(0,0,0,.85)";
        ctx.shadowBlur = 22 * a;
        ctx.fillStyle = "rgba(0,0,0,.6)";
        ctx.fillRect(margin, margin, w, h);
      });
      this.shadowTextures.set(key, texture);
    }
    return texture;
  }
}
