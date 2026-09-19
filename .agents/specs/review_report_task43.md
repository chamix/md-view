# Review Report: Task 43 — "What's New" release notes on update

Reviewer: `code-reviewer` (independent; read-only tools; did not author the spec or the code).
Two review rounds. The reviewer could not write this file itself (shell heredoc
quoting / write blocked), so the Lead saved the reviewer's inline reports here,
condensed but with every finding and every raw count preserved.

- Round 1 verdict: **BLOCKED** (1 Blocking, 6 Non-blocking)
- Round 2 verdict: **APPROVE WITH NON-BLOCKING NOTES** (0 Blocking)

Spec: `functional_domain.md` Task 43 (guardrails #132-144), `initial_scaffold.md`
Task 43 (Step 1), `decisions/ADR-009_md-view.md`.

---

## Round 1 — BLOCKED

### Blocking

**B1. Seen-version write lost when the app exits as the What's New window closes
(guardrail #139 unmet on the last-window / quit path).**
- `src/main/index.ts` (round-1 build, ~461-466): `win.on('closed', () => {
  whatsNewWindow = null; void recordVersionSeen(ports, content.version); })`. The
  write (mkdir, writeFile, rename) is async and fire-and-forget; `window-all-closed`
  calls `app.quit()` on non-darwin right after the last window's `closed`. Nothing
  awaited the write and there was no `before-quit`/`will-quit` hook for it.
- Empirical reproduction (ad hoc Playwright-Electron probe from the scratchpad,
  repo untouched; state.json seeded `0.0.1`, temp userData, launched `electron .`):
  - Close What's New only (main open), then `app.close()`: `1.1.0` 5/5 (the only
    path the e2e covered).
  - Close What's New, wait 800ms, then close main: `1.1.0` 5/5.
  - **Close MAIN first, then What's New (last window): stayed `0.0.1` 3/3** (6/6 in
    an earlier variant).
  - **`app.quit()` while What's New open: stayed `0.0.1` in 4/5.**
- Impact: a user who closes the main window then dismisses What's New, or quits
  with it open, sees the same notes on every launch. No crash / data loss.
- Routed to `full-stack-engineer` as a narrow task (see Round 2).

### Non-blocking
- **N1.** `tests/integration/fileTree.test.ts` imports `index.ts` with a mocked
  `electron` whose `app` lacks `getVersion`; stderr shows the swallowed
  `What's New: unexpected failure: TypeError: ...getVersion is not a function`.
  Harmless (the `.catch` swallows it — incidentally proves #140 at the wiring
  level). Silencing needs an out-of-scope edit. Accepted.
- **N2.** Legacy e2e specs still use an explicit `ENTRY_POINT`: `tree-panel.spec.ts`
  (:336/346), `view-menu.spec.ts` (:147/165), `window-chrome.spec.ts` (:129). With
  an explicit script `app.getVersion()` is Electron's `44.3.0`; tree-panel and
  window-chrome pass only `userDataDir` (not forwarded), so they use the shared
  real `%APPDATA%\Electron` profile, where `state.json` now contains
  `{"lastSeenVersion":"44.3.0"}` (settings.json already lived there — pre-existing
  pattern). No What's New window can appear (no changelog section for an Electron
  version -> warn + null, no write). Acceptable.
- **N3.** Fixture change (`args: [..., '.']`, `cwd: REPO_ROOT`) is sound: `electron .`
  resolves package.json `main`, so real app identity/version apply; sanity test
  asserts `app.getVersion() === package.json version`; still runs built `dist/`.
- **N4.** `index.ts` refactor deviates from the specced single `openStaticWindow`
  into `createStaticWindow` / `loadStaticHtml` / `staticWindowCssHrefs` — judged a
  sound deviation: lockdown lives in exactly one place; each caller owns its window
  variable, single-instance guard and `closed` handler. Help behavior matches
  `HEAD` hunk by hunk (options spread, removeMenu, will-navigate preventDefault
  first, setWindowOpenHandler, `closed` -> null, loadURL try/catch moved verbatim);
  help-menu.spec (a)-(e) pass.
- **N5.** Edge cases — all accepted/documented, none a defect: `## [x]` in preamble
  or fenced code read as a heading (documented #134); `[ 1.1.0 ]` inner spaces don't
  match (exact token, by design); BOM in state.json -> corrupt -> silent first-launch
  overwrite (#137); locked/failed rename rejects, caught, old file intact, temp
  cleaned (#140/#141); downgrade announces (inequality, tested); concurrent instances
  get unique temp names; no-trailing-newline and CRLF tested; Help + What's New open
  together is fine (separate variables/guards).
- **N6.** Fault-injection RED/GREEN by source mutation could not be run (permission
  classifier denied source-mutating commands); causal claims checked by inspection
  plus the empirical probes.

### Verified OK (round 1)
1. **Scope:** changed + untracked files == `current_scope.json`; only expected extras
   (Lead-authored specs/ADR/manifest; hook-modified `test-tier-invocations.ndjson`).
   `settingsStore.ts`, `settings.ts`, `menu.ts`, `electron-builder.yml`, `.github`,
   `README.md`, `src/main/help` unmodified; `package.json` diff = build script only
   (`;require('fs').copyFileSync('CHANGELOG.md','dist/CHANGELOG.md')`, no glob).
2. **Guardrails #132-144** each traced to code and executed tests: #132-134
   `changelog.ts:4-30` (`===` on captured token, `split(/\r?\n/)`, any `^##\s+\[`
   boundary); #135 `appState.ts:6-26` (zod `.strict()` + `min(1)`); #136
   `path.join(userData,'state.json')`; #137 `whatsNew.ts:34-41`; #138
   `whatsNew.test.ts:80-87` + e2e; #139 no save on announce/missing/blank/read
   failure (five tests), recorded only in `closed` (but see B1); #140 every port call
   wrapped + `.catch(warn)`; #141 `appStateStore.ts` unique temp + rename + rm +
   rethrow (vi.mock of `node:fs/promises` spreads the real module and throws on the
   next `rename` only — sound); #142 lockdown parity + no `window.mdview` + Ctrl+O
   probe with positive control; #143 `dist/CHANGELOG.md` identical to source
   (`cmp`), `dist-changelog.test.ts` uses `changelogPathFor(<repo>/dist/main)` and
   the compiled `dist/main/changelog.js`; #144 `whatsNew.ts:43` returns before any
   I/O.
3. **Architecture:** `changelog.ts` no imports; `appState.ts` only `zod`;
   `whatsNew.ts` only `./appState`, `./changelog`; `whatsNewWindow.ts` a type import;
   `appStateStore.ts` only `node:fs/promises`, `node:path`; only `index.ts` touches
   Electron. Three narrow function ports; Facade; no inheritance.
   `buildHelpHtml(..., title = 'md-view Help')` default output unchanged; title
   escaped (`a & <b> "c"` -> `a &amp; &lt;b&gt; &quot;c&quot;`).
4. **Wiring:** `showWhatsNewIfDue().catch(warn)` is the last statement of
   `app.whenReady().then`; main window stays `firstWindow()`.
5. **Test quality:** assertions on observable behavior; only two short settle waits
   (500/800ms) for negative assertions; positive waits `expect.poll` 10s-bounded.
6. **Shipped prose (Task 42 governance rule):** full `git diff CHANGELOG.md` = hunk
   `@@ -5,6 +5,12 @@`, 6 added lines, 0 removals (`## [Unreleased]`, `### Added`,
   `- A "What's New" window that shows the release notes the first time md-view
   launches after an update.`); resulting file read top to bottom; no leaked internal
   text. Only new user-visible src string: `What's New in md-view <version>`.

### Round 1 raw output
- `npx tsc -p tsconfig.json --noEmit`: exit 0
- `npm run build`: exit 0
- `npm run test:unit`: Test Files 25 passed (25); Tests 166 passed (166)
- `npm run test:integration`: Test Files 7 passed (7); Tests 48 passed (48)
- `npx playwright test tests/e2e/whats-new.spec.ts help-menu app-launch open-file-argv`: 16 passed (24.2s)
- `npm run test:e2e` (full): 1 failed, 109 passed (2.6m) — failure
  `ui-shell.spec.ts:57` `containerBox.width` expected > 800, received 576 (known
  backlog flake); isolated reruns of ui-shell.spec.ts: 10 passed, 10 passed.

---

## Round 2 — APPROVE WITH NON-BLOCKING NOTES

Changes since round 1 (engineer, after the Lead routed B1 back): `index.ts`
`pendingSeenWrite` + `will-quit` hold (cleared on settle, `setImmediate` re-quit,
3s cap); `appStateStore.ts` `renameWithRetry` (unrequested; EPERM/EBUSY/EACCES, 6
attempts, 10ms x attempt backoff); +2 integration tests; +2 e2e exit-path tests and
in-app `BrowserWindow.close()` window closing.

### Blocking
None. **B1 closed.**

### Non-blocking
- **R2-N1.** `view-menu.spec.ts:189` (g) failed once in the full run with
  `SyntaxError: Unexpected end of JSON input` (`JSON.parse(fs.readFileSync(settingsPath))`)
  — the non-atomic `writeSettingsFile` already logged in `backlog.md` (Task 41 entry);
  `settingsStore.ts` diff empty; this task does not touch `settings.json`. Isolated:
  `-g "(g)" --repeat-each=20` 137 passed / 3 failed (the (g) JSON error once, (d)
  twice); `-g "(d)" --repeat-each=30` 29 passed / 1 failed. The (d) failures are
  EPERM on `fs.rmSync(userDataDir)` (`view-menu.spec.ts:181`), Windows temp-dir
  cleanup after `app.close()`, not the app. Not run against a pre-change baseline —
  rests on the documented signature and untouched code; treated as the pre-existing
  flake bucket.
- **R2-N2.** The 3s `setTimeout` in the `will-quit` hold is never cleared/`unref`'d
  (harmless: re-quit happens when the write settles; exits observed 176-504ms). One
  over-long comment line (cosmetic). If the disk stalls >3s the quit proceeds and the
  write may be lost with a `.tmp` orphan — accepted trade-off of a bounded hold.
- **R2-N3.** `renameWithRetry` is an unrequested addition inside an in-scope file;
  `settingsStore.ts` untouched; judged justified; noted for the record.
- Carried forward: N1 unchanged; N2-N5 unchanged; N6 still applies to earlier
  claims (B1 tested empirically instead).

### Verified OK (round 2)
**A. B1 closed** (probes from scratchpad, `electron .`, state seeded `0.0.1`):

| Scenario | Round 1 | Round 2 |
|---|---|---|
| Close main first, then What's New (last window) | `0.0.1` 3/3 | `1.1.0` 10/10 |
| `app.quit()` while What's New open | `0.0.1` 4/5 | `1.1.0` 10/10 |
| Close What's New, then main | `1.1.0` 5/5 | `1.1.0` 10/10 |

`whats-new.spec.ts --repeat-each=10`: 90 passed (2.3m); no failures; no
`code=3221226505` worker crashes.

**B. will-quit hold cannot leave the app unquittable** (`index.ts:34`, `:465-477`,
`:641-651`): (i) nothing shown -> null -> returns immediately, quits 281-364ms
unchanged; (ii) settled write clears itself (`=== write` guard), later quit not held
(176-375ms, 5/5); (iii) quit-while-open held, exit 249-504ms, state `1.1.0` 10/10;
(iv) last-window-closed on non-darwin reaches `will-quit` after `closed` (10/10);
(v) `Promise.race` with 3s cap bounds the hold (cap not fired in probes; by
inspection cannot hang); (vi) `pendingSeenWrite` nulled before the race so the second
`app.quit()` re-enters `will-quit`, sees null, returns — cannot loop; (vii) macOS
`window-all-closed` doesn't quit, later Cmd+Q sees settled/null promise, in-flight
write still awaited; (viii) `before-quit: stopWatching` re-runs harmlessly
(`stopWatching` idempotent, `:325-328`); `recordVersionSeen` never rejects, so no
unhandled rejection. `setImmediate(() => app.quit())` preferred over `app.exit()`
(which would skip further quit handlers); the microtask-ignored failure mode was not
independently reproduced but the design worked in 30 probe runs + 90 e2e runs.

**C. `renameWithRetry`** (`appStateStore.ts:26-40`, used `:54`): retries only
EPERM/EBUSY/EACCES; other/missing code rethrows immediately; <=6 attempts, sleeps
10/20/30/40/50ms (~150ms) << 3s cap; `catch` (`:55-57`) still `rm`s the temp and
rethrows; target untouched on failure -> #141 holds. Two new integration tests
non-tautological and timing-independent (retry test asserts `renameCalls === 3`,
replaced content, no temp leftovers; persistent test asserts rejection with the
injected message, `renameCalls < 20`, target `Buffer.equals` original bytes, no
`.tmp` orphan; the code-less injected failure still surfaces, proving the code
filter). Existing directory-target test now takes ~150ms of retries where the
platform reports EPERM (not rerun in isolation).

**D. e2e quality:** `seededState('0.0.1')` asserted while window open and after main
closes; `state == current` asserted after process exit (`await exited`) /
`expect.poll` 10s-bounded; no sleeps masking races; raw-launch helper
`withSeededApp` has a `finally` that closes the app and `rmSync`s the temp dir (no
leak); `BrowserWindow.close()` follows the same `closed` -> `window-all-closed` path
as the frameless close button (`CLOSE_WINDOW` -> `mainWindow.close()`).

**E. Regression / scope:** file set unchanged from round 1 (manifest + expected
`.agents` files + hook ndjson); `settingsStore.ts`, `settings.ts`, `menu.ts`,
`README.md`, `src/main/help`, `electron-builder.yml`, `.github` diff empty;
`CHANGELOG.md` diff still exactly the six added lines.

### Round 2 raw output
- `npx tsc -p tsconfig.json --noEmit`: exit 0
- `npm run build`: exit 0
- `npm run test:unit`: Test Files 25 passed (25); Tests 166 passed (166)
- `npm run test:integration`: Test Files 7 passed (7); Tests 50 passed (50) (stderr
  shows the N1 `getVersion` TypeError from `fileTree.test.ts`)
- `npx playwright test tests/e2e/whats-new.spec.ts --repeat-each=10`: 90 passed (2.3m)
- `npm run test:e2e` (full, builds first): Running 112 tests; 1 failed; 111 passed
  (2.6m) — failure `view-menu.spec.ts:189` (g), the known flake (R2-N1)
- `ui-shell.spec.ts` did not fail this run.

Lead notes on this report: the Lead did not override either verdict. The Lead had
pre-flagged the B1 race in the Step 1 blueprint as a "safe-direction, accepted" risk;
the reviewer's empirical reproduction showed it was on a common path, and it was
fixed rather than accepted.
