// Il supervisore e la sonda (scripts/lib/supervisor.mjs), con figli e timer finti.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { BACKOFF, backoffMs, checkReady, createSupervisor } from "../lib/supervisor.mjs";

test("il ritardo raddoppia da 2 s e si ferma a 60 s", () => {
  const steady = { ...BACKOFF, jitter: 0, random: () => 0.5 };
  assert.equal(backoffMs(1, steady), 2000);
  assert.equal(backoffMs(2, steady), 4000);
  assert.equal(backoffMs(3, steady), 8000);
  assert.equal(backoffMs(6, steady), 60_000);
  assert.equal(backoffMs(20, steady), 60_000);
  assert.equal(backoffMs(0, steady), 2000);
});

test("il caso resta entro il ±20 %", () => {
  assert.equal(backoffMs(1, { ...BACKOFF, random: () => 0 }), 1600);
  assert.equal(backoffMs(1, { ...BACKOFF, random: () => 1 }), 2400);
  assert.equal(backoffMs(1, { ...BACKOFF, random: () => 0.5 }), 2000);
});

function fakeChild() {
  const listeners = {};
  return {
    on: (event, listener) => {
      listeners[event] = listener;
    },
    exit: code => listeners.exit?.(code),
    killed: false,
    kill() {
      this.killed = true;
    },
  };
}

function harness(overrides = {}) {
  const children = [];
  const timers = [];
  let clock = 0;
  const logs = [];
  const supervisor = createSupervisor({
    spawnChild: () => {
      const child = fakeChild();
      children.push(child);
      return child;
    },
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: id => {
      timers[id - 1] = null;
    },
    now: () => clock,
    log: line => logs.push(line),
    backoff: { ...BACKOFF, random: () => 0.5 },
    ...overrides,
  });
  return { supervisor, children, timers, logs, tick: ms => (clock += ms) };
}

test("riparte dopo l'uscita con un ritardo crescente e conta gli avvii", () => {
  const { supervisor, children, timers } = harness();
  supervisor.start();
  assert.equal(children.length, 1);
  assert.deepEqual(supervisor.state(), { alive: true, starts: 1, consecutiveFailures: 0, lastExitCode: null, nextRestartMs: null });
  children[0].exit(1);
  assert.equal(supervisor.state().alive, false);
  assert.equal(supervisor.state().nextRestartMs, 2000);
  assert.equal(timers.at(-1).ms, 2000);
  timers.at(-1).fn();
  assert.equal(children.length, 2);
  children[1].exit(1);
  assert.equal(timers.at(-1).ms, 4000);
  timers.at(-1).fn();
  children[2].exit(1);
  assert.equal(timers.at(-1).ms, 8000);
  assert.equal(supervisor.state().starts, 3);
  assert.equal(supervisor.state().consecutiveFailures, 3);
  assert.equal(supervisor.state().lastExitCode, 1);
});

test("una corsa stabile azzera il conto dei fallimenti", () => {
  const { supervisor, children, timers, tick } = harness();
  supervisor.start();
  children[0].exit(1);
  timers.at(-1).fn();
  children[1].exit(1);
  assert.equal(timers.at(-1).ms, 4000);
  timers.at(-1).fn();
  tick(BACKOFF.stableMs + 1);
  children[2].exit(0);
  assert.equal(supervisor.state().consecutiveFailures, 1);
  assert.equal(timers.at(-1).ms, 2000);
});

test("stop ferma i riavvii e uccide il figlio", () => {
  const { supervisor, children, timers } = harness();
  supervisor.start();
  children[0].exit(1);
  supervisor.stop();
  assert.equal(timers.at(-1), null);
  timers.forEach(timer => timer?.fn());
  assert.equal(children.length, 1);
  const { supervisor: other, children: others } = harness();
  other.start();
  other.stop();
  assert.equal(others[0].killed, true);
  others[0].exit(0);
  assert.equal(other.state().alive, false);
});

test("checkReady: falso su connessione rifiutata, vero su 200, falso oltre il tempo", async () => {
  const closed = createServer(() => {});
  await new Promise(done => closed.listen(0, "127.0.0.1", done));
  const freePort = closed.address().port;
  closed.close();
  assert.equal(await checkReady({ port: freePort, timeoutMs: 500 }), false);

  const ok = createServer((_request, response) => response.end("Tavolo Rubyfront attivo\n"));
  await new Promise(done => ok.listen(0, "127.0.0.1", done));
  assert.equal(await checkReady({ port: ok.address().port, timeoutMs: 500 }), true);
  ok.close();

  const slow = createServer(() => {});
  await new Promise(done => slow.listen(0, "127.0.0.1", done));
  assert.equal(await checkReady({ port: slow.address().port, timeoutMs: 200 }), false);
  slow.closeAllConnections?.();
  slow.close();

  const notOk = createServer((_request, response) => {
    response.writeHead(503);
    response.end();
  });
  await new Promise(done => notOk.listen(0, "127.0.0.1", done));
  assert.equal(await checkReady({ port: notOk.address().port, timeoutMs: 500 }), false);
  notOk.close();
});
