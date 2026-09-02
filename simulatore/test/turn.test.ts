// Il fine turno davanti al poliziotto: il cambio di turno passa per primo
// dal giudizio, e se viene fermato il resto della routine (Flusso nuovo,
// frecce sgomberate) non parte affatto.

import { describe, expect, it } from "vitest";
import { endPhase, endTurn } from "../src/turn.js";
import { newGame } from "../src/state.js";
import type { Ctx } from "../src/ctx.js";
import type { Action, GameState, Seat } from "../src/types.js";

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
    log(text) {
      logs.push(text);
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
  it("col via libera chiude il turno e prepara il successivo", async () => {
    const { ctx, sent, logs } = fakeCtx(() => true);
    await endTurn(ctx);
    expect(sent.map(action => action.t)).toEqual(["turn", "player", "clearCombat"]);
    const turn = sent[0] as Extract<Action, { t: "turn" }>;
    expect(turn.active).toBe("b");
    const patch = (sent[1] as Extract<Action, { t: "player" }>).patch;
    expect(patch.fluxMax).toBe(2);
    expect(patch.flux).toBe(2);
    expect(logs).toHaveLength(1);
  });

  it("fermato il cambio di turno, non parte nient'altro", async () => {
    const { ctx, sent, logs } = fakeCtx(action => action.t !== "turn");
    await endTurn(ctx);
    expect(sent).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

  it("chi entra nel turno si ritrova le Entità stappate (§6.3)", async () => {
    const state = newGame(); // attivo: a → il turno passa a b
    fielded(state, "b-1", "b", true);
    fielded(state, "b-2", "b", false);
    fielded(state, "a-1", "a", true);
    fielded(state, "b-3", "b", true, "field");
    const { ctx, sent } = fakeCtx(() => true, state);
    await endTurn(ctx);
    const untaps = sent.filter(action => action.t === "tap");
    expect(untaps.map(action => (action as Extract<Action, { t: "tap" }>).uid).sort()).toEqual(["b-1", "b-3"]);
    expect(untaps.every(action => (action as Extract<Action, { t: "tap" }>).tapped === false)).toBe(true);
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

  it("dalla Reazione chiude il turno", async () => {
    const state = newGame();
    state.phase = "reazione";
    attack(state);
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
