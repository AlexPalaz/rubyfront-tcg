// Le dichiarazioni davanti al poliziotto: se il declare viene fermato
// (es. §6.2, attesa di evocazione), il tap dell'attaccante, la copertura del
// contrattaccante e la riga in chat non devono partire affatto.

import { describe, expect, it } from "vitest";
import { declareAttack, declareBlock, resolveWave, undeclare } from "../src/combat.js";
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
      enterListeners: [],
      enterMoves: [],
    }),
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
