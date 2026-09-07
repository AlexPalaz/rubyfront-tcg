// L'insegna di fase: a ogni cambio di fase (o di turno, che riporta in
// Preparazione) una scritta compare al centro del tavolo, resta un attimo e
// svanisce. Dice in che momento della partita si è — turno e fase — dove
// gli occhi stanno guardando: è l'unico posto in cui si legge il turno. Non
// si clicca, e con prefers-reduced-motion resta ferma. Finché è in vista il
// tavolo si FERMA per tutti (scelta del designer, 2026-09-07): il corpo porta
// `is-announcing`, che spegne il puntatore (style.css) e trattiene il bot
// (tableQuiet in main.ts) — nessuno gioca sotto la scritta.

import { t } from "./i18n.js";
import type { Ctx } from "./ctx.js";
import { seatLabel } from "./state.js";
import { describeGameOver } from "./turn.js";
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
  preparazione: "phase.title.preparazione",
  fronte: "phase.title.fronte",
  reazione: "phase.title.reazione",
};

/** Il rigo sotto: a chi tocca — in Reazione la parola è del difensore. Il
    turno sta nel titolo, grande: è lì che si legge (deciso 2026-09-06, al
    posto del contatore in header). */
function subtitle(state: GameState, me: Seat): string {
  const who = state.phase === "reazione" ? otherSeat(state.active) : state.active;
  const mine = who === me;
  const name = seatLabel(state, who, me);
  if (state.phase === "reazione") {
    return t(mine ? "banner.defends.you" : "banner.defends.them", { turn: state.turn, name });
  }
  return t(mine ? "banner.turn.you" : "banner.turn.them", { turn: state.turn, name });
}

export function mountPhaseBanner(root: HTMLElement, ctx: Ctx): PhaseBanner {
  const host = document.createElement("div");
  host.className = "phase-banner";
  host.hidden = true;
  host.setAttribute("aria-live", "polite");
  // Tre righe: il turno sopra, piccolo; il titolo della fase, grande; sotto
  // a chi tocca.
  const turn = document.createElement("span");
  turn.className = "phase-banner-turn";
  const title = document.createElement("span");
  title.className = "phase-banner-title";
  const sub = document.createElement("span");
  sub.className = "phase-banner-sub";
  host.append(turn, title, sub);
  root.append(host);

  // La chiave di ciò che si è già annunciato: la fase da sola non basta,
  // perché il cambio di turno riporta in Preparazione da una Preparazione.
  let seen: string | null = null;
  let timer: number | undefined;

  function show(state: GameState): void {
    turn.textContent = t("hud.turn", { turn: state.turn });
    turn.hidden = false;
    title.textContent = t(TITLES[state.phase]);
    sub.textContent = subtitle(state, ctx.seat());
    host.dataset.phase = state.phase;
    // Rilancio dell'animazione: si spegne, si forza il reflow, si riaccende.
    window.clearTimeout(timer);
    host.hidden = true;
    void host.offsetWidth;
    host.hidden = false;
    document.body.classList.add("is-announcing");
    timer = window.setTimeout(() => {
      host.hidden = true;
      document.body.classList.remove("is-announcing");
    }, PHASE_BANNER_MS);
  }

  const keyOf = (state: GameState): string => `${state.turn}|${state.active}|${state.phase}`;

  // L'insegna finale (§2, §9): resta, non svanisce — fino a Nuova partita.
  let finalShown = false;
  function showFinal(state: GameState): void {
    const { title: heading, detail } = describeGameOver(state, state.over!, ctx.seat());
    turn.hidden = true;
    title.textContent = heading;
    sub.textContent = detail;
    host.dataset.phase = state.over!.winner === ctx.seat() ? "fronte" : "reazione";
    window.clearTimeout(timer);
    document.body.classList.remove("is-announcing");
    host.classList.add("is-final");
    host.hidden = false;
  }

  return {
    render() {
      const state = ctx.state();
      if (state.over) {
        if (!finalShown) showFinal(state);
        finalShown = true;
        seen = keyOf(state);
        return;
      }
      if (finalShown) {
        finalShown = false;
        host.classList.remove("is-final");
        host.hidden = true;
      }
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
