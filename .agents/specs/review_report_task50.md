# Review Report: Task 50 (CSS color tokens), hardened profile

Reviewer: `code-reviewer` (independent). Persisted verbatim in substance by the Lead.

**Verdict: PASS. No Blocking items.**

## Evidence

### (a) Scope
`git status --porcelain` / `git diff --name-only`: `src/renderer/app.css`, `.agents/specs/{backlog,functional_domain,initial_scaffold}.md`, `.agents/metrics/test-tier-invocations.ndjson` (hook-touched); untracked `tests/unit/css-color-tokens.test.ts`, `.agents/current_scope.json`. Nothing under `.markdown-body`, highlight.js, main or renderer JS touched.

### (b) Original values vs tokens
Every rule in `git diff` of `app.css` checked against `HEAD`, both modes: body background (light `transparent`, dark `#0d1117`), title bar, status bar, `#frontmatter`, `#document-header`, `#document-container`, tree panel, resize handle (+hover), `.doc-header-action` (incl. disabled), tree error/loading/up/empty, diagram error, `body.drag-over` outline all map to matching token values. `.tree-row-active` and `.tree-row-active:hover` still follow `.tree-row:hover`; specificity re-derived for rest/hover in both modes with identical winners. Close-button dark quirks reproduced by tokens (hover bg `rgba(48,54,61,.6)`; glyph `#c9d1d9`). `.doc-tab:hover` keeps light wash in dark via `--color-tab-hover-bg`. `--color-tab-active` `#fd8c73` in both modes.

### (c) Dark-mode overrides
All `body.dark-mode …` rules removed; the only `body.dark-mode` selector left is the single token block. `grep dark-mode src` finds only `app.css`.

### (d) Unit test quality
Five tests: values pinned for all 16 tokens in both modes (extra token also fails); exactly one `:root` and one `body.dark-mode` block; no color literals outside token declarations; every `var(--color-*)` defined in both blocks; identical token sets. Two mutation checks, both RED with readable messages, then restored (5/5 green):
- dark `--color-border-disabled` -> `#30363e`: `--color-border-disabled (dark): expected "#30363d", got "#30363e"`.
- `var(--color-border)` replaced by literals in two `border-bottom` rules: literal reported.
Not vacuous.

### (e) Test runs
- `npm run test:unit`: Test Files 36 passed (36), Tests 391 passed (391).
- `npm run test:integration`: Test Files 9 passed (9), Tests 87 passed (87).
- After `npm run build`, e2e `view-menu`, `tree-panel`, `window-chrome`: 1 failed, 57 passed. Failure: `view-menu.spec.ts:142 (d)` close-and-relaunch settings.json, failing at line 184 — already logged in `backlog.md` as a known `settings.json` partial-read flake; passed 3/3 on `--repeat-each=3`. Unrelated to this diff.
- Full `test:all` was not run as a single reviewer run (the engineer's earlier full e2e run was 194 passed).

### (f) Architecture
CSS-only. Tokens defined once per mode; rules consume tokens only (OCP/DRY, single point of variation). No new dependencies or layering issues.

### (g) Comments and backlog
`app.css` comments accurate (waiver comment, moved Dark Mode note, Task 24 ordering note). Backlog waiver and "Pending" items accurate.

## Blocking
None.

## Non-blocking
1. No test covers a hovered disabled `.doc-header-action` in dark mode (hand-traced equivalent; low risk).
2. Long `linear-gradient(var(...), var(...))` lines (cosmetic).
3. `current_scope.json` `in_scope` omits the spec files and metrics ndjson changed by this task (bookkeeping).
4. Comments cite `functional_domain.md` item numbers (#206a/#206b); fine while numbering stays stable.
