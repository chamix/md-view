import { describe, it, expect } from 'vitest';
import { createDocumentSession } from '../../src/main/documentSession';
import type { DocumentSessionPorts } from '../../src/main/documentSession';
import type { FileRenderedMessage } from '../../src/preload/api';

// Task 44 (functional_domain.md #147-#151): the document session use case,
// driven entirely through fake ports. renderFile returns deferred promises so
// each test controls exactly when a render resolves relative to close().

interface Deferred {
  filePath: string;
  resolve: (message: FileRenderedMessage) => void;
}

interface FakeWatch {
  filePath: string;
  onChange: () => void;
  closed: boolean;
}

function ok(filePath: string): FileRenderedMessage {
  return { ok: true, filePath, html: '<p>' + filePath + '</p>', codeHtml: '', baseUrl: 'file:///', frontmatter: null };
}

function fail(filePath: string): FileRenderedMessage {
  return { ok: false, filePath, error: 'ENOENT: ' + filePath };
}

function harness() {
  const pendingRenders: Deferred[] = [];
  const sent: FileRenderedMessage[] = [];
  const watches: FakeWatch[] = [];
  const treeRoots: string[] = [];
  let closedNotifications = 0;
  let occupancyCalls = 0;

  const ports: DocumentSessionPorts = {
    renderFile: (filePath) =>
      new Promise<FileRenderedMessage>((resolve) => {
        pendingRenders.push({ filePath, resolve });
      }),
    sendFileRendered: (message) => {
      sent.push(message);
    },
    sendDocumentClosed: () => {
      closedNotifications += 1;
    },
    watch: (filePath, onChange) => {
      const w: FakeWatch = { filePath, onChange, closed: false };
      watches.push(w);
      return {
        close: () => {
          w.closed = true;
        },
      };
    },
    establishTreeRootFor: async (filePath) => {
      treeRoots.push(filePath);
    },
    onOccupancyChanged: () => {
      occupancyCalls += 1;
    },
  };

  const session = createDocumentSession(ports);

  // Resolve the oldest pending render with the given message and let every
  // continuation (deliver / watch / tree root) run.
  async function resolveNext(message: (filePath: string) => FileRenderedMessage): Promise<void> {
    const next = pendingRenders.shift();
    if (!next) throw new Error('no pending render');
    next.resolve(message(next.filePath));
    await flush();
  }

  return {
    session,
    sent,
    watches,
    treeRoots,
    pendingRenders,
    resolveNext,
    activeWatches: () => watches.filter((w) => !w.closed),
    closedNotifications: () => closedNotifications,
    occupancyCalls: () => occupancyCalls,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

async function openAndResolve(h: ReturnType<typeof harness>, filePath: string, message = ok): Promise<void> {
  const done = h.session.open(filePath);
  await h.resolveNext(message);
  await done;
}

describe('createDocumentSession: open', () => {
  it('delivers a successful open, starts exactly one watch, establishes the tree root for that file', async () => {
    const h = harness();
    await openAndResolve(h, '/a/A.md');

    expect(h.sent).toEqual([ok('/a/A.md')]);
    expect(h.activeWatches().map((w) => w.filePath)).toEqual(['/a/A.md']);
    expect(h.treeRoots).toEqual(['/a/A.md']);
    expect(h.session.isOpen()).toBe(true);
  });

  it('switching files closes the previous watch first (one watcher at a time)', async () => {
    const h = harness();
    await openAndResolve(h, '/a/A.md');
    await openAndResolve(h, '/b/B.md');

    expect(h.activeWatches().map((w) => w.filePath)).toEqual(['/b/B.md']);
  });

  it('a watch change re-renders the watched file through the same delivery path', async () => {
    const h = harness();
    await openAndResolve(h, '/a/A.md');

    h.watches[0].onChange();
    await h.resolveNext((f) => ({ ...ok(f), html: '<p>changed</p>' } as FileRenderedMessage));

    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toMatchObject({ ok: true, filePath: '/a/A.md', html: '<p>changed</p>' });
  });

  it('an error delivery also occupies the slot (#145) and still establishes the tree root', async () => {
    const h = harness();
    await openAndResolve(h, '/a/missing.md', fail);

    expect(h.sent).toEqual([fail('/a/missing.md')]);
    expect(h.session.isOpen()).toBe(true);
    expect(h.occupancyCalls()).toBe(1);
    expect(h.activeWatches()).toHaveLength(0);
    expect(h.treeRoots).toEqual(['/a/missing.md']);
  });
});

describe('createDocumentSession: close (#147 / #148)', () => {
  it('close after a successful open stops the watch (zero active), notifies once, reports the occupancy change', async () => {
    const h = harness();
    await openAndResolve(h, '/a/A.md');

    h.session.close();

    expect(h.activeWatches()).toHaveLength(0);
    expect(h.closedNotifications()).toBe(1);
    expect(h.occupancyCalls()).toBe(2); // open (empty -> occupied) + close (occupied -> empty)
    expect(h.session.isOpen()).toBe(false);
  });

  it('PRESERVED pre-existing behavior: a failed open leaves the previous watch running; close then leaves zero watches', async () => {
    const h = harness();
    await openAndResolve(h, '/a/A.md');
    await openAndResolve(h, '/b/missing.md', fail);

    // Pinned on purpose (approval condition 2): not fixed by Task 44.
    expect(h.activeWatches().map((w) => w.filePath)).toEqual(['/a/A.md']);

    h.session.close();

    expect(h.activeWatches()).toHaveLength(0);
  });
});

describe('createDocumentSession: close invalidates in-flight renders (#149)', () => {
  it('an open in flight across an acting close is not delivered and does not re-occupy the slot', async () => {
    const h = harness();
    await openAndResolve(h, '/a/A.md');

    const inFlight = h.session.open('/b/B.md');
    h.session.close();
    await h.resolveNext(ok);
    await inFlight;

    expect(h.sent).toEqual([ok('/a/A.md')]);
    expect(h.session.isOpen()).toBe(false);
    expect(h.occupancyCalls()).toBe(2);
  });

  it('an invalidated open does not start a watch (condition 3, watch)', async () => {
    const h = harness();
    await openAndResolve(h, '/a/A.md');

    const inFlight = h.session.open('/b/B.md');
    h.session.close();
    await h.resolveNext(ok);
    await inFlight;

    expect(h.watches.map((w) => w.filePath)).toEqual(['/a/A.md']);
    expect(h.activeWatches()).toHaveLength(0);
  });

  it('an invalidated open does not establish a tree root (condition 3, tree root)', async () => {
    const h = harness();
    await openAndResolve(h, '/a/A.md');

    const inFlight = h.session.open('/b/B.md');
    h.session.close();
    await h.resolveNext(ok);
    await inFlight;

    expect(h.treeRoots).toEqual(['/a/A.md']);
  });

  it('a watch-triggered render in flight across an acting close is not delivered', async () => {
    const h = harness();
    await openAndResolve(h, '/a/A.md');

    h.watches[0].onChange();
    h.session.close();
    await h.resolveNext(ok);

    expect(h.sent).toEqual([ok('/a/A.md')]);
    expect(h.session.isOpen()).toBe(false);
  });

  it('an open that starts after close is delivered normally', async () => {
    const h = harness();
    await openAndResolve(h, '/a/A.md');
    h.session.close();

    await openAndResolve(h, '/b/B.md');

    expect(h.sent).toEqual([ok('/a/A.md'), ok('/b/B.md')]);
    expect(h.activeWatches().map((w) => w.filePath)).toEqual(['/b/B.md']);
    expect(h.treeRoots).toEqual(['/a/A.md', '/b/B.md']);
    expect(h.session.isOpen()).toBe(true);
  });
});

describe('createDocumentSession: close is inert when nothing is open (#150)', () => {
  it('close while empty sends no notification and reports no occupancy change', () => {
    const h = harness();

    h.session.close();

    expect(h.closedNotifications()).toBe(0);
    expect(h.occupancyCalls()).toBe(0);
  });

  it('a first open in flight across an inert close is still delivered', async () => {
    const h = harness();

    const inFlight = h.session.open('/a/A.md');
    h.session.close();
    await h.resolveNext(ok);
    await inFlight;

    expect(h.sent).toEqual([ok('/a/A.md')]);
    expect(h.session.isOpen()).toBe(true);
    expect(h.closedNotifications()).toBe(0);
  });
});

describe('createDocumentSession: occupancy notifications (#151)', () => {
  it('fires once on the first delivery, never on a watch re-render or a second open, once on an acting close', async () => {
    const h = harness();

    await openAndResolve(h, '/a/A.md');
    expect(h.occupancyCalls()).toBe(1);

    h.watches[0].onChange();
    await h.resolveNext(ok);
    expect(h.occupancyCalls()).toBe(1);

    await openAndResolve(h, '/b/B.md');
    expect(h.occupancyCalls()).toBe(1);

    h.session.close();
    expect(h.occupancyCalls()).toBe(2);

    h.session.close();
    expect(h.occupancyCalls()).toBe(2);
  });
});

describe('createDocumentSession: shutdown', () => {
  it('stops the watch with no notification and no occupancy change', async () => {
    const h = harness();
    await openAndResolve(h, '/a/A.md');

    h.session.shutdown();

    expect(h.activeWatches()).toHaveLength(0);
    expect(h.closedNotifications()).toBe(0);
    expect(h.occupancyCalls()).toBe(1);
  });

  it('is safe with no watch active', () => {
    const h = harness();
    expect(() => h.session.shutdown()).not.toThrow();
  });
});
