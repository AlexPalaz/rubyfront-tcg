// Le texture del tema «Cattedrale Rubino» (t49) vengono da card.css, non da
// copie nostre: la pietra della lastra (--stone-tex), la grafite del fondo
// (--ground-tex), e per ogni tinta le crepe al neon — i nuclei SVG
// (--crack-cores) e il bagliore PNG (--crack-glow). Il modulo virtuale
// `virtual:theme-t49` le legge dal foglio a ogni build (e a ogni modifica in
// sviluppo): se il designer ritocca una crepa nel CSS, la carta Pixi la
// prende da sé. Il resto del tema (i colori, le misure) sta scritto in
// src/card/theme.ts, e il confronto automatico ne guarda la fedeltà.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const CARD_CSS = resolve(import.meta.dirname, "../docs/cards/ui/card.css");
const ID = "virtual:theme-t49";
const RESOLVED = `\0${ID}`;

/** Le variabili `--nome: url("…")` del blocco che comincia col selettore dato. */
function urlsOf(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`card.css: manca il blocco ${selector}`);
  // La fine del blocco è la prima graffa chiusa fuori dalle virgolette (gli
  // url in linea sono lunghi e pieni di punteggiatura).
  let end = start;
  let quote: string | null = null;
  for (let index = css.indexOf("{", start) + 1; index < css.length; index += 1) {
    const ch = css[index];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "}") {
      end = index;
      break;
    }
  }
  const block = css.slice(start, end);
  const found: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z-]+):\s*url\("([^"]+)"\)/g)) found[match[1]] = match[2];
  return found;
}

export function themeT49(): Plugin {
  return {
    name: "rubyfront-theme-t49",
    resolveId: id => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      this.addWatchFile(CARD_CSS);
      const css = readFileSync(CARD_CSS, "utf8");
      const base = urlsOf(css, ".card.t49");
      const dynamic = urlsOf(css, ".card.t49.mat-dynamic");
      const dimensional = urlsOf(css, ".card.t49.mat-dimensional");
      const need = (set: Record<string, string>, name: string, where: string): string => {
        if (!set[name]) throw new Error(`card.css: manca --${name} in ${where}`);
        return set[name];
      };
      const theme = {
        stoneTex: need(base, "stone-tex", ".card.t49"),
        groundTex: need(base, "ground-tex", ".card.t49"),
        cracks: {
          destructive: { cores: need(base, "crack-cores", ".card.t49"), glow: need(base, "crack-glow", ".card.t49") },
          dynamic: { cores: need(dynamic, "crack-cores", "mat-dynamic"), glow: need(dynamic, "crack-glow", "mat-dynamic") },
          dimensional: { cores: need(dimensional, "crack-cores", "mat-dimensional"), glow: need(dimensional, "crack-glow", "mat-dimensional") },
        },
      };
      return `export default ${JSON.stringify(theme)};`;
    },
  };
}
