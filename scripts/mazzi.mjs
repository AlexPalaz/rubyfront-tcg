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
import { leggiXlsx, scriviXlsx } from "./lib/xlsx.mjs";
import { ROOT, carte, chiave, confronta, foglioDelMazzo, mazzi, mazzoDalFoglio } from "./lib/mazzi-model.mjs";

const PREDEFINITO = path.join(os.homedir(), "Downloads", "Rubyfront_Precon.xlsx");
const argomenti = process.argv.slice(2);
const opzione = nome => {
  const i = argomenti.indexOf(nome);
  return i >= 0 ? argomenti[i + 1] : undefined;
};

const c = { rosso: "\x1b[31m", verde: "\x1b[32m", oro: "\x1b[33m", grigio: "\x1b[90m", forte: "\x1b[1m", fine: "\x1b[0m" };
const dice = (...testo) => console.log(...testo);

/** Il foglio: da un file scaricato, o da un URL se il documento è leggibile col link. */
function prendiFoglio() {
  const url = opzione("--url");
  if (url) {
    const id = (url.match(/\/spreadsheets\/d\/([^/]+)/) || [])[1] ?? url;
    const dove = path.join(os.tmpdir(), "rubyfront-foglio.xlsx");
    execFileSync("curl", ["-sL", "-f", "-o", dove, `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`]);
    return dove;
  }
  const file = opzione("--file") ?? PREDEFINITO;
  if (!fs.existsSync(file)) {
    dice(`${c.rosso}Non trovo il foglio scaricato.${c.fine}`);
    dice(`  Atteso in: ${file}`);
    dice("  Su Google Fogli: File → Scarica → Microsoft Excel (.xlsx).");
    dice(`  Oppure passa il percorso: ${c.grigio}node scripts/mazzi.mjs --file <percorso>${c.fine}`);
    process.exit(1);
  }
  return file;
}

function stampaDifferenze(differenze) {
  const colore = {
    "carta nuova": c.verde,
    "aggiunta al mazzo": c.verde,
    cambiata: c.oro,
    "non è più nel foglio": c.rosso,
    "Rubyfront / Nexus": c.oro,
  };
  for (const d of differenze) {
    dice(`\n  ${colore[d.tipo] ?? ""}${d.tipo}${c.fine} — ${c.forte}${d.carta}${c.fine}`);
    for (const nota of d.note) dice(`      ${nota}`);
  }
}

/** Il testo che va alla sessione Claude: cosa fare, e con quali vincoli. */
function briefing(nomeFoglio, mazzo, differenze, nuovo) {
  const righe = [
    `# Allineamento del mazzo «${nomeFoglio}» dal foglio condiviso`,
    "",
    nuovo
      ? "Il foglio ha un sottofoglio che in catalogo NON esiste: va creato il mazzo, e con lui le carte che mancano."
      : `Il mazzo esiste in catalogo (\`data/decks/${mazzo.id}.json\`). Il foglio è cambiato: allinea il catalogo al foglio.`,
    "",
    "## Differenze rilevate",
    "",
  ];
  for (const d of differenze) {
    righe.push(`- **${d.carta}** — ${d.tipo}`);
    for (const nota of d.note) righe.push(`  - ${nota}`);
  }
  righe.push(
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
    "6. Riscrivi il foglio dal catalogo: `node scripts/mazzi.mjs --esporta`. Così il linguaggio normalizzato",
    "   torna anche sul foglio.",
    "",
    "Non committare e non fare push: lo decide il designer.",
  );
  return righe.join("\n");
}

/** Riscrive il file dal catalogo: un sottofoglio per mazzo, nell'ordine del catalogo. */
function esporta(destinazione) {
  const tutte = carte();
  const fogli = [...mazzi().values()].map(m => foglioDelMazzo(m, tutte));
  scriviXlsx(destinazione, fogli);
  return { destinazione, fogli: fogli.map(f => f.nome) };
}

async function main() {
  if (argomenti.includes("--esporta")) {
    const dove = opzione("--file") ?? PREDEFINITO;
    const fatto = esporta(dove);
    dice(`${c.verde}Foglio riscritto dal catalogo${c.fine}: ${fatto.destinazione}`);
    dice(`  Sottofogli: ${fatto.fogli.join(", ")}`);
    dice("\n  Per riportarlo su Google Fogli senza cambiare il link:");
    dice(`  ${c.grigio}File → Importa → carica il file → «Sostituisci foglio di lavoro»${c.fine}`);
    return;
  }

  const file = prendiFoglio();
  const fogli = leggiXlsx(file);
  const tutte = carte();
  const catalogo = mazzi();
  const perNome = new Map([...catalogo.values()].map(m => [chiave(m.locales.it.name), m]));

  dice(`\n${c.forte}Foglio${c.fine}: ${file}`);
  const voci = fogli.map(f => ({ foglio: f, mazzo: perNome.get(chiave(f.nome)) }));
  voci.forEach((v, i) => {
    const stato = v.mazzo ? `${c.grigio}in catalogo (${v.mazzo.id})${c.fine}` : `${c.verde}nuovo${c.fine}`;
    dice(`  ${String(i + 1).padStart(2)}. ${v.foglio.nome}  ${stato}`);
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const scelta = (await rl.question(`\nQuale mazzo aggiornare o aggiungere? [1-${voci.length}, Invio per uscire] `)).trim();
  const voce = voci[Number(scelta) - 1];
  if (!voce) {
    rl.close();
    dice("Niente da fare.");
    return;
  }

  const dalFoglio = mazzoDalFoglio(voce.foglio);
  const differenze = confronta(dalFoglio, voce.mazzo, tutte);
  if (!voce.mazzo) dice(`\n${c.verde}«${voce.foglio.nome}» non è in catalogo: verrà creato.${c.fine}`);
  if (!differenze.length) {
    rl.close();
    dice(`\n${c.verde}Nessuna differenza${c.fine}: il foglio e il catalogo dicono la stessa cosa.`);
    return;
  }
  dice(`\n${c.forte}${differenze.length} differenze fra il foglio e il catalogo:${c.fine}`);
  stampaDifferenze(differenze);

  const ok = (await rl.question(`\n${c.forte}Procedo ad applicarle al catalogo?${c.fine} [s/N] `)).trim().toLowerCase();
  rl.close();
  if (!["s", "si", "sì"].includes(ok)) {
    dice("Lasciato com'è.");
    return;
  }

  const nota = path.join(os.tmpdir(), `rubyfront-mazzo-${Date.now()}.md`);
  fs.writeFileSync(nota, briefing(voce.foglio.nome, voce.mazzo, differenze, !voce.mazzo));
  dice(`\n${c.grigio}Apro una sessione Claude con le differenze (${nota}).${c.fine}\n`);
  const esito = spawnSync("claude", [`Leggi ${nota} e portalo a termine.`], { cwd: ROOT, stdio: "inherit" });
  if (esito.error) {
    dice(`${c.rosso}Non riesco ad avviare «claude».${c.fine} Le differenze restano in ${nota}`);
    process.exit(1);
  }
}

main().catch(errore => {
  console.error(`${c.rosso}${errore.message}${c.fine}`);
  process.exit(1);
});
