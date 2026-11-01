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
  onOpenAbout: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
  // Task 51: one receiver behind the native menu and the title-bar popup.
  onSelectSkin: (name: string) => void;
  onEditSkins: () => void;
  // Task 56: receives the raw preset-list string (e.g. 'Default'). The
  // Default -> '' mapping happens in index.ts's handler, not here -- mirrors
  // how menu.ts never does the skin-name validation either.
  onSelectUiFont: (name: string) => void;
  onSelectCodeFont: (name: string) => void;
}

// Task 51: the Skin submenu's inputs. Names are user data (custom skins), so
// they are used only as plain-text labels, never as ids, accelerators or code.
export interface SkinMenu {
  names: string[];
  activeName: string;
}

// Task 56: the UI Font / Code Font submenus' inputs. Both lists are the
// fixed curated presets (fontPresets.ts); activeName is already mapped
// through storedToPreset, so 'Default' compares correctly against the
// preset-list entries.
export interface FontMenu {
  uiNames: string[];
  uiActiveName: string;
  codeNames: string[];
  codeActiveName: string;
}

// '&' is the accelerator marker in Windows/Linux menu labels; doubling it
// renders a literal ampersand.
function menuLabelText(name: string): string {
  return name.replace(/&/g, '&&');
}

// Task 44 #151: `documentOpen` is deliberately a separate, REQUIRED input,
// not a ViewSettings field (occupancy is not a view preference, and
// ViewSettings is broadcast and partly persisted). Required so that tsc
// rejects any production call site that forgets to pass it.
export function buildMenuTemplate(
  handlers: MenuHandlers,
  initialViewSettings: ViewSettings,
  documentOpen: boolean,
  skinMenu: SkinMenu,
  fontMenu: FontMenu
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
        {
          id: 'menu-close',
          label: 'Close',
          accelerator: 'CmdOrCtrl+W',
          enabled: documentOpen,
          click: handlers.onClose,
        },
        { type: 'separator' },
        { id: 'menu-settings', label: 'Settings', click: handlers.onOpenSettings },
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
        { type: 'separator' },
        {
          id: 'menu-skin',
          label: 'Skin',
          submenu: [
            // Ids are by index, never derived from the (user-authored) names.
            ...skinMenu.names.map(
              (name, index): MenuItemConstructorOptions => ({
                id: `menu-skin-${index}`,
                label: menuLabelText(name),
                type: 'radio',
                checked: name === skinMenu.activeName,
                click: () => handlers.onSelectSkin(name),
              })
            ),
            { type: 'separator' },
            { id: 'menu-skin-edit', label: 'Edit Skins…', click: handlers.onEditSkins },
          ],
        },
        {
          id: 'menu-ui-font',
          label: 'UI Font',
          submenu: fontMenu.uiNames.map(
            (name, index): MenuItemConstructorOptions => ({
              id: `menu-ui-font-${index}`,
              label: menuLabelText(name),
              type: 'radio',
              checked: name === fontMenu.uiActiveName,
              click: () => handlers.onSelectUiFont(name),
            })
          ),
        },
        {
          id: 'menu-code-font',
          label: 'Code Font',
          submenu: fontMenu.codeNames.map(
            (name, index): MenuItemConstructorOptions => ({
              id: `menu-code-font-${index}`,
              label: menuLabelText(name),
              type: 'radio',
              checked: name === fontMenu.codeActiveName,
              click: () => handlers.onSelectCodeFont(name),
            })
          ),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { id: 'menu-help', label: 'md-view Help', accelerator: 'F1', click: handlers.onOpenHelp },
        { type: 'separator' },
        // Task 46 #172: no accelerator.
        { id: 'menu-about', label: 'About md-view', click: handlers.onOpenAbout },
      ],
    },
  ];
}

export interface CopyMenuHandlers {
  onCopy: () => void;
  onCopyAll: () => void;
}

// Task 49 (#196-#198, #201; initial_scaffold.md Task 49 Step 1 "Context
// menu"): a separate template function, same "one template function, many
// entry points" posture as buildMenuTemplate/#67 -- never an edit to that
// File/View/Help template. `target` is the renderer's contextmenu
// classification, `{ hasCopyTarget, documentOpen }` (#202 amended: no
// clipboard content ever crosses this boundary). Copy is enabled only when
// both hold; Copy All only needs documentOpen (#201: "no selection, no
// diagram under cursor -> Copy disabled, Copy All still enabled"). Never
// offers Cut/Paste/Find -- this is a read-only viewer (#201).
export function buildCopyMenuTemplate(
  handlers: CopyMenuHandlers,
  target: { hasCopyTarget: boolean; documentOpen: boolean }
): MenuItemConstructorOptions[] {
  return [
    { id: 'menu-copy', label: 'Copy', enabled: target.documentOpen && target.hasCopyTarget, click: handlers.onCopy },
    { id: 'menu-copy-all', label: 'Copy All', enabled: target.documentOpen, click: handlers.onCopyAll },
  ];
}
