#!/usr/bin/env node
// Verifica che ogni pezzo di meccanica abbia un testo che il renderer stampa
// davvero. Il validatore controlla la forma e il vocabolario, non questo: una
// carta con un innesco senza testo passa la validazione e poi esce muta.
//
// Il caso che ha motivato questo controllo: per le Materie e gli Oggetti il
// renderer legge SOLO faceCopy.effect.text, quindi un innesco con displayKey
// diverso da "effect" e' invisibile sulla carta pur essendo nei dati.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETS = path.join(ROOT, "data", "sets");
const STATIC_EVENTS = new Set(["while_in_play", "while_assigned"]);
const INLINE_KINDS = new Set(["entity", "matter", "object"]);

const problemi = [];
let facce = 0;

for (const setDir of fs.readdirSync(SETS)) {
  const cardsDir = path.join(SETS, setDir, "cards");
  if (!fs.existsSync(cardsDir)) continue;
  for (const file of fs.readdirSync(cardsDir).filter(f => /^[a-z0-9-]+\.json$/.test(f) && !/\.(it|en)\.json$/.test(f))) {
    const card = JSON.parse(fs.readFileSync(path.join(cardsDir, file), "utf8"));
    for (const locale of card.locales ?? [card.defaultLocale]) {
      const copy = JSON.parse(fs.readFileSync(path.join(cardsDir, file.replace(/\.json$/, `.${locale}.json`)), "utf8"));
      for (const face of card.faces ?? []) {
        facce++;
        const fc = copy[face.displayKey];
        const dove = `${card.id} ${face.id} [${locale}]`;
        if (!fc) { problemi.push(`${dove}: manca il blocco di testo "${face.displayKey}"`); continue; }

        // Materie e Oggetti hanno una textbox a testo semplice: il renderer
        // stampa esclusivamente effect.text.
        if (face.kind === "matter" || face.kind === "object") {
          for (const t of face.triggers ?? []) {
            if (t.displayKey !== "effect") {
              problemi.push(`${dove}: l'innesco "${t.id}" usa displayKey "${t.displayKey}", ma su ${face.kind} il renderer stampa solo "effect" — il testo sarebbe invisibile`);
            }
          }
          if ((face.triggers ?? []).length && !fc.effect?.text) {
            problemi.push(`${dove}: ha inneschi ma nessun effect.text`);
          }
          continue;
        }

        for (const t of face.triggers ?? []) {
          const inline = INLINE_KINDS.has(face.kind) && STATIC_EVENTS.has(t.event) && fc.effect?.text;
          const testo = fc.triggers?.[t.displayKey]?.text ?? fc[t.displayKey]?.text;
          if (!testo && !inline) problemi.push(`${dove}: l'innesco "${t.id}" non ha testo`);
        }
        for (const a of face.actions ?? []) {
          if (!fc.abilities?.[a.displayKey]?.text) problemi.push(`${dove}: l'abilita "${a.id}" non ha testo`);
        }
        for (const k of face.keywords ?? []) {
          const kc = fc.keywords?.[k.displayKey ?? k.id] ?? (face.keywords.length === 1 ? fc.keyword : undefined);
          if (!kc) problemi.push(`${dove}: la parola chiave "${k.id}" non ha testo`);
        }
        if (face.requirements?.nexus && !copy.card?.nexusRequirement?.text) {
          problemi.push(`${dove}: requisito Nexus senza testo`);
        }
      }
    }
  }
}

if (problemi.length) {
  console.error(`✗ ${problemi.length} problema/i di testo:\n` + problemi.map(p => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(`✓ Testi completi: ogni meccanica ha la sua voce sulla carta (${facce} facce)`);
