import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { filterAndSortEntries } from '../../src/main/fileTree';

describe('filterAndSortEntries (pure, fabricated input only)', () => {
  it('keeps .md files and drops non-.md files', () => {
    const raw = [
      { name: 'notes.md', isDirectory: false },
      { name: 'ignored.txt', isDirectory: false },
      { name: 'image.png', isDirectory: false },
    ];

    const result = filterAndSortEntries(raw, '/root');

    expect(result.map((e) => e.name)).toEqual(['notes.md']);
  });

  it('keeps every directory regardless of name, including one that looks like it holds no .md files', () => {
    const raw = [
      { name: 'empty-of-md', isDirectory: true },
      { name: 'zzz-weird-name', isDirectory: true },
    ];

    const result = filterAndSortEntries(raw, '/root');

    expect(result.map((e) => e.name)).toEqual(['empty-of-md', 'zzz-weird-name']);
    expect(result.every((e) => e.type === 'directory')).toBe(true);
  });

  it('sorts directories before files', () => {
    const raw = [
      { name: 'a-file.md', isDirectory: false },
      { name: 'z-dir', isDirectory: true },
    ];

    const result = filterAndSortEntries(raw, '/root');

    expect(result.map((e) => e.name)).toEqual(['z-dir', 'a-file.md']);
    expect(result[0].type).toBe('directory');
    expect(result[1].type).toBe('file');
  });

  it('sorts case-insensitive alphabetically within each group, independent of input order', () => {
    const raw = [
      { name: 'Banana.md', isDirectory: false },
      { name: 'apple.md', isDirectory: false },
      { name: 'Cherry.md', isDirectory: false },
      { name: 'Zebra', isDirectory: true },
      { name: 'aardvark', isDirectory: true },
    ];

    const result = filterAndSortEntries(raw, '/root');

    expect(result.map((e) => e.name)).toEqual(['aardvark', 'Zebra', 'apple.md', 'Banana.md', 'Cherry.md']);
  });

  it('returns an empty array for empty input', () => {
    expect(filterAndSortEntries([], '/root')).toEqual([]);
  });

  it('treats mixed-case .md extensions (.MD, .Md) as markdown files', () => {
    const raw = [
      { name: 'shout.MD', isDirectory: false },
      { name: 'mixed.Md', isDirectory: false },
      { name: 'lower.md', isDirectory: false },
    ];

    const result = filterAndSortEntries(raw, '/root');

    expect(result.map((e) => e.name)).toEqual(['lower.md', 'mixed.Md', 'shout.MD']);
  });

  it('builds an absolute path field via path.join(dirPath, name)', () => {
    const raw = [{ name: 'notes.md', isDirectory: false }];

    const result = filterAndSortEntries(raw, '/root/dir');

    expect(result[0].path).toBe(path.join('/root/dir', 'notes.md'));
  });
});
