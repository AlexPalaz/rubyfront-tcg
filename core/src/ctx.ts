// Il contesto che le viste condividono: leggere lo stato, mandare un'azione,
// sapere chi sono. Niente altro — le viste non parlano mai fra loro.
//
// Qui stanno il `Ctx` e le forme certificate che l'anagrafe del client
// (cards.ts) legge dalle carte. La geometria canonica della lavagna sta in
// geometry.ts; quella di VISTA è di ciascun client.

import type { Tint } from "./cards.js";
import type { LogMsg } from "./i18n.js";
import type { Action, GameState, Seat, Phase } from "./types.js";

export interface CardFacts {
  name: string;
  kind: "rubyfront" | "nexus" | "entity" | "object" | "matter" | null;
  race: string | null;
  power: number | null;
  counterattack: number | null;
  /** Il costo di Flusso stampato (§3.2), null dove non c'è. */
  fluxCost: number | null;
  /** Le parole chiave stampate (§8.1): surge, revenge, stasis, fury… */
  keywords: string[];
  /** Gli ascoltatori certificati «quando un'Entità entra sul tuo Fronte»
      (§8.2): vedi renderer.ts, enterListeners. */
  enterListeners: EnterListener[];
  /** Gli effetti certificati «quando QUESTA entra sul Fronte: metti una carta
      avversaria in una zona» (§8.2): vedi renderer.ts, enterMoves. */
  enterMoves: EnterMove[];
  /** Il comportamento di una Materia (§7.2): normal, permanent, reactive; null altrove. */
  behavior: string | null;
  /** Gli effetti certificati «quando QUESTA entra sul Fronte: metti sul tuo
      Fronte una carta dalla tua Zona di Ritiro» (§8.2): vedi enterReturns. */
  enterReturns: EnterReturn[];
  /** Gli sguardi nel mazzo certificati «quando QUESTA entra» (§8.2): vedi enterLooks. */
  enterLooks: EnterLook[];
  /** I ritorni certificati «quando QUESTA attacca» (§8.2, RBF-012): stessa forma degli ingressi. */
  attackReturns: EnterReturn[];
  /** I controlli certificati «quando QUESTA entra» (§8.2): vedi enterControls. */
  enterControls: EnterControl[];
  /** Le stappate certificate «quando QUESTA entra» (§8.2, RBF-011): vedi enterRefreshes. */
  enterRefreshes: EnterRefresh[];
  /** I disarmi certificati «quando QUESTA entra: gli Oggetti avversari in Ritiro» (§8.2): vedi enterDisarms. */
  enterDisarms: EnterDisarm[];
  /** I riarmi certificati «quando QUESTA entra: gli Oggetti dal tuo Ritiro alle tue Entità, gratis» (§8.2). */
  enterRearms: EnterRearm[];
  /** I ritorni vincolati certificati «mandata nell'Abisso o in Ritiro senza Oggetti, torna con un Oggetto» (§8.2). */
  leaveReturns: LeaveReturn[];
  /** Le pesche certificate «quando QUESTA attacca con un Oggetto» (§8.2, RBF-026). */
  attackDraws: AttackDraw[];
  /** Le altre forme certificate «quando attacca» (§8.2): vedi AttackForm. */
  attackForms: AttackForm[];
  /** Gli statici di Potenza certificati (§8.2): vedi StaticForm. */
  staticForms: StaticForm[];
  /** Gli effetti certificati delle Materie alla risoluzione (§7.2): vedi ResolveForm. */
  resolveForms: ResolveForm[];
  /** Gli effetti certificati «quando flippa» del Nexus (§3.1): vedi FlipForm. */
  flipForms: FlipForm[];
  /** Gli effetti certificati «quando assegni questa carta» di un Oggetto (§3.1): vedi AssignForm. */
  assignForms: AssignForm[];
  /** Gli effetti certificati «quando quell'Entità muore» di un Oggetto (§8.2): vedi DeathForm. */
  deathForms: DeathForm[];
  /** Il requisito del flip verso il Nexus (§3.1), col recupero di PV; null se non c'è o non è certificato. */
  nexus: NexusRequirement | null;
  /** Le abilità speciali del Rubyfront/Nexus (§3.1), per faccia: vedi Ability. */
  abilities: Ability[];
  /** La soglia della Furia per faccia (§8.1), «d20 ≥ N»; assente dove non c'è Furia. */
  furyAt: Record<number, number>;
  /** Le parole chiave che un Oggetto concede «mentre assegnato» (RBF-013:
      la Stasi agli Umani). Specchio di card_index.rb, grants_while_assigned. */
  grantsWhileAssigned: { keywords: string[]; ifRace: string | null }[];
}

/**
 * Gli statici di Potenza certificati (§8.2), specchio di card_index.rb,
 * static_forms: su di sé («+1 mentre attacca se c'è un'altra Entità Umana»,
 * RBF-002; «+1 per ogni altra Entità Umana», RBF-010) o sul portatore
 * dell'Oggetto («+1», RBF-013; «+1 per ogni Entità Umana, e può essere
 * bloccata da più Entità», RBF-014).
 */
export type StaticForm =
  | { kind: "self_power"; amount: number; whileAttacking?: true; requiresOther?: { kind: "entity"; race: string | null }; perOther?: { kind: "entity"; race: string | null }; whileArmed?: true }
  | { kind: "bearer_power"; amount: number; per?: { kind: "entity"; race: string | null }; multiBlock?: boolean }
  /** RBF-011: «questa Entità non si tappa mai». */
  | { kind: "never_taps" }
  /** La tassa di Flusso: «all'inizio di ogni tuo turno hai N Flusso in meno» finché resta sul Fronte. */
  | { kind: "flux_toll"; amount: number }
  /** «Il Contrattacco aumenta di 1 per ogni Oggetto assegnato a questa Entità» (dal 2026-09-10). */
  | { kind: "self_counter"; amount: number; perObject: true }
  /** «Contrattacco +1» al portatore, dall'Oggetto. */
  | { kind: "bearer_counter"; amount: number }
  /** «Gli Oggetti che assegni a questa Entità costano N Flusso in meno» (dal 2026-09-10). */
  | { kind: "assign_discount"; amount: number }
  /** «Le altre Entità con un Oggetto assegnato che controlli hanno +N Potenza» (dal 2026-09-10). */
  | { kind: "others_armed_power"; amount: number };

/**
 * Gli effetti certificati delle Materie alla risoluzione (§7.2), specchio
 * di card_index.rb, resolve_forms: `kind` è il passo del tavolo.
 */
export type ResolveForm =
  /** RBF-015: guarda le prime N, mostra un'Entità Umana (fino a `showUpTo` in vista), una in mano, le altre in fondo. */
  | { kind: "look"; count: number; reveal: { kind: "entity" | "object" | "matter"; race: string | null }; revealTo: "hand"; restTo: "deck"; showUpTo: number }
  /** RBF-016: stappa un'Entità Umana che controlli, +1 Potenza. */
  | { kind: "empower"; targets: "own_entity"; race: string | null; power: number; untap: true }
  /** RBF-020: in Reazione, senza bloccare (§6.4); con almeno N Umani: stappa gli Umani, Contrattacco +1. */
  | { kind: "empower"; targets: "own_entities"; race: string | null; counter: number; untap: true; requires: { count: number; race: string | null } }
  /** RBF-017: un'Entità avversaria con costo N o inferiore nella Zona di Ritiro; con lo sconto «se sul tuo Fronte ci sono almeno N Entità con un Oggetto, costa M in meno» (dal 2026-09-10). */
  | { kind: "move"; target: { kind: "entity"; controller: "opponent"; maxCost: number | null }; to: "ritiro"; discount: { amount: number; ifArmedAtLeast: number } | null }
  /** L'indebolimento (dal 2026-09-10): «un'Entità avversaria attaccante prende −1 Potenza per ogni Entità con un Oggetto assegnato che controlli». */
  | { kind: "weaken"; target: { kind: "entity"; controller: "opponent"; attacking: true }; amount: number; perArmed: true }
  /** Il potenziamento delle armate (dal 2026-09-10): «fino a N Entità con un Oggetto assegnato che controlli prendono +M Potenza e vengono stappate». */
  | { kind: "empower"; targets: "own_armed"; power: number; upTo: number; untap: true }
  /** RBF-018: un permanente avversario nell'Abisso, finché questa carta resta in gioco. */
  | { kind: "exile"; target: { permanent: true; controller: "opponent" }; to: "abisso"; hold: true }
  /** RBF-019: il d20 a fasce — PV, un'Entità dalla mano, una pesca, o tutto. */
  | { kind: "fortune"; die: number; gain: { on: [number, number]; amount: number }; deploy: { on: [number, number]; filter: { kind: "entity"; race: string | null; maxCost: number | null } }; draw: { on: [number, number]; count: number }; allOn: [number, number] }
  /** RBF-021: distruggi un'Entità; contro una tappata costa N in meno. */
  | { kind: "destroy"; target: { kind: "entity"; controller: "any" | "opponent" | "controller" }; to: "abisso"; discount: { amount: number; ifTarget: "tapped" } | null; thenLose: number | null }
  /** Il prosciugamento (dal 2026-09-10): «il Rubyfront/Nexus avversario perde PV pari al numero di Oggetti assegnati alle Entità che controlli». */
  | { kind: "drain"; amount: "objects" }
  /** La ricerca col dado (dal 2026-09-10): guarda le prime N e tira un d20 — mostra per fascia in mano, o una in cima; poi una in Ritiro, le altre in fondo. */
  | { kind: "search"; count: number; die: number; bands: Record<"matter" | "object" | "entity", [number, number] | undefined>; revealTo: "hand"; ifNoRevealTop: true; thenRetire: true; restTo: "deck" }
  /** la Reattiva bloccante (forma `block`): giocata come bloccante di un'Entità attaccante (l'attacco è bloccato, §6.4); con almeno N Entità armate sul Fronte, +M PV. */
  | { kind: "block"; requiresArmed: number; heal: number; asBlock: true };

/**
 * Gli effetti certificati «quando assegni questa carta a un'Entità» (§3.1,
 * §8.2), specchio di card_index.rb, assign_forms: l'esilio condizionato
 * tenuto dall'Oggetto (dal 2026-09-10).
 */
export type AssignForm =
  /** Sull'Oggetto: «quando assegni questa carta a un'Entità, manda nell'Abisso un'Entità avversaria finché questa carta resta in gioco». */
  | { kind: "exile"; target: { kind: "entity"; controller: "opponent" }; to: "abisso"; hold: true }
  /** Sull'Entità: «quando assegni un Oggetto a questa Entità: pesca una carta». */
  | { kind: "draw"; count: number; toSelf: true }
  /** Sul Rubyfront: «la prima volta in ogni tuo turno che assegni un Oggetto, guarda la prima e l'ultima carta del tuo mazzo: puoi scambiarle. Poi pesca N e scarta M». */
  | { kind: "ends"; face: number; swap: true; thenDraw: number; thenDiscard: number; once: true }
  /** Sul Nexus: «…guarda la prima e l'ultima carta del tuo mazzo: aggiungine una alla tua mano e metti l'altra nella tua Zona di Ritiro». */
  | { kind: "ends"; face: number; toHand: true; otherToRetire: true; once: true };

/**
 * Gli effetti certificati di un Oggetto «quando quell'Entità muore» (§5,
 * §8.2), specchio di card_index.rb, death_forms: resta in Ritiro invece
 * che nell'Abisso, poi un altro Oggetto dal Ritiro a una disarmata, gratis.
 */
export type DeathForm = { kind: "remain"; to: "ritiro"; thenRearm: { other: true; to: "unarmed"; free: true } };

/** «Quando flippa» (§3.1, RBF-001): la carta nominata nell'Abisso, e il sigillo. */
export type FlipForm =
  | { kind: "move"; cardId: string; from: "field"; to: "abisso" }
  | { kind: "seal"; cardId: string }
  /** «Poi pesca una carta» (dal 2026-09-10). */
  | { kind: "draw"; count: number };

/** Il requisito del flip verso il Nexus (§3.1), certificato: N Entità [di razza] e lo scarto di una carta [di tipo]; il recupero di PV. */
/**
 * Un'abilità speciale del Rubyfront/Nexus (§3.1), specchio di
 * card_index.rb, abilities: la faccia che la porta, la finestra (le fasi
 * del proprio turno), il costo o il recupero in PV, se la Furia (§8.1) la
 * precede, e la forma certificata del suo effetto — null se l'engine non la
 * legge (resta a mano, e non si attiva con l'arbitro).
 */
export interface Ability {
  id: string;
  displayKey: string;
  face: number;
  timing: Phase[];
  cost: number | null;
  gain: number | null;
  fury: boolean;
  form: AbilityForm | null;
}

export type AbilityForm =
  /** «Guarda le prime N carte del tuo mazzo. Puoi mostrare … e aggiungerla alla tua mano. Metti le altre in fondo.» */
  | { kind: "look"; count: number; reveal: { kind: "entity" | "object"; race: string | null } }
  /** «+N Potenza fino alla fine del turno» a tutte le proprie Entità del filtro, o a una. */
  | { kind: "power"; amount: number; targets: "all" | "one"; race: string | null; attacking: boolean; armed: boolean }
  /** «La prossima carta X che giochi in questo turno costa N in meno.» */
  | { kind: "discount"; amount: number; type: "entity" | "object"; race: string | null }
  /** «Puoi mettere sul tuo Fronte un'Entità [razza] dalla tua mano senza
      pagarne il costo di Flusso. Ottiene [parole chiave] fino alla fine del
      turno, e le prossime Entità Umane che attaccano in questo turno
      prendono +N Potenza.» La chiamata sul Fronte: facoltativa. */
  | { kind: "summon"; race: string | null; grants: string[]; bonus: { amount: number; race: string | null } };

export interface NexusRequirement {
  face: number;
  conditions: { count: number; kind: "entity"; race: string | null; armed?: true }[];
  discard: { count: 1; kind: string | null } | null;
  recovery: number | null;
}

/**
 * Le altre forme certificate «quando attacca» (§8.2), specchio di
 * card_index.rb, attack_forms: `kind` è l'azione del tavolo, `who` chi è
 * la fonte rispetto all'attaccante (chi attacca, un Oggetto addosso, una
 * carta alleata, una Materia permanente, il Rubyfront), `face` la faccia
 * che porta la forma.
 */
export type AttackForm =
  /** RBF-028: stappala dopo il combattimento. */
  | { kind: "untap"; who: "self"; once: true; requiresObject: true; face: number }
  /** RBF-029 (+1 alle altre armate), RBF-034 (+1 al portatore), RBF-004
      (Vendetta al prossimo Umano), RBF-005 (un'avversaria non blocca). */
  | { kind: "empower"; who: "self" | "object"; targets: "others_armed" | "bearer" | "next_human_attacker" | "opposing_entity"; power?: number; grants?: string[]; restrict?: "block"; once?: true; requiresObject?: true; requiresAttackers?: { count: number; race: string }; requiresPreviousAttackers?: { count: number; race: string }; face: number }
  /** RBF-034 (col dado) e RBF-031 (una volta per turno): uno sguardo nel mazzo. */
  | { kind: "look"; who: "object" | "ally"; count: number; reveal: { kind: "matter" | "object" | "entity"; race: string | null }; revealTo: "hand" | "ritiro"; restTo: "deck" | "ritiro"; die: number | null; onRoll: [number, number] | null; once?: true; attackerArmed?: true; face: number }
  /** RBF-008 (+N, poi col dado un'Entità in mano), RBF-022 (il d20 sugli
      Umani), RBF-001 (il raduno, una volta per turno). */
  | { kind: "heal"; who: "self" | "permanent" | "rubyfront"; amount: number | "human_attackers"; die: number | null; onRoll: [number, number] | null; thenRecall?: { kind: "entity" }; attackers?: { kind: "entity"; race: string }; gainOn?: [number, number]; drainOn?: [number, number]; once?: true; requiresAttackers?: { count: number; race: string }; thenDraw?: number; thenDiscard?: number; face: number }
  /** RBF-010: col dado, un'Entità Umana dal Ritiro sul Fronte, che attacca insieme. */
  | { kind: "return"; who: "self"; die: number; onRoll: [number, number]; filter: { kind: "entity"; race: string }; joins: true; face: number }
  /** RBF-031: un Oggetto dal Ritiro addosso a chi attacca, gratis. */
  | { kind: "rearm"; who: "ally"; attackerArmed: true; face: number };

/**
 * La forma certificata di una pesca all'attacco: «la prima volta in ogni
 * tuo turno che questa Entità attacca mentre ha un Oggetto assegnato,
 * pesca N carte, poi scarta M». È la forma di RBF-026.
 */
export interface AttackDraw {
  draw: number;
  thenDiscard: number;
  requiresObject: true;
}

/**
 * La forma certificata di un controllo all'ingresso: «prendi il controllo
 * di un'Entità avversaria con costo di Flusso N o inferiore fino alla fine
 * del turno; ottiene [parole chiave] fino alla fine del turno». È la forma
 * di RBF-009.
 */
export interface EnterControl {
  target: { kind: "entity"; controller: "opponent"; maxCost: number | null };
  grants: string[];
}

/**
 * La forma certificata di una stappata all'ingresso: «quando entra in
 * campo, lancia un d20: con 15–20 stappa tutte le Entità che controlli». È
 * la forma di RBF-011 (dal 2026-09-05).
 */
export interface EnterRefresh {
  die: number;
  onRoll: [number, number];
}

/**
 * La forma certificata di un disarmo all'ingresso (dal 2026-09-10): «quando
 * entra sul Fronte, metti nella Zona di Ritiro del suo proprietario ogni
 * Oggetto assegnato a un'Entità avversaria». Specchio di card_index.rb,
 * enter_disarms.
 */
export interface EnterDisarm {
  to: "ritiro";
}

/**
 * La forma certificata di un riarmo all'ingresso (dal 2026-09-10): «poi
 * puoi assegnare alle Entità che controlli, come preferisci e senza pagarne
 * il costo di Flusso, gli Oggetti della tua Zona di Ritiro». Specchio di
 * card_index.rb, enter_rearms.
 */
export interface EnterRearm {
  /** Kyo Shin: alle Entità che controlli, quanti si vuole. */
  any?: true;
  /** Artefice: un Oggetto a sé stessa, una volta. */
  self?: true;
}

/**
 * La forma certificata del ritorno vincolato (dal 2026-09-10): «quando viene
 * mandata nell'Abisso o nella Zona di Ritiro, se non aveva Oggetti
 * assegnati, puoi rimetterla sul tuo Fronte assegnandole un Oggetto con
 * costo di Flusso N o inferiore dalla tua Zona di Ritiro, senza pagarne il
 * costo». Specchio di card_index.rb, leave_returns.
 */
export interface LeaveReturn {
  maxCost: number;
}

/**
 * La forma certificata di uno sguardo nel mazzo all'ingresso: «guarda le
 * prime N carte del tuo mazzo, puoi mostrarne una [di tipo e razza] e
 * aggiungerla alla mano, metti le altre in fondo». È la forma di RBF-006.
 */
export interface EnterLook {
  /** Quante carte, se fisso; null se dipende dal dado. */
  count: number | null;
  /** Col dado (RBF-027): le facce, e il conto è `countBase + ceil(tiro/2)`. */
  die: number | null;
  countBase: number;
  reveal: { kind: "entity" | "object"; race: string | null } | null;
  /** «Metti una delle altre nella tua Zona di Ritiro». */
  thenRetire: boolean;
  /** Col dado, «tante carte quanto il tiro» (dal 2026-09-10) invece di «countBase + ceil(tiro/2)». */
  formula?: "result";
}

/**
 * La forma certificata di un ritorno all'ingresso: «quando questa Entità
 * entra sul Fronte, metti sul tuo Fronte una carta permanente dalla tua Zona
 * di Ritiro». È la forma di RBF-012.
 */
export interface EnterReturn {
  from: "ritiro";
  /** «una carta permanente» (§10): quel che resta in campo — un'Entità o
      una Materia permanente, mai il Rubyfront, mai un Oggetto. Stessa
      lettura dell'esilio di RBF-018 (effects.ts, permanentOf). */
  filter: { permanent: true };
  to: "field";
}

/**
 * La forma certificata di uno spostamento all'ingresso: «quando questa
 * Entità entra sul Fronte, metti un'Entità avversaria nella Zona di Ritiro
 * del suo proprietario». È la forma di RBF-007.
 */
export interface EnterMove {
  target: { kind: "entity"; controller: "opponent" };
  to: "ritiro" | "abisso";
  /** L'esilio condizionato: nell'Abisso «finché questa resta in campo», tenuta da chi entra (heldBy). */
  hold?: true;
}

/**
 * La forma certificata di un ascoltatore d'ingresso: «quando un'altra
 * Entità [di razza X] entra sul tuo Fronte, se ne controlli almeno N [di
 * razza Y], pesca K carte». È la forma di RBF-003; tutto ciò che non
 * combacia esattamente non entra, come in anagrafe.
 */
export interface EnterListener {
  enteringRace: string | null;
  requires: { count: number; race: string | null };
  draw: number;
}

export interface Ctx {
  state(): GameState;
  /**
   * Applica in locale e ritrasmette alla stanza. Con l'engine collegato
   * l'azione passa prima dal suo giudizio: la promessa dice se è passata
   * (`false` = fermata dal poliziotto). Quasi nessuno deve aspettarla — solo
   * chi accoda altre azioni che hanno senso soltanto se questa è passata
   * (vedi endTurn in turn.ts).
   */
  dispatch(action: Action): Promise<boolean>;
  /** Il posto occupato da questo browser. */
  seat(): Seat;
  /**
   * Vero se questo client governa quel posto: il proprio, e basta — l'altra
   * metà è di chi c'è in rete o del bot. È il cancello di ogni gesto di
   * gioco — trascinare, pescare, dichiarare, chiudere il turno — mentre
   * `seat()` resta la prospettiva: quale metà sta in basso, quale mano è "la
   * tua". Le due cose non vanno confuse.
   */
  controls(seat: Seat): boolean;
  /**
   * Vero quando l'engine è collegato e giudica: il tavolo smette di offrire
   * i gesti che con l'arbitro presente non sono più liberi (tappare,
   * stappare, coprire a mano — quegli stati discendono dalle dichiarazioni).
   * A engine spento resta la lavagna libera di sempre.
   */
  arbitrated(): boolean;
  /** Il tema grafico è una proprietà del mazzo: ogni posto ha il suo. */
  themeFor(seat: Seat): string;
  /** La tinta del campo di un posto: segue la Materia dominante del suo mazzo
      (renderer.ts deckTint); i temi del tavolo la leggono come data-tint. */
  tintFor(seat: Seat): Tint;
  locale(): string;
  /** L'anagrafe di una carta per chi ragiona senza DOM (turn.ts, combat.ts):
      il nome nella lingua del tavolo e le statistiche stampate del
      combattimento (§6.3) — `null` dove la carta non le ha. */
  card(cardId: string): CardFacts;
  /** Riga di servizio in chat (dadi, mescola, pesca). Il posto di chi agisce
      colora la riga: si deve vedere a colpo d'occhio chi fa cosa. */
  log(text: string | LogMsg, seat?: Seat | null): void;
  /** §6.5 — l'invito a scartare: l'Abisso di `seat` si accende. Torna true
      la prima volta nel turno (quando vale la pena dirlo anche in chat).
      Facoltativo: un Ctx senza tavolo (i test) non ce l'ha. */
  promptDiscard?(seat: Seat): boolean;
}
