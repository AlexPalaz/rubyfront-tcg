# Rubyfront su Steam — cosa serve

Il desktop è pronto (`desktop/`, vedi il README): finestra Electron, gioco
con carte a bordo, tavolo online, schermo intero, «Esci dal gioco», Steam
facoltativo. Per pubblicare mancano cose che **solo tu** puoi fare o
decidere. In ordine.

## 1. L'account e l'app (Steamworks)

1. **Account Steamworks** su partner.steamgames.com: registrazione come
   sviluppatore/editore, dati fiscali (per un residente in Italia il modulo
   W-8BEN nell'intervista fiscale), conto bancario per i pagamenti, verifica
   d'identità.
2. **Steam Direct**: 100 USD per app (tornano dopo 1000 USD di ricavi lordi).
3. **App ID** del gioco, che Steamworks assegna creando l'app — e, se li
   vuoi, gli App ID della **demo** o del **playtest**.
4. **Depot ID**, uno per sistema (Windows, macOS, Linux/SteamOS): si creano
   in Steamworks → SteamPipe → Depots. Vanno al posto di `APP_ID` e
   `DEPOT_ID_*` in `steam/app_build.vdf` e `steam/depot_*.vdf`.
5. **Un account «builder»** per caricare le build con `steamcmd`
   (consigliato un account dedicato, con Steam Guard e i soli permessi di
   upload).

## 2. Il servizio online

6. **Il tavolo sempre acceso.** Oggi è Render, piano free: si addormenta
   dopo un po' di inattività e il primo collegamento aspetta (~1 minuto).
   Per l'uscita serve un piano a pagamento (o un altro host) — lo avevi
   messo in conto («pagherò in futuro per Render»). Se l'indirizzo cambia,
   va in `VITE_ENGINE_URL` al momento di `npm run prepare-app`.
7. **Il dominio del sito** (quello di Vercel, `https://…/`): serve al link
   d'invito dal desktop, `RUBYFRONT_SITE=https://…/ npm run prepare-app`.
8. **Informativa privacy** (URL): il gioco manda al tavolo il nome scelto,
   le mosse e i messaggi della chat. Steam la chiede nella pagina.

## 3. La pagina del negozio

9. Nome, descrizione breve e lunga (italiano e inglese), generi, tag,
   **lingue** (interfaccia e testi: italiano, inglese), requisiti di
   sistema, prezzo, data d'uscita (o «prossimamente»), questionario sui
   contenuti (la classificazione), contatto di supporto.
10. **Le immagini**, nei formati di Steam:
    - capsule: header 920×430, small 462×174, main 1232×706, vertical 748×896;
    - libreria: capsule 600×900, hero 3840×1240, logo 1280×720 (trasparente), header 920×430;
    - icona dell'app 256×256 (anche `.ico` per Windows e `.icns` per macOS: electron-builder le prende da `desktop/build/`);
    - almeno 5 screenshot 1920×1080 (il gioco li fa a quella misura: `game/scripts/test-screens.mjs`);
    - trailer, se vuoi.

## 4. Le firme

11. **macOS**: Apple Developer ID (99 USD/anno) e notarizzazione — senza,
    macOS non apre l'app scaricata. Si configura in electron-builder
    (`mac.identity`, `notarize`).
12. **Windows**: un certificato di firma (OV/EV) è facoltativo su Steam
    (Steam non mostra SmartScreen), utile se distribuisci l'eseguibile anche
    fuori.

## 5. Steam Deck

13. **I controlli**: il gioco si gioca col puntatore e col tocco (lo schermo
    del Deck funziona). Da scegliere in Steamworks la configurazione
    consigliata (il modello «mouse e trackpad», o una tua).
14. **La leggibilità**: sul Deck (1280×800) il gioco scala a 0,67 — i testi
    da 16 unità diventano ~11 pixel. Valve verifica che il testo si legga:
    va provato sul Deck prima di chiedere il «Verificato».

## Già pronto, qui

- `desktop/`: Electron 44, electron-builder (cartelle per Windows, macOS,
  Linux), protocollo `app://`, schermo intero (F11, Alt+Invio, Deck), «Esci
  dal gioco», `steam.cjs` con steamworks.js facoltativo, `npm run smoke`.
- I modelli SteamPipe in `steam/`.

## Caricare una build (quando ci sono i dati)

```sh
cd desktop
RUBYFRONT_SITE=https://<dominio>/ npm run pack:win    # e :mac, :linux
# in steam/*.vdf: APP_ID e DEPOT_ID_* veri
steamcmd +login <builder> +run_app_build "$(pwd)/steam/app_build.vdf" +quit
```

Poi in Steamworks: la build sul ramo (`default` o una beta), le opzioni di
avvio (Windows `Rubyfront.exe`, macOS `Rubyfront.app`, Linux
`rubyfront-desktop`), la pubblicazione. Per provare Steam in locale prima
dell'uscita: `npm i steamworks.js` e un `steam_appid.txt` con l'App ID
accanto all'eseguibile.
