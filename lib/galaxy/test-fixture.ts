import type { LiteGraph } from "@/lib/wiki/parse-wiki";

export const fixtureGraph: LiteGraph = {
  slug: "fixture",
  isolatedCount: 1,
  chartNames: { speech: "Speaking & Listening", motion: "Movement" },
  nodes: [
    { lemma: "speak", display: "speak", tier: "core", pos: "verb", rank: 10, chart: "speech", degree: 2 },
    { lemma: "talk", display: "talk", tier: "core", pos: "verb", rank: 20, chart: "speech", degree: 1 },
    { lemma: "move", display: "move", tier: "core", pos: "verb", rank: 30, chart: "motion", degree: 1 },
    { lemma: "zebra", display: "zebra", tier: "core", pos: "noun", rank: 40, chart: "drift", degree: 0 },
  ],
  edges: [
    { source: "speak", target: "talk", type: "synonym" },
    { source: "talk", target: "move", type: "collocation" },
  ],
};
