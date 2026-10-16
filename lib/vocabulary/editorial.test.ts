import { describe, expect, it } from "vitest";
import { VocabularyRecordSchema } from "./schema";
import { vocabularyRecordFixture } from "./test-fixtures";
import { isWordPublic } from "./publication";
import { toPublicGraphInputs } from "./graph-input";
import { buildListGraph } from "./graph";
import * as editorial from "./editorial";

const advanced = () => ({ ...vocabularyRecordFixture(), lemma: "foodprocessor", display: "foodprocessor", tier: "advanced" as const, lists: [] });
const correction = { headword: { value: "food processor", evidenceUrl: "https://en-word.net/lemma/food%20processor", reason: "Dictionary confirms the spaced compound." } };
const fitnessScope = { status: "included" as const, lists: ["fitness" as const], reason: "Exercise anatomy only.", reviewedAt: "2026-10-16T00:00:00.000Z" };

describe("reviewed vocabulary editorial decisions", () => {
  it("repairs a display and lookup form without changing stable identity or source prose", () => {
    const original = advanced();
    const repaired = editorial.applyEditorialDecision(original, correction, [original]);
    expect(repaired.lemma).toBe(original.lemma);
    expect(repaired.display).toBe("food processor");
    expect(repaired.forms).toContain("food processor");
    expect(repaired.senses).toEqual(original.senses);
    expect(repaired.connections).toEqual(original.connections);
    expect(editorial.dictionaryHeadword(repaired)).toBe("food processor");
    expect(editorial.applyEditorialDecision(repaired, correction, [repaired])).toEqual(repaired);
  });

  it("restores accented characters rather than stripping or replacing them", () => {
    const original = { ...advanced(), lemma: "doppelgnger" };
    const repaired = editorial.applyEditorialDecision(original, { headword: { ...correction.headword, value: "doppelga\u0308nger" } }, [original]);
    expect(repaired.display).toBe("doppelgänger");
    expect(editorial.dictionaryHeadword(repaired)).toBe("doppelgänger");
  });

  it("rejects core mutations, unrelated renames and existing-headword collisions", () => {
    const original = advanced();
    expect(() => editorial.applyEditorialDecision(vocabularyRecordFixture(), correction, [])).toThrow(/core/i);
    expect(() => editorial.applyEditorialDecision(original, { headword: { ...correction.headword, value: "blender" } }, [])).toThrow(/identity/i);
    expect(() => editorial.applyEditorialDecision(original, correction, [original, { ...advanced(), lemma: "food processor", display: "food processor" }])).toThrow(/collision/i);
  });

  it("makes archiving recoverable and fail-closed even if publication is later changed", () => {
    const original = advanced();
    const archived = editorial.applyEditorialDecision(original, { scope: { ...fitnessScope, status: "archived", lists: [], reason: "Not useful for any of the five learning lists." } }, [original]);
    expect(archived.senses).toEqual(original.senses);
    expect(archived.publicationStatus).toBe("hidden");
    expect(isWordPublic({ ...archived, publicationStatus: "published" })).toBe(false);
    expect(VocabularyRecordSchema.safeParse({ ...archived, tier: "core" }).success).toBe(false);
    expect(VocabularyRecordSchema.safeParse({ ...archived, editorial: { scope: { ...fitnessScope, status: "archived" } } }).success).toBe(false);
  });

  it("permits reviewed hyphen variants without changing letters or stable IDs", () => {
    for (const [lemma, value] of [["pressup", "press-up"], ["macro-economist", "macroeconomist"], ["house-made", "housemade"]]) {
      const original = { ...advanced(), lemma, display: lemma };
      const decision = { headword: { ...correction.headword, value } };
      const next = editorial.applyEditorialDecision(original, decision, [original]);
      expect(next.lemma).toBe(lemma);
      expect(next.display).toBe(value);
      expect(next.senses).toEqual(original.senses);
      expect(editorial.applyEditorialDecision(next, decision, [next])).toEqual(next);
    }
    expect(() => editorial.applyEditorialDecision({ ...advanced(), lemma: "pressup" }, { headword: { ...correction.headword, value: "push-up" } }, [])).toThrow(/identity/i);
  });

  it("rejects accent and punctuation-equivalent collisions instead of silently duplicating", () => {
    const original = { ...advanced(), lemma: "derrire", display: "derrire" };
    expect(() => editorial.applyEditorialDecision(original, { headword: { ...correction.headword, value: "derrière" } }, [original, { ...advanced(), lemma: "derriere", display: "derriere" }])).toThrow(/collision/i);
    const press = { ...advanced(), lemma: "pressup", display: "pressup" };
    expect(() => editorial.applyEditorialDecision(press, { headword: { ...correction.headword, value: "press-up" } }, [press, { ...advanced(), lemma: "press-up", display: "press-up" }])).toThrow(/collision/i);
  });

  it("keeps a Fitness extension out of Business without altering official memberships", () => {
    const original = advanced();
    const scoped = editorial.applyEditorialDecision(original, { scope: fitnessScope }, [original]);
    const anchor = { ...vocabularyRecordFixture(), lists: [{ id: "business", rank: 1, sfi: 60 }, { id: "fitness", rank: 1, sfi: 60 }], connections: [{ ...vocabularyRecordFixture().connections[0]!, target: scoped.lemma }] };
    const inputs = toPublicGraphInputs([anchor, scoped]);
    expect(buildListGraph(inputs, "business").nodes.map(n => n.lemma)).not.toContain(scoped.lemma);
    expect(buildListGraph(inputs, "fitness").nodes.map(n => n.lemma)).toContain(scoped.lemma);
    expect(buildListGraph(inputs, "all").nodes.map(n => n.lemma)).toContain(scoped.lemma);
    expect(scoped.lists).toEqual(original.lists);
  });
});
