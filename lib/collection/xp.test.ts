import { describe, expect, it } from "vitest";

import { badgesFor, levelForXp, wordXp, xpForLevel } from "./xp";

describe("wordXp (banded on SFI)", () => {
  it("common core words (high SFI) are worth the base", () => {
    expect(wordXp({ tier: "core", sfi: 84 })).toBe(10);
  });
  it("gives a bonus as words get rarer (lower SFI)", () => {
    expect(wordXp({ tier: "core", sfi: 55 })).toBe(15); // 10 + 5
    expect(wordXp({ tier: "core", sfi: 45 })).toBe(22); // 10 + 12
  });
  it("advanced words (no SFI) are worth the most", () => {
    expect(wordXp({ tier: "advanced", sfi: null })).toBe(40); // 25 + 15
  });
  it("advanced always outscores any core word (guards the advancedCount split)", () => {
    const coreValues = [84, 59, 58, 53, 52, 39, null].map((sfi) => wordXp({ tier: "core", sfi }));
    const advancedMin = wordXp({ tier: "advanced", sfi: null });
    expect(Math.max(...coreValues)).toBeLessThan(advancedMin);
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
