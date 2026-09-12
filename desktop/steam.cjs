// Steam (F8), se c'è: steamworks.js si carica solo quando il gioco ha un app
// id (RUBYFRONT_STEAM_APPID, o steam_appid.txt accanto all'eseguibile, come
// vuole Steam in sviluppo) e il pacchetto è installato (npm i steamworks.js).
// Senza, il gioco parte lo stesso: niente overlay, niente nome di Steam.
// Qui oggi solo l'avvio e l'overlay; obiettivi e cloud verranno con l'app id.

const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");

let client = null;

function appId() {
  const env = Number(process.env.RUBYFRONT_STEAM_APPID || 0);
  if (env) return env;
  for (const dir of [process.cwd(), path.dirname(process.execPath)]) {
    const file = path.join(dir, "steam_appid.txt");
    if (existsSync(file)) return Number(readFileSync(file, "utf8").trim()) || 0;
  }
  return 0;
}

function start() {
  const id = appId();
  if (!id) return null;
  try {
    const steamworks = require("steamworks.js");
    client = steamworks.init(id);
    steamworks.electronEnableSteamOverlay();
    console.log(`[steam] collegato: ${client.localplayer.getName()}`);
  } catch (error) {
    console.warn(`[steam] non disponibile: ${error.message}`);
    client = null;
  }
  return client;
}

/** Sullo Steam Deck (Steam mette SteamDeck=1 nell'ambiente) il gioco parte a schermo intero. */
function deck() {
  return process.env.SteamDeck === "1";
}

module.exports = { start, deck, client: () => client };
