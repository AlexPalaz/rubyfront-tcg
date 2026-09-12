// I gesti del tavolo senza DOM (gestures.ts, F4): la stessa sequenza di
// azioni e di scelte che stava nel tavolo del simulatore, con una vista finta
// che registra ciò che le si chiede. Il riduttore vero applica le azioni; i
// timer sono finti, così le attese del ritmo (luci, voli) non rallentano.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardFacts, Ctx } from "../src/ctx.js";
import { FRONT_SLOT_X, frontRowY } from "../src/geometry.js";
import { createGestures, type GestureView, type SceneShow } from "../src/gestures.js";
import type { AutoChooser } from "../src/session.js";
import { t } from "../src/i18n.js";
import { apply, newGame } from "../src/state.js";
import type { Action, CardInstance, GameState, Seat } from "../src/types.js";

const FACTS: Record<string, Partial<CardFacts>> = {
  ARCHER: { kind: "entity", race: "human", fluxCost: 2, enterMoves: [{ target: { kind: "entity", controller: "opponent" }, to: "ritiro" }] },
  HUMAN: { kind: "entity", race: "human" },
  GEAR: { kind: "object", fluxCost: 1 },
  JUDGMENT: { kind: "matter", behavior: "reactive", fluxCost: 5, resolveForms: [{ kind: "destroy", target: { kind: "entity", controller: "any" }, to: "abisso", discount: { amount: 3, ifTarget: "tapped" }, thenLose: null }] } as Partial<CardFacts>,
};
const facts = (cardId: string): CardFacts =>
  ({
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
    assignForms: [],
    deathForms: [],
    nexus: null,
    grantsWhileAssigned: [],
    ...FACTS[cardId],
  }) as CardFacts;

function card(state: GameState, uid: string, cardId: string, owner: Seat, zone: "hand" | "field"): CardInstance {
  const instance: CardInstance = { uid, cardId, owner, zone, face: 0, x: 0, y: 0, order: 0, tapped: false, facedown: false, z: 1 };
  if (zone === "field") {
    instance.x = FRONT_SLOT_X[0];
    instance.y = frontRowY(owner);
  }
  state.cards[uid] = instance;
  return instance;
}

/** Un tavolo con l'arbitro che dice sempre sì: le azioni passano dal riduttore vero. */
function table(): { ctx: Ctx; sent: Action[]; setState(next: GameState): void } {
  let state = newGame();
  const sent: Action[] = [];
  const ctx: Ctx = {
    state: () => state,
    dispatch(action) {
      sent.push(action);
      state = apply(state, action);
      return Promise.resolve(true);
    },
    seat: () => "a",
    controls: seat => seat === "a",
    arbitrated: () => true,
    themeFor: () => "t49",
    tintFor: () => "dynamic",
    locale: () => "it",
    card: facts,
    log: () => undefined,
  };
  return { ctx, sent, setState: next => (state = next) };
}

function fakeView(over: Partial<GestureView> = {}) {
  const calls: string[] = [];
  const scenes: SceneShow[] = [];
  const view: GestureView = {
    render: () => void calls.push("render"),
    light: (uid, on) => void calls.push(`light ${uid} ${on}`),
    hold: on => void calls.push(`hold ${on}`),
    strike: (uid, ms) => void calls.push(`strike ${uid} ${ms}`),
    liftForFlight: () => null,
    liftToFlight: () => null,
    liftToDissolve: () => null,
    flyFromPile: () => undefined,
    opensFoeRow: () => false,
    timing: { fly: 0, dissolve: 0 },
    roll: () => Promise.resolve(),
    // La scena si chiude subito, come un «Continua» premuto.
    scene: show => {
      scenes.push(show);
      show.onContinue?.();
      return Promise.resolve();
    },
    sceneIdle: () => Promise.resolve(),
    notice: () => Promise.resolve(),
    confirm: vi.fn(() => Promise.resolve(true)),
    choose: () => Promise.resolve(null),
    pickTarget: vi.fn((_source: CardInstance, candidates: CardInstance[]) => Promise.resolve(candidates[0] ?? null)),
    pickFromPile: vi.fn(() => Promise.resolve(null)),
    ...over,
  };
  return { view, calls, scenes };
}

/** Il gesto e tutto ciò che scatena, fino all'ultimo timer. */
async function settle<T>(run: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return run;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createGestures — la giocata dalla mano e l'innesco d'ingresso (§3.2, §8.2)", () => {
  it("il bot mira e conferma da sé: nessuna finestra, il bersaglio si accende", async () => {
    const { ctx, sent, setState } = table();
    const state = ctx.state();
    const archer = card(state, "arc", "ARCHER", "b", "hand");
    card(state, "u", "HUMAN", "a", "field");
    setState(state);
    const { view, calls, scenes } = fakeView();
    const gestures = createGestures(ctx, view);
    const chooser: AutoChooser = { pickTarget: vi.fn((_s, candidates) => candidates[0] ?? null), pickFromPile: () => null };
    gestures.setAuto("b", chooser);

    const passed = await settle(gestures.playFromHand(archer, { x: FRONT_SLOT_X[1], y: frontRowY("b") }));

    expect(passed).toBe(true);
    expect(sent.map(action => [action.t, "uid" in action ? action.uid : null, "zone" in action ? action.zone : null])).toEqual([
      ["toZone", "arc", "field"],
      ["toZone", "u", "ritiro"],
    ]);
    // Il costo stampato viaggia nell'azione (§3.2), l'innesco porta il suo riferimento (§8.2).
    expect(sent[0]).toMatchObject({ cost: 2 });
    expect(sent[1]).toMatchObject({ effect: { source: "arc" } });
    expect(scenes).toHaveLength(1);
    expect(chooser.pickTarget).toHaveBeenCalledTimes(1);
    expect(view.pickTarget).not.toHaveBeenCalled();
    expect(view.confirm).not.toHaveBeenCalled();
    expect(calls).toContain("strike u 900");
    expect(calls.at(-1)).toBe("hold false");
  });

  it("il giocatore mira e conferma con la vista", async () => {
    const { ctx, sent, setState } = table();
    const state = ctx.state();
    const archer = card(state, "arc", "ARCHER", "a", "hand");
    card(state, "u", "HUMAN", "b", "field");
    setState(state);
    const { view } = fakeView();
    const gestures = createGestures(ctx, view);

    await settle(gestures.playFromHand(archer, { x: FRONT_SLOT_X[1], y: frontRowY("a") }));

    expect(view.pickTarget).toHaveBeenCalledTimes(1);
    expect(vi.mocked(view.pickTarget).mock.calls[0][1].map(candidate => candidate.uid)).toEqual(["u"]);
    expect(view.confirm).toHaveBeenCalledTimes(1);
    expect(sent.map(action => action.t)).toEqual(["toZone", "toZone"]);
  });

  it("chi rinuncia alla mira non manda nulla oltre la giocata, e la fonte si spegne", async () => {
    const { ctx, sent, setState } = table();
    const state = ctx.state();
    const archer = card(state, "arc", "ARCHER", "a", "hand");
    card(state, "u", "HUMAN", "b", "field");
    setState(state);
    const { view, calls } = fakeView({ pickTarget: vi.fn(() => Promise.resolve(null)) });
    const gestures = createGestures(ctx, view);

    await settle(gestures.playFromHand(archer, { x: FRONT_SLOT_X[1], y: frontRowY("a") }));

    expect(sent).toHaveLength(1);
    expect(view.confirm).not.toHaveBeenCalled();
    expect(calls.filter(call => call.startsWith("light arc"))).toEqual(["light arc true", "light arc false"]);
  });
});

describe("la scena della giocata: l'Oggetto assegnato e «Risolvi» che si aspetta (§3.1, §8.2)", () => {
  it("l'Oggetto assegnato (anche dal bot) si mostra in grande: «assegna X a Y», e si chiude con Continua", async () => {
    const { ctx, setState } = table();
    const state = ctx.state();
    const bearer = card(state, "u", "HUMAN", "b", "field");
    const gear = card(state, "g", "GEAR", "b", "hand");
    setState(state);
    const { view, scenes } = fakeView();
    const gestures = createGestures(ctx, view);
    expect(await settle(gestures.assignObject(gear, bearer))).toBe(true);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].kicker).toBe(t("scene.assign"));
    expect(scenes[0].who).toMatch(/GEAR.*HUMAN/);
    expect(scenes[0].triggers ?? []).toEqual([]);
  });

  it("«Risolvi» torna la promessa dei passi che avvia: chi mostra la scena la aspetta, e il bot con lui", async () => {
    const { ctx, setState } = table();
    const state = ctx.state();
    const archer = card(state, "arc", "ARCHER", "a", "hand");
    card(state, "foe", "HUMAN", "b", "field");
    setState(state);
    let returned: unknown;
    const { view } = fakeView({
      scene: show => {
        returned = show.onContinue?.();
        return Promise.resolve();
      },
    });
    const gestures = createGestures(ctx, view);
    await settle(gestures.playFromHand(archer, { x: FRONT_SLOT_X[1], y: frontRowY("a") }));
    expect(returned).toBeInstanceOf(Promise);
    await settle(returned as Promise<void>);
  });
});

describe("la Reattiva col bersaglio alla giocata (RBF-021, §7.2): prima la scena e la mira, poi la giocata", () => {
  function judgmentTable() {
    const { ctx, sent, setState } = table();
    const state = ctx.state();
    state.players.a.flux = 5;
    const judgment = card(state, "j", "JUDGMENT", "a", "hand");
    const foe = card(state, "foe", "HUMAN", "b", "field");
    foe.tapped = true;
    setState(state);
    return { ctx, sent, judgment, foe };
  }

  it("la scena (con «Risolvi») viene prima della mira, e la giocata parte solo col bersaglio: costo scontato e catena", async () => {
    const { ctx, sent, judgment } = judgmentTable();
    const order: string[] = [];
    const { view, scenes } = fakeView({
      scene: show => {
        order.push("scena");
        scenes.push(show);
        return Promise.resolve();
      },
      pickTarget: vi.fn((_source: CardInstance, candidates: CardInstance[]) => {
        order.push(`mira (${sent.length} azioni)`);
        return Promise.resolve(candidates[0] ?? null);
      }),
    });
    const gestures = createGestures(ctx, view);
    expect(await settle(gestures.playFromHand(judgment, { x: FRONT_SLOT_X[1], y: frontRowY("a") }))).toBe(true);
    expect(order).toEqual(["scena", "mira (0 azioni)"]);
    expect(scenes[0].kicker).toBe(t("scene.reactive"));
    expect(scenes[0].triggers?.length).toBe(1);
    expect(sent).toEqual([expect.objectContaining({ t: "toZone", uid: "j", zone: "field", cost: 2, target: "foe", chain: true })]);
  });

  it("Esc sulla mira: la giocata non si fa, niente si paga", async () => {
    const { ctx, sent, judgment } = judgmentTable();
    const { view } = fakeView({ pickTarget: vi.fn(() => Promise.resolve(null)) });
    const gestures = createGestures(ctx, view);
    expect(await settle(gestures.playFromHand(judgment, { x: FRONT_SLOT_X[1], y: frontRowY("a") }))).toBe(false);
    expect(sent).toEqual([]);
    expect(ctx.state().cards.j.zone).toBe("hand");
  });

  it("alla risoluzione il bersaglio scelto non si richiede e non si riconferma: la scena dice «su chi» e basta «Continua»", async () => {
    const { ctx, sent, judgment } = judgmentTable();
    const { view, scenes } = fakeView();
    const gestures = createGestures(ctx, view);
    await settle(gestures.playFromHand(judgment, { x: FRONT_SLOT_X[1], y: frontRowY("a") }));
    // L'avversario accetta: la catena si risolve (§7.2).
    const state = ctx.state();
    state.chain = { ...state.chain!, resolving: true };
    vi.mocked(view.pickTarget).mockClear();
    gestures.driveChain();
    await vi.runAllTimersAsync();
    const resolution = scenes.at(-1)!;
    expect(resolution.kicker).toBe(t("scene.resolve.matter"));
    expect(resolution.triggers).toEqual([]);
    expect(resolution.who).toMatch(/JUDGMENT.*HUMAN/);
    expect(view.pickTarget).not.toHaveBeenCalled();
    expect(view.confirm).not.toHaveBeenCalled();
    expect(sent).toContainEqual(expect.objectContaining({ t: "toZone", uid: "foe", zone: "abisso" }));
  });
});
