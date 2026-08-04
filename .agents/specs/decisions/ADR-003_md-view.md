# ADR-003: Explicit light/dark CSS file pairs instead of OS-driven auto theme

## Status
Accepted

## Context
Task 6 linked `github-markdown-css`'s auto variant (`github-markdown.css`),
which switches `.markdown-body`'s colors via
`@media (prefers-color-scheme: dark)`. On an OS set to dark mode, this
styled `.markdown-body` dark while the surrounding app chrome (`<body>`,
status bar, empty-state — none matched by that media query) stayed light,
producing a half-dark/half-light window (diagnosed during Task 8's
scoping). Task 8 needed an explicit, app-controlled Dark Mode toggle,
independent of OS preference, covering markdown content, code
highlighting, and app chrome together.

## Decision
Replace the single `github-markdown.css` `<link>` with two explicit,
non-media-query-gated files from the same already-installed package:
`github-markdown-light.css` and `github-markdown-dark.css`, both always
linked, one `disabled` at a time via `link.disabled` from renderer JS.
Same pattern for highlight.js's `github.css`/`github-dark.css`. `app.css`
gains a `body.dark-mode` class toggle for the surrounding chrome. All four
`<link>.disabled` flips and the body class change together, atomically, in
one `applyDarkMode` function.

## Alternatives considered
- Keep the single auto `github-markdown.css` file and drive dark mode via
  its `[data-theme="dark"]` attribute selector. Rejected: those selectors
  are themselves nested inside the `@media (prefers-color-scheme: ...)`
  blocks in this version of the package, so they only activate when the OS
  *already* prefers that scheme — no OS-independent override, which is
  exactly the capability this task needs. Confirmed by direct inspection of
  the installed package's CSS before committing to either approach, not
  assumed.
- A hand-authored CSS file scoped by a `.dark-mode` class, replicating
  github-markdown-css's dark palette inline. Rejected: duplicates a large,
  actively-maintained third-party stylesheet by hand, creating a second
  source of truth that would drift on every future package upgrade.

## Consequences
- Build script now copies 4 markdown/highlight CSS files instead of 2
  (light+dark pairs for both), still zero new dependencies — all four ship
  inside packages already declared in `package.json`.
- A future `github-markdown-css` major bump must be checked for whether it
  still ships separate, unconditional light/dark files under these
  filenames — if the package restructures around a different mechanism,
  this approach needs revisiting, not silently assumed to still work.
  