# Rubyfront — Manuale di Gioco

> **Stato:** BOZZA — in fase di stesura.
> Questo documento è la fonte di verità delle regole. L'engine di gioco verrà implementato seguendo fedelmente questo manuale.

---

## 1. Panoramica

- **Nome del gioco:** Rubyfront
- **Giocatori:** da 2 a 6 (il caso standard descritto in questo manuale è l'1 contro 1)
- **Razze:** al momento due — **Umani** e **Auros** (esseri immortali)
- **Il Rubyfront:** la bestia al centro del gioco, da cui il gioco prende il nome
- **Durata media di una partita:** *(da definire)*

### 1.1 La regola d'oro

**La carta vince sempre sulle regole del gioco.** Se il testo di una carta contraddice una regola di questo manuale, prevale il testo della carta.

## 2. Obiettivo del gioco

Ogni giocatore ha il **proprio Rubyfront** nel mazzo (vedi §3.1), che inizia la partita nella Zona di Comando.

Si vince in uno di questi due modi:

1. portando a **zero i Punti Vita (PV) del Rubyfront avversario**, oppure
2. **distruggendo l'Unione** del Rubyfront avversario, cioè portando a zero i PV dell'Unione, se l'avversario l'ha giocata (vedi §3.1, "L'Unione").

## 3. Materiale di gioco

### 3.1 Il mazzo

- Ogni giocatore ha un **mazzo personale di 40 carte, Rubyfront incluso**. Il mazzo contiene tutte le carte del giocatore: Entità, Materie e Oggetti (non esistono riserve separate).
- Il **Rubyfront non si pesca mai**: all'inizio della partita viene messo direttamente nella **Zona di Comando** (vedi §5).

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

**Stato all'ingresso:**

- Se giocata **come evoluzione** (sostituendo la base in campo): entra **fresca come nuova** — non eredita il tap della base — e **può attaccare subito**, senza attesa di evocazione (di fatto continua un'Entità già in campo).
- Se giocata **normalmente** (a costo pieno, senza base in campo): è un'Entità appena evocata a tutti gli effetti — **attesa di evocazione normale**.
- **Un'Entità coperta non può essere sostituita da un'Evoluzione**: la copertura vieta ogni azione, compreso l'essere evoluta (coerente con §6.3, "l'Entità coperta non può fare nulla"). Un'Entità semplicemente tappata, invece, può essere evoluta.

#### Carte Oggetto

Gli **Oggetti** sono carte che si **assegnano a un'Entità**:

- **non hanno mai un costo di Flusso**;
- ogni Entità può avere **al massimo un Oggetto** assegnato;
- si assegnano **solo alle proprie Entità**, salvo diversa indicazione sulla carta;
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
- **Descrizione** con l'**effetto che si risolve quando entra in campo** dalla Zona di Comando — **a ogni schieramento**, non solo il primo.
- **Abilità speciali** — per essere usate **costano PV**.

Il Rubyfront è **attaccabile anche mentre si trova in Zona di Comando**: i suoi PV sono un bersaglio valido dall'inizio alla fine della partita. Abilità (principale e speciali) e Materie, però, sono **utilizzabili solo quando è in campo**: schierarlo serve a sbloccarle.

#### Costo di schieramento crescente

Il costo di Flusso del Rubyfront è indicato nel formato **`base+incremento`** (es. `2+1`): il **primo schieramento** costa il valore base; ogni schieramento successivo costa **l'incremento in più** rispetto al precedente.

*Esempio: costo `2+1` → primo schieramento 2 Flussi, poi 3, poi 4, e così via.*

#### Ritorno in Zona di Comando

Il Rubyfront schierato **torna in Zona di Comando** nei seguenti casi:

- **automaticamente, ogni volta che un attacco "passa"** e lo colpisce: il Rubyfront **subisce il danno ai PV e in più torna in Zona di Comando**;
- **volontariamente**, per scelta del proprietario.

Ogni ritorno in Zona di Comando fa scattare l'aumento del costo di rischieramento (vedi sopra).

**Finestra di movimento:** il proprietario può muovere il Rubyfront (schierarlo o richiamarlo, anche **più volte nello stesso turno**) durante tutto il proprio turno, dalla **Fase di Preparazione** fino alla **fine del turno** — anche dopo aver finito di attaccare (il Rubyfront non attacca: la sua funzione è usare abilità a costo PV e Materie, quindi muoverlo a fine turno è legittimo). Ogni rischieramento paga comunque il costo crescente.

#### Ruolo del Rubyfront in campo

Il Rubyfront, quando entra in campo, **non attacca** e **non blocca** (salvo diversa indicazione sulla carta — la regola d'oro §1.1 vale sempre). Il senso di schierarlo è:

- usare le sue **abilità speciali** (pagandone il costo in PV) — attivabili **liberamente, solo nel proprio turno**, sia in Fase di Preparazione che in Fase di Fronte. La stessa abilità è attivabile **più volte per turno**, finché i PV bastano. Si risolvono **senza possibilità di risposta** (la catena vale solo per le Reattive). **Attenzione:** pagare PV può portare a 0 — e a 0 PV si perde immediatamente la partita;
- usare le **Materie** a lui disponibili;
- **triggerare l'Unione**, quando i requisiti sono soddisfatti (vedi "L'Unione", più sotto).

I PV sono quindi una risorsa a doppio taglio: sono la condizione di sconfitta, ma anche la valuta con cui il Rubyfront paga le proprie abilità speciali.

#### L'Unione

La carta del Rubyfront ha **due facce**: una è il **Rubyfront**, l'altra è la sua **Unione** — l'evoluzione del Rubyfront.

- **Come si gioca:** si **flippa** la carta del Rubyfront sull'altra faccia. Requisiti e condizioni:
  - i **requisiti** per il flip sono scritti sulla carta stessa;
  - il **Rubyfront dev'essere in campo** (non si flippa dalla Zona di Comando);
  - soddisfatti i requisiti, il flip si può fare in qualsiasi momento del proprio turno, **dalla Fase di Preparazione fino alla fine del turno** (stessa finestra del movimento del Rubyfront, §3.1), e non ha altri costi.
- **PV recuperati:** la faccia dell'Unione indica un **recupero di PV** (es. `+5`): l'Unione parte con i **PV rimasti al Rubyfront più il recupero indicato**.
- **Permanenza:** l'Unione **sostituisce il Rubyfront** e **rimane in campo per tutta la durata della partita**, salvo diverse indicazioni sulle carte. **Non torna mai in Zona di Comando**: quando un attacco le passa, subisce il danno e resta in campo.
- **Com'è fatta:** ha la stessa struttura del Rubyfront — PV, **Materie disponibili proprie** (stampate sulla sua faccia) e **abilità speciali**, chiaramente **più potenti**. Come il Rubyfront, **non attacca e non blocca** (salvo diversa indicazione sulla carta).
- **Distruzione = sconfitta:** portare a **0 i PV dell'Unione** significa distruggerla — è la condizione di vittoria n. 2 (§2).
- **Regola generale:** dopo il flip, **ogni regola di questo manuale che nomina il Rubyfront si applica identica all'Unione** (bersaglio degli attacchi, danni da attacchi non bloccati, abilità speciali solo nel proprio turno, Materie abilitate...), salvo dove diversamente indicato.

### 3.2 Il Flusso

Il **Flusso** è la risorsa con cui si pagano le carte, al posto del classico mana. A differenza del mana:

- **non esistono carte Terra** (o simili) da giocare per generare risorse;
- ogni giocatore ha un proprio valore di Flusso massimo che **cresce automaticamente di +1 all'inizio di ogni proprio turno, a partire dal secondo**;
- entrambi i giocatori **partono con 1 di Flusso** (1° turno: 1, 2° turno: 2, 3° turno: 3...);
- il Flusso speso **si ricarica interamente all'inizio del proprio turno**;
- nel **turno avversario** si ha a disposizione il Flusso **non speso** rimasto dal proprio turno (es. per giocare Materie Reattive in difesa): tenersi Flusso da parte è una scelta strategica;
- **limite assoluto: 20 Flussi.** Il Flusso non può mai superare 20 in nessun modo: anche canalizzando (vedi §6.1) a 20 Flussi, non si arriva a 21.

#### Gettone Flusso

Il giocatore che **non** inizia la partita riceve un **Gettone Flusso**: rappresenta **1 punto di Flusso extra**, è **monouso** e può essere utilizzato **in qualsiasi momento della partita** (compensa lo svantaggio di giocare per secondo).

## 4. Preparazione della partita

1. **Chi inizia:** se entrambi i giocatori sono d'accordo, possono **scegliere liberamente** chi inizia. Altrimenti entrambi tirano un **d20**: chi ottiene il numero più alto inizia la partita; in caso di **pareggio si ritira**.
2. **Gettone Flusso:** il giocatore che non inizia riceve il Gettone Flusso (vedi §3.2).
3. **Rubyfront:** ogni giocatore mette il proprio Rubyfront nella **Zona di Comando** (vedi §5).
4. **Mano iniziale:** prima che inizi il primo turno, entrambi i giocatori **pescano 6 carte**.
5. **Mulligan:** ciascun giocatore può fare mulligan **fino a 3 volte**: rimescola **tutta la mano** nel mazzo e pesca **6 nuove carte**, senza penalità. Dopo il terzo mulligan è **costretto ad accettare la mano**.
6. Entrambi i giocatori partono con **1 di Flusso**.

## 5. Zone di gioco

Il campo di ogni giocatore è formato da:

- **Fronte** — il campo di battaglia.
- **Mazzo** — le carte da pescare.
- **Pila degli scarti** — le carte scartate/distrutte. È **pubblica**: consultabile da entrambi i giocatori in qualsiasi momento.
- **Zona di Comando** — il Rubyfront si posiziona e **parte sempre qui**, salvo diverse indicazioni sulla carta.

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
- **assegnare Oggetti** (carte Oggetto) alle Entità — massimo **un Oggetto per Entità**.

**Non c'è limite al numero di carte giocabili** nella fase: il solo vincolo è il Flusso disponibile (gli Oggetti, che sono gratuiti, non hanno alcun limite di giocata).

Sul Fronte si possono avere **al massimo 5 carte contemporaneamente** tra **Entità e Materie permanenti** (che contano entrambe nel limite), **Rubyfront escluso** dal conteggio.

**Attesa di evocazione:** un'Entità appena entrata in campo **non può attaccare nel turno in cui entra**; deve aspettare il turno successivo. Può però già **bloccare** nel turno avversario che segue.

### 6.3 Fase di Fronte (combattimento)

Terminata la Fase di Preparazione, il giocatore di turno **dichiara di entrare in Fase di Fronte**. La fase si svolge in questo ordine:

1. **Pre-Fronte:** dichiarata l'apertura del Fronte, **l'avversario può giocare Materie Reattive**. Il giocatore di turno può rispondere con la catena di risposta (§7.2).
2. **Finestra Reattive del giocatore di turno:** conclusa la Pre-Fronte, il giocatore di turno può giocare le proprie Materie Reattive (l'avversario può rispondere in catena, §7.2).
3. **Fronte pronto — dichiarazione dell'attacco (o passo):** il giocatore di turno **seleziona tutte le Entità con cui attacca** e le dichiara **in un'unica ondata** — oppure dichiara che passa. **Dopo la dichiarazione non si possono più giocare Reattive**, con un'unica eccezione: le Reattive difensive usate come blocco (vedi punto 4).
4. **Dichiarazione dei blocchi:** il difensore, vista l'intera ondata, **assegna i propri blocchi**. Ogni attaccante può essere bloccato da:
   - una **propria Entità** (sfide 1 contro 1: un bloccante per attaccante, ogni Entità blocca una sola volta; chi blocca si tappa, chi contrattacca si copre), **oppure**
   - una **Materia Reattiva il cui testo permette di bloccare** (pagandone il costo di Flusso): la Reattiva sostituisce il bloccante per quell'attacco. Come ogni Reattiva, **apre la catena di risposta** (§7.2): l'attaccante può rispondere.
5. **Risoluzione:** le battaglie si risolvono una alla volta, **nell'ordine di dichiarazione degli attaccanti** (confronto di Potenza per ogni coppia; gli attacchi non bloccati infliggono danni al Rubyfront). *Eccezione per le Entità con Furia: il loro d20 si tira al momento della risoluzione, e solo se passa il difensore dichiara il blocco per quell'attacco (§8.1, "Furia").*
6. **Fine del turno.**

**Movimento del Rubyfront:** promemoria — può essere schierato o richiamato in **qualsiasi momento del proprio turno**, anche dopo gli attacchi, fino alla fine del turno (vedi §3.1, "Finestra di movimento").

#### Regole di attacco

- Ogni Entità **attacca una sola volta per turno**.
- Un'Entità entrata in campo in quel turno **non può attaccare** (attesa di evocazione, §6.2).
- **Si attacca sempre il Rubyfront avversario**, mai le altre Entità direttamente.
- Un **attacco non bloccato** infligge al Rubyfront danni pari alla **Potenza dell'attaccante** (i suoi PV scendono di altrettanto).

#### Blocco

- Il **difensore può scegliere di bloccare** con le proprie Entità, decidendo se far passare o meno l'attacco al Rubyfront.
- Anche le **Materie Reattive possono bloccare attacchi**, se il testo della carta lo prevede (e c'è il Flusso per pagarle): al momento della dichiarazione dei blocchi, il difensore può assegnare a un attaccante una Reattiva-blocco **al posto di una propria Entità** (§6.3, punto 4).
- La sfida è sempre **1 contro 1**: ogni attaccante può essere bloccato da **una sola Entità**, e ogni Entità può **bloccare una sola volta per turno**.
- **Quando un'Entità blocca viene tappata.**

#### Risoluzione di una battaglia (attaccante vs bloccante)

Si confrontano le **Potenze**:

- Se la Potenza del bloccante è **inferiore** a quella dell'attaccante → il bloccante **muore** (va nella pila degli scarti), ma **l'attacco è comunque bloccato** (il Rubyfront non subisce danno).
- Se la Potenza del bloccante è **pari o superiore** → l'attacco è bloccato e il bloccante **non muore**.
- L'attaccante, in un blocco normale, **non muore mai**.

*Esempio: un'Entità con Potenza 4 attacca; il difensore blocca con un'Entità di Potenza 3 → il bloccante muore, l'attacco non passa. Se il bloccante avesse Potenza 4 o più, non morirebbe nessuno.*

#### Contrattacco

Alcune Entità hanno la statistica **Contrattacco +N**. Quando bloccano, possono **scegliere di contrattaccare**: la loro Potenza diventa `Potenza + N` per quel confronto, e l'Entità viene **coperta** (anziché tappata) — verrà **scoperta più avanti**.

Risoluzione del contrattacco (totale = Potenza + N contro Potenza dell'attaccante):

- **Totale superiore** → **l'attaccante muore**; il contrattaccante è in salvo.
- **Totale pari** → l'attaccante **non** muore (serve necessariamente superarlo), ma il pareggio **mette in salvo** il contrattaccante.
- **Totale inferiore** → il contrattaccante **muore** e va nella pila degli scarti, come in un blocco normale.

*Esempio: attaccante con Potenza 4; bloccante con Potenza 3 e Contrattacco +2 sceglie di contrattaccare → 3+2 = 5 > 4: l'attaccante muore, il bloccante sopravvive ma resta coperto.*

#### Stati delle Entità: tappata e coperta

- **Tappata** (per aver bloccato): l'Entità si **stappa all'inizio del turno successivo del proprietario**, e può attaccare normalmente. Bloccare quindi non costa nulla nel turno seguente: il tap segna solo che l'Entità ha già bloccato in quel turno di difesa.
- **Coperta** (per aver contrattaccato): l'Entità coperta **non può fare nulla** finché è coperta. La copertura dura **un giro completo**:

  1. *Turno avversario (T):* l'Entità contrattacca e viene **coperta**.
  2. *Turno del proprietario (T+1):* non può attaccare.
  3. *Turno avversario (T+2):* non può bloccare.
  4. *Turno del proprietario (T+3):* viene **scoperta** e può di nuovo agire.


### 6.4 Fine del turno

Non si possono avere **più di 7 carte in mano**: alla fine del proprio turno, le carte in eccesso vanno **scartate**.

## 7. Le Materie

Le **Materie** sono le carte magia/evento del gioco. Non si possono giocare liberamente: una carta Materia è giocabile **solo se in campo c'è una carta che ha quel tipo di Materia abilitato**.

- Le Materie **hanno un costo di Flusso**, come le Entità.
- Ogni Entità riporta i **tipi di Materia che abilita** (§3.1). Dal momento in cui l'Entità entra in campo, il suo proprietario può giocare le carte Materia dei tipi abilitati.
- Anche il **Rubyfront** ha le sue Materie abilitanti, ma valgono **solo quando è schierato in campo**: finché resta in Zona di Comando non abilita nulla (§3.1).
- L'abilitazione va **mantenuta**: se l'ultima carta in campo che abilitava un tipo di Materia lascia il campo, il giocatore **perde immediatamente l'accesso** a quel tipo.

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
- **Conta nel limite delle 5 carte sul Fronte** (§6.2), insieme alle Entità.
- **Decade insieme all'abilitazione:** se il giocatore perde l'accesso al tipo di Materia (l'ultima carta abilitante lascia il campo), la permanente va nella **pila degli scarti**.
- Se possa essere distrutta o rimossa da effetti **dipende dalle carte**.

#### Materia Reattiva

- Si gioca **solo in Fase di Fronte**. Possono essere attacchi, potenziamenti ad attacchi e difese, ma anche **effetti particolari di qualsiasi natura**.
- **Nessuno può intervenire in qualsiasi momento a piacere:** le Reattive si giocano solo nelle finestre previste.
- **Finestra dell'avversario (Pre-Fronte):** all'apertura della Fase di Fronte, prima della dichiarazione d'attacco, l'avversario può giocare Reattive (§6.3).
- **Finestra del giocatore di turno:** dopo la Pre-Fronte e prima di dichiarare Fronte pronto, il giocatore di turno può giocare Reattive.
- **Dopo la dichiarazione dell'attacco non si giocano più Reattive**, con un'unica eccezione: le **Reattive-blocco** del difensore, assegnate come blocco a un attaccante al posto di un'Entità (§6.3). Tutti i potenziamenti, invece, vanno giocati **prima** della dichiarazione d'attacco, "in anticipo": sono una scommessa per entrambi.
- In tutte le finestre, chi subisce la Reattiva può **rispondere** (vedi catena di risposta).

#### Catena di risposta

**Regola universale:** le finestre stabiliscono chi può *iniziare* una Reattiva; ma **ogni volta che un giocatore lancia una Reattiva, l'avversario può sempre rispondere**.

- Si può rispondere **solo con Materie Reattive**.
- Chi ha lanciato può a sua volta **controrispondere**, e così via: la catena prosegue finché i giocatori possono e vogliono aggiungere Reattive.
- Quando nessuno aggiunge più nulla, la catena **si risolve in ordine inverso**: l'**ultima** Materia giocata si risolve **per prima**, poi via via indietro fino alla prima.

## 8. Abilità ed effetti delle carte

### 8.1 Abilità (parole chiave)

Le **abilità** sono **parole chiave con regole predefinite** da questo manuale: quando una carta riporta un'abilità, ne applica le regole così come sono, senza bisogno di testo aggiuntivo sulla carta.

L'**abilità principale** del Rubyfront funziona allo stesso modo: è una parola chiave, attiva dal momento in cui entra in campo (§3.1).

#### Elenco delle abilità

##### Furia

Una carta con **Furia** non può essere **controllata direttamente** dal suo proprietario. Furia compare **principalmente sul Rubyfront** (come abilità principale), ma può averla anche un'Entità. Il principio è unico:

**Prima di qualsiasi azione** che coinvolga la carta con Furia, il proprietario **lancia un d20**. Vale per *ogni* azione, nessuna esclusa: attaccare, bloccare, contrattaccare, usare una Materia annessa alla carta, e — nel caso del Rubyfront — anche schierarsi, tornare in Zona di Comando o usare un'abilità speciale.

Esito del tiro:

- con **12 o più**, l'azione **va a buon fine**;
- con **11 o meno**, l'azione **fallisce** e si perdono PV: per un'**Entità**, il Rubyfront del proprietario perde PV **pari alla Potenza** dell'Entità; per il **Rubyfront/Unione**, si perde il **valore X indicato sulla carta** accanto a Furia.

Dettagli sul fallimento (l'azione salta, i costi già pagati restano pagati):

- **attacco fallito:** annullato; conta comunque come l'attacco del turno dell'Entità;
- **blocco/contrattacco fallito:** la difesa non avviene e **l'attacco passa** (l'Entità non viene tappata né coperta);
- **Materia fallita:** va nella **pila degli scarti** e il Flusso resta speso;
- **movimento/abilità del Rubyfront falliti:** il Rubyfront resta dov'è / l'abilità non si risolve.

**Tempistica del tiro in attacco:** l'Entità con Furia si dichiara nell'ondata normalmente (§6.3), ma il suo blocco **non** si assegna con gli altri: il **d20 si tira quando arriva il momento di risolvere il suo attacco**, e solo **se il tiro passa** il difensore dichiara il blocco per quell'attacco. Se fallisce, non c'è battaglia: nessun bloccante viene impegnato.

Le Materie **avversarie** che bersagliano una carta con Furia funzionano normalmente, senza tiro: il d20 riguarda solo le azioni del proprietario.

##### Slancio

Un'Entità con **Slancio** può **attaccare già nel turno in cui entra in campo**, ignorando l'attesa di evocazione (§6.2).

##### Stasi

Quando un'Entità con **Stasi** blocca e **dovrebbe morire** (Potenza inferiore all'attaccante), invece di morire **rimane sul campo, permanentemente tappata**: non si stapperà mai più e non potrà più né attaccare né bloccare. Continua a occupare uno slot del Fronte, ma essendo ancora in campo **continua ad abilitare le sue Materie**.

Stasi salva anche dal **contrattacco fallito**: se l'Entità contrattacca e il suo totale resta inferiore alla Potenza dell'attaccante, invece di morire finisce anch'essa **permanentemente tappata** (lo stato di stasi sostituisce la copertura).

Un'Entità in stasi è a tutti gli effetti *tappata* (non coperta): può quindi essere **sostituita da un'Evoluzione** (§3.1), che entra fresca — è il modo per "riscattare" un'Entità pietrificata.

##### Vendetta

Quando un'Entità con **Vendetta** blocca e la sua **Potenza supera** quella dell'attaccante, **l'attaccante muore** anche senza contrattacco. (Nel blocco normale, l'attaccante non morirebbe mai — §6.3.)

L'Entità con Vendetta segue per il resto le normali regole di blocco: viene tappata, e non subisce la copertura (non sta contrattaccando).

### 8.2 Effetti

Gli **effetti** sono il testo nella descrizione della carta (es. l'effetto che si risolve quando la carta entra in campo). A differenza delle abilità, non sono parole chiave: fanno ciò che il testo dice (regola d'oro, §1.1).

#### Ordine di risoluzione degli effetti simultanei

Quando un evento innesca **più effetti nello stesso momento**, si risolvono in quest'ordine:

1. **Prima la protagonista dell'evento:** la carta a cui è successo qualcosa (è entrata in campo, è morta...) risolve per prima il proprio effetto.
2. **Poi gli altri effetti innescati, dalla carta più giovane alla più vecchia:** si risolve prima l'effetto della carta scesa in campo **più di recente**, poi via via indietro fino alla più vecchia (come una pila: le carte si impilano nell'ordine in cui scendono e si risolvono dalla cima).

L'ordine vale anche tra carte di giocatori diversi: fa fede il momento di discesa in campo, che è unico e condiviso. Nessun giocatore sceglie mai l'ordine: è sempre determinato dallo stato del campo.

*Esempio: gioco un'Entità con effetto d'ingresso "scarta una carta" mentre ho in campo due permanenti — la più vecchia dice "quando giochi un'Entità, pesca una carta", la più recente "quando giochi un'Entità, infliggi 1 danno". Ordine: prima l'Entità entrata (scarto), poi la permanente più giovane (danno), infine la più vecchia (pesco).*

## 9. Regole speciali e casi limite

### 9.1 Esaurimento del mazzo

Se il mazzo finisce, **si perde**: il giocatore pesca l'**ultima carta** del mazzo, gioca **quel turno per intero**, e al termine del turno **ha perso la partita**.

L'ultimo turno è una vera ultima possibilità: se durante quel turno il giocatore soddisfa una condizione di vittoria (PV del Rubyfront avversario a 0 o Unione avversaria distrutta), **vince lui** — la sconfitta per esaurimento scatta solo a fine turno.

### 9.2 Pareggio

Il pareggio esiste, ma **solo di comune accordo**: dev'essere **dichiarato da entrambi i giocatori**. Non esistono pareggi "automatici".

### 9.3 Riepilogo dei limiti

- Massimo **7 carte in mano** (l'eccesso si scarta a fine turno, §6.4).
- Massimo **5 carte sul Fronte** tra Entità e Materie permanenti, Rubyfront escluso (§6.2).
- Massimo **3 copie** della stessa carta nel mazzo (§3.1).
- Massimo **20 Flussi** (§3.2).

## 10. Glossario

- **Entità** — carta con una razza (Umani o Auros). È il termine ufficiale: non si usa "creatura".
- **Rubyfront** — la bestia di ogni giocatore; parte nella Zona di Comando. Portare a zero i suoi PV (o distruggerne l'Unione) fa perdere il suo proprietario.
- **Flusso** — la risorsa per giocare le carte. Cresce +1 a turno, si ricarica a inizio turno, massimo 20.
- **Gettone Flusso** — gettone monouso da +1 Flusso dato a chi non inizia la partita, utilizzabile in qualsiasi momento.
- **Canalizzazione** — scartare una carta dalla mano per ottenere +1 Flusso per il turno in corso (max 1 a turno).
- **Fronte** — il campo di battaglia.
- **Zona di Comando** — zona in cui parte il Rubyfront.
- **Potenza** — statistica unica di un'Entità.
- **Materia** — carta magia/evento, giocabile solo se un tipo corrispondente è abilitato da una carta in campo. Tre comportamenti: normale, permanente, Reattiva.
- **Materia Reattiva** — Materia giocabile solo in Fase di Fronte; innesca la catena di risposta (risoluzione in ordine inverso).
- **Pre-Fronte** — finestra a inizio Fase di Fronte in cui l'avversario può giocare Materie Reattive prima della dichiarazione d'attacco.
- **Oggetto** — carta senza costo di Flusso che si assegna a un'Entità (max 1 per Entità).
- **Abilità** — parola chiave con regole predefinite da questo manuale (vedi §8.1).
- **Furia** — abilità (tipica del Rubyfront): prima di *qualsiasi* azione della carta serve un d20 ≥12; al fallimento l'azione salta e si perdono PV (Potenza dell'Entità, o il valore X sulla carta per il Rubyfront).
- **Slancio** — abilità: l'Entità può attaccare già nel turno in cui entra in campo (ignora l'attesa di evocazione).
- **Stasi** — abilità: se bloccando dovrebbe morire, resta invece sul campo permanentemente tappata.
- **Vendetta** — abilità: se blocca con Potenza superiore all'attaccante, l'attaccante muore anche senza contrattacco.
- **Attesa di evocazione** — un'Entità non può attaccare nel turno in cui entra in campo.
- **Evoluzione** — carta giocabile a costo ridotto se la sua Entità di base è in campo (la sostituisce; la base va negli scarti, l'Oggetto passa all'Evoluzione), o a costo pieno altrimenti.
- **Contrattacco +N** — statistica di alcune Entità: quando bloccano possono sommare +N alla Potenza; se così superano l'attaccante, questo muore. Chi contrattacca viene coperto.
- **Tappata** — stato di un'Entità che ha bloccato; si stappa a inizio del turno successivo del proprietario.
- **Coperta** — stato di un'Entità che ha contrattaccato: non può fare nulla per un giro completo, poi si scopre.
- **Fronte pronto** — dichiarazione con cui il giocatore di turno annuncia che attacca o passa.
- **Unione** — la seconda faccia della carta Rubyfront, sua evoluzione: si gioca flippando il Rubyfront in campo (requisiti sulla carta), recupera PV, resta in campo per sempre. Distruggerla (PV a 0) fa perdere il proprietario.

---

## Appendice A — Elenco carte

| Nome | Tipo | Costo | Attributi | Effetto |
|------|------|-------|-----------|---------|
|      |      |       |           |         |
