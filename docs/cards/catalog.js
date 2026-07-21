import { defineCatalog } from "./core/domain.js";
import rubyfrontCore from "./sets/srbf-001/set.js";

const catalog = defineCatalog({
  schemaVersion: 1,
  id: "rubyfront-card-catalog",
  defaultLocale: "it",
  locales: {
    it: {
      name: "Catalogo carte Rubyfront",
      description: "Un unico indice per tutte le carte di tutti i set."
    },
    en: {
      name: "Rubyfront card catalog",
      description: "One index for every card across every set."
    }
  },
  sets: [
    rubyfrontCore
  ]
});

const setIndex = Object.freeze(Object.fromEntries(catalog.sets.map(set => [set.id, set])));
const cardIndex = Object.freeze(Object.fromEntries(catalog.cards.map(card => [card.id, card])));

export function getSetById(id) {
  return setIndex[id];
}

export function getCardById(id) {
  return cardIndex[id];
}

export default catalog;
