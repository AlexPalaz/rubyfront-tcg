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

import type { Loadout, Outcome, PlayerProgress } from "./progression.js";
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
  /** Il posto assegnato dal tavolo all'ingresso (2026-09-23): può non essere quello chiesto. */
  onSeat(seat: Seat): void;
  /** La stanza ha già due giocatori: il tavolo ha chiuso. */
  onRoomFull(room: string): void;
  /** L'atrio ha trovato l'avversario (2026-09-23): ci si sposta in quella stanza, a quel posto. */
  onMatched(room: string, seat: Seat): void;
  /** L'utenza (2026-09-20): chi sono per il tavolo dopo un accesso, o null col motivo del rifiuto; `token` è la sessione da conservare (2026-09-22). */
  onMe(player: Player | null, reason?: string, token?: string): void;
  /** Una mail confermata da un link aperto senza essere seduti come quel giocatore (2026-09-22). */
  onVerified?(username: string): void;
  /** La progressione di un Rubyfront aggiornata (2026-09-23), o rifiutata col motivo. */
  onProgress?(update: ProgressUpdate): void;
  onProgressRefused?(card: string, reason: string): void;
}

/** Un giocatore per il tavolo (2026-09-22): l'account con nome utente unico e nome pubblico, gli accessi collegati, i mazzi. */
export interface Player {
  id: number;
  /** Il nome utente, unico e immutabile (minuscolo). */
  username: string;
  /** Il nome pubblico, che si cambia dalle impostazioni. */
  name: string;
  email: string | null;
  /** La mail è confermata. */
  verified: boolean;
  /** Gli accessi collegati: «dev», «google», domani «steam». */
  providers: string[];
  /** I mazzi assegnati all'account (2026-09-20): gli id del catalogo. */
  decks: string[];
  /** Le gemme rubino (2026-09-22), la moneta del negozio: il tavolo non le manda ancora, vale zero. */
  gems?: number;
  /** La progressione per Rubyfront (2026-09-23): esperienza, livello, abilità montate. */
  rubyfronts?: PlayerProgress[];
  /** Account di prova (2026-09-24): al tavolo ha gli strumenti di prova. Lo dice il tavolo. */
  tester?: boolean;
}

/** L'aggiornamento di una progressione dal tavolo (2026-09-23): dopo un `loadout` o a fine partita (con `gained`). */
export interface ProgressUpdate extends PlayerProgress {
  gained?: number;
  outcome?: Outcome;
}

/** Le credenziali di un accesso (2026-09-22). */
export type Credentials =
  | { provider: "password"; login: string; password: string }
  | { provider: "google"; idToken: string };

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
  /** L'atrio (2026-09-23): in fila per un avversario qualunque; la risposta arriva in `onMatched`. Solo dalla stanza «solo». */
  match(): boolean;
  matchCancel(): boolean;
  /** L'accesso alla memoria del tavolo: la risposta arriva in `onMe`. `false` se il filo non c'è. */
  login(credentials: Credentials): boolean;
  /** La registrazione con nome utente, email e password (2026-09-22): la risposta in `onMe`, con la sessione. */
  register(username: string, email: string, password: string, name: string): boolean;
  /** La sessione salvata: si riprende senza credenziali. */
  resume(token: string): boolean;
  /** La conferma della mail dal link. */
  verify(token: string): boolean;
  /** Il nome pubblico nuovo. */
  setProfile(name: string): boolean;
  /** Le abilità montate su un Rubyfront (2026-09-23): la risposta in `onProgress`. */
  setLoadout(card: string, loadout: Loadout): boolean;
  logout(): boolean;
  /** Un dato del giocatore nella memoria del tavolo: vero se salvato. */
  save(key: string, value: unknown): Promise<boolean>;
  /** Un dato del giocatore, o null se non c'è (o senza accesso, o filo assente). */
  load(key: string): Promise<unknown>;
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
export const PRODUCTION_ENGINE = "wss://rubyfront.onrender.com/engine";

/**
 * L'indirizzo di default per una pagina: quello di produzione se la pagina è
 * in https, il tavolo di fianco (porta 8788) altrimenti. `override` (la
 * variabile VITE_ENGINE_URL al build) vince su tutto. La pagina la passa
 * chi ce l'ha: il core non conosce `location`.
 */
export function defaultEngineUrl(page: { protocol: string; hostname: string }, override?: string): string {
  return override || (page.protocol === "https:" ? PRODUCTION_ENGINE : `ws://${page.hostname || "localhost"}:8788`);
}

export function connectEngine(engineUrl: string, room: string, seat: Seat, handlers: EngineHandlers): EngineLink {
  let socket: WebSocket | null = null;
  let status: EngineStatus = "offline";
  let peers = 0;
  let retry = 0;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  /** I giudizi in attesa di verdetto, per seq. Il timer è l'arbitro muto. */
  const pending = new Map<number, { verdict: (verdict: EngineVerdict | null) => void; timer: ReturnType<typeof setTimeout> }>();

  const settle = (id: number, verdict: EngineVerdict | null): void => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
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
      const message = payload as
        | NetMessage
        | EngineVerdict
        | { t: "engine"; version?: string; rules?: string[]; rules_en?: string[] }
        | { t: "me"; player: Player | null; reason?: string; reason_en?: string; token?: string }
        | { t: "verified"; username: string }
        | { t: "progress"; card: string; ok?: boolean; reason?: string; reason_en?: string; xp?: number; level?: number; loadout?: Loadout; gained?: number; outcome?: Outcome }
        | { t: "saved"; seq?: number; key: string; ok: boolean }
        | { t: "data"; seq?: number; key: string; value: unknown };
      switch (message.t) {
        case "me":
          handlers.onMe(message.player ?? null, lang() === "en" ? (message.reason_en ?? message.reason) : message.reason, message.token);
          return;
        case "verified":
          handlers.onVerified?.(message.username);
          return;
        case "progress":
          if (message.ok === false) handlers.onProgressRefused?.(message.card, (lang() === "en" ? message.reason_en : message.reason) ?? message.reason ?? "");
          else handlers.onProgress?.({ card: message.card, xp: message.xp ?? 0, level: message.level ?? 1, loadout: message.loadout ?? { rubyfront: [], nexus: [] }, ...(message.gained !== undefined ? { gained: message.gained } : {}), ...(message.outcome ? { outcome: message.outcome } : {}) });
          return;
        case "saved": {
          const waiting = message.seq !== undefined ? stored.get(message.seq) : undefined;
          if (message.seq !== undefined) stored.delete(message.seq);
          waiting?.(message.ok === true);
          return;
        }
        case "data": {
          const waiting = message.seq !== undefined ? loaded.get(message.seq) : undefined;
          if (message.seq !== undefined) loaded.delete(message.seq);
          waiting?.(message.value ?? null);
          return;
        }
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
        case "seat":
          handlers.onSeat(message.seat);
          return;
        case "room_full":
          // Il tavolo chiude subito dopo: non si riprova, la stanza è di altri due.
          closed = true;
          handlers.onRoomFull(message.room ?? room);
          return;
        case "matched":
          handlers.onMatched(message.room, message.seat);
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
    clearTimeout(timer);
    timer = setTimeout(open, Math.min(8000, 250 * 2 ** retry));
  }

  open();

  /** Le risposte attese ai salvataggi e alle letture, per numero. */
  const stored = new Map<number, (ok: boolean) => void>();
  const loaded = new Map<number, (value: unknown) => void>();
  let dataSeq = 0;

  return {
    login(credentials) {
      return send({ t: "login", ...credentials });
    },
    register(username, email, password, name) {
      return send({ t: "register", username, email, password, name });
    },
    resume(token) {
      return send({ t: "resume", token });
    },
    verify(token) {
      return send({ t: "verify", token });
    },
    setProfile(name) {
      return send({ t: "profile", name });
    },
    setLoadout(card, loadout) {
      return send({ t: "loadout", card, loadout });
    },
    logout() {
      return send({ t: "logout" });
    },
    save(key, value) {
      dataSeq += 1;
      const id = dataSeq;
      if (!send({ t: "save", seq: id, key, value })) return Promise.resolve(false);
      return new Promise(resolve => {
        stored.set(id, resolve);
        setTimeout(() => {
          if (stored.delete(id)) resolve(false);
        }, JUDGE_TIMEOUT_MS);
      });
    },
    load(key) {
      dataSeq += 1;
      const id = dataSeq;
      if (!send({ t: "load", seq: id, key })) return Promise.resolve(null);
      return new Promise(resolve => {
        loaded.set(id, resolve);
        setTimeout(() => {
          if (loaded.delete(id)) resolve(null);
        }, JUDGE_TIMEOUT_MS);
      });
    },
    judge(action, actor, verdict) {
      seq += 1;
      const id = seq;
      if (!send({ t: "judge", seq: id, action, actor })) {
        verdict(null);
        return;
      }
      pending.set(id, {
        verdict,
        timer: setTimeout(() => settle(id, null), JUDGE_TIMEOUT_MS),
      });
    },
    snapshot(state) {
      send({ t: "snapshot", state });
    },
    hello() {
      send({ t: "hello" });
    },
    match() {
      return send({ t: "match" });
    },
    matchCancel() {
      return send({ t: "match_cancel" });
    },
    sendRtc(payload) {
      return send({ t: "rtc", payload });
    },
    close() {
      closed = true;
      clearTimeout(timer);
      for (const id of [...pending.keys()]) settle(id, null);
      socket?.close();
      socket = null;
      setStatus("offline");
    },
    status: () => status,
  };
}
