# Live-site checks and runtime AI cost protection

## Approved scope

The small beta has a **website-wide ¥1 CNY daily AI allowance**, resetting at
midnight in `Asia/Shanghai`. The user approved using the existing PostgreSQL
database for shared accounting and visitor limits, reserving estimated maximum
cost before dispatch, one paid attempt per request, and pausing AI when accounting
is unavailable. This is separate from all offline vocabulary-enrichment budgets.

This pass includes read-only production browser checks, implementation and mocked
tests locally. It does **not** include paid test calls, production database changes,
commits/pushes, or deployment. No subagents or new service subscriptions.

## Why PostgreSQL

The existing in-memory limits reset when server processes restart and are not
shared across Vercel instances. The existing database can coordinate requests
atomically without a new account. Redis/Upstash could serve the same purpose but
adds another dependency and configuration; disabling AI entirely is the zero-cost
alternative but removes the tutor.

## Components and data flow

1. Validate and bound the request before loading vocabulary or calling a provider.
2. Build the tutor/grader prompt using existing published vocabulary and sense
   checks. Count the complete prompt, including server context.
3. In one database transaction, check shared visitor limits and reserve the
   request's conservative maximum estimated cost against the current daily budget.
4. Dispatch one DeepSeek text request with explicit output-token limits and
   thinking disabled. No automatic retries, tools, search, images, or streaming.
5. Settle the reservation from valid usage returned by the provider, at conservative
   cache-miss/peak rates. Missing or invalid usage, failed requests, interrupted
   responses and timeouts retain the full reservation. Settlement is idempotent.

A server-only runtime module owns validation, configuration, accounting and
transport. The existing offline enrichment client and its spend ledger remain
unchanged. `/api/chat` and only the paid grading part of `/api/compose` use the
runtime guard. Free task generation, browsing, claiming and deterministic practice
checks do not consume the AI allowance.

## Limits and accounting

- Daily total: 1,000,000 integer micro-CNY. Avoid floating-point money arithmetic.
- Combined chat/grading visitor allowance: 3 attempts/minute and 20 attempts/day.
  Concurrent requests must not bypass either allowance or the global budget.
- Request bodies: maximum 32 KiB, enforced on bytes actually read rather than
  trusting `Content-Length`. Validate objects, arrays, roles, strings and lengths.
- Chat: at most 8 conversation messages, each at most 4 KiB UTF-8, and 16 KiB total
  user-provided conversation content. Reject malformed or excessive input explicitly.
- Grading: at most 1,500 characters per submitted sentence; bound and validate all
  other task fields. Canonical definitions and connection data come from the server,
  not client-supplied grading instructions.
- Complete provider prompt: maximum 24 KiB UTF-8. Reject oversized prompts without
  sending a paid request; do not silently truncate factual source prose or glosses.
- Maximum output: 800 tokens for chat; 300 for structured grading.
- Reservation input bound: UTF-8 bytes of all message content, plus 256 tokens per
  message and 1,024 tokens of framing headroom. Use this conservative upper estimate,
  not a characters/4 approximation. A reported usage above the reservation is an
  accounting anomaly: record it, stop further AI dispatch, and require investigation.
- Limit the upstream request and response-body read to 45 seconds, and bound response
  bytes. A timeout never releases money that may already have been spent.

Use additive tables for daily budget counters, request reservations and visitor
windows. Serialize admission against the daily counter; make reservation and visitor
increments atomic. Do not delete unfinished reservations to recover allowance.
Keep records for this beta; retention automation is outside this pass.

The visitor key is a server-side HMAC of the platform-provided IP address. Do not
store raw addresses, prompts, responses, API keys or recovery keys. Use a separate
runtime HMAC secret; fail closed if required configuration is absent. Document the
trusted proxy boundary. A visitor limit is abuse mitigation, not account identity;
the global budget remains authoritative even when visitor identity changes.

## Provider configuration and safety

Use only the intended DeepSeek HTTPS endpoint and explicitly priced text-model
allowlist. Retain the configured Flash alias if still supported; do not silently
switch providers or models. Configuration includes an enable/kill switch, daily
allowance, versioned rate policy and its review expiry. Invalid, missing or expired
pricing, missing credentials, unsupported models, or unavailable tables disable
paid dispatch. A deployment can therefore safely precede database activation.

Official pricing checked on 2026-10-26 lists Flash peak cache-miss input at ¥2 and
output at ¥8 per million tokens, including the `deepseek-v4-flash` alias. Reserve
using these higher rates regardless of discounts. Review pricing within 30 days;
expiry disables dispatch until the rate policy is deliberately renewed.

This is an application spending guard, not a provider-account billing limit.
Charges from other scripts or services using the same key are outside it; changes
to provider prices or token accounting require a policy update.

## Learner-facing behavior

- Chat returns a clear daily-allowance, rate-limit or temporary-unavailability
  message, without exposing credentials, database details or raw provider errors.
- Rate-limit/budget responses include a useful `Retry-After`; budget reset is
  calculated for midnight China time, including requests crossing that boundary.
- Composition retains deterministic feedback when AI is unavailable and explicitly
  identifies it as an automatic/basic check rather than AI assessment.
- No change to vocabulary publication, source attribution, claim eligibility,
  collection persistence or recovery-key behavior.

## Verification and delivery

Use test-first implementation. Mock every AI response. Cover parallel admissions,
last affordable request, repeated settlement, stale reservations, midnight boundary,
missing/invalid usage, provider failures, kill switch, missing tables/configuration,
malformed/oversized requests and unsupported models. Verify neither route can call
the provider before successful reservation, and that offline clients are unaffected.
Use a disposable local database for integration tests, never production.

Live checks cover list navigation, search, word meanings/usage/connections,
limited-example claim availability, disabled example-dependent practice, the
full-galaxy warning, and narrow/desktop layouts. Do not submit claims, restore keys,
send tutor messages or grade submissions against production in this pass.

Run the full tests, type check, lint and production build after implementation.
Document environment names, additive database setup, verification and rollback
(disable runtime AI). Activation on production requires a subsequent explicit step.

## References

- [DeepSeek pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)
- [DeepSeek chat parameters and usage](https://api-docs.deepseek.com/api/create-chat-completion/)
- [PostgreSQL INSERT / ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html)

## Design self-review

The daily budget is independent of visitor identity, process memory and the old
enrichment ledger. Uncertain charges remain reserved; settlement cannot be applied
twice. Production mutations and paid tests are explicitly excluded. All new tables
are additive, and missing infrastructure disables paid calls rather than bypassing
the guard. No unresolved design choices remain before implementation planning.
