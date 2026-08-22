import { describe, expect, test } from "vitest";

import type { WordDetail } from "../../content/word-detail";
import type { VocabularyRecord } from "../schema";
import { senseIdFor } from "../sense-id";
import { vocabularyRecordFixture } from "../test-fixtures";
import { enrichRecord } from "./enrich-record";

const factualSource = {
  sourceId: "dictionaryapi",
  url: "https://example.com/dictionary/buy",
  retrievedAt: "2026-08-23T00:00:00.000Z",
  contentHash: "sha256:buy-fixture",
};

const factualDetail: WordDetail = {
  ipa: null,
  audioUk: null,
  audioUs: null,
  audioAny: null,
  sourceEntryId: "buy",
  sourceUrl: "https://example.com/dictionary/buy",
  synonyms: [],
  senses: [{
    partOfSpeech: "verb",
    definition: "to get something by paying money for it",
    example: "We bought fruit from the market.",
    sourceSenseId: "buy-verb-1",
  }],
};

const factualSenseId = senseIdFor({
  lemma: "purchase",
  sourceId: "dictionaryapi",
  externalId: "buy-verb-1",
  partOfSpeech: "verb",
  definition: "to get something by paying money for it",
});

function recordFor(lemma: string, options: Partial<VocabularyRecord> = {}): VocabularyRecord {
  return {
    ...vocabularyRecordFixture(),
    lemma,
    display: lemma,
    tier: "advanced",
    status: "seeded",
    publicationStatus: "hidden",
    senses: [],
    connections: [],
    ...options,
  };
}

describe("enrichRecord", () => {
  test("imports factual senses before adding a review-state usage pattern", () => {
    const result = enrichRecord(recordFor("purchase"), {
      detail: factualDetail,
      source: factualSource,
      knownPublicCoreTargets: ["buy"],
    }, {
      usagePatterns: [{
        senseId: factualSenseId,
        pattern: "purchase something from someone",
        explanation: "Use this pattern to name the seller.",
      }],
    });

    expect(result.record.senses).toHaveLength(1);
    expect(result.record.senses[0]).toMatchObject({
      definition: "to get something by paying money for it",
      examples: [{ text: "We bought fruit from the market.", sources: [{ sourceId: "dictionaryapi" }] }],
      usagePatterns: [{
        pattern: "purchase something from someone",
        explanation: "Use this pattern to name the seller.",
        status: "review",
        sources: [{ sourceId: "llm" }],
      }],
    });
    expect(result.record.publicationStatus).toBe("hidden");
    expect(result.reviewProposalCount).toBe(1);
  });

  test("rejects unknown targets and duplicate guidance without changing the record", () => {
    const imported = enrichRecord(recordFor("purchase"), {
      detail: factualDetail,
      source: factualSource,
      knownPublicCoreTargets: ["buy"],
    }, {
      connections: [{ target: "unlisted", type: "builds_on", gloss: "Not in the public vocabulary." }],
    });
    const firstGuidance = enrichRecord(imported.record, {
      detail: factualDetail,
      source: factualSource,
      knownPublicCoreTargets: ["buy"],
    }, {
      usagePatterns: [{
        senseId: imported.record.senses[0]!.id,
        pattern: "purchase something from someone",
        explanation: "Use this pattern to name the seller.",
      }],
    });
    const duplicate = enrichRecord(firstGuidance.record, {
      detail: factualDetail,
      source: factualSource,
      knownPublicCoreTargets: ["buy"],
    }, {
      usagePatterns: [{
        senseId: firstGuidance.record.senses[0]!.id,
        pattern: "purchase something from someone",
        explanation: "Use this pattern to name the seller.",
      }],
    });

    expect(imported.rejections).toContain("unknown target: unlisted");
    expect(duplicate.rejections).toContain("duplicate usage pattern");
  });

  test("does not duplicate imported factual senses", () => {
    const first = enrichRecord(recordFor("purchase"), {
      detail: factualDetail,
      source: factualSource,
      knownPublicCoreTargets: ["buy"],
    }, {});
    const repeated = enrichRecord(first.record, {
      detail: factualDetail,
      source: factualSource,
      knownPublicCoreTargets: ["buy"],
    }, {});

    expect(repeated.record.senses).toHaveLength(1);
    expect(repeated.factualImportCount).toBe(0);
  });

  test("keeps a hidden advanced record hidden without factual sense, example, and explained core anchor", () => {
    const result = enrichRecord(recordFor("purchase"), {
      detail: { ...factualDetail, senses: [{ ...factualDetail.senses[0]!, example: null }] },
      source: factualSource,
      knownPublicCoreTargets: ["buy"],
    }, {
      connections: [{ target: "buy", type: "builds_on", gloss: "Builds on the common verb buy." }],
    });

    expect(result.record.publicationStatus).toBe("hidden");
    expect(result.reviewable).toBe(false);
  });

  test("moves an advanced record to review only after sourced facts and an explained core anchor", () => {
    const result = enrichRecord(recordFor("purchase"), {
      detail: factualDetail,
      source: factualSource,
      knownPublicCoreTargets: ["buy"],
    }, {
      connections: [{ target: "buy", type: "builds_on", gloss: "Builds on the common verb buy." }],
    });

    expect(result.record.publicationStatus).toBe("review");
    expect(result.reviewable).toBe(true);
    expect(result.record.connections[0]).toMatchObject({ status: "unreviewed", sources: [{ sourceId: "llm" }] });
  });

  test("requires trusted approval metadata before publishing an advanced record", () => {
    const unapproved = enrichRecord(recordFor("purchase"), {
      detail: factualDetail,
      source: factualSource,
      knownPublicCoreTargets: ["buy"],
    }, {
      connections: [{ target: "buy", type: "builds_on", gloss: "Builds on the common verb buy." }],
    });
    const approved = enrichRecord(unapproved.record, {
      detail: factualDetail,
      source: factualSource,
      knownPublicCoreTargets: ["buy"],
      approval: { pullRequest: 42, approvedBy: "maintainer", approvedAt: "2026-08-23T00:00:00.000Z" },
    }, {});

    expect(unapproved.record.publicationStatus).toBe("review");
    expect(approved.record.publicationStatus).toBe("published");
  });
});
