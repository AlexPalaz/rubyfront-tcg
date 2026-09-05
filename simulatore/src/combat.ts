// Le dichiarazioni di combattimento (§6.3), fuori dal tavolo per una ragione
// sola: passano dal giudizio dell'engine, e ciò che le segue — il tap
// dell'attaccante, la copertura del contrattaccante, la riga in chat — deve
// partire soltanto se la dichiarazione è passata. Qui niente DOM: si può
// provare con un Ctx finto (test/combat.test.ts).

import { msg, type LogMsg } from "./i18n.js";
import type { CardFacts, Ctx } from "./ctx.js";
import { controllerOf, fieldCards, nextWaveOrder } from "./state.js";
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
/**
 * La Potenza in campo: quella stampata, più il bonus fino a fine turno
 * (§8.2), più gli statici certificati — mai sotto 0 (§8.2, «Modifiche alla
 * Potenza»). Gemello: engine.rb, power_of.
 */
export function powerOf(card: CardInstance, facts: (cardId: string) => CardFacts, state?: GameState): number | null {
  const printed = facts(card.cardId).power;
  if (printed === null) return null;
  return Math.max(0, printed + (card.powerBonus ?? 0) + (state ? staticPower(state, card, facts) : 0));
}

/** Gli Oggetti in campo addosso a quell'Entità (§3.1). */
export function wornBy(state: GameState, uid: string): CardInstance[] {
  return Object.values(state.cards).filter(card => card.assignedTo === uid && card.zone === "field");
}

/** Le Entità (di `race`) che `seat` comanda in campo, tranne `except`. */
export function countEntities(state: GameState, seat: Seat, race: string | null, facts: (cardId: string) => CardFacts, except?: string): number {
  return fieldCards(state).filter(card => {
    if (card.uid === except || controllerOf(card) !== seat) return false;
    const f = facts(card.cardId);
    return f.kind === "entity" && (race === null || f.race === race);
  }).length;
}

/**
 * Gli statici (§8.2): «+1 mentre attacca, se sul tuo Fronte c'è un'altra
 * Entità Umana» (RBF-002), «+1 per ogni altra Entità Umana sul tuo Fronte»
 * (RBF-010), e quelli degli Oggetti addosso — «+1» (RBF-013), «+1 per ogni
 * Entità Umana sul tuo Fronte» (RBF-014, portatrice compresa). Gemello:
 * engine.rb, static_power.
 */
/** «Questa Entità non si tappa mai» (§8.2, RBF-011). Gemello: engine.rb, never_taps?. */
export function neverTaps(facts: CardFacts): boolean {
  return facts.staticForms.some(form => form.kind === "never_taps");
}

export function staticPower(state: GameState, card: CardInstance, facts: (cardId: string) => CardFacts): number {
  const seat = controllerOf(card);
  let bonus = 0;
  for (const form of facts(card.cardId).staticForms) {
    if (form.kind !== "self_power") continue;
    if (form.whileAttacking) {
      const attacking = state.declarations.some(d => d.from === card.uid && d.kind === "attack");
      if (attacking && countEntities(state, seat, form.requiresOther?.race ?? null, facts, card.uid) >= 1) bonus += form.amount;
    } else if (form.perOther) {
      bonus += form.amount * countEntities(state, seat, form.perOther.race, facts, card.uid);
    }
  }
  for (const object of wornBy(state, card.uid)) {
    for (const form of facts(object.cardId).staticForms) {
      if (form.kind !== "bearer_power") continue;
      bonus += form.per ? form.amount * countEntities(state, seat, form.per.race, facts) : form.amount;
    }
  }
  return bonus;
}

/**
 * Una parola chiave stampata, concessa fino a fine turno (§8.2), o data da
 * un Oggetto addosso «mentre assegnato» (RBF-013: la Stasi agli Umani).
 * Gemello: engine.rb, has_keyword?.
 */
export function hasKeyword(card: CardInstance, keyword: string, facts: (cardId: string) => CardFacts, state?: GameState): boolean {
  if (facts(card.cardId).keywords.includes(keyword) || (card.grants ?? []).includes(keyword)) return true;
  if (!state) return false;
  const race = facts(card.cardId).race;
  return wornBy(state, card.uid).some(object =>
    facts(object.cardId).grantsWhileAssigned.some(grant => grant.keywords.includes(keyword) && (grant.ifRace === null || grant.ifRace === race))
  );
}

/** §8.2 — l'attaccante porta un Oggetto che lo rende bloccabile da più Entità (RBF-014)? */
export function multiBlock(state: GameState, attackerUid: string, facts: (cardId: string) => CardFacts): boolean {
  return wornBy(state, attackerUid).some(object => facts(object.cardId).staticForms.some(form => form.kind === "bearer_power" && form.multiBlock));
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
    const attackerPower = powerOf(attacker, facts, state);
    if (attackerPower === null) return null;
    // Con più bloccanti (§8.2, RBF-014) l'attaccante affronta ciascuno, una
    // battaglia per bloccante, nell'ordine dei blocchi.
    const blocks = state.declarations.filter(d => d.to === attack.from && (d.kind === "block" || d.kind === "counter") && onField(d.from));
    if (blocks.length === 0) {
      battles.push({ attacker: attack.from, kind: "unblocked", attackerDies: false, blockerDies: false, damage: attackerPower });
      continue;
    }
    for (const block of blocks) {
      const blocker = onField(block.from)!;
      const blockerFacts = facts(blocker.cardId);
      // Una Reattiva giocata come bloccante di un'Entità (§6.4): «non c'è
      // confronto di Potenza, l'attacco è comunque bloccato, la sorte
      // dell'attaccante la stabilisce il testo» — RBF-040 non dice nulla —
      // e si consuma.
      if (blockerFacts.kind === "matter") {
        battles.push({ attacker: attack.from, blocker: block.from, kind: "block", attackerDies: false, blockerDies: false, damage: 0, blockerSpent: true });
        continue;
      }
      const blockerPower = powerOf(blocker, facts, state);
      if (blockerPower === null) return null;
      const counter = block.kind === "counter";
      const total = counter ? blockerPower + (blockerFacts.counterattack ?? 0) + (blocker.counterBonus ?? 0) : blockerPower;
      // Nel blocco normale l'attaccante muore SOLO nel pareggio — o quando il
      // bloccante ha Vendetta e lo supera (§8.1); nel contrattacco anche
      // quando il totale lo supera (§6.3).
      const revenge = !counter && hasKeyword(blocker, "revenge", facts, state) && total > attackerPower;
      const dies = total <= attackerPower;
      // §8.1 — la Stasi: chi ce l'ha, bloccando o contrattaccando, invece di
      // morire resta tappata per sempre; l'altra muore comunque.
      const stasis = dies && hasKeyword(blocker, "stasis", facts, state);
      battles.push({
        attacker: attack.from,
        blocker: block.from,
        kind: counter ? "counter" : "block",
        attackerDies: counter ? total >= attackerPower : total === attackerPower || revenge,
        blockerDies: dies && !stasis,
        damage: 0,
        ...(stasis ? { blockerStasis: true } : {}),
      });
    }
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
    battle.blockerStasis
      ? battle.attackerDies ? "fate.stasis.attacker" : "fate.stasis"
      : battle.blockerSpent
        ? "fate.spent"
        : battle.attackerDies && battle.blockerDies
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
  // libero: stapparla a mano non disfa la freccia. «Questa Entità non si
  // tappa mai» (RBF-011): il gesto non parte.
  if (!card.tapped && !neverTaps(ctx.card(card.cardId))) void ctx.dispatch({ t: "tap", uid: card.uid, tapped: true });
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
