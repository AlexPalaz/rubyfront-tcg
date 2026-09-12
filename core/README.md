# Core di Rubyfront

La logica del client, senza DOM e senza grafica: la usano tutti e due i
client — il simulatore (`simulator/`, DOM, il termine di confronto) e il
gioco (`game/`, PixiJS). Deciso 2026-09-11: un core solo, perché con due
copie le regole divergerebbero al primo ritocco.

Qui vivono (dalla fase F1 della migrazione; gesti e tasti dalla F4):

| Modulo | Cosa fa |
|---|---|
| `state.ts` | il riduttore (`apply`, `replay`): gemello di `engine/lib/rubyfront/table.rb` |
| `turn.ts`, `combat.ts`, `effects.ts` | le routine del tavolo: fasi, risoluzione, fine partita, effetti certificati |
| `cards.ts` | l'anagrafe del client (`cardStats`), specchio di `card_index.rb`; il catalogo lo consegna il client con `useCatalog` |
| `geometry.ts` | la geometria canonica della lavagna, quella dello stato e della rete |
| `ctx.ts` | il `Ctx` che le viste condividono, e le forme certificate |
| `engine.ts` | il filo verso il tavolo (WebSocket), e l'indirizzo di default |
| `session.ts` | la sessione: stato, `dispatch` col verdetto, stanza e giornale, apertura (§4), guida del bot. Ciò che si vede lo chiede alla vista (`SessionView`) |
| `bot.ts` | le decisioni del bot, pure |
| `gestures.ts` | i gesti del tavolo e gli effetti che scatenano (giocare, schierare, attaccare, abilità e flip, catena delle Reattive, inneschi): la sequenza di azioni, attese e scelte. Ciò che si vede lo chiede alla vista (`GestureView`); per il posto del bot mira, pile e conferme rispondono da sole |
| `tabs.ts` | quali tasti offre una carta (§6.3, §6.4), la mira dei blocchi, la mano chiusa a chiave nel turno altrui (§6), lo scarto dell'eccesso (§6.5) |
| `i18n.ts`, `log.ts` | le parole in due lingue e la resa delle righe di chat |

Niente `document`, niente `HTMLElement`: se un modulo ne ha bisogno, non è
core. Lo guarda `test/no-dom.test.ts`, file per file.

Si importa per percorso: `import { apply } from "@rubyfront/core/state"`.

```bash
cd core && npx vitest run && npx tsc --noEmit
```
