// L'ingrandimento al passaggio (simulatore/src/preview.ts, «intoccabile»):
// sul tavolo le carte sono piccole; per leggerle ci si passa sopra e compare
// la stessa carta a grandezza piena, 520×728 — ridotta solo se supererebbe
// l'80% dell'altezza della finestra o metà della sua larghezza. Si affianca
// alla carta dal lato dove c'è spazio e resta dentro la finestra: serve a
// leggere, non a coprire il tavolo. È inerte (il mouse le passa attraverso),
// compare dopo un attimo (130 ms) e sparisce al primo pointerdown — così quel
// click è già l'inizio del trascinamento, e finché il tasto è giù non si
// riapre sulle carte che il dito incontra — e alla rotella. Una carta la cui
// anteprima è stata chiusa col pointerdown non la riapre finché il mouse non
// ne esce.

import { faceTexture } from "../card/cache";
import { CARD_H, CARD_W } from "../card/theme";
import type { Stage } from "../stage";
import { CrispSprite } from "./appearance";

/**
 * Da dove vengono le carte da ingrandire: il tavolo (tavolo.ts) o la vista
 * dei mazzi (screens/decks.ts) — il passaggio, la faccia, il riquadro sullo schermo.
 */
export interface PreviewSource {
  onCard(listener: (cardEvent: { type: string; uid: string }) => void): void;
  cardInfo(uid: string): { cardId: string; face: number; back: boolean } | undefined;
  screenBox(uid: string): { x: number; y: number; width: number; height: number } | undefined;
}

const OPEN_DELAY = 130;
const MARGIN = 12;

export class Preview {
  private readonly sprite = new CrispSprite();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private suppressed: string | null = null;
  private shown: string | null = null;
  private request = 0;
  /** Un tasto è giù: la pressione è già l'inizio di un trascinamento, e l'anteprima non si apre sulle carte che il dito incontra. */
  private pressed = false;

  constructor(
    private readonly stage: Stage,
    private readonly source: PreviewSource,
    private readonly locale: string
  ) {
    this.sprite.eventMode = "none";
    this.sprite.visible = false;
    this.sprite.label = "preview";
    stage.app.stage.addChild(this.sprite);
    source.onCard(cardEvent => {
      if (cardEvent.type === "over") this.arm(cardEvent.uid);
      else if (cardEvent.type === "out") this.disarm();
      else if (cardEvent.type === "grab") this.hide(true);
    });
    stage.app.canvas.addEventListener("wheel", () => this.hide(false), { passive: true });
    window.addEventListener("pointerdown", () => (this.pressed = true), true);
    window.addEventListener("pointerup", () => (this.pressed = false), true);
    window.addEventListener("pointercancel", () => (this.pressed = false), true);
  }

  private arm(uid: string): void {
    if (this.suppressed === uid || this.pressed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.show(uid), OPEN_DELAY);
  }

  private disarm(): void {
    clearTimeout(this.timer);
    this.suppressed = null;
    this.sprite.visible = false;
    this.shown = null;
    this.request += 1;
  }

  private hide(suppress: boolean): void {
    clearTimeout(this.timer);
    if (suppress && this.shown) this.suppressed = this.shown;
    this.sprite.visible = false;
    this.shown = null;
    this.request += 1;
  }

  private async show(uid: string): Promise<void> {
    const info = this.source.cardInfo(uid);
    // Una carta coperta non si legge; una carta sparita nel frattempo nemmeno.
    if (!info || info.back) return;
    const screen = this.stage.app.screen;
    // La misura si decide sullo schermo, come nel simulatore.
    const zoom = Math.min(1, (screen.height * 0.8) / CARD_H, (screen.width * 0.5) / CARD_W);
    const width = CARD_W * zoom;
    const height = CARD_H * zoom;
    const ticket = ++this.request;
    const texture = await faceTexture(info.cardId, info.face, this.locale, zoom * this.stage.app.renderer.resolution);
    if (!texture || ticket !== this.request) return;
    // Il riquadro della carta sullo schermo, senza la sua ombra.
    const bounds = this.source.screenBox(uid);
    if (!bounds) return;
    const spaceRight = screen.width - (bounds.x + bounds.width);
    const left = spaceRight >= width + MARGIN * 2 ? bounds.x + bounds.width + MARGIN : Math.max(MARGIN, bounds.x - width - MARGIN);
    const top = Math.min(Math.max(MARGIN, bounds.y + bounds.height / 2 - height / 2), Math.max(MARGIN, screen.height - height - MARGIN));
    this.sprite.texture = texture;
    this.sprite.width = width;
    this.sprite.height = height;
    this.sprite.position.set(Math.round(left), Math.round(top));
    this.sprite.parent?.addChild(this.sprite);
    this.sprite.visible = true;
    this.shown = uid;
  }
}
