# Word sense card overflow implementation plan

1. Add a rendering regression test for a long primary definition followed by an
   additional meaning.
2. Confirm the new test fails because the sense card has no non-shrinking flex
   rule.
3. Add `flex-shrink: 0` to the shared sense-card layout.
4. Run the focused tests and TypeScript validation.
5. Verify the drawer visually at the short viewport represented by the supplied
   screenshot.
