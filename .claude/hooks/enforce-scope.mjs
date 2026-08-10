#!/usr/bin/env node
/**
 * PreToolUse hook — Task Boundary Contract enforcement.
 * While `.agents/current_scope.json` exists, Edit/Write calls outside its
 * `in_scope` list are blocked. No manifest = no restriction (planning phase).
 * Exit 2 = block; stderr is fed back to Claude as the reason.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";

// Trailing "/**" = recursive directory match (any depth, including the
// directory's own direct children). Anything else = exact match.
// Deliberately minimal — no minimatch/glob dependency, same philosophy
// as protect-governance.mjs's own prefix/exact matcher.
function matchesPattern(rel, pattern) {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return rel === prefix || rel.startsWith(prefix + "/");
  }
  return rel === pattern;
}

const input = JSON.parse(readFileSync(0, "utf8"));
const projectDir =
  process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();

const scopePath = join(projectDir, ".agents", "current_scope.json");
if (!existsSync(scopePath)) process.exit(0); // no active contract

const rawPath = String(input.tool_input?.file_path ?? "");
if (!rawPath) process.exit(0);

const rel = (isAbsolute(rawPath) ? relative(projectDir, rawPath) : rawPath)
  .replaceAll("\\", "/");

// Self-exemption: the manifest itself is always editable, active contract
// or not. Amending scope IS the Lead-approved amendment flow CLAUDE.md
// describes — blocking it forces deleting the whole manifest instead,
// which disables enforcement for every file, not just this one. A narrow
// exemption is strictly safer than that existing workaround. Behavioral
// boundary (subagents must not self-amend) stays enforced by convention
// + the reviewer's git-status check, same backstop as the documented
// Bash gap (ADR-002) — this doesn't change that.
if (rel === ".agents/current_scope.json") process.exit(0);

// Self-exemption: review-report paths are always writable too. A first-
// pass Blocking verdict must be persisted before the fix-and-reverify
// cycle closes the contract — deleting the manifest early (the pre-
// ADR-003 workaround) would prematurely signal a task still in flight
// is done. Same actor and same backstop as the exemption above (ADR-003
// / ADR-004): review reports are produced only by the Lead persisting
// the read-only code-reviewer's findings, never by a scoped subagent,
// and any anomalous content is still caught by the reviewer's own
// independent git-status/diff check on every task.
const isReviewReport =
  rel.startsWith(".agents/specs/review_report") && rel.endsWith(".md");
if (isReviewReport) process.exit(0);

let scope;
try {
  scope = JSON.parse(readFileSync(scopePath, "utf8"));
} catch {
  process.stderr.write(
    `BLOCKED: '.agents/current_scope.json' exists but is not valid JSON. ` +
      `Fix or delete the scope manifest before editing files.\n`
  );
  process.exit(2);
}

const inScope = Array.isArray(scope.in_scope) ? scope.in_scope : [];
const normalizedScope = inScope.map((p) => p.replaceAll("\\", "/"));
if (normalizedScope.some((p) => matchesPattern(rel, p))) process.exit(0);

process.stderr.write(
  `BLOCKED: '${rel}' is not in the active task scope ` +
    `("${scope.task ?? "unnamed task"}"). Per the Task Boundary Contract, ` +
    `report back to the Lead instead of expanding scope unilaterally. ` +
    `Only the Lead, with user awareness, may amend the manifest.\n`
);
process.exit(2);