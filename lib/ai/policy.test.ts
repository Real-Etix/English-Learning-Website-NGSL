import { describe, expect, it } from "vitest";
import { budgetWindow, reserveCost, runtimePolicy, visitorKey } from "./policy";

const testEnv: NodeJS.ProcessEnv = {
  AI_RUNTIME_ENABLED: "true", AI_RUNTIME_HMAC_SECRET: "local-test-secret-that-is-at-least-32-chars",
  AI_RUNTIME_DAILY_MICRO_CNY: "1000000", AI_RUNTIME_PRICE_POLICY: "deepseek-flash-2026-10-26",
  LLM_API_KEY: "test-only", LLM_BASE_URL: "https://api.deepseek.com/v1", LLM_MODEL: "deepseek-v4-flash",
  DATABASE_URL: "postgresql://unused", NODE_ENV: "test",
};
const now = new Date("2026-10-26T15:59:59Z");
describe("runtime AI policy", () => {
  it("requires explicit enabled, priced configuration", () => {
    expect(runtimePolicy(testEnv, now)?.cap).toBe(1_000_000);
    for (const key of ["AI_RUNTIME_ENABLED", "AI_RUNTIME_HMAC_SECRET", "AI_RUNTIME_PRICE_POLICY", "LLM_API_KEY", "DATABASE_URL"]) {
      expect(runtimePolicy({ ...testEnv, [key]: "" }, now)).toBeNull();
    }
    expect(runtimePolicy({ ...testEnv, LLM_MODEL: "deepseek-pro" }, now)).toBeNull();
    expect(runtimePolicy({ ...testEnv, LLM_BASE_URL: "https://evil.invalid/v1" }, now)).toBeNull();
    expect(runtimePolicy({ ...testEnv, AI_RUNTIME_DAILY_MICRO_CNY: "1000001" }, now)).toBeNull();
    expect(runtimePolicy(testEnv, new Date("2026-11-25T00:00:00Z"))).toBeNull();
    expect(runtimePolicy({ ...testEnv, VERCEL: "1", VERCEL_ENV: "preview" }, now)).toBeNull();
  });
  it("resets at China midnight, not UTC midnight", () => {
    expect(budgetWindow(now)).toMatchObject({ day: "2026-10-26", resetAt: new Date("2026-10-26T16:00:00Z"), retryAfter: 1 });
    expect(budgetWindow(new Date("2026-10-26T16:00:00Z")).day).toBe("2026-10-27");
  });
  it("reserves UTF-8 bytes plus framing and full capped output", () => {
    expect(reserveCost([{ role: "user", content: "Hi" }], 800)).toBe((2 + 256 + 1024) * 2 + 800 * 8);
    expect(reserveCost([{ role: "user", content: "你好" }], 300)).toBe((6 + 256 + 1024) * 2 + 300 * 8);
    expect(() => reserveCost([{ role: "user", content: "x".repeat(24577) }], 800)).toThrow();
  });
  it("hashes only a trusted Vercel IP and rejects missing identity in production", () => {
    const req = new Request("https://test.invalid", { headers: { "x-vercel-forwarded-for": "1.2.3.4", "x-forwarded-for": "5.6.7.8" } });
    const key = visitorKey(req, testEnv.AI_RUNTIME_HMAC_SECRET!, { VERCEL: "1", NODE_ENV: "production" });
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(visitorKey(new Request("https://test.invalid"), testEnv.AI_RUNTIME_HMAC_SECRET!, { VERCEL: "1", NODE_ENV: "production" })).toBeNull();
    expect(visitorKey(req, testEnv.AI_RUNTIME_HMAC_SECRET!, { NODE_ENV: "production" })).toBeNull();
  });
});
