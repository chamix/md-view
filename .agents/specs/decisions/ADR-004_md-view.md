# ADR-004: Resolve theme-link hrefs to absolute URLs at renderer setup time

## Status
Accepted

## Context
`src/renderer/index.html`'s four theme `<link>` tags use relative hrefs:
```html
<link id="theme-markdown-light" rel="stylesheet" href="./github-markdown-light.css" />
<link id="theme-markdown-dark" rel="stylesheet" href="./github-markdown-dark.css" disabled />
<link id="theme-hljs-light" rel="stylesheet" href="./github.css" />
<link id="theme-hljs-dark" rel="stylesheet" href="./github-dark.css" disabled />
```
`src/renderer/renderer.js`'s `renderHtml()` rebinds `<base href>` to the open
markdown file's own directory on every `FILE_RENDERED` message — Task 4's
correct, intentional behavior for resolving content-relative images.
Chromium defers fetching a `disabled` stylesheet until it's enabled. By the
time a user opens a file and toggles Dark Mode, `<base href>` already points
at the file's own folder, so `./github-markdown-dark.css` and
`./github-dark.css` resolve against the wrong directory and 404
(`net::ERR_FILE_NOT_FOUND`). `.markdown-body` ends up with no color/
background rule from either theme stylesheet, falling back to browser-default
black text. The light stylesheets never showed this bug because they're
`enabled` from parse time, fetched immediately before any file is ever
opened, while `<base href>` is still correct.

The existing test ((c) in `tests/e2e/view-menu.spec.ts`) asserted only the
four `.disabled` flags and `document.body`'s computed background color
before/after the toggle. Both stayed green through this bug, because
`applyDarkMode()` flips those independently of whether the dark CSS actually
loaded — neither assertion depends on the stylesheet content ever resolving.

## Decision
In `src/renderer/renderer.js`, capture `initialBaseURI = document.baseURI` at
the very top of the existing `if (typeof document !== 'undefined') { ... }`
setup block — before the theme-link `getElementById` lookups and before
`window.mdview.onFileRendered` / `window.mdview.onViewSettings` are
registered. Immediately after the four theme-link lookups, resolve each
link's authored `href` (read via `link.getAttribute('href')`, not the live
`.href` property, to avoid double-resolving if this code path is ever
re-entered) to an absolute URL against `initialBaseURI`:
```js
[markdownLightLink, markdownDarkLink, hljsLightLink, hljsDarkLink].forEach((link) => {
  if (link) link.href = new URL(link.getAttribute('href'), initialBaseURI).href;
});
```
This makes each link's resolved URL absolute and fixed at setup time, immune
to any later `<base href>` change regardless of Chromium's deferred-fetch
timing for `disabled` links. `index.html` is unchanged — the relative hrefs
stay in the markup as authored; resolution happens in JS.

## Alternatives considered
- Drop `disabled` from all four links in `index.html` so all four fetch
  eagerly at parse time (while `<base href>` is still correct), then call
  `applyDarkMode(false)` explicitly as the first line of setup to establish
  real initial state. Rejected: correctness would depend on "no IPC message
  can be processed before this synchronous setup block finishes" — true
  today, but not guaranteed to survive a future refactor that splits
  renderer setup across an async boundary (e.g. an `await` introduced before
  the listeners are registered). Also would have required touching
  `index.html`, which was out of scope for this fix.

## Consequences
- Theme link resolution is now decoupled from `<base href>` entirely and
  from stylesheet fetch timing — correctness no longer depends on *when*
  Chromium chooses to fetch a `disabled` stylesheet.
- A future contributor adding a fifth theme-like link must remember to
  resolve it the same way at setup time (before any IPC listener
  registration), or reintroduce this bug class for that new link.
- The regression is now covered by a strengthened assertion in test (c):
  `#content`'s actual computed `color` after the Dark Mode toggle (not just
  the independent `.disabled` flags), each theme link's resolved `.href`
  staying anchored under the renderer's own directory rather than the open
  file's directory, and a zero-console-error / zero-failed-request
  assertion across the toggle flow.
