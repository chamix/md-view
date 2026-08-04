import { describe, it, expect } from 'vitest';
import { extractFrontmatter } from '../../src/main/frontmatter';

describe('extractFrontmatter (pure frontmatter split)', () => {
  it('splits valid frontmatter from the remaining body', () => {
    const source = '---\ntitle: X\n---\n\nBody text';
    const result = extractFrontmatter(source);

    expect(result.frontmatter).toBe('title: X');
    expect(result.body).toBe('\nBody text');
  });

  it('returns frontmatter: null and the body unchanged when there is no frontmatter at all', () => {
    const source = '# Heading\n\nSome content.';
    const result = extractFrontmatter(source);

    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(source);
  });

  it('fails closed on an unterminated leading --- (no second --- line anywhere later)', () => {
    const source = '---\ntitle: X\n\nNo closing fence here, just more text.';
    const result = extractFrontmatter(source);

    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(source);
  });

  it('accepted ambiguity (guardrail #1): a horizontal-rule/paragraph/horizontal-rule pattern matches the same fence pattern even though not intended as frontmatter — this is intentional, convention-inherited behavior, not a bug', () => {
    const source = '---\n\nSome divider paragraph\n\n---\n\nMore text';
    const result = extractFrontmatter(source);

    expect(result.frontmatter).toBe('\nSome divider paragraph\n');
    expect(result.body).toBe('\nMore text');
  });
});
