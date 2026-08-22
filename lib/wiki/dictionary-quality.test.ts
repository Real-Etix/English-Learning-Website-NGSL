import { describe, expect, it } from "vitest";

import type { ContentSourceRef, VocabularyRecord } from "../vocabulary/schema";
import { vocabularyRecordFixture } from "../vocabulary/test-fixtures";
import {
  auditDictionaryRecords,
  hasStrictFailures,
  strictViolationIdentityRegressions,
  strictViolationRegressions,
} from "./dictionary-quality";

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

function providerRef(sourceId: ContentSourceRef["sourceId"]): ContentSourceRef {
  return { ...source, sourceId };
}

function metricRecord(options: {
  lemma: string;
  tier: VocabularyRecord["tier"];
  publicationStatus: VocabularyRecord["publicationStatus"];
  provider: ContentSourceRef["sourceId"];
  listIds?: string[];
  recordStatus?: VocabularyRecord["status"];
  examples?: boolean;
  patterns?: boolean;
  mistakes?: boolean;
  connections?: VocabularyRecord["connections"];
}): VocabularyRecord {
  const sourceRef = providerRef(options.provider);
  return record({
    lemma: options.lemma,
    display: options.lemma,
    tier: options.tier,
    publicationStatus: options.publicationStatus,
    status: options.recordStatus ?? "enriched",
    lists: (options.listIds ?? []).map((id, index) => ({ id, rank: index + 1, sfi: 70 })),
    sources: [sourceRef],
    senses: [{
      ...fixture.senses[0]!,
      id: `${options.lemma}-sense`,
      definition: `A complete definition for ${options.lemma}.`,
      sources: [sourceRef],
      examples: options.examples === false ? [] : [{ text: `An example of ${options.lemma}.`, sources: [sourceRef] }],
      usagePatterns: options.patterns === false ? [] : [{
        pattern: `use ${options.lemma}`,
        explanation: `Use ${options.lemma} in context.`,
        examples: [],
        sources: [sourceRef],
        status: "published",
      }],
      collocations: [],
      commonMistakes: options.mistakes === false ? [] : [{
        incorrect: `wrong ${options.lemma}`,
        correction: options.lemma,
        explanation: `Use ${options.lemma} here.`,
        sources: [sourceRef],
        status: "published",
      }],
      status: "published",
    }],
    connections: options.connections ?? [],
  });
}

describe("auditDictionaryRecords", () => {
  it("reports deterministic Vocabulary v2 metrics globally and per list", () => {
    const publishedCore = metricRecord({
      lemma: "published-core",
      tier: "core",
      publicationStatus: "published",
      provider: "curated",
      listIds: ["ngsl", "ngsl", "__proto__"],
      recordStatus: "verified",
      mistakes: false,
      connections: [connection({ target: "review-core", type: "synonym", gloss: "published guidance" })],
    });
    const draftCore = metricRecord({
      lemma: "draft-core",
      tier: "core",
      publicationStatus: "draft",
      provider: "wordnet",
      listIds: ["academic", "total"],
      examples: false,
      patterns: false,
      mistakes: false,
      connections: [],
    });
    const reviewCore = metricRecord({
      lemma: "review-core",
      tier: "core",
      publicationStatus: "review",
      provider: "dictionaryapi",
      listIds: ["academic", "academic"],
      examples: false,
      connections: [connection({ target: "published-core", type: "antonym", status: "unreviewed", gloss: null })],
    });
    const hiddenAdvanced = metricRecord({
      lemma: "hidden-advanced",
      tier: "advanced",
      publicationStatus: "hidden",
      provider: "llm",
      listIds: ["business"],
      examples: false,
      patterns: false,
      mistakes: false,
      connections: [connection({ target: "missing-target", type: "builds_on", status: "hidden", gloss: null })],
    });
    const reviewAdvanced = metricRecord({
      lemma: "review-advanced",
      tier: "advanced",
      publicationStatus: "review",
      provider: "tatoeba",
      listIds: ["toeic"],
      patterns: false,
      connections: [connection({ target: "published-core", type: "collocation", status: "published", gloss: " " })],
    });
    const publishedAdvanced = metricRecord({
      lemma: "published-advanced",
      tier: "advanced",
      publicationStatus: "published",
      provider: "wordnet",
      listIds: ["fitness"],
      connections: [connection({ target: "published-core", type: "intensity", status: "published", gloss: "published guidance" })],
    });

    const report = auditDictionaryRecords([
      publishedAdvanced,
      hiddenAdvanced,
      reviewCore,
      publishedCore,
      reviewAdvanced,
      draftCore,
    ]);

    expect(report.total.publication).toEqual({ draft: 1, review: 2, published: 2, hidden: 1 });
    expect(report.total.senses).toEqual({ total: 6, unsupported: 1, withoutExamples: 3 });
    expect(report.total.usage).toEqual({ withoutPatterns: 3, withoutMistakes: 3 });
    expect(report.total.connections).toEqual({ published: 3, unreviewed: 1, hidden: 1, unexplained: 3 });
    expect(report.total.advanced).toEqual({ quarantined: 1, reviewable: 1, published: 1 });
    expect(report.total.claimableSenses).toBe(2);
    expect(report.total.sources).toEqual({ curated: 1, wordnet: 2, dictionaryapi: 1, tatoeba: 1, llm: 1 });
    expect(report.total.strict).toEqual({
      publishedPlaceholders: 0,
      publishedUnsupportedSenses: 0,
      claimableSensesWithoutSourcedExamples: 0,
      publishedConnectionsToHiddenOrMissingTargets: 1,
      learnerConnectionsWithoutGloss: 1,
    });

    expect(report.lists.ngsl).toMatchObject({
      pages: 1,
      publication: { draft: 0, review: 0, published: 1, hidden: 0 },
      senses: { total: 1, unsupported: 0, withoutExamples: 0 },
      usage: { withoutPatterns: 0, withoutMistakes: 1 },
      connections: { published: 1, unreviewed: 0, hidden: 0, unexplained: 0 },
      advanced: { quarantined: 0, reviewable: 0, published: 0 },
      claimableSenses: 1,
      sources: { curated: 1, wordnet: 0, dictionaryapi: 0, tatoeba: 0, llm: 0 },
    });
    expect(report.lists["__proto__"]).toMatchObject({ pages: 1, claimableSenses: 1 });
    expect(Object.getPrototypeOf(report.lists)).toBeNull();
    expect(Object.keys(report.lists)).toEqual(["__proto__", "academic", "business", "fitness", "ngsl", "toeic", "total"]);
    expect(Object.keys(report.total.edges.byType)).toEqual(["antonym", "builds_on", "collocation", "intensity", "synonym"]);
    expect(Object.getPrototypeOf(report.total.edges.byType)).toBeNull();
  });

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

    expect(report.total).toMatchObject({
      pages: 4, placeholders: 1, noExamples: 2, unknownPartOfSpeech: 2, llmOnlyAdvanced: 1, zeroConnections: 1,
      evidence: { verified: 1, sourceBacked: 1, aiDraft: 2 },
      edges: { total: 4, published: 4, unreviewed: 0, hidden: 0, explained: 1, unexplained: 3, explainedByStatus: { published: 1, unreviewed: 0, hidden: 0 }, byType: { antonym: { total: 1, published: 1, unreviewed: 0, hidden: 0, explained: 0, unexplained: 1, explainedByStatus: { published: 0, unreviewed: 0, hidden: 0 } }, builds_on: { total: 1, published: 1, unreviewed: 0, hidden: 0, explained: 0, unexplained: 1, explainedByStatus: { published: 0, unreviewed: 0, hidden: 0 } }, synonym: { total: 2, published: 2, unreviewed: 0, hidden: 0, explained: 1, unexplained: 1, explainedByStatus: { published: 1, unreviewed: 0, hidden: 0 } } } },
    });
    expect(report.lists).toMatchObject({
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

  it("reports only published blocking violations as strict failures", () => {
    expect(hasStrictFailures(auditDictionaryRecords([record({ senses: [sense({ examples: [] })], connections: [] })]))).toBe(true);
    expect(hasStrictFailures(auditDictionaryRecords([record({ senses: [sense({ definition: "Needs a fuller dictionary source." })] })]))).toBe(true);
    expect(hasStrictFailures(auditDictionaryRecords([record({
      tier: "advanced",
      sources: [{ ...source, sourceId: "llm" }],
      senses: [sense({ sources: [{ ...source, sourceId: "llm" }] })],
      connections: [],
    })]))).toBe(true);
    expect(hasStrictFailures(auditDictionaryRecords([record({ tier: "advanced", sources: [], connections: [] })]))).toBe(false);
    expect(hasStrictFailures(auditDictionaryRecords([record({
      tier: "advanced",
      sources: [{ ...source, sourceId: "llm" }, { ...source, sourceId: "wordnet" }],
      connections: [],
    })]))).toBe(false);
    expect(hasStrictFailures(auditDictionaryRecords([record({ connections: [connection({ status: "published", gloss: null })] })]))).toBe(true);
    expect(hasStrictFailures(auditDictionaryRecords([record({ connections: [connection({ status: "unreviewed", gloss: null }), connection({ status: "hidden", gloss: null })] })]))).toBe(false);
  });

  it.each(["hidden", "missing"] as const)("blocks a published connection to a %s target", (targetState) => {
    const target = targetState === "hidden"
      ? record({ lemma: "hidden-target", publicationStatus: "hidden" })
      : null;
    const sourceRecord = record({
      lemma: "source-record",
      connections: [connection({ target: target?.lemma ?? "missing-target", status: "published", gloss: "explained" })],
    });

    expect(hasStrictFailures(auditDictionaryRecords(target ? [sourceRecord, target] : [sourceRecord]))).toBe(true);
  });

  it("does not make hidden or unreviewed connection debt strict", () => {
    const target = record({ lemma: "public-target", connections: [] });
    const sourceRecord = record({
      lemma: "editorial-debt",
      connections: [
        connection({ target: "missing-target", status: "hidden", gloss: null }),
        connection({ target: "missing-target", status: "unreviewed", gloss: null }),
      ],
    });

    expect(hasStrictFailures(auditDictionaryRecords([sourceRecord, target]))).toBe(false);
  });

  it("reports strict-count increases against a base audit manifest", () => {
    const base = auditDictionaryRecords([record({ connections: [] })]);
    const current = auditDictionaryRecords([record({
      connections: [connection({ target: "anchor", status: "published", gloss: null })],
    })]);

    expect(strictViolationRegressions(current.total.strict, base.total.strict)).toEqual([
      "learnerConnectionsWithoutGloss increased from 0 to 1",
    ]);
  });

  it("rejects a new strict violation identity when the category count stays flat", () => {
    const base = auditDictionaryRecords([record({
      lemma: "base-placeholder",
      connections: [],
      senses: [sense({ definition: "Definition pending." })],
    })]);
    const current = auditDictionaryRecords([record({
      lemma: "current-placeholder",
      connections: [],
      senses: [sense({ definition: "Definition pending." })],
    })]);

    expect(strictViolationRegressions(current.total.strict, base.total.strict)).toEqual([]);
    expect(strictViolationIdentityRegressions(current.strictViolations, base.strictViolations)).toEqual([
      expect.stringContaining("current-placeholder"),
    ]);
  });

  it("sorts strict violation identities independently of record and edge input order", () => {
    const target = record({ lemma: "visible-target", connections: [] });
    const alpha = record({
      lemma: "alpha",
      connections: [
        connection({ target: "visible-target", type: "synonym", status: "published", gloss: null }),
        connection({ target: "missing-target", type: "antonym", status: "published", gloss: "explained" }),
      ],
    });
    const zeta = record({
      lemma: "zeta",
      connections: [],
      senses: [sense({ definition: "Needs a fuller dictionary source." })],
    });

    const first = auditDictionaryRecords([zeta, alpha, target]).strictViolations;
    const second = auditDictionaryRecords([target, {
      ...alpha,
      connections: [...alpha.connections].reverse(),
    }, zeta]).strictViolations;

    expect(first).toEqual([...first].sort());
    expect(second).toEqual(first);
  });

  it("counts distinct published edges while using one semantic strict identity", () => {
    const report = auditDictionaryRecords([record({
      connections: [
        connection({ target: "missing-target", type: "synonym", status: "published", gloss: "explained" }),
        connection({ target: "missing-target", type: "synonym", status: "published", gloss: "also explained" }),
      ],
    })]);

    expect(report.total.strict.publishedConnectionsToHiddenOrMissingTargets).toBe(2);
    expect(report.strictViolations.filter((identity) => identity.startsWith("published-connection-hidden-or-missing-target:"))).toEqual([
      "published-connection-hidden-or-missing-target:[\"anchor\",\"synonym\",\"missing-target\"]",
    ]);
  });

  it("keeps an inherited unexplained edge identity stable when a glossed duplicate is inserted", () => {
    const target = record({ lemma: "visible-target", connections: [] });
    const inherited = connection({ target: target.lemma, type: "synonym", status: "published", gloss: null });
    const base = auditDictionaryRecords([record({ connections: [inherited] }), target]);
    const current = auditDictionaryRecords([record({
      connections: [
        connection({ target: target.lemma, type: "synonym", status: "published", gloss: "explained duplicate" }),
        inherited,
      ],
    }), target]);

    expect(strictViolationRegressions(current.total.strict, base.total.strict)).toEqual([]);
    expect(strictViolationIdentityRegressions(current.strictViolations, base.strictViolations)).toEqual([]);
  });

  it("counts a new unexplained duplicate even when its strict identity already exists", () => {
    const target = record({ lemma: "visible-target", connections: [] });
    const inherited = connection({ target: target.lemma, type: "synonym", status: "published", gloss: null });
    const base = auditDictionaryRecords([record({ connections: [inherited] }), target]);
    const current = auditDictionaryRecords([record({ connections: [inherited, inherited] }), target]);

    expect(strictViolationRegressions(current.total.strict, base.total.strict)).toEqual([
      "learnerConnectionsWithoutGloss increased from 1 to 2",
    ]);
    expect(strictViolationIdentityRegressions(current.strictViolations, base.strictViolations)).toEqual([]);
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
