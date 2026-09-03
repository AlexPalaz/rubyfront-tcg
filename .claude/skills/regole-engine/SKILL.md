---
name: regole-engine
description: Come si collega una regola del MANUALE all'engine Ruby e al simulatore, e come si tocca il canale fra i due. Da usare SEMPRE prima di lavorare su engine/ (regole, anagrafe, copia del tavolo, protocollo), sul riduttore o sulle routine del simulatore (state.ts, turn.ts, combat.ts, engine.ts) o sul comportamento «con l'arbitro al tavolo» — quando l'utente chiede la prossima regola, segnala che l'engine ferma o lascia passare qualcosa a torto, o vuole un automatismo del tavolo.
---

# Regole engine ↔ simulatore

L'engine (`engine/`, Ruby, nessuna dipendenza) **dà le regole**; il simulatore
(`simulatore/`, TypeScript) **è il poliziotto**: trattiene ogni azione locale
finché l'engine non risponde, e su un «no» la lascia cadere mostrando il
sigillo. Le regole di `docs/MANUALE.md` si collegano **una alla volta**, su
decisione del designer, ciascuna con i suoi test nei due mondi. Questa skill
è il contratto di quel lavoro: se un passo manca qui, si aggiunge a questo
file nella stessa modifica.

## La mappa

| Pezzo | File | Cosa fa |
|---|---|---|
| Giudizio | `engine/lib/rubyfront/engine.rb` | `RULES`, `VERSION`, `verdict_for` → un `judge_*` per tipo d'azione. Puro: niente I/O, orologio, caso, thread, globali. |
| Copia del tavolo | `engine/lib/rubyfront/table.rb` | Il gemello Ruby del riduttore: carte (zona, ordine, tap, copertura, faccia, fila, `entered`, `covered_turn`, `assigned_to`), dichiarazioni, turno/posto/fase, Flusso, Gettone, PV, `over`. Niente geometria oltre `row`. |
| Anagrafe | `engine/lib/rubyfront/card_index.rb` | L'unico file che tocca il disco: legge `data/sets/*/cards/*/<id>.json` una volta e congela. Tipo, razza, parole chiave, concessioni certificate, Potenza, Contrattacco, costo di Flusso, costo di schieramento, etichetta e abilitazioni delle Materie, comportamento. |
| Trasporto | `engine/bin/server`, `engine/lib/rubyfront/websocket.rb` | Un thread e un `Engine` per client. Passa `action` e `actor`. |
| Riduttore | `simulatore/src/state.ts` | `apply(state, action)`: la semantica condivisa. Ciò che cambia qui cambia in `table.rb`, e viceversa. |
| Routine | `simulatore/src/turn.ts`, `combat.ts` | Fasi, fine turno, risoluzione, fine partita: puro TS, provabile con un `Ctx` finto. |
| Canale | `simulatore/src/engine.ts`, `main.ts` (`dispatch`, `commit`, `receive`, `actorFor`) | `judge` per le azioni locali, `consult` per quelle avversarie, `snapshot` all'allineamento. |
| Tavolo e HUD | `simulatore/src/table.ts`, `hud.ts`, `banner.ts`, `dice.ts` | Con `ctx.arbitrated()` i gesti manuali si ritirano e il tavolo si lega agli slot. |
| Racconto | `engine/README.md` | Un paragrafo per regola collegata, coi limiti dichiarati. Fonte di verità di cosa fa l'engine. |

Il contratto dei verdetti: `ruled: false` = nessuna regola, il simulatore
applica; `ruled: true, ok: true` = passa; `ruled: true, ok: false` = fermata,
`reason` spiega, col riferimento «(§x.y)» in coda che il sigillo trasforma in
targhetta. **Mai molesto**: carta ignota all'anagrafe, coordinata assente,
fila ignota, attore assente → silenzio (`no_rule`), non un'accusa.

## Le tre forme di una regola

1. **Dogana** — l'engine dice «no» a un'azione che c'è già (`toZone`, `move`,
   `declare`, `player`, `turn`, `phase`, `assign`, `draw`…). Vive solo in
   `engine.rb` + test. Es.: attesa di evocazione, finestra di gioco, costo.
2. **Automatismo dei gemelli** — il tavolo fa da sé qualcosa che il manuale
   dà per scontato, dentro un'azione che c'è già, così nessuno compie gesti
   «per conto» dell'altro. Vive in `state.ts` **e** `table.rb`, stessa
   semantica, test speculari. Es.: la routine del cambio di turno (pesca del
   turno, Flusso, stappata, scoperta a T+3, frecce), gli Oggetti che seguono
   l'Entità.
3. **Azione calcolata e verificata** — il tavolo deve calcolare (risoluzione,
   fine partita, tiro di dado): il client calcola e manda **un'azione sola**
   con l'esito; l'engine rifà il conto sulla sua copia e passa solo un esito
   identico; riduttore e copia applicano l'esito così com'è. Niente numeri
   fidati in rete. Es.: `resolve {battles}`, `gameOver {winner, reason}`,
   `move {cost, roll}`. Il caso (dado) lo tira il client: l'engine verifica
   la forma, non la fortuna — e lo dichiara come limite.

Scegliere la forma più piccola che basta. Un'azione nuova va in
`types.ts` (`Action`), nel riduttore, in `table.rb` (`apply`) e nel
protocollo del README.

## Chi compie il gesto

Ogni richiesta di giudizio porta `actor`: in rete il posto del client, in
partita locale il proprietario della carta o del contatore toccato, chi è di
turno per fase e turno (`actorFor` in `main.ts`). La dogana del turno
(`judge_actor`) viene **prima** di tutte le altre. Le sue eccezioni sono un
elenco da tenere aggiornato, perché ogni gesto legittimo nel turno altrui o
prima del primo turno deve passare di lì: apparecchiatura (`loadDeck`,
`newGame`, nome, chat, pixel), la finestra del §4 al turno 1 in Preparazione
(pesca, mescola, mano↔mazzo), blocchi e contrattacchi in Reazione, Reattive
nel Fronte altrui, i propri contatori in Fronte e Reazione — e in Reazione
è il **difensore** a risolvere e a chiudere il turno (§6.4), non chi
attacca (`phaseCloser` in state.ts, per HUD e attore in locale). Un `move`
con `cost` non è un pixel: è lo schieramento.

## Il flusso di lavoro per una regola nuova

1. **Leggere il §** in `docs/MANUALE.md`, per intero, e i § che cita. Se il
   manuale tace o contraddice, è una decisione del designer: chiederla, poi
   scriverla nel manuale (mantenendo i suoi periodi) nella stessa modifica —
   e riportarla nell'edizione inglese `docs/MANUAL.md`, stesso commit.
2. **Guardare i dati** in `data/sets/*/cards/*/<id>.json`: se la regola legge
   le carte, l'anagrafe impara il campo (con `integer_stat`/forme certificate:
   forma ignota → nil, mai fraintesa) e `card_index_test.rb` lo prova sulle
   carte vere. Il client legge lo stesso campo da `cardStats` in
   `renderer.ts`, mai da altrove.
3. **Scegliere la forma** (sopra) e scrivere prima i gemelli se cambia la
   semantica condivisa: `state.ts` e `table.rb`, con i test in
   `simulatore/test/state.test.ts` e `engine/test/table_test.rb`, uno lo
   specchio dell'altro (dirlo nel commento: «Gemello: …»).
4. **La dogana** in `engine.rb`: un `judge_*` o un blocco dentro quello
   esistente, nell'ordine delle dogane già lì (attore → partita finita →
   tipo → fase → costo → abilitazione → forma). Voce in `RULES` («§x.y Cosa
   dice, in poche parole»), `VERSION` +0.1.0. Ogni `refuse` con una frase
   che un giocatore capisce e il § in coda — **in due lingue**:
   `refuse(kind, italiano, inglese)`, stessa targhetta «(§x.y, …)» in
   entrambe (il test `nessun_rifiuto_resta_senza_inglese` lo pretende); le
   parole interpolate hanno la gemella `_en`.
5. **Il client**: solo se serve un gesto nuovo o un dato nell'azione. Con
   l'arbitro i gesti manuali che la regola rende inutili si ritirano
   (`ctx.arbitrated()`); a engine spento il tavolo resta libero. Un gesto
   fermato riporta la carta da dove era (`giveBack`). Le routine di
   `turn.ts`/`combat.ts` restano prive di DOM.
6. **I test**: sezione «# --- §x.y: …» in `engine_test.rb` con i casi sì, no,
   confine, carta ignota (silenzio), turno altrui; vitest per riduttore e
   routine. Attenzione agli helper: `in_mano` **ricarica il mazzo** del
   posto (un carico solo per più carte), `scendi_in_campo` senza coordinate
   non ha forma, `ondata`/`tavolo`/`richiamo` apparecchiano tavoli interi.
7. **Il README dell'engine**: un paragrafo nella lista delle regole, con i
   **limiti dichiarati** — sempre, e sempre col promemoria della regola d'oro:
   un effetto di carta che oggi non esiste, risolto a mano, verrebbe fermato
   a torto finché l'engine non legge gli effetti. Aggiornare anche i
   paragrafi che davano la cosa come debito.
8. **Verificare e consegnare**, nell'ordine:
   `ruby engine/test/*_test.rb` (tutti e quattro), `npx tsc --noEmit -p .` e
   `npx vitest run` da `simulatore/`, `npm run build` (la build in
   `docs/simulatore` si committa a parte come «Build del simulatore per
   Pages»), riavvio della pipeline (`node scripts/dev.mjs`: il server Ruby
   **non ricarica il codice da solo**), commit con messaggio in italiano
   nello stile del repo (titolo con la regola e il §, corpo che racconta
   perché, i limiti, i conteggi dei test), push solo su richiesta.

## Convenzioni

- Il simulatore è bilingue (inglese prima): ogni scritta passa da `t("chiave")`
  in `simulatore/src/i18n.ts`, le righe di chat viaggiano come chiave e
  parametri (`ctx.log(msg("log.x", { seat, card: cardId }))`, resa in
  `log.ts` nella lingua di chi legge: `seat`/`otherSeat` → nome del posto,
  `card`/`*Card` → nome dal catalogo), i motivi dell'engine hanno
  `reason_en`. Mai una frase italiana nuda nel codice del client.
- Italiano ovunque nel codice e nei commenti, nomi del manuale (Entità, Fronte, Zona di Ritiro, Zona di
  Richiamo, Abisso, Materia, Flusso, Gettone, Rubyfront, Nexus). Commenti che
  spiegano il perché e citano il §.
- Il posto attivo è `active`; le fasi `preparazione | fronte | reazione`;
  le file canoniche del Fronte sono `FRONT_ROW_Y = [172, 1236]` (B, A), gli
  slot `FRONT_SLOT_X`, specchio di `ctx.ts`: se cambia la geometria, cambia
  in due posti.
- Il Flusso si paga con `pay` (barra, poi Gettone) nei due gemelli; i costi
  viaggiano nelle azioni (`cost`), l'engine li verifica contro l'anagrafe.
- La copia Ruby non ha la fortuna e non ha il DOM; se una regola le chiede
  un dato nuovo (una faccia, una fila, un turno di copertura), lo si annota
  sulla carta nel `load_deck`, nel `load` (snapshot) **e** nell'azione che
  lo cambia — tre posti, sempre.
- Ogni azione avversaria arriva già applicata (`receive` → `consult`): il
  suo engine l'ha giudicata; il nostro annota in chat una violazione, non
  la ferma.

## Trappole viste

- Un'azione «per conto» dell'altro (Flusso di chi entra, stappata) viene
  fermata dalla dogana del turno: metterla dentro l'azione che la causa.
- L'apertura (§4) e il carico del mazzo avvengono nel turno di chiunque.
- Le patch dei contatori non dicono chi le compie: si giudica il posto del
  contatore, e per il difensore solo in Fronte/Reazione.
- La chat nasconde le proprie righe di log: per verificare un'azione propria
  si guarda lo stato, non la chat.
- Provando nel browser dell'utente, la scheda entra nella **sua** stanza
  salvata (`localStorage` `rbf-sim:room`): isolare (azzerare la chiave o
  usare `?room=…&seat=…`) e **ripristinarla** alla fine; la scheda in
  secondo piano non fa girare animazioni né timer sotto il secondo.
- `display:none` su una cella di griglia fa scivolare le altre; `display`
  esplicito vince sull'attributo `hidden`.

## Checklist finale

- [ ] Il § letto per intero; il manuale aggiornato se la decisione lo cambia.
- [ ] Anagrafe e `cardStats` leggono lo stesso campo, con test sulle carte vere.
- [ ] Riduttore e copia contano allo stesso modo, test speculari nei due mondi.
- [ ] `RULES`, `VERSION`, `refuse` con § in coda **e la frase inglese**, silenzio sull'ignoto.
- [ ] Nessuna scritta nuda nel client: chiavi in `i18n.ts` (it + en), chat a chiavi.
- [ ] Dogana del turno: la regola passa dalle sue eccezioni se serve.
- [ ] README: paragrafo con limiti dichiarati e regola d'oro; debiti vecchi aggiornati.
- [ ] Ruby, tsc, vitest, build verdi; pipeline riavviata; commit + build a parte.
