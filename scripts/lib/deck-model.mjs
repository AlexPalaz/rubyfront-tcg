// Il ponte fra il catalogo e il foglio di calcolo: da una parte le carte come
// stanno nei dati, dall'altra le righe come stanno sul foglio condiviso.
//
// Sta in un posto solo perché lo usano in due: l'esportazione (catalogo →
// foglio) e il confronto (foglio → differenze). Se le due letture divergono,
// il confronto segnala differenze che non esistono.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SETS = path.join(ROOT, "data", "sets");
const DECKS = path.join(ROOT, "data", "decks");

export const CATEGORY = { entity: "Entità", object: "Oggetto", matter: "Materia" };
export const RACE = { human: "Umano", auros: "Auros", simulacrum: "Simulacro" };
export const MATTER = { dynamic: "Dinamica", dimensional: "Dimensionale", destructive: "Distruttiva", zero: "Zero", dominant: "Dominante" };
export const GRADE = { 1: "I", 2: "II", 3: "III" };
export const BEHAVIOR = { normal: "Normale", permanent: "Permanente", reactive: "Reattiva" };
export const KEYWORD = { fury: "Furia", surge: "Slancio", stasis: "Stasi", revenge: "Vendetta" };

export const HEADER = ["Copie", "Nome", "Categoria", "Costo", "Potenza", "Razza", "Materia", "Tipo / Keyword", "Effetto"];
const WIDTHS = [7, 34, 11, 7, 9, 12, 22, 24, 96];
const ORDER = ["Entità", "Oggetto", "Materia"];

const json = file => JSON.parse(fs.readFileSync(file, "utf8"));

/**
 * La chiave con cui si confrontano i nomi. La «à» si può scrivere in due
 * modi — una lettera sola, o «a» più l'accento — e i due modi non sono la
 * stessa stringa: i dati del repo la scrivono scomposta, Google Fogli la
 * ricompone in esportazione, e «Eredità Perduta» non combaciava con sé
 * stessa. `normalize("NFC")` mette tutti d'accordo.
 */
export const nameKey = text => String(text ?? "").normalize("NFC").trim().toLowerCase();

/** Tutte le carte del catalogo, per id. */
export function cards() {
  const out = new Map();
  for (const set of fs.readdirSync(SETS)) {
    const dir = path.join(SETS, set, "cards");
    if (!fs.existsSync(dir)) continue;
    for (const folder of fs.readdirSync(dir)) {
      const base = path.join(dir, folder, folder);
      if (!fs.existsSync(`${base}.json`)) continue;
      const d = json(`${base}.json`);
      out.set(d.id, { id: d.id, dir: path.join(dir, folder), d, it: json(`${base}.it.json`) });
    }
  }
  return out;
}

/** Tutti i mazzi del catalogo, per id. */
export function decks() {
  const out = new Map();
  for (const file of fs.readdirSync(DECKS)) {
    if (!file.endsWith(".json")) continue;
    const d = json(path.join(DECKS, file));
    out.set(d.id, d);
  }
  return out;
}

/** I testi di una faccia, «Innesco: corpo», nell'ordine in cui stanno sulla carta. */
function text(block) {
  const rows = [];
  for (const [nameKey, value] of Object.entries(block ?? {})) {
    if (!value || typeof value !== "object") continue;
    if (value.text) {
      const trigger = value.trigger;
      rows.push(trigger && trigger !== "Effetto" ? `${trigger}: ${value.text}` : value.text);
    } else if (nameKey === "abilities") {
      for (const ability of Object.values(value)) {
        if (ability?.text) rows.push(`${ability.name ?? ""}: ${ability.text}`.replace(/^: /, ""));
      }
    }
  }
  return rows.join("\n");
}

export function enabledMatters(face) {
  return (face.enablesMatters ?? [])
    .map(m => `${MATTER[m.type] ?? m.type} ${GRADE[m.maxGrade] ?? ""}`.trim())
    .join(" · ");
}

/** Una carta come riga del foglio. */
export function cardRow(card, copies) {
  const { d, it } = card;
  const face = d.faces[0];
  const stats = face.stats ?? {};
  const label = face.matter;
  const matter = label
    ? `${MATTER[label.type] ?? label.type} ${GRADE[label.grade] ?? ""}`.trim()
    : enabledMatters(face);
  const type = [];
  if (d.type === "matter") type.push(BEHAVIOR[face.behavior ?? d.behavior] ?? "");
  for (const k of face.keywords ?? []) type.push(KEYWORD[k.id ?? k] ?? String(k.id ?? k));
  if (stats.counterattack) type.push(`Contrattacco +${stats.counterattack}`);
  if (d.unique) type.push("Unica");
  return [copies, it.name, CATEGORY[d.type] ?? d.type, stats.fluxCost ?? "", stats.power ?? "",
          RACE[face.race] ?? "", matter, type.filter(Boolean).join(" · "), text(it.face ?? it)];
}

/** Il blocco Rubyfront/Nexus in fondo al foglio: righe [etichetta, valore]. */
export function rubyfrontRows(card) {
  const { d, it } = card;
  const [a, b] = d.faces;
  const sa = a.stats ?? {};
  const cost = sa.deploymentCost ?? {};
  const kw = (a.keywords ?? [])[0] ?? {};
  const rows = [
    { style: "section", cells: [`RUBYFRONT / NEXUS — ${it.name}`] },
    { cells: ["PV", sa.health ?? ""] },
    { cells: ["Costo di schieramento", cost.die ? String(cost.die) : `${cost.base} Flussi`] },
    { cells: ["Materie", enabledMatters(a)] },
  ];
  if (kw.id === "fury") {
    rows.push({ cells: ["Furia", `${kw.check.die} ≥ ${kw.check.successAtLeast} prima di ogni azione · fallimento −${kw.failure.loseHealth} PV`] });
  }
  rows.push({ cells: ["Requisito Nexus", it.card?.nexusRequirement?.text ?? ""] });
  rows.push({ cells: ["Recupero Nexus", `+${(b.stats ?? {}).healthRecovery} PV`] });
  rows.push({ cells: [] });
  for (const [face, nameKey] of [[a, "faceA"], [b, "faceB"]]) {
    const block = it[nameKey] ?? {};
    rows.push({ style: "header", cells: [`Faccia ${nameKey === "faceA" ? "A — Rubyfront" : "B — Nexus"}: ${block.name ?? ""}`] });
    rows.push({ cells: ["Materie", enabledMatters(face)] });
    for (const value of Object.values(block)) {
      if (value && typeof value === "object" && value.text && !("name" in value)) {
        rows.push({ cells: [value.trigger ?? "Effetto", value.text] });
      }
    }
    for (const action of face.actions ?? []) {
      const name = block.abilities?.[action.displayKey] ?? {};
      const hp = action.gain?.health ?? -(action.cost?.health ?? 0);
      // Il segno meno è quello tipografico (U+2212), come sulle carte.
      rows.push({ cells: [`${hp > 0 ? `+${hp}` : `−${-hp}`} PV`, `${name.name ?? ""}: ${name.text ?? ""}`.replace(/^: /, "")] });
    }
    rows.push({ cells: [] });
  }
  return rows;
}

/** Il foglio di un mazzo: righe, stili e larghezze, pronti per scriviXlsx. */
export function deckSheet(deck, allCards) {
  const counts = new Map(deck.cards.map(c => [c.card, c.count]));
  const rubyfront = [...counts.keys()].filter(id => allCards.get(id)?.d.type === "rubyfront");
  const rows = [];
  const styles = {};
  const write = (cells, style) => {
    if (style) styles[rows.length] = style;
    rows.push(cells);
  };

  const loc = deck.locales.it;
  const copies = [...counts].filter(([id]) => !rubyfront.includes(id)).reduce((n, [, c]) => n + c, 0);
  write([`RUBYFRONT — ${loc.name.toUpperCase()}`], "title");
  write([loc.description]);
  write([`${copies} carte + Rubyfront/Nexus (in fondo al foglio)`]);
  write([]);

  const deckRows = [...counts]
    .filter(([id]) => !rubyfront.includes(id))
    .map(([id, n]) => cardRow(allCards.get(id), n));

  for (const category of ORDER) {
    const group = deckRows
      .filter(r => r[2] === category)
      .sort((x, y) => (x[3] || 0) - (y[3] || 0) || String(x[1]).localeCompare(String(y[1]), "it"));
    if (!group.length) continue;
    write([`${category} — ${group.length} carte, ${group.reduce((n, r) => n + r[0], 0)} copie`], "section");
    write(HEADER, "header");
    for (const r of group) write(r);
    write([]);
    write([]);
  }
  for (const id of rubyfront) {
    for (const { cells, style } of rubyfrontRows(allCards.get(id))) write(cells, style);
  }
  return { name: loc.name, rows, styles, widths: WIDTHS };
}

/**
 * Il verso opposto: un foglio → il mazzo che descrive. Si riconoscono le
 * righe carta (la prima cella è un numero e c'è un nome) e il blocco
 * Rubyfront/Nexus, che parte dalla sua fascia e arriva in fondo.
 */
export function deckFromSheet(sheet) {
  const sheetCards = [];
  const rubyfront = [];
  let inRubyfront = false;
  for (const row of sheet.rows) {
    const cells = (row ?? []).map(c => String(c ?? "").trim());
    const first = cells[0] ?? "";
    if (/^RUBYFRONT \/ NEXUS/i.test(first)) { inRubyfront = true; }
    if (inRubyfront) {
      if (first || cells[1]) rubyfront.push([first, cells[1] ?? ""]);
      continue;
    }
    if (first === "Copie" || !first) continue;
    if (!/^\d+$/.test(first) || !cells[1]) continue;
    sheetCards.push({
      copies: Number(first), name: cells[1], category: cells[2] ?? "", cost: cells[3] ?? "",
      power: cells[4] ?? "", race: cells[5] ?? "", matter: cells[6] ?? "",
      type: cells[7] ?? "", effect: (cells[8] ?? "").replace(/\r\n/g, "\n"),
    });
  }
  const title = String(sheet.rows[0]?.[0] ?? "").replace(/^RUBYFRONT\s+—\s*/i, "").trim();
  return { name: sheet.name, title, cards: sheetCards, rubyfront };
}

/** Confronta il foglio col catalogo. Ritorna un elenco di differenze leggibili. */
export function compare(fromSheet, deck, allCards) {
  const differences = [];
  const counts = new Map((deck?.cards ?? []).map(c => [c.card, c.count]));
  const byName = new Map();
  for (const [id, n] of counts) {
    const card = allCards.get(id);
    // Il Rubyfront non è una riga carta: sta nel blocco in fondo, e si
    // confronta lì.
    if (card && card.d.type !== "rubyfront") byName.set(nameKey(card.it.name), { card, copies: n });
  }

  const seen = new Set();
  for (const row of fromSheet.cards) {
    const name = nameKey(row.name);
    const inDeck = byName.get(name);
    if (!inDeck) {
      const elsewhere = [...allCards.values()].find(c => nameKey(c.it.name) === name);
      differences.push({
        card: row.name,
        type: elsewhere ? "aggiunta al mazzo" : "carta nuova",
        notes: elsewhere ? [`${elsewhere.id} esiste in catalogo, ${row.copies} copie`] : [`${row.copies} copie, ${row.category || "categoria da leggere"}`],
      });
      continue;
    }
    seen.add(name);
    const expected = cardRow(inDeck.card, inDeck.copies);
    const fields = [
      ["copie", String(row.copies), String(expected[0])],
      ["costo", row.cost, String(expected[3] ?? "")],
      ["Potenza", row.power, String(expected[4] ?? "")],
      ["razza", row.race, String(expected[5] ?? "")],
      ["Materia", row.matter, String(expected[6] ?? "")],
      ["tipo / keyword", row.type, String(expected[7] ?? "")],
      ["effetto", row.effect, String(expected[8] ?? "")],
    ];
    const notes = fields
      .filter(([, sheet, catalog]) => sheet.replace(/\s+/g, " ").trim() !== catalog.replace(/\s+/g, " ").trim())
      .map(([name, sheet, catalog]) => `${name}: foglio «${sheet}» — catalogo «${catalog}»`);
    if (notes.length) differences.push({ card: `${inDeck.card.id} ${row.name}`, type: "cambiata", notes });
  }
  for (const [name, inDeck] of byName) {
    if (!seen.has(name)) {
      differences.push({ card: `${inDeck.card.id} ${inDeck.card.it.name}`, type: "non è più nel foglio", notes: [`nel catalogo ha ${inDeck.copies} copie`] });
    }
  }

  // Il blocco in fondo: PV, schieramento, Furia, requisito del flip, le due
  // facce e le loro abilità. Si confrontano etichetta per etichetta, che è
  // come stanno scritte sul foglio.
  const rf = [...counts.keys()].map(id => allCards.get(id)).find(c => c?.d.type === "rubyfront");
  if (rf) {
    const expectedRows = rubyfrontRows(rf)
      .map(r => r.cells)
      .filter(cells => cells.length >= 2 && String(cells[0]).trim())
      .map(cells => [String(cells[0]).trim(), String(cells[1] ?? "").trim()]);
    const fromRows = fromSheet.rubyfront.filter(([e, v]) => e && v);
    const notes = [];
    const max = Math.max(expectedRows.length, fromRows.length);
    for (let i = 0; i < max; i += 1) {
      const [labelA, valueA] = expectedRows[i] ?? ["—", ""];
      const [labelB, valueB] = fromRows[i] ?? ["—", ""];
      const clean = t => t.replace(/\s+/g, " ").trim();
      if (clean(labelA) !== clean(labelB) || clean(valueA) !== clean(valueB)) {
        notes.push(`${labelB || labelA}: foglio «${clean(valueB)}» — catalogo «${clean(valueA)}»`);
      }
    }
    if (notes.length) differences.push({ card: `${rf.id} ${rf.it.name}`, type: "Rubyfront / Nexus", notes });
  }
  return differences;
}
