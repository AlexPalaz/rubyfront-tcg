// La misura della carta originale: dove sta ogni riquadro e ogni riga di
// testo, in pixel della carta (520×728, l'origine nell'angolo in alto a
// sinistra). Serve al confronto per dire non solo QUANTO la carta Pixi
// differisce, ma DOVE: una riga andata a capo altrove, un corpo diverso.

export interface Box {
  /** Il tag e le classi: `div.titlebar`, `span.tag`… */
  selector: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Line {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Il corpo del testo, in px. */
  body: number;
}

export interface Measure {
  boxes: Box[];
  lines: Line[];
}

const round = (value: number): number => Math.round(value * 10) / 10;

export function measure(card: Element): Measure {
  const origin = card.getBoundingClientRect();
  const boxes: Box[] = [];
  for (const node of card.querySelectorAll<HTMLElement | SVGElement>("*")) {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const classes = typeof node.className === "string" ? node.className.trim().split(/\s+/).filter(Boolean) : [];
    boxes.push({
      selector: [node.tagName.toLowerCase(), ...classes].join("."),
      x: round(rect.left - origin.left),
      y: round(rect.top - origin.top),
      w: round(rect.width),
      h: round(rect.height),
    });
  }

  // Le righe: carattere per carattere, i caratteri con la stessa cima stanno
  // sulla stessa riga. Gli spazi a fine riga non contano.
  const lines: Line[] = [];
  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const parent = node.parentElement;
    if (!parent || !text.trim() || parent.closest("svg")) continue;
    if (getComputedStyle(parent).display === "none") continue;
    const body = parseFloat(getComputedStyle(parent).fontSize);
    let current: Line | null = null;
    for (let index = 0; index < text.length; index += 1) {
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getClientRects()[0];
      if (!rect) continue;
      const top = rect.top - origin.top;
      if (!current || Math.abs(top - current.y) > rect.height / 2) {
        if (current) lines.push(finish(current));
        current = { text: "", x: rect.left - origin.left, y: top, w: 0, h: rect.height, body };
      }
      current.text += text[index];
      current.w = rect.right - origin.left - current.x;
    }
    if (current) lines.push(finish(current));
  }
  return { boxes, lines };
}

function finish(line: Line): Line {
  return { ...line, text: line.text.trimEnd(), x: round(line.x), y: round(line.y), w: round(line.w), h: round(line.h) };
}
