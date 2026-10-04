# Review Report — Task 52: Pre-release documentation catch-up (README + CHANGELOG)

**Verdict: APPROVED — 0 Blocking, 1 Should-fix (nit-level), 0 other Nits.**

Knowledge module consulted: `.claude/knowledge/architecture/principles.md` (fixed pointer, ADR-006). No stack/security module applies — the Lead's spec explicitly declared "none applicable" for this docs-only task (`.agents/specs/initial_scaffold.md`, "Stack declaration and calibration" section), independently confirmed correct since zero `src/` files are touched.

---

## 1. Scope compliance (evidence: `git diff --stat HEAD`, `git status --porcelain`)

```
 .agents/specs/functional_domain.md |  76 ++++++++++++++
 .agents/specs/initial_scaffold.md  | 126 ++++++++++++++++
 CHANGELOG.md                       |   7 +++
 README.md                          |   4 +-
 4 files changed, 212 insertions(+), 1 deletion(-)
```

Only `README.md` and `CHANGELOG.md` were touched by the writer (`.agents/current_scope.json` confirms `in_scope: ["README.md", "CHANGELOG.md"]`). The two `.agents/specs/*.md` diffs are Lead-authored spec appends (Task 52 Step 0/Step 1), out of review scope per the delegation. No `src/`, `package.json`, `package-lock.json`, or `help.md` changed — confirmed via `git diff HEAD -- package.json` (empty output) and no `help.md` entry anywhere in the diff stat. **Verdict: compliant.**

## 2. Claim-by-claim fact-trace (re-derived independently from source, not from the writer's prose)

**Copy text** (`README.md` new bullet, `CHANGELOG.md` new line):
- Read `src/renderer/copy.js` in full: `createCopyController` wires `onContextMenu`/`onCopyEvent`/`onCopyCommand`; `diagramCopyPayload` always returns the Mermaid source (never SVG) for a direct right-click on a diagram, a selection spanning it, or Copy All (`buildCopyAllPayload`/`codeCopyAllPayload`). Matches the claim exactly.
- Read `src/main/help/help.md` lines 32-40 ("Copying text" section) — wording the writer's bullets were modeled on; consistent.
- Read `src/main/menu.ts` in full (lines 1-162): the File/View/Help template (`buildMenuTemplate`, lines 43-137) has **no** `menu-copy*` entries. `Copy`/`Copy All` exist only in a separate `buildCopyMenuTemplate` (lines 153-161), a context-menu-only template, confirmed by its own comment: "a separate template function... never an edit to that File/View/Help template." This directly substantiates the README's claim "There's no new top-level menu item for this — Copy and Copy All are context-menu and keyboard actions only." **Claim verified true.**

**Skins** (`README.md`/`CHANGELOG.md` new bullets):
- `src/main/menu.ts` lines 107-124: `menu-skin` submenu under View, one radio per `skinMenu.names` entry plus `menu-skin-edit` ("Edit Skins…"). Matches "View → Skin ... Edit Skins…" claim.
- `src/main/help/help.md` lines 47-54 ("Skins" section): four built-ins (Default, Claude, Obsidian, Tokyo Night), independent light/dark halves, Dark Mode picks the half without changing the active skin, `skins.json` for custom skins. Matches both new bullets word-for-word in substance.
- Confirmed via a **passing e2e test** independent of the writer's claim: `tests/e2e/skins-menu.spec.ts:69` "the Skin submenu has the 4 built-in radios..." and `:132` "selecting each skin changes the computed chrome color and the highlight sheets; Dark Mode swaps the halves (#213)" — both passed. **Claim verified true.**

**Eight highlight.js theme stylesheets** (README Stack-line clause):
- Read `package.json`'s `build` script directly: it copies `github.css`, `github-dark.css`, then loops `['atom-one-light','atom-one-dark','stackoverflow-light','obsidian','tokyo-night-light','tokyo-night-dark'].forEach(...)` — 2 + 6 = **8** highlight.js theme files into `dist/renderer/`. The claim "Eight of its theme stylesheets ship in dist/renderer/ — the default light/dark pair plus six more" is exactly correct (`github-markdown-{light,dark}.css` are a separate `github-markdown-css` package, correctly excluded from the "highlight.js" count).
- Corroborated by a passing e2e test: `tests/e2e/skins-menu.spec.ts:202` "the build ships skin.js and all eight highlight theme files in dist/renderer" — passed. **Claim verified true.**

**Task 50 omission** (chrome-color-token CSS refactor — not mentioned in either file):
- Read `src/renderer/app.css` lines 155-208: confirms the Task 50 comment block describing 16 `--color-*` tokens (one `:root` light block, one `body.dark-mode` block), with rules elsewhere only referencing `var(--color-*)`.
- Read `.agents/specs/backlog.md` lines 941-957: documents the one disclosed deviation — an invisible `border-color` byte-diff on `.window-control-close::before` (dark mode only), explicitly waived because `border-style: none`/`width: 0` means it never painted regardless of color. No other visual discrepancy is disclosed.
- **This omission is defensible.** Task 50 shipped zero user-visible change by its own guardrail (#204, "zero visual change") and its one preserved discrepancy is provably invisible. It is correctly excluded from a user-facing Features list and CHANGELOG `### Added`/`### Changed` section — there is nothing a user would observe to document.

## 3. Release-mechanics guardrails

- `CHANGELOG.md` diff hunk: `+## [Unreleased]` — exactly this string, no date, no version number, inserted directly above `## [1.2.0] - 2026-09-28`. Matches guardrail #229 exactly.
- `git diff HEAD -- package.json` → empty. `version` field untouched.
- Internal-process leakage scan: `git diff HEAD -- README.md CHANGELOG.md | grep -iE 'task [0-9]|adr-|#[0-9]|reviewer|subagent|guardrail|spec|\.agents|backlog|scope\.json|full-stack-engineer|functional_domain|initial_scaffold'` on added (`^\+`) lines → **zero matches**. Clean.

## 4. Style/voice consistency

- README new bullets (`**Copy text** — ...`, `**Skins** — ...`) match the existing bullet format exactly: bold lead term, em dash, concise sentence(s), no trailing period — consistent with all 10 pre-existing bullets.
- CHANGELOG new bullets (`Copy text: ...`, `Skins: ...`) match the existing `[1.2.0]` `### Added` entries' "Term: sentence." format and end with periods.
- Oxford-comma convention ("Default, Claude, Obsidian, and Tokyo Night") matches the file's established style elsewhere.

## 5. Test-suite evidence (authoritative verdict-gate run)

First `npm run test:all` run (no prior `npm run build`) showed one failure:
```
FAIL tests/integration/dist-changelog.test.ts > ... dist/CHANGELOG.md (via changelogPathFor) equals the repo-root CHANGELOG.md
Test Files  1 failed | 9 passed (10)
     Tests  1 failed | 117 passed (118)
```
Root-caused by reading the test file directly (`tests/integration/dist-changelog.test.ts` lines 6-9): it explicitly "**Requires `npm run build` to have run first**" and compares the *compiled* `dist/CHANGELOG.md` to the repo-root `CHANGELOG.md`. The first run compared a stale pre-edit `dist/CHANGELOG.md` against the just-edited root file — an artifact of invocation order, not a regression. Confirmed against `.github/workflows/ci.yml` (lines 26-31): CI always runs `npm run build` before `test:unit`/`test:integration`.

Re-ran correctly: `npm run build` (exit 0, copied the updated `CHANGELOG.md` into `dist/CHANGELOG.md`) → then full `npm run test:all`:
```
210 passed (5.8m)
[exited with code 0]
```
Since `test:all` is `test:unit && test:integration && test:e2e` and e2e only runs if unit+integration succeeded, exit code 0 with the e2e run completing (210/210) confirms all three tiers passed. **No regression from this docs-only change; full suite green.**

## Should-fix (non-blocking)

1. **Minor wording inconsistency, README vs. CHANGELOG ("Four skins" vs. "Four built-in skins"):** README's Skins bullet says "Four skins ship — Default, Claude, Obsidian, and Tokyo Night" while CHANGELOG says "Four **built-in** skins ship...". Both are factually correct (`skins.json` also supports user-added custom skins, so "built-in" is the more precise qualifier), but the two files describe the same fact with slightly different precision. Not worth blocking delivery over; could be tightened in a future pass for perfect parity.

## Nits

None.

---

**Files reviewed:**
- `README.md`, `CHANGELOG.md`
- `src/renderer/copy.js`, `src/main/menu.ts`, `src/main/help/help.md`, `package.json`
- `src/renderer/app.css` (lines 155-208)
- `.agents/specs/backlog.md` (lines 935-972)
- `.agents/specs/functional_domain.md` / `initial_scaffold.md` (Task 52 appends, Lead-authored, out of scope but read for consistency)
- `.agents/current_scope.json`
- `.github/workflows/ci.yml`
- `tests/integration/dist-changelog.test.ts`

**Overall: APPROVED for delivery.** No Blocking items.
