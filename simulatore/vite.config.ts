import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";

// Il simulatore vive accanto al sito, non dentro il suo bundle.
//
// La grafica delle carte è quella vera: docs/cards/ui/card-render.js e
// card.css, caricati a runtime (vedi src/renderer.ts). Quei moduli risolvono
// catalog.json e le illustrazioni con `new URL(..., import.meta.url)`: se
// finissero dentro un chunk di Vite, `import.meta.url` diventerebbe l'URL del
// chunk e i percorsi delle art si romperebbero. Restano quindi fuori dal
// bundle, serviti come file statici sotto /cards — in produzione da GitHub
// Pages, in sviluppo dal middleware qui sotto.
const SITE_CARDS = resolve(import.meta.dirname, "../docs/cards");

const MIME: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".md": "text/markdown; charset=utf-8",
  // Le pagine del catalogo (docs/cards/ui/*.html) e i loro font: senza il
  // tipo giusto Chrome scaricava l'HTML invece di aprirlo (2026-09-09).
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/** In sviluppo monta docs/cards su /cards, come sul sito pubblicato. */
function serveSiteCards(): Plugin {
  return {
    name: "rubyfront-site-cards",
    configureServer(server: ViteDevServer) {
      // Comodità: la base dev è /simulatore/, quindi / e /simulatore da soli
      // non esistono — rimanda chi ci arriva all'indirizzo giusto.
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? "").split("?")[0];
        if (path === "/" || path === "/simulatore") {
          response.statusCode = 302;
          response.setHeader("Location", "/simulatore/");
          return response.end();
        }
        next();
      });
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
        createReadStream(file).pipe(response);
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  // In sviluppo la pagina sta a /simulatore/ e le carte a /cards (il
  // middleware qui sopra). In produzione il GIOCO è la radice del sito e il
  // catalogo sta sotto /catalog (scripts/build-site.mjs): la base resta
  // relativa, e la grafica delle carte si cerca in ./catalog/cards/ui/ —
  // VITE_CARDS_UI, che renderer.ts legge.
  base: command === "serve" ? "/simulatore/" : "./",
  define: {
    "import.meta.env.VITE_CARDS_UI": JSON.stringify(command === "serve" ? "../cards/ui/" : "./catalog/cards/ui/"),
  },
  // La porta è fissa (è quella promessa dal README): le impostazioni del
  // client — stanza, mazzo, flag dell'engine — vivono nel localStorage
  // dell'origine, e un'origine che cambia porta le perderebbe a ogni avvio.
  server: { port: 5199, strictPort: true },
  build: {
    // La build del gioco, alla radice del sito pubblicato (dist/): la
    // completa scripts/build-site.mjs, che ci mette accanto il catalogo.
    // Non si committa.
    outDir: resolve(import.meta.dirname, "../dist"),
    emptyOutDir: true,
    target: "esnext",
  },
  plugins: [serveSiteCards()],
}));
