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

const SVG_NS = "http://www.w3.org/2000/svg";
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

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function localized(resource, localeId) {
  return resource.locales[localeId] ?? resource.locales[resource.defaultLocale];
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

function createFace(card, face, cardCopy, themeId) {
  const faceCopy = cardCopy[face.displayKey] ?? {};
  const wrapper = element("article", "face");
  const label = element("div", "face-label", cardCopy.ui?.[face.displayKey] ?? face.id);
  const visual = element("div", `card ${face.kind === "union" ? "union " : ""}${themeId}`);
  if (LIGHT_THEMES.has(themeId)) visual.classList.add("light-theme");
  visual.dataset.faceId = face.id;

  visual.append(
    createTitleBar(face, faceCopy, cardCopy),
    element("div", "art", cardCopy.card?.illustration ?? "Illustration")
  );

  for (const keyword of face.keywords) {
    visual.append(createKeyword(face, keyword, faceCopy));
  }

  if (face.kind === "union") {
    const divider = element("div", "divider");
    divider.setAttribute("aria-hidden", "true");
    divider.append(element("i", "", "◆"));
    visual.append(divider);
  }

  visual.append(createTextBox(face, faceCopy, cardCopy));

  const bottomBar = element("div", "bottombar");
  const matters = element("div", "matters");
  matters.append(...face.enablesMatters.map(matter => createMatter(matter, cardCopy)));
  bottomBar.append(matters);
  visual.append(bottomBar);
  wrapper.append(label, visual);
  return wrapper;
}

function createTitleBar(face, faceCopy, cardCopy) {
  const bar = element("div", "titlebar");
  const deployment = face.stats.deploymentCost;
  if (deployment) {
    const cost = element("div", "cost");
    const value = deployment.increment
      ? `${deployment.base}+${deployment.increment}`
      : String(deployment.base);
    cost.append(element("i", "", value));
    bar.append(cost);
  } else if (face.kind === "union") {
    bar.append(createUnionMark(faceCopy.unionAria ?? "Union"));
  } else {
    bar.append(element("div"));
  }

  bar.append(element("div", "name", faceCopy.name ?? face.id));
  const health = element("div", "hp");
  const value = face.stats.health ?? (face.stats.healthRecovery !== undefined ? `+${face.stats.healthRecovery}` : "—");
  health.append(String(value), " ", element("small", "", cardCopy.card?.hp ?? "HP"));
  bar.append(health);
  return bar;
}

function createUnionMark(label) {
  const mark = element("div", "union-mark");
  const svg = svgElement("svg", { viewBox: "0 0 40 28", "aria-label": label });
  svg.append(
    svgElement("circle", { cx: "14", cy: "15", r: "8", fill: "none", stroke: "var(--ring, var(--ruby-light))", "stroke-width": "3.2" }),
    svgElement("circle", { cx: "26", cy: "15", r: "8", fill: "none", stroke: "var(--ring, var(--ruby-light))", "stroke-width": "3.2" }),
    svgElement("path", { d: "M 17.25 7.69 A 8 8 0 0 1 21.61 12.53", fill: "none", stroke: "var(--bg)", "stroke-width": "5.6" }),
    svgElement("path", { d: "M 17.25 7.69 A 8 8 0 0 1 21.61 12.53", fill: "none", stroke: "var(--ring, var(--ruby-light))", "stroke-width": "3.2" })
  );
  mark.append(svg);
  return mark;
}

function createKeyword(face, keyword, faceCopy) {
  const keywordCopy = faceCopy.keywords?.[keyword.displayKey ?? keyword.id]
    ?? (face.keywords.length === 1 ? faceCopy.keyword : undefined)
    ?? {};
  const row = element("div", "keyword");
  row.append(
    element("span", "", keywordCopy.name ?? keyword.id),
    element("span", "", keywordCopy.rules ?? "")
  );
  return row;
}

function createTextBox(face, faceCopy, cardCopy) {
  const box = element("div", "textbox");
  const unionRequirement = face.requirements?.union;
  if (unionRequirement) {
    const requirementCopy = cardCopy.card?.unionRequirement ?? {};
    const requirement = element("p", "requirement");
    requirement.append(
      element("b", "", requirementCopy.label ?? "Union requirement"),
      element("span", "", requirementCopy.text ?? "")
    );
    box.append(requirement);
  }

  for (const trigger of face.triggers) {
    const triggerCopy = faceCopy.triggers?.[trigger.displayKey ?? trigger.id]
      ?? faceCopy[trigger.displayKey]
      ?? {};
    const block = element("div", "fx");
    block.append(element("span", "tag", triggerCopy.trigger ?? faceCopy.trigger ?? trigger.event));
    const body = element("div", "body");
    body.append(element("b", "", triggerCopy.name ?? trigger.id), ": ", triggerCopy.text ?? "");
    block.append(body);
    box.append(block);
  }

  for (const action of face.actions) {
    const actionCopy = faceCopy.abilities?.[action.displayKey] ?? {};
    const block = element("div", "ability");
    const healthCost = action.cost?.health;
    const cost = element("span", "hp-cost", healthCost === undefined
      ? "—"
      : `−${healthCost} ${cardCopy.card?.hp ?? "HP"}`);
    const body = element("div");
    body.append(element("b", "", actionCopy.name ?? action.id), ": ", actionCopy.text ?? "");
    block.append(cost, body);
    box.append(block);
  }

  if (faceCopy.flavor) box.append(element("p", "flavor", faceCopy.flavor));
  return box;
}

function createMatter(matter, cardCopy) {
  const titleKey = `${matter.type}Title`;
  const ariaKey = `${matter.type}Aria`;
  const title = cardCopy.matters?.[titleKey] ?? matter.type;
  const aria = cardCopy.matters?.[ariaKey] ?? matter.type;
  const badge = element("span", "matter");
  badge.title = title;
  const svg = svgElement("svg", { viewBox: "0 0 20 20", "aria-label": aria });

  if (matter.type === "zero") {
    svg.append(
      svgElement("circle", { cx: "10", cy: "10", r: "9", fill: "#23232b", stroke: "#8f93a3", "stroke-width": ".8" }),
      svgElement("circle", { cx: "10", cy: "10", r: "4.6", fill: "none", stroke: "#d6d9e4", "stroke-width": "1.5" })
    );
  } else {
    const colors = {
      destructive: ["#9e0f34", "#e56a86"],
      dynamic: ["#a36b16", "#f0c15a"],
      dimensional: ["#3d4c99", "#9ba9ff"],
      dominant: ["#5e2d85", "#c597ec"]
    }[matter.type] ?? ["#40404a", "#a7a7b0"];
    svg.append(
      svgElement("circle", { cx: "10", cy: "10", r: "9", fill: colors[0], stroke: colors[1], "stroke-width": ".8" }),
      svgElement("text", { x: "10", y: "13", "text-anchor": "middle", fill: "#fff", "font-size": "8", "font-family": "sans-serif" })
    );
    svg.lastChild.textContent = matter.type.slice(0, 1).toUpperCase();
  }

  badge.append(svg);
  if (matter.maxGrade) badge.append(element("b", "", roman(matter.maxGrade)));
  return badge;
}

function roman(value) {
  const numerals = [
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
  ];
  let number = value;
  let result = "";
  for (const [amount, symbol] of numerals) {
    while (number >= amount) {
      result += symbol;
      number -= amount;
    }
  }
  return result;
}
