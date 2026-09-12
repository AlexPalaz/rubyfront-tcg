// I voli delle carte (simulatore/src/table.ts, liftForFlight, flyFromPile,
// liftToFlight; style.css, fly-*): la carta che va in una pila non scivola,
// si DISSOLVE sul posto — si solleva, si accende di rubino, sfuma in luce e
// sfocatura — mentre una scintilla rubino corre fino alla pila del
// proprietario, che si accende al suo arrivo. Chi muore in battaglia prima
// viene tagliato e sussulta, poi si dissolve. La carta che torna da una pila
// ci arriva volando; quella che cambia posto sul campo (il controllo, la
// restituzione) scivola, con gli Oggetti addosso. E i segni dei colpi su chi
// regge: la parata, un anello d'acciaio; la risposta, una lama d'oro.
//
// Il fantasma si prende PRIMA che lo stato cambi (la carta vera sparirà nella
// pila) e parte dopo il disegno: chi chiama tiene il via, o lo annulla.

import { wornBy } from "@rubyfront/core/combat";
import type { Ctx } from "@rubyfront/core/ctx";
import type { Flight } from "@rubyfront/core/gestures";
import type { Seat, ZoneId } from "@rubyfront/core/types";
import { BlurFilter, ColorMatrixFilter, Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { Stage } from "../stage";
import { bezier, key, tween, easeOut, reducedMotion, linear } from "./animation";
import { paintPiece, withShadow } from "./appearance";
import { TableCard } from "./card";
import type { Table } from "./table";

/** Quanto dura il volo, nell'insieme (table.ts, FLY_MS). */
export const FLY_MS = 1600;
/** Il taglio su chi muore, prima che si dissolva (SLASH_MS). */
const SLASH_MS = 620;
/** Quando la scintilla tocca la pila (ritardo + corsa). */
const SPARK_ARRIVE_MS = 1050;
const DISSOLVE_MS = 1100;

type StrikeKind = "slash" | "riposte" | "parry";

const sparkTextures = new Map<number, Texture>();
/** La scintilla: la gemma del marchio in piccolo, rubino col filo chiaro e il suo alone. */
function sparkTexture(res: number): Texture {
  const key = Math.round(res * 4) / 4;
  let texture = sparkTextures.get(key);
  if (!texture) {
    texture = paintPiece(80, 80, key, ctx => {
      ctx.translate(40, 40);
      ctx.rotate(Math.PI / 4);
      const rect = (): void => {
        ctx.fillStyle = "#e0314b";
        ctx.fillRect(-7, -7, 14, 14);
      };
      withShadow(ctx, key, { x: 0, y: 0, blur: 34, color: "rgba(224,49,75,.6)" }, rect);
      withShadow(ctx, key, { x: 0, y: 0, blur: 14, color: "rgba(224,49,75,.95)" }, rect);
      rect();
      ctx.strokeStyle = "#ffb7c6";
      ctx.lineWidth = 1;
      ctx.strokeRect(-6.5, -6.5, 13, 13);
    });
    sparkTextures.set(key, texture);
  }
  return texture;
}

const bladeTextures = new Map<string, Texture>();
/** La lama del taglio (rubino) o della risposta (oro): una barra chiara, sfumata ai lati, col suo alone. */
function bladeTexture(kind: "slash" | "riposte", w: number, h: number, res: number): Texture {
  const key = `${kind}|${w.toFixed(1)}|${h.toFixed(1)}|${res.toFixed(2)}`;
  let texture = bladeTextures.get(key);
  if (!texture) {
    const margin = 40;
    texture = paintPiece(w + 2 * margin, h + 2 * margin, res, ctx => {
      const gold = kind === "riposte";
      const gradient = ctx.createLinearGradient(margin, 0, margin + w, 0);
      const edge = gold ? "255,240,184" : "255,255,255";
      gradient.addColorStop(0, `rgba(${edge},0)`);
      gradient.addColorStop(0.45, `rgba(${edge},.95)`);
      gradient.addColorStop(0.5, gold ? "#ffd977" : "rgba(255,179,194,1)");
      gradient.addColorStop(0.55, `rgba(${edge},.95)`);
      gradient.addColorStop(1, `rgba(${edge},0)`);
      const glow = gold ? "255,200,80" : "224,49,75";
      const bar = (): void => {
        ctx.fillStyle = gradient;
        ctx.fillRect(margin, margin, w, h);
      };
      withShadow(ctx, res, { x: 0, y: 0, blur: 60, color: `rgba(${glow},.6)` }, bar);
      withShadow(ctx, res, { x: 0, y: 0, blur: 22, color: `rgba(${glow},.9)` }, bar);
      bar();
    });
    bladeTextures.set(key, texture);
  }
  return texture;
}

export class Flights {
  constructor(
    private readonly stage: Stage,
    private readonly table: Table,
    private readonly ctx: Ctx
  ) {}

  private get layer(): Container {
    return this.table.flights;
  }

  private get ticker() {
    return this.stage.app.ticker;
  }

  private get res(): number {
    return this.stage.visible().scale * this.stage.app.renderer.resolution;
  }

  /** Un fantasma della carta com'è ora: stessa vista, niente anelli, fermo al suo posto (nascosto finché non parte). */
  private ghost(uid: string): TableCard | null {
    const view = this.table.view(uid);
    const look = this.table.lookOf(uid);
    if (!view || !look || view.destroyed) return null;
    const ghost = new TableCard(`${uid}~volo`);
    // Il fantasma perde i segni del momento (anelli, l'attacco col suo numero d'ondata): vola la carta, non lo stato.
    ghost.update({ ...look, ring: null, alpha: 1, veiled: false, combat: null });
    ghost.position.copyFrom(view.position);
    ghost.rotation = view.rotation;
    ghost.eventMode = "none";
    ghost.visible = false;
    this.layer.addChild(ghost);
    return ghost;
  }

  /**
   * La carta va in una pila (Abisso, Ritiro): si prende adesso, parte al via.
   * Con `slain` prima il taglio e il sussulto, poi la dissolvenza.
   */
  toPile(uid: string, zone: "ritiro" | "abisso" = "ritiro", opts: { slain?: boolean } = {}): Flight | null {
    const owner = this.ctx.state().cards[uid]?.owner;
    const ghost = owner ? this.ghost(uid) : null;
    if (!ghost || !owner) return null;
    const flight = (() => {
      const target = this.table.pileBox(owner, zone);
      if (!target || ghost.destroyed) {
        ghost.destroy({ children: true });
        return;
      }
      ghost.visible = true;
      if (reducedMotion()) {
        setTimeout(() => ghost.destroy({ children: true }), 120);
        return;
      }
      const delay = opts.slain ? SLASH_MS : 0;
      if (opts.slain) this.mark(ghost, "slash");
      setTimeout(() => this.dissolve(ghost, target, owner, zone), delay);
    }) as Flight;
    flight.cancel = () => ghost.destroy({ children: true });
    return flight;
  }

  /** La dissolvenza (fly-dissolve), la scintilla che corre (fly-spark), la pila che si accende (pile-landing). */
  private dissolve(ghost: TableCard, target: { x: number; y: number; w: number; h: number }, owner: Seat, zone: ZoneId): void {
    if (ghost.destroyed) return;
    const from = { x: ghost.x, y: ghost.y };
    const scale = ghost.scale.x;
    const light = new ColorMatrixFilter();
    const blur = new BlurFilter({ strength: 0, quality: 3 });
    ghost.filters = [light, blur];
    void tween(this.ticker, DISSOLVE_MS, k => {
      if (ghost.destroyed) throw new Error("fantasma distrutto");
      ghost.y = from.y + key(k, [[0, 0], [0.3, -10], [1, -26]]);
      ghost.scale.set(scale * key(k, [[0, 1], [0.3, 1.05], [1, 1.12]]));
      ghost.alpha = key(k, [[0, 1], [0.3, 1], [0.6, 0.85], [1, 0]]);
      light.brightness(key(k, [[0, 1], [0.3, 1.2], [0.6, 1.5], [1, 1.9]]), false);
      blur.strength = key(k, [[0, 0], [0.3, 0], [0.6, 4], [1, 12]]);
    }, bezier(0.3, 0.5, 0.3, 1)).then(() => ghost.destroy({ children: true }));

    // La scintilla: nasce a .3s, corre alla pila in .75s, si spegne toccandola.
    const spark = new Sprite(sparkTexture(this.res));
    spark.anchor.set(0.5);
    spark.width = 80;
    spark.height = 80;
    spark.position.set(from.x, from.y);
    spark.alpha = 0;
    this.layer.addChild(spark);
    const to = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
    void tween(this.ticker, 1150, k => (spark.alpha = key(k, [[0, 0], [0.24, 0], [0.32, 1], [0.86, 1], [1, 0]])), linear);
    setTimeout(() => {
      void tween(this.ticker, 750, k => spark.position.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k), bezier(0.4, 0.1, 0.2, 1));
    }, 300);
    setTimeout(() => {
      spark.destroy();
      this.landing(owner, zone);
    }, SPARK_ARRIVE_MS + 100);
  }

  /** La pila che riceve: un anello rubino che si allarga e sfuma (pile-landing). */
  private landing(owner: Seat, zone: ZoneId): void {
    const target = this.table.pileBox(owner, zone);
    if (!target) return;
    const ring = new Graphics();
    this.layer.addChild(ring);
    void tween(this.ticker, 700, k => {
      const spread = 14 * k;
      ring.clear()
        .rect(target.x - spread, target.y - spread, target.w + 2 * spread, target.h + 2 * spread)
        .stroke({ color: 0xe0314b, alpha: 0.9 * (1 - k), width: 3 });
    }, easeOut).then(() => ring.destroy());
  }

  /** La carta torna da una pila al campo: il fantasma parte dal riquadro della pila e arriva dove la carta è comparsa. */
  fromPile(seat: Seat, zone: ZoneId, uid: string): void {
    const view = this.table.view(uid);
    const from = this.table.pileBox(seat, zone);
    const ghost = this.ghost(uid);
    if (!view || !from || !ghost) {
      ghost?.destroy({ children: true });
      return;
    }
    const to = { x: view.x, y: view.y };
    const endScale = ghost.scale.x;
    const look = this.table.lookOf(uid);
    const startScale = look ? (from.w / look.w) * endScale : endScale;
    ghost.position.set(from.x + from.w / 2, from.y + from.h / 2);
    ghost.scale.set(startScale);
    ghost.alpha = 0.4;
    ghost.visible = true;
    view.visible = false;
    void tween(this.ticker, FLY_MS, k => {
      ghost.position.set(from.x + from.w / 2 + (to.x - from.x - from.w / 2) * k, from.y + from.h / 2 + (to.y - from.y - from.h / 2) * k);
      ghost.scale.set(startScale + (endScale - startScale) * k);
      ghost.alpha = 0.4 + 0.6 * k;
    }, bezier(0.35, 0.6, 0.2, 1)).then(() => {
      ghost.destroy({ children: true });
      if (!view.destroyed) view.visible = true;
    });
  }

  /**
   * La carta cambia posto sul campo (il controllo, §8.2; la restituzione):
   * si prende adesso col suo gruppo — gli Oggetti addosso, sotto — e al via
   * i fantasmi scivolano dal posto vecchio al nuovo.
   */
  slide(uid: string): Flight | null {
    const group = [...wornBy(this.ctx.state(), uid).map(object => object.uid), uid];
    const starts = group.flatMap(member => {
      const view = this.table.view(member);
      return view && !view.destroyed ? [{ member, x: view.x, y: view.y, rotation: view.rotation }] : [];
    });
    if (!starts.some(start => start.member === uid)) return null;
    const flight = (() => {
      for (const start of starts) {
        const landed = this.table.view(start.member);
        const ghost = this.ghost(start.member);
        if (!landed || !ghost) {
          ghost?.destroy({ children: true });
          continue;
        }
        const to = { x: landed.x, y: landed.y, rotation: landed.rotation };
        ghost.position.set(start.x, start.y);
        ghost.rotation = start.rotation;
        ghost.visible = true;
        landed.visible = false;
        void tween(this.ticker, FLY_MS, k => {
          ghost.position.set(start.x + (to.x - start.x) * k, start.y + (to.y - start.y) * k);
          ghost.rotation = start.rotation + (to.rotation - start.rotation) * k;
        }, bezier(0.35, 0.6, 0.2, 1)).then(() => {
          ghost.destroy({ children: true });
          if (!landed.destroyed) landed.visible = true;
        });
      }
    }) as Flight;
    flight.cancel = () => undefined;
    return flight;
  }

  /** Il segno di un colpo su una carta in campo (§6.3): la parata del bloccante che regge, la risposta di chi contrattacca. */
  clash(uid: string, kind: "parry" | "riposte"): void {
    const view = this.table.view(uid);
    if (view && !view.destroyed) this.mark(view, kind);
  }

  /**
   * Un segno sulla carta (o sul fantasma): la lama che la attraversa in
   * diagonale (slash, rubino; riposte, oro, in senso contrario), col lampo
   * rubino del taglio, o l'anello d'acciaio della parata che corre dal
   * bordo verso il centro. La carta colpita sussulta.
   */
  private mark(card: TableCard, kind: StrikeKind): void {
    if (reducedMotion()) return;
    const look = this.table.lookOf(card.cardUid.replace(/~volo$/, ""));
    if (!look) return;
    const { w, h } = look;
    const mark = new Container({ label: "mark" });
    const mask = new Graphics().rect(-w / 2, -h / 2, w, h).fill(0xffffff);
    mark.addChild(mask);
    mark.mask = mask;
    card.addChild(mark);
    const ticker = this.ticker;
    if (kind === "parry") {
      const ring = new Graphics();
      mark.addChild(ring);
      void tween(ticker, 620, k => {
        const width = key(k, [[0, 0.001], [0.35, 14], [1, 40]]);
        const alpha = key(k, [[0, 0.95], [0.35, 0.9], [1, 0]]);
        const wash = key(k, [[0, 0.35], [0.35, 0.12], [1, 0]]);
        ring.clear().rect(-w / 2, -h / 2, w, h).fill({ color: 0xd7e6ff, alpha: wash });
        ring.rect(-w / 2 + width / 2, -h / 2 + width / 2, w - width, h - width).stroke({ color: 0xd7e6ff, alpha, width });
      }, easeOut).then(() => mark.destroy({ children: true }));
    } else {
      const barW = w * 0.18;
      const barH = h * 1.9;
      const blade = new Sprite(bladeTexture(kind, barW, barH, this.res));
      blade.anchor.set(0.5);
      blade.width = barW + 80;
      blade.height = barH + 80;
      const holder = new Container();
      holder.rotation = ((kind === "slash" ? 32 : -32) * Math.PI) / 180;
      holder.addChild(blade);
      mark.addChild(holder);
      const sweep = kind === "slash" ? [-1.6, 1.6] : [1.6, -1.6];
      void tween(ticker, 420, k => {
        blade.x = barW * (sweep[0] + (sweep[1] - sweep[0]) * k);
        blade.alpha = key(k, [[0, 0], [0.15, 1], [1, 0]]);
      }, bezier(0.2, 0.8, 0.3, 1));
      if (kind === "slash") {
        const flash = new Graphics();
        mark.addChild(flash);
        void tween(ticker, 620, k => {
          flash.clear().rect(-w / 2, -h / 2, w, h).fill({ color: 0xe0314b, alpha: key(k, [[0, 0], [0.25, 0.55], [1, 0]]) });
        }, easeOut);
      }
      setTimeout(() => {
        if (!mark.destroyed) mark.destroy({ children: true });
      }, 700);
    }
    // Il sussulto (card-hit): il perno si sposta, la posizione resta del tavolo.
    const pivot = { x: card.pivot.x, y: card.pivot.y };
    const rotation = card.rotation;
    void tween(ticker, 500, k => {
      card.pivot.set(pivot.x - key(k, [[0, 0], [0.2, -7], [0.45, 6], [0.7, -3], [1, 0]]), pivot.y - key(k, [[0, 0], [0.2, 3], [0.45, -3], [0.7, 2], [1, 0]]));
      card.rotation = rotation + (key(k, [[0, 0], [0.2, -2], [0.45, 1.6], [0.7, -0.8], [1, 0]]) * Math.PI) / 180;
    }, easeOut);
  }
}
