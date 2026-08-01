import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS } from '../../src/preload/api';

describe('IPC_CHANNELS (preload/main contract)', () => {
  it('exposes non-empty string channel names', () => {
    expect(typeof IPC_CHANNELS.OPEN_FILE_DIALOG).toBe('string');
    expect(IPC_CHANNELS.OPEN_FILE_DIALOG.length).toBeGreaterThan(0);

    expect(typeof IPC_CHANNELS.FILE_RENDERED).toBe('string');
    expect(IPC_CHANNELS.FILE_RENDERED.length).toBeGreaterThan(0);
  });

  it('uses distinct channel names', () => {
    expect(IPC_CHANNELS.OPEN_FILE_DIALOG).not.toBe(IPC_CHANNELS.FILE_RENDERED);
  });
});
