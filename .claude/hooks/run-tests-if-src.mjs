#!/usr/bin/env node
/**
 * PostToolUse hook — independent test signal, tiered by blast radius.
 *
 * Runs ONLY the fast tiers (unit, plus integration when the edit touches
 * the main<->preload<->renderer contract boundary) on every Edit/Write
 * under src/ or tests/. e2e is deliberately NEVER auto-triggered here:
 * `npm run test:e2e` itself runs `npm run build` (full tsc + esbuild +
 * asset copy) before Playwright even starts, so it does not belong in a
 * loop that fires on every single edit. e2e stays an explicit, once-per-
 * task step (see full-stack-engineer.md's "Pre-Delivery Verification"
 * section) and the code-reviewer's own independent full-suite run remains
 * the real, final gate.
 *
 * This mirrors the test pyramid (Cohn, "Succeeding with Agile", 2009):
 * fast/cheap tests subsidize the tight edit loop, the slow/expensive layer
 * is reserved for an explicit checkpoint. It's a static, auditable
 * path -> tier mapping, not real test-impact-analysis (no coverage-data
 * infra here) — cheap to reason about, cheap to extend.
 *
 * Every invocation — pass or fail — appends one line to
 * `.agents/metrics/test-tier-invocations.ndjson`. This hook's own success
 * path used to be silent, which meant "did e2e really never fire mid-cycle"
 * could only be answered by digging through a session transcript. Now it's
 * answerable by reading one append-only file, the same audit-over-restated-
 * claim standard this project already applies to everything else.
 */
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { relative, isAbsolute, join, dirname } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8"));
const projectDir =
  process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();

const LOG_PATH = join(projectDir, ".agents", "metrics", "test-tier-invocations.ndjson");

function logInvocation(entry) {
  // Best-effort only: a logging failure must never take down the actual
  // test signal this hook exists to provide.
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
  } catch {
    // swallow — logging is a convenience, not the contract
  }
}

const rawPath = String(input.tool_input?.file_path ?? "");
if (!rawPath) process.exit(0);

const rel = (isAbsolute(rawPath) ? relative(projectDir, rawPath) : rawPath)
  .replaceAll("\\", "/");

// NOTE (fixed here): the previous version of this hook filtered on
// `startsWith("test/")` (singular) against a repo that actually keeps its
// suites under `tests/` (plural) — tests/unit, tests/integration,
// tests/e2e. That mismatch meant a direct edit to a test file itself never
// triggered this hook at all, only src/ edits did. Confirmed against the
// real repo layout before fixing.
const underSrc = rel.startsWith("src/");
const underTests = rel.startsWith("tests/");
if (!underSrc && !underTests) process.exit(0);

// e2e is never auto-run by this hook, on purpose — see header comment.
// Covers editing the e2e specs themselves and the Playwright config.
// Logged too (scripts: []) so "was this path ever routed to e2e" is
// answerable from the log alone, not just "was it skipped entirely".
if (rel.startsWith("tests/e2e/") || rel === "playwright.config.ts") {
  logInvocation({
    ts: new Date().toISOString(),
    path: rel,
    scripts: [],
    reason: "e2e-path-never-auto-run",
    ok: true,
  });
  process.exit(0);
}

// Contract-boundary paths: main<->preload<->renderer wiring, and the
// integration suite itself. A change here can silently break the
// preload-api-contract in a way a unit test of one leaf function won't
// catch — worth the extra few seconds of integration coverage on every
// edit, not just at the end.
const touchesContractBoundary =
  rel.startsWith("src/main/") ||
  rel.startsWith("src/preload/") ||
  rel.startsWith("tests/integration/");

const scripts = touchesContractBoundary
  ? ["test:unit", "test:integration"]
  : ["test:unit"];

const runResults = [];

for (const script of scripts) {
  const startedAt = Date.now();
  const result = spawnSync("npm", ["run", script, "--silent"], {
    cwd: projectDir,
    shell: true, // required for npm resolution on Windows
    encoding: "utf8",
    timeout: 60_000,
  });
  const durationMs = Date.now() - startedAt;
  runResults.push({ script, exitCode: result.status, durationMs });

  if (result.status !== 0) {
    logInvocation({
      ts: new Date().toISOString(),
      path: rel,
      scripts: runResults,
      ok: false,
    });

    const tail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .split("\n")
      .slice(-25)
      .join("\n");

    process.stderr.write(
      `TEST SUITE FAILED (${script}) after edit to '${rel}'. This is an ` +
        `independent hook signal, not a self-report. Last output:\n${tail}\n`
    );
    process.exit(2);
  }
}

logInvocation({
  ts: new Date().toISOString(),
  path: rel,
  scripts: runResults,
  ok: true,
});

process.exit(0);
