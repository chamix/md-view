import { describe, it, expect } from 'vitest';
import { appendTail, formatFailureCapture } from '../e2e/support/failureCapture';

// Task 47 D4 (approval condition 4): the pure half of the e2e failure
// capture. The I/O half (exit/stderr listeners, Crashpad listing, attach)
// is fixture teardown code that only runs on a failed test.

describe('appendTail', () => {
  it('keeps only the last `max` characters', () => {
    expect(appendTail('abc', 'def', 4)).toBe('cdef');
    expect(appendTail('', 'xy', 4)).toBe('xy');
    expect(appendTail('abcd', '', 4)).toBe('abcd');
  });
});

describe('formatFailureCapture', () => {
  it('reports the exit code (with its hex form) and signal of an exited child', () => {
    const text = formatFailureCapture({
      exited: true,
      exitCode: 1,
      signal: null,
      stderrTail: '',
      crashpad: { entries: [] },
    });
    expect(text).toContain('exit code: 1 (0x00000001)');
    expect(text).toContain('signal: none');
  });

  it("flags Windows fast-fail 3221226505 (0xC0000409) as Task 19's known crash class", () => {
    const text = formatFailureCapture({
      exited: true,
      exitCode: 3221226505,
      signal: null,
      stderrTail: '',
      crashpad: { entries: [] },
    });
    expect(text).toContain('3221226505 (0xC0000409)');
    expect(text).toMatch(/fast-fail.*Task 19/);
  });

  it('says so when the child was still running at capture time', () => {
    const text = formatFailureCapture({
      exited: false,
      exitCode: null,
      signal: null,
      stderrTail: '',
      crashpad: { entries: [] },
    });
    expect(text).toContain('process: still running at capture time');
    expect(text).not.toContain('exit code:');
  });

  it('includes the stderr tail verbatim, or marks it empty', () => {
    const withTail = formatFailureCapture({
      exited: true,
      exitCode: null,
      signal: 'SIGKILL',
      stderrTail: 'line one\nFATAL: boom\n',
      crashpad: { entries: [] },
    });
    expect(withTail).toContain('signal: SIGKILL');
    expect(withTail).toContain('--- stderr tail ---\nline one\nFATAL: boom\n');

    const empty = formatFailureCapture({
      exited: true,
      exitCode: 0,
      signal: null,
      stderrTail: '',
      crashpad: { entries: [] },
    });
    expect(empty).toContain('--- stderr tail ---\n(empty)');
  });

  it('lists Crashpad entries, reports none, or reports why it could not list', () => {
    const listed = formatFailureCapture({
      exited: true,
      exitCode: 0,
      signal: null,
      stderrTail: '',
      crashpad: { entries: ['reports/abc.dmp (1024 bytes)', 'settings.dat (40 bytes)'] },
    });
    expect(listed).toContain('--- Crashpad ---\nreports/abc.dmp (1024 bytes)\nsettings.dat (40 bytes)');

    const none = formatFailureCapture({
      exited: true,
      exitCode: 0,
      signal: null,
      stderrTail: '',
      crashpad: { entries: [] },
    });
    expect(none).toContain('--- Crashpad ---\n(no entries)');

    const failed = formatFailureCapture({
      exited: true,
      exitCode: 0,
      signal: null,
      stderrTail: '',
      crashpad: { error: 'ENOENT' },
    });
    expect(failed).toContain('--- Crashpad ---\n(not listed: ENOENT)');
  });
});
