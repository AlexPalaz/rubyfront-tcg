// Il filo verso l'engine Ruby (engine/ alla radice del repo).
//
// L'engine è l'arbitro, e fa il poliziotto: le azioni LOCALI passano da
// `judge` — si applicano solo col suo benestare, e un `ruled: true, ok: false`
// le ferma (main.ts mostra l'avviso). Le azioni dell'avversario arrivano già
// applicate dal suo client: a quelle resta `consult`, l'occhiata senza
// attesa. Le regole crescono una alla volta (engine/README.md): per tutto il
// resto l'engine risponde `ruled: false` e non si mette in mezzo.
//
// Stesso scheletro di net.ts: riconnessione con backoff, saluto all'apertura.
// Niente coda di messaggi in attesa: se l'engine è scollegato il tavolo resta
// libero come a flag spento — un arbitro assente non ferma la partita. Per lo
// stesso motivo `judge` ha un tempo massimo: un verdetto che non arriva vale
// via libera.

import type { Action, GameState } from "./types.js";

export type EngineStatus = "offline" | "connecting" | "online";

export interface EngineVerdict {
  t: "verdict";
  seq?: number;
  /** Il tipo dell'azione giudicata (Action["t"]): per riconoscersi nei log. */
  action?: string;
  ok: boolean;
  /** `false`: l'engine non ha una regola per questa azione. */
  ruled: boolean;
  reason?: string;
}

export interface EngineHandlers {
  onStatus(status: EngineStatus): void;
  onWelcome(version: string, rules: string[]): void;
  onVerdict(verdict: EngineVerdict): void;
}

export interface EngineLink {
  /** Occhiata senza attesa: per le azioni già applicate (quelle dell'avversario).
      L'engine le applica comunque alla sua copia del tavolo. */
  consult(action: Action): void;
  /**
   * Il giudizio che precede l'azione: `verdict` arriva alla risposta
   * dell'engine, `null` se l'engine tace oltre il tempo massimo o è
   * scollegato — e un arbitro muto vale via libera. L'engine applica
   * l'azione alla sua copia solo se il verdetto la lascia passare.
   */
  judge(action: Action, verdict: (verdict: EngineVerdict | null) => void): void;
  /** Lo stato intero: allinea la copia del tavolo dell'engine alla lavagna. */
  snapshot(state: GameState): void;
  close(): void;
  status(): EngineStatus;
}

/** Oltre quest'attesa il verdetto vale via libera: l'engine non ferma il tavolo. */
const JUDGE_TIMEOUT_MS = 1500;

/** L'engine gira di fianco al client: `ruby engine/bin/server`, porta 8788. */
export const DEFAULT_ENGINE = `ws://${location.hostname || "localhost"}:8788`;

export function connectEngine(engineUrl: string, handlers: EngineHandlers): EngineLink {
  let socket: WebSocket | null = null;
  let status: EngineStatus = "offline";
  let retry = 0;
  let closed = false;
  let timer: number | undefined;
  let seq = 0;
  /** I giudizi in attesa di verdetto, per seq. Il timer è la via libera. */
  const pending = new Map<number, { verdict: (verdict: EngineVerdict | null) => void; timer: number }>();

  const settle = (id: number, verdict: EngineVerdict | null): void => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    window.clearTimeout(entry.timer);
    entry.verdict(verdict);
  };

  const setStatus = (next: EngineStatus): void => {
    status = next;
    handlers.onStatus(next);
  };

  const open = (): void => {
    if (closed) return;
    setStatus("connecting");
    let next: WebSocket;
    try {
      next = new WebSocket(engineUrl);
    } catch {
      schedule();
      return;
    }
    socket = next;

    next.addEventListener("open", () => {
      retry = 0;
      setStatus("online");
      next.send(JSON.stringify({ t: "hello" }));
    });

    next.addEventListener("message", event => {
      let payload: unknown;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!payload || typeof payload !== "object") return;
      const message = payload as { t?: string };
      if (message.t === "engine") {
        const welcome = message as { version?: string; rules?: string[] };
        handlers.onWelcome(welcome.version ?? "?", welcome.rules ?? []);
        return;
      }
      if (message.t === "verdict") {
        const verdict = message as EngineVerdict;
        // Un verdetto atteso chiude il suo giudizio; gli altri (le occhiate
        // di consult) vanno al gestore.
        if (verdict.seq !== undefined && pending.has(verdict.seq)) settle(verdict.seq, verdict);
        else handlers.onVerdict(verdict);
      }
    });

    const drop = (): void => {
      if (socket === next) socket = null;
      // Il filo è caduto: i giudizi appesi non avranno risposta — via libera
      // subito, senza aspettare i timeout.
      for (const id of [...pending.keys()]) settle(id, null);
      schedule();
    };
    next.addEventListener("close", drop);
    next.addEventListener("error", () => next.close());
  };

  function schedule(): void {
    if (closed) return;
    setStatus("offline");
    retry = Math.min(retry + 1, 6);
    window.clearTimeout(timer);
    timer = window.setTimeout(open, Math.min(8000, 250 * 2 ** retry));
  }

  open();

  return {
    consult(action) {
      if (socket?.readyState !== WebSocket.OPEN) return;
      seq += 1;
      socket.send(JSON.stringify({ t: "consult", seq, action }));
    },
    judge(action, verdict) {
      if (socket?.readyState !== WebSocket.OPEN) {
        verdict(null);
        return;
      }
      seq += 1;
      const id = seq;
      pending.set(id, {
        verdict,
        timer: window.setTimeout(() => settle(id, null), JUDGE_TIMEOUT_MS),
      });
      socket.send(JSON.stringify({ t: "judge", seq: id, action }));
    },
    snapshot(state) {
      if (socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ t: "snapshot", state }));
    },
    close() {
      closed = true;
      window.clearTimeout(timer);
      for (const id of [...pending.keys()]) settle(id, null);
      socket?.close();
      socket = null;
      setStatus("offline");
    },
    status: () => status,
  };
}
