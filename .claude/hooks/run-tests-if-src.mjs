#!/usr/bin/env node
/**
 * PostToolUse hook — independent test signal.
 * After any Edit/Write under src/ or test/, runs the test suite and reports
 * the raw result. On failure, exit 2 feeds the failure output back to Claude
 * (the edit already happened; this is feedback, not a block).
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

if (!rel.startsWith("src/") && !rel.startsWith("test/")) process.exit(0);

const result = spawnSync("npm", ["test", "--silent"], {
  cwd: projectDir,
  shell: true, // required for npm resolution on Windows
  encoding: "utf8",
  timeout: 110_000,
});

if (result.status === 0) {
  process.exit(0);
}

const tail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  .split("\n")
  .slice(-25)
  .join("\n");

process.stderr.write(
  `TEST SUITE FAILED after edit to '${rel}'. This is an independent hook ` +
    `signal, not a self-report. Last output:\n${tail}\n`
);
process.exit(2);
