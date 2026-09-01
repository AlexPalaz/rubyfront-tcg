# Simulatore Rubyfront

Una lavagna condivisa per giocare a Rubyfront in due, da browser. **Non c'è un
engine**: il simulatore non conosce le regole, non controlla i costi, non
impedisce niente. Sposta carte, conta turni e Flusso, tira dadi. Le regole le
applicano i giocatori, come al tavolo vero — è un campo da gioco condiviso, non
un arbitro.

## Come si avvia

Tutto insieme, con un comando solo (pagina + relay + engine, un Ctrl+C spegne
tutto):

```bash
npm run all              # dalla radice del repo (o da questa cartella)
```

Oppure a pezzi, in due terminali:

```bash
cd simulatore
npm install          # solo la prima volta
npm run dev          # la pagina: http://localhost:5199/simulatore/
```

```bash
node scripts/relay.mjs   # il ponte fra i due giocatori (porta 8787)
```

Poi, nella pagina: si sceglie un **Posto** (A o B), si scrive lo stesso nome di
**Stanza** su entrambi i browser, si preme **Entra**, e infine **Carica mazzo**.
La spia accanto a "Entra" diventa verde quando la stanza è collegata.

> L'ordine conta: prima si entra nella stanza, poi si carica il mazzo. Chi entra
> per ultimo riceve la lavagna già in corso da chi c'era.

Per giocare fuori dalla propria macchina serve che il relay sia raggiungibile
dall'avversario: in LAN basta `npm run dev -- --host` e mettere l'IP del
computer nel campo del relay (`ws://192.168.x.x:8787`). Per giocare via internet
il relay va messo su un host pubblico — vedi "Giocare online", sotto.

## Giocare online

La pagina pubblicata (GitHub Pages serve `docs/`, simulatore compreso) parla
con un relay pubblico. Il flusso per chi gioca è due gesti:

1. **Crea stanza** (impostazioni → Invito): inventa un nome difficile da
   indovinare ed entra;
2. **Copia link**: il link porta stanza, posto opposto e relay — chi lo apre
   è dentro, seduto dall'altra parte, senza toccare un'impostazione. Chi
   conosce il nome della stanza può comunque entrare a mano.

Il relay pubblico si mette su con **Render**: dashboard → New + → Blueprint →
questo repo. Il `render.yaml` alla radice fa tutto (`node scripts/relay.mjs`,
piano free, health check sulla risposta HTTP del relay). L'URL che ne esce —
`wss://rubyfront-relay.onrender.com` — è già il default di produzione in
`src/net.ts` (`DEFAULT_RELAY`): se Render assegna un nome diverso, va
aggiornato lì. Nota del piano free: il relay dorme dopo l'inattività, la
prima connessione lo sveglia in una trentina di secondi.

Il relay resta stupido: ripete i messaggi della stanza e non sa nulla del
gioco. Niente account, niente lista stanze pubblica: si gioca con chi
conosce il nome della stanza, come a un tavolo privato.

## La chat vocale

Il tasto col **microfono** sull'HUD (accanto al fumetto) accende e spegne la
voce: parte **sempre spento**, e spegnerlo ferma le tracce davvero — la spia
del browser si spegne. L'audio viaggia **diretto fra i due browser** (WebRTC);
il relay fa solo da postino per l'aggancio, come per tutto il resto. Nelle
impostazioni si sceglie **quale microfono** usare (i nomi veri compaiono dopo
il primo permesso).

Limiti onesti: serve una pagina **https o localhost** (il browser non dà il
microfono altrove — quindi niente voce provando via IP di LAN in http), e
senza un server TURN i NAT più ostili non si agganciano: c'è solo uno STUN
pubblico. Per LAN e reti domestiche normali basta.

## Comandi

| Gesto | Effetto |
| --- | --- |
| Trascinare una carta | La sposta ovunque: campo, mano, pile |
| Trascinarla sulla mano aperta | La rimette in mano: il cassetto si accende tutto |
| Trascinarla in fondo allo schermo | Idem con la mano ripiegata o vuota: c'è una fascia apposta |
| Doppio click sul campo | Tappa / stappa |
| Doppio click in mano | Gioca la carta sul Fronte |
| Tasto destro su una carta | Tappa, copri, flip Rubyfront↔Nexus, manda in una zona |
| Tasto destro sulla tua Entità → *Attacca* | Freccia verso il Rubyfront avversario, e la carta si tappa |
| Tasto destro su un attaccante avversario → *Blocca con…* | Scegli l'Entità che lo ferma; *Contrattacca con…* la copre |
| Tasto destro sul mazzo | Pesca 1, pesca 6, mescola, cerca |
| Passare il mouse su una carta | La mostra a 520×728, anche se è sotto un'altra |
| Fumetto sull'HUD / × sulla chat | Apre e chiude la chat; il tavolo si allarga |
| Trascinare l'HUD | Si sposta dove non dà fastidio; doppio click sulla maniglia per rimetterlo al posto suo |
| «–» sull'HUD | Lo riduce a icona (una tessera col rombo); un click e si riapre |
| Doppio click su Abisso / Ritiro | Sfoglia la pila (sono pubbliche, §5) |

**Mescola, Pesca e Cerca** stanno sull'HUD, sotto Fine turno (sono gesti di
partita, non di impostazione). **Cerca** apre il mazzo scoperto con un filtro
per nome e per testo: si clicca la carta e va in mano. Alla chiusura il mazzo
si rimescola.

L'header è scarno: marchio, stato della rete, **Nuova partita** e
l'**ingranaggio delle impostazioni** — mazzo da caricare, posto, stanza e
invito, relay, sincronizzazione, vista, tema, lingua. Si apre col click, si
chiude con un click fuori o con Esc.

## La vista compatta

Dalle impostazioni (Vista) il tavolo passa in **compatto**: sul campo le
tessere mostrano solo la testa della carta — costo, nome, potenza/PV — e
l'illustrazione; il resto lo taglia il bordo della tessera (la carta sotto è
intera e intatta: passandoci sopra col mouse, o col tap, si apre il dettaglio
pieno). Le file si stringono di conseguenza e la scala si aggancia anche
all'altezza: **il tavolo sta tutto nella finestra, senza scorrere**.

È un vestito del client, come i temi: le coordinate condivise in rete non
cambiano di un pixel — a comprimersi è solo la geometria di vista (la mappa
`compress` in `src/ctx.ts`). La mano resta a carte piene, e la scelta resta
fra una partita e l'altra.

## L'HUD e la chat

Sul tavolo fluttua un **HUD** che tiene tutto il gioco: due targhe — Punti Vita
e Flusso per entrambi i posti, disposti come al tavolo, l'avversario in alto e
tu in basso — in mezzo il turno con la punta rivolta a chi tocca, e in fondo
**Fine turno** (la routine di §3.2: chi entra si trova il Flusso massimo
cresciuto di 1 e ricaricato) e i **dadi**, con l'ultimo esito sott'occhio e il
tiro firmato in chat. I − e i + compaiono passando col mouse su targhe e turno:
ogni numero resta correggibile a mano. La moneta sull'orlo di ogni targa è il
**Gettone Flusso** (§3.2): spenta (◇) lo assegna, d'oro (◆) lo spende — 1
Flusso extra, fuori dal tetto dei 20. Il posto attivo brilla del suo colore.

L'HUD **si sposta**: lo si afferra da un punto qualsiasi che non sia un tasto e
lo si porta dove non dà fastidio. La posizione resta fra una partita e l'altra;
doppio click sulla maniglia e torna al posto suo, sul bordo destro. Se il
tavolo si restringe, rientra da sé nei bordi.

Col «–» accanto alla maniglia l'HUD **si riduce a icona**: resta una tessera
col rombo (con la spia dei messaggi), trascinabile, e un click la riapre. Al
prossimo avvio l'HUD parte comunque aperto.

La colonna a destra è **solo chat**: il fumetto la apre, la × la richiude, e
chiusa cede i 320px al tavolo. **Chi fa cosa si vede dal colore**: le tue righe
sono viola, quelle dell'avversario indaco — vale per i messaggi e per le righe
di servizio (pesche, tiri, turni), che portano il segno sul filetto a sinistra.
Se arrivano righe a chat chiusa, il fumetto le conta con una spia. La scelta
aperta/chiusa resta fra una partita e l'altra.

Il **Flusso massimo** non ha un contatore suo: cresce da sé a ogni proprio
turno (§3.2), e per le correzioni ci sono i − e + del Flusso.

## I temi

Dalle impostazioni (ingranaggio) si sceglie il **tema del tavolo**: Notte (viola & indaco, il
tema di base), Rubino (il classico bordeaux), Smeraldo, Abisso, Acciaio, e
Solarizzato — l'unico chiaro, sulla palette Solarized Light. Un
tema riveste i due campi, l'HUD, le bande della chat e il mobilio attorno
(barra, pannelli, sfondo); il rubino delle azioni di gioco — rombo del
Flusso, Fine turno, combattimento — non cambia mai. È un vestito del client,
non dello stato: ognuno gioca col tema suo, e la scelta resta fra una partita
e l'altra. Per aggiungerne uno basta un blocco `body[data-ui-theme="…"]` in
`src/style.css` (sovrascrive le variabili dei posti) e un'`option` nel
pannello delle impostazioni.

## Il combattimento (§6.3)

Dichiarazioni, non risoluzione. Le frecce dicono chi attacca chi e chi ferma
chi; a confrontare le Potenze, far morire le Entità e togliere PV siete voi.

**Attaccare non ha bersaglio da scegliere:** §6.3 dice che si attacca sempre il
Rubyfront avversario, mai le altre Entità. Un gesto solo, quindi — e
l'attaccante prende un **numero d'ondata**, perché le battaglie si risolvono
nell'ordine di dichiarazione (§6.3 punto 5) e a mente lo si perde. Un attaccante
senza freccia di blocco addosso è un attacco che passa: il colpo d'occhio è
tutto il guadagno.

**Bloccare** parte invece dall'attaccante: tasto destro su di lui, poi si sceglie
con chi fermarlo. Il tavolo entra in modo bersaglio, una freccia tratteggiata
segue il puntatore e le tue carte in campo si accendono. Fra queste, l'anello
verde segna quelle che le regole permetterebbero (§6.3: una tappata non può
bloccare, una coperta non può fare nulla, il Rubyfront non è un'Entità) — ma le
altre **restano cliccabili**: qui si smorza, non si impedisce.

Chi contrattacca si **copre** da solo: quella copertura dura un giro intero
(§6.3) e vale la pena farla scattare. Chi blocca invece **non si tappa**: quel
tap arriva nel turno avversario e si stappa subito dopo, «segna solo che ha già
bloccato in quel turno di difesa» — e quel segno lo dà già la freccia.

Il **tap resta sempre tuo**:
la dichiarazione vive separata dallo stato di tap, quindi stappare a mano una
carta in mezzo a un attacco già dichiarato non disfa niente. Le frecce spariscono
a «Fine turno», o una alla volta con *Annulla attacco* / *Annulla blocco*.

Le Materie Reattive che bloccano (§6.3 punto 4) per ora restano da gestire a
mano: il selettore propone solo le Entità.

## Perché è fatto così

**Le carte non sono immagini.** Il sito le disegna a runtime con
`docs/cards/ui/card-render.js` a partire da `docs/cards/catalog.json`. Il
simulatore usa **quel** renderer, caricato a runtime dal suo percorso vero:
Vite compila solo il codice del simulatore e non tocca i moduli del sito.

Il motivo è preciso: `docs/cards/catalog.js` risolve `catalog.json` e le
illustrazioni con `new URL(..., import.meta.url)`. Dentro un bundle,
`import.meta.url` diventa l'URL del chunk e le illustrazioni si rompono.
Tenendo il renderer fuori dal bundle risolve i percorsi come sul sito, e la
grafica delle carte resta **una sola** per catalogo, pagina del mazzo, stampa e
simulatore. Se cambia `card.css`, cambia anche qui.

Ne discende una regola per `src/style.css`: `card.css` è globale e usa nomi
generici (`.card`, `.name`, `.cost`, `.die`, `.hp`). Nessun selettore del
simulatore deve poter entrare dentro una carta — per questo i dadi si chiamano
`.dice-btn` e non `.die`.

**Le carte stanno sempre a 302×424**, in mano, sul campo, nelle pile e nella
ricerca: è la misura della pagina Mazzo. Dentro, la carta è disegnata a 520×728
(la misura vera) e rimpicciolita con un `transform`, così `fitTextBoxes` misura
la carta reale e il corpo del testo resta identico a quello del sito.

**Il campo di un giocatore è alto due file di carte.** In alto i **cinque slot
del Fronte** (§5), centrati, con il posto del **Rubyfront** in fondo a destra —
fuori dai cinque, perché il Rubyfront schierato non ne occupa uno; in basso la
fila di servizio: **Zona di Richiamo** a sinistra, **Abisso, Ritiro e Mazzo** a
destra.

Due carte non si sovrappongono mai del tutto: agganciandone una su un riquadro
già occupato, scala di 30px verso il basso a destra. Di quella sotto resta
scoperto l'angolo in alto a sinistra — costo e nome — e ci si può passare sopra
col mouse per aprirne la descrizione a grandezza piena. A mano libera, invece,
comanda il giocatore: se vuole coprire, copre.

I riquadri segnati (i cinque slot, il Rubyfront, la Zona di Richiamo) **agganciano**
la carta che ci si lascia sopra, come fanno le pile: si incastra nel riquadro
invece di posarsi storta dov'era il puntatore. Fuori dai riquadri la lavagna
resta libera — le Materie permanenti, per esempio, vanno appoggiate a mano
dietro il Fronte. E un riquadro batte sempre la fascia della mano che gli sta
sopra: lasciare una carta in Zona di Richiamo non la rimanda in mano. In mezzo resta lo spazio dove
vanno le Materie permanenti, che stanno dietro il Fronte senza uno slot
proprio (§5). Sullo schermo un campo intero non ci sta insieme all'altro: si
apre inquadrando il proprio Fronte e si scorre. Il tasto **Mano** in basso a
destra ripiega la mano e libera la fila di servizio.

**La vista è quella di chi guarda, da qualunque posto giochi**: il tuo campo in
basso, quello avversario in alto e **capovolto**, così i due Fronti si guardano
in faccia attraverso il centro del tavolo e mazzo, Abisso, Ritiro e Zona di
Richiamo restano dietro le spalle di ciascuno. È il tavolo vero.

Ma le posizioni delle carte viaggiano sulla rete e devono voler dire la stessa
cosa sui due schermi: perciò esiste **un solo sistema di coordinate**, quello
canonico, ed è l'unico che finisce nello stato e nei messaggi. A disegnare ci
pensa `toView` (in `ctx.ts`), che fa due cose distinte: porta la tua fascia in
basso, e capovolge quella avversaria. `fromView` fa il viaggio di ritorno,
quando una carta viene posata a mano libera e il punto va riportato nel sistema
comune.

Entrambe ragionano sul **centro** della carta, non sul suo angolo: col centro il
capovolgimento è una riflessione pulita e andata-e-ritorno torna sempre; col
bordo, una carta che sporgesse dal fondo della fascia si ribaltava fuori e non
rientrava più. E la fascia ha lo stesso margine sopra e sotto proprio per questo:
è la simmetria che rende il capovolgimento uno scambio esatto fra le due file.

**La rete manda azioni, non stato.** Ogni client tiene la sua copia della
partita e applica le stesse mutazioni (`src/state.ts`). Lo stato intero viaggia
solo quando qualcuno entra nella stanza. Se le due lavagne si disallineano, il
tasto **Sincronizza** rimanda la propria a chi è collegato.

## Il relay

`scripts/relay.mjs` è un ponte di trenta righe: raggruppa le connessioni per
stanza e ripete agli altri quello che riceve. Non tiene stato, non legge i
messaggi, non sa cosa sia una carta.

Per giocare via internet va rifatto su un host pubblico (Cloudflare Workers +
Durable Object, Deno Deploy, o qualunque cosa parli WebSocket). Il client non
cambia: basta scrivere il nuovo indirizzo nel campo del relay. Il confine è
tutto in `src/net.ts`.

## L'engine (sperimentale)

L'arbitro esterno vive in `engine/` alla radice del repo, in Ruby. L'engine dà
le regole, il poliziotto è il simulatore: ogni azione locale aspetta il
verdetto prima di applicarsi, e un «no» la blocca con un avviso (le azioni
senza regola collegata passano come sempre; engine assente = tavolo libero).
Si accende dietro un flag, **spento di default**: ingranaggio → **Engine** →
**Acceso** (la spia quadrata in alto ne mostra lo stato). Per avviarlo:
`npm run engine` (oppure `ruby engine/bin/server`, porta 8788). Il confine
client è tutto in `src/engine.ts`; protocollo, regole collegate e piano di
crescita sono nel `engine/README.md`.

## Pubblicazione

`npm run build` compila in `docs/simulatore/`, dentro il sito. Da lì il
simulatore è raggiungibile insieme al resto (`/simulatore/`) e trova le carte in
`../cards/` esattamente come in sviluppo.
