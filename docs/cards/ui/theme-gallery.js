import catalog, { getCardById } from "../catalog.js";
import { THEMES } from "./themes.js";
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
  themedCardRoute,
  updateLanguage
} from "./shell.js";

const params = new URLSearchParams(location.search);
const requestedCardId = params.get("card");
const card = requestedCardId ? getCardById(requestedCardId) : catalog.cards[0];
const app = document.querySelector("#app");

if (!card) {
  const copy = copyFor(FALLBACK_LOCALE);
  renderRegistryError(app, requestedCardId ? copy.cardMissing(requestedCardId) : copy.catalogEmpty);
} else {
  render(card);
}

function render(resource) {
  const requested = params.get("lang");
  let localeId = resource.locales[requested] ? requested : resource.defaultLocale;

  const draw = () => {
    updateLanguage(localeId);
    const copy = copyFor(localeId);
    const cardCopy = resource.locales[localeId];
    document.title = `${cardCopy.name} · ${copy.themes}`;

    const page = element("main", "page-shell");
    page.append(breadcrumb([
      { label: copy.catalog, href: catalogRoute(localeId) },
      { label: cardCopy.name, href: cardRoute(resource, localeId) },
      { label: copy.themes }
    ]));

    page.append(pageHeader({
      eyebrow: `${resource.id} · ${resource.layout}`,
      title: copy.themes,
      lede: copy.themeGalleryLede(cardCopy.name),
      resource,
      localeId,
      onLocaleChange: next => {
        localeId = next;
        draw();
      }
    }));

    const grid = element("section", "theme-gallery");
    grid.setAttribute("aria-label", copy.themeList);
    for (const [id, name] of THEMES) {
      const tile = element("a", "theme-tile");
      tile.href = themedCardRoute(resource, localeId, id);
      tile.append(
        element("span", "theme-id", id),
        element("strong", "theme-name", name),
        element("span", "theme-card-name", cardCopy.name)
      );
      grid.append(tile);
    }
    page.append(grid);

    app.replaceChildren(page);
  };

  draw();
}
