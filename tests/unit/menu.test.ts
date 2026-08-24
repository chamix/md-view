import { describe, it, expect, vi } from 'vitest';
import { buildMenuTemplate } from '../../src/main/menu';
import type { MenuHandlers, ViewSettings } from '../../src/main/menu';

function handlers(overrides: Partial<MenuHandlers> = {}): MenuHandlers {
  return {
    onOpen: () => {},
    onOpenFolder: () => {},
    onToggleDarkMode: () => {},
    onToggleShowFrontmatter: () => {},
    onToggleShowTreePanel: () => {},
    onOpenHelp: () => {},
    ...overrides,
  };
}

function viewSettings(overrides: Partial<ViewSettings> = {}): ViewSettings {
  return { darkMode: false, showFrontmatter: true, showTreePanel: true, ...overrides };
}

describe('buildMenuTemplate (pure menu structure)', () => {
  it('returns exactly one top-level item (File) whose submenu has exactly 4 entries', () => {
    const template = buildMenuTemplate(handlers(), viewSettings());

    expect(template[0].label).toBe('File');

    const submenu = template[0].submenu as Array<Record<string, unknown>>;
    expect(submenu).toHaveLength(4);
    expect(submenu[0].id).toBe('menu-open');
    expect(submenu[1].id).toBe('menu-open-folder');
    expect(submenu[2].type).toBe('separator');
    expect(submenu[3].id).toBe('menu-exit');
  });

  it('menu-open has label, accelerator, and click reference-equal to the onOpen handler', () => {
    const onOpen = () => {};
    const template = buildMenuTemplate(handlers({ onOpen }), viewSettings());

    const submenu = template[0].submenu as Array<Record<string, unknown>>;
    const openItem = submenu[0];

    expect(openItem.label).toBe('Open…');
    expect(openItem.accelerator).toBe('CmdOrCtrl+O');
    expect(openItem.click).toBe(onOpen);
  });

  it('menu-open-folder has label, accelerator, and click reference-equal to the onOpenFolder handler', () => {
    const onOpenFolder = () => {};
    const template = buildMenuTemplate(handlers({ onOpenFolder }), viewSettings());

    const submenu = template[0].submenu as Array<Record<string, unknown>>;
    const openFolderItem = submenu[1];

    expect(openFolderItem.label).toBe('Open Folder…');
    expect(openFolderItem.accelerator).toBe('CmdOrCtrl+Shift+O');
    expect(openFolderItem.click).toBe(onOpenFolder);
  });

  it('the separator entry has type: separator', () => {
    const template = buildMenuTemplate(handlers(), viewSettings());
    const submenu = template[0].submenu as Array<Record<string, unknown>>;

    expect(submenu[2].type).toBe('separator');
  });

  it('menu-exit has label Exit and role quit', () => {
    const template = buildMenuTemplate(handlers(), viewSettings());
    const submenu = template[0].submenu as Array<Record<string, unknown>>;
    const exitItem = submenu[3];

    expect(exitItem.label).toBe('Exit');
    expect(exitItem.role).toBe('quit');
  });

  it('template now has 3 top-level items: File, View, Help', () => {
    const template = buildMenuTemplate(handlers(), viewSettings());

    expect(template).toHaveLength(3);
    expect(template[0].label).toBe('File');
    expect(template[1].label).toBe('View');
    expect(template[2].label).toBe('Help');
  });

  it("View's submenu has exactly 3 entries: menu-dark-mode, menu-show-frontmatter, menu-show-tree-panel", () => {
    const template = buildMenuTemplate(handlers(), viewSettings());
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;

    expect(viewSubmenu).toHaveLength(3);
    expect(viewSubmenu[0].id).toBe('menu-dark-mode');
    expect(viewSubmenu[1].id).toBe('menu-show-frontmatter');
    expect(viewSubmenu[2].id).toBe('menu-show-tree-panel');
  });

  it.each([true, false])('menu-dark-mode reflects initialViewSettings.darkMode = %s', (darkMode) => {
    const template = buildMenuTemplate(handlers(), viewSettings({ darkMode }));
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;
    const darkModeItem = viewSubmenu[0];

    expect(darkModeItem.type).toBe('checkbox');
    expect(darkModeItem.label).toBe('Dark Mode');
    expect(darkModeItem.checked).toBe(darkMode);
  });

  it("menu-dark-mode's click invokes onToggleDarkMode with the mock menuItem's checked value", () => {
    const onToggleDarkMode = vi.fn();
    const template = buildMenuTemplate(handlers({ onToggleDarkMode }), viewSettings());
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;
    const darkModeItem = viewSubmenu[0] as { click: (menuItem: { checked: boolean }) => void };

    darkModeItem.click({ checked: true });

    expect(onToggleDarkMode).toHaveBeenCalledWith(true);
  });

  it.each([true, false])('menu-show-frontmatter reflects initialViewSettings.showFrontmatter = %s', (showFrontmatter) => {
    const template = buildMenuTemplate(handlers(), viewSettings({ showFrontmatter }));
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;
    const showFrontmatterItem = viewSubmenu[1];

    expect(showFrontmatterItem.type).toBe('checkbox');
    expect(showFrontmatterItem.label).toBe('Show Frontmatter');
    expect(showFrontmatterItem.checked).toBe(showFrontmatter);
  });

  it("menu-show-frontmatter's click invokes onToggleShowFrontmatter with the mock menuItem's checked value", () => {
    const onToggleShowFrontmatter = vi.fn();
    const template = buildMenuTemplate(handlers({ onToggleShowFrontmatter }), viewSettings());
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;
    const showFrontmatterItem = viewSubmenu[1] as { click: (menuItem: { checked: boolean }) => void };

    showFrontmatterItem.click({ checked: false });

    expect(onToggleShowFrontmatter).toHaveBeenCalledWith(false);
  });

  it.each([true, false])('menu-show-tree-panel reflects initialViewSettings.showTreePanel = %s', (showTreePanel) => {
    const template = buildMenuTemplate(handlers(), viewSettings({ showTreePanel }));
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;
    const showTreePanelItem = viewSubmenu[2];

    expect(showTreePanelItem.type).toBe('checkbox');
    expect(showTreePanelItem.label).toBe('Show File Tree');
    expect(showTreePanelItem.checked).toBe(showTreePanel);
  });

  it("menu-show-tree-panel's click invokes onToggleShowTreePanel with the mock menuItem's checked value", () => {
    const onToggleShowTreePanel = vi.fn();
    const template = buildMenuTemplate(handlers({ onToggleShowTreePanel }), viewSettings());
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;
    const showTreePanelItem = viewSubmenu[2] as { click: (menuItem: { checked: boolean }) => void };

    showTreePanelItem.click({ checked: false });

    expect(onToggleShowTreePanel).toHaveBeenCalledWith(false);
  });

  it("Help's submenu has exactly 1 entry: menu-help", () => {
    const template = buildMenuTemplate(handlers(), viewSettings());
    const helpSubmenu = template[2].submenu as Array<Record<string, unknown>>;

    expect(helpSubmenu).toHaveLength(1);
    expect(helpSubmenu[0].id).toBe('menu-help');
  });

  it('menu-help has label, F1 accelerator, and click reference-equal to the onOpenHelp handler', () => {
    const onOpenHelp = () => {};
    const template = buildMenuTemplate(handlers({ onOpenHelp }), viewSettings());
    const helpSubmenu = template[2].submenu as Array<Record<string, unknown>>;
    const helpItem = helpSubmenu[0];

    expect(helpItem.label).toBe('md-view Help');
    expect(helpItem.accelerator).toBe('F1');
    expect(helpItem.click).toBe(onOpenHelp);
  });
});
