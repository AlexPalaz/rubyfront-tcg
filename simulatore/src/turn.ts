// Le fasi e il fine turno, una routine sola per pannello e HUD. Ciò che il
// cambio di turno porta con sé — Flusso nuovo, stappata, frecce sgomberate —
// sta nel riduttore (state.ts, `turn`): qui si dichiara e si racconta.

import { describeBattle, resolveWave } from "./combat.js";
import type { Ctx } from "./ctx.js";
import { seatLabel, waveDeclared } from "./state.js";
import { otherSeat } from "./types.js";

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
  if (state.phase === "reazione" && waveDeclared(state) && !(await resolveCombat(ctx))) return;
  return endTurn(ctx);
}

/**
 * «Conclusa la Reazione, le battaglie si risolvono una alla volta,
 * nell'ordine di dichiarazione degli attaccanti» (§6.4). L'esito lo calcola
 * il client (combat.ts) e lo manda in un'azione sola, che l'engine verifica
 * contro il suo calcolo: se non torna, il tavolo resta com'è e il turno non
 * si chiude. Senza le Potenze nel catalogo si torna alla risoluzione a mano:
 * si annota e si chiude il turno come prima. Dice se si può proseguire.
 */
export async function resolveCombat(ctx: Ctx): Promise<boolean> {
  const state = ctx.state();
  const battles = resolveWave(state, state.active, ctx.card);
  if (battles === null) {
    ctx.log("Risoluzione a mano: a qualche carta manca la Potenza nel catalogo.", state.active);
    return true;
  }
  if (!(await ctx.dispatch({ t: "resolve", seat: state.active, battles }))) return false;
  const name = (uid: string): string => {
    const card = state.cards[uid];
    return card ? `«${ctx.card(card.cardId).name}»` : uid;
  };
  battles.forEach((battle, index) => ctx.log(describeBattle(battle, index + 1, name), state.active));
  const foe = otherSeat(state.active);
  const damage = battles.reduce((sum, battle) => sum + battle.damage, 0);
  if (damage > 0) {
    ctx.log(`${seatLabel(ctx.state(), foe)} subisce ${damage} danni (PV ${ctx.state().players[foe].hp}).`, foe);
  }
  return true;
}

export async function endTurn(ctx: Ctx): Promise<void> {
  const state = ctx.state();
  const next = otherSeat(state.active);
  // Il cambio di turno passa dal giudizio dell'engine (§6.5: mano massima 7
  // alla chiusura): fermato, non succede nulla. Passato, il riduttore ha già
  // apparecchiato il turno di chi entra (Flusso, stappata, frecce).
  if (!(await ctx.dispatch({ t: "turn", turn: state.turn + 1, active: next }))) return;
  const player = ctx.state().players[next];
  ctx.log(`Turno ${state.turn + 1} — tocca a ${seatLabel(ctx.state(), next)} (Flusso ${player.flux}/${player.fluxMax}).`, next);
}
