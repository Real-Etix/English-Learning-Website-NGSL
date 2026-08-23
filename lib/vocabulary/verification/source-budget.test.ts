import { describe, expect, test } from "vitest";

import { SourceRequestBudget } from "./source-budget";

describe("SourceRequestBudget", () => {
  test("counts each request ID once and stops at the hard ceiling", () => {
    const budget = new SourceRequestBudget(2);

    expect(budget.reserve("dictionary:manifest")).toBe(true);
    expect(budget.reserve("dictionary:manifest")).toBe(true);
    expect(budget.reserve("tatoeba:manifest")).toBe(true);
    expect(budget.reserve("dictionary:scrutinize")).toBe(false);
    expect(budget.used()).toBe(2);
    expect(budget.remaining()).toBe(0);
  });

  test("rejects negative and non-integer ceilings", () => {
    expect(() => new SourceRequestBudget(-1)).toThrow();
    expect(() => new SourceRequestBudget(1.5)).toThrow();
  });

  test("reports an unused zero ceiling without reserving requests", () => {
    const budget = new SourceRequestBudget(0);

    expect(budget.reserve("dictionary:manifest")).toBe(false);
    expect(budget.used()).toBe(0);
    expect(budget.remaining()).toBe(0);
  });
});
