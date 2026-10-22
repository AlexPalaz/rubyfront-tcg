// Un finto tavolo per le prove del proxy (scripts/test/server.test.mjs): un
// server TCP che risponde 200 a una GET semplice e, a un upgrade, rimanda
// in un 200 le intestazioni ricevute (in JSON), così la prova legge cosa il
// proxy ha inoltrato. Esce con 0 su SIGTERM; con FAKE_ENGINE_CRASH esce
// subito con quel codice.

import { createServer } from "node:net";

const port = Number(process.argv[2] ?? process.env.PORT ?? 8788);
const crash = process.env.FAKE_ENGINE_CRASH;
if (crash) process.exit(Number(crash));

const server = createServer(socket => {
  let text = "";
  socket.on("data", chunk => {
    text += chunk.toString("latin1");
    const end = text.indexOf("\r\n\r\n");
    if (end < 0) return;
    const lines = text.slice(0, end).split("\r\n");
    const [requestLine, ...headerLines] = lines;
    const headers = {};
    for (const line of headerLines) {
      const index = line.indexOf(":");
      if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
    }
    const body = JSON.stringify({ requestLine, headers });
    socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  });
  socket.on("error", () => {});
});
server.listen(port, "127.0.0.1", () => console.log(`Tavolo finto su ws://localhost:${port}`));
process.on("SIGTERM", () => process.exit(0));
