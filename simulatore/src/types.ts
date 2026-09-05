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
  /** Il turno in cui è stata coperta (§6.3): la scoperta a fine giro, al
      proprio turno dopo il successivo (T+3), parte da qui. Assente se
      scoperta, o coperta da una lavagna che non lo sapeva. */
  coveredTurn?: number;
  /** Ordine di sovrapposizione sulla lavagna. */
  z: number;
  /**
   * Solo per gli Oggetti (§3.1): l'uid dell'Entità a cui l'Oggetto è
   * assegnato. L'assegnazione è un fatto di gioco, non di pixel: la genera
   * il drop sopra un'Entità (azione `assign`) e si scioglie quando una delle
   * due carte lascia il campo. Assente = Oggetto non assegnato.
   */
  assignedTo?: string;
  /**
   * Chi la controlla, se non il proprietario (§8.2, «Prendere il
   * controllo»): fino alla fine del turno. Assente = il proprietario.
   */
  controller?: Seat;
  /** Parole chiave concesse fino alla fine del turno (es. Slancio). */
  grants?: string[];
  /** Potenza in più fino alla fine del turno (§8.2, effetti d'attacco). */
  powerBonus?: number;
  /** «Non può bloccare in questo turno» (§8.2, RBF-005). */
  cannotBlock?: boolean;
  /** Contrattacco in più fino alla fine del turno (§8.2, RBF-020). */
  counterBonus?: number;
  /** In Stasi (§8.1): tappata per sempre, finché un effetto non la stappa. */
  stasis?: boolean;
  /** Tenuta nell'Abisso da quella carta (§8.2, RBF-018): «finché questa
      carta resta in gioco»; quando la carta lascia il gioco, torna. */
  heldBy?: string;
  /** Solo per le Materie: il bersaglio dichiarato giocandole (RBF-021), che
      decide lo sconto e che l'effetto deve colpire. */
  target?: string;
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
  /** Le carte (id di catalogo) che questo posto non può più giocare per il
      resto della partita (§8.2, RBF-001: il flip sigilla Rhen). */
  sealed?: string[];
}

/** I parametri di una riga di log: numeri, testi, posti (`seat`, `otherSeat`),
    id di carte (`*Card`), o altre chiavi annidate. */
export type LogParams = Record<string, LogParam>;
export type LogParam = string | number | LogMsg | LogMsg[];

/** Una riga di chat come chiave e parametri, resa nella lingua di chi legge. */
export interface LogMsg {
  key: string;
  params?: LogParams;
}

export interface ChatEntry {
  id: string;
  seat: Seat | null;
  /** `log` = evento generato dal simulatore (dadi, mescola); `chat` = testo scritto. */
  kind: "chat" | "log";
  /** Il testo così com'è stato scritto (chat), o la resa nella lingua di
      chi ha compiuto il gesto (log): il ripiego per chi non ha la chiave. */
  text: string;
  /** Un evento del tavolo viaggia come chiave e parametri (i18n.ts): ogni
      giocatore lo legge nella propria lingua. */
  key?: string;
  params?: LogParams;
  ts: number;
}

/**
 * Una dichiarazione di combattimento (§6.3). È solo un'annotazione condivisa:
 * dice chi ha dichiarato cosa e verso chi, e nient'altro. Non tocca i PV, non
 * confronta Potenze, non manda nessuno nell'Abisso — a risolvere è l'azione
 * `resolve` (con l'arbitro al tavolo, dal «Fine fase» della Reazione), o i
 * giocatori a mano.
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

/**
 * L'esito di una battaglia (§6.3), come lo porta l'azione `resolve`. Lo
 * calcola il client di chi è di turno (combat.ts, resolveWave) dalle
 * statistiche stampate del catalogo, e l'engine lo VERIFICA contro il suo
 * calcolo: un esito che non torna con le Potenze in campo non passa. Il
 * riduttore lo applica così com'è — è un'annotazione dell'esito, non il
 * calcolo, e i due client devono contare allo stesso modo.
 */
export interface Battle {
  attacker: string;
  /** Il bloccante (o contrattaccante); assente = attacco non bloccato. */
  blocker?: string;
  kind: "unblocked" | "block" | "counter";
  attackerDies: boolean;
  blockerDies: boolean;
  /** Danno al Rubyfront del difensore: la Potenza dell'attaccante se non
      bloccato, altrimenti zero (§6.3). */
  damage: number;
  /** Il bloccante avrebbe dovuto morire ma ha Stasi (§8.1): resta in campo,
      tappato per sempre. */
  blockerStasis?: boolean;
  /** Il bloccante è una Reattiva giocata come blocco (§6.4): si consuma. */
  blockerSpent?: boolean;
}

/**
 * Le fasi del turno (§6), nel modello MINIMO: la Pesca non è una fase (è il
 * gesto libero d'apertura) e le finestre delle Reattive stanno dentro le
 * fasi (chi è di turno nel Fronte prima dell'ondata, il difensore in
 * Reazione, §7.2). A senso unico: dalla Preparazione
 * si dichiara il Fronte, dal Fronte — a ondata completa — la parola passa
 * al difensore («reazione», §6.4), e in Preparazione si torna solo col
 * cambio di turno.
 */
export type Phase = "preparazione" | "fronte" | "reazione";

/** Com'è finita (§2, §9): chi ha vinto — null nel pareggio — e perché. */
export interface GameOver {
  winner: Seat | null;
  reason: "hp" | "deck" | "draw";
}

export interface GameState {
  /** Partita finita (§2, §9): da qui il tavolo si ferma, fino a Nuova partita. */
  over?: GameOver;
  cards: Record<string, CardInstance>;
  players: Record<Seat, PlayerState>;
  /** Numero di turno mostrato dal contatore. Si alza e si abbassa a mano. */
  turn: number;
  /** Di chi è il turno, secondo il contatore. Nessun effetto sulle azioni. */
  active: Seat;
  /** Fase del turno in corso (§6): appartiene al posto attivo. */
  phase: Phase;
  chat: ChatEntry[];
  /** Attacchi e blocchi dichiarati nel turno in corso (§6.3). */
  declarations: Declaration[];
  /** L'ultima ondata di ciascun posto (uid degli attaccanti, in ordine),
      annotata alla risoluzione: serve a «nel tuo turno precedente» (RBF-005). */
  lastWave?: Partial<Record<Seat, string[]>>;
  /** Gli inneschi d'attacco già risolti in questo turno, con la chiave
      dell'engine (`fonte|on_attack:passo|ingresso o turn`): il tavolo non
      ripropone ciò che l'arbitro fermerebbe. Il cambio di turno azzera. */
  fired?: string[];
  /** La catena di risposta (§7.2), se ce n'è una aperta: vedi ResponseChain. */
  chain?: ResponseChain;
  /** Prossimo z libero: ogni carta toccata sale in cima. */
  zTop: number;
}

/**
 * La catena di risposta (§7.2): «ogni volta che un giocatore lancia una
 * Reattiva, l'avversario può sempre rispondere» — solo con Reattive, ad
 * alternanza stretta — e «quando il giocatore a cui tocca rispondere passa,
 * la catena si risolve in ordine inverso». `stack` sono le Reattive giocate
 * nell'ordine in cui sono scese; `turn` chi deve rispondere o accettare
 * adesso; `resolving` dice che qualcuno ha accettato e le carte si stanno
 * risolvendo, dall'ultima alla prima — ognuna esce dalla pila quando lascia
 * il campo. La catena è atomica: finché c'è, non si fa altro.
 */
export interface ResponseChain {
  stack: string[];
  turn: Seat;
  resolving: boolean;
}

/**
 * Il riferimento di un effetto (§8.2, regola d'oro §1.1): quale carta si
 * innesca, per quale evento, e — per «quando un'Entità entra» — quale
 * ingresso l'ha innescata. Viaggia dentro l'azione che l'effetto compie,
 * e l'engine lo verifica contro la forma certificata in anagrafe.
 */
export interface EffectRef {
  source: string;
  /** L'evento che innesca: l'ingresso in campo, l'attacco dichiarato, la
      risoluzione di una Materia (§7.2), o il flip verso il Nexus (§3.1). */
  event: "on_enter_field" | "on_attack" | "on_resolve" | "on_flip";
  entering: string;
  /** Il seguito di un innesco, con la sua tripla: lo scarto dopo la pesca
      (RBF-026), il ritorno in mano dopo la cura (RBF-008), la pesca dopo la
      cura (RBF-001 Nexus), l'attacco di chi torna (RBF-010), lo sguardo dopo
      il potenziamento (RBF-034). */
  follow?: "discard" | "recall" | "draw" | "join" | "look";
  /** «Una volta per turno»: la tripla vale per ogni attacco del turno. */
  once?: true;
}

/** Le mutazioni possibili. Ogni client le applica in locale e le ritrasmette. */
export type Action =
  /** Tavolo azzerato. `active` dice chi inizia (§4): lo sceglie chi preme,
      il riduttore non tira dadi — due lavagne devono restare uguali. */
  | { t: "newGame"; active?: Seat }
  | { t: "loadDeck"; seat: Seat; deckId: string; cards: CardInstance[] }
  | { t: "shuffle"; seat: Seat; order: string[] }
  /** `effect`: la pesca è un passo di un effetto innescato (§8.2), non un
      gesto — la fonte e l'ingresso che l'ha innescata; l'engine verifica. */
  | { t: "draw"; seat: Seat; count: number; effect?: EffectRef; roll?: number }
  /** `cost`/`roll`: lo schieramento del Rubyfront (§3.1) è un `move` dalla
      Zona di Richiamo alla sua fila, e si paga — col dado, `roll` è il tiro
      e `cost` il risultato. Senza costo è un movimento e basta. */
  | { t: "move"; uid: string; x: number; y: number; z: number; cost?: number; roll?: number }
  /** `cost`: il Flusso pagato giocando DALLA MANO in campo (§3.2) — lo
      mette il client dal catalogo, l'engine lo verifica, il riduttore lo
      scala. Assente da altre zone e per il Rubyfront. */
  | { t: "toZone"; uid: string; zone: ZoneId; x?: number; y?: number; z?: number; toBottom?: boolean; cost?: number; effect?: EffectRef; assignTo?: string; roll?: number; heldBy?: string; target?: string; chain?: true }
  /** §7.2 — chi deve rispondere accetta: la catena si risolve. */
  | { t: "pass"; seat: Seat }
  /** §7.2 — la Reattiva in cima è risolta: esce dalla pila (anche se resta in campo a bloccare, §6.4). */
  | { t: "settle"; uid: string }
  /** Il flip (§3.1): verso il Nexus porta lo scarto del requisito
      (`discard`, nell'Abisso) e il recupero di PV stampato (`recover`). */
  | { t: "flip"; uid: string; face: number; discard?: string; recover?: number }
  /** Assegna l'Oggetto `uid` all'Entità `to` (§3.1); `to: null` lo scioglie. */
  | { t: "assign"; uid: string; to: string | null }
  | { t: "tap"; uid: string; tapped: boolean }
  | { t: "facedown"; uid: string; facedown: boolean }
  | { t: "player"; seat: Seat; patch: Partial<PlayerState>; effect?: EffectRef; roll?: number }
  | { t: "turn"; turn: number; active: Seat }
  /** Dichiara la fase (§6.3): oggi il solo passo avanti verso «fronte». */
  | { t: "phase"; phase: Phase }
  | { t: "declare"; declaration: Declaration; effect?: EffectRef }
  | { t: "undeclare"; from: string }
  | { t: "clearCombat" }
  /** Risolve l'ondata (§6.4): i morti nell'Abisso, i danni al Rubyfront
      del difensore, il combattimento sgomberato. `seat` è chi è di turno. */
  | { t: "resolve"; seat: Seat; battles: Battle[]; untap?: string[] }
  /** Un potenziamento fino alla fine del turno (§8.2): Potenza in più,
      parole chiave concesse, o il divieto di bloccare. Sempre un passo d'effetto. */
  | { t: "empower"; uid: string; power?: number; grants?: string[]; restrict?: "block"; counter?: number; untap?: true; effect: EffectRef }
  /** «Quando entra in campo, un d20: con 15–20 stappa tutte le Entità che
      controlli» (§8.2, RBF-011): col tiro giusto (`untap`) stappa tutte le
      Entità di `seat`, col tiro mancato non fa nulla e consuma l'innesco.
      Il client tira, l'engine verifica. */
  | { t: "refresh"; seat: Seat; roll: number; untap: boolean; effect: EffectRef }
  /** Lo sguardo nel mazzo (§8.2, le forme di RBF-006 e RBF-027): le prime
      `count` carte del mazzo di `seat` — col dado, `roll` è il tiro e il
      conto ne discende; `reveal`, se c'è, va in mano; `retire`, se c'è, in
      Zona di Ritiro; le altre in fondo, nell'ordine in cui stavano. Sempre
      un passo d'effetto. */
  | { t: "look"; seat: Seat; count: number; reveal?: string; retire?: string; roll?: number; revealTo?: "hand" | "ritiro"; restTo?: "deck" | "ritiro"; effect: EffectRef }
  /** Prende il controllo di `uid` per `by` fino a fine turno (§8.2): la
      carta passa nello slot extra, con gli Oggetti addosso e le parole
      chiave concesse. Sempre un passo d'effetto. */
  | { t: "control"; uid: string; by: Seat; grants: string[]; effect: EffectRef }
  /** Restituisce una carta controllata al proprietario, a fine turno: sul
      suo Fronte (x, y di uno slot libero) o nella sua Zona di Ritiro se è
      pieno. La manda il tavolo di chi ha chiuso il turno. Vale anche per il
      permanente esiliato (RBF-018) quando chi lo teneva lascia il gioco. */
  | { t: "release"; uid: string; zone: "field" | "ritiro"; x?: number; y?: number }
  /** Fine della partita (§2, §9): lo dichiara il client che l'ha vista
      arrivare, l'engine lo verifica contro PV e mazzi della sua copia. */
  | { t: "gameOver"; winner: Seat | null; reason: GameOver["reason"] }
  | { t: "say"; entry: ChatEntry }
  /** STRUMENTO DI PROVA, temporaneo: evoca in mano una carta qualunque del
      catalogo, per provare le regole in fretta. Non è un gesto di gioco. */
  | { t: "spawn"; card: CardInstance };

/** Buste che viaggiano sul relay. */
export type NetMessage =
  | { t: "action"; action: Action; from: Seat }
  | { t: "hello"; from: Seat }
  | { t: "state"; state: GameState; from: Seat }
  /** Segnalazione WebRTC della chat vocale (voice.ts): il relay la ripete
      come tutto il resto, il payload lo capisce solo l'altro client. */
  | { t: "rtc"; payload: unknown; from: Seat };
