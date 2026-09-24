// La schermata d'accesso (2026-09-22): prima della home, finché non c'è un
// account. Due linguette — Accedi, Registrati — sulla stessa lastra
// dell'accoglienza, i campi come <input> sopra il canvas, il bottone di
// Google quando il sito ha un client id (solo sul web: Electron non è un
// browser per Google). Le regole dei campi le dice il tavolo, coi suoi
// rifiuti in due lingue; qui si mostra il motivo e basta.

import { t } from "@rubyfront/core/i18n";
import { Container, Graphics } from "pixi.js";
import type { Font } from "../card/text";
import type { Stage } from "../stage";
import { TOOLBAR_H, TextField, ACTION_EDGE, ACTION_LABEL, FONT_BASE, INK, MUTED, Button, hex, slabShadow, placeShadow, paintText } from "./ui";
import { SANS } from "../table/appearance";

const W = 440;
const PAD_X = 32;
const PAD_TOP = 28;
const PAD_BOTTOM = 28;
const INNER = W - 2 * PAD_X;
const FIELD_H = 44;
const GAP = 10;
const SHADOW_M = 90;
const TAB: Font = { size: 15, weight: 700, family: SANS, spacing: 15 * 0.12, upper: true };
const TITLE: Font = { size: 18, weight: 700, family: SANS, spacing: 18 * 0.2, upper: true };
const SMALL: Font = { size: 14, weight: 400, family: SANS };

export interface AuthActions {
  login(login: string, password: string): void;
  register(username: string, email: string, password: string, name: string): void;
  google(idToken: string): void;
}

type Tab = "login" | "register";

export class Auth {
  readonly root = new Container({ label: "auth" });
  private readonly veil = new Graphics();
  private readonly card = new Container({ label: "auth-card" });
  private tab: Tab = "login";
  private status: "idle" | "waiting" | "offline" = "idle";
  private error = "";
  private readonly fields: Record<string, TextField> = {};
  private googleReady = false;

  constructor(
    private readonly stage: Stage,
    private readonly actions: AuthActions,
    private readonly googleClientId: string
  ) {
    this.root.visible = false;
    this.veil.eventMode = "static";
    this.root.addChild(this.veil, this.card);
    stage.screens.addChild(this.root);
    stage.onLayout(() => this.root.visible && this.build());
    const make = (key: string, placeholder: string, password = false, maxLength = 80): void => {
      this.fields[key] = new TextField(stage, { placeholder, maxLength, password, onEnter: () => this.submit() });
    };
    make("login", t("auth.login.ph"));
    make("password", t("auth.password.ph"), true);
    make("username", t("auth.username.ph"), false, 20);
    make("email", t("auth.email.ph"));
    make("newPassword", t("auth.password.ph"), true);
    make("name", t("auth.name.ph"), false, 24);
  }

  isOpen(): boolean {
    return this.root.visible;
  }

  /** Si apre: in attesa se una sessione salvata sta rientrando, se no coi campi. */
  open(waiting: boolean): void {
    this.status = waiting ? "waiting" : "idle";
    this.error = "";
    this.root.visible = true;
    this.root.parent?.addChild(this.root);
    this.build();
  }

  close(): void {
    if (!this.root.visible) return;
    this.root.visible = false;
    for (const field of Object.values(this.fields)) field.show(false);
    this.clear();
  }

  /** Un rifiuto del tavolo: il motivo sotto i campi, e si riprova. */
  refused(reason: string): void {
    this.status = "idle";
    this.error = reason;
    if (this.root.visible) this.build();
  }

  /** Il filo col tavolo è caduto o tornato. */
  offline(isOffline: boolean): void {
    if (isOffline) this.status = "offline";
    else if (this.status === "offline") this.status = "idle";
    if (this.root.visible) this.build();
  }

  private submit(): void {
    if (this.status !== "idle") return;
    const v = (key: string): string => this.fields[key]!.value.trim();
    if (this.tab === "login") {
      if (!v("login") || !this.fields.password!.value) return;
      this.status = "waiting";
      this.actions.login(v("login"), this.fields.password!.value);
    } else {
      if (!v("username") || !v("email") || !this.fields.newPassword!.value) return;
      this.status = "waiting";
      this.actions.register(v("username"), v("email"), this.fields.newPassword!.value, v("name") || v("username"));
    }
    this.error = "";
    this.build();
  }

  private clear(): void {
    for (const child of this.card.removeChildren()) child.destroy({ children: true });
  }

  private build(): void {
    this.clear();
    const v = this.stage.visible();
    this.veil.clear().rect(v.x, v.y, v.width, v.height).fill({ color: 0x000000, alpha: 0.55 });
    const add = (node: Container, x: number, y: number): void => {
      node.position.set(x, y);
      this.card.addChild(node);
    };
    let y = PAD_TOP;
    const title = paintText(this.stage, t("auth.title"), TITLE, INK, { maxW: INNER, align: "center" });
    add(title.sprite, (W - title.w) / 2, y);
    y += title.h + 6;
    const note = paintText(this.stage, t("auth.note"), SMALL, MUTED, { maxW: INNER, align: "center", lineHeight: 20 });
    add(note.sprite, (W - note.w) / 2, y);
    y += note.h + 14;
    add(new Graphics().rect(0, 0, INNER, 1).fill(0x29222a), PAD_X, y);
    y += 1 + 14;

    const waiting = this.status !== "idle";
    const visibleFields: [string, number][] = [];
    if (waiting) {
      const line = paintText(this.stage, t(this.status === "offline" ? "auth.offline" : "auth.resuming"), FONT_BASE, INK, { maxW: INNER, align: "center" });
      line.sprite.alpha = 0.85;
      add(line.sprite, (W - line.w) / 2, y);
      y += line.h + 8;
    } else {
      // Le due linguette.
      const half = (INNER - GAP) / 2;
      (["login", "register"] as Tab[]).forEach((tab, i) => {
        const active = tab === this.tab;
        add(
          new Button(this.stage, {
            label: t(tab === "login" ? "auth.tab.login" : "auth.tab.register"),
            style: "plate",
            font: TAB,
            color: active ? INK : MUTED,
            edge: active ? ACTION_EDGE : undefined,
            w: half,
            h: 40,
            onTap: () => {
              if (this.tab !== tab) {
                this.tab = tab;
                this.error = "";
                this.build();
              }
            },
          }),
          PAD_X + i * (half + GAP),
          y
        );
      });
      y += 40 + 16;
      const keys = this.tab === "login" ? ["login", "password"] : ["username", "email", "newPassword", "name"];
      for (const key of keys) {
        visibleFields.push([key, y]);
        y += FIELD_H + GAP;
      }
      if (this.error) {
        const err = paintText(this.stage, this.error, SMALL, "#e56a86", { maxW: INNER, lineHeight: 18 });
        add(err.sprite, PAD_X, y);
        y += err.h + GAP;
      }
      y += 4;
      add(new Button(this.stage, { label: t(this.tab === "login" ? "auth.go.login" : "auth.go.register"), style: "metal", w: INNER, h: 48, onTap: () => this.submit() }), PAD_X, y);
      y += 48;
      if (this.googleClientId && !window.rubyfront?.desktop) {
        y += 12;
        const or = paintText(this.stage, t("auth.or"), SMALL, MUTED, { maxW: INNER, align: "center" });
        add(or.sprite, (W - or.w) / 2, y);
        y += or.h + 10;
        add(new Button(this.stage, { label: t("auth.google"), style: "plate", edge: ACTION_EDGE, color: ACTION_LABEL, w: INNER, h: 44, onTap: () => this.google() }), PAD_X, y);
        y += 44;
      }
    }
    y += PAD_BOTTOM;
    const h = y;
    const cx = v.x + (v.width - W) / 2;
    const cy = Math.max(v.y + TOOLBAR_H + 12, v.y + (v.height - h) / 2);
    this.card.position.set(cx, cy);
    const shadow = slabShadow([{ x: 0, y: 30, blur: 80, color: "rgba(0,0,0,.6)" }], SHADOW_M);
    placeShadow(shadow, SHADOW_M, 0, 0, W, h);
    const slab = new Graphics().rect(0, 0, W, h).fill({ color: 0x0b090c, alpha: 0.98 }).stroke({ color: 0x29222a, width: 1, alignment: 1 });
    slab.eventMode = "static";
    this.card.addChildAt(slab, 0);
    this.card.addChildAt(shadow, 0);
    const shown = new Set(visibleFields.map(([key]) => key));
    for (const [key, field] of Object.entries(this.fields)) {
      const at = visibleFields.find(([k]) => k === key);
      if (at) field.place(cx + PAD_X, cy + at[1], INNER, FIELD_H);
      field.show(shown.has(key));
    }
    if (visibleFields.length > 0 && !this.error) this.fields[visibleFields[0]![0]]!.focus();
    void hex;
  }

  /** «Continua con Google»: il bottone di Google (GIS) dà il biglietto, che va al tavolo. */
  private google(): void {
    const id = this.googleClientId;
    const start = (): void => {
      const gis = (window as unknown as { google?: { accounts: { id: { initialize(o: unknown): void; prompt(): void } } } }).google;
      if (!gis) return;
      gis.accounts.id.initialize({
        client_id: id,
        callback: (response: { credential?: string }) => {
          if (response.credential) {
            this.status = "waiting";
            this.build();
            this.actions.google(response.credential);
          }
        },
      });
      gis.accounts.id.prompt();
    };
    if (this.googleReady) return start();
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      this.googleReady = true;
      start();
    };
    document.head.append(script);
  }
}
