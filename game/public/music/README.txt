Musica del tavolo.

  neon-medieval-arena.m4a — «Neon Medieval Arena», brano fornito dal designer
    (2026-09-08, al posto di «Neon Duel»);
    normalizzato a -18 LUFS (ffmpeg loudnorm), AAC 128k. Parte con la
    partita, gira in loop per tutta la seduta, riparte a partita nuova (sound.ts, main.ts).

  strategic-dawn.m4a — «Strategic Dawn», brano fornito dal designer
    (2026-09-09) per la HOME: parte con la home (dal primo gesto), gira in
    loop, e lascia il posto in dissolvenza al brano del tavolo quando il
    mazzo si mette giù. Originale Opus 48 kHz; normalizzato a -18 LUFS
    (ffmpeg loudnorm), AAC 128k 44.1 kHz.

  La fine partita (2026-09-24) non ha file: i due temi — la fanfara della
    vittoria (Do maggiore, 120, giro di 8 s) e il lamento della sconfitta
    (La minore, 80, giro di 12 s) — sono sintetizzati con la Web Audio API
    in src/outcome-music.ts, resi una volta fuori linea e girati in loop al
    posto del brano del tavolo dal `gameOver` (alla patta solo silenzio);
    tarati sull'RMS dei brani normalizzati. Si spengono quando si esce dal
    tavolo o si ricomincia.
