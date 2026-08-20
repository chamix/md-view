import * as path from 'path';
import { test, expect } from './support/fixtures';

test.use({ electronArgs: [path.join(process.cwd(), 'tests/e2e/fixtures/with-code/doc.md')] });

test('renders syntax-highlighted markup for a fenced code block with a recognized language', async ({ electronApp }) => {
  const window = await electronApp.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Code Highlighting Fixture', { timeout: 10000 });

  // Real hljs token markup (not just <pre><code> wrapper) proves both that
  // highlight.js actually ran and that the highlight.js CSS asset
  // (dist/renderer/github.css) was copied and is loadable by the page.
  const keywordToken = content.locator('.hljs-keyword');
  await expect(keywordToken.first()).toBeVisible({ timeout: 10000 });
  await expect(keywordToken.first()).toHaveText('function');
});
