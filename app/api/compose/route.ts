import {
  composableConnections, gate, graderMessage, heuristicGrade, parseVerdict, pickTask, publishedSense,
  type PartnerInfo,
} from "@/lib/compose/tasks";
import { loadGeneratedWord } from "@/lib/vocabulary/generated-word-store";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { runtimeChat } from "@/lib/ai/runtime";
import { inputErrorResponse, parseComposeInput, readJsonObject } from "@/lib/ai/input";
import { needsExampleForPractice } from "@/lib/vocabulary/meaning-review";

export const runtime = "nodejs";
export const maxDuration = 60;

const COMPOSE_LIMIT = 20;
const COMPOSE_WINDOW_MS = 60_000;
// Relations we build composition tasks from (matches PRIORITY in lib/compose/tasks).
const COMPOSABLE = new Set(["antonym", "intensity", "advanced_form", "builds_on", "collocation"]);

/**
 * Two actions on one route:
 *  - `{ action: "task", lemma, senseId, claimed?, avoid? }` → pick a sentence task for one word meaning.
 *  - `{ action: "grade", task, text, text2?, example? }` → deterministic gate, then
 *    a model verdict (falls back to a labeled basic check when AI is unavailable).
 */
export async function POST(request: Request) {
  const limit = rateLimit(`compose:${clientIp(request)}`, COMPOSE_LIMIT, COMPOSE_WINDOW_MS);
  if (!limit.ok) {
    return Response.json({ error: `Too many attempts — wait ${limit.retryAfterSec}s.` }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } });
  }

  let body: ReturnType<typeof parseComposeInput>;
  try { body = parseComposeInput(await readJsonObject(request)); } catch (error) { return inputErrorResponse(error); }

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
    if (needsExampleForPractice(record, requestedSense)) return Response.json({ error: "Sentence practice needs a reviewed, sourced example." }, { status: 409 });

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
      if (!partner || !sense || needsExampleForPractice(partner, sense)) continue;
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
    const identity = body.task;
    const record = await loadGeneratedWord(identity.lemma);
    const sense = record ? publishedSense(record, identity.senseId) : null;
    if (!record || record.publicationStatus !== "published" || !sense) return Response.json({ error: "This meaning is not available for practice." }, { status: 409 });
    if (needsExampleForPractice(record, sense)) return Response.json({ error: "Sentence practice needs a reviewed, sourced example." }, { status: 409 });
    const partner = await loadGeneratedWord(identity.partner);
    const partnerSense = partner ? publishedSense(partner) : null;
    if (!partner || !partnerSense || needsExampleForPractice(partner, partnerSense)) return Response.json({ error: "The partner needs a reviewed, sourced example." }, { status: 409 });
    const relation = composableConnections(record, [record, partner]).find(c => c.target === partner.lemma && c.type === identity.relation);
    if (!relation) return Response.json({ error: "This connection is not available for practice." }, { status: 409 });
    const canonical = pickTask({ lemma: record.lemma, display: record.display, def: sense.definition, tier: record.tier, rank: record.lists[0]?.rank ?? null }, [
      { lemma: partner.lemma, display: partner.display, def: partnerSense.definition, tier: partner.tier, rank: partner.lists[0]?.rank ?? null,
        type: relation.type, gloss: relation.gloss ?? null, status: relation.status, dir: "out" },
    ], new Set(), []);
    if (!canonical) return Response.json({ error: "This connection is not available for practice." }, { status: 409 });
    const task = { ...canonical, senseId: sense.id };
    const text = body.text ?? "", text2 = body.text2 ?? "";
    const g = gate(task, text, text2, sense.examples[0]?.text);
    if (!g.ok) return Response.json({ ok: false, gate: g.msg });

    let verdict = null;
    const result = await runtimeChat(request, [
      { role: "system", content: "You are a strict but generous grader. Reply with JSON only, no prose, no code fences." },
      { role: "user", content: graderMessage(task, text, text2) },
    ], "grade");
    if (result.ok) verdict = parseVerdict(result.text);
    if (!verdict) verdict = { ...heuristicGrade(task, text, text2), note: "Basic check only — AI feedback is unavailable. Word presence and simple relation cues were checked; meaning and grammar were not reviewed." };
    return Response.json({ ok: true, verdict });
  }

  return Response.json({ error: "unknown action" }, { status: 400 });
}
