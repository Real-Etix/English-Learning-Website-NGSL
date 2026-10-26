# Runtime AI allowance

The tutor and AI sentence grader share a maximum **¥1 CNY/day** application
allowance. The day resets at midnight China time. Each visitor can make at most
3 paid attempts/minute and 20/day across both features.

The implementation was verified locally before production activation was approved.
Production activation uses the existing GitHub-connected Vercel project; confirm
the exact deployment commit and the verification markers described below.

## Safe activation (separate production step)

1. Keep `AI_RUNTIME_ENABLED=false` while preparing the deployment.
2. Review `prisma/runtime-ai-budget.sql`. Apply its transaction using the intended
   database's SQL editor, or `npx prisma db execute --file prisma/runtime-ai-budget.sql`
   only after confirming the CLI configuration targets that database. This creates
   three accounting tables and one index in the `public` schema (select that schema
   in the SQL console). It does not edit existing learning data.
   Do not substitute an unrestricted `db push` against production.
3. Configure server-only environment variables, never `NEXT_PUBLIC_*`:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Existing PostgreSQL/Neon connection |
   | `LLM_API_KEY` | Existing key intended for DeepSeek |
   | `LLM_BASE_URL` | `https://api.deepseek.com/v1` |
   | `LLM_MODEL` | `deepseek-v4-flash` or `deepseek-flash` |
   | `AI_RUNTIME_DAILY_MICRO_CNY` | `1000000` (¥1); lower values are allowed |
   | `AI_RUNTIME_HMAC_SECRET` | A separate random secret of at least 32 characters |
   | `AI_RUNTIME_PRICE_POLICY` | `deepseek-flash-2026-10-26` |
   | `AI_RUNTIME_ENABLED` | `true` only after setup is verified |

   Generate a fresh HMAC secret using a password manager or `openssl rand -hex 32`;
   enter it privately in the deployment settings. Do not reuse a recovery/API key,
   commit it, include it in URLs, or paste it into a chat.
4. Deploy through the existing GitHub/Vercel workflow after approval. Verify the
   exact commit and settings. A real paid smoke test needs separate approval;
   local tests mock provider responses.

### One-time Vercel activation with write-only credentials

On 2026-10-26 the user approved running setup inside the next production build,
because the existing production database/provider values are write-only sensitive
variables. They are not downloaded or printed. `scripts/activate-runtime-ai-budget.ts`
accepts one full 40-character commit SHA and runs only for that production commit
in this existing project, repository and branch. It validates the runtime policy,
requires a Neon/public-schema connection, checks the existing learning tables,
applies the hash-pinned additive SQL in a bounded transaction, and verifies all
accounting columns, constraints, index and absence of accounting anomalies.
Existing rows are preserved; no AI request is made.

The temporary build command is `npx tsx scripts/activate-runtime-ai-budget.ts
<approved-sha> && npm run build` (as one line). It is not part of `npm run build`
and must not be left as a recurring migration hook. Restore the project's original
build command (`null`, framework default) after this deployment. Verification uses
the build-log markers `RUNTIME_AI_CONFIG_VERIFIED` and `RUNTIME_AI_SCHEMA_VERIFIED`,
the exact Git SHA, deployment `READY` status and production alias. A failure stops
the build, leaves the previous deployment serving, and suppresses raw errors that
might contain credentials.

Missing tables, missing configuration, unsupported models, unavailable accounting,
or expired pricing disable paid calls. There is no in-memory fallback for the budget.
Vercel preview/development deployments cannot dispatch paid calls even if they inherit
the enable flag. Keep previews off so a separate preview database cannot create a
second allowance against the same provider key.
The website can still load its vocabulary and quizzes. Grading can return a labeled
basic check; it must not claim that meaning or grammar was reviewed by AI.

## What is counted

Each admitted request reserves an upper estimate before any provider call. Inputs
are estimated from complete UTF-8 message bytes plus framing headroom. Chat replies
are capped at 800 tokens, structured grading at 300. Thinking is explicitly disabled.
There are no retries, redirects, tools or web-search calls. The 45-second timeout
covers both response headers and body reads.

Valid provider usage settles the reservation at peak cache-miss rates: ¥2/million
input tokens and ¥8/million output tokens. Discounts are deliberately ignored. Failed
calls, missing/invalid usage, timeouts, crashes or settlement failures retain their
full reservation. Do not manually refund them without confirmed billing evidence.

Late settlement belongs to the original day. Duplicate settlement has no effect.
An unexpectedly high reported charge sets a persistent anomaly flag and disables
further paid requests, including on later days, until investigated.

This protects calls dispatched by these two website routes, **not** the entire
provider account. Offline enrichment or other services sharing the key are not in
this allowance. No local vocabulary files or enrichment spend ledgers are changed.
Provider pricing/token-accounting changes require a policy update; an application
estimate is not a provider-enforced monetary guarantee.

## Pricing review and kill switch

Rates were checked on 2026-10-26 and the code policy expires at
**2026-11-25 00:00 UTC**. Before that date, recheck the official prices/model alias,
update the policy identifier, rates and expiry in `lib/ai/policy.ts`, update tests
and documentation, then deploy and set the matching policy identifier. Expiry is
not a user-controlled environment override.

To stop spending, set `AI_RUNTIME_ENABLED=false` and apply the deployment/settings
change. Already-dispatched calls may finish; their reservations remain. Leave the
accounting tables intact so re-enabling cannot reset today's consumption.

## Privacy and proxy boundary

The database stores hashed visitor windows, dates, request IDs and numeric accounting
only—not prompts, replies, raw IPs, keys or recovery codes. IP hashes are still
pseudonymous identifiers, not anonymous data. This beta retains accounting records;
add a documented retention policy before a wider release.

Production identity trusts `x-vercel-forwarded-for` only when Vercel sets its server
environment marker. Missing/invalid headers disable paid calls. Self-hosted production
is disabled until its proxy trust boundary is reviewed. IPv6 addresses are normalized.
Local development uses a shared local visitor. Visitor identity is only an abuse
control: the global budget is independent of it and cannot be bypassed by changing IP.

Both AI routes require JSON bodies and reject a supplied cross-site browser Origin.
This reduces cross-site abuse; it is not authentication and does not replace the
global budget or shared visitor limits.

## Read-only accounting checks

Run these privately in the database console; no prompts or visitor IDs are needed:

```sql
SELECT day, cap / 1000000.0 AS cap_cny,
       charged / 1000000.0 AS charged_or_reserved_cny, anomaly
FROM "AiRuntimeDay" ORDER BY day DESC LIMIT 14;

SELECT day, count(*) AS requests,
       count(*) FILTER (WHERE actual IS NULL) AS unsettled_requests
FROM "AiRuntimeReservation" GROUP BY day ORDER BY day DESC LIMIT 14;
```

`charged` includes settled charges plus outstanding reservations. It is intentionally
conservative and may differ from the provider's bill. A crash does not release it.

## Local verification

Unit tests require no keys. Database tests run only when `AI_TEST_DATABASE_URL` is
explicitly supplied and reject non-loopback hosts and URL query options. They create
a random `ai_test_...` schema and remove only that schema after testing. Never point
this variable at Neon or another shared/production database.

```sh
npx vitest run lib/ai app/api/chat/route.test.ts app/api/compose/route.test.ts
npx tsc --noEmit
npm run lint
npm run build
```

## Live-site smoke checks — 2026-10-26

Read-only checks on `english-learning-website-ngsl.vercel.app` confirmed:

- Navigation to NGSL, Academic, Business, TOEIC, Fitness and All words; All words
  displayed 11,892 stars.
- Search for `learn`, word sense/source display, Use/Connect tabs, and navigation
  from `learn` to `acquire`.
- Search for `chromatid`, its NHGRI source link, limited-example notice and meaning
  quiz availability. The Use tab correctly withheld sentence practice.
- The chromatid drawer fit a 390 × 844 viewport with its claim button visible.
- Full-list mode displayed the 11,892-star warning before loading. The load was
  cancelled, not run as a performance benchmark.
- No warning/error console messages were captured during these checks.

No live claims, collection resets/restores, tutor messages or grading submissions
were made. These checks do not prove collection persistence, audio playback, AI
availability, whole-galaxy performance or real-device frame rates.

**Open learning-quality finding:** the chromatid meaning quiz quotes a definition
containing “chromatid”, so the question reveals its answer. Fix quiz prompt masking
separately without changing the attributed dictionary definition.

## References

- [DeepSeek prices](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)
- [DeepSeek chat request controls](https://api-docs.deepseek.com/api/create-chat-completion/)
- [Vercel request headers](https://vercel.com/docs/headers/request-headers)
