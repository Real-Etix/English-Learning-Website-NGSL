import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WordLearningProfile } from "@/lib/content/word-learning";
import { WordLearningDrawer } from "./word-learning-drawer";

const profile: WordLearningProfile = {
  lemma: "anchor",
  display: "anchor",
  tier: "core",
  partOfSpeech: "noun",
  forms: ["anchors"],
  status: "verified",
  sources: ["wordnet"],
  evidence: "verified",
  evidenceLabel: "Verified",
  pronunciation: { ipa: "/ˈæŋ.kər/", audioUk: null, audioUs: null, audioAny: null },
  senses: [{ id: "wiki:0", partOfSpeech: "noun", definition: "a heavy object that holds a vessel", example: null, source: "wiki", primary: true }],
  examples: [{ text: "The boat dropped anchor.", source: "wiki" }],
  usageNote: null,
  connections: [],
  canClaim: true,
  claimBlockReason: null,
};

function openingTag(markup: string, id: string) {
  const start = markup.indexOf(`<div id="${id}"`);
  const end = markup.indexOf(">", start);
  return markup.slice(start, end + 1);
}

function composeButton(markup: string) {
  const match = markup.match(/<button\b[^>]*>◆ Used in a sentence<\/button>/);
  if (!match) throw new Error("Expected a solid-word compose button");
  return match[0];
}

describe("WordLearningDrawer", () => {
  it("renders a stable tabpanel for every tab control", () => {
    const markup = renderToStaticMarkup(
      <WordLearningDrawer
        profile={profile}
        display="anchor"
        partOfSpeech="noun"
        loadState="ready"
        errorMessage={null}
        chart={{ name: "NGSL", hue: "#BFD9F2", glyph: "A" }}
        held={false}
        solid={false}
        xp={10}
        rarity={{ word: "Common", dot: "#BFD9F2", text: "1,000 words" }}
        onClose={() => {}}
        onRetry={() => {}}
        onNavigate={() => {}}
        onOpenQuiz={() => {}}
        onCompose={() => {}}
        onSpeak={() => {}}
        onPlayAudio={() => {}}
        displayConnection={(lemma) => lemma}
      />,
    );
    const panelIds = Array.from(markup.matchAll(/<button\b[^>]*\brole="tab"[^>]*\baria-controls="([^"]+)"/g), ([, id]) => id);

    expect(panelIds).toHaveLength(3);
    expect((markup.match(/role="tabpanel"/g) ?? [])).toHaveLength(3);

    for (const panelId of panelIds) {
      expect(openingTag(markup, panelId)).toContain('role="tabpanel"');
    }

    expect(openingTag(markup, panelIds[0])).toContain('aria-hidden="false"');
    for (const panelId of panelIds.slice(1)) {
      const panel = openingTag(markup, panelId);
      expect(panel).toContain('hidden=""');
      expect(panel).toContain('aria-hidden="true"');
    }
  });

  it("keeps the compose action enabled for a solid held word", () => {
    const markup = renderToStaticMarkup(
      <WordLearningDrawer
        profile={profile}
        display="anchor"
        partOfSpeech="noun"
        loadState="ready"
        errorMessage={null}
        chart={{ name: "NGSL", hue: "#BFD9F2", glyph: "A" }}
        held
        solid
        xp={10}
        rarity={{ word: "Common", dot: "#BFD9F2", text: "1,000 words" }}
        onClose={() => {}}
        onRetry={() => {}}
        onNavigate={() => {}}
        onOpenQuiz={() => {}}
        onCompose={() => {}}
        onSpeak={() => {}}
        onPlayAudio={() => {}}
        displayConnection={(lemma) => lemma}
      />,
    );

    expect(composeButton(markup)).not.toContain("disabled");
  });
});
