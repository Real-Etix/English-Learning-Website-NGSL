import { cookies } from "next/headers";

import { buildLadderRungs, isLearningRouteList } from "@/lib/galaxy/learning-routes";
import { getMySummary } from "@/lib/collection/service";
import { loadListGraph } from "@/lib/wiki/graph-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const list = new URL(request.url).searchParams.get("list") || "ngsl";
  if (!isLearningRouteList(list)) {
    return Response.json({ error: "invalid list" }, { status: 400 });
  }

  const ownerToken = (await cookies()).get("ownerToken")?.value;
  const [graph, summary] = await Promise.all([
    loadListGraph(list),
    getMySummary(ownerToken),
  ]);

  return Response.json({ rungs: buildLadderRungs(graph, new Set(summary?.lemmas || []), 7) });
}
