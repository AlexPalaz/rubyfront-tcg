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

export const CATEGORIA = { entity: "Entità", object: "Oggetto", matter: "Materia" };
export const RAZZA = { human: "Umano", auros: "Auros", simulacrum: "Simulacro" };
export const MATERIA = { dynamic: "Dinamica", dimensional: "Dimensionale", destructive: "Distruttiva", zero: "Zero", dominant: "Dominante" };
export const GRADO = { 1: "I", 2: "II", 3: "III" };
export const COMPORTAMENTO = { normal: "Normale", permanent: "Permanente", reactive: "Reattiva" };
export const KEYWORD = { fury: "Furia", surge: "Slancio", stasis: "Stasi", revenge: "Vendetta" };

export const INTESTAZIONE = ["Copie", "Nome", "Categoria", "Costo", "Potenza", "Razza", "Materia", "Tipo / Keyword", "Effetto"];
const LARGHEZZE = [7, 34, 11, 7, 9, 12, 22, 24, 96];
const ORDINE = ["Entità", "Oggetto", "Materia"];

const json = file => JSON.parse(fs.readFileSync(file, "utf8"));

/**
 * La chiave con cui si confrontano i nomi. La «à» si può scrivere in due
 * modi — una lettera sola, o «a» più l'accento — e i due modi non sono la
 * stessa stringa: i dati del repo la scrivono scomposta, Google Fogli la
 * ricompone in esportazione, e «Eredità Perduta» non combaciava con sé
 * stessa. `normalize("NFC")` mette tutti d'accordo.
 */
export const chiave = testo => String(testo ?? "").normalize("NFC").trim().toLowerCase();

/** Tutte le carte del catalogo, per id. */
export function carte() {
  const fuori = new Map();
  for (const set of fs.readdirSync(SETS)) {
    const dir = path.join(SETS, set, "cards");
    if (!fs.existsSync(dir)) continue;
    for (const cartella of fs.readdirSync(dir)) {
      const base = path.join(dir, cartella, cartella);
      if (!fs.existsSync(`${base}.json`)) continue;
      const d = json(`${base}.json`);
      fuori.set(d.id, { id: d.id, dir: path.join(dir, cartella), d, it: json(`${base}.it.json`) });
    }
  }
  return fuori;
}

/** Tutti i mazzi del catalogo, per id. */
export function mazzi() {
  const fuori = new Map();
  for (const file of fs.readdirSync(DECKS)) {
    if (!file.endsWith(".json")) continue;
    const d = json(path.join(DECKS, file));
    fuori.set(d.id, d);
  }
  return fuori;
}

/** I testi di una faccia, «Innesco: corpo», nell'ordine in cui stanno sulla carta. */
function testo(blocco) {
  const righe = [];
  for (const [chiave, valore] of Object.entries(blocco ?? {})) {
    if (!valore || typeof valore !== "object") continue;
    if (valore.text) {
      const innesco = valore.trigger;
      righe.push(innesco && innesco !== "Effetto" ? `${innesco}: ${valore.text}` : valore.text);
    } else if (chiave === "abilities") {
      for (const abilita of Object.values(valore)) {
        if (abilita?.text) righe.push(`${abilita.name ?? ""}: ${abilita.text}`.replace(/^: /, ""));
      }
    }
  }
  return righe.join("\n");
}

export function materieAbilitate(faccia) {
  return (faccia.enablesMatters ?? [])
    .map(m => `${MATERIA[m.type] ?? m.type} ${GRADO[m.maxGrade] ?? ""}`.trim())
    .join(" · ");
}

/** Una carta come riga del foglio. */
export function rigaCarta(carta, copie) {
  const { d, it } = carta;
  const faccia = d.faces[0];
  const stats = faccia.stats ?? {};
  const etichetta = faccia.matter;
  const materia = etichetta
    ? `${MATERIA[etichetta.type] ?? etichetta.type} ${GRADO[etichetta.grade] ?? ""}`.trim()
    : materieAbilitate(faccia);
  const tipo = [];
  if (d.type === "matter") tipo.push(COMPORTAMENTO[faccia.behavior ?? d.behavior] ?? "");
  for (const k of faccia.keywords ?? []) tipo.push(KEYWORD[k.id ?? k] ?? String(k.id ?? k));
  if (stats.counterattack) tipo.push(`Contrattacco +${stats.counterattack}`);
  if (d.unique) tipo.push("Unica");
  return [copie, it.name, CATEGORIA[d.type] ?? d.type, stats.fluxCost ?? "", stats.power ?? "",
          RAZZA[faccia.race] ?? "", materia, tipo.filter(Boolean).join(" · "), testo(it.face ?? it)];
}

/** Il blocco Rubyfront/Nexus in fondo al foglio: righe [etichetta, valore]. */
export function righeRubyfront(carta) {
  const { d, it } = carta;
  const [a, b] = d.faces;
  const sa = a.stats ?? {};
  const costo = sa.deploymentCost ?? {};
  const kw = (a.keywords ?? [])[0] ?? {};
  const righe = [
    { stile: "sezione", celle: [`RUBYFRONT / NEXUS — ${it.name}`] },
    { celle: ["PV", sa.health ?? ""] },
    { celle: ["Costo di schieramento", costo.die ? String(costo.die) : `${costo.base} Flussi`] },
    { celle: ["Materie", materieAbilitate(a)] },
  ];
  if (kw.id === "fury") {
    righe.push({ celle: ["Furia", `${kw.check.die} ≥ ${kw.check.successAtLeast} prima di ogni azione · fallimento −${kw.failure.loseHealth} PV`] });
  }
  righe.push({ celle: ["Requisito Nexus", it.card?.nexusRequirement?.text ?? ""] });
  righe.push({ celle: ["Recupero Nexus", `+${(b.stats ?? {}).healthRecovery} PV`] });
  righe.push({ celle: [] });
  for (const [faccia, chiave] of [[a, "faceA"], [b, "faceB"]]) {
    const blocco = it[chiave] ?? {};
    righe.push({ stile: "intestazione", celle: [`Faccia ${chiave === "faceA" ? "A — Rubyfront" : "B — Nexus"}: ${blocco.name ?? ""}`] });
    righe.push({ celle: ["Materie", materieAbilitate(faccia)] });
    for (const valore of Object.values(blocco)) {
      if (valore && typeof valore === "object" && valore.text && !("name" in valore)) {
        righe.push({ celle: [valore.trigger ?? "Effetto", valore.text] });
      }
    }
    for (const azione of faccia.actions ?? []) {
      const nome = blocco.abilities?.[azione.displayKey] ?? {};
      const pv = azione.gain?.health ?? -(azione.cost?.health ?? 0);
      // Il segno meno è quello tipografico (U+2212), come sulle carte.
      righe.push({ celle: [`${pv > 0 ? `+${pv}` : `−${-pv}`} PV`, `${nome.name ?? ""}: ${nome.text ?? ""}`.replace(/^: /, "")] });
    }
    righe.push({ celle: [] });
  }
  return righe;
}

/** Il foglio di un mazzo: righe, stili e larghezze, pronti per scriviXlsx. */
export function foglioDelMazzo(mazzo, tutte) {
  const conta = new Map(mazzo.cards.map(c => [c.card, c.count]));
  const rubyfront = [...conta.keys()].filter(id => tutte.get(id)?.d.type === "rubyfront");
  const righe = [];
  const stili = {};
  const scrivi = (celle, stile) => {
    if (stile) stili[righe.length] = stile;
    righe.push(celle);
  };

  const loc = mazzo.locales.it;
  const copie = [...conta].filter(([id]) => !rubyfront.includes(id)).reduce((n, [, c]) => n + c, 0);
  scrivi([`RUBYFRONT — ${loc.name.toUpperCase()}`], "titolo");
  scrivi([loc.description]);
  scrivi([`${copie} carte + Rubyfront/Nexus (in fondo al foglio)`]);
  scrivi([]);

  const carteMazzo = [...conta]
    .filter(([id]) => !rubyfront.includes(id))
    .map(([id, n]) => rigaCarta(tutte.get(id), n));

  for (const categoria of ORDINE) {
    const gruppo = carteMazzo
      .filter(r => r[2] === categoria)
      .sort((x, y) => (x[3] || 0) - (y[3] || 0) || String(x[1]).localeCompare(String(y[1]), "it"));
    if (!gruppo.length) continue;
    scrivi([`${categoria} — ${gruppo.length} carte, ${gruppo.reduce((n, r) => n + r[0], 0)} copie`], "sezione");
    scrivi(INTESTAZIONE, "intestazione");
    for (const r of gruppo) scrivi(r);
    scrivi([]);
    scrivi([]);
  }
  for (const id of rubyfront) {
    for (const { celle, stile } of righeRubyfront(tutte.get(id))) scrivi(celle, stile);
  }
  return { nome: loc.name, righe, stili, larghezze: LARGHEZZE };
}

/**
 * Il verso opposto: un foglio → il mazzo che descrive. Si riconoscono le
 * righe carta (la prima cella è un numero e c'è un nome) e il blocco
 * Rubyfront/Nexus, che parte dalla sua fascia e arriva in fondo.
 */
export function mazzoDalFoglio(foglio) {
  const carteFoglio = [];
  const rubyfront = [];
  let dentroRubyfront = false;
  for (const riga of foglio.righe) {
    const celle = (riga ?? []).map(c => String(c ?? "").trim());
    const prima = celle[0] ?? "";
    if (/^RUBYFRONT \/ NEXUS/i.test(prima)) { dentroRubyfront = true; }
    if (dentroRubyfront) {
      if (prima || celle[1]) rubyfront.push([prima, celle[1] ?? ""]);
      continue;
    }
    if (prima === "Copie" || !prima) continue;
    if (!/^\d+$/.test(prima) || !celle[1]) continue;
    carteFoglio.push({
      copie: Number(prima), nome: celle[1], categoria: celle[2] ?? "", costo: celle[3] ?? "",
      potenza: celle[4] ?? "", razza: celle[5] ?? "", materia: celle[6] ?? "",
      tipo: celle[7] ?? "", effetto: (celle[8] ?? "").replace(/\r\n/g, "\n"),
    });
  }
  const titolo = String(foglio.righe[0]?.[0] ?? "").replace(/^RUBYFRONT\s+—\s*/i, "").trim();
  return { nome: foglio.nome, titolo, carte: carteFoglio, rubyfront };
}

/** Confronta il foglio col catalogo. Ritorna un elenco di differenze leggibili. */
export function confronta(dalFoglio, mazzo, tutte) {
  const differenze = [];
  const conta = new Map((mazzo?.cards ?? []).map(c => [c.card, c.count]));
  const perNome = new Map();
  for (const [id, n] of conta) {
    const carta = tutte.get(id);
    // Il Rubyfront non è una riga carta: sta nel blocco in fondo, e si
    // confronta lì.
    if (carta && carta.d.type !== "rubyfront") perNome.set(chiave(carta.it.name), { carta, copie: n });
  }

  const visti = new Set();
  for (const riga of dalFoglio.carte) {
    const nome = chiave(riga.nome);
    const nel = perNome.get(nome);
    if (!nel) {
      const altrove = [...tutte.values()].find(c => chiave(c.it.name) === nome);
      differenze.push({
        carta: riga.nome,
        tipo: altrove ? "aggiunta al mazzo" : "carta nuova",
        note: altrove ? [`${altrove.id} esiste in catalogo, ${riga.copie} copie`] : [`${riga.copie} copie, ${riga.categoria || "categoria da leggere"}`],
      });
      continue;
    }
    visti.add(nome);
    const atteso = rigaCarta(nel.carta, nel.copie);
    const campi = [
      ["copie", String(riga.copie), String(atteso[0])],
      ["costo", riga.costo, String(atteso[3] ?? "")],
      ["Potenza", riga.potenza, String(atteso[4] ?? "")],
      ["razza", riga.razza, String(atteso[5] ?? "")],
      ["Materia", riga.materia, String(atteso[6] ?? "")],
      ["tipo / keyword", riga.tipo, String(atteso[7] ?? "")],
      ["effetto", riga.effetto, String(atteso[8] ?? "")],
    ];
    const note = campi
      .filter(([, foglio, catalogo]) => foglio.replace(/\s+/g, " ").trim() !== catalogo.replace(/\s+/g, " ").trim())
      .map(([nome, foglio, catalogo]) => `${nome}: foglio «${foglio}» — catalogo «${catalogo}»`);
    if (note.length) differenze.push({ carta: `${nel.carta.id} ${riga.nome}`, tipo: "cambiata", note });
  }
  for (const [nome, nel] of perNome) {
    if (!visti.has(nome)) {
      differenze.push({ carta: `${nel.carta.id} ${nel.carta.it.name}`, tipo: "non è più nel foglio", note: [`nel catalogo ha ${nel.copie} copie`] });
    }
  }

  // Il blocco in fondo: PV, schieramento, Furia, requisito del flip, le due
  // facce e le loro abilità. Si confrontano etichetta per etichetta, che è
  // come stanno scritte sul foglio.
  const rf = [...conta.keys()].map(id => tutte.get(id)).find(c => c?.d.type === "rubyfront");
  if (rf) {
    const attese = righeRubyfront(rf)
      .map(r => r.celle)
      .filter(celle => celle.length >= 2 && String(celle[0]).trim())
      .map(celle => [String(celle[0]).trim(), String(celle[1] ?? "").trim()]);
    const dal = dalFoglio.rubyfront.filter(([e, v]) => e && v);
    const note = [];
    const massimo = Math.max(attese.length, dal.length);
    for (let i = 0; i < massimo; i += 1) {
      const [etichettaA, valoreA] = attese[i] ?? ["—", ""];
      const [etichettaB, valoreB] = dal[i] ?? ["—", ""];
      const pulisci = t => t.replace(/\s+/g, " ").trim();
      if (pulisci(etichettaA) !== pulisci(etichettaB) || pulisci(valoreA) !== pulisci(valoreB)) {
        note.push(`${etichettaB || etichettaA}: foglio «${pulisci(valoreB)}» — catalogo «${pulisci(valoreA)}»`);
      }
    }
    if (note.length) differenze.push({ carta: `${rf.id} ${rf.it.name}`, tipo: "Rubyfront / Nexus", note });
  }
  return differenze;
}
