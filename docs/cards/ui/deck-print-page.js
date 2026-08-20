// Pagina di stampa dei proxy: impagina TUTTE le carte fisiche di un mazzo
// (3x -> 3 carte; il Rubyfront bifronte -> le due facce) su fogli A4 visibili
// a schermo, 9 per foglio a misura reale 63×88 mm con crocini di taglio, e
// offre "Salva PDF" (dialogo di stampa del browser). Il foglio è l'unica cosa
// che va in stampa, la barra degli strumenti sparisce.
import catalog, { getCardById } from "../catalog.js";
import { DEFAULT_THEME, isThemeId, LIGHT_THEMES, THEMES } from "./themes.js";
import { copyFor, deckRoute, element, FALLBACK_LOCALE, renderRegistryError, setUrlParameter } from "./shell.js";
import { createFace, localized, fitTextBoxes } from "./card-render.js";

const PER_PAGE = 9;
const params = new URLSearchParams(location.search);
const requestedDeckId = params.get("deck");
const deck = requestedDeckId
  ? (catalog.decks ?? []).find(candidate => candidate.id === requestedDeckId)
  : (catalog.decks ?? [])[0];
const app = document.querySelector("#app");

if (!deck) {
  renderRegistryError(app, copyFor(FALLBACK_LOCALE).catalogEmpty);
} else {
  renderPrintPage(deck);
}

function buildSheet(resource, localeId, themeId) {
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
        const visual = createFace(card, face, cardCopy, themeId, localeId);
        holder.append(visual);
        const clip = element("div", "print-clip");
        clip.append(holder);
        cell.append(clip);
        for (const corner of ["tl", "tr", "bl", "br"]) cell.append(element("span", `crop ${corner}`));
        cells.push(cell);
      }
    }
  }
  const pageCount = Math.ceil(cells.length / PER_PAGE);
  for (let i = 0; i < cells.length; i += PER_PAGE) {
    const page = element("section", "print-page");
    page.append(...cells.slice(i, i + PER_PAGE));
    page.append(element("span", "page-number", `${i / PER_PAGE + 1} / ${pageCount}`));
    sheet.append(page);
  }
  for (const visual of sheet.querySelectorAll(".card")) {
    visual.classList.add(themeId);
    if (LIGHT_THEMES.has(themeId)) visual.classList.add("light-theme");
  }
  return { sheet, cards: cells.length, pages: pageCount };
}

function renderPrintPage(resource) {
  const localeId = resource.locales[params.get("lang")] ? params.get("lang") : resource.defaultLocale;
  let themeId = isThemeId(params.get("theme")) ? params.get("theme") : DEFAULT_THEME;
  const copy = copyFor(localeId);
  const deckCopy = localized(resource, localeId);
  document.documentElement.lang = localeId;
  document.title = `${deckCopy.name} · ${copy.printTitle}`;

  const toolbar = element("div", "print-toolbar");
  const back = element("a", "button secondary", `← ${copy.deck}`);
  back.href = deckRoute(resource, localeId);
  const title = element("h1", "", deckCopy.name);
  const summary = element("span", "muted");

  const themeLabel = element("label", "", `${copy.theme} `);
  const themeSelect = element("select");
  for (const [id, name] of THEMES) {
    const option = element("option", "", `${id} · ${name}`);
    option.value = id;
    themeSelect.append(option);
  }
  themeSelect.value = themeId;
  themeLabel.append(themeSelect);

  const marksLabel = element("label");
  const marksSelect = element("select");
  for (const [value, text] of [["crop", copy.printMarksCrop], ["guides", copy.printMarksGuides], ["none", copy.printMarksNone]]) {
    const option = element("option", "", text);
    option.value = value;
    marksSelect.append(option);
  }
  marksLabel.append(`${copy.printMarks} `, marksSelect);

  const gapLabel = element("label");
  const gapSelect = element("select");
  for (const [value, text] of [["4", "4 mm"], ["2", "2 mm"], ["0", "0 mm"]]) {
    const option = element("option", "", text);
    option.value = value;
    gapSelect.append(option);
  }
  gapLabel.append(`${copy.printGap} `, gapSelect);

  // ?mode=borderless: carte attaccate (spazio 0) e nessun segno di taglio.
  if (params.get("mode") === "borderless") {
    gapSelect.value = "0";
    marksSelect.value = "none";
  }

  const printBtn = element("button", "button", copy.printSave);
  printBtn.type = "button";
  printBtn.addEventListener("click", () => window.print());
  const hint = element("span", "hint", copy.printHint);
  toolbar.append(back, title, summary, themeLabel, marksLabel, gapLabel, element("span", "spacer"), printBtn, hint);

  let sheet = null;
  function rebuild() {
    sheet?.remove();
    const built = buildSheet(resource, localeId, themeId);
    sheet = built.sheet;
    applyOptions();
    app.append(sheet);
    fitTextBoxes(sheet);
    summary.textContent = copy.printSummary(built.cards, built.pages);
  }
  function applyOptions() {
    if (!sheet) return;
    sheet.classList.toggle("no-crop", marksSelect.value !== "crop");
    sheet.classList.toggle("guides", marksSelect.value === "guides");
    sheet.style.setProperty("--gap", `${gapSelect.value}mm`);
  }

  themeSelect.addEventListener("change", () => {
    themeId = isThemeId(themeSelect.value) ? themeSelect.value : DEFAULT_THEME;
    setUrlParameter("theme", themeId);
    rebuild();
  });
  marksSelect.addEventListener("change", applyOptions);
  gapSelect.addEventListener("change", applyOptions);

  app.replaceChildren(toolbar);
  setUrlParameter("deck", resource.id);
  setUrlParameter("lang", localeId);
  rebuild();
}
