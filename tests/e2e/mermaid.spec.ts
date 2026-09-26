import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test as base, expect } from './support/fixtures';
import { expectPristineDocumentView } from './support/pristine';

// Task 45: Mermaid diagrams (functional_domain.md #156-#168). Files are opened
// through the stubbed-dialog File > Open path (close-document.spec.ts), so
// listeners/observers can be installed after launch and before the first
// FILE_RENDERED of the document under test.

const FIXTURES = path.join(process.cwd(), 'tests/e2e/fixtures/with-mermaid');
const TEST_FIXTURE = path.join(process.cwd(), 'tests/test-content/test-fixture.md');
const WITH_CODE = path.join(process.cwd(), 'tests/e2e/fixtures/with-code/doc.md');

// Mermaid 11.17.2 flowchart node fills (mainBkg), as computed rgb().
const DARK_NODE_FILL = 'rgb(31, 32, 32)'; // dark theme #1f2020
const DEFAULT_NODE_FILL = 'rgb(236, 236, 255)'; // default theme #ECECFF
const FOREST_NODE_FILL = 'rgb(205, 228, 152)'; // forest theme #cde498

const test = base.extend<{ tmp: string }>({
  tmp: async ({}, use) => {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-mermaid-')));
    await use(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  },
});

// firstWindow() can resolve before renderer.js registered its IPC listeners.
async function launchedWindow(app: ElectronApplication): Promise<Page> {
  const window = await app.firstWindow();
  await window.waitForLoadState('load');
  return window;
}

async function clickMenuItem(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click(), id);
}

async function openViaMenu(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, targetPath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [targetPath] })) as typeof dialog.showOpenDialog;
  }, filePath);
  await clickMenuItem(app, 'menu-open');
}

async function setDarkMode(app: ElectronApplication, window: Page, dark: boolean): Promise<void> {
  const isDark = await window.evaluate(() => document.body.classList.contains('dark-mode'));
  if (isDark !== dark) await clickMenuItem(app, 'menu-dark-mode');
  await expect(window.locator('body')).toHaveClass(dark ? /dark-mode/ : /^(?!.*dark-mode).*$/);
}

// Installs, in main, a one-shot hook that performs `action` right after the
// NEXT file-rendered send, i.e. before the renderer can possibly have loaded
// the Mermaid bundle for that document.
async function afterNextFileRendered(
  app: ElectronApplication,
  action: { kind: 'close' } | { kind: 'dark' } | { kind: 'open'; path: string }
): Promise<void> {
  await app.evaluate(({ BrowserWindow, Menu, dialog }, act) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    const originalSend = wc.send;
    wc.send = function (this: typeof wc, channel: string, ...args: unknown[]) {
      originalSend.call(wc, channel, ...args);
      if (channel !== 'md-view:file-rendered') return;
      wc.send = originalSend;
      setImmediate(() => {
        const menu = Menu.getApplicationMenu();
        if (act.kind === 'close') menu?.getMenuItemById('menu-close')?.click();
        if (act.kind === 'dark') menu?.getMenuItemById('menu-dark-mode')?.click();
        if (act.kind === 'open') {
          dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [act.path] })) as typeof dialog.showOpenDialog;
          menu?.getMenuItemById('menu-open')?.click();
        }
      });
    } as typeof wc.send;
  }, action);
}

// Counts main -> renderer file-rendered sends (close-document.spec.ts technique).
async function installFileRenderedCounter(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const bag = globalThis as unknown as { __mdvFileRendered: number };
    bag.__mdvFileRendered = 0;
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    const originalSend = wc.send.bind(wc);
    wc.send = ((channel: string, ...args: unknown[]) => {
      if (channel === 'md-view:file-rendered') bag.__mdvFileRendered += 1;
      originalSend(channel, ...args);
    }) as typeof wc.send;
  });
}

function fileRenderedCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => (globalThis as unknown as { __mdvFileRendered: number }).__mdvFileRendered);
}

function trackPageErrors(window: Page): string[] {
  const errors: string[] = [];
  window.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

// In-page recorder (installed via evaluate, which the CSP does not govern):
// attaches an observer to EVERY diagram wrapper as soon as it enters #content,
// and keeps observing it after it is detached (Close / a newer document), so a
// stale write into a detached wrapper is still recorded. Also records when the
// document was closed (status bar back to "No file open").
async function installDiagramRecorder(window: Page): Promise<void> {
  await window.evaluate(() => {
    interface Rec {
      t: number;
      kind: 'svg' | 'error';
      text: string;
      style: string;
    }
    const w = window as unknown as { __diagramWrites: Rec[]; __closedAt: number | null; __wrappers: Element[] };
    w.__diagramWrites = [];
    w.__closedAt = null;
    w.__wrappers = [];
    const content = document.getElementById('content')!;
    const statusBar = document.getElementById('status-bar')!;
    const seen = new WeakSet<Element>();
    const watchWrapper = (wrapper: Element) => {
      if (seen.has(wrapper)) return;
      seen.add(wrapper);
      w.__wrappers.push(wrapper);
      new MutationObserver(() => {
        const svg = wrapper.querySelector(':scope > svg');
        const error = wrapper.querySelector(':scope > .md-view-diagram-error');
        if (!svg && !error) return;
        w.__diagramWrites.push({
          t: performance.now(),
          kind: svg ? 'svg' : 'error',
          text: wrapper.textContent || '',
          style: svg ? (svg.querySelector('style')?.textContent ?? '') : '',
        });
      }).observe(wrapper, { childList: true });
    };
    new MutationObserver(() => {
      content.querySelectorAll('.md-view-diagram').forEach(watchWrapper);
    }).observe(content, { childList: true, subtree: true });
    new MutationObserver(() => {
      if (statusBar.textContent === 'No file open' && w.__closedAt === null) w.__closedAt = performance.now();
    }).observe(statusBar, { childList: true, characterData: true, subtree: true });
  });
}

interface RecorderState {
  writes: { t: number; kind: string; text: string; style: string }[];
  closedAt: number | null;
  wrappers: number;
}

function readRecorder(window: Page): Promise<RecorderState> {
  return window.evaluate(() => {
    const w = window as unknown as {
      __diagramWrites: RecorderState['writes'];
      __closedAt: number | null;
      __wrappers: Element[];
    };
    return { writes: w.__diagramWrites, closedAt: w.__closedAt, wrappers: w.__wrappers.length };
  });
}

// Resolves once the on-demand bundle load has settled (the loader <script> is
// in <head> and window.mermaid exists).
async function waitForBundle(window: Page): Promise<void> {
  await window.waitForFunction(() => typeof (window as unknown as { mermaid?: unknown }).mermaid !== 'undefined', null, {
    timeout: 15000,
  });
}

const svgs = (window: Page) => window.locator('#content .md-view-diagram > svg');
const errors = (window: Page) => window.locator('#content .md-view-diagram > .md-view-diagram-error');

async function nodeFill(window: Page, diagramIndex: number): Promise<string> {
  return window.evaluate((i) => {
    const wrapper = document.querySelectorAll('#content .md-view-diagram')[i];
    const shape = wrapper?.querySelector('svg .node rect, svg .node polygon');
    return shape ? getComputedStyle(shape).fill : 'missing';
  }, diagramIndex);
}

// The SVG's <style> text with its own id normalized, so two diagrams of the
// same type and theme compare equal.
async function normalizedStyle(window: Page, diagramIndex: number): Promise<string> {
  return window.evaluate((i) => {
    const svg = document.querySelectorAll('#content .md-view-diagram')[i]?.querySelector(':scope > svg');
    if (!svg) return 'missing';
    return (svg.querySelector('style')?.textContent ?? '').split('#' + svg.id).join('#ID');
  }, diagramIndex);
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.describe('basic rendering', () => {
  test("test-fixture.md's diagram becomes an svg inside .md-view-diagram", async ({ electronApp }) => {
    const window = await launchedWindow(electronApp);
    const pageErrors = trackPageErrors(window);
    await openViaMenu(electronApp, TEST_FIXTURE);

    await expect(svgs(window)).toHaveCount(1, { timeout: 15000 });
    await expect(window.locator('#content .md-view-diagram > .md-view-diagram-source')).toHaveCount(0);
    await expect(svgs(window).first()).toContainText('Abrir .md');
    expect(pageErrors).toEqual([]);
  });

  test('#165: two diagrams in one document give two svgs with distinct ids; ordinary code still highlighted', async ({
    electronApp,
  }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, path.join(FIXTURES, 'multi.md'));

    await expect(svgs(window)).toHaveCount(2, { timeout: 15000 });
    const ids = await svgs(window).evaluateAll((els) => els.map((el) => el.id));
    expect(ids[0]).toMatch(/^mdv-diagram-\d+-0$/);
    expect(ids[1]).toMatch(/^mdv-diagram-\d+-1$/);
    expect(new Set(ids).size).toBe(2);
    await expect(svgs(window).nth(0)).toContainText('First Diagram Node');
    await expect(svgs(window).nth(1)).toContainText('Second Diagram Message');
    await expect(window.locator('#content pre code.language-js .hljs-keyword')).toHaveCount(1);
  });
});

test('#159 XSS suite: no script, no on* attribute, no javascript: URL, canary stays undefined', async ({
  electronApp,
}) => {
  const window = await launchedWindow(electronApp);
  const pageErrors = trackPageErrors(window);
  // Never let a click reach the real OS browser, whatever the diagrams contain.
  await electronApp.evaluate(({ shell }) => {
    shell.openExternal = (async () => undefined) as typeof shell.openExternal;
  });
  // A real global callback: `click X call mdvCallback()` / `click X mdvCallback`
  // would have something to invoke if Mermaid ever bound it.
  await window.evaluate(() => {
    (window as unknown as { mdvCallback: () => void }).mdvCallback = () => {
      (window as unknown as { __mdvCanary: string }).__mdvCanary = 'callback';
    };
  });
  await openViaMenu(electronApp, path.join(FIXTURES, 'xss.md'));

  // Every payload diagram rendered (none short-circuited into a failure notice).
  await expect(svgs(window)).toHaveCount(3, { timeout: 15000 });
  await expect(errors(window)).toHaveCount(0);
  await expect(svgs(window).nth(0)).toContainText('Script Label');
  await expect(svgs(window).nth(0)).toContainText('Edge Label');

  const findings = await window.evaluate(() => {
    const content = document.getElementById('content')!;
    const all = [content, ...Array.from(content.querySelectorAll('*'))];
    const onAttrs: string[] = [];
    const jsUrls: string[] = [];
    for (const el of all) {
      for (const attr of Array.from(el.attributes)) {
        if (/^on/i.test(attr.name)) onAttrs.push(`${el.tagName}.${attr.name}`);
        if (/javascript:/i.test(attr.value.replace(/\s+/g, ''))) jsUrls.push(`${el.tagName}.${attr.name}=${attr.value}`);
      }
    }
    return {
      scripts: content.querySelectorAll('script').length,
      onAttrs,
      jsUrls,
    };
  });
  expect(findings.scripts).toBe(0);
  expect(findings.onAttrs).toEqual([]);
  expect(findings.jsUrls).toEqual([]);
  expect(await window.evaluate(() => (window as unknown as { __mdvCanary?: unknown }).__mdvCanary)).toBeUndefined();

  // Clicking every node and anchor still leaves the canary undefined.
  await window.evaluate(() => {
    document.querySelectorAll('#content .md-view-diagram .node, #content .md-view-diagram a, #content .md-view-diagram .actor').forEach((el) => {
      (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  });
  await settle(300);
  expect(await window.evaluate(() => (window as unknown as { __mdvCanary?: unknown }).__mdvCanary)).toBeUndefined();
  expect(pageErrors).toEqual([]);
});

test.describe('#158 locked keys: %%{init}%% and frontmatter config: cannot override them', () => {
  test('securityLevel loose + click callback gets no handler (init and frontmatter)', async ({ electronApp }) => {
    const window = await launchedWindow(electronApp);
    await window.evaluate(() => {
      (window as unknown as { mdvCallback: () => void }).mdvCallback = () => {
        (window as unknown as { __mdvCanary: string }).__mdvCanary = 'callback';
      };
    });
    await openViaMenu(electronApp, path.join(FIXTURES, 'override.md'));
    await expect(svgs(window)).toHaveCount(9, { timeout: 20000 });

    for (const i of [1, 2]) {
      const hasHandlerMarkup = await window.evaluate((idx) => {
        const svg = document.querySelectorAll('#content .md-view-diagram')[idx].querySelector('svg')!;
        return Array.from(svg.querySelectorAll('*')).some((el) =>
          Array.from(el.attributes).some((a) => /^on/i.test(a.name))
        );
      }, i);
      expect(hasHandlerMarkup).toBe(false);
      await window.evaluate((idx) => {
        document
          .querySelectorAll('#content .md-view-diagram')
          [idx].querySelectorAll('.node')
          .forEach((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
      }, i);
    }
    await settle(300);
    expect(await window.evaluate(() => (window as unknown as { __mdvCanary?: unknown }).__mdvCanary)).toBeUndefined();
  });

  test('themeCSS / fontFamily / altFontFamily / themeVariables add no attacker style (init and frontmatter)', async ({
    electronApp,
  }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, path.join(FIXTURES, 'override.md'));
    await expect(svgs(window)).toHaveCount(9, { timeout: 20000 });

    for (const i of [3, 4]) {
      const markup = await svgs(window).nth(i).evaluate((el) => el.outerHTML);
      expect(markup).not.toContain('mdv-attacker');
      expect(markup).not.toMatch(/Attacker(Alt|Var)?Font/);
      expect(markup.toLowerCase()).not.toContain('#ff00ff');
      expect(await normalizedStyle(window, i)).toBe(await normalizedStyle(window, 0));
    }
  });

  for (const dark of [false, true]) {
    test(`theme / darkMode keep the app theme (init and frontmatter), ${dark ? 'dark' : 'light'} mode (D2)`, async ({
      electronApp,
    }) => {
      const window = await launchedWindow(electronApp);
      await setDarkMode(electronApp, window, dark);
      await openViaMenu(electronApp, path.join(FIXTURES, 'override.md'));
      await expect(svgs(window)).toHaveCount(9, { timeout: 20000 });

      const expectedFill = dark ? DARK_NODE_FILL : DEFAULT_NODE_FILL;
      expect(await nodeFill(window, 0)).toBe(expectedFill);
      const control = await normalizedStyle(window, 0);
      for (const i of [5, 6, 7, 8]) {
        expect(await nodeFill(window, i), `diagram ${i} fill`).toBe(expectedFill);
        expect(await nodeFill(window, i)).not.toBe(FOREST_NODE_FILL);
        expect(await normalizedStyle(window, i), `diagram ${i} style`).toBe(control);
      }
    });
  }

  // darkMode has no visible effect on any probed diagram type under the app's
  // themes in 11.17.2 (S1 probe), so its lock is proven at the config level:
  // Mermaid keeps the directive-merged config after render, and the engine
  // re-initializes before every render, so a document whose ONLY diagram
  // carries the override exposes whether the override was applied. Unlocked,
  // getConfig().darkMode becomes true; locked, it keeps the app's value (the
  // app never sets darkMode, so Mermaid's default false).
  for (const [label, source] of [
    ['%%{init}%% directive', '%%{init: {"darkMode": true}}%%\ngraph TD\n  A[Init DarkMode Only] --> B\n'],
    ['frontmatter config:', '---\nconfig:\n  darkMode: true\n---\ngraph TD\n  A[Frontmatter DarkMode Only] --> B\n'],
  ] as const) {
    test(`darkMode stays locked at the config level (${label})`, async ({ electronApp, tmp }) => {
      const window = await launchedWindow(electronApp);
      const file = path.join(tmp, 'darkmode-only.md');
      fs.writeFileSync(file, '# DarkMode Only\n\n```mermaid\n' + source + '```\n');
      await openViaMenu(electronApp, file);
      await expect(svgs(window)).toHaveCount(1, { timeout: 15000 });
      await expect(svgs(window).first()).toContainText('DarkMode Only');

      const darkMode = await window.evaluate(
        () =>
          (window as unknown as { mermaid: { mermaidAPI: { getConfig: () => { darkMode?: boolean } } } }).mermaid.mermaidAPI.getConfig()
            .darkMode
      );
      expect(darkMode).toBe(false);
    });
  }
});

test.describe('#162 failure isolation', () => {
  test('an invalid diagram shows the notice with its source; its siblings render; no pageerror', async ({
    electronApp,
  }) => {
    const window = await launchedWindow(electronApp);
    const pageErrors = trackPageErrors(window);
    await openViaMenu(electronApp, path.join(FIXTURES, 'invalid.md'));

    await expect(svgs(window)).toHaveCount(2, { timeout: 15000 });
    await expect(errors(window)).toHaveCount(1);
    const failed = window.locator('#content .md-view-diagram').nth(1);
    await expect(failed.locator('.md-view-diagram-error')).toContainText('Could not render diagram');
    await expect(failed.locator('pre code')).toHaveText('notADiagramType\n  this is not mermaid at all\n');
    await expect(window.locator('#content')).toContainText('Text after the diagrams.');
    expect(pageErrors).toEqual([]);
  });

  test('a diagram with more than 500 edges shows the notice (Mermaid throws)', async ({ electronApp, tmp }) => {
    const window = await launchedWindow(electronApp);
    const pageErrors = trackPageErrors(window);
    const edges = Array.from({ length: 501 }, (_, i) => `  n${i} --> n${i + 1}`).join('\n');
    const file = path.join(tmp, 'edges.md');
    fs.writeFileSync(file, '# Edges\n\n```mermaid\ngraph TD\n' + edges + '\n```\n\n```mermaid\ngraph TD\n  Ok[Edge Sibling]\n```\n');
    await openViaMenu(electronApp, file);

    await expect(errors(window)).toHaveCount(1, { timeout: 20000 });
    await expect(errors(window).first()).toContainText(/edge/i);
    await expect(svgs(window)).toHaveCount(1);
    await expect(svgs(window).first()).toContainText('Edge Sibling');
    expect(pageErrors).toEqual([]);
  });

  test("a 50 001-character diagram shows the notice, not Mermaid's pink substitute", async ({ electronApp, tmp }) => {
    const window = await launchedWindow(electronApp);
    const pageErrors = trackPageErrors(window);
    const head = 'graph TD\n  Big[Oversized Node] --> End\n';
    const filler = '%%' + 'x'.repeat(50001 - head.length - 3) + '\n';
    const body = head + filler; // token.content, trailing newline included
    expect(body.length).toBe(50001);
    const file = path.join(tmp, 'big.md');
    fs.writeFileSync(file, '# Big\n\n```mermaid\n' + body + '```\n\n```mermaid\ngraph TD\n  Ok[Big Sibling]\n```\n');
    await openViaMenu(electronApp, file);

    await expect(errors(window)).toHaveCount(1, { timeout: 20000 });
    await expect(errors(window).first()).toContainText(/too large/i);
    await expect(svgs(window)).toHaveCount(1);
    await expect(svgs(window).first()).toContainText('Big Sibling');
    await expect(window.locator('#content')).not.toContainText('Maximum text size in diagram exceeded');
    const shownSource = await window.locator('#content .md-view-diagram').first().locator('pre code').textContent();
    expect(shownSource).toBe(body);
    expect(pageErrors).toEqual([]);
  });
});

test('#161 no network: rendering diagrams requests only file: URLs (positive control: the remote image)', async ({
  electronApp,
}) => {
  const window = await launchedWindow(electronApp);
  const requests: string[] = [];
  window.on('request', (req) => requests.push(req.url()));
  await openViaMenu(electronApp, TEST_FIXTURE);

  await expect(svgs(window)).toHaveCount(1, { timeout: 15000 });
  // Positive control: the channel really does see remote requests.
  const REMOTE_IMAGE = 'https://placehold.co/600x400/2E86AB/FFFFFF?text=Remote+Image+Test';
  await expect.poll(() => requests.includes(REMOTE_IMAGE), { timeout: 10000 }).toBe(true);
  await settle(500);

  const nonLocal = requests.filter((u) => !u.startsWith('file:') && !u.startsWith('data:'));
  expect(nonLocal).toEqual([REMOTE_IMAGE]);
  // The same channel also saw the on-demand bundle load itself (a file: URL).
  expect(requests.some((u) => u.startsWith('file:') && u.endsWith('/dist/renderer/mermaid.min.js'))).toBe(true);

  // Second channel. Chromium records no resource-timing entries for file:
  // loads, so here only "nothing remote except the control" is meaningful.
  const resources = await window.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
  const nonLocalResources = resources.filter((u) => !u.startsWith('file:') && !u.startsWith('data:'));
  expect(nonLocalResources.every((u) => u === REMOTE_IMAGE)).toBe(true);
});

test.describe('D1 on-demand load and the base-href decoy (D3)', () => {
  test('a mermaid.min.js next to the document is never executed; the real bundle comes from dist/renderer', async ({
    electronApp,
  }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, path.join(FIXTURES, 'basic.md'));

    // Settle on the pass outcome (svg OR notice), then check the decoy first:
    // it is the load-bearing assertion (F5).
    await expect(window.locator('#content .md-view-diagram > svg, #content .md-view-diagram-error')).toHaveCount(1, {
      timeout: 15000,
    });
    expect(await window.evaluate(() => (window as unknown as { __decoyCanary?: unknown }).__decoyCanary)).toBeUndefined();
    await expect(svgs(window)).toHaveCount(1);
    await expect(svgs(window).first()).toContainText('Basic Start');

    const loader = await window.evaluate(() =>
      Array.from(document.querySelectorAll('script'))
        .filter((s) => s.src.endsWith('/mermaid.min.js'))
        .map((s) => ({ src: s.src, inHead: s.parentElement === document.head }))
    );
    expect(loader).toHaveLength(1);
    expect(loader[0].inHead).toBe(true);
    expect(loader[0].src).toMatch(/\/dist\/renderer\/mermaid\.min\.js$/);
    expect(loader[0].src).not.toContain('fixtures');
  });

  test('a document without diagrams never loads the bundle', async ({ electronApp }) => {
    const window = await launchedWindow(electronApp);
    const requests: string[] = [];
    window.on('request', (req) => requests.push(req.url()));
    await openViaMenu(electronApp, WITH_CODE);
    await expect(window.locator('#content')).toContainText('Code Highlighting Fixture', { timeout: 10000 });
    await settle(500);

    expect(requests.filter((u) => u.includes('mermaid.min.js'))).toEqual([]);
    const state = await window.evaluate(() => ({
      script: document.querySelectorAll('script[src*="mermaid.min.js"]').length,
      global: typeof (window as unknown as { mermaid?: unknown }).mermaid,
    }));
    expect(state).toEqual({ script: 0, global: 'undefined' });
  });
});

test.describe('#164 theme follows dark mode', () => {
  test('toggling Dark Mode re-renders with dark colours without re-reading the file', async ({ electronApp }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, path.join(FIXTURES, 'basic.md'));
    await expect(svgs(window)).toHaveCount(1, { timeout: 15000 });
    expect(await nodeFill(window, 0)).toBe(DEFAULT_NODE_FILL);

    await installFileRenderedCounter(electronApp);
    await setDarkMode(electronApp, window, true);
    await expect.poll(() => nodeFill(window, 0), { timeout: 10000 }).toBe(DARK_NODE_FILL);
    await expect(svgs(window).first()).toContainText('Basic Start');

    await setDarkMode(electronApp, window, false);
    await expect.poll(() => nodeFill(window, 0), { timeout: 10000 }).toBe(DEFAULT_NODE_FILL);
    expect(await fileRenderedCount(electronApp)).toBe(0);
  });

  test('frontmatter toggle, tree toggle and Code/Preview tabs keep the same svg element', async ({ electronApp }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, path.join(FIXTURES, 'basic.md'));
    await expect(svgs(window)).toHaveCount(1, { timeout: 15000 });
    await window.evaluate(() => {
      (window as unknown as { __svgRef: Element | null }).__svgRef = document.querySelector('#content .md-view-diagram > svg');
    });
    const sameSvg = () =>
      window.evaluate(
        () => document.querySelector('#content .md-view-diagram > svg') === (window as unknown as { __svgRef: Element }).__svgRef
      );

    for (const id of ['menu-show-frontmatter', 'menu-show-frontmatter', 'menu-show-tree-panel', 'menu-show-tree-panel']) {
      await clickMenuItem(electronApp, id);
    }
    await clickMenuItem(electronApp, 'menu-view-code');
    await expect(window.locator('#code-content')).toBeVisible();
    await clickMenuItem(electronApp, 'menu-view-preview');
    await expect(window.locator('#content')).toBeVisible();
    await settle(500);
    expect(await sameSvg()).toBe(true);
  });
});

test('#165 live reload: rewriting the diagram re-renders it with the new label', async ({ electronApp, tmp }) => {
  const window = await launchedWindow(electronApp);
  const file = path.join(tmp, 'live.md');
  fs.writeFileSync(file, '# Live\n\n```mermaid\ngraph TD\n  A[First Label] --> B\n```\n');
  await openViaMenu(electronApp, file);
  await expect(svgs(window).first()).toContainText('First Label', { timeout: 15000 });
  const firstId = await svgs(window).first().getAttribute('id');

  await expect(async () => {
    await fsp.writeFile(file, '# Live\n\n```mermaid\ngraph TD\n  A[Second Label] --> B\n```\n');
    await expect(svgs(window).first()).toContainText('Second Label', { timeout: 1500 });
  }).toPass({ timeout: 15000 });
  expect(await svgs(window).first().getAttribute('id')).not.toBe(firstId);
});

test.describe('#163 no stale writes', () => {
  // `chain` extra edges per diagram make each render slower, widening the
  // mid-pass window without changing what is asserted.
  function manyDiagrams(prefix: string, count: number, chain = 0): string {
    let doc = `# ${prefix} Document\n\n`;
    for (let i = 0; i < count; i++) {
      let extra = '';
      for (let j = 0; j < chain; j++) extra += '  B' + i + '_' + j + ' --> B' + i + '_' + (j + 1) + '\n';
      doc +=
        '```mermaid\ngraph TD\n  A' + i + '[' + prefix + ' Node ' + i + '] --> B' + i + '[' + prefix + ' End ' + i + ']\n' + extra + '```\n\n';
    }
    return doc;
  }

  // Warm-up document: loads the bundle so window.mermaid can be instrumented.
  // Test instrumentation (evaluate is not governed by the CSP): every render
  // then takes >= 200 ms, so an event triggered after the first svg is
  // guaranteed to land while a render is in flight -- the exact window a
  // missing isCurrent check / generation advance would write through. Also
  // counts mermaid.render calls in window.__renderCalls.
  async function warmUpWithSlowRenders(app: ElectronApplication, window: Page, dir: string): Promise<void> {
    const warm = path.join(dir, 'warm.md');
    fs.writeFileSync(warm, manyDiagrams('Warm', 1));
    await openViaMenu(app, warm);
    await expect(svgs(window)).toHaveCount(1, { timeout: 15000 });
    await expect(svgs(window).first()).toContainText('Warm Node 0');
    await window.evaluate(() => {
      const w = window as unknown as {
        mermaid: { render: (...args: unknown[]) => Promise<unknown> };
        __renderCalls: number;
      };
      const original = w.mermaid.render.bind(w.mermaid);
      w.__renderCalls = 0;
      w.mermaid.render = async (...args: unknown[]) => {
        w.__renderCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 200));
        return original(...args);
      };
    });
  }

  const renderCalls = (window: Page) => window.evaluate(() => (window as unknown as { __renderCalls: number }).__renderCalls);

  test('Close right after FILE_RENDERED (bundle still loading): nothing is written, pristine state holds', async ({
    electronApp,
    tmp,
  }) => {
    const window = await launchedWindow(electronApp);
    const pageErrors = trackPageErrors(window);
    const file = path.join(tmp, 'close-during-load.md');
    fs.writeFileSync(file, manyDiagrams('Alpha', 6));
    await installDiagramRecorder(window);
    await afterNextFileRendered(electronApp, { kind: 'close' });
    await openViaMenu(electronApp, file);

    await waitForBundle(window); // the load settled after the Close
    await settle(1500);
    const rec = await readRecorder(window);
    expect(rec.wrappers).toBe(6); // the document really was rendered first
    expect(rec.closedAt).not.toBeNull();
    expect(rec.writes).toEqual([]);
    await expectPristineDocumentView(window);
    await expect(window.locator('#content')).toBeEmpty();
    expect(pageErrors).toEqual([]);
  });

  test('Close mid-pass (after the first svg): no diagram write after the Close, pristine state holds', async ({
    electronApp,
    tmp,
  }) => {
    const window = await launchedWindow(electronApp);
    const pageErrors = trackPageErrors(window);
    const DIAGRAMS = 12;
    await warmUpWithSlowRenders(electronApp, window, tmp);

    const file = path.join(tmp, 'close-mid-pass.md');
    fs.writeFileSync(file, manyDiagrams('Alpha', DIAGRAMS));
    await installDiagramRecorder(window);
    await openViaMenu(electronApp, file);

    // Wait for THIS document's first svg, not the warm-up's (which is already
    // visible until the new FILE_RENDERED replaces #content).
    await expect(svgs(window).first()).toContainText('Alpha Node 0', { timeout: 15000 });
    await expect.poll(async () => (await readRecorder(window)).writes.length).toBeGreaterThan(0);
    await clickMenuItem(electronApp, 'menu-close');
    await expect(window.locator('#status-bar')).toHaveText('No file open');
    await settle(2000);

    const rec = await readRecorder(window);
    expect(rec.closedAt).not.toBeNull();
    expect(rec.writes.length).toBeGreaterThan(0);
    // Precondition: the Close really landed mid-pass.
    expect(rec.writes.length).toBeLessThan(DIAGRAMS);
    const late = rec.writes.filter((w) => w.t > (rec.closedAt as number));
    expect(late).toEqual([]);
    await expectPristineDocumentView(window);
    await expect(window.locator('#content')).toBeEmpty();
    expect(pageErrors).toEqual([]);
  });

  // B2 split (a): the error branch must advance the generation, so the
  // in-flight pass of the previous document stops writing.
  test('a failed open mid-pass: no write into the old wrappers after the error', async ({
    electronApp,
    tmp,
  }) => {
    const window = await launchedWindow(electronApp);
    const pageErrors = trackPageErrors(window);
    const DIAGRAMS = 12;
    await warmUpWithSlowRenders(electronApp, window, tmp);

    const file = path.join(tmp, 'error-mid-pass.md');
    fs.writeFileSync(file, manyDiagrams('Alpha', DIAGRAMS));
    await installDiagramRecorder(window);
    // Records when the FILE_RENDERED error notice lands in #content. The
    // renderer handles the whole message synchronously, so any diagram write
    // recorded after this instant comes from the superseded pass.
    await window.evaluate(() => {
      const w = window as unknown as { __errorAt: number | null };
      w.__errorAt = null;
      const content = document.getElementById('content')!;
      new MutationObserver(() => {
        if (w.__errorAt === null && content.querySelector(':scope > .md-view-error')) w.__errorAt = performance.now();
      }).observe(content, { childList: true });
    });
    await openViaMenu(electronApp, file);

    await expect(svgs(window).first()).toContainText('Alpha Node 0', { timeout: 15000 });
    await expect.poll(async () => (await readRecorder(window)).writes.length).toBeGreaterThan(0);
    await openViaMenu(electronApp, path.join(tmp, 'does-not-exist.md'));
    await expect(window.locator('#content')).toContainText('Could not open file', { timeout: 10000 });
    await settle(1500);

    const rec = await readRecorder(window);
    const errorAt = await window.evaluate(() => (window as unknown as { __errorAt: number | null }).__errorAt);
    expect(errorAt).not.toBeNull();
    // Precondition: the failed open really landed mid-pass.
    expect(rec.writes.length).toBeGreaterThan(0);
    expect(rec.writes.length).toBeLessThan(DIAGRAMS);
    const late = rec.writes.filter((w) => w.t > (errorAt as number));
    expect(late).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  // B2 split (b): the error branch must drop the previous document's slots,
  // so a later theme change starts no pass. The failed open happens AFTER the
  // previous pass completed, so no in-flight render can be counted here.
  test('after a failed open, a later dark-mode toggle triggers zero mermaid.render calls', async ({
    electronApp,
    tmp,
  }) => {
    const window = await launchedWindow(electronApp);
    const pageErrors = trackPageErrors(window);
    await warmUpWithSlowRenders(electronApp, window, tmp);

    const file = path.join(tmp, 'error-after-pass.md');
    fs.writeFileSync(file, manyDiagrams('Alpha', 2));
    await openViaMenu(electronApp, file);
    await expect(svgs(window)).toHaveCount(2, { timeout: 15000 });
    await expect(svgs(window).nth(1)).toContainText('Alpha Node 1');
    // Precondition: the pass is complete (both renders happened).
    expect(await renderCalls(window)).toBe(2);

    await openViaMenu(electronApp, path.join(tmp, 'does-not-exist.md'));
    await expect(window.locator('#content')).toContainText('Could not open file', { timeout: 10000 });
    await settle(500);

    const callsBefore = await renderCalls(window);
    await setDarkMode(electronApp, window, true);
    await settle(1000);
    expect(await renderCalls(window)).toBe(callsBefore);
    await expect(window.locator('#content')).toContainText('Could not open file');
    expect(pageErrors).toEqual([]);
  });

  test('a dark-mode toggle mid-pass leaves no old-theme svg', async ({ electronApp, tmp }) => {
    const window = await launchedWindow(electronApp);
    const file = path.join(tmp, 'dark-mid-pass.md');
    fs.writeFileSync(file, manyDiagrams('Alpha', 4));
    await installDiagramRecorder(window);
    await afterNextFileRendered(electronApp, { kind: 'dark' });
    await openViaMenu(electronApp, file);

    await expect(window.locator('body')).toHaveClass(/dark-mode/, { timeout: 10000 });
    await expect(svgs(window)).toHaveCount(4, { timeout: 15000 });
    await settle(1000);
    for (let i = 0; i < 4; i++) expect(await nodeFill(window, i)).toBe(DARK_NODE_FILL);
    const rec = await readRecorder(window);
    expect(rec.writes.length).toBeGreaterThanOrEqual(4);
    // No svg ever written with the default (light) palette.
    expect(rec.writes.filter((w) => /#ececff/i.test(w.style))).toEqual([]);
  });

  test('a newer document mid-pass contains none of the older document diagrams', async ({ electronApp, tmp }) => {
    const window = await launchedWindow(electronApp);
    const older = path.join(tmp, 'older.md');
    const newer = path.join(tmp, 'newer.md');
    fs.writeFileSync(older, manyDiagrams('Alpha', 4));
    fs.writeFileSync(newer, manyDiagrams('Bravo', 2));
    await installDiagramRecorder(window);
    await afterNextFileRendered(electronApp, { kind: 'open', path: newer });
    await openViaMenu(electronApp, older);

    await expect(window.locator('#content')).toContainText('Bravo Document', { timeout: 10000 });
    await expect(svgs(window)).toHaveCount(2, { timeout: 15000 });
    await settle(1000);
    await expect(window.locator('#content')).not.toContainText('Alpha');
    const rec = await readRecorder(window);
    expect(rec.writes.filter((w) => w.text.includes('Alpha'))).toEqual([]);
    expect(rec.writes.filter((w) => w.text.includes('Bravo')).length).toBe(2);
  });
});

test('orphan-free body: after a pass with a failing diagram, and after Close, body children equal the launch snapshot', async ({
  electronApp,
}) => {
  const window = await launchedWindow(electronApp);
  const snapshot = () =>
    window.evaluate(() =>
      Array.from(document.body.children).map((el) => `${el.tagName}#${el.id}.${el.getAttribute('class') ?? ''}`)
    );
  const pristine = await snapshot();

  await openViaMenu(electronApp, path.join(FIXTURES, 'invalid.md'));
  await expect(svgs(window)).toHaveCount(2, { timeout: 15000 });
  await expect(errors(window)).toHaveCount(1);
  await settle(500);
  expect(await snapshot()).toEqual(pristine);

  await clickMenuItem(electronApp, 'menu-close');
  await expectPristineDocumentView(window);
  expect(await snapshot()).toEqual(pristine);

  const loaderInHead = await window.evaluate(
    () => document.head.querySelectorAll('script[src$="/mermaid.min.js"]').length
  );
  expect(loaderInHead).toBe(1);
});

test.describe('#166 preview-only', () => {
  const SOURCE = '---\ntitle: Diagram Frontmatter\n---\n\n# Preview Only\n\n```mermaid\ngraph TD\n  A[Preview Only Node] --> B\n```\n';

  test('Code tab shows the raw fence, copy-raw-source is byte-identical, status bar and frontmatter unaffected', async ({
    electronApp,
    tmp,
  }) => {
    const window = await launchedWindow(electronApp);
    const file = path.join(tmp, 'preview-only.md');
    fs.writeFileSync(file, SOURCE);
    // Show Frontmatter is on by default (view-menu.spec.ts (a)).
    await openViaMenu(electronApp, file);

    await expect(svgs(window)).toHaveCount(1, { timeout: 15000 });
    await expect(window.locator('#status-bar')).toHaveText(file);
    await expect(window.locator('#frontmatter')).toBeVisible();
    await expect(window.locator('#frontmatter')).toContainText('title: Diagram Frontmatter');

    await clickMenuItem(electronApp, 'menu-view-code');
    await expect(window.locator('#code-content')).toBeVisible();
    const code = await window.locator('#code-content').textContent();
    expect(code).toContain('```mermaid\ngraph TD\n  A[Preview Only Node] --> B\n```');
    await expect(window.locator('#code-content svg')).toHaveCount(0);

    await window.locator('#copy-raw-source').click();
    const clipboardText = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
    expect(clipboardText).toBe(fs.readFileSync(file, 'utf8'));
  });
});
