import type { VocabularyRecord } from "./schema";

export function vocabularyRecordFixture(): VocabularyRecord {
  return {
    schemaVersion: 1,
    lemma: "learn",
    display: "learn",
    tier: "core",
    partOfSpeech: "verb",
    forms: ["learned", "learning"],
    lists: [{ id: "ngsl", rank: 42, sfi: 58.4 }],
    status: "verified",
    publicationStatus: "published",
    sources: [{
      sourceId: "fixture-dictionary",
      externalId: "learn",
      url: "https://example.com/learn",
      retrievedAt: "2026-01-01T00:00:00.000Z",
      contentHash: "sha256:fixture-learn",
    }],
    senses: [{
      id: "learn-verb-1",
      partOfSpeech: "verb",
      definition: "to gain knowledge or skill through study or experience",
      labels: [],
      sources: [{
        sourceId: "fixture-dictionary",
        externalId: "learn-verb-1",
        url: "https://example.com/learn#verb-1",
        retrievedAt: "2026-01-01T00:00:00.000Z",
        contentHash: "sha256:fixture-learn-sense",
      }],
      examples: [{
        text: "Children learn quickly when they are curious.",
        sources: [{
          sourceId: "fixture-example",
          externalId: "learn-example-1",
          url: "https://example.com/examples/learn-1",
          retrievedAt: "2026-01-01T00:00:00.000Z",
          contentHash: "sha256:fixture-learn-example",
        }],
      }],
      usagePatterns: [],
      collocations: [],
      commonMistakes: [],
      status: "published",
    }],
    pronunciation: [{
      ipa: "/lɜːn/",
      region: "uk",
      audioUrl: "https://example.com/audio/learn-uk.mp3",
      sources: [{
        sourceId: "fixture-dictionary",
        externalId: "learn-pronunciation-uk",
        url: "https://example.com/learn#pronunciation",
        retrievedAt: "2026-01-01T00:00:00.000Z",
        contentHash: "sha256:fixture-learn-pronunciation",
      }],
    }],
    usageNote: null,
    connections: [{
      target: "study",
      type: "synonym",
      gloss: "Both words describe gaining knowledge; study emphasizes the activity.",
      sources: [{
        sourceId: "fixture-dictionary",
        externalId: "learn-study",
        url: "https://example.com/learn#related",
        retrievedAt: "2026-01-01T00:00:00.000Z",
        contentHash: "sha256:fixture-learn-study",
      }],
      status: "published",
    }],
    domains: ["education"],
    chart: "learning",
    region: "education",
  };
}
