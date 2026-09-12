// La sessione (session.ts), senza tavolo: la stanza «solo» con l'arbitro
// assente lascia il tavolo libero, e le azioni si applicano subito. Qui si
// prova ciò che i due client si aspettano da lei — l'ordine attorno a
// un'azione, il mazzo in tavola, l'apertura (§4, §6.1), l'attesa della
// stanza, la fine per PV contro il bot — su una vista finta e sul catalogo
// vero (docs/cards/catalog.json).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isRubyfront, useCatalog, type CatalogCard, type CatalogDeck } from "../src/cards.js";
import { SLOT_X, backRowY } from "../src/geometry.js";
import { createSession, type Session, type SessionView } from "../src/session.js";
import { zoneCards } from "../src/state.js";
import type { Action, GameState } from "../src/types.js";

const catalog = JSON.parse(readFileSync(join(import.meta.dirname, "../../docs/cards/catalog.json"), "utf8")) as {
  cards: CatalogCard[];
  decks: CatalogDeck[];
};
const [DECK, OTHER] = catalog.decks;
const HAND_MS = 1000;
const TURN_DRAW_MS = 2000;

beforeAll(() => useCatalog(catalog));

/** La vista finta: annota cosa le si chiede, e in che ordine. */
function fakeView(): SessionView & { calls: string[]; seen: GameState[] } {
  const calls: string[] = [];
  const seen: GameState[] = [];
  const note = (name: string) => () => {
    calls.push(name);
  };
  const yes = async (): Promise<boolean> => true;
  return {
    calls,
    seen,
    render: note("render"),
    stop: verdict => calls.push(`stop:${verdict.reason}`),
    beforeCommit: action => {
      calls.push(`before:${action.t}`);
      return () => calls.push(`after:${action.t}`);
    },
    beforeReceive: action => {
      calls.push(`receive:${action.t}`);
    },
    engineStatus: note("engineStatus"),
    netStatus: note("netStatus"),
    waitForPeer: note("waitForPeer"),
    seated: note("seated"),
    announce: note("announce"),
    introDone: note("introDone"),
    botGameOver: won => calls.push(`botGameOver:${won}`),
    joining: note("joining"),
    rtc: note("rtc"),
    setAuto: seat => calls.push(`setAuto:${seat}`),
    playFromHand: yes,
    assignObject: yes,
    deployRubyfront: async () => false,
    attackWith: async () => {},
    useAbility: yes,
    flipToNexus: yes,
    introRubyfronts: async () => {},
    promptDiscard: () => false,
    offerLeaveReturns: note("offerLeaveReturns"),
    offerAssignTriggers: note("offerAssignTriggers"),
    offerDeathRemains: note("offerDeathRemains"),
    quiet: () => true,
  };
}

function memoryStore(initial: Record<string, string> = {}) {
  const values = { ...initial };
  return {
    values,
    read: (key: string, fallback: string) => values[key] ?? fallback,
    write: (key: string, value: string) => {
      values[key] = value;
    },
  };
}

function open(view = fakeView(), store = memoryStore()): { session: Session; view: ReturnType<typeof fakeView>; store: ReturnType<typeof memoryStore> } {
  const session = createSession({
    seat: "a",
    locale: "it",
    store,
    engineUrl: "ws://127.0.0.1:9",
    defaultTheme: "t41",
    opening: { hand: HAND_MS, turnDraw: TURN_DRAW_MS },
    view,
  });
  return { session, view, store };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("un'azione, senza arbitro, nella «solo»", () => {
  it("passa, e la vista la vede prima e dopo il ridisegno, poi offre gli effetti a chi decide", async () => {
    const { session, view } = open();
    const passed = await session.dispatch({ t: "player", seat: "a", patch: { name: "Ada" } });
    expect(passed).toBe(true);
    expect(session.state().players.a.name).toBe("Ada");
    expect(view.calls.slice(0, 6)).toEqual(["before:player", "render", "after:player", "offerLeaveReturns", "offerAssignTriggers", "offerDeathRemains"]);
  });

  it("la vista legge lo stato di PRIMA nel suo beforeCommit (i voli si prendono lì)", async () => {
    const view = fakeView();
    const { session } = open(view);
    let named = "?";
    view.beforeCommit = () => {
      named = session.state().players.a.name;
    };
    await session.dispatch({ t: "player", seat: "a", patch: { name: "Ada" } });
    expect(named).not.toBe("Ada");
  });

  it("i temi e le tinte seguono il mazzo di ciascun posto", () => {
    const { session } = open();
    expect(session.ctx.themeFor("a")).toBe("t41");
    session.loadDeck(DECK.id, "a");
    expect(session.ctx.themeFor("a")).toBe(DECK.theme);
    expect(session.ctx.themeFor("b")).toBe("t41");
  });
});

describe("il mazzo in tavola", () => {
  it("il Rubyfront parte in Zona di Richiamo (§3.1), il resto nel mazzo, e il mazzo si ricorda", () => {
    const { session, store } = open();
    session.loadDeck(DECK.id, "a");
    const mine = Object.values(session.state().cards).filter(card => card.owner === "a");
    const total = DECK.cards.reduce((sum, entry) => sum + entry.count, 0);
    expect(mine).toHaveLength(total);
    const rubyfronts = mine.filter(card => isRubyfront(card.cardId));
    expect(rubyfronts).toHaveLength(1);
    expect(rubyfronts[0]).toMatchObject({ zone: "field", x: SLOT_X.richiamo, y: backRowY("a") });
    expect(zoneCards(session.state(), "a", "deck")).toHaveLength(total - 1);
    expect(session.myDeck()).toBe(DECK.id);
    expect(store.values.deck).toBe(DECK.id);
  });

  it("il mazzo dell'altro posto non diventa «il mio»", () => {
    const { session, store } = open();
    session.loadDeck(OTHER.id, "b");
    expect(session.myDeck()).toBeNull();
    expect(store.values.deck).toBeUndefined();
  });

  it("l'apertura: insegna, poi 6 carte (§4), poi la carta del turno 1 per chi apre (§6.1)", async () => {
    const { session, view } = open();
    await session.dispatch({ t: "newGame", active: "a" });
    session.loadDeck(DECK.id, "a");
    expect(view.calls).toContain("announce");
    expect(zoneCards(session.state(), "a", "hand")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(HAND_MS);
    expect(zoneCards(session.state(), "a", "hand")).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(TURN_DRAW_MS);
    expect(zoneCards(session.state(), "a", "hand")).toHaveLength(7);
  });

  it("chi non apre pesca solo le 6", async () => {
    const { session } = open();
    await session.dispatch({ t: "newGame", active: "b" });
    session.loadDeck(DECK.id, "a");
    await vi.advanceTimersByTimeAsync(HAND_MS + TURN_DRAW_MS);
    expect(zoneCards(session.state(), "a", "hand")).toHaveLength(6);
  });

  it("a mazzo ricaricato prima del tempo, la fila vecchia si lascia cadere", async () => {
    const { session } = open();
    await session.dispatch({ t: "newGame", active: "a" });
    session.loadDeck(DECK.id, "a");
    await vi.advanceTimersByTimeAsync(HAND_MS / 2);
    session.loadDeck(OTHER.id, "a");
    await vi.advanceTimersByTimeAsync(HAND_MS);
    const hand = zoneCards(session.state(), "a", "hand");
    expect(hand).toHaveLength(6);
    expect(hand.every(card => card.uid.startsWith("a-"))).toBe(true);
  });
});

describe("al tavolo", () => {
  it("senza stanza ci si siede subito, col mazzo scelto", () => {
    const { session, view } = open(fakeView(), memoryStore({ deck: DECK.id }));
    session.seatOrWait();
    expect(view.calls).toContain("seated");
    expect(session.awaitingPeer()).toBe(false);
    expect(session.state().players.a.deckId).toBe(DECK.id);
  });

  it("la partita nuova rimette il proprio nome (la nuova partita azzera i nomi)", async () => {
    const { session } = open(fakeView(), memoryStore({ name: "Ada", deck: DECK.id }));
    session.newGame();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.state().players.a.name).toBe("Ada");
  });
});

describe("il bot", () => {
  it("si siede all'altro posto col suo mazzo e le scelte automatiche", () => {
    const { session, view } = open();
    session.startBot(OTHER.id);
    expect(session.botSeat()).toBe("b");
    expect(view.calls).toContain("setAuto:b");
    expect(session.state().players.b.deckId).toBe(OTHER.id);
  });

  it("la fine per PV (§2) si dichiara da sé, e la vista sa chi ha vinto", async () => {
    const { session, view } = open();
    session.startBot(OTHER.id);
    const actions: Action["t"][] = [];
    const before = view.beforeCommit;
    view.beforeCommit = action => {
      actions.push(action.t);
      return before(action);
    };
    await session.dispatch({ t: "player", seat: "b", patch: { hp: 0 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(actions).toContain("gameOver");
    expect(session.state().over).toBeTruthy();
    expect(view.calls).toContain("botGameOver:true");
  });
});
