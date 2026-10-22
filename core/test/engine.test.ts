// Il filo verso il tavolo (engine.ts): un WebSocket finto al posto di quello
// globale. Dal 2026-10-21 (audit RF-022, T24): ciò che aspetta il tavolo —
// giudizi, salvataggi, letture — cade col filo, senza aspettare il timer;
// il token del posto viaggia nell'indirizzo; i rifiuti del tavolo fermano
// la riconnessione quando è il caso.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectEngine, type EngineHandlers, type EngineVerdict } from "../src/engine.js";
import { FakeWebSocket } from "./fake-table.js";

function handlers(): EngineHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onStatus: (status, peers) => calls.push(`status:${status}:${peers}`),
    onWelcome: version => calls.push(`welcome:${version}`),
    onJournal: entries => calls.push(`journal:${entries.length}`),
    onAction: (action, from) => calls.push(`action:${action.t}:${from}`),
    onRtc: () => calls.push("rtc"),
    onSeat: (seat, token) => calls.push(`seat:${seat}:${token ?? ""}`),
    onRoomFull: room => calls.push(`roomFull:${room}`),
    onMatched: (room, seat) => calls.push(`matched:${room}:${seat}`),
    onMe: player => calls.push(`me:${player?.username ?? "null"}`),
    onRefused: (code, reason) => calls.push(`refused:${code}:${reason}`),
    onVerifySent: () => calls.push("verifySent"),
  };
}

function last(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error("nessun socket");
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("il filo", () => {
  it("apre il socket con stanza e posto, saluta all'apertura e annuncia lo stato", () => {
    const h = handlers();
    connectEngine("ws://tavolo:1/engine", "rubino-1", "b", h);
    const socket = last();
    const url = new URL(socket.url);
    expect(url.searchParams.get("room")).toBe("rubino-1");
    expect(url.searchParams.get("seat")).toBe("b");
    expect(url.searchParams.get("token")).toBeNull();
    expect(h.calls).toEqual(["status:connecting:0"]);
    socket.open();
    expect(h.calls).toContain("status:online:0");
    expect(socket.messages()).toEqual([{ t: "hello" }]);
  });

  it("il giudizio torna col verdetto per seq, e porta l'azione completata", () => {
    const h = handlers();
    const link = connectEngine("ws://tavolo:1", "", "a", h);
    const socket = last();
    socket.open();
    const verdicts: (EngineVerdict | null)[] = [];
    link.judge({ t: "roll", seat: "a", die: 6, for: "cost|a-1" }, "a", verdict => verdicts.push(verdict));
    link.judge({ t: "say", entry: { id: "x", seat: null, kind: "log", text: "", ts: 0 } }, "a", verdict => verdicts.push(verdict));
    const sent = socket.messages();
    expect(sent[1]).toMatchObject({ t: "judge", seq: 1, actor: "a" });
    expect(sent[2]).toMatchObject({ t: "judge", seq: 2 });
    socket.message({ t: "verdict", seq: 2, action: "say", ok: true, ruled: false });
    socket.message({ t: "verdict", seq: 1, action: "roll", ok: true, ruled: true, applied: { t: "roll", seat: "a", die: 6, for: "cost|a-1", value: 4 } });
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0]).toMatchObject({ seq: 2, ok: true });
    expect(verdicts[1]).toMatchObject({ seq: 1, applied: { value: 4 } });
  });

  it("un arbitro muto vale null dopo 4 secondi, e subito quando il filo non c'è", () => {
    const h = handlers();
    const link = connectEngine("ws://tavolo:1", "", "a", h);
    const verdicts: (EngineVerdict | null)[] = [];
    link.judge({ t: "say", entry: { id: "x", seat: null, kind: "log", text: "", ts: 0 } }, "a", verdict => verdicts.push(verdict));
    expect(verdicts).toEqual([null]);
    last().open();
    link.judge({ t: "say", entry: { id: "x", seat: null, kind: "log", text: "", ts: 0 } }, "a", verdict => verdicts.push(verdict));
    vi.advanceTimersByTime(3999);
    expect(verdicts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(verdicts).toEqual([null, null]);
  });

  it("il filo che cade risolve giudizi, salvataggi e letture appesi, e cancella i loro timer (T24)", async () => {
    const h = handlers();
    const link = connectEngine("ws://tavolo:1", "", "a", h);
    const socket = last();
    socket.open();
    const verdicts: (EngineVerdict | null)[] = [];
    link.judge({ t: "say", entry: { id: "x", seat: null, kind: "log", text: "", ts: 0 } }, "a", verdict => verdicts.push(verdict));
    const saved = link.save("seen:x", { a: 1 });
    const loaded = link.load("seen:x");
    const before = vi.getTimerCount();
    expect(before).toBeGreaterThanOrEqual(3);
    socket.drop();
    expect(verdicts).toEqual([null]);
    await expect(saved).resolves.toBe(false);
    await expect(loaded).resolves.toBeNull();
    // Resta solo il timer della riconnessione: quelli delle attese sono cancellati.
    expect(vi.getTimerCount()).toBe(1);
    expect(h.calls.at(-1)).toBe("status:offline:0");
  });

  it("i salvataggi e le letture tornano con la risposta del tavolo, o col timer", async () => {
    const h = handlers();
    const link = connectEngine("ws://tavolo:1", "", "a", h);
    const socket = last();
    socket.open();
    const saved = link.save("k", 1);
    const loaded = link.load("k");
    socket.message({ t: "saved", seq: 1, key: "k", ok: true });
    socket.message({ t: "data", seq: 2, key: "k", value: { v: 2 } });
    await expect(saved).resolves.toBe(true);
    await expect(loaded).resolves.toEqual({ v: 2 });
    const late = link.save("k", 1);
    vi.advanceTimersByTime(4000);
    await expect(late).resolves.toBe(false);
  });

  it("la riconnessione ha il backoff fino a 8 secondi, e riparte da capo dopo un'apertura", () => {
    const h = handlers();
    connectEngine("ws://tavolo:1", "", "a", h);
    last().drop();
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(499);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    last().drop();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(3);
    for (let i = 0; i < 6; i += 1) {
      last().drop();
      vi.advanceTimersByTime(8000);
    }
    const count = FakeWebSocket.instances.length;
    last().drop();
    vi.advanceTimersByTime(7999);
    expect(FakeWebSocket.instances).toHaveLength(count);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(count + 1);
    last().open();
    last().drop();
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(count + 2);
  });

  it("room_full ferma la riconnessione", () => {
    const h = handlers();
    connectEngine("ws://tavolo:1", "stanza", "a", h);
    const socket = last();
    socket.open();
    socket.message({ t: "room_full", room: "stanza" });
    expect(h.calls).toContain("roomFull:stanza");
    socket.drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("refused rooms_full e replaced fermano la riconnessione, gli altri rifiuti no", () => {
    const h = handlers();
    connectEngine("ws://tavolo:1", "stanza", "a", h);
    const socket = last();
    socket.open();
    socket.message({ t: "refused", code: "other", reason: "boh", reason_en: "meh" });
    expect(h.calls).toContain("refused:other:boh");
    socket.drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    last().open();
    last().message({ t: "refused", code: "replaced", reason: "altra scheda", reason_en: "other tab" });
    expect(h.calls).toContain("refused:replaced:altra scheda");
    last().drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("il token del posto arriva col seat e va nell'indirizzo della riconnessione", () => {
    const h = handlers();
    const link = connectEngine("ws://tavolo:1", "stanza", "a", h, { token: "a".repeat(32) });
    expect(new URL(last().url).searchParams.get("token")).toBe("a".repeat(32));
    last().open();
    last().message({ t: "seat", seat: "a", token: "b".repeat(32), resumed: true });
    expect(h.calls).toContain(`seat:a:${"b".repeat(32)}`);
    expect(link.seatToken()).toBe("b".repeat(32));
    last().drop();
    vi.advanceTimersByTime(500);
    expect(new URL(last().url).searchParams.get("token")).toBe("b".repeat(32));
  });

  it("le azioni del tavolo arrivano con from null; peers, giornale e verify_sent passano", () => {
    const h = handlers();
    connectEngine("ws://tavolo:1", "stanza", "a", h);
    last().open();
    last().message({ t: "action", action: { t: "gameOver", winner: "a", reason: "forfeit" }, from: null });
    last().message({ t: "peers", peers: 2, seats: ["a", "b"] });
    last().message({ t: "journal", match: "m", actions: [{ action: { t: "newGame", active: "a" }, from: null }] });
    last().message({ t: "verify_sent" });
    expect(h.calls).toContain("action:gameOver:null");
    expect(h.calls).toContain("status:online:2");
    expect(h.calls).toContain("journal:1");
    expect(h.calls).toContain("verifySent");
  });

  it("close risolve le attese e non riapre più", async () => {
    const h = handlers();
    const link = connectEngine("ws://tavolo:1", "", "a", h);
    last().open();
    const saved = link.save("k", 1);
    link.close();
    await expect(saved).resolves.toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(link.status()).toBe("offline");
  });
});
