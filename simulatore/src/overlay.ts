// Cerca carta e sfoglia pile.
//
// Serve a due cose che al tavolo vero si fanno a mano: prendere una carta
// precisa dal mazzo (il "cerca" chiesto da mille effetti) e guardare cosa c'è
// nell'Abisso o in Zona di Ritiro, che sono pubblici (§5). Le carte restano
// 302×424 come ovunque, e il passaggio del mouse le ingrandisce.

import { createCardEl, fitPending, syncCardEl, wirePreview } from "./cardview.js";
import type { Ctx } from "./ctx.js";
import { openMenu } from "./menu.js";
import { cardSearchText, faceKind } from "./renderer.js";
import { playSpot, seatLabel, shuffled, zoneCards } from "./state.js";
import type { Seat, ZoneId } from "./types.js";

const TITLES: Record<string, string> = {
  deck: "Cerca nel mazzo",
  abisso: "Abisso",
  ritiro: "Zona di Ritiro",
};

export interface Overlay {
  open(seat: Seat, zone: ZoneId): void;
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
  /** True se in questa sessione di ricerca si è presa almeno una carta. */
  let touched = false;

  function paint(): void {
    const state = ctx.state();
    const filter = search.value.trim().toLowerCase();
    const cards = zoneCards(state, currentSeat, currentZone).filter(card =>
      filter === "" ? true : cardSearchText(card.cardId, ctx.locale()).includes(filter)
    );
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
    // Cercare nel mazzo lo rimescola: è la regola d'uso di ogni tutor, e
    // impedisce di memorizzare l'ordine visto durante la ricerca.
    if (currentZone === "deck" && touched && shuffleBox.checked) {
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
      touched = false;
      search.value = "";
      shuffleAfter.hidden = zone !== "deck";
      host.hidden = false;
      paint();
      search.focus();
    },
    close: hide,
  };
}
