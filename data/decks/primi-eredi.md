# Primi Eredi — mazzo aggro (40 carte)

> **Status:** DRAFT. Stessa lista di nomi dei Primi Eredi, riscritta da mazzo di
> controllo a mazzo aggro. Ogni numero è
> contato dai dati in `data/sets/srbf-001/cards/`.

## 1. Composizione

| | |
|---|---|
| Totale | 40 carte (1 Rubyfront · 21 Entità · 15 Materie · 3 Oggetti) |
| Progetti | 16, di cui **11 in tripla copia** |
| Costo medio | **2,03 Flussi** |
| Razza | Umani al 100% |
| Cima della curva | 4 Flussi (era 5) |
| Costo minimo | **1** — nessuna carta gratuita (§3.2) |

**Carte per costo** (numero di carte, non di copie):

| Costo | 1 | 2 | 3 | 4 | Rubyfront |
|---|---|---|---|---|---|
| Carte | 15 | 12 | 8 | 4 | 1 (2+1) |

Ogni costo del mazzo è sceso di 1, con **pavimento a 1 Flusso**: il taglio
comprime la curva verso il basso senza mai aggirare il ritmo del Flusso. Il mazzo
gioca una carta al turno 1, due al turno 2, e da lì in poi schiera più corpi di
quanti l'avversario possa rimuoverne.

## 2. L’idea: il Rubyfront non combatte, spinge

La bestia non attacca e non blocca (§3.1). In questo mazzo la sua unica funzione
è **passare Potenza agli Umani**, e ogni sua riga lo fa:

| | Faccia A — Rubifronte degli Abissi | Faccia B — Incarnazione dell’Abisso |
|---|---|---|
| Ingresso | Umani **+1 fino a fine turno**, a ogni schieramento | — |
| Continuo | — | — |
| Abilità | Spinta Abissale −2 PV: +2 a un Umano | Onda Portante −2 PV: +3 a un Umano |
| Abilità | Chiamata dal Fondo −4 PV: +1 e attacca subito | La Grande Marea −5 PV: **tutti** +2 e **non possono essere bloccate** |
| Furia | 2 (d20 ≥12, fallimento −2 PV) | **nessuna** |

Schierarla costa **2+1**: l'effetto d'ingresso è ripetibile, quindi rischierarla è
una giocata d'attacco a tutti gli effetti — finché il costo crescente lo consente.
È il vero limitatore del motore.

**Cinque carte migliorano solo perché la bestia è in campo:** Vigorcintura
(+1 → +2), Vessillo degli Eredi (+1 → +2), Vendicatrice d'Acciaio (+1 Potenza), più
le due Materie Distruttive, che senza di lei non sono nemmeno giocabili. Schierare
il Rubyfront non è mai una giocata neutra.

## 3. Il Nexus: si accende se stai già vincendo

**Requisito: il Rubyfront avversario ha perso almeno 6 PV.** Nessuna carta
richiesta, nessun Ritiro, nessuna Unica da proteggere — il vecchio requisito
passava da Adam ed era il punto di rottura dell'intero mazzo.

La soglia è **relativa** (PV persi, non PV residui): i PV stampati cambiano da
Rubyfront a Rubyfront, e una soglia assoluta avrebbe regalato il flip contro le
bestie fragili.

Sei PV sono tre Collere, o tre Chirurghi da Campo, o un singolo turno d’ondata:
il solo pacchetto di reach basta ad accenderla.
In pratica il flip cade fra il **quarto e il quinto turno**. Il Nexus non porta
effetti d'ingresso né continui: quello che cambia è che **perde la Furia** — le
sue due abilità non tirano più il d20 — e aggiunge la **Dinamica fino al 2°
grado**, quindi Secondo Impeto diventa giocabile anche senza Prima Lama.

## 4. Come si apre

| Turno | Flusso | Giocata tipo | PV avversari, se passa tutto |
|---|---|---|---|
| T1 | 1 | **Corriere** (1, Slancio) → attacca subito | −1 |
| T2 | 2 | **Vendicatrice** (1) + **Vigorcintura** (1) sul Corriere; attacca a 2 | −3 |
| T3 | 3 | **Rubyfront** (2 → Umani +1) + **Guardiano** (1); attaccano Corriere a 4 (Vigorcintura +2 con la bestia in campo) e Vendicatrice a 4 | −11 |
| T4 | 4 | Soglia dei 6 PV già superata → **flip**, poi **Onda Portante** (−2 PV) su un attaccante | letale |
| T5+ | 5+ | Se il Fronte avversario è pieno: **La Grande Marea** (−5 PV), nessuno può bloccare | letale |

Il flip **non porta più un colpo d'ingresso**: al turno 4 il guadagno è togliere
il d20 dalle abilità e sbloccare La Grande Marea, non due Potenza gratis. La corsa
è di conseguenza un filo più lenta di prima.

I numeri sono il tetto teorico (nessun blocco, nessuna rimozione): servono a
mostrare **dove cade la soglia del Nexus**, non a promettere una vittoria al
quarto turno. Con blocchi normali il flip slitta di un turno o due.

## 5. Cosa è cambiato, carta per carta

I **nomi sono quelli originali dei Primi Eredi**: è cambiato ciò che le carte
fanno, non come si chiamano.

- **Chirurgo da Campo:** curava 2 PV all'ingresso e 2 al Ritiro; ora **infligge
  1 PV secco** al Rubyfront avversario. Un mazzo che corre non compra tempo, lo
  spende — e «anche le bestie sanguinano» descriveva già questa carta.
- **Baluardo Corazzato:** stessa Potenza 3, restrizione **invertita** — prima non
  poteva attaccare, ora non può bloccare. Il muro diventa ariete.
- **Guardiano della Paratia:** il +2 scattava **in blocco**, ora scatta **in
  attacco**.
- **Archivista:** la pescata è diventata un **inno su corpo** (+1 alle altre tue
  Entità Umane). In aggro +1 a tutti vale più di una carta.
- **Corriere a Vapore:** via l'auto-Ritiro, resta lo Slancio. Mandare via i propri
  attaccanti era il motore del vecchio mazzo di controllo.
- **Rubifronte degli Abissi:** non indebolisce più il Fronte avversario, lo
  **scavalca potenziando gli Umani**. Pressione Abissale e Divorare sono
  diventate **Spinta Abissale** e **Chiamata dal Fondo**; Marea Crescente è
  **Onda Portante**; **La Grande Marea** conserva il nome ma non tappa più le
  Entità avversarie: rende le tue non bloccabili. Il potenziamento passa tutto
  per le **quattro abilità a costo PV** — nessun effetto d'ingresso sul Nexus,
  nessun inno permanente: erano le righe che facevano sfondare la textbox.
- **Le soglie di Requiem sono sparite.** Le quattro carte che contavano le carte
  in Requiem ora guardano **il Rubyfront in campo**: stessa idea di scala,
  agganciata al gesto che il mazzo vuole compiere comunque.
- **Adam, Il Primo** resta come corpo da 3 con Contrattacco +2 e unico
  accesso allo Zero, ma non è più la chiave di nulla.

## 5.1 Il muro dei cinque bloccanti, e come lo si scavalca

Il vincolo che decide come vince questo mazzo sta in §6.3: **un attacco bloccato
infligge zero danni, qualunque sia la Potenza.** Non esiste travolgere. I Fronti
sono capped a 5 Entità, il blocco è 1-contro-1, e chi blocca si stappa all'inizio
del proprio turno — quindi **un avversario con 5 bloccanti stappati assorbe 5
attaccanti ogni turno, indefinitamente.** Non lo si supera in numero: 5 è anche il
tuo tetto.

Da qui la funzione reale degli inni, che non è quella che sembra:

1. **Gli inni non spingono danno oltre il muro: lo smontano.** Con Archivista +
   Vessillo + la bestia in campo i corpi da 1 diventano 4, e in blocco normale
   **l'attaccante non muore mai** (§6.3). Attaccare ogni turno è quindi gratis e
   uccide un bloccante a turno senza perdere niente. È attrito, non velocità.
2. **Il reach scavalca il muro e basta a sé:** Chirurgo da Campo ×3 e Collera ×3
   fanno **9 PV** senza mai toccare il Fronte, e Lacerazione ×3 aggiunge 2 a turno
   ciascuna. Sono anche ciò che accende il Nexus a Fronte bloccato: la soglia è 6.
3. **La Grande Marea è l'unica carta che rende il muro irrilevante:** −5 PV, gli
   Umani prendono +2 e **non possono essere bloccati** in quel turno. È il motivo
   per cui il flip conta: sulla faccia A quell'abilità non esiste.

## 5.2 Il limite di copie a 3, e i sei tagli

Il manuale ammette ora **3 copie** della stessa carta (§3.1, era 2). Per un aggro
è la modifica più utile possibile: un mazzo che deve *ripetere* la stessa apertura
guadagna più da una terza copia della carta giusta che da un ventesimo progetto
diverso. **Undici progetti su sedici sono in tripla copia**, e il mazzo scende da
22 progetti a 16.

| Tagliata | Perché |
|---|---|
| **Emissario degli Eredi** | Era il tutore di Umani, cioè uno strumento di *consistenza*. Le triple copie sono consistenza: il tutore diventa il modo lento di fare ciò che ora fa il mazzo da sé. |
| **Vedetta del Perimetro** | Il suo +1 dura un turno; Archivista e Vessillo danno lo stesso bonus e lo tengono. Lo slot da 1 vale più speso su corpi che colpiscono. |
| **Veterana della Breccia** | Contrattaccando si **copre per un giro intero** (§6.3): un mazzo che attacca ogni turno non può permettersi un corpo fermo per tre fasi. |
| **Velo del Primo** | Non fa niente nel turno in cui lo giochi. |
| **Riflesso** ×2 | Reattiva puramente difensiva: chiedeva di **tenere Flusso aperto** nel turno avversario, che è l'istinto opposto a quello di un aggro (svuotare la mano e tappare tutto). |
| **Quiete** | Stesso motivo, ed era anche l'unica Reattiva che non fa nulla se l'avversario non gioca Reattive. |

Delle Reattive resta solo **Collera ×3**, che si giustifica perché è *danno*: la
lanci quando vuoi, anche come colpo finale nel tuo turno.

Restano **sei abilitatori di Dinamica I** (Guardiano ×3, Baluardo ×3), quindi Scatto e
Vessillo non perdono affidabilità. Lo Zero resta su Adam: con solo Assenza in
mazzo, **Genesi diventa un cerca-rimozione** — che è esattamente ciò che serve
contro un muro.

## 6. Debolezze e punti da sorvegliare

- **Lo slot da 1 resta il più pieno: 15 carte su 40.** Con un solo Flusso al primo
  turno ne giochi una sola, e la mano iniziale ne pesca troppe. Le triple copie
  hanno però cambiato la natura del problema: sono **cinque progetti in tripla**,
  quindi il mulligan cerca una curva, non un pezzo preciso.
- **Nessuna carta costa 0.** È una scelta di regola, non di mazzo (§3.2): il
  primo turno concede una giocata sola, e il Flusso resta il ritmo della partita.
- **La difesa non esiste più.** Con Veterana della Breccia, Riflesso e Velo del Primo
  fuori, resta **solo la Vendetta della Vendicatrice d'Acciaio**. È una scelta, non
  una dimenticanza: contro un altro aggro la corsa si vince o si perde, e chi si
  ferma a parare un turno la perde. Ma è la debolezza più grande del mazzo, e
  contro un avversario più veloce non c'è piano B.
- **Undici corpi su ventuno hanno Potenza base 1.** Senza un inno in campo il mazzo
  picchia per 1. Rimuovere Archivista e Vessillo lo sgonfia, e non c'è più nessuna
  protezione per gli inni.
- **Gli inni sono bersagli.** Archivista è un'Entità da Potenza 1, il Vessillo è una
  permanente appesa alla Dinamica I. Chi li rimuove sgonfia mezzo mazzo, e con il
  Velo del Primo fuori dal mazzo non c'è più nessuna protezione.
- **La Distruttiva resta ostaggio della bestia.** Lacerazione decade se il
  Rubyfront rimbalza in Zona di Richiamo (§7.2): pre-flip va giocata solo quando
  la bestia non rischia il colpo, o si aspetta il Nexus, che non torna mai indietro.
- **Furia anche in aggro.** Ogni Spinta Abissale e ogni Chiamata dal Fondo passa da un d20
  ≥12: fallisce il **55%** delle volte, costa 2 PV e non restituisce nulla. La
  Incarnazione dell’Abisso esiste anche per togliere di mezzo quel tiro.

## 7. Due estensioni del registro

Questo mazzo ha richiesto due valori nuovi in `data/vocabulary.json`, entrambi
impegni per l'engine:

- **`on_attack`** — un set aggro non può esprimere il proprio innesco più comune
  senza di esso (Guardiano della Paratia).
- **`health_lost_at_least`** — per un requisito di Nexus che regga con qualsiasi
  valore di PV stampato.
