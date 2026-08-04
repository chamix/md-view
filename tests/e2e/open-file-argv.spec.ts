import * as path from 'path';
import { test, expect, _electron as electron } from '@playwright/test';

// The host shell may set ELECTRON_RUN_AS_NODE=1 (e.g. some CI/dev-tool
// environments), which forces any Electron binary to run as plain Node
// instead of booting the Electron runtime (app/BrowserWindow become
// undefined). Strip it from the child process env so the launched app
// always runs as real Electron regardless of the parent shell's env.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

test('opens a markdown file passed via argv and renders it', async () => {
  const app = await electron.launch({
    args: [
      path.join(process.cwd(), 'dist/main/index.js'),
      path.join(process.cwd(), 'tests/e2e/fixtures/sample.md'),
    ],
    env: childEnv,
  });

  const window = await app.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Playwright Fixture Heading', { timeout: 10000 });

  await app.close();
});

test('shows a visible error state for a missing file and does not crash', async () => {
  const app = await electron.launch({
    args: [
      path.join(process.cwd(), 'dist/main/index.js'),
      path.join(process.cwd(), 'tests/e2e/fixtures/does-not-exist.md'),
    ],
    env: childEnv,
  });

  const window = await app.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Could not open file', { timeout: 10000 });

  // App is still alive/responsive after the failed render, not crashed.
  expect(app.windows().length).toBeGreaterThan(0);

  await app.close();
});

test('shows a visible error state for a non-.md file selected via the dialog, and does not crash', async () => {
  // Note: argvFilePath() itself only ever picks up argv entries that already
  // end in ".md" (by design, per functional_domain.md's "content-based scan"
  // guardrail), so renderFile()'s own "not a .md file" early-rejection branch
  // is unreachable through the argv trigger — passing a non-.md argv path
  // (e.g. package.json) never even reaches renderFile(); argvFilePath()
  // returns null and nothing is rendered at all. The dialog trigger is the
  // one wired path that can actually hand renderFile() a non-.md path (the
  // OS file picker's extension filter is not a hard guarantee), so this test
  // exercises that branch by mocking dialog.showOpenDialog in the main
  // process (Playwright's electronApp.evaluate) to return a real,
  // already-existing non-.md file, then driving the native File > Open…
  // menu item (menu-open) -> openFileViaDialog() -> renderFile() path a
  // user would, via app.evaluate() since there is no in-page button anymore.
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js')],
    env: childEnv,
  });

  const nonMdPath = path.join(process.cwd(), 'package.json');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [filePath],
    })) as typeof dialog.showOpenDialog;
  }, nonMdPath);

  const window = await app.firstWindow();
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click());

  const content = window.locator('#content');
  await expect(content).toContainText('Could not open file', { timeout: 10000 });
  await expect(content).toContainText('Not a Markdown file', { timeout: 10000 });

  // App is still alive/responsive after the rejected render, not crashed.
  expect(app.windows().length).toBeGreaterThan(0);

  await app.close();
});
