#!/usr/bin/env node
// Impacchetta i dati madre di data/ in un unico docs/cards/catalog.json,
// così il browser fa una sola richiesta invece di una per file.
//
// L'artefatto è GENERATO: non va modificato a mano. La fonte di verità
// resta data/. Con --check non scrive nulla e fallisce se il bundle è
// disallineato, così una modifica ai dati senza rebuild non passa inosservata.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const OUT = path.join(ROOT, "docs", "cards", "catalog.json");
const NOTES_DIR = path.join(ROOT, "docs", "cards", "notes");
const checkOnly = process.argv.includes("--check");

const readJson = relative => JSON.parse(fs.readFileSync(path.join(DATA, relative), "utf8"));

const catalog = readJson("catalog.json");

const sets = catalog.sets.map(setDir => {
  const set = readJson(path.join("sets", setDir, "set.json"));

  const cards = set.cards.map(cardId => {
    const base = path.join("sets", setDir, "cards", cardId.toLowerCase());
    const card = readJson(`${base}.json`);

    // le lingue tornano dentro la carta: è la forma che serve alle viste
    const locales = Object.fromEntries(
      (card.locales ?? [card.defaultLocale]).map(locale => [locale, readJson(`${base}.${locale}.json`)])
    );

    // Le note di design vengono copiate dentro docs/: il sito pubblicato
    // (GitHub Pages serve solo docs/) non potrebbe raggiungere /data.
    let designNotes;
    if (card.designNotes) {
      const from = path.join(DATA, "sets", setDir, "cards", card.designNotes);
      if (fs.existsSync(from)) {
        fs.mkdirSync(NOTES_DIR, { recursive: true });
        fs.copyFileSync(from, path.join(NOTES_DIR, card.designNotes));
        designNotes = `notes/${card.designNotes}`;
      }
    }

    return { ...card, locales, source: { designNotes } };
  });

  return { ...set, cards };
});

const bundle = {
  ...catalog,
  _generated: "Generato da scripts/build-catalog.mjs — non modificare a mano. Fonte: data/",
  sets,
  cards: sets.flatMap(set => set.cards)
};

const output = JSON.stringify(bundle, null, 2) + "\n";

if (checkOnly) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== output) {
    console.error("✗ docs/cards/catalog.json è disallineato dai dati in data/.\n  Esegui: node scripts/build-catalog.mjs");
    process.exit(1);
  }
  console.log("✓ Bundle allineato ai dati madre");
} else {
  fs.writeFileSync(OUT, output);
  console.log(`✓ Scritto docs/cards/catalog.json — ${bundle.cards.length} carta/e, ${sets.length} set (${(output.length / 1024).toFixed(1)} KB)`);
}
