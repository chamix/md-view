import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test as base, expect } from './support/fixtures';

// Task 49: Copy text (functional_domain.md #196-#203; initial_scaffold.md
// Task 49 Step 1, D1-D4; ADR-013). Every clipboard assertion reads the real
// OS clipboard via electronApp.evaluate(({ clipboard }) => ...), the same
// posture as Task 34's #98 (ui-shell.spec.ts) and Task 45's #166
// (mermaid.spec.ts) -- never an in-memory stand-in.
//
// This Electron's `clipboard` module (confirmed against node_modules/electron
// 's own .d.ts, not assumed) mirrors the async Web Clipboard API shape:
// `readText(): Promise<string>` and `read(): Promise<ClipboardItem[]>` (NOT
// `read(format)` -- that overload does not exist here). Reading html requires
// `clipboard.read()` then `item.getType('text/html')` (a Promise<Blob>) then
// `blob.text()` -- see readClipboardHtml below.
//
// navigator.clipboard.write() in the renderer is asynchronous end-to-end
// (IPC push -> renderer handler -> Promise-returning write()) -- every
// clipboard-writing action in these tests primes a sentinel value first and
// polls until the clipboard actually changes, rather than reading
// immediately after triggering the action (verified empirically: an
// immediate read after a menu click intermittently observes stale content
// left over from an earlier action).

const FIXTURE_SOURCE =
  '---\n' +
  'title: Copy Text Fixture\n' +
  '---\n\n' +
  '# Copy Text Heading\n\n' +
  'Paragraph before the diagram.\n\n' +
  '```mermaid\n' +
  'graph TD\n' +
  '  A[Node One] --> B[Node Two]\n' +
  '```\n\n' +
  'Paragraph after the diagram.\n\n' +
  '```mermaid\n' +
  'sequenceDiagram\n' +
  '  Alice->>Bob: Hello\n' +
  '```\n\n' +
  'Final paragraph.\n';

const FAILING_FIXTURE_SOURCE =
  '# Failing Diagram Fixture\n\n' +
  '```mermaid\n' +
  'notADiagramType\n' +
  '  this is not mermaid at all\n' +
  '```\n\n' +
  'Text after the failed diagram.\n';

// Mirrors token.content's own convention (markdown-it's fence rule): content
// is everything between the ```mermaid line and the closing ``` line,
// verbatim, including the trailing newline after the last content line. This
// is the exact string main's mermaidPlaceholder() escapes into the <code>
// wrapper.dataset.mdviewSource captures -- derived mechanically from the
// same fixture string written to disk, never hand-typed twice.
function fenceBody(source: string, index: number): string {
  const matches = [...source.matchAll(/```mermaid\n([\s\S]*?)```/g)];
  const match = matches[index];
  if (!match) throw new Error('fenceBody: no ```mermaid fence at index ' + index);
  return match[1];
}

const DIAGRAM_1_SOURCE = fenceBody(FIXTURE_SOURCE, 0);
const DIAGRAM_2_SOURCE = fenceBody(FIXTURE_SOURCE, 1);
const FAILING_DIAGRAM_SOURCE = fenceBody(FAILING_FIXTURE_SOURCE, 0);

// Confirmed empirically (a throwaway probe, deleted, never committed): on
// this platform, ANY text/plain string written via
// navigator.clipboard.write()/ClipboardItem -- regardless of whether the
// producing code used .innerText or a plain LF-only JS string -- reads back
// through Electron's clipboard.readText() with every \n normalized to \r\n.
// This is the Windows OS clipboard's own plain-text convention (the same
// thing Notepad relies on), not something md-view's renderer code does or
// could opt out of, and not a defect in D3/diagramCopyPayload. Every text
// assertion in this file therefore normalizes \r\n -> \n before comparing
// against LF-authored fixture strings; readClipboardText applies this
// centrally so call sites never have to.
const crlfToLf = (s: string) => s.replace(/\r\n/g, '\n');

interface TempFiles {
  dir: string;
  file: string;
  failingFile: string;
}

const test = base.extend<{ tmp: TempFiles }>({
  tmp: async ({}, use) => {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-copy-')));
    const file = path.join(dir, 'copy-fixture.md');
    const failingFile = path.join(dir, 'failing-fixture.md');
    fs.writeFileSync(file, FIXTURE_SOURCE);
    fs.writeFileSync(failingFile, FAILING_FIXTURE_SOURCE);
    await use({ dir, file, failingFile });
    fs.rmSync(dir, { recursive: true, force: true });
  },
});

// firstWindow() can resolve before renderer.js has registered its IPC
// listeners (same caveat as every other e2e spec in this repo).
async function launchedWindow(app: ElectronApplication): Promise<Page> {
  const window = await app.firstWindow();
  await window.waitForLoadState('load');
  return window;
}

async function stubOpenDialog(app: ElectronApplication, target: string): Promise<void> {
  await app.evaluate(({ dialog }, targetPath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [targetPath] })) as typeof dialog.showOpenDialog;
  }, target);
}

async function clickAppMenuItem(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click(), id);
}

async function openViaMenu(app: ElectronApplication, filePath: string): Promise<void> {
  await stubOpenDialog(app, filePath);
  await clickAppMenuItem(app, 'menu-open');
}

// Same monkey-patch-and-capture technique already established in this repo's
// own suite for Menu.buildFromTemplate (window-chrome.spec.ts,
// close-document.spec.ts) -- scoped here to only capture a build whose
// template contains 'menu-copy', so it is never confused with applyMenu()'s
// own File/View/Help rebuilds (which happen independently, e.g. on a View
// menu toggle, and never contain that id).
async function installCopyMenuCapture(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) => {
    const bag = globalThis as unknown as { __mdViewLastCopyMenu: Electron.Menu | null };
    bag.__mdViewLastCopyMenu = null;
    const original = Menu.buildFromTemplate.bind(Menu);
    Menu.buildFromTemplate = ((template: Electron.MenuItemConstructorOptions[]) => {
      const menu = original(template);
      if (Array.isArray(template) && template.some((item) => item && (item as { id?: string }).id === 'menu-copy')) {
        bag.__mdViewLastCopyMenu = menu;
      }
      return menu;
    }) as typeof Menu.buildFromTemplate;
  });
}

async function waitForCopyMenuCaptured(app: ElectronApplication): Promise<void> {
  await expect
    .poll(() =>
      app.evaluate(() => !!(globalThis as unknown as { __mdViewLastCopyMenu: Electron.Menu | null }).__mdViewLastCopyMenu)
    )
    .toBe(true);
}

async function capturedCopyMenuState(app: ElectronApplication): Promise<Array<{ id?: string; enabled: boolean }>> {
  return app.evaluate(() => {
    const bag = globalThis as unknown as { __mdViewLastCopyMenu: Electron.Menu | null };
    return (bag.__mdViewLastCopyMenu?.items ?? []).map((item) => ({ id: item.id, enabled: item.enabled }));
  });
}

async function clickCopyMenuItemRaw(app: ElectronApplication, id: 'menu-copy' | 'menu-copy-all'): Promise<void> {
  await app.evaluate((_electron, itemId) => {
    const bag = globalThis as unknown as { __mdViewLastCopyMenu: Electron.Menu | null };
    bag.__mdViewLastCopyMenu?.getMenuItemById(itemId)?.click();
  }, id);
}

// Right-click through the real renderer contextmenu listener (never
// synthesized directly against main), then waits for the captured menu so
// the caller can inspect enabled state or click an item.
async function rightClickAndCaptureMenu(
  app: ElectronApplication,
  locator: ReturnType<Page['locator']>
): Promise<void> {
  await installCopyMenuCapture(app);
  await locator.click({ button: 'right', force: true });
  await waitForCopyMenuCaptured(app);
}

const CLIPBOARD_SENTINEL = '__mdview-copy-text-sentinel__';

async function primeClipboardSentinel(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ clipboard }) => clipboard.writeText('__mdview-copy-text-sentinel__'));
}

async function readClipboardText(app: ElectronApplication): Promise<string> {
  const raw = await app.evaluate(({ clipboard }) => clipboard.readText());
  return crlfToLf(raw);
}

// clipboard.read() (no arguments) resolves with Electron.ClipboardItem[];
// each item's html payload is read via getType('text/html') -> Promise<Blob>
// -> blob.text(). clipboard.read('text/html') (a format argument) is NOT a
// real overload on this Electron -- confirmed against node_modules/electron's
// own .d.ts, and by an earlier probe that showed passing one silently reads
// the (unrelated) zero-argument overload instead, an unserializable
// ClipboardItem[] that Playwright's evaluate() marshals as `[{}]`.
async function readClipboardHtml(app: ElectronApplication): Promise<string> {
  return app.evaluate(async ({ clipboard }) => {
    const items = await clipboard.read();
    for (const item of items) {
      if (item.types.includes('text/html')) {
        const blob = await item.getType('text/html');
        return (blob as Blob).text();
      }
    }
    return '';
  });
}

// The two write mechanisms D2/ADR-013 deliberately keeps separate --
// ClipboardEvent.clipboardData.setData() (Ctrl+C) vs
// navigator.clipboard.write()/ClipboardItem (menu Copy/Copy All) -- hand the
// exact same html STRING to two different OS-level clipboard APIs. Verified
// empirically (a throwaway probe, deleted, never committed): on this
// platform, the async Clipboard API path's CF_HTML round trip wraps the
// fragment in a full `<html><head></head><body>...</body></html>` document
// when read back, while the ClipboardEvent path does not. Both still write
// and read back the exact same *substantive* content, so parity assertions
// unwrap a full-document wrapper before comparing, instead of asserting raw
// byte-for-byte string equality across two intentionally different OS
// clipboard mechanisms.
function unwrapHtmlDocument(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return (match ? match[1] : html).trim();
}

// Primes a sentinel, runs `trigger` (a menu click or a Ctrl+C), then polls
// the real OS clipboard until it no longer holds the sentinel -- the async
// IPC-push -> renderer -> navigator.clipboard.write() chain has genuinely
// landed by the time this resolves, not just "the click handler returned".
async function copyAndReadText(app: ElectronApplication, trigger: () => Promise<void>): Promise<string> {
  await primeClipboardSentinel(app);
  await trigger();
  await expect.poll(() => readClipboardText(app)).not.toBe(CLIPBOARD_SENTINEL);
  return readClipboardText(app);
}

async function clickCopyMenuItem(app: ElectronApplication, id: 'menu-copy' | 'menu-copy-all'): Promise<string> {
  return copyAndReadText(app, () => clickCopyMenuItemRaw(app, id));
}

async function selectElementContents(window: Page, selector: string): Promise<void> {
  await window.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('selectElementContents: not found ' + sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
  }, selector);
}

async function selectRangeBetween(window: Page, startSelector: string, endSelector: string): Promise<void> {
  await window.evaluate(
    ({ startSelector, endSelector }) => {
      const startEl = document.querySelector(startSelector);
      const endEl = document.querySelector(endSelector);
      if (!startEl || !endEl) throw new Error('selectRangeBetween: element not found');
      const range = document.createRange();
      range.setStart(startEl, 0);
      range.setEndAfter(endEl);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    },
    { startSelector, endSelector }
  );
}

async function currentSelectionText(window: Page): Promise<string> {
  return window.evaluate(() => window.getSelection()?.toString() ?? '');
}

async function ctrlCAndReadText(app: ElectronApplication, window: Page): Promise<string> {
  return copyAndReadText(app, () => window.keyboard.press('Control+c'));
}

const svgs = (window: Page) => window.locator('#content .md-view-diagram > svg');
const failedDiagrams = (window: Page) => window.locator('#content .md-view-diagram > .md-view-diagram-error');

test.describe('#196: Copy = selection, in two formats', () => {
  test('Ctrl+C with plain text selected writes both text/plain and text/html to the real OS clipboard', async ({
    electronApp,
    tmp,
  }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.file);
    await expect(window.locator('#content')).toContainText('Copy Text Heading', { timeout: 10000 });

    await selectElementContents(window, '#content > :nth-child(2)'); // "Paragraph before the diagram."
    const text = await ctrlCAndReadText(electronApp, window);
    const html = await readClipboardHtml(electronApp);

    expect(text).toContain('Paragraph before the diagram.');
    expect(html).toContain('Paragraph before the diagram.');
    // Chromium's own default html serialization for a selection confined to
    // *inside* a <p> (not the <p> element itself) legitimately wraps it in a
    // <span style="..."> with inherited computed styles rather than
    // preserving the <p> tag -- real, unmodified default browser behavior
    // (this app adds no code to this path at all when no diagram is
    // involved, per D2). The guardrail is "html is real markup, not a
    // second copy of the plain text", not a specific tag name.
    expect(html).toMatch(/<[a-z]/i);
    expect(html).not.toBe(text);
  });
});

test.describe('#197: Copy All = the whole visible view', () => {
  test('Copy All in Preview includes frontmatter when shown, excludes it when hidden (F4)', async ({ electronApp, tmp }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.file);
    await expect(window.locator('#content')).toContainText('Copy Text Heading', { timeout: 10000 });
    await expect(svgs(window)).toHaveCount(2, { timeout: 15000 });

    // Show Frontmatter is on by default.
    await expect(window.locator('#frontmatter')).toBeVisible();
    await rightClickAndCaptureMenu(electronApp, window.locator('#content'));
    const shownText = await clickCopyMenuItem(electronApp, 'menu-copy-all');
    expect(shownText).toContain('Copy Text Fixture'); // frontmatter's own title: line

    await clickAppMenuItem(electronApp, 'menu-show-frontmatter');
    await expect(window.locator('#frontmatter')).toBeHidden();
    await rightClickAndCaptureMenu(electronApp, window.locator('#content'));
    const hiddenText = await clickCopyMenuItem(electronApp, 'menu-copy-all');
    const hiddenHtml = await readClipboardHtml(electronApp);
    expect(hiddenText).not.toContain('Copy Text Fixture');
    expect(hiddenText).toContain('Copy Text Heading');
    // The .hidden check must exclude #frontmatter from the Range entirely
    // (F4) -- checked via html, not just text: a hidden element that is
    // still IN the range but excluded from rendering would vanish from
    // .innerText (hidden elements contribute no rendered text) while still
    // leaking into .innerHTML, which serializes the DOM regardless of CSS
    // visibility. Only actually excluding it from the Range (not just
    // relying on it being invisible) keeps it out of the html too.
    expect(hiddenHtml).not.toContain('Copy Text Fixture');
    expect(hiddenHtml).not.toContain('id="frontmatter"');
  });

  test('Copy All does not move or clear the live selection (review condition 2)', async ({ electronApp, tmp }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.file);
    await expect(window.locator('#content')).toContainText('Copy Text Heading', { timeout: 10000 });

    await selectElementContents(window, '#content > :nth-child(2)');
    const before = await currentSelectionText(window);
    expect(before).toContain('Paragraph before the diagram.');

    // Right-click ON the selected paragraph itself -- a right-click elsewhere
    // in #content would, per normal browser mousedown handling, collapse the
    // existing selection before the contextmenu handler even runs, which
    // would test nothing about Copy All's own behavior.
    await rightClickAndCaptureMenu(electronApp, window.locator('#content > :nth-child(2)'));
    await clickCopyMenuItem(electronApp, 'menu-copy-all');

    const after = await currentSelectionText(window);
    expect(after).toBe(before);
  });

  test('Copy All in Code is byte-identical to copy-raw-source (D4)', async ({ electronApp, tmp }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.file);
    await expect(window.locator('#content')).toContainText('Copy Text Heading', { timeout: 10000 });

    await clickAppMenuItem(electronApp, 'menu-view-code');
    await expect(window.locator('#tab-code')).toHaveClass(/active/);
    await expect(window.locator('#code-content')).toBeVisible();

    await rightClickAndCaptureMenu(electronApp, window.locator('#code-content'));
    const clipboardText = await clickCopyMenuItem(electronApp, 'menu-copy-all');

    const onDiskContent = fs.readFileSync(tmp.file, 'utf8');
    expect(clipboardText).toBe(onDiskContent);
  });
});

test.describe('#198: diagrams copy their source, never SVG', () => {
  test('right-click on a successfully rendered diagram copies exactly its Mermaid source', async ({ electronApp, tmp }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.file);
    await expect(svgs(window)).toHaveCount(2, { timeout: 15000 });

    await rightClickAndCaptureMenu(electronApp, window.locator('.md-view-diagram').first());
    const text = await clickCopyMenuItem(electronApp, 'menu-copy');
    const html = await readClipboardHtml(electronApp);

    expect(text).toBe(DIAGRAM_1_SOURCE);
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<path');
  });

  test('right-click on a failed diagram copies exactly its Mermaid source, not an error message', async ({
    electronApp,
    tmp,
  }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.failingFile);
    await expect(failedDiagrams(window)).toHaveCount(1, { timeout: 15000 });

    await rightClickAndCaptureMenu(electronApp, window.locator('.md-view-diagram').first());
    const text = await clickCopyMenuItem(electronApp, 'menu-copy');

    expect(text).toBe(FAILING_DIAGRAM_SOURCE);
  });

  test('a selection spanning text+diagram+text replaces the diagram with its source, in document order', async ({
    electronApp,
    tmp,
  }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.file);
    await expect(svgs(window)).toHaveCount(2, { timeout: 15000 });

    // :nth-child(2) = "Paragraph before the diagram.", :nth-child(4) =
    // "Paragraph after the diagram." -- the range between them spans
    // :nth-child(3), the first diagram.
    await selectRangeBetween(window, '#content > :nth-child(2)', '#content > :nth-child(4)');
    const text = crlfToLf(await ctrlCAndReadText(electronApp, window));
    const html = await readClipboardHtml(electronApp);

    expect(text).toContain('Paragraph before the diagram.');
    expect(text).toContain(DIAGRAM_1_SOURCE.trim());
    expect(text).toContain('Paragraph after the diagram.');
    expect(text).not.toContain('<svg');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<path');
  });

  test('Copy All over a document with two diagrams: text has both fence bodies verbatim, no SVG anywhere', async ({
    electronApp,
    tmp,
  }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.file);
    await expect(svgs(window)).toHaveCount(2, { timeout: 15000 });

    await rightClickAndCaptureMenu(electronApp, window.locator('#content'));
    const text = crlfToLf(await clickCopyMenuItem(electronApp, 'menu-copy-all'));

    expect(text).toContain(DIAGRAM_1_SOURCE.trim());
    expect(text).toContain(DIAGRAM_2_SOURCE.trim());
    expect(text).not.toContain('<svg');
    expect(text).not.toContain('<path');
  });

  // Review condition 3 / ADR-013's "new invariant" / F7: the substituted
  // <pre><code> is a FRESH element, never the original wrapper's outerHTML
  // with children swapped -- which would leak data-mdview-source/
  // data-diagram/class="md-view-diagram" into whatever the user pastes.
  test('the copied html never leaks md-view-diagram internal markers (F7)', async ({ electronApp, tmp }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.file);
    await expect(svgs(window)).toHaveCount(2, { timeout: 15000 });

    await rightClickAndCaptureMenu(electronApp, window.locator('#content'));
    await clickCopyMenuItem(electronApp, 'menu-copy-all');
    const html = await readClipboardHtml(electronApp);

    expect(html).not.toContain('data-mdview-source');
    expect(html).not.toContain('data-diagram');
    expect(html).not.toContain('md-view-diagram');
  });

  // F3: mounting the substituted clone with innerText (not textContent) is
  // what keeps block boundaries from running text together across the
  // diagram substitution.
  test('adjacent paragraphs around a diagram are not run together in Copy All text (F3)', async ({ electronApp, tmp }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.file);
    await expect(svgs(window)).toHaveCount(2, { timeout: 15000 });

    await rightClickAndCaptureMenu(electronApp, window.locator('#content'));
    const text = await clickCopyMenuItem(electronApp, 'menu-copy-all');

    // A genuinely discriminating check (verified empirically: this fixture's
    // own HTML source already has an incidental single \n before a diagram,
    // and every diagram's own fence body ends in \n, so merely asserting
    // "no zero-separator glue" passes even under .textContent -- it takes a
    // real block-boundary blank line, which only .innerText produces, to
    // actually distinguish the two). innerText separates block-level
    // siblings with a blank line (\n\n after crlfToLf normalization);
    // .textContent would collapse this to a single \n on both sides of the
    // diagram substitution.
    expect(text).toMatch(/the diagram\.\n\n+graph TD/);
    expect(text).toMatch(/B\[Node Two\]\n\n+Paragraph after the diagram\./);
    expect(text).not.toMatch(/the diagram\.\n(?!\n)/);
  });
});

test.describe('#199: the source survives rendering/theme-change/failure', () => {
  test('right-click copy on the same diagram returns the identical source before rendering completes, after it completes, and after a Dark Mode toggle', async ({
    electronApp,
    tmp,
  }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.file);

    // Before rendering completes: D1 writes wrapper.dataset.mdviewSource
    // synchronously at collectSlots() time, before the async Mermaid bundle
    // load/render pass even starts -- so the source is already correct here,
    // whether or not the SVG has appeared yet.
    await expect(window.locator('.md-view-diagram').first()).toBeAttached();
    await rightClickAndCaptureMenu(electronApp, window.locator('.md-view-diagram').first());
    expect(await clickCopyMenuItem(electronApp, 'menu-copy')).toBe(DIAGRAM_1_SOURCE);

    // After rendering completes.
    await expect(svgs(window)).toHaveCount(2, { timeout: 15000 });
    await rightClickAndCaptureMenu(electronApp, window.locator('.md-view-diagram').first());
    expect(await clickCopyMenuItem(electronApp, 'menu-copy')).toBe(DIAGRAM_1_SOURCE);

    // After a Dark Mode toggle (darkModeChanged() re-renders from the same
    // closed-over slots, never re-collecting from the DOM -- #164).
    await clickAppMenuItem(electronApp, 'menu-dark-mode');
    await expect(window.locator('body')).toHaveClass(/dark-mode/);
    await expect(svgs(window)).toHaveCount(2, { timeout: 15000 });
    await rightClickAndCaptureMenu(electronApp, window.locator('.md-view-diagram').first());
    expect(await clickCopyMenuItem(electronApp, 'menu-copy')).toBe(DIAGRAM_1_SOURCE);
  });

  test('right-click copy on a diagram that failed to render still returns its exact source', async ({ electronApp, tmp }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.failingFile);
    await expect(failedDiagrams(window)).toHaveCount(1, { timeout: 15000 });

    await rightClickAndCaptureMenu(electronApp, window.locator('.md-view-diagram').first());
    expect(await clickCopyMenuItem(electronApp, 'menu-copy')).toBe(FAILING_DIAGRAM_SOURCE);
  });
});

test.describe('#200: Ctrl+C parity with menu Copy', () => {
  // Both paths are guaranteed identical specifically when a diagram is
  // involved (D2/ADR-013: "the renderer ... builds { text, html } with the
  // same D3 function the copy-event path uses"). A no-diagram selection
  // deliberately uses TWO different mechanisms by design (Chromium's own
  // default for Ctrl+C, D3's serializer for the menu path) -- see ADR-013's
  // Alternatives Considered -- so the diagram-spanning case is the
  // meaningful, guaranteed-identical parity check.
  test('Ctrl+C and menu Copy on the same diagram-spanning selection produce the same payload', async ({
    electronApp,
    tmp,
  }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.file);
    await expect(svgs(window)).toHaveCount(2, { timeout: 15000 });

    await selectRangeBetween(window, '#content > :nth-child(2)', '#content > :nth-child(4)');
    const ctrlCText = await ctrlCAndReadText(electronApp, window);
    const ctrlCHtml = await readClipboardHtml(electronApp);

    await selectRangeBetween(window, '#content > :nth-child(2)', '#content > :nth-child(4)');
    await rightClickAndCaptureMenu(electronApp, window.locator('#content > :nth-child(2)'));
    const menuText = await clickCopyMenuItem(electronApp, 'menu-copy');
    const menuHtml = await readClipboardHtml(electronApp);

    expect(menuText).toBe(ctrlCText);
    expect(unwrapHtmlDocument(menuHtml)).toBe(unwrapHtmlDocument(ctrlCHtml));
  });

  test('Ctrl+C over a selection spanning a diagram copies its source, not the rendered SVG (F1/F6)', async ({
    electronApp,
    tmp,
  }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.file);
    await expect(svgs(window)).toHaveCount(2, { timeout: 15000 });

    await selectRangeBetween(window, '#content > :nth-child(2)', '#content > :nth-child(4)');
    const text = crlfToLf(await ctrlCAndReadText(electronApp, window));
    const html = await readClipboardHtml(electronApp);

    expect(text).toContain(DIAGRAM_1_SOURCE.trim());
    expect(text).not.toContain('<svg');
    expect(html).not.toContain('<svg');
  });

  test('Ctrl+C over a selection that is entirely a diagram copies its source, not the rendered SVG (F1/F6)', async ({
    electronApp,
    tmp,
  }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.file);
    await expect(svgs(window)).toHaveCount(2, { timeout: 15000 });

    await selectElementContents(window, '.md-view-diagram');
    const text = crlfToLf(await ctrlCAndReadText(electronApp, window));
    const html = await readClipboardHtml(electronApp);

    expect(text.trim()).toBe(DIAGRAM_1_SOURCE.trim());
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<path');
  });
});

test.describe('#201: menu states, scoped to the document area only', () => {
  test('no file open: Copy and Copy All are both disabled', async ({ electronApp }) => {
    const window = await launchedWindow(electronApp);
    await rightClickAndCaptureMenu(electronApp, window.locator('#content'));
    const items = await capturedCopyMenuState(electronApp);
    expect(items.find((i) => i.id === 'menu-copy')?.enabled).toBe(false);
    expect(items.find((i) => i.id === 'menu-copy-all')?.enabled).toBe(false);
  });

  test('an error shown (failed open): Copy and Copy All are both disabled', async ({ electronApp, tmp }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, path.join(tmp.dir, 'does-not-exist.md'));
    await expect(window.locator('.md-view-error')).toBeVisible({ timeout: 10000 });

    await rightClickAndCaptureMenu(electronApp, window.locator('#content'));
    const items = await capturedCopyMenuState(electronApp);
    expect(items.find((i) => i.id === 'menu-copy')?.enabled).toBe(false);
    expect(items.find((i) => i.id === 'menu-copy-all')?.enabled).toBe(false);
  });

  test('a file open, no selection, no diagram under cursor: Copy disabled, Copy All still enabled (F5)', async ({
    electronApp,
    tmp,
  }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.file);
    await expect(window.locator('#content')).toContainText('Copy Text Heading', { timeout: 10000 });

    await window.evaluate(() => window.getSelection()?.removeAllRanges());
    await rightClickAndCaptureMenu(electronApp, window.locator('#content'));
    const items = await capturedCopyMenuState(electronApp);
    expect(items.find((i) => i.id === 'menu-copy')?.enabled).toBe(false);
    expect(items.find((i) => i.id === 'menu-copy-all')?.enabled).toBe(true);
  });

  test('a file open with a live selection: Copy is enabled', async ({ electronApp, tmp }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.file);
    await expect(window.locator('#content')).toContainText('Copy Text Heading', { timeout: 10000 });

    await selectElementContents(window, '#content > :nth-child(2)');
    await rightClickAndCaptureMenu(electronApp, window.locator('#content > :nth-child(2)'));
    const items = await capturedCopyMenuState(electronApp);
    expect(items.find((i) => i.id === 'menu-copy')?.enabled).toBe(true);
  });

  test('right-click on the title bar, tree panel, or status bar never pops the document copy menu', async ({
    electronApp,
    tmp,
  }) => {
    const window = await launchedWindow(electronApp);
    await openViaMenu(electronApp, tmp.file);
    await expect(window.locator('#content')).toContainText('Copy Text Heading', { timeout: 10000 });

    await installCopyMenuCapture(electronApp);
    await window.locator('#title-bar').click({ button: 'right', force: true, position: { x: 5, y: 5 } });
    await window.locator('#tree-panel').click({ button: 'right', force: true });
    await window.locator('#status-bar').click({ button: 'right', force: true });

    const stillNull = await electronApp.evaluate(
      () => (globalThis as unknown as { __mdViewLastCopyMenu: Electron.Menu | null }).__mdViewLastCopyMenu
    );
    expect(stillNull).toBeNull();

    // Positive control (same posture as window-chrome.spec.ts's own comment
    // on this pattern): prove the capture mechanism actually detects a
    // document-area right-click, so the assertion above isn't trivially
    // passing regardless of whether the scoping is really in effect.
    await window.locator('#content').click({ button: 'right', force: true });
    await waitForCopyMenuCaptured(electronApp);
  });
});
