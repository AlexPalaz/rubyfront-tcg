// La progressione dei Rubyfront (2026-09-23): il gemello TypeScript di
// engine/lib/rubyfront/progression.rb. Un modulo a parte, fuori dalle
// regole: livelli dall'esperienza, abilità sbloccate per livello,
// configurazione (le abilità montate, a slot fissi per faccia) e la sua
// convalida — stessi motivi del tavolo, qui come chiavi i18n. I dati
// arrivano dal catalogo (`progression` in docs/cards/catalog.json), come
// i mazzi. Le abilità di oggi sono segnaposto: non si giocano ancora.

export type ProgressionFace = "rubyfront" | "nexus";
export const PROGRESSION_FACES: ProgressionFace[] = ["rubyfront", "nexus"];
export const PROGRESSION_LEVELS = 10;

export interface ProgressionRules {
  /** thresholds[i] è l'esperienza cumulata per essere al livello i+1. */
  thresholds: number[];
  points: { win: number; loss: number; draw: number };
  slots: Record<ProgressionFace, number>;
}

export interface ProgressionAbility {
  id: string;
  locales: Record<string, { name: string; text: string }>;
}

export interface ProgressionLevel {
  level: number;
  rubyfront: ProgressionAbility;
  nexus: ProgressionAbility;
}

export interface ProgressionCard {
  card: string;
  levels: ProgressionLevel[];
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

/** La progressione di un giocatore su un Rubyfront, come la manda il tavolo. */
export interface PlayerProgress {
  card: string;
  xp: number;
  level: number;
  loadout: Loadout;
}

export type Outcome = "win" | "loss" | "draw";

export const EMPTY_LOADOUT: Loadout = { rubyfront: [], nexus: [] };

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

/** Gli id delle abilità sbloccate a quel livello, per faccia. Gemello: Progression#unlocked. */
export function unlocked(card: ProgressionCard | null, level: number): Loadout {
  const levels = (card?.levels ?? []).filter(entry => entry.level <= level);
  return { rubyfront: levels.map(entry => entry.rubyfront.id), nexus: levels.map(entry => entry.nexus.id) };
}

/** L'abilità con quell'id, con la sua faccia e il suo livello. */
export function abilityOf(card: ProgressionCard | null, id: string): { ability: ProgressionAbility; face: ProgressionFace; level: number } | null {
  for (const entry of card?.levels ?? []) {
    for (const face of PROGRESSION_FACES) if (entry[face].id === id) return { ability: entry[face], face, level: entry.level };
  }
  return null;
}

/** Il nome e il testo di un'abilità nella lingua data (la lingua del catalogo se manca). */
export function abilityWords(ability: ProgressionAbility, locale: string): { name: string; text: string } {
  return ability.locales[locale] ?? ability.locales.it ?? ability.locales.en ?? { name: ability.id, text: "" };
}

/**
 * La configurazione è lecita? `null` se sì, se no la chiave i18n del motivo
 * (con i suoi parametri). Gemello: Progression#loadout_ok? — stesse regole:
 * solo le due facce, id esistenti e sbloccati, niente doppioni, al più gli
 * slot della faccia.
 */
export function validateLoadout(card: ProgressionCard | null, level: number, loadout: Loadout, rules: ProgressionRules): { key: string; params?: Record<string, string | number> } | null {
  if (!card) return { key: "progression.refuse.unknown" };
  const open = unlocked(card, level);
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

/** La progressione «vuota» di un Rubyfront: livello 1, niente montato. */
export function freshProgress(cardId: string): PlayerProgress {
  return { card: cardId, xp: 0, level: 1, loadout: { rubyfront: [], nexus: [] } };
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
