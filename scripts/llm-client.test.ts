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

  test("can sanitize terminal provider and exception diagnostics", async () => {
    const warnings: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((value) => warnings.push(String(value)));
    globalThis.fetch = vi.fn(async () => new Response(
      "SENSITIVE_PROVIDER_BODY_SENTINEL",
      { status: 400 },
    )) as typeof fetch;

    await expect(completeChatResult(
      [{ role: "user", content: "hello" }],
      "test-model",
      1,
      { sanitizeErrors: true },
    )).resolves.toBeNull();

    globalThis.fetch = vi.fn(async () => {
      throw new Error("SENSITIVE_EXCEPTION_SENTINEL");
    }) as typeof fetch;
    await expect(completeChatResult(
      [{ role: "user", content: "hello" }],
      "test-model",
      1,
      { sanitizeErrors: true },
    )).resolves.toBeNull();

    expect(warnings.join("\n")).toContain("LLM error 400");
    expect(warnings.join("\n")).not.toContain("SENSITIVE_PROVIDER_BODY_SENTINEL");
    expect(warnings.join("\n")).not.toContain("SENSITIVE_EXCEPTION_SENTINEL");
  });
});
