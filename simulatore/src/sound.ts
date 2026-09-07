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
//   attack  — la lama che esce, il taglio, il colpo di metallo
//   block   — lo scudo: piastra, legno pesante sotto, fermaglio sopra
//   counter — il taglio, il metallo pesante e il rintocco
//
// Si suona con la Web Audio API (decodifica una volta, poi buffer in
// memoria): il browser non suona prima di un gesto dell'utente, quindi il
// contesto nasce al primo tocco (unlock). Formato: AAC (m4a), che ogni
// browser decodifica. L'interruttore nelle impostazioni spegne
// tutto; la scelta resta salvata (main.ts).

export type Cue = "select" | "button" | "play" | "attack" | "block" | "counter" | "draw" | "phase";

/** Le varianti di ogni voce: i file in public/sounds, senza estensione. */
const VARIANTS: Record<Cue, string[]> = {
  select: ["select-1", "select-2"],
  draw: ["draw-1", "draw-2", "draw-3"],
  play: ["play-1", "play-2"],
  button: ["button-1", "button-2"],
  // La fase: montata ma non usata — «togli i suoni di ogni fase».
  phase: [],
  attack: ["attack-1", "attack-2"],
  block: ["block-1", "block-2"],
  counter: ["counter-1", "counter-2"],
};

/** Il volume di ogni voce: i colpi pesanti sotto, i tocchi leggeri più vicini. */
const LEVEL: Record<Cue, number> = { select: 0.7, button: 0.55, play: 0.9, draw: 0.6, attack: 0.8, block: 0.85, counter: 0.8, phase: 0.9 };

let context: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

/** Il volume generale: sommesso, sotto la voce della chat vocale. */
const MASTER_GAIN = 0.6;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}
export function soundEnabled(): boolean {
  return enabled;
}

/** Al primo gesto: il contesto nasce e, se sospeso, riparte; i campioni si caricano. */
export function unlockSound(): void {
  if (!enabled) return;
  const ctx = ensure();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
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
