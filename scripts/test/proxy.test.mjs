// Le Origin e la richiesta inoltrata (scripts/lib/proxy.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUpstreamRequest, originAllowed, originsFrom } from "../lib/proxy.mjs";

test("senza elenco ogni Origin passa; con «*» pure", () => {
  assert.equal(originAllowed("https://evil.example", []), true);
  assert.equal(originAllowed(undefined, []), true);
  assert.equal(originAllowed("https://evil.example", ["*"]), true);
});

test("con l'elenco passa solo l'Origin esatta, senza badare a maiuscole e barra finale", () => {
  const list = ["https://rubyfront.app", "http://localhost:5200"];
  assert.equal(originAllowed("https://rubyfront.app", list), true);
  assert.equal(originAllowed("HTTPS://Rubyfront.app/", list), true);
  assert.equal(originAllowed("http://localhost:5200", list), true);
  assert.equal(originAllowed("https://evil.example", list), false);
  assert.equal(originAllowed("https://rubyfront.app.evil.example", list), false);
});

test("null e l'assenza non passano con l'elenco", () => {
  assert.equal(originAllowed("null", ["https://rubyfront.app"]), false);
  assert.equal(originAllowed(undefined, ["https://rubyfront.app"]), false);
  assert.equal(originAllowed("", ["https://rubyfront.app"]), false);
});

test("originsFrom legge RUBYFRONT_ORIGINS, o ALLOWED_ORIGINS, a virgole", () => {
  assert.deepEqual(originsFrom({ RUBYFRONT_ORIGINS: " https://A.app, http://b " }), ["https://a.app", "http://b"]);
  assert.deepEqual(originsFrom({ ALLOWED_ORIGINS: "https://c" }), ["https://c"]);
  assert.deepEqual(originsFrom({ RUBYFRONT_ORIGINS: "https://a", ALLOWED_ORIGINS: "https://c" }), ["https://a"]);
  assert.deepEqual(originsFrom({}), []);
});

test("buildUpstreamRequest toglie le intestazioni di inoltro del client e mette l'indirizzo del socket", () => {
  const raw = ["Host", "rubyfront.onrender.com", "X-Forwarded-For", "9.9.9.9", "x-real-ip", "8.8.8.8", "Forwarded", "for=7.7.7.7", "Origin", "https://rubyfront.app", "Upgrade", "websocket"];
  const text = buildUpstreamRequest("GET", "/engine?room=x", "1.1", raw, "5.5.5.5");
  const lines = text.split("\r\n");
  assert.equal(lines[0], "GET /engine?room=x HTTP/1.1");
  assert.ok(lines.includes("Host: rubyfront.onrender.com"));
  assert.ok(lines.includes("Origin: https://rubyfront.app"));
  assert.ok(lines.includes("Upgrade: websocket"));
  assert.ok(lines.includes("X-Forwarded-For: 5.5.5.5"));
  assert.equal(lines.filter(line => /^x-forwarded-for/i.test(line)).length, 1);
  assert.equal(lines.some(line => /9\.9\.9\.9|8\.8\.8\.8|7\.7\.7\.7/.test(line)), false);
  assert.ok(text.endsWith("\r\n\r\n"));
  assert.ok(buildUpstreamRequest("GET", "/", "1.1", [], "::ffff:10.1.1.1").includes("X-Forwarded-For: 10.1.1.1"));
});
