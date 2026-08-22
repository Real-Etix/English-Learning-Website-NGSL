import { describe, expect, it } from "vitest";
import { normalizeVocabularyLemma, shardIdForLemma } from "./shards";

describe("stable vocabulary shards", () => {
  it("normalizes and assigns stable SHA-256 shards", () => {
    expect(normalizeVocabularyLemma("  Bank  ")).toBe("bank");
    expect(shardIdForLemma("bank")).toBe("03");
    expect(shardIdForLemma("get")).toBe("09");
    expect(shardIdForLemma("academic")).toBe("18");
  });
});
