# Rubyfront

Un gioco di carte in due, e gli strumenti per farlo vivere: il catalogo delle
carte, il sito che le mostra, il simulatore per giocarle online e l'engine
che fa rispettare le regole. Le regole stanno in `docs/MANUALE.md` (in
inglese: `docs/MANUAL.md`), il mondo in `docs/LORE.md`, la grafica in
`docs/ART.md`: sono le fonti di verità, tutto il resto discende da lì.

## Il disegno

```mermaid
flowchart LR
  subgraph fonti["Fonti di verità"]
    MAN[/"docs/MANUALE.md<br/>le regole"/]
    DATA[("data/sets/…/RBF-xxx.json<br/>dati madre di ogni carta<br/>+ testi .it / .en")]
  end

  subgraph build["Script (node scripts/…)"]
    BC["build-catalog.mjs"]
    VAL["validate-data.mjs<br/>check-card-text.mjs"]
  end

  subgraph sito["docs/ · GitHub Pages"]
    CAT[("docs/cards/catalog.json")]
    UI["docs/cards/ui/<br/>card-render.js · card.css<br/>la grafica delle carte"]
    PAGES["pagine carte e mazzi"]
    SIM["docs/simulatore/<br/>build Vite del simulatore"]
  end

  subgraph client["simulatore/ (TypeScript, nel browser)"]
    ST["state.ts<br/>il riduttore"]
    TB["table.ts · hud.ts<br/>il tavolo"]
    EF["effects.ts<br/>interprete degli effetti"]
    RN["renderer.ts<br/>cardStats: l'anagrafe del client"]
    NET["net.ts"]
    EL["engine.ts"]
  end

  subgraph engine["engine/ (Ruby, senza dipendenze)"]
    CI["card_index.rb<br/>l'anagrafe"]
    EN["engine.rb<br/>il giudizio"]
    TR["table.rb<br/>la copia del tavolo"]
    WS["bin/server"]
  end

  RELAY["scripts/relay.mjs<br/>su Render (free)<br/>ripete, non legge"]
  PEER["il simulatore<br/>dell'avversario"]

  MAN -. "una regola alla volta" .-> EN
  DATA --> BC --> CAT
  DATA --> VAL
  CAT --> PAGES
  UI --> PAGES
  CAT --> RN
  UI --> TB
  DATA -- "letti all'avvio" --> CI --> EN
  EN <--> TR
  RN --> EF --> TB
  TB --> ST
  ST <--> NET
  NET <-- "wss, stanza" --> RELAY <--> PEER
  ST <--> EL
  EL <-- "ws :8788, judge / verdict" --> WS --> EN
```

Chi legge cosa:

| Pezzo | Legge | Quando |
|---|---|---|
| Sito e simulatore | `docs/cards/catalog.json` | a ogni apertura della pagina |
| `catalog.json` | `data/` | quando si lancia `node scripts/build-catalog.mjs` |
| Engine | `data/` | all'avvio di `ruby engine/bin/server` |
| Engine | `docs/MANUALE.md` | mai da solo: ogni § entra a mano, con i suoi test |

Le due **anagrafi** — `card_index.rb` nell'engine, `cardStats` in
`renderer.ts` nel client — leggono gli stessi campi con gli stessi criteri:
tipo, razza, statistiche, abilitazioni e le **forme certificate** degli
effetti. Una forma che non combacia esattamente non entra: l'engine preferisce
ignorare un effetto piuttosto che fraintenderlo, e il test dell'anagrafe tiene
il conto di ciò che resta da collegare (il «debito dichiarato»).

## Come viaggia un'azione

Il simulatore è il poliziotto, l'engine dà le regole. Ogni gesto locale si
ferma finché l'arbitro non risponde; su un «no» il gesto non avviene e il
tavolo mostra il sigillo con il § del manuale.

```mermaid
sequenceDiagram
  participant G as Giocatore
  participant T as Tavolo (table.ts)
  participant E as Engine (Ruby)
  participant S as Stato (state.ts)
  participant R as Relay
  participant P as Avversario

  G->>T: trascina, doppio click, «Attacca»…
  T->>E: judge {action, actor}
  alt ruled: false — nessuna regola
    E-->>T: passa
  else ruled: true, ok: true
    E-->>T: passa
  else ruled: true, ok: false
    E-->>T: reason / reason_en (§x.y)
    T->>G: sigillo «Azione fermata», la carta torna da dov'era
  end
  T->>S: apply(action) — il riduttore
  S->>R: action
  R->>P: action
  P->>P: apply(action) + consult all'engine suo:<br/>una violazione si annota in chat, non si ferma
```

Tre forme di regola, dalla più piccola:

1. **Dogana** — l'engine dice «no» a un'azione che c'è già (`toZone`, `declare`,
   `turn`…). Vive solo in `engine.rb`.
2. **Automatismo dei gemelli** — il tavolo fa da sé ciò che il manuale dà per
   scontato (la routine del cambio di turno, gli Oggetti che seguono
   l'Entità). Vive in `state.ts` **e** in `table.rb`, stessa semantica, test
   speculari.
3. **Azione calcolata e verificata** — il client calcola (risoluzione delle
   battaglie, fine partita, dado) e manda un'azione sola con l'esito;
   l'engine rifà il conto e passa solo un esito identico.

## Gli effetti delle carte

```mermaid
flowchart TB
  J[("RBF-026.json<br/>faces[].triggers[]")]
  J --> P1["card_index.rb<br/>attack_draws(faces)"]
  J --> P2["renderer.ts<br/>attackDrawsOf(face)"]
  P1 -- "{draw: 1, then_discard: 1,<br/>requires_object: true}" --> JE["engine.rb<br/>judge_effect_attack_draw"]
  P2 -- "{draw: 1, thenDiscard: 1,<br/>requiresObject: true}" --> EF["effects.ts<br/>attackDraws · resolveAttackDraw"]
  EF --> SC["la scena «Quando attacca»<br/>Risolvi → pesca → scarto"]
  SC -- "draw {effect: {source, event, entering}}" --> JE
  J -. "forma che non combacia" .-> X["ignorata da entrambi:<br/>nel DEBITO del test"]
```

Ogni effetto certificato ha la stessa vita: un parser per mondo che legge la
**forma** dal JSON, un passo del giudizio che la verifica, un passo
dell'interprete che la esegue al tavolo, e il riferimento `effect` che
viaggia dentro l'azione (fonte, evento, ingresso) e consuma l'innesco una
volta per turno. Cambiare un numero dentro la forma aggiorna tutto da sé;
cambiare la forma chiede un parser nuovo nei due mondi — e il test del
debito lo dice.

## Dove gira

| Pezzo | In locale | In produzione |
|---|---|---|
| Sito e simulatore | `npm run all` → vite su `:5199` | GitHub Pages (`docs/`), build committata a parte |
| Relay | `:8787` | Render, piano free (`render.yaml`), `wss://rubyfront-relay.onrender.com` |
| Engine | `:8788` | sulla macchina di chi gioca (il simulatore cerca `ws://<host>:8788`) |

## Cartelle

- `data/` — i dati madre: un file per carta, più i testi in due lingue; i mazzi.
- `docs/` — il sito: manuale, lore, direzione artistica, catalogo, pagine, build del simulatore.
- `simulatore/` — il client TypeScript (Vite, vitest).
- `engine/` — l'arbitro in Ruby (minitest), col suo README che racconta ogni regola collegata e i suoi limiti.
- `scripts/` — catalogo, validazioni, relay, pipeline di sviluppo, e il ponte col foglio dei mazzi.
- `.claude/skills/` — i contratti di lavoro: `linguaggio-carte` per i testi, `regole-engine` per le regole.

## Il foglio dei mazzi

I mazzi si disegnano su un foglio condiviso (Google Fogli), un sottofoglio per
mazzo. `npm run mazzi` è il ponte fra quel foglio e il catalogo: legge il
foglio, elenca i mazzi dicendo quali sono già in catalogo, e per quello scelto
mostra le differenze — copie, costo, Potenza, razza, Materia, parole chiave,
testo dell'effetto, e il blocco Rubyfront/Nexus in fondo. Col tuo sì apre una
sessione Claude che applica le modifiche seguendo le skill `linguaggio-carte`
e `regole-engine`, e poi riscrive il foglio dal catalogo — così il linguaggio
normalizzato torna anche lì. `npm run mazzi -- --esporta` fa solo quest'ultimo
passo.

Il foglio è privato, quindi due passaggi restano a mano, ed è voluto: nessun
programma entra nel tuo Drive.

1. su Fogli: **File → Scarica → Microsoft Excel**, in `~/Downloads`;
2. finito: **File → Importa → carica il file → «Sostituisci foglio di
   lavoro»**, così il documento resta lo stesso e il link condiviso non cambia.

Rendendo il foglio leggibile da chi ha il link, il primo passaggio si
automatizza: `npm run mazzi -- --url <link del foglio>`.

## Comandi

```sh
npm run all                          # pagina + relay + engine, un Ctrl+C spegne tutto
npm run mazzi                        # il foglio condiviso dei mazzi ↔ il catalogo
node scripts/build-catalog.mjs       # data/ → docs/cards/catalog.json
node scripts/validate-data.mjs       # i dati e il catalogo sono allineati?
ruby engine/test/engine_test.rb      # e table_test, card_index_test, websocket_test
cd simulatore && npx vitest run      # i gemelli lato client
cd simulatore && npm run build       # docs/simulatore, da committare a parte
```
