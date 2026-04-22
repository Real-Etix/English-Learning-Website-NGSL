# Build a similar site by hand (no AI) — study guide

This document is a **personal checklist** for recreating a vocabulary / content-driven Next.js app like NGSL Mood Trainer. Work through it in order; adapt names to your own project.

---

## 1. Core skills to practice

- **TypeScript**: interfaces for domain models (word, list, enrichment), narrowing `unknown`, `satisfies`.
- **React**: Server vs Client Components, when to add `"use client"`, controlled inputs, lists and keys.
- **Next.js App Router**: `app/page.tsx`, dynamic segments `app/word/[lemma]/page.tsx`, `notFound()`, `generateStaticParams` (if you static-export).
- **HTTP**: `fetch`, status codes, JSON parsing, caching (`next: { revalidate }`).
- **CLI Node**: reading/writing files, `tsx` or `ts-node` for scripts, environment variables (`dotenv`).
- **CSS layout**: Flexbox/Grid; **Tailwind** utility workflow.
- **Git**: branches, meaningful commits, README for deploy instructions.

---

## 2. Bootstrap the project (exact-style stack)

```bash
npx create-next-app@latest my-vocab-app --typescript --tailwind --eslint --app --src-dir=false
cd my-vocab-app
```

Versions in *this* repo for reference: **Next 16**, **React 19**, **Tailwind 4** (via `@import "tailwindcss"` in `globals.css`).

Install extras you need:

```bash
npm install zod
npm install -D prisma tsx
npm install @prisma/client dotenv   # only if using Prisma
```

---

## 3. Folder layout (mental model)

```
app/                    # routes + layouts
  layout.tsx            # shell: fonts, header, global background
  page.tsx              # marketing / home
  learn/[listSlug]/     # practice page
  word/[lemma]/         # detail page
  api/.../route.ts      # Route Handlers (JSON)
components/             # UI pieces (quiz, header, cards)
lib/                    # pure logic: parsers, content service, progress
data/                   # JSON outputs + small TS seeds
scripts/                # import/enrichment CLIs
prisma/                 # optional DB
public/                 # static assets
```

**Rule of thumb:** anything touching `window`, `localStorage`, or `useState` → **client component** or hook used only from client.

---

## 4. Tailwind CSS v4 (this project’s style)

- Global entry: `app/globals.css` starts with `@import "tailwindcss";`.
- Theme tokens can live in `:root` and `@theme inline { ... }`.
- Prefer **semantic utility combos** you repeat: e.g. card = `border border-slate-200 bg-white shadow-sm`.

---

## 5. Define types first (`lib/types.ts`)

Model:

- **Imported word**: lemma, forms, rank, list metadata.
- **Enrichment**: definition, POS, examples[], related phrases, source credits, `contentStatus`.
- **Learning word**: imported + enrichment + `listSlug`.

Strong types make the **content service** (`getListBySlug`, `getWordByLemma`) safe to refactor.

---

## 6. Content pipeline (the hard, valuable part)

### 6a. Import lists

1. Find **official CSV URLs** (NGSL publishes teaching/stats CSVs).
2. Write `scripts/import-*.ts`:
   - `fetch` CSV text
   - parse rows (split lines, handle quoted fields or use a CSV library if you prefer)
   - normalize lemma (`toLowerCase`, trim)
3. Write **`data/generated/word-lists.json`** (or SQLite/Postgres if you graduate).

### 6b. Enrich lemmas (optional but impressive)

1. Pick **documented** APIs (this app: Dictionary API + Tatoeba).
2. In a script, **throttle** requests (small concurrency pool) so you do not get blocked.
3. For each lemma: store definition, 1–3 examples, collocations; attach **license/source** fields.
4. Output **`enrichments.json`** keyed by `normalizedLemma`.

### 6c. Resolve content at runtime

Implement `resolveEnrichment(word)`:

1. Manual override (hand-curated)
2. Generated JSON hit
3. `defaultEnrichment` (honest “no data yet” — avoid fake sentences)

Optional: **`hydrateLearningWord`** — if status is fallback, `fetch` APIs on the server when the user opens a word page.

---

## 7. Next.js App Router patterns

### Server Component page

```tsx
// app/word/[lemma]/page.tsx
export default async function WordPage({ params }: { params: Promise<{ lemma: string }> }) {
  const { lemma } = await params;
  // fetch or load from JSON; return JSX
}
```

### Route Handler (API)

```tsx
// app/api/example/route.ts
export async function GET() {
  return Response.json({ ok: true });
}
```

**CORS:** browser `fetch` to third-party APIs may fail; proxying through `/api/...` avoids some issues (your server calls the API, not the browser).

---

## 8. Client quiz + progress

### Quiz

- Keep **mode** in URL query (`?mode=listen_type`) so refresh and sharing work.
- **Listen-and-type**: compare user input to **all inflected forms** (normalize apostrophes, case).
- **Meaning match**: build options from **other words’ definitions** as distractors.

### Progress (`localStorage`)

- Keyed record: per-list learned count, attempts, “difficult words”.
- Use **`useSyncExternalStore`** with:
  - `subscribe`: `window` `storage` event + custom event for same-tab updates
  - `getSnapshot`: `loadProgress()` that returns a **stable** object reference when nothing changed (cache serialized string → object)

This avoids infinite re-render bugs from naive `useEffect` + `setState(loadProgress())`.

---

## 9. Audio: two-tier strategy

1. **URL audio** from dictionary API → `<audio>` or `new Audio(url)`.
2. **Fallback**: `speechSynthesis.speak(new SpeechSynthesisUtterance(word))`.

Always surface **human-readable status** (“playing…”, “fallback”, “blocked”).

---

## 10. Accessibility and HTML validity

- Do not nest `<a>` inside `<a>` (hydration errors). Use a prop like `asLinks={false}` on badge components inside `Link`.
- Forms: associate labels, visible focus rings (`focus:ring-*` in Tailwind).

---

## 11. Quality gates before you ship

```bash
npm run lint
npm run build
```

Manually test:

- List switcher, all three practice modes, word page, full catalog.
- Hard refresh on `/learn/...?mode=...` (mode should match UI).
- Private/incognito window (empty progress).

---

## 12. Deployment choice (quick reference)

| Host | Good for |
|------|-----------|
| **Vercel** | Default for Next.js; API routes + SSR. |
| **Netlify / Cloudflare** | Possible with adapters; check Next compatibility matrix. |
| **GitHub Pages** | Static sites only; needs `output: 'export'` and usually **no** `/api` unless replaced. |

---

## 13. Stretch goals (level up)

- **Search** on full vocabulary page (client filter or URL `?q=`).
- **SRS** (spaced repetition) queue from progress data.
- **E2E tests** (Playwright): one happy path per mode.
- **i18n** for UI chrome (next-intl or similar).

Use this doc as a **spaced-repetition** checklist: build the same architecture twice and you will own it.
