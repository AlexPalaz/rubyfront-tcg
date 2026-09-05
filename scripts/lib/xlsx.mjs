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
  const pezzi = [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unescape(m[1]));
  return pezzi.join("");
}

/** «B7» → 1 (colonna, base zero). */
function colonna(ref) {
  const lettere = (ref.match(/^[A-Z]+/) || ["A"])[0];
  let n = 0;
  for (const ch of lettere) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Legge un .xlsx: `[{ nome, righe: [[cella, …], …] }, …]`, un elemento per
 * foglio, nell'ordine in cui stanno nel file. Le celle sono stringhe (vuote
 * dove la cella non c'è); i numeri arrivano come li ha scritti il foglio.
 */
export function leggiXlsx(file) {
  const workbook = part(file, "xl/workbook.xml");
  if (!workbook) throw new Error(`non è un foglio di calcolo leggibile: ${file}`);

  // Nome del foglio → file del foglio, passando per le relazioni.
  const rels = part(file, "xl/_rels/workbook.xml.rels");
  const bersaglio = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const id = (m[0].match(/Id="([^"]+)"/) || [])[1];
    const target = (m[0].match(/Target="([^"]+)"/) || [])[1];
    if (id && target) bersaglio.set(id, target.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
  }

  const condivise = [...part(file, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => runs(m[1]));

  const fogli = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/>/g)) {
    const nome = unescape((m[0].match(/name="([^"]*)"/) || [])[1] ?? "");
    const rid = (m[0].match(/r:id="([^"]+)"/) || [])[1];
    const dentro = bersaglio.get(rid) ?? `worksheets/sheet${fogli.length + 1}.xml`;
    const xml = part(file, `xl/${dentro}`);
    const righe = [];
    for (const riga of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const celle = [];
      // Gli attributi si prendono PIGRI: greedy, `[^>]*` si mangerebbe anche
      // la barra di una cella vuota (`<c r="G7" s="3"/>`), l'alternativa
      // cadrebbe sul ramo con il corpo e la cella si porterebbe via il
      // contenuto delle due successive.
      for (const cella of riga[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attributi = cella[1];
        const corpo = cella[2] ?? "";
        const ref = (attributi.match(/r="([A-Z]+\d+)"/) || [])[1];
        const tipo = (attributi.match(/t="([^"]+)"/) || [])[1];
        let valore = "";
        if (tipo === "inlineStr") valore = runs(corpo);
        else {
          const v = (corpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          if (v !== undefined) valore = tipo === "s" ? (condivise[Number(v)] ?? "") : unescape(v);
        }
        const dove = ref ? colonna(ref) : celle.length;
        while (celle.length < dove) celle.push("");
        celle[dove] = valore;
      }
      // Le righe hanno un indice: le saltate sono righe vuote, e vanno tenute.
      const dove = Number((riga[0].match(/r="(\d+)"/) || [])[1] ?? righe.length + 1) - 1;
      while (righe.length < dove) righe.push([]);
      righe[dove] = celle;
    }
    fogli.push({ nome, righe });
  }
  return fogli;
}

/**
 * Scrive un .xlsx da `[{ nome, righe, larghezze, stili }, …]`.
 *
 * `stili` è una mappa indice di riga → nome di stile fra quelli qui sotto:
 * bastano un titolo, una fascia di sezione e un'intestazione. Tutto il testo
 * viaggia come stringa in linea: niente tabella condivisa, un pezzo in meno
 * da tenere allineato.
 */
const STILI = ["normale", "titolo", "sezione", "intestazione"];

export function scriviXlsx(file, fogli) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rbf-xlsx-"));
  const scrivi = (dentro, testo) => {
    fs.mkdirSync(path.join(dir, path.dirname(dentro)), { recursive: true });
    fs.writeFileSync(path.join(dir, dentro), testo);
  };

  scrivi("[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    fogli.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    "</Types>");

  scrivi("_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>");

  scrivi("xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    fogli.map((f, i) => `<sheet name="${escape(f.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    "</sheets></workbook>");

  scrivi("xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    fogli.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${fogli.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    "</Relationships>");

  // Quattro stili: normale, titolo (rubino, grande), sezione (fascia chiara),
  // intestazione (grassetto su cenere). Il testo va sempre a capo e in alto.
  scrivi("xl/styles.xml",
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

  const lettera = n => {
    let s = "";
    for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };

  fogli.forEach((foglio, indice) => {
    const cols = (foglio.larghezze ?? [])
      .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
      .join("");
    const righe = foglio.righe.map((riga, r) => {
      const stile = STILI.indexOf(foglio.stili?.[r] ?? "normale");
      const celle = (riga ?? []).map((valore, c) => {
        if (valore === null || valore === undefined || valore === "") return "";
        const rif = `${lettera(c)}${r + 1}`;
        const s = stile > 0 ? ` s="${stile}"` : "";
        return typeof valore === "number"
          ? `<c r="${rif}"${s}><v>${valore}</v></c>`
          : `<c r="${rif}"${s} t="inlineStr"><is><t xml:space="preserve">${escape(valore)}</t></is></c>`;
      }).join("");
      return `<row r="${r + 1}">${celle}</row>`;
    }).join("");
    scrivi(`xl/worksheets/sheet${indice + 1}.xml`,
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (cols ? `<cols>${cols}</cols>` : "") +
      `<sheetData>${righe}</sheetData></worksheet>`);
  });

  fs.rmSync(file, { force: true });
  // -X toglie i metadati del Finder, che in uno zip di Office non c'entrano.
  execFileSync("zip", ["-q", "-X", "-r", path.resolve(file), "."], { cwd: dir });
  fs.rmSync(dir, { recursive: true, force: true });
  return file;
}
