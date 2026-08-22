import { describe, expect, it } from "vitest";

import { senseIdFor } from "./sense-id";

const input = {
  lemma: "Bank",
  sourceId: "dictionaryapi",
  externalId: "bank.n.01",
  partOfSpeech: "Noun",
  definition: "A financial institution that accepts deposits.",
};

describe("senseIdFor", () => {
  it("returns the same ID when identity text differs only by case or whitespace", () => {
    expect(senseIdFor(input)).toBe(senseIdFor({
      ...input,
      lemma: " bank ",
      partOfSpeech: " noun ",
      definition: "  a FINANCIAL  institution that accepts deposits. ",
    }));
  });

  it("keeps different external source senses separate", () => {
    expect(senseIdFor(input)).not.toBe(senseIdFor({ ...input, externalId: "bank.n.02" }));
  });
});
