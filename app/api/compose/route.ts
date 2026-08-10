import {
  gate, graderMessage, heuristicGrade, parseVerdict, pickTask,
  type ComposeTask, type PartnerInfo,
} from "@/lib/compose/tasks";
import { readPage } from "@/lib/wiki/parse-wiki";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { completeChat, hasLLM } from "@/scripts/llm-client";

export const runtime = "nodejs";

const COMPOSE_LIMIT = 20;
const COMPOSE_WINDOW_MS = 60_000;
// Relations we build composition tasks from (matches PRIORITY in lib/compose/tasks).
const COMPOSABLE = new Set(["antonym", "intensity", "advanced_form", "builds_on", "collocation"]);

/**
 * Two actions on one route:
 *  - `{ action: "task", lemma, claimed?, avoid? }` → pick a sentence task for a word.
 *  - `{ action: "grade", task, text, text2?, example? }` → deterministic gate, then
 *    a model verdict (falls back to the offline heuristic when no model is configured).
 */
export async function POST(request: Request) {
  const limit = rateLimit(`compose:${clientIp(request)}`, COMPOSE_LIMIT, COMPOSE_WINDOW_MS);
  if (!limit.ok) {
    return Response.json({ error: `Too many attempts — wait ${limit.retryAfterSec}s.` }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } });
  }

  let body: {
    action?: string; lemma?: string; claimed?: string[]; avoid?: string[];
    task?: ComposeTask; text?: string; text2?: string; example?: string | null;
  };
  try { body = await request.json(); } catch { return Response.json({ error: "invalid request" }, { status: 400 }); }

  // ---- pick a task ----
  if (body.action === "task") {
    if (!body.lemma) return Response.json({ error: "no lemma" }, { status: 400 });
    const page = await readPage(body.lemma);
    if (!page) return Response.json({ error: "not found" }, { status: 404 });

    const partners: PartnerInfo[] = [];
    for (const c of page.connections) {
      if (!COMPOSABLE.has(c.type)) continue;
      const pp = await readPage(c.target);
      if (!pp || !pp.definition) continue;
      partners.push({
        lemma: pp.lemma, display: pp.display, def: pp.definition, tier: pp.tier,
        rank: pp.rank, type: c.type, gloss: c.gloss ?? null, dir: "out",
      });
    }
    const task = pickTask(
      { lemma: page.lemma, display: page.display, def: page.definition, tier: page.tier, rank: page.rank },
      partners,
      new Set(body.claimed ?? []),
      body.avoid ?? [],
    );
    return Response.json({ task });
  }

  // ---- grade a submission ----
  if (body.action === "grade") {
    const task = body.task;
    if (!task) return Response.json({ error: "no task" }, { status: 400 });
    const text = body.text ?? "", text2 = body.text2 ?? "";
    const g = gate(task, text, text2, body.example);
    if (!g.ok) return Response.json({ ok: false, gate: g.msg });

    let verdict = null;
    if (hasLLM()) {
      const reply = await completeChat([
        { role: "system", content: "You are a strict but generous grader. Reply with JSON only, no prose, no code fences." },
        { role: "user", content: graderMessage(task, text, text2) },
      ]);
      if (reply) verdict = parseVerdict(reply);
    }
    if (!verdict) verdict = heuristicGrade(task, text, text2);
    return Response.json({ ok: true, verdict });
  }

  return Response.json({ error: "unknown action" }, { status: 400 });
}
