// Le frecce del combattimento.
//
// Un solo SVG sopra la lavagna, ridisegnato a ogni render. Non tiene stato:
// riceve i punti già calcolati in coordinate di schermo e li disegna. Chi
// decide da dove a dove è table.ts, che è l'unico a sapere dove sono le carte.

const SVG_NS = "http://www.w3.org/2000/svg";

export type ArrowKind = "attack" | "block" | "counter" | "effect";

export interface Arrow {
  kind: ArrowKind;
  /** Rettangolo della carta che dichiara, in coordinate della superficie. */
  from: { x: number; y: number; w: number; h: number };
  /** Rettangolo del bersaglio. Per la freccia in volo è un punto (w/h a zero). */
  to: { x: number; y: number; w: number; h: number };
  /** Tratteggiata: dichiarazione in corso, non ancora confermata. */
  pending?: boolean;
}

const COLOR: Record<ArrowKind, string> = {
  attack: "#d24a64",
  block: "#7fa3bc",
  counter: "#d9a84e",
  effect: "#ff8ea6",
};

export function createArrowLayer(width: number, height: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "arrow-layer");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return svg;
}

function center(box: Arrow["from"]): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/**
 * Dove la retta centro→centro esce dal rettangolo. Serve perché la freccia
 * deve partire dal bordo della carta e fermarsi sul bordo del bersaglio: una
 * punta piantata al centro finirebbe sotto l'illustrazione e non si vedrebbe.
 */
function edge(box: Arrow["from"], toward: { x: number; y: number }): { x: number; y: number } {
  const c = center(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const halfW = box.w / 2;
  const halfH = box.h / 2;
  // Quanto si può avanzare lungo la direzione restando dentro il rettangolo.
  const scale = Math.min(
    dx === 0 ? Infinity : halfW / Math.abs(dx),
    dy === 0 ? Infinity : halfH / Math.abs(dy)
  );
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

function line(kind: ArrowKind, from: { x: number; y: number }, to: { x: number; y: number }, pending: boolean): SVGGElement {
  const group = document.createElementNS(SVG_NS, "g");
  const color = COLOR[kind];

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  // Punto di controllo spostato di lato: una curva leggera si segue meglio di
  // una retta quando le frecce sono parecchie e quasi parallele.
  const bend = Math.min(90, length * 0.16);
  const control = {
    x: (from.x + to.x) / 2 - (dy / length) * bend,
    y: (from.y + to.y) / 2 + (dx / length) * bend,
  };
  // La punta arretra di quanto è lunga, per non sbordare oltre il bersaglio.
  const head = 26;
  const tipDx = to.x - control.x;
  const tipDy = to.y - control.y;
  const tipLen = Math.hypot(tipDx, tipDy) || 1;
  const base = { x: to.x - (tipDx / tipLen) * head, y: to.y - (tipDy / tipLen) * head };

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${base.x} ${base.y}`);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", color);
  path.setAttribute("stroke-width", "7");
  path.setAttribute("stroke-linecap", "round");
  if (pending) path.setAttribute("stroke-dasharray", "16 12");

  const normalX = -tipDy / tipLen;
  const normalY = tipDx / tipLen;
  const wing = 13;
  const tip = document.createElementNS(SVG_NS, "path");
  tip.setAttribute(
    "d",
    `M ${to.x} ${to.y} L ${base.x + normalX * wing} ${base.y + normalY * wing} ` +
      `L ${base.x - normalX * wing} ${base.y - normalY * wing} Z`
  );
  tip.setAttribute("fill", color);

  group.setAttribute("class", `arrow arrow-${kind}${pending ? " is-pending" : ""}`);
  group.append(path, tip);
  return group;
}

export function drawArrows(layer: SVGSVGElement, arrows: readonly Arrow[]): void {
  layer.replaceChildren();
  for (const arrow of arrows) {
    const target = arrow.to.w === 0 && arrow.to.h === 0
      ? { x: arrow.to.x, y: arrow.to.y }
      : null;
    const start = edge(arrow.from, target ?? center(arrow.to));
    const end = target ?? edge(arrow.to, center(arrow.from));
    layer.append(line(arrow.kind, start, end, Boolean(arrow.pending)));
  }
}
