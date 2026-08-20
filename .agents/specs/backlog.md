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

  - [Resolved 2026-08-17] Task 16 (drag-and-drop file open) is the first
  renderer→main IPC crossing in this app. Guardrail #10's investigation
  (functional_domain.md) confirmed empirically: a `File` built via
  Playwright's `page.evaluate(() => new File(...))` resolves to `''` from
  `webUtils.getPathForFile()` even in the real running app, and
  `contextBridge`-exposed methods (`window.mdview.openDroppedFile`) cannot
  be monkey-patched from web content — closing off a literal "drop a real
  file, see it render" e2e proof. Compensating strategy that worked and is
  now the reusable pattern for any future renderer→main task: (1)
  `app.evaluate(({ ipcMain }, ch) => ipcMain.emit(ch, {}, realPath))`
  invokes the real, already-registered main-process listener directly with
  a real filesystem path, bypassing only the renderer/preload File-
  resolution boundary — proved guardrails #1 and #8. (2) `ipcMain.on`
  supports multiple listeners per channel; a second, test-only counting
  listener added via `app.evaluate()` alongside (not replacing) the
  production one let a real `document.dispatchEvent(drop)` through the
  actual renderer→preload→ipcMain chain prove "exactly one open requested"
  for a multi-file drop (guardrail #2) without needing to distinguish
  *which* file by content. (3) `new DragEvent('drop', { dataTransfer:
  <plain object> })` throws (`"Failed to convert value to 'DataTransfer'"`)
  in this Electron/Chromium version — worked around with `new Event('drop',
  ...)` plus a manually-attached `.dataTransfer` property before dispatch;
  plain `DragEvent` construction without a `dataTransfer` payload (used for
  the `preventDefault()` proof) works fine. (4) The nested-element
  `dragenter`/`dragleave` depth-counter fault-injection, predicted as
  possibly impractical, turned out fully practical via normal DOM bubbling
  (`bubbles: true` dispatched at a child element). Full trail in
  `review_report_task16.md`. The one item genuinely out of reach in this
  environment: physically dragging a real file from Windows Explorer onto
  a running `npm run dev` window to observe Chromium's native
  navigate-away default with/without the `preventDefault()` fix — no
  GUI/mouse automation tool was available to either the implementer or the
  independent reviewer. Flagged to the user at close-out; not resolved by
  this task, tracked below.

- [Pending] Task 16's one unperformed check: a real, physical drag of a
  `.md` file from Windows Explorer onto a running `npm run dev` window
  (with the `preventDefault()` fix reverted, then reapplied), to confirm
  Electron's documented default (navigate the whole window to the
  dropped file) is what actually happens today and is actually suppressed
  by the fix. functional_domain.md guardrail #3 calls for this explicitly
  as a one-time baseline; neither the implementing engineer nor the
  independent reviewer had GUI/mouse automation available in their
  sandboxed sessions to perform it. The automated proxy
  (`event.defaultPrevented === true` on a synthetic `dragover`/`drop`,
  independently fault-injection-verified RED→GREEN by the reviewer) is
  the only coverage that currently exists for this guardrail. Low risk —
  the mechanism (`event.preventDefault()` suppressing a browser default
  action) is standard, well-documented behavior — but genuinely
  unconfirmed on this specific app/Electron version by direct
  observation. Worth a two-minute manual check next time someone is at
  the physical dev machine.

  - [Pending] `tests/e2e/ui-shell.spec.ts:67` (window-width assertion,
  `containerBox.width > 800`) failed once during Task 16's review under
  4-worker parallel `npm run test:e2e` load, then passed cleanly both in
  isolation and on a full-suite rerun. Not part of Task 16's diff/scope —
  pre-existing flakiness under parallel contention, same class as the
  already-logged `live-reload.spec.ts` flakiness above. Non-blocking,
  worth revisiting alongside that entry next time e2e flakiness is
  addressed as its own task.

  - [Resolved 2026-08-17] `code-reviewer`'s frontmatter grants bare `Bash` alongside
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

- [Pending] Task 16 close-out (both the original review and its follow-up
  round, 2026-08-17) logged `RUN_LOG.md` and closed the scope contract
  before the Lead had evaluated `review_report_task16.md` — not a one-off:
  it happened twice in the same task. The original review's "Pass, 0
  Blocking" verdict turned out to rest on a guardrail #2 test that only
  asserted an IPC-send *count*, not which file's path was sent (a
  "last-file-wins" regression would have passed it silently); the Lead
  caught this only after the row was already marked `Success` in the log.
  The follow-up round repeated the exact same sequencing, again logging
  `Pass` before the Lead's evaluation of that round reached the
  conversation. In both cases the underlying work turned out to hold up on
  inspection, so nothing had to be retracted — but the process gap is
  real: nothing currently gates `RUN_LOG.md`/close-out on Lead sign-off,
  only on the reviewer reaching a verdict. Neither `enforce-scope.mjs` nor
  `protect-governance.mjs` can fix this — it's a sequencing question
  between subagent close-out and Lead review, not a file-write permission,
  so no existing PreToolUse hook has the right shape to catch it. Needs a
  process fix, not a hook: e.g. an explicit line in the
  `code-reviewer`/`full-stack-engineer` agent definitions' Output sections
  and/or the delegation-prompt template stating that Step 3 close-out
  (`RUN_LOG.md` append, scope-contract deletion) happens only after the
  Lead has evaluated the review report and given an explicit go-ahead —
  not automatically once the reviewer reaches its own verdict. Not
  resolved here — flagged for whenever `.claude/agents/*.md` is next
  touched. Note the source-of-truth split: this backlog entry is
  project-specific and belongs in `md-view` directly, but the actual fix
  (agent definition wording) lives in `claude-blueprints` first, per
  usual, then ports.

- [Pending] Task 17's `tests/e2e/file-tree.spec.ts:228` (Open Folder…
  test) failed once under default 4-worker parallel `npx playwright
  test` load during the reviewer's independent verification of the
  guardrail-#5-on-failed-render follow-up fix, then passed cleanly on
  two immediate reruns and in isolation. The failing test's own code was
  unchanged at the time (byte-identical to the version already reviewed
  and passed earlier in the same task). Same class of pre-existing
  parallel-contention flakiness already tracked above
  (`live-reload.spec.ts`'s primer test, `ui-shell.spec.ts:67`) — a fresh
  data point in that bucket, not a new distinct issue and not a Task 17
  regression. Non-blocking, worth folding into whichever future task
  addresses e2e flakiness as its own effort rather than chasing
  individual instances as they surface.

- [Pending — priority raised] E2E parallel-contention flakiness (see the
  three entries directly above: `live-reload.spec.ts`'s primer test,
  `ui-shell.spec.ts:67`, and Task 17's `file-tree.spec.ts:228` "Open
  Folder…" test) recurred a **fourth** time during Task 18's independent
  review — same test (`file-tree.spec.ts`'s "Open Folder…" case, zero
  diff in Task 18's own changes), same failure shape (30s timeout on 1
  of 3 full runs at default 4-worker parallelism, clean on immediate
  rerun and in isolation). The Task 18 reviewer explicitly recommended
  prioritizing this as its own effort rather than continuing to log new
  occurrences task after task — every additional e2e spec file (this
  project has added several since the pattern first appeared) increases
  the odds of hitting the same shared resource-contention ceiling during
  a full-suite run, and it is now a recurring cost on every review round
  rather than a one-off curiosity. Still non-blocking (every documented
  occurrence has been a clean rerun, never a genuine regression), but
  flagged to the user as a candidate for its own scoped task — likely
  investigation directions: whether `playwright.config` should reduce
  default worker count for this project's Electron-heavy suite, whether
  specific tests need more generous timeouts under contention, or
  whether the shared `BrowserWindow`/Electron-process overhead itself is
  the bottleneck.

  Task 19 investigated this directly and the three entries above stay
  `[Pending]`, not `[Resolved]` — see the new entry immediately below
  for what was actually learned.

- [Pending] Task 19 tested the shared-`userDataDir` hypothesis directly
  with a real 12-run-before/12-run-after comparison and it did not hold
  up. Every one of the suite's 40 `electron.launch()` call sites was
  migrated to a Playwright `test.extend` fixture giving each test its
  own `fs.mkdtempSync` `userDataDir` (independently reviewed, no
  blocking issues, FI-1 teardown-on-failure proof reproduced by the
  reviewer). Baseline: 8/12 clean, 4/12 failed. Post-fix, same
  conditions: 8/12 clean, 4/12 failed — identical count. Two sub-findings
  worth separating out, not lumping together:
  1. The suite's two hard worker-process crashes (Windows
     `code=3221226505`, a fastfail — not a timeout, not previously
     logged in this backlog before Task 19) occurred in baseline on
     `view-menu.spec.ts:134` and `open-file-argv.spec.ts:47`, and
     post-fix on `code-highlighting.spec.ts` and `ui-shell.spec.ts:4` —
     four different tests across four occurrences. Per-test profile
     isolation should have stopped this if profile-lock contention were
     the cause; it didn't, on a different random test each time. Points
     toward raw resource pressure (CPU/memory/handles) from running 4
     concurrent full Electron/Chromium processes on this machine,
     independent of whether they share a profile directory.
  2. `ui-shell.spec.ts`'s already-logged flaky test (line-shifted to
     `:49`/`:4` by the migration) failed twice post-fix on a *different*
     assertion than the one originally logged (`marginLeft > 32`,
     received `31.2` — a borderline layout-timing race) rather than the
     originally-logged `width > 800` check. Also unaffected by profile
     isolation, also unexplained.

  The fixture itself was kept (real DRY win — centralizes 40 duplicated
  `childEnv` blocks into one place, real teardown guarantee via
  Playwright's fixture lifecycle vs. a hand-rolled helper) but does not
  close this backlog item. Per the task's own guardrails, a second
  hypothesis (e.g. lowering `playwright.config.ts`'s default worker
  count, investigating actual CPU/memory headroom on this dev machine
  under 4 concurrent Electron launches) was deliberately not guessed at
  and implemented silently — flagged here for the user to scope as its
  own follow-up task if/when priority allows. Full raw 12-run tables for
  both baseline and post-fix live in `review_report_task19.md` and the
  Task 19 section of `initial_scaffold.md`.