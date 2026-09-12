// Le scene del tavolo (simulatore/src/effect.ts): il momento in cui una carta
// entra, attacca, si risolve o flippa — la carta grande sul velo scuro del
// tema notte (sfocato sotto, come il backdrop-filter) e, di fianco, la riga in alto, chi la gioca, i testi degli
// effetti e degli inneschi, e «Continua» o «Risolvi». Le scene si mettono in
// fila: una alla volta, la successiva aspetta che la prima sia chiusa. Poi
// l'avviso e la conferma di un effetto (un pannello piccolo, senza velo: il
// bersaglio acceso resta in vista) e la scelta fra più voci (le abilità del
// Rubyfront e il flip, §3.1).
//
// Tutto sta nel mondo, sopra il tavolo, in unità di progetto. Le animazioni
// d'ingresso (la carta che si accende) arrivano con F5.

import type { ChoiceShow, SceneShow } from "@rubyfront/core/gestures";
import { t } from "@rubyfront/core/i18n";
import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { faceTexture } from "../card/cache";
import { CARD_H, CARD_W } from "../card/theme";
import { totalHeight, drawLines, drawText, fontMetrics, layout, textWidth, type Font, type TextShadow, type TextLine } from "../card/text";
import type { Stage, Visible } from "../stage";
import { key, tween, easeIn, easeOut } from "./animation";
import { SANS, paintPiece, withShadow } from "./appearance";
import { FIXED } from "./layout";
import { NIGHT, LIGHT_VEIL, MOMENT_VEIL, plate, setBlurred, below } from "./night";

/** La colonna di fianco alla carta (minmax(260px, 420px)), il margine della scena, lo spazio fra carta e colonna. */
const SIDE_W = 420;
const PAD = 24;
const COL_GAP = 36;
/** Il margine attorno alla carta per la sua ombra. */
const SHADOW = 140;
/** Il pannello della conferma e il margine per la sua ombra. */
const PANEL_W = 380;
const PANEL_SHADOW = 100;
/** Quanto svanisce la scena prima di passare la mano (effect-veil.is-leaving). */
const LEAVE_MS = 220;
/** Quanto resta in vista la giocata dell'avversario (effect.ts, PEEK_HOLD_MS). */
const PEEK_HOLD_MS = 2600;

// I colori del tema notte (table/night.ts): le --banda-* per la scena, le
// variabili del Notte per la conferma, che sta fuori dalla banda.
const INK = NIGHT.bandaInk;
const MUTED = NIGHT.bandaMuted;
const RUBY = NIGHT.bandaRuby;
const PANEL = NIGHT.bandaPanel;
const PANEL_LINE = NIGHT.bandaFilo;
const TRIGGER_LINE = NIGHT.rubyLineSoft;
const CONFIRM_LINE = NIGHT.rubyLine;
/** Il margine della colonna per l'alone della riga in alto (--banda-ruby-glow: 0 0 18px). */
const COL_M = 24;

const BODY: Font = { size: 16, weight: 400, family: SANS };
const KICKER: Font = { size: 17.6, weight: 700, family: SANS, spacing: 17.6 * 0.24, upper: true };
const WHO: Font = { size: 13.6, weight: 400, family: SANS, spacing: 13.6 * 0.14, upper: true };
const TAG: Font = { size: 12, weight: 400, family: SANS, spacing: 12 * 0.12, upper: true };
const BUTTON: Font = { size: 16, weight: 700, family: SANS, spacing: 1.6, upper: true };
const CHOICE_NAME: Font = { size: 16.8, weight: 700, family: SANS };
const CHOICE_PRICE: Font = { size: 16, weight: 700, family: SANS, spacing: 0.96 };
const CHOICE_HINT: Font = { size: 12.8, weight: 400, family: SANS, spacing: 12.8 * 0.08, upper: true };

/** Un pezzo della colonna: misura e pennello. */
interface ColumnPiece {
  w: number;
  h: number;
  draw(ctx: CanvasRenderingContext2D, x: number, y: number): void;
}

/** Un paragrafo impaginato: le linee di base contano dalla cima del blocco. */
function paragraph(text: string, font: Font, color: string, maxW: number, lineHeight: number, shadows?: TextShadow[]): ColumnPiece & { lines: TextLine[] } {
  const lines = layout([{ kind: "text", text, font, color, ...(shadows ? { shadows } : {}) }], maxW, { font, lineHeight });
  return {
    lines,
    w: lines.reduce((max, line) => Math.max(max, line.width), 0),
    h: totalHeight(lines),
    draw: (ctx, x, y) => drawLines(ctx, lines, x, y),
  };
}

/** Il riquadro di un effetto o di un innesco (.effect-text): la targhetta e la frase. */
function box(tag: string, text: string, line: string): ColumnPiece {
  const inner = SIDE_W - 32 - 2;
  const tagB = paragraph(tag, TAG, MUTED, inner, 12 * 1.25);
  const textB = paragraph(text, BODY, INK, inner, 16 * 1.5);
  const h = 1 + 14 + tagB.h + 6 + textB.h + 14 + 1;
  return {
    w: SIDE_W,
    h,
    draw(ctx, x, y) {
      ctx.fillStyle = PANEL;
      ctx.fillRect(x, y, SIDE_W, h);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, SIDE_W - 1, h - 1);
      tagB.draw(ctx, x + 17, y + 15);
      textB.draw(ctx, x + 17, y + 15 + tagB.h + 6);
    },
  };
}

type ButtonKind = "go" | "ghost" | "no";

/** Un tasto: il gesto (.effect-go), il fantasma (.is-ghost) o il «no» della conferma — sul Notte, piastre brunite. */
function button(label: string, type: ButtonKind, _res: number): ColumnPiece {
  const labelW = textWidth(BUTTON, label);
  const w = Math.ceil(labelW) + (type === "no" ? 36 : 44) + 2;
  const h = 44;
  const { ascent, descent } = fontMetrics(BUTTON);
  return {
    w,
    h,
    draw(ctx, x, y) {
      // La cornice rosa del gesto, quella di linea del «no»; il fantasma è solo cornice (.effect-go.is-ghost).
      if (type === "go") plate(ctx, x, y, w, h, NIGHT.goLine);
      else if (type === "no") plate(ctx, x, y, w, h, NIGHT.line);
      else plate(ctx, x, y, w, h, PANEL_LINE, false);
      const color = type === "go" ? NIGHT.goInk : type === "no" ? NIGHT.ink : INK;
      drawText(ctx, { kind: "text", text: label, font: BUTTON, color }, x + (w - labelW) / 2, y + (h + ascent - descent) / 2);
    },
  };
}

/** Una voce della scelta (.effect-choice): nome e prezzo in testa, il testo sotto, spenta col perché. */
function item(option: ChoiceShow["options"][number]): ColumnPiece {
  const inner = SIDE_W - 28 - 2;
  const priceW = option.price ? textWidth(CHOICE_PRICE, option.price) : 0;
  const name = paragraph(option.label, CHOICE_NAME, INK, inner - (priceW ? priceW + 12 : 0), 16.8 * 1.4);
  const text = paragraph(option.text, BODY, INK, inner, 16 * 1.4);
  const hint = option.hint ? paragraph(option.hint, CHOICE_HINT, MUTED, inner, 12.8 * 1.4) : null;
  const h = 1 + 12 + name.h + 4 + text.h + (hint ? 4 + hint.h : 0) + 12 + 1;
  return {
    w: SIDE_W,
    h,
    draw(ctx, x, y) {
      ctx.save();
      if (option.disabled) ctx.globalAlpha = 0.55;
      // La voce è un tasto: sul Notte la piastra brunita, con la cornice della banda.
      plate(ctx, x, y, SIDE_W, h, PANEL_LINE);
      let top = y + 13;
      name.draw(ctx, x + 15, top);
      if (option.price) {
        drawText(ctx, { kind: "text", text: option.price, font: CHOICE_PRICE, color: RUBY }, x + SIDE_W - 15 - priceW, top + (name.lines[0]?.baseline ?? 0));
      }
      top += name.h + 4;
      text.draw(ctx, x + 15, top);
      top += text.h;
      if (hint) hint.draw(ctx, x + 15, top + 4);
      ctx.restore();
    },
  };
}

/** Una colonna di blocchi; quelli con un valore si toccano. */
interface Item {
  block: ColumnPiece;
  /** Lo spazio sopra (il gap della griglia, più il margine del tasto). */
  overlay: number;
  value?: string | null;
}
interface Column {
  h: number;
  draw(ctx: CanvasRenderingContext2D): void;
  hits: { x: number; y: number; w: number; h: number; value: string | null }[];
}

function stack(items: Item[]): Column {
  let y = 0;
  const seats = items.map((item, index) => {
    if (index > 0) y += item.overlay;
    const top = y;
    y += item.block.h;
    return top;
  });
  return {
    h: y,
    draw(ctx) {
      items.forEach((item, index) => item.block.draw(ctx, 0, seats[index]));
    },
    hits: items.flatMap((item, index) =>
      item.value === undefined ? [] : [{ x: 0, y: seats[index], w: item.block.w, h: item.block.h, value: item.value }]
    ),
  };
}

function head(kicker: string, who: string): Item[] {
  return [
    { block: paragraph(kicker, KICKER, RUBY, SIDE_W, 17.6 * 1.25, [{ x: 0, y: 0, blur: 18, color: "rgba(210,74,100,.5)" }]), overlay: 0 },
    { block: paragraph(who, WHO, MUTED, SIDE_W, 13.6 * 1.25), overlay: 12 },
  ];
}

function sceneColumn(show: SceneShow, res: number, withButton = true): Column {
  return stack([
    ...head(show.kicker ?? t(show.effects.length ? "scene.enter.effect" : "scene.enter"), show.who),
    ...show.effects.map(effect => ({ block: box(effect.tag, effect.text, PANEL_LINE), overlay: 12 })),
    ...(withButton ? (show.triggers ?? []) : []).map(line => ({ block: box(t("scene.triggers"), line, TRIGGER_LINE), overlay: 12 })),
    ...(withButton ? [{ block: button(t(show.triggers?.length ? "scene.resolve" : "scene.continue"), "go", res), overlay: 12 + 6, value: "go" as string | null }] : []),
  ]);
}

function choiceColumn(show: ChoiceShow, res: number): Column {
  return stack([
    ...head(show.kicker, show.who),
    ...show.options.map((option, index) => ({ block: item(option), overlay: index === 0 ? 12 : 8, ...(option.disabled ? {} : { value: option.id }) })),
    { block: button(show.closeLabel, "ghost", res), overlay: 12 + 6, value: null },
  ]);
}

/** Lo spazio del tavolo sotto la barra: lì si centrano scene e pannelli. */
function areaOf(v: Visible): { x: number; y: number; w: number; h: number } {
  return { x: v.x, y: v.y + FIXED.bar, w: v.width, h: v.height - FIXED.bar };
}

/** Un tasto trasparente sopra una zona dipinta. */
function hitZone(x: number, y: number, w: number, h: number, run: () => void): Container {
  const hit = new Container({ label: "tap" });
  hit.eventMode = "static";
  hit.cursor = "pointer";
  hit.hitArea = new Rectangle(x, y, w, h);
  hit.on("pointertap", run);
  return hit;
}

export class Scene {
  private queue: Promise<void> = Promise.resolve();
  /** Scene, scelte e pannelli aperti o in coda. */
  private openOnes = 0;
  private readonly layer = new Container({ label: "scene" });

  constructor(private readonly stage: Stage) {
    stage.world.addChild(this.layer);
  }

  /** Si risolve quando nessuna scena è in coda. */
  idle(): Promise<void> {
    return this.queue;
  }

  /** La scena di una carta: si risolve quando è chiusa (e dopo il suo onContinue). */
  show(show: SceneShow): Promise<void> {
    return this.count(this.enqueue(() => this.open(show, () => undefined)));
  }

  /**
   * La giocata dell'avversario, per chi guarda (effect.ts, showEnterPeek):
   * non ferma nulla — velo leggero, niente tasto —, la carta accesa un attimo
   * e poi via. Si mette in fila con le scene.
   */
  peek(show: SceneShow): Promise<void> {
    return this.count(this.enqueue(() => this.open(show, () => undefined, true)));
  }

  /** La scelta fra più voci: l'id scelto, o null se si chiude. */
  choose(show: ChoiceShow): Promise<string | null> {
    let chosen: string | null = null;
    return this.count(this.enqueue(() => this.open(show, id => (chosen = id))).then(() => chosen));
  }

  /** L'avviso: un pannello col suo «Va bene». */
  async notice(message: string): Promise<void> {
    await this.count(this.panel(message, [{ label: t("stop.ok"), type: "go", value: true }], { enter: true, escape: true }));
  }

  /** La conferma di un effetto: Invio è sì, Esc è no. */
  confirm(question: string, labels?: { yes: string; no: string }): Promise<boolean> {
    return this.count(this.panel(
      question,
      [
        { label: labels?.no ?? t("confirm.no"), type: "no", value: false },
        { label: labels?.yes ?? t("confirm.yes"), type: "go", value: true },
      ],
      { enter: true, escape: false }
    ));
  }

  /** Nessuna scena, scelta o pannello aperti o in coda: il tavolo è fermo (per il passo del bot). */
  isFree(): boolean {
    return this.openOnes === 0;
  }

  private count<T>(run: Promise<T>): Promise<T> {
    this.openOnes += 1;
    return run.finally(() => {
      this.openOnes -= 1;
    });
  }

  private enqueue(run: () => Promise<void>): Promise<void> {
    const turn = this.queue.then(run, run);
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private toTop(): void {
    this.layer.parent?.addChild(this.layer);
  }

  private async open(show: SceneShow | ChoiceShow, choice: (id: string | null) => void, peek = false): Promise<void> {
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;
    const area = areaOf(v);
    const zoom = Math.min(peek ? 0.7 : 0.9, (area.h - 260) / CARD_H, (area.w - 120) / (CARD_W * 2.2));
    const cw = CARD_W * zoom;
    const ch = CARD_H * zoom;
    const face = await faceTexture(show.cardId, show.face, show.locale, zoom * res);
    const painted: Texture[] = [];
    const paint = (w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture => {
      const texture = paintPiece(w, h, res, draw);
      painted.push(texture);
      return texture;
    };

    const isChoice = "options" in show;
    const side = isChoice ? choiceColumn(show, res) : sceneColumn(show, res, !peek);
    const contentH = Math.max(ch, side.h);
    const stageW = PAD + cw + COL_GAP + SIDE_W + PAD;
    const stageH = contentH + 2 * PAD;
    const sx = area.x + (area.w - stageW) / 2;
    const sy = area.y + (area.h - stageH) / 2;

    const root = new Container({ label: isChoice ? "choice-panel" : "scene-panel" });
    // Il velo ferma il tavolo: sotto non si tocca nulla finché la scena è aperta.
    // Quello della giocata avversaria è leggero e non ferma niente.
    // Sul buio niente banda dietro la scena (--banda-stage: none): basta il velo.
    const veil = new Graphics().rect(v.x, v.y, v.width, v.height).fill(peek ? LIGHT_VEIL : MOMENT_VEIL);
    veil.eventMode = peek ? "none" : "static";
    const cardX = sx + PAD;
    const cardY = sy + PAD + (contentH - ch) / 2;
    const shadow = new Sprite(paint(cw + 2 * SHADOW, ch + 2 * SHADOW, ctx => {
      const rect = (): void => {
        ctx.fillStyle = "#000";
        ctx.fillRect(SHADOW, SHADOW, cw, ch);
      };
      // Il bagliore rubino sotto, l'ombra che cade sopra (il primo box-shadow sta in cima).
      withShadow(ctx, res, { x: 0, y: 0, blur: 40, color: "rgba(210,74,100,.6)" }, rect);
      withShadow(ctx, res, { x: 0, y: 30, blur: 80, color: "rgba(0,0,0,.7)" }, rect);
    }));
    shadow.position.set(cardX - SHADOW, cardY - SHADOW);
    const card = new Sprite(face ?? Texture.WHITE);
    // Il perno al centro: la carta si accende ingrandendosi appena (effect-lit).
    card.anchor.set(0.5);
    card.position.set(cardX + cw / 2, cardY + ch / 2);
    card.width = cw;
    card.height = ch;
    const cardScale = card.scale.x;
    // Il bagliore rubino che sale e si posa (effect-lit: da 0 a 90px, poi i 40px dell'ombra).
    const glowFilter = new Sprite(paint(cw + 2 * SHADOW, ch + 2 * SHADOW, ctx => {
      withShadow(ctx, res, { x: 0, y: 0, blur: 90, color: "rgba(210,74,100,1)" }, () => {
        ctx.fillStyle = "#000";
        ctx.fillRect(SHADOW, SHADOW, cw, ch);
      });
    }));
    glowFilter.position.set(cardX - SHADOW, cardY - SHADOW);
    glowFilter.alpha = 0;
    const sideX = cardX + cw + COL_GAP;
    const sideY = sy + PAD + (contentH - side.h) / 2;
    const column = new Sprite(paint(SIDE_W + 2 * COL_M, side.h + 2 * COL_M, ctx => {
      ctx.translate(COL_M, COL_M);
      side.draw(ctx);
    }));
    column.position.set(sideX - COL_M, sideY - COL_M);
    root.addChild(veil, glowFilter, shadow, card, column);
    root.alpha = 0;
    const ticker = this.stage.app.ticker;
    void tween(ticker, 200, k => (root.alpha = k), easeOut);
    void tween(ticker, 2200, k => {
      card.scale.set(cardScale * key(k, [[0, 0.94], [0.3, 1.02], [1, 1]]));
      glowFilter.alpha = key(k, [[0, 0], [0.3, 1], [1, 0]]);
    }, easeOut);

    return new Promise(resolve => {
      let closed = false;
      let blurFilter: (() => void) | null = null;
      const close = (value: string | null): void => {
        if (closed) return;
        closed = true;
        blurFilter?.();
        window.removeEventListener("keydown", onKey);
        root.eventMode = "none";
        void tween(ticker, LEAVE_MS, k => (root.alpha = 1 - k), easeIn).then(() => {
          root.destroy({ children: true });
          for (const texture of painted) texture.destroy(true);
          if (isChoice) choice(value === "go" ? null : value);
          else show.onContinue?.();
          resolve();
        });
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Escape") close(isChoice ? null : "go");
        else if (event.key === "Enter" && !isChoice) close("go");
      };
      if (peek) {
        // La giocata avversaria se ne va da sola: nessun tasto, nessuna tastiera.
        setTimeout(() => close("go"), PEEK_HOLD_MS);
        this.layer.addChild(root);
        this.toTop();
        return;
      }
      for (const tap of side.hits) {
        root.addChild(hitZone(sideX + tap.x, sideY + tap.y, tap.w, tap.h, () => close(tap.value)));
      }
      window.addEventListener("keydown", onKey);
      this.layer.addChild(root);
      this.toTop();
      // backdrop-filter: blur(4px): sotto il velo il tavolo si sfoca.
      blurFilter = setBlurred(this.stage, below(this.stage.world, this.layer), 4);
    });
  }

  private panel(text: string, buttons: { label: string; type: ButtonKind; value: boolean }[], keys: { enter: boolean; escape: boolean }): Promise<boolean> {
    const v = this.stage.visible();
    const res = v.scale * this.stage.app.renderer.resolution;
    const area = areaOf(v);
    const body = paragraph(text, BODY, NIGHT.ink, PANEL_W - 40 - 2, 16 * 1.5);
    const blocks = buttons.map(entry => button(entry.label, entry.type, res));
    const h = 1 + 18 + body.h + 14 + 44 + 18 + 1;
    const px = area.x + (area.w - PANEL_W) / 2;
    const py = area.y + (area.h - h) / 2;
    // I tasti in fila, nell'ordine dato, allineati a destra, 10 fra l'uno e l'altro.
    const rowW = blocks.reduce((sum, block) => sum + block.w, 0) + 10 * (blocks.length - 1);
    let left = PANEL_W - 21 - rowW;
    const seats = blocks.map(block => {
      const x = left;
      left += block.w + 10;
      return x;
    });
    const rowY = 1 + 18 + body.h + 14;
    const texture = paintPiece(PANEL_W + 2 * PANEL_SHADOW, h + 2 * PANEL_SHADOW, res, ctx => {
      ctx.translate(PANEL_SHADOW, PANEL_SHADOW);
      withShadow(ctx, res, { x: 0, y: 24, blur: 60, color: "rgba(0,0,0,.6)" }, () => {
        ctx.fillStyle = NIGHT.glassHeavy;
        ctx.fillRect(0, 0, PANEL_W, h);
      });
      ctx.fillStyle = NIGHT.glassHeavy;
      ctx.fillRect(0, 0, PANEL_W, h);
      ctx.strokeStyle = CONFIRM_LINE;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, PANEL_W - 1, h - 1);
      body.draw(ctx, 21, 19);
      blocks.forEach((block, index) => block.draw(ctx, seats[index], rowY));
    });
    const root = new Container({ label: "panel" });
    const sprite = new Sprite(texture);
    sprite.position.set(px - PANEL_SHADOW, py - PANEL_SHADOW);
    // Il pannello si prende i suoi click; il tavolo attorno resta com'è.
    const background = hitZone(px, py, PANEL_W, h, () => undefined);
    background.cursor = "default";
    root.addChild(sprite, background);

    return new Promise(resolve => {
      const close = (value: boolean): void => {
        window.removeEventListener("keydown", onKey);
        root.destroy({ children: true });
        texture.destroy(true);
        resolve(value);
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Enter") close(keys.enter);
        else if (event.key === "Escape") close(keys.escape);
      };
      blocks.forEach((block, index) => {
        root.addChild(hitZone(px + seats[index], py + rowY, block.w, block.h, () => close(buttons[index].value)));
      });
      window.addEventListener("keydown", onKey);
      this.layer.addChild(root);
      this.toTop();
    });
  }
}
