# Rubyfront — Rulebook

> **Status:** DRAFT — being written.
> This is the English edition of `docs/MANUALE.md`, which remains the **source of truth** for the rules: where the two differ, the Italian text prevails, and every change to the Italian is carried over here in the same commit. The game engine is implemented by following that manual faithfully.

---

## 1. Overview

- **Name of the game:** Rubyfront
- **Players:** 2 (one against one)
- **Races:** three for now — **Humans**, **Auros** (immortal beings) and **Simulacra** (shapes not of flesh, animated by Matter)
- **The Rubyfront:** the beast at the centre of the game, from which the game takes its name
- **Length of a game:** open — it can last minutes as well as hours. There is no time limit and no turn limit.

### 1.1 The golden rule

**The card always beats the rules of the game.** If the text of a card contradicts a rule in this rulebook, the card's text prevails.

### 1.2 The rule of maximum extension

**If the card doesn't specify, it applies to everything it could possibly apply to.** When a card's text doesn't narrow its targets, conditions or cases (it doesn't say "only…", "opposing", "on the field"…), the effect applies in its widest extension: everything that could possibly fall under the text does.

*Example: an HP-recovery effect with no stated maximum can take HP even above the value printed on the card; an effect naming "an Entity" without adjectives can target any Entity, your own or the opponent's.*

## 2. Object of the game

Each player has their **own Rubyfront** in the deck (see §3.1), which starts the game in the Recall Zone.

You win in one of these two ways:

1. by bringing the **HP (Health Points) of the opposing Rubyfront to zero**, or
2. by **destroying the Nexus** of the opposing Rubyfront, that is bringing the Nexus's HP to zero, if the opponent has played it (see §3.1, "The Nexus").

## 3. Game materials

### 3.1 The deck

- Each player has a **personal deck of 40 cards, plus the Rubyfront** (exactly **one** Rubyfront per deck): the Rubyfront **doesn't count among the 40**, it is the forty-first card. The deck holds all of the player's other cards: Entities, Matters and Objects (there are no separate sideboards).
- The **Rubyfront is never drawn**: at the start of the game it is placed directly in the **Recall Zone** (see §5).

Cards with a race are called **Entities** (not "creatures"). Every Entity belongs to a **race**: **Humans**, **Auros** or **Simulacra** (the Rubyfront stands apart). To play a card — **Entity, Matter or Object** — you must **spend Flux** equal to the cost printed on the card.

#### Anatomy of an Entity card

Every card shows:

- **Name** of the card
- **Artwork**
- **Race**
- **Flux cost** to enter the field
- **Power** — the card's only statistic (there is no separate attack and defence)
- **Counterattack +N** (if any) — marked with its own symbol, if the card has it (see §6.3, "Counterattack")
- **Ability** (if any) — the card's keyword, if it has one (§8.1)
- **Description**, with the **effect** (if any) that applies when the card is put onto the field
- **Matter types** the card can use, with the **maximum grade** for the types that have grades (§7.1)

> The **graphic layout** of these elements on the card **is not fixed by this rulebook**: here we list what a card shows, not where.

**Matters** are the game's spell/event cards (see §7).

#### Object cards

**Objects** are cards that are **assigned to an Entity**:

- **they have a Flux cost**, like Entities and Matters: it is paid **every time the Object is assigned from the hand** (§6.2), and like every other card it never goes below **1** (§3.2);
- **from the hand you always pay again:** an Object that **returns to hand** is a card like any other — to put it back on the field you **play it again, paying its full cost**. Having paid it once before doesn't count;
- **direct re-entry from a zone is a different matter:** if an effect brings an Object **from the Abyss or the Retire Zone directly onto the field**, assigning it to an Entity, the Object comes back **without paying its Flux cost again** — it's the effect putting it into play, not a normal assignment. If the card nevertheless asks for a cost or sets conditions, the card's text applies (§1.1);
- **there is no limit** to the number of Objects that can be assigned to the same Entity: the only constraint is Flux, barring restrictions stated on the cards (e.g. "to an Entity without an Object");
- they are assigned **only to your own Entities**, unless the card says otherwise;
- **they are not assigned to a covered Entity** (§6.3): a covered Entity is untouchable even for its owner. The Objects it **already** had assigned, however, stay with it;
- **they are not assigned to the Rubyfront or the Nexus** (they are not Entities), unless the card says otherwise;
- once assigned, the Object **cannot be moved** to another Entity;
- when the Entity leaves the field, its Objects **follow it**: they go to the **Abyss** — or to the **Retire Zone**, if the Entity was retired (§6.2);
- **a return to the field is always unarmed:** if that Entity **comes back onto the field** — put back on the Front by an effect, returned to hand and played again, or back in play at the end of a conditional exile — **it enters without Objects**. The Objects that followed it **stay where they are** (Abyss or Retire Zone) and don't reassign themselves: to re-arm it you need a **new assignment** — from the hand, paying the full cost again, or through an effect that brings the Object back onto the field directly from its zone (at no cost).

The deck **may mix races** freely. You may have at most **3 copies of the same card** in the deck; **Unique** cards — marked with the **Unique symbol** — allow **a single copy**.

#### The Rubyfront as a card

Every Rubyfront is a card with **values of its own**: there are no standard values shared by all Rubyfronts.

The Rubyfront card shows:

- **HP (Health Points)** — its **only statistic**. Attacks taken lower its HP; at zero, the owner loses (§2).
- **Deployment cost** — the Flux cost to deploy it onto the field: a **fixed number** (e.g. `2`) or a **die** (e.g. a `6`-sided die) to roll. See below.
- **Available Matters** — the Matter types the Rubyfront can use, **with the maximum grade** for the types that have grades (like Entities, §7.1).
- **Main ability** — it is born when the Rubyfront enters the field and from then on it is **always active**.
- **Description** with the **effect that resolves when it enters the field** from the Recall Zone — **on every deployment**, not just the first.
- **Special abilities** — using them **costs HP**.

The Rubyfront **can be attacked even while it is in the Recall Zone**: its HP are a valid target from the beginning to the end of the game. Abilities (main and special) and Matters, however, are **usable only when it is on the field**: deploying it unlocks them.

#### Deployment cost

The cost to deploy the Rubyfront is **a fixed number** (e.g. `2`) or **a die** (e.g. the symbol of a `6`-sided die, that is a d6 to roll).

**The cost never grows:** it is paid the same on every deployment. Once deployed, the Rubyfront **does not go back to the Recall Zone** (see "Staying on the field", below): a redeployment only arises if **a card** sends it back there (golden rule, §1.1), and then the same cost is paid again — which with a die means **a new roll**.

| Printed on the card | How it is paid |
|---|---|
| `2` | 2 Flux, on **every** deployment |
| `6`-sided die | roll a d6 and pay the result, on **every** deployment |

##### The die cost

When the cost is a die, **it isn't written: it is rolled**. You roll the die shown — a `6` means a **d6** — and you pay in Flux **the number rolled**.

- **You may roll only if your available Flux covers the worst result**, that is **the faces of the die**: 6 with a d6. With less Flux than that **the die is not rolled** and the Rubyfront **is not deployed**. The rule exists to guarantee that **a roll is always payable**: you never roll a cost you couldn't then honour.
- *Example: on the second turn you have 2 Flux and the card asks for a d6 → the roll is not allowed and deployment is impossible, even though the die might come up 1 or 2. From the turn in which you have 6 Flux the roll becomes legal: if it comes up 2 you pay 2 Flux (and 4 remain), if it comes up 6 you pay 6.*
- **You roll on every deployment** and the result applies to that one only: the check on available Flux is repeated every time.
- The **Flux Token** (§3.2) counts towards available Flux for the check and can be spent to pay the result.
- **The largest possible die is a d20**: the maximum Flux is 20 (§3.2), beyond that there would be no always-payable roll.
- **The cost roll is not the Fury roll** (§8.1): they are two distinct, independent rolls. Deploying the Rubyfront is **never** subject to the Fury d20 — not even when the cost is a die — and a high result makes nothing fail: you pay and you come onto the field.

#### Staying on the field

**Once deployed, the Rubyfront does not go back to the Recall Zone.** Not because of HP loss: when it takes damage or losses — attacks that get through, effects, Matters, its own or the opponent's — it takes them and **stays on the field**, exactly like the Nexus, and its enabled Matters **do not switch off** because of a hit taken. And not by the owner's choice: **there is no voluntary recall**.

**Only a card can send it back to the Recall Zone** (golden rule, §1.1). No card does so today; if one does, from the moment of the return the Rubyfront stops enabling its Matters (the permanents of the types that only it enabled go to the Abyss, §7.2) and the redeployment pays the full cost again — a new roll, if the cost is a die.

**Deployment window:** the owner may deploy the Rubyfront throughout their own turn, from the **Preparation Phase** to the **end of the turn** — even after finishing attacking (the Rubyfront doesn't attack: its job is to use HP-costed abilities and Matters, so deploying it at the end of the turn is legitimate). **Never in the middle of a response chain** (§7.2): the chain is atomic.

#### The Rubyfront's role on the field

When it enters the field, the Rubyfront **does not attack** and **does not block** (unless the card says otherwise — the golden rule §1.1 always applies). The point of deploying it is to:

- use its **special abilities** (paying their HP cost) — activated **freely, only on your own turn**, in the Preparation Phase as well as the Front Phase. The same ability can be activated **several times per turn**, as long as the HP suffice. They resolve **with no chance of response** (the chain applies only to Reactives). An ability can be activated **only if the HP cover the whole cost** (HP ≥ cost): HP never go below 0. **Beware:** paying down to exactly 0 is legal, but at 0 HP you lose the game **immediately** — the ability's effect **does not resolve**;
- use the **Matters** available to it;
- **trigger the Nexus**, when the requirements are met (see "The Nexus", below).

HP are thus a double-edged resource: they are the losing condition, but also the currency with which the Rubyfront pays for its special abilities.

#### The Nexus

The Rubyfront card has **two faces**: one is the **Rubyfront**, the other is its **Nexus** — the Rubyfront's evolution.

- **How it is played:** you **flip** the Rubyfront card to its other face. Requirements and conditions:
  - the **requirements** for the flip are written on the card itself and must be met **at the moment of the flip**: once played, the Nexus stays on the field even if the requirements later stop being true;
  - the **Rubyfront must be on the field** (you don't flip from the Recall Zone);
  - once the requirements are met, the flip can be done at any moment of your own turn, **from the Preparation Phase to the end of the turn** (the same window as the Rubyfront's movement, §3.1), and has no other cost.
- **HP recovered:** the Nexus face shows an **HP recovery** (e.g. `+5`): the Nexus starts with the **HP the Rubyfront had left plus the recovery shown**.
- **Staying:** the Nexus **replaces the Rubyfront** and **stays on the field for the whole game**, unless cards say otherwise. **It never goes back to the Recall Zone**, like the deployed Rubyfront (§3.1). When an attack gets through to it, it takes the damage and stays on the field.
- **Flip, effects and Matters:** the flip **is not a new entry onto the field**: it doesn't trigger "when you play a card/Entity" effects and, for the purposes of resolution order (§8.2), the card keeps the age of the Rubyfront's deployment. From the moment of the flip **the effect shown on the Nexus face becomes active**. The enabled Matters are **those printed on the Nexus face** (nothing is inherited from the Rubyfront): permanent Matters of the types the Nexus keeps enabling **survive the flip without interruption**; those of the types no longer enabled go to the **Abyss**.
- **What it looks like:** it has the same structure as the Rubyfront — HP, **its own available Matters** (printed on its face) and **special abilities**, clearly **more powerful**. Like the Rubyfront, **it neither attacks nor blocks** (unless the card says otherwise).
- **No inheritance of abilities:** as with Matters, the Nexus's **abilities** (main and special) are **only those printed on its face**. The Rubyfront's main ability **does not pass** to the Nexus: if the Nexus face shows none, the Nexus **has no main ability** (a Nexus can therefore be free of its Rubyfront's Fury, or have one of its own).
- **Destruction = defeat:** bringing the **Nexus's HP to 0** means destroying it — it is winning condition no. 2 (§2).
- **General rule:** after the flip, **every rule in this rulebook that names the Rubyfront applies identically to the Nexus** (target of attacks, damage from unblocked attacks, special abilities only on your own turn, enabled Matters…), unless otherwise stated.

### 3.2 Flux

**Flux** is the resource with which cards are paid for, in place of the classic mana. Unlike mana:

- **there are no Land cards** (or similar) to play in order to generate resources;
- each player has their own maximum Flux value, which **grows automatically by +1 at the start of each of their own turns, from the second one on**;
- both players **start with 1 Flux** (1st turn: 1, 2nd turn: 2, 3rd turn: 3…);
- spent Flux **refills completely at the start of your own turn**;
- on the **opponent's turn** you have available the **unspent** Flux left over from your own turn (e.g. to play Reactive Matters in defence): keeping Flux aside is a strategic choice;
- **absolute cap: 20 Flux.** Flux can never exceed 20 in any way. The only thing that lives outside the bar: the **Flux Token** (see below).

**Minimum cost: 1 Flux.** No card in the game — Entity, Matter or Object — costs less than **1**: there are no free cards. Playing anything always consumes at least one point of the bar, and this is what makes Flux a true rhythm of the game: the first turn grants **one** play, not a free number of zero-cost cards.

**Flux costs defined by cards:** besides paying for playing cards, Flux can appear as **the cost of an ability or effect**, when a card expressly provides for it (golden rule, §1.1). It is paid from your own bar, under the same conditions as any other Flux expense, and in the windows the card states.

#### Flux Token

The player who does **not** start the game receives a **Flux Token**: it represents **1 extra point of Flux**, it is **single-use** and can be used **at any moment of the game** — even on the opponent's turn or in the middle of a response chain (it makes up for the disadvantage of going second).

The Token is **outside the 20-Flux cap**: it is not part of the Flux bar, it is a separate point, always usable. Even at 20 Flux it can be spent — the only case in which, in effect, you reach 21.

## 4. Setting up the game

1. **Who starts:** if both players agree, they may **freely choose** who starts. Otherwise both roll a **d20**: whoever rolls higher starts the game; on a **tie, roll again**.
2. **Flux Token:** the player who doesn't start receives the Flux Token (see §3.2).
3. **Rubyfront:** each player puts their Rubyfront in the **Recall Zone** (see §5).
4. **Opening hand:** before the first turn begins, both players **draw 6 cards**.
5. **Mulligan:** each player may mulligan **up to 3 times**: shuffle **the whole hand** back into the deck and draw **6 new cards**, with no penalty. After the third mulligan they are **forced to keep the hand**. Mulligans are **simultaneous**: each player handles their own without waiting for the other. When a player is happy with their hand, they **declare that they are ready**; when both have declared, the game begins.
6. Both players start with **1 Flux**.

## 5. Zones

Each player's field is made up of:

- **Front** — the battlefield: **5 slots** where Entities stand. The Rubyfront, when deployed, is placed **in front of** the 5 slots (it doesn't take up a slot); Matters in play (permanent or resolving) stand **behind** the 5 slots. Permanents are lined up **one behind the other (or one below the other), in the order in which they came onto the field**: the row keeps track of each one's age, which is needed for the resolution order of effects (§8.2). Matters **are not played on the Front slots**: wherever possible, they are laid **in the Matters space**, behind the slots — the slots belong to Entities, and the row of Matters must stay legible because it's what tells each one's age. An Entity **occupies the slot it came down on**: it doesn't move from one slot to another, unless a card says so (golden rule, §1.1).
- **Deck** — the cards to draw.
- **Abyss** — the zone of **dead or spent** cards: Entities that died or were destroyed, Matters that resolved, decayed or vanished, Objects following a dead Entity, cards discarded from hand. It is **public**: either player may look through it at any time.
- **Retire Zone** — the zone of cards **still "alive"** that have left the game: Entities that were **retired** (§6.2) or **sent there by card effects**, and the Objects that follow them — Objects that **stay** there even when the Entity comes back onto the field (§3.1). It works **exactly like the Abyss** (public, viewable at any time), but keeps apart what never died from what did: effects that name the Abyss **do not** touch the Retire Zone, and vice versa. A card sent to the Retire Zone by an effect **does not die** and, unless the effect says otherwise, **does not count as a Retire**: it only counts as **leaving the field**.
- **Recall Zone** — the Rubyfront is placed here and **always starts here**, unless the card says otherwise. Once deployed **it never returns** — neither for HP loss nor by choice — unless a card sends it back (§3.1).

The **deck** and the **hand** are **hidden** from the opponent.

## 6. Structure of the turn

The turn is made of four phases, in order: **Draw → Preparation → Front → Reaction**. The first three belong to the active player; the **Reaction** is the **defender's** phase, inside the attacker's turn — and it exists only if an attack wave has been declared (§6.3).

### 6.1 Draw Phase

**Draw:** the active player draws a card. This applies to the **first turn of the starting player** too: the draw is never skipped.

### 6.2 Preparation Phase

Declared by the player at the end of the Draw. In this phase you start playing cards and **prepare the Front**. The player may:

- **play Entities** (paying their Flux cost);
- **play** normal and permanent **Matters** (Reactives are played only in the Front Phase, §7.2), laying them **in the Matters space**, never on the Front slots (§5);
- **assign Objects** (Object cards) to Entities, paying their Flux cost — even several Objects to the same Entity;
- **retire** their own Entities from the Front (see "Retire", below).

**There is no limit to the number of cards playable** in the phase: the only constraint is the available Flux — **Objects included**, which are paid for like any other card.

On the Front you may have **at most 5 Entities at the same time** — the **5 slots** of the Front (§5). **Only Entities** count towards the limit: the **Rubyfront** takes no slot (deployed, it stands in front of the slots), **permanent Matters** stand behind the slots and **have no limit in number** (the only constraint is enabling, §7), **Objects** are assigned to Entities and take no slot.

**With a full Front** (5 slots taken) no more Entities can be played. If an **effect** would put a card onto the field with a full Front, that part of the effect **does not apply** (the card doesn't enter) and the rest of the effect resolves normally.

#### Retire

The player may **retire** their own Entities from the Front: the retired Entity goes to the **Retire Zone** (§5) and its slot becomes free again.

- **When:** only in the **Preparation Phase**, and only on your **own** Entities. Retiring is an action of Front preparation: you don't retire in the Front Phase, nor on the opponent's turn, nor in the middle of a response chain (§7.2).
- **Cost:** none. There is **no limit** to the number of Entities you can retire in a turn: you may even empty the whole Front.
- **Not on the turn of entry:** an Entity **that entered the field this turn cannot be retired**; you must wait for the next turn, as with the summoning wait. Without this constraint, with a full Front you could play an Entity just for its entry effect and retire it at once to free the slot, turning Retire into an effect engine. **Surge** (§8.1) does **not** get around this ban: it lets you attack at once, not be retired at once.
- **You don't have to play something in its place:** you may retire just to free slots, or with no intention of bringing other cards down.
- **It is not a death:** that's why the retired Entity goes to the **Retire Zone** and not to the Abyss — retiring **does not count as dying or being destroyed** and "when an Entity dies / is destroyed" effects **do not trigger**. It does count as **leaving the field** for effects that use that wording (§1.2).
- **Assigned Object:** it follows its Entity (§3.1) — it too goes to the **Retire Zone**. If the Entity **comes back onto the field**, though, it comes back **without Objects**: those stay in the Retire Zone until a new assignment — from the hand, paying, or through the effect of a card that brings them back onto the field from the zone — puts them back into play (§3.1).
- **Enabling Matters:** the retired Entity stops enabling its Matter types. If it was the last one enabling a type, access is lost and the permanent Matters of that type go to the Abyss (§7.2). Retiring without checking what you are enabling is a costly mistake.
- **A tapped or covered Entity cannot be retired.** Retiring requires an **untapped** Entity: a covered one is untouchable even for its owner (§6.3), a tapped one is busy and doesn't retire until it untaps. This also applies to **stasis** (§8.1), which is a permanent tap: an Entity in stasis **cannot be retired** and keeps taking up its slot until it is untapped by an effect or leaves the field some other way. In practice, on your own turn your Entities untap at the start of the turn, so the constraint weighs on Entities in stasis and on those tapped by effects.
- The **Rubyfront doesn't retire**: it isn't an Entity and takes no slot. Once deployed it **stays on the field** and doesn't go back to the Recall Zone, unless a card sends it back (§3.1). The **Nexus**, once on the field, never leaves it (§3.1).

**Summoning wait:** an Entity that has just entered the field **cannot attack on the turn it enters**; it must wait for the next turn. It can, however, already **block** on the opponent's turn that follows.

### 6.3 Front Phase (combat)

Once the Preparation Phase is over, the active player **declares entry into the Front Phase**. The phase is **optional**: the player may also end the turn directly from the Preparation Phase, without declaring it. In that case **there is no Pre-Front** and no window to play Reactives opens that turn. If declared, the phase unfolds in this order:

1. **Pre-Front:** once the opening of the Front is declared, **the opponent may play Reactive Matters**. The active player may respond with the response chain (§7.2).
2. **The active player's Reactive window:** once the Pre-Front is over, the active player may play their own Reactive Matters (the opponent may respond in a chain, §7.2).
3. **Front ready — attack declaration (or pass):** the active player **selects all the Entities they attack with** and declares them **in a single wave** — or declares that they pass. **After the declaration no more Reactives can be *started***, with a single exception: a Reactive played as a block (§6.4). **Chain responses** (§7.2) always remain possible: every Reactive played can be answered with other Reactives.

Once the wave is declared, the word passes to the defender: you enter the **Reaction Phase** (§6.4). If instead the player **passes**, there is no Reaction and you go to the End of turn (§6.5).

**Deploying the Rubyfront:** reminder — it can be deployed at **any moment of your own turn**, even after the attacks, up to the end of the turn (see §3.1, "Deployment window").

#### Attack rules

- Each Entity **attacks only once per turn**.
- **The attacker is tapped at the moment the wave is declared** (§6.3, point 3), not at the resolution of its battle. The Entity will untap at the start of its owner's next turn: it therefore stays tapped for **the whole opponent's turn that follows** and **won't be able to block** — attacking costs the chance to defend (see "States of Entities", below).
- A **tapped** Entity **cannot attack**.
- An Entity that entered the field that turn **cannot attack** (summoning wait, §6.2).
- **You always attack the opposing Rubyfront**, never the other Entities directly.
- An **unblocked attack** deals the Rubyfront damage equal to the **attacker's Power** (its HP go down by that much).

#### Blocking

- The **defender may choose to block** with their own Entities, deciding whether or not to let the attack through to the Rubyfront.
- **Reactive Matters can also block attacks**, if the card's text provides for it (and there is Flux to pay for them): when blocks are declared, the defender may assign one of these Reactives to an attacker **in place of one of their own Entities** (§6.3, point 4).
- The challenge is always **1 against 1**: each attacker may be blocked by **a single Entity**, and each Entity may **block only once per turn**.
- A **tapped** Entity **cannot block** (e.g. because it attacked on its own previous turn).
- **When an Entity blocks it is tapped.**

#### Resolving a battle (attacker vs blocker)

The **Powers** are compared:

- If the blocker's Power is **lower** than the attacker's → the blocker **dies** (goes to the Abyss), but **the attack is blocked anyway** (the Rubyfront takes no damage).
- If the Powers are **equal** → **both Entities die**: attacker and blocker go to the Abyss, and the attack is blocked anyway. The only exception is **Stasis** (§8.1): the Entity that has it, if it is blocking, ends up **permanently tapped** instead of dying — the other one dies all the same.
- If the blocker's Power is **higher** → the attack is blocked and **nobody dies** (barring **Revenge**, §8.1).
- In a normal block the attacker dies **only on a tie**.

*Example: an Entity with Power 4 attacks; the defender blocks with an Entity of Power 3 → the blocker dies, the attack doesn't get through. With Power 4 (equal) both die. With Power 5 or more nobody dies.*

#### Leaving the field between declaration and resolution

Between the declaration of blocks and the resolution of battles, effects may intervene (e.g. a chain opened by a Reactive played as a block) that remove already-committed cards from the field:

- If the **blocker** assigned to an attacker leaves the field before its battle resolves, at resolution that attack is **unblocked**: it gets through and deals damage to the Rubyfront. The block **is not reassigned**.
- If it is the **attacker** that leaves the field before resolution, the battle **doesn't happen**: no comparison, no damage. The blocker assigned to it stays **tapped** anyway (and the counterattacker **covered**): tap and cover trigger at the declaration of blocks (§6.3, point 4) and are not undone.

#### Counterattack

Some Entities have the statistic **Counterattack +N**. When they block, they may **choose to counterattack**: their Power becomes `Power + N` for that comparison, and the Entity is **covered** (instead of tapped) — it will be **uncovered later on**.

The choice *normal block or counterattack* is declared **at the moment blocks are assigned** (§6.3, point 4), not at resolution: the defender can't wait to see how the previous battles resolve before deciding.

Resolution of the counterattack (total = Power + N against the attacker's Power):

- **Higher total** → **the attacker dies**; the counterattacker is safe.
- **Equal total** → **both Entities die** (tie rule, §6.3): attacker and counterattacker go to the Abyss — barring **Stasis** (§8.1) for a counterattacker that has it.
- **Lower total** → the counterattacker **dies** and goes to the Abyss, as in a normal block.

*Example: attacker with Power 4; a blocker with Power 3 and Counterattack +2 chooses to counterattack → 3+2 = 5 > 4: the attacker dies, the blocker survives but stays covered.*

#### States of Entities: tapped and covered

- **Tapped** (for having **attacked or blocked**): a tapped Entity **can neither attack, nor block, nor be retired** (§6.2). It **untaps at the start of its owner's next turn**. The practical difference lies in when the tap happens:
  - **tap in defence** (for having blocked, on the opponent's turn): the owner's turn comes right after, so the Entity untaps at once and loses nothing — the tap only marks that it has already blocked in that defence turn;
  - **tap in attack** (for having attacked, on your own turn): the Entity stays tapped for **the whole opponent's turn that follows** and therefore **cannot block** — in short, attacking costs the defence.

  A tapped Entity **keeps enabling its Matters** (§7): the tap commits it to combat, it doesn't switch off its enabling. Matters of the types it enables therefore remain playable even while it is tapped.
- **Covered** (for having counterattacked): a covered Entity **can do nothing** while covered, and is **untouchable in every sense**, by both players. For the owner: it can't receive Objects (the one already assigned stays with it) nor be **retired** (§6.2). For anyone: **it can't be targeted nor suffer effects or Matters of any kind, not even the opponent's** — while covered it is as if it weren't on the field (it does keep taking up its Front slot), unless cards say otherwise (§1.1). Unlike a tapped one (§8.1), **it doesn't enable its Matters**: the enabling is suspended for the whole cover. If it was the only card enabling a type, access to that type is lost, but the permanent Matters of that type **do not decay**: they are **covered too** — they stay on the field suspended, with their effect switched off, as if they weren't on the field — and **reactivate automatically when the Entity is uncovered**. If, however, the covered Entity leaves the field before being uncovered, the enabling is truly lost and the covered permanents go to the Abyss (§7.2). The cover lasts **a full round**:

  1. *Opponent's turn (T):* the Entity counterattacks and is **covered**.
  2. *Owner's turn (T+1):* it cannot attack.
  3. *Opponent's turn (T+2):* it cannot block.
  4. *Owner's turn (T+3):* it is **uncovered** and can act again.


### 6.4 Reaction Phase

The **defender's** phase, inside the attacker's turn: once the wave is declared, the word passes to them — **the attacker adds no more attacks** and waits for the reaction. The defender, **having seen the whole wave**, decides how to react:

- **assigns their blocks**: each attacker may be blocked by **one of their own Entities** (1-against-1 challenges: one blocker per attacker, each Entity blocks only once; whoever blocks taps, whoever counterattacks is covered), **or** by a **Reactive Matter whose text allows blocking** (paying its Flux cost): the Reactive replaces the blocker for that attack. **There is no Power comparison** (the Reactive has none): the attack is **blocked anyway**, and the attacker's fate, if any, is set by the **Reactive's text**. Like every Reactive, **it opens the response chain** (§7.2): the attacker may respond;
- or **doesn't block**, in whole or in part: the attacks let through will reach the Rubyfront at resolution.

**Resolution:** once the Reaction is over (blocks assigned, or the defender waives), the battles resolve one at a time, **in the order in which the attackers were declared** (Power comparison for each pair; unblocked attacks deal damage to the Rubyfront). Then the turn ends (§6.5).

### 6.5 End of turn

You may not have **more than 7 cards in hand**: at the end of your own turn, the excess cards are **discarded** (to the Abyss).

The discard for excess is **the last action of the turn**: first any "at end of turn" effects resolve, then the excess cards are discarded and the turn passes to the opponent.

## 7. Matters

**Matters** are the game's spell/event cards. They can't be played freely: a Matter card is playable **only if there is a card on the field that has that Matter type enabled**.

- Matters **have a Flux cost**, like Entities.
- Every Entity shows the **Matter types it enables** (§3.1). From the moment the Entity enters the field, its owner may play Matter cards of the enabled types.
- The **Rubyfront** has its own enabling Matters too, but they apply **only when it is deployed on the field**: as long as it stays in the Recall Zone it enables nothing (§3.1).
- Enabling must be **maintained**: if the last card on the field enabling a Matter type leaves the field **or is covered** (§6.3 — a covered Entity doesn't enable; a **tapped** one **enables normally**), the player **immediately loses access** to that type. Enabling is always assessed **at the required grade** (§7.1): second-grade cards need an enabler up to the second grade, both to play them and to maintain them.
- **Attribution:** if **several cards on the field** enable the same Matter type (at the required grade), the player **chooses which enabling card to attribute** the Matter they play to. The choice can matter when an effect refers to the enabling card. (Fury does **not** make attribution more relevant: Matters are not subject to its roll, §8.1.)

*Example: I play an Entity that has Dynamic Matter among its enabled Matters → from that moment I can play cards of type Dynamic Matter.*

### 7.1 Matter types

There are five Matter types:

1. **Dynamic Matter**
2. **Dimensional Matter**
3. **Destructive Matter**
4. **Zero Matter**
5. **Dominant Matter**

#### Race Matters: Dynamic, Dimensional, Destructive

The first three Matters are **usually tied to a race**, barring anomalies (cards that are exceptions):

| Matter | Race |
|---------|-------|
| **Dynamic** | Humans and Simulacra |
| **Dimensional** | Auros |
| **Destructive** | **exclusive to the Rubyfront** |

**Grades.** Dynamic, Dimensional and Destructive come in **first grade** and **second grade**:

- every Matter card of these types has a grade;
- the Entity card shows **up to which grade** it can use each enabled Matter;
- a **second-grade** Matter requires on the field a card enabling that type **up to the second grade**: if the Entity enables only the first grade, the second-grade Matter **is not playable**.

#### Zero Matter and Dominant Matter

- **They are not tied to a race**: they can belong to cards of any race, but **only a few Entities enable them** — they are particularly rare.
- **They have no grades** (grades exist only for Dynamic, Dimensional and Destructive).
- As with every Matter, **what they do is stated by the single card**: they have no special behaviour rules beyond rarity and the absence of grades.

### 7.2 Behaviours of Matter cards

Every Matter card has a **description with an effect**. Depending on the wording on the card, there are three behaviours:

#### Normal Matter (no wording)

- It is played in the **Preparation Phase**.
- The effect **resolves immediately**, then the card goes to the **Abyss**.
- It is the classic behaviour of a Matter card.

#### Permanent Matter

- Identical to the normal one: it is played in the **Preparation Phase**.
- The effect is **permanent**: the card **stays in play** and doesn't go to the Abyss.
- **It doesn't take up a Front slot:** it stands **behind** the 5 Entity slots (§5) and doesn't count towards the limit; there is no limit to the number of permanents in play.
- **It decays together with its enabling:** if the player loses access to the Matter type **at the permanent's grade** (the last card enabling that type at the required grade leaves the field), the permanent goes to the **Abyss**. A lower-grade enabler **is not enough**: a second-grade permanent decays if only a first-grade enabler is left on the field — consistent with the response chain, where enabling is always rechecked "at the required grade". **Exception — cover:** if access is lost only because the last enabling card has been **covered** (§6.3), the permanent doesn't go to the Abyss: **it is covered too** — it stays on the field with its effect suspended, as if it weren't on the field — and **reactivates** when the enabler is uncovered. If the enabler leaves the field while covered, the covered permanent goes to the Abyss. **This applies to the Rubyfront too** — which, however, never leaves the field by itself (§3.1): only if **a card** sends it back to the Recall Zone does it stop enabling its Matters, and the permanents of the types that **only it** enabled (typically Destructive) go to the Abyss; with the **flip to the Nexus**, the permanents of the types the Nexus face no longer enables decay (§3.1, "The Nexus").
- Whether it can be destroyed or removed by effects **depends on the cards**.

#### Reactive Matter

- It is played **only in the Front Phase**. Reactives can be boosts to attacks and defences, but also **special effects of any kind**. A Reactive **is never an "attack"** in the sense of the combat rules (§6.3): any damage it deals is effect damage (which for a Rubyfront on the field still counts as HP loss; the Rubyfront takes it and stays on the field, §3.1).
- **Nobody can step in whenever they please:** Reactives are played only in the windows provided.
- **The opponent's window (Pre-Front):** at the opening of the Front Phase, before the attack declaration, the opponent may play Reactives (§6.3).
- **The active player's window:** after the Pre-Front and before declaring Front ready, the active player may play Reactives.
- **After the attack declaration no more Reactives are *started***, with a single exception: the defender's Reactives **played as a block**, assigned to an attacker in place of an Entity (§6.3). A Reactive played this way opens a **normal response chain**: you respond **only with Reactives**, as in every chain. Boosts played *on your own initiative*, instead, must be played **before** the attack declaration, "in advance": they are a gamble for both.
- In every window, whoever is hit by the Reactive may **respond** (see response chain).

#### Response chain

**Universal rule:** the windows establish who may *start* a Reactive; but **every time a player casts a Reactive, the opponent may always respond**.

- You may respond **only with Reactive Matters**.
- Whoever cast may in turn **counter-respond**, and so on: the chain goes on as long as the players can and want to add Reactives. The alternation is **strict**: after each Reactive only the **opponent** of whoever cast it may play — you can't put two of your own Reactives in a row on the same chain.
- When the player whose turn it is to respond **passes**, the chain **resolves in reverse order**: the **last** Matter played resolves **first**, then back and back to the first. Once the chain has resolved, whoever has the window may start a new one.
- **The chain is atomic:** from the first cast to full resolution no other actions are taken. In particular, **deploying the Rubyfront and flipping to the Nexus cannot happen mid-chain** (§3.1). Using the **Flux Token** in a chain remains possible (§3.2, it exists precisely to pay for Reactives).
- **Enabling is rechecked at resolution:** if, when a Reactive in the chain is due to resolve, its player no longer has on the field a card enabling that type at the required grade (e.g. a response has removed the enabler), the Reactive **vanishes** — it goes to the Abyss with no effect, and the Flux stays spent.

## 8. Card abilities and effects

### 8.1 Abilities (keywords)

**Abilities** are **keywords with rules predefined** by this rulebook: when a card shows an ability, it applies its rules as they are, with no need for extra text on the card.

The Rubyfront's **main ability** works the same way: it is a keyword, active from the moment it enters the field (§3.1).

#### List of abilities

##### Fury

A card with **Fury** is unstable: its power doesn't fully answer to its owner. **Fury is exclusive to the Rubyfront and the Nexus**: it appears only as their main ability — Entities **cannot have it**.

**Fury is tied to abilities.** Before using a **special ability** of the card with Fury, the owner **rolls a d20**:

- with **12 or more**, the ability is used **with no consequences**;
- with **11 or less**, Fury turns against the owner: the Rubyfront (or the Nexus) **loses 1 HP**, but **the ability is used anyway** and resolves normally.

A failed roll **no longer cancels anything**: it is a surcharge — 1 HP on top of the ability's normal HP cost. Mind the HP limit (§3.1): if the failure's loss brings HP to **0**, you lose the game **immediately** and the ability doesn't resolve.

**Matters are not subject to Fury:** using a Matter attributed to the card with Fury — **including Destructive Matter**, exclusive to the Rubyfront (§7.1) — **requires no roll**. The d20 concerns **special abilities only**.

**Deploying the Rubyfront is never subject to the roll:** deployment (§3.1) always happens without a d20. **Nor does the flip to the Nexus require the roll** (§3.1): turning the card is not an action subject to Fury.

**Opposing** Matters that target a card with Fury work normally, with no roll: the d20 concerns only the owner's actions.

> **Transition note:** the value `X` printed next to Fury on some cards belonged to the old rule (variable loss and action cancelled on failure) and **no longer applies**: the loss is always **1 HP** and the action succeeds anyway. Card texts will be updated.

##### Surge

An Entity with **Surge** may **attack already on the turn it enters the field**, ignoring the summoning wait (§6.2).

Surge concerns **the attack only**: it doesn't exempt the Entity from the other rules tied to the turn of entry. In particular, an Entity with Surge **cannot be retired on the turn it enters** (§6.2), like any other.

##### Stasis

When an Entity with **Stasis** blocks and **should die** — Power **lower than or equal to** the attacker's (§6.3: on a tie both die) — instead of dying it **stays on the field, permanently tapped**: it will never untap again and can no longer attack or block. It keeps taking up a Front slot, but since it is still on the field **it keeps enabling its Matters**.

Stasis also saves from a **failed counterattack**: if the Entity counterattacks and its total **doesn't exceed** the attacker's Power (lower or equal), instead of dying it too ends up **permanently tapped** (the stasis state replaces the cover).

On a **tie**, Stasis saves **only the Entity that has it**: the other Entity in the comparison dies normally.

An Entity in stasis is for all purposes *tapped* (not covered), and like every tapped one **cannot be retired** (§6.2) but **keeps enabling its Matters**: the slot stays taken until the Entity is **untapped by an effect** (at which point it becomes a normal Entity again) or leaves the field some other way. Stasis is a rescue paid for in space.

Stasis protects **only in defence** (block or counterattack): an Entity with Stasis that dies **attacking** — against a blocker with Revenge or on a tie (§6.3) — dies normally.

##### Revenge

When an Entity with **Revenge** blocks and its **Power exceeds** the attacker's, **the attacker dies** even without a counterattack. (In a normal block the attacker dies only on a tie — §6.3.)

For the rest, the Entity with Revenge follows the normal blocking rules: it is tapped, and doesn't get covered (it isn't counterattacking).

### 8.2 Effects

**Effects** are the text in the card's description (e.g. the effect that resolves when the card enters the field). Unlike abilities, they are not keywords: they do what the text says (golden rule, §1.1).

#### Damage and Entities

**Damage exists only for the Rubyfront and the Nexus:** they are the only cards with HP, and taking damage means losing HP (a Rubyfront on the field takes the loss and stays on the field, §3.1). **Entities never take damage:** an effect that "deals N damage" cannot target them — its possible targets are only the Rubyfront and the Nexus (your own or the opponent's, by maximum extension §1.2). Cards that act on Entities use explicit wordings: "destroy…", Power reductions, and so on.

#### Power changes

Effects can raise or lower an Entity's Power. Power **never goes below 0**: any reduction past zero is ignored. An Entity at **Power 0 stays on the field** and follows the normal rules: if it attacks unblocked it deals 0 damage; in battle comparisons its value of 0 applies (a blocker at Power 0 dies against any attacker of higher Power, and so on).

#### Resolution order of simultaneous effects

When an event triggers **several effects at the same moment**, they resolve in this order:

1. **First the protagonist of the event:** the card to which something happened (it entered the field, it died…) resolves its own effect first.
2. **Then the other triggered effects, from the youngest card to the oldest:** the effect of the card that came onto the field **most recently** resolves first, then back and back to the oldest (like a stack: cards pile up in the order they come down and resolve from the top).

The order also applies between cards of different players: what counts is the moment of coming onto the field, which is single and shared. No player ever chooses the order: it is always determined by the state of the field.

For the purposes of this order what always counts is **the latest entry onto the field**: a Rubyfront redeployed after a card sent it back to the Recall Zone (§3.1) counts as a card **that has just arrived** (the youngest), it doesn't keep the age of its first deployment.

**Simultaneous entries** (rare case): if a single effect puts several cards onto the field at the same time, they enter at the same moment but **the player controlling the effect decides which enters "first"** — even for any opposing cards — and that order sets their age for the purposes of this rule.

*Example: I play an Entity with the entry effect "discard a card" while I have two permanents on the field — the older one says "when you play an Entity, draw a card", the more recent one "when you play an Entity, deal 1 damage to the opposing Rubyfront". Order: first the Entity that entered (discard), then the younger permanent (damage), finally the older one (draw).*

#### Taking control of an Entity

Some effects let you **take control** of an opposing Entity, usually **until the end of the turn**. Control doesn't change ownership: the card remains its owner's, and only who commands it changes.

- **Where it stands:** the controlled Entity moves to the controller's field, in an **extra slot** — it doesn't take up one of the 5 Front slots and doesn't count towards their limit. The **Objects** assigned to it follow it.
- **What it does:** it attacks for its controller (if an effect grants it Surge, at once); its **"when it enters the field" effects**, if any, **apply**, because it enters the controller's field. It keeps enabling its Matters for its controller.
- **End of control:** at the **turn change** it goes back to its owner's Front, in a free slot, as it is — and untaps like each of their Entities at the start of their turn (§6.3). If the owner's Front is **full**, it goes to their **Retire Zone**. The Objects go back with it.
- **If it dies or leaves the field** while controlled, it goes to the Abyss or to the **owner's** zone, as always.

#### Events generated during resolution

Resolving an effect can generate **new events** (a death, an entry onto the field…) while other effects triggered by the previous event are still waiting. In that case **they queue up** (FIFO): first **the whole group of effects of the current event** is exhausted, in the order set out above; then the new event resolves, with its own group of triggered effects ordered the same way — and so on, event after event, until the queue is empty. A new event **never interrupts** the group being resolved.

**A triggered effect resolves anyway:** once triggered, the effect is "in flight" — it resolves even if its source (the Entity or permanent that generated it) **leaves the field before its turn to resolve**. This rule applies to triggered effects; Reactive Matters in a chain follow their own rule instead and **vanish** if the enabling is missing at resolution (§7.2).

*Example: I play Entity E ("Destroy an opposing Entity") with P2 on the field, the younger permanent ("when you play an Entity, the opposing Rubyfront loses 1 HP") and P1, the older one ("when you play an Entity, draw a card"). The opponent controls Y ("when Y dies, destroy the youngest opposing permanent Matter"). Order: E resolves and destroys Y — Y's death is a new event and its effect queues up; P2 resolves (the opponent loses 1 HP); P1 resolves (I draw); finally Y's effect resolves, destroying P2. Had Y's effect instead managed to destroy P2 before its turn to resolve, P2's already-triggered effect would have resolved anyway.*

## 9. Special rules and edge cases

### 9.1 Running out of deck

If the deck runs out, **you lose**: the player draws the **last card** of the deck, plays **that turn in full**, and at the end of the turn **has lost the game**.

The last turn is a true last chance: if during that turn the player meets a winning condition (opposing Rubyfront's HP at 0 or opposing Nexus destroyed), **they win** — the defeat by exhaustion only triggers at the end of the turn.

**The right to a last turn applies only if the last card is drawn during your own turn** (with the Draw Phase's draw or by an effect): you complete that turn and lose at its end. If instead the last card is drawn **on the opponent's turn** (e.g. an opposing effect that makes you draw), there is no last turn: the player **has lost outright** when their next turn would begin.

**Effect draw from an empty deck:** if an **effect** asks you to draw when the deck is empty, the draw simply **doesn't happen**; the rest of the effect resolves normally.

### 9.2 Draw

A draw exists in only two cases:

- **by mutual agreement**, declared by both players;
- **automatic**, if both players reach **0 HP at the same moment** (e.g. a single effect that zeroes the HP of both Rubyfronts/Nexuses): the game is tied.

### 9.3 Summary of limits

- At most **7 cards in hand** (the excess is discarded at end of turn, §6.5).
- At most **5 Entities on the Front** (the 5 slots; the Rubyfront and permanent Matters don't count, §6.2).
- At most **3 copies** of the same card in the deck — **only one** if the card is **Unique** (§3.1).
- At most **20 Flux** (§3.2). The Flux Token is outside the cap: it is a separate point.
- **Minimum cost 1 Flux** for any card (§3.2): there are no free cards.
- **Die** deployment cost: you roll only with available Flux **at least equal to the faces of the die**; the die doesn't exceed a **d20** (§3.1).

## 10. Glossary

- **Entity** — a card with a race (Humans, Auros or Simulacra). It is the official term: "creature" is not used.
- **Rubyfront** — each player's beast; it starts in the Recall Zone. Once deployed **it never goes back**, neither for HP loss nor by choice: only a card can send it back to the Recall Zone (§3.1). Bringing its HP to zero (or destroying its Nexus) makes its owner lose.
- **Flux** — the resource for playing cards. It grows +1 per turn, refills at the start of the turn, maximum 20.
- **Flux Token** — single-use token worth +1 Flux, given to whoever doesn't start the game, usable at any moment; it is outside the 20-Flux cap.
- **Deployment cost** — how much Flux it takes to bring the Rubyfront from the Recall Zone to the field (§3.1): a fixed number or a **die** to roll. It never grows: it is paid the same on every deployment (if a card sends the Rubyfront back to the Recall Zone, you pay again — and with a die you roll again). The roll is allowed only if the available Flux covers the faces of the die.
- **Front** — the battlefield: 5 slots for Entities; the deployed Rubyfront stands in front of the slots, Matters in play behind.
- **Recall Zone** — the zone where the Rubyfront starts; once deployed it never returns, unless a card sends it back (§3.1).
- **Unique** — a classification printed on the card (the Unique symbol): the deck allows at most one copy (§3.1).
- **Abyss** — the zone of dead or spent cards: Entities that died or were destroyed, Matters that resolved, decayed or vanished, Objects of dead Entities, cards discarded from hand. It is public.
- **Retire Zone** — the zone of cards still "alive" that have left the game: retired Entities (§6.2) or ones sent there by effects, and their Objects. It works like the Abyss, but sets apart what never died; effects that name one of the two zones don't touch the other.
- **Power** — an Entity's only statistic. Modifiable by effects, it never goes below 0; at Power 0 the Entity stays on the field.
- **Damage** — HP loss: only the Rubyfront and the Nexus can take it. Entities never take damage (cards that hit them use explicit wordings such as "destroy").
- **Matter** — a spell/event card, playable only if a matching type is enabled by a card on the field. Three behaviours: normal, permanent, Reactive.
- **Reactive Matter** — a Matter playable only in the Front Phase; it triggers the response chain (resolution in reverse order).
- **Pre-Front** — the window at the start of the Front Phase in which the opponent may play Reactive Matters before the attack declaration.
- **Object** — a card with a Flux cost that is assigned to an Entity (with no limit of Objects per Entity), paying it in the Preparation Phase on every assignment made **from the hand** — even when the Object has returned there after already having been on the field. An effect that brings it back onto the field **directly from the Abyss or the Retire Zone** makes you pay nothing (§3.1). It follows the Entity that leaves the field (Abyss or Retire Zone), but **doesn't come back with it**: an Entity re-entering the field always re-enters unarmed (§3.1).
- **Ability** — a keyword with rules predefined by this rulebook (see §8.1).
- **Fury** — ability exclusive to the Rubyfront/Nexus, tied to **special abilities**: before using one you need a d20 ≥12; with 11 or less you lose **1 HP** but the ability is used anyway. Matters (Destructive included), deployment and the flip require no roll (§8.1).
- **Surge** — ability: the Entity may attack already on the turn it enters the field (it ignores the summoning wait). It concerns the attack only: it doesn't allow being retired on the turn of entry.
- **Stasis** — ability: if, blocking or counterattacking, it should die (comparison lost **or tied**, §6.3), it stays on the field permanently tapped instead. Like every tapped one **it cannot be retired** (§6.2) but keeps enabling its Matters: it takes up the slot until an effect untaps it or it leaves the field.
- **Revenge** — ability: if it blocks with Power higher than the attacker's, the attacker dies even without a counterattack.
- **Summoning wait** — an Entity cannot attack on the turn it enters the field.
- **Retire** — voluntarily sending one of your own **untapped** Entities from the Front to the Retire Zone, in the Preparation Phase, for free and with no limit in number, to free slots or just to get it out of the way. You don't retire an Entity that entered the field on the same turn, nor a **tapped**, **in-stasis** or **covered** one (§6.2). **It is not a death** (§6.2).
- **Dying / being destroyed** — going from the field to the Abyss, for a lost battle or a destruction effect. A **retired** Entity (§6.2) **does not die**: it leaves the field and goes to the Retire Zone without triggering death effects.
- **Counterattack +N** — statistic of some Entities: when they block they may add +N to their Power; if they thus exceed the attacker, it dies; on an equal total both die (§6.3). Whoever counterattacks is covered.
- **Tapped** — the state of an Entity that has attacked or blocked: it can neither attack, nor block, nor be **retired** (§6.2), but **keeps enabling its Matters** (§7); it untaps at the start of its owner's next turn.
- **Covered** — the state of an Entity that has counterattacked: it can do nothing, it is untouchable by any effect or Matter, even the opponent's (no Objects and no Retire; the Objects already assigned stay with it) and doesn't enable its Matters, for a full round; then it is uncovered.
- **Front ready** — the declaration with which the active player announces that they attack or pass.
- **Nexus** — the second face of the Rubyfront card, its evolution: it is played by flipping the Rubyfront on the field (requirements on the card), it recovers HP, it stays on the field forever. Destroying it (HP at 0) makes its owner lose.
