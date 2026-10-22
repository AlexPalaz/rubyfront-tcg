// La lavagna normalizzata per il corpus differenziale (2026-10-21, audit
// RF-029): ciò che il riduttore (state.ts) e la copia Ruby (table.rb,
// `Table#dump`) devono tenere UGUALE, nella stessa forma JSON. Niente
// pixel, niente nomi, niente memorie di un solo lato (`fired`, `lastWave`):
// le carte in ordine di uid, le dichiarazioni per dichiarante, i tiri per chiave.

import type { GameState, Seat } from "../../src/types.js";

export interface NormalizedState {
  turn: number;
  active: Seat;
  phase: string;
  over: { winner: Seat | null; reason: string } | null;
  players: Record<Seat, {
    hp: number; hpMax: number | null; flux: number; fluxMax: number; token: boolean; deckId: string | null; sealed: string[];
    opening: { mulligans: number; kept: boolean } | null; ascent: { hp: number; fury: number };
  }>;
  cards: {
    uid: string; cardId: string | null; owner: Seat; zone: string; order: number | null; tapped: boolean; facedown: boolean; face: number;
    assignedTo: string | null; controller: Seat | null; stasis: boolean; heldBy: string | null; target: string | null;
    powerBonus: number | null; counterBonus: number | null; cannotBlock: boolean; grants: string[];
  }[];
  declarations: { from: string; to: string; kind: string; order: number; sealed: boolean; bonus: number }[];
  chain: { stack: string[]; turn: Seat; resolving: boolean } | null;
  rolls: Record<string, { die: number; value: number }>;
}

export function normalize(state: GameState): NormalizedState {
  const seats: Seat[] = ["a", "b"];
  const players = Object.fromEntries(
    seats.map(seat => {
      const player = state.players[seat];
      return [seat, {
        hp: player.hp,
        hpMax: player.hpMax ?? null,
        flux: player.flux,
        fluxMax: player.fluxMax,
        token: player.token === true,
        deckId: player.deckId ?? null,
        sealed: [...(player.sealed ?? [])].sort(),
        opening: player.opening ? { mulligans: player.opening.mulligans, kept: player.opening.kept === true } : null,
        ascent: { hp: player.ascent?.hp ?? 0, fury: player.ascent?.fury ?? 0 },
      }];
    })
  ) as NormalizedState["players"];
  const cards = Object.values(state.cards)
    .sort((x, y) => (x.uid < y.uid ? -1 : x.uid > y.uid ? 1 : 0))
    .map(card => ({
      uid: card.uid,
      cardId: card.cardId === "?" ? null : card.cardId,
      owner: card.owner,
      zone: card.zone,
      order: card.zone === "field" ? null : card.order,
      tapped: card.tapped === true,
      facedown: card.facedown === true,
      face: card.face,
      assignedTo: card.assignedTo ?? null,
      controller: card.controller ?? null,
      stasis: card.stasis === true,
      heldBy: card.heldBy ?? null,
      target: card.target ?? null,
      powerBonus: card.powerBonus ?? null,
      counterBonus: card.counterBonus ?? null,
      cannotBlock: card.cannotBlock === true,
      grants: [...(card.grants ?? [])].sort(),
    }));
  const declarations = [...state.declarations]
    .sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : 0))
    .map(declaration => ({ from: declaration.from, to: declaration.to, kind: declaration.kind, order: declaration.order, sealed: declaration.sealed === true, bonus: declaration.bonus ?? 0 }));
  const rolls = Object.fromEntries(Object.entries(state.rolls ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([key, roll]) => [key, { die: roll.die, value: roll.value }]));
  return {
    turn: state.turn,
    active: state.active,
    phase: state.phase,
    over: state.over ? { winner: state.over.winner, reason: state.over.reason } : null,
    players,
    cards,
    declarations,
    chain: state.chain ? { stack: [...state.chain.stack], turn: state.chain.turn, resolving: state.chain.resolving === true } : null,
    rolls,
  };
}
