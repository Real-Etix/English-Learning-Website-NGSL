import { describe, expect, test } from "vitest";

import { TokenBudget } from "./budget";

describe("TokenBudget", () => {
  test("rejects a reservation that would exceed either token ceiling before work starts", () => {
    const budget = new TokenBudget({ maxInputTokens: 100, maxOutputTokens: 50 });

    expect(budget.reserve("fits", { inputTokens: 60, outputTokens: 20 })).toBe(true);
    expect(budget.reserve("too-many-inputs", { inputTokens: 41, outputTokens: 1 })).toBe(false);
    expect(budget.reserve("too-many-outputs", { inputTokens: 1, outputTokens: 31 })).toBe(false);
    expect(budget.remaining()).toEqual({ inputTokens: 40, outputTokens: 30 });
  });

  test("settles a reservation to actual usage", () => {
    const budget = new TokenBudget({ maxInputTokens: 100, maxOutputTokens: 50 });

    expect(budget.reserve("request-1", { inputTokens: 60, outputTokens: 30 })).toBe(true);
    expect(budget.recordActual("request-1", { inputTokens: 45, outputTokens: 12 })).toBe(true);
    expect(budget.remaining()).toEqual({ inputTokens: 55, outputTokens: 38 });
    expect(budget.exhausted()).toBe(false);
  });

  test("does not double-charge retries with the same request ID", () => {
    const budget = new TokenBudget({ maxInputTokens: 100, maxOutputTokens: 50 });

    expect(budget.reserve("retryable-request", { inputTokens: 60, outputTokens: 20 })).toBe(true);
    expect(budget.reserve("retryable-request", { inputTokens: 60, outputTokens: 20 })).toBe(true);
    expect(budget.recordActual("retryable-request", { inputTokens: 30, outputTokens: 10 })).toBe(true);
    expect(budget.recordActual("retryable-request", { inputTokens: 30, outputTokens: 10 })).toBe(true);
    expect(budget.remaining()).toEqual({ inputTokens: 70, outputTokens: 40 });
  });

  test("creates and charges distinct fresh reservations for repeated dispatch attempts", () => {
    const budget = new TokenBudget({ maxInputTokens: 100, maxOutputTokens: 50 });
    const first = budget.reserveFresh("relationship-judge", { inputTokens: 30, outputTokens: 15 });
    const second = budget.reserveFresh("relationship-judge", { inputTokens: 30, outputTokens: 15 });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    if (!first || !second) return;

    expect(budget.recordActual(first, { inputTokens: 10, outputTokens: 5 })).toBe(true);
    expect(budget.recordActual(second, { inputTokens: 12, outputTokens: 6 })).toBe(true);
    expect(budget.remaining()).toEqual({ inputTokens: 78, outputTokens: 39 });
  });
});
