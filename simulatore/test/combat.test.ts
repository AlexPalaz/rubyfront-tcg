// Le dichiarazioni davanti al poliziotto: se il declare viene fermato
// (es. §6.2, attesa di evocazione), il tap dell'attaccante, la copertura del
// contrattaccante e la riga in chat non devono partire affatto.

import { describe, expect, it } from "vitest";
import { declareAttack, declareBlock, describeBattle, hasKeyword, multiBlock, powerOf, resolveWave, undeclare } from "../src/combat.js";
import { newGame } from "../src/state.js";
import type { Ctx } from "../src/ctx.js";
import { renderLog } from "../src/log.js";
import type { Action, Battle, CardInstance, Declaration, Seat } from "../src/types.js";
import type { CardFacts } from "../src/ctx.js";

function cardOn(uid: string, owner: Seat): CardInstance {
  return {
    uid,
    cardId: `TEST-${uid}`,
    owner,
    zone: "field",
    face: 0,
    x: 0,
    y: 0,
    order: 0,
    tapped: false,
    facedown: false,
    z: 1,
  };
}

/** Le statistiche stampate delle carte di prova (§6.3), per id. */
const facts: Record<string, { power: number; counterattack?: number }> = {};

function fakeCtx(judge: (action: Action) => boolean): { ctx: Ctx; sent: Action[]; logs: string[] } {
  const state = newGame();
  const sent: Action[] = [];
  const logs: string[] = [];
  const ctx: Ctx = {
    state: () => state,
    dispatch(action) {
      const passed = judge(action);
      if (passed) sent.push(action);
      return Promise.resolve(passed);
    },
    seat: () => "a",
    controls: seat => seat === "a",
    arbitrated: () => false,
    themeFor: () => "notte",
    locale: () => "it",
    card: cardId => ({
      name: cardId,
      kind: "entity",
      race: null,
      power: facts[cardId]?.power ?? null,
      counterattack: facts[cardId]?.counterattack ?? null,
      fluxCost: null,
  keywords: [],
      enterListeners: [],
      enterMoves: [],
      behavior: null,
      enterReturns: [],
      enterLooks: [],
      enterControls: [],
      attackReturns: [],
      attackDraws: [],
      attackForms: [],
      staticForms: [],
      resolveForms: [],
      flipForms: [],
      nexus: null,
      grantsWhileAssigned: [],
    }),
    log(text) {
      logs.push(typeof text === "string" ? text : renderLog(text, ctx.state(), id => id));
    },
  };
  return { ctx, sent, logs };
}

describe("declareAttack", () => {
  it("col via libera dichiara, tappa e annota", async () => {
    const { ctx, sent, logs } = fakeCtx(() => true);
    await declareAttack(ctx, cardOn("a-1", "a"), cardOn("rf-b", "b"));
    expect(sent.map(action => action.t)).toEqual(["declare", "tap"]);
    expect(logs).toHaveLength(1);
  });

  it("fermato il declare, niente tap e niente riga", async () => {
    const { ctx, sent, logs } = fakeCtx(action => action.t !== "declare");
    await declareAttack(ctx, cardOn("a-1", "a"), cardOn("rf-b", "b"));
    expect(sent).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

  it("senza bersaglio non dichiara nulla", async () => {
    const { ctx, sent, logs } = fakeCtx(() => true);
    await declareAttack(ctx, cardOn("a-1", "a"), undefined);
    expect(sent).toHaveLength(0);
    expect(logs).toHaveLength(1);
  });
});

describe("declareBlock", () => {
  it("il contrattacco passato copre la carta", async () => {
    const { ctx, sent } = fakeCtx(() => true);
    await declareBlock(ctx, cardOn("a-2", "a"), "b-1", "counter");
    expect(sent.map(action => action.t)).toEqual(["declare", "facedown"]);
  });

  it("fermato il declare, il contrattaccante non si copre", async () => {
    const { ctx, sent, logs } = fakeCtx(action => action.t !== "declare");
    await declareBlock(ctx, cardOn("a-2", "a"), "b-1", "counter");
    expect(sent).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

  it("il blocco semplice non tappa da solo", async () => {
    const { ctx, sent } = fakeCtx(() => true);
    await declareBlock(ctx, cardOn("a-2", "a"), "b-1", "block");
    expect(sent.map(action => action.t)).toEqual(["declare"]);
  });
});

function declarationBy(from: string, kind: Declaration["kind"]): Declaration {
  return { id: "d-1", from, to: "x", kind, seat: "a", order: 1 };
}

describe("undeclare", () => {
  it("l'attacco annullato stappa l'attaccante e annota", async () => {
    const { ctx, sent, logs } = fakeCtx(() => true);
    const card = { ...cardOn("a-1", "a"), tapped: true };
    await undeclare(ctx, card, declarationBy("a-1", "attack"));
    expect(sent.map(action => action.t)).toEqual(["undeclare", "tap"]);
    expect(sent[1]).toMatchObject({ t: "tap", tapped: false });
    expect(logs).toHaveLength(1);
  });

  it("se l'attaccante era già stappato a mano, non c'è nulla da disfare", async () => {
    const { ctx, sent } = fakeCtx(() => true);
    await undeclare(ctx, cardOn("a-1", "a"), declarationBy("a-1", "attack"));
    expect(sent.map(action => action.t)).toEqual(["undeclare"]);
  });

  it("il contrattacco annullato scopre la carta", async () => {
    const { ctx, sent } = fakeCtx(() => true);
    const card = { ...cardOn("a-2", "a"), facedown: true };
    await undeclare(ctx, card, declarationBy("a-2", "counter"));
    expect(sent.map(action => action.t)).toEqual(["undeclare", "facedown"]);
    expect(sent[1]).toMatchObject({ t: "facedown", facedown: false });
  });

  it("il blocco annullato non muove nient'altro", async () => {
    const { ctx, sent } = fakeCtx(() => true);
    await undeclare(ctx, cardOn("a-2", "a"), declarationBy("a-2", "block"));
    expect(sent.map(action => action.t)).toEqual(["undeclare"]);
  });

  it("fermato l'undeclare, niente stappata e niente riga", async () => {
    const { ctx, sent, logs } = fakeCtx(action => action.t !== "undeclare");
    const card = { ...cardOn("a-1", "a"), tapped: true };
    await undeclare(ctx, card, declarationBy("a-1", "attack"));
    expect(sent).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });
});

// La risoluzione dell'ondata (§6.3/§6.4), calcolata a tavolino: lo stesso
// conteggio che fa l'engine (engine.rb, expected_battles) — se un caso
// cambia qui, cambia anche là.
describe("resolveWave", () => {
  const stats: Record<string, { power: number; counterattack?: number }> = {
    FORTE: { power: 4 },
    DEBOLE: { power: 2 },
    PARI: { power: 4 },
    SPINOSO: { power: 3, counterattack: 2 },
  };
  const facts = (cardId: string) => ({
    name: cardId,
    power: stats[cardId]?.power ?? null,
    counterattack: stats[cardId]?.counterattack ?? null,
    keywords: stats[cardId]?.keywords ?? [],
    staticForms: [],
    grantsWhileAssigned: [],
  });
  const field = (uid: string, owner: Seat, cardId: string): CardInstance => ({ ...cardOn(uid, owner), cardId });
  const attack = (from: string, order: number): Declaration => ({ id: from, from, to: "rf-b", kind: "attack", seat: "a", order });
  const block = (from: string, to: string, kind: "block" | "counter"): Declaration => ({ id: from, from, to, kind, seat: "b", order: 0 });

  function table(cards: CardInstance[], declarations: Declaration[]) {
    const state = newGame();
    for (const card of cards) state.cards[card.uid] = card;
    state.declarations = declarations;
    return state;
  }

  it("non bloccato: danni pari alla Potenza, nessuno muore", () => {
    const state = table([field("a1", "a", "FORTE")], [attack("a1", 1)]);
    expect(resolveWave(state, "a", facts)).toEqual([
      { attacker: "a1", kind: "unblocked", attackerDies: false, blockerDies: false, damage: 4 },
    ]);
  });

  it("bloccante inferiore: muore lui, l'attacco è bloccato", () => {
    const state = table([field("a1", "a", "FORTE"), field("b1", "b", "DEBOLE")], [attack("a1", 1), block("b1", "a1", "block")]);
    expect(resolveWave(state, "a", facts)).toEqual([
      { attacker: "a1", blocker: "b1", kind: "block", attackerDies: false, blockerDies: true, damage: 0 },
    ]);
  });

  it("Potenze pari: muoiono entrambi", () => {
    const state = table([field("a1", "a", "FORTE"), field("b1", "b", "PARI")], [attack("a1", 1), block("b1", "a1", "block")]);
    expect(resolveWave(state, "a", facts)![0]).toMatchObject({ attackerDies: true, blockerDies: true });
  });

  it("bloccante superiore: non muore nessuno", () => {
    const state = table([field("a1", "a", "DEBOLE"), field("b1", "b", "FORTE")], [attack("a1", 1), block("b1", "a1", "block")]);
    expect(resolveWave(state, "a", facts)![0]).toMatchObject({ attackerDies: false, blockerDies: false, damage: 0 });
  });

  it("contrattacco: Potenza più N, e l'attaccante muore se superato", () => {
    // 3 + 2 = 5 > 4
    const state = table([field("a1", "a", "FORTE"), field("b1", "b", "SPINOSO")], [attack("a1", 1), block("b1", "a1", "counter")]);
    expect(resolveWave(state, "a", facts)![0]).toMatchObject({ kind: "counter", attackerDies: true, blockerDies: false });
  });

  it("le battaglie vanno nell'ordine di dichiarazione", () => {
    const state = table(
      [field("a1", "a", "FORTE"), field("a2", "a", "DEBOLE")],
      [attack("a2", 1), attack("a1", 2)]
    );
    expect(resolveWave(state, "a", facts)!.map(battle => battle.attacker)).toEqual(["a2", "a1"]);
  });

  it("un attaccante uscito dal campo non ha battaglia", () => {
    const gone = { ...field("a1", "a", "FORTE"), zone: "abisso" as const };
    const state = table([gone, field("a2", "a", "DEBOLE")], [attack("a1", 1), attack("a2", 2)]);
    expect(resolveWave(state, "a", facts)!.map(battle => battle.attacker)).toEqual(["a2"]);
  });

  it("senza la Potenza nel catalogo si arrende", () => {
    const state = table([field("a1", "a", "IGNOTA")], [attack("a1", 1)]);
    expect(resolveWave(state, "a", facts)).toBeNull();
  });
});

// I bonus di Potenza fino a fine turno e la Vendetta (§8.1, §8.2): lo
// stesso conto dell'engine (power_of, has_keyword?).
describe("resolveWave con bonus e Vendetta", () => {
  const stats: Record<string, { power: number; counterattack?: number; keywords?: string[] }> = {
    FORTE: { power: 4 },
    PARI: { power: 4 },
    VENDICATIVO: { power: 5, keywords: ["revenge"] },
    GRANDE: { power: 5 },
  };
  const facts = (cardId: string) => ({
    name: cardId,
    power: stats[cardId]?.power ?? null,
    counterattack: stats[cardId]?.counterattack ?? null,
    keywords: stats[cardId]?.keywords ?? [],
    staticForms: [],
    grantsWhileAssigned: [],
  });
  const card = (uid: string, owner: Seat, cardId: string, extra: Partial<CardInstance> = {}): CardInstance => ({
    uid, cardId, owner, zone: "field", face: 0, x: 0, y: 0, order: 0, tapped: false, facedown: false, z: 1, ...extra,
  });
  function table(cards: CardInstance[], declarations: Declaration[]) {
    const state = newGame();
    for (const c of cards) state.cards[c.uid] = c;
    state.declarations = declarations;
    return state;
  }
  const attack = (from: string): Declaration => ({ id: from, from, to: "rf-b", kind: "attack", seat: "a", order: 1 });
  const block = (from: string, to: string): Declaration => ({ id: from, from, to, kind: "block", seat: "b", order: 0 });

  it("il bonus si somma alla Potenza stampata", () => {
    const state = table([card("a1", "a", "FORTE", { powerBonus: 1 }), card("b1", "b", "PARI")], [attack("a1"), block("b1", "a1")]);
    expect(resolveWave(state, "a", facts as never)![0]).toMatchObject({ attackerDies: false, blockerDies: true });
    const unblocked = table([card("a1", "a", "FORTE", { powerBonus: 2 })], [attack("a1")]);
    expect(resolveWave(unblocked, "a", facts as never)![0].damage).toBe(6);
  });

  it("chi blocca con Vendetta e supera l'attaccante lo uccide", () => {
    const state = table([card("a1", "a", "FORTE"), card("b1", "b", "VENDICATIVO")], [attack("a1"), block("b1", "a1")]);
    expect(resolveWave(state, "a", facts as never)![0]).toMatchObject({ attackerDies: true, blockerDies: false });
    const plain = table([card("a1", "a", "FORTE"), card("b1", "b", "GRANDE")], [attack("a1"), block("b1", "a1")]);
    expect(resolveWave(plain, "a", facts as never)![0]).toMatchObject({ attackerDies: false, blockerDies: false });
  });

  it("la Vendetta concessa fino a fine turno vale come quella stampata", () => {
    const state = table([card("a1", "a", "FORTE"), card("b1", "b", "GRANDE", { grants: ["revenge"] })], [attack("a1"), block("b1", "a1")]);
    expect(resolveWave(state, "a", facts as never)![0].attackerDies).toBe(true);
  });
});

// Eredità Perduta nella risoluzione: gli statici (§8.2), la Stasi (§8.1), il
// blocco multiplo (RBF-014), la Reattiva come blocco (§6.4), il Contrattacco
// concesso (RBF-020). Gemello: engine_test.rb, «Eredità Perduta».
describe("resolveWave con statici, Stasi e più bloccanti", () => {
  const EREDITA: Record<string, Partial<CardFacts>> = {
    RAGAZZO: { kind: "entity", race: "human", power: 1, staticForms: [{ kind: "self_power", amount: 1, whileAttacking: true, requiresOther: { kind: "entity", race: "human" } }] },
    SIMULACRO: { kind: "entity", race: "simulacrum", power: 3, staticForms: [{ kind: "self_power", amount: 1, perOther: { kind: "entity", race: "human" } }] },
    SCUDO: { kind: "object", staticForms: [{ kind: "bearer_power", amount: 1 }], grantsWhileAssigned: [{ keywords: ["stasis"], ifRace: "human" }] },
    CINTURA: { kind: "object", staticForms: [{ kind: "bearer_power", amount: 1, per: { kind: "entity", race: "human" }, multiBlock: true }] },
    UMANO: { kind: "entity", race: "human", power: 2 },
    AUROS: { kind: "entity", race: "auros", power: 2 },
    GROSSO: { kind: "entity", race: "auros", power: 4 },
    SPINOSO: { kind: "entity", race: "human", power: 3, counterattack: 1 },
    COORDINATO: { kind: "matter", behavior: "reactive" },
  };
  const facts = (cardId: string): CardFacts => ({
    name: cardId, kind: null, race: null, power: null, counterattack: null, fluxCost: null, keywords: [], enterListeners: [], enterMoves: [], behavior: null,
    enterReturns: [], enterLooks: [], enterControls: [], attackReturns: [], attackDraws: [], attackForms: [], staticForms: [], resolveForms: [], flipForms: [], nexus: null, grantsWhileAssigned: [],
    ...EREDITA[cardId],
  });
  const card = (uid: string, owner: Seat, cardId: string, extra: Partial<CardInstance> = {}): CardInstance => ({
    uid, cardId, owner, zone: "field", face: 0, x: 0, y: 0, order: 0, tapped: false, facedown: false, z: 1, ...extra,
  });
  function table(cards: CardInstance[], declarations: Declaration[]) {
    const state = newGame();
    for (const c of cards) state.cards[c.uid] = c;
    state.declarations = declarations;
    return state;
  }
  const attack = (from: string, order = 1): Declaration => ({ id: from, from, to: "rf-b", kind: "attack", seat: "a", order });
  const block = (from: string, to: string, kind: "block" | "counter" = "block"): Declaration => ({ id: from, from, to, kind, seat: "b", order: 0 });

  it("il Ragazzo vale 2 in attacco solo con un altro Umano, il Simulacro conta gli altri Umani", () => {
    const solo = table([card("r", "a", "RAGAZZO"), card("x", "a", "AUROS")], [attack("r")]);
    expect(resolveWave(solo, "a", facts)![0].damage).toBe(1);
    const insieme = table([card("r", "a", "RAGAZZO"), card("u", "a", "UMANO")], [attack("r")]);
    expect(resolveWave(insieme, "a", facts)![0].damage).toBe(2);
    const sim = table([card("s", "a", "SIMULACRO"), card("u1", "a", "UMANO"), card("u2", "a", "UMANO"), card("x", "a", "AUROS")], [attack("s")]);
    expect(resolveWave(sim, "a", facts)![0].damage).toBe(5);
    // In difesa il Ragazzo resta un 1: non sta attaccando.
    const difesa = table([card("r", "a", "RAGAZZO"), card("u", "a", "UMANO")], []);
    expect(powerOf(difesa.cards.r, facts, difesa)).toBe(1);
  });

  it("gli Oggetti danno Potenza al portatore: +1, o +1 per Umano sul Fronte", () => {
    const state = table(
      [card("u", "a", "UMANO"), card("p", "a", "UMANO"), card("o", "a", "SCUDO", { assignedTo: "u" }), card("c", "a", "CINTURA", { assignedTo: "p" })],
      [attack("u", 1), attack("p", 2)]
    );
    // Scudo: 2 + 1. Cintura: 2 + 1 per ogni Umano sul Fronte (due, portatrice compresa).
    expect(resolveWave(state, "a", facts)!.map(b => b.damage)).toEqual([3, 4]);
    expect(powerOf(card("p", "a", "UMANO"), facts)).toBe(2);
  });

  it("la Stasi salva l'Umano che blocca, non l'Auros; e vale nel contrattacco", () => {
    const state = table(
      [card("g", "a", "GROSSO"), card("g2", "a", "GROSSO"), card("u", "b", "UMANO"), card("x", "b", "AUROS"), card("o", "b", "SCUDO", { assignedTo: "u" }), card("o2", "b", "SCUDO", { assignedTo: "x" })],
      [attack("g", 1), attack("g2", 2), block("u", "g"), block("x", "g2")]
    );
    const battles = resolveWave(state, "a", facts)!;
    expect(battles[0]).toMatchObject({ blocker: "u", blockerDies: false, blockerStasis: true, attackerDies: false });
    expect(battles[1]).toMatchObject({ blocker: "x", blockerDies: true });
    expect(battles[1].blockerStasis).toBeUndefined();
    expect(hasKeyword(state.cards.u, "stasis", facts, state)).toBe(true);
    expect(hasKeyword(state.cards.x, "stasis", facts, state)).toBe(false);
    const counter = table([card("g", "a", "GROSSO"), card("s", "b", "SPINOSO"), card("o", "b", "SCUDO", { assignedTo: "s" })], [attack("g"), block("s", "g", "counter")]);
    // 3 + 1 (Scudo) + 1 = 5 > 4: l'attaccante muore, niente Stasi.
    expect(resolveWave(counter, "a", facts)![0]).toMatchObject({ attackerDies: true, blockerDies: false });
  });

  it("con più bloccanti ogni bloccante ha la sua battaglia", () => {
    const state = table(
      [card("u", "a", "UMANO"), card("c", "a", "CINTURA", { assignedTo: "u" }), card("b1", "b", "AUROS"), card("b2", "b", "AUROS")],
      [attack("u"), block("b1", "u"), block("b2", "u")]
    );
    expect(multiBlock(state, "u", facts)).toBe(true);
    expect(multiBlock(state, "b1", facts)).toBe(false);
    const battles = resolveWave(state, "a", facts)!;
    expect(battles).toHaveLength(2);
    // u vale 2 + 1 (un Umano sul Fronte) = 3 contro due Auros da 2.
    expect(battles.map(b => [b.blocker, b.blockerDies, b.attackerDies])).toEqual([["b1", true, false], ["b2", true, false]]);
  });

  it("la Reattiva come blocco ferma l'attacco e si consuma; il Contrattacco concesso conta", () => {
    const state = table(
      [card("g", "a", "GROSSO"), card("g2", "a", "GROSSO"), card("c", "b", "COORDINATO"), card("s", "b", "SPINOSO", { counterBonus: 1 })],
      [attack("g", 1), attack("g2", 2), block("c", "g"), block("s", "g2", "counter")]
    );
    const battles = resolveWave(state, "a", facts)!;
    expect(battles[0]).toMatchObject({ blocker: "c", kind: "block", attackerDies: false, blockerDies: false, damage: 0, blockerSpent: true });
    // 3 + 1 + 1 = 5 > 4.
    expect(battles[1]).toMatchObject({ blocker: "s", attackerDies: true, blockerDies: false });
    const fate = (battle: Battle) => renderLog(describeBattle(battle, 1, uid => uid), state, id => id);
    expect(fate(battles[0])).toContain("si consuma");
    expect(fate({ ...battles[1], attackerDies: false, blockerStasis: true })).toContain("Stasi");
  });
});
