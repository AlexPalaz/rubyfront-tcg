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
}

const CARD_W = 520;
const CARD_H = 728;

export function showEnterEffect(root: HTMLElement, show: EnterEffectShow): Promise<void> {
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
  const go = document.createElement("button");
  go.type = "button";
  go.className = "effect-go";
  go.textContent = "Continua";
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
        resolve();
      }, 220);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" || event.key === "Enter") close();
    };
    go.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    go.focus();
  });
}

/** Quanto la carta dell'avversario resta accesa al centro. */
const PEEK_HOLD_MS = 2600;

/**
 * L'avviso per chi guarda: non ferma nulla. La carta accesa al centro, la
 * targhetta e l'effetto di fianco, per un attimo; poi svanisce.
 */
export function showEnterPeek(root: HTMLElement, show: EnterEffectShow): Promise<void> {
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
