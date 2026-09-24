// La musica della fine partita (2026-09-24, «quando vinci deve partire un
// suono in loop di vittoria e non sentirsi la musica, stessa cosa perdita»):
// due brevi temi sintetizzati con la Web Audio API, resi una volta fuori
// linea (OfflineAudioContext) in un giro chiuso e girati in loop al posto
// del brano del tavolo, finché non si esce o non si ricomincia (sound.ts).
//
// La vittoria: una fanfara luminosa in Do maggiore a 120 battute — ottoni
// di sega e quadra su un tappeto d'accordi (I–V–vi–IV), il basso sui
// quarti, la cassa, il rullante e i piatti, e in alto un arpeggio che
// scintilla. La sconfitta: un lamento lento in La minore a 80 — un bordone
// grave che respira, un tappeto scuro, una melodia che scende con la sua
// eco, i timpani a ogni battuta e il vento sotto.
//
// Il giro si chiude senza cucitura: si rende il tema due volte di seguito
// e si tiene solo il secondo passaggio — all'inizio ha già le code del giro
// prima e il compressore a regime, e ciò che avanza in fondo è la stessa
// coda che sta in testa. Niente da ripiegare.

export type Outcome = "won" | "lost";

/** La lunghezza del giro, in secondi. */
const LOOP_S: Record<Outcome, number> = { won: 8, lost: 12 };
/** Il livello del tema rispetto ai brani normalizzati del tavolo: si tara a orecchio (e con l'RMS, scripts/tmp). */
const LEVEL: Record<Outcome, number> = { won: 0.55, lost: 0.6 };

const midi = (n: number): number => 440 * 2 ** ((n - 69) / 12);
// Le note per nome: C4 = 60.
const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function pitch(name: string): number {
  const match = /^([A-G])(#?)(-?\d)$/.exec(name);
  if (!match) throw new Error(`nota ignota: ${name}`);
  return midi(NOTE[match[1]!]! + (match[2] ? 1 : 0) + (Number(match[3]) + 1) * 12);
}

interface Voice {
  ctx: OfflineAudioContext;
  out: AudioNode;
  /** Il secondo di una battuta (beat). */
  beat: number;
  /** Dove comincia questo passaggio del giro, in secondi. */
  t0: number;
}

/** Un inviluppo ADSR semplice, in secondi, con la coda esponenziale. */
function adsr(param: AudioParam, at: number, peak: number, attack: number, hold: number, release: number, sustain = 1): void {
  param.setValueAtTime(0.0001, at);
  param.linearRampToValueAtTime(peak, at + attack);
  param.setValueAtTime(peak * sustain, at + attack + hold);
  param.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
}

/** Un oscillatore con inviluppo, opzionalmente filtrato e scordato di qualche cent. */
function tone(
  v: Voice,
  type: OscillatorType,
  hz: number,
  at: number,
  length: number,
  peak: number,
  shape: { attack?: number; release?: number; detune?: number; lowpass?: number; sustain?: number } = {}
): void {
  const { ctx } = v;
  at += v.t0;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = hz;
  osc.detune.value = shape.detune ?? 0;
  const gain = ctx.createGain();
  const attack = shape.attack ?? 0.01;
  const release = shape.release ?? 0.15;
  adsr(gain.gain, at, peak, attack, Math.max(0.01, length - attack), release, shape.sustain ?? 1);
  let head: AudioNode = osc;
  if (shape.lowpass) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = shape.lowpass;
    filter.Q.value = 0.7;
    osc.connect(filter);
    head = filter;
  }
  head.connect(gain).connect(v.out);
  osc.start(at);
  osc.stop(at + length + release + 0.05);
}

/** Rumore bianco tagliato da un filtro, con inviluppo: piatti, rullante, vento. */
function hiss(v: Voice, at: number, peak: number, attack: number, decay: number, type: BiquadFilterType, hz: number, q = 1): void {
  const { ctx } = v;
  at += v.t0;
  const length = Math.floor(ctx.sampleRate * (attack + decay + 0.1));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = hz;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  source.connect(filter).connect(gain).connect(v.out);
  source.start(at);
  source.stop(at + attack + decay + 0.05);
}

/** La cassa (o il timpano): una sinusoide che scende di tono. */
function thump(v: Voice, at: number, from: number, to: number, decay: number, peak: number): void {
  const { ctx } = v;
  at += v.t0;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + decay * 0.6);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(peak, at + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  osc.connect(gain).connect(v.out);
  osc.start(at);
  osc.stop(at + decay + 0.05);
}

/** Un accordo tenuto: tre onde per nota, scordate di pochi cent, dietro un passa-basso. */
function pad(v: Voice, notes: string[], at: number, length: number, peak: number, type: OscillatorType, lowpass: number): void {
  for (const name of notes) {
    for (const detune of [-7, 0, 7]) tone(v, type, pitch(name), at, length, peak / 3, { attack: 0.12, release: 0.45, detune, lowpass });
  }
}

// --- la vittoria ----------------------------------------------------------

/** [battuta d'inizio, durata in battute, nota] */
type Line = [number, number, string][];

function victory(v: Voice): void {
  const { beat } = v;
  const bar = 4 * beat;
  const chords: string[][] = [
    ["C4", "E4", "G4"],
    ["B3", "D4", "G4"],
    ["A3", "C4", "E4"],
    ["A3", "C4", "F4"],
  ];
  const roots = ["C2", "G2", "A2", "F2"];
  // Il tappeto e il basso, per battuta.
  chords.forEach((chord, i) => {
    pad(v, chord, i * bar, bar - 0.05, 0.11, "sawtooth", 1400);
    for (let q = 0; q < 4; q += 1) {
      const at = i * bar + q * beat;
      tone(v, "triangle", pitch(roots[i]!), at, beat * 0.55, 0.22, { attack: 0.005, release: 0.12 });
      tone(v, "sine", pitch(roots[i]!) / 2, at, beat * 0.55, 0.14, { attack: 0.005, release: 0.12 });
    }
  });
  // La fanfara: ottoni (sega e quadra scordate) col passa-basso.
  const fanfare: Line = [
    [0, 0.5, "G4"], [0.5, 0.5, "G4"], [1, 1, "C5"], [2, 1, "E5"], [3, 1, "G5"],
    [4, 1.5, "D5"], [5.5, 0.5, "E5"], [6, 1, "D5"], [7, 1, "B4"],
    [8, 0.5, "C5"], [8.5, 0.5, "C5"], [9, 1, "E5"], [10, 1, "A5"], [11, 1, "G5"],
    [12, 1, "F5"], [13, 1, "E5"], [14, 0.5, "D5"], [14.5, 0.5, "E5"], [15, 1, "G5"],
  ];
  for (const [start, length, name] of fanfare) {
    const at = start * beat;
    const held = length * beat * 0.9;
    tone(v, "sawtooth", pitch(name), at, held, 0.09, { attack: 0.02, release: 0.1, detune: -5, lowpass: 2600 });
    tone(v, "square", pitch(name), at, held, 0.05, { attack: 0.02, release: 0.1, detune: 6, lowpass: 1800 });
    tone(v, "sawtooth", pitch(name) / 2, at, held, 0.05, { attack: 0.02, release: 0.1, lowpass: 1600 });
  }
  // L'arpeggio che scintilla: sedicesimi in alto sulle note dell'accordo.
  chords.forEach((chord, i) => {
    for (let s = 0; s < 16; s += 1) {
      const name = chord[s % 3]!;
      const hz = pitch(name) * 4;
      tone(v, "triangle", hz, i * bar + (s * beat) / 4, beat / 4 - 0.02, 0.035, { attack: 0.004, release: 0.08 });
    }
  });
  // La batteria: cassa sui quarti, rullante su 2 e 4, charleston sugli ottavi, il piatto all'inizio del giro.
  for (let b = 0; b < 16; b += 1) {
    const at = b * beat;
    thump(v, at, 150, 48, 0.28, 0.6);
    if (b % 4 === 1 || b % 4 === 3) {
      hiss(v, at, 0.35, 0.002, 0.16, "bandpass", 1900, 0.8);
      thump(v, at, 220, 160, 0.12, 0.25);
    }
    hiss(v, at, 0.09, 0.001, 0.045, "highpass", 7500);
    hiss(v, at + beat / 2, 0.06, 0.001, 0.035, "highpass", 8500);
  }
  hiss(v, 0, 0.16, 0.003, 1.4, "bandpass", 5200, 0.4);
  hiss(v, 8 * beat, 0.12, 0.003, 1.1, "bandpass", 5200, 0.4);
}

// --- la sconfitta ---------------------------------------------------------

function defeat(v: Voice): void {
  const { beat, ctx } = v;
  const bar = 4 * beat;
  const chords: string[][] = [
    ["A2", "C3", "E3"],
    ["F2", "A2", "C3"],
    ["D3", "F3", "A3"],
    ["E2", "G#2", "B2"],
  ];
  chords.forEach((chord, i) => pad(v, chord, i * bar, bar - 0.02, 0.1, "sawtooth", 520));
  // Il bordone grave che respira: la tonica un'ottava sotto, col tremolo lento.
  const drone = ctx.createOscillator();
  drone.type = "sine";
  drone.frequency.value = pitch("A1");
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.16;
  const lfo = ctx.createOscillator();
  // Sei cicli esatti nel giro: il respiro si ricongiunge senza scalino.
  lfo.frequency.value = 0.5;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.05;
  lfo.connect(lfoDepth).connect(droneGain.gain);
  drone.connect(droneGain).connect(v.out);
  drone.start(v.t0);
  lfo.start(v.t0);
  drone.stop(v.t0 + 4 * bar);
  lfo.stop(v.t0 + 4 * bar);
  // La melodia che scende, con la sua eco.
  const lament: Line = [
    [0, 2, "E5"], [2, 2, "C5"],
    [4, 2, "B4"], [6, 2, "A4"],
    [8, 2, "G4"], [10, 2, "F4"],
    [12, 4, "E4"],
  ];
  for (const [start, length, name] of lament) {
    const at = start * beat;
    const held = length * beat * 0.95;
    tone(v, "triangle", pitch(name), at, held, 0.11, { attack: 0.18, release: 0.6, lowpass: 1500, sustain: 0.8 });
    tone(v, "sine", pitch(name) * 2, at, held, 0.03, { attack: 0.25, release: 0.6 });
    tone(v, "triangle", pitch(name), at + beat * 0.75, held * 0.6, 0.045, { attack: 0.12, release: 0.6, lowpass: 1000 });
  }
  // I timpani a ogni battuta, più forte sull'ultima.
  for (let i = 0; i < 4; i += 1) {
    thump(v, i * bar, 80, 52, 0.9, i === 3 ? 0.55 : 0.4);
    thump(v, i * bar + beat * 2.5, 70, 50, 0.5, 0.18);
  }
  // Il vento sotto, per tutto il giro.
  hiss(v, 0, 0.05, 2, 4 * bar - 2, "lowpass", 380, 0.5);
}

// --- la resa fuori linea ---------------------------------------------------

/**
 * Rende il tema in un giro chiuso, alla frequenza di campionamento data:
 * due passaggi, si tiene il secondo, così il loop non si sente.
 */
export async function renderOutcomeLoop(sampleRate: number, outcome: Outcome): Promise<AudioBuffer> {
  const loop = LOOP_S[outcome];
  const total = 2 * loop;
  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * total), sampleRate);
  const out = ctx.createGain();
  out.gain.value = LEVEL[outcome];
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -14;
  glue.ratio.value = 4;
  glue.attack.value = 0.01;
  glue.release.value = 0.25;
  out.connect(glue).connect(ctx.destination);
  const beat = outcome === "won" ? 60 / 120 : 60 / 80;
  for (const t0 of [0, loop]) {
    const voice: Voice = { ctx, out, beat, t0 };
    if (outcome === "won") victory(voice);
    else defeat(voice);
  }
  const rendered = await ctx.startRendering();
  const frames = Math.floor(sampleRate * loop);
  const second = new AudioBuffer({ numberOfChannels: rendered.numberOfChannels, length: frames, sampleRate });
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    const source = rendered.getChannelData(channel);
    const target = second.getChannelData(channel);
    for (let i = 0; i < frames; i += 1) target[i] = source[frames + i]!;
  }
  return second;
}
