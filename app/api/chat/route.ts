import { getListVocab, sampleWords } from "@/lib/content/list-vocab";
import { buildTutorSenseContext } from "@/lib/content/tutor-context";
import { loadGeneratedWord } from "@/lib/vocabulary/generated-word-store";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { runtimeChat, runtimeErrorResponse } from "@/lib/ai/runtime";
import { inputErrorResponse, parseChatInput, readJsonObject } from "@/lib/ai/input";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cheap per-process burst gate; PostgreSQL enforces the shared limits and budget.
const CHAT_LIMIT = 15;
const CHAT_WINDOW_MS = 60_000;

const SYSTEM_BASE =
  "You are a friendly English vocabulary tutor inside the NGSL Mood Trainer app. " +
  "Help learners practice and understand vocabulary. When asked to write a story, " +
  "paragraph, or dialogue using a particular list's vocabulary, use real words from " +
  "that list (shown below) and **bold** each one you use. When explaining or quizzing, " +
  "keep answers clear and encouraging. " +
  "When the learner shares their own writing and asks you to check it, briefly: " +
  "(1) point out any grammar or clarity issues with short corrections, then " +
  "(2) suggest a few places where a more advanced or precise word (prefer words from the " +
  "lists below) would improve it, showing the swap like plain → **advanced**. Be kind and " +
  "concise; don't rewrite the whole thing unless asked. " +
  "Use simple markdown. Keep replies concise unless asked for something longer.";

export async function POST(request: Request) {
  const limit = rateLimit(`chat:${clientIp(request)}`, CHAT_LIMIT, CHAT_WINDOW_MS);
  if (!limit.ok) {
    return Response.json(
      { error: `You're sending messages too fast — wait ${limit.retryAfterSec}s and try again.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let body: ReturnType<typeof parseChatInput>;
  try {
    body = parseChatInput(await readJsonObject(request));
  } catch (error) { return inputErrorResponse(error); }

  const hasExplicitSenseId = Object.prototype.hasOwnProperty.call(body, "senseId");
  if (hasExplicitSenseId && (typeof body.senseId !== "string" || !body.senseId.trim())) {
    return Response.json({ error: "invalid senseId" }, { status: 400 });
  }

  const history = body.messages;

  const vocab = await getListVocab();
  const vocabBlock = Object.entries(vocab)
    .map(([slug, { title, words }]) => `- ${title} (${slug}): ${sampleWords(words, 35).join(", ")}`)
    .join("\n");

  const context = body.listSlug && vocab[body.listSlug]
    ? `\nThe learner is currently viewing the "${vocab[body.listSlug].title}" list.`
    : "";

  // Ground the tutor in the open star's demand-loaded learner profile.
  let starBlock = "";
  if (hasExplicitSenseId && !body.lemma) {
    return Response.json({ error: "senseId requires lemma" }, { status: 400 });
  }
  if (body.lemma) {
    const record = await loadGeneratedWord(body.lemma);
    if (!record || record.lemma !== body.lemma) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    if (record.publicationStatus !== "published") {
      return Response.json({ error: "This word is not available for learning." }, { status: 409 });
    }
    const requestedSense = hasExplicitSenseId
      ? record.senses.find((sense) => sense.id === body.senseId)
      : record.senses.find((sense) => sense.status === "published");
    if (!requestedSense) {
      return Response.json({ error: "That meaning does not belong to this word." }, { status: 400 });
    }
    if (requestedSense.status !== "published") {
      return Response.json({ error: "This meaning is not published yet." }, { status: 409 });
    }
    const connectionTargets = (await Promise.all(
      record.connections.map((connection) => loadGeneratedWord(connection.target)),
    )).flatMap((target) => target ? [target] : []);
    const context = buildTutorSenseContext(record, requestedSense.id, [record, ...connectionTargets]);
    if (!context) return Response.json({ error: "This meaning is not available for learning." }, { status: 409 });
    starBlock = `\n\nThe learner has this word open. Ground your answer only in this reference:\n${context}`;
  }

  const system = `${SYSTEM_BASE}${context}${starBlock}\n\nWord lists you can draw from (samples):\n${vocabBlock}`;

  const result = await runtimeChat(request, [{ role: "system", content: system }, ...history], "chat");
  if (!result.ok) return runtimeErrorResponse(result);
  return Response.json({ reply: result.text }, { headers: { "Cache-Control": "no-store" } });
}
