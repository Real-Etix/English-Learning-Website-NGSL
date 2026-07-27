import { fetchWordDetail } from "@/lib/content/word-detail";

export async function GET(
  _request: Request,
  context: { params: Promise<{ lemma: string }> },
) {
  const { lemma } = await context.params;
  return Response.json(await fetchWordDetail(lemma));
}
