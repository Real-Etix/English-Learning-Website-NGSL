import { expect, it } from "vitest";
import * as provider from "./open-english-wordnet";

const stamp = "2026-10-16T00:00:00.000Z";
const payload = [{ id: "03383020-n", lexname: "noun.artifact", partOfSpeech: "n", members: [{ lemma: "food processor", sense: { id: "food_processor%1:06:00::" }, poskey: "n", form: ["food processors"] }], definition: ["a kitchen appliance with interchangeable blades"], example: ["Food processors save time.", "A blender is noisy.", { text: "She used a food processor.", source: "An external book" }] }];

it("keeps an exact dictionary definition in review with attributable OEWN identity", () => {
  const [sense] = provider.openEnglishWordnetCandidates("food processor", payload, stamp);
  expect(sense).toMatchObject({ id: "oewn:03383020-n:food_processor%1:06:00::", status: "review", partOfSpeech: "noun", definition: payload[0].definition[0] });
  expect(sense.sources[0]).toMatchObject({ sourceId: "oewn", externalId: "03383020-n", attribution: "Princeton WordNet and the Open English Wordnet team", license: "CC BY 4.0; underlying Princeton WordNet License", retrievedAt: stamp });
  expect(sense.sources[0].contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(sense.examples.map(e => e.text)).toEqual(["Food processors save time."]);
});

it("does not import a different member or case-fold an unrelated proper noun", () => {
  expect(provider.openEnglishWordnetCandidates("blender", payload, stamp)).toEqual([]);
  expect(provider.openEnglishWordnetCandidates("Food Processor", payload, stamp)).toEqual([]);
});

it("permits review of a definition without examples but never approves it", () => {
  const [sense] = provider.openEnglishWordnetCandidates("food processor", [{ ...payload[0], example: [] }], stamp);
  expect(sense.examples).toEqual([]);
  expect(sense.status).toBe("review");
});

it("distinguishes malformed responses from an empty dictionary result", () => {
  expect(provider.openEnglishWordnetCandidates("word", [], stamp)).toEqual([]);
  expect(() => provider.openEnglishWordnetCandidates("word", { message: "unavailable" }, stamp)).toThrow();
  expect(() => provider.openEnglishWordnetCandidates("word", [{ id: "../../bad", partOfSpeech: "n" }], stamp)).toThrow();
});
