import catalog, { getCardById, getSetById, getDeckById } from "../catalog.js";
import { DEFAULT_THEME, isThemeId, LIGHT_THEMES, THEMES } from "./themes.js";
import {
  breadcrumb,
  cardRoute,
  catalogRoute,
  copyFor,
  element,
  FALLBACK_LOCALE,
  languagePicker,
  link,
  pageHeader,
  renderRegistryError,
  setUrlParameter,
  themedCardRoute,
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
  // Il tema del mazzo da cui si arriva (?deck) vale come default, così una
  // carta aperta dal mazzo Umani nasce già col suo tema.
  const themeFromDeck = getDeckById(params.get("deck"))?.theme;
  let themeId = isThemeId(params.get("theme")) ? params.get("theme")
    : (isThemeId(themeFromDeck) ? themeFromDeck : DEFAULT_THEME);

  // Elenco per le frecce precedente/successiva: le carte del MAZZO se la
  // visuale è stata aperta da un mazzo (?deck), altrimenti quelle del set.
  // Cicla dall'ultima alla prima. Tema, lingua e mazzo restano nei link.
  const deckId = params.get("deck");
  const deck = deckId ? getDeckById(deckId) : undefined;
  let deckSiblings;
  if (deck && Array.isArray(deck.cards)) {
    const seen = new Set();
    deckSiblings = [];
    for (const entry of deck.cards) {
      if (!entry || seen.has(entry.card)) continue;
      seen.add(entry.card);
      const sibling = getCardById(entry.card);
      if (sibling) deckSiblings.push(sibling);
    }
  }
  const inDeck = Boolean(deckSiblings && deckSiblings.some(entry => entry.id === resource.id));
  const list = inDeck ? deckSiblings : ((getSetById(resource.setId)?.cards) ?? []);
  const navDeckId = inDeck ? deckId : undefined;
  const currentIndex = list.findIndex(entry => entry.id === resource.id);
  const prevCard = list.length > 1 ? list[(currentIndex - 1 + list.length) % list.length] : null;
  const nextCard = list.length > 1 ? list[(currentIndex + 1) % list.length] : null;

  // Frecce da tastiera: ← precedente, → successiva (tema/lingua/mazzo intatti).
  if (prevCard || nextCard) {
    document.addEventListener("keydown", event => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (event.key === "ArrowLeft" && prevCard) location.href = themedCardRoute(prevCard, localeId, themeId, navDeckId);
      else if (event.key === "ArrowRight" && nextCard) location.href = themedCardRoute(nextCard, localeId, themeId, navDeckId);
    });
  }

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
  const pagerTop = element("nav", "card-pager");
  const pagerBottom = element("nav", "card-pager");
  page.append(trail, header, controls, pagerTop, table, pagerBottom);
  app.replaceChildren(page);

  // Frecce visuali sopra e sotto le carte, ricostruite a ogni cambio di
  // lingua e di tema (tema, lingua e mazzo finiscono negli href).
  const renderPagers = () => {
    if (!prevCard && !nextCard) return;
    const copy = copyFor(localeId);
    const side = (sibling, dir) => {
      if (!sibling) return element("span", "pager-link empty");
      const name = localized(sibling, localeId).name;
      const anchor = link(`pager-link ${dir}`, "", themedCardRoute(sibling, localeId, themeId, navDeckId));
      anchor.setAttribute("aria-label", `${dir === "prev" ? copy.previous : copy.next}: ${name}`);
      const arrow = element("span", "pager-arrow", dir === "prev" ? "←" : "→");
      const label = element("span", "pager-name", name);
      anchor.append(...(dir === "prev" ? [arrow, label] : [label, arrow]));
      return anchor;
    };
    for (const container of [pagerTop, pagerBottom]) {
      container.setAttribute("aria-label", copy.cardNav);
      container.replaceChildren(side(prevCard, "prev"), side(nextCard, "next"));
    }
  };

  function applyLocale(nextLocaleId) {
    localeId = resource.locales[nextLocaleId] ? nextLocaleId : resource.defaultLocale;
    const cardCopy = localized(resource, localeId);
    const copy = copyFor(localeId);
    document.documentElement.lang = localeId;
    document.title = `${cardCopy.name} · ${copy.themes}`;

    trail.replaceChildren(...breadcrumb([
      { label: copy.catalog, href: catalogRoute(localeId) },
      { label: cardCopy.name, href: cardRoute(resource, localeId, navDeckId) },
      { label: copy.themes }
    ]).childNodes);

    header.querySelector("h1").textContent = cardCopy.name;
    themeLabel.textContent = copy.theme;
    back.textContent = copy.cardData;
    back.href = cardRoute(resource, localeId, navDeckId);
    themesLink.textContent = copy.themeIndex;
    themesLink.href = themeIndexRoute(resource, localeId);
    languageSlot.replaceChildren(languagePicker(resource, localeId, applyLocale));

    table.replaceChildren(...resource.faces.map(face => createFace(resource, face, cardCopy, themeId, localeId)));
    fitTextBoxes(table);
    renderPagers();
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
    renderPagers();
    setUrlParameter("theme", themeId);
  }

  themeSelect.addEventListener("change", event => applyTheme(event.target.value));
  applyLocale(localeId);
  applyTheme(themeId);
}

