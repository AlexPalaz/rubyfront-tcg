// Le schermate del gioco (F6) viste da fuori: il tavolo Ruby vero, il
// server del gioco, Chrome senza finestra sull'indirizzo nudo (la home).
// Si percorre il giro del giocatore — la home e le sue carte, il profilo con
// le tendine, il sipario verso la partita col bot, «Esci dalla partita» con
// la sua domanda, i mazzi con le carte e l'ingrandimento, le impostazioni,
// una stanza nuova fino all'attesa e al link d'invito — e si fotografa ogni
// passo per il QC (compare/screens/). Gli errori della pagina si contano.
//
//   node scripts/test-screens.mjs [cartella]

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const GAME = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(GAME, "..");
const out = resolve(process.argv[2] ?? resolve(GAME, "compare/screens"));
mkdirSync(out, { recursive: true });

const engine = spawn("ruby", ["engine/bin/server"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((ready, reject) => {
  engine.stdout.on("data", data => String(data).includes("ws://") && ready());
  engine.on("exit", code => reject(new Error(`il tavolo non parte (exit ${code})`)));
});
const server = await createServer({ root: GAME, configFile: resolve(GAME, "vite.config.ts"), server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(base).origin });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => message.type() === "error" && errors.push(message.text()));
const results = {};

async function photo(name) {
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  console.log(`  foto: ${name}`);
}

/** Il centro del primo nodo visibile con quell'etichetta (o che comincia così), in pixel della pagina (1920×1080: scala 1). */
async function find(label, prefix = false) {
  return page.evaluate(
    ({ label, prefix }) => {
      const visit = (node, visible) => {
        const shown = visible && node.visible;
        if (!shown) return null;
        const name = node.label ?? "";
        if (prefix ? name.startsWith(label) : name === label) return node;
        for (const child of node.children ?? []) {
          const hit = visit(child, shown);
          if (hit) return hit;
        }
        return null;
      };
      const hit = visit(window.__rubyfront.dumpAll(), true);
      return hit ? { x: hit.bounds.x + hit.bounds.width / 2, y: hit.bounds.y + hit.bounds.height / 2, b: hit.bounds } : null;
    },
    { label, prefix }
  );
}

async function click(label, prefix = false) {
  const at = await find(label, prefix);
  if (!at) throw new Error(`non trovo «${label}»`);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await page.mouse.click(at.x, at.y);
  return at;
}

async function hover(label, dy = 0) {
  const at = await find(label);
  if (!at) throw new Error(`non trovo «${label}»`);
  await page.mouse.move(at.x, at.y + dy, { steps: 6 });
  return at;
}

const pause = ms => page.waitForTimeout(ms);
// L'account di prova, da .env.local (RUBYFRONT_TEST_USER e RUBYFRONT_TEST_PASSWORD): un account
// come tutti, a password (l'utenza a chiave è stata tolta il 2026-09-23). Senza, la porta resta chiusa.
const TEST_ACCOUNT = (() => {
  try {
    const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
    const read = key => env.match(new RegExp(`${key}=(.*)`))?.[1].replace(/"/g, "").trim() ?? "";
    return { user: read("RUBYFRONT_TEST_USER"), password: read("RUBYFRONT_TEST_PASSWORD") };
  } catch {
    return { user: "", password: "" };
  }
})();

try {
  await page.goto(base);
  await page.waitForFunction(() => Boolean(window.__rubyfront?.screens), null, { timeout: 60_000 });
  await pause(1800);
  // La porta (2026-09-22): la schermata d'accesso prima della home. Si entra con l'account di prova.
  await photo("00-auth");
  await page.evaluate(({ user, password }) => window.__rubyfront.match.session.loginPassword(user, password), TEST_ACCOUNT);
  await page.waitForFunction(() => Boolean(window.__rubyfront?.match?.session.account()), null, { timeout: 15_000 });
  await pause(900);
  await photo("01-home");

  // Le carte al passaggio: Multigiocatore, poi Contro il computer.
  await hover("home-card:multi", -200);
  await pause(900);
  await photo("02-home-multi");
  await hover("home-card:solo", -200);
  await pause(900);
  await photo("03-home-solo");

  // «Nuova partita» senza un mazzo scelto porta alla collezione (2026-09-20):
  // si sceglie giocando, e il mazzo si legge poi nell'header. Il profilo
  // chiede il nome e il mazzo del bot, con una tendina aperta.
  await click("button:Nuova partita");
  await pause(700);
  await photo("04-collection-first");
  await click("button:Scegli questo mazzo");
  await pause(700);
  await photo("04-home-deck-chosen");
  await hover("home-card:solo", -200);
  await pause(900);
  await click("button:Nuova partita");
  await pause(700);
  await photo("04-profile-bot");
  // La X (2026-09-24) chiude la popup e riporta alla home; poi si riapre.
  await click("button:×");
  await pause(500);
  results.dismissed = await page.evaluate(() => !window.__rubyfront.dumpAll().children.some(n => n.label === "onboarding" && n.visible));
  await hover("home-card:solo", -200);
  await pause(900);
  await click("button:Nuova partita");
  await pause(700);
  await click("dropdown", true);
  await pause(300);
  await photo("05-dropdown");
  const items = await page.evaluate(() => {
    const out = [];
    const visit = node => {
      if (!node.visible) return;
      if ((node.label ?? "").startsWith("item:")) out.push(node.label);
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__rubyfront.dumpAll());
    return out;
  });
  results.decks = items;
  await click(items[items.length - 1]);
  await pause(200);
  await photo("06-profile-chosen");

  // «Al tavolo»: il sipario, poi l'ingresso dei Rubyfront e l'apertura.
  await click("button:Al tavolo");
  await pause(1200);
  await photo("07-curtain");
  await pause(3800);
  await photo("08-table-entrance");
  await pause(9000);
  await photo("09-table");
  results.table = await page.evaluate(() => {
    const s = window.__rubyfront.match.session.state();
    return { turn: s.turn, phase: s.phase, cards: Object.keys(s.cards).length, names: [s.players.a.name, s.players.b.name] };
  });

  // Gli strumenti di prova (solo con l'account di prova): «Vinci» chiude la partita
  // all'istante, poi l'overlay del premio con l'anello che si riempie.
  results.devTools = await page.evaluate(() => {
    const out = [];
    const visit = node => {
      if (!node.visible) return;
      if (["Evoca", "+1 Flusso", "Vinci", "Perdi"].some(l => (node.label ?? "").endsWith(l))) out.push(node.label);
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__rubyfront.dumpAll());
    return out;
  });
  await click("button:Vinci");
  await pause(2600);
  await photo("09b-reward");
  await pause(3000);
  await photo("09c-reward-filled");
  results.win = await page.evaluate(() => {
    const s = window.__rubyfront.match.session.state();
    return { over: s.over ?? null, hp: [s.players.a.hp, s.players.b.hp] };
  });
  await click("button:Continua");
  await pause(600);
  await photo("09d-after-reward");

  // «Esci dalla partita»: la domanda, poi sì — il sipario e la home.
  await click("button:Esci dalla partita");
  await pause(400);
  await photo("10-question");
  await click("question-yes");
  await pause(3200);
  await photo("11-home-return");
  results.backHome = await page.evaluate(() => ({ cards: Object.keys(window.__rubyfront.match.session.state().cards).length }));

  // I mazzi: la vista, le carte aperte, l'ingrandimento sulla copertina, lo scorrimento.
  await hover("home-card:decks", -200);
  await pause(900);
  await click("button:Sfoglia i mazzi");
  await pause(1500);
  await photo("12-decks");
  await click("button:Sfoglia le carte");
  await pause(2500);
  const deckPrint = await find("deck:", true);
  await page.mouse.move(deckPrint.b.x + 60 + 18 + 187, deckPrint.b.y + 60 + 18 + 262, { steps: 5 });
  await pause(900);
  await photo("13-decks-preview");
  await page.mouse.move(960, 700);
  await page.mouse.wheel(0, 900);
  await pause(600);
  await photo("14-decks-scroll");
  await page.mouse.wheel(0, -2000);
  await pause(300);
  await click("button:← Home");
  await pause(600);

  // Le impostazioni.
  await click("gear");
  await pause(400);
  await photo("15-settings");
  await page.keyboard.press("Escape");
  await pause(300);

  // La progressione dei Rubyfront (2026-09-23): la scelta, la sferografia, il dettaglio, il montaggio.
  await click("button:Ascesa");
  await pause(1500);
  await photo("15b-progression-pick");
  await click("rubyfront:RBF-001");
  await pause(300);
  await photo("15c-progression-enter");
  await pause(2200);
  await photo("15d-progression-grid");
  await click("node:1");
  await pause(700);
  await photo("15e-progression-node");
  const mountLabel = (await find("button:Monta")) ? "button:Monta" : "button:Smonta";
  const before = await page.evaluate(() => { const p = window.__rubyfront.match.session.progress("RBF-001"); return p.loadout.rubyfront.length + p.loadout.nexus.length; });
  await click(mountLabel);
  await pause(300);
  await photo("15f-progression-zoom");
  await pause(1500);
  await photo("15g-progression-sockets");
  await click("socket:1");
  await pause(900);
  await photo("15h-progression-socket-hit");
  await pause(2200);
  await photo("15i-progression-after");
  results.progression = await page.evaluate(before => {
    const s = window.__rubyfront.match.session;
    const p = s.progress("RBF-001");
    return { level: p.level, xp: p.xp, before, mounted: p.loadout.rubyfront.length + p.loadout.nexus.length, open: window.__rubyfront.screens.progression.isOpen() };
  }, before);
  await click("button:← Rubyfront");
  await pause(700);
  await click("button:← Home");
  await pause(500);

  // La partita casuale (2026-09-23): in fila nell'atrio, poi «Annulla la ricerca».
  await hover("home-card:multi", -200);
  await pause(900);
  await click("button:Partita casuale");
  await pause(800);
  await photo("16-searching");
  results.searching = Boolean(await find("button:Annulla la ricerca"));
  await click("button:Annulla la ricerca");
  await pause(500);
  // Una stanza nuova: dritti all'attesa (il posto lo dà il tavolo), col link d'invito senza posto.
  await hover("home-card:multi", -200);
  await pause(900);
  await click("button:Crea una stanza");
  await pause(1500);
  await photo("17-waiting");
  await click("button:Copia il link d'invito");
  await pause(300);
  results.invite = { button: Boolean(await find("button:Copiato ✓")), link: await page.evaluate(() => navigator.clipboard.readText()) };
  await photo("18-invite");
  await click("button:Esci dalla stanza");
  await pause(900);
  await photo("19-home-after-room");
  results.roomAfter = await page.evaluate(() => window.__rubyfront.screens.room());
} catch (error) {
  console.log(`interrotto: ${error.message}`);
  await photo("zz-error").catch(() => undefined);
} finally {
  console.log(`esiti: ${JSON.stringify(results)}`);
  console.log(`errori della pagina: ${errors.length}`);
  for (const error of errors.slice(0, 10)) console.log(`  ${error}`);
  await browser.close();
  await server.close();
  engine.kill();
}
