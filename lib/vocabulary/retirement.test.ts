import { describe, expect, it } from "vitest";
import { vocabularyRecordFixture } from "./test-fixtures";
import { releaseRecordHash } from "./limited-release";
import * as retirement from "./retirement";
import type { VocabularyRecord } from "./schema";

function fixture() {
  const core = vocabularyRecordFixture();
  const hidden: VocabularyRecord = { ...core, lemma: "uncertain", display: "uncertain", tier: "advanced", lists: [], publicationStatus: "hidden", connections: [] };
  core.connections = [{ ...core.connections[0], target: hidden.lemma, status: "unreviewed" }];
  return { core, hidden, decision: { lemma: hidden.lemma, beforeHash: releaseRecordHash(hidden), reason: "Final reviewed meaning remains unsupported." } };
}

describe("explicit hidden-word retirement", () => {
  it("removes only pinned hidden words and archives exact incoming edges", () => {
    const { core, hidden, decision } = fixture();
    const snapshot = structuredClone([core, hidden]);
    const result = retirement.planRetirement([core, hidden], [decision]);
    expect(result.retired).toEqual([hidden]);
    expect(result.retained).toEqual([{ ...core, connections: [] }]);
    expect(result.incoming).toEqual([{ lemma: core.lemma, index: 0, connection: core.connections[0] }]);
    expect([core, hidden]).toEqual(snapshot);
  });

  it("fails closed for core, public or officially listed targets", () => {
    const { core, hidden, decision } = fixture();
    for (const target of [core, { ...hidden, publicationStatus: "published" as const }, { ...hidden, lists: core.lists }]) {
      expect(() => retirement.planRetirement([target], [{ ...decision, lemma: target.lemma, beforeHash: releaseRecordHash(target) }])).toThrow(/hidden advanced|official/i);
    }
  });

  it("rejects changed, missing or duplicate reviewed targets", () => {
    const { core, hidden, decision } = fixture();
    expect(() => retirement.planRetirement([core, { ...hidden, display: "changed" }], [decision])).toThrow(/changed/i);
    expect(() => retirement.planRetirement([core], [decision])).toThrow(/missing/i);
    expect(() => retirement.planRetirement([core, hidden], [decision, decision])).toThrow(/duplicate/i);
  });

  it("refuses to silently remove a published connection", () => {
    const { core, hidden, decision } = fixture();
    core.connections[0].status = "published";
    expect(() => retirement.planRetirement([core, hidden], [decision])).toThrow(/published connection/i);
  });

  it("preserves remaining connection order and exact archived indexes", () => {
    const { core, hidden, decision } = fixture();
    const keep = { ...core.connections[0], target: "keep" };
    core.connections = [keep, core.connections[0], keep];
    const result = retirement.planRetirement([core, hidden], [decision]);
    expect(result.retained[0].connections).toEqual([keep, keep]);
    expect(result.incoming[0].index).toBe(1);
  });
});
