import { describe, expect, it } from "vitest";

import type { WordLearningProfile } from "@/lib/content/word-learning";
import { buildWordLearningDrawerModel } from "./word-learning-drawer-model";

function profile(overrides: Partial<WordLearningProfile> = {}): WordLearningProfile {
  return {
    lemma: "anchor",
    display: "anchor",
    tier: "core",
    partOfSpeech: "noun",
    forms: ["anchors", "anchored"],
    status: "verified",
    sources: ["wordnet"],
    evidence: "verified",
    evidenceLabel: "Verified",
    pronunciation: {
      ipa: "/ˈæŋ.kər/",
      audioUk: "//audio.example/anchor-uk.mp3",
      audioUs: "https://audio.example/anchor-us.mp3",
      audioAny: "https://audio.example/anchor.mp3",
    },
    senses: [
      { id: "wiki:0", partOfSpeech: "noun", definition: "a heavy object that holds a vessel", example: null, source: "wiki", primary: true },
      { id: "dictionaryapi:1", partOfSpeech: "verb", definition: "to hold something firmly", example: "Anchor the tent.", source: "dictionaryapi", primary: false },
      { id: "dictionaryapi:2", partOfSpeech: "noun", definition: "a person who presents a programme", example: null, source: "dictionaryapi", primary: false },
    ],
    examples: [
      { text: "The boat dropped anchor.", source: "wiki" },
      { text: "Anchor the tent.", source: "dictionaryapi" },
    ],
    usageNote: "Often used figuratively for stability.",
    connections: [
      { type: "collocation", target: "boat", gloss: "a boat can drop one" , explained: true },
      { type: "advanced_form", target: "moor", gloss: "authored words unchanged", explained: true },
      { type: "synonym", target: "fasten", explained: false },
      { type: "antonym", target: "release", gloss: "", explained: false },
    ],
    canClaim: true,
    claimBlockReason: null,
    ...overrides,
  };
}

describe("buildWordLearningDrawerModel", () => {
  it("orders explained relationships, separates unreviewed links, and preserves authored connection fields", () => {
    const source = profile();

    const model = buildWordLearningDrawerModel(source);

    expect(model.explainedGroups.map((group) => group.type)).toEqual(["advanced_form", "collocation"]);
    expect(model.explainedGroups[0]?.items[0]).toMatchObject({
      target: "moor",
      type: "advanced_form",
      gloss: "authored words unchanged",
    });
    expect(model.unreviewedGroups.map((group) => group.type)).toEqual(["synonym", "antonym"]);
    expect(model.unreviewedCount).toBe(2);
  });

  it("keeps the primary sense, limits only additional senses, retains every example, and exposes available audio", () => {
    const source = profile({
      senses: Array.from({ length: 7 }, (_, index) => ({
        id: `sense:${index}`,
        partOfSpeech: "noun",
        definition: `meaning ${index + 1}`,
        example: null,
        source: "dictionaryapi" as const,
        primary: index === 0,
      })),
    });

    const model = buildWordLearningDrawerModel(source);

    expect(model.primarySense?.primary).toBe(true);
    expect(model.otherSenses).toHaveLength(5);
    expect(model.examples).toEqual(source.examples);
    expect(model.audio).toEqual({ uk: "//audio.example/anchor-uk.mp3", us: "https://audio.example/anchor-us.mp3", any: "https://audio.example/anchor.mp3", available: true });
  });
});
