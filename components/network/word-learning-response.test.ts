import { describe, expect, it } from "vitest";

import { buildWordLearningProfile } from "../../lib/content/word-learning";
import { toCanonicalRecord, type LegacyWordPage } from "@/lib/vocabulary/legacy-profile-adapter";
import { resolveWordLearningProfile } from "./word-learning-response";

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
});
