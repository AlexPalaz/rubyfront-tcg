# Il gioco di Rubyfront (PixiJS)

Il client nuovo, in PixiJS v8 su WebGL, pensato anche per un'uscita desktop
su Steam (Electron). Nasce dalla migrazione decisa il 2026-09-11: si rifà
**solo il client**; manuale, engine Ruby, dati e catalogo restano quelli.
Il simulatore (`simulator/`) resta in piedi come termine di confronto, e
parla lo stesso protocollo col tavolo: le partite incrociate vecchio ↔ nuovo
sono il banco di prova della parità.

## Come si avvia

```bash
npm install          # dalla radice del repo: un workspace solo
npm run all          # pagina del simulatore, gioco e tavolo insieme
```

Da solo: `npm run dev -w game` → http://localhost:5200/ (con `?debug`:
area sicura, fotogrammi al secondo, dimensioni).

## Come è fatto

- **Unità di progetto 1920×1080** (`src/stage.ts`): tutto si disegna lì, il
  mondo si scala alla finestra e il lato che avanza (16:10, Steam Deck) si
  vede invece di diventare una banda nera.
- **La logica viene da `core/`** (`@rubyfront/core/…`), la stessa del
  simulatore: qui c'è solo la vista.
- **Occhi dall'esterno** (`src/debug.ts`): il canvas non ha DOM da leggere,
  quindi `window.__rubyfront.dump()` descrive la scena con etichette e
  riquadri in unità di progetto — per Playwright e per il QC degli screenshot.

## Le carte (F2)

Le carte «Cattedrale Rubino» (t49, l'unico tema del gioco) le disegna il
codice, in `src/card/`: niente DOM né CSS, ma l'API di disegno del canvas
consegnata a Pixi come texture — nitida a ogni misura, e con i valori che
potranno cambiare in partita.

| File | Cosa fa |
|---|---|
| `model.ts` | che cosa si stampa su una faccia, con la logica di `card-render.js` |
| `painter.ts` | la carta strato per strato, nell'ordine in cui il browser dipinge `card.css` |
| `text.ts` | l'impaginazione del testo come Blink: righe spezzate agli spazi e dopo i trattini, linea di base a floor(ascendente + mezza interlinea), line box col montante |
| `css.ts` | gradienti, ellissi, ombre interne, trame, ritagli ottagonali; l'aggancio ai pixel del dispositivo |
| `theme.ts` | i colori del tema e delle tre tinte, trascritti da `card.css` |
| `resources.ts` | le texture (pietra, grafite, crepe) lette da `card.css` (`vite-theme.ts`) e le illustrazioni |

**Il confronto automatico** (`scripts/compare-cards.mjs`) mette ogni faccia
disegnata da Pixi accanto a quella del renderer del sito (`compare/`), in
Chrome senza finestra, pixel per pixel, e confronta anche le righe di testo
(dove vanno a capo, dove cadono):

```bash
cd game
node scripts/compare-cards.mjs              # tutte le facce, it ed en
node scripts/compare-cards.mjs RBF-001      # una carta sola
open compare/report/index.html              # il rapporto, dal caso peggiore
```

Stato al 2026-09-11: 92 facce, differenza media 0,65%, peggiore 1,73% (le
full art: il ricampionamento dell'illustrazione), nessuna riga che va a capo
altrove, scarto massimo delle righe 0,19px. Se il designer ritocca
`card.css`, il confronto lo fa vedere: le texture si aggiornano da sole, i
colori e le misure vanno ritoccati in `src/card/`.

La galleria di tutte le facce (`src/gallery.ts`): al passaggio la carta si
ingrandisce e si ridisegna alla nuova misura; `?lang=en` per l'inglese.

## Il tavolo (F3)

Il tavolo fermo, in `src/table/`: la partita com'è nello stato del core,
disegnata in Pixi. È la vista «rincasso» del simulatore rifatta per lo
schermo del gioco — la tua metà in basso con Fronte e fila di servizio,
l'avversaria in alto capovolta e ridotta al Fronte (le sue pile nel
pannello), la mano in un cassetto di vetro sopra il tavolo.

| File | Cosa fa |
|---|---|
| `layout.ts` | la scala e le file (a 1920×1080 viene 0,524, la scala del simulatore; su 16:10 le carte crescono), e da coordinate canoniche a posti sullo schermo, con la prospettiva di chi guarda |
| `card.ts` | una carta sul tavolo: faccia (dalla cache) o dorso, tappata, filo e ombra; sul campo i distintivi a corpo fisso (costo, Potenza attuale, Contrattacco, parole chiave) e i segni di ciò che ha in più; l'anello e il numero d'ondata |
| `table.ts` | campi, riquadri, etichette, targhe dei posti (PV, Gettone, Flusso), pile, pannello delle pile avversarie, cassetto, gesto di fase; `show(state)` riallinea le carte per uid |
| `appearance.ts` | il tema chiaro del simulatore, e l'attrezzo per dipingere i pezzi d'interfaccia col canvas |
| `sample-game.ts` | la partita di prova: una lista di azioni che passa dal riduttore vero |

`http://localhost:5200/?table=sample` mostra la partita di prova (`&seat=b`
dall'altra parte). Il confronto col simulatore sulla stessa partita:

```bash
cd game
node scripts/table-side-by-side.mjs             # dal posto A
node scripts/table-side-by-side.mjs --seat b    # dal posto B
open compare/table/index-a-night.html   # index-<posto>[-chain|-panel|-browse|-block]-<tema>.html
```

Differenze volute: niente header in alto (le schermate sono di F6) e un
solo gesto di fase, perché il gioco gioca sempre con l'arbitro. Rimandati:
il pannello delle pile avversarie aperto, la fila di servizio avversaria che
si riapre col Controllo, gli anelli delle carte giocabili (F4), le frecce dei
blocchi, l'insegna di fase e le animazioni (F5), la catena, la Stasi, la fine
partita.

## L'interazione (F4)

I gesti e gli effetti non stanno nel gioco: stanno nel core, gli stessi del
simulatore.

- `core/src/gestures.ts` — giocare dalla mano, schierare il Rubyfront,
  attaccare, le abilità e il flip verso il Nexus, la catena delle Reattive e
  gli inneschi (ingresso, attacco, risoluzione, assegnazione, morte,
  ritorno), con la stessa sequenza di azioni, attese e scelte che stava in
  `simulator/src/table.ts`. La vista dà solo ciò che si vede
  (`GestureView`: luci, voli, scene, dado, mira, finestre); per il posto
  del bot mira, pile e conferme rispondono da sole.
- `core/src/tabs.ts` — quali tasti offre una carta (attacca, blocca,
  contrattacca, annulla), la mira dei blocchi, la mano chiusa a chiave nel
  turno altrui, lo scarto dell'eccesso, il menu di una carta.
- Il rilascio di una carta trascinata (`dropOnField`, `dropOnPile` in
  `gestures.ts`): il posto lo decide la lavagna, l'Oggetto va addosso a
  un'Entità, le pile sono del proprietario.

Nel gioco, in `src/table/`:

| File | Cosa fa |
|---|---|
| `scene.ts` | le scene delle carte sulla lama d'argento, in fila; l'avviso, la conferma, la scelta delle abilità |
| `dice.ts` | il dado al centro del tavolo |
| `aim.ts` | la mira di un effetto: i candidati accesi, il resto spento, la targhetta |
| `pile-viewer.ts` | la scelta di una carta da una pila |
| `gestures.ts` | i gesti del giocatore: il velo coi tasti di combattimento al passaggio, la mira dei blocchi, «Schiera», «Abilità» e il flip, il doppio tocco che gioca dalla mano, il trascinamento (sulle pile, sul cassetto, sul campo agganciato ai riquadri o a mano libera), il menu, la barra della catena |
| `menu.ts` | il menu di una carta: tasto destro, o pressione lunga al tocco |
| `seal.ts`, `preview.ts` | il sigillo dell'arbitro, l'ingrandimento al passaggio |

`http://localhost:5200/?match=bot` gioca contro il bot al tavolo Ruby
(la stanza «solo»).

**Il banco di registrazione** (`scripts/record-match.mjs`): una partita
del simulatore contro il bot col caso a seme fisso e il tavolo Ruby vero; il
posto A chiude le sue fasi e scarta l'eccesso, e le azioni giudicate si
registrano in ordine. Prima e dopo lo spostamento nel core dei gesti, dei
tasti, del rilascio e del menu le sequenze coincidono (seme 7: 81 azioni;
seme 11: 86).

**Le prove nel gioco**, su una partita vera contro il bot al tavolo Ruby:
`test-match.mjs` (il bot gioca, le scene e i dadi si fotografano) e
`test-gestures.mjs` («Schiera», il doppio tocco dalla mano, un Oggetto
trascinato su un'Entità e assegnato, il velo e «Attacca» che diventa una
dichiarazione giudicata).

```bash
cd game
node scripts/record-match.mjs --seed 7 --turns 20 --out prima.json
node scripts/record-match.mjs --compare prima.json dopo.json
node scripts/test-match.mjs --out prova        # la partita col bot nel gioco, con le foto
node scripts/test-gestures.mjs --out prova     # i gesti del giocatore
```

Chiusi dopo F4: sfogliare l'Abisso e la Zona di Ritiro (pubblici, §5: un
tocco sulla pila apre la vetrina, `pileViewer.browse`), il pannello delle pile
avversarie aperto, la penombra del tavolo con la catena aperta.

## La resa (F5)

Il tavolo si muove come quello del simulatore: gli stessi tempi e le stesse
curve (CSS `cubic-bezier` risolte in `table/animation.ts`, `tween` sul
`Ticker` di Pixi con un `setTimeout` di riserva, `reducedMotion()` per chi chiede
meno movimento).

| File | Cosa fa |
|---|---|
| `table/banner.ts` | l'insegna di fase (banda d'argento, turno, titolo, ornamenti) e quella finale con «Nuova partita» |
| `table/flights.ts` | le carte che volano: nelle pile (dissolvenza, scintilla, anello d'atterraggio, il taglio di chi muore), dalle pile al Fronte, gli spostamenti; parata e risposta |
| `table/arrows.ts` | le frecce del blocco e del contrattacco, e quella tratteggiata della mira che segue il puntatore |
| `table/entrance.ts` | l'ingresso dei Rubyfront a inizio partita col bot (arrivo, accensione nella tinta del mazzo, atterraggio) |
| `table/scene.ts`, `dice.ts` | le scene con la carta in luce e lo «sguardo» sulle mosse dell'avversario; il dado che rotola |
| `sound.ts` | suoni e musica (Web Audio), gli stessi file del simulatore |

La cascata della pesca, i respiri degli anelli (`Ticker.shared`), i lampi,
lo scossone di chi è colpito. `scripts/resolution-photos.mjs` fotografa frecce,
taglio, parata e colpo sul tavolo di prova (`?table=sample&block&resolution`).

## Le schermate (F6)

Tutto quello che sta attorno al tavolo, in Pixi come il tavolo, nello
strato `screens` sopra il mondo (`stage.ts`): nessun momento del tavolo che
si porta in cima passa sopra la home. Il regista è `game.ts`: una sessione
sola, creata all'avvio col posto di questo client (`match.ts`,
`createMatch`), che la home porta verso la partita col bot o verso una
stanza — la stessa logica di `main.ts` del simulatore (il posto A a chi crea
la stanza, B a chi entra, la ricarica quando il posto cambia, la stanza
salvata e ripresa all'avvio).

| File (`src/screens/`) | Cosa fa |
|---|---|
| `toolbar.ts` | l'header: il marchio (torna alla home; al tavolo chiede), la spia e la chat in stanza, «Esci dalla partita», l'ingranaggio |
| `home.ts` | la home del tema chiaro: il paesaggio, l'insegna del saluto con le partite contro il bot, le cinque stampe che si allargano al passaggio (Riprendi / Nuova partita, Crea una stanza / Entra, Evento e Torneo in arrivo, Mazzi) |
| `onboarding.ts` | il velo e la carta di vetro: nome, mazzo e mazzo del bot (tendine), «Al tavolo»; l'attesa in stanza col link d'invito |
| `decks.ts` | i mazzi: copertina, composizione, «Gioca con questo mazzo», le carte a tessera con l'ingrandimento (è una fonte di `preview.ts`) |
| `settings.ts` | Rete, Suoni, Musica, Schermo intero, Lingua (e «Esci dal gioco» sul desktop) |
| `chat.ts` | la chat in stanza, solo conversazione; i messaggi arrivati a pannello chiuso si contano sul tasto |
| `curtain.ts`, `question.ts` | il nero fra home e tavolo; «Uscire dalla partita?» |
| `ui.ts`, `filters.ts` | tasti, scritte, ombre a nove fette, il campo di testo (un `<input>` vero posato sul canvas), i filtri CSS come matrici |

L'indirizzo nudo apre il gioco; `?match=bot` la partita col bot subito
(i banchi), `?table=sample` il tavolo di prova, `?gallery` le carte.
`scripts/test-screens.mjs` fa il giro del giocatore (home, profilo,
sipario, partita, domanda, mazzi, impostazioni, stanza, invito) e lo
fotografa.

## La parità (F7)

`scripts/crossplay.mjs`: il simulatore al posto A e il gioco al posto B nella
stessa stanza del tavolo Ruby. Il gioco gioca e attacca (i gesti del bot,
`window.__rubyfront.testHooks`, solo in sviluppo), il simulatore passa e
risolve da difensore; a ogni turno lo stato dei due si confronta, intero.
Prima corsa buona (2026-09-12): 9 turni, 11 confronti, nessuna divergenza,
3 Entità giocate e 5 attacchi dal gioco, la chat nei due sensi (col conto
sul tasto), nessun errore nelle due pagine.

La lista della parità, e con cosa è provata:

| Cosa | Com'è provato |
|---|---|
| Le carte (tema t49) | `compare-cards.mjs`: pixel contro `card-render.js` (F2) |
| Il tavolo fermo | `table-side-by-side.mjs`: le due viste della stessa partita, affiancate (F3) |
| I gesti e le regole | nel core (`gestures.ts`, `tabs.ts`): gli stessi del simulatore; `record-match.mjs` prova che lo spostamento non ha cambiato niente (F4) |
| La partita col bot | `test-match.mjs`, `test-gestures.mjs`: verdetti passati, rifiuti, zero errori |
| La resa | `resolution-photos.mjs` e il QC delle foto (F5) |
| Le schermate | `test-screens.mjs` e il QC delle foto (F6) |
| La rete e la chat | `crossplay.mjs`: un client per parte, lo stato che coincide (F7) |

Differenze volute: un tema solo (chiaro) e una vista sola (il rincasso);
niente microfono né chat vocale; la chat è un pannello che si apre
dall'header invece della colonna; la schermata intera nelle impostazioni.

## Il desktop (F8)

`desktop/` (fuori dai workspace): Electron che serve la build del gioco da
`app://rubyfront/`, con carte, suoni e musica a bordo e il tavolo di
produzione. Vedi `desktop/README.md`; cosa serve per Steam, e da chi, in
`desktop/STEAM.md`. La build per il desktop passa `VITE_CARDS=./cards/`
(`vite.config.ts` la legge dall'ambiente) e `VITE_INVITE_BASE` (il link
d'invito verso il sito).

## Le fasi

F0 impianto ✓ · F1 estrazione del core ✓ · F2 le carte native (solo il tema
«Cattedrale Rubino», misurate contro `card-render.js` con un confronto
automatico) ✓ · F3 il tavolo fermo ✓ · F4 l'interazione ✓ · F5 la resa ✓ ·
F6 le schermate ✓ · F7 la parità ✓ · F8 Electron e Steam ✓ (pronto; per
pubblicare servono i dati di Steamworks, `desktop/STEAM.md`).

Nel sito pubblicato il gioco esce sotto `/next` finché non raggiunge il
simulatore.
