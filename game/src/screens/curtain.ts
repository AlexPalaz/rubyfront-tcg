// Il sipario (main.ts del simulatore, curtainPass): il nero che cala su una
// schermata, resta giù mentre sotto si cambia scena, e si alza — dalla home
// alla partita col bot, e dalla partita alla home. Finché c'è, assorbe i click.

import { Graphics } from "pixi.js";
import type { Stage } from "../stage";
import { tween, ease } from "../table/animation";

const FALL_MS = 600;
const HOLD_MS = 2000;
const RISE_MS = 800;
/** A sipario alzato, un respiro prima di cominciare. */
const START_AFTER_MS = RISE_MS + 400;

export class Curtain {
  private readonly black = new Graphics();

  constructor(private readonly stage: Stage) {
    this.black.visible = false;
    this.black.eventMode = "static";
    stage.app.stage.addChild(this.black);
  }

  /** Cala, a nero fa `atBlack`, resta giù `hold` ms, si alza, e a sipario alzato più un respiro fa `afterRise`. */
  pass(run: { atBlack: () => void; afterRise?: () => void; hold?: number }): void {
    const screen = this.stage.app.screen;
    this.black.clear().rect(0, 0, screen.width, screen.height).fill(0x000000);
    this.black.alpha = 0;
    this.black.visible = true;
    this.black.parent?.addChild(this.black);
    const ticker = this.stage.app.ticker;
    void tween(ticker, FALL_MS, k => (this.black.alpha = k), ease).then(() => {
      run.atBlack();
      setTimeout(() => {
        if (run.afterRise) setTimeout(run.afterRise, START_AFTER_MS);
        void tween(ticker, RISE_MS, k => (this.black.alpha = 1 - k), ease).then(() => (this.black.visible = false));
      }, run.hold ?? HOLD_MS);
    });
  }
}
