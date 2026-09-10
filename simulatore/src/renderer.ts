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

import type { Phase } from "./types.js";
import type { AttackDraw, AttackForm, EnterControl, EnterDisarm, EnterListener, EnterLook, EnterRearm, EnterRefresh, EnterMove, EnterReturn, FlipForm, LeaveReturn, NexusRequirement, ResolveForm, StaticForm, Ability, AbilityForm } from "./ctx.js";

export interface CardFace {
  id: string;
  kind: "rubyfront" | "nexus" | "entity" | "object" | "matter";
  displayKey: string;
  /** Le statistiche stampate (dal file dati della carta): qui contano
      quelle del combattimento, Potenza e «Contrattacco +N» (§6.3). */
  stats?: { power?: unknown; counterattack?: unknown; health?: unknown; fluxCost?: unknown; deploymentCost?: unknown; healthRecovery?: unknown };
  /** Gli inneschi della faccia (dal file dati): qui conta l'evento
      `on_enter_field`, «quando entra sul Fronte». */
  triggers?: { event?: unknown; displayKey?: unknown; id?: unknown; details?: unknown; effect?: unknown }[];
  race?: unknown;
  /** Il comportamento di una Materia (§7.2). */
  behavior?: unknown;
  /** Le parole chiave stampate (§8.1): `{ id: "surge" }`… */
  keywords?: unknown[];
  /** I requisiti della faccia (dal file dati): qui conta `nexus`, il flip (§3.1). */
  requirements?: unknown;
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
 * (/simulatore/ → /cards/) sia sul sito pubblicato (/ → /catalog/cards/).
 */
// Dove sta la grafica delle carte: in sviluppo ../cards/ui/ (la pagina è a
// /simulatore/, le carte a /cards), in produzione ./catalog/cards/ui/ (il
// gioco è la radice, il catalogo sotto /catalog). Lo dice vite.config.ts.
const SITE_UI = new URL((import.meta.env.VITE_CARDS_UI as string | undefined) ?? "../cards/ui/", document.baseURI);

/** L'illustrazione di una carta (docs/cards/art), per gli sfondi della home. */
export function artUrl(cardId: string): string {
  return new URL(`../art/${cardId.toLowerCase()}.jpg`, SITE_UI).href;
}

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

/** La TINTA di una carta secondo la sua Materia (stessa regola del renderer,
    card-render.js: la Materia della carta Materia o quelle che la faccia
    abilita; Distruttiva > Dimensionale > Dinamica; senza Materia, Dinamica). */
export type Tint = "destructive" | "dimensional" | "dynamic";
const TINT_ORDER: Tint[] = ["destructive", "dimensional", "dynamic"];
export function cardTint(cardId: string): Tint {
  const card = getCard(cardId);
  const types = new Set<string>();
  for (const face of card?.faces ?? []) {
    const f = face as { enablesMatters?: { type?: string }[]; matter?: { type?: string } };
    for (const m of f.enablesMatters ?? []) if (m.type) types.add(m.type);
    if (f.matter?.type) types.add(f.matter.type);
  }
  return TINT_ORDER.find(t => types.has(t)) ?? "dynamic";
}

/** La tinta di un MAZZO: quella della maggioranza delle sue carte (copie
    comprese); a parità vince l'ordine Distruttiva > Dimensionale > Dinamica.
    Il tavolo la usa per tingere il campo di ciascun posto (deciso dal
    designer, 2026-09-09). */
export function deckTint(deckId: string): Tint {
  const deck = getDeck(deckId);
  const counts: Record<Tint, number> = { destructive: 0, dimensional: 0, dynamic: 0 };
  for (const entry of deck?.cards ?? []) counts[cardTint(entry.card)] += entry.count;
  return TINT_ORDER.reduce((best, t) => (counts[t] > counts[best] ? t : best), TINT_ORDER[0]);
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
    «quando entra sul Fronte»; per le Materie l'effetto si risolve giocandole
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
    if (!entry || typeof entry.text !== "string") continue;
    // Due inneschi con lo stesso testo (RBF-034: il +1 e poi il dado stanno
    // in una frase sola) si leggono una volta.
    if (out.some(shown => shown.text === entry.text)) continue;
    out.push({ tag: typeof entry.trigger === "string" ? entry.trigger : locale === "en" ? "Effect" : "Effetto", text: entry.text });
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
    if (!destination) continue;
    // Due destinazioni certificate: il Ritiro (senza dettagli) e l'Abisso
    // «finché questa Entità resta in campo; quando lascia il campo, torna
    // in gioco» — l'esilio condizionato (heldBy, release). Specchio di
    // card_index.rb, enter_moves.
    const extra = (trigger.effect as { details?: unknown }).details as Loose | undefined;
    if (destination.zone === "retire" && extra === undefined) {
      out.push({ target: { kind: "entity", controller: "opponent" }, to: "ritiro" });
    } else if (destination.zone === "abyss" && extra && extra.whileSourceOnField === true && extra.returnsToPlayWhenSourceLeaves === true) {
      out.push({ target: { kind: "entity", controller: "opponent" }, to: "abisso", hold: true });
    }
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
    out.push({ from: "ritiro", filter: { permanent: true }, to: "field" });
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

// ---- Le altre forme «quando attacca» (§8.2). Specchio di card_index.rb,
// attack_forms: stesse condizioni, parser per parser — una forma che non
// combacia esattamente non entra.

type Loose = Record<string, any>;

function rollRange(value: unknown): [number, number] | null {
  const match = typeof value === "string" ? value.match(/^(\d+)-(\d+)$/) : null;
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function dieFaces(value: unknown): number | null {
  const match = typeof value === "string" ? value.match(/^d(\d+)$/) : null;
  return match ? Number(match[1]) : null;
}

function ownTarget(target: unknown, type: string, race: string | null = null): target is Loose {
  const t = target as Loose | undefined;
  return !!t && typeof t === "object" && t.cardType === type && t.controller === "controller" && (race === null || t.race === race);
}

function attackFormsOf(faces: CardFace[]): AttackForm[] {
  const out: AttackForm[] = [];
  faces.forEach((face, index) => {
    for (const trigger of face.triggers ?? []) {
      if (trigger.event !== "on_attack") continue;
      const details = (typeof trigger.details === "object" && trigger.details ? trigger.details : {}) as Loose;
      const effect = trigger.effect as Loose | undefined;
      if (!effect || typeof effect !== "object") continue;
      const form =
        attackUntap(details, effect) ?? attackEmpower(details, effect) ?? attackLook(details, effect) ?? attackHeal(details, effect) ??
        attackRecall(details, effect) ?? attackRearm(details, effect) ?? attackRestrict(details, effect);
      if (form) out.push({ ...form, face: index } as AttackForm);
    }
  });
  return out;
}

type Unfaced<F> = F extends AttackForm ? Omit<F, "face"> : never;

function attackUntap(details: Loose, effect: Loose): Unfaced<AttackForm> | null {
  if (effect.type !== "untap" || effect.target?.scope !== "self" || effect.details?.afterCombat !== true) return null;
  if (details.oncePerEachOfYourTurns !== true || details.whileHasObjectAssigned !== true) return null;
  return { kind: "untap", who: "self", once: true, requiresObject: true };
}

function attackEmpower(details: Loose, effect: Loose): Unfaced<AttackForm> | null {
  const target = effect.target as Loose | undefined;
  if (effect.type === "modify_power" && Number.isInteger(effect.amount) && effect.duration === "until_end_of_turn") {
    if (details.whenAssignedAttacks === true && target?.scope === "assigned") {
      return { kind: "empower", who: "object", targets: "bearer", power: effect.amount };
    }
    if (details.requiresObjectAssigned === true && ownTarget(target, "entity") && target.quantity === "all" &&
        target.details?.hasObjectAssigned === true && target.details?.excludeSelf === true) {
      return { kind: "empower", who: "self", requiresObject: true, targets: "others_armed", power: effect.amount };
    }
  }
  if (effect.type === "empower" && effect.duration === "until_end_of_turn" && details.oncePerEachOfYourTurns === true &&
      ownTarget(target, "entity", "human") && target.min === 1 && target.max === 1 && target.details?.nextAttackerThisTurn === true) {
    const grants = (Array.isArray(effect.grants) ? effect.grants : []).filter((k: unknown) => typeof k === "string");
    if (grants.length) return { kind: "empower", who: "self", once: true, targets: "next_human_attacker", grants };
  }
  return null;
}

function attackLook(details: Loose, effect: Loose): Unfaced<AttackForm> | null {
  if (effect.type !== "look_and_optionally_move") return null;
  const from = effect.from as Loose | undefined;
  const extra = effect.details as Loose | undefined;
  if (!from || from.zone !== "deck" || from.owner !== "controller" || from.position !== "top" || !Number.isInteger(from.count)) return null;
  if (!extra || typeof extra.mayReveal?.cardType !== "string") return null;
  const revealTo = extra.revealTo?.zone;
  const restTo = extra.restTo?.zone;
  if (!["hand", "retire"].includes(revealTo) || !["deck", "retire"].includes(restTo)) return null;
  if (restTo === "deck" && extra.restTo?.position !== "bottom") return null;
  const base = {
    count: from.count as number,
    reveal: { kind: extra.mayReveal.cardType as "matter" | "object" | "entity", race: typeof extra.mayReveal.race === "string" ? (extra.mayReveal.race as string) : null },
    revealTo: (revealTo === "retire" ? "ritiro" : "hand") as "hand" | "ritiro",
    restTo: (restTo === "retire" ? "ritiro" : "deck") as "deck" | "ritiro",
  };
  if (details.whenAssignedAttacks === true) {
    const die = dieFaces(extra.die);
    const onRoll = rollRange(extra.onlyOnRoll);
    if (die === null || onRoll === null) return null;
    return { kind: "look", who: "object", ...base, die, onRoll };
  }
  const attacker = details.attacker as Loose | undefined;
  if (ownTarget(attacker, "entity") && attacker.details?.hasObjectAssigned === true && details.oncePerEachOfYourTurns === true && extra.die === undefined) {
    return { kind: "look", who: "ally", ...base, attackerArmed: true, once: true, die: null, onRoll: null };
  }
  return null;
}

function attackHeal(details: Loose, effect: Loose): Unfaced<AttackForm> | null {
  const extra = (typeof effect.details === "object" && effect.details ? effect.details : {}) as Loose;
  if (effect.type === "gain_health" && Number.isInteger(effect.amount) && effect.target?.controller === "controller") {
    const required = details.requiresAttackersThisTurnAtLeast as Loose | undefined;
    if (details.oncePerEachOfYourTurns === true && required && Number.isInteger(required.count) && ownTarget(required.filter, "entity", "human")) {
      const thenDraw = extra.thenDrawCards;
      const thenDiscard = extra.thenDiscardCards;
      if (![undefined, 1].includes(thenDraw) || ![undefined, 1].includes(thenDiscard)) return null;
      return { kind: "heal", who: "rubyfront", once: true, requiresAttackers: { count: required.count, race: "human" }, amount: effect.amount, die: null, onRoll: null, thenDraw: thenDraw ?? 0, thenDiscard: thenDiscard ?? 0 };
    }
    const recall = extra.thenMoveCard as Loose | undefined;
    if (Object.keys(details).length === 0 && recall && recall.from?.zone === "retire" && recall.to?.zone === "hand" && recall.count === 1 && recall.filter?.cardType === "entity") {
      const die = dieFaces(extra.die);
      const onRoll = rollRange(extra.onRoll);
      if (die === null || onRoll === null) return null;
      return { kind: "heal", who: "self", amount: effect.amount, die, onRoll, thenRecall: { kind: "entity" } };
    }
  }
  if (effect.type === "empower" && ownTarget(details.attackers, "entity", "human") && typeof extra.byRoll === "object" && extra.byRoll) {
    const die = dieFaces(extra.die);
    const by = extra.byRoll as Record<string, Loose>;
    const gain = Object.keys(by).find(key => by[key]?.gainHealthEqualsHumanAttackersThisTurn === true);
    const drain = Object.keys(by).find(key => by[key]?.opponentLosesHealthEqualsHumanAttackersThisTurn === true);
    const gainOn = rollRange(gain);
    const drainOn = rollRange(drain);
    if (die === null || !gainOn || !drainOn) return null;
    return { kind: "heal", who: "permanent", attackers: { kind: "entity", race: "human" }, die, onRoll: null, gainOn, drainOn, amount: "human_attackers" };
  }
  return null;
}

/**
 * Le stappate certificate all'ingresso (§8.2, RBF-011): evento
 * `on_enter_field` senza `enteringCard`, effetto `untap` su tutte le
 * proprie Entità, col dado e la soglia. Specchio di card_index.rb, enter_refreshes.
 */
function enterRefreshesOf(face: CardFace | undefined): EnterRefresh[] {
  const out: EnterRefresh[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_enter_field") continue;
    const details = trigger.details as { enteringCard?: unknown } | undefined;
    if (details?.enteringCard) continue;
    const effect = trigger.effect as Loose | undefined;
    if (!effect || effect.type !== "untap" || !ownTarget(effect.target, "entity") || effect.target?.quantity !== "all") continue;
    const extra = effect.details as Loose | undefined;
    if (!extra || Object.keys(extra).sort().join() !== "die,onRoll") continue;
    const die = dieFaces(extra.die);
    const onRoll = rollRange(extra.onRoll);
    if (die !== null && onRoll) out.push({ die, onRoll });
  }
  return out;
}

function attackRecall(details: Loose, effect: Loose): Unfaced<AttackForm> | null {
  if (Object.keys(details).length !== 0 || effect.type !== "move_card" || !ownTarget(effect.target, "entity", "human")) return null;
  if (effect.target.min !== 1 || effect.target.max !== 1) return null;
  if (effect.from?.zone !== "retire" || effect.destination?.zone !== "front") return null;
  const extra = effect.details as Loose | undefined;
  if (!extra || extra.joinsThisAttack !== true) return null;
  const die = dieFaces(extra.die);
  const onRoll = rollRange(extra.onRoll);
  return die !== null && onRoll ? { kind: "return", who: "self", die, onRoll, filter: { kind: "entity", race: "human" }, joins: true } : null;
}

function attackRearm(details: Loose, effect: Loose): Unfaced<AttackForm> | null {
  const attacker = details.attacker as Loose | undefined;
  if (effect.type !== "assign_object" || effect.optional !== true) return null;
  if (effect.from?.zone !== "retire" || effect.target?.scope !== "attacker" || effect.details?.noFluxCost !== true) return null;
  if (!ownTarget(attacker, "entity") || attacker.details?.hasObjectAssigned !== true) return null;
  return { kind: "rearm", who: "ally", attackerArmed: true };
}

/**
 * Il divieto di blocco: «se almeno N Entità Umane che controlli attaccano,
 * un'Entità avversaria non può bloccare in questo turno». La condizione
 * conta gli attaccanti di QUESTO turno (`requiresAttackersThisTurnAtLeast`,
 * la fonte compresa — revisione del foglio) o, nella forma storica, quelli
 * del turno precedente (`requiresAttackersPreviousTurnAtLeast`).
 */
function attackRestrict(details: Loose, effect: Loose): Unfaced<AttackForm> | null {
  const thisTurn = details.requiresAttackersThisTurnAtLeast as Loose | undefined;
  const previous = details.requiresAttackersPreviousTurnAtLeast as Loose | undefined;
  const required = thisTurn ?? previous;
  if (effect.type !== "restrict_action" || effect.restricts !== "block" || effect.duration !== "until_end_of_turn") return null;
  const target = effect.target as Loose | undefined;
  if (!target || target.cardType !== "entity" || target.controller !== "opponent" || target.min !== 1 || target.max !== 1) return null;
  if (!required || !Number.isInteger(required.count) || !ownTarget(required.filter, "entity", "human")) return null;
  const condition = thisTurn ? { requiresAttackers: { count: required.count, race: "human" } } : { requiresPreviousAttackers: { count: required.count, race: "human" } };
  return { kind: "empower", who: "self", ...condition, targets: "opposing_entity", restrict: "block" };
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
    let byRoll = false;
    if (Number.isInteger(from.count)) count = from.count as number;
    else {
      const faces = typeof d.die === "string" ? /^d(\d+)$/.exec(d.die) : null;
      const formula = typeof d.count === "string" ? /^(\d+) \+ ceil\(result\/2\)$/.exec(d.count) : null;
      byRoll = d.count === "result";
      if (!faces || (!formula && !byRoll)) continue;
      die = Number(faces[1]);
      countBase = formula ? Number(formula[1]) : 0;
    }
    const then = d.thenMoveOneTo;
    if (then && then.zone !== "retire") continue;
    out.push({
      count,
      die,
      countBase,
      reveal: { kind: may.cardType, race: typeof may.race === "string" ? may.race : null },
      thenRetire: Boolean(then),
      ...(byRoll ? { formula: "result" as const } : {}),
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

/**
 * I disarmi all'ingresso certificati (§8.2, dal 2026-09-10): `move_card` di
 * OGNI Oggetto assegnato a un'Entità avversaria sul Fronte, verso la Zona
 * di Ritiro del proprietario. Specchio di card_index.rb, enter_disarms.
 */
function enterDisarmsOf(face: CardFace | undefined): EnterDisarm[] {
  const out: EnterDisarm[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_enter_field") continue;
    const effect = trigger.effect as { type?: unknown; target?: any; destination?: any } | undefined;
    if (!effect || effect.type !== "move_card") continue;
    const target = effect.target;
    if (!target || target.cardType !== "object" || target.controller !== "opponent" || target.zone !== "front" || target.quantity !== "all") continue;
    if (target.details?.assigned !== true) continue;
    if (effect.destination?.zone !== "retire" || effect.destination?.owner !== "card_owner") continue;
    out.push({ to: "ritiro" });
  }
  return out;
}

/**
 * I riarmi all'ingresso certificati (§8.2, dal 2026-09-10): `assign_object`
 * facoltativo dalla propria Zona di Ritiro alle proprie Entità, quanti si
 * vuole, gratis. Specchio di card_index.rb, enter_rearms.
 */
function enterRearmsOf(face: CardFace | undefined): EnterRearm[] {
  const out: EnterRearm[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_enter_field") continue;
    const effect = trigger.effect as { type?: unknown; optional?: unknown; from?: any; target?: any; details?: any } | undefined;
    if (!effect || effect.type !== "assign_object" || effect.optional !== true) continue;
    if (effect.from?.zone !== "retire" || effect.from?.owner !== "controller") continue;
    const target = effect.target;
    if (!target || target.cardType !== "entity" || target.controller !== "controller" || target.quantity !== "all") continue;
    if (effect.details?.anyNumber !== true || effect.details?.noFluxCost !== true) continue;
    out.push({ any: true });
  }
  return out;
}

/**
 * I ritorni vincolati certificati (§8.2, dal 2026-09-10): `on_leave_field`
 * col vincolo «senza Oggetti addosso», `move_card` di sé stessa sul Fronte,
 * poi un Oggetto dal Ritiro con `flux_cost lte N`, gratis, obbligatorio.
 * Specchio di card_index.rb, leave_returns.
 */
function leaveReturnsOf(face: CardFace | undefined): LeaveReturn[] {
  const out: LeaveReturn[] = [];
  for (const trigger of face?.triggers ?? []) {
    if (trigger.event !== "on_leave_field") continue;
    const details = trigger.details as { requiresNoObjectAssignedWhenLeft?: unknown } | undefined;
    if (details?.requiresNoObjectAssignedWhenLeft !== true) continue;
    const effect = trigger.effect as { type?: unknown; optional?: unknown; target?: any; destination?: any; details?: any } | undefined;
    if (!effect || effect.type !== "move_card" || effect.optional !== true) continue;
    if (effect.target?.scope !== "self" || effect.destination?.zone !== "front") continue;
    const rearm = effect.details?.thenAssignObject;
    if (!rearm || rearm.from?.zone !== "retire" || rearm.noFluxCost !== true || rearm.required !== true) continue;
    const conditions: any[] = Array.isArray(rearm.filter?.conditions) ? rearm.filter.conditions : [];
    const cost = conditions.find(c => c?.stat === "flux_cost" && c.operator === "lte" && Number.isInteger(c.value));
    if (rearm.filter?.cardType !== "object" || !cost || conditions.length !== 1) continue;
    out.push({ maxCost: cost.value });
  }
  return out;
}

// ---- Gli statici, le Materie alla risoluzione e il flip (Eredità Perduta).
// Specchio di card_index.rb: static_forms, resolve_forms, flip_forms,
// nexus_of — stesse condizioni, parser per parser.

/** "5-6" → [5, 6], "20" → [20, 20]; null se non è una fascia. */
function band(value: unknown): [number, number] | null {
  const range = rollRange(value);
  if (range) return range;
  return typeof value === "string" && /^\d+$/.test(value) ? [Number(value), Number(value)] : null;
}

function raceFilter(filter: unknown, zone: string | null = null): { kind: "entity"; race: string | null } | null {
  const f = filter as Loose | undefined;
  if (!f || typeof f !== "object" || f.cardType !== "entity") return null;
  if (zone && f.zone !== zone) return null;
  if (f.owner !== "controller" && f.controller !== "controller") return null;
  return { kind: "entity", race: typeof f.race === "string" ? f.race : null };
}

function staticFormsOf(faces: CardFace[]): StaticForm[] {
  const out: StaticForm[] = [];
  for (const face of faces) {
    for (const trigger of face.triggers ?? []) {
      if (trigger.event !== "while_in_play" && trigger.event !== "while_assigned") continue;
      const effect = trigger.effect as Loose | undefined;
      if (!effect) continue;
      // La tassa di Flusso: «all'inizio di ogni tuo turno hai N Flusso in meno»
      // finché resta sul Fronte. Specchio di card_index.rb, static_forms.
      if (effect.type === "modify_flux") {
        const toll = (typeof effect.details === "object" && effect.details ? effect.details : {}) as Loose;
        if (trigger.event === "while_in_play" && effect.target?.controller === "controller" && Number.isInteger(effect.amount) && effect.amount < 0 && toll.atStartOfEachOwnTurn === true && toll.whileOnFront === true) {
          out.push({ kind: "flux_toll", amount: -effect.amount });
        }
        continue;
      }
      // «Questa Entità non si tappa mai» (RBF-011): uno statico senza numeri.
      if (effect.type === "prevent_tap") {
        if (trigger.event === "while_in_play" && effect.target?.scope === "self" && effect.duration === "permanent") out.push({ kind: "never_taps" });
        continue;
      }
      if (effect.type !== "modify_power" || !Number.isInteger(effect.amount)) continue;
      const details = (typeof effect.details === "object" && effect.details ? effect.details : {}) as Loose;
      if (trigger.event === "while_in_play") {
        if (effect.target?.scope !== "self") continue;
        if (details.whileAttacking === true) {
          const other = raceFilter(details.requiresOtherControlled);
          if (other) out.push({ kind: "self_power", amount: effect.amount, whileAttacking: true, requiresOther: other });
        } else if (details.whileHasObjectAssigned === true) {
          // «Se questa Entità ha un Oggetto assegnato, ha +N Potenza». Specchio di card_index.rb.
          if (Object.keys(details).length === 1) out.push({ kind: "self_power", amount: effect.amount, whileArmed: true });
        } else if (details.perOtherControlled) {
          const other = raceFilter(details.perOtherControlled, "front");
          if (other && Object.keys(details).length === 1) out.push({ kind: "self_power", amount: effect.amount, perOther: other });
        }
      } else {
        // «Mentre assegnato» dura finché l'Oggetto è addosso: durata `permanent` o assente, stessa forma.
        if (effect.target?.scope !== "assigned" || (effect.duration !== undefined && effect.duration !== "permanent")) continue;
        if (Object.keys(details).length === 0) out.push({ kind: "bearer_power", amount: effect.amount });
        else if (details.perControlled) {
          const per = raceFilter(details.perControlled, "front");
          const known = Object.keys(details).every(key => key === "perControlled" || key === "assignedMayBeBlockedByMultipleEntities");
          if (per && known) out.push({ kind: "bearer_power", amount: effect.amount, per, multiBlock: details.assignedMayBeBlockedByMultipleEntities === true });
        }
      }
    }
  }
  return out;
}

function costCondition(conditions: unknown): { ok: boolean; maxCost: number | null } {
  let maxCost: number | null = null;
  const list: unknown[] = Array.isArray(conditions) ? conditions : [];
  for (const condition of list as Loose[]) {
    if (condition?.stat === "flux_cost" && condition.operator === "lte" && Number.isInteger(condition.value)) maxCost = condition.value;
    else return { ok: false, maxCost: null };
  }
  return { ok: true, maxCost };
}

function resolveFormsOf(faces: CardFace[]): ResolveForm[] {
  const out: ResolveForm[] = [];
  for (const face of faces) {
    for (const trigger of face.triggers ?? []) {
      if (trigger.event !== "on_resolve") continue;
      const effect = trigger.effect as Loose | undefined;
      if (!effect || typeof effect !== "object") continue;
      const form = resolveLook(effect) ?? resolveUntap(effect) ?? resolveMove(effect) ?? resolveFortune(effect) ?? resolveDestroy(effect) ?? resolveBlock(effect);
      if (form) out.push(form);
    }
  }
  return out;
}

function resolveLook(effect: Loose): ResolveForm | null {
  if (effect.type !== "look_and_optionally_move") return null;
  const from = effect.from as Loose | undefined;
  const extra = effect.details as Loose | undefined;
  if (!from || from.zone !== "deck" || from.owner !== "controller" || from.position !== "top" || !Number.isInteger(from.count)) return null;
  if (!extra || typeof extra.mayReveal?.cardType !== "string") return null;
  if (extra.revealTo?.zone !== "hand" || extra.restTo?.zone !== "deck" || extra.restTo?.position !== "bottom") return null;
  if (![undefined, 1].includes(extra.addToHand) || (extra.maxRevealed !== undefined && !Number.isInteger(extra.maxRevealed))) return null;
  return {
    kind: "look",
    count: from.count,
    reveal: { kind: extra.mayReveal.cardType, race: typeof extra.mayReveal.race === "string" ? extra.mayReveal.race : null },
    revealTo: "hand",
    restTo: "deck",
    showUpTo: extra.maxRevealed ?? 1,
  };
}

function resolveUntap(effect: Loose): ResolveForm | null {
  if (effect.type !== "untap") return null;
  const target = effect.target as Loose | undefined;
  const extra = effect.details as Loose | undefined;
  if (!ownTarget(target, "entity") || !extra || extra.duration !== "until_end_of_turn") return null;
  const race = typeof target.race === "string" ? target.race : null;
  if (target.min === 1 && target.max === 1 && Number.isInteger(extra.thenPowerBonus) && Object.keys(extra).sort().join() === "duration,thenPowerBonus") {
    return { kind: "empower", targets: "own_entity", race, power: extra.thenPowerBonus, untap: true };
  }
  if (target.quantity === "all" && Number.isInteger(extra.thenCounterattackBonus)) {
    const requires = extra.requiresControlledAtLeast as Loose | undefined;
    if (!requires || !Number.isInteger(requires.count) || !ownTarget(requires.filter, "entity")) return null;
    return {
      kind: "empower",
      targets: "own_entities",
      race,
      counter: extra.thenCounterattackBonus,
      untap: true,
      requires: { count: requires.count, race: typeof requires.filter.race === "string" ? requires.filter.race : null },
    };
  }
  return null;
}

/** la Reattiva bloccante (forma `block`): «giocala come blocco a un attaccante: quell'attacco è bloccato. Se sul tuo Fronte ci sono almeno N Entità con un Oggetto assegnato, guadagni M PV». Specchio di card_index.rb, resolve_block. */
function resolveBlock(effect: Loose): ResolveForm | null {
  if (effect.type !== "block_attack") return null;
  const target = effect.target as Loose | undefined;
  const extra = effect.details as Loose | undefined;
  if (!target || target.cardType !== "entity" || target.controller !== "opponent" || target.min !== 1 || target.max !== 1) return null;
  if (!extra || !Number.isInteger(extra.ifControllerEntitiesWithObjectAtLeast) || !Number.isInteger(extra.thenControllerGainsHealth)) return null;
  if (Object.keys(extra).sort().join() !== "ifControllerEntitiesWithObjectAtLeast,thenControllerGainsHealth") return null;
  return { kind: "block", requiresArmed: extra.ifControllerEntitiesWithObjectAtLeast, heal: extra.thenControllerGainsHealth, asBlock: true };
}

function resolveMove(effect: Loose): ResolveForm | null {
  if (effect.type !== "move_card") return null;
  const target = effect.target as Loose | undefined;
  const destination = effect.destination as Loose | undefined;
  if (!target || target.controller !== "opponent" || target.min !== 1 || target.max !== 1 || !destination) return null;
  if (target.cardType === "entity" && destination.zone === "retire") {
    const cost = costCondition(target.conditions);
    if (!cost.ok || effect.details !== undefined) return null;
    return { kind: "move", target: { kind: "entity", controller: "opponent", maxCost: cost.maxCost }, to: "ritiro" };
  }
  const extra = effect.details as Loose | undefined;
  if (target.details?.permanent === true && destination.zone === "abyss" && extra && extra.whileSourceOnField === true && extra.returnsToPlayWhenSourceLeaves === true) {
    return { kind: "exile", target: { permanent: true, controller: "opponent" }, to: "abisso", hold: true };
  }
  return null;
}

function resolveFortune(effect: Loose): ResolveForm | null {
  if (effect.type !== "empower" || effect.target?.controller !== "controller") return null;
  const extra = effect.details as Loose | undefined;
  if (!extra || typeof extra.byRoll !== "object" || !extra.byRoll) return null;
  const die = dieFaces(extra.die);
  const by = extra.byRoll as Record<string, Loose>;
  const keys = Object.keys(by);
  if (die === null || keys.length !== 4) return null;
  const gain = keys.find(key => Number.isInteger(by[key]?.gainHealth));
  const deploy = keys.find(key => typeof by[key]?.moveCard === "object" && by[key]?.moveCard);
  const draw = keys.find(key => Number.isInteger(by[key]?.drawCards));
  const all = keys.find(key => by[key]?.allOfTheAbove === true);
  if (!gain || !deploy || !draw || !all) return null;
  const bands = [band(gain), band(deploy), band(draw), band(all)];
  if (bands.some(b => b === null)) return null;
  const move = by[deploy].moveCard as Loose;
  const filter = move.filter as Loose | undefined;
  if (move.from?.zone !== "hand" || move.from?.owner !== "controller" || move.to?.zone !== "front" || move.to?.owner !== "controller") return null;
  if (!filter || filter.cardType !== "entity") return null;
  const cost = costCondition(filter.conditions);
  if (!cost.ok) return null;
  return {
    kind: "fortune",
    die,
    gain: { on: bands[0]!, amount: by[gain].gainHealth },
    deploy: { on: bands[1]!, filter: { kind: "entity", race: typeof filter.race === "string" ? filter.race : null, maxCost: cost.maxCost } },
    draw: { on: bands[2]!, count: by[draw].drawCards },
    allOn: bands[3]!,
  };
}

function resolveDestroy(effect: Loose): ResolveForm | null {
  if (effect.type !== "destroy") return null;
  const target = effect.target as Loose | undefined;
  const extra = effect.details as Loose | undefined;
  if (!target || target.cardType !== "entity" || target.min !== 1 || target.max !== 1 || !["any", "opponent", "controller"].includes(target.controller)) return null;
  if (!extra || extra.toZone?.zone !== "abyss") return null;
  // Un seguito ignoto (RBF-038: «poi perdi 2 PV») rende la forma ignota.
  if (!Object.keys(extra).every(key => key === "toZone" || key === "fluxCostReduction")) return null;
  const discount = extra.fluxCostReduction as Loose | undefined;
  if (discount !== undefined && !(discount && Number.isInteger(discount.amount) && discount.ifTargetState === "tapped")) return null;
  return {
    kind: "destroy",
    target: { kind: "entity", controller: target.controller },
    to: "abisso",
    discount: discount ? { amount: discount.amount, ifTarget: "tapped" } : null,
  };
}

/** Le concessioni «mentre assegnato» (RBF-013): evento `while_assigned`,
    effetto `empower` sul portatore, durata `permanent`, con l'eventuale
    razza. Specchio di card_index.rb, grants_while_assigned. */
function grantsWhileAssignedOf(faces: CardFace[]): { keywords: string[]; ifRace: string | null }[] {
  const out: { keywords: string[]; ifRace: string | null }[] = [];
  for (const face of faces) {
    for (const trigger of face.triggers ?? []) {
      if (trigger.event !== "while_assigned") continue;
      const effect = trigger.effect as Loose | undefined;
      if (!effect || effect.type !== "empower" || effect.target?.scope !== "assigned" || effect.duration !== "permanent") continue;
      const keywords = (Array.isArray(effect.grants) ? effect.grants : []).filter((k: unknown): k is string => typeof k === "string");
      if (keywords.length === 0) continue;
      out.push({ keywords, ifRace: typeof effect.details?.ifAssignedRace === "string" ? effect.details.ifAssignedRace : null });
    }
  }
  return out;
}

function flipFormsOf(faces: CardFace[]): FlipForm[] {
  const out: FlipForm[] = [];
  for (const face of faces) {
    for (const trigger of face.triggers ?? []) {
      if (trigger.event !== "on_flip") continue;
      const effect = trigger.effect as Loose | undefined;
      const target = effect?.target as Loose | undefined;
      if (!effect || !target || typeof target.cardId !== "string" || target.controller !== "controller") continue;
      if (effect.type === "move_card" && effect.from?.zone === "front" && effect.destination?.zone === "abyss") {
        out.push({ kind: "move", cardId: target.cardId, from: "field", to: "abisso" });
      } else if (effect.type === "restrict_action" && effect.restricts === "play" && effect.duration === "permanent" && effect.details?.followsCard === true) {
        out.push({ kind: "seal", cardId: target.cardId });
      }
    }
  }
  return out;
}

/**
 * Le abilità speciali del Rubyfront/Nexus (§3.1), specchio di
 * card_index.rb, abilities: dalle `actions` di ogni faccia, con la forma
 * certificata dell'effetto (sguardo, potenziamento, sconto) o null.
 */
function abilitiesOf(faces: CardFace[]): Ability[] {
  const out: Ability[] = [];
  faces.forEach((face, index) => {
    for (const action of ((face as Loose).actions ?? []) as Loose[]) {
      if (!action || typeof action.id !== "string") continue;
      const timing: Phase[] = [];
      for (const window of Array.isArray(action.timing) ? action.timing : []) {
        if (window === "own_preparation") timing.push("preparazione");
        if (window === "own_front") timing.push("fronte");
      }
      if (timing.length === 0) continue;
      const cost = Number.isInteger(action.cost?.health) ? (action.cost.health as number) : null;
      const gain = Number.isInteger(action.gain?.health) ? (action.gain.health as number) : null;
      if (cost === null && gain === null) continue;
      out.push({
        id: action.id,
        displayKey: typeof action.displayKey === "string" ? action.displayKey : action.id,
        face: index,
        timing,
        cost,
        gain,
        fury: Array.isArray(action.checks) && action.checks.includes("fury"),
        form: abilityFormOf(action.effect as Loose | undefined),
      });
    }
  });
  return out;
}

function abilityFormOf(effect: Loose | undefined): AbilityForm | null {
  if (!effect) return null;
  if (effect.type === "look_and_optionally_move") {
    const from = effect.from as Loose | undefined;
    const d = effect.details as Loose | undefined;
    if (!from || from.zone !== "deck" || from.owner !== "controller" || from.position !== "top" || !Number.isInteger(from.count)) return null;
    if (!d || d.revealTo?.zone !== "hand" || d.restTo?.zone !== "deck" || d.restTo?.position !== "bottom") return null;
    const may = d.mayReveal as Loose | undefined;
    if (!may || (may.cardType !== "entity" && may.cardType !== "object")) return null;
    return { kind: "look", count: from.count as number, reveal: { kind: may.cardType, race: typeof may.race === "string" ? may.race : null } };
  }
  if (effect.type === "modify_power") {
    const target = effect.target as Loose | undefined;
    if (!target || target.cardType !== "entity" || target.controller !== "controller") return null;
    if (!Number.isInteger(effect.amount) || effect.duration !== "until_end_of_turn") return null;
    const all = target.quantity === "all";
    const one = target.min === 1 && target.max === 1;
    if (!all && !one) return null;
    const details = (target.details ?? {}) as Loose;
    return { kind: "power", amount: effect.amount as number, targets: all ? "all" : "one", race: typeof target.race === "string" ? target.race : null, attacking: details.attacking === true, armed: details.hasObjectAssigned === true };
  }
  if (effect.type === "reduce_cost") {
    if (!Number.isInteger(effect.amount) || effect.details?.nextPlayedThisTurn !== true) return null;
    const filter = (effect.target ?? effect.filter) as Loose | undefined;
    if (!filter || (filter.cardType !== "entity" && filter.cardType !== "object")) return null;
    return { kind: "discount", amount: effect.amount as number, type: filter.cardType, race: typeof filter.race === "string" ? filter.race : null };
  }
  return null;
}

/** La soglia della Furia per faccia (§8.1). Specchio di card_index.rb, fury_at. */
function furyAtOf(faces: CardFace[]): Record<number, number> {
  const out: Record<number, number> = {};
  faces.forEach((face, index) => {
    const fury = ((face.keywords ?? []) as Loose[]).find(keyword => keyword && keyword.id === "fury");
    if (!fury) return;
    const at = (fury.check as Loose | undefined)?.successAtLeast;
    out[index] = Number.isInteger(at) ? (at as number) : 12;
  });
  return out;
}

/** Il requisito del Nexus nella lingua di chi legge (la riga «Controlli almeno …, poi flippa»). */
export function nexusRequirementCopy(cardId: string, locale: string): string {
  const card = getCard(cardId);
  const copy = card ? (renderer.localized(card, locale) as Loose | null) : null;
  const text = copy?.card?.nexusRequirement?.text;
  return typeof text === "string" ? text : "";
}

/** Nome e testo di un'abilità speciale nella lingua di chi legge. */
export function abilityCopy(cardId: string, faceIndex: number, displayKey: string, locale: string): { name: string; text: string } {
  const card = getCard(cardId);
  const face = card?.faces[faceIndex];
  const copy = card ? renderer.localized(card, locale) : null;
  const entry = ((copy as Loose | null)?.[face?.displayKey ?? ""]?.abilities?.[displayKey] ?? {}) as Loose;
  return { name: typeof entry.name === "string" ? entry.name : displayKey, text: typeof entry.text === "string" ? entry.text : "" };
}

function nexusOf(faces: CardFace[]): NexusRequirement | null {
  const rubyfront = faces.find(face => face.kind === "rubyfront");
  const nexusIndex = faces.findIndex(face => face.kind === "nexus");
  if (!rubyfront || nexusIndex < 0) return null;
  const requirement = (rubyfront.requirements as Loose | undefined)?.nexus as Loose | undefined;
  if (!requirement || requirement.match !== "all") return null;
  const conditions: NexusRequirement["conditions"] = [];
  for (const condition of (Array.isArray(requirement.conditions) ? requirement.conditions : []) as Loose[]) {
    if (condition?.type !== "controls_card" || condition.owner !== "controller" || !Number.isInteger(condition.min)) return null;
    const filter = condition.filter as Loose | undefined;
    // Un vincolo in più (RBF-023: «con un Oggetto assegnato») è una forma ignota.
    if (!filter || filter.cardType !== "entity" || !Object.keys(filter).every(key => key === "cardType" || key === "race")) return null;
    conditions.push({ count: condition.min, kind: "entity", race: typeof filter.race === "string" ? filter.race : null });
  }
  if (conditions.length === 0) return null;
  const costs = (Array.isArray(requirement.flipCost) ? requirement.flipCost : []) as Loose[];
  if (costs.length > 1) return null;
  let discard: NexusRequirement["discard"] = null;
  if (costs.length === 1) {
    const cost = costs[0];
    if (cost?.type !== "discard_card" || cost.count !== 1 || cost.target?.controller !== "controller") return null;
    discard = { count: 1, kind: typeof cost.filter?.cardType === "string" ? cost.filter.cardType : null };
  }
  const recovery = faces[nexusIndex].stats?.healthRecovery;
  return { face: nexusIndex, conditions, discard, recovery: Number.isInteger(recovery) ? (recovery as number) : null };
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
  /** I PV stampati sul Rubyfront (§3.1): i PV con cui il giocatore inizia. Specchio di card_index.rb, health. */
  health: number | null;
  fluxCost: number | null;
  keywords: string[];
  deployment: Deployment | null;
  enterListeners: EnterListener[];
  enterMoves: EnterMove[];
  behavior: string | null;
  enterReturns: EnterReturn[];
  enterLooks: EnterLook[];
  enterControls: EnterControl[];
  enterRefreshes: EnterRefresh[];
  enterDisarms: EnterDisarm[];
  enterRearms: EnterRearm[];
  leaveReturns: LeaveReturn[];
  attackReturns: EnterReturn[];
  attackDraws: AttackDraw[];
  attackForms: AttackForm[];
  staticForms: StaticForm[];
  resolveForms: ResolveForm[];
  flipForms: FlipForm[];
  nexus: NexusRequirement | null;
  abilities: Ability[];
  furyAt: Record<number, number>;
  grantsWhileAssigned: { keywords: string[]; ifRace: string | null }[];
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
    attackForms: attackFormsOf(card?.faces ?? []),
    staticForms: staticFormsOf(card?.faces ?? []),
    resolveForms: resolveFormsOf(card?.faces ?? []),
    flipForms: flipFormsOf(card?.faces ?? []),
    nexus: nexusOf(card?.faces ?? []),
    abilities: abilitiesOf(card?.faces ?? []),
    furyAt: furyAtOf(card?.faces ?? []),
    grantsWhileAssigned: grantsWhileAssignedOf(card?.faces ?? []),
    enterLooks: enterLooksOf(face),
    enterControls: enterControlsOf(face),
    enterRefreshes: enterRefreshesOf(face),
    enterDisarms: enterDisarmsOf(face),
    enterRearms: enterRearmsOf(face),
    leaveReturns: leaveReturnsOf(face),
    power: integer(face?.stats?.power),
    counterattack: integer(face?.stats?.counterattack),
    health: integer(card?.faces.find(candidate => candidate.kind === "rubyfront")?.stats?.health),
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
