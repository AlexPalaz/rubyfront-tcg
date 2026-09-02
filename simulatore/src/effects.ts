// L'interprete degli effetti (§8.2, regola d'oro §1.1) — la parte senza
// DOM, provabile con un Ctx finto. Oggi conosce una forma sola, quella di
// RBF-003: «quando un'altra Entità Umana entra sul tuo Fronte, se ne
// controlli almeno 3, pesca una carta». Chi entra non fa nulla da sé: sono
// le carte GIÀ in campo, con quell'ascoltatore, a innescarsi. Ogni passo
// dell'effetto è un'azione che c'è già (qui la pesca), marcata con
// `effect` — la fonte e l'ingresso — così l'engine la verifica contro la
// forma certificata e la lascia passare come effetto, una volta per
// ingresso. Tutto ciò che non ha una forma certificata resta a mano.

import type { CardFacts, Ctx } from "./ctx.js";
import { fieldCards, seatLabel } from "./state.js";
import type { CardInstance, GameState } from "./types.js";

export interface EnterTrigger {
  source: CardInstance;
  draw: number;
}

/**
 * Chi si innesca all'ingresso di `entering` sul campo: le carte dello
 * stesso posto, già in campo, con un ascoltatore certificato che combacia
 * — razza di chi entra, e almeno N Entità (della razza chiesta) in campo,
 * contando anche chi è appena entrato.
 */
export function enterTriggers(state: GameState, entering: CardInstance, facts: (cardId: string) => CardFacts): EnterTrigger[] {
  const arrived = facts(entering.cardId);
  if (arrived.kind !== "entity") return [];
  const mine = fieldCards(state).filter(card => card.owner === entering.owner);
  const count = (race: string | null): number =>
    mine.filter(card => {
      const f = facts(card.cardId);
      return f.kind === "entity" && (race === null || f.race === race);
    }).length;
  const out: EnterTrigger[] = [];
  for (const source of mine) {
    if (source.uid === entering.uid) continue;
    for (const listener of facts(source.cardId).enterListeners) {
      if (listener.enteringRace !== null && arrived.race !== listener.enteringRace) continue;
      if (count(listener.requires.race) < listener.requires.count) continue;
      out.push({ source, draw: listener.draw });
    }
  }
  return out;
}

/** La riga che annuncia un innesco, per la scena e per la chat. */
export function describeTrigger(trigger: EnterTrigger, facts: (cardId: string) => CardFacts): string {
  const n = trigger.draw;
  return `«${facts(trigger.source.cardId).name}» si innesca: pesca ${n} ${n === 1 ? "carta" : "carte"}`;
}

/**
 * Risolve UN innesco d'ingresso: la pesca marcata come effetto. Il «no»
 * dell'engine ferma il passo e basta. Dice se è passato: chi lo chiama
 * (il tavolo) accende la fonte prima e la spegne dopo, così il ritmo —
 * accesa, pesca, spenta — è del tavolo, non di qui.
 */
export async function resolveTrigger(ctx: Ctx, entering: CardInstance, trigger: EnterTrigger): Promise<boolean> {
  const passed = await ctx.dispatch({
    t: "draw",
    seat: entering.owner,
    count: trigger.draw,
    effect: { source: trigger.source.uid, event: "on_enter_field", entering: entering.uid },
  });
  if (passed) ctx.log(`${seatLabel(ctx.state(), entering.owner)}: ${describeTrigger(trigger, ctx.card)}.`, entering.owner);
  return passed;
}

/**
 * Risolve tutti gli inneschi d'ingresso, uno dopo l'altro. Ritorna le
 * fonti che si sono innescate davvero.
 */
export async function resolveEnter(ctx: Ctx, entering: CardInstance): Promise<CardInstance[]> {
  const fired: CardInstance[] = [];
  for (const trigger of enterTriggers(ctx.state(), entering, ctx.card)) {
    if (await resolveTrigger(ctx, entering, trigger)) fired.push(trigger.source);
  }
  return fired;
}
