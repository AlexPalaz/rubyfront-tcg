// Ponte verso la grafica vera delle carte.
//
// Il simulatore NON ridisegna le carte: usa docs/cards/ui/card-render.js, lo
// stesso modulo che disegna la pagina della carta e quella del mazzo. Una sola
// fonte per la grafica — se cambia card.css cambia anche qui, senza toccare
// niente.
//
// Quei moduli sono caricati a runtime, non importati da Vite: `catalog.js`
// risolve catalog.json e le illustrazioni con `new URL(..., import.meta.url)`,
// e dentro un chunk bundlato `import.meta.url` punterebbe al chunk. Caricati
// dal loro percorso vero, invece, risolvono tutto come sul sito.

/** La carta a grandezza piena, come la disegna il renderer del sito. */
export const CARD_W = 520;
export const CARD_H = 728;
/** La misura in cui le carte stanno sul tavolo: la stessa della pagina Mazzo. */
export const TILE_W = 302;
export const TILE_H = 424;
export const TILE_SCALE = TILE_W / CARD_W;

import type { AttackDraw, EnterControl, EnterListener, EnterLook, EnterMove, EnterReturn } from "./ctx.js";

export interface CardFace {
  id: string;
  kind: "rubyfront" | "nexus" | "entity" | "object" | "matter";
  displayKey: string;
  /** Le statistiche stampate (dal file dati della carta): qui contano
      quelle del combattimento, Potenza e «Contrattacco +N» (§6.3). */
  stats?: { power?: unknown; counterattack?: unknown; fluxCost?: unknown; deploymentCost?: unknown };
  /** Gli inneschi della faccia (dal file dati): qui conta l'evento
      `on_enter_field`, «quando entra in campo». */
  triggers?: { event?: unknown; displayKey?: unknown; id?: unknown; details?: unknown; effect?: unknown }[];
  race?: unknown;
  /** Il comportamento di una Materia (§7.2). */
  behavior?: unknown;
  /** Le parole chiave stampate (§8.1): `{ id: "surge" }`… */
  keywords?: unknown[];
}

export interface CatalogCard {
  id: string;
  faces: CardFace[];
  locales: Record<string, Record<string, any>>;
  defaultLocale: string;
  [key: string]: unknown;
}

export interface CatalogDeck {
  id: string;
  theme?: string;
  locales: Record<string, { name: string; description?: string }>;
  defaultLocale: string;
  cards: { card: string; count: number }[];
}

interface RendererModule {
  createFace(card: unknown, face: unknown, cardCopy: unknown, themeId: string, localeId: string): HTMLElement;
  localized(resource: unknown, localeId: string): any;
  fitTextBoxes(root?: Element | Document): void;
}

interface CatalogModule {
  default: { cards: CatalogCard[]; decks?: CatalogDeck[] };
  getCardById(id: string): CatalogCard | undefined;
  getDeckById(id: string): CatalogDeck | undefined;
}

interface ThemesModule {
  DEFAULT_THEME: string;
  LIGHT_THEMES: Set<string>;
}

/**
 * Il sito sta una cartella sopra il simulatore, sia in sviluppo
 * (/simulatore/ → /cards/) sia su GitHub Pages
 * (/rubyfront-tcg/simulatore/ → /rubyfront-tcg/cards/).
 */
const SITE_UI = new URL("../cards/ui/", document.baseURI);

let renderer: RendererModule;
let catalog: CatalogModule;
let themes: ThemesModule;

export async function loadRenderer(): Promise<void> {
  // Gli stili della carta arrivano dal sito, non da un foglio nostro: sono
  // 1200 righe che devono restare uguali a quelle della pagina del mazzo.
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("card.css", SITE_UI).href;
  const styleLoaded = new Promise<void>(resolve => {
    link.addEventListener("load", () => resolve());
    link.addEventListener("error", () => resolve());
  });
  document.head.append(link);

  [renderer, catalog, themes] = await Promise.all([
    import(/* @vite-ignore */ new URL("card-render.js", SITE_UI).href) as Promise<RendererModule>,
    import(/* @vite-ignore */ new URL("../catalog.js", SITE_UI).href) as Promise<CatalogModule>,
    import(/* @vite-ignore */ new URL("themes.js", SITE_UI).href) as Promise<ThemesModule>,
  ]);
  await styleLoaded;
}

export function getCard(cardId: string): CatalogCard | undefined {
  return catalog.getCardById(cardId);
}

export function allDecks(): CatalogDeck[] {
  return catalog.default.decks ?? [];
}

export function getDeck(deckId: string): CatalogDeck | undefined {
  return catalog.getDeckById(deckId);
}

/** Tutto il catalogo, per lo strumento di prova «Evoca». */
export function allCards(): CatalogCard[] {
  return catalog.default.cards;
}

export function defaultTheme(): string {
  return themes.DEFAULT_THEME;
}

export function cardName(cardId: string, locale: string): string {
  const card = getCard(cardId);
  if (!card) return cardId;
  const copy = renderer.localized(card, locale);
  return copy?.name ?? cardId;
}

/**
 * Testo cercabile di una carta: nome più il testo di tutte le facce, così
 * "cerca nel mazzo" trova anche per abilità e non solo per nome.
 */
export function cardSearchText(cardId: string, locale: string): string {
  const card = getCard(cardId);
  if (!card) return cardId;
  const copy = renderer.localized(card, locale);
  const parts: string[] = [cardId];
  const collect = (value: unknown): void => {
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(copy);
  return parts.join(" ").toLowerCase();
}

/**
 * Disegna una faccia a grandezza piena (520×728). Chi la monta decide la
 * scala con un transform: il renderer lavora sempre a misura vera, altrimenti
 * `fitTextBoxes` misurerebbe una carta rimpicciolita e sbaglierebbe il corpo
 * del testo.
 */
export function renderFace(cardId: string, faceIndex: number, themeId: string, locale: string): HTMLElement | null {
  const card = getCard(cardId);
  if (!card) return null;
  const face = card.faces[faceIndex] ?? card.faces[0];
  if (!face) return null;
  const copy = renderer.localized(card, locale);
  const holder = document.createElement("div");
  holder.className = "card-holder";
  holder.append(renderer.createFace(card, face, copy, themeId, locale));
  return holder;
}

/** Va chiamata dopo aver montato le carte: rimpicciolisce i testi che sbordano. */
export function fitTexts(root: Element): void {
  renderer.fitTextBoxes(root);
  // Il fit del sito accetta "entra al pelo". Blink lascia comunque respiro,
  // ma WebKit impagina le stesse righe un filo più alte: su iPad il testo
  // arrivava a filo del codice carta. Qui — solo nel simulatore — si esige un
  // minimo di aria sotto l'ultima riga, e se manca si scende ancora di un
  // passo. La misura è fatta sui rettangoli a schermo riportati in misura di
  // layout, così vale anche dentro le tessere scalate.
  for (const box of root.querySelectorAll<HTMLElement>(".textbox")) {
    for (let guard = 0; guard < 3 && textboxSlack(box) < 14; guard += 1) {
      const current = parseFloat(box.style.fontSize) || 1;
      if (current <= 0.6) break;
      box.style.fontSize = `${Math.round((current - 0.04) * 100) / 100}em`;
    }
  }
}

/** Aria (in px di layout) fra l'ultima riga di contenuto e il fondo della textbox. */
function textboxSlack(box: HTMLElement): number {
  const rect = box.getBoundingClientRect();
  if (rect.height === 0) return Number.POSITIVE_INFINITY;
  let contentBottom = Number.NEGATIVE_INFINITY;
  for (const child of box.children) {
    const style = getComputedStyle(child);
    // Il codice carta è assoluto sul fondo e il flavor è nascosto: non sono
    // "contenuto" da cui misurare.
    if (style.display === "none" || style.position === "absolute") continue;
    contentBottom = Math.max(contentBottom, child.getBoundingClientRect().bottom);
  }
  if (contentBottom === Number.NEGATIVE_INFINITY) return Number.POSITIVE_INFINITY;
  // Da misura a schermo a misura di layout: la tessera può essere scalata.
  return (rect.bottom - contentBottom) * (box.offsetHeight / rect.height);
}

export function faceCount(cardId: string): number {
  return getCard(cardId)?.faces.length ?? 1;
}

/** Che tipo di faccia sta mostrando la carta: serve a distinguere le Entità. */
export function faceKind(cardId: string, faceIndex: number): CardFace["kind"] | null {
  const card = getCard(cardId);
  const face = card?.faces[faceIndex] ?? card?.faces[0];
  return face?.kind ?? null;
}

/**
 * Potenza e Contrattacco stampati (§6.3), dalla faccia Entità della carta:
 * `null` dove non ci sono — una Materia non ha Potenza, un'Entità senza la
 * statistica non contrattacca. Solo interi, come nell'anagrafe dell'engine:
 * un valore d'altra forma resta ignoto, mai frainteso.
 */
/** I testi degli effetti «quando attacca» di una faccia, per la scena. */
export function attackEffects(cardId: string, faceIndex: number, locale: string): { tag: string; text: string }[] {
  return effectsFor(cardId, faceIndex, locale, ["on_attack"]);
}

/** Gli eventi che «scattano» quando la carta scende: per Entità e Oggetti
    «quando entra in campo»; per le Materie l'effetto si risolve giocandole
    (§7.2, `on_resolve`) o dura finché restano (`while_in_play`). */
const ENTER_EVENTS: Record<string, string[]> = {
  entity: ["on_enter_field"],
  object: ["on_enter_field"],
  matter: ["on_resolve", "while_in_play"],
};

/**
 * Gli effetti che scattano quando una carta scende dalla mano, col testo
 * nella lingua del tavolo: la targhetta (es. «Effetto») e la frase. Il
 * testo sta nel copy della faccia sotto il displayKey dell'innesco, come
 * lo legge il renderer del sito. Vuoto se la carta non ne ha.
 */
export function enterEffects(cardId: string, faceIndex: number, locale: string): { tag: string; text: string }[] {
  const card = getCard(cardId);
  const face = card?.faces[faceIndex] ?? card?.faces[0];
  if (!card || !face) return [];
  return effectsFor(cardId, faceIndex, locale, ENTER_EVENTS[face.kind] ?? []);
}

function effectsFor(cardId: string, faceIndex: number, locale: string, events: string[]): { tag: string; text: string }[] {
  const card = getCard(cardId);
  const face = card?.faces[faceIndex] ?? card?.faces[0];
  if (!card || !face) return [];
  const copy = renderer.localized(card, locale);
  const faceCopy = copy?.[face.displayKey] ?? {};
  const out: { tag: string; text: string }[] = [];
  for (const trigger of face.triggers ?? []) {
    if (typeof trigger.event !== "string" || !events.includes(trigger.event)) continue;
    const key = typeof trigger.displayKey === "string" ? trigger.displayKey : typeof trigger.id === "string" ? trigger.id : "";
    const entry = faceCopy.triggers?.[key] ?? faceCopy[key];
    if (entry && typeof entry.text === "string") out.push({ tag: typeof entry.trigger === "string" ? entry.trigger : "Effetto", text: entry.text });
  }
  return out;
}

/**
 * Gli ascoltatori d'ingresso certificati di una faccia (§8.2): evento
 * `on_enter_field` con `enteringCard` (un'altra Entità del controllore,
 * `excludeSelf`), `requiresControlledAtLeast` (N Entità, con razza) ed
 * effetto `draw_card` per il controllore. Specchio di card_index.rb,
 * enter_listeners: forma diversa, niente — l'effetto resta a mano.
 */
function enterListenersOf(face: CardFace | undefined): EnterListener[] {
  const out: EnterListener[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_enter_field") continue;
    const details = trigger.details as { enteringCard?: any; requiresControlledAtLeast?: any } | undefined;
    const effect = trigger.effect as { type?: unknown; count?: unknown; target?: { controller?: unknown } } | undefined;
    const entering = details?.enteringCard;
    const requires = details?.requiresControlledAtLeast;
    if (!entering || !requires || !effect) continue;
    if (effect.type !== "draw_card" || !Number.isInteger(effect.count) || effect.target?.controller !== "controller") continue;
    if (entering.cardType !== "entity" || entering.controller !== "controller" || entering.excludeSelf !== true) continue;
    if (!Number.isInteger(requires.count) || requires.filter?.cardType !== "entity" || requires.filter?.controller !== "controller") continue;
    out.push({
      enteringRace: typeof entering.race === "string" ? entering.race : null,
      requires: { count: requires.count as number, race: typeof requires.filter.race === "string" ? requires.filter.race : null },
      draw: effect.count as number,
    });
  }
  return out;
}

/**
 * Gli spostamenti all'ingresso certificati di una faccia (§8.2): evento
 * `on_enter_field` senza `enteringCard` (è questa carta che entra), effetto
 * `move_card` con bersaglio un'Entità avversaria sul Fronte (una sola) e
 * destinazione la Zona di Ritiro. Specchio di card_index.rb, enter_moves.
 */
function enterMovesOf(face: CardFace | undefined): EnterMove[] {
  const out: EnterMove[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_enter_field") continue;
    const details = trigger.details as { enteringCard?: unknown } | undefined;
    if (details?.enteringCard) continue;
    const effect = trigger.effect as { type?: unknown; target?: any; destination?: any } | undefined;
    if (!effect || effect.type !== "move_card") continue;
    const target = effect.target;
    const destination = effect.destination;
    if (!target || target.cardType !== "entity" || target.controller !== "opponent" || target.zone !== "front") continue;
    if (target.min !== 1 || target.max !== 1) continue;
    if (!destination || destination.zone !== "retire") continue;
    out.push({ target: { kind: "entity", controller: "opponent" }, to: "ritiro" });
  }
  return out;
}

/**
 * I ritorni all'ingresso certificati di una faccia (§8.2): evento
 * `on_enter_field` senza `enteringCard`, effetto `move_card` da
 * `{zone: retire, owner: controller}` di UNA carta del controllore con
 * `details.permanent`, destinazione `{zone: front}`. Specchio di
 * card_index.rb, enter_returns.
 */
function enterReturnsOf(face: CardFace | undefined, event: "on_enter_field" | "on_attack"): EnterReturn[] {
  const out: EnterReturn[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== event) continue;
    const details = trigger.details as { enteringCard?: unknown } | undefined;
    if (details?.enteringCard) continue;
    const effect = trigger.effect as { type?: unknown; target?: any; from?: any; destination?: any } | undefined;
    if (!effect || effect.type !== "move_card") continue;
    const target = effect.target;
    if (!target || target.controller !== "controller" || target.min !== 1 || target.max !== 1 || target.details?.permanent !== true) continue;
    if (effect.from?.zone !== "retire" || effect.from?.owner !== "controller") continue;
    if (effect.destination?.zone !== "front") continue;
    out.push({ from: "ritiro", filter: { kind: "matter", behavior: "permanent" }, to: "field" });
  }
  return out;
}

/**
 * Le pesche all'attacco certificate (§8.2, RBF-026): evento `on_attack`
 * con `oncePerEachOfYourTurns` e `requiresObjectAssigned`, effetto
 * `draw_card` del controllore con `count` intero; `thenDiscardCards`
 * certificato solo a 1. Specchio di card_index.rb, attack_draws.
 */
function attackDrawsOf(face: CardFace | undefined): AttackDraw[] {
  const out: AttackDraw[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_attack") continue;
    const details = trigger.details as { oncePerEachOfYourTurns?: unknown; requiresObjectAssigned?: unknown } | undefined;
    const effect = trigger.effect as { type?: unknown; count?: unknown; target?: any; details?: any } | undefined;
    if (!details || !effect || effect.type !== "draw_card" || !Number.isInteger(effect.count)) continue;
    if (effect.target?.controller !== "controller") continue;
    if (details.oncePerEachOfYourTurns !== true || details.requiresObjectAssigned !== true) continue;
    const thenDiscard = effect.details?.thenDiscardCards;
    if (thenDiscard !== undefined && thenDiscard !== 1) continue;
    out.push({ draw: effect.count as number, thenDiscard: thenDiscard ?? 0, requiresObject: true });
  }
  return out;
}

/**
 * Gli sguardi nel mazzo certificati (§8.2): evento `on_enter_field` senza
 * `enteringCard`, effetto `look_and_optionally_move` dalla cima del
 * proprio mazzo con `count` intero, `mayReveal` un'Entità (con razza) che
 * va in mano, `restTo` in fondo al mazzo. Specchio di card_index.rb.
 */
function enterLooksOf(face: CardFace | undefined): EnterLook[] {
  const out: EnterLook[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_enter_field") continue;
    const details = trigger.details as { enteringCard?: unknown } | undefined;
    if (details?.enteringCard) continue;
    const effect = trigger.effect as { type?: unknown; from?: any; details?: any } | undefined;
    if (!effect || effect.type !== "look_and_optionally_move") continue;
    const from = effect.from;
    const d = effect.details;
    if (!from || from.zone !== "deck" || from.owner !== "controller" || from.position !== "top") continue;
    if (!d || d.revealTo?.zone !== "hand" || d.restTo?.zone !== "deck" || d.restTo?.position !== "bottom") continue;
    const may = d.mayReveal;
    if (!may || (may.cardType !== "entity" && may.cardType !== "object")) continue;
    // Il conto: fisso (RBF-006), o col dado «2 + ceil(result/2)» (RBF-027),
    // la sola formula certificata.
    let count: number | null = null;
    let die: number | null = null;
    let countBase = 0;
    if (Number.isInteger(from.count)) count = from.count as number;
    else {
      const faces = typeof d.die === "string" ? /^d(\d+)$/.exec(d.die) : null;
      const formula = typeof d.count === "string" ? /^(\d+) \+ ceil\(result\/2\)$/.exec(d.count) : null;
      if (!faces || !formula) continue;
      die = Number(faces[1]);
      countBase = Number(formula[1]);
    }
    const then = d.thenMoveOneTo;
    if (then && then.zone !== "retire") continue;
    out.push({
      count,
      die,
      countBase,
      reveal: { kind: may.cardType, race: typeof may.race === "string" ? may.race : null },
      thenRetire: Boolean(then),
    });
  }
  return out;
}

/**
 * I controlli all'ingresso certificati (§8.2): evento `on_enter_field`
 * senza `enteringCard`, effetto `gain_control` di UN'Entità avversaria
 * (con al più una condizione sul costo di Flusso, `flux_cost lte N`),
 * durata `until_end_of_turn`, con le parole chiave concesse. Specchio di
 * card_index.rb, enter_controls.
 */
function enterControlsOf(face: CardFace | undefined): EnterControl[] {
  const out: EnterControl[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_enter_field") continue;
    const details = trigger.details as { enteringCard?: unknown } | undefined;
    if (details?.enteringCard) continue;
    const effect = trigger.effect as { type?: unknown; target?: any; duration?: unknown; details?: any } | undefined;
    if (!effect || effect.type !== "gain_control" || effect.duration !== "until_end_of_turn") continue;
    const target = effect.target;
    if (!target || target.cardType !== "entity" || target.controller !== "opponent" || target.min !== 1 || target.max !== 1) continue;
    const conditions: any[] = Array.isArray(target.conditions) ? target.conditions : [];
    let maxCost: number | null = null;
    let certified = true;
    for (const condition of conditions) {
      if (condition?.stat === "flux_cost" && condition.operator === "lte" && Number.isInteger(condition.value)) maxCost = condition.value;
      else certified = false;
    }
    if (!certified) continue;
    const grants = Array.isArray(effect.details?.grants) ? effect.details.grants.filter((g: unknown) => typeof g === "string") : [];
    out.push({ target: { kind: "entity", controller: "opponent", maxCost }, grants });
  }
  return out;
}

/** Il costo di schieramento del Rubyfront (§3.1): fisso, o un dado. */
export interface Deployment {
  fixed: number | null;
  die: number | null;
}

export function cardStats(cardId: string): {
  kind: CardFace["kind"] | null;
  race: string | null;
  power: number | null;
  counterattack: number | null;
  fluxCost: number | null;
  keywords: string[];
  deployment: Deployment | null;
  enterListeners: EnterListener[];
  enterMoves: EnterMove[];
  behavior: string | null;
  enterReturns: EnterReturn[];
  enterLooks: EnterLook[];
  enterControls: EnterControl[];
  attackReturns: EnterReturn[];
  attackDraws: AttackDraw[];
} {
  const card = getCard(cardId);
  const face = card?.faces.find(candidate => candidate.kind === "entity") ?? card?.faces[0];
  const integer = (value: unknown): number | null => (Number.isInteger(value) ? (value as number) : null);
  return {
    kind: face?.kind ?? null,
    race: typeof face?.race === "string" ? face.race : null,
    // Le parole chiave stampate sulla faccia (§8.1). Specchio di card_index.rb, keywords.
    keywords: ((face?.keywords ?? []) as unknown[]).flatMap(keyword =>
      typeof keyword === "object" && keyword !== null && typeof (keyword as { id?: unknown }).id === "string" ? [(keyword as { id: string }).id] : []
    ),
    enterListeners: enterListenersOf(face),
    enterMoves: enterMovesOf(face),
    behavior: typeof face?.behavior === "string" ? face.behavior : null,
    enterReturns: enterReturnsOf(face, "on_enter_field"),
    attackReturns: enterReturnsOf(face, "on_attack"),
    attackDraws: attackDrawsOf(face),
    enterLooks: enterLooksOf(face),
    enterControls: enterControlsOf(face),
    power: integer(face?.stats?.power),
    counterattack: integer(face?.stats?.counterattack),
    // Il costo di Flusso stampato (§3.2); il Rubyfront ha il costo di
    // schieramento, un'altra cosa, e qui resta null.
    fluxCost: integer(face?.stats?.fluxCost),
    deployment: deploymentOf(face?.stats?.deploymentCost),
  };
}

/**
 * Il costo di schieramento com'è nei dati: `3`, `{ base: 3 }` o
 * `{ die: "d6" }` (§3.1, «un numero fisso oppure un dado»). Forma ignota:
 * null, e lo schieramento si regola a mano.
 */
function deploymentOf(value: unknown): Deployment | null {
  if (Number.isInteger(value)) return { fixed: value as number, die: null };
  if (!value || typeof value !== "object") return null;
  const raw = value as { base?: unknown; die?: unknown };
  if (Number.isInteger(raw.base)) return { fixed: raw.base as number, die: null };
  const die = typeof raw.die === "string" ? /^d(\d+)$/.exec(raw.die) : null;
  if (die) return { fixed: null, die: Number(die[1]) };
  return null;
}

/** Il Rubyfront non si pesca mai (§3.1): parte in Zona di Richiamo. */
export function isRubyfront(cardId: string): boolean {
  return getCard(cardId)?.faces.some(face => face.kind === "rubyfront") ?? false;
}
