# Dictionary v2 Foundation Design

**Status:** Approved in conversation on 2026-08-14

**Scope:** The learner-facing word API, Star Atlas detail drawer, tutor grounding, claim readiness, and dictionary-quality reporting

## Context

The Star Atlas currently teaches each lemma through one wiki definition, one displayed example, and a set of typed word links. The word API already fetches IPA, regional audio, up to six senses, and synonyms from Free Dictionary API, but the drawer discards everything except IPA. The wiki has broad graph coverage, yet 9,465 of 12,115 pages have no example and only 29,260 of 78,103 links carry a teaching gloss. Almost every advanced page is an LLM-authored draft without a sourced example.

The first Dictionary v2 release must improve what learners can understand immediately without fabricating missing usage data or destructively rewriting the corpus. It establishes a stable learner-facing profile that can later be filled by a controlled dictionary enrichment pipeline.

## Goals

- Show the important meanings already available from the wiki and Free Dictionary API instead of collapsing every lemma to one sense.
- Prefer sourced dictionary meaning over an LLM-only advanced draft.
- Show real UK/US audio when available and retain browser speech as a fallback.
- Separate meaning, usage, and connections into a readable Star Atlas drawer that works on desktop and mobile.
- Preserve every authored connection gloss exactly; never paraphrase or invent a missing gloss.
- Clearly label unexplained links as unreviewed map links.
- Prevent a learner from newly claiming a word when the card lacks a trustworthy meaning or sourced usage example.
- Ground the tutor and composition exercises in the same learner-facing meaning data.
- Add deterministic quality reporting so future enrichment can be measured safely.

## Non-goals

- This release does not rewrite all 12,115 wiki pages.
- It does not scrape Cambridge Dictionary or present Free Dictionary API data as Cambridge content.
- It does not generate examples, grammar patterns, collocations, or usage notes at request time.
- It does not remove existing graph edges from the galaxy.
- It does not revoke words already held by an explorer.
- It does not add a second database for dictionary content.

## Learner Profile Contract

`lib/content/word-learning.ts` owns a pure `buildWordLearningProfile(page, detail)` transformation. The API continues returning raw `page` and `detail` fields for compatibility, and adds a normalized `learning` profile:

```ts
type LearningEvidence = "verified" | "source-backed" | "ai-draft";

type LearningSense = {
  id: string;
  partOfSpeech: string;
  definition: string;
  example: string | null;
  source: "wiki" | "dictionaryapi";
  primary: boolean;
};

type LearningExample = {
  text: string;
  source: "wiki" | "dictionaryapi";
};

type LearningConnection = WikiConnection & {
  explained: boolean;
};

type WordLearningProfile = {
  lemma: string;
  display: string;
  tier: "core" | "advanced";
  partOfSpeech: string;
  forms: string[];
  status: string;
  sources: string[];
  evidence: LearningEvidence;
  evidenceLabel: string;
  pronunciation: {
    ipa: string | null;
    audioUk: string | null;
    audioUs: string | null;
    audioAny: string | null;
  };
  senses: LearningSense[];
  examples: LearningExample[];
  usageNote: string | null;
  connections: LearningConnection[];
  canClaim: boolean;
  claimBlockReason: string | null;
};
```

The existing markdown parser adds `sources` and optional `usageNote` to `WikiPage`. Markdown remains the source of truth.

## Meaning Selection

Definitions are normalized only for deduplication; displayed wording is preserved exactly.

1. A verified wiki definition remains the primary sense.
2. A core page backed by `wordnet`, `dictionaryapi`, `tatoeba`, or `curated` keeps its wiki definition first.
3. An advanced page whose only source is `llm` is an AI draft. If live dictionary senses exist, the first live sense becomes primary and the draft wiki definition is not presented as a sourced sense.
4. If an AI draft has no live dictionary sense, its definition remains visible with an explicit draft warning so the drawer never becomes blank, but the word is not claimable.
5. Remaining live senses are appended in API order, deduplicated by case-folded definition, up to six total senses.
6. Examples combine real wiki bullets and live sense examples, preserve source labels, deduplicate exact text, and never synthesize a fallback sentence.

## Claim Readiness

A new claim requires both:

- a trustworthy primary meaning (`verified` or `source-backed`), and
- at least one sourced example in the normalized profile.

An existing held word remains held. The UI disables the check action for an incomplete card and explains the missing requirement. The quiz uses the normalized primary sense and first normalized example. This is a product-quality gate, not an anti-cheat mechanism; direct collection API hardening is a separate server-authority task.

## Drawer Experience

The drawer preserves the approved Star Atlas visual language: observatory-black glass, Instrument Serif display type, Plex body/mono labels, chart hue, and a maximum desktop width near the existing 420 pixels.

Three accessible tabs keep dense information understandable:

### Meaning

- Word, chart, IPA, part of speech, tier, and evidence badge
- Real UK and US pronunciation buttons when available; one fallback speech button otherwise
- Primary definition and its source
- Other available senses, each with POS, definition, source, and optional example
- Honest AI-draft warning when no sourced sense is available

### Use

- All sourced examples rather than only the first
- Forms from wiki frontmatter
- Optional authored `## Usage note`
- Existing “use it in a sentence” action for held words
- An honest empty state when usage guidance has not been authored

### Connect

- Explained connections first, grouped by existing relationship type
- Original gloss displayed verbatim
- Unexplained connections in a secondary “Unreviewed map links” group
- Clicking any target retains existing galaxy navigation
- Relation labels explain the edge type but do not claim nuance that is absent from the wiki

Tabs use semantic `role="tablist"`, `role="tab"`, `aria-selected`, and labelled tab panels. Buttons retain visible focus treatment and usable touch targets.

## Tutor and Composition

The tutor receives the normalized primary sense, additional senses, sourced examples, and only explained connection glosses. Its system prompt explicitly states that unexplained map links are not verified teaching facts. It must not invent a relation to fill a gap.

Composition tasks continue using `advanced_form`, `builds_on`, `intensity`, `antonym`, and `collocation`, but learner-facing pair tasks require a gloss. The selected task definitions are replaced with normalized primary definitions before grading where live dictionary data is available. This avoids grading against an LLM example sentence masquerading as a definition.

## Quality Reporting

`lib/wiki/dictionary-quality.ts` provides pure page-level findings. `scripts/audit-dictionary.ts` scans the corpus and prints aggregate counts plus per-list coverage for:

- missing or placeholder definitions
- no sourced examples
- unknown part of speech
- LLM-only advanced definitions
- zero connections
- unexplained connections by type
- verified, source-backed, and draft status

`npm run audit:dictionary` is read-only and exits successfully while debt exists. `npm run audit:dictionary -- --strict` exits non-zero when any page has a placeholder definition or when an advanced page is LLM-only. This permits measurement now and future CI enforcement after content migration.

## Error Handling

- A dictionary network failure falls back to wiki content and never blocks the drawer from opening.
- Missing audio falls back to browser speech.
- Audio playback rejection falls back to browser speech without replacing text content.
- Missing examples or usage notes produce an honest empty state, not generated content.
- An AI-only advanced page is clearly marked and cannot begin a new claim check.
- The API preserves raw compatibility fields so existing clients do not break during rollout.

## Performance

- Word details remain demand-loaded only after star selection.
- The pure profile is built server-side and serialized once.
- No dictionary content enters manifests, chart shards, or the initial React payload.
- Independent rarity and dictionary requests remain parallel.
- The drawer component receives one compact profile and does not import server-only wiki or dictionary code.

## Verification

- Parser tests cover `sources` and `## Usage note`.
- Profile tests cover source precedence, deduplication, AI-draft rescue, claim readiness, examples, pronunciation, and unchanged glosses.
- Tutor-context tests prove only explained relations are sent to the model.
- Drawer-model tests prove explained/unreviewed separation and stable relation ordering.
- Existing tests, TypeScript, ESLint, and production build must pass.
- Browser verification covers one source-backed core word, one polysemous word, and one LLM-only advanced draft at desktop and narrow widths.

## Future Content Migration

After this foundation ships, a separate resumable enrichment job can source and review sense-level examples, grammar patterns, collocation phrases, usage labels, and common errors. It should prioritize NGSL by SFI, then Academic, Business, TOEIC, Fitness, and finally advanced expansion. The profile contract is designed so that migration enriches the same drawer without another frontend redesign.
