// Relay locale per il simulatore: un ponte, non un server di gioco.
//
// Tiene le connessioni raggruppate per stanza e ripete a tutti gli altri
// quello che riceve. Non legge i messaggi, non tiene stato, non sa cosa sia
// una carta. Quando servirà giocare fuori dalla LAN basterà rifare queste
// trenta righe su Cloudflare/Deno: il client non cambia (vedi src/net.ts).
//
//   node scripts/relay.mjs [porta]

import { createHash } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8787);
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** stanza -> Set di socket */
const rooms = new Map();

function encode(payload) {
  const data = Buffer.from(payload, "utf8");
  const length = data.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, data]);
}

function broadcast(room, sender, payload) {
  const peers = rooms.get(room);
  if (!peers) return;
  const frame = encode(payload);
  for (const peer of peers) {
    if (peer !== sender && peer.writable) peer.write(frame);
  }
}

function announce(room) {
  const peers = rooms.get(room);
  if (!peers) return;
  const frame = encode(JSON.stringify({ t: "peers", peers: peers.size }));
  for (const peer of peers) if (peer.writable) peer.write(frame);
}

const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end(`Relay Rubyfront attivo. Stanze aperte: ${rooms.size}\n`);
});

server.on("upgrade", (request, socket) => {
  const key = request.headers["sec-websocket-key"];
  if (!key) return socket.destroy();
  const room = new URL(request.url, "http://localhost").searchParams.get("room") ?? "default";
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true);

  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(socket);
  console.log(`+ ${room} (${rooms.get(room).size} collegati)`);
  announce(room);

  // I frame possono arrivare spezzati o incollati: si accumula e si consuma
  // solo quando il messaggio è completo. E un MESSAGGIO può a sua volta
  // arrivare spezzato in più frame (FIN=0 + continuazioni 0x0): Safari
  // frammenta i payload grossi — un mazzo intero, la lavagna — e inoltrare
  // solo il primo pezzo significherebbe consegnare JSON troncato.
  let buffer = Buffer.alloc(0);
  let parts = [];
  socket.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      if (masked) offset += 4;
      if (buffer.length < offset + length) return;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      buffer = buffer.subarray(offset + length);
      if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      if (opcode === 0x8) return socket.end();
      if (opcode === 0x9) socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
      if (opcode === 0x1 || (opcode === 0x0 && parts.length > 0)) {
        parts.push(payload);
        if (fin) {
          const whole = Buffer.concat(parts);
          parts = [];
          broadcast(room, socket, whole.toString("utf8"));
        }
      }
    }
  });

  const leave = () => {
    const peers = rooms.get(room);
    if (!peers) return;
    peers.delete(socket);
    if (peers.size === 0) rooms.delete(room);
    else announce(room);
    console.log(`- ${room} (${peers.size} collegati)`);
  };
  socket.on("close", leave);
  socket.on("error", leave);
});

server.listen(PORT, () => {
  console.log(`Relay Rubyfront su ws://localhost:${PORT}`);
  console.log("Stessa stanza = stessa partita. Ctrl+C per fermarlo.");
});
