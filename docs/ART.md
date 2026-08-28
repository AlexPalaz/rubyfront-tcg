# Rubyfront — Direzione artistica e sistema di prompt Midjourney

> **Stato:** DEFINITIVO — firma «Sintesi» scelta dal designer il 2026-08-25
> dopo un percorso di calibrazione (olio monocromo → splash gacha → ATLA →
> Arcane → manhwa → sintesi). Coerenza narrativa: docs/LORE.md.
> Le art già montate prima della sintesi (RBF-018 Gyn, RBF-025 Avy Shin)
> restano valide finché il designer non decide di rigenerarle.

## La firma

Un triangolo dichiarato: **il peso pittorico di Magic × la stilizzazione di
Arcane × l'eleganza dei volti anime/manhwa**, in palette **pop vivace**.
Pubblico di riferimento: 16-28 (superiori/università). **Giovane è lo
STILE, non i personaggi**: le età restano quelle di lore (Avy Shin ha 25
anni).

Regole che definiscono la firma:

1. **Dettaglio DEFINITO, mai random**: poche cose, ognuna risolta. Grandi
   aree di colore pulite, pennellata deliberata, chiarezza da poster. Il
   rumore visivo (pieghe casuali, schizzi, particelle non richieste) è il
   nemico numero uno.
2. **Personaggio semplice e iconico**: silhouette forte, costume a pochi
   elementi, alta finitura. Mai costumi ornati o micro-dettaglio.
3. **Ambiente presente ma ordinato**: dipinto a forme semplificate,
   composizione leggibile.
4. **Colore**: palette pop vivace con accenti saturi decisi; il colore
   dell'effetto-Materia della carta è l'accento-eroe della scena (blu
   dimensionale per Avy Shin, rosso rubino di default).
5. **Volti**: stilizzati ma credibili (`stylized yet grounded`), occhi
   definiti ed espressivi — né moe anime né cartoon western.

## Il prompt maestro (DEFINITIVO — «Sintesi»)

Struttura: nucleo fisso + tre slot (`SOGGETTO`, `SFONDO`, colore Materia).

```
painted fantasy trading card illustration blending Magic the Gathering
realism, Arcane stylization and elegant anime features, graphic clarity,
poster-like readability, large clean areas of color, controlled deliberate
brushwork, only a few crisp intentional details, every detail clearly
resolved, [SOGGETTO con azione ed effetto-Materia], dramatic epic lighting,
vibrant color palette with bold saturated accents, painted background of
[SFONDO] in simplified shapes, clearly composed, atmospheric depth
--ar 4:3 --niji 6 --stylize 250 --chaos 0
--no photo, flat cel shading, cartoon, comic book, moe face, big sparkling
eyes, chibi, ornate costume, intricate details, cluttered, busy
composition, visual noise, noisy texture, random specks, scattered debris,
floating particles, grunge, excessive brushstrokes, dark moody lighting,
night, glowing eyes, red eyes, beard, muted colors, desaturated, text,
watermark, border
```

- **Formato**: `--ar 4:3` per le carte full art (default attuale);
  `--ar 16:9` per le carte con finestra d'arte al 40%.
- **Parametri**: `--niji 6 --stylize 250 --chaos 0`. Niente `--style raw`.
  Stylize basso = dettaglio eseguito alla lettera; alzarlo (400-600) solo
  se serve più fascino, sapendo che aumenta la roba inventata a caso.
  Personalizzazione (`--p`) spenta finché non esiste la nostra Moodboard.
  ✔ Verificato col designer (2026-08-26): il prompt canonico di Avy Shin
  fu lanciato proprio con `--ar 4:3 --niji 6 --stylize 250` — la
  taratura dei parametri è CONFERMATA. L'unica differenza dal template:
  nessun `--no`. La coerenza tra le art si tiene con le reference
  (`--sref` sulle art montate, poi Moodboard `--p`).
- Il nucleo **non si riformula mai**: si cambia solo il contenuto degli
  slot e le esclusioni extra per carta.

### Slot SOGGETTO — checklist personaggi

1. Età e corporatura esplicite (`a 25 year old swordsman`); la stubble
   invecchia di 15-20 anni; `beard` è già nel `--no` base.
2. Espressione precisa (`confident expression`, `fierce grin`…), volto
   `stylized yet grounded face, defined expressive eyes`.
3. Colore occhi (se dichiarato) in forma spenta (`dull dark green eyes,
   matte and unlit`) — altrimenti Niji li fa luminosi.
4. **Inquadratura mai più larga del mezzo busto quando il viso conta**
   (`waist-up dynamic pose`): in campo largo i visi muoiono per mancanza
   di pixel.
5. UN effetto-Materia chiaro e pulito (`katana trailing one clean arc of
   glowing blue energy`) — un solo effetto, niente pioggia di particelle.
6. Costume semplice e iconico, dichiarato per pezzi (`closed white kimono
   shirt, dark hakama, strong readable silhouette`).

### Slot SFONDO

`painted background of [luogo] in simplified shapes, clearly composed,
atmospheric depth` — l'ambiente c'è sempre, ma a forme sintetiche.
Es.: `a medieval eastern city`, `a forge district`, `frozen battlements`.

**Il villaggio canonico** (stesso luogo di Avy Shin, Gyn e Mestrel —
fissato 2026-08-26): è UNO solo e si descrive sempre così —
`a medieval village of small houses with retro machinery, riveted iron,
cables and antennas, glowing mechanical lanterns`. Ferraglia rétro, MAI
neon/ologrammi/grattacieli: aggiungere alle esclusioni extra
`neon signs, holograms, skyscrapers, modern city`.

### Esclusioni extra per carta

Si accodano al `--no` base senza toccarlo: es. `open jacket, bare chest`
se il costume è chiuso; `muscular, heroic armor` per personaggi gracili;
`child, teenager` / `old man, middle-aged, wrinkles` per blindare l'età.

### Spunti per tipo di carta (indicativi)

- **Rubyfront / bestie** (canone LORE aggiornato 2026-08-26): bestia
  **come un drago, con richiami cyberpunk NEON high-tech** (deciso dal
  designer 2026-08-26) — ma **corpo ORGANICO, mai mech**: niente parti
  meccaniche, robotiche o corazze metalliche innestate. Il neon si
  esprime come **linee d'energia luminose che corrono sottopelle**,
  vene di luce alla Arcane, non come tecnologia applicata. Il neon è
  ammesso SOLO sul corpo dei Rubyfront: gli ambienti restano ferraglia
  rétro, e il contrasto è voluto — la bestia è l'unica cosa «avanzata»
  della scena. Per le bestie il triangolo stilistico **pende verso
  Arcane** (deciso 2026-08-26): nel nucleo del prompt Arcane si dichiara
  per primo e rinforzato (`in the painterly style of Arcane... strongly
  leaning Arcane`) — unica riformulazione del nucleo ammessa, solo per i
  Rubyfront. Esclusioni extra: `mecha, robot, cyborg, robotic limbs,
  metal plated body` (mirate al corpo — NON bandire `mechanical parts`
  generico, ucciderebbe la ferraglia del villaggio). **Niente umani in
  scena** (deciso 2026-08-26): la scala si dà con `low angle` e
  l'architettura (`towering over the village rooftops`), MAI con
  silhouette umane; bandire `people, humans, crowd, human figures`.
  Obbligatoria la
  **gemma di rubino incastonata in fronte** (tratto identitario della
  razza, punto di luce eroe del volto): resta ROSSA anche quando
  l'accento della scena è di un altro colore — dichiararla per prima
  nello slot SOGGETTO. ⚠ Modo di fallire noto (2026-08-26): descritta
  come luce («glowing red gem, strongest light») Niji la trasforma in un
  RAGGIO che esce dalla bocca. Rimedio: descriverla come **pietra**
  ancorata all'anatomia — `a faceted ruby red gemstone set into the
  center of its forehead, above its eyes, between its horns` — con
  `mouth firmly closed` in positivo e bando a `beam, laser, energy
  breath, breathing fire, light coming from mouth`. Se anche così non
  attacca, si monta in Editor: gomma sulla fronte + mini-prompt
  `a faceted ruby red gemstone embedded in the forehead, clean and
  clearly resolved`. Coppia di colori propria per ogni Rubyfront
  (Rhazmora: porcellana bianca + rubino). Descrivere SEMPRE in positivo
  pezzo per pezzo — mai per negazione. Scala — `low angle, tiny human
  silhouettes for scale`; bandire `bird, beak, feathers, open mouth,
  roaring, oversized gem`. Le scene notturne sono ammesse per i
  Rubyfront: in quel caso togliere `night, dark moody lighting` (ed
  eventualmente `glowing eyes`) dal `--no` base e dichiarare la notte in
  positivo, tenendo la palette vivace.
- **Nexus (faccia B):** ambiente più che personaggio — `the heart of
  [luogo], wide establishing shot, [colore] light at the center`.
- **Oggetti** (standard fissato con RBF-026 Spada Dimensionale,
  2026-08-26): oggetto da solo su **fondale neutro scuro** — `displayed
  at a slight diagonal, close shot, painted background of a neutral
  dark gradient, smooth and empty, softly lit around [the object]` —
  con UN effetto pulito (per la Spada: filo blu + fenditura sottile
  nell'aria, il flavor reso visibile). Esclusioni tipiche:
  `people, hands, character, warrior` (Niji ci infila sempre chi lo
  impugna), `landscape, room, furniture, table, clouds, sky` (Niji odia
  il vuoto), `ornate, jewels, gold ornaments` sugli oggetti base.
  Niente `dark moody lighting` nel `--no`: il fondale scuro è voluto.
- **Materie** (standard consolidato col giro RBF-030→036, firmato
  2026-08-26): due registri ammessi. (a) **La sostanza stessa**, con
  luce emessa, su fondale neutro scuro o terra battuta senza cielo
  (`no sky in frame`, camera bassa) — lo stato della sostanza racconta
  la carta (fluido ramificato, nube, eco, specchio, sfera trattenuta).
  (b) **L'evocatore in scena** quando la carta è un'azione: personaggio
  del set o figura anonima che incanala la Materia (Scudo Riflesso,
  Carica Latente, Assalto Ferale). Colore = la Materia della carta
  (blu Dimensionale, rosso rubino Distruttiva — MAI mischiati: bandire
  l'altro colore). Bandi ricorrenti: pareidolia (`face, eyes, creature`
  sulla sostanza), contenitori (`bottle, flask, jar`), derive
  (`crystal ball, planet, lightning`, meteo). La figura ricorrente
  senza volto con la gemma nel petto (Nexus, Assalto Ferale) è canone
  da registrare in LORE.

## Controllo qualità — OBBLIGATORIO prima di montare in carta

Nessuna immagine va in carta "as generated". Un TCG non si può permettere
errori: mani, else, geometrie delle lame e sfondi vanno verificati e
corretti. Procedura per ogni carta:

1. **Genera 1-2 griglie** e scegli per composizione e carattere, IGNORANDO
   i piccoli errori (si correggono dopo; non scartare una composizione
   giusta per una mano storta).
2. **Upscale (Subtle)** dell'immagine scelta: recupera definizione su viso
   e dettagli piccoli. (Nella web app: clic sull'immagine → pulsanti
   nell'anteprima grande, o menu ⋯.)
3. **Passata viso — SEMPRE, per ogni personaggio**: dopo l'upscale, Editor
   (= Vary Region: pulsante Edit con la matita, o voce Edit nella barra
   laterale) → gomma sulla sola testa → mini-prompt dedicato:
   `the face of a 25 year old man, confident expression, defined
   expressive eyes, stylized painted features, clean and clearly resolved`.
4. **Editor su OGNI altro errore**: selezionare solo la zona sbagliata
   (mano, elsa, pezzo di sfondo confuso) e rigenerare con un prompt corto
   e mirato (es. `a hand gripping the sword hilt, clean anatomy`).
5. **Ispezione finale al 100% di zoom** — mani, occhi, arma, bordi — solo
   poi si scarica e si monta in carta.
6. (Quando ci saranno 5-6 art approvate) **Moodboard Midjourney con le
   NOSTRE art approvate** → codice `--p` nei parametri: lo stile si
   autoalimenta dalle scelte del designer e diventa irripetibile. È l'unica
   reference ammessa: noi stessi.

## Impaginazione in carta

- **Full art (4:3 o 5:7)**: l'immagine fa da sfondo all'intera carta.
  Taratura con `artZoom`/`artShift` nel JSON della carta (es. RBF-025:
  `artShift 8%` per liberare il viso dalla barra del titolo). Viso e
  dettagli chiave nella fascia alta ma NON nel primo ~10% (coperto dal
  titolo); la metà bassa finisce dietro la textbox.
- **Finestra 16:9 (40% della carta)**: il crop taglia alto/basso — punto
  focale nella fascia orizzontale centrale, testa mai a filo del bordo.
- Resta da fare: trattamento CSS di raccordo art→textbox per le full art
  (sfumatura verso il pannello testo, velo dietro il titolo).

## Esempio canonico (approvato 2026-08-25; prompt esatto fornito dal
## designer il 2026-08-26)

Avy Shin, sintesi vincente — prompt COMPLETO e letterale, lanciato con
`--ar 4:3 --niji 6 --stylize 250` e **senza alcun `--no`**:

```
painted fantasy trading card illustration blending Magic the Gathering
realism, Arcane stylization and elegant anime features, graphic clarity,
poster-like readability, large clean areas of color, controlled
deliberate brushwork, only a few crisp intentional details, every detail
clearly resolved, a 25 year old swordsman with black hair, confident
expression, stylized yet grounded face, defined expressive eyes, simple
iconic costume: closed white kimono shirt, dark hakama, strong readable
silhouette, dynamic pose swinging a katana trailing one clean arc of
glowing blue energy, dramatic epic lighting, vibrant color palette with
bold saturated accents, painted background of a medieval eastern city in
simplified shapes, clearly composed, atmospheric depth
```

Nota: più corto del nucleo documentato sopra — niente `waist-up`,
accenti saturi senza colore imposto, sfondo senza ferraglia, nessuna
esclusione. Lezione: un `--no` lungo cambia la resa quanto il prompt
stesso; per restare nello stile delle art montate, ancorarsi con
`--sref` alle nostre immagini (o alla Moodboard `--p` quando esiste)
conta più che allungare il prompt.

## Coda di rigenerazione

- [x] RBF-043 Prisma Dimensionale — SCELTA DAL DESIGNER (2026-08-28):
      monolite di cristallo alto e sfaccettato, illuminato da dentro,
      con una scheggia gemella staccata a mezz'aria; fondale scuro, blu
      Dimensionale unico accento. Finestra 16:9, nessun artZoom. Prompt
      esatto conservato nelle note di design della carta (rbf-043.md).
      Lezioni nuove: (1) **la luce dentro batte la luce che attraversa**
      — l'effetto «raggio che entra ed esce come vuoto» non è mai
      attaccato, mentre un cristallo che si illumina da dentro è
      immediato e più pulito; per gli Oggetti «contenitore» conviene
      chiedere l'illuminazione interna, non il percorso della luce.
      (2) **Un secondo elemento staccato racconta la meccanica meglio di
      un effetto complicato**: la scheggia gemella a mezz'aria dice «un
      pezzo è altrove» senza aggiungere rumore. (3) Come su RBF-044, un
      `--no` sull'ambiente (`landscape`) non tiene: Niji ha dato al
      prisma un piano d'appoggio con le ombre. Va bene finché il fondale
      resta scuro e vuoto — lo standard Oggetti («gradiente neutro
      scuro») ammette il piano d'appoggio.
- [x] RBF-044 Frattura della Scissione — SCELTA DAL DESIGNER
      (2026-08-28): la frattura corre in diagonale dal suolo al punto di
      fuga e riparte in due rami nel cielo, piana bianca screpolata, blu
      Dimensionale unico accento. Finestra 16:9, nessun artZoom. Prompt
      esatto conservato nelle note di design della carta (rbf-044.md).
      Lezione nuova, valida oltre questa carta: **il `--no` sugli
      elementi d'ambiente (`sky, clouds, horizon`) non tiene** quando il
      soggetto richiede profondità — Niji ha bisogno di un fondo per
      costruire la prospettiva e lo reintroduce. E fa bene: è il cielo a
      far leggere la crepa come **dimensionale** invece che come una
      crepa nel terreno. Corollario sul canone Materie: il registro (a)
      resta «la sostanza stessa», ma «senza cielo» va inteso come
      default, non come vincolo — per le Materie che squarciano lo
      spazio il cielo è parte dell'effetto.

- [x] RBF-001 Oblivhal (mazzo Umani «Eredità Perduta») — APPROVATA E
      FIRMATA dal designer (2026-08-27), entrambe le facce.
      **Faccia A — Oblivhal:** bestia dal corpo cremisi con linee di neon
      BIANCO sottopelle (dove Rhazmora ha il blu), ali spiegate su uno
      sperone di roccia, terra desolata con guglie sotto un cielo chiaro.
      **Faccia B — Ritorno dell'Erede:** ragazzo dai capelli bianchi,
      occhi rossi, scheggia di rubino cresciuta dallo sterno con le
      crepe luminose, raggi bianchi dritti, cielo astratto rosso — lo
      stesso trattamento del Nexus di Rhazmora, traslato dal blu al
      rosso. Entrambe full art 16:9 senza `artShift`; artZoom 55%
      (faccia A) e 58% (faccia B, con cielo ritagliato in alto per
      allineare la testa al muso della bestia).
      Note tecniche apprese su questa carta:
      1. Per un volto poco definito NON basta descriverlo: va tolto
         `every detail clearly resolved` dal nucleo e alzato lo stylize
         (400+), perché la firma stessa impone la definizione.
      2. Un colore nel `--no` (es. `white shirt`) spegne quel colore in
         TUTTA l'immagine: bandiva anche i capelli bianchi.
      3. La gemma nel petto attacca solo su **pelle nuda** e descritta
         come scheggia *cresciuta da dentro* con le crepe attorno; su
         stoffa Niji la legge sempre come ciondolo.
      4. Se una griglia è giusta ma lontana, si ritaglia il file — non
         serve rigenerare.

- [x] RBF-022 «Per Vhal Astra!» (ex «Carica degli Eredi», rinominata dal
      designer il 2026-08-28) — art scelta dal designer il 2026-08-28:
      Rhen di fronte col pugno alzato e un solo arco di fulmine bianco,
      dietro di lui i ranghi dei Simulacri di Vhal Astra in controluce con
      le crepe cyan. Finestra 16:9, nessun artZoom.
      Lezioni nuove, valide oltre questa carta:
      1. **Capelli bianchi + bocca spalancata = vecchio.** Niji legge il
         bianco come età: servono l'età esplicita e il bando di
         `old man, elderly, wrinkles, aged face` **insieme** a quello
         dell'espressione contratta (`grimace, snarl, clenched teeth,
         squinting, furrowed brow`), che è ciò che disegna le rughe.
      2. **Il `--no` litiga col `--cref`.** Corollario della lezione 2 di
         Oblivhal: bandire `four white-haired men` spegneva i capelli di
         Rhen, `glowing eyes` i suoi occhi chiari, `blue energy` il nucleo
         dei Simulacri. Prima di lanciare, rileggere il `--no` contro la
         reference.
      3. **`--cw 40` è il valore buono** (lo stesso del Nexus di
         Rhazmora): `--cw 100` pesa su capelli e vestiario e *indebolisce*
         il volto. Con più figure in scena il `--cref` non aggancia
         nessuno — la folla si aggiunge dopo, in Editor.
      4. **Folle e comparse si fanno in Editor**, non in prompt: maschera
         sullo sfondo, image prompt sull'art della carta da replicare e
         descrizione letterale. La dimensione di ciò che compare la decide
         la maschera, non il testo.
- [x] GIRO OGGETTI + MATERIE (RBF-026→036) — APPROVATO E FIRMATO in
      blocco dal designer (2026-08-26): Spada Dimensionale, Scudo
      Dimensionale (rinominata da «Scudo del Campo»), Catalizzatore
      Sigma (da «Sygma»), Vestigio della Scissione, Amplificazione
      Sinaptica, Nube Intangibile, Eversione Distruttiva (da
      «Esversione», art: soffio del Rubyfront da fuori quadro),
      Rifrazione della Memoria (eco che svanisce), Scudo Riflesso
      (guerriero in uniforme da Sentinella, barriera evocata a
      distanza), Carica Latente (la Sottolama che regge la carica),
      Assalto Ferale (figura senza volto alla Avy Shin, gemma nel
      petto, prima Distruttiva). Tutte finestra 16:9, nessun artZoom.

- [x] RBF-017 Rhazmora faccia A — APPROVATA E FIRMATA dal designer
      (2026-08-26): notturna sul villaggio canonico, corpo organico con
      vene di luce blu, gemma rubino in fronte; nucleo tendente Arcane,
      `--ar 4:3 --niji 6 --stylize 250`. Full art, artZoom 72% (la
      silhouette umana in basso finisce dietro la textbox). Prompt
      esatto conservato nelle note di design della carta (rbf-017.md).
- [x] RBF-017 faccia B Nexus «Cuore della Scissione» — APPROVATA E
      FIRMATA dal designer (2026-08-26): Auros dai capelli neri alla Avy Shin
      (reference `--cref` su rbf-025, cw 40), gemma di rubino nel petto,
      vene di neon blu, occhi rossi, bocca chiusa, braccia aperte contro
      il cielo squarciato. artZoom 72% ereditato: viso sotto il titolo,
      gemma libera al centro, watermark dell'originale dietro la textbox.
      Nota canone: per i Nexus il personaggio È ammesso quando incarna il
      luogo (qui il Cuore stesso) — l'indicazione «ambiente più che
      personaggio» resta il default, non un vincolo. Prompt esatto
      firmato, conservato nelle note di design della carta (rbf-017.md).
- [x] RBF-019 Guardiano del Campo — ART SOSTITUITA dal designer
      (2026-08-26): ora monta la scena "ora blu" nata per la Sentinella
      (accovacciato sul crinale, fiamma di Materia Dimensionale sul
      palmo, sguardo teso altrove, villaggio con le finestre accese alle
      spalle). La vecchia art della torre di guardia (2026-08-25) è
      dismessa. Nota di mondo sempre valida: il "cyberpunk" di Rubyfront
      si esprime con ferraglia rétro (ferro rivettato, cavi, antenne,
      lanterne meccaniche), NON con ologrammi/neon.
- [x] RBF-024 Portatore di Fronti — APPROVATA E FIRMATA dal designer
      (2026-08-26): ex Lama anziano, capelli grigi
      corti a ciocche, seggio di pietra nella sala del consiglio, mani
      sul pomolo dello spadone piantato a terra, fumo azzurro dalle
      cicatrici, sguardo giudicante abbassato (il giudicato resta fuori
      quadro nella griglia scelta). Finestra 16:9, nessun artZoom.
- [x] RBF-022 Sentinella di Nova Kai — ART SOSTITUITA dal designer
      (2026-08-26): ora monta il ninja in volo con la maschera-drago
      bianca laccata (l'art 2026-08-25 che era della Sottolama). La
      scena "ora blu" nata per questa carta è passata al Guardiano del
      Campo (RBF-019). Finestra 16:9, nessun artZoom.
- [x] RBF-021 Artefice di Nova Kai — APPROVATA E FIRMATA dal designer
      (2026-08-26): guerriera-spadaia nella bottega di Nova Kai, katana
      ispezionata col filo di energia blu Dimensionale, bagliore caldo
      di forgia; da flavor, affila una lama trovata (a Nova Kai niente
      si forgia due volte). Finestra 16:9, nessun artZoom.
- [x] RBF-020 Esploratore — APPROVATA E FIRMATA dal designer
      (2026-08-26): sessantenne con occhiali da
      esploratore, guarda una cascata di Materia Dimensionale al
      tramonto attraverso gli occhiali; two-tone oro/arancio + blu.
      Finestra 16:9, nessun artZoom. Fuori dal villaggio: l'Esploratore
      è in avanscoperta — scena coerente col ruolo.
- [x] RBF-023 Sottolama di Nova Kai — RIFATTA in firma Sintesi,
      APPROVATA E FIRMATA dal designer (2026-08-26): spadaccina bionda
      con coda ordinata, veste bianca con gilet scuro, affondo da
      schermitrice con nastri di fumo blu Dimensionale attorno alla
      lama, nel bosco coi fasci di sole. Generica di proposito (è una
      ×2): niente tratti da protagonista. La precedente art del ninja
      maschera-drago è passata alla Sentinella (RBF-022). Finestra
      16:9, nessun artZoom.
- [x] RBF-025 Avy Shin — APPROVATA E FIRMATA dal designer (2026-08-26,
      con fix all'occhio fatta in Editor): nuova versione «tempesta» in
      firma Sintesi —
      frontale con la spada puntata verso chi guarda, capelli neri a
      ciocche col taglio del ragazzo del Nexus (`--cref` su
      rbf-017-nexus), camicia bianca aperta su kimono scuro, nastri di
      fumo blu, monte scuro con fulmini. La versione "pioggia"
      pre-sintesi (approvata 2026-08-25) è dismessa. Resta FULL ART su
      scelta del designer, con immagine 16:9: taratura `artZoom 50%`
      (zoom indietro: si vede la lama in scorcio) + `artShift 5%` (viso
      libero dalla barra del titolo); la parte bassa sfuma dietro la
      textbox come da CSS.
- [x] RBF-018 Gyn — FATTA in firma Sintesi (2026-08-25): biondo, gambeson
      trapuntato, bracciale-Oggetto, villaggio medievale-cyberpunk con
      insegne blu; finestra 16:9, nessun artZoom necessario. Prima carta
      della firma definitiva.
