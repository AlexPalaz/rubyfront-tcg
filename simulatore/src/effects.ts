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
import type { AttackForm } from "./ctx.js";
import type { CardFacts, Ctx, EnterLook } from "./ctx.js";
import { controllerOf, fieldCards, playSpot, zoneCards } from "./state.js";
import type { CardInstance, EffectRef, GameState, Seat } from "./types.js";

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
    candidates: fieldCards(state).filter(card => controllerOf(card) !== controllerOf(entering) && facts(card.cardId).kind === move.target.kind),
  }));
}

/** Un ritorno da risolvere: la fonte, l'evento, da dove, e fra cosa si sceglie. */
export interface EnterReturnStep {
  source: CardInstance;
  event: EffectRef["event"];
  from: "ritiro";
  candidates: CardInstance[];
}

/**
 * Gli effetti «metti sul tuo Fronte una carta permanente dalla tua Zona di
 * Ritiro» (§8.2, la forma di RBF-012), all'ingresso o all'attacco: per
 * ciascuno, i candidati — le Materie permanenti nella propria Zona di
 * Ritiro.
 */
export function returnsFor(
  state: GameState,
  source: CardInstance,
  facts: (cardId: string) => CardFacts,
  event: EffectRef["event"]
): EnterReturnStep[] {
  const forms = event === "on_attack" ? facts(source.cardId).attackReturns : facts(source.cardId).enterReturns;
  return forms.map(ret => ({
    source,
    event,
    from: ret.from,
    candidates: zoneCards(state, controllerOf(source), ret.from).filter(card => {
      const f = facts(card.cardId);
      return f.kind === ret.filter.kind && f.behavior === ret.filter.behavior;
    }),
  }));
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

/** «Poi scarta una carta»: la carta scelta va nell'Abisso, come seguito dell'innesco. */
export async function resolveAttackDiscard(ctx: Ctx, step: AttackDrawStep, card: CardInstance): Promise<boolean> {
  const by = controllerOf(step.source);
  const passed = await ctx.dispatch({
    t: "toZone",
    uid: card.uid,
    zone: "abisso",
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
export async function resolveReturn(ctx: Ctx, step: EnterReturnStep, card: CardInstance): Promise<boolean> {
  const spot = playSpot(ctx.state(), card.owner, ctx.card(card.cardId).kind);
  const by = controllerOf(step.source);
  const passed = await ctx.dispatch({
    t: "toZone",
    uid: card.uid,
    zone: "field",
    ...spot,
    z: ctx.state().zTop + 1,
    effect: { source: step.source.uid, event: step.event, entering: step.source.uid },
  });
  if (passed) {
    ctx.log(msg("log.effect.return", { seat: by, sourceCard: step.source.cardId, card: card.cardId }), by);
  }
  return passed;
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
    return t("trigger.look.die", { card, die: step.look.die, base: step.look.countBase });
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
  retire: CardInstance | null = null
): Promise<boolean> {
  const by = controllerOf(step.source);
  const passed = await ctx.dispatch({
    t: "look",
    seat: by,
    count: step.count,
    ...(reveal ? { reveal: reveal.uid } : {}),
    ...(retire ? { retire: retire.uid } : {}),
    ...(step.roll !== null ? { roll: step.roll } : {}),
    effect: { source: step.source.uid, event: "on_enter_field", entering: step.source.uid },
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
  return t("trigger.retire", { card: `«${facts(step.source.cardId).name}»` });
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
    ctx.log(msg("log.effect.retire", { seat: controllerOf(step.source), sourceCard: step.source.cardId, card: target.cardId }), controllerOf(step.source));
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
  const mine = fieldCards(state).filter(card => controllerOf(card) === controllerOf(entering));
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
  return t("trigger.draw", { card: `«${facts(trigger.source.cardId).name}»`, n, cards: cardsWord(n) });
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
 * La restituzione a fine turno (§8.2): ogni carta che `seat` controllava
 * torna al proprietario — sul suo Fronte se c'è uno slot libero, se no
 * nella sua Zona di Ritiro. La manda il tavolo di chi ha chiuso il turno.
 */
export async function releaseControlled(ctx: Ctx, seat: Seat, freeSlot: (state: GameState, owner: Seat) => { x: number; y: number } | null): Promise<void> {
  const held = Object.values(ctx.state().cards).filter(card => card.controller === seat && card.zone === "field");
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

function firedKey(state: GameState, source: CardInstance, kind: string, entering: string, once: boolean): boolean {
  return (state.fired ?? []).includes(`${source.uid}|on_attack:${kind}|${once ? "turn" : entering}`);
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
 * permanenti, il Rubyfront). Le condizioni si valutano qui come nella
 * dogana; ciò che è già stato risolto nel turno (una volta per turno) non
 * si ripropone. La stappata dopo il combattimento (RBF-028) è un passo
 * della risoluzione, non dell'attacco: sta a parte (vigilUntaps).
 */
export function attackSteps(state: GameState, attacker: CardInstance, facts: (cardId: string) => CardFacts): AttackStep[] {
  const seat = controllerOf(attacker);
  const attackerFacts = facts(attacker.cardId);
  const out: AttackStep[] = [];
  const consider = (source: CardInstance): void => {
    for (const form of facts(source.cardId).attackForms) {
      if (form.face !== source.face) continue;
      if (form.kind === "untap") continue;
      const once = "once" in form && form.once === true;
      if (form.who === "self" && source.uid !== attacker.uid) continue;
      if (form.who === "object" && source.assignedTo !== attacker.uid) continue;
      if (form.who !== "self" && form.who !== "object" && controllerOf(source) !== seat) continue;
      if ("requiresObject" in form && form.requiresObject && !armed(state, source.uid)) continue;
      if ("attackerArmed" in form && form.attackerArmed && !armed(state, attacker.uid)) continue;
      if (form.kind === "heal" && form.attackers && !(attackerFacts.kind === form.attackers.kind && attackerFacts.race === form.attackers.race)) continue;
      if (form.kind === "heal" && form.requiresAttackers && attackersOf(state, seat, form.requiresAttackers.race, facts).length < form.requiresAttackers.count) continue;
      if (form.kind === "empower" && form.requiresPreviousAttackers && previousAttackers(state, seat, form.requiresPreviousAttackers.race, facts) < form.requiresPreviousAttackers.count) continue;
      // La Vendetta al PROSSIMO Umano si risolve quando quello attacca (pendingGrants), non ora.
      if (form.kind === "empower" && form.targets === "next_human_attacker") continue;
      // Un potenziamento ha la chiave per bersaglio: si ripropone solo con
      // un nuovo attacco, e basta. Gli altri passi hanno la loro chiave.
      if (form.kind !== "empower" && firedKey(state, source, form.kind, attacker.uid, once)) continue;
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

/** RBF-028: fra gli attaccanti di `seat`, chi si stappa dopo il combattimento. */
export function vigilUntaps(state: GameState, seat: Seat, facts: (cardId: string) => CardFacts): string[] {
  return attackersOf(state, seat, null, facts)
    .filter(card => facts(card.cardId).attackForms.some(form => form.kind === "untap" && form.face === card.face && (!form.requiresObject || armed(state, card.uid))))
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
    case "untap": return t("trigger.vigil", { card });
    case "empower":
      if (form.targets === "others_armed") return t("trigger.command", { card, n: form.power ?? 0 });
      if (form.targets === "bearer") return t("trigger.charge", { card, n: form.power ?? 0 });
      if (form.targets === "next_human_attacker") return t("trigger.avenge", { card });
      return t("trigger.raid", { card });
    case "look":
      return form.die !== null
        ? t("trigger.sift", { card, die: form.die, lo: form.onRoll?.[0] ?? 0, hi: form.onRoll?.[1] ?? 0, n: form.count })
        : t("trigger.foresight", { card, n: form.count });
    case "heal":
      if (form.who === "permanent") return t("trigger.heirs", { card, die: form.die ?? 0 });
      if (form.who === "rubyfront") return t(form.thenDraw ? "trigger.muster.nexus" : "trigger.muster", { card, n: form.amount });
      return t("trigger.mend", { card, n: form.amount, die: form.die ?? 0, lo: form.onRoll?.[0] ?? 0, hi: form.onRoll?.[1] ?? 0 });
    case "return": return t("trigger.recall", { card, die: form.die, lo: form.onRoll[0], hi: form.onRoll[1] });
    case "refresh": return t("trigger.charge2", { card, die: form.die, lo: form.onRoll[0], hi: form.onRoll[1] });
    case "rearm": return t("trigger.rearm", { card });
  }
}

/** Il tiro di un dado del passo: 1..facce. Il caso lo tira il client. */
export function rollDie(faces: number): number {
  return 1 + Math.floor(Math.random() * faces);
}

export function inRange(roll: number, range: [number, number] | null): boolean {
  return range !== null && roll >= range[0] && roll <= range[1];
}
