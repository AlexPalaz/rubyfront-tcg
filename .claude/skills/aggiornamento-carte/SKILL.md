---
name: aggiornamento-carte
description: Aggiornare le carte del catalogo dal foglio del designer (Google Sheet «Rubyfront - Mazzi Precon»), fonte di verità dei testi e degli effetti. Da usare quando il designer chiede di aggiornare le carte di un mazzo dal foglio, o dice che il foglio è cambiato — legge il foglio, allinea i dati, normalizza il linguaggio con linguaggio-carte, collega l'engine puro con regole-engine, e riporta il testo normalizzato sul foglio.
---

# Aggiornamento delle carte dal foglio del designer

Il foglio Google «Rubyfront - Mazzi Precon» (id
`1K41GRGNTPntZA4hiMArWzn-SzWYNR6DqUV7Xuuyeznc`, una scheda per mazzo) è la
**fonte di verità** di nomi, costi, razze, Materie abilitate, parole chiave
ed effetti. Il catalogo (`data/sets/<set>/cards/<id>/`) lo segue; il testo
del catalogo poi **torna sul foglio** normalizzato, così le due fonti dicono
la stessa cosa con le stesse parole. Questa skill è il contratto di quel
giro; se un passo manca, si aggiunge qui nella stessa modifica.

## Le tre skill che lavorano insieme

- **Questa** dice il giro: foglio → dati → foglio.
- **`linguaggio-carte`** dice le parole: ogni testo it/en segue le sue
  formule; se una formula manca, si aggiunge lì.
- **`regole-engine`** dice come si collega l'engine: puro, senza nomi né id di
  carta, per **forme certificate** e § del manuale. Un effetto nuovo o
  cambiato o ha una forma certificata (l'anagrafe lo legge da sola dai
  dati) o resta «a mano» e va scritto nel README dell'engine come limite.

## Il giro

1. **Leggere il foglio**, la scheda del mazzo chiesto, per intero. La via
   comoda è il connettore Google Drive (`read_file_content` con l'id sopra:
   restituisce tutte le schede come tabelle). Il browser serve per
   **scrivere**, non per leggere.
2. **Confrontare carta per carta** col catalogo: copie, nome, costo, Potenza,
   razza, Materia abilitata, parole chiave (Contrattacco, Slancio, Unica…),
   effetto — e per il Rubyfront/Nexus PV, costo di schieramento, Furia,
   requisito e recupero del Nexus, effetti e abilità di entrambe le facce.
   Elencare le differenze prima di toccare i file: il designer le legge nel
   riepilogo finale.
3. **Aggiornare i dati** di ogni carta cambiata: `<id>.json` (semantica, con
   gli identificatori di `data/vocabulary.json`; una forma nuova nel
   registro solo se serve davvero), `<id>.it.json` e `<id>.en.json` (testi
   secondo `linguaggio-carte`, partendo dalla semantica), `<id>.md` (nota di
   design: data, cosa è cambiato, da quale versione del foglio). Poi
   `data/decks/<mazzo>.json` (copie) e `<mazzo>.md` (le note che citano la
   carta). Nomi propri solo a Uniche e Rubyfront; ambiguità del foglio →
   decisione del designer, chiesta e poi scritta nella nota.
4. **L'engine puro** (`regole-engine`): l'anagrafe (`card_index.rb`) legge le
   forme dai dati — un effetto che cambia forma cambia da solo; i test
   dell'anagrafe (`card_index_test.rb`) provano le carte vere per id e vanno
   aggiornati (una carta che perde una forma esce dagli `attack_forms`,
   una che ne prende una entra negli `static_forms`, ecc.). Se il foglio
   introduce un effetto senza forma certificata: la carta finisce nel
   `DEBITO` del test, il README lo dichiara, e si chiede al designer se
   vuole collegarlo (è una regola nuova, col suo giro). **Mai** nomi o id
   di carta in `engine/`, salvo `card_index_test.rb`.
5. **Verificare**: `node scripts/validate-data.mjs`, `node
   scripts/build-catalog.mjs` (il catalogo generato in `docs/cards/` si
   committa), `ruby engine/test/*_test.rb`, `npx tsc --noEmit -p .` e `npx
   vitest run` da `simulatore/`.
6. **Commit e push** in italiano nello stile del repo: titolo con il mazzo e
   le carte cambiate, corpo che elenca le differenze foglio → catalogo.
7. **Riportare il testo normalizzato sul foglio**, nel browser del designer
   (sessione sua, già aperta): per ogni cella in cui il foglio dice la cosa
   giusta con parole diverse dal catalogo — trigger («Quando entra sul
   Fronte», maiuscole del glossario), formule, tipografia — si sostituisce
   il contenuto della cella con il testo del catalogo (colonna Effetto; il
   trigger si scrive come prefisso «Trigger: testo», che è la convenzione
   del foglio). Si scrive **solo** nelle celle del mazzo aggiornato, mai
   altrove, e si rilegge la cella dopo averla scritta. Il foglio resta la
   fonte di verità: ciò che si scrive è quello che il catalogo esegue.
8. **Riepilogo al designer**: le differenze trovate, cosa è cambiato nei dati
   e nell'engine, cosa resta a mano, quali celle del foglio sono state
   riscritte.

## Convenzioni del foglio

- Colonne: Copie · Nome · Categoria · Costo · Potenza · Razza · Materia ·
  Tipo / Keyword · Effetto. Il trigger sta nella colonna Effetto come
  prefisso «Quando entra sul Fronte: …» / «Quando attacca: …»; uno statico
  non ha prefisso.
- «Contrattacco +1 · Unica» nella colonna Tipo / Keyword: le parole chiave
  separate da «·».
- Il Rubyfront/Nexus sta in fondo alla scheda: righe PV, Costo di
  schieramento, Materie, Furia, Requisito Nexus, Recupero Nexus, poi le due
  facce con Materie, «Quando flippa» (solo Nexus), Effetto e le abilità
  («+3 PV | Nome: testo», «−5 PV | Nome: testo»).
- Il foglio può portare refusi o pezzi incollati due volte (visti nella
  scheda Scissione Profonda il 2026-09-08): si legge il senso, si chiede al
  designer dove il senso non è uno solo, e si riscrive la cella pulita.

## Trappole viste

- Il connettore Drive legge tutte le schede in un colpo: cercare
  l'intestazione «RUBYFRONT — <MAZZO>» per isolare quella giusta.
- Nel browser il foglio è un canvas: le celle non si leggono dalla pagina
  (`get_page_text` non le vede). Le coordinate dello screenshot sono
  SCALATE rispetto ai click (un click «sulla riga 8» è finito su I6) e la
  casella del nome non ha preso il testo: si naviga con le FRECCE da una
  cella nota, e prima di scrivere si controlla la cella selezionata con
  uno zoom sulla barra del nome/formula (in alto a sinistra). Scrivere su
  una cella selezionata sostituisce il contenuto; Invio conferma e scende
  di una riga (comodo per celle consecutive, ma ogni Invio conta); una
  riga nuova dentro la cella è Cmd+Invio. Un errore di riga si annulla con
  Cmd+Z, una volta per cella scritta. La verifica finale è la rilettura col
  connettore Drive, non lo screenshot.
- Le copie del foglio e quelle di `data/decks/<mazzo>.json` devono
  coincidere, e il totale con l'intestazione del gruppo («Entità — 11
  carte, 22 copie»).
