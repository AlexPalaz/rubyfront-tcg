// La progressione dei Rubyfront (2026-09-23, a percorso dal 2026-09-26): il
// gemello dei test Ruby (engine/test/progression_test.rb) — livelli ai
// confini, il percorso (collegato, al più un nodo per livello, smontabile),
// l'Ascesa, le configurazioni rifiutate — e i dati veri dal catalogo del repo.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  abilityOf,
  ascentOf,
  levelFor,
  loadoutWithin,
  mountedIds,
  neighbors,
  normalPath,
  pathPoints,
  progressionCards,
  progressionOf,
  progressionRules,
  reachable,
  removable,
  slotOf,
  trimmedPath,
  unlocked,
  useProgression,
  validateLoadout,
  validatePath,
  withAbility,
  withoutSlot,
  xpSpan,
  type ProgressionCard,
  type ProgressionRules,
} from "../src/progression.js";

const rules: ProgressionRules = { thresholds: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90], points: { win: 5, loss: 2, draw: 3 }, slots: { rubyfront: 1, nexus: 2 } };
// carta ─ x1 (abilità A) ─ x2 (+2 PV) ─ x4 (Furia 1) ─ x5 (abilità A)
//   └──── x3 (abilità B) ──────────────┘
const card: ProgressionCard = {
  card: "X-1",
  nodes: [
    { id: "x1", kind: "ability", face: "rubyfront", at: [-1, -1], links: ["card"], locales: { it: { name: "X1", text: "…" } } },
    { id: "x2", kind: "hp", amount: 2, at: [-2, -1], links: ["x1"] },
    { id: "x3", kind: "ability", face: "nexus", at: [1, -1], links: ["card"], locales: { it: { name: "X3", text: "…" } } },
    { id: "x4", kind: "fury", amount: 1, at: [0, -2], links: ["x2", "x3"] },
    { id: "x5", kind: "ability", face: "rubyfront", at: [0, -3], links: ["x4"], locales: { it: { name: "X5", text: "…" } } },
  ],
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
  it("dà la barra da/a, senza arrivo al decimo, e un punto per livello", () => {
    expect(xpSpan(2, rules)).toEqual({ from: 10, to: 20 });
    expect(xpSpan(10, rules)).toEqual({ from: 90, to: null });
    expect(pathPoints(1)).toBe(1);
    expect(pathPoints(10)).toBe(10);
  });
});

describe("il percorso", () => {
  it("ha i collegamenti dalle due parti", () => {
    expect(neighbors(card, "card").sort()).toEqual(["x1", "x3"]);
    expect(neighbors(card, "x4").sort()).toEqual(["x2", "x3", "x5"]);
  });
  it("cresce dalla carta, un nodo per livello", () => {
    expect(validatePath(card, 1, [])).toBeNull();
    expect(validatePath(card, 1, ["x3"])).toBeNull();
    expect(validatePath(card, 4, ["x1", "x2", "x4", "x5"])).toBeNull();
    expect(validatePath(card, 4, ["x3", "x4", "x5"])).toBeNull();
  });
  it("rifiuta lo staccato, il troppo, il ripetuto e l'ignoto con la chiave del motivo", () => {
    expect(validatePath(card, 3, ["x2"])).toEqual({ key: "progression.refuse.path.loose", params: { id: "x2" } });
    expect(validatePath(card, 1, ["x1", "x2"])).toEqual({ key: "progression.refuse.path.points", params: { level: 1, n: 1 } });
    expect(validatePath(card, 5, ["x1", "x1"])?.key).toBe("progression.refuse.path.repeated");
    expect(validatePath(card, 5, ["x1", "zz"])?.key).toBe("progression.refuse.path.unknown");
    expect(validatePath(null, 5, [])?.key).toBe("progression.refuse.unknown");
  });
  it("si smonta un nodo alla volta finché il resto resta collegato", () => {
    expect(removable(card, ["x1", "x2", "x3", "x4"], "x2")).toBe(true);
    expect(removable(card, ["x1", "x2", "x3", "x4"], "x3")).toBe(true);
    expect(removable(card, ["x1", "x3", "x4", "x5"], "x3")).toBe(false);
    expect(removable(card, ["x3", "x4", "x5"], "x3")).toBe(false);
    expect(removable(card, ["x1"], "x3")).toBe(false);
  });
  it("dice dove si può andare", () => {
    expect(reachable(card, [])).toEqual(["x1", "x3"]);
    expect(reachable(card, ["x3"])).toEqual(["x1", "x4"]);
  });
  it("si ordina dalla carta e si accorcia dalla coda", () => {
    expect(normalPath(card, ["x5", "x4", "x3"])).toEqual(["x3", "x4", "x5"]);
    expect(normalPath(card, ["x1", "x2", "x4", "x3"])).toEqual(["x1", "x3", "x2", "x4"]);
    expect(normalPath(card, ["x1", "x5", "zz", "x1"])).toEqual(["x1"]);
    expect(trimmedPath(card, ["x1", "x2", "x4", "x5"], 3)).toEqual(["x1", "x2", "x4"]);
  });
  it("dà l'Ascesa e sblocca le sue abilità", () => {
    expect(ascentOf(card, ["x1", "x2", "x4"])).toEqual({ hp: 2, fury: 1 });
    expect(ascentOf(card, [])).toEqual({ hp: 0, fury: 0 });
    expect(unlocked(card, ["x1", "x2", "x4", "x5"])).toEqual({ rubyfront: ["x1", "x5"], nexus: [] });
    expect(unlocked(null, ["x1"])).toEqual({ rubyfront: [], nexus: [] });
    expect(abilityOf(card, "x3")).toMatchObject({ face: "nexus" });
    expect(abilityOf(card, "x2")).toBeNull();
  });
});

describe("la configurazione", () => {
  it("monta le abilità del percorso della faccia giusta entro gli slot", () => {
    const path = ["x1", "x3"];
    expect(validateLoadout(card, path, { rubyfront: ["x1"], nexus: ["x3"] }, rules)).toBeNull();
    expect(validateLoadout(card, path, { rubyfront: [], nexus: [null, "x3"] }, rules)).toBeNull();
    expect(validateLoadout(card, path, { rubyfront: ["x5"], nexus: [] }, rules)).toEqual({ key: "progression.refuse.locked", params: { face: "rubyfront", id: "x5" } });
    expect(validateLoadout(card, path, { rubyfront: ["x3"], nexus: [] }, rules)?.key).toBe("progression.refuse.locked");
    expect(validateLoadout(card, path, { rubyfront: [], nexus: ["x3", "x3"] }, rules)?.key).toBe("progression.refuse.repeated");
    expect(validateLoadout(card, path, { rubyfront: [], nexus: [null, null, "x3"] }, rules)?.key).toBe("progression.refuse.slots");
    expect(validateLoadout(null, path, { rubyfront: [], nexus: [] }, rules)?.key).toBe("progression.refuse.unknown");
  });
  it("si restringe al percorso: il nodo smontato libera il suo blocco", () => {
    expect(loadoutWithin(card, ["x1"], { rubyfront: ["x1"], nexus: [null, "x3"] })).toEqual({ rubyfront: ["x1"], nexus: [] });
    expect(loadoutWithin(card, ["x3"], { rubyfront: ["x1"], nexus: ["x3", null] })).toEqual({ rubyfront: [], nexus: ["x3"] });
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
  });
});

describe("i dati veri", () => {
  // 2026-09-24: le soglie cambiate in data/ senza rifare il catalogo — il
  // tavolo diceva livello 2, il client «650 / 200». Il bundle deve essere
  // la copia dei dati: chi tocca data/progression rifà build-catalog.
  it("il catalogo del repo porta le stesse regole di data/progression (rifare build-catalog dopo ogni ritocco)", () => {
    const bundle = JSON.parse(readFileSync(resolve(__dirname, "../../docs/cards/catalog.json"), "utf8"));
    const data = JSON.parse(readFileSync(resolve(__dirname, "../../data/progression/rules.json"), "utf8"));
    expect(bundle.progression.rules.thresholds).toEqual(data.thresholds);
    expect(bundle.progression.rules.points).toEqual(data.points);
    expect(bundle.progression.rules.slots).toEqual(data.slots);
    for (const entry of bundle.progression.cards) {
      const file = JSON.parse(readFileSync(resolve(__dirname, `../../data/progression/${entry.card.toLowerCase()}.json`), "utf8"));
      expect(entry.nodes).toEqual(file.nodes);
    }
  });

  it("il catalogo del repo ha quattro Rubyfront con venti nodi, tutti raggiungibili, id unici", () => {
    const bundle = JSON.parse(readFileSync(resolve(__dirname, "../../docs/cards/catalog.json"), "utf8"));
    useProgression(bundle.progression);
    expect(progressionCards()).toHaveLength(4);
    expect(progressionRules()?.thresholds).toHaveLength(10);
    for (const entry of progressionCards()) {
      const ids = entry.nodes.map(node => node.id);
      expect(ids).toHaveLength(20);
      expect(new Set(ids).size).toBe(ids.length);
      expect(normalPath(entry, ids).sort()).toEqual([...ids].sort());
      expect(progressionOf(entry.card)).toBe(entry);
    }
    useProgression(null);
  });
});
