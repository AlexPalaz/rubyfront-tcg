// I mazzi, per chi gioca.
//
// La vista che si apre dalla carta «Mazzi» della home: i mazzi pronti del
// gioco, uno per stampa — il Rubyfront in copertina disegnato dal renderer
// vero, il nome, la composizione — con due gesti: giocarci subito contro il bot, o sfogliarne le carte. Le carte si
// sfogliano a tessera (302×424, come al tavolo) e si leggono
// nell'ingrandimento al passaggio. Non è il catalogo del sito (/catalog,
// strumento di lavoro del team): qui non ci sono id, stati, note di design.

import { lang, t } from "./i18n.js";
import { armPreview, disarmPreview, tapPreview } from "./preview.js";
import {
  CARD_H,
  CARD_W,
  TILE_H,
  TILE_SCALE,
  TILE_W,
  allDecks,
  cardStats,
  defaultTheme,
  faceCount,
  fitTexts,
  isRubyfront,
  renderFace,
  type CatalogDeck,
} from "./renderer.js";

export interface Mazzi {
  open(): void;
  close(): void;
}

/** L'ordine con cui si sfogliano le carte: prima il Rubyfront, poi Entità,
    Materie, Oggetti, dentro ogni gruppo per costo crescente. */
const KIND_ORDER: Record<string, number> = { rubyfront: 0, entity: 1, matter: 2, object: 3 };

export function mountMazzi(host: HTMLElement, onPlay: (deckId: string) => void, onClose: () => void): Mazzi {
  host.innerHTML = "";

  const bar = document.createElement("div");
  bar.className = "mazzi-bar";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "mazzi-back";
  back.textContent = t("mazzi.back");
  back.addEventListener("click", () => {
    close();
    onClose();
  });
  const title = document.createElement("h2");
  title.className = "mazzi-title";
  title.textContent = t("mazzi.title");
  const lead = document.createElement("p");
  lead.className = "mazzi-lead";
  lead.textContent = t("mazzi.lead");
  bar.append(back, title, lead);

  const shelf = document.createElement("div");
  shelf.className = "mazzi-shelf";
  host.append(bar, shelf);

  let built = false;

  function build(): void {
    if (built) return;
    built = true;
    for (const deck of allDecks()) shelf.append(deckPrint(deck));
    fitTexts(shelf);
  }

  function deckPrint(deck: CatalogDeck): HTMLElement {
    const locale = lang();
    const words = deck.locales[locale] ?? deck.locales[deck.defaultLocale];
    const theme = deck.theme ?? defaultTheme();
    const rubyfront = deck.cards.find(entry => isRubyfront(entry.card))?.card ?? null;

    const print = document.createElement("article");
    print.className = "mazzi-print";

    // La copertina: il Rubyfront del mazzo, disegnato a misura vera e scalato.
    const cover = document.createElement("div");
    cover.className = "mazzi-cover";
    if (rubyfront) cover.append(tile(rubyfront, 0, theme, locale, 0));

    const body = document.createElement("div");
    body.className = "mazzi-body";
    const name = document.createElement("h3");
    name.className = "mazzi-name";
    name.textContent = words?.name ?? deck.id;
    const facts = document.createElement("p");
    facts.className = "mazzi-facts";
    facts.textContent = composition(deck);

    const actions = document.createElement("div");
    actions.className = "mazzi-actions";
    const play = document.createElement("button");
    play.type = "button";
    play.className = "mazzi-play";
    play.textContent = t("mazzi.play");
    play.addEventListener("click", () => onPlay(deck.id));
    const browse = document.createElement("button");
    browse.type = "button";
    browse.className = "mazzi-browse";
    browse.textContent = t("mazzi.browse");
    actions.append(play, browse);
    // Niente presentazione del mazzo (tolta su richiesta, 2026-09-09): il
    // nome, la composizione e i gesti bastano; le carte parlano da sé.
    body.append(name, facts, actions);

    // Le carte, chiuse finché non si chiede di sfogliarle: quaranta tessere
    // per mazzo si disegnano solo se servono.
    const cards = document.createElement("div");
    cards.className = "mazzi-cards";
    cards.hidden = true;
    let drawn = false;
    browse.addEventListener("click", () => {
      const opening = cards.hidden;
      cards.hidden = !opening;
      if (opening && !drawn) {
        drawn = true;
        for (const entry of sortedCards(deck)) {
          const faces = faceCount(entry.card);
          for (let face = 0; face < faces; face += 1) cards.append(tile(entry.card, face, theme, locale, face === 0 ? entry.count : 0));
        }
        // A carte visibili: il fit dei testi misura, e nascosto misura zero.
        fitTexts(cards);
      }
      browse.textContent = t(opening ? "mazzi.browse.close" : "mazzi.browse");
      print.classList.toggle("is-open", opening);
      if (opening) print.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    print.append(cover, body, cards);
    return print;
  }

  /** Una tessera: la carta a misura vera dentro uno scalatore, la quantità
      di copie all'angolo, l'ingrandimento al passaggio (o al tocco). */
  function tile(cardId: string, face: number, theme: string, locale: string, copies: number): HTMLElement {
    const box = document.createElement("div");
    box.className = "mazzi-tile";
    box.style.width = `${TILE_W}px`;
    box.style.height = `${TILE_H}px`;
    const scaler = document.createElement("div");
    scaler.className = "mazzi-scaler";
    scaler.style.width = `${CARD_W}px`;
    scaler.style.height = `${CARD_H}px`;
    scaler.style.transform = `scale(${TILE_SCALE})`;
    const drawn = renderFace(cardId, face, theme, locale);
    if (drawn) scaler.append(drawn);
    box.append(scaler);
    if (copies > 1) {
      const badge = document.createElement("span");
      badge.className = "mazzi-copies";
      badge.textContent = `×${copies}`;
      box.append(badge);
    }
    box.addEventListener("pointerenter", event => {
      if (event.pointerType === "touch") return;
      armPreview(box, cardId, face, theme, locale);
    });
    box.addEventListener("pointerleave", event => {
      if (event.pointerType === "touch") return;
      disarmPreview();
    });
    box.addEventListener("click", event => {
      if ((event as PointerEvent).pointerType === "touch" || (event as PointerEvent).pointerType === "") tapPreview(box, cardId, face, theme, locale);
    });
    return box;
  }

  function sortedCards(deck: CatalogDeck): CatalogDeck["cards"] {
    return [...deck.cards].sort((a, b) => {
      const sa = cardStats(a.card);
      const sb = cardStats(b.card);
      const ka = KIND_ORDER[sa.kind ?? ""] ?? 9;
      const kb = KIND_ORDER[sb.kind ?? ""] ?? 9;
      if (ka !== kb) return ka - kb;
      return (sa.fluxCost ?? 0) - (sb.fluxCost ?? 0) || a.card.localeCompare(b.card);
    });
  }

  /** «40 carte · 22 Entità · 14 Materie · 4 Oggetti», senza il Rubyfront. */
  function composition(deck: CatalogDeck): string {
    const counts = { entity: 0, matter: 0, object: 0 };
    let total = 0;
    for (const entry of deck.cards) {
      const kind = cardStats(entry.card).kind;
      if (kind === "entity" || kind === "matter" || kind === "object") {
        counts[kind] += entry.count;
        total += entry.count;
      }
    }
    return t("mazzi.facts", { total, entity: counts.entity, matter: counts.matter, object: counts.object });
  }

  function open(): void {
    // Prima si mostra, poi si disegna: il fit dei testi misura le carte, e
    // una carta nascosta misura zero.
    host.hidden = false;
    build();
    host.scrollTop = 0;
  }
  function close(): void {
    host.hidden = true;
    disarmPreview();
  }

  return { open, close };
}
