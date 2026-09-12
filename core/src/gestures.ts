// I gesti del tavolo e gli effetti che scatenano, senza DOM (F4 della
// migrazione PixiJS): giocare dalla mano, schierare il Rubyfront, attaccare,
// le abilità e il flip verso il Nexus (§3.1), la catena delle Reattive
// (§7.2) e gli inneschi — ingresso, attacco, risoluzione, assegnazione,
// morte, ritorno (§8.2). Stavano in simulatore/src/table.ts: qui la stessa
// sequenza di azioni, di attese e di scelte, e la vista (il DOM del
// simulatore, il Pixi del gioco) fornisce solo ciò che si vede — le luci,
// i voli, le scene, il dado, la mira, le finestre (GestureView).
//
// Per il posto del bot (setAuto, session.ts) mira, pile e conferme
// rispondono da sole: la vista non apre finestre per lui.

import { declareAttack as declareAttackVia, attackBonusOf, neverTaps, wornBy } from "./combat.js";
import { abilityCopy, attackEffects, cardName, cardStats, enterEffects, faceCount, faceKind, isRubyfront, nexusRequirementCopy, type Deployment } from "./cards.js";
import type { Ability, AssignForm, Ctx } from "./ctx.js";
import { describeControl, describeRefresh, describeLook, describeMove, describeReturn, enterDisarms, enterRearms, leaveReturns, rearmChoices, underStack, resolveDisarm, resolveRearm, resolveLeaveReturn, type EnterDisarmStep, type EnterRearmStep, type LeaveReturnStep, describeTrigger, enterControls, enterLooks, enterRefreshes, enterMoves, enterReturns, enterTriggers, lookAfterRoll, returnsFor, attackDraws, describeAttackDraw, resolveAttackDraw, resolveAttackDiscard, type AttackDrawStep, attackSteps, attackRef, attackersOf, describeAttackStep, inRange, otherArmed, pendingGrants, rollDie, type AttackStep, resolveControl, resolveLook, resolveRefresh, resolveMove, resolveReturn, resolveTrigger, type EnterControlStep, type EnterLookStep, type EnterRefreshStep, type EnterMoveStep, type EnterReturnStep, assignCandidates, assignRef, assignSteps, describeAssignStep, describeFlipStep, describeResolveStep, discountedCost, weakenAmount, wornObjects, objectCost, searchCandidates, deckEnds, deathSteps, deathRef, describeDeathStep, rearmAfterDeath, type AssignStep, type DeathStep, flipCandidates, flipRef, flipSteps, nexusCheck, pendingResolve, blocksAttacker, resolveSteps, resolveRef, wantsTargetOnPlay, type FlipStep, type ResolveStep } from "./effects.js";
import { FRONT_SLOT_X, RUBYFRONT_X, SLOT_X, SURFACE_H, SURFACE_W, TILE_H, TILE_W, backRowY, frontRowY } from "./geometry.js";
import { msg, t } from "./i18n.js";
import type { AutoChooser } from "./session.js";
import { STACK_STEP, abilityDiscount, chainTop, controllerOf, declarationOf, fieldCards, freeFrontSlotOrNull, inPlay, matterSpot, nextWaveOrder, seatLabel, stackAt, zoneCards } from "./state.js";
import { canDiscard } from "./tabs.js";
import { type CardInstance, type Discount, type EffectRef, type GameState, type Seat, type ZoneId, otherSeat } from "./types.js";

/** Il via a un volo preso PRIMA dell'azione: si dà dopo il ridisegno, o si annulla. */
export type Flight = (() => void) & { cancel(): void };

/** Il tempo in cui la fonte resta accesa prima che l'effetto agisca. */
export const TRIGGER_LEAD_MS = 650;
/** Dopo una scelta e una conferma la fonte è già accesa da un pezzo: il
    volo parte quasi subito, o sembra un caricamento. */
export const CONFIRMED_LEAD_MS = 200;
/** E quanto resta accesa dopo che l'effetto ha agito. */
export const TRIGGER_TAIL_MS = 350;

const FLIP_HINTS: Record<string, string> = {
  "log.nexus.few": "flip.hint.few",
  "log.nexus.few.armed": "flip.hint.few.armed",
  "log.nexus.nodiscard": "flip.hint.nodiscard",
  "log.nexus.nocard": "flip.hint.nocard",
};

/** La scena di una carta che entra, attacca, si risolve o flippa: la carta grande, il rigo, gli inneschi. */
export interface SceneShow {
  cardId: string;
  face: number;
  theme: string;
  locale: string;
  /** Chi la gioca, per il rigo sotto. */
  who: string;
  effects: { tag: string; text: string }[];
  /** Gli inneschi che la scena annuncia: si elencano, e «Continua» li risolve. */
  triggers?: string[];
  /** «Continua» / «Risolvi»: può tornare la promessa dei passi che avvia — chi mostra la scena la aspetta, e il tavolo non è fermo finché agiscono (il bot aspetta). */
  onContinue?: () => void | Promise<void>;
  /** La riga in alto: «Quando entra sul Fronte» di norma, «Quando attacca» all'attacco. */
  kicker?: string;
}

/** Una scelta fra più voci, con la carta di fianco: le abilità del Rubyfront e il flip (§3.1). */
export interface ChoiceShow {
  cardId: string;
  face: number;
  theme: string;
  locale: string;
  kicker: string;
  who: string;
  options: { id: string; label: string; price?: string; text: string; disabled?: boolean; hint?: string }[];
  closeLabel: string;
}

/** Ciò che i gesti chiedono alla vista: tutto ciò che si vede, niente che decida. */
export interface GestureView {
  /** Ridisegna dallo stato. */
  render(): void;
  /** Accende o spegne una carta che si innesca (§8.2). */
  light(uid: string, on: boolean): void;
  /** Mentre un effetto agisce il tavolo è fermo: niente gesti finché la fonte non si spegne. */
  hold(on: boolean): void;
  /** Il lampo sulla carta colpita da un effetto; `ms` a zero lo spegne. */
  strike(uid: string, ms: number): void;
  /** Prende la carta prima che voli in una pila: il via si dà ad azione passata. */
  liftForFlight(uid: string, zone?: "ritiro" | "abisso"): Flight | null;
  /** Prende la carta (con gli Oggetti addosso) prima che cambi posto sul campo (controllo, §8.2). */
  liftToFlight(uid: string): Flight | null;
  /** Come liftToFlight, ma la carta si dissolve e ricompare: quando il controllo apre la fila avversaria. */
  liftToDissolve(uid: string): Flight | null;
  /** Il volo da una pila al campo, ad azione passata. */
  flyFromPile(seat: Seat, zone: ZoneId, uid: string): void;
  /** Il controllo di `by` aprirebbe la fila di servizio avversaria (la vista a rincasso del simulatore)? */
  opensFoeRow(by: Seat): boolean;
  /** Quanto aspettare un volo, e la dissolvenza con la fila che si apre. */
  readonly timing: { fly: number; dissolve: number };
  /** Il dado al centro del tavolo. */
  roll(faces: number, result: number, label: string): Promise<void>;
  /** Le scene si mettono in fila: si risolve quando questa è chiusa. */
  scene(show: SceneShow): Promise<void>;
  /** Si risolve quando nessuna scena è in coda. */
  sceneIdle(): Promise<void>;
  notice(message: string): Promise<void>;
  confirm(question: string, labels?: { yes: string; no: string }): Promise<boolean>;
  choose(show: ChoiceShow): Promise<string | null>;
  /** La mira di un effetto (§8.2): il bersaglio fra i candidati, o null se si rinuncia. */
  pickTarget(source: CardInstance, candidates: CardInstance[], hint: string): Promise<CardInstance | null>;
  /**
   * §7.2 — la Reattiva giocata col bersaglio (RBF-021): prima di pagarla la
   * carta va al centro, dove starà in catena, e si accende; poi la scena e la
   * mira. `cancel` se si rinuncia (torna in mano). Facoltativa: senza, la
   * scena e la mira arrivano lo stesso.
   */
  stageReactive?(card: CardInstance): { cancel(): void } | null;
  /** La scelta di una carta da una pila (o dalla mano): null se si chiude. */
  pickFromPile(seat: Seat, zone: ZoneId, candidates: CardInstance[], title: string, visible?: CardInstance[]): Promise<CardInstance | null>;
}

export type Gestures = ReturnType<typeof createGestures>;

export function createGestures(ctx: Ctx, view: GestureView) {
  /** Il selettore automatico del bot, legato al SUO posto: per i gesti di
      quel posto mira, pile e conferme rispondono da sole, senza finestre —
      anche negli effetti che si risolvono dopo, a scena chiusa. I gesti
      dell'altro posto restano del giocatore. */
  let auto: { seat: Seat; chooser: AutoChooser } | null = null;
  const isAuto = (seat: Seat): boolean => auto !== null && auto.seat === seat;
  const pickFromPile = (
    seat: Seat,
    zone: ZoneId,
    candidates: CardInstance[],
    title: string,
    visible?: CardInstance[]
  ): Promise<CardInstance | null> => {
    if (auto && isAuto(seat)) return Promise.resolve(auto.chooser.pickFromPile(zone, candidates, visible));
    return view.pickFromPile(seat, zone, candidates, title, visible);
  };
  /** La conferma di un effetto: per il bot è un sì, per il giocatore la finestra. */
  const confirmFor = (seat: Seat, question: string, labels?: { yes: string; no: string }): Promise<boolean> =>
    isAuto(seat) ? Promise.resolve(true) : view.confirm(question, labels);
  const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * La mira di un effetto (§8.2). Il bot sceglie da sé: il bersaglio si
   * accende un attimo, così chi guarda vede cosa è stato scelto, e la mira
   * non si apre.
   */
  function pickTarget(source: CardInstance, candidates: CardInstance[], hint: string): Promise<CardInstance | null> {
    if (auto && isAuto(controllerOf(source))) {
      const chosen = auto.chooser.pickTarget(source, candidates);
      if (chosen) view.strike(chosen.uid, 900);
      return wait(450).then(() => chosen);
    }
    return view.pickTarget(source, candidates, hint);
  }

  /**
   * Lo schieramento passerebbe? (§3.1) Nel proprio turno, a partita in
   * corso, fuori da una catena di risposta (§7.2), e col Flusso che copre
   * il costo — fisso, o ogni faccia del dado, Gettone compreso. È un
   * aiuto al tasto, non la regola: la regola è dell'engine (judge_deploy),
   * che ferma comunque il gesto di chi forzasse il tasto. Torna la chiave
   * del motivo, o null se si può.
   */
  function deployBlock(waiting: CardInstance): string | null {
    const state = ctx.state();
    const deployment = cardStats(waiting.cardId).deployment;
    if (!deployment) return "recall.deploy.unknown";
    if (state.over) return "hud.over";
    if (state.active !== waiting.owner) return "recall.deploy.theirs";
    if (state.chain) return "recall.deploy.chain";
    const player = state.players[waiting.owner];
    const available = player.flux + (player.token ? 1 : 0);
    const needed = deployment.die ?? deployment.fixed ?? 0;
    if (available < needed) return deployment.die ? "recall.deploy.nodie" : "recall.deploy.noflux";
    return null;
  }
  function waitingRubyfront(seat: Seat): CardInstance | undefined {
    const back = backRowY(seat);
    return fieldCards(ctx.state()).find(
      card => card.owner === seat && Math.abs(card.x - SLOT_X.richiamo) < 160 && Math.abs(card.y - back) < 160
    );
  }

  /**
   * Il flip verso il Nexus passerebbe adesso? Con l'arbitro, per chi comanda
   * il Rubyfront schierato con la faccia del Rubyfront in vista, nel proprio
   * turno in Preparazione o Fronte, fuori da una catena, col requisito
   * certificato soddisfatto (nexusCheck).
   */
  function flipReady(card: CardInstance): boolean {
    if (!ctx.arbitrated() || !ctx.controls(card.owner)) return false;
    const state = ctx.state();
    const nexus = ctx.card(card.cardId).nexus;
    if (!nexus || card.face === nexus.face) return false;
    if (state.active !== card.owner || (state.phase !== "preparazione" && state.phase !== "fronte")) return false;
    if (state.chain || state.over) return false;
    return nexusCheck(state, card, ctx.card).ok;
  }

  /** Il Rubyfront/Nexus di `seat` schierato, in gioco. */
  function deployedRubyfront(seat: Seat): CardInstance | undefined {
    return fieldCards(ctx.state()).find(card => card.owner === seat && isRubyfront(card.cardId) && inPlay(card, ctx.card(card.cardId).kind));
  }

  /**
   * La scelta delle abilità (§3.1): la carta di fianco, una voce per
   * abilità della faccia in vista — nome, prezzo, testo — e il flip verso
   * il Nexus col suo requisito. Le voci che ora non passerebbero restano in
   * vista, spente, col perché.
   */
  async function openAbilities(seat: Seat): Promise<void> {
    const card = deployedRubyfront(seat);
    if (!card || !ctx.controls(seat) || !ctx.arbitrated()) return;
    const state = ctx.state();
    const facts = ctx.card(card.cardId);
    const own = state.active === seat;
    const player = state.players[seat];
    const spent = player.abilityTurn === state.turn;
    const options: ChoiceShow["options"] = [];
    for (const ability of facts.abilities.filter(candidate => candidate.face === card.face)) {
      const copy = abilityCopy(card.cardId, ability.face, ability.displayKey, ctx.locale());
      const price = ability.cost !== null ? t("ability.cost", { n: ability.cost }) : t("ability.gain", { n: ability.gain ?? 0 });
      let hint: string | null = null;
      if (!ability.form) hint = t("ability.hint.manual");
      else if (!own) hint = t("ability.hint.turn");
      else if (!ability.timing.includes(state.phase)) hint = t("ability.hint.window", { phase: t(ability.timing.length === 1 ? `phase.title.${ability.timing[0]}` : "ability.window.both") });
      else if (spent) hint = t("ability.hint.used");
      else if (player.hp < (ability.cost ?? 0)) hint = t("ability.hint.hp", { n: ability.cost ?? 0 });
      options.push({ id: `ability:${ability.id}`, label: copy.name, price, text: copy.text, disabled: hint !== null, ...(hint ? { hint } : {}) });
    }
    const nexus = facts.nexus;
    if (nexus && card.face !== nexus.face) {
      const check = nexusCheck(state, card, ctx.card);
      let hint: string | null = null;
      if (!own || (state.phase !== "preparazione" && state.phase !== "fronte")) hint = t("ability.hint.turn");
      else if (!check.ok) hint = t(FLIP_HINTS[check.why] ?? "flip.hint.nodiscard", { n: check.n ?? 0 });
      options.push({
        id: "flip",
        label: t("menu.flip.nexus"),
        ...(nexus.recovery ? { price: t("ability.gain", { n: nexus.recovery }) } : {}),
        text: nexusRequirementCopy(card.cardId, ctx.locale()),
        disabled: hint !== null,
        ...(hint ? { hint } : {}),
      });
    }
    const chosen = await view.choose({
      cardId: card.cardId,
      face: card.face,
      theme: ctx.themeFor(card.owner),
      locale: ctx.locale(),
      kicker: t("scene.abilities"),
      who: t("scene.abilities.who", { name: cardName(card.cardId, ctx.locale()), hp: player.hp }),
      options,
      closeLabel: t("overlay.close"),
    });
    if (!chosen) return;
    const live = ctx.state().cards[card.uid];
    if (!live) return;
    if (chosen === "flip") {
      await flipToNexus(live);
      return;
    }
    const ability = facts.abilities.find(candidate => `ability:${candidate.id}` === chosen && candidate.face === live.face);
    if (ability) await useAbility(live, ability);
  }

  // ------------------------------------------------------- combattimento

  /** Il Rubyfront (o Nexus) di un posto, ovunque si trovi sul campo. */
  function rubyfrontOf(seat: Seat): CardInstance | undefined {
    return fieldCards(ctx.state()).find(card => card.owner === seat && isRubyfront(card.cardId));
  }

  /**
   * §6.3: un'Entità tappata non può attaccare né bloccare, una coperta non può
   * fare nulla, e il Rubyfront non è un'Entità. Qui la regola serve solo a
   * smorzare: la carta resta scegliibile lo stesso. L'arbitro non è il
   * simulatore.
   */
  function looksPlayable(card: CardInstance): boolean {
    if (card.tapped || card.facedown) return false;
    const kind = faceKind(card.cardId, card.face);
    return kind !== "rubyfront" && kind !== "nexus";
  }

  // Dichiarazioni e loro conseguenze stanno in combat.ts: passano dal
  // giudizio dell'engine, e il tavolo si limita a fornire il bersaglio.
  function declareAttack(card: CardInstance): Promise<void> {
    return (async () => {
      const passed = await declareAttackVia(ctx, card, rubyfrontOf(otherSeat(controllerOf(card))));
      if (!passed) return;
      // §8.2 — «quando attacca»: gli effetti certificati dell'attaccante, con
      // la stessa scena dell'ingresso ma la riga «Quando attacca».
      const live = ctx.state().cards[card.uid];
      if (!live) return;
      // RBF-004: la Vendetta promessa «al prossimo Umano che attacca» si
      // dà adesso, se è lui — senza scena: il segno resta sulla carta.
      for (const grant of pendingGrants(ctx.state(), live, ctx.card)) await playGrant(grant, live);
      const returns = returnsFor(ctx.state(), live, ctx.card, "on_attack");
      const draws = attackDraws(ctx.state(), live, ctx.card);
      const steps = attackSteps(ctx.state(), live, ctx.card);
      const who = t("scene.attacks", { name: seatLabel(ctx.state(), controllerOf(live)), card: `«${cardName(live.cardId, ctx.locale())}»` });
      // Una scena per fonte: prima chi attacca (i suoi ritorni, le sue
      // pesche, le sue forme), poi ogni altra carta che si innesca — gli
      // Oggetti addosso, le alleate, le Materie permanenti, il Rubyfront.
      // Le scene si accodano; «Risolvi» esegue i passi di quella fonte.
      const own = steps.filter(step => step.source.uid === live.uid);
      if (returns.length || draws.length || own.length) {
        void view.scene({
          cardId: live.cardId,
          face: live.face,
          theme: ctx.themeFor(live.owner),
          locale: ctx.locale(),
          who,
          effects: attackEffects(live.cardId, live.face, ctx.locale()),
          triggers: [
            ...returns.map(step => describeReturn(step, ctx.card)),
            ...draws.map(step => describeAttackDraw(step, ctx.card)),
            ...own.map(step => describeAttackStep(step, ctx.card)),
          ],
          kicker: t("scene.attack"),
          onContinue: () => playAttackTriggers(live, own),
        });
      }
      const others = new Map<string, AttackStep[]>();
      for (const step of steps) {
        if (step.source.uid === live.uid) continue;
        others.set(step.source.uid, [...(others.get(step.source.uid) ?? []), step]);
      }
      for (const group of others.values()) {
        const source = group[0].source;
        void view.scene({
          cardId: source.cardId,
          face: source.face,
          theme: ctx.themeFor(source.owner),
          locale: ctx.locale(),
          who,
          effects: attackEffects(source.cardId, source.face, ctx.locale()),
          triggers: group.map(step => describeAttackStep(step, ctx.card)),
          // Non è questa carta ad attaccare: si innesca PERCHÉ qualcuno
          // attacca. Il Rubyfront non attacca mai (§3.1), e leggergli sopra
          // «Quando attacca» faceva pensare a un attacco suo — la riga sotto
          // dice già chi attacca e con che carta.
          kicker: t("scene.attack.other"),
          onContinue: () => playAttackSteps(group),
        });
      }
    })();
  }

  async function playAttackSteps(steps: AttackStep[]): Promise<void> {
    for (const step of steps) await playAttackStep(step);
  }

  /**
   * RBF-004: la Vendetta al prossimo Umano. La fonte si accende e basta:
   * la parola chiave ottenuta si segna sulla carta che la ottiene
   * (markMarks), e quel segno resta finché dura — una freccia che sparisce
   * non lo diceva.
   */
  async function playGrant(step: AttackStep, target: CardInstance): Promise<void> {
    if (step.form.kind !== "empower" || !step.form.grants) return;
    const by = controllerOf(step.source);
    view.light(step.source.uid, true);
    await wait(TRIGGER_LEAD_MS);
    const passed = await ctx.dispatch({ t: "empower", uid: target.uid, grants: step.form.grants, effect: attackRef(step) });
    if (passed) {
      const what = step.form.grants.map(keyword => t(`grant.${keyword}`)).join(", ");
      ctx.log(msg("log.effect.grant", { seat: by, sourceCard: step.source.cardId, card: target.cardId, what }), by);
    }
    await wait(TRIGGER_TAIL_MS);
    view.light(step.source.uid, false);
  }

  /**
   * Un passo d'attacco (§8.2, le forme di attackSteps): la fonte si accende,
   * il dado si tira se c'è, si sceglie se c'è da scegliere, l'azione parte
   * col suo riferimento. Il «no» dell'engine ferma il passo e basta.
   */
  async function playAttackStep(step: AttackStep): Promise<void> {
    const by = controllerOf(step.source);
    const form = step.form;
    const name = ctx.card(step.source.cardId).name;
    view.hold(true);
    view.light(step.source.uid, true);
    try {
      await wait(TRIGGER_LEAD_MS);
      switch (form.kind) {
        case "empower": {
          if (form.targets === "bearer") {
            const passed = await ctx.dispatch({ t: "empower", uid: step.attacker.uid, power: form.power, effect: attackRef(step) });
            if (passed) ctx.log(msg("log.effect.empower", { seat: by, sourceCard: step.source.cardId, card: step.attacker.cardId, n: form.power ?? 0 }), by);
          } else if (form.targets === "others_armed") {
            for (const target of otherArmed(ctx.state(), by, step.source.uid, ctx.card)) {
              view.strike(target.uid, view.timing.fly);
              const passed = await ctx.dispatch({ t: "empower", uid: target.uid, power: form.power, effect: attackRef(step) });
              if (passed) ctx.log(msg("log.effect.empower", { seat: by, sourceCard: step.source.cardId, card: target.cardId, n: form.power ?? 0 }), by);
              await wait(TRIGGER_TAIL_MS);
            }
          } else if (form.targets === "opposing_entity") {
            const foes = fieldCards(ctx.state()).filter(card => controllerOf(card) !== by && ctx.card(card.cardId).kind === "entity");
            if (foes.length === 0) {
              ctx.log(msg("log.no.target", { seat: by, card: step.source.cardId }), by);
              break;
            }
            const target = await pickTarget(step.source, foes, t("target.raid"));
            if (!target) break;
            view.strike(target.uid, 60_000);
            const sure = await confirmFor(by, t("confirm.raid", { card: `«${ctx.card(target.cardId).name}»` }));
            if (!sure) {
              view.strike(target.uid, 0);
              break;
            }
            const passed = await ctx.dispatch({ t: "empower", uid: target.uid, restrict: "block", effect: attackRef(step) });
            if (passed) ctx.log(msg("log.effect.restrict", { seat: by, sourceCard: step.source.cardId, card: target.cardId }), by);
            await wait(TRIGGER_TAIL_MS);
            view.strike(target.uid, 0);
          }
          break;
        }
        case "look": {
          let roll: number | undefined;
          if (form.die !== null) {
            roll = rollDie(form.die);
            await view.roll(form.die, roll, t("dice.step", { name, what: t("dice.sift") }));
            if (!inRange(roll, form.onRoll)) {
              ctx.log(msg("log.effect.roll", { seat: by, sourceCard: step.source.cardId, die: form.die, roll, what: msg("roll.nothing") }), by);
              break;
            }
          }
          const looked = zoneCards(ctx.state(), by, "deck").slice(0, form.count);
          if (looked.length === 0) {
            ctx.log(msg("log.look.empty", { seat: by, card: step.source.cardId }), by);
            break;
          }
          const candidates = looked.filter(card => {
            const f = ctx.card(card.cardId);
            return f.kind === form.reveal.kind && (form.reveal.race === null || f.race === form.reveal.race);
          });
          const what = t(form.reveal.kind === "matter" ? "pick.look.matter" : form.reveal.kind === "object" ? "pick.look.object" : "pick.look.one");
          const title = form.revealTo === "ritiro"
            ? t("pick.look.retire", { n: looked.length, what })
            : form.restTo === "ritiro"
              ? t("pick.look.rest.retire", { n: looked.length, what })
              : t(candidates.length ? "pick.look.some" : "pick.look.none", { n: looked.length, what });
          const reveal = await pickFromPile(by, "deck", candidates, title, looked);
          const passed = await ctx.dispatch({
            t: "look",
            seat: by,
            count: form.count,
            ...(reveal ? { reveal: reveal.uid } : {}),
            ...(roll !== undefined ? { roll } : {}),
            revealTo: form.revealTo,
            restTo: form.restTo,
            effect: attackRef(step),
          });
          if (passed) {
            const shown = reveal
              ? form.revealTo === "ritiro" ? msg("look.toretire", { card: reveal.cardId }) : msg("look.reveal", { card: reveal.cardId })
              : msg("look.noreveal");
            ctx.log(msg(form.restTo === "ritiro" ? "log.effect.look.hand" : "log.effect.look.retire", { seat: by, sourceCard: step.source.cardId, n: looked.length, what: shown }), by);
          }
          break;
        }
        case "heal": {
          const foe = otherSeat(by);
          if (form.who === "permanent") {
            const roll = rollDie(form.die ?? 20);
            await view.roll(form.die ?? 20, roll, t("dice.step", { name, what: t("dice.heirs") }));
            const count = attackersOf(ctx.state(), by, form.attackers?.race ?? "human", ctx.card).length;
            if (inRange(roll, form.gainOn ?? null)) {
              const hp = ctx.state().players[by].hp + count;
              const passed = await ctx.dispatch({ t: "player", seat: by, patch: { hp }, roll, effect: attackRef(step) });
              if (passed) ctx.log(msg("log.effect.heal", { seat: by, sourceCard: step.source.cardId, n: count, hp }), by);
            } else if (inRange(roll, form.drainOn ?? null)) {
              const hp = Math.max(0, ctx.state().players[foe].hp - count);
              const passed = await ctx.dispatch({ t: "player", seat: foe, patch: { hp }, roll, effect: attackRef(step) });
              if (passed) ctx.log(msg("log.effect.drain", { seat: by, sourceCard: step.source.cardId, otherSeat: foe, n: count, hp }), by);
            } else {
              ctx.log(msg("log.effect.roll", { seat: by, sourceCard: step.source.cardId, die: form.die ?? 20, roll, what: msg("roll.nothing") }), by);
            }
            break;
          }
          const amount = typeof form.amount === "number" ? form.amount : 0;
          const hp = ctx.state().players[by].hp + amount;
          const healed = await ctx.dispatch({ t: "player", seat: by, patch: { hp }, effect: attackRef(step) });
          if (!healed) break;
          ctx.log(msg("log.effect.heal", { seat: by, sourceCard: step.source.cardId, n: amount, hp }), by);
          await wait(TRIGGER_TAIL_MS);
          if (form.thenRecall && form.die !== null) {
            const roll = rollDie(form.die);
            await view.roll(form.die, roll, t("dice.step", { name, what: t("dice.mend", { lo: form.onRoll?.[0] ?? 0, hi: form.onRoll?.[1] ?? 0 }) }));
            if (!inRange(roll, form.onRoll)) {
              ctx.log(msg("log.effect.roll", { seat: by, sourceCard: step.source.cardId, die: form.die, roll, what: msg("roll.nothing") }), by);
              break;
            }
            const candidates = zoneCards(ctx.state(), by, "ritiro").filter(card => ctx.card(card.cardId).kind === "entity");
            if (candidates.length === 0) {
              ctx.log(msg("log.no.permanent", { seat: by, card: step.source.cardId }), by);
              break;
            }
            let chosen: CardInstance | null = null;
            while (!chosen) chosen = await pickFromPile(by, "ritiro", candidates, t("pick.recall.hand"));
            const passed = await ctx.dispatch({ t: "toZone", uid: chosen.uid, zone: "hand", roll, effect: attackRef(step, "recall") });
            if (passed) ctx.log(msg("log.effect.recall.hand", { seat: by, sourceCard: step.source.cardId, card: chosen.cardId }), by);
          }
          if (form.thenDraw) {
            const drawn = await ctx.dispatch({ t: "draw", seat: by, count: form.thenDraw, effect: attackRef(step, "draw") });
            if (drawn) ctx.log(msg("log.effect.trigger", { seat: by, card: step.source.cardId, n: form.thenDraw, cards: msg(form.thenDraw === 1 ? "cards.one" : "cards.many") }), by);
            await wait(TRIGGER_TAIL_MS);
          }
          for (let left = form.thenDiscard ?? 0; left > 0; left -= 1) {
            const hand = zoneCards(ctx.state(), by, "hand");
            if (hand.length === 0) break;
            let chosen: CardInstance | null = null;
            while (!chosen) chosen = await pickFromPile(by, "hand", hand, t("pick.discard"));
            const passed = await ctx.dispatch({ t: "toZone", uid: chosen.uid, zone: "ritiro", effect: attackRef(step, "discard") });
            if (passed) ctx.log(msg("log.effect.discard", { seat: by, sourceCard: step.source.cardId, card: chosen.cardId }), by);
            else break;
          }
          break;
        }
        case "return": {
          const roll = rollDie(form.die);
          await view.roll(form.die, roll, t("dice.step", { name, what: t("dice.recall", { lo: form.onRoll[0], hi: form.onRoll[1] }) }));
          if (!inRange(roll, form.onRoll)) {
            ctx.log(msg("log.effect.roll", { seat: by, sourceCard: step.source.cardId, die: form.die, roll, what: msg("roll.nothing") }), by);
            break;
          }
          const candidates = zoneCards(ctx.state(), by, "ritiro").filter(card => {
            const f = ctx.card(card.cardId);
            return f.kind === form.filter.kind && f.race === form.filter.race;
          });
          if (candidates.length === 0) {
            ctx.log(msg("log.no.permanent", { seat: by, card: step.source.cardId }), by);
            break;
          }
          const spot = freeFrontSlotOrNull(ctx.state(), by);
          if (!spot) {
            ctx.log(msg("log.front.full", { seat: by, card: step.source.cardId }), by);
            break;
          }
          let chosen: CardInstance | null = null;
          while (!chosen) chosen = await pickFromPile(by, "ritiro", candidates, t("pick.recall.front"));
          const passed = await ctx.dispatch({ t: "toZone", uid: chosen.uid, zone: "field", ...spot, z: ctx.state().zTop + 1, roll, effect: attackRef(step) });
          if (!passed) break;
          view.flyFromPile(by, "ritiro", chosen.uid);
          await wait(view.timing.fly);
          const target = rubyfrontOf(otherSeat(by));
          if (target) {
            const order = nextWaveOrder(ctx.state(), by);
            // §3.1 — anche chi torna e attacca insieme porta il bonus promesso alle prossime attaccanti.
            const bonus = attackBonusOf(ctx, ctx.state().cards[chosen.uid] ?? chosen);
            const joined = await ctx.dispatch({
              t: "declare",
              declaration: { id: crypto.randomUUID(), from: chosen.uid, to: target.uid, kind: "attack", seat: by, order, ...(bonus > 0 ? { bonus } : {}) },
              effect: { source: step.source.uid, event: "on_attack", entering: chosen.uid, follow: "join" },
            });
            if (joined) {
              if (!neverTaps(ctx.card(chosen.cardId))) void ctx.dispatch({ t: "tap", uid: chosen.uid, tapped: true });
              ctx.log(msg("log.effect.recall.front", { seat: by, sourceCard: step.source.cardId, card: chosen.cardId }), by);
            }
          }
          break;
        }
        case "rearm": {
          const objects = zoneCards(ctx.state(), by, "ritiro").filter(card => ctx.card(card.cardId).kind === "object");
          if (objects.length === 0) break;
          const chosen = await pickFromPile(by, "ritiro", objects, t("pick.rearm"));
          if (!chosen) break;
          const attacker = ctx.state().cards[step.attacker.uid];
          if (!attacker) break;
          const worn = Object.values(ctx.state().cards).filter(other => other.assignedTo === attacker.uid && other.zone === "field");
          const spot = { x: attacker.x + STACK_STEP * (worn.length + 1), y: attacker.y + STACK_STEP * (worn.length + 1) };
          const passed = await ctx.dispatch({ t: "toZone", uid: chosen.uid, zone: "field", ...spot, z: underStack(attacker, worn), assignTo: attacker.uid, effect: attackRef(step) });
          if (passed) {
            view.flyFromPile(by, "ritiro", chosen.uid);
            await wait(view.timing.fly);
            ctx.log(msg("log.effect.rearm", { seat: by, sourceCard: step.source.cardId, card: chosen.cardId, toCard: attacker.cardId }), by);
          }
          break;
        }
        case "untap":
          break;
      }
      await wait(TRIGGER_TAIL_MS);
    } finally {
      view.light(step.source.uid, false);
      view.hold(false);
    }
  }

  async function playAttackTriggers(attacker: CardInstance, own: AttackStep[] = []): Promise<void> {
    for (const step of returnsFor(ctx.state(), attacker, ctx.card, "on_attack")) {
      await playReturn(step);
    }
    for (const step of attackDraws(ctx.state(), attacker, ctx.card)) {
      await playAttackDraw(step);
    }
    await playAttackSteps(own);
  }

  /**
   * La pesca all'attacco (§8.2, RBF-026): la fonte si accende, si pesca;
   * poi «scarta una carta» — obbligatoria: la finestra torna finché non si
   * sceglie (a mano vuota, non c'è nulla da scartare).
   */
  async function playAttackDraw(step: AttackDrawStep): Promise<void> {
    const by = controllerOf(step.source);
    view.hold(true);
    view.light(step.source.uid, true);
    try {
      await wait(TRIGGER_LEAD_MS);
      const passed = await resolveAttackDraw(ctx, step);
      if (!passed) return;
      await wait(TRIGGER_TAIL_MS);
      for (let left = step.thenDiscard; left > 0; left -= 1) {
        const hand = zoneCards(ctx.state(), by, "hand");
        if (hand.length === 0) break;
        let chosen: CardInstance | null = null;
        while (!chosen) chosen = await pickFromPile(by, "hand", hand, t("pick.discard"));
        if (!(await resolveAttackDiscard(ctx, step, chosen))) break;
      }
    } finally {
      view.light(step.source.uid, false);
      view.hold(false);
    }
  }

  /**
   * Un Oggetto lasciato sopra un'Entità le va DIETRO: chi agisce resta in
   * vista, l'equipaggiamento fa capolino da sotto (la scaletta di stackAt gli
   * lascia già l'angolo fuori). E dietro vuol dire in fondo alla pila: sotto
   * l'Entità E sotto gli Oggetti già appesi, sennò il secondo si accavalla al
   * primo con lo stesso z e uno dei due si perde. Tutto il resto sale in cima
   * come sempre.
   */
  /** Le carte in campo toccate da un rilascio in (x, y), esclusa la mossa. */
  function touchedAt(card: CardInstance, x: number, y: number): CardInstance[] {
    return fieldCards(ctx.state()).filter(
      other =>
        other.uid !== card.uid &&
        Math.abs(other.x - x) < TILE_W &&
        Math.abs(other.y - y) < TILE_H
    );
  }

  /** L'Entità su cui un Oggetto è stato posato, se c'è: è lei che lo riceve. */
  function entityUnder(card: CardInstance, x: number, y: number): CardInstance | undefined {
    if (faceKind(card.cardId, card.face) !== "object") return undefined;
    return touchedAt(card, x, y).find(other => faceKind(other.cardId, other.face) === "entity");
  }

  function dropZ(card: CardInstance, x: number, y: number): number {
    const state = ctx.state();
    const top = state.zTop + 1;
    // Va dietro solo se sotto c'è un'Entità: l'Oggetto posato sul vuoto (o su
    // altre carte qualsiasi) resta una carta come le altre.
    if (!entityUnder(card, x, y)) return top;
    const pile = touchedAt(card, x, y).filter(other => {
      const kind = faceKind(other.cardId, other.face);
      return kind === "entity" || kind === "object";
    });
    // Il -9 tiene lo z-index del DOM sopra lo zero (il disegno somma 10):
    // più giù, la carta finirebbe sotto il tappeto.
    return Math.max(-9, Math.min(...pile.map(other => other.z)) - 1);
  }

  /**
   * Posa la carta in campo: sposta se c'era già, altrimenti ce la porta —
   * e dalla mano la GIOCA, pagando il costo di Flusso stampato (§3.2). Il
   * costo lo legge il catalogo e viaggia nell'azione: l'arbitro lo verifica
   * e lo ferma se il Flusso non basta; il riduttore lo scala. Il Rubyfront
   * non paga di qui: il suo costo di schieramento può essere un dado, e si
   * regola a mano (§3.1). Dice se il gesto è passato.
   */
  /**
   * La discesa gratis di un'abilità (§3.1, la chiamata sul Fronte del
   * Nexus): l'azione porta il riferimento all'abilità e le parole chiave
   * concesse, e non paga Flusso — l'engine lo pretende così.
   */
  type FreeEntry = { effect: EffectRef; grants: string[] };

  async function place(card: CardInstance, x: number, y: number, z: number, free: FreeEntry | null = null): Promise<boolean> {
    if (card.zone === "field") {
      // Con l'arbitro i pixel non si sono mossi durante il trascinamento:
      // riposare la carta dov'era non è uno spostamento, e la dogana degli
      // slot (§5) fermerebbe a torto un gesto che non c'è.
      if (ctx.arbitrated() && card.x === x && card.y === y) return true;
      return ctx.dispatch({ t: "move", uid: card.uid, x, y, z });
    }
    const facts = ctx.card(card.cardId);
    // Una Materia che adesso non farebbe nulla (nessun bersaglio, la
    // condizione non c'è) si gioca solo apposta: l'avviso lo dice prima
    // di pagare. Il blocco di una Reattiva bloccante è già un effetto.
    if (card.zone === "hand" && facts.kind === "matter" && facts.resolveForms.length) {
      const steps = resolveSteps(ctx.state(), card, ctx.card);
      if (steps.length && steps.every(step => step.blocked !== null && step.form.kind !== "block")) {
        const go = await confirmFor(card.owner, t("confirm.matter.noeffect", { card: `«${cardName(card.cardId, ctx.locale())}»` }), { yes: t("confirm.play.anyway"), no: t("confirm.play.not") });
        if (!go) {
          view.render();
          return false;
        }
      }
    }
    // §7.2 — la Reattiva col bersaglio alla giocata (RBF-021): prima al centro, la scena e la mira; poi la giocata.
    if (card.zone === "hand" && facts.kind === "matter" && facts.behavior === "reactive" && wantsTargetOnPlay(facts) && !free) return playReactiveWithTarget(card, x, y, z);
    let cost = card.zone === "hand" && !isRubyfront(card.cardId) && !free ? facts.fluxCost : null;
    // L'Oggetto sul portatore che sconta («gli Oggetti che assegni a questa
    // Entità costano N in meno»): il costo lo dice objectCost, come l'engine.
    if (card.zone === "hand" && facts.kind === "object" && !free) cost = objectCost(ctx.state(), ctx.state().cards[card.uid] ?? card, ctx.card);
    // Una Materia che chiede il bersaglio già giocandola (RBF-021: «se
    // bersaglia un'Entità tappata, costa 3 in meno»): si mira prima, il
    // bersaglio viaggia nell'azione e lo sconto ne discende. Esc: nessun
    // bersaglio, costo pieno, e l'effetto sceglierà dopo.
    let target: CardInstance | null = null;
    if (card.zone === "hand" && facts.kind === "matter" && wantsTargetOnPlay(facts)) {
      const form = facts.resolveForms.find(candidate => candidate.kind === "destroy");
      const foes = fieldCards(ctx.state()).filter(other => ctx.card(other.cardId).kind === "entity" && (!form || form.kind !== "destroy" || form.target.controller !== "opponent" || controllerOf(other) !== card.owner));
      const discount = form && form.kind === "destroy" ? form.discount?.amount ?? 0 : 0;
      if (foes.length) target = await pickTarget(card, foes, t("target.judgment.play", { n: discount }));
    }
    // Il costo di una Materia con uno sconto (contro la tappata dichiarata,
    // o con le armate sul Fronte): lo dice discountedCost, come l'engine.
    if (card.zone === "hand" && facts.kind === "matter") cost = discountedCost(ctx.state(), card, target, ctx.card);
    // §3.1 — lo sconto di un'abilità del Rubyfront («la prossima carta X
    // del turno costa N in meno»): si dichiara nell'azione, e il costo
    // scende — mai sotto 1. Lo consuma il riduttore.
    const abilityOff = card.zone === "hand" && cost !== null ? abilityDiscount(ctx.state(), card.owner, facts) : null;
    if (abilityOff && cost !== null) cost = Math.max(1, cost - abilityOff.amount);
    // §7.2 — la Reattiva giocata apre (o allunga) la catena di risposta: il
    // segno viaggia nell'azione, e l'engine lo pretende.
    const reactive = card.zone === "hand" && facts.kind === "matter" && facts.behavior === "reactive";
    const passed = await ctx.dispatch({
      t: "toZone",
      uid: card.uid,
      zone: "field",
      x,
      y,
      z,
      ...(cost !== null ? { cost } : {}),
      ...(abilityOff ? { discount: abilityOff.amount } : {}),
      ...(target ? { target: target.uid } : {}),
      ...(reactive ? { chain: true as const } : {}),
      ...(free ? { effect: free.effect, grants: free.grants } : {}),
    });
    const effects = card.zone === "hand" ? enterEffects(card.cardId, card.face, ctx.locale()) : [];
    if (passed && free) {
      ctx.log(msg("log.ability.summon", { seat: card.owner, card: card.cardId, grants: free.grants.map(keyword => msg(`grant.${keyword}`)) }), card.owner);
    }
    if (passed && cost !== null) {
      const player = ctx.state().players[card.owner];
      // In chat solo il gesto: il testo dell'effetto si legge sulla carta,
      // lo storico resta pulito.
      ctx.log(msg("log.play", { seat: card.owner, card: card.cardId, cost, flux: player.flux, max: player.fluxMax }), card.owner);
      if (abilityOff) ctx.log(msg("log.play.discount", { n: abilityOff.amount }), card.owner);
    }
    // Una Materia con un effetto certificato (§7.2): la scena elenca i
    // passi, «Risolvi» li esegue, e la carta — se non è permanente — va
    // nell'Abisso. Quella che «si gioca come blocco» (RBF-020) prima
    // sceglie l'attaccante da fermare.
    if (passed && reactive) {
      // La Reattiva aspetta in catena: si risolve quando l'avversario
      // accetta (driveChain), non adesso.
      void openChain(ctx.state().cards[card.uid] ?? card);
      return passed;
    }
    if (passed && card.zone === "hand" && facts.kind === "matter" && facts.resolveForms.length) {
      const live = ctx.state().cards[card.uid] ?? card;
      void playMatter(live, effects);
      return passed;
    }
    // Il momento d'ingresso: ogni carta giocata dalla mano si ferma in primo
    // piano e si accende; se ha un effetto che scatta entrando, lo annuncia
    // (effect.ts).
    if (passed && card.zone === "hand") {
      // Gli inneschi delle carte già in campo (effects.ts): la scena li
      // elenca, e «Risolvi» li esegue — con un bagliore sulla fonte.
      const live = ctx.state().cards[card.uid] ?? card;
      const moves = enterMoves(ctx.state(), live, ctx.card);
      const returns = enterReturns(ctx.state(), live, ctx.card);
      const looks = enterLooks(ctx.state(), live, ctx.card);
      const controls = enterControls(ctx.state(), live, ctx.card);
      const refreshes = enterRefreshes(live, ctx.card);
      const disarms = enterDisarms(ctx.state(), live, ctx.card);
      const rearms = enterRearms(live, ctx.card);
      const triggers = enterTriggers(ctx.state(), live, ctx.card);
      // Un Oggetto non entra sul Fronte: si assegna, e la scena dice a chi (§3.1).
      const bearer = facts.kind === "object" && live.assignedTo ? ctx.state().cards[live.assignedTo] : undefined;
      void view.scene({
        cardId: card.cardId,
        face: card.face,
        theme: ctx.themeFor(card.owner),
        locale: ctx.locale(),
        who: bearer
          ? t("scene.assigns", { name: seatLabel(ctx.state(), card.owner), card: `«${cardName(card.cardId, ctx.locale())}»`, toCard: `«${cardName(bearer.cardId, ctx.locale())}»` })
          : t("scene.plays", { name: seatLabel(ctx.state(), card.owner), card: `«${cardName(card.cardId, ctx.locale())}»` }),
        ...(bearer ? { kicker: t("scene.assign") } : {}),
        effects,
        triggers: [
          ...moves.map(step => describeMove(step, ctx.card)),
          ...returns.map(step => describeReturn(step, ctx.card)),
          ...looks.map(step => describeLook(step, ctx.card)),
          ...controls.map(step => describeControl(step, ctx.card)),
          ...refreshes.map(step => describeRefresh(step, ctx.card)),
          ...disarms.map(step => t("trigger.disarm", { card: `«${ctx.card(step.source.cardId).name}»` })),
          ...rearms.map(step => t(step.self ? "trigger.rearm.self" : "trigger.rearm.any", { card: `«${ctx.card(step.source.cardId).name}»` })),
          ...triggers.map(trigger => describeTrigger(trigger, ctx.card)),
        ],
        onContinue:
          moves.length || returns.length || looks.length || controls.length || refreshes.length || disarms.length || rearms.length || triggers.length
            ? () => playTriggers(live)
            : undefined,
      });
    }
    return passed;
  }

  /**
   * Una Materia normale o permanente giocata (§7.2): la scena coi passi e
   * «Risolvi», e la normale va nell'Abisso. Le Reattive non passano di qui:
   * aprono la catena (openChain) e si risolvono quando l'avversario accetta.
   */
  async function playMatter(matter: CardInstance, effects: { tag: string; text: string }[]): Promise<void> {
    await resolveMatter(matter, effects, false);
  }

  /**
   * La Reattiva col bersaglio alla giocata (RBF-021, §7.2), nell'ordine del
   * tavolo (deciso dal designer, 2026-09-12): la carta va al centro e si
   * accende, la scena ne mostra il testo e «Risolvi», si sceglie il
   * bersaglio — e solo allora si gioca: il costo scontato e il bersaglio
   * viaggiano nell'azione (l'engine li rifà), e la catena passa
   * all'avversario. Esc sulla mira: la giocata non si fa e non si paga
   * nulla. Senza bersagli in campo si gioca a costo pieno.
   */
  async function playReactiveWithTarget(card: CardInstance, x: number, y: number, z: number): Promise<boolean> {
    const facts = ctx.card(card.cardId);
    const by = controllerOf(card);
    const form = facts.resolveForms.find(candidate => candidate.kind === "destroy");
    const foes = fieldCards(ctx.state()).filter(other => ctx.card(other.cardId).kind === "entity" && (!form || form.kind !== "destroy" || form.target.controller !== "opponent" || controllerOf(other) !== card.owner));
    const discount = form && form.kind === "destroy" ? form.discount?.amount ?? 0 : 0;
    const staged = view.stageReactive?.(card) ?? null;
    await view.scene({
      cardId: card.cardId,
      face: card.face,
      theme: ctx.themeFor(card.owner),
      locale: ctx.locale(),
      who: t("scene.plays", { name: seatLabel(ctx.state(), card.owner), card: `«${cardName(card.cardId, ctx.locale())}»` }),
      effects: enterEffects(card.cardId, card.face, ctx.locale()),
      kicker: t("scene.reactive"),
      // Il bot sceglie da sé: per chi guarda la scena dice solo «Continua».
      triggers: isAuto(by) ? [] : resolveSteps(ctx.state(), card, ctx.card).map(step => describeResolveStep(step, ctx.card)),
      onContinue: () => undefined,
    });
    const target = foes.length ? await pickTarget(card, foes, t("target.judgment.play", { n: discount })) : null;
    if (foes.length && !target) {
      staged?.cancel();
      view.render();
      return false;
    }
    let cost = discountedCost(ctx.state(), card, target, ctx.card);
    const abilityOff = cost !== null ? abilityDiscount(ctx.state(), card.owner, facts) : null;
    if (abilityOff && cost !== null) cost = Math.max(1, cost - abilityOff.amount);
    const passed = await ctx.dispatch({
      t: "toZone",
      uid: card.uid,
      zone: "field",
      x,
      y,
      z,
      ...(cost !== null ? { cost } : {}),
      ...(abilityOff ? { discount: abilityOff.amount } : {}),
      ...(target ? { target: target.uid } : {}),
      chain: true as const,
    });
    if (!passed) {
      staged?.cancel();
      view.render();
      return false;
    }
    if (cost !== null) {
      const player = ctx.state().players[card.owner];
      ctx.log(msg("log.play", { seat: card.owner, card: card.cardId, cost, flux: player.flux, max: player.fluxMax }), card.owner);
      if (abilityOff) ctx.log(msg("log.play.discount", { n: abilityOff.amount }), card.owner);
    }
    void openChain(ctx.state().cards[card.uid] ?? card);
    return true;
  }

  /**
   * §7.2 — la Reattiva giocata è in catena. Quella che ferma un attaccante
   * (la Reattiva bloccante (forma `block`), §6.4) lo sceglie subito: il blocco è la giocata; senza
   * attaccante si consuma a vuoto ed esce dalla catena. Poi si aspetta la
   * parola dell'avversario.
   */
  async function openChain(matter: CardInstance): Promise<void> {
    const facts = ctx.card(matter.cardId);
    const by = controllerOf(matter);
    if (blocksAttacker(facts)) {
      const blocking = await declareMatterBlock(matter);
      if (!blocking) {
        await spendMatter(matter);
        return;
      }
    }
    const stack = ctx.state().chain?.stack ?? [];
    ctx.log(msg(stack.length > 1 ? "log.chain.respond" : "log.chain.open", { seat: by, card: matter.cardId }), by);
  }

  /** «Gioca questa carta come blocco a un attaccante» (§6.4): sceglie e dichiara. Dice se blocca. */
  async function declareMatterBlock(matter: CardInstance): Promise<boolean> {
    const by = controllerOf(matter);
    const attackers = attackersOf(ctx.state(), otherSeat(by), null, ctx.card).filter(card => !ctx.state().declarations.some(d => d.to === card.uid && d.kind !== "attack"));
    const attacker = attackers.length ? await pickTarget(matter, attackers, t("target.blockwith")) : null;
    if (!attacker) return false;
    const passed = await ctx.dispatch({
      t: "declare",
      declaration: { id: crypto.randomUUID(), from: matter.uid, to: attacker.uid, kind: "block", seat: by, order: 0 },
    });
    if (passed) ctx.log(msg("log.effect.blockwith", { seat: by, card: attacker.cardId, sourceCard: matter.cardId }), by);
    return passed;
  }

  /**
   * La risoluzione di una Materia (§7.2): la scena coi passi e «Risolvi»;
   * risolta, la normale o Reattiva va nell'Abisso — la Reattiva che blocca
   * resta finché l'ondata si risolve (§6.4), la permanente resta in gioco.
   * Se era in catena, chiuso il passo esce dalla pila (`settle`), e la
   * catena passa alla carta sotto.
   */
  async function resolveMatter(matter: CardInstance, effects: { tag: string; text: string }[], blocking: boolean): Promise<void> {
    const facts = ctx.card(matter.cardId);
    const by = controllerOf(matter);
    const steps = pendingResolve(ctx.state(), matter, ctx.card);
    // Il bersaglio scelto giocandola (RBF-021): la scena lo dice, e il tasto è «Continua» — la scelta è già fatta.
    const chosen = matter.target ? ctx.state().cards[matter.target] : undefined;
    await view.scene({
      cardId: matter.cardId,
      face: matter.face,
      theme: ctx.themeFor(matter.owner),
      locale: ctx.locale(),
      who: chosen
        ? t("scene.resolves.on", { name: seatLabel(ctx.state(), by), card: `«${cardName(matter.cardId, ctx.locale())}»`, target: `«${cardName(chosen.cardId, ctx.locale())}»` })
        : t("scene.resolves", { name: seatLabel(ctx.state(), by), card: `«${cardName(matter.cardId, ctx.locale())}»` }),
      effects,
      triggers: chosen ? [] : steps.map(step => describeResolveStep(step, ctx.card)),
      kicker: t("scene.resolve.matter"),
      // I passi seguono la scena, qui sotto: il tasto dice solo «Risolvi».
      onContinue: () => undefined,
    });
    for (const step of steps) await playResolveStep(step);
    if (facts.behavior !== "permanent" && !blocking) await spendMatter(matter);
    if (ctx.state().chain?.stack.includes(matter.uid)) await ctx.dispatch({ t: "settle", uid: matter.uid });
  }

  /** «Poi perdi N PV»: il seguito della distruzione, di chi comanda la fonte. */
  async function loseAfterDestroy(step: ResolveStep, ref: EffectRef, n: number): Promise<void> {
    const by = controllerOf(step.source);
    view.hold(true);
    await wait(TRIGGER_LEAD_MS);
    const hp = Math.max(0, ctx.state().players[by].hp - n);
    const passed = await ctx.dispatch({ t: "player", seat: by, patch: { hp }, effect: ref });
    if (passed) ctx.log(msg("log.effect.lose", { seat: by, sourceCard: step.source.cardId, n, hp }), by);
    await wait(TRIGGER_TAIL_MS);
  }

  /**
   * §7.2 — la catena si risolve «in ordine inverso: l'ultima Materia giocata
   * si risolve per prima». Chi comanda la carta in cima la risolve; risolta,
   * esce dalla pila e la cima passa alla carta sotto, che il suo client
   * risolverà a sua volta — ogni lavagna passa di qui a ogni ridisegno, e
   * si muove solo per una carta sua, una alla volta.
   */
  let chainBusy: string | null = null;
  function driveChain(): void {
    const state = ctx.state();
    if (!state.chain?.resolving || chainBusy) return;
    const top = chainTop(state);
    // Col bot al tavolo le sue Reattive in catena le risolve questa lavagna,
    // col suo selettore (setAuto): nessun altro client lo farebbe.
    if (!top || top.zone !== "field" || !(ctx.controls(controllerOf(top)) || isAuto(controllerOf(top)))) return;
    chainBusy = top.uid;
    const blocking = state.declarations.some(d => d.from === top.uid && d.kind === "block");
    void resolveMatter(top, enterEffects(top.cardId, top.face, ctx.locale()), blocking).finally(() => {
      chainBusy = null;
      view.render();
    });
  }

  /** La Materia risolta va nell'Abisso (§7.2: «poi la carta va nell'Abisso»). */
  async function spendMatter(matter: CardInstance): Promise<void> {
    const live = ctx.state().cards[matter.uid];
    if (!live || live.zone !== "field") return;
    const fly = view.liftForFlight(matter.uid, "abisso");
    const passed = await ctx.dispatch({ t: "toZone", uid: matter.uid, zone: "abisso" });
    if (passed) {
      fly?.();
      ctx.log(msg("log.effect.spent", { seat: controllerOf(matter), card: matter.cardId }), controllerOf(matter));
    } else {
      fly?.cancel();
    }
  }

  /**
   * Un passo di una Materia (§7.2, le forme di resolveSteps): la fonte si
   * accende, si mira o si sceglie se c'è da scegliere, il dado si tira se
   * c'è, l'azione parte col suo riferimento. Il «no» dell'engine ferma il
   * passo e basta.
   */
  async function playResolveStep(first: ResolveStep): Promise<void> {
    const by = controllerOf(first.source);
    const form = first.form;
    const name = ctx.card(first.source.cardId).name;
    // I candidati si rileggono adesso: i passi precedenti possono aver mosso carte.
    const step = pendingResolve(ctx.state(), first.source, ctx.card).find(candidate => candidate.form === form) ?? first;
    const ref = resolveRef(step.source);
    if (step.blocked) {
      ctx.log(msg(step.blocked, { seat: by, card: step.source.cardId }), by);
      return;
    }
    view.light(step.source.uid, true);
    try {
      switch (form.kind) {
        case "look": {
          const reveal = await pickFromPile(by, "deck", step.candidates, t("pick.lure", { n: step.looked.length }), step.looked);
          view.hold(true);
          await wait(CONFIRMED_LEAD_MS);
          const passed = await ctx.dispatch({ t: "look", seat: by, count: form.count, ...(reveal ? { reveal: reveal.uid } : {}), revealTo: "hand", restTo: "deck", effect: ref });
          if (passed) {
            ctx.log(msg("log.effect.look", { seat: by, sourceCard: step.source.cardId, parts: [msg("look.looked", { n: step.looked.length }), reveal ? msg("look.reveal", { card: reveal.cardId }) : msg("look.noreveal"), msg("look.rest")] }), by);
          }
          break;
        }
        case "weaken": {
          const target = await pickTarget(step.source, step.candidates, t("target.refract"));
          if (!target) break;
          view.hold(true);
          view.strike(target.uid, view.timing.fly);
          await wait(CONFIRMED_LEAD_MS);
          const power = weakenAmount(ctx.state(), by, form, ctx.card);
          const passed = await ctx.dispatch({ t: "empower", uid: target.uid, power, effect: ref });
          if (passed) ctx.log(msg("log.effect.weaken", { seat: by, sourceCard: step.source.cardId, card: target.cardId, n: -power }), by);
          break;
        }
        case "empower": {
          if (form.targets === "own_armed") {
            // «Fino a N»: una scelta per volta, Chiudi per fermarsi prima.
            let left = form.upTo;
            let pool = step.candidates;
            while (left > 0 && pool.length > 0) {
              const target = await pickTarget(step.source, pool, t("target.amplify", { n: left }));
              if (!target) break;
              view.hold(true);
              view.strike(target.uid, view.timing.fly);
              await wait(CONFIRMED_LEAD_MS);
              const passed = await ctx.dispatch({ t: "empower", uid: target.uid, power: form.power, untap: true, effect: ref });
              if (passed) ctx.log(msg("log.effect.untap", { seat: by, sourceCard: step.source.cardId, card: target.cardId, n: form.power }), by);
              left -= 1;
              pool = pool.filter(other => other.uid !== target.uid);
              await wait(TRIGGER_TAIL_MS);
            }
          } else if (form.targets === "own_entity") {
            const target = await pickTarget(step.source, step.candidates, t("target.formation"));
            if (!target) break;
            view.hold(true);
            view.strike(target.uid, view.timing.fly);
            await wait(CONFIRMED_LEAD_MS);
            const passed = await ctx.dispatch({ t: "empower", uid: target.uid, power: form.power, untap: true, effect: ref });
            if (passed) ctx.log(msg("log.effect.untap", { seat: by, sourceCard: step.source.cardId, card: target.cardId, n: form.power }), by);
          } else {
            view.hold(true);
            await wait(TRIGGER_LEAD_MS);
            for (const target of step.candidates) {
              view.strike(target.uid, view.timing.fly);
              const passed = await ctx.dispatch({ t: "empower", uid: target.uid, counter: form.counter, untap: true, effect: ref });
              if (passed) ctx.log(msg("log.effect.counter", { seat: by, sourceCard: step.source.cardId, card: target.cardId, n: form.counter }), by);
              await wait(TRIGGER_TAIL_MS);
            }
          }
          break;
        }
        case "search": {
          const roll = rollDie(form.die);
          await view.roll(form.die, roll, t("dice.step", { name, what: t("dice.search") }));
          const live = pendingResolve(ctx.state(), step.source, ctx.card).find(candidate => candidate.form === form) ?? step;
          const looked = live.looked;
          if (looked.length === 0) break;
          const { type, candidates } = searchCandidates(form, looked, roll, ctx.card);
          const what = t(type === "matter" ? "pick.look.matter" : type === "object" ? "pick.look.object" : "pick.look.entity");
          const reveal = candidates.length
            ? await pickFromPile(by, "deck", candidates, t("pick.search.some", { roll, what }), looked)
            : await pickFromPile(by, "deck", [], t("pick.search.none", { roll, what }), looked);
          // Senza mostrata, una delle guardate torna in cima: obbligatoria.
          let top: CardInstance | null = null;
          while (!reveal && !top) top = await pickFromPile(by, "deck", looked, t("pick.search.top"), looked);
          // Poi una delle altre nella Zona di Ritiro: obbligatoria, se restano carte.
          const others = looked.filter(card => card.uid !== reveal?.uid && card.uid !== top?.uid);
          let retire: CardInstance | null = null;
          while (others.length && !retire) retire = await pickFromPile(by, "deck", others, t("pick.retire"), others);
          view.hold(true);
          await wait(CONFIRMED_LEAD_MS);
          const passed = await ctx.dispatch({
            t: "look", seat: by, count: form.count, roll,
            ...(reveal ? { reveal: reveal.uid } : {}),
            ...(top ? { top: top.uid } : {}),
            ...(retire ? { retire: retire.uid } : {}),
            revealTo: "hand", restTo: "deck", effect: ref,
          });
          if (passed) {
            ctx.log(msg("log.effect.look", { seat: by, sourceCard: step.source.cardId, parts: [
              msg("look.rolled", { die: form.die, roll, n: looked.length }),
              reveal ? msg("look.reveal", { card: reveal.cardId }) : msg("look.noreveal"),
              ...(top ? [msg("look.top", { card: top.cardId })] : []),
              ...(retire ? [msg("look.retire", { card: retire.cardId })] : []),
              msg("look.rest"),
            ] }), by);
          }
          break;
        }
        case "drain": {
          view.hold(true);
          await wait(TRIGGER_LEAD_MS);
          const foe = otherSeat(by);
          const n = wornObjects(ctx.state(), by);
          const hp = Math.max(0, ctx.state().players[foe].hp - n);
          const passed = await ctx.dispatch({ t: "player", seat: foe, patch: { hp }, effect: ref });
          if (passed) ctx.log(msg("log.effect.drain", { seat: by, otherSeat: foe, sourceCard: step.source.cardId, n, hp }), by);
          await wait(TRIGGER_TAIL_MS);
          break;
        }
        case "move":
        case "exile":
        case "destroy": {
          // La distruzione già passata: resta solo il seguito «poi perdi N PV».
          if (form.kind === "destroy" && form.thenLose !== null && step.candidates.length === 0) {
            await loseAfterDestroy(step, ref, form.thenLose);
            break;
          }
          const hint = form.kind === "move" ? "target.impact" : form.kind === "exile" ? "target.repulse" : "target.judgment";
          // Il bersaglio scelto giocandola (RBF-021) non si richiede, né si riconferma: la scelta è stata fatta allora.
          const chosenAtPlay = step.candidates.length === 1 && Boolean(step.source.target);
          const target = chosenAtPlay ? step.candidates[0] : await pickTarget(step.source, step.candidates, t(hint));
          if (!target) break;
          view.strike(target.uid, 60_000);
          const question = form.kind === "move" ? "confirm.impact" : form.kind === "exile" ? "confirm.repulse" : "confirm.judgment";
          const sure = chosenAtPlay || (await confirmFor(controllerOf(step.source), t(question, { card: `«${ctx.card(target.cardId).name}»` })));
          if (!sure) {
            view.strike(target.uid, 0);
            view.render();
            break;
          }
          view.hold(true);
          await wait(CONFIRMED_LEAD_MS);
          const fly = view.liftForFlight(target.uid, form.kind === "move" ? "ritiro" : "abisso");
          const passed = await ctx.dispatch(
            form.kind === "move"
              ? { t: "toZone", uid: target.uid, zone: "ritiro", effect: ref }
              : form.kind === "exile"
                ? { t: "toZone", uid: target.uid, zone: "abisso", heldBy: step.source.uid, effect: ref }
                : { t: "toZone", uid: target.uid, zone: "abisso", effect: ref }
          );
          view.strike(target.uid, 0);
          if (passed) {
            fly?.();
            const line = form.kind === "move" ? "log.effect.retire" : form.kind === "exile" ? "log.effect.exile" : "log.effect.destroy";
            ctx.log(msg(line, { seat: by, sourceCard: step.source.cardId, card: target.cardId }), by);
            await wait(view.timing.fly);
            if (form.kind === "destroy" && form.thenLose !== null) await loseAfterDestroy(step, ref, form.thenLose);
          } else {
            fly?.cancel();
            view.render();
          }
          break;
        }
        case "block": {
          // la Reattiva bloccante (forma `block`) — il blocco è già avvenuto giocandola (§6.4); qui la
          // cura, se gli armati sul Fronte bastano (sennò step.blocked).
          view.hold(true);
          await wait(TRIGGER_LEAD_MS);
          const hp = ctx.state().players[by].hp + form.heal;
          const passed = await ctx.dispatch({ t: "player", seat: by, patch: { hp }, effect: ref });
          if (passed) ctx.log(msg("log.effect.heal", { seat: by, sourceCard: step.source.cardId, n: form.heal, hp }), by);
          await wait(TRIGGER_TAIL_MS);
          break;
        }
        case "fortune": {
          const roll = rollDie(form.die);
          await view.roll(form.die, roll, t("dice.step", { name, what: t("dice.fortune") }));
          const all = inRange(roll, form.allOn);
          view.hold(true);
          if (all || inRange(roll, form.gain.on)) {
            const hp = ctx.state().players[by].hp + form.gain.amount;
            const passed = await ctx.dispatch({ t: "player", seat: by, patch: { hp }, roll, effect: ref });
            if (passed) ctx.log(msg("log.effect.heal", { seat: by, sourceCard: step.source.cardId, n: form.gain.amount, hp }), by);
            await wait(TRIGGER_TAIL_MS);
          }
          if (all || inRange(roll, form.deploy.on)) {
            const filter = form.deploy.filter;
            const candidates = zoneCards(ctx.state(), by, "hand").filter(card => {
              const f = ctx.card(card.cardId);
              return f.kind === filter.kind && (filter.race === null || f.race === filter.race) && (filter.maxCost === null || (f.fluxCost !== null && f.fluxCost <= filter.maxCost));
            });
            const spot = freeFrontSlotOrNull(ctx.state(), by);
            if (candidates.length === 0) ctx.log(msg("log.no.target", { seat: by, card: step.source.cardId }), by);
            else if (!spot) ctx.log(msg("log.front.full", { seat: by, card: step.source.cardId }), by);
            else {
              const chosen = await pickFromPile(by, "hand", candidates, t("pick.fortune.deploy", { n: filter.maxCost ?? 0 }));
              if (chosen) {
                const passed = await ctx.dispatch({ t: "toZone", uid: chosen.uid, zone: "field", ...spot, z: ctx.state().zTop + 1, roll, effect: ref });
                if (passed) ctx.log(msg("log.effect.deploy", { seat: by, sourceCard: step.source.cardId, card: chosen.cardId }), by);
                await wait(TRIGGER_TAIL_MS);
              }
            }
          }
          if (all || inRange(roll, form.draw.on)) {
            const passed = await ctx.dispatch({ t: "draw", seat: by, count: form.draw.count, roll, effect: ref });
            if (passed) ctx.log(msg("log.effect.trigger", { seat: by, card: step.source.cardId, n: form.draw.count, cards: msg(form.draw.count === 1 ? "cards.one" : "cards.many") }), by);
          }
          if (!all && !inRange(roll, form.gain.on) && !inRange(roll, form.deploy.on) && !inRange(roll, form.draw.on)) {
            ctx.log(msg("log.effect.roll", { seat: by, sourceCard: step.source.cardId, die: form.die, roll, what: msg("roll.nothing") }), by);
          }
          break;
        }
      }
      await wait(TRIGGER_TAIL_MS);
    } finally {
      view.light(step.source.uid, false);
      view.hold(false);
    }
  }

  /**
   * Il flip verso il Nexus (§3.1), con l'arbitro: il requisito certificato
   * si legge qui (nexusCheck), lo scarto si sceglie dalla mano, il recupero
   * di PV è quello stampato — tutto in un'azione sola, che l'engine
   * verifica. Poi la scena «Quando flippa» coi passi del Nexus.
   */
  async function flipToNexus(card: CardInstance): Promise<boolean> {
    const facts = ctx.card(card.cardId);
    const nexus = facts.nexus;
    if (!nexus) {
      return ctx.dispatch({ t: "flip", uid: card.uid, face: (card.face + 1) % faceCount(card.cardId) });
    }
    const by = controllerOf(card);
    const check = nexusCheck(ctx.state(), card, ctx.card);
    if (!check.ok) {
      ctx.log(msg(check.why, { seat: by, n: check.n ?? 0 }), by);
      return false;
    }
    let discard: CardInstance | null = null;
    if (nexus.discard) {
      while (!discard) discard = await pickFromPile(by, "hand", check.discards, t(nexus.discard.kind === null ? "pick.nexus.discard.any" : "pick.nexus.discard"));
    }
    const passed = await ctx.dispatch({ t: "flip", uid: card.uid, face: nexus.face, ...(discard ? { discard: discard.uid } : {}), ...(nexus.recovery ? { recover: nexus.recovery } : {}) });
    if (!passed) return false;
    const hp = ctx.state().players[by].hp;
    ctx.log(msg("log.flip", { seat: by, card: card.cardId, recover: nexus.recovery ? msg("log.flip.recover", { n: nexus.recovery, hp }) : "" }), by);
    if (discard) ctx.log(msg("log.flip.discard", { seat: by, card: discard.cardId }), by);
    const live = ctx.state().cards[card.uid];
    if (!live) return true;
    const steps = flipSteps(ctx.state(), live, ctx.card);
    if (steps.length === 0) return true;
    void view.scene({
      cardId: live.cardId,
      face: live.face,
      theme: ctx.themeFor(live.owner),
      locale: ctx.locale(),
      who: t("scene.flips", { name: seatLabel(ctx.state(), by), card: `«${cardName(live.cardId, ctx.locale())}»` }),
      effects: [],
      triggers: steps.map(step => describeFlipStep(step, ctx.card)),
      kicker: t("scene.flip"),
      onContinue: () => playFlipSteps(steps),
    });
    return true;
  }

  async function playFlipSteps(steps: FlipStep[]): Promise<void> {
    for (const step of steps) {
      const by = controllerOf(step.source);
      view.hold(true);
      view.light(step.source.uid, true);
      try {
        await wait(TRIGGER_LEAD_MS);
        if (step.form.kind === "move") {
          // I candidati si rileggono dallo stato vivo, per contenuto della
          // forma: un confronto per riferimento non troverebbe mai nulla.
          for (const target of flipCandidates(ctx.state(), step.source, step.form)) {
            view.strike(target.uid, view.timing.fly);
            const fly = view.liftForFlight(target.uid, "abisso");
            const passed = await ctx.dispatch({ t: "toZone", uid: target.uid, zone: "abisso", effect: flipRef(step.source) });
            if (passed) {
              fly?.();
              ctx.log(msg("log.flip.absorb", { seat: by, sourceCard: step.source.cardId, card: target.cardId }), by);
              await wait(view.timing.fly);
            } else {
              fly?.cancel();
            }
          }
        } else if (step.form.kind === "draw") {
          const passed = await ctx.dispatch({ t: "draw", seat: by, count: step.form.count, effect: flipRef(step.source) });
          if (passed) ctx.log(msg("log.effect.trigger", { seat: by, card: step.source.cardId, n: step.form.count, cards: msg(step.form.count === 1 ? "cards.one" : "cards.many") }), by);
        } else {
          const sealed = [...new Set([...(ctx.state().players[by].sealed ?? []), step.form.cardId])];
          const passed = await ctx.dispatch({ t: "player", seat: by, patch: { sealed }, effect: flipRef(step.source) });
          if (passed) ctx.log(msg("log.flip.seal", { seat: by, sourceCard: step.source.cardId, card: step.form.cardId }), by);
        }
        await wait(TRIGGER_TAIL_MS);
      } finally {
        view.light(step.source.uid, false);
        view.hold(false);
      }
    }
  }

  /**
   * Con l'arbitro al tavolo la lavagna non è più libera: ogni carta ha il
   * suo posto segnato (§5) e ci si incastra, o non si posa affatto. Le
   * Entità stanno sugli slot del Fronte — quello del rilascio se è libero,
   * altrimenti il primo libero; a Fronte pieno il gesto cade. Le Materie
   * vanno nella loro fila, dietro. Il Rubyfront ha due posti soli, la Zona
   * di Richiamo da cui parte e il suo davanti al Fronte, e ci arriva solo
   * agganciato — e una volta schierato non torna indietro (§3.1).
   * Gli Oggetti non passano di qui: il loro posto è addosso a un'Entità, e
   * lo decide il rilascio (vedi applyDrop). `null` = il gesto non si fa.
   */
  function boundSpot(card: CardInstance, drop: { x: number; y: number; snapped: boolean }): { x: number; y: number } | null {
    const state = ctx.state();
    const kind = faceKind(card.cardId, card.face);
    const front = frontRowY(card.owner);
    if (kind === "rubyfront" || kind === "nexus") {
      if (!drop.snapped) return null;
      const deployed = drop.x === RUBYFRONT_X && drop.y === front;
      // In Zona di Richiamo si sta solo se non si è ancora schierati.
      const recalled = drop.x === SLOT_X.richiamo && drop.y === backRowY(card.owner) && card.y !== front;
      return deployed || recalled ? { x: drop.x, y: drop.y } : null;
    }
    if (kind === "matter") return matterSpot(state, card.owner);
    if (kind !== "entity") return { x: drop.x, y: drop.y };
    const others = fieldCards(state).filter(other => other.uid !== card.uid && Math.abs(other.y - front) < 40);
    const busy = (x: number): boolean => others.some(other => Math.abs(other.x - x) < 40);
    if (drop.snapped && drop.y === front && FRONT_SLOT_X.includes(drop.x) && !busy(drop.x)) return { x: drop.x, y: front };
    const free = FRONT_SLOT_X.find(x => !busy(x));
    return free === undefined ? null : { x: free, y: front };
  }

  /**
   * Schiera il Rubyfront pagando (§3.1): «il costo non cresce mai, si paga
   * identico a ogni schieramento». Col dado si tira qui — il dado gira al
   * centro del tavolo, poi la carta scende — e si paga il risultato; il
   * tiro è permesso solo se il Flusso disponibile, Gettone compreso, copre
   * le facce del dado. Il costo e il tiro viaggiano nell'azione: l'arbitro
   * li verifica (il tiro nella forma, non nella fortuna), il riduttore
   * scala. Fermato, il Rubyfront torna da dove era.
   */
  async function deploy(
    card: CardInstance,
    x: number,
    y: number,
    z: number,
    deployment: Deployment,
    origin: { x: number; y: number; z: number } | null
  ): Promise<void> {
    const giveBack = (): void => {
      if (origin) void ctx.dispatch({ t: "move", uid: card.uid, x: origin.x, y: origin.y, z: origin.z });
    };
    const player = ctx.state().players[card.owner];
    const available = player.flux + (player.token ? 1 : 0);
    let cost: number;
    let roll: number | undefined;
    if (deployment.die) {
      if (available < deployment.die) {
        ctx.log(msg("log.deploy.nodie", { seat: card.owner, die: deployment.die ?? 0, available }), card.owner);
        giveBack();
        return;
      }
      roll = 1 + Math.floor(Math.random() * deployment.die);
      cost = roll;
      await view.roll(deployment.die, roll, t("dice.deploy"));
    } else {
      cost = deployment.fixed ?? 0;
    }
    const passed = await ctx.dispatch({ t: "move", uid: card.uid, x, y, z, cost, ...(roll !== undefined ? { roll } : {}) });
    if (!passed) {
      giveBack();
      return;
    }
    const after = ctx.state().players[card.owner];
    const token = after.token ? msg("log.token.plus") : "";
    ctx.log(
      roll !== undefined
        ? msg("log.deploy.roll", { seat: card.owner, die: deployment.die ?? 0, roll, cost, flux: after.flux, max: after.fluxMax, token })
        : msg("log.deploy", { seat: card.owner, cost, flux: after.flux, max: after.fluxMax, token }),
      card.owner
    );
  }

  /**
   * Con l'arbitro al tavolo, una carta in mano che costa più del Flusso
   * disponibile — barra più Gettone (§3.2) — non si gioca: si vela, e il
   * doppio click non la gioca; si trascina però, perché scartarla non
   * costa. È un aiuto, non una regola: la regola è dell'engine (§3.2, il
   * costo delle carte), che fermerebbe comunque il gesto. Il Rubyfront ha il
   * costo di schieramento, un'altra cosa; costo ignoto, carta libera.
   */
  function unaffordable(card: CardInstance): boolean {
    if (!ctx.arbitrated() || card.zone !== "hand" || !ctx.controls(card.owner) || isRubyfront(card.cardId)) return false;
    const stats = cardStats(card.cardId);
    let cost = stats.fluxCost;
    if (cost === null) return false;
    const off = abilityDiscount(ctx.state(), card.owner, stats);
    if (off) cost = Math.max(1, cost - off.amount);
    const player = ctx.state().players[card.owner];
    return cost > player.flux + (player.token ? 1 : 0);
  }

  async function playReturn(step: EnterReturnStep): Promise<void> {
    const who = `«${cardName(step.source.cardId, ctx.locale())}»`;
    // §6.2, Fronte pieno: «anche la parte d'effetto che metterebbe in campo
    // non si applica». Il giocatore lo deve sapere: un pannello vuoto, o il
    // silenzio, sembrerebbero un difetto del tavolo.
    if (step.candidates.length === 0 && step.frontFull) {
      ctx.log(msg("log.front.full", { seat: step.source.owner, card: step.source.cardId }), step.source.owner);
      await view.notice(t("notice.front.full", { card: who }));
      return;
    }
    if (step.candidates.length === 0) {
      ctx.log(msg("log.no.permanent", { seat: step.source.owner, card: step.source.cardId }), step.source.owner);
      return;
    }
    view.light(step.source.uid, true);
    const card = await pickFromPile(step.source.owner, step.from, step.candidates, t("pick.return"));
    if (!card) {
      view.light(step.source.uid, false);
      return;
    }
    const sure = await confirmFor(controllerOf(step.source), t("confirm.return", { card: `«${ctx.card(card.cardId).name}»` }));
    if (!sure) {
      view.light(step.source.uid, false);
      return;
    }
    view.hold(true);
    try {
      await wait(CONFIRMED_LEAD_MS);
      const passed = await resolveReturn(ctx, step, card);
      if (passed) {
        view.flyFromPile(card.owner, step.from, card.uid);
        // La fonte si spegne appena la Materia è arrivata: il volo è
        // l'effetto, non c'è altro da aspettare.
        await wait(view.timing.fly);
      }
    } finally {
      view.light(step.source.uid, false);
      view.hold(false);
    }
  }

  async function playControl(step: EnterControlStep): Promise<void> {
    const by = controllerOf(step.source);
    if (step.candidates.length === 0) {
      ctx.log(msg("log.no.control", { seat: by, card: step.source.cardId }), by);
      return;
    }
    view.light(step.source.uid, true);
    const target = await pickTarget(step.source, step.candidates, t("target.control"));
    if (!target) {
      view.light(step.source.uid, false);
      return;
    }
    view.strike(target.uid, 60_000);
    const sure = await confirmFor(by, t("confirm.control", { card: `«${ctx.card(target.cardId).name}»` }));
    if (!sure) {
      view.strike(target.uid, 0);
      view.light(step.source.uid, false);
      view.render();
      return;
    }
    view.hold(true);
    let passed = false;
    try {
      await wait(CONFIRMED_LEAD_MS);
      // Se il controllo apre la fila di servizio avversaria (rincasso),
      // niente volo: dissolvenza, fila che si apre, scintilla e ricomparsa.
      const opens = view.opensFoeRow(by);
      const fly = opens ? view.liftToDissolve(target.uid) : view.liftToFlight(target.uid);
      passed = await resolveControl(ctx, step, target);
      view.strike(target.uid, 0);
      if (passed) {
        fly?.();
        await wait(opens ? view.timing.dissolve : view.timing.fly);
      } else {
        fly?.cancel();
        view.render();
      }
    } finally {
      view.light(step.source.uid, false);
      view.hold(false);
    }
    // §8.2 — il controllo non è un ingresso: la carta è già entrata in
    // campo, cambia solo chi la comanda. I suoi effetti «quando entra» NON
    // si riapplicano (decisione del designer, 2026-09-07); quelli «quando
    // attacca» valgono per chi la comanda, e passano dalla via normale.
  }

  /**
   * La stappata di chi entra (§8.2, RBF-011): la fonte si accende, il dado
   * gira al centro, e l'esito — stappata o niente — va all'engine in
   * un'azione sola.
   */
  async function playRefresh(step: EnterRefreshStep): Promise<void> {
    const name = ctx.card(step.source.cardId).name;
    view.light(step.source.uid, true);
    view.hold(true);
    try {
      const roll = rollDie(step.refresh.die);
      await view.roll(step.refresh.die, roll, t("dice.step", { name, what: t("dice.rally", { lo: step.refresh.onRoll[0], hi: step.refresh.onRoll[1] }) }));
      const passed = await resolveRefresh(ctx, step, roll);
      await wait(passed ? TRIGGER_TAIL_MS : 0);
    } finally {
      view.light(step.source.uid, false);
      view.hold(false);
    }
  }

  /**
   * L'abilità speciale del Rubyfront (§3.1): la Furia tira il d20 al
   * centro (§8.1), il potenziamento sceglie i bersagli PRIMA di pagare (chi
   * rinuncia non paga), poi l'azione — PV, tiro, esito, bersagli o sconto —
   * va all'engine in un colpo solo; lo sguardo nel mazzo si risolve dopo,
   * con la stessa vetrina degli ingressi, marcato `on_ability`.
   */
  async function useAbility(card: CardInstance, ability: Ability): Promise<boolean> {
    const by = controllerOf(card);
    const copy = abilityCopy(card.cardId, ability.face, ability.displayKey, ctx.locale());
    const price = ability.cost !== null ? t("ability.cost", { n: ability.cost }) : t("ability.gain", { n: ability.gain ?? 0 });
    const form = ability.form;
    if (!form) return false;
    let targets: string[] | null = null;
    // La chiamata sul Fronte: l'Entità dalla mano si sceglie PRIMA di
    // pagare (chi rinuncia non paga); senza Entità o senza slot si può
    // usare lo stesso, per il bonus alle attaccanti («puoi»).
    let summon: { card: CardInstance; spot: { x: number; y: number } } | null = null;
    if (form.kind === "summon") {
      const sealed = ctx.state().players[by].sealed ?? [];
      const candidates = zoneCards(ctx.state(), by, "hand").filter(other => {
        const facts = ctx.card(other.cardId);
        return facts.kind === "entity" && (form.race === null || facts.race === form.race) && !sealed.includes(other.cardId);
      });
      const spot = freeFrontSlotOrNull(ctx.state(), by);
      let chosen: CardInstance | null = null;
      if (candidates.length && spot) {
        view.light(card.uid, true);
        // Il bot sceglie la più forte (pickTarget), non «la meno cara da scartare».
        chosen = auto && isAuto(by) ? auto.chooser.pickTarget(card, candidates) : await pickFromPile(by, "hand", candidates, t("pick.ability.summon"));
        view.light(card.uid, false);
      }
      if (chosen && spot) summon = { card: chosen, spot };
      else {
        const go = await confirmFor(by, t("confirm.ability.nosummon", { name: copy.name, price }));
        if (!go) return false;
      }
    }
    if (form.kind === "power") {
      const candidates = fieldCards(ctx.state()).filter(other => {
        if (controllerOf(other) !== by) return false;
        const facts = ctx.card(other.cardId);
        if (facts.kind !== "entity") return false;
        if (form.race !== null && facts.race !== form.race) return false;
        if (form.attacking && declarationOf(ctx.state(), other.uid)?.kind !== "attack") return false;
        if (form.armed && wornBy(ctx.state(), other.uid).length === 0) return false;
        return true;
      });
      if (form.targets === "one") {
        if (candidates.length === 0) {
          const go = await confirmFor(by, t("confirm.ability.notargets", { name: copy.name, price }));
          if (!go) return false;
          targets = [];
        } else {
          view.light(card.uid, true);
          const chosen = await pickTarget(card, candidates, t("target.ability.power", { n: form.amount }));
          view.light(card.uid, false);
          if (!chosen) return false;
          targets = [chosen.uid];
        }
      } else {
        if (candidates.length === 0) {
          const go = await confirmFor(by, t("confirm.ability.notargets", { name: copy.name, price }));
          if (!go) return false;
        }
        targets = candidates.map(other => other.uid);
      }
    }
    // §8.1 — la Furia: il d20 al centro, prima dell'abilità.
    let roll: number | null = null;
    let fail = false;
    if (ability.fury) {
      const threshold = ctx.card(card.cardId).furyAt[card.face] ?? 12;
      roll = 1 + Math.floor(Math.random() * 20);
      await view.roll(20, roll, t("dice.fury", { name: copy.name, n: threshold }));
      fail = roll < threshold;
    }
    const discount: Discount | null = form.kind === "discount" ? { amount: form.amount, type: form.type, race: form.race } : null;
    view.light(card.uid, true);
    view.hold(true);
    let passed = false;
    try {
      passed = await ctx.dispatch({
        t: "ability",
        uid: card.uid,
        ability: ability.id,
        ...(ability.cost !== null ? { cost: ability.cost } : {}),
        ...(ability.gain !== null ? { gain: ability.gain } : {}),
        ...(roll !== null ? { roll } : {}),
        ...(fail ? { fail: true as const } : {}),
        ...(targets !== null ? { targets, power: form.kind === "power" ? form.amount : 0 } : {}),
        ...(discount ? { discount } : {}),
        ...(form.kind === "summon" ? { bonus: form.bonus } : {}),
      });
      if (passed) {
        if (roll !== null) ctx.log(msg("log.ability.fury", { seat: by, roll, outcome: msg(fail ? "fury.fail" : "fury.ok") }), by);
        ctx.log(msg("log.ability", { seat: by, name: copy.name, price, hp: ctx.state().players[by].hp }), by);
        if (form.kind === "power" && targets && targets.length) {
          ctx.log(msg("log.ability.power", { seat: by, n: form.amount, cards: targets.map(uid => cardName(ctx.state().cards[uid]?.cardId ?? uid, ctx.locale())).join(", ") }), by);
          for (const uid of targets) view.strike(uid, 900);
        }
        if (discount) {
          const what = msg(discount.type === "object" ? "what.object" : discount.race === "human" ? "what.entity.human" : "what.entity");
          ctx.log(msg("log.ability.discount", { seat: by, what, n: discount.amount }), by);
        }
        if (form.kind === "summon") {
          ctx.log(msg("log.ability.bonus", { seat: by, what: msg(form.bonus.race === "human" ? "what.entities.human" : "what.entities"), n: form.bonus.amount }), by);
        }
        await wait(TRIGGER_TAIL_MS);
      }
    } finally {
      view.light(card.uid, false);
      view.hold(false);
    }
    // La discesa della chiamata sul Fronte: la stessa via di una carta
    // giocata (scena d'ingresso, inneschi), gratis e marcata dall'abilità.
    if (passed && form.kind === "summon") {
      const live = ctx.state().cards[card.uid];
      if (live && summon) {
        const spot = freeFrontSlotOrNull(ctx.state(), by) ?? summon.spot;
        await place(summon.card, spot.x, spot.y, ctx.state().zTop + 1, {
          effect: { source: live.uid, event: "on_ability", entering: live.uid, ability: ability.id },
          grants: form.grants,
        });
      }
      view.render();
      return true;
    }
    if (!passed || form.kind !== "look") {
      view.render();
      return passed;
    }
    // Lo sguardo nel mazzo: le prime N, con la vetrina degli ingressi.
    const live = ctx.state().cards[card.uid];
    if (!live) return true;
    const step = lookAfterRoll(ctx.state(), live, { count: form.count, die: null, countBase: 0, reveal: form.reveal, thenRetire: false }, null, ctx.card);
    await playLook(step, { source: live.uid, event: "on_ability", entering: live.uid, ability: ability.id });
    return true;
  }

  async function playLook(first: EnterLookStep, ref: EffectRef | null = null): Promise<void> {
    const by = controllerOf(first.source);
    const name = ctx.card(first.source.cardId).name;
    view.light(first.source.uid, true);
    // Col dado (RBF-027): si tira, il dado gira al centro, e il conto delle
    // carte discende dal tiro.
    let step = first;
    if (first.look.die !== null) {
      const roll = 1 + Math.floor(Math.random() * first.look.die);
      await view.roll(first.look.die, roll, t("dice.look", { name }));
      step = lookAfterRoll(ctx.state(), first.source, first.look, roll, ctx.card);
    }
    if (step.looked.length === 0) {
      ctx.log(msg("log.look.empty", { seat: by, card: first.source.cardId }), by);
      view.light(first.source.uid, false);
      return;
    }
    const what = t(step.look.reveal?.kind === "object" ? "pick.look.object" : "pick.look.one");
    const title = step.candidates.length
      ? t("pick.look.some", { n: step.looked.length, what })
      : t("pick.look.none", { n: step.looked.length });
    const reveal = await pickFromPile(by, "deck", step.candidates, title, step.looked);
    // «Metti una delle altre nella tua Zona di Ritiro»: obbligatoria, se
    // restano carte — la finestra torna finché non si sceglie.
    let retire: CardInstance | null = null;
    if (step.look.thenRetire) {
      const others = step.looked.filter(card => card.uid !== reveal?.uid);
      while (others.length && !retire) {
        retire = await pickFromPile(by, "deck", others, t("pick.retire"), others);
      }
    }
    view.hold(true);
    try {
      await wait(CONFIRMED_LEAD_MS);
      const passed = await resolveLook(ctx, step, reveal, retire, ref);
      await wait(passed ? TRIGGER_TAIL_MS : 0);
    } finally {
      view.light(first.source.uid, false);
      view.hold(false);
    }
  }

  /**
   * Il disarmo all'ingresso (§8.2, dal 2026-09-10): nessuna scelta — ogni
   * Oggetto assegnato a un'Entità avversaria vola nella Zona di Ritiro del
   * suo proprietario, uno dopo l'altro, con la fonte accesa.
   */
  async function playDisarm(step: EnterDisarmStep): Promise<void> {
    if (step.candidates.length === 0) {
      ctx.log(msg("log.no.target", { seat: step.source.owner, card: step.source.cardId }), step.source.owner);
      return;
    }
    view.light(step.source.uid, true);
    view.hold(true);
    try {
      await wait(CONFIRMED_LEAD_MS);
      for (const object of step.candidates) {
        const live = ctx.state().cards[object.uid];
        if (!live || live.zone !== "field") continue;
        view.strike(object.uid, 60_000);
        const fly = view.liftForFlight(object.uid, step.to);
        const passed = await resolveDisarm(ctx, step, live);
        view.strike(object.uid, 0);
        if (passed) {
          fly?.();
          await wait(view.timing.fly);
        } else {
          fly?.cancel();
          view.render();
        }
      }
      await wait(TRIGGER_TAIL_MS);
    } finally {
      view.light(step.source.uid, false);
      view.hold(false);
    }
  }

  /**
   * Il riarmo all'ingresso (§8.2, dal 2026-09-10): a giri — un Oggetto dalla
   * propria Zona di Ritiro, poi l'Entità che lo riceve — finché ci sono
   * Oggetti ed Entità, o finché si chiude la pila.
   */
  async function playRearm(step: EnterRearmStep): Promise<void> {
    const by = controllerOf(step.source);
    view.light(step.source.uid, true);
    try {
      for (;;) {
        const { objects, bearers } = rearmChoices(ctx.state(), step.source, ctx.card, step.self);
        if (objects.length === 0 || bearers.length === 0) break;
        const object = await pickFromPile(by, "ritiro", objects, t(step.self ? "pick.rearm.self" : "pick.rearm.any"));
        if (!object) break;
        // Su di sé non c'è da mirare: l'Oggetto va addosso a chi entra.
        const bearer = step.self ? bearers[0] : await pickTarget(step.source, bearers, t("target.rearm"));
        if (!bearer) break;
        view.hold(true);
        try {
          const passed = await resolveRearm(ctx, step, object, bearer);
          if (passed) {
            view.flyFromPile(by, "ritiro", object.uid);
            await wait(view.timing.fly);
          }
        } finally {
          view.hold(false);
        }
        if (step.self) break;
        // Il bot riarma una volta per Entità e basta: il suo selettore non chiude mai la pila.
        if (isAuto(by) && rearmChoices(ctx.state(), step.source, ctx.card).bearers.every(entity => wornBy(ctx.state(), entity.uid).length > 0)) break;
      }
    } finally {
      view.light(step.source.uid, false);
    }
  }

  /**
   * Il ritorno vincolato (§8.2, dal 2026-09-10): la carta è appena finita
   * nell'Abisso o in Ritiro senza Oggetti addosso; il proprietario sceglie
   * dalla sua Zona di Ritiro l'Oggetto da assegnarle — o chiude la pila e
   * la lascia dov'è. Il Fronte pieno e la pila senza Oggetti adatti si
   * dicono in chat.
   */
  async function playLeaveReturn(step: LeaveReturnStep): Promise<void> {
    const seat = step.card.owner;
    if (step.frontFull) {
      ctx.log(msg("log.revive.frontfull", { seat, card: step.card.cardId }), seat);
      return;
    }
    if (step.candidates.length === 0) {
      ctx.log(msg("log.revive.noobject", { seat, card: step.card.cardId }), seat);
      return;
    }
    const object = await pickFromPile(seat, "ritiro", step.candidates, t("pick.revive", { card: `«${ctx.card(step.card.cardId).name}»` }));
    if (!object) return;
    const spot = freeFrontSlotOrNull(ctx.state(), seat);
    if (!spot) {
      ctx.log(msg("log.revive.frontfull", { seat, card: step.card.cardId }), seat);
      return;
    }
    view.hold(true);
    try {
      await wait(CONFIRMED_LEAD_MS);
      const passed = await resolveLeaveReturn(ctx, step, object, spot);
      if (passed) {
        view.flyFromPile(seat, step.card.zone, step.card.uid);
        view.flyFromPile(seat, "ritiro", object.uid);
        await wait(view.timing.fly + TRIGGER_TAIL_MS);
      }
    } finally {
      view.hold(false);
    }
  }

  /**
   * §3.1/§8.2 — «quando assegni questa carta a un'Entità»: la scena
   * dell'Oggetto appena assegnato, con l'esilio condizionato — si mira
   * un'Entità avversaria, si conferma, e va nell'Abisso tenuta dall'Oggetto
   * (heldBy: torna quando l'Oggetto lascia il gioco, come per la Materia).
   */
  async function playAssignStep(step: AssignStep): Promise<void> {
    const by = controllerOf(step.source);
    // La giocata dalla mano annuncia la sua scena («gioca …») subito dopo
    // che l'azione è passata: questa viene dopo, non sopra.
    await new Promise(resolve => setTimeout(resolve, 0));
    await view.sceneIdle();
    const candidates = step.form.kind === "exile" ? assignCandidates(ctx.state(), step, ctx.card) : [];
    if (step.form.kind === "exile" && candidates.length === 0) {
      ctx.log(msg("log.no.target", { seat: by, card: step.source.cardId }), by);
      return;
    }
    await view.scene({
      cardId: step.source.cardId,
      face: step.source.face,
      theme: ctx.themeFor(step.source.owner),
      locale: ctx.locale(),
      who: t("scene.assigns", { name: seatLabel(ctx.state(), by), card: `«${cardName(step.object.cardId, ctx.locale())}»`, toCard: `«${cardName(step.bearer.cardId, ctx.locale())}»` }),
      effects: enterEffects(step.source.cardId, step.source.face, ctx.locale()),
      triggers: [describeAssignStep(step, ctx.card)],
      kicker: t("scene.resolve.matter"),
      onContinue: () => undefined,
    });
    view.light(step.source.uid, true);
    try {
      if (step.form.kind === "draw") {
        view.hold(true);
        await wait(TRIGGER_LEAD_MS);
        const passed = await ctx.dispatch({ t: "draw", seat: by, count: step.form.count, effect: assignRef(step) });
        if (passed) ctx.log(msg("log.effect.trigger", { seat: by, card: step.source.cardId, n: step.form.count, cards: msg(step.form.count === 1 ? "cards.one" : "cards.many") }), by);
        await wait(TRIGGER_TAIL_MS);
        return;
      }
      if (step.form.kind === "ends") {
        await playEnds(step, step.form);
        return;
      }
      const target = await pickTarget(step.source, candidates, t("target.confine"));
      if (!target) return;
      view.strike(target.uid, 60_000);
      const sure = await confirmFor(by, t("confirm.confine", { card: `«${ctx.card(target.cardId).name}»` }));
      if (!sure) {
        view.strike(target.uid, 0);
        view.render();
        return;
      }
      view.hold(true);
      await wait(CONFIRMED_LEAD_MS);
      const fly = view.liftForFlight(target.uid, "abisso");
      const passed = await ctx.dispatch({ t: "toZone", uid: target.uid, zone: "abisso", heldBy: step.source.uid, effect: assignRef(step) });
      view.strike(target.uid, 0);
      if (passed) {
        fly?.();
        ctx.log(msg("log.effect.exile", { seat: by, sourceCard: step.source.cardId, card: target.cardId }), by);
        await wait(view.timing.fly);
      } else {
        fly?.cancel();
        view.render();
      }
    } finally {
      view.light(step.source.uid, false);
      view.hold(false);
    }
  }

  /**
   * §3.1 — il Rubyfront/Nexus «la prima volta in ogni tuo turno che assegni
   * un Oggetto»: la prima e l'ultima carta del mazzo in vista; sul Rubyfront
   * si possono scambiare (e poi si pesca e si scarta), sul Nexus una va in
   * mano e l'altra nella Zona di Ritiro.
   */
  async function playEnds(step: AssignStep, form: Extract<AssignForm, { kind: "ends" }>): Promise<void> {
    const by = controllerOf(step.source);
    const ref = assignRef(step);
    const ends = deckEnds(ctx.state(), by);
    if (!ends) {
      ctx.log(msg("log.look.empty", { seat: by, card: step.source.cardId }), by);
      return;
    }
    const pair = ends.top.uid === ends.bottom.uid ? [ends.top] : [ends.top, ends.bottom];
    if ("swap" in form) {
      // Scegliere una delle due vale «scambiale»; Chiudi le lascia.
      const chosen = pair.length === 2 ? await pickFromPile(by, "deck", pair, t("pick.ends.swap"), pair) : null;
      view.hold(true);
      await wait(CONFIRMED_LEAD_MS);
      const passed = await ctx.dispatch({ t: "ends", seat: by, ...(chosen ? { swap: true as const } : {}), effect: ref });
      if (!passed) return;
      ctx.log(msg(chosen ? "log.effect.ends.swap" : "log.effect.ends.kept", { seat: by, sourceCard: step.source.cardId }), by);
      await wait(TRIGGER_TAIL_MS);
      // «Poi pesca una carta e scarta una carta».
      if (form.thenDraw > 0) {
        const drew = await ctx.dispatch({ t: "draw", seat: by, count: form.thenDraw, effect: { ...ref, follow: "draw" } });
        if (!drew) return;
        ctx.log(msg("log.effect.trigger", { seat: by, card: step.source.cardId, n: form.thenDraw, cards: msg(form.thenDraw === 1 ? "cards.one" : "cards.many") }), by);
        await wait(TRIGGER_TAIL_MS);
      }
      for (let left = form.thenDiscard; left > 0; left -= 1) {
        const hand = zoneCards(ctx.state(), by, "hand");
        if (hand.length === 0) break;
        let chosen: CardInstance | null = null;
        while (!chosen) chosen = await pickFromPile(by, "hand", hand, t("pick.discard"));
        const fly = view.liftForFlight(chosen.uid, "ritiro");
        const discarded = await ctx.dispatch({ t: "toZone", uid: chosen.uid, zone: "ritiro", effect: { ...ref, follow: "discard" } });
        if (discarded) {
          fly?.();
          ctx.log(msg("log.effect.discard", { seat: by, sourceCard: step.source.cardId, card: chosen.cardId }), by);
        } else {
          fly?.cancel();
          break;
        }
      }
      return;
    }
    // Il Nexus: una in mano, l'altra in Ritiro — la scelta è obbligatoria.
    let chosen: CardInstance | null = null;
    while (!chosen) chosen = await pickFromPile(by, "deck", pair, t("pick.ends.hand"), pair);
    const other = pair.find(card => card.uid !== chosen?.uid);
    view.hold(true);
    await wait(CONFIRMED_LEAD_MS);
    const passed = await ctx.dispatch({ t: "ends", seat: by, toHand: chosen.uid, ...(other ? { toRetire: other.uid } : {}), effect: ref });
    if (passed) ctx.log(msg("log.effect.ends.pick", { seat: by, sourceCard: step.source.cardId, card: chosen.cardId, ...(other ? { otherCard: other.cardId } : {}) }), by);
    await wait(TRIGGER_TAIL_MS);
  }

  /**
   * §5/§8.2 — «quando quell'Entità muore, metti questo Oggetto nella tua
   * Zona di Ritiro invece che nell'Abisso. Poi puoi assegnare un altro
   * Oggetto dalla tua Zona di Ritiro, senza pagarne il costo, a un'Entità
   * senza Oggetto che controlli»: l'Oggetto vola dall'Abisso al Ritiro, poi
   * la scelta dell'altro Oggetto e del portatore — Chiudi per nessuno.
   */
  async function playRemainStep(step: DeathStep): Promise<void> {
    const by = step.object.owner;
    await new Promise(resolve => setTimeout(resolve, 0));
    await view.sceneIdle();
    await view.scene({
      cardId: step.object.cardId,
      face: step.object.face,
      theme: ctx.themeFor(step.object.owner),
      locale: ctx.locale(),
      who: t("scene.dies", { name: seatLabel(ctx.state(), by), card: `«${cardName(step.bearer.cardId, ctx.locale())}»`, object: `«${cardName(step.object.cardId, ctx.locale())}»` }),
      effects: enterEffects(step.object.cardId, step.object.face, ctx.locale()),
      triggers: [describeDeathStep(step, ctx.card)],
      kicker: t("scene.resolve.matter"),
      onContinue: () => undefined,
    });
    view.hold(true);
    try {
      await wait(CONFIRMED_LEAD_MS);
      const passed = await ctx.dispatch({ t: "remain", uid: step.object.uid, effect: deathRef(step) });
      if (!passed) return;
      view.flyFromPile(by, "abisso", step.object.uid);
      ctx.log(msg("log.effect.remain", { seat: by, card: step.object.cardId }), by);
      await wait(view.timing.fly + TRIGGER_TAIL_MS);
      const { objects, bearers } = rearmAfterDeath(ctx.state(), step, ctx.card);
      if (objects.length === 0 || bearers.length === 0) return;
      const object = await pickFromPile(by, "ritiro", objects, t("pick.remain.rearm"));
      if (!object) return;
      const bearer = await pickTarget(object, bearers, t("target.remain.bearer"));
      if (!bearer) return;
      const live = ctx.state().cards[bearer.uid] ?? bearer;
      const worn = Object.values(ctx.state().cards).filter(other => other.assignedTo === live.uid && other.zone === "field");
      const rearmed = await ctx.dispatch({
        t: "toZone", uid: object.uid, zone: "field",
        x: live.x + STACK_STEP * (worn.length + 1), y: live.y + STACK_STEP * (worn.length + 1), z: underStack(live, worn),
        assignTo: live.uid, effect: deathRef(step, "rearm"),
      });
      if (rearmed) {
        view.flyFromPile(by, "ritiro", object.uid);
        ctx.log(msg("log.effect.rearm", { seat: by, sourceCard: step.object.cardId, card: object.cardId, toCard: live.cardId }), by);
        await wait(view.timing.fly);
      }
    } finally {
      view.hold(false);
    }
  }

  async function playMove(step: EnterMoveStep): Promise<void> {
    if (step.candidates.length === 0) {
      ctx.log(msg("log.no.target", { seat: step.source.owner, card: step.source.cardId }), step.source.owner);
      return;
    }
    view.light(step.source.uid, true);
    const target = await pickTarget(step.source, step.candidates, t(step.hold ? "target.loose" : "target.retire"));
    if (!target) {
      view.light(step.source.uid, false);
      return;
    }
    // Scelto il bersaglio, si chiede conferma — con la carta accesa.
    view.strike(target.uid, 60_000);
    const sure = await confirmFor(controllerOf(step.source), t(step.hold ? "confirm.loose" : "confirm.retire", { card: `«${ctx.card(target.cardId).name}»` }));
    if (!sure) {
      view.strike(target.uid, 0);
      view.light(step.source.uid, false);
      view.render();
      return;
    }
    view.hold(true);
    try {
      await wait(CONFIRMED_LEAD_MS);
      const fly = view.liftForFlight(target.uid, step.to);
      const passed = await resolveMove(ctx, step, target);
      view.strike(target.uid, 0);
      if (passed) {
        fly?.();
        await wait(view.timing.fly + TRIGGER_TAIL_MS);
      } else {
        fly?.cancel();
        view.render();
      }
    } finally {
      view.light(step.source.uid, false);
      view.hold(false);
    }
  }

  /**
   * Il ritmo di un innesco: la fonte si accende e resta accesa; mentre è
   * accesa l'effetto agisce (la carta entra in mano); 350ms dopo si spegne.
   * Un innesco alla volta.
   */
  async function playTriggers(entering: CardInstance): Promise<void> {
    // Prima gli effetti di chi entra (§8.2, la forma di RBF-007): si mira,
    // poi la fonte si accende, la freccia va al bersaglio, la carta parte.
    for (const step of enterMoves(ctx.state(), entering, ctx.card)) {
      await playMove(step);
    }
    for (const step of enterReturns(ctx.state(), entering, ctx.card)) {
      await playReturn(step);
    }
    for (const step of enterLooks(ctx.state(), entering, ctx.card)) {
      await playLook(step);
    }
    for (const step of enterControls(ctx.state(), entering, ctx.card)) {
      await playControl(step);
    }
    for (const step of enterRefreshes(entering, ctx.card)) {
      await playRefresh(step);
    }
    for (const step of enterDisarms(ctx.state(), entering, ctx.card)) {
      await playDisarm(step);
    }
    for (const step of enterRearms(entering, ctx.card)) {
      await playRearm(step);
    }
    view.hold(true);
    try {
      for (const trigger of enterTriggers(ctx.state(), entering, ctx.card)) {
        view.light(trigger.source.uid, true);
        await wait(TRIGGER_LEAD_MS);
        const passed = await resolveTrigger(ctx, entering, trigger);
        await wait(passed ? TRIGGER_TAIL_MS : 0);
        view.light(trigger.source.uid, false);
      }
    } finally {
      view.hold(false);
    }
  }

  /** Da dove è partita la carta trascinata: se l'arbitro ferma il gesto, torna qui. */
  type Origin = { x: number; y: number; z: number };

  /**
   * Il rilascio sul campo di una carta trascinata, in coordinate canoniche
   * (la vista riporta lì il punto dello schermo): `snapped` se la carta si
   * è agganciata a un riquadro. Con l'arbitro il posto lo decide la lavagna
   * (boundSpot): un gesto senza posto — Fronte pieno, Rubyfront fuori dai
   * suoi due riquadri, Oggetto sul vuoto — non si fa, e la carta torna da
   * dove era partita. Il Rubyfront dalla Zona di Richiamo alla sua fila si
   * schiera pagando (§3.1); un Oggetto posato su un'Entità le si assegna
   * (§3.1), prima il permesso e poi i pixel.
   */
  function dropOnField(card: CardInstance, drop: { x: number; y: number; snapped: boolean }, origin: Origin | null): void {
    // Le Materie non si giocano sugli slot del Fronte (§5): il divieto è
    // dell'ARBITRO, non del tavolo — il rilascio parte com'è e, con
    // l'engine collegato, torna indietro col sigillo. A engine spento,
    // lavagna libera come sempre.
    let spot = drop.snapped ? stackAt(ctx.state(), drop.x, drop.y, card.uid) : { x: drop.x, y: drop.y };
    // Arbitro al tavolo: il posto lo decide la lavagna, non il dito.
    const bound = ctx.arbitrated() ? boundSpot(card, drop) : undefined;
    const giveBack = (): void => {
      // Con l'arbitro i pixel non hanno viaggiato: la carta è già dov'era,
      // e un «torna indietro» sarebbe uno spostamento vero — che la dogana
      // degli slot (§5) fermerebbe con un secondo sigillo. Basta ridisegnare.
      const live = ctx.state().cards[card.uid];
      if (origin && live && (live.x !== origin.x || live.y !== origin.y)) {
        void ctx.dispatch({ t: "move", uid: card.uid, x: origin.x, y: origin.y, z: origin.z });
      } else {
        view.render();
      }
    };
    if (bound === null) {
      giveBack();
      return;
    }
    if (bound) spot = bound;
    let x = Math.max(0, Math.min(SURFACE_W - TILE_W, spot.x));
    let y = Math.max(0, Math.min(SURFACE_H - TILE_H, spot.y));
    // Lo schieramento del Rubyfront (§3.1): dalla Zona di Richiamo alla
    // sua fila si paga il costo stampato — fisso, o un dado tirato qui.
    if (isRubyfront(card.cardId) && card.zone === "field") {
      const front = frontRowY(card.owner);
      const deployment = cardStats(card.cardId).deployment;
      if (deployment && card.y !== front && y === front) {
        void deploy(card, x, y, dropZ(card, x, y), deployment, origin);
        return;
      }
    }
    // Un Oggetto posato su un'Entità non resta dove l'ha lasciato il dito:
    // si accomoda da solo dietro di lei, a scaletta — in linea con la sua
    // portatrice, un gradino per ogni Oggetto già addosso.
    const under = entityUnder(card, x, y);
    // Con l'arbitro un Oggetto ha un posto solo: addosso a un'Entità (§3.1).
    if (ctx.arbitrated() && faceKind(card.cardId, card.face) === "object" && !under) {
      giveBack();
      return;
    }
    if (under) {
      const worn = Object.values(ctx.state().cards).filter(other => other.assignedTo === under.uid && other.uid !== card.uid).length;
      const step = STACK_STEP * (worn + 1);
      x = Math.max(0, Math.min(SURFACE_W - TILE_W, under.x + step));
      y = Math.max(0, Math.min(SURFACE_H - TILE_H, under.y + step));
    }
    const z = dropZ(card, x, y);
    // L'assegnazione è un fatto di gioco, non di pixel: il rilascio sopra
    // un'Entità la dichiara (azione `assign`, §3.1), il rilascio sul vuoto
    // la scioglie. E l'ORDINE conta: se il rilascio è una RIASSEGNAZIONE
    // (l'Oggetto era già addosso a qualcun altro), prima si chiede il
    // permesso e solo col sì si muovono i pixel — sennò il sigillo dice
    // «non si sposta» ma la carta intanto si è spostata.
    const current = ctx.state().cards[card.uid]?.assignedTo;
    void (async () => {
      if (under && under.uid !== current) {
        if (!(await ctx.dispatch({ t: "assign", uid: card.uid, to: under.uid }))) {
          // Fermata: la carta torna da dove era partita.
          if (origin) void ctx.dispatch({ t: "move", uid: card.uid, x: origin.x, y: origin.y, z: origin.z });
          return;
        }
        if (!(await place(card, x, y, z))) {
          // L'assegnazione era passata ma il gioco no (Flusso): si scioglie,
          // e la carta torna da dove era partita.
          void ctx.dispatch({ t: "assign", uid: card.uid, to: null });
          if (origin) void ctx.dispatch({ t: "move", uid: card.uid, x: origin.x, y: origin.y, z: origin.z });
          return;
        }
        ctx.log(msg("log.assign", { seat: card.owner, card: card.cardId, toCard: under.cardId }), card.owner);
        return;
      }
      void place(card, x, y, z);
      if (!under && current) void ctx.dispatch({ t: "assign", uid: card.uid, to: null });
    })();
  }

  /** §6.5 — lo scarto dell'eccesso dalla mano, in Zona di Ritiro, con la sua riga di chat. Vero se è passato. */
  function discard(card: CardInstance): Promise<boolean> {
    return ctx.dispatch({ t: "toZone", uid: card.uid, zone: "ritiro" }).then(passed => {
      if (passed) ctx.log(msg("log.discard", { seat: card.owner, card: card.cardId, n: zoneCards(ctx.state(), card.owner, "hand").length }), card.owner);
      return passed;
    });
  }

  /**
   * Il rilascio su una pila, o sulla mano (§5): le pile e la mano sono di
   * chi le possiede — una carta non cambia proprietario trascinandola nella
   * metà avversaria. Se l'arbitro ferma il gesto (dal campo non si torna in
   * mano) la carta torna da dove era. Vero se è stato lo scarto dell'eccesso
   * (§6.5): la vista spegne il suo invito.
   */
  function dropOnPile(card: CardInstance, seat: Seat, zone: ZoneId, origin: Origin | null): Promise<boolean> {
    if (seat !== card.owner) {
      ctx.log(msg("log.keep.owner", { seat: card.owner }), card.owner);
      return Promise.resolve(false);
    }
    const discarding = zone === "ritiro" && canDiscard(ctx, card);
    return ctx.dispatch({ t: "toZone", uid: card.uid, zone }).then(passed => {
      if (!passed && origin) void ctx.dispatch({ t: "move", uid: card.uid, x: origin.x, y: origin.y, z: origin.z });
      if (!passed || !discarding) return false;
      ctx.log(msg("log.discard", { seat: card.owner, card: card.cardId, n: zoneCards(ctx.state(), card.owner, "hand").length }), card.owner);
      return true;
    });
  }

  return {
    // Le regole del tavolo per chi disegna: tasti, veli, rilasci.
    deployBlock,
    waitingRubyfront,
    flipReady,
    deployedRubyfront,
    rubyfrontOf,
    looksPlayable,
    unaffordable,
    boundSpot,
    touchedAt,
    entityUnder,
    dropZ,
    isAuto,
    // I gesti.
    place,
    deploy,
    dropOnField,
    dropOnPile,
    discard,
    declareAttack,
    useAbility,
    flipToNexus,
    openAbilities,
    /** §7.2 — la catena che si risolve: la vista la spinge a ogni ridisegno. */
    driveChain,
    setAuto(seat: Seat | null, chooser: AutoChooser): void {
      auto = seat ? { seat, chooser } : null;
    },
    /** §8.2 — il ritorno vincolato, per chi possiede la carta appena uscita dal campo. */
    offerLeaveReturns(before: GameState, after: GameState, owners: Seat[]): void {
      const steps = leaveReturns(before, after, ctx.card).filter(step => owners.includes(step.card.owner));
      if (steps.length === 0) return;
      void (async () => {
        for (const step of steps) await playLeaveReturn(step);
      })();
    },
    /** §8.2 — «quando quell'Entità muore»: l'Oggetto resta in Ritiro. */
    offerDeathRemains(before: GameState, after: GameState, owners: Seat[]): void {
      const steps = deathSteps(before, after, ctx.card).filter(step => owners.includes(step.object.owner));
      if (steps.length === 0) return;
      void (async () => {
        for (const step of steps) await playRemainStep(step);
      })();
    },
    /** §3.1 — «quando assegni questa carta»: per chi comanda l'Oggetto. */
    offerAssignTriggers(before: GameState, after: GameState, owners: Seat[]): void {
      const steps = assignSteps(before, after, ctx.card).filter(step => owners.includes(controllerOf(step.source)));
      if (steps.length === 0) return;
      void (async () => {
        for (const step of steps) await playAssignStep(step);
      })();
    },
    // I gesti del bot (session.ts): le stesse vie del giocatore.
    playFromHand(card: CardInstance, spot: { x: number; y: number }): Promise<boolean> {
      return place(card, spot.x, spot.y, dropZ(card, spot.x, spot.y));
    },
    async assignObject(card: CardInstance, bearer: CardInstance): Promise<boolean> {
      // Lo stesso ordine del rilascio sopra un'Entità: prima l'assegnazione
      // (§3.1), poi la giocata; se la giocata non passa, si scioglie.
      if (!(await ctx.dispatch({ t: "assign", uid: card.uid, to: bearer.uid }))) return false;
      const worn = Object.values(ctx.state().cards).filter(other => other.assignedTo === bearer.uid && other.uid !== card.uid).length;
      const step = STACK_STEP * (worn + 1);
      const x = Math.max(0, Math.min(SURFACE_W - TILE_W, bearer.x + step));
      const y = Math.max(0, Math.min(SURFACE_H - TILE_H, bearer.y + step));
      if (!(await place(card, x, y, dropZ(card, x, y)))) {
        void ctx.dispatch({ t: "assign", uid: card.uid, to: null });
        return false;
      }
      ctx.log(msg("log.assign", { seat: card.owner, card: card.cardId, toCard: bearer.cardId }), card.owner);
      return true;
    },
    async deployRubyfront(seat: Seat): Promise<boolean> {
      const waiting = waitingRubyfront(seat);
      if (!waiting || deployBlock(waiting)) return false;
      const deployment = cardStats(waiting.cardId).deployment;
      if (!deployment) return false;
      const front = frontRowY(seat);
      await deploy(waiting, RUBYFRONT_X, front, dropZ(waiting, RUBYFRONT_X, front), deployment, { x: waiting.x, y: waiting.y, z: waiting.z });
      return true;
    },
    attackWith(card: CardInstance): Promise<void> {
      return declareAttack(card);
    },
  };
}
