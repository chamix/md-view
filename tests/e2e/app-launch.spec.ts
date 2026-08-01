import * as path from 'path';
import { test, expect, _electron as electron } from '@playwright/test';

// The host shell may set ELECTRON_RUN_AS_NODE=1 (e.g. some CI/dev-tool
// environments), which forces any Electron binary to run as plain Node
// instead of booting the Electron runtime (app/BrowserWindow become
// undefined). Strip it from the child process env so the launched app
// always runs as real Electron regardless of the parent shell's env.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

test('app launches and opens a window', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '../../dist/main/index.js')],
    env: childEnv,
  });

  const window = await app.firstWindow();
  expect(window).toBeTruthy();

  await app.close();
});
