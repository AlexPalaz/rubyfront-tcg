// I tasti del tavolo (tabs.ts, F4): quali gesti offre una carta adesso — i
// tasti di combattimento (§6.3, §6.4), la mira di un blocco, la mano chiusa
// a chiave nel turno altrui (§6) e lo scarto dell'eccesso (§6.5).

import { describe, expect, it } from "vitest";
import type { CardFacts, Ctx } from "../src/ctx.js";
import { newGame } from "../src/state.js";
import { canDiscard, combatTabs, handLocked, pickable, type TargetingMode } from "../src/tabs.js";
import type { CardInstance, Declaration, GameState, Phase, Seat } from "../src/types.js";

/** Un tavolo con l'arbitro, dove questo client governa solo i posti dati. */
function table(state: GameState, governs: Seat[] = ["a"]): Ctx {
  return {
    state: () => state,
    dispatch: () => Promise.resolve(true),
    seat: () => "a",
    controls: seat => governs.includes(seat),
    arbitrated: () => true,
    themeFor: () => "t49",
    tintFor: () => "dynamic",
    locale: () => "it",
    card: () => ({}) as CardFacts,
    log: () => undefined,
  };
}

/** Carte fuori catalogo: senza faccia nota contano come Entità. */
function card(state: GameState, uid: string, owner: Seat, extra: Partial<CardInstance> = {}): CardInstance {
  const instance: CardInstance = { uid, cardId: `X-${uid}`, owner, zone: "field", face: 0, x: 0, y: 0, order: 0, tapped: false, facedown: false, z: 1, ...extra };
  state.cards[uid] = instance;
  return instance;
}

function declare(state: GameState, from: string, to: string, kind: Declaration["kind"], seat: Seat, extra: Partial<Declaration> = {}): Declaration {
  const declaration: Declaration = { id: `d-${from}`, from, to, kind, seat, order: state.declarations.length + 1, ...extra };
  state.declarations.push(declaration);
  return declaration;
}

function at(phase: Phase, active: Seat): GameState {
  const state = newGame();
  state.phase = phase;
  state.active = active;
  state.turn = 3;
  return state;
}

const kinds = (ctx: Ctx, target: CardInstance, targeting: TargetingMode | null = null): string[] =>
  combatTabs(ctx, target, targeting).map(tab => `${tab.kind}:${tab.action.do}`);

describe("combatTabs — Fase di Fronte (§6.3)", () => {
  it("la tua Entità ferma attacca; coricata no; dichiarata si annulla, finché non è ferma", () => {
    const state = at("fronte", "a");
    const ctx = table(state);
    card(state, "rf", "b");
    const ready = card(state, "e1", "a");
    const tapped = card(state, "e2", "a", { tapped: true });
    const declared = card(state, "e3", "a");
    const still = card(state, "e4", "a");
    declare(state, "e3", "rf", "attack", "a");
    declare(state, "e4", "rf", "attack", "a", { sealed: true });
    expect(kinds(ctx, ready)).toEqual(["attack:attack"]);
    expect(kinds(ctx, tapped)).toEqual([]);
    expect(kinds(ctx, declared)).toEqual(["cancel:undeclare"]);
    expect(kinds(ctx, still)).toEqual([]);
  });

  it("le carte dell'avversario, e quelle del bot che non governi, non hanno tasti", () => {
    const state = at("fronte", "b");
    const ctx = table(state);
    expect(kinds(ctx, card(state, "b1", "b"))).toEqual([]);
    expect(kinds(ctx, card(state, "a1", "a"))).toEqual([]);
  });
});

describe("combatTabs — Reazione (§6.4)", () => {
  it("il difensore blocca dall'attaccante o dalla sua Entità; senza attaccanti nulla", () => {
    const state = at("reazione", "b");
    const ctx = table(state);
    card(state, "rf", "a");
    const attacker = card(state, "b1", "b", { tapped: true });
    const mine = card(state, "a1", "a");
    expect(kinds(ctx, mine)).toEqual([]);
    declare(state, "b1", "rf", "attack", "b");
    expect(kinds(ctx, attacker)).toEqual(["block:target", "counter:target"]);
    expect(kinds(ctx, mine)).toEqual(["block:targetFrom", "counter:targetFrom"]);
    // Il bloccante dichiarato si ripensa, finché non è fermo.
    declare(state, "a1", "b1", "block", "a");
    expect(kinds(ctx, mine)).toEqual(["cancel:undeclare"]);
  });

  it("una coricata o chi non può bloccare non offre il blocco", () => {
    const state = at("reazione", "b");
    const ctx = table(state);
    card(state, "rf", "a");
    card(state, "b1", "b", { tapped: true });
    declare(state, "b1", "rf", "attack", "b");
    expect(kinds(ctx, card(state, "a1", "a", { tapped: true }))).toEqual([]);
    expect(kinds(ctx, card(state, "a2", "a", { cannotBlock: true }))).toEqual([]);
  });
});

describe("combatTabs — le mire", () => {
  it("nella mira di un blocco: Annulla sotto l'attaccante, Con questa sotto le Entità libere del difensore", () => {
    const state = at("reazione", "b");
    const ctx = table(state);
    card(state, "rf", "a");
    const attacker = card(state, "b1", "b", { tapped: true });
    const free = card(state, "a1", "a");
    const other = card(state, "b2", "b");
    declare(state, "b1", "rf", "attack", "b");
    const aim: TargetingMode = { mode: "block", attacker: "b1", kind: "counter" };
    expect(kinds(ctx, attacker, aim)).toEqual(["cancel:cancel"]);
    expect(kinds(ctx, free, aim)).toEqual(["counter:confirm"]);
    expect(kinds(ctx, other, aim)).toEqual([]);
    expect(pickable(ctx, free, aim)).toBe(true);
    expect(pickable(ctx, other, aim)).toBe(false);
  });

  it("dalla propria Entità si sceglie un attaccante dell'altra metà", () => {
    const state = at("reazione", "b");
    const ctx = table(state);
    card(state, "rf", "a");
    const mine = card(state, "a1", "a");
    const attacker = card(state, "b1", "b", { tapped: true });
    const still = card(state, "b2", "b");
    declare(state, "b1", "rf", "attack", "b");
    const aim: TargetingMode = { mode: "blocker", blocker: "a1", kind: "block" };
    expect(kinds(ctx, mine, aim)).toEqual(["cancel:cancel"]);
    expect(kinds(ctx, attacker, aim)).toEqual(["block:confirm"]);
    expect(kinds(ctx, still, aim)).toEqual([]);
  });

  it("la mira di un effetto toglie ogni tasto", () => {
    const state = at("fronte", "a");
    const ctx = table(state);
    const ready = card(state, "e1", "a");
    expect(kinds(ctx, ready, { mode: "effect", candidates: new Set(["e1"]) })).toEqual([]);
    expect(pickable(ctx, ready, { mode: "effect", candidates: new Set(["e1"]) })).toBe(true);
  });
});

describe("handLocked e canDiscard (§6, §6.5)", () => {
  it("la mano è chiusa nel turno altrui e aperta nel tuo; in Reazione è del difensore", () => {
    expect(handLocked(table(at("fronte", "b")), "a")).toBe(true);
    expect(handLocked(table(at("fronte", "a")), "a")).toBe(false);
    expect(handLocked(table(at("reazione", "b")), "a")).toBe(false);
    expect(handLocked(table(at("reazione", "a")), "a")).toBe(true);
  });

  it("con più di 7 carte chi è di turno scarta, anche quando la Reazione la chiude l'altro", () => {
    const state = at("reazione", "a");
    const ctx = table(state);
    const hand = Array.from({ length: 8 }, (_, index) => card(state, `h${index}`, "a", { zone: "hand", order: index }));
    expect(handLocked(ctx, "a")).toBe(false);
    expect(canDiscard(ctx, hand[0])).toBe(true);
    delete state.cards.h7;
    expect(canDiscard(ctx, hand[0])).toBe(false);
  });

  it("a tavolo libero la mano non si chiude mai", () => {
    const state = at("fronte", "b");
    expect(handLocked({ ...table(state), arbitrated: () => false }, "a")).toBe(false);
  });
});
