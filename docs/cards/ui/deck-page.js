// Pagina del mazzo: la lista di un mazzo (data/decks/*) resa con le carte
// vere in miniatura, disposte in griglia. Ogni tessera riusa il renderer
// condiviso (card-render.js) alla scala definita in deck.html.
import catalog, { getCardById } from "../catalog.js";
import { DEFAULT_THEME, isThemeId, LIGHT_THEMES, THEMES } from "./themes.js";
import {
  breadcrumb,
  cardRoute,
  catalogRoute,
  copyFor,
  deckPrintRoute,
  element,
  FALLBACK_LOCALE,
  languagePicker,
  metadataList,
  pageHeader,
  renderRegistryError,
  setUrlParameter
} from "./shell.js";
import { createFace, localized, fitTextBoxes, faceToText } from "./card-render.js";

// Tutte le illustrazioni partono subito — niente lazy: rimandare il
// download le faceva comparire mentre l'occhio era già lì. A ordinare la
// coda pensa la priorità: le prime tessere in alta, le altre in bassa, così
// il browser dipinge presto ciò che si vede e intanto scarica il resto.
const EAGER_TILES = 8;

function lowerArtPriority(visual) {
  for (const image of visual.querySelectorAll("img")) image.fetchPriority = "low";
}

const params = new URLSearchParams(location.search);
const requestedDeckId = params.get("deck");
const deck = requestedDeckId
  ? (catalog.decks ?? []).find(candidate => candidate.id === requestedDeckId)
  : (catalog.decks ?? [])[0];
const app = document.querySelector("#app");

if (!deck) {
  const copy = copyFor(FALLBACK_LOCALE);
  renderRegistryError(app, copy.catalogEmpty);
} else {
  renderDeck(deck);
}

function localeFromParams(resource) {
  const requested = params.get("lang");
  return resource.locales[requested] ? requested : resource.defaultLocale;
}

// Lista testuale del mazzo: intestazione + una sezione per tipo di carta.
function buildDeckText(resource, localeId) {
  const en = localeId === "en";
  // 40 carte + Rubyfront (§3.1): l'intestazione conta le sole carte del mazzo.
  const total = resource.cards.reduce((sum, entry) => {
    const card = getCardById(entry.card);
    return card && card.type === "rubyfront" ? sum : sum + entry.count;
  }, 0);
  const headings = en
    ? { rubyfront: "Rubyfront", entity: "Entities", matter: "Matters", object: "Objects" }
    : { rubyfront: "Rubyfront", entity: "Entità", matter: "Materie", object: "Oggetti" };
  const groups = {};
  for (const entry of resource.cards) {
    const card = getCardById(entry.card);
    if (!card) continue;
    if (!groups[card.type]) groups[card.type] = [];
    groups[card.type].push({ count: entry.count, id: card.id, name: localized(card, localeId).name });
  }
  const lines = [`${localized(resource, localeId).name} — ${total} ${en ? "cards" : "carte"} + Rubyfront`, ""];
  for (const type of ["rubyfront", "entity", "matter", "object"]) {
    const list = groups[type];
    if (!list || !list.length) continue;
    const groupTotal = list.reduce((sum, card) => sum + card.count, 0);
    lines.push(`# ${headings[type] ?? type} (${groupTotal})`);
    for (const card of list) lines.push(`${card.count}x ${card.id} ${card.name}`);
    lines.push("");
  }

  // Dettaglio carta per carta: il testo è preso dalla carta RESA dal renderer
  // (stesso ordine, stesse parole di ciò che è stampato), una sezione per
  // carta, una sotto-sezione per faccia.
  lines.push("", `## ${en ? "Card details" : "Dettaglio carte"}`, "");
  const scratch = element("div");
  scratch.style.cssText = "position:absolute;left:-20000px;top:0";
  document.body.append(scratch);
  for (const entry of resource.cards) {
    const card = getCardById(entry.card);
    if (!card) continue;
    const cardCopy = localized(card, localeId);
    lines.push(`${card.id} · ${cardCopy.name} (${entry.count}x) — ${cardCopy.typeLabel ?? ""}`.replace(/ — $/, ""));
    for (const face of card.faces) {
      scratch.replaceChildren(createFace(card, face, cardCopy, DEFAULT_THEME, localeId));
      const visual = scratch.querySelector(".card");
      const faceLines = faceToText(visual, cardCopy);
      if (card.faces.length > 1) lines.push(`  [${cardCopy.ui?.[face.displayKey] ?? face.id}]`);
      lines.push(...faceLines.map(line => (card.faces.length > 1 ? "  " : "") + line));
    }
    lines.push("");
  }
  scratch.remove();
  return lines.join("\n").trimEnd() + "\n";
}

// Genera il file .txt e avvia il download del browser.
function downloadDeckText(resource, localeId) {
  const blob = new Blob([buildDeckText(resource, localeId)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${resource.id}.txt`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function renderDeck(resource) {
  let localeId = localeFromParams(resource);
  // Precedenza: tema chiesto nell'URL, poi quello dichiarato dal mazzo
  // (campo `theme` nei dati), poi il default globale.
  let themeId = isThemeId(params.get("theme")) ? params.get("theme")
    : (isThemeId(resource.theme) ? resource.theme : DEFAULT_THEME);

  const page = element("main", "page-shell wide");
  const trail = breadcrumb([{ label: "…", href: catalogRoute(localeId) }]);
  const header = pageHeader({ eyebrow: "", title: "" });
  const meta = element("div");
  header.append(meta);

  const controls = element("div", "controls");
  const themeLabel = element("label");
  themeLabel.htmlFor = "theme";
  const themeSelect = element("select");
  themeSelect.id = "theme";
  for (const [id, name] of THEMES) {
    const option = element("option", "", `${id} · ${name}`);
    option.value = id;
    themeSelect.append(option);
  }
  const languageSlot = element("span");
  const downloadBtn = element("button", "button secondary deck-download");
  downloadBtn.type = "button";
  downloadBtn.addEventListener("click", () => downloadDeckText(resource, localeId));
  // La stampa dei proxy ha una pagina sua (deck-print.html): i fogli A4 si
  // vedono a schermo prima di salvare il PDF.
  const printBtn = element("a", "button deck-print");
  printBtn.target = "_blank";
  // Variante "senza bordi": carte attaccate, zero spazio, niente crocini
  // (si taglia lungo le linee di contatto).
  const printBorderlessBtn = element("a", "button deck-print");
  printBorderlessBtn.target = "_blank";
  const hint = element("code");
  controls.append(themeLabel, themeSelect, languageSlot, downloadBtn, printBtn, printBorderlessBtn, hint);

  const grid = element("section", "deck-grid");
  grid.setAttribute("aria-label", "Deck list");
  page.append(trail, header, controls, grid);
  app.replaceChildren(page);

  // Il Rubyfront non conta nelle 40 (§3.1): il conteggio mostrato è delle
  // sole carte del mazzo, la bestia è la quarantunesima.
  const totalCards = resource.cards.reduce((sum, entry) => {
    const card = getCardById(entry.card);
    return card && card.type === "rubyfront" ? sum : sum + entry.count;
  }, 0);

  function applyLocale(nextLocaleId) {
    localeId = resource.locales[nextLocaleId] ? nextLocaleId : resource.defaultLocale;
    const deckCopy = localized(resource, localeId);
    const copy = copyFor(localeId);
    document.documentElement.lang = localeId;
    document.title = `${deckCopy.name} · ${copy.deck}`;

    trail.replaceChildren(...breadcrumb([
      { label: copy.catalog, href: catalogRoute(localeId) },
      { label: deckCopy.name }
    ]).childNodes);

    header.querySelector(".eyebrow").textContent = `${copy.deck} · ${copy.deckCount(totalCards)}`;
    header.querySelector("h1").textContent = deckCopy.name;
    let lede = header.querySelector(".lede");
    if (!lede) {
      lede = element("p", "lede");
      header.querySelector("h1").after(lede);
    }
    lede.textContent = deckCopy.description;
    meta.replaceChildren(metadataList([
      [copy.status, copy[resource.status] ?? resource.status]
    ]));
    themeLabel.textContent = copy.theme;
    downloadBtn.textContent = copy.downloadDeck;
    printBtn.textContent = copy.printDeck;
    printBorderlessBtn.textContent = copy.printDeckBorderless;
    printBtn.href = deckPrintRoute(resource, localeId, themeId);
    printBorderlessBtn.href = deckPrintRoute(resource, localeId, themeId, "borderless");
    languageSlot.replaceChildren(languagePicker(resource, localeId, applyLocale));

    grid.replaceChildren();
    let tileIndex = 0;
    for (const entry of resource.cards) {
      const card = getCardById(entry.card);
      if (!card) continue;
      const cardCopy = localized(card, localeId);
      for (const face of card.faces) {
        const tile = element("div", "deck-tile");
        const anchor = element("a");
        anchor.href = cardRoute(card, localeId, resource.id);
        anchor.title = cardCopy.name;
        const holder = element("div", "deck-holder");
        const visual = createFace(card, face, cardCopy, themeId, localeId);
        holder.append(visual);
        if (tileIndex >= EAGER_TILES) lowerArtPriority(visual);
        tileIndex += 1;
        anchor.append(holder);
        tile.append(anchor, element("span", "deck-count", `×${entry.count}`));
        grid.append(tile);
      }
    }
    applyTheme(themeId);
    fitTextBoxes(grid);
    setUrlParameter("deck", resource.id);
    setUrlParameter("lang", localeId);
  }

  function applyTheme(nextThemeId) {
    themeId = isThemeId(nextThemeId) ? nextThemeId : DEFAULT_THEME;
    for (const visual of grid.querySelectorAll(".card")) {
      visual.classList.remove(...THEMES.map(([id]) => id), "light-theme");
      visual.classList.add(themeId);
      if (LIGHT_THEMES.has(themeId)) visual.classList.add("light-theme");
    }
    themeSelect.value = themeId;
    hint.textContent = `?deck=${resource.id}&theme=${themeId}`;
    printBtn.href = deckPrintRoute(resource, localeId, themeId);
    printBorderlessBtn.href = deckPrintRoute(resource, localeId, themeId, "borderless");
    setUrlParameter("theme", themeId);
  }

  themeSelect.addEventListener("change", event => applyTheme(event.target.value));
  applyLocale(localeId);
}
