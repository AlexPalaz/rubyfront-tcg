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
  const hint = element("code");
  controls.append(themeLabel, themeSelect, languageSlot, hint);

  const grid = element("section", "deck-grid");
  grid.setAttribute("aria-label", "Deck list");
  page.append(trail, header, controls, grid);
  app.replaceChildren(page);

  const totalCards = resource.cards.reduce((sum, entry) => sum + entry.count, 0);

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
    languageSlot.replaceChildren(languagePicker(resource, localeId, applyLocale));

    grid.replaceChildren();
    for (const entry of resource.cards) {
      const card = getCardById(entry.card);
      if (!card) continue;
      const cardCopy = localized(card, localeId);
      for (const face of card.faces) {
        const tile = element("div", "deck-tile");
        const anchor = element("a");
        anchor.href = cardRoute(card, localeId);
        anchor.title = cardCopy.name;
        const holder = element("div", "deck-holder");
        holder.append(createFace(card, face, cardCopy, themeId));
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
}
