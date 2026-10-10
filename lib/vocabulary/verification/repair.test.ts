import { expect, test } from "vitest";
import { vocabularyRecordFixture } from "../test-fixtures";
import type { FactualDictionaryEvidence, SourcedExampleEvidence } from "./provider-types";
import { dictionarySenseId } from "../enrichment/dictionary-import";
import { applyFactualRepair, needsFactualRepair, repairOrder } from "./repair";

const evidence: FactualDictionaryEvidence = {
  provider: "wordnet", returnedLemma: "learn", requestedPartOfSpeech: "verb",
  source: { sourceId: "wordnet", url: null, retrievedAt: null, contentHash: "sha256:source" },
  detail: { ipa: null, audioUk: null, audioUs: null, audioAny: null, synonyms: [], senses: [
    { partOfSpeech: "verb", definition: "acquire knowledge", example: "We learn by doing.", sourceSenseId: "verb:123" },
    { partOfSpeech: "verb", definition: "find out", example: null, sourceSenseId: "verb:456" },
  ] },
};
const example: SourcedExampleEvidence = {
  id: "tatoeba:42", text: "We learn the truth tomorrow.", language: "eng",
  source: { sourceId: "tatoeba", url: "https://tatoeba.org/en/sentences/show/42", externalId: "42", retrievedAt: null, contentHash: "sha256:42" },
};

test("repairs factual senses without publishing an unverified relationship", () => {
  const r = vocabularyRecordFixture();
  r.publicationStatus = "hidden"; r.tier = "advanced";
  r.senses[0]!.sources = [{ ...r.sources[0]!, sourceId: "llm" }];
  r.connections[0]!.status = "unreviewed";
  const result = applyFactualRepair(r, [evidence], null);
  expect(result.publicationStatus).toBe("published");
  expect(result.senses[0]).toMatchObject({ definition: "acquire knowledge", status: "published" });
  expect(result.senses.find(s => s.id === r.senses[0]!.id)?.status).toBe("hidden");
  expect(result.connections).toEqual(r.connections);
  expect(applyFactualRepair(result, [evidence], null)).toEqual(result);
});

test("selects only an exact supplied sense and sourced, whole-word example", () => {
  const r = vocabularyRecordFixture();
  const id = dictionarySenseId(r, evidence.detail, evidence.detail.senses[1]!, "wordnet");
  const result = applyFactualRepair(r, [evidence], { senseId: id, example });
  expect(result.senses.find(s => s.id === id)).toMatchObject({ status: "published", examples: [{ text: example.text, sources: [example.source] }] });
  expect(() => applyFactualRepair(r, [evidence], { senseId: "invented", example })).toThrow();
  expect(() => applyFactualRepair(r, [evidence], { senseId: id, example: { ...example, text: "Unlearn bad habits." } })).toThrow();
  expect(() => applyFactualRepair(r, [{ ...evidence, returnedLemma: "teach" }], null)).toThrow();
});

test("keeps incomplete core entries searchable but does not claim readiness", () => {
  const r = vocabularyRecordFixture();
  r.senses[0]!.examples = [];
  expect(needsFactualRepair(r)).toBe(true);
  const result = applyFactualRepair(r, [], null);
  expect(result.publicationStatus).toBe("published");
  expect(result.senses[0]!.status).toBe("review");
});

test("does not count a different word embedded inside a sentence as evidence", () => {
  const r = vocabularyRecordFixture();
  r.lemma = "non"; r.forms = ["non"];
  r.senses[0]!.examples[0]!.text = "None of us knew.";
  expect(needsFactualRepair(r)).toBe(true);
});

test("orders core lists before hidden vocabulary and NGSL by list-specific SFI", () => {
  const a = vocabularyRecordFixture();
  const b = { ...a, lemma: "b", lists: [{ id: "ngsl", rank: 2, sfi: 80 }] };
  const c = { ...a, lemma: "c", lists: [{ id: "academic", rank: 1, sfi: 90 }] };
  const d = { ...a, lemma: "d", tier: "advanced" as const };
  expect([c, a, d, b].sort(repairOrder).map(r => r.lemma)).toEqual(["b", "learn", "c", "d"]);
});
