// Gli attrezzi del pittore: ciò che card.css dice con gradienti, ritagli e
// ombre, detto al canvas con la stessa semantica — la linea di un
// linear-gradient con l'angolo del CSS e la sua lunghezza, le ellissi dei
// radial-gradient, le fermate in px o in %, i box-shadow interni, le trame
// ripetute con la loro origine. Tutto in px della carta (520×728): la
// risoluzione la mette chi crea il contesto, con una scala.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * L'aggancio ai pixel del dispositivo: Chrome dipinge sfondi e bordi dei
 * riquadri su pixel interi (x e il bordo destro arrotondati, così la
 * larghezza non traballa); un filo di 1px a y frazionaria, disegnato così
 * com'è, si spalmerebbe su due righe di pixel. Solo per contesti non ruotati.
 */
export function snapBox(ctx: CanvasRenderingContext2D, box: Box): Box {
  const m = ctx.getTransform();
  if (m.b !== 0 || m.c !== 0) return box;
  const x0 = (Math.round(box.x * m.a + m.e) - m.e) / m.a;
  const x1 = (Math.round((box.x + box.w) * m.a + m.e) - m.e) / m.a;
  const y0 = (Math.round(box.y * m.d + m.f) - m.f) / m.d;
  const y1 = (Math.round((box.y + box.h) * m.d + m.f) - m.f) / m.d;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Una coordinata verticale agganciata al pixel del dispositivo (la linea di base del testo). */
export function snapY(ctx: CanvasRenderingContext2D, y: number): number {
  const m = ctx.getTransform();
  if (m.b !== 0 || m.c !== 0) return y;
  return (Math.round(y * m.d + m.f) - m.f) / m.d;
}

/** Una fermata: il colore e dove sta — frazione (0..1), "30%" o "1px". */
export type Stop = [color: string, at: number | string];

function offsetOf(at: number | string, length: number): number {
  if (typeof at === "number") return at;
  if (at.endsWith("%")) return parseFloat(at) / 100;
  if (at.endsWith("px")) return length > 0 ? parseFloat(at) / length : 0;
  throw new Error(`fermata incomprensibile: ${at}`);
}

/** Un colore CSS in [r, g, b, a] (solo le forme che il tema usa: #rgb, #rrggbb, rgb(), rgba()). */
export function rgba(color: string): [number, number, number, number] {
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map(d => d + d).join("") : hex[1];
    const alpha = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
    return [parseInt(digits.slice(0, 2), 16), parseInt(digits.slice(2, 4), 16), parseInt(digits.slice(4, 6), 16), alpha];
  }
  const fn = color.match(/^rgba?\(([^)]+)\)$/i);
  if (fn) {
    const [r, g, b, a = "1"] = fn[1].split(",").map(part => part.trim());
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  if (color === "transparent") return [0, 0, 0, 0];
  throw new Error(`colore incomprensibile: ${color}`);
}

function css([r, g, b, a]: [number, number, number, number]): string {
  return `rgba(${r},${g},${b},${a})`;
}

function addStops(gradient: CanvasGradient, stops: Stop[], length: number): void {
  // Il CSS interpola in colori premoltiplicati, il canvas no: fra un colore e
  // un trasparente il canvas passerebbe dal nero (rgba(0,0,0,0)), il CSS no.
  // Una fermata trasparente prende quindi la tinta della vicina: con alfa
  // zero la tinta non si vede, e il passaggio torna quello del CSS.
  const colors = stops.map(([color]) => rgba(color));
  const tinted = colors.map((color, index) => {
    if (color[3] !== 0) return color;
    const next = colors.slice(index + 1).find(other => other[3] !== 0);
    const prev = colors.slice(0, index).reverse().find(other => other[3] !== 0);
    const source = prev ?? next;
    return source ? ([source[0], source[1], source[2], 0] as [number, number, number, number]) : color;
  });
  // Fermate fuori da 0..1 (una linea più corta del px richiesto) si tengono
  // al bordo, come fa il CSS con le fermate che sbordano.
  let last = 0;
  stops.forEach(([, at], index) => {
    const offset = Math.min(1, Math.max(last, offsetOf(at, length)));
    // Due fermate che vanno da un colore a un trasparente nello stesso punto
    // (i solchi netti): la seconda metà prende la tinta della prima.
    gradient.addColorStop(offset, css(tinted[index]));
    last = offset;
  });
}

/**
 * linear-gradient(<angolo>deg, …) sul riquadro: 0deg va verso l'alto, in
 * senso orario; la linea passa per il centro ed è lunga quanto serve perché
 * gli angoli del riquadro stiano sulle fermate 0% e 100% (specifica CSS).
 */
export function linear(ctx: CanvasRenderingContext2D, box: Box, angle: number, stops: Stop[]): CanvasGradient {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const length = Math.abs(box.w * dx) + Math.abs(box.h * dy);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const gradient = ctx.createLinearGradient(cx - (dx * length) / 2, cy - (dy * length) / 2, cx + (dx * length) / 2, cy + (dy * length) / 2);
  addStops(gradient, stops, length);
  return gradient;
}

/** Riempie il riquadro con un linear-gradient. */
export function fillLinear(ctx: CanvasRenderingContext2D, box: Box, angle: number, stops: Stop[]): void {
  ctx.fillStyle = linear(ctx, box, angle, stops);
  ctx.fillRect(box.x, box.y, box.w, box.h);
}

/**
 * radial-gradient(<rx> <ry> at <cx> <cy>, …): un'ellisse coi raggi dati (in
 * px) centrata nel punto dato; le fermate stanno sul raggio. Il canvas fa
 * solo cerchi: si schiaccia il contesto.
 */
export function fillRadial(ctx: CanvasRenderingContext2D, box: Box, rx: number, ry: number, cx: number, cy: number, stops: Stop[]): void {
  if (rx <= 0 || ry <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  addStops(gradient, stops, rx);
  ctx.fillStyle = gradient;
  // Il riquadro, riportato nello spazio schiacciato.
  const sy = rx / ry;
  ctx.fillRect(box.x - cx, (box.y - cy) * sy, box.w, box.h * sy);
  ctx.restore();
}

/**
 * Il poligono a otto lati dei clip-path della carta: angoli tagliati di `c`
 * (polygon(c 0, 100%-c 0, 100% c, …)).
 */
export function octagon(box: Box, c: number): Path2D {
  const { x, y, w, h } = box;
  const path = new Path2D();
  path.moveTo(x + c, y);
  path.lineTo(x + w - c, y);
  path.lineTo(x + w, y + c);
  path.lineTo(x + w, y + h - c);
  path.lineTo(x + w - c, y + h);
  path.lineTo(x + c, y + h);
  path.lineTo(x, y + h - c);
  path.lineTo(x, y + c);
  path.closePath();
  return path;
}

/** Un poligono in percentuali del riquadro (i clip-path a rombo). */
export function polygon(box: Box, points: [number, number][]): Path2D {
  const path = new Path2D();
  points.forEach(([px, py], index) => {
    const x = box.x + px * box.w;
    const y = box.y + py * box.h;
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  path.closePath();
  return path;
}

export function roundRect(box: Box, radius: number): Path2D {
  const path = new Path2D();
  path.roundRect(box.x, box.y, box.w, box.h, radius);
  return path;
}

export interface Shadow {
  x: number;
  y: number;
  blur: number;
  spread?: number;
  color: string;
}

const FAR = 10_000;

/**
 * Disegna solo l'OMBRA di ciò che `draw` riempie: la forma finisce lontano
 * dal foglio e l'ombra torna al suo posto. Lo spostamento si fa in pixel del
 * dispositivo, perché l'offset delle ombre del canvas non segue la
 * trasformazione: così vale anche su una forma ruotata (il rombo del costo),
 * col suo offset (x, y) ruotato insieme alla forma, come nel CSS.
 */
export function shadowOnly(ctx: CanvasRenderingContext2D, shadow: Shadow, draw: () => void): void {
  const m = ctx.getTransform();
  ctx.save();
  ctx.setTransform(new DOMMatrix().translate(-FAR, 0).multiply(m));
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = shadow.blur * Math.hypot(m.a, m.b);
  ctx.shadowOffsetX = FAR + m.a * shadow.x + m.c * shadow.y;
  ctx.shadowOffsetY = m.b * shadow.x + m.d * shadow.y;
  draw();
  ctx.restore();
}

/**
 * box-shadow inset sul riquadro (con gli angoli dati): l'ombra cade DENTRO,
 * da un bordo spostato di (x, y) e ristretto di `spread`. Il canvas non ha
 * ombre interne: si fa l'ombra del «fuori» (un anello enorme attorno al
 * buco), dentro il riquadro. Il blur del CSS e lo shadowBlur del canvas
 * usano la stessa gaussiana (σ = blur/2).
 */
export function insetShadow(ctx: CanvasRenderingContext2D, box: Box, radius: number, shadow: Shadow): void {
  const spread = shadow.spread ?? 0;
  const hole = { x: box.x + spread, y: box.y + spread, w: box.w - 2 * spread, h: box.h - 2 * spread };
  const margin = shadow.blur * 2 + Math.abs(shadow.x) + Math.abs(shadow.y) + 10;
  const ring = new Path2D();
  ring.rect(box.x - margin, box.y - margin, box.w + margin * 2, box.h + margin * 2);
  ring.addPath(roundRect(hole, Math.max(0, radius - spread)));
  ctx.save();
  ctx.clip(roundRect(box, radius));
  shadowOnly(ctx, shadow, () => {
    ctx.fillStyle = "#000";
    ctx.fill(ring, "evenodd");
  });
  ctx.restore();
}

/** box-shadow esterno (senza inset) di una forma: solo l'ombra, non la forma. */
export function outerShadow(ctx: CanvasRenderingContext2D, shape: Path2D, shadow: Shadow): void {
  shadowOnly(ctx, shadow, () => {
    ctx.fillStyle = "#000";
    if (shadow.spread) {
      ctx.lineWidth = shadow.spread * 2;
      ctx.strokeStyle = "#000";
      ctx.lineJoin = "miter";
      ctx.stroke(shape);
    }
    ctx.fill(shape);
  });
}

/**
 * Una trama ripetuta (background-repeat: repeat) con la sua misura di tassello
 * e la sua origine: il tassello cade in (ox, oy), come background-position
 * `left top` sull'area d'origine.
 */
export function fillPattern(ctx: CanvasRenderingContext2D, image: CanvasImageSource & { width: number; height: number }, box: Box, tileW: number, tileH: number, ox: number, oy: number): void {
  const pattern = ctx.createPattern(image, "repeat");
  if (!pattern) return;
  pattern.setTransform(new DOMMatrix().translate(ox, oy).scale(tileW / image.width, tileH / image.height));
  ctx.fillStyle = pattern;
  ctx.fillRect(box.x, box.y, box.w, box.h);
}

/**
 * object-fit: cover — il ritaglio dell'immagine che copre il riquadro,
 * centrato sul punto `focus` (object-position, 0..1).
 */
export function drawCover(ctx: CanvasRenderingContext2D, image: CanvasImageSource & { width: number; height: number }, box: Box, focusX = 0.5, focusY = 0.5): void {
  const scale = Math.max(box.w / image.width, box.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  const x = box.x + (box.w - w) * focusX;
  const y = box.y + (box.h - h) * focusY;
  ctx.drawImage(image, x, y, w, h);
}
