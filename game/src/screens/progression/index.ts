// La progressione dei Rubyfront (2026-09-23): la vista che si apre dal tasto
// «Rubyfront» dell'header. Prima la scelta — i quattro Rubyfront a tessera,
// che ondeggiano piano, col livello e la barra dell'esperienza che si
// riempie — poi la sferografia di uno (constellation.ts): la carta al
// centro, i dieci nodi in orbita, i fili e l'energia; a destra, su vetro, il
// dettaglio del livello scelto con le due abilità (Rubyfront e Nexus) e i
// tasti «Monta»/«Smonta», che aprono lo zoom sulla carta con la scelta della
// presa (mount.ts). La convalida è quella del modulo core/progression.ts
// (gemello del tavolo); un rifiuto si spiega col sigillo. Le abilità sono
// segnaposto: si leggono, non si giocano ancora.

import { cardName, getCard } from "@rubyfront/core/cards";
import { t } from "@rubyfront/core/i18n";
import {
  PROGRESSION_FACES,
  abilityWords,
  progressionCards,
  progressionOf,
  progressionRules,
  validateLoadout,
  mountedIds,
  slotOf,
  withAbility,
  withoutSlot,
  xpSpan,
  type Loadout,
  type PlayerProgress,
  type ProgressionCard,
  type ProgressionFace,
  type ProgressionRules,
} from "@rubyfront/core/progression";
import { Container, Graphics } from "pixi.js";
import { type Font } from "../../card/text";
import { CARD_H, CARD_W } from "../../card/theme";
import { Particles } from "../../effects/particles";
import type { Stage } from "../../stage";
import { ease, easeIn, easeOut, reducedMotion, tween, wait } from "../../table/animation";
import { CrispSprite, SANS } from "../../table/appearance";
import { TableCard } from "../../table/card";
import type { PreviewSource } from "../../table/preview";
import { playSound } from "../../sound";
import { askQuestion } from "../question";
import { BG, ACTION_EDGE, ACTION_LABEL, FONT_BASE, INK, LINE, LINE_SOFT, MUTED, PANEL, PANEL_2, RUBY, Button, areaBelow, hex, slabShadow, placeShadow, paintText } from "../ui";
import { store } from "../../match";
import { Constellation } from "./constellation";
import { Anim, XpBar, glassPanel, GLASS_MARGIN, radialGlow } from "./fx";
import { MountOverlay } from "./mount";

const TITLE: Font = { size: 25.6, weight: 700, family: SANS, spacing: 2.56, upper: true };
const NAME: Font = { size: 20, weight: 700, family: SANS, spacing: 1.6, upper: true };
const BUTTON: Font = { size: 16, weight: 600, family: SANS, spacing: 1.28, upper: true };
const CAPTION: Font = { size: 11, weight: 700, family: SANS, spacing: 11 * 0.18, upper: true };
const ABILITY: Font = { size: 18, weight: 700, family: SANS };
const PAD = 18;
const SHADOW_M = 60;
/** La tessera del Rubyfront nella scelta. */
const COVER = 0.58;

export interface ProgressionActions {
  /** La progressione dell'account su quel Rubyfront (livello 1 senza righe). */
  progress(card: string): PlayerProgress;
  /** Le abilità montate, al tavolo: la risposta arriva con `refresh()` (o `refused()`). */
  setLoadout(card: string, loadout: Loadout): void;
  onClose(): void;
}

interface PickTile {
  root: Container;
  baseY: number;
  phase: number;
  hover: Anim;
  bar: XpBar;
}

export class ProgressionScreen implements PreviewSource {
  readonly root = new Container({ label: "progression" });
  private readonly background = new Graphics();
  private readonly content = new Container({ label: "progression-content" });
  private readonly listeners: ((cardEvent: { type: string; uid: string }) => void)[] = [];
  private readonly info = new Map<string, { cardId: string; face: number; back: boolean }>();
  private readonly tiles = new Map<string, Container>();
  private step: { type: "pick" } | { type: "grid"; card: string; node: number } = { type: "pick" };
  private readonly particleLayer = new Container({ label: "progression-particles" });
  private readonly particles: Particles;
  private constellation: Constellation | null = null;
  private detail: Container | null = null;
  private detailBox = { x: 0, y: 0, w: 0, h: 0 };
  private headerBar: XpBar | null = null;
  private pickTiles: PickTile[] = [];
  private overlay: MountOverlay | null = null;
  /** Da dove parte la carta nell'entrata (la tessera toccata nella scelta), in pixel dello schermo. */
  private enterFrom: { x: number; y: number; width: number; height: number } | null = null;
  private readonly tick = (): void => this.stepFrame();

  constructor(
    private readonly stage: Stage,
    private readonly locale: string,
    private readonly actions: ProgressionActions
  ) {
    this.root.visible = false;
    this.background.eventMode = "static";
    this.root.addChild(this.background, this.content);
    this.root.eventMode = "static";
    this.particles = new Particles(stage, this.particleLayer);
    stage.screens.addChild(this.root);
    stage.onLayout(() => this.root.visible && this.build());
  }

  isOpen(): boolean {
    return this.root.visible;
  }

  /** Si apre sulla scelta (o, dato un Rubyfront, dritti sulla sua sferografia). */
  open(card?: string): void {
    this.root.visible = true;
    this.enterFrom = null;
    this.step = card && progressionOf(card) ? { type: "grid", card, node: this.actions.progress(card).level } : { type: "pick" };
    this.stage.app.ticker.add(this.tick);
    this.build();
  }

  close(): void {
    if (!this.root.visible) return;
    this.root.visible = false;
    this.stage.app.ticker.remove(this.tick);
    this.overlay?.cancel();
    this.overlay = null;
    this.emit({ type: "out", uid: "" });
    this.clearAll();
  }

  /** La progressione è cambiata (dal tavolo): l'overlay in attesa si chiude col successo, il dettaglio si rifà, i livelli nuovi si rivelano. */
  refresh(): void {
    if (!this.root.visible) return;
    if (this.overlay) {
      void this.overlay.succeed();
      this.overlay = null;
    }
    const step = this.step;
    if (step.type !== "grid") {
      this.build();
      return;
    }
    const progress = this.actions.progress(step.card);
    this.headerText(step.card, progress);
    this.constellation?.setProgress(progress.level, step.node);
    void this.constellation?.setAbilities(this.overridesFor(progressionOf(step.card), progress, "rubyfront"));
    this.swapDetail(step, progress, true);
    void this.revealFresh(step.card, progress);
  }

  /** Il tavolo ha rifiutato una configurazione: la presa scuote, il sigillo spiega, l'overlay si chiude. */
  refused(reason: string): void {
    const overlay = this.overlay;
    this.overlay = null;
    overlay?.fail();
    void askQuestion(this.stage, { title: t("progression.refuse.title"), text: reason, yes: t("html.store.soon.ok") }).then(() => overlay?.cancel());
  }

  /** Il Rubyfront aperto, se la sferografia è aperta. */
  shown(): string | null {
    return this.step.type === "grid" ? this.step.card : null;
  }

  // ------------------------------------------------------ PreviewSource
  onCard(listener: (cardEvent: { type: string; uid: string }) => void): void {
    this.listeners.push(listener);
  }

  cardInfo(uid: string): { cardId: string; face: number; back: boolean } | undefined {
    return this.info.get(uid);
  }

  screenBox(uid: string): { x: number; y: number; width: number; height: number } | undefined {
    const tile = this.tiles.get(uid);
    if (!tile) return undefined;
    const bounds = tile.getBounds();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }

  private emit(cardEvent: { type: string; uid: string }): void {
    for (const listener of this.listeners) listener(cardEvent);
  }

  private clearAll(): void {
    this.constellation?.destroy({ children: true });
    this.constellation = null;
    this.detail = null;
    this.headerBar = null;
    this.pickTiles = [];
    if (this.particleLayer.parent) this.particleLayer.parent.removeChild(this.particleLayer);
    for (const child of this.content.removeChildren()) child.destroy({ children: true });
    this.tiles.clear();
    this.info.clear();
  }

  // ----------------------------------------------------------- la vista
  private build(): void {
    this.clearAll();
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;
    const area = areaBelow(v);
    this.background.clear().rect(area.x, area.y, area.w, area.h).fill(hex(BG));
    const width = Math.min(area.w - 80, 1560);
    const x0 = area.x + (area.w - width) / 2;
    let y = area.y + 22;
    const step = this.step;
    const rules = progressionRules();
    const back = new Button(this.stage, {
      label: step.type === "pick" ? t("progression.back") : t("progression.back.pick"),
      style: "plate",
      font: BUTTON,
      h: 36,
      onTap: () => {
        if (step.type === "pick") {
          this.close();
          this.actions.onClose();
        } else void this.backToPick();
      },
    });
    back.position.set(x0, y);
    const titleText = step.type === "pick" ? t("progression.title") : cardName(step.card, this.locale);
    const title = paintText(this.stage, titleText, TITLE, INK);
    title.sprite.position.set(x0 + back.w + 22, y);
    this.content.addChild(back, title.sprite);
    const headerLead = new Container({ label: "progression-lead" });
    headerLead.position.set(x0 + back.w + 22, y + title.h + 4);
    this.content.addChild(headerLead);
    y += Math.max(back.h, title.h + 4 + 22) + 22;
    if (!rules) {
      const none = paintText(this.stage, t("progression.none.catalog"), FONT_BASE, MUTED, { maxW: width });
      none.sprite.position.set(x0, y);
      this.content.addChild(none.sprite);
      return;
    }
    if (step.type === "pick") {
      const lead = paintText(this.stage, t("progression.lead"), FONT_BASE, MUTED, { maxW: width - back.w - 22 });
      headerLead.addChild(lead.sprite);
      this.buildPick(x0, y, width, res, rules);
    } else {
      this.leadHolder = headerLead;
      const progress = this.actions.progress(step.card);
      this.headerText(step.card, progress);
      this.buildGrid(step, progress, x0, y, width, area.y + area.h - y - 24, rules);
    }
  }

  private leadHolder: Container | null = null;

  /** L'intestazione della sferografia: «Livello N · xp / next» e la barra che si riempie. */
  private headerText(card: string, progress: PlayerProgress): void {
    const holder = this.leadHolder;
    const rules = progressionRules();
    if (!holder || holder.destroyed || !rules) return;
    for (const child of holder.removeChildren()) child.destroy({ children: true });
    const span = xpSpan(progress.level, rules);
    const words = `${t("progression.level", { n: progress.level })} · ${span.to === null ? t("progression.xp.max", { xp: progress.xp }) : t("progression.xp", { xp: progress.xp, next: span.to })}`;
    const lead = paintText(this.stage, words, FONT_BASE, MUTED);
    holder.addChild(lead.sprite);
    const bar = new XpBar(220, 6);
    bar.position.set(lead.w + 16, 8);
    const k = span.to === null ? 1 : (progress.xp - span.from) / (span.to - span.from);
    const previous = this.headerBar?.k.v ?? 0;
    bar.set(previous, 0);
    bar.set(k, 700);
    holder.addChild(bar);
    this.headerBar = bar;
    void card;
  }

  /** La scelta: una stampa per Rubyfront, col livello e la barra. Le tessere ondeggiano; al passaggio il filo. */
  private buildPick(x0: number, y: number, width: number, res: number, rules: ProgressionRules): void {
    const cards = progressionCards().filter(entry => getCard(entry.card));
    const gap = 22;
    const cols = Math.max(1, Math.min(cards.length, Math.floor((width + gap) / (CARD_W * COVER + 2 * PAD + gap))));
    const slabW = (width - gap * (cols - 1)) / cols;
    const coverW = CARD_W * COVER;
    const coverH = CARD_H * COVER;
    const prints = cards.map(entry => {
      const progress = this.actions.progress(entry.card);
      const print = new Container({ label: `rubyfront:${entry.card}` });
      const items: Container[] = [];
      const tile = this.tile(`${entry.card}|pick`, entry.card, 0, coverW, coverH, (slabW - coverW) / 2, PAD, res);
      items.push(tile);
      let by = PAD + coverH + 14;
      const name = paintText(this.stage, cardName(entry.card, this.locale), NAME, INK, { maxW: slabW - 2 * PAD, align: "center" });
      name.sprite.position.set((slabW - name.w) / 2, by);
      items.push(name.sprite);
      by += name.h + 6;
      const level = paintText(this.stage, t("progression.level", { n: progress.level }), FONT_BASE, ACTION_LABEL);
      level.sprite.position.set((slabW - level.w) / 2, by);
      items.push(level.sprite);
      by += level.h + 10;
      const bar = new XpBar(slabW - 2 * PAD, 8);
      bar.position.set(PAD, by);
      const span = xpSpan(progress.level, rules);
      bar.set(0, 0);
      bar.set(span.to === null ? 1 : (progress.xp - span.from) / (span.to - span.from), 900);
      items.push(bar);
      by += bar.h + 6;
      const xp = paintText(this.stage, span.to === null ? t("progression.xp.max", { xp: progress.xp }) : t("progression.xp", { xp: progress.xp, next: span.to }), { ...FONT_BASE, size: 14 }, MUTED, { align: "center", maxW: slabW - 2 * PAD });
      xp.sprite.position.set((slabW - xp.w) / 2, by);
      items.push(xp.sprite);
      by += xp.h + PAD;
      return { entry, print, items, h: by, bar, progress };
    });
    const rowH = Math.max(...prints.map(print => print.h), 0);
    prints.forEach(({ entry, print, items, bar, progress }, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = x0 + col * (slabW + gap);
      const baseY = y + row * (rowH + gap);
      this.slab(print, slabW, rowH, items);
      print.pivot.set(slabW / 2, rowH / 2);
      print.position.set(x + slabW / 2, baseY + rowH / 2);
      const hit = new Graphics().rect(0, 0, slabW, rowH).fill({ color: 0xffffff, alpha: 0.001 });
      const edge = new Graphics().rect(0.5, 0.5, slabW - 1, rowH - 1).stroke({ color: hex(RUBY), width: 1 });
      edge.visible = false;
      hit.eventMode = "static";
      hit.cursor = "pointer";
      const tileRecord: PickTile = { root: print, baseY: baseY + rowH / 2, phase: index * 1.3, hover: new Anim(1), bar };
      hit.on("pointerover", () => {
        edge.visible = true;
        tileRecord.hover.set(1.03, 220);
      });
      hit.on("pointerout", () => {
        edge.visible = false;
        tileRecord.hover.set(1, 260);
      });
      hit.on("pointertap", () => {
        playSound("button");
        const tile = this.tiles.get(`${entry.card}|pick`);
        this.enterFrom = tile ? this.screenBox(`${entry.card}|pick`) ?? null : null;
        this.step = { type: "grid", card: entry.card, node: progress.level };
        this.build();
      });
      print.addChild(hit, edge);
      this.content.addChild(print);
      this.pickTiles.push(tileRecord);
      // Entrano dal basso, una dopo l'altra.
      print.alpha = 0;
      void wait(index * 70).then(() =>
        tween(this.stage.app.ticker, 420, k => {
          if (print.destroyed) return;
          print.alpha = k;
          tileRecord.baseY = baseY + rowH / 2 + 24 * (1 - k);
        }, easeOut)
      );
    });
  }

  /** La sferografia: la costellazione a sinistra, il dettaglio su vetro a destra. */
  private buildGrid(step: { type: "grid"; card: string; node: number }, progress: PlayerProgress, x0: number, y: number, width: number, height: number, rules: ProgressionRules): void {
    const gap = 22;
    const detailW = Math.max(380, Math.min(470, width * 0.3));
    const leftW = width - detailW - gap;
    const h = Math.max(520, height);
    const constellation = new Constellation(this.stage, {
      cardId: step.card,
      locale: this.locale,
      w: leftW,
      h,
      particles: this.particles,
      particleLayer: this.particleLayer,
      overrides: this.overridesFor(progressionOf(step.card), progress, "rubyfront"),
      onPick: level => this.pickNode(level),
    });
    constellation.position.set(x0, y);
    this.content.addChild(constellation);
    this.constellation = constellation;
    this.detailBox = { x: x0 + leftW + gap, y, w: detailW, h };
    const from = this.enterFrom;
    this.enterFrom = null;
    void constellation.enter(from, progress.level, step.node).then(() => {
      if (this.constellation !== constellation) return;
      void this.revealFresh(step.card, progress);
    });
    this.swapDetail(step, progress, false);
    void rules;
  }

  private pickNode(level: number): void {
    const step = this.step;
    if (step.type !== "grid") return;
    if (step.node === level) return;
    playSound("select");
    this.step = { ...step, node: level };
    this.constellation?.choose(level);
    this.swapDetail(this.step, this.actions.progress(step.card), true);
  }

  /** Torna alla scelta: la costellazione si spegne, poi la pick. */
  private async backToPick(): Promise<void> {
    const constellation = this.constellation;
    if (constellation) await constellation.leave();
    if (!this.root.visible) return;
    this.step = { type: "pick" };
    this.build();
  }

  /** I livelli raggiunti dall'ultima volta che si è guardato: la rivelazione. */
  private async revealFresh(card: string, progress: PlayerProgress): Promise<void> {
    const seenKey = `seen:${card}`;
    const seen = Number(store.read(seenKey, "1")) || 1;
    const fresh: number[] = [];
    for (let level = seen + 1; level <= progress.level; level += 1) fresh.push(level);
    if (!fresh.length || !this.constellation) return;
    store.write(seenKey, String(progress.level));
    await this.constellation.reveal(fresh);
  }

  // ------------------------------------------------------------ dettaglio
  /** Il pannello del livello scelto: le due abilità coi tasti. Il vecchio esce a sinistra, il nuovo entra da destra. */
  private swapDetail(step: { type: "grid"; card: string; node: number }, progress: PlayerProgress, animated: boolean): void {
    const rules = progressionRules();
    if (!rules) return;
    const old = this.detail;
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;
    const { x, y, w, h } = this.detailBox;
    const card = progressionOf(step.card);
    const panel = new Container({ label: `progression-level:${step.node}` });
    const glass = new CrispSprite(glassPanel(w, h, res));
    glass.position.set(-GLASS_MARGIN, -GLASS_MARGIN);
    panel.addChild(glass);
    let dy = PAD + 4;
    const heading = paintText(this.stage, t("progression.level", { n: step.node }), NAME, INK);
    heading.sprite.position.set(PAD, dy);
    panel.addChild(heading.sprite);
    dy += heading.h + 4;
    const slotsText = t("progression.slots", { r: mountedIds(progress.loadout, "rubyfront").length, rs: rules.slots.rubyfront, n: mountedIds(progress.loadout, "nexus").length, ns: rules.slots.nexus });
    const slots = paintText(this.stage, slotsText, { ...FONT_BASE, size: 14 }, MUTED, { maxW: w - 2 * PAD });
    slots.sprite.position.set(PAD, dy);
    panel.addChild(slots.sprite);
    dy += slots.h + 14;
    const entry = card?.levels.find(level => level.level === step.node);
    const locked = step.node > progress.level;
    for (const face of PROGRESSION_FACES) {
      const ability = entry?.[face];
      if (!ability) continue;
      const words = abilityWords(ability, this.locale);
      const mounted = slotOf(progress.loadout, face, ability.id) >= 0;
      const plate = this.abilityPlate(face, words, w - 2 * PAD, locked, mounted, step.node);
      plate.root.position.set(PAD, dy);
      panel.addChild(plate.root);
      dy += plate.h + 10;
      if (locked) continue;
      const button = new Button(this.stage, {
        label: t(mounted ? "progression.unmount" : "progression.mount"),
        style: mounted ? "plate" : "metal",
        font: BUTTON,
        w: w - 2 * PAD,
        h: 40,
        onTap: () => void this.mount(step.card, face, { id: ability.id, ...words }, mounted, card, rules),
      });
      button.position.set(PAD, dy);
      panel.addChild(button);
      dy += 40 + 16;
    }
    const mountedTitle = paintText(this.stage, t("progression.mounted"), CAPTION, MUTED);
    mountedTitle.sprite.position.set(PAD, dy);
    panel.addChild(mountedTitle.sprite);
    dy += mountedTitle.h + 4;
    for (const face of PROGRESSION_FACES) {
      const names = mountedIds(progress.loadout, face).map(id => this.abilityName(card, id));
      const line = paintText(this.stage, `${t(`progression.face.${face}`)}: ${names.length ? names.join(" · ") : t("progression.none")}`, { ...FONT_BASE, size: 14 }, INK, { maxW: w - 2 * PAD, lineHeight: 20 });
      line.sprite.position.set(PAD, dy);
      panel.addChild(line.sprite);
      dy += line.h + 4;
    }
    panel.position.set(x, y);
    this.content.addChild(panel);
    this.detail = panel;
    const ticker = this.stage.app.ticker;
    if (old && !old.destroyed) {
      void tween(ticker, 200, k => {
        if (old.destroyed) return;
        old.alpha = 1 - k;
        old.position.x = x - 14 * k;
      }, easeIn).then(() => !old.destroyed && old.destroy({ children: true }));
    }
    if (animated) {
      panel.alpha = 0;
      void tween(ticker, 260, k => {
        if (panel.destroyed) return;
        panel.alpha = k;
        panel.position.x = x + 14 * (1 - k);
      }, easeOut);
    }
  }

  private abilityName(card: ProgressionCard | null, id: string): string {
    return this.abilityWordsOf(card, id).name;
  }

  /** Le abilità montate su una faccia, per blocco, come le vuole il pittore della carta. */
  private overridesFor(card: ProgressionCard | null, progress: PlayerProgress, face: ProgressionFace): { abilities: ({ name: string; text: string } | null)[] } {
    return { abilities: (progress.loadout[face] ?? []).map(id => (id ? this.abilityWordsOf(card, id) : null)) };
  }

  private abilityWordsOf(card: ProgressionCard | null, id: string): { name: string; text: string } {
    for (const level of card?.levels ?? []) for (const face of PROGRESSION_FACES) if (level[face].id === id) return abilityWords(level[face], this.locale);
    return { name: id, text: "" };
  }

  /** La piastra di un'abilità: la faccia in piccolo, il nome, il testo; spenta se il livello è da raggiungere. */
  private abilityPlate(face: ProgressionFace, words: { name: string; text: string }, w: number, locked: boolean, mounted: boolean, level: number): { root: Container; h: number } {
    const root = new Container({ label: `ability:${face}` });
    const inner = w - 2 * 14;
    const caption = paintText(this.stage, `${t(`progression.face.${face}`)}${mounted ? ` · ${t("progression.mounted.one")}` : ""}`, CAPTION, mounted ? ACTION_EDGE : MUTED, { maxW: inner });
    const name = paintText(this.stage, words.name, ABILITY, locked ? MUTED : INK, { maxW: inner });
    const text = paintText(this.stage, locked ? t("progression.locked", { n: level }) : words.text, { ...FONT_BASE, size: 15 }, locked ? MUTED : INK, { maxW: inner, lineHeight: 21 });
    const h = 12 + caption.h + 4 + name.h + 6 + text.h + 12;
    const back = new Graphics().rect(0, 0, w, h).fill(hex(locked ? PANEL : PANEL_2)).stroke({ color: mounted ? hex(ACTION_EDGE) : hex(LINE_SOFT), width: 1, alignment: 1 });
    caption.sprite.position.set(14, 12);
    name.sprite.position.set(14, 12 + caption.h + 4);
    text.sprite.position.set(14, 12 + caption.h + 4 + name.h + 6);
    root.addChild(back, caption.sprite, name.sprite, text.sprite);
    if (locked) root.alpha = 0.7;
    return { root, h };
  }

  // ------------------------------------------------------------ montaggio
  /** «Monta» / «Smonta»: lo zoom sulla faccia e la scelta della presa; poi il tavolo. */
  private async mount(cardId: string, face: ProgressionFace, ability: { id: string; name: string; text: string }, mounted: boolean, card: ProgressionCard | null, rules: ProgressionRules): Promise<void> {
    if (this.overlay) return;
    const progress = this.actions.progress(cardId);
    const overlay = new MountOverlay(this.stage, this.locale, {
      cardId,
      face,
      faceIndex: face === "nexus" ? 1 : 0,
      ability,
      capacity: rules.slots[face],
      // Posizionale: per ogni blocco stampato, cosa c'è montato sopra (o niente).
      mounted: (progress.loadout[face] ?? []).map(id => (id ? { id, ...this.abilityWordsOf(card, id) } : null)),
      mode: mounted ? "eject" : "mount",
      from: this.constellation?.cardBox() ?? null,
      frontOverrides: this.overridesFor(card, progress, "rubyfront"),
    });
    this.overlay = overlay;
    const result = await overlay.open();
    if (this.overlay !== overlay) return;
    if (!result) {
      this.overlay = null;
      return;
    }
    const next: Loadout = mounted ? withoutSlot(progress.loadout, face, result.slot) : withAbility(progress.loadout, face, ability.id, result.slot);
    const refusedBy = validateLoadout(card, progress.level, next, rules);
    if (refusedBy) {
      const params = { ...(refusedBy.params ?? {}) };
      if (typeof params.face === "string") params.face = t(`progression.face.${params.face}`);
      this.refused(t(refusedBy.key, params));
      return;
    }
    this.actions.setLoadout(cardId, next);
  }

  // ---------------------------------------------------------------- frame
  private stepFrame(): void {
    const now = performance.now();
    this.constellation?.step(now);
    this.headerBar?.step(now);
    const bob = reducedMotion() ? 0 : 1;
    for (const tile of this.pickTiles) {
      if (tile.root.destroyed) continue;
      tile.bar.step(now);
      tile.hover.step(now);
      tile.root.scale.set(tile.hover.v);
      tile.root.position.y = tile.baseY + bob * Math.sin(now / 1800 + tile.phase) * 4;
    }
  }

  // ------------------------------------------------------------- pezzi
  /** Una tessera del Rubyfront (una faccia), con l'ingrandimento al passaggio. */
  private tile(uid: string, cardId: string, face: number, w: number, h: number, x: number, y: number, res: number): Container {
    const tile = new TableCard(uid);
    tile.update({ cardId, face, back: false, tapped: false, w, h, locale: this.locale, resolution: res, badges: null, combat: null });
    tile.position.set(x + w / 2, y + h / 2);
    tile.eventMode = "static";
    tile.on("pointerenter", () => this.emit({ type: "over", uid }));
    tile.on("pointerleave", () => this.emit({ type: "out", uid }));
    this.info.set(uid, { cardId, face, back: false });
    this.tiles.set(uid, tile);
    return tile;
  }

  /** La stampa: l'ombra lunga, il pannello col filo, poi i pezzi. */
  private slab(into: Container, w: number, h: number, items: Container[]): void {
    const shadow = slabShadow([{ x: 0, y: 14, blur: 34, color: "rgba(0,0,0,.25)" }], SHADOW_M);
    placeShadow(shadow, SHADOW_M, 0, 0, w, h);
    const slab = new Graphics().rect(0, 0, w, h).fill(hex(PANEL)).stroke({ color: hex(LINE), width: 1, alignment: 1 });
    into.addChild(shadow, slab, ...items);
  }
}

export { ease, radialGlow };
