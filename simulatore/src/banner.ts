// L'insegna di fase: a ogni cambio di fase (o di turno, che riporta in
// Preparazione) una scritta compare al centro del tavolo, resta un attimo e
// svanisce. Dice in che momento della partita si è — la stessa notizia del
// rigo nell'HUD, ma dove gli occhi stanno guardando. Solo un annuncio: non
// si clicca, non ferma nulla, e con prefers-reduced-motion resta ferma.

import type { Ctx } from "./ctx.js";
import { seatLabel } from "./state.js";
import type { GameState, Phase, Seat } from "./types.js";
import { otherSeat } from "./types.js";

export interface PhaseBanner {
  render(): void;
  /** Annuncia la fase com'è ORA, anche se non è cambiata: è l'apertura
      della partita — «Fase di Preparazione» prima ancora della mano. */
  announce(): void;
}

/** Quanto resta in vista, corsa d'ingresso e d'uscita comprese. */
export const PHASE_BANNER_MS = 1800;
/** Quando comincia a svanire (il 78% della corsa, come nei keyframes): chi
    vuole accodare un gesto all'insegna — la mano iniziale — parte da qui,
    così le carte entrano mentre la scritta si spegne. */
export const PHASE_BANNER_HOLD_MS = 1400;

const TITLES: Record<Phase, string> = {
  preparazione: "Fase di Preparazione",
  fronte: "Fase di Fronte",
  reazione: "Fase di Reazione",
};

/** Il rigo sotto: turno e a chi tocca — in Reazione la parola è del difensore. */
function subtitle(state: GameState, me: Seat): string {
  const who = state.phase === "reazione" ? otherSeat(state.active) : state.active;
  if (state.phase === "reazione") {
    return `Turno ${state.turn} · difende ${who === me ? "te" : seatLabel(state, who, me)}`;
  }
  return `Turno ${state.turn} · ${who === me ? "tocca a te" : seatLabel(state, who, me)}`;
}

export function mountPhaseBanner(root: HTMLElement, ctx: Ctx): PhaseBanner {
  const host = document.createElement("div");
  host.className = "phase-banner";
  host.hidden = true;
  host.setAttribute("aria-live", "polite");
  const title = document.createElement("span");
  title.className = "phase-banner-title";
  const sub = document.createElement("span");
  sub.className = "phase-banner-sub";
  host.append(title, sub);
  root.append(host);

  // La chiave di ciò che si è già annunciato: la fase da sola non basta,
  // perché il cambio di turno riporta in Preparazione da una Preparazione.
  let seen: string | null = null;
  let timer: number | undefined;

  function show(state: GameState): void {
    title.textContent = TITLES[state.phase];
    sub.textContent = subtitle(state, ctx.seat());
    host.dataset.phase = state.phase;
    // Rilancio dell'animazione: si spegne, si forza il reflow, si riaccende.
    window.clearTimeout(timer);
    host.hidden = true;
    void host.offsetWidth;
    host.hidden = false;
    timer = window.setTimeout(() => (host.hidden = true), PHASE_BANNER_MS);
  }

  const keyOf = (state: GameState): string => `${state.turn}|${state.active}|${state.phase}`;

  return {
    render() {
      const state = ctx.state();
      const key = keyOf(state);
      if (key === seen) return;
      const first = seen === null;
      seen = key;
      // Al primo disegno non c'è niente da annunciare: si prende nota e basta.
      if (!first) show(state);
    },
    announce() {
      const state = ctx.state();
      seen = keyOf(state);
      show(state);
    },
  };
}
