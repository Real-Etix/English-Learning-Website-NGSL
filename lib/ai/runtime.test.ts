import { describe, expect, it, vi } from "vitest";
import { createRuntimeChat } from "./runtime";
import type { BudgetStore } from "./budget-store";

const env: NodeJS.ProcessEnv = { AI_RUNTIME_ENABLED: "true", AI_RUNTIME_HMAC_SECRET: "test-secret-of-at-least-thirty-two-characters", AI_RUNTIME_PRICE_POLICY: "deepseek-flash-2026-10-26", DATABASE_URL: "unused", LLM_MODEL: "deepseek-v4-flash", LLM_API_KEY: "never-print-this", LLM_BASE_URL: "https://api.deepseek.com/v1", NODE_ENV: "test" };
const req = new Request("http://localhost/api/chat");
const messages = [{ role: "user" as const, content: "Hello" }];
function setup() {
  const store: BudgetStore = { reserve: vi.fn().mockResolvedValue({ ok: true }), settle: vi.fn().mockResolvedValue(undefined) };
  const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: "Hello there" } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }));
  const chat = createRuntimeChat({ store, fetcher, env, now: () => new Date("2026-10-26T15:59:59Z") });
  return { store, fetcher, chat };
}
describe("guarded runtime AI", () => {
  it("reserves before dispatch, disables thinking, caps output and settles valid usage", async () => {
    const { chat, fetcher, store } = setup();
    fetcher.mockImplementation(async (_url, options) => {
      expect(store.reserve).toHaveBeenCalledOnce();
      expect(JSON.parse(options.body)).toMatchObject({ max_tokens: 800, thinking: { type: "disabled" } });
      return Response.json({ choices: [{ message: { content: "Hello" } }], usage: { prompt_tokens: 100, completion_tokens: 10 } });
    });
    expect(await chat(req, messages, "chat")).toEqual({ ok: true, text: "Hello" });
    expect(store.settle).toHaveBeenCalledWith(expect.any(String), 280);
  });
  it("never calls the provider when accounting refuses or fails", async () => {
    const { chat, fetcher, store } = setup();
    vi.mocked(store.reserve).mockResolvedValue({ ok: false, reason: "budget" });
    expect(await chat(req, messages, "chat")).toMatchObject({ ok: false, status: 429, retryAfter: 1 });
    vi.mocked(store.reserve).mockRejectedValue(new Error("secret database address"));
    expect(await chat(req, messages, "chat")).toMatchObject({ ok: false, status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not retry failures or release uncertain reservations", async () => {
    const { chat, fetcher, store } = setup();
    fetcher.mockRejectedValue(new Error("provider secret error"));
    const result = await chat(req, messages, "grade");
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.settle).not.toHaveBeenCalled();
  });
  it.each([undefined, { prompt_tokens: -1, completion_tokens: 20 }, { prompt_tokens: 0, completion_tokens: 0 }, { prompt_tokens: 50, completion_tokens: 1.5 }])("retains full reservation for missing/invalid usage %j", async (usage) => {
    const { chat, fetcher, store } = setup();
    fetcher.mockResolvedValue(Response.json({ choices: [{ message: { content: "Hello" } }], usage }));
    expect(await chat(req, messages, "chat")).toMatchObject({ ok: true });
    expect(store.settle).not.toHaveBeenCalled();
  });
  it("records unexpected overrun and fails closed", async () => {
    const { chat, fetcher, store } = setup();
    fetcher.mockResolvedValue(Response.json({ choices: [{ message: { content: "Hello" } }], usage: { prompt_tokens: 50000, completion_tokens: 10 } }));
    expect(await chat(req, messages, "chat")).toMatchObject({ ok: false, status: 503 });
    expect(store.settle).toHaveBeenCalledWith(expect.any(String), 100080);
  });
  it("fails closed on settlement errors, bad pricing and oversized prompts", async () => {
    const { chat, fetcher, store } = setup();
    vi.mocked(store.settle).mockRejectedValue(new Error("private failure"));
    expect(await chat(req, messages, "chat")).toMatchObject({ ok: false, status: 503 });
    expect(await chat(req, [{ role: "user", content: "x".repeat(25000) }], "chat")).toMatchObject({ ok: false, status: 413 });
    const off = createRuntimeChat({ store, fetcher, env: { ...env, AI_RUNTIME_ENABLED: "false" } });
    expect(await off(req, messages, "chat")).toMatchObject({ ok: false, status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds response bytes and keeps paid reservation on HTTP failures", async () => {
    const { chat, fetcher, store } = setup();
    fetcher.mockResolvedValueOnce(new Response("x".repeat(131073))).mockResolvedValueOnce(new Response("private error", { status: 429 }));
    expect(await chat(req, messages, "chat")).toMatchObject({ ok: false, status: 502 });
    expect(await chat(req, messages, "chat")).toMatchObject({ ok: false, status: 502 });
    expect(store.settle).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("uses a 45-second abort signal and never retries an aborted request", async () => {
    const { chat, fetcher, store } = setup();
    const deadline = vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort(new DOMException("Timed out", "TimeoutError")));
    try {
      fetcher.mockImplementation(async (_url, options) => { options.signal.throwIfAborted(); });
      expect(await chat(req, messages, "grade")).toMatchObject({ ok: false, status: 502 });
      expect(deadline).toHaveBeenCalledWith(45000);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(JSON.parse(fetcher.mock.calls[0][1].body).max_tokens).toBe(300);
      expect(store.settle).not.toHaveBeenCalled();
    } finally { deadline.mockRestore(); }
  });
});
