import { defaultEnrichment, manualWordEnrichments } from "@/data/seed-enrichments";
import { sourceCredits } from "@/lib/content/source-credits";
import type { ImportedCatalog, LearningWord, WordListData } from "@/lib/types";
import { allLists } from "@/lib/ngsl/list-catalog";

function createWord(
  listSlug: WordListData["slug"],
  lemma: string,
  rank: number,
  forms: string[],
): LearningWord {
  const enrichment = manualWordEnrichments[lemma]
    ? {
        ...manualWordEnrichments[lemma],
        sourceCredits: [sourceCredits.manual],
        contentStatus: "manual_override" as const,
      }
    : defaultEnrichment(lemma);

  return {
    listSlug,
    lemma,
    normalizedLemma: lemma.toLowerCase(),
    rank,
    band: null,
    sfi: null,
    frequency: null,
    forms,
    ...enrichment,
  };
}

const fallbackLists: WordListData[] = [
  {
    ...allLists.find((list) => list.slug === "ngsl")!,
    wordCount: 4,
    words: [
      createWord("ngsl", "goal", 1, ["goal", "goals"]),
      createWord("ngsl", "change", 2, ["change", "changes", "changed", "changing"]),
      createWord("ngsl", "focus", 3, ["focus", "focuses", "focused", "focusing"]),
      createWord("ngsl", "support", 4, ["support", "supports", "supported", "supporting"]),
    ],
  },
  {
    ...allLists.find((list) => list.slug === "toeic")!,
    wordCount: 4,
    words: [
      createWord("toeic", "client", 1, ["client", "clients"]),
      createWord("toeic", "airport", 2, ["airport", "airports"]),
      createWord("toeic", "schedule", 3, ["schedule", "schedules", "scheduled"]),
      createWord("toeic", "vacation", 4, ["vacation", "vacations"]),
    ],
  },
  {
    ...allLists.find((list) => list.slug === "business")!,
    wordCount: 4,
    words: [
      createWord("business", "budget", 1, ["budget", "budgets"]),
      createWord("business", "client", 2, ["client", "clients"]),
      createWord("business", "portfolio", 3, ["portfolio", "portfolios"]),
      createWord("business", "equity", 4, ["equity", "equities"]),
    ],
  },
  {
    ...allLists.find((list) => list.slug === "academic")!,
    wordCount: 4,
    words: [
      createWord("academic", "analysis", 1, ["analysis", "analyses"]),
      createWord("academic", "method", 2, ["method", "methods"]),
      createWord("academic", "theory", 3, ["theory", "theories"]),
      createWord("academic", "evidence", 4, ["evidence"]),
    ],
  },
  {
    ...allLists.find((list) => list.slug === "fitness")!,
    wordCount: 4,
    words: [
      createWord("fitness", "protein", 1, ["protein", "proteins"]),
      createWord("fitness", "recover", 2, ["recover", "recovers", "recovered", "recovering"]),
      createWord("fitness", "stretch", 3, ["stretch", "stretches", "stretched", "stretching"]),
      createWord("fitness", "balance", 4, ["balance", "balances", "balanced", "balancing"]),
    ],
  },
];

export const fallbackCatalog: ImportedCatalog = {
  generatedAt: new Date().toISOString(),
  lists: fallbackLists,
};
