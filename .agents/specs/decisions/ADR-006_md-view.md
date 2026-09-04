# ADR-006: Inline SVG icon for the Copy Raw Source button, as a disclosed exception to the zero-icon-dependency default

## Status
Accepted

## Context
Task 34 adds a "copy raw Markdown source" button to `#document-header`.
Every icon-bearing control in this app to date (`#window-minimize`/
`#window-maximize`/`#window-close`, Task 29) has been CSS-drawn with
`::before`/`::after` borders and gradients, with exactly one documented
exception: the tree panel's `▸` expand glyph (a plain Unicode
character, not an asset). `app.css` names this explicitly as the app's
"zero-icon-dependency pattern."

The user's reference for this button was GitHub's own "copy" affordance
— two overlapping rounded rectangles. This shape is drawable in pure
CSS (the maximize/restore button already proves the technique: two
overlapping squares via `border` + a background-colored `::after`), so
the zero-icon-dependency default was a real, viable alternative here,
not a false choice.

## Decision
Use a small inline SVG (two `<svg>` elements inside the button, toggled
via a `.copied` class — one "copy" glyph, one "check" glyph for
post-copy feedback), both using `stroke="currentColor"` so they theme
automatically via the button's own `color` CSS property, with no second
dark-mode SVG asset needed. Chosen over the CSS-drawn alternative
because a two-state icon (copy → check) is meaningfully more awkward to
express as two separate `::before`/`::after` pseudo-elements than as
two toggled inline `<svg>`s.

This SVG markup is original (hand-authored path data for a generic
two-rectangle "copy" pictogram and a generic checkmark), not copied
from GitHub's Octicons asset files, to keep the app's icon surface free
of any third-party asset provenance question.

## Alternatives considered
- CSS-drawn (`::before`/`::after`), matching the window-controls
  precedent exactly. Rejected for this specific control: viable for
  the static "copy" glyph alone, but the two-state copy→check
  transition would need a second full pseudo-element icon layered on
  the same technique, adding real CSS complexity for a shape
  (a checkmark) that is comparatively easy and readable as an SVG path.
- Plain Unicode glyph (matching the tree's `▸` precedent). Rejected: no
  single common Unicode character reliably renders as a recognizable
  "copy" pictogram across platforms/fonts the way `▸` does for a simple
  triangle, and the user's own reference was specifically GitHub's icon
  shape, not a text-glyph substitute.

## Consequences
- This app now has two icon techniques in active use (CSS-drawn +
  one inline-SVG control), not one — this ADR is the disclosed record
  of that, not silent drift. `app.css`'s "zero-icon-dependency pattern"
  comment should be updated to reference this ADR.
- This is a scoped, disclosed exception for a specific two-state icon,
  not a policy change — the CSS-drawn technique remains the app's
  default for any future icon-bearing control.
