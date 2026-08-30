// Trasporto della stanza condivisa.
//
// Il relay è stupido di proposito: riceve un messaggio e lo ripete a tutti gli
// altri connessi alla stessa stanza. Nessuno stato sul server, nessuna
// autorità: i due client tengono ciascuno la propria copia della lavagna e la
// mantengono allineata rigiocando le stesse azioni.
//
// Quando un client entra manda "hello"; chi è già dentro risponde con lo stato
// completo. È l'unico momento in cui viaggia lo stato intero.

import type { NetMessage, Seat } from "./types.js";

export type NetStatus = "offline" | "connecting" | "online";

export interface NetHandlers {
  onMessage(message: NetMessage): void;
  onStatus(status: NetStatus, peers: number): void;
}

export interface Net {
  send(message: NetMessage): void;
  close(): void;
  status(): NetStatus;
}

/** Relay locale di sviluppo: `npm run relay` nella cartella simulatore. */
export const DEFAULT_RELAY = `ws://${location.hostname || "localhost"}:8787`;

export function connect(relayUrl: string, room: string, seat: Seat, handlers: NetHandlers): Net {
  let socket: WebSocket | null = null;
  let status: NetStatus = "offline";
  let peers = 0;
  let retry = 0;
  let closed = false;
  let timer: number | undefined;

  const setStatus = (next: NetStatus): void => {
    status = next;
    handlers.onStatus(next, peers);
  };

  const open = (): void => {
    if (closed) return;
    setStatus("connecting");
    const url = new URL(relayUrl);
    url.searchParams.set("room", room);
    url.searchParams.set("seat", seat);
    let next: WebSocket;
    try {
      next = new WebSocket(url.href);
    } catch {
      schedule();
      return;
    }
    socket = next;

    next.addEventListener("open", () => {
      retry = 0;
      setStatus("online");
      // Chiedi lo stato a chi è già nella stanza: se non c'è nessuno, nessuno
      // risponde e si resta con la propria lavagna.
      next.send(JSON.stringify({ t: "hello", from: seat } satisfies NetMessage));
    });

    next.addEventListener("message", event => {
      let payload: unknown;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!payload || typeof payload !== "object") return;
      // Il relay aggiunge una busta sua ("peers") che non fa parte del
      // protocollo di gioco: si legge qui e non arriva mai all'applicazione.
      const message = payload as NetMessage | { t: "peers"; peers: number };
      // Il relay annuncia quanti sono collegati: serve solo alla spia in alto.
      if (message.t === "peers") {
        peers = message.peers ?? 0;
        handlers.onStatus(status, peers);
        return;
      }
      handlers.onMessage(message);
    });

    const drop = (): void => {
      if (socket === next) socket = null;
      peers = 0;
      schedule();
    };
    next.addEventListener("close", drop);
    next.addEventListener("error", () => next.close());
  };

  function schedule(): void {
    if (closed) return;
    setStatus("offline");
    // Backoff fino a 8s: se il relay non c'è, non si martella la rete.
    retry = Math.min(retry + 1, 6);
    window.clearTimeout(timer);
    timer = window.setTimeout(open, Math.min(8000, 250 * 2 ** retry));
  }

  open();

  return {
    send(message) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    close() {
      closed = true;
      window.clearTimeout(timer);
      socket?.close();
      socket = null;
      setStatus("offline");
    },
    status: () => status,
  };
}
