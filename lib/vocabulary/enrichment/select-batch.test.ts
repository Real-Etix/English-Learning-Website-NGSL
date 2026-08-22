import { describe, expect, test } from "vitest";

import type { VocabularyRecord } from "../schema";
import { vocabularyRecordFixture } from "../test-fixtures";
import { selectEnrichmentBatch } from "./select-batch";

function recordFor(lemma: string, options: Partial<VocabularyRecord> = {}): VocabularyRecord {
  return {
    ...vocabularyRecordFixture(),
    lemma,
    display: lemma,
    status: "seeded",
    publicationStatus: "published",
    lists: [],
    connections: [],
    ...options,
  };
}

describe("selectEnrichmentBatch", () => {
  test("orders overlapping lists deterministically and leaves supported hidden advanced drafts last", () => {
    const records = [
      recordFor("ngsl-low-sfi", { lists: [{ id: "ngsl", rank: 1, sfi: 61 }] }),
      recordFor("academic-only", { lists: [{ id: "academic", rank: 2, sfi: null }] }),
      recordFor("business-only", { lists: [{ id: "business", rank: 3, sfi: null }] }),
      recordFor("toeic-only", { lists: [{ id: "toeic", rank: 4, sfi: null }] }),
      recordFor("fitness-only", { lists: [{ id: "fitness", rank: 5, sfi: null }] }),
      recordFor("ngsl-high-sfi", {
        lists: [{ id: "ngsl", rank: 9, sfi: 88 }, { id: "academic", rank: 1, sfi: null }],
      }),
      recordFor("advanced-supported", {
        tier: "advanced",
        publicationStatus: "hidden",
        connections: [{
          target: "ngsl-high-sfi",
          type: "advanced_form",
          gloss: "An explained advanced form for this core word.",
          sources: [],
          status: "published",
        }],
      }),
      recordFor("already-satisfied", {
        status: "verified",
        lists: [{ id: "ngsl", rank: 1, sfi: 99 }],
      }),
    ];

    expect(selectEnrichmentBatch(records, { limit: 7 }).map((word) => word.lemma)).toEqual([
      "ngsl-high-sfi", "ngsl-low-sfi", "academic-only", "business-only",
      "toeic-only", "fitness-only", "advanced-supported",
    ]);
  });

  test("uses rank then lemma for ties, places null values last, and deduplicates normalized lemmas", () => {
    const records = [
      recordFor("  repeated  ", { lists: [{ id: "academic", rank: 1, sfi: null }] }),
      recordFor("repeated", { lists: [{ id: "ngsl", rank: 1, sfi: 70 }] }),
      recordFor("ngsl-rank-first", { lists: [{ id: "ngsl", rank: 1, sfi: 60 }] }),
      recordFor("ngsl-rank-second", { lists: [{ id: "ngsl", rank: 2, sfi: 60 }] }),
      recordFor("ngsl-null-sfi", { lists: [{ id: "ngsl", rank: 1, sfi: null }] }),
      recordFor("academic-alpha", { lists: [{ id: "academic", rank: 2, sfi: null }] }),
      recordFor("academic-zulu", { lists: [{ id: "academic", rank: 2, sfi: null }] }),
      recordFor("academic-null-rank", { lists: [{ id: "academic", rank: null, sfi: null }] }),
    ];

    expect(selectEnrichmentBatch(records, { limit: 20 }).map((word) => word.lemma)).toEqual([
      "repeated",
      "ngsl-rank-first",
      "ngsl-rank-second",
      "ngsl-null-sfi",
      "academic-alpha",
      "academic-zulu",
      "academic-null-rank",
    ]);
  });

  test("orders hidden advanced drafts by published core anchors and supports one named stage", () => {
    const records = [
      recordFor("core-a", { lists: [{ id: "ngsl", rank: 1, sfi: 80 }] }),
      recordFor("core-b", { lists: [{ id: "academic", rank: 1, sfi: null }] }),
      recordFor("advanced-two-anchors", {
        tier: "advanced",
        publicationStatus: "hidden",
        connections: [
          { target: "core-a", type: "advanced_form", gloss: "Explained link.", sources: [], status: "published" },
          { target: "core-b", type: "advanced_form", gloss: "Explained link.", sources: [], status: "published" },
        ],
      }),
      recordFor("advanced-one-anchor", {
        tier: "advanced",
        publicationStatus: "hidden",
        connections: [{ target: "core-a", type: "advanced_form", gloss: "Explained link.", sources: [], status: "published" }],
      }),
      recordFor("advanced-hidden", { tier: "advanced", publicationStatus: "hidden" }),
    ];

    expect(selectEnrichmentBatch(records, { stage: "advanced", limit: 10 }).map((word) => word.lemma)).toEqual([
      "advanced-two-anchors", "advanced-one-anchor", "advanced-hidden",
    ]);
    expect(selectEnrichmentBatch(records, { stage: "academic", limit: 10 }).map((word) => word.lemma)).toEqual([
      "core-b",
    ]);
  });
});
