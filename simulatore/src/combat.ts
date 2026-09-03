// Le dichiarazioni di combattimento (§6.3), fuori dal tavolo per una ragione
// sola: passano dal giudizio dell'engine, e ciò che le segue — il tap
// dell'attaccante, la copertura del contrattaccante, la riga in chat — deve
// partire soltanto se la dichiarazione è passata. Qui niente DOM: si può
// provare con un Ctx finto (test/combat.test.ts).

import { msg, type LogMsg } from "./i18n.js";
import type { CardFacts, Ctx } from "./ctx.js";
import { controllerOf, nextWaveOrder } from "./state.js";
import type { Battle, CardInstance, Declaration, GameState, Seat } from "./types.js";
import { otherSeat } from "./types.js";

/**
 * La risoluzione dell'ondata (§6.3 «Risoluzione di una battaglia», §6.4
 * «Risoluzione»), calcolata e basta: nessuna azione parte da qui. Le
 * battaglie vanno nell'ordine di dichiarazione degli attaccanti; per
 * ciascuna si guarda chi la ferma:
 *
 *   - nessuno → l'attacco passa: danni pari alla Potenza dell'attaccante;
 *   - un blocco → si confrontano le Potenze: bloccante inferiore muore,
 *     pari muoiono entrambi, superiore non muore nessuno — e l'attacco è
 *     comunque bloccato;
 *   - un contrattacco → la Potenza del bloccante più il suo +N: totale
 *     superiore, muore l'attaccante; pari, entrambi; inferiore, il
 *     contrattaccante.
 *
 * Le uscite dal campo fra dichiarazione e risoluzione sono già sistemate a
 * monte: chi lascia il campo perde la sua freccia (state.ts, toZone), quindi
 * un attaccante uscito non ha battaglia e un bloccante uscito lascia
 * l'attacco non bloccato — «il blocco non si riassegna». Se a una carta
 * manca la Potenza nel catalogo il calcolo si arrende (`null`): si risolve a
 * mano, come prima. Limiti dichiarati: Stasi, Vendetta e le Reattive come
 * bloccanti non sono modellate.
 */
/** La Potenza in campo: quella stampata più il bonus fino a fine turno (§8.2). Gemello: engine.rb, power_of. */
export function powerOf(card: CardInstance, facts: (cardId: string) => CardFacts): number | null {
  const printed = facts(card.cardId).power;
  return printed === null ? null : printed + (card.powerBonus ?? 0);
}

/** Una parola chiave stampata, o concessa fino a fine turno (§8.2). */
export function hasKeyword(card: CardInstance, keyword: string, facts: (cardId: string) => CardFacts): boolean {
  return facts(card.cardId).keywords.includes(keyword) || (card.grants ?? []).includes(keyword);
}

export function resolveWave(state: GameState, seat: Seat, facts: (cardId: string) => CardFacts): Battle[] | null {
  const onField = (uid: string): CardInstance | undefined => {
    const card = state.cards[uid];
    return card && card.zone === "field" ? card : undefined;
  };
  const attacks = state.declarations
    .filter(d => d.kind === "attack" && d.seat === seat && onField(d.from))
    .sort((a, b) => a.order - b.order);
  const battles: Battle[] = [];
  for (const attack of attacks) {
    const attacker = onField(attack.from)!;
    const attackerPower = powerOf(attacker, facts);
    if (attackerPower === null) return null;
    const block = state.declarations.find(
      d => d.to === attack.from && (d.kind === "block" || d.kind === "counter") && onField(d.from)
    );
    if (!block) {
      battles.push({ attacker: attack.from, kind: "unblocked", attackerDies: false, blockerDies: false, damage: attackerPower });
      continue;
    }
    const blocker = onField(block.from)!;
    const blockerFacts = facts(blocker.cardId);
    const blockerPower = powerOf(blocker, facts);
    if (blockerPower === null) return null;
    const counter = block.kind === "counter";
    const total = counter ? blockerPower + (blockerFacts.counterattack ?? 0) : blockerPower;
    // Nel blocco normale l'attaccante muore SOLO nel pareggio — o quando il
    // bloccante ha Vendetta e lo supera (§8.1); nel contrattacco anche
    // quando il totale lo supera (§6.3).
    const revenge = !counter && hasKeyword(blocker, "revenge", facts) && total > attackerPower;
    battles.push({
      attacker: attack.from,
      blocker: block.from,
      kind: counter ? "counter" : "block",
      attackerDies: counter ? total >= attackerPower : total === attackerPower || revenge,
      blockerDies: total <= attackerPower,
      damage: 0,
    });
  }
  return battles;
}

/** La riga in chat di una battaglia, coi nomi e i numeri. */
export function describeBattle(battle: Battle, index: number, cardId: (uid: string) => string): LogMsg {
  const attackerCard = cardId(battle.attacker);
  if (battle.kind === "unblocked") {
    return msg("log.battle.unblocked", { n: index, attackerCard, damage: battle.damage });
  }
  const blockerCard = cardId(battle.blocker ?? "?");
  const fate = msg(
    battle.attackerDies && battle.blockerDies
      ? "fate.both"
      : battle.attackerDies
        ? "fate.attacker"
        : battle.blockerDies
          ? "fate.blocker"
          : "fate.none"
  );
  return msg(battle.kind === "counter" ? "log.battle.counter" : "log.battle.block", { n: index, blockerCard, attackerCard, fate });
}

/** Dichiara l'attacco di `card` al Rubyfront avversario (`target`). */
export async function declareAttack(
  ctx: Ctx,
  card: CardInstance,
  target: CardInstance | undefined
): Promise<boolean> {
  // Attacca chi comanda la carta: il proprietario, o chi la controlla (§8.2).
  const by = controllerOf(card);
  const foe = otherSeat(by);
  if (!target) {
    ctx.log(msg("log.notarget", { seat: foe }), foe);
    return false;
  }
  const order = nextWaveOrder(ctx.state(), by);
  const passed = await ctx.dispatch({
    t: "declare",
    declaration: {
      id: crypto.randomUUID(),
      from: card.uid,
      to: target.uid,
      kind: "attack",
      seat: by,
      order,
    },
  });
  // Fermata dal poliziotto (es. §6.2, attesa di evocazione): niente tap,
  // niente riga — il gesto non è avvenuto.
  if (!passed) return false;
  // Il tap scatta alla dichiarazione dell'ondata (§6.3). Resta comunque
  // libero: stapparla a mano non disfa la freccia.
  if (!card.tapped) void ctx.dispatch({ t: "tap", uid: card.uid, tapped: true });
  ctx.log(msg("log.attack", { seat: by, n: order }), by);
  return true;
}

/** Dichiara il blocco (o contrattacco) di `blocker` contro `attackerUid`. */
export async function declareBlock(
  ctx: Ctx,
  blocker: CardInstance,
  attackerUid: string,
  kind: "block" | "counter"
): Promise<void> {
  const passed = await ctx.dispatch({
    t: "declare",
    declaration: {
      id: crypto.randomUUID(),
      from: blocker.uid,
      to: attackerUid,
      kind,
      seat: controllerOf(blocker),
      order: 0,
    },
  });
  if (!passed) return;
  // Chi contrattacca si copre, e quella copertura dura un giro intero (§6.3):
  // vale la pena farla scattare da sola.
  //
  // Chi blocca invece NON si tappa da solo. Il manuale dice che si tappa, ma
  // è un tap che non costa niente — arriva nel turno avversario e si stappa
  // subito dopo, «segna solo che ha già bloccato in quel turno di difesa»
  // (§6.3). Quel segno lo dà già la freccia. Tapparlo aggiungeva solo una
  // carta coricata da raddrizzare a mano.
  if (kind === "counter" && !blocker.facedown) {
    void ctx.dispatch({ t: "facedown", uid: blocker.uid, facedown: true });
  }
  ctx.log(msg(kind === "counter" ? "log.counter" : "log.block", { seat: controllerOf(blocker) }), controllerOf(blocker));
}

/**
 * Ritira la dichiarazione di `card`: lo specchio esatto del dichiarare. Ciò
 * che la dichiarazione aveva fatto scattare da solo si disfa da solo — il tap
 * dell'attaccante, la copertura del contrattaccante; il blocco non aveva
 * mosso nulla. La carta si rilegge dallo stato vivo: nel frattempo qualcuno
 * può averla già stappata o scoperta a mano, e non c'è niente da disfare.
 */
export async function undeclare(ctx: Ctx, card: CardInstance, declared: Declaration): Promise<void> {
  const passed = await ctx.dispatch({ t: "undeclare", from: card.uid });
  if (!passed) return;
  const live = ctx.state().cards[card.uid] ?? card;
  if (declared.kind === "attack" && live.tapped) {
    void ctx.dispatch({ t: "tap", uid: card.uid, tapped: false });
  }
  if (declared.kind === "counter" && live.facedown) {
    void ctx.dispatch({ t: "facedown", uid: card.uid, facedown: false });
  }
  const line =
    declared.kind === "attack"
      ? msg("log.undo.attack", { seat: card.owner, n: declared.order ?? "" })
      : msg(declared.kind === "counter" ? "log.undo.counter" : "log.undo.block", { seat: card.owner });
  ctx.log(line, card.owner);
}
