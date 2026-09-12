// Ciò che una risoluzione (§6.3, §6.4) fa vedere, per chi la disegna: chi
// cade — e vola nell'Abisso col suo taglio — e chi incassa il colpo e regge
// (la parata del bloccante, la risposta di chi contrattacca, il Rubyfront
// che prende i danni di un attacco non bloccato). Puro: lo stato di PRIMA
// dell'azione, e l'azione. Lo usano il simulatore e il gioco.

import type { Action, GameState } from "./types.js";

export interface Clash {
  uid: string;
  kind: "parry" | "riposte" | "strike";
}

/**
 * Chi muore nella risoluzione (§6.4): gli attaccanti e i bloccanti segnati
 * morti, e la Reattiva che si consuma — quelli ancora in campo. Chi ha
 * Stasi (§8.1) resta.
 */
export function fallenOf(state: GameState, action: Action): string[] {
  if (action.t !== "resolve") return [];
  const fallen: string[] = [];
  for (const battle of action.battles) {
    if (battle.attackerDies && state.cards[battle.attacker]?.zone === "field") fallen.push(battle.attacker);
    if (battle.blocker && !battle.blockerStasis && (battle.blockerDies || battle.blockerSpent) && state.cards[battle.blocker]?.zone === "field") fallen.push(battle.blocker);
  }
  return [...new Set(fallen)];
}

/**
 * I colpi da mostrare dopo il disegno (§6.3): la parata del bloccante che
 * regge (`parry`), la risposta di chi contrattacca (`riposte`), il
 * Rubyfront che incassa i danni degli attacchi non bloccati (`strike`).
 * Chi muore ha il suo taglio sul fantasma del volo.
 */
export function clashesOf(state: GameState, action: Action): Clash[] {
  if (action.t !== "resolve") return [];
  const out: Clash[] = [];
  for (const battle of action.battles) {
    if (battle.blocker && state.cards[battle.blocker]?.zone === "field" && !battle.blockerDies && !battle.blockerSpent) {
      out.push({ uid: battle.blocker, kind: battle.kind === "counter" ? "riposte" : "parry" });
    }
    if (battle.kind === "unblocked" && battle.damage > 0) {
      const target = state.declarations.find(d => d.from === battle.attacker && d.kind === "attack")?.to;
      if (target && state.cards[target]?.zone === "field") out.push({ uid: target, kind: "strike" });
    }
  }
  return out;
}
