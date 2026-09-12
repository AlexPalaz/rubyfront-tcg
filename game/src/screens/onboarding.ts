// L'accoglienza (simulatore: index.html #onboard, main.ts obProfile,
// waitForPeer): il velo sulla home e la carta di vetro chiaro coi suoi due
// passi — il profilo (il nome al tavolo, il tuo mazzo e, contro il bot,
// anche il suo; «Al tavolo») e l'attesa in stanza (la nota, lo stato col
// punto che respira, il link d'invito, «Esci dalla stanza»). Il velo copre
// la home ma non l'header: il marchio riporta indietro. Tema scuro: il velo
// d'overlay, il vetro pesante col filo tenue, i campi del tema.

import { allDecks, getDeck } from "@rubyfront/core/cards";
import { t } from "@rubyfront/core/i18n";
import { Container, FillGradient, Graphics, Rectangle, Sprite, type FederatedPointerEvent } from "pixi.js";
import { drawText, fontMetrics, textWidth, type Font } from "../card/text";
import type { Stage } from "../stage";
import { playSound } from "../sound";
import { SANS, paintPiece } from "../table/appearance";
import { reducedMotion } from "../table/animation";
import { TOOLBAR_H, TextField, ACTION_EDGE, FONT_BASE, INK, LINE, MUTED, PANEL, PANEL_2, ACTION_LABEL, Button, hex, slabShadow, placeShadow, paintText } from "./ui";

const W = 440;
const PAD_X = 32;
const PAD_TOP = 30;
const PAD_BOTTOM = 26;
const GAP = 18;
const STEP_GAP = 14;
const INNER = W - 2 * PAD_X;
const FIELD_H = 44;
const LABEL: Font = { size: 16, weight: 600, family: SANS, spacing: 16 * 0.08, upper: true };
const BRAND: Font = { size: 16, weight: 700, family: SANS, spacing: 16 * 0.22, upper: true };
const SHADOW_M = 90;

export type Mode = "net" | "bot";

export interface Profile {
  mode: Mode;
  /** La riga sopra il nome: la stanza in cui sei, o la nota della partita col bot. */
  note: string;
  name: string;
  deck: string | null;
  botDeck: string | null;
}

export interface Choice {
  mode: Mode;
  name: string;
  deck: string | null;
  botDeck: string | null;
}

export interface OnboardingActions {
  toTable(choice: Choice): void;
  /** Copia il link d'invito: vero se è finito negli appunti. */
  invite(): Promise<boolean>;
  leave(): void;
  /** Il velo si alza o si abbassa: la home dietro si sfoca. */
  backdrop(isOpen: boolean): void;
}

function deckName(id: string, locale: string): string {
  const deck = getDeck(id);
  return deck?.locales[locale]?.name ?? deck?.locales[deck.defaultLocale]?.name ?? id;
}

/** Il menu a tendina dei mazzi (il <select> dell'accoglienza): il nome scelto e la freccia; al tocco la lista sotto. */
class Dropdown {
  readonly root = new Container({ label: "dropdown" });

  constructor(
    private readonly stage: Stage,
    private readonly items: { id: string; label: string }[],
    private value: string | null,
    private readonly layer: Container,
    private readonly onChange: (id: string) => void
  ) {
    this.root.eventMode = "static";
    this.root.cursor = "pointer";
    this.root.hitArea = new Rectangle(0, 0, INNER, FIELD_H);
    this.root.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      playSound("button");
      this.open();
    });
    this.paint();
  }

  private paint(): void {
    for (const child of this.root.removeChildren()) child.destroy({ children: true });
    // Il <select> del Notte: la piastra (gradiente e filo di luce in cima), il filo della linea.
    const box = new Graphics()
      .rect(0, 0, INNER, FIELD_H)
      .fill(new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: 0x241d22 }, { offset: 1, color: 0x151116 }], textureSpace: "local" }))
      .rect(1, 1, INNER - 2, 1)
      .fill({ color: 0xffffff, alpha: 0.07 })
      .rect(0, 0, INNER, FIELD_H)
      .stroke({ color: hex(LINE), width: 1, alignment: 1 });
    const label = this.items.find(item => item.id === this.value)?.label ?? "";
    const text = paintText(this.stage, label, FONT_BASE, INK, { maxW: INNER - 44 });
    text.sprite.position.set(12, (FIELD_H - text.h) / 2);
    const arrow = new Graphics().moveTo(0, 0).lineTo(10, 0).lineTo(5, 6).closePath().fill(hex(MUTED));
    arrow.position.set(INNER - 12 - 10, FIELD_H / 2 - 3);
    this.root.addChild(box, text.sprite, arrow);
  }

  private open(): void {
    const at = this.layer.toLocal(this.root.getGlobalPosition());
    const v = this.stage.visible();
    const ROW = 40;
    const top = at.y + FIELD_H;
    const h = this.items.length * ROW + 2;
    const list = new Container({ label: "dropdown-list" });
    const catcher = new Graphics().rect(v.x, v.y, v.width, v.height).fill({ color: 0x000000, alpha: 0.001 });
    catcher.eventMode = "static";
    const shadow = slabShadow([{ x: 0, y: 12, blur: 30, color: "rgba(0,0,0,.6)" }], 40);
    placeShadow(shadow, 40, at.x, top, INNER, h);
    const background = new Graphics().rect(at.x, top, INNER, h).fill(hex(PANEL)).stroke({ color: hex(LINE), width: 1, alignment: 1 });
    list.addChild(catcher, shadow, background);
    const close = (): void => list.destroy({ children: true });
    catcher.on("pointertap", close);
    this.items.forEach((item, index) => {
      const y = top + 1 + index * ROW;
      const line = new Container({ label: `item:${item.label}` });
      const light = new Graphics().rect(at.x + 1, y, INNER - 2, ROW).fill(hex(PANEL_2));
      light.visible = item.id === this.value;
      const text = paintText(this.stage, item.label, item.id === this.value ? { ...FONT_BASE, weight: 700 } : FONT_BASE, INK, { maxW: INNER - 24 });
      text.sprite.position.set(at.x + 12, y + (ROW - text.h) / 2);
      line.addChild(light, text.sprite);
      line.eventMode = "static";
      line.cursor = "pointer";
      line.hitArea = new Rectangle(at.x, y, INNER, ROW);
      line.on("pointerover", () => (light.visible = true));
      line.on("pointerout", () => (light.visible = item.id === this.value));
      line.on("pointertap", () => {
        playSound("button");
        this.value = item.id;
        close();
        this.paint();
        this.onChange(item.id);
      });
      list.addChild(line);
    });
    this.layer.addChild(list);
  }
}

export class Onboarding {
  readonly root = new Container({ label: "onboarding" });
  private readonly veil = new Graphics();
  private readonly card = new Container({ label: "onboarding-card" });
  private readonly dropdowns = new Container({ label: "dropdowns" });
  private readonly name: TextField;
  private step: { type: "profile"; profile: Profile } | { type: "waiting"; note: string } | null = null;
  private deck: string | null = null;
  private botDeck: string | null = null;
  private statusText = "";
  private dot: Graphics | null = null;
  private fieldsVisible = true;
  private readonly tick = (): void => this.breathe();

  constructor(
    private readonly stage: Stage,
    private readonly locale: string,
    private readonly actions: OnboardingActions
  ) {
    this.root.visible = false;
    // Il velo prende i click: la home dietro aspetta.
    this.veil.eventMode = "static";
    this.name = new TextField(stage, { placeholder: t("html.ob.name.ph"), maxLength: 24, onEnter: () => this.go() });
    this.root.addChild(this.veil, this.card, this.dropdowns);
    stage.screens.addChild(this.root);
    stage.onLayout(() => this.root.visible && this.build());
  }

  isOpen(): boolean {
    return this.root.visible;
  }

  /** Il passo del profilo: nome e mazzo (e, contro il bot, il suo). */
  profile(profile: Profile): void {
    this.step = { type: "profile", profile };
    this.deck = profile.deck;
    this.botDeck = profile.botDeck;
    this.name.value = profile.name;
    this.open();
    this.name.focus();
  }

  /** Il passo dell'attesa: in stanza si va al tavolo solo quando c'è anche l'altro. */
  showWaiting(note: string): void {
    this.step = { type: "waiting", note };
    this.open();
  }

  /** Lo stato dell'attesa: «Mi sto collegando…», «In attesa dell'altro giocatore…». */
  status(text: string): void {
    this.statusText = text;
    if (this.root.visible && this.step?.type === "waiting") this.build();
  }

  close(): void {
    if (!this.root.visible) return;
    this.root.visible = false;
    this.step = null;
    this.name.show(false);
    this.stage.app.ticker.remove(this.tick);
    this.clearAll();
    this.actions.backdrop(false);
  }

  /** Il campo del nome è un <input> sopra il canvas: sotto il sipario non deve restare a galla. */
  showFields(visibleOnes: boolean): void {
    this.fieldsVisible = visibleOnes;
    this.name.show(visibleOnes && this.root.visible && this.step?.type === "profile");
  }

  private open(): void {
    if (!this.root.visible) {
      this.root.visible = true;
      this.stage.app.ticker.add(this.tick);
      this.actions.backdrop(true);
    }
    this.fieldsVisible = true;
    this.build();
  }

  private go(): void {
    const step = this.step;
    if (step?.type !== "profile") return;
    this.actions.toTable({ mode: step.profile.mode, name: this.name.value.trim(), deck: this.deck, botDeck: this.botDeck });
  }

  private clearAll(): void {
    for (const child of this.card.removeChildren()) child.destroy({ children: true });
    for (const child of this.dropdowns.removeChildren()) child.destroy({ children: true });
    this.dot = null;
  }

  private breathe(): void {
    if (!this.dot) return;
    // onboard-breathe: 1.6s, da .35 a 1 e da .85 a 1.
    const k = reducedMotion() ? 1 : 0.5 - 0.5 * Math.cos((performance.now() / 1600) * Math.PI * 2);
    this.dot.alpha = 0.35 + 0.65 * k;
    this.dot.scale.set(0.85 + 0.15 * k);
  }

  private build(): void {
    this.clearAll();
    const step = this.step;
    if (!step) return;
    const v = this.stage.visible();
    // --overlay-veil del tema scuro.
    this.veil.clear().rect(v.x, v.y, v.width, v.height).fill({ color: 0x080608, alpha: 0.82 });
    const add = (node: Container, x: number, y: number): void => {
      node.position.set(x, y);
      this.card.addChild(node);
    };
    let y = PAD_TOP;
    const brand = this.brand();
    add(brand.sprite, PAD_X, y);
    y += brand.h + 14;
    add(new Graphics().rect(0, 0, INNER, 1).fill(0x29222a), PAD_X, y);
    y += 1 + 2 + GAP;
    let fieldY: number | null = null;
    const note = (text: string): void => {
      if (!text) return;
      const written = paintText(this.stage, text, FONT_BASE, INK, { maxW: INNER, lineHeight: 24 });
      add(written.sprite, PAD_X, y);
      y += written.h + STEP_GAP;
    };
    if (step.type === "profile") {
      note(step.profile.note);
      const rowLabel = (text: string): void => {
        y += 6;
        const written = paintText(this.stage, text, LABEL, INK, { maxW: INNER });
        written.sprite.alpha = 0.75;
        add(written.sprite, PAD_X, y);
        y += written.h - 6 + STEP_GAP;
      };
      rowLabel(t("html.ob.name"));
      fieldY = y;
      y += FIELD_H + STEP_GAP;
      const items = allDecks().map(deck => ({ id: deck.id, label: deckName(deck.id, this.locale) }));
      rowLabel(t("html.ob.deck"));
      add(new Dropdown(this.stage, items, this.deck, this.dropdowns, id => (this.deck = id)).root, PAD_X, y);
      y += FIELD_H + STEP_GAP;
      if (step.profile.mode === "bot") {
        rowLabel(t("html.ob.deck.bot"));
        add(new Dropdown(this.stage, items, this.botDeck, this.dropdowns, id => (this.botDeck = id)).root, PAD_X, y);
        y += FIELD_H + STEP_GAP;
      }
      y += 2;
      // .onboard-primary nel Notte: la piastra, col filo e la scritta del rubino.
      add(new Button(this.stage, { label: t("html.ob.go"), style: "plate", edge: ACTION_EDGE, color: ACTION_LABEL, w: INNER, h: 48, onTap: () => this.go() }), PAD_X, y);
      y += 48;
    } else {
      note(step.note);
      const status = paintText(this.stage, this.statusText, FONT_BASE, INK, { maxW: INNER - 20 });
      status.sprite.alpha = 0.8;
      const rowH = Math.max(status.h, 12);
      const dot = new Graphics().circle(0, 0, 9).fill({ color: 0xe0314b, alpha: 0.25 }).circle(0, 0, 5).fill(0xe0314b);
      add(dot, PAD_X + 5, y + rowH / 2);
      this.dot = dot;
      add(status.sprite, PAD_X + 20, y + (rowH - status.h) / 2);
      y += rowH + STEP_GAP;
      const invite = new Button(this.stage, {
        label: t("html.ob.wait.invite"),
        style: "plate",
        edge: ACTION_EDGE,
        color: ACTION_LABEL,
        w: INNER,
        h: 48,
        onTap: () =>
          void this.actions.invite().then(copied => {
            if (!copied || invite.destroyed) return;
            invite.paintText(t("copied"));
            setTimeout(() => !invite.destroyed && invite.paintText(t("html.ob.wait.invite")), 1600);
          }),
      });
      add(invite, PAD_X, y);
      y += 48 + STEP_GAP + 6;
      add(new Button(this.stage, { label: t("html.ob.wait.leave"), style: "thin", w: INNER, h: 24, onTap: () => this.actions.leave() }), PAD_X, y);
      y += 24;
    }
    y += PAD_BOTTOM;
    const h = y;
    const cx = v.x + (v.width - W) / 2;
    const cy = Math.max(v.y + TOOLBAR_H + 12, v.y + (v.height - h) / 2);
    this.card.position.set(cx, cy);
    // La lastra di vetro pesante (--glass-heavy), col filo tenue e la sua ombra lunga.
    const shadow = slabShadow([{ x: 0, y: 30, blur: 80, color: "rgba(0,0,0,.6)" }], SHADOW_M);
    placeShadow(shadow, SHADOW_M, 0, 0, W, h);
    const slab = new Graphics().rect(0, 0, W, h).fill({ color: 0x0b090c, alpha: 0.98 }).stroke({ color: 0x29222a, width: 1, alignment: 1 });
    slab.eventMode = "static";
    this.card.addChildAt(slab, 0);
    this.card.addChildAt(shadow, 0);
    if (fieldY !== null) {
      this.name.place(cx + PAD_X, cy + fieldY, INNER, FIELD_H);
      this.name.show(this.fieldsVisible);
    } else {
      this.name.show(false);
    }
  }

  /** «◆ Rubyfront ◆»: il marchio in cima alla carta, fra le due gemme del rubino. */
  private brand(): { sprite: Sprite; h: number } {
    const res = this.stage.visible().scale * this.stage.app.renderer.resolution;
    const h = Math.ceil(16 * 1.3);
    const text = "Rubyfront";
    const gem = "◆";
    const gap = textWidth(BRAND, " ");
    const tw = textWidth(BRAND, text);
    const gw = textWidth(BRAND, gem);
    const total = gw + gap + tw + gap + gw;
    const texture = paintPiece(INNER, h, res, ctx => {
      const { ascent, descent } = fontMetrics(BRAND);
      const baseline = (h + ascent - descent) / 2;
      let x = (INNER - total) / 2;
      drawText(ctx, { kind: "text", text: gem, font: BRAND, color: "#e0314b" }, x, baseline);
      x += gw + gap;
      drawText(ctx, { kind: "text", text, font: BRAND, color: INK }, x, baseline);
      x += tw + gap;
      drawText(ctx, { kind: "text", text: gem, font: BRAND, color: "#e0314b" }, x, baseline);
    });
    const sprite = new Sprite(texture);
    sprite.on("destroyed", () => texture.destroy(true));
    return { sprite, h };
  }
}
