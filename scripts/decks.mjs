#!/usr/bin/env node
// Il ponte fra il foglio condiviso e il catalogo.
//
// Il foglio su Google Fogli è il posto dove i mazzi si disegnano: un
// sottofoglio per mazzo. Questo comando lo legge, dice cosa è cambiato
// rispetto alle carte del repo, e — col tuo sì — apre una sessione Claude che
// applica le modifiche, normalizza il linguaggio secondo la skill delle carte
// e riscrive il foglio.
//
// Due passaggi restano a mano, e sono voluti: il foglio è privato, quindi
// nessun programma lo legge o lo scrive al posto tuo.
//   1. su Fogli: File → Scarica → Microsoft Excel (.xlsx), in ~/Downloads;
//   2. finito: File → Importa → carica il file → «Sostituisci foglio di
//      lavoro», così il documento resta lo stesso e il link non cambia.
// Rendendo il foglio leggibile da chi ha il link, il primo passaggio si
// automatizza da sé (vedi --url).

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { readXlsx, writeXlsx } from "./lib/xlsx.mjs";
import { ROOT, cards, nameKey, compare, deckSheet, decks, deckFromSheet } from "./lib/deck-model";

const DEFAULT_FILE = path.join(os.homedir(), "Downloads", "Rubyfront_Precon.xlsx");
const argv = process.argv.slice(2);
const option = flag => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const c = { red: "\x1b[31m", green: "\x1b[32m", gold: "\x1b[33m", grey: "\x1b[90m", bold: "\x1b[1m", reset: "\x1b[0m" };
const say = (...text) => console.log(...text);

/** Il foglio: da un file scaricato, o da un URL se il documento è leggibile col link. */
function fetchSheet() {
  const url = option("--url");
  if (url) {
    const id = (url.match(/\/spreadsheets\/d\/([^/]+)/) || [])[1] ?? url;
    const target = path.join(os.tmpdir(), "rubyfront-sheet.xlsx");
    execFileSync("curl", ["-sL", "-f", "-o", target, `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`]);
    return target;
  }
  const file = option("--file") ?? DEFAULT_FILE;
  if (!fs.existsSync(file)) {
    say(`${c.red}Non trovo il foglio scaricato.${c.reset}`);
    say(`  Atteso in: ${file}`);
    say("  Su Google Fogli: File → Scarica → Microsoft Excel (.xlsx).");
    say(`  Oppure passa il percorso: ${c.grey}node scripts/decks.mjs --file <percorso>${c.reset}`);
    process.exit(1);
  }
  return file;
}

function printDifferences(differences) {
  const color = {
    "carta nuova": c.green,
    "aggiunta al mazzo": c.green,
    cambiata: c.gold,
    "non è più nel foglio": c.red,
    "Rubyfront / Nexus": c.gold,
  };
  for (const d of differences) {
    say(`\n  ${color[d.type] ?? ""}${d.type}${c.reset} — ${c.bold}${d.card}${c.reset}`);
    for (const note of d.notes) say(`      ${note}`);
  }
}

/** Il testo che va alla sessione Claude: cosa fare, e con quali vincoli. */
function briefing(sheetName, deck, differences, isNew) {
  const lines = [
    `# Allineamento del mazzo «${sheetName}» dal foglio condiviso`,
    "",
    isNew
      ? "Il foglio ha un sottofoglio che in catalogo NON esiste: va creato il mazzo, e con lui le carte che mancano."
      : `Il mazzo esiste in catalogo (\`data/decks/${deck.id}.json\`). Il foglio è cambiato: allinea il catalogo al foglio.`,
    "",
    "## Differenze rilevate",
    "",
  ];
  for (const d of differences) {
    lines.push(`- **${d.card}** — ${d.type}`);
    for (const note of d.notes) lines.push(`  - ${note}`);
  }
  lines.push(
    "",
    "## Come procedere",
    "",
    "1. Applica **SEMPRE** la skill di progetto `linguaggio-carte`: il foglio è scritto a mano e usa parole",
    "   che il catalogo non usa. Il testo che finisce nei dati è quello normalizzato, non quello del foglio —",
    "   si mantiene il periodo del designer, si normalizzano termini, formule e tipografia.",
    "2. Se una differenza cambia il comportamento del gioco, applica anche la skill `regole-engine`: la",
    "   semantica nel `<id>.json` deve corrispondere al testo, ed è quella che legge l'engine.",
    "3. Aggiorna i file: `data/sets/*/cards/<id>/<id>.json`, `<id>.it.json`, `<id>.en.json`, `<id>.md`,",
    "   `data/decks/<mazzo>.json` e `<mazzo>.md`, `set.json` se le carte sono nuove.",
    "4. Una differenza che il foglio non spiega abbastanza è una domanda per il designer, non una tua",
    "   scelta: chiedila invece di indovinare.",
    "5. Verifica: `node scripts/validate-data.mjs` e `node scripts/check-card-text.mjs`.",
    "6. Riscrivi il foglio dal catalogo: `node scripts/decks.mjs --export`. Così il linguaggio normalizzato",
    "   torna anche sul foglio.",
    "",
    "Non committare e non fare push: lo decide il designer.",
  );
  return lines.join("\n");
}

/** Riscrive il file dal catalogo: un sottofoglio per mazzo, nell'ordine del catalogo. */
function exportSheet(destination) {
  const allCards = cards();
  const sheets = [...decks().values()].map(m => deckSheet(m, allCards));
  writeXlsx(destination, sheets);
  return { destination, sheets: sheets.map(f => f.name) };
}

async function main() {
  if (argv.includes("--export")) {
    const target = option("--file") ?? DEFAULT_FILE;
    const done = exportSheet(target);
    say(`${c.green}Foglio riscritto dal catalogo${c.reset}: ${done.destination}`);
    say(`  Sottofogli: ${done.sheets.join(", ")}`);
    say("\n  Per riportarlo su Google Fogli senza cambiare il link:");
    say(`  ${c.grey}File → Importa → carica il file → «Sostituisci foglio di lavoro»${c.reset}`);
    return;
  }

  const file = fetchSheet();
  const sheets = readXlsx(file);
  const allCards = cards();
  const catalog = decks();
  const byName = new Map([...catalog.values()].map(m => [nameKey(m.locales.it.name), m]));

  say(`\n${c.bold}Foglio${c.reset}: ${file}`);
  const entries = sheets.map(f => ({ sheet: f, deck: byName.get(nameKey(f.name)) }));
  entries.forEach((v, i) => {
    const status = v.deck ? `${c.grey}in catalogo (${v.deck.id})${c.reset}` : `${c.green}nuovo${c.reset}`;
    say(`  ${String(i + 1).padStart(2)}. ${v.sheet.name}  ${status}`);
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const choice = (await rl.question(`\nQuale mazzo aggiornare o aggiungere? [1-${entries.length}, Invio per uscire] `)).trim();
  const entry = entries[Number(choice) - 1];
  if (!entry) {
    rl.close();
    say("Niente da fare.");
    return;
  }

  const fromSheet = deckFromSheet(entry.sheet);
  const differences = compare(fromSheet, entry.deck, allCards);
  if (!entry.deck) say(`\n${c.green}«${entry.sheet.name}» non è in catalogo: verrà creato.${c.reset}`);
  if (!differences.length) {
    rl.close();
    say(`\n${c.green}Nessuna differenza${c.reset}: il foglio e il catalogo dicono la stessa cosa.`);
    return;
  }
  say(`\n${c.bold}${differences.length} differenze fra il foglio e il catalogo:${c.reset}`);
  printDifferences(differences);

  const ok = (await rl.question(`\n${c.bold}Procedo ad applicarle al catalogo?${c.reset} [s/N] `)).trim().toLowerCase();
  rl.close();
  if (!["s", "si", "sì"].includes(ok)) {
    say("Lasciato com'è.");
    return;
  }

  const note = path.join(os.tmpdir(), `rubyfront-deck-${Date.now()}.md`);
  fs.writeFileSync(note, briefing(entry.sheet.name, entry.deck, differences, !entry.deck));
  say(`\n${c.grey}Apro una sessione Claude con le differenze (${note}).${c.reset}\n`);
  const result = spawnSync("claude", [`Leggi ${note} e portalo a termine.`], { cwd: ROOT, stdio: "inherit" });
  if (result.error) {
    say(`${c.red}Non riesco ad avviare «claude».${c.reset} Le differenze restano in ${note}`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error(`${c.red}${error.message}${c.reset}`);
  process.exit(1);
});
