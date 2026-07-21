export default Object.freeze({
  name: "Rubifronte degli Abissi",
  typeLabel: "Rubyfront bifronte",
  summary: "Controllo per logoramento: filtra il mazzo, indebolisce il Fronte avversario e divora le Entità più deboli.",
  ui: {
    faceA: "Faccia A — Rubyfront",
    faceB: "Faccia B — Unione"
  },
  card: {
    illustration: "Illustrazione",
    hp: "PV",
    unionRequirement: {
      label: "Requisito Unione",
      text: "Rivela un Umano con Zero in fondo avendo la mano vuota"
    }
  },
  matters: {
    destructiveTitle: "Materia Distruttiva · fino al 2° grado",
    destructiveAria: "Distruttiva",
    zeroTitle: "Materia Zero",
    zeroAria: "Zero"
  },
  faceA: {
    name: "Rubifronte degli Abissi",
    keyword: {
      name: "Furia",
      rules: "d20 ≥ 12 prima di ogni azione · fallimento −3 PV"
    },
    trigger: "Allo schieramento",
    effect: {
      name: "Risacca",
      text: "Guarda la prima carta del mazzo. Puoi metterla in fondo."
    },
    abilities: {
      pressure: {
        name: "Pressione Abissale",
        text: "un’Entità avversaria prende −2 Potenza fino al tuo prossimo turno."
      },
      devour: {
        name: "Divorare",
        text: "metti un’Entità avversaria con Potenza ≤ 3 in fondo al mazzo del suo proprietario."
      }
    },
    flavor: "Non emerse. Gli abissi aprirono gli occhi."
  },
  faceB: {
    name: "Incarnazione dell’Abisso",
    unionAria: "Unione",
    trigger: "Al flip",
    effect: {
      name: "La Prima Ondata",
      text: "Tappa un’Entità avversaria."
    },
    abilities: {
      tide: {
        name: "Marea Crescente",
        text: "fino a due Entità avversarie prendono −2 Potenza fino al tuo prossimo turno."
      },
      abyss: {
        name: "La Grande Marea",
        text: "tappa ogni Entità avversaria."
      }
    },
    flavor: "L’abisso prese forma. Il mondo arretrò."
  }
});
