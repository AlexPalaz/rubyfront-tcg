// I suoni del tavolo: sintetizzati al volo con la Web Audio API — niente
// file, niente licenze, niente da scaricare. Sei voci, brevi e sommesse:
//
//   select  — un tocco, quando si prende una carta o si sceglie un bersaglio
//   button  — uno scatto, sui tasti (Fine fase, Continua, Risolvi, conferme)
//   play    — un colpo sordo con un fruscio: la carta posata sul Fronte
//   attack  — un taglio: l'attacco dichiarato
//   block   — un tonfo: il blocco
//   counter — un rintocco metallico: il contrattacco
//
// Il browser non suona prima di un gesto dell'utente: il contesto audio
// nasce al primo tocco (unlock) e da lì in poi risponde. L'interruttore
// nelle impostazioni spegne tutto; la scelta resta salvata (main.ts).

export type Cue = "select" | "button" | "play" | "attack" | "block" | "counter";

let context: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

/** Il volume generale: sommesso, sotto la voce della chat vocale. */
const MASTER_GAIN = 0.32;

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
  return context;
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
  env.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, start + ms / 1000);
  osc.connect(env);
  env.connect(out);
  osc.start(start);
  osc.stop(start + ms / 1000 + 0.02);
}

/** Un soffio di rumore filtrato, per colpi e tagli. */
function noise(ctx: AudioContext, out: AudioNode, kind: BiquadFilterType, frequency: number, ms: number, gain: number, at = 0): void {
  const length = Math.ceil((ctx.sampleRate * ms) / 1000);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = kind;
  filter.frequency.value = frequency;
  const env = ctx.createGain();
  const start = ctx.currentTime + at;
  env.gain.setValueAtTime(gain, start);
  env.gain.exponentialRampToValueAtTime(0.0001, start + ms / 1000);
  source.connect(filter);
  filter.connect(env);
  env.connect(out);
  source.start(start);
}

export function playSound(cue: Cue): void {
  if (!enabled) return;
  const ctx = ensure();
  if (!ctx || !master) return;
  if (ctx.state === "suspended") void ctx.resume();
  const out = master;
  switch (cue) {
    case "select":
      tone(ctx, out, "sine", 880, 1320, 55, 0.25);
      break;
    case "button":
      tone(ctx, out, "triangle", 620, 760, 45, 0.28);
      tone(ctx, out, "triangle", 930, 1100, 60, 0.18, 0.04);
      break;
    case "play":
      noise(ctx, out, "lowpass", 900, 140, 0.35);
      tone(ctx, out, "sine", 150, 70, 220, 0.5, 0.02);
      break;
    case "attack":
      noise(ctx, out, "highpass", 1400, 160, 0.4);
      tone(ctx, out, "sawtooth", 1500, 300, 180, 0.16, 0.01);
      break;
    case "block":
      noise(ctx, out, "lowpass", 320, 180, 0.45);
      tone(ctx, out, "sine", 110, 60, 260, 0.55);
      break;
    case "counter":
      tone(ctx, out, "sine", 1180, 1150, 420, 0.28);
      tone(ctx, out, "sine", 1760, 1700, 360, 0.16, 0.01);
      noise(ctx, out, "highpass", 3000, 70, 0.2);
      break;
  }
}
