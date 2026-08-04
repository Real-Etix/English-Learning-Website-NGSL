import { getSpaceBySlug } from "@/lib/collection/service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const space = await getSpaceBySlug(slug);
  if (!space) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ space });
}
