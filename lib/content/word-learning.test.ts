import { describe, expect, it } from "vitest";

import type { WordDetail } from "./word-detail";
import { buildWordLearningProfile } from "./word-learning";
import { toCanonicalRecord, type LegacyWordPage } from "../vocabulary/legacy-profile-adapter";
import type { VocabularyRecord } from "../vocabulary/schema";
import { vocabularyRecordFixture } from "../vocabulary/test-fixtures";

const emptyDetail: WordDetail = {
  ipa: null,
  audioUk: null,
  audioUs: null,
  audioAny: null,
  senses: [],
  synonyms: [],
};

const detail: WordDetail = {
  ipa: "/ˈkɔːr/",
  audioUk: "https://audio.example/core-uk.mp3",
  audioUs: "https://audio.example/core-us.mp3",
  audioAny: "https://audio.example/core.mp3",
  senses: [
    { partOfSpeech: "noun", definition: "wiki meaning", example: "A duplicate example." },
    { partOfSpeech: "noun", definition: "second dictionary meaning", example: "A dictionary example." },
  ],
  synonyms: [],
};

function sourceRef(sourceId: string) {
  return {
    sourceId,
    externalId: null,
    url: null,
    retrievedAt: null,
    contentHash: null,
  };
}

function sourcedExample(text: string) {
  return { text, sources: [sourceRef("curated")] };
}

function page(overrides: Partial<LegacyWordPage> = {}): VocabularyRecord {
  const legacyPage: LegacyWordPage = {
    lemma: "core",
    display: "core",
    tier: "core",
    pos: "noun",
    rank: 1,
    sfi: 70,
    chart: null,
    region: null,
    lists: ["ngsl"],
    forms: ["core"],
    status: "enriched",
    sources: ["wordnet"],
    definition: "wiki meaning",
    usageNote: null,
    examples: ["A duplicate example."],
    connections: [{ type: "synonym", target: "centre", gloss: "same central idea" }],
    domains: [],
    ...overrides,
  };
  return toCanonicalRecord(legacyPage);
}

describe("buildWordLearningProfile", () => {
  it("maps the canonical primary sense and examples into the learner profile", () => {
    const record = vocabularyRecordFixture();

    expect(buildWordLearningProfile(record, emptyDetail)).toMatchObject({
      lemma: record.lemma,
      partOfSpeech: record.senses[0].partOfSpeech,
      senses: [expect.objectContaining({ definition: record.senses[0].definition, primary: true })],
      examples: [expect.objectContaining({ text: record.senses[0].examples[0].text })],
    });
  });

  it("exposes only sourced published guidance from the selected published sense", () => {
    const record = vocabularyRecordFixture();
    const selectedSense = {
      ...record.senses[0]!,
      usagePatterns: [
        {
          pattern: "obtain + noun",
          explanation: "Used with something acquired formally.",
          examples: [sourcedExample("They obtained permission.")],
          sources: [sourceRef("curated")],
          status: "published" as const,
        },
        {
          pattern: "draft pattern",
          explanation: "Draft guidance must stay editorial.",
          examples: [],
          sources: [sourceRef("curated")],
          status: "draft" as const,
        },
      ],
      collocations: [
        {
          phrase: "obtain permission",
          explanation: "a common formal combination",
          sources: [sourceRef("curated")],
          status: "published" as const,
        },
        {
          phrase: "unattributed phrase",
          explanation: "This must not reach learners.",
          sources: [],
          status: "published" as const,
        },
      ],
      commonMistakes: [
        {
          incorrect: "obtain to permission",
          correction: "obtain permission",
          explanation: "Obtain takes a direct object here.",
          sources: [sourceRef("curated")],
          status: "published" as const,
        },
      ],
    };
    const otherSense = {
      ...selectedSense,
      id: "other-published-sense",
      usagePatterns: [{
        pattern: "other + pattern",
        explanation: "Guidance for another sense.",
        examples: [],
        sources: [sourceRef("curated")],
        status: "published" as const,
      }],
    };

    const profile = buildWordLearningProfile({
      ...record,
      senses: [selectedSense, otherSense],
    }, emptyDetail);

    expect(profile.usagePatterns).toEqual([{
      pattern: "obtain + noun",
      explanation: "Used with something acquired formally.",
      examples: [{
        text: "They obtained permission.",
        sources: [expect.objectContaining({ sourceId: "curated", label: "Manual curation" })],
      }],
      sources: [expect.objectContaining({ sourceId: "curated", label: "Manual curation" })],
    }]);
    expect(profile.collocations).toEqual([{
      phrase: "obtain permission",
      explanation: "a common formal combination",
      sources: [expect.objectContaining({ sourceId: "curated", label: "Manual curation" })],
    }]);
    expect(profile.commonMistakes).toEqual([{
      incorrect: "obtain to permission",
      correction: "obtain permission",
      explanation: "Obtain takes a direct object here.",
      sources: [expect.objectContaining({ sourceId: "curated", label: "Manual curation" })],
    }]);
    expect(JSON.stringify(profile)).not.toContain("draft pattern");
    expect(JSON.stringify(profile)).not.toContain("other + pattern");
  });

  it("excludes nonfactual and unknown guidance sources without throwing", () => {
    const record = vocabularyRecordFixture();
    const selectedSense = {
      ...record.senses[0]!,
      usagePatterns: [{
        pattern: "obtain + noun",
        explanation: "Keep this authored explanation.",
        examples: [
          sourcedExample("Factual example."),
          { text: "LLM example.", sources: [sourceRef("llm")] },
          { text: "Unknown example.", sources: [sourceRef("unknown-provider")] },
        ],
        sources: [sourceRef("curated"), sourceRef("llm"), sourceRef("unknown-provider")],
        status: "published" as const,
      }],
      collocations: [{
        phrase: "draft phrase",
        explanation: "LLM-only guidance must stay editorial.",
        sources: [sourceRef("llm")],
        status: "published" as const,
      }],
      commonMistakes: [{
        incorrect: "unknown mistake",
        correction: "correct mistake",
        explanation: "Unknown source guidance must stay out.",
        sources: [sourceRef("unknown-provider")],
        status: "published" as const,
      }],
    };

    const profile = buildWordLearningProfile({ ...record, senses: [selectedSense] }, emptyDetail);

    expect(profile.usagePatterns).toHaveLength(1);
    expect(profile.usagePatterns[0]).toMatchObject({
      pattern: "obtain + noun",
      sources: [expect.objectContaining({ sourceId: "curated", label: "Manual curation" })],
      examples: [{
        text: "Factual example.",
        sources: [expect.objectContaining({ sourceId: "curated", label: "Manual curation" })],
      }],
    });
    expect(profile.collocations).toEqual([]);
    expect(profile.commonMistakes).toEqual([]);
    expect(JSON.stringify(profile)).not.toContain("LLM example.");
    expect(JSON.stringify(profile)).not.toContain("Unknown example.");
  });

  it("keeps a source-backed wiki meaning before later dictionary senses", () => {
    const corePage = page();

    expect(buildWordLearningProfile(corePage, detail).senses.map((sense) => sense.definition)).toEqual([
      "wiki meaning",
      "second dictionary meaning",
    ]);
  });

  it("rescues an LLM-only advanced draft with a sourced dictionary meaning", () => {
    const aiDraftAdvancedPage = page({
      tier: "advanced",
      status: "enriched",
      sources: ["llm"],
      definition: "AI draft wording",
      examples: [],
    });
    const sourcedDetail: WordDetail = {
      ...emptyDetail,
      senses: [{ partOfSpeech: "noun", definition: "sourced dictionary meaning", example: "A sourced example." }],
    };

    expect(buildWordLearningProfile(aiDraftAdvancedPage, sourcedDetail).senses[0]).toMatchObject({
      definition: "sourced dictionary meaning",
      source: "dictionaryapi",
      primary: true,
    });
  });

  it("uses a dictionary meaning for an enriched core LLM-only wiki definition", () => {
    const profile = buildWordLearningProfile(
      page({
        status: "enriched",
        sources: ["llm"],
        definition: "LLM-generated core wording.",
        examples: ["An LLM-generated wiki example."],
      }),
      {
        ...emptyDetail,
        senses: [
          {
            partOfSpeech: "noun",
            definition: "A valid dictionary meaning.",
            example: "A valid dictionary example.",
          },
        ],
      },
    );

    expect(profile).toMatchObject({ evidence: "source-backed", canClaim: true });
    expect(profile.senses[0]).toMatchObject({
      definition: "A valid dictionary meaning.",
      source: "dictionaryapi",
      primary: true,
    });
    expect(profile.senses.find((sense) => sense.primary)?.definition).not.toBe("LLM-generated core wording.");
  });

  it("keeps an LLM-primary sense as an unclaimable draft when another sense is factual", () => {
    const mixedRecord = page({
      status: "enriched",
      sources: ["llm", "dictionaryapi"],
      definition: "LLM-generated primary wording.",
      examples: ["An LLM-generated primary example."],
    });
    const llmSource = mixedRecord.sources.find((source) => source.sourceId === "llm")!;
    const dictionarySource = mixedRecord.sources.find((source) => source.sourceId === "dictionaryapi")!;

    const profile = buildWordLearningProfile({
      ...mixedRecord,
      senses: [
        { ...mixedRecord.senses[0]!, sources: [llmSource] },
        {
          ...mixedRecord.senses[0]!,
          id: "dictionary-imported-sense",
          definition: "A separately imported factual meaning.",
          sources: [dictionarySource],
          status: "review",
        },
      ],
    }, emptyDetail);

    expect(profile).toMatchObject({ evidence: "ai-draft", canClaim: false });
  });

  it("marks an LLM-only advanced draft without dictionary detail as unclaimable", () => {
    const aiDraftAdvancedPage = page({
      tier: "advanced",
      sources: ["llm"],
      definition: "AI draft wording",
      examples: [],
    });

    expect(buildWordLearningProfile(aiDraftAdvancedPage, emptyDetail)).toMatchObject({
      evidence: "ai-draft",
      canClaim: false,
    });
  });

  it("does not verify an advanced LLM-only page from status and a wiki example alone", () => {
    const verifiedAiDraftAdvancedPage = page({
      tier: "advanced",
      status: "verified",
      sources: ["llm"],
      definition: "AI draft wording",
      examples: ["A wiki-only example."],
    });

    expect(buildWordLearningProfile(verifiedAiDraftAdvancedPage, emptyDetail)).toMatchObject({
      evidence: "ai-draft",
      canClaim: false,
    });
  });

  it("excludes empty and placeholder dictionary senses from an advanced AI draft", () => {
    const profile = buildWordLearningProfile(
      page({
        tier: "advanced",
        status: "verified",
        sources: ["llm"],
        definition: "AI draft wording",
        examples: ["A wiki-only example."],
      }),
      {
        ...emptyDetail,
        senses: [
          { partOfSpeech: "noun", definition: " ", example: "An empty-definition example." },
          {
            partOfSpeech: "noun",
            definition: "Definition pending — needs review.",
            example: "A placeholder-definition example.",
          },
        ],
      },
    );

    expect(profile).toMatchObject({ evidence: "ai-draft", canClaim: false });
    expect(profile.senses).toEqual([
      expect.objectContaining({ definition: "AI draft wording", source: "wiki", primary: true }),
    ]);
    expect(profile.examples).toEqual([{ text: "A wiki-only example.", source: "wiki" }]);
  });

  it("uses a usable dictionary sense when a core wiki definition is a placeholder", () => {
    const profile = buildWordLearningProfile(
      page({ definition: "Definition pending — needs review." }),
      {
        ...emptyDetail,
        senses: [
          {
            partOfSpeech: "noun",
            definition: "A valid dictionary meaning.",
            example: "A valid dictionary example.",
          },
        ],
      },
    );

    expect(profile).toMatchObject({ evidence: "source-backed", canClaim: true });
    expect(profile.senses[0]).toMatchObject({
      definition: "A valid dictionary meaning.",
      source: "dictionaryapi",
      primary: true,
    });
    expect(profile.senses.map((sense) => sense.definition)).not.toContain("Definition pending — needs review.");
  });

  it("blocks a source-backed word without an example", () => {
    const corePageWithoutExamples = page({ examples: [] });

    expect(buildWordLearningProfile(corePageWithoutExamples, emptyDetail).claimBlockReason).toMatch(/example/i);
  });

  it("preserves an authored connection gloss exactly", () => {
    const corePage = page();

    expect(buildWordLearningProfile(corePage, detail).connections[0].gloss).toBe(corePage.connections[0].gloss);
  });

  it("exposes only published, glossed connections in the learner profile", () => {
    const record = page();
    const [valid] = record.connections;
    const profile = buildWordLearningProfile({
      ...record,
      connections: [
        valid!,
        { ...valid!, target: "draft-link", gloss: "draft guidance", status: "unreviewed" },
        { ...valid!, target: "empty-link", gloss: " ", status: "published" },
      ],
    }, emptyDetail);

    expect(profile.connections.map((connection) => connection.target)).toEqual([valid!.target]);
  });

  it("deduplicates exact examples while preserving their displayed text and source", () => {
    const profile = buildWordLearningProfile(
      page({ examples: ["A duplicate example.", " A second wiki example. "] }),
      detail,
    );

    expect(profile.examples).toEqual([
      { text: "A duplicate example.", source: "wiki" },
      { text: " A second wiki example. ", source: "wiki" },
      { text: "A dictionary example.", source: "dictionaryapi" },
    ]);
  });

  it("rejects a placeholder definition even when its source is factual", () => {
    const profile = buildWordLearningProfile(
      page({ definition: "Definition pending — needs review.", examples: ["A sourced-looking example."] }),
      emptyDetail,
    );

    expect(profile).toMatchObject({ evidence: "ai-draft", canClaim: false });
    expect(profile.claimBlockReason).toMatch(/meaning/i);
  });

  it("copies dictionary pronunciation fields without modification", () => {
    expect(buildWordLearningProfile(page(), detail).pronunciation).toEqual({
      ipa: "/ˈkɔːr/",
      audioUk: "https://audio.example/core-uk.mp3",
      audioUs: "https://audio.example/core-us.mp3",
      audioAny: "https://audio.example/core.mp3",
    });
  });

  it("marks an explicitly verified wiki page as verified evidence", () => {
    expect(buildWordLearningProfile(page({ status: "verified" }), emptyDetail).evidence).toBe("verified");
  });

  it("caps combined senses at six", () => {
    const manySenses: WordDetail = {
      ...emptyDetail,
      senses: Array.from({ length: 7 }, (_, index) => ({
        partOfSpeech: "noun",
        definition: `dictionary meaning ${index + 1}`,
        example: null,
      })),
    };

    const profile = buildWordLearningProfile(page(), manySenses);
    expect(profile.senses).toHaveLength(6);
    expect(profile.senses.map((sense) => sense.definition)).toEqual([
      "wiki meaning",
      "dictionary meaning 1",
      "dictionary meaning 2",
      "dictionary meaning 3",
      "dictionary meaning 4",
      "dictionary meaning 5",
    ]);
  });
});
