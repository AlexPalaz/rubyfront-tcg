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
2. **distruggendo l'Unione** del Rubyfront avversario, cioè portando a zero i PV dell'Unione, se l'avversario l'ha giocata (vedi §3.1, "L'Unione").

## 3. Materiale di gioco

### 3.1 Il mazzo

- Ogni giocatore ha un **mazzo personale di 40 carte, Rubyfront incluso** (esattamente **un** Rubyfront per mazzo). Il mazzo contiene tutte le carte del giocatore: Entità, Materie e Oggetti (non esistono riserve separate).
- Il **Rubyfront non si pesca mai**: all'inizio della partita viene messo direttamente nella **Zona di Richiamo** (vedi §5).

Le carte con una razza si chiamano **Entità** (non "creature"). Ogni Entità appartiene a una **razza**: **Umani** o **Auros** (il Rubyfront è a sé). Per giocare Entità e Materie bisogna **spendere Flusso** pari al loro costo (gli Oggetti sono gratuiti, vedi sotto).

#### Anatomia di una carta Entità

Ogni carta riporta:

- **Nome** della carta
- **Immagine**
- **Razza**
- **Costo di Flusso** per entrare in campo
- **Potenza** — statistica unica della carta (non esistono attacco e difesa separati)
- **Contrattacco +N** (eventuale) — indicato affianco alla Potenza, se la carta ce l'ha (vedi §6.3, "Contrattacco")
- **Abilità** (eventuale) — indicata prima della descrizione, se la carta ne ha una
- **Descrizione**, con l'eventuale **effetto** che si applica quando la carta viene messa in campo
- **Tipi di Materia** che la carta può utilizzare, con il **grado massimo** per i tipi che hanno gradi (§7.1)

Le **Materie** sono le carte magia/evento del gioco (vedi §7).

#### Carte Evoluzione

Le **Evoluzioni** sono a tutti gli effetti **carte Entità** (con razza, Potenza, Materie abilitate, eventuale abilità) legate a un'Entità di base, indicata nella loro descrizione con una dicitura del tipo: *"Se hai X, il costo per giocare questa carta è ridotto di N"*.

- **Con l'Entità di base in campo:** l'Evoluzione si gioca **a costo ridotto** (come indicato dalla dicitura) e **sostituisce** l'Entità di base, che va nella **pila degli scarti**.
- **Senza l'Entità di base:** l'Evoluzione è comunque giocabile **normalmente**, pagando il costo pieno indicato al solito posto sulla carta.
- L'eventuale **Oggetto** assegnato all'Entità di base **si conserva**: passa all'Evoluzione.
- La sostituzione è **un unico scambio senza interruzione**: non esiste un istante in cui la base è uscita e l'Evoluzione non è ancora entrata. Ai fini dell'abilitazione delle Materie (§7), se la base era l'unica carta ad abilitare un tipo e l'Evoluzione abilita lo stesso tipo (al grado richiesto), l'accesso **non si perde mai** e le Materie permanenti di quel tipo **sopravvivono** alla sostituzione. Se invece l'Evoluzione non riabilita il tipo al grado richiesto, l'accesso si perde normalmente (§7.2).
- **La base non muore:** la sostituzione la manda nella pila degli scarti, ma **non conta come morte o distruzione** — gli effetti "quando un'Entità muore / viene distrutta" **non si innescano**. Conta invece come **lasciare il campo** per gli effetti che usano quella dicitura (regola dell'estensione massima, §1.2), fatte salve le eccezioni già previste: l'Oggetto passa all'Evoluzione e l'abilitazione non si interrompe.
- Le Evoluzioni possono **incatenarsi**: un'Evoluzione può essere a sua volta l'Entità di base di un'altra Evoluzione.

**Stato all'ingresso:**

- Se giocata **come evoluzione** (sostituendo la base in campo): entra a tutti gli effetti come una **nuova Entità che entra in campo** — il suo **effetto d'ingresso si risolve normalmente**, innesca gli eventuali effetti "quando giochi un'Entità" delle altre carte, e ai fini dell'ordine di risoluzione (§8.2) la sua "età" è quella del momento in cui entra (non quella della base). Non eredita il tap della base. **Unica differenza** rispetto a un'evocazione normale: **può attaccare subito**, senza attesa di evocazione.
- Se giocata **normalmente** (a costo pieno, senza base in campo): è un'Entità appena evocata a tutti gli effetti — **attesa di evocazione normale**.
- **Un'Entità coperta non può essere sostituita da un'Evoluzione**: la copertura vieta ogni azione, compreso l'essere evoluta (coerente con §6.3, "l'Entità coperta non può fare nulla"). Un'Entità semplicemente tappata, invece, può essere evoluta.

#### Carte Oggetto

Gli **Oggetti** sono carte che si **assegnano a un'Entità**:

- **non hanno mai un costo di Flusso**;
- ogni Entità può avere **al massimo un Oggetto** assegnato;
- si assegnano **solo alle proprie Entità**, salvo diversa indicazione sulla carta;
- **non si assegnano a un'Entità coperta** (§6.3): l'Entità coperta è intoccabile anche per il proprietario. L'Oggetto che aveva **già** assegnato, però, le rimane;
- **non si assegnano al Rubyfront né all'Unione** (non sono Entità), salvo diversa indicazione sulla carta;
- una volta assegnato, l'Oggetto **non può essere spostato né sostituito**;
- quando l'Entità lascia il campo, l'Oggetto va nella **pila degli scarti**.

Il mazzo **può mischiare le razze** liberamente. Si possono avere al massimo **3 copie della stessa carta** nel mazzo.

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

- **automaticamente, appena perde PV mentre è in campo**, per qualsiasi causa: attacchi che passano, effetti e Materie avversarie, o il fallimento della propria Furia (§8.1 — il Rubyfront "si colpisce da solo" e torna comunque in Zona di Richiamo). Il Rubyfront **subisce la perdita di PV** e **torna immediatamente in Zona di Richiamo**: da quell'istante smette di abilitare le sue Materie (le permanenti dei tipi che solo lui abilitava vanno negli scarti, §7.2). Se il proprietario lo rischiera nello stesso turno (pagando il costo aumentato) e il Rubyfront subisce un'altra perdita, torna di nuovo in Zona di Richiamo: **ogni perdita di PV subita in campo è un ritorno** (e quindi un aumento del costo di rischieramento). I **PV spesi come costo** delle abilità speciali sono un pagamento, non una perdita subita: **non fanno scattare il ritorno**;
- **volontariamente**, per scelta del proprietario.

Ogni ritorno in Zona di Richiamo fa scattare l'aumento del costo di rischieramento (vedi sopra).

**Finestra di movimento:** il proprietario può muovere il Rubyfront (schierarlo o richiamarlo, anche **più volte nello stesso turno**) durante tutto il proprio turno, dalla **Fase di Preparazione** fino alla **fine del turno** — anche dopo aver finito di attaccare (il Rubyfront non attacca: la sua funzione è usare abilità a costo PV e Materie, quindi muoverlo a fine turno è legittimo). Ogni rischieramento paga comunque il costo crescente. **Mai nel mezzo di una catena di risposta** (§7.2): la catena è atomica.

#### Ruolo del Rubyfront in campo

Il Rubyfront, quando entra in campo, **non attacca** e **non blocca** (salvo diversa indicazione sulla carta — la regola d'oro §1.1 vale sempre). Il senso di schierarlo è:

- usare le sue **abilità speciali** (pagandone il costo in PV) — attivabili **liberamente, solo nel proprio turno**, sia in Fase di Preparazione che in Fase di Fronte. La stessa abilità è attivabile **più volte per turno**, finché i PV bastano. Si risolvono **senza possibilità di risposta** (la catena vale solo per le Reattive). Un'abilità è attivabile **solo se i PV coprono l'intero costo** (PV ≥ costo): i PV non scendono mai sotto 0. **Attenzione:** pagare fino a 0 esatto è legale, ma a 0 PV si perde **immediatamente** la partita — l'effetto dell'abilità **non si risolve**;
- usare le **Materie** a lui disponibili;
- **triggerare l'Unione**, quando i requisiti sono soddisfatti (vedi "L'Unione", più sotto).

I PV sono quindi una risorsa a doppio taglio: sono la condizione di sconfitta, ma anche la valuta con cui il Rubyfront paga le proprie abilità speciali.

#### L'Unione

La carta del Rubyfront ha **due facce**: una è il **Rubyfront**, l'altra è la sua **Unione** — l'evoluzione del Rubyfront.

- **Come si gioca:** si **flippa** la carta del Rubyfront sull'altra faccia. Requisiti e condizioni:
  - i **requisiti** per il flip sono scritti sulla carta stessa e vanno soddisfatti **al momento del flip**: una volta giocata, l'Unione resta in campo anche se i requisiti smettono in seguito di essere veri;
  - il **Rubyfront dev'essere in campo** (non si flippa dalla Zona di Richiamo);
  - soddisfatti i requisiti, il flip si può fare in qualsiasi momento del proprio turno, **dalla Fase di Preparazione fino alla fine del turno** (stessa finestra del movimento del Rubyfront, §3.1), e non ha altri costi.
- **PV recuperati:** la faccia dell'Unione indica un **recupero di PV** (es. `+5`): l'Unione parte con i **PV rimasti al Rubyfront più il recupero indicato**.
- **Permanenza:** l'Unione **sostituisce il Rubyfront** e **rimane in campo per tutta la durata della partita**, salvo diverse indicazioni sulle carte. **Non torna mai in Zona di Richiamo**: quando un attacco le passa, subisce il danno e resta in campo.
- **Flip, effetti e Materie:** il flip **non è una nuova entrata in campo**: non innesca gli effetti "quando giochi una carta/Entità" e, ai fini dell'ordine di risoluzione (§8.2), la carta conserva l'età dello schieramento del Rubyfront. Dal momento del flip **si attiva l'effetto indicato sulla faccia dell'Unione**. Le Materie abilitate sono **quelle stampate sulla faccia dell'Unione** (nessuna eredità dal Rubyfront): le Materie permanenti dei tipi che l'Unione continua ad abilitare **sopravvivono al flip senza interruzione**; quelle dei tipi non più abilitati vanno nella **pila degli scarti**.
- **Com'è fatta:** ha la stessa struttura del Rubyfront — PV, **Materie disponibili proprie** (stampate sulla sua faccia) e **abilità speciali**, chiaramente **più potenti**. Come il Rubyfront, **non attacca e non blocca** (salvo diversa indicazione sulla carta).
- **Nessuna eredità di abilità:** come per le Materie, anche le **abilità** (principale e speciali) dell'Unione sono **solo quelle stampate sulla sua faccia**. L'abilità principale del Rubyfront **non passa** all'Unione: se la faccia dell'Unione non ne riporta una, l'Unione **non ha abilità principale** (un'Unione può quindi essere libera dalla Furia del suo Rubyfront, o averne una propria).
- **Distruzione = sconfitta:** portare a **0 i PV dell'Unione** significa distruggerla — è la condizione di vittoria n. 2 (§2).
- **Regola generale:** dopo il flip, **ogni regola di questo manuale che nomina il Rubyfront si applica identica all'Unione** (bersaglio degli attacchi, danni da attacchi non bloccati, abilità speciali solo nel proprio turno, Materie abilitate...), salvo dove diversamente indicato.

### 3.2 Il Flusso

Il **Flusso** è la risorsa con cui si pagano le carte, al posto del classico mana. A differenza del mana:

- **non esistono carte Terra** (o simili) da giocare per generare risorse;
- ogni giocatore ha un proprio valore di Flusso massimo che **cresce automaticamente di +1 all'inizio di ogni proprio turno, a partire dal secondo**;
- entrambi i giocatori **partono con 1 di Flusso** (1° turno: 1, 2° turno: 2, 3° turno: 3...);
- il Flusso speso **si ricarica interamente all'inizio del proprio turno**;
- nel **turno avversario** si ha a disposizione il Flusso **non speso** rimasto dal proprio turno (es. per giocare Materie Reattive in difesa): tenersi Flusso da parte è una scelta strategica;
- **limite assoluto: 20 Flussi.** Il Flusso non può mai superare 20 in nessun modo: anche canalizzando (vedi §6.1) a 20 Flussi, non si arriva a 21. Unica cosa che vive fuori dalla barra: il **Gettone Flusso** (vedi sotto).

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
- **Pila degli scarti** — le carte scartate/distrutte. È **pubblica**: consultabile da entrambi i giocatori in qualsiasi momento.
- **Zona di Richiamo** — il Rubyfront si posiziona e **parte sempre qui**, salvo diverse indicazioni sulla carta.

Il **mazzo** e la **mano** sono **nascosti** all'avversario.

## 6. Struttura del turno

Il turno si compone di tre fasi, nell'ordine: **Canalizzazione → Preparazione → Fronte**.

### 6.1 Fase di Canalizzazione

1. **Pesca:** il giocatore di turno pesca una carta. Vale anche per il **primo turno di chi inizia**: la pesca non si salta mai.
2. **Canalizzazione (opzionale):** il giocatore può **canalizzare al massimo una carta** dalla mano: la carta canalizzata va nella **pila degli scarti** e il giocatore ottiene **+1 Flusso valido solo per il turno in corso** (non è permanente). Si somma alla crescita automatica di +1 a turno (§3.2) e rispetta comunque il limite assoluto di 20 Flussi.

### 6.2 Fase di Preparazione

Dichiarata dal giocatore al termine della Canalizzazione. In questa fase si inizia a giocare con le carte e **si prepara il Fronte**. Il giocatore può:

- **giocare Entità** (pagandone il costo di Flusso);
- **giocare Materie** normali e permanenti (le Reattive si giocano solo in Fase di Fronte, §7.2);
- **assegnare Oggetti** (carte Oggetto) alle Entità — massimo **un Oggetto per Entità**;
- **ritirare** le proprie Entità dal Fronte (vedi "Ritiro", più sotto).

**Non c'è limite al numero di carte giocabili** nella fase: il solo vincolo è il Flusso disponibile (gli Oggetti, che sono gratuiti, non hanno alcun limite di giocata).

Sul Fronte si possono avere **al massimo 5 Entità contemporaneamente** — i **5 slot** del Fronte (§5). Nel limite contano **solo le Entità**: il **Rubyfront** non occupa slot (schierato, sta davanti agli slot), le **Materie permanenti** stanno dietro gli slot e **non hanno limite di numero** (il solo vincolo è l'abilitazione, §7), gli **Oggetti** sono assegnati alle Entità e non occupano slot.

**A Fronte pieno** (5 slot occupati) non si possono giocare altre Entità. Se un **effetto** metterebbe in campo una carta a Fronte pieno, quella parte dell'effetto **non si applica** (la carta non entra) e il resto dell'effetto si risolve normalmente. **Eccezione:** un'Evoluzione giocata **come sostituzione** della sua base in campo (§3.1) è sempre legale anche a Fronte pieno — la base esce e l'Evoluzione entra al suo posto, il saldo sul Fronte è zero. Giocata invece a costo pieno (senza base), l'Evoluzione richiede uno slot libero come ogni Entità.

#### Ritiro

Il giocatore può **ritirare** le proprie Entità dal Fronte: l'Entità ritirata va nella **pila degli scarti** e il suo slot torna libero.

- **Quando:** solo in **Fase di Preparazione**, e solo sulle **proprie** Entità. Il ritiro è un'azione di preparazione del Fronte: non si ritira in Fase di Fronte, né nel turno avversario, né nel mezzo di una catena di risposta (§7.2).
- **Costo:** nessuno. Non c'è **limite** al numero di Entità ritirabili in un turno: si può anche svuotare l'intero Fronte.
- **Non è obbligatorio giocare qualcosa al suo posto:** si può ritirare solo per liberare slot, o senza alcuna intenzione di far scendere altre carte.
- **Non è una morte:** come per la base sostituita da un'Evoluzione (§3.1), il ritiro manda l'Entità negli scarti ma **non conta come morte o distruzione** — gli effetti "quando un'Entità muore / viene distrutta" **non si innescano**. Conta invece come **lasciare il campo** per gli effetti che usano quella dicitura (§1.2).
- **Oggetto assegnato:** segue la regola generale (§3.1) — va anch'esso nella **pila degli scarti**.
- **Abilitazione delle Materie:** l'Entità ritirata smette di abilitare i suoi tipi di Materia. Se era l'ultima ad abilitare un tipo, l'accesso si perde e le Materie permanenti di quel tipo vanno negli scarti (§7.2). Ritirare senza controllare cosa si sta abilitando è un errore costoso.
- **Un'Entità coperta non può essere ritirata** (§6.3): la copertura la rende intoccabile anche per il proprietario. Un'Entità **tappata** o **in stasi** (§8.1), invece, si ritira normalmente.
- Il **Rubyfront non si ritira**: non è un'Entità e non occupa uno slot. Per toglierlo dal campo si usa il richiamo in Zona di Richiamo (§3.1), che è cosa diversa. L'**Unione**, una volta in campo, non lascia mai il campo (§3.1).

**Attesa di evocazione:** un'Entità appena entrata in campo **non può attaccare nel turno in cui entra**; deve aspettare il turno successivo. Può però già **bloccare** nel turno avversario che segue.

### 6.3 Fase di Fronte (combattimento)

Terminata la Fase di Preparazione, il giocatore di turno **dichiara di entrare in Fase di Fronte**. La fase è **facoltativa**: il giocatore può anche chiudere il turno direttamente dalla Fase di Preparazione, senza dichiararla. In quel caso **non c'è Pre-Fronte** e in quel turno non si apre nessuna finestra per giocare Reattive. Se dichiarata, la fase si svolge in questo ordine:

1. **Pre-Fronte:** dichiarata l'apertura del Fronte, **l'avversario può giocare Materie Reattive**. Il giocatore di turno può rispondere con la catena di risposta (§7.2).
2. **Finestra Reattive del giocatore di turno:** conclusa la Pre-Fronte, il giocatore di turno può giocare le proprie Materie Reattive (l'avversario può rispondere in catena, §7.2).
3. **Fronte pronto — dichiarazione dell'attacco (o passo):** il giocatore di turno **seleziona tutte le Entità con cui attacca** e le dichiara **in un'unica ondata** — oppure dichiara che passa. **Dopo la dichiarazione non si possono più *iniziare* Reattive**, con un'unica eccezione: le Reattive difensive usate come blocco (vedi punto 4). Le **risposte in catena** (§7.2) restano sempre possibili: ogni Reattiva giocata può essere risposta con altre Reattive.
4. **Dichiarazione dei blocchi:** il difensore, vista l'intera ondata, **assegna i propri blocchi**. Ogni attaccante può essere bloccato da:
   - una **propria Entità** (sfide 1 contro 1: un bloccante per attaccante, ogni Entità blocca una sola volta; chi blocca si tappa, chi contrattacca si copre), **oppure**
   - una **Materia Reattiva il cui testo permette di bloccare** (pagandone il costo di Flusso): la Reattiva sostituisce il bloccante per quell'attacco. **Non c'è confronto di Potenza** (la Reattiva non ne ha): l'attacco è **comunque bloccato**, e l'eventuale sorte dell'attaccante la stabilisce il **testo della Reattiva**. Come ogni Reattiva, **apre la catena di risposta** (§7.2): l'attaccante può rispondere.
5. **Risoluzione:** le battaglie si risolvono una alla volta, **nell'ordine di dichiarazione degli attaccanti** (confronto di Potenza per ogni coppia; gli attacchi non bloccati infliggono danni al Rubyfront). *Eccezione per le Entità con Furia: il loro d20 si tira al momento della risoluzione, e solo se passa il difensore dichiara il blocco per quell'attacco (§8.1, "Furia").*
6. **Fine del turno.**

**Movimento del Rubyfront:** promemoria — può essere schierato o richiamato in **qualsiasi momento del proprio turno**, anche dopo gli attacchi, fino alla fine del turno (vedi §3.1, "Finestra di movimento").

#### Regole di attacco

- Ogni Entità **attacca una sola volta per turno**.
- **Chi attacca viene tappato al momento della dichiarazione dell'ondata** (§6.3, punto 3), non alla risoluzione della sua battaglia. *Unica eccezione: l'Entità con Furia si tappa al momento del suo tiro di d20, riuscito o fallito che sia — l'attacco è stato tentato (§8.1).* L'Entità si stapperà all'inizio del turno successivo del proprietario: resta quindi tappata per **tutto il turno avversario che segue** e **non potrà bloccare** — attaccare costa la possibilità di difendersi (vedi "Stati delle Entità", più sotto).
- Un'Entità **tappata non può attaccare**.
- Un'Entità entrata in campo in quel turno **non può attaccare** (attesa di evocazione, §6.2).
- **Si attacca sempre il Rubyfront avversario**, mai le altre Entità direttamente.
- Un **attacco non bloccato** infligge al Rubyfront danni pari alla **Potenza dell'attaccante** (i suoi PV scendono di altrettanto).

#### Blocco

- Il **difensore può scegliere di bloccare** con le proprie Entità, decidendo se far passare o meno l'attacco al Rubyfront.
- Anche le **Materie Reattive possono bloccare attacchi**, se il testo della carta lo prevede (e c'è il Flusso per pagarle): al momento della dichiarazione dei blocchi, il difensore può assegnare a un attaccante una Reattiva-blocco **al posto di una propria Entità** (§6.3, punto 4).
- La sfida è sempre **1 contro 1**: ogni attaccante può essere bloccato da **una sola Entità**, e ogni Entità può **bloccare una sola volta per turno**.
- Un'Entità **tappata non può bloccare** (es. perché ha attaccato nel proprio turno precedente).
- **Quando un'Entità blocca viene tappata.**

#### Risoluzione di una battaglia (attaccante vs bloccante)

Si confrontano le **Potenze**:

- Se la Potenza del bloccante è **inferiore** a quella dell'attaccante → il bloccante **muore** (va nella pila degli scarti), ma **l'attacco è comunque bloccato** (il Rubyfront non subisce danno).
- Se la Potenza del bloccante è **pari o superiore** → l'attacco è bloccato e il bloccante **non muore**.
- L'attaccante, in un blocco normale, **non muore mai**.

*Esempio: un'Entità con Potenza 4 attacca; il difensore blocca con un'Entità di Potenza 3 → il bloccante muore, l'attacco non passa. Se il bloccante avesse Potenza 4 o più, non morirebbe nessuno.*

#### Uscite dal campo tra dichiarazione e risoluzione

Tra la dichiarazione dei blocchi e la risoluzione delle battaglie possono intervenire effetti (es. una catena aperta da una Reattiva-blocco) che rimuovono dal campo carte già impegnate:

- Se il **bloccante** assegnato a un attaccante lascia il campo prima che la sua battaglia si risolva, alla risoluzione quell'attacco è **non bloccato**: passa e infligge danni al Rubyfront. Il blocco **non si riassegna**.
- Se è l'**attaccante** a lasciare il campo prima della risoluzione, la battaglia **non avviene**: nessun confronto, nessun danno. Il bloccante che gli era assegnato resta comunque **tappato** (e il contrattaccante **coperto**): tap e copertura scattano alla dichiarazione dei blocchi (§6.3, punto 4) e non si annullano.

#### Contrattacco

Alcune Entità hanno la statistica **Contrattacco +N**. Quando bloccano, possono **scegliere di contrattaccare**: la loro Potenza diventa `Potenza + N` per quel confronto, e l'Entità viene **coperta** (anziché tappata) — verrà **scoperta più avanti**.

La scelta *blocco normale o contrattacco* si dichiara **al momento dell'assegnazione dei blocchi** (§6.3, punto 4), non alla risoluzione: il difensore non può aspettare di vedere come si risolvono le battaglie precedenti per decidere.

Risoluzione del contrattacco (totale = Potenza + N contro Potenza dell'attaccante):

- **Totale superiore** → **l'attaccante muore**; il contrattaccante è in salvo.
- **Totale pari** → l'attaccante **non** muore (serve necessariamente superarlo), ma il pareggio **mette in salvo** il contrattaccante.
- **Totale inferiore** → il contrattaccante **muore** e va nella pila degli scarti, come in un blocco normale.

*Esempio: attaccante con Potenza 4; bloccante con Potenza 3 e Contrattacco +2 sceglie di contrattaccare → 3+2 = 5 > 4: l'attaccante muore, il bloccante sopravvive ma resta coperto.*

#### Stati delle Entità: tappata e coperta

- **Tappata** (per aver **attaccato o bloccato**): un'Entità tappata **non può né attaccare né bloccare**. Si **stappa all'inizio del turno successivo del proprietario**. La differenza pratica sta nel momento in cui scatta il tap:
  - **tap in difesa** (per aver bloccato, nel turno avversario): il turno del proprietario arriva subito dopo, quindi l'Entità si stappa immediatamente e non perde nulla — il tap segna solo che ha già bloccato in quel turno di difesa;
  - **tap in attacco** (per aver attaccato, nel proprio turno): l'Entità resta tappata per **tutto il turno avversario che segue** e quindi **non può bloccare** — in sostanza, attaccare costa la difesa.
- **Coperta** (per aver contrattaccato): l'Entità coperta **non può fare nulla** finché è coperta, ed è **intoccabile in senso totale**, da entrambi i giocatori. Per il proprietario: non può essere evoluta (§3.1), né ricevere Oggetti (quello già assegnato le rimane), né essere **ritirata** (§6.2). Per chiunque: **non può essere bersagliata né subire effetti o Materie di alcun tipo, nemmeno avversari** — finché è coperta è come se non fosse in campo (continua però a occupare il suo slot del Fronte), salvo diversa indicazione sulle carte (§1.1). A differenza della tappata (§8.1), **non abilita le sue Materie**: l'abilitazione è sospesa per tutta la copertura. Se era l'unica carta ad abilitare un tipo, l'accesso a quel tipo si perde, ma le Materie permanenti di quel tipo **non decadono**: si **coprono anche loro** — restano sul campo sospese, con l'effetto spento, come se non fossero in campo — e si **riattivano automaticamente quando l'Entità si scopre**. Se però l'Entità coperta lascia il campo prima di scoprirsi, l'abilitazione è persa per davvero e le permanenti coperte vanno negli scarti (§7.2). La copertura dura **un giro completo**:

  1. *Turno avversario (T):* l'Entità contrattacca e viene **coperta**.
  2. *Turno del proprietario (T+1):* non può attaccare.
  3. *Turno avversario (T+2):* non può bloccare.
  4. *Turno del proprietario (T+3):* viene **scoperta** e può di nuovo agire.


### 6.4 Fine del turno

Non si possono avere **più di 7 carte in mano**: alla fine del proprio turno, le carte in eccesso vanno **scartate**.

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
- L'effetto **si risolve immediatamente**, poi la carta va nella **pila degli scarti**.
- È il comportamento classico di una carta Materia.

#### Materia permanente

- Identica alla normale: si gioca in **Fase di Preparazione**.
- L'effetto è **permanente**: la carta **resta in gioco** e non va nella pila degli scarti.
- **Non occupa uno slot del Fronte:** sta **dietro** i 5 slot delle Entità (§5) e non conta nel limite; non c'è un limite al numero di permanenti in gioco.
- **Decade insieme all'abilitazione:** se il giocatore perde l'accesso al tipo di Materia **al grado della permanente** (l'ultima carta che abilita quel tipo al grado richiesto lascia il campo), la permanente va nella **pila degli scarti**. Un abilitatore di grado inferiore **non basta**: una permanente di secondo grado decade se in campo resta solo un abilitatore di primo grado — coerente con la catena di risposta, dove l'abilitazione si ricontrolla sempre "al grado richiesto". **Eccezione — copertura:** se l'accesso si perde solo perché l'ultima carta abilitante è stata **coperta** (§6.3), la permanente non va negli scarti: **si copre anche lei** — resta sul campo con l'effetto sospeso, come se non fosse in campo — e si **riattiva** quando l'abilitatore si scopre. Se l'abilitatore lascia il campo mentre è coperto, la permanente coperta va negli scarti. **Attenzione:** vale anche per il Rubyfront — quando torna in Zona di Richiamo (immediatamente se perde PV, §3.1, o per scelta del proprietario) smette di abilitare le sue Materie: le permanenti dei tipi che **solo lui** abilitava (tipicamente la Distruttiva) vanno negli scarti. È un rischio da mettere in conto quando lo si schiera.
- Se possa essere distrutta o rimossa da effetti **dipende dalle carte**.

#### Materia Reattiva

- Si gioca **solo in Fase di Fronte**. Possono essere potenziamenti ad attacchi e difese, ma anche **effetti particolari di qualsiasi natura**. Una Reattiva **non è mai un "attacco"** nel senso delle regole di combattimento (§6.3): l'eventuale danno che infligge è danno da effetto (che per il Rubyfront in campo conta comunque come perdita di PV, con ritorno immediato in Zona di Richiamo, §3.1).
- **Nessuno può intervenire in qualsiasi momento a piacere:** le Reattive si giocano solo nelle finestre previste.
- **Finestra dell'avversario (Pre-Fronte):** all'apertura della Fase di Fronte, prima della dichiarazione d'attacco, l'avversario può giocare Reattive (§6.3).
- **Finestra del giocatore di turno:** dopo la Pre-Fronte e prima di dichiarare Fronte pronto, il giocatore di turno può giocare Reattive.
- **Dopo la dichiarazione dell'attacco non si *iniziano* più Reattive**, con un'unica eccezione: le **Reattive-blocco** del difensore, assegnate come blocco a un attaccante al posto di un'Entità (§6.3). La Reattiva-blocco apre una **normale catena di risposta**: si risponde **solo con Reattive**, come in ogni catena. I potenziamenti giocati *di propria iniziativa*, invece, vanno giocati **prima** della dichiarazione d'attacco, "in anticipo": sono una scommessa per entrambi.
- In tutte le finestre, chi subisce la Reattiva può **rispondere** (vedi catena di risposta).

#### Catena di risposta

**Regola universale:** le finestre stabiliscono chi può *iniziare* una Reattiva; ma **ogni volta che un giocatore lancia una Reattiva, l'avversario può sempre rispondere**.

- Si può rispondere **solo con Materie Reattive**.
- Chi ha lanciato può a sua volta **controrispondere**, e così via: la catena prosegue finché i giocatori possono e vogliono aggiungere Reattive. L'alternanza è **stretta**: dopo ogni Reattiva può giocare solo l'**avversario** di chi l'ha lanciata — non si possono mettere due proprie Reattive di fila sulla stessa catena.
- Quando il giocatore a cui tocca rispondere **passa**, la catena **si risolve in ordine inverso**: l'**ultima** Materia giocata si risolve **per prima**, poi via via indietro fino alla prima. Risolta la catena, chi ne ha la finestra può eventualmente iniziarne una nuova.
- **La catena è atomica:** dal primo lancio alla risoluzione completa non si compiono altre azioni. In particolare, **il movimento del Rubyfront e il flip verso l'Unione non possono avvenire a metà catena** (§3.1). Restano invece possibili in catena: l'uso del **Gettone Flusso** (§3.2, serve proprio a pagare le Reattive) e gli eventi **automatici**, come il ritorno immediato del Rubyfront che perde PV per una Reattiva risolta (§3.1).
- **L'abilitazione si ricontrolla alla risoluzione:** se, quando una Reattiva in catena deve risolversi, il suo giocatore non ha più in campo una carta che abiliti quel tipo al grado richiesto (es. una risposta ha eliminato l'abilitatore), la Reattiva **svanisce** — va nella pila degli scarti senza alcun effetto, e il Flusso resta speso.

## 8. Abilità ed effetti delle carte

### 8.1 Abilità (parole chiave)

Le **abilità** sono **parole chiave con regole predefinite** da questo manuale: quando una carta riporta un'abilità, ne applica le regole così come sono, senza bisogno di testo aggiuntivo sulla carta.

L'**abilità principale** del Rubyfront funziona allo stesso modo: è una parola chiave, attiva dal momento in cui entra in campo (§3.1).

#### Elenco delle abilità

##### Furia

Una carta con **Furia** non può essere **controllata direttamente** dal suo proprietario. Furia compare **principalmente sul Rubyfront** (come abilità principale), ma può averla anche un'Entità. Il principio è unico:

**Prima di qualsiasi azione** che coinvolga la carta con Furia, il proprietario **lancia un d20**. Le azioni soggette al tiro sono: attaccare, bloccare, contrattaccare, usare una Materia **attribuita** alla carta con Furia (§7: se un'altra carta senza Furia abilita lo stesso tipo al grado richiesto, il giocatore può attribuire la Materia a quella ed evitare il tiro), e — nel caso del Rubyfront — usare un'**abilità speciale**.

**Il movimento del Rubyfront non è mai soggetto al tiro:** schierarsi e tornare in Zona di Richiamo (volontariamente o automaticamente dopo un colpo subìto) avvengono sempre senza d20. **Nemmeno il flip verso l'Unione richiede il tiro** (§3.1): girare la carta non è un'azione soggetta a Furia.

Esito del tiro:

- con **12 o più**, l'azione **va a buon fine**;
- con **11 o meno**, l'azione **fallisce** e si perdono PV: per un'**Entità**, il Rubyfront del proprietario perde PV **pari alla Potenza** dell'Entità; per il **Rubyfront/Unione**, si perde il **valore X indicato sulla carta** accanto a Furia.

**Al fallimento la carta con Furia si ritorce contro il proprietario:** l'azione salta, i costi già pagati restano pagati, il Rubyfront del proprietario perde i PV del fallimento (Potenza dell'Entità, o X per Rubyfront/Unione) e — se la carta con Furia è un'Entità — questa **si tappa**, come se avesse eseguito un attacco contro il proprio giocatore. Nel dettaglio:

- **attacco fallito:** annullato; conta comunque come l'attacco del turno dell'Entità, che viene **tappata** (l'attacco è stato tentato);
- **blocco fallito:** la difesa non avviene e **quell'attacco passa**; l'Entità viene **tappata** e quindi **non può bloccare altri attacchi** dell'ondata;
- **contrattacco fallito:** come il blocco fallito — l'attacco passa e l'Entità viene **tappata** (non coperta);
- **Materia fallita:** va nella **pila degli scarti**, il Flusso resta speso e la carta con Furia a cui era attribuita **si tappa** (vale in ogni fase, anche in Preparazione; un'Entità tappata continua comunque ad abilitare le sue Materie);
- **abilità speciale del Rubyfront fallita:** non si risolve; il costo in PV resta pagato, oltre alla perdita di X PV per il fallimento.

**Nota per il Rubyfront/Unione:** non avendo stati di tap, al fallimento perde solo gli X PV. La perdita di PV da fallimento è a tutti gli effetti una perdita subita: per il Rubyfront in campo fa scattare il **ritorno immediato in Zona di Richiamo** (§3.1).

**Tempistica del tiro in attacco:** l'Entità con Furia si dichiara nell'ondata normalmente (§6.3), ma il suo blocco **non** si assegna con gli altri: il **d20 si tira quando arriva il momento di risolvere il suo attacco**, e solo **se il tiro passa** il difensore dichiara il blocco per quell'attacco. Superato il tiro, l'attacco è **un attacco come tutti gli altri**: il difensore può bloccarlo con una propria Entità **o con una Reattiva-blocco** (§6.3, punto 4). Se il tiro fallisce, non c'è battaglia: nessun bloccante viene impegnato.

**Tempistica del tiro in difesa:** il bloccante (o contrattaccante) con Furia si assegna normalmente nella dichiarazione dei blocchi; il d20 si tira **al momento di risolvere la sua battaglia**.

Le Materie **avversarie** che bersagliano una carta con Furia funzionano normalmente, senza tiro: il d20 riguarda solo le azioni del proprietario.

##### Slancio

Un'Entità con **Slancio** può **attaccare già nel turno in cui entra in campo**, ignorando l'attesa di evocazione (§6.2).

##### Stasi

Quando un'Entità con **Stasi** blocca e **dovrebbe morire** (Potenza inferiore all'attaccante), invece di morire **rimane sul campo, permanentemente tappata**: non si stapperà mai più e non potrà più né attaccare né bloccare. Continua a occupare uno slot del Fronte, ma essendo ancora in campo **continua ad abilitare le sue Materie**.

Stasi salva anche dal **contrattacco fallito**: se l'Entità contrattacca e il suo totale resta inferiore alla Potenza dell'attaccante, invece di morire finisce anch'essa **permanentemente tappata** (lo stato di stasi sostituisce la copertura).

Un'Entità in stasi è a tutti gli effetti *tappata* (non coperta): può quindi essere **sostituita da un'Evoluzione** (§3.1), che entra fresca — è il modo per "riscattare" un'Entità pietrificata.

Stasi protegge **solo in difesa** (blocco o contrattacco): un'Entità con Stasi che muore **attaccando** (es. contro un bloccante con Vendetta) muore normalmente.

##### Vendetta

Quando un'Entità con **Vendetta** blocca e la sua **Potenza supera** quella dell'attaccante, **l'attaccante muore** anche senza contrattacco. (Nel blocco normale, l'attaccante non morirebbe mai — §6.3.)

L'Entità con Vendetta segue per il resto le normali regole di blocco: viene tappata, e non subisce la copertura (non sta contrattaccando).

### 8.2 Effetti

Gli **effetti** sono il testo nella descrizione della carta (es. l'effetto che si risolve quando la carta entra in campo). A differenza delle abilità, non sono parole chiave: fanno ciò che il testo dice (regola d'oro, §1.1).

#### Danno ed Entità

**Il danno esiste solo per Rubyfront e Unione:** sono le uniche carte con PV, e subire danno significa perdere PV (con ritorno immediato in Zona di Richiamo se il Rubyfront è in campo, §3.1). **Le Entità non subiscono mai danno:** un effetto che "infligge N danni" non può bersagliarle — i suoi bersagli possibili sono solo Rubyfront e Unione (propri o avversari, per estensione massima §1.2). Le carte che agiscono sulle Entità usano diciture esplicite: "distruggi...", riduzioni di Potenza, ecc.

#### Modifiche alla Potenza

Gli effetti possono aumentare o ridurre la Potenza di un'Entità. La Potenza **non scende mai sotto 0**: ogni riduzione oltre lo zero è ignorata. Un'Entità a **Potenza 0 resta in campo** e segue le regole normali: se attacca non bloccata infligge 0 danni; nei confronti di battaglia vale il suo valore 0 (bloccante a Potenza 0 muore contro qualsiasi attaccante di Potenza superiore, e così via).

#### Ordine di risoluzione degli effetti simultanei

Quando un evento innesca **più effetti nello stesso momento**, si risolvono in quest'ordine:

1. **Prima la protagonista dell'evento:** la carta a cui è successo qualcosa (è entrata in campo, è morta...) risolve per prima il proprio effetto.
2. **Poi gli altri effetti innescati, dalla carta più giovane alla più vecchia:** si risolve prima l'effetto della carta scesa in campo **più di recente**, poi via via indietro fino alla più vecchia (come una pila: le carte si impilano nell'ordine in cui scendono e si risolvono dalla cima).

L'ordine vale anche tra carte di giocatori diversi: fa fede il momento di discesa in campo, che è unico e condiviso. Nessun giocatore sceglie mai l'ordine: è sempre determinato dallo stato del campo.

Ai fini di questo ordine conta sempre **l'ultimo ingresso in campo**: il Rubyfront rischierato dopo un ritorno in Zona di Richiamo conta come una carta **appena arrivata** (la più giovane), non mantiene l'età del primo schieramento. Lo stesso vale per un'Evoluzione, che entra con età nuova (§3.1).

**Entrate simultanee** (caso raro): se un unico effetto mette in campo più carte contemporaneamente, entrano nello stesso momento ma **il giocatore che controlla l'effetto decide quale entra "prima"** — anche per le eventuali carte avversarie — e quell'ordine ne fissa l'età ai fini di questa regola.

*Esempio: gioco un'Entità con effetto d'ingresso "scarta una carta" mentre ho in campo due permanenti — la più vecchia dice "quando giochi un'Entità, pesca una carta", la più recente "quando giochi un'Entità, infliggi 1 danno al Rubyfront avversario". Ordine: prima l'Entità entrata (scarto), poi la permanente più giovane (danno), infine la più vecchia (pesco).*

#### Eventi generati durante la risoluzione

La risoluzione di un effetto può generare **nuovi eventi** (una morte, un ingresso in campo...) mentre altri effetti innescati dall'evento precedente sono ancora in attesa. In quel caso **si accodano** (FIFO): prima si esaurisce **tutto il gruppo di effetti dell'evento corrente**, nell'ordine stabilito sopra; poi si risolve il nuovo evento, con il proprio gruppo di effetti innescati ordinato allo stesso modo — e così via, evento dopo evento, finché la coda non è vuota. Un nuovo evento **non interrompe mai** il gruppo in corso di risoluzione.

**Un effetto innescato si risolve comunque:** una volta innescato, l'effetto è "in volo" — si risolve anche se la sua fonte (l'Entità o la permanente che lo ha generato) **lascia il campo prima del suo turno di risoluzione**. Questa regola vale per gli effetti innescati; le Materie Reattive in catena seguono invece la propria regola e **svaniscono** se l'abilitazione manca alla risoluzione (§7.2).

*Esempio: gioco l'Entità E ("Distruggi un'Entità avversaria") con in campo P2, la permanente più giovane ("quando giochi un'Entità, il Rubyfront avversario perde 1 PV") e P1, la più vecchia ("quando giochi un'Entità, pesca una carta"). L'avversario controlla Y ("quando Y muore, distruggi la Materia permanente avversaria più giovane"). Ordine: E risolve e distrugge Y — la morte di Y è un nuovo evento e il suo effetto si accoda; P2 risolve (l'avversario perde 1 PV); P1 risolve (pesco); infine risolve l'effetto di Y, che distrugge P2. Se l'effetto di Y fosse invece riuscito a distruggere P2 prima del suo turno di risoluzione, l'effetto già innescato di P2 si sarebbe risolto comunque.*

## 9. Regole speciali e casi limite

### 9.1 Esaurimento del mazzo

Se il mazzo finisce, **si perde**: il giocatore pesca l'**ultima carta** del mazzo, gioca **quel turno per intero**, e al termine del turno **ha perso la partita**.

L'ultimo turno è una vera ultima possibilità: se durante quel turno il giocatore soddisfa una condizione di vittoria (PV del Rubyfront avversario a 0 o Unione avversaria distrutta), **vince lui** — la sconfitta per esaurimento scatta solo a fine turno.

**Il diritto all'ultimo turno vale solo se l'ultima carta viene pescata durante il proprio turno** (con la pesca di Canalizzazione o per effetto): si completa quel turno e si perde al suo termine. Se invece l'ultima carta viene pescata **nel turno avversario** (es. un effetto avversario che fa pescare), non c'è ultimo turno: il giocatore **ha perso direttamente** quando inizierebbe il suo turno successivo.

**Pesca da effetto a mazzo vuoto:** se un **effetto** chiede di pescare quando il mazzo è vuoto, la pesca semplicemente **non avviene**; il resto dell'effetto si risolve normalmente.

### 9.2 Pareggio

Il pareggio esiste in due soli casi:

- **di comune accordo**, dichiarato da entrambi i giocatori;
- **automatico**, se entrambi i giocatori arrivano a **0 PV nello stesso momento** (es. un unico effetto che azzera i PV di entrambi i Rubyfront/Unioni): la partita è patta.

### 9.3 Riepilogo dei limiti

- Massimo **7 carte in mano** (l'eccesso si scarta a fine turno, §6.4).
- Massimo **5 Entità sul Fronte** (i 5 slot; Rubyfront e Materie permanenti non contano, §6.2).
- Massimo **3 copie** della stessa carta nel mazzo (§3.1).
- Massimo **20 Flussi** (§3.2). Il Gettone Flusso è fuori dal limite: è un punto a parte.

## 10. Glossario

- **Entità** — carta con una razza (Umani o Auros). È il termine ufficiale: non si usa "creatura".
- **Rubyfront** — la bestia di ogni giocatore; parte nella Zona di Richiamo. Portare a zero i suoi PV (o distruggerne l'Unione) fa perdere il suo proprietario.
- **Flusso** — la risorsa per giocare le carte. Cresce +1 a turno, si ricarica a inizio turno, massimo 20.
- **Gettone Flusso** — gettone monouso da +1 Flusso dato a chi non inizia la partita, utilizzabile in qualsiasi momento; è fuori dal limite dei 20 Flussi.
- **Canalizzazione** — scartare una carta dalla mano per ottenere +1 Flusso per il turno in corso (max 1 a turno).
- **Fronte** — il campo di battaglia: 5 slot per le Entità; il Rubyfront schierato sta davanti agli slot, le Materie in gioco dietro.
- **Zona di Richiamo** — zona in cui parte il Rubyfront.
- **Potenza** — statistica unica di un'Entità. Modificabile da effetti, non scende mai sotto 0; a Potenza 0 l'Entità resta in campo.
- **Danno** — perdita di PV: possono subirlo solo Rubyfront e Unione. Le Entità non subiscono mai danno (le carte che le colpiscono usano diciture esplicite come "distruggi").
- **Materia** — carta magia/evento, giocabile solo se un tipo corrispondente è abilitato da una carta in campo. Tre comportamenti: normale, permanente, Reattiva.
- **Materia Reattiva** — Materia giocabile solo in Fase di Fronte; innesca la catena di risposta (risoluzione in ordine inverso).
- **Pre-Fronte** — finestra a inizio Fase di Fronte in cui l'avversario può giocare Materie Reattive prima della dichiarazione d'attacco.
- **Oggetto** — carta senza costo di Flusso che si assegna a un'Entità (max 1 per Entità).
- **Abilità** — parola chiave con regole predefinite da questo manuale (vedi §8.1).
- **Furia** — abilità (tipica del Rubyfront): prima di ogni azione della carta (attacco, blocco, contrattacco, Materie attribuite, abilità speciali — il movimento del Rubyfront e il flip verso l'Unione sono esclusi) serve un d20 ≥12; al fallimento l'azione salta, l'Entità si tappa e si perdono PV (Potenza dell'Entità, o il valore X sulla carta per il Rubyfront).
- **Slancio** — abilità: l'Entità può attaccare già nel turno in cui entra in campo (ignora l'attesa di evocazione).
- **Stasi** — abilità: se bloccando dovrebbe morire, resta invece sul campo permanentemente tappata.
- **Vendetta** — abilità: se blocca con Potenza superiore all'attaccante, l'attaccante muore anche senza contrattacco.
- **Attesa di evocazione** — un'Entità non può attaccare nel turno in cui entra in campo.
- **Evoluzione** — carta giocabile a costo ridotto se la sua Entità di base è in campo (la sostituisce; la base va negli scarti, l'Oggetto passa all'Evoluzione), o a costo pieno altrimenti.
- **Ritiro** — mandare volontariamente una propria Entità dal Fronte alla pila degli scarti, in Fase di Preparazione, gratis e senza limite di numero, per liberare slot o solo per toglierla di mezzo. **Non è una morte** (§6.2).
- **Morire / essere distrutta** — andare nella pila degli scarti dal campo, per una battaglia persa o per un effetto di distruzione. La base sostituita da un'Evoluzione e l'Entità **ritirata** (§6.2) **non muoiono**: lasciano il campo e vanno negli scarti senza innescare effetti di morte.
- **Contrattacco +N** — statistica di alcune Entità: quando bloccano possono sommare +N alla Potenza; se così superano l'attaccante, questo muore. Chi contrattacca viene coperto.
- **Tappata** — stato di un'Entità che ha attaccato o bloccato: non può né attaccare né bloccare; si stappa a inizio del turno successivo del proprietario.
- **Coperta** — stato di un'Entità che ha contrattaccato: non può fare nulla, è intoccabile da qualsiasi effetto o Materia, anche avversari (niente Oggetti né Evoluzioni; l'Oggetto già assegnato le rimane) e non abilita le sue Materie, per un giro completo; poi si scopre.
- **Fronte pronto** — dichiarazione con cui il giocatore di turno annuncia che attacca o passa.
- **Unione** — la seconda faccia della carta Rubyfront, sua evoluzione: si gioca flippando il Rubyfront in campo (requisiti sulla carta), recupera PV, resta in campo per sempre. Distruggerla (PV a 0) fa perdere il proprietario.
