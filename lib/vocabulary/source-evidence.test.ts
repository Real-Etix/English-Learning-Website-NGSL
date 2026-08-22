import { describe, expect, it } from "vitest";

import {
  evidenceForSources,
  isFactualSourceId,
  sourceEntryFor,
  sourcePrecedenceFor,
} from "./source-evidence";

const sourceRef = (sourceId: string) => ({
  sourceId,
  externalId: null,
  url: null,
  retrievedAt: null,
  contentHash: null,
});

describe("source evidence", () => {
  it("uses the registered factual providers and keeps llm non-factual", () => {
    expect(sourceEntryFor("curated")).toMatchObject({ factual: true, license: "Project-authored content" });
    expect(sourceEntryFor("wordnet")).toMatchObject({ factual: true, license: "WordNet License" });
    expect(sourceEntryFor("dictionaryapi")).toMatchObject({ factual: true, license: "Free public API" });
    expect(sourceEntryFor("tatoeba")).toMatchObject({ factual: true, license: "CC BY 2.0 FR / CC0 1.0" });
    expect(isFactualSourceId("llm")).toBe(false);
  });

  it("rejects an unregistered source ID", () => {
    expect(() => sourceEntryFor("unknown-source")).toThrow("Unknown vocabulary source ID: unknown-source");
  });

  it("ranks curated content above factual imports and LLM drafts", () => {
    expect(sourcePrecedenceFor("curated")).toBeGreaterThan(sourcePrecedenceFor("dictionaryapi"));
    expect(sourcePrecedenceFor("dictionaryapi")).toBeGreaterThan(sourcePrecedenceFor("llm"));
  });

  it("classifies verified factual content, factual imports, and LLM drafts", () => {
    expect(evidenceForSources([sourceRef("curated")], { verified: true })).toBe("verified");
    expect(evidenceForSources([sourceRef("dictionaryapi")], { verified: false })).toBe("source-backed");
    expect(evidenceForSources([sourceRef("llm")], { verified: true })).toBe("ai-draft");
  });

  it("preserves an explicit verified audit status only when callers opt in", () => {
    expect(evidenceForSources([], {
      verified: true,
      allowVerifiedWithoutFactualSource: true,
    })).toBe("verified");
    expect(evidenceForSources([], { verified: true })).toBe("ai-draft");
  });

  it("never treats a verified LLM-only record as factual", () => {
    expect(evidenceForSources([sourceRef("llm")], {
      verified: true,
      allowVerifiedWithoutFactualSource: true,
    })).toBe("ai-draft");
  });
});
