import { cookies } from "next/headers";

import { buildLadderRungs, getLearningRouteList } from "@/lib/galaxy/learning-routes";
import { getMySummary } from "@/lib/collection/service";
import { loadListGraph } from "@/lib/wiki/graph-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const list = getLearningRouteList(request);
  if (list === null) {
    return Response.json({ error: "invalid list" }, { status: 400 });
  }

  const ownerToken = (await cookies()).get("ownerToken")?.value;
  const [graph, summary] = await Promise.all([
    loadListGraph(list),
    getMySummary(ownerToken),
  ]);

  return Response.json({ rungs: buildLadderRungs(graph, new Set(summary?.lemmas || []), 7) });
}
