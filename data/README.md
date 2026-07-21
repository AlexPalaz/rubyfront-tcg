# Dati madre

Questa cartella è la **fonte di verità** delle carte. È JSON puro, senza codice:
la leggono l'engine (Ruby), le viste web (JS) e il validatore, senza che nessuno
dei tre debba conoscere gli altri.

**Nessun dato di gioco vive fuori da qui.** `docs/` contiene solo la
presentazione, e ciò che serve al sito è generato (vedi sotto).

## Struttura

```text
data/
├── catalog.json                  # indice: quali set esistono
├── vocabulary.json               # registro degli identificatori legali
└── sets/
    └── srbf-001/
        ├── set.json              # manifesto del set; elenca gli id delle carte
        └── cards/
            ├── rbf-001.json      # semantica eseguibile (niente testi)
            ├── rbf-001.it.json   # testi italiani
            ├── rbf-001.en.json   # testi inglesi
            └── rbf-001.md        # note di design (prosa)
```

La separazione fra `rbf-001.json` e i file di lingua è deliberata: la prima
contiene ciò che l'engine **esegue**, gli altri ciò che l'utente **legge**. Un
traduttore lavora sui secondi senza poter rompere una regola.

## Il registro (`vocabulary.json`)

Elenca ogni identificatore che l'engine sa interpretare: `event`, `effect`,
`timing`, `state`, `zone`, `duration`, `keyword`, `matter` e gli altri.

È il **contratto condiviso fra Ruby e JavaScript**. Una carta che usa un valore
non dichiarato qui viene rifiutata dal validatore, quindi un refuso
(`until_next_turn` invece di `until_controller_next_turn`) fallisce in fase di
build e non a partita in corso.

Aggiungere un valore al registro è una decisione di design: significa impegnare
l'engine a saperlo risolvere.

## Comandi

```sh
node scripts/validate-data.mjs        # forma + vocabolario
node scripts/build-catalog.mjs        # genera docs/cards/catalog.json
node scripts/build-catalog.mjs --check # fallisce se il bundle è disallineato
```

`docs/cards/catalog.json` e `docs/cards/notes/` sono **artefatti generati**: non
vanno modificati a mano. Esistono perché il sito pubblicato serve solo `docs/`,
e perché al browser conviene una richiesta sola invece di una per file.

Dopo ogni modifica ai dati va rieseguito il build, altrimenti il sito mostra la
versione precedente. Il flag `--check` serve proprio a intercettare questa
dimenticanza.

## Aggiungere una carta

1. Creare `sets/<set>/cards/<id>.json` più un file per ogni lingua.
2. Aggiungere l'id all'array `cards` di `set.json`.
3. `node scripts/validate-data.mjs` — corregge i valori fuori registro.
4. `node scripts/build-catalog.mjs` — aggiorna il sito.

Non serve toccare alcun HTML o JavaScript: le viste leggono il registro.

## Proprietario delle zone

Una zona non porta mai il proprietario nel nome. Si scrive sempre così:

```json
{ "zone": "deck", "owner": "card_owner", "position": "bottom" }
```

`owner` è obbligatorio ovunque compaia `zone`, e il validatore lo pretende. I
valori sono in `zoneOwner`:

- `controller` — chi sta giocando l'effetto;
- `opponent` — il suo avversario;
- `card_owner` — **il proprietario della carta coinvolta**, che non coincide con
  chi gioca l'effetto. È il caso di *Divorare*: l'Entità avversaria finisce in
  fondo al mazzo **del suo proprietario** (MANUALE.md §3.1).

Questa distinzione nasce da un'ambiguità reale: prima esisteva un solo token
`owner_deck` usato in due punti con **due significati diversi** — il mazzo del
controllore nel requisito Unione, quello dell'avversario in *Divorare*. Un
engine non avrebbe potuto distinguerli.

## Combinare condizioni e confrontare valori

Sono due cose diverse e portano due nomi diversi. `match` dice **come si
combinano** più condizioni, `operator` dice **come si confronta** un valore:

```json
"union": {
  "match": "all",
  "conditions": [
    { "type": "hand_size", "equals": 0 },
    { "type": "reveal_card", "zone": "deck", "owner": "controller" }
  ]
}
```

```json
{ "stat": "power", "operator": "lte", "value": 3 }
```

`match` accetta `all | any | none`, `operator` accetta `lt | lte | eq | gte |
gt`. Nel registro le due categorie si chiamano come i campi che governano, così
il vocabolario giusto si deduce dal nome e non dalla posizione nell'albero.

Prima entrambi si chiamavano `operator`: leggendo `"operator": "all"` non si
poteva sapere quale dei due fosse senza guardare dove stava, e il validatore lo
indovinava con un'euristica sui campi vicini. Un engine avrebbe dovuto fare la
stessa scommessa, senza garanzia di farla allo stesso modo.

## Regola generale

Le tre convenzioni qui sopra hanno la stessa radice: **un nome, un significato**.
Se un campo vuol dire due cose a seconda di dove si trova, o se un valore
nasconde un'informazione nel proprio nome, l'engine deve dedurre — e dedurre in
silenzio è il modo in cui i dati e il codice divergono senza che nessuno se ne
accorga.
