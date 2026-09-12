// La legenda dei simboli del tavolo: un pannello che si apre dal tastino
// «?» accanto alla chat (deciso 2026-09-10) e spiega, uno per riga, ogni
// segno che compare sulle tessere e sulle targhe — con l'icona vera, la
// stessa che si vede in gioco. Solo testo e icone: niente stato.

import { ICONS, KEYWORD_IDS, keywordIcon } from "./cardview.js";
import { t } from "@rubyfront/core/i18n";

const SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v6c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6z"/></svg>';
const GEM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 22 12 12 22 2 12z" fill="currentColor"/></svg>';
const TOKEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const TAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="11" rx="1"/></svg>';
const COVER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="1"/><path d="M9 7h6M9 12h6M9 17h6"/></svg>';
const CHAIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';

interface Row {
  icon: string;
  cls?: string;
  key: string;
}

const ROWS: Row[] = [
  { icon: ICONS.swords, cls: "is-power", key: "power" },
  { icon: ICONS.counter, cls: "is-counter", key: "counter" },
  ...KEYWORD_IDS.map(id => ({ icon: keywordIcon(id) ?? "", cls: `is-key is-${id}`, key: id })),
  { icon: GEM, cls: "is-hp", key: "hp" },
  { icon: GEM, cls: "is-flux", key: "flux" },
  { icon: TOKEN, cls: "is-token", key: "token" },
  { icon: "<b>1</b>", cls: "is-wave", key: "wave" },
  { icon: SHIELD, cls: "is-shield", key: "shield" },
  { icon: ICONS.swords, cls: "is-delta", key: "delta" },
  { icon: ICONS.counter, cls: "is-extra", key: "extra" },
  { icon: TAP, cls: "is-tapped", key: "tapped" },
  { icon: COVER, cls: "is-covered", key: "covered" },
  { icon: CHAIN, cls: "is-chain", key: "chain" },
];

export interface Legend {
  toggle(): void;
  close(): void;
  /** Rifà i testi nella lingua corrente. */
  repaint(): void;
}

export function mountLegend(root: HTMLElement, anchor: HTMLElement): Legend {
  const panel = document.createElement("div");
  panel.className = "legend";
  panel.hidden = true;
  root.append(panel);

  const paint = (): void => {
    panel.replaceChildren();
    const title = document.createElement("h3");
    title.className = "legend-title";
    title.textContent = t("legend.title");
    panel.append(title);
    for (const row of ROWS) {
      const line = document.createElement("div");
      line.className = "legend-row";
      const icon = document.createElement("span");
      icon.className = `legend-icon ${row.cls ?? ""}`;
      icon.innerHTML = row.icon;
      const name = document.createElement("b");
      name.textContent = t(`legend.${row.key}`);
      const text = document.createElement("span");
      text.className = "legend-text";
      text.textContent = t(`legend.${row.key}.text`);
      line.append(icon, name, text);
      panel.append(line);
    }
  };
  paint();

  document.addEventListener("pointerdown", event => {
    if (panel.hidden) return;
    const target = event.target as HTMLElement;
    if (panel.contains(target) || anchor.contains(target)) return;
    panel.hidden = true;
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") panel.hidden = true;
  });

  return {
    toggle() {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) paint();
    },
    close() {
      panel.hidden = true;
    },
    repaint: paint,
  };
}
