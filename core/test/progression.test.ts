// La progressione dei Rubyfront (2026-09-23): il gemello dei test Ruby
// (engine/test/progression_test.rb) — livelli ai confini, sbloccate,
// configurazioni rifiutate — e i dati veri dal catalogo del repo.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  abilityOf,
  levelFor,
  progressionCards,
  progressionOf,
  progressionRules,
  unlocked,
  useProgression,
  validateLoadout,
  mountedIds,
  slotOf,
  withAbility,
  withoutSlot,
  xpSpan,
  type ProgressionCard,
  type ProgressionRules,
} from "../src/progression.js";

const rules: ProgressionRules = { thresholds: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90], points: { win: 5, loss: 2, draw: 3 }, slots: { rubyfront: 1, nexus: 2 } };
const card: ProgressionCard = {
  card: "X-1",
  levels: Array.from({ length: 10 }, (_, i) => ({
    level: i + 1,
    rubyfront: { id: `r${i + 1}`, locales: { it: { name: `R${i + 1}`, text: "…" } } },
    nexus: { id: `n${i + 1}`, locales: { it: { name: `N${i + 1}`, text: "…" } } },
  })),
};

describe("il livello segue le soglie", () => {
  it("resta fra 1 e 10", () => {
    expect(levelFor(0, rules)).toBe(1);
    expect(levelFor(9, rules)).toBe(1);
    expect(levelFor(10, rules)).toBe(2);
    expect(levelFor(90, rules)).toBe(10);
    expect(levelFor(100_000, rules)).toBe(10);
    expect(levelFor(-5, rules)).toBe(1);
  });
  it("dà la barra da/a, senza arrivo al decimo", () => {
    expect(xpSpan(2, rules)).toEqual({ from: 10, to: 20 });
    expect(xpSpan(10, rules)).toEqual({ from: 90, to: null });
  });
});

describe("le abilità sbloccate e la configurazione", () => {
  it("crescono col livello", () => {
    expect(unlocked(card, 1)).toEqual({ rubyfront: ["r1"], nexus: ["n1"] });
    expect(unlocked(card, 3).rubyfront).toEqual(["r1", "r2", "r3"]);
    expect(unlocked(null, 3)).toEqual({ rubyfront: [], nexus: [] });
    expect(abilityOf(card, "n4")).toMatchObject({ face: "nexus", level: 4 });
    expect(abilityOf(card, "zz")).toBeNull();
  });
  it("accetta le sbloccate entro gli slot e rifiuta il resto con la chiave del motivo", () => {
    expect(validateLoadout(card, 3, { rubyfront: ["r2"], nexus: ["n1", "n3"] }, rules)).toBeNull();
    expect(validateLoadout(card, 1, { rubyfront: [], nexus: [] }, rules)).toBeNull();
    expect(validateLoadout(card, 2, { rubyfront: ["r3"], nexus: [] }, rules)).toEqual({ key: "progression.refuse.locked", params: { face: "rubyfront", id: "r3" } });
    expect(validateLoadout(card, 5, { rubyfront: [], nexus: ["n1", "n1"] }, rules)?.key).toBe("progression.refuse.repeated");
    expect(validateLoadout(card, 5, { rubyfront: ["r1", "r2"], nexus: [] }, rules)?.key).toBe("progression.refuse.slots");
    expect(validateLoadout(null, 5, { rubyfront: [], nexus: [] }, rules)?.key).toBe("progression.refuse.unknown");
  });
  it("monta per posizione (il blocco stampato che sostituisce) e smonta liberando il blocco", () => {
    const once = withAbility({ rubyfront: [], nexus: ["n1"] }, "nexus", "n2", 1);
    expect(once.nexus).toEqual(["n1", "n2"]);
    expect(withAbility(once, "nexus", "n2", 0).nexus).toEqual(["n2"]);
    expect(withAbility({ rubyfront: [], nexus: [] }, "nexus", "n3", 2).nexus).toEqual([null, null, "n3"]);
    expect(withoutSlot(once, "nexus", 0).nexus).toEqual([null, "n2"]);
    expect(withoutSlot(once, "nexus", 1).nexus).toEqual(["n1"]);
    expect(mountedIds({ rubyfront: [null, "r2"], nexus: [] }, "rubyfront")).toEqual(["r2"]);
    expect(slotOf({ rubyfront: [null, "r2"], nexus: [] }, "rubyfront", "r2")).toBe(1);
    expect(validateLoadout(card, 5, { rubyfront: [], nexus: [null, "n2"] }, rules)).toBeNull();
    expect(validateLoadout(card, 5, { rubyfront: [null, "r2"], nexus: [] }, rules)?.key).toBe("progression.refuse.slots");
  });
});

describe("i dati veri", () => {
  it("il catalogo del repo ha quattro Rubyfront con dieci livelli e id unici", () => {
    const bundle = JSON.parse(readFileSync(resolve(__dirname, "../../docs/cards/catalog.json"), "utf8"));
    useProgression(bundle.progression);
    expect(progressionCards()).toHaveLength(4);
    expect(progressionRules()?.thresholds).toHaveLength(10);
    for (const entry of progressionCards()) {
      expect(entry.levels.map(level => level.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const ids = entry.levels.flatMap(level => [level.rubyfront.id, level.nexus.id]);
      expect(new Set(ids).size).toBe(ids.length);
      expect(progressionOf(entry.card)).toBe(entry);
    }
    useProgression(null);
  });
});
