# Primi Eredi — mazzo aggro (40 carte + Rubyfront)

> **Status:** DRAFT. Allineato alla lista del designer del 4 agosto 2026. Ogni
> numero è contato dai dati in `data/sets/srbf-001/cards/`.

## 1. Composizione

| | |
|---|---|
| Totale | 40 carte più il Rubyfront (21 Entità · 16 Materie · 3 Oggetti) |
| Progetti | 16, di cui **11 in tripla copia** |
| Razza | Umani al 100% |
| Costo minimo | **1** — nessuna carta gratuita (§3.2) |

**Carte per costo** (numero di carte, non di copie):

| Costo | 1 | 2 | 3 | 4 | Rubyfront |
|---|---|---|---|---|---|
| Carte | 12 | 9 | 14 | 4 | 1 (4 fisso) |

La curva è a due gobbe: dodici carte da 1 Flusso per aprire e quattordici da 3
per il corpo centrale della partita, dove cadono sia la bestia sia le carte che
chiudono il piano.

## 2. Il Rubifronte del Patto

Costo **4 fisso**: la base non ha incremento, quindi ogni rischieramento costa 4
e il rimbalzo in Zona di Richiamo non fa mai salire il prezzo. Con 21 PV la
bestia può permettersi di rientrare.

| | Faccia A — Rubifronte del Patto | Faccia B — Incarnazione del Patto |
|---|---|---|
| Statico | Vedi la prima carta del mazzo e **giochi da lì le tue Entità Umane** | identico |
| Abilità | −2 PV Comando dal Fronte: un'Entità dal tuo lato del Fronte ha Slancio | **+1 PV** Ordine del Fronte: **tutte** le Entità dal tuo lato del Fronte hanno Slancio |
| Abilità | −3 PV Onda Portante: Umani +1 Potenza | −5 PV Assalto Coordinato: fino a 2 Umani +2 Potenza |
| Abilità | −5 PV Richiamo del Patto: cerca un Umano da ≤3 | −7 PV Grande Marea: Umani +1 Potenza e non bloccabili da Potenza superiore |
| Furia | 1 | **nessuna** |

Due cose la distinguono da qualsiasi Rubyfront precedente del set:

- **L'effetto statico è il motore di carte del mazzo.** Con dodici carte da 1
  Flusso, giocare dalla cima vale quasi una pescata a turno senza pescare.
- **Le abilità danno Slancio.** Comando dal Fronte (e Ordine del Fronte dopo il
  flip, che addirittura restituisce 1 PV) fa attaccare subito ciò che è appena
  entrato dalla cima del mazzo: il motore di carte e il motore di tempo sono la
  stessa carta.

## 3. Il Nexus: tre Umani e una Materia Zero

**Requisito: controlla almeno 3 Entità Umane e scarta una carta Materia Zero,
solo nella tua Fase di Preparazione.**

È un requisito a due chiavi, e il mazzo possiede una sola copia della seconda:
**Assenza**. Non c'è più un modo di cercarla (Adam ha perso Genesi nella rev. 2):
va pescata, e il Rubifronte che guarda la cima del mazzo aiuta a sapere quando
arriva. La decisione ricorrente è se spendere Assenza come rimozione o
conservarla come carburante del flip.

La soglia delle 3 Entità Umane è **la stessa di Lacerazione**: le due cose
maturano insieme, e il turno in cui il Fronte arriva a tre corpi è il turno in
cui il mazzo cambia marcia.

## 4. Le abilitazioni

La Dinamica di 2° grado passa da **Adam**, che è Unica: una copia sola apre
Secondo Impeto prima del flip, e dopo il flip subentra la faccia Nexus. Resta la
dipendenza più sottile del mazzo — perdere Adam significa perdere insieme lo
Zero e Secondo Impeto (il flip no: Assenza si può scartare anche senza Adam).

| Tipo | Carte | Abilitatori nel mazzo |
|---|---|---|
| Dinamica I | Scatto ×3, Vessillo ×3 | Guardiano ×3, Baluardo ×3 |
| Dinamica II | Secondo Impeto ×2 | Adam, Nexus |
| Distruttiva I | Collera ×3 | Rubyfront, Prima Lama ×3 |
| Distruttiva II | Lacerazione ×3 | Rubyfront, Nexus |
| Zero | Assenza | Adam |

## 5. Come si apre

| Turno | Flusso | Giocata tipo |
|---|---|---|
| T1 | 1 | **Corriere a Vapore**: attacca subito con Slancio |
| T2 | 2 | **Guardiano** + **Vendicatrice**, oppure **Baluardo** |
| T3 | 3 | **Vessillo** o il terzo corpo: il Fronte arriva a tre Umani |
| T4 | 4 | **Rubifronte del Patto**: Vendicatrice e Vigorcintura salgono, Comando dal Fronte dà Slancio all'Umano giocato dalla cima |
| T5+ | 5+ | Con 3 Umani e una Materia Zero in mano, **flip in Preparazione** |

Il Guardiano della Paratia entra tappato, quindi il turno in cui scende non
difende né attacca: è il prezzo di un 2 di Potenza a 1 Flusso che abilita la
Dinamica. Secondo Impeto lo stappa se ha già attaccato, e il Chirurgo toglie
un bloccante nel turno in cui si affonda.

## 6. Debolezze

- **Una sola Materia Zero.** Assenza è Unica e il flip la consuma. Se finisce
  nell'Abisso per altre vie, il Nexus resta chiuso per il resto della partita.
- **Nessuna difesa reattiva.** Fuori dal mazzo sono rimaste Riflesso, Quiete e
  Velo del Primo: l'unica interazione nel turno avversario è Collera, che è danno
  e non protezione.
- **Molti corpi da Potenza 1 o 2 di base.** Il mazzo dipende dai moltiplicatori —
  Vigorcintura, Vessillo, Scatto e la presenza della bestia.
- **Tutto lo Zero e la Dinamica II su una carta sola:** Adam. È il punto di rottura del mazzo (§4).
