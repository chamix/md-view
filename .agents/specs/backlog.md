## Backlog

- [Resolved 2026-08-15] Task 13's original fault-injection check (renaming
`build/icon.png` around a `--dir --win` run) read a byte-identical `.exe`
output as evidence that Windows needs a pre-made `build/icon.ico` and
won't convert `.png`. That reading was wrong. Direct testing of the
pinned `electron-builder@25.1.8` icon-conversion tool confirmed
`build/icon.png` alone produces a valid, non-fallback `.ico`, and a real
`npm run package` + installer deploy on Windows (2026-08-15) showed the
correct icon in Explorer, taskbar, and the installed app — no `.ico`
file needed. The original byte-identical result was most likely a stale
`release/`/`dist/` not cleaned between the two fault-injection runs, not
a real gap; not investigated further now that the actual question
(does packaging show the right icon) is settled by the real deploy.
Still unconfirmed: whether `build/icon.icns` is needed for macOS
packaging — not assumed fine just because Windows was.

- [Resolved 2026-08-15] `build/`, `assets/branding/`, and the root-level
  `md-view-icon-assets.zip` are present in the working tree but were never
  `git add`-ed — confirmed via `git log --diff-filter=A -- build assets`
  returning nothing, and `.gitignore` does not exclude either directory.
  A fresh clone or CI checkout would be missing these files entirely,
  which would break both Task 13's new dev-mode copy step and any future
  packaging run. Whether to commit them (and delete the now-redundant
  source zip once `build/`/`assets/` are populated from it) is a
  repo-tracking decision, not a code change — flagged to the user directly
  at Task 13 close-out rather than resolved unilaterally.

- [Pending] Flaky e2e: `live-reload.spec.ts`'s primer test ("live-reloads rendered
  content...") falló intermitentemente bajo carga de 4 workers en
  paralelo durante el review de Task 6 — reproducido como verde en dos
  reruns posteriores (aislado y en el suite completo). No es
  regresión de Task 6 (el diff de esa tarea no tocó nada relacionado a
  chokidar/watcher). Candidato: ampliar la ventana de polling del
  assert, o correr e2e con menos paralelismo. Sin prioridad urgente,
  solo flakiness bajo contención, no una falla determinística.

- [Pending] Task 7's `shouldSkipDevToolsShortcut` lives in `src/main/index.ts`
  and is unit-tested via a `globalThis.__mdViewDevToolsGuardForTests` bridge
  assigned unconditionally in every build (including packaged) — `index.ts`'s
  top-level `app.whenReady()` side effects make it unsafe to import directly
  into a Vitest unit test. Reviewer judged this non-exploitable (never bridged
  to the renderer via contextBridge) but flagged it as a spec-letter wrinkle.
  Cleaner fix than gating the assignment: extract `shouldSkipDevToolsShortcut`
  into its own leaf module (e.g. `src/main/devtools.ts`, no top-level Electron
  calls) — matching the existing `menu.ts`/`linkPolicy.ts`/`paths.ts` pattern —
  so a plain unit test can import it directly and the `globalThis` bridge is
  removed entirely rather than conditioned. Low priority, non-blocking.

- [Resolved 2026-08-08] Dark Mode: heading/paragraph text inside
  `.markdown-body` stayed dark (near-black) against the now-dark
  `body`/chrome background once Dark Mode was on — screenshot showed
  "Arqueología de infraestructura..." nearly unreadable, dark text on dark
  background. The background flipped correctly (app.css's `body.dark-mode`
  class was clearly applying), so the failure was specifically in content
  text color, not the toggle itself.
  Original hypothesis (link-disabled/specificity race between the light
  and dark `.markdown-body` rules) was checked via live DOM inspection and
  was wrong — actual cause was a different mechanism entirely: Chromium
  defers fetching `disabled` stylesheets until enabled, and by toggle time
  Task 4's dynamic `<base href>` (scoped for image-path resolution) had
  already retargeted to the open file's directory, so the dark CSS
  `<link>`s 404'd against the wrong folder. Fixed in Task 9 by resolving
  all four theme-link hrefs to absolute URLs, captured before any file can
  open. See ADR-004 and `review_report_task9.md` for the full trail.

- [Pending] Gray/blue rectangle in the hero image's position, visible in
  the same original dark-mode screenshot — split out per that entry's own
  note, since Task 9 only fixed the text-color bug and never touched
  image rendering. Unconfirmed whether this is dark-mode-related, a
  relative-path issue, or something else. Needs its own live-DOM check
  next session, same discipline as Task 9 — don't assume the cause.

- [Pending] Task 10's HTML-comment stripping (`src/main/markdown.ts`'s
  `strip_html_comments` core rule) operates per-`inline`-token. A comment
  whose `<!--`/`-->` delimiters are split across a Markdown soft line break
  lands in separate `text` tokens by the time the rule runs and is not
  caught — the comment (or comment fragments) would render literally in
  that case. Deliberate, documented scope boundary from Task 10's approved
  spec (`functional_domain.md` guardrail #5), not an oversight. Also noted
  during Task 10's re-review: a list item whose only content is a comment
  (e.g. `- <!-- c1 -->`) resolves to an empty `<li></li>` rather than full
  removal, since the rule only splices out paragraph wrappers, not
  `list_item_open`/`_close` — outside guardrail #1's literal scope ("alone
  in its own paragraph"), not a regression. Low priority — worth widening
  guardrail #1's scope and/or handling soft-break-split comments next time
  this file is touched, not urgent on its own.

- [Pending] Task 14's `tests/e2e/help-menu.spec.ts` test (d) (close Help
  window, reopen, confirm content) needed a fixed ~150ms settle delay plus
  sequential click/wait (instead of a racy `Promise.all`) to stabilize an
  intermittent Playwright/Electron-on-Windows CDP-session race on rapid
  close-then-reopen. Verified stable across 14 consecutive runs after the
  fix, and the independent reviewer confirmed it separately, but it's a
  timing-based workaround rather than an event-based wait — worth
  revisiting for a deterministic wait condition next time this spec is
  touched. Non-blocking per the review report.

- [Pending] `tests/e2e/view-menu.spec.ts` test (c)'s href-anchoring
  assertion (`expect(href).not.toContain('tests/e2e/fixtures')`, added in
  Task 9) is a negative check tied to an incidental fixture-path string,
  not a positive check against the real invariant (href must resolve
  under the app's own `dist/renderer` directory). Catches today's bug;
  wouldn't catch a future regression that resolved hrefs to some other
  wrong location not containing that substring. Low priority — worth
  swapping for a `startsWith` check against the real absolute
  `dist/renderer` path next time this test is touched.

- [Pending] Task 15's `tests/e2e/help-menu.spec.ts` test (e) (Help window
  must not inherit the app menu) uses two fixed `waitForTimeout(300)` calls
  to let a dispatched `CmdOrCtrl+O` key event and a stubbed
  `dialog.showOpenDialog` settle before reading a call counter — same
  fragility class already flagged for test (d)'s close-then-reopen delay in
  Task 14. Passed cleanly across roughly a dozen rebuild/rerun cycles during
  Task 15's implementation and both review passes, but a fixed sleep is
  inherently less robust than polling the counter with a timeout. Worth
  hardening next time this spec file is touched, alongside Task 14's
  already-open note on test (d). Non-blocking per `review_report_task15.md`.

  - [Pending] `code-reviewer`'s frontmatter grants bare `Bash` alongside
  its "no Edit/Write, by design" read-only framing — Bash trivially
  achieves the same write effect (confirmed: `sed -i`, heredocs, `git
  apply` all used directly in Task 14's review), and neither existing
  hook (`enforce-scope.mjs`, `protect-governance.mjs`) can see Bash calls
  at all — both match only `Edit|Write` and key off `tool_input.file_path`.
  Surfaced when the reviewer's own `git checkout -- src/main/index.ts`,
  meant to revert its one-line fault-injection edit, discarded the real
  58-line Task 14 diff on that file instead (self-detected and correctly
  recovered, verified by the Lead — see review_report_task14.md's
  independent-reviewer section for the transcript). See ADR-005
  (claude-blueprints, `docs/decisions/adr-005-reviewer-bash-write-access.md`)
  for the proposed fix: a narrow, diff-aware PreToolUse hook
  (`claude/hooks/guard-destructive-git.mjs`) that blocks whole-file/whole-
  tree git reverts only when the target actually has uncommitted changes.
  Blueprint-first per usual — implement and test in claude-blueprints as
  its own Task (TDD + fault-injection proof) before porting to md-view.
  Also flags a related, separate, not-yet-decided question: the reviewer
  wrote directly to review_report_task14.md via Bash rather than
  returning its report as a final message per code-reviewer.md's Output
  section — left open in the ADR, not resolved.