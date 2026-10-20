// La progressione dei Rubyfront (2026-09-23, a percorso dal 2026-09-26): il
// gemello TypeScript di engine/lib/rubyfront/progression.rb. Un modulo a
// parte, fuori dalle regole: livelli dall'esperienza, il percorso d'Ascesa
// (nodi collegati alla carta, al più uno per livello) e ciò che dà in
// partita, la configurazione (le abilità del percorso montate al posto dei
// blocchi stampati) e le loro convalide — stessi motivi del tavolo, qui come
// chiavi i18n. I dati arrivano dal catalogo (`progression` in
// docs/cards/catalog.json), come i mazzi. Le abilità di oggi sono
// segnaposto: non si giocano ancora; PV e Furia sì (l'Ascesa, §3.3).

export type ProgressionFace = "rubyfront" | "nexus";
export const PROGRESSION_FACES: ProgressionFace[] = ["rubyfront", "nexus"];
export const PROGRESSION_LEVELS = 10;
/** Il nodo radice del percorso: la carta al centro. */
export const PATH_ROOT = "card";

export interface ProgressionRules {
  /** thresholds[i] è l'esperienza cumulata per essere al livello i+1. */
  thresholds: number[];
  points: { win: number; loss: number; draw: number };
  /** Quanti blocchi stampati le abilità del percorso possono sostituire, per faccia. */
  slots: Record<ProgressionFace, number>;
  pathNodes?: number;
}

export interface ProgressionAbility {
  id: string;
  locales: Record<string, { name: string; text: string }>;
}

export type PathNodeKind = "ability" | "hp" | "fury";

/** Un nodo del percorso: un'abilità di una faccia, o +N PV, o −N alla soglia della Furia. */
export interface PathNode {
  id: string;
  kind: PathNodeKind;
  face?: ProgressionFace;
  amount?: number;
  /** La posizione nella griglia, in unità (x a destra, y in basso; la carta in 0,0). */
  at: [number, number];
  /** I vicini: id di nodi, o `card` per la carta al centro. Valgono dalle due parti. */
  links: string[];
  locales?: Record<string, { name: string; text: string }>;
}

export interface ProgressionCard {
  card: string;
  nodes: PathNode[];
}

export interface ProgressionCatalog {
  rules: ProgressionRules;
  cards: ProgressionCard[];
}

/**
 * Le abilità montate, per faccia: la lista è POSIZIONALE (2026-09-24) —
 * l'indice è il blocco stampato sulla carta che l'abilità sostituisce, `null`
 * lascia quello stampato. Gemello di Progression#loadout_ok?.
 */
export type Loadout = Record<ProgressionFace, (string | null)[]>;

/** Ciò che il percorso dà in partita (§3.3): viaggia nel `loadDeck`. */
export interface Ascent {
  hp: number;
  fury: number;
}

/** La progressione di un giocatore su un Rubyfront, come la manda il tavolo. */
export interface PlayerProgress {
  card: string;
  xp: number;
  level: number;
  /** I nodi attivi, nell'ordine dalla carta (2026-09-26). */
  path: string[];
  loadout: Loadout;
}

export type Outcome = "win" | "loss" | "draw";

export const EMPTY_LOADOUT: Loadout = { rubyfront: [], nexus: [] };
export const NO_ASCENT: Ascent = { hp: 0, fury: 0 };

let catalog: ProgressionCatalog | null = null;

/** Il catalogo della progressione, consegnato da `useCatalog` (cards.ts). */
export function useProgression(next: ProgressionCatalog | null | undefined): void {
  catalog = next ?? null;
}

export function progressionRules(): ProgressionRules | null {
  return catalog?.rules ?? null;
}

export function progressionOf(cardId: string): ProgressionCard | null {
  return catalog?.cards.find(card => card.card === cardId) ?? null;
}

/** I Rubyfront con una progressione, nell'ordine del catalogo. */
export function progressionCards(): ProgressionCard[] {
  return catalog?.cards ?? [];
}

/** Il livello dato l'esperienza: l'ultima soglia raggiunta, fra 1 e 10. Gemello: Progression#level_for. */
export function levelFor(xp: number, rules: ProgressionRules): number {
  const reached = rules.thresholds.filter(threshold => xp >= threshold).length;
  return Math.max(1, Math.min(PROGRESSION_LEVELS, reached));
}

/** Le soglie di partenza e d'arrivo di un livello (per la barra); l'ultimo non ha arrivo. Gemello: Progression#span. */
export function xpSpan(level: number, rules: ProgressionRules): { from: number; to: number | null } {
  const at = Math.max(1, Math.min(PROGRESSION_LEVELS, level));
  return { from: rules.thresholds[at - 1] ?? 0, to: at < PROGRESSION_LEVELS ? (rules.thresholds[at] ?? null) : null };
}

/** I nodi attivabili a quel livello: uno per livello. Gemello: Progression#path_points. */
export function pathPoints(level: number): number {
  return Math.max(1, Math.min(PROGRESSION_LEVELS, level));
}

export function nodeOf(card: ProgressionCard | null, id: string): PathNode | null {
  return card?.nodes.find(node => node.id === id) ?? null;
}

/** I vicini di un nodo (o della carta), coi collegamenti presi dalle due parti. Gemello: Progression#neighbors. */
export function neighbors(card: ProgressionCard | null, id: string): string[] {
  const out: string[] = [];
  for (const node of card?.nodes ?? []) {
    if (node.id === id) for (const other of node.links) if (!out.includes(other)) out.push(other);
    if (node.links.includes(id) && !out.includes(node.id)) out.push(node.id);
  }
  return out;
}

/** La distanza dalla carta di ogni nodo di `set` raggiungibile passando solo per nodi di `set`. */
function depths(card: ProgressionCard | null, set: string[]): Map<string, number> {
  const depth = new Map<string, number>([[PATH_ROOT, 0]]);
  const frontier = [PATH_ROOT];
  while (frontier.length) {
    const current = frontier.shift()!;
    for (const next of neighbors(card, current)) {
      if (!set.includes(next) || depth.has(next)) continue;
      depth.set(next, depth.get(current)! + 1);
      frontier.push(next);
    }
  }
  depth.delete(PATH_ROOT);
  return depth;
}

/**
 * Il percorso in ordine dalla carta: gli id noti, senza doppioni, solo
 * quelli collegati alla carta attraverso il percorso; per passo, e a pari
 * passo nell'ordine dato. Gemello: Progression#normal_path.
 */
export function normalPath(card: ProgressionCard | null, path: string[]): string[] {
  const wanted = [...new Set(path.filter(id => nodeOf(card, id)))];
  const depth = depths(card, wanted);
  return wanted
    .map((id, index) => ({ id, index }))
    .filter(entry => depth.has(entry.id))
    .sort((a, b) => depth.get(a.id)! - depth.get(b.id)! || a.index - b.index)
    .map(entry => entry.id);
}

/** Il percorso accorciato ai punti del livello. Gemello: Progression#trimmed_path. */
export function trimmedPath(card: ProgressionCard | null, path: string[], level: number): string[] {
  return normalPath(card, path).slice(0, pathPoints(level));
}

/**
 * Il percorso è lecito? `null` se sì, se no la chiave i18n del motivo.
 * Gemello: Progression#path_ok?.
 */
export function validatePath(card: ProgressionCard | null, level: number, path: string[]): { key: string; params?: Record<string, string | number> } | null {
  if (!card) return { key: "progression.refuse.unknown" };
  if (new Set(path).size !== path.length) return { key: "progression.refuse.path.repeated" };
  const unknown = path.find(id => !nodeOf(card, id));
  if (unknown) return { key: "progression.refuse.path.unknown", params: { id: unknown } };
  if (path.length > pathPoints(level)) return { key: "progression.refuse.path.points", params: { level, n: pathPoints(level) } };
  const normal = normalPath(card, path);
  const loose = path.find(id => !normal.includes(id));
  if (loose) return { key: "progression.refuse.path.loose", params: { id: loose } };
  return null;
}

/** I nodi che si possono attivare adesso: attaccati alla carta o a un nodo attivo, non già attivi. */
export function reachable(card: ProgressionCard | null, path: string[]): string[] {
  const open = new Set<string>();
  for (const from of [PATH_ROOT, ...path]) for (const next of neighbors(card, from)) if (!path.includes(next) && next !== PATH_ROOT) open.add(next);
  return (card?.nodes ?? []).map(node => node.id).filter(id => open.has(id));
}

/** Il nodo si può smontare? Solo se ciò che resta rimane collegato alla carta. */
export function removable(card: ProgressionCard | null, path: string[], id: string): boolean {
  if (!path.includes(id)) return false;
  const rest = path.filter(other => other !== id);
  return normalPath(card, rest).length === rest.length;
}

/** Le abilità sbloccate dal percorso, per faccia. Gemello: Progression#unlocked. */
export function unlocked(card: ProgressionCard | null, path: string[]): Loadout {
  const nodes = path.map(id => nodeOf(card, id)).filter((node): node is PathNode => node?.kind === "ability");
  return { rubyfront: nodes.filter(node => node.face === "rubyfront").map(node => node.id), nexus: nodes.filter(node => node.face === "nexus").map(node => node.id) };
}

/** Ciò che il percorso dà in partita (§3.3). Gemello: Progression#ascent. */
export function ascentOf(card: ProgressionCard | null, path: string[]): Ascent {
  const totals: Ascent = { hp: 0, fury: 0 };
  for (const id of path) {
    const node = nodeOf(card, id);
    if (node && (node.kind === "hp" || node.kind === "fury")) totals[node.kind] += node.amount ?? 0;
  }
  return totals;
}

/** L'abilità con quell'id, con la sua faccia. */
export function abilityOf(card: ProgressionCard | null, id: string): { ability: ProgressionAbility; face: ProgressionFace } | null {
  const node = nodeOf(card, id);
  if (!node || node.kind !== "ability" || !node.face) return null;
  return { ability: { id: node.id, locales: node.locales ?? {} }, face: node.face };
}

/** Il nome e il testo di un'abilità nella lingua data (la lingua del catalogo se manca). */
export function abilityWords(ability: ProgressionAbility, locale: string): { name: string; text: string } {
  return ability.locales[locale] ?? ability.locales.it ?? ability.locales.en ?? { name: ability.id, text: "" };
}

/**
 * La configurazione è lecita? `null` se sì, se no la chiave i18n del motivo
 * (con i suoi parametri). Gemello: Progression#loadout_ok? — stesse regole:
 * solo le due facce, abilità del percorso e di quella faccia, niente
 * doppioni, al più gli slot della faccia.
 */
export function validateLoadout(card: ProgressionCard | null, path: string[], loadout: Loadout, rules: ProgressionRules): { key: string; params?: Record<string, string | number> } | null {
  if (!card) return { key: "progression.refuse.unknown" };
  const open = unlocked(card, path);
  for (const face of PROGRESSION_FACES) {
    const slots = loadout[face] ?? [];
    if (slots.length > rules.slots[face]) return { key: "progression.refuse.slots", params: { face, n: rules.slots[face] } };
    const ids = slots.filter((id): id is string => typeof id === "string");
    if (new Set(ids).size !== ids.length) return { key: "progression.refuse.repeated", params: { face } };
    const missing = ids.find(id => !open[face].includes(id));
    if (missing) return { key: "progression.refuse.locked", params: { face, id: missing } };
  }
  return null;
}

/** La configurazione ristretta al percorso: le abilità fuori dal percorso lasciano il loro blocco. Gemello: Progression#loadout_within. */
export function loadoutWithin(card: ProgressionCard | null, path: string[], loadout: Loadout): Loadout {
  const open = unlocked(card, path);
  const keep = (face: ProgressionFace): (string | null)[] => trimSlots((loadout[face] ?? []).map(id => (id && open[face].includes(id) ? id : null)));
  return { rubyfront: keep("rubyfront"), nexus: keep("nexus") };
}

/** La progressione «vuota» di un Rubyfront: livello 1, niente montato. */
export function freshProgress(cardId: string): PlayerProgress {
  return { card: cardId, xp: 0, level: 1, path: [], loadout: { rubyfront: [], nexus: [] } };
}

/** Le abilità montate di una faccia (senza i buchi). */
export function mountedIds(loadout: Loadout, face: ProgressionFace): string[] {
  return (loadout[face] ?? []).filter((id): id is string => typeof id === "string");
}

/** In quale blocco è montata l'abilità, o -1. */
export function slotOf(loadout: Loadout, face: ProgressionFace, id: string): number {
  return (loadout[face] ?? []).indexOf(id);
}

/** Una configurazione con quell'abilità montata nel blocco `slot` (tolta da dov'era), senza convalida: la convalida la fa chi decide. */
export function withAbility(loadout: Loadout, face: ProgressionFace, id: string, slot: number): Loadout {
  const next: Loadout = { rubyfront: [...loadout.rubyfront], nexus: [...loadout.nexus] };
  const list = next[face].map(other => (other === id ? null : other));
  while (list.length <= slot) list.push(null);
  list[slot] = id;
  next[face] = trimSlots(list);
  return next;
}

/** Una configurazione col blocco `slot` liberato (torna l'abilità stampata). */
export function withoutSlot(loadout: Loadout, face: ProgressionFace, slot: number): Loadout {
  const next: Loadout = { rubyfront: [...loadout.rubyfront], nexus: [...loadout.nexus] };
  const list = [...next[face]];
  if (slot < list.length) list[slot] = null;
  next[face] = trimSlots(list);
  return next;
}

/** I buchi in coda non contano: si tolgono. */
function trimSlots(list: (string | null)[]): (string | null)[] {
  const out = [...list];
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}
