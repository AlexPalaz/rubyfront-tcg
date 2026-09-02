// Il momento d'ingresso: quando una carta scende dalla mano, il gioco si
// ferma un attimo. Un velo sul tavolo, la carta grande al centro che si
// accende — e se ha un effetto che scatta entrando (Entità e Oggetti
// «quando entra in campo», Materie alla risoluzione), la targhetta e il
// testo. «Continua» riprende, sempre: è chi gioca a decidere quando.
// L'effetto, oggi, lo risolve il giocatore a mano: qui
// si annuncia — la lettura degli effetti arriverà con la regola d'oro. Lo
// vede chi gioca la carta; l'avversario, quando l'azione gli arriva, ha un
// avviso che NON blocca (showEnterPeek): la carta accesa al centro per un
// attimo, poi svanisce — per rileggerla basta passarci sopra sul campo.
// Così chi legge non ferma nessuno e chi gioca non aspetta nessuno. Con
// prefers-reduced-motion la carta non pulsa.

import { fitTexts, renderFace } from "./renderer.js";

export interface EnterEffectShow {
  cardId: string;
  face: number;
  theme: string;
  locale: string;
  /** Chi la gioca, per il rigo sotto. */
  who: string;
  effects: { tag: string; text: string }[];
  /** Gli inneschi che l'ingresso fa scattare sulle carte già in campo
      (effects.ts): si elencano, e «Continua» li risolve. */
  triggers?: string[];
  onContinue?: () => void;
}

const CARD_W = 520;
const CARD_H = 728;

/**
 * Le scene si mettono in fila: una alla volta, la successiva aspetta che
 * la prima sia chiusa — due carte giocate di seguito non si accavallano.
 * Vale per il momento pieno e per l'avviso di chi guarda, insieme.
 */
let queue: Promise<void> = Promise.resolve();
function enqueue(run: () => Promise<void>): Promise<void> {
  const turn = queue.then(run, run);
  queue = turn.catch(() => undefined);
  return turn;
}

export function showEnterEffect(root: HTMLElement, show: EnterEffectShow): Promise<void> {
  return enqueue(() => showEnterEffectNow(root, show));
}

function showEnterEffectNow(root: HTMLElement, show: EnterEffectShow): Promise<void> {
  const veil = document.createElement("div");
  veil.className = "effect-veil";
  const stage = document.createElement("div");
  stage.className = "effect-stage";

  const holder = renderFace(show.cardId, show.face, show.theme, show.locale);
  const card = document.createElement("div");
  card.className = "effect-card";
  // La carta è disegnata a misura piena e si scala per stare nel tavolo,
  // con aria attorno per il testo e il tasto.
  const scale = Math.min(0.9, (root.clientHeight - 260) / CARD_H, (root.clientWidth - 120) / (CARD_W * 2.2));
  card.style.width = `${Math.round(CARD_W * scale)}px`;
  card.style.height = `${Math.round(CARD_H * scale)}px`;
  if (holder) {
    holder.style.width = `${CARD_W}px`;
    holder.style.height = `${CARD_H}px`;
    holder.style.transform = `scale(${scale})`;
    holder.style.transformOrigin = "0 0";
    card.append(holder);
  }

  const side = document.createElement("div");
  side.className = "effect-side";
  const kicker = document.createElement("div");
  kicker.className = "effect-kicker";
  kicker.textContent = show.effects.length ? "Quando entra in campo" : "Entra in campo";
  const who = document.createElement("div");
  who.className = "effect-who";
  who.textContent = show.who;
  side.append(kicker, who);
  for (const effect of show.effects) {
    const block = document.createElement("div");
    block.className = "effect-text";
    const tag = document.createElement("span");
    tag.className = "effect-tag";
    tag.textContent = effect.tag;
    const text = document.createElement("p");
    text.textContent = effect.text;
    block.append(tag, text);
    side.append(block);
  }
  for (const line of show.triggers ?? []) {
    const block = document.createElement("div");
    block.className = "effect-text is-trigger";
    const tag = document.createElement("span");
    tag.className = "effect-tag";
    tag.textContent = "Si innesca";
    const text = document.createElement("p");
    text.textContent = line;
    block.append(tag, text);
    side.append(block);
  }
  const go = document.createElement("button");
  go.type = "button";
  go.className = "effect-go";
  go.textContent = show.triggers?.length ? "Risolvi" : "Continua";
  side.append(go);

  stage.append(card, side);
  veil.append(stage);
  root.append(veil);
  if (holder) fitTexts(holder);

  return new Promise(resolve => {
    const close = (): void => {
      veil.classList.add("is-leaving");
      document.removeEventListener("keydown", onKey);
      window.setTimeout(() => {
        veil.remove();
        show.onContinue?.();
        resolve();
      }, 220);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" || event.key === "Enter") close();
    };
    go.addEventListener("click", close);
    // Invio ed Esc li ascolta la pagina: niente focus da script sul tasto,
    // che disegnerebbe il contorno di messa a fuoco senza che nessuno abbia
    // toccato la tastiera.
    document.addEventListener("keydown", onKey);
  });
}

/** Quanto la carta dell'avversario resta accesa al centro. */
const PEEK_HOLD_MS = 2600;

/**
 * L'avviso per chi guarda: non ferma nulla. La carta accesa al centro, la
 * targhetta e l'effetto di fianco, per un attimo; poi svanisce.
 */
export function showEnterPeek(root: HTMLElement, show: EnterEffectShow): Promise<void> {
  return enqueue(() => showEnterPeekNow(root, show));
}

function showEnterPeekNow(root: HTMLElement, show: EnterEffectShow): Promise<void> {
  const veil = document.createElement("div");
  veil.className = "effect-veil is-peek";
  const stage = document.createElement("div");
  stage.className = "effect-stage";
  const holder = renderFace(show.cardId, show.face, show.theme, show.locale);
  const card = document.createElement("div");
  card.className = "effect-card";
  const scale = Math.min(0.7, (root.clientHeight - 260) / CARD_H, (root.clientWidth - 120) / (CARD_W * 2.2));
  card.style.width = `${Math.round(CARD_W * scale)}px`;
  card.style.height = `${Math.round(CARD_H * scale)}px`;
  if (holder) {
    holder.style.width = `${CARD_W}px`;
    holder.style.height = `${CARD_H}px`;
    holder.style.transform = `scale(${scale})`;
    holder.style.transformOrigin = "0 0";
    card.append(holder);
  }
  const side = document.createElement("div");
  side.className = "effect-side";
  const kicker = document.createElement("div");
  kicker.className = "effect-kicker";
  kicker.textContent = show.effects.length ? "Quando entra in campo" : "Entra in campo";
  const who = document.createElement("div");
  who.className = "effect-who";
  who.textContent = show.who;
  side.append(kicker, who);
  for (const effect of show.effects) {
    const block = document.createElement("div");
    block.className = "effect-text";
    const tag = document.createElement("span");
    tag.className = "effect-tag";
    tag.textContent = effect.tag;
    const text = document.createElement("p");
    text.textContent = effect.text;
    block.append(tag, text);
    side.append(block);
  }
  stage.append(card, side);
  veil.append(stage);
  root.append(veil);
  if (holder) fitTexts(holder);

  return new Promise(resolve => {
    window.setTimeout(() => {
      veil.classList.add("is-leaving");
      window.setTimeout(() => {
        veil.remove();
        resolve();
      }, 220);
    }, PEEK_HOLD_MS);
  });
}

/**
 * La conferma di un effetto con bersaglio: scelto il bersaglio, prima di
 * agire si chiede «davvero?». Un pannello piccolo al centro, «Conferma» o
 * «Annulla» (Invio ed Esc). Risolve true se si conferma.
 */
export function confirmEffect(root: HTMLElement, question: string): Promise<boolean> {
  const veil = document.createElement("div");
  veil.className = "effect-confirm";
  const panel = document.createElement("div");
  panel.className = "effect-confirm-panel";
  const text = document.createElement("p");
  text.textContent = question;
  const row = document.createElement("div");
  row.className = "effect-confirm-row";
  const no = document.createElement("button");
  no.type = "button";
  no.className = "effect-confirm-no";
  no.textContent = "Annulla";
  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "effect-go";
  yes.textContent = "Conferma";
  row.append(no, yes);
  panel.append(text, row);
  veil.append(panel);
  root.append(veil);
  return new Promise(resolve => {
    const done = (answer: boolean): void => {
      document.removeEventListener("keydown", onKey);
      veil.remove();
      resolve(answer);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Enter") done(true);
      if (event.key === "Escape") done(false);
    };
    yes.addEventListener("click", () => done(true));
    no.addEventListener("click", () => done(false));
    document.addEventListener("keydown", onKey);
  });
}
