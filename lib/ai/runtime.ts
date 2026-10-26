import { randomUUID } from "node:crypto";
import { type BudgetStore, createBudgetStore } from "./budget-store";
import { readBoundedText } from "./input";
import { budgetWindow, OUTPUT_TOKENS, reserveCost, runtimePolicy, usageCost, visitorKey, type Message } from "./policy";

export type RuntimeResult = { ok: true; text: string } | { ok: false; status: number; error: string; retryAfter?: number };
const unavailable: RuntimeResult = { ok: false, status: 503, error: "AI feedback is temporarily unavailable. You can still explore and practise." };
const providerFailed: RuntimeResult = { ok: false, status: 502, error: "The assistant could not finish this request. Please try again later." };

export function createRuntimeChat(deps: { store: BudgetStore; fetcher?: typeof fetch; env?: NodeJS.ProcessEnv; now?: () => Date }) {
  return async (request: Request, messages: Message[], kind: keyof typeof OUTPUT_TOKENS): Promise<RuntimeResult> => {
    const env = deps.env ?? process.env;
    const now = (deps.now ?? (() => new Date()))();
    const policy = runtimePolicy(env, now);
    if (!policy) return unavailable;
    const visitor = visitorKey(request, policy.secret, env);
    if (!visitor) return unavailable;
    const maxOutput = OUTPUT_TOKENS[kind];
    let amount: number;
    try { amount = reserveCost(messages, maxOutput); }
    catch { return { ok: false, status: 413, error: "The conversation is too long. Please start a shorter question." }; }
    const window = budgetWindow(now);
    const id = randomUUID();
    try {
      const admission = await deps.store.reserve({ id, ...window, visitor, minute: now.toISOString().slice(0, 16), amount, cap: policy.cap });
      if (!admission.ok) {
        if (admission.reason === "unavailable") return unavailable;
        const minute = admission.reason === "visitor-minute";
        return { ok: false, status: 429,
          error: minute ? "You're sending requests too quickly. Please wait a minute." : admission.reason === "budget"
            ? "Today's shared AI allowance has been used. It resets at midnight China time; browsing and quizzes still work."
            : "You've reached your daily AI allowance. It resets at midnight China time.",
          retryAfter: minute ? 60 - now.getUTCSeconds() : window.retryAfter };
      }
    } catch { return unavailable; }

    // Admission has committed before the only paid dispatch. Any uncertain failure
    // leaves that reservation charged, including process termination or timeouts.
    let data: { choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
    try {
      const response = await (deps.fetcher ?? fetch)(policy.endpoint, {
        method: "POST", redirect: "error", cache: "no-store",
        headers: { Authorization: `Bearer ${policy.key}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({ model: policy.model, messages, max_tokens: maxOutput, thinking: { type: "disabled" }, ...(kind === "grade" ? { response_format: { type: "json_object" } } : {}) }),
      });
      if (!response.ok) { await response.body?.cancel(); return providerFailed; }
      data = JSON.parse(await readBoundedText(response.body, 128 * 1024));
      if (!data || typeof data !== "object") return providerFailed;
    } catch { return providerFailed; }

    const input = data.usage?.prompt_tokens, output = data.usage?.completion_tokens;
    // Missing/invalid usage is not zero cost. Keep the full reservation.
    if (typeof input === "number" && typeof output === "number" && Number.isSafeInteger(input) && Number.isSafeInteger(output) && input > 0 && output > 0 && input <= 10_000_000 && output <= 10_000_000) {
      const cost = usageCost(input, output);
      try { await deps.store.settle(id, cost); } catch { return unavailable; }
      if (cost > amount) return unavailable; // Store also latches an anomaly for all later days.
    }
    const text = Array.isArray(data.choices) ? data.choices[0]?.message?.content : null;
    return typeof text === "string" && text.trim() ? { ok: true, text } : providerFailed;
  };
}

// Import the database only on runtime use; offline scripts never import this file.
const store: BudgetStore = {
  async reserve(input) { const { prisma } = await import("@/lib/db"); return createBudgetStore(prisma).reserve(input); },
  async settle(id, cost) { const { prisma } = await import("@/lib/db"); return createBudgetStore(prisma).settle(id, cost); },
};
export const runtimeChat = createRuntimeChat({ store });
export function runtimeErrorResponse(result: Extract<RuntimeResult, { ok: false }>) {
  return Response.json({ error: result.error }, { status: result.status, headers: { "Cache-Control": "no-store", ...(result.retryAfter ? { "Retry-After": String(result.retryAfter) } : {}) } });
}
