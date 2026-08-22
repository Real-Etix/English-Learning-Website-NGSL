import { getWordRarity } from "@/lib/collection/service";
import { fetchWordDetail } from "@/lib/content/word-detail";
import { buildWordLearningProfile } from "@/lib/content/word-learning";
import { readPage } from "@/lib/wiki/parse-wiki";

export const runtime = "nodejs";

/**
 * Everything the detail drawer needs for one word: the wiki page (definition,
 * examples, connections), live dictionary data (IPA, audio, extra senses), and
 * how rare it is across explorers. Fetched on star-click so the graph stays small.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ lemma: string }> },
) {
  const { lemma } = await context.params;
  const page = await readPage(lemma);
  if (!page) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const [detail, rarity] = await Promise.all([
    fetchWordDetail(lemma),
    getWordRarity(lemma).catch(() => null), // DB may be unset in some envs
  ]);
  const learning = buildWordLearningProfile(page, detail);
  return Response.json({ page, detail, learning, rarity });
}
