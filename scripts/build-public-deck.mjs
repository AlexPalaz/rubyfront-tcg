#!/usr/bin/env node
// Genera la pagina pubblica del mazzo: UN SOLO index.html autonomo, destinato
// al repo AlexPalaz/rubyfront-deck, dove GitHub Pages serve la sola radice.
//
// Niente richieste esterne: CSS della carta, renderer e dati finiscono tutti
// inline. Le parti su misura della pagina pubblica (chrome, markup, bootstrap)
// vivono in scripts/public-deck/ e sono le uniche cose che non arrivano da
// docs/cards/: tutto il resto e' rigenerato dai dati madre, cosi' la pagina
// pubblicata non puo' divergere dalle carte come e' successo finora.
//
//   node scripts/build-public-deck.mjs [--out <file>]
//
// Con --check non scrive nulla e fallisce se l'artefatto e' disallineato.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI = path.join(ROOT, "docs", "cards", "ui");
const TPL = path.join(ROOT, "scripts", "public-deck");

const read = p => fs.readFileSync(p, "utf8");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const outFlag = args.indexOf("--out");
const OUT = outFlag >= 0 ? path.resolve(args[outFlag + 1]) : path.join(ROOT, "docs", "public-deck.html");

// ---- dati -----------------------------------------------------------------
const catalog = JSON.parse(read(path.join(ROOT, "docs", "cards", "catalog.json")));
const deck = catalog.decks?.[0];
if (!deck) throw new Error("catalog.json non contiene mazzi: eseguire prima build-catalog.mjs");

// Solo le carte del mazzo: la pagina pubblica non deve trascinarsi dietro il
// resto del set: escono solo le carte elencate dal mazzo.
const cards = {};
for (const entry of deck.cards) {
  const card = catalog.cards?.[entry.card] ?? catalog.sets.flatMap(s => s.cards).find(c => c.id === entry.card);
  if (!card) throw new Error(`carta ${entry.card} non trovata nel catalogo`);
  cards[entry.card] = card;
}

// ---- moduli, spogliati di import/export ----------------------------------
const stripModule = source => source
  .replace(/^import[^;]*;\s*$/gm, "")
  .replace(/^export\s*\{[^}]*\};\s*$/gm, "")
  .replace(/^export /gm, "")
  .trim();

// element() e' l'unica cosa che serve da shell.js: il resto della shell e'
// navigazione, che la pagina pubblica non ha.
const elementFn = read(path.join(UI, "shell.js"))
  .match(/export function element\([\s\S]*?\n}/)?.[0]?.replace(/^export /, "");
if (!elementFn) throw new Error("non trovo element() in shell.js");

const script = [
  `const DATA = ${JSON.stringify({ deck, cards })};`,
  stripModule(read(path.join(UI, "themes.js"))),
  elementFn,
  stripModule(read(path.join(UI, "card-render.js"))),
  read(path.join(TPL, "page-boot.js")).trim()
].join("\n\n");

// ---- assemblaggio ---------------------------------------------------------
const titolo = `${deck.locales.it.name} · Rubyfront`;
const html = `<!doctype html>
<html lang="it">
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta charset="utf-8">
<title>${titolo}</title>
<style>
${read(path.join(TPL, "page.css")).trimEnd()}
${read(path.join(UI, "card.css")).trimEnd()}
</style>
</head>
${read(path.join(TPL, "page.html")).trim()}
<script>
${script}
</script>
</body>
</html>
`;

if (checkOnly) {
  const attuale = fs.existsSync(OUT) ? read(OUT) : "";
  if (attuale !== html) {
    console.error(`✗ ${path.relative(ROOT, OUT)} disallineato: rieseguire build-public-deck.mjs`);
    process.exit(1);
  }
  console.log("✓ Pagina pubblica allineata ai dati madre");
} else {
  fs.writeFileSync(OUT, html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
  console.log(`✓ Scritto ${path.relative(ROOT, OUT)} — ${deck.cards.reduce((s, c) => s + c.count, 0)} carte, ${Object.keys(cards).length} progetti (${kb} KB)`);
}
