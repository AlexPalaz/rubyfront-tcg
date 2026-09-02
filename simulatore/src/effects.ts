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
import { fieldCards, playSpot, seatLabel, zoneCards } from "./state.js";
import type { CardInstance, GameState } from "./types.js";

export interface EnterTrigger {
  source: CardInstance;
  draw: number;
}

/** Uno spostamento all'ingresso da risolvere: chi entra, dove manda, e fra chi si sceglie. */
export interface EnterMoveStep {
  source: CardInstance;
  to: "ritiro";
  candidates: CardInstance[];
}

/**
 * Gli effetti «quando questa entra» di chi entra (§8.2, la forma di
 * RBF-007): per ciascuno, i bersagli possibili — le Entità avversarie in
 * campo. Senza bersagli l'effetto non ha su cosa agire.
 */
export function enterMoves(state: GameState, entering: CardInstance, facts: (cardId: string) => CardFacts): EnterMoveStep[] {
  return facts(entering.cardId).enterMoves.map(move => ({
    source: entering,
    to: move.to,
    candidates: fieldCards(state).filter(card => card.owner !== entering.owner && facts(card.cardId).kind === move.target.kind),
  }));
}

/** Un ritorno all'ingresso da risolvere: chi entra, da dove, e fra cosa si sceglie. */
export interface EnterReturnStep {
  source: CardInstance;
  from: "ritiro";
  candidates: CardInstance[];
}

/**
 * Gli effetti «quando questa entra: metti sul tuo Fronte una carta
 * permanente dalla tua Zona di Ritiro» (§8.2, la forma di RBF-012): per
 * ciascuno, i candidati — le Materie permanenti nella propria Zona di
 * Ritiro.
 */
export function enterReturns(state: GameState, entering: CardInstance, facts: (cardId: string) => CardFacts): EnterReturnStep[] {
  return facts(entering.cardId).enterReturns.map(ret => ({
    source: entering,
    from: ret.from,
    candidates: zoneCards(state, entering.owner, ret.from).filter(card => {
      const f = facts(card.cardId);
      return f.kind === ret.filter.kind && f.behavior === ret.filter.behavior;
    }),
  }));
}

/** La riga che annuncia un ritorno all'ingresso. */
export function describeReturn(step: EnterReturnStep, facts: (cardId: string) => CardFacts): string {
  return `«${facts(step.source.cardId).name}» si innesca: metti sul tuo Fronte una carta permanente dalla tua Zona di Ritiro`;
}

/**
 * Esegue un ritorno all'ingresso: la carta scelta scende sul Fronte, nel
 * suo posto (le Materie nella loro fila), con un toZone marcato come
 * effetto — fonte e ingresso coincidono.
 */
export async function resolveReturn(ctx: Ctx, step: EnterReturnStep, card: CardInstance): Promise<boolean> {
  const spot = playSpot(ctx.state(), card.owner, ctx.card(card.cardId).kind);
  const passed = await ctx.dispatch({
    t: "toZone",
    uid: card.uid,
    zone: "field",
    ...spot,
    z: ctx.state().zTop + 1,
    effect: { source: step.source.uid, event: "on_enter_field", entering: step.source.uid },
  });
  if (passed) {
    ctx.log(
      `${seatLabel(ctx.state(), step.source.owner)}: «${ctx.card(step.source.cardId).name}» riporta «${ctx.card(card.cardId).name}» sul Fronte.`,
      step.source.owner
    );
  }
  return passed;
}

/** Uno sguardo nel mazzo da risolvere: chi entra, le carte guardate, quali si possono mostrare. */
export interface EnterLookStep {
  source: CardInstance;
  count: number;
  looked: CardInstance[];
  candidates: CardInstance[];
}

/**
 * Gli sguardi nel mazzo di chi entra (§8.2, la forma di RBF-006): le prime
 * N del proprio mazzo, e fra queste quelle che si possono mostrare.
 */
export function enterLooks(state: GameState, entering: CardInstance, facts: (cardId: string) => CardFacts): EnterLookStep[] {
  return facts(entering.cardId).enterLooks.map(look => {
    const looked = zoneCards(state, entering.owner, "deck").slice(0, look.count);
    const candidates = looked.filter(card => {
      if (!look.reveal) return false;
      const f = facts(card.cardId);
      return f.kind === look.reveal.kind && (look.reveal.race === null || f.race === look.reveal.race);
    });
    return { source: entering, count: look.count, looked, candidates };
  });
}

/** La riga che annuncia uno sguardo nel mazzo. */
export function describeLook(step: EnterLookStep, facts: (cardId: string) => CardFacts): string {
  return `«${facts(step.source.cardId).name}» si innesca: guarda le prime ${step.count} carte del mazzo`;
}

/**
 * Esegue lo sguardo: la carta mostrata (o nessuna) in mano, le altre in
 * fondo — un'azione sola, marcata come effetto.
 */
export async function resolveLook(ctx: Ctx, step: EnterLookStep, reveal: CardInstance | null): Promise<boolean> {
  const passed = await ctx.dispatch({
    t: "look",
    seat: step.source.owner,
    count: step.count,
    ...(reveal ? { reveal: reveal.uid } : {}),
    effect: { source: step.source.uid, event: "on_enter_field", entering: step.source.uid },
  });
  if (passed) {
    const who = seatLabel(ctx.state(), step.source.owner);
    ctx.log(
      reveal
        ? `${who}: «${ctx.card(step.source.cardId).name}» mostra «${ctx.card(reveal.cardId).name}» e la prende in mano; le altre in fondo al mazzo.`
        : `${who}: «${ctx.card(step.source.cardId).name}» guarda ${step.count} carte e le mette in fondo al mazzo.`,
      step.source.owner
    );
  }
  return passed;
}

/** La riga che annuncia uno spostamento all'ingresso. */
export function describeMove(step: EnterMoveStep, facts: (cardId: string) => CardFacts): string {
  return `«${facts(step.source.cardId).name}» si innesca: metti un'Entità avversaria nella Zona di Ritiro`;
}

/**
 * Esegue uno spostamento all'ingresso sul bersaglio scelto: un toZone
 * marcato come effetto — la fonte è chi entra, e l'ingresso è lei stessa.
 */
export async function resolveMove(ctx: Ctx, step: EnterMoveStep, target: CardInstance): Promise<boolean> {
  const passed = await ctx.dispatch({
    t: "toZone",
    uid: target.uid,
    zone: step.to,
    effect: { source: step.source.uid, event: "on_enter_field", entering: step.source.uid },
  });
  if (passed) {
    ctx.log(
      `${seatLabel(ctx.state(), step.source.owner)}: «${ctx.card(step.source.cardId).name}» manda «${ctx.card(target.cardId).name}» nella Zona di Ritiro.`,
      step.source.owner
    );
  }
  return passed;
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
