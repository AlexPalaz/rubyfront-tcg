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
const comando = args[0];
const opzione = nome => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };

function config() {
  try { return JSON.parse(fs.readFileSync(CONFIG, "utf8")); }
  catch { console.error(`Manca ${CONFIG} con { "url", "segreto" }.`); process.exit(2); }
}

async function chiama(cfg, metodo, corpo) {
  const url = new URL(cfg.url);
  if (metodo === "GET") for (const [k, v] of Object.entries(corpo)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: metodo,
    redirect: "follow",
    headers: metodo === "POST" ? { "Content-Type": "text/plain;charset=utf-8" } : undefined,
    body: metodo === "POST" ? JSON.stringify(corpo) : undefined,
  });
  const testo = await res.text();
  try { return JSON.parse(testo); }
  catch { console.error(`Risposta non JSON (${res.status}):\n${testo.slice(0, 500)}`); process.exit(1); }
}

const cfg = config();
if (comando === "leggi") {
  const esito = await chiama(cfg, "GET", { segreto: cfg.segreto, gid: opzione("--gid") ?? "", foglio: opzione("--foglio") ?? "" });
  if (!esito.ok) { console.error(esito); process.exit(1); }
  console.log(JSON.stringify(esito, null, 1));
} else if (comando === "scrivi") {
  const scritture = opzione("--json")
    ? JSON.parse(fs.readFileSync(opzione("--json"), "utf8"))
    : [{ gid: opzione("--gid"), foglio: opzione("--foglio"), nome: opzione("--nome"), colonna: opzione("--colonna") ?? "Effetto", cella: opzione("--cella"), valore: opzione("--valore") }];
  const esito = await chiama(cfg, "POST", { segreto: cfg.segreto, scritture });
  console.log(JSON.stringify(esito, null, 1));
  if (!esito.ok || esito.esiti.some(e => !e.ok)) process.exit(1);
} else {
  console.error("Uso: foglio.mjs leggi|scrivi …  (vedi l'intestazione del file)");
  process.exit(2);
}
