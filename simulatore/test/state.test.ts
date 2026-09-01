// Il riduttore della lavagna: la semantica che anche la copia Ruby
// dell'engine (engine/lib/rubyfront/table.rb) deve rispecchiare. Se un test
// qui cambia, quasi certamente va cambiato anche il gemello là.

import { describe, expect, it } from "vitest";
import { apply, newGame, zoneCards } from "../src/state.js";
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
});
