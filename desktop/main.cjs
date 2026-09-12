// Rubyfront per desktop (F8): il gioco PixiJS (game/) in una finestra
// Electron, per Steam. Il gioco è lo stesso del sito: lo si costruisce in
// app/ con le carte, i suoni e la musica a bordo (scripts/prepare-app.mjs), e si
// serve da un protocollo suo, app://rubyfront/ — un'origine stabile (le
// impostazioni e il nome restano fra un avvio e l'altro), gli indirizzi
// relativi come sul sito, niente file:// e i suoi divieti. Online resta solo
// il tavolo Ruby (wss://…/engine): sempre online, deciso 2026-09-11.
//
//   npm run prepara && npm start        il gioco in finestra
//   npm run prova                       avvio, attesa della home, una foto, fuori (le verifiche)
//   --fullscreen                        a schermo intero (sullo Steam Deck lo è da sé)

const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require("electron");
const { writeFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const steam = require("./steam.cjs");

const APP_DIR = path.join(__dirname, "app");
const ORIGIN = "app://rubyfront";

// Il protocollo del gioco: standard e sicuro, così fetch, WebSocket e localStorage si comportano come su https.
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

/** app://rubyfront/<percorso> → app/<percorso>; fuori da app/ non si esce. */
function serve() {
  protocol.handle("app", request => {
    const url = new URL(request.url);
    let relative = decodeURIComponent(url.pathname);
    if (relative === "/" || relative === "") relative = "/index.html";
    const file = path.normalize(path.join(APP_DIR, relative));
    if (!file.startsWith(APP_DIR)) return new Response("fuori dal gioco", { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function pane() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: "#131013",
    title: "Rubyfront",
    autoHideMenuBar: true,
    fullscreen: process.argv.includes("--fullscreen") || steam.deck(),
    webPreferences: {
      // Un gioco online: in secondo piano i timer e la rete non si fermano (la partita va avanti, il bot e l'avversario pure).
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  // I link verso il web (il catalogo, il sito) si aprono nel browser; la finestra resta sul gioco.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });
  // F11 e Alt+Invio: lo schermo intero, come nei giochi.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11" || (input.key === "Enter" && input.alt)) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  void win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

/** --prova: si aspetta la home del gioco, si fotografa la finestra, si esce (0 se è andata, 1 se no). */
async function testHooks(win) {
  // Ciò che la pagina dice (errori compresi) finisce nel terminale: senza, una pagina ferma non si spiega.
  win.webContents.on("console-message", (...args) => {
    const detail = args[0] && typeof args[0] === "object" && "message" in args[0] ? args[0] : { level: args[1], message: args[2], sourceId: args[4] };
    console.log(`[pagina:${detail.level}] ${detail.message}${detail.sourceId ? ` (${detail.sourceId})` : ""}`);
  });
  win.webContents.on("did-fail-load", (_event, code, description, url) => console.log(`[carico fallito] ${code} ${description} ${url}`));
  win.webContents.on("render-process-gone", (_event, details) => console.log(`[renderer caduto] ${details.reason}`));
  const photo = async suffix => {
    const image = await win.webContents.capturePage();
    const file = (process.env.RUBYFRONT_PHOTO || path.join(app.getPath("temp"), "rubyfront-smoke.png")).replace(/\.png$/, `${suffix}.png`);
    writeFileSync(file, image.toPNG());
    return file;
  };
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const ready = await win.webContents.executeJavaScript("Boolean(window.__rubyfront && window.__rubyfront.screens)").catch(() => false);
    if (ready) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      const file = await photo("");
      const status = await win.webContents.executeJavaScript(
        "JSON.stringify({ home: window.__rubyfront.screens.home.isVisible(), cards: Object.keys(window.__rubyfront.match.session.state().cards).length, desktop: Boolean(window.rubyfront && window.rubyfront.desktop) })"
      );
      console.log(`prova: ok ${status} · foto ${file}`);
      // RUBYFRONT_SONDA: un'espressione da valutare nella pagina (le indagini), e una foto più tardi.
      if (process.env.RUBYFRONT_PROBE) {
        console.log(`sonda: ${await win.webContents.executeJavaScript(process.env.RUBYFRONT_PROBE).catch(error => String(error))}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log(`sonda (dopo 5 s): ${await win.webContents.executeJavaScript(process.env.RUBYFRONT_PROBE).catch(error => String(error))} · foto ${await photo("-after")}`);
      }
      app.exit(0);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const status = await win.webContents.executeJavaScript("JSON.stringify({ url: location.href, ready: document.readyState, canvas: document.querySelectorAll('canvas').length })").catch(error => String(error));
  console.log(`prova: la home non è arrivata in 60 secondi · ${status} · foto ${await photo("-stuck")}`);
  app.exit(1);
}

// «Esci dal gioco», dalle impostazioni del gioco (preload.cjs).
ipcMain.on("rubyfront:leave", () => app.quit());

app.whenReady().then(() => {
  steam.start();
  serve();
  const win = pane();
  if (process.argv.includes("--smoke")) void testHooks(win);
});

app.on("window-all-closed", () => app.quit());
