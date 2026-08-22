import { afterEach, describe, expect, test, vi } from "vitest";

import { completeChat, completeChatResult, completeJSON } from "./llm-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("llm-client request identity and compatibility", () => {
  test("sends one stable Idempotency-Key across retries while legacy wrappers keep their return values", async () => {
    const idempotencyKeys: string[] = [];
    let callCount = 0;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1;
      idempotencyKeys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
      if (callCount === 1) return new Response("overloaded", { status: 500 });
      const content = callCount === 2
        ? "result from detailed call"
        : callCount === 3
          ? "result from compatibility chat"
          : JSON.stringify({ answer: "result from compatibility JSON" });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const detailed = await completeChatResult(
      [{ role: "user", content: "hello" }],
      "test-model",
      2,
      { requestId: "stable-request-id" },
    );
    const chat = await completeChat([{ role: "user", content: "hello" }], "test-model", 1);
    const json = await completeJSON<{ answer: string }>("system", "user", "test-model", 1);

    expect(detailed).toMatchObject({ value: "result from detailed call", requestId: "stable-request-id" });
    expect(chat).toBe("result from compatibility chat");
    expect(json).toEqual({ answer: "result from compatibility JSON" });
    expect(idempotencyKeys.slice(0, 2)).toEqual(["stable-request-id", "stable-request-id"]);
    expect(idempotencyKeys).toHaveLength(4);
  });
});
