// Il dado, al centro del tavolo: un tiro non è un numero in chat, è un
// momento. Il dado rotola su un velo scuro, le facce lampeggiano, poi si
// ferma sul risultato e resta acceso per due secondi. Chi lo tira lo vede
// prima di tutti; l'avversario lo vede quando l'azione col tiro gli arriva
// (main.ts, receive). Con prefers-reduced-motion niente rotolata: il
// risultato compare e resta.

const ROLL_MS = 1100;
const FLICKER_MS = 70;
const HOLD_MS = 2000;
const FADE_MS = 300;

/** Le facce del d6 disegnate a pallini: gli altri tagli mostrano il numero. */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function paintFace(face: HTMLElement, faces: number, value: number): void {
  face.replaceChildren();
  if (faces === 6) {
    for (let cell = 0; cell < 9; cell += 1) {
      const pip = document.createElement("span");
      pip.className = "die-pip";
      if (!PIPS[value].includes(cell)) pip.classList.add("is-off");
      face.append(pip);
    }
    face.classList.add("is-pips");
    return;
  }
  face.classList.remove("is-pips");
  face.textContent = String(value);
}

/**
 * Mostra il tiro di un d`faces` che dà `result`, sopra `root` (il tavolo).
 * `label` è il rigo sotto: «Schieramento del Rubyfront». La promessa si
 * chiude quando il velo è sparito: chi aspetta il dado per agire (lo
 * schieramento) parte da lì.
 */
export function showRoll(root: HTMLElement, faces: number, result: number, label: string): Promise<void> {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const veil = document.createElement("div");
  veil.className = "dice-roll";
  const die = document.createElement("div");
  die.className = "die";
  die.dataset.faces = String(faces);
  const face = document.createElement("div");
  face.className = "die-face";
  die.append(face);
  const tag = document.createElement("div");
  tag.className = "dice-roll-tag";
  tag.textContent = `d${faces} · ${label}`;
  const out = document.createElement("div");
  out.className = "dice-roll-out";
  veil.append(die, out, tag);
  root.append(veil);

  return new Promise(resolve => {
    const settle = (): void => {
      paintFace(face, faces, result);
      out.textContent = String(result);
      die.classList.remove("is-rolling");
      die.classList.add("is-settled");
      veil.classList.add("is-settled");
      window.setTimeout(() => {
        veil.classList.add("is-leaving");
        window.setTimeout(() => {
          veil.remove();
          resolve();
        }, FADE_MS);
      }, HOLD_MS);
    };
    if (still) {
      settle();
      return;
    }
    die.classList.add("is-rolling");
    paintFace(face, faces, 1 + Math.floor(Math.random() * faces));
    const flicker = window.setInterval(() => paintFace(face, faces, 1 + Math.floor(Math.random() * faces)), FLICKER_MS);
    window.setTimeout(() => {
      window.clearInterval(flicker);
      settle();
    }, ROLL_MS);
  });
}
