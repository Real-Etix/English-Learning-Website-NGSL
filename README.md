# NGSL Mood Trainer

A **Next.js** vocabulary study app built around the [New General Service List (NGSL)](https://www.newgeneralservicelist.com/new-general-service-list) family of lists. Learners pick a **goal track** (general, test prep, business, academic, or fitness English), practice with **listening and meaning** modes, and open **word cards** backed by definitions and examples from **documented public sources**—not paid generative APIs.

The UI uses a **bright, high-contrast** theme (sky/slate) so content stays readable in daylight and on shared screens.

---

## Architecture

- Learner **mood and goal** pick a list; **practice** uses a short, focused slice of words, while **full-catalog** pages cover the imported range for lookup without loading everything into the quiz.
- **Next.js App Router**: server-rendered list and word routes, **Route Handlers** under `/api` for pronunciation and references, and client components for the quiz and **`localStorage`** progress.
- Lists start as **CSV imports** and land in structured JSON (`data/generated/word-lists.json`). **Enrichments** layer manual seed data, build-time generation, and on-demand API results, with **`contentStatus`** and **source credits** on each word.
- **Pronunciation** prefers **dictionary audio URLs**, then **Web Speech API**, with status text when a path is unavailable or playback fails.
- **Progress** is read through **`useSyncExternalStore`** with a stable snapshot cache in `lib/progress/progress-service.ts`.
- **`npm run import:lists`** and **`npm run generate:enrichments`** (Node + **tsx**) refresh list and enrichment data from the network; a **Prisma** schema is included for optional database storage later.

---

## The lists (basic ideas)

All tracks are **NGSL-family** vocabulary from the same ecosystem; the app **re-labels** them by learner intent:

| Track | Idea |
|--------|------|
| **NGSL (core)** | High-frequency “general service” words for everyday listening, reading, and conversation. |
| **TOEIC-style** | Vocabulary framed for office, travel, and test-style contexts (still from the imported list set). |
| **Business** | Lexis for workplace communication: clients, budgets, processes, collaboration. |
| **Academic** | Words common in lectures, readings, and structured argument (analysis, theory, evidence). |
| **Fitness** | Movement, training, recovery, and health-related vocabulary for active, lifestyle topics. |

**Mood selector** on the home page is a thin UX layer: it routes to a default list (e.g. “Career” → business) so learners start quickly without reading documentation.

---

## Tech stack

- **Next.js 16** (App Router), **React 19**, **TypeScript**
- **Tailwind CSS v4** (`@import "tailwindcss"` in `app/globals.css`)
- **Zod** for runtime validation where used
- **Prisma 7** + **PostgreSQL** (optional; schema present—app runs from generated JSON without a DB)
- **tsx** for TypeScript CLI scripts

### Main npm scripts

```bash
npm run dev              # local development
npm run build && npm start   # production server
npm run lint

npm run import:lists         # fetch/parse official CSVs → data/generated/word-lists.json
npm run generate:enrichments # enrich lemmas (dictionary + corpus APIs) → enrichments.json + references.json
npm run refresh:content      # both of the above
```

---

## Local setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

For database experiments (optional):

```bash
cp .env.example .env   # if present; set DATABASE_URL
npm run db:generate
npm run db:push
```

---


## License and data

List **content** comes from NGSL-family sources; check each list’s **license** on [newgeneralservicelist.com](https://www.newgeneralservicelist.com/) before redistributing. Enrichments cite **Dictionary API** and **Tatoeba** where applicable. You are responsible for complying with those terms in production.
