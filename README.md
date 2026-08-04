# NGSL Vocabulary Galaxy

A **Next.js** app that turns the [New General Service List (NGSL)](https://www.newgeneralservicelist.com/new-general-service-list) family of vocabulary lists into an explorable **3D universe of words**. Every word is a star; every line is a real relationship (synonym, antonym, "level-up" ladder). Learners orbit the galaxy, open a star for a Cambridge-style entry, **collect** words into their own space, and explore other people's spaces to discover vocabulary they don't have yet.

It began as a flashcard trainer and was rebuilt around **Andrej Karpathy's "LLM Wiki" pattern**: the vocabulary is a folder of interlinked markdown pages that an LLM maintains, and that same link structure powers the graph.

**Live demo:** https://english-learning-website-ngsl.vercel.app

---

## What's in it

- **3D vocabulary galaxy** (`react-force-graph-3d` / Three.js) — per list (NGSL, TOEIC, Business, Academic, Fitness) or "All". Orbit, zoom, search, and click a star to fly to it.
- **Cambridge-style word cards** — IPA + UK/US audio (Free Dictionary API), definition, examples, the **advanced-word ladder** (`buy → purchase → procure`), synonyms/antonyms, word family.
- **AI assistant** — a floating DeepSeek-powered tutor that writes with a list's real vocabulary, explains/quizzes words, and checks your writing.
- **Collection spaces (Phase 1)** — collect words to earn XP, build **Your Space**, and share it (`/g/<slug>`). Visiting a space highlights the words you *don't* have in magenta.
- **Rarity & leaderboard (Phase 2)** — each word shows how rare it is across explorers; spaces are ranked by XP at `/leaderboard`.

---

## Architecture

### The wiki is the source of truth
- `wiki/pages/*.md` — one markdown page per word (~11k), with YAML frontmatter and a `## Connections` section whose `[[wiki-links]]` are the graph edges. Schema in `wiki/CLAUDE.md`.
- `wiki/raw/` — clippings ingested from articles (see the clipper below).

### From wiki → graph (build-time)
Reading 11k files per request is too slow, so `scripts/build-graph-data.ts` pre-computes a small **lite graph** (nodes + edges) per list into `data/generated/graphs/*.json`. Pages read those (`lib/wiki/graph-store.ts`), and word detail is fetched per-click via `/api/word/[lemma]`.
> ⚠️ **Re-run `npm run build:graphs` and commit after any change to the wiki**, or the deployed galaxy shows stale data.

### User data → Postgres
Collections are per-user and mutable, so they live in **Postgres** (via **Prisma 7** with the `@prisma/adapter-pg` driver). Identity is an anonymous `ownerToken` cookie — no login. Models: `Collection`, `CollectedWord` (`prisma/schema.prisma`). The wiki content stays in files; only "who collected what" is in the DB.

### Data pipeline (LLM + WordNet)
```
NGSL lists ──seed──> wiki/pages/*.md ──enrich(DeepSeek)──> advanced-word ladders
   (WordNet defs + synonym/antonym edges; curated function words)
```

---

## Scripts

```bash
# Content pipeline (the wiki)
npm run build:graphs         # regenerate per-list graph JSON (run after any wiki change)
tsx scripts/seed-wiki-pages.ts        # WordNet + curated defs → wiki/pages/*.md
tsx scripts/enrich-wiki-llm.ts        # DeepSeek adds advanced_form ladders (needs LLM_API_KEY)
tsx scripts/lint-wiki.ts              # validate the wiki (0 errors expected)
npm run seed:spaces          # seed curated public explore-spaces (needs a DB)

# App
npm run dev                  # local dev
npm run build && npm start   # production
npm test                     # vitest (xp + graph logic)
npm run lint
```

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
3. **Push** — `postinstall` runs `prisma generate`; the graph JSONs are committed so builds don't read the wiki.

> The Chrome **clipper** (`extension/`) is a local authoring tool — it writes to the filesystem, which Vercel's read-only FS doesn't allow.

---

## Tech stack

- **Next.js 16** (App Router), **React 19**, **TypeScript**, **Tailwind v4**
- **Three.js** + `react-force-graph-3d` (galaxy), **WordNet** via `wordpos` (offline defs/edges)
- **DeepSeek** (OpenAI-compatible) for enrichment + chat, via `scripts/llm-client.ts`
- **Prisma 7** + **PostgreSQL** (`@prisma/adapter-pg`)
- **Vitest** for the pure core logic
- **tsx** for the CLI pipeline scripts

---

## License and data

List **content** comes from NGSL-family sources; check each list's **license** on [newgeneralservicelist.com](https://www.newgeneralservicelist.com/) before redistributing. Definitions/relations use **WordNet** (Princeton) and the **Free Dictionary API**; examples cite **Tatoeba** where applicable. LLM-generated connections are labeled in each page's `sources`. You are responsible for complying with those terms in production.
