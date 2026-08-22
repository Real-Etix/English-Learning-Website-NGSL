# Vocabulary v2 Completion Design

## Context

The Dictionary v2 foundation already normalizes live dictionary senses, displays
recordings and multiple meanings, separates explained from unreviewed connections,
blocks claims without trustworthy evidence and a sourced example, and grounds tutor
context in the selected word profile. It also exposes a read-only quality audit.

The remaining work is content-model completion and controlled corpus migration. The
current corpus still includes placeholder definitions, many words without examples,
unexplained graph edges, and thousands of LLM-only advanced drafts. Existing
enrichment can still create additional advanced Markdown pages, so publication rules
must be strengthened before enrichment resumes.

This design depends on the Canonical NDJSON Vocabulary Pipeline. Vocabulary v2 work
updates canonical records through that pipeline and never edits Markdown.

## Goals

- Stop creation of unsupported advanced vocabulary.
- Persist sense-level definitions, examples, pronunciation, usage guidance,
  collocations, common mistakes, and source attribution in canonical records.
- Ensure every claimable word has a trustworthy published sense and at least one
  sourced example for that sense.
- Ensure every learner-facing connection has an authored, non-empty gloss.
- Rebuild content in the order NGSL by descending SFI, Academic, Business, TOEIC,
  Fitness, then advanced expansion.
- Hide unsupported advanced drafts until dictionary-backed content is approved.
- Ground tutor and composition tasks in an explicitly selected sense and only
  published explained connections.
- Make enrichment resumable, budgeted, deterministic, and reviewable through pull
  requests.

## Non-goals

- Do not generate definitions, examples, sources, or connection explanations at
  request time.
- Do not label Free Dictionary API content as Cambridge Dictionary content.
- Do not automatically treat LLM output as factual evidence.
- Do not expose hidden advanced drafts merely to preserve the current star count.
- Do not add a vector database or semantic embeddings in this phase.
- Do not allow public users to edit or approve dictionary content.

## Publication Model

Words have a separate publication state:

```ts
type PublicationStatus = "draft" | "review" | "published" | "hidden";
```

Evidence remains derived from verified status and source references rather than an
LLM-provided claim. A word is learner-visible only when its publication state is
`published`. A hidden word remains available to enrichment and audit tooling but is
excluded from public manifests, search, routes, tutor context, and claim flows.

An advanced word whose only source is `llm`, or whose primary sense lacks a factual
source and sourced example, is migrated to `hidden` before new enrichment begins.

## Sense-level Model

Each word stores one or more senses:

```ts
type VocabularySense = {
  id: string;
  partOfSpeech: string;
  definition: string;
  labels: string[];
  sources: ContentSourceRef[];
  examples: SenseExample[];
  usagePatterns: UsagePattern[];
  collocations: CollocationPhrase[];
  commonMistakes: CommonMistake[];
  status: "draft" | "review" | "published";
};
```

Sense IDs are deterministic from lemma, source ID, source sense key, and definition
hash. Re-running a source import updates the same sense rather than creating a new
one. Definitions and examples retain their source wording; learner-friendly authored
explanations are stored separately and never overwrite source text.

Usage patterns include a pattern string, one explanation, at least one sourced
example, source references, and publication status. Collocations store the complete
phrase, not merely another-word target. Common mistakes store the incorrect form,
correction, explanation, and evidence source.

## Source Model

Every factual object references a source registry entry with source ID, provider,
external reference or URL when permitted, retrieval date, license note, and content
hash. Supported factual evidence begins with curated content, WordNet, Free Dictionary
API, and Tatoeba where licensing permits. `llm` records authorship of a proposal but
never satisfies factual evidence requirements.

External API failures produce an explicit unavailable result and do not create a
replacement definition. Source text is cached into canonical records only through an
enrichment pull request, so public requests do not depend on live source availability.

## Claim Readiness

A word can be newly claimed only when:

1. the word is published;
2. the selected sense is published;
3. the selected sense has a verified or factual source;
4. the selected sense has at least one sourced example; and
5. the API response lemma and selected sense belong to the requested word.

Existing held words remain held. If their content becomes hidden, composition and
review history remain visible, but new claims and new public discovery are blocked.

The current profile-level claim rule remains as compatibility behavior until all
clients send a selected `senseId`.

## Learner-facing Connections

Only `status: published` connections with a non-empty gloss appear in public word
details, composition tasks, tutor context, and generated graph teaching overlays.
Unglossed legacy edges remain available to clustering only during migration and are
reported as content debt. They are not presented as explained relationships.

Enrichment may propose a gloss, but publication requires either a supporting source
or explicit human approval. Symmetric and inverse edge rules remain enforced.

## Ordered Corpus Program

Content rebuilding uses resumable batches in this exact order:

1. NGSL, descending SFI and then ascending rank;
2. Academic, ascending rank;
3. Business, ascending rank;
4. TOEIC, ascending rank;
5. Fitness, ascending rank;
6. hidden advanced drafts ordered by number of published core anchors and then
   usefulness evidence from approved clippings.

A lemma appearing in multiple lists is processed once at its earliest priority.
Every batch stores its selection criteria and starting manifest checksum so the same
batch can be reproduced. A configurable item limit and model-token ceiling stop the
batch before exceeding budget.

## Enrichment Workflow

Before any call, the worker skips records that already satisfy the requested content
contract. For each selected word it:

1. retrieves factual dictionary data;
2. maps source senses without paraphrasing;
3. retrieves or preserves sourced examples;
4. asks the LLM only for bounded learner-guidance proposals such as explanations,
   pattern candidates, mistake candidates, and connection-gloss candidates;
5. validates structure, sources, target existence, and duplicate content;
6. writes changes to an enrichment branch;
7. runs focused and corpus audits;
8. opens a pull request describing factual additions separately from AI proposals.

No advanced record is created solely because an LLM suggested a word. A new advanced
record requires a supported dictionary sense, a sourced example, and at least one
explained connection to a published core anchor before it can enter review.

## Advanced-draft Quarantine

The current audit reports approximately 6,133 LLM-only advanced pages. Migration
recalculates the exact count and marks every unsupported record hidden. The generated
public graph excludes those records until they pass publication requirements.

Revalidation is incremental. A hidden record becomes reviewable only after factual
definition and example import. It becomes published only after its anchor connection
has a gloss and all lint rules pass. The audit reports hidden, reviewable, published,
and rejected counts independently.

## Selected-sense Tutor and Composition

The word drawer exposes a stable `senseId` for every displayed meaning. Tutor and
composition requests include `{ lemma, senseId }`. The server verifies ownership of
the sense, then provides only:

- the selected published sense;
- that sense's sourced examples;
- published usage patterns, collocations, and common-mistake guidance;
- published explained connections relevant to that sense;
- source labels and evidence state.

The tutor is instructed not to invent missing guidance or relationships. Composition
partner selection requires a published explained connection and uses the selected
sense definitions for both words.

## Quality Audit

The dictionary audit expands to report globally and per list:

- publication states;
- words and senses without factual sources;
- senses without sourced examples;
- missing usage patterns and common-mistake coverage;
- published, hidden, explained, and unexplained connections;
- advanced quarantine and revalidation progress;
- selected-sense claim readiness;
- source-provider coverage.

Strict mode fails for any published placeholder, published unsupported sense,
claimable sense without a sourced example, or learner-facing connection without a
gloss. Hidden drafts and ordinary optional-coverage debt remain reportable without
making normal builds fail.

## Error Handling and Safety

- Dictionary or LLM timeouts keep the job item pending or failed with bounded retries.
- Partial source responses cannot overwrite stronger existing evidence.
- Verified records are never automatically overwritten.
- A failed batch cannot modify the default branch.
- Duplicate retries are idempotent through deterministic sense IDs and content hashes.
- Secrets stay in GitHub Actions and Vercel environment settings and never enter
  browser payloads, logs, generated assets, or URLs.
- Enrichment stops on schema, lint, count, budget, or artifact-generation failure.

## Verification

- Unit tests cover sense identity, source precedence, deduplication, publication,
  claim readiness, connection visibility, ordering, and idempotent retries.
- Migration tests prove unsupported advanced records become hidden.
- API tests prove `senseId` mismatch and hidden content are rejected.
- Tutor and composition tests prove only the selected sense and published explained
  relationships are included.
- Artifact tests prove hidden records are absent from public search, charts, and full
  galaxy output.
- A fixture GitHub Actions run produces a deterministic review branch with no secret
  leakage.
- Full tests, TypeScript, ESLint, strict publication audit, graph build, and Next.js
  production build pass before each content pull request can merge.

## Acceptance Criteria

- Legacy advanced-page generation is disabled before the first enrichment run.
- Canonical records persist all Vocabulary v2 sense-level fields.
- New claims require a selected source-backed sense and sourced example.
- No learner-facing connection lacks a gloss.
- NGSL enrichment follows descending SFI before other lists begin.
- Every unsupported LLM-only advanced record is hidden or revalidated.
- Tutor and composition requests are grounded in an explicitly selected sense.
- Public requests use generated content and never perform live LLM enrichment.
- Quality reports make remaining optional and blocking content debt distinguishable.

