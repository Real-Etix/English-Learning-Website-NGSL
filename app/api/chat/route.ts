import { getListVocab, sampleWords } from "@/lib/content/list-vocab";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { completeChat, hasLLM, type ChatMessage } from "@/scripts/llm-client";

export const runtime = "nodejs";

// Per-IP cap so a single client can't run up the DeepSeek bill.
const CHAT_LIMIT = 15;
const CHAT_WINDOW_MS = 60_000;

const SYSTEM_BASE =
  "You are a friendly English vocabulary tutor inside the NGSL Mood Trainer app. " +
  "Help learners practice and understand vocabulary. When asked to write a story, " +
  "paragraph, or dialogue using a particular list's vocabulary, use real words from " +
  "that list (shown below) and **bold** each one you use. When explaining or quizzing, " +
  "keep answers clear and encouraging. Use simple markdown. Keep replies concise unless " +
  "asked for something longer.";

export async function POST(request: Request) {
  if (!hasLLM()) {
    return Response.json(
      { error: "The AI assistant isn't configured on this deployment (missing LLM_API_KEY)." },
      { status: 503 },
    );
  }

  const limit = rateLimit(`chat:${clientIp(request)}`, CHAT_LIMIT, CHAT_WINDOW_MS);
  if (!limit.ok) {
    return Response.json(
      { error: `You're sending messages too fast — wait ${limit.retryAfterSec}s and try again.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let body: { messages?: ChatMessage[]; listSlug?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }

  const history = (body.messages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-8);
  if (history.length === 0) {
    return Response.json({ error: "no message" }, { status: 400 });
  }

  const vocab = await getListVocab();
  const vocabBlock = Object.entries(vocab)
    .map(([slug, { title, words }]) => `- ${title} (${slug}): ${sampleWords(words, 35).join(", ")}`)
    .join("\n");

  const context = body.listSlug && vocab[body.listSlug]
    ? `\nThe learner is currently viewing the "${vocab[body.listSlug].title}" list.`
    : "";

  const system = `${SYSTEM_BASE}${context}\n\nWord lists you can draw from (samples):\n${vocabBlock}`;

  const reply = await completeChat([{ role: "system", content: system }, ...history]);
  if (reply == null) {
    return Response.json({ error: "The assistant is busy right now — please try again." }, { status: 502 });
  }
  return Response.json({ reply });
}
