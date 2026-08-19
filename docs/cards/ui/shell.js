// Shell di navigazione condivisa da tutte le pagine in ui/.
// Contiene i testi localizzati, i costruttori DOM e le rotte: le pagine
// costruiscono solo il proprio contenuto, mai il proprio chrome.

export const COPY = {
  it: {
    catalog: "Catalogo",
    sets: "Set",
    setsLede: "Le collezioni che raccolgono le carte.",
    cards: "Carte",
    card: "Carta",
    decks: "Mazzi",
    decksLede: "Liste pronte da giocare, con il loro Rubyfront.",
    openDeck: "Apri il mazzo",
    browseDecks: "Sfoglia i mazzi",
    manual: "Manuale",
    board: "Campo di gioco",
    themes: "Temi grafici",
    theme: "Tema",
    language: "Lingua",
    languageLabel: "Lingua / Language",
    searchLabel: "Cerca nel catalogo",
    searchPlaceholder: "Cerca per nome, ID, set, tipo o tag…",
    allCards: "Tutte le carte",
    noResults: "Nessuna carta corrisponde alla ricerca.",
    resultCount: (visible, total) => visible === total ? `${total} ${total === 1 ? "carta" : "carte"}` : `${visible} di ${total} ${total === 1 ? "carta" : "carte"}`,
    openSet: "Apri il set",
    openCard: "Apri la carta",
    visual: "Apri la carta visuale",
    cardData: "Torna ai dati della carta",
    themeIndex: "Indice dei temi",
    themeList: "Elenco temi",
    themeGalleryLede: name => `Ogni tema usa lo stesso renderer e gli stessi dati strutturali di ${name}.`,
    notes: "Note di design",
    cardCount: count => `${count} ${count === 1 ? "carta" : "carte"}`,
    collectorNumber: "N°",
    status: "Stato",
    type: "Tipo",
    deckLimit: "Copie nel mazzo",
    tags: "Tag",
    source: "Modulo engine",
    faceData: "Dati strutturati per l’engine",
    deployment: "Schieramento",
    health: "PV",
    healthRecovery: "Recupero PV",
    fluxCost: "Costo di Flusso",
    power: "Potenza",
    counterattack: "Contrattacco",
    matters: "Materie abilitate",
    keywords: "Abilità",
    requirement: "Requisito Nexus",
    triggers: "Effetti automatici",
    actions: "Abilità speciali",
    timing: "Finestra",
    repeatable: "Ripetibile",
    yes: "sì",
    no: "no",
    draft: "Bozza",
    testing: "In test",
    released: "Pubblicato",
    retired: "Ritirato",
    front: "Faccia A",
    back: "Faccia B",
    deck: "Mazzo",
    deckCount: total => `${total} carte`,
    errorTitle: "Contenuto non disponibile",
    backToCatalog: "Torna al catalogo",
    cardNotFound: "Carta non trovata",
    cardMissing: id => `Nessuna carta è registrata con l’ID ${id}.`,
    catalogEmpty: "Il catalogo non contiene ancora carte.",
    matterNames: {
      dynamic: "Dinamica",
      dimensional: "Dimensionale",
      destructive: "Distruttiva",
      zero: "Zero",
      dominant: "Dominante"
    }
  },
  en: {
    catalog: "Catalog",
    sets: "Sets",
    setsLede: "The collections that gather the cards.",
    cards: "Cards",
    card: "Card",
    decks: "Decks",
    decksLede: "Ready-to-play lists, each with its Rubyfront.",
    openDeck: "Open deck",
    browseDecks: "Browse decks",
    manual: "Manual",
    board: "Game board",
    themes: "Visual themes",
    theme: "Theme",
    language: "Language",
    languageLabel: "Lingua / Language",
    searchLabel: "Search catalog",
    searchPlaceholder: "Search by name, ID, set, type or tag…",
    allCards: "All cards",
    noResults: "No cards match your search.",
    resultCount: (visible, total) => visible === total ? `${total} ${total === 1 ? "card" : "cards"}` : `${visible} of ${total} ${total === 1 ? "card" : "cards"}`,
    openSet: "Open set",
    openCard: "Open card",
    visual: "Open visual card",
    cardData: "Back to card data",
    themeIndex: "Theme index",
    themeList: "Theme list",
    themeGalleryLede: name => `Every theme uses the same renderer and the same structured data for ${name}.`,
    notes: "Design notes",
    cardCount: count => `${count} ${count === 1 ? "card" : "cards"}`,
    collectorNumber: "No.",
    status: "Status",
    type: "Type",
    deckLimit: "Deck copies",
    tags: "Tags",
    source: "Engine module",
    faceData: "Structured engine data",
    deployment: "Deployment",
    health: "HP",
    healthRecovery: "HP recovery",
    fluxCost: "Flux cost",
    power: "Power",
    counterattack: "Counterattack",
    matters: "Enabled Matters",
    keywords: "Keywords",
    requirement: "Nexus requirement",
    triggers: "Automatic effects",
    actions: "Special abilities",
    timing: "Timing",
    repeatable: "Repeatable",
    yes: "yes",
    no: "no",
    draft: "Draft",
    testing: "Testing",
    released: "Released",
    retired: "Retired",
    front: "Face A",
    back: "Face B",
    deck: "Deck",
    deckCount: total => `${total} cards`,
    errorTitle: "Content unavailable",
    backToCatalog: "Back to catalog",
    cardNotFound: "Card not found",
    cardMissing: id => `No card is registered with the ID ${id}.`,
    catalogEmpty: "The catalog has no cards yet.",
    matterNames: {
      dynamic: "Dynamic",
      dimensional: "Dimensional",
      destructive: "Destructive",
      zero: "Zero",
      dominant: "Dominant"
    }
  }
};

export const FALLBACK_LOCALE = "it";

export function copyFor(localeId) {
  return COPY[localeId] ?? COPY[FALLBACK_LOCALE];
}

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function link(className, text, href) {
  const node = element("a", className, text);
  node.href = href;
  return node;
}

export function uiRoute(page, params = {}, localeId) {
  const url = new URL(`./${page}`, import.meta.url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  if (localeId) url.searchParams.set("lang", localeId);
  return url.href;
}

export const catalogRoute = localeId => uiRoute("index.html", {}, localeId);
export const setRoute = (set, localeId) => uiRoute("set.html", { set: set.id }, localeId);
export const cardRoute = (card, localeId) => uiRoute("card.html", { card: card.id }, localeId);
export const themeIndexRoute = (card, localeId) => uiRoute("card-themes.html", { card: card.id }, localeId);
export const deckRoute = (deck, localeId) => uiRoute("deck.html", { deck: deck.id }, localeId);
export const themedCardRoute = (card, localeId, themeId) =>
  uiRoute("card-theme.html", { card: card.id, theme: themeId }, localeId);

export function localeFromUrl(resource) {
  const requested = new URLSearchParams(location.search).get("lang");
  return resource.locales[requested] ? requested : resource.defaultLocale;
}

export function updateLanguage(localeId) {
  const url = new URL(location.href);
  url.searchParams.set("lang", localeId);
  history.replaceState(null, "", url);
  document.documentElement.lang = localeId;
}

export function setUrlParameter(name, value) {
  const url = new URL(location.href);
  url.searchParams.set(name, value);
  history.replaceState(null, "", url);
}

export function languagePicker(resource, localeId, onChange) {
  const label = element("label", "language-picker");
  const caption = element("span", "sr-only", copyFor(localeId).languageLabel);
  const select = element("select");
  for (const id of Object.keys(resource.locales)) {
    const option = element("option", "", id.toUpperCase());
    option.value = id;
    option.selected = id === localeId;
    select.append(option);
  }
  select.addEventListener("change", event => onChange(event.target.value));
  label.append(caption, select);
  return label;
}

export function metadataList(items) {
  const list = element("dl", "metadata");
  for (const [label, value] of items) {
    const group = element("div", "metadata-item");
    group.append(element("dt", "", label), element("dd", "", String(value)));
    list.append(group);
  }
  return list;
}

export function breadcrumb(items) {
  const nav = element("nav", "breadcrumbs");
  nav.setAttribute("aria-label", "Breadcrumb");
  items.forEach((item, index) => {
    if (index) nav.append(element("span", "breadcrumb-separator", "/"));
    nav.append(item.href ? link("", item.label, item.href) : element("span", "", item.label));
  });
  return nav;
}

// Intestazione unica di tutte le pagine interne: occhiello, titolo, sommario
// e — se la risorsa è localizzata — selettore di lingua allineato a destra.
export function pageHeader({ eyebrow, title, lede, resource, localeId, onLocaleChange }) {
  const header = element("header", "hero");
  const top = element("div", "hero-top");
  top.append(element("p", "eyebrow", eyebrow));
  if (resource && onLocaleChange) top.append(languagePicker(resource, localeId, onLocaleChange));
  header.append(top, element("h1", "", title));
  if (lede) header.append(element("p", "lede", lede));
  return header;
}

// Ridisegna la pagina a ogni cambio di lingua mantenendo l'URL allineato.
export function renderWithLanguage(resource, root, render) {
  let localeId = localeFromUrl(resource);
  const draw = () => {
    updateLanguage(localeId);
    root.replaceChildren(render(localeId, copyFor(localeId), nextLocale => {
      localeId = nextLocale;
      draw();
    }));
  };
  draw();
}

export function renderRegistryError(root, message, localeId = FALLBACK_LOCALE) {
  const copy = copyFor(localeId);
  document.documentElement.lang = localeId;
  document.title = `Rubyfront · ${copy.errorTitle}`;
  const page = element("main", "page-shell");
  const header = pageHeader({
    eyebrow: "Rubyfront · Card Registry",
    title: copy.errorTitle,
    lede: message
  });
  const nav = element("nav", "quick-links");
  nav.append(link("button secondary", copy.backToCatalog, catalogRoute(localeId)));
  header.append(nav);
  page.append(header);
  root.replaceChildren(page);
}
