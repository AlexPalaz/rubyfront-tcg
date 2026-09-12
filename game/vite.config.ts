import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { themeT49 } from "./vite-theme.js";

// Il gioco (PixiJS) accanto al simulatore, che resta come termine di
// confronto (deciso 2026-09-11). In sviluppo sta alla radice della sua
// porta; nel sito pubblicato esce sotto /next (scripts/build-site.mjs)
// finché non ha raggiunto il simulatore.
//
// Le carte le disegna Pixi (src/card/), ma i loro dati e le illustrazioni
// stanno nel sito, docs/cards: in sviluppo si montano su /cards come fa il
// simulatore; nel sito pubblicato stanno in ../catalog/cards (VITE_CARDS).
// Su /cards vive anche il renderer vero (card-render.js, card.css): lo usa
// il banco di prova (compare/), che mette le due carte fianco a fianco.
const SITE_CARDS = resolve(import.meta.dirname, "../docs/cards");

const MIME: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

/** In sviluppo monta docs/cards su /cards, come sul sito pubblicato. */
function serveSiteCards(): Plugin {
  return {
    name: "rubyfront-site-cards",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/cards", (request, response, next) => {
        const relative = decodeURIComponent((request.url ?? "/").split("?")[0]);
        // normalize + il controllo del prefisso fermano i path traversal (../).
        const file = normalize(join(SITE_CARDS, relative));
        if (!file.startsWith(SITE_CARDS)) return next();
        let info;
        try {
          info = statSync(file);
        } catch {
          return next();
        }
        if (!info.isFile()) return next();
        response.setHeader("Content-Type", MIME[extname(file).toLowerCase()] ?? "application/octet-stream");
        response.setHeader("Content-Length", String(info.size));
        response.setHeader("Cache-Control", "no-cache");
        createReadStream(file).pipe(response);
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  base: command === "serve" ? "/" : "./",
  define: {
    // Il desktop (desktop/scripts/prepare-app.mjs) porta le carte a bordo: VITE_CARDS=./cards/.
    "import.meta.env.VITE_CARDS": JSON.stringify(process.env.VITE_CARDS || (command === "serve" ? "/cards/" : "../catalog/cards/")),
  },
  // Porta fissa, come quella del simulatore (5199): le impostazioni vivono
  // nel localStorage dell'origine, e un'origine che cambia porta le perde.
  server: { port: 5200, strictPort: true },
  build: {
    // Dentro la build del sito, che il simulatore svuota e riempie per primo.
    outDir: resolve(import.meta.dirname, "../dist/next"),
    emptyOutDir: true,
    target: "esnext",
  },
  // I suoni, la musica e le immagini della home sono quelli del simulatore:
  // si servono dalla sua cartella public, senza copie (6 MB di musica).
  publicDir: resolve(import.meta.dirname, "../simulator/public"),
  plugins: [serveSiteCards(), themeT49()],
}));
