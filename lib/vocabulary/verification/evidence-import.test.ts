import { describe, expect, test } from "vitest";

import type { WordDetail } from "../../content/word-detail";
import { dictionarySenseId } from "../enrichment/dictionary-import";
import type { VocabularyRecord } from "../schema";
import { vocabularyRecordFixture } from "../test-fixtures";
import { importVerificationEvidence } from "./evidence-import";
import type { FactualDictionaryEvidence, SourcedExampleEvidence } from "./provider-types";

function candidate(): VocabularyRecord {
  const fixture = vocabularyRecordFixture();
  return {
    ...fixture,
    lemma: "scrutinise",
    display: "scrutinise",
    tier: "advanced",
    partOfSpeech: "verb",
    forms: ["scrutinises", "scrutinised", "scrutinising"],
    status: "enriched",
    publicationStatus: "hidden",
    sources: [{
      sourceId: "llm",
      externalId: "legacy-scrutinise",
      url: null,
      retrievedAt: "2026-08-20T00:00:00.000Z",
      contentHash: "sha256:legacy-scrutinise",
    }],
    senses: [{
      ...fixture.senses[0]!,
      id: "legacy-scrutinise",
      definition: "An older draft definition.",
      sources: [{
        sourceId: "llm",
        externalId: "legacy-scrutinise",
        url: null,
        retrievedAt: "2026-08-20T00:00:00.000Z",
        contentHash: "sha256:legacy-scrutinise",
      }],
      examples: [],
      status: "published",
    }],
    pronunciation: [],
    connections: [],
  };
}

function detail(
  definition: string,
  example: string | null,
  sourceSenseId: string,
  sourceUrl: string,
): WordDetail {
  return {
    ipa: " /ˈskruː.tɪ.naɪz/ ",
    audioUk: "https://audio.example/scrutinise-uk.mp3",
    audioUs: null,
    audioAny: null,
    sourceEntryId: "scrutinise-entry",
    sourceUrl,
    pronunciationSources: {
      ipa: { entryId: "scrutinise-pronunciation", url: sourceUrl },
      audioUk: { entryId: "scrutinise-audio-uk", url: sourceUrl },
    },
    senses: [{
      partOfSpeech: "verb",
      definition,
      example,
      sourceEntryId: "scrutinise-entry",
      sourceSenseId,
      sourceUrl,
    }],
    synonyms: ["examine"],
  };
}

function evidence(
  provider: FactualDictionaryEvidence["provider"],
  definition: string,
  example: string | null,
  sourceSenseId: string,
): FactualDictionaryEvidence {
  const sourceUrl = `https://${provider}.example/scrutinise#${sourceSenseId}`;
  return {
    provider,
    returnedLemma: "scrutinise",
    requestedPartOfSpeech: "verb",
    detail: detail(definition, example, sourceSenseId, sourceUrl),
    source: {
      sourceId: provider,
      url: sourceUrl,
      retrievedAt: "2026-08-24T12:34:56.000Z",
      contentHash: `sha256:${provider}-${sourceSenseId}`,
    },
  };
}

function tatoeba(id = "314159"): SourcedExampleEvidence {
  return {
    id: `tatoeba:${id}`,
    text: "  She scrutinised the figures before signing.  ",
    language: "eng",
    source: {
      sourceId: "tatoeba",
      externalId: id,
      url: `https://tatoeba.org/en/sentences/show/${id}`,
      retrievedAt: "2026-08-24T13:00:00.000Z",
      contentHash: `sha256:tatoeba-${id}`,
    },
  };
}

describe("importVerificationEvidence", () => {
  test("imports factual provider wording and a selected Tatoeba example idempotently", () => {
    const record = candidate();
    const wordnet = evidence(
      "wordnet",
      "  To examine something very carefully.  ",
      "She scrutinised every clause.",
      "verb:00001740",
    );
    const dictionary = evidence(
      "dictionaryapi",
      "To inspect with close attention.",
      null,
      "scrutinise-api-1",
    );
    const selectedSenseId = dictionarySenseId(
      record,
      dictionary.detail,
      dictionary.detail.senses[0]!,
      dictionary.source.sourceId,
    );
    const selectedExample = tatoeba();

    const first = importVerificationEvidence(
      record,
      [wordnet, dictionary],
      selectedSenseId,
      selectedExample,
    );
    const repeated = importVerificationEvidence(
      first,
      [wordnet, dictionary],
      selectedSenseId,
      selectedExample,
    );

    expect(repeated).toEqual(first);
    expect(record.senses).toHaveLength(1);
    expect(first.senses).toHaveLength(3);

    const selected = first.senses.find((sense) => sense.id === selectedSenseId);
    expect(selected?.definition).toBe("To inspect with close attention.");
    expect(selected?.examples).toContainEqual({
      text: selectedExample.text,
      sources: [selectedExample.source],
    });
    expect(selected?.sources).toEqual([{
      sourceId: "dictionaryapi",
      externalId: "scrutinise-api-1",
      url: "https://dictionaryapi.example/scrutinise#scrutinise-api-1",
      retrievedAt: "2026-08-24T12:34:56.000Z",
      contentHash: "sha256:dictionaryapi-scrutinise-api-1",
    }]);

    const wordnetSense = first.senses.find((sense) =>
      sense.definition === "  To examine something very carefully.  ");
    expect(wordnetSense?.examples).toEqual([{
      text: "She scrutinised every clause.",
      sources: [{
        sourceId: "wordnet",
        externalId: "verb:00001740",
        url: "https://wordnet.example/scrutinise#verb:00001740",
        retrievedAt: "2026-08-24T12:34:56.000Z",
        contentHash: "sha256:wordnet-verb:00001740",
      }],
    }]);
    expect(wordnetSense?.examples).not.toContainEqual(expect.objectContaining({
      text: selectedExample.text,
    }));
    expect(first.pronunciation).toContainEqual({
      ipa: " /ˈskruː.tɪ.naɪz/ ",
      region: "other",
      audioUrl: null,
      sources: [{
        sourceId: "wordnet",
        externalId: "scrutinise-pronunciation",
        url: "https://wordnet.example/scrutinise#verb:00001740",
        retrievedAt: "2026-08-24T12:34:56.000Z",
        contentHash: "sha256:wordnet-verb:00001740",
      }],
    });
  });

  test("deduplicates examples only when exact text and all source fields match", () => {
    const record = candidate();
    const dictionary = evidence(
      "dictionaryapi",
      "To inspect with close attention.",
      null,
      "scrutinise-api-1",
    );
    const selectedSenseId = dictionarySenseId(
      record,
      dictionary.detail,
      dictionary.detail.senses[0]!,
      dictionary.source.sourceId,
    );
    const original = tatoeba("1");
    const sameTextDifferentSource = {
      ...tatoeba("2"),
      text: original.text,
    };

    const withFirst = importVerificationEvidence(record, [dictionary], selectedSenseId, original);
    const withSecondSource = importVerificationEvidence(
      withFirst,
      [dictionary],
      selectedSenseId,
      sameTextDifferentSource,
    );
    const repeated = importVerificationEvidence(
      withSecondSource,
      [dictionary],
      selectedSenseId,
      sameTextDifferentSource,
    );

    expect(withSecondSource.senses.find((sense) => sense.id === selectedSenseId)?.examples)
      .toHaveLength(2);
    expect(repeated).toEqual(withSecondSource);
  });

  test("rejects a selected example without its canonical selected sense", () => {
    expect(() => importVerificationEvidence(candidate(), [], "missing-sense", tatoeba()))
      .toThrow(/selected sense/i);
  });

  test("rejects dictionary evidence for a different lemma or part of speech", () => {
    const factualEvidence = evidence(
      "wordnet",
      "To examine something very carefully.",
      null,
      "verb:00001740",
    );

    expect(() => importVerificationEvidence(candidate(), [{
      ...factualEvidence,
      returnedLemma: "unrelated",
    }], null, null)).toThrow(/lemma/i);
    expect(() => importVerificationEvidence(candidate(), [{
      ...factualEvidence,
      requestedPartOfSpeech: "noun",
    }], null, null)).toThrow(/part of speech/i);
    expect(() => importVerificationEvidence(candidate(), [{
      ...factualEvidence,
      detail: {
        ...factualEvidence.detail,
        senses: [{ ...factualEvidence.detail.senses[0]!, partOfSpeech: "noun" }],
      },
    }], null, null)).toThrow(/part of speech/i);
  });
});
