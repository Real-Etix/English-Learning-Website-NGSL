import { z } from "zod";

export class InputError extends Error {
  constructor(message = "Invalid request.", public status = 400) { super(message); }
}

/** Limits actual stream bytes; Content-Length is deliberately not trusted. */
export async function readBoundedText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) throw new InputError();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new InputError("Request is too large.", 413); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { reader.releaseLock(); }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new InputError("Send an application/json request.", 415);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new InputError("Cross-site requests are not allowed.", 403);
  try {
    const body: unknown = JSON.parse(await readBoundedText(request.body, 32 * 1024));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputError();
    return body as Record<string, unknown>;
  } catch (error) { if (error instanceof InputError) throw error; throw new InputError(); }
}

const id = z.string().trim().min(1).max(160);
const message = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).refine(s => Buffer.byteLength(s) <= 4096) });
const chat = z.object({
  messages: z.array(message).min(1).max(8).refine(ms => ms.reduce((n, m) => n + Buffer.byteLength(m.content), 0) <= 16384),
  listSlug: z.enum(["ngsl", "academic", "business", "toeic", "fitness", "all"]).optional(),
  lemma: id.optional(), senseId: id.optional(),
});
const taskIdentity = z.object({ lemma: id, senseId: id, partner: id, relation: z.enum(["antonym", "intensity", "advanced_form", "builds_on", "collocation"]) });
const compose = z.discriminatedUnion("action", [
  z.object({ action: z.literal("task"), lemma: id, senseId: id, claimed: z.array(id).max(1000).optional(), avoid: z.array(id).max(100).optional() }),
  z.object({ action: z.literal("grade"), task: taskIdentity, text: z.string().max(1500).default(""), text2: z.string().max(1500).default("") }),
]);

export function parseChatInput(body: Record<string, unknown>) {
  const result = chat.safeParse(body);
  if (!result.success) throw new InputError("Invalid or oversized message. Use up to 8 short messages.");
  return result.data;
}
export function parseComposeInput(body: Record<string, unknown>) {
  const result = compose.safeParse(body);
  if (!result.success) throw new InputError("Invalid practice request. Keep each sentence under 1,500 characters.");
  return result.data;
}
export function inputErrorResponse(error: unknown) {
  return Response.json({ error: error instanceof InputError ? error.message : "Invalid request." }, { status: error instanceof InputError ? error.status : 400 });
}
