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
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { relative, isAbsolute } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8"));
const projectDir =
  process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();

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
if (rel.startsWith("tests/e2e/") || rel === "playwright.config.ts") {
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

for (const script of scripts) {
  const result = spawnSync("npm", ["run", script, "--silent"], {
    cwd: projectDir,
    shell: true, // required for npm resolution on Windows
    encoding: "utf8",
    timeout: 60_000,
  });

  if (result.status !== 0) {
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

process.exit(0);
