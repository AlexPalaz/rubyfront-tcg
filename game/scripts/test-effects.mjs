// Gli effetti del tavolo visti da fuori (animazioni, 2026-09-12): la pagina
// delle prove (effects.html) in Chrome senza finestra, ogni effetto azionato
// e fotografato a metà corsa, gli errori della pagina e degli shader contati.
//
//   node scripts/test-effects.mjs [cartella]

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const GAME = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? resolve(GAME, "compare/effects"));
mkdirSync(out, { recursive: true });
const server = await createServer({ root: GAME, configFile: resolve(GAME, "vite.config.ts"), server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => ["error", "warning"].includes(message.type()) && /shader|webgl|glsl|error/i.test(message.text()) && errors.push(message.text()));
const photo = async name => {
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  console.log(`  foto: ${name}`);
};
const trigger = button => page.evaluate(t => void window.__effects.actions[t](), button);
const pause = ms => page.waitForTimeout(ms);

try {
  await page.goto(`${server.resolvedUrls.local[0]}effects.html`);
  await page.waitForFunction(() => window.__effects?.ready, null, { timeout: 60_000 });
  await pause(2500);
  await page.mouse.move(1010, 500);
  await pause(600);
  await photo("01-embers-tilt-foil");
  await trigger("1");
  await pause(430);
  await photo("02-play-flight");
  await pause(330);
  await photo("03-play-impact");
  await pause(1200);
  await page.mouse.move(100, 100);
  await trigger("4");
  await pause(420);
  await photo("04-attack-clash");
  await pause(900);
  await trigger("5");
  await pause(380);
  await photo("05-death");
  await pause(1400);
  await trigger("7");
  await pause(430);
  await photo("06-phase");
  await pause(900);
  await trigger("8");
  await pause(420);
  await photo("07-fire-flight");
  await pause(260);
  await photo("08-fire-burst");
  await pause(900);
  await trigger("9");
  await pause(90);
  await photo("09-lightning");
  await pause(900);
  await trigger("0");
  await pause(520);
  await photo("10-portal");
  await pause(1200);
  await trigger("f");
  await pause(330);
  await photo("11-flip-half");
  await pause(900);
  await photo("12-flip-nexus");
  await trigger("n");
  await pause(260);
  await photo("13-numbers");
  const count = await page.evaluate(() => window.__effects.count());
  console.log(`particelle in volo alla fine: ${count}`);
} catch (error) {
  console.log(`interrotto: ${error.message}`);
  await photo("zz-error").catch(() => undefined);
} finally {
  console.log(`errori: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log(`  ${e.slice(0, 300)}`);
  await browser.close();
  await server.close();
}
