// Chat vocale fra i due posti, sopra il relay.
//
// Il relay non sa nulla nemmeno di questa: ripete i messaggi di segnalazione
// ("rtc") come tutto il resto, e l'audio viaggia poi DIRETTO fra i due
// browser via WebRTC. Due connessioni indipendenti, una per microfono: chi
// accende il proprio fa un'offerta, l'altro risponde e ascolta. Con due posti
// non servono negoziazioni perfette né rinegoziazioni: acceso/spento sono
// nascita e morte della connessione.
//
// Il microfono parte SEMPRE spento, e spegnerlo ferma le tracce davvero: la
// spia del browser si spegne, non resta un "muto" che ascolta.

import type { Seat } from "./types.js";

export type VoicePayload =
  | { kind: "offer"; owner: Seat; sdp: string }
  | { kind: "answer"; owner: Seat; sdp: string }
  | { kind: "ice"; owner: Seat; candidate: RTCIceCandidateInit | null }
  | { kind: "stop"; owner: Seat };

export interface Voice {
  /** Accende o spegne il proprio microfono. */
  toggle(): Promise<void>;
  enabled(): boolean;
  /** Segnalazione arrivata dall'altro posto. */
  receive(payload: VoicePayload): void;
  /** Spegne tutto, orecchio compreso: cambio stanza, chiusura. */
  shutdown(): void;
}

/** Uno STUN pubblico basta per LAN e NAT semplici; senza TURN, i NAT più
    ostili non passeranno — per quelli servirà un relay media, un altro
    giorno. */
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export function createVoice(options: {
  seat: () => Seat;
  /** Manda la segnalazione alla stanza; false se non c'è una stanza. */
  send: (payload: VoicePayload) => boolean;
  log: (text: string, seat?: Seat | null) => void;
  /** deviceId del microfono scelto nelle impostazioni ("" = predefinito). */
  micId: () => string;
  /** Livello del PROPRIO microfono, 0..1 già ammorbidito: per il VU meter
      sul tasto. Chiamato a ogni frame finché il microfono è acceso, e una
      volta con 0 allo spegnimento. */
  onLevel?: (level: number) => void;
}): Voice {
  let sendPc: RTCPeerConnection | null = null;
  let recvPc: RTCPeerConnection | null = null;
  let stream: MediaStream | null = null;
  let speaker: HTMLAudioElement | null = null;
  let meterCtx: AudioContext | null = null;
  let meterRaf = 0;
  let meterWake: (() => void) | null = null;

  /** Su iOS l'AudioContext nasce sospeso e si sveglia SOLO dentro un gesto
      dell'utente: va creato qui, in sincrono nel tap, PRIMA del prompt dei
      permessi che spezza la catena del gesto. Altrimenti il misuratore
      legge silenzio piatto e il VU resta a zero. */
  function primeMeter(): void {
    if (!options.onLevel || typeof AudioContext === "undefined") return;
    if (!meterCtx) meterCtx = new AudioContext();
    if (meterCtx.state === "suspended") void meterCtx.resume().catch(() => {});
  }

  /** Il misuratore: RMS del segnale, con attacco pronto e rilascio morbido. */
  function startMeter(source: MediaStream): void {
    if (!options.onLevel || typeof AudioContext === "undefined") return;
    // Bug WebKit (iOS): se il contesto non gira alla stessa frequenza del
    // microfono, la sorgente suona MUTA senza errori. Alla frequenza
    // sbagliata si butta e se ne crea uno giusto.
    const rate = source.getAudioTracks()[0]?.getSettings?.().sampleRate;
    if (meterCtx && rate && meterCtx.sampleRate !== rate) {
      void meterCtx.close().catch(() => {});
      meterCtx = null;
    }
    if (!meterCtx) {
      try {
        meterCtx = rate ? new AudioContext({ sampleRate: rate }) : new AudioContext();
      } catch {
        meterCtx = new AudioContext();
      }
    }
    const ctx = meterCtx;
    // Regola dei gesti di iOS: se il contesto resta sospeso, il prossimo
    // tocco sulla pagina lo sveglia. E se non si sveglia, lo si dice.
    meterWake = () => {
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    };
    meterWake();
    document.addEventListener("pointerdown", meterWake, { passive: true });
    window.setTimeout(() => {
      if (meterCtx === ctx && ctx.state !== "running") {
        options.log("Misuratore audio sospeso dal browser: un tocco sullo schermo lo attiva.");
      }
    }, 1500);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(source).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let smooth = 0;
    const tick = (): void => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const level = Math.min(1, Math.sqrt(sum / data.length) * 2.4);
      smooth = Math.max(level, smooth * 0.88);
      options.onLevel!(smooth);
      meterRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  function stopMeter(): void {
    if (meterWake) document.removeEventListener("pointerdown", meterWake);
    meterWake = null;
    cancelAnimationFrame(meterRaf);
    void meterCtx?.close().catch(() => {});
    meterCtx = null;
    options.onLevel?.(0);
  }

  const pcFor = (owner: Seat): RTCPeerConnection | null =>
    owner === options.seat() ? sendPc : recvPc;

  function stopSending(notify: boolean): void {
    stopMeter();
    if (notify && sendPc) options.send({ kind: "stop", owner: options.seat() });
    sendPc?.close();
    sendPc = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
  }

  async function start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      options.log("Chat vocale non disponibile qui: serve una pagina https (o localhost).");
      return;
    }
    const micId = options.micId();
    try {
      // deviceId "morbido" (ideal), mai exact: su iOS gli id dei microfoni
      // cambiano a ogni sessione e un exact su un id vecchio fallisce
      // subito e in silenzio.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: micId ? { deviceId: micId } : true,
      });
    } catch (error) {
      if (!micId) throw error;
      // Il microfono memorizzato non c'è più: si ripiega sul predefinito.
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    const track = stream.getAudioTracks()[0];
    options.log(`Microfono acceso: ${track?.label || "predefinito"}.`);
    startMeter(stream);
    const me = options.seat();
    sendPc = new RTCPeerConnection(RTC_CONFIG);
    for (const track of stream.getTracks()) sendPc.addTrack(track, stream);
    sendPc.onicecandidate = event => {
      options.send({ kind: "ice", owner: me, candidate: event.candidate?.toJSON() ?? null });
    };
    const offer = await sendPc.createOffer();
    await sendPc.setLocalDescription(offer);
    if (!options.send({ kind: "offer", owner: me, sdp: offer.sdp ?? "" })) {
      // Nessuna stanza collegata: un microfono acceso nel vuoto è solo spia.
      stopSending(false);
      options.log("Per la chat vocale serve essere in una stanza collegata.");
    }
  }

  function ear(): HTMLAudioElement {
    if (!speaker) {
      speaker = document.createElement("audio");
      speaker.autoplay = true;
      speaker.setAttribute("playsinline", "");
      speaker.hidden = true;
      document.body.append(speaker);
    }
    return speaker;
  }

  return {
    async toggle() {
      if (stream || sendPc) {
        stopSending(true);
        return;
      }
      primeMeter();
      try {
        await start();
      } catch (error) {
        stopSending(false);
        const name = error instanceof Error ? error.name : "";
        options.log(
          name === "NotAllowedError"
            ? "Microfono negato dal browser: serve il permesso."
            : `Microfono non attivato (${name || "errore sconosciuto"}).`
        );
      }
    },

    enabled: () => Boolean(stream),

    receive(payload) {
      switch (payload.kind) {
        case "offer": {
          // L'altro accende il microfono: si apre l'orecchio, anche se il
          // nostro resta spento.
          recvPc?.close();
          recvPc = new RTCPeerConnection(RTC_CONFIG);
          const owner = payload.owner;
          recvPc.onicecandidate = event => {
            options.send({ kind: "ice", owner, candidate: event.candidate?.toJSON() ?? null });
          };
          recvPc.ontrack = event => {
            const element = ear();
            element.srcObject = event.streams[0] ?? new MediaStream([event.track]);
            element.play().catch(() => {
              // Autoplay bloccato: il primo gesto sulla pagina lo sblocca.
              options.log("L'audio dell'avversario è pronto: un click sulla pagina lo attiva.");
            });
          };
          void (async () => {
            await recvPc!.setRemoteDescription({ type: "offer", sdp: payload.sdp });
            const answer = await recvPc!.createAnswer();
            await recvPc!.setLocalDescription(answer);
            options.send({ kind: "answer", owner, sdp: answer.sdp ?? "" });
          })().catch(() => options.log("Chat vocale: aggancio non riuscito."));
          break;
        }
        case "answer":
          if (payload.owner === options.seat()) {
            void sendPc?.setRemoteDescription({ type: "answer", sdp: payload.sdp }).catch(() => {});
          }
          break;
        case "ice": {
          const pc = pcFor(payload.owner);
          if (pc && payload.candidate) void pc.addIceCandidate(payload.candidate).catch(() => {});
          break;
        }
        case "stop":
          if (payload.owner !== options.seat()) {
            recvPc?.close();
            recvPc = null;
            if (speaker) speaker.srcObject = null;
          }
          break;
      }
    },

    shutdown() {
      stopSending(true);
      recvPc?.close();
      recvPc = null;
      if (speaker) speaker.srcObject = null;
    },
  };
}
