import { localize, resolveSource } from "../catalog.js";
import {
  breadcrumb,
  cardRoute,
  catalogRoute,
  element,
  languagePicker,
  link,
  metadataList,
  pageHeader,
  renderWithLanguage,
  setRoute,
  themedCardRoute
} from "./shell.js";

function cardRow(card, localeId, copy) {
  const locale = localize(card, localeId);
  const row = element("article", "card-row");
  const number = element("div", "collector-number", card.collectorNumber);
  const content = element("div", "card-row-content");
  const title = link("card-row-title", locale.name, cardRoute(card, localeId));
  const meta = element("div", "card-row-meta", `${locale.typeLabel} · ${copy[card.status]}`);
  const summary = element("p", "card-row-summary", locale.summary);
  const action = link("button secondary", copy.openCard, cardRoute(card, localeId));
  content.append(title, meta, summary);
  row.append(number, content, action);
  return row;
}

function normalizeSearch(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

function searchableCardText(card, set, localeId, copy) {
  const cardText = localize(card, localeId);
  const setText = localize(set, localeId);
  const allLocalizedCardText = Object.values(card.locales).flatMap(locale => [locale.name, locale.typeLabel, locale.summary]);
  const allLocalizedSetText = Object.values(set.locales).flatMap(locale => [locale.name, locale.description]);
  const mechanicTerms = card.faces.flatMap(face => [
    face.id,
    face.kind,
    ...face.enablesMatters.flatMap(matter => [matter.type, copy.matterNames[matter.type]]),
    ...face.keywords.map(keyword => keyword.id),
    ...face.triggers.map(trigger => trigger.id),
    ...face.actions.map(action => action.id)
  ]);
  return normalizeSearch([
    card.id,
    card.collectorNumber,
    card.slug,
    card.type,
    copy[card.status],
    ...card.tags,
    cardText.name,
    cardText.typeLabel,
    cardText.summary,
    set.id,
    set.code,
    setText.name,
    setText.description,
    ...allLocalizedCardText,
    ...allLocalizedSetText,
    ...mechanicTerms
  ].join(" "));
}

function globalCardRow(card, set, localeId, copy) {
  const cardText = localize(card, localeId);
  const setText = localize(set, localeId);
  const row = element("article", "global-card-row");
  const identity = element("div", "global-card-identity");
  identity.append(
    element("span", "global-card-id", card.id),
    link("global-card-title", cardText.name, cardRoute(card, localeId)),
    element("p", "global-card-summary", cardText.summary)
  );
  const classification = element("div", "global-card-classification");
  classification.append(
    link("global-card-set", setText.name, setRoute(set, localeId)),
    element("span", "global-card-type", cardText.typeLabel)
  );
  const action = link("global-card-action", "→", cardRoute(card, localeId));
  action.setAttribute("aria-label", `${copy.openCard}: ${cardText.name}`);
  row.append(identity, classification, action);
  return row;
}

export function renderCatalogPage(catalog, root) {
  let query = new URLSearchParams(location.search).get("q") ?? "";
  renderWithLanguage(catalog, root, (localeId, copy, setLocale) => {
    const locale = localize(catalog, localeId);
    document.title = locale.name;
    const page = element("main", "page-shell catalog-page");
    const header = element("header", "catalog-header");
    const top = element("div", "catalog-topbar");
    top.append(element("span", "catalog-brand", "Rubyfront"), languagePicker(catalog, localeId, setLocale));
    header.append(top, element("h1", "", locale.name), element("p", "lede", locale.description));


    const nav = element("nav", "catalog-links");
    nav.append(
      link("", copy.manual, new URL("../../MANUALE.md", import.meta.url).href),
      link("", copy.board, new URL("../../campo-di-gioco.html", import.meta.url).href),
      link("", copy.themes, new URL("./card-themes.html", import.meta.url).href)
    );
    header.append(nav);
    page.append(header);

    const catalogEntries = catalog.cards.map(card => ({
      card,
      set: catalog.sets.find(candidate => candidate.id === card.setId)
    }));

    const searchSection = element("section", "catalog-search");
    const searchLabel = element("label", "sr-only", copy.searchLabel);
    searchLabel.htmlFor = "catalog-search";
    const searchInput = element("input", "search-input");
    searchInput.id = "catalog-search";
    searchInput.type = "search";
    searchInput.placeholder = copy.searchPlaceholder;
    searchInput.value = query;
    searchInput.autocomplete = "off";
    const resultCount = element("span", "search-count");
    searchSection.append(searchLabel, searchInput, resultCount);
    page.append(searchSection);

    const heading = element("div", "catalog-list-heading");
    heading.append(element("h2", "", copy.allCards));
    const setLinks = element("nav", "set-links");
    setLinks.setAttribute("aria-label", copy.sets);
    catalog.sets.forEach(set => {
      const setText = localize(set, localeId);
      setLinks.append(link("", `${set.code} · ${setText.name}`, setRoute(set, localeId)));
    });
    heading.append(setLinks);
    page.append(heading);

    const results = element("div", "global-card-list");
    page.append(results);

    const drawResults = () => {
      const normalizedQuery = normalizeSearch(query);
      const visibleEntries = normalizedQuery
        ? catalogEntries.filter(({ card, set }) => searchableCardText(card, set, localeId, copy).includes(normalizedQuery))
        : catalogEntries;

      results.replaceChildren();
      if (visibleEntries.length) {
        visibleEntries.forEach(({ card, set }) => results.append(globalCardRow(card, set, localeId, copy)));
      } else {
        results.append(element("p", "empty-results", copy.noResults));
      }
      resultCount.textContent = copy.resultCount(visibleEntries.length, catalogEntries.length);
    };

    searchInput.addEventListener("input", event => {
      query = event.target.value;
      const url = new URL(location.href);
      if (query.trim()) url.searchParams.set("q", query);
      else url.searchParams.delete("q");
      history.replaceState(null, "", url);
      drawResults();
    });
    drawResults();
    return page;
  });
}

export function renderSetPage(set, root) {
  renderWithLanguage(set, root, (localeId, copy, setLocale) => {
    const locale = localize(set, localeId);
    document.title = locale.name;
    const page = element("main", "page-shell");
    page.append(breadcrumb([
      { label: copy.catalog, href: catalogRoute(localeId) },
      { label: locale.name }
    ]));

    page.append(pageHeader({
      eyebrow: `${set.code} · ${copy[set.status]}`,
      title: locale.name,
      lede: locale.description,
      resource: set,
      localeId,
      onLocaleChange: setLocale
    }));

    const heading = element("div", "section-heading");
    heading.append(element("h2", "", copy.cards), element("span", "count", String(set.cards.length)));
    const list = element("div", "card-list standalone");
    set.cards.forEach(card => list.append(cardRow(card, localeId, copy)));
    page.append(heading, list);
    return page;
  });
}

function matterLabel(matter, copy) {
  const name = copy.matterNames[matter.type] ?? matter.type;
  return matter.maxGrade ? `${name} · ${matter.maxGrade}°` : name;
}

function statGrid(face, copy) {
  const items = [];
  if (face.stats.deploymentCost) {
    const cost = face.stats.deploymentCost;
    items.push([copy.deployment, `${cost.base}+${cost.increment} · max ${cost.cap}`]);
  }
  if (face.stats.fluxCost !== undefined) items.push([copy.fluxCost, face.stats.fluxCost]);
  if (face.stats.power !== undefined) items.push([copy.power, face.stats.power]);
  if (face.stats.counterattack !== undefined) items.push([copy.counterattack, `+${face.stats.counterattack}`]);
  if (face.stats.health !== undefined) items.push([copy.health, face.stats.health]);
  if (face.stats.healthRecovery !== undefined) items.push([copy.healthRecovery, `+${face.stats.healthRecovery}`]);
  if (face.enablesMatters.length) items.push([copy.matters, face.enablesMatters.map(matter => matterLabel(matter, copy)).join(", ")]);
  return metadataList(items);
}

function facePanel(card, face, localeId, copy) {
  const locale = localize(card, localeId);
  const display = locale[face.displayKey];
  const panel = element("section", "face-panel");
  const heading = element("div", "face-heading");
  heading.append(
    element("span", "face-side", card.faces.length > 1 ? (face.id === "rubyfront" ? copy.front : copy.back) : locale.typeLabel),
    element("h2", "", display.name)
  );
  panel.append(heading, statGrid(face, copy));

  if (face.keywords.length) {
    const section = element("div", "rules-section");
    section.append(element("h3", "", copy.keywords));
    for (const keyword of face.keywords) {
      const item = element("div", "rule-item");
      item.append(element("strong", "", display.keyword.name), element("p", "", display.keyword.rules));
      section.append(item);
    }
    panel.append(section);
  }

  if (face.requirements.union) {
    const section = element("div", "rules-section");
    section.append(element("h3", "", copy.requirement), element("p", "", locale.card.unionRequirement.text));
    panel.append(section);
  }

  if (face.triggers.length) {
    const section = element("div", "rules-section");
    section.append(element("h3", "", copy.triggers));
    for (const trigger of face.triggers) {
      const item = element("div", "rule-item");
      const text = display[trigger.displayKey];
      item.append(element("strong", "", text.name), element("p", "", text.text));
      section.append(item);
    }
    panel.append(section);
  }

  if (face.actions.length) {
    const section = element("div", "rules-section");
    section.append(element("h3", "", copy.actions));
    for (const action of face.actions) {
      const text = display.abilities[action.displayKey];
      const item = element("div", "rule-item action-item");
      const costLabel = action.cost?.health !== undefined
        ? `−${action.cost.health} ${locale.card.hp}`
        : action.cost?.flux !== undefined
          ? `${action.cost.flux} ${locale.card.flux ?? "Flux"}`
          : "—";
      item.append(
        element("span", "health-cost", costLabel),
        element("strong", "", text.name),
        element("p", "", text.text)
      );
      section.append(item);
    }
    panel.append(section);
  }

  panel.append(element("p", "flavor", display.flavor));
  const details = element("details", "engine-data");
  details.append(element("summary", "", copy.faceData), element("pre", "", JSON.stringify(face, null, 2)));
  panel.append(details);
  return panel;
}

export function renderCardPage(card, set, root) {
  renderWithLanguage(card, root, (localeId, copy, setLocale) => {
    const locale = localize(card, localeId);
    const setText = localize(set, localeId);
    document.title = `${card.id} · ${locale.name}`;
    const page = element("main", "page-shell");
    page.append(breadcrumb([
      { label: copy.catalog, href: catalogRoute(localeId) },
      { label: setText.name, href: setRoute(set, localeId) },
      { label: locale.name }
    ]));

    const header = pageHeader({
      eyebrow: `${card.id} · ${locale.typeLabel}`,
      title: locale.name,
      lede: locale.summary,
      resource: card,
      localeId,
      onLocaleChange: setLocale
    });
    header.append(metadataList([
      [copy.collectorNumber, card.collectorNumber],
      [copy.status, copy[card.status]],
      [copy.type, locale.typeLabel],
      [copy.deckLimit, card.deckLimit],
      [copy.tags, card.tags.join(", ")],
      [copy.source, card.id]
    ]));
    const nav = element("nav", "quick-links");
    nav.append(
      link("button", copy.visual, themedCardRoute(card, localeId)),
      link("button secondary", copy.notes, resolveSource(card, "designNotes"))
    );
    header.append(nav);
    page.append(header);

    const faces = element("div", "faces-grid");
    card.faces.forEach(face => faces.append(facePanel(card, face, localeId, copy)));
    page.append(faces);
    return page;
  });
}

export { renderRegistryError } from "./shell.js";
