import { describe, expect, it } from "vitest";

import { decodeFullGalaxy, encodeFullGalaxy, type FullGalaxyData } from "./full-codec";

describe("full galaxy codec", () => {
  it("round-trips metadata and typed values", () => {
    const bytes = encodeFullGalaxy({
      version: "abc123",
      listSlug: "ngsl",
      words: [{ lemma: "speak", display: "speak", chartId: "speech", partOfSpeech: "verb" }],
      positions: new Float32Array([1.25, -2.5, 3.75]),
      tiers: new Uint8Array([0]),
      ranks: new Int32Array([10]),
      degrees: new Uint16Array([7]),
    });
    const decoded = decodeFullGalaxy(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(decoded.version).toBe("abc123");
    expect(decoded.words[0]).toEqual({ lemma: "speak", display: "speak", chartId: "speech", partOfSpeech: "verb" });
    expect([...decoded.positions]).toEqual([1.25, -2.5, 3.75]);
    expect([...decoded.ranks]).toEqual([10]);
  });

  it("rejects bad magic and truncated payloads", () => {
    expect(() => decodeFullGalaxy(new Uint8Array([0, 1, 2, 3]).buffer)).toThrow(/full galaxy/i);
  });

  it("rejects malformed word metadata", () => {
    expect(() => encodeFullGalaxy({
      version: "abc123",
      listSlug: "ngsl",
      words: [null] as unknown as FullGalaxyData["words"],
      positions: new Float32Array([1.25, -2.5, 3.75]),
      tiers: new Uint8Array([0]),
      ranks: new Int32Array([10]),
      degrees: new Uint16Array([7]),
    })).toThrow(/full galaxy/i);
  });
});
