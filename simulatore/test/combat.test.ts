// Le dichiarazioni davanti al poliziotto: se il declare viene fermato
// (es. §6.2, attesa di evocazione), il tap dell'attaccante, la copertura del
// contrattaccante e la riga in chat non devono partire affatto.

import { describe, expect, it } from "vitest";
import { declareAttack, declareBlock, undeclare } from "../src/combat.js";
import { newGame } from "../src/state.js";
import type { Ctx } from "../src/ctx.js";
import type { Action, CardInstance, Declaration, Seat } from "../src/types.js";

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
    log(text) {
      logs.push(text);
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
