# Rubyfront of the Abyss
*IT: Rubifronte degli Abissi*

> **Status:** DRAFT — first card of the game. Balance values are provisional,
> to be tuned once a reference card pool exists.

**Type:** Rubyfront (double-faced card, Manual §3.1)

---

## Face A — Rubyfront of the Abyss

| Field | Value |
|---|---|
| **Deployment cost** | `2+1` (first deployment 2 Flow, then 3, 4… capped at 20) |
| **HP** | 18 |
| **Main ability** | **Fury** — d20 ≥ 12 before every action; **on failure it loses 3 HP** (the loss value is printed beside the keyword) |
| **Matters** | Destructive **up to 2nd grade** |

**Deployment effect** *(resolves on every entrance from the Recall Zone)*:

> **Undertow** — Choose an Entity: its owner puts it **at the bottom of their deck**.

**Special abilities** *(cost HP, own turn only, usable multiple times per turn while HP covers the cost — §3.1; every use requires the Fury roll)*:

- **Abyssal Pressure — 2 HP:** an Entity gets **−2 Power** until the start of your next turn *(Power never drops below 0, §8.2)*.
- **Devour — 5 HP:** **destroy** an Entity with Power 3 or less.

**Flavor:** *It did not rise from the abyss. The abyss, one day, opened its eyes.*

---

## Face B — Union: The Maw of the Abyss

| Field | Value |
|---|---|
| **Flip requirement** | you control an Entity that enables **Dominant** Matter, **or** a **Human** Entity that enables **Zero** Matter *(checked at the moment of the flip, §3.1)* |
| **HP recovery** | **+6** (starts with the Rubyfront's remaining HP plus 6) |
| **Main ability** | — none. Abilities are never inherited through the flip (§3.1): the Union face only has what it prints, and this one prints no main ability — the beast, united, is finally tame |
| **Matters** | Destructive **up to 2nd grade**, **Zero** |

**Flip effect:**

> **The Great Tide** — Every Entity with Power 2 or less is dragged into the abyss:
> its owner puts it **at the bottom of their deck**.

**Special abilities:**

- **Rising Tide — 3 HP:** up to **two** Entities get **−2 Power** until the start of your next turn.
- **Bottomless Abyss — 7 HP:** **destroy** an Entity.

**Flavor:** *No more recalls: the abyss itself comes forward.*

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

- **Font size unica:** a larghezza piena (520px) **ogni testo della carta è 16px** —
  etichette, costi, Materie, flavor compresi. Unica eccezione il nome (20px). La gerarchia
  si fa con colore, maiuscoletto e spaziatura, mai rimpicciolendo il carattere; tutto
  scala solo con la carta intera.
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

- **Identità:** controllo per logoramento. L'abisso non uccide: **inghiotte** — la firma
  della carta è mandare le Entità *in fondo al mazzo* (niente trigger di morte, la carta
  non è persa per sempre ma torna irraggiungibile per molti turni).
- **Requisito dell'Unione:** serve in campo un'Entità che abiliti la **Dominante**, oppure
  un **Umano** che abiliti la **Zero** — le due Materie rarissime (§7.1). Il flip non è
  questione di tempo ma di **deck-building**: la Voragine si sblocca costruendo il mazzo
  attorno a poche carte chiave, e l'avversario può ritardarla eliminando gli abilitatori.
- **Fury (−3 HP) su 18 PV:** ogni azione riesce con 12+ sul d20 (**45%**) e ogni fallimento
  costa 3 PV (~17% dei PV di partenza) più il ritorno in Zona di Richiamo — il Rubifronte
  è potente ma davvero indomabile. L'Unione invece **non ha Furia**: domare la bestia è
  parte del premio per averla portata al flip. Valori da ritarare sul campo.
- **Distruttiva 2° grado:** al momento non esistono carte Materia Distruttiva; questa
  carta fissa il tetto d'accesso per le prime che verranno disegnate.
