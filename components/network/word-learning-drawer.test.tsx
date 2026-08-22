import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WordLearningProfile } from "@/lib/content/word-learning";
import { handleWordLearningTabKey, WordLearningDrawer } from "./word-learning-drawer";

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
  usagePatterns: [],
  collocations: [],
  commonMistakes: [],
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
  it("applies tab key side effects for handled keys and ignores unhandled keys", () => {
    const cases = [
      ["meaning", "ArrowLeft", "connect"],
      ["connect", "ArrowRight", "meaning"],
      ["meaning", "ArrowRight", "use"],
      ["use", "ArrowLeft", "meaning"],
      ["connect", "ArrowUp", "use"],
      ["meaning", "ArrowUp", "connect"],
      ["use", "ArrowDown", "connect"],
      ["connect", "ArrowDown", "meaning"],
      ["use", "Home", "meaning"],
      ["meaning", "End", "connect"],
    ] as const;

    for (const [current, key, next] of cases) {
      let prevented = 0;
      const selected: string[] = [];
      const focused: string[] = [];

      expect(handleWordLearningTabKey(
        { key, preventDefault: () => { prevented += 1; } },
        current,
        "tabs",
        (tab) => selected.push(tab),
        (focusId) => focused.push(focusId),
      )).toBe(true);
      expect(prevented).toBe(1);
      expect(selected).toEqual([next]);
      expect(focused).toEqual([`tabs-${next}`]);
    }

    let prevented = 0;
    const selected: string[] = [];
    const focused: string[] = [];
    expect(handleWordLearningTabKey(
      { key: "PageDown", preventDefault: () => { prevented += 1; } },
      "use",
      "tabs",
      (tab) => selected.push(tab),
      (focusId) => focused.push(focusId),
    )).toBe(false);
    expect(prevented).toBe(0);
    expect(selected).toEqual([]);
    expect(focused).toEqual([]);
  });

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
        selectedSenseId="wiki:0"
        onSelectSense={() => {}}
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
        selectedSenseId="wiki:0"
        onSelectSense={() => {}}
        onOpenQuiz={() => {}}
        onCompose={() => {}}
        onSpeak={() => {}}
        onPlayAudio={() => {}}
        displayConnection={(lemma) => lemma}
      />,
    );

    expect(composeButton(markup)).not.toContain("disabled");
  });

  it("keeps the compose action enabled for a solid held word while learning details load", () => {
    const markup = renderToStaticMarkup(
      <WordLearningDrawer
        profile={null}
        display="anchor"
        partOfSpeech="noun"
        loadState="loading"
        errorMessage={null}
        chart={{ name: "NGSL", hue: "#BFD9F2", glyph: "A" }}
        held
        solid
        xp={null}
        rarity={{ word: "Rarity unavailable", dot: "#94A0B4", text: "Loading learning details" }}
        onClose={() => {}}
        onRetry={() => {}}
        onNavigate={() => {}}
        selectedSenseId="wiki:0"
        onSelectSense={() => {}}
        onOpenQuiz={() => {}}
        onCompose={() => {}}
        onSpeak={() => {}}
        onPlayAudio={() => {}}
        displayConnection={(lemma) => lemma}
      />,
    );

    expect(composeButton(markup)).not.toContain("disabled");
  });

  it("renders sourced published guidance and honest empty Use states", () => {
    const sourcedProfile: WordLearningProfile = {
      ...profile,
      usagePatterns: [{
        pattern: "anchor + noun",
        explanation: "Used with something held firmly.",
        examples: [{ text: "Anchor the tent.", sources: [{ sourceId: "curated", label: "Manual curation", externalId: null, url: null, retrievedAt: null, contentHash: null }] }],
        sources: [{ sourceId: "curated", label: "Manual curation", externalId: null, url: null, retrievedAt: null, contentHash: null }],
      }],
      collocations: [{
        phrase: "drop anchor",
        explanation: "a common nautical phrase",
        sources: [{ sourceId: "curated", label: "Manual curation", externalId: null, url: null, retrievedAt: null, contentHash: null }],
      }],
      commonMistakes: [{
        incorrect: "anchor to the tent",
        correction: "anchor the tent",
        explanation: "Anchor takes a direct object here.",
        sources: [{ sourceId: "curated", label: "Manual curation", externalId: null, url: null, retrievedAt: null, contentHash: null }],
      }],
    };
    const render = (drawerProfile: WordLearningProfile) => renderToStaticMarkup(
      <WordLearningDrawer
        profile={drawerProfile}
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
        selectedSenseId="wiki:0"
        onSelectSense={() => {}}
        onOpenQuiz={() => {}}
        onCompose={() => {}}
        onSpeak={() => {}}
        onPlayAudio={() => {}}
        displayConnection={(lemma) => lemma}
      />,
    );

    const sourcedMarkup = render(sourcedProfile);
    expect(sourcedMarkup).toContain("Patterns");
    expect(sourcedMarkup).toContain("Common phrases");
    expect(sourcedMarkup).toContain("Watch out");
    expect(sourcedMarkup).toContain("Manual curation");
    expect(sourcedMarkup).toContain("Used with something held firmly.");
    expect(sourcedMarkup).toContain("anchor to the tent");
    expect(sourcedMarkup).toContain("anchor the tent");

    const emptyMarkup = render(profile);
    expect(emptyMarkup).toContain("No reviewed usage patterns yet.");
    expect(emptyMarkup).toContain("No reviewed collocation phrases yet.");
    expect(emptyMarkup).toContain("No reviewed common mistakes yet.");
  });

  it("marks the selected additional meaning as the claim target", () => {
    const markup = renderToStaticMarkup(
      <WordLearningDrawer
        profile={{
          ...profile,
          senses: [profile.senses[0]!, {
            id: "anchor:wordnet:2",
            partOfSpeech: "verb",
            definition: "to secure something firmly",
            example: "Anchor the tent before the storm.",
            source: "wiki",
            primary: false,
            canClaim: true,
            claimBlockReason: null,
          }],
        }}
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
        selectedSenseId="anchor:wordnet:2"
        onSelectSense={() => {}}
        onOpenQuiz={() => {}}
        onCompose={() => {}}
        onSpeak={() => {}}
        onPlayAudio={() => {}}
        displayConnection={(lemma) => lemma}
      />,
    );

    expect(markup).toContain('data-sense-id="anchor:wordnet:2"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Anchor the tent before the storm.");
    expect(markup).not.toContain("The boat dropped anchor.");
  });
});
