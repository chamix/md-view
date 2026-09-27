import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  LICENSE_ALLOWLIST,
  BUILD_COPIED_PACKAGES,
  extractCopiedPackages,
  shippedRoots,
  computeShippedClosure,
  evaluateLicense,
  selectLicenseFiles,
  selectNoticeFiles,
  applyOverrides,
  validateOverrides,
  compareEntries,
  buildNoticeSet,
  serializeNoticeSet,
} from '../../scripts/third-party-notices.mjs';
import { ThirdPartyNoticesSchema } from '../../src/main/thirdPartyNotices';

// Task 46 (#173-#176): the generator's pure core, proven without touching the
// filesystem except for reading the real lockfile / package.json as inputs.
const repoRoot = path.resolve(__dirname, '../..');
const realPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const realLock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));

type Entry = { name: string; version: string; path: string };
const keys = (entries: Entry[]) => entries.map((e) => `${e.name}@${e.version}`);

function lock(packages: Record<string, unknown>) {
  return { lockfileVersion: 3, packages: { '': { name: 'root' }, ...packages } };
}

describe('computeShippedClosure over the real lockfile (#173)', () => {
  const closure = computeShippedClosure(realLock, shippedRoots(realPkg)) as Entry[];
  const names = new Set(closure.map((e) => e.name));
  const ids = new Set(keys(closure));

  it('has exactly 125 packages', () => {
    expect(closure).toHaveLength(125);
  });

  it("includes mermaid's transitive dependencies (dompurify, nested d3-array@2.12.1 and top-level d3-array@3.x)", () => {
    expect(names.has('dompurify')).toBe(true);
    expect(ids.has('d3-array@2.12.1')).toBe(true);
    expect(closure.some((e) => e.name === 'd3-array' && e.version.startsWith('3.'))).toBe(true);
  });

  it('includes @types/trusted-types through the optional edge from dompurify', () => {
    expect(names.has('@types/trusted-types')).toBe(true);
  });

  it('excludes pure devDependencies (vitest, electron-builder, typescript)', () => {
    for (const dev of ['vitest', 'electron-builder', 'typescript']) {
      expect(names.has(dev)).toBe(false);
    }
  });

  it('is deduplicated by name@version', () => {
    expect(ids.size).toBe(closure.length);
  });
});

describe('computeShippedClosure over synthetic lockfiles (#173)', () => {
  it('resolves a nested version that shadows the top-level one, walking up node_modules levels', () => {
    const l = lock({
      'node_modules/a': { version: '1.0.0', dependencies: { b: '^2', c: '^1' } },
      'node_modules/a/node_modules/b': { version: '2.0.0' },
      'node_modules/a/node_modules/c': { version: '1.0.0', dependencies: { b: '^2' } },
      'node_modules/b': { version: '1.0.0' },
    });
    expect(keys(computeShippedClosure(l, ['a']))).toEqual(['a@1.0.0', 'b@2.0.0', 'c@1.0.0']);
  });

  it('resolves a scoped package name nested under another package', () => {
    const l = lock({
      'node_modules/a': { version: '1.0.0', dependencies: { '@s/x': '^1' } },
      'node_modules/a/node_modules/@s/x': { version: '1.2.0', dependencies: { y: '^1' } },
      'node_modules/y': { version: '1.0.0' },
    });
    expect(keys(computeShippedClosure(l, ['a']))).toEqual(['@s/x@1.2.0', 'a@1.0.0', 'y@1.0.0']);
  });

  it('throws when a required dependency cannot be resolved, naming it', () => {
    const l = lock({ 'node_modules/a': { version: '1.0.0', dependencies: { missing: '^1' } } });
    expect(() => computeShippedClosure(l, ['a'])).toThrow(/missing/);
  });

  it('throws when a root is not installed', () => {
    expect(() => computeShippedClosure(lock({}), ['nope'])).toThrow(/nope/);
  });

  it('skips an unresolvable optional dependency', () => {
    const l = lock({ 'node_modules/a': { version: '1.0.0', optionalDependencies: { gone: '^1' } } });
    expect(keys(computeShippedClosure(l, ['a']))).toEqual(['a@1.0.0']);
  });

  it('follows an installed optional dependency', () => {
    const l = lock({
      'node_modules/a': { version: '1.0.0', optionalDependencies: { o: '^1' } },
      'node_modules/o': { version: '1.0.0', optional: true },
    });
    expect(keys(computeShippedClosure(l, ['a']))).toEqual(['a@1.0.0', 'o@1.0.0']);
  });

  it('follows a non-optional peer dependency', () => {
    const l = lock({
      'node_modules/a': { version: '1.0.0', peerDependencies: { p: '*' } },
      'node_modules/p': { version: '3.0.0' },
    });
    expect(keys(computeShippedClosure(l, ['a']))).toEqual(['a@1.0.0', 'p@3.0.0']);
  });

  it('does not require an optional peer dependency', () => {
    const l = lock({
      'node_modules/a': {
        version: '1.0.0',
        peerDependencies: { p: '*' },
        peerDependenciesMeta: { p: { optional: true } },
      },
    });
    expect(keys(computeShippedClosure(l, ['a']))).toEqual(['a@1.0.0']);
  });

  it('throws on a link: true entry', () => {
    const l = lock({ 'node_modules/a': { resolved: 'packages/a', link: true } });
    expect(() => computeShippedClosure(l, ['a'])).toThrow(/link/);
  });

  it('terminates on dependency cycles', () => {
    const l = lock({
      'node_modules/a': { version: '1.0.0', dependencies: { b: '*' } },
      'node_modules/b': { version: '1.0.0', dependencies: { a: '*' } },
    });
    expect(keys(computeShippedClosure(l, ['a']))).toEqual(['a@1.0.0', 'b@1.0.0']);
  });
});

describe('root sync: BUILD_COPIED_PACKAGES mirrors the build script', () => {
  it('extractCopiedPackages(package.json build script) equals BUILD_COPIED_PACKAGES', () => {
    expect(extractCopiedPackages(realPkg.scripts.build)).toEqual([...BUILD_COPIED_PACKAGES].sort());
  });

  it('extracts scoped and unscoped node_modules source paths, deduplicated and sorted', () => {
    const script =
      "copyFileSync('node_modules/zeta/a.css','x');copyFileSync('node_modules/@s/p/b.js','y');copyFileSync('node_modules/zeta/c.css','z')";
    expect(extractCopiedPackages(script)).toEqual(['@s/p', 'zeta']);
  });

  it('shippedRoots is the union of runtime dependencies and copied packages', () => {
    const roots = shippedRoots({ dependencies: { b: '1', a: '1', 'highlight.js': '1' } });
    expect(roots).toEqual([...new Set(['a', 'b', ...BUILD_COPIED_PACKAGES])].sort());
  });
});

describe('evaluateLicense (#174)', () => {
  it.each(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'Python-2.0', 'Unlicense'])(
    'allows %s',
    (id) => {
      expect(evaluateLicense(id, LICENSE_ALLOWLIST)).toEqual({ ok: true, chosen: id });
    }
  );

  it('the allowlist contains no copyleft license and not MPL-2.0', () => {
    for (const id of LICENSE_ALLOWLIST as string[]) {
      expect(id).not.toMatch(/GPL|SSPL|MPL/);
    }
  });

  it.each(['GPL-3.0-only', 'LGPL-2.1', 'AGPL-3.0', 'SSPL-1.0', 'MPL-2.0'])('rejects %s', (id) => {
    const result = evaluateLicense(id, LICENSE_ALLOWLIST);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not in the allowlist/);
  });

  it('(MPL-2.0 OR Apache-2.0) passes with chosen Apache-2.0', () => {
    expect(evaluateLicense('(MPL-2.0 OR Apache-2.0)', LICENSE_ALLOWLIST)).toEqual({ ok: true, chosen: 'Apache-2.0' });
  });

  it('(Apache-2.0 OR MIT) chooses MIT: the first passing alternative in allowlist order', () => {
    expect(evaluateLicense('(Apache-2.0 OR MIT)', LICENSE_ALLOWLIST)).toEqual({ ok: true, chosen: 'MIT' });
    expect(evaluateLicense('(MIT OR Apache-2.0)', LICENSE_ALLOWLIST)).toEqual({ ok: true, chosen: 'MIT' });
  });

  it('MIT AND ISC passes; MIT AND GPL-3.0 fails', () => {
    expect(evaluateLicense('MIT AND ISC', LICENSE_ALLOWLIST)).toEqual({ ok: true, chosen: 'MIT AND ISC' });
    expect(evaluateLicense('MIT AND GPL-3.0', LICENSE_ALLOWLIST).ok).toBe(false);
  });

  it('AND binds tighter than OR', () => {
    // GPL-3.0 AND MIT fails, the other alternative ISC passes.
    expect(evaluateLicense('GPL-3.0 AND MIT OR ISC', LICENSE_ALLOWLIST)).toEqual({ ok: true, chosen: 'ISC' });
  });

  it.each([
    ['Apache-2.0 WITH LLVM-exception', /WITH/],
    ['GPL-2.0+', /\+/],
    ['LicenseRef-x', /LicenseRef/],
    ['SEE LICENSE IN LICENSE.txt', /SEE LICENSE IN/],
    ['', /missing/],
    [undefined, /missing/],
    [{ type: 'MIT' }, /legacy/],
    [['MIT'], /legacy/],
    ['(MIT', /parse/],
    ['MIT OR', /parse/],
  ])('fails %j with a named error', (expr, message) => {
    const result = evaluateLicense(expr, LICENSE_ALLOWLIST);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(message);
  });
});

describe('license / NOTICE file selection (#175)', () => {
  it('selects every license-file variant and excludes scripts, sorted by name', () => {
    const files = ['LICENSE-MPL', 'license-update.mjs', 'README.md', 'LICENSE', 'license', 'LICENSE-MIT.txt', 'LICENSE.md', 'COPYING', 'package.json'];
    expect(selectLicenseFiles(files)).toEqual(['COPYING', 'LICENSE', 'LICENSE-MIT.txt', 'LICENSE-MPL', 'LICENSE.md', 'license']);
  });

  it('selects NOTICE files only', () => {
    expect(selectNoticeFiles(['NOTICE', 'notice.txt', 'NOTICE.md', 'LICENSE', 'notices.js'])).toEqual([
      'NOTICE',
      'NOTICE.md',
      'notice.txt',
    ]);
  });
});

const GOOD_URL = 'https://github.com/o/r/blob/0123456789abcdef0123456789abcdef01234567/README.md#license';

function fact(overrides: Record<string, unknown> = {}) {
  return {
    name: 'p',
    version: '1.0.0',
    license: 'MIT',
    installed: { version: '1.0.0', license: 'MIT' },
    fileNames: ['LICENSE', 'package.json'],
    texts: { LICENSE: 'MIT text' } as Record<string, string>,
    ...overrides,
  };
}

function override(overrides: Record<string, unknown> = {}) {
  return {
    license: 'MIT',
    text: 'p@1.0.0.txt',
    reason: 'test',
    citation: { url: GOOD_URL, ref: '0123456789abcdef0123456789abcdef01234567' },
    verify: { file: 'README.md', mode: 'contains' },
    ...overrides,
  };
}

describe('override rules (#175)', () => {
  it('rule 1: a package with no license field and no override fails, naming it', () => {
    const { violations } = buildNoticeSet({
      packages: [fact({ license: undefined, installed: { version: '1.0.0' } })],
      overrides: {},
      overrideTexts: {},
    });
    expect(violations.join('\n')).toMatch(/p@1\.0\.0/);
  });

  it('rule 1: a package with no license file and no override fails, naming it', () => {
    const { violations } = buildNoticeSet({
      packages: [fact({ fileNames: ['README.md'], texts: {} })],
      overrides: {},
      overrideTexts: {},
    });
    expect(violations.join('\n')).toMatch(/p@1\.0\.0.*no license file/);
  });

  it('rule 2: an "equals" override whose text differs from the package file fails', () => {
    const result = applyOverrides(
      fact({ license: undefined, installed: { version: '1.0.0' }, fileNames: ['license'], texts: { license: 'A\n' } }),
      override({ verify: { file: 'license', mode: 'equals' } }),
      'B\n'
    );
    expect(result.violations.join('\n')).toMatch(/does not match/);
  });

  it('rule 2: "equals" compares EOL-normalized text', () => {
    const result = applyOverrides(
      fact({ license: undefined, installed: { version: '1.0.0' }, fileNames: ['license'], texts: { license: 'A\r\nB\r\n' } }),
      override({ verify: { file: 'license', mode: 'equals' } }),
      'A\nB\n'
    );
    expect(result.violations).toEqual([]);
  });

  it('rule 2: a "contains" override not found in the named file fails', () => {
    const result = applyOverrides(
      fact({ fileNames: ['README.md'], texts: { 'README.md': '# p\n## License\nMIT, by someone\n' } }),
      override(),
      'MIT, by someone else\n'
    );
    expect(result.violations.join('\n')).toMatch(/does not match/);
  });

  it('rule 3: a stale override key fails', () => {
    expect(validateOverrides({ 'gone@1.0.0': override() }, new Set(['p@1.0.0'])).join('\n')).toMatch(
      /gone@1\.0\.0.*stale/
    );
  });

  it('rule 4: a branch-URL citation fails (a pinned 40-hex commit is required)', () => {
    const bad = override({ citation: { url: 'https://github.com/o/r/blob/main/README.md', ref: 'main' } });
    expect(validateOverrides({ 'p@1.0.0': bad }, new Set(['p@1.0.0'])).join('\n')).toMatch(/citation/);
  });

  it('rule 5: an override license outside the allowlist fails', () => {
    expect(validateOverrides({ 'p@1.0.0': override({ license: 'GPL-3.0-only' }) }, new Set(['p@1.0.0'])).join('\n')).toMatch(
      /GPL-3\.0-only/
    );
  });

  it('rule 5: an override license that contradicts a declared license fails', () => {
    const result = applyOverrides(
      fact({ fileNames: ['README.md'], texts: { 'README.md': 'x ISC y' } }),
      override({ license: 'ISC' }),
      'ISC'
    );
    expect(result.violations.join('\n')).toMatch(/contradicts/);
  });

  it('rule 6: a package without a license file takes the override text, recording source and citation', () => {
    const result = applyOverrides(
      fact({ fileNames: ['README.md'], texts: { 'README.md': 'intro\n(The MIT License)\r\nCopyright\n' } }),
      override(),
      '(The MIT License)\nCopyright\n'
    );
    expect(result.violations).toEqual([]);
    expect(result.source).toBe('override');
    expect(result.citation).toEqual(override().citation);
    expect(result.licenseFiles).toEqual([{ file: 'p@1.0.0.txt', text: '(The MIT License)\nCopyright\n' }]);
  });

  it("rule 6: a package that ships a license file keeps its own file; the override supplies id and citation", () => {
    const result = applyOverrides(
      fact({ license: undefined, installed: { version: '1.0.0' }, fileNames: ['license'], texts: { license: 'own\n' } }),
      override({ verify: { file: 'license', mode: 'equals' } }),
      'own\n'
    );
    expect(result.violations).toEqual([]);
    expect(result.source).toBe('package');
    expect(result.license).toBe('MIT');
    expect(result.citation).toEqual(override().citation);
    expect(result.licenseFiles).toEqual([{ file: 'license', text: 'own\n' }]);
  });

  it('fails on an installed version that disagrees with the lockfile (stale install)', () => {
    const { violations } = buildNoticeSet({
      packages: [fact({ installed: { version: '0.9.0', license: 'MIT' } })],
      overrides: {},
      overrideTexts: {},
    });
    expect(violations.join('\n')).toMatch(/installed version 0\.9\.0/);
  });

  it('lists EVERY violation, not just the first', () => {
    const { violations, noticeSet } = buildNoticeSet({
      packages: [fact({ name: 'a', license: 'GPL-3.0-only', installed: { version: '1.0.0', license: 'GPL-3.0-only' } }), fact({ name: 'b', fileNames: [], texts: {} })],
      overrides: {},
      overrideTexts: {},
    });
    expect(noticeSet).toBeNull();
    expect(violations.some((v: string) => v.startsWith('a@1.0.0'))).toBe(true);
    expect(violations.some((v: string) => v.startsWith('b@1.0.0'))).toBe(true);
  });
});

describe('buildNoticeSet determinism and shape (#176)', () => {
  const packages = [
    fact({ name: 'd3-array', version: '3.2.4', installed: { version: '3.2.4', license: 'ISC' }, license: 'ISC' }),
    fact({ name: 'd3-array', version: '2.12.1', installed: { version: '2.12.1', license: 'BSD-3-Clause' }, license: 'BSD-3-Clause' }),
    fact({ name: 'zed', version: '10.0.0', installed: { version: '10.0.0', license: 'MIT' } }),
    fact({ name: 'zed', version: '9.0.0', installed: { version: '9.0.0', license: 'MIT' } }),
    fact({ name: 'Zeta', version: '1.0.0' }),
    fact({ name: '@types/x', version: '1.0.0' }),
    fact({
      name: 'dual',
      version: '1.0.0',
      license: '(MPL-2.0 OR Apache-2.0)',
      installed: { version: '1.0.0', license: '(MPL-2.0 OR Apache-2.0)' },
      fileNames: ['NOTICE', 'LICENSE-MPL', 'LICENSE'],
      texts: { LICENSE: 'apache', 'LICENSE-MPL': 'mpl', NOTICE: '﻿notice' },
    }),
  ];

  function run(list: typeof packages) {
    const { noticeSet, violations } = buildNoticeSet({ packages: list, overrides: {}, overrideTexts: {} });
    expect(violations).toEqual([]);
    return noticeSet;
  }

  it('is identical for shuffled inputs', () => {
    const a = serializeNoticeSet(run(packages));
    const b = serializeNoticeSet(run([...packages].reverse()));
    const c = serializeNoticeSet(run([packages[3], packages[0], packages[6], packages[5], packages[1], packages[4], packages[2]]));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('sorts by name in code-unit order, then numeric version', () => {
    const order = run([...packages].reverse()).packages.map((p: { name: string; version: string }) => `${p.name}@${p.version}`);
    expect(order).toEqual([
      '@types/x@1.0.0',
      'Zeta@1.0.0',
      'd3-array@2.12.1',
      'd3-array@3.2.4',
      'dual@1.0.0',
      'zed@9.0.0',
      'zed@10.0.0',
    ]);
  });

  it('uses code-unit order where it DISAGREES with localeCompare (@types/x < Zeta < alpha)', () => {
    // Guard that the fixture really discriminates: locale order puts alpha before Zeta.
    expect('alpha'.localeCompare('Zeta')).toBeLessThan(0);

    const entries = [
      { name: 'alpha', version: '1.0.0' },
      { name: 'Zeta', version: '1.0.0' },
      { name: '@types/x', version: '1.0.0' },
    ];
    expect([...entries].sort(compareEntries).map((e) => e.name)).toEqual(['@types/x', 'Zeta', 'alpha']);

    const { noticeSet, violations } = buildNoticeSet({
      packages: entries.map((e) => fact(e)),
      overrides: {},
      overrideTexts: {},
    });
    expect(violations).toEqual([]);
    expect(noticeSet.packages.map((p: { name: string }) => p.name)).toEqual(['@types/x', 'Zeta', 'alpha']);
  });

  it('compareEntries orders numeric versions and falls back to strings for prereleases', () => {
    expect(compareEntries({ name: 'a', version: '1.10.0' }, { name: 'a', version: '1.9.0' })).toBeGreaterThan(0);
    expect(compareEntries({ name: 'a', version: '1.0.0-beta' }, { name: 'a', version: '1.0.0-alpha' })).toBeGreaterThan(0);
    expect(compareEntries({ name: 'a', version: '1.0.0' }, { name: 'a', version: '1.0.0' })).toBe(0);
  });

  it('records the declared expression and the chosen alternative, with every license and NOTICE file', () => {
    const dual = run(packages).packages.find((p: { name: string }) => p.name === 'dual');
    expect(dual).toEqual({
      name: 'dual',
      version: '1.0.0',
      license: '(MPL-2.0 OR Apache-2.0)',
      chosenLicense: 'Apache-2.0',
      source: 'package',
      citation: null,
      licenseFiles: [
        { file: 'LICENSE', text: 'apache' },
        { file: 'LICENSE-MPL', text: 'mpl' },
      ],
      noticeFiles: [{ file: 'NOTICE', text: 'notice' }],
    });
  });

  it('serializes with LF, a trailing newline, fixed top-level keys and no timestamp', () => {
    const text = serializeNoticeSet(run(packages));
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).not.toContain('\r');
    expect(Object.keys(JSON.parse(text))).toEqual(['schemaVersion', 'packages']);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
  });

  it("the output parses under the app's reader schema (writer/reader contract)", () => {
    expect(() => ThirdPartyNoticesSchema.parse(JSON.parse(serializeNoticeSet(run(packages))))).not.toThrow();
  });
});
