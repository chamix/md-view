import { describe, it, expect } from 'vitest';
import { buildMenuTemplate } from '../../src/main/menu';

describe('buildMenuTemplate (pure menu structure)', () => {
  it('returns exactly one top-level item (File) whose submenu has exactly 3 entries', () => {
    const template = buildMenuTemplate({ onOpen: () => {} });

    expect(template).toHaveLength(1);
    expect(template[0].label).toBe('File');

    const submenu = template[0].submenu as Array<Record<string, unknown>>;
    expect(submenu).toHaveLength(3);
    expect(submenu[0].id).toBe('menu-open');
    expect(submenu[1].type).toBe('separator');
    expect(submenu[2].id).toBe('menu-exit');
  });

  it('menu-open has label, accelerator, and click reference-equal to the onOpen handler', () => {
    const onOpen = () => {};
    const template = buildMenuTemplate({ onOpen });

    const submenu = template[0].submenu as Array<Record<string, unknown>>;
    const openItem = submenu[0];

    expect(openItem.label).toBe('Open…');
    expect(openItem.accelerator).toBe('CmdOrCtrl+O');
    expect(openItem.click).toBe(onOpen);
  });

  it('the separator entry has type: separator', () => {
    const template = buildMenuTemplate({ onOpen: () => {} });
    const submenu = template[0].submenu as Array<Record<string, unknown>>;

    expect(submenu[1].type).toBe('separator');
  });

  it('menu-exit has label Exit and role quit', () => {
    const template = buildMenuTemplate({ onOpen: () => {} });
    const submenu = template[0].submenu as Array<Record<string, unknown>>;
    const exitItem = submenu[2];

    expect(exitItem.label).toBe('Exit');
    expect(exitItem.role).toBe('quit');
  });
});
