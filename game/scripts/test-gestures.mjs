// La prova dei gesti del giocatore nel gioco (F4): «Schiera» sul riquadro
// del Rubyfront in Richiamo; il doppio tocco che gioca un'Entità dalla mano
// (§3.2), una per ogni tuo turno; il trascinamento di un Oggetto dalla mano
// sopra una tua Entità (§3.1: le si assegna); in un turno successivo il velo
// coi tasti che si apre al passaggio e «Attacca» (§6.3) — l'Entità appena
// scesa aspetta (§6.2). Il bot gioca l'altra metà; scene, fasi ed eccesso di
// mano vanno avanti da soli (game-bench.mjs).
//
//   node scripts/test-gestures.mjs --out <cartella> [--seed 7]

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { openGame, step, status } from "./game-bench.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const out = resolve(process.cwd(), opt("out", "test-gestures"));
mkdirSync(out, { recursive: true });

const bench = await openGame({ seed: Number(opt("seed", "7")), table: opt("table", null) });
const { page } = bench;
const results = { deploy: false, played: null, drag: null, veil: false, attack: null };
const photo = async name => {
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  console.log(`  foto: ${name}`);
};
const center = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

try {
  const memory = { lastKey: "" };
  /** Le Entità giocate col doppio tocco, col loro turno. */
  const plays = new Map();
  /** I doppi tocchi già provati, per turno e fase: un rifiuto non si ritenta all'infinito. */
  const tried = new Set();
  /** I turni in cui il gesto d'attacco non c'era: il perché si stampa una volta. */
  const noAttack = new Set();
  const started = Date.now();
  let lastTurn = 0;
  while (Date.now() - started < 6 * 60_000 && !(results.attack && results.drag)) {
    const s = await status(page);
    if (s.over || s.turn > 20) break;
    if (s.turn !== lastTurn) {
      lastTurn = s.turn;
      console.log(`turno ${s.turn} (${s.active}, ${s.phase})`);
    }
    // «Schiera» in vista sul tuo Rubyfront in Richiamo: la foto, una volta.
    if (!results.deploy && s.rubyfrontButtons > 0 && s.quiet) {
      results.deploy = true;
      await photo("deploy");
    }
    const isMine = s.active === "a" && s.quiet && !s.chain;
    const inPlay = isMine && (s.phase === "preparazione" || s.phase === "fronte");

    // 1. Il doppio tocco su un'Entità in mano che puoi pagare: una per turno, e solo in
    // Preparazione (§6.2: nel Fronte si dichiara, non si gioca — l'arbitro lo fermerebbe).
    const key = `${s.turn}|${s.phase}`;
    if (isMine && s.phase === "preparazione" && !tried.has(key) && ![...plays.values()].includes(s.turn)) {
      const target = await page.evaluate(() => {
        const p = window.__rubyfront.match;
        const st = p.session.state();
        const hand = Object.values(st.cards).filter(c => c.owner === "a" && c.zone === "hand").sort((x, y) => x.order - y.order);
        const card = hand.find(c => p.session.ctx.card(c.cardId).kind === "entity" && !p.gestures.unaffordable(c));
        const box = card && p.table.screenBox(card.uid);
        return box ? { uid: card.uid, name: p.session.ctx.card(card.cardId).name, box } : null;
      });
      if (target) {
        tried.add(key);
        const at = center(target.box);
        await page.mouse.click(at.x, at.y);
        await page.waitForTimeout(90);
        await page.mouse.click(at.x, at.y);
        await page.waitForTimeout(1200);
        const zone = await page.evaluate(uid => window.__rubyfront.match.session.state().cards[uid]?.zone ?? null, target.uid);
        console.log(`doppio tocco su «${target.name}»: ora sta in ${zone}`);
        if (zone === "field") plays.set(target.uid, s.turn);
        results.played ??= zone;
        continue;
      }
    }

    // 2. Il trascinamento: un Oggetto dalla mano sopra una tua Entità in campo (§3.1).
    if (inPlay && !results.drag && plays.size) {
      const target = await page.evaluate(() => {
        const p = window.__rubyfront.match;
        const st = p.session.state();
        const kind = card => p.session.ctx.card(card.cardId).kind;
        const object = Object.values(st.cards).find(c => c.owner === "a" && c.zone === "hand" && kind(c) === "object" && !p.gestures.unaffordable(c));
        const bearer = Object.values(st.cards).find(c => c.owner === "a" && c.zone === "field" && kind(c) === "entity");
        const from = object && p.table.screenBox(object.uid);
        const to = bearer && p.table.screenBox(bearer.uid);
        return from && to ? { object: object.uid, bearer: bearer.uid, name: p.session.ctx.card(object.cardId).name, from, to } : null;
      });
      if (target) {
        const from = center(target.from);
        const to = center(target.to);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 12 });
        await page.waitForTimeout(200);
        await photo("drag");
        await page.mouse.up();
        await page.waitForTimeout(1500);
        results.drag = await page.evaluate(({ object, bearer }) => {
          const card = window.__rubyfront.match.session.state().cards[object];
          return card?.assignedTo === bearer ? "assegnato" : `${card?.zone ?? "sparito"}/${card?.assignedTo ?? "-"}`;
        }, target);
        console.log(`trascinamento di «${target.name}» sull'Entità: ${results.drag}`);
        continue;
      }
    }

    // 3. In Fase di Fronte, con un'Entità giocata in un tuo turno precedente: il velo, poi «Attacca».
    const readyOnes = [...plays].filter(([, turn]) => turn < s.turn).map(([uid]) => uid);
    if (isMine && s.phase === "fronte" && !results.attack && !noAttack.has(s.turn) && readyOnes.length) {
      const target = await page.evaluate(ids => {
        const p = window.__rubyfront.match;
        const st = p.session.state();
        const uid = p.tableGestures.cardsWithActions().find(id => ids.includes(id) && st.cards[id]?.zone === "field");
        const box = uid && p.table.screenBox(uid);
        return box ? { uid, box } : null;
      }, readyOnes);
      if (target) {
        const at = center(target.box);
        await page.mouse.move(at.x - 400, at.y);
        await page.mouse.move(at.x, at.y, { steps: 6 });
        await page.waitForTimeout(400);
        const buttons = await page.evaluate(() => {
          const tableGestures = window.__rubyfront.stage.world.children.find(child => child.label === "gestures");
          const veil = tableGestures?.children.find(child => child.label === "veil");
          // Le zone dei tasti non disegnano nulla: i loro riquadri sono le aree di tocco, portate sullo schermo.
          return (veil?.children ?? []).filter(child => child.label === "tap" && child.hitArea).map(child => {
            const area = child.hitArea;
            return child.toGlobal({ x: area.x + area.width / 2, y: area.y + area.height / 2 });
          });
        });
        results.veil = buttons.length > 0;
        await photo("veil");
        if (buttons.length) {
          await page.mouse.click(buttons[0].x, buttons[0].y);
          await page.waitForTimeout(1500);
          results.attack = await page.evaluate(uid => window.__rubyfront.match.session.state().declarations.find(d => d.from === uid)?.kind ?? "nessuna", target.uid);
          console.log(`«Attacca»: dichiarazione ${results.attack}`);
          await photo("attack");
        }
        continue;
      }
      // Il gesto non c'è: si dice perché, e il turno va avanti.
      noAttack.add(s.turn);
      const why = await page.evaluate(ids => {
        const p = window.__rubyfront.match;
        const st = p.session.state();
        return { entities: ids.map(id => ({ zone: st.cards[id]?.zone ?? "gone", tapped: st.cards[id]?.tapped ?? null })), withGestures: p.tableGestures.cardsWithActions() };
      }, readyOnes);
      console.log(`  turno ${s.turn}, Fronte senza «Attacca»: ${JSON.stringify(why)}`);
    }
    await step(page, s, memory);
    await page.waitForTimeout(300);
  }
  console.log(`esiti: ${JSON.stringify(results)}`);
  const own = bench.verdicts.actions.filter(entry => entry.actor === "a" && !["phase", "turn", "draw", "shuffle", "loadDeck", "player", "say", "resolve"].includes(entry.action.t));
  console.log(`gesti di A giudicati: ${own.map(entry => `${entry.action.t}${entry.ok ? "" : " (fermato)"}`).join(", ") || "nessuno"}`);
  // I motivi dei fermi, distinti e contati: il primo e l'ultimo da soli ingannano.
  const reasons = new Map();
  for (const reducedMotion of bench.verdicts.refused) reasons.set(reducedMotion, (reasons.get(reducedMotion) ?? 0) + 1);
  console.log(`verdetti passati: ${bench.verdicts.ok}, fermati: ${bench.verdicts.refused.length}${[...reasons].map(([reason, n]) => `\n  ${n}× ${reason}`).join("")}`);
  console.log(`errori della pagina: ${bench.errors.length}${bench.errors.length ? `\n  ${bench.errors.slice(0, 8).join("\n  ")}` : ""}`);
} finally {
  await bench.close();
}
