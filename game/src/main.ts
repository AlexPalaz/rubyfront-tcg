// Il gioco di Rubyfront in PixiJS (migrazione del 2026-09-11): il client
// nuovo accanto al simulatore, che resta come termine di confronto. Regole,
// engine e dati non si toccano; la logica del client arriva da core/.
//
// L'indirizzo decide cosa si apre: niente, il gioco con le sue schermate
// (F6: la home, la partita col bot, le stanze); ?match=bot, la partita
// col bot subito (i banchi di prova); ?table=sample, il tavolo di prova del
// confronto col simulatore (F3); ?gallery, le carte dipinte (F2).

import "@fontsource-variable/space-grotesk";
import { cardStats, useCatalog, type CatalogCard, type CatalogDeck } from "@rubyfront/core/cards";
import type { Ctx } from "@rubyfront/core/ctx";
import { setLang, t } from "@rubyfront/core/i18n";
import { playSpot, replay, seatLabel, zoneCards } from "@rubyfront/core/state";
import { Container, Graphics, Text } from "pixi.js";
import { CARDS_BASE } from "./card/resources";
import { mountDebug } from "./debug.js";
import { mountGallery } from "./gallery";
import { startGame } from "./game";
import { matchAgainstBot, store, type Match } from "./match";
import { DESIGN_W, createStage } from "./stage.js";
import { Preview } from "./table/preview";
import { Arrows } from "./table/arrows";
import { DECK_A, DECK_B, sampleGame } from "./table/sample-game";
import { Table } from "./table/table";
import { PileViewer } from "./table/pile-viewer";
import { Flights } from "./table/flights";

const RUBY = 0xd24a64;
const SANS = '"Space Grotesk Variable", ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// Tutto dentro una funzione, senza await al primo livello: nella build Pixi
// carica i suoi pezzi con import() dinamici, e quei pezzi importano dal pezzo
// d'ingresso — se l'ingresso aspettasse Pixi al primo livello, ciascuno
// aspetterebbe l'altro per sempre (in sviluppo non si vede: i moduli sono
// sciolti). Il sito (/next) e il desktop restavano fermi sul fondo.
async function boot(): Promise<void> {
  const stage = await createStage(document.body);
  // Un testo dipinto prima che il font sia pronto resta nel ripiego.
  await Promise.all([
    document.fonts.load(`700 96px "Space Grotesk Variable"`),
    document.fonts.load(`600 16px "Space Grotesk Variable"`),
    document.fonts.load(`400 16px "Space Grotesk Variable"`),
  ]);
  mountDebug(stage);

  const params = new URLSearchParams(location.search);
  // La lingua del tavolo e delle carte: ?lang=, poi quella salvata, poi
  // l'italiano (la lingua del manuale). Si fissa prima di ogni vista.
  const locale = (params.get("lang") ?? store.read("lang", "it")) === "en" ? "en" : "it";
  setLang(locale);
  document.documentElement.lang = locale;

  async function loadCatalog(): Promise<void> {
    const catalog = (await fetch(new URL("catalog.json", CARDS_BASE)).then(response => response.json())) as { cards: CatalogCard[]; decks?: CatalogDeck[] };
    useCatalog(catalog);
  }

  if (params.get("table") === "sample") {
    // Il tavolo sulla partita di prova (F3): la lista di azioni che il
    // confronto col simulatore (scripts/table-side-by-side.mjs) usa.
    await loadCatalog();
    // &catena: la catena di risposta aperta; &pannello: le pile avversarie aperte; &sfoglia: la tua Abisso nella vetrina.
    const actions = sampleGame({ chain: params.has("chain"), block: params.has("block") });
    const seat = params.get("seat") === "b" ? "b" : "a";
    const table = new Table(stage, seat, locale);
    new Preview(stage, table, locale);
    const state = replay(actions.map(action => ({ action })));
    if (params.has("panel")) table.openPanel(true);
    table.show(state);
    // Le frecce del combattimento, e (con &resa) i voli e i colpi da provocare dalla console.
    const arrows = new Arrows(stage, table);
    arrows.update(state);
    const flights = new Flights(stage, table, { state: () => state } as Ctx);
    stage.onLayout(() => table.show(state));
    await table.ready();
    if (params.has("browse")) {
      const pileViewer = new PileViewer(stage, locale);
      void pileViewer.browse(t("overlay.title", { zone: t("zone.abisso"), name: seatLabel(state, seat, seat) }), zoneCards(state, seat, "abisso"));
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    if (window.__rubyfront && params.has("resolution")) {
      window.__rubyfront.resolution = {
        fly() {
          const attack = state.declarations.find(d => d.kind === "attack");
          const block = state.declarations.find(d => d.kind === "block");
          if (attack) flights.toPile(attack.from, "abisso", { slain: true })?.();
          if (block) flights.clash(block.from, "parry");
          if (attack) table.strike(attack.to, 1600);
        },
      };
    }
    if (window.__rubyfront) {
      window.__rubyfront.actions = actions;
      window.__rubyfront.tableReady = true;
    }
  } else if (params.get("match") === "bot") {
    // La partita contro il bot subito (F4), senza home: i banchi di prova.
    await loadCatalog();
    const match = matchAgainstBot(stage, { seat: "a", locale, deck: DECK_A, botDeck: DECK_B });
    if (window.__rubyfront) window.__rubyfront.match = match;
  } else if (params.has("gallery")) {
    // La galleria delle carte dipinte (F2), col marchio in cima.
    const brand = new Container({ label: "brand" });
    const name = new Text({
      label: "brand-name",
      text: "RUBYFRONT",
      style: { fontFamily: SANS, fontWeight: "700", fontSize: 96, letterSpacing: 96 * 0.12, fill: RUBY, dropShadow: { color: RUBY, alpha: 0.6, blur: 16, distance: 0 } },
    });
    name.anchor.set(0.5);
    const gem = new Graphics({ label: "brand-gem" }).rect(-18, -18, 36, 36).fill(0x9e0f34).stroke({ width: 2, color: 0xe56a86 });
    gem.rotation = Math.PI / 4;
    gem.position.set(0, -110);
    brand.addChild(gem, name);
    brand.position.set(DESIGN_W / 2, 110);
    brand.scale.set(0.6);
    stage.world.addChild(brand);
    // Il testo si rasterizza alla risoluzione dello schermo, non a quella di progetto.
    stage.onLayout(visible => (name.resolution = stage.app.renderer.resolution * visible.scale));
    await mountGallery(stage, locale);
  } else {
    // Il gioco: la home, le partite, le stanze (F6).
    await loadCatalog();
    const game = startGame(stage, locale);
    if (window.__rubyfront) {
      window.__rubyfront.match = game.match;
      window.__rubyfront.screens = game.screens;
      // In sviluppo, per le prove da fuori (la partita incrociata col simulatore, F7):
      // i gesti del bot per questo posto, come __rbf.table nel simulatore. In produzione non esiste.
      if (import.meta.env.DEV) window.__rubyfront.testHooks = createTestHooks(game.match);
    }
  }
}

void boot();

/** Gli attrezzi delle prove da fuori: una Entità dalla mano, gli attacchi, le scelte automatiche. */
function createTestHooks(match: Match): NonNullable<NonNullable<typeof window.__rubyfront>["testHooks"]> {
  const { session, gestures } = match;
  const me = session.ctx.seat();
  return {
    /** La prima Entità della mano che si può pagare scende sul Fronte: torna il suo uid, o null. */
    async play() {
      const state = session.state();
      for (const card of zoneCards(state, me, "hand")) {
        if (cardStats(card.cardId).kind !== "entity" || gestures.unaffordable(card)) continue;
        return (await gestures.playFromHand(card, playSpot(state, me, "entity"))) ? card.uid : null;
      }
      return null;
    },
    /** Attaccano le carte date, se sono in campo, tue e stappate. */
    async attack(uids: string[]) {
      let n = 0;
      for (const uid of uids) {
        const card = session.state().cards[uid];
        if (!card || card.owner !== me || card.zone !== "field" || card.tapped) continue;
        await gestures.attackWith(card);
        n += 1;
      }
      return n;
    },
    /** Mira e scelte da pila per questo posto rispondono da sole (la prima carta), come per il bot. */
    autopilot() {
      gestures.setAuto(me, { pickTarget: (_source, candidates) => candidates[0] ?? null, pickFromPile: (_zone, candidates) => candidates[0] ?? null });
    },
  };
}
