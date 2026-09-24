// La ricompensa a fine partita (2026-09-24): l'overlay della progressione
// del Rubyfront giocato. Sopra tutto (app.stage: l'header resta sotto il velo
// e non si tocca), col fondo sfocato. Al centro la carta, aggiornata con le
// abilità montate, in prospettiva; attorno l'anello dell'esperienza, che si
// riempie piano dal punto in cui si era fino a dove si arriva, con la testa
// luminosa e le scintille che le corrono dietro; sopra l'esito, in basso il
// contatore che sale e la riga «xp / prossimo livello». Se si sale di
// livello: l'anello si chiude, il lampo, l'esplosione di scintille, la
// scossa, il numero del livello che scatta, e l'anello riparte da zero con
// quel che resta. In fondo «Continua» (o Esc); il velo prende i tocchi e
// non chiude: l'header sotto non si raggiunge.

import { cardName } from "@rubyfront/core/cards";
import { t } from "@rubyfront/core/i18n";
import { abilityOf, abilityWords, progressionOf, progressionRules, xpSpan, type Outcome, type PlayerProgress } from "@rubyfront/core/progression";
import { BlurFilter, Container, Graphics, Sprite, Texture } from "pixi.js";
import { resolutionStep } from "../../card/cache";
import { paintCard } from "../../card/index";
import type { FaceOverrides } from "../../card/model";
import { type Font } from "../../card/text";
import { CARD_H, CARD_W } from "../../card/theme";
import { glowFilter } from "../../effects/filters";
import { Particles } from "../../effects/particles";
import { Card3D } from "../../effects/projection";
import { shape } from "../../effects/shapes";
import type { Stage } from "../../stage";
import { ease, easeIn, easeInOut, easeOut, key, reducedMotion, tween, wait } from "../../table/animation";
import { SANS } from "../../table/appearance";
import { below, setBlurred } from "../../table/night";
import { playSocket, playWhoosh } from "../../sound";
import { ACTION_EDGE, ACTION_LABEL, INK, MUTED, RUBY, Button, paintText } from "../ui";
import { Anim, centered, gemTexture, haloTexture } from "./fx";

const KICKER: Font = { size: 14, weight: 700, family: SANS, spacing: 14 * 0.22, upper: true };
const TITLE: Font = { size: 34, weight: 700, family: SANS, spacing: 34 * 0.16, upper: true };
const GAINED: Font = { size: 28, weight: 700, family: SANS };
const BODY: Font = { size: 15, weight: 400, family: SANS };
const LEVEL_FONT: Font = { size: 16, weight: 700, family: SANS, spacing: 16 * 0.14, upper: true };
/** L'anello: raggio e spessore; la carta dentro. */
const RING_R = 210;
const RING_W = 12;
const CARD_HEIGHT = 300;
/** Quanto ci mette un anello intero a riempirsi; un tratto parziale in proporzione, con un minimo. */
const FULL_RING_MS = 3200;
const MIN_FILL_MS = 1100;

export interface RewardShow {
  card: string;
  /** L'esperienza prima e dopo, con la progressione arrivata dal tavolo (già aggiornata). */
  gained: number;
  outcome: Outcome;
  after: PlayerProgress;
  locale: string;
}

/** Le particelle dell'overlay, una per pagina. */
let particles: Particles | null = null;
const particleLayer = new Container({ label: "reward-particles" });

export class RewardOverlay {
  private readonly root = new Container({ label: "reward" });
  private readonly content = new Container({ label: "reward-content" });
  private readonly veil = new Graphics();
  private readonly flash = new Graphics();
  private readonly ringTrack = new Graphics();
  private readonly ringFill = new Graphics();
  private readonly ringGlow = new Graphics();
  private readonly head = new Sprite(shape("dot"));
  private card: Card3D | null = null;
  private counter: Sprite | null = null;
  private counterShown = -1;
  private levelText: Sprite | null = null;
  private levelGem: Sprite | null = null;
  private levelHalo: Sprite | null = null;
  private xpLine: Sprite | null = null;
  private unblur: (() => void) | null = null;
  private closed = false;
  private resolveClose: (() => void) | null = null;
  private readonly tick = (): void => this.step();
  /** Lo stato animato: la frazione dell'anello e il contatore. */
  private ringK = 0;
  private readonly shownXp = new Anim(0);
  private center = { x: 0, y: 0 };
  private lastHead = { x: 0, y: 0 };
  private trailAt = 0;
  private lastNow = performance.now();

  constructor(
    private readonly stage: Stage,
    private readonly show: RewardShow
  ) {}

  /** Apre, anima, e aspetta «Continua» (o Esc, o il velo). */
  open(): Promise<void> {
    const { stage } = this;
    const screen = stage.app.screen;
    this.content.position.copyFrom(stage.screens.position);
    this.content.scale.copyFrom(stage.screens.scale);
    this.veil.rect(0, 0, screen.width, screen.height).fill({ color: 0x080608, alpha: 0.86 });
    this.veil.eventMode = "static";
    this.veil.alpha = 0;
    this.flash.rect(0, 0, screen.width, screen.height).fill(0xffffff);
    this.flash.alpha = 0;
    this.flash.eventMode = "none";
    this.root.addChild(this.veil, this.content, this.flash);
    stage.app.stage.addChild(this.root);
    this.unblur = setBlurred(stage, below(stage.app.stage, this.root), 5);
    if (!particles) particles = new Particles(stage, particleLayer);
    if (particleLayer.parent) particleLayer.parent.removeChild(particleLayer);
    stage.app.ticker.add(this.tick);
    window.addEventListener("keydown", this.onKey);
    this.root.eventMode = "static";
    void tween(stage.app.ticker, 260, k => (this.veil.alpha = k), easeOut);
    void this.play();
    return new Promise(resolve => {
      this.resolveClose = resolve;
    });
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.close();
  };

  // ---------------------------------------------------------------- scena
  private async play(): Promise<void> {
    const { stage, show } = this;
    const v = stage.visible();
    const res = v.scale * stage.app.renderer.resolution;
    const rules = progressionRules();
    const cx = v.x + v.width / 2;
    const cy = v.y + v.height / 2 - 20;
    this.center = { x: cx, y: cy };
    const ticker = stage.app.ticker;
    // L'anello: la traccia, il riempimento con l'alone sfocato, la testa.
    this.ringTrack.circle(cx, cy, RING_R).stroke({ color: 0x2a2226, width: RING_W });
    this.ringTrack.circle(cx, cy, RING_R + RING_W / 2 + 6).stroke({ color: 0x3a3037, width: 1, alpha: 0.6 });
    this.ringGlow.filters = [new BlurFilter({ strength: 10, quality: 3 })];
    this.ringGlow.blendMode = "add";
    this.head.anchor.set(0.5);
    this.head.blendMode = "add";
    this.head.tint = 0xffd6de;
    this.head.scale.set(0.9);
    this.head.alpha = 0;
    this.content.addChild(this.ringTrack, this.ringGlow, this.ringFill, this.head);
    // La carta al centro, aggiornata con le abilità montate.
    const cardW = (CARD_HEIGHT * CARD_W) / CARD_H;
    const paintRes = resolutionStep((cardW / CARD_W) * res);
    const texture = (await Promise.race([this.paintFace(paintRes), wait(900).then(() => null)])) ?? Texture.WHITE;
    if (this.closed) return;
    const card = new Card3D(texture, cardW, CARD_HEIGHT, 1400);
    card.position.set(cx, cy);
    card.filters = [glowFilter(0xff4d6d, 1.4)];
    card.alpha = 0;
    card.scale.set(0.82);
    this.content.addChild(card);
    this.card = card;
    this.content.addChild(particleLayer);
    // Le scritte: l'esito sopra, il nome della carta, il livello sull'anello, il contatore e la riga sotto.
    const kicker = paintText(stage, t(`reward.outcome.${show.outcome}`), KICKER, show.outcome === "win" ? ACTION_EDGE : MUTED);
    kicker.sprite.position.set(cx - kicker.w / 2, cy - RING_R - 150);
    const title = paintText(stage, cardName(show.card, show.locale), TITLE, INK, { shadows: [{ x: 0, y: 0, blur: 22, color: "rgba(210,74,100,.45)" }] });
    title.sprite.position.set(cx - title.w / 2, cy - RING_R - 128);
    const startXp = Math.max(0, show.after.xp - show.gained);
    const startLevel = rules ? levelAt(startXp, rules.thresholds) : show.after.level;
    this.placeLevel(startLevel, res);
    const gained = paintText(stage, t("reward.gained", { n: show.gained }), GAINED, ACTION_LABEL, { shadows: [{ x: 0, y: 0, blur: 18, color: "rgba(210,74,100,.5)" }] });
    gained.sprite.position.set(cx - gained.w / 2, cy + RING_R + 34);
    gained.sprite.alpha = 0;
    const continueButton = new Button(stage, { label: t("reward.continue"), style: "metal", h: 46, onTap: () => this.close() });
    continueButton.position.set(cx - continueButton.w / 2, cy + RING_R + 118);
    continueButton.alpha = 0;
    for (const sprite of [kicker.sprite, title.sprite]) {
      sprite.alpha = 0;
      this.content.addChild(sprite);
    }
    this.content.addChild(gained.sprite, continueButton);
    this.shownXp.snap(startXp);
    this.paintCounter(startXp, rules ? xpSpan(startLevel, rules).to : null);
    // L'entrata: l'esito e il nome scendono, la carta cresce e si raddrizza, l'anello si accende.
    playWhoosh(500);
    void tween(ticker, 420, k => {
      kicker.sprite.alpha = k;
      kicker.sprite.position.y = cy - RING_R - 150 - 12 * (1 - k);
    }, easeOut);
    void wait(120).then(() =>
      tween(ticker, 460, k => {
        title.sprite.alpha = k;
        title.sprite.position.y = cy - RING_R - 128 - 12 * (1 - k);
      }, easeOut)
    );
    await tween(ticker, 560, k => {
      if (card.destroyed) return;
      card.alpha = k;
      card.scale.set(0.82 + 0.18 * k);
      card.rotateTo(-0.35 * (1 - k), 0.5 * (1 - k));
    }, easeOut);
    if (this.closed) return;
    void tween(ticker, 380, k => (gained.sprite.alpha = k), easeOut);
    // Il riempimento, livello per livello.
    if (rules) {
      let xp = startXp;
      let level = startLevel;
      const target = show.after.xp;
      const total = Math.max(1, show.after.level - startLevel + 1);
      void total;
      while (xp < target && !this.closed) {
        const span = xpSpan(level, rules);
        const from = span.from;
        const to = span.to;
        if (to === null) {
          // Livello massimo: l'anello resta pieno, il contatore sale fino alla meta.
          await this.fill(1, 1, xp, target, Math.max(MIN_FILL_MS, ((target - xp) / 500) * FULL_RING_MS), null);
          xp = target;
          break;
        }
        const stop = Math.min(target, to);
        const k0 = (xp - from) / (to - from);
        const k1 = (stop - from) / (to - from);
        await this.fill(k0, k1, xp, stop, Math.max(MIN_FILL_MS, (k1 - k0) * FULL_RING_MS), to);
        xp = stop;
        if (stop === to && !this.closed) {
          level += 1;
          await this.levelUp(level, res, rules.thresholds);
        }
      }
    } else {
      this.ringK = 1;
    }
    if (this.closed) return;
    void tween(ticker, 360, k => {
      if (continueButton.destroyed) return;
      continueButton.alpha = k;
      continueButton.position.y = cy + RING_R + 118 + 10 * (1 - k);
    }, easeOut);
  }

  /** La faccia A col le abilità montate, come nella sferografia. */
  private async paintFace(res: number): Promise<Texture | null> {
    const { show } = this;
    const card = progressionOf(show.card);
    const overrides: FaceOverrides = {
      abilities: (show.after.loadout.rubyfront ?? []).map(id => {
        if (!id) return null;
        const found = abilityOf(card, id);
        return found ? abilityWords(found.ability, show.locale) : null;
      }),
    };
    const painted = await paintCard(show.card, "rubyfront", show.locale, res, overrides);
    return painted ? Texture.from({ resource: painted.canvas, resolution: res, width: CARD_W, height: CARD_H }) : null;
  }

  /** Un tratto di anello, da k0 a k1, col contatore che sale da xp0 a xp1. */
  private fill(k0: number, k1: number, xp0: number, xp1: number, ms: number, next: number | null): Promise<void> {
    this.ringK = k0;
    this.shownXp.snap(xp0);
    this.head.alpha = 1;
    return tween(
      this.stage.app.ticker,
      ms,
      k => {
        this.ringK = k0 + (k1 - k0) * k;
        this.shownXp.snap(xp0 + (xp1 - xp0) * k);
        this.paintCounter(Math.round(this.shownXp.v), next);
      },
      easeInOut
    );
  }

  /** Il salto di livello: il lampo, le scintille, la scossa, il numero che scatta; l'anello riparte da zero. */
  private async levelUp(level: number, res: number, thresholds: number[]): Promise<void> {
    const ticker = this.stage.app.ticker;
    const { x, y } = this.center;
    playSocket("destructive", 1.4);
    this.flashScreen(0.45);
    particles?.burst({ x, y, n: 90, shape: "spark", colors: [0xff4d6d, 0xff9fb3, 0xfff0f3], velocity: [220, 620], life: [500, 1100], scale: [0.6, 1.3], gravity: 120, friction: 0.88, align: true, light: true });
    particles?.burst({ x, y, n: 40, shape: "dot", colors: [0xff4d6d, 0xffd6de], velocity: [60, 260], life: [700, 1400], scale: [0.2, 0.5], gravity: -30, friction: 0.9, light: true });
    particles?.burst({ x, y, n: 2, shape: "ring", colors: [0xff8ea6, 0xfff0f3], velocity: [0, 0], life: [640, 640], scale: [0.8, 0.8], growth: 90, light: true });
    // L'anello pieno lampeggia bianco e la carta accusa il colpo.
    const card = this.card;
    const shake = tween(ticker, 520, k => {
      const s = (1 - k) * 9;
      this.content.position.set(this.stage.screens.position.x + Math.sin(k * 40) * s, this.stage.screens.position.y + Math.cos(k * 33) * s);
      if (card && !card.destroyed) card.scale.set(key(k, [[0, 1], [0.15, 1.08], [1, 1]]));
    }, easeOut);
    this.placeLevel(level, res, true);
    await shake;
    if (this.closed) return;
    await wait(140);
    // L'anello riparte da zero: si svuota in un lampo, con l'alone che si spegne.
    await tween(ticker, 260, k => (this.ringK = 1 - k), easeIn);
    this.paintCounter(Math.round(this.shownXp.v), thresholds[level] ?? null);
  }

  private flashScreen(strength: number): void {
    void tween(this.stage.app.ticker, 420, k => (this.flash.alpha = strength * (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8)), ease);
  }

  /** La targa del livello sulla cima dell'anello: la gemma, l'alone, «Livello N». Con `pop`, scatta. */
  private placeLevel(level: number, res: number, pop = false): void {
    const { x, y } = this.center;
    const at = { x, y: y - RING_R };
    for (const old of [this.levelText, this.levelGem, this.levelHalo]) if (old && !old.destroyed) old.destroy();
    const halo = centered(haloTexture(22, res));
    halo.blendMode = "add";
    halo.position.set(at.x, at.y);
    halo.alpha = 0.5;
    const gem = centered(gemTexture(22, "current", res));
    gem.position.set(at.x, at.y);
    const text = paintText(this.stage, t("reward.level", { n: level }), LEVEL_FONT, INK, { shadows: [{ x: 0, y: 0, blur: 14, color: "rgba(210,74,100,.6)" }] });
    text.sprite.position.set(at.x - text.w / 2, at.y - 22 - 10 - text.h);
    this.content.addChild(halo, gem, text.sprite);
    this.levelHalo = halo;
    this.levelGem = gem;
    this.levelText = text.sprite;
    if (pop) {
      const ticker = this.stage.app.ticker;
      void tween(ticker, 620, k => {
        if (gem.destroyed) return;
        const s = key(k, [[0, 0.5], [0.4, 1.35], [1, 1]]);
        gem.scale.set(s);
        halo.scale.set(s * 1.3);
        text.sprite.scale.set(key(k, [[0, 0.6], [0.4, 1.15], [1, 1]]));
        text.sprite.position.set(at.x - (text.w * text.sprite.scale.x) / 2, at.y - 22 - 10 - text.h * text.sprite.scale.y);
      }, easeOut);
    }
  }

  /** Il contatore «xp / prossimo» sotto l'anello, ridipinto quando cambia. */
  private paintCounter(xp: number, next: number | null): void {
    if (xp === this.counterShown && this.counter && !this.counter.destroyed) return;
    this.counterShown = xp;
    if (this.counter && !this.counter.destroyed) this.counter.destroy();
    const words = next === null ? t("reward.xp.max", { xp }) : t("reward.xp", { xp, next });
    const line = paintText(this.stage, words, BODY, MUTED);
    line.sprite.position.set(this.center.x - line.w / 2, this.center.y + RING_R + 74);
    this.content.addChild(line.sprite);
    this.counter = line.sprite;
    void this.xpLine;
  }

  // ---------------------------------------------------------------- frame
  private step(): void {
    const now = performance.now();
    const dt = Math.min(64, now - this.lastNow);
    this.lastNow = now;
    const { x, y } = this.center;
    const k = Math.max(0, Math.min(1, this.ringK));
    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * k;
    this.ringFill.clear();
    this.ringGlow.clear();
    if (k > 0.002) {
      this.ringFill.arc(x, y, RING_R, start, end).stroke({ color: 0xff4d6d, width: RING_W, cap: "round" });
      this.ringFill.arc(x, y, RING_R, start, end).stroke({ color: 0xffb7c6, width: 2, alpha: 0.7, cap: "round" });
      this.ringGlow.arc(x, y, RING_R, start, end).stroke({ color: 0xff4d6d, width: RING_W + 10, alpha: 0.8, cap: "round" });
    }
    const hx = x + Math.cos(end) * RING_R;
    const hy = y + Math.sin(end) * RING_R;
    this.head.position.set(hx, hy);
    const breath = reducedMotion() ? 1 : 0.8 + 0.2 * Math.sin(now / 90);
    this.head.scale.set(0.9 * breath);
    // Le scintille dietro la testa, mentre corre.
    const moved = Math.hypot(hx - this.lastHead.x, hy - this.lastHead.y);
    this.lastHead = { x: hx, y: hy };
    this.trailAt -= dt;
    if (moved > 0.4 && this.head.alpha > 0 && this.trailAt <= 0 && particles && !reducedMotion()) {
      this.trailAt = 28;
      particles.burst({ x: hx, y: hy, n: 2, shape: "spark", colors: [0xff9fb3, 0xfff0f3], velocity: [20, 70], angle: [end + Math.PI - 0.6, end + Math.PI + 0.6], life: [260, 520], scale: [0.35, 0.7], friction: 0.9, align: true, light: true });
    }
    // La carta si inclina piano.
    if (this.card && !this.card.destroyed && !reducedMotion()) this.card.rotateTo(0.05 * Math.sin(now / 2600), 0.08 * Math.cos(now / 3100));
    if (this.levelHalo && !this.levelHalo.destroyed) this.levelHalo.alpha = 0.35 + 0.3 * (0.5 - 0.5 * Math.cos(now / 380));
  }

  // --------------------------------------------------------------- chiusura
  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener("keydown", this.onKey);
    this.root.eventMode = "none";
    const ticker = this.stage.app.ticker;
    void tween(ticker, 260, k => {
      this.root.alpha = 1 - k;
    }, easeIn).then(() => {
      ticker.remove(this.tick);
      this.unblur?.();
      this.unblur = null;
      if (particleLayer.parent === this.content) this.content.removeChild(particleLayer);
      this.root.destroy({ children: true });
      this.resolveClose?.();
      this.resolveClose = null;
    });
  }
}

/** Il livello a quell'esperienza, dalle soglie. */
function levelAt(xp: number, thresholds: number[]): number {
  return Math.max(1, Math.min(thresholds.length, thresholds.filter(threshold => xp >= threshold).length));
}

export { RUBY };
