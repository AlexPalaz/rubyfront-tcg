// I suoni del tavolo: DISEGNATI a strati, fuori linea, con materie prime
// dai pacchetti CC0 di Kenney (RPG Audio, Impact Sounds, Casino Audio) —
// il montaggio è in scripts/sounds.py, i file in public/sounds con la
// licenza accanto. Ogni voce ha due o tre varianti scelte a caso:
//
//   select  — cuoio in mano e carta che scivola: prendere, scegliere
//   draw    — la carta spinta dal mazzo con lo sfoglio di pergamena, una
//             per ogni carta pescata, in cascata — solo la PROPRIA pesca
//   play    — la carta che si posa, col libro chiuso e un colpo sordo sotto
//   button  — lo scatto del fermaglio di metallo: Continua, Risolvi, conferme
//   phase   — la porta pesante che si chiude, la campana intonata giù, il
//             colpo grave: ogni fase nuova, e il cambio di turno
//   attack  — la lama che esce e il taglio
//   block   — lo scudo: piastra, legno pesante sotto, fermaglio sopra
//   counter — il taglio, il metallo pesante e il rintocco
//   tap     — cuoio che si posa, soft e senza acuti: la carta che si corica
//   rubyfront-arrive / -ignite / -land — l'ingresso del Rubyfront a inizio
//             partita (dal 2026-09-11, suoni suoi e non quelli delle carte):
//             la porta pesante che si apre col colpo grave che si avvicina;
//             la campana grave e lunga col rubino che si accende; la lastra
//             pesante che si assesta in Zona di Richiamo
//
// Si suona con la Web Audio API (decodifica una volta, poi buffer in
// memoria): il browser non suona prima di un gesto dell'utente, quindi il
// contesto nasce al primo tocco (unlock). Formato: AAC (m4a), che ogni
// browser decodifica. L'interruttore nelle impostazioni spegne
// tutto; la scelta resta salvata (main.ts).

export type Cue = "select" | "button" | "play" | "attack" | "block" | "counter" | "draw" | "phase" | "tap" | "rubyfront-arrive" | "rubyfront-ignite" | "rubyfront-land";

/** Le varianti di ogni voce: i file in public/sounds, senza estensione. */
const VARIANTS: Record<Cue, string[]> = {
  select: ["select-1", "select-2"],
  draw: ["draw-1", "draw-2", "draw-3"],
  play: ["play-1", "play-2"],
  button: ["button-1", "button-2"],
  // La fase: montata ma non usata — «togli i suoni di ogni fase».
  phase: [],
  // Il tap e lo stap: cuoio che si posa, soft.
  tap: ["tap-1", "tap-2", "tap-3"],
  attack: ["attack-1", "attack-2", "attack-3"],
  block: ["block-1", "block-2"],
  counter: ["counter-1", "counter-2"],
  "rubyfront-arrive": ["rubyfront-arrive-1", "rubyfront-arrive-2"],
  "rubyfront-ignite": ["rubyfront-ignite-1", "rubyfront-ignite-2"],
  "rubyfront-land": ["rubyfront-land-1", "rubyfront-land-2"],
};

/** Il volume di ogni voce: i colpi pesanti sotto, i tocchi leggeri più vicini. */
const LEVEL: Record<Cue, number> = {
  select: 0.7, button: 0.55, play: 0.9, draw: 0.6, attack: 0.8, block: 0.85, counter: 0.8, phase: 0.9, tap: 0.5,
  "rubyfront-arrive": 0.9, "rubyfront-ignite": 0.95, "rubyfront-land": 0.9,
};

let context: AudioContext | null = null;
let master: GainNode | null = null;
/** L'orecchio di prova sul generale (musicState, solo DEV). */
let meter: AnalyserNode | null = null;
let enabled = true;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

/** Il volume generale: sommesso, sotto la voce della chat vocale. */
const MASTER_GAIN = 0.6;

// La musica del tavolo: un brano in loop che parte con la partita e dura
// tutta la seduta; a partita nuova riparte da capo (main.ts). Sta sotto ai suoni,
// che devono restare accentuati (scelta del designer): volume basso di
// suo, e basta — niente abbassamento a ogni suono (tolto su richiesta del
// designer, 2026-09-08). Il brano è normalizzato fuori linea (-18 LUFS,
// ffmpeg loudnorm).
/** Il volume della musica, relativo al generale: ben sotto i suoni (0.5–0.9). */
const MUSIC_GAIN = 0.2;
const MUSIC_FADE_IN_S = 1.4;
const MUSIC_FADE_OUT_S = 1.6;
/** Fra un brano e l'altro (dalla home al tavolo, e ritorno) due secondi
    di silenzio: il nuovo non attacca sulla coda del vecchio. */
const MUSIC_GAP_MS = 2000;
/** Quando l'ultimo brano ha cominciato a spegnersi (per contare il silenzio). */
let musicStoppedAt = 0;
let musicEnabled = true;
let music: { name: string; source: AudioBufferSourceNode; gain: GainNode } | null = null;
let musicWanted: string | null = null;
/** Il diario della musica, per le prove dalla console (main.ts, solo DEV). */
const musicLog: string[] = [];
function noteMusic(what: string): void {
  musicLog.push(`${(context?.currentTime ?? 0).toFixed(1)}s ${what}`);
  if (musicLog.length > 200) musicLog.shift();
}
export function musicState(): Record<string, unknown> {
  let rms: number | null = null;
  if (meter) {
    const wave = new Float32Array(meter.fftSize);
    meter.getFloatTimeDomainData(wave);
    rms = Math.sqrt(wave.reduce((sum, value) => sum + value * value, 0) / wave.length);
  }
  return {
    rms,
    name: music?.name ?? null,
    wanted: musicWanted,
    enabled,
    musicEnabled,
    contextState: context?.state ?? null,
    contextTime: context?.currentTime ?? null,
    gain: music?.gain.gain.value ?? null,
    loop: music?.source.loop ?? null,
    loopEnd: music?.source.loopEnd ?? null,
    duration: music?.source.buffer?.duration ?? null,
    log: [...musicLog],
  };
}

/** I suoni delle carte: indipendenti dalla musica (impostazioni). */
export function setSoundEnabled(on: boolean): void {
  enabled = on;
  noteMusic(`suoni ${on ? "accesi" : "spenti"}`);
}

/** L'interruttore della musica, separato dai suoni (impostazioni). */
export function setMusicEnabled(on: boolean): void {
  musicEnabled = on;
  if (!on) stopMusic(true);
  else if (musicWanted) startMusic(musicWanted);
}

/** Il brano parte (in dissolvenza) e gira in loop finché non lo si ferma.
    Con `restart` riparte da capo anche se sta già suonando. */
export function startMusic(name: string, restart = false): void {
  noteMusic(`startMusic ${name}${restart ? " (da capo)" : ""}`);
  if (restart && music) stopMusic(true);
  musicWanted = name;
  if (!musicEnabled) return;
  if (music?.name === name) return;
  // Un altro brano sta suonando (dalla home al tavolo, o viceversa): si
  // spegne in dissolvenza, e il nuovo attacca dopo il silenzio dovuto.
  if (music) {
    fadeOut(music, MUSIC_FADE_OUT_S);
    music = null;
    musicStoppedAt = performance.now();
  }
  const ctx = ensure();
  if (!ctx || !master) return;
  if (ctx.state === "suspended") void ctx.resume();
  const out = master;
  const gap = musicStoppedAt ? Math.max(0, MUSIC_GAP_MS - (performance.now() - musicStoppedAt)) : 0;
  void loadMusic(ctx, name).then(buffer => {
    // Nel frattempo qualcuno l'ha fermata, o ne vuole un'altra.
    if (!buffer || musicWanted !== name || music?.name === name) return;
    const attack = (): void => {
      if (musicWanted !== name || music?.name === name) return;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(MUSIC_GAIN, ctx.currentTime + MUSIC_FADE_IN_S);
      gain.connect(out);
      spin(ctx, buffer, name, gain);
    };
    if (gap > 0) window.setTimeout(attack, gap);
    else attack();
  });
}

/** Quanto si toglie dalla coda del brano per chiudere il loop: con la
    fine del loop sull'ULTIMO campione del buffer (il default, o la durata
    intera) Chrome ammutolisce al primo giro e non riparte — visto al
    tavolo il 2026-09-08, riprodotto in prova: stessa sorgente, fine del
    loop 50 ms prima, e il giro continua. Cinquanta millisecondi non si
    sentono. */
const LOOP_TAIL_S = 0.05;

/** Il giro del brano: la sorgente in loop (quasi) su tutto il buffer — e,
    se per qualunque motivo finisce lo stesso (il loop non ripartito), un
    giro nuovo attacca subito, senza dissolvenza, finché la musica è voluta. */
function spin(ctx: AudioContext, buffer: AudioBuffer, name: string, gain: GainNode): void {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = 0;
  source.loopEnd = Math.max(1, buffer.duration - LOOP_TAIL_S);
  source.connect(gain);
  source.onended = () => {
    noteMusic(`onended ${name}${music?.source === source ? " (corrente)" : " (vecchia)"}`);
    if (music?.source !== source || musicWanted !== name) return;
    spin(ctx, buffer, name, gain);
  };
  source.start();
  noteMusic(`spin ${name} (${buffer.duration.toFixed(1)}s, ctx ${ctx.state})`);
  music = { name, source, gain };
}

/** Il brano si spegne in dissolvenza (o di colpo). */
export function stopMusic(abrupt = false): void {
  noteMusic(`stopMusic${abrupt ? " (di colpo)" : ""}`);
  musicWanted = null;
  const playing = music;
  if (!playing) return;
  music = null;
  musicStoppedAt = performance.now();
  fadeOut(playing, abrupt ? 0.08 : MUSIC_FADE_OUT_S);
}

/** Una sorgente si spegne in `tail` secondi e poi si ferma. */
function fadeOut(playing: { source: AudioBufferSourceNode; gain: GainNode }, tail: number): void {
  if (!context) return;
  const now = context.currentTime;
  playing.gain.gain.cancelScheduledValues(now);
  playing.gain.gain.setValueAtTime(playing.gain.gain.value, now);
  playing.gain.gain.linearRampToValueAtTime(0, now + tail);
  playing.source.stop(now + tail + 0.05);
}

const musicBuffers = new Map<string, Promise<AudioBuffer | null>>();
function loadMusic(ctx: AudioContext, name: string): Promise<AudioBuffer | null> {
  const known = musicBuffers.get(name);
  if (known) return known;
  const url = new URL(`music/${name}.${extension}`, document.baseURI).href;
  const pending = fetch(url)
    .then(response => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(response.statusText))))
    .then(data => ctx.decodeAudioData(data))
    .catch(() => null);
  musicBuffers.set(name, pending);
  return pending;
}
export function soundEnabled(): boolean {
  return enabled;
}

/** Al primo gesto: il contesto nasce e, se sospeso, riparte; i campioni si caricano. */
export function unlockSound(): void {
  if (!enabled && !musicEnabled) return;
  const ctx = ensure();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  if (!enabled) return;
  for (const names of Object.values(VARIANTS)) for (const name of names) void load(ctx, name);
}

function ensure(): AudioContext | null {
  if (context) return context;
  const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
    | typeof AudioContext
    | undefined;
  if (!Ctor) return null;
  context = new Ctor();
  master = context.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(context.destination);
  meter = context.createAnalyser();
  master.connect(meter);
  return context;
}

/** AAC (m4a): lo decodificano tutti i browser che ci interessano. */
const extension = "m4a";

function load(ctx: AudioContext, name: string): Promise<AudioBuffer | null> {
  const known = buffers.get(name);
  if (known) return known;
  const url = new URL(`sounds/${name}.${extension}`, document.baseURI).href;
  const pending = fetch(url)
    .then(response => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(response.statusText))))
    .then(data => ctx.decodeAudioData(data))
    .catch(() => null);
  buffers.set(name, pending);
  return pending;
}

export function playSound(cue: Cue): void {
  if (!enabled) return;
  const ctx = ensure();
  if (!ctx || !master) return;
  if (ctx.state === "suspended") void ctx.resume();
  const names = VARIANTS[cue];
  if (names.length === 0) return;
  const name = names[Math.floor(Math.random() * names.length)];
  const out = master;
  void load(ctx, name).then(buffer => {
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // Un filo di variazione d'intonazione: lo stesso campione non suona mai
    // proprio uguale.
    source.playbackRate.value = 0.94 + Math.random() * 0.12;
    const gain = ctx.createGain();
    gain.gain.value = LEVEL[cue];
    source.connect(gain);
    gain.connect(out);
    source.start();
  });
}
