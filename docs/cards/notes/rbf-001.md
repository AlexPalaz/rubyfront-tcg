# Rubyfront of the Abyss
*IT: Rubifronte degli Abissi*

> **Status:** DRAFT — first card of the game. Balance values are provisional,
> to be tuned once a reference card pool exists.

**Type:** Rubyfront (double-faced card, Manual §3.1)

---

## Face A — Rubyfront of the Abyss

| Field | Value |
|---|---|
| **Deployment cost** | `3+1` (first deployment 3 Flow, then 4, 5… capped at 20) |
| **HP** | 18 |
| **Main ability** | **Fury** — d20 ≥ 12 before every action; **on failure it loses 3 HP** (the loss value is printed beside the keyword) |
| **Matters** | Destructive **up to 2nd grade** |
| **Union requirement printed on this face** | reveal the bottom card of your deck: it must be a **Human** that enables **Zero** Matter, and you must have **no cards in hand**; the revealed card remains in the deck |

**Deployment effect** *(resolves on every entrance from the Recall Zone)*:

> **Undertow** — Look at your top card. You may put it on the bottom.

**Special abilities** *(cost HP, own turn only, usable multiple times per turn while HP covers the cost — §3.1; every use requires the Fury roll)*:

- **Abyssal Pressure — 2 HP:** an opposing Entity gets **−2 Power** until your next turn *(Power never drops below 0, §8.2)*.
- **Devour — 5 HP:** put an opposing Entity with Power ≤ 3 **on the bottom of its owner's deck**.

**Flavor:** *It did not rise. The abyss opened its eyes.*

---

## Face B — Union: The Abyss Incarnate

| Field | Value |
|---|---|
| **HP recovery** | **+6** (starts with the Rubyfront's remaining HP plus 6) |
| **Main ability** | — none. Abilities are never inherited through the flip (§3.1): the Union face only has what it prints, and this one prints no main ability — the beast, united, is finally tame |
| **Matters** | Destructive **up to 2nd grade**, **Zero** |

**Flip effect:**

> **The First Wave** — Tap an opposing Entity.

**Special abilities:**

- **Rising Tide — 3 HP:** up to **two opposing Entities** get **−2 Power** until your next turn.
- **The Great Tide — 7 HP:** tap every opposing Entity.

**Flavor:** *The abyss no longer waits below. It walks.*

---

## Terminology (EN card ↔ IT manual)

| English (card) | Italiano (manuale) |
|---|---|
| Flow | Flusso |
| HP | PV (Punti Vita) |
| Fury | Furia |
| Recall Zone | Zona di Richiamo |
| Entity | Entità |
| Power | Potenza |
| Matter (Destructive / Zero / Dominant) | Materia (Distruttiva / Zero / Dominante) |
| Union | Unione |
| Discard pile | Pila degli scarti |

---

## Regole del template (IT)

- **L'illustrazione comanda:** la finestra dell'immagine occupa **~40% dell'altezza della
  carta**, la proporzione del frame M15 di Magic (`--art-height: 41.6%`, percentuale del
  box interno al netto del padding). È il vincolo fisso: il testo si adatta allo spazio
  che resta, mai il contrario.
- **Font size unica:** a larghezza piena (520px) **ogni testo della carta è 13px** —
  etichette, costi, Materie, flavor compresi. Unica eccezione il nome (1.25em ≈ 16px). La
  gerarchia si fa con colore, maiuscoletto e spaziatura, mai rimpicciolendo il carattere;
  tutto scala solo con la carta intera.
  I 13px non sono un'estetica ma una misura verificata: è la dimensione con cui il testo
  di questa carta entra nella textbox in **tutti e 28 i temi**, inclusi quelli a carattere
  monospazio (Terminale CRT, Blueprint, Glitch, Neon Notturno) che a 16px lo tagliavano.
  Alzandola, quei temi tornano a sfondare.
- **Niente a capo nelle strisce a etichetta** (Requires, ecc.): il testo va scritto in
  modo da stare su una riga. Se non entra, si accorcia il testo, non il carattere.
  L'a-capo con rientro sotto il testo esiste solo come rete di sicurezza.
- I titoli d'accento (effetti e abilità) sono allineati su un'unica colonna; i due punti
  separano il titolo dal testo (mai il trattino lungo).
- **Le Materie si indicano con simboli**, mai col nome scritto: medaglioni circolari
  con colore identitario fisso (uguale su ogni carta), grado in numerale romano accanto.
  Fissati: **Distruttiva = gemma spezzata su disco rubino** (#9e0f34),
  **Zero = anello su disco del vuoto** (#23232b). Da fissare: Dinamica, Dimensionale,
  Dominante.

## Note di design (IT)

- **Identità:** controllo per logoramento con una curva rischio/potenza leggibile. Lo
  schieramento filtra appena la pescata; spendere PV sblocca prima il debuff e poi la
  rimozione abissale. L'Unione passa dal tap singolo gratuito alla Grande Marea da 7 PV,
  capace di aprire un turno offensivo contro l'intero Fronte avversario.
- **Sigillo del vuoto:** la carta in fondo al mazzo deve essere un **Umano che abiliti la
  Zero** e viene rivelata per verificare il requisito, senza lasciare il mazzo. Inoltre il
  giocatore deve avere la **mano vuota**. Risacca permette di preparare il sigillo, mentre
  svuotare la mano espone il giocatore e rende il flip una scelta strategica riconoscibile.
- **Fury (−3 HP) su 18 PV:** ogni azione riesce con 12+ sul d20 (**45%**) e ogni fallimento
  costa 3 PV (~17% dei PV di partenza) più il ritorno in Zona di Richiamo — il Rubifronte
  è potente ma davvero indomabile. L'Unione invece **non ha Furia**: domare la bestia è
  parte del premio per averla portata al flip. Valori da ritarare sul campo.
- **Distruttiva 2° grado:** al momento non esistono carte Materia Distruttiva; questa
  carta fissa il tetto d'accesso per le prime che verranno disegnate.
