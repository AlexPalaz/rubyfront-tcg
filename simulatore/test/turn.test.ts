// Il fine turno davanti al poliziotto: il cambio di turno passa per primo
// dal giudizio, e se viene fermato il resto della routine (Flusso nuovo,
// frecce sgomberate) non parte affatto.

import { describe, expect, it } from "vitest";
import { endTurn } from "../src/turn.js";
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
