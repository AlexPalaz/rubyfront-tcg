// Accesso al catalogo per le viste.
//
// I dati madre stanno in /data (JSON, letti anche dall'engine Ruby).
// Qui si consuma il bundle generato docs/cards/catalog.json: nessuna
// definizione di carta vive più in JavaScript.

const BUNDLE_URL = new URL("./catalog.json", import.meta.url);

const catalog = await fetch(BUNDLE_URL).then(response => {
  if (!response.ok) throw new Error(`Catalogo non caricato (${response.status} da ${BUNDLE_URL})`);
  return response.json();
});

const setIndex = Object.freeze(Object.fromEntries(catalog.sets.map(set => [set.id, set])));
const cardIndex = Object.freeze(Object.fromEntries(catalog.cards.map(card => [card.id, card])));
const deckIndex = Object.freeze(Object.fromEntries((catalog.decks ?? []).map(deck => [deck.id, deck])));

export function getSetById(id) {
  return setIndex[id];
}

export function getCardById(id) {
  return cardIndex[id];
}

export function getDeckById(id) {
  return deckIndex[id];
}

export function localize(resource, localeId) {
  return resource.locales[localeId] ?? resource.locales[resource.defaultLocale];
}

// I percorsi in source sono relativi a docs/cards/, dove vive questo modulo:
// il build copia lì tutto ciò che deve restare raggiungibile dal sito.
export function resolveSource(resource, key) {
  const relative = resource.source?.[key];
  if (typeof relative !== "string") throw new TypeError(`${resource.id}.source.${key} non definito`);
  return new URL(`./${relative}`, import.meta.url).href;
}

export default catalog;
