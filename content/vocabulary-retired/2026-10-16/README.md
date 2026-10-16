# Final reviewed retirement — 2026-10-16

The user requested one last free-source review, then discarding entries still
hidden. Of 234 reviewed words, 11 were published and **223 were removed from the
active library**. This recovery copy is outside canonical shards and is never
read by the website, graph builders or enrichment selection.

`archive.json` contains the exact 223 records, 1,046 unpublished incoming
connections with their source record and original array index, explicit reviewed
decisions, per-record before/after hashes, and original editorial/release/canonical
metadata. The six previously archived specialist records are included. No core
word, public word, published connection, database row or learner collection was
deleted. Retained source prose, examples, stable IDs and list memberships are
unchanged. The remaining 115 unclaimable core words are outside this migration.

`receipt.json` records the counts, archive SHA-256 and zero paid calls. The archive
is 3.84 MiB (4,028,439 bytes). The canonical vocabulary now contains 11,892 public records.

## Recovery procedure — only when explicitly requested

1. Stop vocabulary writers and acquire the existing recovery worker lock. Save
   current shards and metadata separately. Verify the archive SHA-256 against
   `receipt.json` before trusting any recovery data.
2. Validate each archived record against `beforeHashes`. Do not overwrite an
   existing record with the same stable ID; resolve any collision explicitly.
3. For a full rollback, compare every surviving record to `afterHashes` before
   changing it. Restore each archived incoming connection in ascending `index`
   order, then require the reconstructed record to match `beforeHashes`. If a
   record has changed since retirement, stop and reconcile it without replacing
   newer work. For selective recovery, restore only the requested records and
   links after equivalent review; do not use indexes against changed arrays.
4. Restore old metadata only as part of a verified full rollback with no intervening
   edits. Otherwise merge explicitly reviewed changes and regenerate counts and
   checksums. Restore records as **hidden**, not automatically published.
5. Run vocabulary lint, strict audit and generated word/graph/galaxy rebuilds.
   Verify no broken links, no unintended publication, and preserved official lists.
   No database or deployment change is implied by this local recovery procedure.

The retirement script's repeat `--write` is **not an undo command**. It validates
and resumes the same removal; after a completed migration its dry-run reports
zero changed records. Historical source/review manifests still reference retired
IDs for audit purposes and must not be replayed into the active corpus.
