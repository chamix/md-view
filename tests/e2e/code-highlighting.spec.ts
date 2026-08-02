import * as path from 'path';
import { test, expect, _electron as electron } from '@playwright/test';

// The host shell may set ELECTRON_RUN_AS_NODE=1 (e.g. some CI/dev-tool
// environments), which forces any Electron binary to run as plain Node
// instead of booting the Electron runtime (app/BrowserWindow become
// undefined). Strip it from the child process env so the launched app
// always runs as real Electron regardless of the parent shell's env.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

test('renders syntax-highlighted markup for a fenced code block with a recognized language', async () => {
  const app = await electron.launch({
    args: [
      path.join(process.cwd(), 'dist/main/index.js'),
      path.join(process.cwd(), 'tests/e2e/fixtures/with-code/doc.md'),
    ],
    env: childEnv,
  });

  const window = await app.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Code Highlighting Fixture', { timeout: 10000 });

  // Real hljs token markup (not just <pre><code> wrapper) proves both that
  // highlight.js actually ran and that the highlight.js CSS asset
  // (dist/renderer/github.css) was copied and is loadable by the page.
  const keywordToken = content.locator('.hljs-keyword');
  await expect(keywordToken.first()).toBeVisible({ timeout: 10000 });
  await expect(keywordToken.first()).toHaveText('function');

  await app.close();
});
