# Review Report: Task 51 (skins: 51a core + persistence, 51b wiring + UI), whole diff

Reviewer: `code-reviewer` (independent). Hardened profile, security-relevant. Persisted by the Lead. 51a's own report and addendum: `review_report_task51a.md` (PASS after one test-only fix).

## VERDICT: PASS. No Blocking items. Four Non-blocking notes.

## Non-blocking

- **NB1. Clobber window in `onSelectSkin`.** It writes the whole in-memory `{ activeSkin, customSkins }` after `canPersistSkinChange` (which only checks the file parses). A valid external edit to a custom skin that has not yet been re-read on focus could be overwritten. Mitigations: a menu click needs window focus and the focus event triggers the re-read (a few ms of async I/O) first; the same race exists for `settings.json` and was deliberately mirrored. Cost: only the user's last unsynced custom-skin edit. Option: re-read inside `onSelectSkin` and merge only `activeSkin` into the on-disk object. Not holding the PR.
- **NB2. A failed write reverts the choice on the next focus.** After a #220 held-file failure memory and disk differ; the next focus re-read sees a valid differing file and replaces memory. Consistent with settings and #216. Worth a note in ADR-014.
- **NB3. "Changed" in the focus re-read compares `JSON.stringify`**, so key order counts (custom-skin order is menu order). Harmless; commented as intentional.
- **NB4. `index.ts` grows** (skin state, handlers, focus re-read). Acceptable for the composition root; a `SkinController` extraction is the next step if it keeps growing.

## Evidence

### (a) Scope
Tracked changes: `package.json`, `help.md`, `index.ts`, `menu.ts`, `api.ts`, `preload/index.ts`, `index.html`, `renderer.js`, `window-chrome.spec.ts`, `preload-api-contract.test.ts`, `menu.test.ts`, `preload-api.test.ts`, `renderer-order.test.ts` (+ specs, hook-touched metrics ndjson). Untracked: the 51a files, `skin.js`, `skin.test.ts`, `skins-menu.spec.ts`, `skins-persistence.spec.ts`, ADR-014, review reports, scope manifest. All map to the manifests. `app.css` and `windowConfig.ts` untouched (empty diff). CSP unchanged; the only `index.html` diff is the added `<script src="./skin.js">`. The `window-chrome.spec.ts` change is exactly two appended `'separator','menu-skin'` pairs.

### (b) Architecture and bridge
Exactly one new channel (`SKIN`), the `ResolvedSkin` type and `onSkin`; the preload adds only an `ipcRenderer.on` wrapper; no raw IPC passthrough, no new renderer->main surface; tests pin the channel. Dependencies point inward; `menu.ts` stays pure (`skinMenu` required 4th parameter); `skin.js` takes its ports (body, links) as parameters; load order pinned by a unit test.

### (c) Security
`skin.js` uses only `style.setProperty` / `removeProperty` / `link.href`; no `innerHTML|cssText|insertAdjacentHTML|outerHTML` outside a header comment. Token names `/^--color-[a-z-]+$/`; color text `/^(?:#[0-9a-fA-F]{3,8}|transparent|rgba?\([0-9., ]{5,40}\))$/` (looser than main only on numeric ranges; `;`, `)`, `url`, `var`, `!important` cannot appear); filenames `/^[a-z0-9-]+\.css$/` resolved with `new URL`. Unit tests reject `../evil.css`, `x.css" onload="y`, `http://...`, `a/b.css`; an unsafe token is removed, never left stale. Main: `broadcastSkin` always passes `toSkinPayload`; `onSelectSkin` only accepts names in `listSkinNames`. Menu labels are plain text with `&` doubled (`Rock && Roll`, `A&&&&B`, `<b>x</b>` unchanged), clicks pass the original name, ids are `menu-skin-<index>`; e2e uses a real skin `Mine & Co` -> label `Mine && Co`. `onEditSkins` opens a fixed main-computed path and never overwrites (#221).

### (d) Behavior and e2e strength
#212/#213: Default computed chrome colors in both modes, github hljs sheets, checked radio; each of 4 skins asserts `#title-bar` background in both halves and both hljs hrefs, zero `requestfailed`/console errors; #226 skin selected with Dark Mode on; #224 markdown stylesheets unchanged; build ships `skin.js` + all 8 theme files. #214-#217: missing file -> no write; corrupt -> healed with byte-identical `.bak`; unknown `activeSkin` -> Default shown, file byte-identical; focus re-read applies valid edits/new names and ignores corrupt (no write, no `.bak`), triggered through the real `onWindowFocus` listener. #219-#221: corrupt-file selection applies in memory, warns, file byte-identical; held file contained (alive, choice kept, warning, no rejection, no `.tmp`, later write keeps the custom skin); Edit Skins creates when missing, opens the exact path, never overwrites a corrupt file. Disclosed expectation changes verified: `menu.test.ts` 6->8 entries (+ mechanical 4th argument on 22 calls); `skins-menu.spec.ts` separator id `''`->`undefined` (new test never green before).

### (e) Test runs
`npm run build` 0; `test:unit` 38 files / 635 passed; `test:integration` 10 files / 118 passed; `tsc --noEmit` clean; full `test:e2e` 210 passed (4.2m), zero failures/flakes/skips.

### (f) Mutation checks (tracked files, `cmp`-verified restore, dist rebuilt)
1. `index.ts` `canPersistSkinChange` check -> `if (true)`: `skins-persistence.spec.ts` #219/D2 test RED (1 failed, 8 passed).
2. `renderer.js` skin reapply on Dark Mode toggle disabled: e2e #212 and #213 tests RED (2 failed, 5 passed) and unit `renderer-order.test.ts` #226 RED.

### (g)/(h) SOLID, Help, ADR
See (b) and NB4. Help matches behavior (4 skins, Dark Mode picks the half, markdown card keeps its colors, `skins.json`, Edit Skins, `.bak`, Default syntax for custom skins; it under-promises `#rgba`). Build matches ADR-014.
