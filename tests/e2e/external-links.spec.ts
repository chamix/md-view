import * as path from 'path';
import type { ElectronApplication } from '@playwright/test';
import { test, expect } from './support/fixtures';

const fixturePath = path.join(process.cwd(), 'tests/e2e/fixtures/with-links/doc.md');

test.use({ electronArgs: [fixturePath] });

// Mocks shell.openExternal in the main process, capturing every call in a
// globalThis-scoped array so a later app.evaluate() can retrieve what was
// received. Mirrors the established dialog.showOpenDialog mocking pattern
// used elsewhere in this suite (see open-file-argv.spec.ts's dialog-mock
// test), applied to shell.openExternal instead.
async function mockOpenExternal(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    (globalThis as unknown as { __openExternalCalls: string[] }).__openExternalCalls = [];
    shell.openExternal = (async (url: string) => {
      (globalThis as unknown as { __openExternalCalls: string[] }).__openExternalCalls.push(url);
    }) as typeof shell.openExternal;
  });
}

async function getOpenExternalCalls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => {
    return (globalThis as unknown as { __openExternalCalls: string[] }).__openExternalCalls ?? [];
  });
}

test('clicking a valid external link hands it off to the OS browser and does not navigate the app window', async ({ electronApp }) => {
  await mockOpenExternal(electronApp);

  const window = await electronApp.firstWindow();
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
  await expect.poll(() => getOpenExternalCalls(electronApp), { timeout: 5000 }).toHaveLength(1);
  const calls = await getOpenExternalCalls(electronApp);
  // Allow for Chromium's own URL normalization (e.g. a trailing slash) --
  // don't hardcode exact-string equality against a normalization-safe diff.
  expect(calls[0].replace(/\/$/, '')).toBe('https://example.com');

  const contentAfter = await content.innerHTML();
  expect(contentAfter).toBe(contentBefore);
});

test('clicking a malformed link opens nothing externally and does not navigate the app window', async ({ electronApp }) => {
  await mockOpenExternal(electronApp);

  const window = await electronApp.firstWindow();
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
  const calls = await getOpenExternalCalls(electronApp);
  expect(calls).toHaveLength(0);

  const contentAfter = await content.innerHTML();
  expect(contentAfter).toBe(contentBefore);
});
