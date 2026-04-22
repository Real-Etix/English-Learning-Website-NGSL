import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { defaultEnrichment } from "../data/seed-enrichments";
import { seedReferences } from "../data/seed-references";
import { dedupeSourceCredits, sourceCredits } from "../lib/content/source-credits";
import type {
  ExampleSentence,
  GeneratedEnrichmentLibrary,
  GeneratedReferenceLibrary,
  ImportedCatalog,
  ImportedWord,
  WordEnrichment,
} from "../lib/types";

const PARTICLES = new Set([
  "about",
  "across",
  "after",
  "along",
  "around",
  "aside",
  "at",
  "away",
  "back",
  "by",
  "down",
  "for",
  "forward",
  "from",
  "in",
  "into",
  "off",
  "on",
  "out",
  "over",
  "round",
  "through",
  "to",
  "together",
  "under",
  "up",
  "with",
]);

const WINDOW_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "with",
]);

type DictionaryEntry = {
  word?: string;
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{
      definition?: string;
      example?: string;
      synonyms?: string[];
    }>;
  }>;
};

type TatoebaResponse = {
  data?: Array<{
    id: number;
    text: string;
    license?: string;
    owner?: string;
    lang?: string;
  }>;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    concurrency: 6,
    limit: Number.POSITIVE_INFINITY,
    force: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--concurrency=")) {
      parsed.concurrency = Number(arg.split("=")[1]) || parsed.concurrency;
    } else if (arg.startsWith("--limit=")) {
      parsed.limit = Number(arg.split("=")[1]) || parsed.limit;
    } else if (arg === "--force") {
      parsed.force = true;
    }
  }

  return parsed;
}

function normalizeWordToken(value: string) {
  return value.toLowerCase().replace(/[^a-z'-]/g, "");
}

function tokenizeSentence(sentence: string) {
  return sentence.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
}

function dedupeExamples(examples: ExampleSentence[]) {
  return Array.from(
    new Map(
      examples.map((example) => [example.text.toLowerCase().trim(), example]),
    ).values(),
  );
}

function createExampleSentence(
  id: string,
  text: string,
  explanation: string,
): ExampleSentence {
  return {
    id,
    text,
    explanation,
    source: "curated",
  };
}

function extractDefinition(entry: DictionaryEntry) {
  const selectedMeaning = selectPrimaryMeaning(entry);
  if (!selectedMeaning) {
    return null;
  }

  const selectedDefinition = selectedMeaning.definitions?.find((item) => item.definition);
  if (!selectedDefinition?.definition) {
    return null;
  }

  return {
    definition: selectedDefinition.definition,
    partOfSpeech: selectedMeaning.partOfSpeech ?? "word",
  };
}

function rankPartOfSpeech(partOfSpeech: string | undefined) {
  const normalized = (partOfSpeech ?? "").toLowerCase();

  if (normalized.includes("verb")) {
    return 90;
  }

  if (normalized.includes("noun")) {
    return 80;
  }

  if (normalized.includes("adjective")) {
    return 70;
  }

  if (normalized.includes("adverb")) {
    return 60;
  }

  if (normalized.includes("preposition")) {
    return 50;
  }

  if (normalized.includes("determiner") || normalized.includes("article")) {
    return 35;
  }

  if (normalized.includes("pronoun")) {
    return 30;
  }

  if (normalized.includes("conjunction")) {
    return 25;
  }

  return 10;
}

function selectPrimaryMeaning(entry: DictionaryEntry) {
  const meanings = entry.meanings ?? [];

  const ranked = meanings
    .map((meaning) => {
      const definitions = meaning.definitions ?? [];
      const firstDefinition = definitions.find((item) => item.definition);
      if (!firstDefinition?.definition) {
        return null;
      }

      const exampleCount = definitions.filter((item) => item.example).length;
      const score = rankPartOfSpeech(meaning.partOfSpeech) + exampleCount * 5;

      return {
        meaning,
        score,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right!.score - left!.score);

  return ranked[0]?.meaning ?? null;
}

function extractDictionaryExamples(
  lemma: string,
  entry: DictionaryEntry,
): ExampleSentence[] {
  const examples: ExampleSentence[] = [];
  const selectedMeaning = selectPrimaryMeaning(entry);

  const meanings = selectedMeaning
    ? [selectedMeaning, ...(entry.meanings ?? []).filter((item) => item !== selectedMeaning)]
    : (entry.meanings ?? []);

  for (const meaning of meanings) {
    for (const definition of meaning.definitions ?? []) {
      if (!definition.example) {
        continue;
      }

      examples.push(
        createExampleSentence(
          `${lemma}-dictionary-${examples.length + 1}`,
          definition.example,
          `Source-backed example from Dictionary API (${meaning.partOfSpeech ?? "word"}).`,
        ),
      );
    }
  }

  return dedupeExamples(examples).slice(0, 3);
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ngsl-mood-trainer/1.0",
    },
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as T;
}

async function fetchDictionaryEntry(lemma: string) {
  return fetchJson<DictionaryEntry[]>(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lemma)}`,
  );
}

async function fetchTatoebaExamples(
  lemma: string,
  forms: string[],
): Promise<ExampleSentence[]> {
  const payload = await fetchJson<TatoebaResponse>(
    `https://api.tatoeba.org/v1/sentences?lang=eng&q=${encodeURIComponent(
      lemma,
    )}&sort=relevance&limit=5`,
  );

  const acceptedForms = new Set(
    [lemma, ...forms].map((item) => normalizeWordToken(item)).filter(Boolean),
  );

  const examples =
    payload?.data
      ?.filter((item) => item.lang === "eng")
      .filter((item) => {
        const tokens = tokenizeSentence(item.text).map(normalizeWordToken);
        return tokens.some((token) => acceptedForms.has(token));
      })
      .map((item, index) =>
        createExampleSentence(
          `${lemma}-tatoeba-${index + 1}`,
          item.text,
          "Source-backed example from Tatoeba.",
        ),
      ) ?? [];

  return dedupeExamples(examples).slice(0, 2);
}

function extractRelatedPhrases(lemma: string, forms: string[], examples: ExampleSentence[]) {
  const acceptedForms = new Set(
    [lemma, ...forms].map((item) => normalizeWordToken(item)).filter(Boolean),
  );
  const phrases: string[] = [];

  for (const example of examples) {
    const tokens = tokenizeSentence(example.text);
    const normalizedTokens = tokens.map(normalizeWordToken);

    normalizedTokens.forEach((token, index) => {
      if (!acceptedForms.has(token)) {
        return;
      }

      const previous = normalizedTokens[index - 1];
      const next = normalizedTokens[index + 1];
      const nextTwo = normalizedTokens[index + 2];

      if (previous && !WINDOW_STOPWORDS.has(previous)) {
        phrases.push(`${previous} ${lemma}`);
      }

      if (next && !WINDOW_STOPWORDS.has(next)) {
        phrases.push(`${lemma} ${next}`);
      }

      if (next && nextTwo && !WINDOW_STOPWORDS.has(next) && !WINDOW_STOPWORDS.has(nextTwo)) {
        phrases.push(`${lemma} ${next} ${nextTwo}`);
      }
    });
  }

  return Array.from(
    new Set(
      phrases
        .map((phrase) => phrase.replace(/\s+/g, " ").trim())
        .filter((phrase) => phrase !== lemma && phrase.length > lemma.length + 1),
    ),
  ).slice(0, 4);
}

function extractPhrasalVerbs(
  lemma: string,
  forms: string[],
  examples: ExampleSentence[],
  partOfSpeech: string,
) {
  if (!partOfSpeech.toLowerCase().includes("verb")) {
    return [];
  }

  const acceptedForms = new Set(
    [lemma, ...forms].map((item) => normalizeWordToken(item)).filter(Boolean),
  );
  const results: string[] = [];

  for (const example of examples) {
    const tokens = tokenizeSentence(example.text).map(normalizeWordToken);
    tokens.forEach((token, index) => {
      if (!acceptedForms.has(token)) {
        return;
      }

      const next = tokens[index + 1];
      if (next && PARTICLES.has(next)) {
        results.push(`${lemma} ${next}`);
      }
    });
  }

  return Array.from(new Set(results)).slice(0, 3);
}

function buildConversationPrompt(
  lemma: string,
  definition: string,
  examples: ExampleSentence[],
) {
  const anchoredExample = examples[0]?.text;
  if (anchoredExample) {
    return `Use "${lemma}" in a short conversation that sounds natural in the same kind of context as: ${anchoredExample}`;
  }

  return `Use "${lemma}" in a short conversation where it means: ${definition}`;
}

async function generateEnrichmentForWord(word: ImportedWord): Promise<WordEnrichment> {
  const entries = await fetchDictionaryEntry(word.lemma);

  if (!entries || entries.length === 0) {
    return defaultEnrichment(word.lemma);
  }

  const primaryEntry = entries[0];
  const extractedDefinition = extractDefinition(primaryEntry);

  if (!extractedDefinition) {
    return defaultEnrichment(word.lemma);
  }

  let examples = extractDictionaryExamples(word.lemma, primaryEntry);
  const credits = [sourceCredits.dictionaryApi];

  if (examples.length === 0) {
    const tatoebaExamples = await fetchTatoebaExamples(word.lemma, word.forms);
    if (tatoebaExamples.length > 0) {
      examples = dedupeExamples([...examples, ...tatoebaExamples]).slice(0, 3);
      credits.push(sourceCredits.tatoeba);
    }
  }

  const relatedPhrases = extractRelatedPhrases(word.lemma, word.forms, examples);
  const phrasalVerbs = extractPhrasalVerbs(
    word.lemma,
    word.forms,
    examples,
    extractedDefinition.partOfSpeech,
  );

  return {
    definition: extractedDefinition.definition,
    partOfSpeech: extractedDefinition.partOfSpeech,
    exampleSentences: examples,
    relatedPhrases,
    phrasalVerbs,
    conversationPrompt: buildConversationPrompt(
      word.lemma,
      extractedDefinition.definition,
      examples,
    ),
    sourceCredits: dedupeSourceCredits(credits),
    contentStatus: "source_backed",
  };
}

async function runPool<T>(
  items: ImportedWord[],
  concurrency: number,
  worker: (item: ImportedWord) => Promise<T>,
  onProgress?: (count: number, results: Map<string, T>) => Promise<void>,
) {
  const results = new Map<string, T>();
  let cursor = 0;
  let completedCount = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      const item = items[currentIndex];
      results.set(item.normalizedLemma, await worker(item));
      completedCount += 1;
      if (completedCount % 50 === 0 || completedCount === items.length) {
        console.log(`Generated ${completedCount}/${items.length} enrichments`);
      }
      if (onProgress && (completedCount % 100 === 0 || completedCount === items.length)) {
        await onProgress(completedCount, results);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => runWorker()),
  );

  return results;
}

function buildReferenceLibrary(): GeneratedReferenceLibrary {
  const items = seedReferences.reduce<Record<string, typeof seedReferences>>((acc, reference) => {
    acc[reference.lemma] = [...(acc[reference.lemma] ?? []), reference];
    return acc;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    items,
  };
}

async function main() {
  const args = parseArgs();
  const projectRoot = process.cwd();
  const dataDirectory = path.join(projectRoot, "data", "generated");
  const catalogPath = path.join(dataDirectory, "word-lists.json");
  const enrichmentPath = path.join(dataDirectory, "enrichments.json");
  const referencesPath = path.join(dataDirectory, "references.json");

  const catalog = JSON.parse(
    await readFile(catalogPath, "utf8"),
  ) as ImportedCatalog;

  let existingLibrary: GeneratedEnrichmentLibrary = {
    generatedAt: "",
    items: {},
  };

  try {
    existingLibrary = JSON.parse(
      await readFile(enrichmentPath, "utf8"),
    ) as GeneratedEnrichmentLibrary;
  } catch {
    existingLibrary = {
      generatedAt: "",
      items: {},
    };
  }

  const uniqueWords = Array.from(
    new Map(
      catalog.lists
        .flatMap((list) => list.words)
        .map((word) => [word.normalizedLemma, word]),
    ).values(),
  );

  const wordsToProcess = uniqueWords
    .filter((word) => args.force || !existingLibrary.items[word.normalizedLemma])
    .slice(0, args.limit);

  async function persistSnapshot(results: Map<string, WordEnrichment>) {
    const snapshot: GeneratedEnrichmentLibrary = {
      generatedAt: new Date().toISOString(),
      items: {
        ...existingLibrary.items,
        ...Object.fromEntries(results.entries()),
      },
    };

    await mkdir(dataDirectory, { recursive: true });
    await writeFile(enrichmentPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }

  const generatedItems = await runPool(
    wordsToProcess,
    args.concurrency,
    generateEnrichmentForWord,
    async (_count, results) => {
      await persistSnapshot(results);
    },
  );

  const nextLibrary: GeneratedEnrichmentLibrary = {
    generatedAt: new Date().toISOString(),
    items: {
      ...existingLibrary.items,
      ...Object.fromEntries(generatedItems.entries()),
    },
  };

  await mkdir(dataDirectory, { recursive: true });
  await writeFile(enrichmentPath, `${JSON.stringify(nextLibrary, null, 2)}\n`, "utf8");
  await writeFile(
    referencesPath,
    `${JSON.stringify(buildReferenceLibrary(), null, 2)}\n`,
    "utf8",
  );

  console.log(
    `Saved ${Object.keys(nextLibrary.items).length} enrichments and ${seedReferences.length} references`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
