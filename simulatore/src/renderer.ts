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

export interface CardFace {
  id: string;
  kind: "rubyfront" | "nexus" | "entity" | "object" | "matter";
  displayKey: string;
  /** Le statistiche stampate (dal file dati della carta): qui contano
      quelle del combattimento, Potenza e «Contrattacco +N» (§6.3). */
  stats?: { power?: unknown; counterattack?: unknown; fluxCost?: unknown };
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
export function cardStats(cardId: string): { power: number | null; counterattack: number | null; fluxCost: number | null } {
  const card = getCard(cardId);
  const face = card?.faces.find(candidate => candidate.kind === "entity") ?? card?.faces[0];
  const integer = (value: unknown): number | null => (Number.isInteger(value) ? (value as number) : null);
  return {
    power: integer(face?.stats?.power),
    counterattack: integer(face?.stats?.counterattack),
    // Il costo di Flusso stampato (§3.2); il Rubyfront ha il costo di
    // schieramento, un'altra cosa, e qui resta null.
    fluxCost: integer(face?.stats?.fluxCost),
  };
}

/** Il Rubyfront non si pesca mai (§3.1): parte in Zona di Richiamo. */
export function isRubyfront(cardId: string): boolean {
  return getCard(cardId)?.faces.some(face => face.kind === "rubyfront") ?? false;
}
