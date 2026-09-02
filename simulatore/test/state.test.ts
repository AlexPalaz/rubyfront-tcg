// Il riduttore della lavagna: la semantica che anche la copia Ruby
// dell'engine (engine/lib/rubyfront/table.rb) deve rispecchiare. Se un test
// qui cambia, quasi certamente va cambiato anche il gemello là.

import { describe, expect, it } from "vitest";
import { MATTER_X, frontRowY } from "../src/ctx.js";
import { STACK_STEP, apply, matterSpot, newGame, playSpot, zoneCards } from "../src/state.js";
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
