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
  pageHeader,
  renderRegistryError,
  setUrlParameter,
  themeIndexRoute
} from "./shell.js";
import { createFace, localized, fitTextBoxes } from "./card-render.js";

const params = new URLSearchParams(location.search);
const requestedCardId = params.get("card");
const card = requestedCardId ? getCardById(requestedCardId) : catalog.cards[0];
const app = document.querySelector("#app");

if (!card) {
  const copy = copyFor(FALLBACK_LOCALE);
  renderRegistryError(app, requestedCardId ? copy.cardMissing(requestedCardId) : copy.catalogEmpty);
} else {
  renderCard(card);
}

function localeFromParams(resource) {
  const requested = params.get("lang");
  return resource.locales[requested] ? requested : resource.defaultLocale;
}

function renderCard(resource) {
  let localeId = localeFromParams(resource);
  let themeId = isThemeId(params.get("theme")) ? params.get("theme") : DEFAULT_THEME;

  const page = element("main", "page-shell wide");
  const trail = breadcrumb([{ label: "…", href: catalogRoute(localeId) }]);
  const header = pageHeader({
    eyebrow: `${resource.id} · ${resource.layout}`,
    title: ""
  });
  const nav = element("nav", "quick-links");
  const back = element("a", "button secondary");
  const themesLink = element("a", "button secondary");
  nav.append(back, themesLink);
  header.append(nav);

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

  const table = element("section", "table");
  table.setAttribute("aria-label", "Card faces");
  page.append(trail, header, controls, table);
  app.replaceChildren(page);

  function applyLocale(nextLocaleId) {
    localeId = resource.locales[nextLocaleId] ? nextLocaleId : resource.defaultLocale;
    const cardCopy = localized(resource, localeId);
    const copy = copyFor(localeId);
    document.documentElement.lang = localeId;
    document.title = `${cardCopy.name} · ${copy.themes}`;

    trail.replaceChildren(...breadcrumb([
      { label: copy.catalog, href: catalogRoute(localeId) },
      { label: cardCopy.name, href: cardRoute(resource, localeId) },
      { label: copy.themes }
    ]).childNodes);

    header.querySelector("h1").textContent = cardCopy.name;
    themeLabel.textContent = copy.theme;
    back.textContent = copy.cardData;
    back.href = cardRoute(resource, localeId);
    themesLink.textContent = copy.themeIndex;
    themesLink.href = themeIndexRoute(resource, localeId);
    languageSlot.replaceChildren(languagePicker(resource, localeId, applyLocale));

    table.replaceChildren(...resource.faces.map(face => createFace(resource, face, cardCopy, themeId)));
    fitTextBoxes(table);
    setUrlParameter("card", resource.id);
    setUrlParameter("lang", localeId);
  }

  function applyTheme(nextThemeId) {
    themeId = isThemeId(nextThemeId) ? nextThemeId : DEFAULT_THEME;
    for (const visual of table.querySelectorAll(".card")) {
      visual.classList.remove(...THEMES.map(([id]) => id), "light-theme");
      visual.classList.add(themeId);
      if (LIGHT_THEMES.has(themeId)) visual.classList.add("light-theme");
    }
    themeSelect.value = themeId;
    hint.textContent = `?card=${resource.id}&theme=${themeId}`;
    setUrlParameter("theme", themeId);
  }

  themeSelect.addEventListener("change", event => applyTheme(event.target.value));
  applyLocale(localeId);
  applyTheme(themeId);
}

