import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWordDetail } from "./word-detail";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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
  it("bounds the optional live dictionary request so canonical meanings cannot hang indefinitely", async () => {
    const controller = new AbortController();
    const deadline = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    let usedSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
      usedSignal = options?.signal;
      options?.signal?.addEventListener("abort", () => reject(new Error("timeout")));
    })));
    const pending = fetchWordDetail("who");
    expect(usedSignal).toBe(controller.signal);
    expect(deadline).toHaveBeenCalledWith(3000);
    controller.abort();
    await expect(pending).resolves.toMatchObject({ senses: [], ipa: null });
  });

  it("keeps provenance attached to the response entry that supplied each sense", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          word: "bank",
          sourceUrls: ["https://dictionaryapi.dev/entries/bank-noun"],
          meanings: [{ partOfSpeech: "noun", definitions: [{ definition: "A financial institution." }] }],
        },
        {
          word: "bank",
          sourceUrls: ["https://dictionaryapi.dev/entries/bank-verb"],
          meanings: [{ partOfSpeech: "verb", definitions: [{ definition: "To tilt an aircraft." }] }],
        },
      ],
    }));

    const result = await fetchWordDetail("bank");

    expect(result).not.toHaveProperty("sourceEntryId");
    expect(result.senses).toEqual([
      expect.objectContaining({
        definition: "A financial institution.",
        sourceEntryId: "bank",
        sourceUrl: "https://dictionaryapi.dev/entries/bank-noun",
      }),
      expect.objectContaining({
        definition: "To tilt an aircraft.",
        sourceEntryId: "bank",
        sourceUrl: "https://dictionaryapi.dev/entries/bank-verb",
      }),
    ]);
  });
});
