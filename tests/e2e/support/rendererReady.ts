import type { ElectronApplication, Page } from '@playwright/test';

// Task 47 H2 (functional_domain.md #183): the ONE definition of "the main
// renderer is ready". ipcRenderer messages sent before renderer.js has
// registered its receivers are dropped, not queued, so an e2e test must not
// trigger a main-side action whose result goes to the renderer before this
// resolves.
//
// The signal cannot be satisfied early:
//   - the initial about:blank fails the URL clause;
//   - renderer.js is a classic, parser-inserted script at the end of <body>,
//     so readyState cannot reach 'complete' before it has run;
//   - page.evaluate cannot run while the renderer is paused before its page
//     scripts (it blocks), so it cannot race such a hold.
// Evaluation errors (context torn down by a navigation) count as "not yet".

export interface RendererReadyOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

function isRendererReady(page: Page): Promise<boolean> {
  return page
    .evaluate(() => location.pathname.endsWith('/renderer/index.html') && document.readyState === 'complete')
    .catch(() => false);
}

// Given a Page: waits until THAT page is the ready main renderer.
// Given the ElectronApplication: waits until its main renderer window is
// ready, whichever window it is. app.firstWindow() is not necessarily the
// main window: Playwright orders windows by when their CDP page finished
// initializing, and with What's New due the static data: window came first
// in 3 of 20 measured launches (2 concurrent). Only the main renderer can
// satisfy the URL clause, so the policy is the same predicate either way.
export async function waitForRendererReady(
  target: Page | ElectronApplication,
  options: RendererReadyOptions = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;
  const isApp = 'windows' in target;

  for (;;) {
    const pages = isApp ? (target as ElectronApplication).windows() : [target as Page];
    for (const page of pages) {
      if (await isRendererReady(page)) return;
    }
    if (!isApp && (target as Page).isClosed()) throw new Error('waitForRendererReady: renderer not ready (page closed)');
    if (Date.now() >= deadline) throw new Error(`waitForRendererReady: renderer not ready after ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
