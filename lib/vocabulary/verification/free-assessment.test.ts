import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import * as assessment from "./free-assessment";
import { vocabularyRecordFixture } from "../test-fixtures";

it("defaults to offline, non-mutating assessment and enforces request bounds", () => {
  expect(assessment.parseFreeAssessmentArgs([])).toEqual({ write: false, requests: 0 });
  expect(assessment.parseFreeAssessmentArgs(["--max-source-requests=25", "--write"])).toEqual({ write: true, requests: 25 });
  for (const arg of ["--max-source-requests=-1", "--max-source-requests=1264", "--live", "--max-source-requests=abc"]) expect(() => assessment.parseFreeAssessmentArgs([arg])).toThrow();
});

it("extracts explicit Wiktionary topics and forms without inventing usage or synonyms", () => {
  const entries = [{ word: "learn", lang_code: "en", pos: "verb", forms: [{ form: "learned", tags: ["past"] }], senses: [{ glosses: ["To gain knowledge."], topics: ["education"], synonyms: [{ word: "study" }], examples: [{ text: "We learn together." }] }] }];
  const evidence = assessment.cachedWiktionaryEvidence("learn", entries, "2026-10-16T00:00:00.000Z");
  expect(evidence.topics).toEqual(["education"]);
  expect(evidence.senses[0].usagePatterns).toEqual([]);
  expect(evidence.forms).toContain("learned");
  expect(evidence.senses[0].status).toBe("review");
  expect(evidence.relations).toEqual([{ senseId: evidence.senses[0].id, type: "synonym", target: "study", source: evidence.senses[0].sources[0] }]);
  expect(evidence.senses[0].collocations).toEqual([]);
  expect(assessment.cachedWiktionaryEvidence("other", entries, "2026-10-16T00:00:00.000Z").topics).toEqual([]);
  expect(assessment.cachedWiktionaryEvidence("other", entries, "2026-10-16T00:00:00.000Z").relations).toEqual([]);
});

const stamp = "2026-10-16T00:00:00.000Z";
const sourceHash = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

it("retains exact usage qualifiers with their sense and scoped source hash", () => {
  const sense = { glosses: ["Owing gratitude for a service or favour."], tags: ["usually"], raw_tags: ["with to"], qualifier: "  in expressions of gratitude  ", topics: ["social-relations"] };
  const entry = { word: "indebted", lang_code: "en", pos: "adj", tags: ["predicative"], senses: [sense] };
  const evidence = assessment.cachedWiktionaryEvidence("indebted", [entry], stamp);
  expect(evidence.usage).toEqual([
    { senseId: evidence.senses[0].id, scope: "entry", field: "tags", text: "predicative", status: "review", source: expect.objectContaining({ contentHash: sourceHash(entry) }) },
    ...([['tags', 'usually'], ['raw_tags', 'with to'], ['qualifier', sense.qualifier], ['topics', 'social-relations']] as const).map(([field, text]) => ({
      senseId: evidence.senses[0].id, scope: "sense", field, text, status: "review",
      source: expect.objectContaining({ sourceId: "wiktionary", contentHash: sourceHash(sense), url: "https://en.wiktionary.org/wiki/indebted", license: "CC BY-SA 4.0", attribution: "Wiktionary contributors" }),
    })),
  ]);
  expect(evidence.senses[0].usagePatterns).toEqual([]);
  expect(evidence.senses[0].collocations).toEqual([]);
  expect(evidence.senses[0].status).toBe("review");
});

it("keeps identical raw senses in different parts of speech attached to distinct IDs", () => {
  const sense = { glosses: ["Supplied source wording."], tags: ["formal"], synonyms: [{ word: "supplied" }] };
  const entries = ["noun", "verb"].map(pos => ({ word: "test", lang_code: "en", pos, senses: [sense] }));
  const evidence = assessment.cachedWiktionaryEvidence("test", entries, stamp);
  expect(new Set(evidence.senses.map(s => s.id)).size).toBe(2);
  expect(evidence.relations.map(r => r.senseId)).toEqual(evidence.senses.map(s => s.id));
  expect(evidence.usage.map(u => u.senseId)).toEqual(evidence.senses.map(s => s.id));
});

it("excludes usage and topics from rejected, foreign and unsupported-POS entries", () => {
  const sense = { glosses: ["A supplied meaning."], topics: ["fiction"], raw_tags: ["with to"], synonyms: [{ word: "story" }] };
  const entry = { word: "test", lang_code: "en", pos: "noun", senses: [sense] };
  for (const bad of [
    { ...entry, lang_code: "fr" }, { ...entry, word: "Test" }, { ...entry, pos: "name" },
    { ...entry, senses: [{ ...sense, tags: ["obsolete"] }] },
  ]) {
    const evidence = assessment.cachedWiktionaryEvidence("test", [bad], stamp);
    expect(evidence.senses).toEqual([]);
    expect(evidence.topics).toEqual([]);
    expect(evidence.usage).toEqual([]);
    expect(evidence.relations).toEqual([]);
  }
});

it("skips malformed optional fields locally and deduplicates exact evidence", () => {
  const sense = { glosses: ["To learn a skill."], topics: "not-an-array", raw_tags: [null, "with practice", "", "with practice"], qualifier: {}, synonyms: [{ word: "study" }, null, { word: "study" }], examples: [{ text: "We learn a skill.", type: "example" }, { text: "We learn from a novel.", ref: "A book", type: "quotation" }] };
  const entry = { word: "learn", lang_code: "en", pos: "verb", senses: [sense] };
  const evidence = assessment.cachedWiktionaryEvidence("learn", [entry, entry], stamp);
  expect(evidence.topics).toEqual([]);
  expect(evidence.usage).toEqual([expect.objectContaining({ field: "raw_tags", text: "with practice" })]);
  expect(evidence.relations).toEqual([expect.objectContaining({ type: "synonym", target: "study" })]);
  expect(evidence.senses[0].examples.map(e => e.text)).toEqual(["We learn a skill."]);
});

it("does not attach an entry-wide qualifier or related phrase to an arbitrary sense", () => {
  const evidence = assessment.cachedWiktionaryEvidence("learn", [{ word: "learn", lang_code: "en", pos: "verb", qualifier: "ambiguous entry note", related: [{ word: "learn by heart" }], senses: [
    { glosses: ["To gain knowledge."] }, { glosses: ["To discover."] },
  ] }], stamp);
  expect(evidence.usage).toEqual([]);
  expect(evidence.relations).toEqual([]);
  expect(evidence.senses.every(s => s.collocations.length === 0 && s.usagePatterns.length === 0)).toBe(true);
});

it("reports current hidden words separately from the original backlog and archived subset", () => {
  const usage = assessment.cachedWiktionaryEvidence("indebted", [{ word: "indebted", lang_code: "en", pos: "adj", senses: [{ glosses: ["Owing gratitude."], tags: ["usually"], raw_tags: ["with to"] }] }], stamp).usage;
  expect(assessment.summarizeFreeUsage([
    { currentVisibility: "published", wikiUsage: usage },
    { currentVisibility: "hidden", wikiUsage: usage },
    { currentVisibility: "archived", wikiUsage: [] },
    { currentVisibility: "hidden", wikiUsage: [usage[0]] },
  ])).toEqual({
    currentPublic: 1, currentHidden: 3, currentArchived: 1,
    usageEvidenceItems: 5, wordsWithUsageEvidence: 3,
    hiddenWithUsageEvidence: 2, wordsWithUsageNotes: 2,
  });
});

it("never queries a source in offline mode, distinguishes absence from failure, and caches success", async () => {
  const saved = new Map<string, unknown>(); let calls = 0;
  const cache = { load: async (key: string) => saved.get(key) ?? null, save: async (key: string, value: unknown) => { saved.set(key, value); }, request: async () => { calls++; return Response.json([]); } };
  expect((await assessment.lookupFreeWordnet("learn", cache, false)).status).toBe("not_requested");
  expect(calls).toBe(0);
  expect((await assessment.lookupFreeWordnet("learn", cache, true)).status).toBe("no_match");
  expect((await assessment.lookupFreeWordnet("learn", cache, false)).status).toBe("no_match");
  expect(calls).toBe(1);
  await expect(assessment.lookupFreeWordnet("error", { ...cache, request: async () => new Response("error", { status: 503 }) }, true)).rejects.toThrow();
  expect([...saved.keys()]).toEqual(["oewn-api-v1:learn"]);
});

it("applies only pinned advanced reviews, preserves old senses, and is idempotent", () => {
  const original = { ...vocabularyRecordFixture(), lemma: "term", tier: "advanced" as const, lists: [], publicationStatus: "hidden" as const };
  const sense = { ...original.senses[0], id: "new-candidate", status: "review" as const };
  const decision = { beforeHash: assessment.recordHash(original), editorial: {}, importSenseIds: [sense.id] };
  const next = assessment.applyFreeAssessmentReview(original, decision, [sense], [original]);
  expect(next.publicationStatus).toBe("hidden");
  expect(next.senses).toEqual([...original.senses, sense]);
  expect(assessment.applyFreeAssessmentReview(next, decision, [sense], [next])).toEqual(next);
  expect(() => assessment.applyFreeAssessmentReview({ ...original, usageNote: "User edit" }, decision, [sense], [original])).toThrow(/changed/i);
  expect(() => assessment.applyFreeAssessmentReview(original, { ...decision, importSenseIds: ["invented"] }, [], [original])).toThrow(/missing/i);
});
