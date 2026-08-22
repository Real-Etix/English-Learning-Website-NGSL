import { describe, expect, it } from "vitest";

import { loadListGraph } from "./graph-store";

describe("loadListGraph", () => {
  it("throws the generated-artifact error for a missing graph without scanning Markdown", async () => {
    await expect(loadListGraph("missing-task-5-regression")).rejects.toThrow(
      'Generated graph for "missing-task-5-regression" is unavailable. Run npm run build:graphs during the build before serving this deployment.',
    );
  });
});
