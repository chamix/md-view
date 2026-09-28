import { z } from 'zod';
import type { DestroyableWindow } from './helpWindow';
import { buildHelpHtml, escapeHtml } from './helpWindow';
import { ThirdPartyNoticesSchema, renderNoticesHtml } from './thirdPartyNotices';
import type { ThirdPartyNotices } from './thirdPartyNotices';

// Task 46 (#169-#171, #177): the About window's pure side. Every value comes
// from the shipped inputs (package.json, LICENSE, third-party-notices.json)
// or from the runtime (app.getVersion(), process.versions), bound in index.ts.
// No version or year literal belongs in this file (#170; proven on dist/).

// Same contract as shouldCreateHelpWindow / shouldCreateWhatsNewWindow -- a
// deliberate separate one-liner (third copy; consolidation is a backlog item).
export function shouldCreateAboutWindow(existing: DestroyableWindow | null): boolean {
  return existing === null || existing.isDestroyed();
}

// The shipped package.json fields About reads. Other keys are ignored.
export const AboutPackageSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  license: z.string().min(1),
  repository: z.union([z.string(), z.object({ url: z.string() })]).optional(),
});

export type AboutPackage = z.infer<typeof AboutPackageSchema>;

export interface RuntimeVersions {
  electron: string;
  chrome: string;
  node: string;
}

export interface AboutData {
  name: string;
  version: string;
  description: string;
  copyright: string;
  license: string;
  // As declared in package.json (string or { url }), before normalization.
  repository: string | null;
  runtime: RuntimeVersions;
}

// The first line of the LICENSE text that starts with "Copyright", trimmed.
export function parseCopyrightLine(licenseText: string): string {
  const line = licenseText.split(/\r\n?|\n/).find((l) => /^\s*Copyright\b/.test(l));
  if (line === undefined) {
    throw new Error('LICENSE has no Copyright line');
  }
  return line.trim();
}

function repositoryText(repository: AboutPackage['repository'] | null | undefined): string | null {
  if (repository === undefined || repository === null) return null;
  return typeof repository === 'string' ? repository : repository.url;
}

// npm repository value -> a browsable http(s) URL, or null when it is not one
// after stripping "git+" and ".git" (then no link is rendered).
export function repositoryWebUrl(repository: AboutPackage['repository'] | null | undefined): string | null {
  const raw = repositoryText(repository);
  if (raw === null) return null;
  const candidate = raw.trim().replace(/^git\+/, '').replace(/\.git$/, '');
  try {
    const protocol = new URL(candidate).protocol;
    return protocol === 'http:' || protocol === 'https:' ? candidate : null;
  } catch {
    return null;
  }
}

function row(label: string, valueHtml: string): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${valueHtml}</td></tr>`;
}

// About body fragment. Every interpolated value goes through escapeHtml
// (#171); the only attribute (href) is double-quoted and escaped.
export function buildAboutContentHtml(about: AboutData, notices: ThirdPartyNotices): string {
  const href = repositoryWebUrl(about.repository);
  const repository =
    href !== null
      ? `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`
      : escapeHtml(about.repository ?? '');
  return `<h1>${escapeHtml(about.name)}</h1>
<p>${escapeHtml(about.description)}</p>
<table>
<tbody>
${row('Version', escapeHtml(about.version))}
${row('Copyright', escapeHtml(about.copyright))}
${row('License', escapeHtml(about.license))}
${row('Repository', repository)}
${row('Electron', escapeHtml(about.runtime.electron))}
${row('Chromium', escapeHtml(about.runtime.chrome))}
${row('Node.js', escapeHtml(about.runtime.node))}
</tbody>
</table>
<h2>Third-party software</h2>
${renderNoticesHtml(notices)}`;
}

export interface AboutSources {
  packageJsonText: string;
  licenseText: string;
  noticesText: string;
  cssText: string;
  version: string;
  runtime: RuntimeVersions;
}

// The whole About document from the raw shipped inputs. Pure; shared by
// index.ts (onOpenAbout) and the dist size-budget test (#177), so both build
// exactly the same document. Throws on any invalid input: a broken package
// must show no About window rather than half-populated legal text.
export function buildAboutDocument(sources: AboutSources): string {
  const pkg = AboutPackageSchema.parse(JSON.parse(sources.packageJsonText));
  const notices = ThirdPartyNoticesSchema.parse(JSON.parse(sources.noticesText));
  const about: AboutData = {
    name: pkg.name,
    version: sources.version,
    description: pkg.description,
    copyright: parseCopyrightLine(sources.licenseText),
    license: pkg.license,
    repository: repositoryText(pkg.repository),
    runtime: sources.runtime,
  };
  return buildHelpHtml(buildAboutContentHtml(about, notices), sources.cssText, `About ${pkg.name}`);
}
