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
