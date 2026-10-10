# Independent Word and Relationship Publication

Date: 2026-10-11

## Purpose

Publish a vocabulary word when its selected sense has a factual definition and a
sourced example, even when its proposed relationship to a core word is ambiguous or
unsupported. Connections remain independently reviewable and never become
learner-facing merely because the word is published.

## Decisions

- `publicationStatus` describes whether the word may appear in learner-facing word
  and galaxy artifacts.
- `verificationStatus` describes the factual word-content decision.
- A new optional `relationshipVerificationStatus` records the aggregate relationship
  decision without changing schema version 1 compatibility.
- A word is publishable when at least one exact selected sense passes the existing
  factual-definition and sourced-example gates. A published core anchor is no longer
  required.
- Supported reciprocal connections are `published`, ambiguous reciprocal connections
  are `unreviewed`, and unsupported reciprocal connections are `hidden` on both ends.
- Public graph builders continue to include only `published`, glossed connections.
  A published word with no accepted connection appears as an isolated star.
- Existing completed verification work is migrated from sanitized write reports and
  cached selected-sense decisions. The migration is dry-run by default, idempotent,
  and skips rather than guesses if one exact selected sense cannot be recovered.

## Safety

The migration does not call an LLM or source provider. It does not invent definitions,
examples, senses, or links. The selected sense must already belong to the canonical
record, be source-backed, and contain a sourced example. All proposed records pass the
canonical Zod schema and the existing dictionary-quality audit before a write.

## Result

The 1,535 records whose content passed but whose relationships were ambiguous or
unsupported can become useful standalone words. Their uncertain edges remain absent
from learner-facing explanations and graph lines until separately verified.
