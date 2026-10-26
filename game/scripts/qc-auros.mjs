// La prova dal vivo delle forme dello starter Auros (2026-10-22, riletta il
// 2026-10-23), al tavolo Ruby vero: A gioca «Marea Inversa» col bot, le
// carte spawnate in mano, giocate coi gesti del core con le mire scelte da
// sé (setAuto sul posto A), e la verifica sullo stato — la Stasi imposta e
// numerata, il PV di Seyra, la tappata ascoltata (il muro e il Vaso), la
// sentenza del dado, la ricerca in Ritiro, l'esilio a tempo che aspetta il
// d12 — e sui verdetti del tavolo.
//
//   node scripts/qc-auros.mjs [--table ws://…]

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openGame, status, step } from "./game-bench.mjs";

// L'account di prova (gli strumenti di prova sono dei tester): da .env.local, mai stampato.
const env = Object.fromEntries(readFileSync(resolve(import.meta.dirname, "../../.env.local"), "utf8").split("\n").filter(line => line.includes("=")).map(line => { const i = line.indexOf("="); return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const bench = await openGame({ seed: 11, table: opt("table", null), query: "&deck=starter-auros&bot=starter-umani" });
const { page, verdicts, errors } = bench;
const results = {};
const memory = { lastKey: "" };
const until = async (test, ms = 15_000) => {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const s = await status(page);
    if (await test(s)) return true;
    // §4 — l'apertura: A tiene la mano appena l'ha (il banco non fa mulligan).
    await page.evaluate(() => {
      const p = window.__rubyfront.match;
      const st = p.session.state();
      const opening = st.players.a.opening;
      const hand = Object.values(st.cards).filter(c => c.owner === "a" && c.zone === "hand").length;
      if (opening && !opening.kept && hand >= 6 && p.isQuiet()) void p.session.keep();
      // §6.5 — con la mano oltre le 7 in Preparazione il banco non può scartare: si passa al Fronte, dove scarta.
      if (st.active === "a" && st.phase === "preparazione" && hand > 7 && p.isQuiet() && p.scene.isFree()) p.closePhase();
      // La prova deve durare: Seyra non muore per i colpi del bot (strumento di prova).
      if (st.players.a.hp < 8 && !st.over) void p.session.dispatch({ t: "player", seat: "a", patch: { hp: 20 }, test: true });
    });
    await step(page, s, memory);
    await page.waitForTimeout(250);
  }
  return false;
};
const snapshot = () => page.evaluate(() => {
  const st = window.__rubyfront.match.session.state();
  const cards = Object.values(st.cards);
  return {
    turn: st.turn, active: st.active, phase: st.phase, hpA: st.players.a.hp, inflictedA: st.players.a.stasisInflicted ?? 0, stasisSeq: st.stasisSeq ?? 0,
    fired: st.fired ?? [],
    stasis: cards.filter(c => c.stasis).map(c => `${c.uid}@${c.stasisAt}`),
    exiled: cards.filter(c => c.exile).map(c => ({ uid: c.uid, zone: c.zone, ...c.exile })),
    fieldB: cards.filter(c => c.owner === "b" && c.zone === "field").map(c => c.uid),
    rubyfrontA: cards.find(c => c.owner === "a" && (c.cardId === "RBF-074")) ?? null,
  };
});
try {
  await until(s => s.active === "a" && s.phase === "preparazione" && s.quiet && s.turn >= 3, 90_000);
  await page.evaluate(({ user, password }) => window.__rubyfront.match.session.loginPassword(user, password), { user: env.RUBYFRONT_TEST_USER, password: env.RUBYFRONT_TEST_PASSWORD });
  await page.waitForFunction(() => window.__rubyfront.match.session.account()?.tester === true, null, { timeout: 20_000 });
  console.log("tester al tavolo, mazzo:", await page.evaluate(() => window.__rubyfront.match.session.state().players.a.deckId));
  // Le mire di A le sceglie un selettore semplice: il primo candidato. (Il bot perde il suo, da qui: va bene per la prova.)
  await page.evaluate(() => window.__rubyfront.match.gestures.setAuto("a", { pickTarget: (_s, c) => c[0] ?? null, pickFromPile: (_z, c) => c[0] ?? null }));
  const spawn = (uid, cardId) => page.evaluate(({ uid, cardId }) =>
    window.__rubyfront.match.session.dispatch({ t: "spawn", card: { uid, cardId, owner: "a", zone: "hand", face: 0, x: 0, y: 0, order: 99, tapped: false, facedown: false, z: 0 } }), { uid, cardId });
  // Ogni giocata nella Preparazione di A, a tavolo fermo, col Flusso ricaricato (strumento di prova): la mano resta entro le 7.
  const ready = async () => {
    await until(s => s.active === "a" && s.phase === "preparazione" && s.quiet && !s.scene && !s.aim && !s.die, 120_000);
    await page.evaluate(() => window.__rubyfront.match.session.dispatch({ t: "player", seat: "a", patch: { flux: 12, fluxMax: 12 }, test: true }));
  };
  const play = async (uid, spot) => {
    await page.evaluate(({ uid, spot }) => {
      const p = window.__rubyfront.match;
      return p.gestures.playFromHand(p.session.state().cards[uid], spot);
    }, { uid, spot });
    // La scena della giocata e la risoluzione arrivano dopo: si aspetta che si aprano, poi che si chiudano.
    await page.waitForTimeout(3000);
    await until(s => s.quiet && !s.scene && !s.aim && !s.die && !s.pileViewer, 60_000);
    await page.waitForTimeout(1500);
  };
  await page.evaluate(() => window.__rubyfront.match.session.dispatch({ t: "player", seat: "a", patch: { hp: 12 }, test: true }));
  await ready();
  // Seyra schierata: solo in campo ascolta le Stasi (§3.1).
  await page.evaluate(() => window.__rubyfront.match.gestures.deployRubyfront("a"));
  await until(s => s.quiet && !s.scene && !s.die, 20_000);
  let s0 = await snapshot();
  console.log("prima:", JSON.stringify({ turn: s0.turn, hpA: s0.hpA, fieldB: s0.fieldB, rubyfrontY: s0.rubyfrontA?.y }));
  if (s0.fieldB.length === 0) {
    // Senza avversarie in campo niente Stasi: gliene si dà una (strumento di prova, posto B).
    await page.evaluate(() => window.__rubyfront.match.session.dispatch({ t: "spawn", card: { uid: "qc-foe", cardId: "RBF-047", owner: "b", zone: "field", face: 0, x: 821, y: 172, order: 0, tapped: false, facedown: false, z: 3 } }));
    await page.waitForTimeout(1000);
    s0 = await snapshot();
  }
  // 1. L'Entità che entra sul Fronte e mette in Stasi un'avversaria; Seyra guadagna 1 PV.
  await ready();
  s0 = await snapshot();
  await spawn("qc-elder", "RBF-065");
  await page.waitForTimeout(1500);
  await play("qc-elder", { x: 1199, y: 1260 });
  const s1 = await snapshot();
  results.freeze = { stasis: s1.stasis, inflictedA: s1.inflictedA, hpBefore: s0.hpA, hpAfter: s1.hpA, healFired: s1.fired.filter(k => k.includes("on_enter_stasis")) };
  console.log("Stasi all'ingresso + PV di Seyra:", JSON.stringify(results.freeze));
  // 1b. La tappata ascoltata (dal 2026-10-23): il muro dà Stasi a tutte e 1 PV a ogni tappata;
  // il Vaso addosso al Vegliardo tira il d6 alla sua tappata. Si tappa il Vegliardo a mano.
  await ready();
  await spawn("qc-wall", "RBF-067");
  await page.waitForTimeout(1500);
  await play("qc-wall", { x: 821, y: 1260 });
  await ready();
  await spawn("qc-vessel", "RBF-076");
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const p = window.__rubyfront.match;
    const st = p.session.state();
    return p.gestures.assignObject(st.cards["qc-vessel"], st.cards["qc-elder"]);
  });
  await page.waitForTimeout(3000);
  await until(s => s.quiet && !s.scene && !s.aim && !s.die, 60_000);
  const sTapBefore = await snapshot();
  await page.evaluate(() => window.__rubyfront.match.session.dispatch({ t: "tap", uid: "qc-elder", tapped: true }));
  await page.waitForTimeout(3000);
  await until(s => s.quiet && !s.scene && !s.aim && !s.die, 60_000);
  const sTap = await snapshot();
  const tapHeals = verdicts.actions.filter(a => a.action.effect?.event === "on_tap").map(a => `${a.ok ? "ok" : "NO"} ${a.action.effect.source}${a.action.roll ? ` roll=${a.action.roll}` : ""}`);
  results.tap = { hpBefore: sTapBefore.hpA, hpAfter: sTap.hpA, heals: tapHeals, keys: sTap.fired.filter(k => k.includes("on_tap")), stasisGranted: await page.evaluate(() => window.__rubyfront.match.session.state().cards["qc-elder"]?.tapped) };
  console.log("tappata ascoltata (muro + Vaso):", JSON.stringify(results.tap));
  // 1c. La sentenza del dado: un d6 contro la Potenza di un'avversaria — l'Abisso o il −2.
  await ready();
  await spawn("qc-sentence", "RBF-077");
  await page.waitForTimeout(1500);
  await play("qc-sentence", { x: 2368, y: 1260 });
  const sentenced = verdicts.actions.filter(a => a.action.effect?.source === "qc-sentence" || (a.action.t === "roll" && String(a.action.for).includes("qc-sentence")));
  results.sentence = sentenced.map(a => `${a.ok ? "ok" : "NO"} ${a.action.t}${a.action.zone ? `→${a.action.zone}` : ""}${a.action.power ? ` power=${a.action.power}` : ""}${a.action.roll ? ` roll=${a.action.roll}` : ""}${a.action.die ? ` d${a.action.die}` : ""}`);
  console.log("sentenza del dado:", JSON.stringify(results.sentence));
  // 2. La ricerca in Ritiro (dal 2026-10-23): un Oggetto con costo 3 o inferiore dal mazzo in Ritiro, il d6, il riarmo.
  await ready();
  console.log("mazzo di A prima della ricerca:", JSON.stringify(await page.evaluate(() => {
    const st = window.__rubyfront.match.session.state();
    const deck = Object.values(st.cards).filter(c => c.owner === "a" && c.zone === "deck").map(c => c.cardId);
    return { deck: deck.length, objects: deck.filter(id => ["RBF-076", "RBF-033", "RBF-070"].includes(id)).length, entitiesA: Object.values(st.cards).filter(c => c.owner === "a" && c.zone === "field").map(c => c.cardId) };
  })));
  await spawn("qc-quest", "RBF-073");
  await page.waitForTimeout(1500);
  await play("qc-quest", { x: 2368, y: 1260 });
  const searched = verdicts.actions.filter(a => a.action.effect?.source === "qc-quest" || (a.action.t === "roll" && String(a.action.for).includes("qc-quest")));
  results.quest = searched.map(a => `${a.ok ? "ok" : "NO"} ${a.action.t}${a.action.effect?.follow ? `:${a.action.effect.follow}` : ""}${a.action.zone ? `→${a.action.zone}` : ""}${a.action.assignTo ? ` su ${a.action.assignTo}` : ""}${a.action.roll ? ` roll=${a.action.roll}` : ""}${a.action.die ? ` d${a.action.die}` : ""}`);
  console.log("ricerca in Ritiro:", JSON.stringify(results.quest), JSON.stringify(await page.evaluate(() => (window.__rubyfront.match.session.state().fired ?? []).filter(k => k.startsWith("qc-quest")))));
  // 3. L'esilio a tempo: un'avversaria in Ritiro per tre turni di B; al terzo il d12 del tavolo.
  await ready();
  await spawn("qc-tide", "RBF-075");
  await page.waitForTimeout(1500);
  await play("qc-tide", { x: 2368, y: 1260 });
  const s3 = await snapshot();
  results.exileStart = s3.exiled;
  console.log("esilio a tempo:", JSON.stringify(results.exileStart));
  const exiledUid = s3.exiled[0]?.uid;
  // Da qui gioca il bot: gli si ridà un selettore (il suo l'abbiamo coperto con setAuto("a")).
  await page.evaluate(() => window.__rubyfront.match.gestures.setAuto("b", { pickTarget: (_s, c) => c[0] ?? null, pickFromPile: (_z, c) => c[0] ?? null }));
  // I turni passano (A chiude, il bot gioca): fino alla fine dell'esilio.
  const startTurn = s3.turn;
  await until(async s => {
    if (s.over) return true;
    const now = await snapshot();
    return s.turn >= startTurn + 7 || (exiledUid && !now.exiled.some(c => c.uid === exiledUid));
  }, 300_000);
  const s4 = await snapshot();
  const exiledCard = await page.evaluate(uid => { const c = window.__rubyfront.match.session.state().cards[uid]; return c ? { zone: c.zone, exile: c.exile ?? null, tapped: c.tapped } : null; }, exiledUid);
  const d12 = verdicts.actions.filter(a => a.action.t === "roll" && a.action.die === 12).map(a => `${a.ok ? "ok" : "NO"} d12`);
  const back = verdicts.actions.filter(a => a.action.effect?.event === "on_exile_end").map(a => `${a.ok ? "ok" : "NO"} ${a.action.t}→${a.action.zone} roll=${a.action.roll}`);
  const stoppedTurns = verdicts.refused.filter(r => r.includes("tira il d12"));
  results.exileEnd = { turn: s4.turn, over: s4.over, card: exiledCard, d12, back, turnWaited: stoppedTurns.length };
  console.log("fine dell'esilio:", JSON.stringify(results.exileEnd));
} finally {
  const mine = verdicts.actions.filter(a => String(a.action.uid ?? "").startsWith("qc-") || String(a.action.effect?.source ?? "").startsWith("qc-"));
  console.log("verdetti sulle carte di prova:", mine.map(a => `${a.ok ? "ok" : "NO"} ${a.action.t}${a.action.stasis ? " stasis" : ""}${a.action.exile ? " exile" : ""}${a.action.roll ? ` roll=${a.action.roll}` : ""}`).join(" · "));
  console.log("fermati in tutto:", verdicts.refused.length, verdicts.refused.slice(0, 8));
  console.log("errori della pagina:", errors.length, errors.slice(0, 3));
  await bench.close();
}
