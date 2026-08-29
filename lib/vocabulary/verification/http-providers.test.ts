import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  ProviderFetchError,
  fetchDictionaryEvidence,
  fetchTatoebaExamples,
} from "./http-providers";

const fixedNow = () => new Date("2026-08-24T00:00:00.000Z");

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchDictionaryEvidence", () => {
  test("retains returned lemma, exact POS, and entry provenance", async () => {
    const calls: string[] = [];
    const evidence = await fetchDictionaryEvidence("manifest plan", "verb", {
      fetch: async (input) => {
        calls.push(String(input));
        return jsonResponse([{
          word: "manifest plan",
          sourceUrls: ["https://dictionary.example/manifest-plan"],
          phonetic: "/ˈmæn.ɪ.fest/",
          meanings: [{
            partOfSpeech: "verb",
            synonyms: ["demonstrate"],
            definitions: [{
              definition: "Show a plan plainly.",
              example: "The figures manifest the plan.",
            }],
          }, {
            partOfSpeech: "noun",
            definitions: [{ definition: "A written plan." }],
          }],
        }]);
      },
      now: fixedNow,
    });

    expect(calls).toEqual([
      "https://api.dictionaryapi.dev/api/v2/entries/en/manifest%20plan",
    ]);
    expect(evidence).toMatchObject({
      provider: "dictionaryapi",
      returnedLemma: "manifest plan",
      requestedPartOfSpeech: "verb",
      detail: {
        sourceEntryId: "manifest plan",
        sourceUrl: "https://dictionary.example/manifest-plan",
        ipa: "/ˈmæn.ɪ.fest/",
        senses: [{
          partOfSpeech: "verb",
          definition: "Show a plan plainly.",
          example: "The figures manifest the plan.",
          sourceEntryId: "manifest plan",
          sourceUrl: "https://dictionary.example/manifest-plan",
        }],
      },
      source: {
        sourceId: "dictionaryapi",
        url: "https://api.dictionaryapi.dev/api/v2/entries/en/manifest%20plan",
        retrievedAt: "2026-08-24T00:00:00.000Z",
      },
    });
    expect(evidence?.source.contentHash).toBe(`sha256:${createHash("sha256")
      .update(JSON.stringify({
        returnedLemma: "manifest plan",
        requestedPartOfSpeech: "verb",
        detail: evidence?.detail,
      }), "utf8")
      .digest("hex")}`);
  });

  test("returns null for a DictionaryAPI 404", async () => {
    const evidence = await fetchDictionaryEvidence("missing", "noun", {
      fetch: async () => jsonResponse({ title: "No Definitions Found" }, 404),
      now: fixedNow,
    });

    expect(evidence).toBeNull();
  });

  test("retries 429 and 5xx responses no more than twice without surfacing bodies", async () => {
    let calls = 0;

    await expect(fetchDictionaryEvidence("manifest", "verb", {
      fetch: async () => {
        calls += 1;
        return jsonResponse({ secret: "provider response body" }, calls === 1 ? 429 : 503);
      },
      now: fixedNow,
    })).rejects.toMatchObject({
      name: "ProviderFetchError",
      provider: "dictionaryapi",
      kind: "http",
      status: 503,
    } satisfies Partial<ProviderFetchError>);
    expect(calls).toBe(2);

    await expect(fetchDictionaryEvidence("manifest", "verb", {
      fetch: async () => jsonResponse({ secret: "provider response body" }, 503),
      now: fixedNow,
    })).rejects.not.toThrow("provider response body");
  });

  test("turns a timeout into a typed provider failure after two attempts", async () => {
    let calls = 0;

    await expect(fetchDictionaryEvidence("manifest", "verb", {
      fetch: async () => {
        calls += 1;
        const error = new Error("request timeout");
        error.name = "TimeoutError";
        throw error;
      },
      now: fixedNow,
    })).rejects.toMatchObject({
      name: "ProviderFetchError",
      provider: "dictionaryapi",
      kind: "timeout",
    } satisfies Partial<ProviderFetchError>);
    expect(calls).toBe(2);
  });
});

describe("fetchTatoebaExamples", () => {
  test("normalizes valid English v1 sentences with learner attribution URLs", async () => {
    const calls: string[] = [];
    const result = await fetchTatoebaExamples("obtain", ["obtain", "obtained"], {
      fetch: async (input) => {
        calls.push(String(input));
        return jsonResponse({
          data: [{ id: 8842, text: "She obtained permission to enter.", lang: "eng" }],
          paging: {},
        });
      },
      now: fixedNow,
    });

    expect(calls).toEqual([
      "https://api.tatoeba.org/v1/sentences?lang=eng&q=obtain&sort=relevance",
    ]);
    expect(result).toEqual([{
      id: "tatoeba:8842",
      text: "She obtained permission to enter.",
      language: "eng",
      source: {
        sourceId: "tatoeba",
        externalId: "8842",
        url: "https://tatoeba.org/en/sentences/show/8842",
        retrievedAt: "2026-08-24T00:00:00.000Z",
        contentHash: `sha256:${createHash("sha256")
          .update(JSON.stringify({ id: "8842", text: "She obtained permission to enter.", language: "eng" }), "utf8")
          .digest("hex")}`,
      },
    }]);
  });

  test("rejects non-English, duplicate, blank, and substring-only v1 sentences", async () => {
    const result = await fetchTatoebaExamples("train", ["train"], {
      fetch: async () => jsonResponse({
        data: [
          { id: 1, text: "Training starts tomorrow.", lang: "eng" },
          { id: 2, text: "The train leaves at noon.", lang: "eng" },
          { id: 2, text: "The train leaves at noon.", lang: "eng" },
          { id: 3, text: "Le train part à midi.", lang: "fra" },
          { id: 4, text: "   ", lang: "eng" },
        ],
        paging: {},
      }),
      now: fixedNow,
    });

    expect(result.map((example) => example.id)).toEqual(["tatoeba:2"]);
  });
});
