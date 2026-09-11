// Le decisioni del bot (bot.ts): attacchi, blocchi, cosa giocare, scarti.
// Solo lo stato e l'anagrafe finta: niente DOM, niente arbitro.

import { describe, expect, it } from "vitest";
import type { CardFacts } from "../src/ctx.js";
import { FRONT_SLOT_X, frontRowY } from "../src/ctx.js";
import { cardValue, chooseAbility, chooseAttackers, chooseBlocks, chooseDiscards, chooseFlip, choosePlay, chooseResponse, freshMemory, pickBest } from "../src/bot.js";
import { newGame } from "../src/state.js";
import type { CardInstance, GameState, Seat } from "../src/types.js";

const BASE: Omit<CardFacts, "name" | "kind" | "race" | "power" | "counterattack" | "fluxCost" | "keywords" | "behavior"> = {
  enterListeners: [],
  enterMoves: [],
  enterReturns: [],
  enterLooks: [],
  enterControls: [],
  enterRefreshes: [],
  attackReturns: [],
  attackDraws: [],
  attackForms: [],
  staticForms: [],
  resolveForms: [],
  flipForms: [], assignForms: [], deathForms: [],
  nexus: null,
  abilities: [],
  furyAt: {},
  grantsWhileAssigned: [],
};
const CARDS: Record<string, Partial<CardFacts>> = {
  GRANDE: { kind: "entity", race: "human", power: 4, fluxCost: 4 },
  MEDIA: { kind: "entity", race: "human", power: 2, fluxCost: 2 },
  PICCOLA: { kind: "entity", race: "human", power: 1, fluxCost: 1 },
  LANCIA: { kind: "entity", race: "human", power: 1, fluxCost: 2, counterattack: 3 },
  ROCCIA: { kind: "entity", race: "human", power: 1, fluxCost: 2, keywords: ["stasis"] },
  FERRO: { kind: "object", fluxCost: 1 },
  PIETRA: { kind: "matter", fluxCost: 1, behavior: "permanent" },
  SCATTO: { kind: "matter", fluxCost: 2, behavior: "reactive", resolveForms: [{ kind: "empower", targets: "own_entity", race: null, power: 1, untap: true }] },
  RIPARO: { kind: "matter", fluxCost: 2, behavior: "reactive", resolveForms: [{ kind: "block", requiresArmed: 0, heal: 0, asBlock: true }] },
  RUBINO: { kind: "rubyfront", power: null },
  // Un Rubyfront con le forme certificate delle abilità (§3.1): lo sguardo
  // che recupera PV (con la Furia), la carica che costa PV a chi attacca,
  // e sul Nexus lo sconto gratuito; il flip vuole 2 Umani e lo scarto di un'Entità.
  CORONA: {
    kind: "rubyfront",
    power: null,
    furyAt: { 0: 13 },
    abilities: [
      { id: "sguardo", displayKey: "sguardo", face: 0, timing: ["preparazione", "fronte"], cost: null, gain: 3, fury: true, form: { kind: "look", count: 3, reveal: { kind: "entity", race: "human" } } },
      { id: "carica", displayKey: "carica", face: 0, timing: ["preparazione", "fronte"], cost: 5, gain: null, fury: true, form: { kind: "power", amount: 1, targets: "all", race: "human", attacking: true, armed: false } },
      { id: "passo", displayKey: "passo", face: 1, timing: ["preparazione", "fronte"], cost: null, gain: 3, fury: false, form: { kind: "discount", amount: 1, type: "entity", race: "human" } },
      { id: "amano", displayKey: "amano", face: 0, timing: ["preparazione"], cost: 7, gain: null, fury: false, form: null },
    ],
    nexus: { face: 1, conditions: [{ count: 2, kind: "entity", race: null }], discard: { count: 1, kind: "entity" }, recovery: 5 },
  },
};
const facts = (cardId: string): CardFacts => ({
  ...BASE,
  name: cardId,
  kind: null,
  race: null,
  power: null,
  counterattack: null,
  fluxCost: null,
  keywords: [],
  behavior: null,
  ...(CARDS[cardId] ?? {}),
});

let serial = 0;
function put(state: GameState, cardId: string, owner: Seat, zone: "field" | "hand" | "deck", extra: Partial<CardInstance> = {}): CardInstance {
  serial += 1;
  const card: CardInstance = {
    uid: `${owner}-${serial}`,
    cardId,
    owner,
    zone,
    face: 0,
    x: zone === "field" ? FRONT_SLOT_X[serial % 5] : 0,
    y: zone === "field" ? frontRowY(owner) : 0,
    order: serial,
    tapped: false,
    facedown: false,
    z: serial,
    ...extra,
  };
  state.cards[card.uid] = card;
  return card;
}

function attack(state: GameState, attacker: CardInstance, target: CardInstance, order: number): void {
  state.declarations.push({ id: `d${order}`, from: attacker.uid, to: target.uid, kind: "attack", seat: attacker.owner, order });
}

describe("attacchi", () => {
  it("attacca con chi non muore, tiene a casa chi verrebbe ucciso", () => {
    const state = newGame("b");
    const big = put(state, "GRANDE", "b", "field");
    const small = put(state, "PICCOLA", "b", "field");
    // Un bloccante alla pari uccide (pareggio: muoiono entrambe, §6.3), e
    // dal 2026-09-11 uccide anche uno più forte: la piccola resta a casa.
    put(state, "PICCOLA", "a", "field");
    const chosen = chooseAttackers(state, "b", facts, freshMemory(1));
    expect(chosen.map(c => c.uid)).toEqual([big.uid]);
    expect(chosen).not.toContain(small);
  });

  it("va all'assalto quando il colpo che passa è letale", () => {
    const state = newGame("b");
    // Un bloccante ferma (e uccide) una delle due medie; l'altra passa per 2,
    // e 2 PV bastano: si va con tutte e due.
    state.players.a.hp = 2;
    put(state, "MEDIA", "b", "field");
    put(state, "MEDIA", "b", "field");
    put(state, "GRANDE", "a", "field");
    expect(chooseAttackers(state, "b", facts, freshMemory(1))).toHaveLength(2);
  });

  it("rispetta l'attesa di evocazione e salta le tappate", () => {
    const state = newGame("b");
    const fresh = put(state, "GRANDE", "b", "field");
    const tapped = put(state, "GRANDE", "b", "field", { tapped: true });
    const memory = freshMemory(1);
    memory.entered.add(fresh.uid);
    expect(chooseAttackers(state, "b", facts, memory)).toEqual([]);
    expect(tapped.tapped).toBe(true);
  });

  it("chi può contrattaccare e ucciderlo lo tiene a casa", () => {
    const state = newGame("b");
    put(state, "MEDIA", "b", "field");
    put(state, "LANCIA", "a", "field");
    expect(chooseAttackers(state, "b", facts, freshMemory(1))).toEqual([]);
  });
});

describe("blocchi", () => {
  it("blocca con un muro, contrattacca per uccidere, sacrifica solo in pericolo", () => {
    const state = newGame("a");
    const ruby = put(state, "RUBINO", "b", "field");
    const a1 = put(state, "GRANDE", "a", "field");
    const a2 = put(state, "MEDIA", "a", "field");
    attack(state, a1, ruby, 1);
    attack(state, a2, ruby, 2);
    const lance = put(state, "LANCIA", "b", "field");
    const small = put(state, "PICCOLA", "b", "field");
    const blocks = chooseBlocks(state, "b", facts);
    // La lancia (1+3=4) pareggia GRANDE: non lo supera, quindi non è un
    // «uccide e resta in piedi»; ma contro MEDIA (2) lo uccide e resta.
    const onMedia = blocks.find(b => b.attacker.uid === a2.uid);
    expect(onMedia?.blocker.uid).toBe(lance.uid);
    expect(onMedia?.kind).toBe("counter");
    // GRANDE (4) contro PICCOLA: nessun muro, i PV sono 20, nessun sacrificio.
    expect(blocks.find(b => b.attacker.uid === a1.uid)).toBeUndefined();
    expect(small.uid).toBeTruthy();
  });

  it("sacrifica la carta che vale meno quando il colpo è letale", () => {
    const state = newGame("a");
    state.players.b.hp = 4;
    const ruby = put(state, "RUBINO", "b", "field");
    const a1 = put(state, "GRANDE", "a", "field");
    attack(state, a1, ruby, 1);
    const small = put(state, "PICCOLA", "b", "field");
    put(state, "MEDIA", "b", "field");
    const blocks = chooseBlocks(state, "b", facts);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].blocker.uid).toBe(small.uid);
    expect(blocks[0].kind).toBe("block");
  });

  it("chi è in Stasi fa da muro anche se più debole", () => {
    const state = newGame("a");
    const ruby = put(state, "RUBINO", "b", "field");
    const a1 = put(state, "GRANDE", "a", "field");
    attack(state, a1, ruby, 1);
    const rock = put(state, "ROCCIA", "b", "field");
    const blocks = chooseBlocks(state, "b", facts);
    expect(blocks[0]?.blocker.uid).toBe(rock.uid);
  });
});

describe("cosa giocare", () => {
  it("gioca l'Entità più forte che il Flusso copre, col Gettone se serve un Flusso in più", () => {
    const state = newGame("b");
    state.players.b.flux = 3;
    state.players.b.token = true;
    put(state, "GRANDE", "b", "hand");
    const media = put(state, "MEDIA", "b", "hand");
    const play = choosePlay(state, "b", facts, freshMemory(1));
    expect(play?.kind).toBe("entity");
    expect(play?.card.cardId).toBe("GRANDE");
    expect(play?.useToken).toBe(true);
    state.players.b.token = false;
    expect(choosePlay(state, "b", facts, freshMemory(1))?.card.uid).toBe(media.uid);
  });

  it("l'Oggetto va sull'Entità più forte disarmata; senza Entità non si gioca", () => {
    const state = newGame("b");
    state.players.b.flux = 1;
    put(state, "FERRO", "b", "hand");
    expect(choosePlay(state, "b", facts, freshMemory(1))).toBeNull();
    const big = put(state, "GRANDE", "b", "field");
    const play = choosePlay(state, "b", facts, freshMemory(1));
    expect(play?.kind).toBe("object");
    expect(play && play.kind === "object" ? play.to.uid : "").toBe(big.uid);
  });

  it("non insiste su una carta fermata", () => {
    const state = newGame("b");
    state.players.b.flux = 4;
    const big = put(state, "GRANDE", "b", "hand");
    const memory = freshMemory(1);
    memory.tried.add(big.uid);
    expect(choosePlay(state, "b", facts, memory)).toBeNull();
  });
});

describe("scarti e scelte", () => {
  it("scarta fino a 7, le carte che valgono meno", () => {
    const state = newGame("b");
    for (let i = 0; i < 8; i += 1) put(state, "GRANDE", "b", "hand");
    put(state, "PICCOLA", "b", "hand");
    const discards = chooseDiscards(state, "b", facts);
    expect(discards).toHaveLength(2);
    expect(discards[0].cardId).toBe("PICCOLA");
  });

  it("pickBest colpisce l'avversario più forte, potenzia il proprio più forte, scarta il più debole", () => {
    const state = newGame("b");
    const big = put(state, "GRANDE", "a", "field");
    const small = put(state, "PICCOLA", "a", "field");
    const mine = put(state, "MEDIA", "b", "field");
    expect(pickBest(state, "b", [small, big], facts)?.uid).toBe(big.uid);
    expect(pickBest(state, "b", [mine], facts)?.uid).toBe(mine.uid);
    expect(pickBest(state, "b", [big, small], facts, "weakest")?.uid).toBe(small.uid);
    expect(cardValue(state, big, facts)).toBe(4);
  });
});

describe("chooseResponse (§7.2, la catena)", () => {
  it("risponde con la Reattiva che agisce e che paga, mai con la bloccante; senza, accetta", () => {
    const state = newGame();
    state.players.b.flux = 2;
    put(state, "PICCOLA", "b", "field");
    const scatto = put(state, "SCATTO", "b", "hand");
    put(state, "RIPARO", "b", "hand");
    expect(chooseResponse(state, "b", facts)?.card.uid).toBe(scatto.uid);
    // Il Gettone in catena non si spende (la catena è atomica): senza barra, si accetta.
    state.players.b.flux = 1;
    state.players.b.token = true;
    expect(chooseResponse(state, "b", facts)).toBeNull();
    // Senza un'Entità da stappare la Reattiva non agisce: si accetta.
    const empty = newGame();
    empty.players.b.flux = 5;
    put(empty, "SCATTO", "b", "hand");
    expect(chooseResponse(empty, "b", facts)).toBeNull();
  });
});

// Le abilità speciali del Rubyfront e il flip verso il Nexus (§3.1).
describe("chooseAbility e chooseFlip (§3.1)", () => {
  function corte(): { state: GameState; ruby: CardInstance } {
    const state = newGame("b");
    state.turn = 4;
    state.phase = "preparazione";
    state.players.b.hp = 20;
    const ruby = put(state, "CORONA", "b", "field");
    put(state, "MEDIA", "b", "deck");
    return { state, ruby };
  }

  it("in Preparazione usa l'abilità gratuita che recupera PV, una sola per turno", () => {
    const { state, ruby } = corte();
    const memory = freshMemory(4);
    const pick = chooseAbility(state, "b", facts, memory);
    expect(pick?.card.uid).toBe(ruby.uid);
    expect(pick?.ability.id).toBe("sguardo");
    // Usata: il turno la segna, e il bot non ne cerca un'altra.
    state.players.b.abilityTurn = 4;
    expect(chooseAbility(state, "b", facts, memory)).toBeNull();
    // Fermata dall'arbitro: annotata, non insiste — e l'altra gratuita non c'è su questa faccia.
    delete state.players.b.abilityTurn;
    memory.abilities.add("sguardo");
    expect(chooseAbility(state, "b", facts, memory)).toBeNull();
  });

  it("senza il Rubyfront schierato, o nel turno altrui, non fa nulla", () => {
    const { state, ruby } = corte();
    // In Zona di Richiamo sta sulla lavagna (zone field) ma non sulla fila
    // del Fronte: abilità e flip aspettano lo schieramento (§3.1).
    const front = ruby.y;
    ruby.y = 0;
    expect(chooseAbility(state, "b", facts, freshMemory(4))).toBeNull();
    put(state, "MEDIA", "b", "field");
    put(state, "MEDIA", "b", "field");
    put(state, "PICCOLA", "b", "hand");
    expect(chooseFlip(state, "b", facts, freshMemory(4))).toBeNull();
    ruby.y = front;
    expect(chooseFlip(state, "b", facts, freshMemory(4))?.uid).toBe(ruby.uid);
    state.active = "a";
    expect(chooseAbility(state, "b", facts, freshMemory(4))).toBeNull();
    expect(chooseFlip(state, "b", facts, freshMemory(4))).toBeNull();
  });

  it("paga il potenziamento a ondata dichiarata quando i punti comprati valgono il prezzo", () => {
    const { state } = corte();
    state.phase = "fronte";
    const memory = freshMemory(4);
    const foe = put(state, "RUBINO", "a", "field");
    const attackers = [put(state, "MEDIA", "b", "field"), put(state, "MEDIA", "b", "field"), put(state, "MEDIA", "b", "field")];
    // Prima dell'ondata no: il bonus andrebbe a chi non attacca.
    expect(chooseAbility(state, "b", facts, memory)?.ability.id).not.toBe("carica");
    attackers.forEach((card, i) => attack(state, card, foe, i + 1));
    memory.attacked = true;
    expect(chooseAbility(state, "b", facts, memory)?.ability.id).toBe("carica");
    // Con due soli attaccanti 2 punti per 5 PV non valgono.
    state.declarations = state.declarations.slice(0, 2);
    expect(chooseAbility(state, "b", facts, memory)?.ability.id).not.toBe("carica");
    // Coi PV bassi non si paga, anche se rende.
    state.declarations = state.declarations.concat({ id: "d3", from: attackers[2].uid, to: foe.uid, kind: "attack", seat: "b", order: 3 });
    state.players.b.hp = 9;
    expect(chooseAbility(state, "b", facts, memory)?.ability.id).not.toBe("carica");
  });

  it("paga sempre il colpo letale", () => {
    const { state } = corte();
    state.phase = "fronte";
    state.players.b.hp = 8;
    state.players.a.hp = 3;
    const foe = put(state, "RUBINO", "a", "field");
    const one = put(state, "MEDIA", "b", "field");
    attack(state, one, foe, 1);
    const memory = freshMemory(4);
    memory.attacked = true;
    // 2 + 1 = 3 ≥ 3 PV, nessun bloccante pronto.
    expect(chooseAbility(state, "b", facts, memory)?.ability.id).toBe("carica");
    // Un bloccante pronto ferma l'unico attaccante: niente colpo, niente spesa.
    put(state, "GRANDE", "a", "field");
    expect(chooseAbility(state, "b", facts, memory)?.ability.id).not.toBe("carica");
  });

  it("le abilità senza forma restano a mano, e a 0 PV non si arriva", () => {
    const { state } = corte();
    const memory = freshMemory(4);
    memory.abilities.add("sguardo");
    expect(chooseAbility(state, "b", facts, memory)).toBeNull();
    // Lo sguardo con la Furia: a 1 PV il fallimento porterebbe a 0.
    memory.abilities.clear();
    state.players.b.hp = 1;
    expect(chooseAbility(state, "b", facts, memory)).toBeNull();
  });

  it("flippa verso il Nexus appena il requisito c'è, e sul Nexus usa lo sconto prima di giocare", () => {
    const { state, ruby } = corte();
    const memory = freshMemory(4);
    put(state, "MEDIA", "b", "field");
    put(state, "PICCOLA", "b", "hand");
    expect(chooseFlip(state, "b", facts, memory)).toBeNull();
    put(state, "MEDIA", "b", "field");
    expect(chooseFlip(state, "b", facts, memory)?.uid).toBe(ruby.uid);
    // Una prova per turno.
    memory.flipped = true;
    expect(chooseFlip(state, "b", facts, memory)).toBeNull();
    // Flippato: la faccia del Nexus ha lo sconto gratuito, e con un Umano in mano vale.
    ruby.face = 1;
    expect(chooseFlip(state, "b", facts, freshMemory(4))).toBeNull();
    expect(chooseAbility(state, "b", facts, freshMemory(4))?.ability.id).toBe("passo");
  });

  it("lo sconto di un'abilità conta nel Flusso: la carta scontata diventa giocabile", () => {
    const state = newGame("b");
    state.players.b.flux = 3;
    state.players.b.token = false;
    state.players.b.discounts = [{ amount: 1, type: "entity", race: "human" }];
    const big = put(state, "GRANDE", "b", "hand");
    expect(choosePlay(state, "b", facts, freshMemory(1))?.card.uid).toBe(big.uid);
    delete state.players.b.discounts;
    expect(choosePlay(state, "b", facts, freshMemory(1))).toBeNull();
  });

  it("fra le proprie carte la mira preferisce chi sta attaccando", () => {
    const state = newGame("b");
    const foe = put(state, "RUBINO", "a", "field");
    const big = put(state, "GRANDE", "b", "field");
    const small = put(state, "PICCOLA", "b", "field");
    attack(state, small, foe, 1);
    expect(pickBest(state, "b", [big, small], facts)?.uid).toBe(small.uid);
  });
});
