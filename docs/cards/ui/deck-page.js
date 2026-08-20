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
  element,
  FALLBACK_LOCALE,
  languagePicker,
  metadataList,
  pageHeader,
  renderRegistryError,
  setUrlParameter
} from "./shell.js";
import { createFace, localized, fitTextBoxes } from "./card-render.js";

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

// Foglio di stampa per proxy: una cella 63×88 mm per OGNI copia fisica di
// ogni faccia (3x -> 3 carte; il Rubyfront bifronte -> le due facce), 9 per
// pagina A4, con crocini di taglio. Si stampa nel tema corrente e si salva
// come PDF dal dialogo del browser. Il foglio è costruito al volo, tenuto
// fuori vista mentre il fit del testo misura, e rimosso dopo la stampa.
function printDeckSheet(resource, localeId, themeId, { open = true } = {}) {
  document.querySelector("#print-sheet")?.remove();
  const sheet = element("div");
  sheet.id = "print-sheet";
  const cells = [];
  for (const entry of resource.cards) {
    const card = getCardById(entry.card);
    if (!card) continue;
    const cardCopy = localized(card, localeId);
    for (let copy = 0; copy < entry.count; copy += 1) {
      for (const face of card.faces) {
        const cell = element("div", "print-cell");
        const holder = element("div", "print-holder");
        holder.append(createFace(card, face, cardCopy, themeId, localeId));
        const clip = element("div", "print-clip");
        clip.append(holder);
        cell.append(clip);
        for (const corner of ["tl", "tr", "bl", "br"]) cell.append(element("span", `crop ${corner}`));
        cells.push(cell);
      }
    }
  }
  for (let i = 0; i < cells.length; i += 9) {
    const page = element("section", "print-page");
    page.append(...cells.slice(i, i + 9));
    sheet.append(page);
  }
  document.body.append(sheet);
  for (const visual of sheet.querySelectorAll(".card")) {
    visual.classList.add(themeId);
    if (LIGHT_THEMES.has(themeId)) visual.classList.add("light-theme");
  }
  fitTextBoxes(sheet);
  if (!open) return sheet;
  const cleanup = () => { sheet.remove(); window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  window.print();
  return sheet;
}

function renderDeck(resource) {
  let localeId = localeFromParams(resource);
  let themeId = isThemeId(params.get("theme")) ? params.get("theme") : DEFAULT_THEME;

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
  const printBtn = element("button", "button deck-print");
  printBtn.type = "button";
  printBtn.addEventListener("click", () => printDeckSheet(resource, localeId, themeId));
  const hint = element("code");
  controls.append(themeLabel, themeSelect, languageSlot, downloadBtn, printBtn, hint);

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
    printBtn.title = copy.printHint;
    languageSlot.replaceChildren(languagePicker(resource, localeId, applyLocale));

    grid.replaceChildren();
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
        holder.append(createFace(card, face, cardCopy, themeId, localeId));
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
    setUrlParameter("theme", themeId);
  }

  themeSelect.addEventListener("change", event => applyTheme(event.target.value));
  applyLocale(localeId);
  // ?print=1 prepara subito il foglio per proxy (utile per Cmd+P o per la
  // generazione headless del PDF) senza aprire il dialogo.
  if (params.get("print") === "1") printDeckSheet(resource, localeId, themeId, { open: false });
}
