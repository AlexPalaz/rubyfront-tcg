// Fine turno: la routine di §3.2, una sola per pannello e HUD.
//
// Chi entra si trova il Flusso massimo cresciuto di 1 (mai oltre 20) e il
// disponibile ricaricato fin lì. È una scorciatoia, non una regola dura: ogni
// suo effetto si può disfare a mano dai contatori.

import type { Ctx } from "./ctx.js";
import { seatLabel, waveDeclared } from "./state.js";
import { otherSeat } from "./types.js";

const FLUX_CAP = 20;

/**
 * Dichiara l'ingresso in Fase di Fronte (§6.3). A senso unico: dal Fronte
 * si va solo avanti (alla Reazione, o al cambio di turno che riporta in
 * Preparazione) — non esiste tornare indietro, nemmeno a engine spento. La
 * fase resta facoltativa: chiudere il turno dalla Preparazione è legale.
 */
export async function declareFront(ctx: Ctx): Promise<void> {
  const state = ctx.state();
  if (state.phase !== "preparazione") return;
  if (!(await ctx.dispatch({ t: "phase", phase: "fronte" }))) return;
  ctx.log(`${seatLabel(ctx.state(), state.active)} dichiara la Fase di Fronte.`, state.active);
}

/**
 * L'ondata è completa: la parola passa al difensore — Fase di Reazione
 * (§6.4). Da lì niente nuovi attacchi; blocchi e contrattacchi vivono lì,
 * e il turno può chiudersi quando la difesa ha avuto la sua finestra.
 */
export async function declareReaction(ctx: Ctx): Promise<void> {
  const state = ctx.state();
  if (state.phase !== "fronte") return;
  if (!(await ctx.dispatch({ t: "phase", phase: "reazione" }))) return;
  ctx.log(`${seatLabel(ctx.state(), state.active)} passa al difensore: Fase di Reazione.`, state.active);
}

/**
 * «Fine fase» — il gesto unico dell'HUD con l'arbitro al tavolo: le fasi si
 * chiudono una alla volta, sempre in avanti, e l'ultima chiude il turno.
 * Preparazione → Fronte; Fronte con un'ondata in piedi → Reazione, senza
 * ondata → Fine turno (§6.3: «se invece il giocatore passa, la Reazione non
 * c'è e si va al Fine del turno»); Reazione → Fine turno. Ogni passo resta
 * la routine di prima, giudizio dell'engine compreso.
 */
export async function endPhase(ctx: Ctx): Promise<void> {
  const state = ctx.state();
  if (state.phase === "preparazione") return declareFront(ctx);
  if (state.phase === "fronte" && waveDeclared(state)) return declareReaction(ctx);
  return endTurn(ctx);
}

export async function endTurn(ctx: Ctx): Promise<void> {
  const state = ctx.state();
  const next = otherSeat(state.active);
  // Il cambio di turno passa per primo dal giudizio dell'engine (§6.5: mano
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
