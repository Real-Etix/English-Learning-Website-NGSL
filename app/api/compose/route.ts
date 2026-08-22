import {
  gate, graderMessage, heuristicGrade, parseVerdict, pickTask,
  type ComposeTask, type PartnerInfo,
} from "@/lib/compose/tasks";
import { fetchWordDetail } from "@/lib/content/word-detail";
import { buildWordLearningProfile } from "@/lib/content/word-learning";
import { loadGeneratedWord } from "@/lib/vocabulary/generated-word-store";
import type { VocabularyRecord } from "@/lib/vocabulary/schema";
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
    const record = await loadGeneratedWord(body.lemma);
    if (!record) return Response.json({ error: "not found" }, { status: 404 });

    const partners: PartnerInfo[] = [];
    const partnerRecords = new Map<string, VocabularyRecord>();
    for (const c of record.connections) {
      if (!COMPOSABLE.has(c.type)) continue;
      const partner = await loadGeneratedWord(c.target);
      const definition = partner?.senses[0]?.definition;
      if (!partner || !definition) continue;
      partnerRecords.set(partner.lemma, partner);
      partners.push({
        lemma: partner.lemma, display: partner.display, def: definition, tier: partner.tier,
        rank: partner.lists[0]?.rank ?? null, type: c.type, gloss: c.gloss ?? null, dir: "out",
      });
    }
    const task = pickTask(
      {
        lemma: record.lemma,
        display: record.display,
        def: record.senses[0]?.definition ?? "",
        tier: record.tier,
        rank: record.lists[0]?.rank ?? null,
      },
      partners,
      new Set(body.claimed ?? []),
      body.avoid ?? [],
    );
    if (!task) return Response.json({ task: null });

    const partnerRecord = partnerRecords.get(task.partner);
    if (!partnerRecord) return Response.json({ task });
    const [targetDetail, partnerDetail] = await Promise.all([
      fetchWordDetail(record.lemma).catch(() => null),
      fetchWordDetail(partnerRecord.lemma).catch(() => null),
    ]);
    const targetDefinition = buildWordLearningProfile(record, targetDetail).senses.find((sense) => sense.primary)?.definition;
    const partnerDefinition = buildWordLearningProfile(partnerRecord, partnerDetail).senses.find((sense) => sense.primary)?.definition;
    return Response.json({
      task: {
        ...task,
        defs: [targetDefinition ?? task.defs[0], partnerDefinition ?? task.defs[1]],
      },
    });
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
