// Il sito pubblicato, in dist/: il GIOCO alla radice e il catalogo sotto
// /catalog (deciso 2026-09-07: «il simulatore diventi proprio app o game;
// il catalogo non dev'essere l'index, ma /catalog»). Dal 2026-09-13 il gioco
// è quello in PixiJS (game/): il simulatore DOM è stato tolto.
//
//   dist/                 il gioco (la build di game/, vite)
//   dist/next/            un rimando alla radice: il gioco nuovo stava lì
//   dist/catalog/         il sito delle carte (docs/, tale e quale)
//
// La grafica delle carte il gioco la carica da ./catalog/cards/
// (VITE_CARDS in game/vite.config.ts). Vercel lancia questo script
// (vercel.json) e pubblica dist/; in locale: node scripts/build-site.mjs.
// Niente si committa: dist/ è in .gitignore.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "dist");

console.log("· il gioco (PixiJS, vite build) → dist/");
execSync("npm run build", { cwd: resolve(ROOT, "game"), stdio: "inherit" });
if (!existsSync(resolve(DIST, "index.html"))) throw new Error("la build del gioco non è in dist/");

// Chi aveva salvato /next (il gioco nuovo, finché conviveva col simulatore) arriva alla radice.
mkdirSync(resolve(DIST, "next"), { recursive: true });
writeFileSync(resolve(DIST, "next", "index.html"), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=../"><link rel="canonical" href="../"><title>Rubyfront</title>\n`);

console.log("· il catalogo → dist/catalog");
const CATALOG = resolve(DIST, "catalog");
rmSync(CATALOG, { recursive: true, force: true });
mkdirSync(CATALOG, { recursive: true });
cpSync(resolve(ROOT, "docs"), CATALOG, { recursive: true });
console.log("✓ dist/ pronta: / il gioco, /catalog il catalogo");
