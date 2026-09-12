// La registrazione di una partita contro il bot, per il refactoring dei
// gesti (F4): il caso reso ripetibile (Math.random con un seme fisso), il
// tavolo Ruby vero, il bot al posto B e il posto A che passa sempre — chiude
// le sue fasi e basta — mentre le scene delle carte del bot si chiudono da
// sole. Le azioni che la sessione applica, in ordine, finiscono in un file:
// prima e dopo il refactoring devono coincidere.
//
//   node scripts/record-match.mjs --client simulator --out before.json
//   node scripts/record-match.mjs --client simulator --out after.json
//   node scripts/record-match.mjs --compare before.json after.json
//
// Opzioni: --seed N (default 7), --turns N (default 12), --table ws://… (il
// tavolo acceso a parte; senza, lo script ne accende uno sulla 8788).

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const GAME = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(GAME, "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);

if (args.includes("--compare")) {
  const [a, b] = args.slice(args.indexOf("--compare") + 1);
  const left = JSON.parse(readFileSync(a, "utf8"));
  const right = JSON.parse(readFileSync(b, "utf8"));
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    const x = JSON.stringify(left[i]);
    const y = JSON.stringify(right[i]);
    if (x !== y) {
      console.log(`diverge all'azione ${i} di ${n}:\n  prima: ${x?.slice(0, 400)}\n  dopo:  ${y?.slice(0, 400)}`);
      process.exit(1);
    }
  }
  console.log(`identiche: ${n} azioni`);
  process.exit(0);
}

const seed = Number(opt("seed", "7"));
const turns = Number(opt("turns", "12"));
const out = resolve(process.cwd(), opt("out", "match.json"));
const client = opt("client", "simulator");
if (client !== "simulator") throw new Error("per ora si registra solo il simulatore");

let engine = null;
const engineUrl = opt("table", null);
if (!engineUrl) {
  engine = spawn("ruby", ["engine/bin/server"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolveReady, reject) => {
    engine.stdout.on("data", data => String(data).includes("ws://") && resolveReady());
    engine.on("exit", code => reject(new Error(`il tavolo non parte (exit ${code})`)));
  });
}

const root = resolve(ROOT, "simulator");
const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"), server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(({ seed: s }) => {
    // mulberry32: lo stesso caso a ogni corsa (mescolate, dadi, chi inizia).
    let a = s >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    localStorage.clear();
    localStorage.setItem("rbf-sim:name", "Prova");
    localStorage.setItem("rbf-sim:deck", "eredita-perduta");
    localStorage.setItem("rbf-sim:seat", "a");
    localStorage.setItem("rbf-sim:lang", "it");
    localStorage.setItem("rbf-sim:sound", "off");
    localStorage.setItem("rbf-sim:music", "off");
  }, { seed });
  const page = await context.newPage();
  page.on("pageerror", error => console.error("[pagina]", error.message));
  // Gli avvisi e gli errori della console: la sessione inghiotte gli errori del bot con un console.warn.
  page.on("console", message => ["warning", "error"].includes(message.type()) && console.error(`[console:${message.type()}]`, message.text()));
  // Le risorse che mancano: il 404 della console non dice quale.
  page.on("response", response => response.status() >= 400 && console.error(`[${response.status()}]`, response.url()));
  // Il WebSocket verso il tavolo: si ascoltano le richieste di giudizio e i verdetti.
  // In ascolto PRIMA di aprire la pagina: il socket nasce al caricamento.
  const judged = new Map();
  const recorded = [];
  page.on("websocket", ws => {
    ws.on("framesent", frame => {
      try {
        const msg = JSON.parse(String(frame.payload));
        if (msg.t === "judge") judged.set(msg.seq, msg.action);
      } catch {
        /* non JSON */
      }
    });
    ws.on("framereceived", frame => {
      try {
        const msg = JSON.parse(String(frame.payload));
        if (msg.t === "verdict" && judged.has(msg.seq)) {
          const action = judged.get(msg.seq);
          judged.delete(msg.seq);
          if (action.t === "say") return;
          recorded.push({ ok: msg.ok !== false || msg.ruled === false, action: clean(action) });
        }
      } catch {
        /* non JSON */
      }
    });
  });

  await page.goto(`${url}${engineUrl ? `?engine=${encodeURIComponent(engineUrl)}` : ""}`);
  await page.waitForFunction(() => typeof window.__rbf?.dispatch === "function", null, { timeout: 60_000 });

  // «Contro il computer» → «Riprendi»: nome e mazzo sono già salvati.
  await page.click("#home-solo");
  await page.waitForTimeout(500);

  // Il giro: il posto A chiude le sue fasi appena può; le scene si chiudono da sole.
  const started = Date.now();
  let lastTurn = 0;
  // Il banco fermo (nessuna azione nuova): una fotografia a 30 secondi, e fuori a 90.
  let lastCount = -1;
  let lastChange = Date.now();
  let diagnosed = false;
  while (Date.now() - started < 12 * 60_000) {
    const s = await page.evaluate(() => {
      const st = window.__rbf.state();
      return { turn: st.turn, active: st.active, phase: st.phase, over: Boolean(st.over) };
    });
    if (s.over || s.turn > turns) break;
    if (s.turn !== lastTurn) {
      lastTurn = s.turn;
      console.log(`turno ${s.turn} (${s.active}, ${s.phase}) · ${recorded.length} azioni`);
    }
    if (recorded.length !== lastCount) {
      lastCount = recorded.length;
      lastChange = Date.now();
      diagnosed = false;
    } else if (Date.now() - lastChange > 30_000 && !diagnosed) {
      diagnosed = true;
      const diag = await page.evaluate(() => {
        const st = window.__rbf.state();
        const hand = seat => Object.values(st.cards).filter(c => c.owner === seat && c.zone === "hand").length;
        const shown = [...document.querySelectorAll("button, .overlay, .effect-veil, .effect-confirm, .engine-stop")]
          .filter(el => el.offsetParent !== null && !el.disabled)
          .map(el => `${el.className || el.tagName}: ${(el.textContent || "").trim().slice(0, 30)}`)
          .slice(0, 20);
        return { turn: st.turn, active: st.active, phase: st.phase, chain: Boolean(st.chain), hands: { a: hand("a"), b: hand("b") }, body: document.body.className, shown };
      });
      console.log("fermo da 30 secondi:", JSON.stringify(diag, null, 1));
    }
    if (Date.now() - lastChange > 90_000) {
      console.log("fermo da 90 secondi: esco");
      break;
    }
    // Il posto A non gioca carte e pesca a ogni turno: con più di 7 carte in
    // mano (§6.5) scarta la prima, o il suo turno non finirebbe mai. Si
    // aspetta il verdetto, così lo scarto non parte due volte.
    await page.evaluate(async () => {
      const st = window.__rbf.state();
      if (st.active !== "a" || st.chain || st.over) return;
      const hand = Object.values(st.cards).filter(c => c.owner === "a" && c.zone === "hand").sort((x, y) => x.order - y.order);
      if (hand.length > 7) await window.__rbf.dispatch({ t: "toZone", uid: hand[0].uid, zone: "ritiro" });
    });
    // Le scene aperte (le carte del bot, gli effetti): Continua / Risolvi / Va bene.
    await page.evaluate(() => {
      for (const button of document.querySelectorAll(".effect-confirm button, .effect-veil button, .engine-stop-ok, .ask button")) {
        if (!button.disabled && button.offsetParent !== null) {
          button.click();
          return;
        }
      }
    });
    // Il gesto di fase del posto A, quando è suo.
    await page.evaluate(() => {
      const button = document.querySelector(".hud-front.is-phase-end");
      if (button && !button.disabled) button.click();
    });
    await page.waitForTimeout(400);
  }
  writeFileSync(out, JSON.stringify(recorded, null, 1));
  console.log(`registrate ${recorded.length} azioni in ${out}`);
} finally {
  await browser.close();
  await server.close();
  engine?.kill();
}

/** L'azione senza ciò che cambia da una corsa all'altra a parità di partita (gli id e i tempi della chat). */
function clean(action) {
  return JSON.parse(JSON.stringify(action, (key, value) => (key === "id" || key === "ts" ? undefined : value)));
}
