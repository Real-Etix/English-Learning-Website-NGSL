import { describe, expect, it } from "vitest";

import { auditDictionaryPages, hasStrictFailures } from "./dictionary-quality";
import type { WikiPage } from "./parse-wiki";

function page(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    lemma: "anchor",
    display: "anchor",
    tier: "core",
    pos: "noun",
    rank: 1,
    sfi: 70,
    chart: null,
    region: null,
    lists: ["ngsl"],
    forms: ["anchor"],
    status: "seeded",
    sources: ["wordnet"],
    definition: "A fixed point used for support.",
    usageNote: null,
    examples: ["The boat dropped its anchor."],
    connections: [{ type: "synonym", target: "support", gloss: "a related support idea" }],
    domains: [],
    ...overrides,
  };
}

describe("auditDictionaryPages", () => {
  it("counts global and per-list dictionary quality in one serializable report", () => {
    const report = auditDictionaryPages([
      page(),
      page({
        lemma: "draft",
        tier: "advanced",
        pos: "unknown",
        lists: ["ngsl", "academic"],
        sources: ["llm"],
        definition: "Definition pending — needs review.",
        examples: [],
        connections: [
          { type: "builds_on", target: "anchor" },
          { type: "synonym", target: "support", gloss: " " },
        ],
      }),
      page({
        lemma: "isolated",
        lists: ["academic"],
        status: "verified",
        sources: [],
        examples: [],
        connections: [],
      }),
      page({
        lemma: "draft-core",
        pos: "  ",
        lists: [],
        sources: ["llm"],
        connections: [{ type: "antonym", target: "support" }],
      }),
    ]);

    expect(report.total).toEqual({
      pages: 4,
      placeholders: 1,
      noExamples: 2,
      unknownPartOfSpeech: 2,
      llmOnlyAdvanced: 1,
      zeroConnections: 1,
      evidence: { verified: 1, sourceBacked: 1, aiDraft: 2 },
      edges: {
        total: 4,
        unexplained: 3,
        byType: {
          antonym: { total: 1, unexplained: 1 },
          builds_on: { total: 1, unexplained: 1 },
          synonym: { total: 2, unexplained: 1 },
        },
      },
    });
    expect(report.lists).toEqual({
      academic: {
        pages: 2,
        placeholders: 1,
        noExamples: 2,
        unknownPartOfSpeech: 1,
        llmOnlyAdvanced: 1,
        zeroConnections: 1,
        evidence: { verified: 1, sourceBacked: 0, aiDraft: 1 },
        edges: {
          total: 2,
          unexplained: 2,
          byType: {
            builds_on: { total: 1, unexplained: 1 },
            synonym: { total: 1, unexplained: 1 },
          },
        },
      },
      ngsl: {
        pages: 2,
        placeholders: 1,
        noExamples: 1,
        unknownPartOfSpeech: 1,
        llmOnlyAdvanced: 1,
        zeroConnections: 0,
        evidence: { verified: 0, sourceBacked: 1, aiDraft: 1 },
        edges: {
          total: 3,
          unexplained: 2,
          byType: {
            builds_on: { total: 1, unexplained: 1 },
            synonym: { total: 2, unexplained: 1 },
          },
        },
      },
    });
  });

  it("counts a page and its edges once per distinct list ID", () => {
    const report = auditDictionaryPages([
      page({
        lists: ["ngsl", "ngsl", "academic", "academic"],
        connections: [{ type: "synonym", target: "support" }],
      }),
    ]);

    for (const list of ["ngsl", "academic"]) {
      expect(report.lists[list]).toMatchObject({
        pages: 1,
        edges: {
          total: 1,
          unexplained: 1,
          byType: { synonym: { total: 1, unexplained: 1 } },
        },
      });
    }
  });

  it("reports strict failures only for placeholders and LLM-only advanced pages", () => {
    expect(hasStrictFailures(auditDictionaryPages([page({ examples: [], connections: [] })]))).toBe(false);
    expect(hasStrictFailures(auditDictionaryPages([page({ definition: "Needs a fuller dictionary source." })]))).toBe(true);
    expect(hasStrictFailures(auditDictionaryPages([page({ tier: "advanced", sources: ["llm"] })]))).toBe(true);
    expect(hasStrictFailures(auditDictionaryPages([page({ tier: "advanced", sources: [] })]))).toBe(false);
    expect(
      hasStrictFailures(auditDictionaryPages([page({ tier: "advanced", sources: ["llm", "wordnet"] })])),
    ).toBe(false);
  });
});
