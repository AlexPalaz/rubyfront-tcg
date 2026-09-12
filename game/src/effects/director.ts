// La regia degli effetti (animazioni, 2026-09-12): fra la partita e il kit
// (effects/index.ts). Legge ogni azione che il tavolo sta per applicare — la
// propria, quella del bot, quella dell'avversario — e PRIMA che lo stato
// cambi prende nota di ciò che servirà (dove stava la carta, la sua faccia,
// i PV); DOPO il ridisegno lancia il suo effetto:
// - la giocata: la carta vola dalla mano in arco, in prospettiva, e si
//   schianta sul Fronte (non se l'hai trascinata tu: è già lì);
// - lo schieramento del Rubyfront e il suo atterraggio all'ingresso:
//   l'impatto grande e l'aura della sua tinta;
// - la risoluzione: ogni attaccante scatta sul bersaglio; all'urto parate e
//   colpi, i numeri del danno, chi muore si sbriciola;
// - il flip al Nexus: il giro in 3D, la faccia nuova a metà giro;
// - un effetto di carta: l'incantesimo della sua tinta dalla fonte al bersaglio;
// - i PV che cambiano: i numeri che saltano sul Rubyfront;
// - ogni fase nuova, la lama di luce; la fine, lo scoppio sul Rubyfront che cade.
// E sempre: il foil delle Uniche, la carta sotto il puntatore che s'inclina,
// le braci. Niente regole qui: solo ciò che si vede.

import { cardStats, cardTint, getCard, isRubyfront } from "@rubyfront/core/cards";
import type { Ctx } from "@rubyfront/core/ctx";
import { clashesOf, fallenOf } from "@rubyfront/core/clashes";
import type { Action, Battle, CardInstance, GameState, Seat } from "@rubyfront/core/types";
import { Sprite, type Texture } from "pixi.js";
import { faceTexture } from "../card/cache";
import { CARD_W } from "../card/theme";
import type { Stage } from "../stage";
import { wait, tween, easeOut, reducedMotion } from "../table/animation";
import type { Table } from "../table/table";
import { Card3D, Effects, FoilFilter } from "./index";

type Box = { x: number; y: number; w: number; h: number };
type XY = { x: number; y: number };

const center = (b: Box): XY => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** La luce della lama per fase: come il titolo dell'insegna (Notte). */
const TONES: Record<string, number> = { preparazione: 0xede6e0, fronte: 0xd24a64, reazione: 0xff9fb3 };

const uniqueCache = new Map<string, boolean>();

/** Una carta Unica (i dati la segnano con `"unique": true`). */
export function isUnique(cardId: string): boolean {
  let answer = uniqueCache.get(cardId);
  if (answer === undefined) {
    answer = JSON.stringify(getCard(cardId) ?? {}).includes('"unique":true');
    uniqueCache.set(cardId, answer);
  }
  return answer;
}

/** I colpi del tavolo che la regia chiama all'urto: la parata o la risposta, il Rubyfront colpito. */
export interface TableHits {
  parry(uid: string, kind: "parry" | "riposte"): void;
  struckRubyfront(uid: string): void;
}

interface Snapshot {
  card: CardInstance;
  box: Box;
  tapped: boolean;
  texture: Promise<Texture | null>;
}

export class Director {
  readonly effects: Effects;
  private readonly foil = new FoilFilter(0.6);
  private time = 0;
  private below: string | null = null;
  private readonly returning = new Set<string>();
  private pointer: XY = { x: -1e6, y: -1e6 };
  private phaseKey: string | null = null;
  private finished = false;
  private readonly lastSpell = new Map<string, number>();
  /** L'ingresso dei Rubyfront è in arrivo: le fasi non si annunciano (lo fa la sessione, a ingresso finito). */
  entrancePending = false;

  constructor(
    private readonly stage: Stage,
    private readonly table: Table,
    private readonly ctx: Ctx,
    private readonly release: () => { uid: string; at: number } | null,
    private readonly hits: TableHits
  ) {
    this.effects = new Effects(stage);
    // Sopra il tavolo ma sotto scene, insegna e dado; l'atmosfera sopra il fondo, sotto le carte.
    stage.world.addChildAt(this.effects.overlay, stage.world.getChildIndex(table.root) + 1);
    table.root.addChildAt(this.effects.below, 1);
    stage.app.ticker.add(ticker => {
      this.time += ticker.deltaMS / 1000;
      this.foil.time = this.time;
      this.tilt();
    });
    table.onCard(cardEvent => {
      if (cardEvent.type === "over") {
        if (this.below && this.below !== cardEvent.uid) this.returning.add(this.below);
        this.below = cardEvent.uid;
        this.returning.delete(cardEvent.uid);
      } else if ((cardEvent.type === "out" || cardEvent.type === "grab") && this.below === cardEvent.uid) {
        this.returning.add(cardEvent.uid);
        this.below = null;
      }
    });
    window.addEventListener(
      "pointermove",
      event => {
        const rect = stage.app.canvas.getBoundingClientRect();
        const p = stage.world.toLocal({ x: event.clientX - rect.left, y: event.clientY - rect.top });
        this.pointer = { x: p.x, y: p.y };
      },
      { passive: true }
    );
    stage.onLayout(v => this.effects.startEmbers({ x: v.x, y: v.y, w: v.width, h: v.height }));
  }

  private pixelRatio(): number {
    return this.stage.visible().scale * this.stage.app.renderer.resolution;
  }

  private photo(state: GameState, uid: string | undefined): Snapshot | null {
    if (!uid) return null;
    const card = state.cards[uid];
    const box = this.table.box(uid);
    if (!card || !box) return null;
    const tapped = this.table.lookOf(uid)?.tapped ?? false;
    const tileW = this.table.layout()?.tileW ?? box.w;
    return { card, box, tapped, texture: faceTexture(card.cardId, card.face, this.ctx.locale(), (tileW / CARD_W) * this.pixelRatio()) };
  }

  // ------------------------------------------------------------ sempre

  /** La carta sotto il puntatore s'inclina verso di lui; lasciata, torna dritta. Il foil segue la stessa luce. */
  private tilt(): void {
    const maximum = reducedMotion() ? 0 : 0.045;
    const step = (uid: string, kx: number, ky: number): boolean => {
      const view = this.table.view(uid);
      if (!view || view.destroyed) return false;
      view.skew.x += (kx - view.skew.x) * 0.2;
      view.skew.y += (ky - view.skew.y) * 0.2;
      return Math.abs(view.skew.x - kx) > 0.0005 || Math.abs(view.skew.y - ky) > 0.0005;
    };
    if (this.below) {
      const box = this.table.box(this.below);
      if (box) {
        const c = center(box);
        const dx = Math.max(-1, Math.min(1, (this.pointer.x - c.x) / (box.w / 2)));
        const dy = Math.max(-1, Math.min(1, (this.pointer.y - c.y) / (box.h / 2)));
        step(this.below, dy * maximum, -dx * maximum);
        this.foil.light(dx, dy);
      }
    }
    for (const uid of [...this.returning]) {
      if (step(uid, 0, 0)) continue;
      const view = this.table.view(uid);
      if (view && !view.destroyed) view.skew.set(0, 0);
      this.returning.delete(uid);
    }
  }

  /** Dopo ogni ridisegno: il foil delle Uniche, la lama di una fase nuova, lo scoppio della fine. */
  afterPaint(state: GameState): void {
    for (const card of Object.values(state.cards)) {
      if ((card.zone !== "field" && card.zone !== "hand") || !isUnique(card.cardId) || this.table.lookOf(card.uid)?.back) continue;
      this.table.view(card.uid)?.setSheen(this.foil);
    }
    const key = `${state.turn}|${state.active}|${state.phase}`;
    if (this.phaseKey !== null && key !== this.phaseKey && !this.entrancePending && !state.over) void this.effects.lightBlade(TONES[state.phase] ?? 0xd24a64);
    this.phaseKey = key;
    if (state.over && !this.finished) {
      this.finished = true;
      this.finalBanner(state);
    }
    if (!state.over) this.finished = false;
  }

  /** L'insegna d'apertura (a ingresso finito): anche lei con la sua lama. */
  announce(state: GameState): void {
    this.phaseKey = `${state.turn}|${state.active}|${state.phase}`;
    void this.effects.lightBlade(TONES[state.phase] ?? 0xd24a64);
  }

  private rubyfront(state: GameState, seat: Seat): Box | undefined {
    const rf = Object.values(state.cards).find(card => card.owner === seat && card.zone === "field" && isRubyfront(card.cardId));
    return rf ? this.table.box(rf.uid) : undefined;
  }

  /** Il Rubyfront di quel posto si vede (all'ingresso resta nascosto finché non atterra). */
  private isVisible(state: GameState, seat: Seat): boolean {
    const rf = Object.values(state.cards).find(card => card.owner === seat && card.zone === "field" && isRubyfront(card.cardId));
    const view = rf ? this.table.view(rf.uid) : undefined;
    return Boolean(view && !view.destroyed && view.visible);
  }

  private finalBanner(state: GameState): void {
    const winner = state.over?.winner;
    const loser: Seat | null = winner === "a" ? "b" : winner === "b" ? "a" : null;
    const box = loser ? this.rubyfront(state, loser) : undefined;
    this.effects.camera.flash(0xd24a64, 0.35, 700);
    this.effects.camera.shake(0.8);
    if (box) this.effects.spells.explode(center(box), [0xffffff, 0xffd27a, 0xd24a64], 2.2);
  }

  // ------------------------------------------------------------ le azioni

  /** Un'azione sta per applicarsi: si prende nota, e si torna ciò che parte dopo il ridisegno. */
  before(action: Action): (() => void) | null {
    try {
      return this.prepare(action);
    } catch (error) {
      console.warn("regia", error);
      return null;
    }
  }

  private prepare(action: Action): (() => void) | null {
    const state = this.ctx.state();
    const hp: Record<Seat, number> = { a: state.players.a.hp, b: state.players.b.hp };
    const after: (() => void)[] = [];
    const effect = (action as { effect?: { source?: string } }).effect;
    if (action.t === "toZone" && action.zone === "field" && !effect) {
      const card = state.cards[action.uid];
      if (card && card.zone === "hand") after.push(this.played(card));
    }
    if (action.t === "move" && action.cost !== undefined) {
      const card = state.cards[action.uid];
      if (card && isRubyfront(card.cardId)) after.push(() => this.landing(card.uid, 1.3));
    }
    if (action.t === "flip") {
      const card = state.cards[action.uid];
      const box = this.table.box(action.uid);
      if (card && box) after.push(this.flip(card, action.face, box));
    }
    if (effect?.source) {
      const target = (action as { uid?: string }).uid ?? null;
      after.push(this.spell(state, effect.source, target));
    }
    // I PV: solo per le mosse di gioco — non l'apparecchiatura (il mazzo che imposta i PV del suo
    // Rubyfront, la partita nuova), non durante l'ingresso, e non la risoluzione (lì i numeri arrivano all'urto).
    const isSetup = action.t === "loadDeck" || action.t === "newGame" || action.t === "player";
    if (action.t !== "resolve" && !isSetup && !this.entrancePending) after.push(() => this.hpNumbers(hp));
    return after.length ? () => after.forEach(f => f()) : null;
  }

  /** La giocata: dalla mano (o, per l'avversario, dall'alto) in arco fino allo slot, poi l'impatto. */
  private played(card: CardInstance): () => void {
    const isMine = card.owner === this.ctx.seat();
    const release = this.release();
    const dragged = release !== null && release.uid === card.uid && Date.now() - release.at < 800;
    const from = isMine && !dragged ? (this.table.box(card.uid) ?? null) : null;
    const face = faceTexture(card.cardId, card.face, this.ctx.locale(), 0.6 * this.pixelRatio());
    return () => void this.flyAndLand(card, from, !dragged, face);
  }

  private async flyAndLand(card: CardInstance, from: Box | null, withArc: boolean, face: Promise<Texture | null>): Promise<void> {
    const box = this.table.box(card.uid);
    if (!box) return;
    const arrival = center(box);
    const view = this.table.view(card.uid);
    const texture = withArc && !reducedMotion() ? await Promise.race([face, wait(250).then(() => null)]) : null;
    if (texture && view && !view.destroyed) {
      const departure = from ? center(from) : { x: arrival.x, y: arrival.y - 380 };
      const card3d = new Card3D(texture, box.w, box.h);
      card3d.position.set(departure.x, departure.y);
      this.effects.overlay.addChild(card3d);
      view.visible = false;
      const direction = arrival.x >= departure.x ? 1 : -1;
      const rise = Math.min(260, Math.hypot(arrival.x - departure.x, arrival.y - departure.y) * 0.45);
      await tween(this.stage.app.ticker, 480, k => {
        card3d.position.set(departure.x + (arrival.x - departure.x) * k, departure.y + (arrival.y - departure.y) * k - Math.sin(k * Math.PI) * rise);
        card3d.scale.set(1 + 0.35 * Math.sin(k * Math.PI));
        card3d.rotateTo(-0.55 * (1 - k), 0.7 * direction * (1 - k), -0.15 * direction * (1 - k));
      });
      card3d.destroy({ children: true });
      if (!view.destroyed) view.visible = true;
    }
    void this.effects.hits.impact(arrival.x, arrival.y, box.w, box.h, cardStats(card.cardId).kind === "entity" ? 1 : 0.8);
    // Una Materia che scende accende la sua tinta.
    if (cardStats(card.cardId).kind === "matter") void this.effects.spells.aura(cardTint(card.cardId), arrival.x, arrival.y, box.w, box.h);
  }

  /** Il Rubyfront che si posa (lo schieramento, l'atterraggio dell'ingresso): l'impatto grande e la sua tinta. */
  landing(uid: string, strength = 1.5): void {
    const card = this.ctx.state().cards[uid];
    const box = this.table.box(uid);
    if (!card || !box) return;
    const c = center(box);
    void this.effects.hits.impact(c.x, c.y, box.w, box.h, strength);
    void this.effects.spells.aura(cardTint(card.cardId), c.x, c.y, box.w, box.h);
  }

  /** Il flip: la carta gira in 3D, a metà giro la faccia nuova, poi il lampo d'oro. */
  private flip(card: CardInstance, face: number, box: Box): () => void {
    const res = (box.w / CARD_W) * this.pixelRatio();
    const before = faceTexture(card.cardId, card.face, this.ctx.locale(), res);
    const nextFace = faceTexture(card.cardId, face, this.ctx.locale(), res);
    return () =>
      void (async () => {
        const [a, b] = await Promise.all([before, nextFace]);
        const view = this.table.view(card.uid);
        const here = this.table.box(card.uid) ?? box;
        if (!a || !b || !view || view.destroyed || reducedMotion()) return;
        const c = center(here);
        const card3d = new Card3D(a, here.w, here.h, 900);
        card3d.setBack(b);
        card3d.position.set(c.x, c.y);
        this.effects.overlay.addChild(card3d);
        view.visible = false;
        this.effects.camera.flash(0xffe0a0, 0.3, 420);
        await tween(this.stage.app.ticker, 820, k => {
          card3d.rotateTo(0, Math.PI * easeOut(k));
          card3d.scale.set(1 + 0.25 * Math.sin(k * Math.PI));
        });
        card3d.destroy({ children: true });
        if (!view.destroyed) view.visible = true;
        this.effects.spells.explode(c, [0xffe0a0, 0xffffff, 0xe56a86], 1.4);
        this.effects.camera.shake(0.45);
        void this.effects.spells.aura(cardTint(card.cardId), c.x, c.y, here.w, here.h);
      })();
  }

  /** L'effetto di una carta: dalla fonte al bersaglio nella sua tinta (senza bersaglio, l'aura sulla fonte). */
  private spell(state: GameState, source: string, target: string | null): () => void {
    const now = Date.now();
    if (now - (this.lastSpell.get(source) ?? 0) < 700) return () => undefined;
    this.lastSpell.set(source, now);
    const card = state.cards[source];
    const from = this.table.box(source);
    const a = target && target !== source ? this.table.box(target) : undefined;
    if (!card || !from) return () => undefined;
    const tint = cardTint(card.cardId);
    return () => {
      // Il bersaglio può essere già altrove: si mira a dove stava.
      if (a) void this.effects.spells.cast(tint, center(from), center(a));
      else void this.effects.spells.aura(tint, center(from).x, center(from).y, from.w, from.h);
    };
  }

  private hpNumbers(before: Record<Seat, number>): void {
    const state = this.ctx.state();
    for (const seat of ["a", "b"] as const) {
      const delta = state.players[seat].hp - before[seat];
      if (!delta) continue;
      const box = this.rubyfront(state, seat);
      if (!box || !this.isVisible(state, seat)) continue;
      void this.effects.popNumber(center(box).x, box.y + box.h * 0.2, delta > 0 ? `+${delta}` : `−${-delta}`, delta > 0 ? "heal" : "damage", Math.abs(delta) >= 3);
    }
  }

  // ------------------------------------------------------------ la risoluzione

  /** La risoluzione: prima si fotografano attaccanti, bersagli e caduti; dopo il ridisegno, gli scatti e gli urti. */
  resolution(action: Action): (() => void) | null {
    if (action.t !== "resolve") return null;
    const state = this.ctx.state();
    const fallen = fallenOf(state, action);
    const clashes = clashesOf(state, action);
    const battles = action.battles.map(b => {
      const target = b.blocker ?? state.declarations.find(d => d.from === b.attacker && d.kind === "attack")?.to;
      return { b, attacker: this.photo(state, b.attacker), target: this.photo(state, target), targetUid: target ?? null };
    });
    const fallenSnapshots = new Map(fallen.map(uid => [uid, this.photo(state, uid)] as const));
    return () => void this.playResolution(battles, fallenSnapshots, clashes).catch(error => console.warn("regia", error));
  }

  private async playResolution(
    battles: { b: Battle; attacker: Snapshot | null; target: Snapshot | null; targetUid: string | null }[],
    fallen: Map<string, Snapshot | null>,
    clashes: { uid: string; kind: "strike" | "parry" | "riposte" }[]
  ): Promise<void> {
    const L = this.table.layout();
    // I caduti restano in piedi (controfigure) finché il colpo non li raggiunge.
    const standIns = new Map<string, Sprite>();
    for (const [uid, photo] of fallen) {
      if (!photo) continue;
      const sprite = await this.standIn(photo, L?.tileW ?? photo.box.w, L?.tileH ?? photo.box.h);
      if (sprite) standIns.set(uid, sprite);
    }
    const shatter = (uid: string, from?: XY): void => {
      const sprite = standIns.get(uid);
      if (!sprite) return;
      standIns.delete(uid);
      sprite.visible = false;
      void this.effects
        .shatter({ texture: sprite.texture, x: sprite.x, y: sprite.y, w: L?.tileW ?? sprite.width, h: L?.tileH ?? sprite.height, ...(from ? { from } : {}) })
        .then(() => sprite.destroy());
    };
    await Promise.all(
      battles.map(async ({ b, attacker, target, targetUid }, i) => {
        await wait(i * 280);
        if (!attacker || !target) return;
        const view = this.table.view(b.attacker);
        // Chi scatta: la controfigura se l'attaccante muore, se no una copia della carta (l'originale si nasconde).
        let body = standIns.get(b.attacker) ?? null;
        const wasStandIn = body !== null;
        if (body) standIns.delete(b.attacker);
        else body = await this.standIn(attacker, L?.tileW ?? attacker.box.w, L?.tileH ?? attacker.box.h);
        if (!body) return;
        if (view && !view.destroyed) view.visible = false;
        const targetCenter = center(target.box);
        const copy = body;
        await this.effects.hits.dash(
          copy,
          targetCenter,
          () => {
            const trail = new Sprite(copy.texture);
            trail.anchor.set(0.5);
            trail.width = copy.width;
            trail.height = copy.height;
            return trail;
          },
          () => {
            for (const s of clashes) {
              if (s.uid === b.blocker && s.kind !== "strike") this.hits.parry(s.uid, s.kind);
              if (s.uid === targetUid && s.kind === "strike") this.hits.struckRubyfront(s.uid);
            }
            if (b.kind === "unblocked" && b.damage > 0) {
              void this.effects.popNumber(targetCenter.x, target.box.y + target.box.h * 0.2, `−${b.damage}`, "damage", true);
              this.effects.camera.shake(Math.min(0.7, 0.3 + b.damage * 0.05));
            }
            if (b.blocker && b.blockerDies) shatter(b.blocker, center(attacker.box));
          }
        );
        // Il ritorno (420 ms), poi l'attaccante torna al suo posto — o si sbriciola, se muore.
        await wait(440);
        if (wasStandIn || b.attackerDies) {
          standIns.set(b.attacker, copy);
          shatter(b.attacker, targetCenter);
        } else copy.destroy();
        if (view && !view.destroyed) view.visible = true;
      })
    );
    // Chi è caduto senza battaglia (un effetto a metà), si sbriciola lo stesso.
    for (const uid of [...standIns.keys()]) shatter(uid);
  }

  /** Una controfigura: la faccia della carta, dove stava, dritta o coricata come stava. */
  private async standIn(photo: Snapshot, w: number, h: number): Promise<Sprite | null> {
    const texture = await Promise.race([photo.texture, wait(300).then(() => null)]);
    if (!texture) return null;
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = w;
    sprite.height = h;
    const c = center(photo.box);
    sprite.position.set(c.x, c.y);
    sprite.rotation = photo.tapped ? Math.PI / 2 : 0;
    this.effects.overlay.addChild(sprite);
    return sprite;
  }
}
