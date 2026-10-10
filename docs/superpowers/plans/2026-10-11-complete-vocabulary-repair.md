# Complete vocabulary repair and delivery

## Authorization and boundaries

The user approved repairing all five lists and revisiting hidden advanced words,
with a **17 CNY total DeepSeek ceiling**, then committing, pushing the existing
GitHub branch and checking its Vercel deployment. Use a stricter 16 CNY software
ceiling. No new vocabulary generation, fabricated examples, provider changes,
manual approval queue, subagents, or forced publication of unsupported content.

## Execution

- [x] Inspect provider health and deployment access: DeepSeek balance 17.47 CNY;
  Tatoeba v1 responds; DictionaryAPI times out. GitHub CLI HTTPS works; SSH does not.
- [x] Fix word-scoped sense selection without effect-driven state updates; targeted tests and TypeScript pass.
- [x] Add/test a resumable repair runner: original lists in NGSL frequency order,
  Academic, Business, TOEIC, Fitness, then hidden advanced vocabulary.
- [x] Persist worst-case spending reservations **before** each single-attempt
  DeepSeek call. Include errors/timeouts/interrupted requests, never reset on resume.
- [x] Use exact-lemma/POS WordNet evidence and its native examples first. Reuse
  cached Tatoeba evidence. Use the model only to select supplied sense/example IDs.
- [x] Apply evidence-backed repairs in batches of 25, concurrency 3. Preserve
  uncertain senses for review and uncertain relationships; retain original list membership.
- [x] Audit unresolved items honestly; rebuild generated word, graph and galaxy assets once.
- [x] Run schema/content checks, full tests, lint, TypeScript and production build.
- [ ] Review changes for secrets and unintended edits, commit and push to
  `cursor/ngsl-mood-trainer` using existing GitHub authentication.
- [ ] Confirm the Vercel deployment matches the pushed commit; report production
  versus preview status accurately. End the continuation heartbeat.

## Durable state

Use `.cache/vocabulary-repair/` (git-ignored) for the source baseline, worker lock,
per-record checkpoints, factual evidence cache, paid-call ledger and final audit.
A single worker owns the lock. Resume skips completed records and previously
reserved requests. Check for a live worker before starting another.

Ready means the pass visited every candidate and all permitted verification and
delivery work finished—not that all words magically gained adequate evidence.
If spending is exhausted, finish free/local work and report the remaining debt.

## Continuation instructions

The live runner is `npm run repair:vocabulary -- --write`. Check the PID in
`.cache/vocabulary-repair/worker.lock` before starting it; if that process is alive,
allow it to finish. Progress lives in `checkpoint.json`; `report.json` is only
refreshed when an invocation finishes. There are 8,232 pinned candidates: all
5,981 core records and the 2,251 advanced records hidden at campaign start.
Never reset `spend.json`. Do not run a second enrichment worker concurrently.

The repair pass is complete: 8,232/8,232 candidates visited, 5,590 records changed,
and 6,151 processed candidates ready (5,537 core and 614 recovered advanced).
The remaining 444 core words are searchable but unclaimable; 1,637 advanced words
remain hidden. Evidence was insufficient for 771 factual senses and 993 sourced
examples; another 317 were ambiguous. No content was force-published.

All 2,443 paid requests are settled in the ledger with no pending reservations
or provider failures. Conservative maximum accounting is 1.64935 CNY, below the
16 CNY software ceiling; the observed CNY balance changed from 17.47 to 16.64.
Keep this ledger even though the worker has completed.

Final generated artifacts contain 10,478 public stars and 14,949 graph edges.
Validation passed: 12,115 canonical records with zero schema errors/warnings;
zero strict publication blockers; 559 unit tests; TypeScript; production build;
and all 14 progressive-galaxy browser tests. ESLint has zero errors and four
existing unused-variable warnings. Browser checks used installed Chrome with
the temporary ignored `.cache/vocabulary-repair/browser-check.config.ts`; no
browser download was required. Secret/path review found no credentials or
private cache files among the changes prepared for delivery.

GitHub's SSH key fails, but the authenticated HTTPS credential helper works:
`git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push https://github.com/Real-Etix/English-Learning-Website-NGSL.git HEAD:cursor/ngsl-mood-trainer`.
The default branch is `cursor/ngsl-mood-trainer`, and its prior commit
`605cf26be543a764800e7b3e89fe2624d72346f5` has a successful **Production** Vercel
deployment. Verify the new SHA via GitHub commit status and deployment/statuses
APIs after pushing. Do not force-push. No database migration is needed for these changes.

The active continuation heartbeat is `finish-vocabulary-repair-and-deployment`;
end it after delivery or a documented terminal blocker.
