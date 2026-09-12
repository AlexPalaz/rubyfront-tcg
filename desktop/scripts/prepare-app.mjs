// Prepara app/: la build del gioco (gioco/) per il desktop. Rispetto al sito
// cambiano tre cose: le carte (dati e illustrazioni, docs/cards) viaggiano
// a bordo, in app/cards (VITE_CARDS=./cards/); il tavolo è quello di
// produzione (VITE_ENGINE_URL), perché una pagina app:// non è https e da
// sé cercherebbe il tavolo in locale; il link d'invito porta al gioco sul
// sito (VITE_INVITE_BASE da RUBYFRONT_SITE), non a una pagina che un amico
// senza il gioco installato non può aprire.
//
//   node scripts/prepare-app.mjs
//   RUBYFRONT_SITE=https://<dominio>/ node scripts/prepare-app.mjs
//   VITE_ENGINE_URL=ws://localhost:8788 node scripts/prepare-app.mjs   (contro il tavolo locale)

import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(DESKTOP, "..");
const APP = resolve(DESKTOP, "app");
const PRODUCTION_ENGINE = "wss://rubyfront.onrender.com/engine";

rmSync(APP, { recursive: true, force: true });
const site = process.env.RUBYFRONT_SITE ?? "";
console.log("· il gioco (tsc + vite build) → desktop/app");
execSync(`npm run build -- --outDir "${APP}" --emptyOutDir`, {
  cwd: resolve(ROOT, "game"),
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_CARDS: "./cards/",
    VITE_ENGINE_URL: process.env.VITE_ENGINE_URL ?? PRODUCTION_ENGINE,
    // Il gioco PixiJS sul sito sta sotto /next finché non prende il posto del simulatore.
    VITE_INVITE_BASE: site ? new URL("next/", site).href : "",
  },
});
if (!existsSync(resolve(APP, "index.html"))) throw new Error("la build del gioco non è in desktop/app");
console.log("· le carte (docs/cards: catalogo, illustrazioni, grafica) → desktop/app/cards");
cpSync(resolve(ROOT, "docs/cards"), resolve(APP, "cards"), {
  recursive: true,
  // Le note di design e il README del catalogo sono del team, non del gioco.
  filter: source => !source.includes(`${resolve(ROOT, "docs/cards/notes")}`) && !source.endsWith("README.md"),
});
if (!site) console.log("! RUBYFRONT_SITE non impostato: il link d'invito resta quello della finestra (si entra comunque col nome della stanza)");
console.log("✓ desktop/app pronta: npm start per provarla, npm run pack per l'eseguibile");
