import { describe, expect, test } from "vitest";

import { RelationshipDecisionSchema, SenseSelectionDecisionSchema } from "./decision-schema";

describe("finite verification decision schemas", () => {
  test("accepts only a selected finite sense and optional finite example reference", () => {
    expect(SenseSelectionDecisionSchema.parse({
      decision: "selected",
      senseId: "source-abc",
      exampleId: "tatoeba:42",
    })).toEqual({ decision: "selected", senseId: "source-abc", exampleId: "tatoeba:42" });
  });

  test("accepts an explicit ambiguity without IDs", () => {
    expect(SenseSelectionDecisionSchema.parse({
      decision: "ambiguous",
      senseId: null,
      exampleId: null,
    })).toEqual({ decision: "ambiguous", senseId: null, exampleId: null });
  });

  test("rejects factual content and status fields the model must not author", () => {
    for (const key of ["definition", "example", "sourceId", "status", "gloss", "target"]) {
      expect(SenseSelectionDecisionSchema.safeParse({
        decision: "selected",
        senseId: "source-abc",
        exampleId: null,
        [key]: "invented content",
      }).success).toBe(false);
    }
  });

  test("rejects extra relationship content", () => {
    expect(RelationshipDecisionSchema.parse({
      decision: "supported",
      candidateSenseId: "source-abc",
      coreLemma: "learn",
    })).toEqual({ decision: "supported", candidateSenseId: "source-abc", coreLemma: "learn" });
    expect(RelationshipDecisionSchema.safeParse({
      decision: "supported",
      candidateSenseId: "source-abc",
      coreLemma: "learn",
      definition: "invented content",
    }).success).toBe(false);
  });
});
