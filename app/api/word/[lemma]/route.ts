import { fetchWordDetail } from "@/lib/content/word-detail";
import { readPage } from "@/lib/wiki/parse-wiki";

/**
 * Everything the detail drawer needs for one word: the wiki page (definition,
 * examples, connections) plus live dictionary data (IPA, audio, extra senses).
 * Fetched on star-click so the graph payload stays small.
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
  const detail = await fetchWordDetail(lemma);
  return Response.json({ page, detail });
}
