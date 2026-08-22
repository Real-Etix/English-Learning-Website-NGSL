import { describe, expect, it } from "vitest";

import { buildTutorSenseContext, buildTutorStarContext } from "./tutor-context";
import type { WordLearningProfile } from "./word-learning";
import { vocabularyRecordFixture } from "../vocabulary/test-fixtures";

function profile(overrides: Partial<WordLearningProfile> = {}): WordLearningProfile {
  return {
    lemma: "protocol",
    display: "protocol",
    tier: "core",
    partOfSpeech: "noun",
    forms: ["protocols"],
    status: "verified",
    sources: ["wordnet"],
    evidence: "source-backed",
    evidenceLabel: "Source-backed",
    pronunciation: { ipa: null, audioUk: null, audioUs: null, audioAny: null },
    senses: [
      { id: "wiki:0", partOfSpeech: "noun", definition: "formal process only", example: null, source: "wiki", primary: true },
      { id: "dictionaryapi:1", partOfSpeech: "noun", definition: "a second sense", example: null, source: "dictionaryapi", primary: false },
      { id: "dictionaryapi:2", partOfSpeech: "noun", definition: "a third sense", example: null, source: "dictionaryapi", primary: false },
      { id: "dictionaryapi:3", partOfSpeech: "noun", definition: "a fourth sense", example: null, source: "dictionaryapi", primary: false },
      { id: "dictionaryapi:4", partOfSpeech: "noun", definition: "a fifth sense", example: null, source: "dictionaryapi", primary: false },
    ],
    examples: [
      { text: "A sourced wiki example.", source: "wiki" },
      { text: "A sourced dictionary example.", source: "dictionaryapi" },
      { text: "A third sourced example.", source: "dictionaryapi" },
      { text: "A fourth sourced example.", source: "dictionaryapi" },
    ],
    usagePatterns: [],
    collocations: [],
    commonMistakes: [],
    usageNote: "Use the authored note unchanged.",
    connections: [
      { type: "builds_on", target: "procedure", gloss: "authored relation wording", explained: true },
      { type: "antonym", target: "unreviewed-target", explained: false },
      ...Array.from({ length: 12 }, (_, index) => ({
        type: "synonym",
        target: `explained-target-${index + 1}`,
        gloss: `explained gloss ${index + 1}`,
        explained: true,
      })),
    ],
    canClaim: true,
    claimBlockReason: null,
    ...overrides,
  };
}

describe("buildTutorStarContext", () => {
  it("includes bounded sourced teaching evidence and only authored relation explanations", () => {
    const context = buildTutorStarContext(profile());

    expect(context).toContain("Word: protocol");
    expect(context).toContain("Evidence: Source-backed");
    expect(context).toContain("Primary meaning:");
    expect(context).toContain("formal process only");
    expect(context).toContain("Additional meanings:");
    expect(context).toContain("a fourth sense");
    expect(context).not.toContain("a fifth sense");
    expect(context).toContain("A sourced dictionary example.");
    expect(context).not.toContain("A fourth sourced example.");
    expect(context).toContain("Use the authored note unchanged.");
    expect(context).toContain("authored relation wording");
    expect(context).toContain("explained gloss 11");
    expect(context).not.toContain("explained gloss 12");
    expect(context).not.toContain("unreviewed-target");
    expect(context.endsWith("Do not invent missing usage guidance or relationships.")).toBe(true);
  });

  it("labels an AI draft without changing its authored meaning", () => {
    const context = buildTutorStarContext(profile({ evidence: "ai-draft", evidenceLabel: "AI draft" }));

    expect(context).toContain("AI draft");
    expect(context).toContain("formal process only");
  });

  it("receives only a selector-filtered connection list", () => {
    const context = buildTutorStarContext(profile({
      connections: [{ type: "synonym", target: "reviewed-target", gloss: "authored relation wording", explained: true }],
    }));

    expect(context).toContain("reviewed-target");
    expect(context).not.toContain("unreviewed-target");
  });
});

describe("buildTutorSenseContext", () => {
  it("grounds tutoring in only the requested published sense and bounded authored evidence", () => {
    const record = vocabularyRecordFixture();
    const [firstSense] = record.senses;
    const selected = {
      ...firstSense!,
      id: "bank:noun:money",
      definition: "a financial institution that keeps money",
      examples: Array.from({ length: 4 }, (_, index) => ({
        ...firstSense!.examples[0]!,
        text: `Selected example ${index + 1}.`,
      })),
      usagePatterns: Array.from({ length: 2 }, (_, index) => ({
        pattern: `selected pattern ${index + 1}`,
        explanation: `selected pattern explanation ${index + 1}`,
        examples: [],
        sources: firstSense!.sources,
        status: "published" as const,
      })),
      collocations: Array.from({ length: 2 }, (_, index) => ({
        phrase: `selected collocation ${index + 1}`,
        explanation: `selected collocation explanation ${index + 1}`,
        sources: firstSense!.sources,
        status: "published" as const,
      })),
      commonMistakes: Array.from({ length: 2 }, (_, index) => ({
        incorrect: `selected mistake ${index + 1}`,
        correction: `selected correction ${index + 1}`,
        explanation: `selected mistake explanation ${index + 1}`,
        sources: firstSense!.sources,
        status: "published" as const,
      })),
      status: "published" as const,
    };
    const other = {
      ...firstSense!,
      id: "bank:verb:tilt",
      definition: "to tilt an airplane while turning",
      examples: [{ ...firstSense!.examples[0]!, text: "Other-sense example." }],
      usagePatterns: [{
        pattern: "other-sense pattern",
        explanation: "Other-sense guidance.",
        examples: [],
        sources: firstSense!.sources,
        status: "published" as const,
      }],
      collocations: [],
      commonMistakes: [],
      status: "published" as const,
    };
    const draft = {
      ...firstSense!,
      id: "bank:draft",
      definition: "Draft meaning that must not appear.",
      status: "draft" as const,
    };
    const context = buildTutorSenseContext({
      ...record,
      lemma: "bank",
      display: "bank",
      senses: [selected, other, draft],
      connections: [
        { ...record.connections[0]!, target: "ledger", gloss: "Published connection explanation.", status: "published" as const },
        { ...record.connections[0]!, target: "hidden-link", gloss: "Hidden connection explanation.", status: "hidden" as const },
        { ...record.connections[0]!, target: "unglossed-link", gloss: null, status: "published" as const },
        ...Array.from({ length: 12 }, (_, index) => ({
          ...record.connections[0]!,
          target: `published-link-${index + 1}`,
          gloss: `Published link explanation ${index + 1}.`,
          status: "published" as const,
        })),
      ],
    }, selected.id);

    expect(context).toContain("a financial institution that keeps money");
    expect(context).not.toContain("to tilt an airplane while turning");
    expect(context).not.toContain("Draft meaning that must not appear.");
    expect(context).toContain("Selected example 3.");
    expect(context).not.toContain("Selected example 4.");
    expect(context).toContain("selected pattern 2");
    expect(context).toContain("selected collocation 2");
    expect(context).toContain("selected mistake 2");
    expect(context).not.toContain("other-sense pattern");
    expect(context).toContain("Published link explanation 11.");
    expect(context).not.toContain("Published link explanation 12.");
    expect(context).not.toContain("Hidden connection explanation.");
    expect(context).not.toContain("unglossed-link");
    expect(context?.endsWith("Do not invent missing usage guidance or relationships.")).toBe(true);
  });

  it("returns null instead of falling back when a requested sense does not belong to the record", () => {
    expect(buildTutorSenseContext(vocabularyRecordFixture(), "other-word:sense")).toBeNull();
  });
});
