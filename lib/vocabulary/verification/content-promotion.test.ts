import { expect, test } from "vitest";

import type { VocabularyRecord } from "../schema";
import { vocabularyRecordFixture } from "../test-fixtures";
import { promoteRelationshipVerifiedContent } from "./content-promotion";

function hiddenAdvanced(lemma: string, sourceSenseCount = 1): VocabularyRecord {
  const fixture = vocabularyRecordFixture();
  const factual = Array.from({ length: sourceSenseCount }, (_, index) => ({
    ...fixture.senses[0]!,
    id: `${lemma}-source-${index}`,
    definition: `Factual meaning ${index}.`,
    status: "review" as const,
  }));
  return {
    ...fixture,
    lemma,
    display: lemma,
    tier: "advanced",
    status: "enriched",
    publicationStatus: "hidden",
    verificationStatus: "ambiguous",
    senses: [{
      ...fixture.senses[0]!,
      id: `${lemma}-legacy`,
      sources: [{ ...fixture.sources[0]!, sourceId: "llm" }],
      examples: [],
      status: "published",
    }, ...factual],
    connections: [{
      ...fixture.connections[0]!,
      target: "learn",
      type: "builds_on",
      status: "unreviewed",
    }],
  };
}

test("promotes one exact cached factual sense while leaving ambiguous edges unreviewed", () => {
  const candidate = hiddenAdvanced("discern", 2);
  const original = JSON.stringify(candidate);
  const result = promoteRelationshipVerifiedContent(
    [candidate],
    new Map([["discern", "relationship_ambiguous"]]),
    new Map([["discern", new Set(["discern-source-1"])]]),
  );

  expect(JSON.stringify(candidate)).toBe(original);
  expect(result.unresolved).toEqual([]);
  expect(result.snapshot[0]).toMatchObject({
    publicationStatus: "published",
    verificationStatus: "published",
    relationshipVerificationStatus: "ambiguous",
  });
  expect(result.snapshot[0]!.senses.map(({ id, status }) => ({ id, status }))).toEqual([
    { id: "discern-legacy", status: "hidden" },
    { id: "discern-source-0", status: "review" },
    { id: "discern-source-1", status: "published" },
  ]);
  expect(result.snapshot[0]!.connections[0]!.status).toBe("unreviewed");
});

test("hides unsupported reciprocal edges without hiding the independently valid word", () => {
  const fixture = vocabularyRecordFixture();
  const core = {
    ...fixture,
    connections: [{
      ...fixture.connections[0]!,
      target: "scuff",
      type: "advanced_form" as const,
      status: "unreviewed" as const,
    }],
  };
  const candidate = hiddenAdvanced("scuff");
  const result = promoteRelationshipVerifiedContent(
    [core, candidate],
    new Map([["scuff", "relationship_unsupported"]]),
    new Map(),
  );

  expect(result.snapshot.find((record) => record.lemma === "scuff")).toMatchObject({
    publicationStatus: "published",
    relationshipVerificationStatus: "unsupported",
    connections: [expect.objectContaining({ status: "hidden" })],
  });
  expect(result.snapshot.find((record) => record.lemma === "learn")?.connections[0])
    .toMatchObject({ target: "scuff", status: "hidden" });
});

test("refuses to guess when multiple ready senses have no recovered selection", () => {
  const result = promoteRelationshipVerifiedContent(
    [hiddenAdvanced("opaque", 2)],
    new Map([["opaque", "relationship_ambiguous"]]),
    new Map(),
  );

  expect(result.promoted).toEqual([]);
  expect(result.updates).toEqual([]);
  expect(result.unresolved).toEqual([{ lemma: "opaque", reason: "no_exact_sense" }]);
});
