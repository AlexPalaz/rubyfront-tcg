// L'interprete degli effetti (§8.2), la forma di RBF-003: chi si innesca
// all'ingresso e come si risolve. Gemello: engine_test.rb, sezione §8.2.

import { renderLog } from "../src/log.js";
import { describe, expect, it } from "vitest";
import type { CardFacts, Ctx } from "../src/ctx.js";
import { FRONT_SLOT_X, backRowY, frontRowY } from "../src/geometry.js";
import { hasKeyword } from "../src/combat.js";
import {
  bestObjectCost,
  describeStash,
  describeTurnStartSearch,
  resolveTurnStartSearch,
  turnStartSearches,
  enterStashes,
  resolveStash,
  stashRef,
  enterDisarms,
  enterRearms,
  leaveReturns,
  rearmChoices,
  resolveLeaveReturn,
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
  flipCandidates,
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
  assignSteps,
  assignRef,
  assignCandidates,
  describeAssignStep,
  objectCost,
  searchCandidates,
  deckEnds,
  deathSteps,
  deathRef,
  describeDeathStep,
  rearmAfterDeath,
  weakenAmount,
  wornObjects,
  enterTaps,
  enterEmpowers,
  enterFreezes,
  enterWakes,
  describeFreeze,
  describeWake,
  resolveFreeze,
  resolveWake,
  freezable,
  stasisHeals,
  resolveStasisHeal,
  exileReturns,
  exileReturnRef,
  enterPeeks,
  enteredThisTurn,
  firstAttackerOf,
  sinks,
  describeTap,
  describeEnterEmpower,
  describePeek,
  resolvePeek,
  resolveTap,
  resolveEnterEmpower, enterSorts, describeSort, resolveSort, enterTallies, describeTally, resolveTally, tapHeals, describeTapHeal, resolveTapHeal, resolveTrigger } from "../src/effects.js";
import { apply, newGame, zoneCards } from "../src/state.js";
import type { Action, CardInstance, GameState, Seat } from "../src/types.js";

const FACTS: Record<string, Partial<CardFacts>> = {
  SHADOW: { kind: "entity", race: "auros", enterDisarms: [{ to: "ritiro" }], enterRearms: [{ any: true }] },
  SMITH: { kind: "entity", race: "auros", enterRearms: [{ self: true }] },
  ARTISAN: { kind: "entity", race: "auros", enterRearms: [{ self: true, maxCost: 2 }] },
  KING: { kind: "entity", race: "human", power: 5, attackForms: [{ kind: "untap", who: "self", targets: "all", die: 20, onRoll: [15, 20], face: 0 }] },
  BOUND: { kind: "entity", race: "auros", fluxCost: 1, leaveReturns: [{ maxCost: 2 }] },
  BLADE: { kind: "object", fluxCost: 2 },
  MACE: { kind: "object", fluxCost: 3 },
  SWORD: { kind: "object", fluxCost: 1 },
  RECRUIT: { kind: "entity", race: "auros", fluxCost: 1, enterStashes: [{ from: "hand", kind: "object", to: "ritiro", thenDraw: 1 }] },
  CATALYST: { kind: "object", fluxCost: 2, attackForms: [
    { kind: "empower", who: "object", targets: "bearer", power: 1, face: 0 },
    { kind: "stash", who: "object", die: 6, onRoll: [4, 6], other: true, thenDraw: 1, face: 0 },
  ] },
  EXPLORER: { kind: "entity", race: "auros", attackDraws: [{ draw: 1, thenDiscard: 1, requiresObject: true }] },
  // «All'inizio di ogni tuo turno, se non ci sono Oggetti sul tuo Fronte, cerca nel tuo mazzo un Oggetto…» (dal 2026-09-17).
  SCOUT: { kind: "entity", race: "auros", turnStartSearches: [{ requires: "no_object_on_own_front", kind: "object", from: "deck", to: "hand", shuffle: true }] },
  WATCHMAN: { kind: "entity", race: "human", attackForms: [{ kind: "untap", who: "self", once: true, requiresObject: true, face: 0 }] },
  COMMAND: { kind: "entity", race: "auros", attackForms: [{ kind: "empower", who: "self", requiresObject: true, targets: "others_armed", power: 1, face: 0 }] },
  SIGMA: { kind: "object", attackForms: [
    { kind: "empower", who: "object", targets: "bearer", power: 1, face: 0 },
    { kind: "look", who: "object", count: 4, reveal: { kind: "matter", race: null }, revealTo: "hand", restTo: "ritiro", die: 6, onRoll: [5, 6], face: 0 },
  ] },
  QUARTERMASTER: { kind: "entity", race: "auros", attackForms: [
    { kind: "rearm", who: "ally", attackerArmed: true, face: 0 },
    { kind: "look", who: "ally", count: 2, reveal: { kind: "object", race: null }, revealTo: "ritiro", restTo: "deck", die: null, onRoll: null, once: true, attackerArmed: true, face: 0 },
  ] },
  REFLEX: { kind: "matter", behavior: "reactive", resolveForms: [{ kind: "block", requiresArmed: 2, heal: 3, asBlock: true }] },
  BUCKLER: { kind: "object", grantsWhileAssigned: [] },
  HEIRS: { kind: "matter", behavior: "static", attackForms: [{ kind: "heal", who: "static", attackers: { kind: "entity", race: "human" }, die: 20, onRoll: null, gainOn: [1, 6], drainOn: [15, 20], amount: "human_attackers", once: true, face: 0 }] },
  OBLIVHAL: { kind: "rubyfront", attackForms: [
    { kind: "heal", who: "rubyfront", once: true, requiresAttackers: { count: 3, race: "human" }, amount: 2, die: null, onRoll: null, thenDraw: 0, thenDiscard: 0, face: 0 },
    { kind: "heal", who: "rubyfront", once: true, requiresAttackers: { count: 3, race: "human" }, amount: 2, die: null, onRoll: null, thenDraw: 1, thenDiscard: 1, face: 1 },
  ] },
  AVENGER: { kind: "entity", race: "human", attackForms: [{ kind: "empower", who: "self", once: true, targets: "next_human_attacker", grants: ["revenge"], face: 0 }] },
  RAID: { kind: "entity", race: "human", attackForms: [{ kind: "empower", who: "self", requiresPreviousAttackers: { count: 2, race: "human" }, targets: "opposing_entity", restrict: "block", face: 0 }] },
  // Il divieto di blocco «se almeno 2 Umani che controlli attaccano» (questo turno, la fonte compresa).
  CHARGE: { kind: "entity", race: "human", attackForms: [{ kind: "empower", who: "self", requiresAttackers: { count: 2, race: "human" }, targets: "opposing_entity", restrict: "block", face: 0 }] },
  IRON: { kind: "object" },
  ARCHER: { kind: "entity", race: "human", enterMoves: [{ target: { kind: "entity", controller: "opponent", maxCost: null }, to: "ritiro" }] },
  MARKSMAN: { kind: "entity", race: "human", enterMoves: [{ target: { kind: "entity", controller: "opponent", maxCost: null }, to: "abisso", hold: true }] },
  PICKY: { kind: "entity", race: "human", enterMoves: [{ target: { kind: "entity", controller: "opponent", maxCost: 3 }, to: "abisso", hold: true }] },
  COSTLY: { kind: "entity", race: "human", fluxCost: 4 },
  FAIR: { kind: "entity", race: "human", fluxCost: 3 },
  // La carta vera ha il solo innesco d'attacco (decisione del designer,
  // 2026-09-04); qui restano entrambi perché servono a provare che
  // `returnsFor` distingue i due eventi.
  RHEN: {
    kind: "entity",
    race: "human",
    enterReturns: [{ from: "ritiro", filter: { static: true }, to: "field" }],
    attackReturns: [{ from: "ritiro", filter: { static: true }, to: "field" }],
  },
  STATIC: { kind: "matter", behavior: "static" },
  SEEKER: { kind: "entity", race: "human", enterLooks: [{ count: 4, die: null, countBase: 0, reveal: { kind: "entity", race: "human" }, thenRetire: false }] },
  ARTIFICER: { kind: "entity", race: "auros", enterLooks: [{ count: null, die: 6, countBase: 2, reveal: { kind: "object", race: null }, thenRetire: true }] },
  GUARD: { kind: "entity", race: "auros", enterLooks: [{ count: null, die: 6, countBase: 0, reveal: { kind: "object", race: null }, thenRetire: true, formula: "result" }] },
  IRON: { kind: "object" },
  RALLIER: { kind: "entity", race: "human", enterControls: [{ target: { kind: "entity", controller: "opponent", maxCost: 3 }, grants: ["surge"] }] },
  SMALL: { kind: "entity", race: "auros", fluxCost: 2 },
  BIG: { kind: "entity", race: "auros", fluxCost: 5 },
  NORMAL: { kind: "matter", behavior: "normal" },
  GUIDE: { kind: "entity", race: "human", enterListeners: [{ enteringRace: "human", requires: { count: 3, race: "human" }, draw: 1 }] },
  HUMAN: { kind: "entity", race: "human" },
  AUROS: { kind: "entity", race: "auros" },
  STONE: { kind: "matter", race: null },
  ATTRACTION: { kind: "matter", behavior: "normal", fluxCost: 2, resolveForms: [{ kind: "look", count: 4, reveal: { kind: "entity", race: "human" }, revealTo: "hand", restTo: "deck", showUpTo: 2 }] },
  FORMATION: { kind: "matter", behavior: "reactive", fluxCost: 2, resolveForms: [{ kind: "empower", targets: "own_entity", race: "human", power: 1, untap: true }] },
  IMPACT: { kind: "matter", behavior: "normal", fluxCost: 1, resolveForms: [{ kind: "move", target: { kind: "entity", controller: "opponent", maxCost: 2 }, to: "ritiro", discount: null }] },
  FRACTURE: { kind: "matter", behavior: "normal", fluxCost: 3, resolveForms: [{ kind: "move", target: { kind: "entity", controller: "opponent", maxCost: null }, to: "ritiro", discount: { amount: 1, ifArmedAtLeast: 2 } }] },
  REFRACTION: { kind: "matter", behavior: "reactive", fluxCost: 2, resolveForms: [{ kind: "weaken", target: { kind: "entity", controller: "opponent", attacking: true }, amount: -1, perArmed: true }] },
  AMPLIFY: { kind: "matter", behavior: "reactive", fluxCost: 2, resolveForms: [{ kind: "empower", targets: "own_armed", power: 1, upTo: 2, untap: true }] },
  PRISM: { kind: "object", fluxCost: 3, assignForms: [{ kind: "exile", target: { kind: "entity", controller: "opponent" }, to: "abisso", hold: true }] },
  BEARER: { kind: "entity", race: "auros", fluxCost: 4, staticForms: [{ kind: "assign_discount", amount: 1 }], assignForms: [{ kind: "draw", count: 1, toSelf: true }] },
  FIELD: { kind: "matter", behavior: "static", fluxCost: 3, resolveForms: [{ kind: "exile", target: { static: true, controller: "opponent" }, to: "abisso", hold: true }] },
  COORDINATED: { kind: "matter", behavior: "reactive", fluxCost: 4, resolveForms: [{ kind: "empower", targets: "own_entities", race: "human", counter: 1, untap: true, requires: { count: 3, race: "human" } }] },
  JUDGMENT: { kind: "matter", behavior: "reactive", fluxCost: 5, resolveForms: [{ kind: "destroy", target: { kind: "entity", controller: "any" }, to: "abisso", discount: { amount: 3, ifTarget: "tapped" }, thenLose: null }] },
  SUBVERSION: { kind: "matter", behavior: "normal", fluxCost: 3, resolveForms: [{ kind: "destroy", target: { kind: "entity", controller: "opponent" }, to: "abisso", discount: null, thenLose: 2 }] },
  ASSAULT: { kind: "matter", behavior: "normal", fluxCost: 4, resolveForms: [{ kind: "drain", amount: "objects" }] },
  LATENT: { kind: "matter", behavior: "normal", fluxCost: 3, resolveForms: [{ kind: "search", count: 5, die: 20, bands: { matter: [1, 7], object: [8, 14], entity: [15, 20] }, revealTo: "hand", ifNoRevealTop: true, thenRetire: true, restTo: "deck" }] },
  FORGE: { kind: "rubyfront", assignForms: [{ kind: "ends", face: 0, swap: true, thenDraw: 1, thenDiscard: 1, once: true }, { kind: "ends", face: 1, toHand: true, otherToRetire: true, once: true }] },
  VESTIGE: { kind: "object", fluxCost: 3, deathForms: [{ kind: "remain", to: "ritiro", thenRearm: { other: true, to: "unarmed", free: true } }] },
  BEAST: { kind: "rubyfront", nexus: { face: 1, conditions: [{ count: 4, kind: "entity", race: "human" }], discard: { count: 1, kind: "entity" }, recovery: 5 },
    flipForms: [{ kind: "move", cardId: "HEIR", from: "field", to: "abisso" }, { kind: "seal", cardId: "HEIR" }, { kind: "draw", count: 1 }] },
  HEIR: { kind: "entity", race: "human", fluxCost: 6 },
  // Le forme dello starter Umani (dal 2026-10-20).
  WEARY: { kind: "entity", race: "human", power: 2, fluxCost: 1, enterTaps: [{ kind: "self_tap" }] },
  ORDER: { kind: "entity", race: "human", power: 2, fluxCost: 3, enterEmpowers: [{ targets: "other_own_entity", race: null, power: 1 }] },
  LEADER: { kind: "entity", race: "human", power: 6, attackForms: [{ kind: "empower", who: "self", targets: "all_attackers", power: 1, face: 0 }] },
  FLAME: { kind: "rubyfront", attackForms: [{ kind: "empower", who: "rubyfront", once: true, attackers: { kind: "entity", race: "human" }, targets: "attacker", power: 1, payHealth: 1, face: 0 }],
    nexus: { face: 1, conditions: [{ count: 3, kind: "entity", race: "human", attacked: true }], discard: { count: 1, kind: "entity", race: "human" }, recovery: 5 } },
  WILL: { kind: "matter", behavior: "reactive", fluxCost: 1, resolveForms: [{ kind: "empower", targets: "own_entity", race: null, counter: 1, untap: true }] },
  WALL: { kind: "matter", behavior: "reactive", fluxCost: 2, resolveForms: [{ kind: "weaken", target: { kind: "entity", controller: "opponent", attacking: false }, amount: -2, perArmed: false, thenRetireAtMost: 0 }] },
  BLOW: { kind: "matter", behavior: "normal", fluxDie: "d6", resolveForms: [{ kind: "move", target: { kind: "entity", controller: "opponent", maxCost: null }, to: "abisso", discount: null }] },
  MUSTER: { kind: "matter", behavior: "static", fluxCost: 2, enterPeeks: [{ enteringRace: "human", count: 1, mayBottom: true }],
    enterListeners: [{ enteringRace: "human", requires: null, requiresEntered: { count: 2, race: "human" }, draw: 1 }] },
  WEAKLING: { kind: "entity", race: "auros", power: 1, fluxCost: 1 },
  // Le forme dello starter Auros (dal 2026-10-22).
  FREEZER: { kind: "entity", race: "auros", power: 1, fluxCost: 3, enterFreezes: [{ targets: "opposing_entity", count: 1, maxCost: null }] },
  DOUBLEFREEZE: { kind: "entity", race: "auros", power: 6, fluxCost: 6, enterFreezes: [{ targets: "opposing_entity", count: 2, maxCost: 3 }] },
  WAKER: { kind: "entity", race: "auros", power: 3, fluxCost: 3, enterWakes: [{ targets: "own_entity", inState: "stasis", optional: true }] },
  STEADY: { kind: "entity", race: "auros", power: 2, fluxCost: 2, staticForms: [{ kind: "never_taps" }] },
  HEAVY: { kind: "entity", race: "auros", power: 5, fluxCost: 5 },
  ROUSER: { kind: "object", fluxCost: 3, staticForms: [{ kind: "bearer_power", amount: 2 }], assignForms: [{ kind: "wake", ifState: "stasis", toSelf: true }] },
  CHILL: { kind: "matter", behavior: "normal", fluxCost: 2, resolveForms: [{ kind: "freeze", target: { kind: "entity", controller: "opponent", maxCost: null }, count: 1 }] },
  BRACE: { kind: "matter", behavior: "reactive", fluxCost: 2, resolveForms: [{ kind: "empower", targets: "own_entity", race: null, power: 2, untap: false }] },
  QUEST: { kind: "matter", behavior: "normal", fluxCost: 4, resolveForms: [{ kind: "search_objects", upTo: 2, type: "object", elseTo: "hand", thenRoll: { die: 6, atLeast: 3, from: "ritiro" }, shuffle: true }] },
  UNDERTOW: { kind: "matter", behavior: "normal", fluxCost: 4, resolveForms: [{ kind: "exile_timed", target: { kind: "entity", controller: "opponent" }, to: "ritiro", turns: 3, die: 12, returnAtLeast: 8, elseTo: "abisso" }] },
  // Le forme della scheda riletta il 2026-10-23.
  GLANCER: { kind: "entity", race: "auros", power: 1, fluxCost: 1, keywords: ["stasis"], enterPeeks: [{ enteringRace: null, count: 1, mayBottom: true, self: true }] },
  TIDEKEEPER: { kind: "entity", race: "auros", power: 2, fluxCost: 2, enterListeners: [{ enteringRace: null, requires: null, draw: 0, heal: 1 }] },
  TIDEKEEPER_SELF: { kind: "entity", race: "auros", power: 2, fluxCost: 2, enterListeners: [{ enteringRace: null, requires: null, draw: 0, heal: 1, self: true }] },
  SOUNDER: { kind: "entity", race: "auros", power: 1, fluxCost: 2, keywords: ["stasis"], enterSorts: [{ count: 3 }] },
  BULWARK: { kind: "entity", race: "auros", power: 3, fluxCost: 4, staticForms: [{ kind: "grant_all", grants: ["stasis"] }], tapListeners: [{ scope: "controlled", amount: 1, die: null, atLeast: null }] },
  TALLYMAN: { kind: "entity", race: "auros", power: 5, fluxCost: 6, enterFreezes: [{ targets: "opposing_entity", count: 2, maxCost: 3, thenHealPerTapped: 1 }] },
  VESSEL: { kind: "object", fluxCost: 1, staticForms: [{ kind: "bearer_power", amount: 1 }], tapListeners: [{ scope: "bearer", amount: 1, die: 6, atLeast: 4 }] },
  SENTENCE: { kind: "matter", behavior: "normal", fluxDie: "d6", resolveForms: [{ kind: "sentence", target: { kind: "entity", controller: "opponent" }, die: 6, to: "abisso", elsePower: -2 }] },
  SALVAGE: { kind: "matter", behavior: "normal", fluxCost: 2, resolveForms: [{ kind: "search_objects", upTo: 1, type: "object", maxCost: 3, to: "ritiro", elseTo: null, thenRoll: { die: 6, atLeast: 3, from: "ritiro" }, shuffle: true }] },
  VIGIL: { kind: "rubyfront", stasisListeners: [{ face: 0, amount: 1, any: true }, { face: 1, amount: 2, any: true }],
    nexus: { face: 1, conditions: [{ count: 2, kind: "entity", race: null, inflicted: true }], discard: null, retire: { count: 1, kind: "object" }, recovery: 5 } },
};
const facts = (cardId: string): CardFacts => ({
  name: cardId,
  kind: null,
  race: null,
  power: null,
  counterattack: null,
  fluxCost: null,
  fluxDie: null,
  keywords: [],
  enterListeners: [],
  enterMoves: [],
  behavior: null,
  enterReturns: [],
  enterLooks: [],
  enterControls: [],
  enterRefreshes: [], enterPeeks: [], enterTaps: [], enterEmpowers: [], enterFreezes: [], enterWakes: [], stasisListeners: [], tapListeners: [], enterSorts: [],
  enterDisarms: [],
  enterRearms: [],
  enterStashes: [],
  selfRetires: [],
  leaveReturns: [],
  attackReturns: [],
  attackDraws: [],
  attackForms: [],
  staticForms: [],
  resolveForms: [],
  flipForms: [],
  assignForms: [], deathForms: [],
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
    on(state, "g", "GUIDE");
    const u1 = on(state, "u1", "HUMAN");
    expect(enterTriggers(state, u1, facts)).toEqual([]);
    const u2 = on(state, "u2", "HUMAN");
    expect(enterTriggers(state, u2, facts).map(t => t.source.uid)).toEqual(["g"]);
  });

  it("un Auros o una Materia non la innescano, e l'avversario nemmeno", () => {
    const state = newGame();
    on(state, "g", "GUIDE");
    on(state, "u1", "HUMAN");
    on(state, "u2", "HUMAN");
    expect(enterTriggers(state, on(state, "x", "AUROS"), facts)).toEqual([]);
    expect(enterTriggers(state, on(state, "m", "STONE"), facts)).toEqual([]);
    expect(enterTriggers(state, on(state, "b1", "HUMAN", "b"), facts)).toEqual([]);
  });

  it("descrive l'innesco", () => {
    const state = newGame();
    const g = on(state, "g", "GUIDE");
    expect(describeTrigger({ source: g, draw: 1 }, facts)).toBe("«GUIDE» si innesca: pesca 1 carta");
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
      roll: (die) => Promise.resolve(die),
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "night",
      tintFor: () => "dynamic",
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
    on(state, "g", "GUIDE");
    on(state, "u1", "HUMAN");
    const u2 = on(state, "u2", "HUMAN");
    const { ctx, sent, logs } = fakeCtx(state, () => true);
    const fired = await resolveEnter(ctx, u2);
    expect(sent).toEqual([{ t: "draw", seat: "a", count: 1, effect: { source: "g", event: "on_enter_field", entering: "u2" } }]);
    expect(fired.map(card => card.uid)).toEqual(["g"]);
    expect(logs[0]).toMatch(/«GUIDE» si innesca: pesca 1 carta/);
  });

  it("il «no» dell'engine ferma il passo e basta", async () => {
    const state = newGame();
    on(state, "g", "GUIDE");
    on(state, "u1", "HUMAN");
    const u2 = on(state, "u2", "HUMAN");
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
    const arc = on(state, "arc", "ARCHER");
    on(state, "b1", "HUMAN", "b");
    on(state, "b2", "STONE", "b");
    on(state, "a1", "HUMAN", "a");
    const steps = enterMoves(state, arc, facts);
    expect(steps).toHaveLength(1);
    expect(steps[0].to).toBe("ritiro");
    expect(steps[0].candidates.map(card => card.uid)).toEqual(["b1"]);
    expect(describeMove(steps[0], facts)).toMatch(/«ARCHER» si innesca/);
    expect(enterMoves(state, on(state, "u", "HUMAN"), facts)).toEqual([]);
  });

  it("resolveMove manda il toZone marcato come effetto", async () => {
    const state = newGame();
    const arc = on(state, "arc", "ARCHER");
    const b1 = on(state, "b1", "HUMAN", "b");
    const sent: Action[] = [];
    const ctx: Ctx = {
      state: () => state,
      dispatch(action) {
        sent.push(action);
        return Promise.resolve(true);
      },
      roll: (die) => Promise.resolve(die),
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "night",
      tintFor: () => "dynamic",
      locale: () => "it",
      card: facts,
      log() {},
    };
    const [step] = enterMoves(state, arc, facts);
    expect(await resolveMove(ctx, step, b1)).toBe(true);
    expect(sent).toEqual([{ t: "toZone", uid: "b1", zone: "ritiro", effect: { source: "arc", event: "on_enter_field", entering: "arc" } }]);
  });

  // Il vincolo di costo del bersaglio («con costo di Flusso 3 o inferiore»,
  // dal 2026-09-16): chi costa di più o ha costo ignoto non è un bersaglio.
  // Gemello: engine_test.rb, test_enter_exile_respects_target_cost_limit.
  it("l'esilio col vincolo di costo tiene solo le Entità nel costo", () => {
    const state = newGame();
    const picky = on(state, "picky", "PICKY");
    on(state, "b1", "FAIR", "b");
    on(state, "b2", "COSTLY", "b");
    on(state, "b3", "HUMAN", "b");
    const [step] = enterMoves(state, picky, facts);
    expect(step.maxCost).toBe(3);
    expect(step.candidates.map(card => card.uid)).toEqual(["b1"]);
    expect(describeMove(step, facts)).toMatch(/costo di Flusso 3 o inferiore/);
  });

  // L'esilio condizionato all'ingresso (§8.2): nell'Abisso, tenuta da chi
  // entra. Gemello: engine_test.rb, «l'esilio all'ingresso…».
  it("l'esilio all'ingresso manda il toZone nell'Abisso con heldBy", async () => {
    const state = newGame();
    const marksman = on(state, "marksman", "MARKSMAN");
    const b1 = on(state, "b1", "HUMAN", "b");
    const sent: Action[] = [];
    const ctx: Ctx = {
      state: () => state,
      dispatch(action) {
        sent.push(action);
        return Promise.resolve(true);
      },
      roll: (die) => Promise.resolve(die),
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "night",
      tintFor: () => "dynamic",
      locale: () => "it",
      card: facts,
      log() {},
    };
    const [step] = enterMoves(state, marksman, facts);
    expect(step.to).toBe("abisso");
    expect(step.hold).toBe(true);
    expect(describeMove(step, facts)).toMatch(/nell'Abisso/);
    expect(await resolveMove(ctx, step, b1)).toBe(true);
    expect(sent).toEqual([{ t: "toZone", uid: "b1", zone: "abisso", heldBy: "marksman", effect: { source: "marksman", event: "on_enter_field", entering: "marksman" } }]);
  });
});

// Il ritorno all'ingresso (§8.2), la forma di RBF-012. Gemello:
// engine_test.rb, sezione §8.2 Rhen.
describe("enterReturns", () => {
  function inRetire(state: GameState, uid: string, cardId: string, owner: Seat = "a"): CardInstance {
    const card = on(state, uid, cardId, owner);
    card.zone = "ritiro";
    return card;
  }

  it("i candidati sono le Statiche nella propria Zona di Ritiro: Entità e Materie Statiche", () => {
    const state = newGame();
    const rhen = on(state, "rhen", "RHEN");
    inRetire(state, "p1", "STATIC");
    inRetire(state, "n1", "NORMAL");
    inRetire(state, "u1", "HUMAN");
    inRetire(state, "bp", "STATIC", "b");
    const [step] = enterReturns(state, rhen, facts);
    expect(step.from).toBe("ritiro");
    // «Carta statica» (§10) è quel che resta in campo: l'Entità e la Materia
    // Statica. Non la Materia normale, non le carte dell'avversario.
    expect(step.candidates.map(card => card.uid)).toEqual(["p1", "u1"]);
    expect(step.frontFull).toBe(false);
    expect(describeReturn(step, facts)).toMatch(/«RHEN» si innesca/);
  });

  it("a Fronte pieno le Entità restano candidate — si sostituisce una propria (§6.2, dal 2026-09-15) — e il passo lo dice", () => {
    const state = newGame();
    const rhen = on(state, "rhen", "RHEN");
    // Cinque Entità sulla fila del Fronte: gli slot sono tutti presi.
    FRONT_SLOT_X.forEach((x, index) => {
      const card = on(state, `f${index}`, "HUMAN");
      card.x = x;
      card.y = frontRowY("a");
    });
    inRetire(state, "p1", "STATIC");
    const [matterOnly] = enterReturns(state, rhen, facts);
    expect(matterOnly.candidates.map(card => card.uid)).toEqual(["p1"]);
    expect(matterOnly.frontFull).toBe(false);
    inRetire(state, "u1", "HUMAN");
    const [full] = enterReturns(state, rhen, facts);
    expect(full.candidates.map(card => card.uid).sort()).toEqual(["p1", "u1"]);
    expect(full.frontFull).toBe(true);
  });

  it("resolveReturn con la sostituzione manda il toZone con replace, e racconta chi lascia il posto", async () => {
    const state = newGame();
    const rhen = on(state, "rhen", "RHEN");
    const f0 = on(state, "f0", "HUMAN");
    inRetire(state, "u1", "HUMAN");
    const sent: Action[] = [];
    const logs: string[] = [];
    const ctx: Ctx = {
      state: () => state,
      dispatch(action) {
        sent.push(action);
        return Promise.resolve(true);
      },
      roll: (die) => Promise.resolve(die),
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "night",
      tintFor: () => "dynamic",
      locale: () => "it",
      card: facts,
      log: text => void logs.push(typeof text === "string" ? text : text.key),
    };
    const [step] = enterReturns(state, rhen, facts);
    expect(await resolveReturn(ctx, step, state.cards.u1, { spot: { x: f0.x, y: f0.y }, replace: "f0" })).toBe(true);
    expect(sent[0]).toMatchObject({ t: "toZone", uid: "u1", zone: "field", replace: "f0", x: f0.x, y: f0.y });
    expect(logs).toEqual(["log.effect.return", "log.effect.replace"]);
  });

  it("resolveReturn manda il toZone verso il campo marcato come effetto", async () => {
    const state = newGame();
    const rhen = on(state, "rhen", "RHEN");
    const p1 = inRetire(state, "p1", "STATIC");
    const sent: Action[] = [];
    const ctx: Ctx = {
      state: () => state,
      dispatch(action) {
        sent.push(action);
        return Promise.resolve(true);
      },
      roll: (die) => Promise.resolve(die),
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "night",
      tintFor: () => "dynamic",
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
    const seeker = on(state, "seeker", "SEEKER");
    inDeck(state, "d1", "STONE", 0);
    inDeck(state, "d2", "HUMAN", 1);
    inDeck(state, "d3", "AUROS", 2);
    inDeck(state, "d4", "HUMAN", 3);
    inDeck(state, "d5", "HUMAN", 4);
    const [step] = enterLooks(state, seeker, facts);
    expect(step.looked.map(card => card.uid)).toEqual(["d1", "d2", "d3", "d4"]);
    expect(step.candidates.map(card => card.uid)).toEqual(["d2", "d4"]);
    expect(describeLook(step, facts)).toMatch(/guarda le prime 4/);
  });

  it("resolveLook manda l'azione look marcata come effetto", async () => {
    const state = newGame();
    const seeker = on(state, "seeker", "SEEKER");
    const d2 = inDeck(state, "d2", "HUMAN", 0);
    const sent: Action[] = [];
    const ctx: Ctx = {
      state: () => state,
      dispatch(action) {
        sent.push(action);
        return Promise.resolve(true);
      },
      roll: (die) => Promise.resolve(die),
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "night",
      tintFor: () => "dynamic",
      locale: () => "it",
      card: facts,
      log() {},
    };
    const [step] = enterLooks(state, seeker, facts);
    expect(await resolveLook(ctx, step, d2)).toBe(true);
    expect(sent[0]).toEqual({ t: "look", seat: "a", count: 4, reveal: "d2", effect: { source: "seeker", event: "on_enter_field", entering: "seeker" } });
    expect(await resolveLook(ctx, step, null)).toBe(true);
    expect(sent[1]).not.toHaveProperty("reveal");
  });
});

// Il controllo (§8.2), la forma di RBF-009, e la restituzione a fine turno.
// Gemello: engine_test.rb, sezione §8.2 Radunatore.
describe("disarmo, riarmo e ritorno vincolato (§8.2, dal 2026-09-10)", () => {
  it("enterDisarms elenca gli Oggetti assegnati a Entità avversarie in campo, non i propri né gli sciolti", () => {
    const state = newGame();
    const shadow = on(state, "shadow", "SHADOW");
    on(state, "mine", "HUMAN");
    on(state, "blade-a", "BLADE").assignedTo = "mine";
    on(state, "theirs", "HUMAN", "b");
    on(state, "blade-b", "BLADE", "b").assignedTo = "theirs";
    on(state, "mace-b", "MACE", "b");
    const steps = enterDisarms(state, shadow, facts);
    expect(steps).toHaveLength(1);
    expect(steps[0].candidates.map(card => card.uid)).toEqual(["blade-b"]);
    expect(steps[0].to).toBe("ritiro");
    expect(enterDisarms(state, state.cards.mine, facts)).toEqual([]);
  });

  it("rearmChoices legge gli Oggetti del proprio Ritiro e le proprie Entità scoperte", () => {
    const state = newGame();
    const shadow = on(state, "shadow", "SHADOW");
    on(state, "mine", "HUMAN");
    on(state, "hidden", "HUMAN").facedown = true;
    on(state, "theirs", "HUMAN", "b");
    on(state, "blade-a", "BLADE").zone = "ritiro";
    on(state, "blade-b", "BLADE", "b").zone = "ritiro";
    const { objects, bearers } = rearmChoices(state, shadow, facts);
    expect(objects.map(card => card.uid)).toEqual(["blade-a"]);
    expect(bearers.map(card => card.uid).sort()).toEqual(["mine", "shadow"]);
    expect(enterRearms(shadow, facts)).toEqual([{ source: shadow, self: false, maxCost: null }]);
    // La variante su di sé: l'unico portatore possibile è chi entra.
    const smith = on(state, "smith", "SMITH");
    expect(enterRearms(smith, facts)).toEqual([{ source: smith, self: true, maxCost: null }]);
    expect(rearmChoices(state, smith, facts, true).bearers.map(card => card.uid)).toEqual(["smith"]);
    // Entro il costo (dal 2026-09-15): la Mazza da 3 resta in Ritiro.
    on(state, "mace-a", "MACE").zone = "ritiro";
    const artisan = on(state, "artisan", "ARTISAN");
    expect(enterRearms(artisan, facts)).toEqual([{ source: artisan, self: true, maxCost: 2 }]);
    expect(rearmChoices(state, artisan, facts, true, 2).objects.map(card => card.uid)).toEqual(["blade-a"]);
    expect(rearmChoices(state, artisan, facts, true).objects.map(card => card.uid).sort()).toEqual(["blade-a", "mace-a"]);
  });

  it("leaveReturns vede chi è appena uscita senza Oggetti, coi candidati entro il costo", () => {
    const before = newGame();
    on(before, "bound", "BOUND");
    on(before, "blade-a", "BLADE").zone = "ritiro";
    on(before, "mace-a", "MACE").zone = "ritiro";
    on(before, "blade-b", "BLADE", "b").zone = "ritiro";
    const after: GameState = { ...before, cards: { ...before.cards, bound: { ...before.cards.bound, zone: "abisso" } } };
    const steps = leaveReturns(before, after, facts);
    expect(steps).toHaveLength(1);
    expect(steps[0].card.uid).toBe("bound");
    expect(steps[0].maxCost).toBe(2);
    expect(steps[0].candidates.map(card => card.uid)).toEqual(["blade-a"]);
    expect(steps[0].frontFull).toBe(false);
    // Uscita armata: niente.
    const armed: GameState = { ...before, cards: { ...before.cards, worn: { ...before.cards["blade-a"], uid: "worn", zone: "field", assignedTo: "bound" } } };
    const disarmed: GameState = { ...after, cards: { ...after.cards, worn: { ...armed.cards.worn, zone: "ritiro", assignedTo: undefined } } };
    expect(leaveReturns(armed, disarmed, facts)).toEqual([]);
    // In mano non è un'uscita dal campo; senza cambiamenti nemmeno.
    expect(leaveReturns(before, { ...before, cards: { ...before.cards, bound: { ...before.cards.bound, zone: "hand" } } }, facts)).toEqual([]);
    expect(leaveReturns(before, before, facts)).toEqual([]);
  });

  it("resolveLeaveReturn manda un'azione revive sola, marcata on_leave_field", async () => {
    const before = newGame();
    const bound = on(before, "bound", "BOUND");
    const blade = on(before, "blade-a", "BLADE");
    blade.zone = "ritiro";
    const after: GameState = { ...before, cards: { ...before.cards, bound: { ...bound, zone: "ritiro" } } };
    const sent: Action[] = [];
    const ctx: Ctx = {
      state: () => after,
      dispatch(action) {
        sent.push(action);
        return Promise.resolve(true);
      },
      roll: (die) => Promise.resolve(die),
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "night",
      tintFor: () => "dynamic",
      locale: () => "it",
      card: facts,
      log() {},
    };
    const step = leaveReturns(before, after, facts)[0];
    expect(await resolveLeaveReturn(ctx, step, blade, { spot: { x: FRONT_SLOT_X[1], y: frontRowY("a") } })).toBe(true);
    expect(sent).toEqual([{ t: "revive", uid: "bound", x: FRONT_SLOT_X[1], y: frontRowY("a"), z: after.zTop, object: "blade-a", effect: { source: "bound", event: "on_leave_field", entering: "bound" } }]);
  });
});

describe("enterControls", () => {
  function fake(state: GameState): { ctx: Ctx; sent: Action[] } {
    const sent: Action[] = [];
    const ctx: Ctx = {
      state: () => state,
      dispatch(action) {
        sent.push(action);
        return Promise.resolve(true);
      },
      roll: (die) => Promise.resolve(die),
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "night",
      tintFor: () => "dynamic",
      locale: () => "it",
      card: facts,
      log() {},
    };
    return { ctx, sent };
  }

  it("i candidati sono le Entità avversarie entro il costo", () => {
    const state = newGame();
    const rad = on(state, "rad", "RALLIER");
    on(state, "b1", "SMALL", "b");
    on(state, "b2", "BIG", "b");
    on(state, "b3", "STONE", "b");
    on(state, "a1", "SMALL", "a");
    const [step] = enterControls(state, rad, facts);
    expect(step.candidates.map(card => card.uid)).toEqual(["b1"]);
    expect(step.grants).toEqual(["surge"]);
    expect(describeControl(step, facts)).toMatch(/prendi il controllo/);
  });

  it("resolveControl manda l'azione control, e releaseControlled restituisce a fine turno", async () => {
    const state = newGame();
    const rad = on(state, "rad", "RALLIER");
    const b1 = on(state, "b1", "SMALL", "b");
    const { ctx, sent } = fake(state);
    const [step] = enterControls(state, rad, facts);
    expect(await resolveControl(ctx, step, b1)).toBe(true);
    expect(sent[0]).toEqual({ t: "control", uid: "b1", by: "a", grants: ["surge"], effect: { source: "rad", event: "on_enter_field", entering: "rad" } });
    b1.controller = "a";
    await releaseControlled(ctx, () => ({ x: 442, y: 172 }));
    expect(sent[1]).toEqual({ t: "release", uid: "b1", zone: "field", x: 442, y: 172 });
    await releaseControlled(ctx, () => null);
    expect(sent[2]).toEqual({ t: "release", uid: "b1", zone: "ritiro" });
  });

  // 2026-09-17: il controllo preso dal difensore in Reazione si restituisce
  // allo stesso cambio di turno — chiunque comandi. Gemello: engine_test.rb,
  // «test_release_at_turn_change_whoever_commands».
  it("releaseControlled restituisce le carte di ogni comandante, e il riduttore annota il turno del controllo", async () => {
    let state = newGame("a");
    on(state, "rad", "RALLIER");
    on(state, "b1", "SMALL", "b");
    on(state, "a1", "SMALL", "a");
    state = apply(state, { t: "control", uid: "a1", by: "b", grants: [] });
    expect(state.cards.a1?.controlTurn).toBe(state.turn);
    state.cards.b1!.controller = "a";
    const { ctx, sent } = fake(state);
    await releaseControlled(ctx, () => ({ x: 442, y: 172 }));
    expect(sent.map(action => action.t)).toEqual(["release", "release"]);
    expect(sent.map(action => (action as { uid: string }).uid).sort()).toEqual(["a1", "b1"]);
    const freed = apply(state, { t: "release", uid: "a1", zone: "field", x: 442, y: 1260 });
    expect(freed.cards.a1?.controlTurn).toBeUndefined();
  });
});

// Lo sguardo col dado (§8.2), la forma di RBF-027. Gemello: engine_test.rb.
describe("lookAfterRoll", () => {
  it("il conto è 2 più metà del tiro, arrotondata per eccesso — o tante carte quanto il tiro", () => {
    const look = facts("ARTIFICER").enterLooks[0];
    expect([1, 2, 3, 4, 5, 6].map(roll => lookCount(look, roll))).toEqual([3, 3, 4, 4, 5, 5]);
    expect([1, 2, 3, 4, 5, 6].map(roll => lookCount(facts("GUARD").enterLooks[0], roll))).toEqual([1, 2, 3, 4, 5, 6]);
    const state = newGame();
    const art = on(state, "art", "ARTIFICER");
    for (let i = 1; i <= 6; i++) {
      const card = on(state, `d${i}`, i === 2 ? "IRON" : "STONE");
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
    const p1 = on(state, "p1", "STATIC");
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
      roll: (die) => Promise.resolve(die),
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "night",
      tintFor: () => "dynamic",
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
      roll: (die) => Promise.resolve(die),
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "night",
      tintFor: () => "dynamic",
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
    const scout = on(state, "scout", "EXPLORER");
    expect(attackDraws(state, scout, facts)).toEqual([]);
    const iron = on(state, "iron", "IRON");
    iron.assignedTo = "scout";
    const [step] = attackDraws(state, scout, facts);
    expect(step).toMatchObject({ draw: 1, thenDiscard: 1 });
    expect(describeAttackDraw(step, facts)).toBe("«EXPLORER» si innesca: pesca 1 carta, poi scarta 1");
  });

  it("un Oggetto fuori dal campo non veste nessuno", () => {
    const state = newGame();
    const scout = on(state, "scout", "EXPLORER");
    const iron = on(state, "iron", "IRON");
    iron.assignedTo = "scout";
    iron.zone = "ritiro";
    expect(attackDraws(state, scout, facts)).toEqual([]);
  });

  it("la pesca e lo scarto viaggiano marcati come effetto, lo scarto col suo seguito", async () => {
    const state = newGame();
    const scout = on(state, "scout", "EXPLORER");
    on(state, "iron", "IRON").assignedTo = "scout";
    const h1 = on(state, "h1", "HUMAN");
    h1.zone = "hand";
    const { ctx, sent, logs } = fakeCtx(state, () => true);
    const [step] = attackDraws(state, scout, facts);
    expect(await resolveAttackDraw(ctx, step)).toBe(true);
    expect(await resolveAttackDiscard(ctx, step, h1)).toBe(true);
    expect(sent).toEqual([
      { t: "draw", seat: "a", count: 1, effect: { source: "scout", event: "on_attack", entering: "scout" } },
      { t: "toZone", uid: "h1", zone: "ritiro", effect: { source: "scout", event: "on_attack", entering: "scout", follow: "discard" } },
    ]);
    expect(logs[1]).toMatch(/«EXPLORER» scarta «HUMAN»/);
  });

  it("fermata dall'engine, la pesca non racconta nulla", async () => {
    const state = newGame();
    const scout = on(state, "scout", "EXPLORER");
    on(state, "iron", "IRON").assignedTo = "scout";
    const { ctx, sent, logs } = fakeCtx(state, () => false);
    const [step] = attackDraws(state, scout, facts);
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
    const c = on(state, "c", "COMMAND");
    declare(state, "c", 1);
    expect(attackSteps(state, c, facts)).toEqual([]);
    on(state, "f", "IRON").assignedTo = "c";
    const steps = attackSteps(state, c, facts);
    expect(steps.map(s => [s.source.uid, s.form.kind])).toEqual([["c", "empower"]]);
    expect(describeAttackStep(steps[0], facts)).toMatch(/«COMMAND» si innesca: le altre Entità con un Oggetto assegnato prendono \+1/);
    expect(attackRef(steps[0])).toEqual({ source: "c", event: "on_attack", entering: "c" });
  });

  it("il d20 all'attacco: un passo di chi attacca; poi, col tiro riuscito, alla risoluzione si stappano tutte (2026-09-15)", () => {
    const state = newGame();
    const k = on(state, "k", "KING");
    const u = on(state, "u", "HUMAN");
    u.tapped = true;
    declare(state, "k", 1);
    const steps = attackSteps(state, k, facts);
    expect(steps.map(s => [s.source.uid, s.form.kind])).toEqual([["k", "untap"]]);
    expect(describeAttackStep(steps[0], facts)).toMatch(/d20, con 15–20 stappa tutte le tue Entità/);
    // Risolto (la chiave `refresh`), non si ripropone.
    state.fired = ["k|on_attack:refresh|k"];
    expect(attackSteps(state, k, facts)).toEqual([]);
    // Senza il tiro riuscito, alla risoluzione nessuno si stappa; col tiro, tutte le proprie tappate.
    expect(vigilUntaps(state, "a", facts)).toEqual([]);
    state.players.a.untapAfter = state.turn;
    k.tapped = true;
    expect(vigilUntaps(state, "a", facts).sort()).toEqual(["k", "u"]);
  });

  it("l'Oggetto addosso a chi attacca si innesca, in due passi, dopo quelli di chi attacca", () => {
    const state = newGame();
    const u = on(state, "u", "HUMAN");
    on(state, "s", "SIGMA").assignedTo = "u";
    on(state, "s2", "SIGMA").assignedTo = "other";
    declare(state, "u", 1);
    expect(attackSteps(state, u, facts).map(s => [s.source.uid, s.form.kind])).toEqual([["s", "empower"], ["s", "look"]]);
  });

  it("l'alleato si innesca solo se chi attacca è armato; lo sguardo una volta per turno", () => {
    const state = newGame();
    const u = on(state, "u", "HUMAN");
    on(state, "q", "QUARTERMASTER");
    declare(state, "u", 1);
    expect(attackSteps(state, u, facts)).toEqual([]);
    on(state, "f", "IRON").assignedTo = "u";
    expect(attackSteps(state, u, facts).map(s => [s.source.uid, s.form.kind])).toEqual([["q", "rearm"], ["q", "look"]]);
    const later = { ...state, fired: ["q|on_attack:look|turn"] };
    expect(attackSteps(later, u, facts).map(s => s.form.kind)).toEqual(["rearm"]);
    expect(attackRef(attackSteps(state, u, facts)[1])).toEqual({ source: "q", event: "on_attack", entering: "u", once: true });
  });

  it("la Materia Statica ascolta solo gli Umani; il Rubyfront il terzo Umano, una volta", () => {
    const state = newGame();
    on(state, "m", "HEIRS");
    deploy(state, "rf", "OBLIVHAL");
    const u1 = on(state, "u1", "HUMAN");
    const u2 = on(state, "u2", "HUMAN");
    const n = on(state, "n", "AUROS");
    declare(state, "u1", 1);
    expect(attackSteps(state, u1, facts).map(s => s.source.uid)).toEqual(["m"]);
    declare(state, "n", 2);
    expect(attackSteps(state, n, facts)).toEqual([]);
    declare(state, "u2", 3);
    expect(attackSteps(state, u2, facts).map(s => s.source.uid)).toEqual(["m"], "due Umani non bastano");
    const u3 = on(state, "u3", "HUMAN");
    declare(state, "u3", 4);
    expect(attackSteps(state, u3, facts).map(s => s.source.uid)).toEqual(["m", "rf"]);
    const nexus = { ...state, cards: { ...state.cards, rf: { ...state.cards.rf, face: 1 } } };
    const muster = attackSteps(nexus, u3, facts).find(s => s.source.uid === "rf")!;
    expect(muster.form).toMatchObject({ thenDraw: 1, face: 1 });
    expect(attackSteps({ ...state, fired: ["rf|on_attack:heal|turn"] }, u3, facts).map(s => s.source.uid)).toEqual(["m"]);
    // La Statica si risolve una volta per turno: scattata con un Umano, non si ripropone col prossimo.
    expect(attackSteps({ ...state, fired: ["m|on_attack:heal|turn"] }, u3, facts).map(s => s.source.uid)).toEqual(["rf"]);
  });

  it("annullare l'attacco e ridichiararlo non ripropone i potenziamenti già scattati", () => {
    const state = newGame();
    const c = on(state, "c", "COMMAND");
    on(state, "o", "BUCKLER").assignedTo = "c";
    const ally = on(state, "a2", "COMMAND");
    on(state, "o2", "BUCKLER").assignedTo = "a2";
    declare(state, "c", 1);
    expect(attackSteps(state, c, facts).map(s => s.form.kind)).toEqual(["empower"]);
    const fired = { ...state, fired: ["c|on_attack:empower:a2|c"] };
    expect(attackSteps(fired, c, facts)).toEqual([]);
    expect(ally.uid).toBe("a2");
  });

  it("il Rubyfront in Zona di Richiamo non innesca niente: schierarlo sblocca le abilità (§3.1)", () => {
    const state = newGame();
    const rf = on(state, "rf", "OBLIVHAL");
    rf.y = backRowY("a");
    const u1 = on(state, "u1", "HUMAN");
    const u2 = on(state, "u2", "HUMAN");
    const u3 = on(state, "u3", "HUMAN");
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
    const r = on(state, "r", "RAID");
    on(state, "u1", "HUMAN", "a").zone = "ritiro";
    on(state, "u2", "HUMAN");
    declare(state, "r", 1);
    expect(attackSteps(state, r, facts)).toEqual([]);
    expect(attackSteps({ ...state, lastWave: { a: ["u1", "u2"] } }, r, facts).map(s => s.form.kind)).toEqual(["empower"]);
  });

  it("la Carica vuole due Umani all'attacco in questo turno, e conta se stessa", () => {
    const state = newGame();
    const c = on(state, "c", "CHARGE");
    on(state, "u1", "HUMAN");
    on(state, "n", "AUROS");
    declare(state, "c", 1);
    expect(attackSteps(state, c, facts)).toEqual([], "da sola no");
    declare(state, "n", 2);
    expect(attackSteps(state, c, facts)).toEqual([], "l'Auros non conta");
    declare(state, "u1", 3);
    expect(attackSteps(state, c, facts).map(s => s.form.kind)).toEqual(["empower"]);
    // Gli attaccanti del turno precedente non c'entrano.
    expect(attackSteps({ ...newGame(), cards: { c: state.cards.c }, declarations: state.declarations.filter(d => d.from === "c"), lastWave: { a: ["u1", "n"] } } as typeof state, c, facts)).toEqual([]);
  });

  it("la Vendetta va al primo Umano dichiarato dopo il Vendicatore", () => {
    const state = newGame();
    on(state, "v", "AVENGER");
    const n = on(state, "n", "AUROS");
    const u1 = on(state, "u1", "HUMAN");
    const u2 = on(state, "u2", "HUMAN");
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
    on(state, "v", "WATCHMAN");
    on(state, "w", "WATCHMAN");
    on(state, "f", "IRON").assignedTo = "v";
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
    const m = on(state, "m", "ATTRACTION");
    ["d1", "d2", "d3", "d4", "d5"].forEach((uid, i) => on(state, uid, i % 2 ? "HUMAN" : "AUROS"));
    for (const uid of ["d1", "d2", "d3", "d4", "d5"]) state.cards[uid] = { ...state.cards[uid], zone: "deck", order: Number(uid[1]) };
    const [step] = resolveSteps(state, m, facts);
    expect(step.looked.map(c => c.uid)).toEqual(["d1", "d2", "d3", "d4"]);
    expect(step.candidates.map(c => c.uid)).toEqual(["d2", "d4"]);
    expect(describeResolveStep(step, facts)).toContain("prime 4");
  });

  it("la Formazione propone gli Umani propri, una volta sola; il Coordinato vuole tre Umani", () => {
    const state = newGame();
    const f = on(state, "f", "FORMATION");
    on(state, "u1", "HUMAN");
    on(state, "x", "AUROS");
    on(state, "b1", "HUMAN", "b");
    expect(resolveSteps(state, f, facts)[0].candidates.map(c => c.uid)).toEqual(["u1"]);
    state.fired = ["f|on_resolve:empower:u1|f"];
    expect(pendingResolve(state, f, facts)).toEqual([]);
    const c = on(state, "c", "COORDINATED");
    expect(resolveSteps(state, c, facts)[0].blocked).toBe("log.no.humans");
    on(state, "u2", "HUMAN");
    on(state, "u3", "HUMAN");
    expect(resolveSteps(state, c, facts)[0].blocked).toBeNull();
    expect(resolveSteps(state, c, facts)[0].candidates.map(x => x.uid)).toEqual(["u1", "u2", "u3"]);
    expect(playsAsBlock(facts("COORDINATED"))).toBe(false);
    expect(playsAsBlock(facts("FORMATION"))).toBe(false);
  });

  it("l'Impatto sceglie fra le avversarie economiche, il Campo fra Entità e carte statiche avversarie", () => {
    const state = newGame();
    const i = on(state, "i", "IMPACT");
    const c = on(state, "c", "FIELD");
    on(state, "p", "SMALL", "b");
    on(state, "g", "BIG", "b");
    on(state, "pm", "STATIC", "b");
    on(state, "f", "IRON", "b");
    on(state, "mine", "SMALL");
    expect(resolveSteps(state, i, facts)[0].candidates.map(x => x.uid)).toEqual(["p"]);
    expect(resolveSteps(state, c, facts)[0].candidates.map(x => x.uid)).toEqual(["p", "g", "pm"]);
  });

  it("il Giudizio: lo sconto contro una tappata, e l'effetto colpisce il bersaglio dichiarato", () => {
    const state = newGame();
    const g = on(state, "g", "JUDGMENT");
    on(state, "p", "SMALL", "b");
    const tapped = on(state, "q", "BIG", "b");
    tapped.tapped = true;
    expect(wantsTargetOnPlay(facts("JUDGMENT"))).toBe(true);
    expect(discountedCost(state, g, null, facts)).toBe(5);
    expect(discountedCost(state, g, state.cards.p, facts)).toBe(5);
    expect(discountedCost(state, g, tapped, facts)).toBe(2);
    expect(resolveSteps(state, g, facts)[0].candidates.map(x => x.uid)).toEqual(["p", "q"]);
    g.target = "q";
    expect(resolveSteps(state, g, facts)[0].candidates.map(x => x.uid)).toEqual(["q"]);
  });

  it("la Frattura sconta con due armate sul Fronte, e manda in Ritiro chiunque", () => {
    const state = newGame();
    const m = on(state, "m", "FRACTURE");
    on(state, "g", "BIG", "b");
    on(state, "u1", "AUROS");
    const o1 = on(state, "o1", "IRON");
    o1.assignedTo = "u1";
    expect(discountedCost(state, m, null, facts)).toBe(3);
    on(state, "u2", "AUROS");
    const o2 = on(state, "o2", "IRON");
    o2.assignedTo = "u2";
    expect(discountedCost(state, m, null, facts)).toBe(2);
    expect(wantsTargetOnPlay(facts("FRACTURE"))).toBe(false);
    const [step] = resolveSteps(state, m, facts);
    expect(step.candidates.map(x => x.uid)).toEqual(["g"]);
    expect(describeResolveStep(step, facts)).toContain("Zona di Ritiro");
  });

  it("la Rifrazione indebolisce l'attaccante di uno per armata, e senza armate non fa nulla", () => {
    const state = newGame();
    const r = on(state, "r", "REFRACTION", "b");
    on(state, "u", "AUROS");
    on(state, "v", "AUROS");
    state.declarations = [{ id: "u", from: "u", to: "rf", kind: "attack", seat: "a", order: 1 }];
    expect(resolveSteps(state, r, facts)[0].blocked).toBe("log.no.armed.weaken");
    on(state, "b1", "AUROS", "b");
    const o = on(state, "o", "IRON", "b");
    o.assignedTo = "b1";
    on(state, "b2", "AUROS", "b");
    const o2 = on(state, "o2", "IRON", "b");
    o2.assignedTo = "b2";
    const [step] = resolveSteps(state, r, facts);
    expect(step.blocked).toBeNull();
    expect(step.candidates.map(x => x.uid)).toEqual(["u"]);
    expect(weakenAmount(state, "b", step.form as never, facts)).toBe(-2);
    state.fired = ["r|on_resolve:empower:u|r"];
    expect(pendingResolve(state, r, facts)).toEqual([]);
    state.fired = [];
    state.declarations = [];
    expect(resolveSteps(state, r, facts)[0].blocked).toBe("log.no.attacker");
  });

  it("l'Amplificazione propone le armate proprie, fino a due", () => {
    const state = newGame();
    const m = on(state, "m", "AMPLIFY");
    on(state, "u1", "AUROS");
    on(state, "u2", "AUROS");
    on(state, "u3", "AUROS");
    on(state, "x", "AUROS");
    for (const [uid, bearer] of [["o1", "u1"], ["o2", "u2"], ["o3", "u3"]]) on(state, uid, "IRON").assignedTo = bearer;
    expect(resolveSteps(state, m, facts)[0].candidates.map(x => x.uid)).toEqual(["u1", "u2", "u3"]);
    state.fired = ["m|on_resolve:empower:u1|m"];
    expect(resolveSteps(state, m, facts)[0].candidates.map(x => x.uid)).toEqual(["u2", "u3"]);
    state.fired = ["m|on_resolve:empower:u1|m", "m|on_resolve:empower:u2|m"];
    expect(resolveSteps(state, m, facts)[0].candidates).toEqual([]);
    expect(pendingResolve(state, m, facts)).toEqual([]);
  });

  it("l'Assalto conta gli Oggetti addosso alle proprie Entità; l'Eversione distrugge e poi fa perdere PV", () => {
    const state = newGame();
    const m = on(state, "m", "ASSAULT");
    on(state, "u1", "AUROS");
    on(state, "b1", "AUROS", "b");
    on(state, "free", "IRON");
    expect(resolveSteps(state, m, facts)[0].blocked).toBe("log.no.objects");
    on(state, "o1", "IRON").assignedTo = "u1";
    on(state, "o2", "IRON").assignedTo = "u1";
    on(state, "bo", "IRON", "b").assignedTo = "b1";
    expect(wornObjects(state, "a")).toBe(2);
    expect(wornObjects(state, "b")).toBe(1);
    expect(resolveSteps(state, m, facts)[0].blocked).toBeNull();
    state.fired = ["m|on_resolve:heal|m"];
    expect(pendingResolve(state, m, facts)).toEqual([]);
    const e = on(state, "e", "SUBVERSION");
    const [step] = resolveSteps(state, e, facts);
    expect(step.candidates.map(x => x.uid)).toEqual(["b1"]);
    expect(describeResolveStep(step, facts)).toContain("2 PV");
    state.fired = ["e|on_resolve:destroy|e"];
    expect(pendingResolve(state, e, facts).length).toBe(1);
    state.fired = ["e|on_resolve:destroy|e", "e|on_resolve:heal|e"];
    expect(pendingResolve(state, e, facts)).toEqual([]);
  });

  it("il Prisma innesca quando viene assegnato in campo, una volta per portatore", () => {
    const before = newGame();
    on(before, "u", "AUROS");
    const inHand = on(before, "p", "PRISM");
    inHand.zone = "hand";
    on(before, "b1", "AUROS", "b");
    on(before, "b2", "AUROS", "b");
    const after = structuredClone(before);
    after.cards.p = { ...after.cards.p, zone: "field", assignedTo: "u" };
    const steps = assignSteps(before, after, facts);
    expect(steps.map(s => [s.source.uid, s.bearer.uid, s.form.kind])).toEqual([["p", "u", "exile"]]);
    expect(assignRef(steps[0])).toEqual({ source: "p", event: "on_assign_object", entering: "u" });
    expect(assignCandidates(after, steps[0], facts).map(x => x.uid)).toEqual(["b1", "b2"]);
    // Già innescato per quel portatore: niente.
    after.fired = ["p|on_assign_object:exile|u"];
    expect(assignSteps(before, after, facts)).toEqual([]);
    // Stessa assegnazione di prima: niente.
    expect(assignSteps(after, after, facts)).toEqual([]);
    // Un Oggetto senza la forma: niente.
    const plain = structuredClone(after);
    plain.fired = [];
    plain.cards.p = { ...plain.cards.p, cardId: "IRON" };
    expect(assignSteps(before, plain, facts)).toEqual([]);
  });

  it("il Portatore pesca quando riceve un Oggetto, e glielo sconta", () => {
    const before = newGame();
    on(before, "p", "BEARER");
    const s = on(before, "s", "BLADE");
    s.zone = "hand";
    expect(objectCost(before, s, facts)).toBe(2);
    const after = structuredClone(before);
    after.cards.s = { ...after.cards.s, assignedTo: "p" };
    expect(objectCost(after, after.cards.s, facts)).toBe(1);
    after.cards.s = { ...after.cards.s, zone: "field" };
    const steps = assignSteps(before, after, facts);
    expect(steps.map(x => [x.source.uid, x.object.uid, x.form.kind])).toEqual([["p", "s", "draw"]]);
    expect(assignRef(steps[0])).toEqual({ source: "p", event: "on_assign_object", entering: "s" });
    expect(describeAssignStep(steps[0], facts)).toContain("pesca 1");
    after.fired = ["p|on_assign_object:draw|s"];
    expect(assignSteps(before, after, facts)).toEqual([]);
    // Lo sconto conta fino a 0: la carta è gratis (§3.2, dal 2026-09-15).
    const cheap = on(after, "c", "SWORD");
    cheap.zone = "hand";
    cheap.assignedTo = "p";
    expect(objectCost(after, cheap, facts)).toBe(0);
  });

  it("in mano l'Oggetto mostra il costo del miglior portatore in campo (2026-09-15)", () => {
    const state = newGame();
    const s = on(state, "s", "BLADE");
    s.zone = "hand";
    // Senza portatori che scontano: il costo stampato.
    on(state, "e", "ENTITY");
    expect(bestObjectCost(state, s, facts)).toBe(2);
    // Col Portatore sul Fronte: uno in meno — prima ancora di posarlo.
    on(state, "p", "BEARER");
    expect(bestObjectCost(state, s, facts)).toBe(1);
    // Il Portatore avversario non conta.
    const foe = newGame();
    const t2 = on(foe, "s", "BLADE");
    t2.zone = "hand";
    on(foe, "p", "BEARER", "b");
    expect(bestObjectCost(foe, t2, facts)).toBe(2);
    // Fino a 0: la carta è gratis (§3.2).
    const cheap = on(state, "c", "SWORD");
    cheap.zone = "hand";
    expect(bestObjectCost(state, cheap, facts)).toBe(0);
  });

  it("la ricerca col dado propone le guardate del tipo della fascia", () => {
    const state = newGame();
    const m = on(state, "m", "LATENT");
    const deck: [string, string][] = [["d1", "AUROS"], ["d2", "IRON"], ["d3", "NORMAL"], ["d4", "HUMAN"], ["d5", "IRON"], ["d6", "HUMAN"]];
    deck.forEach(([uid, id], i) => { on(state, uid, id); state.cards[uid] = { ...state.cards[uid], zone: "deck", order: i }; });
    const [step] = resolveSteps(state, m, facts);
    expect(step.looked.map(c => c.uid)).toEqual(["d1", "d2", "d3", "d4", "d5"]);
    expect(step.blocked).toBeNull();
    expect(searchCandidates(step.form as never, step.looked, 16, facts)).toEqual({ type: "entity", candidates: [state.cards.d1, state.cards.d4] });
    expect(searchCandidates(step.form as never, step.looked, 9, facts).candidates.map(c => c.uid)).toEqual(["d2", "d5"]);
    expect(searchCandidates(step.form as never, step.looked, 2, facts).candidates.map(c => c.uid)).toEqual(["d3"]);
    expect(describeResolveStep(step, facts)).toContain("d20");
    state.fired = ["m|on_resolve:look|m"];
    expect(pendingResolve(state, m, facts)).toEqual([]);
  });

  it("il Rubyfront schierato innesca agli estremi del mazzo la prima volta che assegni, sulla faccia in vista", () => {
    const before = newGame();
    before.active = "a";
    const rf = deploy(before, "rf", "FORGE");
    on(before, "u", "AUROS");
    const s = on(before, "s", "IRON");
    s.zone = "hand";
    const after = structuredClone(before);
    after.cards.s = { ...after.cards.s, zone: "field", assignedTo: "u" };
    let steps = assignSteps(before, after, facts);
    expect(steps.map(x => [x.source.uid, x.object.uid, x.form.kind, "face" in x.form ? x.form.face : null])).toEqual([["rf", "s", "ends", 0]]);
    expect(assignRef(steps[0])).toEqual({ source: "rf", event: "on_assign_object", entering: "s", once: true });
    expect(describeAssignStep(steps[0], facts)).toContain("scambiarle");
    after.cards.rf = { ...after.cards.rf, face: 1 };
    steps = assignSteps(before, after, facts);
    expect("face" in steps[0].form ? steps[0].form.face : null).toBe(1);
    expect(describeAssignStep(steps[0], facts)).toContain("una in mano");
    after.fired = ["rf|on_assign_object:ends|turn"];
    expect(assignSteps(before, after, facts)).toEqual([]);
    // Nel turno altrui, o col Rubyfront in Zona di Richiamo, niente.
    after.fired = [];
    after.active = "b";
    expect(assignSteps(before, after, facts)).toEqual([]);
    after.active = "a";
    after.cards.rf = { ...after.cards.rf, y: rf.y + 500 };
    expect(assignSteps(before, after, facts)).toEqual([]);
    expect(deckEnds(after, "a")).toBeNull();
  });

  it("l'Oggetto che resta: quando la sua Entità muore con lui, e poi il riarmo di una disarmata", () => {
    const before = newGame();
    on(before, "u", "AUROS");
    on(before, "v", "VESTIGE").assignedTo = "u";
    on(before, "n", "AUROS");
    on(before, "z", "AUROS");
    on(before, "zo", "IRON").assignedTo = "z";
    on(before, "w", "IRON").zone = "ritiro";
    const after = structuredClone(before);
    after.cards.u = { ...after.cards.u, zone: "abisso" };
    after.cards.v = { ...after.cards.v, zone: "ritiro", assignedTo: undefined };
    const steps = deathSteps(before, after, facts);
    expect(steps.map(x => [x.object.uid, x.bearer.uid, x.form.kind])).toEqual([["v", "u", "remain"]]);
    expect(deathRef(steps[0])).toEqual({ source: "v", event: "on_death", entering: "u" });
    expect(deathRef(steps[0], "rearm").follow).toBe("rearm");
    expect(describeDeathStep(steps[0], facts)).toContain("Zona di Ritiro");
    after.fired = ["v|on_death|u"];
    expect(deathSteps(before, after, facts)).toEqual([]);
    after.cards.v = { ...after.cards.v, zone: "ritiro" };
    const { objects, bearers } = rearmAfterDeath(after, steps[0], facts);
    expect(objects.map(c => c.uid)).toEqual(["w"]);
    expect(bearers.map(c => c.uid)).toEqual(["n"]);
    // Un Oggetto senza la forma, o un'Entità che va in Ritiro (non muore): niente.
    const plain = structuredClone(after);
    plain.fired = [];
    plain.cards.v = { ...plain.cards.v, zone: "ritiro", cardId: "IRON" };
    expect(deathSteps(before, plain, facts)).toEqual([]);
    const retired = structuredClone(after);
    retired.fired = [];
    retired.cards.v = { ...retired.cards.v, zone: "ritiro" };
    retired.cards.u = { ...retired.cards.u, zone: "ritiro" };
    expect(deathSteps(before, retired, facts)).toEqual([]);
  });

  it("chi era tenuto nell'Abisso torna quando chi lo teneva lascia il gioco", async () => {
    const state = newGame();
    on(state, "c", "FIELD");
    const held = on(state, "p", "SMALL", "b");
    held.zone = "abisso";
    held.heldBy = "c";
    expect(heldBy(state, "c").map(x => x.uid)).toEqual(["p"]);
    const sent: Action[] = [];
    const ctx: Ctx = {
      state: () => state, dispatch: action => { sent.push(action); return Promise.resolve(true); }, seat: () => "a", controls: () => true, arbitrated: () => true,
      themeFor: () => "night",
      tintFor: () => "dynamic", locale: () => "it", card: facts, log: () => undefined,
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
    const rf = on(state, "rf", "BEAST");
    on(state, "u1", "HUMAN");
    on(state, "u2", "HUMAN");
    on(state, "u3", "HUMAN");
    expect(nexusCheck(state, rf, facts)).toEqual({ ok: false, why: "log.nexus.few", n: 4 });
    on(state, "u4", "HUMAN");
    expect(nexusCheck(state, rf, facts)).toEqual({ ok: false, why: "log.nexus.nodiscard" });
    const h = on(state, "h", "AUROS");
    h.zone = "hand";
    const m = on(state, "m", "STONE");
    m.zone = "hand";
    const check = nexusCheck(state, rf, facts);
    expect(check.ok && check.discards.map(c => c.uid)).toEqual(["h"]);
  });

  it("flipSteps: Rhen sul proprio Fronte nell'Abisso, e il sigillo", () => {
    const state = newGame();
    const rf = on(state, "rf", "BEAST");
    rf.face = 1;
    on(state, "r", "HEIR");
    on(state, "r2", "HEIR", "b");
    const steps = flipSteps(state, rf, facts);
    expect(steps.map(s => [s.form.kind, s.candidates.map(c => c.uid)])).toEqual([["move", ["r"]], ["seal", []], ["draw", []]]);
    expect(describeFlipStep(steps[0], facts)).toContain("HEIR");
    expect(describeFlipStep(steps[1], facts)).toContain("resto della partita");
    expect(describeFlipStep(steps[2], facts)).toContain("pesca 1");
  });

  it("flipCandidates: la carta nominata si ritrova per contenuto della forma, anche da una forma ricostruita", () => {
    const state = newGame();
    const rf = on(state, "rf", "BEAST");
    rf.face = 1;
    on(state, "r", "HEIR");
    on(state, "r2", "HEIR", "b");
    // Una copia della forma, non lo stesso oggetto: come le forme che ctx.card rifà a ogni chiamata.
    const form = JSON.parse(JSON.stringify(facts("BEAST").flipForms[0]));
    expect(flipCandidates(state, rf, form).map(c => c.uid)).toEqual(["r"]);
    expect(flipCandidates(state, rf, { kind: "seal", cardId: "HEIR" })).toEqual([]);
    expect(flipCandidates(state, rf, { kind: "draw", count: 1 })).toEqual([]);
  });
});

// La Reattiva che ferma un attaccante e cura (forma `block`). Gemello: engine_test.rb, «lo scudo riflesso».
describe("la Reattiva bloccante, giocata come blocco", () => {
  it("si gioca nella finestra dei blocchi, ferma un attaccante, e cura solo con due armati", () => {
    const state = newGame();
    const r = on(state, "r", "REFLEX", "b");
    on(state, "v1", "HUMAN", "b");
    on(state, "v2", "HUMAN", "b");
    on(state, "o1", "BUCKLER", "b").assignedTo = "v1";
    expect(playsAsBlock(facts("REFLEX"))).toBe(true);
    expect(blocksAttacker(facts("REFLEX"))).toBe(true);
    expect(armedCount(state, "b", facts)).toBe(1);
    const [step] = resolveSteps(state, r, facts);
    expect(step.blocked).toBe("log.no.armed");
    expect(describeResolveStep(step, facts)).toContain("3");
    on(state, "o2", "BUCKLER", "b").assignedTo = "v2";
    expect(armedCount(state, "b", facts)).toBe(2);
    expect(resolveSteps(state, r, facts)[0].blocked).toBeNull();
  });
});

// Gemello: engine_test.rb, sezione «lo scarto d'Oggetto (ingresso e attacco)».
describe("lo scarto d'Oggetto all'ingresso e all'attacco (§8.2, dal 2026-09-15)", () => {
  function fake(state: GameState): { ctx: Ctx; sent: Action[] } {
    const sent: Action[] = [];
    const ctx: Ctx = {
      state: () => state,
      dispatch(action) {
        sent.push(action);
        return Promise.resolve(true);
      },
      roll: (die) => Promise.resolve(die),
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "night",
      tintFor: () => "dynamic",
      locale: () => "it",
      card: facts,
      log() {},
    };
    return { ctx, sent };
  }

  function inHand(state: GameState, uid: string, cardId: string, owner: Seat = "a"): CardInstance {
    const card = on(state, uid, cardId, owner);
    card.zone = "hand";
    return card;
  }

  it("enterStashes propone gli Oggetti della PROPRIA mano, con la pesca a seguire", () => {
    const state = newGame();
    const recruit = on(state, "rec", "RECRUIT");
    inHand(state, "sw", "SWORD");
    inHand(state, "mio", "HUMAN");
    inHand(state, "fe", "BLADE", "b");
    on(state, "worn", "BLADE").assignedTo = "rec";
    const steps = enterStashes(state, recruit, facts);
    expect(steps).toHaveLength(1);
    expect(steps[0].candidates.map(card => card.uid)).toEqual(["sw"]);
    expect(steps[0]).toMatchObject({ to: "ritiro", thenDraw: 1 });
    expect(enterStashes(state, state.cards.mio, facts)).toEqual([]);
    expect(describeStash(steps[0], facts)).toContain("«RECRUIT»");
  });

  it("resolveStash manda il toZone in Ritiro marcato «stash», e la pesca porta il seguito «draw»", async () => {
    const state = newGame();
    const recruit = on(state, "rec", "RECRUIT");
    const sword = inHand(state, "sw", "SWORD");
    const { ctx, sent } = fake(state);
    const [step] = enterStashes(state, recruit, facts);
    expect(await resolveStash(ctx, step, sword)).toBe(true);
    expect(sent).toEqual([{ t: "toZone", uid: "sw", zone: "ritiro", effect: { source: "rec", event: "on_enter_field", entering: "rec", follow: "stash" } }]);
    expect(stashRef(step, "draw")).toEqual({ source: "rec", event: "on_enter_field", entering: "rec", follow: "draw" });
  });

  it("il Catalizzatore addosso a chi attacca: il +1 al portatore, poi il passo «stash» col d6", () => {
    const state = newGame();
    const u = on(state, "u", "HUMAN");
    on(state, "cat", "CATALYST").assignedTo = "u";
    state.declarations.push({ id: "u", from: "u", to: "rf-b", kind: "attack", seat: "a", order: 1 });
    const steps = attackSteps(state, u, facts);
    expect(steps.map(s => [s.source.uid, s.form.kind])).toEqual([["cat", "empower"], ["cat", "stash"]]);
    expect(describeAttackStep(steps[1], facts)).toContain("d6");
    expect(describeAttackStep(steps[1], facts)).toContain("4–6");
    // Il passo risolto per questo attacco non si ripropone.
    state.fired = ["cat|on_attack:stash|u"];
    expect(attackSteps(state, u, facts).map(s => s.form.kind)).toEqual(["empower"]);
  });
});

// §8.2 — la ricerca a inizio turno (dal 2026-09-17). Gemello: engine_test.rb,
// SEARCH_SET e i test «turn_start_search».
describe("turnStartSearches", () => {
  it("un passo per ogni fonte in campo, coi soli Oggetti del mazzo; niente passi con un Oggetto già in campo", () => {
    const state = newGame();
    on(state, "sco", "SCOUT");
    const d1 = on(state, "d1", "IRON"); d1.zone = "deck";
    const d2 = on(state, "d2", "HUMAN"); d2.zone = "deck";
    const steps = turnStartSearches(state, "a", facts);
    expect(steps).toHaveLength(1);
    expect(steps[0].candidates.map(card => card.uid)).toEqual(["d1"]);
    expect(turnStartSearches(state, "b", facts)).toEqual([]);
    on(state, "fe", "IRON").assignedTo = "sco";
    expect(turnStartSearches(state, "a", facts)).toEqual([]);
  });

  it("la carta cercata va in mano col riferimento del turno, poi il mazzo si rimescola", async () => {
    const state = newGame();
    state.turn = 3;
    on(state, "sco", "SCOUT");
    for (const uid of ["d1", "d2", "d3"]) on(state, uid, uid === "d2" ? "HUMAN" : "IRON").zone = "deck";
    // Un Ctx che applica davvero: la mescolata legge il mazzo DOPO la carta uscita.
    let live = state;
    const sent: Action[] = [];
    const ctx: Ctx = {
      state: () => live,
      dispatch(action) {
        sent.push(action);
        live = apply(live, action);
        return Promise.resolve(true);
      },
      roll: (die) => Promise.resolve(die),
      seat: () => "a",
      controls: seat => seat === "a",
      arbitrated: () => true,
      themeFor: () => "night",
      tintFor: () => "dynamic",
      locale: () => "it",
      card: facts,
      log: () => undefined,
    };
    const [step] = turnStartSearches(state, "a", facts);
    expect(describeTurnStartSearch(step, facts)).toMatch(/cerca nel mazzo/);
    expect(await resolveTurnStartSearch(ctx, step, step.candidates[0]!)).toBe(true);
    expect(sent[0]).toEqual({ t: "toZone", uid: "d1", zone: "hand", effect: { source: "sco", event: "on_turn_start", entering: "turn:3" } });
    // L'ordine lo riempie il tavolo (dal 2026-10-21): l'azione viaggia senza, col posto che mescola.
    expect(sent[1]).toEqual({ t: "shuffle", seat: "a" });
    expect(zoneCards(live, "a", "deck").map(card => card.uid).sort()).toEqual(["d2", "d3"]);
  });
});

// Le forme dello starter Umani (dal 2026-10-20). Gemello: engine_test.rb, sezione «Le forme dello starter Umani».
describe("le forme dello starter Umani", () => {
  it("entra tappata: l'innesco proprio dell'ingresso, un tap marcato come effetto", async () => {
    const state = newGame();
    const w = on(state, "w", "WEARY");
    const [step] = enterTaps(w, facts);
    expect(step.source.uid).toBe("w");
    expect(describeTap(step, facts)).toContain("entra tappata");
    expect(enterTaps(on(state, "u", "HUMAN"), facts)).toEqual([]);
    const sent: Action[] = [];
    const ctx = { state: () => state, dispatch: async (action: Action) => { sent.push(action); return true; }, log: () => undefined, card: facts } as unknown as Ctx;
    expect(await resolveTap(ctx, step)).toBe(true);
    expect(sent).toEqual([{ t: "tap", uid: "w", tapped: true, effect: { source: "w", event: "on_enter_field", entering: "w" } }]);
  });

  it("il buff all'ingresso: un'ALTRA propria Entità, mai sé stessa né un'avversaria", async () => {
    const state = newGame();
    const o = on(state, "o", "ORDER");
    on(state, "u", "HUMAN");
    on(state, "x", "AUROS");
    on(state, "v", "HUMAN", "b");
    const [step] = enterEmpowers(state, o, facts);
    expect(step.candidates.map(c => c.uid)).toEqual(["u", "x"]);
    expect(describeEnterEmpower(step, facts)).toContain("+1");
    const sent: Action[] = [];
    const ctx = { state: () => state, dispatch: async (action: Action) => { sent.push(action); return true; }, log: () => undefined, card: facts } as unknown as Ctx;
    await resolveEnterEmpower(ctx, step, state.cards.x);
    expect(sent).toEqual([{ t: "empower", uid: "x", power: 1, effect: { source: "o", event: "on_enter_field", entering: "o" } }]);
  });

  it("la carica: tutti gli attaccanti del turno, sé compresa; l'attacco a pagamento: solo il primo Umano dell'ondata", () => {
    const state = newGame();
    const l = on(state, "l", "LEADER");
    const u = on(state, "u", "HUMAN");
    on(state, "x", "AUROS");
    deploy(state, "rf", "FLAME");
    state.declarations = [
      { id: "x", from: "x", to: "rf-b", kind: "attack", seat: "a", order: 1 },
      { id: "u", from: "u", to: "rf-b", kind: "attack", seat: "a", order: 2 },
      { id: "l", from: "l", to: "rf-b", kind: "attack", seat: "a", order: 3 },
    ];
    expect(firstAttackerOf(state, "a", "human", facts)?.uid).toBe("u");
    expect(firstAttackerOf(state, "a", null, facts)?.uid).toBe("x");
    // Chi attacca con la carica: il suo passo; il Rubyfront propone il pagamento solo al primo Umano.
    expect(attackSteps(state, l, facts).map(s => [s.source.uid, s.form.kind, (s.form as { targets?: string }).targets])).toEqual([["l", "empower", "all_attackers"]]);
    expect(attackSteps(state, u, facts).map(s => [s.source.uid, (s.form as { targets?: string }).targets])).toEqual([["rf", "attacker"]]);
    expect(attackSteps(state, state.cards.x, facts)).toEqual([], "un Auros non innesca il pagamento");
    expect(describeAttackStep(attackSteps(state, l, facts)[0], facts)).toContain("attaccanti");
    expect(describeAttackStep(attackSteps(state, u, facts)[0], facts)).toContain("pagare 1 PV");
    expect(attackRef(attackSteps(state, u, facts)[0])).toEqual({ source: "rf", event: "on_attack", entering: "u", once: true });
    // Già pagato nel turno (la chiave «turn»): non si ripropone.
    state.fired = ["rf|on_attack:empower:u|turn"];
    expect(attackSteps(state, u, facts)).toEqual([]);
  });

  it("il Contrattacco in Reazione: stappa UN'Entità qualunque; il Muro toglie 2 a un'avversaria qualunque e la affonda a zero", () => {
    const state = newGame();
    const will = on(state, "w", "WILL", "b");
    on(state, "v1", "HUMAN", "b").tapped = true;
    on(state, "v2", "AUROS", "b");
    on(state, "s", "WEAKLING");
    on(state, "g", "BIG");
    const [step] = resolveSteps(state, will, facts);
    expect(step.candidates.map(c => c.uid)).toEqual(["v1", "v2"]);
    expect(describeResolveStep(step, facts)).toContain("Contrattacco +1");
    const wall = on(state, "m", "WALL", "b");
    const [hit] = resolveSteps(state, wall, facts);
    expect(hit.blocked).toBeNull();
    expect(hit.candidates.map(c => c.uid)).toEqual(["s", "g"], "non serve che attacchino, né armate proprie");
    expect(describeResolveStep(hit, facts)).toContain("−2");
    expect(weakenAmount(state, "b", hit.form as never, facts)).toBe(-2);
    expect(sinks(state, state.cards.s, hit.form as never, facts)).toBe(false);
    state.cards.s.powerBonus = -2;
    expect(sinks(state, state.cards.s, hit.form as never, facts)).toBe(true);
    state.cards.g.powerBonus = -2;
    expect(sinks(state, state.cards.g, hit.form as never, facts)).toBe(false);
  });

  it("il Colpo Decisivo: un'avversaria nell'Abisso, e il costo a dado nella scheda", () => {
    const state = newGame();
    const m = on(state, "m", "BLOW");
    on(state, "v", "HUMAN", "b");
    on(state, "u", "HUMAN");
    expect(facts("BLOW").fluxDie).toBe("d6");
    const [step] = resolveSteps(state, m, facts);
    expect(step.candidates.map(c => c.uid)).toEqual(["v"]);
    expect(describeResolveStep(step, facts)).toContain("Abisso");
    expect(pendingResolve(state, m, facts)).toHaveLength(1);
    state.fired = ["m|on_resolve:destroy|m"];
    expect(pendingResolve(state, m, facts)).toEqual([]);
  });

  it("la Statica che ascolta: lo sguardo in cima a ogni Umano, la pesca col secondo entrato nel turno", async () => {
    let state = newGame();
    on(state, "st", "MUSTER");
    const d1 = on(state, "d1", "AUROS");
    d1.zone = "deck";
    d1.order = 0;
    const d2 = on(state, "d2", "HUMAN");
    d2.zone = "deck";
    d2.order = 1;
    const h1 = on(state, "h1", "HUMAN");
    h1.zone = "hand";
    const h2 = on(state, "h2", "HUMAN");
    h2.zone = "hand";
    const x = on(state, "x", "AUROS");
    x.zone = "hand";
    state = apply(state, { t: "toZone", uid: "x", zone: "field", x: 442, y: frontRowY("a"), z: 1 });
    expect(enterPeeks(state, state.cards.x, facts)).toEqual([], "un Auros non innesca");
    state = apply(state, { t: "toZone", uid: "h1", zone: "field", x: 821, y: frontRowY("a"), z: 1 });
    expect(state.cards.h1.enteredTurn).toBe(state.turn);
    expect(enteredThisTurn(state, "a", "human", facts)).toBe(1);
    const [peek] = enterPeeks(state, state.cards.h1, facts);
    expect(peek.source.uid).toBe("st");
    expect(peek.top?.uid).toBe("d1");
    expect(describePeek(peek, facts)).toContain("prima carta");
    expect(enterTriggers(state, state.cards.h1, facts)).toEqual([], "un Umano solo: niente pesca");
    const sent: Action[] = [];
    const ctx = { state: () => state, dispatch: async (action: Action) => { sent.push(action); state = apply(state, action); return true; }, log: () => undefined, card: facts } as unknown as Ctx;
    await resolvePeek(ctx, peek, false);
    expect(sent[0]).toEqual({ t: "look", seat: "a", count: 1, restTo: "deck", effect: { source: "st", event: "on_enter_field", entering: "h1", follow: "peek" } });
    expect(zoneCards(state, "a", "deck").map(c => c.uid)).toEqual(["d2", "d1"], "in fondo");
    state = apply(state, { t: "toZone", uid: "h2", zone: "field", x: 1199, y: frontRowY("a"), z: 1 });
    expect(enteredThisTurn(state, "a", "human", facts)).toBe(2);
    expect(enterTriggers(state, state.cards.h2, facts).map(tr => [tr.source.uid, tr.draw])).toEqual([["st", 1]]);
    const [keep] = enterPeeks(state, state.cards.h2, facts);
    await resolvePeek(ctx, keep, true);
    expect(sent[1]).toMatchObject({ t: "look", top: "d2" });
    expect(zoneCards(state, "a", "deck").map(c => c.uid)).toEqual(["d2", "d1"], "lasciata in cima");
    // Il turno nuovo azzera il conto.
    state = apply(state, { t: "turn", turn: 2, active: "b" });
    expect(enteredThisTurn(state, "a", "human", facts)).toBe(0);
  });

  it("il Nexus dello starter: tre Umani all'attacco in questo turno, e lo scarto di un'Umana", () => {
    const state = newGame();
    const rf = deploy(state, "rf", "FLAME");
    on(state, "u1", "HUMAN");
    on(state, "u2", "HUMAN");
    on(state, "x", "AUROS");
    state.declarations = [
      { id: "u1", from: "u1", to: "rf-b", kind: "attack", seat: "a", order: 1 },
      { id: "u2", from: "u2", to: "rf-b", kind: "attack", seat: "a", order: 2 },
      { id: "x", from: "x", to: "rf-b", kind: "attack", seat: "a", order: 3 },
    ];
    expect(nexusCheck(state, rf, facts)).toEqual({ ok: false, why: "log.nexus.few.attacking", n: 3 });
    on(state, "u3", "HUMAN");
    state.declarations.push({ id: "u3", from: "u3", to: "rf-b", kind: "attack", seat: "a", order: 4 });
    expect(nexusCheck(state, rf, facts)).toEqual({ ok: false, why: "log.nexus.nodiscard" });
    const ha = on(state, "ha", "AUROS");
    ha.zone = "hand";
    expect(nexusCheck(state, rf, facts)).toEqual({ ok: false, why: "log.nexus.nodiscard" });
    const h = on(state, "h", "HUMAN");
    h.zone = "hand";
    const check = nexusCheck(state, rf, facts);
    expect(check.ok && check.discards.map(c => c.uid)).toEqual(["h"]);
  });
});

// Le forme dello starter Auros (dal 2026-10-22). Gemello: engine_test.rb, sezione «Le forme dello starter Auros».
describe("le forme dello starter Auros", () => {
  const fakeCtx = (state: GameState, sent: Action[]): Ctx =>
    ({ state: () => state, dispatch: async (action: Action) => { sent.push(action); return true; }, log: () => undefined, card: facts } as unknown as Ctx);

  it("la Stasi all'ingresso: le avversarie che possono entrarci, entro il costo; mai le proprie, le già ferme, chi non si tappa mai", async () => {
    const state = newGame();
    const f = on(state, "f", "FREEZER");
    on(state, "u", "HUMAN");
    on(state, "v", "WEAKLING", "b");
    on(state, "s", "STEADY", "b");
    const z = on(state, "z", "AUROS", "b");
    z.stasis = true;
    z.tapped = true;
    on(state, "h", "HEAVY", "b");
    const [step] = enterFreezes(state, f, facts);
    expect(step.candidates.map(c => c.uid)).toEqual(["v", "h"]);
    expect(describeFreeze(step, facts)).toContain("in Stasi");
    expect(freezable(state.cards.s, facts)).toBe(false);
    const d = on(state, "d", "DOUBLEFREEZE");
    const [two] = enterFreezes(state, d, facts);
    expect(two.candidates.map(c => c.uid)).toEqual(["v"], "con costo 3 o inferiore: il 5 resta fuori");
    expect(describeFreeze(two, facts)).toContain("2 Entità");
    const sent: Action[] = [];
    expect(await resolveFreeze(fakeCtx(state, sent), step, state.cards.v)).toBe(true);
    expect(sent).toEqual([{ t: "tap", uid: "v", tapped: true, stasis: true, effect: { source: "f", event: "on_enter_field", entering: "f" } }]);
  });

  it("togliere dalla Stasi all'ingresso: solo le proprie in Stasi, con un empower che stappa", async () => {
    const state = newGame();
    const w = on(state, "w", "WAKER");
    const z = on(state, "z", "AUROS");
    z.stasis = true;
    z.tapped = true;
    const u = on(state, "u", "AUROS");
    u.tapped = true;
    const v = on(state, "v", "HUMAN", "b");
    v.stasis = true;
    const [step] = enterWakes(state, w, facts);
    expect(step.candidates.map(c => c.uid)).toEqual(["z"]);
    expect(describeWake(step, facts)).toContain("togliere dalla Stasi");
    const sent: Action[] = [];
    await resolveWake(fakeCtx(state, sent), step, z);
    expect(sent).toEqual([{ t: "empower", uid: "z", untap: true, effect: { source: "w", event: "on_enter_field", entering: "w" } }]);
  });

  it("l'Oggetto che sveglia il portatore: un passo d'assegnazione solo se chi lo riceve era in Stasi", () => {
    const before = newGame();
    const z = on(before, "z", "AUROS");
    z.stasis = true;
    z.tapped = true;
    on(before, "u", "AUROS");
    const after = structuredClone(before);
    on(after, "o", "ROUSER").assignedTo = "z";
    const steps = assignSteps(before, after, facts);
    expect(steps.map(step => [step.source.uid, step.bearer.uid, step.form.kind])).toEqual([["o", "z", "wake"]]);
    expect(assignRef(steps[0])).toEqual({ source: "o", event: "on_assign_object", entering: "z" });
    const bare = structuredClone(before);
    on(bare, "o2", "ROUSER").assignedTo = "u";
    expect(assignSteps(before, bare, facts)).toEqual([]);
  });

  it("la Materia che mette in Stasi e il buff secco della Reattiva", () => {
    const state = newGame();
    const m = on(state, "m", "CHILL");
    on(state, "u", "HUMAN");
    on(state, "v", "HUMAN", "b");
    const frozen = on(state, "z", "AUROS", "b");
    frozen.stasis = true;
    const [chill] = resolveSteps(state, m, facts);
    expect(chill.candidates.map(c => c.uid)).toEqual(["v"]);
    expect(describeResolveStep(chill, facts)).toContain("Stasi");
    state.fired = ["m|on_resolve:freeze:v|m"];
    expect(pendingResolve(state, m, facts)).toEqual([]);
    const b = on(state, "b", "BRACE");
    const [brace] = resolveSteps(state, b, facts);
    expect(brace.candidates.map(c => c.uid)).toEqual(["u"]);
    expect(describeResolveStep(brace, facts)).toContain("+2");
  });

  it("la ricerca di Oggetti: gli Oggetti del mazzo finché i passi non sono due, poi il dado del riarmo se c'è chi armare", () => {
    const state = newGame();
    const q = on(state, "q", "QUEST");
    on(state, "u", "HUMAN");
    for (const [uid, id] of [["o1", "PRISM"], ["o2", "PRISM"], ["x", "HUMAN"]] as const) {
      state.cards[uid] = { uid, cardId: id, owner: "a", zone: "deck", face: 0, x: 0, y: 0, order: 0, tapped: false, facedown: false, z: 0 };
    }
    const [step] = resolveSteps(state, q, facts);
    expect(step.candidates.map(c => c.uid)).toEqual(["o1", "o2"]);
    expect(describeResolveStep(step, facts)).toContain("2 Oggetti");
    state.fired = ["q|on_resolve:search:o1|q", "q|on_resolve:search:o2|q"];
    expect(resolveSteps(state, q, facts)[0].candidates).toEqual([]);
    expect(pendingResolve(state, q, facts)).toHaveLength(1);
    state.rolls = { "effect|q|on_resolve|q|rearm": { die: 6, value: 2 } };
    expect(pendingResolve(state, q, facts)).toEqual([]);
    const bare = newGame();
    const q2 = on(bare, "q2", "QUEST");
    expect(resolveSteps(bare, q2, facts)[0].blocked).toBe("log.search.none");
  });

  it("l'esilio a tempo: la mira fra le avversarie, e la fine quando scade", () => {
    const state = newGame();
    const m = on(state, "m", "UNDERTOW");
    on(state, "u", "HUMAN");
    on(state, "v", "HUMAN", "b");
    const [step] = resolveSteps(state, m, facts);
    expect(step.candidates.map(c => c.uid)).toEqual(["v"]);
    expect(describeResolveStep(step, facts)).toContain("3 turni");
    const later = newGame("b");
    const matter = { uid: "m", cardId: "UNDERTOW", owner: "a" as Seat, zone: "abisso" as const, face: 0, x: 0, y: 0, order: 0, tapped: false, facedown: false, z: 0 };
    later.cards.m = matter;
    later.cards.v = { uid: "v", cardId: "HUMAN", owner: "b", zone: "ritiro", face: 0, x: 0, y: 0, order: 0, tapped: false, facedown: false, z: 0, exile: { seat: "b", remaining: 1, source: "m" } };
    later.cards.w = { uid: "w", cardId: "HUMAN", owner: "b", zone: "ritiro", face: 0, x: 0, y: 0, order: 0, tapped: false, facedown: false, z: 0, exile: { seat: "b", remaining: 2, source: "m" } };
    const due = exileReturns(later, "b", facts);
    expect(due.map(entry => entry.card.uid)).toEqual(["v"]);
    expect(due[0].form.die).toBe(12);
    expect(exileReturnRef(due[0])).toEqual({ source: "m", event: "on_exile_end", entering: "v" });
    expect(exileReturns(later, "a", facts)).toEqual([]);
  });

  it("«ogni volta che un'Entità entra in Stasi»: il Rubyfront schierato della faccia in vista, una volta per ingresso", async () => {
    const before = newGame();
    const rf = deploy(before, "rf", "VIGIL");
    const v = on(before, "v", "HUMAN", "b");
    const after = structuredClone(before);
    after.cards.v = { ...v, stasis: true, tapped: true, stasisAt: 1 };
    after.stasisSeq = 1;
    const steps = stasisHeals(before, after, facts);
    expect(steps.map(step => [step.source.uid, step.target.uid, step.amount])).toEqual([["rf", "v", 1]]);
    after.fired = ["rf|on_enter_stasis|v@1"];
    expect(stasisHeals(before, after, facts)).toEqual([]);
    after.fired = [];
    after.cards.rf = { ...rf, face: 1 };
    expect(stasisHeals(before, after, facts)[0].amount).toBe(2);
    after.cards.rf = { ...rf, y: 0 };
    expect(stasisHeals(before, after, facts)).toEqual([], "in Zona di Richiamo non ascolta");
    const sent: Action[] = [];
    after.cards.rf = rf;
    after.players.a.hp = 10;
    await resolveStasisHeal(fakeCtx(after, sent), steps[0]);
    expect(sent).toEqual([{ t: "player", seat: "a", patch: { hp: 11 }, effect: { source: "rf", event: "on_enter_stasis", entering: "v" } }]);
  });

  it("il Nexus a Oggetto: conta le Stasi inflitte dal tavolo e vuole un proprio Oggetto in campo", () => {
    const state = newGame();
    const rf = deploy(state, "rf", "VIGIL");
    expect(nexusCheck(state, rf, facts)).toEqual({ ok: false, why: "log.nexus.few.inflicted", n: 2 });
    state.players.a.stasisInflicted = 2;
    expect(nexusCheck(state, rf, facts)).toEqual({ ok: false, why: "log.nexus.noobject" });
    on(state, "u", "HUMAN");
    const o = on(state, "o", "PRISM");
    o.assignedTo = "u";
    on(state, "ob", "PRISM", "b");
    const check = nexusCheck(state, rf, facts);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.retires.map(c => c.uid)).toEqual(["o"]);
  });
});

describe("le forme della scheda riletta il 2026-10-23", () => {
  const fakeCtx = (state: GameState, sent: Action[]): Ctx =>
    ({ state: () => state, dispatch: async (action: Action) => { sent.push(action); return true; }, log: () => undefined, card: facts } as unknown as Ctx);

  it("lo sguardo in cima sull'ingresso proprio: la fonte è chi entra, la prima carta del suo mazzo", async () => {
    const state = newGame();
    const g = on(state, "g", "GLANCER");
    const d1 = { ...on(state, "d1", "AUROS"), zone: "deck" as const, order: 0 };
    state.cards.d1 = d1;
    const steps = enterPeeks(state, g, facts);
    expect(steps).toHaveLength(1);
    expect(steps[0].source.uid).toBe("g");
    expect(steps[0].top?.uid).toBe("d1");
    const sent: Action[] = [];
    expect(await resolvePeek(fakeCtx(state, sent), steps[0], false)).toBe(true);
    expect(sent).toEqual([{ t: "look", seat: "a", count: 1, restTo: "deck", effect: { source: "g", event: "on_enter_field", entering: "g", follow: "peek" } }]);
  });

  it("«ogni volta che un'altra Entità entra sul tuo Fronte, guadagni 1 PV»: una patch dei PV, non una pesca", async () => {
    const state = newGame();
    on(state, "k", "TIDEKEEPER");
    const t = on(state, "t", "AUROS");
    const triggers = enterTriggers(state, t, facts);
    expect(triggers).toEqual([{ source: state.cards.k, draw: 0, heal: 1 }]);
    expect(describeTrigger(triggers[0], facts)).toContain("1 PV");
    const sent: Action[] = [];
    expect(await resolveTrigger(fakeCtx(state, sent), t, triggers[0])).toBe(true);
    expect(sent).toEqual([{ t: "player", seat: "a", patch: { hp: 21 }, effect: { source: "k", event: "on_enter_field", entering: "t" } }]);
    // Il proprio ingresso non si ascolta — salvo «compresa questa».
    expect(enterTriggers(state, state.cards.k, facts)).toEqual([]);
    const own = on(state, "s", "TIDEKEEPER_SELF");
    expect(enterTriggers(state, own, facts).map(trigger => trigger.source.uid)).toEqual(["k", "s"]);
  });

  it("il riordino della cima: le prime N, un look con order", async () => {
    const state = newGame();
    const s = on(state, "s", "SOUNDER");
    for (const [i, uid] of ["d1", "d2", "d3", "d4"].entries()) state.cards[uid] = { ...on(state, uid, "AUROS"), zone: "deck", order: i };
    const [step] = enterSorts(state, s, facts);
    expect(step.top.map(card => card.uid)).toEqual(["d1", "d2", "d3"]);
    expect(describeSort(step, facts)).toContain("3");
    const sent: Action[] = [];
    expect(await resolveSort(fakeCtx(state, sent), step, [state.cards.d3, state.cards.d1, state.cards.d2])).toBe(true);
    expect(sent).toEqual([{ t: "look", seat: "a", count: 3, restTo: "deck", order: ["d3", "d1", "d2"], effect: { source: "s", event: "on_enter_field", entering: "s", follow: "sort" } }]);
  });

  it("«poi guadagni 1 PV per ogni Entità avversaria tappata»: il conto di adesso, le appena fermate comprese", async () => {
    const state = newGame();
    const m = on(state, "m", "TALLYMAN");
    const v1 = on(state, "v1", "HUMAN", "b");
    v1.tapped = true;
    v1.stasis = true;
    on(state, "v2", "AUROS", "b");
    const h = on(state, "h", "HEAVY", "b");
    h.tapped = true;
    const [step] = enterTallies(state, m, facts);
    expect(step.tapped).toBe(2);
    expect(step.amount).toBe(2);
    expect(describeTally(step, facts)).toContain("per ogni");
    const sent: Action[] = [];
    expect(await resolveTally(fakeCtx(state, sent), step)).toBe(true);
    expect(sent).toEqual([{ t: "player", seat: "a", patch: { hp: 22 }, effect: { source: "m", event: "on_enter_field", entering: "m", follow: "tally" } }]);
    // Senza avversarie tappate non manda nulla.
    const quiet = newGame();
    const q = on(quiet, "q", "TALLYMAN");
    on(quiet, "u", "AUROS", "b");
    const none: Action[] = [];
    expect(await resolveTally(fakeCtx(quiet, none), enterTallies(quiet, q, facts)[0])).toBe(false);
    expect(none).toEqual([]);
  });

  it("la tappata ascoltata: l'Entità del posto per il muro, il portatore per il Vaso (col dado), una volta per tappata", async () => {
    const before = newGame();
    on(before, "w", "BULWARK");
    const t = on(before, "t", "AUROS");
    on(before, "o", "VESSEL").assignedTo = "t";
    on(before, "v", "HUMAN", "b");
    expect(tapHeals(before, before, facts)).toEqual([]);
    const after = apply(before, { t: "tap", uid: "t", tapped: true });
    const steps = tapHeals(before, after, facts);
    expect(steps.map(step => [step.source.uid, step.target.uid, step.listener.scope])).toEqual([["w", "t", "controlled"], ["o", "t", "bearer"]]);
    expect(describeTapHeal(steps[0], facts)).toContain("1 PV");
    expect(describeTapHeal(steps[1], facts)).toContain("d6");
    // L'avversaria tappata non è ascoltata da nessuno dei due.
    const foe = apply(after, { t: "tap", uid: "v", tapped: true });
    expect(tapHeals(after, foe, facts)).toEqual([]);
    // Una tappata su una già tappata non è una tappata.
    expect(tapHeals(after, apply(after, { t: "tap", uid: "t", tapped: true }), facts)).toEqual([]);
    // La patch, col tiro dove serve; l'innesco consumato non si ripropone.
    const sent: Action[] = [];
    expect(await resolveTapHeal(fakeCtx(after, sent), steps[1], 5)).toBe(true);
    expect(sent).toEqual([{ t: "player", seat: "a", patch: { hp: 21 }, roll: 5, effect: { source: "o", event: "on_tap", entering: "t" } }]);
    const fired = apply(after, sent[0]);
    expect(fired.fired).toContain(`o|on_tap|t@${after.cards.t.tapAt}`);
    expect(tapHeals(before, fired, facts).map(step => step.source.uid)).toEqual(["w"]);
  });

  it("la sentenza e la ricerca in Ritiro come passi di risoluzione", () => {
    const state = newGame();
    const s = on(state, "s", "SENTENCE");
    on(state, "t", "AUROS");
    on(state, "h", "HEAVY", "b");
    const [sentence] = resolveSteps(state, s, facts);
    expect(sentence.form.kind).toBe("sentence");
    expect(sentence.candidates.map(card => card.uid)).toEqual(["h"]);
    expect(describeResolveStep(sentence, facts)).toContain("d6");
    expect(pendingResolve(state, s, facts)).toHaveLength(1);
    const q = on(state, "q", "SALVAGE");
    state.cards.o1 = { ...on(state, "o1", "VESSEL"), zone: "deck", order: 0 };
    state.cards.r = { ...on(state, "r", "ROUSER"), zone: "deck", order: 1 };
    state.cards.h5 = { ...on(state, "h5", "HEAVY"), zone: "deck", order: 2 };
    const [search] = resolveSteps(state, q, facts);
    expect(search.form.kind).toBe("search_objects");
    expect(search.candidates.map(card => card.uid)).toEqual(["o1", "r"], "gli Oggetti entro il costo 3");
    expect(describeResolveStep(search, facts)).toContain("Ritiro");
  });

  it("«le Entità che controlli hanno Stasi»: la parola chiave concessa a tutte le proprie, non alle avversarie", () => {
    const state = newGame();
    on(state, "w", "BULWARK");
    const t = on(state, "t", "AUROS");
    const v = on(state, "v", "HUMAN", "b");
    expect(hasKeyword(t, "stasis", facts, state)).toBe(true);
    expect(hasKeyword(state.cards.w, "stasis", facts, state)).toBe(true);
    expect(hasKeyword(v, "stasis", facts, state)).toBe(false);
    expect(hasKeyword(t, "stasis", facts)).toBe(false);
  });
});
