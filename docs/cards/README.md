# Architettura modulare delle carte

Il catalogo è **data-first**: catalogo, viste HTML e futuro engine importano gli stessi
moduli JavaScript. L’HTML è solo una rappresentazione dei dati e non contiene regole o
contenuti appartenenti a una carta specifica.

## Struttura

```text
cards/
├── catalog.js                         # registro globale di set e carte
├── core/
│   └── domain.js                      # schema v1, invarianti e helper condivisi
├── ui/                                # tutta e sola la UI HTML centralizzata
│   ├── shell.js                       # testi, rotte e costruttori della navigazione
│   ├── shell.css                      # unico stile della shell (con dark mode)
│   ├── index.html                     # catalogo globale con ricerca
│   ├── set.html                       # vista generica: ?set=<set-id>
│   ├── card.html                      # vista dati: ?card=<card-id>
│   ├── card-theme.html                # renderer visuale condiviso
│   ├── card-themes.html               # indice dei temi condivisi
│   └── *.js                           # renderer specifici delle singole viste
└── sets/
    └── srbf-001/                      # codice set: Season Rubyfront 001
        ├── set.js                     # manifesto; registra le carte del set
        └── rbf-001/                    # solo <card-id>
            ├── card.js                 # identità e regole machine-readable
            ├── locales/                # testi umani separati per lingua
            └── card.md                 # note specifiche della carta
```

Le cartelle di dominio non contengono HTML. Tutte le carte aprono le stesse pagine in
`ui/`, selezionando il contenuto tramite ID:

- `ui/set.html?set=rubyfront-core`
- `ui/card.html?card=RBF-001`
- `ui/card-theme.html?card=RBF-001&theme=t17&lang=it`

Il renderer `card-theme.html` costruisce le facce usando `card.faces` e le localizzazioni.
Lo stesso file può quindi visualizzare qualsiasi carta registrata, senza duplicare il
template nella cartella della carta.

## La shell di navigazione

Tutte e cinque le pagine condividono una sola shell: `shell.css` per lo stile e
`shell.js` per i costruttori (`element`, `breadcrumb`, `pageHeader`, `languagePicker`,
le rotte e il dizionario `COPY` con i testi IT/EN). Una vista costruisce solo il proprio
contenuto e non ridefinisce mai chrome, colori o testi di navigazione.

Due regole da rispettare quando si aggiunge una vista:

- le variabili della shell sono sotto namespace **`--ui-*`**, perché i temi grafici della
  carta usano `--bg`, `--ink`, `--muted` e `--accent` con significato proprio: non vanno
  mai mescolati;
- la **grafica della carta** (`.card` e i temi in `card-theme.html`) è volutamente fuori
  dalla shell — ha il suo font serif e la sua palette, e non deve uniformarsi alla
  navigazione.

La shell segue la preferenza di sistema per il tema chiaro/scuro e accetta un override
manuale con `data-theme="light"` o `data-theme="dark"` sull'elemento radice.

## Convenzione dei nomi

Gli identificatori rimangono stabili e separati dai nomi delle cartelle:

- cartella set: solo `<codice-set-minuscolo>`, per esempio `srbf-001`;
- cartella carta: solo `<card-id-minuscolo>`, per esempio `rbf-001`;
- ID carta: `<PREFISSO-CARTA>-<numero a tre cifre>`, per esempio `RBF-001`.

Il codice del set e il prefisso delle carte sono concetti distinti: `SRBF-001`
identifica la stagione/set “Season Rubyfront 001”, mentre `RBF` è il prefisso degli ID
delle carte Rubyfront contenute nel set.

Questa convenzione rende set e carte ordinabili e riconoscibili anche dal filesystem. Lo
script di validazione controlla che nomi, ID e codici coincidano.

## Relazioni fra catalogo, set e carte

La relazione è esplicita in entrambe le direzioni:

- `card.js` dichiara `setId`;
- `set.js` importa la carta e la inserisce nel proprio array `cards`;
- `catalog.js` importa il set e genera l’indice piatto globale `catalog.cards`.

`defineSet()` interrompe il caricamento se una carta dichiara un altro set o non usa il
prefisso carta previsto. `defineCatalog()` impedisce ID duplicati. Il catalogo globale usa
`catalog.cards`, quindi ricerca e navigazione comprendono automaticamente tutti i set
registrati.

## Contratto per il futuro engine

Ogni carta espone dati immutabili e privi di logica UI:

- identità stabile (`id`, `setId`, `collectorNumber`, `slug`);
- vincoli di costruzione (`deckLimit`, `type`, `status`);
- layout, facce e statistiche;
- Materie abilitate e parole chiave;
- trigger, costi, finestre, bersagli ed effetti strutturati;
- testi localizzati, separati dalla semantica eseguibile.

L’engine può importare l’intero catalogo:

```js
import catalog, { getCardById } from "./docs/cards/catalog.js";

const abyss = getCardById("RBF-001");
```

oppure una singola carta per test isolati:

```js
import abyss from "./docs/cards/sets/srbf-001/rbf-001/card.js";
```

I valori di `effect.type`, `event`, `timing`, `state`, `zone` e `duration` sono
identificatori destinati ai resolver dell’engine. I testi localizzati servono alla
presentazione e non devono essere interpretati per eseguire una regola.

## Aggiungere una carta

1. Scegliere l’ID, per esempio `RBF-002`, e creare
   `sets/srbf-001/rbf-002/`.
2. Aggiungere `card.js`, `locales/it.js` e le altre localizzazioni necessarie.
3. Importare il modulo in `sets/srbf-001/set.js` e aggiungerlo a `cards`.
4. Eseguire `node scripts/validate-card-catalog.mjs` dalla radice del repository.

Non occorre creare o copiare alcun HTML. La nuova carta compare nel catalogo globale,
nella pagina del set, nel dettaglio e nel renderer tematico perché tutte le viste leggono
il registro.

Per aggiungere un set, creare il manifesto sotto una cartella che rispetti la convenzione
e importarlo in `catalog.js`.

Le pagine usano moduli ES e richiedono un server statico. Dalla radice:

```sh
python3 -m http.server 8000
```

Poi aprire `http://localhost:8000/docs/cards/ui/`.
