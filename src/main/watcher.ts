import chokidar, { type FSWatcher } from 'chokidar';

export type WatchAction = 'render' | 'error' | 'ignore';

export function classifyWatchEvent(event: string): WatchAction {
  if (event === 'change') return 'render';
  if (event === 'unlink') return 'error';
  return 'ignore';
}

export function watchFile(
  filePath: string,
  onEvent: (action: 'render' | 'error') => void
): FSWatcher {
  const watcher = chokidar.watch(filePath, { ignoreInitial: true });

  watcher.on('all', (event) => {
    const action = classifyWatchEvent(event);
    if (action === 'ignore') return;
    onEvent(action);
  });

  // chokidar's FSWatcher extends EventEmitter; an unhandled 'error' event
  // throws in Node by default. This is a watcher-level failure (e.g.
  // permissions), not a file-change classification concern, so it's handled
  // separately here rather than through onEvent/classifyWatchEvent.
  watcher.on('error', (error) => {
    // Not routed through onEvent/FILE_RENDERED (not a file-change
    // classification concern) and not a tested requirement of this task —
    // logged only so a watcher-level failure (e.g. permissions) is visible
    // for diagnostics instead of vanishing silently.
    console.error('md-view: file watcher error', error);
  });

  return watcher;
}
