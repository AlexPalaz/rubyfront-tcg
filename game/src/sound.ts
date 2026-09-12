// I suoni e la musica del gioco: gli stessi del simulatore (simulatore/src/
// sound.ts), coi file in simulatore/public (sounds/, music/) che il gioco
// serve dalla stessa cartella (vite.config.ts, publicDir). Suoni disegnati
// a strati con materie prime CC0 di Kenney, due o tre varianti per voce,
// un filo di variazione d'intonazione; la musica in loop sotto ai suoni.
// Web Audio API: il contesto nasce al primo gesto (unlockSound).

export type Cue = "select" | "button" | "play" | "attack" | "block" | "counter" | "draw" | "phase" | "tap";

/** Le varianti di ogni voce: i file in sounds/, senza estensione. */
const VARIANTS: Record<Cue, string[]> = {
  select: ["select-1", "select-2"],
  draw: ["draw-1", "draw-2", "draw-3"],
  play: ["play-1", "play-2"],
  button: ["button-1", "button-2"],
  // La fase: montata ma non usata — «togli i suoni di ogni fase» (2026-09-07).
  phase: [],
  tap: ["tap-1", "tap-2", "tap-3"],
  attack: ["attack-1", "attack-2", "attack-3"],
  block: ["block-1", "block-2"],
  counter: ["counter-1", "counter-2"],
};

/** Il volume di ogni voce: i colpi pesanti sotto, i tocchi leggeri più vicini. */
const LEVEL: Record<Cue, number> = { select: 0.7, button: 0.55, play: 0.9, draw: 0.6, attack: 0.8, block: 0.85, counter: 0.8, phase: 0.9, tap: 0.5 };

/** I brani: la home e il tavolo. */
export const HOME_MUSIC = "strategic-dawn";
export const TABLE_MUSIC = "neon-medieval-arena";

const MASTER_GAIN = 0.6;
const MUSIC_GAIN = 0.2;
const MUSIC_FADE_IN_S = 1.4;
const MUSIC_FADE_OUT_S = 1.6;
/** Fra un brano e l'altro, due secondi di silenzio. */
const MUSIC_GAP_MS = 2000;
/** La fine del loop 50 ms prima dell'ultimo campione: Chrome sennò ammutolisce al primo giro. */
const LOOP_TAIL_S = 0.05;
const EXTENSION = "m4a";

let context: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let musicEnabled = true;
let music: { name: string; source: AudioBufferSourceNode; gain: GainNode } | null = null;
let musicWanted: string | null = null;
let musicStoppedAt = 0;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function ensure(): AudioContext | null {
  if (context) return context;
  const Ctor = window.AudioContext as typeof AudioContext | undefined;
  if (!Ctor) return null;
  context = new Ctor();
  master = context.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(context.destination);
  return context;
}

function load(ctx: AudioContext, path: string): Promise<AudioBuffer | null> {
  const known = buffers.get(path);
  if (known) return known;
  const url = new URL(`${path}.${EXTENSION}`, document.baseURI).href;
  const pending = fetch(url)
    .then(response => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(response.statusText))))
    .then(data => ctx.decodeAudioData(data))
    .catch(() => null);
  buffers.set(path, pending);
  return pending;
}

export function soundEnabled(): boolean {
  return enabled;
}

export function musicOn(): boolean {
  return musicEnabled;
}

/** I suoni delle carte: indipendenti dalla musica. */
export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export function setMusicEnabled(on: boolean): void {
  musicEnabled = on;
  if (!on) {
    const wanted = musicWanted;
    stopMusic(true);
    musicWanted = wanted;
  } else if (musicWanted) startMusic(musicWanted);
}

/** Al primo gesto: il contesto nasce e, se sospeso, riparte; i campioni si caricano. */
export function unlockSound(): void {
  if (!enabled && !musicEnabled) return;
  const ctx = ensure();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  if (musicWanted && !music) startMusic(musicWanted);
  if (!enabled) return;
  for (const names of Object.values(VARIANTS)) for (const name of names) void load(ctx, `sounds/${name}`);
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
  void load(ctx, `sounds/${name}`).then(buffer => {
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.94 + Math.random() * 0.12;
    const gain = ctx.createGain();
    gain.gain.value = LEVEL[cue];
    source.connect(gain);
    gain.connect(out);
    source.start();
  });
}

/** Il brano parte in dissolvenza e gira in loop finché non lo si ferma; `restart` lo riprende da capo. */
export function startMusic(name: string, restart = false): void {
  if (restart && music) stopMusic(true);
  musicWanted = name;
  if (!musicEnabled) return;
  if (music?.name === name) return;
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
  void load(ctx, `music/${name}`).then(buffer => {
    if (!buffer || musicWanted !== name || music?.name === name) return;
    const attack = (): void => {
      if (musicWanted !== name || music?.name === name || !musicEnabled) return;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(MUSIC_GAIN, ctx.currentTime + MUSIC_FADE_IN_S);
      gain.connect(out);
      spin(ctx, buffer, name, gain);
    };
    if (gap > 0) setTimeout(attack, gap);
    else attack();
  });
}

function spin(ctx: AudioContext, buffer: AudioBuffer, name: string, gain: GainNode): void {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = 0;
  source.loopEnd = Math.max(1, buffer.duration - LOOP_TAIL_S);
  source.connect(gain);
  source.onended = () => {
    if (music?.source !== source || musicWanted !== name) return;
    spin(ctx, buffer, name, gain);
  };
  source.start();
  music = { name, source, gain };
}

/** Il brano si spegne in dissolvenza (o di colpo). */
export function stopMusic(abrupt = false): void {
  musicWanted = null;
  const playing = music;
  if (!playing) return;
  music = null;
  musicStoppedAt = performance.now();
  fadeOut(playing, abrupt ? 0.08 : MUSIC_FADE_OUT_S);
}

function fadeOut(playing: { source: AudioBufferSourceNode; gain: GainNode }, tail: number): void {
  if (!context) return;
  const now = context.currentTime;
  playing.gain.gain.cancelScheduledValues(now);
  playing.gain.gain.setValueAtTime(playing.gain.gain.value, now);
  playing.gain.gain.linearRampToValueAtTime(0, now + tail);
  playing.source.stop(now + tail + 0.05);
}
