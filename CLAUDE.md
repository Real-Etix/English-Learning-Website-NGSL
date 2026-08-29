@AGENTS.md

## Local source-backed advanced verification

Run this verifier locally only; it does not run in Vercel. The first successful
invocation atomically saves an active batch inside the selected cache root. Dry
runs and writes thereafter replay that exact batch, so a write cannot advance to
the next hidden words. To begin a later batch, delete only
`.cache/vocabulary-verification/active-batch.json`; retain the provider/model cache.
Offline fixture state uses the isolated `fixture/` subdirectory, so it cannot pin
synthetic fixture words for a later live run.
`--write` is rejected until a successful dry-run has created the live active-batch
manifest. That manifest pins the limits, concurrency, model/endpoint identity,
fixture digest (when used), and expected post-verification record hashes. A changed
configuration, changed fixture, or recomputed outcome fails closed before persistence.

```bash
# Offline, zero-cost integration check
npm run verify:advanced -- \
  --fixture=scripts/fixtures/vocabulary-verification/source-backed-batch.json \
  --report=.cache/vocabulary-verification/fixture-report.json

# Live dry-run; canonical NDJSON remains untouched
npm run verify:advanced -- \
  --limit=25 \
  --concurrency=3 \
  --max-source-requests=100 \
  --max-input-tokens=20000 \
  --max-output-tokens=8000 \
  --report=.cache/vocabulary-verification/latest-report.json

# Apply the exact cached batch and rebuild generated artifacts
npm run verify:advanced -- \
  --limit=25 \
  --concurrency=3 \
  --max-source-requests=100 \
  --max-input-tokens=20000 \
  --max-output-tokens=8000 \
  --report=.cache/vocabulary-verification/latest-write-report.json \
  --write
```

Review canonical NDJSON and regenerated artifacts in Git. The cache, active-batch
manifest, and reports are disposable and must not be committed. Uncertain records
stay hidden.
