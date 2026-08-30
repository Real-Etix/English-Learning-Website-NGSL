@AGENTS.md

## Local source-backed advanced verification

Run this verifier locally only; it does not run in Vercel. The first successful
invocation atomically saves an active batch inside the selected cache root. Dry
runs and writes thereafter replay that exact batch, so a write cannot advance to
the next hidden words. To begin a later batch, delete only
`.cache/vocabulary-verification/active-batch-v3.json`; retain the provider/model cache.
Offline fixture state uses a digest-named directory below `fixture/`, so one fixture
cannot reuse another fixture's evidence or pin synthetic words for a later live run.
`--write` is rejected until a successful dry-run has created the live active-batch
manifest. A live run with a provider, model, or budget failure writes its report but
does not create that manifest and therefore cannot authorize `--write`. That manifest pins the limits, concurrency, model/endpoint identity,
fixture digest (when used), and expected post-verification record hashes. A changed
configuration, changed fixture, or recomputed outcome fails closed before persistence.
If canonical persistence succeeds but graph generation fails, rerun the identical
`--write` command; the manifest keeps the graph build pending until it completes.

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
