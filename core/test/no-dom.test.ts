// Il core non tocca il DOM (migrazione a PixiJS, F1, 2026-09-11): lo usano
// il simulatore, il gioco e un domani Electron, e ognuno ha la sua vista.
// La libreria DOM resta nel tsconfig per i tipi di WebSocket e crypto; che
// non si usi il resto lo guarda questo test, riga per riga (i commenti
// possono parlarne).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../src");
const FORBIDDEN = /\b(document|window|HTMLElement|Element|localStorage|sessionStorage|location|navigator|requestAnimationFrame|getComputedStyle)\b/;

function code(line: string): string {
  // Via i commenti di riga e le stringhe: contano solo gli identificatori.
  return line
    .replace(/\/\/.*$/, "")
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

describe("il core senza DOM", () => {
  for (const file of readdirSync(SRC).filter(name => name.endsWith(".ts"))) {
    it(file, () => {
      let inBlock = false;
      const found: string[] = [];
      readFileSync(join(SRC, file), "utf8").split("\n").forEach((line, index) => {
        let text = line;
        if (inBlock) {
          const endAt = text.indexOf("*/");
          if (endAt === -1) return;
          text = text.slice(endAt + 2);
          inBlock = false;
        }
        text = text.replace(/\/\*.*?\*\//g, "");
        const openAt = text.indexOf("/*");
        if (openAt !== -1) {
          text = text.slice(0, openAt);
          inBlock = true;
        }
        const match = code(text).match(FORBIDDEN);
        if (match) found.push(`${file}:${index + 1} ${match[1]}`);
      });
      expect(found).toEqual([]);
    });
  }
});
