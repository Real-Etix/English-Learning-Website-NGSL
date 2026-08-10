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

  it("rejects bad magic", () => {
    const bytes = encodeFullGalaxy({
      version: "abc123",
      listSlug: "ngsl",
      words: [],
      positions: new Float32Array(),
      tiers: new Uint8Array(),
      ranks: new Int32Array(),
      degrees: new Uint16Array(),
    });
    bytes[0] = 0;

    expect(() => decodeFullGalaxy(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toThrow(/full galaxy/i);
  });

  it("rejects truncation of a valid SAT1 payload", () => {
    const bytes = encodeFullGalaxy({
      version: "abc123",
      listSlug: "ngsl",
      words: [{ lemma: "speak", display: "speak", chartId: "speech", partOfSpeech: "verb" }],
      positions: new Float32Array([1.25, -2.5, 3.75]),
      tiers: new Uint8Array([0]),
      ranks: new Int32Array([10]),
      degrees: new Uint16Array([7]),
    });
    const truncated = bytes.slice(0, -1);

    expect(() => decodeFullGalaxy(truncated.buffer.slice(truncated.byteOffset, truncated.byteOffset + truncated.byteLength))).toThrow(/full galaxy/i);
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
