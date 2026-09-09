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

Poi, dalla home, carta **Multigiocatore**: uno **crea la stanza** (ed è il
posto A), l'altro **entra** col nome della stanza o dal link d'invito (ed è
il posto B). Il posto non si sceglie: lo decide la porta da cui si entra.
Poi ciascuno mette nome e mazzo; la spia della rete in barra diventa verde
quando la stanza è collegata, e il tavolo si apre quando ci sono entrambi.

Per giocare fuori dalla propria macchina serve che il relay sia raggiungibile
dall'avversario: in LAN basta `npm run dev -- --host` e mettere l'IP del
computer nel campo del relay (`ws://192.168.x.x:8787`). Per giocare via internet
il relay va messo su un host pubblico — vedi "Giocare online", sotto.

## Giocare online

La pagina pubblicata (GitHub Pages serve `docs/`, simulatore compreso) parla
con un relay pubblico. Il flusso per chi gioca è due gesti:

1. **Crea una stanza** (home → Multigiocatore): inventa un nome difficile
   da indovinare ed entra, al posto A;
2. **Copia il link d'invito** (nell'attesa dell'altro): il link porta
   stanza, posto opposto e relay — chi lo apre è dentro, seduto dall'altra
   parte, senza toccare un'impostazione. Chi conosce il nome della stanza
   può comunque entrare a mano, al posto B.

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

## La home

Al primo arrivo (nessuna stanza salvata) si apre la **home**: sotto
l'header, senza scorrere, cinque carte verticali in fila con le
illustrazioni del set, e sopra un saluto col nome salvato e il conto delle
partite contro il bot (`stats` nel browser: partite e vittorie, scritte a
ogni fine partita per PV). Al passaggio del mouse una carta si allarga e
scopre il suo contenuto (al tocco, dove il mouse non c'è): **Contro il
computer** parte subito — con nome e mazzo già salvati il gesto è «Riprendi
con «mazzo»», bot col mazzo diverso dal tuo, e «Nuova partita» passa dal
wizard; **Multigiocatore** ha dentro «Crea una stanza» e «Entra» in una
che si conosce; **Mazzi** apre la vista dei mazzi (sotto); **Evento** e
**Torneo** aspettano in grigio, più stretti. Dalla carta scelta si
passa al velo dell'accoglienza — nome e mazzo, poi in stanza l'attesa
dell'altro — con la home sfocata alle spalle. Chi arriva con una stanza
salvata o da un link d'invito la salta. Markup in `index.html` (`#home`,
classi `home-*`), stili in `src/style.css`.

Gli **sfondi** delle carte non sono le art del catalogo (ridotte a 1040px
per la carta: stirate su una colonna alta sfocano) ma file propri in
`public/home/`, due per sfondo — `<nome>.jpg` alto al massimo 1080px per gli
schermi normali e `<nome>@2x.jpg` fino a 2160px per i Retina — che il
browser sceglie con `image-set`. Li produce `scripts/home-art.mjs` dall'upscale
di Midjourney (2912×1632):

```sh
node scripts/home-art.mjs ~/Downloads/<upscale>.png rhen   # → public/home/rhen.jpg + rhen@2x.jpg
```

La carta li indica con `data-bg="home/rhen"`; una carta senza sfondo proprio
ripiega sull'art di una carta del set (`data-art`, via `artUrl` in
`src/renderer.ts`).

### I mazzi

La vista **Mazzi** (`src/mazzi.ts`, sezione `#mazzi`) è per chi gioca, non è
il catalogo del sito (`/catalog`, strumento di lavoro del team, che potrà
anche sparire). Un mazzo per stampa: il Rubyfront in copertina disegnato dal
renderer vero, il nome dal file del mazzo (`data/decks/`), la composizione
contata dal catalogo, **«Gioca con questo mazzo»** (lo sceglie e
passa dal nome, poi il bot) e **«Sfoglia le carte»**: tutte le carte a
tessera, Rubyfront e Nexus per primi poi Entità, Materie e Oggetti per costo,
con le copie all'angolo e l'ingrandimento al passaggio. Le tessere si
disegnano solo alla prima apertura. Niente id, stati o note di design.

## Giocare contro il bot

Dalla home, **«Contro il computer»**: si sceglie il proprio mazzo e
quello del bot, e l'altra metà del tavolo la gioca lui — senza stanza, con
l'arbitro acceso se c'è. È l'unica via senza stanza: la partita locale a
due posti sullo stesso mouse è stata tolta il 2026-09-07 («ormai c'è il
bot»). Difficoltà **media**, la sola per ora (facile,
difficile e leggenda verranno).

Il bot non ha scorciatoie: gioca attraverso le **stesse azioni** di un
giocatore e passa dallo **stesso arbitro**. Le decisioni stanno in
`src/bot.ts`, senza DOM (provabili con uno stato finto, `test/bot.test.ts`):
cosa vale una carta (Potenza attuale e parole chiave), **con chi attaccare**
(chi non muore contro i bloccanti possibili; tutti se il colpo che passa è
letale; chi almeno pareggia quando il Rubyfront avversario è sotto la metà),
**come bloccare** (un contrattacco che uccide e resta in piedi, se no un
muro — Potenza maggiore o Stasi —, se no uno scambio alla pari che conviene,
se no un sacrificio solo se i PV sono in pericolo), **cosa giocare** (la
carta che rende di più per Flusso: Entità con uno slot libero, Oggetti
sull'Entità più forte disarmata, Materie con un passo che agisce davvero; il
Gettone se manca un Flusso), **cosa scartare** per stare nei 7. Schiera il
Rubyfront appena il Flusso copre il costo, passa in catena (le Reattive
aspettano una difficoltà più alta).

La guida sta in `src/main.ts` (`botTick`): a ogni ridisegno, se è il suo
momento, compie **un gesto** — e aspetta che il tavolo sia fermo — poi
riparte. Per i gesti del **suo posto** mira, conferme e scene del tavolo
rispondono da sole (`table.setAuto`, legato al posto e non al momento:
vale anche per gli effetti che si risolvono a scena chiusa); le scene delle
sue carte le chiudi tu con Continua o Risolvi, e finché sono aperte il bot
aspetta; il bersaglio scelto si accende un attimo. I «no» dell'arbitro ai suoi gesti non mostrano il sigillo: il bot
prende nota e cambia gesto. Aspetta le aperture (§4) prima di muoversi. In
locale e col bot, un passo d'effetto è di chi comanda la **fonte**
dell'effetto (`actorFor`), qualunque carta tocchi.

**Uscire dalla partita**: in barra, «Esci dalla partita» (si vede solo al
tavolo) lascia la stanza (o congeda il bot), azzera la partita e riporta
alla home; il posto torna A. La stanza salvata si dimentica; nome e mazzo
restano.

## Suoni e cursore

Il tavolo **suona**, con suoni **disegnati a strati** come in un gioco
vero: materie prime dai pacchetti CC0 di Kenney (RPG Audio, Impact Sounds,
Casino Audio) montate fuori linea con ffmpeg — `scripts/sounds.py` è la
ricetta: per ogni voce gli strati (file, ritardo, guadagno, filtro), poi la
stessa catena per tutti (riverbero corto, taglio delle frequenze estreme,
limitatore). I file, AAC, stanno in `public/sounds` con la licenza accanto;
ogni voce ha due o tre varianti scelte a caso con un filo d'intonazione
diversa. Le voci: cuoio in mano e carta che scivola quando si **prende** una
carta o si **sceglie** un bersaglio; carta spinta dal mazzo con lo sfoglio
di pergamena a ogni carta **pescata** (solo la propria pesca, in cascata,
anche quella del turno); la carta che si **posa** sul Fronte col libro
chiuso e un colpo sordo; lo scatto del fermaglio sui **tasti**; la lama che
esce, il taglio e il colpo di metallo all'**attacco**; lo scudo al
**blocco**; il taglio, il metallo pesante e il rintocco al
**contrattacco**. Le fasi non suonano (montato, poi tolto su richiesta).
Il suono è del tavolo, non del mouse: vale per le azioni di chiunque — le
proprie, quelle del bot, quelle arrivate dalla rete (`cueFor` in main.ts).
Il browser non suona prima di un gesto: il contesto nasce al primo tocco.
L'interruttore **Suoni** nelle impostazioni spegne tutto, e resta salvato.
(Le due sintesi al volo provate prima e i campioni nudi sono stati
bocciati: «fai una cosa professionale come un gioco vero».)

Il **cursore** è del gioco: una punta rubino, il colore del marchio,
inclinata come un puntatore, con l'intaglio in basso e un alone morbido;
sui tasti e sulle carte si schiarisce con un alone bianco; per prendere una
carta si svuota, tenendola si fa granata; il mirino per scegliere un
bersaglio. Sono SVG in linea nel foglio di stile (`--cur-*`); dove il
browser non li accetta — Safari — resta il cursore di sistema.

## La chat vocale

Il tasto col **microfono** in header (accanto al fumetto) accende e spegne la
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
| Fumetto in header / × sulla chat | Apre e chiude la chat; il tavolo si allarga |
| Moneta sulla targa del posto | Gettone Flusso (§3.2): spenta (◇) lo assegna, d'oro (◆) lo spende |
| Doppio click su Abisso / Ritiro | Sfoglia la pila (sono pubbliche, §5) |

**Mescola, Pesca e Cerca** stanno in header accanto al turno, senza arbitro
(sono gesti di partita, non di impostazione). **Cerca** apre il mazzo scoperto con un filtro
per nome e per testo: si clicca la carta e va in mano. Alla chiusura il mazzo
si rimescola.

L'header è scarno: marchio, stato della rete, **Esci dalla partita** (in
rubino, solo al tavolo) e l'**ingranaggio delle impostazioni** — solo
preferenze: relay, engine, sincronizzazione, suoni, microfono, vista, tema,
lingua. Mazzo, posto e stanza si scelgono dalla home. La partita nuova la
offre l'insegna finale. Si apre col click, si chiude con un click fuori o
con Esc.

## La vista compatta

Dalle impostazioni → Vista → «Tavolo»: **il tavolo sta
tutto nella finestra, senza scorrere**, e ogni scritta resta a 16px
qualunque sia la finestra. Sul campo, nelle pile e in mano le carte sono
**tessere**: l'illustrazione col nome, il costo e la Potenza (o i PV)
sovrapposti — non la carta rimpicciolita, che a quelle scale avrebbe il
testo a 5–8px. Il testo di regole si legge passandoci sopra col mouse (o col
tap): si apre la carta intera, alla misura del renderer. La Potenza sulla
tessera è quella **attuale** (§8.2), in rubino se sale, e le parole chiave
stampate (§8.1) sono icone sotto il costo: fulmine lo Slancio, due barre la
Stasi, freccia di ritorno la Vendetta, fiamma la Furia.

Il trucco è uno solo: la lavagna è scalata con un transform (`--card-scale`),
e tutto ciò che deve restare leggibile — tessere, etichette delle file e
delle pile, targa del posto — si moltiplica per l'inverso (`--ui-inv`).
Quando comanda la larghezza, la mano cresce da sola (fino a una volta e
mezza) e la lavagna si centra nello spazio che resta.

È un vestito del client, come i temi: le coordinate condivise in rete non
cambiano di un pixel — a comprimersi è solo la geometria di vista (la mappa
`compress` in `src/ctx.ts`). «Carte intere» mostra le carte piene sul tavolo
e si scorre.

## Carte intere · rincasso

**È la vista di partenza.** Lo stesso tavolo a due file della vista piena, senza scorrere, con le
**carte intere ovunque** — Fronte, fila di servizio e mano, tutte alla
stessa misura. Ci sta perché la fascia AVVERSARIA perde la sua fila di
servizio: le sue tre pile — Abisso, Ritiro, Mazzo — vanno in un **pannello
ripiegabile** (`.pile-dock`) in alto a destra sopra il suo campo, in
`position: absolute` con z-index sopra le carte (aperto mostra le pile a
carta intera con le etichette, ripiegato resta una testata coi conti; la
scelta si ricorda in `rbf-sim:piledock`), e la sua Zona di Richiamo è il
riquadro del Rubyfront. Restano tre file di carte intere invece di quattro.

**La Zona di Richiamo non ha un riquadro suo**: è il
riquadro del Rubyfront in testa al Fronte, in due stati — tratteggiato,
senza etichetta e col tasto **Schiera** a cavallo del bordo basso della
carta finché il Rubyfront aspetta; cornice piena ed etichetta «Rubyfront»
una volta schierato. Le coordinate della carta in attesa restano quelle
canoniche della Zona di Richiamo (`atRecall` e il ramo di `viewOf` in
`src/ctx.ts`): cambia solo dove la si vede.

Il tavolo prende **tutta l'altezza sotto l'header**, e quando comanda la
larghezza l'altezza che avanza non resta vuota sopra e sotto: si
distribuisce nei margini — cima e fondo, il varco fra i campi, i varchi fra
le file (`setViewSlack` in `src/ctx.ts`, scritto da `fitScale`). E prima
ancora dell'aria, i margini rispettano ciò che sta a corpo fisso: sotto un
riquadro ci vuole lo spazio reale di un'etichetta (42px), in testa a un
campo quello della targhetta che sporge (`setLabelRoom`), e in fondo al
tavolo l'angolo del gesto di fase — misure in pixel divise per la scala,
così le etichette non toccano mai un bordo o una fila, a qualunque
finestra (costa ~0,04 di scala a 1180×820). Le riserve dipendono dalla
scala e la scala da loro: il fit converge per punto fisso, e la lavagna non
supera mai la finestra — in rincasso non si scorre.

In rincasso la carta intera **sul campo** (non in mano) porta **i distintivi della tessera** — costo in
alto a sinistra, Potenza (o PV) in alto a destra, Contrattacco e parole
chiave — a corpo fisso, come nella vista compatta: la carta a un terzo non
si legge, i distintivi sì, e sotto resta la carta vera (`badges` in
`src/cardview.ts`, uno strato `.tess.is-badges` trasparente e inerte; i
segni del tavolo e la Potenza attuale lo trovano allo stesso posto della
tessera). Nelle pile aperte, a scala piena, non servono.

La fila di servizio avversaria, azzerata in rincasso, **si riapre da sola
finché l'avversario controlla un'Entità** (§8.2): il suo riquadro del
controllo sta lì, e senza la fila cadrebbe sul terzo slot del Fronte. A
fine controllo si richiude (`setFoeBackRow` in `src/ctx.ts`, acceso dal
render di table.ts). Non salta: le zone si ricostruiscono, ma ogni
riquadro parte dal posto vecchio e scivola al suo, chi non c'era entra con
una dissolvenza, e la scala del tavolo scivola con loro — `--card-scale` è
una proprietà CSS registrata, e va in transizione solo in quel momento
(`morphZones` in table.ts). Le pile avversarie restano invece nel loro
**pannello** in alto a destra (provato ad aprirle nella fila vera: quattro
file di carte intere a 1180×820 fanno una scala da 0,28), che si apre e si
chiude con una transizione (il corpo è una griglia da 0fr a 1fr). La scala non conta la
mano, che resta un cassetto fisso sopra la lavagna come
in «Carte intere» (la mano si ripiega col gesto per vedere la fila di servizio
là sotto, e sta alla scala del tavolo, non al 30% in più). Su un 3440×1264
la scala è ~0,69 e le carte sul tavolo ~208px. Su lavagne piccole (scala
sotto il 50%) i margini si stringono ancora — `setTightView` in
`src/ctx.ts`, con due soglie per non far ballare il tavolo — e il pannello
delle pile si dispone a due riquadri per riga invece di quattro in fila:
su un 1180×820 sono ~90 pixel di altezza canonica in più per le carte. È la mappa `compress` con
la fila di servizio avversaria azzerata (`bandViewH(true)` in
`src/ctx.ts`): le coordinate condivise non cambiano.

## Turno, targhe e chat

Non c'è più un HUD — né pannello né barra: il tavolo è la cosa, e il resto
sta ai suoi bordi (deciso il 2026-09-06, vista minima **1180×820**).

**Il turno e la fase** (§6) li dice l'**insegna** al centro del tavolo, a
ogni cambio: «Turno 3» sopra, «Fase di Fronte» grande, sotto a chi tocca. In header
non c'è un contatore (tolto il 2026-09-06 su richiesta). **In header, al
centro**, senza arbitro, Mescola, Pesca, Cerca e i dadi (veste provvisoria:
il tavolo senza arbitro se ne andrà). **A destra** «Evoca» (strumento di
prova), chat e microfono. Sotto i 1400px «Simulator» si ritira dal marchio
per far posto.

**Sul tavolo, in basso a destra**, il **gesto di fase**: con l'arbitro «Fine
fase» (Fine preparazione, Fine Fronte, Fine Reazione; la routine di §3.2,
chi entra si trova il Flusso massimo cresciuto di 1 e ricaricato); senza
arbitro la dichiarazione del Fronte e il Fine turno. Sta nell'angolo che la
mano lascia libero: il **cassetto della mano è largo il 75%** del tavolo, da
sinistra, col tasto che lo ripiega sul suo orlo destro. Il tavolo gli
**riserva l'angolo** (`setCornerReserve` in `src/ctx.ts`, nel margine di
fondo): le pile, che stanno a destra nella fila di servizio, e le loro
etichette restano sopra, mai coperte.

**Sul tavolo**, sull'orlo di ciascun campo accanto alla targhetta del nome,
la **targa del posto**: il Gettone Flusso e il Flusso nel rombo. I **Punti
Vita** non ci sono: si leggono **sul Rubyfront**, una volta sola — il
distintivo dei PV della carta mostra quelli rimasti, non lo stampato, e
quando cambiano il numero scorre fino al nuovo valore e il distintivo
lampeggia (rubino in calo, verde in salita; `setTessHp` in
`src/cardview.ts`). Per questo il Rubyfront porta il distintivo in ogni
vista, anche in «Carte intere». Niente nome (lo dice la targhetta) e niente «tocca a te»: la targa
di chi è di turno **si tinge**. La moneta è il **Gettone Flusso** (§3.2):
spenta (◇) lo assegna, d'oro (◆) lo spende — 1 Flusso extra, fuori dal
tetto dei 20. Senza arbitro i − e i + compaiono passando col mouse. Le
targhe le crea `src/hud.ts` e le appende `table.ts` in `.half-head`
(`onStats`); stanno dentro la lavagna scalata e ogni misura passa per
`--ui-inv`, così restano a 16px in ogni vista, «Carte intere» compresa.

La colonna a destra è **solo chat**: il fumetto la apre, la × la richiude, e
chiusa cede i 320px al tavolo. **Chi fa cosa si vede dal colore**: le tue righe
sono viola, quelle dell'avversario indaco — vale per i messaggi e per le righe
di servizio (pesche, tiri, turni), che portano il segno sul filetto a sinistra.
Se arrivano righe a chat chiusa, il fumetto le conta con una spia. La scelta
aperta/chiusa resta fra una partita e l'altra.

Il **Flusso massimo** non ha un contatore suo: cresce da sé a ogni proprio
turno (§3.2), e per le correzioni ci sono i − e + del Flusso.

## I temi

Dalle impostazioni (ingranaggio) si sceglie il **tema del tavolo**: due
soli, **Scuro** (viola & indaco, il tema di base) e **Chiaro** (bianco
quasi pieno, solare: nasce dalla carta a tema chiaro di card.css — cornici
grigie, inchiostro quasi nero, rubino cupo. I campi sono bianchi, il posto
lo dicono orli e targhe: rosso rubino il tuo, nero l'avversario — il
viola sul bianco non regge). Il mobilio è spigoloso: nessun angolo arrotondato, come il
template della carta; gli angoli delle carte sono di card.css e restano suoi.
Un tema riveste i due campi, l'HUD, le bande della chat e il mobilio attorno
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
Sta dietro un flag, **acceso di default** (chi l'ha spento apposta resta
spento): ingranaggio → **Engine** → **Acceso** (la spia quadrata in alto ne
mostra lo stato; rossa = engine non raggiungibile, e il tavolo resta libero
come sempre). Per avviarlo:
`npm run engine` (oppure `ruby engine/bin/server`, porta 8788). Il confine
client è tutto in `src/engine.ts`; protocollo, regole collegate e piano di
crescita sono nel `engine/README.md`.

## Pubblicazione

`npm run build` compila in `dist/` alla radice del repo; `node
scripts/build-site.mjs` (dalla radice) completa il sito: il **gioco alla
radice** `/` e il **catalogo** delle carte sotto `/catalog` (è `docs/`
copiata tale e quale), da cui il gioco carica la grafica delle carte
(`./catalog/cards/ui/`, `VITE_CARDS_UI`). La build **non si committa**: la
fa Vercel a ogni push (`vercel.json`), con un'anteprima per ogni ramo. Relay ed
engine stanno su Render in un servizio solo (`scripts/server.mjs`,
`Dockerfile`, `render.yaml`): in produzione il simulatore cerca
`wss://rubyfront.onrender.com/relay` e `/engine`, salvo `VITE_RELAY_URL` e
`VITE_ENGINE_URL` impostate al build. I test girano in CI a ogni push.
