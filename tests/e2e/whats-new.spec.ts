import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { test, expect } from './support/fixtures';

const repoRoot = path.join(__dirname, '../..');
const currentVersion = (JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string })
  .version;
const changelogText = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');

// Expectations are derived from the real CHANGELOG.md / package.json, never
// hard-coded, so editing the changelog later cannot silently break this spec.
function headingTokens(): string[] {
  return [...changelogText.matchAll(/^##\s+\[([^\]]+)\]/gm)].map((m) => m[1]);
}

// Plain-text lead-in of the current section's first bullet: the text before
// any inline markdown (code span, emphasis, link) so it survives rendering.
function currentSectionSnippet(): string {
  const lines = changelogText.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+\\[${currentVersion.replace(/\./g, '\\.')}\\]`).test(l));
  expect(start, `CHANGELOG.md has a section for ${currentVersion}`).toBeGreaterThan(-1);
  for (let i = start + 1; i < lines.length && !/^##\s+\[/.test(lines[i]); i++) {
    const bullet = /^-\s+([^`*[\]]{12,})/.exec(lines[i]);
    if (bullet) return bullet[1].trim();
  }
  throw new Error(`no plain-text bullet found in the ${currentVersion} section of CHANGELOG.md`);
}

function stateFile(userDataDir: string): string {
  return path.join(userDataDir, 'state.json');
}

function readState(userDataDir: string): string | null {
  try {
    return fs.readFileSync(stateFile(userDataDir), 'utf8');
  } catch {
    return null;
  }
}

function seededState(version: string): string {
  return JSON.stringify({ lastSeenVersion: version });
}

// Closes the windows of one kind (static data: windows vs. the main window)
// from inside the app process. BrowserWindow.close() returns immediately, so
// no protocol call can be left in flight if the app then exits (a Playwright
// page.close() dangling across process exit stalled its own teardown in ~1 of
// 30 runs, and was itself occasionally not observed to close the window).
function closeWindows(app: ElectronApplication, staticWindows: boolean): Promise<void> {
  return app.evaluate(({ BrowserWindow }, wantStatic) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.getURL().startsWith('data:text/html') === wantStatic) w.close();
    }
  }, staticWindows);
}

async function findWhatsNewWindow(electronApp: ElectronApplication): Promise<Page> {
  await expect.poll(() => electronApp.windows().length, { timeout: 10000 }).toBe(2);
  const found = electronApp.windows().find((w) => w.url().startsWith('data:text/html'));
  expect(found, 'a static data: window is open').toBeTruthy();
  return found as Page;
}

test('sanity: app.getVersion() equals package.json version when launched as `electron dist/main/index.js`', async ({
  electronApp,
}) => {
  const runtimeVersion = await electronApp.evaluate(({ app }) => app.getVersion());
  expect(runtimeVersion).toBe(currentVersion);
});

test('fresh userData: exactly one window and state.json records the current version', async ({
  electronApp,
  userDataDir,
}) => {
  await electronApp.firstWindow();

  await expect.poll(() => readState(userDataDir), { timeout: 10000 }).not.toBeNull();
  expect(JSON.parse(readState(userDataDir) as string)).toEqual({ lastSeenVersion: currentVersion });

  // Give a potential (incorrect) What's New window a moment to surface.
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(electronApp.windows().length).toBe(1);
});

test.describe('seeded with the current version', () => {
  test.use({ initialUserDataFiles: { 'state.json': seededState(currentVersion) } });

  test('exactly one window and state.json is left byte-identical', async ({ electronApp, userDataDir }) => {
    await electronApp.firstWindow();
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(electronApp.windows().length).toBe(1);
    expect(readState(userDataDir)).toBe(seededState(currentVersion));
  });
});

test.describe('seeded with an older version', () => {
  test.use({ initialUserDataFiles: { 'state.json': seededState('0.0.1') } });

  test('opens a second window titled with the current version, showing only the current section', async ({
    electronApp,
  }) => {
    await electronApp.firstWindow();
    const whatsNew = await findWhatsNewWindow(electronApp);

    await expect(whatsNew).toHaveTitle(`What's New in md-view ${currentVersion}`);
    const body = whatsNew.locator('body');
    await expect(body).toContainText(currentSectionSnippet(), { timeout: 10000 });
    await expect(body).toContainText(new RegExp(`What.s New in md-view ${currentVersion.replace(/\./g, '\\.')}`));

    // No other release section's heading may leak in (only the current
    // version is ever announced, never skipped/older sections).
    const text = await body.innerText();
    for (const token of headingTokens().filter((t) => t !== currentVersion)) {
      expect(text).not.toContain(`[${token}]`);
    }
  });

  test('state.json stays at the old version while the window is open and becomes current once it is closed', async ({
    electronApp,
    userDataDir,
  }) => {
    await electronApp.firstWindow();
    const whatsNew = await findWhatsNewWindow(electronApp);
    await expect(whatsNew.locator('body')).toContainText(currentSectionSnippet(), { timeout: 10000 });

    expect(readState(userDataDir)).toBe(seededState('0.0.1'));

    await closeWindows(electronApp, true);

    await expect
      .poll(() => JSON.parse(readState(userDataDir) ?? 'null'), { timeout: 10000 })
      .toEqual({ lastSeenVersion: currentVersion });
  });

  test('the window has no window.mdview bridge', async ({ electronApp }) => {
    await electronApp.firstWindow();
    const whatsNew = await findWhatsNewWindow(electronApp);
    await expect(whatsNew.locator('body')).toContainText(currentSectionSnippet(), { timeout: 10000 });

    const mdview = await whatsNew.evaluate(() => (window as unknown as { mdview?: unknown }).mdview);
    expect(mdview).toBeUndefined();
  });

  test('the window has no menu: its inherited CmdOrCtrl+O accelerator cannot reach the file-open handler', async ({
    electronApp,
  }) => {
    const mainWindow = await electronApp.firstWindow();
    const whatsNew = await findWhatsNewWindow(electronApp);
    await expect(whatsNew.locator('body')).toContainText(currentSectionSnippet(), { timeout: 10000 });

    // Same probe as help-menu.spec.ts (e): stub showOpenDialog to a counter,
    // prove the mechanism can observe the accelerator on the main window,
    // then assert the static window's genuinely detached menu never reaches it.
    await electronApp.evaluate(({ dialog }) => {
      const bag = globalThis as unknown as { __mdViewOpenDialogCalls: number };
      bag.__mdViewOpenDialogCalls = 0;
      dialog.showOpenDialog = () => {
        bag.__mdViewOpenDialogCalls += 1;
        return Promise.resolve({ canceled: true, filePaths: [] });
      };
    });

    async function sendCtrlOAndReadCount(isStaticTarget: boolean): Promise<number> {
      await electronApp.evaluate(
        ({ BrowserWindow }, wantStatic) => {
          const target = BrowserWindow.getAllWindows().find(
            (w) => w.webContents.getURL().startsWith('data:text/html') === wantStatic
          );
          target?.focus();
          target?.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'O', modifiers: ['control'] });
          target?.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'O', modifiers: ['control'] });
        },
        isStaticTarget
      );
      await mainWindow.waitForTimeout(300);
      return electronApp.evaluate(
        () => (globalThis as unknown as { __mdViewOpenDialogCalls: number }).__mdViewOpenDialogCalls
      );
    }

    const afterMain = await sendCtrlOAndReadCount(false);
    expect(afterMain).toBeGreaterThan(0);

    await electronApp.evaluate(() => {
      (globalThis as unknown as { __mdViewOpenDialogCalls: number }).__mdViewOpenDialogCalls = 0;
    });

    const afterWhatsNew = await sendCtrlOAndReadCount(true);
    expect(afterWhatsNew).toBe(0);
  });
});

// Guardrail #139 on the exit paths. These cannot use the shared `electronApp`
// fixture: the process exits inside the test, and the fixture's own teardown
// would call app.close() again on an already-dead process (same raw-launch
// pattern as window-chrome.spec.ts's "close button terminates the app").
test.describe('the seen-version write survives process exit', () => {
  async function withSeededApp(run: (app: ElectronApplication, userDataDir: string) => Promise<void>): Promise<void> {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-'));
    fs.writeFileSync(stateFile(userDataDir), seededState('0.0.1'), 'utf8');
    const childEnv = { ...process.env };
    delete childEnv.ELECTRON_RUN_AS_NODE;

    let app: ElectronApplication | null = null;
    let exited = false;
    try {
      app = await electron.launch({
        args: [`--user-data-dir=${userDataDir}`, '.'],
        cwd: repoRoot,
        env: childEnv,
        userDataDir,
      });
      app.on('close', () => {
        exited = true;
      });
      await run(app, userDataDir);
    } finally {
      // Safety net if the test failed before the process exited on its own.
      if (app && !exited) await app.close().catch(() => {});
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  }

  test("closing the MAIN window first, then the What's New window (last window closed), still records the version", async () => {
    await withSeededApp(async (app, userDataDir) => {
      await app.firstWindow();
      const whatsNew = await findWhatsNewWindow(app);
      await expect(whatsNew.locator('body')).toContainText(currentSectionSnippet(), { timeout: 10000 });
      expect(readState(userDataDir)).toBe(seededState('0.0.1'));

      const exited = app.waitForEvent('close');
      await closeWindows(app, false);
      await expect.poll(() => app.windows().length, { timeout: 10000 }).toBe(1);
      // Not the last window: nothing is recorded yet, the app stays up.
      expect(readState(userDataDir)).toBe(seededState('0.0.1'));
      await closeWindows(app, true).catch(() => {});
      await exited;

      expect(JSON.parse(readState(userDataDir) ?? 'null')).toEqual({ lastSeenVersion: currentVersion });
    });
  });

  test("quitting the app while the What's New window is open still records the version", async () => {
    await withSeededApp(async (app, userDataDir) => {
      await app.firstWindow();
      const whatsNew = await findWhatsNewWindow(app);
      await expect(whatsNew.locator('body')).toContainText(currentSectionSnippet(), { timeout: 10000 });
      expect(readState(userDataDir)).toBe(seededState('0.0.1'));

      const exited = app.waitForEvent('close');
      // The evaluate may reject as the process goes away; the exit event is
      // the real signal.
      await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => {});
      await exited;

      expect(JSON.parse(readState(userDataDir) ?? 'null')).toEqual({ lastSeenVersion: currentVersion });
    });
  });
});
