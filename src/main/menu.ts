import type { MenuItemConstructorOptions } from 'electron';
import type { ViewSettings, DocumentTab } from '../preload/api';

export interface MenuHandlers {
  onOpen: () => void;
  onOpenFolder: () => void;
  onToggleDarkMode: (checked: boolean) => void;
  onToggleShowFrontmatter: (checked: boolean) => void;
  onToggleShowTreePanel: (checked: boolean) => void;
  onSelectTab: (tab: DocumentTab) => void;
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
        { type: 'separator' },
        {
          id: 'menu-view-preview',
          label: 'Preview',
          type: 'radio',
          checked: initialViewSettings.currentTab === 'preview',
          click: () => handlers.onSelectTab('preview'),
        },
        {
          id: 'menu-view-code',
          label: 'Code',
          type: 'radio',
          checked: initialViewSettings.currentTab === 'code',
          click: () => handlers.onSelectTab('code'),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [{ id: 'menu-help', label: 'md-view Help', accelerator: 'F1', click: handlers.onOpenHelp }],
    },
  ];
}
