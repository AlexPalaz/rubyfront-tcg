// L'interprete degli effetti (§8.2), la forma di RBF-003: chi si innesca
// all'ingresso e come si risolve. Gemello: engine_test.rb, sezione §8.2.

import { renderLog } from "../src/log.js";
import { describe, expect, it } from "vitest";
import type { CardFacts, Ctx } from "../src/ctx.js";
import { FRONT_SLOT_X, backRowY, frontRowY } from "../src/geometry.js";
import {
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
} from "../src/effects.js";
import { newGame } from "../src/state.js";
import type { Action, CardInstance, GameState, Seat } from "../src/types.js";

const FACTS: Record<string, Partial<CardFacts>> = {
  SHADOW: { kind: "entity", race: "auros", enterDisarms: [{ to: "ritiro" }], enterRearms: [{ any: true }] },
  SMITH: { kind: "entity", race: "auros", enterRearms: [{ self: true }] },
  BOUND: { kind: "entity", race: "auros", fluxCost: 1, leaveReturns: [{ maxCost: 2 }] },
  BLADE: { kind: "object", fluxCost: 2 },
  MACE: { kind: "object", fluxCost: 3 },
  SWORD: { kind: "object", fluxCost: 1 },
  EXPLORER: { kind: "entity", race: "auros", attackDraws: [{ draw: 1, thenDiscard: 1, requiresObject: true }] },
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
  HEIRS: { kind: "matter", behavior: "permanent", attackForms: [{ kind: "heal", who: "permanent", attackers: { kind: "entity", race: "human" }, die: 20, onRoll: null, gainOn: [1, 6], drainOn: [15, 20], amount: "human_attackers", once: true, face: 0 }] },
  OBLIVHAL: { kind: "rubyfront", attackForms: [
    { kind: "heal", who: "rubyfront", once: true, requiresAttackers: { count: 3, race: "human" }, amount: 2, die: null, onRoll: null, thenDraw: 0, thenDiscard: 0, face: 0 },
    { kind: "heal", who: "rubyfront", once: true, requiresAttackers: { count: 3, race: "human" }, amount: 2, die: null, onRoll: null, thenDraw: 1, thenDiscard: 1, face: 1 },
  ] },
  AVENGER: { kind: "entity", race: "human", attackForms: [{ kind: "empower", who: "self", once: true, targets: "next_human_attacker", grants: ["revenge"], face: 0 }] },
  RAID: { kind: "entity", race: "human", attackForms: [{ kind: "empower", who: "self", requiresPreviousAttackers: { count: 2, race: "human" }, targets: "opposing_entity", restrict: "block", face: 0 }] },
  // Il divieto di blocco «se almeno 2 Umani che controlli attaccano» (questo turno, la fonte compresa).
  CHARGE: { kind: "entity", race: "human", attackForms: [{ kind: "empower", who: "self", requiresAttackers: { count: 2, race: "human" }, targets: "opposing_entity", restrict: "block", face: 0 }] },
  IRON: { kind: "object" },
  ARCHER: { kind: "entity", race: "human", enterMoves: [{ target: { kind: "entity", controller: "opponent" }, to: "ritiro" }] },
  MARKSMAN: { kind: "entity", race: "human", enterMoves: [{ target: { kind: "entity", controller: "opponent" }, to: "abisso", hold: true }] },
  // La carta vera ha il solo innesco d'attacco (decisione del designer,
  // 2026-09-04); qui restano entrambi perché servono a provare che
  // `returnsFor` distingue i due eventi.
  RHEN: {
    kind: "entity",
    race: "human",
    enterReturns: [{ from: "ritiro", filter: { permanent: true }, to: "field" }],
    attackReturns: [{ from: "ritiro", filter: { permanent: true }, to: "field" }],
  },
  PERMANENT: { kind: "matter", behavior: "permanent" },
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
  FIELD: { kind: "matter", behavior: "permanent", fluxCost: 3, resolveForms: [{ kind: "exile", target: { permanent: true, controller: "opponent" }, to: "abisso", hold: true }] },
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
  enterRefreshes: [],
  enterDisarms: [],
  enterRearms: [],
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

  it("i candidati sono le permanenti nella propria Zona di Ritiro: Entità e Materie permanenti", () => {
    const state = newGame();
    const rhen = on(state, "rhen", "RHEN");
    inRetire(state, "p1", "PERMANENT");
    inRetire(state, "n1", "NORMAL");
    inRetire(state, "u1", "HUMAN");
    inRetire(state, "bp", "PERMANENT", "b");
    const [step] = enterReturns(state, rhen, facts);
    expect(step.from).toBe("ritiro");
    // «Permanente» (§10) è quel che resta in campo: l'Entità e la Materia
    // permanente. Non la Materia normale, non le carte dell'avversario.
    expect(step.candidates.map(card => card.uid)).toEqual(["p1", "u1"]);
    expect(step.frontFull).toBe(false);
    expect(describeReturn(step, facts)).toMatch(/«RHEN» si innesca/);
  });

  it("a Fronte pieno le Entità non tornano, le Materie permanenti sì (§6.2)", () => {
    const state = newGame();
    const rhen = on(state, "rhen", "RHEN");
    // Cinque Entità sulla fila del Fronte: gli slot sono tutti presi.
    FRONT_SLOT_X.forEach((x, index) => {
      const card = on(state, `f${index}`, "HUMAN");
      card.x = x;
      card.y = frontRowY("a");
    });
    inRetire(state, "u1", "HUMAN");
    const [full] = enterReturns(state, rhen, facts);
    expect(full.candidates).toEqual([]);
    expect(full.frontFull).toBe(true);
    inRetire(state, "p1", "PERMANENT");
    const [withMatter] = enterReturns(state, rhen, facts);
    expect(withMatter.candidates.map(card => card.uid)).toEqual(["p1"]);
    expect(withMatter.frontFull).toBe(true), "l'Entità resta fuori";
  });

  it("resolveReturn manda il toZone verso il campo marcato come effetto", async () => {
    const state = newGame();
    const rhen = on(state, "rhen", "RHEN");
    const p1 = inRetire(state, "p1", "PERMANENT");
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
    expect(enterRearms(shadow, facts)).toEqual([{ source: shadow, self: false }]);
    // La variante su di sé: l'unico portatore possibile è chi entra.
    const smith = on(state, "smith", "SMITH");
    expect(enterRearms(smith, facts)).toEqual([{ source: smith, self: true }]);
    expect(rearmChoices(state, smith, facts, true).bearers.map(card => card.uid)).toEqual(["smith"]);
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
    expect(await resolveLeaveReturn(ctx, step, blade, { x: FRONT_SLOT_X[1], y: frontRowY("a") })).toBe(true);
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
    await releaseControlled(ctx, "a", () => ({ x: 442, y: 172 }));
    expect(sent[1]).toEqual({ t: "release", uid: "b1", zone: "field", x: 442, y: 172 });
    await releaseControlled(ctx, "a", () => null);
    expect(sent[2]).toEqual({ t: "release", uid: "b1", zone: "ritiro" });
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
    const p1 = on(state, "p1", "PERMANENT");
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

  it("la Materia permanente ascolta solo gli Umani; il Rubyfront il terzo Umano, una volta", () => {
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
    // La permanente si risolve una volta per turno: scattata con un Umano, non si ripropone col prossimo.
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

  it("l'Impatto sceglie fra le avversarie economiche, il Campo fra Entità e permanenti avversari", () => {
    const state = newGame();
    const i = on(state, "i", "IMPACT");
    const c = on(state, "c", "FIELD");
    on(state, "p", "SMALL", "b");
    on(state, "g", "BIG", "b");
    on(state, "pm", "PERMANENT", "b");
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
    // Lo sconto non scende sotto 1 (§3.2).
    const cheap = on(after, "c", "SWORD");
    cheap.zone = "hand";
    cheap.assignedTo = "p";
    expect(objectCost(after, cheap, facts)).toBe(1);
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
    after.cards.v = { ...after.cards.v, zone: "abisso", assignedTo: undefined };
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
    plain.cards.v = { ...plain.cards.v, zone: "abisso", cardId: "IRON" };
    expect(deathSteps(before, plain, facts)).toEqual([]);
    const retired = structuredClone(after);
    retired.fired = [];
    retired.cards.v = { ...retired.cards.v, zone: "abisso" };
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
