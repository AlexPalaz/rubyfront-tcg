// L'interprete degli effetti (§8.2, regola d'oro §1.1) — la parte senza
// DOM, provabile con un Ctx finto. Oggi conosce una forma sola, quella di
// RBF-003: «quando un'altra Entità Umana entra sul tuo Fronte, se ne
// controlli almeno 3, pesca una carta». Chi entra non fa nulla da sé: sono
// le carte GIÀ in campo, con quell'ascoltatore, a innescarsi. Ogni passo
// dell'effetto è un'azione che c'è già (qui la pesca), marcata con
// `effect` — la fonte e l'ingresso — così l'engine la verifica contro la
// forma certificata e la lascia passare come effetto, una volta per
// ingresso. Tutto ciò che non ha una forma certificata resta a mano.

import { cardsWord, msg, t, type LogMsg } from "./i18n.js";
import type { AssignForm, AttackForm, DeathForm, FlipForm, ResolveForm, EnterSort, TapListener } from "./ctx.js";
import type { CardFacts, Ctx, EnterEmpower, EnterFreeze, EnterLook, EnterPeek, EnterRefresh, EnterStash, EnterTap, EnterWake } from "./ctx.js";
import { STACK_STEP, controllerOf, exilesDue, fieldCards, inPlay, playSpot, rollKey, sealedForPlay, zoneCards, freeFrontSlotOrNull } from "./state.js";
import { countEntities, powerOf } from "./combat.js";
import type { CardInstance, EffectRef, GameState, Seat } from "./types.js";

export interface EnterTrigger {
  source: CardInstance;
  draw: number;
  /** «Guadagni N PV» (dal 2026-10-23): la forma dei PV, al posto della pesca. */
  heal?: number;
}

/** Uno spostamento all'ingresso da risolvere: chi entra, dove manda, e fra chi si sceglie. */
export interface EnterMoveStep {
  source: CardInstance;
  to: "ritiro" | "abisso";
  /** L'esilio condizionato: la carta va nell'Abisso tenuta da chi entra (heldBy). */
  hold: boolean;
  /** Il vincolo «con costo di Flusso N o inferiore» sul bersaglio (null = nessuno). */
  maxCost: number | null;
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
    hold: move.hold === true,
    maxCost: move.target.maxCost,
    // Il vincolo di costo («con costo di Flusso N o inferiore»): chi costa
    // di più, o ha costo ignoto, non è un bersaglio — come l'engine.
    candidates: fieldCards(state).filter(card => {
      if (controllerOf(card) === controllerOf(entering)) return false;
      const f = facts(card.cardId);
      if (f.kind !== move.target.kind) return false;
      return move.target.maxCost === null || (f.fluxCost !== null && f.fluxCost <= move.target.maxCost);
    }),
  }));
}

/** Un ritorno da risolvere: la fonte, l'evento, da dove, e fra cosa si sceglie. */
export interface EnterReturnStep {
  source: CardInstance;
  event: EffectRef["event"];
  from: "ritiro";
  candidates: CardInstance[];
  /** Il Fronte pieno ha tolto dei candidati (§6.2): il tavolo lo dice. */
  frontFull: boolean;
}

/**
 * Gli effetti «metti sul tuo Fronte una carta statica dalla tua Zona di
 * Ritiro» (§8.2, la forma di RBF-012), all'ingresso o all'attacco: per
 * ciascuno, i candidati — le Materie Statiche nella propria Zona di
 * Ritiro.
 */
export function returnsFor(
  state: GameState,
  source: CardInstance,
  facts: (cardId: string) => CardFacts,
  event: EffectRef["event"]
): EnterReturnStep[] {
  const forms = event === "on_attack" ? facts(source.cardId).attackReturns : facts(source.cardId).enterReturns;
  const seat = controllerOf(source);
  // §6.2, Fronte pieno: «anche la parte d'effetto che metterebbe in campo
  // non si applica». Riguarda le sole Entità — una Materia Statica sta
  // dietro il Fronte e non occupa uno slot (§5).
  // Dal 2026-09-15 a Fronte pieno l'Entità può prendere il posto di una
  // propria (§6.2, la sostituzione): resta fra i candidati, e `frontFull`
  // dice al tavolo di chiederlo.
  const full = freeFrontSlotOrNull(state, seat) === null;
  return forms.map(ret => {
    const candidates = zoneCards(state, seat, ret.from).filter(card => staticCardOf(card, facts) && !sealedForPlay(state, card));
    return {
      source,
      event,
      from: ret.from,
      candidates,
      frontFull: full && candidates.some(card => facts(card.cardId).kind === "entity"),
    };
  });
}

export function enterReturns(state: GameState, entering: CardInstance, facts: (cardId: string) => CardFacts): EnterReturnStep[] {
  return returnsFor(state, entering, facts, "on_enter_field");
}

/** Una pesca all'attacco da risolvere: chi attacca, quante, e quante da scartare poi. */
export interface AttackDrawStep {
  source: CardInstance;
  draw: number;
  thenDiscard: number;
}

/** «Mentre ha un Oggetto assegnato» (§3.1): un Oggetto in campo la veste. */
export function armed(state: GameState, uid: string): boolean {
  return Object.values(state.cards).some(card => card.assignedTo === uid && card.zone === "field");
}

/**
 * Le pesche «quando attacca» (§8.2, la forma di RBF-026): scattano solo
 * se l'attaccante ha un Oggetto assegnato. Una volta per turno la dà il
 * gioco stesso: un'Entità attacca una volta sola per turno (§6.3).
 */
export function attackDraws(state: GameState, attacker: CardInstance, facts: (cardId: string) => CardFacts): AttackDrawStep[] {
  return facts(attacker.cardId).attackDraws
    .filter(form => !form.requiresObject || armed(state, attacker.uid))
    .map(form => ({ source: attacker, draw: form.draw, thenDiscard: form.thenDiscard }));
}

/** La riga che annuncia una pesca all'attacco. */
export function describeAttackDraw(step: AttackDrawStep, facts: (cardId: string) => CardFacts): string {
  const card = `«${facts(step.source.cardId).name}»`;
  return step.thenDiscard > 0
    ? t("trigger.attackdraw.discard", { card, n: step.draw, cards: cardsWord(step.draw), m: step.thenDiscard })
    : t("trigger.attackdraw", { card, n: step.draw, cards: cardsWord(step.draw) });
}

/** Esegue la pesca all'attacco: una pesca del controllore marcata come effetto. */
export async function resolveAttackDraw(ctx: Ctx, step: AttackDrawStep): Promise<boolean> {
  const by = controllerOf(step.source);
  const passed = await ctx.dispatch({
    t: "draw",
    seat: by,
    count: step.draw,
    effect: { source: step.source.uid, event: "on_attack", entering: step.source.uid },
  });
  if (passed) {
    ctx.log(msg("log.effect.trigger", { seat: by, card: step.source.cardId, n: step.draw, cards: msg(step.draw === 1 ? "cards.one" : "cards.many") }), by);
  }
  return passed;
}

/** «Poi scarta una carta»: la carta scelta va in Zona di Ritiro (§5, §6.5), come seguito dell'innesco. */
export async function resolveAttackDiscard(ctx: Ctx, step: AttackDrawStep, card: CardInstance): Promise<boolean> {
  const by = controllerOf(step.source);
  const passed = await ctx.dispatch({
    t: "toZone",
    uid: card.uid,
    zone: "ritiro",
    effect: { source: step.source.uid, event: "on_attack", entering: step.source.uid, follow: "discard" },
  });
  if (passed) ctx.log(msg("log.effect.discard", { seat: by, sourceCard: step.source.cardId, card: card.cardId }), by);
  return passed;
}

/** La riga che annuncia un ritorno all'ingresso. */
export function describeReturn(step: EnterReturnStep, facts: (cardId: string) => CardFacts): string {
  return t("trigger.return", { card: `«${facts(step.source.cardId).name}»` });
}

/**
 * Esegue un ritorno all'ingresso: la carta scelta scende sul Fronte, nel
 * suo posto (le Materie nella loro fila), con un toZone marcato come
 * effetto — fonte e ingresso coincidono.
 */
export async function resolveReturn(ctx: Ctx, step: EnterReturnStep, card: CardInstance, place?: Placement): Promise<boolean> {
  const spot = place?.spot ?? playSpot(ctx.state(), card.owner, ctx.card(card.cardId).kind);
  const by = controllerOf(step.source);
  const replaced = place?.replace ? ctx.state().cards[place.replace] : undefined;
  const passed = await ctx.dispatch({
    t: "toZone",
    uid: card.uid,
    zone: "field",
    ...spot,
    z: ctx.state().zTop + 1,
    ...(place?.replace ? { replace: place.replace } : {}),
    effect: { source: step.source.uid, event: step.event, entering: step.source.uid },
  });
  if (passed) {
    ctx.log(msg("log.effect.return", { seat: by, sourceCard: step.source.cardId, card: card.cardId }), by);
    if (replaced) ctx.log(msg("log.effect.replace", { seat: by, card: card.cardId, otherCard: replaced.cardId }), by);
  }
  return passed;
}

/**
 * Dove scende chi rientra sul Fronte: uno slot libero, o — a Fronte pieno
 * (§6.2, dal 2026-09-15) — lo slot dell'Entità propria che lascia il posto
 * (`replace`: va in Zona di Ritiro coi suoi Oggetti, nella stessa azione).
 */
export interface Placement {
  spot: { x: number; y: number };
  replace?: string;
}

/** Uno sguardo nel mazzo da risolvere: chi entra, la forma, e — dopo il
    tiro se c'è — le carte guardate e quali si possono mostrare. */
export interface EnterLookStep {
  source: CardInstance;
  look: EnterLook;
  /** Il tiro, se la forma lo vuole: lo mette il tavolo prima di guardare. */
  roll: number | null;
  count: number;
  looked: CardInstance[];
  candidates: CardInstance[];
}

/** Quante carte si guardano, data la forma e il tiro (§8.2, RBF-027). */
export function lookCount(look: EnterLook, roll: number | null): number {
  if (look.count !== null) return look.count;
  // «Tante carte quanto il tiro», o «countBase + ceil(tiro/2)».
  if (look.formula === "result") return roll ?? 0;
  return look.countBase + Math.ceil((roll ?? 0) / 2);
}

/**
 * Gli sguardi nel mazzo di chi entra (§8.2, le forme di RBF-006 e RBF-027):
 * senza dado, le prime N del proprio mazzo e fra queste quelle che si
 * possono mostrare; col dado, il passo resta da riempire dopo il tiro
 * (vedi lookAfterRoll).
 */
export function enterLooks(state: GameState, entering: CardInstance, facts: (cardId: string) => CardFacts): EnterLookStep[] {
  return facts(entering.cardId).enterLooks.map(look => lookAfterRoll(state, entering, look, null, facts));
}

/** Lo sguardo riempito: le carte guardate col conto della forma e del tiro. */
export function lookAfterRoll(
  state: GameState,
  entering: CardInstance,
  look: EnterLook,
  roll: number | null,
  facts: (cardId: string) => CardFacts
): EnterLookStep {
  const count = look.die !== null && roll === null ? 0 : lookCount(look, roll);
  const looked = zoneCards(state, controllerOf(entering), "deck").slice(0, count);
  const candidates = looked.filter(card => {
    if (!look.reveal) return false;
    const f = facts(card.cardId);
    return f.kind === look.reveal.kind && (look.reveal.race === null || f.race === look.reveal.race);
  });
  return { source: entering, look, roll, count, looked, candidates };
}

/** La riga che annuncia uno sguardo nel mazzo. */
export function describeLook(step: EnterLookStep, facts: (cardId: string) => CardFacts): string {
  const card = `«${facts(step.source.cardId).name}»`;
  if (step.look.die !== null) {
    return t(step.look.formula === "result" ? "trigger.look.roll" : "trigger.look.die", { card, die: step.look.die, base: step.look.countBase });
  }
  return t("trigger.look", { card, n: step.count });
}

/**
 * Esegue lo sguardo: la carta mostrata (o nessuna) in mano, le altre in
 * fondo — un'azione sola, marcata come effetto.
 */
export async function resolveLook(
  ctx: Ctx,
  step: EnterLookStep,
  reveal: CardInstance | null,
  retire: CardInstance | null = null,
  ref: EffectRef | null = null
): Promise<boolean> {
  const by = controllerOf(step.source);
  const passed = await ctx.dispatch({
    t: "look",
    seat: by,
    count: step.count,
    ...(reveal ? { reveal: reveal.uid } : {}),
    ...(retire ? { retire: retire.uid } : {}),
    ...(step.roll !== null ? { roll: step.roll } : {}),
    // Di regola lo sguardo di chi entra; un'abilità del Rubyfront (§3.1)
    // passa il suo riferimento.
    effect: ref ?? { source: step.source.uid, event: "on_enter_field", entering: step.source.uid },
  });
  if (passed) {
    const parts: LogMsg[] = [
      step.roll !== null ? msg("look.rolled", { die: step.look.die ?? 0, roll: step.roll, n: step.count }) : msg("look.looked", { n: step.count }),
      reveal ? msg("look.reveal", { card: reveal.cardId }) : msg("look.noreveal"),
      ...(retire ? [msg("look.retire", { card: retire.cardId })] : []),
      msg("look.rest"),
    ];
    ctx.log(msg("log.effect.look", { seat: by, sourceCard: step.source.cardId, parts }), by);
  }
  return passed;
}

/** La riga che annuncia uno spostamento all'ingresso. */
export function describeMove(step: EnterMoveStep, facts: (cardId: string) => CardFacts): string {
  const card = `«${facts(step.source.cardId).name}»`;
  if (step.maxCost !== null) return t(step.hold ? "trigger.loose.cost" : "trigger.retire.cost", { card, n: step.maxCost });
  return t(step.hold ? "trigger.loose" : "trigger.retire", { card });
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
    // L'esilio condizionato: chi entra tiene la carta nell'Abisso (heldBy);
    // quando lascia il campo, il release la riporta in gioco (main.ts).
    ...(step.hold ? { heldBy: step.source.uid } : {}),
    effect: { source: step.source.uid, event: "on_enter_field", entering: step.source.uid },
  });
  if (passed) {
    ctx.log(msg(step.hold ? "log.effect.exile" : "log.effect.retire", { seat: controllerOf(step.source), sourceCard: step.source.cardId, card: target.cardId }), controllerOf(step.source));
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
  const mine = fieldCards(state).filter(card => controllerOf(card) === controllerOf(entering) && inPlay(card, facts(card.cardId).kind));
  const count = (race: string | null): number =>
    mine.filter(card => {
      const f = facts(card.cardId);
      return f.kind === "entity" && (race === null || f.race === race);
    }).length;
  const out: EnterTrigger[] = [];
  for (const source of mine) {
    for (const listener of facts(source.cardId).enterListeners) {
      // Il proprio ingresso conta solo con «compresa questa» (dal 2026-10-23).
      if (source.uid === entering.uid && !listener.self) continue;
      if (listener.enteringRace !== null && arrived.race !== listener.enteringRace) continue;
      if (listener.requires && count(listener.requires.race) < listener.requires.count) continue;
      // «Se in questo turno sono entrate sul tuo Fronte almeno N» (dal 2026-10-20): chi è entrato, l'ingresso compreso.
      if (listener.requiresEntered && enteredThisTurn(state, controllerOf(entering), listener.requiresEntered.race, facts) < listener.requiresEntered.count) continue;
      out.push(listener.heal ? { source, draw: 0, heal: listener.heal } : { source, draw: listener.draw });
    }
  }
  return out;
}

/** Le Entità di `race` che `seat` comanda, entrate sul Fronte in questo turno (§8.2). Gemello: engine.rb, entered_this_turn. */
export function enteredThisTurn(state: GameState, seat: Seat, race: string | null, facts: (cardId: string) => CardFacts): number {
  return fieldCards(state).filter(card => {
    if (controllerOf(card) !== seat || card.enteredTurn !== state.turn) return false;
    const f = facts(card.cardId);
    return f.kind === "entity" && (race === null || f.race === race);
  }).length;
}

/** «Questa Entità entra tappata» (§8.2, dal 2026-10-20): l'innesco proprio dell'ingresso. */
export interface EnterTapStep {
  source: CardInstance;
  tap: EnterTap;
}

export function enterTaps(entering: CardInstance, facts: (cardId: string) => CardFacts): EnterTapStep[] {
  return facts(entering.cardId).enterTaps.map(tap => ({ source: entering, tap }));
}

export function describeTap(step: EnterTapStep, facts: (cardId: string) => CardFacts): string {
  return t("trigger.weary", { card: `«${facts(step.source.cardId).name}»` });
}

/** Esegue la tappata di chi entra: un `tap` marcato come effetto. */
export async function resolveTap(ctx: Ctx, step: EnterTapStep): Promise<boolean> {
  const by = controllerOf(step.source);
  const passed = await ctx.dispatch({ t: "tap", uid: step.source.uid, tapped: true, effect: { source: step.source.uid, event: "on_enter_field", entering: step.source.uid } });
  if (passed) ctx.log(msg("log.effect.tapped", { seat: by, card: step.source.cardId }), by);
  return passed;
}

/** «Quando entra sul Fronte, metti N Entità avversarie in Stasi» (§8.1, dal 2026-10-22): chi entra, la forma, fra chi si sceglie. */
export interface EnterFreezeStep {
  source: CardInstance;
  form: EnterFreeze;
  candidates: CardInstance[];
}

export function enterFreezes(state: GameState, entering: CardInstance, facts: (cardId: string) => CardFacts): EnterFreezeStep[] {
  const seat = controllerOf(entering);
  return facts(entering.cardId).enterFreezes.map(form => ({
    source: entering,
    form,
    candidates: fieldCards(state).filter(card => {
      if (controllerOf(card) === seat || !freezable(card, facts)) return false;
      const cost = facts(card.cardId).fluxCost;
      return form.maxCost === null || (cost !== null && cost <= form.maxCost);
    }),
  }));
}

export function describeFreeze(step: EnterFreezeStep, facts: (cardId: string) => CardFacts): string {
  const card = `«${facts(step.source.cardId).name}»`;
  return step.form.count === 1 && step.form.maxCost === null
    ? t("trigger.freeze", { card })
    : t("trigger.freeze.many", { card, n: step.form.count, m: step.form.maxCost ?? 0 });
}

/** Esegue la Stasi all'ingresso sul bersaglio scelto: un `tap` con `stasis`, marcato come effetto d'ingresso. */
export async function resolveFreeze(ctx: Ctx, step: EnterFreezeStep, target: CardInstance): Promise<boolean> {
  const by = controllerOf(step.source);
  const passed = await ctx.dispatch({ t: "tap", uid: target.uid, tapped: true, stasis: true, effect: { source: step.source.uid, event: "on_enter_field", entering: step.source.uid } });
  if (passed) ctx.log(msg("log.effect.freeze", { seat: by, sourceCard: step.source.cardId, card: target.cardId }), by);
  return passed;
}

/** «Quando entra sul Fronte, puoi togliere dalla Stasi un'Entità che controlli» (§8.1, dal 2026-10-22). */
export interface EnterWakeStep {
  source: CardInstance;
  form: EnterWake;
  candidates: CardInstance[];
}

export function enterWakes(state: GameState, entering: CardInstance, facts: (cardId: string) => CardFacts): EnterWakeStep[] {
  const seat = controllerOf(entering);
  return facts(entering.cardId).enterWakes.map(form => ({
    source: entering,
    form,
    candidates: fieldCards(state).filter(card => controllerOf(card) === seat && card.stasis === true && facts(card.cardId).kind === "entity"),
  }));
}

export function describeWake(step: EnterWakeStep, facts: (cardId: string) => CardFacts): string {
  return t("trigger.wake", { card: `«${facts(step.source.cardId).name}»` });
}

/** Esegue la stappata dalla Stasi sul bersaglio scelto: un `empower` che stappa, marcato come effetto d'ingresso. */
export async function resolveWake(ctx: Ctx, step: EnterWakeStep, target: CardInstance): Promise<boolean> {
  const by = controllerOf(step.source);
  const passed = await ctx.dispatch({ t: "empower", uid: target.uid, untap: true, effect: { source: step.source.uid, event: "on_enter_field", entering: step.source.uid } });
  if (passed) ctx.log(msg("log.effect.wake", { seat: by, sourceCard: step.source.cardId, card: target.cardId }), by);
  return passed;
}

/**
 * «Ogni volta che un'Entità entra in Stasi, guadagni N PV» (§8.2, dal
 * 2026-10-22): fra `before` e `after`, ogni Entità con un numero d'ingresso
 * in Stasi nuovo innesca il Rubyfront schierato di chi lo comanda, sulla
 * faccia in vista — se non l'ha già fatto per QUELL'ingresso. La sessione
 * lo offre dopo ogni azione, come il ritorno vincolato.
 */
export interface StasisHealStep {
  source: CardInstance;
  target: CardInstance;
  amount: number;
}

export function stasisHeals(before: GameState, after: GameState, facts: (cardId: string) => CardFacts): StasisHealStep[] {
  const out: StasisHealStep[] = [];
  const entered = Object.values(after.cards).filter(card => card.zone === "field" && card.stasis === true && card.stasisAt !== undefined && before.cards[card.uid]?.stasisAt !== card.stasisAt);
  if (entered.length === 0) return out;
  for (const rubyfront of fieldCards(after)) {
    const f = facts(rubyfront.cardId);
    if (f.kind !== "rubyfront" || !inPlay(rubyfront, f.kind)) continue;
    const listener = f.stasisListeners.find(candidate => candidate.face === rubyfront.face);
    if (!listener) continue;
    for (const target of entered) {
      if ((after.fired ?? []).includes(`${rubyfront.uid}|on_enter_stasis|${target.uid}@${target.stasisAt}`)) continue;
      out.push({ source: rubyfront, target, amount: listener.amount });
    }
  }
  return out;
}

export function describeStasisHeal(step: StasisHealStep, facts: (cardId: string) => CardFacts): string {
  return t("trigger.stillness", { card: `«${facts(step.source.cardId).name}»`, n: step.amount });
}

/** Esegue il guadagno di PV: una patch dei PV marcata dall'ingresso in Stasi. */
export async function resolveStasisHeal(ctx: Ctx, step: StasisHealStep): Promise<boolean> {
  const by = controllerOf(step.source);
  const hp = ctx.state().players[by].hp + step.amount;
  const passed = await ctx.dispatch({ t: "player", seat: by, patch: { hp }, effect: { source: step.source.uid, event: "on_enter_stasis", entering: step.target.uid } });
  if (passed) ctx.log(msg("log.effect.stillness", { seat: by, sourceCard: step.source.cardId, card: step.target.cardId, n: step.amount, hp: ctx.state().players[by].hp }), by);
  return passed;
}

/** L'esilio a tempo scaduto (§8.2, dal 2026-10-22): l'Entità in Ritiro di `seat` e la Materia che l'ha esiliata. */
export interface ExileReturnStep {
  card: CardInstance;
  source: string;
  form: Extract<ResolveForm, { kind: "exile_timed" }>;
}

export function exileReturns(state: GameState, seat: Seat, facts: (cardId: string) => CardFacts): ExileReturnStep[] {
  const out: ExileReturnStep[] = [];
  for (const card of exilesDue(state, seat)) {
    const source = card.exile?.source;
    const matter = source ? state.cards[source] : undefined;
    const form = matter ? facts(matter.cardId).resolveForms.find((candidate): candidate is Extract<ResolveForm, { kind: "exile_timed" }> => candidate.kind === "exile_timed") : undefined;
    if (!source || !form) continue;
    out.push({ card, source, form });
  }
  return out;
}

export function exileReturnRef(step: ExileReturnStep): EffectRef {
  return { source: step.source, event: "on_exile_end", entering: step.card.uid };
}

/** «Quando entra, un'altra Entità che controlli prende +N Potenza» (§8.2, dal 2026-10-20): chi entra, la forma, fra chi si sceglie. */
export interface EnterEmpowerStep {
  source: CardInstance;
  form: EnterEmpower;
  candidates: CardInstance[];
}

export function enterEmpowers(state: GameState, entering: CardInstance, facts: (cardId: string) => CardFacts): EnterEmpowerStep[] {
  const seat = controllerOf(entering);
  return facts(entering.cardId).enterEmpowers.map(form => ({
    source: entering,
    form,
    candidates: fieldCards(state).filter(card => {
      if (card.uid === entering.uid || controllerOf(card) !== seat) return false;
      const f = facts(card.cardId);
      return f.kind === "entity" && (form.race === null || f.race === form.race);
    }),
  }));
}

export function describeEnterEmpower(step: EnterEmpowerStep, facts: (cardId: string) => CardFacts): string {
  return t("trigger.order", { card: `«${facts(step.source.cardId).name}»`, n: step.form.power });
}

/** Esegue il potenziamento all'ingresso sul bersaglio scelto: un `empower` marcato come effetto d'ingresso. */
export async function resolveEnterEmpower(ctx: Ctx, step: EnterEmpowerStep, target: CardInstance): Promise<boolean> {
  const by = controllerOf(step.source);
  const passed = await ctx.dispatch({ t: "empower", uid: target.uid, power: step.form.power, effect: { source: step.source.uid, event: "on_enter_field", entering: step.source.uid } });
  if (passed) ctx.log(msg("log.effect.empower", { seat: by, sourceCard: step.source.cardId, card: target.cardId, n: step.form.power }), by);
  return passed;
}

/**
 * Lo sguardo in cima della Statica che ascolta gli ingressi (§8.2, dal
 * 2026-10-20): «ogni volta che un'Entità [di razza] entra sul tuo Fronte,
 * guarda la prima carta del tuo mazzo: puoi metterla in fondo». La fonte è
 * un'altra carta del posto in gioco; `top` è la carta da guardare, null a
 * mazzo vuoto.
 */
export interface EnterPeekStep {
  source: CardInstance;
  entering: CardInstance;
  peek: EnterPeek;
  top: CardInstance | null;
}

export function enterPeeks(state: GameState, entering: CardInstance, facts: (cardId: string) => CardFacts): EnterPeekStep[] {
  const arrived = facts(entering.cardId);
  if (arrived.kind !== "entity") return [];
  const seat = controllerOf(entering);
  const out: EnterPeekStep[] = [];
  // Sull'ingresso PROPRIO (dal 2026-10-23): la fonte è chi entra.
  for (const peek of arrived.enterPeeks) {
    if (peek.self) out.push({ source: entering, entering, peek, top: zoneCards(state, seat, "deck")[0] ?? null });
  }
  for (const source of fieldCards(state)) {
    if (source.uid === entering.uid || controllerOf(source) !== seat || !inPlay(source, facts(source.cardId).kind)) continue;
    for (const peek of facts(source.cardId).enterPeeks) {
      if (peek.self || (peek.enteringRace !== null && arrived.race !== peek.enteringRace)) continue;
      out.push({ source, entering, peek, top: zoneCards(state, seat, "deck")[0] ?? null });
    }
  }
  return out;
}

/** «Quando entra sul Fronte, guarda le prime N carte del tuo mazzo e rimettile in cima nell'ordine che vuoi» (§8.2, dal 2026-10-23). */
export interface EnterSortStep {
  source: CardInstance;
  form: EnterSort;
  /** Le prime N del proprio mazzo, nell'ordine di adesso. */
  top: CardInstance[];
}

export function enterSorts(state: GameState, entering: CardInstance, facts: (cardId: string) => CardFacts): EnterSortStep[] {
  const seat = controllerOf(entering);
  return facts(entering.cardId).enterSorts.map(form => ({ source: entering, form, top: zoneCards(state, seat, "deck").slice(0, form.count) }));
}

export function describeSort(step: EnterSortStep, facts: (cardId: string) => CardFacts): string {
  return t("trigger.sort", { card: `«${facts(step.source.cardId).name}»`, n: step.form.count });
}

/** Esegue il riordino: un `look` di N col seguito `sort` e l'ordine nuovo (la prima dell'elenco sopra). */
export async function resolveSort(ctx: Ctx, step: EnterSortStep, order: CardInstance[]): Promise<boolean> {
  const by = controllerOf(step.source);
  const passed = await ctx.dispatch({ t: "look", seat: by, count: step.form.count, restTo: "deck", order: order.map(card => card.uid), effect: { source: step.source.uid, event: "on_enter_field", entering: step.source.uid, follow: "sort" } });
  if (passed) ctx.log(msg("log.effect.sort", { seat: by, sourceCard: step.source.cardId, n: step.top.length }), by);
  return passed;
}

/** «Poi guadagni N PV per ogni Entità avversaria tappata» (§8.2, dal 2026-10-23): il seguito della Stasi imposta all'ingresso. */
export interface EnterTallyStep {
  source: CardInstance;
  form: EnterFreeze;
  /** Le Entità avversarie tappate adesso. */
  tapped: number;
  amount: number;
}

export function enterTallies(state: GameState, entering: CardInstance, facts: (cardId: string) => CardFacts): EnterTallyStep[] {
  const seat = controllerOf(entering);
  return facts(entering.cardId).enterFreezes.filter(form => form.thenHealPerTapped).map(form => {
    const tapped = tappedOpponents(state, seat, facts);
    return { source: entering, form, tapped, amount: (form.thenHealPerTapped ?? 0) * tapped };
  });
}

/** Le Entità avversarie di `seat` tappate, in campo (§8.2). Gemello: engine.rb, tapped_opponents. */
export function tappedOpponents(state: GameState, seat: Seat, facts: (cardId: string) => CardFacts): number {
  return fieldCards(state).filter(card => controllerOf(card) !== seat && card.tapped && facts(card.cardId).kind === "entity").length;
}

export function describeTally(step: EnterTallyStep, facts: (cardId: string) => CardFacts): string {
  return t("trigger.tally", { card: `«${facts(step.source.cardId).name}»`, n: step.form.thenHealPerTapped ?? 0 });
}

/** Esegue il conto: una patch dei PV marcata col seguito `tally`, con le avversarie tappate di ADESSO. */
export async function resolveTally(ctx: Ctx, step: EnterTallyStep): Promise<boolean> {
  const by = controllerOf(step.source);
  const tapped = tappedOpponents(ctx.state(), by, ctx.card);
  const amount = (step.form.thenHealPerTapped ?? 0) * tapped;
  if (amount === 0) {
    ctx.log(msg("log.no.tapped.opponents", { seat: by, card: step.source.cardId }), by);
    return false;
  }
  const hp = ctx.state().players[by].hp + amount;
  const passed = await ctx.dispatch({ t: "player", seat: by, patch: { hp }, effect: { source: step.source.uid, event: "on_enter_field", entering: step.source.uid, follow: "tally" } });
  if (passed) ctx.log(msg("log.effect.tally", { seat: by, sourceCard: step.source.cardId, n: amount, m: tapped, hp: ctx.state().players[by].hp }), by);
  return passed;
}

/**
 * «Ogni volta che un'Entità che controlli viene tappata, guadagni N PV» e,
 * dall'Oggetto, «ogni volta che quell'Entità viene tappata, lancia un dX: con
 * M o più guadagni N PV» (§8.2, dal 2026-10-23): le tappate nuove fra due
 * lavagne (il numero `tapAt` è cambiato), e per ognuna le fonti in campo che
 * ascoltano — un'Entità dello stesso posto della tappata, o l'Oggetto
 * addosso a lei — con l'innesco non ancora consumato.
 */
export interface TapHealStep {
  source: CardInstance;
  target: CardInstance;
  listener: TapListener;
}

export function tapHeals(before: GameState, after: GameState, facts: (cardId: string) => CardFacts): TapHealStep[] {
  const out: TapHealStep[] = [];
  const tapped = Object.values(after.cards).filter(card => card.zone === "field" && card.tapped && card.tapAt !== undefined && before.cards[card.uid]?.tapAt !== card.tapAt && facts(card.cardId).kind === "entity");
  if (tapped.length === 0) return out;
  for (const source of fieldCards(after)) {
    const f = facts(source.cardId);
    if (!inPlay(source, f.kind)) continue;
    for (const listener of f.tapListeners) {
      for (const target of tapped) {
        const listens = listener.scope === "controlled" ? controllerOf(source) === controllerOf(target) : source.assignedTo === target.uid;
        if (!listens) continue;
        if ((after.fired ?? []).includes(`${source.uid}|on_tap|${target.uid}@${target.tapAt}`)) continue;
        out.push({ source, target, listener });
      }
    }
  }
  return out;
}

export function describeTapHeal(step: TapHealStep, facts: (cardId: string) => CardFacts): string {
  const card = `«${facts(step.source.cardId).name}»`;
  return step.listener.die ? t("trigger.echo", { card, die: step.listener.die, m: step.listener.atLeast ?? 0, n: step.listener.amount }) : t("trigger.tap.heal", { card, n: step.listener.amount });
}

/** Il riferimento della tappata: la fonte, l'evento, l'Entità tappata. */
export function tapHealRef(step: TapHealStep): EffectRef {
  return { source: step.source.uid, event: "on_tap", entering: step.target.uid };
}

/** Esegue il guadagno di PV della tappata: una patch dei PV marcata dalla tappata, col tiro se la forma lo vuole. */
export async function resolveTapHeal(ctx: Ctx, step: TapHealStep, roll: number | null): Promise<boolean> {
  const by = controllerOf(step.source);
  const hp = ctx.state().players[by].hp + step.listener.amount;
  const passed = await ctx.dispatch({ t: "player", seat: by, patch: { hp }, ...(roll !== null ? { roll } : {}), effect: tapHealRef(step) });
  if (passed) ctx.log(msg("log.effect.tap.heal", { seat: by, sourceCard: step.source.cardId, card: step.target.cardId, n: step.listener.amount, hp: ctx.state().players[by].hp }), by);
  return passed;
}

export function describePeek(step: EnterPeekStep, facts: (cardId: string) => CardFacts): string {
  return t("trigger.peek", { card: `«${facts(step.source.cardId).name}»` });
}

/** Il riferimento dello sguardo in cima: la Statica, l'ingresso, e il seguito `peek` che lo distingue dalla pesca. */
export function peekRef(step: EnterPeekStep): EffectRef {
  return { source: step.source.uid, event: "on_enter_field", entering: step.entering.uid, follow: "peek" };
}

/** Esegue lo sguardo: la carta resta in cima (`keep`) o va in fondo. Un `look` di una carta, marcato col seguito `peek`. */
export async function resolvePeek(ctx: Ctx, step: EnterPeekStep, keep: boolean): Promise<boolean> {
  const by = controllerOf(step.source);
  if (!step.top) return false;
  const passed = await ctx.dispatch({ t: "look", seat: by, count: 1, restTo: "deck", ...(keep ? { top: step.top.uid } : {}), effect: peekRef(step) });
  if (passed) ctx.log(msg("log.effect.peek", { seat: by, sourceCard: step.source.cardId, what: msg(keep ? "look.kept" : "look.bottomed") }), by);
  return passed;
}

/** La riga che annuncia un innesco, per la scena e per la chat. */
export function describeTrigger(trigger: EnterTrigger, facts: (cardId: string) => CardFacts): string {
  if (trigger.heal) return t("trigger.tide", { card: `«${facts(trigger.source.cardId).name}»`, n: trigger.heal });
  const n = trigger.draw;
  return t("trigger.draw", { card: `«${facts(trigger.source.cardId).name}»`, n, cards: cardsWord(n) });
}

/**
 * Risolve UN innesco d'ingresso: la pesca marcata come effetto. Il «no»
 * dell'engine ferma il passo e basta. Dice se è passato: chi lo chiama
 * (il tavolo) accende la fonte prima e la spegne dopo, così il ritmo —
 * accesa, pesca, spenta — è del tavolo, non di qui.
 */
export async function resolveTrigger(ctx: Ctx, entering: CardInstance, trigger: EnterTrigger): Promise<boolean> {
  // «Ogni volta che un'altra Entità entra sul tuo Fronte, guadagni N PV» (dal 2026-10-23): una patch dei PV marcata dall'ingresso.
  if (trigger.heal) {
    const by = controllerOf(entering);
    const hp = ctx.state().players[by].hp + trigger.heal;
    const healed = await ctx.dispatch({ t: "player", seat: by, patch: { hp }, effect: { source: trigger.source.uid, event: "on_enter_field", entering: entering.uid } });
    if (healed) ctx.log(msg("log.effect.tide", { seat: by, sourceCard: trigger.source.cardId, card: entering.cardId, n: trigger.heal, hp: ctx.state().players[by].hp }), by);
    return healed;
  }
  const passed = await ctx.dispatch({
    t: "draw",
    seat: controllerOf(entering),
    count: trigger.draw,
    effect: { source: trigger.source.uid, event: "on_enter_field", entering: entering.uid },
  });
  if (passed) {
    ctx.log(
      msg("log.effect.trigger", { seat: controllerOf(entering), card: trigger.source.cardId, n: trigger.draw, cards: msg(trigger.draw === 1 ? "cards.one" : "cards.many") }),
      controllerOf(entering)
    );
  }
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

/** Un controllo all'ingresso da risolvere: chi entra, cosa concede, fra chi si sceglie. */
export interface EnterControlStep {
  source: CardInstance;
  grants: string[];
  candidates: CardInstance[];
}

/**
 * I controlli di chi entra (§8.2, la forma di RBF-009): i candidati sono le
 * Entità comandate dall'avversario, in campo, col costo di Flusso entro il
 * limite (costo ignoto: no).
 */
export function enterControls(state: GameState, entering: CardInstance, facts: (cardId: string) => CardFacts): EnterControlStep[] {
  const by = controllerOf(entering);
  return facts(entering.cardId).enterControls.map(control => ({
    source: entering,
    grants: control.grants,
    candidates: fieldCards(state).filter(card => {
      if (controllerOf(card) === by) return false;
      const f = facts(card.cardId);
      if (f.kind !== control.target.kind) return false;
      if (control.target.maxCost === null) return true;
      return f.fluxCost !== null && f.fluxCost <= control.target.maxCost;
    }),
  }));
}

/** Un disarmo all'ingresso da risolvere (§8.2): la fonte e gli Oggetti avversari assegnati, in campo. */
export interface EnterDisarmStep {
  source: CardInstance;
  to: "ritiro";
  candidates: CardInstance[];
}

/**
 * I disarmi di chi entra (§8.2, dal 2026-09-10): ogni Oggetto in campo
 * assegnato a un'Entità comandata dall'avversario. Senza Oggetti l'effetto
 * non ha su cosa agire, ma il riarmo che segue vale lo stesso.
 */
export function enterDisarms(state: GameState, entering: CardInstance, facts: (cardId: string) => CardFacts): EnterDisarmStep[] {
  const by = controllerOf(entering);
  return facts(entering.cardId).enterDisarms.map(disarm => ({
    source: entering,
    to: disarm.to,
    candidates: fieldCards(state).filter(card => {
      if (facts(card.cardId).kind !== "object" || !card.assignedTo) return false;
      const bearer = state.cards[card.assignedTo];
      return bearer !== undefined && bearer.zone === "field" && controllerOf(bearer) !== by;
    }),
  }));
}

/** Un Oggetto disarmato: nella Zona di Ritiro del suo proprietario, marcato come effetto. */
export async function resolveDisarm(ctx: Ctx, step: EnterDisarmStep, object: CardInstance): Promise<boolean> {
  const passed = await ctx.dispatch({
    t: "toZone",
    uid: object.uid,
    zone: step.to,
    effect: { source: step.source.uid, event: "on_enter_field", entering: step.source.uid, follow: "disarm" },
  });
  if (passed) ctx.log(msg("log.effect.disarm", { seat: controllerOf(step.source), sourceCard: step.source.cardId, card: object.cardId }), controllerOf(step.source));
  return passed;
}

/** Uno scarto d'Oggetto all'ingresso da risolvere (§8.2): la fonte e gli Oggetti nella mano di chi la comanda. */
export interface EnterStashStep {
  source: CardInstance;
  to: EnterStash["to"];
  thenDraw: number;
  candidates: CardInstance[];
}

/**
 * Gli scarti d'Oggetto di chi entra (§8.2, dal 2026-09-15): «puoi mettere
 * un Oggetto dalla tua mano nella tua Zona di Ritiro. Se lo fai, pesca una
 * carta». I candidati sono gli Oggetti nella mano di chi comanda la fonte.
 */
export function enterStashes(state: GameState, entering: CardInstance, facts: (cardId: string) => CardFacts): EnterStashStep[] {
  const by = controllerOf(entering);
  return facts(entering.cardId).enterStashes.map(form => ({
    source: entering,
    to: form.to,
    thenDraw: form.thenDraw,
    candidates: zoneCards(state, by, form.from).filter(card => facts(card.cardId).kind === form.kind),
  }));
}

export interface TurnStartSearchStep {
  source: CardInstance;
  /** Gli Oggetti nel mazzo di chi comanda la fonte. */
  candidates: CardInstance[];
}

/**
 * Le ricerche a inizio turno (§8.2, dal 2026-09-17): «all'inizio di ogni
 * tuo turno, se non ci sono Oggetti sul tuo Fronte, cerca nel tuo mazzo un
 * Oggetto…». Per ogni carta in campo comandata da `seat` che porta la forma,
 * se `seat` non ha Oggetti in campo: un passo coi candidati del suo mazzo.
 */
export function turnStartSearches(state: GameState, seat: Seat, facts: (cardId: string) => CardFacts): TurnStartSearchStep[] {
  const mine = fieldCards(state).filter(card => controllerOf(card) === seat);
  if (mine.some(card => facts(card.cardId).kind === "object")) return [];
  const out: TurnStartSearchStep[] = [];
  for (const source of mine) {
    if (source.facedown) continue;
    for (const form of facts(source.cardId).turnStartSearches) {
      out.push({ source, candidates: zoneCards(state, seat, form.from).filter(card => facts(card.cardId).kind === form.kind) });
    }
  }
  return out;
}

/** Il riferimento della ricerca a inizio turno: una volta per turno, la chiave porta il turno. */
export function searchRef(step: TurnStartSearchStep, turn: number): EffectRef {
  return { source: step.source.uid, event: "on_turn_start", entering: `turn:${turn}` };
}

/**
 * La carta cercata va dal mazzo alla mano (mostrata all'avversario: la chat
 * la nomina), poi il mazzo si rimescola — un `shuffle` di chi cerca, col
 * caso tirato qui come per il mulligan (§4).
 */
export async function resolveTurnStartSearch(ctx: Ctx, step: TurnStartSearchStep, card: CardInstance): Promise<boolean> {
  const by = controllerOf(step.source);
  const passed = await ctx.dispatch({ t: "toZone", uid: card.uid, zone: "hand", effect: searchRef(step, ctx.state().turn) });
  if (!passed) return false;
  ctx.log(msg("log.effect.search", { seat: by, sourceCard: step.source.cardId, card: card.cardId }), by);
  // L'ordine lo riempie il tavolo (room.rb, complete), o il client senza tavolo (session.ts, completeLocally).
  if (zoneCards(ctx.state(), by, "deck").length > 1) await ctx.dispatch({ t: "shuffle", seat: by });
  return true;
}

/** La riga che annuncia la ricerca a inizio turno, per la scena. */
export function describeTurnStartSearch(step: TurnStartSearchStep, facts: (cardId: string) => CardFacts): string {
  return t("trigger.requisition", { card: `«${facts(step.source.cardId).name}»` });
}

/** Il riferimento dello scarto d'Oggetto all'ingresso: lo scarto stesso, o la pesca che lo segue. */
export function stashRef(step: EnterStashStep, follow: "stash" | "draw"): EffectRef {
  return { source: step.source.uid, event: "on_enter_field", entering: step.source.uid, follow };
}

/** L'Oggetto scelto va dalla mano nella propria Zona di Ritiro, marcato come effetto. */
export async function resolveStash(ctx: Ctx, step: EnterStashStep, object: CardInstance): Promise<boolean> {
  const passed = await ctx.dispatch({ t: "toZone", uid: object.uid, zone: step.to, effect: stashRef(step, "stash") });
  if (passed) ctx.log(msg("log.effect.stash", { seat: controllerOf(step.source), sourceCard: step.source.cardId, card: object.cardId }), controllerOf(step.source));
  return passed;
}

/** La riga che annuncia lo scarto d'Oggetto all'ingresso, per la scena. */
export function describeStash(step: EnterStashStep, facts: (cardId: string) => CardFacts): string {
  return t("trigger.stash", { card: `«${facts(step.source.cardId).name}»` });
}

/**
 * Lo z di un Oggetto che va addosso a un'Entità: sotto di lei e sotto gli
 * Oggetti che già porta, a scaletta (come il rilascio a mano, dropZ in
 * table.ts); il -9 tiene lo z-index del DOM sopra lo zero.
 */
export function underStack(bearer: CardInstance, worn: CardInstance[]): number {
  return Math.max(-9, Math.min(bearer.z, ...worn.map(other => other.z)) - 1);
}

/** Un riarmo all'ingresso da risolvere (§8.2): la fonte; i candidati si rileggono a ogni giro. */
export interface EnterRearmStep {
  source: CardInstance;
  /** La variante su di sé: un Oggetto a chi entra, una volta. */
  self: boolean;
  /** Su di sé, «con costo di Flusso N o inferiore» (dal 2026-09-15); null senza vincolo. */
  maxCost: number | null;
}

/** I riarmi di chi entra (§8.2, dal 2026-09-10): uno per forma, a giri. */
export function enterRearms(entering: CardInstance, facts: (cardId: string) => CardFacts): EnterRearmStep[] {
  return facts(entering.cardId).enterRearms.map(form => ({ source: entering, self: form.self === true && form.any !== true, maxCost: form.self === true && form.any !== true ? form.maxCost ?? null : null }));
}

/** Gli Oggetti nella propria Zona di Ritiro (entro il costo, se c'è), e le proprie Entità in campo scoperte (solo chi entra, nella variante su di sé): fra cosa si sceglie a ogni giro del riarmo. */
export function rearmChoices(state: GameState, source: CardInstance, facts: (cardId: string) => CardFacts, onlySelf = false, maxCost: number | null = null): { objects: CardInstance[]; bearers: CardInstance[] } {
  const by = controllerOf(source);
  return {
    objects: zoneCards(state, by, "ritiro").filter(card => {
      const f = facts(card.cardId);
      return f.kind === "object" && (maxCost === null || (f.fluxCost !== null && f.fluxCost <= maxCost));
    }),
    bearers: fieldCards(state).filter(card => controllerOf(card) === by && facts(card.cardId).kind === "entity" && !card.facedown && (!onlySelf || card.uid === source.uid)),
  };
}

/** L'Oggetto va addosso all'Entità scelta, dalla Zona di Ritiro, gratis (§8.2). */
export async function resolveRearm(ctx: Ctx, step: EnterRearmStep, object: CardInstance, bearer: CardInstance): Promise<boolean> {
  const state = ctx.state();
  const live = state.cards[bearer.uid] ?? bearer;
  const worn = Object.values(state.cards).filter(other => other.assignedTo === live.uid && other.zone === "field");
  const passed = await ctx.dispatch({
    t: "toZone",
    uid: object.uid,
    zone: "field",
    x: live.x + STACK_STEP * (worn.length + 1),
    y: live.y + STACK_STEP * (worn.length + 1),
    z: underStack(live, worn),
    assignTo: live.uid,
    effect: { source: step.source.uid, event: "on_enter_field", entering: step.source.uid, follow: "rearm" },
  });
  if (passed) ctx.log(msg("log.effect.rearm", { seat: controllerOf(step.source), sourceCard: step.source.cardId, card: object.cardId, toCard: live.cardId }), controllerOf(step.source));
  return passed;
}

/** Un ritorno vincolato da offrire (§8.2): la carta uscita, e gli Oggetti fra cui scegliere. */
export interface LeaveReturnStep {
  card: CardInstance;
  maxCost: number;
  candidates: CardInstance[];
  /** Il Fronte pieno (§6.2): non torna, e il tavolo lo dice. */
  frontFull: boolean;
}

/**
 * Chi è appena uscita dal campo verso l'Abisso o la Zona di Ritiro con la
 * forma del ritorno vincolato (§8.2, dal 2026-09-10) — e senza Oggetti
 * addosso PRIMA di uscire: si confronta lo stato di prima con quello di
 * dopo. I candidati sono gli Oggetti del proprietario in Ritiro entro il
 * costo.
 */
export function leaveReturns(before: GameState, after: GameState, facts: (cardId: string) => CardFacts): LeaveReturnStep[] {
  const out: LeaveReturnStep[] = [];
  for (const card of Object.values(after.cards)) {
    if (card.zone !== "abisso" && card.zone !== "ritiro") continue;
    const was = before.cards[card.uid];
    if (!was || was.zone !== "field") continue;
    const form = facts(card.cardId).leaveReturns[0];
    if (!form) continue;
    if (sealedForPlay(after, card)) continue;
    if (Object.values(before.cards).some(other => other.assignedTo === card.uid && other.zone === "field")) continue;
    const candidates = zoneCards(after, card.owner, "ritiro").filter(object => {
      const f = facts(object.cardId);
      return f.kind === "object" && f.fluxCost !== null && f.fluxCost <= form.maxCost;
    });
    out.push({ card, maxCost: form.maxCost, candidates, frontFull: freeFrontSlotOrNull(after, card.owner) === null });
  }
  return out;
}

/** Il ritorno vincolato, eseguito: un'azione sola, calcolata qui e verificata dall'engine. */
export async function resolveLeaveReturn(ctx: Ctx, step: LeaveReturnStep, object: CardInstance, place: Placement): Promise<boolean> {
  const replaced = place.replace ? ctx.state().cards[place.replace] : undefined;
  const passed = await ctx.dispatch({
    t: "revive",
    uid: step.card.uid,
    ...place.spot,
    z: ctx.state().zTop,
    object: object.uid,
    ...(place.replace ? { replace: place.replace } : {}),
    effect: { source: step.card.uid, event: "on_leave_field", entering: step.card.uid },
  });
  if (passed) {
    ctx.log(msg("log.effect.revive", { seat: step.card.owner, card: step.card.cardId, objectCard: object.cardId }), step.card.owner);
    if (replaced) ctx.log(msg("log.effect.replace", { seat: step.card.owner, card: step.card.cardId, otherCard: replaced.cardId }), step.card.owner);
  }
  return passed;
}

/** Una stappata all'ingresso da risolvere (§8.2, RBF-011): la fonte e la forma. */
export interface EnterRefreshStep {
  source: CardInstance;
  refresh: EnterRefresh;
}

/** Le stappate di chi entra (§8.2, la forma di RBF-011): col dado, alla risoluzione. */
export function enterRefreshes(entering: CardInstance, facts: (cardId: string) => CardFacts): EnterRefreshStep[] {
  return facts(entering.cardId).enterRefreshes.map(refresh => ({ source: entering, refresh }));
}

/** La riga che annuncia una stappata all'ingresso. */
export function describeRefresh(step: EnterRefreshStep, facts: (cardId: string) => CardFacts): string {
  return t("trigger.rally", { card: `«${facts(step.source.cardId).name}»`, die: step.refresh.die, lo: step.refresh.onRoll[0], hi: step.refresh.onRoll[1] });
}

/**
 * Esegue la stappata col tiro fatto: un'azione sola, marcata come effetto,
 * anche col tiro mancato — così l'innesco si consuma e non si ripropone.
 */
export async function resolveRefresh(ctx: Ctx, step: EnterRefreshStep, roll: number): Promise<boolean> {
  const by = controllerOf(step.source);
  const untap = inRange(roll, step.refresh.onRoll);
  const passed = await ctx.dispatch({
    t: "refresh",
    seat: by,
    roll,
    untap,
    effect: { source: step.source.uid, event: "on_enter_field", entering: step.source.uid },
  });
  if (passed) {
    if (untap) ctx.log(msg("log.effect.refresh", { seat: by, sourceCard: step.source.cardId }), by);
    else ctx.log(msg("log.effect.roll", { seat: by, sourceCard: step.source.cardId, die: step.refresh.die, roll, what: msg("roll.nothing") }), by);
  }
  return passed;
}

/** La riga che annuncia un controllo. */
export function describeControl(step: EnterControlStep, facts: (cardId: string) => CardFacts): string {
  return t("trigger.control", { card: `«${facts(step.source.cardId).name}»` });
}

/** Esegue il controllo sul bersaglio scelto: un'azione sola, marcata come effetto. */
export async function resolveControl(ctx: Ctx, step: EnterControlStep, target: CardInstance): Promise<boolean> {
  const by = controllerOf(step.source);
  const passed = await ctx.dispatch({
    t: "control",
    uid: target.uid,
    by,
    grants: step.grants,
    effect: { source: step.source.uid, event: "on_enter_field", entering: step.source.uid },
  });
  if (passed) {
    ctx.log(msg("log.effect.control", { seat: by, sourceCard: step.source.cardId, card: target.cardId }), by);
  }
  return passed;
}

/**
 * La restituzione a fine turno (§8.2): ogni carta sotto controllo torna al
 * proprietario — sul suo Fronte se c'è uno slot libero, se no nella sua
 * Zona di Ritiro. «Fino alla fine del turno» è il turno in cui il controllo
 * è stato preso, chiunque comandi: anche il difensore che ha preso il
 * controllo in Reazione lo restituisce a questo cambio di turno (2026-09-17:
 * prima si restituivano solo le carte comandate da chi chiudeva, e il bot se
 * la teneva un turno intero). La manda il tavolo di chi ha chiuso il turno.
 */
export async function releaseControlled(ctx: Ctx, freeSlot: (state: GameState, owner: Seat) => { x: number; y: number } | null): Promise<void> {
  const held = Object.values(ctx.state().cards).filter(card => card.controller !== undefined && card.zone === "field");
  for (const card of held) {
    const spot = freeSlot(ctx.state(), card.owner);
    const passed = await ctx.dispatch(spot ? { t: "release", uid: card.uid, zone: "field", ...spot } : { t: "release", uid: card.uid, zone: "ritiro" });
    if (passed) {
      ctx.log(msg(spot ? "log.release.front" : "log.release.retire", { card: card.cardId, seat: card.owner }), card.owner);
    }
  }
}


// ---- Le altre forme «quando attacca» (§8.2) --------------------------------

/** Un passo d'attacco da risolvere: la fonte, chi attacca, la forma. */
export interface AttackStep {
  source: CardInstance;
  attacker: CardInstance;
  form: AttackForm;
}

/** Il riferimento d'effetto di un passo, come lo vuole l'engine. */
export function attackRef(step: AttackStep, follow?: EffectRef["follow"]): EffectRef {
  return {
    source: step.source.uid,
    event: "on_attack",
    entering: step.attacker.uid,
    ...(follow ? { follow } : {}),
    ...("once" in step.form && step.form.once ? { once: true as const } : {}),
  };
}

/** Un potenziamento di `source` già scattato per quell'attaccante (o nel turno, se «una volta»)? */
function empowerFired(state: GameState, source: CardInstance, entering: string, once: boolean): boolean {
  const tail = `|${once ? "turn" : entering}`;
  return (state.fired ?? []).some(key => key.startsWith(`${source.uid}|on_attack:empower:`) && key.endsWith(tail));
}

function firedKey(state: GameState, source: CardInstance, kind: string, entering: string, once: boolean): boolean {
  return (state.fired ?? []).includes(`${source.uid}|on_attack:${kind}|${once ? "turn" : entering}`);
}

/** Il primo attaccante di `race` di `seat` nell'ordine di dichiarazione (§6.4), o null. Gemello: engine.rb, judge_attack_empower («attacker»). */
export function firstAttackerOf(state: GameState, seat: Seat, race: string | null, facts: (cardId: string) => CardFacts): CardInstance | null {
  const mine = attackersOf(state, seat, race, facts);
  const orderOf = (uid: string): number => state.declarations.find(d => d.from === uid && d.kind === "attack")?.order ?? 0;
  return [...mine].sort((a, b) => orderOf(a.uid) - orderOf(b.uid))[0] ?? null;
}

/** Le Entità di `race` che attaccano adesso per `seat`. */
export function attackersOf(state: GameState, seat: Seat, race: string | null, facts: (cardId: string) => CardFacts): CardInstance[] {
  return state.declarations
    .filter(d => d.kind === "attack")
    .map(d => state.cards[d.from])
    .filter((card): card is CardInstance => !!card && card.zone === "field" && controllerOf(card) === seat)
    .filter(card => {
      const f = facts(card.cardId);
      return f.kind === "entity" && (race === null || f.race === race);
    });
}

/** Quante Entità di `race` di `seat` hanno attaccato nel suo turno precedente. */
export function previousAttackers(state: GameState, seat: Seat, race: string | null, facts: (cardId: string) => CardFacts): number {
  return (state.lastWave?.[seat] ?? []).filter(uid => {
    const card = state.cards[uid];
    if (!card) return false;
    const f = facts(card.cardId);
    return f.kind === "entity" && (race === null || f.race === race);
  }).length;
}

/**
 * I passi che l'attacco di `attacker` innesca, nell'ordine in cui il tavolo
 * li risolve: le forme di chi attacca, poi quelle degli Oggetti addosso,
 * poi quelle delle altre carte dello stesso posto (alleate, Materie
 * Statiche, il Rubyfront). Le condizioni si valutano qui come nella
 * dogana; ciò che è già stato risolto nel turno (una volta per turno) non
 * si ripropone. La stappata dopo il combattimento (RBF-028) è un passo
 * della risoluzione, non dell'attacco: sta a parte (vigilUntaps).
 */
export function attackSteps(state: GameState, attacker: CardInstance, facts: (cardId: string) => CardFacts): AttackStep[] {
  const seat = controllerOf(attacker);
  const attackerFacts = facts(attacker.cardId);
  const out: AttackStep[] = [];
  const consider = (source: CardInstance): void => {
    // §3.1 — il Rubyfront in Zona di Richiamo non ha abilità: si attacca,
    // ma non innesca niente finché non è schierato.
    if (!inPlay(source, facts(source.cardId).kind)) return;
    for (const form of facts(source.cardId).attackForms) {
      if (form.face !== source.face) continue;
      // «Stappala dopo il combattimento» è un passo della risoluzione
      // (vigilUntaps); quella col d20 (dal 2026-09-15) tira all'attacco.
      if (form.kind === "untap" && !("die" in form)) continue;
      const once = "once" in form && form.once === true;
      if (form.who === "self" && source.uid !== attacker.uid) continue;
      if (form.who === "object" && source.assignedTo !== attacker.uid) continue;
      if (form.who !== "self" && form.who !== "object" && controllerOf(source) !== seat) continue;
      if ("requiresObject" in form && form.requiresObject && !armed(state, source.uid)) continue;
      if ("attackerArmed" in form && form.attackerArmed && !armed(state, attacker.uid)) continue;
      if ("attackers" in form && form.attackers && !(attackerFacts.kind === form.attackers.kind && (form.attackers.race === null || attackerFacts.race === form.attackers.race))) continue;
      // «La prima volta in ogni tuo turno che un'Entità Umana attacca» (dal 2026-10-20): il PRIMO attaccante della razza nell'ondata, non un altro.
      if (form.kind === "empower" && form.targets === "attacker" && firstAttackerOf(state, seat, form.attackers?.race ?? null, facts)?.uid !== attacker.uid) continue;
      if (form.kind === "heal" && form.requiresAttackers && attackersOf(state, seat, form.requiresAttackers.race, facts).length < form.requiresAttackers.count) continue;
      // «Se almeno N Umani che controlli attaccano»: gli attaccanti dichiarati in questo turno, la fonte compresa.
      if (form.kind === "empower" && form.requiresAttackers && attackersOf(state, seat, form.requiresAttackers.race, facts).length < form.requiresAttackers.count) continue;
      if (form.kind === "empower" && form.requiresPreviousAttackers && previousAttackers(state, seat, form.requiresPreviousAttackers.race, facts) < form.requiresPreviousAttackers.count) continue;
      // La Vendetta al PROSSIMO Umano si risolve quando quello attacca (pendingGrants), non ora.
      if (form.kind === "empower" && form.targets === "next_human_attacker") continue;
      // Un potenziamento ha la chiave per bersaglio (`empower:<uid>`): se
      // per questa fonte e questo attaccante ne è già scattato uno, il passo
      // è fatto — annullare l'attacco e ridichiararlo non lo ripropone
      // (deciso 2026-09-10). Gli altri passi hanno la loro chiave.
      if (form.kind === "empower" ? empowerFired(state, source, attacker.uid, once) : firedKey(state, source, form.kind === "untap" ? "refresh" : form.kind, attacker.uid, once)) continue;
      out.push({ source, attacker, form });
    }
  };
  consider(attacker);
  for (const card of fieldCards(state)) {
    if (card.uid === attacker.uid) continue;
    if (card.assignedTo === attacker.uid) consider(card);
  }
  for (const card of fieldCards(state)) {
    if (card.uid === attacker.uid || card.assignedTo === attacker.uid) continue;
    if (controllerOf(card) !== seat) continue;
    consider(card);
  }
  return out;
}

/**
 * RBF-004: chi ha attaccato prima con «la prossima Entità Umana che attacca
 * ottiene Vendetta» e non l'ha ancora data — se `attacker` è quell'Umano
 * (il primo Umano dichiarato dopo la fonte), ecco i passi da risolvere.
 */
export function pendingGrants(state: GameState, attacker: CardInstance, facts: (cardId: string) => CardFacts): AttackStep[] {
  const seat = controllerOf(attacker);
  const f = facts(attacker.cardId);
  if (f.kind !== "entity" || f.race !== "human") return [];
  const orderOf = (uid: string): number => state.declarations.find(d => d.from === uid && d.kind === "attack")?.order ?? 0;
  const mine = orderOf(attacker.uid);
  const out: AttackStep[] = [];
  for (const source of fieldCards(state)) {
    if (source.uid === attacker.uid || controllerOf(source) !== seat) continue;
    const order = orderOf(source.uid);
    if (order === 0 || order >= mine) continue;
    for (const form of facts(source.cardId).attackForms) {
      if (form.kind !== "empower" || form.targets !== "next_human_attacker" || form.face !== source.face) continue;
      if ((state.fired ?? []).some(key => key.startsWith(`${source.uid}|on_attack:empower:`))) continue;
      const between = attackersOf(state, seat, "human", facts).some(card => card.uid !== attacker.uid && orderOf(card.uid) > order && orderOf(card.uid) < mine);
      if (between) continue;
      out.push({ source, attacker: source, form });
    }
  }
  return out;
}

/**
 * Chi si stappa dopo il combattimento, per `seat`: gli attaccanti con la forma
 * «stappala dopo il combattimento»; e, se il d20 all'attacco è riuscito
 * (`untapAfter`, dal 2026-09-15), tutte le sue Entità in campo.
 */
export function vigilUntaps(state: GameState, seat: Seat, facts: (cardId: string) => CardFacts): string[] {
  if (state.players[seat].untapAfter === state.turn) {
    return fieldCards(state)
      .filter(card => controllerOf(card) === seat && facts(card.cardId).kind === "entity" && card.tapped)
      .map(card => card.uid);
  }
  return attackersOf(state, seat, null, facts)
    .filter(card => facts(card.cardId).attackForms.some(form => form.kind === "untap" && form.face === card.face && !("die" in form) && (!form.requiresObject || armed(state, card.uid))))
    .filter(card => !(state.fired ?? []).includes(`${card.uid}|on_attack:untap|turn`))
    .map(card => card.uid);
}

/** Le altre Entità con un Oggetto assegnato che `seat` controlla (RBF-029). */
export function otherArmed(state: GameState, seat: Seat, except: string, facts: (cardId: string) => CardFacts): CardInstance[] {
  return fieldCards(state).filter(card => card.uid !== except && controllerOf(card) === seat && facts(card.cardId).kind === "entity" && armed(state, card.uid));
}

/** La riga che annuncia un passo d'attacco, per la scena. */
export function describeAttackStep(step: AttackStep, facts: (cardId: string) => CardFacts): string {
  const card = `«${facts(step.source.cardId).name}»`;
  const form = step.form;
  switch (form.kind) {
    case "untap": return "die" in form ? t("trigger.rally", { card, die: form.die, lo: form.onRoll[0], hi: form.onRoll[1] }) : t("trigger.vigil", { card });
    case "empower":
      if (form.targets === "others_armed") return t("trigger.command", { card, n: form.power ?? 0 });
      if (form.targets === "one_armed") return t("trigger.command.one", { card, n: form.power ?? 0 });
      if (form.targets === "bearer") return t("trigger.charge", { card, n: form.power ?? 0 });
      if (form.targets === "next_human_attacker") return t("trigger.avenge", { card });
      if (form.targets === "all_attackers") return t("trigger.charge.all", { card, n: form.power ?? 0 });
      if (form.targets === "attacker") return t("trigger.price", { card, n: form.power ?? 0, pay: form.payHealth ?? 0 });
      return t("trigger.raid", { card });
    case "look":
      return form.die !== null
        ? t("trigger.sift", { card, die: form.die, lo: form.onRoll?.[0] ?? 0, hi: form.onRoll?.[1] ?? 0, n: form.count })
        : t("trigger.foresight", { card, n: form.count });
    case "heal":
      if (form.who === "static") return t("trigger.heirs", { card, die: form.die ?? 0 });
      if (form.who === "rubyfront") return t(form.thenDraw ? "trigger.muster.nexus" : "trigger.muster", { card, n: form.amount });
      return t("trigger.mend", { card, n: form.amount, die: form.die ?? 0, lo: form.onRoll?.[0] ?? 0, hi: form.onRoll?.[1] ?? 0 });
    case "return": return t("trigger.recall", { card, die: form.die, lo: form.onRoll[0], hi: form.onRoll[1] });
    case "rearm": return t("trigger.rearm", { card });
    case "stash": return t("trigger.purge", { card, die: form.die, lo: form.onRoll[0], hi: form.onRoll[1] });
  }
}

/** Il tiro di un dado del passo: 1..facce. Il caso lo tira il client. */
export function rollDie(faces: number): number {
  return 1 + Math.floor(Math.random() * faces);
}

export function inRange(roll: number, range: [number, number] | null): boolean {
  return range !== null && roll >= range[0] && roll <= range[1];
}


// ---- Le Materie alla risoluzione (§7.2) e il flip del Nexus (§3.1) ----------

/** Un passo di una Materia da risolvere: la Materia, la forma, e fra chi si sceglie. */
export interface ResolveStep {
  source: CardInstance;
  form: ResolveForm;
  candidates: CardInstance[];
  /** Le carte guardate (per lo sguardo). */
  looked: CardInstance[];
  /** Perché il passo non ha su cosa agire, se è così (chiave i18n). */
  blocked: string | null;
}

/** Il riferimento d'effetto di una Materia: fonte e ingresso coincidono. */
export function resolveRef(source: CardInstance): EffectRef {
  return { source: source.uid, event: "on_resolve", entering: source.uid };
}

function resolveFired(state: GameState, source: CardInstance, step: string): boolean {
  const key = `${source.uid}|on_resolve:${step}`;
  // Un passo a prefisso («empower:») è già scattato se un bersaglio qualunque l'ha consumato.
  return (state.fired ?? []).some(fired => step.endsWith(":") ? fired.startsWith(key) : fired === `${key}|${source.uid}`);
}

/** Una carta «statica» (§10): quel che resta in campo — un'Entità o una Materia Statica, mai il Rubyfront, mai un Oggetto. */
export function staticCardOf(card: CardInstance, facts: (cardId: string) => CardFacts): boolean {
  const f = facts(card.cardId);
  return f.kind === "entity" || (f.kind === "matter" && f.behavior === "static");
}

/**
 * I passi che la Materia `source` risolve (§7.2), con i candidati di
 * ciascuno, letti dallo stato di adesso: le forme certificate del catalogo
 * (renderer.ts, resolveForms), specchio della dogana dell'engine.
 */
export function resolveSteps(state: GameState, source: CardInstance, facts: (cardId: string) => CardFacts): ResolveStep[] {
  const seat = controllerOf(source);
  const foesAndMine = fieldCards(state);
  return facts(source.cardId).resolveForms.map(form => {
    const step: ResolveStep = { source, form, candidates: [], looked: [], blocked: null };
    switch (form.kind) {
      case "look": {
        step.looked = zoneCards(state, seat, "deck").slice(0, form.count);
        step.candidates = step.looked.filter(card => {
          const f = facts(card.cardId);
          return f.kind === form.reveal.kind && (form.reveal.race === null || f.race === form.reveal.race);
        });
        if (step.looked.length === 0) step.blocked = "log.look.empty";
        break;
      }
      case "empower": {
        step.candidates = foesAndMine.filter(card => {
          const f = facts(card.cardId);
          const race = "race" in form ? form.race : null;
          return controllerOf(card) === seat && f.kind === "entity" && (race === null || f.race === race);
        });
        if (form.targets === "own_entity" && resolveFired(state, source, "empower:")) step.candidates = [];
        if (form.targets === "own_armed") {
          // «Fino a N Entità con un Oggetto assegnato che controlli»: le
          // armate non ancora potenziate, finché i passi non sono N.
          step.candidates = step.candidates.filter(card => armed(state, card.uid) && !resolveFired(state, source, `empower:${card.uid}`));
          if (resolveFiredCount(state, source, "empower:") >= form.upTo) step.candidates = [];
        }
        if (form.targets === "own_entities") {
          step.candidates = step.candidates.filter(card => !resolveFired(state, source, `empower:${card.uid}`));
          if (countEntities(state, seat, form.requires.race, facts) < form.requires.count) step.blocked = "log.no.humans";
        }
        if (step.candidates.length === 0 && !step.blocked) step.blocked = "log.no.target";
        break;
      }
      case "move": {
        step.candidates = foesAndMine.filter(card => {
          const f = facts(card.cardId);
          if (controllerOf(card) === seat || f.kind !== form.target.kind) return false;
          return form.target.maxCost === null || (f.fluxCost !== null && f.fluxCost <= form.target.maxCost);
        });
        if (step.candidates.length === 0) step.blocked = "log.no.target";
        break;
      }
      case "exile": {
        step.candidates = foesAndMine.filter(card => controllerOf(card) !== seat && staticCardOf(card, facts));
        if (step.candidates.length === 0) step.blocked = "log.no.target";
        break;
      }
      case "weaken": {
        // «Un'Entità avversaria attaccante prende −1 Potenza per ogni Entità
        // con un Oggetto assegnato che controlli»: chi attacca adesso, e
        // senza armate proprie l'effetto non toglie nulla. L'indebolimento
        // secco (dal 2026-10-20) colpisce un'avversaria qualunque.
        step.candidates = foesAndMine.filter(card => controllerOf(card) !== seat && facts(card.cardId).kind === "entity" && (!form.target.attacking || state.declarations.some(d => d.from === card.uid && d.kind === "attack")));
        if (form.perArmed && armedCount(state, seat, facts) === 0) step.blocked = "log.no.armed.weaken";
        else if (step.candidates.length === 0) step.blocked = form.target.attacking ? "log.no.attacker" : "log.no.target";
        break;
      }
      case "destroy": {
        step.candidates = foesAndMine.filter(card => {
          const f = facts(card.cardId);
          if (f.kind !== "entity") return false;
          if (form.target.controller === "opponent") return controllerOf(card) !== seat;
          if (form.target.controller === "controller") return controllerOf(card) === seat;
          return true;
        });
        if (source.target) step.candidates = step.candidates.filter(card => card.uid === source.target);
        if (step.candidates.length === 0) step.blocked = "log.no.target";
        break;
      }
      case "fortune":
        break;
      case "drain": {
        // «Perde PV pari al numero di Oggetti assegnati alle Entità che
        // controlli»: senza Oggetti addosso non toglie nulla.
        if (wornObjects(state, seat) === 0) step.blocked = "log.no.objects";
        break;
      }
      case "search": {
        // La ricerca col dado: le guardate; i candidati li decide il tiro,
        // dopo (searchCandidates).
        step.looked = zoneCards(state, seat, "deck").slice(0, form.count);
        step.candidates = step.looked;
        if (step.looked.length === 0) step.blocked = "log.look.empty";
        break;
      }
      case "block": {
        // la Reattiva bloccante (forma `block`) — il blocco è la giocata stessa (§6.4, la Reattiva come
        // bloccante); il passo è la cura, «se sul tuo Fronte ci sono
        // almeno N Entità con un Oggetto assegnato».
        if (armedCount(state, seat, facts) < form.requiresArmed) step.blocked = "log.no.armed";
        break;
      }
      case "freeze": {
        // «Metti un'Entità avversaria in Stasi» (§8.1, dal 2026-10-22): le
        // avversarie non ancora in Stasi che si possono tappare, una per
        // passo, fino al conto.
        step.candidates = foesAndMine.filter(card => controllerOf(card) !== seat && freezable(card, facts) && !resolveFired(state, source, `freeze:${card.uid}`));
        if (resolveFiredCount(state, source, "freeze:") >= form.count) step.candidates = [];
        if (step.candidates.length === 0) step.blocked = "log.no.stasis.target";
        break;
      }
      case "search_objects": {
        // La ricerca di Oggetti (dal 2026-10-22): gli Oggetti del proprio
        // mazzo, finché i passi non sono N; poi il dado, se c'è un'Entità da
        // armare. Senza Oggetti nel mazzo né Entità in campo non c'è nulla da fare.
        // La variante in Ritiro (dal 2026-10-23) filtra per costo.
        step.looked = zoneCards(state, seat, "deck");
        step.candidates = step.looked.filter(card => {
          const f = facts(card.cardId);
          if (f.kind !== "object") return false;
          const maxCost = "maxCost" in form ? form.maxCost : null;
          return maxCost === null || (f.fluxCost !== null && f.fluxCost <= maxCost);
        });
        if (resolveFiredCount(state, source, "search:") >= form.upTo) step.candidates = [];
        if (step.candidates.length === 0 && countEntities(state, seat, null, facts) === 0) step.blocked = "log.search.none";
        break;
      }
      case "sentence": {
        // La sentenza del dado (dal 2026-10-23): un'Entità avversaria in campo.
        step.candidates = foesAndMine.filter(card => controllerOf(card) !== seat && facts(card.cardId).kind === "entity");
        if (step.candidates.length === 0) step.blocked = "log.no.target";
        break;
      }
      case "exile_timed": {
        // L'esilio a tempo (§8.2, dal 2026-10-22): un'Entità avversaria in campo.
        step.candidates = foesAndMine.filter(card => controllerOf(card) !== seat && facts(card.cardId).kind === "entity");
        if (step.candidates.length === 0) step.blocked = "log.no.target";
        break;
      }
    }
    return step;
  });
}

/** Un'Entità può entrare in Stasi per effetto (§8.1): è un'Entità in campo, non già in Stasi, e non «non si tappa mai». Gemello: engine.rb, freeze_stopped. */
export function freezable(card: CardInstance, facts: (cardId: string) => CardFacts): boolean {
  const f = facts(card.cardId);
  return card.zone === "field" && f.kind === "entity" && !card.stasis && !f.staticForms.some(form => form.kind === "never_taps");
}

/** Le Entità di `seat` in campo con un Oggetto addosso (§3.1). Gemello: table.rb, armed_uids. */
export function armedCount(state: GameState, seat: Seat, facts: (cardId: string) => CardFacts): number {
  return fieldCards(state).filter(card => controllerOf(card) === seat && facts(card.cardId).kind === "entity" && armed(state, card.uid)).length;
}

/** Gli Oggetti assegnati alle Entità che `seat` comanda, in campo (§3.1). Gemello: engine.rb, worn_objects. */
export function wornObjects(state: GameState, seat: Seat): number {
  const field = fieldCards(state);
  return field.filter(card => card.assignedTo && field.some(bearer => bearer.uid === card.assignedTo && controllerOf(bearer) === seat)).length;
}

/** Il primo passo non ancora risolto di quella Materia (o null). */
export function pendingResolve(state: GameState, source: CardInstance, facts: (cardId: string) => CardFacts): ResolveStep[] {
  return resolveSteps(state, source, facts).filter(step => {
    switch (step.form.kind) {
      case "look": return !resolveFired(state, source, "look");
      // Lo spostamento in Ritiro ha la chiave «move»; quello nell'Abisso (dal 2026-10-20) la stessa della distruzione («destroy»): è la zona a dirlo (attackKey).
      case "move": return !resolveFired(state, source, step.form.to === "abisso" ? "destroy" : "move");
      case "exile": return !resolveFired(state, source, "exile");
      case "weaken": return !resolveFired(state, source, "empower:");
      case "drain": return !resolveFired(state, source, "heal");
      case "search": return !resolveFired(state, source, "look");
      case "destroy": return !resolveFired(state, source, "destroy") || (step.form.thenLose !== null && !resolveFired(state, source, "heal"));
      case "fortune": return !resolveFired(state, source, "heal") && !resolveFired(state, source, "draw") && !resolveFired(state, source, "deploy");
      case "block": return !resolveFired(state, source, "heal");
      case "empower": return step.candidates.length > 0 || step.blocked !== "log.no.target";
      case "freeze": return step.candidates.length > 0 || step.blocked !== "log.no.stasis.target";
      // La ricerca: finché c'è un Oggetto da trovare entro il conto, e poi il dado del riarmo (il tiro del tavolo per la chiave «rearm»), se c'è un'Entità da armare.
      case "search_objects": {
        const rolled = state.rolls?.[rollKey({ effect: { ...resolveRef(source), follow: "rearm" } })] !== undefined;
        return step.candidates.length > 0 || (!rolled && countEntities(state, controllerOf(source), null, facts) > 0);
      }
      case "exile_timed": return !resolveFired(state, source, "move");
      case "sentence": return !resolveFired(state, source, "destroy") && !resolveFired(state, source, "empower:");
    }
  });
}

/** La riga che annuncia un passo di una Materia, per la scena. */
export function describeResolveStep(step: ResolveStep, facts: (cardId: string) => CardFacts): string {
  const card = `«${facts(step.source.cardId).name}»`;
  const form = step.form;
  switch (form.kind) {
    case "look": return t("trigger.lure", { card, n: form.count });
    case "empower":
      return form.targets === "own_entity"
        ? "counter" in form
          ? t("trigger.will", { card, n: form.counter })
          : t("trigger.formation", { card, n: form.power })
        : form.targets === "own_armed"
          ? t("trigger.amplify", { card, n: form.upTo, m: form.power })
          : t("trigger.coordinate", { card, n: form.requires.count, m: form.counter });
    case "move": return form.to === "abisso" ? t("trigger.blow", { card }) : form.target.maxCost === null ? t("trigger.sunder", { card }) : t("trigger.impact", { card, n: form.target.maxCost });
    case "exile": return t("trigger.repulse", { card });
    case "weaken": return form.perArmed ? t("trigger.refract", { card, n: -form.amount }) : t("trigger.falter", { card, n: -form.amount });
    case "fortune": return t("trigger.fortune", { card, die: form.die });
    case "destroy": return form.thenLose === null ? t("trigger.judgment", { card }) : t("trigger.evert", { card, n: form.thenLose });
    case "drain": return t("trigger.assault", { card });
    case "search": return t("trigger.search", { card, n: form.count, die: form.die });
    case "block": return t("trigger.reflect", { card, n: form.requiresArmed, m: form.heal });
    case "freeze": return t("trigger.chill", { card });
    case "search_objects":
      return "to" in form
        ? t("trigger.quest.retire", { card, n: form.maxCost ?? 0, die: form.thenRoll.die, m: form.thenRoll.atLeast })
        : t("trigger.quest", { card, n: form.upTo, die: form.thenRoll.die, m: form.thenRoll.atLeast });
    case "exile_timed": return t("trigger.undertow", { card, n: form.turns, die: form.die, m: form.returnAtLeast });
    case "sentence": return t("trigger.sentence", { card, die: form.die, n: -form.elsePower });
  }
}

/** Il tipo di carta che la ricerca col dado può mostrare con quel tiro, e le guardate di quel tipo. */
export function searchCandidates(form: Extract<ResolveForm, { kind: "search" }>, looked: CardInstance[], roll: number, facts: (cardId: string) => CardFacts): { type: "matter" | "object" | "entity" | null; candidates: CardInstance[] } {
  const type = (["matter", "object", "entity"] as const).find(candidate => {
    const range = form.bands[candidate];
    return range && roll >= range[0] && roll <= range[1];
  }) ?? null;
  return { type, candidates: type ? looked.filter(card => facts(card.cardId).kind === type) : [] };
}

/** La Potenza che l'indebolimento toglie adesso: −1 per ogni armata di `seat`. Gemello: engine.rb, judge_resolve_weaken. */
export function weakenAmount(state: GameState, seat: Seat, form: Extract<ResolveForm, { kind: "weaken" }>, facts: (cardId: string) => CardFacts): number {
  return form.perArmed ? form.amount * armedCount(state, seat, facts) : form.amount;
}

/** Dopo l'indebolimento secco: l'Entità colpita va in Ritiro se la sua Potenza di adesso è entro la soglia (dal 2026-10-20). Gemello: engine.rb, judge_resolve_sink. */
export function sinks(state: GameState, target: CardInstance, form: Extract<ResolveForm, { kind: "weaken" }>, facts: (cardId: string) => CardFacts): boolean {
  if (form.perArmed) return false;
  const live = state.cards[target.uid];
  if (!live || live.zone !== "field") return false;
  const power = powerOf(live, facts, state);
  return power !== null && power <= form.thenRetireAtMost;
}

/** Quanti passi di quel prefisso la Materia ha già risolto («fino a N Entità»). */
function resolveFiredCount(state: GameState, source: CardInstance, step: string): number {
  return (state.fired ?? []).filter(fired => fired.startsWith(`${source.uid}|on_resolve:${step}`)).length;
}

/**
 * Quanto costa giocare la Materia adesso: il costo stampato, meno lo sconto
 * «se bersaglia un'Entità tappata» (RBF-021, col bersaglio dichiarato) o
 * quello «se sul tuo Fronte ci sono almeno N Entità con un Oggetto» (lo
 * spostamento scontato, guardando il Fronte di chi la gioca). Gemello:
 * engine.rb, discount_for.
 */
export function discountedCost(state: GameState, card: CardInstance, target: CardInstance | null, facts: (cardId: string) => CardFacts): number | null {
  const f = facts(card.cardId);
  if (f.fluxCost === null) return null;
  const armedForm = f.resolveForms.find((candidate): candidate is Extract<ResolveForm, { kind: "move" }> => candidate.kind === "move" && candidate.discount !== null);
  if (armedForm?.discount && armedCount(state, controllerOf(card), facts) >= armedForm.discount.ifArmedAtLeast) return Math.max(0, f.fluxCost - armedForm.discount.amount);
  const form = f.resolveForms.find((candidate): candidate is Extract<ResolveForm, { kind: "destroy" }> => candidate.kind === "destroy" && candidate.discount !== null);
  if (!form || !form.discount || !target) return f.fluxCost;
  const live = state.cards[target.uid];
  const tapped = !!live && live.zone === "field" && live.tapped && facts(live.cardId).kind === "entity";
  return tapped ? Math.max(0, f.fluxCost - form.discount.amount) : f.fluxCost;
}

/** Un innesco «quando assegni questa carta a un'Entità» da risolvere (§3.1): l'Oggetto, il portatore, la forma. */
export interface AssignStep {
  /** Chi porta la forma: l'Oggetto (esilio) o l'Entità che lo riceve (pesca). */
  source: CardInstance;
  object: CardInstance;
  bearer: CardInstance;
  form: AssignForm;
}

/** La tripla dell'innesco: fonte e ingresso sono l'uno l'altro — l'Oggetto con l'Entità, l'Entità con l'Oggetto. */
export function assignRef(step: AssignStep): EffectRef {
  const entering = step.form.kind === "exile" || step.form.kind === "wake" ? step.bearer.uid : step.object.uid;
  return { source: step.source.uid, event: "on_assign_object", entering, ...(step.form.kind === "ends" ? { once: true as const } : {}) };
}

/** Lo sconto d'assegnazione di un portatore («gli Oggetti che assegni a questa Entità costano N in meno», statico `assign_discount`). */
export function assignDiscountOf(bearer: CardInstance, facts: (cardId: string) => CardFacts): number {
  return facts(bearer.cardId).staticForms.reduce((sum, form) => sum + (form.kind === "assign_discount" ? form.amount : 0), 0);
}

/** Quanto costa giocare l'Oggetto dalla mano sul portatore già scelto: il costo stampato meno lo sconto d'assegnazione del portatore, fino a 0 (§3.2: «se una carta te lo azzera, la prendi», dal 2026-09-15). Gemello: engine.rb, assign_discount_for. */
export function objectCost(state: GameState, card: CardInstance, facts: (cardId: string) => CardFacts): number | null {
  const printed = facts(card.cardId).fluxCost;
  if (printed === null) return null;
  const bearer = card.assignedTo ? state.cards[card.assignedTo] : undefined;
  if (!bearer || bearer.zone !== "field") return printed;
  const discount = assignDiscountOf(bearer, facts);
  return discount > 0 ? Math.max(0, printed - discount) : printed;
}

/**
 * Il costo MIGLIORE di un Oggetto in mano, prima di scegliere il portatore
 * (2026-09-15, «non c'è nessuna indicazione sulla carta Oggetto»): il
 * costo stampato meno lo sconto più alto fra le Entità in campo che
 * comanda chi lo possiede, fino a 0 (§3.2). È ciò che la carta in mano
 * mostra e ciò che decide se è pagabile; il costo vero lo dice objectCost
 * sul portatore scelto.
 */
export function bestObjectCost(state: GameState, card: CardInstance, facts: (cardId: string) => CardFacts): number | null {
  const printed = facts(card.cardId).fluxCost;
  if (printed === null) return null;
  let best = 0;
  for (const other of fieldCards(state)) {
    if (controllerOf(other) !== card.owner || facts(other.cardId).kind !== "entity") continue;
    best = Math.max(best, assignDiscountOf(other, facts));
  }
  return best > 0 ? Math.max(0, printed - best) : printed;
}

/**
 * Gli inneschi d'assegnazione appena avvenuti (§3.1, §8.2): fra `before` e
 * `after`, ogni Oggetto con una forma certificata che ora è in campo
 * assegnato a un'Entità in campo — e prima non lo era, o lo era a un'altra
 * — innesca, se non l'ha già fatto per quel portatore. Li offre main.ts
 * dopo ogni azione applicata, come per il ritorno vincolato.
 */
export function assignSteps(before: GameState, after: GameState, facts: (cardId: string) => CardFacts): AssignStep[] {
  const out: AssignStep[] = [];
  const fired = (source: string, entering: string): boolean =>
    (after.fired ?? []).some(key => key.startsWith(`${source}|on_assign_object:`) && key.endsWith(`|${entering}`));
  for (const card of Object.values(after.cards)) {
    if (card.zone !== "field" || !card.assignedTo) continue;
    const bearer = after.cards[card.assignedTo];
    if (!bearer || bearer.zone !== "field") continue;
    const was = before.cards[card.uid];
    if (was && was.zone === "field" && was.assignedTo === card.assignedTo) continue;
    // Le forme dell'Oggetto (fonte l'Oggetto, ingresso il portatore)…
    for (const form of facts(card.cardId).assignForms) {
      if (form.kind === "exile" && !fired(card.uid, bearer.uid)) out.push({ source: card, object: card, bearer, form });
      // «Se l'Entità a cui assegni questo Oggetto era in Stasi, toglila» (dal 2026-10-22): solo se lo era.
      if (form.kind === "wake" && bearer.stasis === true && !fired(card.uid, bearer.uid)) out.push({ source: card, object: card, bearer, form });
    }
    // …e quelle dell'Entità che lo riceve (fonte l'Entità, ingresso l'Oggetto)…
    for (const form of facts(bearer.cardId).assignForms) {
      if (form.kind === "draw" && !fired(bearer.uid, card.uid)) out.push({ source: bearer, object: card, bearer, form });
    }
    // …e quella del Rubyfront/Nexus schierato di chi comanda il portatore,
    // sulla faccia in vista, la prima volta nel turno (fonte il Rubyfront,
    // ingresso l'Oggetto, chiave del turno).
    const seat = controllerOf(bearer);
    if (after.active !== seat) continue;
    for (const rubyfront of fieldCards(after)) {
      if (rubyfront.owner !== seat) continue;
      const f = facts(rubyfront.cardId);
      if (f.kind !== "rubyfront" || !inPlay(rubyfront, f.kind)) continue;
      for (const form of f.assignForms) {
        if (form.kind !== "ends" || form.face !== rubyfront.face) continue;
        if ((after.fired ?? []).some(key => key.startsWith(`${rubyfront.uid}|on_assign_object:ends|`))) continue;
        out.push({ source: rubyfront, object: card, bearer, form });
      }
    }
  }
  return out;
}

/** Gli estremi del mazzo di `seat`: la prima e l'ultima carta (la stessa, se è una sola; nessuna a mazzo vuoto). */
export function deckEnds(state: GameState, seat: Seat): { top: CardInstance; bottom: CardInstance } | null {
  const deck = zoneCards(state, seat, "deck");
  if (deck.length === 0) return null;
  return { top: deck[0], bottom: deck[deck.length - 1] };
}

/** Un Oggetto «quando quell'Entità muore» da risolvere (§8.2): l'Oggetto appena finito nell'Abisso, l'Entità morta, la forma. */
export interface DeathStep {
  object: CardInstance;
  bearer: CardInstance;
  form: DeathForm;
}

export function deathRef(step: DeathStep, follow?: "rearm"): EffectRef {
  return { source: step.object.uid, event: "on_death", entering: step.bearer.uid, ...(follow ? { follow } : {}) };
}

/**
 * Gli Oggetti con la forma «quando quell'Entità muore» appena usciti dal
 * campo con la loro Entità morta (fra `before` e `after`: l'Oggetto era in
 * campo addosso a lei; ora lei è nell'Abisso e l'Oggetto in Zona di Ritiro,
 * dove gli Oggetti vanno sempre dal 2026-09-13, §3.1). Li offre la sessione
 * dopo ogni azione applicata, come il ritorno vincolato.
 */
export function deathSteps(before: GameState, after: GameState, facts: (cardId: string) => CardFacts): DeathStep[] {
  const out: DeathStep[] = [];
  for (const object of Object.values(after.cards)) {
    if (object.zone !== "ritiro") continue;
    const was = before.cards[object.uid];
    if (!was || was.zone !== "field" || !was.assignedTo) continue;
    const form = facts(object.cardId).deathForms.find(candidate => candidate.kind === "remain");
    if (!form) continue;
    const bearer = after.cards[was.assignedTo];
    const bearerWas = before.cards[was.assignedTo];
    if (!bearer || bearer.zone !== "abisso" || !bearerWas || bearerWas.zone !== "field") continue;
    if ((after.fired ?? []).includes(`${object.uid}|on_death|${bearer.uid}`)) continue;
    out.push({ object, bearer, form });
  }
  return out;
}

/** Dopo il «resta»: gli altri Oggetti in Ritiro del proprietario, e le sue Entità senza Oggetto in campo. */
export function rearmAfterDeath(state: GameState, step: DeathStep, facts: (cardId: string) => CardFacts): { objects: CardInstance[]; bearers: CardInstance[] } {
  const seat = step.object.owner;
  return {
    objects: zoneCards(state, seat, "ritiro").filter(card => card.uid !== step.object.uid && facts(card.cardId).kind === "object"),
    bearers: fieldCards(state).filter(card => controllerOf(card) === seat && facts(card.cardId).kind === "entity" && !card.facedown && !armed(state, card.uid)),
  };
}

/** I bersagli di un innesco d'assegnazione, letti dallo stato di adesso. */
export function assignCandidates(state: GameState, step: AssignStep, facts: (cardId: string) => CardFacts): CardInstance[] {
  const seat = controllerOf(step.source);
  return fieldCards(state).filter(card => controllerOf(card) !== seat && facts(card.cardId).kind === "entity");
}

export function describeAssignStep(step: AssignStep, facts: (cardId: string) => CardFacts): string {
  const card = `«${facts(step.source.cardId).name}»`;
  const form = step.form;
  if (form.kind === "exile") return t("trigger.confine", { card });
  if (form.kind === "wake") return t("trigger.rouse", { card });
  if (form.kind === "draw") return t("trigger.carry", { card, n: form.count });
  return "swap" in form ? t("trigger.ends.swap", { card, n: form.thenDraw, m: form.thenDiscard }) : t("trigger.ends.pick", { card });
}

export function describeDeathStep(step: DeathStep, facts: (cardId: string) => CardFacts): string {
  return t("trigger.remain", { card: `«${facts(step.object.cardId).name}»` });
}

/**
 * La Materia «si gioca come bloccante di un'Entità attaccante» (§6.4):
 * sostituisce il bloccante, in Reazione. Solo la Reattiva bloccante (forma `block`). Una Reattiva che non
 * dice cosa blocca (RBF-020) non blocca nulla — decisione del designer,
 * 2026-09-05: si gioca in Reazione come ogni Reattiva del difensore, e il
 * suo effetto (stappa gli Umani, Contrattacco +1) è tutto quel che fa.
 */
export function playsAsBlock(facts: CardFacts): boolean {
  return facts.resolveForms.some(form => "asBlock" in form && form.asBlock);
}

/** La Materia, giocata, ferma un attaccante — e quindi ne sceglie uno (§6.4): solo la Reattiva bloccante (forma `block`). */
export function blocksAttacker(facts: CardFacts): boolean {
  return facts.resolveForms.some(form => form.kind === "block");
}

/** La Materia chiede un bersaglio già giocandola (RBF-021: lo sconto lo decide lui)? */
export function wantsTargetOnPlay(facts: CardFacts): boolean {
  return facts.resolveForms.some(form => form.kind === "destroy" && form.discount !== null);
}

/** Le carte che `holder` tiene nell'Abisso (RBF-018). */
export function heldBy(state: GameState, holderUid: string): CardInstance[] {
  return Object.values(state.cards).filter(card => card.heldBy === holderUid && card.zone === "abisso");
}

/**
 * Le carte tenute nell'Abisso da chi non è più in gioco (RBF-018: «quando
 * questa carta lascia il gioco, quella carta statica torna in gioco»): tornano
 * al proprietario — sul suo Fronte in uno slot libero (le Materie nella
 * loro fila), o nella sua Zona di Ritiro se è pieno. La manda il tavolo
 * che ha visto uscire chi le teneva.
 */
export async function releaseHeld(
  ctx: Ctx,
  freeSlot: (state: GameState, owner: Seat) => { x: number; y: number } | null,
  matterSpotOf: (state: GameState, owner: Seat) => { x: number; y: number }
): Promise<void> {
  const state = ctx.state();
  const orphans = Object.values(state.cards).filter(card => card.heldBy && card.zone === "abisso" && state.cards[card.heldBy]?.zone !== "field");
  for (const card of orphans) {
    const kind = ctx.card(card.cardId).kind;
    const spot = kind === "matter" ? matterSpotOf(ctx.state(), card.owner) : freeSlot(ctx.state(), card.owner);
    const passed = await ctx.dispatch(spot ? { t: "release", uid: card.uid, zone: "field", ...spot } : { t: "release", uid: card.uid, zone: "ritiro" });
    if (passed) ctx.log(msg(spot ? "log.held.back" : "log.held.retire", { card: card.cardId, seat: card.owner }), card.owner);
  }
}

/** Un passo del flip da risolvere («quando flippa», RBF-001). */
export interface FlipStep {
  source: CardInstance;
  form: FlipForm;
  candidates: CardInstance[];
}

export function flipRef(source: CardInstance): EffectRef {
  return { source: source.uid, event: "on_flip", entering: source.uid };
}

/**
 * Le carte che il passo «mettila nell'Abisso» prende adesso: la carta
 * nominata sul Fronte di chi comanda il Nexus. Si legge dallo stato vivo
 * al momento del passo, per contenuto della forma e non per riferimento:
 * `ctx.card` ricostruisce le forme a ogni chiamata, quindi due letture
 * della stessa forma non sono mai lo stesso oggetto.
 */
export function flipCandidates(state: GameState, source: CardInstance, form: FlipForm): CardInstance[] {
  if (form.kind !== "move") return [];
  const seat = controllerOf(source);
  return fieldCards(state).filter(card => card.cardId === form.cardId && controllerOf(card) === seat);
}

/** I passi «quando flippa» del Nexus appena flippato: la carta nominata sul proprio Fronte, e il sigillo. */
export function flipSteps(state: GameState, source: CardInstance, facts: (cardId: string) => CardFacts): FlipStep[] {
  return facts(source.cardId).flipForms.map(form => ({
    source,
    form,
    candidates: flipCandidates(state, source, form),
  }));
}

export function describeFlipStep(step: FlipStep, facts: (cardId: string) => CardFacts): string {
  const card = `«${facts(step.source.cardId).name}»`;
  if (step.form.kind === "draw") return t("trigger.flip.draw", { card, n: step.form.count });
  const named = `«${facts(step.form.cardId).name}»`;
  return step.form.kind === "move" ? t("trigger.flip.absorb", { card, named }) : t("trigger.flip.seal", { card, named });
}

/**
 * Il flip verso il Nexus (§3.1), visto dal tavolo: se il requisito
 * certificato è soddisfatto ritorna le carte fra cui scegliere lo scarto;
 * altrimenti la chiave del perché no.
 */
export function nexusCheck(state: GameState, rubyfront: CardInstance, facts: (cardId: string) => CardFacts): { ok: true; discards: CardInstance[]; retires: CardInstance[] } | { ok: false; why: string; n?: number } {
  const nexus = facts(rubyfront.cardId).nexus;
  if (!nexus) return { ok: true, discards: [], retires: [] };
  const seat = controllerOf(rubyfront);
  for (const condition of nexus.conditions) {
    // «Controlli almeno N», o (dal 2026-10-20) «in questo turno hai attaccato con almeno N»: gli attaccanti dichiarati adesso.
    // «In questa partita hai messo in Stasi almeno N Entità avversarie» (dal 2026-10-22): le conta il tavolo.
    const have = condition.inflicted
      ? (state.players[seat].stasisInflicted ?? 0)
      : condition.armed ? armedCount(state, seat, facts) : condition.attacked ? attackersOf(state, seat, condition.race, facts).length : countEntities(state, seat, condition.race, facts);
    if (have < condition.count) return { ok: false, why: condition.inflicted ? "log.nexus.few.inflicted" : condition.armed ? "log.nexus.few.armed" : condition.attacked ? "log.nexus.few.attacking" : "log.nexus.few", n: condition.count };
  }
  // «Metti un Oggetto che controlli nella tua Zona di Ritiro, poi flippa» (dal 2026-10-22): i propri Oggetti in campo.
  const retires = nexus.retire ? fieldCards(state).filter(card => controllerOf(card) === seat && card.owner === seat && facts(card.cardId).kind === "object") : [];
  if (nexus.retire && retires.length === 0) return { ok: false, why: "log.nexus.noobject" };
  if (!nexus.discard) return { ok: true, discards: [], retires };
  const discards = zoneCards(state, seat, "hand").filter(card => {
    const f = facts(card.cardId);
    return (nexus.discard!.kind === null || f.kind === nexus.discard!.kind) && (!nexus.discard!.race || f.race === nexus.discard!.race);
  });
  if (discards.length === 0) return { ok: false, why: nexus.discard.kind === null ? "log.nexus.nocard" : "log.nexus.nodiscard" };
  return { ok: true, discards, retires };
}
