// Il proxy dell'upgrade WebSocket (2026-10-21, audit RF-025): le Origin
// ammesse e la richiesta da rimandare al tavolo Ruby — con l'indirizzo vero
// del client in `X-Forwarded-For`, mai quello che il client dichiara.

const STRIPPED = new Set(["x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "x-real-ip", "forwarded"]);

/** L'elenco delle Origin ammesse dall'ambiente: `RUBYFRONT_ORIGINS` (o `ALLOWED_ORIGINS`), separate da virgola; vuoto = tutte. */
export function originsFrom(env = process.env) {
  const raw = env.RUBYFRONT_ORIGINS ?? env.ALLOWED_ORIGINS ?? "";
  return raw.split(",").map(entry => entry.trim().toLowerCase()).filter(Boolean);
}

/**
 * Vero se l'Origin passa: senza elenco tutto (sviluppo); "*" apre tutto;
 * altrimenti schema://host[:porta] esatti, minuscoli, senza barra finale;
 * `null` e l'assenza non passano quando c'è l'elenco.
 */
export function originAllowed(origin, allowlist) {
  const list = (allowlist ?? []).map(entry => String(entry).trim().toLowerCase()).filter(Boolean);
  if (list.length === 0 || list.includes("*")) return true;
  if (typeof origin !== "string" || !origin || origin.toLowerCase() === "null") return false;
  return list.includes(origin.toLowerCase().replace(/\/+$/, ""));
}

/**
 * La richiesta da rimandare al tavolo, riga per riga: metodo, URL e versione
 * com'erano; le intestazioni com'erano, tolte quelle di inoltro che il client
 * potrebbe aver scritto; in coda `X-Forwarded-For` con l'indirizzo del socket.
 */
export function buildUpstreamRequest(method, url, httpVersion, rawHeaders, remoteAddress) {
  const lines = [`${method} ${url} HTTP/${httpVersion}`];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (STRIPPED.has(String(rawHeaders[i]).toLowerCase())) continue;
    lines.push(`${rawHeaders[i]}: ${rawHeaders[i + 1]}`);
  }
  // Un IPv4 mappato in IPv6 («::ffff:1.2.3.4») si scrive com'è davvero.
  lines.push(`X-Forwarded-For: ${String(remoteAddress ?? "").replace(/^::ffff:/i, "")}`);
  return lines.join("\r\n") + "\r\n\r\n";
}
