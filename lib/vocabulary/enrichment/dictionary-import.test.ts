import { describe, expect, it } from "vitest";

import type { WordDetail } from "../../content/word-detail";
import { senseIdFor } from "../sense-id";
import type { VocabularyRecord } from "../schema";
import { vocabularyRecordFixture } from "../test-fixtures";
import { dictionarySenseId, importDictionaryDetail } from "./dictionary-import";
import { eligibleFactualSenses } from "../verification/sense-verifier";

const curatedSource = {
  sourceId: "curated",
  externalId: "bank-curated",
  url: "https://example.com/curated/bank",
  retrievedAt: "2026-08-23T00:00:00.000Z",
  contentHash: "sha256:curated-bank",
};

const dictionarySource = {
  sourceId: "dictionaryapi",
  url: "https://dictionaryapi.dev/api/v2/entries/en/bank",
  retrievedAt: "2026-08-23T00:00:00.000Z",
  contentHash: "sha256:dictionaryapi-bank",
};

function record(): VocabularyRecord {
  const fixture = vocabularyRecordFixture();
  return {
    ...fixture,
    lemma: "bank",
    display: "bank",
    partOfSpeech: "noun",
    status: "verified",
    sources: [curatedSource],
    senses: [{
      ...fixture.senses[0]!,
      id: "curated-bank-financial",
      partOfSpeech: "noun",
      definition: "An organization that holds and lends money.",
      sources: [curatedSource],
      examples: [{ text: "The bank approved her loan.", sources: [curatedSource] }],
      status: "published",
    }],
    pronunciation: [],
  };
}

const detail: WordDetail = {
  ipa: "/bæŋk/",
  audioUk: "https://audio.example/bank-uk.mp3",
  audioUs: null,
  audioAny: null,
  sourceEntryId: "bank-entry-1",
  sourceUrl: "https://dictionaryapi.dev/entries/bank-entry-1",
  pronunciationSources: {
    ipa: { entryId: "bank-entry-1", url: "https://dictionaryapi.dev/entries/bank-entry-1" },
    audioUk: { entryId: "bank-entry-1", url: "https://dictionaryapi.dev/entries/bank-entry-1" },
  },
  senses: [{
    partOfSpeech: "noun",
    definition: "  A financial establishment that accepts deposits.  ",
    example: "She opened an account at the bank.",
    sourceEntryId: "bank-entry-1",
    sourceSenseId: "bank.n.01",
    sourceUrl: "https://dictionaryapi.dev/entries/bank-entry-1#bank.n.01",
  }],
  synonyms: [],
};

describe("importDictionaryDetail", () => {
  it("adds a distinct factual sense without overwriting verified curated wording", () => {
    const result = importDictionaryDetail(record(), detail, dictionarySource);
    const imported = result.record.senses[1]!;

    expect(result.changed).toBe(true);
    expect(result.record.senses).toHaveLength(2);
    expect(result.record.senses[0]?.definition).toBe("An organization that holds and lends money.");
    expect(imported).toMatchObject({
      id: senseIdFor({
        lemma: "bank",
        sourceId: "dictionaryapi",
        externalId: "bank.n.01",
        partOfSpeech: "noun",
        definition: detail.senses[0]!.definition,
      }),
      definition: "  A financial establishment that accepts deposits.  ",
      status: "review",
      sources: [{ sourceId: "dictionaryapi", externalId: "bank.n.01" }],
      examples: [{ text: "She opened an account at the bank." }],
    });
    expect(result.record.pronunciation).toEqual(expect.arrayContaining([
      expect.objectContaining({ ipa: "/bæŋk/", region: "other", audioUrl: null }),
      expect.objectContaining({ ipa: null, region: "uk", audioUrl: "https://audio.example/bank-uk.mp3" }),
    ]));
  });

  it("is idempotent when the same detail is imported again", () => {
    const first = importDictionaryDetail(record(), detail, dictionarySource);
    const second = importDictionaryDetail(first.record, detail, dictionarySource);

    expect(second.changed).toBe(false);
    expect(second.record).toEqual(first.record);
  });

  it("keeps same-wording senses from separate external IDs", () => {
    const anotherDetail: WordDetail = {
      ...detail,
      senses: [{ ...detail.senses[0]!, sourceSenseId: "bank.n.02" }],
    };
    const first = importDictionaryDetail(record(), detail, dictionarySource);
    const second = importDictionaryDetail(first.record, anotherDetail, dictionarySource);

    expect(second.record.senses).toHaveLength(3);
    expect(second.record.senses[1]?.id).not.toBe(second.record.senses[2]?.id);
  });

  it("preserves distinct external IDs and URLs from multiple dictionary entries", () => {
    const multiEntryDetail: WordDetail = {
      ipa: null,
      audioUk: null,
      audioUs: null,
      audioAny: null,
      senses: [
        {
          partOfSpeech: "noun",
          definition: "A financial institution.",
          example: null,
          sourceEntryId: "bank-noun",
          sourceUrl: "https://dictionaryapi.dev/entries/bank-noun",
        },
        {
          partOfSpeech: "verb",
          definition: "To tilt an aircraft.",
          example: null,
          sourceEntryId: "bank-verb",
          sourceUrl: "https://dictionaryapi.dev/entries/bank-verb",
        },
      ],
      synonyms: [],
    };

    const result = importDictionaryDetail(record(), multiEntryDetail, dictionarySource);

    expect(result.record.senses.slice(1).map((sense) => ({
      externalId: sense.sources[0]?.externalId,
      url: sense.sources[0]?.url,
    }))).toEqual([
      { externalId: "bank-noun", url: "https://dictionaryapi.dev/entries/bank-noun" },
      { externalId: "bank-verb", url: "https://dictionaryapi.dev/entries/bank-verb" },
    ]);
  });

  it("is idempotent when source entries are reordered without external IDs", () => {
    const senses = [
      { partOfSpeech: "noun", definition: "A financial institution.", example: null },
      { partOfSpeech: "verb", definition: "To tilt an aircraft.", example: null },
    ];
    const firstDetail: WordDetail = {
      ipa: null,
      audioUk: null,
      audioUs: null,
      audioAny: null,
      senses,
      synonyms: [],
    };
    const reorderedDetail: WordDetail = { ...firstDetail, senses: [...senses].reverse() };

    const first = importDictionaryDetail(record(), firstDetail, dictionarySource);
    const second = importDictionaryDetail(first.record, reorderedDetail, dictionarySource);

    expect(second.changed).toBe(false);
    expect(second.record).toEqual(first.record);
  });

  it("rejects a non-factual import source", () => {
    expect(() => importDictionaryDetail(record(), detail, {
      ...dictionarySource,
      sourceId: "llm",
    })).toThrow("must be factual");
  });

  it("uses the same fallback canonical ID the verifier predicts before import", () => {
    const fallbackDetail: WordDetail = {
      ipa: null,
      audioUk: null,
      audioUs: null,
      audioAny: null,
      senses: [{
        partOfSpeech: "noun",
        definition: "A raised bank beside a river.",
        example: "The bank held back the river.",
      }],
      synonyms: [],
    };
    const sense = fallbackDetail.senses[0]!;
    const expectedId = dictionarySenseId(record(), fallbackDetail, sense, "dictionaryapi");
    const eligible = eligibleFactualSenses(record(), [{
      provider: "dictionaryapi",
      returnedLemma: "bank",
      requestedPartOfSpeech: "noun",
      detail: fallbackDetail,
      source: dictionarySource,
    }]);
    const imported = importDictionaryDetail(record(), fallbackDetail, dictionarySource);

    expect(eligible.map((candidate) => candidate.id)).toEqual([expectedId]);
    expect(imported.record.senses[1]?.id).toBe(expectedId);
  });
});
