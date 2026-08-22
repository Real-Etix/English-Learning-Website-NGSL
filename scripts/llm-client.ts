/**
 * Shared OpenAI-compatible LLM client (defaults to Kimi / Moonshot AI).
 * Config via .env: LLM_API_KEY (or MOONSHOT_API_KEY), LLM_MODEL, LLM_BASE_URL.
 * One source of truth for every script that calls the model.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";

const BASE_URL = process.env.LLM_BASE_URL ?? "https://api.moonshot.ai/v1";

export const LLM_ENDPOINT = `${BASE_URL.replace(/\/$/, "")}/chat/completions`;
export const LLM_API_KEY = process.env.LLM_API_KEY ?? process.env.MOONSHOT_API_KEY ?? "";
export const LLM_MODEL = process.env.LLM_MODEL ?? "kimi-k2.5";

export const hasLLM = () => LLM_API_KEY.length > 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pull the first {...} JSON object out of a reply, tolerating prose or code fences. */
function extractJSON<T>(content: string): T | null {
  const cleaned = content.replace(/```json\s*|\s*```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type LlmUsage = { inputTokens: number; outputTokens: number };
export type LlmResult<T> = { value: T; usage: LlmUsage; requestId: string };
export type LlmResultOptions = {
  requestId?: string;
  fallbackUsage?: LlmUsage;
  maxOutputTokens?: number;
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
};

function providerUsage(data: ChatCompletionResponse): LlmUsage | null {
  const inputTokens = data.usage?.prompt_tokens ?? data.usage?.input_tokens;
  const outputTokens = data.usage?.completion_tokens ?? data.usage?.output_tokens;
  return typeof inputTokens === "number" && typeof outputTokens === "number"
    ? { inputTokens, outputTokens }
    : null;
}

/**
 * Core chat call: returns the raw reply text, or null on failure.
 * Retries transient failures (429 overload / 5xx) with exponential backoff.
 * No response_format / temperature — some models reject them.
 */
export async function completeChatResult(
  messages: ChatMessage[],
  model: string = LLM_MODEL,
  maxAttempts = 4,
  options: LlmResultOptions = {},
): Promise<LlmResult<string> | null> {
  const requestId = options.requestId ?? randomUUID();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Everything — including reading the response body — is inside the try, so a
    // timeout that fires mid-body-read is caught and retried, not thrown uncaught.
    try {
      const res = await fetch(LLM_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${LLM_API_KEY}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          model,
          messages,
          ...(options.maxOutputTokens === undefined ? {} : { max_tokens: options.maxOutputTokens }),
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as ChatCompletionResponse;
        return {
          value: data.choices?.[0]?.message?.content ?? "",
          usage: providerUsage(data) ?? options.fallbackUsage ?? { inputTokens: 0, outputTokens: 0 },
          requestId,
        };
      }

      const retriable = res.status === 429 || res.status >= 500;
      if (retriable && attempt < maxAttempts) {
        const waitMs = 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
        console.warn(`  ${res.status} (attempt ${attempt}/${maxAttempts}) — retry in ${waitMs}ms`);
        await sleep(waitMs);
        continue;
      }
      console.warn(`  LLM error ${res.status}: ${(await res.text()).slice(0, 160)}`);
      return null;
    } catch (err) {
      if (attempt === maxAttempts) {
        console.warn(`  request failed after ${maxAttempts} attempts: ${String(err)}`);
        return null;
      }
      await sleep(1000 * 2 ** (attempt - 1));
      continue;
    }
  }
  return null;
}

/** Compatibility wrapper for callers that only need the reply text. */
export async function completeChat(
  messages: ChatMessage[],
  model: string = LLM_MODEL,
  maxAttempts = 4,
): Promise<string | null> {
  const result = await completeChatResult(messages, model, maxAttempts);
  return result?.value ?? null;
}

/** Call the chat API and parse a JSON object from the reply (for the enrichment scripts). */
export async function completeJSONResult<T>(
  system: string,
  user: string,
  model: string = LLM_MODEL,
  maxAttempts = 4,
  options: LlmResultOptions = {},
): Promise<LlmResult<T> | null> {
  const result = await completeChatResult(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    model,
    maxAttempts,
    options,
  );
  if (!result) return null;
  const value = extractJSON<T>(result.value);
  return value === null ? null : { ...result, value };
}

/** Compatibility wrapper for callers that only need parsed JSON. */
export async function completeJSON<T>(
  system: string,
  user: string,
  model: string = LLM_MODEL,
  maxAttempts = 4,
): Promise<T | null> {
  const result = await completeJSONResult<T>(system, user, model, maxAttempts);
  return result?.value ?? null;
}
