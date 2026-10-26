import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export type Message = { role: "system" | "user" | "assistant"; content: string };
export const PRICE_POLICY = "deepseek-flash-2026-10-26";
export const PRICE_EXPIRES = Date.parse("2026-11-25T00:00:00Z");
export const OUTPUT_TOKENS = { chat: 800, grade: 300 } as const;
export type RuntimePolicy = { cap: number; key: string; secret: string; model: string; endpoint: string };

export function runtimePolicy(env: NodeJS.ProcessEnv, now: Date): RuntimePolicy | null {
  const cap = Number(env.AI_RUNTIME_DAILY_MICRO_CNY ?? "1000000");
  if (env.AI_RUNTIME_ENABLED !== "true" || env.AI_RUNTIME_PRICE_POLICY !== PRICE_POLICY ||
    (env.VERCEL === "1" && env.VERCEL_ENV !== "production") ||
    now.getTime() >= PRICE_EXPIRES || now.getTime() < Date.parse("2026-10-26T00:00:00Z") ||
    !env.DATABASE_URL || !env.LLM_API_KEY || (env.AI_RUNTIME_HMAC_SECRET?.length ?? 0) < 32 ||
    !Number.isSafeInteger(cap) || cap < 1 || cap > 1_000_000 ||
    !["https://api.deepseek.com/v1", "https://api.deepseek.com"].includes((env.LLM_BASE_URL ?? "").replace(/\/$/, "")) ||
    !["deepseek-flash", "deepseek-v4-flash"].includes(env.LLM_MODEL ?? "")) return null;
  return { cap, key: env.LLM_API_KEY, secret: env.AI_RUNTIME_HMAC_SECRET!, model: env.LLM_MODEL!, endpoint: "https://api.deepseek.com/v1/chat/completions" };
}

export function budgetWindow(now: Date) {
  const day = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const resetAt = new Date(Date.parse(`${day}T16:00:00Z`));
  return { day, resetAt, retryAfter: Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)) };
}

/** Peak cache-miss prices: ¥2 input / ¥8 output per million = 2/8 micro-CNY per token. */
export function usageCost(input: number, output: number) { return input * 2 + output * 8; }

export function reserveCost(messages: Message[], outputTokens: number) {
  const bytes = messages.reduce((n, m) => n + Buffer.byteLength(m.content, "utf8"), 0);
  if (bytes > 24 * 1024) throw new Error("The conversation is too long. Please start a shorter question.");
  return usageCost(bytes + messages.length * 256 + 1024, outputTokens);
}

/** Trust this header only on Vercel. Self-hosted production needs its own reviewed proxy boundary. */
export function visitorKey(request: Request, secret: string, env: NodeJS.ProcessEnv = process.env): string | null {
  let identity = "local-development";
  if (env.VERCEL === "1") {
    identity = request.headers.get("x-vercel-forwarded-for")?.trim() ?? "";
    if (!isIP(identity)) return null;
    // Canonicalize IPv6 spellings so equivalent addresses share a window.
    if (isIP(identity) === 6) identity = new URL(`http://[${identity}]`).hostname;
  } else if (env.NODE_ENV === "production") return null;
  return createHmac("sha256", secret).update(identity).digest("hex");
}
