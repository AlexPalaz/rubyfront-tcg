// Il riduttore della lavagna: la semantica che anche la copia Ruby
// dell'engine (engine/lib/rubyfront/table.rb) deve rispecchiare. Se un test
// qui cambia, quasi certamente va cambiato anche il gemello là.

import { describe, expect, it } from "vitest";
import { MATTER_X, frontRowY } from "../src/ctx.js";
import { STACK_STEP, apply, attackKey, matterSpot, newGame, pay, playSpot, zoneCards, chainTop } from "../src/state.js";
import type { CardInstance, GameState, Seat } from "../src/types.js";

function deckFor(seat: Seat, count: number): { cards: CardInstance[] } & Extract<Parameters<typeof apply>[1], { t: "loadDeck" }> {
  const cards: CardInstance[] = Array.from({ length: count }, (_, index) => ({
    uid: `${seat}-${index + 1}`,
    cardId: `TEST-${index + 1}`,
    owner: seat,
    zone: "deck",
    face: 0,
    x: 0,
    y: 0,
    order: index,
    tapped: false,
    facedown: false,
    z: 0,
  }));
  return { t: "loadDeck", seat, deckId: "test", cards };
}

function handCount(state: GameState, seat: Seat): number {
  return zoneCards(state, seat, "hand").length;
}

describe("apply", () => {
  it("carica il mazzo e pesca dalla cima", () => {
    let state = apply(newGame(), deckFor("a", 10));
    state = apply(state, { t: "draw", seat: "a", count: 3 });
    expect(handCount(state, "a")).toBe(3);
    expect(zoneCards(state, "a", "deck")).toHaveLength(7);
  });

  it("ricaricare il mazzo azzera solo quel posto", () => {
    let state = apply(newGame(), deckFor("a", 5));
    state = apply(state, deckFor("b", 5));
    state = apply(state, { t: "draw", seat: "a", count: 2 });
    state = apply(state, deckFor("a", 4));
    expect(handCount(state, "a")).toBe(0);
    expect(zoneCards(state, "a", "deck")).toHaveLength(4);
    expect(zoneCards(state, "b", "deck")).toHaveLength(5);
  });

  it("toZone sposta fra le zone", () => {
    let state = apply(newGame(), deckFor("a", 3));
    state = apply(state, { t: "draw", seat: "a", count: 2 });
    state = apply(state, { t: "toZone", uid: "a-1", zone: "abisso" });
    expect(handCount(state, "a")).toBe(1);
    expect(zoneCards(state, "a", "abisso")).toHaveLength(1);
    state = apply(state, { t: "toZone", uid: "a-2", zone: "field" });
    expect(handCount(state, "a")).toBe(0);
  });

  it("pescare da mazzo vuoto non fa nulla", () => {
    let state = apply(newGame(), deckFor("a", 1));
    state = apply(state, { t: "draw", seat: "a", count: 3 });
    expect(handCount(state, "a")).toBe(1);
  });

  it("il turno aggiorna numero e posto attivo", () => {
    const state = apply(newGame(), { t: "turn", turn: 2, active: "b" });
    expect(state.turn).toBe(2);
    expect(state.active).toBe("b");
  });

  it("l'assegnazione segue assign e si scioglie fuori dal campo", () => {
    let state = apply(newGame(), deckFor("a", 3));
    state = apply(state, { t: "toZone", uid: "a-1", zone: "field" });
    state = apply(state, { t: "toZone", uid: "a-2", zone: "field" });
    state = apply(state, { t: "assign", uid: "a-2", to: "a-1" });
    expect(state.cards["a-2"].assignedTo).toBe("a-1");
    // L'Entità esce dal campo: l'Oggetto resta dov'è ma è sciolto (§3.1).
    state = apply(state, { t: "toZone", uid: "a-1", zone: "abisso" });
    expect(state.cards["a-2"].assignedTo).toBeUndefined();
    // Lo scioglimento esplicito funziona anche da solo.
    state = apply(state, { t: "assign", uid: "a-2", to: "a-3" });
    state = apply(state, { t: "assign", uid: "a-2", to: null });
    expect(state.cards["a-2"].assignedTo).toBeUndefined();
  });

  it("l'Oggetto che esce dal campo si scioglie da sé", () => {
    let state = apply(newGame(), deckFor("a", 2));
    state = apply(state, { t: "toZone", uid: "a-1", zone: "field" });
    state = apply(state, { t: "toZone", uid: "a-2", zone: "field" });
    state = apply(state, { t: "assign", uid: "a-2", to: "a-1" });
    state = apply(state, { t: "toZone", uid: "a-2", zone: "hand" });
    expect(state.cards["a-2"].assignedTo).toBeUndefined();
  });

  it("newGame azzera tutto", () => {
    let state = apply(newGame(), deckFor("a", 5));
    state = apply(state, { t: "turn", turn: 3, active: "b" });
    state = apply(state, { t: "newGame" });
    expect(Object.keys(state.cards)).toHaveLength(0);
    expect(state.active).toBe("a");
    expect(state.turn).toBe(1);
  });

  // Gemello della sezione §6.2 Ritiro dell'engine: la semantica che la sua
  // copia del tavolo ricalca — chi va in Ritiro si raddrizza, si scopre e
  // lascia il combattimento.
  it("la carta mandata in Ritiro si raddrizza, si scopre e libera le frecce", () => {
    let state = apply(newGame(), deckFor("a", 1));
    state = apply(state, { t: "toZone", uid: "a-1", zone: "field" });
    state = apply(state, { t: "tap", uid: "a-1", tapped: true });
    state = apply(state, { t: "facedown", uid: "a-1", facedown: true });
    state = apply(state, {
      t: "declare",
      declaration: { id: "d", from: "a-1", to: "rf-b", kind: "attack", seat: "a", order: 1 },
    });
    state = apply(state, { t: "toZone", uid: "a-1", zone: "ritiro" });
    expect(state.cards["a-1"].zone).toBe("ritiro");
    expect(state.cards["a-1"].tapped).toBe(false);
    expect(state.cards["a-1"].facedown).toBe(false);
    expect(state.declarations).toHaveLength(0);
  });

  // §5: le Materie giocate vanno nella loro fila, mai sugli slot del Fronte.
  it("la Materia giocata si mette in coda alla fila delle Materie", () => {
    let state = apply(newGame(), deckFor("a", 2));
    expect(matterSpot(state, "a")).toEqual({ x: MATTER_X, y: frontRowY("a") });
    // La prima scesa occupa la testa: la seconda scende di un gradino, in
    // colonna (contro il bordo destro la scaletta non va di lato).
    state = apply(state, { t: "toZone", uid: "a-1", zone: "field", ...matterSpot(state, "a") });
    expect(matterSpot(state, "a")).toEqual({ x: MATTER_X, y: frontRowY("a") + STACK_STEP });
  });

  it("playSpot smista: Materie nella fila, il resto sul Fronte", () => {
    const state = apply(newGame(), deckFor("a", 1));
    expect(playSpot(state, "a", "matter")).toEqual(matterSpot(state, "a"));
    expect(playSpot(state, "a", "entity").x).not.toBe(MATTER_X);
    expect(playSpot(state, "a", null).x).not.toBe(MATTER_X);
  });

  // Gemelli della sezione §6 dell'engine: le due copie contano uguale.
  it("la partita parte in Preparazione, il Fronte si dichiara e l'ondata passa al difensore", () => {
    let state = newGame();
    expect(state.phase).toBe("preparazione");
    state = apply(state, { t: "phase", phase: "fronte" });
    expect(state.phase).toBe("fronte");
    state = apply(state, { t: "phase", phase: "reazione" });
    expect(state.phase).toBe("reazione");
    // Il cambio di turno riparte dalla Preparazione anche dalla Reazione.
    state = apply(state, { t: "turn", turn: 2, active: "b" });
    expect(state.phase).toBe("preparazione");
  });

  it("il cambio di turno riporta in Preparazione, il ritocco del contatore no", () => {
    let state = apply(newGame(), { t: "phase", phase: "fronte" });
    // Contatore ritoccato a mano: active invariato, la fase resta.
    state = apply(state, { t: "turn", turn: 9, active: "a" });
    expect(state.phase).toBe("fronte");
    // Fine turno vero: si riparte dalla Preparazione (§6, a senso unico).
    state = apply(state, { t: "turn", turn: 10, active: "b" });
    expect(state.phase).toBe("preparazione");
  });
});

// La risoluzione applicata (§6.4): i morti nell'Abisso, i danni sui PV del
// difensore, l'ondata sgomberata. Gemello: table_test.rb, test_resolve_*.
describe("apply resolve", () => {
  function battlefield(): GameState {
    let state = apply(newGame(), deckFor("a", 2));
    state = apply(state, deckFor("b", 1));
    for (const uid of ["a-1", "a-2", "b-1"]) state = apply(state, { t: "toZone", uid, zone: "field", x: 0, y: 0, z: 1 });
    state.declarations = [
      { id: "x", from: "a-1", to: "rf", kind: "attack", seat: "a", order: 1 },
      { id: "y", from: "b-1", to: "a-1", kind: "block", seat: "b", order: 0 },
    ];
    return state;
  }

  it("manda i morti nell'Abisso e sgombera le frecce", () => {
    const state = apply(battlefield(), {
      t: "resolve",
      seat: "a",
      battles: [{ attacker: "a-1", blocker: "b-1", kind: "block", attackerDies: true, blockerDies: true, damage: 0 }],
    });
    expect(state.cards["a-1"].zone).toBe("abisso");
    expect(state.cards["b-1"].zone).toBe("abisso");
    expect(state.cards["a-2"].zone).toBe("field");
    expect(state.declarations).toEqual([]);
    expect(state.players.b.hp).toBe(20);
  });

  it("i danni scendono sui PV del difensore, mai sotto zero", () => {
    let state = battlefield();
    state.players.b.hp = 5;
    state = apply(state, {
      t: "resolve",
      seat: "a",
      battles: [
        { attacker: "a-1", kind: "unblocked", attackerDies: false, blockerDies: false, damage: 4 },
        { attacker: "a-2", kind: "unblocked", attackerDies: false, blockerDies: false, damage: 4 },
      ],
    });
    expect(state.players.b.hp).toBe(0);
    expect(state.players.a.hp).toBe(20);
  });
});

// Il cambio di turno porta con sé la routine di chi entra (§3.2, §6.3):
// gemello in table_test.rb (test_il_cambio_di_turno_*), dove i PV e il
// Flusso non sono tracciati ma stappata e frecce sì.
describe("apply turn", () => {
  function tapped(state: GameState, uid: string, owner: Seat, isTapped: boolean): void {
    state.cards[uid] = { ...deckFor(owner, 1).cards[0], uid, zone: "field", tapped: isTapped };
  }

  it("chi entra pesca la carta del turno (§6.1), e a mazzo vuoto no", () => {
    let state = apply(newGame(), deckFor("b", 2));
    state = apply(state, { t: "turn", turn: 2, active: "b" });
    expect(zoneCards(state, "b", "hand")).toHaveLength(1);
    expect(zoneCards(state, "b", "deck")).toHaveLength(1);
    state = apply(state, { t: "turn", turn: 3, active: "a" });
    expect(zoneCards(state, "a", "hand")).toHaveLength(0);
  });

  it("chi entra si ritrova Flusso nuovo, Entità stappate e frecce sgomberate", () => {
    const state = newGame();
    tapped(state, "b-1", "b", true);
    tapped(state, "b-2", "b", false);
    tapped(state, "a-1", "a", true);
    state.phase = "reazione";
    state.declarations = [{ id: "x", from: "a-1", to: "rf", kind: "attack", seat: "a", order: 1 }];
    state.players.b.flux = 0;
    const next = apply(state, { t: "turn", turn: 2, active: "b" });
    // Al primo turno di chi entra il Flusso massimo resta 1 (§3.2, «a
    // partire dal secondo»): si ricarica e basta.
    expect(next.players.b).toMatchObject({ fluxMax: 1, flux: 1 });
    expect(next.players.a).toMatchObject({ fluxMax: 1, flux: 1 });
    const third = apply(apply(next, { t: "turn", turn: 3, active: "a" }), { t: "turn", turn: 4, active: "b" });
    expect(third.players.a).toMatchObject({ fluxMax: 2, flux: 2 });
    expect(third.players.b).toMatchObject({ fluxMax: 2, flux: 2 });
    expect(next.cards["b-1"].tapped).toBe(false);
    expect(next.cards["a-1"].tapped).toBe(true);
    expect(next.declarations).toEqual([]);
    expect(next.phase).toBe("preparazione");
  });

  it("il Flusso massimo non supera 20 (§3.2)", () => {
    const state = newGame();
    state.players.b.fluxMax = 20;
    state.players.b.flux = 3;
    expect(apply(state, { t: "turn", turn: 2, active: "b" }).players.b).toMatchObject({ fluxMax: 20, flux: 20 });
  });

  it("il contatore ritoccato a mano non è un cambio di turno", () => {
    const state = newGame();
    state.phase = "fronte";
    tapped(state, "a-1", "a", true);
    const next = apply(state, { t: "turn", turn: 5, active: "a" });
    expect(next.turn).toBe(5);
    expect(next.phase).toBe("fronte");
    expect(next.cards["a-1"].tapped).toBe(true);
    expect(next.players.a.fluxMax).toBe(1);
  });
});

// Giocare dalla mano costa (§3.2): il costo viaggia nell'azione e si scala
// dal Flusso. Gemello: table_test.rb, test_giocare_dalla_mano_scala_il_costo.
describe("apply toZone con costo", () => {
  it("dalla mano al campo scala il costo, mai sotto zero", () => {
    let state = apply(newGame(), deckFor("a", 2));
    state = apply(state, { t: "draw", seat: "a", count: 2 });
    state.players.a.flux = 3;
    state = apply(state, { t: "toZone", uid: "a-1", zone: "field", x: 0, y: 0, z: 1, cost: 2 });
    expect(state.players.a.flux).toBe(1);
    expect(state.players.b.flux).toBe(1);
    state = apply(state, { t: "toZone", uid: "a-2", zone: "field", x: 0, y: 0, z: 1, cost: 5 });
    expect(state.players.a.flux).toBe(0);
  });

  it("senza costo, o da fuori mano, non si paga", () => {
    let state = apply(newGame(), deckFor("a", 1));
    state.players.a.flux = 4;
    state = apply(state, { t: "toZone", uid: "a-1", zone: "field", x: 0, y: 0, z: 1, cost: 2 });
    expect(state.players.a.flux).toBe(4);
    state = apply(state, { t: "toZone", uid: "a-1", zone: "hand" });
    state = apply(state, { t: "toZone", uid: "a-1", zone: "field", x: 0, y: 0, z: 1 });
    expect(state.players.a.flux).toBe(4);
  });
});

// Chi inizia lo dice l'azione (§4), e l'altro riceve il Gettone (§3.2).
describe("newGame", () => {
  it("chi non inizia ha il Gettone", () => {
    const state = apply(newGame(), { t: "newGame", active: "b" });
    expect(state.active).toBe("b");
    expect(state.players.a.token).toBe(true);
    expect(state.players.b.token).toBe(false);
    expect(newGame().players.b.token).toBe(true);
  });
});

// La fine (§2, §9) è un'annotazione della lavagna, e Nuova partita la toglie.
describe("apply gameOver", () => {
  it("annota la fine e la nuova partita la cancella", () => {
    let state = apply(newGame(), { t: "gameOver", winner: "a", reason: "hp" });
    expect(state.over).toEqual({ winner: "a", reason: "hp" });
    state = apply(state, { t: "newGame", active: "a" });
    expect(state.over).toBeUndefined();
  });
});

// Il pagamento (§3.2): la barra prima, poi il Gettone. Gemello: table.rb, pay.
describe("pay", () => {
  const player = (flux: number, token: boolean) => ({ name: "", hp: 20, flux, fluxMax: 5, token, deckId: null });

  it("paga dalla barra, e col Gettone quando non basta", () => {
    expect(pay(player(3, true), 2)).toMatchObject({ flux: 1, token: true });
    expect(pay(player(2, true), 3)).toMatchObject({ flux: 0, token: false });
    expect(pay(player(1, false), 3)).toMatchObject({ flux: 0, token: false });
    expect(pay(player(1, true), 5)).toMatchObject({ flux: 0, token: true });
  });

  it("lo schieramento del Rubyfront si paga col move", () => {
    let state = apply(newGame(), deckFor("a", 1));
    state = apply(state, { t: "toZone", uid: "a-1", zone: "field", x: 30, y: 1756, z: 1 });
    state.players.a.flux = 6;
    state = apply(state, { t: "move", uid: "a-1", x: 30, y: 1236, z: 2, cost: 4, roll: 4 });
    expect(state.players.a.flux).toBe(2);
    expect(state.cards["a-1"].y).toBe(1236);
  });
});

// La copertura dura un giro completo (§6.3): coperta al turno T, si scopre
// al proprio turno dopo il successivo. Gemello: table_test.rb.
describe("scoperta a T+3", () => {
  it("coprire annota il turno e il cambio di turno scopre a T+3", () => {
    let state = apply(newGame(), deckFor("a", 1));
    state = apply(state, { t: "toZone", uid: "a-1", zone: "field", x: 442, y: 1236, z: 1 });
    state = apply(state, { t: "turn", turn: 2, active: "b" }); // T: il turno avversario
    state = apply(state, { t: "facedown", uid: "a-1", facedown: true });
    expect(state.cards["a-1"].coveredTurn).toBe(2);
    state = apply(state, { t: "turn", turn: 3, active: "a" }); // T+1
    expect(state.cards["a-1"].facedown).toBe(true);
    state = apply(state, { t: "turn", turn: 4, active: "b" }); // T+2
    state = apply(state, { t: "turn", turn: 5, active: "a" }); // T+3
    expect(state.cards["a-1"].facedown).toBe(false);
    expect(state.cards["a-1"].coveredTurn).toBeUndefined();
  });

  it("una coperta senza data resta com'è, e scoprire a mano toglie la data", () => {
    let state = apply(newGame(), deckFor("a", 1));
    state = apply(state, { t: "toZone", uid: "a-1", zone: "field", x: 442, y: 1236, z: 1 });
    state.cards["a-1"] = { ...state.cards["a-1"], facedown: true };
    state = apply(state, { t: "turn", turn: 2, active: "b" });
    state = apply(state, { t: "turn", turn: 3, active: "a" });
    expect(state.cards["a-1"].facedown).toBe(true);
    state = apply(state, { t: "facedown", uid: "a-1", facedown: false });
    expect(state.cards["a-1"].coveredTurn).toBeUndefined();
  });
});

// Gli Oggetti seguono la loro Entità (§6.2, §5). Gemello: table_test.rb.
describe("gli Oggetti seguono l'Entità", () => {
  function worn(): GameState {
    let state = apply(newGame(), deckFor("a", 3));
    for (const uid of ["a-1", "a-2", "a-3"]) state = apply(state, { t: "toZone", uid, zone: "field", x: 0, y: 0, z: 1 });
    state = apply(state, { t: "assign", uid: "a-2", to: "a-1" });
    state = apply(state, { t: "assign", uid: "a-3", to: "a-1" });
    return state;
  }

  it("in Zona di Ritiro e nell'Abisso, sciolti", () => {
    let state = apply(worn(), { t: "toZone", uid: "a-1", zone: "ritiro" });
    expect(state.cards["a-2"].zone).toBe("ritiro");
    expect(state.cards["a-3"].zone).toBe("ritiro");
    expect(state.cards["a-2"].assignedTo).toBeUndefined();
    state = apply(worn(), { t: "toZone", uid: "a-1", zone: "abisso" });
    expect(zoneCards(state, "a", "abisso").map(card => card.uid).sort()).toEqual(["a-1", "a-2", "a-3"]);
  });

  it("in mano no: restano in campo, sciolti", () => {
    const state = apply(worn(), { t: "toZone", uid: "a-1", zone: "hand" });
    expect(state.cards["a-2"].zone).toBe("field");
    expect(state.cards["a-2"].assignedTo).toBeUndefined();
  });
});

// Lo sguardo nel mazzo applicato (§8.2). Gemello: table_test.rb, test_look_*.
describe("apply look", () => {
  it("la rivelata in mano, le altre in fondo nell'ordine in cui stavano", () => {
    let state = apply(newGame(), deckFor("a", 6));
    const ref = { source: "x", event: "on_enter_field" as const, entering: "x" };
    state = apply(state, { t: "look", seat: "a", count: 4, reveal: "a-2", effect: ref });
    expect(zoneCards(state, "a", "hand").map(card => card.uid)).toEqual(["a-2"]);
    expect(zoneCards(state, "a", "deck").map(card => card.uid)).toEqual(["a-5", "a-6", "a-1", "a-3", "a-4"]);
    state = apply(state, { t: "look", seat: "a", count: 2, effect: ref });
    expect(zoneCards(state, "a", "deck").map(card => card.uid)).toEqual(["a-1", "a-3", "a-4", "a-5", "a-6"]);
    state = apply(state, { t: "look", seat: "a", count: 3, retire: "a-3", roll: 1, effect: ref });
    expect(zoneCards(state, "a", "ritiro").map(card => card.uid)).toEqual(["a-3"]);
    expect(zoneCards(state, "a", "deck").map(card => card.uid)).toEqual(["a-5", "a-6", "a-1", "a-4"]);
  });
});

// Il controllo applicato (§8.2): chi comanda cambia, la proprietà no; lo
// slot extra; la restituzione. Gemello: table_test.rb.
describe("apply control / release", () => {
  it("la carta passa nello slot extra con gli Oggetti, e torna com'è", () => {
    let state = apply(newGame(), deckFor("b", 2));
    state = apply(state, { t: "toZone", uid: "b-1", zone: "field", x: 442, y: 172, z: 1 });
    state = apply(state, { t: "toZone", uid: "b-2", zone: "field", x: 472, y: 202, z: 2 });
    state = apply(state, { t: "assign", uid: "b-2", to: "b-1" });
    const ref = { source: "x", event: "on_enter_field" as const, entering: "x" };
    state = apply(state, { t: "control", uid: "b-1", by: "a", grants: ["surge"], effect: ref });
    expect(state.cards["b-1"]).toMatchObject({ owner: "b", controller: "a", grants: ["surge"], x: 1199 });
    expect(state.cards["b-1"].y).toBe(state.cards["b-1"].y); // nella fila di servizio di A
    expect(state.cards["b-2"].x).toBe(1199 + STACK_STEP);
    state = apply(state, { t: "release", uid: "b-1", zone: "field", x: 821, y: 172 });
    expect(state.cards["b-1"].controller).toBeUndefined();
    expect(state.cards["b-1"].grants).toBeUndefined();
    expect(state.cards["b-1"]).toMatchObject({ x: 821, y: 172 });
    expect(state.cards["b-2"]).toMatchObject({ x: 821 + STACK_STEP, assignedTo: "b-1" });
  });

  it("a Fronte pieno la restituzione va nella Zona di Ritiro, con gli Oggetti", () => {
    let state = apply(newGame(), deckFor("b", 2));
    state = apply(state, { t: "toZone", uid: "b-1", zone: "field", x: 442, y: 172, z: 1 });
    state = apply(state, { t: "toZone", uid: "b-2", zone: "field", x: 472, y: 202, z: 2 });
    state = apply(state, { t: "assign", uid: "b-2", to: "b-1" });
    state = apply(state, { t: "control", uid: "b-1", by: "a", grants: [], effect: { source: "x", event: "on_enter_field", entering: "x" } });
    state = apply(state, { t: "release", uid: "b-1", zone: "ritiro" });
    expect(state.cards["b-1"].zone).toBe("ritiro");
    expect(state.cards["b-2"].zone).toBe("ritiro");
  });
});

// Gli attrezzi degli effetti d'attacco (§8.2): potenziamenti fino a fine
// turno, stappata generale con la Fase di Fronte addizionale, la stappata
// dopo il combattimento e la memoria dell'ondata. Gemelli: table_test.rb.
describe("attrezzi degli effetti d'attacco", () => {
  const field = (state: GameState, uid: string, owner: Seat, extra: Partial<CardInstance> = {}): CardInstance => {
    const card: CardInstance = { uid, cardId: "X", owner, zone: "field", face: 0, x: 0, y: 0, order: 0, tapped: false, facedown: false, z: 1, ...extra };
    state.cards[uid] = card;
    return card;
  };
  const ref = { source: "s", event: "on_attack" as const, entering: "s" };

  it("empower somma la Potenza, concede parole chiave, vieta il blocco; il cambio di turno cancella tutto", () => {
    const state = newGame("a");
    field(state, "e", "b");
    let next = apply(state, { t: "empower", uid: "e", power: 1, effect: ref });
    next = apply(next, { t: "empower", uid: "e", power: 1, grants: ["revenge"], restrict: "block", effect: ref });
    expect(next.cards.e).toMatchObject({ powerBonus: 2, grants: ["revenge"], cannotBlock: true });
    const after = apply(next, { t: "turn", turn: 2, active: "b" });
    expect(after.cards.e.powerBonus).toBeUndefined();
    expect(after.cards.e.cannotBlock).toBeUndefined();
    expect(after.cards.e.grants).toBeUndefined();
  });

  it("empower non tocca una carta fuori dal campo", () => {
    const state = newGame("a");
    field(state, "h", "a", { zone: "hand" });
    expect(apply(state, { t: "empower", uid: "h", power: 1, effect: ref }).cards.h).toEqual(state.cards.h);
  });

  it("refresh stappa chi comanda il posto e promette la Fase di Fronte addizionale col tiro", () => {
    const state = newGame("a");
    field(state, "a1", "a", { tapped: true });
    field(state, "b1", "b", { tapped: true });
    field(state, "c1", "b", { tapped: true, controller: "a" });
    const next = apply(state, { t: "refresh", seat: "a", roll: 17, extra: true, effect: ref });
    expect(next.cards.a1.tapped).toBe(false);
    expect(next.cards.c1.tapped).toBe(false);
    expect(next.cards.b1.tapped).toBe(true);
    expect(next.extraFront).toBe(true);
    const flat = apply(state, { t: "refresh", seat: "a", roll: 3, extra: false, effect: ref });
    expect(flat.extraFront).toBeFalsy();
  });

  it("dalla Reazione si torna al Fronte solo se la fase addizionale è dovuta, e la promessa si consuma", () => {
    const state = { ...newGame("a"), phase: "reazione" as const, extraFront: true, declarations: [{ id: "x", from: "a1", to: "rf", kind: "attack" as const, seat: "a" as const, order: 1 }] };
    const back = apply(state, { t: "phase", phase: "fronte" });
    expect(back).toMatchObject({ phase: "fronte", extraFront: false, declarations: [] });
    const turned = apply(back, { t: "turn", turn: 2, active: "b" });
    expect(turned.extraFront).toBe(false);
  });

  it("resolve stappa chi lo chiede e ricorda l'ondata", () => {
    const state = newGame("a");
    field(state, "a1", "a", { tapped: true });
    field(state, "a2", "a", { tapped: true });
    state.declarations = [
      { id: "1", from: "a2", to: "rf", kind: "attack", seat: "a", order: 2 },
      { id: "2", from: "a1", to: "rf", kind: "attack", seat: "a", order: 1 },
    ];
    const next = apply(state, { t: "resolve", seat: "a", battles: [], untap: ["a1"] });
    expect(next.cards.a1.tapped).toBe(false);
    expect(next.cards.a2.tapped).toBe(true);
    expect(next.lastWave?.a).toEqual(["a1", "a2"]);
  });

  it("toZone con assignTo rimette in campo un Oggetto già assegnato", () => {
    const state = newGame("a");
    field(state, "ent", "a");
    field(state, "obj", "a", { zone: "ritiro" });
    const next = apply(state, { t: "toZone", uid: "obj", zone: "field", x: 0, y: 0, assignTo: "ent", effect: ref });
    expect(next.cards.obj).toMatchObject({ zone: "field", assignedTo: "ent" });
  });
});

// La memoria degli inneschi d'attacco e lo sguardo con le due destinazioni.
describe("memoria degli inneschi e sguardo", () => {
  const field = (state: GameState, uid: string, owner: Seat, extra: Partial<CardInstance> = {}): CardInstance => {
    const card: CardInstance = { uid, cardId: "X", owner, zone: "field", face: 0, x: 0, y: 0, order: 0, tapped: false, facedown: false, z: 1, ...extra };
    state.cards[uid] = card;
    return card;
  };

  it("attackKey rispecchia la chiave dell'engine", () => {
    const ref = { source: "s", event: "on_attack" as const, entering: "a" };
    expect(attackKey({ t: "draw", seat: "a", count: 1, effect: ref })).toBe("s|on_attack:draw|a");
    expect(attackKey({ t: "empower", uid: "u", power: 1, effect: ref })).toBe("s|on_attack:empower:u|a");
    expect(attackKey({ t: "look", seat: "a", count: 2, effect: { ...ref, once: true } })).toBe("s|on_attack:look|turn");
    expect(attackKey({ t: "toZone", uid: "o", zone: "field", assignTo: "a", effect: ref })).toBe("s|on_attack:rearm|a");
    expect(attackKey({ t: "toZone", uid: "h", zone: "abisso", effect: { ...ref, follow: "discard" } })).toBe("s|on_attack:discard|a");
    expect(attackKey({ t: "draw", seat: "a", count: 1, effect: { source: "s", event: "on_enter_field", entering: "a" } })).toBeNull();
  });

  it("apply annota gli inneschi risolti e il cambio di turno li azzera", () => {
    const state = newGame("a");
    field(state, "s", "a");
    let next = apply(state, { t: "empower", uid: "s", power: 1, effect: { source: "s", event: "on_attack", entering: "s" } });
    next = apply(next, { t: "resolve", seat: "a", battles: [], untap: ["s"] });
    expect(next.fired).toEqual(["s|on_attack:empower:s|s", "s|on_attack:untap|turn"]);
    expect(apply(next, { t: "turn", turn: 2, active: "b" }).fired).toEqual([]);
  });

  it("lo sguardo manda la mostrata in Ritiro, o le altre in Ritiro, a seconda della forma", () => {
    const state = newGame("a");
    const d = ["d1", "d2", "d3"].map((uid, order) => field(state, uid, "a", { zone: "deck", order }));
    const ref = { source: "s", event: "on_attack" as const, entering: "s" };
    const retire = apply(state, { t: "look", seat: "a", count: 2, reveal: "d1", revealTo: "ritiro", restTo: "deck", effect: ref });
    expect(retire.cards.d1.zone).toBe("ritiro");
    expect(retire.cards.d2.zone).toBe("deck");
    expect(retire.cards.d2.order).toBeGreaterThan(d[2].order);
    const rest = apply(state, { t: "look", seat: "a", count: 2, reveal: "d1", revealTo: "hand", restTo: "ritiro", effect: ref });
    expect(rest.cards.d1.zone).toBe("hand");
    expect(rest.cards.d2.zone).toBe("ritiro");
    expect(rest.cards.d3.zone).toBe("deck");
  });
});

// Gli attrezzi di Eredità Perduta nel riduttore: Stasi, Contrattacco
// concesso, esilio condizionato, bersaglio dichiarato, flip, sigillo.
// Gemello: table_test.rb, «gli attrezzi di Eredità Perduta».
describe("apply — Eredità Perduta", () => {
  const field = (state: GameState, uid: string, owner: Seat, extra: Partial<CardInstance> = {}): CardInstance => {
    const card: CardInstance = { uid, cardId: "X", owner, zone: "field", face: 0, x: 0, y: 0, order: 0, tapped: false, facedown: false, z: 1, ...extra };
    state.cards[uid] = card;
    return card;
  };
  const ref = { source: "m", event: "on_resolve" as const, entering: "m" };

  it("empower stappa anche dalla Stasi e concede Contrattacco; il turno lo cancella", () => {
    const state = newGame("a");
    field(state, "e", "a", { tapped: true, stasis: true });
    const next = apply(state, { t: "empower", uid: "e", counter: 1, untap: true, effect: ref });
    expect(next.cards.e).toMatchObject({ tapped: false, counterBonus: 1 });
    expect(next.cards.e.stasis).toBeUndefined();
    expect(apply(next, { t: "turn", turn: 2, active: "b" }).cards.e.counterBonus).toBeUndefined();
  });

  it("la Stasi alla risoluzione: resta in campo tappata, e il turno non la stappa; refresh sì", () => {
    const state = newGame("a");
    field(state, "a1", "a");
    field(state, "a2", "a");
    field(state, "b1", "b", { facedown: true, coveredTurn: 1 });
    field(state, "m1", "b");
    state.declarations = [
      { id: "a1", from: "a1", to: "rf-b", kind: "attack", seat: "a", order: 1 },
      { id: "a2", from: "a2", to: "rf-b", kind: "attack", seat: "a", order: 2 },
      { id: "b1", from: "b1", to: "a1", kind: "counter", seat: "b", order: 0 },
      { id: "m1", from: "m1", to: "a2", kind: "block", seat: "b", order: 0 },
    ];
    const next = apply(state, { t: "resolve", seat: "a", battles: [
      { attacker: "a1", blocker: "b1", kind: "counter", attackerDies: false, blockerDies: false, blockerStasis: true, damage: 0 },
      { attacker: "a2", blocker: "m1", kind: "block", attackerDies: false, blockerDies: false, blockerSpent: true, damage: 0 },
    ] });
    expect(next.cards.b1).toMatchObject({ zone: "field", stasis: true, tapped: true, facedown: false });
    expect(next.cards.b1.coveredTurn).toBeUndefined();
    expect(next.cards.m1.zone).toBe("abisso");
    const turned = apply(next, { t: "turn", turn: 2, active: "b" });
    expect(turned.cards.b1.tapped).toBe(true);
    const freed = apply(turned, { t: "refresh", seat: "b", roll: 17, extra: false, effect: { source: "b1", event: "on_attack", entering: "b1" } });
    expect(freed.cards.b1.tapped).toBe(false);
    expect(freed.cards.b1.stasis).toBeUndefined();
  });

  it("con più bloccanti l'attaccante muore una volta sola", () => {
    const state = newGame("a");
    field(state, "a1", "a");
    field(state, "b1", "b");
    field(state, "b2", "b");
    state.declarations = [
      { id: "a1", from: "a1", to: "rf-b", kind: "attack", seat: "a", order: 1 },
      { id: "b1", from: "b1", to: "a1", kind: "block", seat: "b", order: 0 },
      { id: "b2", from: "b2", to: "a1", kind: "block", seat: "b", order: 0 },
    ];
    const next = apply(state, { t: "resolve", seat: "a", battles: [
      { attacker: "a1", blocker: "b1", kind: "block", attackerDies: true, blockerDies: true, damage: 0 },
      { attacker: "a1", blocker: "b2", kind: "block", attackerDies: true, blockerDies: false, damage: 0 },
    ] });
    expect(zoneCards(next, "a", "abisso").map(c => c.uid)).toEqual(["a1"]);
    expect(next.cards.b1.zone).toBe("abisso");
    expect(next.cards.b2.zone).toBe("field");
  });

  it("l'esilio tiene la carta; la restituzione la riporta in gioco, o in Ritiro a Fronte pieno", () => {
    const state = newGame("a");
    field(state, "m", "a");
    field(state, "b1", "b", { y: frontRowY("b") });
    let next = apply(state, { t: "toZone", uid: "b1", zone: "abisso", heldBy: "m" });
    expect(next.cards.b1).toMatchObject({ zone: "abisso", heldBy: "m" });
    next = apply(next, { t: "release", uid: "b1", zone: "field", x: 442, y: frontRowY("b") });
    expect(next.cards.b1).toMatchObject({ zone: "field", x: 442, y: frontRowY("b") });
    expect(next.cards.b1.heldBy).toBeUndefined();
    next = apply(next, { t: "toZone", uid: "b1", zone: "abisso", heldBy: "m" });
    next = apply(next, { t: "release", uid: "b1", zone: "ritiro" });
    expect(next.cards.b1.zone).toBe("ritiro");
    // Uno spostamento qualunque scioglie la presa.
    next = apply(next, { t: "toZone", uid: "b1", zone: "abisso", heldBy: "m" });
    expect(apply(next, { t: "toZone", uid: "b1", zone: "hand" }).cards.b1.heldBy).toBeUndefined();
  });

  it("il flip scarta e recupera; il bersaglio dichiarato e il sigillo restano nello stato", () => {
    let state = newGame("a");
    field(state, "rf", "a");
    field(state, "h", "a", { zone: "hand" });
    field(state, "m", "a", { zone: "hand" });
    state = { ...state, players: { ...state.players, a: { ...state.players.a, hp: 12 } } };
    let next = apply(state, { t: "flip", uid: "rf", face: 1, discard: "h", recover: 5 });
    expect(next.cards.rf.face).toBe(1);
    expect(next.cards.h.zone).toBe("abisso");
    expect(next.players.a.hp).toBe(17);
    next = apply(next, { t: "player", seat: "a", patch: { sealed: ["RBF-012"] } });
    expect(next.players.a.sealed).toEqual(["RBF-012"]);
    next = apply(next, { t: "toZone", uid: "m", zone: "field", target: "x1" });
    expect(next.cards.m.target).toBe("x1");
    expect(apply(next, { t: "toZone", uid: "m", zone: "abisso" }).cards.m.target).toBeUndefined();
  });

  it("le chiavi degli inneschi delle Materie e del flip, come le consuma l'engine", () => {
    expect(attackKey({ t: "look", seat: "a", count: 4, effect: ref })).toBe("m|on_resolve:look|m");
    expect(attackKey({ t: "empower", uid: "u", power: 1, untap: true, effect: ref })).toBe("m|on_resolve:empower:u|m");
    expect(attackKey({ t: "toZone", uid: "x", zone: "abisso", heldBy: "m", effect: ref })).toBe("m|on_resolve:exile|m");
    expect(attackKey({ t: "toZone", uid: "x", zone: "abisso", effect: ref })).toBe("m|on_resolve:destroy|m");
    expect(attackKey({ t: "toZone", uid: "x", zone: "ritiro", effect: ref })).toBe("m|on_resolve:move|m");
    expect(attackKey({ t: "toZone", uid: "x", zone: "field", effect: ref })).toBe("m|on_resolve:deploy|m");
    expect(attackKey({ t: "player", seat: "a", patch: { hp: 24 }, effect: ref })).toBe("m|on_resolve:heal|m");
    const flip = { source: "rf", event: "on_flip" as const, entering: "rf" };
    expect(attackKey({ t: "player", seat: "a", patch: { sealed: ["RBF-012"] }, effect: flip })).toBe("rf|on_flip:seal|rf");
    expect(attackKey({ t: "toZone", uid: "r", zone: "abisso", effect: flip })).toBe("rf|on_flip:destroy|rf");
  });
});

// §7.2 — la catena di risposta. Gemello: table_test.rb, «la catena di risposta».
describe("la catena di risposta (§7.2)", () => {
  const reactive = (uid: string, owner: Seat) => ({ uid, cardId: "R", owner, zone: "hand" as const, face: 0, x: 0, y: 0, order: 0, tapped: false, facedown: false, z: 1 });

  it("una Reattiva apre la catena, la risposta la allunga e passa la parola, l'accettazione la risolve al contrario", () => {
    let state = newGame("a");
    state.cards.r1 = reactive("r1", "a");
    state.cards.r2 = reactive("r2", "b");
    state = apply(state, { t: "toZone", uid: "r1", zone: "field", x: 10, y: 10, z: 2, chain: true });
    expect(state.chain).toEqual({ stack: ["r1"], turn: "b", resolving: false });
    state = apply(state, { t: "toZone", uid: "r2", zone: "field", x: 10, y: 10, z: 3, chain: true });
    expect(state.chain).toEqual({ stack: ["r1", "r2"], turn: "a", resolving: false });
    state = apply(state, { t: "pass", seat: "a" });
    expect(state.chain).toEqual({ stack: ["r1", "r2"], turn: "a", resolving: true });
    expect(chainTop(state)?.uid).toBe("r2");
    // L'ultima giocata si risolve per prima e se ne va; poi la prima; poi niente catena.
    state = apply(state, { t: "settle", uid: "r2" });
    expect(state.chain?.stack).toEqual(["r1"]);
    expect(chainTop(state)?.uid).toBe("r1");
    expect(state.cards.r2.zone).toBe("field");
    state = apply(state, { t: "toZone", uid: "r1", zone: "abisso" });
    expect(state.chain).toBeUndefined();
    expect(chainTop(state)).toBeUndefined();
  });

  it("una Materia giocata senza il segno della catena non la apre; il cambio di turno la chiude; accettare senza catena non fa nulla", () => {
    let state = newGame("a");
    state.cards.r1 = reactive("r1", "a");
    state = apply(state, { t: "toZone", uid: "r1", zone: "field", x: 10, y: 10, z: 2 });
    expect(state.chain).toBeUndefined();
    expect(apply(state, { t: "pass", seat: "b" })).toBe(state);
    state = apply(state, { t: "toZone", uid: "r1", zone: "hand" });
    state = apply(state, { t: "toZone", uid: "r1", zone: "field", x: 10, y: 10, z: 2, chain: true });
    expect(state.chain?.stack).toEqual(["r1"]);
    state = apply(state, { t: "turn", turn: 2, active: "b" });
    expect(state.chain).toBeUndefined();
  });
});

// §8.2 — i bonus «fino alla fine del turno». Gemello: table_test.rb, TableBonusTest.
describe("i bonus fino a fine turno (§8.2)", () => {
  const armed = (uid: string) => ({
    uid, cardId: "U", owner: "a" as Seat, zone: "field" as const, face: 0, x: 0, y: 0, order: 0,
    tapped: false, facedown: false, z: 1, powerBonus: 1, counterBonus: 2, cannotBlock: true as const, grants: ["revenge"],
  });

  it("cadono col cambio di turno, per tutti", () => {
    let state = newGame("a");
    state.cards.u = armed("u");
    state = apply(state, { t: "turn", turn: 2, active: "b" });
    expect(state.cards.u.powerBonus).toBeUndefined();
    expect(state.cards.u.counterBonus).toBeUndefined();
    expect(state.cards.u.cannotBlock).toBeUndefined();
    expect(state.cards.u.grants).toBeUndefined();
  });

  it("ma non se il contatore del turno si ritocca a mano", () => {
    let state = newGame("a");
    state.cards.u = armed("u");
    state = apply(state, { t: "turn", turn: 2, active: "a" });
    expect(state.cards.u.powerBonus).toBe(1);
  });

  it("e chi lascia il campo li lascia lì: il ritorno è sempre quello stampato", () => {
    let state = newGame("a");
    state.cards.u = armed("u");
    state = apply(state, { t: "toZone", uid: "u", zone: "abisso" });
    expect(state.cards.u.powerBonus).toBeUndefined();
    expect(state.cards.u.counterBonus).toBeUndefined();
    expect(state.cards.u.cannotBlock).toBeUndefined();
    expect(state.cards.u.grants).toBeUndefined();
  });
});
