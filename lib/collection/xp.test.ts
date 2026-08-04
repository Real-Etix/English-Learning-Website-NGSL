import { describe, expect, it } from "vitest";

import { badgesFor, levelForXp, wordXp, xpForLevel } from "./xp";

describe("wordXp", () => {
  it("common core words are worth the base", () => {
    expect(wordXp({ tier: "core", rank: 100 })).toBe(10);
  });
  it("gives a bonus for less common words", () => {
    expect(wordXp({ tier: "core", rank: 1000 })).toBe(15); // 10 + 5
    expect(wordXp({ tier: "core", rank: 3000 })).toBe(22); // 10 + 12
  });
  it("advanced words (no rank) are worth the most", () => {
    expect(wordXp({ tier: "advanced", rank: null })).toBe(40); // 25 + 15
  });
});

describe("levelForXp / xpForLevel", () => {
  it("starts at level 1 with no XP", () => {
    expect(levelForXp(0)).toBe(1);
  });
  it("reaches level 2 at 50 XP", () => {
    expect(levelForXp(50)).toBe(2);
  });
  it("is monotonic", () => {
    expect(levelForXp(1000)).toBeGreaterThan(levelForXp(200));
  });
  it("xpForLevel is the inverse of levelForXp", () => {
    for (const lvl of [2, 3, 5, 8]) {
      expect(levelForXp(xpForLevel(lvl))).toBe(lvl);
    }
  });
});

describe("badgesFor", () => {
  it("earns First Light with one word, not Collector", () => {
    const b = badgesFor({ wordCount: 1, advancedCount: 0, spacesVisited: 0 });
    expect(b.find((x) => x.id === "first-light")?.earned).toBe(true);
    expect(b.find((x) => x.id === "collector")?.earned).toBe(false);
  });
  it("Rare Hunter needs 10 advanced words", () => {
    expect(
      badgesFor({ wordCount: 10, advancedCount: 9, spacesVisited: 0 }).find((x) => x.id === "rare-hunter")
        ?.earned,
    ).toBe(false);
    expect(
      badgesFor({ wordCount: 10, advancedCount: 10, spacesVisited: 0 }).find((x) => x.id === "rare-hunter")
        ?.earned,
    ).toBe(true);
  });
});
