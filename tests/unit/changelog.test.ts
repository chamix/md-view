import { describe, it, expect } from 'vitest';
import { extractChangelogSection } from '../../src/main/changelog';

const SAMPLE = [
  '# Changelog',
  '',
  'Preamble text.',
  '',
  '## [2.0.0] - 2026-10-01',
  '',
  '### Added',
  '',
  '- Two',
  '',
  '## [1.1.0] - 2026-09-19',
  '',
  '### Added',
  '',
  '- One point one',
  '',
  '## [1.0.0] - 2026-09-04',
  '',
  '- One point oh',
  '',
].join('\n');

describe('extractChangelogSection (pure line-oriented extraction)', () => {
  it('returns the first section, up to the next heading', () => {
    expect(extractChangelogSection(SAMPLE, '2.0.0')).toBe('### Added\n\n- Two');
  });

  it('returns a middle section, excluding the neighbours', () => {
    expect(extractChangelogSection(SAMPLE, '1.1.0')).toBe('### Added\n\n- One point one');
  });

  it('returns the last section through end of text, trimming trailing blank lines', () => {
    expect(extractChangelogSection(SAMPLE, '1.0.0')).toBe('- One point oh');
  });

  it('returns null when the version is not present', () => {
    expect(extractChangelogSection(SAMPLE, '9.9.9')).toBeNull();
  });

  it('does not treat text before the first section as part of any section', () => {
    const body = extractChangelogSection(SAMPLE, '2.0.0');
    expect(body).not.toContain('Preamble');
  });

  it('matches the bracketed token exactly: 1.1 never matches [1.1.0]', () => {
    expect(extractChangelogSection(SAMPLE, '1.1')).toBeNull();
  });

  it('matches exactly: 1.1.0 never matches [1.1.01], [11.1.0] or [1x1y0]', () => {
    const text = ['## [1.1.01]', 'a', '## [11.1.0]', 'b', '## [1x1y0]', 'c'].join('\n');
    expect(extractChangelogSection(text, '1.1.0')).toBeNull();
  });

  it('never interprets regex metacharacters in the version', () => {
    expect(extractChangelogSection('## [1x1y0]\nbody', '1.1.0')).toBeNull();
    expect(extractChangelogSection('## [1x1y0]\nbody', '.*')).toBeNull();
    expect(extractChangelogSection('## [(]\nbody', '(')).toBe('body');
  });

  it('treats CRLF and LF equivalently', () => {
    const crlf = SAMPLE.replace(/\n/g, '\r\n');
    expect(extractChangelogSection(crlf, '1.1.0')).toBe('### Added\n\n- One point one');
  });

  it('does not end a section at ### or deeper headings', () => {
    const text = '## [1.0.0]\n### Added\n- a\n#### Deep\n- b\n## [0.9.0]\n- old';
    expect(extractChangelogSection(text, '1.0.0')).toBe('### Added\n- a\n#### Deep\n- b');
  });

  it('ends the previous section at ## [Unreleased]', () => {
    const text = '## [1.0.0]\n- shipped\n## [Unreleased]\n- next';
    expect(extractChangelogSection(text, '1.0.0')).toBe('- shipped');
    expect(extractChangelogSection(text, 'Unreleased')).toBe('- next');
  });

  it('accepts a heading without a date', () => {
    expect(extractChangelogSection('## [1.0.0]\n- x', '1.0.0')).toBe('- x');
  });

  it('returns null for empty text, text without headings, and preamble-only text', () => {
    expect(extractChangelogSection('', '1.0.0')).toBeNull();
    expect(extractChangelogSection('just words\nmore words', '1.0.0')).toBeNull();
    expect(extractChangelogSection('# Changelog\n\nPreamble only.', '1.0.0')).toBeNull();
  });

  it('returns an empty string for a section with an empty body', () => {
    expect(extractChangelogSection('## [1.0.0]\n\n\n## [0.9.0]\n- old', '1.0.0')).toBe('');
    expect(extractChangelogSection('## [1.0.0]', '1.0.0')).toBe('');
  });

  it('first match wins when a heading is duplicated', () => {
    const text = '## [1.0.0]\nfirst\n## [0.9.0]\nmid\n## [1.0.0]\nsecond';
    expect(extractChangelogSection(text, '1.0.0')).toBe('first');
  });

  it('never throws on odd input', () => {
    const odd = ['## [', '## []', '## [unterminated', '\r', '\n\n\n', '## [a]] [b]', '['.repeat(1000)];
    for (const text of odd) {
      expect(() => extractChangelogSection(text, '1.0.0')).not.toThrow();
      expect(() => extractChangelogSection(text, '')).not.toThrow();
    }
  });
});
