import * as path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './support/fixtures';

// Task 45 #160: main-window Content Security Policy. Violation listeners are
// installed via page.evaluate (not governed by the CSP) AFTER launch and
// BEFORE the document is opened through the stubbed-dialog File > Open path:
// main sends the first FILE_RENDERED on did-finish-load, and an inline
// listener script would itself be blocked by the policy.

const EXPECTED_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file: data: http: https:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self' file:";

const TEST_FIXTURE = path.join(process.cwd(), 'tests/test-content/test-fixture.md');

async function launchedWindow(app: ElectronApplication): Promise<Page> {
  const window = await app.firstWindow();
  await window.waitForLoadState('load');
  return window;
}

async function openViaMenu(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, targetPath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [targetPath] })) as typeof dialog.showOpenDialog;
  }, filePath);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu-open')?.click());
}

async function installViolationRecorder(window: Page): Promise<void> {
  await window.evaluate(() => {
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__cspViolations.push(`${e.effectiveDirective} ${e.blockedURI}`);
    });
  });
}

function violations(window: Page): Promise<string[]> {
  return window.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
}

test('the CSP meta is the first element after <meta charset> and carries the exact approved policy', async ({
  electronApp,
}) => {
  const window = await launchedWindow(electronApp);
  const head = await window.evaluate(() =>
    Array.from(document.head.children)
      .slice(0, 2)
      .map((el) => ({
        tag: el.tagName,
        charset: el.getAttribute('charset'),
        httpEquiv: el.getAttribute('http-equiv'),
        content: el.getAttribute('content'),
      }))
  );
  expect(head[0]).toMatchObject({ tag: 'META', charset: 'UTF-8' });
  expect(head[1]).toMatchObject({ tag: 'META', httpEquiv: 'Content-Security-Policy', content: EXPECTED_CSP });
});

test('(b) rendering the full test-fixture.md (diagram included) raises zero securitypolicyviolation events', async ({
  electronApp,
}) => {
  const window = await launchedWindow(electronApp);
  await installViolationRecorder(window);
  await openViaMenu(electronApp, TEST_FIXTURE);

  await expect(window.locator('#content .md-view-diagram > svg')).toHaveCount(1, { timeout: 15000 });
  // Let every image (local, missing, remote) settle.
  await window.waitForFunction(() => Array.from(document.images).every((img) => img.complete), null, {
    timeout: 15000,
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(await violations(window)).toEqual([]);
});

test('(c) an injected inline <script> does not run (canary stays undefined)', async ({ electronApp }) => {
  const window = await launchedWindow(electronApp);
  await installViolationRecorder(window);
  await window.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__cspCanary = "inline script ran";';
    document.head.appendChild(script);
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(await window.evaluate(() => (window as unknown as { __cspCanary?: unknown }).__cspCanary)).toBeUndefined();
  expect((await violations(window)).some((v) => v.startsWith('script-src-elem'))).toBe(true);
});

test('(c) companion: an injected <img onerror> handler does not run (canary stays undefined)', async ({
  electronApp,
}) => {
  const window = await launchedWindow(electronApp);
  await installViolationRecorder(window);
  await window.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<img id="csp-onerror-probe" src="data:image/png;base64,bm90LWFuLWltYWdl" onerror="window.__cspImgCanary = \'onerror ran\'">'
    );
  });
  // The image is a broken data: URL, so its error event fires for sure.
  await window.waitForFunction(() => (document.getElementById('csp-onerror-probe') as HTMLImageElement).complete);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(await window.evaluate(() => (window as unknown as { __cspImgCanary?: unknown }).__cspImgCanary)).toBeUndefined();
  expect((await violations(window)).some((v) => v.startsWith('script-src-attr'))).toBe(true);
  await window.evaluate(() => document.getElementById('csp-onerror-probe')?.remove());
});

test('fetch() to a remote origin is refused by connect-src, not merely by CORS', async ({ electronApp }) => {
  const window = await launchedWindow(electronApp);
  await installViolationRecorder(window);
  // no-cors: without the CSP this would resolve with an opaque response (when
  // online), so a rejection alone would not prove the policy. The violation
  // event below is CSP-specific either way.
  const outcome = await window.evaluate(async () => {
    try {
      await fetch('https://example.com/', { mode: 'no-cors' });
      return 'resolved';
    } catch {
      return 'rejected';
    }
  });
  expect(outcome).toBe('rejected');
  await expect
    .poll(async () => (await violations(window)).some((v) => v.startsWith('connect-src https://example.com')))
    .toBe(true);
});
