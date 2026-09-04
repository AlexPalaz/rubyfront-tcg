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
- **§6.5 Mano: massimo 7 a fine turno** — il cambio di turno non passa se chi
  chiude ha più di 7 carte in mano. È una regola di CHIUSURA: pescare
  all'ottava carta a metà turno resta legale, è il Fine turno che si ferma.
- **§6.3 Dichiarazioni: tappate, coperte, sfide 1 contro 1** — la coperta non
  dichiara nulla, la tappata non attacca né blocca, e ogni attaccante ha al
  più un bloccante. Il tavolo dell'engine segue tap, coperture e
  dichiarazioni (con le stesse pulizie del client: chi esce dal campo si
  raddrizza e libera le sue frecce). Con l'arbitro collegato il simulatore
  nasconde anche i gesti manuali Tappa/Stappa/Copri (`ctx.arbitrated()`):
  quegli stati discendono dalle dichiarazioni — il tap dall'attacco, la
  copertura dal contrattacco, la stappata dal cambio di turno (che porta con
  sé la routine di chi entra: la Pesca del turno (§6.1, «non si salta mai»),
  Flusso, stappata, frecce — un'azione sola, così nessuno compie gesti nel
  turno altrui) — e così la **scoperta a fine
  giro** (§6.3, T+3): coprire annota il turno (`coveredTurn`), e il cambio
  di turno scopre le Entità di chi entra coperte da un giro completo, nel
  riduttore e nella copia. Resta «Scopri» solo per una coperta senza data,
  arrivata da una lavagna che non la segnava. Limiti dichiarati: gli
  effetti delle carte che tappano/coprono a mano non sono concessi (la
  Stasi, §8.1, e le stappate per effetto sono arrivate dopo, con Eredità
  Perduta).
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
  CARTE: all'avvio il server carica l'anagrafe (id → tipo, parole chiave,
  Potenza e Contrattacco) dai dati del sito (`lib/rubyfront/card_index.rb`; il percorso si cambia con
  `RUBYFRONT_DATA`) e il tavolo annota il turno d'ingresso di ogni carta.
  Carta ignota o anagrafe assente: l'engine tace, mai molesto. Limite
  dichiarato: lo Slancio CONCESSO da un effetto (es. RBF-009) non si vede
  ancora — quell'Entità verrebbe fermata a torto.

- **§6 Fasi: le dichiarazioni in Fase di Fronte** — il turno ha una fase,
  nel modello MINIMO: `preparazione` o `fronte` (la Pesca non è una fase, le
  sotto-fasi del Fronte arriveranno con le Reattive). La dichiara il
  giocatore attivo (azione `phase`, bottone nell'HUD), è **a senso unico** —
  in Preparazione si torna solo col cambio di turno, e l'engine ferma il
  passo indietro — e resta facoltativa: chiudere il turno dalla Preparazione
  è legale. Con la fase al tavolo, attacchi, blocchi e contrattacchi si
  dichiarano **solo a Fronte dichiarato**: i blocchi del difensore arrivano
  dentro la Fase di Fronte dell'attaccante, che la sua dichiarazione ha già
  portato su entrambe le lavagne. Snapshot senza fase: si riparte dalla
  Preparazione, la lettura più permissiva.

- **§6.2 Ritiro** — «il ritiro è un'azione di preparazione del Fronte: non
  si ritira in Fase di Fronte, né nel turno avversario». La **fase** è il
  solo vincolo, e vale anche in Reazione; il Rubyfront non si ritira mai
  (§3.1). Dentro la Preparazione il gesto è **libero** — tappata, coperta,
  appena entrata, Materia — per **decisione del designer (2026-09-04)**:
  §6.2 chiede anche stappata, scoperta e non entrata questo turno, ma il
  Ritiro è l'attrezzo con cui si risolve a mano tutto ciò che l'engine non
  legge ancora, e quelle condizioni bloccavano più gioco vero di quanto ne
  proteggessero. Il vantaggio si prenderebbe al RITORNO, e quella strada è
  chiusa: dalla Zona di Ritiro si esce solo per effetto (voce più sotto).
  Una carta di un ALTRO posto mandata in Ritiro non è un ritiro ma un
  effetto risolto a mano: silenzio, in ogni fase. Limite dichiarato: il
  manuale al §6.2 elenca ancora le altre condizioni. Gli **Oggetti
  seguono** la loro Entità in
  Zona di Ritiro (§6.2) e nell'Abisso (§5): sciolti dall'assegnazione,
  vanno nella stessa pila — nel riduttore e nella copia; in mano o nel
  mazzo no, lì degli Oggetti decide la carta che ha mosso l'Entità.

- **§5 Materie: mai sugli slot del Fronte** — gli slot sono delle Entità, e
  una Materia GIOCATA (toZone da fuori campo) con le coordinate esatte di
  uno slot viene fermata: si posa nello spazio delle Materie, dietro. È la
  prima regola che legge le COORDINATE dell'azione — la copia del tavolo
  continua a non tracciare geometria: le costanti degli slot (specchio di
  ctx.ts, coordinate canoniche condivise) servono solo a riconoscere la
  forma del rilascio agganciato. Limiti dichiarati: il rilascio a mano
  libera vicino a uno slot non si vede (solo l'aggancio porta le coordinate
  esatte), e una Materia già in campo si sposta liberamente — il divieto è
  sul giocare. Nel client, doppio click e ricerca posano le Materie
  direttamente nella loro fila (`playSpot`): il sigillo resta per la mira
  sbagliata del trascinamento.

- **§6.3 Dichiarano solo le Entità** — la dogana del TIPO sulle
  dichiarazioni, prima di quella dello stato: il **Rubyfront** non attacca e
  non blocca (§3.1 — la sua funzione sono abilità a costo PV e Materie; un
  Rubyfront tappato non è «una tappata», è un Rubyfront e il rifiuto parla
  di lui), e Materie e Oggetti non dichiarano niente — §6.3 parla sempre di
  Entità. Carta ignota o anagrafe assente: via libera, mai molesto. Limite
  dichiarato: la regola d'oro («salvo diversa indicazione sulla carta») non
  si vede ancora, come per lo Slancio concesso.

- **§6.3 Attacca chi è di turno, blocca chi difende** — la dogana del
  POSTO: un attacco parte solo da una carta del posto attivo, un blocco o
  contrattacco solo dall'altra metà (i blocchi si dichiarano DENTRO la Fase
  di Fronte dell'attaccante, per questo il confronto è con `active`). E un
  blocco vuole **un attaccante vero**: il bersaglio deve avere un attacco
  dichiarato in piedi — sgomberato il combattimento, serve un'ondata nuova
  per bloccare di nuovo.

- **§6.4 Reazione: l'ondata passa al difensore** — terza fase del modello
  (preparazione → fronte → reazione, sempre a senso unico; la Reazione si
  apre solo dal Fronte). Con la Reazione al tavolo le dichiarazioni si
  spartiscono le fasi: gli **attacchi** vivono nel Fronte (in Reazione
  «niente nuovi attacchi»), i **blocchi e contrattacchi** nella Reazione —
  «vista l'intera ondata» (§6.4). E il **Fine turno non passa** sopra
  un'ondata dichiarata finché la parola non è passata al difensore (bottone
  «Al difensore» nell'HUD); dalla Reazione invece si chiude liberamente —
  e la Reazione **la chiude chi difende** (§6.4: «conclusa la Reazione,
  blocchi assegnati o rinuncia del difensore»): risolvere l'ondata e
  chiudere il turno da lì sono gesti del difensore, non di chi attacca, che
  «aspetta la reazione» — il «Fine fase» dell'HUD passa dall'altra parte
  del tavolo, e la dogana del turno lo fa rispettare. La stretta di mano
  esplicita sulle Reattive arriverà con la catena.

- **§6.3/§6.4 Risoluzione delle battaglie** — la prima regola in cui il
  tavolo FA qualcosa da sé, con l'engine che resta arbitro. Dal «Fine fase»
  della Reazione il client di chi è di turno calcola l'esito dell'ondata
  (`combat.ts`, `resolveWave`) dalle statistiche stampate del catalogo e lo
  manda in un'azione sola, `resolve {seat, battles}`; l'engine rifà lo
  stesso conto dalla copia del tavolo e dall'anagrafe e passa solo un esito
  identico, battaglia per battaglia, nell'ordine di dichiarazione. Le regole
  (§6.3): non bloccato, danni pari alla Potenza; bloccante inferiore muore,
  pari muoiono entrambi, superiore nessuno — e l'attacco è comunque
  bloccato; contrattacco a Potenza più N, con l'attaccante che muore se il
  totale lo raggiunge. Col sì il riduttore e la copia mandano i morti
  nell'Abisso (come un toZone) e sgomberano le frecce; i danni scendono sui
  PV del difensore, mai sotto zero. Si risolve in Reazione, e risolve chi è
  di turno; un attaccante uscito dal campo non ha battaglia e un bloccante
  uscito lascia l'attacco non bloccato (chi esce perde la freccia, §6.3).
  Carta senza Potenza in anagrafe: il conto non si rifà, silenzio — e il
  client, se gli manca nel catalogo, annota e chiude il turno come prima.
  Limiti dichiarati allora: Stasi, Vendetta, le Reattive come bloccanti e
  ogni modifica di Potenza in partita non si vedevano — sono arrivate
  dopo (§8.1, §8.2, §7.2, più sotto). Engine 0.14.0, quattordici regole.

- **§6.2 Le carte si giocano in Preparazione** — «in questa fase si inizia a
  giocare con le carte e si prepara il Fronte»: nel Fronte si dichiara,
  nella Reazione si difende, e un ingresso in campo da fuori (Entità,
  Materie normali e permanenti, Oggetti) fuori dalla Preparazione viene
  fermato — per entrambi i posti, perché nel turno altrui non è
  Preparazione di nessuno. Due eccezioni del manuale: le **Materie
  Reattive**, che «si giocano solo in Fase di Fronte» (§7.2; l'anagrafe
  legge il `behavior` della Materia — e il rovescio vale: una Reattiva in
  Preparazione è fuori dalla sua finestra, di chiunque sia il turno), e il
  **Rubyfront**, che si schiera o
  schiera «in qualsiasi momento del proprio turno» (§3.1). Il Nexus non
  c'entra: è un flip, non un ingresso. Carta ignota: silenzio. Limite
  dichiarato: gli effetti che mettono in campo una carta durante il
  combattimento verrebbero fermati a torto (arriveranno con la regola
  d'oro). Engine 0.15.0, quindici regole.

- **§6 Nel turno altrui non si agisce** — «le prime tre fasi appartengono
  al giocatore di turno». È la dogana che viene PRIMA di tutte le altre e
  guarda **chi compie il gesto**, non di chi è la carta: per questo la
  richiesta di giudizio porta un `actor` — in rete il posto del client, in
  partita locale (lo stesso mouse per i due posti) il proprietario della
  carta o del contatore toccato, e chi è di turno per i gesti senza posto.
  Al difensore restano le finestre del manuale: blocchi e contrattacchi in
  Reazione (§6.4, e il ripensarci), la **copertura del contrattaccante**, che
  «scatta alla dichiarazione dei blocchi» (§6.3, punto 4: «chi blocca si
  tappa, chi contrattacca si copre») e quindi cade nel turno di chi attacca —
  coprire e scoprire una propria Entità in campo, in Reazione, è un gesto suo
  —, le Materie Reattive nel Fronte altrui
  (§6.3 Pre-Fronte, §7.2), i propri contatori in Fronte e Reazione perché le
  Reattive si pagano. I gesti di apparecchiatura non hanno turno: caricare
  il proprio mazzo (all'ingresso in stanza), «Nuova partita», il proprio
  nome, la chat. E prima del primo turno c'è la preparazione della
  partita (§4): al turno 1 in Preparazione anche l'altro posto apparecchia
  il suo mazzo — mano iniziale, mescola, mulligan fra mano e mazzo, solo
  sulle proprie carte. Tutto il resto — pescare, giocare, ritirare, muovere
  fra le zone, cambiare fase o turno, risolvere — aspetta il proprio turno.
  Attore assente (client vecchio): la dogana tace. Limiti dichiarati: gli
  effetti risolti a mano che fanno agire l'avversario nel turno altrui («il
  tuo avversario pesca…») verrebbero fermati a torto; e in locale un effetto
  risolto a mano sulle carte avversarie risulta un gesto dell'avversario. In
  rete no: lì il gesto è di chi trascina. Engine 0.16.0, sedici regole.

- **§3.2 Le carte si pagano** — «il solo vincolo è il Flusso disponibile —
  Oggetti compresi». Giocare DALLA MANO scala il costo stampato dal Flusso,
  nel riduttore e nella copia del tavolo, nella stessa azione dell'ingresso
  in campo: il costo viaggia in `toZone` (`cost`), lo mette il client dal
  catalogo e l'engine lo verifica contro l'anagrafe (che ora legge il
  `fluxCost`) — un costo che non torna è fermato come uno che non si può
  pagare («Flusso insufficiente: ne hai 2, la carta costa 3»). Da mazzo,
  Abisso o Ritiro una carta torna in campo per effetto e non si paga. Per
  questa regola la copia Ruby ha imparato a tenere il **Flusso** dei due
  posti (patch dei contatori, ricarica del cambio di turno, snapshot). Il
  Gettone resta la spesa manuale di sempre. Fuori: il Rubyfront, il cui
  costo di schieramento può essere un dado (la regola del tiro pagabile,
  §3.1, arriverà a parte). Limiti dichiarati: sconti da effetto e carte
  messe in campo gratis da un effetto verrebbero fermati a torto (regola
  d'oro). Engine 0.17.0, diciassette regole.

- **§5 Le Entità stanno sugli slot del Fronte** — con l'arbitro la lavagna
  non è più libera: un'Entità che scende in campo o si sposta sul campo va
  su uno dei cinque slot della PROPRIA fila, e l'engine guarda la forma
  dell'azione (`toZone` e `move` con le coordinate canoniche degli slot),
  come per le Materie — la copia del tavolo continua a non tracciare
  geometria, e l'occupazione dello slot è affare della lavagna, che con
  l'arbitro sceglie da sé: lo slot del rilascio se è libero, altrimenti il
  primo libero, e a Fronte pieno il gesto cade. Le Materie vanno nella loro
  fila e si spostano liberamente; il Rubyfront ha due posti soli (il suo
  davanti al Fronte e la Zona di Richiamo) e ci arriva solo agganciato; un
  Oggetto si posa solo addosso a un'Entità (`table.ts`, `boundSpot`).
  Coordinate assenti: niente da giudicare.
- **§5/§6.2 Dal campo non si torna in mano né nel mazzo** — dal campo si
  esce con il Ritiro, con l'Abisso o con un effetto; il Rubyfront
  schierato resta in campo. Vale per tutti i posti. Limite dichiarato:
  un effetto «rimetti in mano» verrebbe fermato a torto (regola d'oro).
  Engine 0.18.0, diciannove regole.

- **§7 Le Materie si giocano solo se abilitate** — «una carta Materia è
  giocabile solo se in campo c'è una carta che ha quel tipo di Materia
  abilitato», al grado richiesto (§7.1): abilita una PROPRIA carta in
  campo, non coperta (la tappata abilita normalmente), con la faccia che
  mostra — il Nexus abilita solo ciò che è stampato su di lui (§3.1) — e il
  Rubyfront solo schierato: in Zona di Richiamo non abilita nulla. Per
  dirlo la copia del tavolo annota due cose in più su ogni carta: la
  faccia (`flip`) e la fila dell'ultima posa in campo (`row`, l'ordinata
  canonica di `toZone`/`move`) — l'unica geometria che tiene, e solo per
  distinguere il Rubyfront schierato da quello in Richiamo. L'anagrafe
  legge tipo e grado delle Materie e le abilitazioni per faccia. Vale
  giocando dalla mano; Materia senza etichetta o fila ignota: nel dubbio
  non si accusa. Il sigillo: «nessuna carta in campo abilita la Materia
  Dinamica di grado 2». Limiti dichiarati: l'attribuzione (quale
  abilitante, §7) non si sceglie, e il decadere delle permanenti quando
  l'abilitazione si perde (§7.2) arriverà a parte. Engine 0.19.0, venti
  regole.

- **§2/§9 Fine della partita** — la dichiara il client che l'ha vista
  arrivare, con un'azione `gameOver {winner, reason}`, e l'engine la
  verifica sulla copia del tavolo, che per questo ha imparato a tenere
  anche i **PV** (patch dei contatori, danni della risoluzione,
  snapshot): per PV, chi perde deve essere a 0 (§2), nel pareggio
  entrambi (§9.2); per mazzo esaurito, chi perde deve avere il mazzo vuoto
  (§9.1 — il tempismo è del client: al confine dei turni, chi chiude a
  mazzo vuoto ha perso, se no chi entrerebbe a mazzo vuoto, e la fine
  sostituisce il cambio di turno; un posto senza nessuna carta non ha un
  mazzo esaurito, non ha ancora un mazzo). A partita finita il tavolo si ferma —
  restano Nuova partita, la chat, i pixel, il carico del mazzo — e
  l'insegna al centro non svanisce più: «Hai vinto», «Vittoria di X»,
  «Pareggio», col motivo sotto. Limiti dichiarati: il pareggio di comune
  accordo (§9.2) non ha ancora un gesto, e il Nexus vale come il
  Rubyfront (stessi PV). Engine 0.20.0, ventuno regole.

- **§3.1 Il Rubyfront si schiera pagando** — lo schieramento è il `move`
  dalla Zona di Richiamo alla sua fila, e «si paga identico a ogni
  schieramento»: il costo stampato — fisso, o un dado (`deploymentCost`,
  che l'anagrafe legge come `{ fixed:, die: }`). Col dado «si può lanciare
  solo se il Flusso disponibile copre il risultato peggiore», Gettone
  compreso, e si paga il numero uscito; il client tira (il dado gira al
  centro del tavolo, poi la carta scende) e mette nell'azione `cost` e
  `roll`; l'engine verifica la forma — costo uguale allo stampato, tiro fra
  1 e le facce, costo uguale al tiro, Flusso che copre le facce — non la
  fortuna, come un arbitro con un dado tirato sul tavolo (limite
  dichiarato). Lo schieramento è un gesto del proprio turno; gli
  spostamenti sulla fila sono liberi. Con questa regola il pagamento
  si è unificato nei due gemelli (`pay`): prima la barra, poi il
  **Gettone**, che la copia del tavolo ora tiene (chi non inizia, patch,
  snapshot) e che conta nel Flusso disponibile anche per il costo delle
  carte (§3.2). Engine 0.21.0, ventidue regole.

- **§3.1 Il Rubyfront schierato non torna in Zona di Richiamo** — «non
  per una perdita di PV, non per scelta: non esiste un richiamo
  volontario» (deciso dal designer, manuale aggiornato). Un `move` del
  Rubyfront dalla sua fila alla fila di servizio viene fermato; in Zona di
  Richiamo ci si sposta solo se non si è ancora schierati (anche nel
  client, `boundSpot`). Limite dichiarato, e vale per ogni regola: «solo
  una carta può riportarlo» (regola d'oro, §1.1) — oggi nessuna lo fa, e
  quando una lo farà l'effetto risolto a mano verrebbe fermato a torto
  finché l'engine non saprà leggere gli effetti. Engine 0.22.0, ventitré
  regole.

- **§8.2 Effetti certificati** — il primo passo della regola d'oro (§1.1:
  «la carta vince sempre sulle regole»). Un effetto si esegue come passi di
  azioni che esistono già, ognuno marcato con `effect {source, event,
  entering}`; l'engine verifica il passo contro la **forma certificata** in
  anagrafe e lo lascia passare come effetto, una volta per coppia
  fonte/ingresso finché dura il turno (la copia del tavolo annota gli
  inneschi consumati). Oggi una forma sola, l'ascoltatore d'ingresso di
  RBF-003: «quando un'altra Entità Umana entra sul tuo Fronte, se ne
  controlli almeno 3, pesca una carta» — chi entra non fa nulla da sé, sono
  le carte già in campo a innescarsi; la fonte dev'essere in campo dello
  stesso posto, l'ingresso un'altra carta entrata questo turno della razza
  chiesta, il conto delle Entità fatto contando chi è appena entrato, e il
  passo una pesca del controllore di K carte. Un passo con `effect` che non
  combacia è fermato: un effetto finto non è un gesto qualunque. Carta di
  chi entra ignota all'anagrafe: silenzio. Nel client l'interprete
  (`effects.ts`, senza DOM) trova gli inneschi, la scena d'ingresso li
  elenca e «Risolvi» li esegue, la fonte si accende sul tavolo da entrambe
  le parti. La seconda forma è quella di RBF-007, l'**Arciere**: «quando
  questa Entità entra in campo, metti un'Entità avversaria nella Zona di
  Ritiro» — un `toZone` marcato con `effect` (fonte e ingresso coincidono),
  che l'engine passa se la fonte è entrata questo turno, l'innesco non è
  consumato, la zona è quella della forma e il bersaglio è un'Entità
  avversaria in campo. Nel client il bersaglio si sceglie in mira, con la
  freccia dalla fonte al dito; poi la fonte si accende, la freccia va al
  bersaglio e la carta parte — anche per chi guarda. La terza forma è
  quella di RBF-012, **Rhen**: «quando questa Entità entra in campo, metti
  sul tuo Fronte una carta permanente dalla tua Zona di Ritiro» — un
  `toZone` verso il campo marcato con `effect`, che passa se la carta
  scelta è una Materia permanente nella PROPRIA Zona di Ritiro; nel client
  si sceglie dalla pila (la finestra della ricerca, ristretta ai
  candidati), si conferma, e la carta vola dalla pila al suo posto. E il
  **«quando attacca»** della stessa carta: gli inneschi hanno un evento
  (`effect.event`, ingresso o attacco), e quello dell'attacco vale con un
  attacco dichiarato in Fase di Fronte, una volta per attacco (gli inneschi
  consumati sono triple fonte/evento/ingresso); nel client, dichiarato
  l'attacco, la scena dice «Quando attacca» e «Risolvi» fa lo stesso
  ritorno. Della stessa famiglia è RBF-026, l'**Esploratore**: «la prima
  volta in ogni tuo turno che questa Entità attacca mentre ha un Oggetto
  assegnato, pesca una carta, poi scarta una carta» — una pesca marcata
  con `effect` (evento `on_attack`, fonte e ingresso coincidono) che passa
  con un attacco dichiarato in Fase di Fronte, un Oggetto in campo
  assegnato alla fonte, il conto della forma e la pesca di chi la comanda;
  «una volta per turno» lo dà il gioco (un'Entità attacca una volta sola).
  Lo scarto è il **seguito**: un `toZone` dalla mano all'Abisso con
  `follow: "discard"` nel riferimento, che passa solo dopo la pesca e una
  volta sola (gli inneschi consumati distinguono il seguito:
  `fonte|on_attack:discard|fonte`), dalla mano di chi comanda. Limite
  dichiarato: l'engine non **pretende** lo scarto — se il client non lo
  manda, nessuna regola lo reclama; è il tavolo a chiederlo, e la finestra
  torna finché non si sceglie. Nel client la fonte si accende, si pesca,
  poi si sceglie dalla mano.
- **§8.2 Le altre forme «quando attacca»** — undici inneschi su nove carte,
  letti dall'anagrafe in `attack_forms` (con la faccia che li porta) e
  giudicati con un contesto comune: l'ingresso del riferimento è chi
  attacca, in campo con un attacco dichiarato in Fase di Fronte; la fonte
  è in campo ed è, secondo la forma, chi attacca, un Oggetto addosso a chi
  attacca, una carta dello stesso posto (un'alleata, una Materia
  permanente, il Rubyfront/Nexus schierato); ogni passo ha la sua tripla
  (`fonte|on_attack:passo|attaccante`, o `turn` al posto dell'attaccante
  per «una volta per turno», che il riferimento dichiara con `once`).
  Le forme: RBF-028, il **Vigile** — armato, «stappala dopo il
  combattimento»: viaggia nella risoluzione (`resolve.untap`), una volta
  per turno; RBF-029, il **Comando** — armato, «+1 Potenza alle altre
  Entità armate che controlli» (`empower`, un passo per bersaglio);
  RBF-034, il **Catalizzatore Sigma** — l'Oggetto dà +1 a chi lo porta,
  «poi tira un d6: con 5–6 guarda le prime 4, una Materia in mano, le
  altre in Zona di Ritiro» (`look` con `revealTo`/`restTo`); RBF-031, il
  **Furiere** — quando attacca un'Entità armata che controlli, puoi
  assegnarle un Oggetto dalla Zona di Ritiro senza pagarlo
  (`toZone.assignTo`, senza `cost`) e, una volta per turno, guardi le
  prime 2 e puoi mettere un Oggetto in Zona di Ritiro; RBF-008, il
  **Guaritore** — «+2 PV» (`player` con riferimento: i PV devono essere
  quelli di prima più due), «poi un d6: con 5–6 un'Entità dalla Zona di
  Ritiro in mano» (il seguito `recall`, col tiro); RBF-010, l'**Eco** —
  «un d6: con 5–6 un'Entità Umana dalla Zona di Ritiro sul Fronte, che
  attacca insieme» (un `toZone` col tiro, poi un `declare` col seguito
  `join`, esente dall'attesa di evocazione); RBF-011, la **Carica** —
  «un d20: con 15–20 stappa tutte le tue Entità e c'è una Fase di Fronte
  addizionale» (`refresh`; la promessa si consuma tornando dalla Reazione
  al Fronte, e la apre chi chiude la Reazione); RBF-022, gli **Eredi** —
  la Materia permanente: quando attacca un Umano che controlli, «un d20:
  1–6 guadagni PV pari agli Umani che hanno attaccato, 15–20 li perde il
  Rubyfront/Nexus avversario, 7–14 nulla»; RBF-001, **Oblivhal** — «la
  prima volta in ogni tuo turno che almeno 3 Umani che controlli hanno
  attaccato, +2 PV», e il Nexus «pesca una carta, poi scarta» (i seguiti
  `draw` e `discard`); RBF-004, il **Vendicatore** — «la prossima Entità
  Umana che attacca ottiene Vendetta fino a fine turno» (l'engine
  pretende che sia il PRIMO Umano dichiarato dopo la fonte); RBF-005, la
  **Razzia** — «se almeno 2 Umani che controlli hanno attaccato nel tuo
  turno precedente, un'Entità avversaria non può bloccare» (la copia
  ricorda l'ultima ondata alla risoluzione; il divieto ferma il blocco
  alla dichiarazione). Gli attrezzi comuni: `empower` (Potenza, parole
  chiave, divieto di blocco fino a fine turno, cancellati dal cambio di
  turno), la Potenza in campo nella risoluzione (stampata più bonus) e la
  **Vendetta** (§8.1, stampata o concessa: chi blocca con Vendetta e
  supera l'attaccante lo uccide). Limiti dichiarati: il caso lo tira
  sempre il client, l'engine verifica il tiro e la soglia, non la
  fortuna; gli statici «+1 per ogni altro Umano» (RBF-010), «+1 alle
  altre armate» (RBF-031) e «Contrattacco +2 se armata» (RBF-028) non
  sono collegati (sono `while_in_play`, non inneschi d'attacco), quindi
  una risoluzione che li contasse a mano verrebbe fermata; il Furiere
  «se può riceverlo» si limita a non vestire una coperta; nella Fase di
  Fronte addizionale le Entità stappate attaccano di nuovo per la regola
  d'oro, e la Reazione che segue è una Reazione come le altre. (Gli
  statici di RBF-002/010/013/014 e la Stasi sono arrivati dopo, con
  Eredità Perduta, più sotto.) L'avversario vede gli esiti, non i dadi.
  La quarta forma è quella di RBF-006, il **Cercatore**: «guarda le prime 4
  carte del tuo mazzo, puoi mostrare un'Entità Umana e aggiungerla alla
  mano, metti le altre in fondo» — un'azione sola, `look {seat, count,
  reveal?}`, che riduttore e copia applicano insieme (la rivelata in fondo
  alla mano, le altre in fondo al mazzo nell'ordine in cui stavano) e che
  l'engine passa se il conto è quello della forma e la rivelata sta fra le
  prime N ed è del tipo e della razza chiesti; nel client si vedono le
  quattro, si sceglie fra quelle che si possono mostrare (le altre velate),
  Chiudi per nessuna. Lo stesso passo serve a RBF-027, l'**Artefice**:
  «tira un d6 e guarda 2 più metà del tiro (arrotondata per eccesso), puoi
  mostrare un Oggetto e aggiungerlo alla mano, metti una delle altre nella
  Zona di Ritiro e le restanti in fondo» — `look` porta anche `roll` e
  `retire`; l'engine verifica il tiro nella forma, il conto dalla formula
  (la sola certificata), e che una delle altre vada in Ritiro quando ce
  ne sono. La quinta forma è quella di RBF-009, il
  **Radunatore**: «prendi il controllo di un'Entità avversaria con costo di
  Flusso 3 o inferiore fino alla fine del turno; ottiene Slancio» — con
  essa nasce il **controllo** (§8.2, «Prendere il controllo», scritto col
  designer): un'azione `control {uid, by, grants}` che cambia chi comanda,
  non il proprietario — la carta passa nello slot extra di chi la
  controlla, con gli Oggetti addosso, «entra» ora (i suoi effetti
  d'ingresso si applicano) e attacca per lui; attacchi, blocchi, ascolti
  ed effetti guardano chi comanda (`controller_of`), lo Slancio concesso
  vale come quello stampato; e a fine turno il tavolo di chi ha chiuso
  manda `release {uid, zone, x?, y?}` — sul Fronte del proprietario in uno
  slot libero, o nella sua Zona di Ritiro se è pieno — che l'engine passa
  solo per una carta controllata e solo a turno finito. Tutto ciò che non
  ha una forma certificata resta a mano. Engine 0.30.0, trenta regole.

- **§8.2 Gli statici di Potenza nella risoluzione** — la prima famiglia
  di effetti che non si «risolve» ma vale finché la carta è in campo:
  l'anagrafe li legge in `static_forms` (e il client in `cardStats`, stessi
  criteri) e `power_of` li conta insieme alla Potenza stampata e al bonus
  fino a fine turno — mai sotto 0 (§8.2, «Modifiche alla Potenza»). Le
  forme: RBF-002, il **Ragazzo** — «+1 mentre attacca, se sul tuo Fronte
  c'è un'altra Entità Umana» (in difesa resta un 1: si guarda l'attacco
  dichiarato); RBF-010, il **Simulacro** — «+1 per ogni altra Entità Umana
  sul tuo Fronte»; RBF-013, il **Vigorscudo** — «+1» a chi lo porta; RBF-014,
  la **Vigorcintura** — «+1 per ogni Entità Umana sul tuo Fronte»,
  portatrice compresa. «Sul tuo Fronte» conta le Entità che il posto
  comanda (le sue e quelle che controlla, §8.2). Limiti dichiarati: gli
  statici di Scissione Profonda («+1 alle altre armate» di RBF-031,
  «Contrattacco +2 se armata» di RBF-028, i modificatori degli Oggetti
  RBF-032/033/035) restano nel debito, e una risoluzione che li contasse
  a mano verrebbe fermata.
- **§8.1 La Stasi** — «bloccando non muore: resta tappata per sempre». La
  risoluzione la vede — stampata, concessa, o data da un Oggetto addosso
  «mentre assegnato» (RBF-013: agli Umani) — e la battaglia lo dice
  (`blockerStasis`): il bloccante che avrebbe dovuto morire resta in
  campo, tappato, e nel contrattacco la stasi sostituisce la copertura;
  l'attaccante muore comunque se doveva. Il cambio di turno non stappa chi
  è in stasi, la copia e il riduttore la annotano (`stasis`, anche nello
  snapshot), e la Stasi cade solo per un effetto che stappa (`empower` con
  `untap`, `refresh`): allora «torna un'Entità normale». Tappata, non si
  ritira (§6.2): lo dice già la dogana del Ritiro. Stasi in attacco: non
  protegge, come dice il manuale.
- **§8.2 Il blocco multiplo** — «può essere bloccata da più Entità»
  (RBF-014): con la Cintura addosso all'attaccante la dogana delle sfide 1
  contro 1 si apre, e la copia tiene tutti i bloccanti nell'ordine dei
  blocchi (`blockers_of`). **La risoluzione con più bloccanti non è
  scritta nel manuale**, e l'engine la legge così, da confermare col
  designer: l'attaccante affronta ciascun bloccante in una battaglia a
  sé, con la sua Potenza intera contro ognuno, nell'ordine dei blocchi —
  muore se una battaglia lo uccide (una volta sola), ogni bloccante ha la
  sua sorte, e l'attacco è bloccato. L'alternativa (le Potenze dei
  bloccanti sommate) è una riga di manuale da scrivere.
- **§7.2 Le Reattive: prima dell'ondata, o come blocco** — «dopo la
  dichiarazione dell'attacco non si iniziano più Reattive, con un'unica
  eccezione: le Reattive del difensore giocate come blocco». In Fase di
  Fronte una Reattiva scende — di chiunque sia (Pre-Fronte
  dell'avversario, poi la finestra di chi è di turno: le due sotto-finestre
  non si distinguono) — solo finché l'ondata non è dichiarata; in Reazione
  scende solo una Reattiva con la forma «si gioca come blocco», e solo dal
  difensore. Giocata, sostituisce il bloccante (§6.4): la dogana delle
  dichiarazioni accetta un blocco da una Materia Reattiva scesa questo
  turno con quella forma (mai un contrattacco), e la risoluzione la conta
  come dice il manuale — «non c'è confronto di Potenza, l'attacco è
  comunque bloccato», la sorte dell'attaccante la dice il testo (RBF-020
  non dice nulla) — e la Reattiva si consuma (`blockerSpent`: nell'Abisso
  alla risoluzione, nel riduttore e nella copia). Limiti dichiarati: la
  catena di risposta (§7.2) non c'è — una Reattiva giocata in risposta a
  un'altra verrebbe fermata; e i passi dell'effetto di una Reattiva
  giocata come blocco sono del difensore nel turno altrui: la dogana del
  turno li lascia passare se la fonte è sua.
- **§7.2 Le Materie si risolvono** — «l'effetto si risolve immediatamente,
  poi la carta va nell'Abisso»: le sette Materie di Eredità Perduta hanno
  la loro forma certificata (`resolve_forms`, evento `on_resolve`), e i
  passi viaggiano marcati `effect {event: "on_resolve"}` con fonte e
  ingresso che coincidono — la Materia stessa, in campo, scesa QUESTO
  turno — ogni passo con la sua chiave (`fonte|on_resolve:passo|fonte`).
  RBF-015, l'**Attrazione**: «guarda le prime 4, puoi mostrare fino a 2
  Entità Umane e aggiungerne una alla mano» — un `look` (la seconda
  mostrata è solo in vista: limite dichiarato, l'engine ne verifica una);
  RBF-016, la **Formazione**: «stappa un'Entità Umana che controlli: +1
  Potenza» — `empower {untap: true, power: 1}`, un bersaglio solo per
  risoluzione; RBF-017, l'**Impatto**: «un'Entità avversaria con costo 2 o
  inferiore nella Zona di Ritiro» — un `toZone` verso il Ritiro; RBF-018, il
  **Campo Repulsivo** (permanente): «manda nell'Abisso un permanente
  avversario; finché questa carta resta in gioco resta nell'Abisso; quando
  lascia il gioco torna in gioco» — un `toZone` con `heldBy`, che la copia
  e il riduttore annotano sulla carta esiliata (`heldBy`, anche nello
  snapshot); quando chi la teneva lascia il campo, il tavolo che l'ha
  visto uscire manda un `release` (lo stesso della restituzione del
  controllo), sul Fronte del proprietario o nella sua Zona di Ritiro se è
  pieno, e l'engine lo passa solo a chi tiene fuori dal campo — «permanente»
  qui è un'Entità o una Materia permanente (mai il Rubyfront; gli Oggetti
  seguono la loro Entità nell'Abisso e restano lì, §3.1); RBF-019, la
  **Forza della Radura**: il d20 a fasce — con 1–6 +4 PV (`player`), con
  7–13 un'Entità Umana con costo 2 o inferiore dalla mano sul Fronte
  (`toZone` senza costo), con 14–19 una pesca, con 20 tutte e tre; ogni
  passo porta il tiro, il primo lo fissa e gli altri devono dire lo stesso;
  RBF-020, il **Contrattacco Coordinato**: giocato come blocco (sopra),
  «se sul tuo Fronte ci sono almeno 3 Entità Umane, stappa le Entità Umane
  che controlli: Contrattacco +1» — un `empower {untap, counter: 1}` per
  bersaglio, che passa solo a blocco dichiarato, e la risoluzione conta
  il Contrattacco concesso (`counter_bonus`, fino a fine turno); RBF-021,
  il **Giudizio Cremisi**: «distruggi un'Entità; se bersaglia una tappata
  costa 3 in meno» — il bersaglio si dichiara GIOCANDO la carta (`target`
  nel `toZone`, annotato sulla Materia finché sta in campo), lo sconto
  vale solo se quel bersaglio è tappato, e il passo che distrugge deve
  colpire lui (senza bersaglio dichiarato: costo pieno, e poi si sceglie).
  Nel client la scena elenca i passi e «Risolvi» li esegue; la Materia
  normale o Reattiva vola poi nell'Abisso da sé, la permanente resta —
  e chi teneva un permanente nell'Abisso lo restituisce appena esce
  (`releaseHeld`). Limiti dichiarati: l'engine non PRETENDE che la
  Materia risolta vada nell'Abisso (è il tavolo a mandarcela); l'ordine di
  risoluzione degli effetti simultanei (§8.2) e il decadere delle
  permanenti con l'abilitazione (§7.2) non sono collegati; il tiro del
  d20 lo fa il client; RBF-038 («poi perdi 2 PV») e le altre Materie di
  Scissione restano nel debito.
- **§3.1 Il Nexus** — il flip è un'azione con una regola: verso la faccia
  del Nexus passa solo dal Rubyfront in campo (non dalla Zona di Richiamo),
  nel proprio turno in Preparazione o Fronte, con i requisiti stampati
  soddisfatti «al momento del flip» — l'anagrafe li legge in `nexus`
  (RBF-001: «controlli almeno 4 Entità Umane», «scarta una carta Entità»)
  — e l'azione porta lo scarto (`discard`, dalla propria mano, nell'Abisso)
  e il recupero di PV stampato (`recover`, +5), che riduttore e copia
  applicano nella stessa azione; indietro non si flippa («rimane in campo
  per tutta la partita»). Requisito con una forma ignota (RBF-023: «con un
  Oggetto assegnato», e il costo dal Ritiro): silenzio, il flip resta a
  mano. La copia annota il turno del flip, e i passi «quando flippa»
  (`effect {event: "on_flip"}`, forme `flip_forms`) valgono solo per un
  Nexus flippato questo turno: RBF-001 manda Rhen, Erede di Vhal Astra dal
  proprio Fronte nell'Abisso (un `toZone`) e la **sigilla** — una patch
  `sealed` del posto (`player`), che riduttore e copia tengono (anche
  nello snapshot) e che la dogana del giocare legge: la carta sigillata
  non scende più, da nessuna zona, «per il resto della partita». Nel
  client «Flip → Nexus» con l'arbitro legge il requisito, chiede lo scarto
  dalla mano e apre la scena «Quando flippa». Limiti dichiarati: le
  abilità speciali a costo PV (§3.1) e la Furia (§8.1) non sono collegate;
  le Materie permanenti dei tipi che il Nexus non abilita più non decadono
  da sole (§3.1, §7.2). Engine 0.34.0, trentasei regole.

- **§3.1 Il Rubyfront in Zona di Richiamo non ha abilità** — «è
  attaccabile anche mentre si trova in Zona di Richiamo: i suoi PV sono un
  bersaglio valido dall'inizio alla fine della partita. Abilità (principale
  e speciali) e Materie, però, sono utilizzabili solo quando è in campo:
  schierarlo serve a sbloccarle». La Zona di Richiamo sta sulla lavagna
  (zona `field`, fila di servizio), e finora bastava quella zona perché il
  Rubyfront contasse come in gioco: Oblivhal curava «al terzo Umano»
  ancora da schierare. Ora c'è un solo modo di dire «in gioco» nei due
  gemelli (`in_play?` / `inPlay`): per ogni carta è la zona, per il
  Rubyfront è anche la fila, perché lo schieramento è esattamente il
  passaggio dalla fila di servizio a quella del Fronte. L'engine lo legge
  nell'imbuto di tutti gli effetti certificati, una volta sola e prima di
  ogni altra verifica — nessuna forma innesca dalla Zona di Richiamo — e
  già dava lo stesso per le Materie (§7) e per il flip. Il client non
  propone gli inneschi di un Rubyfront non schierato, né «quando attacca»
  né come ascoltatore d'ingresso. Fila ignota (snapshot da una lavagna che
  non la segnava): nel dubbio è in gioco, mai molesto. Limiti dichiarati:
  le abilità speciali a costo PV non sono collegate, quindi il divieto
  per loro resta a mano; e se una carta riporterà il Rubyfront in Zona di
  Richiamo (regola d'oro, §3.1) la lettura vale da sé. Engine 0.35.0,
  trentasette regole.

- **§5 L'Abisso: ci si va morendo, consumandosi o scartando, e non si
  torna** — «la zona delle carte morte o consumate: Entità morte o
  distrutte, Materie risolte, decadute o svanite, Oggetti che seguono
  un'Entità morta, carte scartate dalla mano». Un `toZone` verso l'Abisso
  senza riferimento d'effetto passa solo per una **Materia in campo** (la
  risolta che si consuma, la permanente che decade: gesto a mano) e per lo
  **scarto per eccesso** dalla mano (§6.5, oltre le 7 carte). Il resto —
  un'Entità trascinata nell'Abisso, una carta dal mazzo o dal Ritiro — è
  fermato: si muore con la risoluzione (§6.4), si scarta per effetto, e
  l'effetto passa con il suo riferimento da `judge_effect`, non da qui. E
  **dall'Abisso non si torna**: verso mano, mazzo, campo o Ritiro senza
  riferimento è fermato — «solo una carta può riportarne fuori» (l'esilio
  condizionato di RBF-018 ha già il suo `release`). Carta ignota: silenzio.
  Limiti dichiarati: un effetto risolto a mano che scarti o riporti («puoi
  scartare una carta», non certificato) verrebbe fermato a torto (regola
  d'oro); la proprietà non si guarda (una Materia avversaria in campo
  passerebbe: la dogana del turno ferma il gesto nel turno altrui, non nel
  proprio).

- **§5/§6.2 Dalla Zona di Ritiro si esce solo per effetto** — la Zona di
  Ritiro «funziona esattamente come l'Abisso», e questa è la metà che
  conta: ci si **entra** liberamente (il Ritiro è un gesto, sopra), ma un
  `toZone` che ne porti FUORI una carta — verso il Fronte, la mano, il
  mazzo, l'Abisso — senza riferimento d'effetto è fermato. Le carte tornano
  con gli effetti che le nominano («riporta in mano un'Entità dalla tua Zona
  di Ritiro», «metti sul tuo Fronte una permanente dalla tua Zona di
  Ritiro»), e un effetto passa da `judge_effect` col suo riferimento, non da
  questa dogana. Nel client, con l'arbitro al tavolo, una carta nell'Abisso
  o in Zona di Ritiro non offre più destinazioni nel menu. Limite
  dichiarato: un effetto risolto a mano che riporti fuori una carta (non
  ancora certificato) verrebbe fermato a torto — regola d'oro.

- **§5 Le Entità restano nello slot in cui sono scese** — «un'Entità
  occupa lo slot in cui è scesa: non si sposta da uno slot all'altro, salvo
  che una carta lo dica» (decisione del designer, 2026-09-04, scritta nel
  manuale). Con la fila nota e sul Fronte ogni `move` di un'Entità è un
  cambio di slot, e viene fermato; il client non manda più il gesto a
  vuoto (riposare la carta dov'era, il «torna indietro» dopo un sigillo).
  Fila ignota (lavagna vecchia): resta la dogana della forma, poi la fila
  si annota e lo slot è quello. Limite dichiarato: l'effetto che sposti
  un'Entità di slot, se mai ci sarà, verrebbe fermato a torto.

- **§7.2 Le Reattive come blocco, due letture** — RBF-040, lo **Scudo
  Riflesso**: «giocala come blocco a un attaccante: quell'attacco è
  bloccato. Se sul tuo Fronte ci sono almeno 2 Entità con un Oggetto
  assegnato, guadagni 3 PV» — forma certificata `block` (anagrafe e
  renderer): si gioca in Reazione, la dichiarazione dalla Materia ferma
  l'attaccante (§6.4, senza confronto di Potenza), e il passo è la cura,
  di chi comanda la fonte, esatta, con gli armati che bastano (la copia
  del tavolo conta gli armati, `armed_uids`). RBF-020, il **Contrattacco
  Coordinato**: «gioca questa carta come blocco» — **lettura del designer
  (2026-09-04)**: si gioca nella finestra dei blocchi ma **non ferma
  nessun attaccante** e non chiede più una dichiarazione di blocco; il
  suo effetto (stappa gli Umani, Contrattacco +1) è tutto quel che fa. Il
  manuale (§6.4, §7.2) parla ancora di Reattive «assegnate a un
  attaccante»: la distinzione fra le due formule va scritta lì. Nel client
  sceglie l'attaccante solo la Reattiva che lo ferma (`blocksAttacker`), e
  una Materia che adesso non farebbe nulla chiede conferma prima di
  pagare («Gioca comunque» / «Non giocare»). Engine 0.36.0, quaranta
  regole.

- **§7.2 La catena di risposta** — «ogni volta che un giocatore lancia una
  Reattiva, l'avversario può sempre rispondere», solo con Reattive, ad
  alternanza stretta; «quando il giocatore a cui tocca rispondere passa, la
  catena si risolve in ordine inverso»; «la catena è atomica». La lavagna
  ha la catena (`chain {stack, turn, resolving}`, nel riduttore e nella
  copia, anche nello snapshot): la Reattiva giocata porta il segno
  `chain: true` (l'engine lo pretende: una Reattiva senza segno non passa,
  una carta che non è Reattiva col segno nemmeno), apre la catena o la
  allunga e passa la parola all'avversario; `pass {seat}` è l'accettazione
  di chi ha la parola, e da lì le carte si risolvono dall'ultima alla
  prima — ogni client risolve le proprie, e chiuso il passo `settle {uid}`
  toglie la carta dalla pila (la Reattiva che blocca resta in campo fino
  all'ondata, §6.4: «lascia il campo» non basta); l'ultima chiude la
  catena. La dogana (`judge_chain`, subito dopo quella del turno): a
  catena aperta passano solo la Reattiva di chi ha la parola, la sua
  accettazione, il blocco che accompagna la cima (RBF-040), il Gettone
  Flusso (§3.2, «serve proprio a pagare le Reattive»), chat, pixel e
  apparecchiatura; in risoluzione passano solo il passo, la chiusura e
  l'uscita della cima. In catena le finestre delle Reattive (§7.2) non
  contano più: risponde chi ha la parola — anche l'attaccante in
  Reazione, quando il difensore ha aperto con un blocco (§6.4). Nel client
  la Reattiva giocata va al centro del tavolo, a scaletta; la barra sotto
  l'insegna dice cosa c'è in cima e a chi tocca, e chi ha la parola ha il
  tasto «Accetta» (o risponde giocando, come sempre); la risoluzione
  scorre da sola, un client per carta. Limiti dichiarati:
  «l'abilitazione si ricontrolla alla risoluzione» (la Reattiva svanisce)
  non si vede, la Reattiva si risolve comunque; e la proprietà delle
  carte in catena non si guarda oltre la parola. Engine 0.37.0,
  quarantuno regole. Col Ritiro alla sola fase e la Zona di Ritiro chiusa
  in uscita: engine 0.38.1, quarantaquattro regole.

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
la spia quadrata in alto diventa verde e in chat compare il saluto
dell'engine. Il flag (ingranaggio → **Engine** → **Acceso**) è **acceso di
default**: chi non l'ha mai toccato gioca arbitrato, chi l'ha spento apposta
resta spento. Engine non raggiungibile: spia rossa, tavolo libero come sempre.

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
| client | `{"t":"judge","seq":7,"action":{…},"actor":"a"}` | `{"t":"verdict","seq":7,"action":"turn","ok":false,"ruled":true,"reason":"…","reason_en":"…"}` |
| client | `{"t":"consult","seq":8,"action":{…},"actor":"b"}` | come `judge`, ma per un'azione **già applicata** altrove |
| client | `{"t":"snapshot","state":{…}}` | *(nessuna: allinea la copia del tavolo)* |

`judge` è il giudizio preventivo sulle azioni locali: l'engine applica
l'azione alla **sua copia del tavolo** (`lib/rubyfront/table.rb`) solo se il
verdetto la lascia passare, perché anche il client la applicherà solo col sì.
`consult` è l'occhiata sulle azioni dell'avversario, già applicate dal suo
client: la copia le segue comunque, il verdetto serve solo ad annotare.
`snapshot` sostituisce la copia in blocco: parte a ogni saluto (l'engine
appena collegato non sa nulla) e quando il client riceve una lavagna intera
dalla rete (ingresso in stanza, «Sincronizza la lavagna»).

`actor` è il posto di chi ha compiuto il gesto (§6: nel turno altrui non si
agisce); un client che non lo manda non viene giudicato su questo.
`action` è un'azione della lavagna, identica a quelle che viaggiano sul relay
(`simulatore/src/types.ts`, tipo `Action`). Il contratto dei verdetti:

- **`ruled: false`** — l'engine non ha una regola per questa azione: il
  simulatore la applica come sempre.
- **`ruled: true, ok: true`** — la regola c'è e l'azione la rispetta.
- **`ruled: true, ok: false`** — l'azione viola la regola: `reason` spiega
  in italiano e `reason_en` in inglese (stessa frase, stessa targhetta; il
  client mostra quella della lingua del tavolo). Il simulatore la **ferma** — non tocca lavagna né rete — e mostra
  l'avviso. `rules` nel saluto elenca i § del MANUALE collegati (`rules_en` le stesse voci in inglese).

Il giudizio vale per le azioni **locali**: quelle dell'avversario arrivano già
applicate dal suo client (sarà il suo engine a fermarle), quindi una loro
violazione si annota in chat e basta. E un arbitro assente non ferma il
tavolo: engine scollegato o muto oltre il tempo massimo = via libera.

Una richiesta HTTP semplice (senza upgrade) riceve una riga di stato: fa da
health check, come per il relay.

## Com'è fatto

- `lib/rubyfront/engine.rb` — il giudizio: puro stato, niente I/O. È qui che
  le regole verranno collegate.
- `lib/rubyfront/card_index.rb` — l'anagrafe: legge le carte da `data/` una
  volta all'avvio e consegna al giudizio i fatti canonici (tipo, razza,
  statistiche, abilitazioni) e le **forme certificate** degli effetti; una
  forma che non combacia esattamente non entra (ignorare, mai fraintendere).
  `unknown_triggers` elenca gli effetti che nessuna forma legge: il test
  dell'anagrafe li tiene come debito dichiarato, così una forma rotta o un
  dato cambiato di nascosto fallisce forte.
- `lib/rubyfront/table.rb` — la copia del tavolo, gemella del riduttore del
  simulatore: stessa semantica, test speculari.
- `lib/rubyfront/websocket.rb` — il minimo di WebSocket che serve: handshake
  e frame di testo (con la lezione del relay: byte spezzati, incollati e
  messaggi frammentati si riassemblano).
- `bin/server` — il trasporto: un thread per client, un `Engine` per client.
- `test/` — minitest, si lanciano con `ruby` e basta.

Il disegno dell'insieme — chi legge cosa, dove gira ogni pezzo, come viaggia
un'azione — sta nel README alla radice del repo.

## Un repo a parte, un giorno

La cartella è pensata per essere **estratta** quando il progetto crescerà:
tutto ciò che le serve sta qui dentro, e le dipendenze future verso il resto
del repo (le carte di `data/`, il MANUALE) passeranno da confini espliciti,
mai da path sparsi nel codice. Finché carte e regole cambiano insieme,
stare nello stesso repo evita solo attrito.
