# Review Report: Task 42 (v1.1.0 release docs and housekeeping)

Reviewer: code-reviewer (independent, read-only). Branch: feature/042-v1.1.0-release-docs, uncommitted working tree vs main.
Spec checked: functional_domain.md Task 42 guardrails #125-131; initial_scaffold.md Task 42.

## Verdict: APPROVED WITH NON-BLOCKING ITEMS
No Blocking findings. One Should-fix (spec-level, needs a Lead decision) and two Nits.

## Evidence trail

### 1. Scope compliance
git status --short:

    M .agents/metrics/test-tier-invocations.ndjson
    M .agents/specs/functional_domain.md
    M .agents/specs/initial_scaffold.md
    M CHANGELOG.md
    M README.md
    M package-lock.json
    M package.json
    M src/main/help/help.md
    ?? .agents/current_scope.json

Non-.agents changed paths are exactly CHANGELOG.md, README.md, package-lock.json, package.json, src/main/help/help.md, equal to in_scope in .agents/current_scope.json. No untracked non-.agents files. No source (index.ts, menu.ts, etc.), no ADR (ADR dir ends at ADR-007/ADR-008, both pre-existing), no What is New work (guardrail #130 PASS).

.agents/metrics/test-tier-invocations.ndjson diff is +2 appended lines:

    +{"ts":"2026-09-19T14:25:28.124Z","path":"src/main/help/help.md","scripts":[test:unit exit 0, test:integration exit 0],"ok":true}
    +{"ts":"2026-09-19T14:25:35.099Z","path":"src/main/help/help.md","scripts":[test:unit exit 0, test:integration exit 0],"ok":true}

This is the automatic test-tier hook logging the two help.md edits. Append-only telemetry outside the source tree. See Nit N1.

### 2. Guardrail #125 (versions): PASS
git diff package.json package-lock.json:

    package.json:       -  "version": "1.0.0",   +  "version": "1.1.0",
    package-lock.json:  -  "version": "1.0.0",   +  "version": "1.1.0",       (top-level, after "name": "md-view")
                        -      "version": "1.0.0",  +      "version": "1.1.0",  (inside packages[""])

git diff --stat: package-lock.json 4 lines (2+/2-), package.json 2 lines (1+/1-). No dependency churn.

### 3. Guardrail #126 (CHANGELOG): PASS

    -## [Unreleased]
    +## [1.1.0] - 2026-09-19

Single one-line hunk. grep -n Unreleased CHANGELOG.md returns nothing, so no new [Unreleased] section. Every line below the heading is untouched. The date equals the session date (2026-09-19); per the guardrail it must still equal the real tag day (Nit N2).

EOL check, git ls-files --eol:

    i/lf    w/lf    attr/    CHANGELOG.md
    i/lf    w/crlf  attr/    README.md
    i/lf    w/crlf  attr/    package-lock.json
    i/lf    w/crlf  attr/    package.json
    i/lf    w/lf    attr/    src/main/help/help.md

HEAD blobs are LF for all five. CHANGELOG.md and help.md are still LF in the working tree (no flip). README and package*.json are CRLF in the working tree, which is the repo checkout norm under core.autocrlf=true (untouched LICENSE also shows i/lf w/crlf). Git normalizes them, and git diff -w --stat gives the same counts as plain git diff --stat (README 3 lines, package-lock 4, package.json 2), so no EOL noise. The "LF will be replaced by CRLF" messages are only autocrlf notices. No whole-file EOL flip.

### 4. README.md: PASS
Diff read line by line, 2 hunks, nothing else:

    -**Status: v1.0.0.** md-view is a small, working tool ...
    +**Status: v1.1.0.** md-view is a small, working tool ...
    ...
    +- [CHANGELOG.md](CHANGELOG.md) - release history: what changed in each version

The added line follows the .agents/specs/decisions/ bullet in the process-link list. ls CHANGELOG.md succeeds, so the link target exists at the repo root.

### 5. Guardrails #127-129 (help.md): PASS, line by line
Read the full git diff src/main/help/help.md and the entire resulting file top to bottom.

Folder sidebar section vs the README Folder sidebar bullet:

| help.md | README source |
|---|---|
| File -> Open Folder... (Ctrl/Cmd+Shift+O) opens a folder in a sidebar tree | same wording |
| Dropping a folder onto the window also opens it as the tree root, the same as Open Folder... | same wording |
| Clicking a folder expands it; its contents load on demand | "Clicking a folder lazily expands it" |
| Clicking a file opens it in the main pane | same |
| The tree auto-expands to and highlights whichever file is currently open | same |
| The ".. (up one level)" row navigates to the parent folder | same |
| Drag the divider between the tree and the document to resize the sidebar | same |
| View -> Show File Tree toggles the sidebar on or off | same |

All requested items are present: Open Folder... with shortcut, lazy-expand, click-to-open, active-file highlight, up-one-level row, drag-to-resize, View -> Show File Tree.

Paraphrase "lazily expands" -> "expands it; its contents load on demand": faithful. Lazy expansion means children are loaded when the folder is expanded, which is exactly what "load on demand" says, minus the jargon. No behavior is added or lost.

Preview and Code tabs section vs the README Preview and Code tabs bullet: View -> Preview / View -> Code switching between rendered Markdown and a raw-source view with syntax highlighting, and "always shows frontmatter regardless of the Show Frontmatter toggle, which only affects the rendered Preview", are all in the README bullet. The required Code-tab-always-shows-frontmatter statement is present (#127 PASS). It does not contradict the pre-existing Appearance bullet (Show Frontmatter shows or hides YAML frontmatter at the top of the document); it is a more precise refinement.

Copy raw source section vs the README Copy raw source bullet: copy button in the document header, copies raw source with frontmatter to the clipboard regardless of active tab, brief visual confirmation on click. Faithful restatement, documented (PASS).

Shortcuts table: the row "Ctrl/Cmd+Shift+O | Open a folder" is added between Ctrl/Cmd+O and F1 (#128 PASS).

Out-of-scope section: the hunk deletes the heading and all 4 bullets (Versioning/release process, Dark Mode in Help window, Persisting Help window size/position, Live-reloading help.md), and the file now ends cleanly on the F1 table row (#129 PASS).

Leak scan of the entire resulting help.md. Sections: Opening a file, Live reload, Folder sidebar, Preview and Code tabs, Copy raw source, Appearance, Settings file, Syntax highlighting, Images and links, Keyboard shortcuts. No task numbers, "do not implement", "out of scope", spec or guardrail references, or process text anywhere. The pre-existing View-menu-toggles sentence (Dark Mode, Show Frontmatter, Show File Tree) matches the README Persisted settings bullet.

Observation, not a defect: help.md still does not mention drag-and-drop of a .md file (README Features does). Pre-existing and outside this task guardrails.

### 6. Guardrail #129 grep: PASS
grep -rn "Out of scope for this task" src/ -> no output (rc=1).
Repo-wide (excluding node_modules, .git, .agents, dist, out) -> only ./release/win-unpacked/resources/app.asar. That is a gitignored packaged build artifact (.gitignore:3 "release") holding the old help.md; it regenerates on the next npm run package. No tracked twin remains.

### 7. Shipped-app consistency: PASS
src/main/index.ts:359 is the only consumer in src: it reads path.join(__dirname, help, help.md) as utf8 and renders the whole file as Markdown; nothing parses structure. Tests: tests/unit/buildHelpHtml.test.ts uses a synthetic HTML string, not help.md. tests/e2e/help-menu.spec.ts asserts only that the body contains "minimal desktop Markdown previewer", still on line 3 of help.md. Nothing asserts on headings or the deleted section. (e2e not run, per instructions.)

### 8. Tests (unit + integration), run by me
ELECTRON_RUN_AS_NODE is 1 in my environment (known hazard; irrelevant for these tiers).

    npm run test:unit         Test Files  20 passed (20)   Tests  120 passed (120)
    npm run test:integration  Test Files  5 passed (5)      Tests  36 passed (36)

Docs-only task: no RED/GREEN fault injection applies (no testable logic; Task 19/35/36 docs-task exemption). Full test:all and e2e were intentionally not run per the task instructions.

### 9. Guardrail #130: PASS (see section 1).

## Findings

### Blocking
None.

### Should-fix
S1. The CHANGELOG [1.1.0] notes under-report the release (spec-level; needs a Lead decision, not an engineer fix). The 1.1.0 section lists only the File -> Settings item and settings persistence, while README and help.md now document the folder sidebar, Preview/Code tabs and copy-raw-source, all new since 1.0.0. Guardrail #126 (everything below the heading byte-identical) makes the engineer output spec-compliant, so this is a spec gap and not an implementation defect. Recommend the Lead log it in backlog.md or add entries (in Task 43 or a follow-up) before tagging.

### Nit
N1. .agents/metrics/test-tier-invocations.ndjson is modified by the automatic test-tier hook (2 appended lines, section 1). Auto-generated and outside the source tree; it will show up in the commit.
N2. The changelog date 2026-09-19 is the session date; per guardrail #126 correct it in the tagging commit if the tag lands on a different day.

## Governance note (guardrail #131)
This review read the full help.md diff and the whole resulting file line by line and compared each new statement with README wording, rather than relying on diff presence. The backlog.md / RUN_LOG entry recording the Task 37 reviewer-checklist gap is a Lead close-out action and is not yet present in backlog.md (grep for Task 42 or "Out of scope" there had no hits). Remind the Lead to add it at close.
