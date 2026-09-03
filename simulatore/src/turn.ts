// Le fasi e il fine turno, una routine sola per pannello e HUD. Ciò che il
// cambio di turno porta con sé — Flusso nuovo, stappata, frecce sgomberate —
// sta nel riduttore (state.ts, `turn`): qui si dichiara e si racconta.

import { msg, t, type LogMsg } from "./i18n.js";
import { describeBattle, resolveWave } from "./combat.js";
import { releaseControlled } from "./effects.js";
import type { Ctx } from "./ctx.js";
import { freeFrontSlotOrNull, seatLabel, waveDeclared, zoneCards } from "./state.js";
import type { GameOver, GameState, Seat } from "./types.js";
import { otherSeat } from "./types.js";

/**
 * La fine per PV (§2): a zero i PV del Rubyfront avversario, si vince;
 * entrambi a zero nello stesso momento, è patta (§9.2). `null` finché si
 * gioca. Si guarda dopo ogni azione applicata in locale (main.ts, commit).
 */
export function verdictByHp(state: GameState): GameOver | null {
  if (state.over) return null;
  const aDown = state.players.a.hp <= 0;
  const bDown = state.players.b.hp <= 0;
  if (aDown && bDown) return { winner: null, reason: "draw" };
  if (aDown) return { winner: "b", reason: "hp" };
  if (bDown) return { winner: "a", reason: "hp" };
  return null;
}

/**
 * La fine per esaurimento del mazzo (§9.1), che si decide al cambio di
 * turno: chi ha pescato l'ultima carta nel PROPRIO turno «gioca quel turno
 * per intero e al termine del turno ha perso»; chi l'ha pescata nel turno
 * altrui «ha perso direttamente quando inizierebbe il suo turno
 * successivo». Guardando i mazzi al confine dei turni, i due casi sono:
 * chi chiude a mazzo vuoto perde; se no, chi entrerebbe a mazzo vuoto
 * perde. Un posto senza nessuna carta non ha un mazzo esaurito: non ha
 * ancora un mazzo (il tavolo prima del carico, l'avversario che non c'è).
 * `null` se nessuno dei due.
 */
export function loserByDeck(state: GameState): Seat | null {
  const exhausted = (seat: Seat): boolean =>
    Object.values(state.cards).some(card => card.owner === seat) && zoneCards(state, seat, "deck").length === 0;
  const next = otherSeat(state.active);
  if (exhausted(state.active)) return state.active;
  if (exhausted(next)) return next;
  return null;
}

/** La riga in chat della fine, e cosa dice l'insegna. */
export function describeGameOver(state: GameState, over: GameOver, me?: Seat): { title: string; detail: string } {
  const { title, detail } = gameOverMsg(over, me);
  return { title: t(title.key, { name: over.winner ? seatLabel(state, over.winner, me) : "" }), detail: t(detail.key) };
}

/** Le stesse due righe come chiavi, per la chat (ognuno le legge nella sua lingua). */
export function gameOverMsg(over: GameOver, me?: Seat): { title: LogMsg; detail: LogMsg } {
  const title =
    over.winner === null
      ? msg("over.draw")
      : over.winner === me
        ? msg("over.won")
        : msg("over.victory", { name: msg("seat.name", { seat: over.winner }) });
  const detail = msg(over.reason === "hp" ? "over.hp" : over.reason === "deck" ? "over.deck" : "over.both");
  return { title, detail };
}

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
  ctx.log(msg("log.front", { seat: state.active }), state.active);
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
  ctx.log(msg("log.reaction", { seat: state.active }), state.active);
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
    ctx.log(msg("log.resolve.manual"), state.active);
    return true;
  }
  if (!(await ctx.dispatch({ t: "resolve", seat: state.active, battles }))) return false;
  const cardId = (uid: string): string => state.cards[uid]?.cardId ?? uid;
  battles.forEach((battle, index) => ctx.log(describeBattle(battle, index + 1, cardId), state.active));
  const foe = otherSeat(state.active);
  const damage = battles.reduce((sum, battle) => sum + battle.damage, 0);
  if (damage > 0) {
    ctx.log(msg("log.damage", { seat: foe, damage, hp: ctx.state().players[foe].hp }), foe);
  }
  return true;
}

export async function endTurn(ctx: Ctx): Promise<void> {
  const state = ctx.state();
  const next = otherSeat(state.active);
  // §9.1 — l'esaurimento del mazzo si decide qui, al confine dei turni:
  // chi chiude a mazzo vuoto ha perso, e se no chi entrerebbe a mazzo
  // vuoto. La fine sostituisce il cambio di turno.
  const loser = state.over ? null : loserByDeck(state);
  if (loser) {
    const over: GameOver = { winner: otherSeat(loser), reason: "deck" };
    if (!(await ctx.dispatch({ t: "gameOver", ...over }))) return;
    const { title, detail } = gameOverMsg(over);
    ctx.log(msg("log.deckout", { title, seat: loser, detail }), over.winner);
    return;
  }
  // Il cambio di turno passa dal giudizio dell'engine (§6.5: mano massima 7
  // alla chiusura): fermato, non succede nulla. Passato, il riduttore ha già
  // apparecchiato il turno di chi entra (Flusso, stappata, frecce).
  if (!(await ctx.dispatch({ t: "turn", turn: state.turn + 1, active: next }))) return;
  const player = ctx.state().players[next];
  ctx.log(msg("log.turn", { turn: state.turn + 1, seat: next, flux: player.flux, max: player.fluxMax }), next);
  // §8.2 — le carte che chi chiude controllava tornano al proprietario.
  await releaseControlled(ctx, state.active, freeFrontSlotOrNull);
}
