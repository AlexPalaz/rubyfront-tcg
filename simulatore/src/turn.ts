// Fine turno: la routine di §3.2, una sola per pannello e HUD.
//
// Chi entra si trova il Flusso massimo cresciuto di 1 (mai oltre 20) e il
// disponibile ricaricato fin lì. È una scorciatoia, non una regola dura: ogni
// suo effetto si può disfare a mano dai contatori.

import type { Ctx } from "./ctx.js";
import { seatLabel } from "./state.js";
import { otherSeat } from "./types.js";

const FLUX_CAP = 20;

export function endTurn(ctx: Ctx): void {
  const state = ctx.state();
  const next = otherSeat(state.active);
  const player = state.players[next];
  const grown = Math.min(FLUX_CAP, player.fluxMax + 1);
  ctx.dispatch({ t: "player", seat: next, patch: { fluxMax: grown, flux: grown } });
  ctx.dispatch({ t: "turn", turn: state.turn + 1, active: next });
  // Attacchi e blocchi valgono per il turno in cui sono dichiarati: chiuso
  // quello, il tavolo si sgombera dalle frecce.
  ctx.dispatch({ t: "clearCombat" });
  ctx.log(`Turno ${state.turn + 1} — tocca a ${seatLabel(ctx.state(), next)} (Flusso ${grown}/${grown}).`, next);
}
