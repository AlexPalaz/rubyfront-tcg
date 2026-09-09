# Architettura modulare delle carte

Il catalogo è **data-first**: viste web ed engine leggono gli stessi dati JSON,
che vivono in `/data` e non dipendono da alcun linguaggio. L’HTML è solo una
rappresentazione dei dati e non contiene regole né contenuti di una carta.

## Struttura

I **dati delle carte non vivono qui**: la fonte di verità è `/data` (JSON puro,
letto anche dall'engine Ruby — vedi `data/README.md`). Questa cartella contiene
solo la presentazione.

```text
cards/
├── catalog.json                       # GENERATO da data/ — non modificare
├── catalog.js                         # carica il bundle ed espone gli indici
├── notes/                             # GENERATO: note di design copiate da data/
└── ui/                                # tutta e sola la UI HTML centralizzata
    ├── shell.js                       # testi, rotte e costruttori della navigazione
    ├── shell.css                      # unico stile della shell (con dark mode)
    ├── index.html                     # catalogo globale con ricerca
    ├── set.html                       # vista generica: ?set=<set-id>
    ├── card.html                      # vista dati: ?card=<card-id>
    ├── card-theme.html                # renderer visuale condiviso
    ├── card-themes.html               # indice dei temi condivisi
    └── *.js                           # renderer specifici delle singole viste
```

Dopo ogni modifica ai dati serve `node scripts/build-catalog.mjs`, altrimenti il
sito continua a mostrare la versione precedente del catalogo.

Le carte si aprono selezionando il contenuto tramite ID:

- `ui/set.html?set=rubyfront-core`
- `ui/card.html?card=RBF-001`
- `ui/card-theme.html?card=RBF-001&theme=t17&lang=it`

Il renderer `card-theme.html` costruisce le facce usando `card.faces` e le
localizzazioni, quindi può visualizzare qualsiasi carta registrata senza
duplicare il template.

### I temi e la famiglia Cattedrale

I temi stanno in `ui/themes.js` (id e nome, l'insieme dei chiari) e in
`ui/card.css` (le variabili di ciascuno). Da t41 in su i temi sono una
**famiglia**, la Cattedrale: stessa architettura — cornice a lastra
ottagonale con la gemma di rubino in cuspide, nome a doppio filo, riquadro
del testo inciso — e palette diverse. Il renderer aggiunge la classe
`cathedral` (`CATHEDRAL_THEMES`), e `card.css` veste la struttura una volta
sola (`.cathedral …`); una palette nuova è solo un blocco di variabili.
Il renderer aggiunge anche la **tinta della Materia** come classe `mat-*`
(`destructive`, `dimensional`, `dynamic`), letta dalla Materia della carta o
da quelle che la faccia abilita; Distruttiva vince su Dimensionale, che vince
su Dinamica; chi non ha Materia (Entità e Oggetti che non abilitano nulla) è Dinamica. Il tema Rubino (t49) la
usa: tutto ciò che è rosso resta rubino per la Distruttiva, diventa bianco
argento per la Dinamica e blu per la Dimensionale (crepe al neon comprese,
con nuclei SVG e bagliore PNG in tre tinte).
Le palette sono **materiali con la loro luce**, a sfumature discrete:
`--card-*` il fondo della carta (alto→basso), `--stone-*` la pietra della
cornice (luce radente), `--band-*` la banda del nome, `--panel-*` il riquadro
del testo, `--gem-*` la gemma e il rombo del costo. Chi non dichiara
`--band-*`/`--panel-*` resta piatto (t41, t42). Le palette (2026-09-09):
Dark e Argento (t41, t42), Ossidiana (t43, vetro nero e rubino vivo),
Acciaio (t44, blu-acciaio con filo ciano), Bronzo (t45, metallo caldo),
Porcellana (t46, chiaro, la coppia di Rhazmora), Avorio (t47, chiaro, foglia
d'oro), Rame (t48, ardesia e rame), Rubino (t49: il rosso del marchio e dei
tasti del gioco fatto carta — cornice di rubino lucido, fondo vino, testi
rosa chiaro con l'oro per le parole in evidenza). Il rubino della gemma
resta rosso in tutte (canone dei Rubyfront, ART.md).

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

La relazione è esplicita in entrambe le direzioni, per id:

- `<id>.json` dichiara `setId`;
- `set.json` elenca gli id delle proprie carte in `cards`;
- `catalog.json` elenca i set, e il build genera l’indice piatto `cards`.

`validate-data.mjs` rifiuta una carta che dichiari un set diverso da quello che la
registra, che non usi il prefisso previsto, o che duplichi id e numero di
collezione.

## Contratto per l'engine

Le carte espongono dati immutabili e privi di logica UI: identità stabile,
vincoli di costruzione, facce e statistiche, Materie e parole chiave, trigger e
costi strutturati, testi localizzati separati dalla semantica eseguibile.

L'engine legge direttamente `/data` — non passa da JavaScript. I valori di
`effect.type`, `event`, `timing`, `state`, `zone` e `duration` sono dichiarati
in `data/vocabulary.json`, che è il contratto condiviso fra engine e viste.

## Aggiungere una carta

Si lavora in `/data`, mai qui: vedi `data/README.md`. In sintesi —

1. Creare la cartella `data/sets/<set>/cards/<id>/` con `<id>.json` più un file per lingua.
2. Aggiungere l’id all’array `cards` di `set.json`.
3. `node scripts/validate-data.mjs`
4. `node scripts/build-catalog.mjs`

Non occorre creare o copiare alcun HTML: la nuova carta compare nel catalogo, nella
pagina del set, nel dettaglio e nel renderer tematico, perché tutte le viste leggono
il bundle.

Le pagine usano moduli ES e `fetch`, quindi richiedono un server statico. Dalla radice:

```sh
python3 -m http.server 8000
```

Poi aprire `http://localhost:8000/docs/cards/ui/`.
