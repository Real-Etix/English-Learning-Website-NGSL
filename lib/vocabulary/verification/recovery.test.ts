import { expect, test } from "vitest";
import { vocabularyRecordFixture } from "../test-fixtures";
import { applyRecovery, recoveryCandidates, learnerCandidates, approvedRecoveryReview } from "./recovery";

const stamp = "2026-10-13T00:00:00.000Z";
const entry = { word: "who", lang_code: "en", pos: "pron", senses: [
  { glosses: ["Used to ask about a person."], examples: [{ text: "Who called?", type: "example" }] },
] };
test("keeps grammatical senses independent from a record's old noun label", () => {
  const cs = recoveryCandidates("who", [entry], "en", stamp);
  expect(cs).toHaveLength(1);
  expect(cs[0]?.sense).toMatchObject({ partOfSpeech: "pronoun", definition: "Used to ask about a person.", status: "review" });
  expect(cs[0]?.sense.sources[0]).toMatchObject({ sourceId: "wiktionary", license: "CC BY-SA 4.0", url: "https://en.wiktionary.org/wiki/who", attribution: "Wiktionary contributors" });
  const r = { ...vocabularyRecordFixture(), lemma: "who", display: "who", partOfSpeech: "noun" };
  const result = applyRecovery(r, cs, { sense: 0, example: 0 });
  expect(result.senses[0]).toMatchObject({ partOfSpeech: "pronoun", status: "published" });
  expect(result.senses[1]?.status).toBe("published"); // already published history retained
  expect(result.connections).toEqual(r.connections);
  expect(result.lists).toEqual(r.lists);
  expect(applyRecovery(result, cs, { sense: 0, example: 0 })).toEqual(result);
});
test("rejects WHO/May, foreign words, headword mismatches and proper-name entries", () => {
  for (const change of [{ word: "WHO" }, { lang_code: "fr" }, { word: "whom" }, { pos: "name" }]) {
    expect(recoveryCandidates("who", [{ ...entry, ...change }], "en", stamp)).toEqual([]);
  }
  expect(recoveryCandidates("may", [{ ...entry, word: "May" }], "en", stamp)).toEqual([]);
});
test("excludes quotations and ref-bearing text while preserving source examples verbatim", () => {
  const cs = recoveryCandidates("who", [{ ...entry, senses: [{ glosses: ["Person asked about."], examples: [
    { text: "Who called?", type: "quotation", ref: "A book" },
    { text: "Who wrote this?", ref: "Some author" },
    { text: "Who is there?  ", type: "example" },
  ] }] }], "simple", stamp);
  expect(cs[0]?.sense.examples.map(e => e.text)).toEqual(["Who is there?  "]);
  expect(cs[0]?.sense.sources[0]?.url).toBe("https://simple.wiktionary.org/wiki/who");
});
test("uses only source-verified forms, not incidental substring matches", () => {
  const r = { ...entry, word: "collection", pos: "noun", forms: [{ form: "collections", tags: ["plural"] }], senses: [{ glosses: ["A group of things."], examples: [
    { text: "Her collections are large." }, { text: "Recollection is difficult." },
  ] }] };
  expect(recoveryCandidates("collection", [r], "simple", stamp)[0]?.sense.examples).toHaveLength(1);
});
test("abstains on absent or invented indexes and keeps hidden entries hidden", () => {
  const r = { ...vocabularyRecordFixture(), lemma: "who", display: "who", publicationStatus: "hidden" as const, tier: "advanced" as const };
  const cs = recoveryCandidates("who", [entry], "en", stamp);
  for (const d of [null, { sense: null, example: null }, { sense: 88, example: 0 }, { sense: 0, example: 88 }, { sense: 0.1, example: 0 }]) expect(applyRecovery(r, cs, d)).toEqual(r);
  expect(applyRecovery(r, cs, { sense: 0, example: 0 }).publicationStatus).toBe("published");
});
test("rejects fragments, archaic senses and unsupported source form claims", () => {
  expect(recoveryCandidates("-hydroxypropanoate", [{ ...entry, word: "-hydroxypropanoate" }], "en", stamp)).toEqual([]);
  expect(recoveryCandidates("who", [{ ...entry, senses: [{ ...entry.senses[0], tags: ["obsolete"] }] }], "en", stamp)).toEqual([]);
  expect(recoveryCandidates("who", [{ ...entry, forms: [{ form: "whatever" }], senses: [{ glosses: ["A person."], examples: [{ text: "Whatever happens." }] }] }], "en", stamp)[0]?.sense.examples).toEqual([]);
});
test("requires conventional grammatical senses for core function words without rewriting source labels", () => {
  for (const [lemma, badPos, goodPos] of [["might", "noun", "verb"], ["because", "prep", "conj"], ["when", "prep", "adv"]]) {
    const r = { ...vocabularyRecordFixture(), lemma, display: lemma, tier: "core" as const };
    const cs = recoveryCandidates(lemma, [badPos, goodPos].map(pos => ({ word: lemma, lang_code: "en", pos, senses: [{ glosses: ["A supplied meaning."], examples: [{ text: `This ${lemma} is supplied.` }] }] })), "en", stamp);
    expect(learnerCandidates(r, cs)).toEqual([cs[1]]);
    expect(applyRecovery(r, cs, { sense: 0, example: 0 })).toEqual(r);
  }
});
test("a bare inflection pointer is not a complete learner definition", () => {
  expect(recoveryCandidates("abdominals", [{ word: "abdominals", lang_code: "en", pos: "noun", senses: [{ glosses: ["plural of abdominal"] }] }], "en", stamp)).toEqual([]);
});
test("also rejects Simple Wiktionary's article-prefixed inflection pointers", () => {
  for (const definition of ["The plural form of beam; more than one (kind of) beam.", "The third-person singular form of beam.", "simple past tense and past participle of beam"]) {
    expect(recoveryCandidates("beams", [{ word: "beams", lang_code: "en", pos: "noun", senses: [{ glosses: [definition] }] }], "simple", stamp)).toEqual([]);
  }
});
test("rejects untyped quotations with bibliography embedded in example text", () => {
  const examples = [
    { text: "2002, A. Author, Scientific Journal, p. 225,\nWho wrote this?" },
    { text: "December 1749, A. Author, letter to his son\nWho is there?" },
    { text: "2020, Some Book, page 9: Who called?" },
    { text: "Who called?" },
  ];
  const cs = recoveryCandidates("who", [{ ...entry, senses: [{ glosses: ["Used to ask about a person."], examples }] }], "en", stamp);
  expect(cs[0]?.sense.examples.map(e => e.text)).toEqual(["Who called?"]);
});
test("requires all independent quality checks to pass explicitly", () => {
  const good = { explains_word: true, complete_sentence: true, matching_sense_and_pos: true, natural: true };
  expect(approvedRecoveryReview(good)).toBe(true);
  for (const key of Object.keys(good)) expect(approvedRecoveryReview({ ...good, [key]: false })).toBe(false);
  expect(approvedRecoveryReview({ ...good, natural: undefined })).toBe(false);
  expect(approvedRecoveryReview({ ...good, natural: "yes" })).toBe(false);
});
