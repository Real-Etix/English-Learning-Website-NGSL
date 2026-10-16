import { createHash } from "node:crypto";
import { z } from "zod";
import type { VocabularySense } from "../schema";
import { containsVocabularyForm } from "./repair";

const synsetSchema = z.object({
  id: z.string().regex(/^\d{8}-[nvars]$/),
  lexname: z.string(),
  partOfSpeech: z.enum(["n", "v", "a", "r", "s"]),
  members: z.array(z.object({ lemma: z.string(), sense: z.object({ id: z.string() }), poskey: z.string(), form: z.array(z.string()).optional() })).default([]),
  definition: z.array(z.string()).default([]),
  example: z.array(z.union([z.string(), z.object({ source: z.string(), text: z.string() })])).default([]),
});
const POS = { n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb" };

/** Dictionary membership is evidence, not an editorial approval of this sense. */
export function openEnglishWordnetCandidates(headword: string, payload: unknown, retrievedAt: string): VocabularySense[] {
  const synsets = z.array(synsetSchema).parse(payload);
  return synsets.flatMap(synset => {
    const member = synset.members.find(m => m.lemma.normalize("NFC") === headword.normalize("NFC"));
    if (!member || !synset.definition.some(d => d.trim())) return [];
    const source = {
      sourceId: "oewn", externalId: synset.id,
      url: `https://en-word.net/api/synset/${synset.id}`, retrievedAt,
      contentHash: `sha256:${createHash("sha256").update(JSON.stringify(synset)).digest("hex")}`,
      attribution: "Princeton WordNet and the Open English Wordnet team",
      license: "CC BY 4.0; underlying Princeton WordNet License",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    };
    const examples = synset.example.flatMap(example => {
      // Named external quotations need a separate reuse-rights check. A shared
      // synset example also needs to contain this member, not only a synonym.
      if (typeof example !== "string" || !containsVocabularyForm(example, { lemma: headword, forms: member.form ?? [] })) return [];
      return [{ text: example, sources: [source] }];
    });
    return [{
      id: `oewn:${synset.id}:${member.sense.id}`, partOfSpeech: POS[synset.partOfSpeech],
      definition: synset.definition.join("\n"), labels: [], sources: [source], examples,
      usagePatterns: [], collocations: [], commonMistakes: [], status: "review" as const,
    }];
  });
}
