// Il montaggio di un'abilità (2026-09-23, rifatto il 2026-09-24): lo zoom
// sulla faccia giusta della carta, e la scelta DEL BLOCCO STAMPATO da
// sostituire. Sopra tutto (app.stage), col fondo sfocato e il velo: la carta
// vola dal suo posto nella costellazione al centro-sinistra dello schermo
// crescendo, in prospettiva; se l'abilità è del Nexus la carta si gira (a
// metà giro, il flash). Sulla carta, i blocchi delle abilità stampate (per
// Arden: «Scintilla» e «Richiamo alla Fiamma») sono le prese: al passaggio si
// accendono, e quelle già sostituite portano sopra la targa dell'abilità
// montata. A destra il chip della nuova abilità, che alla scelta vola sul
// blocco (arco, scintille, suono) e ci lascia la sua targa. Nel modo
// «smonta» si tocca la targa da togliere e si dissolve: torna l'abilità
// stampata. Esc o il velo chiudono senza cambiare. Chi apre decide cosa fare
// col risultato e poi chiama `succeed()` o `fail()`.

import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { paintCard } from "../../card/index";
import { resolutionStep } from "../../card/cache";
import type { PlacedBlock } from "../../card/painter";
import type { FaceOverrides } from "../../card/model";
import { layout, type Font } from "../../card/text";
import { CARD_H, CARD_W } from "../../card/theme";
import { Card3D } from "../../effects/projection";
import { glowFilter } from "../../effects/filters";
import { Particles } from "../../effects/particles";
import type { Stage } from "../../stage";
import { bezier, ease, easeIn, easeInOut, easeOut, key, reducedMotion, tween, wait } from "../../table/animation";
import { CrispSprite, SANS, paintPiece } from "../../table/appearance";
import { below, setBlurred } from "../../table/night";
import { playRetire, playSocket, playWhoosh } from "../../sound";
import { t } from "@rubyfront/core/i18n";
import type { ProgressionFace } from "@rubyfront/core/progression";
import { ACTION_EDGE, INK, MUTED, paintText } from "../ui";
import { Anim, glassPanel, GLASS_MARGIN } from "./fx";

const TITLE: Font = { size: 16, weight: 700, family: SANS, spacing: 16 * 0.18, upper: true };
const CAPTION: Font = { size: 11, weight: 700, family: SANS, spacing: 11 * 0.18, upper: true };
const NAME: Font = { size: 19, weight: 700, family: SANS };
const BODY: Font = { size: 15, weight: 400, family: SANS };
const SMALL: Font = { size: 13, weight: 600, family: SANS };
const CHIP_W = 400;

export interface MountRequest {
  cardId: string;
  face: ProgressionFace;
  /** L'indice della faccia sulla carta (0 Rubyfront, 1 Nexus). */
  faceIndex: number;
  /** L'abilità da montare (nel modo «smonta» è quella già montata che si vuole togliere). */
  ability: { id: string; name: string; text: string };
  /** Al più quante prese ha la faccia (le regole); le prese vere sono i blocchi stampati. */
  capacity: number;
  /** Cosa c'è montato, per blocco (posizionale: `null` = resta l'abilità stampata). */
  mounted: ({ id: string; name: string; text: string } | null)[];
  mode: "mount" | "eject";
  /** Da dove parte la carta, in pixel dello schermo. */
  from: { x: number; y: number; width: number; height: number } | null;
  /** Le abilità montate sulla faccia A (per dipingerla aggiornata quando si gira verso il Nexus). */
  frontOverrides?: FaceOverrides;
}

export interface MountResult {
  /** Il blocco scelto (0-based, l'indice dell'abilità stampata). */
  slot: number;
}

interface Slot {
  index: number;
  /** Il riquadro del blocco, in coordinate della carta (origine al centro). */
  box: { x: number; y: number; w: number; h: number };
  highlight: Graphics;
  /** La lampada bianca del blocco, per il lampo del cambio. */
  flash: Graphics;
  hover: Anim;
}

/** Le particelle dell'overlay, una per pagina (il loro orologio resta). */
let particles: Particles | null = null;
const particleLayer = new Container({ label: "mount-particles" });

export class MountOverlay {
  private readonly root = new Container({ label: "mount" });
  private readonly content = new Container({ label: "mount-content" });
  private readonly veil = new Graphics();
  private readonly flash = new Graphics();
  private card: Card3D | null = null;
  private chip: Container | null = null;
  private chipHalo: Sprite | null = null;
  private readonly slots: Slot[] = [];
  private unblur: (() => void) | null = null;
  private resolveChoice: ((result: MountResult | null) => void) | null = null;
  private chosen: Slot | null = null;
  private busy = false;
  private closed = false;
  private readonly tick = (): void => this.step();
  private pointer: { x: number; y: number } | null = null;
  private readonly tilt = { rx: new Anim(0), ry: new Anim(0) };
  private flipped = false;
  private cardAt = { x: 0, y: 0, w: 0, h: 0 };
  /** La scala della carta zoomata rispetto alla carta stampata (520×728). */
  private cardScale = 1;
  /** La risoluzione con cui si dipinge la faccia (a gradini). */
  private paintRes = 1;
  /** Cosa c'è montato per blocco, com'è adesso (cambia dopo la scelta). */
  private mounted: ({ id: string; name: string; text: string } | null)[] = [];

  constructor(
    private readonly stage: Stage,
    private readonly locale: string,
    private readonly request: MountRequest
  ) {}

  /** Apre e aspetta la scelta del blocco (o `null`: chiuso senza scegliere). L'overlay resta aperto: poi `succeed()` o `fail()`. */
  open(): Promise<MountResult | null> {
    const { stage } = this;
    const screen = stage.app.screen;
    // Il contenuto sta nelle unità di progetto, come le schermate: stessa posa del livello `screens`.
    this.content.position.copyFrom(stage.screens.position);
    this.content.scale.copyFrom(stage.screens.scale);
    this.veil.rect(0, 0, screen.width, screen.height).fill({ color: 0x080608, alpha: 0.82 });
    this.veil.eventMode = "static";
    this.veil.alpha = 0;
    this.flash.rect(0, 0, screen.width, screen.height).fill(0xffffff);
    this.flash.alpha = 0;
    this.flash.eventMode = "none";
    this.root.addChild(this.veil, this.content, this.flash);
    stage.app.stage.addChild(this.root);
    this.unblur = setBlurred(stage, below(stage.app.stage, this.root), 4);
    if (!particles) particles = new Particles(stage, particleLayer);
    if (particleLayer.parent) particleLayer.parent.removeChild(particleLayer);
    this.content.addChild(particleLayer);
    stage.app.ticker.add(this.tick);
    window.addEventListener("keydown", this.onKey);
    this.veil.on("pointertap", () => this.cancel());
    this.root.eventMode = "static";
    this.root.on("pointermove", event => {
      this.pointer = this.content.toLocal(event.global);
    });
    void tween(stage.app.ticker, 220, k => (this.veil.alpha = k), easeOut);
    void this.arrive();
    return new Promise(resolve => {
      this.resolveChoice = resolve;
    });
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.cancel();
  };

  // ------------------------------------------------------------- entrata
  /** La carta vola dal suo posto al centro-sinistra, poi (per il Nexus) si gira; i blocchi diventano prese, il chip compare. */
  private async arrive(): Promise<void> {
    const { stage, request } = this;
    const v = stage.visible();
    const res = v.scale * stage.app.renderer.resolution;
    const bigH = Math.min(v.height * 0.64, 660);
    const bigW = (bigH * CARD_W) / CARD_H;
    const cx = v.x + v.width * 0.33;
    const cy = v.y + v.height * 0.5;
    this.cardAt = { x: cx, y: cy, w: bigW, h: bigH };
    this.cardScale = bigW / CARD_W;
    // A gradini, come la cache: una risoluzione frazionaria fa ricalcolare a Pixi i pixel del canvas, che si svuota.
    const paintRes = resolutionStep((bigW / CARD_W) * res);
    this.paintRes = paintRes;
    this.mounted = [...request.mounted];
    // La faccia da montare si dipinge qui (non dalla cache), «aggiornata» con le abilità montate: servono anche i blocchi posati.
    const [front, target] = await Promise.all([
      request.faceIndex > 0 ? Promise.race([paintCard(request.cardId, this.faceId(0), this.locale, paintRes, request.frontOverrides ?? {}), wait(900).then(() => null)]) : Promise.resolve(null),
      Promise.race([this.paintFace(), wait(900).then(() => null)]),
    ]);
    if (this.closed) return;
    const toTexture = (painted: { canvas: HTMLCanvasElement } | null): Texture | null => (painted ? Texture.from({ resource: painted.canvas, resolution: paintRes, width: CARD_W, height: CARD_H }) : null);
    const targetTexture = toTexture(target) ?? Texture.WHITE;
    const frontTexture = front ? (toTexture(front) ?? targetTexture) : targetTexture;
    const card = new Card3D(frontTexture, bigW, bigH, 1500);
    if (request.faceIndex > 0) card.setBack(targetTexture);
    this.card = card;
    this.content.addChild(card);
    card.position.set(cx, cy);
    const ticker = stage.app.ticker;
    if (request.from && !reducedMotion()) {
      const from = this.content.toLocal({ x: request.from.x + request.from.width / 2, y: request.from.y + request.from.height / 2 });
      const startScale = request.from.width / v.scale / bigW;
      card.position.set(from.x, from.y);
      card.scale.set(startScale);
      playWhoosh(560);
      await tween(
        ticker,
        560,
        k => {
          if (card.destroyed) return;
          card.position.set(from.x + (cx - from.x) * k, from.y + (cy - from.y) * k - Math.sin(k * Math.PI) * 30);
          card.scale.set(startScale + (1 - startScale) * k);
          card.rotateTo(-0.2 * (1 - k), 0.4 * (1 - k));
        },
        bezier(0.35, 0.6, 0.2, 1)
      );
    }
    if (this.closed) return;
    card.position.set(cx, cy);
    card.scale.set(1);
    // Il Nexus: la carta si gira; a metà giro il flash e il suono.
    if (request.faceIndex > 0) {
      let flashed = false;
      await tween(
        ticker,
        640,
        k => {
          if (card.destroyed) return;
          card.rotateTo(0, Math.PI * k);
          if (!flashed && k >= 0.5) {
            flashed = true;
            this.flashScreen(0.35);
            playSocket("dynamic", 0.9);
          }
        },
        easeInOut
      );
      this.flipped = true;
      card.face(targetTexture);
      card.rotateTo(0, 0);
    }
    if (this.closed) return;
    card.filters = [glowFilter(0xff4d6d, 1.6)];
    const blocks = (target?.blocks ?? []).filter(block => block.kind === "ability");
    this.buildSlots(card, blocks);
    this.buildSide(res, blocks.length);
  }

  /** La faccia da montare, dipinta com'è adesso: le abilità montate al posto di quelle stampate. */
  private paintFace(): ReturnType<typeof paintCard> {
    const { request } = this;
    return paintCard(request.cardId, this.faceId(request.faceIndex), this.locale, this.paintRes, { abilities: this.mounted.map(entry => (entry ? { name: entry.name, text: entry.text } : null)) });
  }

  /** La carta si ridipinge (dopo un cambio): la nuova faccia al posto della vecchia, e i blocchi si riposizionano. */
  private async repaint(): Promise<PlacedBlock[]> {
    const painted = await this.paintFace();
    const card = this.card;
    if (!painted || !card || card.destroyed || this.closed) return [];
    card.face(Texture.from({ resource: painted.canvas, resolution: this.paintRes, width: CARD_W, height: CARD_H }));
    const blocks = painted.blocks.filter(block => block.kind === "ability");
    this.placeSlots(blocks);
    return blocks;
  }

  private faceId(index: number): string {
    // Le facce dei Rubyfront: «rubyfront» e «nexus» (model.ts le cerca per id).
    return index > 0 ? "nexus" : "rubyfront";
  }

  private flashScreen(strength: number): void {
    void tween(this.stage.app.ticker, 360, k => (this.flash.alpha = strength * (k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75)), ease);
  }

  // --------------------------------------------------------------- prese
  /** Le prese: i blocchi delle abilità sulla carta (stampate o già sostituite), da toccare. */
  private buildSlots(card: Card3D, blocks: PlacedBlock[]): void {
    const { request } = this;
    const usable = blocks.slice(0, Math.max(0, request.capacity));
    usable.forEach((_block, index) => {
      const highlight = new Graphics({ label: `socket:${index + 1}` });
      highlight.alpha = 0;
      highlight.eventMode = "static";
      const flash = new Graphics();
      flash.alpha = 0;
      flash.eventMode = "none";
      flash.blendMode = "add";
      const slot: Slot = { index, box: { x: 0, y: 0, w: 0, h: 0 }, highlight, flash, hover: new Anim(0) };
      card.addChild(flash, highlight);
      highlight.on("pointerover", () => {
        if (this.busy || !this.pickable(slot)) return;
        slot.hover.set(1, 140);
      });
      highlight.on("pointerout", () => slot.hover.set(0, 220));
      highlight.on("pointertap", () => void this.pick(slot));
      this.slots.push(slot);
    });
    this.placeSlots(blocks);
  }

  /** I riquadri delle prese sui blocchi dipinti (che si spostano quando il testo cambia). */
  private placeSlots(blocks: PlacedBlock[]): void {
    const sc = this.cardScale;
    for (const slot of this.slots) {
      const block = blocks[slot.index];
      if (!block) continue;
      slot.box = { x: block.x * sc - this.cardAt.w / 2 - 6, y: block.y * sc - this.cardAt.h / 2 - 4, w: block.w * sc + 12, h: block.h * sc + 8 };
      const { x, y, w, h } = slot.box;
      slot.highlight.clear().roundRect(x, y, w, h, 6).fill({ color: 0xff4d6d, alpha: 0.1 }).stroke({ color: 0xe56a86, width: 1.5 });
      slot.highlight.hitArea = new Rectangle(x, y, w, h);
      slot.highlight.cursor = this.pickable(slot) ? "pointer" : "default";
      slot.flash.clear().roundRect(x, y, w, h, 6).fill(0xffffff);
    }
  }

  private pickable(slot: Slot): boolean {
    return this.request.mode === "mount" ? true : this.mounted[slot.index] != null;
  }

  /** Il lato destro: il titolo, il chip della nuova abilità (nel montaggio), «Annulla». */
  private buildSide(res: number, printed: number): void {
    const { stage, request } = this;
    const v = stage.visible();
    const x = v.x + v.width * 0.56;
    const chipH = request.mode === "mount" ? this.chipHeight(request.ability.text) : 0;
    const total = 34 + (request.mode === "mount" ? chipH + 26 : 0) + 30;
    let y = v.y + (v.height - total) / 2;
    const titleKey = printed === 0 ? "progression.mount.none" : request.mode === "mount" ? "progression.mount.title" : "progression.mount.eject";
    const title = paintText(stage, t(titleKey), TITLE, MUTED, { maxW: CHIP_W });
    title.sprite.position.set(x, y);
    title.sprite.alpha = 0;
    this.content.addChild(title.sprite);
    void tween(stage.app.ticker, 260, k => (title.sprite.alpha = k), easeOut);
    y += title.h + 18;
    if (request.mode === "mount") {
      const chip = this.buildChip(request.ability, res);
      const chipY = y;
      chip.position.set(x, chipY);
      chip.alpha = 0;
      this.content.addChild(chip);
      this.chip = chip;
      void tween(
        stage.app.ticker,
        320,
        k => {
          if (chip.destroyed) return;
          chip.alpha = k;
          chip.position.y = chipY - 14 * (1 - k);
        },
        easeOut
      );
      y += chipH + 26;
    }
    const cancel = paintText(stage, t("progression.mount.cancel"), SMALL, MUTED);
    cancel.sprite.position.set(x + (CHIP_W - cancel.w) / 2, y + 6);
    cancel.sprite.eventMode = "static";
    cancel.sprite.cursor = "pointer";
    cancel.sprite.on("pointertap", () => this.cancel());
    cancel.sprite.label = "button:" + t("progression.mount.cancel");
    cancel.sprite.alpha = 0;
    this.content.addChild(cancel.sprite);
    void tween(stage.app.ticker, 400, k => (cancel.sprite.alpha = 0.8 * k), easeOut);
  }

  private chipHeight(text: string): number {
    const lines = layout([{ kind: "text", text, font: BODY, color: INK }], CHIP_W - 2 * 16, { font: BODY, lineHeight: 21 });
    return 14 + 14 + 6 + 24 + 4 + lines.reduce((sum, line) => sum + line.height, 0) + 14;
  }

  /** Il chip della nuova abilità: vetro, la faccia in piccolo, il nome, il testo; con l'alone che respira. */
  private buildChip(ability: { name: string; text: string }, res: number): Container {
    const { request } = this;
    const w = CHIP_W;
    const h = this.chipHeight(ability.text);
    const root = new Container({ label: "mount-chip" });
    const halo = new Sprite(
      paintPiece(w + 80, h + 80, res, ctx => {
        ctx.shadowColor = "rgba(224,49,75,.8)";
        ctx.shadowBlur = 34 * res;
        ctx.fillStyle = "#e0314b";
        ctx.fillRect(40, 40, w, h);
      })
    );
    halo.position.set(-40, -40);
    halo.blendMode = "add";
    halo.alpha = 0.5;
    this.chipHalo = halo;
    const plate = new CrispSprite(glassPanel(w, h, res));
    plate.position.set(-GLASS_MARGIN, -GLASS_MARGIN);
    const caption = paintText(this.stage, t(`progression.face.${request.face}`), CAPTION, ACTION_EDGE);
    caption.sprite.position.set(16, 14);
    const name = paintText(this.stage, ability.name, NAME, INK, { maxW: w - 32 });
    name.sprite.position.set(16, 14 + 14 + 6);
    const text = paintText(this.stage, ability.text, BODY, INK, { maxW: w - 32, lineHeight: 21 });
    text.sprite.position.set(16, 14 + 14 + 6 + 24 + 4);
    root.addChild(halo, plate, caption.sprite, name.sprite, text.sprite);
    return root;
  }

  // --------------------------------------------------------------- scelta
  /** Il centro di un blocco, in coordinate del contenuto (la carta è quasi piatta: basta la scala). */
  private blockCenter(slot: Slot): { x: number; y: number } {
    return { x: this.cardAt.x + slot.box.x + slot.box.w / 2, y: this.cardAt.y + slot.box.y + slot.box.h / 2 };
  }

  /** Il blocco scelto: nel montaggio il chip vola sul blocco e la carta si ridipinge con la nuova abilità; nello smontaggio il blocco torna stampato. Poi la promessa risolve. */
  private async pick(slot: Slot): Promise<void> {
    if (this.busy || this.closed || !this.pickable(slot)) return;
    this.busy = true;
    this.chosen = slot;
    for (const other of this.slots) other.highlight.cursor = "default";
    const ticker = this.stage.app.ticker;
    const to = this.blockCenter(slot);
    if (this.request.mode === "mount" && this.chip) {
      const chip = this.chip;
      const bounds = { w: CHIP_W, h: this.chipHeight(this.request.ability.text) };
      chip.pivot.set(bounds.w / 2, bounds.h / 2);
      chip.position.set(chip.position.x + bounds.w / 2, chip.position.y + bounds.h / 2);
      const from = { x: chip.position.x, y: chip.position.y };
      const rise = Math.min(160, Math.hypot(to.x - from.x, to.y - from.y) * 0.4);
      playWhoosh(480);
      await tween(
        ticker,
        480,
        k => {
          if (chip.destroyed) return;
          chip.position.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k - Math.sin(k * Math.PI) * rise);
          const shrink = (slot.box.w / bounds.w) * 0.95;
          chip.scale.set((1 + (shrink - 1) * k) * (1 + 0.12 * Math.sin(k * Math.PI)));
        },
        bezier(0.35, 0.6, 0.2, 1)
      );
      if (this.closed) return;
      chip.visible = false;
      // La carta si ridipinge con la nuova abilità al posto di quella stampata: il blocco lampeggia bianco mentre cambia.
      this.mounted[slot.index] = { ...this.request.ability };
      this.land(slot);
      await this.repaint();
    } else if (this.mounted[slot.index]) {
      // Lo smontaggio: il blocco si sfoca un attimo, e torna l'abilità stampata.
      playRetire();
      slot.flash.alpha = 0.6;
      this.mounted[slot.index] = null;
      await this.repaint();
      if (this.closed) return;
      void tween(ticker, 380, k => !slot.flash.destroyed && (slot.flash.alpha = 0.6 * (1 - k)), easeOut);
      this.spark(slot, 12);
    }
    this.resolveChoice?.({ slot: slot.index });
    this.resolveChoice = null;
  }

  /** L'atterraggio sul blocco: il lampo del riquadro, le scintille, l'anello, il suono, la carta che accusa il colpo. */
  private land(slot: Slot): void {
    playSocket("dynamic", 1.1);
    this.spark(slot, 26);
    const ticker = this.stage.app.ticker;
    slot.highlight.alpha = 1;
    slot.flash.alpha = 0.9;
    void tween(ticker, 620, k => {
      if (slot.highlight.destroyed) return;
      slot.highlight.alpha = key(k, [[0, 1], [0.3, 1], [1, 0.25]]);
      slot.flash.alpha = 0.9 * (1 - k);
    }, easeOut);
    const card = this.card;
    if (card) void tween(ticker, 420, k => !card.destroyed && card.scale.set(key(k, [[0, 1], [0.25, 1.025], [1, 1]])), easeOut);
  }

  private spark(slot: Slot, n: number): void {
    if (!particles) return;
    const at = this.blockCenter(slot);
    particles.burst({ x: at.x, y: at.y, n, shape: "spark", colors: [0xff4d6d, 0xff9fb3, 0xfff0f3], velocity: [80, 240], life: [360, 800], scale: [0.5, 1], gravity: 80, friction: 0.9, align: true, light: true });
    particles.burst({ x: at.x, y: at.y, n: 1, shape: "ring", colors: [0xff8ea6], velocity: [0, 0], life: [480, 480], scale: [0.5, 0.5], growth: 40, light: true });
  }

  // --------------------------------------------------------------- esito
  /** Il tavolo ha accettato: la carta torna al suo posto (rigirandosi se serve), il velo scende, tutto sparisce. */
  async succeed(): Promise<void> {
    await this.exit(true);
  }

  /** Il tavolo ha rifiutato: la carta scuote; l'overlay resta, si può riprovare o annullare. */
  fail(): void {
    this.busy = false;
    for (const other of this.slots) other.highlight.cursor = this.pickable(other) ? "pointer" : "default";
    const card = this.card;
    if (!this.chosen || !card) return;
    const base = card.position.x;
    void tween(this.stage.app.ticker, 320, k => !card.destroyed && (card.position.x = base + Math.sin(k * Math.PI * 4) * 7 * (1 - k)), ease);
  }

  /** Chiuso senza scegliere (Esc, velo, «Annulla»). */
  cancel(): void {
    if (this.closed) return;
    this.resolveChoice?.(null);
    this.resolveChoice = null;
    void this.exit(false);
  }

  private async exit(back: boolean): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener("keydown", this.onKey);
    this.root.eventMode = "none";
    const ticker = this.stage.app.ticker;
    const card = this.card;
    const fades: Promise<void>[] = [];
    for (const child of this.content.children) {
      if (child === card || child === particleLayer) continue;
      fades.push(tween(ticker, 200, k => !child.destroyed && (child.alpha = Math.min(child.alpha, 1 - k)), easeIn));
    }
    if (card && !reducedMotion()) {
      // Le prese spariscono prima che la carta si giri e voli.
      for (const slot of this.slots) {
        slot.highlight.visible = false;
        slot.flash.visible = false;
      }
      if (this.flipped) {
        await tween(ticker, 420, k => !card.destroyed && card.rotateTo(0, Math.PI * (1 - k)), easeInOut);
        this.flipped = false;
      }
      const from = this.request.from;
      const v = this.stage.visible();
      if (back && from) {
        const to = this.content.toLocal({ x: from.x + from.width / 2, y: from.y + from.height / 2 });
        const endScale = from.width / v.scale / this.cardAt.w;
        const start = { x: this.cardAt.x, y: this.cardAt.y };
        card.filters = [];
        await tween(
          ticker,
          440,
          k => {
            if (card.destroyed) return;
            card.position.set(start.x + (to.x - start.x) * k, start.y + (to.y - start.y) * k - Math.sin(k * Math.PI) * 24);
            card.scale.set(1 + (endScale - 1) * k);
          },
          easeInOut
        );
      } else {
        await tween(ticker, 260, k => !card.destroyed && (card.alpha = 1 - k), easeIn);
      }
    }
    await Promise.all([...fades, tween(ticker, 220, k => (this.veil.alpha = 1 - k), easeIn)]);
    this.teardown();
  }

  private teardown(): void {
    this.stage.app.ticker.remove(this.tick);
    this.unblur?.();
    this.unblur = null;
    if (particleLayer.parent === this.content) this.content.removeChild(particleLayer);
    this.root.destroy({ children: true });
  }

  // ---------------------------------------------------------------- frame
  private step(): void {
    const now = performance.now();
    for (const slot of this.slots) {
      if (slot.hover.step(now) && !slot.highlight.destroyed && !this.busy) slot.highlight.alpha = slot.hover.v;
    }
    if (this.chipHalo && !this.chipHalo.destroyed) this.chipHalo.alpha = reducedMotion() ? 0.5 : 0.35 + 0.3 * (0.5 - 0.5 * Math.cos((now / 2000) * Math.PI * 2));
    // La carta segue il puntatore, appena: le prese stanno sulla carta e devono restarle addosso.
    if (this.card && !this.card.destroyed && !this.busy) {
      if (this.pointer && !reducedMotion()) {
        const dx = Math.max(-1, Math.min(1, (this.pointer.x - this.cardAt.x) / (this.cardAt.w * 0.9)));
        const dy = Math.max(-1, Math.min(1, (this.pointer.y - this.cardAt.y) / (this.cardAt.h * 0.9)));
        this.tilt.ry.set(dx * 0.05, 300);
        this.tilt.rx.set(-dy * 0.04, 300);
      }
      const moved = [this.tilt.rx.step(now), this.tilt.ry.step(now)].some(Boolean);
      if (moved) this.card.rotateTo(this.tilt.rx.v, this.tilt.ry.v);
    }
  }
}
