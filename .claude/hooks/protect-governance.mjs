#!/usr/bin/env node
/**
 * PreToolUse hook — governance file protection (v2).
 * Blocks Edit/Write tool calls targeting THIS repository's governance
 * artifacts. Paths outside the project directory are explicitly allowed —
 * they are outside this repo's jurisdiction (Claude Code's own permission
 * system governs them).
 *
 * v2 fix: replaces naive substring matching (which false-positived on
 * ~/.claude/settings.json because it contains ".claude/") with
 * project-relative prefix/exact matching.
 *
 * v3 fix: functional_domain.md / initial_scaffold.md are authored by the
 * Lead during Step 0/1, before any scope contract exists. They now freeze
 * only once a current_scope.json is active — i.e. once they've been
 * approved and task execution has actually started.
 *
 * v4 fix — RUN_LOG.md wasn't protected at all. CLAUDE.md and log-run.md
 * both document it as append-only ("never rewrite or delete prior
 * rows"), but nothing enforced that: a plain Edit/Write call could
 * silently truncate or rewrite history, and this hook's own ALWAYS_
 * PROTECTED list never even listed the path. Found via a spike testing
 * a DIFFERENT gap (guard-destructive-git.mjs's nested-repo blindness,
 * see that file's v4 note) that happened to also probe this hook.
 *
 * Fix is NOT a blanket block — RUN_LOG.md legitimately gets a new row
 * appended via `/log-run` on every task close, so blocking all Edit/
 * Write on it would break the documented workflow. Instead:
 *   - `Write` (whole-file overwrite) is always blocked: there is no
 *     legitimate reason for a pure append-only log to go through a
 *     full-file rewrite.
 *   - `Edit` is allowed ONLY when it provably only appends: the matched
 *     `old_string` must be a suffix of the file's current content, and
 *     `new_string` must start with that same `old_string` as a prefix
 *     (i.e. strictly extends it, never removes or reorders text before
 *     it). Any edit that touches earlier content — however it's framed —
 *     is rejected. This enforces the append-only invariant directly
 *     against file content, not against how the caller describes the
 *     edit.
 *
 * Exit 2 = block; stderr is fed back to Claude as the reason.
 */
import { readFileSync, existsSync } from "node:fs";
import { relative, isAbsolute, resolve, join } from "node:path";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  // Fail CLOSED: a governance guard that crashes must block, not wave through.
  process.stderr.write(
    "BLOCKED: protect-governance hook received unparseable input; " +
      "refusing the edit as a safety default.\n"
  );
  process.exit(2);
}

const rawPath = String(input.tool_input?.file_path ?? "");
if (!rawPath) process.exit(0);

const projectDir =
  process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();

// Resolve to an absolute path, then express it relative to the project root.
const absPath = isAbsolute(rawPath) ? rawPath : resolve(projectDir, rawPath);
const rel = relative(projectDir, absPath).replaceAll("\\", "/");

// Outside the repo (or the repo root itself) → not this hook's jurisdiction.
if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) process.exit(0);

// Trailing "/" = protected directory subtree; otherwise exact file match.
const ALWAYS_PROTECTED = ["CLAUDE.md", ".claude/"];

// functional_domain.md / initial_scaffold.md are authored by the Lead
// during Step 0/1, before any scope contract exists. They freeze only
// once a current_scope.json is active — i.e. once they've been approved
// and task execution has actually started.
const SPECS_PROTECTED_DURING_EXECUTION = [
  ".agents/specs/functional_domain.md",
  ".agents/specs/initial_scaffold.md",
];
const executionInProgress = existsSync(
  join(projectDir, ".agents", "current_scope.json")
);
const PROTECTED = executionInProgress
  ? [...ALWAYS_PROTECTED, ...SPECS_PROTECTED_DURING_EXECUTION]
  : ALWAYS_PROTECTED;

const hit = PROTECTED.find((p) =>
  p.endsWith("/") ? rel.startsWith(p) : rel === p
);

if (hit) {
  process.stderr.write(
    `BLOCKED: '${rel}' matches protected governance pattern '${hit}' in this ` +
      `repository. Governance files are read-only during task execution. If a ` +
      `change is genuinely required, stop and ask the user explicitly — never ` +
      `self-edit the rulebook.\n`
  );
  process.exit(2);
}

// RUN_LOG.md: append-only, always — independent of execution state, and
// enforced by content, not by blocking the path outright (a new row has
// to land somehow).
const RUN_LOG_PATH = ".agents/metrics/RUN_LOG.md";
if (rel === RUN_LOG_PATH) {
  const toolName = String(input.tool_name ?? "");

  if (toolName === "Write") {
    process.stderr.write(
      `BLOCKED: '${rel}' is append-only. A 'Write' call replaces the whole ` +
        `file, which risks losing prior rows — use '/log-run' (an Edit that ` +
        `only appends) instead.\n`
    );
    process.exit(2);
  }

  if (toolName === "Edit") {
    const oldStr = String(input.tool_input?.old_string ?? "");
    const newStr = String(input.tool_input?.new_string ?? "");
    let currentContent = "";
    try {
      currentContent = existsSync(absPath) ? readFileSync(absPath, "utf8") : "";
    } catch {
      // Unreadable existing file — fail closed, same convention as above.
      process.stderr.write(
        `BLOCKED: could not read '${rel}' to verify the edit is append-only; ` +
          `refusing as a safety default.\n`
      );
      process.exit(2);
    }

    const isSuffixOfCurrent =
      currentContent.length > 0 && currentContent.endsWith(oldStr) && oldStr.length > 0;
    const isPureExtension = newStr.startsWith(oldStr);

    if (!isSuffixOfCurrent || !isPureExtension) {
      process.stderr.write(
        `BLOCKED: this edit to '${rel}' doesn't look like a pure append — ` +
          `the matched text isn't the file's current tail, or the replacement ` +
          `doesn't strictly extend it. RUN_LOG.md rows are never rewritten or ` +
          `reordered, only added at the end. If a correction is genuinely ` +
          `needed, stop and ask the user explicitly.\n`
      );
      process.exit(2);
    }
  }
}

process.exit(0);
