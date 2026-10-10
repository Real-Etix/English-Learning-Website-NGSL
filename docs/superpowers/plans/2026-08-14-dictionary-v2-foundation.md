# Dictionary v2 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Star Atlas word card into an evidence-aware learner dictionary that shows multiple meanings, sourced examples, real audio, trustworthy connections, and honest claim readiness.

**Architecture:** Parse source metadata from the wiki, combine one wiki page with demand-loaded Free Dictionary API detail in a pure server-side profile, and render that profile through a focused client drawer. Tutor, quiz, and quality reporting consume the same contract so meaning selection is consistent without adding dictionary content to the initial galaxy payload.

**Tech Stack:** Next.js 16.2 App Router, React 19.2, TypeScript 5, Vitest 4, existing Markdown wiki, Free Dictionary API, existing Star Atlas UI.

## Global Constraints

- Wiki markdown remains the source of truth; do not rewrite the 12,115 pages in this release.
- Free Dictionary API content must never be labelled Cambridge content.
- Preserve authored definitions, examples, and connection glosses verbatim; do not fabricate missing content.
- An LLM-only advanced page is an AI draft unless live dictionary evidence safely replaces its displayed primary sense.
- A new claim requires a trustworthy primary meaning and at least one sourced example; existing held words remain held.
- Word content remains demand-loaded after selection and must not enter galaxy manifests or chart shards.
- Keep raw `page` and `detail` API fields during migration.
- Keep the approved Star Atlas visual language and a usable narrow/mobile drawer.
- Use semantic tabs, accessible names, visible focus, and touch-sized controls.
- The tutor may receive only authored connection glosses as grounded relation explanations.
- No remote Git push; Eric owns the GitHub-to-Vercel push.
- Follow test-first red/green cycles for production behavior.

---

### Task 1: Wiki Metadata and Learner Profile

**Files:**
- Modify: `lib/wiki/parse-wiki.ts`
- Modify: `lib/wiki/parse-wiki.test.ts`
- Create: `lib/content/word-learning.ts`
- Create: `lib/content/word-learning.test.ts`

**Interfaces:**
- Consumes: `WikiPage`, `WikiConnection`, `WordDetail`.
- Produces: `LearningEvidence`, `LearningSense`, `LearningExample`, `LearningConnection`, `WordLearningProfile`, `buildWordLearningProfile(page, detail)`.

- [ ] **Step 1: Write failing parser tests**

Extend the test fixture frontmatter with `sources: [wordnet, llm]`, append `## Usage note\nUsually used before a concrete noun.`, and assert:

```ts
expect(p.sources).toEqual(["wordnet", "llm"]);
expect(p.usageNote).toBe("Usually used before a concrete noun.");
```

- [ ] **Step 2: Verify the parser tests fail for missing fields**

Run: `npx vitest run lib/wiki/parse-wiki.test.ts`

Expected: FAIL because `WikiPage` does not expose `sources` or `usageNote`.

- [ ] **Step 3: Implement the minimal parser extension**

Add to `WikiPage`:

```ts
sources: string[];
usageNote: string | null;
```

Populate them with `parseYamlList(fm.sources)` and `sectionBody(body, "Usage note") || null`.

- [ ] **Step 4: Verify the parser tests pass**

Run: `npx vitest run lib/wiki/parse-wiki.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing learner-profile tests**

Create focused fixtures and assert these independent behaviors in `lib/content/word-learning.test.ts`:

```ts
expect(buildWordLearningProfile(corePage, detail).senses.map((sense) => sense.definition))
  .toEqual(["wiki meaning", "second dictionary meaning"]);

expect(buildWordLearningProfile(aiDraftAdvancedPage, detail).senses[0])
  .toMatchObject({ definition: "sourced dictionary meaning", source: "dictionaryapi", primary: true });

expect(buildWordLearningProfile(aiDraftAdvancedPage, emptyDetail))
  .toMatchObject({ evidence: "ai-draft", canClaim: false });

expect(buildWordLearningProfile(corePageWithoutExamples, emptyDetail).claimBlockReason)
  .toMatch(/example/i);

expect(buildWordLearningProfile(corePage, detail).connections[0].gloss)
  .toBe(corePage.connections[0].gloss);
```

Also test exact example deduplication, placeholder rejection, pronunciation copying, verified evidence, and the six-sense cap.

- [ ] **Step 6: Verify the profile tests fail because the module is missing**

Run: `npx vitest run lib/content/word-learning.test.ts`

Expected: FAIL because `word-learning.ts` does not exist.

- [ ] **Step 7: Implement the pure profile builder**

Use exported serializable types from the design. Implement these helpers without network or filesystem access:

```ts
const FACTUAL_SOURCES = new Set(["curated", "wordnet", "dictionaryapi", "tatoeba"]);
const normalizeText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const isPlaceholder = (value: string) => /definition pending|needs a fuller dictionary source/i.test(value);
```

Apply the design's precedence rules, preserve displayed strings, deduplicate senses by normalized definition and examples by normalized text, mark each connection with `explained: Boolean(connection.gloss?.trim())`, and compute `canClaim` only after evidence and example aggregation are complete.

- [ ] **Step 8: Run focused and parser tests**

Run: `npx vitest run lib/content/word-learning.test.ts lib/wiki/parse-wiki.test.ts`

Expected: PASS.

---

### Task 2: Word API, Tutor Grounding, and Safe Composition Context

**Files:**
- Modify: `app/api/word/[lemma]/route.ts`
- Create: `lib/content/tutor-context.ts`
- Create: `lib/content/tutor-context.test.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/compose/route.ts`
- Create: `lib/compose/tasks.test.ts`
- Modify: `lib/compose/tasks.ts`

**Interfaces:**
- Consumes: `buildWordLearningProfile(page, detail)` from Task 1.
- Produces: word response `{ page, detail, learning, rarity }`, `buildTutorStarContext(profile)`, and composition tasks that require authored relation glosses.

- [ ] **Step 1: Write failing tutor-context tests**

Assert that context contains primary/additional senses and sourced examples, includes an explained gloss verbatim, excludes an unexplained target, and labels an AI draft:

```ts
const context = buildTutorStarContext(profile);
expect(context).toContain("Primary meaning:");
expect(context).toContain("formal process only");
expect(context).not.toContain("unreviewed-target");
expect(buildTutorStarContext(draftProfile)).toContain("AI draft");
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run lib/content/tutor-context.test.ts`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement deterministic tutor context**

Create `buildTutorStarContext(profile)` that emits word metadata, evidence, up to four senses, up to three sourced examples, optional usage note, and up to twelve connections filtered to `explained === true`. End with: `Do not invent missing usage guidance or relationships.`

- [ ] **Step 4: Verify tutor context GREEN**

Run: `npx vitest run lib/content/tutor-context.test.ts`

Expected: PASS.

- [ ] **Step 5: Add the normalized profile to the word route**

After `page` resolves, keep dictionary detail and rarity parallel:

```ts
const [detail, rarity] = await Promise.all([
  fetchWordDetail(lemma),
  getWordRarity(lemma).catch(() => null),
]);
const learning = buildWordLearningProfile(page, detail);
return Response.json({ page, detail, learning, rarity });
```

- [ ] **Step 6: Ground chat in the normalized profile**

Replace the hand-built single-definition block with `fetchWordDetail`, `buildWordLearningProfile`, and `buildTutorStarContext`. Preserve the existing rate limit and history truncation. Do not send unexplained edges as teaching facts.

- [ ] **Step 7: Write failing composition tests**

Add tests proving `pickTask` ignores an otherwise high-priority partner whose gloss is null and still selects an explained partner. Add a test that all returned task definitions equal the definitions supplied to `pickTask`.

- [ ] **Step 8: Verify composition RED**

Run: `npx vitest run lib/compose/tasks.test.ts`

Expected: FAIL because current `pickTask` accepts unglossed relations.

- [ ] **Step 9: Require an authored teaching gloss for pair selection**

In `pickTask`, skip candidates where `!link.gloss?.trim()`. In the compose route, after choosing a task, fetch dictionary detail only for the target and selected partner in parallel, build their profiles, and replace `task.defs` with each profile's primary definition when available. Fall back to the existing wiki definition on remote failure.

- [ ] **Step 10: Verify focused API-domain tests**

Run: `npx vitest run lib/content/tutor-context.test.ts lib/content/word-learning.test.ts lib/compose/tasks.test.ts`

Expected: PASS.

---

### Task 3: Accessible Star Atlas Learning Drawer

**Files:**
- Create: `components/network/word-learning-drawer-model.ts`
- Create: `components/network/word-learning-drawer-model.test.ts`
- Create: `components/network/word-learning-drawer.tsx`
- Modify: `components/network/star-atlas.tsx`

**Interfaces:**
- Consumes: `WordLearningProfile`, chart metadata, collection state, XP/rarity, and existing selection/quiz/compose callbacks.
- Produces: `buildWordLearningDrawerModel(profile)`, `WordLearningDrawer`, and audio/claim integration in `StarAtlas`.

- [ ] **Step 1: Write failing drawer-model tests**

Assert stable connection ordering, explained/unreviewed separation, all examples retained, primary/additional sense separation, and audio availability:

```ts
const model = buildWordLearningDrawerModel(profile);
expect(model.primarySense.primary).toBe(true);
expect(model.otherSenses).toHaveLength(2);
expect(model.explainedGroups[0].items[0].gloss).toBe("authored words unchanged");
expect(model.unreviewedCount).toBe(2);
expect(model.examples).toEqual(profile.examples);
```

- [ ] **Step 2: Verify drawer-model RED**

Run: `npx vitest run components/network/word-learning-drawer-model.test.ts`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the pure drawer model**

Use the existing relation order and display labels. Group explained and unexplained connections separately without changing target, type, or gloss. Keep all current examples and up to five non-primary senses.

- [ ] **Step 4: Verify drawer-model GREEN**

Run: `npx vitest run components/network/word-learning-drawer-model.test.ts`

Expected: PASS.

- [ ] **Step 5: Build the focused drawer component**

Create a client component with `Meaning`, `Use`, and `Connect` tabs. It must:

```tsx
<div role="tablist" aria-label="Word learning sections">
  <button role="tab" aria-selected={tab === "meaning"}>Meaning</button>
  <button role="tab" aria-selected={tab === "use"}>Use</button>
  <button role="tab" aria-selected={tab === "connect"}>Connect</button>
</div>
```

Render source/evidence labels, sense POS, examples, forms, usage note, verbatim glosses, and an honest empty state. Put unexplained links behind an explicit `Unreviewed map links (N)` disclosure. Preserve the Star Atlas fonts, colours, chart hue, glass background, and close/navigation behavior.

- [ ] **Step 6: Integrate profile, audio, quiz, and claim readiness**

Change `WordResponse` to include `learning`. Replace the inline drawer with `WordLearningDrawer`. Audio playback chooses requested regional audio, normalizes protocol-relative URLs, and falls back to the existing browser speech handler when playback rejects. `openQuiz` consumes the normalized primary definition/example and refuses to open when `canClaim` is false, showing the exact `claimBlockReason`. Existing held words retain compose access.

- [ ] **Step 7: Run focused tests and TypeScript**

Run: `npx vitest run components/network/word-learning-drawer-model.test.ts lib/content/word-learning.test.ts && npx tsc --noEmit`

Expected: PASS with no type errors.

---

### Task 4: Dictionary Quality Audit and Contract Documentation

**Files:**
- Create: `lib/wiki/dictionary-quality.ts`
- Create: `lib/wiki/dictionary-quality.test.ts`
- Create: `scripts/audit-dictionary.ts`
- Modify: `package.json`
- Modify: `wiki/CLAUDE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `WikiPage[]` from `readAllPages()`.
- Produces: `auditDictionaryPages(pages)`, aggregate `DictionaryQualityReport`, and `npm run audit:dictionary`.

- [ ] **Step 1: Write failing quality-report tests**

Use small page fixtures and assert counts for placeholders, no examples, unknown POS, AI-only advanced pages, zero connections, total/unexplained edges by type, evidence buckets, and list-specific totals. Assert `hasStrictFailures(report)` is true only for placeholders or LLM-only advanced pages.

- [ ] **Step 2: Verify quality-report RED**

Run: `npx vitest run lib/wiki/dictionary-quality.test.ts`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the pure aggregate audit**

Walk pages once, update global and per-list counters, and return serializable data. Treat `verified` as verified, any factual source as source-backed, and remaining pages as draft. Count each connection type and whether `gloss?.trim()` is present.

- [ ] **Step 4: Verify quality-report GREEN**

Run: `npx vitest run lib/wiki/dictionary-quality.test.ts`

Expected: PASS.

- [ ] **Step 5: Add the read-only CLI**

`scripts/audit-dictionary.ts` loads all pages, prints totals and percentages in stable order, and sets `process.exitCode = 1` only when `--strict` is passed and `hasStrictFailures(report)` is true. Add:

```json
"audit:dictionary": "tsx scripts/audit-dictionary.ts"
```

- [ ] **Step 6: Update source-of-truth documentation**

Document optional `## Usage note`, factual source requirements, AI-draft meaning, claim readiness, and the audit command in `wiki/CLAUDE.md`. Update `README.md` to identify Free Dictionary API accurately and describe the normalized learner profile.

- [ ] **Step 7: Run the audit and complete verification suite**

Run:

```bash
npm run audit:dictionary
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Expected: audit prints existing debt and exits 0; tests, TypeScript, lint, and build exit 0.

- [ ] **Step 8: Browser verification**

Open `/network/ngsl`, inspect `get`, `bank`, and an LLM-only advanced word at desktop and narrow widths. Verify multiple senses, real-audio controls where available, tab keyboard operation, honest draft/empty states, explained/unreviewed link separation, and claim blocking. Record any external Dictionary API outage as a fallback-path observation, not fabricated success.
