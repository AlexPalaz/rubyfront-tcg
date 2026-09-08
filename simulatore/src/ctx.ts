// Il contesto che le viste condividono: leggere lo stato, mandare un'azione,
// sapere chi sono. Niente altro — le viste non parlano mai fra loro.
//
// Qui vive anche la geometria della lavagna. Sta in un posto solo perché la
// usano in tre (il tavolo per disegnare le zone, main.ts per posare il
// Rubyfront in Zona di Richiamo, la ricerca per mandare una carta sul Fronte):
// se le misure si sparpagliassero, le zone e le carte finirebbero disallineate.

import type { LogMsg } from "./i18n.js";
import type { Action, GameState, Seat, Phase } from "./types.js";
import { otherSeat } from "./types.js";

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
  | { kind: "self_power"; amount: number; whileAttacking?: true; requiresOther?: { kind: "entity"; race: string | null }; perOther?: { kind: "entity"; race: string | null } }
  | { kind: "bearer_power"; amount: number; per?: { kind: "entity"; race: string | null }; multiBlock?: boolean }
  /** RBF-011: «questa Entità non si tappa mai». */
  | { kind: "never_taps" };

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
  /** RBF-017: un'Entità avversaria con costo N o inferiore nella Zona di Ritiro. */
  | { kind: "move"; target: { kind: "entity"; controller: "opponent"; maxCost: number | null }; to: "ritiro" }
  /** RBF-018: un permanente avversario nell'Abisso, finché questa carta resta in gioco. */
  | { kind: "exile"; target: { permanent: true; controller: "opponent" }; to: "abisso"; hold: true }
  /** RBF-019: il d20 a fasce — PV, un'Entità dalla mano, una pesca, o tutto. */
  | { kind: "fortune"; die: number; gain: { on: [number, number]; amount: number }; deploy: { on: [number, number]; filter: { kind: "entity"; race: string | null; maxCost: number | null } }; draw: { on: [number, number]; count: number }; allOn: [number, number] }
  /** RBF-021: distruggi un'Entità; contro una tappata costa N in meno. */
  | { kind: "destroy"; target: { kind: "entity"; controller: "any" | "opponent" | "controller" }; to: "abisso"; discount: { amount: number; ifTarget: "tapped" } | null }
  /** RBF-040: giocata come bloccante di un'Entità attaccante (l'attacco è bloccato, §6.4); con almeno N Entità armate sul Fronte, +M PV. */
  | { kind: "block"; requiresArmed: number; heal: number; asBlock: true };

/** «Quando flippa» (§3.1, RBF-001): la carta nominata nell'Abisso, e il sigillo. */
export type FlipForm =
  | { kind: "move"; cardId: string; from: "field"; to: "abisso" }
  | { kind: "seal"; cardId: string };

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
  | { kind: "discount"; amount: number; type: "entity" | "object"; race: string | null };

export interface NexusRequirement {
  face: number;
  conditions: { count: number; kind: "entity"; race: string | null }[];
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
  | { kind: "empower"; who: "self" | "object"; targets: "others_armed" | "bearer" | "next_human_attacker" | "opposing_entity"; power?: number; grants?: string[]; restrict?: "block"; once?: true; requiresObject?: true; requiresPreviousAttackers?: { count: number; race: string }; face: number }
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
  /** «Metti una delle altre nella tua Zona di Ritiro» (RBF-027). */
  thenRetire: boolean;
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
  locale(): string;
  /** L'anagrafe di una carta per chi ragiona senza DOM (turn.ts, combat.ts):
      il nome nella lingua del tavolo e le statistiche stampate del
      combattimento (§6.3) — `null` dove la carta non le ha. */
  card(cardId: string): CardFacts;
  /** Riga di servizio in chat (dadi, mescola, pesca). Il posto di chi agisce
      colora la riga: si deve vedere a colpo d'occhio chi fa cosa. */
  log(text: string | LogMsg, seat?: Seat | null): void;
}

export const TILE_W = 302;
const TILE_H = 424;
/** Spazio fra due carte affiancate. */
const GUTTER = 20;
/** Rientro dai bordi della metà. */
const EDGE = 30;
/**
 * Margine sopra e sotto le due file, dentro la fascia. Sono UGUALI di
 * proposito: è quello che rende la fascia simmetrica, e quindi capovolgibile
 * scambiando semplicemente le due file di posto (vedi `toView`).
 */
const ROW_PAD = 44;
/**
 * Distanza fra il Fronte e la fila di servizio. È larga: lì sotto, dietro il
 * Fronte, ci vanno le Materie permanenti (§5), che stanno in campo senza uno
 * slot proprio.
 */
const ROW_GAP = 96;

export const SURFACE_W = 2700;

/**
 * Vista compatta: sul campo le tessere mostrano solo barra del titolo (costo,
 * nome, potenza/PV) e illustrazione — il resto lo taglia l'overflow della
 * tessera, la carta sotto resta intera e intatta. È un VESTITO del client:
 * le coordinate canoniche condivise in rete non cambiano di un pixel; a
 * comprimersi è solo la geometria di vista, con la mappa `compress` qui
 * sotto. Obiettivo dichiarato: col tavolo compatto non si scorre affatto
 * (fitScale in table.ts aggancia anche l'altezza).
 */
let compactView = false;
export function setCompactView(on: boolean): void {
  compactView = on;
}
export function isCompactView(): boolean {
  return compactView;
}

/**
 * Le viste del tavolo. «Piena»: carte intere ovunque, si scorre.
 * «Compatta»: tutto nella finestra, senza scorrere; sul campo e in mano le
 * carte sono TESSERE (illustrazione, nome, costo, Potenza a corpo fisso),
 * il testo di regole si legge nell'ingrandimento al passaggio.
 * «Rincasso»: lo stesso tavolo a due file della piena, carte intere
 * OVUNQUE — Fronte, fila di servizio e mano — e senza scorrere. Ci sta
 * perché la fascia avversaria perde la sua fila di servizio: le sue pile
 * vanno in un pannello sopra la lavagna, e la sua Zona di Richiamo è il
 * riquadro del Rubyfront. Restano tre file di carte intere invece di
 * quattro. Le coordinate canoniche non cambiano di un pixel: cambia solo
 * la mappa di vista.
 */
export type ViewMode = "full" | "compact" | "recess";
let recessView = false;
export function setViewMode(mode: ViewMode): void {
  compactView = mode === "compact";
  recessView = mode === "recess";
}
export function viewMode(): ViewMode {
  return compactView ? "compact" : recessView ? "recess" : "full";
}
export function isRecessView(): boolean {
  return recessView;
}
/** Le viste che comprimono la geometria verticale (mappa `compress`). */
function stretched(): boolean {
  return compactView || recessView;
}
/**
 * Altezza della tessera compatta. Non deriva più dalla carta: è il riquadro
 * dell'illustrazione (302 di larghezza, poco meno di 3:2), con nome e
 * distintivi sovrapposti. Vale sul campo, nelle pile e in mano.
 */
export const COMPACT_TILE_H = 200;
/** Il varco fra le due file si stringe con le carte. */
const COMPACT_ROW_GAP = 48;
/** Il margine sopra e sotto le file, in compatta: più largo del canonico,
    perché lì sotto stanno le etichette a corpo fisso (16px reali, cioè
    fino a ~37px canonici a scala 0.43) con un po' d'aria dal riquadro. */
const COMPACT_ROW_PAD = 72;
/** In compatta la mano non si sovrappone più alla lavagna (il fit la conta,
    vedi fitScale in table.ts): la coda in fondo serve solo da respiro. */
const COMPACT_BOTTOM_PAD = 48;
/** Fra il Fronte e la fila di servizio, in rincasso, ci passa una riga di
    etichette a corpo fisso (16px reali) con la sua aria: meno del varco
    canonico, che lì porta anche le Materie permanenti. */
const RECESS_ROW_GAP = 64;
/** In rincasso la mano avversaria non è più una fascia in cima al tavolo
    (sta nel pannello delle pile, col suo conto): il margine di testa serve
    solo da aria, e quei pixel tornano alle carte. */
const RECESS_TOP_PAD = 40;
/**
 * Lavagna piccola: sotto una certa scala i margini si stringono ancora, e
 * quei pixel vanno alle carte — su una finestra da 1180×820 valgono più di
 * un dito d'aria. Lo accende fitScale (table.ts), che è l'unico a conoscere
 * la scala; qui restano solo le misure.
 */
let tightView = false;
export function setTightView(on: boolean): void {
  tightView = on;
}
export function isTightView(): boolean {
  return tightView;
}
const TIGHT = { ROW_PAD: 44, ROW_GAP: 40, TOP_PAD: 24, BOTTOM_PAD: 24, HALF_GAP: 16 } as const;
/**
 * Rincasso: quando comanda la larghezza, sotto e sopra il tavolo avanza
 * altezza. Invece di centrare il tavolo nel vuoto, quell'altezza (in unità
 * di vista, già divisa per la scala) si distribuisce nei margini — cima e
 * fondo, il varco fra i campi, i varchi fra le file — così le etichette
 * prendono aria e il tavolo riempie la finestra. Lo scrive fitScale
 * (table.ts), che è l'unico a conoscere la finestra; zero nelle altre viste.
 */
let viewSlack = 0;
export function setViewSlack(units: number): void {
  viewSlack = units;
}
/**
 * L'angolo in basso a destra è del gesto di fase (hud.ts, .hud-actions),
 * che sta sopra il tavolo in pixel di schermo: il margine di fondo gli fa
 * posto, così non copre le pile e le loro etichette. In unità di vista
 * (pixel divisi per la scala), lo scrive fitScale; zero fuori dal rincasso.
 */
let cornerReserve = 0;
export function setCornerReserve(units: number): void {
  cornerReserve = units;
}
/**
 * Lo spazio di un'etichetta sotto un riquadro (RUBYFRONT, FRONTE, MATERIE,
 * le pile): a corpo fisso, 16px più l'aria, quindi in unità di vista
 * dipende dalla scala. In rincasso i margini di fila e il varco fra le
 * file non scendono mai sotto questa misura, o l'etichetta finirebbe sul
 * bordo del campo o sulla fila sotto. Lo scrive fitScale (table.ts).
 */
let labelRoom = 0;
/** E lo spazio della testata del campo (targhetta e targa), che sporge
    dentro il campo dall'orlo in alto: la metà della sua altezza più l'aria. */
let headRoom = 0;
/** E il margine in cima al tavolo: la targhetta del campo avversario
    sporge sopra il suo orlo, e sotto l'header ci vuole aria vera. */
let topRoom = 0;
/** E il pannello delle pile avversarie, ripiegato a testata nell'angolo in
    alto del campo avversario (table.ts, .pile-dock): il suo stacco dall'orlo,
    la sua altezza e l'aria sotto, perché non cada sui riquadri del Fronte. */
let dockRoom = 0;
export function setLabelRoom(labels: number, head: number, top = head, dock = head): void {
  labelRoom = labels;
  headRoom = head;
  topRoom = top;
  dockRoom = dock;
}
/** Le quote della distribuzione: cima e fondo, varco fra i campi, varco fra
    le file (una sola, nel campo tuo), i quattro margini di fila. */
const SLACK = { TOP: 0.12, BOTTOM: 0.1, HALF_GAP: 0.3, ROW_GAP: 0.2, ROW_PAD: 0.07 } as const;
function topPadView(): number {
  if (recessView) return Math.max(tightView ? TIGHT.TOP_PAD : RECESS_TOP_PAD, topRoom) + viewSlack * SLACK.TOP;
  return TOP_PAD;
}
function halfGapView(): number {
  const base = stretched() && tightView ? TIGHT.HALF_GAP : HALF_GAP;
  // La testata del campo tuo sporge SOPRA il suo orlo, nel varco: il varco
  // non scende mai sotto il suo spazio, o finirebbe sull'orlo del campo
  // avversario (a 1180×820 il varco stretto è 7px, la testata ne sporge 15).
  return recessView ? Math.max(base, headRoom) + viewSlack * SLACK.HALF_GAP : base;
}

/** Altezza di VISTA di una tessera: in rincasso è la carta intera come
    nella vista piena, sul Fronte, nella fila di servizio e in mano. */
export function tileViewH(): number {
  return compactView ? COMPACT_TILE_H : TILE_H;
}
/** La carta sta in Zona di Richiamo (coordinate canoniche)? In rincasso
    quel posto non ha un riquadro suo: è il riquadro del Rubyfront
    nell'altro stato, e la carta ci si disegna lì. */
export function atRecall(x: number, y: number): boolean {
  const center = y + HALF_TILE;
  const band = bandOfCenter(center);
  if (!band || rowOfLocal(center - BAND_TOP[band]) !== "back") return false;
  return Math.abs(x - SLOT_X.richiamo) < 160;
}
function rowGapView(): number {
  if (compactView) return COMPACT_ROW_GAP;
  if (!recessView) return ROW_GAP;
  return Math.max(tightView ? TIGHT.ROW_GAP : RECESS_ROW_GAP, labelRoom) + viewSlack * SLACK.ROW_GAP;
}
/** Il margine in testa a una fascia: fa posto alla testata, che sporge —
    e, nella fascia avversaria in rincasso, al pannello delle pile ripiegato. */
function rowPadTopView(foe = false): number {
  if (!stretched()) return ROW_PAD;
  const base = tightView ? TIGHT.ROW_PAD : COMPACT_ROW_PAD;
  const room = foe ? Math.max(headRoom, dockRoom) : headRoom;
  return recessView ? Math.max(base, room) + viewSlack * SLACK.ROW_PAD : base;
}
/** Il margine in fondo a una fascia: fa posto alle etichette sotto i riquadri. */
function rowPadBottomView(): number {
  if (!stretched()) return ROW_PAD;
  const base = tightView ? TIGHT.ROW_PAD : COMPACT_ROW_PAD;
  return recessView ? Math.max(base, labelRoom) + viewSlack * SLACK.ROW_PAD : base;
}
function bottomPadView(): number {
  if (!stretched()) return BOTTOM_PAD;
  const base = tightView ? TIGHT.BOTTOM_PAD : COMPACT_BOTTOM_PAD;
  return recessView ? base + cornerReserve + viewSlack * SLACK.BOTTOM : base;
}
/**
 * Altezza di VISTA di una fascia. In rincasso la fascia AVVERSARIA (quella
 * in alto) non ha la fila di servizio: le sue pile stanno in un pannello
 * ripiegabile sopra il suo campo (`.pile-dock`, table.ts), e la Zona di
 * Richiamo è il riquadro del Rubyfront. Resta solo il Fronte.
 */
/**
 * Rincasso: la fila di servizio avversaria si riapre quando serve — quando
 * l'avversario controlla un'Entità (§8.2), che sta nel suo riquadro del
 * controllo, in quella fila, o quando si aprono le sue pile dalla testata
 * (table.ts): Abisso, Ritiro, Mazzo e la mano scendono sulla lavagna ai
 * loro posti. Chiusa, il riquadro del controllo cadrebbe sul Fronte, sopra
 * il terzo slot. Lo accende table.ts; costa scala finché resta aperta.
 */
let foeBackRow = false;
export function setFoeBackRow(on: boolean): void {
  foeBackRow = on;
}
export function hasFoeBackRow(): boolean {
  return foeBackRow;
}
export function bandViewH(foe = false): number {
  if (recessView && foe && !foeBackRow) return rowPadTopView(true) + tileViewH() + rowPadBottomView();
  return rowPadTopView(foe) + tileViewH() + rowGapView() + tileViewH() + rowPadBottomView();
}
/** Altezza di VISTA dell'intera superficie. */
export function surfaceViewH(): number {
  return topPadView() + bandViewH(true) + bandViewH(false) + halfGapView() + bottomPadView();
}

/**
 * La mappa di compressione: canonico→compatto, piecewise lineare e monotona
 * sui punti fermi del layout (pad, file, varchi). Fuori dalla modalità
 * compatta è l'identità. `decompress` è l'inversa esatta.
 */
function anchors(): [number[], number[]] {
  const canon: number[] = [0];
  const view: number[] = [0];
  const seg = (dc: number, dv: number): void => {
    canon.push(canon[canon.length - 1] + dc);
    view.push(view[view.length - 1] + dv);
  };
  seg(TOP_PAD, topPadView());
  for (let band = 0; band < 2; band += 1) {
    // In metrica di vista la fascia in alto è sempre l'avversaria,
    // capovolta: prima la fila di servizio, poi il Fronte. La propria, in
    // basso, il contrario. Conta solo in rincasso, dove le due file hanno
    // altezze diverse.
    // In rincasso la fila di servizio avversaria si azzera: le sue carte
    // cadono sull'orlo del Fronte (le pile stanno nel pannello, che non
    // passa di qui).
    const foeBack = band === 0 && recessView && !foeBackRow;
    const rows = band === 0 ? [foeBack ? 0 : tileViewH(), tileViewH()] : [tileViewH(), tileViewH()];
    seg(ROW_PAD, rowPadTopView(band === 0));
    seg(TILE_H, rows[0]);
    seg(ROW_GAP, foeBack ? 0 : rowGapView());
    seg(TILE_H, rows[1]);
    seg(ROW_PAD, rowPadBottomView());
    if (band === 0) seg(HALF_GAP, halfGapView());
  }
  seg(BOTTOM_PAD, bottomPadView());
  return [canon, view];
}

function remap(y: number, from: number[], to: number[]): number {
  if (y <= from[0]) return to[0] + (y - from[0]);
  for (let i = 1; i < from.length; i += 1) {
    if (y <= from[i]) {
      const span = from[i] - from[i - 1];
      const ratio = span === 0 ? 0 : (y - from[i - 1]) / span;
      return to[i - 1] + ratio * (to[i] - to[i - 1]);
    }
  }
  return to[to.length - 1] + (y - from[from.length - 1]);
}

function compress(y: number): number {
  if (!stretched()) return y;
  const [canon, view] = anchors();
  return Math.round(remap(y, canon, view));
}
function decompress(y: number): number {
  if (!stretched()) return y;
  const [canon, view] = anchors();
  return Math.round(remap(y, view, canon));
}

/**
 * Ogni metà è alta due file di carte: il campo di un giocatore da solo occupa
 * quanto prima occupavano i due messi insieme. Sullo schermo non ci sta tutto,
 * e va bene così — si scorre.
 */
export const HALF_H = ROW_PAD + TILE_H + ROW_GAP + TILE_H + ROW_PAD;
/** Margine in cima: sotto ci passa la fascia dei dorsi avversari. */
export const TOP_PAD = 128;
/**
 * Margine in fondo: la mano è un pannello sovrapposto al tavolo, e serve un
 * po' di coda perché la riga di servizio possa salire sopra di essa
 * scorrendo. Era 500 quando la mano stava sempre aperta a misura piena; ora
 * che si ripiega con un gesto (ed è in scala sugli schermi piccoli) basta
 * molto meno — e meno coda vuol dire meno scorrimento.
 */
const BOTTOM_PAD = 240;
const HALF_GAP = 32;
export const SURFACE_H = TOP_PAD + HALF_H * 2 + HALF_GAP + BOTTOM_PAD;

/**
 * I cinque slot del Fronte (§5). Sono cinque perché cinque è il limite di
 * Entità sul Fronte — ma restano posti segnati, non caselle chiuse: nessuno
 * impedisce di appoggiare la sesta carta dove si vuole.
 *
 * Non stanno più a ridosso l'uno dell'altro: si spartiscono tutta la campata
 * fra la colonna del Rubyfront e quella delle Materie, col respiro che ne
 * discende. Lo spazio c'è, tanto vale usarlo — e le misure restano CANONICHE,
 * uguali sui due schermi: è la sola spaziatura che non fa divergere le
 * lavagne (una spaziatura per-finestra sposterebbe gli slot di qua ma non le
 * coordinate condivise di là).
 */
export const FRONT_SLOTS = 5;
/** Aria fra il Fronte e le due colonne fisse che lo affiancano. */
const FRONT_CLEAR = 110;
export const FRONT_X = EDGE + TILE_W + FRONT_CLEAR;
export const FRONT_W = SURFACE_W - EDGE - TILE_W - FRONT_CLEAR - FRONT_X;
/** Passo fra le colonne: quel che avanza, diviso nei quattro varchi. */
const FRONT_STEP = (FRONT_W - TILE_W) / (FRONT_SLOTS - 1);
export const FRONT_SLOT_X: readonly number[] = Array.from(
  { length: FRONT_SLOTS },
  (_, index) => Math.round(FRONT_X + index * FRONT_STEP)
);

/**
 * Il posto del Rubyfront schierato, all'estremità sinistra della fila del
 * Fronte. Sta fuori dai cinque slot perché il Rubyfront non ne occupa uno
 * (§5): sta davanti al Fronte, per conto suo.
 */
export const RUBYFRONT_X = EDGE;

/**
 * Lo slot extra del controllo (§8.2, «Prendere il controllo»): al centro
 * della fila di servizio, perché nel Fronte non c'è spazio per un sesto
 * posto. Un'Entità avversaria controllata sta qui, e non conta nei 5.
 */
export const CONTROL_X = FRONT_SLOT_X[2];

/**
 * Il posto delle Materie in gioco, all'altra estremità. Le permanenti si
 * dispongono una dietro l'altra nell'ordine in cui sono scese in campo, e la
 * fila tiene traccia della loro età (§5) — cosa che serve per l'ordine di
 * risoluzione (§8.2). L'impilamento a scaletta di `stackAt` disegna
 * esattamente quella fila: la prima scesa sta in fondo alla pila.
 */
export const MATTER_X = SURFACE_W - EDGE - TILE_W;

/**
 * Ascissa dei posti fissi nella fila di servizio: la Zona di Richiamo a
 * sinistra, le tre pile allineate a destra.
 */
const RIGHT_EDGE = SURFACE_W - EDGE;
export const SLOT_X = {
  richiamo: EDGE,
  abisso: RIGHT_EDGE - TILE_W * 3 - GUTTER * 2,
  ritiro: RIGHT_EDGE - TILE_W * 2 - GUTTER,
  deck: RIGHT_EDGE - TILE_W,
} as const;

/**
 * Ordinata della fascia di un posto, in coordinate CANONICHE.
 *
 * Le posizioni delle carte sono condivise: viaggiano sulla rete e devono voler
 * dire la stessa cosa sui due schermi. Perciò esiste un solo sistema di
 * riferimento — quello canonico, dove il posto A sta in basso e il B in alto —
 * ed è l'unico che finisce nello stato e nei messaggi.
 *
 * Che poi ciascuno voglia vedersi in basso è un fatto di VISTA, non di dati:
 * ci pensa `toView` al momento di disegnare. Non confondere le due cose: se un
 * y canonico finisse in un'azione già convertito, le due lavagne divergerebbero.
 */
export function halfTop(seat: Seat): number {
  return TOP_PAD + (seat === "a" ? HALF_H + HALF_GAP : 0);
}

/** Riga del Fronte: in cima alla propria metà, verso l'avversario. */
export function frontRowY(seat: Seat): number {
  return halfTop(seat) + ROW_PAD;
}

/** Riga di servizio: Zona di Richiamo, Abisso, Ritiro, Mazzo. */
export function backRowY(seat: Seat): number {
  return frontRowY(seat) + TILE_H + ROW_GAP;
}

/** Di quanto dista una fascia dall'altra: lo scambio è esattamente questo. */
const SWAP_Y = HALF_H + HALF_GAP;

/** Ordinata canonica di ciascuna fascia. */
const BAND_TOP: Record<Seat, number> = { b: TOP_PAD, a: TOP_PAD + SWAP_Y };

/**
 * Le due trasformate ragionano sul CENTRO della carta, non sul suo angolo.
 * Col centro il capovolgimento è una riflessione pulita dentro la fascia e
 * andata e ritorno tornano sempre; col bordo, una carta che sporge appena dal
 * fondo della fascia si ribaltava fuori e non rientrava più.
 */
const HALF_TILE = TILE_H / 2;

/** In quale fascia cade un centro (null: fuori da entrambe). */
function bandOfCenter(center: number): Seat | null {
  if (center >= BAND_TOP.b && center < BAND_TOP.b + HALF_H) return "b";
  if (center >= BAND_TOP.a && center < BAND_TOP.a + HALF_H) return "a";
  return null;
}

/**
 * Dove sta la fascia di `seat` in metrica CANONICA di vista (fasce scambiate,
 * misure piene): è il sistema in cui lavorano toView/fromView. La compressione
 * della vista compatta arriva DOPO, una volta sola.
 */
function canonBandTop(seat: Seat, viewer: Seat): number {
  return seat === viewer ? TOP_PAD + SWAP_Y : TOP_PAD;
}

/** Dove sta la fascia di `seat` sullo schermo di `viewer`: la propria in basso. */
export function viewBandTop(seat: Seat, viewer: Seat): number {
  return compress(canonBandTop(seat, viewer));
}

/**
 * Ordinata (in vista) della linea di battaglia: la cima del Fronte avversario,
 * che capovolto guarda il tuo dall'altra parte del varco. È l'inquadratura di
 * partenza: i due Fronti insieme, il proprio campo senza scorrere.
 */
export function viewBattleTop(viewer: Seat): number {
  return compress(canonBandTop(otherSeat(viewer), viewer) + HALF_H - ROW_PAD - TILE_H);
}

/**
 * Riflessione dentro la fascia: la fila del Fronte va al posto della fila di
 * servizio e viceversa. È uno scambio esatto perché la fascia è simmetrica
 * (stesso `ROW_PAD` sopra e sotto). È l'inversa di sé stessa.
 */
function flipInBand(localCenter: number): number {
  return HALF_H - localCenter;
}

/**
 * Da coordinata condivisa a coordinata di schermo.
 *
 * Due cose insieme, e sono due cose diverse:
 *  1. la TUA fascia scende sempre in basso, l'avversaria sale in alto;
 *  2. la fascia AVVERSARIA si capovolge, così il suo Fronte guarda il tuo
 *     attraverso il centro del tavolo, e mazzo, Abisso, Ritiro, Zona di
 *     Richiamo e Rubyfront gli restano dietro le spalle.
 *
 * La tua fascia non si capovolge mai: il tuo Fronte ti sta davanti e la fila di
 * servizio dietro, come deve.
 */
export function toView(y: number, viewer: Seat): number {
  const center = y + HALF_TILE;
  const band = bandOfCenter(center);
  if (!band) return compress(y);
  const local = center - BAND_TOP[band];
  const moved = canonBandTop(band, viewer) + (band === viewer ? local : flipInBand(local));
  return compress(moved - HALF_TILE);
}

/**
 * Da coordinata di schermo a coordinata condivisa: serve quando una carta
 * viene posata a mano libera, perché il punto in cui è stata lasciata va
 * riportato nel sistema comune prima di finire nello stato.
 */
export function fromView(y: number, viewer: Seat): number {
  const canonical = decompress(y);
  const center = canonical + HALF_TILE;
  let band: Seat;
  if (center >= TOP_PAD && center < TOP_PAD + HALF_H) band = otherSeat(viewer);
  else if (center >= TOP_PAD + SWAP_Y && center < TOP_PAD + SWAP_Y + HALF_H) band = viewer;
  else return canonical;
  const local = center - canonBandTop(band, viewer);
  const moved = BAND_TOP[band] + (band === viewer ? local : flipInBand(local));
  return moved - HALF_TILE;
}

/** Il posto di una carta sullo schermo. */
export interface ViewSpot {
  x: number;
  y: number;
}

/** In quale fila della fascia cade una carta: Fronte o fila di servizio. */
function rowOfLocal(local: number): "front" | "back" {
  return local < ROW_PAD + TILE_H + ROW_GAP / 2 ? "front" : "back";
}

/**
 * Da coordinata condivisa a posto sullo schermo, per questo giocatore, in
 * due dimensioni. La x non cambia mai e la y passa da `toView`; l'unica
 * eccezione è il rincasso, dove la Zona di Richiamo non ha un riquadro suo
 * e il Rubyfront in attesa si disegna in quello del Rubyfront, sulla fila
 * del Fronte.
 */
export function viewOf(x: number, y: number, viewer: Seat): ViewSpot {
  if (recessView && atRecall(x, y)) {
    // Le coordinate restano quelle della Zona di Richiamo: è solo dove lo
    // si vede — il riquadro dice lo stato, col tasto Schiera.
    const band = bandOfCenter(y + HALF_TILE)!;
    return { x: RUBYFRONT_X + Math.round(x - SLOT_X.richiamo), y: toView(frontRowY(band) + (y - backRowY(band)), viewer) };
  }
  return { x, y: toView(y, viewer) };
}

/** Da posto sullo schermo a coordinata condivisa: il rilascio a mano libera. */
export function fromViewPoint(vx: number, vy: number, viewer: Seat): { x: number; y: number } {
  return { x: vx, y: fromView(vy, viewer) };
}

/** Larghezza di VISTA della superficie. */
export function surfaceViewW(): number {
  return SURFACE_W;
}
