# ADR-010: Render Mermaid in the renderer with a pinned 11.17.2 bundle in strict mode, behind a main-window Content Security Policy

## Status
Accepted (2026-09-26, Task 45 close-out; the independent re-review passed.
See `.agents/specs/review_report_task45.md`).

## Context
Task 45 adds Mermaid diagrams to the preview. Diagram sources come from
the Markdown document, so they are untrusted input rendered inside the main
window, and that window's preload bridge exposes `listDirectory` and
`openFileByPath`. Before this task the window had no Content Security
Policy, so any script that ran in it could `fetch()` anywhere, and a script
injected through a diagram could read folder listings and send them out.
`contextIsolation` and `sandbox` stop escalation to code execution in the
privileged process, but they do not stop that leak.

Constraints: Mermaid needs a real DOM with layout. `main` has none. The app
must work offline, and it pins dependencies it takes on (ADR-008 precedent).

Measured during Step 1 (see initial_scaffold.md, Task 45 Step 1, for raw
numbers):
- Mermaid 11.17.2 renders under `script-src 'self'` with no
  `'unsafe-eval'`, and needs `style-src 'unsafe-inline'`.
- Chromium matches `'self'` against every `file:` URL when the page itself
  is `file:`.
- Loading the 3.5 MB bundle eagerly adds about 0.5 s to every launch.

## Decision
1. Detect fences whose info string's first word is exactly `mermaid` in
   `main` (a markdown-it fence-rule decorator), and emit an escaped-text
   placeholder. **Render in the renderer** with `mermaid@11.17.2`, pinned
   exactly.
2. Lock the Mermaid configuration: `securityLevel: 'strict'`,
   `startOnLoad: false`, `suppressErrorRendering: true`, and the `secure`
   list extended with `themeCSS`, `themeVariables`, `fontFamily`,
   `altFontFamily`, `theme` and `darkMode` (Step 1 decision D2, approved).
   Never call `bindFunctions`.
3. Add a `<meta>` CSP to the main window: `default-src 'none'; script-src
   'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file: data:
   http: https:; connect-src 'none'; object-src 'none'; frame-src 'none';
   form-action 'none'; base-uri 'self' file:`.
4. Ship `mermaid.min.js` in `dist/renderer/` through the build copy step.
   Load it on demand the first time a document contains a diagram
   (Step 1 decision D1, approved), with its URL resolved against the
   renderer's existing `initialBaseURI` (captured before any `<base href>`
   retarget), never the retargeted document base. The invariant is that the
   URL is resolved to an absolute URL **before any `<base>` retarget**. A
   relative or load-time-resolved URL would pick up a `mermaid.min.js`
   sitting next to the user's document; the decoy fault injection (F5, the
   load-time variant) proves this (amended at Task 45 review: S2). The load respects the
   pass generation.
5. Guard every diagram write with a pass generation, the same class of
   guard as `revealToken` and Task 44's epoch.

## Alternatives considered
- **`@mermaid-js/tiny` (rejected).** A reduced build that omits some
  diagram types and features, so diagrams that render on GitHub could fail
  here. Its size saving matters little once the bundle loads on demand.
- **Pre-render in `main` via mermaid-cli / puppeteer (rejected).** Ships a
  second headless Chromium (100 MB+), spawns a process per render, is slow
  for live reload, and moves an untrusted-input renderer into the
  privileged process.
- **Remote renderer such as Kroki or mermaid.ink (rejected).** Sends
  document content off-machine, breaks offline use, and requires opening
  `connect-src`/`img-src` to a third party. That contradicts the
  no-network guardrail (#161) and the reason for the CSP.
- **Render in `main` with jsdom (rejected).** jsdom has no layout
  (`getBBox`, text metrics), so Mermaid output is wrong or crashes. It
  would also enlarge the privileged process's attack surface.
- **`securityLevel: 'sandbox'` (rejected).** One iframe per diagram means
  `frame-src` must be opened, iframes don't size to their content, dark-mode
  CSS isn't inherited, and text selection and find don't work across the
  document. `strict` + DOMPurify + CSP covers this threat model.
- **Mermaid 12.0.0 (deferred).** New major released 2026-09-10: ELK as the
  default layout and a new default look (visual churn), 5.4 MB vs 3.5 MB,
  and the same CVE-2026-41159 keys remain overridable, so it brings no
  security gain. Backlog candidate once it matures.
- **CSP as a separate prerequisite task (rejected by the user, over the
  Lead's recommendation).** The Lead proposed landing the CSP first. The
  user chose one task because the CSP is the control that makes rendering
  untrusted diagrams in the bridge-bearing window acceptable, and landing
  Mermaid alone would briefly ship a window with no exfiltration barrier.
  Recorded as the user's decision.
- **Eager `<script>` loading (rejected, D1).** Measured about
  +0.5 s to first document paint on every launch, including documents
  without diagrams.
- **CSP through response headers (`session.webRequest`) (rejected).** No
  HTTP response exists for `file://` loads. `<meta>` is the mechanism that
  applies to `loadFile`.
- **SRI-hash `script-src` or a custom `app://` protocol to scope `'self'`
  (deferred).** Either would stop `'self'` from matching arbitrary local
  files. The cost is a build-time hash generator plus `integrity`
  attributes, or a protocol handler that changes URL resolution and the
  ADR-004 base logic. That is disproportionate while no code path can
  insert and execute an arbitrary `<script src>`. Backlog candidate.

## Consequences
- The main window gains a document CSP. Inline and attribute script,
  `eval`, network `fetch`, plugins, frames and form posts are blocked for
  all current and future renderer code, not only for diagrams.
- `style-src 'unsafe-inline'` is a disclosed exception required by Mermaid.
  CSS-only tricks remain possible, and remote `https:` images remain a
  possible outbound channel. `http:` and `https:` images both still load,
  a disclosed trade-off that preserves today's image behavior.
- `'self'` is scheme-wide under `file:`. The residual risk is a script
  element pointing at another local file, which requires a code path that
  inserts and executes script. None exists. The on-demand loader is the
  only script insertion, and its URL is a constant resolved against the
  renderer's own directory (pinned by a decoy test).
- Mermaid is exactly one new dependency, declared in `devDependencies`
  as a build-time asset source. Only the 3.5 MB `mermaid.min.js` ships, in
  `dist/renderer/`, and `app.asar` grows from 12.1 MB to 15.7 MB. Declared
  as a runtime dependency it would have been 142.8 MB (amended at Task 45
  review: B3). Its upgrades are deliberate, reviewed events (exact pin).
- Oversized diagrams (app-side check sharing Mermaid's `maxTextSize`
  constant), diagrams over `maxEdges` (Mermaid throws) and a bundle-load
  failure all show a per-diagram notice.
- Per-diagram theme customization via `%%{init}%%` or frontmatter `config:`
  is not supported.
- The Help and What's New windows (no scripts, no CSP) show diagram
  sources as plain text.
