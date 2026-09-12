// Il rilascio di una carta trascinata (gestures.ts, dropOnField e
// dropOnPile; F4): con l'arbitro il posto lo decide la lavagna (§5), un
// Oggetto va addosso a un'Entità (§3.1), le pile sono del proprietario (§5),
// lo scarto dell'eccesso si segna (§6.5). Il tipo delle carte lo dice il
// catalogo (faceKind): qui un catalogo finto, a tre carte.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useCatalog, type CardFace, type CatalogCard } from "../src/cards.js";
import type { CardFacts, Ctx } from "../src/ctx.js";
import { FRONT_SLOT_X, frontRowY } from "../src/geometry.js";
import { createGestures, type GestureView } from "../src/gestures.js";
import { STACK_STEP, apply, newGame } from "../src/state.js";
import type { Action, CardInstance, GameState, Seat, ZoneId } from "../src/types.js";

const catalogCard = (id: string, kind: CardFace["kind"]): CatalogCard => ({
  id,
  faces: [{ id: `${id}-0`, kind, displayKey: id }],
  locales: { it: { name: id } },
  defaultLocale: "it",
});

beforeAll(() => useCatalog({ cards: [catalogCard("HUMAN", "entity"), catalogCard("BLADE", "object"), catalogCard("STONE", "matter")] }));
afterAll(() => useCatalog({ cards: [] }));
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const FACTS: Record<string, Partial<CardFacts>> = {
  HUMAN: { kind: "entity", race: "human", fluxCost: 1 },
  BLADE: { kind: "object", fluxCost: 1 },
  STONE: { kind: "matter", fluxCost: 1 },
};
const facts = (cardId: string): CardFacts =>
  ({
    name: cardId, kind: null, race: null, power: null, counterattack: null, fluxCost: null, keywords: [],
    enterListeners: [], enterMoves: [], behavior: null, enterReturns: [], enterLooks: [], enterControls: [],
    enterRefreshes: [], enterDisarms: [], enterRearms: [], leaveReturns: [], attackReturns: [], attackDraws: [],
    attackForms: [], staticForms: [], resolveForms: [], flipForms: [], assignForms: [], deathForms: [],
    nexus: null, grantsWhileAssigned: [], abilities: [], furyAt: [],
    ...FACTS[cardId],
  }) as CardFacts;

/** Il tavolo con l'arbitro: `refuse` dice quali azioni ferma. Ogni tentativo resta in `sent`. */
function table(refuse: (action: Action) => boolean = () => false) {
  let state = newGame();
  state.phase = "preparazione";
  state.active = "a";
  state.turn = 3;
  state.players.a.flux = 5;
  const sent: { action: Action; ok: boolean }[] = [];
  const logs: string[] = [];
  const ctx: Ctx = {
    state: () => state,
    dispatch(action) {
      const ok = !refuse(action);
      sent.push({ action, ok });
      if (ok) state = apply(state, action);
      return Promise.resolve(ok);
    },
    seat: () => "a",
    controls: seat => seat === "a",
    arbitrated: () => true,
    themeFor: () => "t49",
    tintFor: () => "dynamic",
    locale: () => "it",
    card: facts,
    log: text => void logs.push(typeof text === "string" ? text : text.key),
  };
  const calls: string[] = [];
  const view: GestureView = {
    render: () => void calls.push("render"),
    light: () => undefined,
    hold: () => undefined,
    strike: () => undefined,
    liftForFlight: () => null,
    liftToFlight: () => null,
    liftToDissolve: () => null,
    flyFromPile: () => undefined,
    opensFoeRow: () => false,
    timing: { fly: 0, dissolve: 0 },
    roll: () => Promise.resolve(),
    scene: show => {
      show.onContinue?.();
      return Promise.resolve();
    },
    sceneIdle: () => Promise.resolve(),
    notice: () => Promise.resolve(),
    confirm: () => Promise.resolve(true),
    choose: () => Promise.resolve(null),
    pickTarget: () => Promise.resolve(null),
    pickFromPile: () => Promise.resolve(null),
  };
  const put = (uid: string, cardId: string, owner: Seat, zone: ZoneId, at: { x: number; y: number } = { x: 0, y: 0 }): CardInstance => {
    const card: CardInstance = { uid, cardId, owner, zone, face: 0, x: at.x, y: at.y, order: Object.keys(state.cards).length, tapped: false, facedown: false, z: 1 };
    state.cards[uid] = card;
    return card;
  };
  return { ctx, sent, logs, calls, put, gestures: createGestures(ctx, view), state: () => state as GameState };
}

const front = frontRowY("a");

describe("dropOnField — il rilascio sul campo (§3.1, §5)", () => {
  it("l'Entità dalla mano, lasciata su un riquadro libero del Fronte, si gioca lì pagando", async () => {
    const t = table();
    const card = t.put("u", "HUMAN", "a", "hand");
    t.gestures.dropOnField(card, { x: FRONT_SLOT_X[2], y: front, snapped: true }, null);
    await vi.runAllTimersAsync();
    expect(t.sent.map(entry => entry.action)).toEqual([expect.objectContaining({ t: "toZone", uid: "u", zone: "field", x: FRONT_SLOT_X[2], y: front, cost: 1 })]);
  });

  it("a Fronte pieno il gesto non si fa: nessuna azione, il tavolo si ridisegna", async () => {
    const t = table();
    FRONT_SLOT_X.forEach((x, index) => t.put(`f${index}`, "HUMAN", "a", "field", { x, y: front }));
    const card = t.put("u", "HUMAN", "a", "hand");
    t.gestures.dropOnField(card, { x: FRONT_SLOT_X[0], y: front, snapped: true }, null);
    await vi.runAllTimersAsync();
    expect(t.sent).toEqual([]);
    expect(t.calls).toContain("render");
  });

  it("un Oggetto lasciato sul vuoto non si posa (§3.1: il suo posto è addosso a un'Entità)", async () => {
    const t = table();
    const card = t.put("l", "BLADE", "a", "hand");
    t.gestures.dropOnField(card, { x: FRONT_SLOT_X[3], y: front, snapped: false }, null);
    await vi.runAllTimersAsync();
    expect(t.sent).toEqual([]);
  });

  it("un Oggetto sopra un'Entità: prima l'assegnazione, poi la giocata a scaletta dietro di lei", async () => {
    const t = table();
    const bearer = t.put("u", "HUMAN", "a", "field", { x: FRONT_SLOT_X[1], y: front });
    const card = t.put("l", "BLADE", "a", "hand");
    t.gestures.dropOnField(card, { x: bearer.x + 20, y: bearer.y + 20, snapped: false }, null);
    await vi.runAllTimersAsync();
    expect(t.sent.map(entry => entry.action)).toEqual([
      { t: "assign", uid: "l", to: "u" },
      expect.objectContaining({ t: "toZone", uid: "l", zone: "field", x: bearer.x + STACK_STEP, y: bearer.y + STACK_STEP }),
    ]);
    expect(t.logs).toContain("log.assign");
  });

  it("se la giocata non passa, l'assegnazione si scioglie e la carta torna da dove era partita", async () => {
    const t = table(action => action.t === "toZone");
    const bearer = t.put("u", "HUMAN", "a", "field", { x: FRONT_SLOT_X[1], y: front });
    const card = t.put("l", "BLADE", "a", "field", { x: FRONT_SLOT_X[4], y: front });
    t.gestures.dropOnField(card, { x: bearer.x + 20, y: bearer.y + 20, snapped: false }, { x: 10, y: 20, z: 3 });
    await vi.runAllTimersAsync();
    // Già in campo: si sposta (move), non si gioca — e lo spostamento passa.
    expect(t.sent.map(entry => entry.action.t)).toEqual(["assign", "move"]);
  });
});

describe("dropOnPile — il rilascio su una pila (§5, §6.5)", () => {
  it("sulla pila dell'avversario la carta non va: le pile sono di chi le possiede", async () => {
    const t = table();
    const card = t.put("u", "HUMAN", "a", "hand");
    expect(await t.gestures.dropOnPile(card, "b", "ritiro", null)).toBe(false);
    expect(t.sent).toEqual([]);
    expect(t.logs).toContain("log.keep.owner");
  });

  it("lo scarto dell'eccesso: la carta va in Zona di Ritiro, e il gesto lo dice", async () => {
    const t = table();
    // §6.5 — lo scarto si fa in Fronte (o in Reazione), non in Preparazione (dal 2026-09-12).
    t.state().phase = "fronte";
    const hand = Array.from({ length: 8 }, (_, index) => t.put(`h${index}`, "HUMAN", "a", "hand"));
    expect(await t.gestures.dropOnPile(hand[0], "a", "ritiro", null)).toBe(true);
    expect(t.sent.map(entry => entry.action)).toEqual([{ t: "toZone", uid: "h0", zone: "ritiro" }]);
    expect(t.logs).toContain("log.discard");
  });

  it("in Preparazione il rilascio in Zona di Ritiro non è lo scarto dell'eccesso (§6.5, dal 2026-09-12)", async () => {
    // Gemello: engine_test.rb, test_excess_discard_in_front_and_reaction_not_in_preparation.
    const t = table();
    const hand = Array.from({ length: 8 }, (_, index) => t.put(`h${index}`, "HUMAN", "a", "hand"));
    expect(await t.gestures.dropOnPile(hand[0], "a", "ritiro", null)).toBe(false);
    expect(t.logs).not.toContain("log.discard");
  });

  it("fermata dall'arbitro, la carta torna da dove era partita", async () => {
    const t = table(action => action.t === "toZone");
    const card = t.put("u", "HUMAN", "a", "field", { x: FRONT_SLOT_X[0], y: front });
    expect(await t.gestures.dropOnPile(card, "a", "hand", { x: FRONT_SLOT_X[0], y: front, z: 1 })).toBe(false);
    expect(t.sent.map(entry => [entry.action.t, entry.ok])).toEqual([["toZone", false], ["move", true]]);
  });
});
