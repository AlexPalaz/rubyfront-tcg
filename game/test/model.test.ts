// Il modello della faccia (src/card/model.ts) sul catalogo vero: che
// cosa si stampa, con la logica di card-render.js. Il confronto pixel per
// pixel guarda come; questi test guardano cosa.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useCatalog, type CatalogCard, type CatalogDeck } from "@rubyfront/core/cards";
import { beforeAll, describe, expect, it } from "vitest";
import { faceModel, setCardsBase } from "../src/card/model.js";

const catalog = JSON.parse(readFileSync(join(import.meta.dirname, "../../docs/cards/catalog.json"), "utf8")) as { cards: CatalogCard[]; decks: CatalogDeck[] };

beforeAll(() => {
  useCatalog(catalog);
  setCardsBase("http://localhost/cards/");
});

describe("il modello della faccia", () => {
  it("Rubyfront: a tutta illustrazione, dado di schieramento, PV, la qualifica nella riga del tipo", () => {
    const face = faceModel("RBF-001", "rubyfront", "it")!;
    expect(face.fullArt).toBe(true);
    expect(face.cost).toEqual({ kind: "die", value: "6" });
    expect(face.right).toEqual({ kind: "hp", value: "21", label: "PV" });
    expect(face.textline?.type).toBe("Rubifronte");
    expect(face.textline?.idents.map(ident => (ident.kind === "matter" ? `${ident.type}${ident.grade}` : "counter"))).toEqual(["dynamic2", "destructive1"]);
    expect(face.keywords).toEqual([{ name: "Furia:", rules: "d20 ≥ 13 prima di ogni azione · fallimento −1 PV" }]);
    // L'ordine del sito: il requisito, gli inneschi, le abilità.
    expect(face.blocks.map(block => block.kind)).toEqual(["requirement", "fx", "ability", "ability"]);
    const [, , gain, cost] = face.blocks;
    expect(gain).toMatchObject({ kind: "ability", cost: { kind: "gain", value: "+2 PV" } });
    expect(cost).toMatchObject({ kind: "ability", cost: { kind: "hp", value: "−5 PV" } });
    expect(face.art?.src).toBe("http://localhost/cards/art/rbf-001.jpg");
    expect(face.art?.zoom).toBe("48%");
  });

  it("Nexus: gli anelli al posto del costo, il divisore, l'illustrazione della faccia", () => {
    const face = faceModel("RBF-001", "nexus", "it")!;
    expect(face.cost).toEqual({ kind: "nexus" });
    expect(face.divider).toBe(true);
    expect(face.art?.src).toBe("http://localhost/cards/art/rbf-001-nexus.jpg");
  });

  it("Entità senza Materia: tinta Dinamica, Potenza, testo statico", () => {
    const face = faceModel("RBF-002", "entity", "it")!;
    expect(face.tint).toBe("dynamic");
    expect(face.fullArt).toBe(false);
    expect(face.right).toEqual({ kind: "power", value: 1 });
    expect(face.textline?.type).toBe("Entità: Umano");
    expect(face.blocks).toEqual([expect.objectContaining({ kind: "effect", behavior: null })]);
  });

  it("Materia: il medaglione nella barra del titolo e la tinta della sua Materia", () => {
    const face = faceModel("RBF-015", "matter", "it")!;
    expect(face.right).toMatchObject({ kind: "matter", matter: { type: face.tint } });
  });

  it("le Reattive e le Permanenti dichiarano il comportamento, nella lingua della carta", () => {
    for (const card of catalog.cards) {
      for (const f of card.faces as { id: string; kind: string; behavior?: string }[]) {
        if (f.kind !== "matter" || !f.behavior || f.behavior === "normal") continue;
        const it = faceModel(card.id, f.id, "it")!;
        const en = faceModel(card.id, f.id, "en")!;
        const labels = { reactive: ["Reattiva", "Reactive"], permanent: ["Permanente", "Permanent"] }[f.behavior as "reactive" | "permanent"];
        expect(it.blocks[0]).toMatchObject({ kind: "effect", behavior: { id: f.behavior, label: labels[0] } });
        expect(en.blocks[0]).toMatchObject({ kind: "effect", behavior: { id: f.behavior, label: labels[1] } });
      }
    }
  });

  it("ogni faccia del catalogo ha un modello, in italiano e in inglese", () => {
    for (const card of catalog.cards) {
      for (const f of card.faces) {
        for (const locale of ["it", "en"]) {
          const face = faceModel(card.id, f.id, locale);
          expect(face, `${card.id}/${f.id}/${locale}`).not.toBeNull();
          expect(face!.title.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("una carta che non c'è non ha modello", () => {
    expect(faceModel("RBF-999", "entity", "it")).toBeNull();
  });
});
