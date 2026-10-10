# Independent Word and Relationship Publication Implementation Plan

**Goal:** Decouple factual word publication from relationship publication and safely
promote previously verified word content without rerunning external providers.

## Tasks

- [x] Add RED tests proving a source-backed word can publish without a core anchor.
- [x] Add RED mutation tests for ambiguous and unsupported relationship outcomes.
- [x] Add an optional aggregate relationship verification field to the canonical
  schema while preserving existing records.
- [x] Change publication and mutation rules so selected factual content publishes
  independently, with ambiguous edges unreviewed and unsupported edges hidden.
- [x] Update verification report classification to count independently published word
  content as published.
- [x] Add a dry-run-first migration command that recovers selected sense IDs from the
  completed verification cache and reports unresolved records without guessing.
- [x] Run focused tests, the complete test suite, TypeScript, vocabulary lint, and
  dictionary audit.
- [x] Apply the migration, rebuild generated vocabulary and galaxy assets, and verify
  counts and strict audit parity.
