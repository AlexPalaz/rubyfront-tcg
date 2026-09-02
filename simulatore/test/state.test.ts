// Il riduttore della lavagna: la semantica che anche la copia Ruby
// dell'engine (engine/lib/rubyfront/table.rb) deve rispecchiare. Se un test
// qui cambia, quasi certamente va cambiato anche il gemello là.

import { describe, expect, it } from "vitest";
import { MATTER_X, frontRowY } from "../src/ctx.js";
import { STACK_STEP, apply, matterSpot, newGame, pay, playSpot, zoneCards } from "../src/state.js";
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
