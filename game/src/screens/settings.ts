// Le impostazioni (simulatore: index.html #settings): un cassetto sotto
// l'ingranaggio, una riga per preferenza — Rete (riallinea dal tavolo),
// Suoni, Musica, Schermo (intero: nuovo nel gioco, per il desktop e lo
// Steam Deck), Lingua. Mic, vista e tema del simulatore qui non ci sono: il
// gioco ha un tavolo solo e il tema chiaro. Si chiude con un click fuori o
// con Esc; le scelte restano salvate. Tema «Notte»: il pannello, il filo
// della linea, i tasti sulla piastra (anche i ghost: la regola del tema pesa
// più della loro classe), quelli accesi in inchiostro e gli spenti muti.

import { lang, t } from "@rubyfront/core/i18n";
import { Container, Graphics } from "pixi.js";
import type { Font } from "../card/text";
import { store } from "../match";
import type { Stage } from "../stage";
import { setMusicEnabled, setSoundEnabled } from "../sound";
import { SANS } from "../table/appearance";
import { TOOLBAR_H, FONT_BASE, INK, LINE, MUTED, PANEL, Button, hex, slabShadow, placeShadow, paintText } from "./ui";

const W = 400;
const PAD = 14;
const LABEL_W = 112;
const ROW_H = 32;
const ROW_GAP = 10;
const LABEL: Font = { size: 16, weight: 700, family: SANS, spacing: 1.6, upper: true };
const SHADOW_M = 60;

export interface SettingsActions {
  resync(): void;
  language(locale: "it" | "en"): void;
}

/** Suoni e musica come li ha lasciati il giocatore (store: "sound", "music"). */
export function applyAudio(): void {
  setSoundEnabled(store.read("sound", "on") !== "off");
  setMusicEnabled(store.read("music", "on") !== "off");
}

export class Settings {
  readonly root = new Container({ label: "settings" });
  private readonly catcher = new Graphics();
  private readonly panel = new Container({ label: "settings-panel" });

  constructor(
    private readonly stage: Stage,
    private readonly actions: SettingsActions
  ) {
    applyAudio();
    this.root.visible = false;
    this.catcher.eventMode = "static";
    this.catcher.on("pointertap", () => this.close());
    this.root.addChild(this.catcher, this.panel);
    window.addEventListener("keydown", event => {
      if (event.key === "Escape" && this.root.visible) this.close();
    });
    document.addEventListener("fullscreenchange", () => this.root.visible && this.build());
    stage.screens.addChild(this.root);
    stage.onLayout(() => this.root.visible && this.build());
  }

  isOpen(): boolean {
    return this.root.visible;
  }

  toggle(): void {
    if (this.root.visible) this.close();
    else this.open();
  }

  open(): void {
    this.root.visible = true;
    this.root.parent?.addChild(this.root);
    this.build();
  }

  close(): void {
    this.root.visible = false;
    for (const child of this.panel.removeChildren()) child.destroy({ children: true });
  }

  private build(): void {
    for (const child of this.panel.removeChildren()) child.destroy({ children: true });
    const v = this.stage.visible();
    this.catcher.clear().rect(v.x, v.y, v.width, v.height).fill({ color: 0x000000, alpha: 0.001 });
    const x = v.x + v.width - 10 - W;
    const y = v.y + TOOLBAR_H + 8;
    const controlW = W - 2 * PAD - LABEL_W - 8;

    const toggleButton = (key: string, onKey: string, offKey: string, apply: (on: boolean) => void): Button[] => {
      const on = store.read(key, "on") !== "off";
      const button = new Button(this.stage, {
        label: t(on ? onKey : offKey),
        style: "plate",
        font: FONT_BASE,
        // Acceso: in inchiostro pieno (#sound-toggle[aria-pressed="true"]); spento: muto e smorzato.
        color: on ? INK : MUTED,
        w: controlW,
        h: ROW_H,
        onTap: () => {
          store.write(key, on ? "off" : "on");
          apply(!on);
          this.build();
        },
      });
      // Spento: smorzato (#sound-toggle.is-off).
      if (!on) button.alpha = 0.7;
      return [button];
    };
    const isFullscreen = Boolean(document.fullscreenElement);
    const languages = (["it", "en"] as const).map(
      locale =>
        new Button(this.stage, {
          label: locale.toUpperCase(),
          style: "plate",
          font: lang() === locale ? { ...FONT_BASE, weight: 700 } : FONT_BASE,
          color: lang() === locale ? INK : MUTED,
          w: 60,
          h: ROW_H,
          onTap: () => {
            if (lang() !== locale) this.actions.language(locale);
          },
        })
    );
    const lines: [string, Button[]][] = [
      [t("html.net"), [new Button(this.stage, { label: t("html.sync"), style: "plate", font: FONT_BASE, w: controlW, h: ROW_H, onTap: () => this.actions.resync() })]],
      [t("html.sound"), toggleButton("sound", "html.sound.on", "html.sound.off", setSoundEnabled)],
      [t("html.music"), toggleButton("music", "html.music.on", "html.music.off", setMusicEnabled)],
      [
        t("html.screen"),
        [
          new Button(this.stage, {
            label: t(isFullscreen ? "html.fullscreen.on" : "html.fullscreen.off"),
            style: "plate",
            font: FONT_BASE,
            color: isFullscreen ? INK : MUTED,
            w: controlW,
            h: ROW_H,
            onTap: () => {
              const run = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
              void run.catch(() => undefined);
            },
          }),
        ],
      ],
      [t("html.lang"), languages],
    ];
    // Sul desktop (desktop/preload.cjs) il gioco si chiude da qui, come ogni gioco di Steam.
    const desktop = window.rubyfront;
    if (desktop?.desktop) lines.push([t("html.game"), [new Button(this.stage, { label: t("html.quit"), style: "plate", font: FONT_BASE, w: controlW, h: ROW_H, onTap: () => desktop.leave() })]]);
    const h = 2 * PAD + lines.length * ROW_H + (lines.length - 1) * ROW_GAP;
    const shadow = slabShadow([{ x: 0, y: 18, blur: 44, color: "rgba(0,0,0,.6)" }], SHADOW_M);
    placeShadow(shadow, SHADOW_M, x, y, W, h);
    const slab = new Graphics().rect(x, y, W, h).fill(hex(PANEL)).stroke({ color: hex(LINE), width: 1, alignment: 1 });
    // Il pannello si prende i suoi click: solo fuori si chiude.
    slab.eventMode = "static";
    this.panel.addChild(shadow, slab);
    lines.forEach(([label, buttons], index) => {
      const ry = y + PAD + index * (ROW_H + ROW_GAP);
      const written = paintText(this.stage, label, LABEL, MUTED, { maxW: LABEL_W });
      written.sprite.position.set(x + PAD, ry + (ROW_H - written.h) / 2);
      this.panel.addChild(written.sprite);
      let cx = x + PAD + LABEL_W + 8;
      for (const button of buttons) {
        button.position.set(cx, ry);
        cx += button.w + 6;
        this.panel.addChild(button);
      }
    });
  }
}
