#!/usr/bin/env node
// Scrive e legge il foglio «Rubyfront - Mazzi Precon» attraverso il web app
// di scripts/foglio/Code.gs. La configurazione sta FUORI dal repo, in
// ~/.config/rubyfront/foglio.json: { "url": "https://script.google.com/macros/s/…/exec", "segreto": "…" }.
//
//   node scripts/foglio/foglio.mjs leggi --gid 272504724
//   node scripts/foglio/foglio.mjs scrivi --gid 272504724 --nome "Rhen, Erede di Vhal Astra" --colonna Effetto --valore "…"
//   node scripts/foglio/foglio.mjs scrivi --json scritture.json      (un array di {gid|foglio, nome, colonna, valore} o {gid, cella, valore})

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG = path.join(os.homedir(), ".config", "rubyfront", "foglio.json");
const args = process.argv.slice(2);
const command = args[0];
const option = nome => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };

function config() {
  try { return JSON.parse(fs.readFileSync(CONFIG, "utf8")); }
  catch { console.error(`Manca ${CONFIG} con { "url", "segreto" }.`); process.exit(2); }
}

async function call(cfg, method, body) {
  const url = new URL(cfg.url);
  if (method === "GET") for (const [k, v] of Object.entries(body)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: method,
    redirect: "follow",
    headers: method === "POST" ? { "Content-Type": "text/plain;charset=utf-8" } : undefined,
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { console.error(`Risposta non JSON (${res.status}):\n${text.slice(0, 500)}`); process.exit(1); }
}

const cfg = config();
if (command === "read") {
  const result = await call(cfg, "GET", { segreto: cfg.segreto, gid: option("--gid") ?? "", foglio: option("--sheet") ?? "" });
  if (!result.ok) { console.error(result); process.exit(1); }
  console.log(JSON.stringify(result, null, 1));
} else if (command === "write") {
  const writes = option("--json")
    ? JSON.parse(fs.readFileSync(option("--json"), "utf8"))
    : [{ gid: option("--gid"), foglio: option("--sheet"), nome: option("--name"), colonna: option("--column") ?? "Effetto", cella: option("--cell"), valore: option("--value") }];
  const result = await call(cfg, "POST", { segreto: cfg.segreto, writes: writes });
  console.log(JSON.stringify(result, null, 1));
  if (!result.ok || result.esiti.some(e => !e.ok)) process.exit(1);
} else {
  console.error("Uso: sheet.mjs read|write …  (vedi l'intestazione del file)");
  process.exit(2);
}
