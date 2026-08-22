import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WordLearningProfile } from "@/lib/content/word-learning";
import { tabNavigationForKey, WordLearningDrawer } from "./word-learning-drawer";

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
  it("maps tab keys to wrapping selection and the matching focus target", () => {
    expect(tabNavigationForKey("meaning", "ArrowLeft", "tabs")).toEqual({ next: "connect", focusId: "tabs-connect" });
    expect(tabNavigationForKey("connect", "ArrowRight", "tabs")).toEqual({ next: "meaning", focusId: "tabs-meaning" });
    expect(tabNavigationForKey("use", "Home", "tabs")).toEqual({ next: "meaning", focusId: "tabs-meaning" });
    expect(tabNavigationForKey("meaning", "End", "tabs")).toEqual({ next: "connect", focusId: "tabs-connect" });
    expect(tabNavigationForKey("use", "ArrowDown", "tabs")).toEqual({ next: "connect", focusId: "tabs-connect" });
    expect(tabNavigationForKey("use", "PageDown", "tabs")).toBeNull();
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
});
