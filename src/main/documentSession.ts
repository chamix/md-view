// Task 44 (functional_domain.md #147-#151): the document session use case.
// Coordinates render -> deliver -> watch -> tree root, and Close. Electron-,
// fs- and path-free: every side effect goes through a narrow port bound in
// index.ts (the composition root), so the race rules are unit-testable with
// fake ports and controllable promises.
import { createDocumentSlot } from './documentSlot';
import type { FileRenderedMessage } from '../preload/api';

export interface WatchHandle {
  close(): void;
}

export interface DocumentSessionPorts {
  renderFile(filePath: string): Promise<FileRenderedMessage>;
  sendFileRendered(message: FileRenderedMessage): void;
  sendDocumentClosed(): void;
  watch(filePath: string, onChange: () => void): WatchHandle;
  // index.ts does path.dirname(); this module never touches paths.
  establishTreeRootFor(filePath: string): Promise<void>;
  // index.ts: applyMenu() (File > Close's `enabled` mirrors occupancy).
  onOccupancyChanged(): void;
}

export interface DocumentSession {
  open(filePath: string): Promise<void>;
  close(): void;
  shutdown(): void;
  isOpen(): boolean;
}

export function createDocumentSession(ports: DocumentSessionPorts): DocumentSession {
  const slot = createDocumentSlot();
  let activeWatch: WatchHandle | null = null;

  const stopWatching = (): void => {
    activeWatch?.close();
    activeWatch = null;
  };

  // Protection Proxy in front of the sendFileRendered port, and its ONLY
  // caller (#149): a render that started before an acting Close never reaches
  // the renderer, whichever path (open or watcher) produced it.
  const deliver = (token: number, message: FileRenderedMessage): boolean => {
    const decision = slot.tryDeliver(token);
    if (!decision.deliver) return false;
    ports.sendFileRendered(message);
    if (decision.occupancyChanged) ports.onOccupancyChanged();
    return true;
  };

  const startWatching = (filePath: string): void => {
    stopWatching(); // exactly one watcher active at a time: always close the old one first
    activeWatch = ports.watch(filePath, () => {
      const token = slot.beginRender();
      ports
        .renderFile(filePath)
        .then((message) => {
          deliver(token, message);
        })
        .catch((error: unknown) => {
          console.error('md-view: watch re-render failed', error);
        });
    });
  };

  return {
    async open(filePath: string): Promise<void> {
      const token = slot.beginRender();
      const message = await ports.renderFile(filePath);
      // An open invalidated by Close is discarded entirely: no watch, no tree root.
      if (!deliver(token, message)) return;
      // Pre-existing behavior, preserved on purpose (Task 44 approval
      // condition 2): a failed open does not stop the previous file's watcher.
      if (message.ok) startWatching(filePath);
      await ports.establishTreeRootFor(filePath);
    },

    // Fully synchronous: there is no interleaving window inside Close.
    close(): void {
      if (!slot.close().acted) return; // inert when nothing is open (#150)
      stopWatching(); // zero watchers after Close (#147/#148)
      ports.sendDocumentClosed();
      ports.onOccupancyChanged();
    },

    shutdown(): void {
      stopWatching();
    },

    isOpen(): boolean {
      return slot.isOccupied();
    },
  };
}
