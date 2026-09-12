// L'impaginazione del tavolo (src/table/layout.ts): la scala e le
// file del «rincasso» del simulatore a 1920×1080, e la prospettiva — la tua
// metà in basso, l'avversaria capovolta e ridotta al Fronte.
import { CONTROL_X, FRONT_SLOT_X, ROW_GAP, RUBYFRONT_X, SLOT_X, SURFACE_W, TILE_H, backRowY, frontRowY } from "@rubyfront/core/geometry";
import { STACK_STEP } from "@rubyfront/core/state";
import { describe, expect, it } from "vitest";
import { FIXED, layout } from "../src/table/layout.js";

const HD = { x: 0, y: 0, width: 1920, height: 1080, scale: 1 };
const L = layout(HD);

describe("l'impaginazione del tavolo", () => {
  it("a 1920×1080 la scala è quella del simulatore, e la superficie sta al centro", () => {
    expect(L.s).toBeCloseTo((1080 - FIXED.bar - FIXED.bottom - (FIXED.top + 2 * FIXED.head + 3 * FIXED.label + FIXED.gap)) / (3 * TILE_H), 6);
    expect(L.s).toBeCloseTo(0.524, 3);
    expect(L.left + (SURFACE_W * L.s) / 2).toBeCloseTo(960, 6);
  });

  it("le file stanno dove le mette il simulatore: il Fronte avversario, il tuo Fronte, la tua fila di servizio", () => {
    expect(L.foe.top).toBe(95);
    expect(L.foe.front).toBe(132);
    expect(L.mine.front).toBeCloseTo(464.3, 1);
    expect(L.mine.back).toBe(L.mine.front + L.tileH + FIXED.label);
    expect(L.mine.back).toBeCloseTo(728.7, 1);
    expect(L.mine.bottom).toBeCloseTo(993, 0);
  });

  it("le tue carte stanno nella tua metà, in basso; quelle dell'avversario nella sua, in alto", () => {
    expect(L.screenPos(FRONT_SLOT_X[0], frontRowY("a"), "a").y).toBeCloseTo(L.mine.front, 6);
    expect(L.screenPos(SLOT_X.deck, backRowY("a"), "a").y).toBeCloseTo(L.mine.back!, 6);
    expect(L.screenPos(FRONT_SLOT_X[0], frontRowY("b"), "a").y).toBeCloseTo(L.foe.front, 6);
    // Dal posto B, lo stesso tavolo a parti scambiate.
    expect(L.screenPos(FRONT_SLOT_X[0], frontRowY("b"), "b").y).toBeCloseTo(L.mine.front, 6);
    expect(L.screenPos(FRONT_SLOT_X[0], frontRowY("a"), "b").y).toBeCloseTo(L.foe.front, 6);
  });

  it("le x non si capovolgono: il Rubyfront avversario sta a sinistra come il tuo", () => {
    expect(L.screenPos(RUBYFRONT_X, frontRowY("b"), "a").x).toBeCloseTo(L.screenPos(RUBYFRONT_X, frontRowY("a"), "a").x, 6);
  });

  it("il Rubyfront in Zona di Richiamo si disegna nel riquadro del Rubyfront, sul Fronte", () => {
    expect(L.screenPos(SLOT_X.richiamo, backRowY("a"), "a").y).toBeCloseTo(L.mine.front, 6);
    expect(L.screenPos(SLOT_X.richiamo, backRowY("b"), "a").y).toBeCloseTo(L.foe.front, 6);
  });

  it("una pila scende nella tua metà; nell'avversaria si schiaccia sull'orlo del Fronte", () => {
    const mine = L.screenPos(FRONT_SLOT_X[0] + STACK_STEP, frontRowY("a") + STACK_STEP, "a");
    expect(mine.y).toBeCloseTo(L.mine.front + STACK_STEP * L.s, 6);
    const foe = L.screenPos(FRONT_SLOT_X[0] + STACK_STEP, frontRowY("b") + STACK_STEP, "a");
    expect(foe.y).toBeCloseTo(L.foe.front, 6);
  });

  it("lo slot del Controllo sta nella tua fila di servizio", () => {
    expect(L.screenPos(CONTROL_X, backRowY("a"), "a").y).toBeCloseTo(L.mine.back!, 6);
  });

  it("su uno schermo 16:10 le carte crescono, e il tavolo sta ancora dentro", () => {
    const tall = layout({ x: 0, y: -60, width: 1920, height: 1200, scale: 1 });
    expect(tall.s).toBeGreaterThan(L.s);
    expect(tall.mine.bottom).toBeLessThanOrEqual(-60 + 1200 - FIXED.bottom + 1e-6);
    expect(SURFACE_W * tall.s).toBeLessThanOrEqual(1920 - 2 * FIXED.side + 1e-6);
  });
});

describe("canonico: dallo schermo alla lavagna, nella tua metà", () => {
  it("è il contrario di posto sulla fila del Fronte, sulla fila di servizio e nel varco fra le due, dai due posti", () => {
    for (const viewer of ["a", "b"] as const) {
      const points = [
        { x: FRONT_SLOT_X[2], y: frontRowY(viewer) },
        { x: FRONT_SLOT_X[0] + STACK_STEP, y: frontRowY(viewer) + STACK_STEP },
        { x: SLOT_X.deck, y: backRowY(viewer) },
        { x: FRONT_SLOT_X[4], y: frontRowY(viewer) + TILE_H + ROW_GAP / 2 },
      ];
      for (const point of points) {
        const screen = L.screenPos(point.x, point.y, viewer);
        const back = L.canonical(screen.x, screen.y, viewer);
        expect(back.x).toBeCloseTo(point.x, 6);
        expect(back.y).toBeCloseTo(point.y, 6);
      }
    }
  });
});
