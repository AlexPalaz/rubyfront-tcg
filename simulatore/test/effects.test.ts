// L'interprete degli effetti (§8.2), la forma di RBF-003: chi si innesca
// all'ingresso e come si risolve. Gemello: engine_test.rb, sezione §8.2.

import { renderLog } from "../src/log.js";
import { describe, expect, it } from "vitest";
import type { CardFacts, Ctx } from "../src/ctx.js";
import { backRowY, frontRowY } from "../src/ctx.js";
import {
  attackRef,
  attackSteps,
  describeAttackStep,
  pendingGrants,
  vigilUntaps,
  attackDraws,
  describeAttackDraw,
  resolveAttackDiscard,
  resolveAttackDraw,
  describeControl,
  describeLook,
  describeMove,
  describeReturn,
  describeTrigger,
  enterControls,
  enterLooks,
  enterMoves,
  enterReturns,
  enterTriggers,
  lookAfterRoll,
  lookCount,
  releaseControlled,
  resolveControl,
  returnsFor,
  resolveEnter,
  resolveLook,
  resolveMove,
  resolveReturn,
  describeFlipStep,
  describeResolveStep,
  discountedCost,
  flipSteps,
  heldBy,
  nexusCheck,
  pendingResolve,
  playsAsBlock,
  releaseHeld,
  resolveSteps,
  wantsTargetOnPlay,
  armedCount,
  blocksAttacker,
} from "../src/effects.js";
import { newGame } from "../src/state.js";
import type { Action, CardInstance, GameState, Seat } from "../src/types.js";

const FACTS: Record<string, Partial<CardFacts>> = {
  ESPLORATORE: { kind: "entity", race: "auros", attackDraws: [{ draw: 1, thenDiscard: 1, requiresObject: true }] },
  VIGILE: { kind: "entity", race: "human", attackForms: [{ kind: "untap", who: "self", once: true, requiresObject: true, face: 0 }] },
  COMANDO: { kind: "entity", race: "auros", attackForms: [{ kind: "empower", who: "self", requiresObject: true, targets: "others_armed", power: 1, face: 0 }] },
  SIGMA: { kind: "object", attackForms: [
    { kind: "empower", who: "object", targets: "bearer", power: 1, face: 0 },
    { kind: "look", who: "object", count: 4, reveal: { kind: "matter", race: null }, revealTo: "hand", restTo: "ritiro", die: 6, onRoll: [5, 6], face: 0 },
  ] },
  FURIERE: { kind: "entity", race: "auros", attackForms: [
    { kind: "rearm", who: "ally", attackerArmed: true, face: 0 },
    { kind: "look", who: "ally", count: 2, reveal: { kind: "object", race: null }, revealTo: "ritiro", restTo: "deck", die: null, onRoll: null, once: true, attackerArmed: true, face: 0 },
  ] },
  RIFLESSO: { kind: "matter", behavior: "reactive", resolveForms: [{ kind: "block", requiresArmed: 2, heal: 3, asBlock: true }] },
  SCUDETTO: { kind: "object", grantsWhileAssigned: [] },
  EREDI: { kind: "matter", behavior: "permanent", attackForms: [{ kind: "heal", who: "permanent", attackers: { kind: "entity", race: "human" }, die: 20, onRoll: null, gainOn: [1, 6], drainOn: [15, 20], amount: "human_attackers", face: 0 }] },
  OBLIVHAL: { kind: "rubyfront", attackForms: [
    { kind: "heal", who: "rubyfront", once: true, requiresAttackers: { count: 3, race: "human" }, amount: 2, die: null, onRoll: null, thenDraw: 0, thenDiscard: 0, face: 0 },
    { kind: "heal", who: "rubyfront", once: true, requiresAttackers: { count: 3, race: "human" }, amount: 2, die: null, onRoll: null, thenDraw: 1, thenDiscard: 1, face: 1 },
  ] },
  VENDICATORE: { kind: "entity", race: "human", attackForms: [{ kind: "empower", who: "self", once: true, targets: "next_human_attacker", grants: ["revenge"], face: 0 }] },
  RAZZIA: { kind: "entity", race: "human", attackForms: [{ kind: "empower", who: "self", requiresPreviousAttackers: { count: 2, race: "human" }, targets: "opposing_entity", restrict: "block", face: 0 }] },
  FERRO: { kind: "object" },
  ARCIERE: { kind: "entity", race: "human", enterMoves: [{ target: { kind: "entity", controller: "opponent" }, to: "ritiro" }] },
  RHEN: {
    kind: "entity",
    race: "human",
    enterReturns: [{ from: "ritiro", filter: { kind: "matter", behavior: "permanent" }, to: "field" }],
    attackReturns: [{ from: "ritiro", filter: { kind: "matter", behavior: "permanent" }, to: "field" }],
  },
  PERMANENTE: { kind: "matter", behavior: "permanent" },
  CERCATORE: { kind: "entity", race: "human", enterLooks: [{ count: 4, die: null, countBase: 0, reveal: { kind: "entity", race: "human" }, thenRetire: false }] },
  ARTEFICE: { kind: "entity", race: "auros", enterLooks: [{ count: null, die: 6, countBase: 2, reveal: { kind: "object", race: null }, thenRetire: true }] },
  FERRO: { kind: "object" },
  RADUNATORE: { kind: "entity", race: "human", enterControls: [{ target: { kind: "entity", controller: "opponent", maxCost: 3 }, grants: ["surge"] }] },
  PICCOLA: { kind: "entity", race: "auros", fluxCost: 2 },
  GRANDE: { kind: "entity", race: "auros", fluxCost: 5 },
  NORMALE: { kind: "matter", behavior: "normal" },
  GUIDA: { kind: "entity", race: "human", enterListeners: [{ enteringRace: "human", requires: { count: 3, race: "human" }, draw: 1 }] },
  UMANO: { kind: "entity", race: "human" },
  AUROS: { kind: "entity", race: "auros" },
  PIETRA: { kind: "matter", race: null },
  ATTRAZIONE: { kind: "matter", behavior: "normal", fluxCost: 2, resolveForms: [{ kind: "look", count: 4, reveal: { kind: "entity", race: "human" }, revealTo: "hand", restTo: "deck", showUpTo: 2 }] },
  FORMAZIONE: { kind: "matter", behavior: "reactive", fluxCost: 2, resolveForms: [{ kind: "empower", targets: "own_entity", race: "human", power: 1, untap: true }] },
  IMPATTO: { kind: "matter", behavior: "normal", fluxCost: 1, resolveForms: [{ kind: "move", target: { kind: "entity", controller: "opponent", maxCost: 2 }, to: "ritiro" }] },
  CAMPO: { kind: "matter", behavior: "permanent", fluxCost: 3, resolveForms: [{ kind: "exile", target: { permanent: true, controller: "opponent" }, to: "abisso", hold: true }] },
  COORDINATO: { kind: "matter", behavior: "reactive", fluxCost: 4, resolveForms: [{ kind: "empower", targets: "own_entities", race: "human", counter: 1, untap: true, asBlock: true, requires: { count: 3, race: "human" } }] },
  GIUDIZIO: { kind: "matter", behavior: "reactive", fluxCost: 5, resolveForms: [{ kind: "destroy", target: { kind: "entity", controller: "any" }, to: "abisso", discount: { amount: 3, ifTarget: "tapped" } }] },
  BESTIA: { kind: "rubyfront", nexus: { face: 1, conditions: [{ count: 4, kind: "entity", race: "human" }], discard: { count: 1, kind: "entity" }, recovery: 5 },
    flipForms: [{ kind: "move", cardId: "EREDE", from: "field", to: "abisso" }, { kind: "seal", cardId: "EREDE" }] },
  EREDE: { kind: "entity", race: "human", fluxCost: 6 },
};
const facts = (cardId: string): CardFacts => ({
  name: cardId,
  kind: null,
  race: null,
  power: null,
  counterattack: null,
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
  ...FACTS[cardId],
});

function on(state: GameState, uid: string, cardId: string, owner: Seat = "a"): CardInstance {
  const card: CardInstance = { uid, cardId, owner, zone: "field", face: 0, x: 0, y: 0, order: 0, tapped: false, facedown: false, z: 1 };
  state.cards[uid] = card;
  return card;
}

/** Il Rubyfront schierato (§3.1): sulla fila del Fronte, non su quella di servizio. */
function deploy(state: GameState, uid: string, cardId: string, owner: Seat = "a"): CardInstance {
  const card = on(state, uid, cardId, owner);
  card.y = frontRowY(owner);
  return card;
}

describe("enterTriggers", () => {
  it("la Guida si innesca al terzo Umano, non al secondo", () => {
    const state = newGame();
    on(state, "g", "GUIDA");
    const u1 = on(state, "u1", "UMANO");
    expect(enterTriggers(state, u1, facts)).toEqual([]);
    const u2 = on(state, "u2", "UMANO");
    expect(enterTriggers(state, u2, facts).map(t => t.source.uid)).toEqual(["g"]);
  });

  it("un Auros o una Materia non la innescano, e l'avversario nemmeno", () => {
    const state = newGame();
    on(state, "g", "GUIDA");
    on(state, "u1", "UMANO");
    on(state, "u2", "UMANO");
    expect(enterTriggers(state, on(state, "x", "AUROS"), facts)).toEqual([]);
    expect(enterTriggers(state, on(state, "m", "PIETRA"), facts)).toEqual([]);
    expect(enterTriggers(state, on(state, "b1", "UMANO", "b"), facts)).toEqual([]);
  });

  it("descrive l'innesco", () => {
    const state = newGame();
    const g = on(state, "g", "GUIDA");
    expect(describeTrigger({ source: g, draw: 1 }, facts)).toBe("«GUIDA» si innesca: pesca 1 carta");
  });
});

describe("resolveEnter", () => {
  function fakeCtx(state: GameState, judge: (action: Action) => boolean): { ctx: Ctx; sent: Action[]; logs: string[] } {
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
      arbitrated: () => true,
      themeFor: () => "notte",
      locale: () => "it",
      card: facts,
      log(text) {
        logs.push(typeof text === "string" ? text : renderLog(text, ctx.state(), id => id));
      },
    };
    return { ctx, sent, logs };
  }

  it("manda la pesca marcata come effetto e racconta", async () => {
    const state = newGame();
    on(state, "g", "GUIDA");
    on(state, "u1", "UMANO");
    const u2 = on(state, "u2", "UMANO");
    const { ctx, sent, logs } = fakeCtx(state, () => true);
    const fired = await resolveEnter(ctx, u2);
    expect(sent).toEqual([{ t: "draw", seat: "a", count: 1, effect: { source: "g", event: "on_enter_field", entering: "u2" } }]);
    expect(fired.map(card => card.uid)).toEqual(["g"]);
    expect(logs[0]).toMatch(/«GUIDA» si innesca: pesca 1 carta/);
  });

  it("il «no» dell'engine ferma il passo e basta", async () => {
    const state = newGame();
    on(state, "g", "GUIDA");
    on(state, "u1", "UMANO");
    const u2 = on(state, "u2", "UMANO");
    const { ctx, sent, logs } = fakeCtx(state, () => false);
    expect(await resolveEnter(ctx, u2)).toEqual([]);
    expect(sent).toEqual([]);
    expect(logs).toEqual([]);
  });
});

// Lo spostamento all'ingresso (§8.2), la forma di RBF-007. Gemello:
// engine_test.rb, sezione §8.2 Arciere.
describe("enterMoves", () => {
  it("i candidati sono le Entità avversarie in campo", () => {
    const state = newGame();
    const arc = on(state, "arc", "ARCIERE");
    on(state, "b1", "UMANO", "b");
    on(state, "b2", "PIETRA", "b");
    on(state, "a1", "UMANO", "a");
    const steps = enterMoves(state, arc, facts);
    expect(steps).toHaveLength(1);
    expect(steps[0].to).toBe("ritiro");
    expect(steps[0].candidates.map(card => card.uid)).toEqual(["b1"]);
    expect(describeMove(steps[0], facts)).toMatch(/«ARCIERE» si innesca/);
    expect(enterMoves(state, on(state, "u", "UMANO"), facts)).toEqual([]);
  });

  it("resolveMove manda il toZone marcato come effetto", async () => {
    const state = newGame();
    const arc = on(state, "arc", "ARCIERE");
    const b1 = on(state, "b1", "UMANO", "b");
    const sent: Action[] = [];
    const ctx: Ctx = {
      state: () => state,
      dispatch(action) {
        sent.push(action);
        return Promise.resolve(true);
      },
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "notte",
      locale: () => "it",
      card: facts,
      log() {},
    };
    const [step] = enterMoves(state, arc, facts);
    expect(await resolveMove(ctx, step, b1)).toBe(true);
    expect(sent).toEqual([{ t: "toZone", uid: "b1", zone: "ritiro", effect: { source: "arc", event: "on_enter_field", entering: "arc" } }]);
  });
});

// Il ritorno all'ingresso (§8.2), la forma di RBF-012. Gemello:
// engine_test.rb, sezione §8.2 Rhen.
describe("enterReturns", () => {
  function inRitiro(state: GameState, uid: string, cardId: string, owner: Seat = "a"): CardInstance {
    const card = on(state, uid, cardId, owner);
    card.zone = "ritiro";
    return card;
  }

  it("i candidati sono le permanenti nella propria Zona di Ritiro", () => {
    const state = newGame();
    const rhen = on(state, "rhen", "RHEN");
    inRitiro(state, "p1", "PERMANENTE");
    inRitiro(state, "n1", "NORMALE");
    inRitiro(state, "u1", "UMANO");
    inRitiro(state, "bp", "PERMANENTE", "b");
    const [step] = enterReturns(state, rhen, facts);
    expect(step.from).toBe("ritiro");
    expect(step.candidates.map(card => card.uid)).toEqual(["p1"]);
    expect(describeReturn(step, facts)).toMatch(/«RHEN» si innesca/);
  });

  it("resolveReturn manda il toZone verso il campo marcato come effetto", async () => {
    const state = newGame();
    const rhen = on(state, "rhen", "RHEN");
    const p1 = inRitiro(state, "p1", "PERMANENTE");
    const sent: Action[] = [];
    const ctx: Ctx = {
      state: () => state,
      dispatch(action) {
        sent.push(action);
        return Promise.resolve(true);
      },
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "notte",
      locale: () => "it",
      card: facts,
      log() {},
    };
    const [step] = enterReturns(state, rhen, facts);
    expect(await resolveReturn(ctx, step, p1)).toBe(true);
    expect(sent[0]).toMatchObject({ t: "toZone", uid: "p1", zone: "field", effect: { source: "rhen", event: "on_enter_field", entering: "rhen" } });
  });
});

// Lo sguardo nel mazzo (§8.2), la forma di RBF-006. Gemello: engine_test.rb.
describe("enterLooks", () => {
  function inDeck(state: GameState, uid: string, cardId: string, order: number): CardInstance {
    const card = on(state, uid, cardId);
    card.zone = "deck";
    card.order = order;
    return card;
  }

  it("guarda le prime quattro e propone solo gli Umani", () => {
    const state = newGame();
    const cerc = on(state, "cerc", "CERCATORE");
    inDeck(state, "d1", "PIETRA", 0);
    inDeck(state, "d2", "UMANO", 1);
    inDeck(state, "d3", "AUROS", 2);
    inDeck(state, "d4", "UMANO", 3);
    inDeck(state, "d5", "UMANO", 4);
    const [step] = enterLooks(state, cerc, facts);
    expect(step.looked.map(card => card.uid)).toEqual(["d1", "d2", "d3", "d4"]);
    expect(step.candidates.map(card => card.uid)).toEqual(["d2", "d4"]);
    expect(describeLook(step, facts)).toMatch(/guarda le prime 4/);
  });

  it("resolveLook manda l'azione look marcata come effetto", async () => {
    const state = newGame();
    const cerc = on(state, "cerc", "CERCATORE");
    const d2 = inDeck(state, "d2", "UMANO", 0);
    const sent: Action[] = [];
    const ctx: Ctx = {
      state: () => state,
      dispatch(action) {
        sent.push(action);
        return Promise.resolve(true);
      },
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "notte",
      locale: () => "it",
      card: facts,
      log() {},
    };
    const [step] = enterLooks(state, cerc, facts);
    expect(await resolveLook(ctx, step, d2)).toBe(true);
    expect(sent[0]).toEqual({ t: "look", seat: "a", count: 4, reveal: "d2", effect: { source: "cerc", event: "on_enter_field", entering: "cerc" } });
    expect(await resolveLook(ctx, step, null)).toBe(true);
    expect(sent[1]).not.toHaveProperty("reveal");
  });
});

// Il controllo (§8.2), la forma di RBF-009, e la restituzione a fine turno.
// Gemello: engine_test.rb, sezione §8.2 Radunatore.
describe("enterControls", () => {
  function fake(state: GameState): { ctx: Ctx; sent: Action[] } {
    const sent: Action[] = [];
    const ctx: Ctx = {
      state: () => state,
      dispatch(action) {
        sent.push(action);
        return Promise.resolve(true);
      },
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "notte",
      locale: () => "it",
      card: facts,
      log() {},
    };
    return { ctx, sent };
  }

  it("i candidati sono le Entità avversarie entro il costo", () => {
    const state = newGame();
    const rad = on(state, "rad", "RADUNATORE");
    on(state, "b1", "PICCOLA", "b");
    on(state, "b2", "GRANDE", "b");
    on(state, "b3", "PIETRA", "b");
    on(state, "a1", "PICCOLA", "a");
    const [step] = enterControls(state, rad, facts);
    expect(step.candidates.map(card => card.uid)).toEqual(["b1"]);
    expect(step.grants).toEqual(["surge"]);
    expect(describeControl(step, facts)).toMatch(/prendi il controllo/);
  });

  it("resolveControl manda l'azione control, e releaseControlled restituisce a fine turno", async () => {
    const state = newGame();
    const rad = on(state, "rad", "RADUNATORE");
    const b1 = on(state, "b1", "PICCOLA", "b");
    const { ctx, sent } = fake(state);
    const [step] = enterControls(state, rad, facts);
    expect(await resolveControl(ctx, step, b1)).toBe(true);
    expect(sent[0]).toEqual({ t: "control", uid: "b1", by: "a", grants: ["surge"], effect: { source: "rad", event: "on_enter_field", entering: "rad" } });
    b1.controller = "a";
    await releaseControlled(ctx, "a", () => ({ x: 442, y: 172 }));
    expect(sent[1]).toEqual({ t: "release", uid: "b1", zone: "field", x: 442, y: 172 });
    await releaseControlled(ctx, "a", () => null);
    expect(sent[2]).toEqual({ t: "release", uid: "b1", zone: "ritiro" });
  });
});

// Lo sguardo col dado (§8.2), la forma di RBF-027. Gemello: engine_test.rb.
describe("lookAfterRoll", () => {
  it("il conto è 2 più metà del tiro, arrotondata per eccesso", () => {
    const look = facts("ARTEFICE").enterLooks[0];
    expect([1, 2, 3, 4, 5, 6].map(roll => lookCount(look, roll))).toEqual([3, 3, 4, 4, 5, 5]);
    const state = newGame();
    const art = on(state, "art", "ARTEFICE");
    for (let i = 1; i <= 6; i++) {
      const card = on(state, `d${i}`, i === 2 ? "FERRO" : "PIETRA");
      card.zone = "deck";
      card.order = i;
    }
    expect(enterLooks(state, art, facts)[0].looked).toEqual([]);
    const step = lookAfterRoll(state, art, look, 3, facts);
    expect(step.looked.map(card => card.uid)).toEqual(["d1", "d2", "d3", "d4"]);
    expect(step.candidates.map(card => card.uid)).toEqual(["d2"]);
    expect(step.roll).toBe(3);
  });
});

// «Quando attacca» (§8.2): la stessa forma di Rhen, con l'evento giusto.
describe("returnsFor on_attack", () => {
  it("il passo porta l'evento dell'attacco", async () => {
    const state = newGame();
    const rhen = on(state, "rhen", "RHEN");
    const p1 = on(state, "p1", "PERMANENTE");
    p1.zone = "ritiro";
    const [step] = returnsFor(state, rhen, facts, "on_attack");
    expect(step.event).toBe("on_attack");
    expect(step.candidates.map(card => card.uid)).toEqual(["p1"]);
    const sent: Action[] = [];
    const ctx: Ctx = {
      state: () => state,
      dispatch(action) {
        sent.push(action);
        return Promise.resolve(true);
      },
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "notte",
      locale: () => "it",
      card: facts,
      log() {},
    };
    await resolveReturn(ctx, step, p1);
    expect(sent[0]).toMatchObject({ t: "toZone", zone: "field", effect: { source: "rhen", event: "on_attack", entering: "rhen" } });
  });
});

// «Quando attacca con un Oggetto, pesca, poi scarta» (§8.2, RBF-026).
describe("attackDraws", () => {
  function fakeCtx(state: GameState, judge: (action: Action) => boolean): { ctx: Ctx; sent: Action[]; logs: string[] } {
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
      arbitrated: () => true,
      themeFor: () => "notte",
      locale: () => "it",
      card: facts,
      log(text) {
        logs.push(typeof text === "string" ? text : renderLog(text, ctx.state(), id => id));
      },
    };
    return { ctx, sent, logs };
  }

  it("scatta solo con un Oggetto assegnato", () => {
    const state = newGame();
    const esp = on(state, "esp", "ESPLORATORE");
    expect(attackDraws(state, esp, facts)).toEqual([]);
    const ferro = on(state, "ferro", "FERRO");
    ferro.assignedTo = "esp";
    const [step] = attackDraws(state, esp, facts);
    expect(step).toMatchObject({ draw: 1, thenDiscard: 1 });
    expect(describeAttackDraw(step, facts)).toBe("«ESPLORATORE» si innesca: pesca 1 carta, poi scarta 1");
  });

  it("un Oggetto fuori dal campo non veste nessuno", () => {
    const state = newGame();
    const esp = on(state, "esp", "ESPLORATORE");
    const ferro = on(state, "ferro", "FERRO");
    ferro.assignedTo = "esp";
    ferro.zone = "ritiro";
    expect(attackDraws(state, esp, facts)).toEqual([]);
  });

  it("la pesca e lo scarto viaggiano marcati come effetto, lo scarto col suo seguito", async () => {
    const state = newGame();
    const esp = on(state, "esp", "ESPLORATORE");
    on(state, "ferro", "FERRO").assignedTo = "esp";
    const h1 = on(state, "h1", "UMANO");
    h1.zone = "hand";
    const { ctx, sent, logs } = fakeCtx(state, () => true);
    const [step] = attackDraws(state, esp, facts);
    expect(await resolveAttackDraw(ctx, step)).toBe(true);
    expect(await resolveAttackDiscard(ctx, step, h1)).toBe(true);
    expect(sent).toEqual([
      { t: "draw", seat: "a", count: 1, effect: { source: "esp", event: "on_attack", entering: "esp" } },
      { t: "toZone", uid: "h1", zone: "abisso", effect: { source: "esp", event: "on_attack", entering: "esp", follow: "discard" } },
    ]);
    expect(logs[1]).toMatch(/«ESPLORATORE» scarta «UMANO»/);
  });

  it("fermata dall'engine, la pesca non racconta nulla", async () => {
    const state = newGame();
    const esp = on(state, "esp", "ESPLORATORE");
    on(state, "ferro", "FERRO").assignedTo = "esp";
    const { ctx, sent, logs } = fakeCtx(state, () => false);
    const [step] = attackDraws(state, esp, facts);
    expect(await resolveAttackDraw(ctx, step)).toBe(false);
    expect(sent).toEqual([]);
    expect(logs).toEqual([]);
  });
});

// Le altre forme «quando attacca» (§8.2): chi si innesca all'attacco di chi,
// con le stesse condizioni della dogana (engine_test, «scena»).
describe("attackSteps", () => {
  function declare(state: GameState, uid: string, order: number, seat: Seat = "a"): void {
    state.declarations.push({ id: uid, from: uid, to: "rf-b", kind: "attack", seat, order });
  }

  it("le forme di chi attacca: il Comando armato potenzia, disarmato tace", () => {
    const state = newGame();
    const c = on(state, "c", "COMANDO");
    declare(state, "c", 1);
    expect(attackSteps(state, c, facts)).toEqual([]);
    on(state, "f", "FERRO").assignedTo = "c";
    const steps = attackSteps(state, c, facts);
    expect(steps.map(s => [s.source.uid, s.form.kind])).toEqual([["c", "empower"]]);
    expect(describeAttackStep(steps[0], facts)).toMatch(/«COMANDO» si innesca: le altre Entità con un Oggetto assegnato prendono \+1/);
    expect(attackRef(steps[0])).toEqual({ source: "c", event: "on_attack", entering: "c" });
  });

  it("l'Oggetto addosso a chi attacca si innesca, in due passi, dopo quelli di chi attacca", () => {
    const state = newGame();
    const u = on(state, "u", "UMANO");
    on(state, "s", "SIGMA").assignedTo = "u";
    on(state, "s2", "SIGMA").assignedTo = "altro";
    declare(state, "u", 1);
    expect(attackSteps(state, u, facts).map(s => [s.source.uid, s.form.kind])).toEqual([["s", "empower"], ["s", "look"]]);
  });

  it("l'alleato si innesca solo se chi attacca è armato; lo sguardo una volta per turno", () => {
    const state = newGame();
    const u = on(state, "u", "UMANO");
    on(state, "q", "FURIERE");
    declare(state, "u", 1);
    expect(attackSteps(state, u, facts)).toEqual([]);
    on(state, "f", "FERRO").assignedTo = "u";
    expect(attackSteps(state, u, facts).map(s => [s.source.uid, s.form.kind])).toEqual([["q", "rearm"], ["q", "look"]]);
    const later = { ...state, fired: ["q|on_attack:look|turn"] };
    expect(attackSteps(later, u, facts).map(s => s.form.kind)).toEqual(["rearm"]);
    expect(attackRef(attackSteps(state, u, facts)[1])).toEqual({ source: "q", event: "on_attack", entering: "u", once: true });
  });

  it("la Materia permanente ascolta solo gli Umani; il Rubyfront il terzo Umano, una volta", () => {
    const state = newGame();
    on(state, "m", "EREDI");
    deploy(state, "rf", "OBLIVHAL");
    const u1 = on(state, "u1", "UMANO");
    const u2 = on(state, "u2", "UMANO");
    const n = on(state, "n", "AUROS");
    declare(state, "u1", 1);
    expect(attackSteps(state, u1, facts).map(s => s.source.uid)).toEqual(["m"]);
    declare(state, "n", 2);
    expect(attackSteps(state, n, facts)).toEqual([]);
    declare(state, "u2", 3);
    expect(attackSteps(state, u2, facts).map(s => s.source.uid)).toEqual(["m"], "due Umani non bastano");
    const u3 = on(state, "u3", "UMANO");
    declare(state, "u3", 4);
    expect(attackSteps(state, u3, facts).map(s => s.source.uid)).toEqual(["m", "rf"]);
    const nexus = { ...state, cards: { ...state.cards, rf: { ...state.cards.rf, face: 1 } } };
    const muster = attackSteps(nexus, u3, facts).find(s => s.source.uid === "rf")!;
    expect(muster.form).toMatchObject({ thenDraw: 1, face: 1 });
    expect(attackSteps({ ...state, fired: ["rf|on_attack:heal|turn"] }, u3, facts).map(s => s.source.uid)).toEqual(["m"]);
  });

  it("il Rubyfront in Zona di Richiamo non innesca niente: schierarlo sblocca le abilità (§3.1)", () => {
    const state = newGame();
    const rf = on(state, "rf", "OBLIVHAL");
    rf.y = backRowY("a");
    const u1 = on(state, "u1", "UMANO");
    const u2 = on(state, "u2", "UMANO");
    const u3 = on(state, "u3", "UMANO");
    declare(state, "u1", 1);
    declare(state, "u2", 2);
    declare(state, "u3", 3);
    expect(attackSteps(state, u3, facts)).toEqual([]);
    // Lo schieramento è il passaggio alla fila del Fronte, e da lì scatta.
    rf.y = frontRowY("a");
    expect(attackSteps(state, u3, facts).map(s => s.source.uid)).toEqual(["rf"]);
  });

  it("la Razzia vuole due Umani nel turno precedente", () => {
    const state = newGame();
    const r = on(state, "r", "RAZZIA");
    on(state, "u1", "UMANO", "a").zone = "ritiro";
    on(state, "u2", "UMANO");
    declare(state, "r", 1);
    expect(attackSteps(state, r, facts)).toEqual([]);
    expect(attackSteps({ ...state, lastWave: { a: ["u1", "u2"] } }, r, facts).map(s => s.form.kind)).toEqual(["empower"]);
  });

  it("la Vendetta va al primo Umano dichiarato dopo il Vendicatore", () => {
    const state = newGame();
    on(state, "v", "VENDICATORE");
    const n = on(state, "n", "AUROS");
    const u1 = on(state, "u1", "UMANO");
    const u2 = on(state, "u2", "UMANO");
    declare(state, "v", 1);
    declare(state, "n", 2);
    expect(pendingGrants(state, n, facts)).toEqual([]);
    declare(state, "u1", 3);
    expect(pendingGrants(state, u1, facts).map(s => s.source.uid)).toEqual(["v"]);
    declare(state, "u2", 4);
    expect(pendingGrants(state, u2, facts)).toEqual([], "il secondo Umano no");
    expect(pendingGrants({ ...state, fired: ["v|on_attack:empower:u1|v"] }, u1, facts)).toEqual([]);
  });

  it("il Vigile armato si stappa dopo il combattimento, una volta", () => {
    const state = newGame();
    on(state, "v", "VIGILE");
    on(state, "w", "VIGILE");
    on(state, "f", "FERRO").assignedTo = "v";
    declare(state, "v", 1);
    declare(state, "w", 2);
    expect(vigilUntaps(state, "a", facts)).toEqual(["v"]);
    expect(vigilUntaps({ ...state, fired: ["v|on_attack:untap|turn"] }, "a", facts)).toEqual([]);
  });
});

// Le Materie alla risoluzione (§7.2) e il flip del Nexus (§3.1): i passi e
// i candidati. Gemello: engine_test.rb, «Eredità Perduta».
describe("resolveSteps", () => {
  it("l'Attrazione guarda le prime quattro e propone gli Umani", () => {
    const state = newGame();
    const m = on(state, "m", "ATTRAZIONE");
    ["d1", "d2", "d3", "d4", "d5"].forEach((uid, i) => on(state, uid, i % 2 ? "UMANO" : "AUROS"));
    for (const uid of ["d1", "d2", "d3", "d4", "d5"]) state.cards[uid] = { ...state.cards[uid], zone: "deck", order: Number(uid[1]) };
    const [step] = resolveSteps(state, m, facts);
    expect(step.looked.map(c => c.uid)).toEqual(["d1", "d2", "d3", "d4"]);
    expect(step.candidates.map(c => c.uid)).toEqual(["d2", "d4"]);
    expect(describeResolveStep(step, facts)).toContain("prime 4");
  });

  it("la Formazione propone gli Umani propri, una volta sola; il Coordinato vuole tre Umani", () => {
    const state = newGame();
    const f = on(state, "f", "FORMAZIONE");
    on(state, "u1", "UMANO");
    on(state, "x", "AUROS");
    on(state, "b1", "UMANO", "b");
    expect(resolveSteps(state, f, facts)[0].candidates.map(c => c.uid)).toEqual(["u1"]);
    state.fired = ["f|on_resolve:empower:u1|f"];
    expect(pendingResolve(state, f, facts)).toEqual([]);
    const c = on(state, "c", "COORDINATO");
    expect(resolveSteps(state, c, facts)[0].blocked).toBe("log.no.humans");
    on(state, "u2", "UMANO");
    on(state, "u3", "UMANO");
    expect(resolveSteps(state, c, facts)[0].blocked).toBeNull();
    expect(resolveSteps(state, c, facts)[0].candidates.map(x => x.uid)).toEqual(["u1", "u2", "u3"]);
    expect(playsAsBlock(facts("COORDINATO"))).toBe(true);
    expect(playsAsBlock(facts("FORMAZIONE"))).toBe(false);
  });

  it("l'Impatto sceglie fra le avversarie economiche, il Campo fra Entità e permanenti avversari", () => {
    const state = newGame();
    const i = on(state, "i", "IMPATTO");
    const c = on(state, "c", "CAMPO");
    on(state, "p", "PICCOLA", "b");
    on(state, "g", "GRANDE", "b");
    on(state, "pm", "PERMANENTE", "b");
    on(state, "f", "FERRO", "b");
    on(state, "mine", "PICCOLA");
    expect(resolveSteps(state, i, facts)[0].candidates.map(x => x.uid)).toEqual(["p"]);
    expect(resolveSteps(state, c, facts)[0].candidates.map(x => x.uid)).toEqual(["p", "g", "pm"]);
  });

  it("il Giudizio: lo sconto contro una tappata, e l'effetto colpisce il bersaglio dichiarato", () => {
    const state = newGame();
    const g = on(state, "g", "GIUDIZIO");
    on(state, "p", "PICCOLA", "b");
    const tapped = on(state, "q", "GRANDE", "b");
    tapped.tapped = true;
    expect(wantsTargetOnPlay(facts("GIUDIZIO"))).toBe(true);
    expect(discountedCost(state, "GIUDIZIO", null, facts)).toBe(5);
    expect(discountedCost(state, "GIUDIZIO", state.cards.p, facts)).toBe(5);
    expect(discountedCost(state, "GIUDIZIO", tapped, facts)).toBe(2);
    expect(resolveSteps(state, g, facts)[0].candidates.map(x => x.uid)).toEqual(["p", "q"]);
    g.target = "q";
    expect(resolveSteps(state, g, facts)[0].candidates.map(x => x.uid)).toEqual(["q"]);
  });

  it("chi era tenuto nell'Abisso torna quando chi lo teneva lascia il gioco", async () => {
    const state = newGame();
    on(state, "c", "CAMPO");
    const held = on(state, "p", "PICCOLA", "b");
    held.zone = "abisso";
    held.heldBy = "c";
    expect(heldBy(state, "c").map(x => x.uid)).toEqual(["p"]);
    const sent: Action[] = [];
    const ctx: Ctx = {
      state: () => state, dispatch: action => { sent.push(action); return Promise.resolve(true); }, seat: () => "a", controls: () => true, arbitrated: () => true,
      themeFor: () => "notte", locale: () => "it", card: facts, log: () => undefined,
    };
    await releaseHeld(ctx, () => ({ x: 1, y: 2 }), () => ({ x: 9, y: 9 }));
    expect(sent).toEqual([]);
    state.cards.c.zone = "abisso";
    await releaseHeld(ctx, () => ({ x: 1, y: 2 }), () => ({ x: 9, y: 9 }));
    expect(sent).toEqual([{ t: "release", uid: "p", zone: "field", x: 1, y: 2 }]);
    sent.length = 0;
    await releaseHeld(ctx, () => null, () => ({ x: 9, y: 9 }));
    expect(sent).toEqual([{ t: "release", uid: "p", zone: "ritiro" }]);
  });
});

describe("il flip del Nexus", () => {
  it("nexusCheck vuole quattro Umani e una carta Entità in mano da scartare", () => {
    const state = newGame();
    const rf = on(state, "rf", "BESTIA");
    on(state, "u1", "UMANO");
    on(state, "u2", "UMANO");
    on(state, "u3", "UMANO");
    expect(nexusCheck(state, rf, facts)).toEqual({ ok: false, why: "log.nexus.few", n: 4 });
    on(state, "u4", "UMANO");
    expect(nexusCheck(state, rf, facts)).toEqual({ ok: false, why: "log.nexus.nodiscard" });
    const h = on(state, "h", "AUROS");
    h.zone = "hand";
    const m = on(state, "m", "PIETRA");
    m.zone = "hand";
    const check = nexusCheck(state, rf, facts);
    expect(check.ok && check.discards.map(c => c.uid)).toEqual(["h"]);
  });

  it("flipSteps: Rhen sul proprio Fronte nell'Abisso, e il sigillo", () => {
    const state = newGame();
    const rf = on(state, "rf", "BESTIA");
    rf.face = 1;
    on(state, "r", "EREDE");
    on(state, "r2", "EREDE", "b");
    const steps = flipSteps(state, rf, facts);
    expect(steps.map(s => [s.form.kind, s.candidates.map(c => c.uid)])).toEqual([["move", ["r"]], ["seal", []]]);
    expect(describeFlipStep(steps[0], facts)).toContain("EREDE");
    expect(describeFlipStep(steps[1], facts)).toContain("resto della partita");
  });
});

// RBF-040 — la Reattiva che ferma un attaccante e cura. Gemello: engine_test.rb, «lo scudo riflesso».
describe("RBF-040, giocata come blocco", () => {
  it("si gioca nella finestra dei blocchi, ferma un attaccante, e cura solo con due armati", () => {
    const state = newGame();
    const r = on(state, "r", "RIFLESSO", "b");
    on(state, "v1", "UMANO", "b");
    on(state, "v2", "UMANO", "b");
    on(state, "o1", "SCUDETTO", "b").assignedTo = "v1";
    expect(playsAsBlock(facts("RIFLESSO"))).toBe(true);
    expect(blocksAttacker(facts("RIFLESSO"))).toBe(true);
    expect(armedCount(state, "b", facts)).toBe(1);
    const [step] = resolveSteps(state, r, facts);
    expect(step.blocked).toBe("log.no.armed");
    expect(describeResolveStep(step, facts)).toContain("3");
    on(state, "o2", "SCUDETTO", "b").assignedTo = "v2";
    expect(armedCount(state, "b", facts)).toBe(2);
    expect(resolveSteps(state, r, facts)[0].blocked).toBeNull();
  });
});
