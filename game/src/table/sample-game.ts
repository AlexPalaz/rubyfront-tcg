// La partita di prova del tavolo (F3): una lista di azioni che porta a una
// partita a metà — turno 5, tocca ad A in Fase di Fronte, i due Rubyfront
// schierati, Entità sui Fronti, una Materia nella sua fila, un Oggetto
// assegnato, una carta tappata e una coperta, le pile con qualche carta, le
// mani, un attacco dichiarato — e, a richiesta, la catena di risposta aperta
// (§7.2: B risponde in Reazione con una Reattiva, A rilancia con un'altra).
// Passa tutta dal riduttore vero (core/state),
// con i mazzi in ordine fisso (niente mescolata): la stessa lista si dà al
// gioco e al simulatore (`__rbf.dispatch`), e le due lavagne vengono uguali.

import { cardStats, getDeck, isRubyfront } from "@rubyfront/core/cards";
import { RUBYFRONT_X, SLOT_X, backRowY, frontRowY } from "@rubyfront/core/geometry";
import { STACK_STEP, apply, newGame, playSpot, zoneCards } from "@rubyfront/core/state";
import type { Action, CardInstance, GameState, Seat } from "@rubyfront/core/types";

export const DECK_A = "eredita-perduta";
export const DECK_B = "scissione-profonda";

/** Le carte fisiche di un mazzo, in ordine fisso: il Rubyfront in Zona di Richiamo (§3.1), il resto nel mazzo. */
function cardsOf(deckId: string, seat: Seat): CardInstance[] {
  const deck = getDeck(deckId);
  if (!deck) throw new Error(`mazzo sconosciuto: ${deckId}`);
  const cards: CardInstance[] = [];
  let serial = 0;
  for (const entry of deck.cards) {
    for (let copy = 0; copy < entry.count; copy += 1) {
      serial += 1;
      const rubyfront = isRubyfront(entry.card);
      cards.push({
        uid: `${seat}-${serial}`,
        cardId: entry.card,
        owner: seat,
        zone: rubyfront ? "field" : "deck",
        face: 0,
        x: rubyfront ? SLOT_X.richiamo : 0,
        y: rubyfront ? backRowY(seat) : 0,
        order: serial,
        tapped: false,
        facedown: false,
        z: rubyfront ? 1 : 0,
      });
    }
  }
  return cards;
}

export function sampleGame(options: { chain?: boolean; block?: boolean } = {}): Action[] {
  const actions: Action[] = [];
  let state: GameState = newGame("a");
  const push = (action: Action): void => {
    actions.push(action);
    state = apply(state, action);
  };
  const kind = (card: CardInstance): string | null => cardStats(card.cardId).kind;
  const first = (seat: Seat, zone: "hand" | "deck", test: (card: CardInstance) => boolean): CardInstance | undefined =>
    zoneCards(state, seat, zone).find(test);
  const onField = (seat: Seat, what: string): CardInstance[] =>
    Object.values(state.cards).filter(card => card.owner === seat && card.zone === "field" && kind(card) === what);

  push({ t: "newGame", active: "a" });
  for (const [seat, deckId] of [["a", DECK_A], ["b", DECK_B]] as const) {
    const cards = cardsOf(deckId, seat);
    const rubyfront = cards.find(card => isRubyfront(card.cardId));
    const hp = rubyfront ? cardStats(rubyfront.cardId).health : null;
    push({ t: "loadDeck", seat, deckId, cards, ...(hp === null ? {} : { hp }) });
  }
  // L'apertura (§4) e la carta del turno 1 di chi apre (§6.1), poi i turni fino al 5.
  push({ t: "draw", seat: "a", count: 6 });
  push({ t: "draw", seat: "b", count: 6 });
  push({ t: "draw", seat: "a", count: 1 });
  for (const turn of [2, 3, 4, 5]) push({ t: "turn", turn, active: turn % 2 === 0 ? "b" : "a" });

  // I Rubyfront schierati sulla fila del Fronte (§3.1).
  for (const seat of ["a", "b"] as const) {
    const rubyfront = Object.values(state.cards).find(card => card.owner === seat && isRubyfront(card.cardId));
    if (rubyfront) push({ t: "move", uid: rubyfront.uid, x: RUBYFRONT_X, y: frontRowY(seat), z: state.zTop + 1 });
  }

  // Le Entità sul Fronte: tre per A, due per B (dalla mano, poi dal mazzo se servono).
  for (const [seat, count] of [["a", 3], ["b", 2]] as const) {
    for (let index = 0; index < count; index += 1) {
      const card = first(seat, "hand", c => kind(c) === "entity") ?? first(seat, "deck", c => kind(c) === "entity");
      if (!card) break;
      const spot = playSpot(state, seat, "entity");
      push({ t: "toZone", uid: card.uid, zone: "field", x: spot.x, y: spot.y, z: state.zTop + 1 });
    }
  }

  // Una Materia di A nella sua fila (§5), un Oggetto assegnato a un'Entità di B (§3.1).
  const matter = first("a", "hand", c => kind(c) === "matter") ?? first("a", "deck", c => kind(c) === "matter");
  if (matter) {
    const spot = playSpot(state, "a", "matter");
    push({ t: "toZone", uid: matter.uid, zone: "field", x: spot.x, y: spot.y, z: state.zTop + 1 });
  }
  const bearer = onField("b", "entity")[0];
  const object = first("b", "hand", c => kind(c) === "object") ?? first("b", "deck", c => kind(c) === "object");
  if (bearer && object) {
    push({ t: "toZone", uid: object.uid, zone: "field", x: bearer.x + STACK_STEP, y: bearer.y + STACK_STEP, z: bearer.z - 1, assignTo: bearer.uid });
  }

  // Una carta tappata (B) e una coperta (A).
  const tapped = onField("b", "entity")[1];
  if (tapped) push({ t: "tap", uid: tapped.uid, tapped: true });
  const covered = onField("a", "entity")[2];
  if (covered) push({ t: "facedown", uid: covered.uid, facedown: true });

  // Le pile: dall'alto del mazzo, due nell'Abisso e tre in Ritiro per posto.
  for (const seat of ["a", "b"] as const) {
    for (const zone of ["abisso", "abisso", "ritiro", "ritiro", "ritiro"] as const) {
      const card = zoneCards(state, seat, "deck")[0];
      if (card) push({ t: "toZone", uid: card.uid, zone });
    }
  }

  // Le mani a 5 (A) e 4 (B): l'eccesso scartato in Ritiro (§6.5).
  for (const [seat, keep] of [["a", 5], ["b", 4]] as const) {
    for (const card of zoneCards(state, seat, "hand").slice(keep)) push({ t: "toZone", uid: card.uid, zone: "ritiro" });
  }

  // Flusso e PV a metà partita, il Gettone di B ancora da spendere (§3.2).
  push({ t: "player", seat: "a", patch: { flux: 2 } });
  push({ t: "player", seat: "b", patch: { hp: state.players.b.hp - 4 } });

  // La Fase di Fronte e un attacco dichiarato al Rubyfront avversario (§6.3).
  push({ t: "phase", phase: "fronte" });
  const attacker = onField("a", "entity")[0];
  const target = Object.values(state.cards).find(card => card.owner === "b" && isRubyfront(card.cardId));
  if (attacker && target) {
    push({ t: "declare", declaration: { id: "prova-1", from: attacker.uid, to: target.uid, kind: "attack", seat: "a", order: 1 } });
  }
  // §6.3 — a richiesta, in Reazione B ferma l'attaccante con una sua Entità: la freccia del blocco.
  if (options.block && attacker) {
    push({ t: "phase", phase: "reazione" });
    const blocker = onField("b", "entity").find(card => !card.tapped);
    if (blocker) push({ t: "declare", declaration: { id: "prova-2", from: blocker.uid, to: attacker.uid, kind: "block", seat: "b", order: 0 } });
  }
  if (!options.chain) return actions;

  // §7.2 — la catena: in Reazione B risponde con una Reattiva, A rilancia.
  push({ t: "phase", phase: "reazione" });
  for (const [seat, cardId] of [["b", "RBF-036"], ["a", "RBF-016"]] as const) {
    const card = first(seat, "hand", c => c.cardId === cardId) ?? first(seat, "deck", c => c.cardId === cardId);
    if (!card) continue;
    const spot = playSpot(state, seat, "matter");
    push({ t: "toZone", uid: card.uid, zone: "field", x: spot.x, y: spot.y, z: state.zTop + 1, chain: true });
  }
  return actions;
}
