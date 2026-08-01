import * as path from 'path';
import { test, expect, _electron as electron } from '@playwright/test';

// The host shell may set ELECTRON_RUN_AS_NODE=1 (e.g. some CI/dev-tool
// environments), which forces any Electron binary to run as plain Node
// instead of booting the Electron runtime (app/BrowserWindow become
// undefined). Strip it from the child process env so the launched app
// always runs as real Electron regardless of the parent shell's env.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

// This fixture is read-only — nothing mutates doc.md or img/sample.png — so,
// unlike the live-reload specs, there's no need to copy it to a tmpdir first;
// launching directly against the checked-in fixture path is safe.
const fixturePath = path.join(process.cwd(), 'tests/e2e/fixtures/with-image/doc.md');

test('resolves a Markdown-relative image path against the open file\'s directory and the image actually loads', async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'dist/main/index.js'), fixturePath],
    env: childEnv,
  });

  const window = await app.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('Image Fixture', { timeout: 10000 });

  const img = content.locator('img');
  await expect(img).toHaveCount(1);

  // Checking that the <img> tag exists or that its `src` attribute has some
  // value is explicitly NOT sufficient here: with the <base> approach, `src`
  // in the DOM stays exactly as written in the source Markdown (relative),
  // so an `src` check would pass even if the base-href fix were completely
  // broken. The only honest proof is that the browser actually resolved and
  // loaded the image. Handle both "already loaded by the time we check" and
  // "still loading" to avoid a flaky race.
  //
  // KNOWN LIMITATION (confirmed empirically, see Task 4 review + follow-up
  // investigation): this end-state check, and an equivalent Playwright
  // request-interception check on the resolved image request URL, both stay
  // green even when renderHtml()'s two statements are swapped into the wrong
  // order. The image fetch is dispatched on a later task/tick than the
  // synchronous script that sets base.href and innerHTML, so by the time any
  // observable event fires (load/error, or the network request itself),
  // base.href already holds its final value regardless of statement order
  // within that synchronous block. This test still proves the base-URL
  // *mechanism* works end-to-end (a relative image path resolves against the
  // open file's directory and loads), which is real, valuable coverage — it
  // does not, and cannot at this behavioral/timing granularity, prove the
  // ordering guardrail itself. See the Lead's report for the disposition of
  // that specific guardrail.
  const loaded = await img.evaluate((el: HTMLImageElement) => {
    if (el.complete) {
      return el.naturalWidth > 0;
    }
    return new Promise<boolean>((resolve) => {
      el.addEventListener('load', () => resolve(el.naturalWidth > 0), { once: true });
      el.addEventListener('error', () => resolve(false), { once: true });
    });
  });

  expect(loaded).toBe(true);

  await app.close();
});
