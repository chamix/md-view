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
 * Exit 2 = block; stderr is fed back to Claude as the reason.
 */
import { readFileSync } from "node:fs";
import { relative, isAbsolute, resolve } from "node:path";

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
const PROTECTED = [
  "CLAUDE.md",
  ".claude/",
  ".agents/specs/functional_domain.md",
  ".agents/specs/initial_scaffold.md",
];

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
process.exit(0);
