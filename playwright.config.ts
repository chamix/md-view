import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Capped from Playwright's default (CPU-count-based, was 4 on this
  // machine) after Task 19's 12-run-before/12-run-after comparison:
  // 0/12 hard Electron worker-process crashes (Windows fastfail,
  // code=3221226505) at workers: 2, versus 2/12 at the default. The
  // underlying cause (CPU/memory/handle pressure from N concurrent
  // Electron processes) wasn't further isolated — this is a measured
  // mitigation, not a fix. Revisit if that root cause ever gets its
  // own investigation.
  workers: 2,  
});
