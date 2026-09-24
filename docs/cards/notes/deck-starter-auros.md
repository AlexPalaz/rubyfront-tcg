# Marea Inversa — starter Auros (40 carte + Rubyfront)

> **Status:** DRAFT. Fonte: foglio del designer «Rubyfront - Mazzi Precon», schede *Starter umani* e *Starter Auros*, 2026-09-22. Ogni numero è contato dai dati in `data/sets/srbf-001/cards/`.

## 1. Composizione

| | |
|---|---|
| Totale | 40 carte più il Rubyfront (20 Entità · 12 Materie · 8 Oggetti) |
| Progetti | 15 |
| Razza | Auros |
| Rubyfront | Seyra, Rubifronte di Nova Kai (20 PV, costo 5, Furia ≥ 13) |

**Copie per costo di Flusso:**

| Costo | 1 | 2 | 3 | 4 | 5 | 6 | d6 |
|---|---|---|---|---|---|---|---|
| Copie | 6 | 18 | 8 | 2 | 2 | 1 | 3 |

## 2. Il piano

Il tutorial della Stasi: sulle proprie Entità (Custode, Armatura Dimensionale, le abilità di Seyra) per bloccare senza morire, sulle avversarie (Vedetta, Impulso, Sigillatore, il Nexus) per fermarle. Il Guerriero e il Cristallo del Risveglio riportano in gioco chi era fermo. Seyra guadagna PV a ogni Stasi, sua o altrui.

## 3. Note dal foglio

- Il foglio conta «Entità — 7 carte, 21 copie» e «Oggetto — 2 carte, 6 copie»; le righe fanno 20 Entità (8 progetti) e 8 Oggetti (3 progetti), e il totale torna a 40: fa fede la lista.
- **Armatura Dimensionale** (+1 Potenza e Stasi) è la stessa carta dello **Scudo Dimensionale** (RBF-033) di Scissione Profonda: riusata, col suo nome. **Spada Comune** (qui nel foglio ancora «Spada del patto») e **Colpo Decisivo** sono condivise con lo starter Umani.
- **Il nome del mazzo** è quello del foglio: «Tutorial: Marea Inversa».
- **Nomi provvisori**, da decidere col designer: «Vedetta di Nova Kai» (nel foglio «Sentinella di Nova Kai», che nel catalogo è già un'altra carta, RBF-028), «Sigillatore di Nova Kai» (6/6, riga senza nome) e «Cristallo del Risveglio» (Oggetto da 3, riga senza nome); il Nexus «Veglia di Nova Kai».
- **Seyra**: la Faccia A nel foglio è intestata «Rhazmora» per errore di copia; «recupera 5 PV» contro «3 PV»: qui 5.
- «Mettere in Stasi» un'Entità avversaria è lo stato di Stasi del manuale (§8.1) imposto da un effetto; «togliere dalla Stasi» è stapparla. Tutte le forme della Stasi, il requisito Nexus di Seyra (`stasis_inflicted_at_least`) e l'evento «quando un'Entità entra in Stasi» (`on_enter_stasis`) sono nel debito dichiarato dell'engine.
