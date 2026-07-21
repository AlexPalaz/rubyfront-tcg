import { defineSet } from "../../core/domain.js";
import rubyfrontOfTheAbyss from "./rbf-001/card.js";

const set = defineSet({
  schemaVersion: 1,
  id: "rubyfront-core",
  code: "SRBF-001",
  cardIdPrefix: "RBF",
  status: "draft",
  defaultLocale: "it",
  source: {
    module: import.meta.url
  },
  locales: {
    it: {
      name: "Rubyfront — Set Base",
      description: "Set tecnico iniziale che raccoglie le carte fondanti di Rubyfront e stabilisce il formato dati usato dal futuro engine."
    },
    en: {
      name: "Rubyfront Core Set",
      description: "Initial technical set containing Rubyfront's foundational cards and defining the data format used by the future engine."
    }
  },
  cards: [
    rubyfrontOfTheAbyss
  ]
});

export default set;
