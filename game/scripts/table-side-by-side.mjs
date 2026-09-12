// Il tavolo del gioco accanto a quello del simulatore, sulla stessa partita.
//
//   node scripts/table-side-by-side.mjs            dal posto A
//   node scripts/table-side-by-side.mjs --seat b  dal posto B (l'altra metà in basso)
//   --chain     la catena di risposta aperta (§7.2), col tavolo in penombra
//   --panel     il pannello delle pile avversarie aperto
//   --browse    la tua Abisso aperta nella vetrina (§5)
//   --block     un blocco dichiarato, con le sue frecce
//   --theme X   il tema del simulatore: night (default: il gioco è scuro, 2026-09-12) o light
//
// Accende i due server di sviluppo (porte libere), apre Chrome senza finestra
// a 1920×1080, fa costruire al gioco la partita di prova (src/table/sample-game.ts)
// e ne prende la lista di azioni; la stessa lista entra nel simulatore dal
// suo `__rbf.dispatch` (senza tavolo acceso la stanza «solo» applica tutto).
// Poi le due foto, in compare/table/. Non è un confronto pixel per pixel
// (i due tavoli hanno forme diverse): è il colpo d'occhio su COSA mostrano.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const GAME = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIMULATOR = resolve(GAME, "../simulator");
const OUT = resolve(GAME, "compare/table");
const args = process.argv.slice(2);
const seat = args.includes("--seat") ? args[args.indexOf("--seat") + 1] : "a";
const extra = ["chain", "panel", "browse", "block"].filter(flag => args.includes(`--${flag}`));
const theme = args.includes("--theme") ? args[args.indexOf("--theme") + 1] : "night";
const tag = [seat, ...extra, theme].join("-");

mkdirSync(OUT, { recursive: true });

async function serve(root) {
  const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"), server: { port: 0, strictPort: false }, logLevel: "error" });
  await server.listen();
  return server;
}

const gameServer = await serve(GAME);
const simServer = await serve(SIMULATOR);
const gameBase = gameServer.resolvedUrls.local[0].replace(/\/$/, "");
// Gli indirizzi di Vite portano già la base: /simulator/ per il simulatore.
const simUrl = simServer.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

  // Il gioco: la partita di prova, vista dal posto chiesto.
  const game = await context.newPage();
  game.on("pageerror", error => console.error("[gioco]", error.message));
  await game.goto(`${gameBase}/?table=sample&seat=${seat}${extra.map(flag => `&${flag}=1`).join("")}`);
  await game.waitForFunction(() => window.__rubyfront?.tableReady === true, null, { timeout: 60_000 });
  await game.waitForTimeout(500);
  writeFileSync(resolve(OUT, `game-${tag}.png`), await game.screenshot());
  const actions = await game.evaluate(() => window.__rubyfront.actions);

  // Il simulatore: la stessa lista, azione per azione, e via la home davanti.
  const sim = await context.newPage();
  sim.on("pageerror", error => console.error("[simulatore]", error.message));
  await sim.addInitScript(({ seat, theme }) => {
    localStorage.setItem("rbf-sim:seat", seat);
    localStorage.setItem("rbf-sim:room", "");
    localStorage.setItem("rbf-sim:lang", "it");
    localStorage.setItem("rbf-sim:uitheme", theme);
  }, { seat, theme });
  await sim.goto(`${simUrl}?seat=${seat}`);
  await sim.waitForFunction(() => typeof window.__rbf?.dispatch === "function", null, { timeout: 60_000 });
  await sim.evaluate(async list => {
    document.querySelector("#home")?.setAttribute("hidden", "");
    document.querySelector("#onboard")?.setAttribute("hidden", "");
    for (const action of list) await window.__rbf.dispatch(action);
  }, actions);
  // L'insegna di fase e le animazioni si posano.
  await sim.waitForTimeout(3500);
  if (extra.includes("panel")) {
    await sim.evaluate(() => {
      const dock = document.querySelector(".pile-dock");
      if (dock?.classList.contains("is-collapsed")) dock.querySelector(".pile-dock-head")?.click();
    });
    await sim.waitForTimeout(800);
  }
  if (extra.includes("browse")) {
    await sim.evaluate(seat => document.querySelector(`.slot.pile[data-drop="abisso"][data-seat="${seat}"]`)?.click(), seat);
    await sim.waitForTimeout(800);
  }
  writeFileSync(resolve(OUT, `simulator-${tag}.png`), await sim.screenshot());

  writeFileSync(
    resolve(OUT, `index-${tag}.html`),
    `<!doctype html><meta charset="utf-8"><title>Tavolo affiancato</title>
<style>body{background:#111;color:#eee;font:14px system-ui;margin:24px} figure{margin:0 0 24px} img{width:100%;max-width:1920px;display:block;border:1px solid #333} figcaption{color:#999;margin:6px 0}</style>
<h1>Tavolo affiancato · posto ${seat.toUpperCase()}${extra.length ? ` · ${extra.join(", ")}` : ""} · tema ${theme}</h1>
<figure><figcaption>gioco (PixiJS)</figcaption><img src="game-${tag}.png"></figure>
<figure><figcaption>simulatore (DOM)</figcaption><img src="simulator-${tag}.png"></figure>`
  );
  console.log(`fatto: ${resolve(OUT, `index-${tag}.html`)} (${actions.length} azioni)`);
} finally {
  await browser.close();
  await gameServer.close();
  await simServer.close();
}
