import chokidar, { type FSWatcher } from 'chokidar';

export type WatchAction = 'render' | 'error' | 'ignore';

export function classifyWatchEvent(event: string): WatchAction {
  if (event === 'change') return 'render';
  if (event === 'unlink') return 'error';
  return 'ignore';
}

// Task 47 (functional_domain.md #180/#182): chokidar 4.0.3 sends every
// `change` through a 50 ms LEADING-EDGE-ONLY throttle (index.js:506/:550-575;
// no trailing emit). A writer that truncates and then writes the final
// content just after the truncate's notification was delivered therefore got
// exactly one event, and the re-read saw the EMPTY file (reproduced 3/3).
// awaitWriteFinish emits only once the file size has been stable for
// stabilityThreshold ms, so the read happens after the last write.
// Cost (measured): about +105-200 ms of live-reload latency (107-201 ms vs
// ~2 ms), plus stat polling every 20 ms while a write settles. Rejected
// alternative: a trailing re-read (~75 ms after each change) keeps latency but
// flashes an empty preview and doubles reads/renders, including Mermaid passes.
// `unlink` is not delayed. close() does not cancel a pending write-finish poll,
// but it removes every listener, so no callback can follow close().
export const WATCH_WRITE_FINISH = { stabilityThreshold: 100, pollInterval: 20 } as const;

export function watchFile(
  filePath: string,
  onEvent: (action: 'render' | 'error') => void
): FSWatcher {
  const watcher = chokidar.watch(filePath, { ignoreInitial: true, awaitWriteFinish: WATCH_WRITE_FINISH });

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
