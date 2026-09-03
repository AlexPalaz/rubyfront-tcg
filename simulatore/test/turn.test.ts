// Il fine turno davanti al poliziotto: il cambio di turno passa per primo
// dal giudizio, e se viene fermato il resto della routine (Flusso nuovo,
// frecce sgomberate) non parte affatto.

import { describe, expect, it } from "vitest";
import { endPhase, endTurn, loserByDeck, verdictByHp } from "../src/turn.js";
import { newGame } from "../src/state.js";
import type { Ctx } from "../src/ctx.js";
import { renderLog } from "../src/log.js";
import type { Action, GameState, Seat } from "../src/types.js";

/** Le statistiche stampate delle carte di prova (§6.3), per id. */
const facts: Record<string, { power: number; counterattack?: number }> = {};

/** Un Ctx finto: registra le azioni e risponde al posto dell'engine. */
function fakeCtx(
  judge: (action: Action) => boolean,
  state: GameState = newGame()
): { ctx: Ctx; sent: Action[]; logs: string[] } {
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

/** Mette una carta di prova sul tavolo, nella zona e nello stato voluti. */
function fielded(state: GameState, uid: string, owner: Seat, tapped: boolean, zone: "field" | "hand" = "field"): void {
  state.cards[uid] = {
    uid,
    cardId: `TEST-${uid}`,
    owner,
    zone,
    face: 0,
    x: 0,
    y: 0,
    order: 0,
    tapped,
    facedown: false,
    z: 1,
  };
}

describe("endTurn", () => {
  it("col via libera chiude il turno con un'azione sola", async () => {
    const { ctx, sent, logs } = fakeCtx(() => true);
    await endTurn(ctx);
    // La routine di chi entra (Flusso, stappata, frecce) sta nel riduttore
    // (state.test.ts): da qui parte solo il cambio di turno — niente gesti
    // compiuti «per conto» dell'altro, che l'arbitro fermerebbe (§6).
    expect(sent).toEqual([{ t: "turn", turn: 2, active: "b" }]);
    expect(logs).toHaveLength(1);
  });

  it("fermato il cambio di turno, non parte nient'altro", async () => {
    const { ctx, sent, logs } = fakeCtx(action => action.t !== "turn");
    await endTurn(ctx);
    expect(sent).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

});

// «Fine fase» (HUD con l'arbitro): un gesto solo che chiude la fase in
// corso, sempre in avanti, e dall'ultima chiude il turno.
describe("endPhase", () => {
  const attack = (state: GameState): void => {
    state.declarations.push({ id: "d1", from: "x", to: "rbf-b", kind: "attack", seat: "a", order: 1 });
  };

  it("dalla Preparazione dichiara la Fase di Fronte", async () => {
    const { ctx, sent } = fakeCtx(() => true);
    await endPhase(ctx);
    expect(sent).toEqual([{ t: "phase", phase: "fronte" }]);
  });

  it("dal Fronte con un'ondata in piedi passa al difensore", async () => {
    const state = newGame();
    state.phase = "fronte";
    attack(state);
    const { ctx, sent } = fakeCtx(() => true, state);
    await endPhase(ctx);
    expect(sent).toEqual([{ t: "phase", phase: "reazione" }]);
  });

  it("dal Fronte senza attacchi chiude il turno: la Reazione non c'è (§6.3)", async () => {
    const state = newGame();
    state.phase = "fronte";
    const { ctx, sent } = fakeCtx(() => true, state);
    await endPhase(ctx);
    expect(sent[0]).toMatchObject({ t: "turn", active: "b" });
  });

  it("dalla Reazione risolve l'ondata e poi chiude il turno", async () => {
    const state = newGame();
    state.phase = "reazione";
    attack(state);
    const { ctx, sent } = fakeCtx(() => true, state);
    await endPhase(ctx);
    // L'attaccante «x» non è in campo: la sua battaglia non c'è (§6.3,
    // uscite dal campo) — ma la risoluzione passa comunque, e poi il turno.
    expect(sent[0]).toEqual({ t: "resolve", seat: "a", battles: [] });
    expect(sent[1]).toMatchObject({ t: "turn", active: "b" });
  });

  it("se l'engine ferma la risoluzione il turno non si chiude", async () => {
    const state = newGame();
    state.phase = "reazione";
    attack(state);
    const { ctx, sent } = fakeCtx(action => action.t !== "resolve", state);
    await endPhase(ctx);
    expect(sent).toEqual([]);
  });

  it("dalla Reazione senza ondata chiude il turno e basta", async () => {
    const state = newGame();
    state.phase = "reazione";
    const { ctx, sent } = fakeCtx(() => true, state);
    await endPhase(ctx);
    expect(sent[0]).toMatchObject({ t: "turn", active: "b" });
  });

  it("un «no» dell'engine ferma il passo e basta", async () => {
    const { ctx, sent } = fakeCtx(() => false);
    await endPhase(ctx);
    expect(sent).toEqual([]);
  });
});

// La fine della partita (§2, §9): per PV dopo ogni azione, per mazzo al
// confine dei turni. Gemello: engine_test.rb, sezione §2/§9.
describe("fine della partita", () => {
  it("verdictByHp: a zero i PV avversari si vince, entrambi a zero è patta", () => {
    const state = newGame();
    expect(verdictByHp(state)).toBeNull();
    state.players.b.hp = 0;
    expect(verdictByHp(state)).toEqual({ winner: "a", reason: "hp" });
    state.players.a.hp = 0;
    expect(verdictByHp(state)).toEqual({ winner: null, reason: "draw" });
    state.over = { winner: null, reason: "draw" };
    expect(verdictByHp(state)).toBeNull();
  });

  it("loserByDeck: chi chiude a mazzo vuoto perde, se no chi entrerebbe a mazzo vuoto", () => {
    const state = newGame(); // attivo a, nessuna carta: nessun mazzo, nessun esaurito
    expect(loserByDeck(state)).toBeNull();
    fielded(state, "a-1", "a", false); // a ha carte ma il mazzo vuoto
    expect(loserByDeck(state)).toBe("a");
    fielded(state, "a-2", "a", false, "deck" as never);
    expect(loserByDeck(state)).toBeNull();
    fielded(state, "b-1", "b", false); // b entrerebbe a mazzo vuoto
    expect(loserByDeck(state)).toBe("b");
  });

  it("endTurn a mazzo esaurito dichiara la fine invece del cambio di turno", async () => {
    const state = newGame();
    fielded(state, "a-1", "a", false); // a chiude a mazzo vuoto
    fielded(state, "b-1", "b", false, "deck" as never);
    const { ctx, sent, logs } = fakeCtx(() => true, state);
    await endTurn(ctx);
    expect(sent).toEqual([{ t: "gameOver", winner: "b", reason: "deck" }]);
    expect(logs[0]).toMatch(/esaurito il mazzo/);
  });

  it("a partita finita endTurn non dichiara più nulla", async () => {
    const state = newGame();
    state.over = { winner: "b", reason: "deck" };
    const { ctx, sent } = fakeCtx(() => true, state);
    await endTurn(ctx);
    expect(sent.map(action => action.t)).toEqual(["turn"]);
  });
});
