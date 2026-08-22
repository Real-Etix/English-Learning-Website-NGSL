import { describe, expect, it } from "vitest";

import { buildWordLearningProfile } from "../../lib/content/word-learning";
import { toCanonicalRecord, type LegacyWordPage } from "@/lib/vocabulary/legacy-profile-adapter";
import { isWordLearningProfile, resolveWordLearningProfile } from "./word-learning-response";

const page: LegacyWordPage = {
  lemma: "anchor",
  display: "anchor",
  tier: "core",
  pos: "noun",
  rank: 1,
  sfi: 70,
  chart: null,
  region: null,
  lists: ["ngsl"],
  forms: ["anchors"],
  status: "verified",
  sources: ["wordnet"],
  definition: "a heavy object that holds a vessel in place",
  usageNote: null,
  examples: ["The boat dropped anchor."],
  connections: [],
  domains: [],
};

const learningProfile = () => buildWordLearningProfile(toCanonicalRecord(page), null);

describe("resolveWordLearningProfile", () => {
  it("derives a learning profile from a compatible raw word response", () => {
    const profile = resolveWordLearningProfile({
      page,
      detail: null,
      learning: { incomplete: true },
    });

    expect(profile).toMatchObject({
      lemma: "anchor",
      display: "anchor",
      senses: [expect.objectContaining({ definition: page.definition, primary: true })],
    });
  });

  it("derives from raw word data when a structurally valid profile belongs to another lemma", () => {
    const profile = resolveWordLearningProfile({
      page,
      detail: null,
      learning: { ...learningProfile(), lemma: "compass" },
    });

    expect(profile).toMatchObject({ lemma: "anchor", display: "anchor" });
  });

  it("accepts a profile whose lemma matches the page after normalization", () => {
    const learning = { ...learningProfile(), lemma: " Anchor " };

    expect(resolveWordLearningProfile({ page, detail: null, learning })).toBe(learning);
  });

  it("rejects an async response whose page lemma differs from the requested lemma", () => {
    const profile = resolveWordLearningProfile({
      page,
      detail: null,
      learning: learningProfile(),
    }, "compass");

    expect(profile).toBeNull();
  });

  it("rejects a response without a structurally valid raw page", () => {
    expect(resolveWordLearningProfile({
      page: { lemma: "anchor" },
      detail: null,
      learning: null,
    } as unknown as Parameters<typeof resolveWordLearningProfile>[0])).toBeNull();

    expect(resolveWordLearningProfile({
      detail: null,
      learning: null,
    } as unknown as Parameters<typeof resolveWordLearningProfile>[0])).toBeNull();
  });

  it("rejects an attributed guidance item without its required source label", () => {
    expect(isWordLearningProfile({
      ...learningProfile(),
      usagePatterns: [{
        pattern: "anchor + noun",
        explanation: "Used with something held firmly.",
        examples: [],
        sources: [{ sourceId: "curated" }],
      }],
      collocations: [],
      commonMistakes: [],
    })).toBe(false);
  });

  it.each([
    ["an llm source", { sourceId: "llm", label: "LLM drafting pass" }],
    ["an unknown source", { sourceId: "unknown-provider", label: "Manual curation" }],
    ["a mismatched source label", { sourceId: "curated", label: "Wrong label" }],
  ])("falls back from learning data containing %s", (_description, source) => {
    const learning = {
      ...learningProfile(),
      usagePatterns: [{
        pattern: "untrusted pattern",
        explanation: "This must never reach the learner.",
        examples: [],
        sources: [{ ...source, externalId: null, url: null, retrievedAt: null, contentHash: null }],
      }],
      collocations: [],
      commonMistakes: [],
    };

    expect(isWordLearningProfile(learning)).toBe(false);
    const resolved = resolveWordLearningProfile({ page, detail: null, learning });

    expect(resolved).not.toBe(learning);
    expect(resolved?.usagePatterns).toEqual([]);
    expect(resolved?.collocations).toEqual([]);
    expect(resolved?.commonMistakes).toEqual([]);
  });
});
