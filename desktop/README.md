# Rubyfront per desktop (Electron → Steam)

Il gioco PixiJS di `game/` in una finestra Electron, pronto per Steam (F8
della migrazione, 2026-09-12). Lo stesso gioco del sito: cambia solo come
arriva allo schermo.

- **Carte, suoni, musica a bordo.** `scripts/prepare-app.mjs` costruisce il
  gioco in `app/` (build di `game/` con `VITE_CARDS=./cards/`) e ci copia
  `docs/cards` (catalogo, illustrazioni, grafica: ~7 MB) accanto a suoni,
  musica e immagini della home (`simulator/public`, ~11 MB). Online resta
  solo il **tavolo Ruby** (`wss://rubyfront.onrender.com/engine`, o
  `VITE_ENGINE_URL`): sempre online, anche contro il bot (deciso
  2026-09-11).
- **Il protocollo `app://rubyfront/`** (`main.cjs`): il gioco non si apre da
  `file://` ma da un'origine sua, stabile — le impostazioni, il nome, il
  mazzo e le statistiche restano fra un avvio e l'altro, i fetch relativi
  vanno come sul sito, `fuori da app/` non si esce.
- **La finestra**: 1600×900 (minimo 1280×720), fondo del gioco, niente
  menu; F11 e Alt+Invio per lo schermo intero; sullo Steam Deck
  (`SteamDeck=1`) parte a schermo intero. I link web si aprono nel browser.
- **Il ponte** (`preload.cjs`): il gioco sa di stare sul desktop
  (`window.rubyfront.desktop`) e mostra «Esci dal gioco» nelle
  impostazioni. Nient'altro: niente Node nella pagina, sandbox acceso.
- **Steam** (`steam.cjs`): `steamworks.js` si carica solo se c'è un app id
  (`RUBYFRONT_STEAM_APPID` o `steam_appid.txt`) e il pacchetto è installato
  (`npm i steamworks.js`); senza, il gioco parte uguale. Oggi: avvio e
  overlay. Obiettivi e cloud quando c'è l'app.

Questa cartella **non è un workspace** della radice: Electron (~100 MB) non
si scarica su Vercel né in CI. Si installa a parte.

## Comandi

```sh
cd desktop
npm install                 # Electron ed electron-builder, solo qui
npm run prepare-app         # la build del gioco in app/ (tsc + vite + carte)
npm start                   # il gioco in finestra
npm run smoke               # avvio, attesa della home, una foto, fuori (le verifiche)
npm run pack                # l'eseguibile per questo sistema, in release/ (cartella, come vuole Steam)
npm run pack:win            # … Windows (meglio da Windows: la firma e le icone)
npm run pack:mac            # … macOS
npm run pack:linux          # … Linux / SteamOS
```

Variabili di `prepare-app`: `RUBYFRONT_SITE=https://<dominio>/` (il link
d'invito porta al gioco sul sito, `<dominio>/next/`: dal desktop l'indirizzo
della finestra a un amico non serve — senza, si entra comunque col nome
della stanza); `VITE_ENGINE_URL=ws://localhost:8788` per provare contro il
tavolo locale.

`app/`, `release/` e `steam/output/` non si committano (`.gitignore`).

## Steam

Cosa serve per pubblicare, e da chi: [STEAM.md](STEAM.md). I modelli di
SteamPipe stanno in `steam/` (`app_build.vdf`, `depot_*.vdf`, coi segnaposto
`APP_ID` e `DEPOT_ID_*`).
