---
name: prompt-illustrazioni
description: Come si propone un prompt Midjourney per una carta Rubyfront e come si monta l'immagine scelta. Da usare SEMPRE quando il designer chiede «dammi il prompt per …», corregge una proposta («più zoom», «di schiena», «meno acquerello»), o passa un'immagine dicendo «metti questa» — e dopo ogni compattazione del contesto.
---

# Prompt d'illustrazione e montaggio

La fonte di verità dello stile è `docs/ART.md` (il prompt maestro, le ricette,
le lezioni); quella del mondo è `docs/LORE.md`. Questa skill fissa il **modo di
lavorare** col designer sui prompt: che cosa si fa a ogni giro, che cosa si
scrive nel repo e quando. Se un passo manca qui, si aggiunge a questo file
nella stessa modifica.

## Il giro, passo per passo

1. **Leggere la carta**: `data/sets/<set>/cards/<id>/<id>.json` (tipo, Materia
   e grado, effetto), i testi `.it.json` (flavor e summary: il prompt deve
   raccontare quell'effetto), il `.md` (le proposte precedenti e il QC delle
   art già montate: non si ripropone ciò che è stato scartato).
2. **Scegliere la ricetta** da `docs/ART.md` (sotto, il riassunto) e scrivere
   il prompt su **una riga**, in inglese, con `--ar`, `--niji 6` e `--stylize`
   in coda.
3. **Copiarlo negli appunti** con `pbcopy` (una riga, senza a capo) e
   mostrarlo in chat dentro un blocco di codice, con due o tre frasi che
   dicono che cosa raffigura e che cosa è bandito. Memoria
   `prompt-negli-appunti`.
4. **Non scrivere nulla nel repo per una proposta**: né il `.md` della carta,
   né `docs/LORE.md`, né `docs/ART.md`. Le proposte scartate non lasciano
   traccia (correzione del designer, 2026-10-22: «Perché aggiorni l'md?
   Fallo solo quando ti do l'immagine»).
5. **A ogni correzione** («più zoom», «di schiena», «meno acquerello») si
   riscrive il prompt con **il minimo cambiamento** che la ottiene, si
   ricopia negli appunti e si dice in una frase che cosa è cambiato. Se il
   designer incolla un prompt suo e dice «modificalo leggermente», si parte
   dal suo testo e si tocca solo ciò che chiede.
6. **Al «metti questa» / «ecco qua»** (l'immagine arriva in chat con il
   percorso in `~/Downloads`):
   - convertire in `data/sets/<set>/cards/<id>/<id>.jpg` con `sips -s format
     jpeg -s formatOptions 90` (il Nexus in `<id>-nexus.jpg`);
   - **controllare bande nere e scritte** (Niji aggiunge bande da cinema e
     firme negli angoli): misurare le righe scure con PIL e **ritagliare**,
     dicendolo nel QC;
   - chiave `"art"` nel JSON della carta (nella faccia per il Nexus:
     `faces[1].art`); le **Uniche** e i **Rubyfront** sono **full art**
     (`fullArt: true`, `artZoom` come le gemelle: Uniche 50%, Rubyfront 48%;
     `artShift` solo se serve — su Seyra scopriva una striscia nera sopra);
   - nel `.md` della carta la sezione **«Art — SCELTA DAL DESIGNER (data),
     montata»** con: le indicazioni del designer nel giro, il prompt vincente
     (quello della griglia scelta; se non è certo, dirlo), e il **QC**;
   - `node scripts/build-catalog.mjs`;
   - `docs/LORE.md` **solo ora**, e solo per ciò che l'immagine mostra
     (memoria `lore-solo-a-immagine-montata`); `docs/ART.md` solo se il giro
     ha fissato una regola di stile nuova.
7. **Il QC** (memoria `qc-visivo-screenshot`, `art-direction-rubino-su-cenere`):
   si guarda l'immagine cercando i problemi, non per confermare: la **passata
   sul viso** (occhi, naso, bocca, barba, età, capelli: legati o sciolti?),
   le **mani** (dita leggibili, numero), il costume rispetto al mazzo, gli
   elementi **banditi** comparsi lo stesso, ciò che il prompt chiedeva e non
   c'è. Ogni scostamento si scrive come «accettato dal designer con
   l'immagine»: non si nasconde.

## Le ricette (riassunto di docs/ART.md)

- **Sintesi 2 — le scene** (deciso 2026-10-23 su RBF-066): `fantasy trading
  card illustration, painted in the style of Arcane blended with Magic the
  Gathering painterly realism, with only a hint of the look of a stylized 3d
  animated film, soft volumetric shading, clean sculpted forms with strong
  light and shadow and visible painterly textures on skin, fabric and wood,
  hand-painted digital illustration, elegant anime features, bold simplified
  shapes of color, …` + `--stylize 400`. Nel `--no`: `3d render, cgi, …,
  watercolor, oil painting, loose brushstrokes, …, pixar, disney, cartoon,
  toy-like, plastic skin, …` (il testo esatto in ART.md).
- **«Arcane videogioco» — i ritratti e le scene che escono ad acquerello**
  (deciso 2026-10-23 su RBF-069, confermato su RBF-073): `fantasy trading
  card illustration in the look of the Arcane animated series and League of
  Legends splash art, polished game cinematic rendering, 3d character render
  painted over with smooth digital shading, crisp sculpted volumes, clean
  smooth surfaces, …, smooth polished rendering with soft clean shading,
  crisp highlights, strong cinematic rim light, realistic adult proportions,
  …` + `--stylize 800`, con `fresco, mural, plaster texture, chalky, dusty,
  faded, matte flat paint, rough paint texture, impasto, brushstrokes,
  painterly texture, watercolor` nel `--no`. A 800 il reso **balla da
  griglia a griglia**: per fissare un'uscita buona si rilancia con `--sref`
  su quell'immagine. Se Niji blocca il marchio, via «League of Legends».
- **Key visual anime** (RBF-062, 063, 065, montate il 2026-10-22/23): `anime
  key visual illustration, …` a 400 — storica, non si propone più.
- **I Rubyfront** (bestie, LORE.md): drago di energia senza zampe, gemma di
  rubino in fronte **sempre rossa** e unica nota rossa, la coppia di colori
  della bestia; struttura del prompt di Rhazmora/Arden. **Il Nexus**: la
  Unica del mazzo col rubino incastonato nello sterno e la pelle che prende
  la natura della bestia (`--cref` sull'art della Unica, `--cw 40`).
- **Il colore segue la Materia**: Dinamica bianca, Dimensionale blu,
  Distruttiva rosso rubino. **I gradi della Dimensionale** (ART.md): primo
  grado a **flussi** (nastri), secondo grado a **fasci** (raggi dritti,
  schegge); se il designer chiede «fasci» su una carta di primo grado, si
  segue il designer e lo si annota nel `.md`.

## Le regole del designer sui soggetti (2026-10-22/23)

- **Marea Inversa**: gente di mare (ponte, camicia di tela chiara con colletto
  alla marinara o aperto, fazzoletto blu annodato, calzoni scuri arrotolati,
  piedi nudi) — è il **mazzo**, non la razza Auros, il cui aspetto non è
  canone (memoria `marea-inversa-marinai`). Le **comuni** sono persone comuni:
  nessun effetto-Materia, nessuna posa eroica, mai la mano verso la camera.
- **Il volto**: quando il designer dice «non si deve vedere il volto», la
  figura va **di schiena** (`seen from behind, the face never visible`) e nel
  `--no` entrano `face, face visible, front view, profile view, looking back
  over shoulder, eyes, portrait`. «Non far capire se è maschio o femmina» →
  `a lean ageless sailor of indeterminate gender, androgynous build, short
  dark hair cropped at the neck, loose clothes hiding the shape of the body`,
  nessun pronome, e nel `--no` `curves, breasts, feminine figure, muscular,
  beard, stubble, long hair, ponytail, braid`.
- **Le Uniche** sono full art e in primo piano (mezzo busto, viso grande e a
  fuoco, camera a livello del viso, «nothing covering his face»). Niji legge
  i capelli bianchi/grigi e le rughe come età: per un personaggio giovane coi
  capelli grigi bandire `old man, aged face, middle-aged`.
- **Il mare che fa qualcosa**: le Materie di questo mazzo mostrano un
  personaggio che agisce **e** il mare che risponde (l'onda ferma, l'anello di
  spruzzi, la parete d'acqua). Il mare da solo è stato scartato (RBF-071).
- **Più Magic / più Arcane / più videogioco / meno 3D**: sono manopole sulla
  testata, non sul soggetto. Cambiare una cosa per volta.

## Trappole viste

- `painterly`, `brushwork`, «strongly leaning Arcane», «loose painterly
  brushwork» a `--stylize` alto danno **acquerello o affresco**.
- «Fasci» descritti come schegge sfaccettate escono **cristalli/stalattiti**;
  «beams like blades of pure light» è la formula che ha retto.
- `rigging, mast, ropes` nel `--no` fanno sparire **la nave intera**; se la
  nave serve, dichiararla pezzo per pezzo (ponte, parapetto, bompresso).
- `blood` nel `--no` non impedisce una macchia rossa su una benda; `beard`
  bandito non impedisce una barba corta su un vecchio; `wings` fuori dal
  `--no` fa diventare ali i fasci dietro le spalle. Dopo ogni alleggerimento
  del `--no`, rileggerlo.
- **`--cref` fa del personaggio il soggetto**: lo ingrandisce, lo mette davanti
  e ne mostra il volto, qualunque cosa dica il prompt (RBF-077, 2026-10-23).
  Quando la figura deve essere piccola, di schiena o in sagoma, **si usa lo
  `--sref`** sull'art del personaggio (es. Darx, RBF-069): porta l'aria e i
  colori senza imporre la figura. Correzione del designer: «bastava style
  reference e risolto il problema».
- Le bande nere e le firme negli angoli: ritagliare prima di montare.
- `red energy, red light` nel `--no` spengono anche la **gemma** del
  Rubyfront: lasciarli fuori quando la gemma deve brillare.
- Il nome del file di Midjourney porta le prime parole del prompt: serve a
  capire **quale** variante ha vinto quando il designer ne ha provate più
  d'una (ma non distingue varianti con la stessa testata: chiedere).

## Checklist (per ogni prompt proposto)

1. Il prompt racconta l'effetto della carta e il suo flavor?
2. Ricetta giusta (scena → Sintesi 2; ritratto o acquerello → Arcane
   videogioco), parametri in coda, una riga sola, copiata con `pbcopy`?
3. Colore della Materia e grado rispettati (o lo scostamento annotato)?
4. Costume e regole del mazzo (marinai, comuni senza effetto, volto, genere)?
5. Il `--no` riletto contro ciò che il prompt chiede in positivo?
6. Niente scritto nel repo prima del «metti questa».
