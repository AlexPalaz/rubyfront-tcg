// Tutto il tavolo con un comando solo:
//
//   npm run all                 (dalla radice o da simulatore/)
//
// Accende i tre pezzi — la pagina (vite, :5199), il relay (:8787) e
// l'engine (:8788) — con i log incolonnati per voce, e un solo Ctrl+C
// spegne tutto. Se un pezzo muore (porta occupata, Ruby assente...),
// si spegne il resto e si esce: meglio un fallimento chiaro che un
// tavolo a metà.

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const VOICES = [
  { name: "pagina", command: "npm", args: ["run", "dev"], cwd: resolve(ROOT, "simulatore") },
  { name: "relay ", command: "node", args: ["scripts/relay.mjs"], cwd: ROOT },
  { name: "engine", command: "ruby", args: ["engine/bin/server"], cwd: ROOT },
];

const children = [];
let closing = false;

function shutdown(code) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    // I figli partono in un gruppo di processi proprio: si spegne il gruppo,
    // così muore anche chi sta sotto npm (vite), non solo npm.
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* già morto */
    }
  }
  process.exitCode = code;
}

function pipe(name, stream) {
  let rest = "";
  stream.on("data", chunk => {
    rest += String(chunk);
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) console.log(`[${name}] ${line}`);
  });
}

for (const voice of VOICES) {
  const child = spawn(voice.command, voice.args, {
    cwd: voice.cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  pipe(voice.name, child.stdout);
  pipe(voice.name, child.stderr);
  child.on("error", error => {
    console.error(`[${voice.name}] non parte: ${error.message}`);
    shutdown(1);
  });
  child.on("exit", code => {
    if (closing) return;
    console.error(`[${voice.name}] si è fermato (exit ${code ?? "?"}): spengo il resto.`);
    shutdown(code ?? 1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("Tavolo in accensione: pagina http://localhost:5199/simulatore/ · relay :8787 · engine :8788");
console.log("Ctrl+C per spegnere tutto.");
