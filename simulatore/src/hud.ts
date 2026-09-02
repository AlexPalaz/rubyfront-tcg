// L'HUD: le targhe dei due posti, appoggiate sul bordo destro del tavolo.
//
// Non è una colonna del layout: fluttua sopra il tavolo, che sotto continua.
// Tiene ciò che serve giocando a pannello chiuso — Punti Vita, Flusso, turno,
// Fine turno — e l'ingranaggio che apre il pannello. Si vede solo a pannello
// chiuso: aperto quello, gli stessi numeri stanno là (stesso stato, non una
// copia: toccarli di qua o di là è la stessa cosa).
//
// Le targhe stanno nell'ordine del tavolo: l'avversario in alto, tu in basso,
// e in mezzo la pillola del turno, con la punta verso chi tocca.
//
// L'HUD si sposta: lo si afferra da un punto qualsiasi che non sia un tasto e
// lo si porta dove non dà fastidio. La posizione resta fra una partita e
// l'altra, e un doppio click sulla maniglia lo rimette al posto suo.

import type { Ctx } from "./ctx.js";
import { seatLabel, waveDeclared } from "./state.js";
import { declareFront, declareReaction, endPhase, endTurn } from "./turn.js";
import type { PlayerState, Seat } from "./types.js";
import { otherSeat } from "./types.js";

/** Stessa dispensa di main.ts (`rbf-sim:*`): qui ci sta la posizione. */
const POS_KEY = "rbf-sim:hud";
/** L'HUD non si incolla mai ai bordi del tavolo più di così. */
const EDGE = 10;

export interface Hud {
  render(): void;
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

/**
 * Le azioni di mazzo — mescola, pesca, cerca — vivono nell'HUD, non in
 * toolbar: sono gesti di partita. Portano due vesti: fila con etichetta
 * nell'HUD esteso, quadratini della croce in quello ridotto.
 */
const TOOLS = [
  {
    key: "shuffle",
    label: "Mescola",
    title: "Mescola il tuo mazzo",
    svg: svgIcon('<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/>'),
  },
  {
    key: "draw",
    label: "Pesca",
    title: "Pesca 1 carta",
    svg: svgIcon('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 8v6M9 11h6"/>'),
  },
  {
    key: "search",
    label: "Cerca",
    title: "Cerca una carta nel mazzo",
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
    suffix.textContent = "PV";
    head.append(suffix);
  }

  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "hud-step";
  minus.textContent = "−";
  tip(minus, `${title}: uno in meno`);

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "hud-step";
  plus.textContent = "+";
  tip(plus, `${title}: uno in più`);

  const clamp = (next: number): number =>
    Math.max(options.min ?? Number.NEGATIVE_INFINITY, Math.min(options.max ?? Number.POSITIVE_INFINITY, next));

  minus.addEventListener("click", () => write(clamp(read() - 1)));
  plus.addEventListener("click", () => write(clamp(read() + 1)));

  row.append(minus, head, plus);
  return { row, sync: () => (value.textContent = String(read())) };
}

export function mountHud(root: HTMLElement, ctx: Ctx, hooks: HudHooks): Hud {
  const syncs: (() => void)[] = [];

  function chip(seat: Seat, mine: boolean): HTMLElement {
    const box = document.createElement("section");
    box.className = `hud-chip ${mine ? "is-mine" : "is-foe"}`;

    const name = document.createElement("h4");
    name.className = "hud-name";
    const patch = (values: Partial<PlayerState>): void => {
      void ctx.dispatch({ t: "player", seat, patch: values });
    };

    const hp = statRow("hp", "Punti Vita", () => ctx.state().players[seat].hp, value => patch({ hp: value }));
    // Niente tetto né pavimento cuciti nel bottone: il limite dei 20 e lo
    // zero (§3.2) sono regole dell'engine — acceso, 21 e −1 li ferma il
    // poliziotto con tanto di avviso; spento, il tavolo è libero come per
    // ogni altro gesto.
    const flux = statRow(
      "flux",
      "Flusso",
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
        ctx.log(`${seatLabel(ctx.state(), seat)} riceve il Gettone Flusso.`, seat);
      } else {
        // Spenderlo dà 1 Flusso oltre il tetto: è l'unico modo di arrivare a 21.
        patch({ token: false, flux: player.flux + 1 });
        ctx.log(`${seatLabel(ctx.state(), seat)} spende il Gettone Flusso (+1 Flusso, fuori dal limite).`, seat);
      }
    });

    syncs.push(hp.sync, flux.sync, () => {
      name.textContent = mine ? "tu" : seatLabel(ctx.state(), seat, ctx.seat()).slice(0, 14);
      box.classList.toggle("is-active", ctx.state().active === seat);
      const held = ctx.state().players[seat].token;
      coin.textContent = held ? "◆" : "◇";
      coin.classList.toggle("is-held", held);
      tip(coin, held
        ? "Gettone Flusso: spendi (+1 Flusso, oltre il tetto dei 20)"
        : "Assegna il Gettone Flusso (§3.2)");
    });

    box.append(coin, name, hp.row, flux.row);
    return box;
  }

  const foe = chip(otherSeat(ctx.seat()), false);
  const mine = chip(ctx.seat(), true);

  // Il turno, fra le due targhe: numero e, sotto, chi tocca — con la punta
  // rivolta alla targa giusta (▲ l'avversario sopra, ▼ tu sotto). I − e +
  // a comparsa correggono il numero a mano, come ogni cifra del simulatore.
  const turn = document.createElement("div");
  turn.className = "hud-turn";
  const turnMid = document.createElement("div");
  turnMid.className = "hud-turn-mid";
  const turnCount = document.createElement("span");
  turnCount.className = "hud-turn-count";
  const turnWho = document.createElement("span");
  turnWho.className = "hud-turn-who";
  // La fase del turno (§6), sotto il chi tocca: dice in che momento della
  // partita si è, e con l'arbitro al tavolo spiega perché un attacco non
  // parte prima d'aver dichiarato il Fronte.
  const turnPhase = document.createElement("span");
  turnPhase.className = "hud-turn-phase";
  turnMid.append(turnCount, turnWho, turnPhase);

  const turnStep = (delta: number, label: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hud-step";
    button.textContent = delta < 0 ? "−" : "+";
    tip(button, label);
    button.addEventListener("click", () => {
      const state = ctx.state();
      ctx.dispatch({ t: "turn", turn: Math.max(1, state.turn + delta), active: state.active });
    });
    return button;
  };
  turn.append(turnStep(-1, "Turno: uno in meno"), turnMid, turnStep(1, "Turno: uno in più"));

  syncs.push(() => {
    const state = ctx.state();
    turnCount.textContent = `Turno ${state.turn}`;
    const mineTurn = state.active === ctx.seat();
    turnWho.textContent = mineTurn ? "▼ tocca a te" : `▲ ${seatLabel(state, state.active, ctx.seat())}`;
    turn.classList.toggle("is-mine", mineTurn);
    turnPhase.textContent =
      state.phase === "reazione" ? "Reazione" : state.phase === "fronte" ? "Fase di Fronte" : "Preparazione";
    turnPhase.classList.toggle("is-front", state.phase === "fronte");
    turnPhase.classList.toggle("is-reaction", state.phase === "reazione");
  });

  // In fondo le due azioni: Fine turno — la mossa più battuta, che merita di
  // stare a portata di mano — e l'ingranaggio che apre il pannello.
  const actions = document.createElement("div");
  actions.className = "hud-actions";

  // Il bottone delle fasi, sopra il Fine turno: un gesto a due tempi. In
  // Preparazione dichiara la Fase di Fronte (§6.3); a ondata completa passa
  // la parola al difensore — Fase di Reazione (§6.4). A senso unico: in
  // Reazione si spegne, e col cambio di turno si ricomincia.
  const front = document.createElement("button");
  front.type = "button";
  front.className = "hud-front";
  front.textContent = "Fase di Fronte";
  front.addEventListener("click", () => {
    // Con l'arbitro al tavolo il bottone è «Fine fase»: chiude la fase in
    // corso, e l'ultima chiude il turno (turn.ts).
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
  // colore lo decide la palette dell'HUD.
  pass.className = "hud-pass";
  pass.textContent = "Fine turno";
  tip(pass, "Passa il turno: Flusso massimo +1 e ricarica per chi entra (§3.2)");
  pass.addEventListener("click", () => endTurn(ctx));

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
  tip(chatToggle, "Apri e chiudi la chat");
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

  actions.append(front, pass, mic, chatToggle);

  // Il Fine turno è di chi è di turno: per l'altro si ingrigisce. È l'unico
  // "impedimento" del simulatore, e serve al ritmo: passo io, poi passi tu.
  // In partita locale si governano entrambi i posti: il tasto resta sempre
  // acceso, e chiude il turno di chiunque tocchi.
  syncs.push(() => {
    const state = ctx.state();
    const canPass = ctx.controls(state.active);
    pass.disabled = !canPass;
    tip(pass, canPass
      ? "Passa il turno: Flusso massimo +1 e ricarica per chi entra (§3.2)"
      : "Tocca all'avversario: il Fine turno adesso è suo");
    // Arbitro collegato: le fasi le scandisce lui, e all'HUD resta un gesto
    // solo — «Fine fase», rubino, al posto del Fine turno. Il turno si
    // chiude dall'ultima fase (Reazione, o Fronte senza ondata), non si
    // salta: la Preparazione si chiude sempre sul Fronte (§6.3).
    const single = ctx.arbitrated();
    // Partita finita (§2, §9): fasi e turni si fermano, resta Nuova partita.
    if (state.over) {
      pass.disabled = true;
      front.disabled = true;
      tip(pass, "Partita finita: Nuova partita per ricominciare");
      tip(front, "Partita finita: Nuova partita per ricominciare");
      pass.hidden = single;
      actions.classList.toggle("is-single", single);
      front.classList.toggle("is-phase-end", single);
      if (single) front.textContent = "Fine fase";
      return;
    }
    pass.hidden = single;
    actions.classList.toggle("is-single", single);
    front.classList.toggle("is-phase-end", single);
    if (single) {
      front.textContent = "Fine fase";
      front.disabled = !canPass;
      tip(front, !canPass
        ? "Tocca all'avversario: le fasi le chiude chi è di turno"
        : state.phase === "preparazione"
          ? "Chiude la Preparazione: si apre la Fase di Fronte (§6.3)"
          : state.phase === "fronte"
            ? waveDeclared(state)
              ? "Chiude il Fronte: l'ondata passa al difensore (§6.4)"
              : "Chiude il Fronte senza attacchi: fine del turno (§6.5)"
            : waveDeclared(state)
              ? "Chiude la Reazione: risolve le battaglie (§6.4) e chiude il turno"
              : "Chiude la Reazione: fine del turno (§6.5)");
      return;
    }
    front.textContent = state.phase === "preparazione" ? "Fase di Fronte" : "Al difensore";
    front.disabled = !canPass || state.phase === "reazione";
    tip(front, !canPass
      ? "Tocca all'avversario: le fasi le dichiara chi è di turno"
      : state.phase === "preparazione"
        ? "Dichiara la Fase di Fronte: apre il combattimento (§6.3)"
        : state.phase === "fronte"
          ? "Ondata completa: passa la parola al difensore (§6.4)"
          : "Reazione aperta: il difensore blocca; risolvete, poi Fine turno");
  });

  // La fila delle azioni di mazzo, per l'HUD esteso.
  const tools = document.createElement("div");
  tools.className = "hud-tools";
  for (const def of TOOLS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `hud-tool hud-tool-${def.key}`;
    tip(button, def.title);
    button.innerHTML = `${def.svg}<span>${def.label}</span>`;
    button.addEventListener("click", hooks[def.key]);
    tools.append(button);
  }

  // I dadi, in coda: quattro tagli e l'ultimo esito. Ogni tiro va in chat,
  // firmato dal posto che tira.
  const dice = document.createElement("div");
  dice.className = "hud-dice";
  const diceOut = document.createElement("div");
  diceOut.className = "hud-dice-out";
  for (const faces of [20, 12, 6, 4]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hud-dice-btn";
    button.textContent = `d${faces}`;
    tip(button, `Tira il d${faces}`);
    button.addEventListener("click", () => {
      const value = 1 + Math.floor(Math.random() * faces);
      diceOut.textContent = `d${faces} → ${value}`;
      ctx.log(`${seatLabel(ctx.state(), ctx.seat())} tira d${faces}: ${value}`, ctx.seat());
    });
    dice.append(button);
  }
  dice.append(diceOut);

  // La testata: maniglia al centro, e nell'angolo il tasto che riduce l'HUD
  // a icona. Ridotto, resta solo una tessera col rombo: un click la riapre.
  const top = document.createElement("div");
  top.className = "hud-top";

  const grip = document.createElement("div");
  grip.className = "hud-grip";
  tip(grip, "Trascina per spostare l'HUD · doppio click per rimetterlo al posto suo");

  const minBtn = document.createElement("button");
  minBtn.type = "button";
  minBtn.className = "hud-min-btn";
  minBtn.innerHTML = svgIcon('<path d="M5 12h14"/>');
  tip(minBtn, "Riduci l'HUD a icona");
  minBtn.addEventListener("click", () => setMin(true));
  // Sta sopra, accanto alla maniglia — ma da tasto vero, non da francobollo.
  top.append(grip, minBtn);

  const mini = document.createElement("button");
  mini.type = "button";
  mini.className = "hud-sq hud-mini";
  tip(mini, "Espandi l'HUD · trascina per spostarlo");
  mini.innerHTML = '<span class="hud-mini-gem"></span>';
  // Il click espande, ma solo se è un click davvero: dopo un trascinamento
  // il browser lo spara lo stesso, e va lasciato cadere.
  const miniBadges = makeBadges(mini);
  mini.addEventListener("click", () => {
    if (miniDragged) {
      miniDragged = false;
      return;
    }
    setMin(false);
  });

  // L'HUD parte SEMPRE aperto: ridurlo a icona è un gesto di sessione, non
  // una preferenza da ricordare.
  let minimized = false;

  function setMin(value: boolean): void {
    minimized = value;
    root.classList.toggle("is-min", minimized);
    // La misura cambia: l'HUD rientra nei bordi se serve.
    place();
  }

  // STRUMENTO DI PROVA, temporaneo: «Evoca» apre il catalogo intero e mette
  // in mano la carta scelta, per provare le regole in fretta. Sta fuori
  // dalla fila degli strumenti perché deve restare anche con l'arbitro.
  const test = document.createElement("div");
  test.className = "hud-test";
  const spawn = document.createElement("button");
  spawn.type = "button";
  spawn.className = "hud-tool hud-tool-spawn";
  tip(spawn, "Prova: evoca in mano una carta del catalogo");
  spawn.innerHTML = `${svgIcon('<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="9"/>')}<span>Evoca</span>`;
  spawn.addEventListener("click", hooks.spawn);
  test.append(spawn);

  root.append(top, foe, turn, mine, actions, tools, dice, test, mini);

  // Con l'arbitro al tavolo i gesti manuali si ritirano: i più e meno dei
  // contatori (PV e Flusso li muovono le regole — danni della risoluzione,
  // costo delle carte, ricarica del turno), Mescola, Pesca e Cerca (la pesca
  // è quella del turno, il mulligan e la ricerca aspettano le loro regole) e
  // i dadi (il d20 della Furia e i costi a dado arriveranno con le loro).
  // Un interruttore solo, in CSS: .hud.is-arbitrated (style.css).
  syncs.push(() => root.classList.toggle("is-arbitrated", ctx.arbitrated()));
  root.classList.toggle("is-min", minimized);

  // ------------------------------------------------------- trascinamento

  const table = (): HTMLElement => root.parentElement as HTMLElement;

  let pos: { x: number; y: number } | null = null;
  try {
    pos = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
  } catch {
    pos = null;
  }
  if (typeof pos?.x !== "number" || typeof pos?.y !== "number") pos = null;

  /** Applica la posizione, tenendo l'HUD tutto dentro il tavolo. Senza una
      posizione scelta comanda il CSS: bordo destro, a metà altezza. */
  function place(): void {
    if (!pos) {
      root.style.left = root.style.top = root.style.right = root.style.transform = "";
      return;
    }
    const x = Math.min(Math.max(EDGE, pos.x), Math.max(EDGE, table().clientWidth - root.offsetWidth - EDGE));
    const y = Math.min(Math.max(EDGE, pos.y), Math.max(EDGE, table().clientHeight - root.offsetHeight - EDGE));
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
    root.style.right = "auto";
    root.style.transform = "none";
  }

  /** L'icona è stata appena trascinata: il click che segue non deve aprirla. */
  let miniDragged = false;

  root.addEventListener("pointerdown", event => {
    const target = event.target as HTMLElement;
    const onMini = Boolean(target.closest(".hud-mini"));
    // I tasti restano tasti: si trascina da tutto il resto. L'icona è
    // l'eccezione — è un tasto, ma ridotto a icona è anche tutto l'HUD:
    // si sposta pure lei. Niente preventDefault lì, o il click di apertura
    // non arriverebbe mai; la soglia qui sotto separa i due gesti.
    if (!onMini && target.closest("button, input")) return;
    if (!onMini) event.preventDefault();
    const rect = root.getBoundingClientRect();
    const host = table().getBoundingClientRect();
    const gripX = event.clientX - rect.left;
    const gripY = event.clientY - rect.top;
    const startX = event.clientX;
    const startY = event.clientY;
    let engaged = false;
    const move = (ev: PointerEvent): void => {
      if (!engaged && Math.abs(ev.clientX - startX) < 4 && Math.abs(ev.clientY - startY) < 4) return;
      engaged = true;
      if (onMini) miniDragged = true;
      root.classList.add("is-dragging");
      pos = { x: Math.round(ev.clientX - host.left - gripX), y: Math.round(ev.clientY - host.top - gripY) };
      place();
    };
    const drop = (): void => {
      root.classList.remove("is-dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
      if (engaged && pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
  });

  grip.addEventListener("dblclick", () => {
    pos = null;
    localStorage.removeItem(POS_KEY);
    place();
  });

  // Quando il tavolo cambia misura — pannello aperto o chiuso, finestra
  // ridimensionata — l'HUD rientra da sé nei bordi.
  new ResizeObserver(place).observe(table());
  place();

  return {
    render() {
      for (const sync of syncs) sync();
      // Le spie dei non letti stanno sul tasto della chat — e anche
      // sull'icona, che da ridotta è tutto ciò che resta in vista.
      const voiceOn = document.body.dataset.voice === "on";
      mic.classList.toggle("is-on", voiceOn);
      tip(mic, voiceOn ? "Microfono acceso: clicca per spegnerlo" : "Attiva il microfono (chat vocale)");
      const unreadChat = document.body.dataset.unread ?? "";
      const unreadLog = document.body.dataset.unreadLog ?? "";
      chatBadges.chat.textContent = unreadChat;
      chatBadges.log.textContent = unreadLog;
      miniBadges.chat.textContent = unreadChat;
      miniBadges.log.textContent = unreadLog;
    },
  };
}
