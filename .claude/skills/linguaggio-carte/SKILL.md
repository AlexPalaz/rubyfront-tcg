---
name: linguaggio-carte
description: Linguaggio normalizzato dei testi delle carte Rubyfront, italiano e inglese. Da usare SEMPRE prima di creare o modificare carte, mazzi o testi di gioco — quando l'utente passa un file/lista per un nuovo mazzo, chiede di inserire o cambiare carte, o si scrive/traduce qualsiasi testo it/en di una carta.
---

# Linguaggio normalizzato delle carte

Ogni testo di carta — italiano e inglese — usa **queste** parole e **queste**
formule, mai sinonimi. La fonte delle regole è `docs/MANUALE.md`; questa skill
fissa come le regole si scrivono sulle carte. Se una formula manca qui, si
sceglie la più vicina alle esistenti e **si aggiunge a questo file** nella
stessa modifica (il file è il contratto: aggiornarlo fa parte del lavoro).

## Flusso di lavoro (nuovo mazzo o modifica)

1. Leggere il file del designer e mappare ogni carta su `data/sets/<set>/cards/`:
   `<id>.json` (semantica, identificatori da `data/vocabulary.json`),
   `<id>.it.json`, `<id>.en.json` (testi, secondo questa skill), `<id>.md` (note).
2. Aggiornare `set.json`, `data/decks/<mazzo>.json` e `<mazzo>.md`.
3. Scrivere i testi **partendo dalla semantica**: il testo dice esattamente ciò
   che il JSON esegue, con le formule qui sotto. EN e IT si traducono formula
   per formula, mai a senso.
   **Rispettare la struttura delle frasi del designer**: la normalizzazione
   tocca terminologia, formule e tipografia, non riscrive il periodo. Se il
   foglio dice «Se questa Entità ha un Oggetto assegnato, il suo Contrattacco
   diventa +2», la carta dice quello — non una parafrasi.
4. `node scripts/validate-data.mjs` poi `node scripts/build-catalog.mjs`.
5. Checklist finale (in fondo) su ogni testo toccato.

## Glossario canonico

| Italiano | English | Chiave dati |
|---|---|---|
| Entità | Entity | `entity` |
| Umano/a (razza) | Human | `human` |
| Auros | Auros | `auros` |
| Rubyfront (termine generico, anche in IT) | Rubyfront | `rubyfront` |
| Nexus (il Nexus, maschile) | Nexus | `nexus` |
| Materia (Dinamica/Dimensionale/Distruttiva/Zero/Dominante) | Matter (Dynamic/Dimensional/Destructive/Zero/Dominant) | `matter` |
| Materia Reattiva | Reactive Matter | `reactive` |
| Oggetto | Object | `object` |
| Flusso / Flussi | Flux | `flux` |
| PV | HP | `health` |
| Potenza | Power | `power` |
| Fronte | Front | `front` |
| Abisso | Abyss | `abyss` |
| Zona di Ritiro | Retire Zone | `retire` |
| Zona di Richiamo | Recall Zone | `recall` |
| Ritiro / ritirare | Retire / to retire | `retire` (effect) |
| mazzo | deck | `deck` |
| mano | hand | `hand` |
| Furia | Fury | `fury` |
| Slancio | Surge | `surge` |
| Stasi | Stasis | `stasis` |
| Vendetta | Revenge | `revenge` |
| tappata / stappare | tapped / untap | `tapped`, `untap` |
| coperta | covered | `covered` |
| catena di risposta | chain | `response_chain` |
| Unica | Unique | — |

Mai: «creatura», «giocatore avversario» nei testi carta, «Requiem» (nome
storico della Zona di Ritiro, deprecato il 2026-08-24). I **nomi propri** di
carta si traducono (es. «Rubifronte del Patto» → "Rubyfront of the Pact"), il
termine generico resta «Rubyfront» in entrambe le lingue. I nomi dei Rubyfront
si scrivono **sempre per esteso** nei dati («Rhazmora, Rubifronte della
Scissione»): quando c'è la virgola, la UI mostra da sola il nome personale
nella barra del titolo e la qualifica nella riga del tipo (vedi
`splitFaceName` in docs/cards/ui/card-render.js). Niente abbreviazioni tipo
«RBF» nei nomi o nei testi.

## Formule fisse

Trigger (campo `trigger`, iniziale maiuscola, senza punto finale):

| IT | EN |
|---|---|
| Quando entra in campo | When it enters the field |
| Quando lascia il campo | When it leaves the field |
| Quando contrattacca | When it counterattacks |
| Quando infligge danno a un Rubyfront avversario | When it deals damage to an opposing Rubyfront |
| Quando questa Entità attacca mentre ha un Oggetto assegnato | When this Entity attacks while it has an Object assigned |
| Quando assegni un Oggetto a questa Entità | When you assign an Object to this Entity |
| Quando flippa *(solo faccia Nexus)* | When it flips |
| Effetto *(statiche e «la prima volta in ogni turno»)* | Effect |

Corpo degli effetti (campo `text`, frasi complete, punto finale):

| Concetto | IT | EN |
|---|---|---|
| Bersaglio scelto | Scegli un'Entità …: | Choose an Entity …: |
| Facoltativo | Puoi … | You may … |
| Avversaria | un'Entità avversaria | an opposing Entity |
| Che controlli | un'Entità [Umana/Auros] che controlli | a [Human/Auros] Entity you control |
| Buff | prende +N Potenza fino alla fine del turno | gets +N Power until end of turn |
| Concede abilità | ottiene Slancio fino alla fine del turno | gains Surge until end of turn |
| Ha abilità (statico) | ha Vendetta | has Revenge |
| Finché (condizione) | finché controlli X | as long as you control X |
| Danno (solo Rubyfront/Nexus) | [Nome] infligge N danni al Rubyfront avversario. | [Name] deals N damage to the opposing Rubyfront. |
| Perdita PV | il Rubyfront avversario perde N PV / perdi N PV | the opposing Rubyfront loses N HP / you lose N HP |
| Cura | guadagni N PV | you gain N HP |
| Pesca | Pesca una carta. / pesca N carte | Draw a card. / draw N cards |
| Scarto | Puoi scartare una carta. Se lo fai, … | You may discard a card. If you do, … |
| Tap/untap | Tappa / Stappa un'Entità … | Tap / Untap an Entity … |
| Distruzione via zona | mettila nella Zona di Ritiro del suo proprietario | put it into its owner's Retire Zone |
| Distruzione (morte) | muore / distruggi | it dies / destroy |
| In fondo al mazzo | mettila in fondo al mazzo | put it on the bottom of your deck |
| Cima del mazzo | Guarda la prima carta del tuo mazzo: … | Look at the top card of your deck: … |
| Ricerca | Cerca nel tuo mazzo un'Entità X, mostrala all'avversario e aggiungila alla tua mano, poi rimescola il mazzo. | Search your deck for an X Entity, reveal it to your opponent and add it to your hand, then shuffle your deck. |
| Recupero dal Ritiro | riporta in mano un'Entità X dalla tua Zona di Ritiro | return an X Entity from your Retire Zone to your hand |
| Messa in campo | metti sul tuo Fronte un'Entità … | put an Entity … onto your Front |
| Vincolo di costo | con costo di Flusso 3 o inferiore | with Flux cost 3 or less |
| Dado | lancia un d6: con 1–2 …; con 3–4 …; con 5–6 … | roll a d6: on 1–2 …; on 3–4 …; on 5–6 … |
| Una volta a turno | La prima volta in ogni tuo turno che … | The first time each of your turns … |
| Scelta modale | scegli uno: …; oppure … | choose one: …; or … |
| Oggetto | Assegna [il Nome / questa carta] a un'Entità X: … | Assign [the Name / this card] to an X Entity: … |
| Entità armata | un'Entità con un Oggetto assegnato | an Entity with an Object assigned |
| Entità disarmata | un'Entità senza Oggetto | an Entity without an Object |
| Statico dell'Oggetto | L'Entità a cui è assegnato/a ha +N Potenza. | The Entity it is assigned to has +N Power. |
| Portatore attacca | Quando l'Entità a cui è assegnato attacca, … | When the Entity it is assigned to attacks, … |
| Condizione «armata» su di sé | Se questa Entità ha un Oggetto assegnato, … | If this Entity has an Object assigned, … |
| Assegnazione gratuita | assegna … senza pagarne il costo di Flusso | assign … without paying its Flux cost |
| Sconto | la prossima carta Oggetto che giochi in questo turno costa N Flussi in meno | the next Object card you play this turn costs N less Flux |
| Contrattacco fissato | il Contrattacco di [Nome] diventa +N | [Name]'s Counterattack becomes +N |
| Contrattacco cumulato | ha Contrattacco +1. Se ha già Contrattacco, quel valore aumenta di 1. | has Counterattack +1. If it already has Counterattack, that value increases by 1. |
| Perdita variabile | perde PV pari a … | loses HP equal to … |
| Rimbalzo | riporta un'Entità avversaria nella mano del suo proprietario | return an opposing Entity to its owner's hand |
| Attacco extra | Stappala: può attaccare una seconda volta in questo turno. | Untap it: it may attack a second time this turn. |

Requisito Nexus (`nexusRequirement.text`): condizioni **all'indicativo**
(«Controlli almeno …», «In questo turno hai attaccato …»), poi il costo di flip
**all'imperativo**, chiuso da «, poi flippa.» / ", then flip."

Abilità del Rubyfront/Nexus (`abilities.*.text`): iniziano **minuscole** (sulla
carta seguono costo e nome), le altre `text` iniziano maiuscole.

Vincolo del renderer (docs/cards/ui/card-render.js): la **regola statica di
un'Entità** (evento `while_in_play`/`while_assigned`) si stampa SOLO dalla
chiave di lingua `effect` — displayKey `effect` nel semantico e `face.effect:
{text}` nei file di lingua, senza etichetta. Una chiave custom per una statica
di Entità non viene renderizzata. Materie e Oggetti stampano solo
`face.effect.text`: più trigger semantici → un unico testo combinato lì.

## Testi promemoria delle parole chiave (stringhe fisse, campo `keyword.rules`)

| Parola chiave | IT | EN |
|---|---|---|
| Furia / Fury | d20 ≥ 12 prima di ogni azione · fallimento −1 PV | d20 ≥ 12 before every action · failure −1 HP |
| Slancio / Surge | può attaccare nel turno in cui entra in campo | may attack the turn it enters the field |
| Stasi / Stasis | bloccando non muore: resta tappata per sempre | won't die blocking: stays permanently tapped |
| Vendetta / Revenge | bloccando, uccide chi ha Potenza inferiore | blocking, it kills a lower-Power attacker |

## Tipografia e stile

- Apostrofo **dritto** `'` (mai `’`), anche nei flavor.
- Intervalli di dado con trattino en: `1–2`, sempre in forma ascendente; segno
  meno U+2212 `−` per ogni valore negativo, anche nel corpo del testo (`−2
  Potenza`, `−1 PV`); separatore `·` nei sottotitoli; `≥` nei check.
- Numeri di gioco **in cifre** (+2 Potenza, 3 o inferiore, 2 danni); «una
  seconda volta» in lettere.
- Maiuscole per i termini di gioco del glossario (Entità, Potenza, Fronte,
  Stasi, …); il resto segue la normale ortografia della lingua.
- Autoriferimento: **mai per nome** nel testo di regole. Le Entità dicono
  «questa Entità» / "this Entity"; Oggetti e Materie «questa carta» / "this
  card" (o «questo Oggetto» / "this Object" quando conta il tipo, es. un
  Oggetto che si sposta di zona). Il nome proprio vive solo nel titolo, nel
  flavor e quando un'ALTRA carta lo cita («Se controlli il Rubifronte del
  Patto…»). Mai «questa creatura».
- Pronomi EN: le Entità sono "it"; se la frase diventa ambigua si ristruttura
  ("the wearer", "that Entity"). Pronomi di genere solo per personaggi con nome
  proprio, e solo se il flavor li caratterizza.
- Le Entità **non subiscono danno**: per rimuoverle si scrive «muore»,
  «distruggi» o la messa in zona esplicita (MANUALE §10). «infligge danno» e
  «perde PV» esistono solo verso Rubyfront e Nexus.
- `summary` = una frase di colore descrittiva (non regolistica); `flavor` =
  corsivo narrativo, mai termini di regole.

## Checklist finale (per ogni testo toccato)

1. Ogni termine di gioco è nella colonna giusta del glossario?
2. Ogni frase ricalca una formula della tabella (o la formula nuova è stata
   aggiunta a questo file)?
3. IT ed EN dicono esattamente la stessa cosa, formula per formula?
4. Il testo corrisponde alla semantica del `<id>.json` (bersagli, zone, durate,
   min/max, owner)?
5. Niente `’`, intervalli con `–`, promemoria parole chiave identici alle
   stringhe fisse?
6. `node scripts/validate-data.mjs` e `node scripts/build-catalog.mjs` eseguiti?
