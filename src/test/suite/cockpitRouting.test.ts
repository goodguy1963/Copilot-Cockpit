import * as assert from "assert";
import { listCockpitRoutingCards } from "../../cockpitRouting";
import type { CockpitBoard } from "../../types";

suite("Cockpit Routing Tests", () => {
  function createBoard(): CockpitBoard {
    return {
      version: 4,
      sections: [
        {
          id: "unsorted",
          title: "Unsorted",
          order: 0,
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      cards: [
        {
          id: "card-legacy",
          title: "Legacy",
          sectionId: "unsorted",
          order: 0,
          priority: "none",
          status: "active",
          labels: ["GO"],
          flags: [],
          comments: [
            {
              id: "comment-1",
              author: "user",
              body: "Please route this.",
              labels: ["needs-bot-review"],
              source: "human-form",
              sequence: 1,
              createdAt: "2026-04-05T00:00:00.000Z",
            },
          ],
          archived: false,
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:00:00.000Z",
        },
        {
          id: "card-canonical",
          title: "Canonical",
          sectionId: "unsorted",
          order: 1,
          priority: "none",
          status: "active",
          labels: [],
          flags: ["ready"],
          comments: [],
          archived: false,
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      labelCatalog: [],
      deletedLabelCatalogKeys: [],
      flagCatalog: [],
      deletedFlagCatalogKeys: [],
      disabledSystemFlagKeys: [],
      deletedCardIds: [],
      filters: {
        labels: [],
        priorities: [],
        statuses: [],
        archiveOutcomes: [],
        flags: [],
        sortBy: "manual",
        sortDirection: "asc",
        viewMode: "board",
        showArchived: false,
        showRecurringTasks: false,
        hideCardDetails: false,
      },
      updatedAt: "2026-04-05T00:00:00.000Z",
    };
  }

  test("canonical-primary ignores legacy label and comment-label routing", () => {
    const cards = listCockpitRoutingCards(createBoard(), {
      signals: ["ready", "needs-bot-review"],
      deterministicStateMode: "canonical-primary",
    });

    assert.deepStrictEqual(cards.map((card) => card.id), ["card-canonical"]);
    assert.deepStrictEqual(cards[0]?.matchedSignals, ["ready"]);
  });

  test("off mode falls back to legacy routing signals", () => {
    const cards = listCockpitRoutingCards(createBoard(), {
      signals: ["ready", "needs-bot-review"],
      deterministicStateMode: "off",
    });

    assert.deepStrictEqual(cards.map((card) => card.id), ["card-legacy", "card-canonical"]);
    assert.deepStrictEqual(cards[0]?.matchedSignals, ["go", "needs-bot-review"]);
    assert.deepStrictEqual(cards[1]?.matchedSignals, ["go"]);
  });
});