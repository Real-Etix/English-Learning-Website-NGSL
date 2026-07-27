# Vocabulary Wiki — Schema & Operating Rules

This folder is an **LLM-maintained vocabulary wiki** (Karpathy LLM Wiki pattern).
It is the single source of truth for word content and the connections between words.
The frontend graph and the study pages are both *generated* from these files — do not
hand-edit generated output; edit the wiki pages here.

## Folder layout

- `raw/` — immutable source clippings (articles, book excerpts). Never edited after ingest. Each file starts with a provenance header (url, title, date, license). **Store only what license permits; for copyrighted sources keep a short excerpt + link, not the full text.**
- `pages/` — one markdown page per lemma. Filename is the normalized lemma: `pages/big.md`. This is the wiki.
- `CLAUDE.md` — this file. The schema and the ingest/lint rules.

## The anchor rule (the core of this product)

Every page belongs to a **tier**:

- `core` — a word from an NGSL/base list. These are the anchors learners already know.
- `advanced` — a word added by ingesting clippings. **Every `advanced` page MUST link to at least one `core` anchor** via a `builds_on` edge. A new advanced word with no path back to a core word is an orphan and is rejected by `lint`. This is what keeps the network learnable instead of an infinite dictionary.

## Page schema

Every `pages/*.md` file has YAML frontmatter followed by fixed sections. Missing
optional sections are allowed; missing required ones are a `lint` error.

```markdown
---
lemma: <normalized lemma>            # required, matches filename
display: <surface form>              # required, e.g. "big"
tier: core | advanced                # required
pos: <part of speech>                # required
forms: [big, bigger, biggest]        # inflected forms
lists: [ngsl]                        # which base lists it appears in (core only)
rank: 184                            # frequency rank within its primary list (core only)
sfi: 67.22                           # standard frequency index if known
sources: [dictionaryapi, tatoeba]    # source ids backing the factual layer
status: seeded | enriched | verified # provenance of the connections (see below)
---

## Definition
One learner-friendly sentence. Factual layer — sourced, never invented by the LLM.

## Examples
- Real example sentence. _(source)_

## Connections
<!-- The edges. Each bullet is `<edge-type>: [[target]] — short gloss`. -->
- intensity: [[large]] — a bigger, slightly more formal "big"
- intensity: [[enormous]] — much bigger than big
- builds_on: [[big]]        <!-- advanced pages only; points at the anchor -->
- synonym: [[great]]
- antonym: [[small]]
- collocation: [[deal]] — "a big deal"
- domain: size

## Usage note
Optional. Register/nuance an LLM can add on top of the factual layer.
```

## Edge types (the only allowed link relations)

Connections are typed. Use exactly these verbs; `lint` rejects unknown ones.

| edge | meaning | direction |
|---|---|---|
| `synonym` | same meaning, register may differ | symmetric |
| `antonym` | opposite | symmetric |
| `intensity` | same idea, stronger/weaker (`warm→hot→scorching`) | ordered |
| `builds_on` | advanced word → the core anchor it extends | advanced → core |
| `advanced_form` | core word → a more advanced word for it (`buy→purchase`) | core → advanced |
| `morphological` | shares a root (`nation→national`) | symmetric |
| `collocation` | frequently co-occurs (`make a decision`) | symmetric |
| `domain` | topic tag, not a word link (value is a bare tag, not `[[link]]`) | n/a |

`advanced_form` and `builds_on` are inverses — when `ingest` adds a `builds_on`
edge to an advanced page, it MUST add the matching `advanced_form` edge to the
core anchor page. `lint` checks this reciprocity.

## `status` field — how trustworthy the connections are

- `seeded` — page was auto-generated from dictionary data. Definition/examples are
  real; connections may be empty or naive. Safe to overwrite.
- `enriched` — an LLM pass has proposed connections. Usable, not yet reviewed.
- `verified` — a human confirmed the connections. Never auto-overwrite.

## Operations

### `ingest <raw-file>`
1. Save the source to `raw/` with a provenance header.
2. Lemmatize; diff tokens against existing `pages/`.
3. For each **unknown** word above a usefulness bar (skip proper nouns, typos, ultra-rare): create `pages/<lemma>.md`, `tier: advanced`, fill the factual layer from the dictionary source.
4. Connect it: add at least one `builds_on` edge to a `core` anchor, plus any `synonym`/`intensity`/`domain` edges. Add the reciprocal `advanced_form` edge to the anchor page.
5. For **known** words that appear in a new sense/collocation: update that page's Connections, don't duplicate the page.
6. Never touch the factual layer of a `verified` page; only append connections.

### `query <question>`
Answer from `pages/` only. Cite the pages used by their `[[lemma]]`.

### `lint`
Fail on: required frontmatter/section missing; unknown edge type; `advanced` page
with no `builds_on`; non-reciprocal `builds_on`/`advanced_form`; `[[link]]` to a
non-existent page; a `verified` page modified by an automated pass; duplicate lemma.
Warn on: `core` page with zero connections (an under-connected anchor); orphan page
(no inbound links).

## Frontend contract

A build step parses `pages/*.md` → emits `{nodes, edges}`:
- node = `{ lemma, display, tier, rank, domain }`
- edge = `{ source, target, type }` from every `[[link]]` in a `## Connections` bullet
- `domain:` bullets become node tags, not edges.

The graph renders per list; clicking a node renders that page's markdown. Keep this
contract stable — it is the only coupling between the wiki and the app.
