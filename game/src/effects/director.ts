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
import { BlurFilter, Container, Graphics, Sprite, type Texture, type Ticker } from "pixi.js";
import { faceTexture } from "../card/cache";
import { playSocket, playWhoosh } from "../sound";
import { CARD_W } from "../card/theme";
import type { Stage } from "../stage";
import { wait, tween, easeIn, easeInOut, easeOut, reducedMotion } from "../table/animation";
import { paintPiece } from "../table/appearance";
import type { Table } from "../table/table";
import { glowFilter } from "./filters";
import { HoverTilt } from "./hover";
import { Card3D, Effects, FoilFilter } from "./index";
import { random } from "./random";
import { TINT_COLORS } from "./tints";

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

/** La carta appena posata resta accesa sul campo un attimo, prima della scena grande. */
const LAND_GLOW_MS = 650;
/** L'Oggetto assegnato che va dietro la sua Entità: la copia si dissolve (2026-09-13). */
const TUCK_MS = 320;
/** Il flip del Nexus: lo zoom massimo e i tempi dei cinque passi (dentro, carica, giro, luce, fuori). */
const NEXUS_ZOOM_MAX = 2.6;
const NEXUS_IN_MS = 650;
const NEXUS_CHARGE_MS = 320;
const NEXUS_TURN_MS = 720;
const NEXUS_GLOW_MS = 700;
const NEXUS_OUT_MS = 600;
/** I fasci rossi del flip: partono a metà giro e si spengono prima della fine dello zoom indietro. */
const NEXUS_BEAMS_MS = 1100;
/** Fra una battaglia e l'altra della risoluzione: un respiro, poi il prossimo attaccante. */
const BATTLE_GAP_MS = 180;

export class Director {
  /** Le giocate e i flip in corso: la scena grande aspetta che finiscano (scene.ts, waitBefore), il bot pure. */
  private readonly running = new Set<Promise<void>>();
  /** La Reattiva messa in scena prima di giocarla (stageReactive): la carta è già al centro, la giocata non la fa rivolare dalla mano. */
  private staged: { uid: string; ready: Promise<void>; done(): void } | null = null;
  readonly effects: Effects;
  private readonly foil = new FoilFilter(0.6);
  private time = 0;
  /** Il passaggio sopra le carte: la copia in prospettiva che s'inclina (effects/hover.ts). */
  private readonly hover: HoverTilt;
  private phaseKey: string | null = null;
  private finished = false;
  private readonly lastSpell = new Map<string, number>();
  /** L'ingresso dei Rubyfront è in arrivo: le fasi non si annunciano (lo fa la sessione, a ingresso finito). */
  entrancePending = false;

  constructor(
    private readonly stage: Stage,
    private readonly table: Table,
    private readonly ctx: Ctx,
    private readonly release: () => { uid: string; at: number; x?: number; y?: number } | null,
    private readonly hits: TableHits
  ) {
    this.effects = new Effects(stage);
    // Sopra il tavolo ma sotto scene, insegna e dado; l'atmosfera sopra il fondo, sotto le carte.
    stage.world.addChildAt(this.effects.overlay, stage.world.getChildIndex(table.root) + 1);
    table.root.addChildAt(this.effects.below, 1);
    stage.app.ticker.add(ticker => {
      this.time += ticker.deltaMS / 1000;
      this.foil.time = this.time;
      this.hover.update(ticker.deltaMS / 1000);
    });
    // Il passaggio: la carta in prospettiva che s'inclina verso il puntatore (effects/hover.ts); il foil segue la stessa luce.
    this.hover = new HoverTilt(stage, table);
    this.hover.onLight = (dx, dy) => this.foil.light(dx, dy);
    table.onCard(cardEvent => {
      if (cardEvent.type === "over") this.hover.over(cardEvent.uid);
      else if (cardEvent.type === "out") this.hover.out(cardEvent.uid);
      else if (cardEvent.type === "grab") this.hover.drop(cardEvent.uid);
    });
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

  /** Dopo ogni ridisegno: il foil delle Uniche, la lama di una fase nuova, lo scoppio della fine. */
  afterPaint(state: GameState): void {
    for (const card of Object.values(state.cards)) {
      if ((card.zone !== "field" && card.zone !== "hand") || !isUnique(card.cardId) || this.table.lookOf(card.uid)?.back) continue;
      this.table.view(card.uid)?.setSheen(this.foil);
    }
    const key = `${state.turn}|${state.active}|${state.phase}`;
    if (this.phaseKey !== null && key !== this.phaseKey && !this.entrancePending && !state.over) {
      const tone = TONES[state.phase] ?? 0xd24a64;
      // Come l'insegna: la lama della fase nuova passa a tavolo fermo, dopo la risoluzione o la giocata in corso.
      if (this.isBusy()) void this.idle().then(() => void this.effects.lightBlade(tone));
      else void this.effects.lightBlade(tone);
    }
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

  /** Si risolve quando le giocate e i flip in corso sono finiti: la carta posata e accesa, poi la scena. */
  idle(): Promise<void> {
    return Promise.all([...this.running]).then(() => undefined);
  }

  /** Una giocata o un flip ancora in corso (la quiete del tavolo: il bot non gioca sopra). */
  isBusy(): boolean {
    return this.running.size > 0;
  }

  private track(run: Promise<void>): void {
    this.running.add(run);
    void run.catch(() => undefined).finally(() => this.running.delete(run));
  }

  /**
   * §7.2 — la Reattiva col bersaglio (gestures.ts, stageReactive): lascia la
   * mano e vola al centro, nel posto che avrà in catena, e si accende; la
   * scena e la mira aspettano che sia arrivata (idle). Giocata, il tavolo la
   * mette in catena lì dov'è (played); con `cancel` torna in mano.
   */
  stageReactive(card: CardInstance): { cancel(): void } | null {
    const from = this.table.box(card.uid);
    const spot = this.table.chainSpot((this.ctx.state().chain?.stack ?? []).length);
    const view = this.table.view(card.uid);
    if (!from || !spot || !view || reducedMotion()) return null;
    let card3d: Card3D | null = null;
    const done = (): void => {
      card3d?.destroy({ children: true });
      card3d = null;
      if (!view.destroyed) view.visible = true;
    };
    const ready = (async () => {
      const texture = await Promise.race([faceTexture(card.cardId, card.face, this.ctx.locale(), 0.6 * this.pixelRatio()), wait(300).then(() => null)]);
      if (!texture || view.destroyed) return;
      const start = center(from);
      const to = center(spot);
      card3d = new Card3D(texture, from.w, from.h);
      card3d.position.set(start.x, start.y);
      this.effects.overlay.addChild(card3d);
      view.visible = false;
      const grow = spot.w / from.w;
      playWhoosh(520);
      await tween(this.stage.app.ticker, 520, k => {
        if (!card3d) return;
        card3d.position.set(start.x + (to.x - start.x) * k, start.y + (to.y - start.y) * k - Math.sin(k * Math.PI) * 140);
        card3d.scale.set((1 + (grow - 1) * k) * (1 + 0.2 * Math.sin(k * Math.PI)));
      }, easeOut);
      if (!card3d) return;
      playSocket(cardTint(card.cardId), 0.85);
      // Al centro si accende: l'alone d'oro della catena e la tinta della Materia.
      card3d.filters = [glowFilter(0xffcf7a, 2.5)];
      void this.effects.spells.aura(cardTint(card.cardId), to.x, to.y, spot.w, spot.h);
      await wait(LAND_GLOW_MS);
    })();
    this.track(ready);
    this.staged = { uid: card.uid, ready, done };
    return {
      cancel: () => {
        if (this.staged?.uid === card.uid) this.staged = null;
        void ready.then(async () => {
          const back = this.table.box(card.uid);
          const piece = card3d;
          if (piece && back) {
            const start = { x: piece.x, y: piece.y };
            const to = center(back);
            const scale = piece.scale.x;
            piece.filters = [];
            await tween(this.stage.app.ticker, 360, k => {
              piece.position.set(start.x + (to.x - start.x) * k, start.y + (to.y - start.y) * k);
              piece.scale.set(scale + (1 - scale) * k);
            }, easeOut);
          }
          done();
        });
      },
    };
  }

  /** La giocata: dalla mano (o, per l'avversario, dall'alto) in arco fino allo slot, poi l'impatto. */
  private played(card: CardInstance): () => void {
    // La Reattiva già al centro (stageReactive): niente arco; si toglie la sua copia e resta la carta in catena, con l'impatto.
    const staged = this.staged?.uid === card.uid ? this.staged : null;
    if (staged) {
      this.staged = null;
      return () =>
        this.track(staged.ready.then(() => {
          staged.done();
          const box = this.table.box(card.uid);
          if (box) void this.effects.hits.impact(box.x + box.w / 2, box.y + box.h / 2, box.w, box.h, 0.8);
        }));
    }
    const isMine = card.owner === this.ctx.seat();
    const release = this.release();
    const dragged = release !== null && release.uid === card.uid && Date.now() - release.at < 800;
    const from = isMine && !dragged ? (this.table.box(card.uid) ?? null) : null;
    const face = faceTexture(card.cardId, card.face, this.ctx.locale(), 0.6 * this.pixelRatio());
    const dropAt = dragged && release?.x !== undefined && release.y !== undefined ? { x: release.x, y: release.y } : null;
    return () => this.track(this.flyAndLand(card, from, !dragged, face, dropAt));
  }

  private async flyAndLand(card: CardInstance, from: Box | null, withArc: boolean, face: Promise<Texture | null>, dropAt: XY | null = null): Promise<void> {
    const box = this.table.box(card.uid);
    if (!box) return;
    const arrival = center(box);
    const view = this.table.view(card.uid);
    // L'Oggetto assegnato (§3.1) va dietro la sua Entità: la copia che vola
    // — o quella lasciata col trascinamento — si dissolve sopra di lei, e
    // sotto resta lui, al suo posto (2026-09-13: prima spariva di colpo).
    const tucked = cardStats(card.cardId).kind === "object" && !!this.ctx.state().cards[card.uid]?.assignedTo;
    const flies = withArc || (tucked && dropAt !== null);
    const texture = flies && !reducedMotion() ? await Promise.race([face, wait(250).then(() => null)]) : null;
    if (texture && view && !view.destroyed) {
      const departure = withArc ? (from ? center(from) : { x: arrival.x, y: arrival.y - 380 }) : dropAt ?? arrival;
      const card3d = new Card3D(texture, box.w, box.h);
      card3d.position.set(departure.x, departure.y);
      this.effects.overlay.addChild(card3d);
      view.visible = false;
      const direction = arrival.x >= departure.x ? 1 : -1;
      const rise = Math.min(260, Math.hypot(arrival.x - departure.x, arrival.y - departure.y) * 0.45);
      if (withArc) {
        playWhoosh(480);
        await tween(this.stage.app.ticker, 480, k => {
          card3d.position.set(departure.x + (arrival.x - departure.x) * k, departure.y + (arrival.y - departure.y) * k - Math.sin(k * Math.PI) * rise);
          card3d.scale.set(1 + 0.35 * Math.sin(k * Math.PI));
          card3d.rotateTo(-0.55 * (1 - k), 0.7 * direction * (1 - k), -0.15 * direction * (1 - k));
        });
      }
      if (tucked) {
        if (!view.destroyed) view.visible = true;
        const start = { x: card3d.x, y: card3d.y };
        await tween(this.stage.app.ticker, TUCK_MS, k => {
          card3d.alpha = 1 - k;
          card3d.position.set(start.x + (arrival.x - start.x) * k, start.y + (arrival.y - start.y) * k);
        }, easeOut);
      }
      card3d.destroy({ children: true });
      if (!view.destroyed) view.visible = true;
    }
    // L'incastonamento suona all'urto, non alla giocata: la carta è appena arrivata.
    playSocket(cardTint(card.cardId), cardStats(card.cardId).kind === "entity" ? 1 : 0.85);
    void this.effects.hits.impact(arrival.x, arrival.y, box.w, box.h, cardStats(card.cardId).kind === "entity" ? 1 : 0.8);
    // Una Materia che scende accende la sua tinta.
    if (cardStats(card.cardId).kind === "matter") void this.effects.spells.aura(cardTint(card.cardId), arrival.x, arrival.y, box.w, box.h);
    // Posata, la carta si accende sul campo; poi la scena grande (che aspetta idle()).
    this.table.light(card.uid, true);
    await wait(LAND_GLOW_MS);
    this.table.light(card.uid, false);
  }

  /** Il Rubyfront che si posa (lo schieramento, l'atterraggio dell'ingresso): l'impatto grande e la sua tinta. */
  landing(uid: string, strength = 1.5, sound = true): void {
    const card = this.ctx.state().cards[uid];
    const box = this.table.box(uid);
    if (!card || !box) return;
    const c = center(box);
    // L'ingresso dei due Rubyfront a inizio partita si posa in silenzio (scelta del designer, 2026-09-12); lo schieramento suona.
    if (sound) playSocket(cardTint(card.cardId), 1.3);
    void this.effects.hits.impact(c.x, c.y, box.w, box.h, strength);
    void this.effects.spells.aura(cardTint(card.cardId), c.x, c.y, box.w, box.h);
  }

  /** Il flip: la carta gira in 3D, a metà giro la faccia nuova, poi il lampo d'oro. */
  /**
   * Il flip verso il Nexus (§3.1), cinematico (2026-09-14, «parte
   * un'animazione figa: zoom sulla carta Rubyfront, flip, illumina, zoom out
   * e poi mostra la carta con Continua / Risolvi»). Il tavolo si spegne e la
   * camera va sulla carta, che si solleva e si carica di luce; gira — a metà
   * giro la faccia del Nexus, il lampo nella tinta, lo scoppio, il colpo —;
   * e dal giro partono i fasci rossi che le si avvolgono attorno (come in
   * Cuore della Scissione), con l'aura e le scintille; la camera torna
   * indietro e la carta si posa. La carta sta al centro dello schermo; oltre
   * il tavolo il velo e la vignetta scuri. La scena grande del flip aspetta
   * la fine (scene.waitBefore → idle).
   */
  private flip(card: CardInstance, face: number, box: Box): () => void {
    // Le facce si dipingono alla misura dello zoom: da vicino restano nitide.
    const res = (box.w / CARD_W) * this.pixelRatio() * NEXUS_ZOOM_MAX;
    const before = faceTexture(card.cardId, card.face, this.ctx.locale(), res);
    const nextFace = faceTexture(card.cardId, face, this.ctx.locale(), res);
    return () =>
      this.track((async () => {
        const [a, b] = await Promise.all([before, nextFace]);
        const view = this.table.view(card.uid);
        const here = this.table.box(card.uid) ?? box;
        if (!a || !b || !view || view.destroyed || reducedMotion()) return;
        const c = center(here);
        const v = this.stage.visible();
        const zoom = Math.max(1.4, Math.min(NEXUS_ZOOM_MAX, (v.height * 0.52) / here.h));
        const tint = cardTint(card.cardId);
        const colors = TINT_COLORS[tint];
        const camera = this.effects.camera;
        const ticker = this.stage.app.ticker;
        // Il velo sul resto del tavolo (e oltre: con la carta al centro, lo
        // zoom scopre il fondo), la vignetta attorno, i fasci dietro e davanti.
        const veil = new Graphics().rect(v.x - v.width, v.y - v.height, v.width * 3, v.height * 3).fill({ color: 0x05040a, alpha: 0.64 });
        veil.alpha = 0;
        const shade = new Sprite(vignette());
        shade.anchor.set(0.5);
        shade.position.set(c.x, c.y);
        // Trasparente attorno alla carta, scura verso gli angoli dello schermo zoomato.
        shade.width = shade.height = here.h * 4.2;
        shade.alpha = 0;
        const behind = new Container({ label: "nexus-beams-behind" });
        const ahead = new Container({ label: "nexus-beams-ahead" });
        const card3d = new Card3D(a, here.w, here.h, 900);
        card3d.setBack(b);
        card3d.position.set(c.x, c.y);
        const glow = glowFilter(colors[0] ?? 0xffe0a0, 0);
        card3d.filters = [glow];
        this.effects.overlay.addChild(veil, shade, behind, card3d, ahead);
        // Sopra tutto il tavolo, anche i tasti dei gesti (Schiera, il velo coi tasti): li copre il velo.
        this.effects.toTop();
        view.visible = false;
        try {
          // 1. La camera va sulla carta, che si solleva appena.
          playWhoosh(650);
          await tween(ticker, NEXUS_IN_MS, k => {
            camera.focus(c, zoom, k);
            veil.alpha = shade.alpha = k;
            card3d.scale.set(1 + 0.06 * k);
            card3d.rotateTo(-0.08 * k, 0);
          }, easeInOut);
          // 2. Il respiro: la carta si carica di luce e si inclina, pronta a girare.
          await tween(ticker, NEXUS_CHARGE_MS, k => {
            glow.outerStrength = 3 * k;
            card3d.rotateTo(-0.08, -0.14 * k);
          }, easeOut);
          // 3. Il giro: a metà la faccia del Nexus, il lampo, lo scoppio, il colpo.
          let turned = false;
          await tween(ticker, NEXUS_TURN_MS, k => {
            const e = easeInOut(k);
            card3d.rotateTo(-0.08 * (1 - e), -0.14 + (Math.PI + 0.14) * e);
            card3d.scale.set(1.06 + 0.16 * Math.sin(k * Math.PI));
            if (!turned && k >= 0.5) {
              turned = true;
              camera.flash(colors[1] ?? 0xffffff, 0.5, 440);
              camera.shake(0.35);
              this.effects.spells.explode(c, [...colors, 0xffe0a0], 1.6);
              playSocket(tint, 1.5);
              // I fasci rossi: attraversano lo schermo zoomato e avvolgono la carta.
              void beams(ticker, behind, ahead, c, (v.width / zoom) * 1.35, here.h * 0.62, NEXUS_BEAMS_MS);
            }
          });
          // 4. La luce: i fasci che corrono, l'aura, le scintille che salgono.
          void this.effects.spells.aura(tint, c.x, c.y, here.w * 1.06, here.h * 1.06);
          this.effects.particles.burst({ x: c.x, y: c.y, n: 56, shape: "dot", colors, velocity: [40, 150], angle: [-Math.PI, 0], life: [600, 1300], scale: [0.18, 0.5], gravity: -40, scatter: here.w * 0.45, sway: 16 });
          await tween(ticker, NEXUS_GLOW_MS, k => {
            glow.outerStrength = 3 + 2.5 * Math.sin(k * Math.PI);
            card3d.scale.set(1.06 + 0.02 * Math.sin(k * Math.PI));
          });
          // 5. La camera torna indietro, la carta si posa.
          await tween(ticker, NEXUS_OUT_MS, k => {
            camera.focus(c, zoom, 1 - k);
            veil.alpha = shade.alpha = 1 - k;
            card3d.scale.set(1.06 - 0.06 * k);
            glow.outerStrength = 3 * (1 - k);
          }, easeInOut);
        } finally {
          camera.focus(c, 1, 0);
          veil.destroy();
          shade.destroy();
          behind.destroy({ children: true });
          ahead.destroy({ children: true });
          card3d.destroy({ children: true });
          if (!view.destroyed) view.visible = true;
        }
        void this.effects.hits.impact(c.x, c.y, here.w, here.h, 0.9);
        playSocket(tint, 0.8);
      })());
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
    // Seguita come le giocate: finché gli attaccanti scattano, le scene aspettano e il bot pure (idle, isBusy).
    return () => {
      // I PV delle testate restano dove sono e scalano a ogni colpo che arriva (countHp); finita la risoluzione, fino allo stato.
      const release = this.table.holdHp();
      this.track(this.playResolution(battles, fallenSnapshots, clashes).catch(error => console.warn("regia", error)).finally(release));
    };
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
    // Una battaglia per volta (2026-09-12): tutte insieme — scatti, scie, urti,
    // scosse, schegge — appesantivano il tavolo fino a farlo scattare. I
    // caduti delle battaglie che vengono dopo restano in piedi (controfigure)
    // finché non tocca a loro.
    const playBattle = async ({ b, attacker, target, targetUid }: (typeof battles)[number]): Promise<void> => {
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
            const defender = targetUid ? this.ctx.state().cards[targetUid]?.owner : undefined;
            if (defender) this.table.countHp(defender, -b.damage);
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
    };
    for (const [index, battle] of battles.entries()) {
      if (index > 0) await wait(BATTLE_GAP_MS);
      await playBattle(battle);
    }
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

/**
 * I fasci del flip del Nexus (2026-09-14, «al flip vorrei dei fasci come in
 * Cuore della Scissione, ma rossi»): nastri di luce sinuosi che attraversano
 * lo schermo e si avvolgono attorno alla carta — metà dietro, metà davanti —
 * con l'alone, il filo acceso e un crepitio sottile che trema lungo il filo.
 * Corrono da un capo all'altro, ondeggiano, e la coda li raggiunge.
 */
function beams(ticker: Ticker, behind: Container, ahead: Container, c: XY, span: number, reach: number, ms: number): Promise<void> {
  const [halo, thread, spark] = TINT_COLORS.destructive;
  const layer = (parent: Container): { glow: Graphics; core: Graphics } => {
    const glow = new Graphics();
    glow.blendMode = "add";
    glow.filters = [new BlurFilter({ strength: 10, quality: 3 })];
    const core = new Graphics();
    core.blendMode = "add";
    parent.addChild(glow, core);
    return { glow, core };
  };
  const back = layer(behind);
  const front = layer(ahead);
  const strands = Array.from({ length: 6 }, (_, index) => ({
    angle: -0.5 + (index / 5) * 1.0 + (random() - 0.5) * 0.25,
    offset: (random() - 0.5) * reach * 0.9,
    amp: reach * (0.35 + random() * 0.45) * (index % 2 ? -1 : 1),
    waves: 0.7 + random() * 0.9,
    phase: random() * Math.PI * 2,
    speed: 2.5 + random() * 2.5,
    width: 2.2 + random() * 2.2,
    front: index % 2 === 0,
    reverse: index % 3 === 0,
  }));
  const STEPS = 44;
  const at = (strand: (typeof strands)[number], u: number, time: number, jitter = 0): XY => {
    const dx = Math.cos(strand.angle);
    const dy = Math.sin(strand.angle);
    const along = (u - 0.5) * span;
    // Più aperto al centro, dove si avvolge alla carta; più teso ai capi.
    const off = strand.offset + strand.amp * Math.sin(strand.waves * Math.PI * 2 * u + strand.phase + time * strand.speed) * (0.45 + 0.55 * Math.sin(Math.PI * u)) + jitter;
    return { x: c.x + dx * along - dy * off, y: c.y + dy * along + dx * off };
  };
  return tween(ticker, ms, k => {
    if (back.glow.destroyed || front.glow.destroyed) return;
    const time = (k * ms) / 1000;
    const head = Math.min(1, easeOut(Math.min(1, k / 0.42)));
    const tail = k < 0.5 ? 0 : easeIn((k - 0.5) / 0.5);
    const alpha = k > 0.68 ? Math.max(0, (1 - k) / 0.32) : 1;
    for (const g of [back, front]) {
      g.glow.clear();
      g.core.clear();
    }
    for (const strand of strands) {
      const g = strand.front ? front : back;
      const from = strand.reverse ? 1 - head : tail;
      const to = strand.reverse ? 1 - tail : head;
      if (to - from < 0.01) continue;
      const path = (target: Graphics, jitter: number): void => {
        for (let step = 0; step <= STEPS; step += 1) {
          const p = at(strand, from + ((to - from) * step) / STEPS, time, jitter ? (random() - 0.5) * jitter : 0);
          if (step === 0) target.moveTo(p.x, p.y);
          else target.lineTo(p.x, p.y);
        }
      };
      path(g.glow, 0);
      g.glow.stroke({ color: halo!, width: strand.width * 7, alpha: 0.55 * alpha, cap: "round", join: "round" });
      path(g.core, 0);
      g.core.stroke({ color: thread!, width: strand.width, alpha, cap: "round", join: "round" });
      // Il crepitio: un filo sottile che trema attorno al filo acceso.
      path(g.core, strand.width * 3.2);
      g.core.stroke({ color: spark!, width: 0.8, alpha: 0.75 * alpha, cap: "round", join: "round" });
    }
  }).then(() => {
    for (const g of [back, front]) {
      if (!g.glow.destroyed) g.glow.destroy();
      if (!g.core.destroyed) g.core.destroy();
    }
  });
}

let vignetteTexture: Texture | null = null;

/** La vignetta del flip: trasparente attorno alla carta, scura verso i bordi (copre anche l'orlo del tavolo che lo zoom scopre). */
function vignette(): Texture {
  vignetteTexture ??= paintPiece(256, 256, 1, ctx => {
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, "rgba(5,4,10,0)");
    gradient.addColorStop(0.34, "rgba(5,4,10,0)");
    gradient.addColorStop(0.8, "rgba(5,4,10,.85)");
    gradient.addColorStop(1, "rgba(5,4,10,1)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
  });
  return vignetteTexture;
}
