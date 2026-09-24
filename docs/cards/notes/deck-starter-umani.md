# Fiamma Ribelle — starter Umani (40 carte + Rubyfront)

> **Status:** DRAFT. Fonte: foglio del designer «Rubyfront - Mazzi Precon», scheda *Starter umani* rifatta il 2026-09-22 (sera): nomi nuovi a tema fuoco e ribellione, Scudo col Contrattacco, Rubyfront Arden. Ogni numero è contato dai dati in `data/sets/srbf-001/cards/`.

## 1. Composizione

| | |
|---|---|
| Totale | 40 carte più il Rubyfront (22 Entità · 12 Materie · 6 Oggetti) |
| Progetti | 14, quasi tutti **in tripla copia** |
| Razza | Umani |
| Rubyfront | Arden, Rubifronte del Fuoco / Nexus Fiamma Eterna (20 PV, costo 4, Furia ≥ 13) |

**Copie per costo di Flusso:**

| Costo | 1 | 2 | 3 | 4 | 5 | 6 | d6 |
|---|---|---|---|---|---|---|---|
| Copie | 12 | 9 | 9 | 3 | 3 | 1 | 3 |

## 2. Il piano

È il mazzo del tutorial: una curva piena di corpi vanilla (1/1, 4/4, 5/5), una parola chiave alla volta (Slancio sul Sovversivo, Vendetta sul Vendicatore), un'Entità che entra tappata per spiegare la stappata, un Istigatore che mostra il buff all'ingresso e Axel, l'Unico, che mostra l'innesco d'attacco. Le Materie insegnano le tre famiglie: la Reattiva (Forza di Volontà, Muro di Fuoco), la normale col costo a dado (Colpo Decisivo) e la Statica (Richiamo Divampante).

## 3. Note dal foglio

- Il foglio conta «Oggetto — 2 carte, 8 copie» ma le righe sono 3 + 3 = 6, e il totale torna a 40 con 6: fa fede la lista.
- **Spada Comune** (nella scheda Auros ancora «Spada del patto») e **Colpo Decisivo** sono condivise con lo starter Auros. Lo **Scudo Comune** dà Contrattacco +1 e Slancio (nella prima versione era +1 Potenza).
- **Colpo Decisivo** costa un **d6**: il costo a dado di una Materia è una regola nuova; finché non è collegata all'engine, la carta si vede ma non si gioca.
- **Arden**: «recupera 5 PV» nel requisito contro «Recupero Nexus 3 PV»: qui 5; «più 2» letto come +2 PV; l'intestazione della scheda dice ancora «Aldren, Rubifronte del Primo Patto», la faccia A «Arden, Rubifronte del Fuoco»: vale la faccia. I nomi delle abilità sono provvisori.
- **Il nome del mazzo** è «Fiamma Ribelle» (deciso dal designer il 2026-09-22; la riga «Tutorial:» del foglio è vuota). **Axel, Fiamma Libera** ha nome proprio, quindi è Unica (regola dei nomi).
- Le forme nuove (entra tappata, buff all'ingresso, carica di Axel, Contrattacco in Reazione, Muro di Fuoco, Richiamo Divampante, le abilità di Arden) sono nel debito dichiarato dell'engine (`engine/test/card_index_test.rb`): si vedono sulle carte, si giocano a mano finché non sono certificate.
