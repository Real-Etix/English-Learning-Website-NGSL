/**
 * Phase 1 reward math — pure functions, no DB. Rarity comes from the wiki itself
 * (tier + frequency rank), so collecting feels rewarding before there's a user base.
 */
export type WordLike = { tier: "core" | "advanced"; sfi: number | null };

/**
 * XP for collecting one word: base by tier + a bonus for rarer words.
 * Banded on SFI (Standard Frequency Index), which is comparable across lists —
 * unlike per-list `rank`. Higher SFI = more common, so the bonus is inverse to it.
 * Advanced words carry no SFI (WordNet expansions), so they get the top bonus.
 * (Corpus SFI runs ~39–88, clustered 53–63; thresholds are ~quartiles.)
 */
export function wordXp(word: WordLike): number {
  const base = word.tier === "advanced" ? 25 : 10;
  let bonus: number;
  if (word.sfi == null) bonus = 15;
  else if (word.sfi >= 59) bonus = 0; // very common
  else if (word.sfi >= 53) bonus = 5; // mid-frequency
  else bonus = 12; // uncommon
  return base + bonus;
}

/** Level from total XP: gentle square-root curve. Level 1 starts at 0 XP. */
export function levelForXp(totalXp: number): number {
  return 1 + Math.floor(Math.sqrt(Math.max(0, totalXp) / 50));
}

/** XP needed to reach the next level (for a progress bar). */
export function xpForLevel(level: number): number {
  return 50 * (level - 1) ** 2;
}

export type CollectionStats = {
  wordCount: number;
  advancedCount: number;
  spacesVisited: number;
};

export type Badge = { id: string; label: string; earned: boolean };

export function badgesFor(stats: CollectionStats): Badge[] {
  return [
    { id: "first-light", label: "First Light", earned: stats.wordCount >= 1 },
    { id: "constellation", label: "Constellation", earned: stats.wordCount >= 25 },
    { id: "collector", label: "Collector", earned: stats.wordCount >= 100 },
    { id: "rare-hunter", label: "Rare Hunter", earned: stats.advancedCount >= 10 },
    { id: "wanderer", label: "Wanderer", earned: stats.spacesVisited >= 5 },
  ];
}
