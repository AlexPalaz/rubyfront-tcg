# Engine Rubyfront

L'arbitro del gioco, in Ruby. Si collega al simulatore e **giudica le azioni
prima che si applichino**: l'engine dà solo le regole — il poliziotto è il
simulatore, che trattiene l'azione fino al verdetto e su un «no» la blocca
mostrando l'avviso. Le regole di `docs/MANUALE.md` si collegano **una alla
volta**, su decisione del designer; per tutto ciò che non è ancora collegato
l'engine risponde «non ho una regola» e non si mette in mezzo.

Regole collegate finora:

- **§3.2 Flusso: limite 20** — il Flusso e la sua barra non superano mai 20;
  unica eccezione la spesa del Gettone (`token: false` nella stessa patch),
  l'unico 21 legale.
- **§6.4 Mano: massimo 7 a fine turno** — il cambio di turno non passa se chi
  chiude ha più di 7 carte in mano. È una regola di CHIUSURA: pescare
  all'ottava carta a metà turno resta legale, è il Fine turno che si ferma.
- **§6.3 Dichiarazioni: tappate, coperte, sfide 1 contro 1** — la coperta non
  dichiara nulla, la tappata non attacca né blocca, e ogni attaccante ha al
  più un bloccante. Il tavolo dell'engine segue tap, coperture e
  dichiarazioni (con le stesse pulizie del client: chi esce dal campo si
  raddrizza e libera le sue frecce). Con l'arbitro collegato il simulatore
  nasconde anche i gesti manuali Tappa/Stappa/Copri (`ctx.arbitrated()`):
  quegli stati discendono dalle dichiarazioni — il tap dall'attacco, la
  copertura dal contrattacco, la stappata dall'inizio del turno (routine di
  endTurn). Resta «Scopri», finché la scoperta a fine giro (T+3) non sarà
  automatica. Limiti dichiarati: la Stasi (§8.1, RBF-013) non è modellata, e
  gli effetti delle carte che tappano/coprono non sono ancora concessi.
- **§3.1 Oggetti: assegnazione** — l'assegnazione è un'azione del protocollo
  (`assign {uid, to}`, generata dal rilascio di un Oggetto sopra un'Entità):
  solo alle proprie Entità, mai al Rubyfront/Nexus, mai a una coperta, e una
  volta assegnato l'Oggetto non si sposta su un'altra Entità. Si scioglie da
  sé quando una delle due carte lascia il campo (il ritorno in campo è
  sempre disarmato). È il prerequisito delle licenze (la Stasi di RBF-013
  vive «mentre assegnato»).
- **§3.1/§3.2 Contatori: mai sotto zero** — i PV si fermano a 0 (a 0 la
  partita è persa, sotto non si va) e Flusso e barra non scendono in
  negativo. Come per il tetto dei 20, i bottoni dell'HUD non hanno più
  pavimenti cuciti: a engine spento il tavolo resta libero.
- **§6.2 Fronte: massimo 5 Entità** — la sesta Entità non scende, da
  qualunque via arrivi (§6.2: a Fronte pieno anche la parte d'effetto che
  metterebbe in campo «non si applica»). Contano solo le Entità del
  proprietario — Rubyfront, Materie e Oggetti non occupano slot, lo dice
  l'anagrafe. Il campo del simulatore è una superficie unica, ma le Entità
  in campo SONO il Fronte: non hanno altro posto dove stare.
- **§6.2 Attesa di evocazione** — un'Entità entrata in campo questo turno non
  dichiara attacchi, salvo Slancio (`surge`). È la prima regola che LEGGE LE
  CARTE: all'avvio il server carica l'anagrafe (id → tipo, parole chiave) dai
  dati del sito (`lib/rubyfront/card_index.rb`; il percorso si cambia con
  `RUBYFRONT_DATA`) e il tavolo annota il turno d'ingresso di ogni carta.
  Carta ignota o anagrafe assente: l'engine tace, mai molesto. Limite
  dichiarato: lo Slancio CONCESSO da un effetto (es. RBF-009) non si vede
  ancora — quell'Entità verrebbe fermata a torto.

**Ogni regola entra con i suoi test**, in `test/engine_test.rb` (una sezione
per §) — e il gemello client sta in `simulatore/test/` (vitest): il riduttore
dei client e la copia del tavolo qui sotto devono contare allo stesso modo.

Nessuna dipendenza: Ruby e la sua libreria standard, come il relay
(`scripts/relay.mjs`) è Node e basta.

## Come si avvia

```bash
ruby engine/bin/server        # ascolta su ws://localhost:8788
```

(oppure, da `simulatore/`: `npm run engine`). Nel simulatore:
ingranaggio → **Engine** → spunta **Acceso**. La spia quadrata in alto
diventa verde e in chat compare il saluto dell'engine. Il flag è **spento di
default**: senza toccarlo, il simulatore non sa nemmeno che l'engine esiste.

## Come si prova

```bash
ruby engine/test/engine_test.rb
ruby engine/test/websocket_test.rb
```

## Il protocollo

WebSocket, messaggi JSON. Tre buste in croce:

| chi | messaggio | risposta |
|---|---|---|
| client | `{"t":"hello"}` | `{"t":"engine","version":"0.2.0","rules":[…]}` |
| client | `{"t":"judge","seq":7,"action":{…}}` | `{"t":"verdict","seq":7,"action":"turn","ok":false,"ruled":true,"reason":"…"}` |
| client | `{"t":"consult","seq":8,"action":{…}}` | come `judge`, ma per un'azione **già applicata** altrove |
| client | `{"t":"snapshot","state":{…}}` | *(nessuna: allinea la copia del tavolo)* |

`judge` è il giudizio preventivo sulle azioni locali: l'engine applica
l'azione alla **sua copia del tavolo** (`lib/rubyfront/table.rb`) solo se il
verdetto la lascia passare, perché anche il client la applicherà solo col sì.
`consult` è l'occhiata sulle azioni dell'avversario, già applicate dal suo
client: la copia le segue comunque, il verdetto serve solo ad annotare.
`snapshot` sostituisce la copia in blocco: parte a ogni saluto (l'engine
appena collegato non sa nulla) e quando il client riceve una lavagna intera
dalla rete (ingresso in stanza, «Sincronizza la lavagna»).

`action` è un'azione della lavagna, identica a quelle che viaggiano sul relay
(`simulatore/src/types.ts`, tipo `Action`). Il contratto dei verdetti:

- **`ruled: false`** — l'engine non ha una regola per questa azione: il
  simulatore la applica come sempre.
- **`ruled: true, ok: true`** — la regola c'è e l'azione la rispetta.
- **`ruled: true, ok: false`** — l'azione viola la regola: `reason` spiega
  perché. Il simulatore la **ferma** — non tocca lavagna né rete — e mostra
  l'avviso. `rules` nel saluto elenca i § del MANUALE collegati.

Il giudizio vale per le azioni **locali**: quelle dell'avversario arrivano già
applicate dal suo client (sarà il suo engine a fermarle), quindi una loro
violazione si annota in chat e basta. E un arbitro assente non ferma il
tavolo: engine scollegato o muto oltre il tempo massimo = via libera.

Una richiesta HTTP semplice (senza upgrade) riceve una riga di stato: fa da
health check, come per il relay.

## Com'è fatto

- `lib/rubyfront/engine.rb` — il giudizio: puro stato, niente I/O. È qui che
  le regole verranno collegate.
- `lib/rubyfront/websocket.rb` — il minimo di WebSocket che serve: handshake
  e frame di testo (con la lezione del relay: byte spezzati, incollati e
  messaggi frammentati si riassemblano).
- `bin/server` — il trasporto: un thread per client, un `Engine` per client.
- `test/` — minitest, si lanciano con `ruby` e basta.

## Un repo a parte, un giorno

La cartella è pensata per essere **estratta** quando il progetto crescerà:
tutto ciò che le serve sta qui dentro, e le dipendenze future verso il resto
del repo (le carte di `data/`, il MANUALE) passeranno da confini espliciti,
mai da path sparsi nel codice. Finché carte e regole cambiano insieme,
stare nello stesso repo evita solo attrito.
