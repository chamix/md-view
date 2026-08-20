import * as path from 'node:path';
import type { TreeEntry } from '../preload/api';

export function filterAndSortEntries(
  raw: { name: string; isDirectory: boolean }[],
  dirPath: string
): TreeEntry[] {
  const entries: TreeEntry[] = raw
    .filter((item) => item.isDirectory || item.name.toLowerCase().endsWith('.md'))
    .map((item) => ({
      name: item.name,
      path: path.join(dirPath, item.name),
      type: item.isDirectory ? 'directory' : 'file',
    }));

  entries.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return entries;
}
