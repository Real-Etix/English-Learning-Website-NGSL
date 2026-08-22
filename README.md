# NGSL Vocabulary Galaxy

A **Next.js** app that turns the [New General Service List (NGSL)](https://www.newgeneralservicelist.com/new-general-service-list) family of vocabulary lists into an explorable **3D universe of words**. Every word is a star; every line is a real relationship (synonym, antonym, "level-up" ladder). Learners orbit the galaxy, open a star for a dictionary-style entry, **collect** words into their own space, and explore other people's spaces to discover vocabulary they don't have yet.

It began as a flashcard trainer and was rebuilt around a versioned vocabulary corpus: canonical NDJSON records maintain the learner content and typed relationships that power the graph.

**Live demo:** https://english-learning-website-ngsl.vercel.app

---

## What's in it

- **3D vocabulary galaxy** (raw Three.js progressive constellations) — per list (NGSL, TOEIC, Business, Academic, Fitness) or "All". Orbit, zoom, search, and click a star to fly to it.
- **Evidence-aware word cards** — IPA + UK/US audio from the [Free Dictionary API](https://dictionaryapi.dev/), definitions, examples, the **advanced-word ladder** (`buy → purchase → procure`), synonyms/antonyms, and word family. The Free Dictionary API is not Cambridge Dictionary and its content is never labelled Cambridge.
- **AI assistant** — a floating DeepSeek-powered tutor that writes with a list's real vocabulary, explains/quizzes words, and checks your writing.
- **Collection spaces (Phase 1)** — collect words to earn XP, build **Your Space**, and share it (`/g/<slug>`). Visiting a space highlights the words you *don't* have in magenta.
- **Rarity & leaderboard (Phase 2)** — each word shows how rare it is across explorers; spaces are ranked by XP at `/leaderboard`.

---

## Architecture

### Canonical vocabulary is NDJSON

- `content/vocabulary/*.ndjson` is the only editable source of truth: one JSON vocabulary record per line, distributed across the 32 deterministic shards `00.ndjson` through `1f.ndjson`.
- Every record follows the v1 schema in `content/vocabulary/schema.json`: identity (`schemaVersion`, `lemma`, `display`, `tier`), grammatical/list metadata, source-backed senses and examples, pronunciation, usage guidance, typed connections, domains, and chart/region assignments. Runtime validation lives in `lib/vocabulary/schema.ts`.
- Normalize a lemma by trimming, lowercasing, and collapsing whitespace; its shard is `sha256(normalizedLemma)[0] & 31`, formatted as two lowercase hex digits. Keep records sorted by normalized lemma within each shard.
- `content/vocabulary/sources.json` is the source registry. Each source reference in a record must use a registered ID and retain its factual/provenance status.
- `wiki/raw/` remains the immutable clipping inbox. It is not an active vocabulary source. Markdown conversion code (`lib/vocabulary/legacy-markdown.ts`, `lib/vocabulary/migrate-markdown.ts`, and `scripts/migrate-wiki-to-ndjson.ts`) is **recovery-only**.

### Normalized learner profile

When a learner selects a word, the app keeps a compatibility-shaped projection of the
canonical record and the Free Dictionary API response, then builds a normalized learner profile. It prioritizes a
verified or factual-source-backed primary meaning, preserves authored examples and
connection glosses verbatim, labels unsupported content as an AI draft, and allows a
new claim only when a trustworthy meaning and sourced example are available. This
detail remains demand-loaded and is not included in the galaxy manifests.

### From NDJSON → generated learner artifacts (build-time)
`npm run build:graphs` reads the canonical corpus and pre-computes graph JSON, word shards, and progressive galaxy assets. Pages read the generated lite graphs (`lib/wiki/graph-store.ts`), and word detail is fetched per-click via `/api/word/[lemma]`.
> ⚠️ **After any canonical vocabulary change, run `npm run build:graphs` and commit the generated artifacts**, or the deployed galaxy can be stale.

### Progressive Star Atlas delivery
- The production `/network/[listSlug]` route is **manifest-only on the server**. It embeds a list manifest, not the whole chart graph.
- `npm run build:graphs` emits both the server graph JSON and the public progressive assets under `public/generated/galaxy/`:
  - one manifest per list
  - chart shards
  - search catalogs
  - optional full-list binaries
- `components/network/star-atlas.tsx` mounts the active client atlas: raw Three.js `ProgressiveStarEngine` plus `GalaxyController`, `ChartShardStore`, and `GalaxySearchCatalog`.
- The server/client boundary carries a compact manifest only; the first paint is a tiny CSS observatory shell with one lightweight chart proxy per manifest chart, then the controls and renderer boot after the browser is idle. `galaxy:constellation-visible` measures that first CSS constellation paint, while the deferred Three.js first frame is tracked separately at `galaxy:renderer-visible`. Chart shards and search catalogs are loaded lazily, and the **full** binary is never requested unless the learner explicitly opts into full-list mode.
- Full mode is optional and scoped to the selected list. Returning to constellation view drops back to the lighter progressive path.
- After chart names, canonical vocabulary, or generated search data change, rebuild the galaxy assets with `npm run build:graphs` and commit the refreshed outputs.

### User data → Postgres
Collections are per-user and mutable, so they live in **Postgres** (via **Prisma 7** with the `@prisma/adapter-pg` driver). Identity is an anonymous `ownerToken` cookie — no login. Models: `Collection`, `CollectedWord` (`prisma/schema.prisma`). Canonical vocabulary remains in Git; only "who collected what" is in the DB.

---

## Scripts

```bash
# Canonical vocabulary pipeline
npm run lint:vocabulary      # validate schemas, shards, sources, links, and reciprocity
npm run audit:dictionary     # read-only quality totals and per-list coverage
npm run build:graphs         # regenerate committed word, graph, and galaxy artifacts
npm run validate:vocabulary-migration # recovery parity check while legacy Markdown is available
npm run migrate:vocabulary -- --source=<legacy-pages> --out=<output> --force # RECOVERY-ONLY
npm run seed:spaces          # seed curated public explore-spaces (needs a DB)

# App
npm run dev                  # local dev
npm run build && npm start   # production
npm test                     # vitest (xp + graph logic)
npm run test:e2e             # progressive browser flow checks (Playwright)
npm run test:perf            # throttled browser performance gates (Playwright)
npm run lint
```

### Reviewed vocabulary enrichment

Canonical vocabulary lives in `content/vocabulary/*.ndjson`; edit those records, never generated output. To preview a local enrichment without changing files, run:

```bash
npm run enrich:vocabulary -- --list=ngsl --limit=20 --dry-run
```

After an intentional local enrichment, run `npm run lint:vocabulary`,
`npm run audit:dictionary`, `npm test`, `npx tsc --noEmit`, `npm run lint`,
`npm run build:graphs`, and `npm run build`. `build:graphs` regenerates the
committed graph data, public galaxy assets, and `data/generated/vocabulary/`
word shards (including that directory's manifest).

For production enrichment, manually run the **Vocabulary enrichment** GitHub
Actions workflow. Configure `LLM_API_KEY` as a repository Actions secret; set
`LLM_BASE_URL` and `LLM_MODEL` as optional repository variables. Keep
`dry_run` enabled to validate the full pipeline without creating a branch or
pull request. With `dry_run` disabled, the workflow validates every changed
or deleted path, then opens one `automation/vocabulary-<run-id>` pull request
only when validated changes exist. Review that PR before merging; the workflow
never pushes to the default branch. Review the generated diff and merge the PR only after the canonical records and generated artifacts are acceptable.

Never commit `.env` files or put `LLM_API_KEY` in workflow arguments, logs,
or generated artifacts. The workflow passes the key only through a masked
environment variable and rejects any diff outside canonical vocabulary or its
generated graph, word, and galaxy outputs.

### Recovery-only Markdown migration

`pre-ndjson-vocabulary` is a local recovery tag at the last commit containing the active Markdown corpus. Do not push it. If recovery is necessary, inspect or check out that tag, then run `npm run migrate:vocabulary` against a copied legacy `wiki/pages` directory to regenerate a separate NDJSON output. Do not revive Markdown as an active source or overwrite the canonical corpus without review.

---

## Local setup

```bash
npm install
```

**1. A local Postgres** (for collection/space features). Easiest via Docker:
```bash
docker run -d --name ngsl-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ngsl_mood_trainer -p 5432:5432 postgres:16
```
(If it stops after a sleep: `docker start ngsl-pg`.)

**2. Environment** — copy `.env.example` → `.env` and fill in:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ngsl_mood_trainer"
LLM_API_KEY="sk-…"                       # DeepSeek key (for AI chat + enrichment)
LLM_BASE_URL="https://api.deepseek.com/v1"
LLM_MODEL="deepseek-v4-flash"
```

**3. Create tables + run:**
```bash
npm run db:push
npm run seed:spaces      # optional: curated spaces to explore
npm run dev              # http://localhost:3000
```

---

## Deploy (Vercel + Neon)

1. **Hosted Postgres** — connect **Neon** to the Vercel project (auto-sets `DATABASE_URL`, pooled). Create tables once against the **direct** connection string:
   ```bash
   DATABASE_URL="<neon-DIRECT-url>" npm run db:push
   DATABASE_URL="<neon-DIRECT-url>" npm run seed:spaces
   ```
2. **Env vars on Vercel** (Production): `DATABASE_URL` (pooled), `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`.
3. **Push** — `postinstall` runs `prisma generate`; canonical NDJSON and the derived graph JSONs are committed, so builds do not scan per-word source files at request time.

> The Chrome **clipper** (`extension/`) is a local authoring tool — it writes to the filesystem, which Vercel's read-only FS doesn't allow.

---

## Tech stack

- **Next.js 16** (App Router), **React 19**, **TypeScript**, **Tailwind v4**
- **Three.js** progressive renderer (galaxy), **WordNet** via `wordpos` (offline defs/edges)
- **DeepSeek** (OpenAI-compatible) for enrichment + chat, via `scripts/llm-client.ts`
- **Prisma 7** + **PostgreSQL** (`@prisma/adapter-pg`)
- **Vitest** for the pure core logic, **Playwright** for production browser and performance verification
- **tsx** for the CLI pipeline scripts

---

## License and data

List **content** comes from NGSL-family sources; check each list's **license** on [newgeneralservicelist.com](https://www.newgeneralservicelist.com/) before redistributing. Definitions/relations use **WordNet** (Princeton) and the **Free Dictionary API**; examples cite **Tatoeba** where applicable. LLM-generated connections are labeled in each page's `sources`. You are responsible for complying with those terms in production.
