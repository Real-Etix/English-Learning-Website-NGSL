import { buildRunStops, getLearningRouteList } from "@/lib/galaxy/learning-routes";
import { loadListGraph } from "@/lib/wiki/graph-store";

export const runtime = "nodejs";

/**
 * Tonight's run, generated server-side from the local date so the route is
 * authoritative (a client can't reshuffle to cherry-pick easy words). One star
 * per chart, biggest charts first, up to 8. Falls back to client generation on
 * error, so the run always works.
 */
export async function GET(request: Request) {
  const list = getLearningRouteList(request);
  if (list === null) {
    return Response.json({ error: "invalid list" }, { status: 400 });
  }
  const graph = await loadListGraph(list);
  const day = new Date().toISOString().slice(0, 10);
  const stops = buildRunStops(graph, day, 8);
  return Response.json({ stops, route: stops.map((stop) => stop.lemma), day });
}
