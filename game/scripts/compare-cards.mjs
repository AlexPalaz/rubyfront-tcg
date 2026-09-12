// Il confronto automatico delle carte: la carta del sito (card-render.js,
// il metro) contro la carta Pixi del gioco, pixel per pixel.
//
//   node scripts/compare-cards.mjs                  tutte le facce, it ed en
//   node scripts/compare-cards.mjs RBF-001 RBF-015  solo quelle carte
//   node scripts/compare-cards.mjs --lang it        solo una lingua
//   node scripts/compare-cards.mjs --original-only solo le misure del metro
//   node scripts/compare-cards.mjs --out prova   il rapporto in compare/prova/
//
// Accende il server di sviluppo del gioco (Vite, porta libera), apre Chrome
// senza finestra (quello installato: playwright-core non scarica browser),
// disegna ogni faccia sulle due pagine di compare/ a doppia risoluzione,
// e scrive in compare/report/ le tre immagini per faccia (originale,
// Pixi, differenze), le misure, e un index.html dal caso peggiore al
// migliore. Il rapporto non si committa.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import { createServer } from "vite";

const GAME = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = process.argv.slice(2);
// --out <cartella>: un rapporto a parte (sotto compare/), per non
// cancellare quello che si sta guardando.
const OUT = resolve(GAME, "compare", cli.includes("--out") ? cli[cli.indexOf("--out") + 1] : "report");
const SCALE = 2;
const CARD_W = 520;
const CARD_H = 728;

const args = process.argv.slice(2);
const langArg = args.includes("--lang") ? args[args.indexOf("--lang") + 1] : null;
const onlyOriginal = args.includes("--original-only");
const wanted = args.filter(arg => /^RBF-\d+$/i.test(arg)).map(arg => arg.toUpperCase());

const catalog = JSON.parse(readFileSync(resolve(GAME, "../docs/cards/catalog.json"), "utf8"));
const locales = langArg ? [langArg] : ["it", "en"];
const cases = [];
for (const card of catalog.cards) {
  if (wanted.length && !wanted.includes(card.id)) continue;
  for (const face of card.faces) for (const locale of locales) cases.push({ card: card.id, face: face.id, kind: face.kind, locale });
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const server = await createServer({ root: GAME, configFile: resolve(GAME, "vite.config.ts"), server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ deviceScaleFactor: SCALE, viewport: { width: 800, height: 900 } });

async function openPage(path) {
  const page = await context.newPage();
  page.on("pageerror", error => console.error(`[${path}]`, error.message));
  await page.goto(`${base}/compare/${path}`);
  await page.waitForFunction(() => typeof window.renderCard === "function", null, { timeout: 30_000 });
  return page;
}

const original = await openPage("original.html");
const pixi = onlyOriginal ? null : await openPage("pixi.html");

const results = [];
try {
  for (const entry of cases) {
    const name = `${entry.card}-${entry.face}-${entry.locale}`;
    const measured = await original.evaluate(({ card, face, locale }) => window.renderCard(card, face, locale), entry);
    const origPng = await original.locator("#holder .card").screenshot();
    writeFileSync(resolve(OUT, `${name}-orig.png`), origPng);
    writeFileSync(resolve(OUT, `${name}-measure.json`), JSON.stringify(measured, null, 1));
    if (!pixi) {
      results.push({ ...entry, name });
      continue;
    }
    const layout = await pixi.evaluate(({ card, face, locale }) => window.renderCard(card, face, locale), entry);
    const pixiPng = await pixi.locator("canvas").screenshot();
    writeFileSync(resolve(OUT, `${name}-pixi.png`), pixiPng);
    writeFileSync(resolve(OUT, `${name}-pixi.json`), JSON.stringify(layout, null, 1));
    const a = PNG.sync.read(origPng);
    const b = PNG.sync.read(pixiPng);
    const width = CARD_W * SCALE;
    const height = CARD_H * SCALE;
    const diff = new PNG({ width, height });
    const sizeOk = a.width === width && a.height === height && b.width === width && b.height === height;
    const mismatched = sizeOk ? pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.1, includeAA: false, alpha: 0.25 }) : width * height;
    writeFileSync(resolve(OUT, `${name}-diff.png`), PNG.sync.write(diff));
    const lines = compareLines(measured?.lines ?? [], layout?.lines ?? []);
    results.push({ ...entry, name, sizeOk, score: (100 * mismatched) / (width * height), lines });
    console.log(`${name.padEnd(28)} ${sizeOk ? `${((100 * mismatched) / (width * height)).toFixed(2).padStart(6)}%` : "misura sbagliata"}  righe: ${lines.matched}/${lines.total}, scarto medio ${lines.meanOffset.toFixed(1)}px`);
  }
} finally {
  await browser.close();
  await server.close();
}

writeFileSync(resolve(OUT, "results.json"), JSON.stringify(results, null, 1));
if (!onlyOriginal) writeReport(results);
if (!onlyOriginal) {
  const scores = results.map(result => result.score);
  const mean = scores.reduce((sum, value) => sum + value, 0) / (scores.length || 1);
  console.log(`\nfacce: ${results.length} · differenza media ${mean.toFixed(2)}% · peggiore ${Math.max(...scores).toFixed(2)}%`);
  console.log(`rapporto: ${resolve(OUT, "index.html")}`);
}

/**
 * Le righe di testo, confrontate per contenuto: per ogni riga del metro si
 * cerca nella carta Pixi quella con lo stesso testo, e se ne misura lo
 * scarto di posizione. Una riga che manca vuol dire un a-capo diverso.
 */
function compareLines(expected, actual) {
  const pool = [...actual];
  let matched = 0;
  let offset = 0;
  const missing = [];
  for (const line of expected) {
    const index = pool.findIndex(other => other.text === line.text);
    if (index === -1) {
      missing.push(line.text);
      continue;
    }
    const other = pool.splice(index, 1)[0];
    matched += 1;
    offset += Math.hypot(other.x - line.x, other.y - line.y);
  }
  return { total: expected.length, matched, meanOffset: matched ? offset / matched : 0, missing };
}

function writeReport(rows) {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const body = sorted
    .map(row => `
    <section>
      <h2>${row.name} <small>${row.kind}</small> — ${row.score.toFixed(2)}% · righe ${row.lines.matched}/${row.lines.total} · scarto ${row.lines.meanOffset.toFixed(1)}px</h2>
      ${row.lines.missing.length ? `<p class="miss">a capo diversi: ${row.lines.missing.map(text => `«${escapeHtml(text)}»`).join(" · ")}</p>` : ""}
      <div class="row">
        <figure><img src="${row.name}-orig.png"><figcaption>originale</figcaption></figure>
        <figure><img src="${row.name}-pixi.png"><figcaption>Pixi</figcaption></figure>
        <figure><img src="${row.name}-diff.png"><figcaption>differenze</figcaption></figure>
      </div>
    </section>`)
    .join("\n");
  writeFileSync(
    resolve(OUT, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Confronto carte</title>
<style>
  body { background: #111; color: #eee; font: 14px system-ui; margin: 24px; }
  h2 { font-size: 15px; margin: 28px 0 8px; } small { color: #999; }
  .row { display: flex; gap: 12px; } figure { margin: 0; } img { width: 390px; display: block; }
  figcaption { color: #999; font-size: 12px; margin-top: 4px; } .miss { color: #f99; margin: 0 0 8px; }
</style>
<h1>Confronto carte · ${rows.length} facce</h1>
${body}`
  );
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
}
