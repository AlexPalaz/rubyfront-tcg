// La domanda del gioco: «Uscire dalla partita?».
//
// Non un confirm del browser ma il sigillo del gioco — la gemma del
// marchio, il titolo in rubino, la frase, due tasti: il gesto (rubino) e
// il ripensamento. Stesso vestito del fermo dell'arbitro (engine-stop,
// style.css), che è l'altra voce con cui il tavolo parla in faccia a chi
// gioca. Esc e il click fuori valgono «no».

export interface Ask {
  title: string;
  text: string;
  yes: string;
  no: string;
}

export function askConfirm(ask: Ask): Promise<boolean> {
  return new Promise(resolve => {
    document.querySelector(".ask")?.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "engine-stop ask";
    const card = document.createElement("div");
    card.className = "engine-stop-card ask-card";

    const gem = document.createElement("span");
    gem.className = "engine-stop-gem";
    gem.setAttribute("aria-hidden", "true");
    const title = document.createElement("h3");
    title.className = "engine-stop-title";
    title.textContent = ask.title;
    const text = document.createElement("p");
    text.className = "engine-stop-text";
    text.textContent = ask.text;

    const row = document.createElement("div");
    row.className = "ask-row";
    const no = document.createElement("button");
    no.type = "button";
    no.className = "ask-no";
    no.textContent = ask.no;
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "engine-stop-ok ask-yes";
    yes.textContent = ask.yes;
    row.append(no, yes);

    const close = (answer: boolean): void => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(answer);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close(false);
    };
    yes.addEventListener("click", () => close(true));
    no.addEventListener("click", () => close(false));
    backdrop.addEventListener("pointerdown", event => {
      if (event.target === backdrop) close(false);
    });
    document.addEventListener("keydown", onKey);

    card.append(gem, title, text, row);
    backdrop.append(card);
    document.body.append(backdrop);
    no.focus();
  });
}
