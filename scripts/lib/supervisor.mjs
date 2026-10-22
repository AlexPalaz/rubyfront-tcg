// Il supervisore del processo figlio (il tavolo Ruby) e la sonda di
// prontezza (2026-10-21, audit RF-020/RF-021), puri: niente processi veri
// qui dentro — chi li avvia (`spawnChild`), l'orologio e i timer sono
// iniettati, così le prove li fingono.

import { request as httpRequest } from "node:http";

/** Il ritardo fra un'uscita e il riavvio: raddoppia da 2 s fino a 60 s, con un ±20 % di caso. */
export const BACKOFF = { baseMs: 2000, capMs: 60_000, jitter: 0.2, stableMs: 30_000 };

/**
 * Il ritardo del tentativo `attempt` (1 = il primo riavvio): esponenziale
 * col tetto, poi il caso attorno (così due servizi non ripartono in coro).
 */
export function backoffMs(attempt, { baseMs, capMs, jitter, random = Math.random } = BACKOFF) {
  const raw = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const spread = 1 - jitter + 2 * jitter * random();
  return Math.round(raw * spread);
}

/**
 * Il supervisore: avvia il figlio, lo riavvia quando esce con un ritardo
 * crescente (i fallimenti consecutivi contano; una corsa stabile oltre
 * `stableMs` li azzera), si ferma con `stop`.
 *
 *   spawnChild() → { on(event, listener), kill?() }   (un ChildProcess, o un finto)
 */
export function createSupervisor({ spawnChild, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now, log = console.log, backoff = BACKOFF }) {
  let child = null;
  let starts = 0;
  let consecutiveFailures = 0;
  let lastExitCode = null;
  let nextRestartMs = null;
  let startedAt = 0;
  let stopped = false;
  let timer = null;

  function start() {
    if (stopped) return;
    starts += 1;
    startedAt = now();
    nextRestartMs = null;
    child = spawnChild();
    child.on("exit", code => {
      if (child === null) return;
      child = null;
      lastExitCode = code;
      if (stopped) return;
      // Una corsa lunga è una corsa buona: il conto dei fallimenti riparte.
      if (now() - startedAt >= backoff.stableMs) consecutiveFailures = 0;
      consecutiveFailures += 1;
      nextRestartMs = backoffMs(consecutiveFailures, backoff);
      log(`[engine] uscito (${code}); riparte fra ${Math.round(nextRestartMs / 1000)}s (fallimenti di fila: ${consecutiveFailures})`);
      timer = setTimer(start, nextRestartMs);
    });
  }

  function stop() {
    stopped = true;
    if (timer) clearTimer(timer);
    timer = null;
    const running = child;
    child = null;
    running?.kill?.();
  }

  return {
    start,
    stop,
    state: () => ({ alive: child !== null, starts, consecutiveFailures, lastExitCode, nextRestartMs }),
  };
}

/**
 * La prontezza del tavolo: una GET sulla porta interna entro `timeoutMs`;
 * pronto solo con un 200 (il saluto di cortesia di engine/bin/server).
 */
export function checkReady({ port, host = "127.0.0.1", timeoutMs = 1000, request = httpRequest } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const done = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const probe = request({ host, port, path: "/", method: "GET", timeout: timeoutMs }, response => {
        response.resume();
        done(response.statusCode === 200);
      });
      probe.on("timeout", () => {
        probe.destroy();
        done(false);
      });
      probe.on("error", () => done(false));
      probe.end();
    } catch {
      done(false);
    }
  });
}
