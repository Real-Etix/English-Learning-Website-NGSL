import { wordXp } from "../../lib/collection/xp";
import type { WordRarity } from "../../lib/collection/service";

import type { WordLearningResponse } from "./word-learning-response";

type WordResponseWithRarity = {
  page: Pick<WordLearningResponse["page"], "lemma" | "tier" | "sfi">;
  rarity: WordRarity | null;
};

export type WordLearningDrawerMetadata = {
  rarity: { word: string; dot: string; text: string };
  xp: number | null;
};

const UNAVAILABLE_RARITY = { word: "Rarity unavailable", dot: "#6B7789", text: "" };

export function getWordLearningDrawerMetadata(
  lemma: string,
  response: WordResponseWithRarity | null | undefined,
): WordLearningDrawerMetadata {
  const currentResponse = response?.page.lemma === lemma ? response : null;
  if (!currentResponse) return { rarity: UNAVAILABLE_RARITY, xp: null };

  const { page } = currentResponse;
  const percent = currentResponse.rarity?.percent;
  const rarity = percent === undefined
    ? UNAVAILABLE_RARITY
    : percent <= 12
      ? { word: "Rare", dot: "#F2D9A0", text: `${percent}% of explorers hold it` }
      : percent <= 40
        ? { word: "Uncommon", dot: "#BFD9F2", text: `${percent}% of explorers hold it` }
        : { word: "Common", dot: "#94A0B4", text: `${percent}% of explorers hold it` };

  return { rarity, xp: wordXp({ tier: page.tier, sfi: page.sfi }) };
}
