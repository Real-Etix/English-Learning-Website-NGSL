import { describe, expect, test } from "vitest";

import {
  createVerificationReport,
  VerificationReportSchema,
  type VerificationReport,
} from "./report";

function report(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return {
    version: 1,
    mode: "dry-run",
    selected: 2,
    attempted: 2,
    sourceBacked: 1,
    published: 1,
    ambiguous: 1,
    unsupported: 0,
    failed: 0,
    relationships: { accepted: 1, rejected: 0, ambiguous: 1, downgraded: 1 },
    cache: {
      wordnet: { hits: 0, misses: 2 },
      dictionaryapi: { hits: 0, misses: 2 },
      tatoeba: { hits: 0, misses: 2 },
      llm: { hits: 0, misses: 1 },
    },
    requests: { source: 4, llm: 1 },
    tokenUsage: { inputTokens: 25, outputTokens: 4 },
    changedShards: [],
    entries: [
      { lemma: "alpha", reason: "published" },
      { lemma: "zeta", reason: "sense_ambiguous" },
    ],
    remaining: {
      hiddenAdvanced: 1,
      strictViolations: {
        publishedPlaceholders: 0,
        publishedUnsupportedSenses: 0,
        claimableSensesWithoutSourcedExamples: 0,
        publishedConnectionsToHiddenOrMissingTargets: 0,
        learnerConnectionsWithoutGloss: 0,
      },
    },
    ...overrides,
  };
}

describe("VerificationReportSchema", () => {
  test("accepts the strict aggregate report contract", () => {
    expect(VerificationReportSchema.parse(report())).toEqual(report());
  });

  test("rejects unknown, sensitive, raw, and over-broad entry fields recursively", () => {
    const invalidValues: unknown[] = [
      { ...report(), raw: { provider: "payload" } },
      { ...report(), entries: [{ lemma: "alpha", reason: "published", prompt: "secret" }] },
      { ...report(), cache: { ...report().cache, authorization: "Bearer key" } },
      { ...report(), token: "secret" },
      { ...report(), apiKey: "secret" },
      { ...report(), entries: [{ lemma: "alpha", reason: "published", response: {} }] },
    ];

    for (const value of invalidValues) expect(VerificationReportSchema.safeParse(value).success).toBe(false);
  });

  test("requires sorted unique arrays and bounds entries to the selected count", () => {
    expect(VerificationReportSchema.safeParse(report({
      selected: 1,
      entries: [
        { lemma: "alpha", reason: "published" },
        { lemma: "zeta", reason: "sense_ambiguous" },
      ],
    })).success).toBe(false);
    expect(VerificationReportSchema.safeParse(report({
      changedShards: ["0f", "01"],
    })).success).toBe(false);
    expect(VerificationReportSchema.safeParse(report({
      entries: [...report().entries].reverse(),
    })).success).toBe(false);
  });
});

describe("createVerificationReport", () => {
  test("sorts and deduplicates shard IDs and entries deterministically", () => {
    const created = createVerificationReport(report({
      changedShards: ["0f", "01", "0f"],
      entries: [
        { lemma: "zeta", reason: "sense_ambiguous" },
        { lemma: "alpha", reason: "published" },
      ],
    }));

    expect(created.changedShards).toEqual(["01", "0f"]);
    expect(created.entries).toEqual([
      { lemma: "alpha", reason: "published" },
      { lemma: "zeta", reason: "sense_ambiguous" },
    ]);
  });
});
