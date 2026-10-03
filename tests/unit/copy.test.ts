import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  escapeHtml,
  preCodeHtml,
  diagramCopyPayload,
  codeCopyAllPayload,
  isDiagramWrapperElement,
  classifyCopyTarget,
  targetHasCopyTarget,
  shouldIncludeFrontmatterInCopyAll,
  createCopyTargetMemory,
} = require('../../src/renderer/copy.js');

// Task 49 (functional_domain.md #196-#203; initial_scaffold.md Task 49 Step 1,
// D1-D4, ADR-013). Pure Node, no DOM -- same posture as diagrams.test.ts: the
// DOM-touching adapters (createRangeCopySerializer, createCopyController) are
// only exercised through tests/e2e/copy-text.spec.ts, reading the real OS
// clipboard, the same honest-limitation posture diagrams.test.ts takes for
// createDiagramDomView.

describe('escapeHtml', () => {
  it('escapes &, <, >, ", \' so the result is safe inside html text/attributes', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(escapeHtml("O'Brien & Sons")).toBe('O&#39;Brien &amp; Sons');
  });

  it('leaves plain text with no special characters untouched', () => {
    expect(escapeHtml('graph TD\n  A to B\n  no specials here')).toBe('graph TD\n  A to B\n  no specials here');
  });

  it('coerces non-string input to a string first', () => {
    expect(escapeHtml(42 as unknown as string)).toBe('42');
  });
});

describe('preCodeHtml (#198 diagram contribution rule, ADR-013 fresh-element invariant)', () => {
  it('wraps escaped text in a bare <pre><code> with no other attributes', () => {
    expect(preCodeHtml('graph TD\n  A[<X>] --> B')).toBe('<pre><code>graph TD\n  A[&lt;X&gt;] --&gt; B</code></pre>');
  });

  it('never leaks md-view-diagram/data-mdview-source markers (F7 target)', () => {
    const html = preCodeHtml('sequenceDiagram\n  A->>B: hi');
    expect(html).not.toContain('data-mdview-source');
    expect(html).not.toContain('data-diagram');
    expect(html).not.toContain('md-view-diagram');
  });
});

describe('diagramCopyPayload (#198: a diagram contributes its source, never its drawing)', () => {
  it('text is the source verbatim; html is the escaped pre/code wrapping', () => {
    const source = 'graph TD\n  A[Start] --> B[End]';
    const payload = diagramCopyPayload(source);
    expect(payload.text).toBe(source);
    expect(payload.html).toBe(preCodeHtml(source));
  });

  it('never contains SVG markup for a plain source string', () => {
    const payload = diagramCopyPayload('graph TD\n  A --> B');
    expect(payload.text).not.toContain('<svg');
    expect(payload.html).not.toContain('<svg');
  });
});

describe('codeCopyAllPayload (#197: Code Copy All is byte-identical to copy-raw-source, plus an html form)', () => {
  it('text is the raw string verbatim, html reuses the same pre/code wrapping', () => {
    const raw = '# Heading\n\n   trailing spaces   \n\nFinal line.\n';
    const payload = codeCopyAllPayload(raw);
    expect(payload.text).toBe(raw);
    expect(payload.html).toBe(preCodeHtml(raw));
  });
});

describe('isDiagramWrapperElement (pure predicate, duck-typed element)', () => {
  const el = (classes: string[]) => ({ classList: { contains: (c: string) => classes.includes(c) } });

  it('true only for an element carrying the md-view-diagram class', () => {
    expect(isDiagramWrapperElement(el(['md-view-diagram', 'other']))).toBe(true);
    expect(isDiagramWrapperElement(el(['other']))).toBe(false);
  });

  it('false for null/undefined/plain objects with no classList', () => {
    expect(isDiagramWrapperElement(null)).toBe(false);
    expect(isDiagramWrapperElement(undefined)).toBe(false);
    expect(isDiagramWrapperElement({})).toBe(false);
  });
});

describe('classifyCopyTarget (#201: diagram > selection > none)', () => {
  it('insideDiagram true always classifies as diagram, regardless of selection', () => {
    expect(classifyCopyTarget({ insideDiagram: true, hasSelection: true })).toBe('diagram');
    expect(classifyCopyTarget({ insideDiagram: true, hasSelection: false })).toBe('diagram');
  });

  it('not inside a diagram, with a live selection, classifies as selection', () => {
    expect(classifyCopyTarget({ insideDiagram: false, hasSelection: true })).toBe('selection');
  });

  it('neither: none', () => {
    expect(classifyCopyTarget({ insideDiagram: false, hasSelection: false })).toBe('none');
  });
});

describe('targetHasCopyTarget (#201: Copy is enabled for diagram or selection, not none)', () => {
  it.each([
    ['diagram', true],
    ['selection', true],
    ['none', false],
  ] as const)('%s -> %s', (classification, expected) => {
    expect(targetHasCopyTarget(classification)).toBe(expected);
  });
});

describe('shouldIncludeFrontmatterInCopyAll (#197/D4/F4: frontmatter only when shown)', () => {
  it('is the negation of frontmatter.hidden', () => {
    expect(shouldIncludeFrontmatterInCopyAll(true)).toBe(false);
    expect(shouldIncludeFrontmatterInCopyAll(false)).toBe(true);
  });
});

describe('createCopyTargetMemory (use case: remembers the last contextmenu classification)', () => {
  it('defaults to none before any contextmenu classification is remembered', () => {
    const memory = createCopyTargetMemory();
    expect(memory.current()).toEqual({ kind: 'none' });
  });

  it('remembering "diagram" stores the classification and its source', () => {
    const memory = createCopyTargetMemory();
    memory.remember('diagram', 'graph TD\n  A --> B');
    expect(memory.current()).toEqual({ kind: 'diagram', source: 'graph TD\n  A --> B' });
  });

  it('remembering "selection" stores just the kind (the live selection is read fresh later)', () => {
    const memory = createCopyTargetMemory();
    memory.remember('selection');
    expect(memory.current()).toEqual({ kind: 'selection' });
  });

  it('remembering "none" clears any previous diagram/selection classification', () => {
    const memory = createCopyTargetMemory();
    memory.remember('diagram', 'graph TD');
    memory.remember('none');
    expect(memory.current()).toEqual({ kind: 'none' });
  });

  it('a later remember() call overwrites, never accumulates', () => {
    const memory = createCopyTargetMemory();
    memory.remember('diagram', 'first');
    memory.remember('diagram', 'second');
    expect(memory.current()).toEqual({ kind: 'diagram', source: 'second' });
  });
});
