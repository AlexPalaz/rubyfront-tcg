// L'interprete degli effetti (§8.2), la forma di RBF-003: chi si innesca
// all'ingresso e come si risolve. Gemello: engine_test.rb, sezione §8.2.

import { renderLog } from "../src/log.js";
import { describe, expect, it } from "vitest";
import type { CardFacts, Ctx } from "../src/ctx.js";
import {
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
} from "../src/effects.js";
import { newGame } from "../src/state.js";
import type { Action, CardInstance, GameState, Seat } from "../src/types.js";

const FACTS: Record<string, Partial<CardFacts>> = {
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
};
const facts = (cardId: string): CardFacts => ({
  name: cardId,
  kind: null,
  race: null,
  power: null,
  counterattack: null,
  fluxCost: null,
  enterListeners: [],
  enterMoves: [],
  behavior: null,
  enterReturns: [],
  enterLooks: [],
  enterControls: [],
  attackReturns: [],
  ...FACTS[cardId],
});

function on(state: GameState, uid: string, cardId: string, owner: Seat = "a"): CardInstance {
  const card: CardInstance = { uid, cardId, owner, zone: "field", face: 0, x: 0, y: 0, order: 0, tapped: false, facedown: false, z: 1 };
  state.cards[uid] = card;
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
