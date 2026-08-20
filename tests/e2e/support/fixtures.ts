import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test as base, _electron as electron, type ElectronApplication } from '@playwright/test';

// The host shell may set ELECTRON_RUN_AS_NODE=1 (e.g. some CI/dev-tool
// environments), which forces any Electron binary to run as plain Node
// instead of booting the Electron runtime (app/BrowserWindow become
// undefined). Strip it from the child process env so the launched app
// always runs as real Electron regardless of the parent shell's env.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const ENTRY_POINT = path.join(__dirname, '../../../dist/main/index.js');

export const test = base.extend<{
  electronArgs: string[];
  electronApp: ElectronApplication;
}>({
  electronArgs: [[], { option: true }],
  electronApp: async ({ electronArgs }, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-'));
    const app = await electron.launch({
      args: [ENTRY_POINT, ...electronArgs],
      env: childEnv,
      userDataDir,
    });
    await use(app);
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },
});

export { expect } from '@playwright/test';
