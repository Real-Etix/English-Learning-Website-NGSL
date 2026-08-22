import { describe, expect, it } from "vitest";

import { pickTask, type PartnerInfo, type TargetInfo } from "./tasks";

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
});
