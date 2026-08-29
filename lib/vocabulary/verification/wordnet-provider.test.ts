import { describe, expect, test } from "vitest";

import { lookupWordNetEvidence } from "./wordnet-provider";

type WordNetSynset = {
  synsetOffset: string;
  pos: string;
  lemma: string;
  synonyms: string[];
  def: string;
  exp: string[];
};

function fakeWordNet(results: Partial<Record<"noun" | "verb" | "adjective" | "adverb", WordNetSynset[]>>) {
  const lookup = (partOfSpeech: "noun" | "verb" | "adjective" | "adverb") => async () =>
    results[partOfSpeech] ?? [];

  return {
    lookupNoun: lookup("noun"),
    lookupVerb: lookup("verb"),
    lookupAdjective: lookup("adjective"),
    lookupAdverb: lookup("adverb"),
    seek: async () => null,
  };
}

describe("lookupWordNetEvidence", () => {
  test("returns only exact-POS synsets with stable provenance IDs", async () => {
    const evidence = await lookupWordNetEvidence("manifest", "verb", {
      lookup: fakeWordNet({
        verb: [{
          synsetOffset: "12345",
          pos: "v",
          lemma: "manifest",
          synonyms: ["manifest", "demonstrate"],
          def: "show plainly",
          exp: ["Her skill manifests in every project."],
        }],
      }),
      retrievedAt: null,
    });

    expect(evidence).toMatchObject({
      provider: "wordnet",
      returnedLemma: "manifest",
      requestedPartOfSpeech: "verb",
      detail: {
        sourceEntryId: "verb:12345",
        senses: [{
          partOfSpeech: "verb",
          sourceEntryId: "verb:12345",
          sourceSenseId: "verb:12345",
        }],
      },
      source: { sourceId: "wordnet" },
    });
  });

  test("binds a synonym lookup to the requested lemma and ignores unrelated synsets", async () => {
    const evidence = await lookupWordNetEvidence("manifest", "verb", {
      lookup: fakeWordNet({
        verb: [{
          synsetOffset: "12345",
          pos: "v",
          lemma: "attest",
          synonyms: ["attest", "certify", "manifest"],
          def: "provide evidence for",
          exp: ["The results manifest a clear improvement."],
        }, {
          synsetOffset: "67890",
          pos: "v",
          lemma: "unrelated",
          synonyms: ["unrelated", "detach"],
          def: "not evidence for the requested lemma",
          exp: [],
        }],
      }),
      retrievedAt: null,
    });

    expect(evidence).toMatchObject({
      returnedLemma: "manifest",
      detail: {
        sourceEntryId: "verb:12345",
        senses: [{ definition: "provide evidence for" }],
      },
    });
    expect(evidence?.detail.senses).toHaveLength(1);
  });

  test("rejects noun-only evidence for a verb candidate", async () => {
    const evidence = await lookupWordNetEvidence("manifest", "verb", {
      lookup: fakeWordNet({
        noun: [{
          synsetOffset: "98",
          pos: "n",
          lemma: "manifest",
          synonyms: ["manifest"],
          def: "a list of cargo",
          exp: ["The manifest listed every crate."],
        }],
      }),
      retrievedAt: null,
    });

    expect(evidence).toBeNull();
  });

  test("rejects a noun-coded synset returned by the verb lookup", async () => {
    const evidence = await lookupWordNetEvidence("manifest", "verb", {
      lookup: fakeWordNet({
        verb: [{
          synsetOffset: "98",
          pos: "n",
          lemma: "manifest",
          synonyms: ["manifest"],
          def: "a list of cargo",
          exp: ["The manifest listed every crate."],
        }],
      }),
      retrievedAt: null,
    });

    expect(evidence).toBeNull();
  });

  test("normalizes underscore lemmas and omits examples without a complete candidate token", async () => {
    const evidence = await lookupWordNetEvidence("take off", "verb", {
      lookup: fakeWordNet({
        verb: [{
          synsetOffset: "12",
          pos: "v",
          lemma: "take_off",
          synonyms: ["take_off", "depart"],
          def: "leave the ground",
          exp: ["The plane will take off at dawn.", "The takeover continued."],
        }, {
          synsetOffset: "13",
          pos: "v",
          lemma: "take_off",
          synonyms: ["take_off"],
          def: "become successful",
          exp: ["The takeover surprised investors."],
        }],
      }),
      retrievedAt: "2026-08-24T00:00:00.000Z",
    });

    expect(evidence).toMatchObject({
      returnedLemma: "take off",
      detail: {
        synonyms: ["take off", "depart"],
        senses: [{ example: "The plane will take off at dawn." }, { example: null }],
      },
      source: { retrievedAt: "2026-08-24T00:00:00.000Z" },
    });
  });

  test("returns null for an unsupported part of speech", async () => {
    const evidence = await lookupWordNetEvidence("manifest", "preposition", {
      lookup: fakeWordNet({}),
      retrievedAt: null,
    });

    expect(evidence).toBeNull();
  });
});
