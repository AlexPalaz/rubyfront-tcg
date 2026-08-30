// Il tavolo: la lavagna, le pile, le due mani.
//
// Il disegno è "riconciliato", non ricostruito: ogni carta ha un solo elemento
// DOM, che viene spostato da una zona all'altra. Ricrearlo a ogni cambio di
// stato significherebbe rilanciare il renderer e `fitTextBoxes` su decine di
// carte a ogni mossa — e vedere la mano sfarfallare a ogni tiro di dado.

import { createArrowLayer, drawArrows, type Arrow } from "./arrows.js";
import { createCardEl, fitPending, syncCardEl, wirePreview } from "./cardview.js";
import { tapPreview } from "./preview.js";
import {
  FRONT_SLOT_X,
  FRONT_W,
  FRONT_X,
  HALF_H,
  MATTER_X,
  RUBYFRONT_X,
  SLOT_X,
  SURFACE_H,
  SURFACE_W,
  backRowY,
  frontRowY,
  fromView,
  toView,
  viewBandTop,
  type Ctx,
} from "./ctx.js";
import { enableDrag, type Drop } from "./drag.js";
import { openMenu, type MenuItem } from "./menu.js";
import { TILE_H, TILE_W, faceCount, faceKind, isRubyfront } from "./renderer.js";
import {
  declarationOf,
  fieldCards,
  freeFrontSlot,
  nextWaveOrder,
  seatLabel,
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

export interface TableView {
  render(): void;
  /** Callback per aprire la ricerca: la fornisce main.ts. */
  onBrowse(handler: (seat: Seat, zone: ZoneId) => void): void;
}

export function mountTable(root: HTMLElement, ctx: Ctx): TableView {
  const tiles = new Map<string, HTMLElement>();
  let browse: (seat: Seat, zone: ZoneId) => void = () => {};
  /** Uid della carta in trascinamento: non va riposizionata dal render. */
  let dragging: string | null = null;
  /**
   * Dichiarazione di blocco in corso: si è scelto l'attaccante e si sta
   * scegliendo con chi bloccarlo. `pointer` è la punta della freccia in volo.
   */
  let targeting: { attacker: string; kind: "block" | "counter"; pointer: { x: number; y: number } | null } | null = null;

  const surface = document.createElement("div");
  surface.className = "surface";
  surface.dataset.drop = "field";
  surface.style.width = `${SURFACE_W}px`;
  surface.style.height = `${SURFACE_H}px`;
  // Il transform di scala (style.css) non riduce l'ingombro nello scroll: lo
  // pareggiano questi margini, che tolgono esattamente la parte non disegnata.
  surface.style.marginRight = `calc(${SURFACE_W}px * (var(--card-scale) - 1))`;
  surface.style.marginBottom = `calc(${SURFACE_H}px * (var(--card-scale) - 1))`;

  // Le frecce stanno sopra le carte: una punta nascosta sotto una tessera non
  // direbbe niente. Lo strato è inerte al puntatore.
  const arrowLayer = createArrowLayer(SURFACE_W, SURFACE_H);
  surface.append(arrowLayer);

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
  handToggle.textContent = "Mano";

  function setHandCollapsed(collapsed: boolean): void {
    myHand.classList.toggle("is-collapsed", collapsed);
    handToggle.classList.toggle("is-off", collapsed);
  }
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
    const scale = Math.min(1, board.clientWidth / SURFACE_W);
    // Su html, non su body: le variabili derivate (--hand-scale, --hand-h)
    // sono definite in :root e si risolvono LÌ — un override sul body non le
    // raggiungerebbe, e il cassetto resterebbe ad altezza piena.
    document.documentElement.style.setProperty("--card-scale", String(Math.round(scale * 1000) / 1000));
  }
  fitScale();
  new ResizeObserver(fitScale).observe(board);

  /** Da coordinata condivisa a coordinata di schermo, per questo giocatore. */
  const view = (y: number): number => toView(y, ctx.seat());
  /** E il viaggio di ritorno, per il punto in cui una carta viene lasciata. */
  const unview = (y: number): number => fromView(y, ctx.seat());

  const pileSlots = new Map<string, HTMLElement>();
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
      band.style.height = `${HALF_H}px`;
      const name = document.createElement("span");
      name.className = "half-name";
      name.dataset.seatName = seat;
      band.append(name);
      surface.append(band);

      for (const pile of PILES) {
        const slot = document.createElement("div");
        slot.className = "slot pile";
        slot.dataset.drop = pile.zone;
        slot.dataset.seat = seat;
        slot.style.left = `${pile.x}px`;
        slot.style.top = `${view(back)}px`;
        slot.style.width = `${TILE_W}px`;
        slot.style.height = `${TILE_H}px`;

        const label = document.createElement("span");
        label.className = "slot-label";
        slot.append(label);
        slot.dataset.label = pile.label;

        slot.addEventListener("contextmenu", event => {
          event.preventDefault();
          openMenu(event.clientX, event.clientY, pileMenu(seat, pile.zone));
        });
        slot.addEventListener("dblclick", () => {
          if (pile.zone === "deck" && seat === ctx.seat()) draw(seat, 1);
          else browse(seat, pile.zone);
        });

        surface.append(slot);
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
        slot.style.height = `${TILE_H}px`;
        if (label) slot.dataset.label = label;
        surface.append(slot);
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
      frontLabel.style.top = `${view(front) + TILE_H + 4}px`;
      surface.append(frontLabel);

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

  function declareAttack(card: CardInstance): void {
    const foe = otherSeat(card.owner);
    const target = rubyfrontOf(foe);
    if (!target) {
      ctx.log(`${seatLabel(ctx.state(), foe)} non ha il Rubyfront in campo: nessun bersaglio.`, foe);
      return;
    }
    const order = nextWaveOrder(ctx.state(), card.owner);
    ctx.dispatch({
      t: "declare",
      declaration: {
        id: crypto.randomUUID(),
        from: card.uid,
        to: target.uid,
        kind: "attack",
        seat: card.owner,
        order,
      },
    });
    // Il tap scatta alla dichiarazione dell'ondata (§6.3). Resta comunque
    // libero: stapparla a mano non disfa la freccia.
    if (!card.tapped) ctx.dispatch({ t: "tap", uid: card.uid, tapped: true });
    ctx.log(`${seatLabel(ctx.state(), card.owner)} attacca (${order}).`, card.owner);
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
    ctx.dispatch({
      t: "declare",
      declaration: {
        id: crypto.randomUUID(),
        from: blocker.uid,
        to: attacker,
        kind,
        seat: blocker.owner,
        order: 0,
      },
    });
    // Chi contrattacca si copre, e quella copertura dura un giro intero (§6.3):
    // vale la pena farla scattare da sola.
    //
    // Chi blocca invece NON si tappa da solo. Il manuale dice che si tappa, ma
    // è un tap che non costa niente — arriva nel turno avversario e si stappa
    // subito dopo, «segna solo che ha già bloccato in quel turno di difesa»
    // (§6.3). Quel segno lo dà già la freccia. Tapparlo aggiungeva solo una
    // carta coricata da raddrizzare a mano.
    if (kind === "counter" && !blocker.facedown) {
      ctx.dispatch({ t: "facedown", uid: blocker.uid, facedown: true });
    }
    ctx.log(
      `${seatLabel(ctx.state(), blocker.owner)} ${kind === "counter" ? "contrattacca" : "blocca"}.`,
      blocker.owner
    );
  }

  function pileMenu(seat: Seat, zone: ZoneId): MenuItem[] {
    const mine = seat === ctx.seat();
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
    const mine = card.owner === ctx.seat();
    const declared = declarationOf(ctx.state(), card.uid);

    // Il combattimento sta in cima al menu: è quello che si cerca in Fase di
    // Fronte. Tappa/Stappa resta subito sotto e sempre disponibile.
    if (card.zone === "field") {
      if (mine) {
        if (declared?.kind === "attack") {
          items.push({
            label: `Annulla attacco (${declared.order})`,
            run: () => ctx.dispatch({ t: "undeclare", from: card.uid }),
          });
        } else if (declared) {
          items.push({
            label: declared.kind === "counter" ? "Annulla contrattacco" : "Annulla blocco",
            run: () => ctx.dispatch({ t: "undeclare", from: card.uid }),
          });
        } else {
          items.push({ label: "Attacca", run: () => declareAttack(card) });
        }
      } else if (declared?.kind === "attack") {
        // Si blocca un attaccante avversario: si sceglie lui, poi con chi.
        items.push({ label: "Blocca con…", run: () => startTargeting(card, "block") });
        items.push({ label: "Contrattacca con…", run: () => startTargeting(card, "counter") });
      }
      if (items.length) items.push({ rule: true, label: "" });
    }

    if (card.zone === "field") {
      items.push({
        label: card.tapped ? "Stappa" : "Tappa",
        run: () => ctx.dispatch({ t: "tap", uid: card.uid, tapped: !card.tapped }),
      });
      items.push({
        label: card.facedown ? "Scopri" : "Copri",
        run: () => ctx.dispatch({ t: "facedown", uid: card.uid, facedown: !card.facedown }),
      });
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
  function dropZ(card: CardInstance, x: number, y: number): number {
    const state = ctx.state();
    const top = state.zTop + 1;
    if (faceKind(card.cardId, card.face) !== "object") return top;
    const touched = fieldCards(state).filter(
      other =>
        other.uid !== card.uid &&
        Math.abs(other.x - x) < TILE_W &&
        Math.abs(other.y - y) < TILE_H
    );
    // Va dietro solo se sotto c'è un'Entità: l'Oggetto posato sul vuoto (o su
    // altre carte qualsiasi) resta una carta come le altre.
    if (!touched.some(other => faceKind(other.cardId, other.face) === "entity")) return top;
    const pile = touched.filter(other => {
      const kind = faceKind(other.cardId, other.face);
      return kind === "entity" || kind === "object";
    });
    // Il -9 tiene lo z-index del DOM sopra lo zero (il disegno somma 10):
    // più giù, la carta finirebbe sotto il tappeto.
    return Math.max(-9, Math.min(...pile.map(other => other.z)) - 1);
  }

  function applyDrop(card: CardInstance, drop: Drop): void {
    if (!drop) return;
    if (drop.kind === "field") {
      // Il rilascio a mano libera arriva in coordinate di schermo: va riportato
      // in canoniche prima di finire nello stato, o al posto B ogni carta
      // comparirebbe nella metà sbagliata. L'aggancio no: i riquadri portano
      // già con sé la coordinata canonica.
      const free = { x: drop.x, y: unview(drop.y) };
      const spot = drop.snapped ? stackAt(ctx.state(), drop.x, drop.y, card.uid) : free;
      const x = Math.max(0, Math.min(SURFACE_W - TILE_W, spot.x));
      const y = Math.max(0, Math.min(SURFACE_H - TILE_H, spot.y));
      const z = dropZ(card, x, y);
      if (card.zone === "field") ctx.dispatch({ t: "move", uid: card.uid, x, y, z });
      else ctx.dispatch({ t: "toZone", uid: card.uid, zone: "field", x, y, z });
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
          // La mano avversaria è nascosta (§5): non si tocca.
          return !(live.zone === "hand" && live.owner !== ctx.seat());
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
        onDrop: drop => {
          dragging = null;
          const live = ctx.state().cards[card.uid];
          if (live) applyDrop(live, drop);
          render();
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
        // Solo le proprie carte in campo: le altre non bloccano niente.
        if (live && live.zone === "field" && live.owner === ctx.seat() && live.uid !== targeting.attacker) {
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
          ctx.dispatch({ t: "tap", uid: live.uid, tapped: !live.tapped });
        } else if (live.zone === "hand" && live.owner === ctx.seat()) {
          const spot = freeFrontSlot(ctx.state(), live.owner);
          ctx.dispatch({ t: "toZone", uid: live.uid, zone: "field", ...spot, z: ctx.state().zTop + 1 });
        }
      });
    }
    syncCardEl(tile, card, { back, theme: ctx.themeFor(card.owner), locale: ctx.locale() });
    return tile;
  }

  /** Rettangolo di una carta in coordinate della superficie. */
  function boxOf(card: CardInstance): Arrow["from"] {
    return { x: card.x, y: view(card.y), w: TILE_W, h: TILE_H };
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
        label.textContent = `${seatLabel(state, seat)}${seat === me ? " · tu" : ""}`;
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
          tile.style.position = "absolute";
          tile.style.zIndex = "1";
        }
      }
    }

    for (const card of fieldCards(state)) {
      alive.add(card.uid);
      const tile = tileFor(card, card.facedown);
      markCombat(tile, card);
      // In modo bersaglio: le proprie carte in campo sono scegliibili, e fra
      // queste si accendono quelle che le regole permetterebbero. Le altre si
      // smorzano soltanto — restano cliccabili.
      const pickable = Boolean(targeting) && card.owner === ctx.seat() && card.uid !== targeting?.attacker;
      tile.classList.toggle("is-pickable", pickable);
      tile.classList.toggle("is-legal", pickable && looksPlayable(card));
      if (tile.parentElement !== surface) surface.append(tile);
      if (card.uid !== dragging) {
        tile.style.position = "absolute";
        tile.style.left = `${card.x}px`;
        tile.style.top = `${view(card.y)}px`;
      }
      tile.style.zIndex = String(10 + card.z);
    }

    for (const [seat, host, tag] of [[me, myHand, myTag], [foe, oppHand, oppTag]] as const) {
      host.dataset.seat = seat;
      // `data-drop=""` sarebbe comunque selezionato da [data-drop]: la mano
      // avversaria non deve avere l'attributo del tutto.
      if (seat === me) host.dataset.drop = "hand";
      else delete host.dataset.drop;
      const cards = zoneCards(state, seat, "hand");
      tag.textContent = seat === me ? `La tua mano · ${cards.length}` : `Mano di ${seatLabel(state, seat)} · ${cards.length}`;
      host.classList.toggle("is-empty", cards.length === 0);
      const wanted: HTMLElement[] = [];
      for (const card of cards) {
        alive.add(card.uid);
        const tile = tileFor(card, seat !== me);
        tile.style.position = "relative";
        tile.style.left = "";
        tile.style.top = "";
        tile.style.zIndex = "";
        wanted.push(tile);
      }
      // Le carte in mano si sovrappongono quando sono troppe: restano
      // 302×424, si stringono soltanto le une sulle altre.
      const room = host.clientWidth - 32;
      const overlap = wanted.length > 1 && wanted.length * (TILE_W + 10) > room
        ? Math.min(0, (room - TILE_W) / (wanted.length - 1) - TILE_W - 10)
        : 0;
      wanted.forEach((tile, index) => {
        tile.style.marginLeft = index === 0 ? "0" : `${Math.round(overlap)}px`;
      });
      host.replaceChildren(tag, ...wanted);
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
    onBrowse(handler) {
      browse = handler;
    },
  };
}

export type { GameState };
