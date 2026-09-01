// Fine turno: la routine di §3.2, una sola per pannello e HUD.
//
// Chi entra si trova il Flusso massimo cresciuto di 1 (mai oltre 20) e il
// disponibile ricaricato fin lì. È una scorciatoia, non una regola dura: ogni
// suo effetto si può disfare a mano dai contatori.

import type { Ctx } from "./ctx.js";
import { seatLabel } from "./state.js";
import { otherSeat } from "./types.js";

const FLUX_CAP = 20;

export async function endTurn(ctx: Ctx): Promise<void> {
  const state = ctx.state();
  const next = otherSeat(state.active);
  // Il cambio di turno passa per primo dal giudizio dell'engine (§6.4: mano
  // massima 7 alla chiusura): se il poliziotto lo ferma, il resto della
  // routine — Flusso nuovo, frecce sgomberate — non deve nemmeno partire.
  if (!(await ctx.dispatch({ t: "turn", turn: state.turn + 1, active: next }))) return;
  const player = state.players[next];
  const grown = Math.min(FLUX_CAP, player.fluxMax + 1);
  void ctx.dispatch({ t: "player", seat: next, patch: { fluxMax: grown, flux: grown } });
  // «Si stappa all'inizio del turno successivo del proprietario» (§6.3): le
  // Entità di chi entra si raddrizzano da sole. Indispensabile con l'arbitro
  // al tavolo (che nasconde Tappa/Stappa), comodo anche senza — e come tutto
  // il resto della routine, a engine spento si può disfare a mano. Limite
  // noto: la Stasi (§8.1, tappata permanente) non è ancora modellata.
  for (const card of Object.values(ctx.state().cards)) {
    if (card.owner === next && card.zone === "field" && card.tapped) {
      void ctx.dispatch({ t: "tap", uid: card.uid, tapped: false });
    }
  }
  // Attacchi e blocchi valgono per il turno in cui sono dichiarati: chiuso
  // quello, il tavolo si sgombera dalle frecce.
  void ctx.dispatch({ t: "clearCombat" });
  ctx.log(`Turno ${state.turn + 1} — tocca a ${seatLabel(ctx.state(), next)} (Flusso ${grown}/${grown}).`, next);
}
