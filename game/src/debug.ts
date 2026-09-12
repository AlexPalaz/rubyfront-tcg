// Gli occhi per chi controlla il gioco da fuori (Playwright, il QC degli
// screenshot): il canvas non ha un DOM da leggere, quindi la scena si
// descrive da qui — `window.__rubyfront.dump()` dà l'albero con etichette e
// riquadri in unità di progetto. Con `?debug` nell'indirizzo si vedono
// anche l'area sicura 1920×1080 e i fotogrammi al secondo.

import { Container, Graphics, Text } from "pixi.js";
import { DESIGN_H, DESIGN_W, type Stage } from "./stage.js";

export interface SceneNode {
  label: string;
  type: string;
  visible: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  text?: string;
  children?: SceneNode[];
}

function describe(node: Container, stage: Stage): SceneNode {
  const box = node.getBounds();
  const { scale } = stage.visible();
  const origin = stage.world.position;
  const described: SceneNode = {
    label: node.label,
    // Il bundle prefissa i nomi delle classi (`_Container`): si tolgono.
    type: node.constructor.name.replace(/^_+/, ""),
    visible: node.visible,
    bounds: {
      x: Math.round((box.x - origin.x) / scale),
      y: Math.round((box.y - origin.y) / scale),
      width: Math.round(box.width / scale),
      height: Math.round(box.height / scale),
    },
  };
  if (node instanceof Text) described.text = node.text;
  const children = node.children.filter(child => child.label !== "debug");
  if (children.length) described.children = children.map(child => describe(child, stage));
  return described;
}

declare global {
  interface Window {
    /** Il ponte del desktop (desktop/preload.cjs): c'è solo nella finestra di Electron. */
    rubyfront?: { desktop: boolean; leave(): void };
    __rubyfront?: {
      stage: Stage;
      dump(): SceneNode;
      /** La partita di prova del tavolo (?table=sample): le sue azioni, per il confronto col simulatore. */
      actions?: unknown[];
      /** Il tavolo di prova è disegnato. */
      tableReady?: boolean;
      /** La partita in corso (?match=bot): sessione e tavolo, per le prove da console. */
      match?: unknown;
      /** La resa sul tavolo di prova (?table=sample&resolution): un volo col taglio, una parata, un colpo. */
      resolution?: { fly(): void };
      /** Le schermate del gioco (F6): home, accoglienza, mazzi, header, chat, impostazioni. */
      screens?: unknown;
      /** Solo in sviluppo: i gesti per le prove da fuori (main.ts, createTestHooks). */
      testHooks?: { play(): Promise<string | null>; attack(uids: string[]): Promise<number>; autopilot(): void };
      /** L'albero delle schermate, come dump() per il mondo. */
      dumpScreens(): SceneNode;
      /** Tutta la scena: mondo, schermate e ciò che sta sopra (sigillo, domanda, sipario, anteprime). */
      dumpAll(): SceneNode;
    };
  }
}

export function mountDebug(stage: Stage): void {
  window.__rubyfront = { stage, dump: () => describe(stage.world, stage), dumpScreens: () => describe(stage.screens, stage), dumpAll: () => describe(stage.app.stage, stage) };
  if (!new URLSearchParams(location.search).has("debug")) return;

  const layer = new Container({ label: "debug" });
  const frame = new Graphics().rect(0, 0, DESIGN_W, DESIGN_H).stroke({ width: 2, color: 0x3ec6ff, alpha: 0.7 });
  const readout = new Text({
    text: "",
    style: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 18, fill: 0x3ec6ff },
  });
  layer.addChild(frame, readout);
  stage.world.addChild(layer);

  const kind = stage.app.renderer.name;
  stage.onLayout(visible => {
    readout.position.set(Math.max(visible.x, 0) + 16, Math.max(visible.y, 0) + 16);
    readout.resolution = stage.app.renderer.resolution * visible.scale;
  });
  stage.app.ticker.add(() => {
    const visible = stage.visible();
    readout.text = `${kind} · ${Math.round(stage.app.ticker.FPS)} fps · ` +
      `${Math.round(visible.width)}×${Math.round(visible.height)} @ ${visible.scale.toFixed(3)}`;
  });
}
