import { defineCard } from "../../../core/domain.js";
import en from "./locales/en.js";
import it from "./locales/it.js";

const card = defineCard({
  schemaVersion: 1,
  id: "RBF-001",
  setId: "rubyfront-core",
  collectorNumber: "001",
  slug: "rubyfront-of-the-abyss",
  type: "rubyfront",
  layout: "double-faced",
  status: "draft",
  deckLimit: 1,
  defaultLocale: "it",
  tags: ["rubyfront", "union", "control", "destructive", "zero"],
  rulesReference: "MANUALE.md §3.1, §7, §8.1",
  source: {
    module: import.meta.url,
    designNotes: "./card.md"
  },
  locales: { it, en },
  faces: [
    {
      id: "rubyfront",
      kind: "rubyfront",
      displayKey: "faceA",
      stats: {
        health: 18,
        deploymentCost: { base: 3, increment: 1, cap: 20 }
      },
      enablesMatters: [
        { type: "destructive", maxGrade: 2 }
      ],
      keywords: [
        {
          id: "fury",
          check: { die: "d20", successAtLeast: 12 },
          failure: { loseHealth: 3 }
        }
      ],
      requirements: {
        union: {
          operator: "all",
          conditions: [
            { type: "hand_size", equals: 0 },
            {
              type: "reveal_card",
              zone: "owner_deck",
              position: "bottom",
              keepInZone: true,
              filter: {
                cardType: "entity",
                race: "human",
                enablesMatter: { type: "zero" }
              }
            }
          ]
        }
      },
      triggers: [
        {
          id: "undertow",
          displayKey: "effect",
          event: "on_deploy_from_recall",
          effect: {
            type: "look_and_optionally_move",
            owner: "controller",
            from: { zone: "deck", position: "top", count: 1 },
            to: { zone: "deck", position: "bottom" },
            optional: true
          }
        }
      ],
      actions: [
        {
          id: "abyssal-pressure",
          displayKey: "pressure",
          timing: ["own_preparation", "own_front"],
          repeatable: true,
          checks: ["fury"],
          cost: { health: 2 },
          effect: {
            type: "modify_power",
            target: { controller: "opponent", cardType: "entity", min: 1, max: 1 },
            amount: -2,
            duration: "until_controller_next_turn"
          }
        },
        {
          id: "devour",
          displayKey: "devour",
          timing: ["own_preparation", "own_front"],
          repeatable: true,
          checks: ["fury"],
          cost: { health: 5 },
          effect: {
            type: "move_card",
            target: {
              controller: "opponent",
              cardType: "entity",
              conditions: [{ stat: "power", operator: "lte", value: 3 }],
              min: 1,
              max: 1
            },
            destination: { zone: "owner_deck", position: "bottom" }
          }
        }
      ]
    },
    {
      id: "union",
      kind: "union",
      displayKey: "faceB",
      stats: {
        healthRecovery: 6
      },
      enablesMatters: [
        { type: "destructive", maxGrade: 2 },
        { type: "zero" }
      ],
      keywords: [],
      requirements: {},
      triggers: [
        {
          id: "the-first-wave",
          displayKey: "effect",
          event: "on_flip",
          effect: {
            type: "set_state",
            target: { controller: "opponent", cardType: "entity", min: 1, max: 1 },
            state: "tapped"
          }
        }
      ],
      actions: [
        {
          id: "rising-tide",
          displayKey: "tide",
          timing: ["own_preparation", "own_front"],
          repeatable: true,
          checks: [],
          cost: { health: 3 },
          effect: {
            type: "modify_power",
            target: { controller: "opponent", cardType: "entity", min: 0, max: 2 },
            amount: -2,
            duration: "until_controller_next_turn"
          }
        },
        {
          id: "the-great-tide",
          displayKey: "abyss",
          timing: ["own_preparation", "own_front"],
          repeatable: true,
          checks: [],
          cost: { health: 7 },
          effect: {
            type: "set_state",
            target: { controller: "opponent", cardType: "entity", quantity: "all" },
            state: "tapped"
          }
        }
      ]
    }
  ]
});

export default card;
