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

// Launched as `electron .` from the repo root (package.json "main" is
// dist/main/index.js, so it is the same app), NOT as `electron <entry script>`:
// with an explicit entry script Electron does not resolve the app's
// package.json, so app.getVersion() returns Electron's own runtime version
// (verified by probe: '44.3.0' vs '1.1.0') and app identity differs from
// `npm run dev` and the packaged app. Version-dependent features (What's New)
// need the real identity.
const REPO_ROOT = path.join(__dirname, '../../..');

export const test = base.extend<{
  electronArgs: string[];
  initialUserDataFiles: Record<string, string>;
  electronApp: ElectronApplication;
  userDataDir: string;
}>({
  electronArgs: [[], { option: true }],
  // Files (relative name -> content) written into userDataDir BEFORE the app
  // launches, e.g. a seeded state.json to simulate "launched after an update".
  initialUserDataFiles: [{}, { option: true }],
  // Exposed as its own fixture (not just a local inside electronApp) so a
  // test can read files directly out of the same per-user-data directory
  // the running app itself resolves app.getPath('userData') to -- e.g.
  // asserting settings.json's on-disk content immediately after a menu
  // toggle, without adding any new IPC/test-only bridge to production code.
  userDataDir: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-e2e-'));
    await use(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  },
  electronApp: async ({ electronArgs, userDataDir, initialUserDataFiles }, use) => {
    for (const [name, content] of Object.entries(initialUserDataFiles)) {
      fs.writeFileSync(path.join(userDataDir, name), content, 'utf8');
    }

    // The explicit `--user-data-dir=` switch is load-bearing, not redundant
    // with the `userDataDir` launch option below: verified directly against
    // this project's installed Playwright version (1.62.1) that
    // `_electron.launch({ userDataDir })` never actually forwards that path
    // to the spawned Electron process (its own Electron.launch()
    // implementation builds argv from `options.args` only, confirmed by
    // reading node_modules/playwright-core's bundled source). Without this
    // switch, app.getPath('userData') inside the launched app silently
    // resolves to the real, shared, default %APPDATA%/Electron profile
    // instead of this per-test temp directory -- invisible before Task 37
    // (nothing was ever persisted to userData to expose it), newly
    // load-bearing now that settings.json actually lives there.
    const app = await electron.launch({
      args: [`--user-data-dir=${userDataDir}`, '.', ...electronArgs],
      cwd: REPO_ROOT,
      env: childEnv,
      userDataDir,
    });
    await use(app);
    await app.close();
  },
});

export { expect } from '@playwright/test';
