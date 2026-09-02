// Riduttore dello stato: applica un'azione e basta.
//
// È volutamente stupido. Non controlla se una mossa è legale, se hai il Flusso
// per pagarla, se le Entità sul Fronte sono più di cinque: è una lavagna, non
// un arbitro. L'unica cosa che garantisce è che due client che partono dallo
// stesso stato e applicano le stesse azioni finiscano identici.

import { FRONT_SLOT_X, MATTER_X, SURFACE_W, TILE_W, frontRowY } from "./ctx.js";
import type { Action, CardInstance, Declaration, GameState, PlayerState, Seat, ZoneId } from "./types.js";
import { SEATS, otherSeat } from "./types.js";

/** Il tetto del Flusso (§3.2): la barra non supera mai 20. */
export const FLUX_CAP = 20;

/**
 * Paga `cost` (§3.2): prima dalla barra, e se non basta col Gettone — un
 * punto a parte, monouso, «utilizzabile in qualsiasi momento». Mai sotto
 * zero: a engine spento il tavolo resta libero, con l'arbitro il «Flusso
 * insufficiente» ferma prima. Gemello: table.rb, pay.
 */
export function pay(player: PlayerState, cost: number): PlayerState {
  if (cost <= 0) return player;
  if (player.flux >= cost) return { ...player, flux: player.flux - cost };
  if (player.token && player.flux + 1 >= cost) return { ...player, flux: player.flux + 1 - cost, token: false };
  return { ...player, flux: 0 };
}

export function newPlayer(name: string): GameState["players"]["a"] {
  return { name, hp: 20, flux: 1, fluxMax: 1, token: false, deckId: null };
}

/**
 * La lavagna di partenza. `active` è chi inizia (§4): l'altro riceve il
 * Gettone Flusso (§3.2, «il giocatore che non inizia la partita riceve un
 * Gettone Flusso»). Chi inizia lo decide chi crea la partita, a caso per
 * ora — il riduttore non tira dadi, così le due lavagne restano uguali.
 */
export function newGame(active: Seat = "a"): GameState {
  const players = { a: newPlayer(""), b: newPlayer("") };
  players[otherSeat(active)].token = true;
  return {
    cards: {},
    // Il nome parte VUOTO: «Giocatore A/B» è solo il ripiego di seatLabel.
    // Pre-compilarlo qui renderebbe impossibile distinguere un posto senza
    // nessuno (che deve leggersi «In attesa…») da uno abitato.
    players,
    turn: 1,
    active,
    phase: "preparazione",
    chat: [],
    declarations: [],
    zTop: 1,
  };
}

/** Carte di una zona, nell'ordine della pila (indice 0 = cima). */
export function zoneCards(state: GameState, seat: Seat, zone: ZoneId): CardInstance[] {
  return Object.values(state.cards)
    .filter(card => card.owner === seat && card.zone === zone)
    .sort((left, right) => left.order - right.order);
}

/** Carte sulla lavagna, dalla più in basso alla più in cima. */
export function fieldCards(state: GameState): CardInstance[] {
  return Object.values(state.cards)
    .filter(card => card.zone === "field")
    .sort((left, right) => left.z - right.z);
}

function orderForTop(state: GameState, seat: Seat, zone: ZoneId): number {
  const cards = zoneCards(state, seat, zone);
  return cards.length === 0 ? 0 : cards[0].order - 1;
}

function orderForBottom(state: GameState, seat: Seat, zone: ZoneId): number {
  const cards = zoneCards(state, seat, zone);
  return cards.length === 0 ? 0 : cards[cards.length - 1].order + 1;
}

export function apply(state: GameState, action: Action): GameState {
  switch (action.t) {
    case "newGame":
      return newGame(action.active ?? "a");

    case "loadDeck": {
      // Il mazzo sostituisce tutto ciò che quel giocatore aveva in tavola:
      // ricaricare un mazzo è ricominciare, per lui soltanto.
      const cards = { ...state.cards };
      for (const card of Object.values(cards)) {
        if (card.owner === action.seat) delete cards[card.uid];
      }
      for (const card of action.cards) cards[card.uid] = { ...card };
      // Le assegnazioni verso carte appena sparite non vogliono più dire niente.
      for (const [uid, card] of Object.entries(cards)) {
        if (card.assignedTo && !cards[card.assignedTo]) {
          const freed = { ...card };
          delete freed.assignedTo;
          cards[uid] = freed;
        }
      }
      return {
        ...state,
        cards,
        // Le frecce che puntavano a carte appena sparite non vogliono più dire
        // niente: se ne vanno con loro.
        declarations: state.declarations.filter(d => cards[d.from] && cards[d.to]),
        players: {
          ...state.players,
          [action.seat]: { ...state.players[action.seat], deckId: action.deckId },
        },
      };
    }

    case "shuffle": {
      // L'ordine arriva già mescolato da chi ha premuto il tasto: il caso si
      // tira una volta sola, altrimenti i due client divergerebbero.
      const cards = { ...state.cards };
      action.order.forEach((uid, index) => {
        const card = cards[uid];
        if (card && card.owner === action.seat && card.zone === "deck") {
          cards[uid] = { ...card, order: index };
        }
      });
      return { ...state, cards };
    }

    case "draw": {
      const deck = zoneCards(state, action.seat, "deck");
      if (deck.length === 0) return state;
      const cards = { ...state.cards };
      let order = orderForBottom(state, action.seat, "hand");
      for (const card of deck.slice(0, action.count)) {
        cards[card.uid] = { ...card, zone: "hand", order, facedown: false };
        order += 1;
      }
      return { ...state, cards };
    }

    case "move": {
      const card = state.cards[action.uid];
      if (!card) return state;
      // Lo schieramento del Rubyfront si paga (§3.1): il costo viaggia
      // nell'azione, come per le carte giocate dalla mano.
      const players = (action.cost ?? 0) > 0
        ? { ...state.players, [card.owner]: pay(state.players[card.owner], action.cost!) }
        : state.players;
      return {
        ...state,
        players,
        cards: { ...state.cards, [action.uid]: { ...card, x: action.x, y: action.y, z: action.z } },
        zTop: Math.max(state.zTop, action.z + 1),
      };
    }

    case "toZone": {
      const card = state.cards[action.uid];
      if (!card) return state;
      const next: CardInstance = { ...card, zone: action.zone };
      if (action.zone === "field") {
        next.x = action.x ?? card.x;
        next.y = action.y ?? card.y;
        next.z = action.z ?? state.zTop;
        next.order = 0;
      } else {
        next.order = action.toBottom
          ? orderForBottom(state, card.owner, action.zone)
          : orderForTop(state, card.owner, action.zone);
        // Uscendo dalla lavagna una carta si raddrizza e si scopre: in mano e
        // nelle pile pubbliche non ha senso restare tappata. Il mazzo è
        // l'eccezione, ed è coperto per definizione dalla vista.
        next.tapped = false;
        next.facedown = false;
        delete next.coveredTurn;
      }
      // Chi lascia il campo esce anche dal combattimento: la sua freccia se ne
      // va, e quella che gli puntava contro pure. §6.3 dice che il blocco non
      // si riassegna — infatti non si riassegna, sparisce e basta.
      const declarations = next.zone === "field"
        ? state.declarations
        : state.declarations.filter(d => d.from !== action.uid && d.to !== action.uid);
      const cards = { ...state.cards, [action.uid]: next };
      // Giocare dalla mano costa (§3.2): il costo viaggia nell'azione e si
      // scala dal Flusso, mai sotto zero — a engine spento il tavolo resta
      // libero, con l'arbitro il «Flusso insufficiente» ferma prima.
      const paying = action.zone === "field" && card.zone === "hand" && (action.cost ?? 0) > 0;
      const players = paying
        ? { ...state.players, [card.owner]: pay(state.players[card.owner], action.cost!) }
        : state.players;
      if (next.zone !== "field") {
        // Fuori dal campo le assegnazioni si sciolgono, in entrambi i versi:
        // l'Oggetto uscito non è più addosso a nessuno, e l'Entità uscita
        // lascia sciolti gli Oggetti che la indicavano (§3.1: il ritorno in
        // campo è sempre disarmato).
        delete next.assignedTo;
        for (const [uid, other] of Object.entries(cards)) {
          if (other.assignedTo === action.uid) {
            const freed = { ...other };
            delete freed.assignedTo;
            cards[uid] = freed;
          }
        }
      }
      let moved: GameState = {
        ...state,
        cards,
        players,
        declarations,
        zTop: Math.max(state.zTop, next.z + 1),
      };
      // Gli Oggetti seguono la loro Entità in Zona di Ritiro (§6.2) e
      // nell'Abisso (§5, «Oggetti che seguono un'Entità morta»): sciolti
      // dall'assegnazione — il ritorno in campo è sempre disarmato — vanno
      // nella stessa pila. In mano o nel mazzo no: lì un'Entità ci va per
      // effetto, e degli Oggetti decide la carta.
      if (next.zone === "ritiro" || next.zone === "abisso") {
        const worn = Object.values(state.cards).filter(other => other.assignedTo === action.uid && other.zone === "field");
        for (const object of worn) moved = apply(moved, { t: "toZone", uid: object.uid, zone: next.zone });
      }
      return moved;
    }

    case "flip": {
      const card = state.cards[action.uid];
      if (!card) return state;
      return { ...state, cards: { ...state.cards, [action.uid]: { ...card, face: action.face } } };
    }

    case "assign": {
      const card = state.cards[action.uid];
      if (!card) return state;
      const next = { ...card };
      if (action.to === null) delete next.assignedTo;
      else next.assignedTo = action.to;
      return { ...state, cards: { ...state.cards, [action.uid]: next } };
    }

    case "tap": {
      const card = state.cards[action.uid];
      if (!card) return state;
      return { ...state, cards: { ...state.cards, [action.uid]: { ...card, tapped: action.tapped } } };
    }

    case "facedown": {
      const card = state.cards[action.uid];
      if (!card) return state;
      // Coprire annota il turno (§6.3): la scoperta a fine giro parte da lì.
      const next: CardInstance = { ...card, facedown: action.facedown };
      if (action.facedown) next.coveredTurn = state.turn;
      else delete next.coveredTurn;
      return { ...state, cards: { ...state.cards, [action.uid]: next } };
    }

    case "player":
      return {
        ...state,
        players: {
          ...state.players,
          [action.seat]: { ...state.players[action.seat], ...action.patch },
        },
      };

    case "turn": {
      // Il contatore ritoccato a mano (active invariato) non è un cambio di
      // turno: si aggiorna il numero e basta.
      if (action.active === state.active) return { ...state, turn: action.turn };
      // Il cambio di turno porta con sé la routine di chi entra, tutta in
      // un'azione sola — così nessuno la compie «per conto» dell'altro, e
      // l'arbitro non vede gesti nel turno altrui: la fase torna in
      // Preparazione (§6, l'unica via del ritorno); si pesca la carta del
      // turno (§6.1); il Flusso massimo cresce
      // di 1 «a partire dal secondo» proprio turno, mai oltre 20 — al primo
      // turno di chi entra (il turno 2 del contatore) resta 1 — e il
      // disponibile si ricarica fin lì (§3.2); le
      // Entità di chi entra si stappano («all'inizio del turno successivo
      // del proprietario», §6.3 — limite noto: la Stasi non è modellata);
      // attacchi e blocchi valevano per il turno chiuso, e le frecce se ne
      // vanno. Ogni effetto resta disfacibile a mano dai contatori.
      const next = action.active;
      const player = state.players[next];
      const firstTurn = action.turn <= 2;
      const grown = firstTurn ? player.fluxMax : Math.min(FLUX_CAP, player.fluxMax + 1);
      const cards = { ...state.cards };
      for (const [uid, card] of Object.entries(cards)) {
        if (card.owner !== next || card.zone !== "field") continue;
        // La copertura «dura un giro completo» (§6.3): coperta al turno T
        // — di regola il turno avversario del contrattacco — si scopre al
        // proprio turno dopo il successivo, T+3. Coperta senza data (una
        // lavagna che non lo sapeva): resta com'è, nel dubbio.
        const uncover = card.facedown && card.coveredTurn !== undefined && action.turn - card.coveredTurn >= 3;
        if (!card.tapped && !uncover) continue;
        const fresh: CardInstance = { ...card, tapped: false };
        if (uncover) {
          fresh.facedown = false;
          delete fresh.coveredTurn;
        }
        cards[uid] = fresh;
      }
      const opened: GameState = {
        ...state,
        cards,
        players: { ...state.players, [next]: { ...player, fluxMax: grown, flux: grown } },
        turn: action.turn,
        active: next,
        phase: "preparazione",
        declarations: [],
      };
      // §6.1 — la Pesca: «il giocatore di turno pesca una carta», e «non si
      // salta mai». A mazzo vuoto non pesca (§9.1: l'esaurimento si decide
      // al confine dei turni, in turn.ts). La mano iniziale e la carta del
      // turno 1 di chi apre arrivano dal carico del mazzo, non da qui.
      return apply(opened, { t: "draw", seat: next, count: 1 });
    }

    case "phase":
      return { ...state, phase: action.phase };

    case "declare":
      // Una carta dichiara una cosa sola per volta: la nuova sostituisce la
      // vecchia (ripensarci è normale, finché non si risolve).
      return {
        ...state,
        declarations: [
          ...state.declarations.filter(d => d.from !== action.declaration.from),
          action.declaration,
        ],
      };

    case "undeclare":
      return { ...state, declarations: state.declarations.filter(d => d.from !== action.from) };

    case "clearCombat":
      return { ...state, declarations: [] };

    case "spawn": {
      // Strumento di prova: la carta compare in fondo alla mano del suo posto.
      const card = { ...action.card, zone: "hand" as const, order: orderForBottom(state, action.card.owner, "hand") };
      return { ...state, cards: { ...state.cards, [card.uid]: card } };
    }

    case "gameOver":
      return { ...state, over: { winner: action.winner, reason: action.reason } };

    case "resolve": {
      // §6.4, risoluzione: chi muore va nell'Abisso — come un toZone, quindi
      // si raddrizza, si scopre, esce dal combattimento e scioglie le
      // assegnazioni — e i danni degli attacchi non bloccati scendono sui PV
      // del Rubyfront del difensore, mai sotto zero (§3.1). Poi l'ondata è
      // finita: il tavolo si sgombera dalle frecce, come a fine turno.
      let next = state;
      let damage = 0;
      for (const battle of action.battles) {
        if (battle.attackerDies && next.cards[battle.attacker]) {
          next = apply(next, { t: "toZone", uid: battle.attacker, zone: "abisso" });
        }
        if (battle.blockerDies && battle.blocker && next.cards[battle.blocker]) {
          next = apply(next, { t: "toZone", uid: battle.blocker, zone: "abisso" });
        }
        damage += battle.damage;
      }
      const foe = otherSeat(action.seat);
      const player = next.players[foe];
      return {
        ...next,
        players: { ...next.players, [foe]: { ...player, hp: Math.max(0, player.hp - damage) } },
        declarations: [],
      };
    }

    case "say":
      // La chat non cresce all'infinito: le ultime 200 righe bastano, e a
      // nuova partita si azzera comunque (case "newGame").
      return { ...state, chat: [...state.chat, action.entry].slice(-200) };
  }
}

/**
 * Passo dello sfalsamento fra due carte impilate. Scende verso destra e verso
 * il basso: così di quella sotto resta scoperto l'angolo in alto a sinistra,
 * cioè costo e nome — la parte che serve per riconoscerla, e quella su cui si
 * passa col mouse per aprirne la descrizione.
 */
export const STACK_STEP = 30;
/** Quanti gradini si tentano prima di rinunciare e sovrapporre. */
const STEPS = 10;

/**
 * Il posto libero più vicino a (x, y): se lì c'è già una carta si scala di un
 * gradino, e così via. Impilare due carte esattamente sovrapposte nasconderebbe
 * quella sotto — e su una lavagna, ciò che non si vede non esiste.
 */
export function stackAt(
  state: GameState,
  x: number,
  y: number,
  exclude?: string
): { x: number; y: number } {
  const others = fieldCards(state).filter(card => card.uid !== exclude);
  // Contro il bordo destro la scaletta non ha dove andare e verrebbe schiacciata
  // dal clamp: lì si scende e basta, in colonna. §5 lo prevede esplicitamente
  // per le Materie permanenti — «una dietro l'altra (o una sotto l'altra)».
  const room = x + STEPS * STACK_STEP <= SURFACE_W - TILE_W;
  const stepX = room ? STACK_STEP : 0;
  for (let step = 0; step < STEPS; step += 1) {
    const spot = { x: x + step * stepX, y: y + step * STACK_STEP };
    const taken = others.some(
      card => Math.abs(card.x - spot.x) < STACK_STEP && Math.abs(card.y - spot.y) < STACK_STEP
    );
    if (!taken) return spot;
  }
  return { x, y };
}

/**
 * Primo dei cinque slot del Fronte libero, dove atterra una carta giocata
 * dalla mano. Se sono tutti occupati si impila sul primo, a scaletta.
 */
export function freeFrontSlot(state: GameState, seat: Seat): { x: number; y: number } {
  const y = frontRowY(seat);
  const busy = fieldCards(state).filter(card => Math.abs(card.y - y) < 40);
  for (const x of FRONT_SLOT_X) {
    if (!busy.some(card => Math.abs(card.x - x) < 40)) return { x, y };
  }
  return stackAt(state, FRONT_SLOT_X[0], y);
}

/**
 * Il posto di una Materia giocata: la fila delle Materie, dietro gli slot
 * (§5) — in coda, una dietro l'altra nell'ordine di discesa, perché quella
 * fila È l'età che l'ordine di risoluzione legge (§8.2). Contro il bordo
 * destro la scaletta di stackAt scende in colonna, come §5 prevede.
 */
export function matterSpot(state: GameState, seat: Seat): { x: number; y: number } {
  return stackAt(state, MATTER_X, frontRowY(seat));
}

/**
 * Dove atterra una carta GIOCATA in campo: le Entità sul primo slot libero
 * del Fronte, le Materie nella loro fila — mai sugli slot (§5). Tutte le vie
 * del giocare passano di qui: doppio click, ricerca, aggancio del rilascio.
 */
export function playSpot(state: GameState, seat: Seat, kind: string | null): { x: number; y: number } {
  return kind === "matter" ? matterSpot(state, seat) : freeFrontSlot(state, seat);
}

/** Mescola una copia dell'array (Fisher-Yates). */
export function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

/** La dichiarazione fatta da una carta, se c'è. */
export function declarationOf(state: GameState, uid: string): Declaration | undefined {
  return state.declarations.find(d => d.from === uid);
}

/**
 * Chi chiude la fase in corso: chi è di turno — salvo la Reazione, che è
 * la fase del difensore e la chiude lui (§6.4: «conclusa la Reazione,
 * blocchi assegnati o rinuncia del difensore»).
 */
export function phaseCloser(state: GameState): Seat {
  return state.phase === "reazione" ? otherSeat(state.active) : state.active;
}

/** C'è un'ondata in piedi: almeno un attacco dichiarato (§6.3, punto 3). */
export function waveDeclared(state: GameState): boolean {
  return state.declarations.some(d => d.kind === "attack");
}

/** Prossimo numero d'ondata: gli attacchi si risolvono in quest'ordine (§6.3). */
export function nextWaveOrder(state: GameState, seat: Seat): number {
  const mine = state.declarations.filter(d => d.kind === "attack" && d.seat === seat);
  return mine.reduce((top, d) => Math.max(top, d.order), 0) + 1;
}

/** Nessun nome e nessuna carta: quel posto non è ancora di nessuno. */
export function seatWaiting(state: GameState, seat: Seat): boolean {
  return (
    !state.players[seat].name &&
    !Object.values(state.cards).some(card => card.owner === seat)
  );
}

export function seatLabel(state: GameState, seat: Seat, me?: Seat): string {
  if (state.players[seat].name) return state.players[seat].name;
  // Dall'altro lato del tavolo un posto vuoto non è un «Giocatore»
  // fantasma: è un'attesa. Il proprio posto invece resta Giocatore A/B
  // (dire a me stesso che sono in attesa non avrebbe senso).
  if (seat !== me && me !== undefined && seatWaiting(state, seat)) return "In attesa…";
  return seat === "a" ? "Giocatore A" : "Giocatore B";
}

export { SEATS };
