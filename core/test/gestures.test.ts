// I gesti del tavolo senza DOM (gestures.ts, F4): la stessa sequenza di
// azioni e di scelte che stava nel tavolo del simulatore, con una vista finta
// che registra ciò che le si chiede. Il riduttore vero applica le azioni; i
// timer sono finti, così le attese del ritmo (luci, voli) non rallentano.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCatalog, type CatalogCard } from "../src/cards.js";
import type { CardFacts, Ctx } from "../src/ctx.js";
import { FRONT_SLOT_X, frontRowY } from "../src/geometry.js";
import { createGestures, type GestureView, type SceneShow } from "../src/gestures.js";
import type { AutoChooser } from "../src/session.js";
import { t } from "../src/i18n.js";
import { apply, newGame } from "../src/state.js";
import type { Action, CardInstance, GameState, Seat } from "../src/types.js";

const FACTS: Record<string, Partial<CardFacts>> = {
  ARCHER: { kind: "entity", race: "human", fluxCost: 2, enterMoves: [{ target: { kind: "entity", controller: "opponent", maxCost: null }, to: "ritiro" }] },
  HUMAN: { kind: "entity", race: "human" },
  RUBY: { kind: "rubyfront" },
  // «Quando attacca: le altre armate +1» — una forma d'attacco di chi attacca.
  COMMAND: { kind: "entity", race: "auros", attackForms: [{ kind: "empower", who: "self", targets: "others_armed", power: 1, face: 0 }] },
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
    enterStashes: [],
    selfRetires: [],
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

// §6.3 (deciso 2026-09-15): la dichiarazione è solo la dichiarazione; i
// «quando attacca» si risolvono alla chiusura del Fronte, con le loro scene.
describe("createGestures — l'attacco e i suoi inneschi alla chiusura del Fronte (§6.3)", () => {
  // Il bersaglio dell'attacco è il Rubyfront avversario, che i gesti riconoscono dal catalogo.
  const ruby: CatalogCard = { id: "RUBY", faces: [{ id: "RUBY-0", kind: "rubyfront", displayKey: "RUBY" }], locales: { it: { name: "RUBY" } }, defaultLocale: "it" };
  beforeEach(() => useCatalog({ cards: [ruby] }));
  afterEach(() => useCatalog({ cards: [] }));

  function frontState(): { ctx: Ctx; sent: Action[]; state: GameState } {
    const { ctx, sent, setState } = table();
    const state = ctx.state();
    state.turn = 3;
    state.active = "a";
    state.phase = "fronte";
    card(state, "c", "COMMAND", "a", "field");
    card(state, "rf-b", "RUBY", "b", "field");
    setState(state);
    return { ctx, sent, state };
  }

  it("attackWith dichiara e basta: nessuna scena, nessun passo", async () => {
    const { ctx, sent } = frontState();
    const { view, scenes } = fakeView();
    const gestures = createGestures(ctx, view);
    await settle(gestures.attackWith(ctx.state().cards.c));
    // La dichiarazione e la tappata (§6.3), e basta.
    expect(sent.map(action => action.t)).toEqual(["declare", "tap"]);
    expect(scenes).toHaveLength(0);
  });

  it("resolveAttacks apre la scena «Quando attacca» di chi ha attaccato e ne esegue i passi dopo la stretta di mano", async () => {
    const { ctx, sent } = frontState();
    const synced: string[] = [];
    ctx.sync = (key, scene) => {
      synced.push(`${scene.kind}:${scene.uid}:${key.split("|").at(-1)}`);
      return Promise.resolve();
    };
    const { view, scenes, calls } = fakeView();
    const gestures = createGestures(ctx, view);
    await settle(gestures.attackWith(ctx.state().cards.c));
    await settle(gestures.resolveAttacks());
    expect(scenes).toHaveLength(1);
    expect(scenes[0].kicker).toBe(t("scene.attack"));
    expect(scenes[0].cardId).toBe("COMMAND");
    // Prima il «pronto» dei due client (in stanza), poi il passo; il tavolo fermo e la targhetta nel frattempo.
    expect(synced).toEqual(["attack:c:3"]);
    expect(calls).toContain("hold true");
    // Senza altre armate il potenziamento non ha bersagli: la scena c'è, l'azione no — ma il passo è stato compiuto dopo la scena.
    expect(sent.map(action => action.t)).toEqual(["declare", "tap"]);
  });

  it("l'avversario ricostruisce la scena dal riferimento, nella sua lingua", async () => {
    const { ctx } = frontState();
    const { view } = fakeView();
    const gestures = createGestures(ctx, view);
    await settle(gestures.attackWith(ctx.state().cards.c));
    const show = gestures.sceneFor({ kind: "attack", uid: "c" });
    expect(show?.kicker).toBe(t("scene.attack"));
    expect(show?.triggers?.length).toBe(1);
    expect(gestures.sceneFor({ kind: "attack", uid: "nessuno" })).toBeNull();
    expect(gestures.sceneFor({ kind: "enter", uid: "c" })?.who).toContain("COMMAND");
  });
});

// §8.2 (deciso 2026-09-15): chi rientra sul Fronte dal Ritiro o dall'Abisso è
// entrata sul Fronte — la sua scena d'ingresso e i suoi inneschi.
describe("createGestures — il rientro sul Fronte innesca «quando entra» (§8.2)", () => {
  it("offerReturned apre la scena di chi è tornata dal Ritiro e ne esegue gli inneschi", async () => {
    const { ctx, sent, setState } = table();
    const before = ctx.state();
    const archer = card(before, "arc", "ARCHER", "a", "field");
    archer.zone = "ritiro";
    card(before, "b1", "HUMAN", "b", "field");
    const after = apply(before, { t: "toZone", uid: "arc", zone: "field", x: FRONT_SLOT_X[0], y: frontRowY("a"), z: 2 });
    setState(after);
    const { view, scenes } = fakeView();
    const gestures = createGestures(ctx, view);
    gestures.setAuto("a", { pickTarget: (_s, candidates) => candidates[0] ?? null, pickFromPile: () => null });
    gestures.offerReturned(before, after, ["a"]);
    await settle(Promise.resolve());
    expect(scenes).toHaveLength(1);
    expect(scenes[0].cardId).toBe("ARCHER");
    expect(sent.map(action => [action.t, "uid" in action ? action.uid : null])).toEqual([["toZone", "b1"]]);
  });

  it("chi non ha inneschi, o non è tornata da una pila, non apre nulla", async () => {
    const { ctx, setState } = table();
    const before = ctx.state();
    card(before, "u", "HUMAN", "a", "field").zone = "ritiro";
    card(before, "h", "ARCHER", "a", "hand");
    const after = apply(apply(before, { t: "toZone", uid: "u", zone: "field", x: FRONT_SLOT_X[0], y: frontRowY("a"), z: 2 }), { t: "toZone", uid: "h", zone: "field", x: FRONT_SLOT_X[1], y: frontRowY("a"), z: 3 });
    setState(after);
    const { view, scenes } = fakeView();
    createGestures(ctx, view).offerReturned(before, after, ["a"]);
    await settle(Promise.resolve());
    expect(scenes).toHaveLength(0);
  });
});

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
    // Prima di non fare nulla si chiede (2026-09-13): qui il sì della vista finta.
    expect(view.confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(view.confirm).mock.calls[0][0]).toBe(t("confirm.skip"));
    expect(calls.filter(call => call.startsWith("light arc"))).toEqual(["light arc true", "light arc false"]);
  });

  it("Esc, poi «Torna alla scelta»: la mira si riapre, e col bersaglio l'effetto va", async () => {
    const { ctx, sent, setState } = table();
    const state = ctx.state();
    const archer = card(state, "arc", "ARCHER", "a", "hand");
    card(state, "u", "HUMAN", "b", "field");
    setState(state);
    const pickTarget = vi.fn((_source: CardInstance, candidates: CardInstance[]) => Promise.resolve(pickTarget.mock.calls.length > 1 ? candidates[0] : null));
    // La rinuncia: no; poi la conferma del bersaglio: sì.
    const confirm = vi.fn((question: string) => Promise.resolve(question !== t("confirm.skip")));
    const { view } = fakeView({ pickTarget, confirm });
    const gestures = createGestures(ctx, view);

    await settle(gestures.playFromHand(archer, { x: FRONT_SLOT_X[1], y: frontRowY("a") }));

    expect(pickTarget).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls.map(call => call[0] === t("confirm.skip"))).toEqual([true, false]);
    expect(sent.map(action => action.t)).toEqual(["toZone", "toZone"]);
  });

  it("«Annulla» sul bersaglio chiede se non fare nulla; «Torna alla scelta» rimira", async () => {
    const { ctx, sent, setState } = table();
    const state = ctx.state();
    const archer = card(state, "arc", "ARCHER", "a", "hand");
    card(state, "u", "HUMAN", "b", "field");
    setState(state);
    // Il bersaglio: annulla; la rinuncia: no; il bersaglio di nuovo: sì.
    const answers = [false, false, true];
    const confirm = vi.fn(() => Promise.resolve(answers.shift() ?? true));
    const { view } = fakeView({ confirm });
    const gestures = createGestures(ctx, view);

    await settle(gestures.playFromHand(archer, { x: FRONT_SLOT_X[1], y: frontRowY("a") }));

    expect(view.pickTarget).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls.map(call => call[0] === t("confirm.skip"))).toEqual([false, true, false]);
    expect(sent.map(action => action.t)).toEqual(["toZone", "toZone"]);
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

// La mano accende solo ciò che l'arbitro lascerebbe passare adesso (2026-09-15).
describe("unplayable — la mano vela ciò che l'arbitro fermerebbe", () => {
  it("fasi, finestre delle Reattive, Fronte pieno, Oggetto senza portatore, Flusso", () => {
    const { ctx, setState } = table();
    const { view } = fakeView();
    const gestures = createGestures(ctx, view);
    let state = newGame("a");
    state.players.a.flux = 5;
    const human = card(state, "h", "HUMAN", "a", "hand");
    const gear = card(state, "g", "GEAR", "a", "hand");
    const judgment = card(state, "j", "JUDGMENT", "a", "hand");
    setState(state);
    // Preparazione, mio turno: l'Entità sì, l'Oggetto no (nessuna Entità da armare), la Reattiva no (fuori finestra).
    expect(gestures.unplayable(human)).toBe(false);
    expect(gestures.unplayable(gear)).toBe(true);
    expect(gestures.unplayable(judgment)).toBe(true);
    const first = card(state, "e", "HUMAN", "a", "field");
    first.x = FRONT_SLOT_X[0];
    first.y = frontRowY("a");
    expect(gestures.unplayable(gear)).toBe(false);
    // Fronte pieno: l'Entità si vela.
    ["e2", "e3", "e4", "e5"].forEach((uid, index) => {
      const other = card(state, uid, "HUMAN", "a", "field");
      other.x = FRONT_SLOT_X[index + 1];
      other.y = frontRowY("a");
    });
    expect(gestures.unplayable(human)).toBe(true);
    // Fronte, mio turno, prima dell'ondata: solo la Reattiva; dopo l'ondata nemmeno lei.
    state = { ...state, phase: "fronte" };
    setState(state);
    expect(gestures.unplayable(judgment)).toBe(false);
    expect(gestures.unplayable(gear)).toBe(true);
    state = { ...state, declarations: [{ id: "x", from: "e", to: "rf-b", kind: "attack", seat: "a", order: 1 }] };
    setState(state);
    expect(gestures.unplayable(judgment)).toBe(true);
    // Reazione: la Reattiva è del difensore, non di chi attacca.
    state = { ...state, phase: "reazione" };
    setState(state);
    expect(gestures.unplayable(judgment)).toBe(true);
    state = { ...state, active: "b" };
    setState(state);
    expect(gestures.unplayable(judgment)).toBe(false);
    // Senza Flusso nemmeno il difensore.
    state = { ...state, players: { ...state.players, a: { ...state.players.a, flux: 1, token: false } } };
    setState(state);
    expect(gestures.unplayable(judgment)).toBe(true);
    // Turno altrui in Preparazione: niente si gioca.
    state = { ...state, phase: "preparazione", declarations: [], players: { ...state.players, a: { ...state.players.a, flux: 5 } } };
    setState(state);
    expect(gestures.unplayable(gear)).toBe(true);
  });
});

// §6.2 — il Ritiro voluto dal giocatore ha il suo volo (2026-09-15).
describe("il Ritiro dal Fronte: il volo suo, solo dal campo e solo verso il Ritiro", () => {
  it("dropOnPile e il menu prendono la carta con liftToRetire, e la lasciano andare ad azione passata", async () => {
    const { ctx, sent, setState } = table();
    const lifted: string[] = [];
    const flown: string[] = [];
    const { view } = fakeView({
      liftToRetire: uid => {
        lifted.push(uid);
        const flight = (() => void flown.push(uid)) as (() => void) & { cancel(): void };
        flight.cancel = () => undefined;
        return flight;
      },
    });
    const gestures = createGestures(ctx, view);
    const state = newGame("a");
    const entity = card(state, "e", "HUMAN", "a", "field");
    const inHand = card(state, "h", "HUMAN", "a", "hand");
    setState(state);
    await settle(gestures.dropOnPile(entity, "a", "ritiro", null));
    expect(lifted).toEqual(["e"]);
    expect(flown).toEqual(["e"]);
    expect(sent.at(-1)).toMatchObject({ t: "toZone", uid: "e", zone: "ritiro" });
    // Dalla mano non è un Ritiro; verso l'Abisso nemmeno.
    await settle(gestures.dropOnPile(inHand, "a", "ritiro", null));
    const other = card(ctx.state(), "f", "HUMAN", "a", "field");
    setState(ctx.state());
    await settle(gestures.sendToZone(other, "abisso"));
    expect(lifted).toEqual(["e"]);
    // Dal menu, verso il Ritiro: sì.
    const third = card(ctx.state(), "g", "HUMAN", "a", "field");
    setState(ctx.state());
    await settle(gestures.sendToZone(third, "ritiro"));
    expect(lifted).toEqual(["e", "g"]);
  });
});
