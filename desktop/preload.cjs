// Il ponte fra la finestra e il gioco: il gioco sa di essere sul desktop
// (window.rubyfront.desktop) e può chiudersi da sé («Esci dal gioco» nelle
// impostazioni). Nient'altro passa: il gioco non tocca Node né il disco.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rubyfront", {
  desktop: true,
  leave: () => ipcRenderer.send("rubyfront:leave"),
});
