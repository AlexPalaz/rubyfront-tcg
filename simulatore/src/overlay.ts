// Cerca carta e sfoglia pile.
//
// Serve a due cose che al tavolo vero si fanno a mano: prendere una carta
// precisa dal mazzo (il "cerca" chiesto da mille effetti) e guardare cosa c'è
// nell'Abisso o in Zona di Ritiro, che sono pubblici (§5). Le carte restano
// 302×424 come ovunque, e il passaggio del mouse le ingrandisce.

import { createCardEl, fitPending, syncCardEl, wirePreview } from "./cardview.js";
import type { Ctx } from "./ctx.js";
import { openMenu } from "./menu.js";
import { allCards, cardSearchText, faceKind, isRubyfront } from "./renderer.js";
import { playSpot, seatLabel, shuffled, zoneCards } from "./state.js";
import type { CardInstance, Seat, ZoneId } from "./types.js";

const TITLES: Record<string, string> = {
  deck: "Cerca nel mazzo",
  abisso: "Abisso",
  ritiro: "Zona di Ritiro",
};

export interface Overlay {
  open(seat: Seat, zone: ZoneId): void;
  /** STRUMENTO DI PROVA, temporaneo: il catalogo intero, un click evoca la
      carta in mano a `seat`. */
  openCatalog(seat: Seat): void;
  /** La scelta per un effetto (§8.2): fra `candidates` di quella pila, un
      click sceglie; Chiudi o Esc rinunciano (null). */
  pick(seat: Seat, zone: ZoneId, candidates: CardInstance[], title: string, visible?: CardInstance[]): Promise<CardInstance | null>;
  close(): void;
}

export function mountOverlay(ctx: Ctx, afterChange: () => void): Overlay {
  const host = document.createElement("div");
  host.className = "overlay";
  host.hidden = true;

  const panel = document.createElement("div");
  panel.className = "overlay-panel";

  const head = document.createElement("header");
  const title = document.createElement("h2");
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Filtra per nome o testo…";
  search.className = "overlay-search";

  const shuffleAfter = document.createElement("label");
  shuffleAfter.className = "overlay-check";
  const shuffleBox = document.createElement("input");
  shuffleBox.type = "checkbox";
  shuffleBox.checked = true;
  shuffleAfter.append(shuffleBox, document.createTextNode(" mescola alla chiusura"));

  const close = document.createElement("button");
  close.type = "button";
  close.className = "overlay-close";
  close.textContent = "Chiudi";

  head.append(title, search, shuffleAfter, close);

  const grid = document.createElement("div");
  grid.className = "overlay-grid";

  const empty = document.createElement("p");
  empty.className = "overlay-empty";
  empty.textContent = "Nessuna carta.";

  panel.append(head, grid, empty);
  host.append(panel);
  document.body.append(host);

  let currentSeat: Seat = "a";
  let currentZone: ZoneId = "deck";
  /** Modalità catalogo (strumento di prova): si evoca, non si sposta. */
  let catalogMode = false;
  /** Modalità scelta (un effetto): i candidati, il titolo, e a chi dirlo. */
  let picking: { candidates: CardInstance[]; visible: CardInstance[]; title: string; done: (card: CardInstance | null) => void } | null = null;
  /** True se in questa sessione di ricerca si è presa almeno una carta. */
  let touched = false;

  function paint(): void {
    const state = ctx.state();
    const filter = search.value.trim().toLowerCase();
    const matches = (cardId: string): boolean => filter === "" || cardSearchText(cardId, ctx.locale()).includes(filter);
    if (catalogMode) {
      paintCatalog(matches);
      return;
    }
    if (picking) {
      paintPick(matches);
      return;
    }
    const cards = zoneCards(state, currentSeat, currentZone).filter(card => matches(card.cardId));
    title.textContent = `${TITLES[currentZone] ?? currentZone} · ${seatLabel(state, currentSeat)}`;
    empty.hidden = cards.length > 0;

    grid.replaceChildren();
    for (const card of cards) {
      const wrapper = document.createElement("div");
      wrapper.className = "overlay-item";
      const tile = createCardEl(card.uid);
      // Il mazzo è nascosto (§5) ma qui lo si sta guardando apposta: le carte
      // si vedono scoperte, altrimenti "cerca" non cercherebbe niente.
      syncCardEl(tile, card, { back: false, theme: ctx.themeFor(card.owner), locale: ctx.locale() });
      wirePreview(tile, ctx.locale);
      tile.addEventListener("click", () => {
        ctx.dispatch({ t: "toZone", uid: card.uid, zone: "hand" });
        touched = true;
        ctx.log(`${seatLabel(ctx.state(), currentSeat)} prende una carta da ${TITLES[currentZone] ?? currentZone}.`, currentSeat);
        paint();
        afterChange();
      });
      tile.addEventListener("contextmenu", event => {
        event.preventDefault();
        openMenu(event.clientX, event.clientY, [
          { label: "In mano", run: () => move(card.uid, "hand") },
          { label: "Sul Fronte", run: () => move(card.uid, "field") },
          { label: "Nell'Abisso", run: () => move(card.uid, "abisso"), disabled: currentZone === "abisso" },
          { label: "In Zona di Ritiro", run: () => move(card.uid, "ritiro"), disabled: currentZone === "ritiro" },
        ]);
      });
      wrapper.append(tile);
      grid.append(wrapper);
    }
    fitPending(grid);
  }

  /** La scelta per un effetto: solo i candidati, un click sceglie. */
  function paintPick(matches: (cardId: string) => boolean): void {
    const chosen = picking!;
    const cards = chosen.visible.filter(card => matches(card.cardId));
    const pickable = new Set(chosen.candidates.map(card => card.uid));
    title.textContent = chosen.title;
    empty.hidden = cards.length > 0;
    grid.replaceChildren();
    for (const card of cards) {
      const wrapper = document.createElement("div");
      wrapper.className = "overlay-item";
      const tile = createCardEl(card.uid);
      syncCardEl(tile, card, { back: false, theme: ctx.themeFor(card.owner), locale: ctx.locale() });
      wirePreview(tile, ctx.locale);
      // Si vede ma non si sceglie: velata, come la carta che non ci si può
      // permettere in mano.
      if (!pickable.has(card.uid)) {
        tile.classList.add("is-unaffordable");
        wrapper.append(tile);
        grid.append(wrapper);
        continue;
      }
      tile.addEventListener("click", () => {
        const done = chosen.done;
        picking = null;
        host.hidden = true;
        done(card);
      });
      wrapper.append(tile);
      grid.append(wrapper);
    }
    fitPending(grid);
  }

  /** Il catalogo intero (strumento di prova): un click evoca la carta in mano. */
  function paintCatalog(matches: (cardId: string) => boolean): void {
    const state = ctx.state();
    const entries = allCards().filter(entry => !isRubyfront(entry.id) && matches(entry.id));
    title.textContent = `Catalogo · evoca in mano a ${seatLabel(state, currentSeat)} (prova)`;
    empty.hidden = entries.length > 0;
    grid.replaceChildren();
    for (const entry of entries) {
      const wrapper = document.createElement("div");
      wrapper.className = "overlay-item";
      const ghost: CardInstance = {
        uid: `catalog:${entry.id}`,
        cardId: entry.id,
        owner: currentSeat,
        zone: "hand",
        face: 0,
        x: 0,
        y: 0,
        order: 0,
        tapped: false,
        facedown: false,
        z: 0,
      };
      const tile = createCardEl(ghost.uid);
      syncCardEl(tile, ghost, { back: false, theme: ctx.themeFor(currentSeat), locale: ctx.locale() });
      wirePreview(tile, ctx.locale);
      tile.addEventListener("click", () => {
        const card: CardInstance = { ...ghost, uid: crypto.randomUUID() };
        void ctx.dispatch({ t: "spawn", card });
        ctx.log(`${seatLabel(ctx.state(), currentSeat)} evoca in mano «${entry.id}» (prova).`, currentSeat);
        afterChange();
      });
      wrapper.append(tile);
      grid.append(wrapper);
    }
    fitPending(grid);
  }

  function move(uid: string, zone: ZoneId): void {
    if (zone === "field") {
      // Nel primo slot libero del Fronte del proprietario — o nella fila
      // delle Materie, se di Materia si tratta (§5) — non a un punto fisso
      // della lavagna.
      const live = ctx.state().cards[uid];
      const owner = live?.owner ?? currentSeat;
      const spot = playSpot(ctx.state(), owner, live ? faceKind(live.cardId, live.face) : null);
      ctx.dispatch({ t: "toZone", uid, zone, ...spot, z: ctx.state().zTop + 1 });
    } else {
      ctx.dispatch({ t: "toZone", uid, zone });
    }
    touched = true;
    paint();
    afterChange();
  }

  function hide(): void {
    host.hidden = true;
    if (picking) {
      // Chiudere senza scegliere è rinunciare.
      const done = picking.done;
      picking = null;
      done(null);
      return;
    }
    // Cercare nel mazzo lo rimescola: è la regola d'uso di ogni tutor, e
    // impedisce di memorizzare l'ordine visto durante la ricerca.
    if (!catalogMode && currentZone === "deck" && touched && shuffleBox.checked) {
      const order = shuffled(zoneCards(ctx.state(), currentSeat, "deck").map(card => card.uid));
      ctx.dispatch({ t: "shuffle", seat: currentSeat, order });
      ctx.log(`${seatLabel(ctx.state(), currentSeat)} rimescola dopo la ricerca.`, currentSeat);
      afterChange();
    }
    touched = false;
  }

  close.addEventListener("click", hide);
  host.addEventListener("pointerdown", event => {
    if (event.target === host) hide();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !host.hidden) hide();
  });
  search.addEventListener("input", paint);

  return {
    open(seat, zone) {
      currentSeat = seat;
      currentZone = zone;
      catalogMode = false;
      picking = null;
      touched = false;
      search.value = "";
      shuffleAfter.hidden = zone !== "deck";
      host.hidden = false;
      paint();
      search.focus();
    },
    pick(seat, zone, candidates, pickTitle, visible) {
      return new Promise(resolve => {
        currentSeat = seat;
        currentZone = zone;
        catalogMode = false;
        touched = false;
        picking = { candidates, visible: visible ?? candidates, title: pickTitle, done: resolve };
        search.value = "";
        shuffleAfter.hidden = true;
        host.hidden = false;
        paint();
        search.focus();
      });
    },
    openCatalog(seat) {
      currentSeat = seat;
      catalogMode = true;
      picking = null;
      touched = false;
      search.value = "";
      shuffleAfter.hidden = true;
      host.hidden = false;
      paint();
      search.focus();
    },
    close: hide,
  };
}
