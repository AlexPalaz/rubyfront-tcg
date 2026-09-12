// La prova della partita col bot nel gioco (F4): il tavolo Ruby vero, il bot
// al posto B coi gesti del core, il posto A che chiude le sue fasi e scarta
// l'eccesso (§6.5); le scene delle carte del bot si chiudono con Invio, il
// sigillo con Esc. Fotografa la prima scena, il primo dado e la prima mira, e
// conta i verdetti del tavolo, i rifiuti e gli errori della pagina.
//
//   node scripts/test-match.mjs --out <cartella> [--turns 10] [--seed 7] [--table ws://…]

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const GAME = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(GAME, "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const seed = Number(opt("seed", "7"));
const turns = Number(opt("turns", "10"));
const out = resolve(process.cwd(), opt("out", "test-match"));
mkdirSync(out, { recursive: true });

let engine = null;
const engineUrl = opt("table", null);
if (!engineUrl) {
  engine = spawn("ruby", ["engine/bin/server"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolveReady, reject) => {
    engine.stdout.on("data", data => String(data).includes("ws://") && resolveReady());
    engine.on("exit", code => reject(new Error(`il tavolo non parte (exit ${code})`)));
  });
}

const server = await createServer({ root: GAME, configFile: resolve(GAME, "vite.config.ts"), server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: "chrome", headless: true });

const errors = [];
const verdicts = { ok: 0, refused: [] };
const photo = {};
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(({ seed: s }) => {
    let a = s >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (const key of Object.keys(localStorage)) if (key.startsWith("rbf-game:")) localStorage.removeItem(key);
  }, { seed });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => message.type() === "error" && errors.push(message.text()));
  const judged = new Map();
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
        if (msg.t !== "verdict" || !judged.has(msg.seq)) return;
        const action = judged.get(msg.seq);
        judged.delete(msg.seq);
        if (msg.ok === false && msg.ruled !== false) verdicts.refused.push(`${action.t}: ${msg.reason ?? "?"}`);
        else verdicts.ok += 1;
      } catch {
        /* non JSON */
      }
    });
  });

  await page.goto(`${url}?match=bot${engineUrl ? `&engine=${encodeURIComponent(engineUrl)}` : ""}`);
  await page.waitForFunction(() => Boolean(window.__rubyfront?.match), null, { timeout: 60_000 });

  const started = Date.now();
  let lastTurn = 0;
  let lastKey = "";
  while (Date.now() - started < 6 * 60_000) {
    const s = await page.evaluate(() => {
      const p = window.__rubyfront.match;
      const st = p.session.state();
      const hand = seat => Object.values(st.cards).filter(c => c.owner === seat && c.zone === "hand");
      const find = (node, label) => (node.visible && node.label === label) || (node.visible && (node.children ?? []).some(child => find(child, label)));
      const tree = window.__rubyfront.dump();
      return {
        turn: st.turn,
        active: st.active,
        phase: st.phase,
        over: Boolean(st.over),
        chain: Boolean(st.chain),
        handA: hand("a").length,
        scene: !p.scene.isFree(),
        die: find(tree, "roll"),
        aim: find(tree, "aim"),
        pileViewer: find(tree, "pile-viewer"),
        banner: find(tree, "phase-banner"),
        entrance: find(tree, "entrance-card"),
        flight: (() => {
          const walk = node => (node.label === "flights" ? (node.children ?? []).length > 0 : (node.children ?? []).some(walk));
          return walk(tree);
        })(),
        seal: window.__rubyfront.stage.app.stage.children.some(child => child.label === "seal" && child.visible),
      };
    });
    if (s.over || s.turn > turns) {
      console.log(s.over ? `partita finita al turno ${s.turn}` : `arrivati al turno ${s.turn}`);
      break;
    }
    if (s.turn !== lastTurn) {
      lastTurn = s.turn;
      console.log(`turno ${s.turn} (${s.active}, ${s.phase}) · ${verdicts.ok} passate, ${verdicts.refused.length} fermate`);
    }
    for (const kind of ["dice", "aim", "pileViewer", "scene", "banner", "entrance", "flight"]) {
      if (s[kind] && !photo[kind]) {
        // La scena aspetta la sua faccia: un attimo, poi la foto.
        await page.waitForTimeout(kind === "scene" ? 400 : 150);
        photo[kind] = resolve(out, `${kind}.png`);
        await page.screenshot({ path: photo[kind] });
        console.log(`  foto: ${kind}`);
      }
    }
    if (s.seal) {
      await page.keyboard.press("Escape");
    } else if (s.scene) {
      await page.keyboard.press("Enter");
    } else if (s.pileViewer || s.aim) {
      await page.keyboard.press("Escape");
    } else if (!s.die) {
      const closer = s.phase === "reazione" ? (s.active === "a" ? "b" : "a") : s.active;
      if (s.active === "a" && !s.chain && s.handA > 7) {
        await page.evaluate(async () => {
          const p = window.__rubyfront.match;
          const st = p.session.state();
          const first = Object.values(st.cards).filter(c => c.owner === "a" && c.zone === "hand").sort((x, y) => x.order - y.order)[0];
          await p.session.dispatch({ t: "toZone", uid: first.uid, zone: "ritiro" });
        });
      } else if (closer === "a" && !s.chain) {
        const key = `${s.turn}|${s.phase}|${s.handA}`;
        if (key !== lastKey) {
          lastKey = key;
          await page.evaluate(() => window.__rubyfront.match.closePhase());
        }
      }
    }
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: resolve(out, "end.png") });
  console.log(`verdetti passati: ${verdicts.ok}`);
  console.log(`fermati: ${verdicts.refused.length}${verdicts.refused.length ? `\n  ${verdicts.refused.slice(0, 8).join("\n  ")}` : ""}`);
  console.log(`errori della pagina: ${errors.length}${errors.length ? `\n  ${errors.slice(0, 8).join("\n  ")}` : ""}`);
  console.log(`foto: ${Object.keys(photo).join(", ") || "nessuna"} (in ${out})`);
} finally {
  await browser.close();
  await server.close();
  engine?.kill();
}
