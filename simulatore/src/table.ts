// Il tavolo: la lavagna, le pile, le due mani.
//
// Il disegno è "riconciliato", non ricostruito: ogni carta ha un solo elemento
// DOM, che viene spostato da una zona all'altra. Ricrearlo a ogni cambio di
// stato significherebbe rilanciare il renderer e `fitTextBoxes` su decine di
// carte a ogni mossa — e vedere la mano sfarfallare a ogni tiro di dado.

import { createArrowLayer, drawArrows, type Arrow } from "./arrows.js";
import { createCardEl, fitPending, syncCardEl, wirePreview } from "./cardview.js";
import { declareAttack as declareAttackVia, declareBlock, undeclare } from "./combat.js";
import { tapPreview } from "./preview.js";
import {
  FRONT_SLOT_X,
  FRONT_W,
  FRONT_X,
  MATTER_X,
  RUBYFRONT_X,
  SLOT_X,
  SURFACE_H,
  SURFACE_W,
  backRowY,
  frontRowY,
  bandViewH,
  fromView,
  isCompactView,
  surfaceViewH,
  tileViewH,
  toView,
  viewBandTop,
  type Ctx,
} from "./ctx.js";
import { enableDrag, enableLongPress, type Drop } from "./drag.js";
import { openMenu, type MenuItem } from "./menu.js";
import { TILE_H, TILE_W, cardName, cardStats, faceCount, faceKind, isRubyfront } from "./renderer.js";
import {
  STACK_STEP,
  declarationOf,
  fieldCards,
  matterSpot,
  playSpot,
  seatLabel,
  seatWaiting,
  shuffled,
  stackAt,
  zoneCards,
} from "./state.js";
import type { CardInstance, GameState, Seat, ZoneId } from "./types.js";
import { SEATS, otherSeat } from "./types.js";

// Le tre pile stanno in fila a destra, nella riga di servizio. Il Mazzo è
// coperto per definizione (§5); Abisso e Zona di Ritiro sono pubblici e
// mostrano la carta in cima.
const PILES: { zone: ZoneId; label: string; x: number; hidden: boolean }[] = [
  { zone: "abisso", label: "Abisso", x: SLOT_X.abisso, hidden: false },
  { zone: "ritiro", label: "Ritiro", x: SLOT_X.ritiro, hidden: false },
  { zone: "deck", label: "Mazzo", x: SLOT_X.deck, hidden: true },
];

/** Tempi della pesca animata (`card-drawn` in style.css): corsa di una carta
    e passo della cascata. Stanno qui, esportati, perché chi accoda una pesca
    all'altra (main.ts: la carta del turno 1 dopo la mano iniziale) deve
    sapere quando la prima ha finito di muoversi. */
export const DRAW_RUN_MS = 380;
export const DRAW_STEP_MS = 70;
/** Quanto dura, in tutto, l'entrata in cascata di `count` carte. Zero con
    prefers-reduced-motion: lì l'animazione è spenta e non c'è da aspettare. */
export function drawCascadeMs(count: number): number {
  if (count <= 0) return 0;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
  return (count - 1) * DRAW_STEP_MS + DRAW_RUN_MS;
}

/** La mano rispetto al campo: in vista normale le carte in mano stanno un
    30% sopra la scala del campo (sono quelle da leggere e da giocare), in
    compatta alla scala del campo — il cassetto deve starci sotto il tavolo.
    Specchio di --hand-boost in style.css. */
const HAND_BOOST = 1.3;
const HAND_BOOST_COMPACT = 1;
/** La cornice del cassetto oltre la carta (i 48px di --hand-h). */
const HAND_CHROME = 48;

export interface TableView {
  render(): void;
  /** Rifà la geometria di vista (misure, zone, scala): per il cambio di
      modo compatto/normale a caldo. Le carte restano dove sono. */
  refreshLayout(): void;
  /** Callback per aprire la ricerca: la fornisce main.ts. */
  onBrowse(handler: (seat: Seat, zone: ZoneId) => void): void;
}

export function mountTable(root: HTMLElement, ctx: Ctx): TableView {
  const tiles = new Map<string, HTMLElement>();
  let browse: (seat: Seat, zone: ZoneId) => void = () => {};
  /** Uid della carta in trascinamento: non va riposizionata dal render. */
  let dragging: string | null = null;
  /**
   * Da dove è partita la carta presa in mano: il trascinamento è condiviso
   * IN DIRETTA (onDragMove manda i move mentre trascini), quindi se al
   * rilascio l'engine ferma il gesto i pixel hanno già viaggiato — e la
   * carta deve poter tornare esattamente qui.
   */
  let dragOrigin: { x: number; y: number; z: number } | null = null;
  /**
   * Dichiarazione di blocco in corso: si è scelto l'attaccante e si sta
   * scegliendo con chi bloccarlo. `pointer` è la punta della freccia in volo.
   */
  let targeting: { attacker: string; kind: "block" | "counter"; pointer: { x: number; y: number } | null } | null = null;

  const surface = document.createElement("div");
  surface.className = "surface";
  surface.dataset.drop = "field";

  /** Larghezza fissa, altezza di VISTA (la compatta la stringe). Il transform
      di scala (style.css) non riduce l'ingombro nello scroll: lo pareggiano i
      margini, che tolgono esattamente la parte non disegnata. */
  function applySurfaceSize(): void {
    surface.style.width = `${SURFACE_W}px`;
    surface.style.height = `${surfaceViewH()}px`;
    surface.style.marginRight = `calc(${SURFACE_W}px * (var(--card-scale) - 1))`;
    surface.style.marginBottom = `calc(${surfaceViewH()}px * (var(--card-scale) - 1))`;
    // Anche lo strato delle frecce segue l'altezza di vista: alto quanto la
    // superficie canonica, allungherebbe lo scorrimento da sotto, invisibile.
    arrowLayer.setAttribute("height", String(surfaceViewH()));
    arrowLayer.setAttribute("viewBox", `0 0 ${SURFACE_W} ${surfaceViewH()}`);
  }
  // Le frecce stanno sopra le carte: una punta nascosta sotto una tessera non
  // direbbe niente. Lo strato è inerte al puntatore.
  const arrowLayer = createArrowLayer(SURFACE_W, SURFACE_H);
  surface.append(arrowLayer);
  applySurfaceSize();

  const board = document.createElement("div");
  board.className = "board";
  board.append(surface);

  const oppHand = document.createElement("div");
  oppHand.className = "hand hand-opponent";
  const oppTag = document.createElement("span");
  oppTag.className = "hand-tag";
  oppHand.append(oppTag);

  const myHand = document.createElement("div");
  myHand.className = "hand hand-mine";
  myHand.dataset.drop = "hand";
  const myTag = document.createElement("span");
  myTag.className = "hand-tag";
  myHand.append(myTag);

  // Fascia di rilascio in fondo al tavolo: portare una carta quaggiù la
  // rimette in mano. Esiste a prescindere dalla mano — che può essere vuota,
  // ripiegata o troppo bassa da centrare — ed è inerte finché non si trascina.
  const handDrop = document.createElement("div");
  handDrop.className = "hand-drop";
  handDrop.dataset.drop = "hand";
  handDrop.dataset.seat = ctx.seat();
  handDrop.append(Object.assign(document.createElement("span"), {
    className: "hand-drop-hint",
    textContent: "rimetti in mano",
  }));

  const handToggle = document.createElement("button");
  handToggle.type = "button";
  handToggle.className = "hand-toggle";

  // Doppia freccia, non una parola: in su per aprire la mano, in giù per
  // richiuderla.
  const chevrons = (up: boolean): string =>
    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
      up
        ? '<polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>'
        : '<polyline points="7 6 12 11 17 6"/><polyline points="7 13 12 18 17 13"/>'
    }</svg>`;

  function setHandCollapsed(collapsed: boolean): void {
    myHand.classList.toggle("is-collapsed", collapsed);
    handToggle.classList.toggle("is-off", collapsed);
    handToggle.innerHTML = chevrons(collapsed);
    handToggle.title = collapsed ? "Apri la mano" : "Chiudi la mano";
    handToggle.setAttribute("aria-label", handToggle.title);
  }
  setHandCollapsed(false);
  handToggle.addEventListener("click", () => setHandCollapsed(!myHand.classList.contains("is-collapsed")));

  // Su touch il cassetto si governa anche col gesto: swipe in giù lo ripiega,
  // swipe in su (o un tap sull'orlo ripiegato) lo riapre. E si parte ripiegati:
  // su uno schermo piccolo la mano aperta si mangerebbe il tavolo.
  if (window.matchMedia("(pointer: coarse)").matches) setHandCollapsed(true);
  myHand.addEventListener("pointerdown", event => {
    if (event.pointerType !== "touch") return;
    // Le carte si trascinano: il gesto del cassetto vale solo fuori da esse.
    if ((event.target as HTMLElement).closest(".tile")) return;
    const startY = event.clientY;
    const move = (ev: PointerEvent): void => {
      const delta = ev.clientY - startY;
      if (Math.abs(delta) < 36) return;
      setHandCollapsed(delta > 0);
      release();
    };
    const release = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  });
  /** La mano era aperta quando è partito un trascinamento da lei: al
      rilascio va riaperta. */
  let handWasOpen = false;
  /** Quante carte aveva la mia mano all'ultimo render: se cresce, il
      cassetto ripiegato si apre. -1 = ancora nessun render. */
  let lastMyHand = -1;

  myHand.addEventListener("click", event => {
    if ((event.target as HTMLElement).closest(".tile")) return;
    if (myHand.classList.contains("is-collapsed")) setHandCollapsed(false);
  });

  // Scegliere il bloccante è una modalità: va detto che si è dentro, e come
  // uscirne.
  const targetHint = document.createElement("div");
  targetHint.className = "target-hint";
  targetHint.hidden = true;

  root.append(board, oppHand, myHand, handDrop, handToggle, targetHint);

  // La lavagna si vede sempre tutta in larghezza: quando la finestra è più
  // stretta dei 2700px canonici, la superficie si scala di conseguenza (e le
  // carte in mano con lei, via CSS). Si vedono più piccole, ma a leggerle ci
  // pensa l'ingrandimento al passaggio, che resta a misura piena.
  function fitScale(): void {
    // In vista compatta il tavolo deve stare TUTTO nella finestra, MANO
    // COMPRESA: il cassetto è un pannello sopra la lavagna, e se il fit non
    // lo contasse coprirebbe la fila di servizio (Richiamo, pile). Qui le
    // carte in mano stanno alla scala del campo (HAND_BOOST_COMPACT), non
    // al 30% in più della vista normale — un po' più piccole, per farci
    // stare tutto. L'altezza del cassetto è quella di --hand-h in CSS,
    // 48px di cornice più una carta in scala di mano: risolvendo
    // h = surface·s + 48 + 424·s·boost si ha la scala che fa combaciare il
    // fondo della lavagna con l'orlo della mano.
    const compact = isCompactView();
    const heightFit = compact
      ? (board.clientHeight - HAND_CHROME) / (surfaceViewH() + TILE_H * HAND_BOOST_COMPACT)
      : Number.POSITIVE_INFINITY;
    const scale = Math.min(1, board.clientWidth / SURFACE_W, heightFit);
    // Su html, non su body: le variabili derivate (--hand-scale, --hand-h)
    // sono definite in :root e si risolvono LÌ — un override sul body non le
    // raggiungerebbe, e il cassetto resterebbe ad altezza piena.
    // floor, non round: arrotondare in su lascerebbe UN pixel di scorrimento
    // proprio nella vista che promette di non scorrere.
    document.documentElement.style.setProperty("--card-scale", String(Math.floor(scale * 1000) / 1000));
    document.documentElement.style.setProperty("--hand-boost", String(compact ? HAND_BOOST_COMPACT : HAND_BOOST));
    // Quando in compatta comanda l'altezza, la lavagna è più stretta della
    // finestra: si centra nello spazio a sinistra della corsia dell'HUD
    // (--hud-lane), invece di restare incollata a sinistra col vuoto a
    // destra — o di finire sotto l'HUD. Il margine è in percentuale della
    // lavagna e legge la scala dalla variabile: al ridimensionamento si
    // sistema da sé. Le coordinate dei rilasci partono dal rettangolo della
    // superficie, non dalla lavagna, quindi lo spostamento non le tocca.
    surface.style.marginLeft = compact
      ? `max(0px, calc((100% - var(--hud-lane) - ${SURFACE_W}px * var(--card-scale)) / 2))`
      : "";
  }
  fitScale();
  new ResizeObserver(fitScale).observe(board);

  /** Da coordinata condivisa a coordinata di schermo, per questo giocatore. */
  const view = (y: number): number => toView(y, ctx.seat());
  /** E il viaggio di ritorno, per il punto in cui una carta viene lasciata. */
  const unview = (y: number): number => fromView(y, ctx.seat());

  const pileSlots = new Map<string, HTMLElement>();
  /** Gli elementi delle zone: si buttano e si ridisegnano al cambio modo. */
  const zoneEls: HTMLElement[] = [];
  buildStaticZones();

  // Click a vuoto sulla lavagna: chiude il menu contestuale (ci pensa menu.ts)
  // e nient'altro. Non esiste "deseleziona": non c'è selezione.
  surface.addEventListener("contextmenu", event => {
    if ((event.target as HTMLElement).closest(".tile")) return;
    event.preventDefault();
    cancelTargeting();
  });

  // Cliccare a vuoto o premere Esc lascia perdere il blocco.
  surface.addEventListener("click", event => {
    if (targeting && !(event.target as HTMLElement).closest(".tile")) cancelTargeting();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") cancelTargeting();
  });

  // La freccia in volo segue il puntatore finché non si sceglie.
  /** La scala a cui la superficie è disegnata (1 a tutta larghezza). */
  const surfaceScale = (): number => surface.getBoundingClientRect().width / SURFACE_W;

  board.addEventListener("pointermove", event => {
    if (!targeting) return;
    const box = surface.getBoundingClientRect();
    // La punta della freccia vive in coordinate canoniche, come le carte: la
    // posizione del puntatore va riportata fuori dalla scala del disegno.
    const scale = surfaceScale();
    targeting.pointer = { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale };
    paintArrows();
  });

  function buildStaticZones(): void {
    for (const el of zoneEls) el.remove();
    zoneEls.length = 0;
    pileSlots.clear();
    for (const seat of SEATS) {
      const mine = seat === ctx.seat();
      // La fascia NON passa da `view`: quella trasformata capovolge una carta
      // dentro la fascia, e ragiona sull'altezza di una carta. La fascia è la
      // fascia — la sua posizione sullo schermo la dice `viewBandTop`, e basta.
      const bandTop = viewBandTop(seat, ctx.seat());
      const front = frontRowY(seat);
      const back = backRowY(seat);

      const band = document.createElement("div");
      band.className = `half ${mine ? "is-mine" : "is-foe"}`;
      band.style.top = `${bandTop}px`;
      band.style.height = `${bandViewH()}px`;
      const name = document.createElement("span");
      name.className = "half-name";
      name.dataset.seatName = seat;
      band.append(name);
      surface.append(band);
      zoneEls.push(band);

      for (const pile of PILES) {
        const slot = document.createElement("div");
        slot.className = "slot pile";
        slot.dataset.drop = pile.zone;
        slot.dataset.seat = seat;
        slot.style.left = `${pile.x}px`;
        slot.style.top = `${view(back)}px`;
        slot.style.width = `${TILE_W}px`;
        slot.style.height = `${tileViewH()}px`;

        const label = document.createElement("span");
        label.className = "slot-label";
        slot.append(label);
        slot.dataset.label = pile.label;

        slot.addEventListener("contextmenu", event => {
          event.preventDefault();
          openMenu(event.clientX, event.clientY, pileMenu(seat, pile.zone));
        });
        // Su touch: pressione lunga al posto del tasto destro.
        enableLongPress(slot, (x, y) => openMenu(x, y, pileMenu(seat, pile.zone)));
        slot.addEventListener("dblclick", () => {
          if (pile.zone === "deck" && ctx.controls(seat)) draw(seat, 1);
          else browse(seat, pile.zone);
        });

        surface.append(slot);
        zoneEls.push(slot);
        pileSlots.set(`${seat}:${pile.zone}`, slot);
      }

      // I posti segnati non sono zone a sé: la carta che ci finisce resta una
      // carta sul campo, con le sue coordinate. L'unica differenza è che ci si
      // aggancia dentro invece di posarsi dove capita — come chiedono i
      // riquadri di Abisso e Ritiro, che però sono pile vere.
      const markSlot = (x: number, y: number, label: string, extra = ""): void => {
        const slot = document.createElement("div");
        slot.className = `slot slot-mark ${extra}`.trim();
        slot.dataset.drop = "field";
        // snapX/snapY restano CANONICI: sono i dati che finiranno nell'azione.
        // A spostarsi è soltanto il riquadro sullo schermo.
        slot.dataset.snapX = String(x);
        slot.dataset.snapY = String(y);
        slot.style.left = `${x}px`;
        slot.style.top = `${view(y)}px`;
        slot.style.width = `${TILE_W}px`;
        slot.style.height = `${tileViewH()}px`;
        if (label) slot.dataset.label = label;
        surface.append(slot);
        zoneEls.push(slot);
      };

      // Zona di Richiamo (§5): il Rubyfront parte da qui, e ci torna solo per
      // richiamo volontario.
      markSlot(SLOT_X.richiamo, back, "Zona di Richiamo");

      // I cinque slot del Fronte, al centro. L'etichetta è una sola per il
      // gruppo: cinque scritte "Fronte" in fila sarebbero solo rumore.
      for (const x of FRONT_SLOT_X) markSlot(x, front, "", "slot-front");

      const frontLabel = document.createElement("div");
      frontLabel.className = "row-label";
      frontLabel.textContent = "Fronte";
      frontLabel.style.left = `${FRONT_X}px`;
      frontLabel.style.width = `${FRONT_W}px`;
      frontLabel.style.top = `${view(front) + tileViewH() + 9}px`;
      surface.append(frontLabel);
      zoneEls.push(frontLabel);

      // Il Rubyfront schierato sta davanti al Fronte, senza occupare uno slot.
      markSlot(RUBYFRONT_X, front, "Rubyfront", "slot-rubyfront");

      // Le Materie in gioco, all'altra estremità della fila.
      markSlot(MATTER_X, front, "Materie", "slot-matter");
    }
  }

  // ---------------------------------------------------------------- azioni

  function draw(seat: Seat, count: number): void {
    const left = zoneCards(ctx.state(), seat, "deck").length;
    if (left === 0) {
      ctx.log(`${seatLabel(ctx.state(), seat)}: mazzo vuoto, nessuna pesca.`, seat);
      return;
    }
    const taken = Math.min(count, left);
    ctx.dispatch({ t: "draw", seat, count: taken });
    ctx.log(`${seatLabel(ctx.state(), seat)} pesca ${taken} ${taken === 1 ? "carta" : "carte"}.`, seat);
  }

  function shuffle(seat: Seat): void {
    const order = shuffled(zoneCards(ctx.state(), seat, "deck").map(card => card.uid));
    ctx.dispatch({ t: "shuffle", seat, order });
    ctx.log(`${seatLabel(ctx.state(), seat)} mescola il mazzo (${order.length} carte).`, seat);
  }

  // ------------------------------------------------------- combattimento

  /** Il Rubyfront (o Nexus) di un posto, ovunque si trovi sul campo. */
  function rubyfrontOf(seat: Seat): CardInstance | undefined {
    return fieldCards(ctx.state()).find(card => card.owner === seat && isRubyfront(card.cardId));
  }

  /**
   * §6.3: un'Entità tappata non può attaccare né bloccare, una coperta non può
   * fare nulla, e il Rubyfront non è un'Entità. Qui la regola serve solo a
   * smorzare: la carta resta scegliibile lo stesso. L'arbitro non è il
   * simulatore.
   */
  function looksPlayable(card: CardInstance): boolean {
    if (card.tapped || card.facedown) return false;
    const kind = faceKind(card.cardId, card.face);
    return kind !== "rubyfront" && kind !== "nexus";
  }

  // Dichiarazioni e loro conseguenze stanno in combat.ts: passano dal
  // giudizio dell'engine, e il tavolo si limita a fornire il bersaglio.
  function declareAttack(card: CardInstance): void {
    void declareAttackVia(ctx, card, rubyfrontOf(otherSeat(card.owner)));
  }

  function startTargeting(attacker: CardInstance, kind: "block" | "counter"): void {
    targeting = { attacker: attacker.uid, kind, pointer: null };
    document.body.classList.add("is-targeting");
    targetHint.textContent =
      kind === "counter"
        ? "Scegli l'Entità che contrattacca — Esc annulla"
        : "Scegli l'Entità che blocca — Esc annulla";
    targetHint.hidden = false;
    render();
  }

  /**
   * Il posto che sceglie il bloccante: l'altra metà rispetto all'attaccante.
   * In rete è sempre il proprio; in partita locale può essere l'uno o l'altro,
   * a seconda di chi ha dichiarato l'attacco. Null fuori dal modo bersaglio.
   */
  function defenderSeat(): Seat | null {
    if (!targeting) return null;
    const attacker = ctx.state().cards[targeting.attacker];
    return attacker ? otherSeat(attacker.owner) : null;
  }

  function cancelTargeting(): void {
    if (!targeting) return;
    targeting = null;
    document.body.classList.remove("is-targeting");
    targetHint.hidden = true;
    render();
  }

  function confirmBlock(blocker: CardInstance): void {
    if (!targeting) return;
    const { attacker, kind } = targeting;
    cancelTargeting();
    void declareBlock(ctx, blocker, attacker, kind);
  }

  function pileMenu(seat: Seat, zone: ZoneId): MenuItem[] {
    const mine = ctx.controls(seat);
    const count = zoneCards(ctx.state(), seat, zone).length;
    if (zone === "deck") {
      return [
        { label: `Pesca 1`, run: () => draw(seat, 1), disabled: !mine || count === 0 },
        { label: `Pesca 6 (mano iniziale)`, run: () => draw(seat, 6), disabled: !mine || count === 0 },
        { label: "Mescola", run: () => shuffle(seat), disabled: !mine || count === 0 },
        { rule: true, label: "" },
        { label: `Cerca nel mazzo (${count})`, run: () => browse(seat, "deck"), disabled: !mine || count === 0 },
      ];
    }
    return [{ label: `Sfoglia (${count})`, run: () => browse(seat, zone), disabled: count === 0 }];
  }

  function cardMenu(card: CardInstance): MenuItem[] {
    const items: MenuItem[] = [];
    // «Mia» = di un posto che governo: in rete solo il proprio, in partita
    // locale entrambi.
    const mine = ctx.controls(card.owner);
    const declared = declarationOf(ctx.state(), card.uid);

    // Il combattimento sta in cima al menu: è quello che si cerca in Fase di
    // Fronte. Tappa/Stappa resta subito sotto e sempre disponibile.
    if (card.zone === "field") {
      if (mine) {
        if (declared?.kind === "attack") {
          items.push({
            label: `Annulla attacco (${declared.order})`,
            run: () => void undeclare(ctx, card, declared),
          });
        } else if (declared) {
          items.push({
            label: declared.kind === "counter" ? "Annulla contrattacco" : "Annulla blocco",
            run: () => void undeclare(ctx, card, declared),
          });
        } else {
          // «Attacca» solo a chi può attaccare: il Rubyfront non attacca
          // (§3.1) e dichiarano solo le Entità (§6.3) — il gesto che
          // l'arbitro fermerebbe comunque non si offre nemmeno. La carta
          // ignota resta permissiva, come per l'engine; quando la regola
          // d'oro concederà eccezioni, sarà lei a riaprire la voce.
          const kind = faceKind(card.cardId, card.face);
          if (kind === null || kind === "entity") {
            items.push({ label: "Attacca", run: () => declareAttack(card) });
          }
        }
      }
      // Un attaccante dichiarato si ferma dall'altra metà del tavolo: in rete
      // è sempre una carta avversaria, in locale anche la propria — chi guida
      // entrambi i posti blocca con le Entità del difensore.
      if (declared?.kind === "attack" && ctx.controls(otherSeat(card.owner))) {
        items.push({ label: "Blocca con…", run: () => startTargeting(card, "block") });
        items.push({ label: "Contrattacca con…", run: () => startTargeting(card, "counter") });
      }
      if (items.length) items.push({ rule: true, label: "" });
    }

    if (card.zone === "field") {
      // Con l'arbitro al tavolo, tappare/stappare/coprire non sono più gesti
      // liberi: il tap arriva dall'attacco, la copertura dal contrattacco, la
      // stappata dall'inizio del turno (endTurn). Resta solo «Scopri», perché
      // la scoperta a fine giro (§6.3, T+3) non è ancora automatica. Quando
      // una carta concederà questi gesti (regola d'oro), sarà l'engine a
      // riaprirli. A engine spento: lavagna libera come sempre.
      if (!ctx.arbitrated()) {
        items.push({
          label: card.tapped ? "Stappa" : "Tappa",
          run: () => ctx.dispatch({ t: "tap", uid: card.uid, tapped: !card.tapped }),
        });
        items.push({
          label: card.facedown ? "Scopri" : "Copri",
          run: () => ctx.dispatch({ t: "facedown", uid: card.uid, facedown: !card.facedown }),
        });
      } else if (card.facedown) {
        items.push({
          label: "Scopri",
          run: () => ctx.dispatch({ t: "facedown", uid: card.uid, facedown: false }),
        });
      }
    }
    if (faceCount(card.cardId) > 1) {
      const next = (card.face + 1) % faceCount(card.cardId);
      items.push({
        label: card.face === 0 ? "Flip → Nexus" : "Flip → Rubyfront",
        run: () => ctx.dispatch({ t: "flip", uid: card.uid, face: next }),
      });
    }
    items.push({ rule: true, label: "" });
    const send = (zone: ZoneId, label: string, toBottom = false): MenuItem => ({
      label,
      disabled: card.zone === zone && !toBottom,
      run: () => ctx.dispatch({ t: "toZone", uid: card.uid, zone, toBottom }),
    });
    if (mine) items.push(send("hand", "In mano"));
    items.push(send("abisso", "Nell'Abisso"));
    items.push(send("ritiro", "In Zona di Ritiro"));
    if (mine) {
      items.push(send("deck", "In cima al mazzo"));
      items.push({
        label: "In fondo al mazzo",
        run: () => ctx.dispatch({ t: "toZone", uid: card.uid, zone: "deck", toBottom: true }),
      });
    }
    return items;
  }

  /**
   * Un Oggetto lasciato sopra un'Entità le va DIETRO: chi agisce resta in
   * vista, l'equipaggiamento fa capolino da sotto (la scaletta di stackAt gli
   * lascia già l'angolo fuori). E dietro vuol dire in fondo alla pila: sotto
   * l'Entità E sotto gli Oggetti già appesi, sennò il secondo si accavalla al
   * primo con lo stesso z e uno dei due si perde. Tutto il resto sale in cima
   * come sempre.
   */
  /** Le carte in campo toccate da un rilascio in (x, y), esclusa la mossa. */
  function touchedAt(card: CardInstance, x: number, y: number): CardInstance[] {
    return fieldCards(ctx.state()).filter(
      other =>
        other.uid !== card.uid &&
        Math.abs(other.x - x) < TILE_W &&
        Math.abs(other.y - y) < TILE_H
    );
  }

  /** L'Entità su cui un Oggetto è stato posato, se c'è: è lei che lo riceve. */
  function entityUnder(card: CardInstance, x: number, y: number): CardInstance | undefined {
    if (faceKind(card.cardId, card.face) !== "object") return undefined;
    return touchedAt(card, x, y).find(other => faceKind(other.cardId, other.face) === "entity");
  }

  function dropZ(card: CardInstance, x: number, y: number): number {
    const state = ctx.state();
    const top = state.zTop + 1;
    // Va dietro solo se sotto c'è un'Entità: l'Oggetto posato sul vuoto (o su
    // altre carte qualsiasi) resta una carta come le altre.
    if (!entityUnder(card, x, y)) return top;
    const pile = touchedAt(card, x, y).filter(other => {
      const kind = faceKind(other.cardId, other.face);
      return kind === "entity" || kind === "object";
    });
    // Il -9 tiene lo z-index del DOM sopra lo zero (il disegno somma 10):
    // più giù, la carta finirebbe sotto il tappeto.
    return Math.max(-9, Math.min(...pile.map(other => other.z)) - 1);
  }

  /**
   * Posa la carta in campo: sposta se c'era già, altrimenti ce la porta —
   * e dalla mano la GIOCA, pagando il costo di Flusso stampato (§3.2). Il
   * costo lo legge il catalogo e viaggia nell'azione: l'arbitro lo verifica
   * e lo ferma se il Flusso non basta; il riduttore lo scala. Il Rubyfront
   * non paga di qui: il suo costo di schieramento può essere un dado, e si
   * regola a mano (§3.1). Dice se il gesto è passato.
   */
  async function place(card: CardInstance, x: number, y: number, z: number): Promise<boolean> {
    if (card.zone === "field") return ctx.dispatch({ t: "move", uid: card.uid, x, y, z });
    const cost = card.zone === "hand" && !isRubyfront(card.cardId) ? cardStats(card.cardId).fluxCost : null;
    const passed = await ctx.dispatch({
      t: "toZone",
      uid: card.uid,
      zone: "field",
      x,
      y,
      z,
      ...(cost !== null ? { cost } : {}),
    });
    if (passed && cost !== null) {
      const player = ctx.state().players[card.owner];
      ctx.log(
        `${seatLabel(ctx.state(), card.owner)} gioca «${cardName(card.cardId, ctx.locale())}» per ${cost} (Flusso ${player.flux}/${player.fluxMax}).`,
        card.owner
      );
    }
    return passed;
  }

  /**
   * Con l'arbitro al tavolo la lavagna non è più libera: ogni carta ha il
   * suo posto segnato (§5) e ci si incastra, o non si posa affatto. Le
   * Entità stanno sugli slot del Fronte — quello del rilascio se è libero,
   * altrimenti il primo libero; a Fronte pieno il gesto cade. Le Materie
   * vanno nella loro fila, dietro. Il Rubyfront ha due posti soli, il suo
   * davanti al Fronte e la Zona di Richiamo, e ci arriva solo agganciato.
   * Gli Oggetti non passano di qui: il loro posto è addosso a un'Entità, e
   * lo decide il rilascio (vedi applyDrop). `null` = il gesto non si fa.
   */
  function boundSpot(card: CardInstance, drop: { x: number; y: number; snapped: boolean }): { x: number; y: number } | null {
    const state = ctx.state();
    const kind = faceKind(card.cardId, card.face);
    const front = frontRowY(card.owner);
    if (kind === "rubyfront" || kind === "nexus") {
      if (!drop.snapped) return null;
      const deployed = drop.x === RUBYFRONT_X && drop.y === front;
      const recalled = drop.x === SLOT_X.richiamo && drop.y === backRowY(card.owner);
      return deployed || recalled ? { x: drop.x, y: drop.y } : null;
    }
    if (kind === "matter") return matterSpot(state, card.owner);
    if (kind !== "entity") return { x: drop.x, y: drop.y };
    const others = fieldCards(state).filter(other => other.uid !== card.uid && Math.abs(other.y - front) < 40);
    const busy = (x: number): boolean => others.some(other => Math.abs(other.x - x) < 40);
    if (drop.snapped && drop.y === front && FRONT_SLOT_X.includes(drop.x) && !busy(drop.x)) return { x: drop.x, y: front };
    const free = FRONT_SLOT_X.find(x => !busy(x));
    return free === undefined ? null : { x: free, y: front };
  }

  function applyDrop(card: CardInstance, drop: Drop): void {
    if (!drop) return;
    if (drop.kind === "field") {
      // Il rilascio a mano libera arriva in coordinate di schermo: va riportato
      // in canoniche prima di finire nello stato, o al posto B ogni carta
      // comparirebbe nella metà sbagliata. L'aggancio no: i riquadri portano
      // già con sé la coordinata canonica.
      const free = { x: drop.x, y: unview(drop.y) };
      // Le Materie non si giocano sugli slot del Fronte (§5): il divieto è
      // dell'ARBITRO, non del tavolo — il rilascio parte com'è e, con
      // l'engine collegato, torna indietro col sigillo. A engine spento,
      // lavagna libera come sempre.
      let spot = drop.snapped ? stackAt(ctx.state(), drop.x, drop.y, card.uid) : free;
      // Arbitro al tavolo: il posto lo decide la lavagna, non il dito. Un
      // gesto senza posto (Fronte pieno, Rubyfront fuori dai suoi due
      // riquadri) non si fa: la carta torna da dove era partita.
      const bound = ctx.arbitrated() ? boundSpot(card, { ...free, ...(drop.snapped ? { x: drop.x, y: drop.y } : {}), snapped: drop.snapped }) : undefined;
      const origin = dragOrigin;
      const giveBack = (): void => {
        if (origin) void ctx.dispatch({ t: "move", uid: card.uid, x: origin.x, y: origin.y, z: origin.z });
      };
      if (bound === null) {
        giveBack();
        return;
      }
      if (bound) spot = bound;
      let x = Math.max(0, Math.min(SURFACE_W - TILE_W, spot.x));
      let y = Math.max(0, Math.min(SURFACE_H - TILE_H, spot.y));
      // Un Oggetto posato su un'Entità non resta dove l'ha lasciato il dito:
      // si accomoda da solo dietro di lei, a scaletta — in linea con la sua
      // portatrice, un gradino per ogni Oggetto già addosso.
      const under = entityUnder(card, x, y);
      // Con l'arbitro un Oggetto ha un posto solo: addosso a un'Entità (§3.1).
      if (ctx.arbitrated() && faceKind(card.cardId, card.face) === "object" && !under) {
        giveBack();
        return;
      }
      if (under) {
        const worn = Object.values(ctx.state().cards)
          .filter(other => other.assignedTo === under.uid && other.uid !== card.uid).length;
        const step = STACK_STEP * (worn + 1);
        x = Math.max(0, Math.min(SURFACE_W - TILE_W, under.x + step));
        y = Math.max(0, Math.min(SURFACE_H - TILE_H, under.y + step));
      }
      const z = dropZ(card, x, y);
      // L'assegnazione è un fatto di gioco, non di pixel: il rilascio sopra
      // un'Entità la dichiara (azione `assign`, §3.1), il rilascio sul vuoto
      // la scioglie. E l'ORDINE conta: se il rilascio è una RIASSEGNAZIONE
      // (l'Oggetto era già addosso a qualcun altro), prima si chiede il
      // permesso e solo col sì si muovono i pixel — sennò il sigillo dice
      // «non si sposta» ma la carta intanto si è spostata.
      const current = ctx.state().cards[card.uid]?.assignedTo;
      void (async () => {
        if (under && under.uid !== current) {
          if (!(await ctx.dispatch({ t: "assign", uid: card.uid, to: under.uid }))) {
            // Fermata: i pixel del trascinamento in diretta hanno già
            // viaggiato — la carta torna da dove era partita.
            if (origin) void ctx.dispatch({ t: "move", uid: card.uid, x: origin.x, y: origin.y, z: origin.z });
            return;
          }
          if (!(await place(card, x, y, z))) {
            // L'assegnazione era passata ma il gioco no (Flusso): si scioglie,
            // e la carta torna da dove era partita.
            void ctx.dispatch({ t: "assign", uid: card.uid, to: null });
            if (origin) void ctx.dispatch({ t: "move", uid: card.uid, x: origin.x, y: origin.y, z: origin.z });
            return;
          }
          ctx.log(
            `${seatLabel(ctx.state(), card.owner)} assegna «${cardName(card.cardId, ctx.locale())}» a «${cardName(under.cardId, ctx.locale())}».`,
            card.owner
          );
          return;
        }
        void place(card, x, y, z);
        if (!under && current) void ctx.dispatch({ t: "assign", uid: card.uid, to: null });
      })();
      return;
    }
    // Le pile e la mano sono di chi le possiede: una carta non cambia
    // proprietario trascinandola nella metà avversaria.
    if (drop.seat !== card.owner) {
      ctx.log(`${seatLabel(ctx.state(), card.owner)}: la carta resta al suo proprietario.`, card.owner);
      return;
    }
    ctx.dispatch({ t: "toZone", uid: card.uid, zone: drop.zone });
  }

  // -------------------------------------------------------------- disegno

  function tileFor(card: CardInstance, back: boolean): HTMLElement {
    let tile = tiles.get(card.uid);
    if (!tile) {
      tile = createCardEl(card.uid);
      tiles.set(card.uid, tile);
      wirePreview(tile, ctx.locale);
      enableDrag(tile, {
        canDrag: () => {
          if (targeting) return false;
          const live = ctx.state().cards[card.uid];
          if (!live) return false;
          // La mano avversaria è nascosta (§5): non si tocca — salvo in
          // partita locale, dove anche quella mano è di chi guida il tavolo.
          return !(live.zone === "hand" && !ctx.controls(live.owner));
        },
        onDragMove: drop => {
          const live = ctx.state().cards[card.uid];
          if (!live || live.zone !== "field") return;
          dragging = card.uid;
          // Sopra un riquadro le coordinate sono già canoniche; a mano libera
          // arrivano dallo schermo e vanno riportate indietro.
          const y = drop.snapped ? drop.y : unview(drop.y);
          ctx.dispatch({ t: "move", uid: card.uid, x: drop.x, y, z: Math.max(live.z, ctx.state().zTop) });
        },
        onStart: () => {
          const live = ctx.state().cards[card.uid];
          // La posizione di partenza serve al ripensamento (vedi applyDrop).
          dragOrigin = live && live.zone === "field" ? { x: live.x, y: live.y, z: live.z } : null;
          // Una carta presa DALLA MANO vuole essere posata sul tavolo, e il
          // cassetto aperto lo coprirebbe: si ripiega da solo, e al rilascio
          // torna com'era.
          if (!live || live.zone !== "hand" || live.owner !== ctx.seat()) return;
          if (!myHand.classList.contains("is-collapsed")) {
            handWasOpen = true;
            setHandCollapsed(true);
          }
        },
        onDrop: drop => {
          dragging = null;
          const live = ctx.state().cards[card.uid];
          if (live) applyDrop(live, drop);
          if (handWasOpen) {
            handWasOpen = false;
            setHandCollapsed(false);
          }
          render();
        },
        onContext: event => {
          // La pressione lunga è il tasto destro del dito: stesso menu.
          if (targeting) {
            cancelTargeting();
            return;
          }
          const live = ctx.state().cards[card.uid];
          if (live) openMenu(event.clientX, event.clientY, cardMenu(live));
        },
        onTap: up => {
          // Su touch non c'è hover: è il tap a chiedere l'ingrandimento (e a
          // richiuderlo, sulla stessa carta). In targeting il tap sceglie il
          // bloccante e l'ingrandimento non deve mettersi in mezzo.
          if (up.pointerType !== "touch" || targeting) return;
          const live = ctx.state().cards[card.uid];
          const element = tiles.get(card.uid);
          if (!live || !element || element.classList.contains("is-back")) return;
          tapPreview(element, live.cardId, live.face, ctx.themeFor(live.owner), ctx.locale());
        },
      });
      tile.addEventListener("click", () => {
        if (!targeting) return;
        const live = ctx.state().cards[card.uid];
        // Solo le carte in campo del difensore: le altre non bloccano niente.
        if (live && live.zone === "field" && live.owner === defenderSeat() && live.uid !== targeting.attacker) {
          confirmBlock(live);
        }
      });
      tile.addEventListener("contextmenu", event => {
        event.preventDefault();
        if (targeting) {
          cancelTargeting();
          return;
        }
        const live = ctx.state().cards[card.uid];
        if (live) openMenu(event.clientX, event.clientY, cardMenu(live));
      });
      tile.addEventListener("dblclick", () => {
        const live = ctx.state().cards[card.uid];
        if (!live) return;
        if (live.zone === "field") {
          // Stesso discorso del menu: con l'arbitro al tavolo il tap non è
          // un gesto libero, e il doppio click non lo aggira.
          if (ctx.arbitrated()) return;
          ctx.dispatch({ t: "tap", uid: live.uid, tapped: !live.tapped });
        } else if (live.zone === "hand" && ctx.controls(live.owner)) {
          // Il doppio click gioca: Entità sul primo slot libero del Fronte,
          // Materie nella loro fila (§5) — mai sugli slot.
          const spot = playSpot(ctx.state(), live.owner, faceKind(live.cardId, live.face));
          void place(live, spot.x, spot.y, ctx.state().zTop + 1);
        }
      });
    }
    syncCardEl(tile, card, { back, theme: ctx.themeFor(card.owner), locale: ctx.locale() });
    return tile;
  }

  /** Rettangolo di una carta in coordinate della superficie. */
  function boxOf(card: CardInstance): Arrow["from"] {
    return { x: card.x, y: view(card.y), w: TILE_W, h: tileViewH() };
  }

  function paintArrows(): void {
    const state = ctx.state();
    const arrows: Arrow[] = [];
    for (const declaration of state.declarations) {
      // L'attacco non ha freccia: si attacca sempre il Rubyfront avversario
      // (§6.3), quindi tutte punterebbero là e non direbbero niente che il
      // bersaglio non dica già. L'attaccante si illumina, e basta.
      if (declaration.kind === "attack") continue;
      const from = state.cards[declaration.from];
      const to = state.cards[declaration.to];
      if (!from || !to || from.zone !== "field" || to.zone !== "field") continue;
      arrows.push({ kind: declaration.kind, from: boxOf(from), to: boxOf(to) });
    }
    if (targeting?.pointer) {
      const attacker = state.cards[targeting.attacker];
      // La freccia in volo parte dal puntatore e punta all'attaccante: si sta
      // scegliendo chi lo ferma, non dove mandarlo.
      if (attacker) {
        arrows.push({
          kind: targeting.kind,
          from: { ...targeting.pointer, w: 0, h: 0 },
          to: boxOf(attacker),
          pending: true,
        });
      }
    }
    drawArrows(arrowLayer, arrows);
  }

  /** Distintivo d'angolo: il numero d'ondata, o lo scudo di chi ferma. */
  function markCombat(tile: HTMLElement, card: CardInstance): void {
    const declaration = declarationOf(ctx.state(), card.uid);
    tile.classList.toggle("is-attacking", declaration?.kind === "attack");
    tile.classList.toggle("is-blocking", declaration?.kind === "block");
    tile.classList.toggle("is-countering", declaration?.kind === "counter");

    let badge = tile.querySelector<HTMLElement>(".combat-badge");
    if (!declaration) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "combat-badge";
      tile.append(badge);
    }
    badge.textContent = declaration.kind === "attack" ? String(declaration.order) : "⛨";
    badge.className = `combat-badge is-${declaration.kind}`;
  }

  function render(): void {
    const state = ctx.state();
    const me = ctx.seat();
    const foe = otherSeat(me);
    const alive = new Set<string>();

    for (const seat of SEATS) {
      const label = surface.querySelector<HTMLElement>(`[data-seat-name="${seat}"]`);
      if (label) {
        label.textContent = `${seatLabel(state, seat, me)}${seat === me ? " · tu" : ""}`;
      }
      for (const pile of PILES) {
        const slot = pileSlots.get(`${seat}:${pile.zone}`)!;
        const cards = zoneCards(state, seat, pile.zone);
        slot.dataset.count = String(cards.length);
        const caption = slot.querySelector<HTMLElement>(".slot-label")!;
        caption.textContent = `${pile.label} · ${cards.length}`;
        const top = cards[0];
        if (top) {
          alive.add(top.uid);
          const tile = tileFor(top, pile.hidden);
          if (tile.parentElement !== slot) slot.append(tile);
          tile.style.left = "";
          tile.style.top = "";
          tile.style.marginLeft = "";
          tile.style.position = "absolute";
          // Anche la cima della pila si ritaglia in compatto, o sborderebbe
          // dallo slot e riporterebbe lo scorrimento che si voleva togliere.
          tile.style.height = `${tileViewH()}px`;
          tile.classList.toggle("is-cropped", isCompactView());
          tile.style.zIndex = "1";
        }
      }
    }

    for (const card of fieldCards(state)) {
      alive.add(card.uid);
      const tile = tileFor(card, card.facedown);
      markCombat(tile, card);
      // In modo bersaglio: le carte in campo del difensore sono scegliibili, e
      // fra queste si accendono quelle che le regole permetterebbero. Le altre
      // si smorzano soltanto — restano cliccabili.
      const pickable = Boolean(targeting) && card.owner === defenderSeat() && card.uid !== targeting?.attacker;
      tile.classList.toggle("is-pickable", pickable);
      tile.classList.toggle("is-legal", pickable && looksPlayable(card));
      if (tile.parentElement !== surface) surface.append(tile);
      if (card.uid !== dragging) {
        tile.style.position = "absolute";
        tile.style.left = `${card.x}px`;
        tile.style.top = `${view(card.y)}px`;
      }
      // Il margine negativo è un vestito della mano affollata: se la tessera
      // arriva da lì e se lo tenesse addosso, si disegnerebbe a sinistra del
      // punto vero — «fuori dallo slot» pur essendoci, nei dati, dentro.
      tile.style.marginLeft = "";
      // In compatto la tessera si ritaglia al fondo dell'illustrazione: la
      // carta sotto è intera, la taglia l'overflow. In mano resta piena.
      tile.style.height = `${tileViewH()}px`;
      tile.classList.toggle("is-cropped", isCompactView());
      tile.style.zIndex = String(10 + card.z);
    }

    for (const [seat, host, tag] of [[me, myHand, myTag], [foe, oppHand, oppTag]] as const) {
      host.dataset.seat = seat;
      // `data-drop=""` sarebbe comunque selezionato da [data-drop]: la mano
      // avversaria non deve avere l'attributo del tutto — in partita locale
      // invece lo porta, e le carte del secondo posto vi tornano trascinandole.
      if (ctx.controls(seat)) host.dataset.drop = "hand";
      else delete host.dataset.drop;
      const cards = zoneCards(state, seat, "hand");
      // Una carta appena arrivata in mano va vista: se il cassetto è
      // ripiegato, si apre da solo. Vale per ogni via (Pesca, menu della
      // pila, «rimetti in mano») ma non al primo render, che è solo lo
      // stato di partenza — e non durante un trascinamento dalla mano, che
      // la ripiega apposta (lì il conto non cresce).
      if (seat === me) {
        if (lastMyHand >= 0 && cards.length > lastMyHand && myHand.classList.contains("is-collapsed")) {
          setHandCollapsed(false);
        }
        lastMyHand = cards.length;
      }
      tag.textContent = seat === me
        ? `La tua mano · ${cards.length}`
        : seatWaiting(state, seat)
          ? "In attesa di un avversario…"
          : `Mano di ${seatLabel(state, seat)} · ${cards.length}`;
      host.classList.toggle("is-empty", cards.length === 0);
      const wanted: HTMLElement[] = [];
      for (const card of cards) {
        alive.add(card.uid);
        // La mano di un posto governato si vede scoperta: in rete solo la
        // propria, in partita locale anche quella in alto.
        const tile = tileFor(card, !ctx.controls(seat));
        tile.style.position = "relative";
        tile.style.left = "";
        tile.style.top = "";
        tile.style.height = `${TILE_H}px`;
        tile.classList.remove("is-cropped");
        tile.style.zIndex = "";
        wanted.push(tile);
      }
      // Le carte in mano si sovrappongono quando sono troppe: restano
      // 302×424, si stringono soltanto le une sulle altre. Il conto va
      // fatto sulla larghezza VISIVA (la scala della mano, o quella del
      // campo per i dorsi avversari su touch): in pixel canonici le carte
      // sembrerebbero enormi e si accatasterebbero già in sei.
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      const scale = seat === me || !coarse
        ? Math.min(1, surfaceScale() * 1.3)
        : surfaceScale();
      const tileW = TILE_W * scale;
      // Su touch la targhetta avversaria sta nel flusso e ruba larghezza.
      const room = host.clientWidth - 32 - (coarse && seat !== me ? tag.offsetWidth + 14 : 0);
      const overlap = wanted.length > 1 && wanted.length * (tileW + 10) > room
        ? Math.min(0, (room - tileW) / (wanted.length - 1) - tileW - 10)
        : 0;
      wanted.forEach((tile, index) => {
        tile.style.marginLeft = index === 0 ? "0" : `${Math.round(overlap)}px`;
      });
      // La pesca si vede: le carte NUOVE della mano entrano dal bordo del
      // cassetto, in cascata (delay per ordine d'arrivo). Il segno si mette
      // prima dell'aggancio e cade a fine corsa — e la mano si riaggancia
      // al DOM solo se è davvero cambiata, sennò ogni render qualunque
      // (un dado, una mossa altrui) farebbe ripartire l'animazione.
      let entrance = 0;
      for (const tile of wanted) {
        if (tile.parentElement === host) continue;
        const delay = entrance * DRAW_STEP_MS;
        tile.classList.add("is-drawn");
        tile.style.animationDelay = `${delay}ms`;
        entrance += 1;
        // Un timer, non animationend: gli eventi dei figli risalgono e un
        // listener `once` se li berrebbe. 70ms di margine sulla corsa.
        window.setTimeout(() => {
          tile.classList.remove("is-drawn");
          tile.style.animationDelay = "";
        }, DRAW_RUN_MS + 70 + delay);
      }
      const settled =
        host.children.length === wanted.length + 1 &&
        wanted.every((tile, index) => host.children[index + 1] === tile);
      if (!settled) host.replaceChildren(tag, ...wanted);
    }

    for (const [uid, tile] of tiles) {
      if (alive.has(uid)) continue;
      tile.remove();
      tiles.delete(uid);
    }
    paintArrows();
    fitPending(document.body);
  }

  return {
    render,
    refreshLayout() {
      applySurfaceSize();
      buildStaticZones();
      fitScale();
      render();
    },
    onBrowse(handler) {
      browse = handler;
    },
  };
}

export type { GameState };
