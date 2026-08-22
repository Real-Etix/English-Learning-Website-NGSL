import { describe, expect, it } from "vitest";

import type { WikiPage } from "@/lib/wiki/parse-wiki";
import { resolveWordLearningProfile } from "./word-learning-response";

const page: WikiPage = {
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
});
