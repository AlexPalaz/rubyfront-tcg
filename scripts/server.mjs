// Il server unico di produzione: relay ed engine in un processo solo.
//
// Render free dà 750 ore al mese per account: due servizi sempre svegli
// ne consumerebbero 1440. Qui un solo processo Node ascolta su PORT e
// smista per percorso:
//
//   GET /            → health check (chi c'è: stanze aperte, engine vivo)
//   WS  /relay?room= → il relay (scripts/relay.mjs, agganciato qui)
//   WS  /engine      → l'engine Ruby (engine/bin/server), avviato come
//                      processo figlio su una porta interna e raggiunto
//                      per proxy: l'upgrade WebSocket si inoltra tale e
//                      quale, e i due socket si collegano in entrambi i
//                      versi. Se il figlio muore, riparte.
//
// Il Dockerfile alla radice mette insieme Node e Ruby; render.yaml lo usa.
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

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachRelay, openRooms } from "./relay.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 10000);
const ENGINE_PORT = Number(process.env.ENGINE_PORT ?? 8788);

let engine = null;
let engineStarts = 0;
function startEngine() {
  engineStarts += 1;
  engine = spawn("ruby", ["engine/bin/server", String(ENGINE_PORT)], {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, PORT: String(ENGINE_PORT) },
  });
  engine.on("exit", code => {
    console.log(`[engine] uscito (${code}); riparte fra 2s`);
    engine = null;
    setTimeout(startEngine, 2000);
  });
}
startEngine();

// Il tocco a se stesso (vedi in testa). Il conto va nell'health check, per
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

const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  const awake = selfUrl ? ` Sveglio da sé: ${selfPings} tocchi${selfPingFailed ? ` (${selfPingFailed} falliti)` : ""}.` : "";
  response.end(
    `Rubyfront online. Relay: ${openRooms()} stanze aperte. Engine: ${engine ? "vivo" : "in riavvio"} (avvii: ${engineStarts}).${awake}\n`
  );
});

const pathOf = request => new URL(request.url ?? "/", "http://localhost").pathname;

// Il relay prende /relay (e la radice, per i client vecchi).
attachRelay(server, request => {
  const path = pathOf(request);
  return path === "/relay" || path === "/";
});

// L'engine: proxy grezzo dell'upgrade verso il figlio Ruby.
server.on("upgrade", (request, socket, head) => {
  if (pathOf(request) !== "/engine") return;
  const upstream = connect(ENGINE_PORT, "127.0.0.1");
  upstream.on("connect", () => {
    // Si rimanda la richiesta com'è arrivata: l'engine legge l'header e
    // completa l'handshake da sé (engine/bin/server, handshake).
    const lines = [`${request.method} ${request.url} HTTP/${request.httpVersion}`];
    for (let i = 0; i < request.rawHeaders.length; i += 2) lines.push(`${request.rawHeaders[i]}: ${request.rawHeaders[i + 1]}`);
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
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
  console.log(`Rubyfront online su :${PORT} — /relay e /engine (engine interno su :${ENGINE_PORT})`);
});
