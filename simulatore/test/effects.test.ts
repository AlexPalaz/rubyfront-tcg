// L'interprete degli effetti (§8.2), la forma di RBF-003: chi si innesca
// all'ingresso e come si risolve. Gemello: engine_test.rb, sezione §8.2.

import { describe, expect, it } from "vitest";
import type { CardFacts, Ctx } from "../src/ctx.js";
import { describeMove, describeTrigger, enterMoves, enterTriggers, resolveEnter, resolveMove } from "../src/effects.js";
import { newGame } from "../src/state.js";
import type { Action, CardInstance, GameState, Seat } from "../src/types.js";

const FACTS: Record<string, Partial<CardFacts>> = {
  ARCIERE: { kind: "entity", race: "human", enterMoves: [{ target: { kind: "entity", controller: "opponent" }, to: "ritiro" }] },
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
  enterListeners: [],
  enterMoves: [],
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
        logs.push(text);
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
