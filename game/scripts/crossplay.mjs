// La partita incrociata (F7): il simulatore al posto A e il gioco al posto
// B, nella stessa stanza del tavolo Ruby vero — i due client che il tavolo
// tiene insieme, ciascuno col suo mazzo. Il simulatore passa (chiude le sue
// fasi, scarta l'eccesso di mano, chiude le scene, risolve le battaglie
// da difensore); il gioco gioca un'Entità per turno e attacca con quelle
// scese prima (i gesti del bot, window.__rubyfront.testHooks). A ogni turno si
// confronta lo stato dei due: devono coincidere, azione per azione. La chat
// va nei due sensi. Foto dei due schermi in compare/crossplay/.
//
//   node scripts/crossplay.mjs [--turns 8] [--out cartella]

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const GAME = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(GAME, "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const turns = Number(opt("turns", "8"));
const out = resolve(opt("out", resolve(GAME, "compare/crossplay")));
mkdirSync(out, { recursive: true });
const ROOM = `crossplay-${Math.floor(1000 + Math.random() * 9000)}`;
const decks = JSON.parse(readFileSync(resolve(ROOT, "docs/cards/catalog.json"), "utf8")).decks.map(deck => deck.id);

const engine = spawn("ruby", ["engine/bin/server"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((ready, reject) => {
  engine.stdout.on("data", data => String(data).includes("ws://") && ready());
  engine.on("exit", code => reject(new Error(`il tavolo non parte (exit ${code})`)));
});
const start = async root => {
  const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"), server: { port: 0, strictPort: false }, logLevel: "error" });
  await server.listen();
  return server;
};
const simServer = await start(resolve(ROOT, "simulator"));
const gameServer = await start(GAME);
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function open(prefix, storage, url) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(({ prefix, storage }) => {
    for (const [key, value] of Object.entries(storage)) localStorage.setItem(`${prefix}${key}`, value);
  }, { prefix, storage });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => message.type() === "error" && !message.text().includes("404") && errors.push(message.text()));
  await page.goto(url);
  return { page, errors };
}

const result = { room: ROOM, decks: { a: decks[0], b: decks[1] ?? decks[0] }, turns: 0, comparisons: 0, divergences: [], chat: {}, gestures: { plays: 0, attacks: 0 } };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Lo stato come JSON a chiavi ordinate: due client allineati danno la stessa stringa. */
const STATE_JSON = `(() => {
  const ordina = v => Array.isArray(v) ? v.map(ordina) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordina(v[k])])) : v;
  return JSON.stringify(ordina(STATE));
})()`;
const simState = page => page.evaluate(STATE_JSON.replace("STATE", "window.__rbf.state()"));
const gameState = page => page.evaluate(STATE_JSON.replace("STATE", "window.__rubyfront.match.session.state()"));

/** Il primo punto in cui due stati si separano. */
function difference(a, b, path = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = difference(a[key], b[key], `${path}.${key}`);
      if (found) return found;
    }
  }
  return `${path}: ${JSON.stringify(a)?.slice(0, 160)} ≠ ${JSON.stringify(b)?.slice(0, 160)}`;
}

async function compare(sim, game, moment) {
  // L'azione dell'uno arriva all'altro dopo il verdetto: si aspetta che il filo si quieti.
  let last = null;
  for (let i = 0; i < 25; i += 1) {
    const [a, b] = await Promise.all([simState(sim), gameState(game)]);
    if (a === b) {
      result.comparisons += 1;
      return true;
    }
    last = difference(JSON.parse(a), JSON.parse(b));
    await pause(200);
  }
  result.divergences.push(`${moment} — ${last}`);
  console.log(`  DIVERGE (${moment}): ${last}`);
  return false;
}

async function photo(sim, game, name) {
  await sim.screenshot({ path: resolve(out, `${name}-simulator.png`) });
  await game.screenshot({ path: resolve(out, `${name}-game.png`) });
  console.log(`  foto: ${name}`);
}

/** Il centro di un nodo del gioco per etichetta (dumpTutto), in pixel della pagina. */
async function find(page, label) {
  return page.evaluate(label => {
    const visit = (node, visible) => {
      if (!(visible && node.visible)) return null;
      if ((node.label ?? "") === label) return node;
      for (const child of node.children ?? []) {
        const hit = visit(child, true);
        if (hit) return hit;
      }
      return null;
    };
    const hit = visit(window.__rubyfront.dumpAll(), true);
    return hit ? { x: hit.bounds.x + hit.bounds.width / 2, y: hit.bounds.y + hit.bounds.height / 2 } : null;
  }, label);
}

let sim;
let game;
try {
  const audio = { sound: "off", music: "off", lang: "it" };
  sim = await open("rbf-sim:", { ...audio, name: "Simulatore", deck: result.decks.a, seat: "a", side: "open" }, `${simServer.resolvedUrls.local[0]}?room=${ROOM}&seat=a`);
  await sim.page.waitForFunction(() => typeof window.__rbf?.dispatch === "function", null, { timeout: 60_000 });
  await pause(1500);
  game = await open("rbf-game:", { ...audio, name: "Gioco", deck: result.decks.b }, `${gameServer.resolvedUrls.local[0]}?room=${ROOM}&seat=b`);
  await game.page.waitForFunction(() => Boolean(window.__rubyfront?.testHooks), null, { timeout: 60_000 });
  await game.page.evaluate(() => window.__rubyfront.testHooks.autopilot());
  // Seduti tutti e due: i due mazzi in tavola (41 carte ciascuno).
  await game.page.waitForFunction(() => Object.keys(window.__rubyfront.match.session.state().cards).length >= 82, null, { timeout: 60_000 });
  await sim.page.waitForFunction(() => Object.keys(window.__rbf.state().cards).length >= 82, null, { timeout: 60_000 });
  console.log(`seduti nella stanza ${ROOM}: A simulatore (${result.decks.a}), B gioco (${result.decks.b})`);
  await pause(4000);
  await photo(sim.page, game.page, "01-seated");
  await compare(sim.page, game.page, "seated");

  const memory = { plays: new Map(), tried: new Set() };
  const started = Date.now();
  let lastTurn = 0;
  let chatDone = false;
  while (Date.now() - started < 8 * 60_000) {
    const s = await sim.page.evaluate(() => {
      const st = window.__rbf.state();
      return { turn: st.turn, active: st.active, phase: st.phase, over: Boolean(st.over) };
    });
    if (s.turn !== lastTurn) {
      await compare(sim.page, game.page, `turno ${s.turn}`);
      lastTurn = s.turn;
      result.turns = s.turn;
      console.log(`turno ${s.turn} (${s.active}, ${s.phase})`);
      if (s.turn === 3) await photo(sim.page, game.page, "02-turn3");
    }
    if (s.over || s.turn > turns) break;

    // La chat, una volta, nei due sensi: dal simulatore (il suo modulo) e dal gioco (il pannello dell'header).
    if (!chatDone && s.turn >= 2) {
      chatDone = true;
      await sim.page.fill(".chat-form input", "ciao dal simulatore");
      await sim.page.press(".chat-form input", "Enter");
      await game.page.waitForFunction(() => window.__rubyfront.match.session.state().chat.some(e => e.text === "ciao dal simulatore"), null, { timeout: 10_000 });
      await pause(300);
      result.chat.counter = Boolean(await find(game.page, "button:Chat · 1"));
      const button = await find(game.page, "button:Chat · 1");
      if (button) await game.page.mouse.click(button.x, button.y);
      await pause(300);
      await game.page.keyboard.type("ciao dal gioco");
      await game.page.keyboard.press("Enter");
      await sim.page.waitForFunction(() => window.__rbf.state().chat.some(e => e.text === "ciao dal gioco"), null, { timeout: 10_000 });
      await pause(600);
      result.chat.simulatorSees = await sim.page.evaluate(() => [...document.querySelectorAll(".chat-row")].some(row => row.textContent.includes("ciao dal gioco")));
      result.chat.gameSees = await game.page.evaluate(() => window.__rubyfront.match.session.state().chat.filter(e => e.kind === "chat").length);
      await photo(sim.page, game.page, "03-chat");
      await game.page.keyboard.press("Escape");
      const close = await find(game.page, "button:Chat");
      if (close) await game.page.mouse.click(close.x, close.y);
    }

    // Il simulatore (A): scarta l'eccesso, chiude le scene, il gesto di fase quando è suo.
    await sim.page.evaluate(async () => {
      const st = window.__rbf.state();
      if (st.active === "a" && !st.chain && !st.over) {
        const hand = Object.values(st.cards).filter(c => c.owner === "a" && c.zone === "hand").sort((x, y) => x.order - y.order);
        if (hand.length > 7) await window.__rbf.dispatch({ t: "toZone", uid: hand[0].uid, zone: "ritiro" });
      }
      for (const button of document.querySelectorAll(".effect-confirm button, .effect-veil button, .engine-stop-ok, .ask button")) {
        if (!button.disabled && button.offsetParent !== null) {
          button.click();
          return;
        }
      }
      const phase = document.querySelector(".hud-front.is-phase-end");
      if (phase && !phase.disabled) phase.click();
    });

    // Il gioco (B): le scene si chiudono con Invio; nel suo turno un'Entità in Preparazione, gli attacchi nel Fronte.
    const g = await game.page.evaluate(() => {
      const p = window.__rubyfront.match;
      const st = p.session.state();
      const hand = Object.values(st.cards).filter(c => c.owner === "b" && c.zone === "hand").sort((x, y) => x.order - y.order);
      return { quiet: p.isQuiet(), turn: st.turn, active: st.active, phase: st.phase, chain: Boolean(st.chain), over: Boolean(st.over), hand: hand.map(c => c.uid) };
    });
    if (!g.quiet) {
      await game.page.keyboard.press("Enter");
    } else if (g.active === "b" && !g.chain && !g.over) {
      const key = `${g.turn}:${g.phase}`;
      if (g.hand.length > 7) {
        await game.page.evaluate(uid => window.__rubyfront.match.session.dispatch({ t: "toZone", uid, zone: "ritiro" }), g.hand[0]);
      } else if (g.phase === "preparazione" && !memory.tried.has(key)) {
        memory.tried.add(key);
        const uid = await game.page.evaluate(() => window.__rubyfront.testHooks.play());
        if (uid) {
          memory.plays.set(uid, g.turn);
          result.gestures.plays += 1;
          console.log(`  il gioco gioca ${uid}`);
        }
      } else if (g.phase === "fronte" && !memory.tried.has(key)) {
        memory.tried.add(key);
        const readyOnes = [...memory.plays].filter(([, turn]) => turn < g.turn).map(([uid]) => uid);
        const n = await game.page.evaluate(uids => window.__rubyfront.testHooks.attack(uids), readyOnes);
        result.gestures.attacks += n;
        if (n) console.log(`  il gioco attacca con ${n}`);
        if (n && !result.attackPhoto) {
          result.attackPhoto = true;
          await pause(900);
          await photo(sim.page, game.page, "04-attack");
        }
      } else {
        await game.page.evaluate(() => window.__rubyfront.match.closePhase());
      }
    }
    await pause(350);
  }
  await pause(2500);
  await compare(sim.page, game.page, "fine");
  await photo(sim.page, game.page, "05-end");
  result.actions = await game.page.evaluate(() => window.__rubyfront.match.session.state().chat.length);
} catch (error) {
  result.interrupted = error.message;
  console.log(`interrupted: ${error.message}`);
  if (sim && game) await photo(sim.page, game.page, "zz-error").catch(() => undefined);
} finally {
  result.errors = { simulator: sim?.errors ?? [], game: game?.errors ?? [] };
  writeFileSync(resolve(out, "result.json"), JSON.stringify(result, null, 1));
  console.log(`esito: ${JSON.stringify({ ...result, errors: { simulator: result.errors.simulator.length, game: result.errors.game.length } })}`);
  for (const error of [...result.errors.simulator, ...result.errors.game].slice(0, 8)) console.log(`  errore: ${error}`);
  await browser.close();
  await simServer.close();
  await gameServer.close();
  engine.kill();
}
