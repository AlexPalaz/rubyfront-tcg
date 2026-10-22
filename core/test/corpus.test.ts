// Il corpus differenziale TS ↔ Ruby (2026-10-21, audit RF-029, T31): le
// stesse sequenze di azioni, rigiocate dal riduttore (qui) e dalla copia
// Ruby (engine/test/corpus_test.rb), devono dare la stessa lavagna
// normalizzata a ogni passo (support/normalize.ts ↔ Table#dump).
//
// I file stanno in engine/test/corpus/<nome>.json: { version, steps: [{ action, state }] }.
// Li scrive questo test con CORPUS_WRITE=1 (il riduttore è il generatore);
// senza, li confronta. Le carte sono quelle vere del catalogo.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cardStats, getDeck, isRubyfront, useCatalog, type CatalogCard, type CatalogDeck } from "../src/cards.js";
import { FRONT_SLOT_X, SLOT_X, backRowY, frontRowY } from "../src/geometry.js";
import { apply, newGame, zoneCards } from "../src/state.js";
import type { Action, CardInstance, GameState, Seat } from "../src/types.js";
import { normalize } from "./support/normalize.js";

const ROOT = join(import.meta.dirname, "../..");
const CORPUS_DIR = join(ROOT, "engine/test/corpus");
const catalog = JSON.parse(readFileSync(join(ROOT, "docs/cards/catalog.json"), "utf8")) as { cards: CatalogCard[]; decks: CatalogDeck[] };
const WRITE = process.env.CORPUS_WRITE === "1";

beforeAll(() => useCatalog(catalog));

/** Un mazzo intero, canonico: il Rubyfront in Zona di Richiamo, il resto nel mazzo in ordine d'elenco. */
function wholeDeck(seat: Seat, deckId: string): Action {
  const deck = getDeck(deckId);
  if (!deck) throw new Error(`mazzo ignoto: ${deckId}`);
  const cards: CardInstance[] = [];
  let serial = 0;
  for (const entry of deck.cards) {
    for (let copy = 0; copy < entry.count; copy += 1) {
      const rubyfront = isRubyfront(entry.card);
      cards.push({
        uid: `${seat}-${serial + 1}`, cardId: entry.card, owner: seat, zone: rubyfront ? "field" : "deck", face: 0,
        x: rubyfront ? SLOT_X.richiamo : 0, y: rubyfront ? backRowY(seat) : 0, order: rubyfront ? 0 : serial, tapped: false, facedown: false, z: rubyfront ? 1 : 0,
      });
      serial += 1;
    }
  }
  const rubyfront = cards.find(card => isRubyfront(card.cardId));
  const hp = rubyfront ? cardStats(rubyfront.cardId).health : null;
  return { t: "loadDeck", seat, deckId, cards, ...(hp === null ? {} : { hp }) };
}

/** Una sequenza: ogni passo decide l'azione guardando la lavagna di adesso. */
type Scenario = ((state: GameState) => Action)[];

function opening(): Scenario {
  return [
    () => ({ t: "newGame", active: "a" }),
    () => wholeDeck("a", "starter-umani"),
    () => wholeDeck("b", "starter-auros"),
    state => ({ t: "shuffle", seat: "a", order: zoneCards(state, "a", "deck").map(card => card.uid).reverse() }),
    () => ({ t: "draw", seat: "a", count: 6 }),
    () => ({ t: "draw", seat: "b", count: 6 }),
    state => ({ t: "mulligan", seat: "a", order: [...zoneCards(state, "a", "hand"), ...zoneCards(state, "a", "deck")].map(card => card.uid).reverse() }),
    () => ({ t: "keep", seat: "a" }),
    () => ({ t: "keep", seat: "b" }),
    () => ({ t: "draw", seat: "a", count: 1 }),
  ];
}

function firstEntity(state: GameState, seat: Seat): CardInstance {
  const card = zoneCards(state, seat, "hand").find(entry => cardStats(entry.cardId).kind === "entity" && (cardStats(entry.cardId).fluxCost ?? 99) <= 3);
  if (!card) throw new Error("nessuna Entità economica in mano");
  return card;
}

function rubyfrontOf(state: GameState, seat: Seat): CardInstance {
  const card = Object.values(state.cards).find(entry => entry.owner === seat && isRubyfront(entry.cardId));
  if (!card) throw new Error("Rubyfront assente");
  return card;
}

function turnAndFlux(): Scenario {
  return [
    ...opening(),
    () => ({ t: "turn", turn: 2, active: "b", toll: 0 }),
    () => ({ t: "turn", turn: 3, active: "a", toll: 0 }),
    () => ({ t: "player", seat: "a", patch: { flux: 5, fluxMax: 5 }, test: true }),
    state => {
      const card = firstEntity(state, "a");
      return { t: "toZone", uid: card.uid, zone: "field", x: FRONT_SLOT_X[0], y: frontRowY("a"), z: 2, cost: cardStats(card.cardId).fluxCost ?? 0 };
    },
    () => ({ t: "turn", turn: 4, active: "b", toll: 0 }),
    () => ({ t: "turn", turn: 5, active: "a", toll: 0 }),
    () => ({ t: "phase", phase: "fronte" }),
    state => {
      const attacker = Object.values(state.cards).find(card => card.owner === "a" && card.zone === "field" && !isRubyfront(card.cardId))!;
      return { t: "declare", declaration: { id: attacker.uid, from: attacker.uid, to: rubyfrontOf(state, "b").uid, kind: "attack", seat: "a", order: 1 } };
    },
    () => ({ t: "phase", phase: "reazione" }),
    state => {
      const attacker = state.declarations[0]!.from;
      const power = cardStats(state.cards[attacker]!.cardId).power ?? 0;
      return { t: "resolve", seat: "a", battles: [{ attacker, kind: "unblocked", attackerDies: false, blockerDies: false, damage: power }] };
    },
    () => ({ t: "turn", turn: 6, active: "b", toll: 0 }),
  ];
}

function gameOver(): Scenario {
  return [
    ...opening(),
    () => ({ t: "player", seat: "b", patch: { hp: 0 }, test: true }),
    () => ({ t: "gameOver", winner: "a", reason: "hp" }),
    () => ({ t: "newGame", active: "b" }),
    () => wholeDeck("a", "starter-umani"),
    () => ({ t: "gameOver", winner: "b", reason: "concede" }),
  ];
}

function fortuneRoll(): Scenario {
  return [
    ...opening(),
    () => ({ t: "roll", seat: "a", die: 6, for: "cost|a-3", value: 4 }),
    () => ({ t: "roll", seat: "a", die: 20, for: "fury|a-1", value: 17 }),
    () => ({ t: "roll", seat: "b", die: 6, for: "deploy|b-1", value: 2 }),
    () => ({ t: "turn", turn: 2, active: "b", toll: 0 }),
    () => ({ t: "roll", seat: "b", die: 20, for: "effect|b-1|on_attack|b-1|", value: 9 }),
  ];
}

function hiddenViews(): Scenario {
  const hidden = (seat: Seat, count: number) => Array.from({ length: count }, (_, i) => ({ uid: `${seat}-${i + 1}`, owner: seat, zone: "deck" as const, face: 0, x: 0, y: 0, tapped: false, facedown: false, z: 0 }));
  return [
    () => ({ t: "newGame", active: "a" }),
    () => wholeDeck("a", "starter-umani"),
    () => ({ t: "loadDeck", seat: "b", deckId: "starter-auros", cards: hidden("b", 8) }),
    () => ({ t: "draw", seat: "b", count: 6, drawn: ["b-1", "b-2", "b-3", "b-4", "b-5", "b-6"] }),
    () => ({ t: "mulligan", seat: "b", drawn: ["b-7", "b-8", "b-1", "b-2", "b-3", "b-4"] }),
    () => ({ t: "shuffle", seat: "b" }),
    () => ({ t: "keep", seat: "b" }),
    () => ({ t: "toZone", uid: "b-7", zone: "ritiro", identities: { "b-7": "RBF-066" } }),
    () => ({ t: "turn", turn: 2, active: "b", toll: 0, drawn: ["b-5"] }),
  ];
}

const SCENARIOS: Record<string, () => Scenario> = {
  opening,
  "turn-and-flux": turnAndFlux,
  "game-over": gameOver,
  "fortune-roll": fortuneRoll,
  "hidden-views": hiddenViews,
};

function run(scenario: Scenario): { action: Action; state: ReturnType<typeof normalize> }[] {
  let state = newGame();
  return scenario.map(step => {
    const action = step(state);
    state = apply(state, action);
    return { action, state: normalize(state) };
  });
}

describe("il corpus differenziale (engine/test/corpus)", () => {
  for (const [name, build] of Object.entries(SCENARIOS)) {
    it(`${name}: il riduttore e la copia Ruby raccontano la stessa lavagna`, () => {
      const steps = run(build());
      const file = join(CORPUS_DIR, `${name}.json`);
      if (WRITE || !existsSync(file)) {
        mkdirSync(CORPUS_DIR, { recursive: true });
        writeFileSync(file, JSON.stringify({ version: 1, steps }, null, 1) + "\n");
      }
      const golden = JSON.parse(readFileSync(file, "utf8")) as { version: number; steps: typeof steps };
      expect(golden.version).toBe(1);
      expect(golden.steps.map(step => step.action)).toEqual(steps.map(step => step.action));
      steps.forEach((step, index) => expect(step.state, `passo ${index + 1} (${step.action.t})`).toEqual(golden.steps[index]!.state));
    });
  }
});
