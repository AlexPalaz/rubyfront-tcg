// Modello dati della lavagna. Nessuna regola di gioco vive qui: lo stato dice
// soltanto quale carta sta dove, girata come e con quali contatori. Chi gioca
// decide cosa è legale — il simulatore non lo verifica mai.

/** I due posti al tavolo. Non "giocatore 1/2": chi inizia lo si decide a mano. */
export type Seat = "a" | "b";

export const SEATS: readonly Seat[] = ["a", "b"];

export function otherSeat(seat: Seat): Seat {
  return seat === "a" ? "b" : "a";
}

/**
 * Le zone del §5 del manuale, più mano e mazzo. `field` è la lavagna vera e
 * propria: una superficie libera dove Fronte, Zona di Richiamo e tutto il
 * resto sono solo posizioni x/y, non caselle. Le altre zone sono pile
 * ordinate.
 */
export type ZoneId = "field" | "hand" | "deck" | "abisso" | "ritiro";

export const PILE_ZONES: readonly ZoneId[] = ["deck", "abisso", "ritiro"];

/** Una copia fisica di una carta sul tavolo. */
export interface CardInstance {
  uid: string;
  /** Id nel catalogo del sito, es. "RBF-001". */
  cardId: string;
  /** Chi la possiede: decide in quale mano e in quali pile finisce. */
  owner: Seat;
  zone: ZoneId;
  /** Indice della faccia mostrata: il Rubyfront ha faccia 0, il Nexus 1. */
  face: number;
  /** Posizione sulla lavagna, in pixel della superficie. Ignorata fuori da `field`. */
  x: number;
  y: number;
  /** Ordine dentro mazzo, mano e pile. Ignorato su `field`. */
  order: number;
  /** Tappata (§6.3): la carta viene ruotata di 90°. */
  tapped: boolean;
  /** Coperta: si vede il dorso. Il mazzo è sempre coperto a prescindere. */
  facedown: boolean;
  /** Ordine di sovrapposizione sulla lavagna. */
  z: number;
}

export interface PlayerState {
  name: string;
  /** Punti Vita: si impostano e si correggono a mano, senza limiti imposti. */
  hp: number;
  /** Flusso disponibile (§3.2). */
  flux: number;
  /** Flusso massimo del turno: cresce di 1 per turno, tetto 20. */
  fluxMax: number;
  /**
   * Gettone Flusso (§3.2): 1 Flusso extra monouso, fuori dal limite dei 20,
   * di chi non inizia la partita. `true` = ancora da spendere.
   */
  token: boolean;
  /** Id del mazzo caricato, per ricaricarlo a nuova partita. */
  deckId: string | null;
}

export interface ChatEntry {
  id: string;
  seat: Seat | null;
  /** `log` = evento generato dal simulatore (dadi, mescola); `chat` = testo scritto. */
  kind: "chat" | "log";
  text: string;
  ts: number;
}

/**
 * Una dichiarazione di combattimento (§6.3). È solo un'annotazione condivisa:
 * dice chi ha dichiarato cosa e verso chi, e nient'altro. Non tocca i PV, non
 * confronta Potenze, non manda nessuno nell'Abisso — a risolvere sono i
 * giocatori.
 *
 * Vive separata dallo stato di tap apposta: tappare e stappare a mano resta
 * libero in ogni momento, anche in mezzo a un attacco già dichiarato.
 */
export interface Declaration {
  id: string;
  /** Chi dichiara: l'attaccante, o il bloccante. */
  from: string;
  /**
   * Il bersaglio: il Rubyfront avversario per un attacco (§6.3: si attacca
   * sempre quello, mai le altre Entità), l'attaccante per un blocco.
   */
  to: string;
  kind: "attack" | "block" | "counter";
  /** Posto che ha dichiarato. */
  seat: Seat;
  /**
   * Ordine dell'ondata (§6.3 punto 5: le battaglie si risolvono nell'ordine di
   * dichiarazione degli attaccanti). Vale solo per gli attacchi.
   */
  order: number;
}

export interface GameState {
  cards: Record<string, CardInstance>;
  players: Record<Seat, PlayerState>;
  /** Numero di turno mostrato dal contatore. Si alza e si abbassa a mano. */
  turn: number;
  /** Di chi è il turno, secondo il contatore. Nessun effetto sulle azioni. */
  active: Seat;
  chat: ChatEntry[];
  /** Attacchi e blocchi dichiarati nel turno in corso (§6.3). */
  declarations: Declaration[];
  /** Prossimo z libero: ogni carta toccata sale in cima. */
  zTop: number;
}

/** Le mutazioni possibili. Ogni client le applica in locale e le ritrasmette. */
export type Action =
  | { t: "newGame" }
  | { t: "loadDeck"; seat: Seat; deckId: string; cards: CardInstance[] }
  | { t: "shuffle"; seat: Seat; order: string[] }
  | { t: "draw"; seat: Seat; count: number }
  | { t: "move"; uid: string; x: number; y: number; z: number }
  | { t: "toZone"; uid: string; zone: ZoneId; x?: number; y?: number; z?: number; toBottom?: boolean }
  | { t: "flip"; uid: string; face: number }
  | { t: "tap"; uid: string; tapped: boolean }
  | { t: "facedown"; uid: string; facedown: boolean }
  | { t: "player"; seat: Seat; patch: Partial<PlayerState> }
  | { t: "turn"; turn: number; active: Seat }
  | { t: "declare"; declaration: Declaration }
  | { t: "undeclare"; from: string }
  | { t: "clearCombat" }
  | { t: "say"; entry: ChatEntry };

/** Buste che viaggiano sul relay. */
export type NetMessage =
  | { t: "action"; action: Action; from: Seat }
  | { t: "hello"; from: Seat }
  | { t: "state"; state: GameState; from: Seat }
  /** Segnalazione WebRTC della chat vocale (voice.ts): il relay la ripete
      come tutto il resto, il payload lo capisce solo l'altro client. */
  | { t: "rtc"; payload: unknown; from: Seat };
