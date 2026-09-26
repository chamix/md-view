import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Task 45 built-output proof (functional_domain.md #161, #167, #160; same
// posture as dist-changelog.test.ts / #143): electron-builder ships only
// dist/**/*, so the Mermaid bundle, the diagram pass and the CSP must be
// proven from dist/, not the source tree. Requires `npm run build` first.
const repoRoot = path.resolve(__dirname, '../..');
const distRenderer = path.join(repoRoot, 'dist', 'renderer');

const EXPECTED_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file: data: http: https:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self' file:";

// The runtime `dependencies` exactly as of Task 44 (main @ 8e80fa0). Task 45
// must leave it unchanged: electron-builder packs production dependencies into
// app.asar, and mermaid is only a build-time source for the copied
// dist/renderer/mermaid.min.js (review B3: 12.1 MB -> 142.8 MB otherwise).
const TASK44_DEPENDENCIES: Record<string, string> = {
  chokidar: '^4.0.1',
  'github-markdown-css': '^5.8.1',
  'highlight.js': '^11.11.1',
  'markdown-it': '^14.1.0',
  zod: '^3.23.8',
};

function requireBuilt(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${filePath} is missing -- run \`npm run build\` first`);
  }
}

function readPackageJson(file: string): {
  version: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('Task 45: built dist/ ships the Mermaid bundle, the diagram pass and the CSP', () => {
  it('dist/renderer/mermaid.min.js is byte-equal to node_modules/mermaid/dist/mermaid.min.js (#161)', () => {
    const shipped = path.join(distRenderer, 'mermaid.min.js');
    requireBuilt(shipped);
    const source = fs.readFileSync(path.join(repoRoot, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'));
    expect(fs.readFileSync(shipped).equals(source)).toBe(true);
  });

  it('the installed mermaid is exactly 11.17.2', () => {
    expect(readPackageJson(path.join(repoRoot, 'node_modules', 'mermaid', 'package.json')).version).toBe('11.17.2');
  });

  it('package.json pins mermaid as a devDependency, exactly "11.17.2" (no ^ or ~) (#167 as amended)', () => {
    const pkg = readPackageJson(path.join(repoRoot, 'package.json'));
    expect(pkg.devDependencies.mermaid).toBe('11.17.2');
    expect(Object.prototype.hasOwnProperty.call(pkg.dependencies, 'mermaid')).toBe(false);
  });

  it('runtime dependencies are unchanged relative to Task 44 (nothing new packed into app.asar)', () => {
    expect(readPackageJson(path.join(repoRoot, 'package.json')).dependencies).toEqual(TASK44_DEPENDENCIES);
  });

  it('dist/renderer/diagrams.js is byte-equal to src/renderer/diagrams.js', () => {
    const shipped = path.join(distRenderer, 'diagrams.js');
    requireBuilt(shipped);
    expect(fs.readFileSync(shipped, 'utf8')).toBe(
      fs.readFileSync(path.join(repoRoot, 'src', 'renderer', 'diagrams.js'), 'utf8')
    );
  });

  describe('dist/renderer/index.html', () => {
    const indexPath = path.join(distRenderer, 'index.html');

    function readIndex(): string {
      requireBuilt(indexPath);
      return fs.readFileSync(indexPath, 'utf8');
    }

    it('has exactly one CSP meta whose content equals the approved string (#160)', () => {
      const metas = readIndex().match(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/g) ?? [];
      expect(metas).toHaveLength(1);
      const content = metas[0].match(/content="([^"]*)"/)?.[1];
      expect(content).toBe(EXPECTED_CSP);
    });

    it('the CSP meta is the first element after <meta charset>, before <base>, every <link> and every <script>', () => {
      const html = readIndex();
      const tags = [...html.matchAll(/<(meta|base|link|script|title)\b[^>]*>/g)].map((m) => m[0]);
      expect(tags[0]).toMatch(/^<meta charset=/i);
      expect(tags[1]).toMatch(/^<meta http-equiv="Content-Security-Policy"/);
      const cspIndex = html.indexOf('http-equiv="Content-Security-Policy"');
      for (const marker of ['<base', '<link', '<script']) {
        expect(html.indexOf(marker)).toBeGreaterThan(cspIndex);
      }
    });

    it('loads diagrams.js before renderer.js and never references mermaid.min.js statically (D1)', () => {
      const html = readIndex();
      const diagrams = html.indexOf('<script src="./diagrams.js"></script>');
      const renderer = html.indexOf('<script src="./renderer.js"></script>');
      expect(diagrams).toBeGreaterThan(-1);
      expect(renderer).toBeGreaterThan(diagrams);
      expect(html).not.toContain('mermaid.min.js');
    });
  });
});
