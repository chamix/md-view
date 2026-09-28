import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ElectronApplication, TestInfo } from '@playwright/test';

// Task 47 D4 (approval condition 4): evidence capture for a failed e2e test,
// e.g. close-document.spec.ts:221's "Target page, context or browser has been
// closed" (the Electron child ended mid-test). Capture only, never a fix:
//   - active only when testInfo.status !== testInfo.expectedStatus;
//   - runs in fixture teardown BEFORE userDataDir (where Crashpad writes) is
//     deleted;
//   - every step is wrapped: an error inside the capture is logged and
//     swallowed, it never waits more than CAPTURE_BUDGET_MS, and it never
//     changes a test's pass/fail.

const STDERR_TAIL_MAX = 8192;
const CRASHPAD_MAX_ENTRIES = 50;
const CAPTURE_BUDGET_MS = 2000;
// Windows fast-fail (STATUS_STACK_BUFFER_OVERRUN), playwright.config.ts's
// documented Task 19 crash class.
const FAST_FAIL_EXIT_CODE = 3221226505;

export interface CrashpadListing {
  entries?: string[];
  error?: string;
}

export interface FailureCaptureInput {
  exited: boolean;
  exitCode: number | null;
  signal: string | null;
  stderrTail: string;
  crashpad: CrashpadListing;
}

export function appendTail(tail: string, chunk: string, max: number = STDERR_TAIL_MAX): string {
  const joined = tail + chunk;
  return joined.length > max ? joined.slice(joined.length - max) : joined;
}

function hex(code: number): string {
  return '0x' + (code >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

// Pure: turns the captured facts into the text attached to the test report.
export function formatFailureCapture(input: FailureCaptureInput): string {
  const lines: string[] = [];
  if (!input.exited) {
    lines.push('process: still running at capture time');
  } else {
    lines.push('process: exited');
    if (input.exitCode === null) {
      lines.push('exit code: none');
    } else {
      let line = `exit code: ${input.exitCode} (${hex(input.exitCode)})`;
      if (input.exitCode === FAST_FAIL_EXIT_CODE) line += ' -- Windows fast-fail, the known Task 19 crash class';
      lines.push(line);
    }
    lines.push(`signal: ${input.signal ?? 'none'}`);
  }

  lines.push('--- stderr tail ---');
  lines.push(input.stderrTail.length > 0 ? input.stderrTail : '(empty)');

  lines.push('--- Crashpad ---');
  if (input.crashpad.error !== undefined) {
    lines.push(`(not listed: ${input.crashpad.error})`);
  } else if (!input.crashpad.entries || input.crashpad.entries.length === 0) {
    lines.push('(no entries)');
  } else {
    lines.push(input.crashpad.entries.join('\n'));
  }
  return lines.join('\n');
}

function listCrashpad(userDataDir: string): CrashpadListing {
  try {
    const dir = path.join(userDataDir, 'Crashpad');
    const names = (fs.readdirSync(dir, { recursive: true }) as string[]).slice(0, CRASHPAD_MAX_ENTRIES);
    const entries = names.map((name) => {
      try {
        const stat = fs.statSync(path.join(dir, name));
        return stat.isDirectory() ? `${name}/` : `${name} (${stat.size} bytes)`;
      } catch {
        return name;
      }
    });
    return { entries };
  } catch (error) {
    return { error: (error as NodeJS.ErrnoException).code ?? String(error) };
  }
}

export interface FailureCapture {
  // setupFailed: the fixture's own setup threw after launch (testInfo.status
  // is not final yet at that point, but the test has failed).
  attachIfFailed(testInfo: TestInfo, userDataDir: string, setupFailed?: boolean): Promise<void>;
}

// Starts recording the child's exit and stderr right after launch. Never
// throws: a recording failure just means less evidence.
export function startFailureCapture(app: ElectronApplication): FailureCapture {
  const record = { exited: false, exitCode: null as number | null, signal: null as string | null, stderrTail: '' };
  try {
    const child = app.process();
    if (child.exitCode !== null || child.signalCode !== null) {
      record.exited = true;
      record.exitCode = child.exitCode;
      record.signal = child.signalCode;
    }
    child.once('exit', (code, signal) => {
      record.exited = true;
      record.exitCode = code;
      record.signal = signal;
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      record.stderrTail = appendTail(record.stderrTail, chunk.toString());
    });
  } catch (error) {
    console.warn('[failureCapture] could not start recording:', error);
  }

  return {
    async attachIfFailed(testInfo: TestInfo, userDataDir: string, setupFailed = false): Promise<void> {
      let timer: NodeJS.Timeout | undefined;
      try {
        if (!setupFailed && testInfo.status === testInfo.expectedStatus) return;
        const work = (async () => {
          const body = formatFailureCapture({ ...record, crashpad: listCrashpad(userDataDir) });
          await testInfo.attach('electron-failure-capture', { body, contentType: 'text/plain' });
        })();
        const budget = new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            console.warn(`[failureCapture] gave up after ${CAPTURE_BUDGET_MS} ms`);
            resolve();
          }, CAPTURE_BUDGET_MS);
        });
        await Promise.race([work.catch((error) => console.warn('[failureCapture] capture failed:', error)), budget]);
      } catch (error) {
        console.warn('[failureCapture] capture failed:', error);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
