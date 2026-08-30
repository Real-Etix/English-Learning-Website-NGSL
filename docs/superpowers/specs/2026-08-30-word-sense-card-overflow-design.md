# Word sense card overflow fix

## Problem

At short viewport heights, the Meaning tab's primary sense card can shrink to its
44px minimum inside the drawer's flex column. Its definition remains visible and
overflows the border, colliding with the **Other meanings** section.

## Approved behavior

- A sense card always keeps the natural height required by its header,
  definition, and optional example.
- Long definitions wrap; they are never truncated or clamped.
- When all drawer content is taller than the available space, the existing tab
  panel scrolls vertically.
- The current Star Atlas typography, colors, spacing, and interaction remain
  unchanged.

## Implementation

Make each `Sense` button a non-shrinking flex item. This fixes the underlying
flex-layout behavior without adding hard-coded heights or definition-specific
workarounds.

## Verification

- Add a component regression test with a multiline primary definition and an
  additional meaning, asserting the sense cards cannot flex-shrink.
- Run the focused component test and TypeScript check.
- Reproduce the short drawer viewport and confirm the primary definition stays
  inside its card while the panel scrolls.
