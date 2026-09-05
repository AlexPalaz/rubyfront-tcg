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
import type { AttackForm, FlipForm, ResolveForm } from "./ctx.js";
import type { CardFacts, Ctx, EnterLook, EnterRefresh } from "./ctx.js";
import { controllerOf, fieldCards, inPlay, playSpot, zoneCards, freeFrontSlotOrNull } from "./state.js";
import { countEntities } from "./combat.js";
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
  /** Il Fronte pieno ha tolto dei candidati (§6.2): il tavolo lo dice. */
  frontFull: boolean;
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
  const seat = controllerOf(source);
  // §6.2, Fronte pieno: «anche la parte d'effetto che metterebbe in campo
  // non si applica». Riguarda le sole Entità — una Materia permanente sta
  // dietro il Fronte e non occupa uno slot (§5).
  const full = freeFrontSlotOrNull(state, seat) === null;
  return forms.map(ret => {
    const permanents = zoneCards(state, seat, ret.from).filter(card => permanentOf(card, facts));
    const candidates = full ? permanents.filter(card => facts(card.cardId).kind !== "entity") : permanents;
    return {
      source,
      event,
      from: ret.from,
      candidates,
      // Il Fronte pieno ha tolto qualcosa: il tavolo lo dice, invece di
      // aprire un pannello vuoto o di tacere.
      frontFull: full && candidates.length < permanents.length,
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
  const mine = fieldCards(state).filter(card => controllerOf(card) === controllerOf(entering) && inPlay(card, facts(card.cardId).kind));
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
    // §3.1 — il Rubyfront in Zona di Richiamo non ha abilità: si attacca,
    // ma non innesca niente finché non è schierato.
    if (!inPlay(source, facts(source.cardId).kind)) return;
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

/** Una carta «permanente» (§10): quel che resta in campo — un'Entità o una Materia permanente, mai il Rubyfront, mai un Oggetto. */
export function permanentOf(card: CardInstance, facts: (cardId: string) => CardFacts): boolean {
  const f = facts(card.cardId);
  return f.kind === "entity" || (f.kind === "matter" && f.behavior === "permanent");
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
          return controllerOf(card) === seat && f.kind === "entity" && (form.race === null || f.race === form.race);
        });
        if (form.targets === "own_entity" && resolveFired(state, source, "empower:")) step.candidates = [];
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
        step.candidates = foesAndMine.filter(card => controllerOf(card) !== seat && permanentOf(card, facts));
        if (step.candidates.length === 0) step.blocked = "log.no.target";
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
      case "block": {
        // RBF-040 — il blocco è la giocata stessa (§6.4, la Reattiva come
        // bloccante); il passo è la cura, «se sul tuo Fronte ci sono
        // almeno N Entità con un Oggetto assegnato».
        if (armedCount(state, seat, facts) < form.requiresArmed) step.blocked = "log.no.armed";
        break;
      }
    }
    return step;
  });
}

/** Le Entità di `seat` in campo con un Oggetto addosso (§3.1). Gemello: table.rb, armed_uids. */
export function armedCount(state: GameState, seat: Seat, facts: (cardId: string) => CardFacts): number {
  return fieldCards(state).filter(card => controllerOf(card) === seat && facts(card.cardId).kind === "entity" && armed(state, card.uid)).length;
}

/** Il primo passo non ancora risolto di quella Materia (o null). */
export function pendingResolve(state: GameState, source: CardInstance, facts: (cardId: string) => CardFacts): ResolveStep[] {
  return resolveSteps(state, source, facts).filter(step => {
    switch (step.form.kind) {
      case "look": return !resolveFired(state, source, "look");
      case "move": return !resolveFired(state, source, "move");
      case "exile": return !resolveFired(state, source, "exile");
      case "destroy": return !resolveFired(state, source, "destroy");
      case "fortune": return !resolveFired(state, source, "heal") && !resolveFired(state, source, "draw") && !resolveFired(state, source, "deploy");
      case "block": return !resolveFired(state, source, "heal");
      case "empower": return step.candidates.length > 0 || step.blocked !== "log.no.target";
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
        ? t("trigger.formation", { card, n: form.power })
        : t("trigger.coordinate", { card, n: form.requires.count, m: form.counter });
    case "move": return t("trigger.impact", { card, n: form.target.maxCost ?? 0 });
    case "exile": return t("trigger.repulse", { card });
    case "fortune": return t("trigger.fortune", { card, die: form.die });
    case "destroy": return t("trigger.judgment", { card });
    case "block": return t("trigger.reflect", { card, n: form.requiresArmed, m: form.heal });
  }
}

/** Quanto costa giocare la Materia contro quel bersaglio (RBF-021): il costo stampato, meno lo sconto se il bersaglio è tappato. */
export function discountedCost(state: GameState, cardId: string, target: CardInstance | null, facts: (cardId: string) => CardFacts): number | null {
  const f = facts(cardId);
  if (f.fluxCost === null) return null;
  const form = f.resolveForms.find((candidate): candidate is Extract<ResolveForm, { kind: "destroy" }> => candidate.kind === "destroy" && candidate.discount !== null);
  if (!form || !form.discount || !target) return f.fluxCost;
  const live = state.cards[target.uid];
  const tapped = !!live && live.zone === "field" && live.tapped && facts(live.cardId).kind === "entity";
  return tapped ? Math.max(0, f.fluxCost - form.discount.amount) : f.fluxCost;
}

/**
 * La Materia «si gioca come bloccante di un'Entità attaccante» (§6.4):
 * sostituisce il bloccante, in Reazione. Solo RBF-040. Una Reattiva che non
 * dice cosa blocca (RBF-020) non blocca nulla — decisione del designer,
 * 2026-09-05: si gioca in Reazione come ogni Reattiva del difensore, e il
 * suo effetto (stappa gli Umani, Contrattacco +1) è tutto quel che fa.
 */
export function playsAsBlock(facts: CardFacts): boolean {
  return facts.resolveForms.some(form => "asBlock" in form && form.asBlock);
}

/** La Materia, giocata, ferma un attaccante — e quindi ne sceglie uno (§6.4): solo RBF-040. */
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
 * questa carta lascia il gioco, quel permanente torna in gioco»): tornano
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

/** I passi «quando flippa» del Nexus appena flippato: la carta nominata sul proprio Fronte, e il sigillo. */
export function flipSteps(state: GameState, source: CardInstance, facts: (cardId: string) => CardFacts): FlipStep[] {
  const seat = controllerOf(source);
  return facts(source.cardId).flipForms.map(form => ({
    source,
    form,
    candidates: form.kind === "move" ? fieldCards(state).filter(card => card.cardId === form.cardId && controllerOf(card) === seat) : [],
  }));
}

export function describeFlipStep(step: FlipStep, facts: (cardId: string) => CardFacts): string {
  const card = `«${facts(step.source.cardId).name}»`;
  const named = `«${facts(step.form.cardId).name}»`;
  return step.form.kind === "move" ? t("trigger.flip.absorb", { card, named }) : t("trigger.flip.seal", { card, named });
}

/**
 * Il flip verso il Nexus (§3.1), visto dal tavolo: se il requisito
 * certificato è soddisfatto ritorna le carte fra cui scegliere lo scarto;
 * altrimenti la chiave del perché no.
 */
export function nexusCheck(state: GameState, rubyfront: CardInstance, facts: (cardId: string) => CardFacts): { ok: true; discards: CardInstance[] } | { ok: false; why: string; n?: number } {
  const nexus = facts(rubyfront.cardId).nexus;
  if (!nexus) return { ok: true, discards: [] };
  const seat = controllerOf(rubyfront);
  for (const condition of nexus.conditions) {
    const have = countEntities(state, seat, condition.race, facts);
    if (have < condition.count) return { ok: false, why: "log.nexus.few", n: condition.count };
  }
  if (!nexus.discard) return { ok: true, discards: [] };
  const discards = zoneCards(state, seat, "hand").filter(card => nexus.discard!.kind === null || facts(card.cardId).kind === nexus.discard!.kind);
  if (discards.length === 0) return { ok: false, why: "log.nexus.nodiscard" };
  return { ok: true, discards };
}
