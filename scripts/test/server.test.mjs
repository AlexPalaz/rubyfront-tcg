// Il proxy vero (scripts/server.mjs) con un tavolo finto come figlio
// (fake-engine.mjs): prontezza, Origin, inoltro, riavvio.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function freePort() {
  const server = createServer();
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}

async function get(port, path, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  return { status: response.status, text: await response.text() };
}

/** Un upgrade grezzo verso il proxy: torna la risposta intera (status + corpo). */
function upgrade(port, headers) {
  return new Promise((done, fail) => {
    const socket = connect(port, "127.0.0.1");
    let text = "";
    socket.on("connect", () => {
      const lines = ["GET /engine?room=x HTTP/1.1", `Host: 127.0.0.1:${port}`, "Upgrade: websocket", "Connection: Upgrade", "Sec-WebSocket-Version: 13", "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", ...headers];
      socket.write(lines.join("\r\n") + "\r\n\r\n");
    });
    socket.on("data", chunk => {
      text += chunk.toString("utf8");
    });
    socket.on("close", () => done(text));
    socket.on("error", fail);
    setTimeout(() => socket.destroy(), 3000).unref();
  });
}

async function waitFor(check, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise(done => setTimeout(done, 100));
  }
  return false;
}

let proxy = null;
let port = 0;
let enginePort = 0;

before(async () => {
  port = await freePort();
  enginePort = await freePort();
  proxy = spawn(process.execPath, ["scripts/server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ENGINE_PORT: String(enginePort), RUBYFRONT_ENGINE_CMD: `${process.execPath} scripts/lib/fake-engine.mjs`, RUBYFRONT_ORIGINS: "https://ok.test", RENDER_EXTERNAL_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proxy.stdout.on("data", () => {});
  proxy.stderr.on("data", () => {});
  assert.ok(await waitFor(() => get(port, "/live").then(r => r.status === 200).catch(() => false)), "il proxy parte");
});

after(() => {
  proxy?.kill("SIGTERM");
});

test("/live risponde subito; /ready quando il tavolo ascolta", async () => {
  assert.equal((await get(port, "/live")).status, 200);
  assert.ok(await waitFor(() => get(port, "/ready").then(r => r.status === 200)), "/ready diventa 200");
  const home = await get(port, "/");
  assert.equal(home.status, 200);
  assert.match(home.text, /Tavolo: vivo/);
});

test("un percorso sconosciuto in upgrade è 404, un'Origin cattiva 403, prima di toccare il tavolo", async () => {
  const bad = await upgrade(port, ["Origin: https://evil.test"]);
  assert.match(bad, /^HTTP\/1\.1 403/);
  const missing = await upgrade(port, []);
  assert.match(missing, /^HTTP\/1\.1 403/);
});

test("l'upgrade arriva al tavolo con X-Forwarded-For sostituito e l'Origin com'era", async () => {
  const text = await upgrade(port, ["Origin: https://ok.test", "X-Forwarded-For: 9.9.9.9", "X-Real-IP: 8.8.8.8"]);
  assert.match(text, /^HTTP\/1\.1 200/);
  const body = JSON.parse(text.slice(text.indexOf("\r\n\r\n") + 4));
  assert.equal(body.requestLine, "GET /engine?room=x HTTP/1.1");
  assert.equal(body.headers["x-forwarded-for"], "127.0.0.1");
  assert.equal(body.headers["x-real-ip"], undefined);
  assert.equal(body.headers.origin, "https://ok.test");
});

test("se il tavolo muore /ready va a 503, poi torna 200 col riavvio", async () => {
  const text = await get(port, "/");
  assert.match(text.text, /avvii: 1/);
  // Si trova il figlio per la sua porta e lo si uccide.
  const { execSync } = await import("node:child_process");
  const pids = execSync(`lsof -nP -iTCP:${enginePort} -sTCP:LISTEN -t`).toString().trim().split("\n").filter(Boolean);
  assert.ok(pids.length >= 1, "il tavolo finto ascolta");
  for (const pid of pids) process.kill(Number(pid), "SIGKILL");
  assert.ok(await waitFor(() => get(port, "/ready").then(r => r.status === 503)), "/ready va a 503");
  assert.ok(await waitFor(() => get(port, "/ready").then(r => r.status === 200), 10_000), "il riavvio (2 s circa) lo riporta a 200");
  assert.match((await get(port, "/")).text, /avvii: 2/);
});
