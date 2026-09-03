// Il tavolo parla due lingue: ogni frase ha una chiave, la chat viaggia
// come chiave e parametri e ognuno la legge nella propria lingua, coi nomi
// delle carte dal proprio catalogo e i posti col loro nome.

import { afterEach, describe, expect, it } from "vitest";
import { cardsWord, lang, msg, setLang, t } from "../src/i18n.js";
import { renderLog } from "../src/log.js";
import { newGame, seatLabel } from "../src/state.js";

afterEach(() => setLang("it"));

describe("t", () => {
  it("parte in italiano e passa all'inglese", () => {
    expect(lang()).toBe("it");
    expect(t("hud.endturn")).toBe("Fine turno");
    setLang("en");
    expect(lang()).toBe("en");
    expect(t("hud.endturn")).toBe("End turn");
  });

  it("una lingua ignota ricade sull'italiano", () => {
    setLang("fr");
    expect(lang()).toBe("it");
  });

  it("mette i parametri al posto delle graffe, anche ripetute", () => {
    expect(t("log.turn", { turn: 3, seat: "Ajmal", flux: 2, max: 3 })).toBe("Turno 3 — tocca a Ajmal (Flusso 2/3).");
    expect(t("log.deploy.nodie", { seat: "A", die: 6, available: 4 })).toContain("servono 6 Flussi disponibili, ne ha 4");
  });

  it("una chiave ignota resta visibile, mai un vuoto", () => {
    expect(t("non.esiste")).toBe("non.esiste");
  });

  it("ogni chiave ha entrambe le lingue e le stesse graffe", () => {
    // Il dizionario è privato: lo si legge attraverso t, in tutte e due le lingue.
    const keys = ["log.play", "log.battle.block", "trigger.look.die", "hud.phase.tip.reazione.wave", "html.ob.room.note"];
    for (const key of keys) {
      setLang("it");
      const it = t(key);
      setLang("en");
      const en = t(key);
      expect(it).not.toBe(key);
      expect(en).not.toBe(key);
      expect(it).not.toBe(en);
      const holes = (text: string): string[] => (text.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
      expect(holes(en)).toEqual(holes(it));
    }
  });

  it("carta o carte", () => {
    expect(cardsWord(1)).toBe("carta");
    expect(cardsWord(2)).toBe("carte");
    setLang("en");
    expect(cardsWord(1)).toBe("card");
  });
});

describe("renderLog", () => {
  const state = newGame("a");
  const names = (id: string): string => ({ "RBF-003": "Guida", "RBF-012": "Rhen" })[id] ?? id;

  it("dà ai posti il nome del tavolo e alle carte il nome nel catalogo di chi legge", () => {
    const line = msg("log.effect.return", { seat: "a", sourceCard: "RBF-012", card: "RBF-003" });
    expect(renderLog(line, state, names)).toBe("Giocatore A: «Rhen» riporta «Guida» sul Fronte.");
    setLang("en");
    expect(renderLog(line, state, id => `${names(id)} (en)`)).toBe("Player A: “Rhen (en)” brings “Guida (en)” back to the Front.".replace(/“|”/g, m => (m === "“" ? "«" : "»")));
  });

  it("usa il nome scelto dal giocatore, se c'è", () => {
    const named = { ...state, players: { ...state.players, b: { ...state.players.b, name: "Ajmal" } } };
    expect(renderLog(msg("log.attack", { seat: "b", n: 1 }), named, names)).toBe("Ajmal attacca (1).");
  });

  it("rende le chiavi annidate e le liste, nella lingua di chi legge", () => {
    const line = msg("log.effect.look", {
      seat: "a",
      sourceCard: "RBF-003",
      parts: [msg("look.looked", { n: 3 }), msg("look.noreveal"), msg("look.rest")],
    });
    expect(renderLog(line, state, names)).toBe("Giocatore A: «Guida» guarda 3 carte; non mostra nulla; le altre in fondo al mazzo.");
    setLang("en");
    expect(renderLog(line, state, names)).toBe("Player A: «Guida» looks at 3 cards; reveals nothing; the rest to the bottom of the deck.");
  });

  it("la stessa riga di chat si legge in due lingue diverse ai due lati del tavolo", () => {
    const line = msg("log.newgame", { seat: "a", otherSeat: "b" });
    expect(renderLog(line, state, names)).toBe("Nuova partita: inizia Giocatore A, il Gettone Flusso va a Giocatore B (§4).");
    setLang("en");
    expect(renderLog(line, state, names)).toBe("New game: Player A starts, the Flux Token goes to Player B (§4).");
  });
});

describe("seatLabel", () => {
  it("segue la lingua", () => {
    const state = newGame("a");
    expect(seatLabel(state, "b")).toBe("Giocatore B");
    setLang("en");
    expect(seatLabel(state, "b")).toBe("Player B");
    expect(seatLabel(state, "b", "a")).toBe("Waiting…");
  });
});
