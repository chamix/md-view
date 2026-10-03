#!/usr/bin/env node
/**
 * PreToolUse hook — destructive-git-command guard.
 * Blocks Bash calls that would discard uncommitted work via a whole-file
 * or whole-tree git revert: `git checkout [--] <path>`, bare `git
 * checkout -f`/`--force` (tree-wide, no path), `git restore <path>`
 * (unless `--staged` without `--worktree`), `git reset --hard`, and
 * `git clean -f`/`-fd`/`--force`.
 *
 * Root cause this closes: code-reviewer holds no Edit/Write tools "by
 * design" (code-reviewer.md), but its `tools:` frontmatter still grants
 * bare `Bash`, which achieves the same write effect via `sed -i`,
 * heredocs, `git apply`, etc. — including git commands that snap a file
 * back to HEAD, silently discarding uncommitted changes made by a
 * DIFFERENT actor earlier in the same session (see ADR-005). This is
 * distinct from ADR-002's gap: ADR-002 covers Bash writes bypassing
 * scope-EXPANSION checks; this covers Bash DESTROYING already-legitimate,
 * in-scope work that just happens to still be uncommitted.
 *
 * Deliberately narrow: only blocks when the target actually HAS
 * uncommitted changes right now. Checkout/reset/clean on already-clean
 * state is a harmless no-op and stays allowed — this must not get in
 * the way of routine, safe use of these commands.
 *
 * Detection is a plain whitespace token scan per top-level clause, not a
 * position-anchored regex and not a shell parser. Rationale, discovered
 * during hand-verification (see ADR-005 Verification):
 *  - `git diff --quiet HEAD` only sees TRACKED content, so `clean -f`
 *    needed an added untracked-file check (git status --porcelain,
 *    .gitignore-respecting, matching what clean -f itself would target).
 *  - The original position-anchored regexes (`-f` required to sit
 *    immediately after `clean`/`reset`) missed both `--force`-style long
 *    flags AND reordered short flags (`git reset -q --hard` slipped
 *    through). A token scan checks for the relevant flag ANYWHERE in the
 *    subcommand's argument list, closing both at once — they're the same
 *    root cause, not two separate bugs.
 *  - Bare `git checkout -f`/`--force` with no path/branch argument is
 *    tree-wide (same danger class as `reset --hard`) and wasn't handled
 *    at all before. A force flag with no explicit `--` pathspec
 *    separator is now treated as tree-wide too (covers `git checkout -f
 *    <branch>`, which is ambiguous between "force-switch branches" and
 *    "force this path" without `--`, and errs toward the safer read).
 *  - `git restore --staged` is safe alone (index only), but `--staged
 *    --worktree` together also mutate the working tree — the exclusion
 *    now only applies when `--worktree` is absent.
 *  - Command is split on top-level `&&`/`||`/`;`/`|` so a flag from one
 *    chained command can't be misattributed to another. This is still
 *    not a shell parser — quoting and subshells aren't resolved, same
 *    accepted-gap posture as elsewhere in this repo (ADR-002).
 *
 * Known, still-accepted gap: multi-path targets after `--` (e.g.
 * `git checkout -- a.js b.js`) only check the first path, same as the
 * original draft. Not touched here — out of scope for this pass; the
 * reviewer's independent `git status` check remains the backstop.
 *
 * v4 fix — nested-repo blindness (discovered via a deliberate spike on
 * stackfold's md-presenter-style governance layout, SK-ADR-004 A+C: a
 * project's own repo has `.agents/` excluded via `.git/info/exclude` and
 * `.agents/` is itself a SEPARATE nested git repo for private governance
 * backup). Every check below used to run with `cwd: projectDir` — the
 * OUTER repo root — no matter what path or `cd` the command actually
 * targeted. Since the outer repo has no knowledge of an excluded nested
 * repo's tracked content, `git diff`/`git status` against it always came
 * back "clean", so `git checkout -- .agents/metrics/RUN_LOG.md` or `cd
 * .agents && git reset --hard` were both silently ALLOWED and, verified
 * by hand, actually destroyed uncommitted nested-repo content. Verified
 * empirically: ran both, exit 0 both times, then confirmed the change
 * was gone after actually executing `git reset --hard` in `.agents/`.
 *
 * Fix: track `cd <path>` clauses to know the command's effective cwd,
 * resolve the verdict's target to an absolute path from THAT cwd (not
 * projectDir), then walk up from the resolved path to find the NEAREST
 * enclosing git repo (a directory containing `.git`) and run the dirty
 * check there, with the target expressed relative to that repo root.
 * This also handles the non-`cd` case (`git checkout -- .agents/…`
 * with cwd still at projectDir) via the same walk-up, since it's driven
 * by the resolved target path, not by cwd tracking alone. For tree-wide
 * verdicts (`reset --hard`, `clean -f`), the effective target is the
 * WHOLE enclosing repo (git semantics: these always operate on the
 * entire working tree of the repo containing cwd, not just cwd's
 * subtree), so the check target there is the nested repo's root itself.
 *
 * Exit 2 = block; stderr is fed back to Claude as the reason.
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  // Fail CLOSED, same convention as protect-governance.mjs.
  process.stderr.write(
    "BLOCKED: destructive-git-guard hook received unparseable input; " +
      "refusing the command as a safety default.\n"
  );
  process.exit(2);
}

const command = String(input.tool_input?.command ?? "");
if (!command) process.exit(0);

const projectDir =
  process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();

// Split on top-level shell-chaining operators only.
const CLAUSES = command.split(/&&|\|\||[;|]/);

const tokenize = (clause) => clause.trim().split(/\s+/).filter(Boolean);

const isForceFlag = (t) => t === "--force" || /^-[a-z]*f[a-z]*$/.test(t);
const isHardFlag = (t) => t === "--hard";
const isStagedFlag = (t) => t === "--staged" || t.startsWith("--staged=");
const isWorktreeFlag = (t) => t === "--worktree" || t.startsWith("--worktree=");

/**
 * Walk up from `startAbsPath` (file or directory) to find the nearest
 * enclosing git repo root — a directory containing a `.git` entry
 * (directory for a normal repo, file for a worktree/submodule; either
 * counts). Returns null if none is found before the filesystem root.
 */
function findRepoRoot(startAbsPath) {
  let dir;
  try {
    dir = existsSync(startAbsPath) && statSync(startAbsPath).isDirectory()
      ? startAbsPath
      : dirname(startAbsPath);
  } catch {
    dir = dirname(startAbsPath);
  }
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null; // hit filesystem root
    dir = parent;
  }
}

function findVerdictTarget(clause) {
  const tokens = tokenize(clause);
  const gitIdx = tokens.findIndex(
    (t, i) =>
      t === "git" &&
      ["checkout", "restore", "reset", "clean"].includes(tokens[i + 1] ?? "")
  );
  if (gitIdx === -1) return null;

  const sub = tokens[gitIdx + 1];
  const args = tokens.slice(gitIdx + 2);

  if (sub === "checkout" || sub === "restore") {
    if (sub === "restore") {
      const staged = args.some(isStagedFlag);
      const worktree = args.some(isWorktreeFlag);
      if (staged && !worktree) return null; // index-only, safe
    }

    const dashIdx = args.indexOf("--");
    const hasForce = sub === "checkout" && args.some(isForceFlag);

    if (dashIdx !== -1) {
      // Explicit pathspec separator — unambiguous, always path-scoped.
      const target = args[dashIdx + 1];
      return target ? { kind: "path", target, includeUntracked: false } : null;
    }

    if (hasForce) {
      // No `--`, but a force flag present: ambiguous between "force this
      // path" and "force-switch branch, discarding tracked changes" —
      // treat as tree-wide, the safer read.
      return { kind: "tree", target: ".", includeUntracked: false };
    }

    const firstNonFlag = args.find((a) => !a.startsWith("-"));
    if (firstNonFlag) {
      return { kind: "path", target: firstNonFlag, includeUntracked: false };
    }
    return null; // bare `git checkout` / `git restore` with no args — no-op
  }

  if (sub === "reset") {
    return args.some(isHardFlag)
      ? { kind: "tree", target: ".", includeUntracked: false }
      : null;
  }

  if (sub === "clean") {
    // clean -f/-fd/--force removes untracked files too, unlike the others.
    return args.some(isForceFlag)
      ? { kind: "tree", target: ".", includeUntracked: true }
      : null;
  }

  return null;
}

function hasUncommittedChanges(target, { cwd, includeUntracked = false } = {}) {
  const t = JSON.stringify(target ?? ".");
  try {
    // Exit 0 = clean (no diff on TRACKED content). execSync throws on
    // git diff's exit 1 (dirty) — the throw IS the "dirty" signal here.
    // It also throws if `cwd` has no HEAD yet (brand-new repo); treating
    // that as "dirty" is the conservative, fail-closed reading.
    execSync(`git diff --quiet HEAD -- ${t}`, { cwd, stdio: "pipe" });
  } catch {
    return true;
  }
  if (includeUntracked) {
    // git diff HEAD is blind to files never `git add`-ed. git status
    // --porcelain also respects .gitignore, matching what `git clean -f`
    // itself would actually remove.
    const status = execSync(`git status --porcelain -- ${t}`, {
      cwd,
      encoding: "utf8",
    });
    if (status.trim().length > 0) return true;
  }
  return false;
}

let effectiveCwd = projectDir;

for (const clause of CLAUSES) {
  const tokens = tokenize(clause);

  // Track `cd <path>` so later clauses in the same chain resolve targets
  // against the right effective cwd, not always projectDir.
  if (tokens[0] === "cd" && tokens.length >= 2 && !tokens[1].startsWith("-")) {
    effectiveCwd = resolve(effectiveCwd, tokens[1]);
    continue;
  }

  const verdict = findVerdictTarget(clause);
  if (!verdict) continue;

  // Resolve the verdict's target to an absolute path using the command's
  // EFFECTIVE cwd (post any preceding `cd`), not projectDir.
  const targetAbs =
    verdict.kind === "tree" ? effectiveCwd : resolve(effectiveCwd, verdict.target);

  // Find the nearest enclosing repo — may be a nested repo (e.g.
  // `.agents/`), may be projectDir itself. Fall back to projectDir if
  // somehow nothing is found (shouldn't happen inside a real checkout).
  const repoRoot = findRepoRoot(targetAbs) ?? projectDir;

  // Tree-wide operations (`reset --hard`, `clean -f`) always act on the
  // WHOLE working tree of the repo containing cwd — git semantics, not a
  // subtree scoped to cwd — so the check target is the repo root itself.
  const relTarget =
    verdict.kind === "tree" ? "." : relative(repoRoot, targetAbs) || ".";

  if (
    hasUncommittedChanges(relTarget, {
      cwd: repoRoot,
      includeUntracked: verdict.includeUntracked,
    })
  ) {
    const repoNote =
      repoRoot !== projectDir
        ? ` (nested repo at '${relative(projectDir, repoRoot) || "."}')`
        : "";
    process.stderr.write(
      `BLOCKED: '${clause.trim()}' would discard uncommitted changes ` +
        `${verdict.kind === "path" ? `on '${verdict.target}'` : "in the working tree"}` +
        `${repoNote}. ` +
        `If this is your own fault-injection revert, use a narrower method ` +
        `that only undoes YOUR edit (git apply -R on a captured patch, or a ` +
        `direct string revert) — a whole-file/tree checkout can't ` +
        `distinguish your change from someone else's still-uncommitted work. ` +
        `If you genuinely intend to discard everything here, stop and say so ` +
        `explicitly rather than running this directly.\n`
    );
    process.exit(2);
  }
}

process.exit(0);
