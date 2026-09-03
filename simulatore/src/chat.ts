// Chat di servizio, accanto al tavolo.
//
// Due tipi di riga: quelle scritte dai giocatori e quelle generate dal
// simulatore (dadi, pesche, mescolate). Vivono nello stato condiviso, quindi
// arrivano a entrambi e — soprattutto — spariscono a nuova partita, che è
// esattamente ciò che serve: la cronologia di ieri non deve stare sul tavolo
// di oggi.

import { t } from "./i18n.js";
import { renderLog } from "./log.js";
import { cardName } from "./renderer.js";
import type { Ctx } from "./ctx.js";
import { seatLabel } from "./state.js";

export interface Chat {
  render(): void;
}

export function mountChat(root: HTMLElement, ctx: Ctx): Chat {
  const log = document.createElement("div");
  log.className = "chat-log";

  const form = document.createElement("form");
  form.className = "chat-form";
  const input = document.createElement("input");
  input.placeholder = t("chat.placeholder");
  input.autocomplete = "off";
  const send = document.createElement("button");
  send.type = "submit";
  send.textContent = t("chat.send");
  form.append(input, send);

  form.addEventListener("submit", event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    ctx.dispatch({
      t: "say",
      entry: { id: crypto.randomUUID(), seat: ctx.seat(), kind: "chat", text, ts: Date.now() },
    });
  });

  root.append(log, form);

  let painted = 0;

  return {
    render() {
      const entries = ctx.state().chat;
      // Ridisegnare tutto a ogni movimento del mouse farebbe perdere la
      // posizione di scorrimento: si aggiunge solo ciò che è nuovo.
      if (entries.length < painted) {
        log.replaceChildren();
        painted = 0;
      }
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      for (const entry of entries.slice(painted)) {
        // Le TUE azioni non si notificano: le hai appena fatte, le vedi sul
        // tavolo. La chat racconta ciò che ARRIVA — le azioni dell'avversario
        // e i messaggi (i tuoi compresi: una conversazione si legge intera).
        if (entry.kind === "log" && entry.seat === ctx.seat()) continue;
        const row = document.createElement("p");
        row.className = `chat-row is-${entry.kind}`;
        // I colori dicono cosa stai leggendo: viola i tuoi messaggi, indaco le
        // azioni dell'avversario, azzurro i suoi messaggi. Le righe senza
        // posto (sincronizzazioni, avvisi) restano neutre.
        if (entry.seat) row.classList.add(entry.seat === ctx.seat() ? "is-me" : "is-them");
        if (entry.kind === "chat" && entry.seat) {
          const who = document.createElement("b");
          who.textContent = `${seatLabel(ctx.state(), entry.seat)}: `;
          row.append(who);
        }
        // Le righe del tavolo si leggono nella propria lingua; i nomi delle
        // carte, dal proprio catalogo.
        const text = entry.key ? renderLog({ key: entry.key, params: entry.params }, ctx.state(), id => cardName(id, ctx.locale())) : entry.text;
        row.append(document.createTextNode(text));
        log.append(row);
      }
      painted = entries.length;
      if (atBottom) log.scrollTop = log.scrollHeight;
    },
  };
}
