import * as path from 'path';
import { test, expect } from './support/fixtures';

test.describe('opens a markdown file passed via argv', () => {
  test.use({ electronArgs: [path.join(process.cwd(), 'tests/e2e/fixtures/sample.md')] });

  test('opens a markdown file passed via argv and renders it', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();
    const content = window.locator('#content');
    await expect(content).toContainText('Playwright Fixture Heading', { timeout: 10000 });
  });
});

test.describe('missing file via argv', () => {
  test.use({ electronArgs: [path.join(process.cwd(), 'tests/e2e/fixtures/does-not-exist.md')] });

  test('shows a visible error state for a missing file and does not crash', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();
    const content = window.locator('#content');
    await expect(content).toContainText('Could not open file', { timeout: 10000 });

    // App is still alive/responsive after the failed render, not crashed.
    expect(electronApp.windows().length).toBeGreaterThan(0);
  });
});

test('shows a visible error state for a non-.md file selected via the dialog, and does not crash', async ({ electronApp }) => {
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
  const nonMdPath = path.join(process.cwd(), 'package.json');
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [filePath],
    })) as typeof dialog.showOpenDialog;
  }, nonMdPath);

  const window = await electronApp.firstWindow();
  await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click());

  const content = window.locator('#content');
  await expect(content).toContainText('Could not open file', { timeout: 10000 });
  await expect(content).toContainText('Not a Markdown file', { timeout: 10000 });

  // App is still alive/responsive after the rejected render, not crashed.
  expect(electronApp.windows().length).toBeGreaterThan(0);
});
