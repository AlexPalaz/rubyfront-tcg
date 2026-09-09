export const DEFAULT_THEME = "t41";

export const THEMES = Object.freeze([
  ["t01", "Rubino & Oro"],
  ["t02", "Abisso Vivo"],
  ["t03", "Neon Notturno"],
  ["t04", "Gotico Neon"],
  ["t05", "Terminale CRT"],
  ["t06", "Vaporwave"],
  ["t07", "Brutalista"],
  ["t08", "Pergamena"],
  ["t09", "Obsidiana & Argento"],
  ["t10", "Sangue & Cenere"],
  ["t11", "Smeraldo Regale"],
  ["t12", "Ghiaccio"],
  ["t13", "Sakura Notturna"],
  ["t14", "Circuito Dorato"],
  ["t15", "Ametista"],
  ["t16", "Duna & Indaco"],
  ["t17", "Olografica"],
  ["t18", "Acciaio & Arancio"],
  ["t19", "Tossico"],
  ["t20", "Museo"],
  ["t21", "Runa Incisa"],
  ["t22", "Origami"],
  ["t23", "Blueprint"],
  ["t24", "Pop Fumetto"],
  ["t25", "Brace"],
  ["t26", "Glitch"],
  ["t27", "Art Déco"],
  ["t28", "Cosmo"],
  ["t29", "Bronzo & Verderame"],
  ["t30", "Vetrata"],
  ["t31", "Carta Nautica"],
  ["t32", "Marmo & Oro"],
  ["t33", "Aurora Boreale"],
  ["t34", "Lacca Rossa"],
  ["t35", "Sumi-e"],
  ["t36", "Tempesta"],
  ["t37", "Ossario"],
  ["t38", "Miraggio"],
  ["t39", "Cattedrale"],
  ["t40", "Codice Miniato"],
  ["t41", "Cattedrale Dark"],
  ["t42", "Cattedrale Argento"],
  ["t43", "Cattedrale Ossidiana"],
  ["t44", "Cattedrale Acciaio"],
  ["t45", "Cattedrale Bronzo"],
  ["t46", "Cattedrale Porcellana"],
  ["t47", "Cattedrale Avorio"],
  ["t48", "Cattedrale Rame"],
  ["t49", "Cattedrale Rubino"]
]);

export const LIGHT_THEMES = new Set([
  "t07", "t08", "t12", "t16", "t20", "t22", "t24",
  "t31", "t32", "t35", "t38", "t39", "t40", "t42", "t46", "t47"
]);

/** La famiglia Cattedrale (t41 in su): stessa architettura — cornice a
    lastra ottagonale, gemma di rubino in cuspide, nome a doppio filo —
    e palette a sfumature diverse. Il renderer aggiunge la classe
    `cathedral`, e card.css veste la struttura una volta sola. */
export const CATHEDRAL_THEMES = new Set(["t41", "t42", "t43", "t44", "t45", "t46", "t47", "t48", "t49"]);

export function isThemeId(value) {
  return THEMES.some(([id]) => id === value);
}
