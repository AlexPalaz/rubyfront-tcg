// Il banco del gioco per le prove da fuori (F4): il tavolo Ruby vero (acceso
// qui, o quello dato), il server del gioco, Chrome senza finestra su
// `?match=bot` col caso a seme fisso; i verdetti del tavolo e gli errori
// della pagina contati. `stato` legge la partita, `passo` la manda avanti
// per il posto A — scene chiuse con Invio, sigillo con Esc, l'eccesso di
// mano scartato (§6.5), le fasi chiuse una volta per stato.

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const GAME = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(GAME, "..");

export async function openGame({ seed = 7, table = null } = {}) {
  let engine = null;
  if (!table) {
    engine = spawn("ruby", ["engine/bin/server"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise((ready, reject) => {
      engine.stdout.on("data", data => String(data).includes("ws://") && ready());
      engine.on("exit", code => reject(new Error(`il tavolo non parte (exit ${code})`)));
    });
  }
  const server = await createServer({ root: GAME, configFile: resolve(GAME, "vite.config.ts"), server: { port: 0, strictPort: false }, logLevel: "error" });
  await server.listen();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(({ seed }) => {
    let a = seed >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (const key of Object.keys(localStorage)) if (key.startsWith("rbf-game:")) localStorage.removeItem(key);
  }, { seed: seed });
  const page = await context.newPage();
  const errors = [];
  const verdicts = { ok: 0, refused: [], actions: [] };
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => message.type() === "error" && errors.push(message.text()));
  const judged = new Map();
  page.on("websocket", ws => {
    ws.on("framesent", frame => {
      try {
        const msg = JSON.parse(String(frame.payload));
        if (msg.t === "judge") judged.set(msg.seq, msg);
      } catch {
        /* non JSON */
      }
    });
    ws.on("framereceived", frame => {
      try {
        const msg = JSON.parse(String(frame.payload));
        if (msg.t !== "verdict" || !judged.has(msg.seq)) return;
        const { action, actor } = judged.get(msg.seq);
        judged.delete(msg.seq);
        const ok = !(msg.ok === false && msg.ruled !== false);
        verdicts.actions.push({ ok, actor, action });
        if (ok) verdicts.ok += 1;
        else verdicts.refused.push(`${actor ?? "?"} ${action.t}: ${msg.reason ?? "?"}`);
      } catch {
        /* non JSON */
      }
    });
  });
  await page.goto(`${server.resolvedUrls.local[0]}?match=bot${table ? `&engine=${encodeURIComponent(table)}` : ""}`);
  await page.waitForFunction(() => Boolean(window.__rubyfront?.match), null, { timeout: 60_000 });
  return {
    page,
    errors,
    verdicts,
    async close() {
      await browser.close();
      await server.close();
      engine?.kill();
    },
  };
}

/** Lo stato della partita e del tavolo, per decidere il passo. */
export function status(page) {
  return page.evaluate(() => {
    const p = window.__rubyfront.match;
    const st = p.session.state();
    const world = window.__rubyfront.stage.world;
    const findLabel = (node, label) => node.visible && (node.label === label || node.children.some(child => findLabel(child, label)));
    const tableGestures = world.children.find(child => child.label === "gestures");
    const rubyfrontButtons = tableGestures?.children.find(child => child.label === "rubyfront-buttons")?.children.length ?? 0;
    return {
      turn: st.turn,
      active: st.active,
      phase: st.phase,
      over: Boolean(st.over),
      chain: Boolean(st.chain),
      handA: Object.values(st.cards).filter(c => c.owner === "a" && c.zone === "hand").length,
      scene: !p.scene.isFree(),
      die: findLabel(world, "roll"),
      aim: findLabel(world, "aim"),
      pileViewer: findLabel(world, "pile-viewer"),
      seal: window.__rubyfront.stage.app.stage.children.some(child => child.label === "seal" && child.visible),
      quiet: p.isQuiet(),
      rubyfrontButtons,
    };
  });
}

/** Un passo automatico del posto A. `memoria` tiene l'ultima fase chiusa. */
export async function step(page, s, memory) {
  if (s.seal) return page.keyboard.press("Escape");
  if (s.scene) return page.keyboard.press("Enter");
  if (s.pileViewer || s.aim) return page.keyboard.press("Escape");
  if (s.die) return;
  // Le fasi si chiudono solo a tavolo fermo, come il bot: chiuderle a metà
  // di un effetto farebbe saltare i gesti che il giocatore aspetta di fare.
  if (!s.quiet) return;
  const closer = s.phase === "reazione" ? (s.active === "a" ? "b" : "a") : s.active;
  if (s.active === "a" && !s.chain && s.handA > 7) {
    await page.evaluate(async () => {
      const p = window.__rubyfront.match;
      const st = p.session.state();
      const first = Object.values(st.cards).filter(c => c.owner === "a" && c.zone === "hand").sort((x, y) => x.order - y.order)[0];
      await p.session.dispatch({ t: "toZone", uid: first.uid, zone: "ritiro" });
    });
    return;
  }
  if (closer === "a" && !s.chain) {
    const key = `${s.turn}|${s.phase}|${s.handA}`;
    if (key !== memory.lastKey) {
      memory.lastKey = key;
      await page.evaluate(() => window.__rubyfront.match.closePhase());
    }
  }
}
