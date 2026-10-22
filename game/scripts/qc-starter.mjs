// La prova dal vivo delle forme dello starter Umani (2026-10-20), al tavolo
// Ruby vero: le carte spawnate in mano al posto A, giocate coi gesti del
// core, e la verifica sullo stato — tappata, chiave dell'innesco, Flusso
// pagato dal dado — e sui verdetti del tavolo.
//
//   node scripts/qc-starter.mjs [--table ws://…]

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openGame, status, step } from "./game-bench.mjs";

// L'account di prova (gli strumenti di prova sono dei tester): da .env.local, mai stampato.
const env = Object.fromEntries(readFileSync(resolve(import.meta.dirname, "../../.env.local"), "utf8").split("\n").filter(line => line.includes("=")).map(line => { const i = line.indexOf("="); return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const bench = await openGame({ seed: 7, table: opt("table", null) });
const { page, verdicts, errors } = bench;
const results = {};
const until = async (test, ms = 15_000) => {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const s = await status(page);
    if (await test(s)) return true;
    await step(page, s, memory);
    await page.waitForTimeout(250);
  }
  return false;
};
const memory = { lastKey: "" };
try {
  // Il turno di A in Preparazione, a tavolo fermo.
  await until(s => s.active === "a" && s.phase === "preparazione" && s.quiet && s.turn >= 3, 90_000);
  await page.evaluate(({ user, password }) => window.__rubyfront.match.session.loginPassword(user, password), { user: env.RUBYFRONT_TEST_USER, password: env.RUBYFRONT_TEST_PASSWORD });
  await page.waitForFunction(() => window.__rubyfront.match.session.account()?.tester === true, null, { timeout: 20_000 });
  console.log("tester al tavolo");
  const spawn = (uid, cardId) => page.evaluate(({ uid, cardId }) =>
    window.__rubyfront.match.session.dispatch({ t: "spawn", card: { uid, cardId, owner: "a", zone: "hand", face: 0, x: 0, y: 0, order: 99, tapped: false, facedown: false, z: 0 } }), { uid, cardId });
  await spawn("qc-weary", "RBF-048");
  await spawn("qc-blow", "RBF-059");
  await page.evaluate(() => window.__rubyfront.match.session.dispatch({ t: "player", seat: "a", patch: { flux: 9, fluxMax: 9 }, test: true }));
  await page.waitForTimeout(4000);
  console.log("spawn:", JSON.stringify(verdicts.refused.slice(-3)), await page.evaluate(() => Object.keys(window.__rubyfront.match.session.state().cards).filter(k => k.startsWith("qc-"))));
  const field = await page.evaluate(() => Object.values(window.__rubyfront.match.session.state().cards).filter(c => c.owner === "a" && c.zone === "field").map(c => c.uid));
  console.log("in campo di A:", field.join(", "));
  // 1. «Questa Entità entra tappata».
  await page.evaluate(() => {
    const p = window.__rubyfront.match;
    const card = p.session.state().cards["qc-weary"];
    return p.gestures.playFromHand(card, { x: 442, y: 1260 });
  });
  await until(s => s.quiet && !s.scene, 20_000);
  results.weary = await page.evaluate(() => {
    const st = window.__rubyfront.match.session.state();
    const c = st.cards["qc-weary"];
    return { zone: c?.zone, tapped: c?.tapped, enteredTurn: c?.enteredTurn, fired: (st.fired ?? []).filter(k => k.startsWith("qc-weary|")) };
  });
  console.log("entra tappata:", JSON.stringify(results.weary));
  // 2. Il costo a dado: la carta si gioca tirando il d6, si paga il tiro.
  const before = await page.evaluate(() => window.__rubyfront.match.session.state().players.a.flux);
  await page.evaluate(() => {
    const p = window.__rubyfront.match;
    const card = p.session.state().cards["qc-blow"];
    return p.gestures.playFromHand(card, { x: 2368, y: 1260 });
  });
  await until(s => s.quiet && !s.scene && !s.die, 20_000);
  results.blow = await page.evaluate(before => {
    const st = window.__rubyfront.match.session.state();
    const c = st.cards["qc-blow"];
    return { zone: c?.zone, fluxBefore: before, fluxAfter: st.players.a.flux };
  }, before);
  console.log("costo a dado:", JSON.stringify(results.blow));
} finally {
  const mine = verdicts.actions.filter(a => ["qc-weary", "qc-blow"].includes(a.action.uid) || ["qc-weary", "qc-blow"].includes(a.action.effect?.source));
  console.log("verdetti sulle carte di prova:", mine.map(a => `${a.ok ? "ok" : "NO"} ${a.action.t}${a.action.roll ? ` roll=${a.action.roll} cost=${a.action.cost}` : ""}`).join(" · "));
  console.log("fermati in tutto:", verdicts.refused.length, verdicts.refused.slice(0, 5));
  console.log("errori della pagina:", errors.length, errors.slice(0, 3));
  await bench.close();
}
