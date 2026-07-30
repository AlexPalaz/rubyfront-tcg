# Rubyfront — Manuale di Gioco

> **Stato:** BOZZA — in fase di stesura.
> Questo documento è la fonte di verità delle regole. L'engine di gioco verrà implementato seguendo fedelmente questo manuale.

---

## 1. Panoramica

- **Nome del gioco:** Rubyfront
- **Giocatori:** 2 (uno contro uno)
- **Razze:** al momento due — **Umani** e **Auros** (esseri immortali)
- **Il Rubyfront:** la bestia al centro del gioco, da cui il gioco prende il nome
- **Durata di una partita:** libera — può durare minuti come ore. Non esiste un limite di tempo né di turni.

### 1.1 La regola d'oro

**La carta vince sempre sulle regole del gioco.** Se il testo di una carta contraddice una regola di questo manuale, prevale il testo della carta.

### 1.2 La regola dell'estensione massima

**Se la carta non specifica, vale per tutto ciò che potrebbe potenzialmente esserlo.** Quando il testo di una carta non delimita bersagli, condizioni o casi (non dice "solo...", "avversaria", "in campo"...), l'effetto si applica nella sua estensione più ampia: tutto ciò che potrebbe potenzialmente rientrare nel testo, vi rientra.

*Esempio: un effetto di recupero PV senza un massimo indicato può portare i PV anche oltre il valore stampato sulla carta; un effetto che nomina "un'Entità" senza aggettivi può bersagliare qualsiasi Entità, propria o avversaria.*

## 2. Obiettivo del gioco

Ogni giocatore ha il **proprio Rubyfront** nel mazzo (vedi §3.1), che inizia la partita nella Zona di Richiamo.

Si vince in uno di questi due modi:

1. portando a **zero i Punti Vita (PV) del Rubyfront avversario**, oppure
2. **distruggendo il Nexus** del Rubyfront avversario, cioè portando a zero i PV del Nexus, se l'avversario l'ha giocato (vedi §3.1, "Il Nexus").

## 3. Materiale di gioco

### 3.1 Il mazzo

- Ogni giocatore ha un **mazzo personale di 40 carte, Rubyfront incluso** (esattamente **un** Rubyfront per mazzo). Il mazzo contiene tutte le carte del giocatore: Entità, Materie e Oggetti (non esistono riserve separate).
- Il **Rubyfront non si pesca mai**: all'inizio della partita viene messo direttamente nella **Zona di Richiamo** (vedi §5).

Le carte con una razza si chiamano **Entità** (non "creature"). Ogni Entità appartiene a una **razza**: **Umani** o **Auros** (il Rubyfront è a sé). Per giocare una carta — **Entità, Materia od Oggetto** — bisogna **spendere Flusso** pari al costo stampato sulla carta.

#### Anatomia di una carta Entità

Ogni carta riporta:

- **Nome** della carta
- **Immagine**
- **Razza**
- **Costo di Flusso** per entrare in campo
- **Potenza** — statistica unica della carta (non esistono attacco e difesa separati)
- **Contrattacco +N** (eventuale) — indicato con il proprio simbolo in basso a destra sulla carta, se la carta ce l'ha (vedi §6.3, "Contrattacco")
- **Abilità** (eventuale) — indicata prima della descrizione, se la carta ne ha una
- **Descrizione**, con l'eventuale **effetto** che si applica quando la carta viene messa in campo
- **Tipi di Materia** che la carta può utilizzare, con il **grado massimo** per i tipi che hanno gradi (§7.1)

Le **Materie** sono le carte magia/evento del gioco (vedi §7).

#### Carte Oggetto

Gli **Oggetti** sono carte che si **assegnano a un'Entità**:

- **hanno un costo di Flusso**, come Entità e Materie: si paga al momento dell'assegnazione (§6.2), e come ogni altra carta non scende sotto **1** (§3.2);
- ogni Entità può avere **al massimo un Oggetto** assegnato;
- si assegnano **solo alle proprie Entità**, salvo diversa indicazione sulla carta;
- **non si assegnano a un'Entità coperta** (§6.3): l'Entità coperta è intoccabile anche per il proprietario. L'Oggetto che aveva **già** assegnato, però, le rimane;
- **non si assegnano al Rubyfront né al Nexus** (non sono Entità), salvo diversa indicazione sulla carta;
- una volta assegnato, l'Oggetto **non può essere spostato né sostituito**;
- quando l'Entità lascia il campo, l'Oggetto **la segue**: va nell'**Abisso** — o in **Zona di Requiem**, se l'Entità è stata ritirata (§6.2).

Il mazzo **può mischiare le razze** liberamente. Si possono avere al massimo **3 copie della stessa carta** nel mazzo; le carte **Uniche** — contrassegnate dal **simbolo dell'Unica accanto al nome** — ammettono **una sola copia**.

#### Il Rubyfront come carta

Ogni Rubyfront è una carta con **valori propri**: non esistono valori standard uguali per tutti i Rubyfront.

La carta del Rubyfront riporta:

- **PV (Punti Vita)** — la sua **unica statistica**. Gli attacchi subiti fanno scendere i PV; a zero, il proprietario perde (§2).
- **Costo di Flusso crescente** nel formato `base+incremento` (es. `2+1`) — il costo per schierarlo in campo (vedi sotto).
- **Materie disponibili** — i tipi di Materia che il Rubyfront può usare, **con il grado massimo** per i tipi che hanno gradi (come le Entità, §7.1).
- **Abilità principale** — nasce quando il Rubyfront entra in campo e da quel momento è **sempre attiva**.
- **Descrizione** con l'**effetto che si risolve quando entra in campo** dalla Zona di Richiamo — **a ogni schieramento**, non solo il primo.
- **Abilità speciali** — per essere usate **costano PV**.

Il Rubyfront è **attaccabile anche mentre si trova in Zona di Richiamo**: i suoi PV sono un bersaglio valido dall'inizio alla fine della partita. Abilità (principale e speciali) e Materie, però, sono **utilizzabili solo quando è in campo**: schierarlo serve a sbloccarle.

#### Costo di schieramento crescente

Il costo di Flusso del Rubyfront è indicato nel formato **`base+incremento`** (es. `2+1`): il **primo schieramento** costa il valore base; ogni schieramento successivo costa **l'incremento in più** rispetto al precedente.

*Esempio: costo `2+1` → primo schieramento 2 Flussi, poi 3, poi 4, e così via.*

Il costo di schieramento cresce **fino a un massimo di 20** e non può mai superarlo: raggiunto il tetto, ogni rischieramento successivo costa 20. Il Rubyfront resta quindi sempre schierabile (a 20 Flussi pieni).

#### Ritorno in Zona di Richiamo

Il Rubyfront schierato **torna in Zona di Richiamo** nei seguenti casi:

- **automaticamente, appena perde PV per una fonte avversaria mentre è in campo**: attacchi che passano, effetti e Materie dell'avversario. Il Rubyfront **subisce la perdita di PV** e **torna immediatamente in Zona di Richiamo**: da quell'istante smette di abilitare le sue Materie (le permanenti dei tipi che solo lui abilitava vanno nell'Abisso, §7.2). Se il proprietario lo rischiera nello stesso turno (pagando il costo aumentato) e il Rubyfront subisce un'altra perdita da fonte avversaria, torna di nuovo in Zona di Richiamo: **ogni perdita di PV inflitta dall'avversario mentre è in campo è un ritorno** (e quindi un aumento del costo di rischieramento). Le **perdite autoinflitte non fanno scattare il ritorno**: il fallimento della propria Furia (§8.1) e gli effetti delle proprie carte fanno perdere i PV, ma il Rubyfront resta in campo. I **PV spesi come costo** delle abilità speciali sono un pagamento, non una perdita subita: anch'essi **non fanno scattare il ritorno**;
- **volontariamente**, per scelta del proprietario.

Ogni ritorno in Zona di Richiamo fa scattare l'aumento del costo di rischieramento (vedi sopra).

**Finestra di movimento:** il proprietario può muovere il Rubyfront (schierarlo o richiamarlo, anche **più volte nello stesso turno**) durante tutto il proprio turno, dalla **Fase di Preparazione** fino alla **fine del turno** — anche dopo aver finito di attaccare (il Rubyfront non attacca: la sua funzione è usare abilità a costo PV e Materie, quindi muoverlo a fine turno è legittimo). Ogni rischieramento paga comunque il costo crescente. **Mai nel mezzo di una catena di risposta** (§7.2): la catena è atomica.

#### Ruolo del Rubyfront in campo

Il Rubyfront, quando entra in campo, **non attacca** e **non blocca** (salvo diversa indicazione sulla carta — la regola d'oro §1.1 vale sempre). Il senso di schierarlo è:

- usare le sue **abilità speciali** (pagandone il costo in PV) — attivabili **liberamente, solo nel proprio turno**, sia in Fase di Preparazione che in Fase di Fronte. La stessa abilità è attivabile **più volte per turno**, finché i PV bastano. Si risolvono **senza possibilità di risposta** (la catena vale solo per le Reattive). Un'abilità è attivabile **solo se i PV coprono l'intero costo** (PV ≥ costo): i PV non scendono mai sotto 0. **Attenzione:** pagare fino a 0 esatto è legale, ma a 0 PV si perde **immediatamente** la partita — l'effetto dell'abilità **non si risolve**;
- usare le **Materie** a lui disponibili;
- **triggerare il Nexus**, quando i requisiti sono soddisfatti (vedi "Il Nexus", più sotto).

I PV sono quindi una risorsa a doppio taglio: sono la condizione di sconfitta, ma anche la valuta con cui il Rubyfront paga le proprie abilità speciali.

#### Il Nexus

La carta del Rubyfront ha **due facce**: una è il **Rubyfront**, l'altra è il suo **Nexus** — l'evoluzione del Rubyfront.

- **Come si gioca:** si **flippa** la carta del Rubyfront sull'altra faccia. Requisiti e condizioni:
  - i **requisiti** per il flip sono scritti sulla carta stessa e vanno soddisfatti **al momento del flip**: una volta giocato, il Nexus resta in campo anche se i requisiti smettono in seguito di essere veri;
  - il **Rubyfront dev'essere in campo** (non si flippa dalla Zona di Richiamo);
  - soddisfatti i requisiti, il flip si può fare in qualsiasi momento del proprio turno, **dalla Fase di Preparazione fino alla fine del turno** (stessa finestra del movimento del Rubyfront, §3.1), e non ha altri costi.
- **PV recuperati:** la faccia del Nexus indica un **recupero di PV** (es. `+5`): il Nexus parte con i **PV rimasti al Rubyfront più il recupero indicato**.
- **Permanenza:** il Nexus **sostituisce il Rubyfront** e **rimane in campo per tutta la durata della partita**, salvo diverse indicazioni sulle carte. **Non torna mai in Zona di Richiamo**: quando un attacco gli passa, subisce il danno e resta in campo.
- **Flip, effetti e Materie:** il flip **non è una nuova entrata in campo**: non innesca gli effetti "quando giochi una carta/Entità" e, ai fini dell'ordine di risoluzione (§8.2), la carta conserva l'età dello schieramento del Rubyfront. Dal momento del flip **si attiva l'effetto indicato sulla faccia del Nexus**. Le Materie abilitate sono **quelle stampate sulla faccia del Nexus** (nessuna eredità dal Rubyfront): le Materie permanenti dei tipi che il Nexus continua ad abilitare **sopravvivono al flip senza interruzione**; quelle dei tipi non più abilitati vanno nell'**Abisso**.
- **Com'è fatta:** ha la stessa struttura del Rubyfront — PV, **Materie disponibili proprie** (stampate sulla sua faccia) e **abilità speciali**, chiaramente **più potenti**. Come il Rubyfront, **non attacca e non blocca** (salvo diversa indicazione sulla carta).
- **Nessuna eredità di abilità:** come per le Materie, anche le **abilità** (principale e speciali) del Nexus sono **solo quelle stampate sulla sua faccia**. L'abilità principale del Rubyfront **non passa** al Nexus: se la faccia del Nexus non ne riporta una, il Nexus **non ha abilità principale** (un Nexus può quindi essere libero dalla Furia del suo Rubyfront, o averne una propria).
- **Distruzione = sconfitta:** portare a **0 i PV del Nexus** significa distruggerlo — è la condizione di vittoria n. 2 (§2).
- **Regola generale:** dopo il flip, **ogni regola di questo manuale che nomina il Rubyfront si applica identica al Nexus** (bersaglio degli attacchi, danni da attacchi non bloccati, abilità speciali solo nel proprio turno, Materie abilitate...), salvo dove diversamente indicato.

### 3.2 Il Flusso

Il **Flusso** è la risorsa con cui si pagano le carte, al posto del classico mana. A differenza del mana:

- **non esistono carte Terra** (o simili) da giocare per generare risorse;
- ogni giocatore ha un proprio valore di Flusso massimo che **cresce automaticamente di +1 all'inizio di ogni proprio turno, a partire dal secondo**;
- entrambi i giocatori **partono con 1 di Flusso** (1° turno: 1, 2° turno: 2, 3° turno: 3...);
- il Flusso speso **si ricarica interamente all'inizio del proprio turno**;
- nel **turno avversario** si ha a disposizione il Flusso **non speso** rimasto dal proprio turno (es. per giocare Materie Reattive in difesa): tenersi Flusso da parte è una scelta strategica;
- **limite assoluto: 20 Flussi.** Il Flusso non può mai superare 20 in nessun modo: anche canalizzando (vedi §6.1) a 20 Flussi, non si arriva a 21. Unica cosa che vive fuori dalla barra: il **Gettone Flusso** (vedi sotto).

**Costo minimo: 1 Flusso.** Nessuna carta del gioco — Entità, Materia od Oggetto — costa meno di **1**: non esistono carte gratuite. Giocare qualsiasi cosa consuma sempre almeno un punto della barra, e questo è ciò che rende il Flusso un vero ritmo di partita: il primo turno concede **una** giocata, non un numero libero di carte a costo zero.

**Costi di Flusso definiti dalle carte:** oltre a pagare la giocata delle carte, il Flusso può comparire come **costo di abilità o effetti**, quando una carta lo prevede espressamente (regola d'oro, §1.1). Si paga dalla propria barra, alle stesse condizioni di ogni altra spesa di Flusso, e nelle finestre indicate dalla carta.

#### Gettone Flusso

Il giocatore che **non** inizia la partita riceve un **Gettone Flusso**: rappresenta **1 punto di Flusso extra**, è **monouso** e può essere utilizzato **in qualsiasi momento della partita** — anche nel turno avversario o nel mezzo di una catena di risposta (compensa lo svantaggio di giocare per secondo).

Il Gettone è **fuori dal limite dei 20 Flussi**: non fa parte della barra del Flusso, è un punto a parte, sempre utilizzabile. Anche a 20 Flussi lo si può spendere — l'unico caso in cui, in sostanza, si arriva a 21.

## 4. Preparazione della partita

1. **Chi inizia:** se entrambi i giocatori sono d'accordo, possono **scegliere liberamente** chi inizia. Altrimenti entrambi tirano un **d20**: chi ottiene il numero più alto inizia la partita; in caso di **pareggio si ritira**.
2. **Gettone Flusso:** il giocatore che non inizia riceve il Gettone Flusso (vedi §3.2).
3. **Rubyfront:** ogni giocatore mette il proprio Rubyfront nella **Zona di Richiamo** (vedi §5).
4. **Mano iniziale:** prima che inizi il primo turno, entrambi i giocatori **pescano 6 carte**.
5. **Mulligan:** ciascun giocatore può fare mulligan **fino a 3 volte**: rimescola **tutta la mano** nel mazzo e pesca **6 nuove carte**, senza penalità. Dopo il terzo mulligan è **costretto ad accettare la mano**. I mulligan sono **simultanei**: ognuno gestisce i propri senza aspettare l'altro. Quando un giocatore è soddisfatto della mano, **dichiara di essere pronto**; quando entrambi hanno dichiarato, la partita comincia.
6. Entrambi i giocatori partono con **1 di Flusso**.

## 5. Zone di gioco

Il campo di ogni giocatore è formato da:

- **Fronte** — il campo di battaglia: **5 slot** in cui stanno le Entità. Il Rubyfront, quando è schierato, si posiziona **davanti** ai 5 slot (non occupa uno slot); le Materie in gioco (permanenti o in risoluzione) stanno **dietro** i 5 slot. Le permanenti si dispongono **una dietro l'altra (o una sotto l'altra), nell'ordine in cui sono scese in campo**: la fila tiene traccia dell'età di ciascuna, che serve per l'ordine di risoluzione degli effetti (§8.2).
- **Mazzo** — le carte da pescare.
- **Abisso** — la zona delle carte **morte o consumate**: Entità morte o distrutte, Materie risolte, decadute o svanite, Oggetti che seguono un'Entità morta, carte scartate o canalizzate dalla mano. È **pubblico**: consultabile da entrambi i giocatori in qualsiasi momento.
- **Zona di Requiem** — la zona delle carte **ancora "vive"** uscite dal gioco: le Entità **ritirate** (§6.2) o **mandate lì da effetti di carte**, e gli Oggetti che le seguono. Funziona **esattamente come l'Abisso** (pubblica, consultabile in qualsiasi momento), ma tiene separato ciò che non è mai morto da ciò che lo è: gli effetti che nominano l'Abisso **non** toccano la Requiem, e viceversa. Una carta mandata in Requiem da un effetto **non muore** e, salvo che l'effetto dica altrimenti, **non conta come Ritiro**: conta solo come **lasciare il campo**.
- **Zona di Richiamo** — il Rubyfront si posiziona e **parte sempre qui**, salvo diverse indicazioni sulla carta.

Il **mazzo** e la **mano** sono **nascosti** all'avversario.

## 6. Struttura del turno

Il turno si compone di tre fasi, nell'ordine: **Canalizzazione → Preparazione → Fronte**.

### 6.1 Fase di Canalizzazione

1. **Pesca:** il giocatore di turno pesca una carta. Vale anche per il **primo turno di chi inizia**: la pesca non si salta mai.
2. **Canalizzazione (opzionale):** il giocatore può **canalizzare al massimo una carta** dalla mano: la carta canalizzata va nell'**Abisso** e il giocatore ottiene **+1 Flusso valido solo per il turno in corso** (non è permanente). Si somma alla crescita automatica di +1 a turno (§3.2) e rispetta comunque il limite assoluto di 20 Flussi.

### 6.2 Fase di Preparazione

Dichiarata dal giocatore al termine della Canalizzazione. In questa fase si inizia a giocare con le carte e **si prepara il Fronte**. Il giocatore può:

- **giocare Entità** (pagandone il costo di Flusso);
- **giocare Materie** normali e permanenti (le Reattive si giocano solo in Fase di Fronte, §7.2);
- **assegnare Oggetti** (carte Oggetto) alle Entità, pagandone il costo di Flusso — massimo **un Oggetto per Entità**;
- **ritirare** le proprie Entità dal Fronte (vedi "Ritiro", più sotto).

**Non c'è limite al numero di carte giocabili** nella fase: il solo vincolo è il Flusso disponibile — **Oggetti compresi**, che si pagano come ogni altra carta.

Sul Fronte si possono avere **al massimo 5 Entità contemporaneamente** — i **5 slot** del Fronte (§5). Nel limite contano **solo le Entità**: il **Rubyfront** non occupa slot (schierato, sta davanti agli slot), le **Materie permanenti** stanno dietro gli slot e **non hanno limite di numero** (il solo vincolo è l'abilitazione, §7), gli **Oggetti** sono assegnati alle Entità e non occupano slot.

**A Fronte pieno** (5 slot occupati) non si possono giocare altre Entità. Se un **effetto** metterebbe in campo una carta a Fronte pieno, quella parte dell'effetto **non si applica** (la carta non entra) e il resto dell'effetto si risolve normalmente.

#### Ritiro

Il giocatore può **ritirare** le proprie Entità dal Fronte: l'Entità ritirata va in **Zona di Requiem** (§5) e il suo slot torna libero.

- **Quando:** solo in **Fase di Preparazione**, e solo sulle **proprie** Entità. Il ritiro è un'azione di preparazione del Fronte: non si ritira in Fase di Fronte, né nel turno avversario, né nel mezzo di una catena di risposta (§7.2).
- **Costo:** nessuno. Non c'è **limite** al numero di Entità ritirabili in un turno: si può anche svuotare l'intero Fronte.
- **Non nel turno d'ingresso:** un'Entità **entrata in campo in questo turno non può essere ritirata**; va aspettato il turno successivo, come per l'attesa di evocazione. Senza questo vincolo, a Fronte pieno si potrebbe giocare un'Entità solo per il suo effetto d'ingresso e ritirarla subito per liberare lo slot, trasformando il Ritiro in un motore di effetti. Lo **Slancio** (§8.1) **non** aggira questo divieto: permette di attaccare subito, non di essere ritirata subito.
- **Non è obbligatorio giocare qualcosa al suo posto:** si può ritirare solo per liberare slot, o senza alcuna intenzione di far scendere altre carte.
- **Non è una morte:** per questo l'Entità ritirata va in **Zona di Requiem** e non nell'Abisso — il ritiro **non conta come morte o distruzione** e gli effetti "quando un'Entità muore / viene distrutta" **non si innescano**. Conta invece come **lasciare il campo** per gli effetti che usano quella dicitura (§1.2).
- **Oggetto assegnato:** segue la sua Entità (§3.1) — va anch'esso in **Zona di Requiem**.
- **Abilitazione delle Materie:** l'Entità ritirata smette di abilitare i suoi tipi di Materia. Se era l'ultima ad abilitare un tipo, l'accesso si perde e le Materie permanenti di quel tipo vanno nell'Abisso (§7.2). Ritirare senza controllare cosa si sta abilitando è un errore costoso.
- **Un'Entità coperta non può essere ritirata** (§6.3): la copertura la rende intoccabile anche per il proprietario. Un'Entità **tappata** o **in stasi** (§8.1), invece, si ritira normalmente.
- Il **Rubyfront non si ritira**: non è un'Entità e non occupa uno slot. Per toglierlo dal campo si usa il richiamo in Zona di Richiamo (§3.1), che è cosa diversa. Il **Nexus**, una volta in campo, non lascia mai il campo (§3.1).

**Attesa di evocazione:** un'Entità appena entrata in campo **non può attaccare nel turno in cui entra**; deve aspettare il turno successivo. Può però già **bloccare** nel turno avversario che segue.

### 6.3 Fase di Fronte (combattimento)

Terminata la Fase di Preparazione, il giocatore di turno **dichiara di entrare in Fase di Fronte**. La fase è **facoltativa**: il giocatore può anche chiudere il turno direttamente dalla Fase di Preparazione, senza dichiararla. In quel caso **non c'è Pre-Fronte** e in quel turno non si apre nessuna finestra per giocare Reattive. Se dichiarata, la fase si svolge in questo ordine:

1. **Pre-Fronte:** dichiarata l'apertura del Fronte, **l'avversario può giocare Materie Reattive**. Il giocatore di turno può rispondere con la catena di risposta (§7.2).
2. **Finestra Reattive del giocatore di turno:** conclusa la Pre-Fronte, il giocatore di turno può giocare le proprie Materie Reattive (l'avversario può rispondere in catena, §7.2).
3. **Fronte pronto — dichiarazione dell'attacco (o passo):** il giocatore di turno **seleziona tutte le Entità con cui attacca** e le dichiara **in un'unica ondata** — oppure dichiara che passa. **Dopo la dichiarazione non si possono più *iniziare* Reattive**, con un'unica eccezione: una Reattiva giocata come blocco (vedi punto 4). Le **risposte in catena** (§7.2) restano sempre possibili: ogni Reattiva giocata può essere risposta con altre Reattive.
4. **Dichiarazione dei blocchi:** il difensore, vista l'intera ondata, **assegna i propri blocchi**. Ogni attaccante può essere bloccato da:
   - una **propria Entità** (sfide 1 contro 1: un bloccante per attaccante, ogni Entità blocca una sola volta; chi blocca si tappa, chi contrattacca si copre), **oppure**
   - una **Materia Reattiva il cui testo permette di bloccare** (pagandone il costo di Flusso): la Reattiva sostituisce il bloccante per quell'attacco. **Non c'è confronto di Potenza** (la Reattiva non ne ha): l'attacco è **comunque bloccato**, e l'eventuale sorte dell'attaccante la stabilisce il **testo della Reattiva**. Come ogni Reattiva, **apre la catena di risposta** (§7.2): l'attaccante può rispondere.
5. **Risoluzione:** le battaglie si risolvono una alla volta, **nell'ordine di dichiarazione degli attaccanti** (confronto di Potenza per ogni coppia; gli attacchi non bloccati infliggono danni al Rubyfront).
6. **Fine del turno.**

**Movimento del Rubyfront:** promemoria — può essere schierato o richiamato in **qualsiasi momento del proprio turno**, anche dopo gli attacchi, fino alla fine del turno (vedi §3.1, "Finestra di movimento").

#### Regole di attacco

- Ogni Entità **attacca una sola volta per turno**.
- **Chi attacca viene tappato al momento della dichiarazione dell'ondata** (§6.3, punto 3), non alla risoluzione della sua battaglia. L'Entità si stapperà all'inizio del turno successivo del proprietario: resta quindi tappata per **tutto il turno avversario che segue** e **non potrà bloccare** — attaccare costa la possibilità di difendersi (vedi "Stati delle Entità", più sotto).
- Un'Entità **tappata non può attaccare**.
- Un'Entità entrata in campo in quel turno **non può attaccare** (attesa di evocazione, §6.2).
- **Si attacca sempre il Rubyfront avversario**, mai le altre Entità direttamente.
- Un **attacco non bloccato** infligge al Rubyfront danni pari alla **Potenza dell'attaccante** (i suoi PV scendono di altrettanto).

#### Blocco

- Il **difensore può scegliere di bloccare** con le proprie Entità, decidendo se far passare o meno l'attacco al Rubyfront.
- Anche le **Materie Reattive possono bloccare attacchi**, se il testo della carta lo prevede (e c'è il Flusso per pagarle): al momento della dichiarazione dei blocchi, il difensore può assegnare a un attaccante una di queste Reattive **al posto di una propria Entità** (§6.3, punto 4).
- La sfida è sempre **1 contro 1**: ogni attaccante può essere bloccato da **una sola Entità**, e ogni Entità può **bloccare una sola volta per turno**.
- Un'Entità **tappata non può bloccare** (es. perché ha attaccato nel proprio turno precedente).
- **Quando un'Entità blocca viene tappata.**

#### Risoluzione di una battaglia (attaccante vs bloccante)

Si confrontano le **Potenze**:

- Se la Potenza del bloccante è **inferiore** a quella dell'attaccante → il bloccante **muore** (va nell'Abisso), ma **l'attacco è comunque bloccato** (il Rubyfront non subisce danno).
- Se la Potenza del bloccante è **pari o superiore** → l'attacco è bloccato e il bloccante **non muore**.
- L'attaccante, in un blocco normale, **non muore mai**.

*Esempio: un'Entità con Potenza 4 attacca; il difensore blocca con un'Entità di Potenza 3 → il bloccante muore, l'attacco non passa. Se il bloccante avesse Potenza 4 o più, non morirebbe nessuno.*

#### Uscite dal campo tra dichiarazione e risoluzione

Tra la dichiarazione dei blocchi e la risoluzione delle battaglie possono intervenire effetti (es. una catena aperta da una Reattiva giocata come blocco) che rimuovono dal campo carte già impegnate:

- Se il **bloccante** assegnato a un attaccante lascia il campo prima che la sua battaglia si risolva, alla risoluzione quell'attacco è **non bloccato**: passa e infligge danni al Rubyfront. Il blocco **non si riassegna**.
- Se è l'**attaccante** a lasciare il campo prima della risoluzione, la battaglia **non avviene**: nessun confronto, nessun danno. Il bloccante che gli era assegnato resta comunque **tappato** (e il contrattaccante **coperto**): tap e copertura scattano alla dichiarazione dei blocchi (§6.3, punto 4) e non si annullano.

#### Contrattacco

Alcune Entità hanno la statistica **Contrattacco +N**. Quando bloccano, possono **scegliere di contrattaccare**: la loro Potenza diventa `Potenza + N` per quel confronto, e l'Entità viene **coperta** (anziché tappata) — verrà **scoperta più avanti**.

La scelta *blocco normale o contrattacco* si dichiara **al momento dell'assegnazione dei blocchi** (§6.3, punto 4), non alla risoluzione: il difensore non può aspettare di vedere come si risolvono le battaglie precedenti per decidere.

Risoluzione del contrattacco (totale = Potenza + N contro Potenza dell'attaccante):

- **Totale superiore** → **l'attaccante muore**; il contrattaccante è in salvo.
- **Totale pari** → l'attaccante **non** muore (serve necessariamente superarlo), ma il pareggio **mette in salvo** il contrattaccante.
- **Totale inferiore** → il contrattaccante **muore** e va nell'Abisso, come in un blocco normale.

*Esempio: attaccante con Potenza 4; bloccante con Potenza 3 e Contrattacco +2 sceglie di contrattaccare → 3+2 = 5 > 4: l'attaccante muore, il bloccante sopravvive ma resta coperto.*

#### Stati delle Entità: tappata e coperta

- **Tappata** (per aver **attaccato o bloccato**): un'Entità tappata **non può né attaccare né bloccare**. Si **stappa all'inizio del turno successivo del proprietario**. La differenza pratica sta nel momento in cui scatta il tap:
  - **tap in difesa** (per aver bloccato, nel turno avversario): il turno del proprietario arriva subito dopo, quindi l'Entità si stappa immediatamente e non perde nulla — il tap segna solo che ha già bloccato in quel turno di difesa;
  - **tap in attacco** (per aver attaccato, nel proprio turno): l'Entità resta tappata per **tutto il turno avversario che segue** e quindi **non può bloccare** — in sostanza, attaccare costa la difesa.
- **Coperta** (per aver contrattaccato): l'Entità coperta **non può fare nulla** finché è coperta, ed è **intoccabile in senso totale**, da entrambi i giocatori. Per il proprietario: non può ricevere Oggetti (quello già assegnato le rimane) né essere **ritirata** (§6.2). Per chiunque: **non può essere bersagliata né subire effetti o Materie di alcun tipo, nemmeno avversari** — finché è coperta è come se non fosse in campo (continua però a occupare il suo slot del Fronte), salvo diversa indicazione sulle carte (§1.1). A differenza della tappata (§8.1), **non abilita le sue Materie**: l'abilitazione è sospesa per tutta la copertura. Se era l'unica carta ad abilitare un tipo, l'accesso a quel tipo si perde, ma le Materie permanenti di quel tipo **non decadono**: si **coprono anche loro** — restano sul campo sospese, con l'effetto spento, come se non fossero in campo — e si **riattivano automaticamente quando l'Entità si scopre**. Se però l'Entità coperta lascia il campo prima di scoprirsi, l'abilitazione è persa per davvero e le permanenti coperte vanno nell'Abisso (§7.2). La copertura dura **un giro completo**:

  1. *Turno avversario (T):* l'Entità contrattacca e viene **coperta**.
  2. *Turno del proprietario (T+1):* non può attaccare.
  3. *Turno avversario (T+2):* non può bloccare.
  4. *Turno del proprietario (T+3):* viene **scoperta** e può di nuovo agire.


### 6.4 Fine del turno

Non si possono avere **più di 7 carte in mano**: alla fine del proprio turno, le carte in eccesso vanno **scartate** (nell'Abisso).

Lo scarto per eccesso è **l'ultima azione del turno**: prima si risolvono gli eventuali effetti "a fine turno", poi si scartano le carte in eccesso e il turno passa all'avversario.

## 7. Le Materie

Le **Materie** sono le carte magia/evento del gioco. Non si possono giocare liberamente: una carta Materia è giocabile **solo se in campo c'è una carta che ha quel tipo di Materia abilitato**.

- Le Materie **hanno un costo di Flusso**, come le Entità.
- Ogni Entità riporta i **tipi di Materia che abilita** (§3.1). Dal momento in cui l'Entità entra in campo, il suo proprietario può giocare le carte Materia dei tipi abilitati.
- Anche il **Rubyfront** ha le sue Materie abilitanti, ma valgono **solo quando è schierato in campo**: finché resta in Zona di Richiamo non abilita nulla (§3.1).
- L'abilitazione va **mantenuta**: se l'ultima carta in campo che abilitava un tipo di Materia lascia il campo **o viene coperta** (§6.3 — l'Entità coperta non abilita), il giocatore **perde immediatamente l'accesso** a quel tipo. L'abilitazione si valuta sempre **al grado richiesto** (§7.1): per le carte di secondo grado serve un abilitatore fino al secondo grado, sia per giocarle che per mantenerle.
- **Attribuzione:** se **più carte in campo** abilitano lo stesso tipo di Materia (al grado richiesto), il giocatore **sceglie a quale carta abilitante attribuire** la Materia che gioca. La scelta è rilevante ad esempio per Furia (§8.1): attribuendo la Materia a un abilitatore senza Furia, il tiro non serve.

*Esempio: gioco un'Entità che ha tra le Materie abilitate la Materia Dinamica → da quel momento posso giocare carte di tipo Materia Dinamica.*

### 7.1 I tipi di Materia

I tipi di Materia sono cinque:

1. **Materia Dinamica**
2. **Materia Dimensionale**
3. **Materia Distruttiva**
4. **Materia Zero**
5. **Materia Dominante**

#### Materie di razza: Dinamica, Dimensionale, Distruttiva

Le prime tre Materie sono **solitamente legate a una razza**, salvo anomalie (carte che fanno eccezione):

| Materia | Razza |
|---------|-------|
| **Dinamica** | Umani |
| **Dimensionale** | Auros |
| **Distruttiva** | **esclusiva del Rubyfront** |

**Gradi.** Dinamica, Dimensionale e Distruttiva esistono in **primo grado** e **secondo grado**:

- ogni carta Materia di questi tipi ha un grado;
- la carta Entità indica **fino a che grado** può usare ciascuna Materia abilitata;
- una Materia di **secondo grado** richiede in campo una carta che abiliti quel tipo **fino al secondo grado**: se l'Entità abilita solo il primo grado, la Materia di secondo grado **non è giocabile**.

#### Materia Zero e Materia Dominante

- **Non sono legate a una razza**: possono appartenere a carte di qualsiasi razza, ma **solo poche Entità le abilitano** — sono particolarmente rare.
- **Non hanno gradi** (i gradi esistono solo per Dinamica, Dimensionale e Distruttiva).
- Come per ogni Materia, **cosa fanno lo dice la singola carta**: non hanno regole di comportamento speciali oltre alla rarità e all'assenza di gradi.

### 7.2 Comportamenti delle carte Materia

Ogni carta Materia ha una **descrizione con un effetto**. In base alla dicitura sulla carta, esistono tre comportamenti:

#### Materia normale (nessuna dicitura)

- Si gioca in **Fase di Preparazione**.
- L'effetto **si risolve immediatamente**, poi la carta va nell'**Abisso**.
- È il comportamento classico di una carta Materia.

#### Materia permanente

- Identica alla normale: si gioca in **Fase di Preparazione**.
- L'effetto è **permanente**: la carta **resta in gioco** e non va nell'Abisso.
- **Non occupa uno slot del Fronte:** sta **dietro** i 5 slot delle Entità (§5) e non conta nel limite; non c'è un limite al numero di permanenti in gioco.
- **Decade insieme all'abilitazione:** se il giocatore perde l'accesso al tipo di Materia **al grado della permanente** (l'ultima carta che abilita quel tipo al grado richiesto lascia il campo), la permanente va nell'**Abisso**. Un abilitatore di grado inferiore **non basta**: una permanente di secondo grado decade se in campo resta solo un abilitatore di primo grado — coerente con la catena di risposta, dove l'abilitazione si ricontrolla sempre "al grado richiesto". **Eccezione — copertura:** se l'accesso si perde solo perché l'ultima carta abilitante è stata **coperta** (§6.3), la permanente non va nell'Abisso: **si copre anche lei** — resta sul campo con l'effetto sospeso, come se non fosse in campo — e si **riattiva** quando l'abilitatore si scopre. Se l'abilitatore lascia il campo mentre è coperto, la permanente coperta va nell'Abisso. **Attenzione:** vale anche per il Rubyfront — quando torna in Zona di Richiamo (immediatamente se perde PV per una fonte avversaria, §3.1, o per scelta del proprietario) smette di abilitare le sue Materie: le permanenti dei tipi che **solo lui** abilitava (tipicamente la Distruttiva) vanno nell'Abisso. È un rischio da mettere in conto quando lo si schiera.
- Se possa essere distrutta o rimossa da effetti **dipende dalle carte**.

#### Materia Reattiva

- Si gioca **solo in Fase di Fronte**. Possono essere potenziamenti ad attacchi e difese, ma anche **effetti particolari di qualsiasi natura**. Una Reattiva **non è mai un "attacco"** nel senso delle regole di combattimento (§6.3): l'eventuale danno che infligge è danno da effetto (che per il Rubyfront in campo conta comunque come perdita di PV — se la Reattiva è dell'avversario, con ritorno immediato in Zona di Richiamo, §3.1).
- **Nessuno può intervenire in qualsiasi momento a piacere:** le Reattive si giocano solo nelle finestre previste.
- **Finestra dell'avversario (Pre-Fronte):** all'apertura della Fase di Fronte, prima della dichiarazione d'attacco, l'avversario può giocare Reattive (§6.3).
- **Finestra del giocatore di turno:** dopo la Pre-Fronte e prima di dichiarare Fronte pronto, il giocatore di turno può giocare Reattive.
- **Dopo la dichiarazione dell'attacco non si *iniziano* più Reattive**, con un'unica eccezione: le Reattive del difensore **giocate come blocco**, assegnate a un attaccante al posto di un'Entità (§6.3). Una Reattiva così giocata apre una **normale catena di risposta**: si risponde **solo con Reattive**, come in ogni catena. I potenziamenti giocati *di propria iniziativa*, invece, vanno giocati **prima** della dichiarazione d'attacco, "in anticipo": sono una scommessa per entrambi.
- In tutte le finestre, chi subisce la Reattiva può **rispondere** (vedi catena di risposta).

#### Catena di risposta

**Regola universale:** le finestre stabiliscono chi può *iniziare* una Reattiva; ma **ogni volta che un giocatore lancia una Reattiva, l'avversario può sempre rispondere**.

- Si può rispondere **solo con Materie Reattive**.
- Chi ha lanciato può a sua volta **controrispondere**, e così via: la catena prosegue finché i giocatori possono e vogliono aggiungere Reattive. L'alternanza è **stretta**: dopo ogni Reattiva può giocare solo l'**avversario** di chi l'ha lanciata — non si possono mettere due proprie Reattive di fila sulla stessa catena.
- Quando il giocatore a cui tocca rispondere **passa**, la catena **si risolve in ordine inverso**: l'**ultima** Materia giocata si risolve **per prima**, poi via via indietro fino alla prima. Risolta la catena, chi ne ha la finestra può eventualmente iniziarne una nuova.
- **La catena è atomica:** dal primo lancio alla risoluzione completa non si compiono altre azioni. In particolare, **il movimento del Rubyfront e il flip verso il Nexus non possono avvenire a metà catena** (§3.1). Restano invece possibili in catena: l'uso del **Gettone Flusso** (§3.2, serve proprio a pagare le Reattive) e gli eventi **automatici**, come il ritorno immediato del Rubyfront che perde PV per una Reattiva avversaria risolta (§3.1).
- **L'abilitazione si ricontrolla alla risoluzione:** se, quando una Reattiva in catena deve risolversi, il suo giocatore non ha più in campo una carta che abiliti quel tipo al grado richiesto (es. una risposta ha eliminato l'abilitatore), la Reattiva **svanisce** — va nell'Abisso senza alcun effetto, e il Flusso resta speso.

## 8. Abilità ed effetti delle carte

### 8.1 Abilità (parole chiave)

Le **abilità** sono **parole chiave con regole predefinite** da questo manuale: quando una carta riporta un'abilità, ne applica le regole così come sono, senza bisogno di testo aggiuntivo sulla carta.

L'**abilità principale** del Rubyfront funziona allo stesso modo: è una parola chiave, attiva dal momento in cui entra in campo (§3.1).

#### Elenco delle abilità

##### Furia

Una carta con **Furia** non può essere **controllata direttamente** dal suo proprietario. **Furia è esclusiva del Rubyfront e del Nexus**: compare solo come loro abilità principale — le Entità **non possono averla**.

**Prima di qualsiasi azione** che coinvolga la carta con Furia, il proprietario **lancia un d20**. Le azioni soggette al tiro sono: usare una Materia **attribuita** alla carta con Furia (§7: se un'altra carta senza Furia abilita lo stesso tipo al grado richiesto, il giocatore può attribuire la Materia a quella ed evitare il tiro) e usare un'**abilità speciale**.

**Il movimento del Rubyfront non è mai soggetto al tiro:** schierarsi e tornare in Zona di Richiamo (volontariamente o automaticamente dopo un colpo dell'avversario) avvengono sempre senza d20. **Nemmeno il flip verso il Nexus richiede il tiro** (§3.1): girare la carta non è un'azione soggetta a Furia.

Esito del tiro:

- con **12 o più**, l'azione **va a buon fine**;
- con **11 o meno**, l'azione **fallisce** e si perde il **valore X indicato sulla carta** accanto a Furia.

**Al fallimento la Furia si ritorce contro il proprietario:** l'azione salta, i costi già pagati restano pagati e il Rubyfront (o il Nexus) perde gli X PV del fallimento — perdita **autoinflitta**: se il Rubyfront è in campo, **non** fa scattare il ritorno in Zona di Richiamo (§3.1), resta in campo. Nel dettaglio:

- **Materia fallita:** va nell'**Abisso** e il Flusso resta speso;
- **abilità speciale fallita:** non si risolve; il costo in PV resta pagato, oltre alla perdita di X PV per il fallimento.

Le Materie **avversarie** che bersagliano una carta con Furia funzionano normalmente, senza tiro: il d20 riguarda solo le azioni del proprietario.

##### Slancio

Un'Entità con **Slancio** può **attaccare già nel turno in cui entra in campo**, ignorando l'attesa di evocazione (§6.2).

Lo Slancio riguarda **solo l'attacco**: non esenta l'Entità dalle altre regole legate al turno d'ingresso. In particolare, un'Entità con Slancio **non può essere ritirata nel turno in cui entra** (§6.2), come qualsiasi altra.

##### Stasi

Quando un'Entità con **Stasi** blocca e **dovrebbe morire** (Potenza inferiore all'attaccante), invece di morire **rimane sul campo, permanentemente tappata**: non si stapperà mai più e non potrà più né attaccare né bloccare. Continua a occupare uno slot del Fronte, ma essendo ancora in campo **continua ad abilitare le sue Materie**.

Stasi salva anche dal **contrattacco fallito**: se l'Entità contrattacca e il suo totale resta inferiore alla Potenza dell'attaccante, invece di morire finisce anch'essa **permanentemente tappata** (lo stato di stasi sostituisce la copertura).

Un'Entità in stasi è a tutti gli effetti *tappata* (non coperta): può quindi essere **ritirata** (§6.2) come qualsiasi altra Entità, senza costi né condizioni aggiuntive. È il modo per liberare lo slot che altrimenti resterebbe occupato per il resto della partita.

Stasi protegge **solo in difesa** (blocco o contrattacco): un'Entità con Stasi che muore **attaccando** (es. contro un bloccante con Vendetta) muore normalmente.

##### Vendetta

Quando un'Entità con **Vendetta** blocca e la sua **Potenza supera** quella dell'attaccante, **l'attaccante muore** anche senza contrattacco. (Nel blocco normale, l'attaccante non morirebbe mai — §6.3.)

L'Entità con Vendetta segue per il resto le normali regole di blocco: viene tappata, e non subisce la copertura (non sta contrattaccando).

### 8.2 Effetti

Gli **effetti** sono il testo nella descrizione della carta (es. l'effetto che si risolve quando la carta entra in campo). A differenza delle abilità, non sono parole chiave: fanno ciò che il testo dice (regola d'oro, §1.1).

#### Danno ed Entità

**Il danno esiste solo per Rubyfront e Nexus:** sono le uniche carte con PV, e subire danno significa perdere PV (con ritorno immediato in Zona di Richiamo se il Rubyfront è in campo e la perdita è inflitta dall'avversario, §3.1). **Le Entità non subiscono mai danno:** un effetto che "infligge N danni" non può bersagliarle — i suoi bersagli possibili sono solo Rubyfront e Nexus (propri o avversari, per estensione massima §1.2). Le carte che agiscono sulle Entità usano diciture esplicite: "distruggi...", riduzioni di Potenza, ecc.

#### Modifiche alla Potenza

Gli effetti possono aumentare o ridurre la Potenza di un'Entità. La Potenza **non scende mai sotto 0**: ogni riduzione oltre lo zero è ignorata. Un'Entità a **Potenza 0 resta in campo** e segue le regole normali: se attacca non bloccata infligge 0 danni; nei confronti di battaglia vale il suo valore 0 (bloccante a Potenza 0 muore contro qualsiasi attaccante di Potenza superiore, e così via).

#### Ordine di risoluzione degli effetti simultanei

Quando un evento innesca **più effetti nello stesso momento**, si risolvono in quest'ordine:

1. **Prima la protagonista dell'evento:** la carta a cui è successo qualcosa (è entrata in campo, è morta...) risolve per prima il proprio effetto.
2. **Poi gli altri effetti innescati, dalla carta più giovane alla più vecchia:** si risolve prima l'effetto della carta scesa in campo **più di recente**, poi via via indietro fino alla più vecchia (come una pila: le carte si impilano nell'ordine in cui scendono e si risolvono dalla cima).

L'ordine vale anche tra carte di giocatori diversi: fa fede il momento di discesa in campo, che è unico e condiviso. Nessun giocatore sceglie mai l'ordine: è sempre determinato dallo stato del campo.

Ai fini di questo ordine conta sempre **l'ultimo ingresso in campo**: il Rubyfront rischierato dopo un ritorno in Zona di Richiamo conta come una carta **appena arrivata** (la più giovane), non mantiene l'età del primo schieramento.

**Entrate simultanee** (caso raro): se un unico effetto mette in campo più carte contemporaneamente, entrano nello stesso momento ma **il giocatore che controlla l'effetto decide quale entra "prima"** — anche per le eventuali carte avversarie — e quell'ordine ne fissa l'età ai fini di questa regola.

*Esempio: gioco un'Entità con effetto d'ingresso "scarta una carta" mentre ho in campo due permanenti — la più vecchia dice "quando giochi un'Entità, pesca una carta", la più recente "quando giochi un'Entità, infliggi 1 danno al Rubyfront avversario". Ordine: prima l'Entità entrata (scarto), poi la permanente più giovane (danno), infine la più vecchia (pesco).*

#### Eventi generati durante la risoluzione

La risoluzione di un effetto può generare **nuovi eventi** (una morte, un ingresso in campo...) mentre altri effetti innescati dall'evento precedente sono ancora in attesa. In quel caso **si accodano** (FIFO): prima si esaurisce **tutto il gruppo di effetti dell'evento corrente**, nell'ordine stabilito sopra; poi si risolve il nuovo evento, con il proprio gruppo di effetti innescati ordinato allo stesso modo — e così via, evento dopo evento, finché la coda non è vuota. Un nuovo evento **non interrompe mai** il gruppo in corso di risoluzione.

**Un effetto innescato si risolve comunque:** una volta innescato, l'effetto è "in volo" — si risolve anche se la sua fonte (l'Entità o la permanente che lo ha generato) **lascia il campo prima del suo turno di risoluzione**. Questa regola vale per gli effetti innescati; le Materie Reattive in catena seguono invece la propria regola e **svaniscono** se l'abilitazione manca alla risoluzione (§7.2).

*Esempio: gioco l'Entità E ("Distruggi un'Entità avversaria") con in campo P2, la permanente più giovane ("quando giochi un'Entità, il Rubyfront avversario perde 1 PV") e P1, la più vecchia ("quando giochi un'Entità, pesca una carta"). L'avversario controlla Y ("quando Y muore, distruggi la Materia permanente avversaria più giovane"). Ordine: E risolve e distrugge Y — la morte di Y è un nuovo evento e il suo effetto si accoda; P2 risolve (l'avversario perde 1 PV); P1 risolve (pesco); infine risolve l'effetto di Y, che distrugge P2. Se l'effetto di Y fosse invece riuscito a distruggere P2 prima del suo turno di risoluzione, l'effetto già innescato di P2 si sarebbe risolto comunque.*

## 9. Regole speciali e casi limite

### 9.1 Esaurimento del mazzo

Se il mazzo finisce, **si perde**: il giocatore pesca l'**ultima carta** del mazzo, gioca **quel turno per intero**, e al termine del turno **ha perso la partita**.

L'ultimo turno è una vera ultima possibilità: se durante quel turno il giocatore soddisfa una condizione di vittoria (PV del Rubyfront avversario a 0 o Nexus avversario distrutto), **vince lui** — la sconfitta per esaurimento scatta solo a fine turno.

**Il diritto all'ultimo turno vale solo se l'ultima carta viene pescata durante il proprio turno** (con la pesca di Canalizzazione o per effetto): si completa quel turno e si perde al suo termine. Se invece l'ultima carta viene pescata **nel turno avversario** (es. un effetto avversario che fa pescare), non c'è ultimo turno: il giocatore **ha perso direttamente** quando inizierebbe il suo turno successivo.

**Pesca da effetto a mazzo vuoto:** se un **effetto** chiede di pescare quando il mazzo è vuoto, la pesca semplicemente **non avviene**; il resto dell'effetto si risolve normalmente.

### 9.2 Pareggio

Il pareggio esiste in due soli casi:

- **di comune accordo**, dichiarato da entrambi i giocatori;
- **automatico**, se entrambi i giocatori arrivano a **0 PV nello stesso momento** (es. un unico effetto che azzera i PV di entrambi i Rubyfront/Nexus): la partita è patta.

### 9.3 Riepilogo dei limiti

- Massimo **7 carte in mano** (l'eccesso si scarta a fine turno, §6.4).
- Massimo **5 Entità sul Fronte** (i 5 slot; Rubyfront e Materie permanenti non contano, §6.2).
- Massimo **3 copie** della stessa carta nel mazzo — **una sola** se la carta è **Unica** (§3.1).
- Massimo **20 Flussi** (§3.2). Il Gettone Flusso è fuori dal limite: è un punto a parte.
- Costo **minimo 1 Flusso** per qualsiasi carta (§3.2): non esistono carte gratuite.

## 10. Glossario

- **Entità** — carta con una razza (Umani o Auros). È il termine ufficiale: non si usa "creatura".
- **Rubyfront** — la bestia di ogni giocatore; parte nella Zona di Richiamo. Portare a zero i suoi PV (o distruggerne il Nexus) fa perdere il suo proprietario.
- **Flusso** — la risorsa per giocare le carte. Cresce +1 a turno, si ricarica a inizio turno, massimo 20.
- **Gettone Flusso** — gettone monouso da +1 Flusso dato a chi non inizia la partita, utilizzabile in qualsiasi momento; è fuori dal limite dei 20 Flussi.
- **Canalizzazione** — scartare una carta dalla mano (va nell'Abisso) per ottenere +1 Flusso per il turno in corso (max 1 a turno).
- **Fronte** — il campo di battaglia: 5 slot per le Entità; il Rubyfront schierato sta davanti agli slot, le Materie in gioco dietro.
- **Zona di Richiamo** — zona in cui parte il Rubyfront.
- **Unica** — classificazione stampata sulla carta (il simbolo dell'Unica accanto al nome): il mazzo ne ammette al massimo una copia (§3.1).
- **Abisso** — la zona delle carte morte o consumate: Entità morte o distrutte, Materie risolte, decadute o svanite, Oggetti di Entità morte, carte scartate o canalizzate dalla mano. È pubblico.
- **Zona di Requiem** — la zona delle carte ancora "vive" uscite dal gioco: le Entità ritirate (§6.2) o mandate lì da effetti, e i loro Oggetti. Funziona come l'Abisso, ma distingue ciò che non è mai morto; gli effetti che nominano una delle due zone non toccano l'altra.
- **Potenza** — statistica unica di un'Entità. Modificabile da effetti, non scende mai sotto 0; a Potenza 0 l'Entità resta in campo.
- **Danno** — perdita di PV: possono subirlo solo Rubyfront e Nexus. Le Entità non subiscono mai danno (le carte che le colpiscono usano diciture esplicite come "distruggi").
- **Materia** — carta magia/evento, giocabile solo se un tipo corrispondente è abilitato da una carta in campo. Tre comportamenti: normale, permanente, Reattiva.
- **Materia Reattiva** — Materia giocabile solo in Fase di Fronte; innesca la catena di risposta (risoluzione in ordine inverso).
- **Pre-Fronte** — finestra a inizio Fase di Fronte in cui l'avversario può giocare Materie Reattive prima della dichiarazione d'attacco.
- **Oggetto** — carta con un costo di Flusso che si assegna a un'Entità (max 1 per Entità), pagandolo in Fase di Preparazione.
- **Abilità** — parola chiave con regole predefinite da questo manuale (vedi §8.1).
- **Furia** — abilità esclusiva del Rubyfront/Nexus: prima di ogni sua azione (Materie attribuite, abilità speciali — movimento e flip esclusi) serve un d20 ≥12; al fallimento l'azione salta e si perde il valore X indicato sulla carta (perdita autoinflitta: nessun ritorno in Zona di Richiamo).
- **Slancio** — abilità: l'Entità può attaccare già nel turno in cui entra in campo (ignora l'attesa di evocazione). Riguarda solo l'attacco: non permette di essere ritirata nel turno d'ingresso.
- **Stasi** — abilità: se bloccando dovrebbe morire, resta invece sul campo permanentemente tappata.
- **Vendetta** — abilità: se blocca con Potenza superiore all'attaccante, l'attaccante muore anche senza contrattacco.
- **Attesa di evocazione** — un'Entità non può attaccare nel turno in cui entra in campo.
- **Ritiro** — mandare volontariamente una propria Entità dal Fronte alla Zona di Requiem, in Fase di Preparazione, gratis e senza limite di numero, per liberare slot o solo per toglierla di mezzo. Non si ritira un'Entità entrata in campo nello stesso turno. **Non è una morte** (§6.2).
- **Morire / essere distrutta** — andare nell'Abisso dal campo, per una battaglia persa o per un effetto di distruzione. L'Entità **ritirata** (§6.2) **non muore**: lascia il campo e va in Zona di Requiem senza innescare effetti di morte.
- **Contrattacco +N** — statistica di alcune Entità: quando bloccano possono sommare +N alla Potenza; se così superano l'attaccante, questo muore. Chi contrattacca viene coperto.
- **Tappata** — stato di un'Entità che ha attaccato o bloccato: non può né attaccare né bloccare; si stappa a inizio del turno successivo del proprietario.
- **Coperta** — stato di un'Entità che ha contrattaccato: non può fare nulla, è intoccabile da qualsiasi effetto o Materia, anche avversari (niente Oggetti né Ritiro; l'Oggetto già assegnato le rimane) e non abilita le sue Materie, per un giro completo; poi si scopre.
- **Fronte pronto** — dichiarazione con cui il giocatore di turno annuncia che attacca o passa.
- **Nexus** — la seconda faccia della carta Rubyfront, sua evoluzione: si gioca flippando il Rubyfront in campo (requisiti sulla carta), recupera PV, resta in campo per sempre. Distruggerlo (PV a 0) fa perdere il proprietario.
