// Il server unico di produzione: il tavolo Ruby dietro un processo Node.
//
// Un solo processo ascolta su PORT (Render free: un servizio) e smista per
// percorso:
//
//   GET /live        → il processo Node è vivo (200 sempre)
//   GET /ready       → il tavolo Ruby risponde (200) o no (503): è questo che
//                      Render interroga (render.yaml, healthCheckPath)
//   GET /            → due righe di stato, col tavolo sondato davvero
//   WS  /engine?room=&seat=&token=
//                    → il tavolo (engine/bin/server): un Engine per stanza,
//                      l'unico a scrivere lo stato (deciso 2026-09-11).
//                      Avviato come processo figlio su una porta interna e
//                      raggiunto per proxy: l'upgrade WebSocket si inoltra
//                      con l'indirizzo vero del client (X-Forwarded-For) e
//                      l'Origin ammessa, e i due socket si collegano in
//                      entrambi i versi. Se il figlio muore, riparte con un
//                      ritardo crescente (scripts/lib/supervisor.mjs).
//
// Dal 2026-10-21 (audit RF-020/RF-021/RF-025): prontezza sondata, riavvio
// con backoff, Origin verificata prima dell'upgrade, intestazioni di inoltro
// del client scartate, tetto alle intestazioni.
//
// Render free si addormenta dopo un quarto d'ora senza richieste in
// entrata, e chi arriva dopo aspetta mezzo minuto con l'arbitro «spento».
// Il workflow di GitHub (keepalive.yml) doveva toccarlo ogni dieci minuti,
// ma GitHub lo fa girare ogni due-quattro ore. Così il server SI TOCCA DA
// SOLO: ogni dieci minuti una GET al proprio indirizzo pubblico
// (RENDER_EXTERNAL_URL, che Render imposta da sé), che passa dal bordo di
// Render e conta come traffico. In locale la variabile non c'è e non si fa
// nulla. Le 750 ore al mese del piano free bastano a un servizio solo.
//
//   node scripts/server.mjs        (PORT, default 10000; ENGINE_PORT, default 8788)
//   RUBYFRONT_ENGINE_CMD           il comando del figlio (default «ruby»), per le prove

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUpstreamRequest, originAllowed, originsFrom } from "./lib/proxy.mjs";
import { checkReady, createSupervisor } from "./lib/supervisor.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 10000);
const ENGINE_PORT = Number(process.env.ENGINE_PORT ?? 8788);
const ORIGINS = originsFrom();
const [ENGINE_CMD, ...ENGINE_ARGS] = (process.env.RUBYFRONT_ENGINE_CMD ?? "ruby engine/bin/server").split(" ").filter(Boolean);

const supervisor = createSupervisor({
  spawnChild: () =>
    spawn(ENGINE_CMD, [...ENGINE_ARGS, String(ENGINE_PORT)], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, PORT: String(ENGINE_PORT) },
    }),
});
supervisor.start();

// Il tocco a se stesso (vedi in testa). Il conto va nello stato, per
// vedere da fuori che gira.
const SELF_PING_MS = 10 * 60 * 1000;
const selfUrl = process.env.RENDER_EXTERNAL_URL ?? "";
let selfPings = 0;
let selfPingFailed = 0;
if (selfUrl) {
  setInterval(() => {
    fetch(`${selfUrl}/?keepalive=1`, { signal: AbortSignal.timeout(30_000) })
      .then(response => {
        if (response.ok) selfPings += 1;
        else selfPingFailed += 1;
      })
      .catch(() => {
        selfPingFailed += 1;
      });
  }, SELF_PING_MS).unref();
}

const pathOf = request => new URL(request.url ?? "/", "http://localhost").pathname;

const server = createServer({ maxHeaderSize: 32 * 1024 }, async (request, response) => {
  const path = pathOf(request);
  if (path === "/live") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok\n");
    return;
  }
  const ready = await checkReady({ port: ENGINE_PORT });
  if (path === "/ready") {
    response.writeHead(ready ? 200 : 503, { "content-type": "text/plain; charset=utf-8" });
    response.end(ready ? "pronto\n" : "non pronto\n");
    return;
  }
  const { starts, consecutiveFailures, nextRestartMs } = supervisor.state();
  const awake = selfUrl ? ` Sveglio da sé: ${selfPings} tocchi${selfPingFailed ? ` (${selfPingFailed} falliti)` : ""}.` : "";
  const restarting = nextRestartMs ? ` in riavvio fra ${Math.round(nextRestartMs / 1000)}s (fallimenti di fila: ${consecutiveFailures})` : "";
  response.writeHead(ready ? 200 : 503, { "content-type": "text/plain; charset=utf-8" });
  response.end(`Rubyfront online. Tavolo: ${ready ? "vivo" : `non risponde${restarting}`} (avvii: ${starts}).${awake}\n`);
});
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;

// Il tavolo: proxy dell'upgrade verso il figlio Ruby. Ogni altro percorso
// (il vecchio /relay compreso) non ha più nessuno in ascolto.
server.on("upgrade", (request, socket, head) => {
  if (pathOf(request) !== "/engine") {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  // L'Origin si giudica qui, prima di aprire il filo verso il tavolo (che la rigiudica).
  if (!originAllowed(request.headers.origin, ORIGINS)) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  const upstream = connect(ENGINE_PORT, "127.0.0.1");
  upstream.on("connect", () => {
    upstream.write(buildUpstreamRequest(request.method, request.url, request.httpVersion, request.rawHeaders, socket.remoteAddress));
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const drop = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on("error", drop);
  socket.on("error", drop);
  socket.on("close", () => upstream.destroy());
  upstream.on("close", () => socket.destroy());
});

server.listen(PORT, () => {
  console.log(`Rubyfront online su :${PORT} — /engine (tavolo interno su :${ENGINE_PORT}), /live, /ready`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    supervisor.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
