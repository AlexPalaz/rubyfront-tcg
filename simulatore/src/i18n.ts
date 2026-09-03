// Le parole del simulatore, in due lingue. Una chiave per frase, i
// parametri fra graffe: `t("log.draw", { seat: "a", n: 2 })`. La lingua è
// quella scelta dal giocatore (ingranaggio → Lingua), e vale per tutto:
// interfaccia, chat, sigilli — le carte la seguono già dal catalogo.
//
// La chat viaggia come CHIAVI, non come frasi (ChatEntry.key/params): ogni
// giocatore la legge nella propria lingua, e i nomi delle carte nei
// parametri (`*Card` = id di catalogo) si risolvono dal suo catalogo.
// Niente DOM qui: la usano anche il riduttore (seatLabel) e i test.

import type { LogMsg, LogParams } from "./types.js";

export type Lang = "it" | "en";

let current: Lang = "it";

export function setLang(lang: string): void {
  current = lang === "en" ? "en" : "it";
}

export function lang(): Lang {
  return current;
}

export type Params = Record<string, string | number>;

export type { LogMsg };

export function msg(key: string, params?: LogParams): LogMsg {
  return params ? { key, params } : { key };
}

const M: Record<string, { it: string; en: string }> = {
  // ---- posti e nomi
  "seat.a": { it: "Giocatore A", en: "Player A" },
  "seat.b": { it: "Giocatore B", en: "Player B" },
  "seat.waiting": { it: "In attesa…", en: "Waiting…" },
  "seat.you": { it: "tu", en: "you" },
  "seat.name": { it: "{seat}", en: "{seat}" },
  "net.online": { it: "Collegato · {n} nella stanza", en: "Connected · {n} in the room" },
  "net.connecting": { it: "Mi sto collegando…", en: "Connecting…" },
  "net.offline": { it: "Non collegato — si gioca in locale", en: "Not connected — playing locally" },
  "invite.prompt": { it: "Copia il link d'invito:", en: "Copy the invite link:" },
  "log.seatclash": { it: "Attenzione: nella stanza ci sono due giocatori al posto {seat}. Uno dei due cambi posto (ingranaggio → Posto), poi «Sincronizza la lavagna».", en: "Warning: two players in the room sit at seat {seat}. One of them should change seat (gear → Seat), then “Sync the board”." },

  // ---- fasi
  "phase.preparazione": { it: "Preparazione", en: "Preparation" },
  "phase.fronte": { it: "Fase di Fronte", en: "Front Phase" },
  "phase.reazione": { it: "Reazione", en: "Reaction" },
  "phase.title.preparazione": { it: "Fase di Preparazione", en: "Preparation Phase" },
  "phase.title.fronte": { it: "Fase di Fronte", en: "Front Phase" },
  "phase.title.reazione": { it: "Fase di Reazione", en: "Reaction Phase" },
  "phase.end.preparazione": { it: "Fine Preparazione", en: "End Preparation" },
  "phase.end.fronte": { it: "Fine Fronte", en: "End Front" },
  "phase.end.reazione": { it: "Fine Reazione", en: "End Reaction" },
  "banner.turn.you": { it: "Turno {turn} · tocca a te", en: "Turn {turn} · your turn" },
  "banner.turn.them": { it: "Turno {turn} · {name}", en: "Turn {turn} · {name}" },
  "banner.defends.you": { it: "Turno {turn} · difendi tu", en: "Turn {turn} · you defend" },
  "banner.defends.them": { it: "Turno {turn} · difende {name}", en: "Turn {turn} · {name} defends" },

  // ---- fine partita
  "over.draw": { it: "Pareggio", en: "Draw" },
  "over.won": { it: "Hai vinto", en: "You win" },
  "over.victory": { it: "Vittoria di {name}", en: "{name} wins" },
  "over.hp": { it: "PV del Rubyfront a zero (§2)", en: "Rubyfront HP at zero (§2)" },
  "over.deck": { it: "mazzo esaurito (§9.1)", en: "deck exhausted (§9.1)" },
  "over.both": { it: "PV a zero per entrambi (§9.2)", en: "both at zero HP (§9.2)" },

  // ---- HUD
  "hud.hp": { it: "Punti Vita", en: "Health" },
  "hud.hp.unit": { it: "PV", en: "HP" },
  "hud.flux": { it: "Flusso", en: "Flux" },
  "hud.step.less": { it: "{what}: uno in meno", en: "{what}: one less" },
  "hud.step.more": { it: "{what}: uno in più", en: "{what}: one more" },
  "hud.turn": { it: "Turno {turn}", en: "Turn {turn}" },
  "hud.turn.less": { it: "Turno: uno in meno", en: "Turn: one less" },
  "hud.turn.more": { it: "Turno: uno in più", en: "Turn: one more" },
  "hud.turn.you": { it: "▼ tocca a te", en: "▼ your turn" },
  "hud.token.held": { it: "Gettone Flusso in mano: clicca per spenderlo (+1 Flusso, anche oltre 20)", en: "Flux Token held: click to spend it (+1 Flux, even past 20)" },
  "hud.token.none": { it: "Nessun Gettone Flusso: clicca per darlo (a chi non inizia, §3.2)", en: "No Flux Token: click to grant it (to whoever doesn't start, §3.2)" },
  "hud.front": { it: "Fase di Fronte", en: "Front Phase" },
  "hud.defender": { it: "Al difensore", en: "To the defender" },
  "hud.endturn": { it: "Fine turno", en: "End turn" },
  "hud.endturn.tip": { it: "Passa il turno: Flusso massimo +1 e ricarica per chi entra (§3.2)", en: "Pass the turn: max Flux +1 and a refill for whoever comes in (§3.2)" },
  "hud.endturn.theirs": { it: "Tocca all'avversario: il Fine turno adesso è suo", en: "It's the opponent's turn: the End turn is theirs now" },
  "hud.over": { it: "Partita finita: Nuova partita per ricominciare", en: "Game over: New game to start again" },
  "hud.phase.theirs": { it: "Tocca all'avversario: le fasi le chiude chi è di turno", en: "It's the opponent's turn: phases are closed by the active player" },
  "hud.phase.defender": { it: "La Reazione la chiude chi difende (§6.4)", en: "The Reaction is closed by the defender (§6.4)" },
  "hud.phase.tip.preparazione": { it: "Chiude la Preparazione: si apre la Fase di Fronte (§6.3)", en: "Closes the Preparation: the Front Phase opens (§6.3)" },
  "hud.phase.tip.fronte.wave": { it: "Chiude il Fronte: l'ondata passa al difensore (§6.4)", en: "Closes the Front: the wave passes to the defender (§6.4)" },
  "hud.phase.tip.fronte.none": { it: "Chiude il Fronte senza attacchi: fine del turno (§6.5)", en: "Closes the Front with no attacks: end of turn (§6.5)" },
  "hud.phase.tip.reazione.wave": { it: "Chiude la Reazione: risolve le battaglie (§6.4) e chiude il turno", en: "Closes the Reaction: resolves the battles (§6.4) and ends the turn" },
  "hud.phase.tip.reazione.none": { it: "Chiude la Reazione: fine del turno (§6.5)", en: "Closes the Reaction: end of turn (§6.5)" },
  "hud.front.tip.theirs": { it: "Tocca all'avversario: le fasi le dichiara chi è di turno", en: "It's the opponent's turn: phases are declared by the active player" },
  "hud.front.tip.preparazione": { it: "Dichiara la Fase di Fronte: apre il combattimento (§6.3)", en: "Declare the Front Phase: opens combat (§6.3)" },
  "hud.front.tip.fronte": { it: "Ondata completa: passa la parola al difensore (§6.4)", en: "Wave complete: pass the word to the defender (§6.4)" },
  "hud.front.tip.reazione": { it: "Reazione aperta: il difensore blocca; risolvete, poi Fine turno", en: "Reaction open: the defender blocks; resolve, then End turn" },
  "hud.chat": { it: "Apri e chiudi la chat", en: "Open and close the chat" },
  "hud.mic.on": { it: "Microfono acceso: clicca per spegnerlo", en: "Microphone on: click to turn it off" },
  "hud.mic.off": { it: "Attiva il microfono (chat vocale)", en: "Turn the microphone on (voice chat)" },
  "hud.shuffle": { it: "Mescola", en: "Shuffle" },
  "hud.shuffle.tip": { it: "Mescola il tuo mazzo", en: "Shuffle your deck" },
  "hud.draw": { it: "Pesca", en: "Draw" },
  "hud.draw.tip": { it: "Pesca 1 carta", en: "Draw 1 card" },
  "hud.search": { it: "Cerca", en: "Search" },
  "hud.search.tip": { it: "Cerca una carta nel mazzo", en: "Search the deck for a card" },
  "hud.die.tip": { it: "Tira il d{n}", en: "Roll the d{n}" },
  "hud.grip": { it: "Trascina per spostare l'HUD · doppio click per rimetterlo al posto suo", en: "Drag to move the HUD · double-click to put it back" },
  "hud.min": { it: "Riduci l'HUD a icona", en: "Minimise the HUD" },
  "hud.max": { it: "Espandi l'HUD · trascina per spostarlo", en: "Expand the HUD · drag to move it" },
  "hud.spawn": { it: "Evoca", en: "Summon" },
  "hud.spawn.tip": { it: "Prova: evoca in mano una carta del catalogo", en: "Test: summon any catalogue card into your hand" },

  // ---- tavolo
  "zone.abisso": { it: "Abisso", en: "Abyss" },
  "zone.ritiro": { it: "Ritiro", en: "Retire" },
  "zone.deck": { it: "Mazzo", en: "Deck" },
  "zone.hand": { it: "Mano", en: "Hand" },
  "zone.ritiro.full": { it: "Zona di Ritiro", en: "Retire Zone" },
  "zone.richiamo": { it: "Zona di Richiamo", en: "Recall Zone" },
  "zone.control": { it: "Controllo", en: "Control" },
  "zone.front": { it: "Fronte", en: "Front" },
  "zone.rubyfront": { it: "Rubyfront", en: "Rubyfront" },
  "zone.materie": { it: "Materie", en: "Matters" },
  "hand.open": { it: "Apri la mano", en: "Open the hand" },
  "hand.close": { it: "Chiudi la mano", en: "Close the hand" },
  "hand.mine": { it: "La tua mano · {n}", en: "Your hand · {n}" },
  "hand.excess": { it: " — scarta fino a 7 prima del Fine turno (§6.5)", en: " — discard down to 7 before End turn (§6.5)" },
  "hand.waiting": { it: "In attesa di un avversario…", en: "Waiting for an opponent…" },
  "hand.theirs": { it: "Mano di {name} · {n}", en: "{name}'s hand · {n}" },
  "label.you": { it: " · tu", en: " · you" },
  "target.esc": { it: "{hint} — Esc rinuncia", en: "{hint} — Esc to give up" },
  "target.block": { it: "Scegli l'Entità che blocca — Esc annulla", en: "Choose the blocking Entity — Esc cancels" },
  "target.counter": { it: "Scegli l'Entità che contrattacca — Esc annulla", en: "Choose the counterattacking Entity — Esc cancels" },
  "target.retire": { it: "Scegli l'Entità avversaria da mandare nella Zona di Ritiro", en: "Choose the opposing Entity to send to the Retire Zone" },
  "target.control": { it: "Scegli l'Entità avversaria di cui prendere il controllo", en: "Choose the opposing Entity to take control of" },
  "confirm.retire": { it: "Mandare {card} nella Zona di Ritiro?", en: "Send {card} to the Retire Zone?" },
  "confirm.return": { it: "Riportare {card} sul Fronte?", en: "Bring {card} back to the Front?" },
  "confirm.control": { it: "Prendere il controllo di {card} fino a fine turno?", en: "Take control of {card} until end of turn?" },
  "confirm.yes": { it: "Conferma", en: "Confirm" },
  "confirm.no": { it: "Annulla", en: "Cancel" },
  "pick.return": { it: "Scegli la carta permanente da riportare sul Fronte", en: "Choose the permanent card to bring back to the Front" },
  "pick.look.some": { it: "Le prime {n} del mazzo: puoi mostrarne {what} e prenderla in mano — Chiudi per nessuna", en: "The top {n} of your deck: you may reveal {what} and take it in hand — Close for none" },
  "pick.look.none": { it: "Le prime {n} del mazzo: nessuna da mostrare — Chiudi per andare avanti", en: "The top {n} of your deck: nothing to reveal — Close to go on" },
  "pick.look.object": { it: "un Oggetto", en: "an Object" },
  "pick.look.one": { it: "una", en: "one" },
  "pick.retire": { it: "Scegli la carta da mettere nella tua Zona di Ritiro (obbligatoria)", en: "Choose the card to put in your Retire Zone (required)" },
  "dice.deploy": { it: "Schieramento del Rubyfront", en: "Rubyfront deployment" },
  "dice.look": { it: "{name} · quante carte guardare", en: "{name} · how many cards to look at" },
  "dice.look.short": { it: "Quante carte guardare", en: "How many cards to look at" },

  // ---- menu della carta
  "menu.attack": { it: "Attacca", en: "Attack" },
  "menu.attack.undo": { it: "Annulla attacco ({n})", en: "Undo attack ({n})" },
  "menu.counter.undo": { it: "Annulla contrattacco", en: "Undo counterattack" },
  "menu.block.undo": { it: "Annulla blocco", en: "Undo block" },
  "menu.block": { it: "Blocca con…", en: "Block with…" },
  "menu.counter": { it: "Contrattacca con…", en: "Counterattack with…" },
  "menu.tap": { it: "Tappa", en: "Tap" },
  "menu.untap": { it: "Stappa", en: "Untap" },
  "menu.cover": { it: "Copri", en: "Cover" },
  "menu.uncover": { it: "Scopri", en: "Uncover" },
  "menu.flip.nexus": { it: "Flip → Nexus", en: "Flip → Nexus" },
  "menu.flip.rubyfront": { it: "Flip → Rubyfront", en: "Flip → Rubyfront" },
  "menu.to.hand": { it: "In mano", en: "To hand" },
  "menu.to.field": { it: "Sul Fronte", en: "To the Front" },
  "menu.to.abisso": { it: "Nell'Abisso", en: "To the Abyss" },
  "menu.to.ritiro": { it: "In Zona di Ritiro", en: "To the Retire Zone" },
  "menu.to.deck.top": { it: "In cima al mazzo", en: "On top of the deck" },
  "menu.to.deck.bottom": { it: "In fondo al mazzo", en: "To the bottom of the deck" },
  "menu.draw1": { it: "Pesca 1", en: "Draw 1" },
  "menu.draw6": { it: "Pesca 6 (mano iniziale)", en: "Draw 6 (opening hand)" },
  "menu.shuffle": { it: "Mescola", en: "Shuffle" },
  "menu.search": { it: "Cerca nel mazzo ({n})", en: "Search the deck ({n})" },
  "menu.browse": { it: "Sfoglia ({n})", en: "Browse ({n})" },

  // ---- finestra della ricerca
  "overlay.deck": { it: "Cerca nel mazzo", en: "Search the deck" },
  "overlay.filter": { it: "Filtra per nome o testo…", en: "Filter by name or text…" },
  "overlay.close": { it: "Chiudi", en: "Close" },
  "overlay.empty": { it: "Nessuna carta.", en: "No cards." },
  "overlay.shuffle": { it: " mescola alla chiusura", en: " shuffle on close" },
  "overlay.title": { it: "{zone} · {name}", en: "{zone} · {name}" },
  "overlay.catalog": { it: "Catalogo · evoca in mano a {name} (prova)", en: "Catalogue · summon into {name}'s hand (test)" },

  // ---- scena d'ingresso
  "scene.enter.effect": { it: "Quando entra in campo", en: "When it enters the field" },
  "scene.enter": { it: "Entra in campo", en: "Enters the field" },
  "scene.attack": { it: "Quando attacca", en: "When it attacks" },
  "scene.plays": { it: "{name} gioca {card}", en: "{name} plays {card}" },
  "scene.attacks": { it: "{name} attacca con {card}", en: "{name} attacks with {card}" },
  "scene.triggers": { it: "Si innesca", en: "Triggers" },
  "scene.resolve": { it: "Risolvi", en: "Resolve" },
  "scene.continue": { it: "Continua", en: "Continue" },
  "trigger.draw": { it: "{card} si innesca: pesca {n} {cards}", en: "{card} triggers: draw {n} {cards}" },
  "trigger.retire": { it: "{card} si innesca: metti un'Entità avversaria nella Zona di Ritiro", en: "{card} triggers: put an opposing Entity in the Retire Zone" },
  "trigger.return": { it: "{card} si innesca: metti sul tuo Fronte una carta permanente dalla tua Zona di Ritiro", en: "{card} triggers: put a permanent card from your Retire Zone onto your Front" },
  "trigger.look": { it: "{card} si innesca: guarda le prime {n} carte del mazzo", en: "{card} triggers: look at the top {n} cards of the deck" },
  "trigger.look.die": { it: "{card} si innesca: tira un d{die} e guarda {base} più metà del tiro carte del mazzo", en: "{card} triggers: roll a d{die} and look at {base} plus half the roll cards of the deck" },
  "trigger.control": { it: "{card} si innesca: prendi il controllo di un'Entità avversaria fino a fine turno", en: "{card} triggers: take control of an opposing Entity until end of turn" },
  "trigger.attackdraw": { it: "{card} si innesca: pesca {n} {cards}", en: "{card} triggers: draw {n} {cards}" },
  "trigger.attackdraw.discard": { it: "{card} si innesca: pesca {n} {cards}, poi scarta {m}", en: "{card} triggers: draw {n} {cards}, then discard {m}" },
  "pick.discard": { it: "Scegli la carta da scartare (obbligatoria)", en: "Choose the card to discard (required)" },
  "log.effect.discard": { it: "{seat}: {sourceCard} scarta {card}.", en: "{seat}: {sourceCard} discards {card}." },
  "cards.one": { it: "carta", en: "card" },
  "cards.many": { it: "carte", en: "cards" },

  // ---- sigillo dell'arbitro
  "stop.title": { it: "Azione fermata", en: "Action stopped" },
  "stop.ok": { it: "Va bene", en: "All right" },
  "stop.ref": { it: "Manuale · §{ref}", en: "Manual · §{ref}" },
  "stop.default": { it: "l'azione «{action}» viola una regola del manuale", en: "the action “{action}” breaks a rule of the manual" },

  // ---- engine e voce
  "engine.online": { it: "Engine collegato", en: "Engine connected" },
  "engine.connecting": { it: "Engine: mi sto collegando…", en: "Engine: connecting…" },
  "engine.offline": { it: "Engine non raggiungibile", en: "Engine unreachable" },
  "voice.insecure": { it: "Chat vocale non disponibile qui: serve una pagina https (o localhost).", en: "Voice chat isn't available here: it needs an https page (or localhost)." },
  "voice.stuck": { it: "Il microfono non risponde. Chiudi la scheda e riaprila; su iPad: menu aA → Impostazioni sito web → Microfono → Consenti.", en: "The microphone isn't responding. Close the tab and reopen it; on iPad: aA menu → Website Settings → Microphone → Allow." },
  "voice.noroom": { it: "Per la chat vocale serve essere in una stanza collegata.", en: "Voice chat needs a connected room." },
  "voice.denied": { it: "Microfono negato dal browser: serve il permesso.", en: "Microphone denied by the browser: permission is needed." },
  "voice.failed": { it: "Microfono non attivato ({error}).", en: "Microphone not enabled ({error})." },
  "voice.unknown": { it: "errore sconosciuto", en: "unknown error" },
  "voice.ready": { it: "L'audio dell'avversario è pronto: un click sulla pagina lo attiva.", en: "The opponent's audio is ready: a click on the page turns it on." },
  "voice.hookfail": { it: "Chat vocale: aggancio non riuscito.", en: "Voice chat: connection failed." },
  "voice.meter": { it: "Misuratore audio sospeso dal browser: un tocco sullo schermo lo attiva.", en: "Audio meter suspended by the browser: a tap on the screen turns it on." },
  "voice.on": { it: "Microfono acceso: {name}.", en: "Microphone on: {name}." },
  "voice.default": { it: "predefinito", en: "default" },

  // ---- chat
  "chat.placeholder": { it: "Scrivi…", en: "Type…" },
  "chat.send": { it: "Invia", en: "Send" },
  "copied": { it: "Copiato ✓", en: "Copied ✓" },
  "copylink": { it: "Copia link", en: "Copy link" },

  // ---- righe di chat (log)
  "log.front": { it: "{seat} dichiara la Fase di Fronte.", en: "{seat} declares the Front Phase." },
  "log.reaction": { it: "{seat} passa al difensore: Fase di Reazione.", en: "{seat} passes to the defender: Reaction Phase." },
  "log.resolve.manual": { it: "Risoluzione a mano: a qualche carta manca la Potenza nel catalogo.", en: "Manual resolution: some card is missing its Power in the catalogue." },
  "log.battle.unblocked": { it: "Battaglia {n}: {attackerCard} non è bloccato — {damage} danni al Rubyfront.", en: "Battle {n}: {attackerCard} is unblocked — {damage} damage to the Rubyfront." },
  "log.battle.block": { it: "Battaglia {n}: {blockerCard} blocca {attackerCard} — {fate}.", en: "Battle {n}: {blockerCard} blocks {attackerCard} — {fate}." },
  "log.battle.counter": { it: "Battaglia {n}: {blockerCard} contrattacca {attackerCard} — {fate}.", en: "Battle {n}: {blockerCard} counterattacks {attackerCard} — {fate}." },
  "fate.both": { it: "muoiono entrambi", en: "both die" },
  "fate.attacker": { it: "l'attaccante muore", en: "the attacker dies" },
  "fate.blocker": { it: "il bloccante muore", en: "the blocker dies" },
  "fate.none": { it: "non muore nessuno", en: "nobody dies" },
  "log.damage": { it: "{seat} subisce {damage} danni (PV {hp}).", en: "{seat} takes {damage} damage (HP {hp})." },
  "log.deckout": { it: "{title}: {seat} ha esaurito il mazzo — {detail}.", en: "{title}: {seat} has exhausted the deck — {detail}." },
  "log.over": { it: "{title} — {detail}.", en: "{title} — {detail}." },
  "log.turn": { it: "Turno {turn} — tocca a {seat} (Flusso {flux}/{max}).", en: "Turn {turn} — {seat} to play (Flux {flux}/{max})." },
  "log.token.get": { it: "{seat} riceve il Gettone Flusso.", en: "{seat} receives the Flux Token." },
  "log.token.spend": { it: "{seat} spende il Gettone Flusso (+1 Flusso, fuori dal limite).", en: "{seat} spends the Flux Token (+1 Flux, past the cap)." },
  "log.roll": { it: "{seat} tira d{die}: {roll}", en: "{seat} rolls d{die}: {roll}" },
  "log.notarget": { it: "{seat} non ha il Rubyfront in campo: nessun bersaglio.", en: "{seat} has no Rubyfront on the field: no target." },
  "log.attack": { it: "{seat} attacca ({n}).", en: "{seat} attacks ({n})." },
  "log.block": { it: "{seat} blocca.", en: "{seat} blocks." },
  "log.counter": { it: "{seat} contrattacca.", en: "{seat} counterattacks." },
  "log.undo.attack": { it: "{seat} annulla l'attacco.", en: "{seat} calls off the attack." },
  "log.undo.block": { it: "{seat} annulla il blocco.", en: "{seat} calls off the block." },
  "log.undo.counter": { it: "{seat} annulla il contrattacco.", en: "{seat} calls off the counterattack." },
  "log.effect.return": { it: "{seat}: {sourceCard} riporta {card} sul Fronte.", en: "{seat}: {sourceCard} brings {card} back to the Front." },
  "log.effect.look": { it: "{seat}: {sourceCard} {parts}.", en: "{seat}: {sourceCard} {parts}." },
  "look.rolled": { it: "tira d{die} → {roll}, guarda {n} carte", en: "rolls d{die} → {roll}, looks at {n} cards" },
  "look.looked": { it: "guarda {n} carte", en: "looks at {n} cards" },
  "look.reveal": { it: "mostra {card} e la prende in mano", en: "reveals {card} and takes it in hand" },
  "look.noreveal": { it: "non mostra nulla", en: "reveals nothing" },
  "look.retire": { it: "{card} va nella Zona di Ritiro", en: "{card} goes to the Retire Zone" },
  "look.rest": { it: "le altre in fondo al mazzo", en: "the rest to the bottom of the deck" },
  "log.effect.retire": { it: "{seat}: {sourceCard} manda {card} nella Zona di Ritiro.", en: "{seat}: {sourceCard} sends {card} to the Retire Zone." },
  "log.effect.trigger": { it: "{seat}: {card} si innesca: pesca {n} {cards}.", en: "{seat}: {card} triggers: draws {n} {cards}." },
  "log.effect.control": { it: "{seat}: {sourceCard} prende il controllo di {card} fino a fine turno.", en: "{seat}: {sourceCard} takes control of {card} until end of turn." },
  "log.release.front": { it: "{card} torna a {seat}.", en: "{card} returns to {seat}." },
  "log.release.retire": { it: "{card} torna a {seat}, nella Zona di Ritiro: il Fronte è pieno.", en: "{card} returns to {seat}, in the Retire Zone: the Front is full." },
  "log.deck.empty": { it: "{seat}: mazzo vuoto, nessuna pesca.", en: "{seat}: empty deck, no draw." },
  "log.draw": { it: "{seat} pesca {n} {cards}.", en: "{seat} draws {n} {cards}." },
  "log.shuffle": { it: "{seat} mescola il mazzo ({n} carte).", en: "{seat} shuffles the deck ({n} cards)." },
  "log.play": { it: "{seat} gioca {card} per {cost} (Flusso {flux}/{max}).{effects}", en: "{seat} plays {card} for {cost} (Flux {flux}/{max}).{effects}" },
  "log.deploy.nodie": { it: "{seat}: il d{die} non si tira — servono {die} Flussi disponibili, ne ha {available} (§3.1).", en: "{seat}: the d{die} can't be rolled — it takes {die} available Flux, they have {available} (§3.1)." },
  "log.deploy": { it: "{seat} schiera il Rubyfront, paga {cost} (Flusso {flux}/{max}{token}).", en: "{seat} deploys the Rubyfront, pays {cost} (Flux {flux}/{max}{token})." },
  "log.deploy.roll": { it: "{seat} schiera il Rubyfront: d{die} → {roll}, paga {cost} (Flusso {flux}/{max}{token}).", en: "{seat} deploys the Rubyfront: d{die} → {roll}, pays {cost} (Flux {flux}/{max}{token})." },
  "log.token.plus": { it: " + Gettone", en: " + Token" },
  "log.no.permanent": { it: "{seat}: {card} non ha carte permanenti nella Zona di Ritiro.", en: "{seat}: {card} has no permanent cards in the Retire Zone." },
  "log.no.control": { it: "{seat}: {card} non ha Entità avversarie da prendere.", en: "{seat}: {card} has no opposing Entities to take." },
  "log.look.empty": { it: "{seat}: {card} guarda un mazzo vuoto.", en: "{seat}: {card} looks at an empty deck." },
  "log.no.target": { it: "{seat}: {card} non ha bersagli in campo.", en: "{seat}: {card} has no targets on the field." },
  "log.assign": { it: "{seat} assegna {card} a {toCard}.", en: "{seat} assigns {card} to {toCard}." },
  "log.keep.owner": { it: "{seat}: la carta resta al suo proprietario.", en: "{seat}: the card stays with its owner." },
  "log.mic": { it: "{seat} {onoff} il microfono.", en: "{seat} turns the microphone {onoff}." },
  "mic.on": { it: "accende", en: "on" },
  "mic.off": { it: "spegne", en: "off" },
  "log.loaded": { it: "{seat}: caricato «{name}» ({n} carte).", en: "{seat}: loaded “{name}” ({n} cards)." },
  "log.opening": { it: "{seat}: mano iniziale pescata{opens}.", en: "{seat}: opening hand drawn{opens}." },
  "log.opens": { it: " — apre la partita, pesca anche la carta del turno 1", en: " — opens the game, and draws the turn 1 card too" },
  "log.newgame": { it: "Nuova partita: inizia {seat}, il Gettone Flusso va a {otherSeat} (§4).", en: "New game: {seat} starts, the Flux Token goes to {otherSeat} (§4)." },
  "log.deck.empty.short": { it: "{seat}: mazzo vuoto.", en: "{seat}: empty deck." },
  "log.draw1": { it: "{seat} pesca 1 carta.", en: "{seat} draws 1 card." },
  "log.sent": { it: "Lavagna inviata all'avversario.", en: "Board sent to the opponent." },
  "log.engine.hello": { it: "Engine collegato (v{version}): {rules}", en: "Engine connected (v{version}): {rules}" },
  "log.engine.none": { it: "osserva soltanto, nessuna regola attiva.", en: "watching only, no rules active." },
  "log.engine.rules": { it: "regole attive — {list}.", en: "active rules — {list}." },
  "log.engine.violation": { it: "Engine: l'azione avversaria «{action}» viola una regola{reason}.", en: "Engine: the opponent's action “{action}” breaks a rule{reason}." },
  "log.take": { it: "{seat} prende una carta da {zone}.", en: "{seat} takes a card from {zone}." },
  "log.spawn": { it: "{seat} evoca in mano «{id}» (prova).", en: "{seat} summons “{id}” into hand (test)." },
  "log.reshuffle": { it: "{seat} rimescola dopo la ricerca.", en: "{seat} reshuffles after the search." },
  "log.newgame.done": { it: "Nuova partita.", en: "New game." },

  // ---- pagina (index.html, data-i18n)
  "html.engine.off": { it: "Engine spento", en: "Engine off" },
  "html.net.off": { it: "Non collegato", en: "Not connected" },
  "html.newgame": { it: "Nuova partita", en: "New game" },
  "html.settings": { it: "Impostazioni", en: "Settings" },
  "html.deck": { it: "Mazzo", en: "Deck" },
  "html.deck.tip": { it: "Mazzo da caricare al tuo posto", en: "Deck to load at your seat" },
  "html.load": { it: "Carica", en: "Load" },
  "html.seat": { it: "Posto", en: "Seat" },
  "html.room": { it: "Stanza", en: "Room" },
  "html.room.ph": { it: "nome stanza", en: "room name" },
  "html.join": { it: "Entra", en: "Join" },
  "html.invite": { it: "Invito", en: "Invite" },
  "html.room.create": { it: "Crea stanza", en: "Create room" },
  "html.copylink": { it: "Copia link", en: "Copy link" },
  "html.engine.tip": { it: "L'arbitro esterno (engine/): giudica le azioni prima che si applichino; assente, il tavolo resta libero", en: "The external referee (engine/): judges actions before they apply; absent, the table stays free" },
  "html.engine.on": { it: "Acceso", en: "On" },
  "html.net": { it: "Rete", en: "Network" },
  "html.sync": { it: "Sincronizza la lavagna", en: "Sync the board" },
  "html.sync.tip": { it: "Rimanda il tuo tavolo all'avversario, se le due lavagne si sono disallineate", en: "Send your table to the opponent again, if the two boards drifted apart" },
  "html.mic": { it: "Microfono", en: "Microphone" },
  "html.mic.tip": { it: "Microfono per la chat vocale", en: "Microphone for the voice chat" },
  "html.mic.default": { it: "Predefinito", en: "Default" },
  "html.view": { it: "Vista", en: "View" },
  "html.compact": { it: "Compatta: sul campo solo costo, nome, potenza e illustrazione", en: "Compact: on the field only cost, name, power and artwork" },
  "html.theme": { it: "Tema", en: "Theme" },
  "html.theme.tip": { it: "Tema del tavolo", en: "Table theme" },
  "html.lang": { it: "Lingua", en: "Language" },
  "html.lang.tip": { it: "Lingua del tavolo e delle carte", en: "Language of the table and the cards" },
  "html.ob.ask": { it: "Benvenuto al tavolo. Per giocare con qualcuno serve una stanza:", en: "Welcome to the table. To play with someone you need a room:" },
  "html.ob.create": { it: "Crea una stanza", en: "Create a room" },
  "html.ob.or": { it: "oppure entra in una stanza che conosci", en: "or join a room you know" },
  "html.ob.local": { it: "Gioca in locale, senza stanza", en: "Play locally, without a room" },
  "html.ob.name": { it: "Il tuo nome al tavolo", en: "Your name at the table" },
  "html.ob.name.ph": { it: "es. Ajmal", en: "e.g. Ajmal" },
  "html.ob.deck": { it: "Il mazzo con cui giochi", en: "The deck you play with" },
  "html.ob.deck.b": { it: "Il mazzo dell'avversario", en: "The opponent's deck" },
  "html.ob.go": { it: "Al tavolo", en: "To the table" },
  "html.side.close": { it: "Chiudi la chat e allarga il tavolo", en: "Close the chat and widen the table" },
  "html.boot": { it: "Carico le carte…", en: "Loading the cards…" },
  "html.ob.local.note": { it: "Partita locale: guiderai entrambi i posti del tavolo.", en: "Local game: you'll drive both seats at the table." },
  "html.ob.room.note": { it: "Sei nella stanza «{room}». Ancora due cose:", en: "You're in room “{room}”. Two more things:" },
  "html.newgame.confirm": { it: "Nuova partita: tavolo, contatori e chat vengono azzerati. Procedo?", en: "New game: table, counters and chat are reset. Go ahead?" },
  "html.seatclash": { it: "Nella stanza c'è un altro client seduto dove sei tu: le sue mosse vengono ignorate. Cambia posto dalle impostazioni.", en: "Another client in the room is sitting where you are: its moves are ignored. Change seat in the settings." },
};

/** La frase per `key`, con i parametri al posto delle graffe. Chiave ignota: la chiave stessa. */
export function t(key: string, params?: Params): string {
  const entry = M[key];
  let text = entry ? entry[current] : key;
  if (params) {
    for (const [name, value] of Object.entries(params)) text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

/** «carta» o «carte», per quel numero. */
export function cardsWord(n: number): string {
  return t(n === 1 ? "cards.one" : "cards.many");
}
