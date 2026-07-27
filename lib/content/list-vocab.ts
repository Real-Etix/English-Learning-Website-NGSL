import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Lightweight vocabulary access for the AI chat: reads the generated word list
 * (not the 11k wiki files) and samples words per list for prompt context.
 */
type Catalog = {
  lists: Array<{ slug: string; title: string; words: Array<{ lemma: string }> }>;
};

let cache: Record<string, { title: string; words: string[] }> | null = null;

export async function getListVocab(): Promise<Record<string, { title: string; words: string[] }>> {
  if (cache) return cache;
  const raw = await readFile(
    path.join(process.cwd(), "data", "generated", "word-lists.json"),
    "utf8",
  );
  const catalog = JSON.parse(raw) as Catalog;
  const out: Record<string, { title: string; words: string[] }> = {};
  for (const list of catalog.lists) {
    out[list.slug] = { title: list.title, words: list.words.map((w) => w.lemma) };
  }
  cache = out;
  return out;
}

/** Evenly-spread sample across the frequency-ordered list. */
export function sampleWords(words: string[], n: number): string[] {
  if (words.length <= n) return words;
  const step = Math.floor(words.length / n);
  const out: string[] = [];
  for (let i = 0; i < words.length && out.length < n; i += step) out.push(words[i]);
  return out;
}
