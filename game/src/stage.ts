// La scena: un mondo in unità di progetto, 1920×1080, scalato allo schermo.
//
// Tutto il gioco si disegna in quelle unità (deciso 2026-09-11). Il mondo si
// adatta per intero alla finestra e resta al centro; il lato che avanza non
// fa bande nere ma si vede — su uno schermo 16:10 (lo Steam Deck, 1280×800)
// il rettangolo visibile è più alto di 1080, e chi impagina ai bordi lo
// legge da `visible()`. Dentro 0..1920 × 0..1080 si è sempre al sicuro.
//
// Sopra il mondo (il tavolo e i suoi momenti) stanno le schermate (F6):
// l'header, la home, l'accoglienza, i mazzi, le impostazioni — stesse unità,
// stesso trasporto, ma in uno strato loro, così nessun momento del tavolo
// che si porta in cima (l'insegna, la scena) passa sopra la home.

import { Application, Container } from "pixi.js";

export const DESIGN_W = 1920;
export const DESIGN_H = 1080;

/** Il rettangolo visibile, in unità di progetto, e la scala del mondo. */
export interface Visible {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export interface Stage {
  app: Application;
  /** Il mondo: i figli si posano in unità di progetto. */
  world: Container;
  /** Le schermate, sopra il mondo, nelle stesse unità. */
  screens: Container;
  visible(): Visible;
  /** Chiamato subito e a ogni cambio della finestra. */
  onLayout(listener: (visible: Visible) => void): void;
  offLayout(listener: (visible: Visible) => void): void;
}

export async function createStage(host: HTMLElement): Promise<Stage> {
  const app = new Application();
  await app.init({
    preference: "webgl",
    resizeTo: window,
    // Oltre 2 la differenza non si vede e la scheda video paga il quadruplo.
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    antialias: true,
    background: "#131013",
  });
  host.append(app.canvas);

  const world = new Container({ label: "world" });
  const screens = new Container({ label: "screens" });
  app.stage.addChild(world, screens);

  const listeners: ((visible: Visible) => void)[] = [];
  let current: Visible = { x: 0, y: 0, width: DESIGN_W, height: DESIGN_H, scale: 1 };

  function layout(): void {
    const { width, height } = app.screen;
    const scale = Math.min(width / DESIGN_W, height / DESIGN_H);
    const offsetX = (width - DESIGN_W * scale) / 2;
    const offsetY = (height - DESIGN_H * scale) / 2;
    for (const layer of [world, screens]) {
      layer.scale.set(scale);
      layer.position.set(offsetX, offsetY);
    }
    current = { x: -offsetX / scale, y: -offsetY / scale, width: width / scale, height: height / scale, scale };
    for (const listener of [...listeners]) listener(current);
  }

  app.renderer.on("resize", layout);
  layout();

  return {
    app,
    world,
    screens,
    visible: () => current,
    onLayout(listener) {
      listeners.push(listener);
      listener(current);
    },
    offLayout(listener) {
      const at = listeners.indexOf(listener);
      if (at >= 0) listeners.splice(at, 1);
    },
  };
}
