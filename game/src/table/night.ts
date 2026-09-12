// La tavolozza dei momenti del tavolo col tema notte (simulatore/src/style.css:
// :root e body[data-ui-theme="notte"]), e i due pezzi che tutti i momenti
// hanno in comune: la piastra dei tasti e la sfocatura sotto i veli.
//
// Due famiglie di colori, come nel foglio. Le variabili --banda-* stanno su
// :root e si risolvono lì, coi valori di base (l'inchiostro #ede6e0, il
// rubino #d24a64): le usano l'insegna e le scene. Le altre (--ink, --ruby,
// --panel, --line…) si risolvono sull'elemento, col Notte che le sovrascrive
// (#f1eae6, #ff4d6d…): le usano il sigillo, la conferma, la vetrina, il menu.

import { BlurFilter, type Container, type Filter } from "pixi.js";
import type { Stage } from "../stage";
import { linearGradient } from "./appearance";

export const NIGHT = {
  /** --banda-ink, --banda-muted, --banda-ruby (su :root). */
  bandaInk: "#ede6e0",
  bandaMuted: "#998d90",
  bandaRuby: "#d24a64",
  /** --banda-viola non c'è sul buio: vale --viola-light del Notte. */
  bandaViola: "#ff9fb3",
  /** --banda-panel: color-mix(in srgb, var(--panel-2) 70%, transparent), su :root. */
  bandaPanel: "rgba(38,32,39,.7)",
  /** --banda-panel-filo: var(--line-soft), su :root. */
  bandaFilo: "#2b2429",
  ink: "#f1eae6",
  muted: "#9a8e93",
  ruby: "#ff4d6d",
  rubyDeep: "#a62640",
  panel: "#151117",
  panel2: "#1c171e",
  line: "#3a3037",
  lineSoft: "#29222a",
  ok: "#6fbf8b",
  /** --glass-heavy del Notte. */
  glassHeavy: "rgba(11,9,12,.98)",
  /** color-mix(in srgb, var(--ruby) 45%, var(--line)): la cornice del sigillo e della conferma. */
  rubyLine: "rgb(147,61,79)",
  /** color-mix(in srgb, var(--ruby) 45%, var(--line-soft)): la cornice di un innesco. */
  rubyLineSoft: "rgb(137,53,72)",
  /** color-mix(in srgb, var(--panel-2) 70%, transparent) sul Notte: la targhetta del sigillo. */
  refPanel: "rgba(28,23,30,.7)",
  /** La cornice rosa dei tasti del gesto (.effect-go, .engine-stop-ok, .phase-banner-new) e la loro scritta. */
  goLine: "#e56a86",
  goInk: "#fdeef1",
} as const;

/** --moment-veil, --moment-veil-soft, --overlay-veil. */
export const MOMENT_VEIL = { color: 0x05040a, alpha: 0.66 };
export const LIGHT_VEIL = { color: 0x05040a, alpha: 0.38 };
export const VEIL_OVERLAY = { color: 0x080608, alpha: 0.82 };

/**
 * La piastra dei tasti sul Notte (`:where(button…)`): il gradiente brunito
 * #241d22→#151116, il filo di luce in cima (inset 0 1px 0 rgba(255,255,255,.07))
 * e la cornice. `fondo: false` lascia solo la cornice (.effect-go.is-ghost).
 */
export function plate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, edge: string | null, background = true): void {
  if (background) {
    ctx.fillStyle = linearGradient(ctx, 180, x, y, w, h, [
      [0, "#241d22"],
      [1, "#151116"],
    ]);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(255,255,255,.07)";
    ctx.fillRect(x + 1, y + 1, w - 2, 1);
  }
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}

/** Il colore `hex` (#rrggbb) con la sua trasparenza: per gli aloni col tono di fase. */
export function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function asList(filters: Container["filters"]): Filter[] {
  return filters ? [...filters] : [];
}

/** I figli visibili di `parent` che stanno sotto `sopra`: ciò che un velo copre. */
export function below(parent: Container, overlay: Container): Container[] {
  const index = parent.getChildIndex(overlay);
  return parent.children.slice(0, index).filter(child => child.visible);
}

/**
 * Il backdrop-filter: blur(Npx) dei veli del simulatore: i livelli dati si
 * sfocano finché il momento è aperto. Torna la funzione che toglie la
 * sfocatura (e solo la propria: i filtri che i livelli avevano restano).
 */
export function setBlurred(stage: Stage, levels: Container[], cssPx: number): () => void {
  const v = stage.visible();
  const filter = new BlurFilter({ strength: cssPx * 2 * v.scale * stage.app.renderer.resolution, quality: 3 });
  for (const level of levels) level.filters = [...asList(level.filters), filter];
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    for (const level of levels) if (!level.destroyed) level.filters = asList(level.filters).filter(f => f !== filter);
    filter.destroy();
  };
}
