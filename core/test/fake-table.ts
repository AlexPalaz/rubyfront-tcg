// Un tavolo finto per le prove del filo e della sessione (2026-10-21): un
// WebSocket finto da mettere al posto di quello globale, e un tavolo che
// risponde come farebbe la stanza (room.rb) — saluto, giornale, verdetti
// con l'azione completata (`applied`: il dado, gli ordini, chi apre) e le
// azioni dell'avversario spinte a mano. Niente rete.

import type { EngineVerdict } from "../src/engine.js";
import { apply, newGame, zoneCards } from "../src/state.js";
import type { Action, GameState, JournalEntry, Seat } from "../src/types.js";

type Listener = (event: { data?: string }) => void;

export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  /** Chiamato a ogni socket nuovo: il tavolo finto si aggancia qui. */
  static onCreate: ((socket: FakeWebSocket) => void) | null = null;

  readyState = FakeWebSocket.CONNECTING;
  readonly url: string;
  readonly sent: string[] = [];
  onSend: ((message: Record<string, unknown>) => void) | null = null;
  private readonly listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    FakeWebSocket.onCreate?.(this);
  }

  static reset(): void {
    FakeWebSocket.instances = [];
    FakeWebSocket.onCreate = null;
  }

  addEventListener(type: string, listener: Listener): void {
    (this.listeners[type] ??= []).push(listener);
  }

  send(data: string): void {
    this.sent.push(data);
    this.onSend?.(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  // ---- i ganci delle prove

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", {});
  }

  message(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  /** Il filo cade (il tavolo riavviato, la rete): come `close`, ma dal lato del tavolo. */
  drop(): void {
    this.close();
  }

  error(): void {
    this.emit("error", {});
  }

  /** I messaggi mandati, già letti. */
  messages(): Record<string, unknown>[] {
    return this.sent.map(text => JSON.parse(text) as Record<string, unknown>);
  }

  private emit(type: string, event: { data?: string }): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
}

/** Un generatore a seme (mulberry32), come nelle prove dal vivo. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWith<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export interface FakeTableOptions {
  seed?: number;
  /** Il verdetto per un'azione: `null` = sì; un oggetto = il rifiuto (reason). */
  refuse?: (action: Action) => string | null;
  /** Chi apre, per il newGame del tavolo. */
  starter?: Seat;
  /** Il token del posto che il tavolo assegna. */
  token?: string;
}

export interface FakeTable {
  /** La copia del tavolo (dal giornale). */
  state(): GameState;
  journal: JournalEntry[];
  /** L'ultimo socket aperto. */
  socket(): FakeWebSocket | null;
  /** Un'azione dell'avversario (già approvata) spinta al client, nella sua vista. */
  pushAction(action: Action, from: Seat | null): void;
  /** Un messaggio qualunque spinto al client. */
  push(message: unknown): void;
  /** Il gemello di Room#complete: l'azione completata dal tavolo. */
  complete(action: Action): Action;
  /** Quante richieste di giudizio sono arrivate. */
  judged: Action[];
}

/**
 * Il tavolo finto: si aggancia a ogni socket nuovo, lo apre al prossimo
 * giro del timer (così i gestori sono già attaccati), risponde a `hello` con
 * saluto (e giornale, in stanza), e ai `judge` con un verdetto che porta
 * l'azione completata — come la stanza vera, col caso a seme.
 */
export function fakeTable(room: string, options: FakeTableOptions = {}): FakeTable {
  const random = seeded(options.seed ?? 7);
  const starter: Seat = options.starter ?? "a";
  const journal: JournalEntry[] = [];
  let state = newGame(starter);
  let current: FakeWebSocket | null = null;
  const judged: Action[] = [];
  if (room) journal.push({ action: { t: "newGame", active: starter }, from: null });

  const complete = (action: Action): Action => {
    switch (action.t) {
      case "roll": {
        if (action.value !== undefined) return action;
        const known = state.rolls?.[action.for];
        const value = known && known.die === action.die ? known.value : 1 + Math.floor(random() * action.die);
        return { ...action, value };
      }
      case "shuffle":
        return { ...action, order: shuffleWith(zoneCards(state, action.seat, "deck").map(card => card.uid), random) };
      case "mulligan":
        return { ...action, order: shuffleWith([...zoneCards(state, action.seat, "hand"), ...zoneCards(state, action.seat, "deck")].map(card => card.uid), random) };
      case "loadDeck": {
        const deck = shuffleWith(action.cards.filter(card => card.zone === "deck"), random);
        const positions = new Map(deck.map((card, index) => [card.uid, index]));
        return { ...action, cards: action.cards.map(card => (positions.has(card.uid) ? { ...card, order: positions.get(card.uid) } : card)) };
      }
      case "newGame":
        return { ...action, active: random() < 0.5 ? "a" : "b" };
      default:
        return action;
    }
  };

  const handle = (socket: FakeWebSocket, message: Record<string, unknown>): void => {
    switch (message.t) {
      case "hello":
        socket.message({ t: "engine", version: "fake", rules: [], rules_en: [] });
        if (room) socket.message({ t: "journal", match: "m-1", actions: journal });
        return;
      case "judge": {
        const given = message.action as Action;
        const seq = message.seq as number;
        judged.push(given);
        const reason = options.refuse?.(given) ?? null;
        if (reason) {
          socket.message({ t: "verdict", seq, action: given.t, ok: false, ruled: true, reason, reason_en: reason });
          return;
        }
        const applied = complete(given);
        if (applied.t === "newGame") {
          journal.length = 0;
          state = newGame(applied.active);
        } else {
          state = apply(state, applied);
        }
        journal.push({ action: applied, from: "a" });
        const verdict: EngineVerdict = { t: "verdict", seq, action: given.t, ok: true, ruled: true, ...(applied !== given ? { applied } : {}) };
        socket.message(verdict);
        return;
      }
      default:
        return;
    }
  };

  FakeWebSocket.onCreate = socket => {
    current = socket;
    // La risposta arriva DOPO l'invio (come dalla rete): chi manda ha il
    // tempo di annotare l'attesa prima del verdetto.
    socket.onSend = message => queueMicrotask(() => handle(socket, message));
    setTimeout(() => {
      if (socket.readyState !== FakeWebSocket.CLOSED) {
        socket.open();
        socket.message({ t: "seat", seat: new URL(socket.url).searchParams.get("seat") ?? "a", token: options.token ?? "f".repeat(32) });
      }
    }, 0);
  };

  return {
    state: () => state,
    journal,
    socket: () => current,
    pushAction(action, from) {
      current?.message({ t: "action", action, from });
    },
    push(message) {
      current?.message(message);
    },
    complete,
    judged,
  };
}
