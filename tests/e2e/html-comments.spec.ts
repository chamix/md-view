import * as path from 'path';
import { test, expect, _electron as electron } from '@playwright/test';

// The host shell may set ELECTRON_RUN_AS_NODE=1 (e.g. some CI/dev-tool
// environments), which forces any Electron binary to run as plain Node
// instead of booting the Electron runtime (app/BrowserWindow become
// undefined). Strip it from the child process env so the launched app
// always runs as real Electron regardless of the parent shell's env.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

test('strips standalone HTML comments from the rendered preview while leaving fenced/raw HTML literal', async () => {
  const app = await electron.launch({
    args: [
      path.join(process.cwd(), 'dist/main/index.js'),
      path.join(process.cwd(), 'tests/e2e/fixtures/with-html-comment/doc.md'),
    ],
    env: childEnv,
  });

  const window = await app.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('HTML Comment Fixture', { timeout: 10000 });

  const text = await content.textContent();
  expect(text).not.toContain('should not be visible');
  expect(text).not.toContain('should also be stripped');
  expect(text).toContain('INSIDE a fenced code block');
  expect(text).toContain('This raw tag sits outside any fence');

  await app.close();
});
