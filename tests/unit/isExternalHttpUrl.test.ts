import { describe, it, expect } from 'vitest';
import { isExternalHttpUrl } from '../../src/main/linkPolicy';

describe('isExternalHttpUrl (pure classification: allowlist http/https only)', () => {
  it.each([
    ['https://example.com', true],
    ['http://example.com', true],
    ['javascript:alert(1)', false],
    // Throws inside `new URL()` — no base to resolve a bare relative path
    // against — exercising the catch branch specifically.
    ['./relative.md', false],
    // A *valid*, parseable URL whose protocol simply isn't allowlisted —
    // exercising the protocol-check-false branch, not the catch branch.
    ['file:///etc/passwd', false],
    // The literal string markdown-it produces from the real-world Markdown
    // source pattern `[text]("url")` with no space before the opening
    // quote: markdown-it reads the quotes as part of the href literal, not
    // as an optional title. This is the literal reproduction of the real
    // bug found in manual testing, not a synthetic edge case.
    ['"https://google.com"', false],
  ])('classifies %s as %s', (url, expected) => {
    expect(isExternalHttpUrl(url)).toBe(expected);
  });
});
