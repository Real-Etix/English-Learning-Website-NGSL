import { describe, expect, it } from "vitest";

import { getWordLearningDrawerMetadata } from "./word-learning-drawer-metadata";

const anchorResponse = {
  page: { lemma: "anchor", tier: "core" as const, sfi: 70 },
  rarity: { owners: 1, explorers: 4, percent: 25 },
};

describe("getWordLearningDrawerMetadata", () => {
  it("does not reuse a previous word's rarity or XP while another word is loading", () => {
    expect(getWordLearningDrawerMetadata("harbor", anchorResponse)).toEqual({
      rarity: { word: "Rarity unavailable", dot: "#6B7789", text: "" },
      xp: null,
    });
  });

  it("keeps current-word XP while stating when its rarity is unavailable", () => {
    expect(getWordLearningDrawerMetadata("anchor", { ...anchorResponse, rarity: null })).toEqual({
      rarity: { word: "Rarity unavailable", dot: "#6B7789", text: "" },
      xp: 10,
    });
  });

  it("preserves ready-state rarity and XP for the current word", () => {
    expect(getWordLearningDrawerMetadata("anchor", anchorResponse)).toEqual({
      rarity: { word: "Uncommon", dot: "#BFD9F2", text: "25% of explorers hold it" },
      xp: 10,
    });
  });
});
