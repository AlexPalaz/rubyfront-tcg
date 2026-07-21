export const CARD_SCHEMA_VERSION = 1;

const CARD_STATUSES = new Set(["draft", "testing", "released", "retired"]);

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, path) {
  invariant(typeof value === "string" && value.trim().length > 0, `${path} must be a non-empty string`);
}

function requireUnique(values, path) {
  invariant(new Set(values).size === values.length, `${path} contains duplicate values`);
}

function validateLocales(locales, path, requiredFields) {
  invariant(isRecord(locales), `${path} must be an object keyed by locale`);
  const localeIds = Object.keys(locales);
  invariant(localeIds.length > 0, `${path} must contain at least one locale`);

  for (const localeId of localeIds) {
    requireString(localeId, `${path} locale id`);
    const locale = locales[localeId];
    invariant(isRecord(locale), `${path}.${localeId} must be an object`);
    for (const field of requiredFields) requireString(locale[field], `${path}.${localeId}.${field}`);
  }
}

function validateFaces(card) {
  invariant(Array.isArray(card.faces) && card.faces.length > 0, `${card.id}.faces must be a non-empty array`);
  requireUnique(card.faces.map(face => face.id), `${card.id}.faces`);

  const actionIds = [];
  for (const face of card.faces) {
    requireString(face.id, `${card.id}.faces[].id`);
    requireString(face.kind, `${card.id}.${face.id}.kind`);
    requireString(face.displayKey, `${card.id}.${face.id}.displayKey`);
    invariant(isRecord(face.stats), `${card.id}.${face.id}.stats must be an object`);
    invariant(Array.isArray(face.enablesMatters), `${card.id}.${face.id}.enablesMatters must be an array`);
    invariant(Array.isArray(face.keywords), `${card.id}.${face.id}.keywords must be an array`);
    invariant(isRecord(face.requirements), `${card.id}.${face.id}.requirements must be an object`);
    invariant(Array.isArray(face.triggers), `${card.id}.${face.id}.triggers must be an array`);
    invariant(Array.isArray(face.actions), `${card.id}.${face.id}.actions must be an array`);

    for (const matter of face.enablesMatters) {
      invariant(isRecord(matter), `${card.id}.${face.id}.enablesMatters[] must be an object`);
      requireString(matter.type, `${card.id}.${face.id}.enablesMatters[].type`);
    }

    for (const keyword of face.keywords) {
      invariant(isRecord(keyword), `${card.id}.${face.id}.keywords[] must be an object`);
      requireString(keyword.id, `${card.id}.${face.id}.keywords[].id`);
    }

    for (const trigger of face.triggers) {
      invariant(isRecord(trigger), `${card.id}.${face.id}.triggers[] must be an object`);
      requireString(trigger.id, `${card.id}.${face.id}.triggers[].id`);
      requireString(trigger.displayKey, `${card.id}.${face.id}.${trigger.id}.displayKey`);
      requireString(trigger.event, `${card.id}.${face.id}.${trigger.id}.event`);
      invariant(isRecord(trigger.effect), `${card.id}.${face.id}.${trigger.id}.effect must be an object`);
    }

    for (const action of face.actions) {
      requireString(action.id, `${card.id}.${face.id}.actions[].id`);
      requireString(action.displayKey, `${card.id}.${face.id}.${action.id}.displayKey`);
      invariant(isRecord(action.cost), `${card.id}.${face.id}.${action.id}.cost must be an object`);
      invariant(Array.isArray(action.timing), `${card.id}.${face.id}.${action.id}.timing must be an array`);
      invariant(isRecord(action.effect), `${card.id}.${face.id}.${action.id}.effect must be an object`);
      actionIds.push(action.id);
    }
  }
  requireUnique(actionIds, `${card.id} action ids`);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function defineCard(card) {
  invariant(isRecord(card), "Card definition must be an object");
  invariant(card.schemaVersion === CARD_SCHEMA_VERSION, `Unsupported card schema version: ${card.schemaVersion}`);
  requireString(card.id, "card.id");
  invariant(/^[A-Z0-9]+-\d{3}$/.test(card.id), `${card.id}.id must use the SET-000 format`);
  requireString(card.setId, `${card.id}.setId`);
  requireString(card.collectorNumber, `${card.id}.collectorNumber`);
  invariant(/^\d{3}$/.test(card.collectorNumber), `${card.id}.collectorNumber must contain three digits`);
  invariant(card.id.endsWith(`-${card.collectorNumber}`), `${card.id}.collectorNumber does not match its id`);
  requireString(card.slug, `${card.id}.slug`);
  invariant(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(card.slug), `${card.id}.slug must be kebab-case`);
  requireString(card.type, `${card.id}.type`);
  requireString(card.layout, `${card.id}.layout`);
  invariant(CARD_STATUSES.has(card.status), `${card.id}.status is not supported`);
  invariant(Number.isInteger(card.deckLimit) && card.deckLimit > 0, `${card.id}.deckLimit must be a positive integer`);
  requireString(card.defaultLocale, `${card.id}.defaultLocale`);
  validateLocales(card.locales, `${card.id}.locales`, ["name", "typeLabel", "summary"]);
  invariant(card.locales[card.defaultLocale], `${card.id}.defaultLocale is not available`);
  invariant(isRecord(card.source), `${card.id}.source must be an object`);
  requireString(card.source.module, `${card.id}.source.module`);
  invariant(Array.isArray(card.tags), `${card.id}.tags must be an array`);
  validateFaces(card);
  return deepFreeze(card);
}

export function defineSet(set) {
  invariant(isRecord(set), "Set definition must be an object");
  invariant(set.schemaVersion === CARD_SCHEMA_VERSION, `Unsupported set schema version: ${set.schemaVersion}`);
  requireString(set.id, "set.id");
  invariant(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(set.id), `${set.id}.id must be kebab-case`);
  requireString(set.code, `${set.id}.code`);
  invariant(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(set.code), `${set.id}.code must be an uppercase code`);
  requireString(set.cardIdPrefix, `${set.id}.cardIdPrefix`);
  invariant(/^[A-Z0-9]+$/.test(set.cardIdPrefix), `${set.id}.cardIdPrefix must be uppercase alphanumeric`);
  requireString(set.defaultLocale, `${set.id}.defaultLocale`);
  validateLocales(set.locales, `${set.id}.locales`, ["name", "description"]);
  invariant(set.locales[set.defaultLocale], `${set.id}.defaultLocale is not available`);
  invariant(CARD_STATUSES.has(set.status), `${set.id}.status is not supported`);
  invariant(Array.isArray(set.cards), `${set.id}.cards must be an array`);
  invariant(isRecord(set.source), `${set.id}.source must be an object`);
  requireString(set.source.module, `${set.id}.source.module`);

  for (const card of set.cards) {
    invariant(card.setId === set.id, `${card.id} points to ${card.setId}, but is registered in ${set.id}`);
    invariant(card.id.startsWith(`${set.cardIdPrefix}-`), `${card.id} does not use card prefix ${set.cardIdPrefix}`);
  }
  requireUnique(set.cards.map(card => card.id), `${set.id}.cards ids`);
  requireUnique(set.cards.map(card => card.collectorNumber), `${set.id}.collector numbers`);
  return deepFreeze(set);
}

export function defineCatalog(catalog) {
  invariant(isRecord(catalog), "Catalog definition must be an object");
  invariant(catalog.schemaVersion === CARD_SCHEMA_VERSION, `Unsupported catalog schema version: ${catalog.schemaVersion}`);
  requireString(catalog.id, "catalog.id");
  requireString(catalog.defaultLocale, `${catalog.id}.defaultLocale`);
  validateLocales(catalog.locales, `${catalog.id}.locales`, ["name", "description"]);
  invariant(catalog.locales[catalog.defaultLocale], `${catalog.id}.defaultLocale is not available`);
  invariant(Array.isArray(catalog.sets), `${catalog.id}.sets must be an array`);
  requireUnique(catalog.sets.map(set => set.id), `${catalog.id}.sets`);

  const cards = catalog.sets.flatMap(set => set.cards);
  requireUnique(cards.map(card => card.id), `${catalog.id} card ids`);
  return deepFreeze({ ...catalog, cards });
}

export function localize(resource, localeId) {
  return resource.locales[localeId] ?? resource.locales[resource.defaultLocale];
}

export function resolveSource(resource, key) {
  const relativePath = resource.source[key];
  invariant(typeof relativePath === "string", `${resource.id}.source.${key} is not defined`);
  return new URL(relativePath, resource.source.module).href;
}
