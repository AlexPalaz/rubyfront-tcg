// La partita di prova del tavolo (src/table/sample-game.ts): passa tutta dal
// riduttore vero e arriva dove promette — è il banco su cui si guarda il
// tavolo, e su cui gioco e simulatore si confrontano.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRubyfront, useCatalog, type CatalogCard, type CatalogDeck } from "@rubyfront/core/cards";
import { FRONT_SLOT_X, MATTER_X, RUBYFRONT_X, frontRowY } from "@rubyfront/core/geometry";
import { replay, zoneCards } from "@rubyfront/core/state";
import { beforeAll, describe, expect, it } from "vitest";
import { sampleGame } from "../src/table/sample-game.js";

const catalog = JSON.parse(readFileSync(join(import.meta.dirname, "../../docs/cards/catalog.json"), "utf8")) as { cards: CatalogCard[]; decks: CatalogDeck[] };

beforeAll(() => useCatalog(catalog));

describe("la partita di prova", () => {
  it("arriva al turno 5, Fase di Fronte, tocca ad A, con un attacco dichiarato", () => {
    const state = replay(sampleGame().map(action => ({ action })));
    expect(state.turn).toBe(5);
    expect(state.active).toBe("a");
    expect(state.phase).toBe("fronte");
    expect(state.declarations).toHaveLength(1);
  });

  it("mette i Rubyfront sul Fronte, le Entità negli slot, la Materia nella sua fila", () => {
    const state = replay(sampleGame().map(action => ({ action })));
    for (const seat of ["a", "b"] as const) {
      const rubyfront = Object.values(state.cards).find(card => card.owner === seat && isRubyfront(card.cardId))!;
      expect(rubyfront).toMatchObject({ zone: "field", x: RUBYFRONT_X, y: frontRowY(seat) });
    }
    const front = (seat: "a" | "b") => Object.values(state.cards).filter(card => card.owner === seat && card.zone === "field" && FRONT_SLOT_X.includes(card.x) && card.y === frontRowY(seat));
    expect(front("a")).toHaveLength(3);
    expect(front("b")).toHaveLength(2);
    expect(Object.values(state.cards).some(card => card.owner === "a" && card.zone === "field" && card.x === MATTER_X)).toBe(true);
    expect(Object.values(state.cards).some(card => card.assignedTo)).toBe(true);
    expect(Object.values(state.cards).some(card => card.tapped)).toBe(true);
    expect(Object.values(state.cards).some(card => card.facedown)).toBe(true);
  });

  it("lascia le mani a 5 e 4, e qualche carta nelle pile", () => {
    const state = replay(sampleGame().map(action => ({ action })));
    expect(zoneCards(state, "a", "hand")).toHaveLength(5);
    expect(zoneCards(state, "b", "hand")).toHaveLength(4);
    for (const seat of ["a", "b"] as const) {
      expect(zoneCards(state, seat, "abisso").length).toBeGreaterThanOrEqual(2);
      expect(zoneCards(state, seat, "ritiro").length).toBeGreaterThanOrEqual(3);
    }
  });
});
