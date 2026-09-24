// Le impostazioni: un cassetto sotto
// l'ingranaggio, una riga per preferenza — Rete (riallinea dal tavolo),
// Suoni, Musica, Schermo (intero: nuovo nel gioco, per il desktop e lo
// Steam Deck), Lingua. Niente microfono, vista o tema da scegliere: il
// gioco ha un tavolo solo e un tema solo. Si chiude con un click fuori o
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
import { TOOLBAR_H, FONT_BASE, INK, LINE, MUTED, PANEL, Button, TextField, hex, slabShadow, placeShadow, paintText } from "./ui";

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
  /** L'utenza nella memoria del tavolo (2026-09-20): chi sono, l'uscita; senza account, «Accedi» apre la schermata d'accesso (2026-09-23). */
  account(): { name: string; username: string; providers: string[]; verified: boolean } | null;
  login(): void;
  /** Il nome pubblico nuovo (2026-09-22): si cambia da qui, non al tavolo. */
  setDisplayName(name: string): void;
  logout(): void;
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
    this.nameField?.dispose();
    this.nameField = null;
    for (const child of this.panel.removeChildren()) child.destroy({ children: true });
  }

  /** Il campo del nome pubblico, a account presente. */
  private nameField: TextField | null = null;

  private submitName(): void {
    const name = this.nameField?.value.trim() ?? "";
    if (!name) return;
    this.actions.setDisplayName(name);
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
    // L'utenza (2026-09-20): col nome e «Esci» se si è dentro; se no «Accedi», che apre la schermata d'accesso.
    const who = this.actions.account();
    const loginW = 90;
    let accountRow: Button[];
    this.nameField?.dispose();
    this.nameField = null;
    if (who) {
      const label = t("html.account.who", { name: who.name, username: who.username });
      accountRow = [
        new Button(this.stage, { label, style: "plate", font: FONT_BASE, w: controlW - 70 - 6, h: ROW_H, onTap: () => undefined }),
        new Button(this.stage, { label: t("html.account.logout"), style: "plate", font: FONT_BASE, color: MUTED, w: 70, h: ROW_H, onTap: () => this.actions.logout() }),
      ];
      this.nameField = new TextField(this.stage, { placeholder: t("html.account.public.ph"), maxLength: 24, onEnter: () => this.submitName() });
      this.nameField.value = who.name;
    } else {
      accountRow = [new Button(this.stage, { label: t("html.account.login"), style: "plate", font: FONT_BASE, w: controlW, h: ROW_H, onTap: () => this.actions.login() })];
    }
    const lines: [string, Button[]][] = [
      [t("html.account"), accountRow],
      ...(who ? [[t("html.account.public"), [new Button(this.stage, { label: t("html.account.save"), style: "plate", font: FONT_BASE, w: loginW, h: ROW_H, onTap: () => this.submitName() })]] as [string, Button[]]] : []),
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
      // Il campo del nome pubblico sta nella seconda riga, prima di «Salva» (la riga Account non ha più campi, 2026-09-23).
      const field = index === 1 ? this.nameField : null;
      if (field) {
        const fieldW = controlW - loginW - 6;
        field.place(cx, ry, fieldW, ROW_H);
        field.show(true);
        cx += fieldW + 6;
      }
      for (const button of buttons) {
        button.position.set(cx, ry);
        cx += button.w + 6;
        this.panel.addChild(button);
      }
    });
  }
}
