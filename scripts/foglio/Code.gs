// Il ponte di scrittura verso il foglio «Rubyfront - Mazzi Precon».
//
// Va incollato in Estensioni → Apps Script del foglio e pubblicato come
// web app («Esegui come: me», «Chi ha accesso: chiunque»). Il segreto sta
// nelle proprietà dello script (Impostazioni progetto → Proprietà dello
// script, chiave SEGRETO): senza quello la richiesta non scrive nulla.
//
// Il client è scripts/foglio/foglio.mjs nel repo: manda un JSON con le
// scritture, ognuna indirizzata per nome di carta e nome di colonna, così
// non dipende dal numero di riga.

function risposta(oggetto) {
  return ContentService.createTextOutput(JSON.stringify(oggetto)).setMimeType(ContentService.MimeType.JSON);
}

function segretoValido(dato) {
  var segreto = PropertiesService.getScriptProperties().getProperty("SEGRETO");
  return !!segreto && dato === segreto;
}

function trovaFoglio(ss, richiesta) {
  var fogli = ss.getSheets();
  for (var i = 0; i < fogli.length; i++) {
    if (richiesta.gid !== undefined && String(fogli[i].getSheetId()) === String(richiesta.gid)) return fogli[i];
    if (richiesta.foglio && fogli[i].getName() === richiesta.foglio) return fogli[i];
  }
  return null;
}

// La riga d'intestazione è quella che contiene sia «Nome» sia la colonna
// chiesta; la riga della carta è la prima, sotto, col nome in colonna «Nome».
function trovaCella(foglio, nome, colonna) {
  var valori = foglio.getDataRange().getValues();
  var colNome = -1, colValore = -1;
  for (var r = 0; r < valori.length; r++) {
    var riga = valori[r].map(function (v) { return String(v).trim(); });
    var iNome = riga.indexOf("Nome"), iCol = riga.indexOf(colonna);
    if (iNome >= 0 && iCol >= 0) { colNome = iNome; colValore = iCol; continue; }
    if (colNome >= 0 && riga[colNome] === nome) return { riga: r + 1, colonna: colValore + 1 };
  }
  return null;
}

function doPost(e) {
  var corpo;
  try { corpo = JSON.parse(e.postData.contents); } catch (err) { return risposta({ ok: false, errore: "json" }); }
  if (!segretoValido(corpo.segreto)) return risposta({ ok: false, errore: "segreto" });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var esiti = [];
  (corpo.scritture || []).forEach(function (s) {
    var foglio = trovaFoglio(ss, s);
    if (!foglio) { esiti.push({ nome: s.nome, ok: false, errore: "foglio non trovato" }); return; }
    var cella = s.cella ? null : trovaCella(foglio, s.nome, s.colonna);
    var range = s.cella ? foglio.getRange(s.cella) : (cella && foglio.getRange(cella.riga, cella.colonna));
    if (!range) { esiti.push({ nome: s.nome, ok: false, errore: "carta o colonna non trovata" }); return; }
    var prima = range.getValue();
    range.setValue(s.valore);
    esiti.push({ foglio: foglio.getName(), cella: range.getA1Notation(), nome: s.nome, ok: true, prima: prima });
  });
  return risposta({ ok: true, esiti: esiti });
}

// Lettura di verifica: ?segreto=…&gid=… (o &foglio=…) → tutte le righe.
function doGet(e) {
  var p = e.parameter || {};
  if (!segretoValido(p.segreto)) return risposta({ ok: false, errore: "segreto" });
  var foglio = trovaFoglio(SpreadsheetApp.getActiveSpreadsheet(), p);
  if (!foglio) return risposta({ ok: false, errore: "foglio non trovato" });
  return risposta({ ok: true, foglio: foglio.getName(), righe: foglio.getDataRange().getValues() });
}
