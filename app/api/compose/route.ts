import {
  composableConnections, gate, graderMessage, heuristicGrade, parseVerdict, pickTask, publishedSense,
  type ComposeTask, type PartnerInfo,
} from "@/lib/compose/tasks";
import { loadGeneratedWord } from "@/lib/vocabulary/generated-word-store";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { completeChat, hasLLM } from "@/scripts/llm-client";

export const runtime = "nodejs";

const COMPOSE_LIMIT = 20;
const COMPOSE_WINDOW_MS = 60_000;
// Relations we build composition tasks from (matches PRIORITY in lib/compose/tasks).
const COMPOSABLE = new Set(["antonym", "intensity", "advanced_form", "builds_on", "collocation"]);

/**
 * Two actions on one route:
 *  - `{ action: "task", lemma, senseId, claimed?, avoid? }` → pick a sentence task for one word meaning.
 *  - `{ action: "grade", task, text, text2?, example? }` → deterministic gate, then
 *    a model verdict (falls back to the offline heuristic when no model is configured).
 */
export async function POST(request: Request) {
  const limit = rateLimit(`compose:${clientIp(request)}`, COMPOSE_LIMIT, COMPOSE_WINDOW_MS);
  if (!limit.ok) {
    return Response.json({ error: `Too many attempts — wait ${limit.retryAfterSec}s.` }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } });
  }

  let body: {
    action?: string; lemma?: string; senseId?: string; claimed?: string[]; avoid?: string[];
    task?: ComposeTask; text?: string; text2?: string; example?: string | null;
  };
  try { body = await request.json(); } catch { return Response.json({ error: "invalid request" }, { status: 400 }); }

  // ---- pick a task ----
  if (body.action === "task") {
    if (!body.lemma) return Response.json({ error: "no lemma" }, { status: 400 });
    if (typeof body.senseId !== "string" || !body.senseId.trim()) return Response.json({ error: "missing senseId" }, { status: 400 });
    const record = await loadGeneratedWord(body.lemma);
    if (!record || record.lemma !== body.lemma) return Response.json({ error: "not found" }, { status: 404 });
    if (record.publicationStatus !== "published") return Response.json({ error: "This word is not available for learning." }, { status: 409 });
    const requestedSense = record.senses.find((sense) => sense.id === body.senseId);
    if (!requestedSense) return Response.json({ error: "That meaning does not belong to this word." }, { status: 400 });
    if (requestedSense.status !== "published") return Response.json({ error: "This meaning is not published yet." }, { status: 409 });

    const partners: PartnerInfo[] = [];
    const loadedPartners = await Promise.all(record.connections.map(async (connection) => ({
      connection,
      record: await loadGeneratedWord(connection.target),
    })));
    const knownRecords = [record, ...loadedPartners.flatMap(({ record: partner }) => partner ? [partner] : [])];
    const partnersByLemma = new Map(loadedPartners.flatMap(({ record: partner }) => partner ? [[partner.lemma, partner] as const] : []));
    for (const c of composableConnections(record, knownRecords)) {
      if (!COMPOSABLE.has(c.type)) continue;
      const partner = partnersByLemma.get(c.target);
      const sense = partner ? publishedSense(partner) : null;
      if (!partner || !sense) continue;
      partners.push({
        lemma: partner.lemma, display: partner.display, def: sense.definition, tier: partner.tier,
        rank: partner.lists[0]?.rank ?? null, type: c.type, gloss: c.gloss ?? null, status: c.status, dir: "out",
      });
    }
    const task = pickTask(
      {
        lemma: record.lemma,
        display: record.display,
        def: requestedSense.definition,
        tier: record.tier,
        rank: record.lists[0]?.rank ?? null,
      },
      partners,
      new Set(body.claimed ?? []),
      body.avoid ?? [],
    );
    if (!task) return Response.json({ task: null });
    return Response.json({ task: { ...task, senseId: requestedSense.id } });
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
