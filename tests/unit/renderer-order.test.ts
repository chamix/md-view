import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyRenderedContent } = require('../../src/renderer/renderer.js');

describe('applyRenderedContent (renderer.js call-order guardrail)', () => {
  it('calls setBaseHref before setInnerHtml — deterministic, no DOM, no timing dependency', () => {
    const calls: string[] = [];
    const setBaseHref = () => calls.push('base');
    const setInnerHtml = () => calls.push('html');

    applyRenderedContent('<h1>hi</h1>', 'file:///some/dir/', setBaseHref, setInnerHtml);

    expect(calls).toEqual(['base', 'html']);
  });

  it('passes the given html and baseUrl through to the respective setters', () => {
    let receivedHtml: string | undefined;
    let receivedBaseUrl: string | undefined;

    applyRenderedContent(
      '<p>content</p>',
      'file:///a/b/',
      (url: string) => {
        receivedBaseUrl = url;
      },
      (markup: string) => {
        receivedHtml = markup;
      }
    );

    expect(receivedBaseUrl).toBe('file:///a/b/');
    expect(receivedHtml).toBe('<p>content</p>');
  });
});

describe('Task 51: skin.js script order and renderer wiring', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path');
  const html: string = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');
  const rendererSrc: string = fs.readFileSync(path.join(__dirname, '../../src/renderer/renderer.js'), 'utf8');

  it('loads skin.js after copy.js and before renderer.js (renderer.js is the composition root)', () => {
    const scripts = [...html.matchAll(/<script src="\.\/([a-z.-]+)"><\/script>/g)].map((m) => m[1]);
    expect(scripts).toEqual(['diagrams.js', 'copy.js', 'skin.js', 'renderer.js']);
  });

  it('re-applies the skin from both entry points: the skin push and every Dark Mode application (#226)', () => {
    expect(rendererSrc).toMatch(/window\.mdview\.onSkin\(\(skin\) => \{\s*lastSkin = skin;\s*reapplySkin\(\);/);
    expect(rendererSrc).toMatch(/lastDark = isDark;\s*reapplySkin\(\);/);
  });

  it('resolves theme hrefs against initialBaseURI, never the retargeted document.baseURI', () => {
    expect(rendererSrc).toMatch(/baseUri: initialBaseURI/);
  });
});
