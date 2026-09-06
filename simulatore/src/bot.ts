// L'avversario automatico: la parte senza DOM, provabile con uno stato finto.
//
// Il bot non conosce scorciatoie: gioca attraverso le stesse azioni di un
// giocatore (giocare una carta, schierare, dichiarare, chiudere la fase) e
// passa dallo stesso arbitro. Qui stanno solo le DECISIONI: cosa vale una
// carta, con chi attaccare, con chi bloccare, cosa giocare, cosa scartare.
// La guida che le esegue un passo alla volta sta in main.ts (botTick), e le
// finestre di scelta del tavolo (mira, conferme, pile) rispondono da sole
// con `pickBest` quando chi agisce è il bot.
//
// Difficoltà: MEDIA (la sola, per ora). Regole del pollice, non ricerca:
// attacca con chi non muore, va all'assalto se il colpo è letale, blocca
// per uccidere o per non morire, gioca la carta che rende di più per Flusso.

import type { CardFacts } from "./ctx.js";
import { hasKeyword, powerOf } from "./combat.js";
import { resolveSteps } from "./effects.js";
import { controllerOf, fieldCards, freeFrontSlotOrNull, matterSpot, zoneCards } from "./state.js";
import type { CardInstance, GameState, Seat } from "./types.js";
import { otherSeat } from "./types.js";

export type Facts = (cardId: string) => CardFacts;

/** Ciò che il bot ricorda dentro un turno: si azzera al cambio di turno. */
export interface BotMemory {
  turn: number;
  /** Le Entità che ha giocato in questo turno: attesa di evocazione (§6.2). */
  entered: Set<string>;
  /** Le carte che ha provato a giocare e l'arbitro ha fermato: non insiste. */
  tried: Set<string>;
  /** L'ondata è già stata dichiarata in questo turno. */
  attacked: boolean;
  /** I blocchi di questa Reazione sono già stati decisi. */
  blocked: boolean;
}

export function freshMemory(turn: number): BotMemory {
  return { turn, entered: new Set(), tried: new Set(), attacked: false, blocked: false };
}

/** Il peso di una parola chiave stampata o concessa, in punti di Potenza. */
const KEYWORD_WORTH: Record<string, number> = { surge: 1, revenge: 1, stasis: 1.5, fury: 0.5 };

/**
 * Quanto vale una carta, in una scala comune: per un'Entità la Potenza
 * attuale più le parole chiave; un Oggetto un punto e mezzo; una Materia
 * due; il Rubyfront moltissimo (non si scarta, non si sacrifica).
 */
export function cardValue(state: GameState, card: CardInstance, facts: Facts): number {
  const f = facts(card.cardId);
  if (f.kind === "rubyfront" || f.kind === "nexus") return 100;
  if (f.kind === "entity") {
    const power = powerOf(card, facts, state) ?? f.power ?? 0;
    const keys = [...f.keywords, ...(card.grants ?? [])].reduce((sum, key) => sum + (KEYWORD_WORTH[key] ?? 0), 0);
    return power + keys;
  }
  if (f.kind === "object") return 1.5;
  if (f.kind === "matter") return 2;
  return 0;
}

/** Le Entità in campo comandate da `seat`, stappate e scoperte. */
export function readyEntities(state: GameState, seat: Seat, facts: Facts): CardInstance[] {
  return fieldCards(state).filter(
    card => controllerOf(card) === seat && facts(card.cardId).kind === "entity" && !card.tapped && !card.facedown
  );
}

/** Il totale di un contrattacco: Potenza più Contrattacco stampato e concesso (§6.3). */
function counterTotal(state: GameState, card: CardInstance, facts: Facts): number {
  const power = powerOf(card, facts, state) ?? 0;
  const printed = facts(card.cardId).counterattack;
  return printed === null ? -1 : power + printed + (card.counterBonus ?? 0);
}

/**
 * Può attaccare adesso? Entità stappata e scoperta, con Potenza, non
 * entrata in questo turno — salvo Slancio (§6.2, attesa di evocazione).
 */
export function canAttackNow(state: GameState, card: CardInstance, facts: Facts, memory: BotMemory): boolean {
  if (card.zone !== "field" || card.tapped || card.facedown) return false;
  if (facts(card.cardId).kind !== "entity") return false;
  if ((powerOf(card, facts, state) ?? 0) <= 0) return false;
  if (memory.entered.has(card.uid) && !hasKeyword(card, "surge", facts, state)) return false;
  return true;
}

/**
 * Con chi attaccare (§6.3). I bloccanti possibili sono le Entità avversarie
 * stappate e scoperte che possono bloccare. Un attaccante è SICURO se nessun
 * bloccante lo uccide: in blocco muore solo a Potenza pari (o sotto una
 * Vendetta più forte), in contrattacco se il totale lo raggiunge. Si attacca
 * con i sicuri; con tutti se il colpo che passa è letale (i bloccanti
 * fermano al più uno ciascuno, i più forti); con chi almeno pareggia lo
 * scambio quando il Rubyfront avversario è già sotto la metà.
 */
export function chooseAttackers(state: GameState, seat: Seat, facts: Facts, memory: BotMemory): CardInstance[] {
  const foe = otherSeat(seat);
  const candidates = fieldCards(state)
    .filter(card => controllerOf(card) === seat && canAttackNow(state, card, facts, memory))
    .sort((a, b) => (powerOf(b, facts, state) ?? 0) - (powerOf(a, facts, state) ?? 0));
  if (candidates.length === 0) return [];
  const blockers = readyEntities(state, foe, facts).filter(card => !card.cannotBlock);
  const killPower = (attacker: CardInstance): boolean =>
    blockers.some(b => {
      const power = powerOf(b, facts, state) ?? 0;
      const mine = powerOf(attacker, facts, state) ?? 0;
      if (power === mine) return true;
      if (hasKeyword(b, "revenge", facts, state) && power > mine) return true;
      return counterTotal(state, b, facts) >= mine;
    });
  const maxBlock = blockers.reduce((max, b) => Math.max(max, powerOf(b, facts, state) ?? 0), 0);
  const safe = candidates.filter(card => !killPower(card));
  // Il colpo letale: ogni bloccante ferma un attaccante (i più forti);
  // passa la somma degli altri.
  const powers = candidates.map(card => powerOf(card, facts, state) ?? 0);
  const passing = powers.slice(blockers.length).reduce((sum, p) => sum + p, 0);
  const foeHp = state.players[foe].hp;
  if (passing >= foeHp) return candidates;
  const pressing = foeHp <= 10;
  return candidates.filter(card => {
    if (safe.includes(card)) return true;
    const power = powerOf(card, facts, state) ?? 0;
    return pressing && power >= maxBlock;
  });
}

export interface BotBlock {
  blocker: CardInstance;
  attacker: CardInstance;
  kind: "block" | "counter";
}

/**
 * Come difendersi (§6.4). Per ogni attaccante, dal più forte: un
 * contrattacco che lo uccide e sopravvive; se no un blocco che lo ferma
 * senza morire (Potenza maggiore, o Stasi); se no un pareggio, quando
 * l'attaccante vale almeno quanto il bloccante; se no, e solo se i PV sono
 * in pericolo, il sacrificio della carta che vale meno. Ogni bloccante
 * blocca una volta.
 */
export function chooseBlocks(state: GameState, seat: Seat, facts: Facts): BotBlock[] {
  const foe = otherSeat(seat);
  const onField = (uid: string): CardInstance | undefined => {
    const card = state.cards[uid];
    return card && card.zone === "field" ? card : undefined;
  };
  const attackers = state.declarations
    .filter(d => d.kind === "attack" && d.seat === foe && onField(d.from))
    .sort((a, b) => a.order - b.order)
    .map(d => onField(d.from)!)
    .sort((a, b) => (powerOf(b, facts, state) ?? 0) - (powerOf(a, facts, state) ?? 0));
  const free = readyEntities(state, seat, facts).filter(card => !card.cannotBlock);
  const blocks: BotBlock[] = [];
  const used = new Set<string>();
  let incoming = attackers.reduce((sum, a) => sum + (powerOf(a, facts, state) ?? 0), 0);
  const hp = state.players[seat].hp;
  for (const attacker of attackers) {
    const power = powerOf(attacker, facts, state) ?? 0;
    const available = free.filter(card => !used.has(card.uid));
    const pick = (chosen: CardInstance | undefined, kind: "block" | "counter"): boolean => {
      if (!chosen) return false;
      used.add(chosen.uid);
      blocks.push({ blocker: chosen, attacker, kind });
      incoming -= power;
      return true;
    };
    // Il contrattacco che uccide e resta in piedi: il totale supera la
    // Potenza dell'attaccante (a pari muoiono entrambi).
    const slayer = available
      .filter(card => counterTotal(state, card, facts) > power)
      .sort((a, b) => counterTotal(state, a, facts) - counterTotal(state, b, facts))[0];
    if (pick(slayer, "counter")) continue;
    // Il muro: più forte, o in Stasi (non muore mai bloccando).
    const wall = available
      .filter(card => (powerOf(card, facts, state) ?? 0) > power || hasKeyword(card, "stasis", facts, state))
      .sort((a, b) => (powerOf(a, facts, state) ?? 0) - (powerOf(b, facts, state) ?? 0))[0];
    if (pick(wall, "block")) continue;
    // Lo scambio alla pari, se conviene.
    const trade = available.find(
      card => (powerOf(card, facts, state) ?? 0) === power && cardValue(state, attacker, facts) >= cardValue(state, card, facts)
    );
    if (pick(trade, "block")) continue;
    // Il sacrificio, solo se il colpo fa male davvero.
    if (hp - incoming <= 4 || incoming >= hp) {
      const chump = available.sort((a, b) => cardValue(state, a, facts) - cardValue(state, b, facts))[0];
      if (pick(chump, "block")) continue;
    }
  }
  return blocks;
}

export type BotPlay =
  | { kind: "entity" | "matter"; card: CardInstance; spot: { x: number; y: number }; useToken: boolean }
  | { kind: "object"; card: CardInstance; to: CardInstance; useToken: boolean };

/**
 * La carta da giocare adesso (§6.2, Preparazione): fra quelle in mano che
 * il Flusso copre — barra, e Gettone se serve un solo Flusso in più — la
 * più conveniente: Entità con uno slot libero (Potenza e parole chiave),
 * Oggetti se c'è un'Entità da armare (la più forte, disarmata), Materie
 * normali o permanenti con un passo che agisce davvero. Le Reattive
 * aspettano una difficoltà più alta. Nessuna carta: null.
 */
export function choosePlay(state: GameState, seat: Seat, facts: Facts, memory: BotMemory): BotPlay | null {
  const player = state.players[seat];
  const hand = zoneCards(state, seat, "hand").filter(card => !memory.tried.has(card.uid));
  const slot = freeFrontSlotOrNull(state, seat);
  const mine = fieldCards(state).filter(card => controllerOf(card) === seat && facts(card.cardId).kind === "entity");
  const worn = new Set(fieldCards(state).filter(card => card.assignedTo).map(card => card.assignedTo!));
  const options: { play: BotPlay; score: number }[] = [];
  for (const card of hand) {
    const f = facts(card.cardId);
    const cost = f.fluxCost;
    if (cost === null || f.kind === "rubyfront" || f.kind === "nexus") continue;
    const useToken = cost > player.flux;
    if (useToken && (!player.token || cost > player.flux + 1)) continue;
    const bonus = useToken ? -0.5 : 0;
    if (f.kind === "entity") {
      if (!slot) continue;
      options.push({ play: { kind: "entity", card, spot: slot, useToken }, score: cardValue(state, card, facts) * 2 + bonus });
    } else if (f.kind === "object") {
      const bearer = mine
        .filter(entity => !worn.has(entity.uid))
        .sort((a, b) => cardValue(state, b, facts) - cardValue(state, a, facts))[0] ?? mine[0];
      if (!bearer) continue;
      options.push({ play: { kind: "object", card, to: bearer, useToken }, score: 1.5 + cardValue(state, bearer, facts) / 2 + bonus });
    } else if (f.kind === "matter") {
      if (f.behavior === "reactive") continue;
      const steps = resolveSteps(state, card, facts);
      const acts = steps.length === 0 ? f.behavior === "permanent" : steps.some(step => step.blocked === null && step.form.kind !== "block");
      if (!acts) continue;
      options.push({ play: { kind: "matter", card, spot: matterSpot(state, seat), useToken }, score: 2 + steps.length + bonus });
    }
  }
  options.sort((a, b) => b.score - a.score);
  return options[0]?.play ?? null;
}

/**
 * Le carte da scartare per stare nei 7 a fine turno (§6.5): quelle che
 * valgono meno, e a pari valore le più care da giocare.
 */
export function chooseDiscards(state: GameState, seat: Seat, facts: Facts): CardInstance[] {
  const hand = zoneCards(state, seat, "hand");
  if (hand.length <= 7) return [];
  return [...hand]
    .sort((a, b) => {
      const value = cardValue(state, a, facts) - cardValue(state, b, facts);
      if (value !== 0) return value;
      return (facts(b.cardId).fluxCost ?? 0) - (facts(a.cardId).fluxCost ?? 0);
    })
    .slice(0, hand.length - 7);
}

/**
 * La scelta fra candidati per un effetto: le carte avversarie, la più
 * forte (è quella da colpire); le proprie, la più forte da potenziare —
 * salvo nello scarto (`weakest`), dove si dà via quella che vale meno.
 */
export function pickBest(state: GameState, seat: Seat, candidates: CardInstance[], facts: Facts, mode: "auto" | "weakest" = "auto"): CardInstance | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => cardValue(state, b, facts) - cardValue(state, a, facts));
  if (mode === "weakest") return sorted[sorted.length - 1];
  const foes = sorted.filter(card => controllerOf(card) !== seat);
  return (foes.length ? foes : sorted)[0];
}
