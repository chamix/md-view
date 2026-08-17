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
 * Exit 2 = block; stderr is fed back to Claude as the reason.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

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

function hasUncommittedChanges(target, { includeUntracked = false } = {}) {
  const t = JSON.stringify(target ?? ".");
  try {
    // Exit 0 = clean (no diff on TRACKED content). execSync throws on
    // git diff's exit 1 (dirty) — the throw IS the "dirty" signal here.
    execSync(`git diff --quiet HEAD -- ${t}`, { cwd: projectDir, stdio: "pipe" });
  } catch {
    return true;
  }
  if (includeUntracked) {
    // git diff HEAD is blind to files never `git add`-ed. git status
    // --porcelain also respects .gitignore, matching what `git clean -f`
    // itself would actually remove.
    const status = execSync(`git status --porcelain -- ${t}`, {
      cwd: projectDir,
      encoding: "utf8",
    });
    if (status.trim().length > 0) return true;
  }
  return false;
}

for (const clause of CLAUSES) {
  const verdict = findVerdictTarget(clause);
  if (!verdict) continue;
  if (hasUncommittedChanges(verdict.target, { includeUntracked: verdict.includeUntracked })) {
    process.stderr.write(
      `BLOCKED: '${clause.trim()}' would discard uncommitted changes ` +
        `${verdict.kind === "path" ? `on '${verdict.target}'` : "in the working tree"}. ` +
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
