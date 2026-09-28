import { z } from 'zod';
import { escapeHtml } from './helpWindow';

// Task 46 (#173-#177): the reader side of scripts/third-party-notices.mjs's
// output contract (dist/third-party-notices.json). main validates the shipped
// file with this schema before rendering it; a dist integration test parses
// the real build output with it, proving writer and reader agree.
const NoticeFileSchema = z
  .object({
    file: z.string().min(1),
    text: z.string(),
  })
  .strict();

const CitationSchema = z
  .object({
    url: z.string().min(1),
    ref: z.string().min(1),
  })
  .strict();

export const NoticePackageSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    license: z.string().min(1),
    chosenLicense: z.string().min(1),
    source: z.enum(['package', 'override']),
    citation: CitationSchema.nullable(),
    licenseFiles: z.array(NoticeFileSchema).min(1),
    noticeFiles: z.array(NoticeFileSchema),
  })
  .strict();

export const ThirdPartyNoticesSchema = z
  .object({
    schemaVersion: z.literal(1),
    packages: z.array(NoticePackageSchema),
  })
  .strict();

export type NoticePackage = z.infer<typeof NoticePackageSchema>;
export type ThirdPartyNotices = z.infer<typeof ThirdPartyNoticesSchema>;

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function renderFiles(files: NoticePackage['licenseFiles']): string {
  return files
    .map((f) => `<p class="notice-file"><code>${escapeHtml(f.file)}</code></p>\n<pre>${escapeHtml(f.text)}</pre>`)
    .join('\n');
}

function renderPackage(p: NoticePackage): string {
  const parts: string[] = [];
  if (p.license !== p.chosenLicense) {
    parts.push(`<p>Declared license: <code>${escapeHtml(p.license)}</code>; used under <code>${escapeHtml(p.chosenLicense)}</code>.</p>`);
  }
  if (p.citation !== null) {
    const url = escapeHtml(p.citation.url);
    const link = isHttpsUrl(p.citation.url) ? `<a href="${url}">${url}</a>` : url;
    parts.push(`<p>License text source: ${link} (${escapeHtml(p.citation.ref)})</p>`);
  }
  parts.push(renderFiles(p.licenseFiles));
  if (p.noticeFiles.length > 0) parts.push(renderFiles(p.noticeFiles));
  return `<details class="notice-package">
<summary>${escapeHtml(p.name)} ${escapeHtml(p.version)} — ${escapeHtml(p.chosenLicense)}</summary>
${parts.join('\n')}
</details>`;
}

// Nested native disclosure widgets: readable with no script, no new link
// surface and no new window (#177, D2). Every value is escaped (#171).
export function renderNoticesHtml(notices: ThirdPartyNotices): string {
  const count = notices.packages.length;
  return `<details class="third-party-notices">
<summary>Third-party notices (${count} ${count === 1 ? 'package' : 'packages'})</summary>
${notices.packages.map(renderPackage).join('\n')}
</details>`;
}
