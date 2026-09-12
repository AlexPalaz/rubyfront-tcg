// La resa di una riga di log (chiave + parametri) nella lingua di chi legge.
// Senza DOM: la usano la chat, il ripiego scritto in main.ts e i test. I
// posti (`seat`, `otherSeat`) prendono il nome del tavolo, le carte (`card`,
// `*Card`, un id di catalogo) il nome nel catalogo di chi legge, fra «»; una
// chiave annidata si rende a sua volta, una lista di chiavi si unisce con «; ».
import { t } from "./i18n.js";
import { seatLabel } from "./state.js";
import type { GameState, LogMsg, LogParam, Seat } from "./types.js";

export function renderLog(message: LogMsg, state: GameState, cardName: (cardId: string) => string): string {
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(message.params ?? {})) {
    params[name] = renderParam(name, value, state, cardName);
  }
  return t(message.key, params);
}

function renderParam(name: string, value: LogParam, state: GameState, cardName: (cardId: string) => string): string | number {
  if (Array.isArray(value)) return value.map(item => renderLog(item, state, cardName)).join("; ");
  if (typeof value === "object") return renderLog(value, state, cardName);
  if (typeof value === "string" && (name === "seat" || name === "otherSeat")) return seatLabel(state, value as Seat);
  if (typeof value === "string" && (name === "card" || name.endsWith("Card"))) return `«${cardName(value)}»`;
  return value;
}
