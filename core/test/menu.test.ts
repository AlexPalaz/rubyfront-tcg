// Il menu di una carta (tabs.ts, cardMenu; F4): con l'arbitro al tavolo i
// gesti di lavagna si ritirano — restano «Scopri» per la coperta senza data,
// il Ritiro delle proprie carte in campo (§6.2), l'Abisso per le Materie in
// campo, lo scarto dell'eccesso (§6.5); dall'Abisso e dalla Zona di Ritiro
// non si torna (§5), l'Entità presa in controllo non si manda via (§8.2).

import { describe, expect, it } from "vitest";
import type { CardFacts, Ctx } from "../src/ctx.js";
import { newGame } from "../src/state.js";
import { cardMenu, type MenuEntry } from "../src/tabs.js";
import type { CardInstance, GameState, Seat, ZoneId } from "../src/types.js";

const KINDS: Record<string, CardFacts["kind"]> = { HUMAN: "entity", STONE: "matter", BLADE: "object" };

function table(state: GameState, arbitrated = true): Ctx {
  return {
    state: () => state,
    dispatch: () => Promise.resolve(true),
    seat: () => "a",
    controls: seat => seat === "a",
    arbitrated: () => arbitrated,
    themeFor: () => "t49",
    tintFor: () => "dynamic",
    locale: () => "it",
    card: cardId => ({ kind: KINDS[cardId] ?? null, nexus: null }) as CardFacts,
    log: () => undefined,
  };
}

function card(state: GameState, uid: string, cardId: string, owner: Seat, zone: ZoneId, extra: Partial<CardInstance> = {}): CardInstance {
  const instance: CardInstance = { uid, cardId, owner, zone, face: 0, x: 0, y: 0, order: Object.keys(state.cards).length, tapped: false, facedown: false, z: 1, ...extra };
  state.cards[uid] = instance;
  return instance;
}

/** Le voci come «gesto:zona», senza i separatori. */
const entryKeys = (entries: MenuEntry[]): string[] =>
  entries.flatMap(entry => ("rule" in entry ? [] : [entry.action.do === "toZone" ? `toZone:${entry.action.zone}${entry.action.toBottom ? ":fondo" : ""}` : entry.action.do]));

function frontState(): GameState {
  const state = newGame();
  state.phase = "fronte";
  state.active = "a";
  state.turn = 3;
  return state;
}

describe("cardMenu con l'arbitro", () => {
  it("la tua Entità in campo: Ritiro (§6.2), la mano e il mazzo — che l'arbitro giudica —, niente tap né copertura", () => {
    const state = frontState();
    const entries = cardMenu(table(state), card(state, "u", "HUMAN", "a", "field"));
    expect(entryKeys(entries)).toEqual(["toZone:hand", "toZone:ritiro", "toZone:deck", "toZone:deck:fondo"]);
  });

  it("la Materia in campo va anche nell'Abisso; l'Oggetto in campo non si ritira da solo", () => {
    const state = frontState();
    expect(entryKeys(cardMenu(table(state), card(state, "m", "STONE", "a", "field")))).toContain("toZone:abisso");
    expect(entryKeys(cardMenu(table(state), card(state, "o", "BLADE", "a", "field")))).not.toContain("toZone:ritiro");
  });

  it("dall'Abisso e dalla Zona di Ritiro non si torna (§5)", () => {
    const state = frontState();
    expect(entryKeys(cardMenu(table(state), card(state, "r", "HUMAN", "a", "ritiro")))).toEqual([]);
    expect(entryKeys(cardMenu(table(state), card(state, "x", "HUMAN", "a", "abisso")))).toEqual([]);
  });

  it("l'Entità presa in controllo non si manda da nessuna parte (§8.2)", () => {
    const state = frontState();
    expect(entryKeys(cardMenu(table(state), card(state, "c", "HUMAN", "b", "field", { controller: "a" })))).toEqual([]);
  });

  it("con più di 7 carte, in mano c'è «Scarta» al posto del Ritiro (§6.5)", () => {
    const state = frontState();
    const hand = Array.from({ length: 8 }, (_, index) => card(state, `h${index}`, "HUMAN", "a", "hand"));
    const entries = entryKeys(cardMenu(table(state), hand[0]));
    expect(entries).toContain("discard");
    expect(entries).not.toContain("toZone:ritiro");
  });

  it("la coperta senza data si scopre ancora; quella col suo turno no", () => {
    const state = frontState();
    expect(entryKeys(cardMenu(table(state), card(state, "f1", "HUMAN", "a", "field", { facedown: true })))).toContain("facedown");
    expect(entryKeys(cardMenu(table(state), card(state, "f2", "HUMAN", "a", "field", { facedown: true, coveredTurn: 2 })))).not.toContain("facedown");
  });

  it("la voce della zona in cui la carta sta già è spenta", () => {
    const state = frontState();
    const entries = cardMenu(table(state), card(state, "h", "HUMAN", "a", "hand"));
    const hand = entries.find(entry => !("rule" in entry) && entry.action.do === "toZone" && entry.action.zone === "hand");
    expect(hand && !("rule" in hand) && hand.disabled).toBe(true);
  });
});

describe("cardMenu a tavolo libero", () => {
  it("tappare e coprire tornano gesti liberi", () => {
    const state = frontState();
    const entries = entryKeys(cardMenu(table(state, false), card(state, "u", "HUMAN", "a", "field")));
    expect(entries.slice(0, 2)).toEqual(["tap", "facedown"]);
  });
});
