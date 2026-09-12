// Menu contestuale: tutto ciò che si fa a una carta senza trascinarla.
// Tasto destro sulla tessera.

export interface MenuItem {
  label: string;
  run?: () => void;
  disabled?: boolean;
  /** Riga di separazione: label ignorata. */
  rule?: boolean;
}

let host: HTMLElement | null = null;

export function closeMenu(): void {
  host?.remove();
  host = null;
}

export function openMenu(clientX: number, clientY: number, items: MenuItem[]): void {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "menu";
  for (const item of items) {
    if (item.rule) {
      menu.append(document.createElement("hr"));
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    button.disabled = Boolean(item.disabled);
    button.addEventListener("click", () => {
      closeMenu();
      item.run?.();
    });
    menu.append(button);
  }
  document.body.append(menu);
  host = menu;

  // Il menu resta dentro la finestra: vicino al bordo si apre verso l'interno.
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(clientX, window.innerWidth - box.width - 8)}px`;
  menu.style.top = `${Math.min(clientY, window.innerHeight - box.height - 8)}px`;

  const dismiss = (event: Event): void => {
    if (host && event.target instanceof Node && host.contains(event.target)) return;
    closeMenu();
    document.removeEventListener("pointerdown", dismiss, true);
    window.removeEventListener("blur", dismiss);
  };
  document.addEventListener("pointerdown", dismiss, true);
  window.addEventListener("blur", dismiss);
}
