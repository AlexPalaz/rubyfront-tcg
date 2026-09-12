// Gli attrezzi delle schermate (F6, tema scuro «Notte» dal 2026-09-12): la
// tavolozza del tema (style.css del simulatore: :root, poi i due blocchi
// body[data-ui-theme="notte"], vince l'ultimo), i tasti — metallo (il rubino
// sfaccettato dei tasti primari della home e dell'header), piastra (tutti gli
// altri: nel Notte la regola di select, input e button pesa più delle loro
// classi, e ognuno tiene solo il suo filo e la sua scritta), secondario (il
// vetro scuro della home), sottile (onboard-skip, sulla sua piastra) —
// dipinti come il resto del gioco e sensibili al passaggio; le scritte;
// l'ombra delle lastre, a nove fette; il campo di testo, che è un <input>
// vero posato sul canvas (nome, stanza, chat): la tastiera, il cursore, il
// copia-incolla e i metodi d'immissione restano del browser, in Electron
// come sul sito.

import { ColorMatrixFilter, Container, Graphics, NineSliceSprite, Point, Rectangle, Sprite, type FederatedPointerEvent, type Texture } from "pixi.js";
import { totalHeight, drawLines, drawText, fontMetrics, layout, textWidth, type Font, type TextShadow } from "../card/text";
import type { Stage, Visible } from "../stage";
import { playSound } from "../sound";
import { SANS, paintPiece, linearGradient, withShadow } from "../table/appearance";

/** La tavolozza del tema scuro «Notte» (style.css del simulatore, l'ultimo blocco body[data-ui-theme="notte"]). */
export const BG = "#0b090d";
export const SURFACE = "#100d12";
export const PANEL = "#151117";
export const PANEL_2 = "#1c171e";
export const INK = "#f1eae6";
export const MUTED = "#9a8e93";
export const LINE = "#3a3037";
export const LINE_SOFT = "#29222a";
export const RUBY = "#ff4d6d";
/** --glass-heavy e --overlay-veil: il vetro delle carte d'accoglienza e il velo che copre. */
export const GLASS_HEAVY = "rgba(11,9,12,.98)";
export const OVERLAY_VEIL = "rgba(8,6,8,.82)";
/** La piastra del Notte: selettori, campi e tasti di servizio (gradiente, filo di luce in cima). */
export const PLATE = "linear-gradient(180deg, #241d22, #151116)";
/** Il filo e la scritta dei tasti d'azione che nel Notte stanno sulla piastra (onboard-primary, engine-stop-ok, mazzi-play). */
export const ACTION_EDGE = "#e56a86";
export const ACTION_LABEL = "#fdeef1";
/** Il chiaro dei testi sopra le illustrazioni (la home). */
export const PAPER = "#f3edf0";

/** Un colore CSS «#rrggbb» come numero, per la Graphics di Pixi. */
export function hex(css: string): number {
  return parseInt(css.slice(1, 7), 16);
}
/** L'altezza dell'header (--toolbar-h). */
export const TOOLBAR_H = 54;

export type ButtonStyle = "metal" | "plate" | "secondary" | "thin";

export interface ButtonOptions {
  label: string;
  style: ButtonStyle;
  /** Larghezza fissa (unità di progetto); senza, quanto la scritta più il margine. */
  w?: number;
  h?: number;
  font?: Font;
  /** Il colore della scritta (piastra: di norma l'inchiostro; i tasti ghost il muto). */
  color?: string;
  /** Il filo della piastra (di norma la linea del tema; i tasti d'azione il rosa FILO_AZIONE; «sottile» non ne ha). */
  edge?: string;
  onTap: () => void;
}

/** La scritta dei tasti del gioco: maiuscolo, 700, .1em. */
export const BUTTON_FONT: Font = { size: 16, weight: 700, family: SANS, spacing: 1.6, upper: true };
/** La scritta dei tasti semplici e dei campi. */
export const FONT_BASE: Font = { size: 16, weight: 400, family: SANS };

/** Un tasto dipinto: la sua scritta, il suo vestito, il passaggio che lo schiarisce o gli accende il filo, lo spento a .38. */
export class Button extends Container {
  private readonly sprite = new Sprite();
  private readonly light = new ColorMatrixFilter();
  private readonly edge = new Graphics();
  private texture: Texture | null = null;
  private enabled = true;
  private readonly onLayout = (): void => this.paint();
  w: number;
  h: number;

  constructor(
    private readonly stage: Stage,
    private opts: ButtonOptions
  ) {
    super({ label: `button:${opts.label}` });
    this.w = 0;
    this.h = 0;
    this.measure();
    this.edge.visible = false;
    this.addChild(this.sprite, this.edge);
    this.eventMode = "static";
    this.cursor = "pointer";
    this.light.brightness(1.12, false);
    this.on("pointerover", () => {
      if (!this.enabled) return;
      if (this.opts.style === "metal") this.sprite.filters = [this.light];
      else if (this.opts.style === "thin") this.sprite.alpha = 0.9;
      else this.edge.visible = true;
    });
    this.on("pointerout", () => {
      this.sprite.filters = [];
      this.edge.visible = false;
      if (this.opts.style === "thin") this.sprite.alpha = 0.6;
    });
    this.on("pointertap", (event: FederatedPointerEvent) => {
      // Il tasto si prende il suo tocco: la carta della home sotto di lui non lo sente.
      event.stopPropagation();
      if (!this.enabled) return;
      playSound("button");
      this.opts.onTap();
    });
    stage.onLayout(this.onLayout);
  }

  /** Cambia la scritta (e rifà il tasto). */
  paintText(label: string): void {
    this.opts = { ...this.opts, label };
    this.label = `button:${label}`;
    this.measure();
    this.paint();
  }

  setDisabled(dimmed: boolean): void {
    this.enabled = !dimmed;
    this.alpha = dimmed ? 0.38 : 1;
    this.cursor = dimmed ? "default" : "pointer";
  }

  private font(): Font {
    return this.opts.font ?? (this.opts.style === "thin" ? FONT_BASE : BUTTON_FONT);
  }

  private measure(): void {
    const font = this.font();
    this.w = this.opts.w ?? Math.ceil(textWidth(font, this.opts.label)) + (this.opts.style === "thin" ? 4 : 32) + 2;
    this.h = this.opts.h ?? (this.opts.style === "thin" ? 24 : 46);
    this.hitArea = new Rectangle(0, 0, this.w, this.h);
    // Al passaggio il filo si accende: rubino sulle piastre; sul vetro e sui campi della home il rosa della gemma.
    this.edge.clear().rect(0.5, 0.5, this.w - 1, this.h - 1).stroke({ color: this.opts.style === "secondary" || this.opts.edge === ACTION_EDGE ? 0xf0a0b4 : hex(RUBY), width: 1 });
  }

  private paint(): void {
    if (this.destroyed) return;
    const { style, label } = this.opts;
    const font = this.font();
    const res = this.stage.visible().scale * this.stage.app.renderer.resolution;
    const margin = style === "metal" ? 24 : 2;
    const { w, h } = this;
    const old = this.texture;
    this.texture = paintPiece(w + 2 * margin, h + 2 * margin, res, ctx => {
      ctx.translate(margin, margin);
      let shadows: TextShadow[] | undefined;
      if (style === "metal") {
        // Il rubino del Notte: metallo sfaccettato, il filo di luce in cima, l'anello scuro, l'alone.
        const fill = (): void => {
          ctx.fillStyle = linearGradient(ctx, 180, 0, 0, w, h, [[0, "#d1244f"], [0.52, "#a41539"], [1, "#7f0c2b"]]);
          ctx.fillRect(0, 0, w, h);
        };
        withShadow(ctx, res, { x: 0, y: 6, blur: 16, color: "rgba(158,15,52,.38)" }, fill);
        withShadow(ctx, res, { x: 0, y: 0, blur: 16, color: "rgba(255,77,109,.3)" }, fill);
        fill();
        ctx.strokeStyle = "#35070f";
        ctx.lineWidth = 1;
        ctx.strokeRect(-0.5, -0.5, w + 1, h + 1);
        ctx.fillStyle = "rgba(255,255,255,.28)";
        ctx.fillRect(1, 1, w - 2, 1);
        ctx.fillStyle = "rgba(0,0,0,.28)";
        ctx.fillRect(1, h - 3, w - 2, 2);
        ctx.strokeStyle = "#ff7b98";
        ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
        shadows = [{ x: 0, y: 1, blur: 0, color: "rgba(0,0,0,.4)" }];
      } else if (style === "secondary") {
        // .home-primary.home-secondary: vetro scuro, filo chiaro.
        ctx.fillStyle = "rgba(8,6,9,.55)";
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = "rgba(255,255,255,.28)";
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      } else {
        // La piastra del Notte, anche sotto il tasto sottile (che non ha filo).
        ctx.fillStyle = linearGradient(ctx, 180, 0, 0, w, h, [[0, "#241d22"], [1, "#151116"]]);
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "rgba(255,255,255,.07)";
        ctx.fillRect(1, 1, w - 2, 1);
        if (style === "plate") {
          ctx.strokeStyle = this.opts.edge ?? LINE;
          ctx.lineWidth = 1;
          ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
        }
      }
      const color = this.opts.color ?? (style === "metal" ? ACTION_LABEL : style === "secondary" ? PAPER : INK);
      const { ascent, descent } = fontMetrics(font);
      const tw = textWidth(font, label);
      const x = (w - tw) / 2;
      const baseline = (h + ascent - descent) / 2;
      drawText(ctx, { kind: "text", text: label, font, color, ...(shadows ? { shadows } : {}) }, x, baseline);
      if (style === "thin") {
        ctx.fillStyle = color;
        ctx.fillRect(x, baseline + 3, tw, 1);
      }
    });
    this.sprite.texture = this.texture;
    this.sprite.position.set(-margin, -margin);
    if (style === "thin") this.sprite.alpha = 0.6;
    old?.destroy(true);
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.stage.offLayout(this.onLayout);
    this.texture?.destroy(true);
    this.texture = null;
    super.destroy(options);
  }
}

/** Una scritta dipinta (su più righe se serve), con la cima in (0, 0). */
export function paintText(
  stage: Stage,
  text: string,
  font: Font,
  color: string,
  opts: { maxW?: number; lineHeight?: number; shadows?: TextShadow[]; align?: "left" | "center" } = {}
): { sprite: Sprite; w: number; h: number } {
  const res = stage.visible().scale * stage.app.renderer.resolution;
  const lineHeight = opts.lineHeight ?? font.size * 1.3;
  const lines = layout([{ kind: "text", text, font, color, ...(opts.shadows ? { shadows: opts.shadows } : {}) }], opts.maxW ?? 100_000, { font, lineHeight });
  const w = Math.ceil(lines.reduce((max, line) => Math.max(max, line.width), 0));
  const h = Math.ceil(totalHeight(lines));
  const margin = opts.shadows ? 30 : 4;
  const texture = paintPiece(w + 2 * margin, h + 2 * margin, res, ctx => {
    // Ogni riga porta la sua linea di base dalla cima del blocco.
    for (const line of lines) {
      const dx = opts.align === "center" ? (w - line.width) / 2 : 0;
      drawLines(ctx, [line], margin + dx, margin);
    }
  });
  const sprite = new Sprite(texture);
  sprite.pivot.set(margin, margin);
  sprite.eventMode = "none";
  sprite.on("destroyed", () => texture.destroy(true));
  return { sprite, w, h };
}

/** Un titolo col trattino morbido (­): intero se ci sta, se no «Multi-» e a capo. */
export function fitTitle(text: string, font: Font, maxW: number): string {
  if (!text.includes("­")) return text;
  const plain = text.replace(/­/g, "");
  return textWidth(font, plain) <= maxW ? plain : text.replace(/­/g, "-");
}

export interface ShadowLayer {
  x: number;
  y: number;
  blur: number;
  color: string;
  /** Il filo pieno attorno (box-shadow 0 0 0 1px): spesso quanto dice. */
  spread?: number;
}

const SHADOW_BOX = 40;

/** L'ombra di una lastra (box-shadow) come texture a nove fette: si stira su qualunque misura senza ridipingere. */
export function slabShadow(layers: ShadowLayer[], margin: number): NineSliceSprite {
  const size = SHADOW_BOX + 2 * margin;
  const texture = paintPiece(size, size, 1, ctx => {
    for (const layer of layers) {
      ctx.save();
      if (layer.spread) {
        ctx.strokeStyle = layer.color;
        ctx.lineWidth = layer.spread;
        ctx.strokeRect(margin - layer.spread / 2, margin - layer.spread / 2, SHADOW_BOX + layer.spread, SHADOW_BOX + layer.spread);
      } else {
        ctx.shadowColor = layer.color;
        ctx.shadowOffsetX = layer.x;
        ctx.shadowOffsetY = layer.y;
        ctx.shadowBlur = layer.blur;
        ctx.fillStyle = "#000";
        // Il box stesso fuori dal foglio: resta solo l'ombra (la lastra sopra copre il resto).
        ctx.translate(-size * 4, 0);
        ctx.shadowOffsetX += size * 4;
        ctx.fillRect(margin, margin, SHADOW_BOX, SHADOW_BOX);
      }
      ctx.restore();
    }
  });
  const side = margin + SHADOW_BOX / 2 - 1;
  const sprite = new NineSliceSprite({ texture, leftWidth: side, rightWidth: side, topHeight: side, bottomHeight: side });
  sprite.eventMode = "none";
  sprite.on("destroyed", () => texture.destroy(true));
  return sprite;
}

/** Posa un'ombra di lastra attorno al rettangolo x, y, w, h. */
export function placeShadow(shadow: NineSliceSprite, margin: number, x: number, y: number, w: number, h: number): void {
  shadow.position.set(x - margin, y - margin);
  shadow.width = w + 2 * margin;
  shadow.height = h + 2 * margin;
}

export interface TextFieldOptions {
  placeholder: string;
  maxLength?: number;
  onEnter?: () => void;
  onInput?: () => void;
  /** Il vestito: fondo, filo, scritta, segnaposto, filo in fuoco (di norma la piastra del Notte). */
  backdrop?: string;
  edge?: string;
  color?: string;
  placeholderColor?: string;
  fire?: string;
}

let fieldStyles = false;
/** Il colore del segnaposto passa da una variabile: ::placeholder non si scrive in `style`. */
function mountFieldStyles(): void {
  if (fieldStyles) return;
  fieldStyles = true;
  const style = document.createElement("style");
  style.textContent = "input.rbf-field::placeholder { color: var(--rbf-placeholder); opacity: 1; }";
  document.head.append(style);
}

/**
 * Il campo di testo: un <input> vero sopra il canvas, alle coordinate di un
 * rettangolo del mondo (unità di progetto) — si riposa da sé quando la
 * finestra cambia misura, con la sua scala.
 */
export class TextField {
  readonly el: HTMLInputElement;
  private box = { x: 0, y: 0, w: 200, h: 44 };
  private readonly edge: string;
  private readonly onLayout = (): void => this.reposition();

  constructor(
    private readonly stage: Stage,
    opts: TextFieldOptions
  ) {
    this.edge = opts.edge ?? LINE;
    const fire = opts.fire ?? RUBY;
    mountFieldStyles();
    this.el = document.createElement("input");
    this.el.className = "rbf-field";
    this.el.type = "text";
    this.el.autocomplete = "off";
    this.el.spellcheck = false;
    this.el.placeholder = opts.placeholder;
    if (opts.maxLength) this.el.maxLength = opts.maxLength;
    Object.assign(this.el.style, {
      position: "fixed",
      zIndex: "20",
      boxSizing: "border-box",
      margin: "0",
      border: `1px solid ${this.edge}`,
      borderRadius: "0",
      background: opts.backdrop ?? PLATE,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,.07)",
      color: opts.color ?? INK,
      caretColor: opts.color ?? INK,
      colorScheme: "dark",
      fontFamily: SANS,
      outline: "none",
      display: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    this.el.style.setProperty("--rbf-placeholder", opts.placeholderColor ?? "rgba(237,230,224,.45)");
    this.el.addEventListener("focus", () => (this.el.style.borderColor = fire));
    this.el.addEventListener("blur", () => (this.el.style.borderColor = this.edge));
    this.el.addEventListener("keydown", event => {
      // I tasti del campo sono del campo: Esc e le scorciatoie del tavolo non li sentono.
      event.stopPropagation();
      if (event.key === "Enter") opts.onEnter?.();
    });
    if (opts.onInput) this.el.addEventListener("input", opts.onInput);
    document.body.append(this.el);
    stage.onLayout(this.onLayout);
  }

  get value(): string {
    return this.el.value;
  }

  set value(text: string) {
    this.el.value = text;
  }

  place(x: number, y: number, w: number, h: number): void {
    this.box = { x, y, w, h };
    this.reposition();
  }

  show(isVisible: boolean): void {
    this.el.style.display = isVisible ? "block" : "none";
    if (!isVisible && document.activeElement === this.el) this.el.blur();
    if (isVisible) this.reposition();
  }

  isVisible(): boolean {
    return this.el.style.display !== "none";
  }

  focus(): void {
    this.el.focus({ preventScroll: true });
  }

  isFocused(): boolean {
    return document.activeElement === this.el;
  }

  private reposition(): void {
    const scale = this.stage.visible().scale;
    const rect = this.stage.app.canvas.getBoundingClientRect();
    const at = this.stage.screens.toGlobal(new Point(this.box.x, this.box.y));
    Object.assign(this.el.style, {
      left: `${rect.left + at.x}px`,
      top: `${rect.top + at.y}px`,
      width: `${this.box.w * scale}px`,
      height: `${this.box.h * scale}px`,
      fontSize: `${16 * scale}px`,
      padding: `0 ${12 * scale}px`,
    });
  }

  dispose(): void {
    this.stage.offLayout(this.onLayout);
    this.el.remove();
  }
}

/** L'area delle schermate sotto l'header, in unità di progetto. */
export function areaBelow(v: Visible): { x: number; y: number; w: number; h: number } {
  return { x: v.x, y: v.y + TOOLBAR_H, w: v.width, h: v.height - TOOLBAR_H };
}
