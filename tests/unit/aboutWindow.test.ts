import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  shouldCreateAboutWindow,
  parseCopyrightLine,
  repositoryWebUrl,
  AboutPackageSchema,
  buildAboutContentHtml,
  buildAboutDocument,
} from '../../src/main/aboutWindow';
import type { AboutData } from '../../src/main/aboutWindow';
import { renderNoticesHtml } from '../../src/main/thirdPartyNotices';
import type { ThirdPartyNotices } from '../../src/main/thirdPartyNotices';

const repoRoot = path.resolve(__dirname, '../..');
const EVIL = '<script>alert(1)</script>"x';

function about(overrides: Partial<AboutData> = {}): AboutData {
  return {
    name: 'md-view',
    version: '9.8.7',
    description: 'A viewer',
    copyright: 'Copyright (c) Someone',
    license: 'MIT',
    repository: 'git+https://github.com/o/r.git',
    runtime: { electron: '44.0.0', chrome: '152.0.0.0', node: '24.0.0' },
    ...overrides,
  };
}

function notices(overrides: Partial<ThirdPartyNotices['packages'][number]> = {}): ThirdPartyNotices {
  return {
    schemaVersion: 1,
    packages: [
      {
        name: 'pkg',
        version: '1.0.0',
        license: '(MPL-2.0 OR Apache-2.0)',
        chosenLicense: 'Apache-2.0',
        source: 'override',
        citation: { url: 'https://github.com/o/r/blob/0123456789abcdef0123456789abcdef01234567/README.md', ref: 'v1' },
        licenseFiles: [{ file: 'LICENSE', text: 'license text' }],
        noticeFiles: [{ file: 'NOTICE', text: 'notice text' }],
        ...overrides,
      },
    ],
  };
}

// Every double-quoted attribute value must be free of raw < > and ", i.e.
// nothing escaped its attribute; and no element may be injected.
function assertInert(html: string): void {
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toContain('</script');
  for (const m of html.matchAll(/<[a-z]+((?:\s+[a-z-]+="[^"]*")*)\s*>/gi)) {
    expect(m[1]).not.toMatch(/[<>]/);
  }
  const tags = [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase());
  const allowed = new Set(['h1', 'h2', 'p', 'table', 'tbody', 'tr', 'th', 'td', 'a', 'details', 'summary', 'pre', 'code']);
  for (const tag of tags) expect(allowed.has(tag), `unexpected tag <${tag}>`).toBe(true);
}

describe('shouldCreateAboutWindow', () => {
  it('true when there is no window', () => {
    expect(shouldCreateAboutWindow(null)).toBe(true);
  });
  it('true when the window is destroyed', () => {
    expect(shouldCreateAboutWindow({ isDestroyed: () => true })).toBe(true);
  });
  it('false when a live window exists', () => {
    expect(shouldCreateAboutWindow({ isDestroyed: () => false })).toBe(false);
  });
});

describe('parseCopyrightLine', () => {
  it("returns the repo LICENSE's own copyright line (read from the file, never typed)", () => {
    const text = fs.readFileSync(path.join(repoRoot, 'LICENSE'), 'utf8');
    const expected = text.split(/\r?\n/).find((l) => /^\s*Copyright\b/.test(l))?.trim();
    expect(expected).toBeTruthy();
    expect(parseCopyrightLine(text)).toBe(expected);
  });

  it('takes the first Copyright line, trimmed, across CRLF', () => {
    expect(parseCopyrightLine('MIT License\r\n\r\n   Copyright (c) A  \r\nCopyright (c) B\r\n')).toBe('Copyright (c) A');
  });

  it('throws when there is no copyright line', () => {
    expect(() => parseCopyrightLine('MIT License\n\nPermission is hereby granted\n')).toThrow(/copyright/i);
  });
});

describe('repositoryWebUrl', () => {
  it('strips git+ and .git', () => {
    expect(repositoryWebUrl('git+https://github.com/o/x.git')).toBe('https://github.com/o/x');
  });
  it('accepts the object form', () => {
    expect(repositoryWebUrl({ type: 'git', url: 'https://github.com/o/x.git' })).toBe('https://github.com/o/x');
  });
  it('keeps plain http(s) URLs', () => {
    expect(repositoryWebUrl('http://example.com/r')).toBe('http://example.com/r');
  });
  it.each(['ssh://git@github.com/o/x.git', 'git+ssh://git@github.com/o/x.git', 'javascript:alert(1)', 'github:o/x', 'not a url', ''])(
    'gives null for %j',
    (url) => {
      expect(repositoryWebUrl(url)).toBeNull();
    }
  );
  it('gives null for a missing repository', () => {
    expect(repositoryWebUrl(undefined)).toBeNull();
  });
});

describe('AboutPackageSchema', () => {
  it("parses the repo's package.json", () => {
    const pkg = AboutPackageSchema.parse(JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')));
    expect(pkg.name).toBe('md-view');
    expect(pkg.license).toBe('MIT');
  });
  it('rejects a package.json without a name', () => {
    expect(() => AboutPackageSchema.parse({ description: 'x', license: 'MIT' })).toThrow();
  });
});

describe('buildAboutContentHtml (#170, #171)', () => {
  it('shows every About value', () => {
    const html = buildAboutContentHtml(about(), notices());
    for (const value of ['md-view', '9.8.7', 'A viewer', 'Copyright (c) Someone', 'MIT', '44.0.0', '152.0.0.0', '24.0.0']) {
      expect(html).toContain(value);
    }
    expect(html).toContain('<a href="https://github.com/o/r">https://github.com/o/r</a>');
  });

  it('shows a non-http(s) repository as escaped text with no link', () => {
    const html = buildAboutContentHtml(about({ repository: 'javascript:alert("1")' }), notices());
    expect(html).not.toContain('<a href="javascript');
    expect(html).toContain('javascript:alert(&quot;1&quot;)');
  });

  it('every field set to <script>…"x renders inert', () => {
    const evil = about({
      name: EVIL,
      version: EVIL,
      description: EVIL,
      copyright: EVIL,
      license: EVIL,
      repository: `https://github.com/o/${EVIL}`,
      runtime: { electron: EVIL, chrome: EVIL, node: EVIL },
    });
    const html = buildAboutContentHtml(evil, notices());
    assertInert(html);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&quot;x');
  });

  it('notice names, versions, licenses, citations and texts render inert', () => {
    const evilNotices = notices({
      name: EVIL,
      version: EVIL,
      license: EVIL,
      chosenLicense: EVIL + 'y',
      citation: { url: `https://github.com/${EVIL}`, ref: EVIL },
      licenseFiles: [{ file: EVIL, text: EVIL }],
      noticeFiles: [{ file: EVIL, text: EVIL }],
    });
    assertInert(renderNoticesHtml(evilNotices));
    assertInert(buildAboutContentHtml(about(), evilNotices));
  });
});

describe('renderNoticesHtml (#177)', () => {
  it('is an outer <details> whose summary counts the packages, with one inner <details> per package', () => {
    const html = renderNoticesHtml(notices());
    expect(html).toMatch(/^<details[^>]*>\s*<summary>Third-party notices \(1 package\)<\/summary>/);
    expect(html.match(/<details/g)).toHaveLength(2);
    expect(html).toContain('<summary>pkg 1.0.0 — Apache-2.0</summary>');
  });

  it('shows the declared expression when it differs from the chosen license, the citation, and each file in a <pre>', () => {
    const html = renderNoticesHtml(notices());
    expect(html).toContain('(MPL-2.0 OR Apache-2.0)');
    expect(html).toContain('https://github.com/o/r/blob/0123456789abcdef0123456789abcdef01234567/README.md');
    expect(html).toContain('<pre>license text</pre>');
    expect(html).toContain('<pre>notice text</pre>');
  });

  it('omits the declared expression when it equals the chosen one', () => {
    const html = renderNoticesHtml(notices({ license: 'MIT', chosenLicense: 'MIT', citation: null }));
    expect(html).not.toContain('Declared license');
    expect(html).not.toContain('source:');
  });
});

describe('buildAboutDocument (composition of the shipped inputs)', () => {
  const packageJsonText = JSON.stringify({ name: 'md-view', description: 'D', license: 'MIT', repository: 'https://github.com/o/r' });
  const licenseText = 'MIT License\n\nCopyright (c) Someone\n';
  const noticesText = JSON.stringify(notices());

  it('titles the document "About <name>" and embeds the About body in the shared shell', () => {
    const html = buildAboutDocument({
      packageJsonText,
      licenseText,
      noticesText,
      cssText: '.x{}',
      version: '9.8.7',
      runtime: { electron: 'e', chrome: 'c', node: 'n' },
    });
    expect(html).toContain('<title>About md-view</title>');
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain('9.8.7');
    expect(html).toContain('Copyright (c) Someone');
  });

  it('throws on invalid notices (no half-populated legal text)', () => {
    expect(() =>
      buildAboutDocument({
        packageJsonText,
        licenseText,
        noticesText: JSON.stringify({ schemaVersion: 2, packages: [] }),
        cssText: '',
        version: '1',
        runtime: { electron: 'e', chrome: 'c', node: 'n' },
      })
    ).toThrow();
  });
});
