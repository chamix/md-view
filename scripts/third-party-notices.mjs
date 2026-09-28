// Task 46 (functional_domain.md #173-#176, ADR-012): generates
// dist/third-party-notices.json -- one entry per third-party package the app
// ships -- and fails the build closed on any license-policy violation.
//
// Zero dependencies. Lives outside src/ so tsc never compiles it into dist/
// and it never ships. Pure core (exported, unit-tested) + a thin IO shell
// (main(), guarded so importing this module has no side effects). The shell
// adapts npm's on-disk layout (lockfile, node_modules, build/third-party)
// into plain values; the core never touches the filesystem.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// ---------------------------------------------------------------------------
// Policy constants
// ---------------------------------------------------------------------------

// Ordered: the order is the preference when an OR expression offers several
// allowed alternatives. No copyleft (GPL, LGPL, AGPL, SSPL); MPL-2.0 is
// deliberately absent (its one user also offers Apache-2.0).
export const LICENSE_ALLOWLIST = Object.freeze([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'Python-2.0',
  'Unlicense',
]);

// Root list (b): every package whose files the `build` script copies from
// node_modules into dist/. Kept in sync with package.json by a unit test
// (extractCopiedPackages), so a new copy step cannot silently skip it.
export const BUILD_COPIED_PACKAGES = Object.freeze(['github-markdown-css', 'highlight.js', 'mermaid']);

export const LICENSE_FILE_PATTERN = /^(licen[cs]e|copying)(-[a-z0-9]+)?(\.(md|txt|markdown))?$/i;
export const NOTICE_FILE_PATTERN = /^notice(\.(md|txt))?$/i;

const PINNED_CITATION_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/blob\/[0-9a-f]{40}\/\S+$/;
const PLAIN_FILE_NAME = /^[^/\\]+$/;

// ---------------------------------------------------------------------------
// Roots and closure (#173)
// ---------------------------------------------------------------------------

export function extractCopiedPackages(buildScript) {
  const found = new Set();
  for (const match of String(buildScript).matchAll(/node_modules\/((?:@[\w.~-]+\/)?[\w.~-]+)\//g)) {
    found.add(match[1]);
  }
  return [...found].sort(compareStrings);
}

export function shippedRoots(packageJson) {
  const runtime = Object.keys(packageJson?.dependencies ?? {});
  return [...new Set([...runtime, ...BUILD_COPIED_PACKAGES])].sort(compareStrings);
}

function packageNameOf(lockPath) {
  const idx = lockPath.lastIndexOf('node_modules/');
  return lockPath.slice(idx + 'node_modules/'.length);
}

// Node's resolution over lockfile paths: <from>/node_modules/<name>, then one
// node_modules level up at a time, down to the top-level node_modules/<name>.
function resolveFrom(packages, fromPath, name) {
  let base = fromPath;
  for (;;) {
    const candidate = (base === '' ? '' : base + '/') + 'node_modules/' + name;
    if (Object.prototype.hasOwnProperty.call(packages, candidate)) return candidate;
    if (base === '') return null;
    const idx = base.lastIndexOf('/node_modules/');
    base = idx === -1 ? '' : base.slice(0, idx);
  }
}

function edgesOf(entry) {
  const edges = [];
  for (const name of Object.keys(entry.dependencies ?? {})) edges.push({ name, optional: false });
  for (const name of Object.keys(entry.optionalDependencies ?? {})) edges.push({ name, optional: true });
  for (const name of Object.keys(entry.peerDependencies ?? {})) {
    if (entry.peerDependenciesMeta?.[name]?.optional === true) continue;
    edges.push({ name, optional: false });
  }
  return edges;
}

// Every package reachable from the roots through dependencies,
// optionalDependencies and non-optional peerDependencies. Unresolvable
// required edges (and link entries) are collected and thrown together, so the
// build fails closed and names every one; unresolvable optional edges are
// skipped (a package that is not installed cannot ship). Deduplicated by
// name@version; nested versions are distinct packages.
export function computeShippedClosure(lock, roots) {
  const packages = lock?.packages ?? {};
  const errors = [];
  const visited = new Set();
  const byKey = new Map();
  const queue = [];

  for (const root of roots) {
    const rootPath = 'node_modules/' + root;
    if (!Object.prototype.hasOwnProperty.call(packages, rootPath)) {
      errors.push(`root "${root}" is not in the lockfile`);
      continue;
    }
    queue.push(rootPath);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    const entry = packages[current];

    if (entry.link === true) {
      errors.push(`"${current}" is a link entry (workspaces are not supported)`);
      continue;
    }

    const name = packageNameOf(current);
    const key = `${name}@${entry.version}`;
    const known = byKey.get(key);
    if (!known || compareStrings(current, known.path) < 0) {
      byKey.set(key, { name, version: entry.version, path: current });
    }

    for (const edge of edgesOf(entry)) {
      const resolved = resolveFrom(packages, current, edge.name);
      if (resolved === null) {
        if (!edge.optional) errors.push(`"${current}" requires "${edge.name}", which is not in the lockfile`);
        continue;
      }
      if (!visited.has(resolved)) queue.push(resolved);
    }
  }

  if (errors.length > 0) {
    throw new Error('cannot compute the shipped package closure:\n  ' + errors.join('\n  '));
  }
  return [...byKey.values()].sort(compareEntries);
}

// ---------------------------------------------------------------------------
// License expressions (#174)
// ---------------------------------------------------------------------------

function tokenize(expr) {
  return expr.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/);
}

function parseExpression(tokens) {
  let pos = 0;
  const fail = (why) => {
    throw new SyntaxError(why);
  };
  function parseOr() {
    const items = [parseAnd()];
    while (tokens[pos] === 'OR') {
      pos++;
      items.push(parseAnd());
    }
    return items.length === 1 ? items[0] : { type: 'or', items };
  }
  function parseAnd() {
    const items = [parseAtom()];
    while (tokens[pos] === 'AND') {
      pos++;
      items.push(parseAtom());
    }
    return items.length === 1 ? items[0] : { type: 'and', items };
  }
  function parseAtom() {
    const token = tokens[pos];
    if (token === undefined) fail('unexpected end of expression');
    if (token === '(') {
      pos++;
      const inner = parseOr();
      if (tokens[pos] !== ')') fail('missing ")"');
      pos++;
      return inner;
    }
    if (token === ')' || token === 'AND' || token === 'OR') fail(`unexpected "${token}"`);
    pos++;
    return { type: 'id', id: token };
  }
  const tree = parseOr();
  if (pos !== tokens.length) fail(`unexpected "${tokens[pos]}"`);
  return tree;
}

function evaluateNode(node, allowlist) {
  if (node.type === 'id') {
    const rank = allowlist.indexOf(node.id);
    return rank === -1
      ? { ok: false, error: `"${node.id}" is not in the allowlist` }
      : { ok: true, chosen: node.id, rank };
  }
  const results = node.items.map((item) => evaluateNode(item, allowlist));
  if (node.type === 'and') {
    const failed = results.find((r) => !r.ok);
    if (failed) return failed;
    return {
      ok: true,
      chosen: results.map((r) => r.chosen).join(' AND '),
      rank: Math.max(...results.map((r) => r.rank)),
    };
  }
  // OR: the passing alternative ranked first in allowlist order (a compound
  // alternative ranks by its least-preferred license); ties keep source order.
  const passing = results.filter((r) => r.ok);
  if (passing.length === 0) return { ok: false, error: results.map((r) => r.error).join('; ') };
  return passing.reduce((best, r) => (r.rank < best.rank ? r : best));
}

export function evaluateLicense(expr, allowlist = LICENSE_ALLOWLIST) {
  if (expr === undefined || expr === null || (typeof expr === 'string' && expr.trim() === '')) {
    return { ok: false, error: 'missing license field' };
  }
  if (typeof expr !== 'string') {
    return { ok: false, error: 'legacy object/array license field is not supported' };
  }
  if (/^\s*SEE LICEN[CS]E IN\b/i.test(expr)) {
    return { ok: false, error: `"SEE LICENSE IN" is not supported: "${expr}"` };
  }
  const tokens = tokenize(expr);
  if (tokens.some((t) => t.toUpperCase() === 'WITH')) {
    return { ok: false, error: `WITH exceptions are not supported: "${expr}"` };
  }
  if (tokens.some((t) => /^LicenseRef-/i.test(t) || /^DocumentRef-/i.test(t))) {
    return { ok: false, error: `LicenseRef identifiers are not supported: "${expr}"` };
  }
  if (tokens.some((t) => t.endsWith('+'))) {
    return { ok: false, error: `"+" (or-later) suffixes are not supported: "${expr}"` };
  }
  let tree;
  try {
    tree = parseExpression(tokens);
  } catch (error) {
    return { ok: false, error: `cannot parse license expression "${expr}": ${error.message}` };
  }
  const result = evaluateNode(tree, allowlist);
  return result.ok ? { ok: true, chosen: result.chosen } : { ok: false, error: `"${expr}": ${result.error}` };
}

// ---------------------------------------------------------------------------
// Files and overrides (#175)
// ---------------------------------------------------------------------------

export function selectLicenseFiles(fileNames) {
  return fileNames.filter((f) => LICENSE_FILE_PATTERN.test(f)).sort(compareStrings);
}

export function selectNoticeFiles(fileNames) {
  return fileNames.filter((f) => NOTICE_FILE_PATTERN.test(f)).sort(compareStrings);
}

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalizeEol(text) {
  return stripBom(text).replace(/\r\n?/g, '\n');
}

export function verifyOverrideText(mode, fileText, overrideText) {
  const file = normalizeEol(fileText);
  const text = normalizeEol(overrideText);
  if (mode === 'equals') return file === text;
  if (mode === 'contains') return text.length > 0 && file.includes(text);
  return false;
}

// Shape and policy of every override entry, independent of any package's
// files: stale keys (rule 3), pinned citation (rule 4), allowlisted id
// (rule 5), and safe file names.
export function validateOverrides(overrides, closureKeys, allowlist = LICENSE_ALLOWLIST) {
  const violations = [];
  for (const key of Object.keys(overrides).sort(compareStrings)) {
    const o = overrides[key] ?? {};
    if (!closureKeys.has(key)) violations.push(`${key}: stale override (not in the shipped package closure)`);
    const policy = evaluateLicense(o.license, allowlist);
    if (!policy.ok) violations.push(`${key}: override license rejected: ${policy.error}`);
    if (typeof o.citation?.url !== 'string' || !PINNED_CITATION_URL.test(o.citation.url)) {
      violations.push(`${key}: override citation.url must be https://github.com/<owner>/<repo>/blob/<40-hex commit>/<file>`);
    }
    if (typeof o.citation?.ref !== 'string' || o.citation.ref.trim() === '') {
      violations.push(`${key}: override citation.ref is missing`);
    }
    if (typeof o.reason !== 'string' || o.reason.trim() === '') violations.push(`${key}: override reason is missing`);
    if (typeof o.text !== 'string' || !PLAIN_FILE_NAME.test(o.text)) {
      violations.push(`${key}: override text must be a plain file name in the overrides directory`);
    }
    if (!['equals', 'contains'].includes(o.verify?.mode) || typeof o.verify?.file !== 'string' || !PLAIN_FILE_NAME.test(o.verify.file)) {
      violations.push(`${key}: override verify must be { file: <plain file name>, mode: "equals" | "contains" }`);
    }
  }
  return violations;
}

// Resolves one package's license id, text source and citation, applying its
// override (if any) under rules 1, 2, 5 and 6.
export function applyOverrides(fact, override, overrideText) {
  const key = `${fact.name}@${fact.version}`;
  const violations = [];
  const declared = typeof fact.license === 'string' && fact.license.trim() !== '' ? fact.license : undefined;
  const ownFiles = selectLicenseFiles(fact.fileNames).map((file) => ({ file, text: stripBom(fact.texts[file] ?? '') }));

  if (!override) {
    if (fact.license === undefined || fact.license === null || fact.license === '') {
      violations.push(`${key}: no license field and no override`);
    }
    if (ownFiles.length === 0) violations.push(`${key}: no license file and no override`);
    return { license: fact.license, source: 'package', citation: null, licenseFiles: ownFiles, violations };
  }

  if (typeof overrideText !== 'string') {
    violations.push(`${key}: override text file "${override.text}" is missing`);
  } else {
    const target = fact.texts[override.verify?.file];
    if (typeof target !== 'string') {
      violations.push(`${key}: override verify file "${override.verify?.file}" is not in the installed package`);
    } else if (!verifyOverrideText(override.verify.mode, target, overrideText)) {
      violations.push(`${key}: override text does not match the installed "${override.verify.file}" (${override.verify.mode})`);
    }
  }
  if (declared !== undefined && declared !== override.license) {
    violations.push(`${key}: override license "${override.license}" contradicts the declared "${declared}"`);
  }

  const citation = { url: override.citation?.url, ref: override.citation?.ref };
  if (ownFiles.length > 0) {
    return { license: override.license, source: 'package', citation, licenseFiles: ownFiles, violations };
  }
  // The override text is a checked-in copy; LF-normalized so a Windows
  // autocrlf checkout yields the same bytes as any other checkout.
  const text = typeof overrideText === 'string' ? normalizeEol(overrideText) : '';
  return { license: override.license, source: 'override', citation, licenseFiles: [{ file: override.text, text }], violations };
}

// ---------------------------------------------------------------------------
// Notice set (#176)
// ---------------------------------------------------------------------------

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareVersions(a, b) {
  const pa = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(a);
  const pb = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(b);
  if (!pa || !pb) return compareStrings(a, b);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d;
  }
  return compareStrings(pa[4], pb[4]);
}

// Code-unit name order (never locale), then numeric major.minor.patch.
export function compareEntries(a, b) {
  return compareStrings(a.name, b.name) || compareVersions(a.version, b.version);
}

function sameLicenseValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// packages: one fact per closure package:
//   { name, version, license (lockfile value), installed: { version, license },
//     fileNames: top-level file names, texts: { [fileName]: text } }
// overrides: parsed overrides.json; overrideTexts: { [key]: text }.
// Returns { noticeSet, violations }; noticeSet is null when any violation exists.
export function buildNoticeSet({ packages, overrides, overrideTexts, allowlist = LICENSE_ALLOWLIST }) {
  const closureKeys = new Set(packages.map((p) => `${p.name}@${p.version}`));
  const violations = validateOverrides(overrides, closureKeys, allowlist);
  const entries = [];

  for (const fact of [...packages].sort(compareEntries)) {
    const key = `${fact.name}@${fact.version}`;
    if (fact.installed?.version !== fact.version) {
      violations.push(`${key}: installed version ${fact.installed?.version} disagrees with the lockfile (stale install?)`);
    }
    if (!sameLicenseValue(fact.installed?.license, fact.license)) {
      violations.push(`${key}: installed license ${JSON.stringify(fact.installed?.license)} disagrees with the lockfile`);
    }

    const override = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : undefined;
    const resolved = applyOverrides(fact, override, overrideTexts[key]);
    violations.push(...resolved.violations);

    const policy = evaluateLicense(resolved.license, allowlist);
    if (!policy.ok) violations.push(`${key}: license rejected: ${policy.error}`);

    entries.push({
      name: fact.name,
      version: fact.version,
      license: typeof resolved.license === 'string' ? resolved.license : String(resolved.license),
      chosenLicense: policy.ok ? policy.chosen : '',
      source: resolved.source,
      citation: resolved.citation,
      licenseFiles: resolved.licenseFiles,
      noticeFiles: selectNoticeFiles(fact.fileNames).map((file) => ({ file, text: stripBom(fact.texts[file] ?? '') })),
    });
  }

  if (violations.length > 0) return { noticeSet: null, violations };
  return { noticeSet: { schemaVersion: 1, packages: entries }, violations };
}

export function serializeNoticeSet(noticeSet) {
  return JSON.stringify(noticeSet, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// IO shell (Adapter: npm's on-disk layout -> the core's plain values)
// ---------------------------------------------------------------------------

function readJson(file) {
  return JSON.parse(stripBom(fs.readFileSync(file, 'utf8')));
}

function readPackageFacts(root, entry, override) {
  const dir = path.join(root, ...entry.path.split('/'));
  const installed = readJson(path.join(dir, 'package.json'));
  const fileNames = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name);
  const wanted = new Set([...selectLicenseFiles(fileNames), ...selectNoticeFiles(fileNames)]);
  const verifyFile = override?.verify?.file;
  if (typeof verifyFile === 'string' && fileNames.includes(verifyFile)) wanted.add(verifyFile);
  const texts = {};
  for (const file of [...wanted].sort(compareStrings)) texts[file] = fs.readFileSync(path.join(dir, file), 'utf8');
  return {
    name: entry.name,
    version: entry.version,
    license: entry.license,
    installed: { version: installed.version, license: installed.license },
    fileNames,
    texts,
  };
}

export function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: 'string' },
      out: { type: 'string' },
      'overrides-dir': { type: 'string' },
    },
    strict: true,
  });
  const root = path.resolve(values.root ?? scriptRoot);
  const out = path.resolve(values.out ?? path.join(root, 'dist', 'third-party-notices.json'));
  const overridesDir = path.resolve(values['overrides-dir'] ?? path.join(root, 'build', 'third-party'));

  const violations = [];
  let noticeSet = null;
  try {
    const pkg = readJson(path.join(root, 'package.json'));
    const lock = readJson(path.join(root, 'package-lock.json'));
    const closure = computeShippedClosure(lock, shippedRoots(pkg)).map((e) => ({
      ...e,
      license: lock.packages[e.path].license,
    }));
    const overrides = readJson(path.join(overridesDir, 'overrides.json'));
    const overrideTexts = {};
    for (const [key, o] of Object.entries(overrides)) {
      if (typeof o?.text !== 'string' || !PLAIN_FILE_NAME.test(o.text)) continue;
      const file = path.join(overridesDir, o.text);
      if (fs.existsSync(file)) overrideTexts[key] = fs.readFileSync(file, 'utf8');
    }
    const packages = closure.map((entry) => readPackageFacts(root, entry, overrides[`${entry.name}@${entry.version}`]));
    const result = buildNoticeSet({ packages, overrides, overrideTexts });
    violations.push(...result.violations);
    noticeSet = result.noticeSet;
  } catch (error) {
    violations.push(error instanceof Error ? error.message : String(error));
  }

  if (violations.length > 0 || noticeSet === null) {
    io.stderr.write(`third-party-notices: ${violations.length} violation(s); nothing written:\n`);
    for (const v of violations) io.stderr.write(`  - ${v}\n`);
    return 1;
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, serializeNoticeSet(noticeSet), 'utf8');
  const shown = path.relative(root, out);
  io.stdout.write(`third-party-notices: ${noticeSet.packages.length} packages -> ${shown.startsWith('..') ? out : shown}\n`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = main();
}
