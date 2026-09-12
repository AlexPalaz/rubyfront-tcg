// Il sito pubblicato, in dist/: il GIOCO alla radice e il catalogo sotto
// /catalog (deciso 2026-09-07: «il simulatore diventi proprio app o game;
// il catalogo non dev'essere l'index, ma /catalog»).
//
//   dist/                 il gioco (la build di simulator/, vite)
//   dist/next/            il gioco nuovo in PixiJS (game/), finché non
//                         raggiunge il simulatore
//   dist/catalog/         il sito delle carte (docs/, tale e quale)
//
// La grafica delle carte il gioco la carica da ./catalog/cards/ui/
// (VITE_CARDS_UI in vite.config.ts). Vercel lancia questo script
// (vercel.json) e pubblica dist/; in locale: node scripts/build-site.mjs.
// Niente si committa: dist/ è in .gitignore.

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "dist");

console.log("· il gioco (vite build)");
execSync("npm run build", { cwd: resolve(ROOT, "simulator"), stdio: "inherit" });
if (!existsSync(resolve(DIST, "index.html"))) throw new Error("la build del gioco non è in dist/");

// Dopo il simulatore: la sua build svuota dist/.
console.log("· il gioco nuovo (PixiJS) → dist/next");
execSync("npm run build", { cwd: resolve(ROOT, "game"), stdio: "inherit" });
if (!existsSync(resolve(DIST, "next", "index.html"))) throw new Error("la build del gioco nuovo non è in dist/next/");

console.log("· il catalogo → dist/catalog");
const CATALOG = resolve(DIST, "catalog");
rmSync(CATALOG, { recursive: true, force: true });
mkdirSync(CATALOG, { recursive: true });
cpSync(resolve(ROOT, "docs"), CATALOG, {
  recursive: true,
  // La vecchia build del simulatore dentro docs/ (Pages) non serve più.
  filter: source => !source.includes(`${resolve(ROOT, "docs")}/simulatore`),
});
console.log("✓ dist/ pronta: / il gioco, /next il gioco nuovo, /catalog il catalogo");
