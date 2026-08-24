import type { MenuItemConstructorOptions } from 'electron';

export interface ViewSettings {
  darkMode: boolean;
  showFrontmatter: boolean;
  showTreePanel: boolean;
}

export interface MenuHandlers {
  onOpen: () => void;
  onOpenFolder: () => void;
  onToggleDarkMode: (checked: boolean) => void;
  onToggleShowFrontmatter: (checked: boolean) => void;
  onToggleShowTreePanel: (checked: boolean) => void;
  onOpenHelp: () => void;
}

export function buildMenuTemplate(
  handlers: MenuHandlers,
  initialViewSettings: ViewSettings
): MenuItemConstructorOptions[] {
  return [
    {
      label: 'File',
      submenu: [
        { id: 'menu-open', label: 'Open…', accelerator: 'CmdOrCtrl+O', click: handlers.onOpen },
        {
          id: 'menu-open-folder',
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: handlers.onOpenFolder,
        },
        { type: 'separator' },
        { id: 'menu-exit', label: 'Exit', role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          id: 'menu-dark-mode',
          label: 'Dark Mode',
          type: 'checkbox',
          checked: initialViewSettings.darkMode,
          click: (menuItem) => handlers.onToggleDarkMode(menuItem.checked),
        },
        {
          id: 'menu-show-frontmatter',
          label: 'Show Frontmatter',
          type: 'checkbox',
          checked: initialViewSettings.showFrontmatter,
          click: (menuItem) => handlers.onToggleShowFrontmatter(menuItem.checked),
        },
        {
          id: 'menu-show-tree-panel',
          label: 'Show File Tree',
          type: 'checkbox',
          checked: initialViewSettings.showTreePanel,
          click: (menuItem) => handlers.onToggleShowTreePanel(menuItem.checked),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [{ id: 'menu-help', label: 'md-view Help', accelerator: 'F1', click: handlers.onOpenHelp }],
    },
  ];
}
