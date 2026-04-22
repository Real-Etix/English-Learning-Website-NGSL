import importedCatalog from "@/data/generated/word-lists.json";
import generatedEnrichments from "@/data/generated/enrichments.json";
import { defaultEnrichment, manualWordEnrichments } from "@/data/seed-enrichments";
import { fallbackCatalog } from "@/data/seed-word-lists";
import { sourceCredits } from "@/lib/content/source-credits";
import type {
  GeneratedEnrichmentLibrary,
  ImportedCatalog,
  ImportedListData,
  LearningListSlug,
  LearningWord,
  WordListData,
} from "@/lib/types";

interface EnrichedCatalog {
  generatedAt: string;
  lists: WordListData[];
}

function getGeneratedEnrichmentLibrary() {
  return generatedEnrichments as GeneratedEnrichmentLibrary;
}

function isStudyReadyWord(word: LearningWord) {
  const blockedPartsOfSpeech = [
    "article",
    "conjunction",
    "determiner",
    "interjection",
    "particle",
    "preposition",
    "pronoun",
  ];

  const normalizedPartOfSpeech = word.partOfSpeech.toLowerCase();
  const blocked = blockedPartsOfSpeech.some((part) => normalizedPartOfSpeech.includes(part));

  return !blocked && (word.exampleSentences.length > 0 || word.relatedPhrases.length > 0);
}

function resolveEnrichment(word: ImportedListData["words"][number]) {
  const generated = getGeneratedEnrichmentLibrary().items[word.normalizedLemma];
  const manual = manualWordEnrichments[word.normalizedLemma];

  if (manual && generated) {
    return {
      ...generated,
      ...manual,
      sourceCredits: [sourceCredits.manual, ...generated.sourceCredits],
      contentStatus: "manual_override" as const,
    };
  }

  if (manual) {
    return {
      ...manual,
      sourceCredits: [sourceCredits.manual],
      contentStatus: "manual_override" as const,
    };
  }

  return generated ?? defaultEnrichment(word.lemma);
}

function withEnrichment(list: ImportedListData): WordListData {
  return {
    ...list,
    words: list.words.map((word) => ({
      listSlug: list.slug,
      ...word,
      ...resolveEnrichment(word),
    })),
  };
}

function getCatalog(): EnrichedCatalog {
  const loaded =
    importedCatalog && Array.isArray(importedCatalog.lists) && importedCatalog.lists.length > 0
      ? (importedCatalog as ImportedCatalog)
      : fallbackCatalog;

  return {
    ...loaded,
    lists: loaded.lists.map(withEnrichment),
  };
}

export function getAllLists() {
  return getCatalog().lists;
}

export function getListBySlug(slug: LearningListSlug) {
  return getAllLists().find((list) => list.slug === slug) ?? null;
}

export function getFeaturedLists() {
  return getAllLists().map((list) => ({
    ...list,
    featuredWords: [...list.words]
      .sort((left, right) => {
        if (left.contentStatus === right.contentStatus) {
          return (left.rank ?? 0) - (right.rank ?? 0);
        }

        if (left.contentStatus === "fallback") {
          return 1;
        }

        if (right.contentStatus === "fallback") {
          return -1;
        }

        return 0;
      })
      .slice(0, 4),
  }));
}

export function getWordByLemma(lemma: string) {
  const normalized = lemma.toLowerCase();

  for (const list of getAllLists()) {
    const word = list.words.find((entry) => entry.normalizedLemma === normalized);
    if (word) {
      return {
        list,
        word,
      };
    }
  }

  return null;
}

export function getWordsForList(slug: LearningListSlug, limit = 12) {
  return getListBySlug(slug)?.words.slice(0, limit) ?? [];
}

export function getPracticeWord(
  slug: LearningListSlug,
  index: number,
): LearningWord | null {
  const words = getListBySlug(slug)?.words ?? [];

  if (words.length === 0) {
    return null;
  }

  return words[index % words.length] ?? null;
}

export function getCatalogWordsForList(slug: LearningListSlug, limit = 24) {
  const list = getListBySlug(slug);
  if (!list) {
    return [];
  }

  const sortedWords = [...list.words]
    .sort((left, right) => {
      if (left.contentStatus === right.contentStatus) {
        return (left.rank ?? 0) - (right.rank ?? 0);
      }

      if (left.contentStatus === "fallback") {
        return 1;
      }

      if (right.contentStatus === "fallback") {
        return -1;
      }

      return 0;
    });

  const preferred = sortedWords.filter(isStudyReadyWord);
  const fallback = sortedWords.filter((word) => !preferred.includes(word));

  return [...preferred, ...fallback].slice(0, limit);
}

export function getSourceBackedCount(slug: LearningListSlug) {
  return (
    getListBySlug(slug)?.words.filter((word) => word.contentStatus !== "fallback").length ??
    0
  );
}

export function getPracticeWordsForList(slug: LearningListSlug, limit = 10) {
  return getCatalogWordsForList(slug, limit);
}
