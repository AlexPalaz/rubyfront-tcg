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
// per uccidere o per non morire, gioca la carta che rende di più per Flusso,
// usa le abilità del Rubyfront (§3.1) — quelle che recuperano PV sempre,
// quelle che li costano quando l'ondata ci guadagna — e flippa verso il
// Nexus appena il requisito è soddisfatto (dal 2026-09-11).

import type { Ability, CardFacts } from "./ctx.js";
import { hasKeyword, powerOf, wornBy } from "./combat.js";
import { nexusCheck, resolveSteps } from "./effects.js";
import { abilityDiscount, controllerOf, declarationOf, fieldCards, freeFrontSlotOrNull, inPlay, matterSpot, zoneCards } from "./state.js";
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
  /** Ha già giocato la sua Reattiva in Reazione, in questo turno. */
  reacted: boolean;
  /** Le abilità speciali che ha provato in questo turno (id): usate o fermate, non insiste (§3.1). */
  abilities: Set<string>;
  /** Ha già provato il flip verso il Nexus in questo turno. */
  flipped: boolean;
}

export function freshMemory(turn: number): BotMemory {
  return { turn, entered: new Set(), tried: new Set(), attacked: false, blocked: false, reacted: false, abilities: new Set(), flipped: false };
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
 * bloccante lo uccide: in blocco muore se la Potenza del bloccante raggiunge
 * la sua (§6.3) o se il bloccante ha Vendetta (§8.1: si porta dietro chi lo
 * supera), in contrattacco se il totale la raggiunge. Si attacca
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
      if (power >= mine) return true;
      if (hasKeyword(b, "revenge", facts, state)) return true;
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
    // Lo scambio, se conviene: alla pari, o con la Vendetta (§8.1), che
    // muore ma si porta dietro l'attaccante.
    const trade = available.find(
      card =>
        ((powerOf(card, facts, state) ?? 0) === power || hasKeyword(card, "revenge", facts, state)) &&
        cardValue(state, attacker, facts) >= cardValue(state, card, facts)
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
    // Lo sconto di un'abilità del Rubyfront (§3.1) lo applica il tavolo al
    // gioco della carta: qui conta per decidere cosa si paga.
    const cost = f.fluxCost === null ? null : Math.max(0, f.fluxCost - (abilityDiscount(state, seat, f)?.amount ?? 0));
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
 * §7.2 — la risposta in catena: fra le Reattive in mano che la barra del
 * Flusso copre (il Gettone no: la catena è atomica, e spenderlo è un gesto
 * a parte che l'arbitro ferma), quella con un passo che agisce davvero —
 * non la Reattiva bloccante, che in catena non ferma nessuno. Nessuna:
 * null, e il bot accetta.
 */
export function chooseResponse(state: GameState, seat: Seat, facts: Facts): BotPlay | null {
  const player = state.players[seat];
  const options: { play: BotPlay; score: number }[] = [];
  for (const card of zoneCards(state, seat, "hand")) {
    const f = facts(card.cardId);
    if (f.kind !== "matter" || f.behavior !== "reactive" || f.fluxCost === null || f.fluxCost > player.flux) continue;
    const steps = resolveSteps(state, card, facts);
    const acting = steps.filter(step => step.blocked === null && step.form.kind !== "block");
    if (acting.length === 0) continue;
    options.push({ play: { kind: "matter", card, spot: matterSpot(state, seat), useToken: false }, score: acting.length });
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
  if (foes.length) return foes[0];
  // Fra le proprie, prima chi sta attaccando: un potenziamento a ondata
  // dichiarata (§3.1) va a chi lo porta in battaglia.
  const attacking = sorted.filter(card => declarationOf(state, card.uid)?.kind === "attack");
  return (attacking.length ? attacking : sorted)[0];
}

/**
 * Il Rubyfront (o il Nexus) di `seat` SCHIERATO: sulla fila del Fronte, non
 * in Zona di Richiamo, dove sta sulla lavagna ma «abilità e Materie sono
 * utilizzabili solo quando è in campo» (§3.1; inPlay, state.ts). Null se
 * manca o aspetta ancora lo schieramento.
 */
export function rubyfrontInPlay(state: GameState, seat: Seat, facts: Facts): CardInstance | null {
  return (
    fieldCards(state).find(card => {
      if (card.owner !== seat) return false;
      const kind = facts(card.cardId).kind;
      return (kind === "rubyfront" || kind === "nexus") && inPlay(card, kind);
    }) ?? null
  );
}

export interface BotAbility {
  card: CardInstance;
  ability: Ability;
}

/**
 * Sotto quanti PV il bot non paga più un'abilità: pagare fino a 0 è legale
 * ma a 0 si perde (§3.1), e un attacco che passa dopo finisce la partita.
 */
const HP_FLOOR = 6;

/**
 * L'abilità speciale da usare adesso (§3.1): fra quelle della faccia in
 * vista, nella finestra della fase, con una forma che l'arbitro sa leggere
 * (le altre restano a mano), una sola per turno (il flip riapre la
 * finestra: `abilityTurn` si azzera, state.ts). Quelle che RECUPERANO PV
 * si usano sempre, in Preparazione, prima di giocare carte — così lo sconto
 * vale per la carta che segue. Quelle che COSTANO PV si pagano quando
 * rendono: il potenziamento a ondata dichiarata, se i punti di Potenza
 * comprati valgono almeno metà dei PV spesi o se il colpo diventa letale;
 * lo sconto in Preparazione, se rende giocabile una carta in mano. Mai
 * sotto HP_FLOOR, salvo il colpo letale; la Furia (§8.1) costa un PV in
 * più a rischio. Nessuna: null.
 */
export function chooseAbility(state: GameState, seat: Seat, facts: Facts, memory: BotMemory): BotAbility | null {
  const ruby = rubyfrontInPlay(state, seat, facts);
  if (!ruby || state.active !== seat) return null;
  const player = state.players[seat];
  if (player.abilityTurn === state.turn) return null;
  const foe = otherSeat(seat);
  const options: { pick: BotAbility; score: number }[] = [];
  for (const ability of facts(ruby.cardId).abilities) {
    if (ability.face !== ruby.face || !ability.form || !ability.timing.includes(state.phase) || memory.abilities.has(ability.id)) continue;
    const cost = ability.cost ?? 0;
    const gain = ability.gain ?? 0;
    const risk = ability.fury ? 1 : 0;
    // A 0 PV si perde e l'effetto non si risolve: il costo (e la Furia
    // fallita) devono lasciare almeno 1 PV.
    if (player.hp - cost - risk < 1) continue;
    const form = ability.form;
    let worth = 0;
    let lethal = false;
    if (form.kind === "look") {
      // Lo sguardo nel mazzo vale una carta, se c'è da guardare.
      if (state.phase !== "preparazione" || zoneCards(state, seat, "deck").length === 0) continue;
      worth = 1;
    } else if (form.kind === "discount") {
      if (state.phase !== "preparazione") continue;
      const costs = zoneCards(state, seat, "hand")
        .map(card => facts(card.cardId))
        .filter(f => f.kind === form.type && (form.race === null || f.race === form.race) && f.fluxCost !== null)
        .map(f => f.fluxCost as number);
      const flux = player.flux + (player.token ? 1 : 0);
      const unlocks = costs.some(c => c > flux && c - form.amount <= flux);
      worth = costs.length === 0 ? 0 : unlocks ? 3 : 1;
    } else if (form.kind === "summon") {
      // La chiamata sul Fronte: in Preparazione, se in mano c'è un'Entità
      // della razza da mettere giù e uno slot libero — vale il Flusso
      // risparmiato, più lo Slancio e il bonus alle attaccanti.
      if (state.phase !== "preparazione" || !freeFrontSlotOrNull(state, seat)) continue;
      const costs = zoneCards(state, seat, "hand")
        .filter(card => {
          const f = facts(card.cardId);
          return f.kind === "entity" && (form.race === null || f.race === form.race) && !(player.sealed ?? []).includes(card.cardId);
        })
        .map(card => facts(card.cardId).fluxCost ?? 0);
      if (costs.length === 0) continue;
      worth = Math.max(...costs) + form.grants.length + form.bonus.amount;
    } else {
      // Il potenziamento fino a fine turno: a ondata dichiarata (in Fronte),
      // sulle Entità che attaccano — le altre non ne fanno nulla.
      if (state.phase !== "fronte" || !memory.attacked) continue;
      const targets = fieldCards(state).filter(card => {
        if (controllerOf(card) !== seat || declarationOf(state, card.uid)?.kind !== "attack") return false;
        const f = facts(card.cardId);
        if (f.kind !== "entity") return false;
        if (form.race !== null && f.race !== form.race) return false;
        if (form.armed && wornBy(state, card.uid).length === 0) return false;
        return true;
      });
      if (targets.length === 0) continue;
      const count = form.targets === "all" ? targets.length : 1;
      worth = count * form.amount;
      // Il colpo letale: i bloccanti pronti fermano i più forti, il resto
      // passa col bonus (lo stesso conto di chooseAttackers).
      const blockers = readyEntities(state, foe, facts).filter(card => !card.cannotBlock).length;
      const attacking = fieldCards(state)
        .filter(card => controllerOf(card) === seat && declarationOf(state, card.uid)?.kind === "attack")
        .map(card => (powerOf(card, facts, state) ?? 0) + (targets.some(target => target.uid === card.uid) ? form.amount : 0))
        .sort((a, b) => b - a);
      const passing = attacking.slice(blockers).reduce((sum, p) => sum + p, 0);
      lethal = passing >= state.players[foe].hp;
    }
    if (cost > 0 && !lethal) {
      if (player.hp - cost < HP_FLOOR) continue;
      if (worth < cost / 2) continue;
    }
    if (cost === 0 && worth === 0 && gain === 0) continue;
    options.push({ pick: { card: ruby, ability }, score: (lethal ? 100 : 0) + worth + gain - cost - risk * 0.4 });
  }
  options.sort((a, b) => b.score - a.score);
  return options[0]?.pick ?? null;
}

/**
 * Il flip verso il Nexus (§3.1): il Rubyfront in campo con la faccia del
 * Rubyfront in vista e il requisito certificato soddisfatto (nexusCheck —
 * lo scarto lo sceglie il selettore, la carta che vale meno). Il Nexus è
 * più forte e recupera PV: si flippa appena si può, una prova per turno.
 */
export function chooseFlip(state: GameState, seat: Seat, facts: Facts, memory: BotMemory): CardInstance | null {
  if (memory.flipped || state.active !== seat) return null;
  const ruby = rubyfrontInPlay(state, seat, facts);
  if (!ruby) return null;
  const f = facts(ruby.cardId);
  if (f.kind !== "rubyfront" || !f.nexus || ruby.face === f.nexus.face) return null;
  return nexusCheck(state, ruby, facts).ok ? ruby : null;
}
