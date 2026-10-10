import { describe, expect, it } from "vitest";

import type { WordLearningProfile } from "@/lib/content/word-learning";
import { preferredPublishedSenseId, resolveSelectedSenseId, rollbackOptimisticClaim } from "./star-atlas";

function sense(overrides: Partial<WordLearningProfile["senses"][number]> = {}): WordLearningProfile["senses"][number] {
  return {
    id: "primary",
    partOfSpeech: "noun",
    definition: "a meaning",
    example: null,
    source: "wiki",
    primary: false,
    published: false,
    canClaim: true,
    claimBlockReason: null,
    ...overrides,
  };
}

describe("rollbackOptimisticClaim", () => {
  it("removes a newly optimistic sense claim after a failed POST", () => {
    const owned = new Set(["bank", "learn"]);

    expect(rollbackOptimisticClaim(owned, "bank", false)).toEqual(new Set(["learn"]));
  });

  it("preserves an existing held word when a duplicate request fails", () => {
    const owned = new Set(["bank", "learn"]);

    expect(rollbackOptimisticClaim(owned, "bank", true)).toBe(owned);
  });
});

describe("preferredPublishedSenseId", () => {
  it("prefers the published primary and never substitutes an arbitrary claimable sense", () => {
    expect(preferredPublishedSenseId({ senses: [
      sense({ id: "claimable-but-not-published" }),
      sense({ id: "published-secondary", published: true }),
      sense({ id: "published-primary", published: true, primary: true }),
    ] })).toBe("published-primary");

    expect(preferredPublishedSenseId({ senses: [
      sense({ id: "claimable-first" }),
      sense({ id: "published-first", published: true }),
    ] })).toBe("published-first");

    expect(preferredPublishedSenseId({ senses: [sense({ id: "claimable-only" })] })).toBeNull();
  });
});

describe("resolveSelectedSenseId", () => {
  const profile = { lemma: "bank", senses: [
    sense({ id: "bank-primary", published: true, primary: true }),
    sense({ id: "bank-river", published: true }),
  ] };

  it("preserves an explicit choice for the current word", () => {
    expect(resolveSelectedSenseId(profile, { lemma: "bank", senseId: "bank-river" }))
      .toBe("bank-river");
  });

  it("uses the current word's default when a stored choice is stale or belongs to another word", () => {
    expect(resolveSelectedSenseId(profile, { lemma: "learn", senseId: "bank-river" }))
      .toBe("bank-primary");
    expect(resolveSelectedSenseId(profile, { lemma: "bank", senseId: "removed-sense" }))
      .toBe("bank-primary");
  });

  it("has no selected meaning while the focused word is loading", () => {
    expect(resolveSelectedSenseId(null, { lemma: "bank", senseId: "bank-river" })).toBeNull();
  });
});
