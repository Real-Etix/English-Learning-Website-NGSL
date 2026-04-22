import { getReferencesForLemma } from "@/lib/references/reference-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ lemma: string }> },
) {
  const { lemma } = await context.params;
  return Response.json({
    references: getReferencesForLemma(lemma),
  });
}
