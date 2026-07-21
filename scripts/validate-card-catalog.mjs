import catalog, { getCardById, getSetById } from "../docs/cards/catalog.js";
import { readdirSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const errors = [];
const cardsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/cards");

function moduleFolder(moduleUrl) {
  return basename(dirname(fileURLToPath(moduleUrl)));
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

for (const set of catalog.sets) {
  if (getSetById(set.id) !== set) errors.push(`Set index mismatch: ${set.id}`);
  const expectedSetFolder = set.code.toLowerCase();
  const actualSetFolder = moduleFolder(set.source.module);
  if (actualSetFolder !== expectedSetFolder) {
    errors.push(`${set.id}: expected folder ${expectedSetFolder}, got ${actualSetFolder}`);
  }
  for (const card of set.cards) {
    if (getCardById(card.id) !== card) errors.push(`Card index mismatch: ${card.id}`);
    if (card.setId !== set.id) errors.push(`${card.id}: expected setId ${set.id}, got ${card.setId}`);
    const expectedCardFolder = card.id.toLowerCase();
    const actualCardFolder = moduleFolder(card.source.module);
    if (actualCardFolder !== expectedCardFolder) {
      errors.push(`${card.id}: expected folder ${expectedCardFolder}, got ${actualCardFolder}`);
    }

    for (const localeId of Object.keys(card.locales)) {
      const locale = card.locales[localeId];
      for (const face of card.faces) {
        const display = locale[face.displayKey];
        if (!display) errors.push(`${card.id}: missing ${localeId}.${face.displayKey}`);
        for (const action of face.actions) {
          if (!display?.abilities?.[action.displayKey]) {
            errors.push(`${card.id}: missing ${localeId}.${face.displayKey}.abilities.${action.displayKey}`);
          }
        }
      }
    }
  }
}

for (const htmlFile of filesUnder(cardsRoot).filter(path => path.endsWith(".html"))) {
  const location = relative(cardsRoot, htmlFile).split(sep);
  if (location[0] !== "ui") errors.push(`HTML outside cards/ui: ${relative(cardsRoot, htmlFile)}`);
}

if (errors.length) {
  console.error(errors.map(error => `✗ ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  const cardLabel = catalog.cards.length === 1 ? "carta" : "carte";
  console.log(`✓ Catalogo valido: ${catalog.sets.length} set, ${catalog.cards.length} ${cardLabel}, schema v${catalog.schemaVersion}`);
}
