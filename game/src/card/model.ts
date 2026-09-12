// Che cosa si stampa su una faccia: il modello che il pittore disegna. Lo
// ricava dai dati del catalogo con la stessa logica di card-render.js
// (createFace, createTitleBar, createTextBox): il nome con la qualifica che
// scende nella riga del tipo, il costo (Flusso, dado, anelli del Nexus), i PV
// o la Potenza, le parole chiave, i blocchi del testo nell'ordine del sito —
// ingressi, abilità, uscite. Niente grafica qui: solo parole e valori.

import { getCard, localized, type CatalogCard } from "@rubyfront/core/cards";
import type { TintKind } from "./theme";

type Loose = Record<string, any>;

export interface Medallion {
  kind: "matter";
  type: string;
  grade: number | null;
  /** Il titolo (tooltip): serve solo alle viste, non si stampa. */
  title: string;
}

export interface CounterStat {
  kind: "counter";
  value: number;
}

export type TextBlock =
  | { kind: "requirement"; text: string }
  | { kind: "effect"; text: string; behavior: { id: "reactive" | "permanent"; label: string } | null }
  | { kind: "fx"; tag: string; bodies: { name: string | null; text: string }[] }
  | { kind: "ability"; cost: { kind: "hp" | "gain" | "flux" | "none"; value: string }; name: string; text: string };

export interface FaceModel {
  cardId: string;
  faceId: string;
  kind: "rubyfront" | "nexus" | "entity" | "object" | "matter";
  tint: TintKind;
  /** L'illustrazione (url completo) e la sua inquadratura; null senza. */
  art: { src: string; shift: string | null; zoom: string | null; focusX: string | null; veil: number | null; dim: number | null } | null;
  /** Rubyfront, Nexus e le carte con `fullArt`: l'illustrazione fa da sfondo. */
  fullArt: boolean;
  /** Il segnaposto quando manca l'illustrazione. */
  placeholder: string;
  cost: { kind: "flux"; value: string } | { kind: "die"; value: string } | { kind: "nexus" } | null;
  unique: boolean;
  title: string;
  right: { kind: "hp"; value: string; label: string } | { kind: "power"; value: number } | { kind: "matter"; matter: Medallion } | { kind: "none" } | { kind: "dash" };
  keywords: { name: string; rules: string }[];
  /** Il rombo fra due fili sotto l'arte, sulle facce Nexus. */
  divider: boolean;
  textline: { type: string; idents: (Medallion | CounterStat)[] } | null;
  blocks: TextBlock[];
  code: string;
}

// Le parole d'interfaccia della carta (docs/cards/ui/shell.js, copyFor).
const FACE_KIND: Record<string, Record<string, string>> = {
  it: { rubyfront: "Rubifronte", nexus: "Nexus" },
  en: { rubyfront: "Rubyfront", nexus: "Nexus" },
};
const BEHAVIOR_NAMES: Record<string, Record<string, string>> = {
  it: { reactive: "Reattiva", permanent: "Permanente" },
  en: { reactive: "Reactive", permanent: "Permanent" },
};

const TRAILING_EVENTS = new Set(["on_leave_field", "on_death", "on_retire"]);
const STATIC_EVENTS = new Set(["while_in_play", "while_assigned"]);
const TINT_ORDER: TintKind[] = ["destructive", "dimensional", "dynamic"];

function tintFor(face: Loose): TintKind {
  const types = new Set<string>((face.enablesMatters ?? []).map((matter: Loose) => matter.type));
  if (face.matter?.type) types.add(face.matter.type);
  return TINT_ORDER.find(type => types.has(type)) ?? "dynamic";
}

function splitFaceName(face: Loose, faceCopy: Loose): { title: string; epithet?: string } {
  const full: string = faceCopy.name ?? face.id;
  if (face.kind !== "rubyfront" && face.kind !== "nexus") return { title: full };
  const comma = full.indexOf(", ");
  if (comma === -1) return { title: full };
  return { title: full.slice(0, comma), epithet: full.slice(comma + 2) };
}

function matterOf(matter: Loose, cardCopy: Loose): Medallion {
  return {
    kind: "matter",
    type: matter.type,
    grade: matter.maxGrade ?? matter.grade ?? null,
    title: cardCopy.matters?.[`${matter.type}Title`] ?? matter.type,
  };
}

function triggerCopyFor(trigger: Loose, faceCopy: Loose): Loose {
  return faceCopy.triggers?.[trigger.displayKey ?? trigger.id] ?? faceCopy[trigger.displayKey] ?? {};
}

function triggerTagText(trigger: Loose, faceCopy: Loose): string {
  return triggerCopyFor(trigger, faceCopy).trigger ?? faceCopy.trigger ?? trigger.event;
}

/** Un blocco per etichetta d'innesco: i trigger consecutivi con la stessa etichetta si accorpano. */
function triggerBlocks(triggers: Loose[], faceCopy: Loose): TextBlock[] {
  const out: TextBlock[] = [];
  let index = 0;
  while (index < triggers.length) {
    const tag = triggerTagText(triggers[index], faceCopy);
    const group = [triggers[index]];
    let next = index + 1;
    while (next < triggers.length && triggerTagText(triggers[next], faceCopy) === tag) {
      group.push(triggers[next]);
      next += 1;
    }
    const seen = new Set<Loose>();
    const bodies: { name: string | null; text: string }[] = [];
    for (const trigger of group) {
      const copy = triggerCopyFor(trigger, faceCopy);
      if (seen.has(copy)) continue;
      seen.add(copy);
      bodies.push({ name: copy.name ?? null, text: copy.text ?? "" });
    }
    out.push({ kind: "fx", tag, bodies });
    index = next;
  }
  return out;
}

function abilityBlock(action: Loose, faceCopy: Loose, cardCopy: Loose): TextBlock {
  const actionCopy = faceCopy.abilities?.[action.displayKey] ?? {};
  const hp = cardCopy.card?.hp ?? "HP";
  let cost: { kind: "hp" | "gain" | "flux" | "none"; value: string };
  if (action.cost?.health !== undefined) cost = { kind: "hp", value: `−${action.cost.health} ${hp}` };
  else if (action.gain?.health !== undefined) cost = { kind: "gain", value: `+${action.gain.health} ${hp}` };
  else if (action.cost?.flux !== undefined) cost = { kind: "flux", value: String(action.cost.flux) };
  else cost = { kind: "none", value: "—" };
  return { kind: "ability", cost, name: actionCopy.name ?? action.id, text: actionCopy.text ?? "" };
}

function artOf(card: Loose, face: Loose): FaceModel["art"] {
  const owner = face.source?.art ? face : card;
  const relative = owner.source?.art;
  if (typeof relative !== "string") return null;
  return {
    src: new URL(relative, new URL("./", CARDS_BASE_URL())).href,
    shift: face.artShift ?? card.artShift ?? null,
    zoom: face.artZoom ?? card.artZoom ?? null,
    focusX: face.artFocusX ?? card.artFocusX ?? null,
    veil: face.artVeil ?? card.artVeil ?? null,
    dim: face.artDim ?? card.artDim ?? null,
  };
}

// La base dei percorsi del catalogo: come catalog.js, i percorsi in `source`
// sono relativi a docs/cards/. Una funzione, così i test senza pagina non la toccano.
let cardsBase = "/cards/";
export function setCardsBase(base: string): void {
  cardsBase = base;
}
function CARDS_BASE_URL(): string {
  return new URL(cardsBase, typeof document === "undefined" ? "http://localhost/" : document.baseURI).href;
}

export function faceModel(cardId: string, faceId: string, locale: string): FaceModel | null {
  const card = getCard(cardId) as (CatalogCard & Loose) | undefined;
  const face = card?.faces.find(entry => entry.id === faceId) as Loose | undefined;
  if (!card || !face) return null;
  const cardCopy: Loose = localized(card, locale) ?? {};
  const faceCopy: Loose = cardCopy[face.displayKey] ?? {};
  const art = artOf(card, face);
  const fullArt = Boolean(art) && (face.kind === "rubyfront" || face.kind === "nexus" || face.fullArt === true || card.fullArt === true);

  // Il costo (§3.1 schieramento, §3.2 Flusso) o il simbolo del Nexus.
  let cost: FaceModel["cost"] = null;
  const deployment = face.stats?.deploymentCost;
  if (deployment) {
    const rolled = deployment.die !== undefined;
    const base = rolled ? String(deployment.die).replace(/^d/, "") : String(deployment.base);
    const value = deployment.increment ? `${base}+${deployment.increment}` : base;
    cost = rolled ? { kind: "die", value } : { kind: "flux", value };
  } else if (face.stats?.fluxCost !== undefined) {
    cost = { kind: "flux", value: String(face.stats.fluxCost) };
  } else if (face.kind === "nexus") {
    cost = { kind: "nexus" };
  }

  let right: FaceModel["right"];
  const hpValue = face.stats?.health ?? (face.stats?.healthRecovery !== undefined ? `+${face.stats.healthRecovery}` : undefined);
  if (hpValue !== undefined) right = { kind: "hp", value: String(hpValue), label: cardCopy.card?.hp ?? "HP" };
  else if (face.stats?.power !== undefined) right = { kind: "power", value: face.stats.power };
  else if (face.kind === "matter" && face.matter) right = { kind: "matter", matter: matterOf(face.matter, cardCopy) };
  else if (face.kind === "object") right = { kind: "none" };
  else right = { kind: "dash" };

  const keywords = (face.keywords ?? []).map((keyword: Loose) => {
    const copy = faceCopy.keywords?.[keyword.displayKey ?? keyword.id] ?? (face.keywords.length === 1 ? faceCopy.keyword : undefined) ?? {};
    return { name: `${copy.name ?? keyword.id}:`, rules: copy.rules ?? "" };
  });

  // La riga del tipo: il tipo (o la qualifica del nome) e i medaglioni.
  const kinds = FACE_KIND[locale] ?? FACE_KIND.en;
  const typeText =
    (face.kind === "entity" || face.kind === "matter" || face.kind === "object") && cardCopy.typeLabel
      ? cardCopy.typeLabel
      : (splitFaceName(face, faceCopy).epithet ?? kinds[face.kind] ?? "");
  const idents: (Medallion | CounterStat)[] = (face.enablesMatters ?? []).map((matter: Loose) => matterOf(matter, cardCopy));
  if (face.stats?.counterattack !== undefined) idents.push({ kind: "counter", value: face.stats.counterattack });
  const textline = typeText || idents.length ? { type: typeText, idents } : null;

  const blocks: TextBlock[] = [];
  const requirement = face.requirements?.nexus;
  if (requirement) blocks.push({ kind: "requirement", text: cardCopy.card?.nexusRequirement?.text ?? "" });

  if (face.kind === "matter" || face.kind === "object") {
    if (faceCopy.effect?.text) {
      const behavior =
        face.behavior && face.behavior !== "normal"
          ? { id: face.behavior as "reactive" | "permanent", label: (BEHAVIOR_NAMES[locale] ?? BEHAVIOR_NAMES.en)[face.behavior] ?? cardCopy.card?.behaviors?.[face.behavior] ?? face.behavior }
          : null;
      blocks.push({ kind: "effect", text: faceCopy.effect.text, behavior });
    }
  } else {
    if (face.kind === "entity" && faceCopy.effect?.text) blocks.push({ kind: "effect", text: faceCopy.effect.text, behavior: null });
    if (face.kind !== "entity") {
      for (const trigger of (face.triggers ?? []).filter((entry: Loose) => STATIC_EVENTS.has(entry.event))) {
        const staticCopy = faceCopy.triggers?.[trigger.displayKey] ?? faceCopy[trigger.displayKey];
        if (staticCopy?.text) blocks.push({ kind: "effect", text: staticCopy.text, behavior: null });
      }
    }
    const triggers: Loose[] = face.triggers ?? [];
    blocks.push(...triggerBlocks(triggers.filter(entry => !TRAILING_EVENTS.has(entry.event) && !STATIC_EVENTS.has(entry.event)), faceCopy));
    for (const action of face.actions ?? []) blocks.push(abilityBlock(action, faceCopy, cardCopy));
    blocks.push(...triggerBlocks(triggers.filter(entry => TRAILING_EVENTS.has(entry.event)), faceCopy));
  }

  return {
    cardId: card.id,
    faceId: face.id,
    kind: face.kind,
    tint: tintFor(face),
    art,
    fullArt,
    placeholder: cardCopy.card?.illustration ?? "Illustration",
    cost,
    unique: Boolean(card.unique),
    title: splitFaceName(face, faceCopy).title,
    right,
    keywords,
    divider: face.kind === "nexus",
    textline,
    blocks,
    code: card.id,
  };
}
