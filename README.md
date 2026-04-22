# NGSL Mood Trainer

A **Next.js** vocabulary study app built around the [New General Service List (NGSL)](https://www.newgeneralservicelist.com/new-general-service-list) family of lists. Learners pick a **goal track** (general, test prep, business, academic, or fitness English), practice with **listening and meaning** modes, and open **word cards** backed by definitions and examples from **documented public sources**—not paid generative APIs.

The UI uses a **bright, high-contrast** theme (sky/slate) so content reads clearly in daylight and in screen-share interviews.

---

## What this project shows (portfolio / interview angle)

If you are presenting this to a hiring manager, these are concrete engineering storylines:

1. **Product thinking** — Mood and goal map to list selection; practice is split into a small high-focus slice vs a **full catalog** page for lookup, balancing UX and performance.
2. **Full-stack Next.js (App Router)** — Server Components for list pages and SEO-friendly word routes; **Route Handlers** for pronunciation and references; client components for quizzes and `localStorage` progress.
3. **Typed content layer** — Imported CSV data becomes structured JSON (`data/generated/word-lists.json`); enrichments merge **manual seed**, **build-time generated**, and **on-demand API** resolution with explicit `contentStatus` and **source credits** (attribution).
4. **Resilient audio** — Primary path uses **free dictionary audio URLs**; fallback is **Web Speech API** with user-feedback when playback fails.
5. **State without render loops** — Progress uses **`useSyncExternalStore`** with a stable snapshot cache in `lib/progress/progress-service.ts` (avoids classic “setState in effect” pitfalls).
6. **Build automation** — `npm run import:lists` and `npm run generate:enrichments` (Node + `tsx`) refresh content from network sources; optional Prisma schema is included for future persistence.

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

## Can I host this on GitHub Pages?

**Short answer: not as a full Next.js server app.** GitHub Pages only serves **static files** (HTML, JS, CSS, assets). It does **not** run a Node server, so you **cannot** rely on:

- **Server Components** rendering on each request
- **API routes** under `/api/*` (e.g. pronunciation proxy, references JSON) unless you redesign them away

**What works on GitHub Pages:**

- A **static export** of a Next.js app (`output: 'export'` in `next.config.ts`), **if** you remove or replace server-only features and use **`basePath`** / **`assetPrefix`** when the site is served from `https://<user>.github.io/<repo>/`.

**Practical recommendation for this repo today:**

- Deploy to **[Vercel](https://vercel.com)** (or Netlify, Cloudflare Pages with adapter)—**zero-config** for Next.js, API routes work, and you never need `npm run dev` on your laptop for others to use the site.
- Use GitHub only as **version control**; connect the repo to Vercel for automatic deploys on push.

If you want a **pure GitHub Pages** deployment later, plan for: static export, client-side `fetch` directly to public APIs (watch CORS), and no `/api` routes—or move API logic into serverless elsewhere.

---

## Personal learning guide

See **[BUILD-SIMILAR-SITE-BY-HAND.md](./BUILD-SIMILAR-SITE-BY-HAND.md)** for a step-by-step checklist to rebuild a similar project manually (commands, folders, patterns, and packages)—useful when you want to practice without assistance.

---

## License and data

List **content** comes from NGSL-family sources; check each list’s **license** on [newgeneralservicelist.com](https://www.newgeneralservicelist.com/) before redistributing. Enrichments cite **Dictionary API** and **Tatoeba** where applicable. You are responsible for complying with those terms in production.
