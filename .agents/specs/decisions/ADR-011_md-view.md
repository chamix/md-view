# ADR-011: Static windows embed one hash-pinned stylesheet under a `default-src 'none'` CSP

## Status
Accepted (2026-09-27, Task 46 close-out; the independent re-review approved
with non-blocking items. See `.agents/specs/review_report_task46.md`).
Proposed 2026-09-26 at the Task 46 Step 1 approval.

## Context
The static windows (Help, What's New, and About from Task 46) are `data:`
documents built in `main` and loaded through `loadStaticHtml`. Guardrail #178
requires a document CSP with no `script-src`, `default-src 'none'`, and only
what the windows need for styles.

Step 1 found a pre-existing defect that had been present since Task 14.
Chromium refuses to load `file:` subresources into a `data:` document
("Not allowed to load local resource"). The three `<link rel="stylesheet">`
elements in the shared shell never loaded, so Help and What's New always
rendered with browser defaults (`Times New Roman`). Only the inline `style`
attribute on the wrapper applied. No test asserted styling.

## Decision
- The shell (`buildHelpHtml`) receives the CSS **text**: the same three files
  it used to link, concatenated.
- It LF-normalizes the text, because the HTML parser normalizes `\r\n` before
  hashing and `app.css` is CRLF. It then embeds the text in one `<style>`
  element and emits
  `default-src 'none'; style-src 'sha256-<H>'; base-uri 'none'; form-action 'none'`
  as the first element after `<meta charset>`. `<H>` is computed from the
  same normalized string in the same pure function, so the hash and the
  content cannot drift.
- The wrapper's inline `style` attribute moves into the embedded CSS as
  `.md-view-static`.
- The policy has no `script-src` and no `'unsafe-inline'`.
- CSS containing `</style` is rejected.

## Alternatives considered
- **`webContents.insertCSS()` from `main` (rejected; the main alternative).**
  CSS injected by `main` bypasses the page CSP, which would allow
  `style-src 'none'`. A probe showed it applies under `default-src 'none'`
  with zero violations. It lost for three reasons:
  1. **Unstyled flash.** At `dom-ready`, and at `did-finish-load`,
     `capturePage()` already returned a painted frame of the unstyled content
     in 6 of 6 successful captures. Static windows are visible from
     construction. Avoiding the flash needs `show: false` plus
     `ready-to-show` or `dom-ready` gating inside `createStaticWindow`, which
     is a lifecycle change to the #142 factory for every caller, with its own
     failure paths.
  2. **Styling leaves the document**, so only e2e can prove it.
  3. **The security gain over a hash is marginal**, because the hash admits
     only the one app-controlled stylesheet.
- **`style-src 'unsafe-inline'` (rejected).** Weaker than the hash, for no
  gain.
- **Load static windows via `loadFile`/`file:` (rejected).** It adds a second
  load path, and `'self'` is scheme-wide under `file:` (ADR-010 D3).
- **Custom `app://` protocol (rejected).** Disproportionate for three static
  documents. It remains a backlog candidate from ADR-010.
- **A build-time precomputed hash (rejected).** The hash could drift from the
  embedded text. Computing it at emit time cannot.
- **Leave the windows unstyled and delete the dead `<link>`s (rejected,
  D1-b).** About and the license notices would be unreadable (unwrapped
  `<pre>`), and the known defect would persist.

## Consequences
- Help and What's New become styled for the first time, a visible and
  intended change. About is styled from the start.
- Every `style=` attribute is refused in static windows. markdown-it emits
  `style` only for aligned table columns. A CI content guard asserts that the
  rendered `help.md` and every `CHANGELOG.md` section contain no `style=`
  and no `<img` (images are also refused).
- Each static document embeds about 44 KB of CSS, which counts against the
  ~2 MiB `data:` URL ceiling. A tested budget of 1 MiB applies to the largest
  document (About).
- The Electron "Insecure Content-Security-Policy" warning no longer appears
  for static windows.
