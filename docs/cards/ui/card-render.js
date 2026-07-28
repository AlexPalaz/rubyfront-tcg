// Costruttori della carta visuale, condivisi tra la pagina dei temi
// (card-theme-page.js) e la pagina del mazzo (deck-page.js): la grafica
// della carta vive in un posto solo. Gli stili corrispondenti sono in card.css.
import { element } from "./shell.js";
import { LIGHT_THEMES } from "./themes.js";

const SVG_NS = "http://www.w3.org/2000/svg";
// Trigger che descrivono l'uscita di scena della carta: vanno letti in fondo
// alla textbox, dopo le abilità attivate, mai sopra di esse.
const TRAILING_EVENTS = new Set(["on_leave_field", "on_death", "on_retire"]);
// Eventi continui: non sono momenti ma stati — la loro voce sulla carta è il
// testo statico (faceCopy.effect), mai un blocco con etichetta d'innesco.
const STATIC_EVENTS = new Set(["while_in_play", "while_assigned"]);
function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function localized(resource, localeId) {
  return resource.locales[localeId] ?? resource.locales[resource.defaultLocale];
}

function createFace(card, face, cardCopy, themeId) {
  const faceCopy = cardCopy[face.displayKey] ?? {};
  const wrapper = element("article", "face");
  const label = element("div", "face-label", cardCopy.ui?.[face.displayKey] ?? face.id);
  const visual = element("div", `card ${face.kind === "union" ? "union " : ""}${themeId}`);
  if (LIGHT_THEMES.has(themeId)) visual.classList.add("light-theme");
  visual.dataset.faceId = face.id;

  visual.append(
    createTitleBar(card, face, faceCopy, cardCopy),
    element("div", "art", cardCopy.card?.illustration ?? "Illustration")
  );

  if ((face.kind === "entity" || face.kind === "matter" || face.kind === "object") && cardCopy.typeLabel) {
    visual.append(element("div", "typeline", cardCopy.typeLabel));
  }

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
  if (face.stats.counterattack !== undefined) {
    bottomBar.append(createCounterattackBadge(face.stats.counterattack, cardCopy.card?.counterattack ?? "Counterattack"));
  }
  visual.append(bottomBar);
  wrapper.append(label, visual);
  return wrapper;
}

// Stella a quattro punte: il simbolo dell'Unica (§3.1) accanto al nome.
// Il nome della classificazione vive solo nel tooltip/aria-label.
function createUniqueStar(label) {
  const svg = svgElement("svg", { viewBox: "0 0 20 20", "aria-label": label, class: "unique-star" });
  svg.setAttribute("role", "img");
  svg.append(svgElement("path", {
    d: "M 10 1.5 L 12.3 7.7 L 18.5 10 L 12.3 12.3 L 10 18.5 L 7.7 12.3 L 1.5 10 L 7.7 7.7 Z",
    fill: "var(--accent)", stroke: "var(--frame-dim)", "stroke-width": ".5"
  }));
  const holder = element("span", "unique-holder");
  holder.title = label;
  holder.append(svg);
  return holder;
}

function createTitleBar(card, face, faceCopy, cardCopy) {
  const bar = element("div", "titlebar");
  const deployment = face.stats.deploymentCost;
  if (deployment) {
    const cost = element("div", "cost");
    const value = deployment.increment
      ? `${deployment.base}+${deployment.increment}`
      : String(deployment.base);
    cost.append(element("i", "", value));
    bar.append(cost);
  } else if (face.stats.fluxCost !== undefined) {
    const cost = element("div", "cost");
    cost.append(element("i", "", String(face.stats.fluxCost)));
    bar.append(cost);
  } else if (face.kind === "union") {
    bar.append(createUnionMark(faceCopy.unionAria ?? "Union"));
  } else {
    bar.append(element("div"));
  }

  const name = element("div", "name");
  if (card.unique) name.append(createUniqueStar(cardCopy.card?.unique ?? "Unique"));
  name.append(faceCopy.name ?? face.id);
  bar.append(name);
  const value = face.stats.health ?? (face.stats.healthRecovery !== undefined ? `+${face.stats.healthRecovery}` : undefined);
  if (value !== undefined) {
    const health = element("div", "hp");
    health.append(String(value), " ", element("small", "", cardCopy.card?.hp ?? "HP"));
    bar.append(health);
  } else if (face.stats.power !== undefined) {
    bar.append(createPowerBadge(face.stats.power, cardCopy.card?.power ?? "Power"));
  } else if (face.kind === "matter" && face.matter) {
    const identity = element("div", "matter-identity");
    identity.append(createMatter(face.matter, cardCopy));
    bar.append(identity);
  } else if (face.kind === "object") {
    bar.append(element("div"));
  } else {
    bar.append(element("div", "hp", "—"));
  }
  return bar;
}

// Simboli dei comportamenti delle Materie (§7.2): la Reattiva è un fulmine
// (scatta nel turno altrui), la Permanente sarà un anello (ciò che resta).
// Il nome della dicitura sopravvive solo come tooltip/aria-label.
function createBehaviorIcon(behavior, label) {
  const svg = svgElement("svg", { viewBox: "0 0 20 20", "aria-label": label, class: "behavior-icon" });
  svg.setAttribute("role", "img");
  if (behavior === "reactive") {
    svg.append(svgElement("path", {
      d: "M 11.2 1.5 L 4.4 11.2 H 8.6 L 7.4 18.5 L 15.6 8.2 H 10.6 Z",
      fill: "var(--accent)", stroke: "var(--frame-dim)", "stroke-width": ".6"
    }));
  } else {
    svg.append(svgElement("circle", {
      cx: "10", cy: "10", r: "6.5",
      fill: "none", stroke: "var(--accent)", "stroke-width": "2.2"
    }));
  }
  const holder = element("span", "behavior-holder");
  holder.title = label;
  holder.append(svg);
  return holder;
}

function createFluxIcon(label) {
  const svg = svgElement("svg", { viewBox: "0 0 20 20", "aria-label": label, class: "flux-icon" });
  svg.append(
    svgElement("rect", {
      x: "4.6", y: "4.6", width: "10.8", height: "10.8", rx: "1",
      transform: "rotate(45 10 10)",
      fill: "var(--ruby)", stroke: "var(--ruby-light)", "stroke-width": "1.4"
    }),
    svgElement("path", { d: "M 10 5.8 L 13.2 10 L 10 14.2", fill: "none", stroke: "var(--ruby-light)", "stroke-width": "1", opacity: ".65" })
  );
  return svg;
}

function createPowerBadge(power, label) {
  const badge = element("div", "power-badge");
  badge.title = label;
  const svg = svgElement("svg", { viewBox: "0 0 24 24", "aria-label": label });
  svg.append(svgElement("rect", {
    x: "5", y: "5", width: "14", height: "14", rx: "1.5",
    transform: "rotate(45 12 12)",
    fill: "none", stroke: "var(--ruby-light)", "stroke-width": "1.6"
  }));
  badge.append(svg, element("b", "", String(power)));
  return badge;
}

function createCounterattackBadge(counterattack, label) {
  const badge = element("span", "counter-badge");
  badge.title = label;
  const svg = svgElement("svg", { viewBox: "0 0 20 20", "aria-label": label });
  svg.append(
    svgElement("path", { d: "M 4.5 12.5 A 6 6 0 1 1 10 16.5", fill: "none", stroke: "var(--ruby-light)", "stroke-width": "1.8" }),
    svgElement("path", { d: "M 4.5 12.5 L 2 9.8 M 4.5 12.5 L 8 11.2", fill: "none", stroke: "var(--ruby-light)", "stroke-width": "1.8", "stroke-linecap": "round" })
  );
  badge.append(svg, element("b", "", `+${counterattack}`));
  return badge;
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

// Costo e nome scorrono in linea col testo, come le righe di Magic: nessuna
// colonna riservata, tutta la larghezza della textbox lavora per le parole.
function createTriggerBlock(face, trigger, faceCopy) {
  const triggerCopy = faceCopy.triggers?.[trigger.displayKey ?? trigger.id]
    ?? faceCopy[trigger.displayKey]
    ?? {};
  const block = element("div", "fx");
  block.append(element("span", "tag", triggerCopy.trigger ?? faceCopy.trigger ?? trigger.event));
  const body = element("p", "body");
  // Gli effetti innescati non hanno nome proprio: li identifica l'etichetta
  // d'innesco. Il nome compare solo se una carta lo dichiara esplicitamente.
  if (triggerCopy.name) body.append(element("b", "", triggerCopy.name), ": ");
  body.append(triggerCopy.text ?? "");
  block.append(body);
  return block;
}

function createActionBlock(action, faceCopy, cardCopy) {
  const actionCopy = faceCopy.abilities?.[action.displayKey] ?? {};
  const block = element("p", "ability");
  const healthCost = action.cost?.health;
  const fluxCost = action.cost?.flux;
  const cost = element("span", "hp-cost");
  if (healthCost !== undefined) {
    cost.append(`−${healthCost} ${cardCopy.card?.hp ?? "HP"}`);
  } else if (fluxCost !== undefined) {
    const label = cardCopy.card?.flux ?? "Flux";
    cost.title = label;
    cost.append(String(fluxCost), createFluxIcon(label));
  } else {
    cost.append("—");
  }
  block.append(cost, " ", element("b", "", actionCopy.name ?? action.id), ": ", actionCopy.text ?? "");
  return block;
}

function createTextBox(face, faceCopy, cardCopy) {
  const box = element("div", "textbox");
  // Il requisito Unione non ha etichetta scritta: lo identifica il simbolo
  // dei due anelli (lo stesso della faccia Unione), in linea col testo.
  const unionRequirement = face.requirements?.union;
  if (unionRequirement) {
    const requirementCopy = cardCopy.card?.unionRequirement ?? {};
    const block = element("p", "requirement");
    block.append(
      createUnionMark(requirementCopy.label ?? "Union requirement"),
      requirementCopy.text ?? ""
    );
    box.append(block);
  }

  // Materie e Oggetti hanno una textbox a testo semplice: solo l'effetto,
  // senza etichette di innesco (il comportamento "normale" non si stampa,
  // §7.2; l'assegnazione degli Oggetti è regola generale, §3.1).
  if (face.kind === "matter" || face.kind === "object") {
    if (faceCopy.effect?.text) {
      const body = element("p", "matter-effect");
      // Permanenti e Reattive dichiarano il comportamento con il proprio
      // simbolo in testa al testo (§7.2); il comportamento normale non si
      // stampa. Il nome resta come tooltip.
      if (face.behavior && face.behavior !== "normal") {
        const label = cardCopy.card?.behaviors?.[face.behavior] ?? face.behavior;
        body.append(createBehaviorIcon(face.behavior, label), " ");
      }
      body.append(faceCopy.effect.text);
      box.append(body);
    }
    if (faceCopy.flavor) box.append(element("p", "flavor", faceCopy.flavor));
    return box;
  }

  // Regole statiche delle Entità (restrizioni, bonus condizionali): testo
  // semplice in testa alla textbox, senza etichetta d'innesco.
  if (face.kind === "entity" && faceCopy.effect?.text) {
    box.append(element("p", "matter-effect", faceCopy.effect.text));
  }

  // Ordine di lettura: prima gli effetti d'ingresso/ricorrenti, poi le abilità
  // attivate, infine i trigger d'uscita (lascia il campo, morte) — così
  // un'abilità attivata non finisce mai sotto l'intestazione "quando lascia".
  const leadingTriggers = face.triggers.filter(trigger =>
    !TRAILING_EVENTS.has(trigger.event) && !STATIC_EVENTS.has(trigger.event));
  const trailingTriggers = face.triggers.filter(trigger => TRAILING_EVENTS.has(trigger.event));

  for (const trigger of leadingTriggers) box.append(createTriggerBlock(face, trigger, faceCopy));
  for (const action of face.actions) box.append(createActionBlock(action, faceCopy, cardCopy));
  for (const trigger of trailingTriggers) box.append(createTriggerBlock(face, trigger, faceCopy));

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
    // Colori identitari fissi dei medaglioni (uguali su ogni carta):
    // Distruttiva = D rossa, Dinamica = D argento, Dimensionale = D blu,
    // Dominante = D viola. Lo Zero (anello sul vuoto) è gestito sopra.
    const colors = {
      destructive: ["#9e0f34", "#e56a86"],
      dynamic: ["#6b7280", "#e5e7eb"],
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
  const grade = matter.maxGrade ?? matter.grade;
  if (grade) badge.append(element("b", "", roman(grade)));
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

export { createFace, localized };
