// Il filo verso il tavolo (engine/bin/server, Ruby): UN canale solo, per
// l'arbitro e per l'avversario insieme.
//
// L'engine è l'unico a scrivere lo stato (deciso 2026-09-11). Ogni azione
// parte come richiesta di giudizio (`judge`) e si applica qui solo col
// verdetto; se passa, il tavolo la inoltra all'altro client come `action`,
// e lui applica quella — mai ciò che noi diciamo di aver fatto. Chi entra
// in una stanza riceve il giornale delle azioni approvate e ricostruisce la
// lavagna da lì. Nella stanza «solo» (nessun nome: partita locale o col
// bot) il tavolo si comporta come prima: accetta lo snapshot del client e
// non manda giornale.
//
// Stesso scheletro di sempre: riconnessione con backoff, saluto
// all'apertura. Niente coda di messaggi in attesa: scollegato, un `judge`
// risponde `null` subito — e cosa vale un arbitro muto lo decide chi chiama
// (main.ts, dispatch: via libera nella «solo», fermata in stanza).

import { lang } from "./i18n.js";
import type { Action, GameState, JournalEntry, NetMessage, Seat } from "./types.js";

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
  /** Lo stesso motivo in inglese: il client mostra quello della lingua del tavolo. */
  reason_en?: string;
}

/** Il motivo nella lingua del tavolo (l'italiano è il ripiego: è la lingua del manuale). */
export function verdictReason(verdict: EngineVerdict): string | undefined {
  return lang() === "en" ? (verdict.reason_en ?? verdict.reason) : verdict.reason;
}

export interface EngineHandlers {
  /** Il filo: com'è, e quanti sono seduti nella stanza (1 nella «solo»). */
  onStatus(status: EngineStatus, peers: number): void;
  onWelcome(version: string, rules: string[]): void;
  /** Il giornale della stanza (solo con nome): la lavagna si ricostruisce da qui. */
  onJournal(entries: JournalEntry[]): void;
  /** Un'azione dell'avversario, già approvata dal tavolo. */
  onAction(action: Action, from: Seat): void;
  /** La segnalazione WebRTC della chat vocale (voice.ts). */
  onRtc(payload: unknown, from: Seat): void;
  /** Il posto chiesto è già occupato nella stanza: il tavolo ha chiuso. */
  onSeatTaken(): void;
}

export interface EngineLink {
  /**
   * Il giudizio che precede l'azione: `verdict` arriva alla risposta del
   * tavolo, `null` se il tavolo tace oltre il tempo massimo o è scollegato.
   * `actor` è il posto di chi compie il gesto: in stanza il tavolo lo
   * ignora e usa il posto del client (nessuno agisce per l'altro).
   */
  judge(action: Action, actor: Seat, verdict: (verdict: EngineVerdict | null) => void): void;
  /** Lo stato intero: allinea la copia del tavolo. Vale solo nella stanza «solo». */
  snapshot(state: GameState): void;
  /** Chiede di nuovo saluto e giornale: la lavagna si riallinea dal tavolo. */
  hello(): void;
  /** La chat vocale: `false` se il filo non c'è. */
  sendRtc(payload: unknown): boolean;
  close(): void;
  status(): EngineStatus;
}

/** Oltre quest'attesa il verdetto vale `null`: un arbitro muto. */
const JUDGE_TIMEOUT_MS = 4000;

/**
 * Il tavolo gira di fianco al client in sviluppo (`ruby engine/bin/server`,
 * porta 8788); in produzione (la pagina in https) sta su Render
 * (render.yaml, `scripts/server.mjs`): se Render assegna un nome diverso,
 * questo è il posto da aggiornare. Piano free: dorme, e la prima
 * connessione lo sveglia — la spia resta rossa una trentina di secondi,
 * poi la riconnessione automatica lo aggancia.
 */
export const DEFAULT_ENGINE =
  (import.meta.env.VITE_ENGINE_URL as string | undefined) ||
  (location.protocol === "https:" ? "wss://rubyfront.onrender.com/engine" : `ws://${location.hostname || "localhost"}:8788`);

export function connectEngine(engineUrl: string, room: string, seat: Seat, handlers: EngineHandlers): EngineLink {
  let socket: WebSocket | null = null;
  let status: EngineStatus = "offline";
  let peers = 0;
  let retry = 0;
  let closed = false;
  let timer: number | undefined;
  let seq = 0;
  /** I giudizi in attesa di verdetto, per seq. Il timer è l'arbitro muto. */
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
    handlers.onStatus(next, peers);
  };

  const send = (payload: unknown): boolean => {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  };

  const open = (): void => {
    if (closed) return;
    setStatus("connecting");
    let next: WebSocket;
    try {
      const url = new URL(engineUrl);
      url.searchParams.set("room", room);
      url.searchParams.set("seat", seat);
      next = new WebSocket(url.href);
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
      const message = payload as NetMessage | EngineVerdict | { t: "engine"; version?: string; rules?: string[]; rules_en?: string[] };
      switch (message.t) {
        case "engine": {
          // Le regole nella lingua del tavolo (l'italiano è il ripiego).
          const rules = lang() === "en" ? (message.rules_en ?? message.rules) : message.rules;
          handlers.onWelcome(message.version ?? "?", rules ?? []);
          return;
        }
        case "verdict":
          if (message.seq !== undefined) settle(message.seq, message);
          return;
        case "journal":
          handlers.onJournal(Array.isArray(message.actions) ? message.actions : []);
          return;
        case "action":
          handlers.onAction(message.action, message.from);
          return;
        case "rtc":
          handlers.onRtc(message.payload, message.from);
          return;
        case "peers":
          // Il tavolo annuncia quanti sono seduti: serve alla spia e all'attesa dell'altro.
          peers = message.peers ?? 0;
          handlers.onStatus(status, peers);
          return;
        case "seat_taken":
          // Il tavolo chiude subito dopo: non si riprova, il posto è di un altro.
          closed = true;
          handlers.onSeatTaken();
          return;
        default:
          return;
      }
    });

    const drop = (): void => {
      if (socket === next) socket = null;
      peers = 0;
      // Il filo è caduto: i giudizi appesi non avranno risposta — si
      // chiudono subito come arbitro muto, senza aspettare i timeout.
      for (const id of [...pending.keys()]) settle(id, null);
      schedule();
    };
    next.addEventListener("close", drop);
    next.addEventListener("error", () => next.close());
  };

  function schedule(): void {
    if (closed) {
      setStatus("offline");
      return;
    }
    setStatus("offline");
    // Backoff fino a 8s: se il tavolo non c'è, non si martella la rete.
    retry = Math.min(retry + 1, 6);
    window.clearTimeout(timer);
    timer = window.setTimeout(open, Math.min(8000, 250 * 2 ** retry));
  }

  open();

  return {
    judge(action, actor, verdict) {
      seq += 1;
      const id = seq;
      if (!send({ t: "judge", seq: id, action, actor })) {
        verdict(null);
        return;
      }
      pending.set(id, {
        verdict,
        timer: window.setTimeout(() => settle(id, null), JUDGE_TIMEOUT_MS),
      });
    },
    snapshot(state) {
      send({ t: "snapshot", state });
    },
    hello() {
      send({ t: "hello" });
    },
    sendRtc(payload) {
      return send({ t: "rtc", payload });
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
