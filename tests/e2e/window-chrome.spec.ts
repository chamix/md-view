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
