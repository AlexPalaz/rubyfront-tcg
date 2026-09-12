// La camera del tavolo (animazioni, 2026-09-12): lo scossone a «trauma» —
// ogni colpo ne aggiunge, si spegne da sé, lo spostamento va col quadrato
// del trauma su un rumore liscio (niente tremolio da lavatrice) — e il lampo
// a tutto schermo. Si scuote solo il mondo (il tavolo): header e schermate
// restano ferme. Chi chiede meno movimento non ha scossoni né lampi forti.

import { Graphics, type Ticker } from "pixi.js";
import type { Stage } from "../stage";
import { reducedMotion } from "../table/animation";

/** Lo spostamento massimo, in unità di progetto, a trauma pieno. */
const MAX_OFFSET = 22;
/** Quanto trauma si perde al secondo. */
const RECOVERY = 1.5;

export class Camera {
  private trauma = 0;
  private time = 0;
  private readonly flashLayer = new Graphics();
  private flashStrength = 0;
  private flashDuration = 1;
  private flashAge = 0;

  constructor(private readonly stage: Stage) {
    this.flashLayer.eventMode = "none";
    this.flashLayer.visible = false;
    this.flashLayer.label = "flash";
    stage.app.stage.addChild(this.flashLayer);
    stage.app.ticker.add(this.step, this);
  }

  /** Aggiunge trauma (0..1): 0,25 un colpo, 0,5 un Rubyfront colpito, 0,8 una fine. */
  shake(amount: number): void {
    if (reducedMotion()) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Il lampo a tutto schermo, del colore dato. */
  flash(color = 0xffffff, strength = 0.5, ms = 260): void {
    const screen = this.stage.app.screen;
    this.flashLayer.clear().rect(0, 0, screen.width, screen.height).fill(color);
    this.flashLayer.parent?.addChild(this.flashLayer);
    this.flashStrength = reducedMotion() ? strength * 0.3 : strength;
    this.flashDuration = ms;
    this.flashAge = 0;
    this.flashLayer.visible = true;
  }

  private step(ticker: Ticker): void {
    const dt = ticker.deltaMS / 1000;
    this.time += dt;
    const world = this.stage.world;
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * RECOVERY);
      const strength = this.trauma * this.trauma * MAX_OFFSET;
      const t = this.time * 28;
      // Rumore liscio: somma di seni a frequenze non multiple.
      const nx = Math.sin(t * 1.0) * 0.6 + Math.sin(t * 2.31 + 1.3) * 0.3 + Math.sin(t * 4.7 + 2.1) * 0.1;
      const ny = Math.sin(t * 1.17 + 4.2) * 0.6 + Math.sin(t * 2.83 + 0.4) * 0.3 + Math.sin(t * 5.3 + 3.3) * 0.1;
      world.pivot.set(nx * strength, ny * strength);
    } else if (world.pivot.x !== 0 || world.pivot.y !== 0) {
      world.pivot.set(0, 0);
    }
    if (this.flashLayer.visible) {
      this.flashAge += ticker.deltaMS;
      const k = this.flashAge / this.flashDuration;
      if (k >= 1) this.flashLayer.visible = false;
      else this.flashLayer.alpha = this.flashStrength * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
    }
  }
}
