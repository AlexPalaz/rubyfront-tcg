// L'anagrafe del client: il catalogo delle carte e ciò che il gioco ne legge
// — nomi, testi, statistiche stampate, forme certificate degli effetti
// (`cardStats`). Specchio di engine/lib/rubyfront/card_index.rb: stesso
// campo, stessa forma, e una forma ignota resta ignota, mai fraintesa.
//
// Niente DOM: il catalogo lo consegna chi lo carica (`useCatalog`) — il
// simulatore dal sito (docs/cards/catalog.js), il gioco a modo suo. La
// grafica delle carte non sta qui: è di ciascun client.

import type { Phase } from "./types.js";
import type { AssignForm, CardFacts, DeathForm, AttackDraw, AttackForm, EnterControl, EnterDisarm, EnterListener, EnterLook, EnterRearm, EnterRefresh, EnterMove, EnterReturn, FlipForm, LeaveReturn, NexusRequirement, ResolveForm, StaticForm, Ability, AbilityForm } from "./ctx.js";

export interface CardFace {
  id: string;
  kind: "rubyfront" | "nexus" | "entity" | "object" | "matter";
  displayKey: string;
  /** Le statistiche stampate (dal file dati della carta): qui contano
      quelle del combattimento, Potenza e «Contrattacco +N» (§6.3). */
  stats?: { power?: unknown; counterattack?: unknown; health?: unknown; fluxCost?: unknown; deploymentCost?: unknown; healthRecovery?: unknown };
  /** Gli inneschi della faccia (dal file dati): qui conta l'evento
      `on_enter_field`, «quando entra sul Fronte». */
  triggers?: { event?: unknown; displayKey?: unknown; id?: unknown; details?: unknown; effect?: unknown }[];
  race?: unknown;
  /** Il comportamento di una Materia (§7.2). */
  behavior?: unknown;
  /** Le parole chiave stampate (§8.1): `{ id: "surge" }`… */
  keywords?: unknown[];
  /** I requisiti della faccia (dal file dati): qui conta `nexus`, il flip (§3.1). */
  requirements?: unknown;
}

export interface CatalogCard {
  id: string;
  faces: CardFace[];
  locales: Record<string, Record<string, any>>;
  defaultLocale: string;
  [key: string]: unknown;
}

export interface CatalogDeck {
  id: string;
  theme?: string;
  locales: Record<string, { name: string; description?: string }>;
  defaultLocale: string;
  cards: { card: string; count: number }[];
}


/** Il catalogo consegnato da `useCatalog`: vuoto finché nessuno lo carica. */
let cards: CatalogCard[] = [];
let decks: CatalogDeck[] = [];
let cardIndex = new Map<string, CatalogCard>();
let deckIndex = new Map<string, CatalogDeck>();

/** Il catalogo del set (docs/cards/catalog.json): va consegnato prima di tutto il resto. */
export function useCatalog(catalog: { cards: CatalogCard[]; decks?: CatalogDeck[] }): void {
  cards = catalog.cards;
  decks = catalog.decks ?? [];
  cardIndex = new Map(cards.map(card => [card.id, card]));
  deckIndex = new Map(decks.map(deck => [deck.id, deck]));
}

/** Il testo di una risorsa nella lingua chiesta, o in quella di casa (come card-render.js). */
export function localized(resource: { locales: Record<string, any>; defaultLocale: string }, localeId: string): any {
  return resource.locales[localeId] ?? resource.locales[resource.defaultLocale];
}

export function getCard(cardId: string): CatalogCard | undefined {
  return cardIndex.get(cardId);
}

export function allDecks(): CatalogDeck[] {
  return decks;
}

export function getDeck(deckId: string): CatalogDeck | undefined {
  return deckIndex.get(deckId);
}

/** La TINTA di una carta secondo la sua Materia (stessa regola del renderer,
    card-render.js: la Materia della carta Materia o quelle che la faccia
    abilita; Distruttiva > Dimensionale > Dinamica; senza Materia, Dinamica). */
export type Tint = "destructive" | "dimensional" | "dynamic";
const TINT_ORDER: Tint[] = ["destructive", "dimensional", "dynamic"];
export function cardTint(cardId: string): Tint {
  const card = getCard(cardId);
  const types = new Set<string>();
  for (const face of card?.faces ?? []) {
    const f = face as { enablesMatters?: { type?: string }[]; matter?: { type?: string } };
    for (const m of f.enablesMatters ?? []) if (m.type) types.add(m.type);
    if (f.matter?.type) types.add(f.matter.type);
  }
  return TINT_ORDER.find(t => types.has(t)) ?? "dynamic";
}

/** La tinta di un MAZZO: quella della maggioranza delle sue carte (copie
    comprese); a parità vince l'ordine Distruttiva > Dimensionale > Dinamica.
    Il tavolo la usa per tingere il campo di ciascun posto (deciso dal
    designer, 2026-09-09). */
export function deckTint(deckId: string): Tint {
  const deck = getDeck(deckId);
  const counts: Record<Tint, number> = { destructive: 0, dimensional: 0, dynamic: 0 };
  for (const entry of deck?.cards ?? []) counts[cardTint(entry.card)] += entry.count;
  return TINT_ORDER.reduce((best, t) => (counts[t] > counts[best] ? t : best), TINT_ORDER[0]);
}

/** Tutto il catalogo, per lo strumento di prova «Evoca». */
export function allCards(): CatalogCard[] {
  return cards;
}

export function cardName(cardId: string, locale: string): string {
  const card = getCard(cardId);
  if (!card) return cardId;
  const copy = localized(card, locale);
  return copy?.name ?? cardId;
}

/**
 * Testo cercabile di una carta: nome più il testo di tutte le facce, così
 * "cerca nel mazzo" trova anche per abilità e non solo per nome.
 */
export function cardSearchText(cardId: string, locale: string): string {
  const card = getCard(cardId);
  if (!card) return cardId;
  const copy = localized(card, locale);
  const parts: string[] = [cardId];
  const collect = (value: unknown): void => {
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(copy);
  return parts.join(" ").toLowerCase();
}

export function faceCount(cardId: string): number {
  return getCard(cardId)?.faces.length ?? 1;
}

/** Che tipo di faccia sta mostrando la carta: serve a distinguere le Entità. */
export function faceKind(cardId: string, faceIndex: number): CardFace["kind"] | null {
  const card = getCard(cardId);
  const face = card?.faces[faceIndex] ?? card?.faces[0];
  return face?.kind ?? null;
}

/**
 * Potenza e Contrattacco stampati (§6.3), dalla faccia Entità della carta:
 * `null` dove non ci sono — una Materia non ha Potenza, un'Entità senza la
 * statistica non contrattacca. Solo interi, come nell'anagrafe dell'engine:
 * un valore d'altra forma resta ignoto, mai frainteso.
 */
/** I testi degli effetti «quando attacca» di una faccia, per la scena. */
export function attackEffects(cardId: string, faceIndex: number, locale: string): { tag: string; text: string }[] {
  return effectsFor(cardId, faceIndex, locale, ["on_attack"]);
}

/** Gli eventi che «scattano» quando la carta scende: per Entità e Oggetti
    «quando entra sul Fronte»; per le Materie l'effetto si risolve giocandole
    (§7.2, `on_resolve`) o dura finché restano (`while_in_play`). */
const ENTER_EVENTS: Record<string, string[]> = {
  entity: ["on_enter_field"],
  object: ["on_enter_field"],
  matter: ["on_resolve", "while_in_play"],
};

/**
 * Gli effetti che scattano quando una carta scende dalla mano, col testo
 * nella lingua del tavolo: la targhetta (es. «Effetto») e la frase. Il
 * testo sta nel copy della faccia sotto il displayKey dell'innesco, come
 * lo legge il renderer del sito. Vuoto se la carta non ne ha.
 */
export function enterEffects(cardId: string, faceIndex: number, locale: string): { tag: string; text: string }[] {
  const card = getCard(cardId);
  const face = card?.faces[faceIndex] ?? card?.faces[0];
  if (!card || !face) return [];
  return effectsFor(cardId, faceIndex, locale, ENTER_EVENTS[face.kind] ?? []);
}

function effectsFor(cardId: string, faceIndex: number, locale: string, events: string[]): { tag: string; text: string }[] {
  const card = getCard(cardId);
  const face = card?.faces[faceIndex] ?? card?.faces[0];
  if (!card || !face) return [];
  const copy = localized(card, locale);
  const faceCopy = copy?.[face.displayKey] ?? {};
  const out: { tag: string; text: string }[] = [];
  for (const trigger of face.triggers ?? []) {
    if (typeof trigger.event !== "string" || !events.includes(trigger.event)) continue;
    const key = typeof trigger.displayKey === "string" ? trigger.displayKey : typeof trigger.id === "string" ? trigger.id : "";
    const entry = faceCopy.triggers?.[key] ?? faceCopy[key];
    if (!entry || typeof entry.text !== "string") continue;
    // Due inneschi con lo stesso testo (RBF-034: il +1 e poi il dado stanno
    // in una frase sola) si leggono una volta.
    if (out.some(shown => shown.text === entry.text)) continue;
    out.push({ tag: typeof entry.trigger === "string" ? entry.trigger : locale === "en" ? "Effect" : "Effetto", text: entry.text });
  }
  return out;
}

/**
 * Gli ascoltatori d'ingresso certificati di una faccia (§8.2): evento
 * `on_enter_field` con `enteringCard` (un'altra Entità del controllore,
 * `excludeSelf`), `requiresControlledAtLeast` (N Entità, con razza) ed
 * effetto `draw_card` per il controllore. Specchio di card_index.rb,
 * enter_listeners: forma diversa, niente — l'effetto resta a mano.
 */
function enterListenersOf(face: CardFace | undefined): EnterListener[] {
  const out: EnterListener[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_enter_field") continue;
    const details = trigger.details as { enteringCard?: any; requiresControlledAtLeast?: any } | undefined;
    const effect = trigger.effect as { type?: unknown; count?: unknown; target?: { controller?: unknown } } | undefined;
    const entering = details?.enteringCard;
    const requires = details?.requiresControlledAtLeast;
    if (!entering || !requires || !effect) continue;
    if (effect.type !== "draw_card" || !Number.isInteger(effect.count) || effect.target?.controller !== "controller") continue;
    if (entering.cardType !== "entity" || entering.controller !== "controller" || entering.excludeSelf !== true) continue;
    if (!Number.isInteger(requires.count) || requires.filter?.cardType !== "entity" || requires.filter?.controller !== "controller") continue;
    out.push({
      enteringRace: typeof entering.race === "string" ? entering.race : null,
      requires: { count: requires.count as number, race: typeof requires.filter.race === "string" ? requires.filter.race : null },
      draw: effect.count as number,
    });
  }
  return out;
}

/**
 * Gli spostamenti all'ingresso certificati di una faccia (§8.2): evento
 * `on_enter_field` senza `enteringCard` (è questa carta che entra), effetto
 * `move_card` con bersaglio un'Entità avversaria sul Fronte (una sola) e
 * destinazione la Zona di Ritiro. Specchio di card_index.rb, enter_moves.
 */
function enterMovesOf(face: CardFace | undefined): EnterMove[] {
  const out: EnterMove[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_enter_field") continue;
    const details = trigger.details as { enteringCard?: unknown } | undefined;
    if (details?.enteringCard) continue;
    const effect = trigger.effect as { type?: unknown; target?: any; destination?: any } | undefined;
    if (!effect || effect.type !== "move_card") continue;
    const target = effect.target;
    const destination = effect.destination;
    if (!target || target.cardType !== "entity" || target.controller !== "opponent" || target.zone !== "front") continue;
    if (target.min !== 1 || target.max !== 1) continue;
    if (!destination) continue;
    // Due destinazioni certificate: il Ritiro (senza dettagli) e l'Abisso
    // «finché questa Entità resta in campo; quando lascia il campo, torna
    // in gioco» — l'esilio condizionato (heldBy, release). Specchio di
    // card_index.rb, enter_moves.
    const extra = (trigger.effect as { details?: unknown }).details as Loose | undefined;
    if (destination.zone === "retire" && extra === undefined) {
      out.push({ target: { kind: "entity", controller: "opponent" }, to: "ritiro" });
    } else if (destination.zone === "abyss" && extra && extra.whileSourceOnField === true && extra.returnsToPlayWhenSourceLeaves === true) {
      out.push({ target: { kind: "entity", controller: "opponent" }, to: "abisso", hold: true });
    }
  }
  return out;
}

/**
 * I ritorni all'ingresso certificati di una faccia (§8.2): evento
 * `on_enter_field` senza `enteringCard`, effetto `move_card` da
 * `{zone: retire, owner: controller}` di UNA carta del controllore con
 * `details.permanent`, destinazione `{zone: front}`. Specchio di
 * card_index.rb, enter_returns.
 */
function enterReturnsOf(face: CardFace | undefined, event: "on_enter_field" | "on_attack"): EnterReturn[] {
  const out: EnterReturn[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== event) continue;
    const details = trigger.details as { enteringCard?: unknown } | undefined;
    if (details?.enteringCard) continue;
    const effect = trigger.effect as { type?: unknown; target?: any; from?: any; destination?: any } | undefined;
    if (!effect || effect.type !== "move_card") continue;
    const target = effect.target;
    if (!target || target.controller !== "controller" || target.min !== 1 || target.max !== 1 || target.details?.permanent !== true) continue;
    if (effect.from?.zone !== "retire" || effect.from?.owner !== "controller") continue;
    if (effect.destination?.zone !== "front") continue;
    out.push({ from: "ritiro", filter: { permanent: true }, to: "field" });
  }
  return out;
}

/**
 * Le pesche all'attacco certificate (§8.2, RBF-026): evento `on_attack`
 * con `oncePerEachOfYourTurns` e `requiresObjectAssigned`, effetto
 * `draw_card` del controllore con `count` intero; `thenDiscardCards`
 * certificato solo a 1. Specchio di card_index.rb, attack_draws.
 */
function attackDrawsOf(face: CardFace | undefined): AttackDraw[] {
  const out: AttackDraw[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_attack") continue;
    const details = trigger.details as { oncePerEachOfYourTurns?: unknown; requiresObjectAssigned?: unknown } | undefined;
    const effect = trigger.effect as { type?: unknown; count?: unknown; target?: any; details?: any } | undefined;
    if (!details || !effect || effect.type !== "draw_card" || !Number.isInteger(effect.count)) continue;
    if (effect.target?.controller !== "controller") continue;
    if (details.oncePerEachOfYourTurns !== true || details.requiresObjectAssigned !== true) continue;
    const thenDiscard = effect.details?.thenDiscardCards;
    if (thenDiscard !== undefined && thenDiscard !== 1) continue;
    out.push({ draw: effect.count as number, thenDiscard: thenDiscard ?? 0, requiresObject: true });
  }
  return out;
}

// ---- Le altre forme «quando attacca» (§8.2). Specchio di card_index.rb,
// attack_forms: stesse condizioni, parser per parser — una forma che non
// combacia esattamente non entra.

type Loose = Record<string, any>;

function rollRange(value: unknown): [number, number] | null {
  const match = typeof value === "string" ? value.match(/^(\d+)-(\d+)$/) : null;
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function dieFaces(value: unknown): number | null {
  const match = typeof value === "string" ? value.match(/^d(\d+)$/) : null;
  return match ? Number(match[1]) : null;
}

function ownTarget(target: unknown, type: string, race: string | null = null): target is Loose {
  const t = target as Loose | undefined;
  return !!t && typeof t === "object" && t.cardType === type && t.controller === "controller" && (race === null || t.race === race);
}

function attackFormsOf(faces: CardFace[]): AttackForm[] {
  const out: AttackForm[] = [];
  faces.forEach((face, index) => {
    for (const trigger of face.triggers ?? []) {
      if (trigger.event !== "on_attack") continue;
      const details = (typeof trigger.details === "object" && trigger.details ? trigger.details : {}) as Loose;
      const effect = trigger.effect as Loose | undefined;
      if (!effect || typeof effect !== "object") continue;
      const form =
        attackUntap(details, effect) ?? attackEmpower(details, effect) ?? attackLook(details, effect) ?? attackHeal(details, effect) ??
        attackRecall(details, effect) ?? attackRearm(details, effect) ?? attackRestrict(details, effect);
      if (form) out.push({ ...form, face: index } as AttackForm);
    }
  });
  return out;
}

type Unfaced<F> = F extends AttackForm ? Omit<F, "face"> : never;

function attackUntap(details: Loose, effect: Loose): Unfaced<AttackForm> | null {
  if (effect.type !== "untap" || effect.target?.scope !== "self" || effect.details?.afterCombat !== true) return null;
  if (details.oncePerEachOfYourTurns !== true || details.whileHasObjectAssigned !== true) return null;
  return { kind: "untap", who: "self", once: true, requiresObject: true };
}

function attackEmpower(details: Loose, effect: Loose): Unfaced<AttackForm> | null {
  const target = effect.target as Loose | undefined;
  if (effect.type === "modify_power" && Number.isInteger(effect.amount) && effect.duration === "until_end_of_turn") {
    if (details.whenAssignedAttacks === true && target?.scope === "assigned") {
      return { kind: "empower", who: "object", targets: "bearer", power: effect.amount };
    }
    if (details.requiresObjectAssigned === true && ownTarget(target, "entity") && target.quantity === "all" &&
        target.details?.hasObjectAssigned === true && target.details?.excludeSelf === true) {
      return { kind: "empower", who: "self", requiresObject: true, targets: "others_armed", power: effect.amount };
    }
  }
  if (effect.type === "empower" && effect.duration === "until_end_of_turn" && details.oncePerEachOfYourTurns === true &&
      ownTarget(target, "entity", "human") && target.min === 1 && target.max === 1 && target.details?.nextAttackerThisTurn === true) {
    const grants = (Array.isArray(effect.grants) ? effect.grants : []).filter((k: unknown) => typeof k === "string");
    if (grants.length) return { kind: "empower", who: "self", once: true, targets: "next_human_attacker", grants };
  }
  return null;
}

function attackLook(details: Loose, effect: Loose): Unfaced<AttackForm> | null {
  if (effect.type !== "look_and_optionally_move") return null;
  const from = effect.from as Loose | undefined;
  const extra = effect.details as Loose | undefined;
  if (!from || from.zone !== "deck" || from.owner !== "controller" || from.position !== "top" || !Number.isInteger(from.count)) return null;
  if (!extra || typeof extra.mayReveal?.cardType !== "string") return null;
  const revealTo = extra.revealTo?.zone;
  const restTo = extra.restTo?.zone;
  if (!["hand", "retire"].includes(revealTo) || !["deck", "retire"].includes(restTo)) return null;
  if (restTo === "deck" && extra.restTo?.position !== "bottom") return null;
  const base = {
    count: from.count as number,
    reveal: { kind: extra.mayReveal.cardType as "matter" | "object" | "entity", race: typeof extra.mayReveal.race === "string" ? (extra.mayReveal.race as string) : null },
    revealTo: (revealTo === "retire" ? "ritiro" : "hand") as "hand" | "ritiro",
    restTo: (restTo === "retire" ? "ritiro" : "deck") as "deck" | "ritiro",
  };
  if (details.whenAssignedAttacks === true) {
    const die = dieFaces(extra.die);
    const onRoll = rollRange(extra.onlyOnRoll);
    if (die === null || onRoll === null) return null;
    return { kind: "look", who: "object", ...base, die, onRoll };
  }
  const attacker = details.attacker as Loose | undefined;
  if (ownTarget(attacker, "entity") && attacker.details?.hasObjectAssigned === true && details.oncePerEachOfYourTurns === true && extra.die === undefined) {
    return { kind: "look", who: "ally", ...base, attackerArmed: true, once: true, die: null, onRoll: null };
  }
  return null;
}

function attackHeal(details: Loose, effect: Loose): Unfaced<AttackForm> | null {
  const extra = (typeof effect.details === "object" && effect.details ? effect.details : {}) as Loose;
  if (effect.type === "gain_health" && Number.isInteger(effect.amount) && effect.target?.controller === "controller") {
    const required = details.requiresAttackersThisTurnAtLeast as Loose | undefined;
    if (details.oncePerEachOfYourTurns === true && required && Number.isInteger(required.count) && ownTarget(required.filter, "entity", "human")) {
      const thenDraw = extra.thenDrawCards;
      const thenDiscard = extra.thenDiscardCards;
      if (![undefined, 1].includes(thenDraw) || ![undefined, 1].includes(thenDiscard)) return null;
      return { kind: "heal", who: "rubyfront", once: true, requiresAttackers: { count: required.count, race: "human" }, amount: effect.amount, die: null, onRoll: null, thenDraw: thenDraw ?? 0, thenDiscard: thenDiscard ?? 0 };
    }
    const recall = extra.thenMoveCard as Loose | undefined;
    if (Object.keys(details).length === 0 && recall && recall.from?.zone === "retire" && recall.to?.zone === "hand" && recall.count === 1 && recall.filter?.cardType === "entity") {
      const die = dieFaces(extra.die);
      const onRoll = rollRange(extra.onRoll);
      if (die === null || onRoll === null) return null;
      return { kind: "heal", who: "self", amount: effect.amount, die, onRoll, thenRecall: { kind: "entity" } };
    }
  }
  if (effect.type === "empower" && ownTarget(details.attackers, "entity", "human") && typeof extra.byRoll === "object" && extra.byRoll) {
    const die = dieFaces(extra.die);
    const by = extra.byRoll as Record<string, Loose>;
    const gain = Object.keys(by).find(key => by[key]?.gainHealthEqualsHumanAttackersThisTurn === true);
    const drain = Object.keys(by).find(key => by[key]?.opponentLosesHealthEqualsHumanAttackersThisTurn === true);
    const gainOn = rollRange(gain);
    const drainOn = rollRange(drain);
    if (die === null || !gainOn || !drainOn) return null;
    // Una volta per turno: l'ondata, non ciascun attaccante (deciso 2026-09-10). Specchio di card_index.rb.
    return { kind: "heal", who: "permanent", attackers: { kind: "entity", race: "human" }, die, onRoll: null, gainOn, drainOn, amount: "human_attackers", once: true };
  }
  return null;
}

/**
 * Le stappate certificate all'ingresso (§8.2, RBF-011): evento
 * `on_enter_field` senza `enteringCard`, effetto `untap` su tutte le
 * proprie Entità, col dado e la soglia. Specchio di card_index.rb, enter_refreshes.
 */
function enterRefreshesOf(face: CardFace | undefined): EnterRefresh[] {
  const out: EnterRefresh[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_enter_field") continue;
    const details = trigger.details as { enteringCard?: unknown } | undefined;
    if (details?.enteringCard) continue;
    const effect = trigger.effect as Loose | undefined;
    if (!effect || effect.type !== "untap" || !ownTarget(effect.target, "entity") || effect.target?.quantity !== "all") continue;
    const extra = effect.details as Loose | undefined;
    if (!extra || Object.keys(extra).sort().join() !== "die,onRoll") continue;
    const die = dieFaces(extra.die);
    const onRoll = rollRange(extra.onRoll);
    if (die !== null && onRoll) out.push({ die, onRoll });
  }
  return out;
}

function attackRecall(details: Loose, effect: Loose): Unfaced<AttackForm> | null {
  if (Object.keys(details).length !== 0 || effect.type !== "move_card" || !ownTarget(effect.target, "entity", "human")) return null;
  if (effect.target.min !== 1 || effect.target.max !== 1) return null;
  if (effect.from?.zone !== "retire" || effect.destination?.zone !== "front") return null;
  const extra = effect.details as Loose | undefined;
  if (!extra || extra.joinsThisAttack !== true) return null;
  const die = dieFaces(extra.die);
  const onRoll = rollRange(extra.onRoll);
  return die !== null && onRoll ? { kind: "return", who: "self", die, onRoll, filter: { kind: "entity", race: "human" }, joins: true } : null;
}

function attackRearm(details: Loose, effect: Loose): Unfaced<AttackForm> | null {
  const attacker = details.attacker as Loose | undefined;
  if (effect.type !== "assign_object" || effect.optional !== true) return null;
  if (effect.from?.zone !== "retire" || effect.target?.scope !== "attacker" || effect.details?.noFluxCost !== true) return null;
  if (!ownTarget(attacker, "entity") || attacker.details?.hasObjectAssigned !== true) return null;
  return { kind: "rearm", who: "ally", attackerArmed: true };
}

/**
 * Il divieto di blocco: «se almeno N Entità Umane che controlli attaccano,
 * un'Entità avversaria non può bloccare in questo turno». La condizione
 * conta gli attaccanti di QUESTO turno (`requiresAttackersThisTurnAtLeast`,
 * la fonte compresa — revisione del foglio) o, nella forma storica, quelli
 * del turno precedente (`requiresAttackersPreviousTurnAtLeast`).
 */
function attackRestrict(details: Loose, effect: Loose): Unfaced<AttackForm> | null {
  const thisTurn = details.requiresAttackersThisTurnAtLeast as Loose | undefined;
  const previous = details.requiresAttackersPreviousTurnAtLeast as Loose | undefined;
  const required = thisTurn ?? previous;
  if (effect.type !== "restrict_action" || effect.restricts !== "block" || effect.duration !== "until_end_of_turn") return null;
  const target = effect.target as Loose | undefined;
  if (!target || target.cardType !== "entity" || target.controller !== "opponent" || target.min !== 1 || target.max !== 1) return null;
  if (!required || !Number.isInteger(required.count) || !ownTarget(required.filter, "entity", "human")) return null;
  const condition = thisTurn ? { requiresAttackers: { count: required.count, race: "human" } } : { requiresPreviousAttackers: { count: required.count, race: "human" } };
  return { kind: "empower", who: "self", ...condition, targets: "opposing_entity", restrict: "block" };
}

/**
 * Gli sguardi nel mazzo certificati (§8.2): evento `on_enter_field` senza
 * `enteringCard`, effetto `look_and_optionally_move` dalla cima del
 * proprio mazzo con `count` intero, `mayReveal` un'Entità (con razza) che
 * va in mano, `restTo` in fondo al mazzo. Specchio di card_index.rb.
 */
function enterLooksOf(face: CardFace | undefined): EnterLook[] {
  const out: EnterLook[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_enter_field") continue;
    const details = trigger.details as { enteringCard?: unknown } | undefined;
    if (details?.enteringCard) continue;
    const effect = trigger.effect as { type?: unknown; from?: any; details?: any } | undefined;
    if (!effect || effect.type !== "look_and_optionally_move") continue;
    const from = effect.from;
    const d = effect.details;
    if (!from || from.zone !== "deck" || from.owner !== "controller" || from.position !== "top") continue;
    if (!d || d.revealTo?.zone !== "hand" || d.restTo?.zone !== "deck" || d.restTo?.position !== "bottom") continue;
    const may = d.mayReveal;
    if (!may || (may.cardType !== "entity" && may.cardType !== "object")) continue;
    // Il conto: fisso (RBF-006), o col dado «2 + ceil(result/2)» (RBF-027),
    // la sola formula certificata.
    let count: number | null = null;
    let die: number | null = null;
    let countBase = 0;
    let byRoll = false;
    if (Number.isInteger(from.count)) count = from.count as number;
    else {
      const faces = typeof d.die === "string" ? /^d(\d+)$/.exec(d.die) : null;
      const formula = typeof d.count === "string" ? /^(\d+) \+ ceil\(result\/2\)$/.exec(d.count) : null;
      byRoll = d.count === "result";
      if (!faces || (!formula && !byRoll)) continue;
      die = Number(faces[1]);
      countBase = formula ? Number(formula[1]) : 0;
    }
    const then = d.thenMoveOneTo;
    if (then && then.zone !== "retire") continue;
    out.push({
      count,
      die,
      countBase,
      reveal: { kind: may.cardType, race: typeof may.race === "string" ? may.race : null },
      thenRetire: Boolean(then),
      ...(byRoll ? { formula: "result" as const } : {}),
    });
  }
  return out;
}

/**
 * I controlli all'ingresso certificati (§8.2): evento `on_enter_field`
 * senza `enteringCard`, effetto `gain_control` di UN'Entità avversaria
 * (con al più una condizione sul costo di Flusso, `flux_cost lte N`),
 * durata `until_end_of_turn`, con le parole chiave concesse. Specchio di
 * card_index.rb, enter_controls.
 */
function enterControlsOf(face: CardFace | undefined): EnterControl[] {
  const out: EnterControl[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_enter_field") continue;
    const details = trigger.details as { enteringCard?: unknown } | undefined;
    if (details?.enteringCard) continue;
    const effect = trigger.effect as { type?: unknown; target?: any; duration?: unknown; details?: any } | undefined;
    if (!effect || effect.type !== "gain_control" || effect.duration !== "until_end_of_turn") continue;
    const target = effect.target;
    if (!target || target.cardType !== "entity" || target.controller !== "opponent" || target.min !== 1 || target.max !== 1) continue;
    const conditions: any[] = Array.isArray(target.conditions) ? target.conditions : [];
    let maxCost: number | null = null;
    let certified = true;
    for (const condition of conditions) {
      if (condition?.stat === "flux_cost" && condition.operator === "lte" && Number.isInteger(condition.value)) maxCost = condition.value;
      else certified = false;
    }
    if (!certified) continue;
    const grants = Array.isArray(effect.details?.grants) ? effect.details.grants.filter((g: unknown) => typeof g === "string") : [];
    out.push({ target: { kind: "entity", controller: "opponent", maxCost }, grants });
  }
  return out;
}

/**
 * I disarmi all'ingresso certificati (§8.2, dal 2026-09-10): `move_card` di
 * OGNI Oggetto assegnato a un'Entità avversaria sul Fronte, verso la Zona
 * di Ritiro del proprietario. Specchio di card_index.rb, enter_disarms.
 */
function enterDisarmsOf(face: CardFace | undefined): EnterDisarm[] {
  const out: EnterDisarm[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_enter_field") continue;
    const effect = trigger.effect as { type?: unknown; target?: any; destination?: any } | undefined;
    if (!effect || effect.type !== "move_card") continue;
    const target = effect.target;
    if (!target || target.cardType !== "object" || target.controller !== "opponent" || target.zone !== "front" || target.quantity !== "all") continue;
    if (target.details?.assigned !== true) continue;
    if (effect.destination?.zone !== "retire" || effect.destination?.owner !== "card_owner") continue;
    out.push({ to: "ritiro" });
  }
  return out;
}

/**
 * I riarmi all'ingresso certificati (§8.2, dal 2026-09-10): `assign_object`
 * facoltativo dalla propria Zona di Ritiro alle proprie Entità, quanti si
 * vuole, gratis. Specchio di card_index.rb, enter_rearms.
 */
function enterRearmsOf(face: CardFace | undefined): EnterRearm[] {
  const out: EnterRearm[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_enter_field") continue;
    const effect = trigger.effect as { type?: unknown; optional?: unknown; from?: any; target?: any; details?: any } | undefined;
    if (!effect || effect.type !== "assign_object" || effect.optional !== true) continue;
    if (effect.from?.zone !== "retire" || effect.from?.owner !== "controller") continue;
    // La variante su di sé: un Oggetto a chi entra, gratis. Specchio di card_index.rb.
    if (effect.target?.scope === "self") {
      const details = effect.details as Loose | undefined;
      if (details && Object.keys(details).length === 1 && details.noFluxCost === true) out.push({ self: true });
      continue;
    }
    const target = effect.target;
    if (!target || target.cardType !== "entity" || target.controller !== "controller" || target.quantity !== "all") continue;
    if (effect.details?.anyNumber !== true || effect.details?.noFluxCost !== true) continue;
    out.push({ any: true });
  }
  return out;
}

/**
 * I ritorni vincolati certificati (§8.2, dal 2026-09-10): `on_leave_field`
 * col vincolo «senza Oggetti addosso», `move_card` di sé stessa sul Fronte,
 * poi un Oggetto dal Ritiro con `flux_cost lte N`, gratis, obbligatorio.
 * Specchio di card_index.rb, leave_returns.
 */
function leaveReturnsOf(face: CardFace | undefined): LeaveReturn[] {
  const out: LeaveReturn[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_leave_field") continue;
    const details = trigger.details as { requiresNoObjectAssignedWhenLeft?: unknown } | undefined;
    if (details?.requiresNoObjectAssignedWhenLeft !== true) continue;
    const effect = trigger.effect as { type?: unknown; optional?: unknown; target?: any; destination?: any; details?: any } | undefined;
    if (!effect || effect.type !== "move_card" || effect.optional !== true) continue;
    if (effect.target?.scope !== "self" || effect.destination?.zone !== "front") continue;
    const rearm = effect.details?.thenAssignObject;
    if (!rearm || rearm.from?.zone !== "retire" || rearm.noFluxCost !== true || rearm.required !== true) continue;
    const conditions: any[] = Array.isArray(rearm.filter?.conditions) ? rearm.filter.conditions : [];
    const cost = conditions.find(c => c?.stat === "flux_cost" && c.operator === "lte" && Number.isInteger(c.value));
    if (rearm.filter?.cardType !== "object" || !cost || conditions.length !== 1) continue;
    out.push({ maxCost: cost.value });
  }
  return out;
}

// ---- Gli statici, le Materie alla risoluzione e il flip (Eredità Perduta).
// Specchio di card_index.rb: static_forms, resolve_forms, flip_forms,
// nexus_of — stesse condizioni, parser per parser.

/** "5-6" → [5, 6], "20" → [20, 20]; null se non è una fascia. */
function band(value: unknown): [number, number] | null {
  const range = rollRange(value);
  if (range) return range;
  return typeof value === "string" && /^\d+$/.test(value) ? [Number(value), Number(value)] : null;
}

function raceFilter(filter: unknown, zone: string | null = null): { kind: "entity"; race: string | null } | null {
  const f = filter as Loose | undefined;
  if (!f || typeof f !== "object" || f.cardType !== "entity") return null;
  if (zone && f.zone !== zone) return null;
  if (f.owner !== "controller" && f.controller !== "controller") return null;
  return { kind: "entity", race: typeof f.race === "string" ? f.race : null };
}

function staticFormsOf(faces: CardFace[]): StaticForm[] {
  const out: StaticForm[] = [];
  for (const face of faces) {
    for (const trigger of face.triggers ?? []) {
      if (trigger.event !== "while_in_play" && trigger.event !== "while_assigned") continue;
      const effect = trigger.effect as Loose | undefined;
      if (!effect) continue;
      // La tassa di Flusso: «all'inizio di ogni tuo turno hai N Flusso in meno»
      // finché resta sul Fronte. Specchio di card_index.rb, static_forms.
      if (effect.type === "modify_flux") {
        const toll = (typeof effect.details === "object" && effect.details ? effect.details : {}) as Loose;
        if (trigger.event === "while_in_play" && effect.target?.controller === "controller" && Number.isInteger(effect.amount) && effect.amount < 0 && toll.atStartOfEachOwnTurn === true && toll.whileOnFront === true) {
          out.push({ kind: "flux_toll", amount: -effect.amount });
        }
        continue;
      }
      // Lo sconto d'assegnazione: «gli Oggetti che assegni a questa Entità costano N in meno». Specchio di card_index.rb.
      if (effect.type === "reduce_cost") {
        if (trigger.event === "while_in_play" && sameShape(effect.filter, { cardType: "object" }) && Number.isInteger(effect.amount) && effect.amount > 0 && sameShape(effect.details, { assignedToSelf: true })) {
          out.push({ kind: "assign_discount", amount: effect.amount });
        }
        continue;
      }
      // «Questa Entità non si tappa mai» (RBF-011): uno statico senza numeri.
      if (effect.type === "prevent_tap") {
        if (trigger.event === "while_in_play" && effect.target?.scope === "self" && effect.duration === "permanent") out.push({ kind: "never_taps" });
        continue;
      }
      // Gli statici di Contrattacco: per Oggetto addosso su di sé, +N al portatore. Specchio di card_index.rb.
      if (effect.type === "modify_counterattack") {
        if (!Number.isInteger(effect.amount)) continue;
        const details = (typeof effect.details === "object" && effect.details ? effect.details : {}) as Loose;
        if (trigger.event === "while_in_play") {
          if (effect.target?.scope === "self" && Object.keys(details).length === 1 && details.perObjectAssigned === true) out.push({ kind: "self_counter", amount: effect.amount, perObject: true });
        } else if (effect.target?.scope === "assigned" && (effect.duration === undefined || effect.duration === "permanent") && Object.keys(details).length === 0) {
          out.push({ kind: "bearer_counter", amount: effect.amount });
        }
        continue;
      }
      if (effect.type !== "modify_power" || !Number.isInteger(effect.amount)) continue;
      const details = (typeof effect.details === "object" && effect.details ? effect.details : {}) as Loose;
      if (trigger.event === "while_in_play") {
        // L'aura delle armate: «le altre Entità con un Oggetto assegnato che controlli hanno +N». Specchio di card_index.rb.
        const target = effect.target as Loose | undefined;
        if (target && target.cardType === "entity" && target.controller === "controller" && target.quantity === "all" && sameShape(target.details, { hasObjectAssigned: true, excludeSelf: true }) && Object.keys(target).length === 4) {
          if (Object.keys(details).length === 0 && effect.duration === undefined) out.push({ kind: "others_armed_power", amount: effect.amount });
          continue;
        }
        if (effect.target?.scope !== "self") continue;
        if (details.whileAttacking === true) {
          const other = raceFilter(details.requiresOtherControlled);
          if (other) out.push({ kind: "self_power", amount: effect.amount, whileAttacking: true, requiresOther: other });
        } else if (details.whileHasObjectAssigned === true) {
          // «Se questa Entità ha un Oggetto assegnato, ha +N Potenza». Specchio di card_index.rb.
          if (Object.keys(details).length === 1) out.push({ kind: "self_power", amount: effect.amount, whileArmed: true });
        } else if (details.perOtherControlled) {
          const other = raceFilter(details.perOtherControlled, "front");
          if (other && Object.keys(details).length === 1) out.push({ kind: "self_power", amount: effect.amount, perOther: other });
        }
      } else {
        // «Mentre assegnato» dura finché l'Oggetto è addosso: durata `permanent` o assente, stessa forma.
        if (effect.target?.scope !== "assigned" || (effect.duration !== undefined && effect.duration !== "permanent")) continue;
        if (Object.keys(details).length === 0) out.push({ kind: "bearer_power", amount: effect.amount });
        else if (details.perControlled) {
          const per = raceFilter(details.perControlled, "front");
          const known = Object.keys(details).every(key => key === "perControlled" || key === "assignedMayBeBlockedByMultipleEntities");
          if (per && known) out.push({ kind: "bearer_power", amount: effect.amount, per, multiBlock: details.assignedMayBeBlockedByMultipleEntities === true });
        }
      }
    }
  }
  return out;
}

function costCondition(conditions: unknown): { ok: boolean; maxCost: number | null } {
  let maxCost: number | null = null;
  const list: unknown[] = Array.isArray(conditions) ? conditions : [];
  for (const condition of list as Loose[]) {
    if (condition?.stat === "flux_cost" && condition.operator === "lte" && Number.isInteger(condition.value)) maxCost = condition.value;
    else return { ok: false, maxCost: null };
  }
  return { ok: true, maxCost };
}

function resolveFormsOf(faces: CardFace[]): ResolveForm[] {
  const out: ResolveForm[] = [];
  for (const face of faces) {
    for (const trigger of face.triggers ?? []) {
      if (trigger.event !== "on_resolve") continue;
      const effect = trigger.effect as Loose | undefined;
      if (!effect || typeof effect !== "object") continue;
      const form = resolveLook(effect) ?? resolveUntap(effect) ?? resolveMove(effect) ?? resolveFortune(effect) ?? resolveDestroy(effect) ?? resolveBlock(effect) ?? resolveWeaken(effect) ?? resolveAmplify(effect) ?? resolveDrain(effect) ?? resolveSearch(effect);
      if (form) out.push(form);
    }
  }
  return out;
}

/**
 * Gli effetti certificati «quando assegni questa carta a un'Entità» (§3.1,
 * §8.2): evento `on_assign_object` con `selfAssigned` (è questo Oggetto che
 * viene assegnato), effetto `move_card` di UN'Entità avversaria nell'Abisso
 * «finché questa carta resta in gioco; quando lascia il gioco, torna» —
 * l'esilio condizionato, stessa meccanica della Materia e dell'Entità
 * (heldBy, release). Specchio di card_index.rb, assign_forms.
 */
function assignFormsOf(faces: CardFace[]): AssignForm[] {
  const out: AssignForm[] = [];
  faces.forEach((face, index) => {
    for (const trigger of face.triggers ?? []) {
      if (trigger.event !== "on_assign_object") continue;
      const details = trigger.details as Loose | undefined;
      const effect = trigger.effect as Loose | undefined;
      if (!effect) continue;
      // Il Rubyfront/Nexus: «la prima volta in ogni tuo turno che assegni un
      // Oggetto», gli estremi del mazzo — per faccia. Specchio di card_index.rb.
      if (sameShape(details, { oncePerEachOfYourTurns: true })) {
        const extra = effect.details as Loose | undefined;
        if (effect.type !== "look_and_optionally_move" || !sameShape(effect.from, { zone: "deck", owner: "controller", position: "top" })) continue;
        if (!extra || !sameShape(extra.alsoLook, { zone: "deck", owner: "controller", position: "bottom" })) continue;
        const keys = Object.keys(extra).sort().join();
        if (keys === "alsoLook,maySwapTopAndBottom,thenDiscardCards,thenDrawCards" && extra.maySwapTopAndBottom === true && Number.isInteger(extra.thenDrawCards) && Number.isInteger(extra.thenDiscardCards)) {
          out.push({ kind: "ends", face: index, swap: true, thenDraw: extra.thenDrawCards, thenDiscard: extra.thenDiscardCards, once: true });
        } else if (keys === "addOneTo,alsoLook,otherTo" && sameShape(extra.addOneTo, { zone: "hand", owner: "controller" }) && sameShape(extra.otherTo, { zone: "retire", owner: "controller" })) {
          out.push({ kind: "ends", face: index, toHand: true, otherToRetire: true, once: true });
        }
        continue;
      }
      // L'Entità: «quando assegni un Oggetto a questa Entità: pesca una carta».
      if (sameShape(details, { toSelf: true })) {
        if (effect.type === "draw_card" && sameShape(effect.target, { controller: "controller" }) && Number.isInteger(effect.count) && effect.count > 0) out.push({ kind: "draw", count: effect.count, toSelf: true });
        continue;
      }
      if (!details || Object.keys(details).join() !== "selfAssigned" || details.selfAssigned !== true) continue;
      if (effect.type !== "move_card") continue;
      const target = effect.target as Loose | undefined;
      const destination = effect.destination as Loose | undefined;
      const extra = effect.details as Loose | undefined;
      if (!target || target.cardType !== "entity" || target.controller !== "opponent" || target.min !== 1 || target.max !== 1) continue;
      if (!destination || destination.zone !== "abyss") continue;
      if (!extra || extra.whileSourceOnField !== true || extra.returnsToPlayWhenSourceLeaves !== true) continue;
      out.push({ kind: "exile", target: { kind: "entity", controller: "opponent" }, to: "abisso", hold: true });
    }
  });
  return out;
}

/**
 * Gli effetti certificati «quando quell'Entità muore» di un Oggetto (§5,
 * §8.2): in Ritiro invece che nell'Abisso, poi «puoi assegnare un altro
 * Oggetto dalla tua Zona di Ritiro, senza pagarne il costo, a un'Entità
 * senza Oggetto che controlli». Specchio di card_index.rb, death_forms.
 */
function deathFormsOf(faces: CardFace[]): DeathForm[] {
  const out: DeathForm[] = [];
  for (const face of faces) {
    for (const trigger of face.triggers ?? []) {
      if (trigger.event !== "on_death" || !sameShape(trigger.details, { ofAssignedEntity: true })) continue;
      const effect = trigger.effect as Loose | undefined;
      if (!effect || effect.type !== "move_card" || !sameShape(effect.target, { scope: "self" }) || !sameShape(effect.destination, { zone: "retire", owner: "controller" })) continue;
      const extra = effect.details as Loose | undefined;
      if (!extra || Object.keys(extra).sort().join() !== "insteadOfZone,thenMayAssignObject" || !sameShape(extra.insteadOfZone, { zone: "abyss", owner: "controller" })) continue;
      const rearm = extra.thenMayAssignObject as Loose | undefined;
      if (!rearm || rearm.noFluxCost !== true || Object.keys(rearm).length !== 4) continue;
      if (!sameShape(rearm.from, { zone: "retire", owner: "controller" })) continue;
      if (!rearm.filter || rearm.filter.cardType !== "object" || !sameShape(rearm.filter.details, { other: true }) || Object.keys(rearm.filter).length !== 2) continue;
      if (!rearm.target || rearm.target.cardType !== "entity" || rearm.target.controller !== "controller" || !sameShape(rearm.target.details, { hasObjectAssigned: false }) || Object.keys(rearm.target).length !== 3) continue;
      out.push({ kind: "remain", to: "ritiro", thenRearm: { other: true, to: "unarmed", free: true } });
    }
  }
  return out;
}

/** L'indebolimento dell'attaccante (dal 2026-09-10): «un'Entità avversaria attaccante prende −1 Potenza per ogni Entità con un Oggetto assegnato che controlli, fino alla fine del turno». Specchio di card_index.rb, resolve_weaken. */
function resolveWeaken(effect: Loose): ResolveForm | null {
  if (effect.type !== "modify_power" || effect.duration !== "until_end_of_turn") return null;
  const target = effect.target as Loose | undefined;
  const extra = effect.details as Loose | undefined;
  if (!target || target.cardType !== "entity" || target.controller !== "opponent" || target.min !== 1 || target.max !== 1) return null;
  if (!sameShape(target.details, { attacking: true })) return null;
  if (!Number.isInteger(effect.amount) || effect.amount >= 0) return null;
  if (!sameShape(extra, { perControllerEntityWithObjectAssigned: true })) return null;
  return { kind: "weaken", target: { kind: "entity", controller: "opponent", attacking: true }, amount: effect.amount, perArmed: true };
}

/** Il potenziamento delle armate (dal 2026-09-10): «fino a N Entità con un Oggetto assegnato che controlli prendono +M Potenza fino alla fine del turno e vengono stappate». Specchio di card_index.rb, resolve_amplify. */
function resolveAmplify(effect: Loose): ResolveForm | null {
  if (effect.type !== "modify_power" || effect.duration !== "until_end_of_turn") return null;
  const target = effect.target as Loose | undefined;
  const extra = effect.details as Loose | undefined;
  if (!ownTarget(target, "entity") || target.min !== 0 || !Number.isInteger(target.max) || target.max <= 0) return null;
  if (!sameShape(target.details, { hasObjectAssigned: true })) return null;
  if (!Number.isInteger(effect.amount) || effect.amount <= 0) return null;
  if (!sameShape(extra, { alsoUntap: true })) return null;
  return { kind: "empower", targets: "own_armed", power: effect.amount, upTo: target.max, untap: true };
}

/** Un oggetto piatto identico a quello atteso: stesse chiavi, stessi valori. */
function sameShape(value: unknown, expected: Record<string, unknown>): boolean {
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value as object);
  return keys.length === Object.keys(expected).length && keys.every(key => (value as Loose)[key] === expected[key]);
}

function resolveLook(effect: Loose): ResolveForm | null {
  if (effect.type !== "look_and_optionally_move") return null;
  const from = effect.from as Loose | undefined;
  const extra = effect.details as Loose | undefined;
  if (!from || from.zone !== "deck" || from.owner !== "controller" || from.position !== "top" || !Number.isInteger(from.count)) return null;
  if (!extra || typeof extra.mayReveal?.cardType !== "string") return null;
  if (extra.revealTo?.zone !== "hand" || extra.restTo?.zone !== "deck" || extra.restTo?.position !== "bottom") return null;
  if (![undefined, 1].includes(extra.addToHand) || (extra.maxRevealed !== undefined && !Number.isInteger(extra.maxRevealed))) return null;
  return {
    kind: "look",
    count: from.count,
    reveal: { kind: extra.mayReveal.cardType, race: typeof extra.mayReveal.race === "string" ? extra.mayReveal.race : null },
    revealTo: "hand",
    restTo: "deck",
    showUpTo: extra.maxRevealed ?? 1,
  };
}

function resolveUntap(effect: Loose): ResolveForm | null {
  if (effect.type !== "untap") return null;
  const target = effect.target as Loose | undefined;
  const extra = effect.details as Loose | undefined;
  if (!ownTarget(target, "entity") || !extra || extra.duration !== "until_end_of_turn") return null;
  const race = typeof target.race === "string" ? target.race : null;
  if (target.min === 1 && target.max === 1 && Number.isInteger(extra.thenPowerBonus) && Object.keys(extra).sort().join() === "duration,thenPowerBonus") {
    return { kind: "empower", targets: "own_entity", race, power: extra.thenPowerBonus, untap: true };
  }
  if (target.quantity === "all" && Number.isInteger(extra.thenCounterattackBonus)) {
    const requires = extra.requiresControlledAtLeast as Loose | undefined;
    if (!requires || !Number.isInteger(requires.count) || !ownTarget(requires.filter, "entity")) return null;
    return {
      kind: "empower",
      targets: "own_entities",
      race,
      counter: extra.thenCounterattackBonus,
      untap: true,
      requires: { count: requires.count, race: typeof requires.filter.race === "string" ? requires.filter.race : null },
    };
  }
  return null;
}

/** la Reattiva bloccante (forma `block`): «giocala come blocco a un attaccante: quell'attacco è bloccato. Se sul tuo Fronte ci sono almeno N Entità con un Oggetto assegnato, guadagni M PV». Specchio di card_index.rb, resolve_block. */
function resolveBlock(effect: Loose): ResolveForm | null {
  if (effect.type !== "block_attack") return null;
  const target = effect.target as Loose | undefined;
  const extra = effect.details as Loose | undefined;
  if (!target || target.cardType !== "entity" || target.controller !== "opponent" || target.min !== 1 || target.max !== 1) return null;
  if (!extra || !Number.isInteger(extra.ifControllerEntitiesWithObjectAtLeast) || !Number.isInteger(extra.thenControllerGainsHealth)) return null;
  if (Object.keys(extra).sort().join() !== "ifControllerEntitiesWithObjectAtLeast,thenControllerGainsHealth") return null;
  return { kind: "block", requiresArmed: extra.ifControllerEntitiesWithObjectAtLeast, heal: extra.thenControllerGainsHealth, asBlock: true };
}

function resolveMove(effect: Loose): ResolveForm | null {
  if (effect.type !== "move_card") return null;
  const target = effect.target as Loose | undefined;
  const destination = effect.destination as Loose | undefined;
  if (!target || target.controller !== "opponent" || target.min !== 1 || target.max !== 1 || !destination) return null;
  if (target.cardType === "entity" && destination.zone === "retire") {
    const cost = costCondition(target.conditions);
    if (!cost.ok) return null;
    // Lo sconto (dal 2026-09-10): «se sul tuo Fronte ci sono almeno N Entità
    // con un Oggetto assegnato, questa carta costa M in meno». Nessun
    // dettaglio: nessuno sconto. Un dettaglio diverso: forma ignota.
    let discount: { amount: number; ifArmedAtLeast: number } | null = null;
    if (effect.details !== undefined) {
      const extra = effect.details as Loose | undefined;
      if (!extra || Object.keys(extra).join() !== "fluxCostReduction") return null;
      const reduction = extra.fluxCostReduction as Loose | undefined;
      if (!reduction || Object.keys(reduction).sort().join() !== "amount,ifControllerEntitiesWithObjectAtLeast") return null;
      if (!Number.isInteger(reduction.amount) || !Number.isInteger(reduction.ifControllerEntitiesWithObjectAtLeast)) return null;
      discount = { amount: reduction.amount, ifArmedAtLeast: reduction.ifControllerEntitiesWithObjectAtLeast };
    }
    return { kind: "move", target: { kind: "entity", controller: "opponent", maxCost: cost.maxCost }, to: "ritiro", discount };
  }
  const extra = effect.details as Loose | undefined;
  if (target.details?.permanent === true && destination.zone === "abyss" && extra && extra.whileSourceOnField === true && extra.returnsToPlayWhenSourceLeaves === true) {
    return { kind: "exile", target: { permanent: true, controller: "opponent" }, to: "abisso", hold: true };
  }
  return null;
}

function resolveFortune(effect: Loose): ResolveForm | null {
  if (effect.type !== "empower" || effect.target?.controller !== "controller") return null;
  const extra = effect.details as Loose | undefined;
  if (!extra || typeof extra.byRoll !== "object" || !extra.byRoll) return null;
  const die = dieFaces(extra.die);
  const by = extra.byRoll as Record<string, Loose>;
  const keys = Object.keys(by);
  if (die === null || keys.length !== 4) return null;
  const gain = keys.find(key => Number.isInteger(by[key]?.gainHealth));
  const deploy = keys.find(key => typeof by[key]?.moveCard === "object" && by[key]?.moveCard);
  const draw = keys.find(key => Number.isInteger(by[key]?.drawCards));
  const all = keys.find(key => by[key]?.allOfTheAbove === true);
  if (!gain || !deploy || !draw || !all) return null;
  const bands = [band(gain), band(deploy), band(draw), band(all)];
  if (bands.some(b => b === null)) return null;
  const move = by[deploy].moveCard as Loose;
  const filter = move.filter as Loose | undefined;
  if (move.from?.zone !== "hand" || move.from?.owner !== "controller" || move.to?.zone !== "front" || move.to?.owner !== "controller") return null;
  if (!filter || filter.cardType !== "entity") return null;
  const cost = costCondition(filter.conditions);
  if (!cost.ok) return null;
  return {
    kind: "fortune",
    die,
    gain: { on: bands[0]!, amount: by[gain].gainHealth },
    deploy: { on: bands[1]!, filter: { kind: "entity", race: typeof filter.race === "string" ? filter.race : null, maxCost: cost.maxCost } },
    draw: { on: bands[2]!, count: by[draw].drawCards },
    allOn: bands[3]!,
  };
}

function resolveDestroy(effect: Loose): ResolveForm | null {
  if (effect.type !== "destroy") return null;
  const target = effect.target as Loose | undefined;
  const extra = effect.details as Loose | undefined;
  if (!target || target.cardType !== "entity" || target.min !== 1 || target.max !== 1 || !["any", "opponent", "controller"].includes(target.controller)) return null;
  if (!extra || extra.toZone?.zone !== "abyss") return null;
  // Un seguito ignoto rende la forma ignota; «poi perdi N PV» è certificato (dal 2026-09-10).
  if (!Object.keys(extra).every(key => key === "toZone" || key === "fluxCostReduction" || key === "thenControllerLosesHealth")) return null;
  const discount = extra.fluxCostReduction as Loose | undefined;
  if (discount !== undefined && !(discount && Number.isInteger(discount.amount) && discount.ifTargetState === "tapped")) return null;
  const thenLose = extra.thenControllerLosesHealth;
  if (thenLose !== undefined && !(Number.isInteger(thenLose) && thenLose > 0)) return null;
  return {
    kind: "destroy",
    target: { kind: "entity", controller: target.controller },
    to: "abisso",
    discount: discount ? { amount: discount.amount, ifTarget: "tapped" } : null,
    thenLose: thenLose ?? null,
  };
}

/** La ricerca col dado (dal 2026-09-10): guarda le prime N e tira un d20 — mostra per fascia in mano, o una in cima; poi una in Ritiro, le altre in fondo in qualsiasi ordine. Specchio di card_index.rb, resolve_search. */
function resolveSearch(effect: Loose): ResolveForm | null {
  if (effect.type !== "look_and_optionally_move") return null;
  const from = effect.from as Loose | undefined;
  const extra = effect.details as Loose | undefined;
  if (!from || !Number.isInteger(from.count) || !sameShape(from, { zone: "deck", owner: "controller", position: "top", count: from.count })) return null;
  if (!extra || Object.keys(extra).sort().join() !== "die,ifNoReveal,mayRevealByRoll,restTo,revealTo,thenMoveOneTo") return null;
  const die = dieFaces(extra.die);
  const byRoll = extra.mayRevealByRoll as Record<string, Loose> | undefined;
  if (die === null || !byRoll || typeof byRoll !== "object" || Object.keys(byRoll).length === 0) return null;
  const bands: Record<"matter" | "object" | "entity", [number, number] | undefined> = { matter: undefined, object: undefined, entity: undefined };
  for (const [key, value] of Object.entries(byRoll)) {
    const range = band(key);
    const type = value?.cardType as unknown;
    if (!range || (type !== "matter" && type !== "object" && type !== "entity") || bands[type]) return null;
    bands[type] = range;
  }
  if (!sameShape(extra.revealTo, { zone: "hand", owner: "controller" }) || !sameShape(extra.ifNoReveal, { putOneOnTop: true })) return null;
  if (!sameShape(extra.thenMoveOneTo, { zone: "retire", owner: "controller" })) return null;
  if (!sameShape(extra.restTo, { zone: "deck", owner: "controller", position: "bottom", anyOrder: true })) return null;
  return { kind: "search", count: from.count, die, bands, revealTo: "hand", ifNoRevealTop: true, thenRetire: true, restTo: "deck" };
}

/** Il prosciugamento (dal 2026-09-10): «il Rubyfront/Nexus avversario perde PV pari al numero di Oggetti assegnati alle Entità che controlli». Specchio di card_index.rb, resolve_drain. */
function resolveDrain(effect: Loose): ResolveForm | null {
  if (effect.type !== "lose_health") return null;
  if (!sameShape(effect.target, { cardType: "rubyfront", controller: "opponent" })) return null;
  if (!sameShape(effect.details, { amountEqualsObjectsAssignedToControllerEntities: true })) return null;
  return { kind: "drain", amount: "objects" };
}

/** Le concessioni «mentre assegnato» (RBF-013): evento `while_assigned`,
    effetto `empower` sul portatore, durata `permanent`, con l'eventuale
    razza. Specchio di card_index.rb, grants_while_assigned. */
function grantsWhileAssignedOf(faces: CardFace[]): { keywords: string[]; ifRace: string | null }[] {
  const out: { keywords: string[]; ifRace: string | null }[] = [];
  for (const face of faces) {
    for (const trigger of face.triggers ?? []) {
      if (trigger.event !== "while_assigned") continue;
      const effect = trigger.effect as Loose | undefined;
      if (!effect || effect.type !== "empower" || effect.target?.scope !== "assigned" || effect.duration !== "permanent") continue;
      const keywords = (Array.isArray(effect.grants) ? effect.grants : []).filter((k: unknown): k is string => typeof k === "string");
      if (keywords.length === 0) continue;
      out.push({ keywords, ifRace: typeof effect.details?.ifAssignedRace === "string" ? effect.details.ifAssignedRace : null });
    }
  }
  return out;
}

function flipFormsOf(faces: CardFace[]): FlipForm[] {
  const out: FlipForm[] = [];
  for (const face of faces) {
    for (const trigger of face.triggers ?? []) {
      if (trigger.event !== "on_flip") continue;
      const effect = trigger.effect as Loose | undefined;
      const target = effect?.target as Loose | undefined;
      if (!effect || !target || target.controller !== "controller") continue;
      // «Poi pesca una carta» (dal 2026-09-10).
      if (effect.type === "draw_card") {
        if (sameShape(target, { controller: "controller" }) && Number.isInteger(effect.count) && effect.count > 0) out.push({ kind: "draw", count: effect.count });
        continue;
      }
      if (typeof target.cardId !== "string") continue;
      if (effect.type === "move_card" && effect.from?.zone === "front" && effect.destination?.zone === "abyss") {
        out.push({ kind: "move", cardId: target.cardId, from: "field", to: "abisso" });
      } else if (effect.type === "restrict_action" && effect.restricts === "play" && effect.duration === "permanent" && effect.details?.followsCard === true) {
        out.push({ kind: "seal", cardId: target.cardId });
      }
    }
  }
  return out;
}

/**
 * Le abilità speciali del Rubyfront/Nexus (§3.1), specchio di
 * card_index.rb, abilities: dalle `actions` di ogni faccia, con la forma
 * certificata dell'effetto (sguardo, potenziamento, sconto, chiamata sul
 * Fronte) o null.
 */
function abilitiesOf(faces: CardFace[]): Ability[] {
  const out: Ability[] = [];
  faces.forEach((face, index) => {
    for (const action of ((face as Loose).actions ?? []) as Loose[]) {
      if (!action || typeof action.id !== "string") continue;
      const timing: Phase[] = [];
      for (const when of Array.isArray(action.timing) ? action.timing : []) {
        if (when === "own_preparation") timing.push("preparazione");
        if (when === "own_front") timing.push("fronte");
      }
      if (timing.length === 0) continue;
      const cost = Number.isInteger(action.cost?.health) ? (action.cost.health as number) : null;
      const gain = Number.isInteger(action.gain?.health) ? (action.gain.health as number) : null;
      if (cost === null && gain === null) continue;
      out.push({
        id: action.id,
        displayKey: typeof action.displayKey === "string" ? action.displayKey : action.id,
        face: index,
        timing,
        cost,
        gain,
        fury: Array.isArray(action.checks) && action.checks.includes("fury"),
        form: abilityFormOf(action.effect as Loose | undefined),
      });
    }
  });
  return out;
}

function abilityFormOf(effect: Loose | undefined): AbilityForm | null {
  if (!effect) return null;
  if (effect.type === "look_and_optionally_move") {
    const from = effect.from as Loose | undefined;
    const d = effect.details as Loose | undefined;
    if (!from || from.zone !== "deck" || from.owner !== "controller" || from.position !== "top" || !Number.isInteger(from.count)) return null;
    if (!d || d.revealTo?.zone !== "hand" || d.restTo?.zone !== "deck" || d.restTo?.position !== "bottom") return null;
    const may = d.mayReveal as Loose | undefined;
    if (!may || (may.cardType !== "entity" && may.cardType !== "object")) return null;
    return { kind: "look", count: from.count as number, reveal: { kind: may.cardType, race: typeof may.race === "string" ? may.race : null } };
  }
  if (effect.type === "modify_power") {
    const target = effect.target as Loose | undefined;
    if (!target || target.cardType !== "entity" || target.controller !== "controller") return null;
    if (!Number.isInteger(effect.amount) || effect.duration !== "until_end_of_turn") return null;
    const all = target.quantity === "all";
    const one = target.min === 1 && target.max === 1;
    if (!all && !one) return null;
    const details = (target.details ?? {}) as Loose;
    return { kind: "power", amount: effect.amount as number, targets: all ? "all" : "one", race: typeof target.race === "string" ? target.race : null, attacking: details.attacking === true, armed: details.hasObjectAssigned === true };
  }
  if (effect.type === "reduce_cost") {
    if (!Number.isInteger(effect.amount) || effect.details?.nextPlayedThisTurn !== true) return null;
    const filter = (effect.target ?? effect.filter) as Loose | undefined;
    if (!filter || (filter.cardType !== "entity" && filter.cardType !== "object")) return null;
    return { kind: "discount", amount: effect.amount as number, type: filter.cardType, race: typeof filter.race === "string" ? filter.race : null };
  }
  if (effect.type === "move_card") {
    // La chiamata sul Fronte (RBF-001, Nexus): un'Entità dalla mano senza
    // costo, con parole chiave fino a fine turno, e +N alle prossime
    // Entità Umane che attaccano nel turno. Specchio di card_index.rb.
    const target = effect.target as Loose | undefined;
    const d = effect.details as Loose | undefined;
    if (!target || target.cardType !== "entity" || target.controller !== "controller" || target.min !== 0 || target.max !== 1) return null;
    if (effect.from?.zone !== "hand" || effect.from?.owner !== "controller") return null;
    if (effect.destination?.zone !== "front" || effect.destination?.owner !== "controller") return null;
    if (!d || d.noFluxCost !== true) return null;
    const grants = Array.isArray(d.grants) ? (d.grants as unknown[]) : [];
    if (!grants.every(keyword => typeof keyword === "string")) return null;
    const bonus = d.thenNextHumanAttackersThisTurn as Loose | undefined;
    if (!bonus || !Number.isInteger(bonus.powerBonus) || bonus.duration !== "until_end_of_turn") return null;
    return { kind: "summon", race: typeof target.race === "string" ? target.race : null, grants: grants as string[], bonus: { amount: bonus.powerBonus as number, race: "human" } };
  }
  return null;
}

/** La soglia della Furia per faccia (§8.1). Specchio di card_index.rb, fury_at. */
function furyAtOf(faces: CardFace[]): Record<number, number> {
  const out: Record<number, number> = {};
  faces.forEach((face, index) => {
    const fury = ((face.keywords ?? []) as Loose[]).find(keyword => keyword && keyword.id === "fury");
    if (!fury) return;
    const at = (fury.check as Loose | undefined)?.successAtLeast;
    out[index] = Number.isInteger(at) ? (at as number) : 12;
  });
  return out;
}

/** Il requisito del Nexus nella lingua di chi legge (la riga «Controlli almeno …, poi flippa»). */
export function nexusRequirementCopy(cardId: string, locale: string): string {
  const card = getCard(cardId);
  const copy = card ? (localized(card, locale) as Loose | null) : null;
  const text = copy?.card?.nexusRequirement?.text;
  return typeof text === "string" ? text : "";
}

/** Nome e testo di un'abilità speciale nella lingua di chi legge. */
export function abilityCopy(cardId: string, faceIndex: number, displayKey: string, locale: string): { name: string; text: string } {
  const card = getCard(cardId);
  const face = card?.faces[faceIndex];
  const copy = card ? localized(card, locale) : null;
  const entry = ((copy as Loose | null)?.[face?.displayKey ?? ""]?.abilities?.[displayKey] ?? {}) as Loose;
  return { name: typeof entry.name === "string" ? entry.name : displayKey, text: typeof entry.text === "string" ? entry.text : "" };
}

function nexusOf(faces: CardFace[]): NexusRequirement | null {
  const rubyfront = faces.find(face => face.kind === "rubyfront");
  const nexusIndex = faces.findIndex(face => face.kind === "nexus");
  if (!rubyfront || nexusIndex < 0) return null;
  const requirement = (rubyfront.requirements as Loose | undefined)?.nexus as Loose | undefined;
  if (!requirement || requirement.match !== "all") return null;
  const conditions: NexusRequirement["conditions"] = [];
  for (const condition of (Array.isArray(requirement.conditions) ? requirement.conditions : []) as Loose[]) {
    if (condition?.type !== "controls_card" || condition.owner !== "controller" || !Number.isInteger(condition.min)) return null;
    const filter = condition.filter as Loose | undefined;
    if (!filter || filter.cardType !== "entity" || !Object.keys(filter).every(key => key === "cardType" || key === "race" || key === "details")) return null;
    // «Con un Oggetto assegnato» (dal 2026-09-10): l'unico dettaglio certificato. Specchio di card_index.rb, nexus_of.
    const details = filter.details as Loose | undefined;
    const armed = details !== undefined && Object.keys(details).length === 1 && details.hasObjectAssigned === true;
    if (details !== undefined && !armed) return null;
    conditions.push({ count: condition.min, kind: "entity", race: typeof filter.race === "string" ? filter.race : null, ...(armed ? { armed: true as const } : {}) });
  }
  if (conditions.length === 0) return null;
  const costs = (Array.isArray(requirement.flipCost) ? requirement.flipCost : []) as Loose[];
  if (costs.length > 1) return null;
  let discard: NexusRequirement["discard"] = null;
  if (costs.length === 1) {
    const cost = costs[0];
    if (cost?.type !== "discard_card" || cost.count !== 1 || cost.target?.controller !== "controller") return null;
    discard = { count: 1, kind: typeof cost.filter?.cardType === "string" ? cost.filter.cardType : null };
  }
  const recovery = faces[nexusIndex].stats?.healthRecovery;
  return { face: nexusIndex, conditions, discard, recovery: Number.isInteger(recovery) ? (recovery as number) : null };
}

/** Il costo di schieramento del Rubyfront (§3.1): fisso, o un dado. */
export interface Deployment {
  fixed: number | null;
  die: number | null;
}

export function cardStats(cardId: string): {
  kind: CardFace["kind"] | null;
  race: string | null;
  power: number | null;
  counterattack: number | null;
  /** I PV stampati sul Rubyfront (§3.1): i PV con cui il giocatore inizia. Specchio di card_index.rb, health. */
  health: number | null;
  fluxCost: number | null;
  keywords: string[];
  deployment: Deployment | null;
  enterListeners: EnterListener[];
  enterMoves: EnterMove[];
  behavior: string | null;
  enterReturns: EnterReturn[];
  enterLooks: EnterLook[];
  enterControls: EnterControl[];
  enterRefreshes: EnterRefresh[];
  enterDisarms: EnterDisarm[];
  enterRearms: EnterRearm[];
  leaveReturns: LeaveReturn[];
  attackReturns: EnterReturn[];
  attackDraws: AttackDraw[];
  attackForms: AttackForm[];
  staticForms: StaticForm[];
  resolveForms: ResolveForm[];
  flipForms: FlipForm[];
  assignForms: AssignForm[];
  deathForms: DeathForm[];
  nexus: NexusRequirement | null;
  abilities: Ability[];
  furyAt: Record<number, number>;
  grantsWhileAssigned: { keywords: string[]; ifRace: string | null }[];
} {
  const card = getCard(cardId);
  const face = card?.faces.find(candidate => candidate.kind === "entity") ?? card?.faces[0];
  const integer = (value: unknown): number | null => (Number.isInteger(value) ? (value as number) : null);
  return {
    kind: face?.kind ?? null,
    race: typeof face?.race === "string" ? face.race : null,
    // Le parole chiave stampate sulla faccia (§8.1). Specchio di card_index.rb, keywords.
    keywords: ((face?.keywords ?? []) as unknown[]).flatMap(keyword =>
      typeof keyword === "object" && keyword !== null && typeof (keyword as { id?: unknown }).id === "string" ? [(keyword as { id: string }).id] : []
    ),
    enterListeners: enterListenersOf(face),
    enterMoves: enterMovesOf(face),
    behavior: typeof face?.behavior === "string" ? face.behavior : null,
    enterReturns: enterReturnsOf(face, "on_enter_field"),
    attackReturns: enterReturnsOf(face, "on_attack"),
    attackDraws: attackDrawsOf(face),
    attackForms: attackFormsOf(card?.faces ?? []),
    staticForms: staticFormsOf(card?.faces ?? []),
    resolveForms: resolveFormsOf(card?.faces ?? []),
    flipForms: flipFormsOf(card?.faces ?? []),
    assignForms: assignFormsOf(card?.faces ?? []),
    deathForms: deathFormsOf(card?.faces ?? []),
    nexus: nexusOf(card?.faces ?? []),
    abilities: abilitiesOf(card?.faces ?? []),
    furyAt: furyAtOf(card?.faces ?? []),
    grantsWhileAssigned: grantsWhileAssignedOf(card?.faces ?? []),
    enterLooks: enterLooksOf(face),
    enterControls: enterControlsOf(face),
    enterRefreshes: enterRefreshesOf(face),
    enterDisarms: enterDisarmsOf(face),
    enterRearms: enterRearmsOf(face),
    leaveReturns: leaveReturnsOf(face),
    power: integer(face?.stats?.power),
    counterattack: integer(face?.stats?.counterattack),
    health: integer(card?.faces.find(candidate => candidate.kind === "rubyfront")?.stats?.health),
    // Il costo di Flusso stampato (§3.2); il Rubyfront ha il costo di
    // schieramento, un'altra cosa, e qui resta null.
    fluxCost: integer(face?.stats?.fluxCost),
    deployment: deploymentOf(face?.stats?.deploymentCost),
  };
}

/**
 * Il costo di schieramento com'è nei dati: `3`, `{ base: 3 }` o
 * `{ die: "d6" }` (§3.1, «un numero fisso oppure un dado»). Forma ignota:
 * null, e lo schieramento si regola a mano.
 */
function deploymentOf(value: unknown): Deployment | null {
  if (Number.isInteger(value)) return { fixed: value as number, die: null };
  if (!value || typeof value !== "object") return null;
  const raw = value as { base?: unknown; die?: unknown };
  if (Number.isInteger(raw.base)) return { fixed: raw.base as number, die: null };
  const die = typeof raw.die === "string" ? /^d(\d+)$/.exec(raw.die) : null;
  if (die) return { fixed: null, die: Number(die[1]) };
  return null;
}

/** Il Rubyfront non si pesca mai (§3.1): parte in Zona di Richiamo. */
export function isRubyfront(cardId: string): boolean {
  return getCard(cardId)?.faces.some(face => face.kind === "rubyfront") ?? false;
}

/**
 * La scheda di una carta per chi ragiona senza DOM (turn.ts, combat.ts, la
 * sessione, il tavolo del gioco): il nome nella lingua del tavolo e ciò che
 * il combattimento e gli effetti leggono. È `Ctx.card`.
 */
export function cardFacts(cardId: string, locale: string): CardFacts {
  const stats = cardStats(cardId);
  return {
    name: cardName(cardId, locale),
    kind: stats.kind,
    abilities: stats.abilities,
    furyAt: stats.furyAt,
    race: stats.race,
    power: stats.power,
    counterattack: stats.counterattack,
    fluxCost: stats.fluxCost,
    keywords: stats.keywords,
    enterListeners: stats.enterListeners,
    enterMoves: stats.enterMoves,
    behavior: stats.behavior,
    enterReturns: stats.enterReturns,
    enterLooks: stats.enterLooks,
    enterControls: stats.enterControls,
    enterDisarms: stats.enterDisarms,
    enterRearms: stats.enterRearms,
    leaveReturns: stats.leaveReturns,
    enterRefreshes: stats.enterRefreshes,
    attackReturns: stats.attackReturns,
    attackDraws: stats.attackDraws,
    attackForms: stats.attackForms,
    staticForms: stats.staticForms,
    resolveForms: stats.resolveForms,
    flipForms: stats.flipForms,
    assignForms: stats.assignForms,
    deathForms: stats.deathForms,
    nexus: stats.nexus,
    grantsWhileAssigned: stats.grantsWhileAssigned,
  };
}
