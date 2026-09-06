// Turno e fase, i gesti di partita e le targhe dei posti.
//
// L'HUD come pannello o barra non c'è più (2026-09-06): il tavolo è la
// cosa, e tutto il resto sta ai suoi bordi.
//
// - In HEADER, al centro (#game-bar): senza arbitro, strumenti di mazzo e
//   dadi (veste provvisoria: il tavolo senza arbitro se ne va). Il turno e
//   la fase li dice l'insegna sul tavolo (banner.ts), non l'header.
// - In HEADER, a destra (#game-tools): «Evoca» (strumento di prova), chat e
//   microfono.
// - Sul TAVOLO, in basso a destra (#table > .hud-actions): il gesto che
//   chiude la fase — con l'arbitro «Fine fase»; senza, Fronte e Fine turno.
// - Sul TAVOLO, sull'orlo di ciascun campo accanto alla targhetta del nome:
//   la TARGA del posto — Gettone Flusso e Flusso. Il nome lo dice già la
//   targhetta, i Punti Vita li dice il Rubyfront (cardview.ts, setTessHp);
//   la targa di chi è di turno si tinge. Le targhe le crea questo modulo e le appende table.ts
//   (.half-head, via onStats): dentro la lavagna scalata le misure passano
//   per --ui-inv (style.css) e restano a corpo fisso.

import { msg, t } from "./i18n.js";
import type { Ctx } from "./ctx.js";
import { phaseCloser, waveDeclared } from "./state.js";
import { declareFront, declareReaction, endPhase, endTurn } from "./turn.js";
import type { Phase, PlayerState, Seat } from "./types.js";

export interface Hud {
  render(): void;
  /** La targa di un posto (Gettone, PV, Flusso): la appende table.ts sull'orlo del campo. */
  chip(seat: Seat): HTMLElement;
}

/** Le mani che l'HUD stringe verso il resto dell'app. */
export interface HudHooks {
  /** Apre e chiude la colonna della chat. */
  chat(): void;
  /** Accende e spegne il microfono della chat vocale. */
  voice(): void;
  shuffle(): void;
  draw(): void;
  search(): void;
  /** STRUMENTO DI PROVA, temporaneo: evoca in mano una carta del catalogo. */
  spawn(): void;
}

/** Suggerimento del tasto: bolla CSS (data-tip) + aria-label. I title nativi
    sono lenti e su touch non compaiono affatto. */
function tip(element: HTMLElement, text: string): void {
  element.dataset.tip = text;
  element.setAttribute("aria-label", text);
}

const svgIcon = (paths: string): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** Il tasto della fase, con l'arbitro: dice quale fase chiude. */
const PHASE_END: Record<Phase, string> = {
  preparazione: "phase.end.preparazione",
  fronte: "phase.end.fronte",
  reazione: "phase.end.reazione",
};

/**
 * Le azioni di mazzo — mescola, pesca, cerca — sono gesti di partita, non
 * di impostazione: stanno accanto al turno. Senza arbitro soltanto.
 */
const TOOLS = [
  {
    key: "shuffle",
    label: "hud.shuffle",
    title: "hud.shuffle.tip",
    svg: svgIcon('<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/>'),
  },
  {
    key: "draw",
    label: "hud.draw",
    title: "hud.draw.tip",
    svg: svgIcon('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 8v6M9 11h6"/>'),
  },
  {
    key: "search",
    label: "hud.search",
    title: "hud.search.tip",
    svg: svgIcon('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  },
] as const;

/** Riga di una grandezza: −, il valore vestito come sulla carta, +. */
function statRow(
  kind: "hp" | "flux",
  title: string,
  read: () => number,
  write: (value: number) => void,
  options: { min?: number; max?: number } = {}
): { row: HTMLElement; sync: () => void } {
  const row = document.createElement("div");
  row.className = "hud-stat";
  row.dataset.kind = kind;
  row.title = title;

  // Il valore riprende il template della carta: il Flusso sta dentro il rombo
  // del costo (il Flusso È il costo), i PV in mono verde con il suffisso,
  // come nella barra del titolo. Classi hud-*: .cost e .hp sono di card.css.
  const head = document.createElement("span");
  head.className = kind === "flux" ? "hud-gem" : "hud-vita";

  const value = document.createElement("b");
  value.className = "hud-value";
  head.append(value);
  if (kind === "hp") {
    const suffix = document.createElement("small");
    suffix.textContent = t("hud.hp.unit");
    head.append(suffix);
  }

  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "hud-step";
  minus.textContent = "−";
  tip(minus, t("hud.step.less", { what: title }));

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "hud-step";
  plus.textContent = "+";
  tip(plus, t("hud.step.more", { what: title }));

  const clamp = (next: number): number =>
    Math.max(options.min ?? Number.NEGATIVE_INFINITY, Math.min(options.max ?? Number.POSITIVE_INFINITY, next));

  minus.addEventListener("click", () => write(clamp(read() - 1)));
  plus.addEventListener("click", () => write(clamp(read() + 1)));

  row.append(minus, head, plus);
  return { row, sync: () => (value.textContent = String(read())) };
}

export function mountHud(ctx: Ctx, hooks: HudHooks): Hud {
  const bar = document.querySelector<HTMLElement>("#game-bar")!;
  const toolsHost = document.querySelector<HTMLElement>("#game-tools")!;
  const syncs: (() => void)[] = [];

  /** La targa di un posto: Gettone, PV, Flusso. Niente nome: sta accanto. */
  function chip(seat: Seat, mine: boolean): HTMLElement {
    const box = document.createElement("section");
    box.className = `hud-chip ${mine ? "is-mine" : "is-foe"}`;
    box.dataset.seat = seat;

    const patch = (values: Partial<PlayerState>): void => {
      void ctx.dispatch({ t: "player", seat, patch: values });
    };

    // I Punti Vita NON stanno qui: si leggono sul Rubyfront (setTessHp in
    // cardview.ts), una volta sola. La targa dice Gettone e Flusso.
    // Niente tetto né pavimento cuciti nel bottone: il limite dei 20 e lo
    // zero (§3.2) sono regole dell'engine — acceso, 21 e −1 li ferma il
    // poliziotto con tanto di avviso; spento, il tavolo è libero come per
    // ogni altro gesto.
    const flux = statRow(
      "flux",
      t("hud.flux"),
      () => ctx.state().players[seat].flux,
      value => patch({ flux: value })
    );

    // Il Gettone Flusso (§3.2): la moneta sull'orlo della targa È il comando.
    // Spenta si assegna, d'oro si spende — 1 Flusso extra, fuori dai 20.
    const coin = document.createElement("button");
    coin.type = "button";
    coin.className = "hud-coin";
    coin.addEventListener("click", () => {
      const player = ctx.state().players[seat];
      if (!player.token) {
        patch({ token: true });
        ctx.log(msg("log.token.get", { seat }), seat);
      } else {
        // Spenderlo dà 1 Flusso oltre il tetto: è l'unico modo di arrivare a 21.
        patch({ token: false, flux: player.flux + 1 });
        ctx.log(msg("log.token.spend", { seat }), seat);
      }
    });

    syncs.push(flux.sync, () => {
      box.classList.toggle("is-active", ctx.state().active === seat);
      box.classList.toggle("is-arbitrated", ctx.arbitrated());
      const held = ctx.state().players[seat].token;
      coin.textContent = held ? "◆" : "◇";
      coin.classList.toggle("is-held", held);
      tip(coin, t(held ? "hud.token.held" : "hud.token.none"));
    });

    box.append(coin, flux.row);
    return box;
  }

  const chips: Record<Seat, HTMLElement> = {
    a: chip("a", ctx.seat() === "a"),
    b: chip("b", ctx.seat() === "b"),
  };

  // Il turno non sta in header: lo dice l'insegna di fase al centro del
  // tavolo (banner.ts), grande, a ogni cambio — «Turno 3 · Fase di Fronte».

  // Il gesto di fase, in basso a destra. Con l'arbitro è «Fine fase»: chiude
  // la fase in corso, e l'ultima chiude il turno (turn.ts). Senza, è un
  // gesto a due tempi: in Preparazione dichiara la Fase di Fronte (§6.3); a
  // ondata completa passa la parola al difensore — Fase di Reazione (§6.4).
  // A senso unico: in Reazione si spegne, e col cambio di turno si
  // ricomincia. E accanto il Fine turno, la mossa più battuta.
  const actions = document.createElement("div");
  actions.className = "hud-actions";

  const front = document.createElement("button");
  front.type = "button";
  front.className = "hud-front";
  front.textContent = t("hud.front");
  front.addEventListener("click", () => {
    if (ctx.arbitrated()) {
      void endPhase(ctx);
      return;
    }
    const phase = ctx.state().phase;
    if (phase === "preparazione") void declareFront(ctx);
    else if (phase === "fronte") void declareReaction(ctx);
  });

  const pass = document.createElement("button");
  pass.type = "button";
  // Niente classe `primary`: quella veste i bottoni di rubino, e qui il
  // colore lo decide la palette dei gesti.
  pass.className = "hud-pass";
  pass.textContent = t("hud.endturn");
  tip(pass, t("hud.endturn.tip"));
  pass.addEventListener("click", () => endTurn(ctx));
  actions.append(front, pass);

  /** Le due spie di un tasto: blu per i messaggi, oro per le azioni. */
  const makeBadges = (host: HTMLElement): { chat: HTMLElement; log: HTMLElement } => {
    const chat = document.createElement("span");
    chat.className = "hud-badge hud-badge-chat";
    const log = document.createElement("span");
    log.className = "hud-badge hud-badge-log";
    host.append(chat, log);
    return { chat, log };
  };

  const chatToggle = document.createElement("button");
  chatToggle.type = "button";
  chatToggle.className = "hud-chat";
  tip(chatToggle, t("hud.chat"));
  chatToggle.innerHTML =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M5 4h14a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 19 17h-8.6l-4.6 3.8c-.65.54-1.65.08-1.65-.77V6.5A2.5 2.5 0 0 1 5 4z"/></svg>';
  chatToggle.addEventListener("click", hooks.chat);
  const chatBadges = makeBadges(chatToggle);

  // Il microfono della chat vocale: SPENTO di default, l'accensione è un
  // gesto esplicito. Lo stato visivo lo detta body.dataset.voice (main.ts).
  const mic = document.createElement("button");
  mic.type = "button";
  mic.className = "hud-mic";
  mic.innerHTML = svgIcon(
    '<path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>'
  );
  mic.addEventListener("click", hooks.voice);

  // Il Fine turno è di chi è di turno: per l'altro si ingrigisce. È l'unico
  // "impedimento" del simulatore, e serve al ritmo: passo io, poi passi tu.
  // In partita locale si governano entrambi i posti: il tasto resta sempre
  // acceso, e chiude il turno di chiunque tocchi.
  syncs.push(() => {
    const state = ctx.state();
    // La Reazione la chiude chi difende (§6.4): lì il gesto passa dall'altra
    // parte del tavolo.
    const canPass = ctx.controls(phaseCloser(state));
    pass.disabled = !canPass;
    tip(pass, t(canPass ? "hud.endturn.tip" : "hud.endturn.theirs"));
    // Arbitro collegato: le fasi le scandisce lui, e resta un gesto solo —
    // «Fine fase», rubino, al posto del Fine turno. Il turno si chiude
    // dall'ultima fase (Reazione, o Fronte senza ondata), non si salta: la
    // Preparazione si chiude sempre sul Fronte (§6.3).
    const single = ctx.arbitrated();
    pass.hidden = single;
    actions.classList.toggle("is-single", single);
    front.classList.toggle("is-phase-end", single);
    // Partita finita (§2, §9): fasi e turni si fermano, resta Nuova partita.
    if (state.over) {
      pass.disabled = true;
      front.disabled = true;
      tip(pass, t("hud.over"));
      tip(front, t("hud.over"));
      if (single) {
        front.textContent = t(PHASE_END[state.phase]);
        front.dataset.phase = state.phase;
      }
      return;
    }
    if (single) {
      // Il tasto dice quale fase chiude, e ne prende il colore. Col Fronte
      // dichiarato ma nessun attacco il tasto dice il vero: «se il giocatore
      // passa, la Reazione non c'è e si va al Fine del turno» (§6.3), quindi
      // quel gesto chiude il turno — e con la mano piena si ferma lì (§6.5).
      const endsTurn = state.phase === "fronte" && !waveDeclared(state);
      front.textContent = t(endsTurn ? "hud.endturn" : PHASE_END[state.phase]);
      front.dataset.phase = state.phase;
      front.disabled = !canPass;
      tip(front, t(!canPass
        ? (state.phase === "reazione" ? "hud.phase.defender" : "hud.phase.theirs")
        : state.phase === "preparazione"
          ? "hud.phase.tip.preparazione"
          : `hud.phase.tip.${state.phase}.${waveDeclared(state) ? "wave" : "none"}`));
      return;
    }
    front.textContent = t(state.phase === "preparazione" ? "hud.front" : "hud.defender");
    front.disabled = !canPass || state.phase === "reazione";
    tip(front, t(!canPass ? "hud.front.tip.theirs" : `hud.front.tip.${state.phase}`));
  });

  // La fila delle azioni di mazzo (senza arbitro): icona e tooltip.
  const tools = document.createElement("div");
  tools.className = "hud-tools";
  for (const def of TOOLS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `hud-tool hud-tool-${def.key}`;
    tip(button, t(def.title));
    button.innerHTML = def.svg;
    button.addEventListener("click", hooks[def.key]);
    tools.append(button);
  }

  // I dadi (senza arbitro): quattro tagli e l'ultimo esito. Ogni tiro va in
  // chat, firmato dal posto che tira.
  const dice = document.createElement("div");
  dice.className = "hud-dice";
  const diceOut = document.createElement("div");
  diceOut.className = "hud-dice-out";
  for (const faces of [20, 12, 6, 4]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hud-dice-btn";
    button.textContent = `d${faces}`;
    tip(button, t("hud.die.tip", { n: faces }));
    button.addEventListener("click", () => {
      const value = 1 + Math.floor(Math.random() * faces);
      diceOut.textContent = `d${faces} → ${value}`;
      ctx.log(msg("log.roll", { seat: ctx.seat(), die: faces, roll: value }), ctx.seat());
    });
    dice.append(button);
  }
  dice.append(diceOut);

  // STRUMENTO DI PROVA, temporaneo: «Evoca» apre il catalogo intero e mette
  // in mano la carta scelta, per provare le regole in fretta. Resta anche
  // con l'arbitro.
  const spawn = document.createElement("button");
  spawn.type = "button";
  spawn.className = "hud-tool hud-tool-spawn";
  tip(spawn, t("hud.spawn.tip"));
  spawn.innerHTML = svgIcon('<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="9"/>');
  spawn.addEventListener("click", hooks.spawn);

  bar.append(tools, dice);
  toolsHost.append(spawn, chatToggle, mic);
  // Il gesto di fase sta sul tavolo, in basso a destra, sopra il cassetto
  // della mano e accanto al tasto che la ripiega: a portata di mano, e la
  // fila di servizio lì sotto è libera (le pile stanno a sinistra, ctx.ts).
  // La mano gli lascia il posto (table.ts misura .hud-actions).
  document.querySelector<HTMLElement>("#table")!.append(actions);

  // Con l'arbitro al tavolo i gesti manuali si ritirano: i più e meno dei
  // contatori (PV e Flusso li muovono le regole — danni della risoluzione,
  // costo delle carte, ricarica del turno), Mescola, Pesca e Cerca (la pesca
  // è quella del turno, il mulligan e la ricerca aspettano le loro regole) e
  // i dadi (il d20 della Furia e i costi a dado arriveranno con le loro).
  // Un interruttore solo, in CSS: .game-bar.is-arbitrated (style.css); le
  // targhe portano la loro classe, sono altrove.
  syncs.push(() => bar.classList.toggle("is-arbitrated", ctx.arbitrated()));

  return {
    chip: seat => chips[seat],
    render() {
      for (const sync of syncs) sync();
      const voiceOn = document.body.dataset.voice === "on";
      mic.classList.toggle("is-on", voiceOn);
      tip(mic, t(voiceOn ? "hud.mic.on" : "hud.mic.off"));
      // Le spie dei non letti stanno sul tasto della chat.
      const unreadChat = document.body.dataset.unread ?? "";
      const unreadLog = document.body.dataset.unreadLog ?? "";
      chatBadges.chat.textContent = unreadChat;
      chatBadges.log.textContent = unreadLog;
    },
  };
}
