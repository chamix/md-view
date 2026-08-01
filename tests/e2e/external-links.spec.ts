import * as path from 'path';
import { test, expect, _electron as electron } from '@playwright/test';

// The host shell may set ELECTRON_RUN_AS_NODE=1 (e.g. some CI/dev-tool
// environments), which forces any Electron binary to run as plain Node
// instead of booting the Electron runtime (app/BrowserWindow become
// undefined). Strip it from the child process env so the launched app
// always runs as real Electron regardless of the parent shell's env.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const fixturePath = path.join(process.cwd(), 'tests/e2e/fixtures/with-links/doc.md');

// Mocks shell.openExternal in the main process, capturing every call in a
// globalThis-scoped array so a later app.evaluate() can retrieve what was
// received. Mirrors the established dialog.showOpenDialog mocking pattern
// used elsewhere in this suite (see open-file-argv.spec.ts's dialog-mock
// test), applied to shell.openExternal instead.
async function mockOpenExternal(app: Awaited<ReturnType<typeof electron.launch>>): Promise<void> {
  await app.evaluate(({ shell }) => {
    (globalThis as unknown as { __openExternalCalls: string[] }).__openExternalCalls = [];
    shell.openExternal = (async (url: string) => {
      (globalThis as unknown as { __openExternalCalls: string[] }).__openExternalCalls.push(url);
    }) as typeof shell.openExternal;
  });
}

async function getOpenExternalCalls(app: Awaited<ReturnType<typeof electron.launch>>): Promise<string[]> {
  return app.evaluate(() => {
    return (globalThis as unknown as { __openExternalCalls: string[] }).__openExternalCalls ?? [];
  });
}

test('clicking a valid external link hands it off to the OS browser and does not navigate the app window', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js'), fixturePath],
    env: childEnv,
  });

  await mockOpenExternal(app);

  const window = await app.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Link Fixture', { timeout: 10000 });

  const contentBefore = await content.innerHTML();

  // noWaitAfter: true — Electron's will-navigate + event.preventDefault()
  // leaves the CDP frame-navigation lifecycle in a state Playwright's
  // default post-click navigation wait never resolves from (the navigation
  // is cancelled at the Electron/native layer, not the CDP layer, so no
  // "navigation settled" event ever fires). This is exactly the intended,
  // safe outcome — the click must NOT cause an in-app navigation — so
  // opting out of that wait is correct here, not a workaround for a bug.
  await window.click('text=External Example', { noWaitAfter: true });

  // The click resolves before the main process's will-navigate handler
  // (and the mocked shell.openExternal call it triggers) necessarily
  // finishes — poll instead of asserting immediately to avoid a race.
  await expect.poll(() => getOpenExternalCalls(app), { timeout: 5000 }).toHaveLength(1);
  const calls = await getOpenExternalCalls(app);
  // Allow for Chromium's own URL normalization (e.g. a trailing slash) --
  // don't hardcode exact-string equality against a normalization-safe diff.
  expect(calls[0].replace(/\/$/, '')).toBe('https://example.com');

  const contentAfter = await content.innerHTML();
  expect(contentAfter).toBe(contentBefore);

  await app.close();
});

test('clicking a malformed link opens nothing externally and does not navigate the app window', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js'), fixturePath],
    env: childEnv,
  });

  await mockOpenExternal(app);

  const window = await app.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Link Fixture', { timeout: 10000 });

  const contentBefore = await content.innerHTML();

  // See the sibling test's comment: preventDefault()-cancelled navigation
  // never resolves Playwright's default post-click navigation wait, so
  // noWaitAfter is required here too.
  await window.click('text=Malformed Link', { noWaitAfter: true });

  // Give the main process's will-navigate handler time to run (and, if it
  // were buggy, to call the mocked shell.openExternal) before asserting the
  // negative — checking immediately after click would trivially pass
  // without proving anything actually ran.
  await window.waitForTimeout(500);
  const calls = await getOpenExternalCalls(app);
  expect(calls).toHaveLength(0);

  const contentAfter = await content.innerHTML();
  expect(contentAfter).toBe(contentBefore);

  await app.close();
});
