// Costruttori della carta visuale, condivisi tra la pagina dei temi
// (card-theme-page.js) e la pagina del mazzo (deck-page.js): la grafica
// della carta vive in un posto solo. Gli stili corrispondenti sono in card.css.
import { element, copyFor } from "./shell.js";
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

function createFace(card, face, cardCopy, themeId, localeId) {
  const faceCopy = cardCopy[face.displayKey] ?? {};
  const wrapper = element("article", "face");
  const label = element("div", "face-label", cardCopy.ui?.[face.displayKey] ?? face.id);
  const visual = element("div", `card ${face.kind === "nexus" ? "nexus " : ""}${themeId}`);
  if (LIGHT_THEMES.has(themeId)) visual.classList.add("light-theme");
  visual.dataset.faceId = face.id;

  visual.append(
    createTitleBar(card, face, faceCopy, cardCopy),
    element("div", "art", cardCopy.card?.illustration ?? "Illustration")
  );

  for (const keyword of face.keywords) {
    visual.append(createKeyword(face, keyword, faceCopy));
  }

  if (face.kind === "nexus") {
    const divider = element("div", "divider");
    divider.setAttribute("aria-hidden", "true");
    divider.append(element("i", "", "◆"));
    visual.append(divider);
  }

  visual.append(createTextBox(face, faceCopy, cardCopy, localeId));
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
  // Costo di schieramento (§3.1): base a numero fisso o a dado, piu' un
  // incremento opzionale. Alla base a dado si aggiunge solo la classe: il
  // disegno del dado e' interamente in card.css, come il resto della grafica.
  const deployment = face.stats.deploymentCost;
  if (deployment) {
    const rolled = deployment.die !== undefined;
    const cost = element("div", rolled ? "cost die" : "cost");
    const base = rolled ? deployment.die.replace(/^d/, "") : String(deployment.base);
    const value = deployment.increment ? `${base}+${deployment.increment}` : base;
    if (rolled) {
      const label = cardCopy.card?.die ?? "Deployment die";
      cost.title = `${label} · ${deployment.die}`;
      cost.setAttribute("aria-label", `${label} ${deployment.die}`);
    }
    cost.append(element("i", "", value));
    bar.append(cost);
  } else if (face.stats.fluxCost !== undefined) {
    const cost = element("div", "cost");
    cost.append(element("i", "", String(face.stats.fluxCost)));
    bar.append(cost);
  } else if (face.kind === "nexus") {
    bar.append(createNexusMark(faceCopy.nexusAria ?? "Nexus"));
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

// Potenza (§6.3): due spade incrociate accanto alla cifra. Sta di fianco e non
// dietro al numero — dentro il quadrato le lame passavano sotto la cifra e si
// leggevano male. Il rombo, che prima incorniciava la Potenza, resta cosi'
// esclusivo del costo di Flusso.
function createPowerBadge(power, label) {
  const badge = element("div", "power-badge");
  badge.title = label;
  const svg = svgElement("svg", { viewBox: "0 0 24 24", "aria-label": label });
  svg.setAttribute("role", "img");
  const linea = (x1, y1, x2, y2, w) => svgElement("line", {
    x1, y1, x2, y2, stroke: "var(--ruby-light)", "stroke-width": w, "stroke-linecap": "round"
  });
  svg.append(
    // lame, dall'elsa in basso alla punta in alto
    linea(4.8, 19.2, 19.8, 4.2, 2),
    linea(19.2, 19.2, 4.2, 4.2, 2),
    // guardie, perpendicolari alla propria lama
    linea(4.3, 15.4, 8.6, 19.7, 1.5),
    linea(19.7, 15.4, 15.4, 19.7, 1.5),
    // pomoli
    svgElement("circle", { cx: "3.4", cy: "20.6", r: "1.15", fill: "var(--ruby-light)" }),
    svgElement("circle", { cx: "20.6", cy: "20.6", r: "1.15", fill: "var(--ruby-light)" })
  );
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

function createNexusMark(label) {
  const mark = element("div", "nexus-mark");
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
  // Il nome porta i due punti come le abilita' attivate e gli inneschi con
  // nome: e' la stessa relazione fra un'etichetta e cio' che spiega.
  row.append(
    element("span", "", `${keywordCopy.name ?? keyword.id}:`),
    element("span", "", keywordCopy.rules ?? "")
  );
  return row;
}

// Costo e nome scorrono in linea col testo, come le righe di Magic: nessuna
// colonna riservata, tutta la larghezza della textbox lavora per le parole.
function triggerCopyFor(trigger, faceCopy) {
  return faceCopy.triggers?.[trigger.displayKey ?? trigger.id]
    ?? faceCopy[trigger.displayKey]
    ?? {};
}

function triggerTagText(face, trigger, faceCopy) {
  return triggerCopyFor(trigger, faceCopy).trigger ?? faceCopy.trigger ?? trigger.event;
}

function triggerBody(trigger, faceCopy) {
  const triggerCopy = triggerCopyFor(trigger, faceCopy);
  const body = element("p", "body");
  // Gli effetti innescati non hanno nome proprio: li identifica l'etichetta
  // d'innesco. Il nome compare solo se una carta lo dichiara esplicitamente.
  if (triggerCopy.name) body.append(element("b", "", triggerCopy.name), ": ");
  body.append(triggerCopy.text ?? "");
  return body;
}

// Un blocco per etichetta d'innesco: se più trigger condividono la stessa
// etichetta (es. Antico del Bosco Errante, con due effetti "Quando entra in
// campo"), l'etichetta si stampa UNA volta sola e i testi vanno in fila.
function createTriggerGroup(face, triggers, faceCopy) {
  const block = element("div", "fx");
  block.append(element("span", "tag", triggerTagText(face, triggers[0], faceCopy)));
  for (const trigger of triggers) block.append(triggerBody(trigger, faceCopy));
  return block;
}

// Accorpa i trigger consecutivi con la stessa etichetta e li rende in blocchi.
function appendTriggerBlocks(box, face, triggers, faceCopy) {
  let index = 0;
  while (index < triggers.length) {
    const tag = triggerTagText(face, triggers[index], faceCopy);
    const group = [triggers[index]];
    let next = index + 1;
    while (next < triggers.length && triggerTagText(face, triggers[next], faceCopy) === tag) {
      group.push(triggers[next]);
      next += 1;
    }
    box.append(createTriggerGroup(face, group, faceCopy));
    index = next;
  }
}

function createActionBlock(action, faceCopy, cardCopy) {
  const actionCopy = faceCopy.abilities?.[action.displayKey] ?? {};
  const block = element("p", "ability");
  const healthCost = action.cost?.health;
  const healthGain = action.gain?.health;
  const fluxCost = action.cost?.flux;
  const cost = element("span", "hp-cost");
  // Non tutte le abilita del Rubyfront si pagano: alcune restituiscono PV, e
  // il segno e la sola cosa che distingue le due letture.
  if (healthCost !== undefined) {
    cost.append(`−${healthCost} ${cardCopy.card?.hp ?? "HP"}`);
  } else if (healthGain !== undefined) {
    cost.classList.add("hp-gain");
    cost.append(`+${healthGain} ${cardCopy.card?.hp ?? "HP"}`);
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

function createTextBox(face, faceCopy, cardCopy, localeId) {
  const box = element("div", "textbox");

  // Riga d'intestazione della descrizione: a sinistra il tipo della carta
  // (Entità — Auros, Materia Dimensionale I, Oggetto), a destra i MEDAGLIONI
  // delle Materie che la carta ABILITA e l'eventuale Contrattacco. Una sola
  // riga sopra il testo di regole (sostituisce la vecchia typeline e la
  // bottombar), così l'illustrazione ha più spazio.
  // Etichetta a sinistra: il tipo per Entità/Materia/Oggetto; per Rubyfront e
  // Nexus, che non hanno typeLabel, la parola "Rubifronte" / "Nexus" (invece di
  // lasciare vuoto).
  const kindLabels = copyFor(localeId).faceKind ?? {};
  const typeText = ((face.kind === "entity" || face.kind === "matter" || face.kind === "object") && cardCopy.typeLabel)
    ? cardCopy.typeLabel
    : (kindLabels[face.kind] ?? "");
  const idents = [];
  for (const matter of face.enablesMatters) idents.push(createMatter(matter, cardCopy));
  if (face.stats.counterattack !== undefined) {
    idents.push(createCounterattackBadge(face.stats.counterattack, cardCopy.card?.counterattack ?? "Counterattack"));
  }
  if (typeText || idents.length) {
    const head = element("div", "textline");
    head.append(element("span", "textline-type", typeText));
    if (idents.length) {
      const ident = element("span", "textline-ident");
      ident.append(...idents);
      head.append(ident);
    }
    box.append(head);
  }

  // Il requisito Nexus non ha etichetta scritta: lo identifica il simbolo
  // dei due anelli (lo stesso della faccia Nexus), in linea col testo.
  const nexusRequirement = face.requirements?.nexus;
  if (nexusRequirement) {
    const requirementCopy = cardCopy.card?.nexusRequirement ?? {};
    const block = element("p", "requirement");
    block.append(
      createNexusMark(requirementCopy.label ?? "Nexus requirement"),
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
      // Permanenti e Reattive dichiarano il comportamento (§7.2) con il proprio
      // simbolo e la parola in grassetto in testa al testo; il comportamento
      // normale non si stampa.
      if (face.behavior && face.behavior !== "normal") {
        const label = copyFor(localeId).behaviorNames?.[face.behavior]
          ?? cardCopy.card?.behaviors?.[face.behavior] ?? face.behavior;
        body.append(createBehaviorIcon(face.behavior, label), " ", element("b", "behavior-word", label), ". ");
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

  // Gli effetti continui di Rubyfront e Nexus (l'inno) sono regole statiche come
  // quelle delle Entità: testo semplice, **senza etichetta d'innesco** — non sono
  // momenti, sono stati. Le Entità sono escluse perché il ramo qui sopra le ha
  // già stampate: entrarci anche da qui le stamperebbe due volte.
  if (face.kind !== "entity") {
    for (const trigger of face.triggers.filter(t => STATIC_EVENTS.has(t.event))) {
      const staticCopy = faceCopy.triggers?.[trigger.displayKey] ?? faceCopy[trigger.displayKey];
      if (staticCopy?.text) box.append(element("p", "matter-effect", staticCopy.text));
    }
  }

  // Ordine di lettura: prima gli effetti d'ingresso/ricorrenti, poi le abilità
  // attivate, infine i trigger d'uscita (lascia il campo, morte) — così
  // un'abilità attivata non finisce mai sotto l'intestazione "quando lascia".
  const leadingTriggers = face.triggers.filter(trigger =>
    !TRAILING_EVENTS.has(trigger.event) && !STATIC_EVENTS.has(trigger.event));
  const trailingTriggers = face.triggers.filter(trigger => TRAILING_EVENTS.has(trigger.event));

  appendTriggerBlocks(box, face, leadingTriggers, faceCopy);
  for (const action of face.actions) box.append(createActionBlock(action, faceCopy, cardCopy));
  appendTriggerBlocks(box, face, trailingTriggers, faceCopy);

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

// Fit tipografico, come sulle carte stampate: quando il testo non entra nella
// textbox il corpo scende di mezzo punto per volta finche' ci sta. Tocca solo
// le facce che ne hanno bisogno — tutte le altre restano alla scala piena di
// 20px, che e' la misura Magic che il resto del foglio difende.
// Va chiamata DOPO l'inserimento nel documento: prima non c'e' nulla da
// misurare, e la carta uscirebbe tagliata in silenzio.
const FIT_STEPS = [1, 0.96, 0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.68];
// Passi di riduzione del NOME (in em rispetto alla carta): "" è la scala piena.
const NAME_FIT_STEPS = ["", "0.98em", "0.92em", "0.86em", "0.8em", "0.75em"];

function fitTextBoxes(root = document) {
  // Nome su UNA riga: se non entra nella barra del titolo, il suo corpo scende
  // finché ci sta — niente a-capo su due righe, niente puntini di troncamento.
  for (const name of root.querySelectorAll(".name")) {
    for (const step of NAME_FIT_STEPS) {
      name.style.fontSize = step;
      if (name.scrollWidth <= name.clientWidth) break;
    }
  }
  for (const box of root.querySelectorAll(".textbox")) {
    for (const step of FIT_STEPS) {
      box.style.fontSize = step === 1 ? "" : `${step}em`;
      if (box.scrollHeight <= box.clientHeight) break;
    }
  }
}

export { createFace, localized, fitTextBoxes };
