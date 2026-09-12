// I tasti del tavolo, senza DOM (F4): quali gesti offre una carta adesso. I
// tasti di combattimento sotto le carte (§6.3, §6.4) — non il click sulla
// carta, non il tasto destro, non il trascinamento (deciso 2026-09-09) —,
// chi si può scegliere nella mira di un blocco, quando la mano è chiusa a
// chiave (§6) e quando si scarta l'eccesso (§6.5). Stavano in
// simulatore/src/table.ts: il simulatore e il gioco offrono gli stessi
// tasti, e ciascuno li disegna a modo suo. Un tasto non esegue nulla: dice
// l'azione, e la vista la compie (dichiarare, aprire o chiudere la mira).

import { faceCount, faceKind } from "./cards.js";
import type { Ctx } from "./ctx.js";
import { t } from "./i18n.js";
import { controllerOf, declarationOf, phaseCloser, zoneCards } from "./state.js";
import type { CardInstance, Declaration, Seat, ZoneId } from "./types.js";
import { otherSeat } from "./types.js";

/**
 * La mira in corso, per quel che serve ai tasti: per i blocchi (§6.3)
 * l'attaccante da fermare, o dalla propria carta il bloccante che cerca
 * l'attaccante; per un effetto (§8.2) i candidati.
 */
export type TargetingMode =
  | { mode: "block"; attacker: string; kind: "block" | "counter" }
  | { mode: "blocker"; blocker: string; kind: "block" | "counter" }
  | { mode: "effect"; candidates: Set<string> };

/** Che cosa fa un tasto. */
export type TabAction =
  /** §6.3 — dichiara l'attacco con questa Entità. */
  | { do: "attack" }
  /** Ritira la dichiarazione (attacco, blocco o contrattacco non ancora fermi). */
  | { do: "undeclare"; declaration: Declaration }
  /** Da un attaccante avversario: si cerca il proprio bloccante. */
  | { do: "target"; kind: "block" | "counter" }
  /** Dalla propria Entità: si cerca l'attaccante da fermare. */
  | { do: "targetFrom"; kind: "block" | "counter" }
  /** Nella mira di un blocco: questa è la carta scelta. */
  | { do: "confirm" }
  /** Nella mira di un blocco: si rinuncia. */
  | { do: "cancel" };

export interface CombatTab {
  label: string;
  kind: "attack" | "block" | "counter" | "confirm" | "cancel";
  action: TabAction;
}

/**
 * I tasti di combattimento sotto una carta (§6.3, §6.4). In Fase di Fronte,
 * nel proprio turno, sotto ogni propria Entità che può attaccare: «Attacca»;
 * sotto l'attaccante dichiarato: «Annulla». In Reazione, per chi governa il
 * difensore: sotto ogni attaccante avversario «Blocca» e «Contrattacca», poi
 * sotto le proprie Entità «Con questa»; oppure sotto la propria Entità
 * «Blocca» e «Contrattacca», poi sotto gli attaccanti «Ferma questo»; sotto
 * un bloccante dichiarato, e sotto la carta da cui è partita una scelta,
 * «Annulla».
 */
export function combatTabs(ctx: Ctx, card: CardInstance, targeting: TargetingMode | null): CombatTab[] {
  const state = ctx.state();
  if (card.zone !== "field") return [];
  const controller = controllerOf(card);
  const declared = declarationOf(state, card.uid);
  const kind = faceKind(card.cardId, card.face);
  const entity = kind === null || kind === "entity";
  // Un effetto in mira: nessun tasto di combattimento in mezzo.
  if (targeting?.mode === "effect") return [];
  // Una coperta non fa nulla (§6.3) — salvo ripensare il contrattacco che
  // l'ha coperta: quel tasto resta, in Reazione, a chi la governa.
  if (card.facedown) {
    if (!targeting && state.phase === "reazione" && declared && declared.kind !== "attack" && !declared.sealed && ctx.controls(controller)) {
      return [{ label: t("tab.cancel"), kind: "cancel", action: { do: "undeclare", declaration: declared } }];
    }
    return [];
  }

  // La scelta in corso: si conferma o si annulla.
  if (targeting?.mode === "block") {
    if (card.uid === targeting.attacker) return [{ label: t("tab.cancel"), kind: "cancel", action: { do: "cancel" } }];
    if (pickable(ctx, card, targeting) && entity && !declared) return [{ label: t("tab.with"), kind: targeting.kind, action: { do: "confirm" } }];
    return [];
  }
  if (targeting?.mode === "blocker") {
    if (card.uid === targeting.blocker) return [{ label: t("tab.cancel"), kind: "cancel", action: { do: "cancel" } }];
    if (pickable(ctx, card, targeting)) return [{ label: t("tab.this"), kind: targeting.kind, action: { do: "confirm" } }];
    return [];
  }

  // Fase di Fronte, il proprio turno: si attacca (§6.3). Il Rubyfront non
  // attacca (§3.1), dichiarano le Entità; una tappata non può.
  if (state.phase === "fronte" && state.active === controller && ctx.controls(controller) && entity) {
    // L'attacco che ha già innescato i suoi effetti è fermo (§8.2): niente Annulla.
    if (declared?.kind === "attack") return declared.sealed ? [] : [{ label: t("tab.cancel"), kind: "cancel", action: { do: "undeclare", declaration: declared } }];
    if (!declared && !card.tapped) return [{ label: t("menu.attack"), kind: "attack", action: { do: "attack" } }];
    return [];
  }

  // Reazione: il difensore (l'altro posto rispetto a chi è di turno) ferma
  // gli attaccanti, «vista l'intera ondata» (§6.4).
  if (state.phase !== "reazione") return [];
  const defender = otherSeat(state.active);
  if (!ctx.controls(defender)) return [];
  if (declared?.kind === "attack" && controller === state.active) {
    return [
      { label: t("tab.block"), kind: "block", action: { do: "target", kind: "block" } },
      { label: t("tab.counter"), kind: "counter", action: { do: "target", kind: "counter" } },
    ];
  }
  if (controller !== defender) return [];
  if (declared) return declared.sealed ? [] : [{ label: t("tab.cancel"), kind: "cancel", action: { do: "undeclare", declaration: declared } }];
  if (!entity || card.tapped || card.cannotBlock) return [];
  const attackers = state.declarations.some(d => d.kind === "attack" && controllerOf(state.cards[d.from]) === state.active);
  if (!attackers) return [];
  return [
    { label: t("tab.block"), kind: "block", action: { do: "targetFrom", kind: "block" } },
    { label: t("tab.counter"), kind: "counter", action: { do: "targetFrom", kind: "counter" } },
  ];
}

/**
 * Il posto che sceglie il bloccante: l'altra metà rispetto all'attaccante.
 * In rete è sempre il proprio; in partita locale può essere l'uno o l'altro,
 * a seconda di chi ha dichiarato l'attacco. Null fuori dalla mira di un blocco.
 */
export function defenderSeat(ctx: Ctx, targeting: TargetingMode | null): Seat | null {
  if (targeting?.mode !== "block") return null;
  const attacker = ctx.state().cards[targeting.attacker];
  return attacker ? otherSeat(controllerOf(attacker)) : null;
}

/** La carta è sceglibile nella mira in corso? */
export function pickable(ctx: Ctx, card: CardInstance, targeting: TargetingMode | null): boolean {
  if (!targeting) return false;
  if (targeting.mode === "effect") return targeting.candidates.has(card.uid);
  if (targeting.mode === "blocker") {
    // Si cerca l'attaccante: le carte dichiarate in attacco dall'altra metà.
    const blocker = ctx.state().cards[targeting.blocker];
    if (!blocker) return false;
    return controllerOf(card) === otherSeat(controllerOf(blocker)) && declarationOf(ctx.state(), card.uid)?.kind === "attack";
  }
  return controllerOf(card) === defenderSeat(ctx, targeting) && card.uid !== targeting.attacker;
}

/**
 * §6 — «nel turno altrui non si agisce»: la mano di `seat` è chiusa a
 * chiave quando il momento non è suo. Il momento è suo quando chiude la
 * fase (chi è di turno; in Reazione il difensore, §6.4) o quando la catena
 * di risposta aspetta lui (§7.2). Fuori di lì la mano si guarda e basta —
 * salvo che il tavolo gli chieda esplicitamente una carta (la scelta da una
 * pila non passa dalla mano). Vale per il bot come per un avversario in
 * rete: a tavolo libero (senza arbitro) resta libera.
 */
export function handLocked(ctx: Ctx, seat: Seat): boolean {
  if (!ctx.arbitrated()) return false;
  const state = ctx.state();
  if (state.chain && !state.chain.resolving) return state.chain.turn !== seat;
  // §6.5 — l'eccesso si scarta alla fine del PROPRIO turno, anche quando
  // la Reazione la chiude il difensore (§6.4): con più di 7 carte la mano
  // di chi è di turno resta aperta, o il turno non passerebbe mai.
  if (state.active === seat && zoneCards(state, seat, "hand").length > 7) return false;
  return phaseCloser(state) !== seat;
}

/**
 * §6.5 — «non si possono avere più di 7 carte in mano: alla fine del
 * proprio turno, le carte in eccesso vanno scartate» — in Zona di Ritiro
 * (§5: lo scarto non è una morte). Con l'eccesso in mano lo scarto è
 * l'unico modo di andare in Zona di Ritiro dalla mano.
 */
export function canDiscard(ctx: Ctx, card: CardInstance): boolean {
  return card.zone === "hand" && ctx.controls(card.owner) && !handLocked(ctx, card.owner) && zoneCards(ctx.state(), card.owner, "hand").length > 7;
}

/** Che cosa fa una voce del menu di una carta. */
export type MenuAction =
  | { do: "tap"; tapped: boolean }
  | { do: "facedown"; facedown: boolean }
  /** §3.1 — il flip verso il Nexus, col requisito (a tavolo libero la carta si gira e basta). */
  | { do: "flipNexus" }
  | { do: "flip"; face: number }
  | { do: "toZone"; zone: ZoneId; toBottom: boolean }
  /** §6.5 — lo scarto dell'eccesso, in Zona di Ritiro. */
  | { do: "discard" };

export type MenuEntry = { rule: true } | { label: string; disabled?: boolean; action: MenuAction };

/**
 * Il menu di una carta (tasto destro, pressione lunga). Attaccare, bloccare,
 * contrattaccare e annullare NON passano da qui: sono i tasti sotto le carte
 * (combatTabs), come «Schiera» (deciso 2026-09-09). Qui restano i gesti di
 * lavagna — e con l'arbitro al tavolo quasi tutti si ritirano: tappare,
 * coprire e girare discendono dalle dichiarazioni e dal turno (§6.3), dal
 * campo si esce per effetto o col Ritiro (§6.2), dall'Abisso e dalla Zona di
 * Ritiro non si torna (§5). A engine spento: lavagna libera.
 */
export function cardMenu(ctx: Ctx, card: CardInstance): MenuEntry[] {
  const items: MenuEntry[] = [];
  // «Mia» = comandata da un posto che governo: chi la controlla, o il proprietario (§8.2).
  const mine = ctx.controls(controllerOf(card));
  if (card.zone === "field") {
    // Con l'arbitro resta «Scopri» solo per una coperta SENZA data — arrivata
    // da una lavagna che non la segnava — che altrimenti non si scoprirebbe mai.
    if (!ctx.arbitrated()) {
      items.push({ label: t(card.tapped ? "menu.untap" : "menu.tap"), action: { do: "tap", tapped: !card.tapped } });
      items.push({ label: t(card.facedown ? "menu.uncover" : "menu.cover"), action: { do: "facedown", facedown: !card.facedown } });
    } else if (card.facedown && card.coveredTurn === undefined) {
      items.push({ label: t("menu.uncover"), action: { do: "facedown", facedown: false } });
    }
  }
  // §3.1 — le abilità e il flip verso il Nexus, con l'arbitro, stanno sul
  // tasto «Abilità» sotto il Rubyfront (deciso 2026-09-08). A tavolo libero
  // il flip resta qui.
  if (faceCount(card.cardId) > 1 && !(ctx.arbitrated() && mine)) {
    const next = (card.face + 1) % faceCount(card.cardId);
    const nexus = ctx.card(card.cardId).nexus;
    if (ctx.arbitrated() && nexus && mine) {
      if (card.face !== nexus.face && card.zone === "field") items.push({ label: t("menu.flip.nexus"), action: { do: "flipNexus" } });
    } else {
      items.push({ label: t(card.face === 0 ? "menu.flip.nexus" : "menu.flip.rubyfront"), action: { do: "flip", face: next } });
    }
  }
  items.push({ rule: true });
  const send = (zone: ZoneId, label: string, toBottom = false): MenuEntry => ({ label, disabled: card.zone === zone && !toBottom, action: { do: "toZone", zone, toBottom } });
  // §5/§6.2 — con l'arbitro, dall'Abisso e dalla Zona di Ritiro si esce solo
  // per effetto. §8.2 — e l'Entità PRESA IN CONTROLLO non è tua: non si manda
  // da nessuna parte, men che meno nella Zona di Ritiro di chi la possiede.
  const borrowed = ctx.arbitrated() && card.controller !== undefined && card.controller !== card.owner;
  const sealed = borrowed || (ctx.arbitrated() && (card.zone === "abisso" || card.zone === "ritiro"));
  const owned = ctx.controls(card.owner);
  if (owned && !sealed) items.push(send("hand", t("menu.to.hand")));
  // §5/§6.5 — con l'arbitro nell'Abisso non si va a mano: ci si va morendo o
  // consumandosi (una Materia in campo). Lo scarto per eccesso va in Zona di
  // Ritiro e ha la sua voce, che dice perché si può.
  const discard = canDiscard(ctx, card);
  if (discard) items.push({ label: t("menu.discard"), action: { do: "discard" } });
  else if (!sealed && (!ctx.arbitrated() || (card.zone === "field" && ctx.card(card.cardId).kind === "matter"))) items.push(send("abisso", t("menu.to.abisso")));
  // Il Ritiro è un gesto del Fronte (§6.2); un Oggetto in campo non si ritira
  // da solo, segue la sua Entità (deciso 2026-09-11).
  const objectOnField = card.zone === "field" && ctx.card(card.cardId).kind === "object";
  if (!sealed && !discard && (!ctx.arbitrated() || (card.zone === "field" && !objectOnField))) items.push(send("ritiro", t("menu.to.ritiro")));
  if (owned && !sealed) {
    items.push(send("deck", t("menu.to.deck.top")));
    items.push({ label: t("menu.to.deck.bottom"), action: { do: "toZone", zone: "deck", toBottom: true } });
  }
  return items;
}
