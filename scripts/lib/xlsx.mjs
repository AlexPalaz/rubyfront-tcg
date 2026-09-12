// Leggere e scrivere un foglio di calcolo, senza dipendenze.
//
// Un .xlsx è uno zip di XML. Il repo non ha pacchetti da installare — né qui
// né nell'engine — e non è il caso di iniziare per due funzioni: `unzip` e
// `zip` ci sono su ogni Mac e su ogni Linux, e l'XML che serve è poco e
// regolare. Le espressioni regolari bastano perché questi file non li scrive
// una persona: li scrive Google (in esportazione) o questo stesso modulo.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Le entità XML che compaiono nei testi delle carte. */
function unescape(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function escape(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function part(file, name) {
  try {
    return execFileSync("unzip", ["-p", file, name], { maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
  } catch {
    return "";
  }
}

/** Il testo di un <si> o di un <is>: la somma dei suoi <t>, righe comprese. */
function runs(xml) {
  const pieces = [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unescape(m[1]));
  return pieces.join("");
}

/** «B7» → 1 (colonna, base zero). */
function column(ref) {
  const letters = (ref.match(/^[A-Z]+/) || ["A"])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Legge un .xlsx: `[{ nome, righe: [[cella, …], …] }, …]`, un elemento per
 * foglio, nell'ordine in cui stanno nel file. Le celle sono stringhe (vuote
 * dove la cella non c'è); i numeri arrivano come li ha scritti il foglio.
 */
export function readXlsx(file) {
  const workbook = part(file, "xl/workbook.xml");
  if (!workbook) throw new Error(`non è un foglio di calcolo leggibile: ${file}`);

  // Nome del foglio → file del foglio, passando per le relazioni.
  const rels = part(file, "xl/_rels/workbook.xml.rels");
  const targets = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const id = (m[0].match(/Id="([^"]+)"/) || [])[1];
    const target = (m[0].match(/Target="([^"]+)"/) || [])[1];
    if (id && target) targets.set(id, target.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
  }

  const shared = [...part(file, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => runs(m[1]));

  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/>/g)) {
    const name = unescape((m[0].match(/name="([^"]*)"/) || [])[1] ?? "");
    const rid = (m[0].match(/r:id="([^"]+)"/) || [])[1];
    const entry = targets.get(rid) ?? `worksheets/sheet${sheets.length + 1}.xml`;
    const xml = part(file, `xl/${entry}`);
    const rows = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      // Gli attributi si prendono PIGRI: greedy, `[^>]*` si mangerebbe anche
      // la barra di una cella vuota (`<c r="G7" s="3"/>`), l'alternativa
      // cadrebbe sul ramo con il corpo e la cella si porterebbe via il
      // contenuto delle due successive.
      for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1];
        const body = cell[2] ?? "";
        const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
        const type = (attrs.match(/t="([^"]+)"/) || [])[1];
        let value = "";
        if (type === "inlineStr") value = runs(body);
        else {
          const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          if (v !== undefined) value = type === "s" ? (shared[Number(v)] ?? "") : unescape(v);
        }
        const at = ref ? column(ref) : cells.length;
        while (cells.length < at) cells.push("");
        cells[at] = value;
      }
      // Le righe hanno un indice: le saltate sono righe vuote, e vanno tenute.
      const at = Number((row[0].match(/r="(\d+)"/) || [])[1] ?? rows.length + 1) - 1;
      while (rows.length < at) rows.push([]);
      rows[at] = cells;
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

/**
 * Scrive un .xlsx da `[{ nome, righe, larghezze, stili }, …]`.
 *
 * `stili` è una mappa indice di riga → nome di stile fra quelli qui sotto:
 * bastano un titolo, una fascia di sezione e un'intestazione. Tutto il testo
 * viaggia come stringa in linea: niente tabella condivisa, un pezzo in meno
 * da tenere allineato.
 */
const STYLES = ["normal", "title", "section", "header"];

export function writeXlsx(file, sheets) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rbf-xlsx-"));
  const write = (entry, text) => {
    fs.mkdirSync(path.join(dir, path.dirname(entry)), { recursive: true });
    fs.writeFileSync(path.join(dir, entry), text);
  };

  write("[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    "</Types>");

  write("_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>");

  write("xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets.map((f, i) => `<sheet name="${escape(f.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    "</sheets></workbook>");

  write("xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    "</Relationships>");

  // Quattro stili: normale, titolo (rubino, grande), sezione (fascia chiara),
  // intestazione (grassetto su cenere). Il testo va sempre a capo e in alto.
  write("xl/styles.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="4">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="14"/><color rgb="FF9E0F34"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FF9E0F34"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
    "</fonts>" +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF2E6EA"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEDE6E0"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf fontId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf fontId="1" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
    '<xf fontId="2" fillId="2" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
    '<xf fontId="3" fillId="3" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    "</cellXfs>" +
    // Senza uno stile predefinito i lettori severi si lamentano; Google lo
    // ignora, ma il file deve aprirsi pulito ovunque.
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>");

  const letter = n => {
    let s = "";
    for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };

  sheets.forEach((sheet, index) => {
    const cols = (sheet.widths ?? [])
      .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
      .join("");
    const rows = sheet.rows.map((row, r) => {
      const style = STYLES.indexOf(sheet.styles?.[r] ?? "normal");
      const cells = (row ?? []).map((value, c) => {
        if (value === null || value === undefined || value === "") return "";
        const ref = `${letter(c)}${r + 1}`;
        const s = style > 0 ? ` s="${style}"` : "";
        return typeof value === "number"
          ? `<c r="${ref}"${s}><v>${value}</v></c>`
          : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
      }).join("");
      return `<row r="${r + 1}">${cells}</row>`;
    }).join("");
    write(`xl/worksheets/sheet${index + 1}.xml`,
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (cols ? `<cols>${cols}</cols>` : "") +
      `<sheetData>${rows}</sheetData></worksheet>`);
  });

  fs.rmSync(file, { force: true });
  // -X toglie i metadati del Finder, che in uno zip di Office non c'entrano.
  execFileSync("zip", ["-q", "-X", "-r", path.resolve(file), "."], { cwd: dir });
  fs.rmSync(dir, { recursive: true, force: true });
  return file;
}
