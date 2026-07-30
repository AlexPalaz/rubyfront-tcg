#!/usr/bin/env node
// Valida i dati madre in data/ contro il registro data/vocabulary.json.
// Controlla due cose distinte:
//   1. la FORMA (campi obbligatori, tipi, formati degli id)
//   2. il VOCABOLARIO (ogni identificatore è dichiarato nel registro)
// Il secondo controllo è il motivo per cui il registro esiste: senza,
// un refuso in un effect.type passa la build e fallisce a runtime.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const SCHEMA_VERSION = 1;

const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);

const readJson = relative => {
  const full = path.join(DATA, relative);
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (error) {
    fail(relative, `JSON illeggibile — ${error.message}`);
    return undefined;
  }
};

// ---- registro ----------------------------------------------------------
const vocabulary = readJson("vocabulary.json");
if (!vocabulary) {
  console.error("✗ vocabulary.json mancante o illeggibile");
  process.exit(1);
}

const allowed = Object.fromEntries(
  Object.entries(vocabulary)
    .filter(([, value]) => value && Array.isArray(value.values))
    .map(([key, value]) => [key, new Set(value.values)])
);

function checkTerm(kind, value, where) {
  if (value === undefined) return;
  const set = allowed[kind];
  if (!set) return fail(where, `il registro non definisce la categoria "${kind}"`);
  if (!set.has(value)) {
    fail(where, `"${value}" non è nel registro (${kind}). Valori ammessi: ${[...set].join(", ")}`);
  }
}

// ---- forma -------------------------------------------------------------
const isRecord = v => v !== null && typeof v === "object" && !Array.isArray(v);

function requireString(value, where) {
  if (typeof value !== "string" || !value.trim()) fail(where, "deve essere una stringa non vuota");
}

function requireLocales(locales, where, fields) {
  if (!isRecord(locales)) return fail(where, "locales deve essere un oggetto per lingua");
  const ids = Object.keys(locales);
  if (!ids.length) return fail(where, "serve almeno una lingua");
  for (const id of ids) {
    for (const field of fields) requireString(locales[id]?.[field], `${where}.${id}.${field}`);
  }
}

// Attraversa un effetto/bersaglio e verifica ogni identificatore incontrato.
function checkEffectTree(node, where) {
  if (Array.isArray(node)) return node.forEach((item, i) => checkEffectTree(item, `${where}[${i}]`));
  if (!isRecord(node)) return;

  // Ogni riferimento a una zona deve dire di chi è quella zona: il
  // proprietario non si esprime più nel nome della zona (niente owner_deck).
  if (typeof node.zone === "string" && node.owner === undefined) {
    fail(where, `zone "${node.zone}" senza owner: indicare di chi è la zona (${[...(allowed.zoneOwner ?? [])].join(", ")})`);
  }

  for (const [key, value] of Object.entries(node)) {
    const at = `${where}.${key}`;
    if (typeof value === "string") {
      if (key === "zone") checkTerm("zone", value, at);
      else if (key === "owner") checkTerm("zoneOwner", value, at);
      else if (key === "position") checkTerm("position", value, at);
      else if (key === "state") checkTerm("state", value, at);
      else if (key === "duration") checkTerm("duration", value, at);
      else if (key === "controller") checkTerm("controller", value, at);
      else if (key === "cardType") checkTerm("cardType", value, at);
      else if (key === "race") checkTerm("race", value, at);
      else if (key === "stat") checkTerm("stat", value, at);
      // Ogni campo ha un solo vocabolario: "match" combina condizioni,
      // "operator" confronta valori. Nessuna deduzione dal contesto.
      else if (key === "match") checkTerm("match", value, at);
      else if (key === "operator") checkTerm("operator", value, at);
    }
    checkEffectTree(value, at);
  }
}

function validateCard(card, where, set) {
  if (card.schemaVersion !== SCHEMA_VERSION) fail(where, `schemaVersion attesa ${SCHEMA_VERSION}`);
  requireString(card.id, `${where}.id`);
  if (!/^[A-Z0-9]+-\d{3}$/.test(card.id ?? "")) fail(where, `id "${card.id}" non usa il formato SET-000`);
  if (!/^\d{3}$/.test(card.collectorNumber ?? "")) fail(where, "collectorNumber deve avere tre cifre");
  if (!card.id?.endsWith(`-${card.collectorNumber}`)) fail(where, "collectorNumber non combacia con l'id");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(card.slug ?? "")) fail(where, "slug deve essere kebab-case");
  if (!Number.isInteger(card.deckLimit) || card.deckLimit <= 0) fail(where, "deckLimit deve essere un intero positivo");
  checkTerm("cardType", card.type, `${where}.type`);

  // Regole di copia (MANUALE.md §3.1): massimo 3 copie, 1 per le Uniche.
  // Politica di set: ogni Materia Zero o Dominante è Unica.
  if (card.unique === true && card.deckLimit !== 1) {
    fail(where, "una carta Unica deve avere deckLimit 1 (§3.1)");
  }
  if (card.unique !== true && card.type !== "rubyfront" && card.deckLimit > 3) {
    fail(where, `deckLimit ${card.deckLimit} oltre il massimo di 3 copie (§3.1); serve la classificazione Unica per limiti diversi`);
  }
  for (const face of card.faces ?? []) {
    const matterType = face.matter?.type;
    if ((matterType === "zero" || matterType === "dominant") && card.unique !== true) {
      fail(where, `le Materie ${matterType} sono Uniche per politica di set: manca "unique": true`);
    }
  }

  if (set) {
    if (card.setId !== set.id) fail(where, `setId "${card.setId}" ma è registrata in "${set.id}"`);
    if (!card.id?.startsWith(`${set.cardIdPrefix}-`)) fail(where, `id non usa il prefisso ${set.cardIdPrefix}`);
  }

  if (!Array.isArray(card.faces) || !card.faces.length) return fail(where, "faces deve essere un array non vuoto");

  for (const face of card.faces) {
    const at = `${where}.${face.id}`;
    requireString(face.id, `${at}.id`);
    requireString(face.displayKey, `${at}.displayKey`);

    for (const matter of face.enablesMatters ?? []) {
      checkTerm("matter", matter.type, `${at}.enablesMatters`);
      if (matter.maxGrade !== undefined && ![1, 2].includes(matter.maxGrade)) {
        fail(`${at}.enablesMatters`, `maxGrade ${matter.maxGrade} non valido (1 o 2)`);
      }
    }

    for (const keyword of face.keywords ?? []) checkTerm("keyword", keyword.id, `${at}.keywords`);

    for (const trigger of face.triggers ?? []) {
      checkTerm("event", trigger.event, `${at}.${trigger.id}.event`);
      checkTerm("effect", trigger.effect?.type, `${at}.${trigger.id}.effect.type`);
      checkEffectTree(trigger.effect, `${at}.${trigger.id}.effect`);
    }

    for (const action of face.actions ?? []) {
      for (const timing of action.timing ?? []) checkTerm("timing", timing, `${at}.${action.id}.timing`);
      checkTerm("effect", action.effect?.type, `${at}.${action.id}.effect.type`);
      checkEffectTree(action.effect, `${at}.${action.id}.effect`);
      // ogni check dichiarato deve corrispondere a una parola chiave della faccia
      for (const check of action.checks ?? []) {
        checkTerm("keyword", check, `${at}.${action.id}.checks`);
        if (!(face.keywords ?? []).some(k => k.id === check)) {
          fail(`${at}.${action.id}.checks`, `"${check}" non è una parola chiave di questa faccia`);
        }
      }
    }

    checkEffectTree(face.requirements, `${at}.requirements`);
    for (const condition of face.requirements?.nexus?.conditions ?? []) {
      checkTerm("condition", condition.type, `${at}.requirements.nexus`);
    }
  }
}

// ---- attraversa il catalogo -------------------------------------------
const catalog = readJson("catalog.json");
// id carta -> { type, deckLimit }: serve alla validazione dei mazzi.
const cardIndex = new Map();
if (catalog) {
  requireLocales(catalog.locales, "catalog", ["name", "description"]);
  const cardIds = new Set();
  const collectorKeys = new Set();

  for (const setDir of catalog.sets ?? []) {
    const set = readJson(path.join("sets", setDir, "set.json"));
    if (!set) continue;
    const where = `sets/${setDir}/set.json`;
    requireLocales(set.locales, where, ["name", "description"]);
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(set.code ?? "")) fail(where, "code deve essere maiuscolo");

    for (const cardId of set.cards ?? []) {
      const file = path.join("sets", setDir, "cards", `${cardId.toLowerCase()}.json`);
      const card = readJson(file);
      if (!card) continue;
      validateCard(card, file, set);

      if (cardIds.has(card.id)) fail(file, `id duplicato ${card.id}`);
      cardIds.add(card.id);
      cardIndex.set(card.id, { type: card.type, deckLimit: card.deckLimit });
      const key = `${set.id}/${card.collectorNumber}`;
      if (collectorKeys.has(key)) fail(file, `collectorNumber duplicato in ${set.id}`);
      collectorKeys.add(key);

      // le localizzazioni dichiarate devono esistere come file
      for (const locale of card.locales ?? [card.defaultLocale]) {
        const localeFile = path.join("sets", setDir, "cards", `${cardId.toLowerCase()}.${locale}.json`);
        if (!fs.existsSync(path.join(DATA, localeFile))) fail(file, `manca il file di lingua ${localeFile}`);
        else requireLocales({ [locale]: readJson(localeFile) }, localeFile, ["name", "typeLabel", "summary"]);
      }
    }
  }
  console.log(`  carte: ${cardIds.size}, set: ${catalog.sets?.length ?? 0}`);
}

// ---- mazzi -------------------------------------------------------------
// Le regole di costruzione vengono dal manuale (§3.1): 40 carte esatte,
// Rubyfront incluso (esattamente uno), copie entro il deckLimit della carta.
const decksDir = path.join(DATA, "decks");
if (fs.existsSync(decksDir)) {
  const deckFiles = fs.readdirSync(decksDir).filter(name => name.endsWith(".json"));
  for (const name of deckFiles) {
    const relative = path.join("decks", name);
    const deck = readJson(relative);
    if (!deck) continue;
    if (deck.schemaVersion !== SCHEMA_VERSION) fail(relative, `schemaVersion attesa ${SCHEMA_VERSION}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(deck.id ?? "")) fail(relative, "id deve essere kebab-case");
    requireLocales(deck.locales, relative, ["name", "description"]);

    let total = 0;
    let rubyfronts = 0;
    const seen = new Set();
    for (const entry of deck.cards ?? []) {
      const where = `${relative}.${entry.card}`;
      const known = cardIndex.get(entry.card);
      if (!known) { fail(where, "carta non registrata nel catalogo"); continue; }
      if (seen.has(entry.card)) fail(where, "voce duplicata nel mazzo");
      seen.add(entry.card);
      if (!Number.isInteger(entry.count) || entry.count <= 0) fail(where, "count deve essere un intero positivo");
      else {
        if (entry.count > known.deckLimit) fail(where, `count ${entry.count} oltre il deckLimit ${known.deckLimit}`);
        total += entry.count;
        if (known.type === "rubyfront") rubyfronts += entry.count;
      }
    }
    if (total !== 40) fail(relative, `il mazzo ha ${total} carte: devono essere esattamente 40 (§3.1)`);
    if (rubyfronts !== 1) fail(relative, `il mazzo contiene ${rubyfronts} Rubyfront: dev'essere esattamente uno (§3.1)`);
  }
  console.log(`  mazzi: ${deckFiles.length}`);
}

if (errors.length) {
  console.error(`✗ ${errors.length} problema/i nei dati:\n` + errors.map(e => `  - ${e}`).join("\n"));
  process.exit(1);
}
console.log("✓ Dati validi: forma e vocabolario");
