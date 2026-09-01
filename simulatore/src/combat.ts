// Le dichiarazioni di combattimento (§6.3), fuori dal tavolo per una ragione
// sola: passano dal giudizio dell'engine, e ciò che le segue — il tap
// dell'attaccante, la copertura del contrattaccante, la riga in chat — deve
// partire soltanto se la dichiarazione è passata. Qui niente DOM: si può
// provare con un Ctx finto (test/combat.test.ts).

import type { Ctx } from "./ctx.js";
import { nextWaveOrder, seatLabel } from "./state.js";
import type { CardInstance, Declaration } from "./types.js";
import { otherSeat } from "./types.js";

/** Dichiara l'attacco di `card` al Rubyfront avversario (`target`). */
export async function declareAttack(
  ctx: Ctx,
  card: CardInstance,
  target: CardInstance | undefined
): Promise<void> {
  const foe = otherSeat(card.owner);
  if (!target) {
    ctx.log(`${seatLabel(ctx.state(), foe)} non ha il Rubyfront in campo: nessun bersaglio.`, foe);
    return;
  }
  const order = nextWaveOrder(ctx.state(), card.owner);
  const passed = await ctx.dispatch({
    t: "declare",
    declaration: {
      id: crypto.randomUUID(),
      from: card.uid,
      to: target.uid,
      kind: "attack",
      seat: card.owner,
      order,
    },
  });
  // Fermata dal poliziotto (es. §6.2, attesa di evocazione): niente tap,
  // niente riga — il gesto non è avvenuto.
  if (!passed) return;
  // Il tap scatta alla dichiarazione dell'ondata (§6.3). Resta comunque
  // libero: stapparla a mano non disfa la freccia.
  if (!card.tapped) void ctx.dispatch({ t: "tap", uid: card.uid, tapped: true });
  ctx.log(`${seatLabel(ctx.state(), card.owner)} attacca (${order}).`, card.owner);
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
      seat: blocker.owner,
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
  ctx.log(
    `${seatLabel(ctx.state(), blocker.owner)} ${kind === "counter" ? "contrattacca" : "blocca"}.`,
    blocker.owner
  );
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
  const gesture =
    declared.kind === "attack"
      ? `annulla l'attacco (${declared.order})`
      : declared.kind === "counter"
        ? "annulla il contrattacco"
        : "annulla il blocco";
  ctx.log(`${seatLabel(ctx.state(), card.owner)} ${gesture}.`, card.owner);
}
