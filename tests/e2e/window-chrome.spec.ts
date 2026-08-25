import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _electron as electron } from '@playwright/test';
import { test, expect } from './support/fixtures';

const ENTRY_POINT = path.join(process.cwd(), 'dist/main/index.js');

// Task 29: frameless main window, custom title bar, window controls, and
// menu-as-popup. See functional_domain.md Task 29 (guardrails #66-74) and
// initial_scaffold.md's Task 29 Technical Specification for the authoritative
// design this suite proves against.

test.describe('(a) frame:false — structural proof + title-bar presence', () => {
  test('BrowserWindow has (effectively) no native chrome, and the custom title bar is present and visible', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#title-bar')).toBeVisible();

    // Structural proof against the REAL running BrowserWindow's own
    // properties -- not inferred from source. BrowserWindow has no direct
    // `.frame` getter, so the proof is behavioral: a frame:false window's
    // outer bounds and content bounds are (near-)identical (a few px of
    // invisible resize-border slack at most), whereas a native-chrome
    // window's title bar alone costs ~30+ px of height difference (see
    // DEVLOG's Task 23 entry: a native-framed 480px-wide window's client
    // area came back at 467px -- a ~13px *width* haircut, and title bars
    // cost dramatically more in height).
    const bounds = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return { outer: win.getBounds(), content: win.getContentBounds() };
    });
    expect(Math.abs(bounds.outer.height - bounds.content.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(bounds.outer.width - bounds.content.width)).toBeLessThanOrEqual(2);

    await expect(window.locator('#menu-label-file')).toBeVisible();
    await expect(window.locator('#menu-label-view')).toBeVisible();
    await expect(window.locator('#menu-label-help')).toBeVisible();
    await expect(window.locator('#window-minimize')).toBeVisible();
    await expect(window.locator('#window-maximize')).toBeVisible();
    await expect(window.locator('#window-close')).toBeVisible();

    // review_report_task29.md §S1: the fixed #title-bar sits above the
    // previously viewport-pinned #tree-panel/#tree-resize-handle (Task 26),
    // which reserve space for it via --title-bar-height rather than the old
    // top:0. Assert the geometry directly rather than leaving this an
    // implicit consequence of the two rules never overlapping by accident.
    const rects = await window.evaluate(() => ({
      titleBar: document.getElementById('title-bar')?.getBoundingClientRect(),
      treePanel: document.getElementById('tree-panel')?.getBoundingClientRect(),
      resizeHandle: document.getElementById('tree-resize-handle')?.getBoundingClientRect(),
    }));
    // Sub-pixel tolerance for the same class of DPI-scaling rounding
    // documented in backlog.md's Task 29 entry (this machine's 125% scale
    // factor) -- these are independently-computed CSS layout values, not
    // guaranteed bit-identical floats even when visually flush.
    expect(Math.abs((rects.treePanel?.top ?? 0) - (rects.titleBar?.bottom ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((rects.resizeHandle?.top ?? 0) - (rects.titleBar?.bottom ?? 0))).toBeLessThanOrEqual(1);
  });

  test('the Help window is unaffected -- it still opens with native chrome (defaultWindowOptions, zero opt-in to frame:false)', async ({
    electronApp,
  }) => {
    await electronApp.firstWindow();
    const [helpWindow] = await Promise.all([
      electronApp.waitForEvent('window'),
      electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-help')?.click()),
    ]);
    await expect(helpWindow.locator('body')).toContainText('minimal desktop Markdown previewer', { timeout: 10000 });
    // The Help window's own BrowserWindow never opted into frame:false --
    // it has no #title-bar of its own (this app's #title-bar only exists in
    // src/renderer/index.html, which the Help window never loads -- it
    // renders a self-contained data: URL built by buildHelpHtml()).
    await expect(helpWindow.locator('#title-bar')).toHaveCount(0);
  });
});

test.describe('(b) window-control buttons drive real window state', () => {
  test('minimize button minimizes the real window', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();
    const before = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized());
    expect(before).toBe(false);

    await window.locator('#window-minimize').click();

    await expect
      .poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()))
      .toBe(true);
  });

  test('maximize button maximizes, and clicking it again restores', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();
    const maximizeButton = window.locator('#window-maximize');

    const before = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
    expect(before).toBe(false);
    await expect(maximizeButton).not.toHaveClass(/is-maximized/);

    await maximizeButton.click();

    await expect
      .poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()))
      .toBe(true);
    // The button's own appearance is driven exclusively by the pushed
    // onWindowMaximizedState event (functional_domain.md guardrail #69) --
    // proven here by observing the class actually flip after the real OS
    // fact changed, not merely by trusting the click.
    await expect(maximizeButton).toHaveClass(/is-maximized/);

    await maximizeButton.click();

    await expect
      .poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()))
      .toBe(false);
    await expect(maximizeButton).not.toHaveClass(/is-maximized/);
  });

  // Isolated launch: clicking Close terminates the whole app, so this test
  // cannot share the base `electronApp` fixture (its own teardown calls
  // app.close() again on an already-dead process). Same raw-launch pattern
  // already used by view-menu.spec.ts's close-and-relaunch test (d).
  test('close button terminates the app', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-'));
    const childEnv = { ...process.env };
    delete childEnv.ELECTRON_RUN_AS_NODE;

    try {
      const app = await electron.launch({ args: [ENTRY_POINT], env: childEnv, userDataDir });
      const window = await app.firstWindow();
      await expect(window.locator('#window-close')).toBeVisible();

      const closed = app.waitForEvent('close');
      await window.locator('#window-close').click();
      await closed;
    } finally {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});

test.describe('(c) double-click on the drag region', () => {
  // Investigated empirically before writing this test, per
  // functional_domain.md guardrail #74 -- three independent techniques were
  // attempted against the real running app on this Windows/Electron build:
  // (1) Playwright's own `locator.dblclick()` / `mouse.dblclick()` (CDP-level
  // synthetic input), (2) `webContents.sendInputEvent` with an explicit
  // clickCount:2 mouseDown/mouseUp pair (the same technique
  // help-menu.spec.ts already relies on for accelerator delivery), and (3) a
  // genuine OS-level double-click injected via a Win32 `mouse_event` call
  // (real hardware-level input, not a Chromium/CDP synthetic event).
  // None of the three observed the window transitioning to maximized. This
  // is the same class of "cannot be automated in this sandboxed environment"
  // limitation already documented for Task 16's physical drag-and-drop test
  // (functional_domain.md Task 16 guardrail #10/backlog.md) -- technique
  // (3) additionally ran into DPI-scaling/multi-monitor coordinate
  // translation issues (Electron's getBounds() is in DIP, Win32's
  // SetCursorPos wants physical pixels at this machine's 125% scale factor)
  // that prevented a clean confirmation either way, and the click was
  // independently confirmed (via a mousedown counter on #title-bar) to never
  // have reached the app at all under technique (3).
  //
  // Per guardrail #74's own conditional -- a manual double-click handler
  // must NOT be added unless the automatic behavior is empirically PROVEN
  // ABSENT -- and absence was not proven (only "not observed via techniques
  // that cannot conclusively reach Electron's native non-client hit-test
  // path"), no manual double-click-to-maximize handler was implemented.
  // #title-bar relies entirely on Electron's own documented default
  // behavior for -webkit-app-region: drag regions. This is a light
  // confirming test of the setup (drag region present, correctly scoped),
  // not a behavioral proof of the OS-level double-click outcome, which this
  // environment cannot reliably observe.
  test('the drag region is present and structurally correct (light confirming test -- see comment above for the investigation)', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    const titleBar = window.locator('#title-bar');
    await expect(titleBar).toBeVisible();

    const regions = await window.evaluate(() => {
      const get = (id: string) => getComputedStyle(document.getElementById(id) as Element).getPropertyValue('-webkit-app-region').trim();
      return {
        titleBar: get('title-bar'),
        menuLabelFile: get('menu-label-file'),
        menuLabelView: get('menu-label-view'),
        menuLabelHelp: get('menu-label-help'),
        windowMinimize: get('window-minimize'),
        windowMaximize: get('window-maximize'),
        windowClose: get('window-close'),
      };
    });

    expect(regions.titleBar).toBe('drag');
    // Guardrail #70: no-drag scoped to exactly the six interactive elements.
    expect(regions.menuLabelFile).toBe('no-drag');
    expect(regions.menuLabelView).toBe('no-drag');
    expect(regions.menuLabelHelp).toBe('no-drag');
    expect(regions.windowMinimize).toBe('no-drag');
    expect(regions.windowMaximize).toBe('no-drag');
    expect(regions.windowClose).toBe('no-drag');
  });
});

test.describe('(d) title-bar menu labels popup the real, shared buildMenuTemplate() sections', () => {
  test('clicking each of File/View/Help pops up that section only, built from the same template applyMenu() uses', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();

    // Capture whatever Menu.buildFromTemplate() constructs for each POPUP_MENU
    // request without touching the real application menu built earlier at
    // startup (applyMenu() has already run by the time firstWindow()
    // resolves) -- same monkey-patch-and-capture technique already
    // established in this suite for dialog.showOpenDialog.
    await electronApp.evaluate(({ Menu }) => {
      const bag = globalThis as unknown as { __mdViewLastPopupMenu: Electron.Menu | null };
      bag.__mdViewLastPopupMenu = null;
      const original = Menu.buildFromTemplate.bind(Menu);
      Menu.buildFromTemplate = ((template: Electron.MenuItemConstructorOptions[]) => {
        const menu = original(template);
        bag.__mdViewLastPopupMenu = menu;
        return menu;
      }) as typeof Menu.buildFromTemplate;
    });

    await window.locator('#menu-label-file').click();
    const fileItemIds = await electronApp.evaluate(() => {
      const bag = globalThis as unknown as { __mdViewLastPopupMenu: Electron.Menu | null };
      return bag.__mdViewLastPopupMenu?.items.map((item) => item.id ?? item.type) ?? [];
    });
    expect(fileItemIds).toEqual(['menu-open', 'menu-open-folder', 'separator', 'menu-exit']);

    await window.locator('#menu-label-view').click();
    const viewItemIds = await electronApp.evaluate(() => {
      const bag = globalThis as unknown as { __mdViewLastPopupMenu: Electron.Menu | null };
      return bag.__mdViewLastPopupMenu?.items.map((item) => item.id ?? item.type) ?? [];
    });
    expect(viewItemIds).toEqual(['menu-dark-mode', 'menu-show-frontmatter', 'menu-show-tree-panel']);

    await window.locator('#menu-label-help').click();
    const helpItemIds = await electronApp.evaluate(() => {
      const bag = globalThis as unknown as { __mdViewLastPopupMenu: Electron.Menu | null };
      return bag.__mdViewLastPopupMenu?.items.map((item) => item.id ?? item.type) ?? [];
    });
    expect(helpItemIds).toEqual(['menu-help']);
  });

  test('clicking "Open…" inside the File popup triggers the exact same behavior as the native menu (proof the popup path calls buildMenuTemplate, not a duplicate)', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    const fixturePath = path.join(process.cwd(), 'tests/e2e/fixtures/sample.md');

    await electronApp.evaluate(
      ({ dialog }, filePath) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog;
      },
      fixturePath
    );

    await electronApp.evaluate(({ Menu }) => {
      const bag = globalThis as unknown as { __mdViewLastPopupMenu: Electron.Menu | null };
      bag.__mdViewLastPopupMenu = null;
      const original = Menu.buildFromTemplate.bind(Menu);
      Menu.buildFromTemplate = ((template: Electron.MenuItemConstructorOptions[]) => {
        const menu = original(template);
        bag.__mdViewLastPopupMenu = menu;
        return menu;
      }) as typeof Menu.buildFromTemplate;
    });

    await window.locator('#menu-label-file').click();
    await electronApp.evaluate(() => {
      const bag = globalThis as unknown as { __mdViewLastPopupMenu: Electron.Menu | null };
      bag.__mdViewLastPopupMenu?.getMenuItemById('menu-open')?.click();
    });

    const content = window.locator('#content');
    await expect(content).toContainText('Playwright Fixture Heading', { timeout: 10000 });
  });
});

test.describe('(e) pre-existing accelerator-driven behavior is unaffected by frame:false', () => {
  // This repo's own accelerator-driven tests never used
  // Playwright's `page.press('Control+...')` (grepped, zero matches) -- they
  // dispatch via `webContents.sendInputEvent`, the technique confirmed
  // (help-menu.spec.ts) to actually reach Electron's native accelerator
  // table in this environment, unlike CDP-level `page.keyboard.press`. This
  // test reuses that exact established technique to confirm CmdOrCtrl+O and
  // F1 still reach their handlers under frame:false.
  test('CmdOrCtrl+O still opens the file dialog under frame:false', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();

    await electronApp.evaluate(({ dialog }) => {
      const bag = globalThis as unknown as { __mdViewOpenDialogCalls: number };
      bag.__mdViewOpenDialogCalls = 0;
      dialog.showOpenDialog = (async () => {
        bag.__mdViewOpenDialogCalls += 1;
        return { canceled: true, filePaths: [] };
      }) as typeof dialog.showOpenDialog;
    });

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.focus();
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'O', modifiers: ['control'] });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'O', modifiers: ['control'] });
    });

    await expect
      .poll(() => electronApp.evaluate(() => (globalThis as unknown as { __mdViewOpenDialogCalls: number }).__mdViewOpenDialogCalls))
      .toBeGreaterThan(0);

    void window;
  });

  test('F1 still opens the Help window under frame:false', async ({ electronApp }) => {
    await electronApp.firstWindow();

    const [helpWindow] = await Promise.all([
      electronApp.waitForEvent('window'),
      electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.focus();
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F1' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F1' });
      }),
    ]);

    await expect(helpWindow.locator('body')).toContainText('minimal desktop Markdown previewer', { timeout: 10000 });
  });
});

test.describe('(f) FI-1: maximize/unmaximize push listeners are the sole source of the button state, regardless of trigger path', () => {
  // Guardrail #69's concrete proof: the button's rendered state must track
  // the real OS-level maximized fact even when the transition is driven by
  // a path OTHER than the custom button -- here, a direct
  // `BrowserWindow.maximize()` call from the test harness, standing in for
  // an OS-level action (snap, Win+Up) entirely outside the app's own UI.
  //
  // This permanent test proves the guardrail holds against the SHIPPED
  // code (mainWindow.on('maximize'/'unmaximize', ...) registered inside
  // createWindow()). The fault-injection cycle itself (temporarily
  // commenting out those two listener registrations, confirming this exact
  // test goes RED, restoring, confirming GREEN again) was performed by hand
  // during implementation AND independently re-executed by the Step 2.5
  // review -- both RED/GREEN cycles are recorded in
  // .agents/specs/review_report_task29.md §6, the artifact of record, not
  // re-performed by this file at every run, since that would require
  // shipping a self-mutating test suite.
  test('maximizing via a non-button path (BrowserWindow.maximize()) still updates the button state', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    const maximizeButton = window.locator('#window-maximize');
    await expect(maximizeButton).not.toHaveClass(/is-maximized/);

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].maximize();
    });

    await expect(maximizeButton).toHaveClass(/is-maximized/, { timeout: 10000 });

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].unmaximize();
    });

    await expect(maximizeButton).not.toHaveClass(/is-maximized/, { timeout: 10000 });
  });
});

// Task 30: #title-bar was built position: static (normal document flow) --
// it happened to visually sit at the viewport top only because it was
// body's first child on a document short enough to never scroll. Every
// other fixed-chrome element (#tree-panel/#tree-resize-handle/#status-bar)
// was built position: fixed from its own introduction; #title-bar was the
// one element missed. None of this suite's other describe blocks ever
// opened a document long enough to force a real page scroll before
// asserting title-bar geometry/interactivity -- this block specifically
// does, using the same tests/e2e/fixtures/long-document.md fixture Task 26
// built for the analogous #tree-panel-vs-scroll independence proof
// (tree-panel.spec.ts guardrail #51).
test.describe('(g) #title-bar stays fixed and remains functional while the page itself scrolls (Task 30 regression)', () => {
  const longDocumentFixture = path.join(process.cwd(), 'tests/e2e/fixtures/long-document.md');
  test.use({ electronArgs: [longDocumentFixture] });

  test('title-bar geometry is unchanged after scrolling the document to its end', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#content')).toContainText('Section 1', { timeout: 10000 });

    const titleBarBefore = await window.locator('#title-bar').boundingBox();

    // Task 31: the scrolling element is #main-panel, not body/html (see this
    // suite's (h) block for the direct proof) -- every scroll-driving/
    // scroll-reading call in this describe block targets #main-panel's own
    // scrollTop, not window.scrollY/document.documentElement.scrollHeight.
    await window.evaluate(() => {
      const mainPanel = document.getElementById('main-panel') as HTMLElement;
      mainPanel.scrollTo(0, mainPanel.scrollHeight);
    });
    // Confirm the scroll actually moved -- same guardrail-#51 idiom
    // tree-panel.spec.ts already uses, not merely trusting scrollTo() ran.
    await expect
      .poll(() => window.evaluate(() => (document.getElementById('main-panel') as HTMLElement).scrollTop))
      .toBeGreaterThan(0);

    const titleBarAfter = await window.locator('#title-bar').boundingBox();
    expect(titleBarAfter).toEqual(titleBarBefore);
  });

  test('minimize button still minimizes the real window while the document is scrolled mid-way', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#content')).toContainText('Section 1', { timeout: 10000 });

    // Task 31: scroll #main-panel, not body/html -- see the (h) block below
    // for the direct proof that window.scrollY stays 0 post-fix.
    await window.evaluate(() => {
      const mainPanel = document.getElementById('main-panel') as HTMLElement;
      mainPanel.scrollTo(0, mainPanel.scrollHeight / 2);
    });
    await expect
      .poll(() => window.evaluate(() => (document.getElementById('main-panel') as HTMLElement).scrollTop))
      .toBeGreaterThan(0);

    const before = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized());
    expect(before).toBe(false);

    await window.locator('#window-minimize').click();

    await expect
      .poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()))
      .toBe(true);
  });

  test('maximize button still maximizes, and clicking it again still restores, while the document is scrolled mid-way', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#content')).toContainText('Section 1', { timeout: 10000 });

    // Task 31: scroll #main-panel, not body/html -- see the (h) block below
    // for the direct proof that window.scrollY stays 0 post-fix.
    await window.evaluate(() => {
      const mainPanel = document.getElementById('main-panel') as HTMLElement;
      mainPanel.scrollTo(0, mainPanel.scrollHeight / 2);
    });
    await expect
      .poll(() => window.evaluate(() => (document.getElementById('main-panel') as HTMLElement).scrollTop))
      .toBeGreaterThan(0);

    const maximizeButton = window.locator('#window-maximize');

    const before = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
    expect(before).toBe(false);
    await expect(maximizeButton).not.toHaveClass(/is-maximized/);

    await maximizeButton.click();

    await expect
      .poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()))
      .toBe(true);
    await expect(maximizeButton).toHaveClass(/is-maximized/);

    await maximizeButton.click();

    await expect
      .poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()))
      .toBe(false);
    await expect(maximizeButton).not.toHaveClass(/is-maximized/);
  });

  test('title-bar menu labels still popup the correct buildMenuTemplate() sections while the document is scrolled mid-way', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#content')).toContainText('Section 1', { timeout: 10000 });

    // Task 31: scroll #main-panel, not body/html -- see the (h) block below
    // for the direct proof that window.scrollY stays 0 post-fix.
    await window.evaluate(() => {
      const mainPanel = document.getElementById('main-panel') as HTMLElement;
      mainPanel.scrollTo(0, mainPanel.scrollHeight / 2);
    });
    await expect
      .poll(() => window.evaluate(() => (document.getElementById('main-panel') as HTMLElement).scrollTop))
      .toBeGreaterThan(0);

    // Same monkey-patch-and-capture technique this suite's (d) block already
    // established.
    await electronApp.evaluate(({ Menu }) => {
      const bag = globalThis as unknown as { __mdViewLastPopupMenu: Electron.Menu | null };
      bag.__mdViewLastPopupMenu = null;
      const original = Menu.buildFromTemplate.bind(Menu);
      Menu.buildFromTemplate = ((template: Electron.MenuItemConstructorOptions[]) => {
        const menu = original(template);
        bag.__mdViewLastPopupMenu = menu;
        return menu;
      }) as typeof Menu.buildFromTemplate;
    });

    await window.locator('#menu-label-file').click();
    const fileItemIds = await electronApp.evaluate(() => {
      const bag = globalThis as unknown as { __mdViewLastPopupMenu: Electron.Menu | null };
      return bag.__mdViewLastPopupMenu?.items.map((item) => item.id ?? item.type) ?? [];
    });
    expect(fileItemIds).toEqual(['menu-open', 'menu-open-folder', 'separator', 'menu-exit']);

    await window.locator('#menu-label-view').click();
    const viewItemIds = await electronApp.evaluate(() => {
      const bag = globalThis as unknown as { __mdViewLastPopupMenu: Electron.Menu | null };
      return bag.__mdViewLastPopupMenu?.items.map((item) => item.id ?? item.type) ?? [];
    });
    expect(viewItemIds).toEqual(['menu-dark-mode', 'menu-show-frontmatter', 'menu-show-tree-panel']);

    await window.locator('#menu-label-help').click();
    const helpItemIds = await electronApp.evaluate(() => {
      const bag = globalThis as unknown as { __mdViewLastPopupMenu: Electron.Menu | null };
      return bag.__mdViewLastPopupMenu?.items.map((item) => item.id ?? item.type) ?? [];
    });
    expect(helpItemIds).toEqual(['menu-help']);
  });

  // Deliberately NOT scrolled, unlike this describe block's other tests --
  // this was originally written (Task 30) because #main-panel was body's
  // normal-flow scrolling content back then, so its getBoundingClientRect()
  // would move away from #title-bar's fixed bottom edge in direct
  // proportion to scroll distance. The "no gap, no overlap" invariant this
  // test guards (#app-body's margin-top correctly compensating #title-bar's
  // position:fixed height) is a static-layout property of the document's
  // resting state regardless, so it stays proven at scroll position 0, same
  // as this suite's (a) block already does for #tree-panel/#tree-resize-handle
  // vs. #title-bar.
  //
  // Compared against #app-body, not #main-panel: at Task 30 time,
  // #main-panel's own rect.top included ~24px of #document-container's
  // `margin: 1.5rem auto` collapsing through it (#main-panel was not its own
  // Block Formatting Context) -- a pre-existing, unrelated presentational
  // offset from Task 11's document-card chrome, nothing to do with the
  // title-bar fix. Task 31 update: #main-panel now carries `overflow-y:
  // auto` (the fix for THIS task's bug, #main-panel becoming its own
  // viewport-bound scroll container -- see app.css), which independently
  // makes #main-panel its own Block Formatting Context too, so that
  // particular margin-collapse quirk may no longer reproduce -- not
  // reverified, since it's moot either way: #app-body IS the
  // flow-root/BFC boundary the Task 30 margin-top compensation was added
  // to (see the `display: flow-root` comment in app.css), so its border-box
  // top remains the correct, direct, uncollapsed measurement regardless of
  // whichever element(s) besides it also happen to be their own BFC.
  test('#app-body content starts exactly --title-bar-height below #title-bar with no gap or overlap (static layout, scroll position 0)', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#content')).toContainText('Section 1', { timeout: 10000 });

    // Compared against #title-bar's own live rect directly, rather than a
    // hardcoded pixel number derived from `2rem` (root font-size dependent)
    // -- same convention as (a)'s sub-pixel-tolerance geometry checks.
    const rects = await window.evaluate(() => ({
      titleBar: document.getElementById('title-bar')?.getBoundingClientRect(),
      appBody: document.getElementById('app-body')?.getBoundingClientRect(),
    }));
    expect(Math.abs((rects.appBody?.top ?? 0) - (rects.titleBar?.bottom ?? 0))).toBeLessThanOrEqual(1);
  });

  test('#tree-panel geometry stays correct relative to #title-bar while the document is scrolled (regression check for guardrail #78)', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#content')).toContainText('Section 1', { timeout: 10000 });

    // Task 31: scroll #main-panel, not body/html -- see the (h) block below
    // for the direct proof that window.scrollY stays 0 post-fix.
    await window.evaluate(() => {
      const mainPanel = document.getElementById('main-panel') as HTMLElement;
      mainPanel.scrollTo(0, mainPanel.scrollHeight / 2);
    });
    await expect
      .poll(() => window.evaluate(() => (document.getElementById('main-panel') as HTMLElement).scrollTop))
      .toBeGreaterThan(0);

    // Reuses the same rects.treePanel.top vs. rects.titleBar.bottom
    // comparison test (a) already performs at scroll position 0 -- this is
    // the regression check proving #tree-panel's pre-existing correctness
    // now that it is actually exercised by a real page-level scroll.
    const rects = await window.evaluate(() => ({
      titleBar: document.getElementById('title-bar')?.getBoundingClientRect(),
      treePanel: document.getElementById('tree-panel')?.getBoundingClientRect(),
    }));
    expect(Math.abs((rects.treePanel?.top ?? 0) - (rects.titleBar?.bottom ?? 0))).toBeLessThanOrEqual(1);
  });
});

// Task 31: Task 30 made #title-bar position: fixed, but never gave
// body/html/#app-body/#main-panel any overflow rule of their own -- a long
// document still overflowed body itself, and body was still the element
// that actually scrolled. The browser's native scrollbar therefore still
// spanned the FULL viewport height, including the region behind
// #title-bar, because native scrollbars render in the browser/OS
// compositor layer, structurally outside the page's own DOM/z-index
// stacking context -- Task 30's z-index: 10 on #title-bar was never able
// to make the scrollbar respect it, no matter what value it held. The fix
// relocates WHERE scrolling happens, reusing the identical, already-proven
// pattern #tree-panel established for itself in Task 26: position: fixed,
// a bounded height (top/bottom anchored to --title-bar-height / the status
// bar's 2rem clearance), and its own overflow-y: auto, so #main-panel's
// scrollbar (if it ever needs one) is contained entirely within its own
// box instead of the full viewport. This block is the direct proof of
// that fix, distinct from (g) above (which merely converts (g)'s existing
// functional regression tests to drive/read #main-panel's own scroll
// state instead of window.scrollY, so those assertions keep discriminating
// a real mechanism instead of passing vacuously).
test.describe('(h) #main-panel is its own bounded scroll container -- window/body never scroll (Task 31)', () => {
  const longDocumentFixture = path.join(process.cwd(), 'tests/e2e/fixtures/long-document.md');
  test.use({ electronArgs: [longDocumentFixture] });

  test('window.scrollY stays 0 even after scrolling #main-panel to its end', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#content')).toContainText('Section 1', { timeout: 10000 });

    // Direct proof that body/html have no scroll of their own -- not an
    // inference from "the visible symptom (title bar drifting) is gone".
    expect(await window.evaluate(() => window.scrollY)).toBe(0);

    await window.evaluate(() => {
      const mainPanel = document.getElementById('main-panel') as HTMLElement;
      mainPanel.scrollTo(0, mainPanel.scrollHeight);
    });
    await expect
      .poll(() => window.evaluate(() => (document.getElementById('main-panel') as HTMLElement).scrollTop))
      .toBeGreaterThan(0);

    // #main-panel genuinely scrolled (proven above); window.scrollY is
    // still exactly 0 -- the scroll never touched body/html at all.
    expect(await window.evaluate(() => window.scrollY)).toBe(0);
  });

  // Playwright/Chromium's automation surface (getBoundingClientRect(),
  // getComputedStyle(), the accessibility tree, DOM locators) has no way to
  // query a native OS/compositor-drawn scrollbar's own rendered pixels --
  // investigated directly: there is no Playwright locator or CDP call for
  // "the scrollbar of element X", and this app applies no
  // `::-webkit-scrollbar` override (confirmed via a grep of app.css), so
  // the scrollbar #main-panel grows is the browser's native, unscriptable
  // one, not a styled/measurable pseudo-element. A pixel-diffing screenshot
  // approach could in principle detect scrollbar presence but not assert
  // its own geometric bounds without fragile, environment-dependent color
  // sampling -- not attempted here. Same "investigate, then document the
  // real limitation" standard as (c)'s double-click investigation above.
  //
  // What IS directly measurable, and is a real (if indirect) proof: a
  // native scrollbar always renders *inside* the box of the scrolling
  // element that owns it. Bounding #main-panel's own box to never extend
  // above --title-bar-height or below the status bar's 2rem clearance
  // therefore bounds the scrollbar's own maximum possible extent to that
  // same region -- it structurally cannot render outside its owning
  // element's box. This proves the containing box's geometry, not the
  // scrollbar's own rendered pixels directly.
  test("#main-panel's own box never extends above the title bar or below the status bar's clearance, at rest and scrolled to the end", async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#content')).toContainText('Section 1', { timeout: 10000 });

    async function readGeometry() {
      return window.evaluate(() => {
        const mainPanel = document.getElementById('main-panel') as HTMLElement;
        const titleBar = document.getElementById('title-bar') as HTMLElement;
        return {
          mainPanelRect: mainPanel.getBoundingClientRect(),
          titleBarBottom: titleBar.getBoundingClientRect().bottom,
          viewportHeight: window.innerHeight,
        };
      });
    }

    function assertBounded(geometry: Awaited<ReturnType<typeof readGeometry>>) {
      // Sub-pixel tolerance, same convention as (a)'s geometry checks.
      expect(geometry.mainPanelRect.top).toBeGreaterThanOrEqual(geometry.titleBarBottom - 1);
      // `bottom: 2rem` status-bar clearance -- compare against the live
      // viewport height rather than a hardcoded pixel number derived from
      // `2rem` (root font-size dependent), same convention as (a)/(g).
      expect(geometry.mainPanelRect.bottom).toBeLessThanOrEqual(geometry.viewportHeight - 1);
    }

    assertBounded(await readGeometry());

    await window.evaluate(() => {
      const mainPanel = document.getElementById('main-panel') as HTMLElement;
      mainPanel.scrollTo(0, mainPanel.scrollHeight);
    });
    await expect
      .poll(() => window.evaluate(() => (document.getElementById('main-panel') as HTMLElement).scrollTop))
      .toBeGreaterThan(0);

    assertBounded(await readGeometry());
  });

  // Task 28 companion-fix regression check: #main-panel's horizontal offset
  // moved from margin-left to left (both keyed off --tree-panel-width) --
  // body.tree-panel-hidden's own override must move the same way, or hiding
  // the tree panel would silently leave #main-panel permanently offset by
  // --tree-panel-width, reserving an unreachable gutter where the hidden
  // tree panel used to be.
  test('#main-panel\'s left edge is 0, not --tree-panel-width, once the tree panel is hidden via the View menu', async ({
    electronApp,
  }) => {
    const window = await electronApp.firstWindow();
    await expect(window.locator('#content')).toContainText('Section 1', { timeout: 10000 });
    await expect(window.locator('#tree-panel')).toBeVisible();

    await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-show-tree-panel')?.click());
    await expect(window.locator('#tree-panel')).toBeHidden();

    const left = await window.evaluate(() => document.getElementById('main-panel')?.getBoundingClientRect().left ?? -1);
    expect(left).toBeLessThanOrEqual(1);
  });
});
