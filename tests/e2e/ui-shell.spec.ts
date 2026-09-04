import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect } from './support/fixtures';
import { pollUntilStable } from './support/pollUntilStable';

test('no-argv launch: no legacy h1/button, empty-state visible, status bar shows "No file open"', async ({ electronApp }) => {
  const window = await electronApp.firstWindow();

  await expect(window.locator('h1')).toHaveCount(0);
  await expect(window.locator('#open-file-btn')).toHaveCount(0);
  await expect(window.locator('#empty-state')).toBeVisible();

  const statusBar = window.locator('#status-bar');
  await expect(statusBar).toHaveText('No file open');

  // Task 34 guardrail #100: the copy-raw-source button is disabled whenever
  // there's no successfully-rendered file -- this is the initial, pre-first-
  // file empty state itself.
  await expect(window.locator('#copy-raw-source')).toBeDisabled();
});

test('DevTools shortcut guard: unreachable when packaged, reachable in dev builds', async ({ electronApp }) => {
  // Native keyboard events (F12) do not reliably reach Electron's
  // before-input-event hook when synthesized via CDP in this environment
  // (verified empirically), so driving real DevTools toggling through
  // Playwright is not a reliable signal here. Instead, exercise the exact
  // exported guard predicate that the real listener calls, via
  // app.evaluate() reading the globalThis test bridge set by
  // src/main/index.ts — this asserts the shipped function's behavior
  // directly, not a reimplementation of it.
  const isPackaged = await electronApp.evaluate(({ app }) => app.isPackaged);
  expect(isPackaged).toBe(false);

  const guardResults = await electronApp.evaluate(() => {
    // Reads the real, running predicate exposed by src/main/index.ts on
    // globalThis for exactly this purpose — not a reimplementation.
    const guard = (globalThis as Record<string, unknown>).__mdViewDevToolsGuardForTests as (
      isPackaged: boolean,
    ) => boolean;
    return {
      skipWhenPackaged: guard(true),
      skipWhenDev: guard(false),
    };
  });

  // Packaged (shipped) builds must skip — the shortcut is unreachable.
  expect(guardResults.skipWhenPackaged).toBe(true);
  // Dev (unpacked) builds — this test's own run mode — must NOT skip.
  expect(guardResults.skipWhenDev).toBe(false);
});

test.describe('argv launch with sample.md', () => {
  const fixturePath = path.join(process.cwd(), 'tests/e2e/fixtures/sample.md');
  test.use({ electronArgs: [fixturePath] });

  test('argv launch: empty-state disappears, status bar shows the real absolute path', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();
    const content = window.locator('#content');
    await expect(content).toContainText('Playwright Fixture Heading', { timeout: 10000 });

    await expect(window.locator('#empty-state')).toBeHidden();

    const statusBar = window.locator('#status-bar');
    await expect(statusBar).toHaveText(fixturePath, { timeout: 10000 });

    // (c) Task 11: document card chrome — bordered container + header bar
    // with two inert tab-style buttons, mimicking GitHub's file-view chrome.
    await expect(window.locator('#document-container')).toBeVisible();
    await expect(window.locator('#document-header')).toBeVisible();

    const tabPreview = window.locator('#tab-preview');
    const tabCode = window.locator('#tab-code');
    await expect(tabPreview).toBeVisible();
    await expect(tabCode).toBeVisible();
    await expect(tabPreview).toHaveText('Preview');
    await expect(tabCode).toHaveText('Code');

    await expect(tabPreview).toHaveClass(/active/);
    await expect(tabCode).not.toHaveClass(/active/);

    // (d) #content's computed lateral padding is non-zero after render.
    const paddingLeft = await content.evaluate((el) => window.getComputedStyle(el).paddingLeft);
    const paddingRight = await content.evaluate((el) => window.getComputedStyle(el).paddingRight);
    expect(parseFloat(paddingLeft)).toBeGreaterThan(0);
    expect(parseFloat(paddingRight)).toBeGreaterThan(0);

    // (e) status bar content was set via textContent, never innerHTML — proof
    // no HTML was parsed there.
    const isTextContentOnly = await statusBar.evaluate((el) => el.innerHTML === el.textContent);
    expect(isTextContentOnly).toBe(true);

    // (f) Task 12: window min-size clamp. Attempt to shrink the live
    // BrowserWindow below the configured minimum and confirm the OS/Electron
    // clamps the resulting bounds rather than honoring the smaller request —
    // a config-value-only assertion would not actually prove the clamp takes
    // effect at runtime.
    const clampedBounds = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setBounds({ width: 100, height: 100 });
      const bounds = win.getBounds();
      return { width: bounds.width, height: bounds.height };
    });
    expect(clampedBounds.width).toBeGreaterThanOrEqual(480);
    expect(clampedBounds.height).toBeGreaterThanOrEqual(320);

    const documentContainer = window.locator('#document-container');

    // (g) Task 12: default-width discrimination check. At the app's own
    // default window width (900x640, from windowConfig.ts's
    // defaultWindowOptions), the shipped CSS form (explicit
    // `width: calc(100% - 4rem)`) and the forbidden alternate form (bare
    // `max-width: 54rem; margin: auto` with no explicit width) produce
    // identical computed margins at 1600px wide but diverge sharply here:
    // the correct form keeps the mandated 2rem (32px) side gutters, while
    // the forbidden form degrades to ~18px. Explicitly re-assert the window
    // bounds first, since the clamp check above (f) already moved the live
    // window to its clamped 480x320 size.
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setBounds({ width: 900, height: 640 });
    });
    const defaultWidthBox = await pollUntilStable(() =>
      documentContainer.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          marginLeft: parseFloat(style.marginLeft),
          marginRight: parseFloat(style.marginRight),
        };
      }),
    );
    // toBeCloseTo(32, 0)'s < 0.5 tolerance is tighter than real sub-pixel
    // rendering allows here (observed ~0.8px drift) — use an explicit 1px
    // band instead, per this task's documented fallback.
    expect(defaultWidthBox.marginLeft).toBeGreaterThanOrEqual(31);
    expect(defaultWidthBox.marginLeft).toBeLessThanOrEqual(33);
    expect(defaultWidthBox.marginRight).toBeGreaterThanOrEqual(31);
    expect(defaultWidthBox.marginRight).toBeLessThanOrEqual(33);

    // (h) Task 12: centered max-width reading column. Resize wide and confirm
    // #document-container caps its width well below the viewport and stays
    // centered (equal left/right margins, both above the 2rem baseline gutter).
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setBounds({ width: 1600, height: 900 });
    });
    const containerBox = await pollUntilStable(() =>
      documentContainer.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          width: parseFloat(style.width),
          marginLeft: parseFloat(style.marginLeft),
          marginRight: parseFloat(style.marginRight),
        };
      }),
    );
    expect(containerBox.width).toBeLessThan(900);
    expect(containerBox.width).toBeGreaterThan(800);
    expect(containerBox.marginLeft).toBeCloseTo(containerBox.marginRight, 0);
    expect(containerBox.marginLeft).toBeGreaterThan(32);
    expect(containerBox.marginRight).toBeGreaterThan(32);

    // (i) Task 12: breathing-room spacing around the card, tightened to the
    // mandated 1.5rem (24px at the default 16px root font-size) rather than
    // just a non-zero check.
    const documentMain = window.locator('#document-main');
    const mainPaddingTop = await documentMain.evaluate((el) => window.getComputedStyle(el).paddingTop);
    const containerMarginBottom = await documentContainer.evaluate(
      (el) => window.getComputedStyle(el).marginBottom,
    );
    expect(parseFloat(mainPaddingTop)).toBeCloseTo(24, 0);
    expect(parseFloat(containerMarginBottom)).toBeCloseTo(24, 0);
  });
});

test.describe('Task 32: Code tab — raw markdown source with syntax highlighting', () => {
  const fixturePath = path.join(process.cwd(), 'tests/e2e/fixtures/sample.md');
  test.use({ electronArgs: [fixturePath] });

  test('clicking #tab-code shows highlighted raw source and hides #content; clicking back to #tab-preview restores it', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    const content = window.locator('#content');
    await expect(content).toContainText('Playwright Fixture Heading', { timeout: 10000 });

    const tabPreview = window.locator('#tab-preview');
    const tabCode = window.locator('#tab-code');
    const codeContent = window.locator('#code-content');

    await expect(content).toBeVisible();
    await expect(codeContent).toBeHidden();

    await tabCode.click();

    await expect(codeContent).toBeVisible();
    await expect(content).toBeHidden();
    await expect(codeContent.locator('.hljs')).toHaveCount(1);
    await expect(tabCode).toHaveClass(/active/);
    await expect(tabPreview).not.toHaveClass(/active/);

    await tabPreview.click();

    await expect(content).toBeVisible();
    await expect(codeContent).toBeHidden();
    await expect(tabPreview).toHaveClass(/active/);
    await expect(tabCode).not.toHaveClass(/active/);
  });

  test('selecting "Code" from the View menu updates the visible tab to Code', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();
    const content = window.locator('#content');
    await expect(content).toContainText('Playwright Fixture Heading', { timeout: 10000 });

    const codeContent = window.locator('#code-content');
    await expect(codeContent).toBeHidden();

    await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-view-code')?.click());

    await expect(codeContent).toBeVisible();
    await expect(content).toBeHidden();
    await expect(window.locator('#tab-code')).toHaveClass(/active/);
  });

  test('clicking #tab-code directly, then opening the View menu, shows "Code" checked (menu/click round-trip)', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    const content = window.locator('#content');
    await expect(content).toContainText('Playwright Fixture Heading', { timeout: 10000 });

    await window.locator('#tab-code').click();
    await expect(window.locator('#code-content')).toBeVisible();

    const checkedState = await electronApp.evaluate(({ Menu }) => ({
      code: Menu.getApplicationMenu()?.getMenuItemById('menu-view-code')?.checked,
      preview: Menu.getApplicationMenu()?.getMenuItemById('menu-view-preview')?.checked,
    }));

    expect(checkedState.code).toBe(true);
    expect(checkedState.preview).toBe(false);
  });
});

test.describe('Task 32: Code tab shows the full raw file, frontmatter included', () => {
  const fixturePath = path.join(process.cwd(), 'tests/e2e/fixtures/with-frontmatter/doc.md');
  test.use({ electronArgs: [fixturePath] });

  test('the frontmatter block appears literally inside #code-content when the Code tab is shown', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    const content = window.locator('#content');
    await expect(content).toContainText('Frontmatter Fixture Heading', { timeout: 10000 });

    await window.locator('#tab-code').click();

    const codeContent = window.locator('#code-content');
    await expect(codeContent).toBeVisible();
    // The exact fixture's frontmatter block, verbatim -- proves "full file,
    // not the frontmatter-stripped body" (Task 32 decision #1), distinct
    // from the separate #frontmatter element's own Preview-tab display.
    await expect(codeContent).toContainText('title: Frontmatter Fixture');
    await expect(codeContent).toContainText('tags: e2e, task8');
    await expect(codeContent).toContainText('Frontmatter Fixture Heading');
  });
});

test.describe('Task 33: Code tab wraps long lines instead of forcing horizontal scroll', () => {
  const fixturePath = path.join(process.cwd(), 'tests/e2e/fixtures/long-line.md');
  test.use({ electronArgs: [fixturePath] });

  test('a long prose line in #code-content wraps: no nested <pre>, no horizontal overflow', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    const content = window.locator('#content');
    await expect(content).toContainText('Long Line Fixture', { timeout: 10000 });

    await window.locator('#tab-code').click();

    const codeContent = window.locator('#code-content');
    await expect(codeContent).toBeVisible();

    expect(await codeContent.locator('pre').count()).toBe(0);

    const overflow = await codeContent.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
  });
});

test.describe('Task 34: Copy Raw Markdown Source button', () => {
  // Deliberately crafted (not reused from an existing fixture) to exercise
  // every byte-preservation edge case the domain spec calls out: a trailing
  // newline at EOF, a blank line, and a line with both leading and trailing
  // spaces (which markdown/hljs tooling elsewhere in this app is prone to
  // trim/normalize -- this fixture exists specifically to catch that).
  // Written into a real temp file at describe-collection time (synchronously,
  // same as every other describe block's own module-scope `fixturePath`
  // above) rather than checked in as a new fixture asset, so this test stays
  // fully self-contained inside this one in-scope spec file and can still use
  // test.use({ electronArgs }) exactly like every other describe block here.
  const RAW_FIXTURE_CONTENT = '# Copy Fixture Heading\n\n   leading and trailing spaces on this line   \n\nFinal line.\n';
  const rawFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-copy-raw-source-'));
  const fixturePath = path.join(rawFixtureDir, 'copy-raw-fixture.md');
  fs.writeFileSync(fixturePath, RAW_FIXTURE_CONTENT);

  test.use({ electronArgs: [fixturePath] });

  test.afterAll(() => {
    fs.rmSync(rawFixtureDir, { recursive: true, force: true });
  });

  test('clicking the button copies the byte-identical on-disk file content to the real OS clipboard', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#content')).toContainText('Copy Fixture Heading', { timeout: 10000 });

    const copyButton = window.locator('#copy-raw-source');
    await expect(copyButton).toBeEnabled();
    await copyButton.click();

    // Reach into the real running Electron main process, same
    // electronApp.evaluate() pattern this file already uses above -- proves
    // the write actually landed in the real OS clipboard via the
    // main-process ipcMain.handle(COPY_RAW_SOURCE) round trip, not just some
    // renderer-side in-memory string.
    const clipboardText = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
    const onDiskContent = fs.readFileSync(fixturePath, 'utf8');

    // The load-bearing assertion (guardrail #98): compared directly against
    // fs.readFile's own output, never against #code-content's DOM
    // textContent or any other in-memory JS/DOM string.
    expect(clipboardText).toBe(onDiskContent);
  });

  test('clicking the button while #tab-preview is active still copies the raw source, not rendered HTML', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#content')).toContainText('Copy Fixture Heading', { timeout: 10000 });

    // Guardrail #99: Preview tab is the active/visible tab here -- never
    // switched to #tab-code -- proving the copy is independent of which tab
    // is currently visible.
    await expect(window.locator('#tab-preview')).toHaveClass(/active/);
    await expect(window.locator('#code-content')).toBeHidden();

    const copyButton = window.locator('#copy-raw-source');
    await expect(copyButton).toBeEnabled();
    await copyButton.click();

    const clipboardText = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
    const onDiskContent = fs.readFileSync(fixturePath, 'utf8');

    expect(clipboardText).toBe(onDiskContent);
    // Never the rendered HTML -- proves the copy path did not read from
    // #content's innerHTML while Preview was the visible tab.
    expect(clipboardText).not.toContain('<h1');
  });
});
