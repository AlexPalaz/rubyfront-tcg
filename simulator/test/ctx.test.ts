// La geometria di vista del rincasso (ctx.ts): ciò che il tavolo cede a
// corpo fisso — etichette, testata, angolo del gesto di fase — e la fila di
// servizio avversaria che si riapre col controllo (§8.2).
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTROL_X,
  backRowY,
  bandViewH,
  frontRowY,
  setCornerReserve,
  setFoeBackRow,
  setLabelRoom,
  setViewMode,
  setViewSlack,
  surfaceViewH,
  toView,
  viewOf,
} from "../src/ctx.js";

afterEach(() => {
  setViewMode("full");
  setFoeBackRow(false);
  setLabelRoom(0, 0);
  setCornerReserve(0);
  setViewSlack(0);
});

describe("rincasso: fila di servizio avversaria", () => {
  it("chiusa, il riquadro del controllo avversario cade sul Fronte; aperta col controllo, sta sopra", () => {
    setViewMode("recess");
    // Chi guarda è A: l'avversario B sta in alto.
    const closed = viewOf(CONTROL_X, backRowY("b"), "a");
    expect(closed.y).toBe(toView(frontRowY("b"), "a"));
    const foeBandClosed = bandViewH(true);
    const mineBand = bandViewH(false);

    setFoeBackRow(true);
    const open = viewOf(CONTROL_X, backRowY("b"), "a");
    expect(open.y).toBeLessThan(toView(frontRowY("b"), "a"));
    expect(bandViewH(true)).toBeGreaterThan(foeBandClosed);
    // La propria fascia non cambia.
    expect(bandViewH(false)).toBe(mineBand);
  });
});

describe("rincasso: riserve a corpo fisso", () => {
  it("etichette, testata e angolo allungano la superficie, e solo in rincasso", () => {
    setViewMode("recess");
    const base = surfaceViewH();
    setLabelRoom(200, 100);
    setCornerReserve(120);
    // Due fasce, ognuna con testa (100) e fondo (200); il varco fra le file
    // del tuo campo (200); l'angolo (120): tutto sopra i margini stretti.
    expect(surfaceViewH()).toBeGreaterThan(base + 120);
    setViewMode("full");
    const full = surfaceViewH();
    setLabelRoom(0, 0);
    setCornerReserve(0);
    expect(surfaceViewH()).toBe(full);
  });
});
