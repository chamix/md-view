// Any `## [` heading -- version or Unreleased -- starts a new release section
// (functional_domain.md guardrail #134). `###` and deeper never match: the
// `##` must be followed by whitespace, not another `#`.
const headingPattern = /^##\s+\[([^\]]+)\]/;

// Line-oriented, exact-token extraction (guardrails #132-134). The version is
// only ever compared with `===` against the captured bracket token -- it is
// never interpolated into a RegExp, so `1.1` cannot match `[1.1.0]` and
// metacharacters in `version` are inert. Returns the section body with
// leading/trailing blank lines trimmed ('' if the section is empty), or null
// when no heading matches. First match wins.
export function extractChangelogSection(text: string, version: string): string | null {
  const lines = text.split(/\r?\n/);

  const start = lines.findIndex((line) => headingPattern.exec(line)?.[1] === version);
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (headingPattern.test(lines[i])) {
      end = i;
      break;
    }
  }

  const body = lines.slice(start + 1, end);
  while (body.length > 0 && body[0].trim() === '') body.shift();
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
  return body.join('\n');
}
