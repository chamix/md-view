import { describe, it, expect, vi } from 'vitest';
import { buildMenuTemplate } from '../../src/main/menu';
import type { MenuHandlers, SkinMenu } from '../../src/main/menu';
import type { ViewSettings } from '../../src/preload/api';

function handlers(overrides: Partial<MenuHandlers> = {}): MenuHandlers {
  return {
    onOpen: () => {},
    onOpenFolder: () => {},
    onToggleDarkMode: () => {},
    onToggleShowFrontmatter: () => {},
    onToggleShowTreePanel: () => {},
    onSelectTab: () => {},
    onOpenHelp: () => {},
    onOpenAbout: () => {},
    onOpenSettings: () => {},
    onClose: () => {},
    onSelectSkin: () => {},
    onEditSkins: () => {},
    ...overrides,
  };
}

function skinMenu(overrides: Partial<SkinMenu> = {}): SkinMenu {
  return { names: ['Default', 'Claude', 'Obsidian', 'Tokyo Night'], activeName: 'Default', ...overrides };
}

function viewSettings(overrides: Partial<ViewSettings> = {}): ViewSettings {
  return { darkMode: false, showFrontmatter: true, showTreePanel: true, currentTab: 'preview', ...overrides };
}

describe('buildMenuTemplate (pure menu structure)', () => {
  it('File submenu has exactly 7 entries in the Task 44 #151 order', () => {
    const template = buildMenuTemplate(handlers(), viewSettings(), false, skinMenu());

    expect(template[0].label).toBe('File');

    const submenu = template[0].submenu as Array<Record<string, unknown>>;
    expect(submenu).toHaveLength(7);
    expect(submenu[0].id).toBe('menu-open');
    expect(submenu[1].id).toBe('menu-open-folder');
    expect(submenu[2].id).toBe('menu-close');
    expect(submenu[3].type).toBe('separator');
    expect(submenu[4].id).toBe('menu-settings');
    expect(submenu[5].type).toBe('separator');
    expect(submenu[6].id).toBe('menu-exit');
  });

  it('menu-close has label Close, accelerator CmdOrCtrl+W, and click reference-equal to the onClose handler (#151)', () => {
    const onClose = () => {};
    const template = buildMenuTemplate(handlers({ onClose }), viewSettings(), true, skinMenu());
    const submenu = template[0].submenu as Array<Record<string, unknown>>;
    const closeItem = submenu[2];

    expect(closeItem.id).toBe('menu-close');
    expect(closeItem.label).toBe('Close');
    expect(closeItem.accelerator).toBe('CmdOrCtrl+W');
    expect(closeItem.click).toBe(onClose);
  });

  it.each([true, false])('menu-close enabled mirrors documentOpen = %s (#151)', (documentOpen) => {
    const template = buildMenuTemplate(handlers(), viewSettings(), documentOpen, skinMenu());
    const submenu = template[0].submenu as Array<Record<string, unknown>>;

    expect(submenu[2].enabled).toBe(documentOpen);
  });

  it('menu-open has label, accelerator, and click reference-equal to the onOpen handler', () => {
    const onOpen = () => {};
    const template = buildMenuTemplate(handlers({ onOpen }), viewSettings(), false, skinMenu());

    const submenu = template[0].submenu as Array<Record<string, unknown>>;
    const openItem = submenu[0];

    expect(openItem.label).toBe('Open…');
    expect(openItem.accelerator).toBe('CmdOrCtrl+O');
    expect(openItem.click).toBe(onOpen);
  });

  it('menu-open-folder has label, accelerator, and click reference-equal to the onOpenFolder handler', () => {
    const onOpenFolder = () => {};
    const template = buildMenuTemplate(handlers({ onOpenFolder }), viewSettings(), false, skinMenu());

    const submenu = template[0].submenu as Array<Record<string, unknown>>;
    const openFolderItem = submenu[1];

    expect(openFolderItem.label).toBe('Open Folder…');
    expect(openFolderItem.accelerator).toBe('CmdOrCtrl+Shift+O');
    expect(openFolderItem.click).toBe(onOpenFolder);
  });

  it('the separator entry has type: separator', () => {
    const template = buildMenuTemplate(handlers(), viewSettings(), false, skinMenu());
    const submenu = template[0].submenu as Array<Record<string, unknown>>;

    expect(submenu[3].type).toBe('separator');
  });

  it('menu-exit has label Exit and role quit', () => {
    const template = buildMenuTemplate(handlers(), viewSettings(), false, skinMenu());
    const submenu = template[0].submenu as Array<Record<string, unknown>>;
    const exitItem = submenu[6];

    expect(exitItem.label).toBe('Exit');
    expect(exitItem.role).toBe('quit');
  });

  it('template now has 3 top-level items: File, View, Help', () => {
    const template = buildMenuTemplate(handlers(), viewSettings(), false, skinMenu());

    expect(template).toHaveLength(3);
    expect(template[0].label).toBe('File');
    expect(template[1].label).toBe('View');
    expect(template[2].label).toBe('Help');
  });

  // Task 51 expectation change (disclosed): the new Skin submenu adds a
  // separator and the Skin entry after the Preview/Code radios, so View now has
  // 8 entries; the original 6 keep their exact positions and ids.
  it("View's submenu has exactly 8 entries: the original 6 (menu-dark-mode ... menu-view-code), then a separator and the Skin submenu", () => {
    const template = buildMenuTemplate(handlers(), viewSettings(), false, skinMenu());
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;

    expect(viewSubmenu).toHaveLength(8);
    expect(viewSubmenu[6].type).toBe('separator');
    expect(viewSubmenu[7].id).toBe('menu-skin');
    expect(viewSubmenu[0].id).toBe('menu-dark-mode');
    expect(viewSubmenu[1].id).toBe('menu-show-frontmatter');
    expect(viewSubmenu[2].id).toBe('menu-show-tree-panel');
    expect(viewSubmenu[3].type).toBe('separator');
    expect(viewSubmenu[3].id).toBeUndefined();
    expect(viewSubmenu[4].id).toBe('menu-view-preview');
    expect(viewSubmenu[5].id).toBe('menu-view-code');
  });

  it.each([true, false])('menu-dark-mode reflects initialViewSettings.darkMode = %s', (darkMode) => {
    const template = buildMenuTemplate(handlers(), viewSettings({ darkMode }), false, skinMenu());
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;
    const darkModeItem = viewSubmenu[0];

    expect(darkModeItem.type).toBe('checkbox');
    expect(darkModeItem.label).toBe('Dark Mode');
    expect(darkModeItem.checked).toBe(darkMode);
  });

  it("menu-dark-mode's click invokes onToggleDarkMode with the mock menuItem's checked value", () => {
    const onToggleDarkMode = vi.fn();
    const template = buildMenuTemplate(handlers({ onToggleDarkMode }), viewSettings(), false, skinMenu());
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;
    const darkModeItem = viewSubmenu[0] as { click: (menuItem: { checked: boolean }) => void };

    darkModeItem.click({ checked: true });

    expect(onToggleDarkMode).toHaveBeenCalledWith(true);
  });

  it.each([true, false])('menu-show-frontmatter reflects initialViewSettings.showFrontmatter = %s', (showFrontmatter) => {
    const template = buildMenuTemplate(handlers(), viewSettings({ showFrontmatter }), false, skinMenu());
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;
    const showFrontmatterItem = viewSubmenu[1];

    expect(showFrontmatterItem.type).toBe('checkbox');
    expect(showFrontmatterItem.label).toBe('Show Frontmatter');
    expect(showFrontmatterItem.checked).toBe(showFrontmatter);
  });

  it("menu-show-frontmatter's click invokes onToggleShowFrontmatter with the mock menuItem's checked value", () => {
    const onToggleShowFrontmatter = vi.fn();
    const template = buildMenuTemplate(handlers({ onToggleShowFrontmatter }), viewSettings(), false, skinMenu());
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;
    const showFrontmatterItem = viewSubmenu[1] as { click: (menuItem: { checked: boolean }) => void };

    showFrontmatterItem.click({ checked: false });

    expect(onToggleShowFrontmatter).toHaveBeenCalledWith(false);
  });

  it.each([true, false])('menu-show-tree-panel reflects initialViewSettings.showTreePanel = %s', (showTreePanel) => {
    const template = buildMenuTemplate(handlers(), viewSettings({ showTreePanel }), false, skinMenu());
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;
    const showTreePanelItem = viewSubmenu[2];

    expect(showTreePanelItem.type).toBe('checkbox');
    expect(showTreePanelItem.label).toBe('Show File Tree');
    expect(showTreePanelItem.checked).toBe(showTreePanel);
  });

  it("menu-show-tree-panel's click invokes onToggleShowTreePanel with the mock menuItem's checked value", () => {
    const onToggleShowTreePanel = vi.fn();
    const template = buildMenuTemplate(handlers({ onToggleShowTreePanel }), viewSettings(), false, skinMenu());
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;
    const showTreePanelItem = viewSubmenu[2] as { click: (menuItem: { checked: boolean }) => void };

    showTreePanelItem.click({ checked: false });

    expect(onToggleShowTreePanel).toHaveBeenCalledWith(false);
  });

  it.each(['preview', 'code'] as const)('menu-view-preview reflects initialViewSettings.currentTab = %s (checked when preview)', (currentTab) => {
    const template = buildMenuTemplate(handlers(), viewSettings({ currentTab }), false, skinMenu());
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;
    const previewItem = viewSubmenu[4];

    expect(previewItem.type).toBe('radio');
    expect(previewItem.label).toBe('Preview');
    expect(previewItem.checked).toBe(currentTab === 'preview');
  });

  it("menu-view-preview's click invokes onSelectTab with 'preview'", () => {
    const onSelectTab = vi.fn();
    const template = buildMenuTemplate(handlers({ onSelectTab }), viewSettings(), false, skinMenu());
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;
    const previewItem = viewSubmenu[4] as { click: () => void };

    previewItem.click();

    expect(onSelectTab).toHaveBeenCalledWith('preview');
  });

  it.each(['preview', 'code'] as const)('menu-view-code reflects initialViewSettings.currentTab = %s (checked when code)', (currentTab) => {
    const template = buildMenuTemplate(handlers(), viewSettings({ currentTab }), false, skinMenu());
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;
    const codeItem = viewSubmenu[5];

    expect(codeItem.type).toBe('radio');
    expect(codeItem.label).toBe('Code');
    expect(codeItem.checked).toBe(currentTab === 'code');
  });

  it("menu-view-code's click invokes onSelectTab with 'code'", () => {
    const onSelectTab = vi.fn();
    const template = buildMenuTemplate(handlers({ onSelectTab }), viewSettings(), false, skinMenu());
    const viewSubmenu = template[1].submenu as Array<Record<string, unknown>>;
    const codeItem = viewSubmenu[5] as { click: () => void };

    codeItem.click();

    expect(onSelectTab).toHaveBeenCalledWith('code');
  });

  it("Help's submenu has exactly 3 entries in the Task 46 #172 order: menu-help, a separator, menu-about", () => {
    const template = buildMenuTemplate(handlers(), viewSettings(), false, skinMenu());
    const helpSubmenu = template[2].submenu as Array<Record<string, unknown>>;

    expect(helpSubmenu).toHaveLength(3);
    expect(helpSubmenu[0].id).toBe('menu-help');
    expect(helpSubmenu[1].type).toBe('separator');
    expect(helpSubmenu[2].id).toBe('menu-about');
  });

  it('menu-about has label About md-view, no accelerator, and click reference-equal to the onOpenAbout handler (#172)', () => {
    const onOpenAbout = () => {};
    const template = buildMenuTemplate(handlers({ onOpenAbout }), viewSettings(), false, skinMenu());
    const helpSubmenu = template[2].submenu as Array<Record<string, unknown>>;
    const aboutItem = helpSubmenu[2];

    expect(aboutItem.label).toBe('About md-view');
    expect(aboutItem.accelerator).toBeUndefined();
    expect(aboutItem.click).toBe(onOpenAbout);
  });

  it('menu-help has label, F1 accelerator, and click reference-equal to the onOpenHelp handler', () => {
    const onOpenHelp = () => {};
    const template = buildMenuTemplate(handlers({ onOpenHelp }), viewSettings(), false, skinMenu());
    const helpSubmenu = template[2].submenu as Array<Record<string, unknown>>;
    const helpItem = helpSubmenu[0];

    expect(helpItem.label).toBe('md-view Help');
    expect(helpItem.accelerator).toBe('F1');
    expect(helpItem.click).toBe(onOpenHelp);
  });
});

// Task 51 (#218, #223; initial_scaffold.md Task 51 "Menu").
describe('buildMenuTemplate: View > Skin submenu (Task 51)', () => {
  type Item = Record<string, unknown> & { click?: () => void };
  const skinSubmenuOf = (m: SkinMenu, h: MenuHandlers = handlers()): Item[] => {
    const view = buildMenuTemplate(h, viewSettings(), false, skinMenu(m))[1].submenu as Item[];
    return (view.find((i) => i.id === 'menu-skin') as Item).submenu as unknown as Item[];
  };

  it('is a labelled submenu "Skin" placed after a separator following the Preview/Code radios', () => {
    const view = buildMenuTemplate(handlers(), viewSettings(), false, skinMenu())[1].submenu as Item[];
    expect(view[5].id).toBe('menu-view-code');
    expect(view[6].type).toBe('separator');
    expect(view[7].id).toBe('menu-skin');
    expect(view[7].label).toBe('Skin');
    expect(Array.isArray(view[7].submenu)).toBe(true);
  });

  it('lists one radio per name in order, then a separator, then Edit Skins…', () => {
    const names = ['Default', 'Claude', 'Obsidian', 'Tokyo Night', 'Mine'];
    const sub = skinSubmenuOf({ names, activeName: 'Default' });
    expect(sub).toHaveLength(names.length + 2);
    names.forEach((n, i) => {
      expect(sub[i].type).toBe('radio');
      expect(sub[i].label).toBe(n);
    });
    expect(sub[names.length].type).toBe('separator');
    expect(sub[names.length + 1].id).toBe('menu-skin-edit');
    expect(sub[names.length + 1].label).toBe('Edit Skins…');
  });

  it('ids are menu-skin-<index>, never derived from names', () => {
    const sub = skinSubmenuOf({ names: ['Default', '<img onerror=x>', 'a b'], activeName: 'Default' });
    expect(sub.slice(0, 3).map((i) => i.id)).toEqual(['menu-skin-0', 'menu-skin-1', 'menu-skin-2']);
  });

  it('checked is true only for the item whose name equals activeName', () => {
    const names = ['Default', 'Claude', 'Obsidian', 'Tokyo Night'];
    const sub = skinSubmenuOf({ names, activeName: 'Obsidian' });
    expect(sub.slice(0, 4).map((i) => i.checked)).toEqual([false, false, true, false]);
  });

  it('nothing is checked when activeName matches no entry', () => {
    const sub = skinSubmenuOf({ names: ['Default', 'Claude'], activeName: 'nope' });
    expect(sub.slice(0, 2).map((i) => i.checked)).toEqual([false, false]);
  });

  it("doubles '&' in labels (Windows accelerator marker) and leaves other text as plain text", () => {
    const sub = skinSubmenuOf({ names: ['Rock & Roll', 'A&&B', '<b>x</b>'], activeName: 'x' });
    expect(sub[0].label).toBe('Rock && Roll');
    expect(sub[1].label).toBe('A&&&&B');
    expect(sub[2].label).toBe('<b>x</b>');
  });

  it('click calls onSelectSkin with the ORIGINAL (unescaped) name', () => {
    const onSelectSkin = vi.fn();
    const sub = skinSubmenuOf({ names: ['Default', 'Rock & Roll'], activeName: 'Default' }, handlers({ onSelectSkin }));
    sub[1].click!();
    expect(onSelectSkin).toHaveBeenCalledTimes(1);
    expect(onSelectSkin).toHaveBeenCalledWith('Rock & Roll');
  });

  it('Edit Skins… click is reference-equal to onEditSkins', () => {
    const onEditSkins = () => {};
    const sub = skinSubmenuOf({ names: ['Default'], activeName: 'Default' }, handlers({ onEditSkins }));
    expect(sub[sub.length - 1].click).toBe(onEditSkins);
  });
});
