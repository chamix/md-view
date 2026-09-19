import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prepareWhatsNew, recordVersionSeen } from '../../src/main/whatsNew';
import type { WhatsNewPorts } from '../../src/main/whatsNew';
import type { AppState } from '../../src/main/appState';

const CHANGELOG = [
  '# Changelog',
  '',
  '## [1.2.0] - 2026-10-01',
  '',
  '- Current feature',
  '',
  '## [1.1.0] - 2026-09-19',
  '',
  '- Skipped feature',
  '',
  '## [1.0.0] - 2026-09-04',
  '',
  '- Ancient feature',
  '',
].join('\n');

// In-memory fakes for the three ports; each is a vi.fn so call counts (in
// particular "saveState was never called") are directly assertable.
function makePorts(overrides: Partial<WhatsNewPorts> = {}) {
  return {
    loadState: vi.fn(async (): Promise<AppState | null> => null),
    saveState: vi.fn(async (_state: AppState): Promise<void> => {}),
    readChangelog: vi.fn(async (): Promise<string> => CHANGELOG),
    ...overrides,
  } as WhatsNewPorts & {
    loadState: ReturnType<typeof vi.fn>;
    saveState: ReturnType<typeof vi.fn>;
    readChangelog: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('prepareWhatsNew', () => {
  it('first launch (no state): saves the current version and shows nothing', async () => {
    const ports = makePorts();
    const result = await prepareWhatsNew(ports, '1.2.0');

    expect(result).toBeNull();
    expect(ports.saveState).toHaveBeenCalledTimes(1);
    expect(ports.saveState).toHaveBeenCalledWith({ lastSeenVersion: '1.2.0' });
    expect(ports.readChangelog).not.toHaveBeenCalled();
  });

  it('corrupt state (loadState resolves null) behaves exactly like first launch', async () => {
    const ports = makePorts({ loadState: vi.fn(async () => null) });
    expect(await prepareWhatsNew(ports, '1.2.0')).toBeNull();
    expect(ports.saveState).toHaveBeenCalledWith({ lastSeenVersion: '1.2.0' });
  });

  it('first launch whose save throws still resolves null', async () => {
    const ports = makePorts({
      saveState: vi.fn(async () => {
        throw new Error('disk full');
      }),
    });
    await expect(prepareWhatsNew(ports, '1.2.0')).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('up-to-date: returns null and performs no write and no changelog read', async () => {
    const ports = makePorts({ loadState: vi.fn(async () => ({ lastSeenVersion: '1.2.0' })) });
    expect(await prepareWhatsNew(ports, '1.2.0')).toBeNull();
    expect(ports.saveState).not.toHaveBeenCalled();
    expect(ports.readChangelog).not.toHaveBeenCalled();
  });

  it('announce: returns only the current version body, never skipped or older sections', async () => {
    const ports = makePorts({ loadState: vi.fn(async () => ({ lastSeenVersion: '1.0.0' })) });
    const result = await prepareWhatsNew(ports, '1.2.0');

    expect(result).toEqual({ version: '1.2.0', body: '- Current feature' });
    expect(result?.body).not.toContain('Skipped');
    expect(result?.body).not.toContain('Ancient');
  });

  it('announce does not write state at open time', async () => {
    const ports = makePorts({ loadState: vi.fn(async () => ({ lastSeenVersion: '1.0.0' })) });
    await prepareWhatsNew(ports, '1.2.0');
    expect(ports.saveState).not.toHaveBeenCalled();
  });

  it('readChangelog rejecting -> null, no save', async () => {
    const ports = makePorts({
      loadState: vi.fn(async () => ({ lastSeenVersion: '1.0.0' })),
      readChangelog: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
    });
    await expect(prepareWhatsNew(ports, '1.2.0')).resolves.toBeNull();
    expect(ports.saveState).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('version not found in changelog -> null, no save', async () => {
    const ports = makePorts({ loadState: vi.fn(async () => ({ lastSeenVersion: '1.0.0' })) });
    await expect(prepareWhatsNew(ports, '3.0.0')).resolves.toBeNull();
    expect(ports.saveState).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('blank section -> null, no save', async () => {
    const ports = makePorts({
      loadState: vi.fn(async () => ({ lastSeenVersion: '1.0.0' })),
      readChangelog: vi.fn(async () => '## [1.2.0]\n\n   \n## [1.1.0]\n- x'),
    });
    await expect(prepareWhatsNew(ports, '1.2.0')).resolves.toBeNull();
    expect(ports.saveState).not.toHaveBeenCalled();
  });

  it('loadState rejecting -> null, no write, never throws', async () => {
    const ports = makePorts({
      loadState: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    await expect(prepareWhatsNew(ports, '1.2.0')).resolves.toBeNull();
    expect(ports.saveState).not.toHaveBeenCalled();
  });
});

describe('recordVersionSeen', () => {
  it('saves the given version', async () => {
    const ports = makePorts();
    await recordVersionSeen(ports, '1.2.0');
    expect(ports.saveState).toHaveBeenCalledWith({ lastSeenVersion: '1.2.0' });
  });

  it('does not throw when the save rejects', async () => {
    const ports = makePorts({
      saveState: vi.fn(async () => {
        throw new Error('EACCES');
      }),
    });
    await expect(recordVersionSeen(ports, '1.2.0')).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });
});
