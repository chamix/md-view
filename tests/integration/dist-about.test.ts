import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { licensePathFor, thirdPartyNoticesPathFor, packageJsonPathFor } from '../../src/main/paths';
import { parseCopyrightLine, buildAboutDocument } from '../../src/main/aboutWindow';
import { ThirdPartyNoticesSchema } from '../../src/main/thirdPartyNotices';
import { staticHtmlDataUrl } from '../../src/main/helpWindow';
import { computeShippedClosure, shippedRoots, extractCopiedPackages } from '../../scripts/third-party-notices.mjs';

// Task 46 built-output proof (#170, #173, #176, #177, D3; same posture as
// dist-changelog.test.ts / #143): electron-builder ships only dist/**/* and
// package.json, so the About inputs are proven from dist/. Requires
// `npm run build` first.
const repoRoot = path.resolve(__dirname, '../..');
const distMainDir = path.join(repoRoot, 'dist', 'main');
const script = path.join(repoRoot, 'scripts', 'third-party-notices.mjs');
const YEAR = /\b(19|20)\d{2}\b/;
const DATA_URL_BUDGET = 1048576; // half of Chromium's ~2 MiB URL ceiling (E2)

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-view-tpn-'));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function requireBuilt(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${filePath} is missing -- run \`npm run build\` first`);
  }
}

function readBuilt(filePath: string): string {
  requireBuilt(filePath);
  return fs.readFileSync(filePath, 'utf8');
}

function runCli(args: string[]) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return spawnSync(process.execPath, [script, ...args], { cwd: repoRoot, encoding: 'utf8', env });
}

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  version: string;
  scripts: Record<string, string>;
};

function notices() {
  return ThirdPartyNoticesSchema.parse(JSON.parse(readBuilt(thirdPartyNoticesPathFor(distMainDir))));
}

describe('#170 single source of truth, proven from dist/', () => {
  it('dist/LICENSE (via licensePathFor) is byte-equal to the repo LICENSE', () => {
    const shipped = licensePathFor(distMainDir);
    requireBuilt(shipped);
    expect(fs.readFileSync(shipped).equals(fs.readFileSync(path.join(repoRoot, 'LICENSE')))).toBe(true);
  });

  it('the copyright line parsed from dist/LICENSE equals the one parsed from LICENSE', () => {
    expect(parseCopyrightLine(readBuilt(licensePathFor(distMainDir)))).toBe(
      parseCopyrightLine(fs.readFileSync(path.join(repoRoot, 'LICENSE'), 'utf8'))
    );
  });

  it('packageJsonPathFor(dist/main) is the package.json electron-builder ships', () => {
    expect(path.normalize(packageJsonPathFor(distMainDir))).toBe(path.join(repoRoot, 'package.json'));
  });

  it.each(['aboutWindow.js', 'thirdPartyNotices.js'])('dist/main/%s holds no year and no version literal', (file) => {
    const text = readBuilt(path.join(distMainDir, file));
    expect(text).not.toMatch(YEAR);
    expect(text).not.toContain(pkg.version);
  });

  it('the onOpenAbout region of dist/main/index.js holds no year and no version literal', () => {
    const text = readBuilt(path.join(distMainDir, 'index.js'));
    const begin = text.indexOf('md-view:about-window:begin');
    const end = text.indexOf('md-view:about-window:end');
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
    const region = text.slice(begin, end);
    expect(region).toContain('function onOpenAbout');
    expect(region).not.toMatch(YEAR);
    expect(region).not.toContain(pkg.version);
  });
});

describe('#173/#176 dist/third-party-notices.json', () => {
  it("parses under the app's reader schema (writer/reader contract)", () => {
    expect(() => notices()).not.toThrow();
  });

  it('its name@version set equals the shipped package closure computed from the lockfile', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
    // Roots derived independently of the generator's BUILD_COPIED_PACKAGES
    // constant: runtime dependencies + every node_modules source the build
    // script actually copies.
    const roots = [...new Set([...Object.keys(pkg.dependencies), ...extractCopiedPackages(pkg.scripts.build)])].sort();
    expect(roots).toEqual(shippedRoots(pkg));
    const expected = (computeShippedClosure(lock, roots) as Array<{ name: string; version: string }>)
      .map((e) => `${e.name}@${e.version}`)
      .sort();
    const actual = notices().packages.map((p) => `${p.name}@${p.version}`).sort();
    expect(actual).toEqual(expected);
  });

  it('every entry has at least one non-empty license text', () => {
    for (const p of notices().packages) {
      expect(p.licenseFiles.some((f) => f.text.trim() !== ''), `${p.name}@${p.version}`).toBe(true);
    }
  });

  it('dompurify records chosenLicense Apache-2.0 with its declared expression', () => {
    const dompurify = notices().packages.find((p) => p.name === 'dompurify');
    expect(dompurify?.chosenLicense).toBe('Apache-2.0');
    expect(dompurify?.license).toBe('(MPL-2.0 OR Apache-2.0)');
  });

  it("es-toolkit carries its NOTICE, verbatim", () => {
    const esToolkit = notices().packages.find((p) => p.name === 'es-toolkit');
    const notice = esToolkit?.noticeFiles.find((f) => f.file === 'NOTICE');
    expect(notice?.text).toBe(fs.readFileSync(path.join(repoRoot, 'node_modules', 'es-toolkit', 'NOTICE'), 'utf8'));
  });

  it('the three overrides carry pinned citations', () => {
    const byName = new Map(notices().packages.map((p) => [`${p.name}@${p.version}`, p]));
    for (const key of ['khroma@2.1.0', 'fastdom@1.0.12', 'strictdom@1.0.1']) {
      expect(byName.get(key)?.citation?.url, key).toMatch(/^https:\/\/github\.com\/.+\/blob\/[0-9a-f]{40}\//);
    }
    expect(byName.get('khroma@2.1.0')?.source).toBe('package');
    expect(byName.get('fastdom@1.0.12')?.source).toBe('override');
    expect(byName.get('strictdom@1.0.1')?.source).toBe('override');
  });

  it('two CLI runs into two temp dirs are byte-identical, and both equal dist/', () => {
    const a = path.join(tempDir(), 'a.json');
    const b = path.join(tempDir(), 'b.json');
    const runA = runCli(['--out', a]);
    const runB = runCli(['--out', b]);
    expect(runA.status, runA.stderr).toBe(0);
    expect(runB.status, runB.stderr).toBe(0);
    const shipped = fs.readFileSync(thirdPartyNoticesPathFor(distMainDir));
    expect(fs.readFileSync(a).equals(fs.readFileSync(b))).toBe(true);
    expect(fs.readFileSync(a).equals(shipped)).toBe(true);
  });
});

describe('CLI fails closed', () => {
  it('with the khroma override removed: exits non-zero, names khroma@2.1.0, writes nothing', () => {
    const overridesDir = tempDir();
    const source = path.join(repoRoot, 'build', 'third-party');
    for (const f of fs.readdirSync(source)) fs.copyFileSync(path.join(source, f), path.join(overridesDir, f));
    const overrides = JSON.parse(fs.readFileSync(path.join(overridesDir, 'overrides.json'), 'utf8'));
    delete overrides['khroma@2.1.0'];
    fs.writeFileSync(path.join(overridesDir, 'overrides.json'), JSON.stringify(overrides, null, 2));
    const out = path.join(tempDir(), 'out.json');

    const run = runCli(['--overrides-dir', overridesDir, '--out', out]);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('khroma@2.1.0');
    expect(fs.existsSync(out)).toBe(false);
  });
});

describe('#177 About document size budget', () => {
  it(`the About data: URL built from the dist/ inputs is shorter than ${DATA_URL_BUDGET} characters`, () => {
    const renderer = path.join(repoRoot, 'dist', 'renderer');
    const cssText = ['app.css', 'github-markdown-light.css', 'github.css']
      .map((f) => readBuilt(path.join(renderer, f)))
      .join('\n');
    const html = buildAboutDocument({
      packageJsonText: fs.readFileSync(packageJsonPathFor(distMainDir), 'utf8'),
      licenseText: readBuilt(licensePathFor(distMainDir)),
      noticesText: readBuilt(thirdPartyNoticesPathFor(distMainDir)),
      cssText,
      version: pkg.version,
      runtime: { electron: '999.999.999', chrome: '999.999.9999.999', node: '999.999.999' },
    });
    const length = staticHtmlDataUrl(html).length;
    expect(length).toBeGreaterThan(100000); // sanity: the notices really are in it
    expect(length).toBeLessThan(DATA_URL_BUDGET);
  });
});

describe('D3 content guard: static-window Markdown renders with no style= and no <img', () => {
  // The compiled renderer (dist/main/markdown.js), same html:false options the app uses.
  function markdownToHtml(source: string): string {
    const compiled = path.join(distMainDir, 'markdown.js');
    requireBuilt(compiled);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require(compiled) as { markdownToHtml: (s: string) => string }).markdownToHtml(source);
  }

  function assertCspClean(html: string, label: string): void {
    expect(html, label).not.toMatch(/\sstyle=/);
    expect(html, label).not.toMatch(/<img/i);
  }

  it('dist/main/help/help.md', () => {
    assertCspClean(markdownToHtml(readBuilt(path.join(distMainDir, 'help', 'help.md'))), 'help.md');
  });

  it('every section of dist/CHANGELOG.md', () => {
    const changelog = readBuilt(path.join(repoRoot, 'dist', 'CHANGELOG.md'));
    const sections = changelog.split(/^(?=## )/m);
    expect(sections.length).toBeGreaterThan(1);
    for (const section of sections) {
      assertCspClean(markdownToHtml(section), section.split(/\r?\n/)[0]);
    }
  });
});
