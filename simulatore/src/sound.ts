// I suoni del tavolo: sintetizzati al volo con la Web Audio API — niente
// file, niente licenze, niente da scaricare. Sei voci, brevi e sommesse:
//
//   select  — la chiave che gira: un tocco grave e corto (prendere, scegliere)
//   button  — la gemma nel castone: il colpo pieno dei tasti
//   play    — pietra su pietra: la carta posata sul Fronte
//   attack  — la lama che cala, poi il colpo
//   block   — lo scudo: un tonfo grave e lungo
//   counter — la campana bassa sopra il colpo
//
// Tutti gravi, di pietra e di metallo (deciso 2026-09-07): la voce comune è
// l'INCASTONAMENTO — un colpo basso, un tocco metallico brevissimo, una
// risonanza — con un filtro che toglie l'acuto e un riverbero corto.
//
// Il browser non suona prima di un gesto dell'utente: il contesto audio
// nasce al primo tocco (unlock) e da lì in poi risponde. L'interruttore
// nelle impostazioni spegne tutto; la scelta resta salvata (main.ts).

export type Cue = "select" | "button" | "play" | "attack" | "block" | "counter";

let context: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

/** Il volume generale: sommesso, sotto la voce della chat vocale. */
const MASTER_GAIN = 0.4;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}
export function soundEnabled(): boolean {
  return enabled;
}

/** Al primo gesto: il contesto nasce e, se sospeso, riparte. */
export function unlockSound(): void {
  if (!enabled) return;
  const ctx = ensure();
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

/**
 * La catena d'uscita: un filtro che toglie le frequenze acute (i suoni
 * devono essere gravi, di pietra e metallo, non di plastica) e un po' di
 * ambiente — un riverbero corto, sintetizzato da rumore che decade — che
 * dà profondità al colpo, come in una sala di pietra.
 */
function ensure(): AudioContext | null {
  if (context) return context;
  const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
    | typeof AudioContext
    | undefined;
  if (!Ctor) return null;
  context = new Ctor();
  master = context.createGain();
  master.gain.value = MASTER_GAIN;
  const warmth = context.createBiquadFilter();
  warmth.type = "lowpass";
  warmth.frequency.value = 3600;
  warmth.Q.value = 0.5;
  master.connect(warmth);
  warmth.connect(context.destination);
  // L'ambiente: la coda riverberata, in parallelo, più bassa del suono secco.
  const room = context.createConvolver();
  room.buffer = impulse(context, 0.7, 2.6);
  const wet = context.createGain();
  wet.gain.value = 0.35;
  warmth.connect(room);
  room.connect(wet);
  wet.connect(context.destination);
  return context;
}

/** La risposta all'impulso di una stanza di pietra: rumore che decade. */
function impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.ceil(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  return buffer;
}

/** Un oscillatore che parte a `from` Hz, scivola a `to` e si spegne in `ms`. */
function tone(ctx: AudioContext, out: AudioNode, type: OscillatorType, from: number, to: number, ms: number, gain: number, at = 0): void {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  const start = ctx.currentTime + at;
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + ms / 1000);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, start + ms / 1000);
  osc.connect(env);
  env.connect(out);
  osc.start(start);
  osc.stop(start + ms / 1000 + 0.02);
}

/** Un soffio di rumore filtrato, per colpi, pietra e attrito. */
function noise(ctx: AudioContext, out: AudioNode, kind: BiquadFilterType, frequency: number, ms: number, gain: number, at = 0, q = 1): void {
  const length = Math.ceil((ctx.sampleRate * ms) / 1000);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 1.6);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = kind;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const env = ctx.createGain();
  const start = ctx.currentTime + at;
  env.gain.setValueAtTime(gain, start);
  env.gain.exponentialRampToValueAtTime(0.0001, start + ms / 1000);
  source.connect(filter);
  filter.connect(env);
  env.connect(out);
  source.start(start);
}

/**
 * L'incastonamento: il gesto-base di tutti i suoni del tavolo. Un colpo
 * grave (la gemma che tocca il fondo), un tocco metallico brevissimo (il
 * castone che la chiude) e una risonanza bassa che resta un attimo.
 */
function setting(ctx: AudioContext, out: AudioNode, thump: number, ring: number, size: number, at = 0): void {
  tone(ctx, out, "sine", thump * 1.4, thump, 90 * size, 0.55, at);
  tone(ctx, out, "sine", thump / 2, thump / 2.2, 260 * size, 0.22, at + 0.01);
  tone(ctx, out, "triangle", ring, ring * 0.92, 45, 0.09, at + 0.008);
  noise(ctx, out, "lowpass", 500, 70 * size, 0.18, at);
}

export function playSound(cue: Cue): void {
  if (!enabled) return;
  const ctx = ensure();
  if (!ctx || !master) return;
  if (ctx.state === "suspended") void ctx.resume();
  const out = master;
  switch (cue) {
    case "select":
      // La chiave che gira: un tocco grave, corto, con un filo di metallo.
      setting(ctx, out, 210, 1900, 0.7);
      break;
    case "button":
      // La gemma nel castone: più piena, con la sua risonanza.
      setting(ctx, out, 150, 1500, 1);
      break;
    case "play":
      // La carta posata: pietra su pietra — l'attrito prima, poi il colpo.
      noise(ctx, out, "lowpass", 380, 150, 0.35, 0, 0.7);
      setting(ctx, out, 105, 1250, 1.5, 0.05);
      break;
    case "attack":
      // Il taglio: la lama che esce e cala, poi il colpo grave.
      noise(ctx, out, "bandpass", 1100, 200, 0.45, 0, 1.2);
      tone(ctx, out, "sawtooth", 900, 180, 220, 0.12);
      setting(ctx, out, 130, 1700, 1.1, 0.12);
      break;
    case "block":
      // Lo scudo: un tonfo pieno di pietra, grave e lungo.
      noise(ctx, out, "lowpass", 220, 260, 0.5, 0, 0.8);
      tone(ctx, out, "sine", 95, 55, 460, 0.6);
      tone(ctx, out, "sine", 190, 120, 200, 0.2, 0.01);
      break;
    case "counter":
      // Il contrattacco: la campana bassa — tre parziali che decadono a
      // lungo — sopra il colpo.
      setting(ctx, out, 120, 1300, 1);
      tone(ctx, out, "sine", 440, 436, 800, 0.22, 0.03);
      tone(ctx, out, "sine", 660, 655, 620, 0.14, 0.03);
      tone(ctx, out, "sine", 1100, 1090, 380, 0.07, 0.03);
      break;
  }
}
