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
