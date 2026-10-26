// La sessione (session.ts), senza tavolo: la stanza «solo» con l'arbitro
// assente lascia il tavolo libero, e le azioni si applicano subito. Qui si
// prova ciò che i due client si aspettano da lei — l'ordine attorno a
// un'azione, il mazzo in tavola, l'apertura (§4, §6.1), l'attesa della
// stanza, la fine per PV contro il bot — su una vista finta e sul catalogo
// vero (docs/cards/catalog.json).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cardStats, isRubyfront, useCatalog, type CatalogCard, type CatalogDeck } from "../src/cards.js";
import { FRONT_SLOT_X, SLOT_X, backRowY, frontRowY } from "../src/geometry.js";
import { createSession, type Session, type SessionView } from "../src/session.js";
import { zoneCards } from "../src/state.js";
import { HIDDEN_CARD, isHidden } from "../src/types.js";
import type { Action, GameState } from "../src/types.js";
import { FakeWebSocket, fakeTable } from "./fake-table.js";

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
    reseat: (room, seat) => calls.push(`reseat:${room}:${seat}`),
    roomFull: room => calls.push(`roomFull:${room}`),
    searching: note("searching"),
    matched: (room, seat) => calls.push(`matched:${room}:${seat}`),
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
    offerStasisHeals: note("offerStasisHeals"),
    offerTapHeals: note("offerTapHeals"),
    resolveExiles: async () => {},
    offerAssignTriggers: note("offerAssignTriggers"),
    offerDeathRemains: note("offerDeathRemains"),
    offerTurnStart: note("offerTurnStart"),
    offerReturned: note("offerReturned"),
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
    expect(view.calls.slice(0, 8)).toEqual(["before:player", "render", "after:player", "offerLeaveReturns", "offerStasisHeals", "offerTapHeals", "offerAssignTriggers", "offerDeathRemains"]);
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

  it("l'apertura: insegna, poi 6 carte (§4), poi — tenuta la mano — la carta del turno 1 per chi apre (§6.1)", async () => {
    const { session, view } = open();
    await session.dispatch({ t: "newGame", active: "a" });
    session.loadDeck(DECK.id, "a");
    expect(view.calls).toContain("announce");
    expect(zoneCards(session.state(), "a", "hand")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(HAND_MS);
    expect(zoneCards(session.state(), "a", "hand")).toHaveLength(6);
    // §4 (dal 2026-09-17) — la carta del turno aspetta la tenuta: mulligan aperto.
    await vi.advanceTimersByTimeAsync(TURN_DRAW_MS);
    expect(zoneCards(session.state(), "a", "hand")).toHaveLength(6);
    session.mulligan();
    await vi.advanceTimersByTimeAsync(0);
    expect(zoneCards(session.state(), "a", "hand")).toHaveLength(6);
    expect(session.state().players.a.opening).toEqual({ mulligans: 1, kept: false });
    session.keep();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.state().players.a.opening?.kept).toBe(true);
    const announced = view.calls.filter(call => call === "announce").length;
    expect(announced).toBeGreaterThanOrEqual(2);
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

// §8.2 — l'esilio condizionato: chi teneva una carta statica nell'Abisso lascia il
// campo, e la carta statica torna in gioco col `release` mandato dal tavolo che
// l'ha visto uscire. Il suo rientro è un ingresso: la scena, con gli inneschi
// «quando entra», si offre UNA volta (2026-09-16: si offriva due volte, al
// commit del release e al ritorno di releaseHeld, e l'innesco si risolveva due volte).
describe("la fine dell'esilio (§8.2)", () => {
  it("chi torna dall'Abisso rientra sul Fronte, e la sua scena d'ingresso si offre una volta sola", async () => {
    const { session, view } = open();
    await session.dispatch({ t: "newGame", active: "a" });
    session.loadDeck(DECK.id, "a");
    session.loadDeck(OTHER.id, "b");
    const entity = (owner: "a" | "b") => Object.values(session.state().cards).find(card => card.owner === owner && !isRubyfront(card.cardId) && cardStats(card.cardId).kind === "entity")!;
    const holder = entity("a");
    const held = entity("b");
    await session.dispatch({ t: "toZone", uid: holder.uid, zone: "field", x: FRONT_SLOT_X[0], y: frontRowY("a"), z: 1 });
    await session.dispatch({ t: "toZone", uid: held.uid, zone: "field", x: FRONT_SLOT_X[0], y: frontRowY("b"), z: 2 });
    await session.dispatch({ t: "toZone", uid: held.uid, zone: "abisso", heldBy: holder.uid });
    expect(session.state().cards[held.uid]).toMatchObject({ zone: "abisso", heldBy: holder.uid });
    view.calls.length = 0;
    await session.dispatch({ t: "toZone", uid: holder.uid, zone: "ritiro" });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.state().cards[held.uid]).toMatchObject({ zone: "field", y: frontRowY("b") });
    expect(session.state().cards[held.uid]?.heldBy).toBeUndefined();
    expect(view.calls.filter(call => call === "offerReturned")).toHaveLength(1);
    expect(view.calls.filter(call => call === "before:release")).toHaveLength(1);
  });
});

// Il tavolo finto (fake-table.ts): la stanza che completa le azioni col caso
// e manda le viste per posto (2026-10-21). Qui si prova ciò che la sessione
// fa con l'`applied` del verdetto, col dado del tavolo, con le carte altrui
// nascoste, col giornale proiettato, col tavolo ripartito e con l'uscita.
describe("col tavolo che tira e proietta", () => {
  function online(room = "", seed = 7, starter: "a" | "b" = "a") {
    FakeWebSocket.reset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const table = fakeTable(room, { seed, starter, token: "c".repeat(32) });
    const view = fakeView();
    const store = memoryStore(room ? { room } : {});
    const session = createSession({ seat: "a", locale: "it", store, engineUrl: "ws://tavolo:1", defaultTheme: "t41", opening: { hand: HAND_MS, turnDraw: TURN_DRAW_MS }, view });
    // Il filo si apre sedendosi: nella «solo» (nome vuoto) come in stanza.
    session.join(room);
    return { session, view, store, table };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("la sessione applica l'azione COMPLETATA dal tavolo: il mazzo è mescolato dalla stanza, non dal client", async () => {
    const { session, table } = online();
    await vi.advanceTimersByTimeAsync(0);
    session.loadDeck(DECK.id, "a");
    await vi.advanceTimersByTimeAsync(0);
    const sent = table.judged.find(action => action.t === "loadDeck");
    expect(sent?.t).toBe("loadDeck");
    const canonical = (sent as { cards: { order?: number; zone: string }[] }).cards.filter(card => card.zone === "deck").map(card => card.order);
    expect(canonical).toEqual([...canonical].sort((x, y) => (x ?? 0) - (y ?? 0)));
    const mine = zoneCards(session.state(), "a", "deck").map(card => card.order);
    expect(mine).toEqual(zoneCards(table.state(), "a", "deck").map(card => card.order));
    expect([...mine].sort((x, y) => x - y)).toEqual(mine);
    const labels = Object.values(session.state().cards).filter(card => card.owner === "a").map(card => Number(card.uid.slice(2)));
    expect([...labels].sort((x, y) => x - y)).toEqual(labels.map((_, i) => i + 1));
    expect(labels).not.toEqual(labels.map((_, i) => i + 1));
  });

  it("la mescolata e il mulligan partono senza ordine, e tornano con quello del tavolo", async () => {
    const { session, table } = online();
    await vi.advanceTimersByTimeAsync(0);
    session.loadDeck(DECK.id, "a");
    await vi.advanceTimersByTimeAsync(0);
    const before = zoneCards(session.state(), "a", "deck").map(card => card.uid);
    session.shuffle();
    await vi.advanceTimersByTimeAsync(0);
    const shuffle = table.judged.find(action => action.t === "shuffle") as { order?: string[] } | undefined;
    expect(shuffle).toBeDefined();
    expect(shuffle?.order).toBeUndefined();
    const after = zoneCards(session.state(), "a", "deck").map(card => card.uid);
    expect([...after].sort()).toEqual([...before].sort());
    expect(after).not.toEqual(before);
    expect(after).toEqual(zoneCards(table.state(), "a", "deck").map(card => card.uid));
    expect(session.state().chat.at(-1)?.key).toBe("log.shuffle");
  });

  it("il dado lo tira il tavolo: session.roll torna il suo valore, lo stesso per lo stesso passo", async () => {
    const { session, table } = online();
    await vi.advanceTimersByTimeAsync(0);
    const first = await session.roll(6, "cost|a-1");
    expect(first).not.toBeNull();
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(6);
    expect(table.judged.at(-1)).toEqual({ t: "roll", seat: "a", die: 6, for: "cost|a-1" });
    expect(session.state().rolls?.["cost|a-1"]).toEqual({ die: 6, value: first });
    expect(await session.roll(6, "cost|a-1")).toBe(first);
    const twenty = await session.roll(20, "fury|rf");
    expect(twenty).toBeLessThanOrEqual(20);
  });

  it("senza tavolo, nella «solo», il caso lo tira il client: mescolata e dado si completano in locale", async () => {
    const { session } = open();
    session.loadDeck(DECK.id, "a");
    const before = zoneCards(session.state(), "a", "deck").map(card => card.uid);
    session.shuffle();
    await vi.advanceTimersByTimeAsync(0);
    const after = zoneCards(session.state(), "a", "deck").map(card => card.uid);
    expect([...after].sort()).toEqual([...before].sort());
    expect(after).not.toEqual(before);
    const roll = await session.roll(6, "deploy|rf");
    expect(roll).toBeGreaterThanOrEqual(1);
    expect(roll).toBeLessThanOrEqual(6);
    await session.dispatch({ t: "newGame" });
    expect(["a", "b"]).toContain(session.state().active);
  });

  it("in stanza una pescata altrui arriva per nome (drawn) e le carte restano dorsi", async () => {
    const { session, table } = online("stanza");
    await vi.advanceTimersByTimeAsync(0);
    const hidden = Array.from({ length: 4 }, (_, i) => ({ uid: `b-${i + 1}`, owner: "b" as const, zone: "deck" as const, face: 0, x: 0, y: 0, tapped: false, facedown: false, z: 0 }));
    table.pushAction({ t: "loadDeck", seat: "b", deckId: OTHER.id, cards: hidden }, "b");
    expect(zoneCards(session.state(), "b", "deck").every(card => isHidden(card))).toBe(true);
    table.pushAction({ t: "draw", seat: "b", count: 2, drawn: ["b-3", "b-1"] }, "b");
    expect(zoneCards(session.state(), "b", "hand").map(card => card.uid)).toEqual(["b-3", "b-1"]);
    expect(session.state().cards["b-3"].cardId).toBe(HIDDEN_CARD);
  });

  it("in stanza una giocata altrui porta le identità, e la vista le vede prima che l'azione si applichi", async () => {
    const view = fakeView();
    let seenBefore = "";
    view.beforeReceive = action => {
      if (action.t === "toZone") seenBefore = session.state().cards[action.uid]?.cardId ?? "";
    };
    FakeWebSocket.reset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const table = fakeTable("stanza", { token: "c".repeat(32) });
    const session = createSession({ seat: "a", locale: "it", store: memoryStore(), engineUrl: "ws://tavolo:1", defaultTheme: "t41", opening: { hand: HAND_MS, turnDraw: TURN_DRAW_MS }, view });
    session.join("stanza");
    await vi.advanceTimersByTimeAsync(0);
    table.pushAction({ t: "loadDeck", seat: "b", deckId: OTHER.id, cards: [{ uid: "b-1", owner: "b", zone: "hand", face: 0, x: 0, y: 0, tapped: false, facedown: false, z: 0 }] }, "b");
    expect(isHidden(session.state().cards["b-1"])).toBe(true);
    table.pushAction({ t: "toZone", uid: "b-1", zone: "field", x: 442, y: 172, z: 2, identities: { "b-1": "RBF-047" } }, "b");
    expect(seenBefore).toBe("RBF-047");
    expect(session.state().cards["b-1"]).toMatchObject({ zone: "field", cardId: "RBF-047" });
  });

  it("il giornale proiettato si rigioca: le mie carte intere, le altrui dorsi finché non escono", async () => {
    const { session, table } = online("stanza");
    await vi.advanceTimersByTimeAsync(0);
    table.push({ t: "journal", match: "m", actions: [
      { action: { t: "newGame", active: "a" }, from: null },
      { action: { t: "loadDeck", seat: "a", deckId: DECK.id, cards: [{ uid: "a-1", cardId: "RBF-047", owner: "a", zone: "deck", order: 0, face: 0, x: 0, y: 0, tapped: false, facedown: false, z: 0 }] }, from: "a" },
      { action: { t: "loadDeck", seat: "b", deckId: OTHER.id, cards: [{ uid: "b-1", owner: "b", zone: "deck", face: 0, x: 0, y: 0, tapped: false, facedown: false, z: 0 }, { uid: "b-2", owner: "b", zone: "deck", face: 0, x: 0, y: 0, tapped: false, facedown: false, z: 0 }] }, from: "b" },
      { action: { t: "draw", seat: "b", count: 1, drawn: ["b-2"] }, from: "b" },
      { action: { t: "toZone", uid: "b-2", zone: "ritiro", identities: { "b-2": "RBF-050" } }, from: "b" },
    ] });
    const state = session.state();
    expect(state.cards["a-1"].cardId).toBe("RBF-047");
    expect(isHidden(state.cards["b-1"])).toBe(true);
    expect(state.cards["b-2"]).toMatchObject({ zone: "ritiro", cardId: "RBF-050" });
  });

  it("chi apre lo decide il tavolo: la riga in chat lo legge dalla lavagna", async () => {
    const { session, table } = online("", 3);
    await vi.advanceTimersByTimeAsync(0);
    session.newGame();
    await vi.advanceTimersByTimeAsync(0);
    const line = session.state().chat.find(entry => entry.key === "log.newgame");
    expect(line?.params?.seat).toBe(session.state().active);
    expect(table.journal.at(0)?.action).toMatchObject({ t: "newGame", active: session.state().active });
  });

  it("il tavolo ripartito: un giornale vuoto a partita in corso avverte col sigillo (T21)", async () => {
    const { session, view, table } = online("stanza");
    await vi.advanceTimersByTimeAsync(0);
    const cards = Array.from({ length: 7 }, (_, i) => ({ uid: `a-${i + 1}`, cardId: "RBF-047", owner: "a" as const, zone: "deck" as const, order: i, face: 0, x: 0, y: 0, tapped: false, facedown: false, z: 0 }));
    table.push({ t: "journal", match: "m", actions: [
      { action: { t: "newGame", active: "a" }, from: null },
      { action: { t: "loadDeck", seat: "a", deckId: DECK.id, cards }, from: "a" },
      { action: { t: "draw", seat: "a", count: 6 }, from: "a" },
    ] });
    expect(zoneCards(session.state(), "a", "hand")).toHaveLength(6);
    expect(view.calls.some(call => call.startsWith("stop:"))).toBe(false);
    table.push({ t: "journal", match: "m2", actions: [{ action: { t: "newGame", active: "b" }, from: null }] });
    expect(view.calls.some(call => call.startsWith("stop:") && /ripartito/.test(call))).toBe(true);
    expect(Object.keys(session.state().cards)).toHaveLength(0);
  });

  it("uscire dalla stanza a partita in corso è una resa (§2): il tavolo riceve gameOver concede", async () => {
    const { session, table } = online("stanza");
    await vi.advanceTimersByTimeAsync(0);
    const cards = Array.from({ length: 3 }, (_, i) => ({ uid: `a-${i + 1}`, cardId: "RBF-047", owner: "a" as const, zone: "deck" as const, order: i, face: 0, x: 0, y: 0, tapped: false, facedown: false, z: 0 }));
    table.push({ t: "journal", match: "m", actions: [{ action: { t: "newGame", active: "a" }, from: null }, { action: { t: "loadDeck", seat: "a", deckId: DECK.id, cards }, from: "a" }] });
    session.leaveRoom();
    await vi.advanceTimersByTimeAsync(0);
    expect(table.judged.some(action => action.t === "gameOver" && action.reason === "concede" && action.winner === "b")).toBe(true);
    expect(session.room()).toBe("");
  });

  it("il token del posto si conserva per la stanza e torna nell'indirizzo", async () => {
    const { store } = online("stanza");
    await vi.advanceTimersByTimeAsync(0);
    expect(store.values["seat-token:stanza"]).toBe("c".repeat(32));
    expect(new URL(FakeWebSocket.instances.at(-1)!.url).searchParams.get("token")).toBeNull();
    FakeWebSocket.instances.at(-1)!.drop();
    await vi.advanceTimersByTimeAsync(500);
    expect(new URL(FakeWebSocket.instances.at(-1)!.url).searchParams.get("token")).toBe("c".repeat(32));
  });
});
