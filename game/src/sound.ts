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
  // La giocata non usa più i file: suona l'incastonamento sintetizzato (playSocket), all'urto sul tavolo.
  play: [],
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

/** La tinta della carta che si posa: appena più grave la Distruttiva, più acuta la Dinamica. */
export type SocketTint = "destructive" | "dimensional" | "dynamic";

/**
 * Lo stile del colpo (2026-09-12, su richiesta del designer: «tipo Dragon
 * Ball», niente gong né padelle): corto, secco, senza note che restano.
 * «stone» la pietra che si incastona (scelta dal designer: il clac della
 * pietra, lo scatto con cui si assesta nel castone, i granelli); «punch» il
 * pugno pieno (schiocco, calcio, schiaffo, folata d'aria); «zip» il vwip del
 * teletrasporto e un pop; «blast» l'esplosione di ki.
 */
export type SocketStyle = "stone" | "punch" | "zip" | "blast";
export const SOCKET_STYLE: SocketStyle = "stone";

const TINT_PITCH: Record<SocketTint, number> = { destructive: 0.9, dimensional: 1, dynamic: 1.1 };

/** Due secondi di rumore bianco per contesto: lo tagliano filtri e inviluppi. */
const noises = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext): AudioBuffer {
  const known = noises.get(ctx);
  if (known) return known;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  noises.set(ctx, buffer);
  return buffer;
}

/** La saturazione morbida (tanh): la grana croccante del colpo. */
function grit(amount: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i += 1) curve[i] = Math.tanh(amount * ((i / (curve.length - 1)) * 2 - 1));
  return curve;
}

function envelope(param: AudioParam, peak: number, attack: number, decay: number, at: number): void {
  param.setValueAtTime(0.0001, at);
  param.exponentialRampToValueAtTime(peak, at + attack);
  param.exponentialRampToValueAtTime(0.0001, at + attack + decay);
}

/** Un colpo di rumore filtrato: `shape` sistema il filtro (fisso o in corsa). */
function burst(ctx: BaseAudioContext, into: AudioNode, at: number, peak: number, attack: number, decay: number, shape: (filter: BiquadFilterNode) => void): void {
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  shape(filter);
  const gain = ctx.createGain();
  envelope(gain.gain, peak, attack, decay, at);
  source.connect(filter).connect(gain).connect(into);
  source.start(at, Math.random() * 1.2);
  source.stop(at + attack + decay + 0.02);
}

/** Un'onda che scende (o sale) di tono con il suo inviluppo. */
function sweep(ctx: BaseAudioContext, into: AudioNode, type: OscillatorType, from: number, to: number, glide: number, at: number, peak: number, attack: number, decay: number): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + glide);
  const gain = ctx.createGain();
  envelope(gain.gain, peak, attack, decay, at);
  osc.connect(gain).connect(into);
  osc.start(at);
  osc.stop(at + attack + decay + 0.02);
}

/**
 * Un colpo su un corpo pieno (sintesi modale): un soffio di rumore di pochi
 * millisecondi eccita risonanze strette e molto smorzate — pietra, non
 * metallo: si spengono in qualche decina di millisecondi, nessuna resta.
 */
function knock(ctx: BaseAudioContext, into: AudioNode, at: number, modes: readonly (readonly [number, number, number])[], excite: number, level: number): void {
  const length = Math.max(8, Math.floor(ctx.sampleRate * excite));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  for (const [frequency, q, gain] of modes) {
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = frequency;
    band.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.value = gain * level;
    source.connect(band).connect(amp).connect(into);
  }
  source.start(at);
}

/** Il volo: la carta che sfreccia (effects/director.ts, all'inizio dell'arco). */
export function playWhoosh(ms: number): void {
  if (!enabled) return;
  const ctx = ensure();
  if (!ctx || !master) return;
  if (ctx.state === "suspended") void ctx.resume();
  renderWhoosh(ctx, master, ms);
}

/** Il colpo all'urto sul tavolo (effects/director.ts), nello stile scelto. */
export function playSocket(tint: SocketTint, strength = 1): void {
  if (!enabled) return;
  const ctx = ensure();
  if (!ctx || !master) return;
  if (ctx.state === "suspended") void ctx.resume();
  renderSocket(ctx, master, tint, strength);
}

/** Lo sfrecciare: aria che accelera e sale (un passa-banda in corsa), da sinistra a destra, e sotto una sega che sale — la linea di velocità. */
export function renderWhoosh(ctx: BaseAudioContext, out: AudioNode, ms: number, at = 0): void {
  const t0 = ctx.currentTime + 0.005 + at;
  const length = Math.max(0.15, ms / 1000);
  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(-0.5, t0);
  pan.pan.linearRampToValueAtTime(0.5, t0 + length);
  pan.connect(out);
  burst(ctx, pan, t0, 0.38, length * 0.85, 0.08, filter => {
    filter.type = "bandpass";
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(350, t0);
    filter.frequency.exponentialRampToValueAtTime(2800, t0 + length);
  });
  const zipBand = ctx.createBiquadFilter();
  zipBand.type = "bandpass";
  zipBand.frequency.value = 1400;
  zipBand.Q.value = 2;
  zipBand.connect(pan);
  sweep(ctx, zipBand, "sawtooth", 180, 1100, length, t0, 0.07, length * 0.9, 0.06);
}

/** Il colpo: corto e secco, saturo, con solo un filo di stanza — nessuna nota che resta. */
export function renderSocket(ctx: BaseAudioContext, out: AudioNode, tint: SocketTint, strength = 1, style: SocketStyle = SOCKET_STYLE, at = 0): void {
  const t0 = ctx.currentTime + 0.005 + at;
  const p = TINT_PITCH[tint] * (0.96 + Math.random() * 0.08);
  const level = Math.min(1.4, Math.max(0.4, strength));
  const shaper = ctx.createWaveShaper();
  shaper.curve = grit(style === "blast" ? 4 : style === "stone" ? 1.8 : 2.6);
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -12;
  glue.ratio.value = 5;
  glue.attack.value = 0.002;
  glue.release.value = 0.12;
  const output = ctx.createGain();
  // La pietra ha meno aria del pugno: esce un poco più forte, alla pari degli altri colpi.
  output.gain.value = (style === "stone" ? 0.96 : 0.8) * level;
  shaper.connect(glue).connect(output).connect(out);
  const bus = ctx.createGain();
  bus.connect(shaper);
  switch (style) {
    case "stone": {
      // Il clac: la pietra che batte nel castone — risonanze di pietra, spente subito.
      knock(ctx, bus, t0, [[380 * p, 18, 3], [690 * p, 16, 2.4], [1180 * p, 14, 1.6], [1920 * p, 12, 0.9], [3100 * p, 10, 0.4]], 0.004, 1);
      // Il peso: un colpo grave e breve sotto la pietra.
      sweep(ctx, bus, "sine", 150 * p, 58 * p, 0.07, t0, 0.7, 0.002, 0.12);
      // Lo scatto: 45 ms dopo, la pietra si assesta nell'alloggio — un clic più piccolo e più alto.
      knock(ctx, bus, t0 + 0.045, [[900 * p, 12, 1.6], [1600 * p, 12, 1], [2600 * p, 10, 0.5]], 0.002, 0.55);
      // La folata d'aria, leggera: il carattere del colpo.
      burst(ctx, bus, t0 + 0.005, 0.18, 0.004, 0.18, filter => {
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(2400, t0);
        filter.frequency.exponentialRampToValueAtTime(300, t0 + 0.18);
      });
      // I granelli che si assestano: quattro crepitii minuti, a caso fra 60 e 160 ms.
      for (let i = 0; i < 4; i += 1) {
        const when = t0 + 0.06 + Math.random() * 0.1;
        burst(ctx, bus, when, 0.06 + Math.random() * 0.08, 0.0008, 0.004, filter => ((filter.type = "highpass"), (filter.frequency.value = 2500)));
      }
      break;
    }
    case "punch":
      // Lo schiocco, il calcio grave e breve, lo schiaffo nei medi, la folata d'aria che si chiude.
      burst(ctx, bus, t0, 0.9, 0.001, 0.06, filter => ((filter.type = "highpass"), (filter.frequency.value = 900)));
      sweep(ctx, bus, "sine", 190 * p, 52 * p, 0.09, t0, 1, 0.002, 0.2);
      burst(ctx, bus, t0, 0.6, 0.002, 0.12, filter => ((filter.type = "bandpass"), (filter.frequency.value = 1100 * p), (filter.Q.value = 0.9)));
      burst(ctx, bus, t0 + 0.01, 0.45, 0.004, 0.3 * level, filter => {
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(3200, t0);
        filter.frequency.exponentialRampToValueAtTime(260, t0 + 0.3);
      });
      break;
    case "zip":
      // Il vwip che sale in un lampo, poi il pop e un soffio.
      sweep(ctx, bus, "sine", 260 * p, 2600 * p, 0.07, t0, 0.35, 0.004, 0.08);
      sweep(ctx, bus, "sawtooth", 260 * p, 2600 * p, 0.07, t0, 0.08, 0.004, 0.08);
      sweep(ctx, bus, "sine", 240 * p, 90 * p, 0.05, t0 + 0.07, 0.8, 0.002, 0.1);
      burst(ctx, bus, t0 + 0.07, 0.5, 0.001, 0.03, filter => ((filter.type = "highpass"), (filter.frequency.value = 1500)));
      burst(ctx, bus, t0 + 0.08, 0.2, 0.004, 0.15, filter => {
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(2000, t0 + 0.08);
        filter.frequency.exponentialRampToValueAtTime(400, t0 + 0.24);
      });
      break;
    case "blast":
      // L'esplosione di ki: il colpo che precipita e la vampata satura che si chiude.
      sweep(ctx, bus, "sine", 130 * p, 38 * p, 0.35, t0, 1, 0.003, 0.45);
      burst(ctx, bus, t0, 0.7, 0.004, 0.5 * level, filter => {
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(5000, t0);
        filter.frequency.exponentialRampToValueAtTime(220, t0 + 0.45);
      });
      burst(ctx, bus, t0, 0.15, 0.002, 0.2, filter => ((filter.type = "highpass"), (filter.frequency.value = 2500)));
      break;
  }
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
