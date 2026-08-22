import { describe, expect, it } from "vitest";

import { composableConnections, pickTask, type PartnerInfo, type TargetInfo } from "./tasks";
import { vocabularyRecordFixture } from "../vocabulary/test-fixtures";

const target: TargetInfo = {
  lemma: "calm",
  display: "calm",
  def: "free from excitement",
  tier: "core",
  rank: 5,
};

function partner(overrides: Partial<PartnerInfo>): PartnerInfo {
  return {
    lemma: "agitated",
    display: "agitated",
    def: "showing strong emotion",
    tier: "core",
    rank: 10,
    type: "antonym",
    gloss: "authored contrast guidance",
    status: "published",
    dir: "out",
    ...overrides,
  };
}

describe("pickTask", () => {
  it("skips a higher-priority relation with no authored teaching gloss", () => {
    const task = pickTask(
      target,
      [
        partner({ lemma: "unglossed", display: "unglossed", def: "an unexplained definition", gloss: null }),
        partner({ lemma: "explained", display: "explained", def: "an explained definition", type: "intensity" }),
      ],
      new Set(),
      [],
    );

    expect(task?.partner).toBe("explained");
  });

  it("returns the definitions supplied for the selected target and partner", () => {
    const task = pickTask(
      target,
      [partner({ lemma: "explained", display: "explained", def: "an explained definition" })],
      new Set(),
      [],
    );

    expect(task?.defs).toEqual(["free from excitement", "an explained definition"]);
  });

  it("rejects an unreviewed partner even when it has a gloss", () => {
    const task = pickTask(
      target,
      [partner({ status: "unreviewed", gloss: "draft contrast guidance" })],
      new Set(),
      [],
    );

    expect(task).toBeNull();
  });

  it("receives only the selector's published, glossed public partner", () => {
    const record = vocabularyRecordFixture();
    const [connection] = record.connections;
    const publishedTarget = { ...record, lemma: "explained", display: "explained", publicationStatus: "published" as const };
    const hiddenTarget = { ...record, lemma: "hidden", display: "hidden", publicationStatus: "hidden" as const };
    const source = {
      ...record,
      connections: [
        { ...connection!, target: "explained", type: "antonym" as const, gloss: "authored contrast guidance", status: "published" as const },
        { ...connection!, target: "hidden", type: "antonym" as const, gloss: "hidden target", status: "published" as const },
        { ...connection!, target: "explained", type: "intensity" as const, gloss: "draft relation", status: "unreviewed" as const },
        { ...connection!, target: "explained", type: "intensity" as const, gloss: " ", status: "published" as const },
        { ...connection!, target: "missing", type: "intensity" as const, gloss: "missing target", status: "published" as const },
      ],
    };
    const partners = composableConnections(source, [source, publishedTarget, hiddenTarget]).map((link) => partner({
      lemma: link.target,
      display: link.target,
      type: link.type,
      gloss: link.gloss,
      status: link.status,
    }));

    expect(pickTask(target, partners, new Set(), [])?.partner).toBe("explained");
  });
});
