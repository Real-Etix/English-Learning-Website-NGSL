import { describe, expect, it } from "vitest";

import type { VocabularyRecord } from "../vocabulary/schema";
import { vocabularyRecordFixture } from "../vocabulary/test-fixtures";
import { auditDictionaryRecords, hasStrictFailures } from "./dictionary-quality";

const fixture = vocabularyRecordFixture();
const source = fixture.sources[0]!;

function record(overrides: Partial<VocabularyRecord> = {}): VocabularyRecord {
  return {
    ...fixture,
    lemma: "anchor",
    display: "anchor",
    tier: "core",
    partOfSpeech: "noun",
    lists: [{ id: "ngsl", rank: 1, sfi: 70 }],
    status: "seeded",
    sources: [{ ...source, sourceId: "wordnet" }],
    senses: [{
      ...fixture.senses[0]!,
      partOfSpeech: "noun",
      definition: "A fixed point used for support.",
      examples: [{ text: "The boat dropped its anchor.", sources: [source] }],
    }],
    connections: [{
      ...fixture.connections[0]!,
      target: "support",
      type: "synonym",
      gloss: "a related support idea",
    }],
    ...overrides,
  };
}

function sense(overrides: Partial<VocabularyRecord["senses"][number]> = {}) {
  return { ...record().senses[0]!, ...overrides };
}

function connection(overrides: Partial<VocabularyRecord["connections"][number]> = {}) {
  return { ...record().connections[0]!, ...overrides };
}

describe("auditDictionaryRecords", () => {
  it("counts global and per-list dictionary quality from primary canonical senses", () => {
    const report = auditDictionaryRecords([
      record(),
      record({
        lemma: "draft",
        tier: "advanced",
        lists: [{ id: "ngsl", rank: 1, sfi: 70 }, { id: "academic", rank: 1, sfi: 70 }],
        sources: [{ ...source, sourceId: "llm" }],
        senses: [sense({
          sources: [{ ...source, sourceId: "llm" }],
          partOfSpeech: "unknown",
          definition: "Definition pending — needs review.",
          examples: [],
        })],
        connections: [connection({ type: "builds_on", target: "anchor", gloss: null }), connection({ target: "support", gloss: " " })],
      }),
      record({
        lemma: "isolated",
        lists: [{ id: "academic", rank: 1, sfi: 70 }],
        status: "verified",
        sources: [],
        senses: [sense({ sources: [], examples: [] })],
        connections: [],
      }),
      record({
        lemma: "draft-core",
        lists: [],
        sources: [{ ...source, sourceId: "llm" }],
        senses: [sense({ sources: [{ ...source, sourceId: "llm" }], partOfSpeech: "  " })],
        connections: [connection({ type: "antonym", target: "support", gloss: null })],
      }),
    ]);

    expect(report.total).toEqual({
      pages: 4, placeholders: 1, noExamples: 2, unknownPartOfSpeech: 2, llmOnlyAdvanced: 1, zeroConnections: 1,
      evidence: { verified: 1, sourceBacked: 1, aiDraft: 2 },
      edges: { total: 4, published: 4, unreviewed: 0, hidden: 0, explained: 1, unexplained: 3, explainedByStatus: { published: 1, unreviewed: 0, hidden: 0 }, byType: { antonym: { total: 1, published: 1, unreviewed: 0, hidden: 0, explained: 0, unexplained: 1, explainedByStatus: { published: 0, unreviewed: 0, hidden: 0 } }, builds_on: { total: 1, published: 1, unreviewed: 0, hidden: 0, explained: 0, unexplained: 1, explainedByStatus: { published: 0, unreviewed: 0, hidden: 0 } }, synonym: { total: 2, published: 2, unreviewed: 0, hidden: 0, explained: 1, unexplained: 1, explainedByStatus: { published: 1, unreviewed: 0, hidden: 0 } } } },
    });
    expect(report.lists).toEqual({
      academic: {
        pages: 2, placeholders: 1, noExamples: 2, unknownPartOfSpeech: 1, llmOnlyAdvanced: 1, zeroConnections: 1,
        evidence: { verified: 1, sourceBacked: 0, aiDraft: 1 },
        edges: { total: 2, published: 2, unreviewed: 0, hidden: 0, explained: 0, unexplained: 2, explainedByStatus: { published: 0, unreviewed: 0, hidden: 0 }, byType: { builds_on: { total: 1, published: 1, unreviewed: 0, hidden: 0, explained: 0, unexplained: 1, explainedByStatus: { published: 0, unreviewed: 0, hidden: 0 } }, synonym: { total: 1, published: 1, unreviewed: 0, hidden: 0, explained: 0, unexplained: 1, explainedByStatus: { published: 0, unreviewed: 0, hidden: 0 } } } },
      },
      ngsl: {
        pages: 2, placeholders: 1, noExamples: 1, unknownPartOfSpeech: 1, llmOnlyAdvanced: 1, zeroConnections: 0,
        evidence: { verified: 0, sourceBacked: 1, aiDraft: 1 },
        edges: { total: 3, published: 3, unreviewed: 0, hidden: 0, explained: 1, unexplained: 2, explainedByStatus: { published: 1, unreviewed: 0, hidden: 0 }, byType: { builds_on: { total: 1, published: 1, unreviewed: 0, hidden: 0, explained: 0, unexplained: 1, explainedByStatus: { published: 0, unreviewed: 0, hidden: 0 } }, synonym: { total: 2, published: 2, unreviewed: 0, hidden: 0, explained: 1, unexplained: 1, explainedByStatus: { published: 1, unreviewed: 0, hidden: 0 } } } },
      },
    });
  });

  it("counts a record and its edges once per distinct list ID", () => {
    const report = auditDictionaryRecords([record({
      lists: [{ id: "ngsl", rank: 1, sfi: 70 }, { id: "ngsl", rank: 1, sfi: 70 }, { id: "academic", rank: 1, sfi: 70 }, { id: "academic", rank: 1, sfi: 70 }],
      connections: [connection({ gloss: null })],
    })]);

    for (const list of ["ngsl", "academic"]) {
      expect(report.lists[list]).toMatchObject({ pages: 1, edges: { total: 1, published: 1, unreviewed: 0, hidden: 0, explained: 0, unexplained: 1, byType: { synonym: { total: 1, published: 1, unreviewed: 0, hidden: 0, explained: 0, unexplained: 1 } } } });
    }
  });

  it("keeps reserved list IDs and edge types out of Object.prototype", () => {
    const report = auditDictionaryRecords([record({
      lists: [{ id: "__proto__", rank: 1, sfi: 70 }],
      connections: [connection({ type: "__proto__" as "synonym", gloss: "a reserved-key edge" })],
    })]);

    expect(report.total.edges.byType["__proto__"]).toEqual({ total: 1, published: 1, unreviewed: 0, hidden: 0, explained: 1, unexplained: 0, explainedByStatus: { published: 1, unreviewed: 0, hidden: 0 } });
    expect(report.lists["__proto__"].edges.byType["__proto__"]).toEqual({ total: 1, published: 1, unreviewed: 0, hidden: 0, explained: 1, unexplained: 0, explainedByStatus: { published: 1, unreviewed: 0, hidden: 0 } });
  });

  it("reports strict failures for learner-facing connections without authored glosses, but not editorial debt", () => {
    expect(hasStrictFailures(auditDictionaryRecords([record({ senses: [sense({ examples: [] })], connections: [] })]))).toBe(false);
    expect(hasStrictFailures(auditDictionaryRecords([record({ senses: [sense({ definition: "Needs a fuller dictionary source." })] })]))).toBe(true);
    expect(hasStrictFailures(auditDictionaryRecords([record({ tier: "advanced", sources: [{ ...source, sourceId: "llm" }] })]))).toBe(true);
    expect(hasStrictFailures(auditDictionaryRecords([record({ tier: "advanced", sources: [] })]))).toBe(false);
    expect(hasStrictFailures(auditDictionaryRecords([record({ tier: "advanced", sources: [{ ...source, sourceId: "llm" }, { ...source, sourceId: "wordnet" }] })]))).toBe(false);
    expect(hasStrictFailures(auditDictionaryRecords([record({ connections: [connection({ status: "published", gloss: null })] })]))).toBe(true);
    expect(hasStrictFailures(auditDictionaryRecords([record({ connections: [connection({ status: "unreviewed", gloss: null }), connection({ status: "hidden", gloss: null })] })]))).toBe(false);
  });

  it("does not let explained unreviewed or hidden edges mask an unexplained published edge", () => {
    const report = auditDictionaryRecords([record({
      connections: [
        connection({ status: "published", gloss: null }),
        connection({ status: "unreviewed", gloss: "editorial wording" }),
        connection({ status: "hidden", gloss: "hidden wording" }),
      ],
    })]);

    expect(report.total.edges.byType.synonym).toMatchObject({
      published: 1,
      unreviewed: 1,
      hidden: 1,
      explainedByStatus: { published: 0, unreviewed: 1, hidden: 1 },
    });
    expect(hasStrictFailures(report)).toBe(true);
  });

  it("does not classify a verified LLM-only record as verified evidence", () => {
    const report = auditDictionaryRecords([record({
      status: "verified",
      sources: [{ ...source, sourceId: "llm" }],
      senses: [sense({ sources: [{ ...source, sourceId: "llm" }] })],
    })]);

    expect(report.total.evidence).toEqual({ verified: 0, sourceBacked: 0, aiDraft: 1 });
  });

  it("scopes primary evidence to the primary sense in a mixed-source record", () => {
    const llmSource = { ...source, sourceId: "llm" };
    const dictionarySource = { ...source, sourceId: "dictionaryapi" };
    const report = auditDictionaryRecords([record({
      status: "verified",
      sources: [llmSource, dictionarySource],
      senses: [
        sense({ id: "mixed-llm-primary", sources: [llmSource] }),
        sense({ id: "mixed-dictionary-import", sources: [dictionarySource], status: "review" }),
      ],
    })]);

    expect(report.total.evidence).toEqual({ verified: 0, sourceBacked: 0, aiDraft: 1 });
  });

  it("does not use unrelated record sources for an unsourced primary sense", () => {
    const llmSource = { ...source, sourceId: "llm" };
    const dictionarySource = { ...source, sourceId: "dictionaryapi" };
    const report = auditDictionaryRecords([record({
      status: "verified",
      sources: [llmSource, dictionarySource],
      senses: [
        sense({ sources: [] }),
        sense({ id: "mixed-dictionary-import", sources: [dictionarySource], status: "review" }),
      ],
    })]);

    expect(report.total.evidence).toEqual({ verified: 0, sourceBacked: 0, aiDraft: 1 });
  });
});
