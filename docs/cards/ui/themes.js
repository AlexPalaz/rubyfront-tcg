export const DEFAULT_THEME = "t39";

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
  ["t40", "Codice Miniato"]
]);

export const LIGHT_THEMES = new Set([
  "t07", "t08", "t12", "t16", "t20", "t22", "t24",
  "t31", "t32", "t35", "t38", "t39", "t40"
]);

export function isThemeId(value) {
  return THEMES.some(([id]) => id === value);
}
