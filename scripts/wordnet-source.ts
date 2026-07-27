/**
 * WordNet source for the wiki seeder (content words only).
 *
 * Gives a learner-relevant definition plus real synonym/antonym relations,
 * fully offline (Princeton WordNet via the `wordpos` package). This is where
 * the graph gets its first genuine edges — no LLM, no network, reproducible.
 *
 * Sense selection: WordNet lists many senses per word across parts of speech.
 * We pick the part of speech with the MOST senses (words tend to have the most
 * senses in their dominant POS), tie-broken noun > verb > adjective > adverb,
 * then take sense 1 (WordNet orders senses by frequency). It is a heuristic, so
 * pages stay `status: seeded` — an LLM/human pass refines them later.
 */
// wordpos is CommonJS; tsx handles the default-import interop.
import WordPOS from "wordpos";

export type WordNetEntry = {
  pos: string;
  definition: string;
  synonyms: string[];
  antonyms: string[];
  examples: string[];
};

type Synset = {
  pos: string;
  def: string;
  synonyms: string[];
  exp?: string[];
  synsetOffset: number;
  ptrs?: Array<{ pointerSymbol: string; synsetOffset: number; pos: string }>;
};

const wp = new WordPOS();

// buckets index → tie-break priority (lower wins when sense counts are equal)
const POS_LABELS = ["noun", "verb", "adjective", "adverb"];

function cleanLemma(value: string): string {
  return (
    value
      .toLowerCase()
      // strip WordNet syntactic markers like "all(a)", "out(p)"
      .replace(/\([a-z]+\)$/, "")
      // WordNet joins multi-word entries with underscores
      .replace(/_/g, " ")
      .trim()
  );
}

/**
 * Keep only clean, teachable single words: letters/hyphen, 3+ chars.
 * Rejects WordNet junk — digits ("1"), abbreviations ("w.h.o."), archaic
 * contractions ("ne'er", "e'er"), and multi-word phrases.
 */
function isTeachableWord(value: string): boolean {
  return /^[a-z][a-z-]{1,}[a-z]$/.test(value) && value.length >= 3;
}

async function resolveAntonyms(synset: Synset, self: string): Promise<string[]> {
  const antonymPtrs = (synset.ptrs ?? []).filter((p) => p.pointerSymbol === "!");
  const out: string[] = [];
  for (const ptr of antonymPtrs) {
    try {
      const target = (await wp.seek(ptr.synsetOffset, ptr.pos)) as Synset;
      for (const word of target.synonyms ?? []) {
        const clean = cleanLemma(word);
        if (clean && clean !== self) out.push(clean);
      }
    } catch {
      // pointer that fails to resolve is skipped
    }
  }
  return Array.from(new Set(out));
}

export async function getWordNetEntry(lemma: string): Promise<WordNetEntry | null> {
  const buckets: Synset[][] = await Promise.all([
    wp.lookupNoun(lemma),
    wp.lookupVerb(lemma),
    wp.lookupAdjective(lemma),
    wp.lookupAdverb(lemma),
  ]);

  let bestIndex = -1;
  for (let i = 0; i < buckets.length; i += 1) {
    if (buckets[i].length === 0) continue;
    if (bestIndex === -1 || buckets[i].length > buckets[bestIndex].length) {
      bestIndex = i; // strictly greater keeps the earlier POS on ties (noun-first)
    }
  }
  if (bestIndex === -1) return null;

  const synset = buckets[bestIndex][0];
  const self = cleanLemma(lemma);

  const synonyms = Array.from(
    new Set(synset.synonyms.map(cleanLemma).filter((s) => s !== self && isTeachableWord(s))),
  );
  const antonyms = (await resolveAntonyms(synset, self)).filter(isTeachableWord);

  // WordNet usage examples that actually contain the word (skip off-word ones).
  const examples = (synset.exp ?? [])
    .filter((ex) => new RegExp(`\\b${self.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(ex))
    .slice(0, 2);

  return {
    pos: POS_LABELS[bestIndex],
    definition: synset.def,
    synonyms,
    antonyms,
    examples,
  };
}
