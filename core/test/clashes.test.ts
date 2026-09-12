// Ciò che una risoluzione fa vedere (resa.ts): chi cade (§6.4) e chi incassa
// e regge (§6.3), sullo stato di prima dell'azione.

import { describe, expect, it } from "vitest";
import { clashesOf, fallenOf } from "../src/clashes";
import { newGame } from "../src/state.js";
import type { Action, Battle, CardInstance, GameState, Seat } from "../src/types.js";

function table(): GameState {
  const state = newGame();
  const put = (uid: string, owner: Seat, zone: CardInstance["zone"] = "field"): void => {
    state.cards[uid] = { uid, cardId: `X-${uid}`, owner, zone, face: 0, x: 0, y: 0, order: 0, tapped: false, facedown: false, z: 1 };
  };
  put("rf", "b");
  put("a1", "a");
  put("a2", "a");
  put("b1", "b");
  put("b2", "b");
  put("gone", "b", "abisso");
  state.declarations.push({ id: "d1", from: "a1", to: "rf", kind: "attack", seat: "a", order: 1 });
  state.declarations.push({ id: "d2", from: "a2", to: "rf", kind: "attack", seat: "a", order: 2 });
  return state;
}

const resolve = (battles: Battle[]): Action => ({ t: "resolve", battles }) as Action;
const battle = (extra: Partial<Battle>): Battle => ({ attacker: "a1", kind: "block", attackerDies: false, blockerDies: false, damage: 0, ...extra });

describe("fallenOf — chi cade (§6.4)", () => {
  it("l'attaccante e il bloccante segnati morti, una volta sola", () => {
    const state = table();
    // a1 muore due volte (due battaglie): vola una volta sola; b2 regge.
    expect(fallenOf(state, resolve([battle({ blocker: "b1", attackerDies: true, blockerDies: true }), battle({ blocker: "b2", attackerDies: true })]))).toEqual(["a1", "b1"]);
  });

  it("la Reattiva che blocca si consuma; chi ha Stasi resta; chi è già fuori dal campo non vola", () => {
    const state = table();
    expect(fallenOf(state, resolve([battle({ blocker: "b1", blockerSpent: true })]))).toEqual(["b1"]);
    expect(fallenOf(state, resolve([battle({ blocker: "b1", blockerDies: true, blockerStasis: true })]))).toEqual([]);
    expect(fallenOf(state, resolve([battle({ blocker: "gone", blockerDies: true })]))).toEqual([]);
  });

  it("un'azione che non è una risoluzione non fa cadere nessuno", () => {
    expect(fallenOf(table(), { t: "phase", phase: "fronte" } as Action)).toEqual([]);
  });
});

describe("clashesOf — chi incassa e regge (§6.3)", () => {
  it("la parata del bloccante che regge, la risposta di chi contrattacca", () => {
    const state = table();
    expect(clashesOf(state, resolve([battle({ blocker: "b1" }), battle({ attacker: "a2", blocker: "b2", kind: "counter" })]))).toEqual([
      { uid: "b1", kind: "parry" },
      { uid: "b2", kind: "riposte" },
    ]);
  });

  it("il Rubyfront colpito da un attacco non bloccato; chi muore non para", () => {
    const state = table();
    expect(clashesOf(state, resolve([battle({ kind: "unblocked", damage: 3 }), battle({ attacker: "a2", blocker: "b1", blockerDies: true })]))).toEqual([{ uid: "rf", kind: "strike" }]);
    expect(clashesOf(state, resolve([battle({ kind: "unblocked", damage: 0 })]))).toEqual([]);
  });
});
