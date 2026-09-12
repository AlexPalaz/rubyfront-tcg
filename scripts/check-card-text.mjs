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

const problems = [];
let faces = 0;

for (const setDir of fs.readdirSync(SETS)) {
  const cardsDir = path.join(SETS, setDir, "cards");
  if (!fs.existsSync(cardsDir)) continue;
  // Ogni carta vive nella propria cartella: cards/<id>/<id>.json ecc.
  for (const id of fs.readdirSync(cardsDir).filter(d => fs.statSync(path.join(cardsDir, d)).isDirectory())) {
    const card = JSON.parse(fs.readFileSync(path.join(cardsDir, id, `${id}.json`), "utf8"));
    for (const locale of card.locales ?? [card.defaultLocale]) {
      const copy = JSON.parse(fs.readFileSync(path.join(cardsDir, id, `${id}.${locale}.json`), "utf8"));
      for (const face of card.faces ?? []) {
        faces++;
        const faceCopy = copy[face.displayKey];
        const where = `${card.id} ${face.id} [${locale}]`;
        if (!faceCopy) { problems.push(`${where}: manca il blocco di testo "${face.displayKey}"`); continue; }

        // Materie e Oggetti hanno una textbox a testo semplice: il renderer
        // stampa esclusivamente effect.text.
        if (face.kind === "matter" || face.kind === "object") {
          for (const t of face.triggers ?? []) {
            if (t.displayKey !== "effect") {
              problems.push(`${where}: l'innesco "${t.id}" usa displayKey "${t.displayKey}", ma su ${face.kind} il renderer stampa solo "effect" — il testo sarebbe invisibile`);
            }
          }
          if ((face.triggers ?? []).length && !faceCopy.effect?.text) {
            problems.push(`${where}: ha inneschi ma nessun effect.text`);
          }
          continue;
        }

        for (const t of face.triggers ?? []) {
          const inline = INLINE_KINDS.has(face.kind) && STATIC_EVENTS.has(t.event) && faceCopy.effect?.text;
          const text = faceCopy.triggers?.[t.displayKey]?.text ?? faceCopy[t.displayKey]?.text;
          if (!text && !inline) problems.push(`${where}: l'innesco "${t.id}" non ha testo`);
        }
        for (const a of face.actions ?? []) {
          if (!faceCopy.abilities?.[a.displayKey]?.text) problems.push(`${where}: l'abilita "${a.id}" non ha testo`);
        }
        for (const k of face.keywords ?? []) {
          const keywordCopy = faceCopy.keywords?.[k.displayKey ?? k.id] ?? (face.keywords.length === 1 ? faceCopy.keyword : undefined);
          if (!keywordCopy) problems.push(`${where}: la parola chiave "${k.id}" non ha testo`);
        }
        if (face.requirements?.nexus && !copy.card?.nexusRequirement?.text) {
          problems.push(`${where}: requisito Nexus senza testo`);
        }
      }
    }
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} problema/i di testo:\n` + problems.map(p => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(`✓ Testi completi: ogni meccanica ha la sua voce sulla carta (${faces} facce)`);
