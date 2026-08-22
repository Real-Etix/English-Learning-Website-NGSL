import { describe, expect, it } from "vitest";

import { buildTutorStarContext } from "./tutor-context";
import type { WordLearningProfile } from "./word-learning";

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
});
