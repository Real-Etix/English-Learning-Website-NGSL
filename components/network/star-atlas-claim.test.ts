import { describe, expect, it } from "vitest";

import { rollbackOptimisticClaim } from "./star-atlas";

describe("rollbackOptimisticClaim", () => {
  it("removes a newly optimistic sense claim after a failed POST", () => {
    const owned = new Set(["bank", "learn"]);

    expect(rollbackOptimisticClaim(owned, "bank", false)).toEqual(new Set(["learn"]));
  });

  it("preserves an existing held word when a duplicate request fails", () => {
    const owned = new Set(["bank", "learn"]);

    expect(rollbackOptimisticClaim(owned, "bank", true)).toBe(owned);
  });
});
