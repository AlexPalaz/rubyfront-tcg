// Le foto della resa (F5) sul tavolo di prova: la freccia del blocco, poi un
// volo verso l'Abisso col taglio, la parata del bloccante e il colpo sul
// Rubyfront, fotografati mentre accadono. Per il QC delle animazioni, che una
// partita vera fa capitare quando capitano.
//
//   node scripts/resolution-photos.mjs --out <cartella>

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const GAME = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const out = resolve(process.cwd(), args.includes("--out") ? args[args.indexOf("--out") + 1] : "resolution-photos");
mkdirSync(out, { recursive: true });

const server = await createServer({ root: GAME, configFile: resolve(GAME, "vite.config.ts"), server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}?table=sample&block=1&resolution=1`);
  await page.waitForFunction(() => window.__rubyfront?.tableReady === true, null, { timeout: 60_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(out, "resolution-0-arrow.png") });
  const start = Date.now();
  await page.evaluate(() => window.__rubyfront.resolution.fly());
  for (const [name, at] of [["resolution-1", 150], ["resolution-2", 450], ["resolution-3", 800], ["resolution-4", 1250]]) {
    await page.waitForTimeout(Math.max(0, at - (Date.now() - start)));
    await page.screenshot({ path: resolve(out, `${name}.png`) });
  }
  console.log(`foto in ${out}; errori della pagina: ${errors.length}${errors.length ? `\n  ${errors.join("\n  ")}` : ""}`);
} finally {
  await browser.close();
  await server.close();
}
