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
const ART_DIR = path.join(ROOT, "docs", "cards", "art");
const checkOnly = process.argv.includes("--check");

const readJson = relative => JSON.parse(fs.readFileSync(path.join(DATA, relative), "utf8"));

const catalog = readJson("catalog.json");

const sets = catalog.sets.map(setDir => {
  const set = readJson(path.join("sets", setDir, "set.json"));

  const cards = set.cards.map(cardId => {
    // Ogni carta vive nella propria cartella: cards/<id>/<id>.json ecc.
    const id = cardId.toLowerCase();
    const base = path.join("sets", setDir, "cards", id, id);
    const card = readJson(`${base}.json`);

    // le lingue tornano dentro la carta: è la forma che serve alle viste
    const locales = Object.fromEntries(
      (card.locales ?? [card.defaultLocale]).map(locale => [locale, readJson(`${base}.${locale}.json`)])
    );

    // Le note di design vengono copiate dentro docs/: il sito pubblicato
    // (GitHub Pages serve solo docs/) non potrebbe raggiungere /data.
    let designNotes;
    if (card.designNotes) {
      const from = path.join(DATA, "sets", setDir, "cards", id, card.designNotes);
      if (fs.existsSync(from)) {
        fs.mkdirSync(NOTES_DIR, { recursive: true });
        fs.copyFileSync(from, path.join(NOTES_DIR, card.designNotes));
        designNotes = `notes/${card.designNotes}`;
      }
    }

    // Le illustrazioni seguono la stessa strada delle note: copiate in
    // docs/cards/art/, dove il sito pubblicato può raggiungerle.
    let art;
    if (card.art) {
      const from = path.join(DATA, "sets", setDir, "cards", id, card.art);
      if (fs.existsSync(from)) {
        fs.mkdirSync(ART_DIR, { recursive: true });
        fs.copyFileSync(from, path.join(ART_DIR, card.art));
        art = `art/${card.art}`;
      }
    }

    return { ...card, locales, source: { designNotes, art } };
  });

  return { ...set, cards };
});

// I mazzi sono oggetti dati come le carte: entrano nel bundle e le loro note
// di design vengono copiate in docs/ (GitHub Pages serve solo docs/).
const decksDir = path.join(DATA, "decks");
const decks = fs.existsSync(decksDir)
  ? fs.readdirSync(decksDir).filter(name => name.endsWith(".json")).map(name => {
      const deck = readJson(path.join("decks", name));
      let designNotes;
      if (deck.designNotes) {
        const from = path.join(decksDir, deck.designNotes);
        if (fs.existsSync(from)) {
          fs.mkdirSync(NOTES_DIR, { recursive: true });
          const copied = `deck-${deck.designNotes}`;
          fs.copyFileSync(from, path.join(NOTES_DIR, copied));
          designNotes = `notes/${copied}`;
        }
      }
      return { ...deck, source: { designNotes } };
    })
  : [];

const bundle = {
  ...catalog,
  _generated: "Generato da scripts/build-catalog.mjs — non modificare a mano. Fonte: data/",
  sets,
  cards: sets.flatMap(set => set.cards),
  decks
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
