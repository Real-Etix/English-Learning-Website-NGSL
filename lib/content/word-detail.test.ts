import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWordDetail } from "./word-detail";

afterEach(() => vi.unstubAllGlobals());

describe("fetchWordDetail", () => {
  it("keeps dictionary entry and pronunciation provenance for later import", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{
        word: "bank",
        sourceUrls: ["https://dictionaryapi.dev/entries/bank"],
        phonetic: "/bæŋk/",
        phonetics: [{ text: "/bæŋk/", audio: "https://audio.example/bank-uk.mp3" }],
        meanings: [{
          partOfSpeech: "noun",
          definitions: [{ definition: "A financial institution.", example: "The bank is open." }],
        }],
      }],
    }));

    await expect(fetchWordDetail("bank")).resolves.toMatchObject({
      sourceEntryId: "bank",
      sourceUrl: "https://dictionaryapi.dev/entries/bank",
      pronunciationSources: {
        ipa: { entryId: "bank", url: "https://dictionaryapi.dev/entries/bank" },
        audioAny: { entryId: "bank", url: "https://dictionaryapi.dev/entries/bank" },
      },
      senses: [{
        sourceEntryId: "bank",
        sourceUrl: "https://dictionaryapi.dev/entries/bank",
        definition: "A financial institution.",
      }],
    });
  });

  it("returns an explicit empty detail for a remote failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(fetchWordDetail("bank")).resolves.toEqual({
      ipa: null,
      audioUk: null,
      audioUs: null,
      audioAny: null,
      senses: [],
      synonyms: [],
    });
  });
});
