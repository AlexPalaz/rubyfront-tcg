// Le dichiarazioni davanti al poliziotto: se il declare viene fermato
// (es. §6.2, attesa di evocazione), il tap dell'attaccante, la copertura del
// contrattaccante e la riga in chat non devono partire affatto.

import { describe, expect, it } from "vitest";
import { declareAttack, declareBlock, describeBattle, hasKeyword, multiBlock, powerOf, resolveWave, undeclare, staticCounter } from "../src/combat.js";
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
const facts: Record<string, { power: number; counterattack?: number; neverTaps?: boolean }> = {};

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
    themeFor: () => "night",
    tintFor: () => "dynamic",
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
      enterRefreshes: [],
      attackReturns: [],
      attackDraws: [],
      attackForms: [],
      staticForms: facts[cardId]?.neverTaps ? [{ kind: "never_taps" }] : [],
      resolveForms: [],
      flipForms: [], assignForms: [], deathForms: [],
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

  it("«questa Entità non si tappa mai» (RBF-011): dichiara e annota, ma il tap non parte", async () => {
    facts["TEST-ajmal"] = { power: 5, neverTaps: true };
    const { ctx, sent, logs } = fakeCtx(() => true);
    await declareAttack(ctx, cardOn("ajmal", "a"), cardOn("rf-b", "b"));
    expect(sent.map(action => action.t)).toEqual(["declare"]);
    expect(logs).toHaveLength(1);
    delete facts["TEST-ajmal"];
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

  it("la dichiarazione ferma (effetti già risolti, §8.2) non si annulla: niente azione, una riga", async () => {
    const { ctx, sent, logs } = fakeCtx(() => true);
    await undeclare(ctx, cardOn("a-1", "a"), { ...declarationBy("a-1", "attack"), sealed: true });
    expect(sent).toEqual([]);
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
    STRONG: { power: 4 },
    WEAK: { power: 2 },
    EVEN: { power: 4 },
    THORNY: { power: 3, counterattack: 2 },
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
    const state = table([field("a1", "a", "STRONG")], [attack("a1", 1)]);
    expect(resolveWave(state, "a", facts)).toEqual([
      { attacker: "a1", kind: "unblocked", attackerDies: false, blockerDies: false, damage: 4 },
    ]);
  });

  it("bloccante inferiore: muore lui, l'attacco è bloccato", () => {
    const state = table([field("a1", "a", "STRONG"), field("b1", "b", "WEAK")], [attack("a1", 1), block("b1", "a1", "block")]);
    expect(resolveWave(state, "a", facts)).toEqual([
      { attacker: "a1", blocker: "b1", kind: "block", attackerDies: false, blockerDies: true, damage: 0 },
    ]);
  });

  it("Potenze pari: muoiono entrambi", () => {
    const state = table([field("a1", "a", "STRONG"), field("b1", "b", "EVEN")], [attack("a1", 1), block("b1", "a1", "block")]);
    expect(resolveWave(state, "a", facts)![0]).toMatchObject({ attackerDies: true, blockerDies: true });
  });

  // Dal 2026-09-11 (§6.3): «il bloccante più forte uccide l'attaccante».
  // Gemello: engine_test.rb, test_bloccante_superiore_uccide_l_attaccante.
  it("bloccante superiore: muore l'attaccante, il bloccante resta", () => {
    const state = table([field("a1", "a", "WEAK"), field("b1", "b", "STRONG")], [attack("a1", 1), block("b1", "a1", "block")]);
    expect(resolveWave(state, "a", facts)![0]).toMatchObject({ attackerDies: true, blockerDies: false, damage: 0 });
  });

  it("contrattacco: Potenza più N, e l'attaccante muore se superato", () => {
    // 3 + 2 = 5 > 4
    const state = table([field("a1", "a", "STRONG"), field("b1", "b", "THORNY")], [attack("a1", 1), block("b1", "a1", "counter")]);
    expect(resolveWave(state, "a", facts)![0]).toMatchObject({ kind: "counter", attackerDies: true, blockerDies: false });
  });

  it("le battaglie vanno nell'ordine di dichiarazione", () => {
    const state = table(
      [field("a1", "a", "STRONG"), field("a2", "a", "WEAK")],
      [attack("a2", 1), attack("a1", 2)]
    );
    expect(resolveWave(state, "a", facts)!.map(battle => battle.attacker)).toEqual(["a2", "a1"]);
  });

  it("un attaccante uscito dal campo non ha battaglia", () => {
    const gone = { ...field("a1", "a", "STRONG"), zone: "abisso" as const };
    const state = table([gone, field("a2", "a", "WEAK")], [attack("a1", 1), attack("a2", 2)]);
    expect(resolveWave(state, "a", facts)!.map(battle => battle.attacker)).toEqual(["a2"]);
  });

  it("senza la Potenza nel catalogo si arrende", () => {
    const state = table([field("a1", "a", "UNKNOWN")], [attack("a1", 1)]);
    expect(resolveWave(state, "a", facts)).toBeNull();
  });
});

// I bonus di Potenza fino a fine turno e la Vendetta (§8.1, §8.2): lo
// stesso conto dell'engine (power_of, has_keyword?).
describe("resolveWave con bonus e Vendetta", () => {
  const stats: Record<string, { power: number; counterattack?: number; keywords?: string[] }> = {
    STRONG: { power: 4 },
    EVEN: { power: 4 },
    VENGEFUL: { power: 2, keywords: ["revenge"] },
    BIG: { power: 5 },
    WEAK: { power: 2 },
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
    const state = table([card("a1", "a", "STRONG", { powerBonus: 1 }), card("b1", "b", "EVEN")], [attack("a1"), block("b1", "a1")]);
    expect(resolveWave(state, "a", facts as never)![0]).toMatchObject({ attackerDies: false, blockerDies: true });
    const unblocked = table([card("a1", "a", "STRONG", { powerBonus: 2 })], [attack("a1")]);
    expect(resolveWave(unblocked, "a", facts as never)![0].damage).toBe(6);
  });

  // Dal 2026-09-11 la Vendetta è il colpo di chi muore: il bloccante più
  // debole muore e si porta dietro l'attaccante. Gemello: engine_test.rb.
  it("chi blocca con Vendetta ed è più debole muore, ma si porta dietro l'attaccante", () => {
    const state = table([card("a1", "a", "STRONG"), card("b1", "b", "VENGEFUL")], [attack("a1"), block("b1", "a1")]);
    expect(resolveWave(state, "a", facts as never)![0]).toMatchObject({ attackerDies: true, blockerDies: true });
    const plain = table([card("a1", "a", "STRONG"), card("b1", "b", "WEAK")], [attack("a1"), block("b1", "a1")]);
    expect(resolveWave(plain, "a", facts as never)![0]).toMatchObject({ attackerDies: false, blockerDies: true });
  });

  it("la Vendetta concessa fino a fine turno vale come quella stampata, e non vale nel contrattacco", () => {
    const state = table([card("a1", "a", "STRONG"), card("b1", "b", "WEAK", { grants: ["revenge"] })], [attack("a1"), block("b1", "a1")]);
    expect(resolveWave(state, "a", facts as never)![0]).toMatchObject({ attackerDies: true, blockerDies: true });
    const counter: Declaration = { id: "b1", from: "b1", to: "a1", kind: "counter", seat: "b", order: 0 };
    const countered = table([card("a1", "a", "STRONG"), card("b1", "b", "WEAK", { grants: ["revenge"] })], [attack("a1"), counter]);
    expect(resolveWave(countered, "a", facts as never)![0]).toMatchObject({ kind: "counter", attackerDies: false, blockerDies: true });
  });
});

// Eredità Perduta nella risoluzione: gli statici (§8.2), la Stasi (§8.1), il
// blocco multiplo (RBF-014), la Reattiva come blocco (§6.4), il Contrattacco
// concesso (RBF-020). Gemello: engine_test.rb, «Eredità Perduta».
describe("resolveWave con statici, Stasi e più bloccanti", () => {
  const LEGACY: Record<string, Partial<CardFacts>> = {
    BOY: { kind: "entity", race: "human", power: 1, staticForms: [{ kind: "self_power", amount: 1, whileAttacking: true, requiresOther: { kind: "entity", race: "human" } }] },
    SIMULACRUM: { kind: "entity", race: "simulacrum", power: 3, staticForms: [{ kind: "self_power", amount: 1, perOther: { kind: "entity", race: "human" } }] },
    SHIELD: { kind: "object", staticForms: [{ kind: "bearer_power", amount: 1 }], grantsWhileAssigned: [{ keywords: ["stasis"], ifRace: "human" }] },
    BELT: { kind: "object", staticForms: [{ kind: "bearer_power", amount: 1, per: { kind: "entity", race: "human" }, multiBlock: true }] },
    RECRUIT: { kind: "entity", race: "auros", power: 1, staticForms: [{ kind: "self_power", amount: 1, whileArmed: true }] },
    BLADE: { kind: "entity", race: "auros", power: 5, staticForms: [{ kind: "others_armed_power", amount: 1 }] },
    HUMAN: { kind: "entity", race: "human", power: 2 },
    AUROS: { kind: "entity", race: "auros", power: 2 },
    HUGE: { kind: "entity", race: "auros", power: 4 },
    THORNY: { kind: "entity", race: "human", power: 3, counterattack: 1 },
    BRISTLING: { kind: "entity", race: "auros", power: 2, counterattack: 1, staticForms: [{ kind: "self_counter", amount: 1, perObject: true }] },
    THORNS: { kind: "object", staticForms: [{ kind: "bearer_counter", amount: 1 }] },
    COORDINATED: { kind: "matter", behavior: "reactive" },
  };
  const facts = (cardId: string): CardFacts => ({
    name: cardId, kind: null, race: null, power: null, counterattack: null, fluxCost: null, keywords: [], enterListeners: [], enterMoves: [], behavior: null,
    enterReturns: [], enterLooks: [], enterControls: [], enterRefreshes: [], attackReturns: [], attackDraws: [], attackForms: [], staticForms: [], resolveForms: [], flipForms: [], nexus: null, grantsWhileAssigned: [],
    ...LEGACY[cardId],
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

  it("il Contrattacco cresce con gli Oggetti addosso e con quello dell'Oggetto — gemello: engine_test.rb", () => {
    const nuda = table([card("g", "a", "HUGE"), card("i", "b", "BRISTLING")], [attack("g"), block("i", "g", "counter")]);
    expect(resolveWave(nuda, "a", facts)![0]).toMatchObject({ attackerDies: false, blockerDies: true });
    const armata = table([card("g", "a", "HUGE"), card("i", "b", "BRISTLING"), card("s", "b", "THORNS", { assignedTo: "i" })], [attack("g"), block("i", "g", "counter")]);
    expect(resolveWave(armata, "a", facts)![0]).toMatchObject({ attackerDies: true, blockerDies: false });
    expect(staticCounter(armata, armata.cards.i, facts)).toBe(2);
  });

  it("la Recluta vale uno in più solo con un Oggetto addosso — gemello: engine_test.rb", () => {
    const nuda = table([card("r", "a", "RECRUIT")], [attack("r")]);
    expect(resolveWave(nuda, "a", facts)![0].damage).toBe(1);
    const armata = table([card("r", "a", "RECRUIT"), card("o", "a", "SHIELD", { assignedTo: "r" })], [attack("r")]);
    expect(resolveWave(armata, "a", facts)![0].damage).toBe(3);
  });

  it("il Ragazzo vale 2 in attacco solo con un altro Umano, il Simulacro conta gli altri Umani", () => {
    const solo = table([card("r", "a", "BOY"), card("x", "a", "AUROS")], [attack("r")]);
    expect(resolveWave(solo, "a", facts)![0].damage).toBe(1);
    const together = table([card("r", "a", "BOY"), card("u", "a", "HUMAN")], [attack("r")]);
    expect(resolveWave(together, "a", facts)![0].damage).toBe(2);
    const sim = table([card("s", "a", "SIMULACRUM"), card("u1", "a", "HUMAN"), card("u2", "a", "HUMAN"), card("x", "a", "AUROS")], [attack("s")]);
    expect(resolveWave(sim, "a", facts)![0].damage).toBe(5);
    // In difesa il Ragazzo resta un 1: non sta attaccando.
    const defending = table([card("r", "a", "BOY"), card("u", "a", "HUMAN")], []);
    expect(powerOf(defending.cards.r, facts, defending)).toBe(1);
  });

  it("gli Oggetti danno Potenza al portatore: +1, o +1 per Umano sul Fronte", () => {
    const state = table(
      [card("u", "a", "HUMAN"), card("p", "a", "HUMAN"), card("o", "a", "SHIELD", { assignedTo: "u" }), card("c", "a", "BELT", { assignedTo: "p" })],
      [attack("u", 1), attack("p", 2)]
    );
    // Scudo: 2 + 1. Cintura: 2 + 1 per ogni Umano sul Fronte (due, portatrice compresa).
    expect(resolveWave(state, "a", facts)!.map(b => b.damage)).toEqual([3, 4]);
    expect(powerOf(card("p", "a", "HUMAN"), facts)).toBe(2);
  });

  it("l'aura dà +1 alle altre armate dello stesso posto, non a sé e non alle nude", () => {
    const state = table([
      card("l", "a", "BLADE"), card("lo", "a", "SHIELD", { assignedTo: "l" }),
      card("r", "a", "AUROS"), card("ro", "a", "SHIELD", { assignedTo: "r" }),
      card("n", "a", "AUROS"),
      card("b", "b", "AUROS"), card("bo", "b", "SHIELD", { assignedTo: "b" }),
    ], []);
    expect(powerOf(state.cards.l, facts, state)).toBe(6);
    expect(powerOf(state.cards.r, facts, state)).toBe(4);
    expect(powerOf(state.cards.n, facts, state)).toBe(2);
    expect(powerOf(state.cards.b, facts, state)).toBe(3);
  });

  it("la Stasi salva l'Umano che blocca, non l'Auros; e vale nel contrattacco", () => {
    const state = table(
      [card("g", "a", "HUGE"), card("g2", "a", "HUGE"), card("u", "b", "HUMAN"), card("x", "b", "AUROS"), card("o", "b", "SHIELD", { assignedTo: "u" }), card("o2", "b", "SHIELD", { assignedTo: "x" })],
      [attack("g", 1), attack("g2", 2), block("u", "g"), block("x", "g2")]
    );
    const battles = resolveWave(state, "a", facts)!;
    expect(battles[0]).toMatchObject({ blocker: "u", blockerDies: false, blockerStasis: true, attackerDies: false });
    expect(battles[1]).toMatchObject({ blocker: "x", blockerDies: true });
    expect(battles[1].blockerStasis).toBeUndefined();
    expect(hasKeyword(state.cards.u, "stasis", facts, state)).toBe(true);
    expect(hasKeyword(state.cards.x, "stasis", facts, state)).toBe(false);
    const counter = table([card("g", "a", "HUGE"), card("s", "b", "THORNY"), card("o", "b", "SHIELD", { assignedTo: "s" })], [attack("g"), block("s", "g", "counter")]);
    // 3 + 1 (Scudo) + 1 = 5 > 4: l'attaccante muore, niente Stasi.
    expect(resolveWave(counter, "a", facts)![0]).toMatchObject({ attackerDies: true, blockerDies: false });
  });

  it("con più bloccanti ogni bloccante ha la sua battaglia", () => {
    const state = table(
      [card("u", "a", "HUMAN"), card("c", "a", "BELT", { assignedTo: "u" }), card("b1", "b", "AUROS"), card("b2", "b", "AUROS")],
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
      [card("g", "a", "HUGE"), card("g2", "a", "HUGE"), card("c", "b", "COORDINATED"), card("s", "b", "THORNY", { counterBonus: 1 })],
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
